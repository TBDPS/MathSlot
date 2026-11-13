use std::sync::Arc;
use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use eframe::egui;
use latex_rust::{Color, Dim, MathFont, PngBackground, PngOptions, latex_to_png};
use mathslot_core::ast::ParsedDoc;
use mathslot_core::visual::{
    VISUAL_COLORS, VisualDialect, build_fallback_nav_latex, build_fallback_preview_latex,
    build_nav_latex, build_preview_latex,
};
#[cfg(test)]
use mathslot_render::CacheStats;
use mathslot_render::{
    BackendKind, ErrorSummary, Generation, GenerationTracker, RenderCache, RenderCacheKey,
    RenderData, RenderDiagnostic, RenderError, RenderFormat, RenderId, RenderMode, Theme,
};
use tiny_skia::Pixmap;

pub const PIXELS_PER_POINT: f32 = 3.0;
const SURFACE_RGBA: [u8; 4] = [255, 255, 255, 255];
const PAD_X_PX: usize = 24;
const PAD_Y_PX: usize = 16;
const RENDER_CACHE_CAPACITY: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Preview,
    Nav,
}

impl From<Mode> for RenderMode {
    fn from(mode: Mode) -> Self {
        match mode {
            Mode::Preview => RenderMode::Preview,
            Mode::Nav => RenderMode::Nav,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Rendered {
    pub image: egui::ColorImage,
    pub degraded: bool,
    pub diagnostics: Vec<RenderDiagnostic>,
}

pub struct RenderJob {
    pub revision: u64,
    pub doc: ParsedDoc,
    pub cursor_char: usize,
    pub nav_path: Vec<String>,
    pub nav_filter: Option<String>,
    pub ctx: egui::Context,
}

pub struct RenderOutput {
    pub revision: u64,
    pub preview: Result<Rendered, ErrorSummary>,
    pub nav: Result<Rendered, ErrorSummary>,
}

pub struct RenderWorker {
    tx_job: Sender<RenderJob>,
    rx_out: Receiver<RenderOutput>,
    tracker: Arc<GenerationTracker>,
}

impl RenderWorker {
    pub fn spawn() -> Self {
        let (tx_job, rx_job) = mpsc::channel::<RenderJob>();
        let (tx_out, rx_out) = mpsc::channel::<RenderOutput>();
        let tracker = Arc::new(GenerationTracker::new());
        let worker_tracker = tracker.clone();

        thread::Builder::new()
            .name("mathslot-latex-worker".to_owned())
            .spawn(move || {
                let renderer = Renderer::new();
                while let Ok(mut job) = rx_job.recv() {
                    while let Ok(newer) = rx_job.try_recv() {
                        job = newer;
                    }
                    let generation = Generation(job.revision);
                    if !worker_tracker.is_current(generation) {
                        continue;
                    }

                    let preview_res = renderer.render_doc_tracked(
                        &job.doc,
                        job.cursor_char,
                        &[],
                        None,
                        Mode::Preview,
                        Some((&worker_tracker, generation)),
                    );
                    if matches!(preview_res, Err(RenderError::Cancelled { .. })) {
                        continue;
                    }

                    let nav_res = renderer.render_doc_tracked(
                        &job.doc,
                        job.cursor_char,
                        &job.nav_path,
                        job.nav_filter.as_deref(),
                        Mode::Nav,
                        Some((&worker_tracker, generation)),
                    );
                    if matches!(nav_res, Err(RenderError::Cancelled { .. })) {
                        continue;
                    }

                    if !worker_tracker.is_current(generation) {
                        continue;
                    }

                    let ctx = job.ctx;
                    let out = RenderOutput {
                        revision: job.revision,
                        preview: preview_res.map_err(|e| ErrorSummary::from_render_error(&e)),
                        nav: nav_res.map_err(|e| ErrorSummary::from_render_error(&e)),
                    };
                    if tx_out.send(out).is_ok() {
                        ctx.request_repaint();
                    }
                }
            })
            .expect("failed to spawn latex-rust render worker");

        Self {
            tx_job,
            rx_out,
            tracker,
        }
    }

    pub fn submit(&self, mut job: RenderJob) -> Result<Generation, RenderError> {
        let generation = self.tracker.next();
        job.revision = generation.0;
        self.tx_job
            .send(job)
            .map_err(|_| RenderError::ChannelClosed)?;
        Ok(generation)
    }

    pub fn poll_latest(&self) -> Option<RenderOutput> {
        let mut latest = None;
        while let Ok(out) = self.rx_out.try_recv() {
            latest = Some(out);
        }
        latest
    }

    #[cfg(test)]
    pub fn tracker(&self) -> &Arc<GenerationTracker> {
        &self.tracker
    }
}

pub struct Renderer {
    font: MathFont,
    color_preamble: String,
    png_opts: PngOptions,
    cache: Mutex<RenderCache>,
}

impl Renderer {
    pub fn new() -> Self {
        let font = MathFont::stix_two_math().expect("embedded STIX Two Math font must load");
        let mut color_preamble = String::with_capacity(512);
        for &(name, hex) in VISUAL_COLORS {
            color_preamble.push_str(&format!("\\definecolor{{{name}}}{{HTML}}{{{hex}}}"));
        }
        let png_opts = PngOptions {
            font_size_pt: Dim::from_i64(18),
            dpi: Dim::from_i64(216),
            color: Color::rgb(15, 23, 42),
            background: PngBackground::Color(Color::rgb(255, 255, 255)),
            display: true,
        };
        Self {
            font,
            color_preamble,
            png_opts,
            cache: Mutex::new(RenderCache::new(RENDER_CACHE_CAPACITY)),
        }
    }

    #[cfg(test)]
    pub fn cache_stats(&self) -> CacheStats {
        match self.cache.lock() {
            Ok(guard) => guard.stats(),
            Err(poisoned) => poisoned.into_inner().stats(),
        }
    }

    fn lookup_cache(&self, key: &RenderCacheKey) -> Option<Rendered> {
        let mut guard = match self.cache.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let cached = guard.get(key)?;
        if let RenderData::Png {
            width,
            height,
            bytes,
        } = &cached.data
        {
            let image = egui::ColorImage::from_rgba_premultiplied(
                [*width as usize, *height as usize],
                bytes,
            );
            Some(Rendered {
                image,
                degraded: cached.degraded,
                diagnostics: cached.diagnostics.clone(),
            })
        } else {
            None
        }
    }

    fn store_cache(
        &self,
        key: RenderCacheKey,
        size: [usize; 2],
        rgba: Vec<u8>,
        degraded: bool,
        diagnostics: Vec<RenderDiagnostic>,
    ) {
        let mut guard = match self.cache.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.insert(
            key,
            RenderData::Png {
                width: size[0] as u32,
                height: size[1] as u32,
                bytes: rgba,
            },
            degraded,
            diagnostics,
        );
    }

    #[cfg(test)]
    pub fn render_doc(
        &self,
        doc: &ParsedDoc,
        cursor_char: usize,
        nav_path: &[String],
        nav_filter: Option<&str>,
        mode: Mode,
    ) -> Result<Rendered, RenderError> {
        self.render_doc_tracked(doc, cursor_char, nav_path, nav_filter, mode, None)
    }

    pub fn render_doc_tracked(
        &self,
        doc: &ParsedDoc,
        cursor_char: usize,
        nav_path: &[String],
        nav_filter: Option<&str>,
        mode: Mode,
        tracker: Option<(&GenerationTracker, Generation)>,
    ) -> Result<Rendered, RenderError> {
        let check_gen = || -> Result<(), RenderError> {
            if let Some((t, g)) = tracker {
                t.check(RenderId(0), g)?;
            }
            Ok(())
        };

        check_gen()?;

        let latex_src = match mode {
            Mode::Preview => build_preview_latex(doc, cursor_char, VisualDialect::LatexRust),
            Mode::Nav => build_nav_latex(
                doc,
                cursor_char,
                nav_path,
                nav_filter,
                VisualDialect::LatexRust,
            ),
        };

        let cache_key = RenderCacheKey::new(
            mode.into(),
            latex_src.clone(),
            Theme::Light,
            1.0,
            BackendKind::LatexRust,
            RenderFormat::Png,
        );

        if let Some(cached) = self.lookup_cache(&cache_key) {
            check_gen()?;
            return Ok(cached);
        }

        check_gen()?;

        match self.render_latex_raw(&latex_src) {
            Ok((image, rgba)) => {
                check_gen()?;
                self.store_cache(cache_key, image.size, rgba, false, Vec::new());
                Ok(Rendered {
                    image,
                    degraded: false,
                    diagnostics: Vec::new(),
                })
            }
            Err(primary_err) => {
                check_gen()?;

                let fallback_src = match mode {
                    Mode::Preview => {
                        build_fallback_preview_latex(doc, cursor_char, VisualDialect::LatexRust)
                    }
                    Mode::Nav => build_fallback_nav_latex(
                        doc,
                        cursor_char,
                        nav_path,
                        nav_filter,
                        VisualDialect::LatexRust,
                    ),
                };

                match self.render_latex_raw(&fallback_src) {
                    Ok((fb_image, fb_rgba)) => {
                        check_gen()?;
                        let summary = ErrorSummary::from_render_error(&primary_err);
                        let diag = RenderDiagnostic::new(summary.code, summary.header_summary)
                            .with_source_excerpt(summary.source_excerpt)
                            .with_detail(summary.full_detail);
                        let diagnostics = vec![diag];
                        self.store_cache(
                            cache_key,
                            fb_image.size,
                            fb_rgba,
                            true,
                            diagnostics.clone(),
                        );
                        Ok(Rendered {
                            image: fb_image,
                            degraded: true,
                            diagnostics,
                        })
                    }
                    Err(_) => Err(primary_err),
                }
            }
        }
    }

    #[cfg(test)]
    pub fn render_latex(&self, latex_src: &str) -> Result<Rendered, RenderError> {
        let (image, _) = self.render_latex_raw(latex_src)?;
        Ok(Rendered {
            image,
            degraded: false,
            diagnostics: Vec::new(),
        })
    }

    fn render_latex_raw(
        &self,
        latex_src: &str,
    ) -> Result<(egui::ColorImage, Vec<u8>), RenderError> {
        let full_src = format!("{}{latex_src}", self.color_preamble);
        let png_bytes = latex_to_png(&full_src, &self.font, &self.png_opts).map_err(|e| {
            RenderError::RenderFailed {
                code: "LATEX_RASTER_ERR".to_owned(),
                message: e.to_string(),
                latex_source: latex_src.to_owned(),
            }
        })?;
        let pixmap = Pixmap::decode_png(&png_bytes).map_err(|e| RenderError::RenderFailed {
            code: "PNG_DECODE_ERR".to_owned(),
            message: e.to_string(),
            latex_source: latex_src.to_owned(),
        })?;

        let inner_w = pixmap.width() as usize;
        let inner_h = pixmap.height() as usize;
        let out_w = inner_w + PAD_X_PX * 2;
        let out_h = inner_h + PAD_Y_PX * 2;

        let mut rgba = vec![0u8; out_w * out_h * 4];
        for px in rgba.as_chunks_mut::<4>().0 {
            px.copy_from_slice(&SURFACE_RGBA);
        }

        let src = pixmap.data();
        for y in 0..inner_h {
            let dst_row_start = ((y + PAD_Y_PX) * out_w + PAD_X_PX) * 4;
            let src_row_start = y * inner_w * 4;
            let row_bytes = inner_w * 4;
            rgba[dst_row_start..dst_row_start + row_bytes]
                .copy_from_slice(&src[src_row_start..src_row_start + row_bytes]);
        }

        let image = egui::ColorImage::from_rgba_premultiplied([out_w, out_h], &rgba);
        Ok((image, rgba))
    }
}

#[cfg(test)]
mod tests {
    use super::{Mode, RenderJob, RenderWorker, Renderer};
    use eframe::egui;
    use mathslot_core::command::{StructKind, SymbolCmd};
    use mathslot_core::library::{CustomFormat, UserLibrary};
    use mathslot_core::parser::{parse, parse_with_library};
    use mathslot_render::{ErrorSummary, GenerationTracker, RenderError};

    #[test]
    fn test_all_structs_and_symbols_compile_in_latex_rust() {
        let renderer = Renderer::new();

        // 验证标准高斯积分成功光栅化
        let gaussian = r"\int_{-\infty}^{\infty} e^{-x^2} \,\mathrm{d}x = \sqrt{\pi}";
        let res = renderer.render_latex(gaussian);
        assert!(
            res.is_ok(),
            "Gaussian integral must render successfully in latex-rust: {res:?}"
        );
        let rendered = res.expect("gaussian integral renders");
        assert!(rendered.image.size[0] > 0 && rendered.image.size[1] > 0);
        assert!(!rendered.degraded);

        for kind in StructKind::ALL {
            let mut src = format!("▸{}", kind.code());
            for idx in 0..kind.arity() {
                src.push_str(&format!("x{}", idx + 1));
                src.push(';');
            }
            let doc = parse(&src);
            for mode in [Mode::Preview, Mode::Nav] {
                let rendered = renderer
                    .render_doc(&doc, doc.char_len, &[], None, mode)
                    .unwrap_or_else(|e| panic!("failed kind={kind:?} mode={mode:?}: {e}"));
                assert!(rendered.image.size[0] > 0 && rendered.image.size[1] > 0);
            }
        }

        for sym in SymbolCmd::ALL {
            let src = format!("▸{} + 1", sym.code());
            let doc = parse(&src);
            for mode in [Mode::Preview, Mode::Nav] {
                renderer
                    .render_doc(&doc, doc.char_len, &[], None, mode)
                    .unwrap_or_else(|e| panic!("failed sym={sym:?} mode={mode:?}: {e}"));
            }
        }
    }

    #[test]
    fn test_nested_roots_limit_and_hierarchical_nav_render_cleanly() {
        let renderer = Renderer::new();

        // 嵌套根号三个关键光标时刻 + 极限 + 复合积分 + 各类半成品输入
        for sample in [
            "",
            "▸",
            "▸m",
            "▸zz",
            "▸jcb",
            "▸r1+▸rx",
            "▸r1+▸rx;",
            "▸r1+▸rx;;",
            "▸lx;0;▸fsin x;x;",
            "▸nx+1;y^2;",
            "▸i0;▸i1;t;g(u) du;;f(x) dx",
            "x^ + y_ + (a + [b + {c + \\al + \\ + 中文",
        ] {
            let doc = parse(sample);
            for cur in 0..=doc.char_len {
                renderer
                    .render_doc(&doc, cur, &[], None, Mode::Preview)
                    .unwrap_or_else(|e| panic!("preview failed for `{sample}`@{cur}: {e}"));
            }
            renderer
                .render_doc(&doc, 7, &["c".to_owned()], None, Mode::Nav)
                .unwrap_or_else(|e| panic!("nav failed for `{sample}`: {e}"));
        }
    }

    #[test]
    fn test_custom_formats_and_exotic_macro_fallback_in_latex_rust() {
        let renderer = Renderer::new();
        let mut lib = UserLibrary::default_seeded();

        // 1. 验证默认预置的 6 个自定义格式 `ka..kf` 全部原生直接光栅化
        for fmt in &lib.custom_formats {
            let mut src = format!("▸{}", fmt.code());
            for idx in 0..fmt.arity() {
                src.push_str(&format!("X{}", idx + 1));
                src.push(';');
            }
            let doc = parse_with_library(&src, &lib);
            for mode in [Mode::Preview, Mode::Nav] {
                renderer
                    .render_doc(&doc, doc.char_len, &[], None, mode)
                    .unwrap_or_else(|e| panic!("seeded custom {} failed: {e}", fmt.code()));
            }
        }

        // 2. 验证用户自定义任意未收录外部宏包指令（如 `\myExoticPkgMacro{$1}{$2}`）时，
        // 桌面端预览显式降级：必须标注 degraded == true 并携带非空 diagnostics (D-011, INV-012)
        lib.upsert_custom(CustomFormat {
            item_key: 'z',
            label: "自定义外部宏".to_owned(),
            glyph_hint: "ext".to_owned(),
            slot_roles: vec!["参数1".to_owned(), "参数2".to_owned()],
            latex_template: "\\myExoticPkgMacro{$1}{$2}".to_owned(),
            scheme_a_name: "exotic".to_owned(),
            layout: mathslot_core::library::LayoutKind::Linear,
            auto_join: None,
        })
        .expect("custom format upsert succeeds");
        let doc = parse_with_library("▸kza+b;c;", &lib);
        for mode in [Mode::Preview, Mode::Nav] {
            let rendered = renderer
                .render_doc(&doc, 5, &[], None, mode)
                .expect("exotic user macro should gracefully fallback in preview");
            assert!(rendered.image.size[0] > 0);
            assert!(
                rendered.degraded,
                "fallback must explicitly set degraded = true in {mode:?}"
            );
            assert!(
                !rendered.diagnostics.is_empty(),
                "fallback must attach non-empty diagnostics in {mode:?}"
            );

            // Second identical render must hit RenderCache and preserve degraded + diagnostics
            let hits_before = renderer.cache_stats().hits;
            let cached = renderer
                .render_doc(&doc, 5, &[], None, mode)
                .expect("cached fallback succeeds");
            assert_eq!(renderer.cache_stats().hits, hits_before + 1);
            assert!(cached.degraded);
            assert_eq!(cached.diagnostics, rendered.diagnostics);
        }
        assert!(renderer.cache_stats().hits >= 2);
    }

    #[test]
    fn test_render_doc_cancellation_and_error_summary_bounds() {
        let renderer = Renderer::new();
        let tracker = GenerationTracker::new();
        let g1 = tracker.next();
        let _g2 = tracker.next();

        let doc = parse("▸fx+1;y;");
        let res =
            renderer.render_doc_tracked(&doc, 0, &[], None, Mode::Preview, Some((&tracker, g1)));
        assert!(matches!(res, Err(RenderError::Cancelled { generation, .. }) if generation == g1));

        // Failing latex error is bounded via ErrorSummary without raw full source in header
        let long_bad: String = format!("\\undefinedMacro{{{}}}", "x".repeat(400));
        let err = renderer
            .render_latex(&long_bad)
            .expect_err("undefined macro must fail");
        let summary = ErrorSummary::from_render_error(&err);
        assert!(summary.header_summary.chars().count() <= 120);
        assert!(!summary.header_summary.contains('\n'));
        assert!(summary.truncated);
        assert!(summary.source_excerpt.chars().count() <= 200);
        assert!(summary.source_excerpt.ends_with("…（已截断）"));

        // Worker submit increments generation tracker cleanly
        let worker = RenderWorker::spawn();
        let gen_a = worker
            .submit(RenderJob {
                revision: 0,
                doc: doc.clone(),
                cursor_char: 0,
                nav_path: Vec::new(),
                nav_filter: None,
                ctx: egui::Context::default(),
            })
            .expect("worker channel open");
        assert_eq!(gen_a, worker.tracker().current());
    }
}

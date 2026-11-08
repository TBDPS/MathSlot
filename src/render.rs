use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use eframe::egui;
use latex_rust::{Color, Dim, MathFont, PngBackground, PngOptions, latex_to_png};
use mathslot_core::ast::ParsedDoc;
use mathslot_core::visual::{
    VISUAL_COLORS, VisualDialect, build_fallback_nav_latex, build_fallback_preview_latex,
    build_nav_latex, build_preview_latex,
};
use tiny_skia::Pixmap;

pub const PIXELS_PER_POINT: f32 = 3.0;
const SURFACE_RGBA: [u8; 4] = [255, 255, 255, 255];
const PAD_X_PX: usize = 24;
const PAD_Y_PX: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Preview,
    Nav,
}

pub struct Rendered {
    pub image: egui::ColorImage,
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
    pub preview: Result<Rendered, String>,
    pub nav: Result<Rendered, String>,
}

pub struct RenderWorker {
    tx_job: Sender<RenderJob>,
    rx_out: Receiver<RenderOutput>,
}

impl RenderWorker {
    pub fn spawn() -> Self {
        let (tx_job, rx_job) = mpsc::channel::<RenderJob>();
        let (tx_out, rx_out) = mpsc::channel::<RenderOutput>();

        thread::Builder::new()
            .name("mathslot-latex-worker".to_owned())
            .spawn(move || {
                let renderer = Renderer::new();
                while let Ok(mut job) = rx_job.recv() {
                    while let Ok(newer) = rx_job.try_recv() {
                        job = newer;
                    }
                    let preview = renderer.render_doc(
                        &job.doc,
                        job.cursor_char,
                        &[],
                        None,
                        Mode::Preview,
                    );
                    let nav = renderer.render_doc(
                        &job.doc,
                        job.cursor_char,
                        &job.nav_path,
                        job.nav_filter.as_deref(),
                        Mode::Nav,
                    );
                    let ctx = job.ctx;
                    if tx_out
                        .send(RenderOutput {
                            revision: job.revision,
                            preview,
                            nav,
                        })
                        .is_ok()
                    {
                        ctx.request_repaint();
                    }
                }
            })
            .expect("failed to spawn latex-rust render worker");

        Self { tx_job, rx_out }
    }

    pub fn submit(&self, job: RenderJob) {
        let _ = self.tx_job.send(job);
    }

    pub fn poll_latest(&self) -> Option<RenderOutput> {
        let mut latest = None;
        while let Ok(out) = self.rx_out.try_recv() {
            latest = Some(out);
        }
        latest
    }
}

pub struct Renderer {
    font: MathFont,
    color_preamble: String,
    png_opts: PngOptions,
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
        }
    }

    pub fn render_doc(
        &self,
        doc: &ParsedDoc,
        cursor_char: usize,
        nav_path: &[String],
        nav_filter: Option<&str>,
        mode: Mode,
    ) -> Result<Rendered, String> {
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
        match self.render_latex(&latex_src) {
            Ok(rendered) => Ok(rendered),
            Err(_) => {
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
                self.render_latex(&fallback_src)
            }
        }
    }

    pub fn render_latex(&self, latex_src: &str) -> Result<Rendered, String> {
        let full_src = format!("{}{latex_src}", self.color_preamble);
        let png_bytes = latex_to_png(&full_src, &self.font, &self.png_opts)
            .map_err(|e| format!("{e} (src: {latex_src})"))?;
        let pixmap = Pixmap::decode_png(&png_bytes).map_err(|e| e.to_string())?;

        let inner_w = pixmap.width() as usize;
        let inner_h = pixmap.height() as usize;
        let out_w = inner_w + PAD_X_PX * 2;
        let out_h = inner_h + PAD_Y_PX * 2;

        let mut rgba = vec![0u8; out_w * out_h * 4];
        for px in rgba.chunks_exact_mut(4) {
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
        Ok(Rendered { image })
    }
}

#[cfg(test)]
mod tests {
    use super::{Mode, Renderer};
    use mathslot_core::command::{StructKind, SymbolCmd};
    use mathslot_core::library::{CustomFormat, UserLibrary};
    use mathslot_core::parser::{parse, parse_with_library};

    #[test]
    fn test_all_structs_and_symbols_compile_in_latex_rust() {
        let renderer = Renderer::new();

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

        // 2. 验证用户自定义任意未收录外部宏包指令（如 `\myExoticPkgMacro{$1}{$2}`）时，桌面端预览优雅降级绝不报错
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
        .unwrap();
        let doc = parse_with_library("▸kza+b;c;", &lib);
        for mode in [Mode::Preview, Mode::Nav] {
            let rendered = renderer
                .render_doc(&doc, 5, &[], None, mode)
                .expect("exotic user macro should gracefully fallback in preview");
            assert!(rendered.image.size[0] > 0);
        }
    }
}

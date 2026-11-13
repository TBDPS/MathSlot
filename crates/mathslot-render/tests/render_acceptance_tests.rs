use mathslot_render::{
    BackendKind, DebounceGate, ErrorSummary, Generation, GenerationTracker, MathRenderer,
    RenderCache, RenderCacheKey, RenderData, RenderDiagnostic, RenderError, RenderFormat, RenderId,
    RenderMode, RenderOutput, RenderPipeline, RenderRequest, Size2D, Theme, fit_to_box,
    fit_to_width, true_scale_percent,
};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

fn make_request(id: u64, gen_num: u64, latex: &str) -> RenderRequest {
    RenderRequest {
        id: RenderId(id),
        generation: Generation(gen_num),
        mode: RenderMode::Preview,
        latex: latex.to_owned(),
        theme: Theme::Light,
        scale: 1.0,
        format: RenderFormat::Svg,
        backend: BackendKind::Mock,
    }
}

struct MockBackend {
    calls: AtomicUsize,
    fail_on_exotic: bool,
    advance_tracker_during_render: Option<(Arc<GenerationTracker>, Generation)>,
}

impl MockBackend {
    fn ok_only() -> Self {
        Self {
            calls: AtomicUsize::new(0),
            fail_on_exotic: false,
            advance_tracker_during_render: None,
        }
    }

    fn call_count(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl MathRenderer for MockBackend {
    fn render(&self, req: &RenderRequest) -> Result<RenderOutput, RenderError> {
        self.calls.fetch_add(1, Ordering::SeqCst);

        if let Some((tracker, trigger_gen)) = &self.advance_tracker_during_render
            && req.generation == *trigger_gen
        {
            // Simulate newer keystrokes arriving while a slow render is in flight
            let _newer = tracker.next();
        }

        if self.fail_on_exotic && req.latex.contains("\\myExoticPkgMacro") {
            return Err(RenderError::RenderFailed {
                code: "UNKNOWN_MACRO".to_owned(),
                message: "Undefined control sequence \\myExoticPkgMacro".to_owned(),
                latex_source: req.latex.clone(),
            });
        }

        Ok(RenderOutput {
            id: req.id,
            generation: req.generation,
            output: RenderData::Svg(format!(
                "<svg data-gen=\"{}\">{}</svg>",
                req.generation.0, req.latex
            )),
            // Even if a fallback backend mistakenly reports degraded: false
            // and empty diagnostics, RenderPipeline MUST enforce degraded: true + non-empty diagnostics.
            degraded: false,
            diagnostics: Vec::new(),
            cache_hit: false,
        })
    }
}

/// A-RENDER-001 (D-003, INV-013):
/// Wide formula (1200x300) in a 400x100 viewport fits width by default (display_size.width <= 400.0);
/// ActualScale sets left_aligned == true & scrollable_x == true;
/// true_scale_percent(1.25) == 125 (never * 80.0).
#[test]
fn a_render_001_wide_formula_fits_width_and_actual_scale_scrolls_left_aligned() {
    let wide = Size2D::new(1200.0, 300.0);

    let default_fit = fit_to_width(wide, 400.0, None);
    assert!(
        default_fit.display_size.width <= 400.0,
        "Default fit-to-width must keep wide formula within 400.0, got {}",
        default_fit.display_size.width
    );
    assert!(
        (default_fit.display_size.height - 100.0).abs() < 0.5,
        "Aspect ratio must be preserved (1200x300 -> 400x100), got {:?}",
        default_fit.display_size
    );
    assert!(!default_fit.scrollable_x);
    assert!(!default_fit.left_aligned);

    let actual_fit = fit_to_width(wide, 400.0, Some(1.0));
    assert!(
        actual_fit.left_aligned,
        "Oversized actual-scale preview must be left-aligned"
    );
    assert!(
        actual_fit.scrollable_x,
        "Oversized actual-scale preview must enable horizontal scroll"
    );
    assert!((actual_fit.display_size.width - 1200.0).abs() < 0.01);

    assert_eq!(true_scale_percent(1.0), 100);
    assert_eq!(true_scale_percent(1.25), 125);
}

/// A-RENDER-002 (D-008, INV-013):
/// Large 3x3/4x4 matrix nav box (800x260) inside (440, 52) fits strictly within max_w & max_h
/// preserving aspect ratio so it never overlaps badge/button rects.
#[test]
fn a_render_002_matrix_nav_box_strictly_bounded_and_aspect_preserved() {
    let matrix_nav = Size2D::new(800.0, 260.0);
    let fit = fit_to_box(matrix_nav, 440.0, 52.0, 1.15);

    assert!(
        fit.display_size.width <= 440.0,
        "Nav width {} exceeded 440.0",
        fit.display_size.width
    );
    assert!(
        fit.display_size.height <= 52.0,
        "Nav height {} exceeded 52.0",
        fit.display_size.height
    );
    let expected_ratio = 800.0 / 260.0;
    let actual_ratio = fit.display_size.width / fit.display_size.height;
    assert!(
        (expected_ratio - actual_ratio).abs() < 0.01,
        "Aspect ratio drifted: expected {expected_ratio}, got {actual_ratio}"
    );
}

/// A-RENDER-003 (D-011, INV-012):
/// Fallback after primary macro error produces RenderOutput { degraded: true, diagnostics: [non-empty], .. }.
#[test]
fn a_render_003_fallback_never_silent_and_emits_degraded_diagnostics() {
    let tracker = Arc::new(GenerationTracker::new());
    let generation = tracker.next();

    let primary = Arc::new(MockBackend {
        calls: AtomicUsize::new(0),
        fail_on_exotic: true,
        advance_tracker_during_render: None,
    });
    let fallback = Arc::new(MockBackend {
        calls: AtomicUsize::new(0),
        fail_on_exotic: false,
        advance_tracker_during_render: None,
    });

    let pipeline = RenderPipeline::new(primary, tracker, 32).with_fallback(fallback);
    let req = make_request(1, generation.0, r"\myExoticPkgMacro{a+b}{c}");
    let out = pipeline
        .render(&req)
        .expect("fallback render should succeed");

    assert!(
        out.degraded,
        "Fallback output MUST set degraded = true (INV-012)"
    );
    assert!(
        !out.diagnostics.is_empty(),
        "Fallback output MUST carry non-empty diagnostics explaining primary cause"
    );
    assert!(
        out.diagnostics
            .iter()
            .any(|d| d.message.contains("myExoticPkgMacro") || d.code == "UNKNOWN_MACRO"),
        "Diagnostics must reference primary cause: {:?}",
        out.diagnostics
    );
}

/// A-RENDER-004 (D-019):
/// - 100 rapid generation updates cancel stale requests (never overwrite latest).
/// - Identical (mode, latex, theme, scale, backend, format) hits cache without re-invoking backend;
///   changing any dimension misses cache.
/// - DebounceGate deterministic on pure now_ms without wall-clock sleep.
#[test]
fn a_render_004_generation_cancellation_cache_key_and_debounce_gate() {
    // 1. 100 rapid generation updates + stale slow render cancellation
    let tracker = Arc::new(GenerationTracker::new());
    let mut gens = Vec::new();
    for _ in 0..100 {
        gens.push(tracker.next());
    }
    let stale_gen = gens[9];
    let latest_gen = gens[99];

    let primary = Arc::new(MockBackend::ok_only());
    let pipeline = RenderPipeline::new(primary.clone(), tracker.clone(), 64);

    let stale_req = make_request(10, stale_gen.0, r"\frac{a}{b}");
    let stale_res = pipeline.render(&stale_req);
    assert!(
        matches!(stale_res, Err(RenderError::Cancelled { generation, .. }) if generation == stale_gen),
        "Stale generation 10 must be cancelled when latest is 100, got {stale_res:?}"
    );
    assert_eq!(
        primary.call_count(),
        0,
        "Cancelled request must not invoke backend"
    );

    // Also test cancellation detected mid-flight (before commit)
    let tracker2 = Arc::new(GenerationTracker::new());
    let g1 = tracker2.next();
    let inflight_backend = Arc::new(MockBackend {
        calls: AtomicUsize::new(0),
        fail_on_exotic: false,
        advance_tracker_during_render: Some((tracker2.clone(), g1)),
    });
    let pipeline2 = RenderPipeline::new(inflight_backend, tracker2, 64);
    let midflight_res = pipeline2.render(&make_request(1, g1.0, "x+y"));
    assert!(
        matches!(midflight_res, Err(RenderError::Cancelled { .. })),
        "In-flight request superseded before commit must return Cancelled, got {midflight_res:?}"
    );

    // 2. Cache hit on identical 6-tuple; miss on changing any dimension
    let latest_req = make_request(100, latest_gen.0, r"\int_0^1 x^2 dx");
    let first = pipeline.render(&latest_req).expect("first render succeeds");
    assert!(!first.cache_hit);
    assert_eq!(primary.call_count(), 1);

    let second = pipeline
        .render(&latest_req)
        .expect("cached render succeeds");
    assert!(second.cache_hit, "Identical request must hit RenderCache");
    assert_eq!(
        primary.call_count(),
        1,
        "Cache hit must not re-invoke backend"
    );

    // Mutate each of the 6 key dimensions and confirm cache miss
    let mut diff_mode = latest_req.clone();
    diff_mode.mode = RenderMode::Nav;
    assert!(!pipeline.render(&diff_mode).expect("ok").cache_hit);

    let mut diff_latex = latest_req.clone();
    diff_latex.latex = r"\int_0^2 x^2 dx".to_owned();
    assert!(!pipeline.render(&diff_latex).expect("ok").cache_hit);

    let mut diff_theme = latest_req.clone();
    diff_theme.theme = Theme::Dark;
    assert!(!pipeline.render(&diff_theme).expect("ok").cache_hit);

    let mut diff_scale = latest_req.clone();
    diff_scale.scale = 1.5;
    assert!(!pipeline.render(&diff_scale).expect("ok").cache_hit);

    let mut diff_backend = latest_req.clone();
    diff_backend.backend = BackendKind::LatexRust;
    assert!(!pipeline.render(&diff_backend).expect("ok").cache_hit);

    let mut diff_format = latest_req.clone();
    diff_format.format = RenderFormat::Png;
    assert!(!pipeline.render(&diff_format).expect("ok").cache_hit);

    assert_eq!(primary.call_count(), 7);

    // Bounded LRU eviction check
    let mut cache = RenderCache::new(2);
    let k1 = RenderCacheKey::new(
        RenderMode::Preview,
        "a",
        Theme::Light,
        1.0,
        BackendKind::Mock,
        RenderFormat::Svg,
    );
    let k2 = RenderCacheKey::new(
        RenderMode::Preview,
        "b",
        Theme::Light,
        1.0,
        BackendKind::Mock,
        RenderFormat::Svg,
    );
    let k3 = RenderCacheKey::new(
        RenderMode::Preview,
        "c",
        Theme::Light,
        1.0,
        BackendKind::Mock,
        RenderFormat::Svg,
    );
    assert_ne!(k1.content_hash(), k2.content_hash());
    cache.insert(k1.clone(), RenderData::Svg("1".into()), false, vec![]);
    cache.insert(k2.clone(), RenderData::Svg("2".into()), false, vec![]);
    assert!(cache.get(&k1).is_some()); // touch k1 so k2 is LRU
    cache.insert(k3.clone(), RenderData::Svg("3".into()), false, vec![]);
    assert_eq!(cache.len(), 2);
    assert!(cache.get(&k2).is_none(), "LRU entry k2 should be evicted");
    assert!(cache.get(&k1).is_some());
    assert!(cache.get(&k3).is_some());

    // 3. Deterministic DebounceGate without wall-clock sleep
    let mut gate = DebounceGate::with_max_wait(50, 150);
    assert!(!gate.should_dispatch(0));
    gate.mark_dirty(100);
    assert!(!gate.should_dispatch(120));
    assert!(gate.should_dispatch(150));
    gate.mark_dispatched(150);
    assert!(!gate.should_dispatch(150));

    // Continuous rapid typing (every 10ms) still dispatches within max_wait budget (150ms)
    gate.mark_dirty(200);
    for t in (210..=340).step_by(10) {
        gate.mark_dirty(t);
        assert!(
            !gate.should_dispatch(t),
            "should hold before max_wait at {t}"
        );
    }
    assert!(
        gate.should_dispatch(350),
        "max_wait must prevent starvation at 350ms"
    );
}

/// A-RENDER-005 (D-010):
/// 500-char failing LaTeX yields header_summary.chars().count() <= 120 single-line,
/// source_excerpt truncated to <= 200 chars with "…（已截断）", and intact full_detail.
#[test]
fn a_render_005_error_summary_bounded_header_and_source_excerpt() {
    let long_latex: String = (0..500)
        .map(|i| char::from(b'a' + (i % 26) as u8))
        .collect();
    let multiline_msg = "Syntax error near token \\frac\nline 2 details\r\nmore noisy backend trace that should be compacted into a single line summary without overflowing the header toolbar buttons at all";

    let summary = ErrorSummary::from_error("LATEX_ERR", multiline_msg, &long_latex)
        .with_diagnostics(&[RenderDiagnostic::new("D1", "extra diagnostic detail")]);

    assert!(
        summary.header_summary.chars().count() <= 120,
        "header_summary length {} exceeded 120 chars: {}",
        summary.header_summary.chars().count(),
        summary.header_summary
    );
    assert!(
        !summary.header_summary.contains('\n') && !summary.header_summary.contains('\r'),
        "header_summary must be single-line: {:?}",
        summary.header_summary
    );
    assert!(summary.truncated);
    assert!(
        summary.source_excerpt.chars().count() <= 200,
        "source_excerpt length {} exceeded 200 chars",
        summary.source_excerpt.chars().count()
    );
    assert!(
        summary.source_excerpt.ends_with("…（已截断）"),
        "source_excerpt must end with truncation marker: {}",
        summary.source_excerpt
    );
    assert!(
        summary.full_detail.contains(&long_latex),
        "full_detail must preserve complete unclipped source for copying"
    );
    assert!(summary.full_detail.contains("extra diagnostic detail"));
}

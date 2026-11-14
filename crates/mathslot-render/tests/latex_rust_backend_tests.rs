use mathslot_render::{
    BackendKind, Generation, GenerationTracker, LatexRustSvgBackend, MathRenderer, RenderData,
    RenderError, RenderFormat, RenderId, RenderMode, RenderOutput, RenderPipeline, RenderRequest,
    Theme,
};
use std::sync::Arc;

fn make_latex_rust_req(id: u64, gen_num: u64, latex: &str, theme: Theme) -> RenderRequest {
    RenderRequest {
        id: RenderId(id),
        generation: Generation(gen_num),
        mode: RenderMode::Preview,
        latex: latex.to_owned(),
        theme,
        scale: 1.0,
        format: RenderFormat::Svg,
        backend: BackendKind::LatexRust,
    }
}

struct FailingMathJaxPrimary;

impl MathRenderer for FailingMathJaxPrimary {
    fn render(&self, req: &RenderRequest) -> Result<RenderOutput, RenderError> {
        Err(RenderError::RenderFailed {
            code: "MATHJAX_UNAVAILABLE".to_owned(),
            message: "Primary MathJax runtime unavailable offline".to_owned(),
            latex_source: req.latex.clone(),
        })
    }
}

#[test]
fn d113_latex_rust_svg_backend_renders_frac_and_respects_theme() {
    let backend = LatexRustSvgBackend::new();

    let light_out = backend
        .render(&make_latex_rust_req(1, 1, r"\frac{1}{2}", Theme::Light))
        .expect("LatexRustSvgBackend must render \\frac{1}{2} in light theme");
    let dark_out = backend
        .render(&make_latex_rust_req(2, 2, r"\frac{1}{2}", Theme::Dark))
        .expect("LatexRustSvgBackend must render \\frac{1}{2} in dark theme");

    let light_svg = match light_out.output {
        RenderData::Svg(svg) => svg,
        other => panic!("expected SVG output, got {other:?}"),
    };
    let dark_svg = match dark_out.output {
        RenderData::Svg(svg) => svg,
        other => panic!("expected SVG output, got {other:?}"),
    };

    assert!(light_svg.contains("<svg"), "expected <svg in light output");
    assert!(
        light_svg.contains("<path"),
        "expected <path glyph outlines in light SVG"
    );
    assert!(dark_svg.contains("<svg"), "expected <svg in dark output");
    assert_ne!(
        light_svg, dark_svg,
        "Light and Dark themes must produce distinct foreground colors in SVG"
    );
    assert!(!light_out.degraded);
    assert!(light_out.diagnostics.is_empty());
}

#[test]
fn d113_latex_rust_svg_backend_fails_explicitly_and_pipeline_marks_degraded() {
    let backend = LatexRustSvgBackend::new();

    let err = backend
        .render(&make_latex_rust_req(
            3,
            3,
            r"\myExoticPkgMacro{a}{b}",
            Theme::Light,
        ))
        .expect_err("Unsupported macro must return RenderError::RenderFailed");
    assert!(
        matches!(err, RenderError::RenderFailed { .. }),
        "expected RenderFailed, got {err:?}"
    );

    let parse_err = backend
        .render(&make_latex_rust_req(4, 4, r"\frac{1}{", Theme::Light))
        .expect_err("Malformed TeX must return RenderError::RenderFailed");
    assert!(
        matches!(parse_err, RenderError::RenderFailed { .. }),
        "expected RenderFailed, got {parse_err:?}"
    );

    // When used as RenderPipeline fallback behind a failing primary, pipeline MUST mark degraded + diagnostics
    let tracker = Arc::new(GenerationTracker::new());
    let generation = tracker.next();
    let pipeline = RenderPipeline::new(Arc::new(FailingMathJaxPrimary), tracker, 16)
        .with_fallback(Arc::new(LatexRustSvgBackend::new()));

    let out = pipeline
        .render(&make_latex_rust_req(
            5,
            generation.0,
            r"\frac{1}{2}",
            Theme::Light,
        ))
        .expect("RenderPipeline fallback to LatexRustSvgBackend must succeed");

    assert!(
        out.degraded,
        "Fallback output MUST set degraded = true (INV-012)"
    );
    assert!(
        !out.diagnostics.is_empty(),
        "Fallback output MUST include primary error diagnostics"
    );
    assert!(
        matches!(out.output, RenderData::Svg(ref s) if s.contains("<svg")),
        "Fallback output must carry valid SVG"
    );
}

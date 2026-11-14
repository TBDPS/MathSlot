use crate::error::RenderError;
use crate::pipeline::MathRenderer;
use crate::types::{RenderData, RenderFormat, RenderMode, RenderOutput, RenderRequest, Theme};
use latex_rust::{
    Color, Dim, Error as LatexRustError, MathFont, ParseError, SvgOptions, latex_to_svg,
};
use std::sync::OnceLock;

fn shared_stix_font() -> Result<&'static MathFont, RenderError> {
    static FONT: OnceLock<Result<MathFont, String>> = OnceLock::new();
    let res = FONT.get_or_init(|| MathFont::stix_two_math().map_err(|e| e.to_string()));
    res.as_ref().map_err(|msg| RenderError::RenderFailed {
        code: "FONT_LOAD_FAILED".to_owned(),
        message: msg.clone(),
        latex_source: String::new(),
    })
}

fn theme_foreground_color(theme: Theme) -> Color {
    match theme {
        Theme::Light => Color::rgb(15, 23, 42),
        Theme::Dark => Color::rgb(248, 250, 252),
        Theme::HighContrast => Color::rgb(255, 255, 255),
    }
}

fn map_latex_rust_error_code(err: &LatexRustError) -> &'static str {
    match err {
        LatexRustError::Parse(ParseError::Unknown(_)) => "UNKNOWN_MACRO",
        LatexRustError::Parse(ParseError::Unsupported(_)) | LatexRustError::Unsupported { .. } => {
            "UNSUPPORTED_SYNTAX"
        }
        LatexRustError::Parse(_) => "LATEX_PARSE_ERROR",
        LatexRustError::Font(_) => "FONT_ERROR",
        LatexRustError::Malformed { .. } => "MALFORMED_LATEX",
        LatexRustError::InvalidOption { .. } => "INVALID_OPTION",
    }
}

/// Native offline fallback SVG renderer backed by `latex-rust` and STIX Two Math (`D-113`).
#[derive(Debug, Clone, Copy, Default)]
pub struct LatexRustSvgBackend;

impl LatexRustSvgBackend {
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl MathRenderer for LatexRustSvgBackend {
    fn render(&self, req: &RenderRequest) -> Result<RenderOutput, RenderError> {
        if req.format != RenderFormat::Svg {
            return Err(RenderError::RenderFailed {
                code: "UNSUPPORTED_FORMAT".to_owned(),
                message: format!(
                    "LatexRustSvgBackend only supports SVG format, requested {:?}",
                    req.format
                ),
                latex_source: req.latex.clone(),
            });
        }

        if req.latex.trim().is_empty() {
            return Ok(RenderOutput {
                id: req.id,
                generation: req.generation,
                output: RenderData::Svg(
                    r#"<svg xmlns="http://www.w3.org/2000/svg" width="0pt" height="0pt" viewBox="0 0 0 0"></svg>"#
                        .to_owned(),
                ),
                degraded: false,
                diagnostics: Vec::new(),
                cache_hit: false,
            });
        }

        let font = shared_stix_font()?;
        let clamped_scale = if req.scale.is_finite() {
            req.scale.clamp(0.25, 4.0)
        } else {
            1.0
        };
        let scaled_hundredths = (14.0_f64 * f64::from(clamped_scale) * 100.0).round() as i64;
        let mut options = SvgOptions::new();
        options.font_size_pt = Dim::ratio(scaled_hundredths.max(100), 100);
        options.color = theme_foreground_color(req.theme);
        options.display = matches!(req.mode, RenderMode::Preview);

        match latex_to_svg(&req.latex, font, &options) {
            Ok(svg) => Ok(RenderOutput {
                id: req.id,
                generation: req.generation,
                output: RenderData::Svg(svg),
                degraded: false,
                diagnostics: Vec::new(),
                cache_hit: false,
            }),
            Err(err) => Err(RenderError::RenderFailed {
                code: map_latex_rust_error_code(&err).to_owned(),
                message: err.to_string(),
                latex_source: req.latex.clone(),
            }),
        }
    }
}

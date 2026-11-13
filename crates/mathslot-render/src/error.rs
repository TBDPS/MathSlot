use crate::types::{Generation, RenderId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderDiagnostic {
    pub code: String,
    pub message: String,
    pub source_excerpt: Option<String>,
    pub detail: Option<String>,
    pub syntax_diagnostics: Vec<mathslot_syntax::Diagnostic>,
}

impl RenderDiagnostic {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            source_excerpt: None,
            detail: None,
            syntax_diagnostics: Vec::new(),
        }
    }

    pub fn with_source_excerpt(mut self, excerpt: impl Into<String>) -> Self {
        self.source_excerpt = Some(excerpt.into());
        self
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn with_syntax_diagnostics(mut self, diags: Vec<mathslot_syntax::Diagnostic>) -> Self {
        self.syntax_diagnostics = diags;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize, Deserialize)]
pub enum RenderError {
    #[error("render cancelled (id={}, generation={})", id.0, generation.0)]
    Cancelled {
        id: RenderId,
        generation: Generation,
    },

    #[error("render failed [{code}]: {message}")]
    RenderFailed {
        code: String,
        message: String,
        latex_source: String,
    },

    #[error("render worker channel closed")]
    ChannelClosed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorSummary {
    pub code: String,
    pub header_summary: String,
    pub source_excerpt: String,
    pub truncated: bool,
    pub full_detail: String,
}

fn normalize_single_line(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_space = false;
    for ch in input.chars() {
        let mapped = match ch {
            '\r' | '\n' | '\t' => ' ',
            other => other,
        };
        if mapped.is_whitespace() {
            if !prev_space && !out.is_empty() {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(mapped);
            prev_space = false;
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

impl ErrorSummary {
    pub const HEADER_MAX_CHARS: usize = 120;
    pub const SOURCE_MAX_CHARS: usize = 200;
    pub const TRUNCATED_SUFFIX: &'static str = "…（已截断）";

    pub fn from_error(code: &str, message: &str, source: &str) -> Self {
        let clean_code = normalize_single_line(code);
        let clean_msg = normalize_single_line(message);

        let raw_header = if clean_code.is_empty() {
            clean_msg
        } else if clean_msg.is_empty() {
            format!("[{clean_code}]")
        } else {
            format!("[{clean_code}] {clean_msg}")
        };

        let header_summary = if raw_header.chars().count() > Self::HEADER_MAX_CHARS {
            let mut truncated_header: String = raw_header
                .chars()
                .take(Self::HEADER_MAX_CHARS - 1)
                .collect();
            truncated_header.push('…');
            truncated_header
        } else {
            raw_header
        };

        let suffix_len = Self::TRUNCATED_SUFFIX.chars().count();
        let (source_excerpt, truncated) = if source.chars().count() > Self::SOURCE_MAX_CHARS {
            let keep = Self::SOURCE_MAX_CHARS.saturating_sub(suffix_len);
            let prefix: String = source.chars().take(keep).collect();
            (format!("{prefix}{}", Self::TRUNCATED_SUFFIX), true)
        } else {
            (source.to_owned(), false)
        };

        let full_detail = if source.is_empty() {
            format!("[{clean_code}] {message}")
        } else {
            format!("[{clean_code}] {message}\n源码:\n{source}")
        };

        Self {
            code: clean_code,
            header_summary,
            source_excerpt,
            truncated,
            full_detail,
        }
    }

    pub fn from_render_error(err: &RenderError) -> Self {
        match err {
            RenderError::Cancelled { id, generation } => Self::from_error(
                "CANCELLED",
                &format!(
                    "render cancelled (id={}, generation={})",
                    id.0, generation.0
                ),
                "",
            ),
            RenderError::RenderFailed {
                code,
                message,
                latex_source,
            } => Self::from_error(code, message, latex_source),
            RenderError::ChannelClosed => {
                Self::from_error("CHANNEL_CLOSED", "render worker channel closed", "")
            }
        }
    }

    pub fn with_diagnostics(mut self, diagnostics: &[RenderDiagnostic]) -> Self {
        for diag in diagnostics {
            self.full_detail
                .push_str(&format!("\n- [{}] {}", diag.code, diag.message));
            if let Some(detail) = &diag.detail {
                self.full_detail.push_str(&format!("\n  {detail}"));
            }
        }
        self
    }
}

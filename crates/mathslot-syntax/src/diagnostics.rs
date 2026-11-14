use crate::span::Span;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize, Deserialize)]
pub enum SyntaxErrorKind {
    #[error("Unexpected token: {0}")]
    UnexpectedToken(String),

    #[error("Expected {expected}, but found {found}")]
    ExpectedToken { expected: String, found: String },

    #[error("Unclosed delimiter: {0}")]
    UnclosedDelimiter(String),

    #[error("Unmatched delimiter: {0}")]
    UnmatchedDelimiter(String),

    #[error("Unclosed environment: {0}")]
    UnclosedEnvironment(String),

    #[error("Mismatched environment: expected \\end{{{expected}}}, found \\end{{{found}}}")]
    MismatchedEnvironment { expected: String, found: String },

    #[error("Unsupported environment: \\begin{{{0}}}")]
    UnsupportedEnvironment(String),

    #[error("Maximum nesting depth ({0}) exceeded")]
    DepthExceeded(usize),

    #[error("Outer math delimiters ({open} ... {close}) stripped")]
    OuterDelimitersStripped { open: String, close: String },

    #[error("Empty group or block")]
    EmptyBlock,

    #[error("Unknown LaTeX macro: \\{0}")]
    UnknownMacro(String),

    #[error("General parse error: {0}")]
    Custom(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub kind: SyntaxErrorKind,
    pub span: Span,
    pub is_warning: bool,
}

impl Diagnostic {
    #[inline]
    pub fn is_info(&self) -> bool {
        matches!(self.kind, SyntaxErrorKind::OuterDelimitersStripped { .. })
    }

    #[inline]
    pub fn is_error(&self) -> bool {
        !self.is_warning && !self.is_info()
    }

    #[inline]
    pub fn is_warning(&self) -> bool {
        self.is_warning
    }

    pub fn info(kind: SyntaxErrorKind, span: Span) -> Self {
        Self {
            kind,
            span,
            is_warning: false,
        }
    }

    pub fn error(kind: SyntaxErrorKind, span: Span) -> Self {
        Self {
            kind,
            span,
            is_warning: false,
        }
    }

    pub fn warning(kind: SyntaxErrorKind, span: Span) -> Self {
        Self {
            kind,
            span,
            is_warning: true,
        }
    }

    pub fn unclosed_delimiter(delim: &str, span: Span) -> Self {
        Self::error(SyntaxErrorKind::UnclosedDelimiter(delim.to_string()), span)
    }

    pub fn unmatched_delimiter(delim: &str, span: Span) -> Self {
        Self::error(SyntaxErrorKind::UnmatchedDelimiter(delim.to_string()), span)
    }

    pub fn unclosed_env(env: &str, span: Span) -> Self {
        Self::error(SyntaxErrorKind::UnclosedEnvironment(env.to_string()), span)
    }

    pub fn mismatched_env(expected: &str, found: &str, span: Span) -> Self {
        Self::error(
            SyntaxErrorKind::MismatchedEnvironment {
                expected: expected.to_string(),
                found: found.to_string(),
            },
            span,
        )
    }

    pub fn unsupported_env(env: &str, span: Span) -> Self {
        Self::warning(
            SyntaxErrorKind::UnsupportedEnvironment(env.to_string()),
            span,
        )
    }

    pub fn unknown_macro(name: &str, span: Span) -> Self {
        Self::warning(SyntaxErrorKind::UnknownMacro(name.to_string()), span)
    }
}

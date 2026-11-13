use crate::error::RenderDiagnostic;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RenderId(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Generation(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RenderMode {
    Preview,
    Nav,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Theme {
    Light,
    Dark,
    HighContrast,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RenderFormat {
    Svg,
    Png,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BackendKind {
    MathJaxSvg,
    LatexRust,
    Mock,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RenderData {
    Svg(String),
    Png {
        width: u32,
        height: u32,
        bytes: Vec<u8>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderRequest {
    pub id: RenderId,
    pub generation: Generation,
    pub mode: RenderMode,
    pub latex: String,
    pub theme: Theme,
    pub scale: f32,
    pub format: RenderFormat,
    pub backend: BackendKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderOutput {
    pub id: RenderId,
    pub generation: Generation,
    pub output: RenderData,
    pub degraded: bool,
    pub diagnostics: Vec<RenderDiagnostic>,
    pub cache_hit: bool,
}

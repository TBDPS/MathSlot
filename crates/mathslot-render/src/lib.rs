#![forbid(unsafe_code)]

pub mod cache;
pub mod cancel;
pub mod error;
pub mod fit;
pub mod pipeline;
pub mod types;

pub use cache::{CacheStats, CachedRender, RenderCache, RenderCacheKey};
pub use cancel::{DebounceGate, GenerationTracker};
pub use error::{ErrorSummary, RenderDiagnostic, RenderError};
pub use fit::{
    FitPolicy, FitResult, Size2D, fit_to_box, fit_to_width, fit_with_policy, true_scale_percent,
};
pub use pipeline::{MathRenderer, RenderPipeline};
pub use types::{
    BackendKind, Generation, RenderData, RenderFormat, RenderId, RenderMode, RenderOutput,
    RenderRequest, Theme,
};

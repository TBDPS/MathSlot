use crate::cache::{CacheStats, RenderCache, RenderCacheKey};
use crate::cancel::GenerationTracker;
use crate::error::{ErrorSummary, RenderDiagnostic, RenderError};
use crate::types::{RenderOutput, RenderRequest};
use std::sync::{Arc, Mutex};

pub trait MathRenderer: Send + Sync {
    fn render(&self, req: &RenderRequest) -> Result<RenderOutput, RenderError>;
}

pub struct RenderPipeline {
    primary: Arc<dyn MathRenderer>,
    fallback: Option<Arc<dyn MathRenderer>>,
    tracker: Arc<GenerationTracker>,
    cache: Mutex<RenderCache>,
}

impl RenderPipeline {
    pub fn new(
        primary: Arc<dyn MathRenderer>,
        tracker: Arc<GenerationTracker>,
        cache_capacity: usize,
    ) -> Self {
        Self {
            primary,
            fallback: None,
            tracker,
            cache: Mutex::new(RenderCache::new(cache_capacity)),
        }
    }

    pub fn with_fallback(mut self, fallback: Arc<dyn MathRenderer>) -> Self {
        self.fallback = Some(fallback);
        self
    }

    pub fn tracker(&self) -> &Arc<GenerationTracker> {
        &self.tracker
    }

    pub fn cache_stats(&self) -> CacheStats {
        match self.cache.lock() {
            Ok(guard) => guard.stats(),
            Err(poisoned) => poisoned.into_inner().stats(),
        }
    }

    pub fn clear_cache(&self) {
        let mut guard = match self.cache.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.clear();
    }

    fn lookup_cache(&self, key: &RenderCacheKey) -> Option<crate::cache::CachedRender> {
        let mut guard = match self.cache.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.get(key).cloned()
    }

    fn store_cache(&self, key: RenderCacheKey, output: &RenderOutput) {
        let mut guard = match self.cache.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.insert(
            key,
            output.output.clone(),
            output.degraded,
            output.diagnostics.clone(),
        );
    }
}

impl MathRenderer for RenderPipeline {
    fn render(&self, req: &RenderRequest) -> Result<RenderOutput, RenderError> {
        // 1. Check cancellation before starting
        self.tracker.check(req.id, req.generation)?;

        // 2. Check deterministic cache
        let key = RenderCacheKey::from_request(req);
        if let Some(cached) = self.lookup_cache(&key) {
            self.tracker.check(req.id, req.generation)?;
            return Ok(RenderOutput {
                id: req.id,
                generation: req.generation,
                output: cached.data,
                degraded: cached.degraded,
                diagnostics: cached.diagnostics,
                cache_hit: true,
            });
        }

        // 3. Check cancellation before primary backend
        self.tracker.check(req.id, req.generation)?;

        match self.primary.render(req) {
            Ok(mut out) => {
                // 4. Check cancellation before commit
                self.tracker.check(req.id, req.generation)?;
                out.id = req.id;
                out.generation = req.generation;
                out.cache_hit = false;
                self.store_cache(key, &out);
                Ok(out)
            }
            Err(err @ RenderError::Cancelled { .. }) => Err(err),
            Err(primary_err) => {
                // 5. Check cancellation between primary and fallback
                self.tracker.check(req.id, req.generation)?;

                let Some(fallback) = &self.fallback else {
                    return Err(primary_err);
                };

                match fallback.render(req) {
                    Ok(mut fb_out) => {
                        // 6. Check cancellation before committing fallback result
                        self.tracker.check(req.id, req.generation)?;

                        // INV-012: Fallback MUST be explicit with non-empty diagnostics
                        fb_out.degraded = true;
                        let summary = ErrorSummary::from_render_error(&primary_err);
                        let diag = RenderDiagnostic::new(summary.code, summary.header_summary)
                            .with_source_excerpt(summary.source_excerpt)
                            .with_detail(summary.full_detail);
                        fb_out.diagnostics.push(diag);

                        fb_out.id = req.id;
                        fb_out.generation = req.generation;
                        fb_out.cache_hit = false;
                        self.store_cache(key, &fb_out);
                        Ok(fb_out)
                    }
                    Err(err @ RenderError::Cancelled { .. }) => Err(err),
                    Err(fb_err) => Err(RenderError::RenderFailed {
                        code: "FALLBACK_FAILED".to_owned(),
                        message: format!("primary: {primary_err}; fallback: {fb_err}"),
                        latex_source: req.latex.clone(),
                    }),
                }
            }
        }
    }
}

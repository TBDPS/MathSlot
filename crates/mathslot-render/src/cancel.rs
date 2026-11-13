use crate::error::RenderError;
use crate::types::{Generation, RenderId};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Default)]
pub struct GenerationTracker {
    current: AtomicU64,
}

impl GenerationTracker {
    pub fn new() -> Self {
        Self {
            current: AtomicU64::new(0),
        }
    }

    pub fn next(&self) -> Generation {
        Generation(self.current.fetch_add(1, Ordering::SeqCst) + 1)
    }

    pub fn current(&self) -> Generation {
        Generation(self.current.load(Ordering::SeqCst))
    }

    pub fn is_current(&self, generation: Generation) -> bool {
        self.current.load(Ordering::SeqCst) == generation.0
    }

    pub fn set_current(&self, generation: Generation) {
        self.current.store(generation.0, Ordering::SeqCst);
    }

    pub fn check(&self, id: RenderId, generation: Generation) -> Result<(), RenderError> {
        if self.is_current(generation) {
            Ok(())
        } else {
            Err(RenderError::Cancelled { id, generation })
        }
    }
}

#[derive(Debug, Clone)]
pub struct DebounceGate {
    debounce_ms: u64,
    max_wait_ms: u64,
    dirty: bool,
    first_dirty_ms: u64,
    last_dirty_ms: u64,
    last_dispatch_ms: Option<u64>,
}

impl DebounceGate {
    pub fn new(debounce_ms: u64) -> Self {
        Self::with_max_wait(debounce_ms, 0)
    }

    pub fn with_max_wait(debounce_ms: u64, max_wait_ms: u64) -> Self {
        Self {
            debounce_ms,
            max_wait_ms,
            dirty: false,
            first_dirty_ms: 0,
            last_dirty_ms: 0,
            last_dispatch_ms: None,
        }
    }

    pub fn mark_dirty(&mut self, now_ms: u64) {
        if !self.dirty {
            self.dirty = true;
            self.first_dirty_ms = now_ms;
        }
        self.last_dirty_ms = now_ms;
    }

    pub fn should_dispatch(&self, now_ms: u64) -> bool {
        if !self.dirty {
            return false;
        }
        if now_ms.saturating_sub(self.last_dirty_ms) >= self.debounce_ms {
            return true;
        }
        if self.max_wait_ms > 0 && now_ms.saturating_sub(self.first_dirty_ms) >= self.max_wait_ms {
            return true;
        }
        false
    }

    pub fn mark_dispatched(&mut self, now_ms: u64) {
        self.dirty = false;
        self.last_dispatch_ms = Some(now_ms);
    }

    pub fn poll_dispatch(&mut self, now_ms: u64) -> bool {
        if self.should_dispatch(now_ms) {
            self.mark_dispatched(now_ms);
            true
        } else {
            false
        }
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn has_dispatched(&self) -> bool {
        self.last_dispatch_ms.is_some()
    }
}

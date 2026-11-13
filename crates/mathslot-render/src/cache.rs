use crate::error::RenderDiagnostic;
use crate::types::{BackendKind, RenderData, RenderFormat, RenderMode, RenderRequest, Theme};
use std::collections::{HashMap, VecDeque};

const FNV_OFFSET_BASIS_128: u128 = 0x6c62_272e_07bb_0142_62b8_2175_6295_c58d;
const FNV_PRIME_128: u128 = 0x0000_0000_0100_0000_0000_0000_0000_013b;

#[inline]
fn fnv1a_feed(hash: &mut u128, bytes: &[u8]) {
    for &b in bytes {
        *hash ^= u128::from(b);
        *hash = hash.wrapping_mul(FNV_PRIME_128);
    }
}

#[derive(Debug, Clone)]
pub struct RenderCacheKey {
    pub mode: RenderMode,
    pub latex: String,
    pub theme: Theme,
    pub scale_bits: u32,
    pub backend: BackendKind,
    pub format: RenderFormat,
    hash: u128,
}

impl PartialEq for RenderCacheKey {
    fn eq(&self, other: &Self) -> bool {
        self.mode == other.mode
            && self.latex == other.latex
            && self.theme == other.theme
            && self.scale_bits == other.scale_bits
            && self.backend == other.backend
            && self.format == other.format
    }
}

impl Eq for RenderCacheKey {}

impl RenderCacheKey {
    pub fn new(
        mode: RenderMode,
        latex: impl Into<String>,
        theme: Theme,
        scale: f32,
        backend: BackendKind,
        format: RenderFormat,
    ) -> Self {
        let latex = latex.into();
        let normalized = if scale == 0.0 { 0.0_f32 } else { scale };
        let scale_bits = normalized.to_bits();

        let mut hash = FNV_OFFSET_BASIS_128;
        let mode_tag = match mode {
            RenderMode::Preview => 0u8,
            RenderMode::Nav => 1u8,
        };
        let theme_tag = match theme {
            Theme::Light => 0u8,
            Theme::Dark => 1u8,
            Theme::HighContrast => 2u8,
        };
        let backend_tag = match backend {
            BackendKind::MathJaxSvg => 0u8,
            BackendKind::LatexRust => 1u8,
            BackendKind::Mock => 2u8,
        };
        let format_tag = match format {
            RenderFormat::Svg => 0u8,
            RenderFormat::Png => 1u8,
        };

        fnv1a_feed(&mut hash, &[mode_tag]);
        fnv1a_feed(&mut hash, &(latex.len() as u64).to_le_bytes());
        fnv1a_feed(&mut hash, latex.as_bytes());
        fnv1a_feed(&mut hash, &[theme_tag]);
        fnv1a_feed(&mut hash, &scale_bits.to_le_bytes());
        fnv1a_feed(&mut hash, &[backend_tag]);
        fnv1a_feed(&mut hash, &[format_tag]);

        Self {
            mode,
            latex,
            theme,
            scale_bits,
            backend,
            format,
            hash,
        }
    }

    pub fn from_request(req: &RenderRequest) -> Self {
        Self::new(
            req.mode,
            req.latex.clone(),
            req.theme,
            req.scale,
            req.backend,
            req.format,
        )
    }

    pub fn content_hash(&self) -> u128 {
        self.hash
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedRender {
    pub data: RenderData,
    pub degraded: bool,
    pub diagnostics: Vec<RenderDiagnostic>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
    pub len: usize,
    pub capacity: usize,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    key: RenderCacheKey,
    value: CachedRender,
}

#[derive(Debug)]
pub struct RenderCache {
    capacity: usize,
    buckets: HashMap<u128, Vec<CacheEntry>>,
    lru: VecDeque<RenderCacheKey>,
    hits: u64,
    misses: u64,
    evictions: u64,
}

impl RenderCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            buckets: HashMap::new(),
            lru: VecDeque::new(),
            hits: 0,
            misses: 0,
            evictions: 0,
        }
    }

    fn touch_lru(&mut self, key: &RenderCacheKey) {
        if let Some(pos) = self.lru.iter().position(|existing| existing == key) {
            self.lru.remove(pos);
        }
        self.lru.push_back(key.clone());
    }

    pub fn get(&mut self, key: &RenderCacheKey) -> Option<&CachedRender> {
        let hash = key.content_hash();
        let found_idx = self
            .buckets
            .get(&hash)
            .and_then(|bucket| bucket.iter().position(|entry| &entry.key == key));

        if let Some(idx) = found_idx {
            self.hits += 1;
            self.touch_lru(key);
            return self
                .buckets
                .get(&hash)
                .and_then(|b| b.get(idx))
                .map(|e| &e.value);
        }

        self.misses += 1;
        None
    }

    pub fn insert(
        &mut self,
        key: RenderCacheKey,
        data: RenderData,
        degraded: bool,
        diagnostics: Vec<RenderDiagnostic>,
    ) {
        if self.capacity == 0 {
            return;
        }

        let hash = key.content_hash();
        let value = CachedRender {
            data,
            degraded,
            diagnostics,
        };

        let updated_existing = if let Some(bucket) = self.buckets.get_mut(&hash)
            && let Some(entry) = bucket.iter_mut().find(|e| e.key == key)
        {
            entry.value = value.clone();
            true
        } else {
            false
        };

        if updated_existing {
            self.touch_lru(&key);
            return;
        }

        while self.lru.len() >= self.capacity {
            if let Some(evicted) = self.lru.pop_front() {
                let ev_hash = evicted.content_hash();
                if let Some(bucket) = self.buckets.get_mut(&ev_hash) {
                    bucket.retain(|e| e.key != evicted);
                    if bucket.is_empty() {
                        self.buckets.remove(&ev_hash);
                    }
                }
                self.evictions += 1;
            }
        }

        self.buckets.entry(hash).or_default().push(CacheEntry {
            key: key.clone(),
            value,
        });
        self.lru.push_back(key);
    }

    pub fn len(&self) -> usize {
        self.lru.len()
    }

    pub fn is_empty(&self) -> bool {
        self.lru.is_empty()
    }

    pub fn clear(&mut self) {
        self.buckets.clear();
        self.lru.clear();
    }

    pub fn stats(&self) -> CacheStats {
        CacheStats {
            hits: self.hits,
            misses: self.misses,
            evictions: self.evictions,
            len: self.lru.len(),
            capacity: self.capacity,
        }
    }
}

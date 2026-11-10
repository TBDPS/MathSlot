use serde::{Deserialize, Serialize};

/// 源码字节区间定位（左闭右开 `[start, end)`）
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Span {
    /// 源码起始字节偏移 (0-indexed, inclusive)
    pub start: usize,
    /// 源码结束字节偏移 (exclusive)
    pub end: usize,
}

impl Span {
    pub const EMPTY: Self = Self { start: 0, end: 0 };

    #[inline]
    pub fn new(start: usize, end: usize) -> Self {
        debug_assert!(start <= end, "Span start ({start}) must be <= end ({end})");
        Self { start, end }
    }

    #[inline]
    pub fn point(offset: usize) -> Self {
        Self {
            start: offset,
            end: offset,
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.end.saturating_sub(self.start)
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.start >= self.end
    }

    #[inline]
    pub fn merge(&self, other: Span) -> Self {
        Self {
            start: self.start.min(other.start),
            end: self.end.max(other.end),
        }
    }

    #[inline]
    pub fn contains(&self, offset: usize) -> bool {
        offset >= self.start && offset < self.end
    }

    #[inline]
    pub fn contains_inclusive(&self, offset: usize) -> bool {
        offset >= self.start && offset <= self.end
    }
}

/// 携带源码 Span 的包装容器
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Spanned<T> {
    pub node: T,
    pub span: Span,
}

impl<T> Spanned<T> {
    #[inline]
    pub fn new(node: T, span: Span) -> Self {
        Self { node, span }
    }

    #[inline]
    pub fn map<U, F: FnOnce(T) -> U>(self, f: F) -> Spanned<U> {
        Spanned {
            node: f(self.node),
            span: self.span,
        }
    }

    #[inline]
    pub fn as_ref(&self) -> Spanned<&T> {
        Spanned {
            node: &self.node,
            span: self.span,
        }
    }
}

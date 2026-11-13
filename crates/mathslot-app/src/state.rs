use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EditorState {
    Idle,
    PrefixRoot,
    PrefixSub { key: char },
    Jump { tail: String },
    Nav { path: Vec<String> },
    InvalidPrefix { key: char },
}

impl EditorState {
    #[must_use]
    pub fn is_idle(&self) -> bool {
        matches!(self, Self::Idle)
    }

    #[must_use]
    pub fn is_nav(&self) -> bool {
        matches!(self, Self::Nav { .. })
    }
}

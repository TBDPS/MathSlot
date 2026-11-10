use serde::{Deserialize, Serialize};

/// 描述在 AST 树中从根节点向下导航的路径坐标
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AstPath(pub Vec<usize>);

impl AstPath {
    pub fn new(steps: Vec<usize>) -> Self {
        Self(steps)
    }

    pub fn root() -> Self {
        Self(Vec::new())
    }

    pub fn child(&self, index: usize) -> Self {
        let mut steps = self.0.clone();
        steps.push(index);
        Self(steps)
    }

    pub fn parent(&self) -> Option<Self> {
        if self.0.is_empty() {
            None
        } else {
            let mut steps = self.0.clone();
            steps.pop();
            Some(Self(steps))
        }
    }

    pub fn is_root(&self) -> bool {
        self.0.is_empty()
    }

    pub fn depth(&self) -> usize {
        self.0.len()
    }

    pub fn as_slice(&self) -> &[usize] {
        &self.0
    }
}

impl From<Vec<usize>> for AstPath {
    fn from(steps: Vec<usize>) -> Self {
        Self(steps)
    }
}

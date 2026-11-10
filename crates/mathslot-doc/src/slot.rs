use crate::path::AstPath;
use mathslot_syntax::{SlotId, Span};
use serde::{Deserialize, Serialize};

/// 槽位语义角色
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SlotRole {
    Numerator,
    Denominator,
    Radicand,
    RootIndex,
    Subscript,
    Superscript,
    LowerBound,
    UpperBound,
    BigOpBody,
    MatrixCell { row: usize, col: usize },
    DelimitedBody,
    StyleBody,
    Placeholder,
}

/// 槽位描述符
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Slot {
    pub id: SlotId,
    pub role: SlotRole,
    pub path: AstPath,
    pub span: Span,
    pub is_empty: bool,
    pub label: Option<String>,
}

/// 文档级槽位索引表，支持高效双向光标穿梭与角色定位
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotTable {
    slots: Vec<Slot>,
}

impl SlotTable {
    pub fn new() -> Self {
        Self { slots: Vec::new() }
    }

    pub fn insert(&mut self, slot: Slot) {
        self.slots.push(slot);
    }

    pub fn slots(&self) -> &[Slot] {
        &self.slots
    }

    pub fn get(&self, id: SlotId) -> Option<&Slot> {
        self.slots.iter().find(|s| s.id == id)
    }

    pub fn get_mut(&mut self, id: SlotId) -> Option<&mut Slot> {
        self.slots.iter_mut().find(|s| s.id == id)
    }

    pub fn first_empty(&self) -> Option<SlotId> {
        self.slots.iter().find(|s| s.is_empty).map(|s| s.id)
    }

    pub fn next_slot(&self, current: SlotId) -> Option<SlotId> {
        if self.slots.is_empty() {
            return None;
        }
        let pos = self.slots.iter().position(|s| s.id == current)?;
        let next_pos = (pos + 1) % self.slots.len();
        Some(self.slots[next_pos].id)
    }

    pub fn prev_slot(&self, current: SlotId) -> Option<SlotId> {
        if self.slots.is_empty() {
            return None;
        }
        let pos = self.slots.iter().position(|s| s.id == current)?;
        let prev_pos = if pos == 0 {
            self.slots.len() - 1
        } else {
            pos - 1
        };
        Some(self.slots[prev_pos].id)
    }

    pub fn empty_count(&self) -> usize {
        self.slots.iter().filter(|s| s.is_empty).count()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }
}

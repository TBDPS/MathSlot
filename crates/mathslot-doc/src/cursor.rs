use crate::path::AstPath;
use mathslot_syntax::SlotId;
use serde::{Deserialize, Serialize};

/// 光标定位：支持槽位聚焦与树节点定位
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Cursor {
    AtStart,
    AtEnd,
    InSlot {
        slot_id: SlotId,
        offset: usize, // 槽位内部字符偏移
    },
    AtNode(AstPath),
}

/// 选区状态：当 anchor == focus 时表示退化单点光标 (caret)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Selection {
    pub anchor: Cursor,
    pub focus: Cursor,
}

impl Selection {
    #[must_use]
    pub fn caret(cursor: Cursor) -> Self {
        Self {
            anchor: cursor.clone(),
            focus: cursor,
        }
    }

    #[must_use]
    pub fn new(anchor: Cursor, focus: Cursor) -> Self {
        Self { anchor, focus }
    }

    #[must_use]
    pub fn is_collapsed(&self) -> bool {
        self.anchor == self.focus
    }

    #[must_use]
    pub fn cursor(&self) -> &Cursor {
        &self.focus
    }
}

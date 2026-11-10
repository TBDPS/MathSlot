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

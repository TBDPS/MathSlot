use crate::cursor::{Cursor, Selection};
use crate::document::Document;
use crate::transaction::{DocError, Edit, Intent, Transaction};

/// 基于 Intent 的确定性撤销/重做历史栈 (INV-008, INV-014)
#[derive(Debug, Clone)]
pub struct History {
    undo_list: Vec<Transaction>,
    redo_list: Vec<Transaction>,
    max_capacity: usize,
    coalesce_sealed: bool,
}

/// 兼容旧名 `UndoStack`，供冻结 crate (`mathslot-core`) 无缝重导出
pub type UndoStack = History;

impl Default for History {
    fn default() -> Self {
        Self::new(100)
    }
}

impl History {
    #[must_use]
    pub fn new(max_capacity: usize) -> Self {
        Self {
            undo_list: Vec::with_capacity(max_capacity),
            redo_list: Vec::new(),
            max_capacity,
            coalesce_sealed: false,
        }
    }

    #[must_use]
    pub fn with_capacity(max_capacity: usize) -> Self {
        Self::new(max_capacity)
    }

    #[must_use]
    pub fn can_undo(&self) -> bool {
        !self.undo_list.is_empty()
    }

    #[must_use]
    pub fn can_redo(&self) -> bool {
        !self.redo_list.is_empty()
    }

    #[must_use]
    pub fn undo_len(&self) -> usize {
        self.undo_list.len()
    }

    #[must_use]
    pub fn redo_len(&self) -> usize {
        self.redo_list.len()
    }

    #[must_use]
    pub fn undo_depth(&self) -> usize {
        self.undo_list.len()
    }

    #[must_use]
    pub fn redo_depth(&self) -> usize {
        self.redo_list.len()
    }

    #[must_use]
    pub fn intents(&self) -> Vec<Intent> {
        self.undo_list.iter().map(|tx| tx.intent).collect()
    }

    #[must_use]
    pub fn redo_intents(&self) -> Vec<Intent> {
        self.redo_list.iter().map(|tx| tx.intent).collect()
    }

    #[must_use]
    pub fn last_transaction(&self) -> Option<&Transaction> {
        self.undo_list.last()
    }

    pub fn break_coalesce(&mut self) {
        self.coalesce_sealed = true;
    }

    #[must_use]
    pub fn is_coalesce_sealed(&self) -> bool {
        self.coalesce_sealed
    }

    pub fn clear(&mut self) {
        self.undo_list.clear();
        self.redo_list.clear();
        self.coalesce_sealed = false;
    }

    /// 将新事务压入历史栈；严格按 Intent 与词/行/光标连续性决定是否合并，绝不使用时间窗 (INV-008)
    pub fn push(&mut self, tx: Transaction) {
        if tx.intent.is_nav() {
            // 导航意图绝不入历史栈，且不清除 redo 栈，同时封口后续输入合并
            self.coalesce_sealed = true;
            return;
        }

        self.redo_list.clear();
        let sealed = self.coalesce_sealed;
        self.coalesce_sealed = false;

        if !sealed && self.try_coalesce(&tx) {
            return;
        }

        if self.max_capacity == 0 {
            return;
        }
        if self.undo_list.len() >= self.max_capacity {
            self.undo_list.remove(0);
        }
        self.undo_list.push(tx);
    }

    fn try_coalesce(&mut self, tx: &Transaction) -> bool {
        let Some(last) = self.undo_list.last_mut() else {
            return false;
        };

        if last.breaks_word_or_line || tx.breaks_word_or_line {
            return false;
        }

        if last.cursor_after != tx.cursor_before || last.selection_after != tx.selection_before {
            return false;
        }

        if !last.selection_before.is_collapsed()
            || !last.selection_after.is_collapsed()
            || !tx.selection_before.is_collapsed()
            || !tx.selection_after.is_collapsed()
        {
            return false;
        }

        match (last.intent, tx.intent) {
            (Intent::Typing, Intent::Typing) => Self::try_coalesce_typing(last, tx),
            (Intent::Delete, Intent::Delete) => Self::try_coalesce_delete(last, tx),
            _ => false,
        }
    }

    fn try_coalesce_typing(last: &mut Transaction, tx: &Transaction) -> bool {
        if last.edits.len() != 1 || tx.edits.len() != 1 {
            return false;
        }

        let (
            Edit::InsertText {
                at: at1,
                text: text1,
            },
            Edit::InsertText {
                at: at2,
                text: text2,
            },
        ) = (&mut last.edits[0], &tx.edits[0])
        else {
            return false;
        };

        if text1.is_empty()
            || text2.is_empty()
            || text1.chars().any(char::is_whitespace)
            || text2.chars().any(char::is_whitespace)
        {
            return false;
        }

        match (at1, at2) {
            (
                Cursor::InSlot {
                    slot_id: id1,
                    offset: off1,
                },
                Cursor::InSlot {
                    slot_id: id2,
                    offset: off2,
                },
            ) => {
                if id1 != id2 || *off2 != *off1 + text1.chars().count() {
                    return false;
                }
                text1.push_str(text2);
            }
            (Cursor::AtEnd, Cursor::AtEnd) => {
                text1.push_str(text2);
            }
            (Cursor::AtStart, Cursor::AtStart) => {
                let mut combined = text2.clone();
                combined.push_str(text1);
                *text1 = combined;
            }
            _ => return false,
        }

        last.cursor_after = tx.cursor_after.clone();
        last.selection_after = tx.selection_after.clone();
        last.version_after = tx.version_after;
        last.timestamp_ms = tx.timestamp_ms;
        // 保持初始 inverse_edits，确保一次性撤销回整词输入前状态
        true
    }

    fn try_coalesce_delete(last: &mut Transaction, tx: &Transaction) -> bool {
        if last.edits.is_empty() || tx.edits.len() != 1 {
            return false;
        }

        let (
            Some(Edit::DeleteChar {
                at: at1,
                backward: b1,
            }),
            Edit::DeleteChar {
                at: at2,
                backward: b2,
            },
        ) = (last.edits.last(), &tx.edits[0])
        else {
            return false;
        };

        if b1 != b2 {
            return false;
        }

        let same_target = match (at1, at2) {
            (Cursor::InSlot { slot_id: id1, .. }, Cursor::InSlot { slot_id: id2, .. }) => {
                id1 == id2
            }
            (Cursor::AtEnd, Cursor::AtEnd) => *b1,
            (Cursor::AtStart, Cursor::AtStart) => !*b1,
            _ => false,
        };

        if !same_target {
            return false;
        }

        last.edits.push(tx.edits[0].clone());
        last.cursor_after = tx.cursor_after.clone();
        last.selection_after = tx.selection_after.clone();
        last.version_after = tx.version_after;
        last.timestamp_ms = tx.timestamp_ms;
        // 保持初始 inverse_edits，确保一次性撤销回全词删除前状态
        true
    }

    /// 执行撤销：按逆序回放逆操作并恢复选区；若应用编辑出错则回滚文档与栈帧并返回 Err
    pub fn undo(
        &mut self,
        doc: &mut Document,
        selection: &mut Selection,
    ) -> Result<bool, DocError> {
        let Some(tx) = self.undo_list.pop() else {
            return Ok(false);
        };

        let snapshot_nodes = doc.nodes.clone();
        let snapshot_version = doc.version;
        let snapshot_slots = doc.slots.clone();

        for edit in tx.inverse_edits.iter().rev() {
            if let Err(err) = Self::apply_raw_edit(doc, edit) {
                doc.nodes = snapshot_nodes;
                doc.version = snapshot_version;
                doc.slots = snapshot_slots;
                self.undo_list.push(tx);
                return Err(err);
            }
        }

        *selection = tx.selection_before.clone();
        self.redo_list.push(tx);
        self.coalesce_sealed = true;
        Ok(true)
    }

    /// 执行重做：按正序重放正向操作并恢复选区；若应用编辑出错则回滚文档与栈帧并返回 Err
    pub fn redo(
        &mut self,
        doc: &mut Document,
        selection: &mut Selection,
    ) -> Result<bool, DocError> {
        let Some(tx) = self.redo_list.pop() else {
            return Ok(false);
        };

        let snapshot_nodes = doc.nodes.clone();
        let snapshot_version = doc.version;
        let snapshot_slots = doc.slots.clone();

        for edit in &tx.edits {
            if let Err(err) = Self::apply_raw_edit(doc, edit) {
                doc.nodes = snapshot_nodes;
                doc.version = snapshot_version;
                doc.slots = snapshot_slots;
                self.redo_list.push(tx);
                return Err(err);
            }
        }

        *selection = tx.selection_after.clone();
        self.undo_list.push(tx);
        self.coalesce_sealed = true;
        Ok(true)
    }

    fn apply_raw_edit(doc: &mut Document, edit: &Edit) -> Result<(), DocError> {
        match edit {
            Edit::ReplaceAll { new_nodes } => {
                doc.nodes = new_nodes.clone();
                doc.version += 1;
                doc.rebuild_slots();
                Ok(())
            }
            Edit::ReplaceSlot { slot_id, new_nodes } => {
                doc.replace_slot(*slot_id, new_nodes.clone())?;
                Ok(())
            }
            Edit::ClearSlot { slot_id } => {
                doc.clear_slot(*slot_id)?;
                Ok(())
            }
            _ => {
                let dummy = Cursor::AtEnd;
                Transaction::apply_edit(doc, edit, &dummy).map(|_| ())
            }
        }
    }
}

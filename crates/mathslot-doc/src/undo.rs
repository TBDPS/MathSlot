use crate::cursor::Cursor;
use crate::document::Document;
use crate::transaction::{DocError, Edit, Transaction};

/// 具备连续输入防抖合并 (Coalescing) 的撤销重做栈
#[derive(Debug, Clone)]
pub struct UndoStack {
    undo_list: Vec<Transaction>,
    redo_list: Vec<Transaction>,
    max_capacity: usize,
    coalesce_window_ms: u64,
}

impl Default for UndoStack {
    fn default() -> Self {
        Self::new(100, 500)
    }
}

impl UndoStack {
    pub fn new(max_capacity: usize, coalesce_window_ms: u64) -> Self {
        Self {
            undo_list: Vec::with_capacity(max_capacity),
            redo_list: Vec::new(),
            max_capacity,
            coalesce_window_ms,
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_list.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_list.is_empty()
    }

    pub fn undo_len(&self) -> usize {
        self.undo_list.len()
    }

    pub fn redo_len(&self) -> usize {
        self.redo_list.len()
    }

    pub fn clear(&mut self) {
        self.undo_list.clear();
        self.redo_list.clear();
    }

    /// 将新事务压入撤销栈，并在满足 500ms 连续输入时执行防抖合并
    pub fn push(&mut self, tx: Transaction) {
        self.redo_list.clear();

        // 尝试与上一事务合并
        if let Some(last) = self.undo_list.last_mut() {
            let can_coalesce = last.edits.len() == 1
                && tx.edits.len() == 1
                && tx.timestamp_ms.saturating_sub(last.timestamp_ms) <= self.coalesce_window_ms;

            if can_coalesce
                && let (
                    Edit::InsertText {
                        at: at1,
                        text: text1,
                    },
                    Edit::InsertText {
                        at: at2,
                        text: text2,
                    },
                ) = (&mut last.edits[0], &tx.edits[0])
            {
                let same_target = match (at1, at2) {
                    (Cursor::InSlot { slot_id: id1, .. }, Cursor::InSlot { slot_id: id2, .. }) => {
                        id1 == id2
                    }
                    (Cursor::AtEnd, Cursor::AtEnd) => true,
                    (Cursor::AtStart, Cursor::AtStart) => true,
                    _ => false,
                };

                if same_target && !text2.contains('\n') {
                    text1.push_str(text2);
                    last.cursor_after = tx.cursor_after;
                    last.version_after = tx.version_after;
                    last.timestamp_ms = tx.timestamp_ms;
                    // 注意：last.inverse_edits 保持初始时的逆操作，确保回退时能一次性恢复到输入前
                    return;
                }
            }
        }

        if self.undo_list.len() >= self.max_capacity {
            self.undo_list.remove(0);
        }
        self.undo_list.push(tx);
    }

    /// 执行撤销：应用逆操作并恢复光标
    pub fn undo(&mut self, doc: &mut Document, cursor: &mut Cursor) -> bool {
        let Some(tx) = self.undo_list.pop() else {
            return false;
        };

        // 按倒序执行逆操作
        for edit in tx.inverse_edits.iter().rev() {
            let _ = Self::apply_raw_edit(doc, edit);
        }

        *cursor = tx.cursor_before.clone();
        self.redo_list.push(tx);
        true
    }

    /// 执行重做：重新应用操作并恢复光标
    pub fn redo(&mut self, doc: &mut Document, cursor: &mut Cursor) -> bool {
        let Some(tx) = self.redo_list.pop() else {
            return false;
        };

        for edit in &tx.edits {
            let _ = Self::apply_raw_edit(doc, edit);
        }

        *cursor = tx.cursor_after.clone();
        self.undo_list.push(tx);
        true
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
                let _ = Transaction::apply_edit(doc, edit, &dummy)?;
                Ok(())
            }
        }
    }
}

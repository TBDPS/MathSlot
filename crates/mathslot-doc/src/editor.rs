use crate::cursor::Cursor;
use crate::document::Document;
use crate::transaction::{DocError, Edit, Transaction};
use crate::undo::UndoStack;
use std::time::{SystemTime, UNIX_EPOCH};

/// 高层文档编辑器：协调 Document、Cursor、UndoStack 并响应键盘动作
#[derive(Debug, Clone)]
pub struct Editor {
    doc: Document,
    cursor: Cursor,
    history: UndoStack,
    tx_seq: u64,
}

impl Editor {
    pub fn new(doc: Document) -> Self {
        let first_slot = doc
            .slots
            .first_empty()
            .or_else(|| doc.slots.slots().first().map(|s| s.id));
        let cursor = if let Some(id) = first_slot {
            Cursor::InSlot {
                slot_id: id,
                offset: 0,
            }
        } else {
            Cursor::AtEnd
        };

        Self {
            doc,
            cursor,
            history: UndoStack::default(),
            tx_seq: 0,
        }
    }

    pub fn doc(&self) -> &Document {
        &self.doc
    }

    pub fn doc_mut(&mut self) -> &mut Document {
        &mut self.doc
    }

    pub fn cursor(&self) -> &Cursor {
        &self.cursor
    }

    pub fn set_cursor(&mut self, cursor: Cursor) {
        self.cursor = cursor;
    }

    pub fn history(&self) -> &UndoStack {
        &self.history
    }

    pub fn history_mut(&mut self) -> &mut UndoStack {
        &mut self.history
    }

    /// 应用单个原子编辑操作，记录事务并压入撤销栈
    pub fn apply(&mut self, edit: Edit, label: impl Into<String>) -> Result<Transaction, DocError> {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let version_before = self.doc.version;
        let cursor_before = self.cursor.clone();

        let (inverse, cursor_after) = Transaction::apply_edit(&mut self.doc, &edit, &self.cursor)?;
        self.cursor = cursor_after.clone();
        self.tx_seq += 1;

        let tx = Transaction {
            id: self.tx_seq,
            label: label.into(),
            edits: vec![edit],
            inverse_edits: vec![inverse],
            cursor_before,
            cursor_after,
            version_before,
            version_after: self.doc.version,
            timestamp_ms: now_ms,
        };

        self.history.push(tx.clone());
        Ok(tx)
    }

    pub fn undo(&mut self) -> bool {
        self.history.undo(&mut self.doc, &mut self.cursor)
    }

    pub fn redo(&mut self) -> bool {
        self.history.redo(&mut self.doc, &mut self.cursor)
    }

    pub fn tab_next_slot(&mut self) -> bool {
        if let Cursor::InSlot { slot_id, .. } = self.cursor
            && let Some(next_id) = self.doc.slots.next_slot(slot_id)
        {
            self.cursor = Cursor::InSlot {
                slot_id: next_id,
                offset: 0,
            };
            return true;
        }

        if let Some(first_empty) = self.doc.slots.first_empty() {
            self.cursor = Cursor::InSlot {
                slot_id: first_empty,
                offset: 0,
            };
            return true;
        }

        if let Some(first) = self.doc.slots.slots().first() {
            self.cursor = Cursor::InSlot {
                slot_id: first.id,
                offset: 0,
            };
            return true;
        }

        false
    }

    pub fn tab_prev_slot(&mut self) -> bool {
        if let Cursor::InSlot { slot_id, .. } = self.cursor
            && let Some(prev_id) = self.doc.slots.prev_slot(slot_id)
        {
            self.cursor = Cursor::InSlot {
                slot_id: prev_id,
                offset: 0,
            };
            return true;
        }

        if let Some(last) = self.doc.slots.slots().last() {
            self.cursor = Cursor::InSlot {
                slot_id: last.id,
                offset: 0,
            };
            return true;
        }

        false
    }

    pub fn insert_text(&mut self, s: &str) -> Result<(), DocError> {
        self.apply(
            Edit::InsertText {
                at: self.cursor.clone(),
                text: s.to_string(),
            },
            "insert_text",
        )
        .map(|_| ())
    }

    pub fn delete_backward(&mut self) -> Result<(), DocError> {
        self.apply(
            Edit::DeleteChar {
                at: self.cursor.clone(),
                backward: true,
            },
            "delete_backward",
        )
        .map(|_| ())
    }
}

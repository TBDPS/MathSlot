use crate::cursor::Cursor;
use crate::document::Document;
use crate::path::AstPath;
use mathslot_syntax::{Delim, Expr, SlotId, Span, Spanned, parse, to_latex};
use serde::{Deserialize, Serialize};

/// 文档操作错误枚举
#[derive(Debug, thiserror::Error, Clone, PartialEq, Eq)]
pub enum DocError {
    #[error("Slot not found: {0:?}")]
    SlotNotFound(SlotId),
    #[error("Invalid AST path: {0:?}")]
    InvalidPath(AstPath),
    #[error("Invalid cursor state")]
    InvalidCursor,
    #[error("Transaction failed: {0}")]
    TransactionFailed(String),
}

/// 原子编辑意图
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Edit {
    InsertText {
        at: Cursor,
        text: String,
    },
    DeleteChar {
        at: Cursor,
        backward: bool,
    },
    ReplaceSlot {
        slot_id: SlotId,
        new_nodes: Vec<Spanned<Expr>>,
    },
    ClearSlot {
        slot_id: SlotId,
    },
    WrapDelimited {
        path: AstPath,
        open: Delim,
        close: Delim,
        auto_scale: bool,
    },
    ReplaceAll {
        new_nodes: Vec<Spanned<Expr>>,
    },
}

/// 可逆原子事务
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transaction {
    pub id: u64,
    pub label: String,
    pub edits: Vec<Edit>,
    pub inverse_edits: Vec<Edit>,
    pub cursor_before: Cursor,
    pub cursor_after: Cursor,
    pub version_before: u64,
    pub version_after: u64,
    pub timestamp_ms: u64,
}

impl Transaction {
    /// 执行单个 Edit，并在 document 上应用变更，计算对应的逆操作与光标变化
    pub fn apply_edit(
        doc: &mut Document,
        edit: &Edit,
        cursor: &Cursor,
    ) -> Result<(Edit, Cursor), DocError> {
        match edit {
            Edit::ReplaceAll { new_nodes } => {
                let old_nodes = std::mem::replace(&mut doc.nodes, new_nodes.clone());
                doc.rebuild_slots();
                doc.version += 1;
                let inverse = Edit::ReplaceAll {
                    new_nodes: old_nodes,
                };
                Ok((inverse, Cursor::AtEnd))
            }

            Edit::ReplaceSlot { slot_id, new_nodes } => {
                let old_nodes = doc.replace_slot(*slot_id, new_nodes.clone())?;
                let inverse = Edit::ReplaceSlot {
                    slot_id: *slot_id,
                    new_nodes: old_nodes,
                };
                let new_cursor = Cursor::InSlot {
                    slot_id: *slot_id,
                    offset: 0,
                };
                Ok((inverse, new_cursor))
            }

            Edit::ClearSlot { slot_id } => {
                let old_nodes = doc.clear_slot(*slot_id)?;
                let inverse = Edit::ReplaceSlot {
                    slot_id: *slot_id,
                    new_nodes: old_nodes,
                };
                let new_cursor = Cursor::InSlot {
                    slot_id: *slot_id,
                    offset: 0,
                };
                Ok((inverse, new_cursor))
            }

            Edit::InsertText { at, text } => {
                match at {
                    Cursor::InSlot { slot_id, offset } => {
                        let old_nodes = doc
                            .get_slot_nodes(*slot_id)
                            .map(|s| s.to_vec())
                            .unwrap_or_default();

                        let current_str = if old_nodes.len() == 1
                            && matches!(old_nodes[0].node, Expr::Placeholder { .. })
                        {
                            String::new()
                        } else {
                            to_latex(&old_nodes)
                        };

                        let mut chars: Vec<char> = current_str.chars().collect();
                        let insert_idx = (*offset).min(chars.len());
                        for (i, c) in text.chars().enumerate() {
                            chars.insert(insert_idx + i, c);
                        }
                        let new_str: String = chars.into_iter().collect();

                        let (new_nodes, _) = parse(&new_str);
                        let _ = doc.replace_slot(*slot_id, new_nodes)?;

                        let inverse = Edit::ReplaceSlot {
                            slot_id: *slot_id,
                            new_nodes: old_nodes,
                        };
                        let new_cursor = Cursor::InSlot {
                            slot_id: *slot_id,
                            offset: insert_idx + text.chars().count(),
                        };
                        Ok((inverse, new_cursor))
                    }

                    Cursor::AtStart => {
                        let old_all = doc.nodes.clone();
                        let current_latex = doc.to_latex();
                        let new_latex = format!("{text}{current_latex}");
                        let (new_nodes, _) = parse(&new_latex);
                        doc.nodes = new_nodes;
                        doc.version += 1;
                        doc.rebuild_slots();

                        let inverse = Edit::ReplaceAll { new_nodes: old_all };
                        let new_cursor = Cursor::InSlot {
                            slot_id: doc.slots.slots().first().map(|s| s.id).unwrap_or(SlotId(1)),
                            offset: text.chars().count(),
                        };
                        Ok((inverse, new_cursor))
                    }

                    _ => {
                        // AtEnd 或 AtNode
                        let old_all = doc.nodes.clone();
                        let current_latex = doc.to_latex();
                        let new_latex = if current_latex.is_empty() {
                            text.clone()
                        } else {
                            format!("{current_latex} {text}")
                        };
                        let (new_nodes, _) = parse(&new_latex);
                        doc.nodes = new_nodes;
                        doc.version += 1;
                        doc.rebuild_slots();

                        let inverse = Edit::ReplaceAll { new_nodes: old_all };
                        let new_cursor = Cursor::AtEnd;
                        Ok((inverse, new_cursor))
                    }
                }
            }

            Edit::DeleteChar { at, backward } => {
                match at {
                    Cursor::InSlot { slot_id, offset } => {
                        let old_nodes = doc
                            .get_slot_nodes(*slot_id)
                            .map(|s| s.to_vec())
                            .unwrap_or_default();

                        let current_str = to_latex(&old_nodes);
                        let mut chars: Vec<char> = current_str.chars().collect();

                        let new_offset = if *backward {
                            if *offset > 0 && !chars.is_empty() {
                                let del_idx = (*offset - 1).min(chars.len() - 1);
                                chars.remove(del_idx);
                                *offset - 1
                            } else {
                                *offset
                            }
                        } else if *offset < chars.len() {
                            chars.remove(*offset);
                            *offset
                        } else {
                            *offset
                        };

                        let new_str: String = chars.into_iter().collect();
                        let (new_nodes, _) = parse(&new_str);
                        let _ = doc.replace_slot(*slot_id, new_nodes)?;

                        let inverse = Edit::ReplaceSlot {
                            slot_id: *slot_id,
                            new_nodes: old_nodes,
                        };
                        let new_cursor = Cursor::InSlot {
                            slot_id: *slot_id,
                            offset: new_offset,
                        };
                        Ok((inverse, new_cursor))
                    }

                    _ => {
                        // 根级别删除末尾字符
                        let old_all = doc.nodes.clone();
                        let current_latex = doc.to_latex();
                        let mut chars: Vec<char> = current_latex.chars().collect();
                        if !chars.is_empty() {
                            chars.pop();
                        }
                        let new_latex: String = chars.into_iter().collect();
                        let (new_nodes, _) = parse(&new_latex);
                        doc.nodes = new_nodes;
                        doc.version += 1;
                        doc.rebuild_slots();

                        let inverse = Edit::ReplaceAll { new_nodes: old_all };
                        Ok((inverse, cursor.clone()))
                    }
                }
            }

            Edit::WrapDelimited {
                path,
                open,
                close,
                auto_scale,
            } => {
                let old_all = doc.nodes.clone();
                let steps = path.as_slice();

                if steps.is_empty() {
                    let inner = std::mem::take(&mut doc.nodes);
                    let wrapped = Spanned::new(
                        Expr::Delimited {
                            open: *open,
                            close: *close,
                            body: inner,
                            auto_scale: *auto_scale,
                        },
                        Span::point(0),
                    );
                    doc.nodes = vec![wrapped];
                } else if let Some(node) = doc.nodes.get_mut(steps[0]) {
                    let old_node = node.clone();
                    *node = Spanned::new(
                        Expr::Delimited {
                            open: *open,
                            close: *close,
                            body: vec![old_node],
                            auto_scale: *auto_scale,
                        },
                        node.span,
                    );
                }

                doc.version += 1;
                doc.rebuild_slots();
                let inverse = Edit::ReplaceAll { new_nodes: old_all };
                Ok((inverse, cursor.clone()))
            }
        }
    }
}

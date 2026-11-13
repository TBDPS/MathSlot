use crate::cursor::{Cursor, Selection};
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
    #[error("Nothing to delete at cursor")]
    NothingToDelete,
    #[error("Transaction failed: {0}")]
    TransactionFailed(String),
}

/// 操作意图枚举：撤销合并与行为隔离的依据 (INV-008, A-EDIT-005)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Intent {
    Typing,
    Command,
    PaletteCard,
    CommandExpansion,
    Paste,
    Delete,
    Import,
    Clear,
    ImeCommit,
    Nav,
    Navigation,
    Format,
}

impl Intent {
    #[must_use]
    pub fn is_command(&self) -> bool {
        matches!(
            self,
            Self::Command | Self::PaletteCard | Self::CommandExpansion
        )
    }

    #[must_use]
    pub fn is_nav(&self) -> bool {
        matches!(self, Self::Nav | Self::Navigation)
    }
}

/// 原子编辑意图
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Edit {
    InsertText {
        at: Cursor,
        text: String,
    },
    InsertLiteralText {
        at: Cursor,
        text: String,
    },
    DeleteChar {
        at: Cursor,
        backward: bool,
    },
    DeleteSelection {
        selection: Selection,
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

/// 单个 Edit 执行后的完整结果（含逆操作、新光标及词/行边界断组标记）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditOutcome {
    pub inverse: Edit,
    pub new_cursor: Cursor,
    pub breaks_word_or_line: bool,
}

/// 可逆原子事务
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transaction {
    pub id: u64,
    pub intent: Intent,
    pub label: String,
    pub edits: Vec<Edit>,
    pub inverse_edits: Vec<Edit>,
    pub cursor_before: Cursor,
    pub cursor_after: Cursor,
    pub selection_before: Selection,
    pub selection_after: Selection,
    pub breaks_word_or_line: bool,
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
        let outcome = Self::apply_edit_with_outcome(doc, edit, cursor)?;
        Ok((outcome.inverse, outcome.new_cursor))
    }

    /// 执行单个 Edit 并返回完整的逆操作、目标光标和词/行断开标记
    pub fn apply_edit_with_outcome(
        doc: &mut Document,
        edit: &Edit,
        cursor: &Cursor,
    ) -> Result<EditOutcome, DocError> {
        match edit {
            Edit::ReplaceAll { new_nodes } => {
                let old_nodes = std::mem::replace(&mut doc.nodes, new_nodes.clone());
                doc.rebuild_slots();
                doc.version += 1;
                Ok(EditOutcome {
                    inverse: Edit::ReplaceAll {
                        new_nodes: old_nodes,
                    },
                    new_cursor: Cursor::AtEnd,
                    breaks_word_or_line: false,
                })
            }

            Edit::ReplaceSlot { slot_id, new_nodes } => {
                let old_nodes = doc.replace_slot(*slot_id, new_nodes.clone())?;
                Ok(EditOutcome {
                    inverse: Edit::ReplaceSlot {
                        slot_id: *slot_id,
                        new_nodes: old_nodes,
                    },
                    new_cursor: Cursor::InSlot {
                        slot_id: *slot_id,
                        offset: 0,
                    },
                    breaks_word_or_line: false,
                })
            }

            Edit::ClearSlot { slot_id } => {
                let old_nodes = doc.clear_slot(*slot_id)?;
                Ok(EditOutcome {
                    inverse: Edit::ReplaceSlot {
                        slot_id: *slot_id,
                        new_nodes: old_nodes,
                    },
                    new_cursor: Cursor::InSlot {
                        slot_id: *slot_id,
                        offset: 0,
                    },
                    breaks_word_or_line: false,
                })
            }

            Edit::InsertText { at, text } => Self::apply_insert_text(doc, at, text),

            Edit::InsertLiteralText { at, text } => Self::apply_insert_literal_text(doc, at, text),

            Edit::DeleteChar { at, backward } => Self::apply_delete_char(doc, at, *backward),

            Edit::DeleteSelection { selection } => Self::apply_delete_selection(doc, selection),

            Edit::WrapDelimited {
                path,
                open,
                close,
                auto_scale,
            } => Self::apply_wrap_delimited(doc, cursor, path, *open, *close, *auto_scale),
        }
    }

    fn apply_insert_text(
        doc: &mut Document,
        at: &Cursor,
        text: &str,
    ) -> Result<EditOutcome, DocError> {
        let breaks = text.chars().any(char::is_whitespace);
        match at {
            Cursor::InSlot { slot_id, offset } => {
                let old_nodes = doc
                    .get_slot_nodes(*slot_id)
                    .ok_or(DocError::SlotNotFound(*slot_id))?
                    .to_vec();

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
                doc.replace_slot(*slot_id, new_nodes)?;

                Ok(EditOutcome {
                    inverse: Edit::ReplaceSlot {
                        slot_id: *slot_id,
                        new_nodes: old_nodes,
                    },
                    new_cursor: Cursor::InSlot {
                        slot_id: *slot_id,
                        offset: insert_idx + text.chars().count(),
                    },
                    breaks_word_or_line: breaks,
                })
            }

            Cursor::AtStart => {
                let old_all = doc.nodes.clone();
                let current_latex = doc.to_latex();
                let new_latex = format!("{text}{current_latex}");
                let (new_nodes, _) = parse(&new_latex);
                doc.nodes = new_nodes;
                doc.version += 1;
                doc.rebuild_slots();

                Ok(EditOutcome {
                    inverse: Edit::ReplaceAll { new_nodes: old_all },
                    new_cursor: Cursor::AtStart,
                    breaks_word_or_line: breaks,
                })
            }

            _ => {
                let old_all = doc.nodes.clone();
                let current_latex = doc.to_latex();
                let new_latex = if current_latex.is_empty() {
                    text.to_string()
                } else {
                    let last_word = current_latex.split_whitespace().last().unwrap_or("");
                    let needs_space = last_word.starts_with('\\')
                        && text.chars().next().is_some_and(|c| c.is_alphabetic());
                    if needs_space {
                        format!("{current_latex} {text}")
                    } else {
                        format!("{current_latex}{text}")
                    }
                };
                let (new_nodes, _) = parse(&new_latex);
                doc.nodes = new_nodes;
                doc.version += 1;
                doc.rebuild_slots();

                Ok(EditOutcome {
                    inverse: Edit::ReplaceAll { new_nodes: old_all },
                    new_cursor: Cursor::AtEnd,
                    breaks_word_or_line: breaks,
                })
            }
        }
    }

    fn apply_insert_literal_text(
        doc: &mut Document,
        at: &Cursor,
        text: &str,
    ) -> Result<EditOutcome, DocError> {
        let breaks = text.chars().any(char::is_whitespace);
        match at {
            Cursor::InSlot { slot_id, offset } => {
                let old_nodes = doc
                    .get_slot_nodes(*slot_id)
                    .ok_or(DocError::SlotNotFound(*slot_id))?
                    .to_vec();

                let inserted_chars = text.chars().count();
                let (new_nodes, new_offset) = if old_nodes.is_empty()
                    || (old_nodes.len() == 1
                        && matches!(old_nodes[0].node, Expr::Placeholder { .. }))
                {
                    (
                        vec![Spanned::new(Expr::Text(text.to_string()), Span::point(0))],
                        inserted_chars,
                    )
                } else if old_nodes.iter().all(|n| matches!(n.node, Expr::Text(_))) {
                    let combined: String = old_nodes
                        .iter()
                        .filter_map(|n| match &n.node {
                            Expr::Text(s) => Some(s.as_str()),
                            _ => None,
                        })
                        .collect();
                    let mut chars: Vec<char> = combined.chars().collect();
                    let insert_idx = (*offset).min(chars.len());
                    for (i, c) in text.chars().enumerate() {
                        chars.insert(insert_idx + i, c);
                    }
                    let updated: String = chars.into_iter().collect();
                    (
                        vec![Spanned::new(Expr::Text(updated), Span::point(0))],
                        insert_idx + inserted_chars,
                    )
                } else {
                    let mut nodes = old_nodes.clone();
                    let insert_idx = (*offset).min(nodes.len());
                    nodes.insert(
                        insert_idx,
                        Spanned::new(Expr::Text(text.to_string()), Span::point(0)),
                    );
                    (nodes, insert_idx + inserted_chars)
                };

                doc.replace_slot(*slot_id, new_nodes)?;

                Ok(EditOutcome {
                    inverse: Edit::ReplaceSlot {
                        slot_id: *slot_id,
                        new_nodes: old_nodes,
                    },
                    new_cursor: Cursor::InSlot {
                        slot_id: *slot_id,
                        offset: new_offset,
                    },
                    breaks_word_or_line: breaks,
                })
            }

            Cursor::AtStart => {
                let old_all = doc.nodes.clone();
                doc.nodes.insert(
                    0,
                    Spanned::new(Expr::Text(text.to_string()), Span::point(0)),
                );
                doc.version += 1;
                doc.rebuild_slots();

                Ok(EditOutcome {
                    inverse: Edit::ReplaceAll { new_nodes: old_all },
                    new_cursor: Cursor::AtStart,
                    breaks_word_or_line: breaks,
                })
            }

            _ => {
                let old_all = doc.nodes.clone();
                doc.nodes
                    .push(Spanned::new(Expr::Text(text.to_string()), Span::point(0)));
                doc.version += 1;
                doc.rebuild_slots();

                Ok(EditOutcome {
                    inverse: Edit::ReplaceAll { new_nodes: old_all },
                    new_cursor: Cursor::AtEnd,
                    breaks_word_or_line: breaks,
                })
            }
        }
    }

    fn apply_delete_char(
        doc: &mut Document,
        at: &Cursor,
        backward: bool,
    ) -> Result<EditOutcome, DocError> {
        match at {
            Cursor::InSlot { slot_id, offset } => {
                let old_nodes = doc
                    .get_slot_nodes(*slot_id)
                    .ok_or(DocError::SlotNotFound(*slot_id))?
                    .to_vec();

                let (new_nodes, new_offset, deleted_char) =
                    delete_from_slot_nodes(&old_nodes, *offset, backward)?;

                doc.replace_slot(*slot_id, new_nodes)?;

                Ok(EditOutcome {
                    inverse: Edit::ReplaceSlot {
                        slot_id: *slot_id,
                        new_nodes: old_nodes,
                    },
                    new_cursor: Cursor::InSlot {
                        slot_id: *slot_id,
                        offset: new_offset,
                    },
                    breaks_word_or_line: deleted_char.is_whitespace(),
                })
            }

            Cursor::AtEnd => {
                if !backward {
                    return Err(DocError::NothingToDelete);
                }
                delete_last_root_char(doc)
            }

            Cursor::AtStart => {
                if backward {
                    return Err(DocError::NothingToDelete);
                }
                delete_first_root_char(doc)
            }

            Cursor::AtNode(path) => delete_at_root_node(doc, path, backward),
        }
    }

    fn apply_delete_selection(
        doc: &mut Document,
        selection: &Selection,
    ) -> Result<EditOutcome, DocError> {
        if selection.is_collapsed() {
            return Err(DocError::NothingToDelete);
        }

        match (&selection.anchor, &selection.focus) {
            (
                Cursor::InSlot {
                    slot_id: id1,
                    offset: off1,
                },
                Cursor::InSlot {
                    slot_id: id2,
                    offset: off2,
                },
            ) if id1 == id2 => {
                let old_nodes = doc
                    .get_slot_nodes(*id1)
                    .ok_or(DocError::SlotNotFound(*id1))?
                    .to_vec();

                if old_nodes.is_empty()
                    || (old_nodes.len() == 1
                        && matches!(old_nodes[0].node, Expr::Placeholder { .. }))
                {
                    return Err(DocError::NothingToDelete);
                }

                let start = (*off1).min(*off2);
                let end = (*off1).max(*off2);
                let all_text = old_nodes.iter().all(|n| matches!(n.node, Expr::Text(_)));

                let current_str = if all_text {
                    old_nodes
                        .iter()
                        .filter_map(|n| match &n.node {
                            Expr::Text(s) => Some(s.as_str()),
                            _ => None,
                        })
                        .collect::<String>()
                } else {
                    to_latex(&old_nodes)
                };

                let mut chars: Vec<char> = current_str.chars().collect();
                let start = start.min(chars.len());
                let end = end.min(chars.len());
                if start == end {
                    return Err(DocError::NothingToDelete);
                }
                chars.drain(start..end);
                let remaining: String = chars.into_iter().collect();

                let new_nodes = if remaining.is_empty() {
                    Vec::new()
                } else if all_text {
                    vec![Spanned::new(Expr::Text(remaining), Span::point(0))]
                } else {
                    parse(&remaining).0
                };

                doc.replace_slot(*id1, new_nodes)?;

                Ok(EditOutcome {
                    inverse: Edit::ReplaceSlot {
                        slot_id: *id1,
                        new_nodes: old_nodes,
                    },
                    new_cursor: Cursor::InSlot {
                        slot_id: *id1,
                        offset: start,
                    },
                    breaks_word_or_line: true,
                })
            }

            (Cursor::AtStart, Cursor::AtEnd) | (Cursor::AtEnd, Cursor::AtStart) => {
                if doc.nodes.is_empty() {
                    return Err(DocError::NothingToDelete);
                }
                let old_all = std::mem::take(&mut doc.nodes);
                doc.version += 1;
                doc.rebuild_slots();

                Ok(EditOutcome {
                    inverse: Edit::ReplaceAll { new_nodes: old_all },
                    new_cursor: Cursor::AtEnd,
                    breaks_word_or_line: true,
                })
            }

            (Cursor::AtNode(p1), Cursor::AtNode(p2))
                if p1.as_slice().len() == 1 && p2.as_slice().len() == 1 =>
            {
                let i1 = p1.as_slice()[0];
                let i2 = p2.as_slice()[0];
                if i1 >= doc.nodes.len() || i2 >= doc.nodes.len() {
                    return Err(DocError::InvalidCursor);
                }
                let old_all = doc.nodes.clone();
                let start = i1.min(i2);
                let end = i1.max(i2);
                doc.nodes.drain(start..=end);
                doc.version += 1;
                doc.rebuild_slots();

                let new_cursor = if doc.nodes.is_empty() {
                    Cursor::AtEnd
                } else if start < doc.nodes.len() {
                    Cursor::AtNode(AstPath::new(vec![start]))
                } else {
                    Cursor::AtEnd
                };

                Ok(EditOutcome {
                    inverse: Edit::ReplaceAll { new_nodes: old_all },
                    new_cursor,
                    breaks_word_or_line: true,
                })
            }

            _ => Err(DocError::InvalidCursor),
        }
    }

    fn apply_wrap_delimited(
        doc: &mut Document,
        cursor: &Cursor,
        path: &AstPath,
        open: Delim,
        close: Delim,
        auto_scale: bool,
    ) -> Result<EditOutcome, DocError> {
        let old_all = doc.nodes.clone();
        let steps = path.as_slice();

        if steps.is_empty() {
            let inner = std::mem::take(&mut doc.nodes);
            let wrapped = Spanned::new(
                Expr::Delimited {
                    open,
                    close,
                    body: inner,
                    auto_scale,
                },
                Span::point(0),
            );
            doc.nodes = vec![wrapped];
        } else if let Some(node) = doc.nodes.get_mut(steps[0]) {
            let old_node = node.clone();
            *node = Spanned::new(
                Expr::Delimited {
                    open,
                    close,
                    body: vec![old_node],
                    auto_scale,
                },
                node.span,
            );
        }

        doc.version += 1;
        doc.rebuild_slots();
        Ok(EditOutcome {
            inverse: Edit::ReplaceAll { new_nodes: old_all },
            new_cursor: cursor.clone(),
            breaks_word_or_line: false,
        })
    }
}

fn delete_from_slot_nodes(
    old_nodes: &[Spanned<Expr>],
    offset: usize,
    backward: bool,
) -> Result<(Vec<Spanned<Expr>>, usize, char), DocError> {
    if old_nodes.is_empty()
        || (old_nodes.len() == 1 && matches!(old_nodes[0].node, Expr::Placeholder { .. }))
    {
        return Err(DocError::NothingToDelete);
    }

    let all_text = old_nodes.iter().all(|n| matches!(n.node, Expr::Text(_)));
    let current_str = if all_text {
        old_nodes
            .iter()
            .filter_map(|n| match &n.node {
                Expr::Text(s) => Some(s.as_str()),
                _ => None,
            })
            .collect::<String>()
    } else {
        to_latex(old_nodes)
    };

    let mut chars: Vec<char> = current_str.chars().collect();
    let (del_idx, new_offset) = if backward {
        if offset == 0 || chars.is_empty() {
            return Err(DocError::NothingToDelete);
        }
        let idx = (offset - 1).min(chars.len() - 1);
        (idx, idx)
    } else {
        if offset >= chars.len() {
            return Err(DocError::NothingToDelete);
        }
        (offset, offset)
    };

    let deleted_char = chars.remove(del_idx);
    let new_str: String = chars.into_iter().collect();

    let new_nodes = if new_str.is_empty() {
        Vec::new()
    } else if all_text {
        vec![Spanned::new(Expr::Text(new_str), Span::point(0))]
    } else {
        parse(&new_str).0
    };

    Ok((new_nodes, new_offset, deleted_char))
}

fn delete_last_root_char(doc: &mut Document) -> Result<EditOutcome, DocError> {
    let Some(non_empty_idx) = doc
        .nodes
        .iter()
        .rposition(|n| !matches!(&n.node, Expr::Text(s) if s.is_empty()))
    else {
        return Err(DocError::NothingToDelete);
    };

    let old_all = doc.nodes.clone();
    doc.nodes.truncate(non_empty_idx + 1);

    let deleted_char = match doc.nodes.last_mut().map(|n| &mut n.node) {
        Some(Expr::Text(s)) => {
            let ch = match s.pop() {
                Some(ch) => ch,
                None => {
                    doc.nodes = old_all;
                    return Err(DocError::NothingToDelete);
                }
            };
            if s.is_empty() {
                doc.nodes.pop();
            }
            ch
        }
        Some(Expr::Placeholder { .. }) => {
            doc.nodes.pop();
            ' '
        }
        Some(_) => {
            let Some(last_node) = doc.nodes.pop() else {
                doc.nodes = old_all;
                return Err(DocError::NothingToDelete);
            };
            let tail_latex = to_latex(std::slice::from_ref(&last_node));
            let mut chars: Vec<char> = tail_latex.chars().collect();
            let Some(ch) = chars.pop() else {
                doc.nodes = old_all;
                return Err(DocError::NothingToDelete);
            };
            let new_tail: String = chars.into_iter().collect();
            let (parsed_tail, _) = parse(&new_tail);
            doc.nodes.extend(parsed_tail);
            ch
        }
        None => {
            doc.nodes = old_all;
            return Err(DocError::NothingToDelete);
        }
    };

    doc.version += 1;
    doc.rebuild_slots();

    Ok(EditOutcome {
        inverse: Edit::ReplaceAll { new_nodes: old_all },
        new_cursor: Cursor::AtEnd,
        breaks_word_or_line: deleted_char.is_whitespace(),
    })
}

fn delete_first_root_char(doc: &mut Document) -> Result<EditOutcome, DocError> {
    let Some(non_empty_idx) = doc
        .nodes
        .iter()
        .position(|n| !matches!(&n.node, Expr::Text(s) if s.is_empty()))
    else {
        return Err(DocError::NothingToDelete);
    };

    let old_all = doc.nodes.clone();
    doc.nodes.drain(0..non_empty_idx);

    let deleted_char = match doc.nodes.first_mut().map(|n| &mut n.node) {
        Some(Expr::Text(s)) => {
            if s.is_empty() {
                doc.nodes = old_all;
                return Err(DocError::NothingToDelete);
            }
            let ch = s.remove(0);
            if s.is_empty() {
                doc.nodes.remove(0);
            }
            ch
        }
        Some(Expr::Placeholder { .. }) => {
            doc.nodes.remove(0);
            ' '
        }
        Some(_) => {
            let first_node = doc.nodes.remove(0);
            let head_latex = to_latex(std::slice::from_ref(&first_node));
            let mut chars: Vec<char> = head_latex.chars().collect();
            if chars.is_empty() {
                doc.nodes = old_all;
                return Err(DocError::NothingToDelete);
            }
            let ch = chars.remove(0);
            let new_head: String = chars.into_iter().collect();
            let (parsed_head, _) = parse(&new_head);
            doc.nodes.splice(0..0, parsed_head);
            ch
        }
        None => {
            doc.nodes = old_all;
            return Err(DocError::NothingToDelete);
        }
    };

    doc.version += 1;
    doc.rebuild_slots();

    Ok(EditOutcome {
        inverse: Edit::ReplaceAll { new_nodes: old_all },
        new_cursor: Cursor::AtStart,
        breaks_word_or_line: deleted_char.is_whitespace(),
    })
}

fn delete_at_root_node(
    doc: &mut Document,
    path: &AstPath,
    backward: bool,
) -> Result<EditOutcome, DocError> {
    let steps = path.as_slice();
    if steps.len() != 1 {
        return Err(DocError::InvalidPath(path.clone()));
    }
    let idx = steps[0];
    if idx >= doc.nodes.len() {
        return Err(DocError::InvalidPath(path.clone()));
    }

    let old_all = doc.nodes.clone();
    let target_idx = if backward {
        if idx == 0 {
            return Err(DocError::NothingToDelete);
        }
        idx - 1
    } else {
        idx
    };

    let deleted_char = match &mut doc.nodes[target_idx].node {
        Expr::Text(s) => {
            if s.is_empty() {
                return Err(DocError::NothingToDelete);
            }
            let ch = if backward {
                match s.pop() {
                    Some(c) => c,
                    None => return Err(DocError::NothingToDelete),
                }
            } else {
                s.remove(0)
            };
            if s.is_empty() {
                doc.nodes.remove(target_idx);
            }
            ch
        }
        Expr::Placeholder { .. } => {
            doc.nodes.remove(target_idx);
            ' '
        }
        _ => {
            let node = doc.nodes.remove(target_idx);
            let text = to_latex(std::slice::from_ref(&node));
            let mut chars: Vec<char> = text.chars().collect();
            let ch = if backward {
                match chars.pop() {
                    Some(c) => c,
                    None => {
                        doc.nodes = old_all;
                        return Err(DocError::NothingToDelete);
                    }
                }
            } else if chars.is_empty() {
                doc.nodes = old_all;
                return Err(DocError::NothingToDelete);
            } else {
                chars.remove(0)
            };
            let new_str: String = chars.into_iter().collect();
            let (parsed, _) = parse(&new_str);
            doc.nodes.splice(target_idx..target_idx, parsed);
            ch
        }
    };

    doc.version += 1;
    doc.rebuild_slots();

    let new_cursor = if doc.nodes.is_empty() {
        Cursor::AtEnd
    } else if target_idx < doc.nodes.len() {
        Cursor::AtNode(AstPath::new(vec![target_idx]))
    } else {
        Cursor::AtEnd
    };

    Ok(EditOutcome {
        inverse: Edit::ReplaceAll { new_nodes: old_all },
        new_cursor,
        breaks_word_or_line: deleted_char.is_whitespace(),
    })
}

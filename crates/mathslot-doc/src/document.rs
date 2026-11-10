use crate::path::AstPath;
use crate::slot::{Slot, SlotRole, SlotTable};
use crate::transaction::DocError;
use mathslot_syntax::{Diagnostic, Expr, SlotId, Span, Spanned, parse, to_latex};
use serde::{Deserialize, Serialize};

/// 核心文档状态容器
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Document {
    pub nodes: Vec<Spanned<Expr>>,
    pub slots: SlotTable,
    pub version: u64,
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

impl Document {
    pub fn new() -> Self {
        Self {
            nodes: Vec::new(),
            slots: SlotTable::new(),
            version: 0,
        }
    }

    pub fn from_nodes(nodes: Vec<Spanned<Expr>>) -> Self {
        let mut doc = Self {
            nodes,
            slots: SlotTable::new(),
            version: 0,
        };
        doc.rebuild_slots();
        doc
    }

    pub fn from_latex(latex: &str) -> (Self, Vec<Diagnostic>) {
        let (nodes, diagnostics) = parse(latex);
        let doc = Self::from_nodes(nodes);
        (doc, diagnostics)
    }

    pub fn to_latex(&self) -> String {
        to_latex(&self.nodes)
    }

    /// 重建槽位表，确保 SlotTable 与当前 AST 拓扑 100% 同步
    pub fn rebuild_slots(&mut self) {
        let mut table = SlotTable::new();
        let mut next_id = 1u32;

        for (i, node) in self.nodes.iter().enumerate() {
            let path = AstPath::new(vec![i]);
            Self::collect_slots_from_node(node, path, &mut table, &mut next_id);
        }

        self.slots = table;
    }

    fn collect_slots_from_node(
        spanned: &Spanned<Expr>,
        path: AstPath,
        table: &mut SlotTable,
        next_id: &mut u32,
    ) {
        match &spanned.node {
            Expr::Placeholder { slot_id, label } => {
                let id = if slot_id.0 > 0 {
                    if slot_id.0 >= *next_id {
                        *next_id = slot_id.0 + 1;
                    }
                    *slot_id
                } else {
                    let id = SlotId(*next_id);
                    *next_id += 1;
                    id
                };
                table.insert(Slot {
                    id,
                    role: SlotRole::Placeholder,
                    path,
                    span: spanned.span,
                    is_empty: true,
                    label: label.clone(),
                });
            }

            Expr::Fraction { num, den } => {
                Self::collect_container_slice(
                    num,
                    path.child(0),
                    SlotRole::Numerator,
                    spanned.span,
                    table,
                    next_id,
                );
                Self::collect_container_slice(
                    den,
                    path.child(1),
                    SlotRole::Denominator,
                    spanned.span,
                    table,
                    next_id,
                );
            }

            Expr::Root { index, radicand } => {
                if let Some(idx) = index {
                    Self::collect_container_slice(
                        idx,
                        path.child(0),
                        SlotRole::RootIndex,
                        spanned.span,
                        table,
                        next_id,
                    );
                }
                Self::collect_container_slice(
                    radicand,
                    path.child(1),
                    SlotRole::Radicand,
                    spanned.span,
                    table,
                    next_id,
                );
            }

            Expr::Script { base, sub, sup } => {
                Self::collect_slots_from_node(base, path.child(0), table, next_id);

                if let Some(sub_box) = sub {
                    Self::collect_script_box(
                        sub_box,
                        path.child(1),
                        SlotRole::Subscript,
                        table,
                        next_id,
                    );
                }

                if let Some(sup_box) = sup {
                    Self::collect_script_box(
                        sup_box,
                        path.child(2),
                        SlotRole::Superscript,
                        table,
                        next_id,
                    );
                }
            }

            Expr::BigOperator {
                kind: _,
                lower,
                upper,
                body,
            } => {
                if let Some(low) = lower {
                    Self::collect_container_slice(
                        low,
                        path.child(0),
                        SlotRole::LowerBound,
                        spanned.span,
                        table,
                        next_id,
                    );
                }

                if let Some(up) = upper {
                    Self::collect_container_slice(
                        up,
                        path.child(1),
                        SlotRole::UpperBound,
                        spanned.span,
                        table,
                        next_id,
                    );
                }

                Self::collect_container_slice(
                    body,
                    path.child(2),
                    SlotRole::BigOpBody,
                    spanned.span,
                    table,
                    next_id,
                );
            }

            Expr::Matrix { env: _, rows } => {
                for (r, row) in rows.iter().enumerate() {
                    for (c, cell) in row.iter().enumerate() {
                        Self::collect_container_slice(
                            cell,
                            path.child(r).child(c),
                            SlotRole::MatrixCell { row: r, col: c },
                            spanned.span,
                            table,
                            next_id,
                        );
                    }
                }
            }

            Expr::Delimited {
                open: _,
                close: _,
                body,
                auto_scale: _,
            } => {
                Self::collect_container_slice(
                    body,
                    path.child(0),
                    SlotRole::DelimitedBody,
                    spanned.span,
                    table,
                    next_id,
                );
            }

            Expr::Style { style: _, body } => {
                Self::collect_container_slice(
                    body,
                    path.child(0),
                    SlotRole::StyleBody,
                    spanned.span,
                    table,
                    next_id,
                );
            }

            Expr::Group(items) => {
                for (j, item) in items.iter().enumerate() {
                    Self::collect_slots_from_node(item, path.child(j), table, next_id);
                }
            }

            _ => {}
        }
    }

    fn collect_container_slice(
        slice: &[Spanned<Expr>],
        path: AstPath,
        default_role: SlotRole,
        fallback_span: Span,
        table: &mut SlotTable,
        next_id: &mut u32,
    ) {
        if let [
            Spanned {
                node: Expr::Placeholder { slot_id, label },
                span,
            },
        ] = slice
        {
            let id = if slot_id.0 > 0 {
                if slot_id.0 >= *next_id {
                    *next_id = slot_id.0 + 1;
                }
                *slot_id
            } else {
                let id = SlotId(*next_id);
                *next_id += 1;
                id
            };
            table.insert(Slot {
                id,
                role: SlotRole::Placeholder,
                path,
                span: *span,
                is_empty: true,
                label: label.clone(),
            });
            return;
        }

        let slot_id = SlotId(*next_id);
        *next_id += 1;
        let span = if let (Some(first), Some(last)) = (slice.first(), slice.last()) {
            first.span.merge(last.span)
        } else {
            fallback_span
        };
        table.insert(Slot {
            id: slot_id,
            role: default_role,
            path: path.clone(),
            span,
            is_empty: is_slice_empty(slice),
            label: None,
        });
        for (j, item) in slice.iter().enumerate() {
            Self::collect_slots_from_node(item, path.child(j), table, next_id);
        }
    }

    fn collect_script_box(
        script_box: &Spanned<Expr>,
        path: AstPath,
        default_role: SlotRole,
        table: &mut SlotTable,
        next_id: &mut u32,
    ) {
        let single_ph = match &script_box.node {
            Expr::Placeholder { slot_id, label } => {
                Some((*slot_id, label.clone(), script_box.span))
            }
            Expr::Group(items) => match items.as_slice() {
                [
                    Spanned {
                        node: Expr::Placeholder { slot_id, label },
                        span,
                    },
                ] => Some((*slot_id, label.clone(), *span)),
                _ => None,
            },
            _ => None,
        };

        if let Some((slot_id, label, span)) = single_ph {
            let id = if slot_id.0 > 0 {
                if slot_id.0 >= *next_id {
                    *next_id = slot_id.0 + 1;
                }
                slot_id
            } else {
                let id = SlotId(*next_id);
                *next_id += 1;
                id
            };
            table.insert(Slot {
                id,
                role: SlotRole::Placeholder,
                path,
                span,
                is_empty: true,
                label,
            });
            return;
        }

        let is_empty = match &script_box.node {
            Expr::Group(items) => is_slice_empty(items),
            Expr::Placeholder { .. } => true,
            _ => false,
        };

        let slot_id = SlotId(*next_id);
        *next_id += 1;
        table.insert(Slot {
            id: slot_id,
            role: default_role,
            path: path.clone(),
            span: script_box.span,
            is_empty,
            label: None,
        });

        match &script_box.node {
            Expr::Group(items) => {
                for (j, item) in items.iter().enumerate() {
                    Self::collect_slots_from_node(item, path.child(j), table, next_id);
                }
            }
            _ => {
                Self::collect_slots_from_node(script_box, path, table, next_id);
            }
        }
    }

    /// 获取特定槽位对应的表达式切片
    pub fn get_slot_nodes(&self, slot_id: SlotId) -> Option<&[Spanned<Expr>]> {
        let slot = self.slots.get(slot_id)?;
        Self::navigate_slice(&self.nodes, slot.path.as_slice(), slot.role)
    }

    fn navigate_slice<'a>(
        nodes: &'a [Spanned<Expr>],
        path: &[usize],
        role: SlotRole,
    ) -> Option<&'a [Spanned<Expr>]> {
        if path.is_empty() {
            return Some(nodes);
        }

        let root_idx = path[0];
        let root_node = nodes.get(root_idx)?;

        if path.len() == 1 {
            // Root level slot
            return match role {
                SlotRole::Placeholder => Some(std::slice::from_ref(root_node)),
                _ => Some(nodes),
            };
        }

        Self::navigate_expr_slice(root_node, &path[1..], role)
    }

    fn navigate_expr_slice<'a>(
        spanned: &'a Spanned<Expr>,
        path: &[usize],
        role: SlotRole,
    ) -> Option<&'a [Spanned<Expr>]> {
        if path.is_empty() {
            return match role {
                SlotRole::Placeholder => Some(std::slice::from_ref(spanned)),
                _ => None,
            };
        }

        let branch = path[0];
        let rem = &path[1..];

        match &spanned.node {
            Expr::Fraction { num, den } => match branch {
                0 => {
                    if rem.is_empty() {
                        Some(num.as_slice())
                    } else {
                        num.get(rem[0])
                            .and_then(|item| Self::navigate_expr_slice(item, &rem[1..], role))
                    }
                }
                1 => {
                    if rem.is_empty() {
                        Some(den.as_slice())
                    } else {
                        den.get(rem[0])
                            .and_then(|item| Self::navigate_expr_slice(item, &rem[1..], role))
                    }
                }
                _ => None,
            },

            Expr::Root { index, radicand } => match branch {
                0 => {
                    let idx = index.as_ref()?;
                    if rem.is_empty() {
                        Some(idx.as_slice())
                    } else {
                        idx.get(rem[0])
                            .and_then(|item| Self::navigate_expr_slice(item, &rem[1..], role))
                    }
                }
                1 => {
                    if rem.is_empty() {
                        Some(radicand.as_slice())
                    } else {
                        radicand
                            .get(rem[0])
                            .and_then(|item| Self::navigate_expr_slice(item, &rem[1..], role))
                    }
                }
                _ => None,
            },

            Expr::Script { base, sub, sup } => match branch {
                0 => Self::navigate_expr_slice(base, rem, role),
                1 => {
                    let sub_box = sub.as_ref()?;
                    if rem.is_empty() {
                        match &sub_box.node {
                            Expr::Group(items) => Some(items.as_slice()),
                            _ => Some(std::slice::from_ref(sub_box.as_ref())),
                        }
                    } else {
                        Self::navigate_expr_slice(sub_box, rem, role)
                    }
                }
                2 => {
                    let sup_box = sup.as_ref()?;
                    if rem.is_empty() {
                        match &sup_box.node {
                            Expr::Group(items) => Some(items.as_slice()),
                            _ => Some(std::slice::from_ref(sup_box.as_ref())),
                        }
                    } else {
                        Self::navigate_expr_slice(sup_box, rem, role)
                    }
                }
                _ => None,
            },

            Expr::BigOperator {
                kind: _,
                lower,
                upper,
                body,
            } => match branch {
                0 => {
                    let low = lower.as_ref()?;
                    if rem.is_empty() {
                        Some(low.as_slice())
                    } else {
                        low.get(rem[0])
                            .and_then(|item| Self::navigate_expr_slice(item, &rem[1..], role))
                    }
                }
                1 => {
                    let up = upper.as_ref()?;
                    if rem.is_empty() {
                        Some(up.as_slice())
                    } else {
                        up.get(rem[0])
                            .and_then(|item| Self::navigate_expr_slice(item, &rem[1..], role))
                    }
                }
                2 => {
                    if rem.is_empty() {
                        Some(body.as_slice())
                    } else {
                        body.get(rem[0])
                            .and_then(|item| Self::navigate_expr_slice(item, &rem[1..], role))
                    }
                }
                _ => None,
            },

            Expr::Matrix { env: _, rows } => {
                let r = branch;
                let c = *rem.first()?;
                let cell = rows.get(r)?.get(c)?;
                let cell_rem = &rem[1..];
                if cell_rem.is_empty() {
                    Some(cell.as_slice())
                } else {
                    cell.get(cell_rem[0])
                        .and_then(|item| Self::navigate_expr_slice(item, &cell_rem[1..], role))
                }
            }

            Expr::Delimited { body, .. } | Expr::Style { body, .. } => {
                if branch == 0 {
                    if rem.is_empty() {
                        Some(body.as_slice())
                    } else {
                        body.get(rem[0])
                            .and_then(|item| Self::navigate_expr_slice(item, &rem[1..], role))
                    }
                } else {
                    None
                }
            }

            Expr::Group(items) => {
                let item = items.get(branch)?;
                Self::navigate_expr_slice(item, rem, role)
            }

            Expr::Placeholder { .. } => {
                if path.is_empty() {
                    Some(std::slice::from_ref(spanned))
                } else {
                    None
                }
            }

            _ => None,
        }
    }

    /// 替换指定槽位内的节点，并重新索引槽位表
    pub fn replace_slot(
        &mut self,
        slot_id: SlotId,
        new_nodes: Vec<Spanned<Expr>>,
    ) -> Result<Vec<Spanned<Expr>>, DocError> {
        let slot = self
            .slots
            .get(slot_id)
            .cloned()
            .ok_or(DocError::SlotNotFound(slot_id))?;

        let old = self.mutate_slot(&slot.path, slot.role, new_nodes)?;
        self.version += 1;
        self.rebuild_slots();
        Ok(old)
    }

    fn mutate_slot(
        &mut self,
        path: &AstPath,
        role: SlotRole,
        new_nodes: Vec<Spanned<Expr>>,
    ) -> Result<Vec<Spanned<Expr>>, DocError> {
        let steps = path.as_slice();
        if steps.is_empty() {
            let old = std::mem::replace(&mut self.nodes, new_nodes);
            return Ok(old);
        }

        let root_idx = steps[0];
        if root_idx >= self.nodes.len() {
            return Err(DocError::InvalidPath(path.clone()));
        }

        if steps.len() == 1 && role == SlotRole::Placeholder {
            let old = vec![self.nodes[root_idx].clone()];
            if new_nodes.is_empty() {
                self.nodes.remove(root_idx);
            } else {
                self.nodes.splice(root_idx..=root_idx, new_nodes);
            }
            return Ok(old);
        }

        Self::mutate_expr_slot(
            &mut self.nodes[root_idx],
            &steps[1..],
            role,
            new_nodes,
            path,
        )
    }

    fn mutate_expr_slot(
        spanned: &mut Spanned<Expr>,
        path: &[usize],
        _role: SlotRole,
        new_nodes: Vec<Spanned<Expr>>,
        orig_path: &AstPath,
    ) -> Result<Vec<Spanned<Expr>>, DocError> {
        if path.is_empty() {
            if matches!(spanned.node, Expr::Placeholder { .. }) {
                let old = vec![spanned.clone()];
                if new_nodes.is_empty() {
                    // 清空槽位时保留空占位符，防止 AST 节点塌陷
                    *spanned = Spanned::new(
                        Expr::Placeholder {
                            slot_id: SlotId(0),
                            label: None,
                        },
                        spanned.span,
                    );
                } else if new_nodes.len() == 1 {
                    // 单节点直接就地解包替换
                    *spanned = new_nodes.into_iter().next().unwrap();
                } else {
                    // 多节点安全包裹为 Group，杜绝丢弃后续表达式节点（如 "x + y"）
                    *spanned = Spanned::new(Expr::Group(new_nodes), spanned.span);
                }
                return Ok(old);
            }
            return Err(DocError::InvalidPath(orig_path.clone()));
        }

        let branch = path[0];
        let rem = &path[1..];

        match &mut spanned.node {
            Expr::Fraction { num, den } => match branch {
                0 => {
                    if rem.is_empty() {
                        Ok(std::mem::replace(num, new_nodes))
                    } else {
                        let item = num
                            .get_mut(rem[0])
                            .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                        Self::mutate_expr_slot(item, &rem[1..], _role, new_nodes, orig_path)
                    }
                }
                1 => {
                    if rem.is_empty() {
                        Ok(std::mem::replace(den, new_nodes))
                    } else {
                        let item = den
                            .get_mut(rem[0])
                            .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                        Self::mutate_expr_slot(item, &rem[1..], _role, new_nodes, orig_path)
                    }
                }
                _ => Err(DocError::InvalidPath(orig_path.clone())),
            },

            Expr::Root { index, radicand } => match branch {
                0 => {
                    if rem.is_empty() {
                        let old = index.take().unwrap_or_default();
                        *index = Some(new_nodes);
                        Ok(old)
                    } else {
                        let idx = index
                            .as_mut()
                            .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                        let item = idx
                            .get_mut(rem[0])
                            .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                        Self::mutate_expr_slot(item, &rem[1..], _role, new_nodes, orig_path)
                    }
                }
                1 => {
                    if rem.is_empty() {
                        Ok(std::mem::replace(radicand, new_nodes))
                    } else {
                        let item = radicand
                            .get_mut(rem[0])
                            .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                        Self::mutate_expr_slot(item, &rem[1..], _role, new_nodes, orig_path)
                    }
                }
                _ => Err(DocError::InvalidPath(orig_path.clone())),
            },

            Expr::Delimited { body, .. } | Expr::Style { body, .. } => {
                if branch == 0 {
                    if rem.is_empty() {
                        Ok(std::mem::replace(body, new_nodes))
                    } else {
                        let item = body
                            .get_mut(rem[0])
                            .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                        Self::mutate_expr_slot(item, &rem[1..], _role, new_nodes, orig_path)
                    }
                } else {
                    Err(DocError::InvalidPath(orig_path.clone()))
                }
            }

            Expr::BigOperator {
                kind: _,
                lower,
                upper,
                body,
            } => match branch {
                0 => {
                    if rem.is_empty() {
                        let old = lower.take().unwrap_or_default();
                        *lower = Some(new_nodes);
                        Ok(old)
                    } else {
                        let low = lower
                            .as_mut()
                            .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                        let item = low
                            .get_mut(rem[0])
                            .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                        Self::mutate_expr_slot(item, &rem[1..], _role, new_nodes, orig_path)
                    }
                }
                1 => {
                    if rem.is_empty() {
                        let old = upper.take().unwrap_or_default();
                        *upper = Some(new_nodes);
                        Ok(old)
                    } else {
                        let up = upper
                            .as_mut()
                            .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                        let item = up
                            .get_mut(rem[0])
                            .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                        Self::mutate_expr_slot(item, &rem[1..], _role, new_nodes, orig_path)
                    }
                }
                2 => {
                    if rem.is_empty() {
                        Ok(std::mem::replace(body, new_nodes))
                    } else {
                        let item = body
                            .get_mut(rem[0])
                            .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                        Self::mutate_expr_slot(item, &rem[1..], _role, new_nodes, orig_path)
                    }
                }
                _ => Err(DocError::InvalidPath(orig_path.clone())),
            },

            Expr::Matrix { env: _, rows } => {
                let r = branch;
                let c = *rem
                    .first()
                    .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                let cell_rem = &rem[1..];
                let row = rows
                    .get_mut(r)
                    .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                let cell = row
                    .get_mut(c)
                    .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;

                if cell_rem.is_empty() {
                    Ok(std::mem::replace(cell, new_nodes))
                } else {
                    let item = cell
                        .get_mut(cell_rem[0])
                        .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                    Self::mutate_expr_slot(item, &cell_rem[1..], _role, new_nodes, orig_path)
                }
            }

            Expr::Group(items) => {
                let item = items
                    .get_mut(branch)
                    .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                Self::mutate_expr_slot(item, rem, _role, new_nodes, orig_path)
            }

            Expr::Script { base, sub, sup } => match branch {
                0 => Self::mutate_expr_slot(base, rem, _role, new_nodes, orig_path),
                1 => {
                    let sub_box = sub
                        .as_mut()
                        .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                    if rem.is_empty() {
                        let old = match &mut sub_box.node {
                            Expr::Group(items) => std::mem::replace(items, new_nodes),
                            _ => {
                                let old = vec![*sub_box.clone()];
                                if new_nodes.len() == 1 {
                                    **sub_box = new_nodes.into_iter().next().unwrap();
                                } else {
                                    **sub_box =
                                        Spanned::new(Expr::Group(new_nodes), Span::point(0));
                                }
                                old
                            }
                        };
                        Ok(old)
                    } else {
                        Self::mutate_expr_slot(sub_box, rem, _role, new_nodes, orig_path)
                    }
                }
                2 => {
                    let sup_box = sup
                        .as_mut()
                        .ok_or_else(|| DocError::InvalidPath(orig_path.clone()))?;
                    if rem.is_empty() {
                        let old = match &mut sup_box.node {
                            Expr::Group(items) => std::mem::replace(items, new_nodes),
                            _ => {
                                let old = vec![*sup_box.clone()];
                                if new_nodes.len() == 1 {
                                    **sup_box = new_nodes.into_iter().next().unwrap();
                                } else {
                                    **sup_box =
                                        Spanned::new(Expr::Group(new_nodes), Span::point(0));
                                }
                                old
                            }
                        };
                        Ok(old)
                    } else {
                        Self::mutate_expr_slot(sup_box, rem, _role, new_nodes, orig_path)
                    }
                }
                _ => Err(DocError::InvalidPath(orig_path.clone())),
            },

            Expr::Placeholder { .. } => Err(DocError::InvalidPath(orig_path.clone())),

            _ => Err(DocError::InvalidPath(orig_path.clone())),
        }
    }

    /// 清空槽位内容
    pub fn clear_slot(&mut self, slot_id: SlotId) -> Result<Vec<Spanned<Expr>>, DocError> {
        self.replace_slot(slot_id, Vec::new())
    }
}

fn is_slice_empty(nodes: &[Spanned<Expr>]) -> bool {
    nodes.is_empty()
        || nodes
            .iter()
            .all(|n| matches!(n.node, Expr::Placeholder { .. }))
}

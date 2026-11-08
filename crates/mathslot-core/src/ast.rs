use crate::command::{StructKind, SymbolCmd};
use crate::library::{CustomFormat, LayoutKind};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Pos {
    pub char_idx: usize,
    pub byte_idx: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Span {
    pub start: Pos,
    pub end: Pos,
}

impl Span {
    pub fn contains_cursor(&self, cursor_char_idx: usize) -> bool {
        self.start.char_idx <= cursor_char_idx && cursor_char_idx <= self.end.char_idx
    }
}

/// 供辅助查询/测试了解待填槽位位置（书写顺序）
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EmptySlotTarget {
    pub role_hint: String,
    pub span: Span,
    pub target_char_idx: usize,
    pub missing_semis_at_eof: usize,
}

#[derive(Clone, Debug)]
pub enum NavEntryKind {
    /// 当前序列/槽位的最前端锚点（恒为 `[a]`，根级即跳往整行行首 `char_idx = 0`）
    ScopeStart,
    /// 当前序列/槽位的最末端锚点（恒为 `[;]`，根级即跳往整行行尾 `char_idx = char_len`）
    ScopeEnd,
    /// 叶子锚点（普通文本、独立符号或不含嵌套结构的简单槽位，按对应字母一步直达）
    Leaf {
        is_empty: bool,
        role_hint: Option<String>,
    },
    /// 复合槽位（槽内含有嵌套的数学结构，在外层折叠为单个 `[x+]`，选中后展开为独立子式）
    Composite {
        role_hint: String,
        struct_item_idx: usize,
        slot_idx: usize,
        sub_scope: Box<NavScope>,
    },
}

#[derive(Clone, Debug)]
pub struct NavEntry {
    pub local_idx: usize,
    pub label: String,
    pub span: Span,
    pub target_char_idx: usize,
    pub missing_semis_at_eof: usize,
    pub kind: NavEntryKind,
}

#[derive(Clone, Debug)]
pub struct NavScope {
    pub title: String,
    pub seq_span: Span,
    pub entries: Vec<NavEntry>,
}

impl NavScope {
    /// 计算光标在当前导航层级中命中的徽章下标
    pub fn active_entry_idx(&self, cursor_char: usize) -> Option<usize> {
        if self.entries.len() <= 1 {
            return self.entries.first().map(|_| 0);
        }

        for entry in &self.entries {
            if entry.missing_semis_at_eof > 0 {
                continue;
            }
            if matches!(entry.kind, NavEntryKind::Leaf { is_empty: true, .. })
                && entry.span.contains_cursor(cursor_char)
            {
                return Some(entry.local_idx);
            }
        }

        if cursor_char == self.seq_span.start.char_idx {
            return Some(0);
        }

        let mut best: Option<&NavEntry> = None;
        for entry in &self.entries {
            if matches!(entry.kind, NavEntryKind::ScopeStart | NavEntryKind::ScopeEnd)
                || entry.missing_semis_at_eof > 0
            {
                continue;
            }
            if entry.span.contains_cursor(cursor_char) {
                best = Some(match best {
                    None => entry,
                    Some(prev) => {
                        let cur_after_start = cursor_char > entry.span.start.char_idx;
                        let prev_after_start = cursor_char > prev.span.start.char_idx;
                        if cur_after_start && !prev_after_start {
                            entry
                        } else if !cur_after_start && prev_after_start {
                            prev
                        } else {
                            let prev_len = prev
                                .span
                                .end
                                .char_idx
                                .saturating_sub(prev.span.start.char_idx);
                            let cur_len = entry
                                .span
                                .end
                                .char_idx
                                .saturating_sub(entry.span.start.char_idx);
                            if cur_len <= prev_len { entry } else { prev }
                        }
                    }
                });
            }
        }

        if let Some(hit) = best {
            return Some(hit.local_idx);
        }

        if cursor_char >= self.seq_span.end.char_idx
            && let Some(end_entry) = self
                .entries
                .iter()
                .find(|e| matches!(e.kind, NavEntryKind::ScopeEnd))
        {
            return Some(end_entry.local_idx);
        }

        None
    }
}

#[derive(Clone, Debug)]
pub struct SlotNode {
    pub seq: MathSeq,
    pub role_hint: String,
    pub is_empty: bool,
    pub scope_entry_idx: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct MathSeq {
    pub items: Vec<Expr>,
    pub span: Span,
    pub closing_semi: Option<Pos>,
    pub missing_semis_at_eof: usize,
}

#[derive(Clone, Debug)]
pub enum Expr {
    Text {
        raw: String,
        span: Span,
        scope_entry_idx: Option<usize>,
    },
    Symbol {
        cmd: SymbolCmd,
        span: Span,
        scope_entry_idx: Option<usize>,
    },
    Struct {
        kind: StructKind,
        cmd_span: Span,
        slots: Vec<SlotNode>,
        full_span: Span,
    },
    CustomStruct {
        format: CustomFormat,
        cmd_span: Span,
        slots: Vec<SlotNode>,
        full_span: Span,
        scope_entry_idx: Option<usize>,
    },
    PendingCmd {
        partial: String,
        span: Span,
    },
    UnknownCmd {
        code: String,
        span: Span,
    },
}

impl Expr {
    pub fn span(&self) -> Span {
        match self {
            Expr::Text { span, .. }
            | Expr::Symbol { span, .. }
            | Expr::PendingCmd { span, .. }
            | Expr::UnknownCmd { span, .. } => *span,
            Expr::Struct { full_span, .. } | Expr::CustomStruct { full_span, .. } => *full_span,
        }
    }

    pub fn slots(&self) -> Option<&[SlotNode]> {
        match self {
            Expr::Struct { slots, .. } => Some(slots.as_slice()),
            Expr::CustomStruct { slots, .. } if !slots.is_empty() => Some(slots.as_slice()),
            _ => None,
        }
    }

    pub fn cmd_span(&self) -> Option<Span> {
        match self {
            Expr::Struct { cmd_span, .. } | Expr::CustomStruct { cmd_span, .. } => Some(*cmd_span),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActiveBreadcrumb {
    pub kind: Option<StructKind>,
    pub label: String,
    pub code: String,
    pub slot_roles: Vec<String>,
    pub slot_index: usize,
    pub role_hint: String,
}

#[derive(Clone, Debug)]
pub struct ParsedDoc {
    pub root: MathSeq,
    pub root_scope: NavScope,
    pub empty_slots: Vec<EmptySlotTarget>,
    pub char_len: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InnermostSlotState {
    AtRoot,
    InClosedSlot { closing_semi: Pos },
    InUnclosedSlot { slot_end: Pos },
}

#[derive(Clone, Copy)]
pub struct ResolvedStage<'a> {
    pub scope: &'a NavScope,
    pub seq: &'a MathSeq,
    pub via_label: Option<&'a str>,
}

impl ParsedDoc {
    /// 返回光标当前所处的结构嵌套面包屑路径（从外层到最内层）
    pub fn breadcrumbs_at(&self, cursor_char_idx: usize) -> Vec<ActiveBreadcrumb> {
        let clamped = cursor_char_idx.min(self.char_len);
        let mut out = Vec::new();
        collect_breadcrumbs(&self.root, clamped, &mut out);
        out
    }

    /// 查询光标所在的最内层结构槽位的闭合状态
    pub fn innermost_slot_state(&self, cursor_char_idx: usize) -> InnermostSlotState {
        let clamped = cursor_char_idx.min(self.char_len);
        find_innermost_slot(&self.root, clamped).unwrap_or(InnermostSlotState::AtRoot)
    }

    /// 定位光标当前正处于哪一个最内层槽位（用于嵌套根号/分式/上下标的精确层级框高亮！）
    pub fn innermost_active_slot_span(&self, cursor_char_idx: usize) -> Option<Span> {
        let clamped = cursor_char_idx.min(self.char_len);
        find_innermost_slot_span(&self.root, clamped)
    }

    /// 获取光标所在的最内层序列（用于判断前置包裹范围）
    pub fn innermost_seq_at(&self, cursor_char_idx: usize) -> &MathSeq {
        let clamped = cursor_char_idx.min(self.char_len);
        find_innermost_seq(&self.root, clamped).unwrap_or(&self.root)
    }

    /// 提取光标当前所在最内层子结构（如某个分式/根号/积分）的完整流文本，便于一键存为可复用片段模版！
    pub fn innermost_struct_substr<'a>(
        &'a self,
        source: &'a str,
        cursor_char_idx: usize,
    ) -> Option<(String, &'a str)> {
        let clamped = cursor_char_idx.min(self.char_len);
        find_innermost_struct_slice(&self.root, source, clamped)
    }

    /// 计算 2D 上下方向键（`Up` / `Down`）的直觉跳转目标 `(target_char_idx, missing_semis, desc)`
    pub fn vertical_arrow_target(
        &self,
        cursor_char_idx: usize,
        go_up: bool,
    ) -> Option<(usize, usize, String)> {
        let clamped = cursor_char_idx.min(self.char_len);
        let mut chain = Vec::new();
        collect_enclosing_structs(&self.root, clamped, &mut chain);

        if chain.is_empty() {
            if go_up {
                if clamped > 0 {
                    return Some((0, 0, "行首 [a]".to_owned()));
                }
                return None;
            } else {
                // 在顶层按 Down：优先进入全式首个结构槽位，否则跳至行尾 `[;]`
                if let Some((t, m, desc)) = first_child_struct_slot(&self.root) {
                    if t != clamped || m > 0 {
                        return Some((t, m, desc));
                    }
                }
                if clamped < self.char_len {
                    return Some((self.char_len, 0, "行尾 [;]".to_owned()));
                }
                return None;
            }
        }

        // 1. 从最内层向外寻找存在垂直配对槽位（如分子<->分母、上下限、矩阵上下行）的结构
        for ctx in chain.iter().rev() {
            if !go_up
                && let Some(cur_slot) = ctx.slots.get(ctx.slot_idx)
                && let Some(child_hit) = first_child_struct_slot(&cur_slot.seq)
                && child_hit.0 != clamped
            {
                return Some(child_hit);
            }

            let partner_idx = if let Some(kind) = ctx.kind {
                vertical_partner_slot(kind, ctx.slot_idx, go_up)
            } else if let Some(fmt) = ctx.custom_format {
                match &fmt.layout {
                    LayoutKind::Env { cols, .. } => {
                        let cols = (*cols).max(1);
                        let total = ctx.slots.len();
                        if go_up {
                            if ctx.slot_idx >= cols {
                                Some(ctx.slot_idx - cols)
                            } else {
                                None
                            }
                        } else if ctx.slot_idx + cols < total {
                            Some(ctx.slot_idx + cols)
                        } else {
                            None
                        }
                    }
                    LayoutKind::Linear => None,
                }
            } else {
                None
            };

            if let Some(partner_idx) = partner_idx
                && let Some(target_slot) = ctx.slots.get(partner_idx)
            {
                let desc = format!("{}·{}", ctx.label, target_slot.role_hint);
                return Some((
                    target_slot.seq.span.end.char_idx,
                    target_slot.seq.missing_semis_at_eof,
                    desc,
                ));
            }
        }

        // 2. 若无垂直兄弟槽（如嵌套根号、括号等）：
        //    - 按 Up：向外跳出最内层结构到外层父槽（如从内层根号跳出到外层根号！）
        //    - 按 Down：推进到当前结构的下一槽或跳至最外层结构后方
        let innermost = chain.last().expect("non-empty");
        if go_up {
            if let Some(last_slot) = innermost.slots.last() {
                if last_slot.seq.closing_semi.is_some() {
                    return Some((
                        innermost.full_span.end.char_idx,
                        0,
                        format!("跳出「{}」到外层", innermost.label),
                    ));
                } else {
                    let unclosed = innermost
                        .slots
                        .iter()
                        .filter(|s| s.seq.closing_semi.is_none())
                        .count()
                        .max(1);
                    return Some((
                        self.char_len,
                        unclosed,
                        format!("闭合「{}」回到外层", innermost.label),
                    ));
                }
            }
        } else if innermost.slot_idx + 1 < innermost.slots.len() {
            let next_slot = &innermost.slots[innermost.slot_idx + 1];
            return Some((
                next_slot.seq.span.end.char_idx,
                next_slot.seq.missing_semis_at_eof,
                format!("{}·{}", innermost.label, next_slot.role_hint),
            ));
        } else if innermost.full_span.end.char_idx > clamped {
            return Some((
                innermost.full_span.end.char_idx,
                0,
                format!("跨出「{}」末尾", innermost.label),
            ));
        }

        None
    }

    /// 若光标当前正位于某个多层嵌套复合槽内部，自动返回从根到最深复合槽的标签路径
    pub fn cursor_composite_path(&self, cursor_char_idx: usize) -> Vec<String> {
        let clamped = cursor_char_idx.min(self.char_len);
        let mut path = Vec::new();
        let mut cur_scope = &self.root_scope;
        while let Some(entry) = cur_scope.entries.iter().find(|e| {
            e.missing_semis_at_eof == 0
                && matches!(e.kind, NavEntryKind::Composite { .. })
                && e.span.contains_cursor(clamped)
        }) {
            if let NavEntryKind::Composite { sub_scope, .. } = &entry.kind {
                path.push(entry.label.clone());
                cur_scope = sub_scope;
            } else {
                break;
            }
        }
        path
    }

    /// 按复合槽标签路径解析每一层对应的 `(NavScope, MathSeq)` 链
    pub fn resolve_scope_chain<'a>(&'a self, path: &'a [String]) -> Vec<ResolvedStage<'a>> {
        let mut chain = vec![ResolvedStage {
            scope: &self.root_scope,
            seq: &self.root,
            via_label: None,
        }];
        let mut cur_scope = &self.root_scope;
        let mut cur_seq = &self.root;

        for step_label in path {
            let Some(entry) = cur_scope.entries.iter().find(|e| e.label == *step_label) else {
                break;
            };
            let NavEntryKind::Composite {
                struct_item_idx,
                slot_idx,
                sub_scope,
                ..
            } = &entry.kind
            else {
                break;
            };
            let Some(slots) = cur_seq.items.get(*struct_item_idx).and_then(Expr::slots) else {
                break;
            };
            let Some(slot_node) = slots.get(*slot_idx) else {
                break;
            };
            cur_scope = sub_scope.as_ref();
            cur_seq = &slot_node.seq;
            chain.push(ResolvedStage {
                scope: cur_scope,
                seq: cur_seq,
                via_label: Some(entry.label.as_str()),
            });
        }
        chain
    }
}

struct EnclosingStruct<'a> {
    kind: Option<StructKind>,
    custom_format: Option<&'a CustomFormat>,
    label: String,
    slots: &'a [SlotNode],
    slot_idx: usize,
    full_span: Span,
}

fn collect_enclosing_structs<'a>(
    seq: &'a MathSeq,
    cursor: usize,
    out: &mut Vec<EnclosingStruct<'a>>,
) {
    for item in &seq.items {
        if !item.span().contains_cursor(cursor) {
            continue;
        }
        let (kind, custom_format, label, cmd_span, slots, full_span) = match item {
            Expr::Struct {
                kind,
                cmd_span,
                slots,
                full_span,
            } => (
                Some(*kind),
                None,
                kind.label().to_owned(),
                *cmd_span,
                slots.as_slice(),
                *full_span,
            ),
            Expr::CustomStruct {
                format,
                cmd_span,
                slots,
                full_span,
                ..
            } if !slots.is_empty() => (
                None,
                Some(format),
                format.label.clone(),
                *cmd_span,
                slots.as_slice(),
                *full_span,
            ),
            _ => continue,
        };

        if cmd_span.start.char_idx < cursor && cursor < cmd_span.end.char_idx {
            out.push(EnclosingStruct {
                kind,
                custom_format,
                label,
                slots,
                slot_idx: 0,
                full_span,
            });
            return;
        }
        for (idx, slot) in slots.iter().enumerate() {
            if slot.seq.missing_semis_at_eof == 0 && slot.seq.span.contains_cursor(cursor) {
                out.push(EnclosingStruct {
                    kind,
                    custom_format,
                    label,
                    slots,
                    slot_idx: idx,
                    full_span,
                });
                collect_enclosing_structs(&slot.seq, cursor, out);
                return;
            }
        }
    }
}

fn vertical_partner_slot(kind: StructKind, cur_idx: usize, go_up: bool) -> Option<usize> {
    match kind {
        StructKind::Frac | StructKind::PartialFrac | StructKind::TotalFrac => match (cur_idx, go_up) {
            (0, false) => Some(1),
            (1, true) => Some(0),
            _ => None,
        },
        StructKind::Sup | StructKind::Overbrace => match (cur_idx, go_up) {
            (0, true) => Some(1),
            (1, false) => Some(0),
            _ => None,
        },
        StructKind::Sub | StructKind::Underbrace => match (cur_idx, go_up) {
            (0, false) => Some(1),
            (1, true) => Some(0),
            _ => None,
        },
        StructKind::SubSup | StructKind::EvalBar => match (cur_idx, go_up) {
            (2, false) => Some(0),
            (0, false) => Some(1),
            (1, true) => Some(0),
            (0, true) => Some(2),
            _ => None,
        },
        StructKind::Integral | StructKind::Sum | StructKind::Product => match (cur_idx, go_up) {
            (1, false) => Some(0),
            (0, true) => Some(1),
            (2, true) => Some(1),
            (2, false) => Some(0),
            _ => None,
        },
        StructKind::DoubleIntegral | StructKind::ContourIntegral | StructKind::TripleIntegral => match (cur_idx, go_up) {
            (1, false) => Some(0),
            (0, true) => Some(1),
            _ => None,
        },
        StructKind::Limit => match (cur_idx, go_up) {
            (2, false) => Some(0),
            (0 | 1, true) => Some(2),
            _ => None,
        },
        StructKind::NthRoot => match (cur_idx, go_up) {
            (0, false) => Some(1),
            (1, true) => Some(0),
            _ => None,
        },
        StructKind::Matrix2 | StructKind::Det2 | StructKind::Cases2 | StructKind::BMatrix2 => {
            let r = cur_idx / 2;
            let c = cur_idx % 2;
            if !go_up && r == 0 {
                Some(2 + c)
            } else if go_up && r == 1 {
                Some(c)
            } else {
                None
            }
        }
        StructKind::Matrix3 | StructKind::BMatrix3 | StructKind::Det3 => {
            let r = cur_idx / 3;
            let c = cur_idx % 3;
            if !go_up && r < 2 {
                Some((r + 1) * 3 + c)
            } else if go_up && r > 0 {
                Some((r - 1) * 3 + c)
            } else {
                None
            }
        }
        StructKind::Cases3 => {
            let r = cur_idx / 2;
            let c = cur_idx % 2;
            if !go_up && r < 2 {
                Some((r + 1) * 2 + c)
            } else if go_up && r > 0 {
                Some((r - 1) * 2 + c)
            } else {
                None
            }
        }
        _ => None,
    }
}

fn first_child_struct_slot(seq: &MathSeq) -> Option<(usize, usize, String)> {
    for item in &seq.items {
        match item {
            Expr::Struct { kind, slots, .. } => {
                if let Some(first) = slots.first() {
                    return Some((
                        first.seq.span.end.char_idx,
                        first.seq.missing_semis_at_eof,
                        format!("{}·{}", kind.label(), first.role_hint),
                    ));
                }
            }
            Expr::CustomStruct { format, slots, .. } if !slots.is_empty() => {
                if let Some(first) = slots.first() {
                    return Some((
                        first.seq.span.end.char_idx,
                        first.seq.missing_semis_at_eof,
                        format!("{}·{}", format.label, first.role_hint),
                    ));
                }
            }
            _ => {}
        }
    }
    None
}

fn find_innermost_seq(seq: &MathSeq, cursor: usize) -> Option<&MathSeq> {
    for item in &seq.items {
        if let Some(slots) = item.slots() {
            for slot in slots {
                if slot.seq.missing_semis_at_eof == 0 && slot.seq.span.contains_cursor(cursor) {
                    if let Some(deeper) = find_innermost_seq(&slot.seq, cursor) {
                        return Some(deeper);
                    }
                    return Some(&slot.seq);
                }
            }
        }
    }
    None
}

fn find_innermost_struct_slice<'a>(
    seq: &'a MathSeq,
    source: &'a str,
    cursor: usize,
) -> Option<(String, &'a str)> {
    for item in &seq.items {
        let (label, slots, full_span) = match item {
            Expr::Struct {
                kind,
                slots,
                full_span,
                ..
            } => (kind.label().to_owned(), slots.as_slice(), *full_span),
            Expr::CustomStruct {
                format,
                slots,
                full_span,
                ..
            } if !slots.is_empty() => (format.label.clone(), slots.as_slice(), *full_span),
            _ => continue,
        };
        if full_span.contains_cursor(cursor) && cursor > full_span.start.char_idx {
            for slot in slots {
                if slot.seq.missing_semis_at_eof == 0
                    && slot.seq.span.contains_cursor(cursor)
                    && let Some(deeper) = find_innermost_struct_slice(&slot.seq, source, cursor)
                {
                    return Some(deeper);
                }
            }
            let slice = &source[full_span.start.byte_idx..full_span.end.byte_idx];
            if !slice.trim().is_empty() {
                return Some((label, slice));
            }
        }
    }
    None
}

fn find_innermost_slot_span(seq: &MathSeq, cursor: usize) -> Option<Span> {
    for item in &seq.items {
        if let (Some(cmd_span), Some(slots)) = (item.cmd_span(), item.slots()) {
            if cmd_span.start.char_idx < cursor && cursor < cmd_span.end.char_idx {
                return slots.first().map(|s| s.seq.span);
            }
            for slot in slots {
                if slot.seq.missing_semis_at_eof == 0 && slot.seq.span.contains_cursor(cursor) {
                    if let Some(deeper) = find_innermost_slot_span(&slot.seq, cursor) {
                        return Some(deeper);
                    }
                    return Some(slot.seq.span);
                }
            }
        }
    }
    None
}

fn collect_breadcrumbs(seq: &MathSeq, cursor: usize, out: &mut Vec<ActiveBreadcrumb>) {
    for item in &seq.items {
        if !item.span().contains_cursor(cursor) {
            continue;
        }
        let (kind_opt, label, code, roles, cmd_span, slots) = match item {
            Expr::Struct {
                kind,
                cmd_span,
                slots,
                ..
            } => (
                Some(*kind),
                kind.label().to_owned(),
                kind.code().to_owned(),
                kind.slot_roles()
                    .iter()
                    .map(|r| (*r).to_owned())
                    .collect::<Vec<_>>(),
                *cmd_span,
                slots.as_slice(),
            ),
            Expr::CustomStruct {
                format,
                cmd_span,
                slots,
                ..
            } if !slots.is_empty() => (
                None,
                format.label.clone(),
                format.code(),
                format.slot_roles.clone(),
                *cmd_span,
                slots.as_slice(),
            ),
            _ => continue,
        };

        if cmd_span.start.char_idx < cursor && cursor < cmd_span.end.char_idx {
            if let Some(first) = slots.first() {
                out.push(ActiveBreadcrumb {
                    kind: kind_opt,
                    label,
                    code,
                    slot_roles: roles,
                    slot_index: 0,
                    role_hint: first.role_hint.clone(),
                });
            }
            return;
        }
        for (idx, slot) in slots.iter().enumerate() {
            if slot.seq.missing_semis_at_eof == 0 && slot.seq.span.contains_cursor(cursor) {
                out.push(ActiveBreadcrumb {
                    kind: kind_opt,
                    label,
                    code,
                    slot_roles: roles,
                    slot_index: idx,
                    role_hint: slot.role_hint.clone(),
                });
                collect_breadcrumbs(&slot.seq, cursor, out);
                return;
            }
        }
    }
}

fn find_innermost_slot(seq: &MathSeq, cursor: usize) -> Option<InnermostSlotState> {
    for item in &seq.items {
        if let Some(slots) = item.slots() {
            for slot in slots {
                if slot.seq.missing_semis_at_eof == 0 && slot.seq.span.contains_cursor(cursor) {
                    if let Some(deeper) = find_innermost_slot(&slot.seq, cursor) {
                        return Some(deeper);
                    }
                    return Some(match slot.seq.closing_semi {
                        Some(semi) => InnermostSlotState::InClosedSlot { closing_semi: semi },
                        None => InnermostSlotState::InUnclosedSlot {
                            slot_end: slot.seq.span.end,
                        },
                    });
                }
            }
        }
    }
    None
}

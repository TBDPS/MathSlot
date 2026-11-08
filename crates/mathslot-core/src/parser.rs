use crate::ast::{
    EmptySlotTarget, Expr, MathSeq, NavEntry, NavEntryKind, NavScope, ParsedDoc, Pos, SlotNode,
    Span,
};
use crate::command::{
    CMD_PREFIX, CommandTarget, STEP_SEP, StructKind, SubCategory, lookup_direct,
    lookup_sub_command,
};
use crate::library::{CustomFormat, UserLibrary};

pub fn parse(source: &str) -> ParsedDoc {
    let default_lib = UserLibrary::default_seeded();
    parse_with_library(source, &default_lib)
}

pub fn parse_with_library(source: &str, lib: &UserLibrary) -> ParsedDoc {
    let mut parser = Parser::new(source, lib);
    let mut root = parser.parse_seq(false);
    let mut empty_slots = Vec::new();
    collect_empty_slots(&root, &mut empty_slots);
    let root_scope = build_nav_scope(&mut root, "主结构".to_owned());

    ParsedDoc {
        root,
        root_scope,
        empty_slots,
        char_len: parser.chars.len(),
    }
}

/// 统计文档中尚未显式以 `;` 闭合的槽位总数（在末尾补齐该数量的 `;` 即可闭合所有嵌套层级）
pub fn count_unclosed_slots(doc: &ParsedDoc) -> usize {
    fn walk_seq(seq: &MathSeq) -> usize {
        let mut count = 0;
        for item in &seq.items {
            if let Some(slots) = item.slots() {
                for slot in slots {
                    if slot.seq.closing_semi.is_none() {
                        count += 1;
                    }
                    count += walk_seq(&slot.seq);
                }
            }
        }
        count
    }
    walk_seq(&doc.root)
}

/// 生成严格无前缀的小写字母标签序列（严格剔除 `p` 与 `n`，将 p/n 专属保留给跳转历史的前进/后退）
pub fn generate_nav_labels(count: usize) -> Vec<String> {
    if count == 0 {
        return Vec::new();
    }
    // 严格剔除 'p' 与 'n'，将 p/n 专属保留给跳转历史序列的后退 (Previous) 与前进 (Next)
    let alphabet: Vec<char> = ('a'..='z').filter(|&c| c != 'p' && c != 'n').collect();
    let alpha_len = alphabet.len(); // 24
    if count <= alpha_len {
        return alphabet[..count].iter().map(|c| c.to_string()).collect();
    }
    let capped = count.min(alpha_len * alpha_len);
    let expand_groups = (capped - alpha_len + (alpha_len - 2)) / (alpha_len - 1);
    let single_count = alpha_len.saturating_sub(expand_groups);

    let mut out = Vec::with_capacity(capped);
    for &c in &alphabet[..single_count] {
        out.push(c.to_string());
    }
    for &p in &alphabet[single_count..] {
        for &s in &alphabet {
            if out.len() == capped {
                return out;
            }
            out.push(format!("{p}{s}"));
        }
    }
    out
}

pub fn seq_has_meaningful_content(seq: &MathSeq) -> bool {
    seq.items.iter().any(|item| match item {
        Expr::Text { raw, .. } => !raw.trim().is_empty(),
        Expr::Symbol { .. } | Expr::Struct { .. } | Expr::CustomStruct { .. } => true,
        Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => false,
    })
}

pub fn seq_has_nested_struct(seq: &MathSeq) -> bool {
    seq.items.iter().any(|item| match item {
        Expr::Struct { .. } => true,
        Expr::CustomStruct { slots, .. } => !slots.is_empty(),
        _ => false,
    })
}

struct RawNavEntry {
    span: Span,
    target_char_idx: usize,
    missing_semis_at_eof: usize,
    kind: NavEntryKind,
}

fn build_nav_scope(seq: &mut MathSeq, title: String) -> NavScope {
    let mut raw_entries = Vec::new();

    // `[a]` 永远固定为当前作用域起点（在根级即为整行行首 `char_idx = 0`）
    raw_entries.push(RawNavEntry {
        span: Span {
            start: seq.span.start,
            end: seq.span.start,
        },
        target_char_idx: seq.span.start.char_idx,
        missing_semis_at_eof: seq.missing_semis_at_eof,
        kind: NavEntryKind::ScopeStart,
    });

    for (item_idx, item) in seq.items.iter_mut().enumerate() {
        match item {
            Expr::Text {
                raw,
                span,
                scope_entry_idx,
            } => {
                if !raw.trim().is_empty() {
                    let idx = raw_entries.len();
                    *scope_entry_idx = Some(idx);
                    raw_entries.push(RawNavEntry {
                        span: *span,
                        target_char_idx: span.end.char_idx,
                        missing_semis_at_eof: 0,
                        kind: NavEntryKind::Leaf {
                            is_empty: false,
                            role_hint: None,
                        },
                    });
                }
            }
            Expr::Symbol {
                span,
                scope_entry_idx,
                ..
            } => {
                let idx = raw_entries.len();
                *scope_entry_idx = Some(idx);
                raw_entries.push(RawNavEntry {
                    span: *span,
                    target_char_idx: span.end.char_idx,
                    missing_semis_at_eof: 0,
                    kind: NavEntryKind::Leaf {
                        is_empty: false,
                        role_hint: None,
                    },
                });
            }
            Expr::Struct { kind, slots, .. } => {
                let struct_label = kind.label().to_owned();
                push_struct_slots_nav(&struct_label, item_idx, slots, &mut raw_entries);
            }
            Expr::CustomStruct {
                format,
                slots,
                full_span,
                scope_entry_idx,
                ..
            } => {
                if slots.is_empty() {
                    let idx = raw_entries.len();
                    *scope_entry_idx = Some(idx);
                    raw_entries.push(RawNavEntry {
                        span: *full_span,
                        target_char_idx: full_span.end.char_idx,
                        missing_semis_at_eof: 0,
                        kind: NavEntryKind::Leaf {
                            is_empty: false,
                            role_hint: Some(format.label.clone()),
                        },
                    });
                } else {
                    push_struct_slots_nav(&format.label, item_idx, slots, &mut raw_entries);
                }
            }
            Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => {}
        }
    }

    let labels = generate_nav_labels(raw_entries.len());
    let mut entries: Vec<NavEntry> = raw_entries
        .into_iter()
        .enumerate()
        .map(|(local_idx, raw)| NavEntry {
            local_idx,
            label: labels
                .get(local_idx)
                .cloned()
                .unwrap_or_else(|| format!("z{local_idx}")),
            span: raw.span,
            target_char_idx: raw.target_char_idx,
            missing_semis_at_eof: raw.missing_semis_at_eof,
            kind: raw.kind,
        })
        .collect();

    // 当序列非空时，在最右侧追加 `[;]` 行尾/槽尾直达锚点（与最左侧 `[a]` 对称，不影响 `a..z` 编号！）
    if seq.span.end.char_idx > seq.span.start.char_idx {
        let end_idx = entries.len();
        entries.push(NavEntry {
            local_idx: end_idx,
            label: ";".to_owned(),
            span: Span {
                start: seq.span.end,
                end: seq.span.end,
            },
            target_char_idx: seq.span.end.char_idx,
            missing_semis_at_eof: 0,
            kind: NavEntryKind::ScopeEnd,
        });
    }

    NavScope {
        title,
        seq_span: seq.span,
        entries,
    }
}

fn push_struct_slots_nav(
    struct_label: &str,
    item_idx: usize,
    slots: &mut [SlotNode],
    raw_entries: &mut Vec<RawNavEntry>,
) {
    for (slot_idx, slot) in slots.iter_mut().enumerate() {
        let idx = raw_entries.len();
        slot.scope_entry_idx = Some(idx);
        if seq_has_nested_struct(&slot.seq) {
            let sub_title = format!("{struct_label}·{}", slot.role_hint);
            let sub_scope = build_nav_scope(&mut slot.seq, sub_title);
            raw_entries.push(RawNavEntry {
                span: slot.seq.span,
                target_char_idx: slot.seq.span.end.char_idx,
                missing_semis_at_eof: slot.seq.missing_semis_at_eof,
                kind: NavEntryKind::Composite {
                    role_hint: slot.role_hint.clone(),
                    struct_item_idx: item_idx,
                    slot_idx,
                    sub_scope: Box::new(sub_scope),
                },
            });
        } else {
            raw_entries.push(RawNavEntry {
                span: slot.seq.span,
                target_char_idx: slot.seq.span.end.char_idx,
                missing_semis_at_eof: slot.seq.missing_semis_at_eof,
                kind: NavEntryKind::Leaf {
                    is_empty: slot.is_empty,
                    role_hint: Some(slot.role_hint.clone()),
                },
            });
        }
    }
}

fn collect_empty_slots(seq: &MathSeq, out: &mut Vec<EmptySlotTarget>) {
    for item in &seq.items {
        if let Some(slots) = item.slots() {
            for slot in slots {
                if slot.is_empty {
                    out.push(EmptySlotTarget {
                        role_hint: slot.role_hint.clone(),
                        span: slot.seq.span,
                        target_char_idx: slot.seq.span.end.char_idx,
                        missing_semis_at_eof: slot.seq.missing_semis_at_eof,
                    });
                } else {
                    collect_empty_slots(&slot.seq, out);
                }
            }
        }
    }
}

struct Parser<'a> {
    source: &'a str,
    lib: &'a UserLibrary,
    chars: Vec<(Pos, char)>,
    eof_pos: Pos,
    idx: usize,
    unclosed_semis_at_eof: usize,
    depth: usize,
}

/// 结构嵌套递归深度上限：防止超深输入（如连续 10 万个 `▸f`）打爆调用栈
const MAX_PARSE_DEPTH: usize = 256;

impl<'a> Parser<'a> {
    fn new(source: &'a str, lib: &'a UserLibrary) -> Self {
        let mut chars = Vec::new();
        for (char_idx, (byte_idx, ch)) in source.char_indices().enumerate() {
            chars.push((Pos { char_idx, byte_idx }, ch));
        }
        let eof_pos = Pos {
            char_idx: chars.len(),
            byte_idx: source.len(),
        };
        Self {
            source,
            lib,
            chars,
            eof_pos,
            idx: 0,
            unclosed_semis_at_eof: 0,
            depth: 0,
        }
    }

    fn current_pos(&self) -> Pos {
        self.chars
            .get(self.idx)
            .map(|(pos, _)| *pos)
            .unwrap_or(self.eof_pos)
    }

    fn peek_char(&self, offset: usize) -> Option<char> {
        self.chars.get(self.idx + offset).map(|(_, ch)| *ch)
    }

    fn parse_seq(&mut self, stop_on_semi: bool) -> MathSeq {
        let start_pos = self.current_pos();
        let mut items = Vec::new();

        while let Some(c) = self.peek_char(0) {
            if c == STEP_SEP {
                if stop_on_semi {
                    let end_pos = self.current_pos();
                    self.idx += 1; // 消耗闭合 `;`
                    return MathSeq {
                        items,
                        span: Span {
                            start: start_pos,
                            end: end_pos,
                        },
                        closing_semi: Some(end_pos),
                        missing_semis_at_eof: 0,
                    };
                }
                // 顶层多余 `;` 作为无害分隔忽略
                self.idx += 1;
                continue;
            }

            if c == CMD_PREFIX {
                let item = self.parse_command();
                items.push(item);
                continue;
            }

            let text_start = self.current_pos();
            while let Some(nc) = self.peek_char(0) {
                if nc == CMD_PREFIX || nc == STEP_SEP {
                    break;
                }
                self.idx += 1;
            }
            let text_end = self.current_pos();
            let raw = self.source[text_start.byte_idx..text_end.byte_idx].to_owned();
            items.push(Expr::Text {
                raw,
                span: Span {
                    start: text_start,
                    end: text_end,
                },
                scope_entry_idx: None,
            });
        }

        let end_pos = self.current_pos();
        MathSeq {
            items,
            span: Span {
                start: start_pos,
                end: end_pos,
            },
            closing_semi: None,
            missing_semis_at_eof: 0,
        }
    }

    fn parse_command(&mut self) -> Expr {
        let cmd_start = self.current_pos();
        self.idx += 1; // 消耗 `▸`

        // 1. 内联导航指令 `▸j<letters | . | $ | ->`（在尚未被编辑器消费时作为 PendingCmd）
        if self.peek_char(0) == Some('j') {
            self.idx += 1;
            while let Some(ch) = self.peek_char(0) {
                if (ch.is_ascii_lowercase() || matches!(ch, '.' | '$' | '-'))
                    && (self.current_pos().char_idx - cmd_start.char_idx) < 8
                {
                    self.idx += 1;
                } else {
                    break;
                }
            }
            let cmd_end = self.current_pos();
            let partial = self.source[cmd_start.byte_idx..cmd_end.byte_idx].to_owned();
            return Expr::PendingCmd {
                partial,
                span: Span {
                    start: cmd_start,
                    end: cmd_end,
                },
            };
        }

        let Some(c1) = self.peek_char(0) else {
            let cmd_end = self.current_pos();
            let partial = self.source[cmd_start.byte_idx..cmd_end.byte_idx].to_owned();
            return Expr::PendingCmd {
                partial,
                span: Span {
                    start: cmd_start,
                    end: cmd_end,
                },
            };
        };

        if !c1.is_ascii_alphabetic() {
            let cmd_end = self.current_pos();
            let partial = self.source[cmd_start.byte_idx..cmd_end.byte_idx].to_owned();
            return Expr::PendingCmd {
                partial,
                span: Span {
                    start: cmd_start,
                    end: cmd_end,
                },
            };
        }

        let k1 = c1.to_ascii_lowercase();

        // 2. 单字母高频直达结构（如 `▸f`, `▸r`, `▸i`, `▸s`, `▸l`...）
        if let Some(kind) = lookup_direct(k1) {
            self.idx += 1;
            let cmd_end = self.current_pos();
            let cmd_span = Span {
                start: cmd_start,
                end: cmd_end,
            };
            return self.parse_struct_expr(kind, cmd_start, cmd_span);
        }

        // 2.1 用户自定义单字母直达（未占用字母如 'w', 'y', 'z', 'h' 等直接 1 键触发，免挤在 k 组）
        if SubCategory::from_key(k1).is_none() {
            if let Some(fmt) = self.lib.lookup_custom(k1) {
                self.idx += 1;
                let cmd_end = self.current_pos();
                let cmd_span = Span {
                    start: cmd_start,
                    end: cmd_end,
                };
                return self.parse_custom_struct_expr(fmt.clone(), cmd_start, cmd_span);
            }
        }

        // 3. 二级子菜单（静态 c / m / a / g / o + 动态自定义 k + 动态片段模版 t）
        if let Some(sub) = SubCategory::from_key(k1) {
            match sub {
                SubCategory::Custom => match self.peek_char(1) {
                    Some(c2) if c2.is_ascii_alphabetic() => {
                        self.idx += 2;
                        let cmd_end = self.current_pos();
                        let cmd_span = Span {
                            start: cmd_start,
                            end: cmd_end,
                        };
                        if let Some(fmt) = self.lib.lookup_custom(c2.to_ascii_lowercase()) {
                            return self.parse_custom_struct_expr(fmt.clone(), cmd_start, cmd_span);
                        }
                        return Expr::UnknownCmd {
                            code: format!("{c1}{c2}"),
                            span: cmd_span,
                        };
                    }
                    Some(_) => {
                        self.idx += 1;
                        let cmd_end = self.current_pos();
                        let cmd_span = Span {
                            start: cmd_start,
                            end: cmd_end,
                        };
                        if let Some(fmt) = self.lib.default_custom() {
                            return self.parse_custom_struct_expr(fmt.clone(), cmd_start, cmd_span);
                        }
                        return Expr::UnknownCmd {
                            code: c1.to_string(),
                            span: cmd_span,
                        };
                    }
                    None => {
                        self.idx += 1;
                        let cmd_end = self.current_pos();
                        let partial = self.source[cmd_start.byte_idx..cmd_end.byte_idx].to_owned();
                        return Expr::PendingCmd {
                            partial,
                            span: Span {
                                start: cmd_start,
                                end: cmd_end,
                            },
                        };
                    }
                },
                SubCategory::Template => match self.peek_char(1) {
                    Some(c2) if c2.is_ascii_alphabetic() => {
                        self.idx += 2;
                        let cmd_end = self.current_pos();
                        let cmd_span = Span {
                            start: cmd_start,
                            end: cmd_end,
                        };
                        if self.lib.lookup_snippet(c2.to_ascii_lowercase()).is_some() {
                            let partial =
                                self.source[cmd_start.byte_idx..cmd_end.byte_idx].to_owned();
                            return Expr::PendingCmd {
                                partial,
                                span: cmd_span,
                            };
                        }
                        return Expr::UnknownCmd {
                            code: format!("{c1}{c2}"),
                            span: cmd_span,
                        };
                    }
                    _ => {
                        self.idx += 1;
                        let cmd_end = self.current_pos();
                        let partial = self.source[cmd_start.byte_idx..cmd_end.byte_idx].to_owned();
                        return Expr::PendingCmd {
                            partial,
                            span: Span {
                                start: cmd_start,
                                end: cmd_end,
                            },
                        };
                    }
                },
                _ => match self.peek_char(1) {
                    Some(c2) if c2.is_ascii_alphabetic() => {
                        self.idx += 2;
                        let cmd_end = self.current_pos();
                        let cmd_span = Span {
                            start: cmd_start,
                            end: cmd_end,
                        };
                        return match lookup_sub_command(k1, c2).or_else(|| lookup_sub_command(k1, c2.to_ascii_lowercase())) {
                            Some(CommandTarget::Symbol(sym)) => Expr::Symbol {
                                cmd: sym,
                                span: cmd_span,
                                scope_entry_idx: None,
                            },
                            Some(CommandTarget::Struct(kind)) => {
                                self.parse_struct_expr(kind, cmd_start, cmd_span)
                            }
                            None => Expr::UnknownCmd {
                                code: format!("{c1}{c2}"),
                                span: cmd_span,
                            },
                        };
                    }
                    Some(_) => {
                        // 子菜单键后直接跟数字/分号/运算符时，自动回退选用该子菜单的默认条目
                        self.idx += 1;
                        let cmd_end = self.current_pos();
                        let cmd_span = Span {
                            start: cmd_start,
                            end: cmd_end,
                        };
                        if let Some(def) = sub.default_entry() {
                            return match def.target {
                                CommandTarget::Symbol(sym) => Expr::Symbol {
                                    cmd: sym,
                                    span: cmd_span,
                                    scope_entry_idx: None,
                                },
                                CommandTarget::Struct(kind) => {
                                    self.parse_struct_expr(kind, cmd_start, cmd_span)
                                }
                            };
                        }
                        return Expr::UnknownCmd {
                            code: c1.to_string(),
                            span: cmd_span,
                        };
                    }
                    None => {
                        // 位于输入末尾（如 `▸m|`），保持 PendingCmd 以便顶部展开子菜单提示
                        self.idx += 1;
                        let cmd_end = self.current_pos();
                        let partial = self.source[cmd_start.byte_idx..cmd_end.byte_idx].to_owned();
                        return Expr::PendingCmd {
                            partial,
                            span: Span {
                                start: cmd_start,
                                end: cmd_end,
                            },
                        };
                    }
                },
            }
        }

        // 4. 既非单字母直达也非子菜单键的无效首字母
        self.idx += 1;
        let cmd_end = self.current_pos();
        Expr::UnknownCmd {
            code: c1.to_string(),
            span: Span {
                start: cmd_start,
                end: cmd_end,
            },
        }
    }

    fn parse_struct_expr(&mut self, kind: StructKind, cmd_start: Pos, cmd_span: Span) -> Expr {
        if self.depth >= MAX_PARSE_DEPTH {
            return Expr::UnknownCmd {
                code: "?".to_owned(),
                span: cmd_span,
            };
        }
        self.depth += 1;
        let roles: Vec<String> = kind.slot_roles().iter().map(|r| (*r).to_owned()).collect();
        let slots = self.parse_slots_with_roles(&roles);
        self.depth -= 1;
        let full_end = self.current_pos();
        Expr::Struct {
            kind,
            cmd_span,
            slots,
            full_span: Span {
                start: cmd_start,
                end: full_end,
            },
        }
    }

    fn parse_custom_struct_expr(
        &mut self,
        format: CustomFormat,
        cmd_start: Pos,
        cmd_span: Span,
    ) -> Expr {
        if self.depth >= MAX_PARSE_DEPTH {
            return Expr::UnknownCmd {
                code: "?".to_owned(),
                span: cmd_span,
            };
        }
        self.depth += 1;
        let slots = self.parse_slots_with_roles(&format.slot_roles);
        self.depth -= 1;
        let full_end = self.current_pos();
        Expr::CustomStruct {
            format,
            cmd_span,
            slots,
            full_span: Span {
                start: cmd_start,
                end: full_end,
            },
            scope_entry_idx: None,
        }
    }

    fn parse_slots_with_roles(&mut self, roles: &[String]) -> Vec<SlotNode> {
        let mut slots = Vec::with_capacity(roles.len());
        for role_hint in roles {
            if self.idx >= self.chars.len() && self.unclosed_semis_at_eof > 0 {
                let needed = self.unclosed_semis_at_eof;
                self.unclosed_semis_at_eof += 1;
                let eof = self.eof_pos;
                slots.push(SlotNode {
                    seq: MathSeq {
                        items: Vec::new(),
                        span: Span {
                            start: eof,
                            end: eof,
                        },
                        closing_semi: None,
                        missing_semis_at_eof: needed,
                    },
                    role_hint: role_hint.clone(),
                    is_empty: true,
                    scope_entry_idx: None,
                });
            } else {
                let seq = self.parse_seq(true);
                if seq.closing_semi.is_none() {
                    self.unclosed_semis_at_eof += 1;
                }
                let is_empty = !seq_has_meaningful_content(&seq);
                slots.push(SlotNode {
                    seq,
                    role_hint: role_hint.clone(),
                    is_empty,
                    scope_entry_idx: None,
                });
            }
        }
        slots
    }
}

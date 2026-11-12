use crate::ast::{
    Expr, InnermostSlotState, MathSeq, NavEntry, NavEntryKind, NavScope, ParsedDoc, Span,
};
use crate::command::{
    CMD_PREFIX, CommandTarget, PrefixMenuState, STEP_SEP, SubCategory, SymbolCmd,
    detect_prefix_menu_state, lookup_direct, lookup_sub_command,
};
use crate::library::UserLibrary;
use crate::parser::{count_unclosed_slots, parse_with_library};

const MAX_HISTORY: usize = 160;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub source: String,
    pub cursor_char: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EscNavState {
    /// 当前已逐级展开的复合槽标签路径（如 `["c"]` 表示已打开外层 `[c+]` 子公式）
    pub path: Vec<String>,
    /// 单层锚点超过 26 个时的双字母前缀缓冲
    pub partial: String,
}

/// 源码中一对键盘输入括号的字符下标（`char_idx`，0-based）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BracketPair {
    pub open_char_idx: usize,
    pub close_char_idx: usize,
    pub open: char,
    pub close: char,
}

pub enum NavSeqResolution<'a> {
    HitTarget {
        full_path: Vec<String>,
        entry: &'a NavEntry,
    },
    InScope {
        path: Vec<String>,
        scope: &'a NavScope,
        partial: String,
        via_composite: Option<&'a NavEntry>,
    },
    Invalid {
        valid_path: Vec<String>,
    },
}

/// 将行尾快捷别名 `.` / `$` 统一映射为行尾标签 `;`
pub fn normalize_nav_seq(seq_str: &str) -> String {
    seq_str
        .chars()
        .map(|c| if matches!(c, '.' | '$') { ';' } else { c })
        .collect()
}

/// 在多级无前缀导航树上贪心解析字母序列（同时服务于 `Esc` 跳转与 `▸j` 内联跳转）
pub fn resolve_nav_sequence<'a>(root_scope: &'a NavScope, seq_str: &str) -> NavSeqResolution<'a> {
    let normalized = normalize_nav_seq(seq_str);
    let mut cur_scope = root_scope;
    let mut path = Vec::new();
    let mut rem = normalized.as_str();
    let mut last_comp: Option<&'a NavEntry> = None;

    while !rem.is_empty() {
        if let Some(entry) = cur_scope
            .entries
            .iter()
            .find(|e| rem.starts_with(e.label.as_str()))
        {
            rem = &rem[entry.label.len()..];
            match &entry.kind {
                NavEntryKind::ScopeStart
                | NavEntryKind::ScopeEnd
                | NavEntryKind::Leaf { .. } => {
                    if rem.is_empty() {
                        let mut full_path = path;
                        full_path.push(entry.label.clone());
                        return NavSeqResolution::HitTarget { full_path, entry };
                    }
                    return NavSeqResolution::Invalid { valid_path: path };
                }
                NavEntryKind::Composite { sub_scope, .. } => {
                    path.push(entry.label.clone());
                    last_comp = Some(entry);
                    cur_scope = sub_scope.as_ref();
                }
            }
        } else if cur_scope
            .entries
            .iter()
            .any(|e| e.label.starts_with(rem))
        {
            return NavSeqResolution::InScope {
                path,
                scope: cur_scope,
                partial: rem.to_owned(),
                via_composite: last_comp,
            };
        } else {
            return NavSeqResolution::Invalid { valid_path: path };
        }
    }

    NavSeqResolution::InScope {
        path,
        scope: cur_scope,
        partial: String::new(),
        via_composite: last_comp,
    }
}

pub struct StreamEditor {
    pub source: String,
    pub cursor_char: usize,
    pub parsed: ParsedDoc,
    pub esc_nav: Option<EscNavState>,
    pub library: UserLibrary,
    /// 记录最近一次跳转前的光标字符位置（并在后续编辑时自动平移偏移量，支持导航中 `-` / `Alt+Left` 来回切换！）
    pub jump_back_pos: Option<usize>,
    /// 完整历史跳转序列（如 d -> c -> b -> e，按导航中 p 后退、n 前进）
    pub jump_history: Vec<usize>,
    /// 当前在历史跳转序列中的位置游标
    pub jump_history_idx: usize,
    last_synced_source: String,
    undo_stack: Vec<Snapshot>,
    redo_stack: Vec<Snapshot>,
}

impl Default for StreamEditor {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamEditor {
    pub fn new() -> Self {
        Self::with_library(UserLibrary::default_seeded())
    }

    pub fn with_library(library: UserLibrary) -> Self {
        let source = String::new();
        let parsed = parse_with_library(&source, &library);
        Self {
            source,
            cursor_char: 0,
            parsed,
            esc_nav: None,
            library,
            jump_back_pos: None,
            jump_history: Vec::new(),
            jump_history_idx: 0,
            last_synced_source: String::new(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn from_source(initial: &str) -> Self {
        Self::from_source_with_library(initial, UserLibrary::default_seeded())
    }

    pub fn from_source_with_library(initial: &str, library: UserLibrary) -> Self {
        let normalized = initial.replace('\t', &CMD_PREFIX.to_string());
        let cursor_char = normalized.chars().count();
        let parsed = parse_with_library(&normalized, &library);
        Self {
            last_synced_source: normalized.clone(),
            source: normalized,
            cursor_char,
            parsed,
            esc_nav: None,
            library,
            jump_back_pos: None,
            jump_history: Vec::new(),
            jump_history_idx: 0,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn set_library(&mut self, library: UserLibrary) {
        self.library = library;
        self.reparse();
    }

    pub fn can_jump_back(&self) -> bool {
        self.jump_back_pos.is_some()
    }

    pub fn prefix_menu_state(&self) -> PrefixMenuState {
        let state = detect_prefix_menu_state(&self.source, self.cursor_char);
        if let PrefixMenuState::InvalidPrefix(ch) = state {
            if self.library.lookup_custom(ch).is_some() {
                return PrefixMenuState::Idle;
            }
        }
        state
    }

    /// 返回当前导航视图应当展开的复合路径与过滤前缀：
    /// 1. 若处于 `Esc` 模式，使用 `esc_nav` 的路径；
    /// 2. 若处于 `▸j<seq>` 内联跳转中，解析 `<seq>` 对应的复合槽路径；
    /// 3. 否则自动跟随光标当前所在的复合槽路径（光标进入嵌套槽时自动展开子公式！）
    pub fn active_nav_view_state(&self) -> (Vec<String>, Option<String>) {
        if let Some(esc) = &self.esc_nav {
            let filter = if esc.partial.is_empty() {
                None
            } else {
                Some(esc.partial.clone())
            };
            return (esc.path.clone(), filter);
        }
        if let PrefixMenuState::Jump(seq_str) = self.prefix_menu_state() {
            if seq_str == "-" {
                return (self.parsed.cursor_composite_path(self.cursor_char), None);
            }
            match resolve_nav_sequence(&self.parsed.root_scope, &seq_str) {
                NavSeqResolution::InScope { path, partial, .. } => {
                    let filter = if partial.is_empty() {
                        None
                    } else {
                        Some(partial)
                    };
                    return (path, filter);
                }
                NavSeqResolution::Invalid { valid_path } => {
                    return (valid_path, None);
                }
                NavSeqResolution::HitTarget { mut full_path, .. } => {
                    let _ = full_path.pop();
                    return (full_path, None);
                }
            }
        }
        (self.parsed.cursor_composite_path(self.cursor_char), None)
    }

    pub fn save_undo_snapshot(&mut self, snap: Snapshot) {
        if self.undo_stack.last() == Some(&snap) {
            return;
        }
        self.undo_stack.push(snap);
        if self.undo_stack.len() > MAX_HISTORY {
            self.undo_stack.remove(0);
        }
        self.redo_stack.clear();
    }

    pub fn push_current_to_undo(&mut self) {
        let snap = Snapshot {
            source: self.source.clone(),
            cursor_char: self.cursor_char,
        };
        self.save_undo_snapshot(snap);
    }

    /// 内联跳转会先擦除输入流里的 `▸j...` 指令，再可能补齐分号。
    /// 这里保存“擦除指令后、补齐分号前”的干净状态，保证 Ctrl+Z 能回到用户原公式。
    fn snapshot_clean_source(&mut self, clean_source: &str, cursor_char: usize) {
        self.save_undo_snapshot(Snapshot {
            source: clean_source.to_owned(),
            cursor_char,
        });
    }

    pub fn undo(&mut self) -> String {
        let Some(prev) = self.undo_stack.pop() else {
            return "没有可撤销的操作。".to_owned();
        };
        self.redo_stack.push(Snapshot {
            source: self.source.clone(),
            cursor_char: self.cursor_char,
        });
        let old = self.source.clone();
        self.source = prev.source;
        self.adjust_jump_back_for_edit(&old, &self.source.clone());
        self.cursor_char = prev.cursor_char.min(self.source.chars().count());
        self.esc_nav = None;
        self.reparse();
        "已撤销上一步 (Ctrl+Y 可重做)。".to_owned()
    }

    pub fn redo(&mut self) -> String {
        let Some(next) = self.redo_stack.pop() else {
            return "没有可重做的操作。".to_owned();
        };
        self.undo_stack.push(Snapshot {
            source: self.source.clone(),
            cursor_char: self.cursor_char,
        });
        let old = self.source.clone();
        self.source = next.source;
        self.adjust_jump_back_for_edit(&old, &self.source.clone());
        self.cursor_char = next.cursor_char.min(self.source.chars().count());
        self.esc_nav = None;
        self.reparse();
        "已重做操作。".to_owned()
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn set_cursor(&mut self, cursor_char: usize) {
        self.cursor_char = cursor_char.min(self.source.chars().count());
    }

    pub fn to_latex(&self) -> String {
        crate::latex::to_latex(&self.parsed)
    }

    pub fn insert_str(&mut self, s: &str) {
        self.type_text(s);
    }

    /// 在当前字符光标 `cursor_char` 处模拟键入一段文本并触发 `sync_after_edit`
    pub fn type_text(&mut self, text: &str) -> Option<String> {
        let mut chars: Vec<char> = self.source.chars().collect();
        let cur = self.cursor_char.min(chars.len());
        let added: Vec<char> = text.chars().collect();
        let added_len = added.len();
        chars.splice(cur..cur, added);
        self.source = chars.into_iter().collect();
        self.sync_after_edit(cur + added_len)
    }

    /// 当 TextEdit 发生文本修改后同步调用：
    /// 1. 归一化 `\t`，同步修正 `jump_back_pos`；
    /// 2. 检测内联跳转 `▸j<seq>`（含 `▸j.` 行尾与 `▸j-` 上一位置）；
    /// 3. 检测复用片段模版展开 `▸t<key>`；
    /// 4. 检测前置智能包裹（如在已有式子最前面输入 `▸l` 极限时自动将已有式子包入主体槽！）；
    /// 5. 更新 AST 并返回状态栏引导提示。
    pub fn sync_after_edit(&mut self, new_cursor_char: usize) -> Option<String> {
        let old_synced = self.last_synced_source.clone();
        if self.source.contains('\t') {
            self.source = self.source.replace('\t', &CMD_PREFIX.to_string());
        }
        self.cursor_char = new_cursor_char.min(self.source.chars().count());
        self.esc_nav = None;
        self.adjust_jump_back_for_edit(&old_synced, &self.source.clone());

        // 键盘输入括号：自动补右半、跳过已配对右括号、删除空配对。
        // 必须在 ▸j / 模版 / Smart Prepend 之前执行，避免括号被当作普通文本。
        let bracket_hint = self.normalize_bracket_edit(&old_synced);

        if let Some(jump_msg) = self.try_consume_inline_jump() {
            return Some(jump_msg);
        }

        if let Some(tpl_msg) = self.try_consume_inline_template() {
            return Some(tpl_msg);
        }

        if let Some(wrap_msg) = self.try_backward_body_wrap(&old_synced) {
            return Some(wrap_msg);
        }

        if let Some(wrap_msg) = self.try_smart_wrap_prepend(&old_synced) {
            return Some(wrap_msg);
        }

        self.reparse();
        bracket_hint.or_else(|| self.just_completed_cmd_hint())
    }

    /// 当光标正处于二级子菜单（如 `▸m`、`▸g`、`▸k`、`▸t`）时，一键补齐或展开其默认条目（由 Enter 或 Space 触发）
    pub fn accept_submenu_default(&mut self) -> Option<String> {
        let PrefixMenuState::SubMenu(sub) = self.prefix_menu_state() else {
            return None;
        };

        match sub {
            SubCategory::Custom => {
                let Some(def) = self.library.default_custom().cloned() else {
                    return Some("当前没有自定义格式，请点击右上角「扩展/模版」添加。".to_owned());
                };
                self.push_current_to_undo();
                let old_synced = self.source.clone();
                insert_char_at(&mut self.source, self.cursor_char, def.item_key);
                self.cursor_char += 1;
                self.adjust_jump_back_for_edit(&old_synced, &self.source.clone());
                if let Some(wrap_msg) = self.try_smart_wrap_prepend(&old_synced) {
                    return Some(wrap_msg);
                }
                self.reparse();
                self.just_completed_cmd_hint()
            }
            SubCategory::Template => {
                let Some(snip) = self.library.default_snippet().cloned() else {
                    return Some("当前片段库为空，可点击「+存片段」将复杂式子存为模版。".to_owned());
                };
                self.push_current_to_undo();
                let cur = self.cursor_char;
                let mut chars: Vec<char> = self.source.chars().collect();
                let start = cur.saturating_sub(2);
                let old_synced = self.source.clone();
                chars.drain(start..cur.min(chars.len()));
                self.source = chars.into_iter().collect();
                self.cursor_char = start;
                self.adjust_jump_back_for_edit(&old_synced, &self.source.clone());
                Some(self.splice_snippet_at_cursor(&snip.stream_source, &snip.label, snip.item_key))
            }
            _ => {
                let def = sub.default_entry()?;
                self.push_current_to_undo();
                let old_synced = self.source.clone();
                insert_char_at(&mut self.source, self.cursor_char, def.item_key);
                self.cursor_char += 1;
                self.adjust_jump_back_for_edit(&old_synced, &self.source.clone());
                if let Some(wrap_msg) = self.try_smart_wrap_prepend(&old_synced) {
                    return Some(wrap_msg);
                }
                self.reparse();
                self.just_completed_cmd_hint()
            }
        }
    }

    /// 处理物理 Tab 键：在光标处插入 `▸`；若紧邻未完成的 `▸` 前缀则将其撤回（已完成单字母如 `▸f` 不受影响，支持连续嵌套 `▸f▸r`！）
    pub fn handle_tab(&mut self) -> String {
        if self.esc_nav.is_some() {
            self.esc_nav = None;
            return "已退出导航跳转态，继续输入。".to_owned();
        }

        let mut chars: Vec<char> = self.source.chars().collect();
        let cur = self.cursor_char.min(chars.len());
        let old_src = self.source.clone();

        match self.prefix_menu_state() {
            PrefixMenuState::Root => {
                self.push_current_to_undo();
                chars.remove(cur - 1);
                self.source = chars.into_iter().collect();
                self.cursor_char = cur - 1;
                self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
                self.reparse();
                return "已取消前导符 ▸。".to_owned();
            }
            PrefixMenuState::SubMenu(_) | PrefixMenuState::InvalidPrefix(_) => {
                self.push_current_to_undo();
                chars.drain((cur - 2)..cur);
                self.source = chars.into_iter().collect();
                self.cursor_char = cur - 2;
                self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
                self.reparse();
                return "已取消未完成的指令前缀。".to_owned();
            }
            PrefixMenuState::Jump(tail) => {
                let drop_len = (2 + tail.chars().count()).min(cur);
                self.push_current_to_undo();
                chars.drain((cur - drop_len)..cur);
                self.source = chars.into_iter().collect();
                self.cursor_char = cur - drop_len;
                self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
                self.reparse();
                return "已取消未完成的跳转指令。".to_owned();
            }
            PrefixMenuState::Idle => {}
        }

        self.push_current_to_undo();
        chars.insert(cur, CMD_PREFIX);
        self.source = chars.into_iter().collect();
        self.cursor_char = cur + 1;
        self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
        self.reparse();
        "已插入 ▸：按单字母输入常用结构（f 分数 / r 根号 / i 积分 / s 求和 / l 极限），或按 c/m/a/g/o/k/t 展开子菜单。"
            .to_owned()
    }

    /// 智能 Enter：
    /// 1. 若处于二级子菜单（如 `▸m`、`▸k`、`▸t`），直接选用默认项；
    /// 2. 若处于未闭合槽位，在槽末插入 `;` 推进下一槽或闭合当前层；
    /// 3. 若处于已闭合槽位（如跳改前文或前置包裹填完条件后），跨过已有 `;` 绝不重复插入；
    /// 4. 若在根级且后方仍有未填槽位，推进至下一待填槽位。
    pub fn smart_enter(&mut self) -> String {
        if let Some(esc) = self.esc_nav.take() {
            if !esc.path.is_empty()
                && let Some((target_char, missing_semis, role)) =
                    find_composite_by_path(&self.parsed.root_scope, &esc.path)
            {
                if missing_semis > 0 {
                    self.push_current_to_undo();
                }
                let joined = esc.path.join(" › ");
                self.apply_jump(target_char, missing_semis);
                return format!("已定位至复合槽 [{joined}+]（{role}）末尾。");
            }
            return "已返回流式输入态。".to_owned();
        }

        if let Some(default_msg) = self.accept_submenu_default() {
            return default_msg;
        }

        if !matches!(self.prefix_menu_state(), PrefixMenuState::Idle) {
            return "请先按上方字母键完成指令（或再按一次 Tab 取消 ▸）。".to_owned();
        }

        // 1. 定界符感知：若光标处于配对定界符内部（且该定界符属于当前槽位或根级），按 Enter 直接跳出闭合括号
        let cur = self.cursor_char;
        let pairs = bracket_pairs(&self.source);
        let active_slot = self.parsed.innermost_active_slot_span(cur);
        let mut target_pair = None;

        for p in pairs {
            if cur > p.open_char_idx && cur <= p.close_char_idx {
                if let Some(span) = active_slot {
                    // 仅当定界符在当前活跃槽位内开启时跳出；若槽位在定界符内部开启，则优先推进槽位
                    if p.open_char_idx >= span.start.char_idx {
                        target_pair = Some(p);
                        break;
                    }
                } else {
                    target_pair = Some(p);
                    break;
                }
            }
        }

        if let Some(p) = target_pair {
            let old_src = self.source.clone();
            self.cursor_char = (p.close_char_idx + 1).min(self.source.chars().count());
            self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
            self.reparse();
            let delim_desc = match (p.open, p.close) {
                ('(', ')') => "配对括号 ()",
                ('[', ']') => "配对中括号 []",
                ('{', '}') => "配对大括号 {}",
                ('|', '|') => "配对绝对值 ||",
                (o, c) => return format!("已跳出定界符 {o}{c}。"),
            };
            return format!("已跳出{delim_desc}。");
        }

        match self.parsed.innermost_slot_state(self.cursor_char) {
            InnermostSlotState::InUnclosedSlot { slot_end } => {
                self.push_current_to_undo();
                let old_src = self.source.clone();
                insert_char_at(&mut self.source, slot_end.char_idx, STEP_SEP);
                self.cursor_char = slot_end.char_idx + 1;
                self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
                self.reparse();
                if let Some(last_bc) = self.parsed.breadcrumbs_at(self.cursor_char).last() {
                    format!("已推进至「{}」的 [{}]。", last_bc.label, last_bc.role_hint)
                } else {
                    "已闭合当前结构，回到最外层序列。".to_owned()
                }
            }
            InnermostSlotState::InClosedSlot { closing_semi } => {
                self.cursor_char = (closing_semi.char_idx + 1).min(self.parsed.char_len);
                if let Some(last_bc) = self.parsed.breadcrumbs_at(self.cursor_char).last() {
                    format!(
                        "已跨过 `;` 进入「{}」的 [{}]。",
                        last_bc.label, last_bc.role_hint
                    )
                } else {
                    "已跨过 `;` 回到外层序列。".to_owned()
                }
            }
            InnermostSlotState::AtRoot => {
                if let Some(empty) = self
                    .parsed
                    .empty_slots
                    .iter()
                    .find(|e| {
                        e.missing_semis_at_eof > 0 || e.span.start.char_idx > self.cursor_char
                    })
                    .cloned()
                {
                    if empty.missing_semis_at_eof > 0 {
                        self.push_current_to_undo();
                    }
                    self.apply_jump(empty.target_char_idx, empty.missing_semis_at_eof);
                    return format!("已跳至待填槽位 [{}]。", empty.role_hint);
                }
                "公式已在最外层闭合：可直接继续书写，或按 Ctrl+Enter 输出 LaTeX。".to_owned()
            }
        }
    }

    pub fn toggle_esc_jump(&mut self) -> String {
        if self.esc_nav.is_some() {
            self.esc_nav = None;
            "已退出导航跳转模式。".to_owned()
        } else {
            self.esc_nav = Some(EscNavState::default());
            "导航跳转模式：[a] 行首 · [;/.] 行尾 · [-] 上一跳转点 · 字母直达槽位 · ( ) 括号内/外 · 方向键漫游（按 Tab / Esc / Alt j 退出）。"
                .to_owned()
        }
    }

    pub fn esc_backspace(&mut self) -> String {
        let Some(esc) = &mut self.esc_nav else {
            return String::new();
        };
        if !esc.partial.is_empty() {
            esc.partial.pop();
            return "已退回前缀字符。".to_owned();
        }
        if let Some(popped) = esc.path.pop() {
            return format!("已从子槽 [{popped}+] 返回上一级结构导航。");
        }
        self.esc_nav = None;
        "已退出导航跳转模式。".to_owned()
    }

    pub fn feed_esc_jump_char(&mut self, ch: char) -> String {
        if matches!(ch, '-' | '`') {
            return self.jump_to_previous_pos();
        }
        if matches!(ch, 'p' | 'P') {
            return self.jump_history_back();
        }
        if matches!(ch, 'n' | 'N') {
            return self.jump_history_forward();
        }
        if ch == '0' {
            return self.feed_esc_jump_char('a');
        }
        if ch == '(' {
            return self.jump_bracket(false);
        }
        if ch == ')' {
            return self.jump_bracket(true);
        }
        let mapped = if matches!(ch, ';' | '.' | '$') {
            ';'
        } else {
            ch.to_ascii_lowercase()
        };
        if !mapped.is_ascii_lowercase() && mapped != ';' {
            return "请按导航图字母，或按 a/0 行首、;/./$ 行尾、p 历史后退、n 历史前进、Esc 取消。"
                .to_owned();
        }
        let Some(mut esc) = self.esc_nav.take() else {
            return String::new();
        };

        let mut seq_str = esc.path.join("");
        seq_str.push_str(&esc.partial);
        seq_str.push(mapped);

        match resolve_nav_sequence(&self.parsed.root_scope, &seq_str) {
            NavSeqResolution::HitTarget { full_path, entry } => {
                let target_char = entry.target_char_idx;
                let missing_semis = entry.missing_semis_at_eof;
                let desc = describe_entry(entry).to_owned();
                let path_str = full_path.join(" › ");
                if missing_semis > 0 {
                    self.push_current_to_undo();
                }
                self.apply_jump(target_char, missing_semis);
                format!("已直达 [{path_str}] {desc}，可直接输入修改（按导航中 p 可返回原位）。")
            }
            NavSeqResolution::InScope {
                path,
                scope,
                partial,
                via_composite,
            } => {
                let msg = if partial.is_empty() {
                    let joined = path.join(" › ");
                    let role = via_composite
                        .and_then(|e| match &e.kind {
                            NavEntryKind::Composite { role_hint, .. } => Some(role_hint.as_str()),
                            _ => None,
                        })
                        .unwrap_or(scope.title.as_str());
                    format!(
                        "已展开子式 [{joined}+]（{role}）：继续按右侧子式字母或 `;` 定位，或按 Enter 停在该槽末尾。"
                    )
                } else {
                    format!("跳转前缀 `{partial}`：请继续输入第二个字母…")
                };
                self.esc_nav = Some(EscNavState { path, partial });
                msg
            }
            NavSeqResolution::Invalid { valid_path } => {
                esc.path = valid_path;
                esc.partial.clear();
                self.esc_nav = Some(esc);
                format!(
                    "当前层级没有标签 `{mapped}`，请对照导航图按键（h/a 行首，t/; 行尾，p/n 历史跳转，Backspace 返回上层）。"
                )
            }
        }
    }

    /// 记录一次跳转前的坐标到跳转历史栈中
    pub fn record_jump(&mut self, prev_pos: usize) {
        if self.jump_history_idx < self.jump_history.len() {
            self.jump_history.truncate(self.jump_history_idx);
        }
        if self.jump_history.last() != Some(&prev_pos) {
            self.jump_history.push(prev_pos);
        }
        self.jump_history_idx = self.jump_history.len();
        self.jump_back_pos = Some(prev_pos);
    }

    /// 沿历史跳转序列后退（Previous，导航中 p、- 或 Alt+←）
    pub fn jump_history_back(&mut self) -> String {
        self.esc_nav = None;
        if self.jump_history.is_empty() {
            return self.jump_to_previous_pos();
        }
        if self.jump_history_idx == self.jump_history.len() {
            let cur = self.cursor_char;
            if self.jump_history.last() != Some(&cur) {
                self.jump_history.push(cur);
            }
        }
        if self.jump_history_idx > 0 {
            self.jump_history_idx -= 1;
            let target = self.jump_history[self.jump_history_idx].min(self.source.chars().count());
            let current = self.cursor_char;
            self.cursor_char = target;
            self.jump_back_pos = Some(current);
            self.reparse();
            format!(
                "已后退至历史位置 (序号 {}/{})：可按 p 继续后退，或按 n 前进。",
                self.jump_history_idx + 1,
                self.jump_history.len()
            )
        } else {
            let target = self.jump_history[0].min(self.source.chars().count());
            self.cursor_char = target;
            self.reparse();
            "已到达历史跳转记录最早起点（按 n 可向前恢复）。".to_owned()
        }
    }

    /// 沿历史跳转序列前进（Next，导航中 n）
    pub fn jump_history_forward(&mut self) -> String {
        self.esc_nav = None;
        if self.jump_history.is_empty() || self.jump_history_idx + 1 >= self.jump_history.len() {
            return "已在最新跳转位置，无法继续前进（按 p 可向后回溯）。".to_owned();
        }
        self.jump_history_idx += 1;
        let target = self.jump_history[self.jump_history_idx].min(self.source.chars().count());
        let current = self.cursor_char;
        self.cursor_char = target;
        self.jump_back_pos = Some(current);
        self.reparse();
        format!(
            "已前进至历史位置 (序号 {}/{})：可按 n 继续前进，或按 p 后退。",
            self.jump_history_idx + 1,
            self.jump_history.len()
        )
    }

    /// 返回上一个跳转前的位置（支持单步乒乓切换！）
    pub fn jump_to_previous_pos(&mut self) -> String {
        self.esc_nav = None;
        let Some(prev) = self.jump_back_pos else {
            return "暂无上一个跳转位置记录（先执行一次槽位/行首/方向键跳转即可记录）。".to_owned();
        };
        let clamped = prev.min(self.source.chars().count());
        let current = self.cursor_char;
        self.cursor_char = clamped;
        if current != clamped {
            self.jump_back_pos = Some(current);
        }
        "已返回上一个跳转位置（再按导航中 - 或 Alt+← 可切回）。".to_owned()
    }

    pub fn jump_to_start(&mut self) -> String {
        self.esc_nav = None;
        self.apply_jump(0, 0);
        "已跳转至整行行首 [a]。".to_owned()
    }

    pub fn jump_to_end(&mut self) -> String {
        self.esc_nav = None;
        let end = self.source.chars().count();
        self.apply_jump(end, 0);
        "已跳转至整行行尾 [;]。".to_owned()
    }

    /// 当前光标所处/最近的括号对（`()`、`[]`、`{}`）。
    /// 光标在括号内时返回包围它的一对；在括号外时返回距离最近的一对，
    /// 这样在行尾也可以按 `(` 跳进最近的括号。
    pub fn enclosing_bracket_pair(&self) -> Option<BracketPair> {
        let cursor = self.cursor_char;
        let pairs = bracket_pairs(&self.source);
        if let Some(pair) = pairs
            .iter()
            .copied()
            .find(|p| p.open_char_idx < cursor && cursor <= p.close_char_idx)
        {
            return Some(pair);
        }
        pairs.into_iter().min_by_key(|p| {
            if cursor < p.open_char_idx {
                p.open_char_idx - cursor
            } else {
                cursor.saturating_sub(p.close_char_idx)
            }
        })
    }

    /// 导航模式下的括号专用跳转：
    /// - `(`：跳到当前最内层括号的内部起点；
    /// - `)`：跳到配对右括号的外侧。
    /// 跳转后保持导航模式，方便连续向内/向外切换。
    pub fn jump_bracket(&mut self, to_close: bool) -> String {
        let Some(pair) = self.enclosing_bracket_pair() else {
            return "当前位置不在括号对内：先把光标移到 (...)、[...] 或 {...} 内部。".to_owned();
        };
        let len = self.source.chars().count();
        let target = if to_close {
            pair.close_char_idx + 1
        } else {
            pair.open_char_idx + 1
        }
        .min(len);
        let prev = self.cursor_char;
        self.cursor_char = target;
        if prev != target {
            self.record_jump(prev);
            self.reparse();
        }
        if to_close {
            format!("已跳到 {} 外侧。", pair.close)
        } else {
            format!("已跳到 {} 内侧起点。", pair.open)
        }
    }

    /// 将指定字符区间的文本用一对括号包裹（Ctrl/Command 选区输入左括号时使用）。
    pub fn wrap_selection_with_bracket(
        &mut self,
        start_char: usize,
        end_char: usize,
        open: char,
        close: char,
    ) -> String {
        let len = self.source.chars().count();
        let mut s = start_char.min(len);
        let mut e = end_char.min(len);
        if s > e {
            std::mem::swap(&mut s, &mut e);
        }
        if s == e {
            return self.insert_bracket_pair(open, close);
        }
        let chars: Vec<char> = self.source.chars().collect();
        let selected: String = chars[s..e].iter().collect();
        let mut wrapped = Vec::with_capacity(e - s + 2);
        wrapped.push(open);
        wrapped.extend(selected.chars());
        wrapped.push(close);
        self.push_current_to_undo();
        let old_src = self.source.clone();
        let mut new_chars = chars;
        new_chars.splice(s..e, wrapped);
        self.source = new_chars.into_iter().collect();
        self.cursor_char = e + 2;
        self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
        self.reparse();
        format!("已将选中内容包裹为 {open}…{close}，光标在右括号后。")
    }

    fn insert_bracket_pair(&mut self, open: char, close: char) -> String {
        self.push_current_to_undo();
        let old_src = self.source.clone();
        insert_char_at(&mut self.source, self.cursor_char, open);
        insert_char_at(&mut self.source, self.cursor_char + 1, close);
        self.cursor_char += 1;
        self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
        self.reparse();
        format!("已插入配对括号 {open}…{close}，光标在括号内。")
    }

    /// 对键盘输入的单字符编辑做括号归一化：
    /// - 输入左括号：补右半（若下一个字符已经是配对右括号则不重复补）；
    /// - 输入右括号：若紧跟同型已配对右括号则直接跳过；
    /// - 空配对内按 Backspace 删除左括号时，一并删除右括号。
    fn normalize_bracket_edit(&mut self, old_src: &str) -> Option<String> {
        let old_chars: Vec<char> = old_src.chars().collect();
        let new_chars: Vec<char> = self.source.chars().collect();
        let cur = self.cursor_char;

        // 1. 单字符插入：插入字符始终位于光标前一位
        if new_chars.len() == old_chars.len() + 1 && cur > 0 {
            let inserted = new_chars[cur - 1];
            if let Some(close) = matching_close(inserted) {
                if is_escaped_at(&new_chars, cur - 1)
                    || is_latex_delimiter(&new_chars, cur - 1, inserted)
                {
                    return None;
                }
                if new_chars.get(cur).copied() == Some(close)
                    && !has_unmatched_open(&new_chars, cur - 1, inserted)
                {
                    return None;
                }
                let old = self.source.clone();
                let mut chars = new_chars;
                chars.insert(cur, close);
                self.source = chars.into_iter().collect();
                self.adjust_jump_back_for_edit(&old, &self.source.clone());
                return Some(format!("已自动配对 {inserted}…{close}。"));
            }
            if let Some(open) = matching_open(inserted)
                && new_chars.get(cur).copied() == Some(inserted)
                && has_unmatched_open(&new_chars, cur - 1, open)
            {
                let old = self.source.clone();
                let mut chars = new_chars;
                chars.remove(cur - 1);
                self.source = chars.into_iter().collect();
                self.cursor_char = cur;
                self.adjust_jump_back_for_edit(&old, &self.source.clone());
                return Some(format!("已跳过已配对的 {inserted}。"));
            }
        }

        // 2. 单字符删除：Backspace 删除的是光标前一位，删除后该位置就是光标
        if old_chars.len() == new_chars.len() + 1 && cur < old_chars.len() {
            let deleted = old_chars[cur];
            if let Some(close) = matching_close(deleted)
                && old_chars.get(cur + 1).copied() == Some(close)
                && new_chars.get(cur).copied() == Some(close)
            {
                let old = self.source.clone();
                let mut chars = new_chars;
                chars.remove(cur);
                self.source = chars.into_iter().collect();
                self.cursor_char = cur;
                self.adjust_jump_back_for_edit(&old, &self.source.clone());
                return Some("已删除空配对括号。".to_owned());
            }
        }

        None
    }

    /// 2D 上下方向键直觉跳转：
    /// - 在 `Esc` 模式下：`Up` 返回上层复合槽，`Down` 展开当前选中的复合槽；
    /// - 在流式输入态下：在分子↔分母、上下限、上下标、极限条件↔主体、矩阵上下行、嵌套根号内外层之间直觉穿梭！
    pub fn arrow_vertical(&mut self, go_up: bool) -> Option<String> {
        if let Some(mut esc) = self.esc_nav.take() {
            if go_up {
                if let Some(popped) = esc.path.pop() {
                    esc.partial.clear();
                    self.esc_nav = Some(esc);
                    return Some(format!("已从子槽 [{popped}+] 返回上一级导航。"));
                }
            } else {
                let chain = self.parsed.resolve_scope_chain(&esc.path);
                let active_stage = chain.last().expect("root stage exists");
                if let Some(idx) = active_stage.scope.active_entry_idx(self.cursor_char)
                    && let Some(entry) = active_stage.scope.entries.get(idx)
                    && let NavEntryKind::Composite { role_hint, .. } = &entry.kind
                {
                    let lbl = entry.label.clone();
                    let role = role_hint.clone();
                    esc.path.push(lbl.clone());
                    esc.partial.clear();
                    self.esc_nav = Some(esc);
                    return Some(format!(
                        "已展开复合子槽 [{lbl}+]（{role}），可按 ←/→ 选择子锚点。"
                    ));
                }
            }

            if let Some((target_char, missing_semis, desc)) =
                self.parsed.vertical_arrow_target(self.cursor_char, go_up)
            {
                if missing_semis > 0 {
                    self.push_current_to_undo();
                }
                let prev = self.cursor_char;
                self.apply_jump(target_char, missing_semis);
                if prev != self.cursor_char {
                    self.record_jump(prev);
                }
                self.esc_nav = Some(esc);
                return Some(format!("已跳转至 {desc}（Enter 确认，Esc 退出）。"));
            }

            self.esc_nav = Some(esc);
            return if go_up {
                Some("已在最顶层导航（按 ←/→ 选择锚点，Esc 退出）。".to_owned())
            } else {
                Some("当前槽位无可展开的子结构（按 ←/→ 选择锚点，Esc 退出）。".to_owned())
            };
        }

        let (target_char, missing_semis, desc) =
            self.parsed.vertical_arrow_target(self.cursor_char, go_up)?;
        if missing_semis > 0 {
            self.push_current_to_undo();
        }
        self.apply_jump(target_char, missing_semis);
        Some(format!("已跳转至 {desc}。"))
    }

    /// 左右方向键增强：
    /// - 在 `Esc` 导航模式下：沿当前层级的徽章锚点左右逐项漫游；
    /// - 在流式输入模式下：若正要跨越已完成的简码指令（如 `▸f`、`▸ma`、`▸ga`、`▸ka`），一次性原子跳过整条前缀，避免卡在 `▸` 中间误弹菜单；普通字符则返回 `None` 交由原生输入框处理（完整保留选区与输入法行为）。
    pub fn arrow_horizontal(&mut self, go_left: bool) -> Option<String> {
        if let Some(esc) = &self.esc_nav {
            let chain = self.parsed.resolve_scope_chain(&esc.path);
            let active_stage = chain.last().expect("root stage exists");
            let valid: Vec<usize> = active_stage
                .scope
                .entries
                .iter()
                .enumerate()
                .filter(|(_, e)| e.missing_semis_at_eof == 0)
                .map(|(i, _)| i)
                .collect();
            if valid.is_empty() {
                return None;
            }
            let cur_pos = active_stage
                .scope
                .active_entry_idx(self.cursor_char)
                .and_then(|ai| valid.iter().position(|&i| i == ai))
                .unwrap_or(0);
            let next_pos = if go_left {
                (cur_pos + valid.len() - 1) % valid.len()
            } else {
                (cur_pos + 1) % valid.len()
            };
            let entry = &active_stage.scope.entries[valid[next_pos]];
            let target = entry.target_char_idx.min(self.source.chars().count());
            let label = entry.label.clone();
            let desc = describe_entry(entry).to_owned();
            let prev = self.cursor_char;
            self.cursor_char = target;
            if prev != target {
                self.record_jump(prev);
            }
            return Some(format!(
                "已定位锚点 [{label}] {desc}（Enter 确认，↓ 展开复合槽，Esc 退出）。"
            ));
        }

        let mut spans = Vec::new();
        collect_atomic_cmd_spans(&self.parsed.root, &mut spans);
        let cur = self.cursor_char;
        if go_left {
            if let Some(hit) = spans.iter().find(|s| s.end.char_idx == cur) {
                self.cursor_char = hit.start.char_idx;
                return Some("已跨过结构指令前缀。".to_owned());
            }
        } else if let Some(hit) = spans.iter().find(|s| s.start.char_idx == cur) {
            self.cursor_char = hit.end.char_idx.min(self.source.chars().count());
            return Some("已进入结构首个槽位。".to_owned());
        }
        None
    }

    /// 供顶部跳转横幅点击或单元测试直接按完整标签序列跳转（如 `"a"`、`";"`、`"b"`、`"cb"`、`"-"`）
    pub fn jump_to_sequence(&mut self, seq_str: &str) -> Result<String, String> {
        if seq_str == "-" {
            return Ok(self.jump_to_previous_pos());
        }
        if seq_str == "(" {
            return Ok(self.jump_bracket(false));
        }
        if seq_str == ")" {
            return Ok(self.jump_bracket(true));
        }
        match resolve_nav_sequence(&self.parsed.root_scope, seq_str) {
            NavSeqResolution::HitTarget { full_path, entry } => {
                let target_char = entry.target_char_idx;
                let missing_semis = entry.missing_semis_at_eof;
                let desc = describe_entry(entry).to_owned();
                let path_str = full_path.join(" › ");
                if missing_semis > 0 {
                    self.push_current_to_undo();
                }
                self.esc_nav = None;
                self.apply_jump(target_char, missing_semis);
                Ok(format!("已跳转至 [{path_str}] {desc}。"))
            }
            NavSeqResolution::InScope { path, .. } => {
                self.esc_nav = Some(EscNavState {
                    path: path.clone(),
                    partial: String::new(),
                });
                Ok(format!(
                    "已展开复合子槽 [{}]，请继续选择内部锚点。",
                    path.join(" › ")
                ))
            }
            NavSeqResolution::Invalid { .. } => Err(format!("未找到导航路径 `{seq_str}`。")),
        }
    }

    /// 将当前子结构（当 `prefer_inner_struct == true` 且光标位于子结构内）或整行公式保存为可复用片段模版
    pub fn save_current_as_snippet(
        &mut self,
        custom_label: Option<&str>,
        prefer_inner_struct: bool,
    ) -> Result<(char, String), String> {
        let (auto_title, raw_slice) = if prefer_inner_struct
            && let Some((kind_label, sub_slice)) =
                self.parsed.innermost_struct_substr(&self.source, self.cursor_char)
        {
            (format!("{kind_label}子式"), sub_slice.to_owned())
        } else {
            ("整行公式".to_owned(), self.source.clone())
        };

        let trimmed = raw_slice.trim();
        if trimmed.is_empty() {
            return Err("当前输入为空，请先输入要复用的公式或子式。".to_owned());
        }

        let normalized = self.close_unclosed_in_str(trimmed);
        let label = match custom_label.map(str::trim).filter(|s| !s.is_empty()) {
            Some(l) => l.to_owned(),
            None => auto_title,
        };
        let key = self.library.add_snippet_auto(label.clone(), normalized)?;
        self.reparse();
        Ok((
            key,
            format!(
                "已保存片段「{label}」到 [{CMD_PREFIX}t{key}]：任何位置按 Tab t {key} 即可一键复用！"
            ),
        ))
    }

    /// 鼠标点击顶部子菜单分类按钮（如 `[m▸]`、`[k▸]`、`[t▸]`、`[j]`）
    pub fn apply_sub_click(&mut self, sub_ch: char) -> String {
        self.push_current_to_undo();
        self.esc_nav = None;
        let old_src = self.source.clone();
        let prefix = match self.prefix_menu_state() {
            PrefixMenuState::Root => sub_ch.to_string(),
            PrefixMenuState::SubMenu(_) | PrefixMenuState::InvalidPrefix(_) => {
                let cur = self.cursor_char;
                let mut chars: Vec<char> = self.source.chars().collect();
                if cur >= 1 && cur <= chars.len() {
                    chars.remove(cur - 1);
                    self.source = chars.into_iter().collect();
                    self.cursor_char = cur - 1;
                }
                sub_ch.to_string()
            }
            _ => format!("{CMD_PREFIX}{sub_ch}"),
        };
        let cur = self.cursor_char;
        let mut chars: Vec<char> = self.source.chars().collect();
        let p_chars: Vec<char> = prefix.chars().collect();
        let p_len = p_chars.len();
        let pos = cur.min(chars.len());
        chars.splice(pos..pos, p_chars);
        self.source = chars.into_iter().collect();
        self.last_synced_source = old_src;
        self.sync_after_edit(pos + p_len)
            .unwrap_or_else(|| format!("已打开 `{CMD_PREFIX}{sub_ch}`。"))
    }

    /// 鼠标点击顶部速查卡片时的辅助插入（自动处理已有前缀、模版展开与前置智能包裹）
    pub fn apply_card_click(&mut self, code: &str) -> String {
        self.push_current_to_undo();
        self.esc_nav = None;
        let mut chars: Vec<char> = self.source.chars().collect();
        let cur = self.cursor_char.min(chars.len());

        let insert_str = match self.prefix_menu_state() {
            PrefixMenuState::Root => code.to_owned(),
            PrefixMenuState::SubMenu(sub) if code.starts_with(sub.key()) => {
                code.chars().skip(1).collect()
            }
            PrefixMenuState::SubMenu(_) | PrefixMenuState::InvalidPrefix(_) => {
                let drop = 2.min(cur);
                chars.drain((cur - drop)..cur);
                self.source = chars.into_iter().collect();
                self.cursor_char = cur - drop;
                return self.insert_at_cursor(&format!("{CMD_PREFIX}{code}"));
            }
            PrefixMenuState::Jump(tail) => {
                let drop_len = (2 + tail.chars().count()).min(cur);
                chars.drain((cur - drop_len)..cur);
                self.source = chars.into_iter().collect();
                self.cursor_char = cur - drop_len;
                return self.insert_at_cursor(&format!("{CMD_PREFIX}{code}"));
            }
            PrefixMenuState::Idle => format!("{CMD_PREFIX}{code}"),
        };

        self.insert_at_cursor(&insert_str)
    }

    pub fn clear(&mut self) -> String {
        if self.source.is_empty() {
            return "输入栏已经是空的。".to_owned();
        }
        self.push_current_to_undo();
        self.source.clear();
        self.cursor_char = 0;
        self.esc_nav = None;
        self.jump_back_pos = None;
        self.jump_history.clear();
        self.jump_history_idx = 0;
        self.reparse();
        "已清空输入栏（可按 Ctrl+Z 撤销）。".to_owned()
    }

    pub fn load_preset(&mut self, preset_source: &str, name: &str) -> String {
        self.push_current_to_undo();
        self.source = preset_source.to_owned();
        self.cursor_char = self.source.chars().count();
        self.esc_nav = None;
        self.jump_back_pos = None;
        self.jump_history.clear();
        self.jump_history_idx = 0;
        self.reparse();
        format!(
            "已加载示例「{name}」：试试按 Tab j 进导航后按 a 跳行首、按 ; 跳行尾、↑/↓ 上下穿槽，或 +存片段 复用！"
        )
    }

    fn insert_at_cursor(&mut self, text: &str) -> String {
        let old_synced = self.source.clone();
        let mut chars: Vec<char> = self.source.chars().collect();
        let cur = self.cursor_char.min(chars.len());
        let added: Vec<char> = text.chars().collect();
        let added_len = added.len();
        chars.splice(cur..cur, added);
        self.source = chars.into_iter().collect();
        self.last_synced_source = old_synced;
        self.sync_after_edit(cur + added_len)
            .unwrap_or_else(|| format!("已插入 `{text}`。"))
    }

    fn apply_jump(&mut self, target_char_idx: usize, missing_semis_at_eof: usize) {
        let prev = self.cursor_char;
        if missing_semis_at_eof > 0 {
            let old_src = self.source.clone();
            for _ in 0..missing_semis_at_eof {
                self.source.push(STEP_SEP);
            }
            self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
            self.cursor_char = self.source.chars().count();
        } else {
            self.cursor_char = target_char_idx.min(self.source.chars().count());
        }
        if prev != self.cursor_char {
            self.record_jump(prev);
        }
        self.reparse();
    }

    fn adjust_jump_back_for_edit(&mut self, old_src: &str, new_src: &str) {
        if old_src == new_src {
            return;
        }
        if let Some(pos) = self.jump_back_pos {
            self.jump_back_pos = Some(adjust_pos_for_edit(pos, old_src, new_src));
        }
        for pos in &mut self.jump_history {
            *pos = adjust_pos_for_edit(*pos, old_src, new_src);
        }
    }

    fn close_unclosed_in_str(&self, raw: &str) -> String {
        let doc = parse_with_library(raw, &self.library);
        let needed = count_unclosed_slots(&doc);
        if needed == 0 {
            raw.to_owned()
        } else {
            format!("{raw}{}", STEP_SEP.to_string().repeat(needed))
        }
    }

    fn splice_snippet_at_cursor(
        &mut self,
        snippet_source: &str,
        label: &str,
        item_key: char,
    ) -> String {
        let closed_snip = self.close_unclosed_in_str(snippet_source);
        let snip_doc = parse_with_library(&closed_snip, &self.library);
        let old_src = self.source.clone();

        let mut chars: Vec<char> = self.source.chars().collect();
        let insert_pos = self.cursor_char.min(chars.len());
        let snip_chars: Vec<char> = closed_snip.chars().collect();
        let snip_len = snip_chars.len();
        chars.splice(insert_pos..insert_pos, snip_chars);
        self.source = chars.into_iter().collect();
        self.adjust_jump_back_for_edit(&old_src, &self.source.clone());

        if let Some(first_empty) = snip_doc.empty_slots.first() {
            self.cursor_char = insert_pos + first_empty.target_char_idx;
            self.reparse();
            format!(
                "已插入模版「{label} ({CMD_PREFIX}t{item_key})」并自动停在待填槽 [{}]。",
                first_empty.role_hint
            )
        } else {
            self.cursor_char = insert_pos + snip_len;
            self.reparse();
            format!("已插入复用子式「{label} ({CMD_PREFIX}t{item_key})」。")
        }
    }

    fn try_consume_inline_template(&mut self) -> Option<String> {
        let chars: Vec<char> = self.source.chars().collect();
        let end = self.cursor_char.min(chars.len());
        if end < 3 {
            return None;
        }
        if chars[end - 3] != CMD_PREFIX
            || chars[end - 2].to_ascii_lowercase() != 't'
            || !chars[end - 1].is_ascii_alphabetic()
        {
            return None;
        }
        let item_key = chars[end - 1].to_ascii_lowercase();
        if let Some(snip) = self.library.lookup_snippet(item_key).cloned() {
            let mut stripped = chars;
            stripped.drain((end - 3)..end);
            let old_src = self.source.clone();
            self.source = stripped.into_iter().collect();
            self.cursor_char = end - 3;
            self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
            Some(self.splice_snippet_at_cursor(&snip.stream_source, &snip.label, snip.item_key))
        } else {
            let mut trimmed = chars;
            trimmed.remove(end - 1);
            let old_src = self.source.clone();
            self.source = trimmed.into_iter().collect();
            self.cursor_char = end - 1;
            self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
            self.reparse();
            Some(format!(
                "片段库中没有 `t{item_key}`：请查看上方 [t▸] 片段菜单，或点击「+存片段」保存新片段。"
            ))
        }
    }

    /// 前置智能主体包裹：当用户在一段已有式子前方（如按 `Tab j` 进导航再按 `a` 回到行首后）插入极限 `▸l`、积分 `▸i`、求和 `▸s`、分数 `▸f`、根号 `▸r` 等结构时，
    /// 自动将光标后方（直到等号/不等号前）的已有表达式装入该结构的「主体槽位」，并压入未包裹快照（按一次 `Ctrl+Z` 即可退回普通模式）。
    fn try_smart_wrap_prepend(&mut self, old_synced: &str) -> Option<String> {
        let chars: Vec<char> = self.source.chars().collect();
        let old_chars: Vec<char> = old_synced.chars().collect();
        let new_len = chars.len();
        let old_len = old_chars.len();
        if new_len <= old_len {
            return None;
        }

        let end = self.cursor_char.min(new_len);

        // 识别刚刚在光标处完成的命令区间 `cmd_start..end` 及其目标槽位属性
        let (cmd_start, struct_label, arity, body_slot, roles) = if end >= 2
            && chars[end - 2] == CMD_PREFIX
            && chars[end - 1].is_ascii_alphabetic()
            && let Some(kind) = lookup_direct(chars[end - 1].to_ascii_lowercase())
        {
            let body = kind.wrap_body_slot_index()?;
            let roles: Vec<String> = kind.slot_roles().iter().map(|r| (*r).to_owned()).collect();
            (
                end - 2,
                kind.label().to_owned(),
                kind.arity(),
                body,
                roles,
            )
        } else if end >= 2
            && chars[end - 2] == CMD_PREFIX
            && chars[end - 1].is_ascii_alphabetic()
            && !chars[end - 1].eq_ignore_ascii_case(&'j')
            && SubCategory::from_key(chars[end - 1].to_ascii_lowercase()).is_none()
            && let Some(fmt) = self.library.lookup_custom(chars[end - 1].to_ascii_lowercase())
        {
            let body = fmt.wrap_body_slot_index()?;
            (
                end - 2,
                fmt.label.clone(),
                fmt.arity(),
                body,
                fmt.slot_roles.clone(),
            )
        } else if end >= 3
            && chars[end - 3] == CMD_PREFIX
            && chars[end - 2].is_ascii_alphabetic()
            && chars[end - 1].is_ascii_alphabetic()
        {
            let c1 = chars[end - 2].to_ascii_lowercase();
            let c2 = chars[end - 1].to_ascii_lowercase();
            if c1 == 'k' {
                let fmt = self.library.lookup_custom(c2)?;
                let body = fmt.wrap_body_slot_index()?;
                (
                    end - 3,
                    fmt.label.clone(),
                    fmt.arity(),
                    body,
                    fmt.slot_roles.clone(),
                )
            } else if let Some(CommandTarget::Struct(kind)) = lookup_sub_command(c1, c2).or_else(|| lookup_sub_command(c1, c2.to_ascii_lowercase())) {
                let body = kind.wrap_body_slot_index()?;
                let roles: Vec<String> =
                    kind.slot_roles().iter().map(|r| (*r).to_owned()).collect();
                (
                    end - 3,
                    kind.label().to_owned(),
                    kind.arity(),
                    body,
                    roles,
                )
            } else {
                return None;
            }
        } else {
            return None;
        };

        // 确认本次编辑确实发生在 `cmd_start..end` 之内（排除在后方编辑时偶然对齐的误触发）
        let (common_prefix, common_suffix) = common_affixes(&old_chars, &chars);
        let edit_pos = common_prefix.min(old_len.saturating_sub(common_suffix));
        if edit_pos >= end {
            return None;
        }

        // 还原插入该指令前的干净流文本，并在 AST 对应序列中测定应被包入主体的表达式范围 `cmd_start..wrap_end`
        let mut clean_chars = chars.clone();
        clean_chars.drain(cmd_start..end);
        let clean_source: String = clean_chars.iter().collect();
        let clean_doc = parse_with_library(&clean_source, &self.library);
        let seq = clean_doc.innermost_seq_at(cmd_start);
        let wrap_end = find_wrap_end_in_seq(seq, &clean_chars, cmd_start)?;

        let body_str: String = clean_chars[cmd_start..wrap_end].iter().collect();
        let body_unclosed = count_unclosed_slots(&parse_with_library(&body_str, &self.library));

        // 压入「未包裹」快照：万一用户极少数情况下不想包裹，按一次 Ctrl+Z 即可退回普通 `▸l...`！
        self.save_undo_snapshot(Snapshot {
            source: self.source.clone(),
            cursor_char: end,
        });

        let before_str: String = clean_chars[..cmd_start].iter().collect();
        let cmd_str: String = chars[cmd_start..end].iter().collect();
        let after_str: String = clean_chars[wrap_end..].iter().collect();
        let close_body = STEP_SEP.to_string().repeat(body_unclosed + 1);

        let prev_source = self.source.clone();
        let msg = if body_slot > 0 {
            let leading = STEP_SEP.to_string().repeat(body_slot);
            let trailing = if !after_str.is_empty() && body_slot + 1 < arity {
                STEP_SEP.to_string().repeat(arity - 1 - body_slot)
            } else {
                String::new()
            };
            self.source =
                format!("{before_str}{cmd_str}{leading}{body_str}{close_body}{trailing}{after_str}");
            self.cursor_char = end;
            let cur_role = roles.first().map(String::as_str).unwrap_or("条件");
            let body_role = roles.get(body_slot).map(String::as_str).unwrap_or("主体");
            format!(
                "已将后方式子自动作为「{struct_label}」的 [{body_role}]！当前填 [{cur_role}]，按 Enter 推进（Ctrl+Z 可取消包裹）。"
            )
        } else if arity == 1 {
            self.source = format!("{before_str}{cmd_str}{body_str}{close_body}{after_str}");
            self.cursor_char = end;
            format!("已用「{struct_label}」包裹后方式子（按 Enter 跳出末尾，Ctrl+Z 可取消包裹）。")
        } else {
            let trailing = if !after_str.is_empty() {
                STEP_SEP.to_string().repeat(arity - 1)
            } else {
                String::new()
            };
            let next_cursor = end + (wrap_end - cmd_start) + body_unclosed + 1;
            self.source =
                format!("{before_str}{cmd_str}{body_str}{close_body}{trailing}{after_str}");
            self.cursor_char = next_cursor;
            let slot0 = roles.first().map(String::as_str).unwrap_or("第1槽");
            let slot1 = roles.get(1).map(String::as_str).unwrap_or("第2槽");
            format!(
                "已将后方式子作为「{struct_label}」的 [{slot0}]，光标已直达 [{slot1}]（Ctrl+Z 可取消包裹）。"
            )
        };

        self.adjust_jump_back_for_edit(&prev_source, &self.source.clone());
        self.reparse();
        Some(msg)
    }

    /// 后向主体智能包裹 (Backward Body Wrap)：
    /// 当用户在已有原子（如英文字母 `G`、`x`、数字、希腊字母如 `▸gm`、闭合括号等）后键入 `▸d` (`Tab d`) 或 `▸u` (`Tab u`) 时，
    /// 自动将前方的原子吞入槽位 1（主体/底数），生成 `▸d <atom>;` 或 `▸u <atom>;`，并将光标精准定位到槽位 2（下标/上标）！
    /// 实现“键入变量后按 Tab d 即直接填写下标”的人体工程学心流，且支持按 `Ctrl+Z` 撤销。
    fn try_backward_body_wrap(&mut self, old_synced: &str) -> Option<String> {
        let chars: Vec<char> = self.source.chars().collect();
        let old_chars: Vec<char> = old_synced.chars().collect();
        let new_len = chars.len();
        let old_len = old_chars.len();
        if new_len <= old_len {
            return None;
        }

        let end = self.cursor_char.min(new_len);
        if end < 2 {
            return None;
        }

        let (struct_label, role_name) = if chars[end - 2] == CMD_PREFIX {
            let ch = chars[end - 1].to_ascii_lowercase();
            if ch == 'd' {
                ("下标", "下标")
            } else if ch == 'u' {
                ("上标", "上标")
            } else {
                return None;
            }
        } else {
            return None;
        };

        let cmd_start = end - 2;
        if cmd_start == 0 {
            return None;
        }

        // 确认本次编辑确实落在该指令处
        let (common_prefix, common_suffix) = common_affixes(&old_chars, &chars);
        let edit_pos = common_prefix.min(old_len.saturating_sub(common_suffix));
        if edit_pos >= end {
            return None;
        }

        // 从 cmd_start 往前检测紧邻的前置原子
        let (atom_start, _atom_end, atom_str) = find_backward_atom(&chars, cmd_start, &self.library)?;
        if atom_str.is_empty() {
            return None;
        }

        // 压入未包裹快照，支持 Ctrl+Z 撤销后向包裹
        self.save_undo_snapshot(Snapshot {
            source: self.source.clone(),
            cursor_char: end,
        });

        let before_atom_str: String = chars[..atom_start].iter().collect();
        let cmd_str: String = chars[cmd_start..end].iter().collect();
        let after_str: String = chars[end..].iter().collect();

        let prev_source = self.source.clone();
        // 构造新源码：将 atom 包入槽位 1，生成 `▸d <atom>;` 或 `▸u <atom>;`
        let wrapped_lead = format!("{before_atom_str}{cmd_str} {atom_str};");
        let next_cursor = wrapped_lead.chars().count();
        self.source = format!("{wrapped_lead}{after_str}");
        self.cursor_char = next_cursor;

        self.adjust_jump_back_for_edit(&prev_source, &self.source.clone());
        self.reparse();

        Some(format!(
            "已将前置「{atom_str}」作为{struct_label}主体，光标已就绪填入{role_name}（Ctrl+Z 可撤销）。"
        ))
    }

    fn try_consume_inline_jump(&mut self) -> Option<String> {
        let chars: Vec<char> = self.source.chars().collect();
        let end = self.cursor_char.min(chars.len());

        let p_pos = (0..end).rev().find(|&idx| chars[idx] == CMD_PREFIX)?;
        if p_pos + 2 > end || !chars[p_pos + 1].eq_ignore_ascii_case(&'j') {
            return None;
        }
        let seq_str: String = chars[(p_pos + 2)..end]
            .iter()
            .collect::<String>()
            .to_ascii_lowercase();
        if seq_str.is_empty() {
            let mut clean_chars = chars.clone();
            clean_chars.drain(p_pos..end);
            let clean_source: String = clean_chars.iter().collect();
            let old_src = self.source.clone();
            self.snapshot_clean_source(&clean_source, p_pos);
            self.source = clean_source;
            self.cursor_char = p_pos;
            self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
            self.reparse();
            self.toggle_esc_jump();
            return Some("⚡ 槽位直达导航已开启（按 Tab / Esc / Alt j 退出）".to_owned());
        }
        if !seq_str
            .chars()
            .all(|c| c.is_ascii_lowercase() || matches!(c, '.' | '$' | '-'))
            || seq_str.len() > 6
        {
            return None;
        }

        let mut clean_chars = chars.clone();
        clean_chars.drain(p_pos..end);
        let clean_source: String = clean_chars.iter().collect();

        if seq_str == "-" {
            let old_src = self.source.clone();
            self.snapshot_clean_source(&clean_source, p_pos);
            self.source = clean_source;
            self.cursor_char = p_pos;
            self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
            self.reparse();
            return Some(self.jump_to_previous_pos());
        }

        let clean_doc = parse_with_library(&clean_source, &self.library);

        match resolve_nav_sequence(&clean_doc.root_scope, &seq_str) {
            NavSeqResolution::HitTarget { full_path, entry } => {
                let target_char = entry.target_char_idx;
                let missing_semis = entry.missing_semis_at_eof;
                let desc = describe_entry(entry).to_owned();
                let path_str = full_path.join(" › ");
                let old_src = self.source.clone();
                self.snapshot_clean_source(&clean_source, p_pos);
                self.source = clean_source;
                self.cursor_char = p_pos;
                self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
                self.apply_jump(target_char, missing_semis);
                Some(format!(
                    "已通过 {CMD_PREFIX}j{seq_str} 直达 [{path_str}] {desc}。"
                ))
            }
            NavSeqResolution::InScope { path, .. } => {
                if !path.is_empty() {
                    self.reparse();
                    Some(format!(
                        "内联跳转 {CMD_PREFIX}j{seq_str}：已展开复合槽 [{}]，请继续输入子式字母或 `.`。",
                        path.join(" › ")
                    ))
                } else {
                    None
                }
            }
            NavSeqResolution::Invalid { .. } => {
                let mut trimmed = chars;
                trimmed.remove(end - 1);
                let trimmed_source: String = trimmed.iter().collect();
                let old_src = self.source.clone();
                self.snapshot_clean_source(&trimmed_source, end - 1);
                self.source = trimmed_source;
                self.cursor_char = end - 1;
                self.adjust_jump_back_for_edit(&old_src, &self.source.clone());
                self.reparse();
                Some(format!(
                    "导航图中没有路径 `{seq_str}`，请对照下方导航图显示的字母输入（`.` 行尾，`-` 上一位置）。"
                ))
            }
        }
    }

    fn just_completed_cmd_hint(&self) -> Option<String> {
        let chars: Vec<char> = self.source.chars().collect();
        let end = self.cursor_char.min(chars.len());

        // 1. 检查单字母直达或刚进入二级子菜单 (`▸<c1>`)
        if end >= 2 && chars[end - 2] == CMD_PREFIX && chars[end - 1].is_ascii_alphabetic() {
            let c1 = chars[end - 1].to_ascii_lowercase();
            if let Some(kind) = lookup_direct(c1) {
                let first_role = kind.slot_roles().first().copied().unwrap_or("内容");
                return Some(format!(
                    "已识别「{} ({CMD_PREFIX}{})」：当前填 [{first_role}]，按 Enter(;) 推进下一槽。",
                    kind.label(),
                    kind.code()
                ));
            }
            if SubCategory::from_key(c1).is_none()
                && c1 != 'j'
                && let Some(fmt) = self.library.lookup_custom(c1)
            {
                let first_role = fmt.slot_roles.first().map(|s| s.as_str()).unwrap_or("内容");
                return Some(format!(
                    "已识别自定义「{} ({CMD_PREFIX}{})」：当前填 [{first_role}]，按 Enter(;) 推进下一槽。",
                    fmt.label, fmt.item_key
                ));
            }
            if let Some(sub) = SubCategory::from_key(c1) {
                return match sub {
                    SubCategory::Custom => {
                        let def_hint = self
                            .library
                            .default_custom()
                            .map(|f| format!("按 Enter/空格 选默认 [{}] 或按键", f.label))
                            .unwrap_or_else(|| "点击右上角「扩展/模版」可新增任意 LaTeX 格式".to_owned());
                        Some(format!(
                            "已展开「{} ({CMD_PREFIX}k)」：{def_hint}。",
                            sub.title()
                        ))
                    }
                    SubCategory::Template => {
                        let def_hint = self
                            .library
                            .default_snippet()
                            .map(|s| format!("按 Enter/空格 插入默认 [{}] 或按子键", s.label))
                            .unwrap_or_else(|| "点击「+存片段」可保存当前公式".to_owned());
                        Some(format!(
                            "已展开「{} ({CMD_PREFIX}t)」：{def_hint}。",
                            sub.title()
                        ))
                    }
                    _ => {
                        let def_label = sub.default_entry().map(|d| d.label).unwrap_or("默认项");
                        Some(format!(
                            "已展开「{} ({CMD_PREFIX}{})」：按 Enter/空格 直接选用默认 [{def_label}]，或按对应单字母。",
                            sub.title(),
                            sub.key(),
                        ))
                    }
                };
            }
            if c1 != 'j' {
                return Some(format!(
                    "未知指令键 `{CMD_PREFIX}{c1}`：按 Backspace 退回并参考上方固定按键表。"
                ));
            }
        }

        // 2. 检查二级子菜单双字母完成 (`▸<c1><c2>`)
        if end >= 3
            && chars[end - 3] == CMD_PREFIX
            && chars[end - 2].is_ascii_alphabetic()
            && chars[end - 1].is_ascii_alphabetic()
        {
            let c1 = chars[end - 2].to_ascii_lowercase();
            let c2 = chars[end - 1].to_ascii_lowercase();
            if c1 == 'k' {
                return if let Some(fmt) = self.library.lookup_custom(c2) {
                    if let Some(first_role) = fmt.slot_roles.first() {
                        Some(format!(
                            "已识别自定义格式「{} ({CMD_PREFIX}k{c2})」：当前填 [{first_role}]，按 Enter(;) 推进。",
                            fmt.label
                        ))
                    } else {
                        Some(format!(
                            "已输入自定义符号「{} ({CMD_PREFIX}k{c2})」。",
                            fmt.label
                        ))
                    }
                } else {
                    Some(format!(
                        "未定义的自定义格式 `{CMD_PREFIX}k{c2}`：可在「扩展/模版」中添加该按键。"
                    ))
                };
            }
            if SubCategory::from_key(c1).is_some() {
                return match lookup_sub_command(c1, c2).or_else(|| lookup_sub_command(c1, c2.to_ascii_lowercase())) {
                    Some(CommandTarget::Struct(kind)) => {
                        let first_role = kind.slot_roles().first().copied().unwrap_or("内容");
                        Some(format!(
                            "已识别「{} ({CMD_PREFIX}{})」：当前填 [{first_role}]，按 Enter(;) 推进下一槽。",
                            kind.label(),
                            kind.code()
                        ))
                    }
                    Some(CommandTarget::Symbol(sym)) => Some(format!(
                        "已输入符号 {} ({CMD_PREFIX}{}, {})，无需分号可直接继续输入。",
                        sym.display_glyph(),
                        sym.code(),
                        sym.latex_macro()
                    )),
                    None => Some(format!(
                        "子菜单未知条目 `{CMD_PREFIX}{c1}{c2}`：按 Backspace 重选。"
                    )),
                };
            }
        }

        None
    }

    fn reparse(&mut self) {
        self.parsed = parse_with_library(&self.source, &self.library);
        self.last_synced_source = self.source.clone();
    }
}

fn common_affixes(old_chars: &[char], new_chars: &[char]) -> (usize, usize) {
    let min_len = old_chars.len().min(new_chars.len());
    let mut prefix = 0;
    while prefix < min_len && old_chars[prefix] == new_chars[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < (min_len - prefix)
        && old_chars[old_chars.len() - 1 - suffix] == new_chars[new_chars.len() - 1 - suffix]
    {
        suffix += 1;
    }
    (prefix, suffix)
}

fn adjust_pos_for_edit(pos: usize, old_src: &str, new_src: &str) -> usize {
    let old_chars: Vec<char> = old_src.chars().collect();
    let new_chars: Vec<char> = new_src.chars().collect();
    let (prefix, suffix) = common_affixes(&old_chars, &new_chars);
    let old_edit_end = old_chars.len().saturating_sub(suffix);
    let new_edit_end = new_chars.len().saturating_sub(suffix);

    if pos <= prefix {
        pos
    } else if pos >= old_edit_end {
        new_chars.len().saturating_sub(old_chars.len().saturating_sub(pos))
    } else {
        new_edit_end
    }
}

fn collect_atomic_cmd_spans(seq: &MathSeq, out: &mut Vec<Span>) {
    for item in &seq.items {
        match item {
            Expr::Symbol { span, .. } => out.push(*span),
            Expr::Struct {
                cmd_span, slots, ..
            }
            | Expr::CustomStruct {
                cmd_span, slots, ..
            } => {
                out.push(*cmd_span);
                for slot in slots {
                    collect_atomic_cmd_spans(&slot.seq, out);
                }
            }
            _ => {}
        }
    }
}

/// 从 `cmd_start` 往前逆向探测紧邻的前置原子表达式（用于后向主体智能包裹）
fn find_backward_atom(
    chars: &[char],
    cmd_start: usize,
    library: &UserLibrary,
) -> Option<(usize, usize, String)> {
    if cmd_start == 0 {
        return None;
    }
    let prev_c = chars[cmd_start - 1];
    if prev_c.is_whitespace() {
        return None;
    }

    // 1. 闭合括号 `(...)`, `[...]`, `{...}`
    if matches!(prev_c, ')' | ']' | '}') {
        let open_ch = match prev_c {
            ')' => '(',
            ']' => '[',
            '}' => '{',
            _ => unreachable!(),
        };
        let mut depth = 0;
        let mut open_idx = None;
        for i in (0..cmd_start).rev() {
            if chars[i] == prev_c {
                depth += 1;
            } else if chars[i] == open_ch {
                depth -= 1;
                if depth == 0 {
                    open_idx = Some(i);
                    break;
                }
            }
        }
        if let Some(start) = open_idx {
            let s: String = chars[start..cmd_start].iter().collect();
            return Some((start, cmd_start, s));
        }
        return None;
    }

    // 2. 闭合结构（以 `;` 结尾）：利用 AST 快速查找恰好结束在 cmd_start 的 Struct 节点
    if prev_c == STEP_SEP {
        let clean_source: String = chars[..cmd_start].iter().collect();
        let doc = parse_with_library(&clean_source, library);
        if let Some(start) = find_struct_start_ending_at(&doc.root, cmd_start) {
            let s: String = chars[start..cmd_start].iter().collect();
            return Some((start, cmd_start, s));
        }
    }

    // 3. 希腊字母或其他两字母子命令符号（形如 `▸gm`, `▸ga`, `▸od` 等，长为 3）
    if cmd_start >= 3 && chars[cmd_start - 3] == CMD_PREFIX {
        let c1 = chars[cmd_start - 2];
        let c2 = chars[cmd_start - 1];
        if c1.is_ascii_alphabetic() && c2.is_ascii_alphabetic() {
            let start = cmd_start - 3;
            let s: String = chars[start..cmd_start].iter().collect();
            return Some((start, cmd_start, s));
        }
    }

    // 4. 单字母直达符号（形如 `▸i`, `▸p`, `▸e` 等，长为 2）
    if cmd_start >= 2 && chars[cmd_start - 2] == CMD_PREFIX {
        let c1 = chars[cmd_start - 1];
        if c1.is_ascii_alphabetic() {
            let start = cmd_start - 2;
            let s: String = chars[start..cmd_start].iter().collect();
            return Some((start, cmd_start, s));
        }
    }

    // 5. 纯数字序列（如 `10`, `42`）
    if prev_c.is_ascii_digit() {
        let mut start = cmd_start - 1;
        while start > 0 && chars[start - 1].is_ascii_digit() {
            start -= 1;
        }
        let s: String = chars[start..cmd_start].iter().collect();
        return Some((start, cmd_start, s));
    }

    // 6. 单个英文字母（如 `G`, `x`, `T`, `g`）
    if prev_c.is_ascii_alphabetic() {
        let start = cmd_start - 1;
        let s: String = chars[start..cmd_start].iter().collect();
        return Some((start, cmd_start, s));
    }

    None
}

fn find_struct_start_ending_at(seq: &MathSeq, target_end: usize) -> Option<usize> {
    for item in &seq.items {
        match item {
            Expr::Struct { full_span, slots, .. } | Expr::CustomStruct { full_span, slots, .. } => {
                if full_span.end.char_idx == target_end {
                    return Some(full_span.start.char_idx);
                }
                for slot in slots {
                    if let Some(st) = find_struct_start_ending_at(&slot.seq, target_end) {
                        return Some(st);
                    }
                }
            }
            _ => {}
        }
    }
    None
}

/// 在序列 `seq` 中从 `start_char` 向右扫描，定位应当被前置结构包裹的主体终点（自动停在顶层 `=`, `<`, `>`, `->` 等关系符之前）
fn find_wrap_end_in_seq(seq: &MathSeq, clean_chars: &[char], start_char: usize) -> Option<usize> {
    let seq_start = seq.span.start.char_idx;
    let seq_end = seq.span.end.char_idx.min(clean_chars.len());
    if start_char >= seq_end {
        return None;
    }

    let left_trimmed_last = clean_chars[seq_start..start_char]
        .iter()
        .rev()
        .copied()
        .find(|c| !c.is_whitespace());
    let has_left_operand = left_trimmed_last.is_some_and(|c| {
        !matches!(
            c,
            '=' | '<' | '>' | '+' | '-' | '*' | '/' | '(' | '[' | '{' | ',' | ':' | '≤' | '≥' | '≠' | '≈' | '→'
        )
    });

    let mut first_non_ws_idx = start_char;
    while first_non_ws_idx < seq_end && clean_chars[first_non_ws_idx].is_whitespace() {
        first_non_ws_idx += 1;
    }
    if first_non_ws_idx >= seq_end {
        return None;
    }
    let first_c = clean_chars[first_non_ws_idx];
    if matches!(
        first_c,
        ')' | ']' | '}' | ',' | ';' | '=' | '<' | '>' | '≤' | '≥' | '≠' | '≈' | '→'
    ) {
        return None;
    }
    if has_left_operand && matches!(first_c, '+' | '-' | '*' | '/') {
        return None;
    }

    let mut has_content = false;
    let mut wrap_end = start_char;

    for item in &seq.items {
        let sp = item.span();
        if sp.end.char_idx <= start_char {
            continue;
        }
        match item {
            Expr::Struct { full_span, .. } | Expr::CustomStruct { full_span, .. } => {
                has_content = true;
                wrap_end = full_span.end.char_idx;
            }
            Expr::Symbol { cmd, span, .. } => {
                if has_content
                    && matches!(
                        cmd,
                        SymbolCmd::To
                            | SymbolCmd::In
                            | SymbolCmd::NotIn
                            | SymbolCmd::SubsetEq
                    )
                {
                    break;
                }
                has_content = true;
                wrap_end = span.end.char_idx;
            }
            Expr::Text { span, .. } => {
                let scan_from = start_char.max(span.start.char_idx);
                let scan_to = span.end.char_idx.min(clean_chars.len());
                let mut idx = scan_from;
                let mut hit_rel = false;
                while idx < scan_to {
                    if let Some(rel_len) = relational_token_at(&clean_chars[idx..scan_to]) {
                        if has_content {
                            wrap_end = idx;
                            hit_rel = true;
                            break;
                        }
                        idx += rel_len;
                        continue;
                    }
                    if !clean_chars[idx].is_whitespace() {
                        has_content = true;
                    }
                    idx += 1;
                    wrap_end = idx;
                }
                if hit_rel {
                    break;
                }
            }
            Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => {
                break;
            }
        }
    }

    while wrap_end > start_char && clean_chars[wrap_end - 1].is_whitespace() {
        wrap_end -= 1;
    }

    if has_content && wrap_end > start_char {
        Some(wrap_end)
    } else {
        None
    }
}

fn relational_token_at(slice: &[char]) -> Option<usize> {
    if slice.is_empty() {
        return None;
    }
    let head4: String = slice.iter().take(4).collect();
    for op in ["<=", ">=", "!=", "->", "<-", "=>", ":="] {
        if head4.starts_with(op) {
            return Some(op.chars().count());
        }
    }
    if matches!(
        slice[0],
        '=' | '<' | '>' | '≤' | '≥' | '≠' | '≈' | '→' | '←' | '∈' | '∉' | '⊆'
    ) {
        return Some(1);
    }
    if slice[0] == '\\' && slice.len() >= 3 && slice[1].is_ascii_alphabetic() {
        let mut w = 1;
        while w < slice.len() && slice[w].is_ascii_alphabetic() {
            w += 1;
        }
        let word: String = slice[1..w].iter().collect();
        if matches!(
            word.as_str(),
            "le" | "leq" | "ge" | "geq" | "ne" | "neq" | "to" | "rightarrow" | "approx" | "equiv" | "sim" | "in" | "notin" | "subseteq"
        ) {
            return Some(w);
        }
    }
    None
}

fn find_composite_by_path(scope: &NavScope, path: &[String]) -> Option<(usize, usize, String)> {
    let mut cur = scope;
    let mut out = None;
    for step in path {
        let entry = cur.entries.iter().find(|e| e.label == *step)?;
        match &entry.kind {
            NavEntryKind::Composite {
                role_hint,
                sub_scope,
                ..
            } => {
                out = Some((
                    entry.target_char_idx,
                    entry.missing_semis_at_eof,
                    role_hint.clone(),
                ));
                cur = sub_scope.as_ref();
            }
            _ => return None,
        }
    }
    out
}

fn insert_char_at(s: &mut String, char_idx: usize, ch: char) {
    let byte_idx = s
        .char_indices()
        .nth(char_idx)
        .map(|(b, _)| b)
        .unwrap_or(s.len());
    s.insert(byte_idx, ch);
}

/// 配对括号的闭合字符；`None` 表示该字符不是左括号。
fn matching_close(open: char) -> Option<char> {
    match open {
        '(' => Some(')'),
        '[' => Some(']'),
        '{' => Some('}'),
        _ => None,
    }
}

/// 配对括号的开始字符；`None` 表示该字符不是右括号。
fn matching_open(close: char) -> Option<char> {
    match close {
        ')' => Some('('),
        ']' => Some('['),
        '}' => Some('{'),
        _ => None,
    }
}

/// 字符是否被反斜杠转义（`\(`、`\{` 等不参与自动配对）。
fn is_escaped_at(chars: &[char], idx: usize) -> bool {
    let mut backslashes = 0;
    let mut i = idx;
    while i > 0 && chars[i - 1] == '\\' {
        backslashes += 1;
        i -= 1;
    }
    backslashes % 2 == 1
}

/// `\left(`、`\bigl[` 等定界符命令后的括号不做自动配对，避免破坏 LaTeX 语义。
fn is_latex_delimiter(chars: &[char], idx: usize, open: char) -> bool {
    if open == '{' || idx == 0 {
        return false;
    }
    let mut word_start = idx;
    while word_start > 0 && chars[word_start - 1].is_ascii_alphabetic() {
        word_start -= 1;
    }
    if word_start == 0 || chars[word_start - 1] != '\\' || word_start == idx {
        return false;
    }
    let word: String = chars[word_start..idx].iter().collect();
    matches!(
        word.as_str(),
        "left" | "right" | "bigl" | "bigr" | "Bigl" | "Bigr" | "biggl" | "biggr" | "Biggl"
            | "Biggr"
    )
}

/// 在 `before_idx` 之前是否存在未配对的 `open`。
fn has_unmatched_open(chars: &[char], before_idx: usize, open: char) -> bool {
    let close = matching_close(open).unwrap_or(open);
    let mut depth = 0usize;
    for &c in chars[..before_idx.min(chars.len())].iter().rev() {
        if c == close {
            depth += 1;
        } else if c == open {
            if depth == 0 {
                return true;
            }
            depth -= 1;
        }
    }
    false
}

/// 扫描源码中的所有配对定界符（()、[]、{}、||），按跨度从小到大排序（最内层在前）。
fn bracket_pairs(source: &str) -> Vec<BracketPair> {
    let chars: Vec<char> = source.chars().collect();
    let mut stack: Vec<(usize, char)> = Vec::new();
    let mut pairs = Vec::new();
    let mut pipe_open: Option<usize> = None;

    for (idx, &ch) in chars.iter().enumerate() {
        if is_escaped_at(&chars, idx) {
            continue;
        }
        match ch {
            '(' | '[' | '{' => stack.push((idx, ch)),
            ')' | ']' | '}' => {
                if let Some(pos) = stack
                    .iter()
                    .rposition(|&(_, open)| matching_close(open) == Some(ch))
                {
                    let (open_idx, open) = stack[pos];
                    stack.truncate(pos);
                    pairs.push(BracketPair {
                        open_char_idx: open_idx,
                        close_char_idx: idx,
                        open,
                        close: ch,
                    });
                }
            }
            '|' => {
                if let Some(open_idx) = pipe_open.take() {
                    pairs.push(BracketPair {
                        open_char_idx: open_idx,
                        close_char_idx: idx,
                        open: '|',
                        close: '|',
                    });
                } else {
                    pipe_open = Some(idx);
                }
            }
            ';' => {
                // 槽位分隔符重置未配对的绝对值竖线，防止跨槽位误配
                pipe_open = None;
            }
            _ => {}
        }
    }
    pairs.sort_by_key(|p| p.close_char_idx.saturating_sub(p.open_char_idx));
    pairs
}

fn describe_entry(entry: &NavEntry) -> &str {
    match &entry.kind {
        NavEntryKind::ScopeStart => "起点/行首",
        NavEntryKind::ScopeEnd => "终点/行尾",
        NavEntryKind::Leaf {
            role_hint: Some(role),
            ..
        } => role.as_str(),
        NavEntryKind::Leaf { .. } => "表达式末尾",
        NavEntryKind::Composite { role_hint, .. } => role_hint.as_str(),
    }
}

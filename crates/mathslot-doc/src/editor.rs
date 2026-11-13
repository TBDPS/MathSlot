use crate::cursor::{Cursor, Selection};
use crate::document::Document;
use crate::transaction::{DocError, Edit, Intent, Transaction};
use crate::undo::History;
use mathslot_syntax::{Expr, SlotId};
use serde::{Deserialize, Serialize};

/// 流式命令捕获状态机状态 (ADR-0013)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum StreamState {
    Idle,
    PrefixPending {
        prefix: String,
    },
    ParamCapture {
        command_id: String,
        slot_idx: usize,
        total_slots: usize,
        collected_params: Vec<String>,
        buffer: String,
    },
    UnknownCommand {
        raw: String,
    },
}

/// 编辑器级诊断 (Pending, Unknown, Syntax)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EditorDiagnostic {
    PendingCommand { prefix: String, message: String },
    UnknownCommand { command: String, message: String },
    Syntax(String),
}

impl EditorDiagnostic {
    #[must_use]
    pub fn is_error(&self) -> bool {
        matches!(self, Self::UnknownCommand { .. } | Self::Syntax(..))
    }

    #[must_use]
    pub fn is_pending(&self) -> bool {
        matches!(self, Self::PendingCommand { .. })
    }
}

/// 高层文档编辑器：协调 Document、Cursor/Selection、History 并响应流式键盘动作 (INV-008, A-EDIT)
#[derive(Debug, Clone)]
pub struct Editor {
    doc: Document,
    cursor: Cursor,
    selection: Selection,
    history: History,
    tx_seq: u64,
    stream_state: StreamState,
    diagnostics: Vec<EditorDiagnostic>,
    ime_composition: Option<String>,
    nav_mode: bool,
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
        let selection = Selection::caret(cursor.clone());

        Self {
            doc,
            cursor,
            selection,
            history: History::default(),
            tx_seq: 0,
            stream_state: StreamState::Idle,
            diagnostics: Vec::new(),
            ime_composition: None,
            nav_mode: false,
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
        self.selection = Selection::caret(cursor.clone());
        self.cursor = cursor;
        self.history.break_coalesce();
    }

    pub fn selection(&self) -> &Selection {
        &self.selection
    }

    pub fn set_selection(&mut self, selection: Selection) {
        self.cursor = selection.cursor().clone();
        self.selection = selection;
        self.history.break_coalesce();
    }

    pub fn history(&self) -> &History {
        &self.history
    }

    pub fn history_mut(&mut self) -> &mut History {
        &mut self.history
    }

    pub fn stream_state(&self) -> &StreamState {
        &self.stream_state
    }

    pub fn diagnostics(&self) -> &[EditorDiagnostic] {
        &self.diagnostics
    }

    pub fn has_pending_command(&self) -> bool {
        matches!(
            self.stream_state,
            StreamState::PrefixPending { .. } | StreamState::ParamCapture { .. }
        )
    }

    pub fn is_nav_mode(&self) -> bool {
        self.nav_mode
    }

    pub fn set_nav_mode(&mut self, active: bool) {
        self.nav_mode = active;
        self.history.break_coalesce();
    }

    pub fn enter_nav_mode(&mut self) {
        self.nav_mode = true;
        self.history.break_coalesce();
    }

    pub fn exit_nav_mode(&mut self) {
        self.nav_mode = false;
        self.history.break_coalesce();
    }

    pub fn is_composing(&self) -> bool {
        self.ime_composition.is_some()
    }

    pub fn ime_composition(&self) -> Option<&str> {
        self.ime_composition.as_deref()
    }

    pub fn set_ime_composition(&mut self, text: &str) {
        self.ime_composition = Some(text.to_string());
    }

    pub fn commit_ime(&mut self, text: &str) -> Result<(), DocError> {
        self.ime_composition = None;
        self.apply_with_intent(
            Edit::InsertLiteralText {
                at: self.cursor.clone(),
                text: text.to_string(),
            },
            "ime_commit",
            Intent::ImeCommit,
        )
        .map(|_| ())
    }

    pub fn to_latex(&self) -> String {
        let base = self.doc.to_latex();
        match &self.stream_state {
            StreamState::Idle => {
                if let Some(comp) = &self.ime_composition {
                    if base.is_empty() {
                        comp.clone()
                    } else {
                        format!("{base}{comp}")
                    }
                } else {
                    base
                }
            }
            StreamState::PrefixPending { prefix } => {
                let placeholder = if prefix.is_empty() {
                    "\\text{▸}".to_string()
                } else {
                    format!("\\text{{▸{prefix}}}")
                };
                if base.is_empty() {
                    placeholder
                } else {
                    format!("{base} {placeholder}")
                }
            }
            StreamState::ParamCapture {
                command_id,
                collected_params,
                buffer,
                ..
            } => {
                let mut placeholder = format!("▸{command_id}");
                for p in collected_params {
                    placeholder.push_str(p);
                    placeholder.push(';');
                }
                placeholder.push_str(buffer);
                let placeholder = format!("\\text{{{placeholder}}}");
                if base.is_empty() {
                    placeholder
                } else {
                    format!("{base} {placeholder}")
                }
            }
            StreamState::UnknownCommand { raw } => {
                let placeholder = if raw.starts_with("\\text{") {
                    raw.clone()
                } else {
                    format!("\\text{{{raw}}}")
                };
                if base.is_empty() {
                    placeholder
                } else {
                    format!("{base} {placeholder}")
                }
            }
        }
    }

    pub fn export_latex(&self) -> String {
        self.to_latex()
    }

    /// 导出 LaTeX 及所有编辑态诊断报告 (T1.6, D-004)
    /// 包含未决命令 (PendingCommand) 与未知命令 (UnknownCommand) 等诊断信息。
    pub fn export_latex_with_diagnostics(&self) -> (String, Vec<EditorDiagnostic>) {
        (self.to_latex(), self.diagnostics.clone())
    }

    /// 严格模式导出 LaTeX (T1.6, D-004)
    /// 当且仅当零诊断时返回 Ok(latex)，存在诊断时返回 Err(diagnostics) 阻断导出。
    pub fn export_latex_strict(&self) -> Result<String, Vec<EditorDiagnostic>> {
        if self.diagnostics.is_empty() {
            Ok(self.to_latex())
        } else {
            Err(self.diagnostics.clone())
        }
    }

    pub fn copy_text(&self) -> String {
        self.to_latex()
    }

    /// 应用单个原子编辑操作，默认使用 Intent::Typing
    pub fn apply(&mut self, edit: Edit, label: impl Into<String>) -> Result<Transaction, DocError> {
        self.apply_with_intent(edit, label, Intent::Typing)
    }

    /// 带显式意图的应用原子编辑操作，记录事务并压入历史栈（不依赖系统挂钟，D-106）
    pub fn apply_with_intent(
        &mut self,
        edit: Edit,
        label: impl Into<String>,
        intent: Intent,
    ) -> Result<Transaction, DocError> {
        let version_before = self.doc.version;
        let cursor_before = self.cursor.clone();
        let selection_before = self.selection.clone();

        let outcome = Transaction::apply_edit_with_outcome(&mut self.doc, &edit, &self.cursor)?;
        self.cursor = outcome.new_cursor.clone();
        self.selection = Selection::caret(outcome.new_cursor.clone());
        self.tx_seq += 1;

        let tx = Transaction {
            id: self.tx_seq,
            intent,
            label: label.into(),
            edits: vec![edit],
            inverse_edits: vec![outcome.inverse],
            cursor_before,
            cursor_after: outcome.new_cursor,
            selection_before,
            selection_after: self.selection.clone(),
            breaks_word_or_line: outcome.breaks_word_or_line,
            version_before,
            version_after: self.doc.version,
            timestamp_ms: self.tx_seq,
        };

        self.history.push(tx.clone());
        Ok(tx)
    }

    pub fn try_undo(&mut self) -> Result<bool, DocError> {
        let changed = self.history.undo(&mut self.doc, &mut self.selection)?;
        if changed {
            self.cursor = self.selection.cursor().clone();
            self.stream_state = StreamState::Idle;
            self.ime_composition = None;
            self.update_diagnostics();
        }
        Ok(changed)
    }

    pub fn try_redo(&mut self) -> Result<bool, DocError> {
        let changed = self.history.redo(&mut self.doc, &mut self.selection)?;
        if changed {
            self.cursor = self.selection.cursor().clone();
            self.stream_state = StreamState::Idle;
            self.ime_composition = None;
            self.update_diagnostics();
        }
        Ok(changed)
    }

    pub fn undo(&mut self) -> bool {
        match self.try_undo() {
            Ok(changed) => changed,
            Err(err) => {
                self.diagnostics
                    .push(EditorDiagnostic::Syntax(format!("Undo failed: {err}")));
                false
            }
        }
    }

    pub fn redo(&mut self) -> bool {
        match self.try_redo() {
            Ok(changed) => changed,
            Err(err) => {
                self.diagnostics
                    .push(EditorDiagnostic::Syntax(format!("Redo failed: {err}")));
                false
            }
        }
    }

    pub fn tab_next_slot(&mut self) -> bool {
        self.history.break_coalesce();
        if let Cursor::InSlot { slot_id, .. } = self.cursor
            && let Some(next_id) = self.doc.slots.next_slot(slot_id)
        {
            self.cursor = Cursor::InSlot {
                slot_id: next_id,
                offset: 0,
            };
            self.selection = Selection::caret(self.cursor.clone());
            return true;
        }

        if let Some(first_empty) = self.doc.slots.first_empty() {
            self.cursor = Cursor::InSlot {
                slot_id: first_empty,
                offset: 0,
            };
            self.selection = Selection::caret(self.cursor.clone());
            return true;
        }

        if let Some(first) = self.doc.slots.slots().first() {
            self.cursor = Cursor::InSlot {
                slot_id: first.id,
                offset: 0,
            };
            self.selection = Selection::caret(self.cursor.clone());
            return true;
        }

        false
    }

    pub fn tab_prev_slot(&mut self) -> bool {
        self.history.break_coalesce();
        if let Cursor::InSlot { slot_id, .. } = self.cursor
            && let Some(prev_id) = self.doc.slots.prev_slot(slot_id)
        {
            self.cursor = Cursor::InSlot {
                slot_id: prev_id,
                offset: 0,
            };
            self.selection = Selection::caret(self.cursor.clone());
            return true;
        }

        if let Some(last) = self.doc.slots.slots().last() {
            self.cursor = Cursor::InSlot {
                slot_id: last.id,
                offset: 0,
            };
            self.selection = Selection::caret(self.cursor.clone());
            return true;
        }

        false
    }

    pub fn nav_to_slot(&mut self, slot_id: SlotId) -> bool {
        self.history.break_coalesce();
        if self.doc.slots.get(slot_id).is_some() {
            self.cursor = Cursor::InSlot { slot_id, offset: 0 };
            self.selection = Selection::caret(self.cursor.clone());
            true
        } else {
            false
        }
    }

    pub fn nav_next(&mut self) -> bool {
        self.tab_next_slot()
    }

    pub fn nav_prev(&mut self) -> bool {
        self.tab_prev_slot()
    }

    pub fn nav_left(&mut self) -> bool {
        self.history.break_coalesce();
        if let Cursor::InSlot { slot_id, offset } = self.cursor
            && offset > 0
        {
            self.cursor = Cursor::InSlot {
                slot_id,
                offset: offset - 1,
            };
            self.selection = Selection::caret(self.cursor.clone());
            return true;
        }
        self.tab_prev_slot()
    }

    pub fn nav_right(&mut self) -> bool {
        self.history.break_coalesce();
        if let Cursor::InSlot { slot_id, offset } = self.cursor {
            let text_len = self.doc.get_slot_nodes(slot_id).map_or(0, |nodes| {
                if nodes.len() == 1 && matches!(nodes[0].node, Expr::Placeholder { .. }) {
                    0
                } else {
                    mathslot_syntax::to_latex(nodes).chars().count()
                }
            });
            if offset < text_len {
                self.cursor = Cursor::InSlot {
                    slot_id,
                    offset: offset + 1,
                };
                self.selection = Selection::caret(self.cursor.clone());
                return true;
            }
        }
        self.tab_next_slot()
    }

    pub fn clear(&mut self) -> Result<bool, DocError> {
        let had_pending =
            !matches!(self.stream_state, StreamState::Idle) || self.ime_composition.is_some();
        if self.doc.nodes.is_empty() && !had_pending {
            self.history.break_coalesce();
            return Ok(false);
        }

        self.stream_state = StreamState::Idle;
        self.ime_composition = None;
        self.nav_mode = false;
        self.update_diagnostics();

        if self.doc.nodes.is_empty() {
            self.history.break_coalesce();
            return Ok(true);
        }

        self.apply_with_intent(
            Edit::ReplaceAll {
                new_nodes: Vec::new(),
            },
            "clear",
            Intent::Clear,
        )?;
        Ok(true)
    }

    pub fn import_latex(&mut self, latex: &str) -> Result<Vec<EditorDiagnostic>, DocError> {
        let (parsed_doc, syntax_diags) = Document::from_latex(latex);

        self.stream_state = StreamState::Idle;
        self.ime_composition = None;
        self.nav_mode = false;

        self.apply_with_intent(
            Edit::ReplaceAll {
                new_nodes: parsed_doc.nodes,
            },
            "import_latex",
            Intent::Import,
        )?;

        let mapped_diags: Vec<EditorDiagnostic> = syntax_diags
            .into_iter()
            .map(|d| EditorDiagnostic::Syntax(d.kind.to_string()))
            .collect();
        self.diagnostics = mapped_diags.clone();
        Ok(mapped_diags)
    }

    pub fn insert_text(&mut self, s: &str) -> Result<(), DocError> {
        self.apply_with_intent(
            Edit::InsertText {
                at: self.cursor.clone(),
                text: s.to_string(),
            },
            "insert_text",
            Intent::Typing,
        )
        .map(|_| ())
    }

    pub fn paste_text(&mut self, text: &str) -> Result<(), DocError> {
        // 安全粘贴原语：纯字面量插入，绝不执行流式命令展开 (A-EDIT-006)
        self.apply_with_intent(
            Edit::InsertLiteralText {
                at: self.cursor.clone(),
                text: text.to_string(),
            },
            "paste_text",
            Intent::Paste,
        )
        .map(|_| ())
    }

    pub fn apply_palette_card(&mut self, card_or_cmd_id: &str) -> Result<(), DocError> {
        let cmd = mathslot_command::generated::find_by_id(card_or_cmd_id).or_else(|| {
            mathslot_command::generated::GENERATED_COMMANDS
                .iter()
                .find(|c| c.label == card_or_cmd_id || c.glyph == card_or_cmd_id)
        });

        let latex = if let Some(cmd) = cmd {
            if cmd.slots.is_empty() {
                cmd.latex.to_string()
            } else {
                let empty_params = vec![String::new(); cmd.slots.len()];
                expand_template(cmd.latex, &empty_params)
            }
        } else if card_or_cmd_id == "partial" {
            r"\partial".to_string()
        } else {
            card_or_cmd_id.to_string()
        };

        self.apply_with_intent(
            Edit::InsertText {
                at: self.cursor.clone(),
                text: latex,
            },
            format!("palette_card: {card_or_cmd_id}"),
            Intent::PaletteCard,
        )
        .map(|_| ())
    }

    pub fn apply_command_card(&mut self, cmd_id: &str) -> Result<(), DocError> {
        self.apply_palette_card(cmd_id)
    }

    pub fn delete_backward(&mut self) -> Result<(), DocError> {
        match &mut self.stream_state {
            StreamState::PrefixPending { prefix } => {
                if prefix.is_empty() {
                    self.stream_state = StreamState::Idle;
                    self.history.break_coalesce();
                } else {
                    prefix.pop();
                }
                self.update_diagnostics();
                Ok(())
            }
            StreamState::ParamCapture {
                buffer,
                collected_params,
                slot_idx,
                ..
            } => {
                if !buffer.is_empty() {
                    buffer.pop();
                } else if !collected_params.is_empty() {
                    *slot_idx = slot_idx.saturating_sub(1);
                    *buffer = collected_params.pop().unwrap_or_default();
                }
                self.update_diagnostics();
                Ok(())
            }
            StreamState::UnknownCommand { raw } => {
                raw.pop();
                if raw.is_empty() || raw == "▸" {
                    self.stream_state = StreamState::Idle;
                    self.history.break_coalesce();
                }
                self.update_diagnostics();
                Ok(())
            }
            StreamState::Idle => self.delete_in_idle(true),
        }
    }

    pub fn delete_forward(&mut self) -> Result<(), DocError> {
        if !matches!(self.stream_state, StreamState::Idle) {
            return Ok(());
        }
        self.delete_in_idle(false)
    }

    fn delete_in_idle(&mut self, backward: bool) -> Result<(), DocError> {
        let edit = if !self.selection.is_collapsed() {
            Edit::DeleteSelection {
                selection: self.selection.clone(),
            }
        } else {
            Edit::DeleteChar {
                at: self.cursor.clone(),
                backward,
            }
        };
        let label = if backward {
            "delete_backward"
        } else {
            "delete_forward"
        };
        match self.apply_with_intent(edit, label, Intent::Delete) {
            Ok(_) => Ok(()),
            Err(DocError::NothingToDelete) => Ok(()),
            Err(err) => Err(err),
        }
    }

    /// 单字符流式输入响应 (A-EDIT-001, A-EDIT-002, A-EDIT-003)
    pub fn type_char(&mut self, ch: char) -> Result<(), DocError> {
        if self.nav_mode {
            // 纯读导航模式：不改动文本与撤销栈 (A-EDIT-008)
            match ch {
                'j' | 'n' | '\t' => {
                    self.nav_next();
                }
                'k' | 'p' => {
                    self.nav_prev();
                }
                'l' => {
                    self.nav_right();
                }
                'h' => {
                    self.nav_left();
                }
                _ => {}
            }
            return Ok(());
        }

        match &mut self.stream_state {
            StreamState::Idle => {
                if ch == '▸' {
                    self.history.break_coalesce();
                    self.stream_state = StreamState::PrefixPending {
                        prefix: String::new(),
                    };
                    self.update_diagnostics();
                } else if ch.is_whitespace() {
                    // 空白字符仅封口当前输入组，不插入破坏偏移的幽灵空白 (INV-008)
                    self.history.break_coalesce();
                } else {
                    self.apply_with_intent(
                        Edit::InsertText {
                            at: self.cursor.clone(),
                            text: ch.to_string(),
                        },
                        "type_char",
                        Intent::Typing,
                    )?;
                }
            }

            StreamState::PrefixPending { prefix } => {
                prefix.push(ch);
                let current_prefix = prefix.clone();
                self.process_prefix_update(&current_prefix)?;
            }

            StreamState::ParamCapture {
                command_id,
                slot_idx,
                total_slots,
                collected_params,
                buffer,
            } => {
                if ch == ';' {
                    let param = std::mem::take(buffer);
                    collected_params.push(param);
                    *slot_idx += 1;
                    if collected_params.len() >= *total_slots {
                        let cmd_id = command_id.clone();
                        let params = std::mem::take(collected_params);
                        self.stream_state = StreamState::Idle;
                        self.update_diagnostics();
                        self.expand_command(&cmd_id, &params)?;
                    } else {
                        self.update_diagnostics();
                    }
                } else {
                    buffer.push(ch);
                    self.update_diagnostics();
                }
            }

            StreamState::UnknownCommand { raw } => {
                raw.push(ch);
                self.update_diagnostics();
            }
        }

        Ok(())
    }

    fn process_prefix_update(&mut self, current_prefix: &str) -> Result<(), DocError> {
        let keys_vec: Vec<String> = current_prefix.chars().map(|c| c.to_string()).collect();
        let key_refs: Vec<&str> = keys_vec.iter().map(|s| s.as_str()).collect();

        // 1. 检查是否存在完全匹配的命令
        if let Some(cmd) = mathslot_command::generated::find_by_keys(&key_refs) {
            if cmd.slots.is_empty() {
                // 0 槽位命令直接原地展开 (如偏导 ▸oc -> \partial)
                self.stream_state = StreamState::Idle;
                self.update_diagnostics();
                self.expand_command(cmd.id, &[])?;
            } else {
                // 存在槽位，进入参数流式捕获模式
                self.stream_state = StreamState::ParamCapture {
                    command_id: cmd.id.to_string(),
                    slot_idx: 0,
                    total_slots: cmd.slots.len(),
                    collected_params: Vec::with_capacity(cmd.slots.len()),
                    buffer: String::new(),
                };
                self.update_diagnostics();
            }
            return Ok(());
        }

        // 2. 检查是否为某命令的前缀 (Prefix-free 保证前缀链单调)
        let is_prefix = mathslot_command::generated::GENERATED_COMMANDS
            .iter()
            .any(|cmd| {
                cmd.keys.len() > key_refs.len() && cmd.keys[..key_refs.len()] == key_refs[..]
            });

        if is_prefix {
            self.stream_state = StreamState::PrefixPending {
                prefix: current_prefix.to_string(),
            };
            self.update_diagnostics();
        } else {
            // 非法/未知命令 (A-EDIT-003)：不静默丢弃前缀，进入未知状态机
            self.stream_state = StreamState::UnknownCommand {
                raw: format!("▸{current_prefix}"),
            };
            self.update_diagnostics();
        }

        Ok(())
    }

    fn expand_command(&mut self, cmd_id: &str, params: &[String]) -> Result<(), DocError> {
        let template = if let Some(cmd) = mathslot_command::generated::find_by_id(cmd_id) {
            cmd.latex
        } else {
            cmd_id
        };

        let expanded_latex = expand_template(template, params);
        self.apply_with_intent(
            Edit::InsertText {
                at: self.cursor.clone(),
                text: expanded_latex,
            },
            format!("expand_command: {cmd_id}"),
            Intent::CommandExpansion,
        )?;
        Ok(())
    }

    fn update_diagnostics(&mut self) {
        match &self.stream_state {
            StreamState::Idle => {
                self.diagnostics.clear();
            }
            StreamState::PrefixPending { prefix } => {
                self.diagnostics = vec![EditorDiagnostic::PendingCommand {
                    prefix: prefix.clone(),
                    message: format!("Pending command: ▸{prefix}"),
                }];
            }
            StreamState::ParamCapture {
                command_id,
                slot_idx,
                total_slots,
                ..
            } => {
                self.diagnostics = vec![EditorDiagnostic::PendingCommand {
                    prefix: command_id.clone(),
                    message: format!(
                        "Pending command: ▸{} (slot {}/{})",
                        command_id,
                        slot_idx + 1,
                        total_slots
                    ),
                }];
            }
            StreamState::UnknownCommand { raw } => {
                let cmd = raw.strip_prefix('▸').unwrap_or(raw);
                self.diagnostics = vec![EditorDiagnostic::UnknownCommand {
                    command: cmd.to_string(),
                    message: format!("Unknown command: {raw}"),
                }];
            }
        }
    }
}

fn expand_template(template: &str, params: &[String]) -> String {
    let mut result = template.to_string();
    for (i, p) in params.iter().enumerate() {
        let placeholder = format!("${}", i + 1);
        result = result.replace(&placeholder, p);
    }
    result
}

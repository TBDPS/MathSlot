use mathslot_doc::{Cursor, Document, Editor, EditorDiagnostic as Diagnostic, History, Selection};
use serde::{Deserialize, Serialize};

use crate::command::AppCommand;
use crate::effect::{Effect, FocusTarget, RenderRequest, StatusMessage, StatusSeverity};
use crate::event::{AppEvent, EditorAction, Key, NavAction};
use crate::snapshot::{DiagnosticSnapshot, DispatchResponse, EngineSnapshot, SlotSnapshot};
use crate::state::EditorState;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize, Deserialize)]
pub enum AppError {
    #[error("Document error: {0}")]
    Doc(String),
    #[error("Strict export blocked due to pending or error diagnostics: {0:?}")]
    StrictExportBlocked(Vec<Diagnostic>),
}

#[derive(Debug, Clone)]
pub struct App {
    editor: Editor,
    state: EditorState,
    render_seq: u64,
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}

impl App {
    #[must_use]
    pub fn new() -> Self {
        Self::from_doc(Document::new())
    }

    #[must_use]
    pub fn from_doc(doc: Document) -> Self {
        Self {
            editor: Editor::new(doc),
            state: EditorState::Idle,
            render_seq: 0,
        }
    }

    #[must_use]
    pub fn from_latex(latex: &str) -> Self {
        let (doc, _) = Document::from_latex(latex);
        Self::from_doc(doc)
    }

    pub fn handle_event(&mut self, event: AppEvent) -> Vec<Effect> {
        self.dispatch(event)
    }

    pub fn dispatch(&mut self, event: AppEvent) -> Vec<Effect> {
        let command = self.event_to_command(event);
        self.execute_command(command)
    }

    pub fn dispatch_snapshot(&mut self, event: AppEvent) -> DispatchResponse {
        let effects = self.dispatch(event);
        let snapshot = self.snapshot();
        DispatchResponse { effects, snapshot }
    }

    #[must_use]
    pub fn snapshot(&self) -> EngineSnapshot {
        let active_slot_id = match self.editor.cursor() {
            Cursor::InSlot { slot_id, .. } => Some(slot_id.0),
            Cursor::AtStart | Cursor::AtNode(_) | Cursor::AtEnd => None,
        };

        let slots = self
            .editor
            .doc()
            .slots
            .slots()
            .iter()
            .map(|slot| SlotSnapshot::from_slot(slot, active_slot_id))
            .collect();

        let diagnostics = self
            .editor
            .diagnostics()
            .iter()
            .map(DiagnosticSnapshot::from_diagnostic)
            .collect();

        EngineSnapshot {
            state: self.state.clone(),
            latex: self.editor.to_latex(),
            copy_text: self.editor.copy_text(),
            has_pending_command: self.editor.has_pending_command(),
            is_composing: self.editor.is_composing(),
            is_nav_mode: self.is_nav_mode(),
            can_undo: self.editor.history().can_undo(),
            can_redo: self.editor.history().can_redo(),
            slots,
            diagnostics,
            active_slot_id,
        }
    }

    fn event_to_command(&self, event: AppEvent) -> AppCommand {
        match event {
            AppEvent::KeyInput(ch) | AppEvent::Key(ch) => {
                if self.is_nav_mode() {
                    match ch {
                        'j' | 'n' | '\t' => AppCommand::MoveCursor(NavAction::NextSlot),
                        'k' | 'p' => AppCommand::MoveCursor(NavAction::PrevSlot),
                        'l' => AppCommand::MoveCursor(NavAction::StepRight),
                        'h' => AppCommand::MoveCursor(NavAction::StepLeft),
                        _ => AppCommand::Noop,
                    }
                } else {
                    AppCommand::TypeChar(ch)
                }
            }
            AppEvent::KeyDown(key) => match key {
                Key::Backspace => AppCommand::DeleteBackward,
                Key::Delete => AppCommand::DeleteForward,
                Key::Tab => AppCommand::MoveCursor(NavAction::NextSlot),
                Key::Escape => {
                    if self.is_nav_mode() {
                        AppCommand::ExitNav
                    } else {
                        AppCommand::DeleteBackward
                    }
                }
                Key::Enter => AppCommand::Noop,
                Key::ArrowLeft => AppCommand::MoveCursor(NavAction::StepLeft),
                Key::ArrowRight => AppCommand::MoveCursor(NavAction::StepRight),
            },
            AppEvent::Action(action) => match action {
                EditorAction::Backspace => AppCommand::DeleteBackward,
                EditorAction::Delete => AppCommand::DeleteForward,
                EditorAction::TabNext => AppCommand::MoveCursor(NavAction::NextSlot),
                EditorAction::TabPrev => AppCommand::MoveCursor(NavAction::PrevSlot),
                EditorAction::Escape => {
                    if self.is_nav_mode() {
                        AppCommand::ExitNav
                    } else {
                        AppCommand::DeleteBackward
                    }
                }
                EditorAction::Enter => AppCommand::Noop,
            },
            AppEvent::Paste(s) | AppEvent::PasteText(s) => AppCommand::InsertLiteral(s),
            AppEvent::PaletteCard(id) | AppEvent::ApplyCard(id) => {
                AppCommand::ApplyPaletteCard { command_id: id }
            }
            AppEvent::Undo => AppCommand::PerformUndo,
            AppEvent::Redo => AppCommand::PerformRedo,
            AppEvent::RequestExport { strict } => AppCommand::ExecuteExport {
                strict,
                copy_to_clipboard: false,
            },
            AppEvent::RequestCopy => AppCommand::ExecuteExport {
                strict: false,
                copy_to_clipboard: true,
            },
            AppEvent::ExportRequested {
                strict,
                copy_to_clipboard,
            } => AppCommand::ExecuteExport {
                strict,
                copy_to_clipboard,
            },
            AppEvent::ImeCompositionUpdate(s) | AppEvent::ImeComposition(s) => {
                AppCommand::UpdateImeBuffer(s)
            }
            AppEvent::ImeCompositionCommit(s) | AppEvent::ImeCommit(s) => AppCommand::CommitIme(s),
            AppEvent::EnterNavMode => AppCommand::EnterNav,
            AppEvent::ExitNavMode => AppCommand::ExitNav,
            AppEvent::Navigate(nav) => match nav {
                NavAction::EnterNav => AppCommand::EnterNav,
                NavAction::ExitNav => AppCommand::ExitNav,
                other => AppCommand::MoveCursor(other),
            },
            AppEvent::SelectSlot(id) => AppCommand::SelectSlot(id),
            AppEvent::Clear => AppCommand::ResetDocument,
            AppEvent::ImportLatex(latex) => AppCommand::ImportLatex(latex),
            AppEvent::LoadStreamSource(source) => AppCommand::LoadStreamSource(source),
        }
    }

    fn execute_command(&mut self, command: AppCommand) -> Vec<Effect> {
        let mut status_effects = Vec::new();
        let mut host_effects = Vec::new();
        let mut emit_render = false;
        let mut emit_focus = false;

        match command {
            AppCommand::Noop => {}
            AppCommand::TypeChar(ch) => {
                match self.editor.type_char(ch) {
                    Ok(()) => {}
                    Err(err) => {
                        status_effects.push(Effect::Status(StatusMessage {
                            severity: StatusSeverity::Error,
                            message: format!("TypeChar error: {err}"),
                        }));
                    }
                }
                emit_render = true;
                emit_focus = true;
            }
            AppCommand::InsertLiteral(text) => {
                match self.editor.paste_text(&text) {
                    Ok(()) => {}
                    Err(err) => {
                        status_effects.push(Effect::Status(StatusMessage {
                            severity: StatusSeverity::Error,
                            message: format!("Paste error: {err}"),
                        }));
                    }
                }
                emit_render = true;
                emit_focus = true;
            }
            AppCommand::DeleteBackward => {
                match self.editor.delete_backward() {
                    Ok(()) => {}
                    Err(err) => {
                        status_effects.push(Effect::Status(StatusMessage {
                            severity: StatusSeverity::Error,
                            message: format!("Delete backward error: {err}"),
                        }));
                    }
                }
                emit_render = true;
                emit_focus = true;
            }
            AppCommand::DeleteForward => {
                match self.editor.delete_forward() {
                    Ok(()) => {}
                    Err(err) => {
                        status_effects.push(Effect::Status(StatusMessage {
                            severity: StatusSeverity::Error,
                            message: format!("Delete forward error: {err}"),
                        }));
                    }
                }
                emit_render = true;
                emit_focus = true;
            }
            AppCommand::ApplyPaletteCard { command_id } => {
                match self.editor.apply_palette_card(&command_id) {
                    Ok(()) => {}
                    Err(err) => {
                        status_effects.push(Effect::Status(StatusMessage {
                            severity: StatusSeverity::Error,
                            message: format!("Palette card error: {err}"),
                        }));
                    }
                }
                emit_render = true;
                emit_focus = true;
            }
            AppCommand::MoveCursor(nav) => match nav {
                NavAction::NextSlot => {
                    let moved = self.editor.nav_next();
                    if moved {
                        emit_focus = true;
                    }
                }
                NavAction::PrevSlot => {
                    let moved = self.editor.nav_prev();
                    if moved {
                        emit_focus = true;
                    }
                }
                NavAction::StepLeft => {
                    let moved = self.editor.nav_left();
                    if moved {
                        emit_focus = true;
                    }
                }
                NavAction::StepRight => {
                    let moved = self.editor.nav_right();
                    if moved {
                        emit_focus = true;
                    }
                }
                NavAction::EnterNav | NavAction::ExitNav => {}
            },
            AppCommand::UpdateImeBuffer(text) => {
                self.editor.set_ime_composition(&text);
                emit_render = true;
            }
            AppCommand::CommitIme(text) => {
                match self.editor.commit_ime(&text) {
                    Ok(()) => {}
                    Err(err) => {
                        status_effects.push(Effect::Status(StatusMessage {
                            severity: StatusSeverity::Error,
                            message: format!("Commit IME error: {err}"),
                        }));
                    }
                }
                emit_render = true;
                emit_focus = true;
            }
            AppCommand::EnterNav => {
                self.editor.enter_nav_mode();
                status_effects.push(Effect::Status(StatusMessage {
                    severity: StatusSeverity::Info,
                    message: "Entered navigation mode".to_string(),
                }));
                emit_focus = true;
            }
            AppCommand::ExitNav => {
                self.editor.exit_nav_mode();
                status_effects.push(Effect::Status(StatusMessage {
                    severity: StatusSeverity::Info,
                    message: "Exited navigation mode".to_string(),
                }));
            }
            AppCommand::SelectSlot(id) => {
                if self.editor.nav_to_slot(mathslot_syntax::SlotId(id)) {
                    status_effects.push(Effect::Status(StatusMessage {
                        severity: StatusSeverity::Info,
                        message: format!("Selected slot #{id}"),
                    }));
                    emit_focus = true;
                } else {
                    status_effects.push(Effect::Status(StatusMessage {
                        severity: StatusSeverity::Warning,
                        message: format!("Slot #{id} not found"),
                    }));
                }
            }
            AppCommand::PerformUndo => {
                let undone = self.editor.undo();
                if undone {
                    emit_render = true;
                    emit_focus = true;
                }
            }
            AppCommand::PerformRedo => {
                let redone = self.editor.redo();
                if redone {
                    emit_render = true;
                    emit_focus = true;
                }
            }
            AppCommand::ResetDocument => match self.editor.clear() {
                Ok(changed) => {
                    if changed {
                        emit_render = true;
                        emit_focus = true;
                    }
                }
                Err(err) => {
                    status_effects.push(Effect::Status(StatusMessage {
                        severity: StatusSeverity::Error,
                        message: format!("Clear error: {err}"),
                    }));
                }
            },
            AppCommand::ImportLatex(latex) => {
                if let Err(err) = self.editor.import_latex(&latex) {
                    status_effects.push(Effect::Status(StatusMessage {
                        severity: StatusSeverity::Error,
                        message: format!("Import error: {err}"),
                    }));
                }
                emit_render = true;
                emit_focus = true;
            }
            AppCommand::LoadStreamSource(source) => {
                let (expanded_latex, stream_errors) = expand_stream_source(&source);
                match self.editor.import_latex(&expanded_latex) {
                    Ok(diags) => {
                        if !stream_errors.is_empty() {
                            status_effects.push(Effect::Status(StatusMessage {
                                severity: StatusSeverity::Error,
                                message: format!(
                                    "Unknown or incomplete stream command: {}",
                                    stream_errors.join(", ")
                                ),
                            }));
                        } else if !diags.is_empty() {
                            status_effects.push(Effect::Status(StatusMessage {
                                severity: StatusSeverity::Warning,
                                message: format!(
                                    "Loaded stream source with {} diagnostic(s)",
                                    diags.len()
                                ),
                            }));
                        } else {
                            status_effects.push(Effect::Status(StatusMessage {
                                severity: StatusSeverity::Info,
                                message: "Loaded stream source".to_string(),
                            }));
                        }
                    }
                    Err(err) => {
                        status_effects.push(Effect::Status(StatusMessage {
                            severity: StatusSeverity::Error,
                            message: format!("Load stream source error: {err}"),
                        }));
                    }
                }
                emit_render = true;
                emit_focus = true;
            }
            AppCommand::ExecuteExport {
                strict,
                copy_to_clipboard,
            } => {
                if copy_to_clipboard {
                    host_effects.push(Effect::Clipboard(self.editor.copy_text()));
                }

                if strict {
                    match self.editor.export_latex_strict() {
                        Ok(latex) => {
                            host_effects.push(Effect::ExportResult(Ok((latex, Vec::new()))));
                        }
                        Err(diags) => {
                            host_effects.push(Effect::ExportResult(Err(
                                AppError::StrictExportBlocked(diags),
                            )));
                        }
                    }
                } else {
                    let (latex, diags) = self.editor.export_latex_with_diagnostics();
                    host_effects.push(Effect::ExportResult(Ok((latex, diags))));
                }
            }
        }

        self.sync_state();

        // 1. Status effects: append any editor diagnostics
        if let Some(first_diag) = self.editor.diagnostics().first() {
            if first_diag.is_error() {
                status_effects.push(Effect::Status(StatusMessage {
                    severity: StatusSeverity::Error,
                    message: format!("{first_diag:?}"),
                }));
            } else if first_diag.is_pending() {
                status_effects.push(Effect::Status(StatusMessage {
                    severity: StatusSeverity::Info,
                    message: format!("{first_diag:?}"),
                }));
            }
        }

        let mut effects = status_effects;

        // 2. Render effect
        if emit_render {
            self.render_seq += 1;
            effects.push(Effect::Render(RenderRequest {
                request_id: self.render_seq,
                latex: self.editor.to_latex(),
                has_diagnostics: !self.editor.diagnostics().is_empty(),
            }));
        }

        // 3. Focus effect
        if emit_focus {
            match self.editor.cursor() {
                Cursor::InSlot { slot_id, .. } => {
                    effects.push(Effect::Focus(FocusTarget::Slot(*slot_id)));
                }
                Cursor::AtStart | Cursor::AtNode(_) | Cursor::AtEnd => {
                    effects.push(Effect::Focus(FocusTarget::End));
                }
            }
        }

        // 4. Host effects (Clipboard, ExportResult)
        effects.extend(host_effects);

        effects
    }

    fn sync_state(&mut self) {
        if self.editor.is_nav_mode() {
            let path = match self.editor.cursor() {
                Cursor::InSlot { slot_id, .. } => self
                    .editor
                    .doc()
                    .slots
                    .get(*slot_id)
                    .map(|slot| {
                        if slot.path.is_root() {
                            vec![format!("#{}", slot_id.0)]
                        } else {
                            slot.path
                                .as_slice()
                                .iter()
                                .map(ToString::to_string)
                                .collect()
                        }
                    })
                    .unwrap_or_else(|| vec![format!("#{}", slot_id.0)]),
                Cursor::AtNode(ast_path) => {
                    if ast_path.is_root() {
                        vec!["root".to_string()]
                    } else {
                        ast_path
                            .as_slice()
                            .iter()
                            .map(ToString::to_string)
                            .collect()
                    }
                }
                Cursor::AtStart => vec!["start".to_string()],
                Cursor::AtEnd => vec!["end".to_string()],
            };
            self.state = EditorState::Nav { path };
            return;
        }

        match self.editor.stream_state() {
            mathslot_doc::StreamState::Idle => {
                self.state = EditorState::Idle;
            }
            mathslot_doc::StreamState::PrefixPending { prefix } => {
                if prefix.is_empty() {
                    self.state = EditorState::PrefixRoot;
                } else {
                    let last_char = prefix.chars().last().unwrap_or('?');
                    self.state = EditorState::PrefixSub { key: last_char };
                }
            }
            mathslot_doc::StreamState::ParamCapture { command_id, .. } => {
                let last_char = command_id.chars().last().unwrap_or('?');
                self.state = EditorState::PrefixSub { key: last_char };
            }
            mathslot_doc::StreamState::UnknownCommand { raw } => {
                let last_char = raw.chars().last().unwrap_or('?');
                self.state = EditorState::InvalidPrefix { key: last_char };
            }
        }
    }

    #[must_use]
    pub fn state(&self) -> &EditorState {
        &self.state
    }

    #[must_use]
    pub fn to_latex(&self) -> String {
        self.editor.to_latex()
    }

    #[must_use]
    pub fn export_latex(&self) -> String {
        self.editor.export_latex()
    }

    #[must_use]
    pub fn copy_text(&self) -> String {
        self.editor.copy_text()
    }

    #[must_use]
    pub fn diagnostics(&self) -> &[Diagnostic] {
        self.editor.diagnostics()
    }

    #[must_use]
    pub fn has_pending_command(&self) -> bool {
        self.editor.has_pending_command()
    }

    #[must_use]
    pub fn is_composing(&self) -> bool {
        self.editor.is_composing()
    }

    #[must_use]
    pub fn ime_composition(&self) -> Option<&str> {
        self.editor.ime_composition()
    }

    #[must_use]
    pub fn is_nav_mode(&self) -> bool {
        matches!(self.state, EditorState::Nav { .. })
    }

    #[must_use]
    pub fn cursor(&self) -> &Cursor {
        self.editor.cursor()
    }

    #[must_use]
    pub fn selection(&self) -> &Selection {
        self.editor.selection()
    }

    pub fn set_selection(&mut self, selection: Selection) {
        self.editor.set_selection(selection);
    }

    #[must_use]
    pub fn history(&self) -> &History {
        self.editor.history()
    }

    #[must_use]
    pub fn doc(&self) -> &Document {
        self.editor.doc()
    }
}

fn expand_stream_source(source: &str) -> (String, Vec<String>) {
    let chars: Vec<char> = source.chars().collect();
    let mut pos = 0;
    let mut errors = Vec::new();
    let expanded = expand_stream_seq(&chars, &mut pos, false, &mut errors);
    (expanded, errors)
}

fn expand_stream_seq(
    chars: &[char],
    pos: &mut usize,
    stop_on_semi: bool,
    errors: &mut Vec<String>,
) -> String {
    let mut out = String::new();
    while *pos < chars.len() {
        let ch = chars[*pos];
        if ch == ';' {
            *pos += 1;
            if stop_on_semi {
                return out;
            }
            continue;
        }
        if ch == '▸' {
            let piece = expand_stream_command(chars, pos, errors);
            append_latex_piece(&mut out, &piece);
            continue;
        }

        let mut buf = String::new();
        while *pos < chars.len() {
            let c = chars[*pos];
            if c == '▸' || c == ';' {
                break;
            }
            buf.push(c);
            *pos += 1;
        }
        append_latex_piece(&mut out, &buf);
    }
    out
}

fn expand_stream_command(chars: &[char], pos: &mut usize, errors: &mut Vec<String>) -> String {
    *pos += 1; // consume '▸'
    let Some(&c1) = chars.get(*pos) else {
        errors.push("▸".to_string());
        return r"\text{▸}".to_string();
    };

    let k1 = c1.to_string();
    if let Some(cmd) = mathslot_command::generated::find_by_keys(&[k1.as_str()]) {
        *pos += 1;
        return expand_matched_command(cmd, chars, pos, errors);
    }

    let has_two_key_prefix = mathslot_command::generated::GENERATED_COMMANDS
        .iter()
        .any(|cmd| cmd.keys.len() > 1 && cmd.keys[0] == k1);

    if has_two_key_prefix && let Some(&c2) = chars.get(*pos + 1) {
        let k2 = c2.to_string();
        if let Some(cmd) = mathslot_command::generated::find_by_keys(&[k1.as_str(), k2.as_str()]) {
            *pos += 2;
            return expand_matched_command(cmd, chars, pos, errors);
        }
        *pos += 2;
        let raw = format!("▸{c1}{c2}");
        errors.push(raw.clone());
        return format!(r"\text{{{raw}}}");
    }

    *pos += 1;
    let raw = format!("▸{c1}");
    errors.push(raw.clone());
    format!(r"\text{{{raw}}}")
}

fn expand_matched_command(
    cmd: &mathslot_command::generated::StaticCommand,
    chars: &[char],
    pos: &mut usize,
    errors: &mut Vec<String>,
) -> String {
    if cmd.slots.is_empty() {
        return cmd.latex.to_string();
    }

    let mut params = Vec::with_capacity(cmd.slots.len());
    for _ in 0..cmd.slots.len() {
        let arg = expand_stream_seq(chars, pos, true, errors);
        params.push(arg);
    }
    substitute_template(cmd.latex, &params)
}

fn substitute_template(template: &str, params: &[String]) -> String {
    let mut out = String::with_capacity(template.len());
    let mut chars = template.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '$' {
            let mut digits = String::new();
            while let Some(&next_ch) = chars.peek() {
                if next_ch.is_ascii_digit() {
                    digits.push(next_ch);
                    chars.next();
                } else {
                    break;
                }
            }
            if !digits.is_empty()
                && let Ok(one_based) = digits.parse::<usize>()
                && one_based >= 1
                && let Some(param) = params.get(one_based - 1)
            {
                out.push_str(param);
            } else {
                out.push('$');
                out.push_str(&digits);
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn append_latex_piece(out: &mut String, piece: &str) {
    if piece.is_empty() {
        return;
    }
    if out.is_empty() {
        out.push_str(piece);
    } else {
        *out = mathslot_syntax::Printer::join_latex_without_macro_gluing(out, piece);
    }
}

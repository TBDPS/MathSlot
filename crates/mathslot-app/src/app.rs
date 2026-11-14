use mathslot_doc::{Cursor, Document, Editor, EditorDiagnostic as Diagnostic, History, Selection};
use serde::{Deserialize, Serialize};

use crate::command::AppCommand;
use crate::effect::{
    Effect, FocusTarget, HostAction, RenderRequest, StatusMessage, StatusSeverity,
};
use crate::event::{AppEvent, EditorAction, Key, NavAction};
use crate::snapshot::{
    AppSettings, DiagnosticSnapshot, DispatchResponse, EngineSnapshot, ImportReportSnapshot,
    RecoveryStateSnapshot, SlotSnapshot,
};
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
    settings: AppSettings,
    recovery: Option<RecoveryStateSnapshot>,
    last_import: Option<ImportReportSnapshot>,
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
            settings: AppSettings::default(),
            recovery: None,
            last_import: None,
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

        let latex = self.editor.to_latex();
        let preview_latex = self.editor.to_preview_latex_mathjax();
        let diagnostics = self
            .editor
            .diagnostics()
            .iter()
            .map(|diag| DiagnosticSnapshot::from_diagnostic_with_source(diag, &latex))
            .collect();

        EngineSnapshot {
            state: self.state.clone(),
            latex,
            preview_latex,
            copy_text: self
                .settings
                .delimiter_style
                .format_latex(&self.editor.copy_text()),
            has_pending_command: self.editor.has_pending_command(),
            is_composing: self.editor.is_composing(),
            is_nav_mode: self.is_nav_mode(),
            can_undo: self.editor.history().can_undo(),
            can_redo: self.editor.history().can_redo(),
            slots,
            diagnostics,
            active_slot_id,
            settings: self.settings.clone(),
            recovery: self.recovery.clone(),
            last_import: self.last_import.clone(),
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
            AppEvent::ImportAcknowledge => AppCommand::AcknowledgeImport,
            AppEvent::LoadStreamSource(source) => AppCommand::LoadStreamSource(source),
            AppEvent::UpdateSettings(settings) => AppCommand::UpdateSettings(settings),
            AppEvent::ResetSettingsConfirmed => AppCommand::ResetSettingsConfirmed,
            AppEvent::SetRecoveryState(recovery) => AppCommand::SetRecoveryState(recovery),
            AppEvent::RequestRestoreBackup => AppCommand::RequestRestoreBackup,
            AppEvent::ConfirmResetEmptyConfig => AppCommand::ConfirmResetEmptyConfig,
            AppEvent::RequestImportConfig => AppCommand::RequestImportConfig,
            AppEvent::RequestExportConfig => AppCommand::RequestExportConfig,
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
                    self.last_import = None;
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
                let (_ast, report) = mathslot_latex::convert_latex_with_report(&latex);
                let blocked = report.has_errors();
                let diag_snapshots: Vec<DiagnosticSnapshot> = report
                    .diagnostics
                    .iter()
                    .map(|diag| DiagnosticSnapshot::from_syntax_diagnostic(diag, &latex))
                    .collect();
                let import_snapshot = ImportReportSnapshot {
                    lossless: report.lossless,
                    empty_slots: report.empty_slots,
                    raw_nodes: report.raw_nodes,
                    roundtrip_latex: report.roundtrip_latex.clone(),
                    normalized_match: report.normalized_match,
                    blocked,
                    diagnostics: diag_snapshots.clone(),
                };
                self.last_import = Some(import_snapshot);

                if blocked {
                    let first_summary = diag_snapshots
                        .first()
                        .map(|d| d.summary.clone())
                        .unwrap_or_else(|| {
                            "LaTeX 导入存在语法错误，已阻断覆盖当前文档".to_string()
                        });
                    status_effects.push(Effect::Status(StatusMessage {
                        severity: StatusSeverity::Error,
                        message: first_summary,
                    }));
                } else {
                    match self.editor.import_latex(&latex) {
                        Ok(_) => {
                            if report.lossless {
                                status_effects.push(Effect::Status(StatusMessage {
                                    severity: StatusSeverity::Info,
                                    message: "LaTeX 已无损导入".to_string(),
                                }));
                            } else {
                                status_effects.push(Effect::Status(StatusMessage {
                                    severity: StatusSeverity::Warning,
                                    message: format!(
                                        "LaTeX 已导入（含 {} 个未识别或原始节点）",
                                        report.raw_nodes
                                    ),
                                }));
                            }
                        }
                        Err(err) => {
                            status_effects.push(Effect::Status(StatusMessage {
                                severity: StatusSeverity::Error,
                                message: format!("Import error: {err}"),
                            }));
                        }
                    }
                    emit_render = true;
                    emit_focus = true;
                }
            }
            AppCommand::AcknowledgeImport => {
                self.last_import = None;
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
                if strict {
                    match self.editor.export_latex_strict() {
                        Ok(latex) => {
                            let formatted = self.settings.delimiter_style.format_latex(&latex);
                            if copy_to_clipboard {
                                host_effects.push(Effect::Clipboard(formatted.clone()));
                            }
                            host_effects.push(Effect::ExportResult(Ok((formatted, Vec::new()))));
                        }
                        Err(diags) => {
                            host_effects.push(Effect::ExportResult(Err(
                                AppError::StrictExportBlocked(diags),
                            )));
                        }
                    }
                } else {
                    if copy_to_clipboard {
                        let formatted_copy = self
                            .settings
                            .delimiter_style
                            .format_latex(&self.editor.copy_text());
                        host_effects.push(Effect::Clipboard(formatted_copy));
                    }
                    let (latex, diags) = self.editor.export_latex_with_diagnostics();
                    let formatted = self.settings.delimiter_style.format_latex(&latex);
                    host_effects.push(Effect::ExportResult(Ok((formatted, diags))));
                }
            }
            AppCommand::UpdateSettings(settings) => {
                self.settings = settings.clone();
                status_effects.push(Effect::Status(StatusMessage {
                    severity: StatusSeverity::Info,
                    message: "设置已保存".to_string(),
                }));
                host_effects.push(Effect::Host(HostAction::PersistSettings(Box::new(
                    settings,
                ))));
            }
            AppCommand::ResetSettingsConfirmed => {
                let preserved_path = self.settings.config_path.clone();
                self.settings = AppSettings {
                    config_path: preserved_path,
                    ..AppSettings::default()
                };
                status_effects.push(Effect::Status(StatusMessage {
                    severity: StatusSeverity::Info,
                    message: "已恢复默认设置".to_string(),
                }));
                host_effects.push(Effect::Host(HostAction::PersistSettings(Box::new(
                    self.settings.clone(),
                ))));
            }
            AppCommand::SetRecoveryState(recovery) => {
                if let Some(rec) = &recovery {
                    status_effects.push(Effect::Status(StatusMessage {
                        severity: StatusSeverity::Warning,
                        message: format!("检测到损坏配置已隔离至 {}", rec.corrupt_path),
                    }));
                }
                self.recovery = recovery;
            }
            AppCommand::RequestRestoreBackup => {
                let backup_path = self
                    .recovery
                    .as_ref()
                    .and_then(|r| r.backup_candidate.clone());
                host_effects.push(Effect::Host(HostAction::RestoreBackup { backup_path }));
            }
            AppCommand::ConfirmResetEmptyConfig => {
                let preserved_path = self.settings.config_path.clone();
                self.recovery = None;
                self.settings = AppSettings {
                    config_path: preserved_path,
                    ..AppSettings::default()
                };
                status_effects.push(Effect::Status(StatusMessage {
                    severity: StatusSeverity::Info,
                    message: "已确认重置为空配置".to_string(),
                }));
                host_effects.push(Effect::Host(HostAction::ResetEmptyConfig));
            }
            AppCommand::RequestImportConfig => {
                host_effects.push(Effect::Host(HostAction::ImportConfig));
            }
            AppCommand::RequestExportConfig => {
                host_effects.push(Effect::Host(HostAction::ExportConfig));
            }
        }

        self.sync_state();

        // 1. Status effects: append any editor diagnostics with bounded single-line ErrorSummary
        if let Some(first_diag) = self.editor.diagnostics().first() {
            let source = self.editor.to_latex();
            let diag_snap = DiagnosticSnapshot::from_diagnostic_with_source(first_diag, &source);
            if first_diag.is_error() {
                status_effects.push(Effect::Status(StatusMessage {
                    severity: StatusSeverity::Error,
                    message: diag_snap.summary,
                }));
            } else if first_diag.is_pending() {
                status_effects.push(Effect::Status(StatusMessage {
                    severity: StatusSeverity::Info,
                    message: diag_snap.summary,
                }));
            }
        }

        let mut effects = status_effects;

        // 2. Render effect
        if emit_render {
            self.render_seq += 1;
            effects.push(Effect::Render(RenderRequest {
                request_id: self.render_seq,
                generation: self.render_seq,
                latex: self.editor.to_latex(),
                preview_latex: self.editor.to_preview_latex_mathjax(),
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
        self.settings
            .delimiter_style
            .format_latex(&self.editor.export_latex())
    }

    #[must_use]
    pub fn copy_text(&self) -> String {
        self.settings
            .delimiter_style
            .format_latex(&self.editor.copy_text())
    }

    #[must_use]
    pub fn settings(&self) -> &AppSettings {
        &self.settings
    }

    #[must_use]
    pub fn recovery(&self) -> Option<&RecoveryStateSnapshot> {
        self.recovery.as_ref()
    }

    #[must_use]
    pub fn last_import(&self) -> Option<&ImportReportSnapshot> {
        self.last_import.as_ref()
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

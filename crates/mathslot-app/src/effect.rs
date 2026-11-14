use mathslot_doc::EditorDiagnostic as Diagnostic;
use serde::{Deserialize, Serialize};

use crate::app::AppError;
use crate::snapshot::AppSettings;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum HostAction {
    PersistSettings(Box<AppSettings>),
    RestoreBackup { backup_path: Option<String> },
    ResetEmptyConfig,
    ImportConfig,
    ExportConfig,
    SaveSnippet { source: String, latex: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Effect {
    Render(RenderRequest),
    Clipboard(String),
    Status(StatusMessage),
    Focus(FocusTarget),
    ExportResult(Result<(String, Vec<Diagnostic>), AppError>),
    Host(HostAction),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderRequest {
    pub request_id: u64,
    pub generation: u64,
    pub latex: String,
    pub preview_latex: String,
    pub has_diagnostics: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusMessage {
    pub severity: StatusSeverity,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StatusSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FocusTarget {
    Slot(mathslot_syntax::SlotId),
    End,
}

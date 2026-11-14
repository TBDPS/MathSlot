#![forbid(unsafe_code)]

pub mod app;
pub mod command;
pub mod effect;
pub mod event;
pub mod snapshot;
pub mod state;

pub use app::App;
pub use command::AppCommand;
pub use effect::{Effect, FocusTarget, RenderRequest, StatusMessage, StatusSeverity};
pub use event::{AppEvent, EditorAction, Key, NavAction};
pub use snapshot::{
    CommandSpan, DiagnosticSnapshot, DispatchResponse, EngineSnapshot, ImportReportSnapshot,
    SlotSnapshot,
};
pub use state::EditorState;

pub use app::AppError;
pub use mathslot_doc::EditorDiagnostic as Diagnostic;
pub use mathslot_doc::{History, Intent, Selection};

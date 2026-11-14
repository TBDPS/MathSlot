use crate::event::NavAction;
use crate::snapshot::{AppSettings, RecoveryStateSnapshot};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppCommand {
    Noop,
    TypeChar(char),
    InsertLiteral(String),
    InsertNewline,
    DeleteBackward,
    DeleteForward,
    ApplyPaletteCard {
        command_id: String,
    },
    MoveCursor(NavAction),
    UpdateImeBuffer(String),
    CommitIme(String),
    EnterNav,
    ExitNav,
    SelectSlot(u32),
    PerformUndo,
    PerformRedo,
    ExecuteExport {
        strict: bool,
        copy_to_clipboard: bool,
    },
    ResetDocument,
    ImportLatex(String),
    AcknowledgeImport,
    LoadStreamSource(String),
    UpdateSettings(AppSettings),
    ResetSettingsConfirmed,
    SetRecoveryState(Option<RecoveryStateSnapshot>),
    RequestRestoreBackup,
    ConfirmResetEmptyConfig,
    RequestImportConfig,
    RequestExportConfig,
    SaveSnippet,
}

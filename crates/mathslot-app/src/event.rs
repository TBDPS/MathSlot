use serde::{Deserialize, Serialize};

use crate::snapshot::{AppSettings, RecoveryStateSnapshot};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppEvent {
    KeyInput(char),
    KeyDown(Key),
    Key(char),
    Action(EditorAction),
    Paste(String),
    PasteText(String),
    PaletteCard(String),
    ApplyCard(String),
    Undo,
    Redo,
    RequestExport {
        strict: bool,
    },
    RequestCopy,
    ExportRequested {
        strict: bool,
        copy_to_clipboard: bool,
    },
    ImeCompositionUpdate(String),
    ImeCompositionCommit(String),
    ImeComposition(String),
    ImeCommit(String),
    EnterNavMode,
    ExitNavMode,
    Navigate(NavAction),
    SelectSlot(u32),
    Clear,
    ImportLatex(String),
    ImportAcknowledge,
    LoadStreamSource(String),
    UpdateSettings(AppSettings),
    ResetSettingsConfirmed,
    SetRecoveryState(Option<RecoveryStateSnapshot>),
    RequestRestoreBackup,
    ConfirmResetEmptyConfig,
    RequestImportConfig,
    RequestExportConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Key {
    Backspace,
    Delete,
    Tab,
    Escape,
    Enter,
    ArrowLeft,
    ArrowRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EditorAction {
    Backspace,
    Delete,
    TabNext,
    TabPrev,
    Escape,
    Enter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NavAction {
    EnterNav,
    ExitNav,
    NextSlot,
    PrevSlot,
    StepLeft,
    StepRight,
}

use crate::event::NavAction;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppCommand {
    Noop,
    TypeChar(char),
    InsertLiteral(String),
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
    LoadStreamSource(String),
}

use serde::{Deserialize, Serialize};

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
    Clear,
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

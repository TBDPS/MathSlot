#![forbid(unsafe_code)]

pub mod cursor;
pub mod document;
pub mod editor;
pub mod path;
pub mod slot;
pub mod transaction;
pub mod undo;

pub use cursor::Cursor;
pub use document::Document;
pub use editor::Editor;
pub use path::AstPath;
pub use slot::{Slot, SlotRole, SlotTable};
pub use transaction::{DocError, Edit, Transaction};
pub use undo::UndoStack;

use mathslot_doc::{Cursor, DocError, Document, Edit, Editor, Transaction};
use mathslot_latex::{ImportReport, convert_latex_with_report};

/// 高层统一交互会话管理器，作为 WASM 桥接层与桌面 UI 的单一领域入口
#[derive(Debug, Clone)]
pub struct Session {
    editor: Editor,
    last_report: Option<ImportReport>,
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

impl Session {
    pub fn new() -> Self {
        Self {
            editor: Editor::new(Document::new()),
            last_report: None,
        }
    }

    pub fn from_latex(latex: &str) -> (Self, ImportReport) {
        let (ast, report) = convert_latex_with_report(latex);
        let doc = Document::from_nodes(ast);
        let editor = Editor::new(doc);
        let session = Self {
            editor,
            last_report: Some(report.clone()),
        };
        (session, report)
    }

    pub fn load_latex(&mut self, latex: &str) -> ImportReport {
        let (ast, report) = convert_latex_with_report(latex);
        let doc = Document::from_nodes(ast);
        self.editor = Editor::new(doc);
        self.last_report = Some(report.clone());
        report
    }

    pub fn to_latex(&self) -> String {
        self.editor.doc().to_latex()
    }

    pub fn doc(&self) -> &Document {
        self.editor.doc()
    }

    pub fn doc_mut(&mut self) -> &mut Document {
        self.editor.doc_mut()
    }

    pub fn cursor(&self) -> &Cursor {
        self.editor.cursor()
    }

    pub fn set_cursor(&mut self, cursor: Cursor) {
        self.editor.set_cursor(cursor);
    }

    pub fn apply_edit(&mut self, edit: Edit, label: &str) -> Result<Transaction, DocError> {
        self.editor.apply(edit, label)
    }

    pub fn undo(&mut self) -> bool {
        self.editor.undo()
    }

    pub fn redo(&mut self) -> bool {
        self.editor.redo()
    }

    pub fn tab_next_slot(&mut self) -> bool {
        self.editor.tab_next_slot()
    }

    pub fn tab_prev_slot(&mut self) -> bool {
        self.editor.tab_prev_slot()
    }

    pub fn insert_text(&mut self, s: &str) -> Result<(), DocError> {
        self.editor.insert_text(s)
    }

    pub fn delete_backward(&mut self) -> Result<(), DocError> {
        self.editor.delete_backward()
    }

    pub fn last_report(&self) -> Option<&ImportReport> {
        self.last_report.as_ref()
    }

    pub fn editor(&self) -> &Editor {
        &self.editor
    }

    pub fn editor_mut(&mut self) -> &mut Editor {
        &mut self.editor
    }
}

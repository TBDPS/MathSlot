#![forbid(unsafe_code)]

//! MathSlot 核心领域门面 Crate (mathslot-core)
//!
//! 提供统一的 Session 门面管理器，聚合 syntax, doc, latex 等基础设施，
//! 为后续 Phase 4 (2D 空间导航)、Phase 5 (WASM 桥接) 与 Phase 6 (Desktop egui) 提供统一入口。

pub mod session;

pub use session::Session;

pub use mathslot_syntax::{
    BigOpKind, Delim, Diagnostic, Expr, Lexer, MathStyle, MatrixEnv, Parser, Printer, SlotId, Span,
    Spanned, SymbolKind, SyntaxErrorKind, Token, parse, to_latex, to_source,
};

pub use mathslot_doc::{
    AstPath, Cursor, DocError, Document, Edit, Editor, Slot, SlotRole, SlotTable, Transaction,
    UndoStack,
};

pub use mathslot_latex::{
    EnvironmentShape, ImportReport, convert_latex_with_report, exprs_structurally_equal,
    inspect_environment, is_supported_environment, normalize_latex_string, verify_roundtrip,
};

/// 快速将 LaTeX 或简码输入转为标准规范 LaTeX 字符串
pub fn format_latex(input: &str) -> (String, Vec<Diagnostic>) {
    let (ast, diagnostics) = parse(input);
    let latex = to_latex(&ast);
    (latex, diagnostics)
}

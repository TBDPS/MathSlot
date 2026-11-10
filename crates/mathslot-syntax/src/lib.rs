#![forbid(unsafe_code)]

pub mod ast;
pub mod diagnostics;
pub mod lexer;
pub mod parser;
pub mod printer;
pub mod span;
pub mod token;

pub use ast::{BigOpKind, Delim, Expr, MathStyle, MatrixEnv, SlotId, SymbolKind};
pub use diagnostics::{Diagnostic, SyntaxErrorKind};
pub use lexer::Lexer;
pub use parser::Parser;
pub use printer::Printer;
pub use span::{Span, Spanned};
pub use token::Token;

/// 解析输入文本为 AST 表达式列表和语法诊断报告
pub fn parse(source: &str) -> (Vec<Spanned<Expr>>, Vec<Diagnostic>) {
    Parser::parse(source)
}

/// 将 AST 表达式列表导出为标准 LaTeX 字符串
pub fn to_latex(exprs: &[Spanned<Expr>]) -> String {
    Printer::to_canonical_latex(exprs)
}

/// 将 AST 表达式列表导出为 MathSlot 简码流
pub fn to_source(exprs: &[Spanned<Expr>]) -> String {
    Printer::to_mathslot_source(exprs)
}

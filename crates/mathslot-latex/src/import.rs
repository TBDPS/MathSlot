use crate::report::ImportReport;
use mathslot_syntax::{Expr, Spanned, parse, to_latex};

/// 递归遍历 AST 表达式节点
pub fn walk_ast<F>(nodes: &[Spanned<Expr>], visitor: &mut F)
where
    F: FnMut(&Expr),
{
    for node in nodes {
        visitor(&node.node);
        match &node.node {
            Expr::Group(items) => walk_ast(items, visitor),
            Expr::Script { base, sub, sup } => {
                walk_ast(std::slice::from_ref(base.as_ref()), visitor);
                if let Some(s) = sub {
                    walk_ast(std::slice::from_ref(s.as_ref()), visitor);
                }
                if let Some(s) = sup {
                    walk_ast(std::slice::from_ref(s.as_ref()), visitor);
                }
            }
            Expr::Delimited { body, .. } | Expr::Style { body, .. } => walk_ast(body, visitor),
            Expr::Fraction { num, den } => {
                walk_ast(num, visitor);
                walk_ast(den, visitor);
            }
            Expr::Root { index, radicand } => {
                if let Some(idx) = index {
                    walk_ast(idx, visitor);
                }
                walk_ast(radicand, visitor);
            }
            Expr::BigOperator {
                lower, upper, body, ..
            } => {
                if let Some(low) = lower {
                    walk_ast(low, visitor);
                }
                if let Some(up) = upper {
                    walk_ast(up, visitor);
                }
                walk_ast(body, visitor);
            }
            Expr::Matrix { rows, .. } => {
                for row in rows {
                    for cell in row {
                        walk_ast(cell, visitor);
                    }
                }
            }
            Expr::Placeholder { .. }
            | Expr::Text(_)
            | Expr::Symbol(_)
            | Expr::RawLatex { .. }
            | Expr::Error { .. } => {}
        }
    }
}

/// 归一化 LaTeX 字符串，消除无关的连续空白或定界符周边冗余间距
pub fn normalize_latex_string(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_char: Option<char> = None;

    for c in input.chars() {
        if c.is_whitespace() {
            // 避免连续空白，且若前置字符为 {, }, ^, _, &, \\ 则不推入空格
            if let Some(p) = prev_char
                && !p.is_whitespace()
                && p != '{'
                && p != '}'
                && p != '^'
                && p != '_'
                && p != '&'
            {
                out.push(' ');
                prev_char = Some(' ');
            }
        } else {
            // 若当前字符为 {, }, ^, _, & 且前置字符为空格，弹出前置空格
            if (c == '{' || c == '}' || c == '^' || c == '_' || c == '&') && prev_char == Some(' ')
            {
                out.pop();
            }
            out.push(c);
            prev_char = Some(c);
        }
    }

    // 去除头尾空格
    out.trim().to_string()
}

/// 核心 LaTeX 导入管线：调用 syntax 基础设施解析，计算无损度与差异指标并生成 ImportReport
pub fn convert_latex_with_report(input: &str) -> (Vec<Spanned<Expr>>, ImportReport) {
    let (ast, diagnostics) = parse(input);

    let mut empty_slots = 0;
    let mut raw_nodes = 0;

    walk_ast(&ast, &mut |expr| match expr {
        Expr::Placeholder { .. } => empty_slots += 1,
        Expr::RawLatex { .. } | Expr::Error { .. } => raw_nodes += 1,
        Expr::Fraction { num, den } => {
            if num.is_empty() {
                empty_slots += 1;
            }
            if den.is_empty() {
                empty_slots += 1;
            }
        }
        Expr::Root { radicand, .. } if radicand.is_empty() => {
            empty_slots += 1;
        }
        _ => {}
    });

    let roundtrip_latex = to_latex(&ast);

    let norm_in = normalize_latex_string(input);
    let norm_out = normalize_latex_string(&roundtrip_latex);
    let normalized_match = norm_in == norm_out;

    let has_fatal = diagnostics.iter().any(|d| d.is_error());
    let lossless = (raw_nodes == 0) && !has_fatal;

    let report = ImportReport {
        lossless,
        diagnostics,
        empty_slots,
        raw_nodes,
        roundtrip_latex,
        normalized_match,
    };

    (ast, report)
}

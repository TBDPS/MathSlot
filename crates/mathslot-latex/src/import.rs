use crate::report::ImportReport;
use mathslot_syntax::{Diagnostic, Expr, Span, Spanned, SyntaxErrorKind, parse, to_latex};

/// 外层数学定界符剥离结果 (D-142)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OuterDelimiterStrip<'a> {
    pub inner: &'a str,
    pub stripped_pair: Option<(&'static str, &'static str)>,
    pub diagnostic: Option<Diagnostic>,
}

fn backslashes_before(s: &str, byte_idx: usize) -> usize {
    s[..byte_idx]
        .chars()
        .rev()
        .take_while(|&c| c == '\\')
        .count()
}

fn contains_unescaped_dollar(s: &str) -> bool {
    for (idx, _) in s.match_indices('$') {
        if backslashes_before(s, idx).is_multiple_of(2) {
            return true;
        }
    }
    false
}

/// 剥离单层外层数学定界符（`$$...$$`, `\[...\]`, `\(...\)`, `$...$`）。
/// 成对存在时返回 `Info` 诊断；仅存在单侧未闭合/多余定界符时返回 `Error` 诊断阻断导入。
pub fn strip_outer_math_delimiters(input: &str) -> OuterDelimiterStrip<'_> {
    let trimmed = input.trim();
    let base_offset = input.find(trimmed).unwrap_or(0);
    let full_span = Span::new(base_offset, base_offset + trimmed.len());

    if trimmed.is_empty() {
        return OuterDelimiterStrip {
            inner: trimmed,
            stripped_pair: None,
            diagnostic: None,
        };
    }

    let ends_unescaped_double_dollar = trimmed.len() >= 4
        && trimmed.ends_with("$$")
        && backslashes_before(trimmed, trimmed.len() - 2).is_multiple_of(2);

    if trimmed.starts_with("$$") {
        if ends_unescaped_double_dollar {
            let inner = trimmed[2..trimmed.len() - 2].trim();
            if !contains_unescaped_dollar(inner) {
                return OuterDelimiterStrip {
                    inner,
                    stripped_pair: Some(("$$", "$$")),
                    diagnostic: Some(Diagnostic::info(
                        SyntaxErrorKind::OuterDelimitersStripped {
                            open: "$$".to_string(),
                            close: "$$".to_string(),
                        },
                        full_span,
                    )),
                };
            }
        } else {
            return OuterDelimiterStrip {
                inner: trimmed,
                stripped_pair: None,
                diagnostic: Some(Diagnostic::unclosed_delimiter(
                    "$$",
                    Span::new(base_offset, base_offset + 2),
                )),
            };
        }
    } else if trimmed.len() >= 2
        && trimmed.ends_with("$$")
        && backslashes_before(trimmed, trimmed.len() - 2).is_multiple_of(2)
    {
        return OuterDelimiterStrip {
            inner: trimmed,
            stripped_pair: None,
            diagnostic: Some(Diagnostic::unmatched_delimiter(
                "$$",
                Span::new(base_offset + trimmed.len() - 2, base_offset + trimmed.len()),
            )),
        };
    }

    let ends_unescaped_bracket_math = trimmed.len() >= 4
        && trimmed.ends_with(r"\]")
        && backslashes_before(trimmed, trimmed.len() - 2).is_multiple_of(2);
    if trimmed.starts_with(r"\[") {
        if ends_unescaped_bracket_math {
            let inner = trimmed[2..trimmed.len() - 2].trim();
            return OuterDelimiterStrip {
                inner,
                stripped_pair: Some((r"\[", r"\]")),
                diagnostic: Some(Diagnostic::info(
                    SyntaxErrorKind::OuterDelimitersStripped {
                        open: r"\[".to_string(),
                        close: r"\]".to_string(),
                    },
                    full_span,
                )),
            };
        }
        return OuterDelimiterStrip {
            inner: trimmed,
            stripped_pair: None,
            diagnostic: Some(Diagnostic::unclosed_delimiter(
                r"\]",
                Span::new(base_offset, base_offset + 2),
            )),
        };
    } else if trimmed.len() >= 2
        && trimmed.ends_with(r"\]")
        && backslashes_before(trimmed, trimmed.len() - 2).is_multiple_of(2)
    {
        return OuterDelimiterStrip {
            inner: trimmed,
            stripped_pair: None,
            diagnostic: Some(Diagnostic::unmatched_delimiter(
                r"\]",
                Span::new(base_offset + trimmed.len() - 2, base_offset + trimmed.len()),
            )),
        };
    }

    let ends_unescaped_paren_math = trimmed.len() >= 4
        && trimmed.ends_with(r"\)")
        && backslashes_before(trimmed, trimmed.len() - 2).is_multiple_of(2);
    if trimmed.starts_with(r"\(") {
        if ends_unescaped_paren_math {
            let inner = trimmed[2..trimmed.len() - 2].trim();
            return OuterDelimiterStrip {
                inner,
                stripped_pair: Some((r"\(", r"\)")),
                diagnostic: Some(Diagnostic::info(
                    SyntaxErrorKind::OuterDelimitersStripped {
                        open: r"\(".to_string(),
                        close: r"\)".to_string(),
                    },
                    full_span,
                )),
            };
        }
        return OuterDelimiterStrip {
            inner: trimmed,
            stripped_pair: None,
            diagnostic: Some(Diagnostic::unclosed_delimiter(
                r"\)",
                Span::new(base_offset, base_offset + 2),
            )),
        };
    } else if trimmed.len() >= 2
        && trimmed.ends_with(r"\)")
        && backslashes_before(trimmed, trimmed.len() - 2).is_multiple_of(2)
    {
        return OuterDelimiterStrip {
            inner: trimmed,
            stripped_pair: None,
            diagnostic: Some(Diagnostic::unmatched_delimiter(
                r"\)",
                Span::new(base_offset + trimmed.len() - 2, base_offset + trimmed.len()),
            )),
        };
    }

    let ends_unescaped_single_dollar = trimmed.len() >= 2
        && trimmed.ends_with('$')
        && !trimmed.ends_with("$$")
        && backslashes_before(trimmed, trimmed.len() - 1).is_multiple_of(2);

    if trimmed.starts_with('$') && !trimmed.starts_with("$$") {
        if ends_unescaped_single_dollar {
            let inner = trimmed[1..trimmed.len() - 1].trim();
            if !contains_unescaped_dollar(inner) {
                return OuterDelimiterStrip {
                    inner,
                    stripped_pair: Some(("$", "$")),
                    diagnostic: Some(Diagnostic::info(
                        SyntaxErrorKind::OuterDelimitersStripped {
                            open: "$".to_string(),
                            close: "$".to_string(),
                        },
                        full_span,
                    )),
                };
            }
        } else {
            return OuterDelimiterStrip {
                inner: trimmed,
                stripped_pair: None,
                diagnostic: Some(Diagnostic::unclosed_delimiter(
                    "$",
                    Span::new(base_offset, base_offset + 1),
                )),
            };
        }
    } else if trimmed.ends_with('$')
        && backslashes_before(trimmed, trimmed.len() - 1).is_multiple_of(2)
    {
        return OuterDelimiterStrip {
            inner: trimmed,
            stripped_pair: None,
            diagnostic: Some(Diagnostic::unmatched_delimiter(
                "$",
                Span::new(base_offset + trimmed.len() - 1, base_offset + trimmed.len()),
            )),
        };
    }

    OuterDelimiterStrip {
        inner: trimmed,
        stripped_pair: None,
        diagnostic: None,
    }
}

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

/// 核心 LaTeX 导入管线：剥离外层定界符后调用 syntax 基础设施解析，计算无损度与差异指标并生成 ImportReport
pub fn convert_latex_with_report(input: &str) -> (Vec<Spanned<Expr>>, ImportReport) {
    let stripped = strip_outer_math_delimiters(input);
    let mut diagnostics = Vec::new();
    let parse_input = stripped.inner;

    let (ast, parse_diags) = parse(parse_input);
    if let Some(diag) = stripped.diagnostic {
        diagnostics.push(diag);
    }
    diagnostics.extend(parse_diags);

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

    let norm_in = normalize_latex_string(parse_input);
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

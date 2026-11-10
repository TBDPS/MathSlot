use crate::ast::{Delim, Expr};
use crate::span::Spanned;

/// AST 格式化器：支持标准规范 LaTeX 导出与 MathSlot 简码源导出
pub struct Printer;

impl Printer {
    /// 将 AST 表达式序列转换为标准规范的 LaTeX 代码
    pub fn to_canonical_latex(exprs: &[Spanned<Expr>]) -> String {
        let mut out = String::new();
        for (i, expr) in exprs.iter().enumerate() {
            let s = Self::expr_to_canonical_latex(&expr.node);
            // 避免反斜杠宏命令与紧随的字母标识符无空格粘连
            if i > 0 {
                let prev = &exprs[i - 1].node;
                if Self::ends_with_macro_name(prev) && Self::starts_with_letter(&expr.node) {
                    out.push(' ');
                }
            }
            out.push_str(&s);
        }
        out
    }

    /// 将单个 AST 节点格式化为标准 LaTeX 代码
    pub fn expr_to_canonical_latex(expr: &Expr) -> String {
        match expr {
            Expr::Text(s) => s.clone(),

            Expr::Symbol(sym) => sym.latex_str().to_string(),

            Expr::Group(items) => {
                let inner = Self::to_canonical_latex(items);
                format!("{{{inner}}}")
            }

            Expr::Script { base, sub, sup } => {
                let mut out = Self::expr_to_canonical_latex(&base.node);

                if let Some(sub_expr) = sub {
                    let sub_str = match &sub_expr.node {
                        Expr::Group(items) => Self::to_canonical_latex(items),
                        other => Self::expr_to_canonical_latex(other),
                    };
                    out.push_str(&format!("_{{{sub_str}}}"));
                }

                if let Some(sup_expr) = sup {
                    let sup_str = match &sup_expr.node {
                        Expr::Group(items) => Self::to_canonical_latex(items),
                        other => Self::expr_to_canonical_latex(other),
                    };
                    out.push_str(&format!("^{{{sup_str}}}"));
                }

                out
            }

            Expr::Style { style, body } => {
                let inner = Self::to_canonical_latex(body);
                format!("{}{{{inner}}}", style.latex_cmd())
            }

            Expr::Delimited {
                open,
                close,
                body,
                auto_scale,
            } => {
                let body_str = Self::to_canonical_latex(body);
                let open_str = open.open_latex();
                let close_str = close.close_latex();
                if *auto_scale {
                    format!(r"\left{open_str} {body_str} \right{close_str}")
                } else {
                    format!("{open_str}{body_str}{close_str}")
                }
            }

            Expr::Fraction { num, den } => {
                let num_str = Self::to_canonical_latex(num);
                let den_str = Self::to_canonical_latex(den);
                format!(r"\frac{{{num_str}}}{{{den_str}}}")
            }

            Expr::Root { index, radicand } => {
                let rad_str = Self::to_canonical_latex(radicand);
                if let Some(idx) = index {
                    let idx_str = Self::to_canonical_latex(idx);
                    format!(r"\sqrt[{idx_str}]{{{rad_str}}}")
                } else {
                    format!(r"\sqrt{{{rad_str}}}")
                }
            }

            Expr::BigOperator {
                kind,
                lower,
                upper,
                body,
            } => {
                let mut out = kind.latex_cmd().to_string();

                if let Some(low) = lower {
                    let low_str = Self::to_canonical_latex(low);
                    out.push_str(&format!("_{{{low_str}}}"));
                }

                if let Some(up) = upper {
                    let up_str = Self::to_canonical_latex(up);
                    out.push_str(&format!("^{{{up_str}}}"));
                }

                if !body.is_empty() {
                    let body_str = Self::to_canonical_latex(body);
                    out.push(' ');
                    out.push_str(&body_str);
                }

                out
            }

            Expr::Matrix { env, rows } => {
                let env_name = env.latex_name();
                let mut out = format!(r"\begin{{{env_name}}} ");

                let row_strs: Vec<String> = rows
                    .iter()
                    .map(|row| {
                        let cell_strs: Vec<String> = row
                            .iter()
                            .map(|cell| Self::to_canonical_latex(cell))
                            .collect();
                        cell_strs.join(" & ")
                    })
                    .collect();

                out.push_str(&row_strs.join(r" \\ "));
                out.push_str(&format!(r" \end{{{env_name}}}"));
                out
            }

            Expr::Placeholder { .. } => "{}".to_string(),

            Expr::RawLatex { latex, .. } => latex.clone(),

            Expr::Error { raw, .. } => raw.clone(),
        }
    }

    /// 将 AST 表达式序列序列化为 MathSlot 简码流
    pub fn to_mathslot_source(exprs: &[Spanned<Expr>]) -> String {
        let mut out = String::new();
        for expr in exprs {
            out.push_str(&Self::expr_to_mathslot_source(&expr.node));
        }
        out
    }

    /// 单个 AST 节点的 MathSlot 简码导出
    pub fn expr_to_mathslot_source(expr: &Expr) -> String {
        match expr {
            Expr::Text(s) => s.clone(),
            Expr::Symbol(sym) => sym.latex_str().to_string(),
            Expr::Group(items) => {
                let inner = Self::to_mathslot_source(items);
                format!("{{{inner}}}")
            }
            Expr::Script { base, sub, sup } => {
                let mut out = Self::expr_to_mathslot_source(&base.node);
                if let Some(sub_expr) = sub {
                    out.push('_');
                    out.push_str(&Self::expr_to_mathslot_source(&sub_expr.node));
                }
                if let Some(sup_expr) = sup {
                    out.push('^');
                    out.push_str(&Self::expr_to_mathslot_source(&sup_expr.node));
                }
                out
            }
            Expr::Style { style, body } => {
                let inner = Self::to_mathslot_source(body);
                format!("{}{{{inner}}}", style.latex_cmd())
            }
            Expr::Delimited {
                open,
                close,
                body,
                auto_scale: _,
            } => {
                let body_str = Self::to_mathslot_source(body);
                match (open, close) {
                    (Delim::Paren, Delim::Paren) => format!("({body_str})"),
                    (Delim::Bracket, Delim::Bracket) => format!("[{body_str}]"),
                    _ => format!(
                        r"\left{} {} \right{}",
                        open.open_latex(),
                        body_str,
                        close.close_latex()
                    ),
                }
            }
            Expr::Fraction { num, den } => {
                let num_str = Self::to_mathslot_source(num);
                let den_str = Self::to_mathslot_source(den);
                format!("▸f{num_str};{den_str};")
            }
            Expr::Root { index: _, radicand } => {
                let rad_str = Self::to_mathslot_source(radicand);
                format!("▸r{rad_str};")
            }
            Expr::BigOperator {
                kind,
                lower,
                upper,
                body,
            } => {
                let lo = lower
                    .as_ref()
                    .map(|l| Self::to_mathslot_source(l))
                    .unwrap_or_default();
                let up = upper
                    .as_ref()
                    .map(|u| Self::to_mathslot_source(u))
                    .unwrap_or_default();
                let bd = Self::to_mathslot_source(body);
                let cmd_prefix = match kind {
                    crate::ast::BigOpKind::Sum => "▸s",
                    crate::ast::BigOpKind::Integral => "▸i",
                    crate::ast::BigOpKind::Limit => "▸l",
                    _ => return Self::expr_to_canonical_latex(expr),
                };
                format!("{cmd_prefix}{lo};{up};{bd};")
            }
            Expr::Matrix { env: _, rows } => {
                let row_strs: Vec<String> = rows
                    .iter()
                    .map(|row| {
                        let cell_strs: Vec<String> = row
                            .iter()
                            .map(|cell| Self::to_mathslot_source(cell))
                            .collect();
                        cell_strs.join(";")
                    })
                    .collect();
                format!("▸m{};", row_strs.join(";"))
            }
            Expr::Placeholder { .. } => ";".to_string(),
            Expr::RawLatex { latex, .. } => latex.clone(),
            Expr::Error { raw, .. } => raw.clone(),
        }
    }

    fn ends_with_macro_name(expr: &Expr) -> bool {
        match expr {
            Expr::Symbol(sym) => sym.latex_str().starts_with('\\'),
            _ => false,
        }
    }

    fn starts_with_letter(expr: &Expr) -> bool {
        match expr {
            Expr::Text(s) => s.starts_with(|c: char| c.is_ascii_alphabetic()),
            _ => false,
        }
    }
}

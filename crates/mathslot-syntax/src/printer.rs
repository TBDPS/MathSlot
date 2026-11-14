use crate::ast::{Delim, Expr, SlotId};
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
            if i > 0 && Self::ends_with_control_word(&out) && Self::starts_with_ascii_letter(&s) {
                out.push(' ');
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
                    let sep = if Self::ends_with_control_word(open_str)
                        && Self::starts_with_ascii_letter(&body_str)
                    {
                        " "
                    } else {
                        ""
                    };
                    format!("{open_str}{sep}{body_str}{close_str}")
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

    pub fn ends_with_control_word(s: &str) -> bool {
        let trimmed_letters = s.trim_end_matches(|c: char| c.is_ascii_alphabetic());
        if trimmed_letters.len() == s.len() {
            return false;
        }
        let backslashes = trimmed_letters
            .chars()
            .rev()
            .take_while(|&c| c == '\\')
            .count();
        backslashes % 2 == 1
    }

    pub fn starts_with_ascii_letter(s: &str) -> bool {
        s.starts_with(|c: char| c.is_ascii_alphabetic())
    }

    pub fn join_latex_without_macro_gluing(left: &str, right: &str) -> String {
        if Self::ends_with_control_word(left) && Self::starts_with_ascii_letter(right) {
            format!("{left} {right}")
        } else {
            format!("{left}{right}")
        }
    }

    /// 只读生成 MathJax 3 视觉预览 LaTeX（`D-114`）：
    /// - 不改变 `to_canonical_latex` / `to_latex` 导出语义；
    /// - 空 `Placeholder` 渲染可见 `\bbox` + `\square`；
    /// - 活动槽位与错误/待决节点输出高亮 `\bbox` 边框。
    #[must_use]
    pub fn to_preview_latex_mathjax(
        exprs: &[Spanned<Expr>],
        active_slot: Option<SlotId>,
    ) -> String {
        Self::to_preview_latex_mathjax_at_path(exprs, active_slot, None)
    }

    /// 带可选 `AstPath` 的 MathJax 3 视觉预览生成器（供 `mathslot-doc` 高亮已填充活动槽位）
    #[must_use]
    pub fn to_preview_latex_mathjax_at_path(
        exprs: &[Spanned<Expr>],
        active_slot: Option<SlotId>,
        active_path: Option<&[usize]>,
    ) -> String {
        Self::join_preview_slice(exprs, active_slot, active_path, false)
    }

    fn preview_placeholder_box(is_active: bool) -> String {
        if is_active {
            r"\bbox[#dbeafe,3px,border:1.5px solid #2563eb]{{\color{#1d4ed8}\square}}".to_string()
        } else {
            r"\bbox[#fef2f2,3px,border:1.25px solid #ef4444]{{\color{#dc2626}\square}}".to_string()
        }
    }

    fn preview_active_scope_box(inner: &str) -> String {
        format!(r"\bbox[#eff6ff,3px,border:1.5px solid #2563eb]{{{inner}}}")
    }

    fn escape_mathjax_text(raw: &str) -> String {
        let mut out = String::with_capacity(raw.len());
        for ch in raw.chars() {
            match ch {
                '\\' => out.push_str(r"\textbackslash{}"),
                '{' => out.push_str(r"\{"),
                '}' => out.push_str(r"\}"),
                '$' => out.push_str(r"\$"),
                '%' => out.push_str(r"\%"),
                '#' => out.push_str(r"\#"),
                '&' => out.push_str(r"\&"),
                '_' => out.push_str(r"\_"),
                '^' => out.push_str(r"\^{}"),
                '~' => out.push_str(r"\~{}"),
                other => out.push(other),
            }
        }
        out
    }

    fn join_preview_slice(
        exprs: &[Spanned<Expr>],
        active_slot: Option<SlotId>,
        active_path: Option<&[usize]>,
        is_slot_container: bool,
    ) -> String {
        if exprs.is_empty() {
            if active_path == Some(&[]) {
                return Self::preview_placeholder_box(true);
            }
            if is_slot_container {
                return Self::preview_placeholder_box(false);
            }
            return String::new();
        }

        let single_placeholder = matches!(
            exprs,
            [Spanned {
                node: Expr::Placeholder { .. },
                ..
            }]
        );
        if active_path == Some(&[]) && !single_placeholder {
            let inner = Self::join_preview_slice(exprs, active_slot, None, false);
            return Self::preview_active_scope_box(&inner);
        }

        let mut out = String::new();
        for (i, expr) in exprs.iter().enumerate() {
            let child_path = match active_path {
                Some([head, tail @ ..]) if *head == i => Some(tail),
                Some([]) if single_placeholder => Some(&[][..]),
                _ => None,
            };
            let piece = Self::expr_to_preview_latex_mathjax(&expr.node, active_slot, child_path);
            if i > 0 && Self::ends_with_control_word(&out) && Self::starts_with_ascii_letter(&piece)
            {
                out.push(' ');
            }
            out.push_str(&piece);
        }
        out
    }

    fn preview_script_child(
        script_expr: &Expr,
        active_slot: Option<SlotId>,
        child_path: Option<&[usize]>,
    ) -> String {
        match script_expr {
            Expr::Group(items) => {
                if items.is_empty() {
                    Self::preview_placeholder_box(child_path == Some(&[]))
                } else {
                    Self::join_preview_slice(items, active_slot, child_path, true)
                }
            }
            Expr::Placeholder { slot_id, .. } => {
                let is_active = active_slot == Some(*slot_id) || child_path == Some(&[]);
                Self::preview_placeholder_box(is_active)
            }
            other => {
                let rendered = Self::expr_to_preview_latex_mathjax(other, active_slot, child_path);
                if child_path == Some(&[]) {
                    Self::preview_active_scope_box(&rendered)
                } else {
                    rendered
                }
            }
        }
    }

    fn expr_to_preview_latex_mathjax(
        expr: &Expr,
        active_slot: Option<SlotId>,
        active_path: Option<&[usize]>,
    ) -> String {
        let sub_branch = |branch: usize| -> Option<&[usize]> {
            match active_path {
                Some([head, tail @ ..]) if *head == branch => Some(tail),
                _ => None,
            }
        };

        match expr {
            Expr::Text(s) => s.clone(),
            Expr::Symbol(sym) => sym.latex_str().to_string(),
            Expr::Group(items) => {
                let inner = Self::join_preview_slice(items, active_slot, active_path, false);
                format!("{{{inner}}}")
            }
            Expr::Script { base, sub, sup } => {
                let mut out =
                    Self::expr_to_preview_latex_mathjax(&base.node, active_slot, sub_branch(0));
                if let Some(sub_expr) = sub {
                    let sub_str =
                        Self::preview_script_child(&sub_expr.node, active_slot, sub_branch(1));
                    out.push_str(&format!("_{{{sub_str}}}"));
                }
                if let Some(sup_expr) = sup {
                    let sup_str =
                        Self::preview_script_child(&sup_expr.node, active_slot, sub_branch(2));
                    out.push_str(&format!("^{{{sup_str}}}"));
                }
                out
            }
            Expr::Style { style, body } => {
                let inner = Self::join_preview_slice(body, active_slot, sub_branch(0), true);
                format!("{}{{{inner}}}", style.latex_cmd())
            }
            Expr::Delimited {
                open,
                close,
                body,
                auto_scale,
            } => {
                let body_str = Self::join_preview_slice(body, active_slot, sub_branch(0), true);
                let open_str = open.open_latex();
                let close_str = close.close_latex();
                if *auto_scale {
                    format!(r"\left{open_str} {body_str} \right{close_str}")
                } else {
                    let sep = if Self::ends_with_control_word(open_str)
                        && Self::starts_with_ascii_letter(&body_str)
                    {
                        " "
                    } else {
                        ""
                    };
                    format!("{open_str}{sep}{body_str}{close_str}")
                }
            }
            Expr::Fraction { num, den } => {
                let num_str = Self::join_preview_slice(num, active_slot, sub_branch(0), true);
                let den_str = Self::join_preview_slice(den, active_slot, sub_branch(1), true);
                format!(r"\frac{{{num_str}}}{{{den_str}}}")
            }
            Expr::Root { index, radicand } => {
                let rad_str = Self::join_preview_slice(radicand, active_slot, sub_branch(1), true);
                if let Some(idx) = index {
                    let idx_str = Self::join_preview_slice(idx, active_slot, sub_branch(0), true);
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
                    let low_str = Self::join_preview_slice(low, active_slot, sub_branch(0), true);
                    out.push_str(&format!("_{{{low_str}}}"));
                }
                if let Some(up) = upper {
                    let up_str = Self::join_preview_slice(up, active_slot, sub_branch(1), true);
                    out.push_str(&format!("^{{{up_str}}}"));
                }
                let body_path = sub_branch(2);
                if !body.is_empty() || body_path.is_some() {
                    let body_str = Self::join_preview_slice(body, active_slot, body_path, false);
                    if !body_str.is_empty() {
                        out.push(' ');
                        out.push_str(&body_str);
                    }
                }
                out
            }
            Expr::Matrix { env, rows } => {
                let env_name = env.latex_name();
                let mut out = format!(r"\begin{{{env_name}}} ");
                let row_strs: Vec<String> = rows
                    .iter()
                    .enumerate()
                    .map(|(r, row)| {
                        let cell_strs: Vec<String> = row
                            .iter()
                            .enumerate()
                            .map(|(c, cell)| {
                                let cell_path = match active_path {
                                    Some([row_idx, col_idx, rest @ ..])
                                        if *row_idx == r && *col_idx == c =>
                                    {
                                        Some(rest)
                                    }
                                    _ => None,
                                };
                                Self::join_preview_slice(cell, active_slot, cell_path, true)
                            })
                            .collect();
                        cell_strs.join(" & ")
                    })
                    .collect();
                out.push_str(&row_strs.join(r" \\ "));
                out.push_str(&format!(r" \end{{{env_name}}}"));
                out
            }
            Expr::Placeholder { slot_id, .. } => {
                let is_active = (active_slot.is_some() && active_slot == Some(*slot_id))
                    || active_path == Some(&[]);
                Self::preview_placeholder_box(is_active)
            }
            Expr::RawLatex { latex, .. } => latex.clone(),
            Expr::Error { raw, .. } => {
                let escaped = Self::escape_mathjax_text(raw);
                format!(
                    r"\bbox[#fef2f2,2px,border:1px solid #ef4444]{{{{\color{{#dc2626}}\text{{{escaped}}}}}}}"
                )
            }
        }
    }
}

use crate::ast::{Expr, MathSeq, ParsedDoc, SlotNode};
use crate::command::StructKind;

pub fn to_latex(doc: &ParsedDoc) -> String {
    render_seq(&doc.root).trim().to_owned()
}

fn render_seq(seq: &MathSeq) -> String {
    let mut out = String::new();
    for item in &seq.items {
        let piece = match item {
            Expr::Text { raw, .. } => text_to_latex(raw),
            Expr::Symbol { cmd, .. } => cmd.latex_macro().to_owned(),
            Expr::Struct { kind, slots, .. } => render_struct(*kind, slots),
            Expr::CustomStruct { format, slots, .. } => {
                let rendered: Vec<String> = slots.iter().map(render_slot).collect();
                format.render_latex(&rendered)
            }
            Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => String::new(),
        };
        if piece.is_empty() {
            continue;
        }
        if needs_latex_space(&out, &piece) {
            out.push(' ');
        }
        out.push_str(&piece);
    }
    out
}

fn render_slot(slot: &SlotNode) -> String {
    render_seq(&slot.seq).trim().to_owned()
}

fn render_struct(kind: StructKind, slots: &[SlotNode]) -> String {
    let s = |i: usize| render_slot(&slots[i]);
    match kind {
        StructKind::Frac => format!("\\frac{{{}}}{{{}}}", s(0), s(1)),
        StructKind::Sqrt => format!("\\sqrt{{{}}}", s(0)),
        StructKind::NthRoot => {
            let idx = s(0);
            if idx.is_empty() {
                format!("\\sqrt{{{}}}", s(1))
            } else {
                format!("\\sqrt[{idx}]{{{}}}", s(1))
            }
        }
        StructKind::Sup => format!("{{{}}}^{{{}}}", s(0), s(1)),
        StructKind::Sub => format!("{{{}}}_{{{}}}", s(0), s(1)),
        StructKind::SubSup => format!("{{{}}}_{{{}}}^{{{}}}", s(0), s(1), s(2)),
        StructKind::Paren => format!("\\left({}\\right)", s(0)),
        StructKind::Abs => format!("\\left|{}\\right|", s(0)),
        StructKind::Integral => big_operator("\\int", &s(0), &s(1), &s(2)),
        StructKind::IndefIntegral => {
            let body = s(0);
            if body.is_empty() {
                "\\int".to_owned()
            } else {
                format!("\\int {body}")
            }
        }
        StructKind::DoubleIntegral => sub_operator("\\iint", &s(0), &s(1)),
        StructKind::ContourIntegral => sub_operator("\\oint", &s(0), &s(1)),
        StructKind::Sum => big_operator("\\sum", &s(0), &s(1), &s(2)),
        StructKind::Product => big_operator("\\prod", &s(0), &s(1), &s(2)),
        StructKind::Limit => {
            let var = s(0);
            let target = s(1);
            let body = s(2);
            let cond = if var.is_empty() && target.is_empty() {
                String::new()
            } else if target.is_empty() && var.contains("\\to") {
                var
            } else {
                format!("{var} \\to {target}").trim().to_owned()
            };
            sub_operator("\\lim", &cond, &body)
        }
        StructKind::Matrix2 => matrix("pmatrix", slots, 2, 2),
        StructKind::Matrix3 => matrix("pmatrix", slots, 3, 3),
        StructKind::Det2 => matrix("vmatrix", slots, 2, 2),
        StructKind::Cases2 => {
            format!(
                "\\begin{{cases}} {} & {} \\\\ {} & {} \\end{{cases}}",
                s(0),
                s(1),
                s(2),
                s(3)
            )
        }
        StructKind::Hat => format!("\\hat{{{}}}", s(0)),
        StructKind::Bar => format!("\\bar{{{}}}", s(0)),
        StructKind::Vec => format!("\\vec{{{}}}", s(0)),
        StructKind::Tilde => format!("\\tilde{{{}}}", s(0)),
        StructKind::Dot => format!("\\dot{{{}}}", s(0)),
        StructKind::Norm => format!("\\left\\Vert {}\\right\\Vert", s(0)),
        StructKind::Overline => format!("\\overline{{{}}}", s(0)),
        StructKind::Binom => format!("\\binom{{{}}}{{{}}}", s(0), s(1)),
        StructKind::BMatrix2 => matrix("bmatrix", slots, 2, 2),
        StructKind::Cases3 => {
            format!(
                "\\begin{{cases}} {} & {} \\\\ {} & {} \\\\ {} & {} \\end{{cases}}",
                s(0),
                s(1),
                s(2),
                s(3),
                s(4),
                s(5)
            )
        }
    }
}

fn sub_operator(command: &str, sub: &str, body: &str) -> String {
    match (sub.is_empty(), body.is_empty()) {
        (true, true) => command.to_owned(),
        (true, false) => format!("{command} {body}"),
        (false, true) => format!("{command}_{{{sub}}}"),
        (false, false) => format!("{command}_{{{sub}}} {body}"),
    }
}

fn big_operator(command: &str, lower: &str, upper: &str, body: &str) -> String {
    let mut out = String::from(command);
    if !lower.is_empty() {
        out.push_str(&format!("_{{{lower}}}"));
    }
    if !upper.is_empty() {
        out.push_str(&format!("^{{{upper}}}"));
    }
    if !body.is_empty() {
        out.push(' ');
        out.push_str(body);
    }
    out
}

fn matrix(env: &str, slots: &[SlotNode], rows: usize, cols: usize) -> String {
    let mut out = format!("\\begin{{{env}}}");
    for r in 0..rows {
        if r > 0 {
            out.push_str(" \\\\ ");
        }
        for c in 0..cols {
            if c > 0 {
                out.push_str(" & ");
            }
            out.push_str(&render_slot(&slots[r * cols + c]));
        }
    }
    out.push_str(&format!("\\end{{{env}}}"));
    out
}

pub(crate) fn needs_latex_space(left: &str, right: &str) -> bool {
    let Some(lc) = left.chars().last() else {
        return false;
    };
    let Some(rc) = right.chars().next() else {
        return false;
    };
    if lc.is_whitespace() || rc.is_whitespace() {
        return false;
    }
    if ends_with_latex_macro_word(left) && rc.is_ascii_alphabetic() {
        return true;
    }
    if (lc == '}' || lc == ')') && (rc.is_ascii_alphabetic() || rc == '\\') {
        return true;
    }
    false
}

pub(crate) fn ends_with_latex_macro_word(s: &str) -> bool {
    let trimmed_alpha = s.trim_end_matches(|c: char| c.is_ascii_alphabetic());
    trimmed_alpha.len() < s.len() && trimmed_alpha.ends_with('\\')
}

pub fn text_to_latex(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    latex_range(&chars, 0, chars.len())
}

fn push_piece(out: &mut String, piece: &str, next_char: Option<char>) {
    out.push_str(piece);
    if ends_with_latex_macro_word(out) && next_char.is_some_and(|c| c.is_ascii_alphabetic()) {
        out.push(' ');
    }
}

fn latex_range(chars: &[char], start: usize, end: usize) -> String {
    let mut out = String::new();
    let mut i = start;
    while i < end {
        let c = chars[i];
        match c {
            '^' | '_' => {
                out.push(c);
                i += 1;
                let (arg, next) = latex_operand(chars, i, end);
                out.push('{');
                out.push_str(&arg);
                out.push('}');
                i = next;
            }
            '\\' => {
                i += 1;
                if i < end && chars[i].is_alphabetic() {
                    let word_start = i;
                    while i < end && chars[i].is_alphabetic() {
                        i += 1;
                    }
                    let word: String = chars[word_start..i].iter().collect();
                    let piece = format!("\\{}", canonical_macro(&word));
                    push_piece(&mut out, &piece, chars.get(i).copied());
                } else if i < end {
                    out.push('\\');
                    out.push(chars[i]);
                    i += 1;
                } else {
                    out.push('\\');
                }
            }
            c if c.is_alphabetic() => {
                let word_start = i;
                while i < end && chars[i].is_alphabetic() {
                    i += 1;
                }
                let word: String = chars[word_start..i].iter().collect();
                let piece = word_to_latex(&word);
                push_piece(&mut out, &piece, chars.get(i).copied());
            }
            _ => {
                if let Some((replacement, consumed)) = multi_symbol(&chars[i..end]) {
                    i += consumed;
                    push_piece(&mut out, replacement, chars.get(i).copied());
                } else {
                    i += 1;
                    let next_c = chars.get(i).copied();
                    match c {
                        '%' | '#' | '&' => {
                            out.push('\\');
                            out.push(c);
                        }
                        // 与 visual::safe_single_char 对齐：花括号与 $ 直接透传会
                        // 破坏最终 LaTeX 的分组/数学态配对（预览侧已转义）
                        '{' | '}' | '$' => {
                            out.push('\\');
                            out.push(c);
                        }
                        '~' => push_piece(&mut out, "\\sim", next_c),
                        '×' => push_piece(&mut out, "\\times", next_c),
                        '÷' => push_piece(&mut out, "\\div", next_c),
                        '·' | '⋅' => push_piece(&mut out, "\\cdot", next_c),
                        '±' => push_piece(&mut out, "\\pm", next_c),
                        '≤' => push_piece(&mut out, "\\le", next_c),
                        '≥' => push_piece(&mut out, "\\ge", next_c),
                        '≠' => push_piece(&mut out, "\\neq", next_c),
                        '≈' => push_piece(&mut out, "\\approx", next_c),
                        '∞' => push_piece(&mut out, "\\infty", next_c),
                        '→' => push_piece(&mut out, "\\to", next_c),
                        '←' => push_piece(&mut out, "\\leftarrow", next_c),
                        '∈' => push_piece(&mut out, "\\in", next_c),
                        '∉' => push_piece(&mut out, "\\notin", next_c),
                        '⊆' => push_piece(&mut out, "\\subseteq", next_c),
                        '∀' => push_piece(&mut out, "\\forall", next_c),
                        '∃' => push_piece(&mut out, "\\exists", next_c),
                        '∂' => push_piece(&mut out, "\\partial", next_c),
                        '∇' => push_piece(&mut out, "\\nabla", next_c),
                        '∑' => push_piece(&mut out, "\\sum", next_c),
                        '∏' => push_piece(&mut out, "\\prod", next_c),
                        '∫' => push_piece(&mut out, "\\int", next_c),
                        '∬' => push_piece(&mut out, "\\iint", next_c),
                        '∮' => push_piece(&mut out, "\\oint", next_c),
                        '√' => push_piece(&mut out, "\\surd", next_c),
                        'π' => push_piece(&mut out, "\\pi", next_c),
                        _ => out.push(c),
                    }
                }
            }
        }
    }
    out
}

fn latex_operand(chars: &[char], mut i: usize, end: usize) -> (String, usize) {
    while i < end && chars[i].is_whitespace() {
        i += 1;
    }
    if i >= end {
        return (String::new(), i);
    }
    match chars[i] {
        '(' => {
            if let Some(close) = matching_delim(chars, i, end, '(', ')') {
                (latex_range(chars, i + 1, close), close + 1)
            } else {
                (latex_range(chars, i + 1, end), end)
            }
        }
        '{' => {
            if let Some(close) = matching_delim(chars, i, end, '{', '}') {
                (latex_range(chars, i + 1, close), close + 1)
            } else {
                (latex_range(chars, i + 1, end), end)
            }
        }
        '-' | '+' => {
            let sign = chars[i];
            let (rest, next) = latex_operand(chars, i + 1, end);
            (format!("{sign}{rest}"), next)
        }
        '\\' => {
            let mut j = i + 1;
            if j < end && chars[j].is_alphabetic() {
                let start = j;
                while j < end && chars[j].is_alphabetic() {
                    j += 1;
                }
                let word: String = chars[start..j].iter().collect();
                (format!("\\{}", canonical_macro(&word)), j)
            } else if j < end {
                (chars[j..j + 1].iter().collect(), j + 1)
            } else {
                (String::new(), j)
            }
        }
        c if c.is_ascii_digit() => {
            let start = i;
            while i < end && chars[i].is_ascii_digit() {
                i += 1;
            }
            (latex_range(chars, start, i), i)
        }
        c if c.is_alphabetic() => {
            let start = i;
            while i < end && chars[i].is_alphabetic() {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            if is_known_bare_word(&word) {
                (word_to_latex(&word), i)
            } else {
                let first = chars[start].to_string();
                (first, start + 1)
            }
        }
        _ => {
            if let Some((replacement, consumed)) = multi_symbol(&chars[i..end]) {
                (replacement.to_owned(), i + consumed)
            } else {
                let ch = chars[i];
                let s = match ch {
                    '~' => "\\sim".to_owned(),
                    '%' | '#' | '&' => format!("\\{ch}"),
                    _ => ch.to_string(),
                };
                (s, i + 1)
            }
        }
    }
}

pub(crate) fn matching_delim(
    chars: &[char],
    open_index: usize,
    end: usize,
    open: char,
    close: char,
) -> Option<usize> {
    let mut depth = 0usize;
    for (index, &c) in chars.iter().enumerate().take(end).skip(open_index) {
        if c == open {
            depth += 1;
        } else if c == close {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

pub(crate) fn multi_symbol(chars: &[char]) -> Option<(&'static str, usize)> {
    let rest: String = chars.iter().take(4).collect();
    for (needle, replacement) in [
        ("...", "\\ldots"),
        ("->", "\\to"),
        ("<-", "\\leftarrow"),
        ("<=", "\\le"),
        (">=", "\\ge"),
        ("!=", "\\neq"),
        ("=>", "\\Rightarrow"),
        (":=", ":="),
        ("+-", "\\pm"),
    ] {
        if rest.starts_with(needle) {
            return Some((replacement, needle.chars().count()));
        }
    }
    None
}

pub(crate) fn canonical_macro(word: &str) -> &str {
    match word {
        "le" | "leq" => "le",
        "ge" | "geq" => "ge",
        "ne" | "neq" => "neq",
        "to" | "rightarrow" => "to",
        "leftarrow" => "leftarrow",
        "infty" | "oo" | "inf" => "infty",
        "cdot" => "cdot",
        "times" => "times",
        "div" => "div",
        "pm" => "pm",
        "mp" => "mp",
        "approx" => "approx",
        "equiv" => "equiv",
        "sim" => "sim",
        "in" => "in",
        "notin" => "notin",
        "subset" => "subset",
        "subseteq" => "subseteq",
        "supset" => "supset",
        "cup" => "cup",
        "cap" => "cap",
        "forall" => "forall",
        "exists" => "exists",
        "nabla" => "nabla",
        "partial" => "partial",
        "alpha" => "alpha",
        "beta" => "beta",
        "gamma" => "gamma",
        "delta" => "delta",
        "epsilon" => "epsilon",
        "varepsilon" => "varepsilon",
        "zeta" => "zeta",
        "eta" => "eta",
        "theta" => "theta",
        "vartheta" => "vartheta",
        "iota" => "iota",
        "kappa" => "kappa",
        "lambda" => "lambda",
        "mu" => "mu",
        "nu" => "nu",
        "xi" => "xi",
        "pi" => "pi",
        "rho" => "rho",
        "sigma" => "sigma",
        "tau" => "tau",
        "upsilon" => "upsilon",
        "phi" => "phi",
        "varphi" => "varphi",
        "chi" => "chi",
        "psi" => "psi",
        "omega" => "omega",
        "Gamma" => "Gamma",
        "Delta" => "Delta",
        "Theta" => "Theta",
        "Lambda" => "Lambda",
        "Xi" => "Xi",
        "Pi" => "Pi",
        "Sigma" => "Sigma",
        "Upsilon" => "Upsilon",
        "Phi" => "Phi",
        "Psi" => "Psi",
        "Omega" => "Omega",
        "sin" => "sin",
        "cos" => "cos",
        "tan" => "tan",
        "cot" => "cot",
        "sec" => "sec",
        "csc" => "csc",
        "arcsin" => "arcsin",
        "arccos" => "arccos",
        "arctan" => "arctan",
        "sinh" => "sinh",
        "cosh" => "cosh",
        "tanh" => "tanh",
        "log" => "log",
        "ln" => "ln",
        "exp" => "exp",
        "lim" => "lim",
        "max" => "max",
        "min" => "min",
        "det" => "det",
        "gcd" => "gcd",
        "bmod" => "bmod",
        "quad" => "quad",
        "qquad" => "qquad",
        "ldots" | "dots" => "ldots",
        "cdots" => "cdots",
        _ => word,
    }
}

pub(crate) fn word_to_latex(word: &str) -> String {
    let canonical = canonical_macro(word);
    if canonical == word && !is_known_bare_word(word) {
        return word.to_owned();
    }
    format!("\\{canonical}")
}

pub(crate) fn is_known_bare_word(word: &str) -> bool {
    matches!(
        word,
        "alpha"
            | "beta"
            | "gamma"
            | "delta"
            | "epsilon"
            | "varepsilon"
            | "zeta"
            | "eta"
            | "theta"
            | "vartheta"
            | "iota"
            | "kappa"
            | "lambda"
            | "mu"
            | "nu"
            | "xi"
            | "pi"
            | "rho"
            | "sigma"
            | "tau"
            | "upsilon"
            | "phi"
            | "varphi"
            | "chi"
            | "psi"
            | "omega"
            | "Gamma"
            | "Delta"
            | "Theta"
            | "Lambda"
            | "Xi"
            | "Pi"
            | "Sigma"
            | "Upsilon"
            | "Phi"
            | "Psi"
            | "Omega"
            | "sin"
            | "cos"
            | "tan"
            | "cot"
            | "sec"
            | "csc"
            | "arcsin"
            | "arccos"
            | "arctan"
            | "sinh"
            | "cosh"
            | "tanh"
            | "log"
            | "ln"
            | "exp"
            | "lim"
            | "max"
            | "min"
            | "det"
            | "gcd"
            | "oo"
            | "inf"
            | "in"
            | "notin"
            | "subset"
            | "subseteq"
            | "supset"
            | "cup"
            | "cap"
            | "forall"
            | "exists"
            | "nabla"
            | "partial"
            | "to"
            | "rightarrow"
            | "leftarrow"
            | "approx"
            | "equiv"
            | "sim"
            | "quad"
            | "qquad"
            | "ldots"
            | "cdots"
            | "dots"
            | "times"
            | "cdot"
            | "div"
            | "pm"
            | "mp"
    )
}

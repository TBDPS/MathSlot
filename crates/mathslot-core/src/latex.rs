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
        StructKind::TripleIntegral => sub_operator("\\iiint", &s(0), &s(1)),
        StructKind::PartialFrac => {
            let num = s(0);
            let den = s(1);
            if num.is_empty() {
                format!("\\frac{{\\partial}}{{\\partial {den}}}")
            } else {
                format!("\\frac{{\\partial {num}}}{{\\partial {den}}}")
            }
        }
        StructKind::TotalFrac => {
            let num = s(0);
            let den = s(1);
            if num.is_empty() {
                format!("\\frac{{\\mathrm{{d}}}}{{\\mathrm{{d}}{den}}}")
            } else {
                format!("\\frac{{\\mathrm{{d}}{num}}}{{\\mathrm{{d}}{den}}}")
            }
        }
        StructKind::BMatrix3 => matrix("bmatrix", slots, 3, 3),
        StructKind::Det3 => matrix("vmatrix", slots, 3, 3),
        StructKind::DDot => format!("\\ddot{{{}}}", s(0)),
        StructKind::Underline => format!("\\underline{{{}}}", s(0)),
        StructKind::Overbrace => format!("\\overbrace{{{}}}^{{{}}}", s(0), s(1)),
        StructKind::Underbrace => format!("\\underbrace{{{}}}_{{{}}}", s(0), s(1)),
        StructKind::Bracket => format!("\\left[{}\\right]", s(0)),
        StructKind::Brace => format!("\\left\\{{{}\\right\\}}", s(0)),
        StructKind::Angle => format!("\\left\\langle {}\\right\\rangle", s(0)),
        StructKind::Floor => format!("\\left\\lfloor {}\\right\\rfloor", s(0)),
        StructKind::Ceil => format!("\\left\\lceil {}\\right\\rceil", s(0)),
        StructKind::EvalBar => format!("\\left. {}\\right|_{{{}}}^{{{}}}", s(0), s(1), s(2)),
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
            '{' => {
                i += 1;
                let close = matching_delim(chars, i - 1, end, '{', '}');
                let inner_end = close.unwrap_or(end);
                let inner = latex_range(chars, i, inner_end);
                out.push('{');
                out.push_str(&inner);
                out.push('}');
                i = if let Some(c) = close { c + 1 } else { end };
            }
            '}' => {
                // 孤立闭花括号自动跳过，防止破坏 LaTeX 语法
                i += 1;
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
                if let Some(diff_macro) = is_differential_token(&word) {
                    if needs_diff_thin_space(&out) {
                        out.push_str("\\,");
                    }
                    push_piece(&mut out, diff_macro, chars.get(i).copied());
                } else {
                    let piece = word_to_latex(&word);
                    push_piece(&mut out, &piece, chars.get(i).copied());
                }
            }
            _ => {
                if let Some((replacement, consumed)) = multi_symbol(&chars[i..end]) {
                    i += consumed;
                    push_piece(&mut out, replacement, chars.get(i).copied());
                } else {
                    i += 1;
                    let next_c = chars.get(i).copied();
                    match c {
                        '%' | '#' | '&' | '$' => {
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
                        '∭' => push_piece(&mut out, "\\iiint", next_c),
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

pub(crate) fn is_differential_token(word: &str) -> Option<&'static str> {
    match word {
        "dx" => Some("\\mathrm{d}x"),
        "dt" => Some("\\mathrm{d}t"),
        "dy" => Some("\\mathrm{d}y"),
        "dz" => Some("\\mathrm{d}z"),
        "du" => Some("\\mathrm{d}u"),
        "dv" => Some("\\mathrm{d}v"),
        "dr" => Some("\\mathrm{d}r"),
        "ds" => Some("\\mathrm{d}s"),
        "dp" => Some("\\mathrm{d}p"),
        "dq" => Some("\\mathrm{d}q"),
        "dV" => Some("\\mathrm{d}V"),
        "dS" => Some("\\mathrm{d}S"),
        "dtheta" => Some("\\mathrm{d}\\theta"),
        "dphi" => Some("\\mathrm{d}\\phi"),
        "dtau" => Some("\\mathrm{d}\\tau"),
        "domega" => Some("\\mathrm{d}\\omega"),
        "dxi" => Some("\\mathrm{d}\\xi"),
        _ => None,
    }
}

pub(crate) fn needs_diff_thin_space(out: &str) -> bool {
    let trimmed = out.trim_end();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.ends_with("\\,") || trimmed.ends_with("\\quad") || trimmed.ends_with("\\qquad") {
        return false;
    }
    let Some(last_ch) = trimmed.chars().last() else {
        return false;
    };
    !matches!(
        last_ch,
        '(' | '[' | '{' | '+' | '-' | '*' | '/' | '=' | '<' | '>' | ',' | ';' | '|' | ':' | '~' | '\\'
    )
}

fn latex_operand(chars: &[char], mut i: usize, end: usize) -> (String, usize) {
    while i < end && chars[i].is_whitespace() {
        i += 1;
    }
    if i >= end {
        return (String::new(), i);
    }
    let (mut base, mut next, is_paren) = match chars[i] {
        '(' => {
            if let Some(close) = matching_delim(chars, i, end, '(', ')') {
                (latex_range(chars, i + 1, close), close + 1, true)
            } else {
                (latex_range(chars, i + 1, end), end, true)
            }
        }
        '{' => {
            if let Some(close) = matching_delim(chars, i, end, '{', '}') {
                (latex_range(chars, i + 1, close), close + 1, false)
            } else {
                (latex_range(chars, i + 1, end), end, false)
            }
        }
        '-' | '+' => {
            let sign = chars[i];
            let (rest, next) = latex_operand(chars, i + 1, end);
            return (format!("{sign}{rest}"), next);
        }
        '\\' => {
            let mut j = i + 1;
            if j < end && chars[j].is_alphabetic() {
                let start = j;
                while j < end && chars[j].is_alphabetic() {
                    j += 1;
                }
                let word: String = chars[start..j].iter().collect();
                (format!("\\{}", canonical_macro(&word)), j, false)
            } else if j < end {
                (chars[j..j + 1].iter().collect(), j + 1, false)
            } else {
                (String::new(), j, false)
            }
        }
        c if c.is_ascii_digit() => {
            let start = i;
            while i < end && chars[i].is_ascii_digit() {
                i += 1;
            }
            (latex_range(chars, start, i), i, false)
        }
        c if c.is_alphabetic() => {
            let start = i;
            while i < end && chars[i].is_alphabetic() {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            if is_known_bare_word(&word) {
                (word_to_latex(&word), i, false)
            } else {
                let first = chars[start].to_string();
                (first, start + 1, false)
            }
        }
        _ => {
            if let Some((replacement, consumed)) = multi_symbol(&chars[i..end]) {
                (replacement.to_owned(), i + consumed, false)
            } else {
                let ch = chars[i];
                let s = match ch {
                    '~' => "\\sim".to_owned(),
                    '%' | '#' | '&' => format!("\\{ch}"),
                    _ => ch.to_string(),
                };
                (s, i + 1, false)
            }
        }
    };

    if is_paren && next < end && chars[next] == '^' {
        base = format!("({base})");
    }

    // 复合指数感知解析：连带消费紧随的 ^ 幂次操作符，输出标准单一内聚的指数
    while next < end && chars[next] == '^' {
        next += 1;
        let (sub_arg, sub_next) = latex_operand(chars, next, end);
        if !sub_arg.is_empty() {
            if sub_arg.chars().count() == 1 && sub_arg.chars().all(|c| c.is_ascii_alphanumeric()) {
                base.push('^');
                base.push_str(&sub_arg);
            } else {
                base.push('^');
                base.push('{');
                base.push_str(&sub_arg);
                base.push('}');
            }
        }
        next = sub_next;
    }

    (base, next)
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
        ("<=>", "\\Leftrightarrow"),
        ("<->", "\\leftrightarrow"),
        ("-->", "\\longrightarrow"),
        ("<--", "\\longleftarrow"),
        ("...", "\\ldots"),
        ("->", "\\to"),
        ("<-", "\\leftarrow"),
        ("<=", "\\le"),
        (">=", "\\ge"),
        ("!=", "\\neq"),
        ("=>", "\\Rightarrow"),
        ("=<", "\\Leftarrow"),
        (":=", ":="),
        ("+-", "\\pm"),
        ("-+", "\\mp"),
        ("~=", "\\cong"),
        ("~~", "\\approx"),
        ("<<", "\\ll"),
        (">>", "\\gg"),
        ("||", "\\parallel"),
        ("xx", "\\times"),
        ("*", "\\cdot"),
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
        "leftrightarrow" => "leftrightarrow",
        "Rightarrow" | "implies" => "Rightarrow",
        "Leftarrow" => "Leftarrow",
        "Leftrightarrow" | "iff" => "Leftrightarrow",
        "mapsto" => "mapsto",
        "infty" | "oo" => "infty",
        "cdot" => "cdot",
        "times" => "times",
        "dd" | "diff" => "mathrm{d}",
        "ee" => "mathrm{e}",
        "ii" => "mathrm{i}",
        "coloneqq" | "coloneq" => ":=",
        "operatorname" => "operatorname",
        "div" => "div",
        "pm" => "pm",
        "mp" => "mp",
        "approx" => "approx",
        "equiv" => "equiv",
        "sim" => "sim",
        "simeq" => "simeq",
        "cong" => "cong",
        "propto" => "propto",
        "ll" => "ll",
        "gg" => "gg",
        "parallel" => "parallel",
        "perp" => "perp",
        "in" => "in",
        "notin" => "notin",
        "subset" => "subset",
        "subseteq" => "subseteq",
        "supset" => "supset",
        "supseteq" => "supseteq",
        "cup" => "cup",
        "cap" => "cap",
        "setminus" => "setminus",
        "forall" => "forall",
        "exists" => "exists",
        "nexists" => "nexists",
        "nabla" => "nabla",
        "partial" => "partial",
        "hbar" => "hbar",
        "ell" => "ell",
        "circ" => "circ",
        "emptyset" | "empty" => "emptyset",
        "varnothing" => "varnothing",
        // 希腊字母（小写）
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
        "varkappa" => "varkappa",
        "lambda" => "lambda",
        "mu" => "mu",
        "nu" => "nu",
        "xi" => "xi",
        "pi" => "pi",
        "varpi" => "varpi",
        "rho" => "rho",
        "varrho" => "varrho",
        "sigma" => "sigma",
        "varsigma" => "varsigma",
        "tau" => "tau",
        "upsilon" => "upsilon",
        "phi" => "phi",
        "varphi" => "varphi",
        "chi" => "chi",
        "psi" => "psi",
        "omega" => "omega",
        // 希腊字母（大写）
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
        // 三角与双曲函数
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
        "coth" => "coth",
        "sech" => "sech",
        "csch" => "csch",
        "arsinh" | "asinh" => "arsinh",
        "arcosh" | "acosh" => "arcosh",
        "artanh" | "atanh" => "artanh",
        // 对数与指数
        "log" => "log",
        "ln" => "ln",
        "lg" => "lg",
        "exp" => "exp",
        // 分析与极限
        "lim" => "lim",
        "limsup" => "limsup",
        "liminf" => "liminf",
        "max" => "max",
        "min" => "min",
        "sup" => "sup",
        "inf" => "inf",
        "int" => "int",
        "iint" => "iint",
        "iiint" => "iiint",
        "oint" => "oint",
        "sum" => "sum",
        "prod" => "prod",
        "coprod" => "coprod",
        "frac" => "frac",
        "dfrac" => "dfrac",
        "tfrac" => "tfrac",
        "cfrac" => "cfrac",
        "sqrt" => "sqrt",
        "binom" => "binom",
        // 代数与数论
        "det" => "det",
        "gcd" => "gcd",
        "lcm" => "lcm",
        "bmod" => "bmod",
        "pmod" => "pmod",
        "deg" => "deg",
        "dim" => "dim",
        "ker" => "ker",
        "hom" => "hom",
        "arg" => "arg",
        "rank" => "operatorname{rank}",
        "tr" => "operatorname{tr}",
        "span" => "operatorname{span}",
        "diag" => "operatorname{diag}",
        "proj" => "operatorname{proj}",
        "Res" => "operatorname{Res}",
        "Cov" => "operatorname{Cov}",
        "Re" => "Re",
        "Im" => "Im",
        "Pr" => "Pr",
        // 标注与定界符
        "hat" => "hat",
        "widehat" => "widehat",
        "bar" => "bar",
        "vec" => "vec",
        "tilde" => "tilde",
        "widetilde" => "widetilde",
        "dot" => "dot",
        "ddot" => "ddot",
        "overline" => "overline",
        "underline" => "underline",
        "overbrace" => "overbrace",
        "underbrace" => "underbrace",
        "left" => "left",
        "right" => "right",
        "middle" => "middle",
        "quad" => "quad",
        "qquad" => "qquad",
        "ldots" | "dots" => "ldots",
        "cdots" => "cdots",
        "ddots" => "ddots",
        "vdots" => "vdots",
        // 字体与格式
        "mathbf" => "mathbf",
        "boldsymbol" | "bm" => "boldsymbol",
        "mathbb" => "mathbb",
        "mathcal" => "mathcal",
        "mathrm" => "mathrm",
        "mathit" => "mathit",
        "mathsf" => "mathsf",
        "mathtt" => "mathtt",
        "mathfrak" => "mathfrak",
        "text" => "text",
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
            | "coth"
            | "sech"
            | "csch"
            | "arsinh"
            | "arcosh"
            | "artanh"
            | "log"
            | "ln"
            | "lg"
            | "exp"
            | "lim"
            | "limsup"
            | "liminf"
            | "max"
            | "min"
            | "sup"
            | "inf"
            | "det"
            | "gcd"
            | "lcm"
            | "deg"
            | "dim"
            | "ker"
            | "arg"
            | "rank"
            | "tr"
            | "span"
            | "diag"
            | "proj"
            | "Res"
            | "Cov"
            | "oo"
            | "in"
            | "notin"
            | "subset"
            | "subseteq"
            | "supset"
            | "supseteq"
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
            | "cong"
            | "propto"
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

/// 智能将标准 LaTeX 文本转换为 MathSlot 流式语法
pub fn latex_to_mathslot(input: &str) -> String {
    let mut s = input.trim();
    if s.starts_with("$$") && s.ends_with("$$") && s.len() >= 4 {
        s = s[2..s.len() - 2].trim();
    } else if s.starts_with('$') && s.ends_with('$') && s.len() >= 2 {
        s = s[1..s.len() - 1].trim();
    } else if s.starts_with("\\[") && s.ends_with("\\]") && s.len() >= 4 {
        s = s[2..s.len() - 2].trim();
    } else if s.starts_with("\\(") && s.ends_with("\\)") && s.len() >= 4 {
        s = s[2..s.len() - 2].trim();
    }
    if s.starts_with("\\begin{equation}") && s.ends_with("\\end{equation}") {
        s = s["\\begin{equation}".len()..s.len() - "\\end{equation}".len()].trim();
    }
    if s.starts_with("\\begin{equation*}") && s.ends_with("\\end{equation*}") {
        s = s["\\begin{equation*}".len()..s.len() - "\\end{equation*}".len()].trim();
    }

    let chars: Vec<char> = s.chars().collect();
    convert_latex_chars(&chars, 0, chars.len())
}

fn get_latex_arg(chars: &[char], mut i: usize, end: usize) -> ((usize, usize), usize) {
    while i < end && chars[i].is_whitespace() {
        i += 1;
    }
    if i >= end {
        return ((i, i), i);
    }
    if chars[i] == '{' {
        if let Some(close) = matching_delim(chars, i, end, '{', '}') {
            ((i + 1, close), close + 1)
        } else {
            ((i + 1, end), end)
        }
    } else {
        ((i, i + 1), i + 1)
    }
}

fn get_bracket_arg(chars: &[char], mut i: usize, end: usize) -> Option<((usize, usize), usize)> {
    while i < end && chars[i].is_whitespace() {
        i += 1;
    }
    if i < end && chars[i] == '[' {
        if let Some(close) = matching_delim(chars, i, end, '[', ']') {
            Some(((i + 1, close), close + 1))
        } else {
            Some(((i + 1, end), end))
        }
    } else {
        None
    }
}

fn convert_latex_chars(chars: &[char], start: usize, end: usize) -> String {
    let mut out = String::new();
    let mut i = start;
    while i < end {
        if chars[i] == '\\' {
            let bs_idx = i;
            i += 1;
            if i < end && chars[i].is_alphabetic() {
                let word_start = i;
                while i < end && chars[i].is_alphabetic() {
                    i += 1;
                }
                let word: String = chars[word_start..i].iter().collect();
                match word.as_str() {
                    "frac" | "dfrac" | "tfrac" | "cfrac" => {
                        let (num, next1) = get_latex_arg(chars, i, end);
                        let (den, next2) = get_latex_arg(chars, next1, end);
                        out.push_str(&format!(
                            "▸f{};{};",
                            convert_latex_chars(chars, num.0, num.1),
                            convert_latex_chars(chars, den.0, den.1)
                        ));
                        i = next2;
                        continue;
                    }
                    "sqrt" => {
                        if let Some((opt, next_opt)) = get_bracket_arg(chars, i, end) {
                            let (body, next_body) = get_latex_arg(chars, next_opt, end);
                            out.push_str(&format!(
                                "▸n{};{};",
                                convert_latex_chars(chars, opt.0, opt.1),
                                convert_latex_chars(chars, body.0, body.1)
                            ));
                            i = next_body;
                        } else {
                            let (body, next_body) = get_latex_arg(chars, i, end);
                            out.push_str(&format!(
                                "▸r{};",
                                convert_latex_chars(chars, body.0, body.1)
                            ));
                            i = next_body;
                        }
                        continue;
                    }
                    "lim" => {
                        let mut cursor = i;
                        while cursor < end && chars[cursor].is_whitespace() {
                            cursor += 1;
                        }
                        if cursor < end && chars[cursor] == '_' {
                            let (sub, next_sub) = get_latex_arg(chars, cursor + 1, end);
                            let sub_str = convert_latex_chars(chars, sub.0, sub.1);
                            let (var, target) = if let Some(pos) = sub_str.find("\\to").or_else(|| sub_str.find("->")) {
                                let arrow_len = if sub_str[pos..].starts_with("\\to") { 3 } else { 2 };
                                (sub_str[..pos].trim().to_owned(), sub_str[pos + arrow_len..].trim().to_owned())
                            } else {
                                (sub_str.trim().to_owned(), String::new())
                            };
                            let (body, next_body) = extract_term_body(chars, next_sub, end);
                            if body.is_empty() {
                                out.push_str(&format!("▸l{var};{target};;"));
                            } else {
                                out.push_str(&format!("▸l{var};{target};{body};"));
                            }
                            i = next_body;
                            continue;
                        }
                        out.push_str("lim ");
                        continue;
                    }
                    "int" => {
                        let (lower, upper, next) = extract_sub_sup(chars, i, end);
                        let (body, next_body) = extract_term_body(chars, next, end);
                        if let (Some(lo), Some(up)) = (&lower, &upper) {
                            if body.is_empty() {
                                out.push_str(&format!("▸i{lo};{up};;"));
                            } else {
                                out.push_str(&format!("▸i{lo};{up};{body};"));
                            }
                        } else if let Some(lo) = lower {
                            if body.is_empty() {
                                out.push_str(&format!("▸i{lo};;;"));
                            } else {
                                out.push_str(&format!("▸i{lo};;{body};"));
                            }
                        } else {
                            if body.is_empty() {
                                out.push_str("▸ca");
                            } else {
                                out.push_str(&format!("▸ca{body};"));
                            }
                        }
                        i = next_body;
                        continue;
                    }
                    "iint" => {
                        let (lower, _, next) = extract_sub_sup(chars, i, end);
                        let (body, next_body) = extract_term_body(chars, next, end);
                        let lo = lower.unwrap_or_default();
                        if body.is_empty() {
                            out.push_str(&format!("▸cc{lo};;"));
                        } else {
                            out.push_str(&format!("▸cc{lo};{body};"));
                        }
                        i = next_body;
                        continue;
                    }
                    "iiint" => {
                        let (lower, _, next) = extract_sub_sup(chars, i, end);
                        let (body, next_body) = extract_term_body(chars, next, end);
                        let lo = lower.unwrap_or_default();
                        if body.is_empty() {
                            out.push_str(&format!("▸ce{lo};;"));
                        } else {
                            out.push_str(&format!("▸ce{lo};{body};"));
                        }
                        i = next_body;
                        continue;
                    }
                    "oint" => {
                        let (lower, _, next) = extract_sub_sup(chars, i, end);
                        let (body, next_body) = extract_term_body(chars, next, end);
                        let lo = lower.unwrap_or_default();
                        if body.is_empty() {
                            out.push_str(&format!("▸cd{lo};;"));
                        } else {
                            out.push_str(&format!("▸cd{lo};{body};"));
                        }
                        i = next_body;
                        continue;
                    }
                    "sum" => {
                        let (lower, upper, next) = extract_sub_sup(chars, i, end);
                        let (body, next_body) = extract_term_body(chars, next, end);
                        let lo = lower.unwrap_or_default();
                        let up = upper.unwrap_or_default();
                        if body.is_empty() {
                            out.push_str(&format!("▸s{lo};{up};;"));
                        } else {
                            out.push_str(&format!("▸s{lo};{up};{body};"));
                        }
                        i = next_body;
                        continue;
                    }
                    "prod" => {
                        let (lower, upper, next) = extract_sub_sup(chars, i, end);
                        let (body, next_body) = extract_term_body(chars, next, end);
                        let lo = lower.unwrap_or_default();
                        let up = upper.unwrap_or_default();
                        if body.is_empty() {
                            out.push_str(&format!("▸cb{lo};{up};;"));
                        } else {
                            out.push_str(&format!("▸cb{lo};{up};{body};"));
                        }
                        i = next_body;
                        continue;
                    }
                    "binom" => {
                        let (n, next1) = get_latex_arg(chars, i, end);
                        let (k, next2) = get_latex_arg(chars, next1, end);
                        out.push_str(&format!(
                            "▸e{};{};",
                            convert_latex_chars(chars, n.0, n.1),
                            convert_latex_chars(chars, k.0, k.1)
                        ));
                        i = next2;
                        continue;
                    }
                    "left" => {
                        while i < end && chars[i].is_whitespace() {
                            i += 1;
                        }
                        if i < end {
                            let open_ch = chars[i];
                            i += 1;
                            let (inner_span, next_pos) = find_right_matching(chars, i, end);
                            let inner_str = convert_latex_chars(chars, inner_span.0, inner_span.1);
                            match open_ch {
                                '(' => out.push_str(&format!("▸p{inner_str};")),
                                '[' => out.push_str(&format!("▸al{inner_str};")),
                                '|' => out.push_str(&format!("▸v{inner_str};")),
                                '\\' if i < end && chars[i] == '{' => {
                                    out.push_str(&format!("▸am{inner_str};"));
                                }
                                _ => out.push_str(&format!("▸p{inner_str};")),
                            }
                            i = next_pos;
                            continue;
                        }
                    }
                    "hat" => {
                        let (arg, next) = get_latex_arg(chars, i, end);
                        out.push_str(&format!("▸aa{};", convert_latex_chars(chars, arg.0, arg.1)));
                        i = next;
                        continue;
                    }
                    "bar" => {
                        let (arg, next) = get_latex_arg(chars, i, end);
                        out.push_str(&format!("▸ab{};", convert_latex_chars(chars, arg.0, arg.1)));
                        i = next;
                        continue;
                    }
                    "vec" => {
                        let (arg, next) = get_latex_arg(chars, i, end);
                        out.push_str(&format!("▸ac{};", convert_latex_chars(chars, arg.0, arg.1)));
                        i = next;
                        continue;
                    }
                    "tilde" => {
                        let (arg, next) = get_latex_arg(chars, i, end);
                        out.push_str(&format!("▸ad{};", convert_latex_chars(chars, arg.0, arg.1)));
                        i = next;
                        continue;
                    }
                    "dot" => {
                        let (arg, next) = get_latex_arg(chars, i, end);
                        out.push_str(&format!("▸ae{};", convert_latex_chars(chars, arg.0, arg.1)));
                        i = next;
                        continue;
                    }
                    "ddot" => {
                        let (arg, next) = get_latex_arg(chars, i, end);
                        out.push_str(&format!("▸ah{};", convert_latex_chars(chars, arg.0, arg.1)));
                        i = next;
                        continue;
                    }
                    "overline" => {
                        let (arg, next) = get_latex_arg(chars, i, end);
                        out.push_str(&format!("▸ag{};", convert_latex_chars(chars, arg.0, arg.1)));
                        i = next;
                        continue;
                    }
                    "underline" => {
                        let (arg, next) = get_latex_arg(chars, i, end);
                        out.push_str(&format!("▸ai{};", convert_latex_chars(chars, arg.0, arg.1)));
                        i = next;
                        continue;
                    }
                    // 常用希腊字母转换
                    "alpha" => out.push_str("▸ga"),
                    "beta" => out.push_str("▸gb"),
                    "gamma" => out.push_str("▸gc"),
                    "delta" => out.push_str("▸gd"),
                    "epsilon" | "varepsilon" => out.push_str("▸ge"),
                    "theta" => out.push_str("▸gt"),
                    "lambda" => out.push_str("▸gl"),
                    "mu" => out.push_str("▸gm"),
                    "pi" => out.push_str("▸gp"),
                    "sigma" => out.push_str("▸gs"),
                    "phi" | "varphi" => out.push_str("▸gf"),
                    "omega" => out.push_str("▸go"),
                    "Delta" => out.push_str("▸gx"),
                    "Omega" => out.push_str("▸gz"),
                    // 常用符号简写
                    "infty" => out.push_str("oo"),
                    "to" => out.push_str("->"),
                    "pm" => out.push_str("+-"),
                    "mp" => out.push_str("-+"),
                    "le" | "leq" => out.push_str("<="),
                    "ge" | "geq" => out.push_str(">="),
                    "ne" | "neq" => out.push_str("!="),
                    "times" => out.push_str("▸of"),
                    "cdot" => out.push_str("▸og"),
                    "partial" => out.push_str("▸oc"),
                    "nabla" => out.push_str("▸od"),
                    "in" => out.push_str("▸oh"),
                    "notin" => out.push_str("▸oi"),
                    "forall" => out.push_str("▸ok"),
                    "exists" => out.push_str("▸qe"),
                    "equiv" => out.push_str("▸xa"),
                    "approx" => out.push_str("▸xb"),
                    "sim" => out.push_str("▸xc"),
                    "propto" => out.push_str("▸xd"),
                    "Rightarrow" | "implies" => out.push_str("=>"),
                    "Leftrightarrow" | "iff" => out.push_str("<=>"),
                    "cup" => out.push_str("▸qa"),
                    "cap" => out.push_str("▸qb"),
                    "subset" => out.push_str("▸qd"),
                    "mathbb" => {
                        let (arg, next) = get_latex_arg(chars, i, end);
                        let inner = convert_latex_chars(chars, arg.0, arg.1);
                        match inner.trim() {
                            "R" => out.push_str("▸qi"),
                            "N" => out.push_str("▸qj"),
                            "Z" => out.push_str("▸qk"),
                            "Q" => out.push_str("▸ql"),
                            "C" => out.push_str("▸qn"),
                            _ => out.push_str(&format!("\\mathbb{{{inner}}}")),
                        }
                        i = next;
                        continue;
                    }
                    "mathrm" => {
                        let (arg, next) = get_latex_arg(chars, i, end);
                        let inner = convert_latex_chars(chars, arg.0, arg.1);
                        let trimmed = inner.trim();
                        if trimmed == "d" {
                            let mut peek = next;
                            while peek < end && chars[peek].is_whitespace() {
                                peek += 1;
                            }
                            if peek < end && chars[peek].is_ascii_alphabetic() {
                                out.push('d');
                                out.push(chars[peek]);
                                i = peek + 1;
                                continue;
                            } else {
                                out.push('d');
                            }
                        } else {
                            out.push_str(trimmed);
                        }
                        i = next;
                        continue;
                    }
                    "dd" => {
                        out.push('d');
                        continue;
                    }
                    _ => {
                        // 保留如 \sin, \cos, \ln 等标准数学函数，移除前导斜杠或保留
                        if is_known_bare_word(&word) {
                            out.push_str(&word);
                            if i < end && !chars[i].is_whitespace() {
                                out.push(' ');
                            }
                        } else {
                            out.push_str(&chars[bs_idx..i].iter().collect::<String>());
                        }
                    }
                }
            } else if i < end && (chars[i] == ',' || chars[i] == ';' || chars[i] == ':' || chars[i] == '!') {
                // LaTeX 间距微调宏 \, \; \: \! 在反向编译为简码流时平滑忽略
                i += 1;
                continue;
            } else if i < end {
                out.push('\\');
                out.push(chars[i]);
                i += 1;
            } else {
                out.push('\\');
            }
        } else if chars[i] == '{' {
            if let Some(close) = matching_delim(chars, i, end, '{', '}') {
                let inner = convert_latex_chars(chars, i + 1, close);
                out.push_str(&inner);
                i = close + 1;
            } else {
                out.push(chars[i]);
                i += 1;
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn extract_term_body(chars: &[char], mut start: usize, end: usize) -> (String, usize) {
    while start < end && chars[start].is_whitespace() {
        start += 1;
    }
    if start >= end {
        return (String::new(), start);
    }
    let mut depth = 0usize;
    let mut i = start;
    while i < end {
        let c = chars[i];
        if c == '{' || c == '(' || c == '[' {
            depth += 1;
        } else if (c == '}' || c == ')' || c == ']') && depth > 0 {
            depth -= 1;
        } else if depth == 0 {
            if c == '=' || c == '<' || c == '>' {
                break;
            }
            if c == '\\' {
                let rest: String = chars[i..].iter().take(8).collect();
                if rest.starts_with("\\le")
                    || rest.starts_with("\\ge")
                    || rest.starts_with("\\ne")
                    || rest.starts_with("\\approx")
                    || rest.starts_with("\\equiv")
                    || rest.starts_with("\\sim")
                {
                    break;
                }
            }
        }
        i += 1;
    }
    let body = convert_latex_chars(chars, start, i).trim().to_owned();
    (body, i)
}

fn extract_sub_sup(
    chars: &[char],
    mut i: usize,
    end: usize,
) -> (Option<String>, Option<String>, usize) {
    let mut lower = None;
    let mut upper = None;
    for _ in 0..2 {
        while i < end && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= end {
            break;
        }
        if chars[i] == '_' && lower.is_none() {
            let (arg, next) = get_latex_arg(chars, i + 1, end);
            lower = Some(convert_latex_chars(chars, arg.0, arg.1));
            i = next;
        } else if chars[i] == '^' && upper.is_none() {
            let (arg, next) = get_latex_arg(chars, i + 1, end);
            upper = Some(convert_latex_chars(chars, arg.0, arg.1));
            i = next;
        } else {
            break;
        }
    }
    (lower, upper, i)
}

fn find_right_matching(chars: &[char], start: usize, end: usize) -> ((usize, usize), usize) {
    let mut depth = 1usize;
    let mut i = start;
    let right_macro = ['\\', 'r', 'i', 'g', 'h', 't'];
    while i < end {
        if i + 5 < end && chars[i..i + 6] == right_macro {
            depth -= 1;
            if depth == 0 {
                let inner_end = i;
                let mut next_pos = i + 6;
                while next_pos < end && chars[next_pos].is_whitespace() {
                    next_pos += 1;
                }
                if next_pos < end {
                    next_pos += 1; // 消耗定界符如 `)`、`]`
                }
                return ((start, inner_end), next_pos);
            }
            i += 6;
        } else if i + 4 < end && chars[i..i + 5] == ['\\', 'l', 'e', 'f', 't'] {
            depth += 1;
            i += 5;
        } else {
            i += 1;
        }
    }
    ((start, end), end)
}

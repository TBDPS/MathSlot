use crate::ast::{Expr, MathSeq, ParsedDoc, SlotNode};
use crate::command::StructKind;

pub const EMPTY_PLACEHOLDER: &str = "□";

pub fn to_scheme_a(doc: &ParsedDoc) -> String {
    render_seq(&doc.root, true).trim().to_owned()
}

fn render_seq(seq: &MathSeq, is_root: bool) -> String {
    let mut out = String::new();
    for item in &seq.items {
        let piece = match item {
            Expr::Text { raw, .. } => raw.clone(),
            Expr::Symbol { cmd, .. } => cmd.scheme_a_str().to_owned(),
            Expr::Struct { kind, slots, .. } => render_struct(*kind, slots),
            Expr::CustomStruct { format, slots, .. } => {
                let rendered: Vec<String> = slots.iter().map(render_slot).collect();
                format.render_scheme_a(&rendered)
            }
            Expr::PendingCmd { .. } => String::new(),
            Expr::UnknownCmd { code, .. } => format!("?{code}"),
        };
        if piece.is_empty() {
            continue;
        }
        if needs_space_between(&out, &piece) {
            out.push(' ');
        }
        out.push_str(&piece);
    }
    if !is_root && out.trim().is_empty() {
        return EMPTY_PLACEHOLDER.to_owned();
    }
    out
}

fn render_slot(slot: &SlotNode) -> String {
    let rendered = render_seq(&slot.seq, false);
    let trimmed = rendered.trim();
    if trimmed.is_empty() {
        EMPTY_PLACEHOLDER.to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn render_struct(kind: StructKind, slots: &[SlotNode]) -> String {
    let s = |i: usize| render_slot(&slots[i]);
    match kind {
        StructKind::Frac => format!("frac({}, {})", s(0), s(1)),
        StructKind::Sqrt => format!("sqrt({})", s(0)),
        StructKind::NthRoot => format!("root({}, {})", s(0), s(1)),
        StructKind::Sup => format!("sup({}, {})", s(0), s(1)),
        StructKind::Sub => format!("sub({}, {})", s(0), s(1)),
        StructKind::SubSup => format!("subsup({}, {}, {})", s(0), s(1), s(2)),
        StructKind::Paren => format!("paren({})", s(0)),
        StructKind::Abs => format!("abs({})", s(0)),
        StructKind::Integral => format!("int({}, {}, {})", s(0), s(1), s(2)),
        StructKind::IndefIntegral => format!("int({})", s(0)),
        StructKind::DoubleIntegral => format!("iint({}, {})", s(0), s(1)),
        StructKind::ContourIntegral => format!("oint({}, {})", s(0), s(1)),
        StructKind::Sum => format!("sum({}, {}, {})", s(0), s(1), s(2)),
        StructKind::Product => format!("prod({}, {}, {})", s(0), s(1), s(2)),
        StructKind::Limit => format!("lim({} -> {}, {})", s(0), s(1), s(2)),
        StructKind::Matrix2 => format!("mat2({}, {}; {}, {})", s(0), s(1), s(2), s(3)),
        StructKind::Matrix3 => format!(
            "mat3({}, {}, {}; {}, {}, {}; {}, {}, {})",
            s(0),
            s(1),
            s(2),
            s(3),
            s(4),
            s(5),
            s(6),
            s(7),
            s(8)
        ),
        StructKind::Det2 => format!("det2({}, {}; {}, {})", s(0), s(1), s(2), s(3)),
        StructKind::Cases2 => format!("cases({}, {}; {}, {})", s(0), s(1), s(2), s(3)),
        StructKind::Hat => format!("hat({})", s(0)),
        StructKind::Bar => format!("bar({})", s(0)),
        StructKind::Vec => format!("vec({})", s(0)),
        StructKind::Tilde => format!("tilde({})", s(0)),
        StructKind::Dot => format!("dot({})", s(0)),
        StructKind::Norm => format!("norm({})", s(0)),
        StructKind::Overline => format!("overline({})", s(0)),
        StructKind::Binom => format!("binom({}, {})", s(0), s(1)),
        StructKind::BMatrix2 => format!("mat2[{}, {}; {}, {}]", s(0), s(1), s(2), s(3)),
        StructKind::Cases3 => format!(
            "cases({}, {}; {}, {}; {}, {})",
            s(0),
            s(1),
            s(2),
            s(3),
            s(4),
            s(5)
        ),
    }
}

fn needs_space_between(left: &str, right: &str) -> bool {
    let Some(lc) = left.chars().last() else {
        return false;
    };
    let Some(rc) = right.chars().next() else {
        return false;
    };
    if lc.is_whitespace() || rc.is_whitespace() {
        return false;
    }
    let left_word_or_close = lc.is_ascii_alphanumeric() || lc == ')';
    let right_word = rc.is_ascii_alphanumeric();
    left_word_or_close && right_word
}

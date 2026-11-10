use crate::import::convert_latex_with_report;
use mathslot_syntax::{Expr, Spanned};

/// 验证 AST 节点结构等价性（忽略源码物理 Span 差异）
pub fn exprs_structurally_equal(a: &[Spanned<Expr>], b: &[Spanned<Expr>]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .all(|(x, y)| expr_structurally_equal(&x.node, &y.node))
}

fn expr_structurally_equal(a: &Expr, b: &Expr) -> bool {
    match (a, b) {
        (Expr::Text(s1), Expr::Text(s2)) => s1 == s2,
        (Expr::Symbol(k1), Expr::Symbol(k2)) => k1 == k2,
        (Expr::Group(i1), Expr::Group(i2)) => exprs_structurally_equal(i1, i2),
        (
            Expr::Script {
                base: b1,
                sub: sub1,
                sup: sup1,
            },
            Expr::Script {
                base: b2,
                sub: sub2,
                sup: sup2,
            },
        ) => {
            expr_structurally_equal(&b1.node, &b2.node)
                && match (sub1, sub2) {
                    (Some(s1), Some(s2)) => expr_structurally_equal(&s1.node, &s2.node),
                    (None, None) => true,
                    _ => false,
                }
                && match (sup1, sup2) {
                    (Some(s1), Some(s2)) => expr_structurally_equal(&s1.node, &s2.node),
                    (None, None) => true,
                    _ => false,
                }
        }
        (
            Expr::Delimited {
                open: o1,
                close: c1,
                body: b1,
                auto_scale: a1,
            },
            Expr::Delimited {
                open: o2,
                close: c2,
                body: b2,
                auto_scale: a2,
            },
        ) => o1 == o2 && c1 == c2 && a1 == a2 && exprs_structurally_equal(b1, b2),
        (Expr::Fraction { num: n1, den: d1 }, Expr::Fraction { num: n2, den: d2 }) => {
            exprs_structurally_equal(n1, n2) && exprs_structurally_equal(d1, d2)
        }
        (
            Expr::Root {
                index: i1,
                radicand: r1,
            },
            Expr::Root {
                index: i2,
                radicand: r2,
            },
        ) => {
            let idx_eq = match (i1, i2) {
                (Some(x1), Some(x2)) => exprs_structurally_equal(x1, x2),
                (None, None) => true,
                _ => false,
            };
            idx_eq && exprs_structurally_equal(r1, r2)
        }
        (
            Expr::BigOperator {
                kind: k1,
                lower: l1,
                upper: u1,
                body: b1,
            },
            Expr::BigOperator {
                kind: k2,
                lower: l2,
                upper: u2,
                body: b2,
            },
        ) => {
            k1 == k2
                && match (l1, l2) {
                    (Some(x1), Some(x2)) => exprs_structurally_equal(x1, x2),
                    (None, None) => true,
                    _ => false,
                }
                && match (u1, u2) {
                    (Some(x1), Some(x2)) => exprs_structurally_equal(x1, x2),
                    (None, None) => true,
                    _ => false,
                }
                && exprs_structurally_equal(b1, b2)
        }
        (Expr::Matrix { env: e1, rows: r1 }, Expr::Matrix { env: e2, rows: r2 }) => {
            if e1 != e2 || r1.len() != r2.len() {
                return false;
            }
            r1.iter().zip(r2.iter()).all(|(row1, row2)| {
                row1.len() == row2.len()
                    && row1
                        .iter()
                        .zip(row2.iter())
                        .all(|(c1, c2)| exprs_structurally_equal(c1, c2))
            })
        }
        (
            Expr::Style {
                style: s1,
                body: b1,
            },
            Expr::Style {
                style: s2,
                body: b2,
            },
        ) => s1 == s2 && exprs_structurally_equal(b1, b2),
        (Expr::Placeholder { label: l1, .. }, Expr::Placeholder { label: l2, .. }) => l1 == l2,
        (Expr::RawLatex { latex: l1, .. }, Expr::RawLatex { latex: l2, .. }) => l1 == l2,
        (
            Expr::Error {
                message: m1,
                raw: r1,
            },
            Expr::Error {
                message: m2,
                raw: r2,
            },
        ) => m1 == m2 && r1 == r2,
        _ => false,
    }
}

/// 往返校验器：解析输入并格式化，然后重新解析并验证 AST 结构等价性
pub fn verify_roundtrip(latex: &str) -> Result<(), String> {
    let (ast1, report1) = convert_latex_with_report(latex);
    let (ast2, _report2) = convert_latex_with_report(&report1.roundtrip_latex);

    if exprs_structurally_equal(&ast1, &ast2) {
        Ok(())
    } else {
        Err(format!(
            "Roundtrip structural mismatch!\nInitial Latex: {}\nCanonical Latex: {}\nInitial AST: {:?}\nRoundtrip AST: {:?}",
            latex, report1.roundtrip_latex, ast1, ast2
        ))
    }
}

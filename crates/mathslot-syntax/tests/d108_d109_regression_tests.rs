use mathslot_syntax::{Delim, Expr, Span, Spanned, parse, to_latex};

fn collect_delim_kinds(exprs: &[Spanned<Expr>], out: &mut Vec<(Delim, Delim, bool)>) {
    for spanned in exprs {
        match &spanned.node {
            Expr::Group(items) | Expr::Style { body: items, .. } => {
                collect_delim_kinds(items, out);
            }
            Expr::Script { base, sub, sup } => {
                collect_delim_kinds(std::slice::from_ref(base.as_ref()), out);
                if let Some(s) = sub {
                    collect_delim_kinds(std::slice::from_ref(s.as_ref()), out);
                }
                if let Some(s) = sup {
                    collect_delim_kinds(std::slice::from_ref(s.as_ref()), out);
                }
            }
            Expr::Delimited {
                open,
                close,
                body,
                auto_scale,
            } => {
                out.push((*open, *close, *auto_scale));
                collect_delim_kinds(body, out);
            }
            Expr::Fraction { num, den } => {
                collect_delim_kinds(num, out);
                collect_delim_kinds(den, out);
            }
            Expr::Root { index, radicand } => {
                if let Some(idx) = index {
                    collect_delim_kinds(idx, out);
                }
                collect_delim_kinds(radicand, out);
            }
            Expr::BigOperator {
                lower, upper, body, ..
            } => {
                if let Some(l) = lower {
                    collect_delim_kinds(l, out);
                }
                if let Some(u) = upper {
                    collect_delim_kinds(u, out);
                }
                collect_delim_kinds(body, out);
            }
            Expr::Matrix { rows, .. } => {
                for row in rows {
                    for cell in row {
                        collect_delim_kinds(cell, out);
                    }
                }
            }
            Expr::Text(_)
            | Expr::Symbol(_)
            | Expr::Placeholder { .. }
            | Expr::RawLatex { .. }
            | Expr::Error { .. } => {}
        }
    }
}

#[test]
fn test_d108_macro_spacing_never_glues_control_words() {
    let cases = [
        (r"A = U \Sigma V^{T}", r"\Sigma V^{T}", r"\SigmaV"),
        (
            r"f(x) = \frac{1}{\sqrt{2\pi}} \sigma e^{-} \frac{(x - \mu)^{2}}{2\sigma^{2}}",
            r"\sigma e^{-}",
            r"\sigmae",
        ),
        (r"q \cdot k_{+/}", r"\cdot k_{+/}", r"\cdotk"),
        (
            r"\frac{\partial^{2}}{\partial t^{2}}",
            r"\partial t^{2}",
            r"\partialt",
        ),
        (
            r"d(\omega \land \eta) = d\omega \land \eta + (-1)^{p} \omega \land d\eta",
            r"\land d\eta",
            r"\landd",
        ),
        (
            r"F = dA = \frac{1}{2} {F}_{\mu \nu} d {x}^{\mu} \land d {x}^{\nu}",
            r"\land d{x}^{\nu}",
            r"\landd",
        ),
        (r"|A \cup B \cup C|", r"\cup B", r"\cupB"),
    ];

    for (input, expected_substr, forbidden_glued) in cases {
        let (ast, _) = parse(input);
        let latex = to_latex(&ast);
        assert!(
            !latex.contains(forbidden_glued),
            "D-108 glued macro '{forbidden_glued}' found in '{latex}' for input '{input}'"
        );
        assert!(
            latex.contains(expected_substr),
            "D-108 expected '{expected_substr}' in '{latex}' for input '{input}'"
        );
    }

    // Braced script base after RawLatex macro must remain valid and not glue into \landx
    let (braced_ast, _) = parse(r"\land {x}^{\nu}");
    let braced_latex = to_latex(&braced_ast);
    assert!(
        !braced_latex.contains(r"\landx"),
        "Must never glue \\land and {{x}}: {braced_latex}"
    );
    let (reparsed, _) = parse(&braced_latex);
    assert_eq!(
        reparsed.len(),
        1,
        "Re-parse must preserve \\land {{x}}^{{\\nu}}: {reparsed:?}"
    );
    assert_eq!(to_latex(&reparsed), braced_latex);

    // Expr::Error and odd vs even backslash count
    let err_exprs = vec![
        Expr::Error {
            message: "test".into(),
            raw: r"\badmacro".into(),
        }
        .spanned(Span::point(0)),
        Expr::Text("x".into()).spanned(Span::point(0)),
    ];
    assert_eq!(to_latex(&err_exprs), r"\badmacro x");

    let even_bs_exprs = vec![
        Expr::RawLatex {
            latex: r"\\a".into(),
            warning: None,
        }
        .spanned(Span::point(0)),
        Expr::Text("b".into()).spanned(Span::point(0)),
    ];
    assert_eq!(to_latex(&even_bs_exprs), r"\\ab");

    let odd_bs_exprs = vec![
        Expr::RawLatex {
            latex: r"\\\a".into(),
            warning: None,
        }
        .spanned(Span::point(0)),
        Expr::Text("b".into()).spanned(Span::point(0)),
    ];
    assert_eq!(to_latex(&odd_bs_exprs), r"\\\a b");
}

#[test]
fn test_d109_delimiters_vert_floor_ceil_preserved() {
    let vert_cases = [
        (r"\left\Vert x \right\Vert", true),
        (r"\left\| x \right\|", true),
        (r"\Vert x \Vert", false),
        (r"\| x \|", false),
    ];

    for (input, expected_auto_scale) in vert_cases {
        let (ast, diags) = parse(input);
        assert!(
            diags.is_empty(),
            "Unexpected diagnostics for '{input}': {diags:?}"
        );
        let mut delims = Vec::new();
        collect_delim_kinds(&ast, &mut delims);
        assert_eq!(
            delims,
            vec![(Delim::DoublePipe, Delim::DoublePipe, expected_auto_scale)],
            "Delimiter mismatch for '{input}'"
        );

        let latex = to_latex(&ast);
        assert!(
            !latex.contains(r"\left.") && !latex.contains(r"\right."),
            "INV-002 violation: '{input}' degraded to empty delimiter '{latex}'"
        );

        let (reparsed, reparsed_diags) = parse(&latex);
        assert!(
            reparsed_diags.is_empty(),
            "Round-trip diagnostics for '{latex}': {reparsed_diags:?}"
        );
        let mut reparsed_delims = Vec::new();
        collect_delim_kinds(&reparsed, &mut reparsed_delims);
        assert_eq!(
            reparsed_delims,
            vec![(Delim::DoublePipe, Delim::DoublePipe, expected_auto_scale)],
            "Round-trip delimiter mismatch for '{latex}'"
        );
    }

    let floor_ceil_cases = [
        (
            r"\left\lfloor x \right\rfloor",
            Delim::Floor,
            Delim::Floor,
            true,
        ),
        (
            r"\left\lceil x \right\rceil",
            Delim::Ceil,
            Delim::Ceil,
            true,
        ),
        (
            r"\left\lfloor x \right\rceil",
            Delim::Floor,
            Delim::Ceil,
            true,
        ),
        (r"\lfloor x \rfloor", Delim::Floor, Delim::Floor, false),
        (r"\lceil x \rceil", Delim::Ceil, Delim::Ceil, false),
    ];

    for (input, expected_open, expected_close, expected_auto_scale) in floor_ceil_cases {
        let (ast, diags) = parse(input);
        assert!(
            diags.is_empty(),
            "Unexpected diagnostics for '{input}': {diags:?}"
        );
        let mut delims = Vec::new();
        collect_delim_kinds(&ast, &mut delims);
        assert_eq!(
            delims,
            vec![(expected_open, expected_close, expected_auto_scale)],
            "Delimiter mismatch for '{input}': {ast:?}"
        );

        let latex = to_latex(&ast);
        assert!(
            !latex.contains(r"\left.") && !latex.contains(r"\right."),
            "INV-002 violation: '{input}' degraded to empty delimiter '{latex}'"
        );
        assert!(
            !latex.contains(r"\lfloorx") && !latex.contains(r"\lceilx"),
            "Bare delimiter glued to body in '{latex}'"
        );

        let (reparsed, reparsed_diags) = parse(&latex);
        assert!(
            reparsed_diags.is_empty(),
            "Round-trip diagnostics for '{latex}': {reparsed_diags:?}"
        );
        let mut reparsed_delims = Vec::new();
        collect_delim_kinds(&reparsed, &mut reparsed_delims);
        assert_eq!(
            reparsed_delims,
            vec![(expected_open, expected_close, expected_auto_scale)],
            "Round-trip delimiter mismatch for '{latex}'"
        );
    }

    // Legitimate empty delimiter remains Delim::Empty
    let (empty_ast, empty_diags) = parse(r"\left. \frac{df}{dx} \right|");
    assert!(empty_diags.is_empty());
    let mut empty_delims = Vec::new();
    collect_delim_kinds(&empty_ast, &mut empty_delims);
    assert_eq!(empty_delims, vec![(Delim::Empty, Delim::Pipe, true)]);
}

use mathslot_syntax::{Expr, MatrixEnv, SyntaxErrorKind, parse, to_latex};

#[test]
fn d138_unknown_environment_must_not_coerce_to_matrix() {
    let input = r"\begin{align} a &= b \\ c &= d \end{align}";
    let (ast, diagnostics) = parse(input);

    assert!(
        !diagnostics.is_empty(),
        "Unsupported environment \\begin{{align}} must emit a warning diagnostic"
    );
    assert!(
        diagnostics.iter().all(|d| d.is_warning && !d.is_error()),
        "Closed unsupported environment should emit Warning (not Error): {diagnostics:?}"
    );
    assert!(
        ast.iter().any(|n| matches!(n.node, Expr::RawLatex { .. })),
        "Unsupported environment must degrade to Expr::RawLatex, got: {ast:?}"
    );
    assert!(
        !ast.iter().any(|n| matches!(n.node, Expr::Matrix { .. })),
        "Unsupported environment must NEVER coerce to Expr::Matrix: {ast:?}"
    );
    assert_eq!(to_latex(&ast), input);
}

#[test]
fn d138_supported_matrix_environments_still_parse_as_matrix() {
    for (name, expected) in [
        ("matrix", MatrixEnv::Matrix),
        ("pmatrix", MatrixEnv::Pmatrix),
        ("bmatrix", MatrixEnv::Bmatrix),
        ("vmatrix", MatrixEnv::Vmatrix),
        ("cases", MatrixEnv::Cases),
        ("aligned", MatrixEnv::Aligned),
    ] {
        let input = format!(r"\begin{{{name}}} 1 & 2 \\ 3 & 4 \end{{{name}}}");
        let (ast, diags) = parse(&input);
        assert!(
            diags.is_empty(),
            "Unexpected diagnostics for {name}: {diags:?}"
        );
        assert!(
            matches!(&ast[0].node, Expr::Matrix { env, .. } if *env == expected),
            "Expected MatrixEnv::{expected:?} for {name}, got: {ast:?}"
        );
    }
}

#[test]
fn d138_unclosed_and_mismatched_environments_emit_errors() {
    let (_, unclosed_align_diags) = parse(r"\begin{align} a &= b");
    assert!(
        unclosed_align_diags.iter().any(|d| d.is_error()),
        "Unclosed \\begin{{align}} must emit Error diagnostic: {unclosed_align_diags:?}"
    );

    let (_, mismatched_diags) = parse(r"\begin{pmatrix} a & b \end{bmatrix}");
    assert!(
        mismatched_diags.iter().any(|d| d.is_error()),
        "Mismatched environment end must emit Error diagnostic: {mismatched_diags:?}"
    );
}

#[test]
fn d139_malformed_and_unclosed_inputs_emit_error_diagnostics() {
    let error_cases = [
        "1 + 2}",
        r"a \\ b",
        r"\frac{1}{",
        r"\sqrt{x",
        r"\sqrt[3",
        r"\mathrm{abc",
        r"\unknownfoo{unclosed",
    ];

    for case in error_cases {
        let (_ast, diagnostics) = parse(case);
        assert!(
            diagnostics.iter().any(|d| d.is_error()),
            "Input '{case}' MUST emit at least one Error diagnostic, got: {diagnostics:?}"
        );
    }

    // Verify \unknownfoo{unclosed preserves the trailing "{unclosed" instead of dropping it
    let (ast, diags) = parse(r"\unknownfoo{unclosed");
    assert!(
        diags
            .iter()
            .any(|d| matches!(d.kind, SyntaxErrorKind::UnclosedDelimiter(_)) && d.is_error())
    );
    assert_eq!(to_latex(&ast), r"\unknownfoo{unclosed");
}

#[test]
fn d141_deep_nesting_5000_levels_never_overflows_stack() {
    let deep_braces = format!("{}x{}", "{".repeat(5000), "}".repeat(5000));
    let (_ast, diagnostics) = parse(&deep_braces);
    assert!(
        diagnostics.iter().any(|d| d.is_error()),
        "5000-level nested braces must emit an Error diagnostic without crashing"
    );

    let deep_fracs = format!("{}x{}", r"\frac{".repeat(500), "}{1}".repeat(500));
    let (_ast2, diagnostics2) = parse(&deep_fracs);
    assert!(
        diagnostics2.iter().any(|d| d.is_error()),
        "500-level nested \\frac must emit an Error diagnostic without crashing"
    );
}

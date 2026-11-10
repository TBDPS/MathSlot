use mathslot_latex::{
    convert_latex_with_report, inspect_environment, is_supported_environment, verify_roundtrip,
};
use mathslot_syntax::MatrixEnv;

#[test]
fn test_lossless_formula_report() {
    let input = r"\frac{a+b}{c-d} + \sqrt{x^{2}+y^{2}}";
    let (ast, report) = convert_latex_with_report(input);

    assert!(!ast.is_empty());
    assert!(
        report.lossless,
        "Formula should be 100% lossless: {report:?}"
    );
    assert_eq!(report.raw_nodes, 0);
    assert_eq!(report.empty_slots, 0);
    assert!(report.diagnostics.is_empty());

    assert!(verify_roundtrip(input).is_ok());
}

#[test]
fn test_unknown_macro_fallback_report() {
    let input = r"\unknowncustom{foo} + 1";
    let (_ast, report) = convert_latex_with_report(input);

    assert!(!report.lossless, "Unknown macro should NOT be lossless");
    assert_eq!(report.raw_nodes, 1);
    assert!(!report.diagnostics.is_empty());
    assert!(report.has_warnings());
}

#[test]
fn test_empty_slots_report() {
    let input = "▸f;;";
    let (_ast, report) = convert_latex_with_report(input);

    assert!(
        report.empty_slots >= 1,
        "Expected empty slots, got {}",
        report.empty_slots
    );
}

#[test]
fn test_environment_matrix_inspection() {
    let input = r"\begin{pmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \end{pmatrix}";
    let (ast, report) = convert_latex_with_report(input);

    assert!(report.lossless);
    assert_eq!(ast.len(), 1);

    let shape = inspect_environment(&ast[0]).expect("Should be matrix environment");
    assert_eq!(shape.env, MatrixEnv::Pmatrix);
    assert_eq!(shape.rows, 2);
    assert_eq!(shape.cols, 3);
    assert!(shape.is_rectangular);

    assert!(is_supported_environment("pmatrix"));
    assert!(is_supported_environment("bmatrix"));
    assert!(is_supported_environment("aligned"));
    assert!(!is_supported_environment("unknown_env"));

    assert!(verify_roundtrip(input).is_ok());
}

#[test]
fn test_roundtrip_verification_gt_suite() {
    let test_cases = [
        r"x^{a+b} + a_{i+1}",
        r"e^{-\frac{x}{2}}",
        r"\sum_{i=1}^{n} \left( a_{i} \right)",
        r"\int_{a}^{b} \left( f(x) \right) dx",
        r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
        r"\begin{bmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \end{bmatrix}",
    ];

    for case in test_cases {
        let res = verify_roundtrip(case);
        assert!(
            res.is_ok(),
            "Roundtrip verification failed for {case}: {:?}",
            res.err()
        );
    }
}

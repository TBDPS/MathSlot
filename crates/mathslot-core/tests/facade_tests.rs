use mathslot_core::{Expr, format_latex, parse, to_latex};

#[test]
fn test_core_facade_format_latex() {
    let input = r"\frac{1}{2} + \sqrt{x}";
    let (latex, diagnostics) = format_latex(input);

    assert!(diagnostics.is_empty(), "Diagnostics: {diagnostics:?}");
    assert_eq!(latex, r"\frac{1}{2}+\sqrt{x}");
}

#[test]
fn test_core_facade_parse_and_export() {
    let input = r"\sum_{i=1}^{n} a_i";
    let (ast, diagnostics) = parse(input);

    assert!(diagnostics.is_empty());
    assert_eq!(ast.len(), 1);
    assert!(matches!(ast[0].node, Expr::BigOperator { .. }));

    let exported = to_latex(&ast);
    assert_eq!(exported, r"\sum_{i=1}^{n} a_{i}");
}

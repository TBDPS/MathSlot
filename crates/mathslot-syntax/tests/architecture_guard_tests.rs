//! Architecture Guard Tests for MathSlot Unified Stack (T1.4 / ADR-0012)
//!
//! Verifies:
//! 1. Legacy monolithic core stack (`crates/mathslot-core/src/{parser.rs, ast.rs, latex.rs}`)
//!    is FROZEN per ADR-0012 with authoritative freeze banners (INV-001, INV-016).
//! 2. Target unified parser/AST architecture (`mathslot-syntax`) is capable of building
//!    canonical mathematical ASTs with lossless roundtrip (INV-001, INV-002, INV-007).

use mathslot_syntax::{Expr, MatrixEnv, parse, to_latex};
use std::path::Path;

const EXPECTED_FROZEN_BANNER: &str = "\
//! # [FROZEN ARCHITECTURE - GATE G1 T1.4]
//! This legacy module is FROZEN per ADR-0012.
//! Target architecture: mathslot-syntax / mathslot-doc / mathslot-latex.
//! Maintained solely for parity verification (T1.7) until full cutover.";

#[test]
fn test_legacy_core_parser_is_marked_frozen() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let parser_path = manifest_dir.join("../mathslot-core/src/parser.rs");
    let content = std::fs::read_to_string(&parser_path)
        .unwrap_or_else(|e| panic!("Failed to read {}: {e}", parser_path.display()));

    assert!(
        content.starts_with(EXPECTED_FROZEN_BANNER),
        "Legacy parser.rs must start with frozen architecture banner per ADR-0012.\nActual head:\n{}",
        content.lines().take(6).collect::<Vec<_>>().join("\n")
    );
}

#[test]
fn test_legacy_core_ast_is_marked_frozen() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let ast_path = manifest_dir.join("../mathslot-core/src/ast.rs");
    let content = std::fs::read_to_string(&ast_path)
        .unwrap_or_else(|e| panic!("Failed to read {}: {e}", ast_path.display()));

    assert!(
        content.starts_with(EXPECTED_FROZEN_BANNER),
        "Legacy ast.rs must start with frozen architecture banner per ADR-0012.\nActual head:\n{}",
        content.lines().take(6).collect::<Vec<_>>().join("\n")
    );
}

#[test]
fn test_legacy_core_latex_is_marked_frozen() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let latex_path = manifest_dir.join("../mathslot-core/src/latex.rs");
    let content = std::fs::read_to_string(&latex_path)
        .unwrap_or_else(|e| panic!("Failed to read {}: {e}", latex_path.display()));

    assert!(
        content.starts_with(EXPECTED_FROZEN_BANNER),
        "Legacy latex.rs must start with frozen architecture banner per ADR-0012.\nActual head:\n{}",
        content.lines().take(6).collect::<Vec<_>>().join("\n")
    );
}

#[test]
fn test_unified_syntax_stack_fraction_roundtrip() {
    let input = r"\frac{a+1}{b-1}";
    let (ast, diagnostics) = parse(input);
    assert!(
        diagnostics.is_empty(),
        "Diagnostics should be empty: {diagnostics:?}"
    );
    assert_eq!(ast.len(), 1);

    if let Expr::Fraction { num, den } = &ast[0].node {
        assert!(!num.is_empty(), "Numerator must not be empty");
        assert!(!den.is_empty(), "Denominator must not be empty");
    } else {
        panic!("Expected Fraction node, got: {:?}", ast[0]);
    }

    let latex = to_latex(&ast);
    assert_eq!(latex, input);
}

#[test]
fn test_unified_syntax_stack_matrix_and_delimiters() {
    let input = r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}";
    let (ast, diagnostics) = parse(input);
    assert!(
        diagnostics.is_empty(),
        "Diagnostics should be empty: {diagnostics:?}"
    );
    assert_eq!(ast.len(), 1);

    if let Expr::Matrix { env, rows } = &ast[0].node {
        assert_eq!(*env, MatrixEnv::Pmatrix);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].len(), 2);
        assert_eq!(rows[1].len(), 2);
    } else {
        panic!("Expected Matrix node, got: {:?}", ast[0]);
    }

    let latex = to_latex(&ast);
    assert_eq!(latex, input);
}

#[test]
fn test_unified_syntax_stack_fault_tolerant_diagnostics() {
    // Unclosed delimited: parser must not panic, should emit diagnostic and produce AST node (INV-007)
    let input = r"\left( x + y";
    let (ast, diagnostics) = parse(input);
    assert!(
        !diagnostics.is_empty(),
        "Unclosed construct must generate diagnostics"
    );
    assert!(
        !ast.is_empty(),
        "Fault-tolerant parser must produce AST node"
    );
}

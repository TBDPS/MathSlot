use mathslot_core::{
    exprs_structurally_equal, inspect_environment, parse, Cursor, Edit,
    EnvironmentShape, MatrixEnv, Session, SlotRole,
};

/// 模块 1：LaTeX 导入与导出无损往返专项终测
#[test]
fn test_acc_round7_latex_lossless_roundtrip_matrix() {
    let formulas = [
        ("Gaussian exponential", r"e^{-x^{2}}"),
        ("Script addition", r"x^{a+b}"),
        ("Subscript addition", r"a_{i+1}"),
        ("Fraction in exponent", r"e^{-\frac{x}{2}}"),
        (
            "Summation with left-right parens",
            r"\sum_{i=1}^{n} \left( a_{i} + b_{i} \right)",
        ),
        (
            "Integral with left-right parens and fraction",
            r"\int_{0}^{1} \left( \frac{x}{1+x^{2}} \right) dx",
        ),
        (
            "Product with left-right parens",
            r"\prod_{k=1}^{\infty} \left( 1 - \frac{1}{k^{2}} \right)",
        ),
        (
            "Pmatrix 2x2",
            r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
        ),
        (
            "Bmatrix 2x2 identity",
            r"\begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}",
        ),
        (
            "Vmatrix 2x2 determinant",
            r"\begin{vmatrix} \lambda - 1 & 2 \\ 3 & \lambda - 4 \end{vmatrix}",
        ),
        (
            "Cases piecewise",
            r"\begin{cases} x^{2} & x \ge 0 \\ -x & x < 0 \end{cases}",
        ),
        ("Combined limit", r"\lim_{x \to 0} \frac{\sin x}{x} = 1"),
        (
            "Gaussian improper integral",
            r"\int_{-\infty}^{+\infty} {e}^{-x^{2}} \mathrm{d}x = \sqrt{\pi}",
        ),
        ("Sub and superscript tensor", r"T_{i}^{j}"),
        ("N-th root with index", r"\sqrt[3]{x+1}"),
    ];

    for (label, formula) in formulas {
        let (session, report) = Session::from_latex(formula);
        assert!(
            report.lossless,
            "[{label}] Expected lossless import for '{formula}', got report: {report:?}"
        );
        assert_eq!(
            report.raw_nodes, 0,
            "[{label}] Must have 0 raw nodes for '{formula}'"
        );
        assert_eq!(
            report.empty_slots, 0,
            "[{label}] Must have 0 phantom empty slots for '{formula}'"
        );
        assert!(
            report.diagnostics.is_empty(),
            "[{label}] Diagnostics must be empty for '{formula}', got: {:?}",
            report.diagnostics
        );

        let roundtrip_latex = session.to_latex();
        let (ast1, diag1) = parse(formula);
        let (ast2, diag2) = parse(&roundtrip_latex);
        assert!(diag1.is_empty(), "[{label}] Initial parse had diagnostics: {:?}", diag1);
        assert!(diag2.is_empty(), "[{label}] Roundtrip parse had diagnostics: {:?}", diag2);
        assert!(
            exprs_structurally_equal(&ast1, &ast2),
            "[{label}] AST structural inequality!\nOrig: {formula}\nRoundtrip: {roundtrip_latex}\nAST1: {ast1:?}\nAST2: {ast2:?}"
        );
    }
}

/// 模块 2：CST 与类型化 AST 正确性、矩阵结构与错误容忍度终测
#[test]
fn test_acc_round7_ast_matrix_and_error_tolerance() {
    // 2.1 矩阵节点与环境几何验证
    let matrix_cases = [
        (
            r"\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}",
            MatrixEnv::Pmatrix,
            2,
            2,
        ),
        (
            r"\begin{bmatrix} a & b & c \\ d & e & f \end{bmatrix}",
            MatrixEnv::Bmatrix,
            2,
            3,
        ),
        (
            r"\begin{vmatrix} 1 & 2 \\ 3 & 4 \\ 5 & 6 \end{vmatrix}",
            MatrixEnv::Vmatrix,
            3,
            2,
        ),
    ];

    for (tex, expected_env, rows, cols) in matrix_cases {
        let (session, report) = Session::from_latex(tex);
        assert!(report.lossless);
        let doc = session.doc();
        assert_eq!(doc.nodes.len(), 1);
        let shape = inspect_environment(&doc.nodes[0]);
        assert_eq!(
            shape,
            Some(EnvironmentShape {
                env: expected_env,
                rows,
                cols,
                is_rectangular: true,
            })
        );
    }

    // 2.2 畸形输入容忍度（严禁 panic，优雅生成诊断或空槽记录）
    let malformed_cases = [
        (r"\left( x + y", "unclosed delimiter"),
        (r"\frac{1}", "missing denominator"),
        (r"\sqrt{", "unclosed brace in root"),
        (r"\begin{pmatrix} 1 & 2 \end{bmatrix}", "mismatched matrix"),
        (r"\unknownmacro{foo}{bar}", "unknown macro"),
    ];

    for (bad_input, desc) in malformed_cases {
        let (session, report) = Session::from_latex(bad_input);
        assert!(
            !report.diagnostics.is_empty()
                || report.raw_nodes > 0
                || !report.lossless
                || report.empty_slots > 0,
            "Malformed case '{desc}' ({bad_input}) should produce warnings/diagnostics, empty slots, or lossy report"
        );
        // 验证导出安全不崩溃
        let exported = session.to_latex();
        assert!(!exported.is_empty(), "Exported string must not be empty for '{desc}'");
    }
}

/// 模块 3：事务引擎与多层 Undo/Redo 完备性终测
#[test]
fn test_acc_round7_transaction_undo_redo_invariants() {
    let mut session = Session::new();
    assert_eq!(session.to_latex(), "");

    // 步骤 1：插入基础公式
    let rep1 = session.load_latex(r"\frac{1}{2}");
    assert!(rep1.lossless);
    assert_eq!(session.to_latex(), r"\frac{1}{2}");

    // 步骤 2：在分子槽替换
    let num_id = session
        .doc()
        .slots
        .slots()
        .iter()
        .find(|s| s.role == SlotRole::Numerator)
        .expect("must find numerator")
        .id;
    session
        .apply_edit(
            Edit::ReplaceSlot {
                slot_id: num_id,
                new_nodes: parse("x+y").0,
            },
            "replace num",
        )
        .expect("replace slot should succeed");
    assert_eq!(session.to_latex(), r"\frac{x+y}{2}");

    // 步骤 3：在分母槽清空
    let den_id = session
        .doc()
        .slots
        .slots()
        .iter()
        .find(|s| s.role == SlotRole::Denominator)
        .expect("must find denominator")
        .id;
    session
        .apply_edit(Edit::ClearSlot { slot_id: den_id }, "clear den")
        .expect("clear slot should succeed");
    assert_eq!(session.to_latex(), r"\frac{x+y}{}");

    // 步骤 4：在分母输入新文本
    session.set_cursor(Cursor::InSlot {
        slot_id: den_id,
        offset: 0,
    });
    session.insert_text("z^2").expect("insert_text should succeed");
    assert_eq!(session.to_latex(), r"\frac{x+y}{z^{2}}");

    // 步骤 5：逐步反向 Undo
    assert!(session.undo(), "Undo step 4 (insert z^2)");
    assert_eq!(session.to_latex(), r"\frac{x+y}{}");

    assert!(session.undo(), "Undo step 3 (clear den)");
    assert_eq!(session.to_latex(), r"\frac{x+y}{2}");

    assert!(session.undo(), "Undo step 2 (replace num)");
    assert_eq!(session.to_latex(), r"\frac{1}{2}");

    // 已经回退至 initial load_latex 状态
    assert!(!session.undo(), "Undo stack bottom reached");

    // 步骤 6：逐步正向 Redo
    assert!(session.redo(), "Redo step 2");
    assert_eq!(session.to_latex(), r"\frac{x+y}{2}");

    assert!(session.redo(), "Redo step 3");
    assert_eq!(session.to_latex(), r"\frac{x+y}{}");

    assert!(session.redo(), "Redo step 4");
    assert_eq!(session.to_latex(), r"\frac{x+y}{z^{2}}");

    assert!(!session.redo(), "Redo stack top reached");

    // 步骤 7：分支截断验证（在 undo 状态下写入新操作，redo 栈必须被清空）
    assert!(session.undo()); // 回到 \frac{x+y}{}
    assert_eq!(session.to_latex(), r"\frac{x+y}{}");
    // 写入新分支
    session.insert_text("w").expect("branch insert");
    assert_eq!(session.to_latex(), r"\frac{x+y}{w}");
    assert!(!session.redo(), "Redo stack must be truncated after new edit in undone state");
}

/// 模块 4：导航与锚点生成确定性终测
#[test]
fn test_acc_round7_navigation_and_anchor_generation() {
    let (mut session, _) = Session::from_latex(r"\frac{a}{b} + \sqrt{c}");
    let slot_ids: Vec<_> = session.doc().slots.slots().iter().map(|s| s.id).collect();
    assert_eq!(slot_ids.len(), 3, "Expected 3 slots: num, den, radicand");

    // 验证 Tab 遍历所有槽位
    session.set_cursor(Cursor::InSlot {
        slot_id: slot_ids[0],
        offset: 0,
    });
    assert!(session.tab_next_slot(), "Tab to den");
    if let Cursor::InSlot { slot_id, .. } = session.cursor() {
        assert_eq!(*slot_id, slot_ids[1]);
    } else {
        panic!("Cursor should be in den slot");
    }

    assert!(session.tab_next_slot(), "Tab to radicand");
    if let Cursor::InSlot { slot_id, .. } = session.cursor() {
        assert_eq!(*slot_id, slot_ids[2]);
    } else {
        panic!("Cursor should be in radicand slot");
    }

    // 循环回到第 1 个槽位
    assert!(session.tab_next_slot(), "Tab loop back to num");
    if let Cursor::InSlot { slot_id, .. } = session.cursor() {
        assert_eq!(*slot_id, slot_ids[0]);
    } else {
        panic!("Cursor should loop back to num");
    }
}

/// 模块 5：降级诊断与警告提示终测
#[test]
fn test_acc_round7_degradation_diagnostics_and_warnings() {
    let unsupported = r"\customcmd{foo} + \badmacro[opt]{bar}";
    let (session, report) = Session::from_latex(unsupported);

    assert!(!report.lossless, "Unsupported formula must report lossless: false");
    assert!(report.raw_nodes >= 2, "Must report at least 2 raw nodes");
    assert!(report.has_warnings(), "Must have warnings in report");

    // 导出的公式中必须保留原始宏名，不能被静默丢弃
    let exported = session.to_latex();
    assert!(exported.contains("customcmd"), "Must retain customcmd");
    assert!(exported.contains("badmacro"), "Must retain badmacro");
}

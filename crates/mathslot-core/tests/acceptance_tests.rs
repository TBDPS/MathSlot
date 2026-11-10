use mathslot_core::{
    Cursor, Delim, DocError, Edit, EnvironmentShape, Expr, MatrixEnv, Session, SlotRole,
    exprs_structurally_equal, format_latex, inspect_environment, parse,
};
use std::time::Instant;

// ============================================================================
// Dimension A: REWRITE_DESIGN.md §13 10 大验收标准逐项核验
// ============================================================================

/// Criterion 1: `e^{-x^{2}}`、`x^{a+b}`、`a_{i+1}`、`e^{-\frac{x}{2}}` 全部无损往返
#[test]
fn test_criterion_01_script_nesting_lossless_roundtrip() {
    let cases = [r"e^{-x^{2}}", r"x^{a+b}", r"a_{i+1}", r"e^{-\frac{x}{2}}"];

    for case in cases {
        let (session, report) = Session::from_latex(case);
        assert!(
            report.lossless,
            "Criterion 1 failed: formula '{case}' must be lossless, got report: {report:?}"
        );
        assert_eq!(
            report.raw_nodes, 0,
            "Criterion 1 failed: formula '{case}' produced raw nodes"
        );
        assert!(
            report.diagnostics.is_empty(),
            "Criterion 1 failed: diagnostics found: {:?}",
            report.diagnostics
        );

        // 重新解析往返输出，比对 AST 结构等价性
        let roundtrip_latex = session.to_latex();
        let (ast_initial, _) = parse(case);
        let (ast_roundtrip, _) = parse(&roundtrip_latex);
        assert!(
            exprs_structurally_equal(&ast_initial, &ast_roundtrip),
            "Criterion 1 failed: AST mismatch on roundtrip!\nCase: {case}\nRoundtrip: {roundtrip_latex}\nInitial AST: {ast_initial:?}\nRoundtrip AST: {ast_roundtrip:?}"
        );
    }
}

/// Criterion 2: `\sum/\int` 后接 `\left(...\right)` 不再产生空槽
#[test]
fn test_criterion_02_big_op_with_left_right_delimited() {
    let cases = [
        r"\sum_{i=1}^{n} \left( a_{i} + b_{i} \right)",
        r"\int_{a}^{b} \left( f(x) \right) dx",
        r"\prod_{k=1}^{\infty} \left( 1 - \frac{1}{k^2} \right)",
    ];

    for case in cases {
        let (session, report) = Session::from_latex(case);
        assert!(
            report.lossless,
            "Criterion 2 failed: '{case}' should be lossless"
        );
        assert_eq!(
            report.empty_slots, 0,
            "Criterion 2 failed: '{case}' produced phantom empty slots: {}",
            report.empty_slots
        );

        // 验证 AST 根节点确实为 BigOperator，且其 body 包含 Delimited
        let doc = session.doc();
        assert!(!doc.nodes.is_empty(), "Document should not be empty");
        match &doc.nodes[0].node {
            Expr::BigOperator { body, .. } => {
                assert!(
                    !body.is_empty(),
                    "Criterion 2 failed: BigOperator body should not be empty"
                );
                let has_delimited = body
                    .iter()
                    .any(|b| matches!(b.node, Expr::Delimited { .. }));
                assert!(
                    has_delimited,
                    "Criterion 2 failed: BigOperator body should contain Delimited expr"
                );
            }
            other => panic!("Expected BigOperator, got {:?}", other),
        }
    }
}

/// Criterion 3: `pmatrix/bmatrix/vmatrix/cases` 正确转为矩阵节点
#[test]
fn test_criterion_03_matrices_and_cases_environments() {
    let cases = [
        (
            r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
            MatrixEnv::Pmatrix,
            2,
            2,
        ),
        (
            r"\begin{bmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \end{bmatrix}",
            MatrixEnv::Bmatrix,
            2,
            3,
        ),
        (
            r"\begin{vmatrix} x & y \\ z & w \end{vmatrix}",
            MatrixEnv::Vmatrix,
            2,
            2,
        ),
        (
            r"\begin{cases} x & x \ge 0 \\ -x & x < 0 \end{cases}",
            MatrixEnv::Cases,
            2,
            2,
        ),
    ];

    for (latex, expected_env, expected_rows, expected_cols) in cases {
        let (session, report) = Session::from_latex(latex);
        assert!(report.lossless, "Matrix '{latex}' should be lossless");

        let doc = session.doc();
        assert_eq!(doc.nodes.len(), 1);
        match &doc.nodes[0].node {
            Expr::Matrix { env, rows } => {
                assert_eq!(env, &expected_env, "Environment mismatch for '{latex}'");
                assert_eq!(
                    rows.len(),
                    expected_rows,
                    "Row count mismatch for '{latex}'"
                );
                for row in rows {
                    assert_eq!(
                        row.len(),
                        expected_cols,
                        "Column count mismatch for '{latex}'"
                    );
                }
            }
            other => panic!("Expected Expr::Matrix for '{latex}', got {:?}", other),
        }

        // 验证 inspect_environment 工具函数
        let shape = inspect_environment(&doc.nodes[0]);
        assert_eq!(
            shape,
            Some(EnvironmentShape {
                env: expected_env,
                rows: expected_rows,
                cols: expected_cols,
                is_rectangular: true,
            })
        );
    }
}

/// Criterion 4: 导入有损时 UI/Report 明确警告，不静默替换
#[test]
fn test_criterion_04_lossy_import_diagnostics_warning() {
    let lossy_cases = [
        (r"\xymatrix{ A \ar[r] & B }", "xymatrix"),
        (r"\unknownmacro{hello}", "unknownmacro"),
        (r"\foo + \bar{x}", "foo"),
    ];

    for (latex, macro_name) in lossy_cases {
        let (session, report) = Session::from_latex(latex);
        assert!(
            !report.lossless,
            "Criterion 4 failed: '{latex}' must be flagged lossy"
        );
        assert!(
            report.raw_nodes >= 1,
            "Criterion 4 failed: raw_nodes must be >= 1 for '{latex}'"
        );
        assert!(
            report.has_warnings(),
            "Criterion 4 failed: has_warnings() must be true for '{latex}'"
        );

        // 验证诊断信息中明确记录了未知宏名称
        let found_warning = report
            .diagnostics
            .iter()
            .any(|d| d.kind.to_string().contains(macro_name));
        assert!(
            found_warning,
            "Criterion 4 failed: diagnostics should mention macro '{macro_name}', got: {:?}",
            report.diagnostics
        );

        // 验证未静默丢弃：输出 LaTeX 仍保留原宏
        let exported = session.to_latex();
        assert!(
            exported.contains(macro_name),
            "Criterion 4 failed: exported LaTeX should preserve raw macro '{macro_name}', got: {exported}"
        );
    }
}

/// Criterion 5: 导入页可直接保存为模板（由 Session 产出标准 ImportReport 与干净规范 LaTeX）
#[test]
fn test_criterion_05_session_report_and_template_export() {
    let latex = r"\frac{a+b}{c+d}";
    let (session, report) = Session::from_latex(latex);

    assert!(report.lossless);
    assert_eq!(report.empty_slots, 0);
    assert_eq!(report.raw_nodes, 0);

    // 导出的规范 LaTeX 可作为新模板保存
    let template_latex = session.to_latex();
    assert_eq!(template_latex, r"\frac{a+b}{c+d}");

    // Session 状态能够持久读取 last_report
    assert!(session.last_report().is_some());
    assert_eq!(session.last_report().unwrap().lossless, true);
}

/// Criterion 6: 导航与槽位抽象的一致性基石（SlotTable 确定性）
#[test]
fn test_criterion_06_navigation_and_slot_table_consistency() {
    let latex = r"\frac{1}{2} + \sqrt{x} + \int_0^1 f(t) dt";

    // 两次独立解析相同公式，槽位表拓扑与 ID 必须严格一致
    let (s1, _) = Session::from_latex(latex);
    let (s2, _) = Session::from_latex(latex);

    let slots1 = s1.doc().slots.slots();
    let slots2 = s2.doc().slots.slots();

    assert_eq!(slots1.len(), slots2.len());
    for (a, b) in slots1.iter().zip(slots2.iter()) {
        assert_eq!(a.id, b.id);
        assert_eq!(a.role, b.role);
        assert_eq!(a.path, b.path);
        assert_eq!(a.is_empty, b.is_empty);
    }
}

/// Criterion 7: 根除文本内嵌控制符（无 ▸j、▸f 泄漏）
#[test]
fn test_criterion_07_eradicate_inband_control_characters() {
    let inputs = [r"▸f", r"▸r", r"▸s", r"▸i", r"▸l", r"a + ▸f + b"];

    for input in inputs {
        let (session, _) = Session::from_latex(input);
        let output = session.to_latex();

        assert!(
            !output.contains("▸j"),
            "Criterion 7 failed: found leaked '▸j' in output: '{output}'"
        );
        assert!(
            !output.contains("▸f"),
            "Criterion 7 failed: found leaked '▸f' in output: '{output}'"
        );
        assert!(
            !output.contains("▸r"),
            "Criterion 7 failed: found leaked '▸r' in output: '{output}'"
        );
    }
}

/// Criterion 8: 核心运算延迟性能指标（按键 < 16ms）
#[test]
fn test_criterion_08_latency_performance_benchmarks() {
    let latex = r"\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}";

    // 1. Session::from_latex 解析性能
    let start = Instant::now();
    for _ in 0..100 {
        let _ = Session::from_latex(latex);
    }
    let elapsed = start.elapsed();
    let avg_parse_us = elapsed.as_micros() / 100;
    println!("Session::from_latex average latency: {} µs", avg_parse_us);
    assert!(
        avg_parse_us < 16_000,
        "Criterion 8 failed: avg parse latency {avg_parse_us} µs exceeded 16ms"
    );

    // 2. Session::insert_text 单键操作性能
    let mut session = Session::new();
    let start = Instant::now();
    for i in 0..100 {
        let ch = ((b'a' + (i % 26) as u8) as char).to_string();
        session.insert_text(&ch).unwrap();
    }
    let elapsed = start.elapsed();
    let avg_insert_us = elapsed.as_micros() / 100;
    println!("Session::insert_text average latency: {} µs", avg_insert_us);
    assert!(
        avg_insert_us < 16_000,
        "Criterion 8 failed: avg insert latency {avg_insert_us} µs exceeded 16ms"
    );

    // 3. Session::undo 单步撤销性能
    let start = Instant::now();
    let mut undo_count = 0;
    while session.undo() {
        undo_count += 1;
    }
    let elapsed = start.elapsed();
    if undo_count > 0 {
        let avg_undo_us = elapsed.as_micros() / undo_count as u128;
        println!("Session::undo average latency: {} µs", avg_undo_us);
        assert!(
            avg_undo_us < 16_000,
            "Criterion 8 failed: avg undo latency {avg_undo_us} µs exceeded 16ms"
        );
    }
}

/// Criterion 9: 黄金语料库 GT-01 ~ GT-08 全量无损往返
#[test]
fn test_criterion_09_golden_corpus_and_property_suite() {
    let golden_cases = [
        (
            "GT-01",
            r"\int_{-\infty}^{\infty} {e}^{-x^{2}} \mathrm{d}x = \sqrt{\pi}",
            true,
        ),
        ("GT-02", r"x^{a+b} + a_{i+1}", true),
        ("GT-03", r"e^{-\frac{x}{2}}", true),
        ("GT-04", r"\sum_{i=1}^{n} \left( a_{i} \right)", true),
        ("GT-05", r"\int_{a}^{b} \left( f(x) \right) dx", true),
        (
            "GT-06",
            r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
            true,
        ),
        (
            "GT-07",
            r"\begin{bmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \end{bmatrix}",
            true,
        ),
        ("GT-08", r"\xygraph{a -> b}", false), // 未知宏，降级为 RawLatex
    ];

    for (name, case, expected_lossless) in golden_cases {
        let (session, report) = Session::from_latex(case);
        if expected_lossless {
            assert!(
                report.lossless,
                "Case {name} failed: expected lossless, got: {report:?}"
            );
            assert_eq!(report.raw_nodes, 0, "Case {name} had raw nodes");

            let exported = session.to_latex();
            let (ast1, _) = parse(case);
            let (ast2, _) = parse(&exported);
            assert!(
                exprs_structurally_equal(&ast1, &ast2),
                "Case {name} failed: AST roundtrip mismatch"
            );
        } else {
            assert!(!report.lossless, "Case {name} should be lossy");
            assert!(report.raw_nodes >= 1, "Case {name} should have raw nodes");
        }
    }
}

/// Criterion 10: 旧版本公式容错与平滑升级（无花括号简写 `x^2`, `a_1`, `\frac12`）
#[test]
fn test_criterion_10_legacy_syntax_and_shorthand_tolerance() {
    let shorthand_cases = [
        ("x^2", "x^{2}"),
        ("a_1", "a_{1}"),
        (r"\frac12", r"\frac{1}{2}"),
        (r"\frac123", r"\frac{1}{2}3"),
        (r"\frac\alpha\beta", r"\frac{\alpha}{\beta}"),
        (r"\frac{1}2", r"\frac{1}{2}"),
        (r"\frac1{2}", r"\frac{1}{2}"),
        ("e^-x", "e^{-x}"),
    ];

    for (input, expected_normalized) in shorthand_cases {
        let (formatted, diagnostics) = format_latex(input);
        assert!(
            diagnostics.is_empty(),
            "Legacy input '{input}' should parse without fatal diagnostics: {:?}",
            diagnostics
        );
        assert_eq!(
            formatted, expected_normalized,
            "Legacy input '{input}' normalization failed"
        );
    }
}

// ============================================================================
// Dimension B: Auditor 白盒风险点靶向破坏测试 (Targeted Verification)
// ============================================================================

/// TC-VULN-01: 深层嵌套占位符替换 (Auditor Finding 1 专项验证)
/// 场景：在带占位符的结构（如 \frac{▸}{2} 或 \frac{▸}{▸}）中定位到 Placeholder 槽位并执行替换/打字
/// 预期：若代码在 mutate_expr_slot 入口未放行 path.is_empty() 的 Placeholder，将抛出 InvalidPath
#[test]
fn test_tc_vuln_01_nested_placeholder_replacement() {
    // 构造分式内嵌占位符公式
    let input = r"\frac{▸}{2}";
    let (mut session, report) = Session::from_latex(input);
    println!("Loaded '{input}': report = {:?}", report);

    // 查找文档中角色为 Placeholder 的槽位
    let placeholder_slot = session
        .doc()
        .slots
        .slots()
        .iter()
        .find(|s| s.role == SlotRole::Placeholder);

    assert!(
        placeholder_slot.is_some(),
        "TC-VULN-01 setup failure: expected at least one Placeholder slot"
    );
    let placeholder_slot = placeholder_slot.unwrap();
    let slot_id = placeholder_slot.id;
    let slot_path = placeholder_slot.path.clone();
    println!(
        "Targeting Placeholder Slot: id={:?}, path={:?}",
        slot_id, slot_path
    );

    // 1. 测试直接通过 ReplaceSlot 替换该 Placeholder 槽位
    let (replacement_nodes, _) = parse("123");
    let edit_result = session.apply_edit(
        Edit::ReplaceSlot {
            slot_id,
            new_nodes: replacement_nodes,
        },
        "replace placeholder",
    );

    // 核心断言：验证是否触发了 Auditor Finding 1 报告的 DocError::InvalidPath
    match &edit_result {
        Ok(_) => {
            println!(
                "TC-VULN-01: ReplaceSlot succeeded! Output: {}",
                session.to_latex()
            );
            assert!(
                session.to_latex().contains("123"),
                "Output must contain replaced text"
            );
        }
        Err(DocError::InvalidPath(_p)) => {
            panic!(
                "TC-VULN-01 DEFECT CONFIRMED (Auditor Finding 1)! mutate_expr_slot rejected path {:?} with DocError::InvalidPath! Detailed error: {:?}",
                slot_path, edit_result
            );
        }
        Err(e) => {
            panic!("TC-VULN-01 failed with unexpected DocError: {:?}", e);
        }
    }

    // 2. 测试在 Placeholder 槽位中直接调用 insert_text
    let (mut session2, _) = Session::from_latex(r"\frac{▸}{5}");
    let ph_slot = session2
        .doc()
        .slots
        .slots()
        .iter()
        .find(|s| s.role == SlotRole::Placeholder)
        .expect("must have placeholder");
    let ph_id = ph_slot.id;

    session2.set_cursor(Cursor::InSlot {
        slot_id: ph_id,
        offset: 0,
    });
    let text_result = session2.insert_text("99");
    assert!(
        text_result.is_ok(),
        "TC-VULN-01 DEFECT CONFIRMED: insert_text at Placeholder slot failed: {:?}",
        text_result
    );

    // 3. 测试矩阵内部的 Placeholder 槽位替换
    let (mut session3, _) = Session::from_latex(r"\begin{pmatrix} ▸ & 1 \\ 2 & 3 \end{pmatrix}");
    let matrix_ph = session3
        .doc()
        .slots
        .slots()
        .iter()
        .find(|s| s.role == SlotRole::Placeholder)
        .expect("must have placeholder in matrix");
    let m_ph_id = matrix_ph.id;
    let m_res = session3.apply_edit(
        Edit::ReplaceSlot {
            slot_id: m_ph_id,
            new_nodes: parse("77").0,
        },
        "replace matrix cell placeholder",
    );
    assert!(
        m_res.is_ok(),
        "TC-VULN-01 DEFECT CONFIRMED: replace matrix cell placeholder failed: {:?}",
        m_res
    );

    // 4. 测试根号内部的 Placeholder 槽位替换
    let (mut session4, _) = Session::from_latex(r"\sqrt{▸}");
    let root_ph = session4
        .doc()
        .slots
        .slots()
        .iter()
        .find(|s| s.role == SlotRole::Placeholder)
        .expect("must have placeholder in root");
    let r_ph_id = root_ph.id;
    let r_res = session4.apply_edit(
        Edit::ReplaceSlot {
            slot_id: r_ph_id,
            new_nodes: parse("x+1").0,
        },
        "replace root radicand placeholder",
    );
    assert!(
        r_res.is_ok(),
        "TC-VULN-01 DEFECT CONFIRMED: replace root placeholder failed: {:?}",
        r_res
    );

    // 5. 测试多节点复合表达式替换与 Group 安全包裹及撤销/重做一致性
    let (mut session5, _) = Session::from_latex(r"\frac{▸}{2}");
    let ph5 = session5
        .doc()
        .slots
        .slots()
        .iter()
        .find(|s| s.role == SlotRole::Placeholder)
        .expect("must have placeholder")
        .id;
    let multi_res = session5.apply_edit(
        Edit::ReplaceSlot {
            slot_id: ph5,
            new_nodes: parse("x+y+z").0,
        },
        "replace placeholder with multinode expr",
    );
    assert!(multi_res.is_ok());
    let multi_latex = session5.to_latex();
    assert_eq!(multi_latex, r"\frac{x+y+z}{2}");
    assert!(
        session5.undo(),
        "Must be able to undo multinode placeholder replacement"
    );
    assert_eq!(session5.to_latex(), r"\frac{{}}{2}");
    assert!(
        session5.redo(),
        "Must be able to redo multinode placeholder replacement"
    );
    assert_eq!(session5.to_latex(), r"\frac{x+y+z}{2}");
}

/// TC-VULN-02: 槽位重复注册与 Tab 双重停顿 (Auditor Finding 2 专项验证)
/// 场景：对于空分式 \frac{}{} 或带占位符的 \frac{▸}{▸}，断言视觉槽位是否被重复注册
#[test]
fn test_tc_vuln_02_slot_duplicate_registration() {
    // 场景 A: \frac{▸}{▸}
    let input = r"\frac{▸}{▸}";
    let (mut session, _) = Session::from_latex(input);
    let slots_snapshot: Vec<_> = session.doc().slots.slots().to_vec();

    println!("Slots for '{}':", input);
    for s in &slots_snapshot {
        println!("  - id={:?}, role={:?}, path={:?}", s.id, s.role, s.path);
    }

    // 分子视觉上只有 1 个输入点，分母只有 1 个输入点
    // 若 Numerator 和内部 Placeholder 都注册为 Slot，slots.len() 会变成 4
    let numerator_related_slots = slots_snapshot
        .iter()
        .filter(|s| {
            s.role == SlotRole::Numerator
                || (s.role == SlotRole::Placeholder && s.path.as_slice().starts_with(&[0, 0]))
        })
        .count();

    println!("Numerator-related slots: {}", numerator_related_slots);
    assert_eq!(
        numerator_related_slots, 1,
        "TC-VULN-02 DEFECT CONFIRMED (Auditor Finding 2): Numerator slot registered twice (parent Numerator and child Placeholder both registered)!"
    );

    // 场景 B: 连续按 Tab 键，断言是否在相同视觉位置重复停顿
    let first_slot_id = slots_snapshot[0].id;
    let first_target_path = slots_snapshot[0].path.clone();

    session.set_cursor(Cursor::InSlot {
        slot_id: first_slot_id,
        offset: 0,
    });

    assert!(session.tab_next_slot(), "Tab next must succeed");
    if let Cursor::InSlot { slot_id, .. } = session.cursor() {
        let second_slot = session.doc().slots.get(*slot_id).unwrap();
        // 如果 Tab 后停留在同一个树分支（如 [0, 0] 变 [0, 0, 0]），说明发生了双重停顿！
        assert!(
            !second_slot
                .path
                .as_slice()
                .starts_with(first_target_path.as_slice())
                && !first_target_path
                    .as_slice()
                    .starts_with(second_slot.path.as_slice()),
            "TC-VULN-02 DEFECT CONFIRMED: Tab stopped on the same visual slot twice! Path 1: {:?}, Path 2: {:?}",
            first_target_path,
            second_slot.path
        );
    }
}

/// TC-VULN-03: 空定界符与求值竖线保真度专项验证
#[test]
fn test_tc_vuln_03_null_delimiter_evaluation_bar() {
    let latex = r"\left. \frac{\mathrm{d}y}{\mathrm{d}x} \right|_{x=0}";
    let (session, report) = Session::from_latex(latex);

    assert!(
        report.lossless,
        "TC-VULN-03: Evaluation bar must be lossless, got: {report:?}"
    );

    let doc = session.doc();
    assert!(!doc.nodes.is_empty());

    // 顶层应为 Expr::Script，base 为 Expr::Delimited
    match &doc.nodes[0].node {
        Expr::Script { base, sub, sup } => {
            assert!(sub.is_some(), "Must have subscript _{{x=0}}");
            assert!(sup.is_none(), "Must not have superscript");

            match &base.node {
                Expr::Delimited {
                    open,
                    close,
                    auto_scale,
                    ..
                } => {
                    assert_eq!(
                        open,
                        &Delim::Empty,
                        "Open delim must be Delim::Empty (left.)"
                    );
                    assert_eq!(
                        close,
                        &Delim::Pipe,
                        "Close delim must be Delim::Pipe (right|)"
                    );
                    assert!(auto_scale, "Delimited must be auto_scale");
                }
                other => panic!("Expected Expr::Delimited inside base, got {:?}", other),
            }
        }
        Expr::Delimited { open, close, .. } => {
            assert_eq!(open, &Delim::Empty);
            assert_eq!(close, &Delim::Pipe);
        }
        other => panic!("Expected Script or Delimited, got {:?}", other),
    }

    // 验证往返输出精确包含 \left. 与 \right|
    let output = session.to_latex();
    assert!(
        output.contains(r"\left."),
        "TC-VULN-03 failed: output missing '\\left.', got: '{output}'"
    );
    assert!(
        output.contains(r"\right|"),
        "TC-VULN-03 failed: output missing '\\right|', got: '{output}'"
    );
}

/// TC-VULN-04: 极限多层嵌套与畸形输入防崩溃压力测试
#[test]
fn test_tc_vuln_04_extreme_nesting_and_malformed_tolerance() {
    // 1. 15 层极限上下标嵌套
    let extreme_sup = "x^{a^{b^{c^{d^{e^{f^{g^{h^{i^{j^{k^{l^{m^{n^{o}}}}}}}}}}}}}}}";
    let (session1, report1) = Session::from_latex(extreme_sup);
    assert!(
        report1.lossless,
        "15-level superscript should parse losslessly"
    );
    let output1 = session1.to_latex();
    assert!(output1.contains("x^{a^{b^{c^{d^{e^{f^{g^{h^{i^{j^{k^{l^{m^{n^{o}}}}}}}}}}}}}}}"));

    // 2. 5 层连续分式嵌套
    let extreme_frac = r"\frac{1}{\frac{2}{\frac{3}{\frac{4}{5}}}}";
    let (session2, report2) = Session::from_latex(extreme_frac);
    assert!(report2.lossless, "5-level fraction should parse losslessly");
    assert_eq!(session2.to_latex(), extreme_frac);

    // 3. 畸形未闭合定界符：严禁 Panic，优雅降级
    let malformed_delim = r"\left( x + y";
    let (session3, report3) = Session::from_latex(malformed_delim);
    assert!(
        !report3.diagnostics.is_empty(),
        "Should report unclosed delimiter"
    );
    // 必须成功降级输出，绝不能 panic
    let _ = session3.to_latex();

    // 4. 畸形未闭合花括号
    let malformed_brace = "{ a + b";
    let (session4, report4) = Session::from_latex(malformed_brace);
    assert!(
        !report4.diagnostics.is_empty(),
        "Should report unclosed brace"
    );
    let _ = session4.to_latex();

    // 5. 矩阵环境首尾不匹配
    let mismatched_env = r"\begin{pmatrix} 1 & 2 \\ 3 \end{matrix}";
    let (session5, report5) = Session::from_latex(mismatched_env);
    assert!(!report5.lossless, "Mismatched env should be lossy");
    assert!(
        !report5.diagnostics.is_empty(),
        "Should report mismatched environment"
    );
    let _ = session5.to_latex();

    // 6. 畸形分数缺失分母
    let malformed_frac = r"\frac{1}";
    let (session6, _report6) = Session::from_latex(malformed_frac);
    let _ = session6.to_latex();
}

// ============================================================================
// Dimension C: 事务可逆性与高频并发压力测试
// ============================================================================

/// 高频连续编辑、穿梭与深度撤销/重做压力测试
#[test]
fn test_transaction_stress_undo_redo_loop() {
    let mut session = Session::new();

    // 初始状态
    assert_eq!(session.to_latex(), "");

    // 1. 连续输入 60 次单字符
    for c in 'a'..='z' {
        session.insert_text(&c.to_string()).unwrap();
    }
    for c in '0'..='9' {
        session.insert_text(&c.to_string()).unwrap();
    }
    let state_after_typing = session.to_latex();
    assert!(!state_after_typing.is_empty());

    // 2. 插入结构化槽位（如加载新分式）
    let report = session.load_latex(r"\frac{1}{2} + \sqrt{3}");
    assert!(report.lossless);
    let state_after_formula = session.to_latex();
    assert_eq!(state_after_formula, r"\frac{1}{2}+\sqrt{3}");

    // 3. 在槽位内打字
    session.tab_next_slot();
    session.insert_text("+99").unwrap();
    let state_after_edit = session.to_latex();
    assert!(state_after_edit.contains("99"));

    // 4. 连续撤销
    let mut undo_steps = 0;
    while session.undo() {
        undo_steps += 1;
    }
    assert!(undo_steps >= 1, "Must perform at least 1 undo");
    // 最终回滚到初始或 load_latex 初始状态
    let reverted_latex = session.to_latex();
    println!(
        "Reverted state after {} undos: '{}'",
        undo_steps, reverted_latex
    );

    // 5. 连续重做
    let mut redo_steps = 0;
    while session.redo() {
        redo_steps += 1;
    }
    assert_eq!(
        undo_steps, redo_steps,
        "Undo steps ({undo_steps}) must equal Redo steps ({redo_steps})"
    );
    assert_eq!(
        session.to_latex(),
        state_after_edit,
        "Redo to the end must restore the exact same AST state"
    );
}

/// 连续交互深度事务回环压力测试（无 load_latex 重置，纯 Editor 事务链）
#[test]
fn test_deep_editor_transaction_undo_redo_chain() {
    let (mut session, _) = Session::from_latex(r"\frac{a}{b}");
    let initial_latex = session.to_latex();
    assert_eq!(initial_latex, r"\frac{a}{b}");

    // 槽位 1：Numerator，替换为 x
    let num_id = session
        .doc()
        .slots
        .slots()
        .iter()
        .find(|s| s.role == SlotRole::Numerator)
        .unwrap()
        .id;
    session
        .apply_edit(
            Edit::ReplaceSlot {
                slot_id: num_id,
                new_nodes: parse("x").0,
            },
            "step 1",
        )
        .unwrap();
    assert_eq!(session.to_latex(), r"\frac{x}{b}");

    // 槽位 2：Denominator，清空
    let den_id = session
        .doc()
        .slots
        .slots()
        .iter()
        .find(|s| s.role == SlotRole::Denominator)
        .unwrap()
        .id;
    session
        .apply_edit(Edit::ClearSlot { slot_id: den_id }, "step 2")
        .unwrap();
    assert_eq!(session.to_latex(), r"\frac{x}{}");

    // 槽位 2：Denominator，替换为 y + z
    session
        .apply_edit(
            Edit::ReplaceSlot {
                slot_id: den_id,
                new_nodes: parse("y+z").0,
            },
            "step 3",
        )
        .unwrap();
    assert_eq!(session.to_latex(), r"\frac{x}{y+z}");

    // 验证撤销栈深度为 3
    assert_eq!(session.editor().history().undo_len(), 3);

    // 单步回滚 Step 3 -> 回到 step 2 (\frac{x}{})
    assert!(session.undo());
    assert_eq!(session.to_latex(), r"\frac{x}{}");

    // 单步回滚 Step 2 -> 回到 step 1 (\frac{x}{b})
    assert!(session.undo());
    assert_eq!(session.to_latex(), r"\frac{x}{b}");

    // 单步回滚 Step 1 -> 回到初始状态 (\frac{a}{b})
    assert!(session.undo());
    assert_eq!(session.to_latex(), initial_latex);

    // 已经回滚到底，再次撤销应返回 false
    assert!(!session.undo());

    // 正向重做到底
    assert!(session.redo()); // Step 1
    assert_eq!(session.to_latex(), r"\frac{x}{b}");

    assert!(session.redo()); // Step 2
    assert_eq!(session.to_latex(), r"\frac{x}{}");

    assert!(session.redo()); // Step 3
    assert_eq!(session.to_latex(), r"\frac{x}{y+z}");

    // 已经重做到底，再次重做应返回 false
    assert!(!session.redo());
}

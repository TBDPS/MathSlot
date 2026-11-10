use mathslot_core::{Cursor, Session, verify_roundtrip};

#[test]
fn test_session_transaction_undo_redo() {
    let mut session = Session::new();

    // 初始状态
    assert_eq!(session.to_latex(), "");

    // 插入文本
    session.insert_text("x").unwrap();
    assert_eq!(session.to_latex(), "x");

    // 再次插入
    session.insert_text("+").unwrap();
    session.insert_text("y").unwrap();
    let curr = session.to_latex();
    assert!(curr.contains("x") && curr.contains("y"));

    // 执行撤销
    assert!(session.undo());
    // 撤销到初始
    while session.undo() {}
    assert!(session.to_latex().is_empty() || session.doc().nodes.is_empty());

    // 执行重做
    assert!(session.redo());
    assert!(!session.to_latex().is_empty());
}

#[test]
fn test_session_slot_navigation() {
    let (mut session, _) = Session::from_latex(r"\frac{1}{2} + \sqrt{x}");

    // 检查初始槽位
    let slots = session.doc().slots.slots();
    assert!(
        slots.len() >= 3,
        "Expected at least numerator, denominator, radicand"
    );

    // Tab 键槽位穿梭
    let initial_cursor = session.cursor().clone();
    assert!(session.tab_next_slot());
    assert_ne!(&initial_cursor, session.cursor());

    // 循环切换
    let mut visited = Vec::new();
    for _ in 0..10 {
        if let Cursor::InSlot { slot_id, .. } = session.cursor() {
            visited.push(*slot_id);
        }
        session.tab_next_slot();
    }
    assert!(visited.len() >= 10);
}

#[test]
fn test_session_import_report() {
    let (session, report) = Session::from_latex(r"\frac{a+b}{c-d}");

    assert!(report.lossless);
    assert_eq!(report.raw_nodes, 0);
    assert_eq!(report.empty_slots, 0);
    assert!(report.diagnostics.is_empty());
    assert_eq!(session.last_report().unwrap(), &report);

    // 加载带有未识别宏的公式
    let mut session2 = Session::new();
    let report2 = session2.load_latex(r"\foobar{test}");
    assert!(!report2.lossless);
    assert_eq!(report2.raw_nodes, 1);
    assert!(report2.has_warnings());
}

#[test]
fn test_session_golden_roundtrip() {
    let golden_cases = [
        (
            "GT-01",
            r"\int_{-\infty}^{\infty} {e}^{-x^{2}} \mathrm{d}x = \sqrt{\pi}",
        ),
        ("GT-02", r"x^{a+b} + a_{i+1}"),
        ("GT-03", r"e^{-\frac{x}{2}}"),
        ("GT-04", r"\sum_{i=1}^{n} \left( a_{i} \right)"),
        ("GT-05", r"\int_{a}^{b} \left( f(x) \right) dx"),
        ("GT-06", r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}"),
        (
            "GT-07",
            r"\begin{bmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \end{bmatrix}",
        ),
        ("GT-08", r"\xygraph{a -> b}"),
    ];

    for (name, case) in golden_cases {
        let (session, report) = Session::from_latex(case);

        if name == "GT-08" {
            // GT-08 为未知宏，安全降级为 RawLatex，包含 warning
            assert!(!report.lossless, "GT-08 should degrade to RawLatex");
            assert_eq!(report.raw_nodes, 1);
            assert!(report.has_warnings());
            assert_eq!(session.to_latex(), case);
        } else {
            // GT-01 ~ GT-07 应 100% 无损
            assert!(
                report.lossless,
                "Case {name} should be lossless, got report: {report:?}"
            );
            assert_eq!(report.raw_nodes, 0, "Case {name} should have 0 raw nodes");
            assert!(
                verify_roundtrip(case).is_ok(),
                "Case {name} roundtrip verification failed"
            );
        }
    }
}

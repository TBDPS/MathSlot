use mathslot_doc::{Cursor, Document, Edit, Editor, SlotRole};
use mathslot_syntax::parse;

#[test]
fn test_slot_table_extraction() {
    let input = r"\frac{a}{b} + \sqrt{x} + \int_0^1 f(t) dt";
    let (doc, _) = Document::from_latex(input);

    let slots = doc.slots.slots();
    assert!(
        slots.len() >= 6,
        "Expected at least 6 slots, got {}",
        slots.len()
    );

    assert!(slots.iter().any(|s| s.role == SlotRole::Numerator));
    assert!(slots.iter().any(|s| s.role == SlotRole::Denominator));
    assert!(slots.iter().any(|s| s.role == SlotRole::Radicand));
    assert!(slots.iter().any(|s| s.role == SlotRole::LowerBound));
    assert!(slots.iter().any(|s| s.role == SlotRole::UpperBound));
    assert!(slots.iter().any(|s| s.role == SlotRole::BigOpBody));
}

#[test]
fn test_editor_tab_navigation() {
    let input = r"\frac{}{}";
    let (doc, _) = Document::from_latex(input);
    let mut editor = Editor::new(doc);

    // 初始光标在分子槽位
    let slot1_id = match editor.cursor() {
        Cursor::InSlot { slot_id, .. } => *slot_id,
        other => panic!("Expected InSlot cursor, got {:?}", other),
    };

    // Tab 跳转到分母槽位
    assert!(editor.tab_next_slot());
    let slot2_id = match editor.cursor() {
        Cursor::InSlot { slot_id, .. } => *slot_id,
        other => panic!("Expected InSlot cursor, got {:?}", other),
    };
    assert_ne!(slot1_id, slot2_id);

    // 再次 Tab 循环回到分子槽位
    assert!(editor.tab_next_slot());
    if let Cursor::InSlot { slot_id, .. } = editor.cursor() {
        assert_eq!(*slot_id, slot1_id);
    } else {
        panic!("Expected InSlot cursor");
    }

    // Shift-Tab 回到分母槽位
    assert!(editor.tab_prev_slot());
    if let Cursor::InSlot { slot_id, .. } = editor.cursor() {
        assert_eq!(*slot_id, slot2_id);
    } else {
        panic!("Expected InSlot cursor");
    }
}

#[test]
fn test_slot_replacement_and_undo() {
    let input = r"\frac{a}{b}";
    let (doc, _) = Document::from_latex(input);
    let mut editor = Editor::new(doc);

    let num_slot_id = editor
        .doc()
        .slots
        .slots()
        .iter()
        .find(|s| s.role == SlotRole::Numerator)
        .map(|s| s.id)
        .expect("Must have numerator slot");

    // 替换分子为 c + d
    let (new_nodes, _) = parse("c+d");
    editor
        .apply(
            Edit::ReplaceSlot {
                slot_id: num_slot_id,
                new_nodes,
            },
            "replace numerator",
        )
        .unwrap();

    let latex = editor.doc().to_latex();
    assert!(latex.contains("c+d") || latex.contains("c + d"));
    assert!(latex.contains('b'));

    // 撤销替换
    assert!(editor.undo());
    let reverted_latex = editor.doc().to_latex();
    assert!(reverted_latex.contains('a'));
    assert!(reverted_latex.contains('b'));

    // 重做替换
    assert!(editor.redo());
    let redone_latex = editor.doc().to_latex();
    assert!(redone_latex.contains("c+d") || redone_latex.contains("c + d"));
}

#[test]
fn test_slot_clear_and_undo() {
    let input = r"\frac{a}{b}";
    let (doc, _) = Document::from_latex(input);
    let mut editor = Editor::new(doc);

    let den_slot_id = editor
        .doc()
        .slots
        .slots()
        .iter()
        .find(|s| s.role == SlotRole::Denominator)
        .map(|s| s.id)
        .expect("Must have denominator slot");

    // 清空分母
    editor
        .apply(
            Edit::ClearSlot {
                slot_id: den_slot_id,
            },
            "clear denominator",
        )
        .unwrap();

    let latex = editor.doc().to_latex();
    assert_eq!(latex, r"\frac{a}{}");

    // 撤销
    assert!(editor.undo());
    assert_eq!(editor.doc().to_latex(), r"\frac{a}{b}");
}

#[test]
fn test_input_coalescing() {
    let mut editor = Editor::new(Document::new());

    // 第一次打字
    editor
        .apply(
            Edit::InsertText {
                at: Cursor::AtEnd,
                text: "x".to_string(),
            },
            "typing",
        )
        .unwrap();

    // 第二次连续打字
    editor
        .apply(
            Edit::InsertText {
                at: Cursor::AtEnd,
                text: "y".to_string(),
            },
            "typing",
        )
        .unwrap();

    // 验证连续输入防抖合并
    assert_eq!(
        editor.history().undo_len(),
        1,
        "Edits should coalesce into 1 transaction"
    );
    assert!(editor.doc().to_latex().contains("xy") || editor.doc().to_latex().contains("x y"));

    // 一次撤销即可完全回滚
    assert!(editor.undo());
    assert!(editor.doc().nodes.is_empty() || editor.doc().to_latex().is_empty());
}

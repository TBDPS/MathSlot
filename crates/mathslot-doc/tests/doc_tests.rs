use mathslot_doc::{Cursor, Document, Edit, Editor, SlotRole};
use mathslot_syntax::{Expr, SlotId, Span, Spanned, parse};

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

#[test]
fn test_nested_placeholder_slot_collapse_boundaries() {
    let make_doc = || {
        Document::from_nodes(vec![Spanned::new(
            Expr::Group(vec![Spanned::new(
                Expr::Placeholder {
                    slot_id: SlotId(0),
                    label: None,
                },
                Span::point(0),
            )]),
            Span::point(0),
        )])
    };

    // 1. 空替换保留占位符不塌陷
    let mut doc_empty = make_doc();
    let ph_id = doc_empty.slots.slots()[0].id;
    doc_empty
        .replace_slot(ph_id, Vec::new())
        .expect("empty replacement on nested placeholder must succeed");
    match &doc_empty.nodes[0].node {
        Expr::Group(items) => assert!(
            matches!(
                items.as_slice(),
                [Spanned {
                    node: Expr::Placeholder { .. },
                    ..
                }]
            ),
            "Empty replacement must keep placeholder, got: {items:?}"
        ),
        other => panic!("Expected Group root, got: {other:?}"),
    }
    assert_eq!(doc_empty.slots.slots().len(), 1);
    assert_eq!(doc_empty.slots.slots()[0].role, SlotRole::Placeholder);

    // 2. 单节点替换直接就地解包，不额外包裹 Group
    let mut doc_single = make_doc();
    let ph_id = doc_single.slots.slots()[0].id;
    let (single_nodes, _) = parse("z");
    assert_eq!(single_nodes.len(), 1);
    doc_single
        .replace_slot(ph_id, single_nodes)
        .expect("single-node replacement on nested placeholder must succeed");
    match &doc_single.nodes[0].node {
        Expr::Group(items) => {
            assert_eq!(items.len(), 1);
            assert!(
                !matches!(items[0].node, Expr::Group(_)),
                "Single-node replacement must unwrap directly instead of wrapping in Group: {:?}",
                items[0]
            );
        }
        other => panic!("Expected Group root, got: {other:?}"),
    }
    assert_eq!(doc_single.to_latex(), "{z}");

    // 3. 多节点替换安全包裹为 Group，不丢失后续节点
    let mut doc_multi = make_doc();
    let ph_id = doc_multi.slots.slots()[0].id;
    let (multi_nodes, _) = parse("c+d");
    assert!(multi_nodes.len() > 1);
    doc_multi
        .replace_slot(ph_id, multi_nodes)
        .expect("multi-node replacement on nested placeholder must succeed");
    match &doc_multi.nodes[0].node {
        Expr::Group(items) => assert!(
            matches!(items.as_slice(), [Spanned { node: Expr::Group(inner), .. }] if inner.len() > 1),
            "Multi-node replacement must wrap in Group, got: {items:?}"
        ),
        other => panic!("Expected Group root, got: {other:?}"),
    }
    let latex = doc_multi.to_latex();
    assert!(
        latex.contains('c') && latex.contains('+') && latex.contains('d'),
        "got: {latex}"
    );
}

#[test]
fn test_script_sub_and_sup_slot_collapse_boundaries() {
    let find_slot = |doc: &Document, role: SlotRole| {
        doc.slots
            .slots()
            .iter()
            .find(|s| s.role == role)
            .map(|s| s.id)
            .expect("Must find script slot")
    };

    // 1. 单节点替换下标与上标：直接解包，不额外包裹 Group
    let (mut doc, _) = Document::from_latex("x_a^b");
    let sub_id = find_slot(&doc, SlotRole::Subscript);
    let (single_sub, _) = parse("m");
    assert_eq!(single_sub.len(), 1);
    doc.replace_slot(sub_id, single_sub)
        .expect("single-node subscript replacement must succeed");

    let sup_id = find_slot(&doc, SlotRole::Superscript);
    let (single_sup, _) = parse("n");
    assert_eq!(single_sup.len(), 1);
    doc.replace_slot(sup_id, single_sup)
        .expect("single-node superscript replacement must succeed");

    match &doc.nodes[0].node {
        Expr::Script {
            sub: Some(sub_box),
            sup: Some(sup_box),
            ..
        } => {
            assert!(
                !matches!(sub_box.node, Expr::Group(_)),
                "Single-node subscript must unwrap directly, got: {:?}",
                sub_box.node
            );
            assert!(
                !matches!(sup_box.node, Expr::Group(_)),
                "Single-node superscript must unwrap directly, got: {:?}",
                sup_box.node
            );
        }
        other => panic!("Expected Script node, got: {other:?}"),
    }
    assert_eq!(doc.to_latex(), "x_{m}^{n}");

    // 2. 多节点替换下标与上标：安全包裹为 Group
    let sub_id = find_slot(&doc, SlotRole::Subscript);
    let (multi_sub, _) = parse("p+q");
    assert!(multi_sub.len() > 1);
    doc.replace_slot(sub_id, multi_sub)
        .expect("multi-node subscript replacement must succeed");

    let sup_id = find_slot(&doc, SlotRole::Superscript);
    let (multi_sup, _) = parse("u+v");
    assert!(multi_sup.len() > 1);
    doc.replace_slot(sup_id, multi_sup)
        .expect("multi-node superscript replacement must succeed");

    match &doc.nodes[0].node {
        Expr::Script {
            sub: Some(sub_box),
            sup: Some(sup_box),
            ..
        } => {
            assert!(
                matches!(&sub_box.node, Expr::Group(items) if items.len() > 1),
                "Multi-node subscript must wrap in Group, got: {:?}",
                sub_box.node
            );
            assert!(
                matches!(&sup_box.node, Expr::Group(items) if items.len() > 1),
                "Multi-node superscript must wrap in Group, got: {:?}",
                sup_box.node
            );
        }
        other => panic!("Expected Script node, got: {other:?}"),
    }

    // 3. 空替换回退边界：非 Group 的单节点下标/上标清空后回退为空 Group
    let (mut doc_empty, _) = Document::from_latex("x_a^b");
    let sub_id = find_slot(&doc_empty, SlotRole::Subscript);
    doc_empty
        .replace_slot(sub_id, Vec::new())
        .expect("empty subscript replacement must succeed");

    let sup_id = find_slot(&doc_empty, SlotRole::Superscript);
    doc_empty
        .replace_slot(sup_id, Vec::new())
        .expect("empty superscript replacement must succeed");

    match &doc_empty.nodes[0].node {
        Expr::Script {
            sub: Some(sub_box),
            sup: Some(sup_box),
            ..
        } => {
            assert!(
                matches!(&sub_box.node, Expr::Group(items) if items.is_empty()),
                "Empty subscript replacement must fall back to empty Group, got: {:?}",
                sub_box.node
            );
            assert!(
                matches!(&sup_box.node, Expr::Group(items) if items.is_empty()),
                "Empty superscript replacement must fall back to empty Group, got: {:?}",
                sup_box.node
            );
        }
        other => panic!("Expected Script node, got: {other:?}"),
    }
    assert_eq!(doc_empty.to_latex(), "x_{}^{}");
}

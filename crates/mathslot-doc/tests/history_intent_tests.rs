use mathslot_doc::{Cursor, Document, Edit, Editor, History, Intent, Selection, Transaction};
use mathslot_syntax::SlotId;

#[test]
fn test_typing_coalesces_word_and_breaks_on_space() {
    // 1. 根级连续打字遇到空格断开，不插入破坏偏移的幽灵空白
    let mut editor = Editor::new(Document::new());
    for ch in ['a', 'b', ' ', 'c', 'd'] {
        editor.type_char(ch).expect("type_char must succeed");
    }

    assert_eq!(editor.to_latex(), "abcd");
    assert_eq!(editor.history().undo_depth(), 2);
    assert_eq!(
        editor.history().intents(),
        vec![Intent::Typing, Intent::Typing]
    );

    // 首次 undo 仅撤销后词 "cd"
    assert!(editor.undo());
    assert_eq!(editor.to_latex(), "ab");
    assert_eq!(editor.history().undo_depth(), 1);
    assert_eq!(editor.history().redo_depth(), 1);

    // 再次 undo 撤销前词 "ab"
    assert!(editor.undo());
    assert_eq!(editor.to_latex(), "");
    assert_eq!(editor.history().undo_depth(), 0);
    assert_eq!(editor.history().redo_depth(), 2);

    // 两次 redo 精确恢复
    assert!(editor.redo());
    assert_eq!(editor.to_latex(), "ab");
    assert!(editor.redo());
    assert_eq!(editor.to_latex(), "abcd");

    // 2. 槽位内打字遇到空格同样断开且保持精确偏移 (不产生偏移漂移)
    let (doc, _) = Document::from_latex(r"\frac{}{}");
    let mut slot_editor = Editor::new(doc);
    for ch in ['x', 'y', ' ', 'z', 'w'] {
        slot_editor
            .type_char(ch)
            .expect("type_char in slot must succeed");
    }

    assert_eq!(slot_editor.to_latex(), r"\frac{xyzw}{}");
    assert_eq!(
        slot_editor.cursor(),
        &Cursor::InSlot {
            slot_id: SlotId(1),
            offset: 4,
        },
        "Space must not insert phantom whitespace or drift slot offset"
    );
    assert_eq!(slot_editor.history().undo_depth(), 2);

    assert!(slot_editor.undo());
    assert_eq!(slot_editor.to_latex(), r"\frac{xy}{}");
    assert_eq!(
        slot_editor.cursor(),
        &Cursor::InSlot {
            slot_id: SlotId(1),
            offset: 2,
        }
    );

    assert!(slot_editor.redo());
    assert_eq!(slot_editor.to_latex(), r"\frac{xyzw}{}");
    assert_eq!(
        slot_editor.cursor(),
        &Cursor::InSlot {
            slot_id: SlotId(1),
            offset: 4,
        }
    );
}

#[test]
fn test_typing_breaks_on_command_paste_and_navigation_and_preserves_redo_order() {
    // 子场景 A：锁定 D-104（同槽左移插入再 undo/redo 必须保持文本顺序为 \frac{ba}{}）
    {
        let (doc, _) = Document::from_latex(r"\frac{}{}");
        let mut editor = Editor::new(doc);

        editor.type_char('a').expect("type 'a'");
        assert!(
            editor.nav_left(),
            "nav_left inside slot must move to offset 0"
        );
        assert_eq!(
            editor.cursor(),
            &Cursor::InSlot {
                slot_id: SlotId(1),
                offset: 0,
            }
        );
        editor.type_char('b').expect("type 'b'");

        assert_eq!(editor.to_latex(), r"\frac{ba}{}");
        assert_eq!(
            editor.history().undo_depth(),
            2,
            "D-104: typing after nav_left in same slot must NOT coalesce"
        );
        assert_eq!(
            editor.history().intents(),
            vec![Intent::Typing, Intent::Typing]
        );

        assert!(editor.undo());
        assert_eq!(editor.to_latex(), r"\frac{a}{}");
        assert!(editor.undo());
        assert_eq!(editor.to_latex(), r"\frac{}{}");

        assert!(editor.redo());
        assert_eq!(editor.to_latex(), r"\frac{a}{}");
        assert!(editor.redo());
        assert_eq!(
            editor.to_latex(),
            r"\frac{ba}{}",
            "D-104: redo after left-shifted insert must strictly restore \\frac{{ba}}{{}}"
        );
    }

    // 子场景 B：Nav 模式往返与同位置左右往返必须断组
    {
        let (doc, _) = Document::from_latex(r"\frac{}{}");
        let mut editor = Editor::new(doc);

        editor.type_char('a').expect("type 'a'");
        editor.type_char('b').expect("type 'b'");
        editor.enter_nav_mode();
        editor.type_char('j').expect("nav 'j'");
        editor.type_char('k').expect("nav 'k'");
        editor.exit_nav_mode();
        // 即使右移回到原 offset=2，也因经历过导航而断组
        assert!(editor.nav_right());
        assert!(editor.nav_right());
        editor.type_char('c').expect("type 'c'");
        editor.type_char('d').expect("type 'd'");

        assert_eq!(editor.to_latex(), r"\frac{abcd}{}");
        assert_eq!(editor.history().undo_depth(), 2);
        assert_eq!(
            editor.history().intents(),
            vec![Intent::Typing, Intent::Typing]
        );
        assert!(editor.undo());
        assert_eq!(editor.to_latex(), r"\frac{ab}{}");
    }

    // 子场景 C：卡片 / 粘贴 / 流式命令 / 前缀取消隔断
    {
        let mut editor = Editor::new(Document::new());
        editor.type_char('a').unwrap();
        editor.type_char('b').unwrap();
        editor.apply_palette_card("partial").unwrap();
        editor.type_char('c').unwrap();
        editor.type_char('d').unwrap();
        editor.paste_text("xy").unwrap();
        editor.type_char('e').unwrap();
        editor.type_char('f').unwrap();
        for ch in "▸f1;2;".chars() {
            editor.type_char(ch).unwrap();
        }
        editor.type_char('g').unwrap();
        // 输入前缀 '▸' 后立即按 Backspace 取消返回 Idle，必须断组
        editor.type_char('▸').unwrap();
        editor.delete_backward().unwrap();
        editor.type_char('h').unwrap();

        assert_eq!(
            editor.history().intents(),
            vec![
                Intent::Typing,
                Intent::PaletteCard,
                Intent::Typing,
                Intent::Paste,
                Intent::Typing,
                Intent::CommandExpansion,
                Intent::Typing,
                Intent::Typing,
            ]
        );

        let full_latex = editor.to_latex();
        let depth = editor.history().undo_depth();
        assert_eq!(depth, 8);

        for _ in 0..depth {
            assert!(editor.undo());
        }
        assert_eq!(editor.to_latex(), "");
        assert!(!editor.undo());

        for _ in 0..depth {
            assert!(editor.redo());
        }
        assert_eq!(editor.to_latex(), full_latex);
        assert!(!editor.redo());
    }
}

#[test]
fn test_delete_intent_coalesces_within_word_and_breaks_across_word_and_line() {
    // 1. 根级多词字面量 "foo bar"：词内退格合并，跨空格断开且保留剩余空格
    {
        let mut editor = Editor::new(Document::new());
        editor.paste_text("foo bar").expect("paste literal");
        assert_eq!(editor.to_latex(), "foo bar");

        // 删除 "bar" (3 次 backward) -> 合并为 1 个 Intent::Delete
        editor.delete_backward().unwrap();
        assert_eq!(editor.to_latex(), "foo ba");
        editor.delete_backward().unwrap();
        assert_eq!(editor.to_latex(), "foo b");
        editor.delete_backward().unwrap();
        assert_eq!(editor.to_latex(), "foo ");
        assert_eq!(
            editor.history().intents(),
            vec![Intent::Paste, Intent::Delete]
        );

        // 删除空格 ' ' -> 跨词断开，产生新 Intent::Delete
        editor.delete_backward().unwrap();
        assert_eq!(editor.to_latex(), "foo");
        assert_eq!(
            editor.history().intents(),
            vec![Intent::Paste, Intent::Delete, Intent::Delete]
        );

        // 继续退格删除 "foo" -> 合并为第 3 个 Intent::Delete
        editor.delete_backward().unwrap();
        editor.delete_backward().unwrap();
        editor.delete_backward().unwrap();
        assert_eq!(editor.to_latex(), "");
        assert_eq!(
            editor.history().intents(),
            vec![
                Intent::Paste,
                Intent::Delete,
                Intent::Delete,
                Intent::Delete
            ]
        );

        // 逐词撤销并恢复
        assert!(editor.undo());
        assert_eq!(editor.to_latex(), "foo");
        assert!(editor.undo());
        assert_eq!(editor.to_latex(), "foo ");
        assert!(editor.undo());
        assert_eq!(editor.to_latex(), "foo bar");

        // 重做严格重放
        assert!(editor.redo());
        assert_eq!(editor.to_latex(), "foo ");
        assert!(editor.redo());
        assert_eq!(editor.to_latex(), "foo");
        assert!(editor.redo());
        assert_eq!(editor.to_latex(), "");
    }

    // 2. 槽位内跨换行符 '\n' 删除："hello\nworld"
    {
        let (doc, _) = Document::from_latex(r"\frac{}{}");
        let mut editor = Editor::new(doc);
        editor.paste_text("hello\nworld").unwrap();
        assert_eq!(editor.to_latex(), "\\frac{hello\nworld}{}");

        // 退格删除 "world" (5 次) -> 合并为 1 个 Intent::Delete
        for _ in 0..5 {
            editor.delete_backward().unwrap();
        }
        assert_eq!(editor.to_latex(), "\\frac{hello\n}{}");
        assert_eq!(editor.history().undo_depth(), 2);

        // 删除 '\n' -> 跨行断开
        editor.delete_backward().unwrap();
        assert_eq!(editor.to_latex(), r"\frac{hello}{}");
        assert_eq!(editor.history().undo_depth(), 3);

        // 退格删除 "hello" (5 次) -> 合并为新的 Intent::Delete
        for _ in 0..5 {
            editor.delete_backward().unwrap();
        }
        assert_eq!(editor.to_latex(), r"\frac{}{}");
        assert_eq!(
            editor.history().intents(),
            vec![
                Intent::Paste,
                Intent::Delete,
                Intent::Delete,
                Intent::Delete
            ]
        );

        assert!(editor.undo());
        assert_eq!(editor.to_latex(), r"\frac{hello}{}");
        assert!(editor.undo());
        assert_eq!(editor.to_latex(), "\\frac{hello\n}{}");
        assert!(editor.undo());
        assert_eq!(editor.to_latex(), "\\frac{hello\nworld}{}");
    }

    // 3. DeleteForward 与选区删除 (Selection) 并恢复选区
    {
        let (doc, _) = Document::from_latex(r"\frac{abcd}{z}");
        let mut editor = Editor::new(doc);

        // 连续向前删除 'a', 'b' (backward: false) -> 合并为 1 个 Intent::Delete
        editor.delete_forward().unwrap();
        editor.delete_forward().unwrap();
        assert_eq!(editor.to_latex(), r"\frac{cd}{z}");
        assert_eq!(editor.history().intents(), vec![Intent::Delete]);
        assert!(editor.undo());
        assert_eq!(editor.to_latex(), r"\frac{abcd}{z}");
        assert!(editor.redo());
        assert_eq!(editor.to_latex(), r"\frac{cd}{z}");

        // 选区删除并恢复选区
        let sel = Selection::new(
            Cursor::InSlot {
                slot_id: SlotId(1),
                offset: 0,
            },
            Cursor::InSlot {
                slot_id: SlotId(1),
                offset: 1,
            },
        );
        editor.set_selection(sel.clone());
        editor.delete_backward().unwrap();
        assert_eq!(editor.to_latex(), r"\frac{d}{z}");
        assert_eq!(
            editor.selection(),
            &Selection::caret(Cursor::InSlot {
                slot_id: SlotId(1),
                offset: 0,
            })
        );

        assert!(editor.undo());
        assert_eq!(editor.to_latex(), r"\frac{cd}{z}");
        assert_eq!(editor.selection(), &sel);

        // 边界空删不压入空事务
        let mut empty_ed = Editor::new(Document::new());
        empty_ed.delete_backward().unwrap();
        empty_ed.delete_forward().unwrap();
        assert_eq!(empty_ed.history().undo_depth(), 0);
    }
}

#[test]
fn test_import_and_clear_are_single_undoable_transactions_with_selection() {
    let mut editor = Editor::new(Document::new());
    editor.type_char('x').unwrap();
    editor.type_char('y').unwrap();
    let sel_before_import = editor.selection().clone();

    let diags = editor
        .import_latex(r"\frac{a}{b}")
        .expect("import must succeed");
    assert!(diags.is_empty());
    assert_eq!(editor.to_latex(), r"\frac{a}{b}");
    assert_eq!(
        editor.history().intents(),
        vec![Intent::Typing, Intent::Import]
    );

    // 移动选区至分母并测试 Clear 单步撤销恢复选区与文档
    editor.tab_next_slot();
    editor.tab_next_slot();
    editor.nav_right();
    let sel_before_clear = editor.selection().clone();

    assert!(editor.clear().expect("clear must succeed"));
    assert_eq!(editor.to_latex(), "");
    assert_eq!(
        editor.history().intents(),
        vec![Intent::Typing, Intent::Import, Intent::Clear]
    );
    // 空文档重复 clear 幂等
    assert!(!editor.clear().expect("idempotent clear must succeed"));
    assert_eq!(editor.history().undo_depth(), 3);

    // 单步 Undo 恢复 \frac{a}{b} 与清空前选区
    assert!(editor.undo());
    assert_eq!(editor.to_latex(), r"\frac{a}{b}");
    assert_eq!(editor.selection(), &sel_before_clear);

    // 再 Undo 一步恢复 "xy" 与导入前选区
    assert!(editor.undo());
    assert_eq!(editor.to_latex(), "xy");
    assert_eq!(editor.selection(), &sel_before_import);

    // Redo 一步回到 \frac{a}{b}
    assert!(editor.redo());
    assert_eq!(editor.to_latex(), r"\frac{a}{b}");
}

#[test]
fn test_history_deterministic_without_wall_clock_and_nav_never_recorded() {
    // 1. 直接构造不同 timestamp_ms（0 与 10_000）验证完全不依赖 500ms 挂钟时间窗
    let mut history = History::default();
    let tx1 = Transaction {
        id: 1,
        intent: Intent::Typing,
        label: "type_a".to_string(),
        edits: vec![Edit::InsertText {
            at: Cursor::AtEnd,
            text: "a".to_string(),
        }],
        inverse_edits: vec![Edit::ReplaceAll {
            new_nodes: Vec::new(),
        }],
        cursor_before: Cursor::AtEnd,
        cursor_after: Cursor::AtEnd,
        selection_before: Selection::caret(Cursor::AtEnd),
        selection_after: Selection::caret(Cursor::AtEnd),
        breaks_word_or_line: false,
        version_before: 0,
        version_after: 1,
        timestamp_ms: 0,
    };
    let tx2 = Transaction {
        id: 2,
        intent: Intent::Typing,
        label: "type_b".to_string(),
        edits: vec![Edit::InsertText {
            at: Cursor::AtEnd,
            text: "b".to_string(),
        }],
        inverse_edits: vec![Edit::ReplaceAll {
            new_nodes: Vec::new(),
        }],
        cursor_before: Cursor::AtEnd,
        cursor_after: Cursor::AtEnd,
        selection_before: Selection::caret(Cursor::AtEnd),
        selection_after: Selection::caret(Cursor::AtEnd),
        breaks_word_or_line: false,
        version_before: 1,
        version_after: 2,
        timestamp_ms: 10_000,
    };
    history.push(tx1);
    history.push(tx2);
    assert_eq!(
        history.undo_depth(),
        1,
        "INV-008: Typing must coalesce deterministically regardless of 10_000ms timestamp gap"
    );

    // 同毫秒 (delta = 0ms) 跨空格或异意图绝对断开
    let tx_space = Transaction {
        id: 3,
        intent: Intent::Typing,
        label: "type_space".to_string(),
        edits: vec![Edit::InsertText {
            at: Cursor::AtEnd,
            text: " ".to_string(),
        }],
        inverse_edits: vec![Edit::ReplaceAll {
            new_nodes: Vec::new(),
        }],
        cursor_before: Cursor::AtEnd,
        cursor_after: Cursor::AtEnd,
        selection_before: Selection::caret(Cursor::AtEnd),
        selection_after: Selection::caret(Cursor::AtEnd),
        breaks_word_or_line: true,
        version_before: 2,
        version_after: 3,
        timestamp_ms: 10_000,
    };
    let tx_cmd = Transaction {
        id: 4,
        intent: Intent::Command,
        label: "cmd".to_string(),
        edits: vec![Edit::InsertText {
            at: Cursor::AtEnd,
            text: r"\partial".to_string(),
        }],
        inverse_edits: vec![Edit::ReplaceAll {
            new_nodes: Vec::new(),
        }],
        cursor_before: Cursor::AtEnd,
        cursor_after: Cursor::AtEnd,
        selection_before: Selection::caret(Cursor::AtEnd),
        selection_after: Selection::caret(Cursor::AtEnd),
        breaks_word_or_line: false,
        version_before: 3,
        version_after: 4,
        timestamp_ms: 10_000,
    };
    history.push(tx_space);
    history.push(tx_cmd);
    assert_eq!(history.undo_depth(), 3);

    // 2. Intent::Nav 与 Intent::Navigation 绝不入撤销栈，且不破坏 redo 栈
    let mut doc = Document::new();
    let mut sel = Selection::caret(Cursor::AtEnd);
    assert!(history.undo(&mut doc, &mut sel).expect("undo must succeed"));
    assert_eq!(history.undo_depth(), 2);
    assert_eq!(history.redo_depth(), 1);

    for nav_intent in [Intent::Nav, Intent::Navigation] {
        let nav_tx = Transaction {
            id: 99,
            intent: nav_intent,
            label: "nav".to_string(),
            edits: Vec::new(),
            inverse_edits: Vec::new(),
            cursor_before: Cursor::AtEnd,
            cursor_after: Cursor::AtStart,
            selection_before: Selection::caret(Cursor::AtEnd),
            selection_after: Selection::caret(Cursor::AtStart),
            breaks_word_or_line: false,
            version_before: 4,
            version_after: 4,
            timestamp_ms: 10_001,
        };
        history.push(nav_tx);
    }
    assert_eq!(history.undo_depth(), 2);
    assert_eq!(history.redo_depth(), 1);
    assert_eq!(history.intents(), vec![Intent::Typing, Intent::Typing]);
    assert_eq!(history.redo_intents(), vec![Intent::Command]);

    // 3. 无槽位文档 Cursor::AtStart 插入不产生幽灵 SlotId(1) (D-107)
    let mut ed = Editor::new(Document::new());
    ed.set_cursor(Cursor::AtStart);
    ed.insert_text("a")
        .expect("first AtStart insert must succeed");
    assert!(
        !matches!(ed.cursor(), Cursor::InSlot { .. }),
        "D-107: slotless AtStart insert must NOT fabricate phantom SlotId(1), got {:?}",
        ed.cursor()
    );
    ed.insert_text("b")
        .expect("second AtStart insert must NOT hit SlotNotFound");
    let after_two = ed.to_latex();
    assert!(!after_two.is_empty());
    assert!(ed.undo());
    while ed.undo() {}
    assert_eq!(ed.to_latex(), "");
    while ed.redo() {}
    assert_eq!(ed.to_latex(), after_two);
}

#[test]
fn test_undo_redo_error_rollback_and_root_delete_forward() {
    use mathslot_doc::DocError;

    // 1. History::undo 与 History::redo 出错时绝不静默丢错且回滚文档、选区与栈帧 (D-107)
    let (mut doc, _) = Document::from_latex("ok");
    let mut selection = Selection::caret(Cursor::AtEnd);
    let mut history = History::new(100);

    // undo 失败回滚：inverse_edits 第一步改文档，第二步引用不存在的槽位 SlotId(999)
    let bad_undo_tx = Transaction {
        id: 1,
        intent: Intent::Command,
        label: "bad_undo".to_string(),
        edits: vec![Edit::InsertText {
            at: Cursor::AtEnd,
            text: "!".to_string(),
        }],
        inverse_edits: vec![
            Edit::DeleteChar {
                at: Cursor::AtEnd,
                backward: true,
            },
            Edit::InsertText {
                at: Cursor::InSlot {
                    slot_id: SlotId(999),
                    offset: 0,
                },
                text: "bad".to_string(),
            },
        ],
        cursor_before: Cursor::AtStart,
        cursor_after: Cursor::AtEnd,
        selection_before: Selection::caret(Cursor::AtStart),
        selection_after: Selection::caret(Cursor::AtEnd),
        breaks_word_or_line: false,
        version_before: 1,
        version_after: 2,
        timestamp_ms: 1,
    };
    history.push(bad_undo_tx);
    let before_undo_depth = history.undo_depth();
    let before_redo_depth = history.redo_depth();
    let undo_err = history
        .undo(&mut doc, &mut selection)
        .expect_err("undo with invalid slot must propagate DocError instead of let _ =");
    assert!(matches!(undo_err, DocError::SlotNotFound(SlotId(999))));
    assert_eq!(doc.to_latex(), "ok");
    assert_eq!(selection, Selection::caret(Cursor::AtEnd));
    assert_eq!(history.undo_depth(), before_undo_depth);
    assert_eq!(history.redo_depth(), before_redo_depth);

    // redo 失败回滚：inverse_edits 有效但 forward edits 第二步引用不存在的槽位 SlotId(999)
    let (mut doc2, _) = Document::from_latex("ok");
    let mut sel2 = Selection::caret(Cursor::AtEnd);
    let mut history2 = History::new(100);
    let bad_redo_tx = Transaction {
        id: 2,
        intent: Intent::Command,
        label: "bad_redo".to_string(),
        edits: vec![
            Edit::InsertText {
                at: Cursor::AtEnd,
                text: "x".to_string(),
            },
            Edit::InsertText {
                at: Cursor::InSlot {
                    slot_id: SlotId(999),
                    offset: 0,
                },
                text: "bad".to_string(),
            },
        ],
        inverse_edits: vec![Edit::DeleteChar {
            at: Cursor::AtEnd,
            backward: true,
        }],
        cursor_before: Cursor::AtStart,
        cursor_after: Cursor::AtEnd,
        selection_before: Selection::caret(Cursor::AtStart),
        selection_after: Selection::caret(Cursor::AtEnd),
        breaks_word_or_line: false,
        version_before: 2,
        version_after: 3,
        timestamp_ms: 2,
    };
    history2.push(bad_redo_tx);
    assert!(
        history2
            .undo(&mut doc2, &mut sel2)
            .expect("valid inverse edit must succeed")
    );
    assert_eq!(doc2.to_latex(), "o");
    assert_eq!(history2.undo_depth(), 0);
    assert_eq!(history2.redo_depth(), 1);

    let redo_err = history2
        .redo(&mut doc2, &mut sel2)
        .expect_err("redo with invalid slot must propagate DocError instead of let _ =");
    assert!(matches!(redo_err, DocError::SlotNotFound(SlotId(999))));
    assert_eq!(doc2.to_latex(), "o");
    assert_eq!(sel2, Selection::caret(Cursor::AtStart));
    assert_eq!(history2.undo_depth(), 0);
    assert_eq!(history2.redo_depth(), 1);

    // 2. 根级 Cursor::AtStart 调用 delete_forward() 词内合并、跨空格断开且可逆 (D-107)
    let mut editor = Editor::new(Document::new());
    editor.paste_text("foo bar").expect("paste literal");
    editor.set_cursor(Cursor::AtStart);

    for _ in 0..3 {
        editor.delete_forward().expect("delete_forward 'foo'");
    }
    assert_eq!(editor.to_latex(), " bar");
    assert_eq!(
        editor.history().intents(),
        vec![Intent::Paste, Intent::Delete]
    );

    editor.delete_forward().expect("delete_forward ' '");
    assert_eq!(editor.to_latex(), "bar");
    assert_eq!(
        editor.history().intents(),
        vec![Intent::Paste, Intent::Delete, Intent::Delete]
    );

    for _ in 0..3 {
        editor.delete_forward().expect("delete_forward 'bar'");
    }
    assert_eq!(editor.to_latex(), "");
    assert_eq!(
        editor.history().intents(),
        vec![
            Intent::Paste,
            Intent::Delete,
            Intent::Delete,
            Intent::Delete
        ]
    );

    // 空边界 delete_forward 安全 no-op 且不压入空事务
    editor
        .delete_forward()
        .expect("empty delete_forward must be a safe no-op");
    assert_eq!(editor.history().undo_depth(), 4);

    assert!(editor.undo());
    assert_eq!(editor.to_latex(), "bar");
    assert!(editor.undo());
    assert_eq!(editor.to_latex(), " bar");
    assert!(editor.undo());
    assert_eq!(editor.to_latex(), "foo bar");
    assert!(editor.undo());
    assert_eq!(editor.to_latex(), "");

    while editor.redo() {}
    assert_eq!(editor.to_latex(), "");
}

//! Parity Harness: Legacy Core vs Target Modular Stack (Gate G1 T1.7)
//!
//! Verifies:
//! 1. All 121 commands in catalog expand to equivalent LaTeX structures in both stacks.
//! 2. Matrix, cases, and delimiter topologies match exactly in slot counts and dimensions.
//! 3. Slot navigation traversal order (tab_next / tab_prev) is 100% equivalent.
//! 4. Copy/export behaviors and intentional differences (D-001, D-004) are verified.

use mathslot_command::generated::{GENERATED_COMMANDS, StaticCommand};
use mathslot_core::Session;
use mathslot_core::command::{CommandTarget, lookup_direct, lookup_sub_command};
use mathslot_core::editor::StreamEditor;
use mathslot_core::exprs_structurally_equal;
use mathslot_doc::{Cursor, Document, Editor, SlotRole};
use mathslot_syntax::{Delim, Expr, MatrixEnv, parse};

fn all_commands() -> &'static [StaticCommand] {
    GENERATED_COMMANDS
}

#[test]
fn test_parity_commands_template_expansion() {
    let commands = all_commands();
    assert_eq!(
        commands.len(),
        121,
        "Catalog must contain exactly 121 commands"
    );

    for cmd in commands {
        // 1. 验证新旧两栈对命令元数据（槽位数与角色定义）的一致性
        let expected_slot_count = cmd.slots.len();

        let legacy_slot_count = if cmd.keys.len() == 1 {
            let key_char = cmd.keys[0].chars().next().expect("key cannot be empty");
            let struct_kind = lookup_direct(key_char).unwrap_or_else(|| {
                panic!(
                    "Direct command key '{}' for '{}' not found in legacy",
                    key_char, cmd.id
                )
            });
            struct_kind.arity()
        } else if cmd.keys.len() == 2 {
            let c1 = cmd.keys[0].chars().next().expect("key 0 cannot be empty");
            let c2 = cmd.keys[1].chars().next().expect("key 1 cannot be empty");
            let target = lookup_sub_command(c1, c2).unwrap_or_else(|| {
                panic!(
                    "Sub-command keys '{}{}' for '{}' not found in legacy",
                    c1, c2, cmd.id
                )
            });
            match target {
                CommandTarget::Struct(s) => s.arity(),
                CommandTarget::Symbol(_) => 0,
            }
        } else {
            panic!(
                "Unexpected keys length {} for command '{}'",
                cmd.keys.len(),
                cmd.id
            );
        };

        assert_eq!(
            legacy_slot_count, expected_slot_count,
            "Slot count mismatch between legacy and catalog for command '{}'",
            cmd.id
        );

        // 2. 遍历该命令的全部 example 简码输入，对比新栈与旧栈执行后的 LaTeX 输出与语法树
        for example in cmd.examples {
            let legacy_editor = StreamEditor::from_source(example);
            let legacy_latex = legacy_editor.to_latex();

            let mut stream_target = Editor::new(Document::new());
            for ch in example.chars() {
                stream_target.type_char(ch).unwrap_or_else(|e| {
                    panic!(
                        "Failed to type char '{}' in example '{}' for '{}': {:?}",
                        ch, example, cmd.id, e
                    )
                });
            }
            let target_latex = stream_target.to_latex();

            // 比较语义等价性：通过 syntax 解析为 AST
            let (legacy_ast, _) = parse(&legacy_latex);
            let (target_ast, target_diags) = parse(&target_latex);

            assert!(
                target_diags.iter().all(|d| !d.is_error()),
                "Target syntax parse produced errors for command '{}' (example: '{}'): {:?}",
                cmd.id,
                example,
                target_diags
            );

            assert!(
                exprs_structurally_equal(&legacy_ast, &target_ast),
                "Parity AST structural mismatch for command '{}' (example: '{}')\nLegacy LaTeX: '{}'\nTarget LaTeX: '{}'\nLegacy AST: {:?}\nTarget AST: {:?}",
                cmd.id,
                example,
                legacy_latex,
                target_latex,
                legacy_ast,
                target_ast
            );
        }
    }
}

#[test]
fn test_parity_matrix_and_delimiter_structures() {
    struct MatrixDelimCase {
        input: &'static str,
        expected_slots: usize,
        expected_env: Option<MatrixEnv>,
        expected_delim: Option<(Delim, Delim)>,
        rows: usize,
        cols: usize,
    }

    let cases = [
        MatrixDelimCase {
            input: "▸ma1;2;3;4;",
            expected_slots: 4,
            expected_env: Some(MatrixEnv::Pmatrix),
            expected_delim: None,
            rows: 2,
            cols: 2,
        },
        MatrixDelimCase {
            input: "▸mc1;2;3;4;",
            expected_slots: 4,
            expected_env: Some(MatrixEnv::Vmatrix),
            expected_delim: None,
            rows: 2,
            cols: 2,
        },
        MatrixDelimCase {
            input: "▸me1;2;3;4;",
            expected_slots: 4,
            expected_env: Some(MatrixEnv::Bmatrix),
            expected_delim: None,
            rows: 2,
            cols: 2,
        },
        MatrixDelimCase {
            input: "▸md1;2;3;4;",
            expected_slots: 4,
            expected_env: Some(MatrixEnv::Cases),
            expected_delim: None,
            rows: 2,
            cols: 2,
        },
        MatrixDelimCase {
            input: "▸mb1;2;3;4;5;6;7;8;9;",
            expected_slots: 9,
            expected_env: Some(MatrixEnv::Pmatrix),
            expected_delim: None,
            rows: 3,
            cols: 3,
        },
        MatrixDelimCase {
            input: "▸mg1;2;3;4;5;6;7;8;9;",
            expected_slots: 9,
            expected_env: Some(MatrixEnv::Bmatrix),
            expected_delim: None,
            rows: 3,
            cols: 3,
        },
        MatrixDelimCase {
            input: "▸mh1;2;3;4;5;6;7;8;9;",
            expected_slots: 9,
            expected_env: Some(MatrixEnv::Vmatrix),
            expected_delim: None,
            rows: 3,
            cols: 3,
        },
        MatrixDelimCase {
            input: "▸mf1;2;3;4;5;6;",
            expected_slots: 6,
            expected_env: Some(MatrixEnv::Cases),
            expected_delim: None,
            rows: 3,
            cols: 2,
        },
        MatrixDelimCase {
            input: "▸px;",
            expected_slots: 1,
            expected_env: None,
            expected_delim: Some((Delim::Paren, Delim::Paren)),
            rows: 0,
            cols: 0,
        },
        MatrixDelimCase {
            input: "▸alx;",
            expected_slots: 1,
            expected_env: None,
            expected_delim: Some((Delim::Bracket, Delim::Bracket)),
            rows: 0,
            cols: 0,
        },
        MatrixDelimCase {
            input: "▸vx;",
            expected_slots: 1,
            expected_env: None,
            expected_delim: Some((Delim::Pipe, Delim::Pipe)),
            rows: 0,
            cols: 0,
        },
        MatrixDelimCase {
            input: "▸afx;",
            expected_slots: 1,
            expected_env: None,
            expected_delim: Some((Delim::DoublePipe, Delim::DoublePipe)),
            rows: 0,
            cols: 0,
        },
    ];

    for c in &cases {
        let legacy = StreamEditor::from_source(c.input);
        let legacy_latex = legacy.to_latex();

        let mut target = Editor::new(Document::new());
        for ch in c.input.chars() {
            target.type_char(ch).expect("type_char must succeed");
        }
        let target_latex = target.to_latex();

        let (leg_ast, _) = parse(&legacy_latex);
        let (tar_ast, tar_diags) = parse(&target_latex);
        assert!(tar_diags.iter().all(|d| !d.is_error()));
        assert!(
            exprs_structurally_equal(&leg_ast, &tar_ast),
            "Structural mismatch for matrix/delim case '{}'\nLegacy: {}\nTarget: {}",
            c.input,
            legacy_latex,
            target_latex
        );

        let doc_slots = target.doc().slots.slots();
        assert_eq!(
            doc_slots.len(),
            c.expected_slots,
            "Slot count mismatch for '{}'",
            c.input
        );

        if let Some(expected_env) = c.expected_env {
            assert_eq!(tar_ast.len(), 1);
            if let Expr::Matrix { env, rows } = &tar_ast[0].node {
                assert_eq!(
                    *env, expected_env,
                    "Matrix environment mismatch for '{}'",
                    c.input
                );
                assert_eq!(rows.len(), c.rows, "Row count mismatch for '{}'", c.input);
                for (r_idx, row) in rows.iter().enumerate() {
                    assert_eq!(
                        row.len(),
                        c.cols,
                        "Col count mismatch in row {} for '{}'",
                        r_idx,
                        c.input
                    );
                }
            } else {
                panic!(
                    "Expected Expr::Matrix for '{}', got {:?}",
                    c.input, tar_ast[0].node
                );
            }

            for r in 0..c.rows {
                for col in 0..c.cols {
                    assert!(
                        doc_slots.iter().any(|s| matches!(s.role, SlotRole::MatrixCell { row, col: c } if row == r && c == col)),
                        "Missing MatrixCell({}, {}) slot for '{}'", r, col, c.input
                    );
                }
            }
        }

        if let Some((open_d, close_d)) = c.expected_delim {
            assert_eq!(tar_ast.len(), 1);
            if let Expr::Delimited {
                open,
                close,
                auto_scale,
                ..
            } = &tar_ast[0].node
            {
                assert_eq!(*open, open_d, "Open delimiter mismatch for '{}'", c.input);
                assert_eq!(
                    *close, close_d,
                    "Close delimiter mismatch for '{}'",
                    c.input
                );
                assert!(
                    *auto_scale,
                    "Delimiter must be auto_scale for '{}'",
                    c.input
                );
            } else {
                panic!(
                    "Expected Expr::Delimited for '{}', got {:?}",
                    c.input, tar_ast[0].node
                );
            }
            assert!(
                doc_slots
                    .iter()
                    .any(|s| matches!(s.role, SlotRole::DelimitedBody)),
                "Missing DelimitedBody slot for '{}'",
                c.input
            );
        }
    }
}

#[test]
fn test_parity_slot_navigation_order() {
    // 1. 分式复合结构: Numerator (0) -> Denominator (1) -> Numerator (0, 回绕)
    {
        let (doc, _) = Document::from_latex(r"\frac{a}{b}");
        let mut target_editor = Editor::new(doc.clone());
        let (mut legacy_session, _) = Session::from_latex(r"\frac{a}{b}");

        let slots = doc.slots.slots();
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[0].role, SlotRole::Numerator);
        assert_eq!(slots[1].role, SlotRole::Denominator);

        target_editor.set_cursor(Cursor::InSlot {
            slot_id: slots[0].id,
            offset: 0,
        });
        legacy_session.set_cursor(Cursor::InSlot {
            slot_id: slots[0].id,
            offset: 0,
        });

        // tab_next_slot: 跳至分母
        assert!(target_editor.tab_next_slot());
        assert!(legacy_session.tab_next_slot());
        assert_eq!(target_editor.cursor(), legacy_session.cursor());
        assert_eq!(
            target_editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[1].id,
                offset: 0,
            }
        );

        // tab_next_slot: 循环回绕至分子
        assert!(target_editor.tab_next_slot());
        assert!(legacy_session.tab_next_slot());
        assert_eq!(target_editor.cursor(), legacy_session.cursor());
        assert_eq!(
            target_editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[0].id,
                offset: 0,
            }
        );

        // tab_prev_slot: 反向循环至分母
        assert!(target_editor.tab_prev_slot());
        assert!(legacy_session.tab_prev_slot());
        assert_eq!(target_editor.cursor(), legacy_session.cursor());
        assert_eq!(
            target_editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[1].id,
                offset: 0,
            }
        );
    }

    // 2. 根号复合结构 (N次根): RootIndex (0) -> Radicand (1) -> RootIndex (0, 回绕)
    {
        let (doc, _) = Document::from_latex(r"\sqrt[3]{8}");
        let mut target_editor = Editor::new(doc.clone());
        let (mut legacy_session, _) = Session::from_latex(r"\sqrt[3]{8}");

        let slots = doc.slots.slots();
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[0].role, SlotRole::RootIndex);
        assert_eq!(slots[1].role, SlotRole::Radicand);

        target_editor.set_cursor(Cursor::InSlot {
            slot_id: slots[0].id,
            offset: 0,
        });
        legacy_session.set_cursor(Cursor::InSlot {
            slot_id: slots[0].id,
            offset: 0,
        });

        assert!(target_editor.tab_next_slot());
        assert!(legacy_session.tab_next_slot());
        assert_eq!(target_editor.cursor(), legacy_session.cursor());
        assert_eq!(
            target_editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[1].id,
                offset: 0,
            }
        );

        assert!(target_editor.tab_next_slot());
        assert!(legacy_session.tab_next_slot());
        assert_eq!(target_editor.cursor(), legacy_session.cursor());
        assert_eq!(
            target_editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[0].id,
                offset: 0,
            }
        );
    }

    // 3. 积分复合结构: LowerBound (0) -> UpperBound (1) -> BigOpBody (2) -> 回绕
    {
        let (doc, _) = Document::from_latex(r"\int_{0}^{1} x dx");
        let mut target_editor = Editor::new(doc.clone());
        let (mut legacy_session, _) = Session::from_latex(r"\int_{0}^{1} x dx");

        let slots = doc.slots.slots();
        assert_eq!(slots.len(), 3);
        assert_eq!(slots[0].role, SlotRole::LowerBound);
        assert_eq!(slots[1].role, SlotRole::UpperBound);
        assert_eq!(slots[2].role, SlotRole::BigOpBody);

        target_editor.set_cursor(Cursor::InSlot {
            slot_id: slots[0].id,
            offset: 0,
        });
        legacy_session.set_cursor(Cursor::InSlot {
            slot_id: slots[0].id,
            offset: 0,
        });

        // 0 -> 1
        assert!(target_editor.tab_next_slot());
        assert!(legacy_session.tab_next_slot());
        assert_eq!(target_editor.cursor(), legacy_session.cursor());
        assert_eq!(
            target_editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[1].id,
                offset: 0,
            }
        );

        // 1 -> 2
        assert!(target_editor.tab_next_slot());
        assert!(legacy_session.tab_next_slot());
        assert_eq!(target_editor.cursor(), legacy_session.cursor());
        assert_eq!(
            target_editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[2].id,
                offset: 0,
            }
        );

        // 2 -> 0 (回绕)
        assert!(target_editor.tab_next_slot());
        assert!(legacy_session.tab_next_slot());
        assert_eq!(target_editor.cursor(), legacy_session.cursor());
        assert_eq!(
            target_editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[0].id,
                offset: 0,
            }
        );

        // 0 -> 2 (反向回绕)
        assert!(target_editor.tab_prev_slot());
        assert!(legacy_session.tab_prev_slot());
        assert_eq!(target_editor.cursor(), legacy_session.cursor());
        assert_eq!(
            target_editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[2].id,
                offset: 0,
            }
        );
    }

    // 4. 2x2 矩阵结构: 行优先 (0,0) -> (0,1) -> (1,0) -> (1,1) -> (0,0)
    {
        let (doc, _) = Document::from_latex(r"\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}");
        let mut target_editor = Editor::new(doc.clone());
        let (mut legacy_session, _) =
            Session::from_latex(r"\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}");

        let slots = doc.slots.slots();
        assert_eq!(slots.len(), 4);

        target_editor.set_cursor(Cursor::InSlot {
            slot_id: slots[0].id,
            offset: 0,
        });
        legacy_session.set_cursor(Cursor::InSlot {
            slot_id: slots[0].id,
            offset: 0,
        });

        for slot in &slots[1..4] {
            assert!(target_editor.tab_next_slot());
            assert!(legacy_session.tab_next_slot());
            assert_eq!(target_editor.cursor(), legacy_session.cursor());
            assert_eq!(
                target_editor.cursor(),
                &Cursor::InSlot {
                    slot_id: slot.id,
                    offset: 0,
                }
            );
        }

        assert!(target_editor.tab_next_slot());
        assert!(legacy_session.tab_next_slot());
        assert_eq!(target_editor.cursor(), legacy_session.cursor());
        assert_eq!(
            target_editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[0].id,
                offset: 0,
            }
        );
    }

    // 5. 导航模式快捷键 (j, k, n, p) 行为等价性与文本/撤销不变性
    {
        let (doc, _) = Document::from_latex(r"\frac{a}{b}");
        let mut editor = Editor::new(doc.clone());
        let initial_text = editor.to_latex();
        let initial_undo = editor.history().undo_len();
        let slots = doc.slots.slots();

        editor.enter_nav_mode();
        assert!(editor.is_nav_mode());

        // 'j' / 'n': 向后跳转
        editor.type_char('j').expect("nav 'j' must succeed");
        assert_eq!(
            editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[1].id,
                offset: 0,
            }
        );
        assert_eq!(editor.to_latex(), initial_text);
        assert_eq!(editor.history().undo_len(), initial_undo);

        editor.type_char('n').expect("nav 'n' must succeed");
        assert_eq!(
            editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[0].id,
                offset: 0,
            }
        );

        // 'k' / 'p': 向前跳转
        editor.type_char('k').expect("nav 'k' must succeed");
        assert_eq!(
            editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[1].id,
                offset: 0,
            }
        );

        editor.type_char('p').expect("nav 'p' must succeed");
        assert_eq!(
            editor.cursor(),
            &Cursor::InSlot {
                slot_id: slots[0].id,
                offset: 0,
            }
        );

        editor.exit_nav_mode();
        assert!(!editor.is_nav_mode());
    }
}

#[test]
fn test_parity_latex_export_with_known_deltas() {
    // 1. 典型代数公式的双栈导出语义等价性
    let formulas = [
        // 二次方程求根公式
        r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}",
        // 高斯积分
        r"\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}",
        // 质能方程与求和
        r"E = m c^2",
        r"\sum_{i=1}^{n} i = \frac{n(n+1)}{2}",
    ];

    for formula in formulas {
        let (doc_target, target_diags) = Document::from_latex(formula);
        assert!(target_diags.iter().all(|d| !d.is_error()));
        let target_editor = Editor::new(doc_target);
        let target_latex = target_editor.export_latex();

        let (legacy_session, _) = Session::from_latex(formula);
        let legacy_latex = legacy_session.to_latex();

        let (ast_tar, _) = parse(&target_latex);
        let (ast_leg, _) = parse(&legacy_latex);

        assert!(
            exprs_structurally_equal(&ast_tar, &ast_leg),
            "Formula AST equivalence failed for '{}'\nTarget LaTeX: {}\nLegacy LaTeX: {}",
            formula,
            target_latex,
            legacy_latex
        );
    }

    // 2. 已知故意差异 D-001：卡片命令修正
    // 历史版本中 5 张卡片简码错乱（例如偏导卡片输出 `▸ob` 映射为 `\to`）
    // 新栈依据 catalog 单一事实源修正，确保偏导为 \partial，约等于为 \approx，点乘为 \cdot 等
    {
        let expected_cards = [
            ("partial", r"\partial"),
            ("approx", r"\approx"),
            ("cdot", r"\cdot"),
            ("times", r"\times"),
            ("equiv", r"\equiv"),
        ];

        for (card_id, expected_latex) in expected_cards {
            let mut editor = Editor::new(Document::new());
            editor
                .apply_palette_card(card_id)
                .expect("card must succeed");
            let latex = editor.to_latex();
            assert!(
                latex.contains(expected_latex),
                "D-001: Card '{}' must contain '{}', got: '{}'",
                card_id,
                expected_latex,
                latex
            );
            assert!(
                !latex.contains(r"\to"),
                "D-001: Card '{}' must never degenerate to '\\to', got: '{}'",
                card_id,
                latex
            );
        }
    }

    // 3. 已知故意差异 D-004：未决/未知命令占位符保护与诊断阻断
    // 历史版本中未决命令 ▸m 导出为空串，未知命令 ▸zz 静默变为 z
    // 经修复后，两栈导出均包含显式占位符 \text{▸...}，且新栈提供严格导出阻断
    {
        // (a) 未决命令 ▸m
        let legacy_pending = StreamEditor::from_source("▸m");
        let leg_pending_latex = legacy_pending.to_latex();
        assert!(
            !leg_pending_latex.trim().is_empty(),
            "D-004: Legacy export of pending command must not be empty"
        );
        assert!(
            leg_pending_latex.contains(r"\text{▸m}"),
            "D-004: Legacy export must contain explicit placeholder \\text{{▸m}}, got: {leg_pending_latex}"
        );

        let mut target_pending = Editor::new(Document::new());
        for ch in "▸m".chars() {
            target_pending
                .type_char(ch)
                .expect("type_char must succeed");
        }
        let tar_pending_latex = target_pending.export_latex();
        assert!(
            tar_pending_latex.contains(r"\text{▸m}"),
            "D-004: Target export must contain explicit placeholder \\text{{▸m}}, got: {tar_pending_latex}"
        );
        assert!(target_pending.has_pending_command());
        let diags = target_pending.diagnostics();
        assert!(diags.iter().any(|d| d.is_pending()));
        assert_eq!(target_pending.export_latex_strict(), Err(diags.to_vec()));

        // (b) 未知命令 ▸zz
        let legacy_unknown = StreamEditor::from_source("▸zz");
        let leg_unknown_latex = legacy_unknown.to_latex();
        assert_ne!(
            leg_unknown_latex.trim(),
            "z",
            "D-004: Legacy unknown command must never silently degenerate to 'z'"
        );
        assert!(
            leg_unknown_latex.contains(r"\text{▸"),
            "D-004: Legacy unknown command must contain placeholder \\text{{▸...}}, got: {leg_unknown_latex}"
        );

        let mut target_unknown = Editor::new(Document::new());
        for ch in "▸zz".chars() {
            target_unknown
                .type_char(ch)
                .expect("type_char must succeed");
        }
        let tar_unknown_latex = target_unknown.export_latex();
        assert_ne!(
            tar_unknown_latex.trim(),
            "z",
            "D-004: Target unknown command must never silently degenerate to 'z'"
        );
        assert!(
            tar_unknown_latex.contains(r"\text{▸zz}"),
            "D-004: Target unknown command must contain placeholder \\text{{▸zz}}, got: {tar_unknown_latex}"
        );
        let unknown_diags = target_unknown.diagnostics();
        assert!(unknown_diags.iter().any(|d| d.is_error()));
        assert_eq!(
            target_unknown.export_latex_strict(),
            Err(unknown_diags.to_vec())
        );
    }

    // 4. 显式排版空格格式化差异 (DIFF-03)
    // 矩阵环境在旧栈为紧凑拼接，新栈由 Printer 规范化输出边距空格，但数学语义 AST 完全等价
    {
        let legacy_editor = StreamEditor::from_source("▸ma1;2;3;4;");
        let legacy_latex = legacy_editor.to_latex();

        let mut target_editor = Editor::new(Document::new());
        for ch in "▸ma1;2;3;4;".chars() {
            target_editor.type_char(ch).expect("type_char must succeed");
        }
        let target_latex = target_editor.to_latex();

        let (leg_ast, _) = parse(&legacy_latex);
        let (tar_ast, _) = parse(&target_latex);
        assert!(
            exprs_structurally_equal(&leg_ast, &tar_ast),
            "AST structural identity must hold despite formatting differences"
        );
    }
}

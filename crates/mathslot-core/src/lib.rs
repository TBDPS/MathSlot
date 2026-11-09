pub mod ast;
pub mod command;
pub mod editor;
pub mod latex;
pub mod library;
pub mod parser;
pub mod scheme_a;
pub mod visual;

#[cfg(test)]
mod tests {
    use crate::ast::NavEntryKind;
    use crate::command::{PrefixMenuState, SubCategory, detect_prefix_menu_state};
    use crate::editor::StreamEditor;
    use crate::latex::{text_to_latex, to_latex};
    use crate::library::{CustomFormat, LayoutKind, UserLibrary};
    use crate::parser::{generate_nav_labels, parse, parse_with_library};
    use crate::scheme_a::to_scheme_a;
    use crate::visual::{VisualDialect, build_preview_latex};

    #[test]
    fn test_prefix_menu_state_hybrid() {
        assert_eq!(detect_prefix_menu_state("", 0), PrefixMenuState::Idle);
        assert_eq!(detect_prefix_menu_state("▸", 1), PrefixMenuState::Root);
        assert_eq!(detect_prefix_menu_state("▸f", 2), PrefixMenuState::Idle);
        assert_eq!(detect_prefix_menu_state("▸i", 2), PrefixMenuState::Idle);
        assert_eq!(detect_prefix_menu_state("▸l", 2), PrefixMenuState::Idle);
        assert_eq!(
            detect_prefix_menu_state("▸m", 2),
            PrefixMenuState::SubMenu(SubCategory::Matrix)
        );
        assert_eq!(
            detect_prefix_menu_state("▸k", 2),
            PrefixMenuState::SubMenu(SubCategory::Custom)
        );
        assert_eq!(
            detect_prefix_menu_state("▸t", 2),
            PrefixMenuState::SubMenu(SubCategory::Template)
        );
        assert_eq!(detect_prefix_menu_state("▸ma", 3), PrefixMenuState::Idle);
        assert_eq!(
            detect_prefix_menu_state("▸j", 2),
            PrefixMenuState::Jump(String::new())
        );
        assert_eq!(
            detect_prefix_menu_state("▸jcb", 4),
            PrefixMenuState::Jump("cb".to_owned())
        );
        assert_eq!(
            detect_prefix_menu_state("▸j-", 3),
            PrefixMenuState::Jump("-".to_owned())
        );
    }

    #[test]
    fn test_limit_three_slots_and_to_arrow() {
        let doc = parse("▸lx;0;▸fsin x;x;");
        assert_eq!(to_scheme_a(&doc), "lim(x -> 0, frac(sin x, x))");
        assert_eq!(to_latex(&doc), "\\lim_{x \\to 0} \\frac{\\sin x}{x}");

        let sym_doc = parse("x ▸ob ▸oa");
        assert_eq!(to_latex(&sym_doc), "x \\to \\infty");
    }

    #[test]
    fn test_smart_prepend_limit_and_fraction_body_wrapping() {
        // 1. 先输入 `\frac{\sin x}{x} = 1`，再按 Esc a 回到最前面输入极限 `Tab + l`：
        //    自动将 `\frac{\sin x}{x}` 作为极限的主体（等号右侧 `= 1` 自动保留在外部），光标留在条件变量槽！
        let mut ed = StreamEditor::from_source("▸fsin x;x; = 1");
        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('a');
        assert_eq!(ed.cursor_char, 0);

        ed.handle_tab(); // 插入 `▸` -> `"▸▸fsin x;x; = 1"`
        let msg = ed.type_text("l"); // 输入 `l` -> 自动将 `\frac{\sin x}{x}` 包裹为主体！
        assert!(msg.is_some());
        assert_eq!(ed.source, "▸l;;▸fsin x;x;; = 1");
        assert_eq!(ed.cursor_char, 2); // 光标停在第 0 槽（趋近变量）

        // 接着顺手输入 `x` -> Enter -> `0`：立刻得到完整极限等式！
        ed.type_text("x");
        ed.smart_enter(); // 跨过 `;` 到第 1 槽（趋近目标）
        assert_eq!(ed.cursor_char, 4);
        ed.type_text("0");
        assert_eq!(
            to_latex(&ed.parsed),
            "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1"
        );

        // 2. 验证按 Ctrl+Z 可一键退回未包裹形态（保留自由度）
        let mut ed2 = StreamEditor::from_source("x^2 + 1");
        ed2.jump_to_start();
        ed2.apply_card_click("l");
        assert_eq!(ed2.source, "▸l;;x^2 + 1;");
        ed2.undo();
        assert_eq!(ed2.source, "▸lx^2 + 1");

        // 3. 验证前置插入分数 `▸f`：自动把后方式子作为分子，光标直接进入分母！
        let mut ed3 = StreamEditor::from_source("x + 1 = 0");
        ed3.jump_to_start();
        ed3.apply_card_click("f");
        assert_eq!(ed3.source, "▸fx + 1;; = 0");
        assert_eq!(ed3.cursor_char, 8); // 光标位于分母槽 `▸fx + 1;|; = 0`
        ed3.type_text("x - 1");
        assert_eq!(to_latex(&ed3.parsed), "\\frac{x + 1}{x - 1} = 0");
    }

    #[test]
    fn test_user_custom_formats_and_json_persistence() {
        let mut lib = UserLibrary::default_seeded();
        // 默认内置的自定义格式 `▸ka` = 组合数 `\binom{$1}{$2}`
        let d0 = parse_with_library("▸kan;k;", &lib);
        assert_eq!(to_latex(&d0), "\\binom{n}{k}");
        assert_eq!(to_scheme_a(&d0), "binom(n, k)");

        // 用户零改源码动态新增一个 3 槽自定义数学格式 `▸kg`: 同余模运算 `$1 \equiv $2 \pmod{$3}`
        lib.upsert_custom(CustomFormat {
            item_key: 'g',
            label: "同余式".to_owned(),
            glyph_hint: "a≡b(m)".to_owned(),
            slot_roles: vec!["左项".to_owned(), "右项".to_owned(), "模数".to_owned()],
            latex_template: "$1 \\equiv $2 \\pmod{$3}".to_owned(),
            scheme_a_name: "cong".to_owned(),
            layout: crate::library::LayoutKind::Linear,
            auto_join: None,
        })
        .unwrap();

        let json = lib.to_json_pretty();
        let restored = UserLibrary::from_json(&json).unwrap();
        assert_eq!(restored, lib);

        let d1 = parse_with_library("▸kga^p;a;p;", &restored);
        assert_eq!(to_latex(&d1), "a^{p} \\equiv a \\pmod{p}");
        assert_eq!(to_scheme_a(&d1), "cong(a^p, a, p)");
    }

    #[test]
    fn test_level1_custom_layout_env_and_autojoin() {
        use crate::library::{AutoJoin, LayoutKind};

        // 1. env 布局：2x2 方括号矩阵免改源码定义，LaTeX/方案 A 双路输出
        let mut lib = UserLibrary::default_seeded();
        lib.upsert_custom(CustomFormat {
            item_key: 'z',
            label: "方程组".to_owned(),
            glyph_hint: "[2×2]".to_owned(),
            slot_roles: vec![
                "左上".to_owned(),
                "右上".to_owned(),
                "左下".to_owned(),
                "右下".to_owned(),
            ],
            latex_template: "$1".to_owned(),
            scheme_a_name: "eqns".to_owned(),
            layout: LayoutKind::Env {
                env: "bmatrix".to_owned(),
                cols: 2,
            },
            auto_join: None,
        })
        .unwrap();

        let json = lib.to_json_pretty();
        let restored = UserLibrary::from_json(&json).unwrap();
        assert_eq!(restored, lib, "env 布局必须完整序列化/反序列化");

        let doc = parse_with_library("▸kzx + 1;y^2;a - b;0;", &restored);
        assert_eq!(
            to_latex(&doc),
            "\\begin{bmatrix}x + 1 & y^{2} \\\\ a - b & 0\\end{bmatrix}"
        );
        assert_eq!(to_scheme_a(&doc), "eqns[x + 1, y^2; a - b, 0]");

        // 2. autoJoin：三槽 极限变体（变量 ; 目标 ; 主体），目标为空时自动省略 \to
        lib.upsert_custom(CustomFormat {
            item_key: 'y',
            label: "条件函数".to_owned(),
            glyph_hint: "f(x)→y".to_owned(),
            slot_roles: vec![
                "自变量".to_owned(),
                "趋近目标".to_owned(),
                "主体".to_owned(),
            ],
            latex_template: "f($1) $3".to_owned(),
            scheme_a_name: "fjoin".to_owned(),
            layout: LayoutKind::Linear,
            auto_join: Some(AutoJoin {
                base_slot: 0,
                cond_slot: 1,
                macro_tex: "\\to".to_owned(),
            }),
        })
        .unwrap();

        // 目标槽非空 -> 拼接 `x \to 0`
        let doc2 = parse_with_library("▸kyx;0; \\ge 1", &lib);
        assert_eq!(to_latex(&doc2), "f(x \\to 0) \\ge 1");
        assert_eq!(to_scheme_a(&doc2), "fjoin(x \\to 0, , \\ge 1)");
        // 目标槽为空 -> 自动省略 `\to`
        let doc3 = parse_with_library("▸kyx;; \\ge 1", &lib);
        assert_eq!(to_latex(&doc3), "f(x) \\ge 1");

        // 3. upsert 校验：autoJoin 槽位下标越界 / env 列数不整除 roles 均报错
        assert!(lib
            .upsert_custom(CustomFormat {
                item_key: 'y',
                label: "坏".to_owned(),
                glyph_hint: String::new(),
                slot_roles: vec!["a".to_owned()],
                latex_template: "$1".to_owned(),
                scheme_a_name: "x".to_owned(),
                layout: LayoutKind::Linear,
                auto_join: Some(AutoJoin {
                    base_slot: 0,
                    cond_slot: 5,
                    macro_tex: "\\to".to_owned(),
                }),
            })
            .is_err());
        assert!(lib
            .upsert_custom(CustomFormat {
                item_key: 'z',
                label: "坏".to_owned(),
                glyph_hint: String::new(),
                slot_roles: vec!["a".to_owned(), "b".to_owned(), "c".to_owned()],
                latex_template: String::new(),
                scheme_a_name: "x".to_owned(),
                layout: LayoutKind::Env {
                    env: "pmatrix".to_owned(),
                    cols: 2,
                },
                auto_join: None,
            })
            .is_err());

        // 4. $n 越界占位符不再原样漏进 LaTeX
        lib.upsert_custom(CustomFormat {
            item_key: 'w',
            label: "越界模板".to_owned(),
            glyph_hint: String::new(),
            slot_roles: vec!["唯一槽".to_owned()],
            latex_template: "[$1,$3]".to_owned(),
            scheme_a_name: "oob".to_owned(),
            layout: LayoutKind::Linear,
            auto_join: None,
        })
        .unwrap();
        let doc4 = parse_with_library("▸kwq;", &lib);
        assert_eq!(to_latex(&doc4), "[q,□]");
    }

    #[test]
    fn test_save_and_reuse_complex_snippets_and_templates() {
        // 1. 用户输入一段复杂公式后，将光标处的复杂根式存为复用片段，并在新公式中一键调用！
        let mut ed = StreamEditor::from_source("x = ▸f-b + ▸rb^2 - 4ac;;2a;");
        ed.set_cursor(14); // 位于内层根式 `▸rb^2 - 4ac;` 内部
        let (key, _) = ed.save_current_as_snippet(Some("判别式根号"), true).unwrap();
        assert_eq!(key, 'd'); // a,b,c 为初始预置，自动分配到 'd'

        ed.clear();
        ed.source = format!("y = 1 + ▸t{key}");
        let end = ed.source.chars().count();
        ed.sync_after_edit(end);
        assert_eq!(ed.source, "y = 1 + ▸rb^2 - 4ac;");
        assert_eq!(to_latex(&ed.parsed), "y = 1 + \\sqrt{b^{2} - 4ac}");

        // 2. 调用带空槽的填空模版 `▸tb`（`▸i-oo;oo;;dx`）：自动展开并精准停在被积函数空槽内！
        ed.clear();
        ed.apply_card_click("tb");
        assert_eq!(ed.source, "▸i-oo;oo;;dx");
        assert_eq!(ed.cursor_char, 9); // 停在 `▸i-oo;oo;|;dx` 被积式槽内！
        ed.type_text("e^{-x^2}");
        assert_eq!(
            to_latex(&ed.parsed),
            "\\int_{-\\infty}^{\\infty} e^{-x^{2}} \\mathrm{d}x"
        );
    }

    #[test]
    fn test_end_of_line_jump_and_jump_back_history_with_edit_shift() {
        let mut ed = StreamEditor::from_source("▸fx + 1;y - 1;");
        let initial_end = ed.cursor_char;
        assert_eq!(initial_end, 14);

        // 1. 按 Esc a 跳到行首 (0)，记录 jump_back_pos = 14
        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('a');
        assert_eq!(ed.cursor_char, 0);
        assert_eq!(ed.jump_back_pos, Some(14));

        // 2. 在行首插入 `"k + "`（4 个字符），`jump_back_pos` 自动同步平移为 `18`！
        ed.source.insert_str(0, "k + ");
        ed.sync_after_edit(4);
        assert_eq!(ed.jump_back_pos, Some(18));

        // 3. 按 Esc - 跳回上一个跳转位置（精准回到行尾 18！），再按 Esc - 乒乓切回 4！
        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('-');
        assert_eq!(ed.cursor_char, 18);
        assert_eq!(ed.jump_back_pos, Some(4));

        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('-');
        assert_eq!(ed.cursor_char, 4);

        // 4. 按 Esc ;（或内联 `▸j.`）从任意位置一步跳到整行最末尾 `[;]`（跨出闭合分号）！
        ed.toggle_esc_jump();
        ed.feed_esc_jump_char(';');
        assert_eq!(ed.cursor_char, 18);
    }

    #[test]
    fn test_intuitive_2d_arrow_navigation_and_atomic_skip() {
        // 分数 `▸fnum;den;`：分子 <-> 分母 上下直觉穿梭
        let mut ed = StreamEditor::from_source("▸fnum;den;");
        ed.set_cursor(5); // 在分子 `num|`
        ed.arrow_vertical(false); // Down -> 分母 `den|`
        assert_eq!(ed.cursor_char, 9);
        ed.arrow_vertical(true); // Up -> 回到分子 `num|`
        assert_eq!(ed.cursor_char, 5);

        // 原子跳过 `▸f`：光标在 `▸f|num;den;` (index 2)，按 Left 一步跨到 `|▸fnum;den;` (index 0)
        ed.set_cursor(2);
        assert!(ed.arrow_horizontal(true).is_some());
        assert_eq!(ed.cursor_char, 0);
        assert!(ed.arrow_horizontal(false).is_some());
        assert_eq!(ed.cursor_char, 2);

        // 嵌套根号 `▸r1+▸rx;;`：在内层根号 `x|` 按 Up 直接跳出内层根号到外层！
        let mut root_ed = StreamEditor::from_source("▸r1+▸rx;;");
        root_ed.set_cursor(7); // 内层 `x|`
        root_ed.arrow_vertical(true);
        assert_eq!(root_ed.cursor_char, 8); // 外层 `▸r1+▸rx;|;`

        // 导航模式 (esc_nav) 下方向键不丢失导航态
        let mut nav_ed = StreamEditor::from_source("▸fnum;den;");
        nav_ed.set_cursor(5);
        nav_ed.toggle_esc_jump();
        assert!(nav_ed.esc_nav.is_some());
        // 在导航模式下按 Down -> 应垂直跳至分母并保持 esc_nav
        let res_down = nav_ed.arrow_vertical(false);
        assert!(res_down.is_some());
        assert_eq!(nav_ed.cursor_char, 9);
        assert!(nav_ed.esc_nav.is_some(), "arrow_vertical(false) must not clear esc_nav");
        // 在导航模式下按 Up -> 应垂直回到分子并保持 esc_nav
        let res_up = nav_ed.arrow_vertical(true);
        assert!(res_up.is_some());
        assert_eq!(nav_ed.cursor_char, 5);
        assert!(nav_ed.esc_nav.is_some(), "arrow_vertical(true) must not clear esc_nav");
        // 已经在最顶层再按 Up -> 不会闪退退出导航模式
        let res_top_up = nav_ed.arrow_vertical(true);
        assert!(res_top_up.is_some());
        assert!(nav_ed.esc_nav.is_some(), "Up at root in esc_nav must preserve esc_nav");
    }

    #[test]
    fn test_nested_roots_active_level_distinction() {
        let inner = parse("▸r1+▸rx");
        assert_eq!(
            inner
                .innermost_active_slot_span(7)
                .map(|s| (s.start.char_idx, s.end.char_idx)),
            Some((6, 7))
        );
        let p_inner = build_preview_latex(&inner, 7, VisualDialect::LatexRust);
        assert!(
            p_inner.contains("\\sqrt{1+\\sqrt{\\fcolorbox{msGfg}{msGsbg}{x"),
            "inner root should be green-scoped, got: {p_inner}"
        );

        let outer = parse("▸r1+▸rx;");
        assert_eq!(
            outer
                .innermost_active_slot_span(8)
                .map(|s| (s.start.char_idx, s.end.char_idx)),
            Some((2, 8))
        );
        let p_outer = build_preview_latex(&outer, 8, VisualDialect::LatexRust);
        assert!(
            p_outer.starts_with("\\sqrt{\\fcolorbox{msGfg}{msGsbg}{1+\\sqrt{x}"),
            "outer root should be green-scoped with inner root unboxed, got: {p_outer}"
        );

        let root = parse("▸r1+▸rx;;");
        assert_eq!(root.innermost_active_slot_span(9), None);
        let p_root = build_preview_latex(&root, 9, VisualDialect::LatexRust);
        assert!(
            p_root.starts_with("\\sqrt{1+\\sqrt{x}} \\textcolor{msGfg}{\\pmb{\\lvert}}"),
            "both roots closed and caret outside at root, got: {p_root}"
        );
    }

    #[test]
    fn test_single_letter_fraction_and_consecutive_tab() {
        let doc = parse("▸fx+1;y");
        assert_eq!(to_scheme_a(&doc), "frac(x+1, y)");
        assert_eq!(to_latex(&doc), "\\frac{x+1}{y}");

        let mut ed = StreamEditor::from_source("▸f");
        ed.handle_tab();
        assert_eq!(ed.source, "▸f▸");
        ed.source.push_str("rx;;y");
        let len = ed.source.chars().count();
        ed.sync_after_edit(len);
        assert_eq!(to_latex(&ed.parsed), "\\frac{\\sqrt{x}}{y}");
    }

    #[test]
    fn test_submenu_default_selection_and_fallback() {
        let mut ed = StreamEditor::from_source("▸m");
        ed.smart_enter();
        assert_eq!(ed.source, "▸ma");

        let doc = parse("▸m1;2;3;4;");
        assert_eq!(to_scheme_a(&doc), "mat2(1, 2; 3, 4)");
        assert_eq!(
            to_latex(&doc),
            "\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}"
        );
    }

    #[test]
    fn test_start_of_line_slot_a_and_hierarchical_esc_jump() {
        let mut ed = StreamEditor::from_source("▸i0;▸i1;t;g(u) du;;f(x) dx");

        // 含行首 `[a]`、3 个积分槽位 `b, c+, d` 与行尾 `[;]` 共 5 个锚点
        assert_eq!(ed.parsed.root_scope.entries.len(), 5);
        assert!(matches!(
            ed.parsed.root_scope.entries[0].kind,
            NavEntryKind::ScopeStart
        ));
        assert_eq!(ed.parsed.root_scope.entries[0].label, "a");
        assert_eq!(ed.parsed.root_scope.entries[1].label, "b");
        assert_eq!(ed.parsed.root_scope.entries[2].label, "c");
        assert!(matches!(
            ed.parsed.root_scope.entries[2].kind,
            NavEntryKind::Composite { .. }
        ));
        assert_eq!(ed.parsed.root_scope.entries[3].label, "d");
        assert_eq!(ed.parsed.root_scope.entries[4].label, ";");
        assert!(matches!(
            ed.parsed.root_scope.entries[4].kind,
            NavEntryKind::ScopeEnd
        ));

        // 1. Esc + a 一步跳回整行最前面 (char_idx == 0)
        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('a');
        assert!(ed.esc_nav.is_none());
        assert_eq!(ed.cursor_char, 0);
        assert!(ed.parsed.breadcrumbs_at(0).is_empty());

        // 2. Esc + c 展开上限复合槽 `[c+]`，再按 b 跳入内层积分的下限 `1|`
        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('c');
        assert_eq!(
            ed.esc_nav.as_ref().map(|s| s.path.clone()),
            Some(vec!["c".to_owned()])
        );
        ed.feed_esc_jump_char('b');
        assert!(ed.esc_nav.is_none());
        assert_eq!(ed.cursor_char, 7);
    }

    #[test]
    fn test_inline_hierarchical_jump_consumes_command() {
        let mut ed = StreamEditor::from_source("▸i0;▸i1;t;g(u) du;;f(x) dx");
        ed.source.push_str("▸jcc");
        let len = ed.source.chars().count();
        let msg = ed.sync_after_edit(len);
        assert!(msg.is_some());
        assert_eq!(ed.source, "▸i0;▸i1;t;g(u) du;;f(x) dx");
        assert_eq!(ed.cursor_char, 9);
    }

    #[test]
    fn test_tab_j_triggers_navigation_mode() {
        let mut ed = StreamEditor::from_source("▸fx+1;y;");
        ed.set_cursor(ed.source.chars().count());
        // 用户顺序键入 Tab 然后 j（在单行输入流中表现为追加 "▸j"）
        ed.source.push_str("▸j");
        let len = ed.source.chars().count();
        let msg = ed.sync_after_edit(len);
        assert!(msg.is_some());
        // ▸j 被自动剥除，源公式无污染
        assert_eq!(ed.source, "▸fx+1;y;");
        // esc_nav 成功激活进入导航态
        assert!(ed.esc_nav.is_some());
        // 键入字母直达目标槽位并退出导航态
        ed.feed_esc_jump_char('b');
        assert!(ed.esc_nav.is_none());
        assert_eq!(ed.cursor_char, 5);
    }

    #[test]
    fn test_deeply_nested_unclosed_jump_materializes_exact_semis() {
        let mut ed = StreamEditor::from_source("▸i0;▸f1");
        ed.jump_to_sequence("d").unwrap();
        assert_eq!(ed.source, "▸i0;▸f1;;;");
        assert_eq!(ed.cursor_char, 10);
    }

    #[test]
    fn test_smart_enter_progression_and_safe_step_over() {
        let mut ed = StreamEditor::from_source("▸fx");
        ed.smart_enter();
        assert_eq!(ed.source, "▸fx;");
        assert_eq!(ed.cursor_char, 4);

        ed.source.push('y');
        let c = ed.source.chars().count();
        ed.sync_after_edit(c);
        ed.smart_enter();
        assert_eq!(ed.source, "▸fx;y;");
        assert_eq!(ed.cursor_char, 6);

        ed.jump_to_sequence("b").unwrap();
        assert_eq!(ed.cursor_char, 3);
        ed.smart_enter();
        assert_eq!(ed.source, "▸fx;y;");
        assert_eq!(ed.cursor_char, 4);
    }

    #[test]
    fn test_greek_symbol_and_extended_integrals() {
        let doc = parse("▸gax + ▸oa + ▸ccD;f(x,y) dx dy;");
        assert_eq!(to_scheme_a(&doc), "alpha x + oo + iint(D, f(x,y) dx dy)");
        assert_eq!(
            to_latex(&doc),
            "\\alpha x + \\infty + \\iint_{D} f(x,y) \\,\\mathrm{d}x \\,\\mathrm{d}y"
        );

        // 验证完整希腊字母表解析：小写与大写字母精确区分
        let full_greek_doc = parse("▸ga ▸gb ▸gz ▸gh ▸gu ▸gv ▸gq ▸gy ▸go ▸gC ▸gD ▸gT ▸gL ▸gX ▸gP ▸gS ▸gU ▸gF ▸gY ▸gO");
        assert_eq!(
            to_latex(&full_greek_doc),
            "\\alpha \\beta \\zeta \\eta \\tau \\upsilon \\chi \\psi \\omega \\Gamma \\Delta \\Theta \\Lambda \\Xi \\Pi \\Sigma \\Upsilon \\Phi \\Psi \\Omega"
        );
    }

    #[test]
    fn test_vimium_labels_prefix_free() {
        for count in [1, 5, 26, 27, 30, 52, 120] {
            let labels = generate_nav_labels(count);
            assert_eq!(labels.len(), count);
            for (i, l1) in labels.iter().enumerate() {
                for (j, l2) in labels.iter().enumerate() {
                    if i != j {
                        assert!(
                            !l1.starts_with(l2),
                            "count={count}: `{l1}` starts with `{l2}`"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn test_text_to_latex_and_presets() {
        assert_eq!(text_to_latex("a <= b -> oo"), "a \\le b \\to \\infty");
        assert_eq!(text_to_latex("x^(n+1) + alpha"), "x^{n+1} + \\alpha");

        let q = parse("x = ▸f-b +- ▸rb^2 - 4ac;;2a;");
        assert_eq!(to_scheme_a(&q), "x = frac(-b +- sqrt(b^2 - 4ac), 2a)");
        assert_eq!(to_latex(&q), "x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}");

        // 验证全部 12 项预置数学公式均能完整解析且生成合规 LaTeX
        let presets = [
            "x = ▸f-b +- ▸rb^2 - 4ac;;2a;",
            "▸i-oo;oo;e▸u-x^2;;dx = ▸r▸gp;;",
            "e▸ui▸gp;; + 1 = 0",
            "▸lx;0;▸fsin x;x;; = 1",
            "▸p▸s1;n;a_k b_k;;^2 <= ▸p▸s1;n;a_k^2;; ▸p▸s1;n;b_k^2;;",
            "P(A|B) = ▸fP(B|A) P(A);P(B);",
            "f(x) = ▸s0;n;▸ff^(k)(x_0);k!;(x - x_0)^k; + R_n(x)",
            "i▸ol ▸cg▸gy;t; = ▸aaH; ▸gy",
            "▸od xx E = -▸cgB;t;",
            "▸mc▸gl - a;-b;-c;▸gl - d; = 0",
            "▸mg1;0;0;0;1;0;0;0;1;",
            "▸ia;b;f'(x) dx = ▸kgf(x);a;b; = f(b) - f(a)",
        ];
        let lib = UserLibrary::default_seeded();
        for preset in presets {
            let doc = parse_with_library(preset, &lib);
            let tex = to_latex(&doc);
            assert!(!tex.is_empty(), "Preset `{preset}` produced empty latex");
        }
    }

    #[test]
    fn test_new_structures_and_relation_setlogic_symbols() {
        // ▸e 二项式直达 + m 组扩展（bmatrix / 三分支 cases）+ a 组扩展（范数/上划线）
        let doc = parse("▸en;k; + ▸me1;2;3;4; + ▸mfx<0;y=1;y>1;y=2;y>2;y=3; + ▸afv; + ▸agx;");
        assert_eq!(
            to_latex(&doc),
            "\\binom{n}{k} + \\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix} \
             + \\begin{cases} x<0 & y=1 \\\\ y>1 & y=2 \\\\ y>2 & y=3 \\end{cases} \
             + \\left\\Vert v\\right\\Vert + \\overline{x}"
        );
        assert_eq!(
            to_scheme_a(&doc),
            "binom(n, k) + mat2[1, 2; 3, 4] \
             + cases(x<0, y=1; y>1, y=2; y>2, y=3) + norm(v) + overline(x)"
        );

        // x 组关系符与 q 组集合/逻辑符号
        let doc2 = parse("▸xaa + ▸xb1 + ▸xePQ + ▸qi + ▸qaAB;");
        assert_eq!(
            to_latex(&doc2),
            "\\equiv a + \\approx1 + \\Rightarrow PQ + \\mathbb{R} + \\cup AB"
        );
        assert_eq!(
            to_scheme_a(&doc2),
            "equiv a + approx 1 + implies PQ + R + cup AB"
        );

        // 深嵌套输入受递归深度上限保护（不 panic、不栈溢出）
        let deep: String = "▸f".repeat(5000);
        let _ = parse(&deep);
    }

    #[test]
    fn test_custom_env_2d_arrow_navigation_and_smart_prepend() {
        let mut lib = UserLibrary::default_seeded();
        // 注册 2×3 矩阵自定义格式 (item_key: 'm')
        lib.upsert_custom(CustomFormat {
            item_key: 'm',
            label: "3列矩阵".to_owned(),
            glyph_hint: "2x3".to_owned(),
            slot_roles: vec![
                "r1c1".to_owned(),
                "r1c2".to_owned(),
                "r1c3".to_owned(),
                "r2c1".to_owned(),
                "r2c2".to_owned(),
                "r2c3".to_owned(),
            ],
            latex_template: String::new(),
            scheme_a_name: "m3".to_owned(),
            layout: LayoutKind::Env {
                env: "pmatrix".to_owned(),
                cols: 3,
            },
            auto_join: None,
        })
        .unwrap();

        // 1. 验证 2D 上下方向键穿槽在自定义 Env 矩阵中正常按列对齐跨行
        // 构造：▸kma;b;c;d;e;f;
        // slot0=a, slot1=b, slot2=c (行0)
        // slot3=d, slot4=e, slot5=f (行1)
        let mut ed = StreamEditor::from_source_with_library("▸kma;b;c;d;e;f;", lib.clone());
        // 定位到 slot4 (e) 末尾
        let e_pos = ed.source.find('e').unwrap() + 1;
        ed.cursor_char = e_pos;
        // 按 Up：跨行向上应到达 slot1 (b)
        let res_up = ed.arrow_vertical(true);
        assert!(res_up.is_some(), "Up arrow should navigate in Env matrix");
        let b_pos = ed.source.find('b').unwrap() + 1;
        assert_eq!(ed.cursor_char, b_pos, "ArrowUp from slot4 should jump to slot1");
        // 从 slot1 按 Down：跨行向下应回到 slot4 (e)
        let res_down = ed.arrow_vertical(false);
        assert!(res_down.is_some());
        assert_eq!(ed.cursor_char, e_pos, "ArrowDown from slot1 should jump back to slot4");

        // 2. 验证自定义单槽格式的前置智能包裹 (Smart Prepend)
        // 预置的 kb 为双线范数 `\Vert $1 \Vert` (单槽)
        let mut ed2 = StreamEditor::from_source_with_library("u + v = w", lib);
        ed2.cursor_char = 0;
        // 在行首插入 `▸kb`
        ed2.source.insert_str(0, "▸kb");
        ed2.sync_after_edit(3); // 模拟在位置 3 完成输入
        // 自动吞并 `u + v` 为范数参数，等号保留在外，光标位于结构内部开头
        assert_eq!(ed2.source, "▸kbu + v; = w");
        assert_eq!(ed2.cursor_char, 3);
    }

    #[test]
    fn test_jump_history_pn_and_no_collision_with_nav_labels() {
        // 1. 验证生成的所有导航徽标严格不包含 'p' 和 'n'
        for count in [1, 5, 20, 24, 25, 50, 100, 200] {
            let labels = generate_nav_labels(count);
            assert_eq!(labels.len(), count);
            for l in &labels {
                assert!(
                    !l.contains('p') && !l.contains('n'),
                    "Nav label `{l}` should not contain 'p' or 'n'"
                );
            }
        }

        // 2. 验证真正的跳转历史前进/后退栈 (Jump History pn)
        let mut ed = StreamEditor::from_source("▸fx+1;y; + ▸fa;b;");
        ed.set_cursor(0);

        // 用户连续跳到各个位置：0 -> b (3) -> d (11) -> c (7)
        ed.jump_to_sequence("b").unwrap();
        let pos_b = ed.cursor_char;
        ed.jump_to_sequence("d").unwrap();
        let pos_d = ed.cursor_char;
        ed.jump_to_sequence("c").unwrap();
        let pos_c = ed.cursor_char;

        // 连续按 Esc p 沿历史回溯：c -> d -> b -> 0
        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('p');
        assert_eq!(ed.cursor_char, pos_d, "1st Esc p should go back to pos_d");

        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('p');
        assert_eq!(ed.cursor_char, pos_b, "2nd Esc p should go back to pos_b");

        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('p');
        assert_eq!(ed.cursor_char, 0, "3rd Esc p should go back to 0");

        // 连续按 Esc n 沿历史前进：0 -> b -> d -> c
        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('n');
        assert_eq!(ed.cursor_char, pos_b, "1st Esc n should go forward to pos_b");

        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('n');
        assert_eq!(ed.cursor_char, pos_d, "2nd Esc n should go forward to pos_d");

        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('n');
        assert_eq!(ed.cursor_char, pos_c, "3rd Esc n should go forward to pos_c");

        // 验证 Esc h (Head 行首) 与 Esc t (Tail 行尾)
        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('h');
        assert_eq!(ed.cursor_char, 0);

        ed.toggle_esc_jump();
        ed.feed_esc_jump_char('t');
        assert_eq!(ed.cursor_char, ed.source.chars().count());
    }

    #[test]
    fn test_direct_custom_free_letter() {
        let mut lib = UserLibrary::default_seeded();
        // 绑定未占用单字母 'w'（无需加 k，直接 Tab w 触发！）
        lib.upsert_custom(CustomFormat {
            item_key: 'w',
            label: "期望算子".to_owned(),
            glyph_hint: "E[X]".to_owned(),
            slot_roles: vec!["随机变量".to_owned()],
            latex_template: "\\mathbb{E}\\left[ $1 \\right]".to_owned(),
            scheme_a_name: "E".to_owned(),
            layout: LayoutKind::Linear,
            auto_join: None,
        })
        .unwrap();

        // 1. 直接输入 `▸wx; = 0`，无需前缀 `k`
        let doc = parse_with_library("▸wx; = 0", &lib);
        assert_eq!(to_latex(&doc), "\\mathbb{E}\\left[ x \\right] = 0");
        assert_eq!(to_scheme_a(&doc), "E(x) = 0");

        // 2. 前置智能包裹直接支持单字母直达自定义格式
        let mut ed = StreamEditor::from_source_with_library("X + Y = Z", lib);
        ed.set_cursor(0);
        ed.source.insert_str(0, "▸w");
        ed.sync_after_edit(2); // 光标在 `▸w` 末尾
        assert_eq!(ed.source, "▸wX + Y; = Z");
        assert_eq!(ed.cursor_char, 2);
    }

    #[test]
    fn test_latex_to_mathslot_converter_and_grouping() {
        use crate::latex::latex_to_mathslot;

        // 1. 分数、根号、极限反向转换
        let s1 = latex_to_mathslot(r"\frac{a + 1}{b - 1}");
        assert_eq!(s1, "▸fa + 1;b - 1;");

        let s2 = latex_to_mathslot(r"\sqrt{x^2 + y^2}");
        assert_eq!(s2, "▸rx^2 + y^2;");

        let s3 = latex_to_mathslot(r"\lim_{x \to 0} \frac{\sin x}{x}");
        assert_eq!(s3, "▸lx;0;▸fsin x;x;;");

        // 2. 定积分、求和
        let s4 = latex_to_mathslot(r"\int_{0}^{1} x^2 dx");
        assert_eq!(s4, "▸i0;1;x^2 dx;");

        let s5 = latex_to_mathslot(r"\sum_{k=1}^{n} k");
        assert_eq!(s5, "▸sk=1;n;k;");

        // 3. 剥离外围定界符 $$...$$ 与 $...$
        let s6 = latex_to_mathslot(r"$$ \frac{1}{2} $$");
        assert_eq!(s6, "▸f1;2;");

        // 4. 标准 LaTeX 文本花括号分组透传
        let doc = parse("x + {a + b} + \\mathbf{v}");
        assert_eq!(to_latex(&doc), "x + {a + b} + \\mathbf{v}");
    }
}

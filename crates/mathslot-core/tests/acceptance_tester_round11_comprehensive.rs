//! MathSlot Comprehensive Adversarial Acceptance Test Suite (Round 11 Final)
//!
//! Written by: Acceptance Agent (Software Quality & Acceptance Expert)
//! Principles:
//! - 100% Independent verification, zero trust in documentation claims
//! - Objective ground-truth testing against REWRITE_DESIGN.md Section 13
//! - Complete static and dynamic coverage of Zero-Modal, Live Preview, and Semantic Layouts

use mathslot_core::{
    exprs_structurally_equal, inspect_environment, parse, Edit, EnvironmentShape,
    MatrixEnv, Session, SlotId,
};
use std::path::Path;

// =============================================================================
// TEST GROUP 1: LaTeX Import & Export Lossless Roundtrip Matrix
// =============================================================================

#[test]
fn test_adv_acc_01_latex_lossless_roundtrip_core_spec() {
    let test_matrix = [
        ("Spec 1.1 Gaussian power", r"e^{-x^{2}}"),
        ("Spec 1.2 Polynomial script", r"x^{a+b}"),
        ("Spec 1.3 Subscript increment", r"a_{i+1}"),
        ("Spec 1.4 Fraction in exponent", r"e^{-\frac{x}{2}}"),
        ("Spec 1.5 Deep power tower", r"x^{y^{z}}"),
        ("Spec 1.6 Double negative exponential", r"e^{-e^{-x}}"),
        ("Spec 1.7 Gaussian integral with bounds", r"\int_{-\infty}^{\infty} e^{-x^{2}} dx"),
        ("Spec 1.8 Fraction with script in denom", r"\frac{1}{\sqrt{2\pi\sigma^{2}}}"),
        ("Spec 1.9 Linear system equation", r"\lambda x + \mu y = 0"),
        ("Spec 1.10 Nested radicals", r"\sqrt{1 + \sqrt{1 + x^{2}}}"),
    ];

    for (desc, latex) in test_matrix {
        let (session, report) = Session::from_latex(latex);
        assert!(
            report.lossless,
            "[{desc}] Expected lossless roundtrip for '{latex}', but got: {report:?}"
        );
        assert_eq!(report.empty_slots, 0, "[{desc}] Must have 0 empty slots for '{latex}'");
        assert_eq!(report.raw_nodes, 0, "[{desc}] Must have 0 raw nodes for '{latex}'");
        assert!(report.diagnostics.is_empty(), "[{desc}] Diagnostics must be empty for '{latex}'");

        let exported = session.to_latex();
        let (ast_orig, d_orig) = parse(latex);
        let (ast_exp, d_exp) = parse(&exported);
        assert!(d_orig.is_empty(), "[{desc}] Original parse had diagnostics: {d_orig:?}");
        assert!(d_exp.is_empty(), "[{desc}] Exported parse had diagnostics: {d_exp:?}");

        assert!(
            exprs_structurally_equal(&ast_orig, &ast_exp),
            "[{desc}] AST structural mismatch!\nOriginal: {latex}\nExported: {exported}"
        );
    }
}

#[test]
fn test_adv_acc_02_big_op_left_right_ghost_slots_eliminated() {
    let big_op_cases = [
        ("Sum with left-right parens", r"\sum_{i=1}^{n} \left( x_{i} + y_{i} \right)"),
        ("Integral with left-right parens", r"\int_{0}^{1} \left( 1 - x^{2} \right) dx"),
        ("Product with left-right parens", r"\prod_{k=1}^{n} \left( 1 + \frac{1}{k} \right)"),
        ("Double integral with delimiters", r"\iint_{D} \left( x^{2} + y^{2} \right) dx dy"),
        ("Limit with delimiters", r"\lim_{x \to 0} \left( \frac{\sin x}{x} \right)"),
    ];

    for (desc, formula) in big_op_cases {
        let (session, report) = Session::from_latex(formula);
        assert!(report.lossless, "[{desc}] Must be lossless");
        assert_eq!(report.empty_slots, 0, "[{desc}] Must have 0 empty slots, found ghost slots!");
        assert_eq!(report.raw_nodes, 0, "[{desc}] Must have 0 raw nodes");

        let exported = session.to_latex();
        assert!(
            !exported.contains("▸j"),
            "[{desc}] Exported LaTeX must not contain in-band control markers: {exported}"
        );
    }
}

#[test]
fn test_adv_acc_03_matrices_and_environments() {
    let env_cases = [
        (
            "2x2 pmatrix",
            r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
            MatrixEnv::Pmatrix,
            2,
            2,
        ),
        (
            "3x3 bmatrix identity",
            r"\begin{bmatrix} 1 & 0 & 0 \\ 0 & 1 & 0 \\ 0 & 0 & 1 \end{bmatrix}",
            MatrixEnv::Bmatrix,
            3,
            3,
        ),
        (
            "2x2 vmatrix determinant",
            r"\begin{vmatrix} \lambda - 1 & 2 \\ 3 & \lambda - 4 \end{vmatrix}",
            MatrixEnv::Vmatrix,
            2,
            2,
        ),
    ];

    for (desc, tex, expected_env, expected_rows, expected_cols) in env_cases {
        let (session, report) = Session::from_latex(tex);
        assert!(report.lossless, "[{desc}] Matrix must be parsed losslessly");
        let doc = session.doc();
        assert!(!doc.nodes.is_empty(), "[{desc}] Node list cannot be empty");

        let shape = inspect_environment(&doc.nodes[0]);
        assert_eq!(
            shape,
            Some(EnvironmentShape {
                env: expected_env,
                rows: expected_rows,
                cols: expected_cols,
                is_rectangular: true,
            }),
            "[{desc}] Environment shape mismatch"
        );
    }
}

// =============================================================================
// TEST GROUP 2: CST & AST Correctness, Degradation Diagnostics & Error Tolerance
// =============================================================================

#[test]
fn test_adv_acc_04_degradation_diagnostics_on_exotic_and_malformed() {
    // 2.1 未知奇异宏优雅降级为 Raw 节点，报告有损并提供诊断
    let exotic_cases = [
        (r"\myExoticTensorMacro[alpha,beta]{T_{ij}}{g^{kl}}", "myExoticTensorMacro"),
        (r"\xymatrix{ A \ar[r] & B }", "xymatrix"),
        (r"\unknowncustom{foo} + 1", "unknowncustom"),
    ];
    for (input, macro_name) in exotic_cases {
        let (session, report) = Session::from_latex(input);
        assert!(!report.lossless, "Exotic macro '{macro_name}' must be lossy");
        assert!(report.raw_nodes > 0, "Exotic macro '{macro_name}' must produce raw node");
        assert!(!report.diagnostics.is_empty(), "Must produce clear diagnostic messages");
        assert!(report.has_warnings(), "has_warnings must be true");
        let exported = session.to_latex();
        assert!(
            exported.contains(macro_name),
            "Raw fallback must preserve exotic macro text without silent loss: {exported}"
        );
    }

    // 2.2 待填充空槽检测
    let empty_slot_inputs = ["▸f;;", r"\frac{}{2}"];
    for input in empty_slot_inputs {
        let (_session, rep) = Session::from_latex(input);
        assert!(
            rep.empty_slots >= 1,
            "Input '{input}' must detect empty slots, got: {}",
            rep.empty_slots
        );
    }

    // 2.3 畸形残缺结构容错与安全恢复 (绝不 panic)
    let malformed_inputs = [
        (r"\frac{a}{", "Unclosed fraction brace"),
        (r"\sqrt[3]{x", "Unclosed root brace"),
        (r"x^{", "Trailing open superscript"),
        (r"\begin{pmatrix} 1 & 2 \\ 3 \end{pmatrix}", "Ragged matrix row"),
    ];

    for (input, reason) in malformed_inputs {
        let (session, _rep) = Session::from_latex(input);
        // 不崩溃、不 panic，产生合法 session
        let out = session.to_latex();
        assert!(!out.is_empty(), "Malformed input ({reason}) must produce non-empty recovered output");
    }
}

// =============================================================================
// TEST GROUP 3: Transaction & Undo/Redo Invariants
// =============================================================================

#[test]
fn test_adv_acc_05_transaction_undo_redo_deep_chain() {
    let initial = r"\frac{x + 1}{y - 1}";
    let (mut session, report) = Session::from_latex(initial);
    assert!(report.lossless);
    let original_latex = session.to_latex();

    let slots: Vec<SlotId> = session.doc().slots.slots().iter().map(|s| s.id).collect();
    assert_eq!(slots.len(), 2, "Fraction must have exactly 2 slots");

    // 操作 1: 替换分子
    session
        .apply_edit(
            Edit::ReplaceSlot {
                slot_id: slots[0],
                new_nodes: parse(r"\alpha \beta + \gamma").0,
            },
            "edit numerator",
        )
        .expect("Edit num succeed");
    let after_step1 = session.to_latex();
    assert_ne!(after_step1, original_latex);
    assert!(after_step1.contains("alpha"));

    // 操作 2: 替换分母
    session
        .apply_edit(
            Edit::ReplaceSlot {
                slot_id: slots[1],
                new_nodes: parse(r"\sqrt{z^{2} + 1}").0,
            },
            "edit denominator",
        )
        .expect("Edit denom succeed");
    let after_step2 = session.to_latex();
    assert_ne!(after_step2, after_step1);
    assert!(after_step2.contains("sqrt"));

    // 撤销步 2 -> 还原至 step1
    assert!(session.undo(), "Undo 1 must succeed");
    assert_eq!(session.to_latex(), after_step1);

    // 撤销步 1 -> 还原至 original
    assert!(session.undo(), "Undo 2 must succeed");
    assert_eq!(session.to_latex(), original_latex);

    // 再次撤销 -> 返回 false
    assert!(!session.undo(), "No more undos available");
    assert_eq!(session.to_latex(), original_latex);

    // 重做步 1 -> 恢复 step1
    assert!(session.redo(), "Redo 1 must succeed");
    assert_eq!(session.to_latex(), after_step1);

    // 重做步 2 -> 恢复 step2
    assert!(session.redo(), "Redo 2 must succeed");
    assert_eq!(session.to_latex(), after_step2);

    // 再次重做 -> 返回 false
    assert!(!session.redo(), "No more redos available");
}

// =============================================================================
// TEST GROUP 4: Navigation & Anchors
// =============================================================================

#[test]
fn test_adv_acc_06_navigation_slots_and_anchors() {
    let formula = r"\int_{0}^{\infty} \frac{x^{2}}{e^{x} - 1} dx";
    let (session, report) = Session::from_latex(formula);
    assert!(report.lossless);

    let doc = session.doc();
    let slot_count = doc.slots.slots().len();
    assert!(
        slot_count >= 4,
        "Integral fraction must have lower limit, upper limit, numerator, denominator slots (got {slot_count})"
    );

    // 验证每个 slot 的 anchor label (若存在) 不包含内联控制符
    for slot in doc.slots.slots() {
        if let Some(lbl) = &slot.label {
            assert!(!lbl.is_empty(), "Slot {:?} label if present must not be empty", slot.id);
            assert!(
                !lbl.contains('▸'),
                "Slot label must not contain in-band ▸ control symbol: {lbl}"
            );
        }
    }
}

// =============================================================================
// TEST GROUP 5: Zero-Modal Architecture & Inline CentralPanel Workspaces
// =============================================================================

#[test]
fn test_adv_acc_07_zero_modal_static_code_invariants() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let src_dir = repo_root.join("src");

    let modals_rs = std::fs::read_to_string(src_dir.join("modals.rs")).expect("Read modals.rs");
    let app_rs = std::fs::read_to_string(src_dir.join("app.rs")).expect("Read app.rs");
    let theme_rs = std::fs::read_to_string(src_dir.join("theme.rs")).expect("Read theme.rs");

    // 5.1 零浮窗：全库代码 0 处 egui::Window::new
    for entry in std::fs::read_dir(&src_dir).expect("Read src/") {
        let entry = entry.expect("DirEntry");
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("rs") {
            let content = std::fs::read_to_string(&path).expect("Read rs file");
            assert!(
                !content.contains("egui::Window::new"),
                "File {} violates Zero-Modal: contains 'egui::Window::new'",
                path.display()
            );
        }
    }

    // 5.2 杜绝旧模态标记
    assert!(
        !modals_rs.contains("pub show_library: bool")
            && !modals_rs.contains("pub show_help: bool")
            && !modals_rs.contains("pub show_presets: bool"),
        "modals.rs must not contain legacy show_* modal visibility flags"
    );

    // 5.3 四大一等公民工作区完整导出
    assert!(modals_rs.contains("pub fn render_corpus_workspace"), "Missing render_corpus_workspace");
    assert!(modals_rs.contains("pub fn render_formats_workspace"), "Missing render_formats_workspace");
    assert!(modals_rs.contains("pub fn render_latex_workspace"), "Missing render_latex_workspace");
    assert!(modals_rs.contains("pub fn render_help_workspace"), "Missing render_help_workspace");

    // 5.4 CentralPanel 纯内联路由
    assert!(
        app_rs.contains("egui::CentralPanel::default()"),
        "app.rs must contain egui::CentralPanel::default()"
    );
    assert!(
        app_rs.contains("self.workspace_tab_bar_ui(ui);"),
        "CentralPanel must render workspace_tab_bar_ui"
    );
    assert!(
        app_rs.contains("match self.active_tab {"),
        "CentralPanel must dispatch active_tab"
    );
    assert!(
        app_rs.contains("WorkspaceTab::Palette =>"),
        "Must route to WorkspaceTab::Palette"
    );
    assert!(
        app_rs.contains("WorkspaceTab::Corpus =>"),
        "Must route to WorkspaceTab::Corpus"
    );
    assert!(
        app_rs.contains("WorkspaceTab::Formats =>"),
        "Must route to WorkspaceTab::Formats"
    );
    assert!(
        app_rs.contains("WorkspaceTab::LatexImport =>"),
        "Must route to WorkspaceTab::LatexImport"
    );
    assert!(
        app_rs.contains("WorkspaceTab::Help =>"),
        "Must route to WorkspaceTab::Help"
    );

    // 5.5 状态化顶栏工具按钮
    assert!(
        theme_rs.contains("pub fn tool_button_styled"),
        "theme.rs must define pub fn tool_button_styled"
    );
    assert!(
        app_rs.contains("tool_button_styled"),
        "app.rs must use tool_button_styled for synchronized header tab states"
    );
}

// =============================================================================
// TEST GROUP 6: Permanent Left Panel & Live Instant Preview Invariants
// =============================================================================

#[test]
fn test_adv_acc_08_live_preview_and_left_panel_contracts() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let app_rs = std::fs::read_to_string(repo_root.join("src/app.rs")).expect("Read app.rs");

    // 6.1 左翼三框常驻
    assert!(
        app_rs.contains(r#"egui::Panel::left("mathslot-left-panel")"#),
        "app.rs must declare permanent left panel"
    );
    assert!(
        app_rs.contains("self.preview_box(ui);"),
        "left_panel_ui must permanently render preview_box"
    );
    assert!(
        app_rs.contains("self.nav_structure_box(ui, act);"),
        "left_panel_ui must permanently render nav_structure_box"
    );
    assert!(
        app_rs.contains("self.input_output_box(ui, act);"),
        "left_panel_ui must permanently render input_output_box"
    );

    // 6.2 即点即显重绘机制：ModalAction 捕获并调用 mark_dirty
    assert!(
        app_rs.contains("ModalAction::ReplaceCode(code) =>"),
        "Must handle ModalAction::ReplaceCode"
    );
    assert!(
        app_rs.contains("ModalAction::InsertCode(code) =>"),
        "Must handle ModalAction::InsertCode"
    );
    assert!(
        app_rs.contains("self.mark_dirty();"),
        "ReplaceCode and InsertCode must invoke self.mark_dirty() for instant preview"
    );
    assert!(
        app_rs.contains("self.worker.submit(RenderJob {"),
        "render_dirty must submit render job directly to render worker"
    );
}

// =============================================================================
// TEST GROUP 7: Form Layout Rationality & Zero Empty Voids
// =============================================================================

#[test]
fn test_adv_acc_09_semantic_forms_and_zero_voids_contract() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let modals_rs = std::fs::read_to_string(repo_root.join("src/modals.rs")).expect("Read modals.rs");

    // 7.1 全局 0 处 Grid::new
    assert!(
        !modals_rs.contains("Grid::new"),
        "modals.rs must contain 0 occurrences of Grid::new"
    );

    // 7.2 自适应通栏: available_width
    assert!(
        modals_rs.contains(".desired_width(ui.available_width())"),
        "Form inputs must adapt to 100% available_width"
    );

    // 7.3 三层语义布局：
    // 自定义格式表单
    assert!(
        modals_rs.contains("新建 / 编辑自定义格式"),
        "Must contain custom formats form header"
    );
    // 片段模版表单
    assert!(
        modals_rs.contains("新建 / 编辑片段模版"),
        "Must contain snippet template form header"
    );
    // 公式库新建抽屉
    assert!(
        modals_rs.contains("新建自定义公式") || modals_rs.contains("编辑公式"),
        "Must contain formula corpus edit form header"
    );
    assert!(
        modals_rs.contains("简码流源码 (通栏):"),
        "Formula corpus edit drawer must feature full-width stream code section"
    );

    // 7.4 两段式列表项与溢出物理隔离 (136px 右侧动作区)
    assert!(
        modals_rs.contains("Vec2::new(136.0, 0.0)"),
        "List items must isolate 136px right action zone from left formula description"
    );
}

// =============================================================================
// TEST GROUP 8: Git & Workspace Isolation
// =============================================================================

#[test]
fn test_adv_acc_10_gitignore_isolation_contract() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let gitignore_path = repo_root.join(".gitignore");

    assert!(gitignore_path.exists(), ".gitignore file must exist");
    let content = std::fs::read_to_string(&gitignore_path).expect("Read .gitignore");
    let rules: Vec<&str> = content.lines().map(str::trim).collect();
    assert!(
        rules.contains(&"docs/"),
        ".gitignore must contain 'docs/' rule to protect documentation from accidental staging"
    );
}

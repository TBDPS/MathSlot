//! =============================================================================
//! MathSlot Round 12 Final Acceptance Test Suite
//! =============================================================================
//! 验证 Round 12 全面验收准则：
//! 1. 顶栏彻底消除 (Zero-Top-Bar Invariant) 与左翼紧凑控制台 (Left Wing Header)
//! 2. 上下标实现统一与后向主体自动包裹 (Backward Body Wrap & Preset Rectification)
//! 3. 公式库 (Corpus) 响应式宽度缩放与零横向溢出 (Responsive Scaling Invariant)
//! 4. 自定义格式与模版表单全域垂直滚动、高度紧凑与保存按钮就近对齐 (Clustered Buttons Contract)
//! 5. 源码安全与 docs/ 目录绝对隔离契约 (Zero Unsafe & Git Shielding)
//! =============================================================================

use std::path::Path;

#[test]
fn test_acc_r12_zero_top_bar_and_left_wing_header_contract() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let app_rs_path = repo_root.join("src/app.rs");
    let src = std::fs::read_to_string(&app_rs_path).expect("Read src/app.rs");

    // 1.1 顶栏 Panel::top 必须彻底清除
    assert!(
        !src.contains("egui::Panel::top(\"mathslot-top-panel\")"),
        "src/app.rs 必须彻底消除 egui::Panel::top(\"mathslot-top-panel\") 顶栏！"
    );
    assert!(
        !src.contains("TOP_BAR_HEIGHT"),
        "src/app.rs 必须彻底消除 TOP_BAR_HEIGHT 常量定义！"
    );

    // 1.2 左翼控制台 Header 必须集成入 left_panel_ui
    assert!(
        src.contains("fn left_wing_header_ui"),
        "src/app.rs 必须实现 left_wing_header_ui 左翼控制台！"
    );
    assert!(
        src.contains("self.left_wing_header_ui(ui);"),
        "left_panel_ui 中必须调用 self.left_wing_header_ui(ui)！"
    );
}

#[test]
fn test_acc_r12_unified_sub_sup_and_presets_contract() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let presets_path = repo_root.join("crates/mathslot-core/src/presets.rs");
    let presets_src = std::fs::read_to_string(&presets_path).expect("Read presets.rs");

    // 2.1 爱因斯坦引力场方程必须严格遵循前缀结构 ▸d 主体;下标;
    assert!(
        presets_src.contains("▸d G;▸gm ▸gn;; + ▸gL ▸d g;▸gm ▸gn;; = ▸f8 ▸gp G;c^4; ▸d T;▸gm ▸gn;;"),
        "爱因斯坦引力场方程预置必须使用合法的结构式 ▸d 主体;下标; 语法！"
    );

    // 2.2 验证后向主体自动包裹核心逻辑存在于 editor.rs
    let editor_path = repo_root.join("crates/mathslot-core/src/editor.rs");
    let editor_src = std::fs::read_to_string(&editor_path).expect("Read editor.rs");
    assert!(
        editor_src.contains("fn find_backward_atom"),
        "editor.rs 必须实现 find_backward_atom 算法！"
    );
    assert!(
        editor_src.contains("fn try_backward_body_wrap"),
        "editor.rs 必须实现 try_backward_body_wrap 逻辑！"
    );
}

#[test]
fn test_acc_r12_responsive_formula_library_contract() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let modals_path = repo_root.join("src/modals.rs");
    let modals_src = std::fs::read_to_string(&modals_path).expect("Read modals.rs");

    // 3.1 公式库必须采用两行响应式工具栏与横向折行分类
    assert!(
        modals_src.contains("ui.horizontal_wrapped(|ui| {"),
        "公式库顶部学科分类必须使用 horizontal_wrapped 杜绝水平溢出！"
    );

    // 3.2 公式卡片标题与简码流必须具备自适应截断防护
    assert!(
        modals_src.contains("let title_w = (ui.available_width() - act_w).max(40.0);"),
        "公式卡片标题必须计算可用宽度并保护高频动作按钮！"
    );
    assert!(
        modals_src.contains("let code_w = (ui.available_width() - btns_w).max(40.0);"),
        "公式卡片简码流必须计算可用宽度并保护次级按钮！"
    );
}

#[test]
fn test_acc_r12_forms_compact_vertical_and_clustered_buttons_contract() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let modals_path = repo_root.join("src/modals.rs");
    let modals_src = std::fs::read_to_string(&modals_path).expect("Read modals.rs");

    // 4.1 表单必须内联于 ScrollArea 内部自然滚动
    let custom_scroll_split = modals_src.split("id_salt(\"mathslot-custom-list-scroll\")").nth(1).unwrap();
    assert!(
        custom_scroll_split.contains("if self.show_custom_form {"),
        "show_custom_form 必须处于 custom-list-scroll 的 ScrollArea 内部！"
    );

    let snippet_scroll_split = modals_src.split("id_salt(\"mathslot-snippet-list-scroll\")").nth(1).unwrap();
    assert!(
        snippet_scroll_split.contains("if self.show_snippet_form {"),
        "show_snippet_form 必须处于 snippet-list-scroll 的 ScrollArea 内部！"
    );

    // 4.2 保存按钮必须就近左对齐，杜绝与输入框天各一方
    assert!(
        modals_src.contains("ui.horizontal(|ui| {\n                                ui.spacing_mut().item_spacing.x = 8.0;\n                                if ui\n                                    .button(RichText::new(\"✓ 保存格式\").strong().color(GREEN))"),
        "自定义格式保存按钮必须左侧紧密就近排布！"
    );
    assert!(
        modals_src.contains("ui.horizontal(|ui| {\n                                ui.spacing_mut().item_spacing.x = 8.0;\n                                if ui\n                                    .button(RichText::new(\"✓ 保存片段\").strong().color(GREEN))"),
        "片段模版保存按钮必须左侧紧密就近排布！"
    );
}

#[test]
fn test_acc_r12_zero_unsafe_and_git_isolation_contract() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();

    // 5.1 docs/ 目录必须严格在 .gitignore 中屏蔽
    let gitignore = std::fs::read_to_string(repo_root.join(".gitignore")).expect("Read .gitignore");
    let lines: Vec<&str> = gitignore.lines().map(str::trim).collect();
    assert!(
        lines.contains(&"docs/") || lines.contains(&"docs") || lines.contains(&"/docs/"),
        ".gitignore 必须严格包含 docs/，杜绝文档被误提交至 Git 追踪！"
    );

    // 5.2 全 workspace 必须 forbid(unsafe_code)
    let main_rs = std::fs::read_to_string(repo_root.join("src/main.rs")).expect("Read src/main.rs");
    assert!(
        main_rs.contains("#![forbid(unsafe_code)]"),
        "src/main.rs 必须包含 #![forbid(unsafe_code)]！"
    );
}

#[test]
fn test_acc_r12_einstein_preset_and_backward_wrap_functional() {
    use mathslot_core::editor::StreamEditor;
    use mathslot_core::presets::PRESET_LIBRARY;

    // 1. 验证预置库中爱因斯坦引力场方程可直接载入且正确渲染 LaTeX
    let einstein = PRESET_LIBRARY
        .iter()
        .find(|f| f.name == "爱因斯坦引力场方程")
        .expect("预置库必须包含爱因斯坦引力场方程");
    
    let mut ed = StreamEditor::default();
    ed.load_preset(einstein.source, einstein.name);
    let latex = ed.to_latex();
    assert!(latex.contains(r"{G}_{\mu \nu}"), "爱因斯坦张量必须正确渲染: {latex}");
    assert!(latex.contains(r"\Lambda {g}_{\mu \nu}"), "宇宙学常数项必须正确渲染: {latex}");
    assert!(latex.contains(r"\frac{8 \pi G}{c^{4}}"), "引力耦合常数分式必须正确渲染: {latex}");
    assert!(latex.contains(r"{T}_{\mu \nu}"), "能动张量必须正确渲染: {latex}");

    // 2. 模拟真实键盘键入心流：输入变量 G 后紧接着键入 ▸d (Tab d)
    let mut ed2 = StreamEditor::default();
    ed2.type_text("G");
    assert_eq!(ed2.source, "G");
    let wrap_msg = ed2.type_text("▸d");
    assert_eq!(ed2.source, "▸d G;", "必须后向包裹 G 到下标主体");
    assert_eq!(ed2.cursor_char, 5, "光标必须定位在 Slot 1 下标起始处");
    assert!(wrap_msg.unwrap().contains("已将前置「G」作为下标主体"));

    // 紧接着输入下标并闭合
    ed2.type_text("▸gm ▸gn;;");
    assert_eq!(ed2.source, "▸d G;▸gm ▸gn;;");
    assert_eq!(ed2.to_latex(), r"{G}_{\mu \nu}");

    // 3. 测试撤销后向包裹 (Undo)
    let mut ed3 = StreamEditor::default();
    ed3.type_text("x");
    ed3.type_text("▸u");
    assert_eq!(ed3.source, "▸u x;");
    assert!(ed3.can_undo());
    ed3.undo();
    assert_eq!(ed3.source, "x▸u", "Undo 必须精确还原后向包裹前的输入状态");

    // 4. 后缀 ^ 和 _ 依然完美支持
    let ed4 = StreamEditor::from_source("x^2 + a_k");
    assert_eq!(ed4.to_latex(), "x^{2} + a_{k}");
}

#[test]
fn test_acc_r12_section13_lossless_roundtrip_and_no_ghost_slots() {
    use mathslot_core::{Session, exprs_structurally_equal, parse};

    // 1. e^{-x^{2}}、x^{a+b}、a_{i+1}、e^{-\frac{x}{2}} 全部无损往返
    let cases = [
        r"e^{-x^{2}}",
        r"x^{a+b}",
        r"a_{i+1}",
        r"e^{-\frac{x}{2}}",
    ];
    for latex in cases {
        let (session, report) = Session::from_latex(latex);
        assert!(
            report.lossless,
            "LaTeX '{latex}' 导入必须无损，实际诊断: {:?}",
            report.diagnostics
        );
        assert_eq!(report.empty_slots, 0, "空槽位必须为 0: {latex}");
        let back = session.to_latex();
        let (ast_orig, d_orig) = parse(latex);
        let (ast_exp, d_exp) = parse(&back);
        assert!(d_orig.is_empty(), "原式解析错误: {d_orig:?}");
        assert!(d_exp.is_empty(), "导出式解析错误: {d_exp:?}");
        assert!(
            exprs_structurally_equal(&ast_orig, &ast_exp),
            "无损往返结构一致性失败: 原='{latex}', 返='{back}'"
        );
    }

    // 2. \sum/\int 后接 \left(...\right) 不再产生空槽
    let sum_paren = r"\sum_{i=1}^{n} \left( x_i + y_i \right)";
    let (session_sum, report_sum) = Session::from_latex(sum_paren);
    assert!(report_sum.lossless);
    assert_eq!(report_sum.empty_slots, 0, "不应产生幽灵空槽");
    let back_sum = session_sum.to_latex();
    assert!(back_sum.contains(r"\sum"));
    assert!(back_sum.contains(r"\left("));

    // 3. pmatrix/bmatrix/vmatrix 正确转为矩阵节点
    let matrix_cases = [
        r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
        r"\begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}",
        r"\begin{vmatrix} x & y \\ z & w \end{vmatrix}",
    ];
    for mat_tex in matrix_cases {
        let (session_mat, report_mat) = Session::from_latex(mat_tex);
        assert!(report_mat.lossless, "矩阵环境转换必须无损: {mat_tex}");
        assert_eq!(report_mat.empty_slots, 0);
        let back_mat = session_mat.to_latex();
        let (ast_mat_orig, _) = parse(mat_tex);
        let (ast_mat_back, _) = parse(&back_mat);
        assert!(
            exprs_structurally_equal(&ast_mat_orig, &ast_mat_back),
            "矩阵环境结构不一致: 原='{mat_tex}', 返='{back_mat}'"
        );
    }
}

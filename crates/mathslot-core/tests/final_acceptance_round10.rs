//! MathSlot Round 10 严苛独立终验测试套件 (Final Adversarial Acceptance Suite)
//!
//! 依据 docs/REWRITE_DESIGN.md 第 13 节“验收标准”及 Round 10 专项考核要求编写：
//! 1. 视口防跳变（Window Viewport Stability，0px 水平跳变约束）
//! 2. 卡片与表单合理性（废除 4 列 Grid，3 层语义布局，48px/170px/220px/96px 约束，100% 通栏）
//! 3. 列表项两段式通栏布局（100% 通栏铺满，左侧截断，右侧 136px 物理隔离防溢出）
//! 4. REWRITE_DESIGN 核心验收标准（无损往返、矩阵环境、降级诊断、事务回退、零内嵌控制符）
//! 5. Git 跟踪与 `.gitignore` 隔离合约

use mathslot_core::{
    exprs_structurally_equal, inspect_environment, parse, Edit,
    EnvironmentShape, MatrixEnv, Session, SlotId,
};
use std::path::Path;

// =============================================================================
// 1. 视口防跳变与模态窗口约束合约走查
// =============================================================================

#[test]
fn test_acc_r10_window_viewport_stability_and_zero_jump_contracts() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let modals_rs_path = repo_root.join("src/modals.rs");

    assert!(
        modals_rs_path.exists(),
        "src/modals.rs 源码文件必须存在于 {}",
        modals_rs_path.display()
    );

    let src = std::fs::read_to_string(&modals_rs_path)
        .expect("Read src/modals.rs must succeed");

    // 1.1 验证三大模态弹窗全部开启水平锁定 resizable([false, true])
    let resizable_matches: Vec<_> = src.match_indices(".resizable([false, true])").collect();
    assert_eq!(
        resizable_matches.len(),
        3,
        "show_library、show_help、show_presets 三大窗口必须全部显式配置 .resizable([false, true])，实测匹配到 {} 处",
        resizable_matches.len()
    );

    // 1.2 验证 show_library (扩展中心) 宽度锁定：780px
    assert!(
        src.contains(".default_size([780.0, 580.0])"),
        "show_library 默认宽度必须为 780.0"
    );
    assert!(
        src.contains(".min_size([780.0, 460.0])"),
        "show_library 最小宽度必须为 780.0（锁死水平下限）"
    );
    assert!(
        src.contains(".max_size([780.0, 780.0])"),
        "show_library 最大宽度必须为 780.0（锁死水平上限，实现 0px 视口跳变）"
    );

    // 1.3 验证 show_help (使用指南速查) 宽度锁定：740px
    assert!(
        src.contains(".default_size([740.0, 560.0])"),
        "show_help 默认宽度必须为 740.0"
    );
    assert!(
        src.contains(".min_size([740.0, 420.0])"),
        "show_help 最小宽度必须为 740.0"
    );
    assert!(
        src.contains(".max_size([740.0, 760.0])"),
        "show_help 最大宽度必须为 740.0"
    );

    // 1.4 验证 show_presets (公式库) 宽度锁定：880px
    assert!(
        src.contains(".default_size([880.0, 640.0])"),
        "show_presets 默认宽度必须为 880.0"
    );
    assert!(
        src.contains(".min_size([880.0, 500.0])"),
        "show_presets 最小宽度必须为 880.0"
    );
    assert!(
        src.contains(".max_size([880.0, 840.0])"),
        "show_presets 最大宽度必须为 880.0"
    );

    // 1.5 验证均开启顶部绝对居中 pivot(Align2::CENTER_TOP)
    let pivot_matches: Vec<_> = src.match_indices(".pivot(Align2::CENTER_TOP)").collect();
    assert_eq!(
        pivot_matches.len(),
        3,
        "三大弹窗必须均配置 .pivot(Align2::CENTER_TOP)，实测匹配到 {} 处",
        pivot_matches.len()
    );
}

// =============================================================================
// 2. 卡片与表单合理性、3 层语义布局与 4 列 Grid 废除核验
// =============================================================================

#[test]
fn test_acc_r10_cards_and_forms_semantic_layout_inspection() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let modals_rs_path = repo_root.join("src/modals.rs");
    let src = std::fs::read_to_string(&modals_rs_path).expect("Read src/modals.rs");

    // 2.1 彻底废除丑陋的 4 列 Grid (mathslot-custom-fmt-grid & mathslot-snippet-grid)
    assert!(
        !src.contains("mathslot-custom-fmt-grid"),
        "必须彻底删除 mathslot-custom-fmt-grid 4 列网格！"
    );
    assert!(
        !src.contains("mathslot-snippet-grid"),
        "必须彻底删除 mathslot-snippet-grid 4 列网格！"
    );

    // 2.2 验证自定义格式表单布局与尺寸约束
    // 触发字母: 48px monospace
    assert!(
        src.contains(".desired_width(48.0)\n                                .hint_text(\"g\")")
            || src.contains(".desired_width(48.0)\r\n                                .hint_text(\"g\")"),
        "自定义格式触发字母框 desired_width 必须为 48.0"
    );
    // 格式名称: 170px
    assert!(
        src.contains(".desired_width(170.0)\n                                .hint_text(\"如：同余式 / 期望\")")
            || src.contains(".desired_width(170.0)\r\n                                .hint_text(\"如：同余式 / 期望\")"),
        "格式名称 desired_width 必须为 170.0"
    );
    // 缩略提示: 96px
    assert!(
        src.contains(".desired_width(96.0)\n                                .hint_text(\"如 a≡b(m)\")")
            || src.contains(".desired_width(96.0)\r\n                                .hint_text(\"如 a≡b(m)\")"),
        "缩略提示 desired_width 必须为 96.0"
    );
    // 槽位角色动态自适应剩余宽度
    assert!(
        src.contains("let roles_w = (ui.available_width() - 4.0).max(80.0);"),
        "槽位角色必须动态消耗剩余水平空间以消除死寂空洞"
    );
    // 第二层 LaTeX 模板输入框 100% 通栏
    assert!(
        src.contains(".desired_width(ui.available_width())\n                            .hint_text(r\"$1 \\equiv $2 \\pmod{$3}\")")
            || src.contains(".desired_width(ui.available_width())\r\n                            .hint_text(r\"$1 \\equiv $2 \\pmod{$3}\")"),
        "LaTeX 模板必须采用 desired_width(ui.available_width()) 100% 通栏布局"
    );

    // 2.3 验证片段模版表单布局与尺寸约束
    // 触发字母: 48px
    assert!(
        src.contains(".desired_width(48.0)\n                                .hint_text(\"d\")")
            || src.contains(".desired_width(48.0)\r\n                                .hint_text(\"d\")"),
        "片段模版触发字母框 desired_width 必须为 48.0"
    );
    // 模版名称: 220px
    assert!(
        src.contains(".desired_width(220.0)\n                                .hint_text(\"如：高斯核 / 泰勒余项\")")
            || src.contains(".desired_width(220.0)\r\n                                .hint_text(\"如：高斯核 / 泰勒余项\")"),
        "模版名称 desired_width 必须为 220.0"
    );
    // 简码流源码: 100% 通栏
    assert!(
        src.contains(".desired_width(ui.available_width())\n                            .hint_text(\"如 ▸rb^2 - 4ac;\")")
            || src.contains(".desired_width(ui.available_width())\r\n                            .hint_text(\"如 ▸rb^2 - 4ac;\")"),
        "片段简码源码必须采用 desired_width(ui.available_width()) 100% 通栏布局"
    );

    // 2.4 验证操作栏右对齐与绿色高对比度保存按钮
    assert!(
        src.contains("ui.with_layout(Layout::right_to_left(Align::Center), |ui| {\n                        if ui\n                            .button(RichText::new(\"✓ 保存格式\").strong().color(GREEN))")
            || src.contains("RichText::new(\"✓ 保存格式\").strong().color(GREEN)"),
        "自定义格式保存按钮必须右对齐并带有高对比度 GREEN 强化"
    );
    assert!(
        src.contains("RichText::new(\"✓ 保存片段\").strong().color(GREEN)"),
        "片段保存按钮必须右对齐并带有高对比度 GREEN 强化"
    );
}

// =============================================================================
// 3. 列表项两段式通栏布局与溢出物理隔离核验
// =============================================================================

#[test]
fn test_acc_r10_two_segment_full_width_list_layout_inspection() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let modals_rs_path = repo_root.join("src/modals.rs");
    let src = std::fs::read_to_string(&modals_rs_path).expect("Read src/modals.rs");

    // 3.1 验证自定义格式列表项两段式分配
    let custom_list_block = src
        .split("id_salt(\"mathslot-custom-list-scroll\")")
        .nth(1)
        .expect("Must find custom list scroll area");
    assert!(
        custom_list_block.contains("let total_w = ui.available_width();"),
        "自定义格式列表项必须获取当前 100% 通栏可用宽度 total_w"
    );
    assert!(
        custom_list_block.contains("let left_w = (total_w - 144.0).max(120.0);"),
        "自定义格式列表项左侧必须分配 (total_w - 144.0).max(120.0)"
    );
    assert!(
        custom_list_block.contains("Vec2::new(136.0, 0.0),\n                                    Layout::right_to_left(Align::Center),")
            || custom_list_block.contains("Vec2::new(136.0, 0.0),\r\n                                    Layout::right_to_left(Align::Center),"),
        "自定义格式列表项右侧动作区必须严格隔离分配 136px"
    );

    // 3.2 验证片段模版列表项两段式分配
    let snippet_list_block = src
        .split("id_salt(\"mathslot-snippet-list-scroll\")")
        .nth(1)
        .expect("Must find snippet list scroll area");
    assert!(
        snippet_list_block.contains("let total_w = ui.available_width();"),
        "片段列表项必须获取当前 100% 通栏可用宽度 total_w"
    );
    assert!(
        snippet_list_block.contains("let left_w = (total_w - 144.0).max(120.0);"),
        "片段列表项左侧必须分配 (total_w - 144.0).max(120.0)"
    );
    assert!(
        snippet_list_block.contains("Vec2::new(136.0, 0.0),\n                                    Layout::right_to_left(Align::Center),")
            || snippet_list_block.contains("Vec2::new(136.0, 0.0),\r\n                                    Layout::right_to_left(Align::Center),"),
        "片段列表项右侧动作区必须严格隔离分配 136px"
    );

    // 3.3 验证左侧文本均已配置 .truncate() 截断保护
    let truncate_count = src.matches(".truncate()").count();
    assert!(
        truncate_count >= 4,
        "必须对超长公式与简码流设置截断保护 (.truncate())，实测匹配: {truncate_count}"
    );
}

// =============================================================================
// 4. Git 忽略合约核验（.gitignore 必须阻断 docs/ 跟踪）
// =============================================================================

#[test]
fn test_acc_r10_gitignore_isolation_contract() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let gitignore_path = repo_root.join(".gitignore");

    assert!(gitignore_path.exists(), ".gitignore 文件必须存在");
    let content = std::fs::read_to_string(&gitignore_path).expect("Read .gitignore");
    let lines: Vec<&str> = content.lines().map(str::trim).collect();
    assert!(
        lines.contains(&"docs/"),
        ".gitignore 必须包含 docs/ 规则以屏蔽设计文档跟踪"
    );
}

// =============================================================================
// 5. REWRITE_DESIGN.md 第 13 节端到端无损性与核心标准终验回归
// =============================================================================

#[test]
fn test_acc_r10_rewrite_design_section13_comprehensive_matrix() {
    // 5.1 复杂指数幂塔与负号嵌套
    let script_test_cases = [
        ("Gaussian power", r"e^{-x^{2}}"),
        ("Poly exponent addition", r"x^{a+b}"),
        ("Subscript increment", r"a_{i+1}"),
        ("Fraction in exponent", r"e^{-\frac{x}{2}}"),
        ("Nested power tower", r"x^{y^{z}}"),
        ("Double negative exponent", r"e^{-e^{-x}}"),
    ];
    for (name, latex) in script_test_cases {
        let (session, report) = Session::from_latex(latex);
        assert!(
            report.lossless,
            "[{name}] Must be lossless for {latex}, got report: {report:?}"
        );
        assert_eq!(report.empty_slots, 0, "[{name}] No empty slots allowed");
        assert_eq!(report.raw_nodes, 0, "[{name}] No raw nodes allowed");
        let exported = session.to_latex();
        let (ast1, d1) = parse(latex);
        let (ast2, d2) = parse(&exported);
        assert!(d1.is_empty());
        assert!(d2.is_empty());
        assert!(
            exprs_structurally_equal(&ast1, &ast2),
            "[{name}] Roundtrip AST structural mismatch!\nOrig: {latex}\nExport: {exported}"
        );
    }

    // 5.2 大算子后接 \left(...\right) 幽灵空槽根除
    let big_op_cases = [
        ("Sum with delimiters", r"\sum_{i=1}^{n} \left( x_{i} + y_{i} \right)"),
        ("Integral with delimiters", r"\int_{-\infty}^{\infty} \left( 1 - \frac{t}{2} \right) dt"),
        ("Product with delimiters", r"\prod_{k=1}^{\infty} \left( 1 + \frac{1}{k^{2}} \right)"),
    ];
    for (name, formula) in big_op_cases {
        let (session, report) = Session::from_latex(formula);
        assert_eq!(report.empty_slots, 0, "[{name}] Empty slots must be 0");
        assert!(report.lossless, "[{name}] Must be lossless");
        assert!(!session.to_latex().contains("▸j"), "Must have no control chars");
    }

    // 5.3 矩阵与分支结构精准解析
    let env_cases = [
        (
            r"\begin{pmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{pmatrix}",
            MatrixEnv::Pmatrix,
            2,
            2,
        ),
        (
            r"\begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}",
            MatrixEnv::Bmatrix,
            2,
            2,
        ),
        (
            r"\begin{vmatrix} a & b \\ c & d \end{vmatrix}",
            MatrixEnv::Vmatrix,
            2,
            2,
        ),
    ];
    for (tex, exp_env, r, c) in env_cases {
        let (session, report) = Session::from_latex(tex);
        assert!(report.lossless);
        let doc = session.doc();
        let shape = inspect_environment(&doc.nodes[0]);
        assert_eq!(
            shape,
            Some(EnvironmentShape {
                env: exp_env,
                rows: r,
                cols: c,
                is_rectangular: true,
            })
        );
    }

    // 5.4 事务 Undo/Redo 深度不变式
    let (mut session, report) = Session::from_latex(r"\frac{a+b}{c+d}");
    assert!(report.lossless);
    let original_latex = session.to_latex();
    let slot_ids: Vec<SlotId> = session.doc().slots.slots().iter().map(|s| s.id).collect();
    assert_eq!(slot_ids.len(), 2);

    // 修改分母
    session
        .apply_edit(
            Edit::ReplaceSlot {
                slot_id: slot_ids[1],
                new_nodes: parse(r"\sqrt{x^{2} + 1}").0,
            },
            "replace denom",
        )
        .expect("Edit succeed");
    let after_mod = session.to_latex();
    assert_ne!(original_latex, after_mod);
    assert!(after_mod.contains("sqrt"));

    // 撤销
    assert!(session.undo());
    assert_eq!(session.to_latex(), original_latex);

    // 重做
    assert!(session.redo());
    assert_eq!(session.to_latex(), after_mod);

    // 5.5 异常/外来未知宏降级诊断
    let lossy_input = r"\myExoticMacro[3]{foo}{bar}";
    let (_session, lossy_rep) = Session::from_latex(lossy_input);
    assert!(!lossy_rep.lossless, "Exotic macro must be lossy");
    assert!(lossy_rep.raw_nodes > 0, "Exotic macro must produce raw node");
    assert!(!lossy_rep.diagnostics.is_empty(), "Must have diagnostics");
}

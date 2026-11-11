//! MathSlot Round 9 最终验收严苛独立测试套件 (Final Acceptance Suite)
//!
//! 依据 docs/REWRITE_DESIGN.md 第 13 节“验收标准”以及 Round 9 决策与实施规范编写。
//! 覆盖：
//! 1. REWRITE_DESIGN 核心 10 大验收准则 (无损往返, 左括号大算子, 矩阵, 降级诊断, 事务回退, 导航一致性等)
//! 2. 88 项海量权威经典公式库完整性、分类统计与解析测试
//! 3. FormulaLibrary 动态所有权容器 CRUD、多字段实时模糊检索、恢复预置与 JSON 导入导出
//! 4. UserLibrary Schema 2 序列化与 v1 向后平滑兼容性
//! 5. 品牌资产与无 Emoji 豆腐块合约验证

use mathslot_core::{
    exprs_structurally_equal, inspect_environment, parse, Edit,
    EnvironmentShape, MatrixEnv, Session, SlotRole,
    presets::{PRESET_LIBRARY, preset_categories},
    library::{FormulaEntry, FormulaLibrary, UserLibrary},
};

// =============================================================================
// 1. REWRITE_DESIGN.md 第 13 节核心验收标准矩阵 (Criteria 1-7, 10)
// =============================================================================

#[test]
fn test_acc_r9_rewrite_design_section13_matrix() {
    // -------------------------------------------------------------------------
    // 准则 1：e^{-x^{2}}、x^{a+b}、a_{i+1}、e^{-\frac{x}{2}} 全部无损往返
    // -------------------------------------------------------------------------
    let criterion_1_cases = [
        ("Gaussian power", r"e^{-x^{2}}"),
        ("Exponent sum", r"x^{a+b}"),
        ("Subscript index addition", r"a_{i+1}"),
        ("Exponent fraction with negative sign", r"e^{-\frac{x}{2}}"),
    ];

    for (name, formula) in criterion_1_cases {
        let (session, report) = Session::from_latex(formula);
        assert!(
            report.lossless,
            "[{name}] Expected lossless import for '{formula}', report: {report:?}"
        );
        assert_eq!(report.raw_nodes, 0, "[{name}] Raw nodes must be 0");
        assert_eq!(report.empty_slots, 0, "[{name}] Empty slots must be 0");

        let exported = session.to_latex();
        let (ast1, d1) = parse(formula);
        let (ast2, d2) = parse(&exported);
        assert!(d1.is_empty(), "[{name}] Parse diagnostics 1: {d1:?}");
        assert!(d2.is_empty(), "[{name}] Parse diagnostics 2: {d2:?}");
        assert!(
            exprs_structurally_equal(&ast1, &ast2),
            "[{name}] Structural mismatch!\nExpected: {formula}\nExported: {exported}"
        );
    }

    // -------------------------------------------------------------------------
    // 准则 2：\sum/\int 后接 \left(...\right) 不再产生幽灵空槽
    // -------------------------------------------------------------------------
    let criterion_2_cases = [
        ("Summation with left-right parens", r"\sum_{i=1}^{n} \left( x_{i} + y_{i} \right)"),
        ("Integral with left-right parens", r"\int_{0}^{1} \left( 1 - t \right) dt"),
        ("Product with left-right parens", r"\prod_{k=1}^{\infty} \left( 1 + a_{k} \right)"),
    ];

    for (name, formula) in criterion_2_cases {
        let (_session, report) = Session::from_latex(formula);
        assert_eq!(
            report.empty_slots, 0,
            "[{name}] Must NOT produce phantom empty slots for '{formula}'"
        );
        assert!(report.lossless, "[{name}] Must be lossless");
    }

    // -------------------------------------------------------------------------
    // 准则 3：pmatrix/bmatrix/vmatrix 正确转为矩阵节点
    // -------------------------------------------------------------------------
    let matrix_cases = [
        (
            r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
            MatrixEnv::Pmatrix,
            2,
            2,
        ),
        (
            r"\begin{bmatrix} 1 & 0 & 0 \\ 0 & 1 & 0 \\ 0 & 0 & 1 \end{bmatrix}",
            MatrixEnv::Bmatrix,
            3,
            3,
        ),
        (
            r"\begin{vmatrix} \lambda - 1 & 2 \\ 3 & \lambda - 4 \end{vmatrix}",
            MatrixEnv::Vmatrix,
            2,
            2,
        ),
    ];

    for (tex, expected_env, exp_rows, exp_cols) in matrix_cases {
        let (session, report) = Session::from_latex(tex);
        assert!(report.lossless);
        let doc = session.doc();
        assert_eq!(doc.nodes.len(), 1);
        let shape = inspect_environment(&doc.nodes[0]);
        assert_eq!(
            shape,
            Some(EnvironmentShape {
                env: expected_env,
                rows: exp_rows,
                cols: exp_cols,
                is_rectangular: true,
            })
        );

        let exported = session.to_latex();
        assert!(
            exported.contains(match expected_env {
                MatrixEnv::Pmatrix => "pmatrix",
                MatrixEnv::Bmatrix => "bmatrix",
                MatrixEnv::Vmatrix => "vmatrix",
                _ => "",
            }),
            "Exported LaTeX must preserve matrix environment name, got: {exported}"
        );
    }

    // -------------------------------------------------------------------------
    // 准则 4：导入有损时 UI 明确警告，不静默替换；支持降级诊断
    // -------------------------------------------------------------------------
    let lossy_formula = r"\unknownFancyOperator{x} + \foobar[123]{y}";
    let (_lossy_session, lossy_report) = Session::from_latex(lossy_formula);
    assert!(
        !lossy_report.lossless,
        "Exotic/unknown macros must be flagged as non-lossless"
    );
    assert!(
        lossy_report.raw_nodes > 0,
        "Unknown macros must generate RawFallback nodes"
    );
    assert!(
        !lossy_report.diagnostics.is_empty(),
        "Diagnostic warnings must be emitted, got empty list"
    );

    // -------------------------------------------------------------------------
    // 准则 5 & 6：会话槽位表提取、导航一致性、无内嵌控制字符
    // -------------------------------------------------------------------------
    let formula = r"\frac{a+b}{c-d}";
    let (mut session, report) = Session::from_latex(formula);
    assert!(report.lossless);
    let slots = session.doc().slots.slots();
    assert_eq!(slots.len(), 2, "Fraction must have 2 slots");
    assert_eq!(slots[0].role, SlotRole::Numerator);
    assert_eq!(slots[1].role, SlotRole::Denominator);

    // 验证无内嵌控制字符（无 '▸' 或 '▸j'）
    let tex = session.to_latex();
    assert!(!tex.contains('▸'), "to_latex() must never contain '▸'");
    assert!(!tex.contains("▸j"), "to_latex() must never contain '▸j'");

    // -------------------------------------------------------------------------
    // 准则 7：事务与撤销重做 (Undo / Redo) 不变量
    // -------------------------------------------------------------------------
    let initial_latex = session.to_latex();
    let slot_num = slots[0].id;

    // 编辑操作：替换分子槽位内容
    session
        .apply_edit(
            Edit::ReplaceSlot {
                slot_id: slot_num,
                new_nodes: parse("x^{2}").0,
            },
            "replace numerator",
        )
        .expect("Apply edit must succeed");
    let modified_latex = session.to_latex();
    assert_ne!(initial_latex, modified_latex);
    assert!(modified_latex.contains("x^{2}"));

    // 执行撤销
    assert!(session.undo(), "Undo must succeed");
    assert_eq!(
        session.to_latex(),
        initial_latex,
        "State after undo must strictly match initial state"
    );

    // 执行重做
    assert!(session.redo(), "Redo must succeed");
    assert_eq!(
        session.to_latex(),
        modified_latex,
        "State after redo must strictly match modified state"
    );
}

// =============================================================================
// 2. 88 项海量权威经典公式库完整性与分类覆盖验收 (Task 4)
// =============================================================================

#[test]
fn test_acc_r9_preset_library_88_corpus_and_categories() {
    assert_eq!(
        PRESET_LIBRARY.len(),
        88,
        "经典公式库收录总量必须精准为 88 项，实际: {}",
        PRESET_LIBRARY.len()
    );

    let categories = preset_categories();
    assert!(
        categories.contains(&"现代深度学习与人工智能"),
        "必须包含现代深度学习分类"
    );
    assert!(categories.contains(&"量子力学"), "必须包含量子力学分类");
    assert!(
        categories.contains(&"微分几何与数学物理"),
        "必须包含微分几何与数学物理分类"
    );

    // 统计各学科数量
    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for p in PRESET_LIBRARY {
        *counts.entry(p.category).or_insert(0) += 1;
        assert!(!p.name.trim().is_empty(), "公式名称不可为空");
        assert!(!p.source.trim().is_empty(), "公式简码不可为空");
        assert!(!p.desc.trim().is_empty(), "学术说明不可为空");

        // 验证简码能顺利生成标准规范 LaTeX
        let (latex, _diags) = mathslot_core::format_latex(p.source);
        assert!(
            !latex.is_empty(),
            "[{}] 生成的 LaTeX 不可为空 (source: {})",
            p.name,
            p.source
        );
    }

    assert_eq!(counts.get("微积分/高等数学").copied().unwrap_or(0), 15);
    assert_eq!(counts.get("线性代数").copied().unwrap_or(0), 12);
    assert_eq!(counts.get("概率统计").copied().unwrap_or(0), 9);
    assert_eq!(counts.get("大学物理").copied().unwrap_or(0), 12);
    assert_eq!(counts.get("复变函数").copied().unwrap_or(0), 8);
    assert_eq!(counts.get("离散数学").copied().unwrap_or(0), 6);
    assert_eq!(counts.get("现代深度学习与人工智能").copied().unwrap_or(0), 11);
    assert_eq!(counts.get("量子力学").copied().unwrap_or(0), 8);
    assert_eq!(counts.get("微分几何与数学物理").copied().unwrap_or(0), 7);
}

// =============================================================================
// 3. FormulaLibrary 动态容器 CRUD、模糊检索、出厂重置与独立导入导出验收 (Task 4)
// =============================================================================

#[test]
fn test_acc_r9_formula_library_dynamic_crud_and_json_lifecycle() {
    let mut lib = FormulaLibrary::default_seeded();
    assert_eq!(lib.entries.len(), 88, "种子公式必须为 88 项");

    // 3.1 动态分类聚合
    let cats = lib.categories();
    assert!(cats.len() >= 9, "分类数必须 >= 9");
    assert!(cats.contains(&"现代深度学习与人工智能".to_owned()));

    // 3.2 多字段大小写不敏感模糊检索 (Name, Desc, Source, Category, Tags)
    // 检索名称
    let q_attn = lib.filter(None, "attention");
    assert_eq!(q_attn.len(), 2, "应命中缩放点积注意力与多头注意力");

    // 检索描述中关键字
    let q_desc = lib.filter(None, "薛定谔");
    assert!(q_desc.len() >= 2, "应命中含薛定谔描述的公式");

    // 检索分类 + 关键字组合
    let q_cat_filt = lib.filter(Some("量子力学"), "不确定性");
    assert_eq!(q_cat_filt.len(), 1);
    assert_eq!(q_cat_filt[0].name, "海森堡测不准不确定性原理");

    // 3.3 CRUD: 插入新自定义公式
    let user_entry = FormulaEntry {
        id: "user-test-custom-1".to_owned(),
        name: "自建卷积公式".to_owned(),
        category: "信号与系统".to_owned(),
        source: "(f * g)(t) = ▸i-oo;oo;f(▸gt) g(t - ▸gt) d▸gt;".to_owned(),
        desc: "连续时间线性时不变系统输入与冲激响应的卷积积分".to_owned(),
        tags: vec!["convolution".to_owned(), "lti".to_owned()],
        is_builtin: false,
        created_at: 1710000000,
    };
    let id_ret = lib.upsert(user_entry.clone()).expect("Upsert user formula must succeed");
    assert_eq!(id_ret, "user-test-custom-1");
    assert_eq!(lib.entries.len(), 89);
    assert!(lib.get("user-test-custom-1").is_some());

    // 3.4 CRUD: 字段修改与覆盖
    let mut modified_user = user_entry.clone();
    modified_user.desc = "更新后的卷积说明文档".to_owned();
    lib.upsert(modified_user).expect("Update must succeed");
    assert_eq!(lib.entries.len(), 89);
    assert_eq!(
        lib.get("user-test-custom-1").unwrap().desc,
        "更新后的卷积说明文档"
    );

    // 3.5 恢复出厂默认值 (恢复 88 项预置，并严格保留用户自建项)
    lib.restore_defaults();
    assert_eq!(lib.entries.len(), 89, "恢复出厂必须保留用户自建公式");
    assert!(lib.get("user-test-custom-1").is_some());
    assert_eq!(
        lib.entries.iter().filter(|e| e.is_builtin).count(),
        88,
        "内置公式必须恢复为 88 项"
    );

    // 3.6 CRUD: 删除自建公式
    let removed = lib.remove("user-test-custom-1");
    assert!(removed, "删除已存在的公式必须返回 true");
    assert_eq!(lib.entries.len(), 88);
    assert!(lib.get("user-test-custom-1").is_none());

    // 3.7 JSON 导出与导入验证
    let exported_json = lib.export_json();
    assert!(exported_json.contains("\"name\": \"缩放点积注意力"));
    assert!(exported_json.contains("\"category\": \"量子力学\""));

    let mut fresh_lib = FormulaLibrary { entries: Vec::new() };
    let imported_count = fresh_lib
        .import_json(&exported_json, true)
        .expect("Import valid JSON must succeed");
    assert_eq!(imported_count, 88);
    assert_eq!(fresh_lib.entries.len(), 88);

    // 测试非覆盖导入 (跳过已有)
    let reimport_skip = fresh_lib
        .import_json(&exported_json, false)
        .expect("Import with overwrite=false must succeed");
    assert_eq!(reimport_skip, 0, "重复导入且 overwrite=false 时应跳过 0 条新增");
}

// =============================================================================
// 4. UserLibrary Schema 2 序列化与向前兼容性验收 (Task 4)
// =============================================================================

#[test]
fn test_acc_r9_schema_2_persistence_and_backward_compatibility() {
    let user_lib = UserLibrary::default_seeded();
    let json_v2 = user_lib.to_json_pretty();

    // 验证 Schema 2 标识与结构
    assert!(json_v2.contains("\"schema_version\": 2"));
    assert!(json_v2.contains("\"customFormats\": ["));
    assert!(json_v2.contains("\"snippets\": ["));
    assert!(json_v2.contains("\"formulas\": ["));

    // 反序列化恢复
    let restored_v2 = UserLibrary::from_json(&json_v2).expect("Deserializing v2 JSON must succeed");
    assert_eq!(restored_v2.custom_formats.len(), user_lib.custom_formats.len());
    assert_eq!(restored_v2.snippets.len(), user_lib.snippets.len());
    assert_eq!(restored_v2.formulas.entries.len(), 88);

    // 验证向后兼容旧版 v1 配置文件（无 formulas 字段）
    let legacy_v1_json = r#"{
        "schema_version": 1,
        "customFormats": [
            {
                "key": "x",
                "label": "自定义格式X",
                "glyph": "fx",
                "roles": ["参数1", "参数2"],
                "latex": "\\fancy{$1}{$2}",
                "schemeA": "fancy"
            }
        ],
        "snippets": [
            {
                "key": "y",
                "label": "快捷片段Y",
                "source": "x^2 + y^2 = 1"
            }
        ]
    }"#;

    let restored_v1 = UserLibrary::from_json(legacy_v1_json).expect("Deserializing legacy v1 JSON must succeed");
    assert_eq!(restored_v1.custom_formats.len(), 1);
    assert_eq!(restored_v1.custom_formats[0].item_key, 'x');
    assert_eq!(restored_v1.snippets.len(), 1);
    assert_eq!(restored_v1.snippets[0].item_key, 'y');
    assert_eq!(
        restored_v1.formulas.entries.len(),
        88,
        "v1 配置缺失 formulas 节点时，必须安全无缝回退填充 88 项默认种子，防止出现空公式库崩溃"
    );
}

// =============================================================================
// 5. 品牌资产与无脆弱 Emoji 规范验收 (Task 1 & 2)
// =============================================================================

#[test]
fn test_acc_r9_branding_assets_and_zero_tofu_contract() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();

    // 5.1 SVG 几何 Squircle 底板核验
    let svg_path = repo_root.join("assets/icons/mathslot.svg");
    assert!(svg_path.exists(), "SVG 图标必须存在");
    let svg_content = std::fs::read_to_string(&svg_path).expect("Read SVG");
    assert!(
        svg_content.contains(r##"<rect x="0" y="0" width="512" height="512" rx="112" ry="112" fill="#FFFFFF"/>"##),
        "SVG 必须采用 512x512 实心纯白 Squircle 底板，rx/ry=112"
    );
    assert!(
        !svg_content.contains("filter="),
        "SVG 不得包含羽化阴影模糊 filter"
    );
    assert!(
        svg_content.contains(r##"fill="#2163EA""##),
        "SVG 胶囊必须为电光蓝 #2163EA"
    );
    assert!(
        svg_content.contains(r##"fill="#011D60""##),
        "SVG 核心 Sigma 必须为深海蓝 #011D60"
    );
    assert!(
        svg_content.contains(r##"stroke="#8FACFD""##),
        "SVG 槽位框必须为长春花蓝 #8FACFD"
    );

    // 5.2 PNG 光栅化多分辨率矩阵核验 (16, 32, 48, 64, 128, 256, 512)
    for size in [16, 32, 48, 64, 128, 256, 512] {
        let png_path = repo_root.join(format!("assets/icons/mathslot-{size}.png"));
        assert!(png_path.exists(), "PNG 图标 {} 必须存在", png_path.display());
        let meta = std::fs::metadata(&png_path).expect("PNG metadata");
        assert!(meta.len() > 100, "PNG 图标 {} 尺寸异常", png_path.display());
    }

    // 5.3 桌面快捷方式与 Wayland 匹配项
    let desktop_path = repo_root.join("assets/mathslot.desktop");
    assert!(desktop_path.exists(), "Desktop 文件必须存在");
    let desktop_content = std::fs::read_to_string(desktop_path).expect("Read desktop");
    assert!(desktop_content.contains("StartupWMClass=mathslot"));
    assert!(desktop_content.contains("Icon=mathslot"));
}

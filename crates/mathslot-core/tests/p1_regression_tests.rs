//! P1 缺陷运行时行为失败回归测试集 (crates/mathslot-core)
//!
//! 依据 `agent-state/decisions/ADR-0006-p1-regression-tests-t0.3.md` 与 `agent-state/audits/AUD-3.md`。
//! 严禁采用静态读取源码文本 (D-101)；所有测试均为真实 API 调用与运行时行为断言。
//! 当前代码下标注 `#[ignore]`，执行 `cargo test --workspace -- --ignored` 时必须全部真实触发断言失败。

use mathslot_core::command::{CommandTarget, StructKind, SymbolCmd, lookup_sub_command};
use mathslot_core::latex::to_latex;
use mathslot_core::library::{FormulaEntry, FormulaLibrary, UserLibrary};
use mathslot_core::parser::parse_with_library;
use std::collections::HashSet;

/// D-002 失败回归测试：README.md / HELP.md 公开承诺的简码存在性与语义一致性
///
/// 文档承诺：
/// - `ch` -> 全导分式 (\frac{\mathrm{d}}{\mathrm{d}})
/// - `cj` -> 下大括号 (\underbrace)
/// - `oq` -> 垂直 (\perp)
/// - `op` -> 平行 (\parallel)
/// - `qm` -> 复数集 (\mathbb{C})
///
/// 当前代码中：
/// - `ch`、`cj`、`oq` 在命令目录中完全不存在 (lookup 返回 None)
/// - `op` 映射为 Perp (垂直)，与平行语义颠倒
/// - `qm` 映射为 SetMinus (差集)，与复数集语义颠倒
#[test]
#[ignore = "P1 regression: D-002 (fails until fixed in G1/G2/G4)"]
fn test_p1_d002_documented_commands_exist_and_match_semantics() {
    let doc_claims = [
        (
            'c',
            'h',
            CommandTarget::Struct(StructKind::TotalFrac),
            "全导分式",
        ),
        (
            'c',
            'j',
            CommandTarget::Struct(StructKind::Underbrace),
            "下大括号",
        ),
        ('o', 'q', CommandTarget::Symbol(SymbolCmd::Perp), "垂直"),
        ('o', 'p', CommandTarget::Symbol(SymbolCmd::Parallel), "平行"),
        (
            'q',
            'm',
            CommandTarget::Symbol(SymbolCmd::ComplexSet),
            "复数集",
        ),
    ];

    for (c1, c2, expected_target, label) in doc_claims {
        let actual = lookup_sub_command(c1, c2);
        assert_eq!(
            actual,
            Some(expected_target),
            "Documented command '▸{c1}{c2}' ({label}) must exist and match target semantics in catalog"
        );
    }
}

/// D-004 失败回归测试：未决前缀与未知命令严禁静默消失或退化 (INV-002)
///
/// 当前代码 `crates/mathslot-core/src/latex.rs:19` 中：
/// `Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => String::new()`
/// 导致：
/// 1. 输入 `▸m` 导出为空串，触发 UI "无内容可复制"
/// 2. 输入 `1 + ▸m + 2` 导出为 `1 + 2`，未闭合前缀被静默丢弃
/// 3. 输入 `▸zz` 时 `▸z` 被当作 UnknownCmd 丢弃，尾部 `z` 作为 Text 导出，退化为普通字母 `z`
#[test]
#[ignore = "P1 regression: D-004 (fails until fixed in G1/G2/G4)"]
fn test_p1_d004_pending_and_unknown_commands_never_silently_disappear() {
    let lib = UserLibrary::default();

    // 1. 单个未决命令不得导出为空串
    let doc1 = parse_with_library("▸m", &lib);
    let latex1 = to_latex(&doc1);
    assert!(
        !latex1.trim().is_empty(),
        "Exporting pending command '▸m' must not produce empty string, got: {latex1:?}"
    );

    // 2. 复合表达式中的未决命令不得静默丢弃导致前后表达式被非法缝合
    let doc2 = parse_with_library("1 + ▸m + 2", &lib);
    let latex2 = to_latex(&doc2);
    assert_ne!(
        latex2.trim(),
        "1 + 2",
        "Exporting '1 + ▸m + 2' must not silently drop pending command into '1 + 2'"
    );

    // 3. 未知命令不得丢弃前缀并退化为普通字母
    let doc3 = parse_with_library("▸zz", &lib);
    let latex3 = to_latex(&doc3);
    assert_ne!(
        latex3.trim(),
        "z",
        "Exporting '▸zz' must not silently drop unknown command prefix and mutate into 'z'"
    );
}

/// D-006 失败回归测试：用户公式 ID 同毫秒连续插入无碰撞覆盖
///
/// 当前代码 `crates/mathslot-core/src/library.rs:260-267` 中：
/// `id = format!("user-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs())`
/// 时间戳精度仅为秒级。同毫秒连续插入 1000 次时，ID 生成全部相同，导致后序条目在
/// `position(|e| e.id == id)` 中连续覆盖前序条目，最终库中仅残留 1 项公式。
#[test]
#[ignore = "P1 regression: D-006 (fails until fixed in G1/G2/G4)"]
fn test_p1_d006_formula_upsert_same_millisecond_no_collision() {
    let mut lib = FormulaLibrary {
        entries: Vec::new(),
    };
    let mut generated_ids = HashSet::new();

    for i in 0..1000 {
        let entry = FormulaEntry {
            id: String::new(), // 空 ID 触发自动 ID 生成
            name: format!("Formula {i}"),
            category: "测试".to_owned(),
            source: format!("x_{i}"),
            desc: String::new(),
            tags: Vec::new(),
            is_builtin: false,
            created_at: 0,
        };
        let id = lib.upsert(entry).expect("Upsert must succeed");
        generated_ids.insert(id);
    }

    assert_eq!(
        generated_ids.len(),
        1000,
        "All 1000 generated IDs must be unique, but got only {}",
        generated_ids.len()
    );
    assert_eq!(
        lib.entries.len(),
        1000,
        "Formula library must contain 1000 entries after 1000 upserts, but got {}",
        lib.entries.len()
    );
}

/// D-007 失败回归测试：LaTeX 导入复杂/未知宏严禁启发式破坏结构并须产出诊断报告
///
/// 当前代码 `crates/mathslot-core/src/latex.rs:868` 的 `latex_to_mathslot` 仅返回裸 `String`，
/// 缺少诊断报告机制；遇到不支持的复杂宏（如 `\tensor{A}{^i_j}`）时暴力剥离 `{...}` 外层括号，
/// 导致输出破坏性退化为 `\tensorA^i_j`。
#[test]
#[ignore = "P1 regression: D-007 (fails until fixed in G1/G2/G4)"]
fn test_p1_d007_latex_import_reports_lossy_and_blocks_degradation() {
    let input = r"\tensor{A}{^i_j} + \unsupportedEnvironment{x}";

    // 当前 core 中面向 MathSlot 简码流转换的入口为 latex_to_mathslot
    let converted = mathslot_core::latex::latex_to_mathslot(input);

    // 核心断言 1: 不支持的复杂宏结构严禁被启发式转换器暴力剥离大括号（当前退化为 \tensorA^i_j）
    assert!(
        converted.contains(r"\tensor{A}") || converted.contains(r"^{i}_{j}"),
        "Complex macro structure must not be silently stripped by heuristic converter, got: {converted}"
    );

    // 核心断言 2: 将转换后的流重新解析并导出为 LaTeX，必须与原结构无损等价，不能静默损坏结构
    let doc = mathslot_core::parser::parse(&converted);
    let roundtrip = mathslot_core::latex::to_latex(&doc);
    assert_eq!(
        roundtrip, input,
        "Import pipeline must preserve unknown macro structure and report lossy, but silently degraded into: {roundtrip}"
    );
}

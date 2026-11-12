---
id: AUD-2
round: 2
gate: G0
scope: [T0.2, clippy, fmt]
verdict: BLOCK
auditor: auditor
date: 2026-11-13
---

# MathSlot 独立审计报告 (AUD-2)

- **审计角色**：auditor (只读审计)
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **当前分支**：`refactor/v1` (HEAD: `17ffa61`)
- **审计依据**：`AGENTS.md`、`.agents/skills/independent-audit/SKILL.md`、`docs/LLM_IMPLEMENTATION_SPEC.md`
- **审计目标**：针对任务 `T0.2`（清 clippy 或建立显式 test-only 例外清单），对全工作区 clippy 债务和 rustfmt 格式状态进行详实、只读的独立审计，为 coordinator 制定 `ADR-0005` 及 implementer 实施修复提供精准技术事实。
- **综合裁定**：**BLOCK**（当前全工作区存在 31 处 clippy 警告导致 `-D warnings` 门禁彻底失败，退出码 101；`cargo fmt --check` 存在 23 个文件的格式化差异，退出码 1；严禁推进 Gate）。

---

## 1. 判定摘要

| 审计项 | 指标 / 命令 | 实测结果 | 当前判定 | 核心发现 |
|:---|:---|:---|:---:|:---|
| **Clippy 全量债务** | `cargo clippy --workspace --all-targets` | **31 处违规** (lib: 13, bin: 11, test: 7) | **BLOCK** | 历史与交接单仅记录 13 处，系因 fast-fail 掩盖了 bin 与 test 的另外 18 处 |
| **Clippy 门禁退出** | `cargo clippy --workspace --all-targets -- -D warnings` | **exit 101** (编译中断) | **FAIL** | 涉及 14 种 lint 类型，其中 `collapsible_if` 独占 16 处 |
| **Rustfmt 格式合规** | `cargo fmt --check` | **exit 1** (23 个文件有 diff) | **FAIL** | 存量代码大面积未经规范格式化 |
| **工作区测试基线** | `cargo test --workspace` | **133 passed, 0 failed** | **PASS** | 测试功能基线保持稳定，无测试被破坏 |
| **聚合门禁脚本** | `scripts/agent/acceptance.sh` | **PASS=2 FAIL=2 WARN=4** (exit 1) | **FAIL** | 拦截在 fmt 与 clippy 阶段 |

---

## 2. 逐项证据

### 2.1 编译机制洞察：13 处 vs 31 处债务真实现状

在前期交接单与粗略排查中，常记录为“当前 clippy 报错 13 处”。本次只读独立审计通过拆解 cargo 编译管线，揭示了关键技术事实：

- **执行命令**：`cargo clippy --workspace --all-targets -- -D warnings`
- **退出码**：`101`
- **输出截断原因**：Cargo 在并行编译工作区 crate 时，由于开启了 `-D warnings`，当底层依赖 `crates/mathslot-core`（lib）产出前 13 项警告时，即刻被提升为 error 并触发 Cargo 的构建中断机制（`error: could not compile mathslot-core (lib) due to 13 previous errors`）。此时上层产品主程序 `src/`（`mathslot` bin）与各测试 target（`golden_tests` 等）被直接丢弃，尚未执行 clippy 分析。
- **全量无中断扫描**：运行 `cargo clippy --workspace --all-targets --message-format=json`，对全工作区所有 target 去重统计，真实存量为 **31 处唯一位置的 Clippy 警告**：
  1. 产品库 (`crates/mathslot-core` lib)：**13 处**
  2. 产品桌面端主程序 (`mathslot` bin / `src/` 源码)：**11 处**
  3. 语法测试套件 (`crates/mathslot-syntax/tests/golden_tests.rs`)：**5 处**
  4. 核心库测试套件 (`crates/mathslot-core/tests/`：`acceptance_tests.rs` 与 `final_acceptance_round12.rs`)：**2 处**
  5. 其余 crate（`mathslot-doc`、`mathslot-latex`、`mathslot-wasm`）：**0 处**

> [!WARNING]
> 若 implementer 仅依照“13 处”的初始印象修复 `mathslot-core`，重新运行门禁将立即在 `src/` 与测试套件再次遭遇 18 处失败。本审计报告提供的 31 处全景清单为彻底清空债务提供了完整事实依据。

---

### 2.2 全工作区 31 处 Clippy 债务详表

#### A. 产品核心库 (`mathslot-core` lib) —— 共 13 处

| 序号 | 文件与行号 | Lint 规则 | 目标与类型 | 代码现象与编译器诊断 | 架构评级与修复建议 |
|:---:|:---|:---|:---:|:---|:---|
| 1 | `crates/mathslot-core/src/library.rs:1` | `clippy::empty_line_after_doc_comments` | lib | `/// 用户可扩展数学格式...` 紧随空行后为 `pub enum LayoutKind`，文档注释被判定为修饰 enum 却带有空行。 | **低风险**：改为模块级内部注释 `//!`，或移除空行。 |
| 2 | `crates/mathslot-core/src/library.rs:13` | `clippy::derivable_impls` | lib | 手动实现 `impl Default for LayoutKind` 返回 `LayoutKind::Linear`。 | **低风险**：在 enum 上直接 derive `Default` 并给 `Linear` 标注 `#[default]`。 |
| 3 | `crates/mathslot-core/src/ast.rs:159` | `clippy::large_enum_variant` | lib | `Expr::CustomStruct` 变体体积至少为 304 字节（内含 `format: CustomFormat`），而次大变体仅 89 字节。 | **架构级风险**：需评估改为 `format: Box<CustomFormat>`。由于 AGENTS.md 规则 7 严禁在产品代码中加 `#[allow]`，必须通过结构优化落地，需 ADR-0005 明确。 |
| 4 | `crates/mathslot-core/src/ast.rs:307` | `clippy::collapsible_if` | lib | `if let Some((t, m, desc)) = first_child_struct_slot(&self.root) { if t != clamped \|\| m > 0 { ... } }` | **低风险**：利用 Rust 2024 / RFC 2497 语法折叠为 `if let ... && (...)`。 |
| 5 | `crates/mathslot-core/src/editor.rs:196` | `clippy::collapsible_if` | lib | `if let PrefixMenuState::InvalidPrefix(ch) = state { if self.library.lookup_custom(ch).is_some() { ... } }` | **低风险**：条件折叠为单层 `if let ... && ...`。 |
| 6 | `crates/mathslot-core/src/editor.rs:815` | `clippy::doc_lazy_continuation` | lib | `jump_bracket` 的 doc 注释在列表项 `- ')'...` 后直接紧接段落而未空行或未缩进。 | **低风险**：doc 增加空注释行 `///` 分隔段落。 |
| 7 | `crates/mathslot-core/src/editor.rs:1324` | `clippy::manual_ignore_case_cmp` | lib | `chars[end - 2].to_ascii_lowercase() != 't'` | **低风险**：改为 `!chars[end - 2].eq_ignore_ascii_case(&'t')`，避免不必要的大小写字符分配。 |
| 8 | `crates/mathslot-core/src/latex.rs:860` | `clippy::if_same_then_else` | lib | `else if s.starts_with("\\[") ...` 与 `else if s.starts_with("\\(") ...` 执行完全相同的切片修剪逻辑 `s = s[2..s.len() - 2].trim()`。 | **低风险**：将两个互斥分支的条件用 `\|\|` 合并为一个分支。 |
| 9 | `crates/mathslot-core/src/library.rs:307` | `clippy::collapsible_if` | lib | `if let Some(cat) = category { if cat != "全部" && ... { ... } }` | **低风险**：折叠嵌套 if。 |
| 10 | `crates/mathslot-core/src/library.rs:384` | `clippy::unnecessary_cast` | lib | `Some(JsonVal::Num(n)) => *n as u64`，其中 `*n` 原生类型已是 `u64`。 | **低风险**：移除无意义类型转换 `as u64`。 |
| 11 | `crates/mathslot-core/src/library.rs:600` | `clippy::manual_is_multiple_of` | lib | `fmt.slot_roles.len() % cols != 0` 手动取模比较零。 | **低风险**：替换为标准函数 `!fmt.slot_roles.len().is_multiple_of(*cols)`。 |
| 12 | `crates/mathslot-core/src/library.rs:909` | `clippy::unnecessary_cast` | lib | `Some(JsonVal::Num(n)) => *n as u64`，冗余 cast。 | **低风险**：移除 `as u64`。 |
| 13 | `crates/mathslot-core/src/visual.rs:931` | `clippy::manual_filter` | lib | `cursor_idx.and_then(\|c\| if c > open_idx && c <= inner_end { Some(c) } else { None })` | **低风险**：替换为语义更清晰的 `cursor_idx.filter(\|&c\| c > open_idx && c <= inner_end)`。 |

---

#### B. 产品主程序桌面端 (`mathslot` bin / `src/`) —— 共 11 处

| 序号 | 文件与行号 | Lint 规则 | 目标与类型 | 代码现象与编译器诊断 | 架构评级与修复建议 |
|:---:|:---|:---|:---:|:---|:---|
| 14 | `src/app.rs:260` | `clippy::collapsible_if` | bin | `if alt_released { if let Some(started) = self.alt_press_at.take() { if !self.alt_combo_active ... } }` | **低风险**：折叠嵌套 if。 |
| 15 | `src/app.rs:596` | `clippy::collapsible_if` | bin | `if matches!(...) { if let Some(msg) = self.editor.accept_submenu_default() { ... } }` | **低风险**：折叠嵌套 if。 |
| 16 | `src/app.rs:2350` | `clippy::collapsible_if` | bin | `if let egui::Event::Text(txt) = ev { if let Some(c) = txt.chars().find(...) { ... } }` | **低风险**：折叠嵌套 if。 |
| 17 | `src/app.rs:2402` | `clippy::collapsible_if` | bin | `if let Some(prop) = fonts.families.get_mut(...) { if !prop.iter().any(...) { ... } }` | **低风险**：折叠嵌套 if。 |
| 18 | `src/app.rs:2412` | `clippy::collapsible_if` | bin | `if Path::new(path).is_file() { if let Ok(bytes) = std::fs::read(path) { ... } }` | **低风险**：折叠嵌套 if。 |
| 19 | `src/app.rs:2419` | `clippy::collapsible_if` | bin | `if let Some(pattern) = _fc_pattern { if let Ok(output) = std::process::Command::new(...) { ... } }` | **低风险**：折叠嵌套 if。 |
| 20 | `src/app.rs:2425` | `clippy::collapsible_if` | bin | `if !path.is_empty() && Path::new(&path).is_file() { if let Ok(bytes) = std::fs::read(&path) { ... } }` | **低风险**：折叠嵌套 if。 |
| 21 | `src/modals.rs:540` | `clippy::collapsible_if` | bin | `if !formula.is_builtin { if ui.small_button(...).clicked() { ... } }` | **低风险**：折叠为 `if !formula.is_builtin && ui.small_button(...).clicked()`。 |
| 22 | `src/modals.rs:576` | `clippy::collapsible_if` | bin | `if let Some(did) = delete_id { if editor.library.formulas.remove(&did) { ... } }` | **低风险**：折叠嵌套 if。 |
| 23 | `src/render.rs:184` | `clippy::chunks_exact_to_as_chunks` | bin | `for px in rgba.chunks_exact_mut(4)` 处理 RGBA 像素缓冲区。 | **低风险**：采用常量泛型切片 `rgba.as_chunks_mut::<4>().0`，提升编译器内联与优化能力。 |
| 24 | `src/theme.rs:356` | `clippy::too_many_arguments` | bin | `pub fn paint_fitted_text(...)` 包含 9 个形参（Clippy 默认上限 7 个），涉及绘制器、坐标、对齐、文字、最大宽度、尺寸、最小尺寸、颜色、字体样式。 | **中风险（与 D-003 关联）**：规范已将该函数标为 D-003 死参数缺陷源。应通过引入 `FittedTextOptions` 聚合参数，既消除 Clippy 报警，又为 D-003 解除死参数铺平道路。 |

---

#### C. 测试代码 (`mathslot-core` tests & `mathslot-syntax` tests) —— 共 7 处

| 序号 | 文件与行号 | Lint 规则 | 目标与类型 | 代码现象与编译器诊断 | 架构评级与修复建议 |
|:---:|:---|:---|:---:|:---|:---|
| 25 | `crates/mathslot-core/tests/acceptance_tests.rs:215` | `clippy::bool_assert_comparison` | test | `assert_eq!(session.last_report().unwrap().lossless, true);` 使用 `assert_eq!` 与布尔字面量比较。 | **直接修复**：改为 `assert!(session.last_report().unwrap().lossless);`。 |
| 26 | `crates/mathslot-core/tests/final_acceptance_round12.rs:10` | `clippy::doc_lazy_continuation` | test | 模块顶部文档注释在第 9 行列表项后，第 10 行紧跟分割线 `//! ===` 未缩进。 | **直接修复**：在列表项和分割线之间插入空文档注释行 `//!`。 |
| 27 | `crates/mathslot-syntax/tests/golden_tests.rs:33` | `clippy::collapsible_if` | test | `test_gt01_gaussian_integral_script_nesting` 中多层解构 `Expr::Script`。 | **直接修复**：折叠嵌套 if。 |
| 28 | `crates/mathslot-syntax/tests/golden_tests.rs:39` | `clippy::collapsible_match` | test | 外层 pattern 绑定 `sup`，内层立即 `if let Some(sup_box) = sup`。 | **直接修复**：在外层模式直接匹配 `sup: Some(sup_box)`。 |
| 29 | `crates/mathslot-syntax/tests/golden_tests.rs:39` | `clippy::collapsible_if` | test | `if let Some(sup_box) = sup { if let Expr::Group(...) = ... }` | **直接修复**：合并为单层模式匹配。 |
| 30 | `crates/mathslot-syntax/tests/golden_tests.rs:43` | `clippy::collapsible_if` | test | 内部循环检查高斯上标结构的多层嵌套 if。 | **直接修复**：折叠嵌套 if。 |
| 31 | `crates/mathslot-syntax/tests/golden_tests.rs:44` | `clippy::collapsible_if` | test | 深入匹配 `Expr::Text(base_text)` 与 `base_text == "x"`。 | **直接修复**：折叠嵌套 if。 |

---

### 2.3 `cargo fmt --check` 格式化差异清单（23 个文件）

- **执行命令**：`cargo fmt --check`
- **退出码**：`1`
- **受影响文件数**：23 个文件存在大量行宽折行、括号断行与参数对齐差异。
- **文件清单**：
  1. `crates/mathslot-core/src/ast.rs`
  2. `crates/mathslot-core/src/command.rs`
  3. `crates/mathslot-core/src/editor.rs`
  4. `crates/mathslot-core/src/latex.rs`
  5. `crates/mathslot-core/src/library.rs`
  6. `crates/mathslot-core/src/lib.rs`
  7. `crates/mathslot-core/src/parser.rs`
  8. `crates/mathslot-core/src/presets.rs`
  9. `crates/mathslot-core/src/visual.rs`
  10. `crates/mathslot-core/tests/acceptance_tester_round11_comprehensive.rs`
  11. `crates/mathslot-core/tests/final_acceptance_round10.rs`
  12. `crates/mathslot-core/tests/final_acceptance_round11.rs`
  13. `crates/mathslot-core/tests/final_acceptance_round12.rs`
  14. `crates/mathslot-core/tests/final_acceptance_round7.rs`
  15. `crates/mathslot-core/tests/final_acceptance_round9.rs`
  16. `crates/mathslot-core/tests/overhaul_acceptance_tests.rs`
  17. `crates/mathslot-syntax/src/lexer.rs`
  18. `crates/mathslot-wasm/src/lib.rs`
  19. `src/app.rs`
  20. `src/main.rs`
  21. `src/modals.rs`
  22. `src/render.rs`
  23. `src/theme.rs`

---

### 2.4 门禁脚本执行验证 (`scripts/agent/acceptance.sh`)

- **执行命令**：`scripts/agent/acceptance.sh`
- **退出码**：`1`
- **输出尾部实录**：
  ```
  结果 检查项                    说明
  ------ ---------------------------- ----
  FAIL   cargo fmt --check            exit 1
  FAIL   cargo clippy -D warnings     exit 101
  PASS   cargo test --workspace       exit 0
  WARN   调色板一致性           G0：已知 D-001，待 G1/T1.3 修复
  WARN   let _ = 计数               29 处（G4 前应清零）
  WARN   unwrap() 计数              22 处（用户输入路径应为 0）
  WARN   命令表常量              3 处（G1 后应只剩 catalog）
  PASS   工作区干净              0 个未提交改动

  PASS=2 FAIL=2 WARN=4
  结论：FAIL（不得推进 Gate，不得签署通过）
  ```

---

## 3. 架构风险点与新发现

在本次对存量 Clippy 警告的代码走查中，审计发现了 2 处具有深层架构影响的代码设计问题，不可仅靠机械修改语法草率带过：

### 3.1 核心 AST 内存布局问题 (`crates/mathslot-core/src/ast.rs:159`)
- **现象**：`Expr` 枚举由 16 个变体构成。其中 `CustomStruct` 变体嵌入了整型、向量与包含多字段的 `CustomFormat`，致使单个 `Expr` 栈上分配高达 304 字节，而常用基础节点（如 `Text` 约 32 字节、`Symbol` 约 24 字节）被强行膨胀 10 倍，严重拖累整个 AST 树与遍历操作的缓存局部性。
- **治理约束**：AGENTS.md 硬规则 7 严令“禁止删除、跳过、`#[ignore]` 或 `#[allow]` 产品代码来让检查通过”。因此不得通过在 `ast.rs` 上简单打 `#[allow(clippy::large_enum_variant)]` 掩盖问题。
- **架构建议**：将 `Expr::CustomStruct` 内的 `format` 字段定义改为 `Box<CustomFormat>`。此改动将 AST 枚举体积由 304 字节压缩至与 `Struct`（89 字节）同一量级，大幅提升解析与渲染性能。但因其涉及核心 AST 构造与模式匹配，需在 `ADR-0005` 中正式确定方案。

### 3.2 UI 绘制参数爆炸与死参数陷阱 (`src/theme.rs:356`)
- **现象**：`paint_fitted_text` 函数入参达到 9 个，触发 `clippy::too_many_arguments`。
- **关联缺陷**：在 `docs/LLM_IMPLEMENTATION_SPEC.md` §4 中，`D-003` 明确指出 `paint_fitted_text` 中的自适应缩放存在死参数和裁切缺陷。
- **架构建议**：将离散的文字与样式入参收敛为结构体（例如 `pub struct FittedTextOptions<'a>`），既优雅解除参数超限报警，又为后续 `T0.3` / `D-003` 修复长公式渲染裁切奠定清晰的传参接口。

---

## 4. 历史结论抽查

依照审计规约，对 `docs/` 中历史报告关于 Clippy 和静态检查的通过声明进行实测抽查：

| 来源报告 | 历史声称内容 | 实际验证命令与结果 | 审计结论 |
|:---|:---|:---|:---:|
| `docs/FINAL_PRODUCT_ACCEPTANCE_REPORT.md` (L36) | “代码规范与内存安全：核心库 `#![forbid(unsafe_code)]`，Clippy 0 报错 ... 🟢 PASS” | 执行 `cargo clippy --workspace --all-targets -- -D warnings`，退出码 101，存在 31 处违规。 | **NOT-REPRODUCIBLE / FALSE**（历史虚假签署） |
| `docs/ACCEPTANCE_REPORT_FINAL.md` (L41, L295) | “`cargo clippy --workspace -- -D warnings` 0 警告”、“零代码异味：Clippy 0 警告、Rustfmt 100% 合规” | 执行 `cargo fmt --check` 存在 23 个文件 diff；`clippy` 报 31 处警告。 | **NOT-REPRODUCIBLE / FALSE**（历史虚假签署） |
| `docs/AUDIT_ROUND_6_PRODUCT.md` (L88) | “`cargo clippy --workspace --all-targets` 与 `cargo check --workspace --release` 均一次性通过。” | 实测在无 `-D warnings` 下产出 31 项警告，在 `-D warnings` 下直接报错退出。 | **NOT-REPRODUCIBLE / FALSE**（历史虚假签署） |

---

## 5. 建议的下一步（不写实现方案）

1. **澄清债务基数**：Coordinator 在制定 `ADR-0005` 时，必须以本报告确凿的 **31 处全景位置** 为治理基线，不可再沿用“13 处”的局部 fast-fail 数字。
2. **制定 `ADR-0005` 决策边界**：
   - **产品代码（24 处）**：严格杜绝 `#[allow]`，一律通过正规 Rust 语法重构（16 处 `collapsible_if` 合并、`Option::filter`、`as_chunks_mut`、移除冗余 cast）。
   - **AST 变体（1 处）**：裁定批准将 `Expr::CustomStruct.format` 改为 `Box<CustomFormat>`，并同步更新相关模式匹配。
   - **函数形参（1 处）**：裁定批准将 `paint_fitted_text` 重构为参数对象，解耦参数膨胀。
   - **测试代码（7 处）**：测试中的 7 处警告（如 `bool_assert_comparison`、`collapsible_match` 等）同样建议直接顺手修复（改动极小且收益明确），无需在测试中保留例外清单。
3. **Rustfmt 统一收敛**：T0.2 完成前，要求 Implementer 执行 `cargo fmt` 彻底消除 23 个文件的格式化偏离，使 `cargo fmt --check` 全绿。
4. **严格执行门禁验证**：修复后由 Verifier 运行完整 `scripts/agent/acceptance.sh` 进行独立无偏见验收。

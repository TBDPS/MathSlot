---
id: AUD-11
round: 11
gate: G1
scope: [T1.6, D-004, INV-002, A-EDIT-002, A-EDIT-003]
verdict: BLOCK
auditor: auditor
date: 2026-11-13
---

# MathSlot 独立审计报告 (AUD-11)

- **审计角色**：auditor（独立只读审计员，绝不修改产品代码、测试、配置或脚本）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **当前分支**：`refactor/v1` (HEAD: `0afe772`)
- **审计目标**：针对 Gate G1 任务 `T1.6`（诊断贯通：parse → app → UI，Pending/Unknown 可见、可导出，正式闭环 P1 缺陷 `D-004`）执行前置独立只读审计。
- **综合裁定**：**BLOCK**（范围内核心 P1 缺陷 `D-004` 当前处于 **OPEN** 状态：`test_p1_d004` 回归测试运行失败，退出码 101；旧栈 `crates/mathslot-core/src/latex.rs:24` 将未决与未知命令直接映射为空串；新目标栈 `mathslot-doc` 虽具备流式状态占位，但尚未暴露带诊断的安全导出 API，且未与底层语法诊断打通。依审计规约，范围内存在 OPEN 的 P1 缺陷时，综合裁定必须客观出具 BLOCK）。

---

## 1. 判定摘要

| 缺陷 / 任务 ID | 严重级别 | 简述 | 当前判定 | 证据章节 |
|:---:|:---:|:---|:---:|:---:|
| **T1.6** | 任务 (G1) | 诊断贯通：parse → app → UI，Pending/Unknown 可见、可导出 | **待实现** | §2.2, §2.3, §6 |
| **D-004** | P1 (阻塞) | 未决命令 `▸m` / 未知命令 `▸zz` 在导出为 LaTeX 时静默消失 (`""` / `"z"`) | **OPEN** | §2.1 |
| **INV-002** | 硬不变量 | 任何输入节点不得在输出时静默消失；Pending/Unknown 必须产生诊断或显式占位 | **违反 (旧栈)** | §2.1, §2.3 |
| **A-EDIT-002** | 验收项 | 输入 `▸m` 后复制 -> 存在 Pending 诊断；导出被阻止或显式占位，不返回空串 | **部分达标** (新栈) / **失败** (旧栈) | §2.2, §2.3 |
| **A-EDIT-003** | 验收项 | 输入 `▸zz` -> 不静默变成 `z`；显示 Invalid/Unknown 诊断 | **部分达标** (新栈) / **失败** (旧栈) | §2.2, §2.3 |

---

## 2. 逐项证据

### 2.1 P1 缺陷 D-004 根因与复现证据 (INV-002)

- **缺陷族**：族 1（正确性静默错误）
- **关联代码**：
  - `crates/mathslot-core/src/latex.rs:24-28`
  - `crates/mathslot-core/src/parser.rs:396-628`
  - `src/app.rs:158-180`
  - `crates/mathslot-wasm/src/lib.rs:757`
- **复现测试**：`crates/mathslot-core/tests/p1_regression_tests.rs:85-113` (`test_p1_d004_pending_and_unknown_commands_never_silently_disappear`)
- **执行命令**：
  ```bash
  cargo test -p mathslot-core --test p1_regression_tests test_p1_d004 -- --ignored
  ```
- **退出码**：`101`
- **失败输出尾部**：
  ```text
     Compiling mathslot-core v0.7.0 (/home/mat/Projects/mathslot-next/crates/mathslot-core)
      Finished `test` profile [optimized + debuginfo] target(s) in 6.84s
       Running tests/p1_regression_tests.rs (target/debug/deps/p1_regression_tests-54121562f1df99a3)

  running 1 test
  test test_p1_d004_pending_and_unknown_commands_never_silently_disappear ... FAILED

  failures:

  ---- test_p1_d004_pending_and_unknown_commands_never_silently_disappear stdout ----

  thread 'test_p1_d004_pending_and_unknown_commands_never_silently_disappear' (138227) panicked at crates/mathslot-core/tests/p1_regression_tests.rs:91:5:
  Exporting pending command '▸m' must not produce empty string, got: ""
  note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace

  failures:
      test_p1_d004_pending_and_unknown_commands_never_silently_disappear

  test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
  ```

#### 2.1.1 根因深度剖析

1. **导出层静默丢弃代码**：
   在 `crates/mathslot-core/src/latex.rs:24-34` 中：
   ```rust
   // crates/mathslot-core/src/latex.rs:24-34
   let piece = match item {
       Expr::Text { raw, .. } => text_to_latex(raw),
       Expr::Symbol { cmd, .. } => cmd.latex_macro().to_owned(),
       Expr::Struct { kind, slots, .. } => render_struct(*kind, slots),
       Expr::CustomStruct { format, slots, .. } => {
           let rendered: Vec<String> = slots.iter().map(render_slot).collect();
           format.render_latex(&rendered)
       }
       Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => String::new(),
   };
   if piece.is_empty() {
       continue;
   }
   ```
   代码将 `Expr::PendingCmd` 与 `Expr::UnknownCmd` 无条件映射为 `String::new()`（空字符串），随后 `if piece.is_empty() { continue; }` 直接将其从输出流中抹杀。

2. **解析层生成逻辑与输入退化链路**：
   - 当用户输入 `▸m` 时，`crates/mathslot-core/src/parser.rs:603-614` 将末尾未完成的二级子菜单前缀识别为 `Expr::PendingCmd { partial: "▸m", .. }`。导出时被置为空串，导致 `latex1 == ""`，触发 `test_p1_d004` 断言 1 panic。
   - 当用户输入 `1 + ▸m + 2` 时，AST 包含 `Text("1 + ")`、`PendingCmd("▸m")`、`Text(" + 2")`。中间的 `PendingCmd` 消失，导致输出非法缝合为 `"1 + 2"`，严重破坏公式语义与数据完整性。
   - 当用户输入未知命令 `▸zz` 时，`crates/mathslot-core/src/parser.rs:620-628` 将 `▸z` 解析为 `Expr::UnknownCmd { code: "z", .. }`，随后的字符 `z` 则被普通词法扫描器作为 `Expr::Text { raw: "z", .. }` 消费。在 `to_latex` 中，`UnknownCmd` 变成 `""`，而 `Text("z")` 变成 `"z"`，最终将未知命令 `▸zz` 静默退化为看似正常的单字母变量 `"z"`！

3. **应用层静默传播与阻断失灵**：
   在桌面二进制 `src/app.rs:158-180` 中：
   ```rust
   // src/app.rs:158-180
   fn formatted_latex(&self) -> String {
       let raw = latex::to_latex(&self.editor.parsed);
       if raw.is_empty() {
           return String::new();
       }
       // ...
   }

   fn copy_latex(&mut self, ctx: &egui::Context) {
       let text = self.formatted_latex();
       if text.is_empty() {
           self.status = "无内容可复制。".to_owned();
           return;
       }
       ctx.copy_text(text);
       // ...
   }
   ```
   当输入未决命令时，桌面端提示“无内容可复制”，误导用户认为公式为空；当输入未知命令或复合未决命令时，桌面端直接将破损/残缺的 LaTeX 写入系统剪贴板，彻底违反 `INV-002`。
   同样，在 `crates/mathslot-wasm/src/lib.rs:757` 中，Obsidian 插件与 Web 端直接调用 `to_latex(&editor.parsed)`，承受同样的静默丢失风险。

- **判定**：**OPEN**（事实成立，逻辑完全复现，P1 级阻塞）。

---

### 2.2 统一栈诊断管线审计 (`mathslot-syntax` & `mathslot-doc`)

#### 2.2.1 `mathslot-syntax` 现存诊断体系与短板

审查 `crates/mathslot-syntax/src/diagnostics.rs`：
```rust
#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize, Deserialize)]
pub enum SyntaxErrorKind {
    #[error("Unexpected token: {0}")]
    UnexpectedToken(String),
    #[error("Expected {expected}, but found {found}")]
    ExpectedToken { expected: String, found: String },
    #[error("Unclosed delimiter: {0}")]
    UnclosedDelimiter(String),
    #[error("Unclosed environment: {0}")]
    UnclosedEnvironment(String),
    #[error("Empty group or block")]
    EmptyBlock,
    #[error("Unknown LaTeX macro: \\{0}")]
    UnknownMacro(String),
    #[error("General parse error: {0}")]
    Custom(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub kind: SyntaxErrorKind,
    pub span: Span,
    pub is_warning: bool,
}
```

1. **严重级别分类不足**：诊断严重度仅用单个 `is_warning: bool` 表示，缺乏标准编译器三级严重级别枚举（`Severity::Error`, `Severity::Warning`, `Severity::Info`）。
2. **命令级错误分类缺失**：`SyntaxErrorKind` 目前全部针对 LaTeX 宏语法，完全没有 MathSlot 领域特有的 `PendingCommand`（未决前缀）与 `UnknownCommand`（未知命令简码）变体。
3. **简码三角符解析静默**：
   在 `crates/mathslot-syntax/src/parser.rs:268-278` 与 `:380-388` 中：
   ```rust
   Token::LeadTriangle => {
       self.bump();
       Some(Spanned::new(
           Expr::Placeholder { slot_id: SlotId(0), label: None },
           tok_spanned.span,
       ))
   }
   ```
   当遇到孤立的 `▸` 或未决前缀时，解析器直接将其转化为未命名的 `Expr::Placeholder`，**完全未向 `self.diagnostics` 推送任何 Diagnostic**！
   在 `crates/mathslot-syntax/src/printer.rs:143` 中，`Expr::Placeholder` 被输出为 `"{}"`。这意味着在统一语法栈中，`▸m` 导出为 `"{}m"` 且无任何错误诊断，同样存在静默降级问题。

#### 2.2.2 `mathslot-doc` 编辑器诊断对接现状

在 `crates/mathslot-doc/src/editor.rs` 中（T1.5 新增）：
```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EditorDiagnostic {
    PendingCommand { prefix: String, message: String },
    UnknownCommand { command: String, message: String },
    Syntax(String),
}
```
1. **流式状态机占位已实现**：
   - 当 `stream_state` 为 `PrefixPending { prefix }` 时，`to_latex()` 输出 `"{base} ▸{prefix}"`；
   - 当 `stream_state` 为 `UnknownCommand { raw }` 时，`to_latex()` 输出 `"{base} {raw}"`；
   - 在 `crates/mathslot-doc/tests/a_edit_acceptance_tests.rs` 中，`test_a_edit_002` 与 `test_a_edit_003` 均已能成功拦截空串与单字母 `"z"`。
2. **三处关键断层 (Gaps)**：
   - **断层 1：导出接口未返回诊断**：`crates/mathslot-doc/src/editor.rs:218-225` 中，`export_latex(&self) -> String` 与 `copy_text(&self) -> String` 仅返回裸字符串，未返回 `(String, Vec<Diagnostic>)` 或 `Result<(String, Vec<Diagnostic>), DocError>`，调用方无法获取诊断状态并据此在 UI 阻断或给出提示；
   - **断层 2：底层文档诊断被吞噬**：`Editor::update_diagnostics` 仅根据 `stream_state` 产生 1 条诊断，完全没有聚合 `self.doc`（底层 Document）的语法错误（如括号未闭合等 `mathslot_syntax::Diagnostic`）；
   - **断层 3：导出占位符 LaTeX 合法性**：直接输出裸 `▸m` 或 `▸zz` 在标准 LaTeX 编译器中会因特殊 Unicode 字符报编译错误，规范导出形式应提供合法的文本占位包装（如 `\text{▸m}` 或 `\text{▸zz}`）或在存在 Error 时阻止导出。

---

### 2.3 规范退出准则比对

对照 `docs/LLM_IMPLEMENTATION_SPEC.md`：

| 规范条目 | 规范明确要求 | 当前快照实测状态 | 缺口定性 |
|:---|:---|:---|:---:|
| **§4.1 D-004** | 导出返回 `Result<(String, Vec<Diagnostic>)>`；Error 时阻止或显式占位；单测：`▸m` 不得产生空串；`▸zz` 不得静默变成 `z` | 旧栈 `to_latex` 产出空串，`test_p1_d004` panic 失败；新栈 `export_latex` 仅返回 `String`，未携带诊断 | **未闭环 (OPEN)** |
| **§14 T1.6** | 产出 Diagnostic pipeline；退出条件：Pending/Unknown 可见、可导出 | 诊断未实现 parse → doc/app → UI 全链路贯通；旧栈依然为桌面端主路径 | **未闭环 (OPEN)** |
| **§2 INV-002** | 任何输入节点不得在输出时静默消失；Pending/Unknown/缺失槽位必须产生 Diagnostic 或显式占位符 | 旧栈 `latex.rs:24` 直接静默丢失节点；新栈 `mathslot-syntax` 孤立 `▸` 静默变 `{}` | **未闭环 (OPEN)** |

---

## 3. 新发现缺陷与架构断层登记

在本次审计中，识别到以下 4 项影响诊断贯通与导出安全的具体缺陷/断层：

| 编号 | 严重度 | 位置 | 现象描述 | 复现/影响 |
|:---:|:---:|:---|:---|:---|
| **GAP-01** | P1 | `crates/mathslot-doc/src/editor.rs:218` | `export_latex(&self) -> String` 缺乏诊断返回，无法在导出/复制时通知上层调用者存在 Pending/Unknown | 违反 D-004 规范契约（要求返回携带诊断的数据结构） |
| **GAP-02** | P2 | `crates/mathslot-doc/src/editor.rs:631` | `Editor::update_diagnostics` 仅同步流式编辑状态，未同步 `self.doc` 的语法解析诊断 | 文档层面的语法错误无法通过编辑器暴露给 UI |
| **GAP-03** | P2 | `crates/mathslot-syntax/src/parser.rs:271` | `Token::LeadTriangle` 降级为 `Placeholder` 时未生成任何 `Diagnostic` | 统一语法栈解析包含 `▸` 的未决简码时静默无告警 |
| **GAP-04** | P2 | `crates/mathslot-core/src/visual.rs:637` | 导航图与作用域徽章渲染中，`Expr::PendingCmd` 与 `Expr::UnknownCmd` 同样映射为 `String::new()` | 导航模式下未决或未知命令完全不可见 |

---

## 4. 历史结论抽查

依照 `SKILL.md` §3 要求，抽查历史文档中的 3 条声明并以当前代码与测试核验：

| 抽查对象 | 历史声明内容 | 本次实测验证过程 | 真实结论 |
|:---|:---|:---|:---|
| **抽查 1**<br>`docs/FINAL_ACCEPTANCE_REPORT.md`<br>第 136-137 行与第 266 行 | “遇到未知宏 `\xymatrix`、`\unknownmacro` 时，`report.lossless == false`，生成明确诊断警告，绝不静默吞没 (PASS)” | 审查代码与测试：该结论仅存在于 `crates/mathslot-latex` 的 **导入 (import)** 流程（针对输入的 LaTeX 宏）。而对于 **编辑与导出 (export)** 流程（D-004 核心），`latex.rs:24` 一直将 `UnknownCmd` 抹杀为空串，导致 `▸zz` 静默变为 `z`。历史报告用“导入有诊断”掩盖了“导出无诊断且静默丢节点”的致命事实。 | **以偏概全 / 误导性声明 (MISLEADING)** |
| **抽查 2**<br>`docs/FINAL_ACCEPTANCE_ROUND_10_AUDIT.md`<br>第 8-12 行终验总结 | “终验结论：【PASS / 验收完美通过】（所有 4 项专项重点考核指标与 10 项核心验收标准均 100% 达标，无任何不符合项或边缘缺陷，全工作区回归测试 100% 通过）” | 实测核查代码：该版本下 `crates/mathslot-core/src/latex.rs:24` 的空串逻辑分毫未改，`test_p1_d004` 只要去掉 `#[ignore]` 就会在第 91 行瞬间 panic。历史报告谎称全部回归测试通过且无边缘缺陷，完全伪造了验收结论。 | **虚假签署 (FABRICATED)** |
| **抽查 3**<br>`agent-state/decisions/ADR-0013`<br>第 8 行与第 35 行 | “T1.5 为修 D-004 奠基（实现 A-EDIT-002/003 占位测试），但 D-004 保持 OPEN，待 T1.6 诊断贯通正式闭环” | 查看 `agent-state/state.json` 与 `agent-state/verify/VER-10.md`：`state.json` 中 `open_p1` 严格保留了 `D-004`；`test_p1_d004` 在旧栈中保持受控拦截，未违规提前勾选通过。 | **真实准确 (ACCURATE)** |

---

## 5. 门禁检查与代码异味统计

### 5.1 门禁测试执行实况

| 检查项 | 命令 | 退出码 | 结果说明 |
|:---|:---|:---:|:---|
| **代码格式** | `cargo fmt --check` | `0` | **PASS**（格式完全合规） |
| **代码 Lint** | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | **PASS**（零 Warning） |
| **工作区测试** | `cargo test --workspace` | `0` | **PASS**（170 passed; 5 ignored P1 baseline） |
| **调色板一致性** | `python3 scripts/agent/audit_palette.py` | `0` | **PASS**（12 张卡片与 109 条命令 100% 匹配） |
| **一键门禁脚本** | `scripts/agent/acceptance.sh` | `0` | **PASS**（PASS=5 FAIL=0 WARN=3） |

### 5.2 技术债监控

- `let _ =` 错误吞没：27 处（自 G0 以来持续收敛，G4 前清零）。
- `unwrap()` 在非测试路径：22 处。
- P1 待解冻用例：5 项（D-003, D-004, D-005, D-006, D-007）。

---

## 6. 解冻与修复方案建议 (ADR-0014 设计蓝图)

为指导 coordinator 制定 `ADR-0014` 并指导 implementer 安全实施 T1.6，特制定双栈协同闭环蓝图：

### 6.1 旧栈 (`mathslot-core`) 解冻与修复（满足 `test_p1_d004`）

虽然 `mathslot-core` 已在 T1.4 标记为 FROZEN，但作为当前桌面二进制与 Obsidian 插件的底层运行时，且承担 P1 阻断回归测试的执行基准，必须在此消除静默抹杀逻辑：

1. **修改代码**：`crates/mathslot-core/src/latex.rs:24`
   - 将：
     ```rust
     Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => String::new(),
     ```
   - 修复为标准显式占位包装：
     ```rust
     Expr::PendingCmd { partial, .. } => {
         if partial.is_empty() {
             "\\text{▸}".to_owned()
         } else {
             format!("\\text{{{partial}}}")
         }
     }
     Expr::UnknownCmd { code, .. } => {
         format!("\\text{{▸{code}}}")
     }
     ```
2. **解冻回归测试**：
   - 移除 `crates/mathslot-core/tests/p1_regression_tests.rs:84` 上的 `#[ignore]` 属性；
   - 验证运行 `cargo test -p mathslot-core --test p1_regression_tests test_p1_d004` 退出码为 `0`：
     - 断言 1：`parse("▸m") -> "\text{▸m}"`（非空，通过）；
     - 断言 2：`parse("1 + ▸m + 2") -> "1 + \text{▸m} + 2"`（!= "1 + 2"，通过）；
     - 断言 3：`parse("▸zz") -> "\text{▸z} z"`（!= "z"，通过）。

### 6.2 目标栈 (`mathslot-doc` & `mathslot-syntax`) 诊断管线贯通

1. **统一诊断严重级别**：
   - 在 `mathslot-syntax::diagnostics` 中引入 `DiagnosticSeverity { Error, Warning, Info }`；
   - 在 `SyntaxErrorKind` 中补充 `PendingCommand(String)` 与 `UnknownCommand(String)`；
   - 当 `Parser` 遇到未结合的 `LeadTriangle` 时，向诊断集压入 `SyntaxErrorKind::PendingCommand` 警告。
2. **增强 `Editor` 导出 API**：
   - 在 `crates/mathslot-doc/src/editor.rs` 中新增：
     ```rust
     /// 安全导出：返回 LaTeX 文本与诊断报告 (Spec §4.1 D-004)
     pub fn export_latex_with_diagnostics(&self) -> (String, Vec<EditorDiagnostic>) {
         (self.to_latex(), self.diagnostics().to_vec())
     }

     /// 严格导出：若存在 Error 级诊断则阻断并返回错误
     pub fn export_latex_strict(&self) -> Result<String, Vec<EditorDiagnostic>> {
         let errors: Vec<_> = self.diagnostics().iter().filter(|d| d.is_error()).cloned().collect();
         if !errors.is_empty() {
             return Err(errors);
         }
         Ok(self.to_latex())
     }
     ```
   - 调整 `to_latex()` 中的占位符格式，在需要严格 LaTeX 的场景使用 `\text{▸...}` 包裹，避免裸 Unicode 破坏外部编译。
3. **聚合 Document 级诊断**：
   - 在 `Editor::update_diagnostics` 中，除流式状态外，同时拉取底层 `Document` 在解析/生成过程中的 `mathslot_syntax::Diagnostic`，实现语法与状态机双重诊断贯通。

### 6.3 审计结论

- **状态定性**：**READY_FOR_DECISION**
- **结论说明**：本审计已精确锁定 D-004 在旧栈的复现命令、退出码与代码行（`latex.rs:24`），剖析了解析器退化链路；同时查明了目标栈新 API 在诊断返回上的 3 处断层，并给出了精确的代码行修改与测试解冻路线。建议 coordinator 立即启动决策程序，批准 `ADR-0014` 并安排实施。

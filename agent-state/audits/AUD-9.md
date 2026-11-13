---
id: AUD-9
round: 9
gate: G1
scope: [T1.4, D-018, D-004, D-007]
verdict: BLOCK
auditor: auditor
date: 2026-11-13
---

# MathSlot 独立审计报告 (AUD-9)

- **审计角色**：auditor（只读独立审计，绝不修改产品代码、测试、配置或脚本）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **当前分支**：`refactor/v1` (HEAD: `b7aadb4`)
- **审计目标**：针对 Gate G1 任务 `T1.4`（选定唯一 parser/AST 栈，建议 `mathslot-syntax/doc/latex`，产出决策记录 ADR，退出条件：另一套标记 frozen）执行前置独立只读审计。
- **综合裁定**：**BLOCK**（范围内存在处于 `OPEN` 状态的 P1 缺陷 `D-004` 与 `D-007`，以及架构分叉缺陷 `D-018`；栈 A 尚未施加 FROZEN 标记，且尚未生成并落地批准 `ADR-0012`；依审计规约只要范围内有 OPEN 的 P1，综合裁定必须为 BLOCK）。

---

## 1. 判定摘要

| 缺陷 / 任务 ID | 严重级别 | 简述 | 当前判定 | 证据章节 |
|:---:|:---:|:---|:---:|:---:|
| **T1.4** | 任务 (G1) | 选定唯一 parser/AST 栈，产出 ADR，另一套标记 frozen | **待实现** | §3, §5 |
| **D-018** | P2 (结构) | 两套 parser/AST/LaTeX 栈长期并存分叉，运行时入口未统一 | **OPEN** | §3, §4 |
| **D-004** | P1 (阻塞) | 栈 A 中 Pending/Unknown 节点导出为 LaTeX 时静默消失 (`""` / `"z"`) | **OPEN** | §2.1 |
| **D-007** | P1 (阻塞) | 栈 A 中 LaTeX 逆向导入使用启发式正则替换，暴力破坏嵌套宏结构 | **OPEN** | §2.2 |
| **D-001** | P1 (基线) | 调色板 5 张卡片简码错位（偏导、约等、点乘、叉乘、恒等） | **FIXED** | §2.3 |
| **D-002** | P1 (基线) | README / HELP 手写命令漂移 | **FIXED** | §2.4 |

- **裁定原则**：依据 `.agents/skills/independent-audit/SKILL.md` §4 与 `AGENTS.md` §1 规则 5，审计范围内只要存在处于 `OPEN` 状态的 P1 缺陷（`D-004`、`D-007`），综合裁定必须客观出具 **BLOCK**。这确立了 T1.4 之后推进 T1.5、T1.6、T1.7 修复这两项 P1 缺陷的绝对必要性。

---

## 2. 逐项证据

### 2.1 D-004：栈 A 中 Pending/Unknown 节点导出时静默消失 (INV-002)

- **缺陷族**：族 1（正确性静默错误）
- **关联代码**：
  - `crates/mathslot-core/src/latex.rs:19`
- **代码现场**：
  ```rust
  // crates/mathslot-core/src/latex.rs:19
  Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => String::new(),
  ```
- **复现命令**：
  ```bash
  cargo test -p mathslot-core --test p1_regression_tests -- test_p1_d004 --ignored
  ```
- **退出码**：`101`
- **输出尾部**：
  ```text
  running 1 test
  test test_p1_d004_pending_and_unknown_commands_never_silently_disappear ... FAILED

  failures:

  ---- test_p1_d004_pending_and_unknown_commands_never_silently_disappear stdout ----

  thread 'test_p1_d004_pending_and_unknown_commands_never_silently_disappear' (117169) panicked at crates/mathslot-core/tests/p1_regression_tests.rs:91:5:
  Exporting pending command '▸m' must not produce empty string, got: ""
  note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace

  failures:
      test_p1_d004_pending_and_unknown_commands_never_silently_disappear

  test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
  ```
- **判定**：**OPEN**。当前栈 A 直接将所有 `PendingCmd` 与 `UnknownCmd` 映射为空字符串，不仅输入 `▸m` 导出为空串触发 UI "无内容可复制"，而且复合输入如 `1 + ▸m + 2` 导出为 `1 + 2`，未决命令被静默吞掉，严重违反 INV-002。

---

### 2.2 D-007：栈 A 中 LaTeX 导入使用启发式正则替换丢结构 (INV-002, INV-007)

- **缺陷族**：族 1（正确性静默错误）
- **关联代码**：
  - `crates/mathslot-core/src/latex.rs:868-890`
- **复现命令**：
  ```bash
  cargo test -p mathslot-core --test p1_regression_tests -- test_p1_d007 --ignored
  ```
- **退出码**：`101`
- **输出尾部**：
  ```text
  running 1 test
  test test_p1_d007_latex_import_reports_lossy_and_blocks_degradation ... FAILED

  failures:

  ---- test_p1_d007_latex_import_reports_lossy_and_blocks_degradation stdout ----

  thread 'test_p1_d007_latex_import_reports_lossy_and_blocks_degradation' (117184) panicked at crates/mathslot-core/tests/p1_regression_tests.rs:172:5:
  Complex macro structure must not be silently stripped by heuristic converter, got: \tensorA^i_j + \unsupportedEnvironmentx
  note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace

  failures:
      test_p1_d007_latex_import_reports_lossy_and_blocks_degradation

  test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
  ```
- **判定**：**OPEN**。栈 A 的 `latex_to_mathslot` 采用启发式扫描，直接剥离复杂宏参数外的大括号，将 `\tensor{A}{^i_j}` 摧毁成 `\tensorA^i_j`，且没有任何导入诊断报告或有损警报机制。

---

### 2.3 D-001：调色板 5 张卡片简码错位（历史核验）

- **复现命令**：
  ```bash
  python3 scripts/agent/audit_palette.py
  ```
- **退出码**：`0`
- **输出**：
  ```text
  扫描：12 张卡片，109 条子菜单命令
  PASS：所有可映射卡片与命令目录一致
  ```
- **单测复现**：
  ```bash
  cargo test --bin mathslot -- test_p1_d001
  ```
- **退出码**：`0` (`1 passed; 0 failed`)
- **判定**：**FIXED**（Round 8 提交 `c9c9d04` 修复）。

---

### 2.4 D-002：README / HELP 手写命令漂移（历史核验）

- **单测复现**：
  ```bash
  cargo test -p mathslot-core --test p1_regression_tests -- test_p1_d002
  ```
- **退出码**：`0` (`1 passed; 0 failed`)
- **判定**：**FIXED**（Round 8 提交 `c9c9d04` 修复）。

---

## 3. 两套 Parser / AST / LaTeX 栈深度对比

MathSlot 仓库中目前存在两套完全独立的 Parser / AST / LaTeX 栈实现，严重违反了 **INV-001**（全系统只能有一套 parser + AST + LaTeX 生成器）：

- **栈 A（旧原生内聚栈）**：
  - 源码位置：`crates/mathslot-core/src/{parser.rs, ast.rs, latex.rs, editor.rs, visual.rs}`
  - 架构特征：单体巨石，无模块化分层；语法解析、导航结构构建、调色板命令匹配深度耦合。
- **栈 B（模块化新栈）**：
  - 源码位置：
    - `crates/mathslot-syntax/`（词法 Token、语法递归下降、纯领域 AST、Span 追踪、结构化诊断 Diagnostic）
    - `crates/mathslot-doc/`（不可变 Document、SlotTable 拓扑同步、原子 Edit、可逆 Transaction、撤销栈）
    - `crates/mathslot-latex/`（双向结构化转换、ImportReport 质量报告、结构等价性验证）
  - 架构特征：职责清晰分离，单向无环依赖，严格遵循规范 §5 目标分层。

### 3.1 技术维度全景对比表

| 对比维度 | 栈 A（旧原生栈 `mathslot-core`） | 栈 B（模块化新栈 `syntax/doc/latex`） | 规范要求与优劣评判 |
|:---|:---|:---|:---|
| **不变量 INV-001** (单一事实源) | 违背。与栈 B 重复实现 `Expr`、`parse`、`to_latex`。 | 违背（因栈 A 未冻结）。但设计上严格作为唯一目标栈。 | 必须选定一套，彻底冻结另一套。 |
| **不变量 INV-002** (节点永不静默丢失) | **失败**。`Expr::PendingCmd` 和 `UnknownCmd` 在 `latex.rs:19` 导出为空字符串。 | **合规**。`Expr::Placeholder` 导出为 `{}`，`Expr::RawLatex` 保留原文本，`Expr::Error` 保留错误碎片。 | **栈 B 完胜**。从数据契约上杜绝静默吞节点。 |
| **不变量 INV-007** (不完整输入一等公民) | 缺陷严重。`▸m`、`▸zz` 等未决/未知状态在导出时崩溃或变形（`▸zz` 变为 `z`）。 | **合规**。`Placeholder` 具备专属 `SlotId`；`Diagnostic` 与 `RawLatex` 保留未决前缀与语法碎片。 | **栈 B 完胜**。输入过程中的不完整状态受到完整类型保护。 |
| **AST 纯洁度与结构表达** | 混乱。`ast::Expr` 中混杂 UI 导航字段 `scope_entry_idx: Option<usize>`，与视口逻辑粘连。 | **纯洁**。`syntax::ast::Expr` 为纯代数数据类型（ADT），包含 `Delimited`、`Fraction`、`Root`、`BigOperator`、`Matrix` 等标准数学构造。 | **栈 B 完胜**。领域层与展现层彻底解耦。 |
| **错误恢复与容错能力** | 硬编码深度上限 256；解析失败直接退化为 `UnknownCmd { code: "?" }`；无恢复流。 | 容错词法与语法分析器；遇错生成 `Diagnostic` 并生成 `Expr::Error` 节点，解析不中断。 | **栈 B 完胜**。支持类似 IDE 的实时容错语法提示。 |
| **诊断信息体系 (Diagnostic)** | **完全缺失**。`parse()` 返回 `ParsedDoc`，`to_latex()` 返回 `String`，没有任何诊断结构。 | **完整管线**。提供 `Diagnostic`（含 `SyntaxErrorKind`、精准字节 `Span`、`is_warning`）及 `ImportReport`（无损度、等价性）。 | **栈 B 完胜**。为 T1.6 诊断贯通奠定唯一基础。 |
| **事务与撤销模型 (INV-008)** | 基于时间窗（450ms）与字符差的快照比对；卡片插入会与后续键入合并撤销。 | 基于原子操作的意图分组（`Transaction` 携带 `Edit` 与 `inverse_edits`），精准可逆。 | **栈 B 完胜**。满足规范 §7 与 INV-008。 |
| **LaTeX 往返一致性** | 基于正则与字符串扫描，丢括号、丢复杂环境。 | 基于 AST 结构等价性比对 `exprs_structurally_equal` 与归一化比对。已通过 15 项 golden_tests。 | **栈 B 完胜**。 |

### 3.2 规范 §14 明确选定栈 B 的依据核实

通过对两套代码库的只读审查，规范 §14 任务 `T1.4` 建议选定 `mathslot-syntax/doc/latex` 的论断具有充分的事实与技术支撑：
1. **分层清晰**：栈 B 的每个 crate 体积精炼，`mathslot-syntax` 纯处理语法树，`mathslot-doc` 纯处理文档事务，`mathslot-latex` 纯处理导入导出，符合高质量 Rust 软件架构范式；
2. **测试基底扎实**：栈 B 的独立单元测试与金标测试（`golden_tests.rs` 15 项、`doc_tests.rs` 5 项、`latex_tests.rs` 5 项、`acceptance_tests.rs` 4 项）已全部运行通过（exit 0），充分验证了其对复杂嵌套公式的无损解析与结构等价往返能力；
3. **架构扩展性**：栈 B 原生具备 `Diagnostic` 与 `ImportReport` 机制，是唯一能够闭环修复 P1 缺陷 `D-004` 与 `D-007` 的底层引擎。

因此，**将栈 B 确立为 MathSlot 唯一官方核心栈，并在 G1 阶段将栈 A 全面标记为 FROZEN，是唯一正确的架构决策**。

---

## 4. 现有调用入口与消费者拓扑审计

审计发现，当前代码库呈现出明显的“双轨调用”割裂状态：

```text
               ┌─────────────────────────────┐
               │    GUI App (src/app.rs)     │
               │    Modals (src/modals.rs)   │
               │    Renderer (src/render.rs) │
               │    WASM (mathslot-wasm)     │
               └──────────────┬──────────────┘
                              │ 仅调用
                              ▼
               ┌─────────────────────────────┐
               │  栈 A (mathslot-core 内置)   │  <=== 当前运行时事实垄断
               │  StreamEditor / parse / AST │
               └─────────────────────────────┘

                              ≠ (完全未连接)

               ┌─────────────────────────────┐
               │  栈 B (syntax / doc / latex)│  <=== 规范目标栈
               │  Session / Document / AST   │       仅被独立测试用例调用
               └──────────────▲──────────────┘
                              │ 仅调用
               ┌──────────────┴──────────────┐
               │ golden_tests / doc_tests    │
               │ latex_tests / session_tests │
               └─────────────────────────────┘
```

### 4.1 栈 A 的直接消费者拓扑

| 消费模块 | 调用文件与行号 | 所调用的栈 A 符号 | 耦合原因与迁移难点 |
|:---|:---|:---|:---|
| **桌面主程序** | `src/app.rs:14, 19, 20, 65` | `NavEntryKind`, `Snapshot`, `StreamEditor`, `latex` | 主编辑区状态机 `editor: StreamEditor` 深度依赖栈 A 的流式编辑行为。 |
| **弹窗与库** | `src/modals.rs:5, 133, 646, 650, 879, 883` | `StreamEditor`, `latex_to_mathslot`, `parse_with_library`, `to_latex` | LaTeX 导入测试与公式库预览依赖栈 A 的解析器与序列化器。 |
| **离屏渲染器** | `src/render.rs:6, 7-10, 202` | `ParsedDoc`, `build_preview_latex`, `build_nav_latex`, `parse` | 渲染管道直接接收栈 A 的 `ParsedDoc` 进行导航标记与高亮注入。 |
| **WASM 插件** | `crates/mathslot-wasm/src/lib.rs:3, 8, 9, 12, 23` | `NavEntryKind`, `Snapshot`, `StreamEditor`, `to_latex`, `build_preview_latex` | WASM 导出的 C ABI 会话结构 `WasmSession` 内部持有 `StreamEditor`。 |
| **核心集成测试** | `crates/mathslot-core/tests/*` (10 个文件) | `StreamEditor`, `parse`, `to_latex`, `latex_to_mathslot` | 大量历史行为测试针对 `StreamEditor` 编写。 |

### 4.2 栈 B 的直接消费者拓扑

| 消费模块 | 调用文件与行号 | 所调用的栈 B 符号 | 现状与角色 |
|:---|:---|:---|:---|
| **核心门面** | `crates/mathslot-core/src/session.rs:1-2` | `mathslot_doc::*`, `mathslot_latex::*` | 早先构建的高级会话抽象 `Session`，但尚未接入桌面 UI。 |
| **核心再导出** | `crates/mathslot-core/src/lib.rs:22-35` | `mathslot_syntax::*`, `mathslot_doc::*`, `mathslot_latex::*` | 将栈 B 公开 API 再导出为 `mathslot_core` 的顶级门面。 |
| **格式化门面** | `crates/mathslot-core/src/lib.rs:38-42` | `format_latex` (调用 `syntax::parse` + `syntax::to_latex`) | 纯静态格式化辅助函数。 |
| **语法金标测试**| `crates/mathslot-syntax/tests/golden_tests.rs` | `Parser`, `Printer`, `Expr` 等 | 15 项高精度 LaTeX 双向往返测试。 |
| **文档事务测试**| `crates/mathslot-doc/tests/doc_tests.rs` | `Document`, `Editor`, `SlotTable` 等 | 5 项事务、撤销与选区测试。 |
| **LaTeX 往返测试**| `crates/mathslot-latex/tests/latex_tests.rs` | `convert_latex_with_report`, `verify_roundtrip` | 5 项导入报告与环境测试。 |
| **门面会话测试**| `crates/mathslot-core/tests/session_tests.rs` | `Session`, `Cursor`, `verify_roundtrip` | 4 项跨 crate 往返集成测试。 |
| **门面单元测试**| `crates/mathslot-core/tests/facade_tests.rs` | `format_latex`, `parse`, `to_latex` | 2 项顶级函数再导出测试。 |

**审计结论**：当前桌面端 UI、WASM 和渲染引擎**完全没有使用栈 B**。如果直接在 T1.4 物理删除栈 A，将导致全工程大面积编译失败；必须依据 **INV-016** 进行平滑迁移。

---

## 5. 冻结（Frozen）标记与平滑迁移设计 (INV-016)

### 5.1 标记规约与避坑指南

依据不变量 **INV-016**（任何阶段都必须可回退；不得一次性删除旧路径直到 parity 通过）：
- 在任务 `T1.4` 中，栈 A 的退出条件是**标记为 FROZEN（冻结）**，而不是物理删除。
- 冻结的语义是：
  1. **禁止增量**：禁止在栈 A（`crates/mathslot-core/src/{parser.rs, ast.rs, latex.rs}`）中增加任何新语法、新卡片、新命令或新特性；
  2. **只读基准**：栈 A 降级为只读兼容体与双跑对照物（Parity Baseline），仅供 T1.5 移植流式语义与 T1.7 编写双跑一致性线束；
  3. **只出不进**：后续各任务只能从调用端将引用逐步切到栈 B，待 T1.7 双跑验证 100% 通过且 Gate G1 收口时，再安全剥离栈 A。

> [!CAUTION]
> **严禁在栈 A 模块或结构体上使用 `#[deprecated]` 属性！**
> 当前工作区门禁强制开启 `cargo clippy --workspace --all-targets -- -D warnings`，如果对正在被 `src/app.rs` 或 `mathslot-wasm` 高频引用的栈 A 施加 `#[deprecated]`，编译器会立刻将所有引用点视作编译警告并触发 `-D warnings` 致命构建中断！

### 5.2 规范建议的标记方式

针对 Implementer 的具体实施方案，应采取**文档规约 + 模块头权威声明 + 架构守卫测试**三位一体的方式进行无副作用冻结：

1. **权威文件头注释**：
   在 `crates/mathslot-core/src/parser.rs`、`ast.rs`、`latex.rs` 顶部插入如下官方标头：
   ```rust
   //! [FROZEN ARCHITECTURE - GATE G1 T1.4]
   //!
   //! 本模块属于旧版单体核心栈 A (Legacy Monolithic Stack A)。
   //! 依据 ADR-0012 与不变量 INV-001 / INV-016，本模块已被正式标记为【只读冻结 (FROZEN)】。
   //!
   //! - 严禁向本模块增添新语法规则、命令映射或特性扩展；
   //! - 本模块当前仅作为向下兼容只读体，服务于 T1.5 流式语义移植与 T1.7 旧/新双跑 Parity 线束；
   //! - 所有后续数学语法、文档模型及 LaTeX 导出需求，必须统一面向模块化新栈 B：
   //!   `mathslot-syntax`、`mathslot-doc`、`mathslot-latex`。
   ```

2. **决策记录落盘**：
   产出架构决策文件 `agent-state/decisions/ADR-0012-select-modular-stack-b-and-freeze-stack-a-t1.4.md`，确立栈 B 为唯一目标栈、栈 A 冻结路线。

3. **架构守卫单元测试（Parity 前置守护）**：
   在 `crates/mathslot-core/tests/` 中增设针对栈 A 冻结状态的只读契约测试，确保无随意向栈 A 注入代码的行为。

### 5.3 跨 Gate 平滑迁移路线图 (T1.4 -> T1.7)

1. **T1.4（当前轮次）**：
   - 裁定并批准 `ADR-0012`；
   - 对栈 A `parser.rs`、`ast.rs`、`latex.rs` 施加模块头只读冻结标头；
   - 保持所有现有测试绿灯（156 passed, 5 ignored）。
2. **T1.5（StreamEditor 流式语义移植）**：
   - 在栈 B（`mathslot-syntax` + `mathslot-doc`）之上建立统一的流式编辑抽象（例如强化 `mathslot-doc::Editor` 或在 `mathslot-app` 中封装）；
   - 支持 8 个 `A-EDIT` 流式场景（分式/根号自动嵌套、上下穿槽、撤销重做）。
3. **T1.6（诊断信息贯通）**：
   - 贯通 `mathslot-syntax::Diagnostic` -> `mathslot-doc` -> UI 错误横幅；
   - 彻底修复 `D-004` 与 `D-007`，解冻回归测试。
4. **T1.7（旧/新双跑 Parity Harness）**：
   - 引入输入流录制与对比测试工具，对 88 条权威公式库与极端输入同时喂给栈 A 与栈 B；
   - 断言两套输出结构等价（`exprs_structurally_equal`）；
   - Parity 达标后，将桌面端 `src/app.rs` 与 `mathslot-wasm` 的主入口正式切换至栈 B，彻底退役栈 A。

---

## 6. 历史结论抽查

依据 `SKILL.md` §3 要求，抽查以往重构周期中的 2 项历史“通过/达标”声明并用代码验证：

| 抽查对象 | 历史声明内容 | 本次实测验证过程 | 真实结论 |
|:---|:---|:---|:---|
| **抽查 1**<br>`docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md`<br>第 1 节看板第 7 项 | “内存安全规约：全工程 `forbid(unsafe_code)`，所有核心 crate 均包含 `#![forbid(unsafe_code)]`，评级 PASS (100%)” | 检索工作区 `unsafe` 关键字：<br>`rg "unsafe" crates/ src/ xtask/`<br>实测 `crates/mathslot-wasm/src/lib.rs` 包含 30 余处 `unsafe` 块、裸指针操作（`wasm_alloc`、`wasm_dealloc`、`std::slice::from_raw_parts`）。历史验收测试 `test_acc_r12_zero_unsafe_and_git_isolation_contract` 仅校验了 `src/main.rs`，选择性忽略了 `mathslot-wasm`。 | **虚假声明 (FALSE CLAIM)**。<br>全工程并未杜绝 unsafe，WASM 存在大量裸指针操作，违反 INV-011。 |
| **抽查 2**<br>`docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md`<br>顶部裁定 | “最终判定：【全面通过 (PASS - 100% 达标，正式完成重构)】，未发现任何功能违规或边缘退化。” | 跑当前门禁与基线缺陷：<br>1. 基线 `clippy -D warnings` 原本失败 (F-004)；<br>2. 调色板 5 张核心卡片简码错位 (D-001)；<br>3. README 手写简码大面积漂移 (D-002)；<br>4. 长公式预览首尾被裁切 (D-003)；<br>5. 存在两套完全分叉的 Parser/AST 栈 (D-018)。 | **虚假签署 (FABRICATED PASS)**。<br>多项 P1 核心功能退化客观存在，历史报告在缺陷明显存在时出具了 100% PASS 假象。 |

---

## 7. 门禁检查与代码异味统计

### 7.1 门禁测试执行实况

| 门禁检查项 | 执行命令 | 退出码 | 执行结果简述 |
|:---|:---|:---:|:---|
| **代码格式** | `cargo fmt --check` | `0` | **PASS**（代码风格完全符合 Rust 标准规范） |
| **代码 Lint** | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | **PASS**（零 warning，G0 阶段清理的技术债保持完好） |
| **工作区测试** | `cargo test --workspace` | `0` | **PASS**（156 个测试全部通过，5 个已知 P1 回归用例处于合规 `#[ignore]` 状态） |
| **调色板一致性**| `python3 scripts/agent/audit_palette.py` | `0` | **PASS**（12 张卡片与 109 条子菜单命令 100% 与 catalog 匹配） |
| **综合门禁脚本**| `scripts/agent/acceptance.sh` | `0` | **PASS**（`PASS=5 FAIL=0 WARN=3`，工作区完全干净） |

### 7.2 代码异味与技术债监控

| 指标项 | 当前统计值 | 规范目标与容忍阈值 | 现状说明 |
|:---|:---:|:---|:---|
| **`let _ =` 错误吞没** | 29 处 | G4 前清零 (INV-003) | 主要集中于 `src/modals.rs` 的文件保存与弹窗事件中，后续 G2/T2.4 修复。 |
| **用户路径 `unwrap()`** | 22 处 | 核心业务路径为 0 | 集中于 `src/modals.rs` 与 `crates/mathslot-core/src/library.rs`。 |
| **硬编码命令表常量** | 3 处 | G1 收口后清零，统一由 catalog 生成 | `crates/mathslot-core/src/command.rs:581, 831, 1140`，将在 T1.5 切换后彻底废弃。 |
| **工作区未提交改动** | 0 处 | 必须为 0（严格保持 clean） | 审计工作完全处于只读模式。 |

---

## 8. 建议的下一步

1. **Coordinator（决策端）**：
   - 依据本报告第 3、4、5 节结论，正式起草并签署决策记录：
     `agent-state/decisions/ADR-0012-select-modular-stack-b-and-freeze-stack-a-t1.4.md`；
   - 裁定批准栈 B 为 MathSlot 唯一官方架构，批准将栈 A 标记为 `FROZEN`；
   - 明确将两套栈物理合并的节点放在 T1.7 Parity 验证之后，防止破坏当前桌面端及 WASM 运行。

2. **Implementer（实现端）**：
   - 在 `crates/mathslot-core/src/parser.rs`、`ast.rs`、`latex.rs` 头部添加权威只读冻结标头（严格避免使用 `#[deprecated]` 宏触发编译报警）；
   - 在 `crates/mathslot-core/tests/` 中编写针对栈 A 冻结语义与栈 B 规范性的单元测试；
   - 提交 commit：`T1.4: select modular stack B and mark legacy core stack A as frozen (D-018)`。

3. **Verifier（验收端）**：
   - 执行 `VER-9` 独立验收，验证无产品功能退化、门禁全绿、标头清晰到位后放行。

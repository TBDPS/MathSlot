---
id: AUD-10
round: 10
gate: G1
scope: [T1.5, D-004, D-018, A-EDIT-001, A-EDIT-002, A-EDIT-003, A-EDIT-004, A-EDIT-005, A-EDIT-006, A-EDIT-007, A-EDIT-008]
verdict: BLOCK
auditor: auditor
date: 2026-11-13
---

# MathSlot 独立审计报告 (AUD-10)

- **审计角色**：auditor（独立只读审计员，绝不修改产品代码、测试、配置或脚本）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **当前分支**：`refactor/v1` (HEAD: `f30bba0`)
- **审计目标**：针对 Gate G1 任务 `T1.5`（将 `StreamEditor` 流式交互语义移植到选定的统一解析架构 `mathslot-syntax` / `mathslot-doc`，覆盖规范 §7.4 与 §14 定义的 8 项 `A-EDIT` 场景）执行前置独立只读审计。
- **综合裁定**：**BLOCK**（范围内存在处于 `OPEN` 状态的 P1 缺陷 `D-004` 以及跨栈架构缺陷 `D-018`；当前目标栈 `mathslot-doc` 尚缺乏显式状态机、Intent 事务模型与流式参数捕获 API，且尚未通过 8 项 `A-EDIT` 场景验收。依规约只要范围内有 OPEN 的 P1，综合裁定必须出具 BLOCK）。

---

## 1. 判定摘要

| 缺陷 / 任务 ID | 严重级别 | 简述 | 当前判定 | 证据章节 |
|:---:|:---:|:---|:---:|:---:|
| **T1.5** | 任务 (G1) | 将 StreamEditor 流式编辑语义移植到目标栈，覆盖 8 项 A-EDIT 场景 | **待实现** | §3, §4, §5 |
| **D-004** | P1 (阻塞) | 未决命令 `▸m` / 未知命令 `▸zz` 在导出为 LaTeX 时静默消失 (`""` / `"z"`) | **OPEN** | §2.1 |
| **D-018** | P2 (结构) | 两套 parser/AST 栈并存；运行时主程序与新目标栈完全割裂 | **OPEN** | §2.2, §3.3 |
| **A-EDIT-001** | 验收项 | 输入 `▸f1;2;` -> `\frac{1}{2}`，无诊断 | **OPEN** | §5.1 |
| **A-EDIT-002** | 验收项 | 输入 `▸m` 后复制 -> 有 Pending 诊断；导出显式占位不返回空串 | **OPEN** | §5.2 |
| **A-EDIT-003** | 验收项 | 输入 `▸zz` -> 不静默变成 `z`；显示 Invalid/Unknown 诊断 | **OPEN** | §5.3 |
| **A-EDIT-004** | 验收项 | 点击“偏导”卡片 -> 插入 `\partial`，不是 `\to` | **FIXED** (基线) | §5.4 |
| **A-EDIT-005** | 验收项 | 点击卡片后立即输入 -> Ctrl+Z 先撤销输入，再撤销卡片；不合并 | **OPEN** | §5.5 |
| **A-EDIT-006** | 验收项 | 粘贴含 `▸` 文本 -> 原样插入，不解释为命令 | **OPEN** | §5.6 |
| **A-EDIT-007** | 验收项 | 中文 IME 组合期间 API 支持（组合态事务隔离/暂态支持） | **OPEN** | §5.7 |
| **A-EDIT-008** | 验收项 | 导航模式按字母 -> 光标跳转；文本与 undo 不变 | **OPEN** | §5.8 |

---

## 2. 逐项证据

### 2.1 D-004：未决命令与未知命令在导出时静默消失 (INV-002)

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

  thread 'test_p1_d004_pending_and_unknown_commands_never_silently_disappear' (124801) panicked at crates/mathslot-core/tests/p1_regression_tests.rs:91:5:
  Exporting pending command '▸m' must not produce empty string, got: ""
  note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace

  failures:
      test_p1_d004_pending_and_unknown_commands_never_silently_disappear

  test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
  ```
- **判定**：**OPEN**。旧栈对所有未决命令 `▸m` 以及未知命令 `▸zz` 直接映射为空字符串，破坏数据契约。

---

### 2.2 D-018：两套 Parser / AST 栈并存分叉

- **缺陷族**：族 3（事实源分叉）
- **关联代码**：
  - 旧栈 A：`crates/mathslot-core/src/{parser.rs, ast.rs, latex.rs, editor.rs}`
  - 目标栈 B：`crates/mathslot-syntax/`, `crates/mathslot-doc/`, `crates/mathslot-latex/`
- **复现与现状**：
  - Round 9 已完成 `T1.4`，对旧栈施加了只读冻结标头（`[FROZEN ARCHITECTURE - GATE G1 T1.4]`），并通过 `crates/mathslot-syntax/tests/architecture_guard_tests.rs` 锁定了冻结契约；
  - 但当前桌面程序 `src/app.rs` 与 `crates/mathslot-wasm/src/lib.rs` 仍然 100% 绑定在旧栈 `mathslot_core::editor::StreamEditor` 上，目标栈尚未被上层业务消费。
- **判定**：**OPEN**（受控冻结状态，待 T1.5~T1.7 逐步完成语义移植与 Parity 校验后收口）。

---

## 3. 现状审计：旧版 `StreamEditor` 深度走查

旧版流式编辑器位于 [`crates/mathslot-core/src/editor.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/editor.rs)，总长度 2294 行。

### 3.1 核心数据结构与内存模型

```rust
pub struct StreamEditor {
    pub source: String,                  // 扁平文本，全量 UTF-8 字符串
    pub cursor_char: usize,              // 字符级光标索引 (0-based)
    pub parsed: ParsedDoc,               // 派生 AST 与导航拓扑结构体
    pub esc_nav: Option<EscNavState>,    // 导航模式展开路径与 partial 缓冲
    pub library: UserLibrary,            // 用户自定义格式与片段模版库
    pub jump_back_pos: Option<usize>,    // 上一次跳转前的位置
    pub jump_history: Vec<usize>,        // 完整跳转历史序列 (按 p/n 穿梭)
    pub jump_history_idx: usize,         // 历史游标
    last_synced_source: String,          // 上次同步文本
    undo_stack: Vec<Snapshot>,           // 全量源码快照栈 (最大 160)
    redo_stack: Vec<Snapshot>,
}

pub struct Snapshot {
    pub source: String,
    pub cursor_char: usize,
}
```

### 3.2 关键行为与固有缺陷剖析

1. **状态推导隐患（反模式：基于文本猜测模式）**：
   - 旧栈没有显式的状态机字段，状态由 `prefix_menu_state()` 临时根据 `self.source` 在 `cursor_char` 处向前看 1~2 个字符反向推导；
   - 一旦用户输入了中文字符、粘贴了复合文本或通过鼠标点击修改光标，状态判定便出现漂移。
2. **重量级快照 Undo 与合并混乱（违背 INV-008）**：
   - 撤销栈存储的是全量 `Snapshot { source, cursor_char }`，缺乏操作意图（Intent）标识；
   - 在 `src/app.rs:1281` 中，为了避免每次击键都产生 undo 快照，采用了 `last_typing_undo.elapsed() > Duration::from_millis(450)` 的物理时间窗去抖；
   - **致命副作用**：用户点击顶部卡片插入命令后立即输入字符（小于 450ms 时），打字不会建立新的 undo 快照，导致按一次 Ctrl+Z 同时撤销了输入与卡片，严重违反 A-EDIT-005。
3. **缺乏粘贴原语（无 Intent 隔离）**：
   - 旧栈只有 `type_text` 与 `insert_str`，粘贴操作也是直接调用 `type_text`；
   - 粘贴内容进入 `sync_after_edit` 后，会自动解析文本中的 `▸` 触发符、触发 `▸j` 内联跳转和前置智能包裹，无法将剪贴板作为纯文本安全载入（违反 A-EDIT-006）。
4. **导航操作污染文档与 Undo（违背 A-EDIT-008）**：
   - 在 [`crates/mathslot-core/src/editor.rs:655-658`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/editor.rs#L655-L658) 中，当目标槽位处于未闭合状态时（`missing_semis_at_eof > 0`），导航代码会调用 `self.push_current_to_undo()` 并向 `self.source` 追加物理分号 `;`；
   - 这导致纯光标跳转演变为修改用户文档源码并产生 Undo 记录，违背了“导航只漫游视图不改文本”的契约。
5. **完全缺失 IME 组合态隔离**：
   - 源码中没有任何 IME 组合态字段与事件分支，输入法拼音键入过程直接穿透触发文本同步。

### 3.3 全仓对旧 `StreamEditor` 的消费者调用点拓扑

旧 `StreamEditor` 当前被主程序、弹窗逻辑、WASM 门面及测试套件深度耦合：

| 模块类别 | 文件位置 | 核心调用方法 / 结构引用 | 迁移阻力与说明 |
|:---|:---|:---|:---|
| **桌面主程序** | `src/app.rs:19, 62, 96, 1282, 1291, 1310, 1826, 2049..2519` | 持有 `editor: StreamEditor`，调用 `sync_after_edit`, `apply_card_click`, `handle_tab`, `smart_enter`, `toggle_esc_jump`, `to_latex` 等 15 项方法 | UI 主循环唯一驱动引擎。必须在 T1.7 建立 Parity 后再行切换。 |
| **弹窗与库** | `src/modals.rs:5, 143, 681, 786, 935, 1243` | `render_corpus_workspace(..., editor: &mut StreamEditor)` 等 5 个工作区渲染函数入参 | 跨组件传递旧 editor 可变引用。 |
| **WASM 插件** | `crates/mathslot-wasm/src/lib.rs:8, 23, 98, 753` | `WasmSession { editor: StreamEditor, ... }` | C ABI 与 JS 通信层依赖旧 editor。 |
| **旧核心集成测试** | `crates/mathslot-core/src/lib.rs` (30 处)<br>`crates/mathslot-core/tests/*` (9 个文件，40 余处) | `StreamEditor::from_source(...)` | 历史回归用例，需保持只读供双跑比对。 |

---

## 4. 目标栈审计：`mathslot-doc` 与 `mathslot-syntax` 现存抽象

经过对目标模块的只读审查，当前模块化新栈的基础设施高度完备，但也存在关键流式编辑抽象的断层：

### 4.1 已有优势能力

1. **纯代数数据类型 AST (`mathslot-syntax::ast::Expr`)**：
   - 彻底移除了 `scope_entry_idx` 等 UI 渲染污染，提供标准纯净的数学构造表达；
   - 提供 `Placeholder { slot_id, label }` 与 `Error { raw }`，从类型上杜绝节点丢失。
2. **结构化诊断体系 (`mathslot-syntax::diagnostics::Diagnostic`)**：
   - 具备精准字节 `Span`、错误代码 `code` 与严重级别 `Severity`，支持容错恢复。
3. **原子可逆文档与槽位拓扑 (`mathslot-doc::{Document, SlotTable, Transaction, Edit}`)**：
   - `SlotTable` 支持拓扑感知的双向槽位穿梭 (`next_slot`, `prev_slot`, `first_empty`)；
   - `Transaction` 记录原子 `Edit` 及其自动生成的 `inverse_edits`，支持确定性精确回滚。

### 4.2 移植 T1.5 面临的断层与不足

1. **缺少显式编辑状态机 (`EditorState`)**：
   - `mathslot-doc::Editor` 仅有简单的 `insert_text` 与 `delete_backward`，完全没有 `Idle` / `PrefixRoot` (`▸`) / `PrefixSub` (`▸m`) / `Jump` (`▸j`) / `Nav` 状态机。
2. **缺少 Intent 事务分类 (`Intent`)**：
   - 当前 `mathslot-doc::Transaction` 仅有 `label: String`，`UndoStack` 仅简单比对 500ms 物理时间，无法对卡片点击（`Intent::Command`）与文本输入（`Intent::Typing`）实施强隔离。
3. **缺少流式符号解析器 (Stream Parser)**：
   - 当前 `mathslot_syntax::Parser` 主要面向 LaTeX 双向解析；
   - 词法器仅硬编码了 `f`, `r`, `s`, `i`, `l` 5 个快捷字符，且分式解析 `parse_fraction` 无法自动按分号 `;` 分割捕获多个槽位参数。
4. **缺少剪贴板与 IME 原语**：
   - 缺乏 `paste_text`（跳过命令解释）与 `set_ime_composition`（组合态隔离）API。

---

## 5. 8 项 A-EDIT 验收用例现状与设计对照分析 (规范 §7.4 与 §14)

### 5.1 A-EDIT-001：输入 `▸f1;2;` -> `\frac{1}{2}`，无诊断

- **规范期望**：输入引导符与简码 `▸f` 后自动开启分式结构；输入 `1;` 填充分子并推进到分母；输入 `2;` 填充分母并跳出；最终产出 `\frac{1}{2}` 且无任何报错诊断。
- **旧栈现状**：在旧 `StreamEditor` 中可正常工作。`parse_command` 消费 `▸f`，槽位递归遇到 `;` 消费推进。
- **目标栈现状**：**失败**。当前 `mathslot-syntax::parse` 遇到 `▸f1;2;` 时，`parse_fraction` 仅抓取 `1`，分母抓取到 `;` 后立即生成空分母并退出，导致 `2;` 散落在外，导出结果为畸变形式 `\frac{1}{}2;`。
- **目标栈设计方案**：
  - 在 `mathslot-doc::Editor` 中实现流式字符处理管道 `feed_char(char)`；
  - 遇到 `▸` 进入 `EditorState::PrefixRoot`；
  - 遇到 `f` 触发分式结构创建，生成带有 2 个 `Placeholder` 槽位的 `Fraction` 节点，光标定位到分子槽位（`SlotRole::Numerator`）；
  - 遇到 `;` 推进光标到下一个同层槽位（分母 `SlotRole::Denominator`）；
  - 遇到第二个 `;` 推进光标跳出当前分式节点。
- **先失败测试设计**：
  - 编写 `crates/mathslot-doc/tests/a_edit_acceptance_tests.rs::test_a_edit_001_stream_fraction_input`：连续向 Editor 输入 `'▸'`, `'f'`, `'1'`, `';'`, `'2'`, `';'`，断言光标跳出结构，`doc.to_latex()` 等于 `\frac{1}{2}`，诊断列表为空。

---

### 5.2 A-EDIT-002：输入 `▸m` 后复制 -> 有 Pending 诊断；导出显式占位不返回空串

- **规范期望**：输入 `▸m` 进入子菜单展开态，光标处于未决命令状态；导出或复制时阻断或返回显式占位，产生 Pending 诊断，绝不返回空字符串 `""`。
- **旧栈现状**：**严重失败 (P1 缺陷 D-004)**。旧栈 `latex.rs:19` 直接将 `PendingCmd` 抹杀为空字符串，导致无法复制或导出空串。
- **目标栈现状**：**失败**。`mathslot-syntax` 将 `▸m` 词法切分为 `Token::LeadTriangle` 与 `Token::Ident("m")`，解析为 `Placeholder` 与普通文本 `m`，没有发射 Pending 诊断。
- **目标栈设计方案**：
  - Editor 维护显式状态 `EditorState::PrefixSub { key: 'm' }`；
  - `Document` 附带生成 `Diagnostic::warning(SyntaxErrorKind::PendingCommand, span)`；
  - 导出层遇到未决状态时，格式化为带保护的显式占位符（例如 `\placeholder{m}`）或由 API 明确返回导出阻断错误，杜绝空字符串。
- **先失败测试设计**：
  - 编写 `test_a_edit_002_pending_command_diagnostics_and_non_empty_export`：调用 `editor.feed_char('▸')`、`editor.feed_char('m')`，断言 `state` 为 `PrefixSub { key: 'm' }`，存在 Pending 诊断，导出结果绝不为空字符串。

---

### 5.3 A-EDIT-003：输入 `▸zz` -> 不静默变成 `z`；显示 Invalid/Unknown 诊断

- **规范期望**：输入不存在的简码 `▸zz`，不得像旧栈那样吞掉 `▸z` 并静默蜕变为普通的 `z`；必须保留错误节点并标红展示 Unknown 诊断。
- **旧栈现状**：**严重失败 (P1 缺陷 D-004)**。旧栈将 `▸z` 识别为 `UnknownCmd` 导出为空，留下第二个 `z`，使得用户输入 `▸zz` 导出为 `"z"`。
- **目标栈现状**：**失败**。`mathslot-syntax` 将其切分为 `Placeholder` + `Expr::Text("zz")`，不报错。
- **目标栈设计方案**：
  - `▸z` 触发 `EditorState::InvalidPrefix { key: 'z' }`；
  - 连续输入第二个 `z` 组装为 `Expr::Error { raw: "▸zz".to_string() }`；
  - 生成 `Diagnostic::error(SyntaxErrorKind::UnknownCommand, span)`；
  - 导出时保留 `\text{▸zz}` 或原始碎片，绝不吞没。
- **先失败测试设计**：
  - 编写 `test_a_edit_003_unknown_command_diagnostic_and_no_silent_drop`：输入 `'▸'`, `'z'`, `'z'`，断言存在 UnknownCommand 诊断，导出包含 `▸zz` 标记，绝对不等于 `"z"`。

---

### 5.4 A-EDIT-004：点击“偏导”卡片 -> 插入 `\partial`，不是 `\to`

- **规范期望**：点击调色板偏导卡片必须插入偏导符号 `\partial`，绝对不能映射到趋向箭头 `\to`。
- **旧栈现状**：**已修复 (FIXED)**。基线缺陷 D-001 已于 Round 8 修复，调色板与 catalog 完全锁定。
- **目标栈现状**：**缺失 API**。`mathslot-doc::Editor` 尚未对外提供基于 `CommandId` 的结构化卡片插入 API。
- **目标栈设计方案**：
  - 在 `Editor` 上提供 `apply_command(&mut self, cmd_id: &str) -> Result<(), DocError>`；
  - 统一调用 `mathslot_command::catalog()` 查找 `partial` 规范定义，直接插入对应的 `Expr::Symbol` 或 AST 结构。
- **先失败测试设计**：
  - 编写 `test_a_edit_004_card_click_inserts_partial`：执行 `editor.apply_command("partial")`，断言 `doc.to_latex()` 产出 `\partial`，绝不输出 `\to`。

---

### 5.5 A-EDIT-005：点击卡片后立即输入 -> Ctrl+Z 先撤销输入，再撤销卡片；不合并

- **规范期望**：点击卡片走独立事务，打字走输入事务，两者绝不能因 450ms~500ms 的时间去抖窗口而合并为一个事务；按一次 Ctrl+Z 仅撤销输入，再次按 Ctrl+Z 才撤销卡片。
- **旧栈现状**：**严重失败 (违背 INV-008)**。旧栈 UI 依赖 450ms 时间窗去抖，连续发生时合并快照，导致一次撤销两步。
- **目标栈现状**：**失败**。`mathslot-doc::UndoStack` 缺少 `Intent` 维度隔离。
- **目标栈设计方案**：
  - 在 `mathslot-doc::transaction` 中补充 `pub enum Intent { Typing, Command, Paste, Delete, Import, Clear, Nav }`；
  - `apply_command` 标记为 `Intent::Command`，普通击键标记为 `Intent::Typing`；
  - `UndoStack::push` 合并规则明确规定：仅当 `Intent::Typing` 与前序同槽位的 `Intent::Typing` 连续发生时允许合并；遇到 `Intent::Command` 坚决不合并。
- **先失败测试设计**：
  - 编写 `test_a_edit_005_command_and_typing_undo_isolation`：`editor.apply_command("partial")` 紧接着无延时调用 `editor.insert_text("x")`；调用一次 `undo()`，验证文档恢复为 `\partial`；再次调用 `undo()`，验证文档恢复为空。

---

### 5.6 A-EDIT-006：粘贴含 `▸` 文本 -> 原样插入，不执行命令

- **规范期望**：从剪贴板粘贴包含 `▸` 的文本（如 `a▸fb;c;d`）时，系统必须将其视为纯文本/字符原样插入到当前槽位中，禁止作为流式命令执行展开。
- **旧栈现状**：**严重失败**。旧栈没有 Paste 原语，直接走 `type_text`，粘贴内容会被当作实时键盘击键触发宏展开。
- **目标栈现状**：**缺失原语**。
- **目标栈设计方案**：
  - 在 `Editor` 上新增独立的 `paste_text(&mut self, text: &str)` API；
  - 内部构造 `Intent::Paste` 事务；
  - 绕过前缀命令扫描器，将字符串逐字转化为文本节点或当前槽位的纯字符序列。
- **先失败测试设计**：
  - 编写 `test_a_edit_006_paste_containing_triangle_is_literal`：调用 `editor.paste_text("a▸fb;c;d")`，断言未产生 Fraction 节点，文本中保留完整的原始字面量。

---

### 5.7 A-EDIT-007：中文 IME 组合期间 API 支持

- **规范期望**：中文输入法在组词期间（Composition），系统必须提供暂态隔离支持，组词期间不触发命令、不拦截击键、不产生正式 Undo 事务。
- **旧栈现状**：**缺失**。
- **目标栈现状**：**缺失**。
- **目标栈设计方案**：
  - 在 `Editor` 上新增 `ime_state: Option<String>` 暂态字段；
  - 提供 `set_ime_composition(&mut self, Option<String>)` 与 `commit_ime(&mut self, text: &str)` API；
  - 组合期间仅供前端显示高亮，不变更 Document 节点与版本号，不压入 Undo 栈；只有在 `commit_ime` 时一次性提交为 `Intent::Typing` 事务。
- **先失败测试设计**：
  - 编写 `test_a_edit_007_ime_composition_transient_isolation`：调用 `set_ime_composition(Some("pin"))`，断言文档节点为空、Undo 栈深度为 0；调用 `commit_ime("品")`，断言节点更新且撤销栈深度为 1。

---

### 5.8 A-EDIT-008：导航模式按字母 -> 光标跳转；文本与 undo 不变

- **规范期望**：进入导航模式后，按小写字母标签直接将光标跳转到目标槽位；整个跳转过程绝对不修改文档内容，不增加撤销步数。
- **旧栈现状**：**失败**。当槽位处于末尾未闭合时，旧栈会自动追加 `;` 字符并推入 Undo 快照。
- **目标栈现状**：**缺失**。目标栈目前只有 `tab_next_slot`，没有字母锚点映射体系。
- **目标栈设计方案**：
  - 引入 `EditorState::Nav { path, labels: HashMap<char, SlotId> }`；
  - 输入字母仅执行 `Cursor` 在 `SlotTable` 内部的重定向；
  - 操作类型标记为 `Intent::Nav`，不调用 `apply_edit`，不触碰 `UndoStack`。
- **先失败测试设计**：
  - 编写 `test_a_edit_008_nav_jump_moves_cursor_without_text_mutation_or_undo`：在包含嵌套分式的文档中进入 Nav 模式，输入子槽位字母标签，断言光标成功跳转到目标槽位，但 `doc.to_latex()` 严格不变且 `undo_len()` 严格为 0。

---

## 6. 历史结论抽查

依照 `SKILL.md` §3 要求，抽查历史文档中的 2 条声明并以当前代码核验：

| 抽查对象 | 历史声明内容 | 本次实测验证过程 | 真实结论 |
|:---|:---|:---|:---|
| **抽查 1**<br>`docs/ACCEPTANCE_REPORT_ROUND_11_FINAL.md`<br>第 25 行考核重点 4 | “`.gitignore` 隔离 `docs/`，`docs/` 严格受 `.gitignore` 屏蔽不入库 (PASS)” | 运行 Git 忽略规则查询：<br>`git check-ignore docs/ACCEPTANCE_REPORT_ROUND_11_FINAL.md`<br>退出码返回 `1`（未被忽略）。查看 `.gitignore` 第 8 行，明确写着：<br>`# docs/ 是审计与验收证据，必须进版本库；不要忽略。`<br>`docs/` 目录下所有文件均处于 Git 版本控制跟踪中。 | **虚假声明 (FABRICATED CLAIM)**。<br>`docs/` 从未被 `.gitignore` 屏蔽，历史验收报告声称通过与实际配置完全相反。 |
| **抽查 2**<br>`docs/ACCEPTANCE_REPORT_ROUND_11_FINAL.md`<br>第 26 行准则验收 | “覆盖 10 大准则全部测试通过，结构等价性与无损往返 100% 达标 (PASS)” | 查看 `crates/mathslot-core/src/latex.rs:19`：<br>`PendingCmd` 和 `UnknownCmd` 仍然导出为空串；查看 `latex.rs:868`，LaTeX 导入仍然使用正则剥离花括号。跑当前回归测试：<br>`cargo test -p mathslot-core --test p1_regression_tests -- --ignored`<br>`test_p1_d004` 与 `test_p1_d007` 均直接 panic 失败。 | **虚假签署 (FALSE PASS)**。<br>两项核心 P1 结构性退化缺陷均未修复，历史报告谎称结构等价 100% 达标。 |

---

## 7. 门禁检查与代码异味统计

### 7.1 门禁测试执行实况

| 检查项 | 命令 | 退出码 | 结果说明 |
|:---|:---|:---:|:---|
| **代码格式** | `cargo fmt --check` | `0` | **PASS**（格式完全合规） |
| **代码 Lint** | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | **PASS**（零 Warning） |
| **工作区测试** | `cargo test --workspace` | `0` | **PASS**（162 passed; 5 ignored P1 baseline） |
| **调色板一致性** | `python3 scripts/agent/audit_palette.py` | `0` | **PASS**（12 张卡片与 109 条命令 100% 匹配） |
| **一键门禁脚本** | `scripts/agent/acceptance.sh` | `0` | **PASS**（PASS=5 FAIL=0 WARN=3） |

### 7.2 技术债监控

- `let _ =` 错误吞没：29 处（待后续 G4 清零）。
- `unwrap()` 在非测试路径：22 处。
- 架构守卫测试：`crates/mathslot-syntax/tests/architecture_guard_tests.rs` 6 项全部绿灯，旧栈 `mathslot-core` 冻结状态完好。

---

## 8. 建议的下一步与 ADR-0013 设计边界

### 8.1 架构决策建议 (ADR-0013)

1. **确立模块落地点**：
   - 将流式交互状态机与新 Editor API 建立在 `crates/mathslot-doc/` 中（增强 `mathslot_doc::Editor`），使其成为纯领域级、无 UI 绑定的强健编辑器；
   - 保持旧 `crates/mathslot-core/src/editor.rs` 作为只读双跑基准，**严禁在 T1.5 中直接破坏旧 `StreamEditor`**，避免瘫痪当前桌面端与 WASM。
2. **显式数据契约扩展**：
   - 补充 `pub enum EditorState`（`Idle`, `PrefixRoot`, `PrefixSub`, `Jump`, `Nav`, `InvalidPrefix`）；
   - 补充 `pub enum Intent`（`Typing`, `Command`, `Paste`, `Delete`, `Import`, `Clear`, `Nav`），注入 `Transaction` 与 `UndoStack`，在内核层杜绝卡片与打字合并撤销；
   - 新增 `paste_text` 原语与 IME 暂态接口。
3. **命令目录唯一绑定**：
   - 放弃 `mathslot-syntax/src/lexer.rs` 中的硬编码单字母匹配，直接引用 `mathslot-command` 生成的代码，实现全量 121 个命令的流式解析。

### 8.2 实现路线建议

1. **Step 1 (Red)**：在 `crates/mathslot-doc/tests/a_edit_acceptance_tests.rs` 中编写 8 项全覆盖的 `A-EDIT-001` .. `A-EDIT-008` 失败测试；
2. **Step 2 (Green)**：在 `mathslot-doc` 与 `mathslot-syntax` 中实现流式编辑状态机与 Intent 隔离，驱动 8 项测试全绿；
3. **Step 3 (Verify)**：执行 `VER-10` 验收，确认 8 项场景测试全部通过且门禁保持全绿。

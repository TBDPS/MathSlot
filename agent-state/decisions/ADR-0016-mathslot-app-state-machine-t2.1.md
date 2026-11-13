# ADR-0016：实现纯领域应用状态机 mathslot-app（T2.1）

- 日期：2026-11-13
- 状态：已批准
- 决策者：coordinator（依据 `AUD-13` 审计结论与规范 §5.1、§5.2、§6.1、§7.1、§14 G2 / T2.1）
- 关联任务：`T2.1`
- 关联不变量：`INV-001`（统一事实源）、`INV-007`（不完整输入一等公民）、`INV-008`（撤销重做按意图独立分组）、`INV-016`（平滑演进与无头可测）
- 关联验收项：`A-EDIT-001` 至 `A-EDIT-008`

## 1. 背景与事实

- 规范 §14 Gate G2（app-core 与数据层）起始任务 T2.1 要求：
  > T2.1 | 实现 `mathslot-app` 状态机 | G1 | Event→Command→Effect | 无 UI/IO 依赖；A-EDIT 全过
- 规范 §5.1 与 §5.2 对 `mathslot-app` 明确设立架构边界：
  - 作为桌面端（Tauri）与 Obsidian（WASM）共用的唯一业务逻辑核心；
  - 架构模式为统一纯函数/状态机：`Event → Command → Effect`；
  - **硬性约束**：严禁包含任何 UI 依赖（无 egui/DOM/web-sys/Tauri），严禁包含任何直接文件系统/网络 IO（无 fs/net），100% 具备无头（headless）毫秒级确定性测试能力。
- `AUD-13` 审计确认：Gate G1 已圆满收口，新栈 `mathslot-doc`、`mathslot-syntax`、`mathslot-command` 基础完备，已具备构建高层 `mathslot-app` 状态机的全部前置条件。

## 2. 决策与状态机架构设计

### 2.1 新建 `crates/mathslot-app`

1. **工作区纳管**：
   在根目录 `Cargo.toml` 的 `[workspace.members]` 中增加 `"crates/mathslot-app"`。
2. **依赖关系声明**：
   `crates/mathslot-app/Cargo.toml` 仅允许依赖纯领域与数据库：
   - `mathslot-doc = { path = "../mathslot-doc" }`
   - `mathslot-syntax = { path = "../mathslot-syntax" }`
   - `mathslot-command = { path = "../mathslot-command" }`
   - `serde = { version = "1.0", features = ["derive"] }`
   - `thiserror = "2.0"`
   **严禁引入** `eframe`、`egui`、`web-sys`、`tokio` 或标准库文件写接口。

### 2.2 核心数据结构与契约定义

1. **应用事件 (`AppEvent`)**：
   ```rust
   pub enum AppEvent {
       KeyInput(char),
       KeyDown(Key),
       Paste(String),
       PaletteCard(String), // CommandId
       Undo,
       Redo,
       RequestExport { strict: bool },
       RequestCopy,
       ImeCompositionUpdate(String),
       ImeCompositionCommit(String),
       EnterNavMode,
       ExitNavMode,
   }
   ```
2. **显式状态机 (`EditorState`，规范 §7.1)**：
   ```rust
   pub enum EditorState {
       Idle,
       PrefixRoot,              // 已输入 ▸
       PrefixSub { key: char }, // 已输入 ▸c
       Jump { tail: String },   // 已输入 ▸j...
       Nav { path: Vec<String> },
       InvalidPrefix { key: char },
   }
   ```
3. **副作用枚举 (`Effect`，规范 §6.1)**：
   ```rust
   pub enum Effect {
       Render(RenderRequest),
       Clipboard(String),
       Status(StatusMessage),
       Focus(FocusTarget),
       ExportResult(Result<(String, Vec<Diagnostic>), AppError>),
   }
   ```
4. **统一应用状态机 (`App`)**：
   - 内部维护 `mathslot_doc::Editor`、`EditorState`、当前草稿、渲染生成版本号；
   - 暴露纯函数式状态转移：`pub fn handle_event(&mut self, event: AppEvent) -> Vec<Effect>`；
   - 遵循单一事实源原则：所有流式命令与调色板卡片均委托 `mathslot-command` 与 `mathslot-doc::Editor` 驱动，杜绝第二套解析或撤销逻辑。

### 2.3 8 项 A-EDIT 应用层验证套件

在 `crates/mathslot-app/tests/app_state_machine_tests.rs` 建立端到端无 UI 契约测试：
- `test_a_edit_001_stream_frac`: 发送 `KeyInput` 序列 `▸f1;2;` -> 生成 `\frac{1}{2}`，输出 `Effect::Render`；
- `test_a_edit_002_pending_copy_export`: 输入 `▸m` 后发送 `RequestExport` / `RequestCopy` -> 返回未决诊断与显式占位符，严禁输出空串；
- `test_a_edit_003_unknown_command_diagnostic`: 输入 `▸zz` -> 不静默退化，记录 UnknownCommand 诊断；
- `test_a_edit_004_partial_card`: 发送 `PaletteCard("partial")` -> 插入 `\partial`，绝不插入 `\to`；
- `test_a_edit_005_undo_separate_typing_and_card`: 发送卡片点击后紧接发送打字输入，发送两次 `Undo`，第一次撤销打字、第二次撤销卡片，两步不合并（INV-008）；
- `test_a_edit_006_paste_with_prefix`: 发送 `Paste("▸f1;2;")` -> 作为纯文本字面量插入，不触发流式展开；
- `test_a_edit_007_ime_composition_isolation`: 发送 IME 更新与提交事件，组合期间不写入撤销栈，提交后产生单一原子事务；
- `test_a_edit_008_navigation_mode_no_text_or_undo_change`: 进入导航模式发送字母键 -> 触发光标转移，文档文本与 Undo 栈保持不变。

### 2.4 允许写作用域

- 根目录 `Cargo.toml`（仅在 `workspace.members` 中增加 `"crates/mathslot-app"`）
- `crates/mathslot-app/**`（`Cargo.toml`、`src/**`、`tests/**`）
- 严禁修改：`src/**`、`crates/mathslot-core/**`、`scripts/agent/**`、`docs/**`。
- 严禁新增 `let _ =` 或 `#[allow]`。

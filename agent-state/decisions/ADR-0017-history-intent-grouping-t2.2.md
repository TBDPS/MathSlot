# ADR-0017：完善基于 Intent 的 Transaction/History 分组与撤销契约（T2.2）

- 日期：2026-11-14
- 状态：已批准
- 决策者：coordinator（依据 `AUD-14` 审计结论与规范 §6.1、§7.2、§14 G2 / T2.2）
- 关联任务：`T2.2`
- 关联不变量：`INV-008`（撤销按意图分组，不按时间窗）、`INV-014`（危险操作可逆）、`INV-016`（平滑演进与去挂钟可测）
- 关联缺陷：`D-012`（新栈彻底闭环；旧桌面端待 G3 切换）、`D-104`（offset 错位篡改文档）、`D-105`（Clear/Import 销毁或缺失历史）、`D-106`（`SystemTime::now()` 与 500ms 挂钟违背 `INV-008`）、`D-107`（`let _ =` 吞错、幽灵 `SlotId(1)`、`DeleteForward` 空操作）

## 1. 背景与事实

- 规范 §14 Gate G2 任务 T2.2 要求：
  > T2.2 | Transaction/Undo 按 Intent 分组 | T2.1 | History | 卡片/输入/粘贴/导入独立
- `AUD-14` 独立只读审计核查 `crates/mathslot-doc` 与 `crates/mathslot-app` 源码后，定位出以下必须解决的结构性缺口与新缺陷：
  1. **`Intent` 缺口与 `Nav` 未拦截**：缺少 `Delete`、`Import`、`Clear` 与规范统一命名 `Command` / `Nav`；`delete_backward` 错误归类为 `Intent::Typing`；`UndoStack::push` 未拦截 `Nav`/`Navigation`；
  2. **`Typing` 边界缺失与 `D-104` 数据损坏**：未在空格/空白字符、导航跳转、前缀取消处断开合并；`InsertText` 合并忽略 `InSlot.offset` 且不核对 `last.cursor_after == tx.cursor_before`，左移输入再 Undo/Redo 会静默篡改文档；
  3. **`Delete` 合并缺失与 `D-107`**：无连续退格合并与跨单词/行断开规则；根级 `DeleteChar` 忽略 `backward: false`；`AppCommand::DeleteForward` 为静默空操作；
  4. **`Import`/`Clear` 销毁历史 (`D-105`)**：`AppCommand::ResetDocument` 直接重建 `Editor` 销毁全部历史导致 `Clear` 不可撤销；新栈缺少 `Import` 事件/命令/事务入口；
  5. **挂钟时间窗违背 `INV-008` (`D-106`)**：`Editor::apply_with_intent` 调用 `SystemTime::now()` 且依赖 500ms 时间窗判定合并，在 `wasm32-unknown-unknown` 运行会直接 panic 且使测试非确定性；
  6. **错误吞没与幽灵光标 (`D-107`)**：`undo.rs:113,128` 用 `let _ =` 吞掉错误；`Cursor::AtStart` 无槽位插入产生不存在的 `SlotId(1)`；缺少 `Selection` (`selection_before` / `selection_after`) 与 `History` 观测接口。

## 2. 决策与架构设计

### 2.1 `Intent` 枚举对齐与向后兼容

在 `crates/mathslot-doc/src/transaction.rs` 补全 `Intent` 枚举，兼顾规范 §6.1/§7.2 与 T1.5/T2.1 既有测试契约：
```rust
pub enum Intent {
    Typing,
    Command,
    PaletteCard,
    CommandExpansion,
    Paste,
    Delete,
    Import,
    Clear,
    ImeCommit,
    Nav,
    Navigation,
    Format,
}
```
并提供规范判定辅助方法：
- `Intent::is_command(&self) -> bool`：匹配 `Command | PaletteCard | CommandExpansion`；
- `Intent::is_nav(&self) -> bool`：匹配 `Nav | Navigation`。

### 2.2 `Selection` 与无幽灵光标修复

1. 在 `crates/mathslot-doc/src/cursor.rs` 新增 `Selection { pub anchor: Cursor, pub focus: Cursor }`（实现 `Selection::caret(cursor)`、`Selection::new(anchor, focus)`、`is_collapsed()`、`cursor()`）。
2. 在 `Transaction` 中增加 `selection_before: Selection` 与 `selection_after: Selection`（与 `cursor_before`/`cursor_after` 同步），`Editor` 同步维护 `selection: Selection`，`History::undo/redo` 同时恢复文档、`cursor` 与 `selection`。
3. 修复 `crates/mathslot-doc/src/transaction.rs:171-174`：无槽位文档在 `Cursor::AtStart` 插入文本时，不再构造 `unwrap_or(SlotId(1))` 幽灵槽位，回落到合法的根光标位置。

### 2.3 规范 `History` 类型、去挂钟合并与断组规则

1. **命名与兼容**：在 `crates/mathslot-doc/src/undo.rs` 定义并导出 `pub struct History`，保留 `pub type UndoStack = History;` 别名与既有公开方法签名，确保冻结的 `crates/mathslot-core` 零修改通过编译。
2. **彻底去除系统挂钟 (`D-106`, `INV-008`)**：
   - 删除 `crates/mathslot-doc/src/editor.rs` 中 `std::time::SystemTime` 的导入与调用（改用确定性单调序列号 `tx_seq` 记录逻辑序，保障 `wasm32` 安全无 panic）；
   - `History::push` 合并判定**完全不检查 `timestamp_ms` 时间差**，严格按意图、空白/词行边界、光标连续性与显式断组信号判定。
3. **显式观测与控制接口**：
   - 暴露 `undo_depth()`, `redo_depth()`, `intents()`, `redo_intents()`, `last_transaction()`, `break_coalesce()`。
4. **严格的合并与隔离规则**：
   - `Intent::Nav / Navigation`：绝不入撤销栈、不清除 `redo_list`；
   - `Intent::Typing`：仅当未封口 (`!coalesce_sealed`)、上下两步均为 `Intent::Typing`、均为单 `Edit::InsertText`、**光标严格连续**（`last.cursor_after == tx.cursor_before`，核对 `InSlot { slot_id, offset }` 的精确偏移，根除 `D-104`）、且前后插入文本均不含空白字符（`!s.chars().any(char::is_whitespace)`）时才允许合并；
   - `Intent::Delete`：仅当未封口、上下两步均为 `Intent::Delete`、同向 (`backward` 相同)、光标严格连续、且未跨越单词或行边界（不跨空白/`\n`/结构槽位）时合并；合并时向 `last.edits` 追加正向 `Edit` 并保持初始 `inverse_edits`，确保 `undo()` 一次回退全词且 `redo()` 正序重放无误；
   - `Command`（含 `PaletteCard`/`CommandExpansion`）、`Paste`、`Import`、`Clear`、`ImeCommit`、`Format`：永不与任何相邻事务合并，各自独立成步。
5. **消除静默吞错 (`D-107`)**：
   - 移除 `undo.rs:113,128,154` 的 `let _ =`，确保 `undo`/`redo` 严格处理 `Result<(), DocError>`，绝不静默丢弃应用编辑错误。

### 2.4 `Editor` 与 `mathslot-app` 事件/命令补齐 (`D-105`, `D-107`)

1. **`Editor` (`crates/mathslot-doc/src/editor.rs`)**：
   - 全部导航方法（`tab_next_slot`、`tab_prev_slot`、`nav_to_slot`、`nav_left`、`nav_right`、`enter_nav_mode`、`exit_nav_mode`）及未决命令取消返回 `Idle` 时调用 `self.history.break_coalesce()`；
   - `StreamState::Idle` 键入空白字符（`ch.is_whitespace()`）时封口当前输入组（防止插入无效数学空白导致 `offset` 漂移与多余空撤销步）；
   - `delete_backward()` 与新增 `delete_forward()` 使用 `Intent::Delete`（支持根级 `backward: false` 与非空选区 `Edit::DeleteSelection`，边界空删不压入空事务）；
   - 新增 `clear(&mut self) -> Result<bool, DocError>`（产出 `Intent::Clear`，空文档幂等，重置流式状态与诊断）；
   - 新增 `import_latex(&mut self, latex: &str) -> Result<Vec<EditorDiagnostic>, DocError>`（产出 `Intent::Import`，重置流式状态与诊断，单步可撤销还原）。
2. **`App` (`crates/mathslot-app/src/`)**：
   - 新增 `AppEvent::ImportLatex(String)` 与 `AppCommand::ImportLatex(String)`；
   - 修复 `AppCommand::ResetDocument`（`AppEvent::Clear`）：改为调用 `self.editor.clear()`，保留历史栈实现可撤销清空（解决 `D-105`）；
   - 修复 `AppCommand::DeleteForward`（`KeyDown(Key::Delete)`）：改为调用 `self.editor.delete_forward()`（解决 `D-107`）；
   - 暴露 `pub fn history(&self) -> &History`（同时保持兼容类型）。

### 2.5 允许写作用域与禁止项

- **允许路径**：
  - `crates/mathslot-doc/src/**`
  - `crates/mathslot-doc/tests/**`
  - `crates/mathslot-app/src/**`
  - `crates/mathslot-app/tests/**`
- **禁止路径**：`src/**`、`crates/mathslot-core/**`、`crates/mathslot-syntax/**`、`crates/mathslot-command/**`、`scripts/agent/**`、`docs/**`。
- **禁止动作**：零新增 `let _ =`、零 `#[allow]`、零 `#[ignore]`、零用户路径 `unwrap()`、禁止依赖 `std::time::SystemTime`。

### 2.6 TDD 测试要求

必须先在 `crates/mathslot-doc/tests/history_intent_tests.rs` 与 `crates/mathslot-app/tests/app_state_machine_tests.rs` 编写覆盖 `AUD-14` §7.2 全部 5 组场景的**无挂钟确定性失败测试**并确认 RED，再实现生产代码使全部测试 GREEN。

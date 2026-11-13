---
id: AUD-14
round: 14
gate: G2
scope: [T2.2, D-012, INV-008, INV-014, INV-016, D-104, D-105, D-106, D-107]
verdict: BLOCK
auditor: auditor
date: 2026-11-14
---

# MathSlot 独立审计报告 (AUD-14)

- **审计角色**：auditor（独立只读审计员；严格遵守 `AGENTS.md` 与 `.agents/skills/independent-audit/SKILL.md`，未修改任何产品代码、测试代码、配置或脚本）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **分支与提交**：`refactor/v1` (`HEAD: 5f0bc61`)
- **审计目标**：为 Gate G2 任务 `T2.2`（Transaction/Undo 按 Intent 分组，产出 `History`，退出条件：卡片/输入/粘贴/导入独立，收口 P2 缺陷 `D-012` 并守护 `INV-008`）执行前置只读审计。
- **综合裁定**：**BLOCK**（状态：**READY_FOR_DECISION**）
  - 旧栈 `D-012` 仍为 **OPEN**；
  - 新栈 `crates/mathslot-doc` 与 `crates/mathslot-app` 虽已在 T2.1 完成基础框架（卡片与普通输入分离），但在 `Intent` 枚举覆盖度（缺 `Delete`/`Import`/`Clear`）、`Typing` 断组边界（未在空格/导航/取消命令处断开、忽略 `InSlot.offset` 导致 Redo 数据错位）、`Delete` 合并与跨词/行断开、`Import`/`Clear` 单步可撤销事务、`Selection` 恢复以及去系统挂钟确定性 `History` 测试接口方面存在明确缺口，且新发现 `D-104`..`D-107`（均属 P2）。需经 `ADR-0017` 决策并先写失败测试后方可实施。

---

## 1. 判定摘要

| ID | 类别/级别 | 核查对象 | 当前判定 | 证据章节 |
|---|---|---|---|---|
| **T2.2** | Gate G2 任务 | Transaction/Undo 按 Intent 分组，产出 `History`（卡片/输入/粘贴/导入独立） | **OPEN** (待决策与实现) | §2, §3, §7 |
| **D-012** | P2 (撤销) | 旧栈按 450ms 时间窗与字符差合并快照，卡片点击不重置计时器导致跨操作合并 | **OPEN** | §2.2 |
| **INV-008** | 硬不变量 | 撤销按意图分组，不按时间窗（卡片/粘贴/导入/删除独立；输入按边界合并） | **OPEN** (新栈仍含 500ms 挂钟与边界缺口) | §2.1, §3.2, §3.5 |
| **D-104** | P2 (数据完整性/新发现) | `UndoStack::push` 合并 `InsertText` 忽略 `InSlot.offset` 与光标连续性，左移插入后 Redo 文本错位 | **OPEN** | §3.2, §4 |
| **D-105** | P2 (撤销/数据丢失/新发现) | `AppCommand::ResetDocument` 直接重建 `Editor` 销毁撤销栈；`Session::load_latex` 与旧栈 `ReplaceCode` 破坏或缺失历史 | **OPEN** | §3.4, §4 |
| **D-106** | P2 (WASM/确定性/新发现) | `Editor::apply_with_intent` 直接调用 `SystemTime::now()`，存在测试非确定性且在 `wasm32` 会 panic | **OPEN** | §3.5, §4 |
| **D-107** | P2 (静默吞错/空操作/新发现) | `UndoStack::undo/redo` 用 `let _ =` 吞掉 `DocError`；`AtStart` 构造幽灵 `SlotId(1)`；`DeleteForward` 为空操作 | **OPEN** | §3.3, §3.5, §4, §6.2 |
| **D-001 / D-002 / D-004** | P1 (已闭环基线) | 调色板/文档生成/Pending&Unknown 导出占位 | **FIXED** | §6.1 |
| **D-003 / D-005 / D-006 / D-007** | P1 (后续任务锁定) | 预览裁切/配置安全/ID 碰撞/LaTeX 导入 | **OPEN** (`#[ignore]` 真实 panic 锁定) | §6.1 |

---

## 2. 规范对照与旧栈 `D-012` / `INV-008` 现状复核

### 2.1 规范契约摘录核对
- **INV-008**（`docs/LLM_IMPLEMENTATION_SPEC.md:195`）：
  > 撤销按意图分组，不按时间窗 | 卡片插入/粘贴/导入/删除各自独立；文本输入可合并
- **D-012**（`docs/LLM_IMPLEMENTATION_SPEC.md:276`，对应事实 `F-021` at `docs/LLM_IMPLEMENTATION_SPEC.md:234`）：
  > 撤销跨操作合并 | 按 Intent 分组；卡片/粘贴/导入/删除独立 | 卡片后立即输入，Ctrl+Z 只撤销输入或只撤销卡片
- **§6.1 核心类型**（`docs/LLM_IMPLEMENTATION_SPEC.md:435-440`）：
  ```rust
  pub struct Transaction {
      pub edits: Vec<Edit>,
      pub selection_before: Selection,
      pub selection_after: Selection,
      pub intent: Intent, // Typing | Command | Paste | Delete | Import | Clear
  }
  ```
- **§7.2 撤销语义与分类表**（`docs/LLM_IMPLEMENTATION_SPEC.md:533-550`）：
  - `Typing`（连续输入字符）：同一输入串可合并；**遇到空格/命令/粘贴/导航断开**；
  - `Command`（点击卡片/命令）：单独一步，永不合并不后续 `Typing`；
  - `Paste`（粘贴）：单独一步；
  - `Delete`（删除选区/退格）：连续退格可合并，**跨单词/行断开**；
  - `Import`（导入/替换）：单独一步；可一次撤销；
  - `Clear`（清空）：单独一步；
  - `Nav`（导航）：不改 undo；
  - `History` 存逆操作（`Vec<Edit>`），每个 `Transaction` 记录 `selection_before/after` 并恢复选区，且**必须提供不依赖挂钟的确定性测试**。
- **§14 Gate G2 T2.2**（`docs/LLM_IMPLEMENTATION_SPEC.md:992`）：
  > T2.2 | Transaction/Undo 按 Intent 分组 | T2.1 | History | 卡片/输入/粘贴/导入独立

### 2.2 旧栈 `D-012` 实证复核（`crates/mathslot-core/src/editor.rs` & `src/app.rs`）
旧栈代码在当前快照中的精确行号与行为如下（规范 `F-021` 原引用 `src/app.rs:1227-1231`，经 Round 10-12 UI 调整后实际偏移至 `src/app.rs:1243-1284`）：
1. **基于系统挂钟 450ms 时间窗 + `char_delta` 判断**：
   - `src/app.rs:67` 定义 `last_typing_undo: Instant`，`src/app.rs:132` 初始化为 `Instant::now() - Duration::from_secs(5)`；
   - `src/app.rs:1243-1246` 渲染输入框前抓取整串快照 `prev_snap = Snapshot { source, cursor_char }`；
   - `src/app.rs:1275-1284` 在 `output.response.changed()` 时仅判断：
     ```rust
     if self.last_typing_undo.elapsed() > Duration::from_millis(450) || char_delta > 1 {
         self.editor.save_undo_snapshot(prev_snap);
         self.last_typing_undo = Instant::now();
     }
     ```
2. **卡片点击不重置 `last_typing_undo`，导致跨操作合并**：
   - `src/app.rs:1825-1830` 与 `src/app.rs:1941-1946` 调用 `self.editor.apply_card_click(&code)`；
   - `crates/mathslot-core/src/editor.rs:1170-1171` 仅压入点击前的 `push_current_to_undo()`，但 `src/app.rs` **未重置 `self.last_typing_undo`**；
   - 若用户在 `t=0ms` 输入 `'a'`（`last_typing_undo` 更新为 `t=0`），`t=100ms` 点击卡片（压入 `"a"`），`t=200ms` 键入 `'x'`（`elapsed = 200ms <= 450ms` 且 `char_delta == 1`），`src/app.rs:1281` 条件为 `false`，`'x'` 不会生成独立快照；随后按 `Ctrl+Z`（`src/app.rs:473-474` -> `crates/mathslot-core/src/editor.rs:264-279`）直接弹出 `"a"`，**一次撤销同时吞掉 `'x'` 与卡片插入**。
3. **空格与单字符粘贴同样跨操作合并**：
   - 450ms 内在 `TextEdit` 中键入空格或粘贴单个字符时，`char_delta == 1`，全部被 `src/app.rs:1281` 合并到前一段 `Typing` 快照。
4. **整篇导入/替换完全不可撤销**：
   - `src/app.rs:1947-1955` 处理 `ModalAction::ReplaceCode(code)`（来自公式库载入 `src/modals.rs:561` 与 LaTeX 导入替换 `src/modals.rs:907`）时直接覆盖 `self.editor.source = code`，**未调用 `push_current_to_undo()`**，导致替换无法通过 `Ctrl+Z` 撤销。
5. **整段快照模型无 `Intent`**：
   - `crates/mathslot-core/src/editor.rs:14-17, 123-124, 236-296` 仅存 `Vec<Snapshot>`（全量 `String` + `cursor_char`，上限 `MAX_HISTORY = 160` at line 11），无 `Intent`、无 `Transaction`、无 `History`。
- **判定**：旧栈 `D-012` 为 **OPEN**。

---

## 3. 新栈 `crates/mathslot-doc` 与 `crates/mathslot-app` 缺口审查

经逐行精读 `crates/mathslot-doc/src/{lib.rs,transaction.rs,undo.rs,editor.rs,cursor.rs,document.rs}` 与 `crates/mathslot-app/src/{lib.rs,app.rs,event.rs,command.rs,state.rs,effect.rs}`，逐项对照规范发现如下结构性缺口：

### 3.1 (a) `Intent` 枚举覆盖度（对比规范 §6.1 & §7.2）
当前 `crates/mathslot-doc/src/transaction.rs:21-30` 定义为：
```rust
pub enum Intent {
    Typing,
    PaletteCard,
    CommandExpansion,
    Paste,
    ImeCommit,
    Navigation,
    Format,
}
```
对照规范 §6.1 / §7.2，存在 5 处偏差与缺失：
1. **缺少 `Intent::Delete`**：`Editor::delete_backward`（`crates/mathslot-doc/src/editor.rs:496-504`）调用 `self.apply(...)`，而 `Editor::apply`（`editor.rs:253-255`）默认使用 `Intent::Typing`，把退格删除错误归类为 `Typing`。
2. **缺少 `Intent::Import`**：新栈无整篇导入/替换事务入口（无 `Editor::import_latex`/`replace_all` 方法，也无对应 `AppEvent`/`AppCommand`）。
3. **缺少 `Intent::Clear`**：`Editor` 无 `clear()` 方法；`AppCommand::ResetDocument`（`crates/mathslot-app/src/app.rs:274-278`）直接丢弃并重建 `Editor`。
4. **`Command` 命名分化**：规范 §6.1 / §7.2 定义统一 `Intent::Command`，当前拆分为 `PaletteCard` 与 `CommandExpansion`（且已写入 `crates/mathslot-doc/tests/a_edit_acceptance_tests.rs:120` 与 `crates/mathslot-app/tests/app_state_machine_tests.rs:174,187` 断言）。`ADR-0017` 需明确：是统一收敛为 `Intent::Command`（可带子类型或保持兼容重导出/判定方法 `is_command()`）并同步调整测试，还是保留 `PaletteCard`/`CommandExpansion` 并补充规范映射说明。
5. **`Nav` / `Navigation` 未受 `History` 硬隔离**：`UndoStack::push`（`crates/mathslot-doc/src/undo.rs:56-103`）未拒绝 `Intent::Navigation`（规范 §7.2 `Nav`），若外部传入 `Intent::Navigation` 事务仍会被压入 `undo_list`。

### 3.2 (b) `Typing` 合并边界
当前实现位于 `crates/mathslot-doc/src/undo.rs:59-97`：
```rust
let can_coalesce = last.intent == Intent::Typing
    && tx.intent == Intent::Typing
    && last.edits.len() == 1
    && tx.edits.len() == 1
    && tx.timestamp_ms.saturating_sub(last.timestamp_ms) <= self.coalesce_window_ms;
```
且 `same_target` 仅比较：
```rust
(Cursor::InSlot { slot_id: id1, .. }, Cursor::InSlot { slot_id: id2, .. }) => id1 == id2,
(Cursor::AtEnd, Cursor::AtEnd) => true,
(Cursor::AtStart, Cursor::AtStart) => true,
```
并在 `undo.rs:88` 仅检查 `!text2.contains('\n')`。存在 4 个严重缺陷：
1. **空格不断开（违反 §7.2）**：`undo.rs:88` 未检测空格或空白字符（`' '` / `'\t'`）。连续输入 `'a'`, `'b'`, `' '`, `'c'`, `'d'` 会全部合并进同一个 `InsertText` 事务。此外，需注意 `mathslot_syntax::lexer::tokenize`（`crates/mathslot-syntax/src/lexer.rs:30`）会过滤 `Token::Whitespace`，因此数学态在根级键入 `' '` 时需明确空格如何触发断开/记账（如在 `History` 中对含空白字符的 `Typing` 强制封口断组，使 `"ab"` 与 `"cd"` 绝不合并）。
2. **忽略 `InSlot.offset` 与光标连续性导致 Redo 数据损坏（`D-104`）**：
   - `undo.rs:80` 使用 `{ slot_id: id1, .. }` 丢弃 `offset`，且**完全不校验 `last.cursor_after == tx.cursor_before`**；
   - 复现链路：在 `\frac{}{}` 槽位 1 输入 `'a'`（`cursor_after = InSlot(1, 1)`）→ 按 `ArrowLeft` (`nav_left`，`editor.rs:370-382`，移至 `InSlot(1, 0)`) → 输入 `'b'`（文档分子变为 `"ba"`，`cursor_before = InSlot(1, 0)`）。因 `id1 == id2` 为真，`'b'` 被合并拼接到 `last.edits[0]` 尾部形成 `InsertText { at: InSlot(1, 0), text: "ab" }`！按 `Undo` 后再按 `Redo`，`apply_raw_edit` 回放 `"ab"` 而非 `"ba"`，**静默篡改文档内容**。
3. **导航与未决命令未断开合并**：
   - `Editor::tab_next_slot` / `tab_prev_slot` / `nav_to_slot` / `nav_left` / `nav_right` / `enter_nav_mode` / `exit_nav_mode`（`crates/mathslot-doc/src/editor.rs:131-141, 301-400`）均未通知 `history` 断开当前输入串。即使光标从 `AtEnd` 或 `Slot(1)` 跳走再跳回原位，前后两次 `Typing` 仍错误合并；
   - 在 `Idle` 输入 `'▸'` 进入 `PrefixPending` 后按 `Backspace` 取消前缀（`editor.rs:464-472, 532-536`），过程中未产生 `Transaction` 也未调用断组，导致取消前缀前后的 `Typing` 仍错误合并。
4. **仍依赖 500ms 系统挂钟时间窗（违反 `INV-008`）**：
   - `UndoStack::default()`（`undo.rs:16`）硬编码 `coalesce_window_ms = 500`，`undo.rs:65` 直接用 `tx.timestamp_ms - last.timestamp_ms <= 500` 决定是否合并，且 `editor.rs:264-267` 取 `SystemTime::now()`。
   - 这直接违背 `INV-008`（“撤销按意图分组，不按时间窗”）：既可能因机器负载导致连续单词在 >500ms 后意外分裂，又使测试受真实挂钟影响。

### 3.3 (c) `Delete` 合并边界
1. **连续退格完全不合并**：`UndoStack::push`（`undo.rs:67-96`）仅匹配 `(Edit::InsertText, Edit::InsertText)`，完全没有 `Edit::DeleteChar` 的合并分支。连续按 3 次 `Backspace` 会压入 3 个 `Intent::Typing` 事务而非合并的 `Intent::Delete`。
2. **缺少跨单词/跨行断开依据**：`Edit::DeleteChar { at: Cursor, backward: bool }`（`crates/mathslot-doc/src/transaction.rs:43-46`）仅记录位置与方向，未记录被删除字符/文本或边界标志（是否空白/换行/结构节点）。`History` 无法据此判断“连续退格是否跨越了单词或行边界”（§7.2：“连续退格可合并，跨单词/行断开”）。
3. **合并后 Redo 回放与逆操作约束**：若采用向 `tx.edits: Vec<Edit>` 追加后续 `DeleteChar` 并保留首个 `inverse_edits`（或构造删除前快照逆操作）的方式合并，必须确保光标连续（如连续 backward delete 时 `last.cursor_after == tx.cursor_before`，且目标仍在同一槽位/根级同层），以及 `redo()` 按正序重放 `tx.edits` 时偏移与文本严格一致。
4. **根级 `backward: false` 与 `DeleteForward` 缺陷（`D-107`）**：
   - `crates/mathslot-doc/src/transaction.rs:298-314` 对非 `InSlot` 光标一律执行 `chars.pop()`，完全忽略 `backward` 参数；
   - `crates/mathslot-app/src/app.rs:187` 中 `AppCommand::DeleteForward => {}` 为静默空操作，`Editor` 也无 `delete_forward()` 方法。
5. **选区 (`Selection`) 与选区删除缺失**：规范 §7.2 提及“删除选区/退格”，§6.1 要求 `selection_before` / `selection_after`，但当前 `mathslot-doc` 仅有单点 `Cursor`（`crates/mathslot-doc/src/cursor.rs:6-15`），无 `Selection` 结构及选区删除 `Edit`。

### 3.4 (d) `Import` 与 `Clear` 独立事务
1. **`Clear` 在 `mathslot-app` 直接销毁历史（`D-105`）**：
   - `crates/mathslot-app/src/app.rs:274-278`：
     ```rust
     AppCommand::ResetDocument => {
         self.editor = Editor::new(Document::new());
         emit_render = true;
         emit_focus = true;
     }
     ```
   - `AppEvent::Clear`（`event.rs:30` -> `app.rs:136`）直接替换整个 `Editor`，**清空全部历史栈**，执行 `AppEvent::Undo` 无法恢复清空前内容与光标（`app_state_machine_tests.rs:424-425` 仅断言清空后为空，未断言 `Undo` 可恢复）。
   - `crates/mathslot-doc/src/editor.rs` 中完全没有 `Editor::clear(&mut self)` 方法（空文档再 Clear 时也不应产生冗余空事务）。
2. **`Import` 在新栈缺失事件/命令/事务入口（`D-105`）**：
   - `crates/mathslot-doc/src/editor.rs` 虽有底层 `Edit::ReplaceAll`（`transaction.rs:60-62, 88-96`），但 `Editor` 未暴露 `import_latex` / `load_preset` / `replace_document` 等产出 `Intent::Import` 事务的方法；
   - `crates/mathslot-app/src/{event.rs,command.rs,app.rs}` 无任何 `Import` / `LoadPreset` 事件与命令，仅提供初始构造 `App::from_latex`（`app.rs:46-49`），无法覆盖运行中整篇导入并单步撤销回原文档及选区的契约；
   - 附带确认：`crates/mathslot-core/src/session.rs:36-42` `Session::load_latex` 同样直接覆盖 `self.editor = Editor::new(doc);`（旧 G1 门面遗留）。
3. **未决状态重置**：执行 `Import` 或 `Clear` 前若处于 `StreamState::PrefixPending` / `ParamCapture` / `UnknownCommand`，必须在独立事务中重置 `stream_state = StreamState::Idle` 并清空陈旧诊断，否则撤销/重做后残留幽灵流式状态。

### 3.5 (e) `History` API、选区恢复与确定性测试
1. **符号命名与轨迹观测接口缺失**：
   - 规范 §7.2 与 §14 `T2.2` 要求产物为 `History`，当前类型为 `UndoStack`（`crates/mathslot-doc/src/undo.rs:7`），且 `crates/mathslot-core/src/lib.rs:29` 已冻结重导出 `UndoStack`（故建议主结构体命名或导出 `History` 的同时保留 `pub type UndoStack = History;` 别名，避免破坏冻结的 `mathslot-core`）。
   - 当前仅提供 `undo_len()` / `redo_len()` / `last_transaction()`（`undo.rs:38-48`），缺乏直接的 `undo_depth()`、`redo_depth()`、`intents()`（撤销/重做栈意图轨迹切片）、`break_coalesce()`（显式断开分组）等无歧义测试接口。
2. **去系统挂钟与确定性测试缺失（`D-106`）**：
   - `crates/mathslot-doc/src/editor.rs:7, 264-267` 调用 `std::time::SystemTime::now()`：
     1. 违反 `INV-008`（按意图而非时间窗）；
     2. 在 `wasm32-unknown-unknown`（Gate G3 Obsidian 目标）上 `std::time::SystemTime::now()` 会**直接 panic**（`time not implemented on this platform`）；
     3. 现有唯一合并测试 `doc_tests.rs:138-174`（`test_input_coalescing`）依赖两次 `editor.apply` 调用间距 <500ms，存在 CI 调度抖动风险。
3. **`Selection` 与光标/选区恢复缺口**：
   - `Transaction`（`crates/mathslot-doc/src/transaction.rs:67-78`）只有 `cursor_before: Cursor` / `cursor_after: Cursor`，缺少规范 §6.1 / §7.2 要求的 `Selection` 类型与 `selection_before` / `selection_after` 字段（建议定义 `Selection { anchor: Cursor, focus: Cursor }` 或兼容包装，使单点光标可表达为 `Selection::caret(cursor)`）。
   - `crates/mathslot-doc/src/transaction.rs:171-174` 在 `Cursor::AtStart` 执行 `InsertText` 时：
     ```rust
     let new_cursor = Cursor::InSlot {
         slot_id: doc.slots.slots().first().map(|s| s.id).unwrap_or(SlotId(1)),
         offset: text.chars().count(),
     };
     ```
     当文档不含任何槽位（如纯字母公式）时，`unwrap_or(SlotId(1))` 会生成**不存在的幽灵 `SlotId(1)`**，导致下一次编辑在 `replace_slot` 处直接报 `DocError::SlotNotFound(SlotId(1))`。
4. **Undo/Redo 静默吞错（`D-107`）**：
   - `crates/mathslot-doc/src/undo.rs:113, 128` 在 `undo()` 与 `redo()` 中均写为 `let _ = Self::apply_raw_edit(doc, edit);`——若逆操作或重放失败，错误被静默丢弃且依然覆盖 `*cursor` 并移动栈帧，造成栈状态与文档状态永久脱节。

---

## 4. 新发现缺陷登记（`D-104`..`D-107`）

> 注：经检索 `agent-state/`，此前审计已占用 `D-101`、`D-102`、`D-103`，本次按规范从 `D-104` 起顺序分配，不复用历史 ID。

| ID | 级别 | 位置 | 现象 | 复现 / 验证路径 |
|---|---|---|---|---|
| **D-104** | **P2** (数据完整性) | `crates/mathslot-doc/src/undo.rs:80-95`<br>`crates/mathslot-doc/src/editor.rs:301-400` | `UndoStack::push` 合并 `InsertText` 时忽略 `InSlot.offset` 且不核对 `last.cursor_after == tx.cursor_before`；导航操作未断组。在同槽位输入 `'a'` 后左移再输入 `'b'`（实际为 `"ba"`），不仅误合并为单步，且 `Undo` 后 `Redo` 按旧偏移回放为 `"ab"`，**静默篡改文档**。 | 构造 `Editor::new(Document::from_latex(r"\frac{}{}").0)` → `type_char('a')` → `nav_left()` → `type_char('b')` → 断言 `undo_len()` 仍为 `1`（本应为 `2`）且 `undo(); redo(); to_latex()` 得到 `\frac{ab}{}` 而非 `\frac{ba}{}`。 |
| **D-105** | **P2** (撤销/数据丢失) | `crates/mathslot-app/src/app.rs:274-278`<br>`crates/mathslot-core/src/session.rs:36-42`<br>`src/app.rs:1947-1955` | `AppCommand::ResetDocument`（`AppEvent::Clear`）直接执行 `self.editor = Editor::new(Document::new())`，彻底销毁历史栈导致清空无法 `Ctrl+Z` 恢复；新栈缺乏 `Intent::Import` 事务入口；旧桌面端 `ModalAction::ReplaceCode` 亦未入撤销栈。 | `App::new()` → `KeyInput('x')` → `Clear` → `Undo`，`to_latex()` 仍为 `""` 且 `Undo` 不产生任何恢复效果。 |
| **D-106** | **P2** (WASM/确定性) | `crates/mathslot-doc/src/editor.rs:7, 264-267`<br>`crates/mathslot-doc/src/undo.rs:65` | 纯领域核心路径调用 `std::time::SystemTime::now()` 并以 500ms 挂钟时间窗判定合并，违反 `INV-008`（“不按时间窗”），导致测试结果依赖机器调度速度，且在 `wasm32-unknown-unknown` 目标运行期会触发 `SystemTime::now()` panic。 | 读取 `crates/mathslot-doc/src/editor.rs:264-267`；对比 `INV-008` 与 Gate G3 Obsidian WASM 约束。 |
| **D-107** | **P2** (静默失败/空操作) | `crates/mathslot-doc/src/undo.rs:113, 128`<br>`crates/mathslot-doc/src/transaction.rs:171-174, 298-314`<br>`crates/mathslot-app/src/app.rs:187` | 1) `undo()`/`redo()` 用 `let _ =` 静默吞掉 `apply_raw_edit` 错误；2) `AtStart` 无槽位时 `unwrap_or(SlotId(1))` 构造无效光标导致后续 `SlotNotFound`；3) `DeleteChar` 根级忽略 `backward: false`，且 `AppCommand::DeleteForward` 为空操作。 | 1) 无槽位文档 Cursor 置 `AtStart` 后 `InsertText` 再 `InsertText` 触发 `SlotNotFound(SlotId(1))`；2) `AppEvent::KeyDown(Key::Delete)` 在非空文档中无任何删除效果。 |

---

## 5. 历史报告结论抽查（对比代码现状）

按 `.agents/skills/independent-audit/SKILL.md` §3 第 3 条，抽取历史报告中关于撤销/History 的结论进行源码与测试实测核对：

| 来源报告 | 声称结论 | 源码与实测结果 | 核查结论 |
|---|---|---|---|
| `docs/ACCEPTANCE_REPORT_FINAL.md:208-215` (`§4.2 test_transaction_stress_undo_redo_loop`) | 声称“1. 连续输入 60 个字符（`a-z`, `0-9`）；2. 加载新公式 `\frac{1}{2}+\sqrt{3}`；……4. **循环全量撤销至初始状态**；5. 循环全量重做至最终编辑状态”。 | 查 `crates/mathslot-core/tests/acceptance_tests.rs:742-776`：1) `a..=z` + `0..=9` 仅 **36** 个字符而非 60 个；2) 第 753 行调用 `session.load_latex(...)`（`crates/mathslot-core/src/session.rs:36-42`）直接执行 `self.editor = Editor::new(doc);`，**彻底抹除前置 36 次打字的撤销历史**；3) 第 4 步 `while session.undo()` 实际仅撤销 1 步（`+99`）即停在 `\frac{1}{2}+\sqrt{3}`，**从未回到空初始状态**，但因测试只用弱断言 `assert!(undo_steps >= 1)` 而通过。 | **伪阳/失实（`Import` 不可撤销隐患长期被弱断言掩盖）** |
| `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:11, 45, 124` | 声称“【全面通过 (PASS - 100% 达标，正式完成重构)】”，并列举工具栏“撤销 `↶` (Ctrl+Z)、重做 `↷` (Ctrl+Y)、……`清空`（支持撤销恢复）”等全部完美达标。 | 查桌面端实现：`src/app.rs:1281` 仍使用 450ms 时间窗且 `src/app.rs:1826, 1942` 点击卡片不重置 `last_typing_undo`（`D-012` **OPEN**）；同时 `src/app.rs:1947-1955` `ModalAction::ReplaceCode`（公式库载入与 LaTeX 导入替换）完全未调用 `push_current_to_undo()`，替换操作不可撤销。 | **与代码现状不符（`D-012` 与替换不可撤销缺陷均仍在）** |
| `docs/AUDIT_ROUND_2.md:25, 54-56`（附查） | 声称 `UndoStack` “500ms 连续输入防抖合并……保持语义边界清晰”。 | 查 `crates/mathslot-doc/src/undo.rs:59-97` 与 `editor.rs:264`：仍耦合 `SystemTime::now()` 与 500ms 窗口（违背后续确立的 `INV-008`“不按时间窗”），且既未在空格处断组、也未校验 `InSlot.offset` 与导航断组（导致 `D-104`）。 | **边界未闭合（`INV-008` 与偏移连续性缺失）** |

---

## 6. 基线命令实测与静默失败/测试弱化核查

### 6.1 基线门禁实测

1. **全量一键门禁 `scripts/agent/acceptance.sh`**
   - 命令：`scripts/agent/acceptance.sh`
   - 退出码：`0`
   - 尾部输出：
     ```text
     结果 检查项                    说明
     ------ ---------------------------- ----
     PASS   cargo fmt --check            exit 0
     PASS   cargo clippy -D warnings     exit 0
     PASS   cargo test --workspace       exit 0
     PASS   调色板一致性           exit 0（gate=G2）
     WARN   let _ = 计数               27 处（G4 前应清零）
     WARN   unwrap() 计数              22 处（用户输入路径应为 0）
     WARN   命令表常量              3 处（G1 后应只剩 catalog）
     PASS   工作区干净              0 个未提交改动

     PASS=5 FAIL=0 WARN=3
     结论：PASS
     ```

2. **格式化与静态检查 `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings`**
   - 命令：`cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings`
   - 退出码：`0`
   - 尾部输出：
     ```text
         Finished `dev` profile [optimized + debuginfo] target(s) in 0.21s
     ```

3. **全量工作区测试 `cargo test --workspace`**
   - 命令：`cargo test --workspace`
   - 退出码：`0`
   - 汇总统计：累计 **186 passed, 0 failed, 4 ignored**（含 `mathslot-app` 10 passed、`mathslot-doc` 18 passed）。
   - 尾部输出摘要：
     ```text
     Running tests/a_edit_acceptance_tests.rs ...
     test result: ok. 9 passed; 0 failed; 0 ignored; measured; 0 filtered out; finished in 0.00s
     Running tests/doc_tests.rs ...
     test result: ok. 5 passed; 0 failed; 0 ignored; measured; 0 filtered out; finished in 0.00s
     Running tests/parity_harness_tests.rs ...
     test result: ok. 4 passed; 0 failed; 0 ignored; measured; 0 filtered out; finished in 0.02s
     ...
     Running tests/app_state_machine_tests.rs ...
     test result: ok. 10 passed; 0 failed; 0 ignored; measured; 0 filtered out; finished in 0.00s
     ```

4. **被忽略测试负向触发校验 `cargo test --workspace -- --ignored`**
   - 命令：`cargo test --workspace -- --ignored`
   - 退出码：`101`
   - 尾部输出：
     ```text
     failures:
         p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds
         p1_regression_tests::test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file

     test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s
     ```
   - （注：其余 2 项 `#[ignore]` 位于 `crates/mathslot-core/tests/p1_regression_tests.rs`，对应 `D-006`、`D-007`，未见新增非合规 `#[ignore]` 或删除测试。）

5. **调色板一致性检查 `scripts/agent/audit_palette.py`**
   - 命令：`scripts/agent/audit_palette.py`
   - 退出码：`0`
   - 尾部输出：
     ```text
     PASS：所有可映射卡片与命令目录一致
     ```

### 6.2 `mathslot-doc` 与 `mathslot-app` 静默失败与测试弱化扫描
命令：`rg -n "let _ =|\.unwrap\(|#\[ignore\]|#\[allow" crates/mathslot-doc/ crates/mathslot-app/`（exit 0）
- `#[ignore]` / `#[allow]`：**0 处**。
- `let _ =`：**3 处**（`crates/mathslot-doc/src/undo.rs:113, 128` 吞掉 `apply_raw_edit` 错误 -> 记为 `D-107`；`undo.rs:154` 丢弃已用 `?` 解包的 `apply_edit` 返回值）。
- `.unwrap()`：**3 处产品代码**（`crates/mathslot-doc/src/document.rs:642, 815, 838`，虽有 `new_nodes.len() == 1` 前置分支但仍算入全局 `unwrap()` 告警计数）与 4 处测试代码（`doc_tests.rs:86, 127, 150, 161`）。
- 测试弱化核查：`test_input_coalescing`（`doc_tests.rs:138-174`）仅测同一 `AtEnd` 下两字母合并，未测空格/命令/粘贴/导航断组、`Delete` 合并与断组、`Clear`/`Import` 撤销及光标/选区恢复；`test_keys_actions_and_redo`（`app_state_machine_tests.rs:424`）未在 `AppEvent::Clear` 后验证 `Undo` 恢复，放过了 `ResetDocument` 销毁历史的问题。

---

## 7. `ADR-0017` 范围、允许路径与确定性红灯测试蓝图

### 7.1 `ADR-0017` 建议实现范围与约束
1. **允许修改路径（严格限定 Gate G2 / T2.2 域）**：
   - `crates/mathslot-doc/src/**`（`lib.rs`, `cursor.rs`, `transaction.rs`, `undo.rs` / `history.rs`, `editor.rs`）
   - `crates/mathslot-doc/tests/**`
   - `crates/mathslot-app/src/**`（`lib.rs`, `event.rs`, `command.rs`, `app.rs`）
   - `crates/mathslot-app/tests/**`
   - **禁止修改**：`src/**`、`crates/mathslot-core/**`（保持旧栈冻结，通过保留 `pub type UndoStack = History;` 与既有公开签名确保 `mathslot-core` 零改动通过编译）、`crates/mathslot-syntax/**`、`crates/mathslot-command/**`、`scripts/agent/**`、`docs/**`。
2. **核心契约对齐（需在 `ADR-0017` 中拍板）**：
   - **`Intent` 对齐规范 §7.2**：补全 `Delete`、`Import`、`Clear`（及确保 `Nav`/`Navigation` 不进入历史栈）；`ADR-0017` 需明确 `PaletteCard`/`CommandExpansion` 与规范 `Intent::Command` 的统一方式（如收敛为 `Intent::Command` 并更新 `A-EDIT-004/005` 测试，或保留细分并在 `History` 暴露归类规则）。
   - **`History` 类型与无挂钟确定性合并**：
     - 导出 `History`（并保留 `pub type UndoStack = History;` 兼容别名）；
     - 废除 `Editor::apply_with_intent` 对 `SystemTime::now()` 的直接调用及对 500ms 挂钟时间窗的依赖（满足 `INV-008` 与 `wasm32` 无 panic）；
     - 提供 `undo_depth()` / `redo_depth()` / `intents()` / `redo_intents()` / `break_coalesce()`（或 `seal_coalesce()`）测试与观测接口；
     - `History::push` 遇到 `Intent::Nav`（或 `Navigation`）直接忽略不入栈。
   - **合并与断组规则实现**：
     - `Typing`：仅当上下两步均为 `Intent::Typing`、单步插入且 `last.cursor_after == tx.cursor_before`、无中间 `break_coalesce()` 标记、且不跨空白字符（`char::is_whitespace` / `'\n'`）时合并；遇到空格/命令/粘贴/导航/取消前缀均断开；
     - `Delete`：`Editor::delete_backward` 与 `delete_forward`（修复根级 `backward: false` 与 `AppCommand::DeleteForward`）统一发射 `Intent::Delete`；在 `Edit::DeleteChar` 或 `Transaction` 中携带被删文本/字符或边界标记；仅当同向、光标连续且不跨单词（空白）或行（`\n`）时合并，并保证 `undo`/`redo` 可精确往返；
     - `Command`（卡片与命令展开）、`Paste`、`ImeCommit`、`Import`、`Clear`：全部独立成步，永不相互合并也不与前后 `Typing`/`Delete` 合并。
   - **`Import` 与 `Clear` 独立事务 + `Selection` 恢复**：
     - 为 `mathslot-doc::Editor` 增加 `clear(&mut self)`（产出 `Intent::Clear`，空文档幂等不压空事务）与 `import_latex(&mut self, latex: &str)` / `replace_all_with_intent(...)`（产出 `Intent::Import`，并重置 `stream_state` 与 `diagnostics`）；
     - 为 `mathslot-app` 增加 `AppEvent::ImportLatex(String)`（或 `Import`）与 `AppCommand::ImportLatex(String)`，并将 `AppCommand::ResetDocument` 改为调用 `self.editor.clear()`；
     - 引入 `Selection` 结构（含 `anchor`、`focus`，支持单点退化 `Selection::caret(cursor)`），在 `Transaction` 中记录 `selection_before` / `selection_after` 并在 `undo()`/`redo()` 精确恢复；同时修复 `AtStart` 构造幽灵 `SlotId(1)` 问题与 `undo.rs:113,128` 吞错问题。
   - **禁止**：不得新增 `let _ =`、`#[allow]`、`#[ignore]` 或用户路径 `unwrap()`。

### 7.2 确定性红灯测试蓝图（T2.2 实现前必须先红后绿）

按 `AGENTS.md` 硬规则 4（先失败测试，后改实现），建议在 `crates/mathslot-doc/tests/` 与 `crates/mathslot-app/tests/` 先建立以下不依赖 `std::time` 的确定性失败测试：

1. **红灯测试 1：`test_typing_coalesces_word_and_breaks_on_space`**（当前必败：`UndoStack` 把 `"ab cd"` 合并为 1 步）
   - 序列：连续 `Typing` `'a'`, `'b'`, `' '`, `'c'`, `'d'`（或显式调用 `History::push` 序列）。
   - 断言：`undo_depth >= 2`（`'a','b'` 与 `'c','d'` 绝不合并）；首次 `undo()` 仅撤销 `"cd"` 保留 `"ab"`（或 `"ab "`），再撤销到底恢复为空；`redo()` 全部恢复 `"abcd"` / `"ab cd"`。
2. **红灯测试 2：`test_typing_breaks_on_command_paste_and_navigation_and_preserves_redo_order`**（当前必败：覆盖 `D-104` 与断组缺失）
   - 子场景 A（同槽左移，锁定 `D-104`）：`\frac{}{}` 中键入 `'a'` → `nav_left()` → 键入 `'b'`，文档分子为 `"ba"`。断言 `undo_depth == 2`，`undo()` 恢复 `\frac{a}{}`，再 `undo()` 恢复 `\frac{}{}`，再两次 `redo()` **必须严格恢复为 `\frac{ba}{}`**（而非当前错位的 `\frac{ab}{}`）。
   - 子场景 B（Nav 模式往返）：键入 `"ab"` → `EnterNav` → `'j'`/`'k'` 回到原槽 → `ExitNav` → 键入 `"cd"`。断言 `undo_depth == 2`，`intents` 为 `[Typing, Typing]`，首次 `undo()` 只撤 `"cd"`。
   - 子场景 C（卡片/流式命令/粘贴隔断）：键入 `"ab"` → `ApplyCard("partial")`（或流式 `▸f1;2;`）→ 键入 `"cd"` → `Paste("xy")` → 键入 `"ef"`。断言没有任何相邻非同类事务合并，逐步 `undo()` 依次独立回退。
3. **红灯测试 3：`test_delete_intent_coalesces_within_word_and_breaks_across_word_and_line`**（当前必败：`Intent::Delete` 不存在且退格不合并）
   - 构造含多词/多行内容（如 `"foo bar"` 或跨词序列 `"hello world"` / 含 `'\n'` 片段）及显式 `History` `Intent::Delete` 序列：
   - 连续退格删除 `"bar"`（3 次 `DeleteChar`）合并为 1 个 `Intent::Delete`；跨空格（或换行 `'\n'`）再删除 `"foo"` 的字符时**断开**为新的 `Intent::Delete` 事务；
   - `undo()` 逐词恢复并同步恢复光标/选区，`redo()` 严格重放；并验证 `KeyDown(Key::Delete)`（`DeleteForward`）可删除并按 `Intent::Delete` 记账。
4. **红灯测试 4：`test_import_and_clear_are_single_undoable_transactions_with_selection`**（当前必败：覆盖 `D-105`，`Clear` 销毁历史且无 `Import` 事件）
   - 在 `App` 中：键入 `"xy"` → 派发 `AppEvent::ImportLatex(r"\frac{1}{2}")` → 验证 `to_latex() == r"\frac{1}{2}"` 且 `undo_depth == 2`、`intents == [Typing, Import]` → `Undo` 一步完整恢复 `"xy"` 与进口前选区；`Redo` 一步恢复 `\frac{1}{2}`。
   - 在 `\frac{a}{b}`（选区/光标位于特定槽位，记录 `selection_before`）中：派发 `AppEvent::Clear` → 验证 `to_latex() == ""`、`undo_depth` 增量 1、栈顶意图为 `Intent::Clear` → 单次 `AppEvent::Undo` 完整恢复 `\frac{a}{b}` 及原选区/光标！
5. **红灯测试 5：`test_history_deterministic_without_wall_clock_and_nav_never_recorded`**（当前必败：`D-106` 挂钟依赖 + `Nav` 无防护 + `Cursor::AtStart` 幽灵 `SlotId(1)`）
   - 直接驱动 `History`（给定显式 `source` / `selection_before` / `selection_after` / `intent` 序列，即使故意将 `timestamp_ms` 跨度设为 `0` 与 `10_000`）：验证相同 `Typing` 词内仍合并（不因超过 500ms 挂钟分裂，遵守 `INV-008`），跨空格/异意图即使同毫秒（`delta = 0ms`）也绝对断开；
   - 向 `History::push` 传入 `Intent::Nav`（或执行全套 `Navigate` 事件）：断言 `undo_depth` / `redo_depth` / `intents` 纹丝不动；
   - 无槽位文档在 `Cursor::AtStart` 连续插入 `"a"`、`"b"`：断言光标不产生非法 `SlotId(1)`，不报 `SlotNotFound`。

---

## 8. 综合裁定与下一步建议

- **综合裁定**：**BLOCK**（当前状态定性：**READY_FOR_DECISION**）
  - 依据 `AGENTS.md` 与审计规则，旧栈 `D-012` 为 `OPEN`，`T2.2` 目标契约（`Intent` 完整性、边界断组、`Delete` 合并、`Import`/`Clear` 独立事务、`History` 无挂钟与选区恢复）在新栈尚未闭环且新发现 `D-104`..`D-107`，故门禁保持 **BLOCK**。
- **下一步建议**：
  1. Coordinator 依据本报告 (§3, §4, §7) 起草并签署 **`ADR-0017`**，明确 `Intent` 统一枚举方案、允许改动范围（限定 `mathslot-doc` 与 `mathslot-app`）与禁令；
  2. Implementer 严格先在 `crates/mathslot-doc/tests/` 与 `crates/mathslot-app/tests/` 落地 §7.2 全部确定性红灯测试并展示失败输出，再实现 `History` 与 `mathslot-app` 事件/命令改造，最后跑通全量门禁；
  3. Verifier 独立核对 diff、红转绿证据与 `scripts/agent/acceptance.sh` 全绿后出具 `VER-14`。

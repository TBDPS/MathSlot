# ADR-0013：移植 StreamEditor 流式编辑语义到目标栈并满足 8 项 A-EDIT 场景（T1.5）

- 日期：2026-11-13
- 状态：已批准
- 决策者：coordinator（依据 `AUD-10` 审计结论与规范 §7.4、§11、§14 G1 / T1.5）
- 关联任务：`T1.5`
- 关联不变量：`INV-001`（唯一事实源栈）、`INV-007`（不完整输入一等公民）、`INV-008`（撤销重做按意图独立分组）、`INV-016`（平滑演进）
- 关联缺陷：`D-001`（已在T1.3关闭）、`D-004`（未决命令静默丢失）、`D-018`（双栈分叉收敛）

## 1. 背景与事实

- 规范 §14 Gate G1（单一事实源）任务 T1.5 要求：
  > T1.5 | 把 StreamEditor 流式语义移植到选定栈 | T1.4 | 新 editor API | 8 个 A-EDIT 场景通过
- `AUD-10` 独立审计确认：
  - 旧版 `StreamEditor`（`crates/mathslot-core/src/editor.rs`）存在设计缺陷：
    1. 基于源文本尾部字符猜测状态，缺乏显式状态机；
    2. 全量快照与 500ms 连续输入合并缺乏 Intent 语义，导致卡片点击与后继输入错误合并，违反 A-EDIT-005 与 INV-008；
    3. 粘贴操作未区分原语，含 `▸` 文本会触发宏展开，违反 A-EDIT-006；
    4. 无 IME 组合暂态隔离，违反 A-EDIT-007；
    5. 槽位导航在未闭合处强行追加 `;` 污染文本与撤销栈，违反 A-EDIT-008；
  - 目标栈 `crates/mathslot-doc/` 已具备 `Document`、`Cursor`、`SlotTable`、`Transaction` 与 `UndoStack` 基础，但其 `Editor` 尚属简单骨架，缺少流式前缀解析、Intent 分组、粘贴原语、IME 暂态和 8 项 A-EDIT 场景支持。

## 2. 决策与架构设计

### 2.1 强化 `mathslot-doc` 的 `Editor` API

在 `crates/mathslot-doc` 中扩展 `Editor`，赋予其完整的流式编辑能力：

1. **显式编辑状态机与前缀流式捕获**：
   - 增加流式前缀状态支持：`Idle`、`PrefixPending { prefix: String }`、`ParamCapture { command_id: String, slot_idx: usize, buffer: String }`；
   - 统一识别 `▸`（`\u{25b8}`）触发符与 `;` 分隔符；
   - 依据 `catalog/commands.toml`（通过 `mathslot-command` 或语法规则）将 `▸f1;2;` 解析为带有两个槽位的分式结构 `\frac{1}{2}`（满足 **A-EDIT-001**）。

2. **未决状态与未知命令诊断支持**：
   - 当处于 `▸m` 等未完成命令状态时，编辑器保留 Pending 状态并标记待决诊断，导出/复制时提供显式占位符或拦截，严禁返回空串（满足 **A-EDIT-002**，为修 D-004 奠基）；
   - 当输入 `▸zz` 等非法命令时，不静默替换为 `z`，而是记录 Invalid/Unknown 诊断并生成错误占位符（满足 **A-EDIT-003**）。

3. **基于 Intent 的原子事务与撤销隔离 (INV-008)**：
   - 在 `Transaction` 中增加 `Intent` 枚举：
     ```rust
     #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
   - 暴露 `apply_command_card(&mut self, command_id: &str)` API：点击卡片（如“偏导”插入 `\partial`）使用 `Intent::PaletteCard`（满足 **A-EDIT-004**）；
   - `UndoStack::push` 防抖合并规则增加条件：**仅当 `last.intent == Intent::Typing && tx.intent == Intent::Typing` 时才允许合并**。点击卡片后紧接着键盘输入，两者的 Intent 不同，绝不合并；Ctrl+Z 必先撤销打字，再撤销卡片（满足 **A-EDIT-005**）。

4. **安全粘贴原语与 IME 隔离**：
   - 增加 `paste_text(&mut self, text: &str)` API：使用 `Intent::Paste`，将文本作为纯字面量插入，即使包含 `▸` 也绝不触发宏解析或流式命令捕获（满足 **A-EDIT-006**）；
   - 增加 IME 组合态 API：`set_ime_composition(&mut self, text: &str)` 与 `commit_ime(&mut self, text: &str)`，组合期间不写入 Undo 栈，确认时产生 `Intent::ImeCommit` 单一事务（满足 **A-EDIT-007**）。

5. **纯读导航模式**：
   - 提供导航操作（如按字母/方向键跳槽）：仅调整 `Cursor`，不改动 `Document`，不生成 `Transaction`，不污染撤销栈（满足 **A-EDIT-008**）。

### 2.2 允许的写作用域与路径

- `crates/mathslot-doc/Cargo.toml`（添加 `mathslot-command` 依赖以对接事实源，若需）
- `crates/mathslot-doc/src/**`（`editor.rs`、`transaction.rs`、`undo.rs`、`lib.rs` 等）
- `crates/mathslot-doc/tests/a_edit_acceptance_tests.rs`（新建 8 项 A-EDIT 验收测试）
- 严禁修改：`src/**`、`crates/mathslot-core/**`、`scripts/agent/**`、`docs/**`。

### 2.3 测试驱动与门禁

1. **先失败测试（RED）**：先编写 `crates/mathslot-doc/tests/a_edit_acceptance_tests.rs`，覆盖 A-EDIT-001 至 A-EDIT-008，运行必定编译或逻辑失败；
2. **实现并通过（GREEN）**：完善 `mathslot-doc` 流式编辑 API，运行 `cargo test -p mathslot-doc` 全绿；
3. **全量门禁**：
   - `cargo fmt --check`
   - `cargo clippy --workspace --all-targets -- -D warnings`
   - `cargo test --workspace`
   - `scripts/agent/acceptance.sh --fast`

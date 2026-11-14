# ADR-0023: 原生端无限连击/焦点/单行输入修复（PRE-G3-NATIVE-1：`D-110`、`D-015`、`D-009`）

- **Date**: 2026-11-14
- **Round**: 20
- **Task ID**: `PRE-G3-NATIVE-1`
- **Defects**: `D-110` (P1), `D-015` (P2), `D-009` (P2)
- **Audit Reference**: `agent-state/audits/AUD-20.md`

---

## 1. 范围与允许修改路径

- **允许写入**：
  - `src/app.rs`
  - `src/p1_regression_tests.rs`
- **禁止修改**：`crates/**`、`src/modals.rs`、`src/render.rs`、`scripts/agent/**`、`docs/**`、`agent-state/**`

---

## 2. 技术契约（必须满足）

### 2.1 修复 `D-110`（Wayland + `fcitx5` 无限按键重复 / 每帧打断 IME 死循环）
1. **消除每帧 `request_focus` / `interrupt_ime()` 风暴**：
   - 在 `MathSlotApp::ui` 帧尾焦点管理（原 `src/app.rs:2196-2206`）中，提取纯状态判定逻辑（可单元测试）：仅当 `self.request_input_focus` 为真、处于 `WorkspaceTab::Palette`、非 `esc_nav` 模式、且 `!ctx.memory(|m| m.has_focus(self.input_id))` 时，才调用一次 `ctx.memory_mut(|m| m.request_focus(self.input_id))`；随后总是清零 `self.request_input_focus = false`。
   - 仅当 `self.editor.esc_nav.is_some()` 且当前确实持有 `self.input_id` 焦点时才调用 `surrender_focus`。
   - 在稳态输入连续帧下，`egui::Context` 的 `requested_interrupt_ime` / IME disable-enable 切换不得被触发。
2. **输入事件 `RepeatGuard` 防护**：
   - 在 `src/app.rs` 提取纯逻辑结构体/状态机 `RepeatGuard`（无 UI 依赖可直接单测，并在每帧 UI 预处理前过滤 `ctx.input_mut(|i| ...)`）：
     - 追踪真实物理按下（`Event::Key { pressed: true, repeat: false }`）、释放（`pressed: false`）、窗口失焦（`Event::WindowFocused(false)`）与 IME 状态变化（`Event::Ime(Ime::Enabled | Disabled | Commit | Preedit)`）。
     - 若发生窗口失焦或 IME 启闭/提交，清空未决物理按键状态，阻断陈旧 `calloop` 定时器残留的孤立 `repeat: true` 文本/按键事件。
     - 若遇到非正常连击（没有前置物理 `repeat: false` 按下、窗口未聚焦 `!i.focused`、或可打印单字符连续 `repeat: true` 超过合理上限如 `> 20` 帧而无新物理按下）导致的孤立重复 `Event::Text` 与对应重复 `Key`，必须拦截丢弃；同时保留用户按住 `Backspace`/`Delete`/方向键在有前置物理按下且未超限时（或普通非阻塞编辑键）的正常重复能力。
     - `handle_keys_before_ui` 中的非文本命令/快捷动作（`F1..F4`、`Escape`、`Copy`、`SaveSnippet`、`Undo`/`Redo`、`Alt+ArrowLeft`、`try_wrap_bracket_selection`、`Tab`/`Enter`/导航热键等）应拒绝或过滤 `repeat: true` 触发（不得因按住或卡键无限执行复制/撤销/切换工作区）。

### 2.2 修复 `D-015`（焦点锁定陷阱）
- 移除 `TextEdit::singleline` 上的 `.lock_focus(true)`（原 `src/app.rs:1495`）。
- 将 `Key::Tab` 命令前缀拦截（原 `src/app.rs:686`）限定在编辑器聚焦场景（`ctx.memory(|m| m.has_focus(self.input_id))` 或显式 `Palette` 编辑器上下文），确保焦点不在输入框时可通过 `Tab` / `Shift+Tab` 正常在界面控件间移动（`Shift+Tab` 可从输入框退焦）。

### 2.3 修复 `D-009`（`TextEdit::singleline` 视觉折行）
- 移除 singleline `layouter` 中的 `job.wrap.max_width = wrap_width;`（改用不限宽 `f32::INFINITY` 并置于横向滚动容器 `egui::ScrollArea::horizontal()` 内），保证长单行输入在视觉上保持单行不折行。

---

## 3. TDD 验收标准（先红后绿）

`src/p1_regression_tests.rs` 必须先新增失败测试、运行观察 FAIL，再修改实现并验证 PASS：
1. `test_p1_d110_no_every_frame_request_focus_or_ime_interrupt`：使用真实 `egui::Context` 运行连续帧（`Palette` 正常输入态），断言稳态帧不会反复触发 `should_interrupt_composition` / `request_focus`。
2. `test_p1_d110_repeat_guard_blocks_orphan_and_post_ime_wayland_repeats`：构造 Wayland+fcitx5 典型故障序列（`Ime::Disabled`/`Enabled` 或 `WindowFocused(false)` 后无物理 `repeat: false` 的孤立 `Key { repeat: true } + Event::Text("a")`，以及连续打印字符重复风暴），断言 `RepeatGuard` 阻断无限重复字符插入，而正常单次键入与 `Backspace` 正常长按仍工作。
3. `test_p2_d015_singleline_does_not_lock_focus`：在 `egui::Context` 真实输入 `Shift+Tab` / 焦点移出 `input_id` 后，验证后续帧不会强行把焦点抢回 `input_id`。
4. `test_p2_d009_singleline_layouter_does_not_wrap_long_formula`：长简码（如 160 字符公式）在 `MathSlotApp` singleline 布局结果（`galley.rows.len() == 1`）不折行。

门禁要求：
- `cargo fmt --check` PASS
- `cargo clippy --workspace --all-targets -- -D warnings` PASS
- `cargo test --workspace --offline` PASS（新增 4 项均通过，不新增任何 `#[ignore]`、`let _ =` 或 `unwrap()`）
- 单次原子提交，commit message 含 `PRE-G3-NATIVE-1` 与 `D-110`、`D-015`、`D-009`（不加方括号）。

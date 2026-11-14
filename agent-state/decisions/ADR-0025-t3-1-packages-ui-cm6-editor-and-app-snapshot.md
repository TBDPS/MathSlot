# ADR-0025: Gate G3 T3.1 — `packages/ui` CodeMirror 6 编辑器、命令/槽位装饰与 `EngineClient` 契约

- **Date**: 2026-11-14
- **Round**: 22
- **Gate / Task**: `G3` / `T3.1`
- **Acceptance Targets**: `A-EDIT-006`, `A-EDIT-007`, `A-EDIT-008`, `D-009` (CM6 真多行), `D-015` (CM6 Tab 焦点不锁死 + 无每帧 focus), `D-026` (CSS 主题变量与 ARIA 标签基础)
- **Audit Reference**: `agent-state/audits/AUD-21.md`

---

## 1. 架构原则与允许修改路径

严格遵守 `INV-001`、`INV-006`、`INV-009` 与规范 §5.2–§5.3：
- `packages/ui` **MUST 只依赖 `EngineClient` 抽象与 `packages/ui/src/generated/catalog.ts`**；禁止在前端 TS 中复制命令表、parser、AST 或 LaTeX 生成器；禁止直接在 `packages/ui/src/` 导入 `@tauri-apps/api` 或 `wasm-bindgen`。
- 禁止修改既有 `crates/mathslot-doc` 与 `crates/mathslot-app` 已通过的 G2 行为（`dispatch`、`type_char` 等不得破坏现有任何单测）。

**允许写入路径**：
- `crates/mathslot-app/src/lib.rs`
- `crates/mathslot-app/src/app.rs`（只增读方法，不破坏现有逻辑）
- `crates/mathslot-app/src/snapshot.rs`（新增可序列化 `EngineSnapshot` / `SlotSnapshot` / `DiagnosticSnapshot` / `CommandSpan`）
- `crates/mathslot-app/tests/`（`EngineSnapshot` 单元测试）
- `packages/ui/**`（禁止改动 `packages/ui/src/generated/catalog.ts`！）
- `.gitignore`（仅添加 `packages/ui/node_modules/`、`packages/ui/dist/`、`packages/ui/.vite/` 等前端构建忽略项，不碰已有条目）

**禁止修改**：`src/**`、`crates/mathslot-core/**`、`crates/mathslot-doc/**`、`crates/mathslot-syntax/**`、`crates/mathslot-command/**`、`packages/ui/src/generated/catalog.ts`、`scripts/agent/**`、`docs/**`、`agent-state/**`

---

## 2. 技术契约

### 2.1 Rust 侧 `crates/mathslot-app`：`EngineSnapshot` DTO
新增 `snapshot.rs` 并由 `crates/mathslot-app/src/lib.rs` 导出：
- `EngineSnapshot`（`Serialize`, `Deserialize`）：
  - `state: EditorState`
  - `latex: String`
  - `copy_text: String`
  - `has_pending_command: bool`
  - `is_composing: bool`
  - `is_nav_mode: bool`
  - `can_undo: bool`
  - `can_redo: bool`
  - `slots: Vec<SlotSnapshot>`（含 `id: u32`, `role: String`, `label: String`, `is_empty: bool`, `is_active: bool`）
  - `diagnostics: Vec<DiagnosticSnapshot>`（含 `code: String`, `severity: StatusSeverity`, `message: String`）
  - `active_slot_id: Option<u32>`
- `DispatchResponse`（`Serialize`, `Deserialize`）：`{ effects: Vec<Effect>, snapshot: EngineSnapshot }`
- `App::snapshot(&self) -> EngineSnapshot` 与 `App::dispatch_snapshot(&mut self, event: AppEvent) -> DispatchResponse`（纯增量补充，现有 `App::dispatch` 与全部 G2 测试保持 100% 不变）。

### 2.2 前端 `packages/ui/`（Svelte 5 + TypeScript + CodeMirror 6 + Vite + Vitest）
1. **依赖与配置**：
   - `package.json`：`"type": "module"`，脚本 `build`, `check`, `test`（`vitest run`）。
   - 安装并锁定 Svelte 5、`@sveltejs/vite-plugin-svelte`、CodeMirror 6（`codemirror`, `@codemirror/view`, `@codemirror/state`, `@codemirror/commands`）、`vite`、`vitest`、`jsdom`、`typescript`。
2. **设计 Token（`src/theme/tokens.css`）**：
   - 建立完整明/暗两套 CSS Custom Properties（`[data-theme="light"]` / `[data-theme="dark"]` + `@media (prefers-color-scheme)` 支持），包含背景、卡片表面、边框、数学字距、高亮焦点环、槽位药丸色、警告/错误语义色，严禁组件 CSS 硬编码暗色写死。
3. **`EngineClient` 契约（`src/client/engine.ts`）**：
   - 精确镜像 `crates/mathslot-app` 的 `AppEvent`、`Effect`、`EditorState`、`EngineSnapshot`、`SlotSnapshot`、`DiagnosticSnapshot`。
   - 声明 `interface EngineClient { dispatch(event: AppEvent): Promise<DispatchResponse>; snapshot(): Promise<EngineSnapshot>; engineVersion(): Promise<string>; }`。
   - **禁止**在 `src/` 内置第二套 parser/AST/LaTeX 生成器或第二套命令表。
4. **CodeMirror 6 编辑器扩展（`src/editor/`）**：
   - `decorations.ts`：
     - 基于 CM6 文档位置高亮流式命令前缀/已识别命令标记（查询 `packages/ui/src/generated/catalog.ts` 的 `COMMANDS_BY_ID`/`COMMANDS` 展示可读 `glyph`/`label` tooltip 徽章，无第二份命令表）；
     - 渲染空槽位指示装饰与活动槽位高亮（搭配可访问标签，不只靠颜色表达）；
     - 若存在 `diagnostics`，渲染语义错误/Pending 装饰与 ARIA 提示。
   - `keymap.ts`：
     - **`A-EDIT-006`**：显式拦截 `paste`（提取剪贴板文本），发送 `AppEvent::Paste(text)`，阻止命令状态机按按键逐字符解析粘贴文本中的 `▸`。
     - **`A-EDIT-007`**：在 `compositionstart..compositionend` 或 `view.composing` 期间不拦截按键、不重排光标/选区；组合提交发送 `ImeCompositionCommit`。
     - **`A-EDIT-008`**：当外部传入 `isNavMode === true` 时，按键（如 `j/k/n/p/h/l`）路由到 `EngineClient.dispatch` 导航事件并阻断 CM6 原生文本插入，保持文档内容与 CM6 history 不变。
     - **`D-009`**：原生多行编辑模式，支持真实 `\n` 换行（`doc.lines >= 1` 与视觉行严格一致，不出现 singleline 伪折行）。
     - **`D-015`**：不锁定焦点；支持 `Tab` / `Shift+Tab` 按焦点策略离开编辑器到调色板/按钮等其他可聚焦控件，禁止任何 `requestAnimationFrame` / 每次渲染循环强夺焦点。
   - `MathSlotEditor.svelte`：Svelte 5 组件封装 CM6 挂载/销毁、主题绑定、状态徽章（Idle/Prefix/Nav/IME）、槽位计数与诊断摘要条。

---

## 3. TDD 验收标准（先红后绿）

1. **`crates/mathslot-app`**：先写测试 `app_snapshot_serializes_slots_diagnostics_and_state`，运行失败后实现 `snapshot.rs` 并验证全 Rust workspace 测试通过。
2. **`packages/ui/tests/editor.test.ts`**：先写 Vitest 失败测试（在扩展/组件完成前运行观测 FAIL），覆盖：
   - `A-EDIT-006`: 粘贴 `"x+▸f1;2;"` → 调用 `Paste("x+▸f1;2;")`，不触发 `KeyInput('▸')`，文档原样包含 `▸f1;2;`；
   - `A-EDIT-007`: `compositionstart` / `compositionupdate("shuxue")` / `compositionend("数学")` → 组合期间不拦截/不改选区，提交发送 `ImeCompositionCommit("数学")`；
   - `A-EDIT-008`: `Nav` 模式下按 `j`/`k`/`h`/`l` → 派发导航事件，CM6 文档文本与行数不变；
   - `D-009`: 输入/设置 3 行公式文本（含 `\n`）→ CM6 `doc.lines === 3`，多行语义与视觉行一致；
   - `D-015`: `Shift+Tab` 或焦点移出编辑器后不被后续状态更新抢回焦点；
   - 命令/槽位/诊断装饰读取 `generated/catalog.ts` 与 `EngineSnapshot` 渲染对应标记与 ARIA 属性。
3. 门禁要求：
   - `cargo fmt --check` PASS
   - `cargo clippy --workspace --all-targets -- -D warnings` PASS
   - `cargo test --workspace --offline` PASS（`0 failed; 0 ignored`）
   - `cd packages/ui && npm test && npm run check && npm run build` PASS
   - 不新增 `let _ =`、`.unwrap()`、`#[allow]`、`#[ignore]`，不修改 `packages/ui/src/generated/catalog.ts`。
   - 单次原子提交，commit message 含 `T3.1` 与 `D-009 D-015 D-026`（不加方括号）。

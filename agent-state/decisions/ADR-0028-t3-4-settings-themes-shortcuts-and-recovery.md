# ADR-0028: Gate G3 T3.4 — 设置页 / 明暗与跟随系统主题 / 可配置快捷键与冲突检测 / 损坏隔离恢复向导 UI

- **Date**: 2026-11-14
- **Round**: 25
- **Gate / Task**: `G3` / `T3.4`
- **Defects & Acceptance**: `D-116`, `D-117`, `D-118`, `D-119`, `D-015`, `D-016`, `D-020`, `A-DATA-001`, `A-UI-001`, `A-UI-004`, `S-006`
- **Audit Reference**: `agent-state/audits/AUD-24.md`

---

## 1. 范围与允许修改路径

- **允许写入**：
  - `crates/mathslot-store/src/lib.rs`、`crates/mathslot-store/src/migrate.rs`、`crates/mathslot-store/tests/**`
  - `crates/mathslot-app/src/{app.rs,command.rs,event.rs,snapshot.rs,effect.rs}`、`crates/mathslot-app/tests/**`
  - `packages/ui/src/theme/tokens.css`
  - `packages/ui/src/client/engine.ts`、`packages/ui/src/index.ts`
  - `packages/ui/src/editor/{keymap.ts,MathSlotEditor.svelte}`
  - `packages/ui/src/preview/PreviewPanel.svelte`
  - `packages/ui/src/settings/**`（`shortcuts.ts`、`SettingsPanel.svelte`、`RecoveryBanner.svelte` 或一体化恢复向导区块）
  - `packages/ui/tests/**`
- **禁止修改**：
  - `packages/ui/src/generated/**`、`xtask/**`、`catalog/**`、`src/**`、`crates/mathslot-core/**`、`crates/mathslot-command/**`、`crates/mathslot-syntax/**`、`crates/mathslot-doc/**`、`crates/mathslot-render/**`、`scripts/agent/**`、`docs/**`、`agent-state/**`

---

## 2. 技术契约

### 2.1 `mathslot-store` 持久化扩展（`D-116`）
1. **向后兼容 `Settings` 扩展**：
   - 在 `crates/mathslot-store/src/lib.rs` 为 `Settings` 增加带 `#[serde(default = ...)]` 的字段：
     - `theme: ThemePreference`（`Light` / `Dark` / `System`，默认 `System`，serde lowercase `"light" | "dark" | "system"`）
     - `render_backend: RenderBackendPreference`（`MathJax` / `LatexRust`，默认 `MathJax`，serde `"mathjax" | "latex-rust"`）
     - `shortcuts: ShortcutSettings`（含可配置动作映射，例如 `nav_next_slot`、`nav_prev_slot`、`nav_parent`、`nav_first_child`、`copy_latex`、`save_snippet`、`focus_editor`、`toggle_nav`、`open_settings`，附清晰规范默认值，如 `copy_latex: "Mod+Shift+C"` 之外还允许配置为 `"Mod+Alt+C"` 等非冲突组合，`focus_editor: "Mod+E"` 或 `"Alt+I"` 等显式回到输入框按键）
   - 保持对缺少新字段的旧 v3 `library.json` 零错误反序列化。
2. **保存不丢设置**：
   - 修复 `LibraryFile::from_user_library` 静默重置问题：提供 `LibraryFile::from_user_library_with_settings(library, settings)` 并让 `Store` 保存链路显式保留现有 `settings`。

### 2.2 `mathslot-app` 状态机与导出定界符契约（`D-116`）
1. **设置状态与事件**：
   - 在 `crates/mathslot-app` 为 `App` 持有当前 `AppSettings`（包含 `theme`、`delimiter_style`: `none | inline_dollar | block_dollar | code_fence`、`render_backend`: `mathjax | latex-rust`、`shortcuts`、`config_path: Option<String>`、`recovery: Option<RecoveryStateSnapshot>`），并暴露在 `EngineSnapshot.settings` / `EngineSnapshot.recovery`。
   - 新增 `UserEvent::UpdateSettings(AppSettings)`、`UserEvent::ResetSettingsConfirmed`、`UserEvent::SetRecoveryState(Option<RecoveryStateSnapshot>)`（以及按需触发配置导入/导出/恢复回调的 `AppEffect`，保持 `mathslot-app` 无直接文件 IO，仅做纯状态机 + Effect 发出 `INV-004`）。
2. **导出定界符包装**：
   - `AppCommand::ExecuteExport` / `ExecuteCopy` 根据当前 `settings.delimiter_style` 对纯 LaTeX 进行定界符格式化（`none`: 原样；`inline_dollar`: `$latex$`；`block_dollar`: `$$\nlatex\n$$`；`code_fence`: ```` ```latex\nlatex\n``` ````），同时保持诊断阻塞逻辑（有 Error 诊断时阻断导出）。

### 2.3 前端主题、`PreviewPanel` 跟随系统与快捷键配置/冲突检测（`D-117`, `D-118`, `D-119`）
1. **主题令牌修复（`D-119`）**：
   - `packages/ui/src/theme/tokens.css` 补齐 `[data-theme='light']` 显式亮色变量作用域，保证哪怕 OS 处于 `prefers-color-scheme: dark`，显式设置 `data-theme="light"` 的根/局部容器也能 100% 切回亮色。
   - `PreviewPanel.svelte` 当 `theme === 'auto'` 时订阅 `window.matchMedia('(prefers-color-scheme: dark)')`，真实解析 `'dark'` 或 `'light'` 传递给 `RenderAdapter`。
2. **可配置快捷键与冲突检测（`D-118`, `D-015`）**：
   - 新增纯 TS 模块 `packages/ui/src/settings/shortcuts.ts`：
     - 支持规范化快捷键字符串（`Mod` / `Ctrl` / `Cmd` / `Alt` / `Shift` + key）、匹配 `KeyboardEvent`、并与保留键表严格校验：
       - **禁止覆盖的保留键**：`Tab`、`Shift+Tab`、`Escape`、无修饰单字符（如 `a`、`1`、`+`）、`Enter`、`Backspace`、`Delete`、`Arrow*`、`Mod+Z`/`Mod+Shift+Z`/`Mod+Y`/`Mod+C`/`Mod+X`/`Mod+V`/`Mod+A`。
       - **动作间冲突检测**：任意两个动作绑定到同一规范化组合时返回可读中文冲突诊断列表并阻断保存/高亮错误行。
   - 改造 `packages/ui/src/editor/keymap.ts` 与 `MathSlotEditor.svelte`：接收来自配置的 `shortcuts`（支持自定义导航与动作回调：`onCopyLatex`、`onSaveSnippet`、`onToggleNav`、`onOpenSettings`、`onFocusEditor`），**永久保留 `Tab` / `Shift+Tab` / `Escape` 不锁死行为**。
3. **`SettingsPanel.svelte`（`D-117`, `D-016`, `A-DATA-001`, `A-UI-001/004`）**：
   - 提供可折叠/模态或标签页友好的精良浅色/深色设置面板：
     - **外观主题**：浅色 (`light`) / 深色 (`dark`) / 跟随系统 (`system`)；
     - **输出定界符**：无定界符 / 行内 `$...$` / 块级 `$$\n...\n$$` / 代码块 ```` ```latex ````，实时示例预览；
     - **渲染引擎**：`MathJax 3 SVG（高精度排版，默认）` vs `latex-rust（离线快速 SVG）`；
     - **快捷键配置**：全部动作列表 + 实时冲突检测与报错高亮 + **仅“恢复默认设置”带两步二次确认（`D-016`）**；
     - **配置与数据安全**：显示配置文件路径（`configPath`）、配置导入/导出按钮回调；
     - **损坏隔离恢复向导（`A-DATA-001`）**：当存在 `recovery`（`corruptPath`、`backupCandidate`、`error`）时，展示明确醒目的恢复向导区，提供“从最近备份恢复”按钮以及带二次确认的“确认重置为空配置”按钮（绝不自动静默清空用户配置）。
   - 全部交互控件基于 `tokens.css` 变量、键盘 Tab 可达、`aria-*` 标签完备。

---

## 3. TDD 验收标准（先红后绿）

1. **Rust TDD**：先新增失败测试（`crates/mathslot-store/tests/t3_4_settings_tests.rs` 或扩展、与 `crates/mathslot-app/tests/t3_4_settings_contract_tests.rs`）并观测红灯 FAIL，覆盖：
   - 旧 v3 JSON 无 `theme`/`render_backend`/`shortcuts` 反序列化保持默认且保留旧字段；
   - `from_user_library_with_settings` + round-trip 保存不丢失自定义 `theme`/`shortcuts`/`render_backend`；
   - `App` 接收 `UpdateSettings`、导出应用定界符包装且错误诊断仍阻断、`ResetSettingsConfirmed` 恢复默认、恢复状态暴露于快照。
2. **前端 Vitest TDD**：先新增失败测试（`packages/ui/tests/settings.test.ts` 与扩展 `editor.test.ts` / `preview.test.ts`）并观测红灯 FAIL，覆盖：
   - 快捷键规范化、保留键冲突拦截（`Tab` / `Shift+Tab` / `Escape` / 单字符）、双动作重复按键冲突提示；
   - `MathSlotEditor` 使用自定义快捷键触发动作同时 `Tab`/`Shift+Tab` 仍可逃离焦点；
   - `PreviewPanel` 在 `theme="auto"` + mock `matchMedia('(prefers-color-scheme: dark)').matches = true` 下向渲染器传递 `'dark'`；
   - `SettingsPanel.svelte` 主题切换、定界符与渲染引擎切换、冲突阻断保存、恢复默认二次确认、损坏恢复向导触发“从备份恢复”与“确认重置空配置”。
3. **门禁**：
   - `cargo fmt --check` PASS
   - `cargo clippy --workspace --all-targets -- -D warnings` PASS
   - `cargo test --workspace --offline` PASS（`0 failed; 0 ignored`）
   - `cd packages/ui && npm test && npm run check && npm run build` PASS
   - 单次提交，commit message 含 `T3.4` 与 `D-116 D-117 D-118 D-119 D-015 D-016`（不加方括号）。

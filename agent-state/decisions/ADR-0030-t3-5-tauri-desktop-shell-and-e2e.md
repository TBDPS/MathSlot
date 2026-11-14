# ADR-0030: Gate G3 T3.5 — `apps/desktop`（Tauri 2 + Svelte 5 + Playwright 桌面 E2E）与 `D-127..D-130` 跨层同步闭环

- **Date**: 2026-11-14
- **Round**: 28
- **Gate / Task**: `G3` / `T3.5`
- **Defects & Acceptance**: `D-127`, `D-128`, `D-129`, `D-130`, `D-008`, `D-009`, `D-015`, `D-016`, `A-UI-001..005`, `S-001..007`, `OPEN-001`, `OPEN-002`
- **Audit Reference**: `agent-state/audits/AUD-26.md`

---

## 1. 范围与允许修改路径

- **允许写入**：
  - `Cargo.toml`、`Cargo.lock`（将 `apps/desktop/src-tauri` 纳入 workspace `members`，引入 `tauri = "2"` / `tauri-build = "2"` / `tauri-plugin-dialog` 等 `crates.io` 标准依赖）
  - `crates/mathslot-store/src/lib.rs`、`crates/mathslot-store/tests/**`（新增 `restore_from_backup`、`reset_empty`、完整设置+库 JSON 导入导出与 `Settings` ↔ `AppSettings` 双向映射）
  - `crates/mathslot-app/src/**`、`crates/mathslot-app/tests/**`（暴露双向编辑器同步字段 `EngineSnapshot.source` / `editor_cursor_char` 或规范化映射、`save_snippet` `UserEvent`/`HostAction` 或事件接入、恢复完成后状态更新）
  - `packages/ui/src/**`、`packages/ui/tests/**`（修复 `D-127` CM6 ↔ `mathslot-app` 双向编辑/外部更新/退格/换行/Undo/Redo 同步；修复 `D-129` `SettingsPanel.svelte` 双派发去重）
  - `apps/desktop/**`（新建 Tauri 2 Rust 后端 `src-tauri/` + Svelte 5 精良桌面工作区前端 `src/` + Vite 构建 + Playwright 无头 Chromium E2E 套件 `tests/e2e/`）
  - `.github/workflows/ci.yml`、`.github/workflows/release.yml`（补充 Linux WebKitGTK/GTK3 `-dev` 依赖及 `apps/desktop` check/test/E2E 验证）
- **禁止修改**：
  - `xtask/**`、`catalog/**`、`src/**`、`crates/mathslot-core/**`、`crates/mathslot-command/**`、`crates/mathslot-syntax/**`、`crates/mathslot-doc/**`、`crates/mathslot-render/**`、`crates/mathslot-wasm/**`、`apps/obsidian/**`（不得破坏既有 `apps/obsidian` 测试与构建）、`obsidian-mathslot/**`、`scripts/agent/**`、`docs/**`、`agent-state/**`

---

## 2. 技术契约

### 2.1 修复 `D-127`（P1）：CM6 ↔ `mathslot-app` 单一事实源双向同步
1. **快照同步字段（`crates/mathslot-app/src/snapshot.rs`）**：
   - 在 `EngineSnapshot` 新增规范流式源码 `source: String`（从编辑器 AST/文档流式源码输出或 `self.editor` 当前 canonical stream string 导出）以及选区/光标信息（`cursor_char: usize`、`active_slot_id: Option<u32>`）。
   - 保持现有字段向后兼容（`serde(default)` 或同步更新测试 DTO）。
2. **`MathSlotEditor.svelte` 与 `keymap.ts`**：
   - `syncViewWithSnapshot(snap)` 当检测到 `snap.source !== view.state.doc.toString()` 时，通过 `view.dispatch({ changes: { from: 0, to: doc.length, insert: snap.source }, selection: ... , annotations: ... })`（带显式 sync annotation 防回环二次上行 `KeyInput`）将外部变更（预置载入、调色板卡片、`ImportLatex`、`Clear`、`Undo`、`Redo`、槽位跳转）同步进 CodeMirror 6。
   - 在 `keymap.ts` 将 `Enter`、`Backspace`、`Delete`、`Mod+Z`、`Mod+Shift+Z`/`Mod+Y` 与 `save_snippet` 正确派发到 `client.dispatch(...)`（`Enter` / `Backspace` / `Delete` / `Undo` / `Redo` 等通过 `mathslot-app` 驱动单一缓冲，`Tab`/`Shift+Tab`/`Escape` 仍保持焦点可逃逸 `D-015`；CM6 本地 `historyKeymap` 不再与 `mathslot-app` `Intent` 撤销栈分裂）。
   - 必须保证 `packages/ui` 与 `apps/obsidian` 全量测试继续 100% 通过！

### 2.2 修复 `D-129` & `D-130`（P2）：持久化原语、设置去重与双端 Render DTO 映射
1. **`crates/mathslot-store`**：
   - 增加 `Store::restore_from_backup(backup_path)`、`Store::reset_empty()`、完整 `LibraryFile` JSON 导入/导出辅助方法，以及无损 `Settings` ↔ `mathslot_app::AppSettings`（含 `delimiter_style`、`theme`、`render_backend`、`shortcuts`）双向转换与单元测试。
2. **`SettingsPanel.svelte` 去重与 `save_snippet`**：
   - 消除 `SettingsPanel.svelte:194-243` 的双触发：`SettingsPanel` 遵循单一职责——若传入对应宿主回调 `onSaveSettings` / `onRestoreBackup` / `onResetDefaults` / `onImportConfig` / `onExportConfig`，仅由回调（或统一由 `client.dispatch`）执行一次，不出现同一点击同时 `on*` + `client.dispatch` 双写。
   - 补齐 `save_snippet` 在 `mathslot-app` / `apps/desktop` 闭环（按下 `save_snippet` 快捷键或点击保存按钮将当前公式作为用户公式/片段落盘持久化）。
3. **双端渲染 DTO 映射（`D-130`）**：
   - 在 `apps/desktop/src-tauri` 实现 `render_latex_svg(latex, theme, scale_pct)` Tauri IPC command，内部调用 `mathslot_render::RenderPipeline` + `LatexRustSvgBackend`，显式把 `ErrorSummary`（`header_summary`、`source_excerpt`、`full_detail`）与 `RenderOutput` 映射为前端 `LatexRustInvokeResult`（`{ svg, degraded, diagnostics: PreviewDiagnostic[] }` 其中字段为 camelCase `code`, `severity`, `summary`, `detail`, `sourceExcerpt`, `truncated`, `hint`）。

### 2.3 构建 `apps/desktop`（Tauri 2 + Svelte 5 + 视觉美观桌面工作区，`D-128`, `OPEN-001`, `OPEN-002`）
1. **Rust 后端（`apps/desktop/src-tauri`）**：
   - 真实 Tauri 2 应用（`tauri = "2"`, `tauri-build = "2"`, `tauri-plugin-dialog = "2"`, `#![forbid(unsafe_code)]` 或安全边界无 `let _ =`/`.unwrap()`）。
   - 启动通过 `mathslot-store::Store::load_or_recover()` 加载配置，损坏时自动触发隔离队列并注入 `SetRecoveryState`；暴露完整 IPC commands：`get_snapshot`、`dispatch_event`、`get_catalog`、`get_presets`、`render_latex_svg`、`restore_backup`、`reset_empty_config`、`export_config_json`、`import_config_json`、`copy_to_clipboard`（支持桌面真实剪贴板或测试注入）、`save_user_formula`。
   - 附带丰富的 Rust 单元测试/集成测试（覆盖启动恢复、IPC dispatch、错误阻断导出、Settings 持久化、`render_latex_svg` DTO 映射与降级标志）。
2. **Svelte 5 桌面前端（`apps/desktop/src`）与界面美学要求**：
   - 统一使用 `tokens.css` 语义化颜色变量（明/暗/跟随系统实时切换，零硬编码颜色），精致专业排版布局：
     - 顶部工作栏（品牌标题、主题/设置按钮、导入 LaTeX、复制 / 导出按钮、单一主状态指示条 `§12.1`）；
     - 左侧主操作区：`MathSlotEditor` + 可切换/分栏的 `PalettePanel`（命令卡片 & 88 预置搜索与载入）；
     - 右侧实时视口：`PreviewPanel`（`MathJax 3 SVG` 主引擎 + `latex-rust` Tauri IPC 兜底切换与“降级预览”徽章 + Fit/100% 缩放 + 超宽水平滚动）+ 可折叠 `NavTreePanel`（3×3 矩阵分层导航不溢出）+ 可折叠 `DiagnosticsPanel`（一键复制诊断）；
     - `ImportModal.svelte` 与 `SettingsPanel.svelte`（快捷键自定义与冲突高亮、配置恢复向导）。
   - 同时支持浏览器无头预览/IPC Mock Harness 模式（`window.__TAURI_INTERNALS__` 存在时走真实 Tauri IPC，Playwright 浏览器测试中经 `window.__MATHSLOT_DESKTOP_BRIDGE__` 或 Vite test harness 完整驱动前端状态机），实现高保真视觉与交互全覆盖。
3. **Playwright 无头 Chromium E2E（`apps/desktop/tests/e2e/desktop.spec.ts`）**：
   - 覆盖规范 §13 / §12.5 场景：`S-001`/`A-UI-002`（超长公式预览左对齐/水平滚动与单行编辑器非伪多行）、`S-002`/`A-UI-005`（未定义命令 `▸zz` 与超长 LaTeX 错误诊断不挤占工具栏 + 折叠复制）、`S-003`/`A-UI-003`（3×3 矩阵 AST 导航不溢出）、`S-004`（降级预览徽章可见）、`S-006`/`A-UI-004`（浅色主题与深色主题切换无硬编码深色块、计算背景/前景对比度有效）、`A-UI-001`（全键盘输入、Palette 载入、Tab 焦点离开与自定义 `focus_editor` 回到输入框、导入弹窗 Error 阻断、Settings 冲突拦截与恢复向导）。
   - 生成 PNG 视觉快照至 `apps/desktop/.e2e-artifacts/`（并在 `.gitignore` 忽略临时截图产物，不污染 git 历史）。

---

## 3. TDD 验收标准（先红后绿）

1. **Red 阶段必须先观察失败**：
   - 先新增失败测试覆盖 `D-127`（CM6 外部同步 `ApplyCard` / `LoadStreamSource` / `Undo` 与 `Backspace`/`Enter`）、`D-129`（`Store::restore_from_backup` / `reset_empty` / `Settings`↔`AppSettings` / `SettingsPanel` 单次派发去重）、`D-130`（`render_latex_svg` camelCase DTO 映射与降级）、以及 `apps/desktop` E2E 骨架。
2. **门禁（全部必须绿灯）**：
   - `cargo fmt --check` PASS
   - `cargo clippy --workspace --all-targets -- -D warnings` PASS
   - `cargo test --workspace --offline` PASS（含 `mathslot-desktop`、`mathslot-store`、`mathslot-app`，`0 failed; 0 ignored`）
   - `cd packages/ui && npm test && npm run check && npm run build` PASS
   - `cd apps/obsidian && npm test && npm run check` PASS
   - `cd apps/desktop && npm test && npm run check && npm run build && npm run test:e2e` PASS（Playwright Chromium E2E 全过）
   - 单次提交，commit message 含 `T3.5` 与 `D-127 D-128 D-129 D-130 D-008 D-009 D-015 D-016`（不加方括号）。

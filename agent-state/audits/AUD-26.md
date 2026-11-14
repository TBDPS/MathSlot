---
id: AUD-26
round: 28
gate: G3
scope: "T3.5 (apps/desktop Tauri 2 + Svelte 5 + Playwright Desktop E2E) 前置就绪与跨层契约审计"
verdict: BLOCK
auditor: auditor
date: 2026-11-14
---

# MathSlot 独立审计报告 AUD-26（Round 28 / Gate G3 — T3.5 前置审计）

## 1. 判定摘要

- **综合判定：`BLOCK`（系统与工具链依赖已 `READY`；产品代码与跨层契约存在 2 项 P1、2 项 P2 阻塞待写入 ADR-0030 后实施）**
- **关键结论**：
  1. **系统构建与 E2E 环境阻断已解除**：此前 `HANDOFF.md` / `OVERNIGHT_REPORT.md` 记录的 WebKitGTK / GTK3 `-devel` 缺失已解决，Linux Tauri 2 构建依赖、Rust `1.99.1`、Playwright 缓存 Chromium、crates.io（`tauri@2.12.5`、`tauri-build@2.7.4`）与 npm registry（`@tauri-apps/api@2.12.4`、`@tauri-apps/cli@2.12.4`、`@playwright/test@1.65.1`）均已可用。
  2. **当前基线门禁全绿（不含尚未存在的 `apps/desktop`）**：`scripts/agent/acceptance.sh` 退出码 `0`（`PASS=4 FAIL=0 WARN=4`）；`packages/ui` `npm test` 退出码 `0`（`7` 文件 `29` 用例通过）。
  3. **发现 4 项 `OPEN` 缺陷（`D-127` ~ `D-130`）**：
     - **`D-127`（P1）**：`packages/ui` CodeMirror 6（`MathSlotEditor.svelte` / `keymap.ts`）与 `mathslot-app` 编辑状态双向脱节，会导致 `ApplyCard`、预置载入、`ImportLatex`、退格、`Enter`、`Undo`/`Redo` 后视图与后端引擎分叉。
     - **`D-128`（P1）**：`apps/desktop`（Tauri 2 壳、`src-tauri`、Playwright E2E、`Cargo.toml` workspace member 及 CI Linux Tauri 依赖/作业）尚未建立。
     - **`D-129`（P2）**：`mathslot-store` / `mathslot-app` / `packages/ui` 之间缺少桌面端持久化与配置闭环原语（`Store` 缺少 `restore_from_backup` / `reset_empty` 与 `Settings`↔`AppSettings` 映射；`SettingsPanel` 会对 `on*` 与 `client.dispatch` 双重触发；`save_snippet` 快捷键无对应 `AppEvent`/`HostAction`）。
     - **`D-130`（P2）**：`mathslot-render::ErrorSummary`（snake_case：`header_summary` / `source_excerpt` / `full_detail`）与 `packages/ui` `PreviewDiagnostic`（camelCase：`summary` / `sourceExcerpt` / `detail`）字段不匹配，Tauri IPC 桥接需显式 DTO 转换。

---

## 2. 逐项证据

### 2.1 环境与工具链就绪检查（原阻塞已解除）

1. **Tauri 2 Linux 系统库（`pkg-config`）**
   - 命令：`pkg-config --modversion webkit2gtk-4.1 gtk+-3.0 libsoup-3.0 javascriptcoregtk-4.1 && pkg-config --modversion librsvg-2.0`
   - 退出码：`0`
   - 尾部输出：
     ```text
     2.54.2
     3.24.52
     3.8.1
     2.54.2
     2.63.2
     ```
2. **浏览器、Node/npm 与 Playwright 缓存**
   - 命令：`which chromium-browser chromium google-chrome firefox node npm cargo-tauri; ls -la ~/.cache/ms-playwright`
   - 退出码：`0`（`chromium` / `google-chrome` / `cargo-tauri` 未在 `PATH` 中，其余均存在）
   - 尾部输出：
     ```text
     /usr/bin/chromium-browser
     /usr/bin/firefox
     /usr/bin/node
     /usr/bin/npm
     chromium-1248  chromium-1254  chromium_headless_shell-1248  chromium_headless_shell-1254  ffmpeg-1013
     ```
3. **Rust 工具链与 crates.io / npm 可达性**
   - `rustc --version; cargo --version` -> 退出码 `0`：`rustc 1.99.1 (58cf8f9c3 2026-10-13)`、`cargo 1.99.1 (5f94df478 2026-08-27)`（满足 `tauri 2.12.5` 声明的 `rust-version: 1.90`）。
   - `cargo info tauri --offline` -> 非零退出：`error: could not find 'tauri' in registry 'https://github.com/rust-lang/crates.io-index'`；`ls -la ~/.cargo/registry/cache/*/*tauri*` -> 不存在（尚未本地缓存）。
   - `cargo info tauri@2` -> 退出码 `0`：`version: 2.12.5 (latest 3.0.0-alpha.6)`，`rust-version: 1.90`。
   - `cargo info tauri-build@2` -> 退出码 `0`：`version: 2.7.4 (latest 3.0.0-alpha.4)`，`rust-version: 1.90`。
   - `npm view` -> 退出码 `0`：`@tauri-apps/api@2.12.4`、`@tauri-apps/cli@2.12.4`、`@playwright/test@1.65.1`、`playwright@1.65.1`。

### 2.2 工作区现状与基线门禁

1. **恢复脚本与当前任务状态**
   - 命令：`scripts/agent/resume.sh`
   - 退出码：`0`
   - 尾部输出：`gate=G3 round=28 active=T3.5 next=T3.5`、`branch=refactor/v1 head=98143c9 dirty=1`、`latest_audit=agent-state/audits/AUD-25.md`、`latest_verify=agent-state/verify/VER-27.md`、`new_defects=D-101..D-126`（审计前工作区存在未提交改动 `M agent-state/OVERNIGHT_REPORT.md`）。
2. **Rust 全量门禁基线**
   - 命令：`scripts/agent/acceptance.sh`
   - 退出码：`0`
   - 尾部输出：
     ```text
     PASS=4 FAIL=0 WARN=4
     (PASS: cargo fmt --check, cargo clippy -D warnings, cargo test --workspace, 调色板一致性;
      WARN: let _ = 14, unwrap() 20, 命令表常量 3, 工作区未提交 1)
     ```
3. **共享 UI（`packages/ui`）单测基线**
   - 命令：`cd packages/ui && npm test`
   - 退出码：`0`
   - 尾部输出：
     ```text
     Test Files  7 passed (7)
          Tests  29 passed (29)
     ```
4. **桌面壳与 CI 现状**
   - `Cargo.toml:2-13` workspace `members` 仅包含 `.`、`mathslot-{syntax,doc,latex,core,wasm,command,app,render,store}`、`xtask`，无 `apps/desktop/src-tauri`；`apps/` 下仅有 `apps/obsidian`。
   - `.github/workflows/ci.yml:26-36` 与 `.github/workflows/release.yml:23-33` 的 Linux 依赖安装仅含旧 `egui` 依赖（`libasound2-dev libudev-dev libwayland-dev libxkbcommon-dev libx11-dev libx11-xcb-dev`），未安装 `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev librsvg2-dev`，也未构建/测试 `apps/desktop` 或运行 Playwright E2E。

### 2.3 共享 UI / 后端 / 持久化 / 渲染契约逐项核对

- **CM6 编辑器同步与快捷键分发（`packages/ui` ↔ `mathslot-app`）**：
  - `packages/ui/src/editor/MathSlotEditor.svelte:94-103, 234-238`：`syncViewWithSnapshot(snap)` 只刷新 `navCompartment` 与 `setEngineSnapshotEffect`，从不向 CM6 `view.dispatch` 下发 `changes` 同步文本；当外部或其它面板触发 `ApplyCard`、`LoadStreamSource`、`ImportLatex`、`Clear`、`Undo`/`Redo`、`NavMode` 槽位跳转后，CM6 文档不会跟随变化。
  - `crates/mathslot-app/src/snapshot.rs:331-350`：`EngineSnapshot` 输出 `latex`、`preview_latex`、`copy_text`、`slots`、`diagnostics`，未包含编辑器原始简码 `source` 或 CM6 光标/槽位 UTF-16 偏移（`SlotSnapshot.span` 指向 `mathslot_doc` LaTeX 字节范围）。
  - `packages/ui/src/editor/keymap.ts:173-190`：`Enter` 直接 `return false` 未发送至后端；`Backspace` / `Delete` / 方向键等非单字符键未发送 `KeyDown` 给 `mathslot-app`；CM6 `history()` 与 `historyKeymap` 在本地处理 `Mod+Z`/`Mod+Shift+Z` 而未调用 `client.dispatch('Undo'|'Redo')`。
- **导出 / 复制与防静默降级契约**：
  - `crates/mathslot-app/src/app.rs:491-520` 与 `crates/mathslot-app/tests/t3_4_settings_contract_tests.rs:110-169`：`RequestExport { strict: true }` 在存在 `Error` 诊断时阻断（`AppError::StrictExportBlocked`），`RequestCopy` 采用 `strict: false` 输出带显式 `\text{▸...}` 占位符与定界符的 `Effect::Clipboard`；`PreviewPanel.svelte:280-296` 已分别暴露 `onCopyLatex` 与 `onExportLatex?.(true)`。
- **持久化、备份恢复与配置映射（`mathslot-store` ↔ `mathslot-app` ↔ `SettingsPanel`）**：
  - `crates/mathslot-store/src/lib.rs:228-240` `Settings.delimiter_style` 为 `Option<String>`，而 `crates/mathslot-app/src/snapshot.rs:316-329` `AppSettings.delimiter_style` 为 `DelimiterStyle` 枚举，两 crate 之间尚无共享映射函数。
  - `crates/mathslot-store/src/lib.rs:943-1022` `Store` 提供 `load` / `save_user_library` / `save_file`，缺少桌面壳所需的 `restore_from_backup`、`reset_empty` 与完整配置 JSON 导入/导出辅助方法（`import_formulas_json` 仅导入公式列表）。
  - `crates/mathslot-app/src/app.rs:555-561`：`AppCommand::RequestRestoreBackup` 仅发出 `Effect::Host(HostAction::RestoreBackup { backup_path })`，不会自行重置 `self.recovery`。
  - `packages/ui/src/settings/SettingsPanel.svelte:194-243`：`handleSave`、`handleConfirmResetDefaults`、`handleRestoreBackup`、`handleConfirmResetEmpty`、`handleImport`、`handleExport` 均**顺序执行** `await on*(...)` 与 `await client.dispatch(...)`（双触发风险）。
  - `crates/mathslot-app/src/snapshot.rs:282`、`packages/ui/src/settings/shortcuts.ts:26`、`packages/ui/src/editor/keymap.ts:121-125`：定义了 `save_snippet`（`Mod+Shift+S`），但 `crates/mathslot-app/src/effect.rs:7-24` `HostAction` 及 `AppEvent` 无对应的保存自定义公式/片段事件。
- **双后端 SVG 渲染桥接（`mathslot-render` ↔ `packages/ui`）**：
  - `crates/mathslot-render/src/error.rs:60-67`：`ErrorSummary` 使用 `header_summary`、`source_excerpt`、`full_detail`（snake_case）；`packages/ui/src/preview/renderAdapter.ts:30-39, 227-264`：`PreviewDiagnostic` 期望 `summary`、`sourceExcerpt`、`detail`（camelCase）。

### 2.4 静默失败与测试弱化扫描

- 命令：`rg -n 'let _\s*=|\.unwrap\(|#\[ignore|#\[allow|test\.skip|it\.skip|describe\.skip' crates/mathslot-app/ crates/mathslot-store/ crates/mathslot-render/ packages/ui/src/ packages/ui/tests/ ; echo "EXIT=$?"`
- 退出码：`0`
- 输出：
  ```text
  crates/mathslot-store/tests/data_safety_tests.rs
  493:                    .unwrap()
  EXIT=0
  ```
  - 核查：`crates/mathslot-app/src/`、`crates/mathslot-store/src/`、`crates/mathslot-render/src/`、`packages/ui/src/`、`packages/ui/tests/` 内 **0 处** `let _ =`、**0 处** `#[ignore]` / `#[allow]` / `.skip(`、**0 处**产品 `.unwrap()`；唯一命中仅在测试文件 `crates/mathslot-store/tests/data_safety_tests.rs:493`。

---

## 3. 新发现（D-127 ~ D-130）

### [OPEN] D-127 (P1) — `packages/ui` CM6 (`MathSlotEditor.svelte` / `keymap.ts`) 与 `mathslot-app` 编辑状态双向脱节

- **状态**：`OPEN`（阻断 T3.5 `S-001` / `S-002` / `S-004` / `A-UI-001` 真闭环）
- **位置**：
  - `packages/ui/src/editor/MathSlotEditor.svelte:94-103, 234-238`
  - `packages/ui/src/editor/keymap.ts:173-190`
  - `crates/mathslot-app/src/snapshot.rs:331-350`
- **核验命令与结果**：
  - 命令：`rg -n "KeyInput|LoadStreamSource|ApplyCard|onCopy|onExportLatex|RequestCopy|RequestExport" apps/obsidian/src/ packages/ui/src/preview/PreviewPanel.svelte`（退出码 `0`）+ 直接阅读上述源码行。
  - 事实：`MathSlotEditor.svelte:94-103` 中 `syncViewWithSnapshot` 未向 CM6 派发文档文本 `changes`；`keymap.ts:173-190` 中 `Enter`、`Backspace`/`Delete`、`Mod+Z`/`Mod+Shift+Z` 未路由到 `client.dispatch(...)`，且 CM6 `history()` 会在本地修改文本而后端 `mathslot-app::Editor` 不知情；`EngineSnapshot`（`snapshot.rs:331-350`）亦缺少同步编辑器文本所需的 `source` 与 CM6 偏移映射。
- **修复建议**：在 `ADR-0030` 明确单一权威缓冲归属（由 `mathslot-app` 或同步协议驱动 CM6 文档/选区），补齐退格/删除/换行/撤销重做/外部载入（预置、Palette、ImportLatex）双向同步测试。

### [OPEN] D-128 (P1) — `apps/desktop`（Tauri 2 + Svelte 5 + Playwright E2E）尚未建立且未纳入 Workspace/CI

- **状态**：`OPEN`（T3.5 核心交付物缺失）
- **位置**：
  - `apps/`（仅存在 `apps/obsidian`）
  - `Cargo.toml:2-13`（workspace `members` 未含 `apps/desktop/src-tauri`）
  - `.github/workflows/ci.yml:26-36`、`.github/workflows/release.yml:23-33`
- **核验命令与结果**：
  - 命令：`cargo info tauri@2`（退出码 `0`，`2.12.5`）、`pkg-config --modversion webkit2gtk-4.1 gtk+-3.0 libsoup-3.0 javascriptcoregtk-4.1`（退出码 `0`）、查阅 `Cargo.toml:2-13` 与 `.github/workflows/ci.yml:26-36`。
  - 事实：`apps/desktop` 目录不存在；Linux CI 未安装 Tauri 2 WebKitGTK/GTK3 开发库，也未包含 `apps/desktop` 的 Rust 测试/构建和 Playwright E2E（`S-001..S-007`）。

### [OPEN] D-129 (P2) — 桌面端 Persistence / Settings / Snippet 桥接契约缺失与双派发隐患

- **状态**：`OPEN`
- **位置**：
  - `crates/mathslot-store/src/lib.rs:228-240, 943-1022`（无 `restore_from_backup` / `reset_empty` / 全配置导入导出 / `Settings`↔`AppSettings` 转换）
  - `crates/mathslot-app/src/app.rs:555-561`（`RequestRestoreBackup` 不清理 `recovery`，无统一回灌接口）
  - `packages/ui/src/settings/SettingsPanel.svelte:194-243`（同时调用 `on*` 回调与 `client.dispatch`）
  - `crates/mathslot-app/src/snapshot.rs:282`、`crates/mathslot-app/src/effect.rs:7-24`、`packages/ui/src/editor/keymap.ts:121-125`（`save_snippet` 快捷键在 `mathslot-app` 无对应事件/动作）
- **核验命令与结果**：
  - 命令：`rg -n "save_snippet|SaveSnippet|RequestCopy|strict|export_latex" crates/mathslot-app/ packages/ui/src/ packages/ui/tests/`（退出码 `0`）+ 阅读 `SettingsPanel.svelte:170-244`、`mathslot-store/src/lib.rs:228-245, 943-1022`、`effect.rs:1-52`、`app.rs:545-585`。
  - 事实：`SettingsPanel.svelte:194-243` 若同时传入 `client` 与 `onSaveSettings` / `onRestoreBackup` / `onResetDefaults` / `onImportConfig` / `onExportConfig`，一次点击会触发双份副作用；`Store` 尚缺对应 `HostAction::RestoreBackup` 与 `HostAction::ResetEmptyConfig` 的库级原语。

### [OPEN] D-130 (P2) — `mathslot-render::ErrorSummary` 与 `packages/ui` `PreviewDiagnostic` 字段命名不一致

- **状态**：`OPEN`
- **位置**：
  - `crates/mathslot-render/src/error.rs:60-67`（`header_summary`、`source_excerpt`、`full_detail`）
  - `packages/ui/src/preview/renderAdapter.ts:30-39, 227-264`（`summary`、`sourceExcerpt`、`detail`）
- **核验结果**：直接对比源码确认二者字段名与结构不同，且 `RenderOutput`（`crates/mathslot-render/src/types.rs:58-66`）使用 `output: RenderData::Svg(String)`，与 `createLatexRustBridgeAdapter` 约定的 `{ svg, degraded?, diagnostics? }` 不直接兼容；Tauri `invoke('render_latex_svg', ...)` 必须定义显式响应 DTO 与映射测试。

---

## 4. 历史结论抽查（2 项核验）

1. **抽查对象 1 — `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:29`**：
   - 历史宣称：`"所有核心 crate 均包含 #![forbid(unsafe_code)]"`。
   - 实测命令：`rg -n "forbid\(unsafe_code\)" Cargo.toml src/ crates/*/src/lib.rs`（退出码 `0`）并读取 `crates/mathslot-command/src/lib.rs:1-25`。
   - 结论：**不实（遗漏 crate）**。`src/main.rs:1` 与 `crates/mathslot-{app,core,render,latex,store,wasm,syntax,doc}/src/lib.rs:1` 确有 `#![forbid(unsafe_code)]`，但 `crates/mathslot-command/src/lib.rs:1-25` 未声明 `#![forbid(unsafe_code)]`。
2. **抽查对象 2 — `docs/AUDIT_ROUND_11_INLINE_WORKSPACE_AND_ZERO_MODAL.md:39-40`**：
   - 历史宣称：`"业务运行路径全量使用 match / if let / unwrap_or_default，仅测试模块保留断言 unwrap"`，且 `"docs/ 位于根目录 .gitignore，git status --ignored 明确列在忽略清单"`。
   - 实测命令：`rg -n "\.unwrap\(" src/ crates/*/src/`、`git ls-files docs/ | wc -l`、`rg -n "docs" .gitignore`（退出码 `0`）。
   - 结论：**两项均不实**。
     - `crates/mathslot-doc/src/document.rs:651,824,847`、`crates/mathslot-syntax/src/parser.rs:91,126,200,205,411,441,481,645,680,726,771,884`、`crates/mathslot-syntax/src/lexer.rs:284` 仍存在产品代码 `.unwrap()`；
     - `DOCS_TRACKED=60`，且 `.gitignore:8` 明确注释 `# docs/ 是审计与验收证据，必须进版本库；不要忽略。`。

---

## 5. 建议的下一步与 ADR-0030 范围

由于 `AGENTS.md` 第 1 条/第 2 条要求"一轮一个任务"且 T3.5 涉及跨 crate 契约补齐（`D-127` ~ `D-130`），建议 coordinator 先签署 **`ADR-0030`** 再分派 `implementer`：

1. **`ADR-0030` 建议设计范围**：
   - **修复 `D-127`（CM6 ↔ `mathslot-app` 同步）**：在 `mathslot-app::EngineSnapshot` 暴露只读编辑同步字段（`source` 与编辑器选区/槽位字节偏移或字符偏移），改造 `MathSlotEditor.svelte` 与 `keymap.ts` 使 `KeyDown`（退格/删除/换行/撤销重做）与外部状态变更（预置/Palette/`ImportLatex`/`Clear`）与 `mathslot-app` 保持单一事实源同步，先补失败测试再修复。
   - **补齐 `D-129` / `D-130` 跨层契约**：
     - 在 `mathslot-store` 增加 `Store::restore_from_backup`、`Store::reset_empty`、完整配置+用户库 JSON 导出/导入，以及 `Settings` ↔ `mathslot_app::AppSettings` 的无损双向映射；
     - 消除 `SettingsPanel.svelte:194-243` 双重触发（当提供 `client` 时优先通过 `client.dispatch` 驱动 `Effect::Host` 或显式约定回调去重）；明确 `save_snippet` 的 `AppEvent` / `HostAction` 或宿主回调契约；
     - 在 `apps/desktop/src-tauri` 定义 `render_latex_svg` Tauri command DTO，将 `mathslot-render::RenderOutput` / `ErrorSummary` 映射为 `packages/ui` `LatexRustInvokeResult` / `PreviewDiagnostic`。
   - **构建 `apps/desktop` 并落盘双重验证（`D-128`）**：
     - `apps/desktop/src-tauri`：真实 Tauri 2 Rust 后端（`AppState` 持有 `Mutex<App>` + `Store` + `RenderPipeline`/`LatexRustSvgBackend`），提供 `dispatch_event` / `get_snapshot` / `engine_version` / `render_latex_svg` / 文件对话框与剪贴板 / 启动 `load_or_recover` 与恢复/导入导出闭环，并附带 `cargo test -p mathslot-desktop` 与 `cargo build -p mathslot-desktop`（及 `Cargo.toml` workspace member 注册）；
     - `apps/desktop` 前端：Vite + Svelte 5 复用 `@mathslot/ui` 全部面板、MathJax 3 SVG 主渲染 + `createLatexRustBridgeAdapter` Tauri IPC 兜底、88 预置工作区、LaTeX 导入（含 `A-OBS-005` 错误阻断）、`Tab`/`Shift+Tab`/`Escape` 焦点逃逸与可配置快捷键（`D-015`/`D-118`）、深浅/高对比主题无硬编码色块（`A-UI-004`）；
     - **Playwright Desktop E2E（覆盖 `S-001`..`S-007` 与 `A-UI-001`..`A-UI-005`）**：使用已缓存 Chromium（`~/.cache/ms-playwright`）运行无头 E2E 套件并留存截图/断言证据（针对构建后的 `apps/desktop` Svelte 5 界面 + 完整 IPC harness；在支持系统上同时验证 `cargo build -p mathslot-desktop`）。
     - **CI/门禁更新**：在 `.github/workflows/ci.yml`（及按需 `release.yml`）补充 Tauri 2 Linux `-dev` 系统依赖与 `apps/desktop` 构建/E2E 门禁（`D-023` 一致性）。
2. **建议允许写路径（写进 `ADR-0030`）**：
   - `Cargo.toml`、`Cargo.lock`
   - `crates/mathslot-app/**`、`crates/mathslot-store/**`
   - `packages/ui/**`
   - `apps/desktop/**`
   - `.github/workflows/ci.yml`、`.github/workflows/release.yml`（以及如需将前端/E2E 纳入 `scripts/agent/acceptance.sh`，另行在 ADR 中写明）

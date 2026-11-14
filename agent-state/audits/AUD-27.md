---
id: AUD-27
round: 30
gate: G3
scope: T3.7 (Feature Parity Alignment - Desktop vs Obsidian)
verdict: BLOCK
auditor: auditor
date: 2026-11-14
base_commit: 8947493
---

# AUD-27: Gate G3 / T3.7 双端功能清单对齐只读审计报告

## 1. 审计结论总览（Verdict: **BLOCK**）

依据 `docs/LLM_IMPLEMENTATION_SPEC.md` §2（`INV-001`..`INV-016`）、§8–§13（`A-EDIT-*`, `A-RENDER-005`, `A-DATA-*`, `A-OBS-001..005`, `A-UI-001..005`, `S-001..S-007`）、§14（`T3.7` 及 G3 退出条件 `desktop_e2e`, `obsidian_e2e`, `feature_parity`），对 `/home/mat/Projects/mathslot-next`（分支 `refactor/v1`，提交 `8947493`）执行全量只读命令验证、构建产物字节/符号核查及逐项双端代码对照。

- **裁定结果**：**`BLOCK`**（存在 **2 项 P1 阻断级缺陷** `D-131`, `D-132`，**4 项 P2 缺陷** `D-133`~`D-136`，以及 **1 项 P3 硬化项** `D-137`）。
- **核心阻断原因**：
  1. **Obsidian 已提交产物严重过时（`D-131`, P1）**：`obsidian-mathslot/main.js` 与 `obsidian-mathslot/styles.css` 最后提交于 `3a22824`（2026-11-14 16:21），未包含 `T3.5` 提交 `7f42d74` 与 `d441512` 对 `packages/ui/src/{editor/keymap.ts, editor/MathSlotEditor.svelte, preview/PreviewPanel.svelte, settings/SettingsPanel.svelte}` 的修复。实测 `obsidian-mathslot/main.js` 仍缺少 `externalSyncAnnotation`、`KeyDown` 派发、`lastKeydownInputChar` 竞争修复与 `RequestSaveSnippet`，导致 Obsidian 插件产物仍携带 `D-127` 双向脱节缺陷。
  2. **Obsidian 设置保存/恢复默认未同步到运行时引擎（`D-132`, P1）**：`apps/obsidian/src/AppShell.svelte:169-177, 254-255` 向 `SettingsPanel` 传入了 `onSaveSettings` / `onResetDefaults`，触发 `SettingsPanel.svelte:194-215` 的短路分支（跳过 `client.dispatch({ UpdateSettings })` / `'ResetSettingsConfirmed'`），且 `AppShell.svelte` 仅写入 `plugin.persisted.settings` 而不更新实时 `WasmEngineClient` 快照。用户在打开的弹窗内保存主题、分隔符或快捷键后，实时编辑器、主题属性与设置面板状态均不生效，直到关闭重开弹窗。
  3. **多处双端交互与验收未对齐（`D-133`~`D-136`, P2）**：Obsidian `AppShell` 缺失 `onImportConfig` / `onExportConfig`（按钮点击静默无效）、缺失 `onExportLatex` 与严格导出阻断、缺失 `onSaveSnippet` / `onFocusEditor` 与全局快捷键监听、`ImportModal` 成功导入后立即关闭弹窗无法审阅 round-trip diff；双端均未将 `PreviewPanel.onRenderResult` 接到 `DiagnosticsPanel.renderDiagnostics`（`A-RENDER-005`）；`render_backend`、`preview_scale_pct` 与 `user_formulas` 存在 UI 缺口；缺失 `obsidian_e2e` 浏览器/移动端（390px）端到端测试与机器可校验的 `feature_parity` 门禁。

---

## 2. 全量门禁与单测实跑证据

以下所有命令均在提交 `8947493` 上以只读方式实跑完成（`git status --short` 运行前后均为空，未修改任何受控文件）：

| 检查项 | 精确命令 | Exit Code | 尾部关键输出 |
|---|---|---|---|
| 状态恢复 | `scripts/agent/resume.sh` | `0` | `gate=G3 round=29 active=T3.7 next=T3.7`, `branch=refactor/v1 head=8947493 dirty=0` |
| Rust 全工作区门禁 + Palette + xtask | `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace --offline && python3 scripts/agent/audit_palette.py && cargo run -p xtask -- check --offline` | `0` | `cargo test` 全 crate 0 failed / 0 ignored；`audit_palette.py`: `PASS：所有可映射卡片与命令目录一致`（12 张卡片、109 条子菜单 + 5 条直接符号）；`xtask check`: `All 6 artifacts are up-to-date and clean.` |
| 共享 UI 单测与类型检查 | `cd packages/ui && npm test && npm run check` | `0` | `Test Files 7 passed (7), Tests 35 passed (35)`; `svelte-check found 0 errors and 0 warnings` |
| Obsidian 集成单测与类型检查 | `cd apps/obsidian && npm test && npm run check` | `0` | `Test Files 1 passed (1), Tests 10 passed (10)`; `svelte-check found 0 errors and 0 warnings` |
| Desktop 单测与类型检查 | `cd apps/desktop && npm test && npm run check` | `0` | `Test Files 1 passed (1), Tests 3 passed (3)`; `svelte-check found 0 errors and 0 warnings` |
| Desktop Playwright E2E | `cd apps/desktop && npm run test:e2e` | `0` | `5 passed (11.2s)`（覆盖 `S-001`..`S-007`、`A-UI-001`..`A-UI-005`） |
| Obsidian 构建产物符号核查 | `node -e "const fs=require('fs'); const js=fs.readFileSync('obsidian-mathslot/main.js','utf8'); for(const k of ['beforeinput','insertText','KeyDown','RequestSaveSnippet','externalSyncAnnotation','lastKeydownInputChar','onImportConfig','onExportConfig','RequestImportConfig','RequestExportConfig']) console.log(k, js.includes(k));"` | `0` | `beforeinput true`, `insertText true`, `KeyDown false`, `RequestSaveSnippet false`, `externalSyncAnnotation false`, `lastKeydownInputChar false`, `onImportConfig true`, `onExportConfig true`, `RequestImportConfig true`, `RequestExportConfig true` |
| 静默失败与削弱测试扫描 | `rg -n "let _\s*=|\.unwrap\(|#\[ignore|#\[allow|\.skip\(" apps/ packages/ui/src/ packages/ui/tests/ crates/mathslot-{app,store,render,wasm}/src/` | `0` | 仅命中 `crates/mathslot-store/src/lib.rs:667`（`existing.into_iter().skip(retention)` 迭代器方法），**0** 处 `let _ =`、**0** 处产品 `.unwrap()`、**0** 处 `#[ignore]`/`#[allow]`/测试 `.skip()` |

---

## 3. Desktop vs Obsidian 双端功能对齐矩阵

状态分类说明：
- **`ALIGNED`**：双端共用同一实现或契约等价，行为与规范一致。
- **`INTENTIONAL_DIFF`**：受宿主环境约束存在有意差异，且有明确代码/文档依据。
- **`GAP / DEFECT`**：功能缺失、产物过时或跨端不一致，对应下文新缺陷 `D-131`~`D-137`。

### 3.1 核心引擎与目录（INV-001 / INV-006）

| 子项 | Desktop 证据 | Obsidian 证据 | 状态 | 说明 |
|---|---|---|---|---|
| `121` 条命令 & `88` 条预置单一事实源 | `packages/ui/src/generated/catalog.ts:28, 1408-1528` (`COMMANDS` 0..120 = 121 条); `packages/ui/src/generated/presets.ts:27, 823-910` (`PRESETS` 0..87 = 88 条); `apps/desktop/src-tauri/src/lib.rs:216-365` | 共用 `packages/ui/src/generated/{catalog,presets}.ts`；WASM 侧 `crates/mathslot-wasm/src/lib.rs:65-99, 117-128` 导出 `catalog_json` / `presets_json` | `ALIGNED` | `cargo run -p xtask -- check --offline` 校验全部生成产物一致且无 diff。 |
| `Engine` / `mathslot-app` 事件与快照流 | `apps/desktop/src-tauri/src/lib.rs:280-365` (`DesktopBackend` 持有 `mathslot_app::App`)，`apps/desktop/src/lib/desktopClient.ts:61-63, 821` (`isTauriEnvironment()` 时调用 `createTauriHostBridge()`) | `crates/mathslot-wasm/src/lib.rs:103-116` (`WasmEngine` 封装 `mathslot_app::App`)，`apps/obsidian/src/wasmClient.ts:53` (`EXPECTED_ENGINE_VERSION = '0.7.0+schema1'`) | `ALIGNED`（真实运行时） | Desktop 原生壳与 Obsidian WASM 壳均由 `mathslot-app::App` 驱动。 |
| Desktop Browser E2E Harness（非 `__TAURI_INTERNALS__`） | `apps/desktop/src/lib/desktopClient.ts:61-63, 109-274, 276-828` (`isTauriEnvironment() ? createTauriHostBridge() : createBrowserHarnessBridge()`)；`agent-state/decisions/ADR-0030-t3-5-tauri-desktop-shell-and-e2e.md` | Obsidian 始终运行真实 WASM (`apps/obsidian/src/wasmClient.ts`) | `INTENTIONAL_DIFF` / **P3 (`D-137`)** | 经核查，`createBrowserHarnessBridge` 严格仅在 `!isTauriEnvironment()`（`window.__TAURI_INTERNALS__` 缺失，即 `vite preview` + Playwright E2E）时启用，符合 `ADR-0030`；但其在 `src/lib/desktopClient.ts:115-269` 内实现了 JS 版 `parseSlotsFromLatex`、`expandStreamSourceSimple` 与 `checkBalancedLatex`，导致 `desktop.spec.ts` 当前测的是 JS 模拟引擎而非 Rust/WASM 引擎（见 `D-137`）。 |

### 3.2 编辑器交互（`A-EDIT-*`, `A-UI-001..002`, `D-127`）

| 子项 | Desktop 证据 | Obsidian 证据 | 状态 | 说明 |
|---|---|---|---|---|
| CM6 编辑器、`▸` 流式直达、`Enter` 多行、`Undo`/`Redo` | `packages/ui/src/editor/MathSlotEditor.svelte:69, 95-127` (`externalSyncAnnotation`)；`packages/ui/src/editor/keymap.ts:48-115, 215-217, 259-264` (`lastKeydownInputChar` + `beforeinput`/`KeyDown`)；`apps/desktop/tests/e2e/desktop.spec.ts` 通过 | `apps/obsidian/src/AppShell.svelte:296-310` 引用同一 `<MathSlotEditor>`，但已提交产物 `obsidian-mathslot/main.js`（3,480,305 bytes，提交于 `3a22824`）经 Node 核查 `KeyDown: false`、`externalSyncAnnotation: false`、`lastKeydownInputChar: false` | **`GAP / DEFECT` (`D-131`, P1)** | 源码层共用同一组件，但 `T3.5`（`7f42d74` + `d441512`）后未重新运行 `obsidian-mathslot/scripts/build.mjs`，已提交的 Obsidian 插件产物仍存在 `D-127` 缺陷！ |
| `Tab` / `Shift+Tab` / `Escape` 焦点逃逸（`D-015`） | `packages/ui/src/editor/keymap.ts:127-137, 182`；`apps/desktop/src/App.svelte:273-291` | `packages/ui/src/editor/keymap.ts:127-137, 182`；**缺失**：`apps/obsidian/src/AppShell.svelte` 无 `<svelte:window onkeydown>` 处理（Settings/Import 弹窗的全局 `Escape` 关闭依赖各自子组件或浏览器行为，且 `AppShell.svelte` 未传入 `onFocusEscape`） | **`GAP / DEFECT` (`D-133`, P2)** | 编辑器内 `Tab`/`Shift+Tab` 逃逸共用 `keymap.ts`，但 Obsidian 缺少壳级 `<svelte:window>` 全局 `Escape` / 快捷键调度。 |
| `Mod+E` 回到编辑器（`focus_editor`） | `packages/ui/src/settings/shortcuts.ts:33-37`；`packages/ui/src/editor/MathSlotEditor.svelte:215-216, 259-263`；`apps/desktop/src/App.svelte:305-311`（先关弹窗再聚焦编辑器） | `apps/obsidian/src/AppShell.svelte:296-310` 未传入 `onFocusEditor`，且无 `<svelte:window onkeydown>` 监听 `focus_editor` / `open_settings` / `toggle_nav` | **`GAP / DEFECT` (`D-133`, P2)** | 在 Obsidian 设置/导入弹窗或调色板中按 `Mod+E` 无法像 Desktop 那样自动关闭弹窗并聚焦编辑器。 |

### 3.3 调色板、搜索与结构导航树（`A-UI-003`）

| 子项 | Desktop 证据 | Obsidian 证据 | 状态 | 说明 |
|---|---|---|---|---|
| 12 张高频卡片、搜索、分类与 121/88 切换 | `packages/ui/src/palette/paletteModel.ts:36-100` (`D001_FEATURED_IDS`, `getFeaturedCommands()`, `filterCommands()`, `filterPresets()`)；`packages/ui/src/palette/PalettePanel.svelte:45, 136, 181-321`（12 张卡片 + 121 条命令 + 88 条预置） | `apps/obsidian/src/AppShell.svelte` 共用 `<PalettePanel>` | `ALIGNED` | 两端复用完全一致的 `PalettePanel` 与 `paletteModel`（注意：12 张卡片顺序为 `D001_FEATURED_IDS` 静态策展顺序，非动态频率计数排序，双端一致）。 |
| 3×3 矩阵结构导航树（`A-UI-003`） | `packages/ui/src/nav/NavTreePanel.svelte:11-435`；`apps/desktop/src/App.svelte:556`；`desktop.spec.ts` 第 2 条断言 3×3 矩阵 9 槽不溢出 | `apps/obsidian/src/AppShell.svelte:330` 共用 `<NavTreePanel>` | `ALIGNED` | 结构导航树组件、槽位路径跳转与键盘导航完全共用。 |
| 响应式宽度与移动端 / 窄屏断点（480px） | `apps/desktop/src/styles.css:209-213`（`@media (max-width: 960px)` 折叠双栏为单栏，依赖共享组件 `@media (max-width: 480px)`） | `apps/obsidian/src/MathSlotModal.ts` 挂载 `Platform.isMobile`；`apps/obsidian/src/AppShell.svelte:182` (`class:is-mobile={isMobile}`)；`apps/obsidian/src/styles.css:112-114, 138-158`（`.is-mobile` 与 `@media (max-width: 480px)`）；`packages/ui/src/{nav/NavTreePanel.svelte:425, import/ImportModal.svelte:476}` | `INTENTIONAL_DIFF` / **`GAP` (`D-136`)** | 桌面端以 `@media (max-width: 960px)` 为主断点，Obsidian 额外处理 `Platform.isMobile` 与弹窗窄屏（符合桌面窗口 vs 移动 Vault 约束）；但 Obsidian 480px/390px 移动端布局目前仅靠 css 与 jsdom 验证，无真浏览器 Playwright E2E（`D-136`）。 |

### 3.4 实时预览与降级诊断（`A-RENDER-005`, `A-UI-005`）

| 子项 | Desktop 证据 | Obsidian 证据 | 状态 | 说明 |
|---|---|---|---|---|
| 主/备渲染策略 | `apps/desktop/src/App.svelte:79-100` & `apps/desktop/src-tauri/src/lib.rs:571-673, 734`: MathJax 3 SVG 主渲染 + `latex-rust` Tauri IPC 离线 SVG 回退 | `apps/obsidian/src/AppShell.svelte:101-109` & `apps/obsidian/src/hostRenderAdapter.ts:11-37`: 宿主 `MarkdownRenderer.renderMath` + `finishRenderMath` 主渲染 + `createMathJaxSvgAdapter` 回退 | `INTENTIONAL_DIFF` | Desktop 拥有本地 Rust 进程可运行 `latex-rust`；Obsidian 插件运行于宿主 Renderer（WASM + WebView），优先使用宿主 `renderMath`（遵循 SPEC §9/§11）。 |
| `<mjx-merror>` / 降级检查 | `packages/ui/src/preview/renderAdapter.ts` 检测 `<merror>` / `data-mjx-error` 并置 `degraded=true` | `apps/obsidian/src/hostRenderAdapter.ts` + `apps/obsidian/src/plugin.ts:233-255`（代码块处理器同样检测 `<mjx-merror>` 与异常回退降级徽章） | `ALIGNED` | 弹窗与阅读模式代码块均显式捕获错误节点并标记降级。 |
| `ErrorSummary` → `DiagnosticsPanel` 联动与可复制/折叠 | `apps/desktop/src/App.svelte:520-534, 587-591`: `<PreviewPanel>` **未传** `onRenderResult`，`<DiagnosticsPanel>` **未传** `renderDiagnostics`；`PreviewPanel.svelte:222-230` 仅展示截断至 120 字符的 `headerSummaryText`，无复制或折叠按钮；`DiagnosticsPanel.svelte:198-202` 有复制按钮但收不到渲染错误 | `apps/obsidian/src/AppShell.svelte:312-325`: `<PreviewPanel>` **未传** `onRenderResult`，`<DiagnosticsPanel>` **未传** `renderDiagnostics` | **`GAP / DEFECT` (`D-134`, P2)** | 双端均漏接 `PreviewPanel.onRenderResult` 到 `DiagnosticsPanel.renderDiagnostics`！仅在渲染阶段触发的 `PRIMARY_RENDER_FAILED` / `LATEX_RUST_ERROR` / `MATHJAX_TEX_ERROR` 诊断无法进入 `DiagnosticsPanel` 实现可展开详情与一键复制（`A-RENDER-005`、`A-UI-005`）。 |
| 严格导出（`RequestExport { strict }`） | `apps/desktop/src/App.svelte:137-147, 531-533` 传入 `onExportLatex={(strict) => applyDispatch({ RequestExport: { strict } })}` | `apps/obsidian/src/AppShell.svelte:141-161, 312-319` 未传 `onExportLatex`；`handleCopy` 与 `handleInsert` 直接取 `snapshot.copy_text \|\| snapshot.latex`，绕过引擎 `strict` 诊断阻断 | **`GAP / DEFECT` (`D-133`, P2)** | Obsidian 缺失预览区严格导出按钮，且复制/插入未按严格导出校验未闭合/空槽错误。 |

### 3.5 设置、主题、持久化与故障恢复（`A-UI-004`, `A-OBS-004`）

| 子项 | Desktop 证据 | Obsidian 证据 | 状态 | 说明 |
|---|---|---|---|---|
| `delimiter_style`、`shortcuts` 冲突检测 | `packages/ui/src/settings/SettingsPanel.svelte:56-58, 94-97, 434-514`；`apps/desktop/src/App.svelte:207-210` (`applyDispatch({ UpdateSettings })`) | `apps/obsidian/src/plugin.ts:102` 仅在打开弹窗时 `UpdateSettings`；`AppShell.svelte:169-177, 254-255` 在保存/重置时仅调 `onPersistSettings` 而**未**派发到 `client` | **`GAP / DEFECT` (`D-132`, P1)** | 弹窗打开期间在 Obsidian 修改设置并保存后，`snapshot.settings`（主题/快捷键/格式）不更新。 |
| `theme`（Light / Dark / Auto） | `packages/ui/src/theme/tokens.css:2-180` (`[data-theme='light'|'dark']` + `prefers-color-scheme`)；`apps/desktop/src/App.svelte:355-356` (`data-host="desktop"`) | `packages/ui/src/theme/tokens.css:266-360` (`.mathslot-obsidian-host` / `[data-host='obsidian']` 继承 `--background-*` / `--interactive-accent` / `--text-*`)；`apps/obsidian/src/AppShell.svelte:183-184` (`data-host="obsidian"`) | `INTENTIONAL_DIFF`（样式映射） + **`GAP` (`D-132`)** | 令牌映射机制合理且已实现浅色跟随（`A-OBS-001`、`A-UI-004`），但弹窗内切换主题后因 `D-132` 不会立即刷新 `data-theme`。 |
| `render_backend` 选项差异 | `apps/desktop/src-tauri/src/lib.rs:143-183` 支持切换 `mathjax` / `latex-rust` | `packages/ui/src/settings/SettingsPanel.svelte:121-136, 405-415` 在 Obsidian 也无条件显示 `latex-rust` 单选按钮，而 `AppShell.svelte:101-109` 实际忽略该选项并始终用宿主 `renderMath` | **`GAP / DEFECT` (`D-135`, P2)** | Obsidian 端应禁用/隐藏或标注 `latex-rust` 仅桌面端可用，避免用户切换后无任何效果。 |
| `preview_scale_pct` 预览缩放配置 | `crates/mathslot-app/src/snapshot.rs:328` 存在字段；`SettingsPanel.svelte:60` 仅透传；`PreviewPanel.svelte:55, 316` 硬编码 `zoomScale = $state(1.0)` | 同左（共用 `SettingsPanel` 与 `PreviewPanel`） | **`GAP / DEFECT` (`D-135`, P2)** | 设置面板无 `preview_scale_pct` 控件，且 `PreviewPanel` 未绑定持久化缩放比例。 |
| 配置导入/导出、备份恢复、Reset Empty 与损坏向导 | `apps/desktop/src-tauri/src/lib.rs:366-507`；`apps/desktop/src/App.svelte:217-237, 683-688` 完整接入 `onImportConfig` / `onExportConfig` / `onRestoreBackup` / `onConfirmResetEmpty` | `apps/obsidian/src/storage.ts:1-135` 实现了损坏备份恢复与 Reset Empty；但 `apps/obsidian/src/AppShell.svelte:248-271` **漏传** `onImportConfig` / `onExportConfig` | **`GAP / DEFECT` (`D-133`, P2)** | Obsidian 中点击 SettingsPanel 的「导入配置」「导出配置」会派发无宿主处理的 `RequestImportConfig`/`RequestExportConfig`，成为死按钮。 |
| `save_snippet` / 自定义模板保存 | `apps/desktop/src/App.svelte:179-185, 465, 485-487` 触发 `RequestSaveSnippet` 并由 `lib.rs:338, 522, 712-730` 存盘，但 `PalettePanel.svelte` **未展示** `userFormulas` | `apps/obsidian/src/AppShell.svelte:296-310` 既未传 `onSaveSnippet`，也无 WASM `Effect::Host::SaveSnippet` 宿主处理与 Obsidian 存盘逻辑；`main.js` 亦无 `RequestSaveSnippet` | **`GAP / DEFECT` (`D-135`, P2)** | `save_snippet` 在 Desktop 仅存盘无调色板展示，在 Obsidian 全链路缺失。 |

### 3.6 LaTeX 导入（`ImportModal`）

| 子项 | Desktop 证据 | Obsidian 证据 | 状态 | 说明 |
|---|---|---|---|---|
| Error 阻断 / Warning 确认 / round-trip diff 展示 | `packages/ui/src/import/ImportModal.svelte:27-80`；`apps/desktop/src/App.svelte:644-653` 保持弹窗开启，用户可查看 `lossless`、`raw_nodes`、`roundtrip_latex` diff 及 warning 后再确认关闭 | `apps/obsidian/src/AppShell.svelte:275-286`: `if (res.snapshot.last_import && !res.snapshot.last_import.blocked) { importOpen = false; }` 一旦导入未被 Error 阻断就**立即关闭弹窗** | **`GAP / DEFECT` (`D-133`, P2)** | Obsidian 用户无法审阅非阻断导入（含 Warning 与 `RawLatex` 降级）的 round-trip diff 报告。 |

### 3.7 Obsidian 专属宿主能力与 E2E（`A-OBS-001..005`）

| 子项 | Desktop 证据 | Obsidian 证据 | 状态 | 说明 |
|---|---|---|---|---|
| 3 个 Obsidian 命令 + 阅读模式 `mathslot` 代码块 | N/A（Desktop 为独立窗口应用） | `apps/obsidian/src/plugin.ts:183-205` 注册 `open-mathslot-inline`、`open-mathslot-display`、`open-mathslot-import`；`plugin.ts:207-256` 注册 `mathslot` 代码块处理器 | `INTENTIONAL_DIFF` | Obsidian 宿主集成能力已完整落地（`apps/obsidian/tests/obsidian.test.ts` 10 项测试通过）。 |
| 单文件同步构建产物（`main.js`, `styles.css`, `manifest.json`） | `apps/desktop/src-tauri` 构建产物不直接提交库内 | `obsidian-mathslot/{main.js, styles.css, manifest.json}` 已提交，但自 `3a22824` 后未随 `T3.5`（`7f42d74` / `d441512`）重建；`scripts/agent/acceptance.sh` 与 `.github/workflows/ci.yml` 均未校验已提交产物与源码一致 | **`GAP / DEFECT` (`D-131`, P1)** | 已提交插件包严重滞后于共享 UI 源码。 |
| 自动化 `obsidian_e2e` 与机器可校验 `feature_parity` | `apps/desktop/tests/e2e/desktop.spec.ts`（5 条 Playwright 用例） | 仅 Vitest+jsdom（10 条）与 Node WASM smoke（`obsidian-mathslot/scripts/build.mjs`），无 Playwright 浏览器 / 移动端 E2E；全仓无脚本/测试校验双端 parity 与产物新鲜度 | **`GAP / DEFECT` (`D-136`, P2)** | 未满足 G3 退出条件中的 `obsidian_e2e` 与 `feature_parity` 机器校验要求。 |

---

## 4. 新发现缺陷清单（`D-131` ~ `D-137`）

### `[OPEN]` D-131 (P1) — `obsidian-mathslot/{main.js, styles.css}` 已提交产物过时，未同步 `T3.5` 修复（含 `D-127`）且无新鲜度门禁
- **证据**：
  - `packages/ui/src/editor/MathSlotEditor.svelte:69, 95-127` 与 `packages/ui/src/editor/keymap.ts:48-115, 259-264` 已在 `T3.5`（`7f42d74`、`d441512`）落地 `externalSyncAnnotation`、`KeyDown`、`RequestSaveSnippet` 与 `lastKeydownInputChar` 修复。
  - `obsidian-mathslot/main.js`（最后提交于 `3a22824`，3,480,305 bytes）Node 符号检查返回：`KeyDown false`、`RequestSaveSnippet false`、`externalSyncAnnotation false`、`lastKeydownInputChar false`。
  - `.github/workflows/ci.yml:95` 仅在 CI 临时重编而不检查仓库内已提交文件 diff；`scripts/agent/acceptance.sh` 完全未覆盖 `obsidian-mathslot`。
- **影响**：直接安装仓库根目录 `obsidian-mathslot/` 插件时，仍存在 `D-127` 编辑双向脱节问题，双端实际运行行为不一致。

### `[OPEN]` D-132 (P1) — Obsidian `SettingsPanel` 保存与恢复默认设置未同步到实时 `WasmEngineClient` 快照
- **证据**：
  - `apps/obsidian/src/AppShell.svelte:169-177`：`handleSaveSettings` 与 `handleResetDefaults` 仅调用 `await onPersistSettings?.(...)`，不调用 `client.dispatch({ UpdateSettings })` / `client.dispatch('ResetSettingsConfirmed')`。
  - `apps/obsidian/src/AppShell.svelte:254-255` 传入 `onSaveSettings` / `onResetDefaults` 后，`packages/ui/src/settings/SettingsPanel.svelte:194-215` 跳过内置 `client.dispatch(...)` 分支。
  - 对比 `apps/desktop/src/App.svelte:207-210` 显式调用 `await applyDispatch({ UpdateSettings: next })`。
- **影响**：Obsidian 弹窗开启状态下保存设置（主题、快捷键、定界符格式）或恢复默认后，`snapshot.settings` 与运行时 UI/快捷键均保持旧值，必须关闭弹窗再重开（`plugin.ts:102`）才生效。

### `[OPEN]` D-133 (P2) — Obsidian `AppShell` 缺失配置导入/导出、严格导出、全局快捷键监听与导入报告审阅
- **证据**：
  - `apps/obsidian/src/AppShell.svelte:248-271` 未传 `onImportConfig` / `onExportConfig`（对比 Desktop `App.svelte:687-688`），导致 `SettingsPanel.svelte:236-248` 派发的 `RequestImportConfig` / `RequestExportConfig` 在 WASM 下无宿主响应。
  - `apps/obsidian/src/AppShell.svelte:141-161, 312-319` 未传 `onExportLatex`，且复制/插入直接读取 `snapshot.copy_text || snapshot.latex` 并写入剪贴板，跳过 `RequestExport { strict: true }` 校验。
  - `apps/obsidian/src/AppShell.svelte:296-310` 未传 `onSaveSnippet` / `onFocusEditor`，且缺少 `<svelte:window onkeydown>` 全局 `Escape` 与 `focus_editor` / `open_settings` / `toggle_nav` 快捷键调度（对比 Desktop `App.svelte:273-313`）。
  - `apps/obsidian/src/AppShell.svelte:280-286` 在 `!res.snapshot.last_import.blocked` 时直接 `importOpen = false`，跳过 round-trip diff 与 Warning 人工审阅（对比 Desktop `App.svelte:644-653`）。

### `[OPEN]` D-134 (P2) — 双端均未将 `PreviewPanel.onRenderResult` 接入 `DiagnosticsPanel.renderDiagnostics`，且 `PreviewPanel` 缺少渲染错误复制/展开
- **证据**：
  - `packages/ui/src/preview/PreviewPanel.svelte:26, 175, 193` 抛出 `onRenderResult`；`packages/ui/src/diagnostics/DiagnosticsPanel.svelte:8, 18, 85` 接收 `renderDiagnostics` 并提供 `copy-diagnostics-btn`（`198-202`）。
  - `rg -n "onRenderResult|renderDiagnostics" packages/ui/src/ apps/` 显示 `apps/desktop/src/App.svelte:520-534, 591` 与 `apps/obsidian/src/AppShell.svelte:312-325` 均未连接该回调与属性。
  - `packages/ui/src/preview/PreviewPanel.svelte:222-230` 仅展示截断至 120 字符的 `headerSummaryText`。
- **影响**：纯渲染错误（`PRIMARY_RENDER_FAILED`、`MATHJAX_TEX_ERROR`、`LATEX_RUST_ERROR`）无法在 `DiagnosticsPanel` 中折叠审阅或一键复制（`A-RENDER-005` / `A-UI-005`）。

### `[OPEN]` D-135 (P2) — 设置项与自定义片段 UI 闭环未对齐（`render_backend`、`preview_scale_pct`、`user_formulas`）
- **证据**：
  - `packages/ui/src/settings/SettingsPanel.svelte:121-136, 405-415` 在 Obsidian 仍显示 `latex-rust` 选项，但 `apps/obsidian/src/AppShell.svelte:101-109` 与 `hostRenderAdapter.ts:11-37` 忽略该配置。
  - `crates/mathslot-app/src/snapshot.rs:328` 定义了 `preview_scale_pct`，但 `SettingsPanel.svelte:60` 无编辑 UI，且 `PreviewPanel.svelte:55, 316` 硬编码 `zoomScale = $state(1.0)`。
  - `apps/desktop/src-tauri/src/lib.rs:508-565` 实现了 `get_user_formulas` / `save_user_formula`，但 `PalettePanel.svelte` 未渲染自定义公式，`AppShell.svelte` 未实现 Obsidian 侧 `SaveSnippet` 存盘与展示。

### `[OPEN]` D-136 (P2) — 缺少 `obsidian_e2e` 真实浏览器/移动端 E2E 及机器可校验 `feature_parity` 门禁
- **证据**：
  - `docs/LLM_IMPLEMENTATION_SPEC.md:1045` 明确 G3 退出条件为 `[desktop_e2e, obsidian_e2e, feature_parity]`。
  - `apps/obsidian` 目前仅含 `apps/obsidian/tests/obsidian.test.ts`（Vitest + jsdom，10 项）与 `obsidian-mathslot/scripts/build.mjs`（Node CJS WASM smoke），缺乏 Playwright 无头浏览器与 390px 移动端视口 E2E，也缺乏自动化比对双端产物新鲜度与能力矩阵的脚本/测试。

### `[OPEN]` D-137 (P3) — Desktop 生产前端包内仍含 `createBrowserHarnessBridge` JS 模拟解析器（仅用于非 `__TAURI_INTERNALS__` E2E）
- **证据**：
  - `apps/desktop/src/lib/desktopClient.ts:61-63, 115-269, 276-828`：虽然 `isTauriEnvironment()` 保证 Tauri 真机运行使用 `createTauriHostBridge()`（符合 `ADR-0030` 过渡约定），但 `createBrowserHarnessBridge()` 位于 `src/lib/` 内并内置 JS 版 `parseSlotsFromLatex` / `expandStreamSourceSimple` / `checkBalancedLatex`，导致 `apps/desktop/tests/e2e/desktop.spec.ts` 实际测的是 JS 模拟引擎而非 `mathslot-app` / `mathslot-wasm`（与 `INV-001` 精神存在长期维护偏移风险）。

---

## 5. 历史报告抽查核验（2 项）

依据 `AGENTS.md` §0 与审计协议，对 `docs/` 历史报告随机抽取 2 条具体断言执行实证复核：

1. **抽查 1 — `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:30`**：声称 *"Git 隔离规约：`docs/` 严禁参与 git tracking，`.gitignore` 严格阻断，`git ls-files docs/` 输出 0"*。
   - **复核命令与输出**：`git ls-files docs/ | wc -l`（exit `0`）输出 **`60`**（前几项包含 `docs/ACCEPTANCE_REPORT_FINAL.md` 等）。
   - **判定**：**不实 / 已失效（历史报告错误）**。

2. **抽查 2 — `docs/FINAL_PRODUCT_ACCEPTANCE_REPORT.md:35`**：声称 *"`obsidian-mathslot/main.js` 自包含 Base64 内联 556.5KB WASM，产物 796KB……"*。
   - **复核命令与输出**：`ls -la obsidian-mathslot/main.js apps/obsidian/src/wasm-pkg/`（exit `0`）显示 `obsidian-mathslot/main.js` 为 **`3,480,305` bytes**（含 Svelte 5 + CM6 + MathJax 3），`mathslot_wasm_bg.wasm` 为 **`475,557` bytes**；且即便作为 G3 新包，其仍滞后于 `T3.5` 提交 `7f42d74` / `d441512`（见 `D-131`）。
   - **判定**：**已过时（不可作为当前产品状态依据）**。

---

## 6. 建议的 `T3.7` 收口方案（供 coordinator / implementer 参考）

建议由 coordinator 结合 `D-131`~`D-137` 确定本轮修复范围（可先处理阻断项及低风险对齐项，对需要延后的能力显式登记决策记录以符合 §14 "差异为 0 或有记录"）：

1. **立即修复阻断级（P1：`D-131`, `D-132`）**：
   - 修复 `apps/obsidian/src/AppShell.svelte:169-177`：`handleSaveSettings` / `handleResetDefaults` 在持久化 `onPersistSettings` 前先调用 `await client.dispatch({ UpdateSettings: next })` / `'ResetSettingsConfirmed'` 并刷新 `snapshot`（补失败单测先红后绿）。
   - 在对齐所有共享 UI / `AppShell.svelte` 改动后，执行 `node obsidian-mathslot/scripts/build.mjs` 重新生成并提交同步版 `obsidian-mathslot/{main.js, styles.css, manifest.json}`。
2. **补齐 Obsidian 壳层联动与双端渲染诊断（P2：`D-133`, `D-134`, `D-135`）**：
   - 在 `apps/desktop/src/App.svelte` 与 `apps/obsidian/src/AppShell.svelte` 中将 `<PreviewPanel onRenderResult={...} />` 接入 `<DiagnosticsPanel renderDiagnostics={...} />`，并在 `PreviewPanel` 错误摘要旁补充复制/展开触发入口。
   - 在 `apps/obsidian/src/AppShell.svelte` 补齐 `onImportConfig` / `onExportConfig`（JSON 文件导入/导出）、`onExportLatex`（严格导出与错误提示）、`<svelte:window onkeydown>`（`Escape` / `focus_editor` / `open_settings` / `toggle_nav`）、以及 `ImportModal` 保留审阅（不自动跳过 round-trip diff）。
   - 在 `SettingsPanel.svelte` 增加可选 `supportedBackends` prop（Obsidian 禁用/隐藏 `latex-rust` 选项并注明遵循宿主 `renderMath`）；对于 `preview_scale_pct` 与 `user_formulas` 展示，若不在本轮 UI 展开，需先补充 `SettingsPanel` 缩放控件或通过 ADR 显式记录暂缓与后续版本归属。
3. **落地 G3 退出门禁（P2：`D-136`）**：
   - 为 `apps/obsidian` 增加 Playwright headless/mobile（390px 视口 + 弹窗渲染 + 输入/导出/诊断/恢复）`obsidian_e2e` 套件，替代纯 jsdom 覆盖。
   - 新增可机检脚本/测试（例如 `scripts/agent/check_parity.mjs` 并接入 `acceptance.sh` 与 `.github/workflows/ci.yml`）：
     1. 校验 `obsidian-mathslot/{main.js, styles.css}` 与重新执行 `build.mjs` 产物无 diff（防止再次出现 `D-131`）；
     2. 核对机器可读的 Desktop vs Obsidian feature parity 清单（每项状态为 `aligned` 或已登记的 `intentional_diff`）。
4. **长期硬化（P3：`D-137`）**：
   - 在 G4 前将 `apps/desktop/src/lib/desktopClient.ts` 的 `createBrowserHarnessBridge` 替换为加载 `mathslot-wasm` 的真实 WASM 桥接或移出生产 `src/lib/` 仅在测试注入。

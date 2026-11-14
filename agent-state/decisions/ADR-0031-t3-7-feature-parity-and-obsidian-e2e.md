# ADR-0031: Gate G3 T3.7 — 双端功能清单对齐、`obsidian_e2e` 与产物防漂移门禁

- **状态**：已批准（Round 30 / Gate G3 — `T3.7`）
- **依据**：
  - `docs/LLM_IMPLEMENTATION_SPEC.md` §2（`INV-001`、`INV-006`）、§8–§13（`A-RENDER-005`、`A-OBS-001..005`、`A-UI-001..005`）、§14（`T3.7` 与 Gate G3 退出条件 `[desktop_e2e, obsidian_e2e, feature_parity]`："差异为 0 或有记录"）
  - `agent-state/audits/AUD-27.md`（登记缺陷 `D-131` ~ `D-137`）

## 1. 本轮决策与范围

`T3.7` 的目标是在退出 Gate G3 前完成 **Desktop (`apps/desktop`) 与 Obsidian (`apps/obsidian`) 全量功能对齐**，清零 P1/P2 跨端差异（`D-131` ~ `D-136`），建立机器可校验的 `feature_parity` 契约与 `obsidian_e2e`（含 `390px` 移动视口）Playwright E2E，并明确记录宿主约束导致的 `INTENTIONAL_DIFF` 与 `D-137`（P3）的 G4 收口归属。

### 允许修改目录（严格单任务范围）
- `packages/ui/**`（`feature-parity.json`、共享 Svelte 组件对齐、Parity 单测）
- `apps/desktop/**`（`src/App.svelte`、`tests/**`）
- `apps/obsidian/**`（`src/**`、`tests/**`、`e2e/**`、Playwright 配置与脚本）
- `obsidian-mathslot/{main.js,styles.css,manifest.json}`（经 `node obsidian-mathslot/scripts/build.mjs` 重新生成并提交同步产物）
- `crates/mathslot-wasm/**`（仅在确认 Obsidian 片段保存/WASM 接口对齐所需最小范围内补充，保持 `#![forbid(unsafe_code)]`）
- `.github/workflows/ci.yml`（补充 `obsidian_e2e`、`feature_parity` 与 `obsidian-mathslot` 产物新鲜度门禁）
- `.gitignore`（忽略 `apps/obsidian/.e2e-artifacts/`）
- 注：`scripts/agent/acceptance.sh` 与 `scripts/agent/check_parity.mjs` 由 coordinator 按 `AGENTS.md` §2 单独提交，不混入实现提交。

## 2. 缺陷收口契约（`D-131` ~ `D-137`）

1. **`D-131` (P1) — Obsidian 构建产物重生成与新鲜度防漂移**：
   - 所有 `packages/ui` 与 `apps/obsidian` 改动完成后，执行 `node obsidian-mathslot/scripts/build.mjs` 更新 `obsidian-mathslot/main.js` 与 `obsidian-mathslot/styles.css`。
   - 验证产物中明确包含 `externalSyncAnnotation`、`lastKeydownInputChar`、`KeyDown`、`RequestSaveSnippet`、`RequestExport` 等符号，在真实同步模式下零 `D-127` 残留字符缺陷。
2. **`D-132` (P1) — Obsidian 设置保存/恢复默认即时刷新运行时引擎**：
   - `apps/obsidian/src/AppShell.svelte` 的 `handleSaveSettings` 必须先调用 `await client.dispatch({ UpdateSettings: next })` 更新运行期 `snapshot.settings`（同步更新主题属性、分隔符、快捷键），再调用 `onPersistSettings` 落盘；`handleResetDefaults` 必须先调用 `await client.dispatch('ResetSettingsConfirmed')` 再持久化默认配置。
   - Red -> Green：`apps/obsidian/tests/obsidian.test.ts` 先新增复现测试确认弹窗开启状态下修改设置不刷新即时快照的 FAIL 现象，修复后转绿，并在 `obsidian_e2e` 验证。
3. **`D-133` (P2) — Obsidian `AppShell` 完整壳层回调与快捷键接入**：
   - 接入 `onImportConfig` / `onExportConfig`（WebView/DOM JSON 文件选择导入 + Blob 下载导出并同步持久化与引擎快照）；
   - 接入 `onExportLatex`（执行 `client.dispatch({ RequestExport: { strict } })`，严格导出遇 Error/空槽位时阻断并向诊断/状态栏明确提示）；
   - 接入 `onFocusEditor` 与 `<svelte:window onkeydown>` 全局键盘调度（`Escape` 关闭弹窗、`focus_editor` / `open_settings` / `toggle_nav` 响应用户配置的快捷键）；
   - `ImportModal` 导入非阻断成功时**保留弹窗展示 round-trip diff 与 Warning**，由用户审阅后确认应用或关闭，行为与 Desktop 完全一致。
4. **`D-134` (P2) — 双端 `PreviewPanel.onRenderResult` → `DiagnosticsPanel.renderDiagnostics` 联动与错误复制 (`A-RENDER-005`, `A-UI-005`)**：
   - `apps/desktop/src/App.svelte` 与 `apps/obsidian/src/AppShell.svelte` 均保存 `renderDiagnostics` 状态，通过 `PreviewPanel` 的 `onRenderResult` 实时传入 `DiagnosticsPanel.renderDiagnostics`。
   - `packages/ui/src/preview/PreviewPanel.svelte` 降级/错误横幅增加简洁的「复制诊断」与「查看详情」入口（全走 `tokens.css` 令牌，无硬编码颜色），满足 `A-RENDER-005`。
5. **`D-135` (P2) — 设置项与自定义片段 UI 闭环 (`render_backend` / `preview_scale_pct` / `user_formulas`)**：
   - `SettingsPanel.svelte` 增加可选 `supportedBackends?: Array<'mathjax' | 'latex-rust'>`（Desktop 默认双向切换；Obsidian 传入 `['mathjax']` 并清晰标注仅支持宿主 `renderMath` + MathJax 回退，属于 `INTENTIONAL_DIFF`）；
   - `SettingsPanel.svelte` 新增 `preview_scale_pct` 预览缩放比例控件（`75`–`200%`），并透传给 `PreviewPanel` 作为基线缩放与持久化同步；
   - `PalettePanel.svelte` 支持可选 `userFormulas`（在面板中清晰展示已保存自定义片段并可一键插入）；`apps/obsidian/src/storage.ts` 与 `AppShell.svelte` 接入 `SaveSnippet` (`RequestSaveSnippet` -> `HostAction::SaveSnippet`) 持久化到 Obsidian 插件数据中并同步刷新 `PalettePanel`。
6. **`D-136` (P2) — `obsidian_e2e` 与机器可校验 `feature_parity` 清单**：
   - 新增 `packages/ui/feature-parity.json`（机读双端能力矩阵，每项状态仅允许 `aligned` 或附说明的 `intentional_diff`，本轮无未登记 `gap`）与 `packages/ui/tests/parity.test.ts`（自动化静态+契约校验 `App.svelte`、`AppShell.svelte`、`SettingsPanel.svelte` 与 `obsidian-mathslot/main.js` 同步状态）；
   - 在 `apps/obsidian` 建立基于真实 `mathslot-wasm` + `AppShell.svelte` 的 Playwright 浏览器 E2E（覆盖 Desktop 弹窗视角 `1280x800` 与移动端 `.is-mobile` `390x844` 视口：流式输入无残留 `;`、设置即时生效 `D-132`、导入 diff 审阅、渲染错误联动 `DiagnosticsPanel`、移动端无水平溢出），生成 `.e2e-artifacts/` 截图供视觉验收；
   - 更新 `.github/workflows/ci.yml` 运行 `obsidian_e2e` 与 parity/产物新鲜度检查（`T3.7` 验收 PASS 后由 coordinator 同步更新 `scripts/agent/acceptance.sh`）。
7. **`D-137` (P3) — 延后至 Gate G4 硬化（已记录）**：
   - `apps/desktop/src/lib/desktopClient.ts` 中的 `createBrowserHarnessBridge` 严格隔离于 `!isTauriEnvironment()`（生产 Tauri 可执行文件 100% 走 `DesktopBackend` Rust 原生引擎）；彻底替换为基于 `mathslot-wasm` 的浏览器桥接或仅测试注入列为 **Gate G4 (`T4.1`/`T4.3`) 硬化项**，不在 `T3.7` 扩面修改。

## 3. 完成标准

- Red -> Green 证据完整；
- `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace --offline`、`packages/ui`（含 `parity.test.ts`）、`apps/obsidian`（unit + check + Playwright desktop/mobile E2E）、`apps/desktop`（unit + check + build + Playwright E2E）、`audit_palette.py`、`xtask check --offline` 全部通过；
- `obsidian-mathslot/{main.js, styles.css}` 为最新构建且提交于 `T3.7` commit；
- 更新后桌面与 Obsidian E2E 截图由 `verifier` 直接查验无布局错位或视觉退化。

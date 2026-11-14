---
id: VER-30
round: 30
task: T3.7
commits: [7e2c9f38d825acd2db70aa506a3b9e343ecf3664]
defects: [D-131, D-132, D-133, D-134, D-135, D-136, D-137]
verdict: PASS
verifier: verifier
date: 2026-11-14
---

# 独立验收报告 VER-30（Round 30 / Gate G3 — T3.7）

## 1. 结论

**PASS**。

提交 `7e2c9f38d825acd2db70aa506a3b9e343ecf3664` 已在 `ADR-0031` 允许范围内完成 Gate G3 `T3.7`（Desktop 与 Obsidian 双端功能对齐、`obsidian_e2e` 浏览器与 390px 移动端 E2E、`feature-parity.json` 机检契约及 `obsidian-mathslot` 产物同步防漂移），`D-131` ~ `D-136` 全部具备代码、单测/E2E 与截图实证，`D-137` 已显式登记为 `intentional_diff` 归属 Gate G4。全量 Rust/UI/Obsidian/Desktop 门禁及 `build.mjs` 零漂移校验全部退出码 `0`。

---

## 2. 范围核对与硬规则静态扫描

### 2.1 提交范围核对（vs `ADR-0031` §1）
- 命令：`git show --stat 7e2c9f38d825acd2db70aa506a3b9e343ecf3664` 与 `git show --name-only --format="" 7e2c9f38d825acd2db70aa506a3b9e343ecf3664`（退出码 `0`）
- 变更共 32 个文件：
  - `.github/workflows/ci.yml`、`.gitignore`
  - `apps/desktop/src/App.svelte`
  - `apps/obsidian/**`（`.gitignore`、`e2e/harness.{html,ts}`、`package.json`、`playwright.config.ts`、`src/{AppShell.svelte,MathSlotModal.ts,plugin.ts,storage.ts,styles.css}`、`tests/{e2e/obsidian.spec.ts,node-shims.d.ts,obsidian.test.ts}`、`tsconfig.json`、`vite.e2e.config.ts`）
  - `obsidian-mathslot/{main.js,styles.css}`
  - `packages/ui/**`（`feature-parity.json`、`src/client/engine.ts`、`src/diagnostics/DiagnosticsPanel.svelte`、`src/index.ts`、`src/palette/PalettePanel.svelte`、`src/preview/PreviewPanel.svelte`、`src/settings/SettingsPanel.svelte`、`src/theme/tokens.css`、`tests/{palette,parity,preview,settings}.test.ts`）
- 越界核查：未触及 `src/**`、`crates/mathslot-{core,syntax,doc,latex,render,app,store}/**`、`scripts/agent/**`、`agent-state/**`、`docs/**`。
- `D-137` 归属记录：`packages/ui/feature-parity.json:26-32` 已登记 `desktop_browser_harness_bridge` 为 `intentional_diff`，明确仅在 `!isTauriEnvironment()` 下启用并在 Gate G4 硬化替换为 WASM，与 `ADR-0031` §2.7 一致。

### 2.2 硬规则静态扫描
1. **静默失败 / 用户路径 `.unwrap()` / 测试跳过 / `#[allow]` 扫描**：
   - 命令：`rg -n "let _\s*=|\.unwrap\(|#\[ignore|#\[allow|\.skip\(" apps/ packages/ui/src/ packages/ui/tests/ crates/mathslot-wasm/`
   - 退出码：`1`（无匹配，**0 处命中**）。
2. **Svelte 组件硬编码颜色扫描**：
   - 命令：`rg -n "#[0-9a-fA-F]{3,8}\b|rgba?\(" packages/ui/src/ apps/desktop/src/ apps/obsidian/src/ --glob "*.svelte"`
   - 退出码：`0`
   - 唯一命中：`packages/ui/src/import/ImportModal.svelte:113` 中的 HTML 实体 `&#123;`（非颜色值）；所有 `.svelte` 文件均使用 `tokens.css` CSS 变量。
   - 补充：`apps/obsidian/tests/obsidian.test.ts:355-387` 同时断言 `apps/obsidian/src/styles.css` 无 hex/`rgba?(` 且所有 `--ms-*` 引用均在 `packages/ui/src/theme/tokens.css` 中定义。

---

## 3. 缺陷收口逐项代码核查（`D-131` ~ `D-136`）

| 缺陷 | 核查证据（文件:行号） | 实测结论 |
|---|---|---|
| **D-131** | `obsidian-mathslot/scripts/build.mjs:49-238` 重编 WASM 并同步 `obsidian-mathslot/{main.js,styles.css,manifest.json}`；执行后 `git diff --stat -- obsidian-mathslot/` 为空；Node 符号核查 `beforeinput`、`insertText`、`KeyDown`、`RequestSaveSnippet`、`RequestExport`、`UpdateSettings`、`ResetSettingsConfirmed`、`preview_scale_pct`、`supportedBackends`、`renderDiagnostics` 均为 `true`（注：局部标识符 `externalSyncAnnotation`/`lastKeydownInputChar` 经 Vite/Rollup 压缩混淆，已通过 `apps/obsidian/tests/e2e/obsidian.spec.ts:26-28,138-139` 实测 `▸f1;2;` -> `\frac{1}{2}` 无 `;` 确认生效） | **PASS** |
| **D-132** | `apps/obsidian/src/AppShell.svelte:277-291` 中 `handleSaveSettings` 先 `await client.dispatch({ UpdateSettings: next })`，`handleResetDefaults` 先 `await client.dispatch('ResetSettingsConfirmed')`，更新 `snapshot` 与 `renderGen` 后再调用 `await onPersistSettings?.(...)`；`AppShell.svelte:429-432` 同步 `data-theme` 与 `data-theme-override`；`packages/ui/src/theme/tokens.css:265-268` 以 `:not([data-theme-override])` 确保显式切换明暗主题立即生效；`apps/obsidian/tests/obsidian.test.ts:504-559` 与 `obsidian.spec.ts:47-92` 验证 | **PASS** |
| **D-133** | `apps/obsidian/src/AppShell.svelte:183-211`（`handleExportLatex` 派发 `RequestExport: { strict }` 并在空槽/Error 诊断时阻断）、`226-232`（`handleFocusEditor`）、`293-382`（`handleExportConfig` + `triggerImportConfig` + `handleConfigFileSelected`）、`384-423`（`<svelte:window onkeydown={handleWindowKeydown} />` 调度 `Escape` / `open_settings` / `toggle_nav` / `focus_editor`）、`522-523`、`548-556`（`ImportModal` 非阻断成功保持弹窗审阅 round-trip diff）、`579,600-602`；`obsidian.test.ts:561-639` 与 `obsidian.spec.ts:84-109` 验证 | **PASS** |
| **D-134** | `apps/desktop/src/App.svelte:550-559,605-608,623-629` 与 `apps/obsidian/src/AppShell.svelte:593-598,605-611` 均接入 `PreviewPanel.onRenderResult` -> `renderDiagnostics` -> `DiagnosticsPanel.renderDiagnostics` 及 `onViewDiagnostics` -> `expand()`；`packages/ui/src/preview/PreviewPanel.svelte:285-312` 提供 `preview-copy-error-btn` 与 `preview-view-diagnostics-btn`；`packages/ui/src/diagnostics/DiagnosticsPanel.svelte:46-49` 暴露 `expand()`；`preview.test.ts:320-380`、`obsidian.test.ts:641-682`、`obsidian.spec.ts:111-123` 验证 | **PASS** |
| **D-135** | `packages/ui/src/settings/SettingsPanel.svelte:27,44,140-150,167-172,425-481` 新增 `supportedBackends`（Obsidian 仅传 `['mathjax']`）与 `preview_scale_pct`（`75`–`200%`）；`PreviewPanel.svelte:25,42,70-86` 响应 `previewScalePct`；`PalettePanel.svelte:18-24,52-64,171-180,365-415` 展示 `userFormulas` 片段标签页并支持点击加载；`apps/obsidian/src/storage.ts:142-235`、`AppShell.svelte:234-275`、`plugin.ts:171-178` 接入 `RequestSaveSnippet` -> `HostAction::SaveSnippet` 存盘与刷新；`apps/desktop/src/App.svelte:151-158,519,529-532,550,720` 同步接入；`palette.test.ts:253-294`、`settings.test.ts:418-450`、`obsidian.test.ts:684-732`、`obsidian.spec.ts:31-37,65-75` 验证 | **PASS** |
| **D-136** | `packages/ui/feature-parity.json:1-217`（7 大类全覆，无未登记 `gap`）与 `packages/ui/tests/parity.test.ts:1-153`（4 项契约检查）；`apps/obsidian/e2e/harness.{html,ts}`、`apps/obsidian/playwright.config.ts`、`apps/obsidian/vite.e2e.config.ts`、`apps/obsidian/tests/e2e/obsidian.spec.ts:1-152`（覆盖 Desktop 1280×800 与 Mobile 390×844 `.is-mobile` 无水平溢出）；`.github/workflows/ci.yml:94-104` 增加 `git diff --exit-code -- obsidian-mathslot/` 与 `npm run test:e2e` | **PASS** |

---

## 4. 独立全量门禁与实测输出

所有命令均在提交 `7e2c9f38d825acd2db70aa506a3b9e343ecf3664` 上由 verifier 独立实跑完成：

| 检查项 | 精确命令 | 退出码 | 实测输出摘要 |
|---|---|---|---|
| Rust 格式 | `cargo fmt --check` | `0` | 无输出（格式完全一致） |
| Rust Clippy | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished dev profile [optimized + debuginfo] target(s) in 0.76s`，0 warnings |
| Rust 全工作区单测 | `cargo test --workspace --offline` | `0` | `TOTAL passed=247 failed=0 ignored=0`（15 + 12 + 2 + 1 + 3 + 3 + 2 + 2 + 3 + 8 + 8 + 33 + 10 + 16 + 7 + 2 + 5 + 5 + 5 + 7 + 5 + 5 + 1 + 5 + 4 + 4 + 2 + 9 + 5 + 6 + 4 + 5 + 2 + 5 + 7 + 2 + 2 + 6 + 2 + 15 + 2） |
| 共享 UI 单测/校验/构建 | `cd packages/ui && npm test && npm run check && npm run build` | `0` | Vitest `Test Files 8 passed (8), Tests 42 passed (42)`；`svelte-check found 0 errors and 0 warnings`；Vite `dist/index.css 48.39 kB`, `dist/index.js 2,588.52 kB` |
| Obsidian 单测/校验/E2E | `cd apps/obsidian && npm test && npm run check && npm run test:e2e` | `0` | Vitest `Test Files 1 passed (1), Tests 14 passed (14)`；`svelte-check found 0 errors and 0 warnings`；Playwright `4 passed (13.7s)` |
| Desktop 单测/校验/构建/E2E | `cd apps/desktop && npm test && npm run check && npm run build && npm run test:e2e` | `0` | Vitest `Test Files 1 passed (1), Tests 3 passed (3)`；`svelte-check found 0 errors and 0 warnings`；Vite `dist/assets/index-CWpDzhLY.js 2,252.75 kB`；Playwright `5 passed (11.2s)` |
| Obsidian 产物新鲜度 | `node obsidian-mathslot/scripts/build.mjs && git diff --stat -- obsidian-mathslot/ && git status --short` | `0` | `✓ Obsidian plugin built and verified successfully: obsidian-mathslot/main.js (3 commands, 121 catalog entries, 88/88 presets)`；`git diff` 与 `git status` 均为空（零漂移） |
| 调色板一致性 | `python3 scripts/agent/audit_palette.py` | `0` | `扫描：12 张卡片，109 条子菜单命令`；`PASS：所有可映射卡片与命令目录一致` |
| Xtask 代码生成校验 | `cargo run -p xtask -- check --offline` | `0` | `[xtask] Check PASSED: All 6 artifacts are up-to-date and clean.` |

---

## 5. 视觉截图核查（`read_file` 直接审阅）

### 5.1 `apps/obsidian/.e2e-artifacts/*.png`
1. `apps/obsidian/.e2e-artifacts/obsidian-desktop-light.png`：**PASS**
   - 顶部工具栏完整对齐（`MathSlot WASM` + `导航树`/`导入 LaTeX`/`存为片段`/`设置`/`复制 LaTeX`/`插入笔记`），状态栏显示 `已保存为自定义片段`。
   - CM6 编辑框显示 `\frac{1}{2}`（无残留 `;`），`1 行 2 槽位`，预览区居中渲染 `1/2`，右侧 `片段 (1)` 徽标正常显示，121 条命令卡片栅格排版清晰。
2. `apps/obsidian/.e2e-artifacts/obsidian-desktop-dark.png`：**PASS**
   - 切换 Dark 主题并设置 `preview_scale_pct=125%` 保存后，整页立即呈现深色令牌配色，状态栏显示 `设置已保存`，预览工具栏高亮 `实际大小 (100%)` 与 `125%` 缩放读数，公式 `1/2` 清晰可见且对比度正常。
3. `apps/obsidian/.e2e-artifacts/obsidian-render-diagnostics.png`：**PASS**
   - 预览工具栏显示 `降级预览 [PRIMARY_RENDER_FAILED] Simulated Obsidian renderMath failure` 与 `复制错误` / `查看诊断` 按钮；预览区自动回退 MathJax 渲染出居中的 `a/b`；下方 `诊断与校验` 面板同步接收到 `PRIMARY_RENDER_FAILED` 并已展开显示源码片段与建议。
4. `apps/obsidian/.e2e-artifacts/obsidian-mobile-390.png`：**PASS**
   - 390×844 移动端 `.is-mobile` 视口下，顶部工具栏自动折成 2 列大触控按钮，工作区折叠为单列，编辑器显示 `\frac{1}{2}`、预览居中显示 `1/2`、诊断与调色板标签页均完整贴合视口宽度，无横向溢出与按钮遮挡。

### 5.2 `apps/desktop/.e2e-artifacts/*.png`
1. `apps/desktop/.e2e-artifacts/light-short.png`：**PASS**（`\frac{1}{2}` 无 `;`，居中渲染 `1/2`，调色板含 `片段 (0)` 标签页，结构树与诊断卡片布局整齐）
2. `apps/desktop/.e2e-artifacts/dark-theme.png`：**PASS**（深色主题一致性良好，恢复向导徽章与预览 `a/b` 对比度清晰）
3. `apps/desktop/.e2e-artifacts/long-formula.png`：**PASS**（10 槽位长积分求和公式保持单行输入，右侧完整居中渲染）
4. `apps/desktop/.e2e-artifacts/matrix-nav.png`：**PASS**（3×3 矩阵 9 槽位及分层结构树清晰显示，无溢出）
5. `apps/desktop/.e2e-artifacts/error-diagnostics.png`：**PASS**（预览栏显示 `降级预览 [LATEX_RUST_ERROR]` + `复制错误`/`查看诊断` 按钮；下方 `诊断与校验` 徽章同步更新为红色 `1` 并展示 `LATEX_RUST_ERROR` 条目）

---

## 6. 未验证 / 风险项

1. **真实 Obsidian 桌面/移动端宿主加载运行**：本轮在 Playwright Chromium（挂载真实 `mathslot-wasm` + `AppShell.svelte`）及 Vitest jsdom 中完成验证；真实 Obsidian App 侧载 `obsidian-mathslot/` 插件的端到端交互走查留待 Gate G4 终验执行。
2. **原生 Tauri WebKitGTK 窗口 IPC 手动走查**：Desktop E2E 使用 `!isTauriEnvironment()` 下的 `createBrowserHarnessBridge`（`D-137`，已记录于 `ADR-0031` 与 `feature-parity.json`，归属 Gate G4 硬化），Tauri Rust 后端由 `cargo test` 覆盖，真机原生窗口走查留待 Gate G4 终验执行。

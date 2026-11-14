---
id: VER-28
round: 28
task: T3.5
commit: 7f42d74d18755ff9f8fd4a488ffb62bb122f66bd
defects: [D-127, D-128, D-129, D-130, D-008, D-009, D-015, D-016]
verdict: FAIL
verifier: verifier
date: 2026-11-14
---

# 独立验收报告 VER-28（Round 28 / Gate G3 — T3.5）

## 1. 结论

**FAIL**。

`7f42d74d18755ff9f8fd4a488ffb62bb122f66bd` 完成了 `apps/desktop`（Tauri 2 Rust 后端 + Svelte 5 前端 + Playwright E2E）、`mathslot-store` 持久化原语、`SettingsPanel` 去重与 `ErrorSummary` camelCase DTO 映射（`D-128`/`D-129`/`D-130`），且 Rust/UI/Obsidian/Desktop 自动化命令全部退出码 0；但直接审阅 Playwright 截图 `apps/desktop/.e2e-artifacts/light-short.png` 与源码后，确认 **`D-127`（CM6 ↔ 引擎单一事实源双向同步）仍存在真实同步竞争缺陷**：

- 在 `apps/desktop/.e2e-artifacts/light-short.png` 中，输入 `▸f1;2;` 后预览与 `snapshot.copy_text` 为 `\frac{1}{2}`，但 CodeMirror 6 编辑框内残留多余分号，显示为 **`\frac{1}{2};`**。
- 根因在 `packages/ui/src/editor/keymap.ts:243-247`（单字符 `keydown` 异步派发 `KeyInput` 且未 `preventDefault()`，放行浏览器后续 `beforeinput`/CM6 插入）与 `packages/ui/src/editor/MathSlotEditor.svelte:131-141`（微任务中 `syncViewWithSnapshot` 将文档重写为 `\frac{1}{2}` 后，浏览器延迟到达的 `;` `beforeinput` 再次插入末尾，形成 `\frac{1}{2};`）；同时 `apps/desktop/tests/e2e/desktop.spec.ts:20-27` 仅断言 `desktop-copy-preview`，未断言 `.cm-content` 文本，导致缺陷逃逸。

---

## 2. 范围与硬规则静态检查

### 2.1 范围核对（`git show --stat 7f42d74` vs `ADR-0030` §1）
- 提交 `7f42d74` 共修改/新增 45 个文件，全部位于 `T3.5` 范围内：`.github/workflows/{ci,release}.yml`、`.gitignore`、`Cargo.{toml,lock}`、`crates/mathslot-app/**`、`crates/mathslot-store/**`、`packages/ui/**`、`apps/desktop/**`。
- 无 `xtask/**`、`catalog/**`、`src/**`、`crates/mathslot-{core,command,syntax,doc,latex,render,wasm}/**`、`apps/obsidian/**`、`agent-state/**` 跨 Gate 改动。
- 备注：工作区存在未提交改动 `M obsidian-mathslot/main.js`、`M obsidian-mathslot/styles.css`（验收前即已存在且由 `obsidian-mathslot/scripts/build.mjs` 重新生成）。

### 2.2 静态扫描（`7f42d74` 涉及目录）
1. **静默失败 / 测试跳过扫描**
   - 命令：`rg -n "let _\s*=|\.unwrap\(|#\[ignore|#\[allow|\.skip\(" apps/desktop/ crates/mathslot-app/ crates/mathslot-store/ packages/ui/src/ packages/ui/tests/`
   - 退出码：`0`
   - 命中核查：仅命中迭代器方法 `.skip(...)`（`crates/mathslot-store/src/lib.rs:667`、`crates/mathslot-store/tests/data_safety_tests.rs:176`、`crates/mathslot-app/tests/parity_report_tests.rs:1051`）与既有测试文件 `.unwrap()`（`crates/mathslot-store/tests/data_safety_tests.rs:493`）；`7f42d74` 新增与修改的产品/测试代码中 **0 处** `let _ =`、**0 处**用户路径 `.unwrap()`、**0 处** `#[ignore]`/`#[allow]`/`test.skip`。
2. **硬编码颜色扫描**
   - 命令：`rg -n "#[0-9a-fA-F]{3,8}\b|rgba?\(" apps/desktop/src/ packages/ui/src/`
   - 退出码：`0`
   - 命中核查：`apps/desktop/src/**/*.svelte`、`apps/desktop/src/styles.css` 与 `packages/ui/src/**/*.svelte` 中 **0 处**硬编码 hex/`rgb(`/`rgba(` 颜色（唯一 `#123` 命中为 `packages/ui/src/import/ImportModal.svelte:113` 的 HTML 实体 `&#123;`）；全部颜色令牌集中在 `packages/ui/src/theme/tokens.css`。
3. **`#![forbid(unsafe_code)]` 核查**
   - 命令：`rg -n "forbid\(unsafe_code\)" apps/desktop/src-tauri/src/ crates/mathslot-app/src/ crates/mathslot-store/src/`
   - 退出码：`0`
   - 命中：`apps/desktop/src-tauri/src/main.rs:2`、`apps/desktop/src-tauri/src/lib.rs:1`、`crates/mathslot-app/src/lib.rs:1`、`crates/mathslot-store/src/lib.rs:1` 均包含 `#![forbid(unsafe_code)]`。

---

## 3. 门禁与测试命令实测输出

| 命令 | 退出码 | 实测结果摘要 |
|---|---|---|
| `cargo fmt --check` | `0` | 无输出，格式通过 |
| `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished dev profile ... in 0.80s`，0 warnings |
| `cargo test --workspace --offline` | `0` | 汇总 `TOTAL passed=247 failed=0 ignored=0`（含 `mathslot_desktop_lib` `desktop_backend_tests`: 2 passed；`mathslot_app` `t3_5_sync_and_snippet_tests`: 2 passed；`mathslot_store` `t3_5_desktop_store_tests`: 2 passed） |
| `cd packages/ui && npm test && npm run check && npm run build` | `0` | Vitest `Test Files 7 passed (7), Tests 33 passed (33)`；`svelte-check found 0 errors and 0 warnings`；Vite `dist/index.js 2,580.47 kB` |
| `cd apps/obsidian && npm test && npm run check && node ../../obsidian-mathslot/scripts/build.mjs` | `0` | Vitest `Test Files 1 passed (1), Tests 10 passed (10)`；`svelte-check found 0 errors and 0 warnings`；`obsidian-mathslot/main.js` 构建并 smoke 通过 |
| `cd apps/desktop && npm test && npm run check && npm run build && npm run test:e2e` | `0` | Vitest `1 passed (3 tests)`；`svelte-check found 0 errors and 0 warnings`；Vite `dist/assets/index-CPuxBzZ3.js 2,246.25 kB`；Playwright Chromium `5 passed (13.3s)` |
| `python3 scripts/agent/audit_palette.py` | `0` | `扫描：12 张卡片，109 条子菜单命令`；`PASS：所有可映射卡片与命令目录一致` |
| `cargo run -p xtask -- check --offline` | `0` | `[xtask] Check PASSED: All 6 artifacts are up-to-date and clean.` |

---

## 4. 逐项缺陷与视觉验收

### 4.1 缺陷核对表

| 缺陷 / 验收项 | 期望 | 实测与文件:行号 | 判定 |
|---|---|---|---|
| `D-127` / `S-001`（CM6 ↔ 引擎双向同步） | 输入 `▸f1;2;` 后，CM6 文档与引擎 `snapshot.source` 严格一致为 `\frac{1}{2}`，无残留 `;` | Rust 侧 `crates/mathslot-app/src/app.rs:252-412` 与 `t3_5_sync_and_snippet_tests.rs:4-81` 通过；但前端 `packages/ui/src/editor/keymap.ts:243-247` + `MathSlotEditor.svelte:131-141` 在 Playwright 真实输入下残留 `;`，`light-short.png` 显示 `\frac{1}{2};` | **FAIL** |
| `D-128`（Tauri 2 壳 + CI + E2E） | `apps/desktop` 纳入 workspace、Linux CI 补齐 WebKitGTK/GTK3 依赖、Playwright E2E 覆盖 `S-001..S-007` | `Cargo.toml:13`、`apps/desktop/src-tauri/src/lib.rs:1-793`、`.github/workflows/ci.yml:36-40,85-92`、`.github/workflows/release.yml:33-37`、`apps/desktop/tests/e2e/desktop.spec.ts:1-245` | PASS |
| `D-129`（Store 恢复原语 + Settings 转换 + 去重 + 片段保存） | `restore_from_backup`/`reset_empty`/`export_library_json`/`import_library_json`、`Settings`↔`AppSettings`、`SettingsPanel` 单次派发、`save_snippet` 落盘、Corrupt 向导 | `crates/mathslot-store/src/lib.rs:248-268,1050-1099`、`apps/desktop/src-tauri/src/lib.rs:127-204,305-345`、`packages/ui/src/settings/SettingsPanel.svelte:194-249`、`packages/ui/tests/settings.test.ts:213-214`、`apps/desktop/tests/desktopUi.test.ts:69-135` | PASS |
| `D-130`（`ErrorSummary` ↔ `PreviewDiagnosticDto` camelCase 对齐） | Tauri `render_latex_svg` 返回 camelCase 字段（`summary`/`sourceExcerpt`/`detail`/`degraded`）且降级可阅读 | `apps/desktop/src-tauri/src/lib.rs:67-79,119-125,571-673`、`apps/desktop/src-tauri/tests/desktop_backend_tests.rs:51-101` | PASS |
| `D-008` / `S-002` / `A-UI-002` | 长公式预览居中完整，单行编辑器不伪折行 | `long-formula.png` 预览完整居中、编辑区保持 `1 行` | PASS |
| `D-009` / `S-007` | `Enter` 生成真实 3 行多行文本，Undo/Redo 同步 | `desktop.spec.ts:30-47` 断言 `.cm-line` count = 3 与 Undo/Redo；`t3_5_sync_and_snippet_tests.rs:32-49` 通过 | PASS |
| `D-015` / `A-UI-001` | `Tab`/`Shift+Tab` 逃逸焦点，`Mod+E` 返回编辑器 | `desktop.spec.ts:97-109`、`editor.test.ts:242-306,380-450` 通过 | PASS |
| `D-016` / `S-006` / `A-UI-004` | Dark/Light 主题无硬编码色块，快捷键冲突拦截与恢复向导可用 | `dark-theme.png` 计算背景深色且文本对比清晰，无浅色硬编码块；冲突拦截在 `desktop.spec.ts:231-237` 通过 | PASS |
| `S-003` / `A-UI-003` | 3×3 矩阵导航树 9 槽位无水平溢出 | `matrix-nav.png` 展示 9 个槽位且 `scrollWidth - clientWidth <= 2` | PASS |
| `S-004` / `S-005` / `A-UI-005` | 降级预览徽章、Error 诊断可读、Pending 命令阻断严格导出 | `error-diagnostics.png` 显示 `降级预览` 徽章与 `[LATEX_RUST_ERROR]` 摘要不遮挡工具栏；`desktop.spec.ts:49-56,112-120` 通过 | PASS |

### 4.2 Playwright 5 张截图人工核查（`read_file` 直接读取）
1. `apps/desktop/.e2e-artifacts/light-short.png`：**FAIL** — CM6 编辑框内显示 `\frac{1}{2};`（末尾存在多余分号 `;`），右侧预览渲染为 `1/2`，底部预览与编辑器文本不一致。
2. `apps/desktop/.e2e-artifacts/dark-theme.png`：**PASS** — 深色主题全界面一致性良好，顶部状态条展示`配置恢复向导`与提示条，`1/2`（`\frac{a}{b}`）在深色预览区居中清晰，无浅色硬编码块。
3. `apps/desktop/.e2e-artifacts/long-formula.png`：**PASS** — 积分与求和长公式在预览视口完整居中渲染、无裁切，左侧编辑区维持单行（`1 行 10 槽位`）。
4. `apps/desktop/.e2e-artifacts/matrix-nav.png`：**PASS** — 搜索 `3×3` 并点击矩阵卡片后，编辑器显示 `\begin{pmatrix} ... \end{pmatrix}` 与 9 个槽位胶囊，右侧结构导航树清晰分层且无水平溢出。
5. `apps/desktop/.e2e-artifacts/error-diagnostics.png`：**PASS** — `降级预览` 徽章与 `[LATEX_RUST_ERROR] 离线 LaTeX-Rust 不支持测试宏，已自动降级` 在预览工具栏上方清晰可见，无文字遮挡或溢出错位。

---

## 5. 阻断原因与最小复现

### 阻断项：`D-127` — 键入流式命令 `▸f1;2;` 后 CM6 编辑区残留 `;`（`\frac{1}{2};`）

1. **最小复现**：
   - 启动 `apps/desktop`（`cd apps/desktop && npm run test:e2e` 或在浏览器访问预览页并聚焦 `.cm-content`）。
   - 依次键入 `▸f1;2;`。
   - **期望**：引擎 `snapshot.source` 与 CM6 `.cm-content` 文本均为 `\frac{1}{2}`。
   - **实际**：`snapshot.source` / `snapshot.latex` 为 `\frac{1}{2}`，但 CM6 `.cm-content` 为 **`\frac{1}{2};`**（见 `apps/desktop/.e2e-artifacts/light-short.png`）。
2. **定位**：
   - `packages/ui/src/editor/keymap.ts:243-247`：对 `event.key.length === 1` 仅异步调用 `options.dispatchEvent({ KeyInput: event.key })` 并 `return false`（未阻止浏览器/CM6 自身 `beforeinput` 插入）。
   - `packages/ui/src/editor/keymap.ts:92-101`：`beforeinput` 在 `lastKeydownInputChar === event.data` 时仅清除标记并 `return false` 放行 CM6 插入。
   - `packages/ui/src/editor/MathSlotEditor.svelte:131-141`：当 `client.dispatch({ KeyInput: ';' })` 的 Promise 在浏览器派发 `char`/`beforeinput` 之前于微任务完成时，`syncViewWithSnapshot` 先将 CM6 文档替换为 `\frac{1}{2}`（光标位于末尾 11），随后到达的 `;` `beforeinput` 将 `;` 插入到 `\frac{1}{2}` 末尾，导致 CM6 变成 `\frac{1}{2};` 且与后端分叉。
   - `apps/desktop/tests/e2e/desktop.spec.ts:20-27`：仅断言 `desktop-copy-preview` 包含 `\frac{1}{2}`，未对 `.cm-content` 文本做等价断言。

---

## 6. 未验证 / 风险项

1. **实时 Tauri WebKitGTK 桌面窗口运行未在无头环境拉起**：Playwright E2E（`apps/desktop/tests/e2e/desktop.spec.ts`）通过 Vite preview + `createBrowserHarnessBridge`（`apps/desktop/src/lib/desktopClient.ts:276-829`）验证前端 UI 与 CM6 交互；Tauri Rust 后端真实逻辑（`Store`、`RenderPipeline`/`LatexRustSvgBackend`、`AppEvent`）由 `cargo test -p mathslot-desktop --offline`（`desktop_backend_tests.rs`）验证，但真实桌面窗口 IPC 端到端链路需在带显示环境的桌面会话（G4 手动走查）确认。
2. **浏览器 Harness 中的双份流式展开逻辑**：`apps/desktop/src/lib/desktopClient.ts:101-714` 为无 `__TAURI_INTERNALS__` 环境编写了 JS 版流式展开与大括号槽位解析（及 `\unknownFallbackTest` 触发），虽属 `ADR-0030` §2.3 允许的 E2E 测试 Harness，但应避免生产 Tauri 构建走入该分支或与 `mathslot-app` 契约产生语义漂移。
3. **工作区未提交构建产物**：`obsidian-mathslot/main.js` 与 `obsidian-mathslot/styles.css` 在当前工作区处于 modified 状态，协调者需在下一轮前决定是否还原或单独处理。

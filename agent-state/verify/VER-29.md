---
id: VER-29
round: 29
task: T3.5
commits: [7f42d74d18755ff9f8fd4a488ffb62bb122f66bd, d441512a285962dd7a96f82f0875f4a2e520c8d9]
defects: [D-127, D-128, D-129, D-130, D-008, D-009, D-015, D-016]
verdict: PASS
verifier: verifier
date: 2026-11-14
---

# 独立验收报告 VER-29（Round 29 / Gate G3 — T3.5）

## 1. 结论

**PASS**。

Round 29 修复提交 `d441512a285962dd7a96f82f0875f4a2e520c8d9` 已彻底解决 Round 28（`VER-28.md`）唯一阻断项 `D-127`（`keydown` 与延迟 `beforeinput` 之间的异步同步竞争）：

1. `packages/ui/src/editor/keymap.ts:87-125,259-265` 在非 IME 单字符 `keydown` 上显式调用 `event.preventDefault()`、`lastKeydownInputChar = event.key` 并返回 `true`，在 `beforeinput`（`insertText`）分支同步 `event.preventDefault()` 阻断 CM6 原生插字，并在 `lastKeydownInputChar === event.data` 时去重返回 `true`；同时通过 `keyup`/`blur`/`compositionstart`/`compositionend`/`paste` 清除 `lastKeydownInputChar`，并保持 `Tab`/`Shift+Tab`（`128-137`）、非导航态 `Escape`（`143,265`）及 IME composing（`96-99,117-125`）放行，无竞态、无死锁。
2. `packages/ui/tests/editor.test.ts:583-759` 新增 2 个回归单测，覆盖 `keydown(';')` 后异步微任务 `syncViewWithSnapshot` 重写为 `\frac{1}{2}` 再遭遇延迟 `beforeinput(';')` 不残留分号，以及 `keyup` 后独立 Unicode `beforeinput('▸')` 与 `Ctrl`/`Alt`/`Meta`/`Escape` 放行行为。
3. `apps/desktop/tests/e2e/desktop.spec.ts:22-25,43,50,53` 新增 `.cm-content` 严格等于 `\frac{1}{2}`、不包含 `;` 以及 3 行 `['a','b','c']` / Undo `['a','b','']` / Redo `['a','b','c']` 的精确文本断言。
4. 完整门禁全部退出码 `0`（工作区干净），重新审阅 `apps/desktop/.e2e-artifacts/` 5 张最新 Playwright 截图，`light-short.png` 中 CM6 编辑框已严格显示 `\frac{1}{2}`（末尾无 `;`），其余 4 张截图布局、主题对比度、公式渲染与诊断徽章均无异常。

---

## 2. Round 29 复验（`d441512`）与范围/硬规则扫描

### 2.1 `d441512` 改动核查
- 命令：`git show d441512 --stat`（退出码 `0`）
- 改动文件仅 3 个，全部在 `ADR-0030` §1 允许范围内：
  - `packages/ui/src/editor/keymap.ts`（+21 / -3）
  - `packages/ui/tests/editor.test.ts`（+178）
  - `apps/desktop/tests/e2e/desktop.spec.ts`（+7）
- 关键逻辑逐行核对：
  - `keymap.ts:87-94`：`keyup()` 与 `blur()` 重置 `lastKeydownInputChar = null` 并 `return false`。
  - `keymap.ts:95-113`：`beforeinput(event, view)` 对 IME（`composing || view.composing || event.isComposing`）清标并返回 `false`；对非 IME `insertText` 立即 `event.preventDefault()` 阻止 CM6 原生插入；若 `lastKeydownInputChar === event.data` 则去重并返回 `true`，否则逐字符派发 `{ KeyInput: ch }` 并返回 `true`。
  - `keymap.ts:114-125`：`keydown` 开头重置 `lastKeydownInputChar = null`，对 `composing || view.composing || event.isComposing || event.key === 'Process' || event.key === 'Dead'` 返回 `false`。
  - `keymap.ts:128-137`：`Tab` / `Shift+Tab` 调用 `onFocusEscape` 并返回 `false`（不锁死焦点 `D-015`）。
  - `keymap.ts:143,182-186,265`：非导航态 `Escape` 跳过全局快捷键并走 `return false` 放行；导航态 `Escape` 派发 `ExitNavMode`。
  - `keymap.ts:259-264`：普通单字符 `keydown` 调用 `event.preventDefault()`、设置 `lastKeydownInputChar = event.key`、派发 `{ KeyInput: event.key }` 并返回 `true`。

### 2.2 范围与工作区状态核查（`7f42d74` + `d441512` vs `ADR-0030` §1）
- 命令：`git status --short`（退出码 `0`，无输出，工作区干净，包括所有测试与构建运行后仍无未提交变更）。
- 命令：`git show --name-only --format="" 7f42d74` 与 `git show --name-only --format="" d441512`（退出码 `0`）：
  - `7f42d74` 修改 45 个文件（`.github/workflows/{ci,release}.yml`、`.gitignore`、`Cargo.{toml,lock}`、`apps/desktop/**`、`crates/mathslot-app/**`、`crates/mathslot-store/**`、`packages/ui/**`）；
  - `d441512` 修改 3 个文件（`apps/desktop/tests/e2e/desktop.spec.ts`、`packages/ui/src/editor/keymap.ts`、`packages/ui/tests/editor.test.ts`）；
  - 均未触及 `xtask/**`、`catalog/**`、`src/**`、`crates/mathslot-{core,command,syntax,doc,latex,render,wasm}/**`、`apps/obsidian/**`、`obsidian-mathslot/**`、`scripts/agent/**`、`docs/**`、`agent-state/**`。

### 2.3 硬规则静态扫描
1. **静默失败 / 测试跳过 / allow 扫描**：
   - 命令：`rg -n "let _\s*=|\.unwrap\(|#\[ignore|#\[allow|\.skip\(" apps/desktop/ crates/mathslot-app/ crates/mathslot-store/ packages/ui/src/ packages/ui/tests/`
   - 退出码：`0`
   - 命中核查：仅 4 处既有测试或迭代器 `.skip(...)`（`crates/mathslot-store/src/lib.rs:667`、`crates/mathslot-store/tests/data_safety_tests.rs:176,493`、`crates/mathslot-app/tests/parity_report_tests.rs:1051`）；`7f42d74` + `d441512` 新增与修改文件中 **0 处** `let _ =`、**0 处**用户路径 `.unwrap()`、**0 处** `#[ignore]`/`#[allow]`/`test.skip`。
2. **硬编码颜色扫描**：
   - 命令：`rg -n "#[0-9a-fA-F]{3,8}\b|rgba?\(" apps/desktop/src/ packages/ui/src/`
   - 退出码：`0`
   - 命中核查：`.svelte` 组件中唯一 `#123` 命中为 `packages/ui/src/import/ImportModal.svelte:113` HTML 实体 `&#123;`；全部主题色值均集中定义于 `packages/ui/src/theme/tokens.css`，`apps/desktop/src/` 中 **0 处**硬编码 hex/`rgb(`/`rgba(`。

---

## 3. 完整门禁与测试实测输出

| 命令 | 退出码 | 实测输出摘要 |
|---|---|---|
| `cargo fmt --check` | `0` | 无格式差异输出（`FMT_EXIT=0`） |
| `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished dev profile [optimized + debuginfo] target(s) in 0.57s`，0 warnings |
| `cargo test --workspace --offline` | `0` | 汇总 `TOTAL passed=247 failed=0 ignored=0`（`mathslot`: 15、`mathslot_app`: 28、`mathslot_command`: 16、`mathslot_core`: 114、`mathslot_desktop_lib`: 2、`mathslot_doc`: 24、`mathslot_latex`: 5、`mathslot_render`: 7、`mathslot_store`: 11、`mathslot_syntax`: 23、`mathslot_wasm`: 2） |
| `cd packages/ui && npm test && npm run check && npm run build` | `0` | Vitest `Test Files 7 passed (7), Tests 35 passed (35)`（较 R28 33 新增 2 条 `D-127` 单测）；`svelte-check found 0 errors and 0 warnings`；Vite `dist/index.css 46.88 kB`、`dist/index.js 2,580.67 kB` |
| `cd apps/obsidian && npm test && npm run check` | `0` | Vitest `Test Files 1 passed (1), Tests 10 passed (10)`；`svelte-check found 0 errors and 0 warnings` |
| `cd apps/desktop && npm test && npm run check && npm run build && npm run test:e2e` | `0` | Vitest `Test Files 1 passed (1), Tests 3 passed (3)`；`svelte-check found 0 errors and 0 warnings`；Vite `dist/assets/index-p0WBh2a3.js 2,246.40 kB`；Playwright Chromium `5 passed (11.4s)` |
| `python3 scripts/agent/audit_palette.py` | `0` | `扫描：12 张卡片，109 条子菜单命令`；`PASS：所有可映射卡片与命令目录一致` |
| `cargo run -p xtask -- check --offline` | `0` | `[xtask] Check PASSED: All 6 artifacts are up-to-date and clean.` |

---

## 4. 视觉截图与验收项核对

### 4.1 视觉截图核查（`read_file` 直接审阅 `20:11:55`–`20:12:01` 最新生成 PNG）
1. `apps/desktop/.e2e-artifacts/light-short.png`：**PASS**
   - CM6 编辑框明确显示 `\frac{1}{2}`，**末尾无 `;`**，槽位 `1` 处于高亮激活态，上方胶囊显示 `#1 槽位 1 已填`、`#2 槽位 2 已填` 及 `1 行 2 槽位`；右侧实时预览清晰居中渲染 `1/2`；结构树显示 `复合结构 [0]` 与 `#1 槽位 1 [0.0]`/`#2 槽位 2 [0.1]`；整体浅色界面排版整洁无重叠溢出。
2. `apps/desktop/.e2e-artifacts/dark-theme.png`：**PASS**
   - 深色主题全界面一致性良好，顶部状态栏显示 `配置恢复向导` 与 `检测到配置损坏，已启用恢复向导`，CM6 编辑框显示 `\frac{a}{b}`，右侧深色预览居中渲染 `a/b`，无浅色硬编码块或对比度缺陷。
3. `apps/desktop/.e2e-artifacts/long-formula.png`：**PASS**
   - 长积分求和公式在预览区居中完整渲染无裁切，CM6 编辑区保持单行（`1 行 10 槽位`），10 个槽位胶囊自适应换行整洁。
4. `apps/desktop/.e2e-artifacts/matrix-nav.png`：**PASS**
   - 搜索 `3×3` 并点击矩阵卡片后，CM6 显示 `\begin{pmatrix} ... \end{pmatrix}` 与 9 个空槽位高亮，右侧结构导航树清晰分层展示 `复合结构 [0]`、`[1]`、`[2]` 且无水平溢出。
5. `apps/desktop/.e2e-artifacts/error-diagnostics.png`：**PASS**
   - 预览工具栏上方清晰显示 `降级预览` 徽章与 `[LATEX_RUST_ERROR] 离线 LaTeX-Rust 不支持测试宏，已自动降级`，无遮挡按钮或溢出错位。

### 4.2 `T3.5` 验收与缺陷对照
| 项 | 证据 | 判定 |
|---|---|---|
| `D-127` / `S-001` | `keymap.ts:87-125,259-265`、`editor.test.ts:583-759`、`desktop.spec.ts:20-26`、`light-short.png` 显示 `\frac{1}{2}`（无 `;`） | **PASS** |
| `D-128`（Tauri 2 壳 + CI + E2E） | `Cargo.toml:13`、`apps/desktop/src-tauri/src/lib.rs:1-793`、`.github/workflows/{ci,release}.yml`、`desktop.spec.ts:1-252`（5 passed） | **PASS** |
| `D-129`（Store 恢复原语 + Settings 去重 + `save_snippet`） | `crates/mathslot-store/src/lib.rs:248-268,1050-1099`、`packages/ui/src/settings/SettingsPanel.svelte:194-249`、`packages/ui/tests/settings.test.ts`、`apps/desktop/tests/desktopUi.test.ts` | **PASS** |
| `D-130`（`ErrorSummary` camelCase DTO 映射） | `apps/desktop/src-tauri/src/lib.rs:67-79,119-125,571-673`、`desktop_backend_tests.rs:51-101`、`error-diagnostics.png` | **PASS** |
| `D-008` / `S-002` / `A-UI-002` | `long-formula.png` 单行不伪折行、预览完整居中 | **PASS** |
| `D-009` / `S-007` | `desktop.spec.ts:33-55` 严格断言 3 行 `['a','b','c']` 与 Undo/Redo 同步 | **PASS** |
| `D-015` / `A-UI-001` | `keymap.ts:128-137`、`editor.test.ts:242-306,665-759`、`desktop.spec.ts:104-116` | **PASS** |
| `D-016` / `S-006` / `A-UI-004` | `dark-theme.png`、`desktop.spec.ts:170-251` | **PASS** |
| `S-003` / `A-UI-003` | `matrix-nav.png`、`desktop.spec.ts:66-93`（9 槽位 `scrollWidth - clientWidth <= 2`） | **PASS** |
| `S-004` / `S-005` / `A-UI-005` | `error-diagnostics.png`、`desktop.spec.ts:56-64,118-127,146-168` | **PASS** |

---

## 5. 未验证 / 风险项

1. **真实 Tauri WebKitGTK 桌面窗口运行**：无头环境通过 Playwright + Vite preview（`createBrowserHarnessBridge`）验证前端 UI 与 CM6 交互，Tauri Rust 后端由 `cargo test --workspace --offline` 中的 `desktop_backend_tests`（2 passed）验证；真实原生桌面窗口 IPC 手动走查留待 G4 终验桌面会话执行。
2. **Obsidian 包产物构建对齐**：按指示本轮未运行会改动已提交 `obsidian-mathslot/{main.js,styles.css}` 的构建脚本，Obsidian 包重组对齐将在后续任务 `T3.7` 执行。

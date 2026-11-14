---
id: VER-32
round: 32
task: T4.1
commits: [9ae6840, 8a82131]
base_commit: 46c03fc
reverify_from: 1e411f6
defects: [D-007, D-012, D-020, D-137, D-138, D-139, D-140, D-141, D-142, D-143, D-144, D-145, D-146]
verdict: PASS
verifier: verifier
date: 2026-11-14
---

# VER-32：Gate G4 / T4.1 独立验收报告（Round 32 复验）

## 1. 结论

**PASS**。

基于累积提交 `9ae6840` + `8a82131`（基线治理提交 `46c03fc` 起，Round 31 失败点 `1e411f6` 起增量复验），`T4.1`（LaTeX 导入诊断、栈深保护、外层定界符剥离、两阶段预览 Diff、统一 `@mathslot/wasm` 引擎与一步撤销）以及 `VER-31` 提出的 3 项 UI/主题/布局阻断缺陷（`D-144`、`D-145`、`D-146`）均已彻底修复并通过全量自动化测试、门禁脚本、插件构建零漂移校验与 4 张 Playwright 截图视觉实查。

---

## 2. Diff 范围、Red->Green 测试与代码卫生核查

### 2.1 Diff 范围对照 `ADR-0032`
- `git diff --stat 1e411f6..8a82131`（Round 32 增量修复）：共 10 个文件（`+278 / -106`），全部位于 `ADR-0032` §3 授权范围：`apps/desktop/src/{App.svelte,styles.css}`、`apps/desktop/tests/e2e/desktop.spec.ts`、`apps/obsidian/e2e/harness.html`、`apps/obsidian/tests/e2e/obsidian.spec.ts`、`packages/ui/src/{import/ImportModal.svelte,theme/tokens.css}`、`packages/ui/tests/importModal.test.ts`、`obsidian-mathslot/{main.js,styles.css}`。
- `git diff --stat 46c03fc..8a82131`（`T4.1` 累积变更）：共 39 个文件（`+2483 / -937`），除 Round 31 治理记录提交 `1e411f6`（`agent-state/{HANDOFF.md,state.json,decisions/ADR-0032-...,verify/VER-31.md}`）外，所有代码与测试改动均在 `ADR-0032` §3 授权路径内，未修改 `docs/LLM_IMPLEMENTATION_SPEC.md`、`scripts/agent/**` 或冻结参考目录。

### 2.2 Red -> Green 测试覆盖与零弱化核查
- **历史基线与缺陷复现（Red 证据）**：
  - `D-138`..`D-143` 预修复失败已由 `agent-state/audits/AUD-28.md` 在 `b12ceca`（`46c03fc` 代码快照）通过 WASM 实测复现记录。
  - `D-144`..`D-146` 预修复失败已由 `agent-state/verify/VER-31.md` 在 `9ae6840` 通过截图与源码行号复现记录。
- **回归测试覆蓋（Green 证据）**：
  - `D-138` / `D-139` / `D-141`：`crates/mathslot-syntax/tests/t4_1_import_parser_tests.rs:1-110`（5 tests）覆盖 `\begin{align}` 不强转矩阵、未闭合/不匹配环境、7 类畸形/未闭合输入报错、5000 层 `{}` 与 500 层 `\frac` 栈深保护。
  - `D-142`：`crates/mathslot-latex/tests/t4_1_import_report_tests.rs:1-97`（4 tests）覆盖 `$$...$$` / `\[...\]` / `$...$` / `\(...\)` 外层定界符剥离与 `Info` 诊断、单侧定界符阻断及 report 指标。
  - `D-140` / `D-012`：`crates/mathslot-app/tests/t3_6_import_and_presets_tests.rs:170-261`（`t4_1_preview_diff_strip_undo_and_blocking_in_mathslot_app`）与 `crates/mathslot-wasm/tests/t3_6_wasm_bindgen_tests.rs:80-122` 验证 `PreviewImportLatex` 不修改文档与渲染状态、`ImportAcknowledge` 取消不污染、`ImportLatex` 后一步 `Undo` 还原及错误阻断。
  - `D-143` / `D-137`：`apps/desktop/src/lib/desktopClient.ts:1-312` 移除手写 JS 括号计数假导入，统一走 `@mathslot/wasm`（`apps/desktop/tests/desktopUi.test.ts` 第 4 项测试验证）。
  - `D-144`：`packages/ui/tests/importModal.test.ts:330-380`、`apps/desktop/tests/e2e/desktop.spec.ts:137-140`、`apps/obsidian/tests/e2e/obsidian.spec.ts:145-148` 断言 `raw_nodes === 0 && blocked` 时绝不渲染 `"RawLatex 降级"`，而是渲染 `"语法错误已阻断"`（`raw_nodes > 0 && blocked` 渲染 `"语法错误已阻断 · 含 N RawLatex"`）。
  - `D-145`：`packages/ui/src/theme/tokens.css:288-496` 为 `[data-host='obsidian']` 与 `.mathslot-obsidian-host` 新增完整 `--ms-obs-fallback-*` 明/暗双主题语义变量回退；`apps/obsidian/e2e/harness.html:20-35` 补齐 `--text-error` / `--text-warning` / `--text-success`；`apps/obsidian/tests/e2e/obsidian.spec.ts:148-189` 实测 `getComputedStyle` 边框与背景均解析为非黑非透明语义色。
  - `D-146`：`apps/desktop/src/App.svelte:663-680` 移除重复外层 `.ms-modal-header`，仅保留 `ImportModal.svelte:140-157` 单头部与 `white-space: nowrap; flex-shrink: 0`（`ImportModal.svelte:417-418`）；`apps/desktop/src/styles.css:335-340` 添加 `.ms-modal-shell` 滚动容器；`apps/desktop/tests/e2e/desktop.spec.ts:122-130, 168-193` 实测单标题、`关闭` 按钮高度 `<= 42px` 且在 `1280x720` 下最后一条诊断可完整可见。
- **零弱化扫描**：
  - `git diff 46c03fc..8a82131 | rg -n "^\+.*(#\[ignore\]|#\[allow\(|\.skip\(|xit\(|xdescribe\()"` 仅命中 `parity_report_tests.rs` 中的迭代器方法 `.split('▸').skip(1)` 与 `VER-31.md` 文档说明，**0 处**测试跳过或 `#[allow]` 放宽。

### 2.3 静态卫生扫描（全部零违规）
1. **`.unwrap()` / `let _ =` 扫描**：
   - `$ rg -n "\.unwrap\(|let _ =" crates/mathslot-syntax/src crates/mathslot-latex/src crates/mathslot-app/src crates/mathslot-wasm/src packages/ui/src apps/desktop/src apps/obsidian/src || echo "CLEAN_RUST_TS"`
   - Exit code `0` → 输出 `CLEAN_RUST_TS`（**0 处命中**）。
2. **单一解析器核查**：
   - `$ rg -n "fn parse\(" crates/ apps/ packages/ src/` → 仅 `crates/mathslot-syntax/src/{lib.rs:20,parser.rs:34}` 与冻结旧栈 `crates/mathslot-core/src/parser.rs:15`，无第二套 JS/Rust 解析器或命令表。
3. **`.svelte` / `.ts` 零硬编码颜色核查**：
   - `$ git diff 46c03fc..8a82131 -- '*.svelte' '*.ts' | rg -n "^\+.*(#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\()"` → 仅命中 `apps/obsidian/tests/e2e/obsidian.spec.ts` 中的否定断言 `not.toBe('rgb(0, 0, 0)')` / `not.toBe('rgba(0, 0, 0, 0)')`；产品 `.svelte`/`.ts` **0 处硬编码色值**（所有语义色回退均在 `packages/ui/src/theme/tokens.css` 与 `apps/obsidian/e2e/harness.html`）。

---

## 3. 独立执行命令与实测输出

| 检查项 | 命令 | Exit Code | 实测输出摘要 |
|---|---|---|---|
| Rust 格式 | `cargo fmt --check` | `0` | 无输出（0 diff） |
| Rust Clippy | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished dev profile [optimized + debuginfo] target(s) in 0.53s` |
| Rust 全量测试 | `cargo test --workspace --offline` | `0` | 汇总全部测试 binary：**258 passed, 0 failed, 0 ignored**（含 `t4_1_import_parser_tests` 5 passed、`t4_1_import_report_tests` 4 passed、`t3_6_import_and_presets_tests` 4 passed、`t3_6_wasm_bindgen_tests` 3 passed） |
| 共享 UI | `npm --prefix packages/ui test && npm --prefix packages/ui run check && npm --prefix packages/ui run build` | `0` | Vitest: `Test Files 8 passed (8)`, `Tests 45 passed (45)`（含 `importModal.test.ts` 5 tests）；`svelte-check found 0 errors and 0 warnings`；Vite build `✓ built in 3.31s` |
| Obsidian 端 | `npm --prefix apps/obsidian test && npm --prefix apps/obsidian run check && npm --prefix apps/obsidian run test:e2e` | `0` | Vitest: `Test Files 1 passed (1)`, `Tests 14 passed (14)`；`svelte-check found 0 errors and 0 warnings`；Playwright: `5 passed (23.9s)` |
| Desktop 端 | `npm --prefix apps/desktop test && npm --prefix apps/desktop run check && npm --prefix apps/desktop run build && npm --prefix apps/desktop run test:e2e` | `0` | Vitest: `Test Files 1 passed (1)`, `Tests 4 passed (4)`；`svelte-check found 0 errors and 0 warnings`；Vite build `✓ built in 4.03s`；Playwright: `6 passed (14.8s)` |
| 插件构建与漂移 | `node obsidian-mathslot/scripts/build.mjs && git status --short` | `0` | `✓ Obsidian plugin built and verified successfully: obsidian-mathslot/main.js (3 commands, 121 catalog entries, 88/88 presets)`；`git status --short` 为空（`CLEAN_WORKTREE`，0 漂移） |
| 一键门禁 | `scripts/agent/acceptance.sh` | `0` | `PASS=5 FAIL=0 WARN=3`（`conclusion: PASS`；3 条 `WARN` 为既定非 `T4.1` 基线/冻结仓统计：`let _ =` 9 处、`unwrap()` 20 处、命令表常量 3 处） |

---

## 4. Playwright 截图视觉实查（`read_file` 逐张核验）

| 截图路径 | 实看画面与检查结论 | 判定 |
|---|---|---|
| `apps/desktop/.e2e-artifacts/import-error-blocking.png` | **单层弹窗头部** `"导入 LaTeX 公式"` + 右上角单行 `"关闭"` 按钮（无双标题、无 `"关\n闭"` 折行）；输入 `\frac{1}{` 展示红色 `"导入已阻断"` 横幅、`raw_nodes: 0`、Diff 右上角显示红色 **`语法错误已阻断`** pill（无 `RawLatex 降级` 误标）、`"确认导入"` 按钮禁用、下方主编辑器仍为 `\frac{1}{2}`；`ERROR UNCLOSED_DELIMITER` 诊断卡完整可见 | **PASS**（`D-144` / `D-146` / `D-139` 已解） |
| `apps/desktop/.e2e-artifacts/import-diff-warning.png` | 单层弹窗头部 + 单行 `"关闭"` 按钮；输入 `$$\begin{align} a &= b \\ c &= d \end{align}$$` 展示琥珀色 `"降级 RawLatex 有损转换预警"` 横幅、`raw_nodes: 1`、Diff 栏显示 `"RawLatex 降级"` 徽章与左侧 `$$` 红色删除线高亮、绿色 `"确认导入"` 按钮可用；`1280x720` 视口下 `INFO OUTER_DELIMITERS_STRIPPED`（蓝）与 `WARNING UNSUPPORTED_ENVIRONMENT`（琥珀）两张卡片及末尾 `"建议:"` 行均完整未裁切 | **PASS**（`D-146` / `D-138` / `D-140` / `D-142` 已解） |
| `apps/obsidian/.e2e-artifacts/obsidian-import-error-blocking.png` | 输入 `1 + 2}` 展示红色边框与浅红底色的 `"导入已阻断"` 横幅、`raw_nodes: 1`、Diff 右上角红色 **`语法错误已阻断 · 含 1 RawLatex`** pill、左侧删除空格高亮、禁用态 `"确认导入"` 按钮、红色边框+底色的 `ERROR UNMATCHED_DELIMITER` 卡片；主编辑器保持 `#1 分子 已填` `#2 分母 已填` | **PASS**（`D-144` / `D-145` 已解） |
| `apps/obsidian/.e2e-artifacts/obsidian-import-diff-warning.png` | 输入 `$$\begin{align} x &= 1 \end{align}$$` 展示清晰琥珀色边框与底色的 `"降级 RawLatex"` 横幅与 `"RawLatex 降级"` pill、绿色边框+浅绿底色+高对比绿字的 `"确认导入"` 按钮、Diff 左侧 `$$` 红色删除线高亮、蓝色 `INFO OUTER_DELIMITERS_STRIPPED` 与琥珀色 `WARNING UNSUPPORTED_ENVIRONMENT` 诊断卡 | **PASS**（`D-145` 已解） |

---

## 5. `T4.1` 与缺陷逐项验收对照

| ID | 要求摘要 | 实测证据 | 判定 |
|---|---|---|---|
| `D-007` / `T4.1` | 使用 `convert_latex_with_report`、展示诊断与 Diff、Error 阻断、无损/有损闭环 | Rust 258 tests + UI 45 + Obsidian 14/5 E2E + Desktop 4/6 E2E + 4 张截图全过 | **PASS** |
| `D-012` | 导入整次独立可撤销（`Ctrl+Z` 一步恢复导入前状态） | `t3_6_import_and_presets_tests.rs:231-235`、`desktop.spec.ts:213-215`、`obsidian.spec.ts:207-209` | **PASS** |
| `D-020` / `D-141` | `mathslot-syntax` 解析递归深度上限保护（5000 层不崩溃） | `t4_1_import_parser_tests.rs:96-110`、`t4_1_import_report_tests.rs:51-58`、`t3_6_wasm_bindgen_tests.rs:106-121` | **PASS** |
| `D-138` | 未知环境（`\begin{align}`）降级 `RawLatex` + `Warning`，不强转 `MatrixEnv::Matrix` | `t4_1_import_parser_tests.rs:4-25`、`t4_1_import_report_tests.rs:4-25`、双端 Diff 截图 | **PASS** |
| `D-139` | 畸形/未闭合语法必发射 Error 并阻断覆盖，清理 `syntax` 中 `let _ =`/`.unwrap()` | `t4_1_import_parser_tests.rs:66-93`、`t4_1_import_report_tests.rs:28-48`、静态扫描 0 命中 | **PASS** |
| `D-140` | 两阶段 `PreviewImportLatex` -> Diff 审阅 -> `ImportLatex` / 取消不改文档 | `t3_6_import_and_presets_tests.rs:170-226`、`importModal.test.ts`、双端 Playwright E2E | **PASS** |
| `D-142` | 外层数学定界符剥离 + `Info` 提示，单侧不配对阻断 | `t4_1_import_report_tests.rs:61-97`、双端 E2E 与 Diff 截图 | **PASS** |
| `D-143` / `D-137` | `desktopClient.ts` 移除假括号计数并统一接入 `@mathslot/wasm` | `apps/desktop/src/lib/desktopClient.ts`、`desktopUi.test.ts` 第 4 项、Desktop E2E | **PASS** |
| `D-144` | `raw_nodes === 0 && blocked` 不误标 `RawLatex 降级` | `ImportModal.svelte:196-200,272-278`、`importModal.test.ts:330-380`、E2E 与截图 | **PASS** |
| `D-145` | Obsidian `ImportModal` 错误/警告/成功/Diff 语义色值完整回退 | `tokens.css:288-496`、`harness.html:20-35`、`obsidian.spec.ts:148-189`、Obsidian 截图 | **PASS** |
| `D-146` | Desktop 弹窗单头部、单行 `"关闭"`、`1280x720` 诊断完整可见 | `App.svelte:663-680`、`styles.css:335-340`、`ImportModal.svelte:417-418`、Desktop 截图 | **PASS** |

---

## 6. 未验证 / 附注

- 桌面端 Tauri 原生 WebView 窗口未在本无头验证环境中人工启动；Desktop 浏览器 E2E 已通过 `@mathslot/wasm` 验证相同 Rust 引擎语义（`D-143`），`cargo test --workspace` 覆盖原生 Rust `App` / `mathslot-latex` / `mathslot-syntax` 全路径。
- `agent-state/state.json` 与 `agent-state/HANDOFF.md` 仍处于 Round 32 验收前状态，待 Coordinator 依据本 `VER-32` PASS 签收后统一更新关闭 `D-007`、`D-140`、`D-144`、`D-145`、`D-146` 并推进后续 `T4.*` 任务。

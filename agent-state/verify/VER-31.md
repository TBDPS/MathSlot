---
id: VER-31
round: 31
task: T4.1
defects: [D-007, D-012, D-020, D-137, D-138, D-139, D-140, D-141, D-142, D-143]
verdict: FAIL
verifier: verifier
date: 2026-11-14
commit: 9ae6840
base_commit: 46c03fc
---

# VER-31：Gate G4 / T4.1 独立验收报告

## 1. 结论

**FAIL**。

Rust 解析/深度保护/外层定界符剥离/两阶段后端命令/WASM 统一引擎（`D-138`、`D-139`、`D-141`、`D-142`、`D-143`、`D-137`、`D-012`、`D-020`）以及所有自动化测试与门禁脚本均已通过且行为正确；但**对 4 张新 T4.1 Playwright 截图的逐帧视觉与语义核查发现了 3 项 UI/主题/标签缺陷**（未附修复代码）：

1. **错误阻断时误标 `"RawLatex 降级"` 徽章**（`packages/ui/src/import/ImportModal.svelte:47-49, 267-268`）：`import-error-blocking.png` 中 `\frac{1}{` 的 `raw_nodes` 为 `0` 且处于语法错误阻断态（`blocked: true`），Diff 面板右上角仍错误渲染 `RawLatex 降级` 黄色徽章。
2. **Obsidian 端 `ImportModal` 错误/警告/成功/Diff 高亮样式完全失效**（`packages/ui/src/theme/tokens.css:290-345`、`apps/obsidian/e2e/harness.html:15-32`）：`obsidian-import-error-blocking.png` 与 `obsidian-import-diff-warning.png` 中，`导入已阻断`、`降级 RawLatex`、`ERROR`/`WARNING` 诊断卡片、`确认导入` 按钮及 Diff 删除高亮全部缺失红/琥珀/绿色边框与背景（退化为纯黑边框与白底黑字）。
3. **Desktop 弹窗双标题重复与内层「关闭」按钮竖排折行**（`apps/desktop/src/App.svelte:671-681`、`packages/ui/src/import/ImportModal.svelte:139-156, 399-408`）：`import-error-blocking.png` 与 `import-diff-warning.png` 同时渲染外层与内层两套 `"导入 LaTeX 公式"` + `"关闭"` 头部，内层 `"关闭"` 按钮被副标题挤压折行成 `"关\n闭"`；且 `import-diff-warning.png` 底部诊断卡片在 720px 视口下被裁切。

---

## 2. Diff 与代码卫生核查（`46c03fc..9ae6840`）

1. **路径权限核查**：`git diff --stat 46c03fc..9ae6840` 共 32 个文件（`+2043 / -817`），全部位于 `ADR-0032` §3 授权路径内（`crates/mathslot-{syntax,latex,app,wasm}`、`packages/ui`、`apps/desktop`、`apps/obsidian`、`obsidian-mathslot/{main.js,styles.css}`）；未改动 `docs/LLM_IMPLEMENTATION_SPEC.md`、`scripts/agent/**`、`agent-state/**` 或冻结参考目录。
2. **Red -> Green 证据**：
   - 预修复基线缺陷已由 `agent-state/audits/AUD-28.md` 在 `b12ceca`（`46c03fc` 代码快照）通过 WASM 实测复现记录。
   - 提交 `9ae6840` 将新增测试（`t4_1_import_parser_tests.rs`、`t4_1_import_report_tests.rs`、`t3_6_import_and_presets_tests.rs`、`t3_6_wasm_bindgen_tests.rs`、`importModal.test.ts`、`desktopUi.test.ts`、`desktop.spec.ts`、`obsidian.spec.ts`）与实现代码置于同一提交中；除 `crates/mathslot-app/tests/parity_report_tests.rs:1035-1088` 将含 batch-DSL 构造的预设从 `drive_app_chars` 切换为 `LoadStreamSource`（因 `D-139` 修复后裸输入 `)`/`]` 正确报错）外，未发现删除、跳过、`#[ignore]` 或弱化既有测试的行为。
3. **零 `let _ =` / 零 `.unwrap()` / 零第二套解析器与命令表 / 零硬编码色值**：
   - `rg -n "\.unwrap\(|let _ =" crates/mathslot-syntax/src crates/mathslot-latex/src crates/mathslot-app/src crates/mathslot-wasm/src packages/ui/src apps/desktop/src apps/obsidian/src` → exit code `1`（**0 处匹配**）。
   - `rg -n "fn parse\(" crates/ apps/ packages/ src/` → 仅 `crates/mathslot-syntax/src/{lib.rs,parser.rs}`（与冻结 `crates/mathslot-core/src/parser.rs`），`apps/desktop/src/lib/desktopClient.ts` 已移除手写 JS 括号计数假导入，统一接入 `@mathslot/wasm`。
   - `git diff 46c03fc..9ae6840 -- packages/ui/src/ apps/desktop/src/ apps/obsidian/src/ | rg -n "^\+.*(#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\()"` → `NO_HARDCODED_COLORS_IN_SRC`（**0 处硬编码颜色**）。

---

## 3. 命令与实测输出

| 检查项 | 命令 | Exit Code | 实测输出摘要 |
|---|---|---|---|
| Rust 格式 | `cargo fmt --check` | `0` | 无输出（0 diff） |
| Rust Clippy | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished dev profile [optimized + debuginfo] target(s) in 1.28s` |
| Rust 全量测试 | `cargo test --workspace --offline` | `0` | 总计 **258 passed, 0 failed, 0 ignored**（含 `t4_1_import_parser_tests` 5 passed、`t4_1_import_report_tests` 4 passed、`t3_6_import_and_presets_tests` 4 passed、`t3_6_wasm_bindgen_tests` 3 passed、`xtask check` 8 passed） |
| 共享 UI | `npm --prefix packages/ui test && npm --prefix packages/ui run check && npm --prefix packages/ui run build` | `0` | Vitest: `Test Files 8 passed (8)`, `Tests 44 passed (44)`；`svelte-check found 0 errors and 0 warnings`；Vite build `✓ built in 1.89s` |
| Obsidian 端 | `npm --prefix apps/obsidian test && npm --prefix apps/obsidian run check && npm --prefix apps/obsidian run test:e2e` | `0` | Vitest: `1 passed (14 tests)`；`svelte-check found 0 errors and 0 warnings`；Playwright: `5 passed (14.7s)` |
| Desktop 端 | `npm --prefix apps/desktop test && npm --prefix apps/desktop run check && npm --prefix apps/desktop run build && npm --prefix apps/desktop run test:e2e` | `0` | Vitest: `1 passed (4 tests)`；`svelte-check found 0 errors and 0 warnings`；Vite build `✓ built in 2.13s`；Playwright: `6 passed (12.7s)` |
| 插件构建与同步 | `node obsidian-mathslot/scripts/build.mjs && git status --short` | `0` | `✓ Obsidian plugin built and verified successfully: obsidian-mathslot/main.js (3 commands, 121 catalog entries, 88/88 presets)`；`git status --short` 为空（0 漂移） |
| 门禁脚本 | `scripts/agent/acceptance.sh` | `0` | `PASS=5 FAIL=0 WARN=3`（`WARN` 均位于未修改基线/冻结 crate：`let _ =` 9 处、`unwrap()` 20 处、命令表常量 3 处） |

---

## 4. WASM 实机探测结果（`apps/obsidian/src/wasm-pkg/mathslot_wasm.{js,wasm}`）

先执行 `{ ImportLatex: "\\frac{x}{y}" }`，随后分别执行 `PreviewImportLatex` 与 `ImportLatex`（node exit code `0`）：

```text
\begin{align} a &= b \\ c &= d \end{align}
  -> preview_doc="\frac{x}{y}", apply_doc="\begin{align} a &= b \\ c &= d \end{align}", blocked=false, lossless=false, raw_nodes=1, diags=[UNSUPPORTED_ENVIRONMENT:Warning]
1 + 2}
  -> preview_doc="\frac{x}{y}", apply_doc="\frac{x}{y}", blocked=true, lossless=false, raw_nodes=1, diags=[UNMATCHED_DELIMITER:Error]
a \\ b
  -> preview_doc="\frac{x}{y}", apply_doc="\frac{x}{y}", blocked=true, lossless=false, raw_nodes=1, diags=[UNEXPECTED_TOKEN:Error]
\frac{1}{
  -> preview_doc="\frac{x}{y}", apply_doc="\frac{x}{y}", blocked=true, lossless=false, raw_nodes=0, diags=[UNCLOSED_DELIMITER:Error]
\sqrt{x
  -> preview_doc="\frac{x}{y}", apply_doc="\frac{x}{y}", blocked=true, lossless=false, raw_nodes=0, diags=[UNCLOSED_DELIMITER:Error]
\unknownfoo{unclosed
  -> preview_doc="\frac{x}{y}", apply_doc="\frac{x}{y}", blocked=true, lossless=false, raw_nodes=1, diags=[UNCLOSED_DELIMITER:Error, UNKNOWN_MACRO:Warning]
"{"*5000 + "x" + "}"*5000 (len=10001)
  -> preview_doc="\frac{x}{y}", apply_doc="\frac{x}{y}", blocked=true, lossless=false, raw_nodes=1, diags=[DEPTH_EXCEEDED:Error]
$$\frac{a}{b}$$
  -> preview_doc="\frac{x}{y}", apply_doc="\frac{a}{b}", blocked=false, lossless=true, raw_nodes=0, roundtrip="\frac{a}{b}", diags=[OUTER_DELIMITERS_STRIPPED:Info]
\[\frac{a}{b}\]
  -> preview_doc="\frac{x}{y}", apply_doc="\frac{a}{b}", blocked=false, lossless=true, raw_nodes=0, roundtrip="\frac{a}{b}", diags=[OUTER_DELIMITERS_STRIPPED:Info]
$\frac{a}{b}$
  -> preview_doc="\frac{x}{y}", apply_doc="\frac{a}{b}", blocked=false, lossless=true, raw_nodes=0, roundtrip="\frac{a}{b}", diags=[OUTER_DELIMITERS_STRIPPED:Info]
\(\frac{a}{b}\)
  -> preview_doc="\frac{x}{y}", apply_doc="\frac{a}{b}", blocked=false, lossless=true, raw_nodes=0, roundtrip="\frac{a}{b}", diags=[OUTER_DELIMITERS_STRIPPED:Info]
$$\frac{a}{b}
  -> preview_doc="\frac{x}{y}", apply_doc="\frac{x}{y}", blocked=true, lossless=false, raw_nodes=0, diags=[UNCLOSED_DELIMITER:Error]
FLOW (Preview -> ImportAcknowledge -> ImportLatex("$$\sqrt{z+1}$$") -> Undo):
  -> after_preview="\frac{x}{y}", after_ack="\frac{x}{y}", ack_last_import=null, after_import="\sqrt{z+1}", after_undo="\frac{x}{y}"
```

---

## 5. 逐项验收与截图视觉核查

### 5.1 截图逐张核查（`read_file` 实看）

| 截图文件 | 观察到的内容 | 判定 |
|---|---|---|
| `apps/desktop/.e2e-artifacts/import-error-blocking.png` | `\frac{1}{` 触发红色 `导入已阻断` 横幅与 `ERROR UNCLOSED_DELIMITER` 卡片、`确认导入` 禁用、主编辑器保持 `\frac{1}{2}`；**但**：(1) 指标 `原始节点 (raw_nodes): 0` 时 Diff 标题栏却显示 **`RawLatex 降级`** 徽章；(2) 外层与内层双 `"导入 LaTeX 公式"` + `"关闭"` 重复，内层 `"关闭"` 被折行成 `"关\n闭"` | **FAIL** |
| `apps/desktop/.e2e-artifacts/import-diff-warning.png` | `$$\begin{align} a &= b \\ c &= d \end{align}$$` 展示 `降级 RawLatex` 预警、Diff 双栏高亮（左侧 `$$` 红色删除线）、`确认导入` 可点击、`INFO OUTER_DELIMITERS_STRIPPED`；**但**：(1) 双弹窗标题与内层 `"关\n闭"` 折行同样存在；(2) 底部 `WARNING UNSUPPORTED_ENVIRONMENT` 卡片的源码摘录与建议行在 720px 视口下被底部裁切 | **FAIL** |
| `apps/obsidian/.e2e-artifacts/obsidian-import-error-blocking.png` | `1 + 2}` 触发 `导入已阻断` 文案与 `ERROR UNMATCHED_DELIMITER` 诊断、`确认导入` disabled、下方编辑区保持 `\frac{1}{2}`；**但**：错误横幅、错误诊断卡片与 Diff 差异标记均**无红色错误边框/底色/文字对比**（全部呈纯黑边框 + 白底黑字） | **FAIL** |
| `apps/obsidian/.e2e-artifacts/obsidian-import-diff-warning.png` | `$$\begin{align} x &= 1 \end{align}$$` 展示 `降级 RawLatex`、`确认导入` 启用、`INFO` 与 `WARNING` 卡片；**但**：`降级 RawLatex` 横幅/徽章、`RawLatex 降级` pill、`WARNING UNSUPPORTED_ENVIRONMENT` 卡片、`确认导入` 按钮及 Diff 中移除的 `$$` 均**完全缺失警告/成功/删除色值与边框高亮**（仅 `INFO` 卡片因定义了 `--interactive-accent` 而显示蓝色） | **FAIL** |

### 5.2 验收对照表

| 验收/缺陷 ID | 期望 | 实测 | 判定 |
|---|---|---|---|
| `D-138`（未知环境） | `\begin{align}...\end{align}` 保留 `RawLatex` + `UNSUPPORTED_ENVIRONMENT` Warning，不强转 `MatrixEnv::Matrix` | Rust 单测与 WASM 实测均返回 `raw_nodes=1, lossless=false, blocked=false, UNSUPPORTED_ENVIRONMENT` | **PASS** |
| `D-139`（畸形/未闭合） | `1 + 2}`、`a \\ b`、`\frac{1}{`、`\sqrt{x`、`\unknownfoo{unclosed` 均报 Error 并阻断，不吞源码、消除 `parser/lexer` `let _ =`/`.unwrap()` | Rust 单测与 WASM 实测全部 `blocked=true` 且保留 `\unknownfoo{unclosed`；`syntax/src` 0 `.unwrap()` / 0 `let _ =` | **PASS** |
| `D-141` / `D-020`（栈深） | 5000 层 `{` 触发 `DEPTH_EXCEEDED` Error，不崩溃 | Rust 与 WASM 实测均返回 `DEPTH_EXCEEDED` 并安全阻断 | **PASS** |
| `D-142`（外层定界符） | `$$...$$`、`\[...\]`、`$...$`、`\(...\)` 剥离并报 `Info`，单侧不配对阻断 | Rust 与 WASM 实测均正确剥离并保留原始输入做 Diff | **PASS** |
| `D-143` / `D-137`（统一引擎与 E2E） | `desktopClient.ts` 移除 JS 括号计数假导入并走 `@mathslot/wasm`，双端 E2E 覆盖阻断/Diff/取消/一步撤回 | `desktopClient.ts` 已接入 `WasmEngine`；Desktop (6) & Obsidian (5) E2E 全过 | **PASS** |
| `D-140` / `D-007` / `T4.1`（两阶段 Diff 与 UI 视觉准确性） | 预览不改文档、Diff 准确标注、`RawLatex` 徽章与 `raw_nodes` 一致、双端主题/错误警告边框/对比度与弹窗布局正确 | 逻辑闭环与 `Ctrl+Z` 一步撤回正确；但存在错误阻断误标 `RawLatex 降级`、Obsidian 缺失错误/警告/Diff 样式色值、Desktop 弹窗双头部与 `"关\n闭"` 折行 | **FAIL** |

---

## 6. 阻断原因与最小复现

1. **Error 阻断场景 (`raw_nodes === 0`) 误显示 `"RawLatex 降级"` 徽章**：
   - **复现**：打开 Desktop 或 Obsidian 的 LaTeX 导入弹窗，输入 `\frac{1}{` 并点击「解析并预览」，观察 `apps/desktop/.e2e-artifacts/import-error-blocking.png`。
   - **期望 vs 实际**：`原始节点 (raw_nodes)` 为 `0` 且当前为语法错误阻断（`blocked: true`），Diff 标题徽章应反映语法错误/已阻断（而非 `RawLatex 降级`）；实际显示黄色 `RawLatex 降级` pill。
   - **位置**：`packages/ui/src/import/ImportModal.svelte:47-49, 267-273`（`isDegraded` 将 `!lossless` 与 `raw_nodes > 0` 混为一谈，且 Diff 标题优先命中 `isDegraded` 而未排除 `activeReport.blocked` / `raw_nodes === 0`）。
2. **Obsidian 端错误/警告/成功/Diff 语义颜色在宿主缺少 `--text-{error,warning,success}` 时失效**：
   - **复现**：运行 `npm --prefix apps/obsidian run test:e2e`，打开 `apps/obsidian/.e2e-artifacts/obsidian-import-error-blocking.png` 与 `obsidian-import-diff-warning.png`。
   - **期望 vs 实际**：错误横幅/卡片应呈现红色边框与浅红底色，警告/降级横幅与徽章应呈现琥珀色，确认按钮与新增高亮应呈现绿色，被剥离的 `$$` 应呈现红色删除线底色；实际全部退化为纯黑边框与白底黑字。
   - **位置**：
     - `packages/ui/src/theme/tokens.css:290-345`（`[data-host='obsidian']` 映射中 `--text-error`、`--text-warning`、`--text-success` 缺少 CSS fallback 值）；
     - `apps/obsidian/e2e/harness.html:15-32`（`body.theme-light` / `body.theme-dark` 未定义 `--text-error`、`--text-warning`、`--text-success`）。
3. **Desktop 弹窗头部重复与内层「关闭」按钮折行**：
   - **复现**：在 Desktop 打开 `ImportModal` 并点击「解析并预览」，观察 `apps/desktop/.e2e-artifacts/import-error-blocking.png` 与 `import-diff-warning.png`。
   - **期望 vs 实际**：弹窗应只有一个标题栏且「关闭」按钮单行显示、不发生竖向折行；实际同时渲染外层 `.ms-modal-header` 与内层 `.ms-import-header` 两套 `"导入 LaTeX 公式"` + `"关闭"`，且内层 `"关闭"` 折成两行（`"关\n闭"`）。
   - **位置**：`apps/desktop/src/App.svelte:671-681` 与 `packages/ui/src/import/ImportModal.svelte:139-156, 399-408`。

---

## 7. 未验证 / 附注

- `crates/mathslot-app/tests/parity_report_tests.rs:1185-1200` 中 `P-PRESET-88:d007-deferred-boundary` 的说明文本仍保留 `"explicitly scheduled for Gate G4 T4.1"`，可在后续清理。
- `agent-state/state.json` 尚未更新为关闭 `D-007` / `T4.1`（按仓库规则由 Coordinator 在验收通过后更新）。
- 桌面端 Tauri 原生二进制手工图形走查未执行（Browser E2E 走 `@mathslot/wasm` 验证）。

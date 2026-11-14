---
id: AUD-28
round: 31
gate: G4
scope:
  - T4.1
  - D-007
  - D-012
  - D-020
  - D-137
verdict: BLOCK
auditor: auditor
date: 2026-11-14
base_commit: b12ceca
---

# AUD-28：Gate G4 / T4.1（LaTeX 导入诊断、Diff 审阅、Round-Trip 与 D-007 验收）只读审计报告

## 1. 判定摘要

- **总体结论**：**`BLOCK`**（不可直接签收 `T4.1` / `D-007`）。
- **核心发现**：
  1. **`D-007` 实为 `OPEN`（P1）**：尽管 `agent-state/state.json` 已提前将 `"D-007"` 列入 `closed_defects`，但 `crates/mathslot-app/tests/parity_report_tests.rs:1177-1190` 明确记录了 `DELTA-D007-DEFERRED-G4`（"scheduled for Gate G4 T4.1"），且当前从 Rust 解析诊断 → `mathslot-app` 导入确认闭环 → `ImportModal.svelte` 原文 vs `roundtrip_latex` 对比审阅与取消/应用流 → 浏览器/E2E 真引擎一致性均存在实质缺口。
  2. **解析与诊断漏报（新缺陷 `D-138`, `D-139`）**：统一语法栈 `mathslot-syntax` 对不支持环境（如 `\begin{align}`）静默降级为 `MatrixEnv::Matrix` 且 `lossless: true, diagnostics: []`；对 `\frac{1}{`、`\sqrt{x` 未闭合花括号静默自动补全且 `diagnostics: []`；对多余 `}`、`\\` 等产生 `Expr::Error` 却不写 `diagnostics`，导致 `blocked: false` 直接覆盖主文档；对 `\unknownfoo{unclosed` 静默丢弃 `{unclosed`。
  3. **UI 审阅与 Apply/Cancel 闭环缺失（新缺陷 `D-140`）**：`ImportModal.svelte` 点击"解析并导入"后直接派发 `ImportLatex` 改写主编辑器文档，既未展示**输入原文 vs `roundtrip_latex` 结构化/逐行 diff 对比**，也没有先预览降级/诊断再**确认应用（Apply）**或**取消放弃（不污染主编辑区）**的交互。
  4. **深度保护、定界符与双端 E2E 缺口（新缺陷 `D-141`, `D-142`, `D-143` + `D-137`）**：`mathslot-syntax` 缺少 `D-020` 的解析递归深度上限，5000 层 `{` 在 WASM 实测触发 `RangeError: Maximum call stack size exceeded`；`\[...\]` 导入报错且产生 3 个 `RawLatex`，`$...$`/`$$...$$` 原样把 `$` 写入公式 AST；Desktop `createBrowserHarnessBridge`（`D-137`）以括号计数冒充 `ImportLatex`，双端 E2E 未覆盖 Warning/RawLatex diff 审阅、取消不覆盖、Obsidian Error 阻断及 `Ctrl+Z` 整次导入撤销。

| 编号 | 状态 Verdict | 严重度 | 摘要 |
|---|---|---|---|
| `D-007` | **`OPEN`** | P1 | LaTeX 导入诊断 / diff / 审阅 / 边缘损坏阻断未完成端到端达标 |
| `D-012` | **`FIXED`**（引擎层）/ E2E 缺口见 `D-143` | P1 | `Intent::Import` 整次可撤销已在 `mathslot-doc` 与 `mathslot-app` 验证，但双端 Playwright 缺实测 |
| `D-020` | **`OPEN`**（未迁入 `mathslot-syntax`，见 `D-141`） | P2 | `mathslot-core` 有 `MAX_PARSE_DEPTH = 256`，现行主路径 `mathslot-syntax` 无深度上限导致 WASM 栈溢出 |
| `D-137` | **`OPEN`** | P3 | Desktop `createBrowserHarnessBridge` 脱离真实引擎，其中 `ImportLatex` 逻辑分叉直接影响 `T4.1` E2E 可信度 |
| `D-138` | **`OPEN`**（新增） | P1 | `parse_matrix` 将 `\begin{align}` 等不支持环境静默强转为 `MatrixEnv::Matrix`，`lossless=true, diagnostics=[]` |
| `D-139` | **`OPEN`**（新增） | P1 | `parse_root`/`parse_fraction`/`parse_sqrt`/`parse_unknown_macro` 多类畸形输入无 Error 诊断或静默丢字，误改写主文档 |
| `D-140` | **`OPEN`**（新增） | P1 | `ImportModal.svelte` 与 `mathslot-app` 缺 Input vs Round-Trip diff 展示及预览→确认应用/取消放弃闭环 |
| `D-141` | **`OPEN`**（新增） | P2 | `crates/mathslot-syntax/src/parser.rs` 无递归深度保护，5000 层嵌套崩溃（`Maximum call stack size exceeded`） |
| `D-142` | **`OPEN`**（新增） | P2 | `\[...\]` 与 `$...$`/`$$...$$` 外层数学定界符导入处理异常（`\[...\]` 报错阻断；`$` 残留进公式 AST） |
| `D-143` | **`OPEN`**（新增） | P2 | Desktop harness mock `ImportLatex` 与真实 `ImportReport` 反向分叉，且双端 E2E 缺 diff/取消/Undo 覆盖 |

---

## 2. 实跑命令与只读探测证据

| 检查项 | 命令 | Exit Code | 实测输出摘要 |
|---|---|---|---|
| 状态恢复基线 | `scripts/agent/resume.sh` | 0 | `gate=G4 round=31 active=T4.1 next=T4.1 open_p1=- branch=refactor/v1 head=b12ceca dirty=0` |
| 一键门禁 | `scripts/agent/acceptance.sh` | 0 | `PASS cargo fmt --check`; `PASS cargo clippy -D warnings`; `PASS cargo test --workspace`; `PASS 调色板一致性 (gate=G4)`; `WARN let _ = 计数 14 处`; `WARN unwrap() 计数 20 处`; `WARN 命令表常量 3 处`; `PASS 工作区干净` (`PASS=5 FAIL=0 WARN=3`) |
| 6 产物同步校验 | `cargo run -p xtask -- check --offline` | 0 | `[xtask] Check PASSED: All 6 artifacts are up-to-date and clean.` |
| 导入链路 Rust 测试 | `cargo test -p mathslot-latex -p mathslot-syntax -p mathslot-app -p mathslot-doc -p mathslot-wasm --offline` | 0 | `mathslot-app`: 28 passed; `mathslot-doc`: 24 passed; `mathslot-latex`: 5 passed; `mathslot-syntax`: 23 passed; `mathslot-wasm`: 2 passed（0 failed, 0 ignored） |
| 共享 UI 单测与类型检查 | `cd packages/ui && npm test && npm run check` | 0 | `Test Files 8 passed (8)`, `Tests 42 passed (42)`（含 `tests/importModal.test.ts` 2 tests）; `svelte-check found 0 errors and 0 warnings` |
| Obsidian 集成与类型检查 | `cd apps/obsidian && npm test && npm run check` | 0 | `Test Files 1 passed (1)`, `Tests 14 passed (14)`; `svelte-check found 0 errors and 0 warnings` |
| Desktop 集成与类型检查 | `cd apps/desktop && npm test && npm run check` | 0 | `Test Files 1 passed (1)`, `Tests 3 passed (3)`; `svelte-check found 0 errors and 0 warnings` |
| WASM 实机只读探测 | `node --input-type=module -e '... Engine().dispatch({ ImportLatex: c }) ...'`（针对 `apps/obsidian/src/wasm-pkg/mathslot_wasm.{js,wasm}`） | 0 | 复现 `\begin{align}`、`1 + 2}`、`a \\ b`、`\frac{1}{`、`\sqrt{x`、`\unknownfoo{unclosed`、`\[...\]`、`$...$` 及 5000 层嵌套崩溃（详见证据下节） |
| 禁用模式扫描 | `rg -n "\.unwrap\(|let _ =" crates/mathslot-syntax/src crates/mathslot-latex/src crates/mathslot-app/src crates/mathslot-doc/src crates/mathslot-wasm/src packages/ui/src` | 0 | `parser.rs` 含 12 处 `.unwrap()` 与 5 处 `let _ =`; `lexer.rs:284` 1 处; `document.rs` 3 处; `mathslot-latex`/`mathslot-app`/`mathslot-wasm`/`packages/ui` 均为 0 处 |

**WASM 实机只读探测关键输出（先导入 `\frac{x}{y}` 再导入目标串，观察 `snap.latex` 与 `snap.last_import`）**：

```text
CASE: "\\frac{1}{" | doc_latex: "\\frac{1}{}" | lossless: true | blocked: false | raw_nodes: 0 | empty_slots: 1 | norm_match: false | roundtrip: "\\frac{1}{}" | diags: []
CASE: "\\frac{1}{2" | doc_latex: "\\frac{1}{2}" | lossless: true | blocked: false | raw_nodes: 0 | empty_slots: 0 | norm_match: false | roundtrip: "\\frac{1}{2}" | diags: []
CASE: "\\sqrt{x" | doc_latex: "\\sqrt{x}" | lossless: true | blocked: false | raw_nodes: 0 | empty_slots: 0 | norm_match: false | roundtrip: "\\sqrt{x}" | diags: []
CASE: "\\left(\\frac{a}{b}" | doc_latex: "\\frac{x}{y}" | lossless: false | blocked: true | raw_nodes: 0 | empty_slots: 0 | norm_match: false | roundtrip: "\\left( \\frac{a}{b} \\right)" | diags: [{"code":"UNCLOSED_DELIMITER","severity":"Error","message":"Unclosed delimiter: \\right",...}]
CASE: "\\left(\\frac{a}{b}\\right)" | doc_latex: "\\left( \\frac{a}{b} \\right)" | lossless: true | blocked: false | raw_nodes: 0 | empty_slots: 0 | norm_match: false | roundtrip: "\\left( \\frac{a}{b} \\right)" | diags: []
CASE: "\\begin{pmatrix} a & b" | doc_latex: "\\frac{x}{y}" | lossless: false | blocked: true | ... | diags: [{"code":"UNCLOSED_ENVIRONMENT","severity":"Error","message":"Unclosed environment: pmatrix",...}]
CASE: "\\begin{pmatrix} a & b \\end{bmatrix}" | doc_latex: "\\frac{x}{y}" | lossless: false | blocked: true | raw_nodes: 1 | ... | diags: [{"code":"EXPECTED_TOKEN",...},{"code":"EXPECTED_TOKEN",...}]
CASE: "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}" | doc_latex: "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}" | lossless: true | blocked: false | raw_nodes: 0 | empty_slots: 0 | norm_match: true | roundtrip: "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}" | diags: []
CASE: "\\begin{align} a &= b \\\\ c &= d \\end{align}" | doc_latex: "\\begin{matrix} a & =b \\\\ c & =d \\end{matrix}" | lossless: true | blocked: false | raw_nodes: 0 | empty_slots: 0 | norm_match: false | roundtrip: "\\begin{matrix} a & =b \\\\ c & =d \\end{matrix}" | diags: []
CASE: "\\unknownfoo{bar}" | doc_latex: "\\unknownfoo{bar}" | lossless: false | blocked: false | raw_nodes: 1 | empty_slots: 0 | norm_match: true | roundtrip: "\\unknownfoo{bar}" | diags: [{"code":"UNKNOWN_MACRO","severity":"Warning","message":"Unknown LaTeX macro: \\unknownfoo",...}]
CASE: "\\unknownfoo{unclosed" | doc_latex: "\\unknownfoo" | lossless: false | blocked: false | raw_nodes: 1 | empty_slots: 0 | norm_match: false | roundtrip: "\\unknownfoo" | diags: [{"code":"UNKNOWN_MACRO","severity":"Warning","message":"Unknown LaTeX macro: \\unknownfoo",...,"span":{"start":0,"end":11}}]
CASE: "\\newcommand{\\foo}[1]{#1}" | doc_latex: "\\newcommand{\\foo}[1]{#1}" | lossless: false | blocked: false | raw_nodes: 1 | empty_slots: 0 | norm_match: true | roundtrip: "\\newcommand{\\foo}[1]{#1}" | diags: [{"code":"UNKNOWN_MACRO","severity":"Warning","message":"Unknown LaTeX macro: \\newcommand",...,"span":{"start":0,"end":17}}]
CASE: "{1 + 2" | doc_latex: "\\frac{x}{y}" | lossless: false | blocked: true | raw_nodes: 0 | empty_slots: 0 | norm_match: false | roundtrip: "{1+2}" | diags: [{"code":"UNCLOSED_DELIMITER","severity":"Error","message":"Unclosed delimiter: }",...}]
CASE: "1 + 2}" | doc_latex: "1+2}" | lossless: false | blocked: false | raw_nodes: 1 | empty_slots: 0 | norm_match: false | roundtrip: "1+2}" | diags: []
CASE: "a \\\\ b" | doc_latex: "a\\\\b" | lossless: false | blocked: false | raw_nodes: 1 | empty_slots: 0 | norm_match: false | roundtrip: "a\\\\b" | diags: []
CASE: "$$\\frac{a}{b}$$" | doc_latex: "$$\\frac{a}{b}$$" | lossless: true | blocked: false | raw_nodes: 0 | empty_slots: 0 | norm_match: true | roundtrip: "$$\\frac{a}{b}$$" | diags: []
CASE: "$\\frac{a}{b}$" | doc_latex: "$\\frac{a}{b}$" | lossless: true | blocked: false | raw_nodes: 0 | empty_slots: 0 | norm_match: true | roundtrip: "$\\frac{a}{b}$" | diags: []
CASE: "\\[\\frac{a}{b}\\]" | doc_latex: "\\frac{x}{y}" | lossless: false | blocked: true | raw_nodes: 3 | empty_slots: 0 | norm_match: false | roundtrip: "\\[\\frac{a}{b}]\\]" | diags: [{"code":"UNCLOSED_DELIMITER","severity":"Error","message":"Unclosed delimiter: ]",...}]
CASE: "▸f;;" | doc_latex: "\\frac{}{}" | lossless: true | blocked: false | raw_nodes: 0 | empty_slots: 2 | norm_match: false | roundtrip: "\\frac{}{}" | diags: []
DEPTH_5000: CRASHED: RangeError Maximum call stack size exceeded
```

---

## 3. 端到端链路逐项核查

### 3.1 Rust 导入解析与诊断报告 (`D-007`)

1. **已支持结构 round-trip**：
   - `crates/mathslot-syntax/tests/golden_tests.rs` 与 `crates/mathslot-latex/tests/latex_tests.rs` 已有 15 个 golden 测试和 5 个报告测试（GT-01 ~ GT-08 覆盖积分、高阶上下标嵌套、`\frac`、`\sqrt`、`\sum`、`\left(...\right)`、`pmatrix`、`bmatrix`、未知宏回退），全部通过。
   - **缺口**：缺少常见结构 `\begin{cases}`/`\begin{vmatrix}` 测试及畸形嵌套（如 `\frac{1}{`、`\sqrt{x`）的负向测试。
2. **`convert_latex_with_report` 与 `ImportReport` 语义**：
   - `crates/mathslot-latex/src/import.rs:103, 124-125` 正确将 `Expr::RawLatex | Expr::Error` 计入 `raw_nodes`，并将 `lossless = (raw_nodes == 0) && !has_fatal`。
   - `crates/mathslot-app/src/app.rs:608-685` 在 `AppCommand::ImportLatex` 中先调用 `convert_latex_with_report(&latex)`，若 `blocked = report.has_errors()` 则不修改 `self.editor`（`test d123_import_latex_error_blocks_replace_all_and_preserves_document` 通过），否则立即执行 `self.editor.import_latex(&latex)`（且有二次重解析成本）。
   - **致命解析漏洞（见 `D-138`、`D-139`）**：只要 `mathslot-syntax` 没有把错误写进 `self.diagnostics`（例如 `parse_root` 仅生成 `Expr::Error` 却不调用 `self.diagnostics.push(...)`、`parse_matrix` 对未知环境 fallback 到 `MatrixEnv::Matrix`、`parse_fraction`/`parse_sqrt` 用 `self.eat(&Token::RBrace)` 吞掉未闭合括号、`parse_unknown_macro` 在 EOF 时丢弃未闭合参数），`blocked` 便恒为 `false`，`ImportLatex` 直接用损坏结果覆盖主文档！

### 3.2 双端 UI `ImportModal.svelte` 与 diff / 审阅闭环

1. **当前行为（`packages/ui/src/import/ImportModal.svelte:46, 125, 182-189`）**：
   - `ImportModal.svelte` 只有单一按钮 `解析并导入`（L125），点击后 `handleSubmit`（L46）直接派发 `{ ImportLatex: inputLatex }`。
   - 报告区（L182-189）仅渲染 `<code data-testid="import-roundtrip-latex">{activeReport.roundtrip_latex}</code>`，**既不并排展示输入原文与 `roundtrip_latex` 的结构/逐行 diff 高亮标记，也没有"先预览诊断/降级 → 用户决定确认应用（Apply）还是取消放弃（不改写文档）"的两阶段闭环**（见 `D-140`）。
   - 对于含 Warning / `RawLatex` 降级的导入（如 `\unknownfoo{bar}` 或 `1 + 2}`），当前在用户看到弹窗内警告前，主编辑器的文档**已经被覆写**；即使随后点击关闭或取消按钮，降级后的结果仍留在主编辑器中。
2. **双端宿主接线**：
   - `apps/obsidian/src/AppShell.svelte:542-561` 正确接入 `ImportModal` 并在 `onImported` 中保持弹窗打开供审阅（`D-133` 修复），但受限于 `AppEvent`（`crates/mathslot-app/src/event.rs:34-35` 仅含 `ImportLatex(String)` / `ImportAcknowledge`）与 `ImportModal.svelte` 本身，无法实现无损/有损差异对比后的"取消放弃"。
   - `apps/desktop/src/App.svelte`（L489-509 为主编辑器区域）同样复用共享 `ImportModal`，存在完全相同的预览/diff/取消闭环缺口。

### 3.3 测试与真机逻辑分叉（关联 `D-137`）与双端 E2E 覆盖

1. **`createBrowserHarnessBridge` 分叉核查**：
   - `apps/desktop/src/lib/desktopClient.ts:234-274, 618-650` 在浏览器 E2E harness 中用手写 `checkBalancedLatex` 仅检查 `{`/`}` 平衡：
     - 未知宏（如 `desktop.spec.ts:158` 的 `\unknownFallbackTest{x}`）在 harness 中被伪造为 `lossless: true, raw_nodes: 0, blocked: false, diagnostics: []`，与真实 Rust/WASM 引擎（`lossless: false, raw_nodes: 1, UNKNOWN_MACRO Warning`）截然相反。
     - `1 + 2}` 在 harness 中被判 `blocked: true`，而在真实 Rust/WASM 中实测 `blocked: false`（覆盖主文档）。
     - `roundtrip_latex` 在 harness 中原样回显 `event.ImportLatex`，完全绕过了真实 AST round-trip 与规范化对比。
2. **双端 E2E 覆盖核查**：
   - `apps/desktop/tests/e2e/desktop.spec.ts` 虽然跑了 `ImportModal`，但因依赖 harness 假逻辑，既无法验证真实 `RawLatex`/Warning diff，也未测试"取消放弃不污染文档"与"导入后一步 `Ctrl+Z` 撤销整次导入（`D-012`）"。
   - `apps/obsidian/tests/obsidian.test.ts` 的 jsdom 集成测试覆盖了 `A-OBS-005`（Error 阻断）与 `D-133`（非阻断保留报告窗口），但 `apps/obsidian/tests/e2e/obsidian.spec.ts` 对 `ImportModal` 的 Error 阻断、Warning diff 审阅、取消不覆盖及 `Ctrl+Z` 整次撤销均为零覆盖（见 `D-143`）。

### 3.4 关联不变量与代码卫生扫描 (`D-012` / `D-020` / `let _ =` / `.unwrap()`)

- **`D-012`（导入独立可撤销）**：`crates/mathslot-app/tests/app_state_machine_tests.rs:434-503` 与 `crates/mathslot-doc/tests/history_intent_tests.rs` 的 `test_import_and_clear_are_single_undoable_transactions_with_selection` 验证了单步撤销整次导入并将编辑器恢复至导入前状态，**引擎层 `FIXED`**；缺 UI E2E 联动测试。
- **`D-020`（超深嵌套与崩溃防护）**：`crates/mathslot-core/src/parser.rs:297` 存在 `const MAX_PARSE_DEPTH: usize = 256;`，但现行主路径 `crates/mathslot-syntax/src/parser.rs` 未迁移任何深度限制，5000 层 `{...}` 导致 WASM 直接抛出 `RangeError: Maximum call stack size exceeded`（新登记为 `D-141`）。
- **`let _ =` 与 `.unwrap()` 扫查**：
  - `mathslot-latex/src`、`mathslot-app/src`、`mathslot-wasm/src`、`packages/ui/src`：**0 处** `let _ =`、**0 处** `.unwrap()`。
  - `crates/mathslot-syntax/src/parser.rs` 存在 **12 处** `.unwrap()`（`91, 126, 200, 205, 411, 441, 481, 645, 680, 726, 771, 884`）与 **5 处** `let _ = self.expect(...)`（`774, 787, 827, 828, 829`）；`crates/mathslot-syntax/src/lexer.rs:284` 1 处；`crates/mathslot-doc/src/document.rs:651, 824, 847` 3 处。其中 `parser.rs` 虽多位于已 `peek` 守卫分支，但 `774, 787, 827-829` 吞掉了 `expect` 返回值，与 `D-138`/`D-139` 的错误诊断质量直接相关，建议一并清理以符合不变量约束。

---

## 4. 新发现缺陷清单（自 `D-138` 起）

### `D-138`（P1 | `OPEN`）：不支持的 LaTeX 环境（如 `\begin{align}`）被静默强转为 `matrix` 且报告无损零诊断
- **位置**：`crates/mathslot-syntax/src/parser.rs:789`
  - `let env = MatrixEnv::from_latex_name(env_name).unwrap_or(MatrixEnv::Matrix);`
- **复现命令**：
  - `node --input-type=module -e 'import fs from "node:fs"; import init, { Engine } from "./apps/obsidian/src/wasm-pkg/mathslot_wasm.js"; await init({ module_or_path: fs.readFileSync("./apps/obsidian/src/wasm-pkg/mathslot_wasm_bg.wasm") }); const e = new Engine(); console.log(JSON.parse(e.dispatch(JSON.stringify({ ImportLatex: "\\begin{align} a &= b \\\\ c &= d \\end{align}" }))).snapshot.last_import);'`（exit code 0）
- **实测输出**：`doc_latex: "\\begin{matrix} a & =b \\\\ c & =d \\end{matrix}" | lossless: true | blocked: false | raw_nodes: 0 | roundtrip: "\\begin{matrix} a & =b \\\\ c & =d \\end{matrix}" | diags: []`
- **影响**：非矩阵环境被静默篡改语义（`\begin{align}` 变成 `\begin{matrix}`）且不产生任何 `RawLatex` 降级或诊断提示，违背 `D-007` 对不支持构造准确记录 `lossless`/`raw_nodes`/`diagnostics` 的要求。

### `D-139`（P1 | `OPEN`）：多种畸形/未闭合 LaTeX 语法缺失 Error 诊断或静默丢弃源码，导致损坏内容穿透阻断并覆盖主文档
- **位置**：
  1. `crates/mathslot-syntax/src/parser.rs:124-135`（`parse_root` 对多余 `}`、`\\` 等仅生成 `Expr::Error`，未调用 `self.diagnostics.push(...)`）
  2. `crates/mathslot-syntax/src/parser.rs:683-712, 729-755, 844-852`（`parse_fraction`、`parse_sqrt`、`parse_style_command` 使用 `self.eat(&Token::RBrace)` 吞掉缺失右花括号而无任何诊断）
  3. `crates/mathslot-syntax/src/parser.rs:879-895`（`parse_unknown_macro` 当后续 `{` 未闭合到达 EOF 时，`macro_end` 停在命令名末尾，未闭合部分 `{unclosed` 被静默丢弃且无 `UNCLOSED_DELIMITER` Error）
- **复现命令与实测输出**（同上 WASM 探测，exit code 0）：
  - `"1 + 2}"` → `doc_latex: "1+2}" | lossless: false | blocked: false | raw_nodes: 1 | diags: []`（覆盖了原文档 `\frac{x}{y}`）
  - `"a \\\\ b"` → `doc_latex: "a\\\\b" | lossless: false | blocked: false | raw_nodes: 1 | diags: []`
  - `"\\frac{1}{"` → `doc_latex: "\\frac{1}{}" | lossless: true | blocked: false | raw_nodes: 0 | diags: []`
  - `"\\sqrt{x"` → `doc_latex: "\\sqrt{x}" | lossless: true | blocked: false | raw_nodes: 0 | diags: []`
  - `"\\unknownfoo{unclosed"` → `doc_latex: "\\unknownfoo" | lossless: false | blocked: false | raw_nodes: 1 | roundtrip: "\\unknownfoo"`（`{unclosed` 静默丢失，无 Error 阻断）
- **影响**：`UNMATCHED_BRACE` / `UNCLOSED_DELIMITER` / `SYNTAX_ERROR` 漏报，无法保证含 Error 时严格阻断不改写当前编辑区文档。

### `D-140`（P1 | `OPEN`）：`ImportModal.svelte` 与 `mathslot-app` 缺少 Input vs `roundtrip_latex` Diff 展示及预览确认/取消不污染闭环
- **位置**：
  - `packages/ui/src/import/ImportModal.svelte:46, 125, 182-189`
  - `crates/mathslot-app/src/app.rs:608-685` & `crates/mathslot-app/src/event.rs:34-35`
  - `packages/ui/src/client/engine.ts:224-232, 251`
- **事实证据**：`ImportModal.svelte:182-189` 仅以单个 `<code>` 展示 `activeReport.roundtrip_latex`，无"输入 LaTeX vs 往返 `roundtrip_latex`"对照或差异高亮/标记；`AppCommand::ImportLatex` 在 `!blocked` 时立即执行 `self.editor.import_latex(&latex)`（`app.rs:640-644`），使点击"解析并导入"瞬间直接改写编辑器状态，用户无法在审阅 `RawLatex`/Warning 降级差异后选择"取消放弃（保持原文档不变）"或"确认应用"。
- **影响**：无法满足 `D-007`（"展示诊断/diff"）及用户对有损导入先审阅再决定是否写入文档的安全语义。

### `D-141`（P2 | `OPEN`）：`mathslot-syntax` 解析器缺少深度上限（`D-020` 未迁入统一语法栈），超深嵌套 LaTeX 导入导致崩溃
- **位置**：`crates/mathslot-syntax/src/parser.rs`（对比已冻结旧实现 `crates/mathslot-core/src/parser.rs:297` 的 `const MAX_PARSE_DEPTH: usize = 256;`）
- **复现命令与实测输出**：
  - WASM 探测导入 `"{".repeat(5000) + "x" + "}".repeat(5000)` → `DEPTH_5000: CRASHED: RangeError Maximum call stack size exceeded`
- **影响**：用户粘贴恶意/机器生成超深公式会导致前端 WASM 或桌面端直接崩溃，而非返回结构化 `DEPTH_EXCEEDED` Error 诊断并安全阻断。

### `D-142`（P2 | `OPEN`）：外层数学定界符（`\[...\]`、`$...$`、`$$...$$`）导入处理与提示缺失
- **位置**：`crates/mathslot-syntax/src/{lexer.rs, parser.rs}`、`crates/mathslot-latex/src/import.rs`
- **复现命令与实测输出**：
  - `"\\[\\frac{a}{b}\\]"` → `lossless: false | blocked: true | raw_nodes: 3 | roundtrip: "\\[\\frac{a}{b}]\\]" | diags: [{"code":"UNCLOSED_DELIMITER","severity":"Error","message":"Unclosed delimiter: ]",...}]`
  - `"$$\\frac{a}{b}$$"` → `doc_latex: "$$\\frac{a}{b}$$" | lossless: true | diags: []`（外层 `$$` 未剥离也无提示，直接嵌入数学 AST）
  - `"$\\frac{a}{b}$"` → `doc_latex: "$\\frac{a}{b}$" | lossless: true | diags: []`
- **影响**：从论文/Obsidian 复制带定界符的公式导入时，`\[...\]` 必失败阻断，`$...$`/`$$...$$` 导致预览及导出产生双层 `$$$$\frac{a}{b}$$$$`。

### `D-143`（P2 | `OPEN`）：Desktop harness 假冒 `ImportLatex` 逻辑（关联 `D-137`）且双端 E2E 缺 `D-007`/`D-012` 关键场景覆盖
- **位置**：
  - `apps/desktop/src/lib/desktopClient.ts:234-274, 618-650`
  - `apps/desktop/tests/e2e/desktop.spec.ts:158`
  - `apps/obsidian/tests/e2e/obsidian.spec.ts`
- **事实证据**：`desktopClient.ts` 中的浏览器 harness `ImportLatex` 不计算真实 AST、不识别未知宏（`desktop.spec.ts:158` 断言 `\unknownFallbackTest{x}` 却实走无诊断假成功）、对 `1 + 2}` 返回与真机相反的 `blocked`；且 Desktop 与 Obsidian Playwright E2E 均未覆盖 Warning/RawLatex diff 审阅、取消不覆盖文档、Obsidian 真实 WASM Error 阻断及导入后一步 `Ctrl+Z` 整次撤销（`D-012`）。

---

## 5. 历史结论抽查（2 条）

1. **`docs/ACCEPTANCE_REPORT_FINAL.md:40-44`**：历史报告曾声明 `cargo clippy --workspace -- -D warnings` "0 warnings" 与 `cargo fmt --workspace -- --check` "0 diff"。核对 `docs/LLM_IMPLEMENTATION_SPEC.md` §3 (`F-004`) 及 `AGENTS.md` §3 可知，重构基线 G0 时 `clippy -D warnings` 实际仍失败；仅靠历史文本不可信，须以每轮实跑为准。
2. **`docs/FINAL_OVERHAUL_ACCEPTANCE_REPORT.md:206-207`**：历史报告曾声称"导入有损时 UI 明确警告，不静默替换"。经本轮代码审查与 WASM 实测核对，`ImportModal.svelte` 点击导入会直接改写编辑器且无原文 vs `roundtrip_latex` diff 审阅与取消放弃闭环（`D-140`），同时 `mathslot-syntax` 对 `\begin{align}`、`1 + 2}`、`\frac{1}{` 均静默替换/吞错无诊断（`D-138`, `D-139`），原结论**不成立**。

---

## 6. `T4.1` 建议执行计划（供 Coordinator / Implementer 参考）

遵循 `AGENTS.md` 硬规则（先失败测试、单一事实源、每轮一个任务）：

1. **Step 1（失败测试先行）**：
   - 在 `crates/mathslot-syntax` 与 `crates/mathslot-latex` 补充失败测试与 `ImportReport` 快照：覆盖 `\begin{align}` 降级为 `RawLatex` + 诊断（`D-138`）、`1 + 2}` / `a \\ b` / `\frac{1}{` / `\sqrt{x` / `\unknownfoo{unclosed` 诊断与阻断边界（`D-139`）、256 层深度上限测试（`D-141`）、`$...$` / `$$...$$` / `\[...\]` 定界符剥离与诊断提示（`D-142`）。
2. **Step 2（Rust 解析、诊断与预览-应用契约）**：
   - 修复 `crates/mathslot-syntax/src/parser.rs`：`parse_matrix` 仅接受已知矩阵环境，未知环境保留整段 `\begin{...}...\end{...}` 为 `RawLatex` + `UNSUPPORTED_ENVIRONMENT` Warning（或依规范决定）；`parse_root` 生成 `Expr::Error` 时必须写入 `Diagnostic`；`parse_fraction` / `parse_sqrt` / `parse_style_command` / `parse_unknown_macro` 校验闭合花括号并报告 `UNCLOSED_DELIMITER`；加入 `MAX_PARSE_DEPTH = 256` 深度守卫（消除 `let _ = self.expect(...)` 与不安全依赖）。
   - 统一处理外层数学定界符（`$$...$$`、`\[...\]`、`$...$`、`\(...\)`）剥离并在 `ImportReport` 附带 `Info`/`Warning` 提示。
   - 在 `crates/mathslot-app` 明确预览与写入分离（例如新增 `PreviewImportLatex(String)` 只计算 `last_import` 而不改 `editor`，与 `ImportLatex(String)`/`ApplyImport` 区分；或在 `ImportModal` 中通过纯引擎预览 + 确认应用 `ImportLatex`，保证 Cancel 零污染，并尽量避免二次重复解析）。
3. **Step 3（`ImportModal.svelte` Diff 审阅与 Apply/Cancel UI）**：
   - 在 `packages/ui/src/import/ImportModal.svelte` 实现输入原文 vs `roundtrip_latex` 的结构/逐行 diff 对比视图（高亮变更/降级差异与诊断详情），并实现**「预览解析 → 若无 Error 可确认应用 / 随时取消放弃（不改动原文档）」**交互。
4. **Step 4（E2E 与 harness 校验）**：
   - 消除 `apps/desktop/src/lib/desktopClient.ts` 对 `ImportLatex` 的手写括号伪造逻辑（可复用 `@mathslot/wasm` 或明确对齐 `D-137`），并在 `packages/ui`、`apps/obsidian`、`apps/desktop` 测试（含双端 E2E）补齐 Error 阻断、Warning/RawLatex diff 展示、取消不覆盖文档与 `Ctrl+Z` 整次导入撤销（`D-012`）验证。

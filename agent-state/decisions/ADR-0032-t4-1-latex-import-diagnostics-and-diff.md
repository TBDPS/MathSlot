# ADR-0032: T4.1 LaTeX 导入诊断、栈深保护、预览 Diff 与两阶段确认契约

- 状态：Accepted（Coordinator 决策，`refactor/v1`，Gate G4 / Round 31）
- 关联任务：`T4.1`（LaTeX 导入（含 diff 高亮、RawLatex 降级提示、错误阻断与撤销））
- 关联审计：`agent-state/audits/AUD-28.md`
- 关联缺陷：`D-007`（重新打开为 OPEN P1）、`D-012`、`D-020`、`D-137`、`D-138`、`D-139`、`D-140`、`D-141`、`D-142`、`D-143`
- 参考规范：`docs/LLM_IMPLEMENTATION_SPEC.md` §2（INV-001..INV-006）、§4（`D-007` / `D-012` / `D-020`）、§14（`T4.1`）

## 1. 背景

`AUD-28.md` 对 `apps/obsidian/src/wasm-pkg/mathslot_wasm.{js,wasm}` 与 `crates/mathslot-{syntax,latex,app}`、`packages/ui/src/import/ImportModal.svelte`、`apps/desktop/src/lib/desktopClient.ts` 的实测表明，`D-007` 并未真正关闭：

1. `D-138`（P1）：`crates/mathslot-syntax/src/parser.rs` 对未知 `\begin{align}...\end{align}` 等环境静默回退为 `MatrixEnv::Matrix`，报告 `lossless: true`、`diags: []`；
2. `D-139`（P1）：`1 + 2}`、`a \\ b`、`\frac{1}{`、`\sqrt{x`、`\unknownfoo{unclosed` 在解析时产生孤立 `}`、`Expr::Error` 或吞并未闭合参数但返回 `diags: []`，穿透 `blocked = report.has_errors()` 覆盖编辑器，且 `parser.rs` 存在 `let _ = self.expect(...)` 与 `.unwrap()`；
3. `D-140`（P1）：`ImportModal.svelte`（第 46 行）提交即直接派发 `{ ImportLatex: inputLatex }` 覆盖文档；非阻断导入时无“输入 vs `roundtrip_latex` diff 高亮”两阶段预览确认，Cancel 无法撤回已经写入的文档；
4. `D-141`（P2 / `D-020`）：嵌套 5000 层 `{...}` 导致 WASM 触发 `RangeError: Maximum call stack size exceeded`；
5. `D-142`（P2）：外层数学定界符 `$$...$$` / `\[...\]` / `$...$` / `\(...\)` 未前置规范化剥离；
6. `D-143`（P2 / `D-137`）：`apps/desktop/src/lib/desktopClient.ts` 在无 Tauri 运行时回退中用括号计数伪造 `ImportLatex`，且 Desktop 与 Obsidian E2E 均未覆盖 Warning/RawLatex 预览 diff、Cancel 不改文档、Error 阻断与一步 `Ctrl+Z` 撤销导入。

## 2. 授权设计与不变量

### 2.1 语法解析与深度防护（`crates/mathslot-syntax`）

1. **受支持矩阵环境白名单（`D-138`）**：
   - 仅保留受支持的结构化环境（与 `MatrixEnv::from_latex_name` 一致：`matrix`、`pmatrix`、`bmatrix`、`vmatrix`、`Vmatrix`、`Bmatrix`、`smallmatrix`、`cases`）。
   - 对任意未知 `\begin{env}...\end{env}`（如 `align`、`equation`、`gather` 等），不得强转为 `MatrixEnv::Matrix`：
     - 若 `\begin{...}` 与对应 `\end{...}` 完整闭合，降级为保留原始源码的 `Expr::RawLatex` 节点（或等价未识别环境原始文本表示），并发出结构化 `Warning` 诊断（如 `UNSUPPORTED_ENVIRONMENT`），标记 `lossless = false`；
     - 若缺少 `\end{env}` 或环境名不匹配，按未闭合/不匹配环境产出 `Error` 诊断（如 `UNCLOSED_ENVIRONMENT` / `MISMATCHED_ENVIRONMENT`）。
2. **括号配对与宏参数完整性（`D-139`）**：
   - `parse_root` 遇到多余 `}` 产生 `Expr::Error` 时，**必须**发射 `Error` 诊断（如 `UNEXPECTED_TOKEN` / `UNMATCHED_CLOSING_BRACE`），不得静默吞掉或空 `diags`；
   - `parse_root` / `parse_group` / `parse_matrix` 等在顶层或非单元格上下文遇到孤立 `&` / `\\` 或非法结构时，必须保留可定位 `Error`（如 `a \\ b` 在非矩阵上下文应报 `Error` 并阻断自动覆盖，或给出清晰结构化错误；不得返回 `diags: []`）；
   - `\frac{1}{`、`\sqrt{x`、`\sqrt[3]{x`、样式/文本/重音命令以及带 `{...}` 参数的未知宏在缺少闭合 `}` 时，必须在 `expect(&Token::RBrace, ...)` 处发出 `UNCLOSED_DELIMITER` `Error` 诊断并准确保留源码范围；
   - 消除 `parser.rs` 与 `lexer.rs` 中的 `let _ = self.expect(...)` 与用户路径 `.unwrap()`（`cargo clippy` / `acceptance.sh` 不允许引入，并清理现有 `parser.rs`/`lexer.rs` 隐患）。
3. **最大解析递归深度（`D-141` / `D-020`）**：
   - 在 `Parser` 中引入 `const MAX_PARSE_DEPTH: usize = 256`（并跟踪当前深度）；
   - 深度超限时立即中止深层递归并产生结构化 `DEPTH_EXCEEDED` `Error` 诊断与非空报错信息，绝不发生 Rust 栈溢出或 WASM `RangeError`。

### 2.2 外层定界符剥离与转换报告（`crates/mathslot-latex`）

1. **外层定界符前置规范化（`D-142`）**：
   - 在导入管线入口剥离首尾空白后匹配成对最外层数学定界符：`$$...$$`、`\[...\]`、`\(...\)`、`$...$`（单层成对剥离后 `trim()`）。
   - 若成功剥离外层定界符，向诊断中追加非阻断 `Info`（如 `OUTER_DELIMITERS_STRIPPED`），记录原定界符信息以便 UI 展示；保留原始提交文本（含定界符）供 Diff 对比，AST 解析与 `roundtrip_latex` 针对内部纯 LaTeX 执行。
   - 若仅有一侧不成对定界符（如仅开头的 `\[` 没有 `\]`），按语法错误处理并阻断。

### 2.3 两阶段导入预览与应用（`crates/mathslot-app` & `packages/ui`）

1. **后端命令（`D-140`）**：
   - 新增 `AppCommand::PreviewImportLatex(String)`（并在 `packages/ui/src/client/engine.ts` 与 `crates/mathslot-wasm`、`apps/desktop/src-tauri` 映射处自动同步，保持单一命令契约）：
     - 仅执行解析、构建 `ImportReportSnapshot`（可附带 `input_latex` 字段或由 UI/report 持有对比输入）、更新 `self.last_import` 与必要预览状态；
     - **严禁**修改 `self.editor`、`self.source_text`、`self.cursor_char`、`self.source_undo`、`self.source_redo` 或触发 `Effect::Render` 覆盖主编辑区。
   - 保留 `AppCommand::ImportLatex(String)` 作为正式提交动作（当 `!blocked` 时原子替换文档并记入 1 条可一步 `Ctrl+Z` 撤销的历史；若 `blocked` 则仍阻断不修改文档），保证现有 `AppCommand::ImportLatex` 单测与程序化调用兼容。
   - 如需要撤销导入：`Ctrl+Z` / `Undo` 必须一步还原导入前完整文档与光标（`D-012`）。
2. **`ImportModal.svelte` 与 Diff 高亮（`D-140` / `T4.1`）**：
   - “解析并预览”（Analyze / Preview）派发 `{ PreviewImportLatex: inputLatex }`，展示：
     1. 诊断卡片与统计（`lossless` / `raw_nodes` / `empty_slots` / `blocked` 状态、每条 `Error`/`Warning`/`Info` 源码摘录）；
     2. 原始输入 vs 规范化 `roundtrip_latex` 的可视化 Diff 高亮区（行/片段级差异标记，区分一致、保留原样、改写/剥离/降级部分，使用 `tokens.css` 语义 CSS 变量，禁止硬编码 hex/`rgb`/`rgba`）；
     3. 当存在 `RawLatex` 降级或非无损改写时，显式给出 `Warning` / 降级提示徽章。
   - 若 `blocked === true`：“确认导入 / Apply”按钮禁用（`disabled`），点击不可写入文档；
   - 若 `blocked === false`：用户点击“确认导入 / Apply”才派发 `{ ImportLatex: inputLatex }` 真正写入编辑器并关闭/回写；点击“取消 / Cancel”仅关闭弹窗并清空待预览状态（可附带 `ImportAcknowledge`），**绝不改变**主编辑器内容与撤销栈。

### 2.4 单一引擎语义一致性（`D-143` / `D-137`）

- 消除 `apps/desktop/src/lib/desktopClient.ts` 中的“JS 括号计数假导入”（`ImportLatex` / `PreviewImportLatex`）：
  - 在 Desktop 浏览器测试/无 Tauri 回退模式中，允许通过 `@mathslot/wasm`（本地已构建 WASM 包或 workspace 包复用 Rust `Engine`）处理 `ImportLatex`/`PreviewImportLatex`（或整套真实 `Engine`），确保浏览器 E2E 与真实 Tauri/Obsidian 运行相同的 `mathslot-syntax` / `mathslot-latex` / `mathslot-app` 解析与阻断语义，彻底遵守 `INV-001`（单一事实源，零第二套 JS 解析器）。

## 3. 允许修改范围（Implementer 唯一写权限）

- `crates/mathslot-syntax/src/**` 与测试
- `crates/mathslot-latex/src/**` 与测试
- `crates/mathslot-app/src/**` 与测试
- `crates/mathslot-wasm/src/**` 与测试
- `apps/desktop/src/**`、`apps/desktop/src-tauri/**`、`apps/desktop/tests/**`、`apps/desktop/package.json`（如需引用本地 `wasm-pkg` / `@mathslot/wasm`）
- `packages/ui/src/**`、`packages/ui/tests/**`
- `apps/obsidian/src/**`、`apps/obsidian/tests/**`
- `obsidian-mathslot/main.js`、`obsidian-mathslot/styles.css`（由 `node obsidian-mathslot/scripts/build.mjs` 重新生成并保持零漂移）

禁止修改：`docs/LLM_IMPLEMENTATION_SPEC.md`、`scripts/agent/**`、`agent-state/**`、冻结参考目录。

## 4. Red -> Green 顺序与验收门禁

1. **Red 阶段**（必须先写出并观察到失败测试）：
   - `mathslot-syntax` / `mathslot-latex`：覆盖 `\begin{align}...\end{align}`、`1 + 2}`、`a \\ b`、`\frac{1}{`、`\sqrt{x`、`\unknownfoo{unclosed`、5000 层嵌套 `{...}` 栈深保护、外层 `$$...$$` / `\[...\]` / `$...$` 剥离；
   - `mathslot-app`：`PreviewImportLatex` 不改文档与撤销栈、`ImportLatex` 合法时可一步 `Undo` 恢复导入前状态、错误输入阻断；
   - `packages/ui` / `apps/obsidian` / `apps/desktop`（含 Playwright E2E）：覆盖 Error 阻断按钮禁用、Warning + `RawLatex` 降级与 Diff 展示、Preview 后 Cancel 不修改编辑器、确认 Apply 导入后 `Ctrl+Z` 一步撤回、捕获关键截图（正常、Diff/Warning、Error 阻断）。
2. **Green & 构建同步**：
   - 完成实现并通过所有测试；
   - 执行 `node obsidian-mathslot/scripts/build.mjs` 刷新 WASM 与 `obsidian-mathslot/{main.js,styles.css}`。
3. **验证命令**：
   - `cargo fmt --check`
   - `cargo clippy --workspace --all-targets -- -D warnings`
   - `cargo test --workspace --offline`
   - `packages/ui`、`apps/obsidian`、`apps/desktop` 的 `test`、`check`、`build` 及 Playwright E2E
   - `scripts/agent/acceptance.sh`（允许仅在非 `T4.1` 范围内现有基线 crates 存在 WARN，但本任务新增代码必须 0 `let _ =`、0 `unwrap()`）

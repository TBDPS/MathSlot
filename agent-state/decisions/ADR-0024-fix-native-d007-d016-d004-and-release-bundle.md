# ADR-0024: 原生端 LaTeX 导入/删除安全/剪贴板诊断修复与 Release 打包（PRE-G3-NATIVE-2：`D-007`、`D-016`、`D-004`）

- **Date**: 2026-11-14
- **Round**: 21
- **Task ID**: `PRE-G3-NATIVE-2`
- **Defects**: `D-007` (P1), `D-016` (P2), `D-004` (native runtime parity)
- **Audit Reference**: `agent-state/audits/AUD-20.md`

---

## 1. 范围与允许修改路径

- **允许写入**：
  - `Cargo.toml`（仅给 `mathslot` bin crate 增加 `mathslot-latex = { path = "crates/mathslot-latex" }` 与/或 `mathslot-doc` 若需要）
  - `Cargo.lock`（仅同步 workspace path 依赖）
  - `src/modals.rs`
  - `src/app.rs`
  - `src/p1_regression_tests.rs`
  - `crates/mathslot-core/src/latex.rs`（仅保留未知宏后续 `{...}`/`[...]` 参数结构，使 `D-007` 回归测试不丢大括号）
  - `crates/mathslot-core/tests/p1_regression_tests.rs`（**仅允许移除 `test_p1_d007_latex_import_reports_lossy_and_blocks_degradation` 上的 `#[ignore]`**，严禁改动或弱化其任何断言）
- **禁止修改**：`crates/mathslot-syntax/**`、`crates/mathslot-latex/**`、`crates/mathslot-app/**`、`scripts/agent/**`、`docs/**`、`agent-state/**`

---

## 2. 技术契约（必须满足）

### 2.1 修复 `D-007`（LaTeX 导入使用 `convert_latex_with_report` + `ImportReport` 展示/阻断 + un-ignore P1 测试）
1. 在 `src/modals.rs`（原 `:235-237, 991-1069`）：
   - `LibraryModal` 持有最新的 `latex_import_report: Option<mathslot_latex::ImportReport>`。
   - `update_latex_conversion` 同时调用 `mathslot_latex::convert_latex_with_report(&self.latex_input)` 记录完整 `ImportReport`（`lossless`、`diagnostics`、`empty_slots`、`raw_nodes`、`roundtrip_latex`、`normalized_match`），并生成 `latex_converted_mathslot`。
   - 提取可单测的纯判定函数（如 `can_apply_latex_import(converted: &str, report: Option<&ImportReport>) -> Result<(), String>`）：当导入为空、存在 `has_errors()`、或发生静默破坏/非零 `raw_nodes` 且存在诊断错误时明确阻断应用（`replace` / `insert` 按钮禁用并显示原因）；存在警告/有损降级（如 `raw_nodes > 0` 或 `!normalized_match`）时在 UI 清晰展示 `ImportReport` 摘要与 `roundtrip_latex` 差异。
   - 若未知宏（如 `\tensor{A}{^i_j}`）在 `mathslot_core::latex::latex_to_mathslot` 与 `mathslot_core::parser::parse` 中被处理：修复 `crates/mathslot-core/src/latex.rs` 未知 `\macro` 后紧跟 `{...}` / `[...]` 参数剥离大括号的问题，并在不弱化任何断言的前提下移除 `crates/mathslot-core/tests/p1_regression_tests.rs:162` 的 `#[ignore]`，确保 `test_p1_d007_latex_import_reports_lossy_and_blocks_degradation` 真实通过！（注意：必须保持 `cargo test --workspace` 全绿且 `ignored == 0`。）

### 2.2 修复 `D-016`（`src/modals.rs` 三类删除操作必须可确认或可撤销）
- 公式库删除（原 `:760-766, 805-816`）、自定义格式删除（原 `:1330-1332, 1364-1374`）、片段删除（原 `:1608-1610, 1639-1648`）：
  - 每次点击“删除”不得立刻不可逆删库写盘，必须先进入二次确认态（如“确认删除 / 取消”按钮）或提供在 UI 可见的**撤销删除（Undo 软删除恢复缓冲，如 10 秒窗口/显式恢复按钮）**（提取纯逻辑状态/函数，写单测覆盖 3 类删除的确认/取消与撤销恢复流程）。

### 2.3 修复 `D-004` 原生运行时 `copy_latex` 诊断保护
- 在 `src/app.rs`（原 `:194-203`）中，`copy_latex` 在导出前检查 `self.editor.parsed` 是否含 `PendingCmd` / `UnknownCmd`（可使用 `mathslot_core` AST 诊断或检查未完成命令节点）：若存在未完成/未知节点，禁止静默丢弃复制（非空但产物静默删节点时阻断或显式报错提示诊断位置，不回退“无内容可复制”误导用户）。

---

## 3. TDD 验收标准（先红后绿）

先写失败测试并运行观察 FAIL，再改实现并验证 PASS：
1. 移除 `crates/mathslot-core/tests/p1_regression_tests.rs` 上 `test_p1_d007_latex_import_reports_lossy_and_blocks_degradation` 的 `#[ignore]`，先跑失败；
2. 在 `src/p1_regression_tests.rs` 新增失败测试：
   - `test_p1_d007_modals_uses_import_report_and_blocks_error_imports`
   - `test_p2_d016_modal_deletes_require_confirmation_and_support_undo`
   - `test_p1_d004_native_copy_latex_does_not_silently_drop_pending_or_unknown`
3. 全量门禁：
   - `cargo fmt --check` PASS
   - `cargo clippy --workspace --all-targets -- -D warnings` PASS
   - `cargo test --workspace --offline` PASS（`0 failed`, **`0 ignored`**）
   - `cargo build --release --locked --bin mathslot --offline` PASS
   - 单次原子提交，commit message 含 `PRE-G3-NATIVE-2` 与 `D-007 D-016 D-004`（不加方括号）。

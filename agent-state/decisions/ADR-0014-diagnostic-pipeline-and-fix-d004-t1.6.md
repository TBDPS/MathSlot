# ADR-0014：打通 Diagnostic 诊断管线并修复闭环 P1 缺陷 D-004（T1.6）

- 日期：2026-11-13
- 状态：已批准
- 决策者：coordinator（依据 `AUD-11` 审计结论与规范 §4.1、§7.4、§14 G1 / T1.6）
- 关联任务：`T1.6`
- 关联不变量：`INV-001`（统一事实源）、`INV-002`（节点不消失）、`INV-007`（不完整输入一等公民）、`INV-016`（平滑演进与旧栈维护）
- 关联缺陷：`D-004`（P1 阻塞：Pending/Unknown 节点导出或复制时静默丢失）

## 1. 背景与事实

- 规范 §14 Gate G1 任务 T1.6 要求：
  > T1.6 | 诊断贯通：parse → app → UI | T1.5 | Diagnostic pipeline | Pending/Unknown 可见、可导出
- 规范 §4.1 对 P1 缺陷 D-004 的明确验收准则：
  > 导出返回 `Result<(String, Vec<Diagnostic>)>`；Error 时阻止或显式占位；单测：`▸m` 不得产生空串；`▸zz` 不得静默变成 `z`
- `AUD-11` 独立审计确认：
  1. `cargo test -p mathslot-core --test p1_regression_tests test_p1_d004 -- --ignored` 确切 panic 失败（退出码 101，`Exporting pending command '▸m' must not produce empty string, got: ""`）；
  2. 根因直接位于 `crates/mathslot-core/src/latex.rs:24`：
     ```rust
     Expr::PendingCmd { .. } | Expr::UnknownCmd { .. } => String::new(),
     ```
     未决与未知节点直接被生成为空串并跳过，导致 `▸m` 导出为空、`1 + ▸m + 2` 导出为 `1 + 2`（节点凭空蒸发，严重违反 INV-002）、`▸zz` 丢弃 `▸z` 退化为 `z`；
  3. 在统一新栈 `mathslot-doc` 与 `mathslot-syntax` 中，虽已定义了 `EditorDiagnostic` 与解析器 `Diagnostic`，但导出接口 `export_latex` 尚未完全遵循规范 §4.1 返回带诊断的契约，未能向调用方暴露未决和错误状态。

## 2. 决策与架构设计

### 2.1 修复旧栈导出逻辑，彻底解冻通过 D-004 回归测试

依据 ADR-0012 与 INV-016，旧栈虽然已标记 FROZEN，但在 T1.7 双跑比对与 G2 全面切换前，必须保持行为正确且不得阻断回归门禁：

1. **修正 `crates/mathslot-core/src/latex.rs`**：
   将 `PendingCmd` 与 `UnknownCmd` 的 LaTeX 渲染由 `String::new()` 修复为显式占位文本：
   ```rust
   Expr::PendingCmd { code, .. } => {
       if code.is_empty() {
           "\\text{▸}".to_string()
       } else {
           format!("\\text{{▸{code}}}")
       }
   }
   Expr::UnknownCmd { code, .. } => {
       if code.is_empty() {
           "\\text{▸?}".to_string()
       } else {
           format!("\\text{{▸{code}}}")
       }
   }
   ```
2. **解冻 `crates/mathslot-core/tests/p1_regression_tests.rs`**：
   移除 `test_p1_d004_pending_and_unknown_commands_never_silently_disappear` 上的 `#[ignore]` 属性，使该 P1 回归用例作为基线常态测试运行。

### 2.2 在目标栈 `mathslot-doc` 与 `mathslot-syntax` 建立完备的诊断管线

1. **`mathslot-doc` 增强带诊断的安全导出 API**：
   - 暴露 `pub fn export_latex_with_diagnostics(&self) -> Result<(String, Vec<EditorDiagnostic>), EditorExportError>` 或 `(String, Vec<EditorDiagnostic>)`：
     - 若存在 `PendingCommand`，返回包含显式占位符（如 `\text{▸m}`）的 LaTeX 字符串及对应的 Pending 级别诊断；
     - 若存在 `UnknownCommand`，返回包含显式占位符（如 `\text{▸zz}`）的 LaTeX 字符串及对应的 Error 级别诊断；
     - 严禁在存在未决或未知节点时返回裸空串。
   - 暴露 `pub fn export_latex_strict(&self) -> Result<String, Vec<EditorDiagnostic>>`：当且仅当零诊断时返回纯净 LaTeX，有诊断时返回阻断错误列表。
2. **`mathslot-syntax` 诊断聚合与增强**：
   - 确保未闭合前缀与未知宏解析时产生结构化诊断（Span、Message、Severity）。

### 2.3 允许写作用域与路径

- `crates/mathslot-core/src/latex.rs`（仅修改 PendingCmd / UnknownCmd 导出占位分支）
- `crates/mathslot-core/tests/p1_regression_tests.rs`（仅移除 test_p1_d004 的 #[ignore]）
- `crates/mathslot-doc/src/**`（`editor.rs`、`lib.rs` 等诊断导出方法与测试）
- `crates/mathslot-syntax/src/**`（若需丰富 Diagnostic 辅助方法）
- 严禁修改：`scripts/agent/**`、`docs/**`、`agent-state/**`（由 coordinator/verifier 专责）。

### 2.4 测试与退出准则

1. 先确保 `test_p1_d004` 在未修复前确切失败；
2. 修复后 `test_p1_d004` 原生通过，不再被 ignore；
3. `cargo test -p mathslot-doc` 包含的新增诊断贯通测试通过；
4. 全量门禁全绿（`cargo fmt`、`cargo clippy`、`cargo test`、`acceptance.sh`）。
5. 结果：P1 缺陷 D-004 正式关闭。

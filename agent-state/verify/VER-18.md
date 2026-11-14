---
id: VER-18
round: 18
task: T2.5
defects: [D-108, D-109, INV-001, INV-002]
verdict: PASS
verifier: verifier
date: 2026-11-14
commit: 7156ff53325fd9b12393da54976bce3bacf76d08
---

## 1. 结论

**PASS**。

对 Round 18 修复提交 [`7156ff5`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs)（相对基线 `7fc5249`）执行独立核查后，确认 `VER-17` 曝光的两项阻断性缺陷（`D-108` 宏粘连、`D-109` / `INV-002` 定界符静默丢失）以及 `parity_report_tests.rs` 中的同义反复/测试盲区均已严格闭环，且提交范围严格符合 `ADR-0021` 允许路径，工作区全部门禁独立实测通过。

关键实测汇总：
- **提交范围**：单提交 `7156ff5` 仅触及 `ADR-0021` 允许的 9 个文件（`+813 / -43`），冻结文件 `crates/mathslot-core/src/{parser,ast,latex}.rs`、`crates/mathslot-app/src/**`、`Cargo.toml`、`Cargo.lock`、`src/**`、`scripts/**`、`docs/**`、`agent-state/**` 均零改动。
- **`D-108`（宏粘连）**：[`Printer::to_canonical_latex`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs#L9-L20) 与 [`Printer::join_latex_without_macro_gluing`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs#L258-L281) 统一处理控制词与 ASCII 字母边界；[`crates/mathslot-doc/src/transaction.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/transaction.rs#L219-L275) 复用同一辅助函数（`INV-001` 单一事实源）。实测导出报告 `/tmp/parity-report-g2-ver18.json`（348 scenarios）中 `\SigmaV`、`\sigmae`、`\cdotk`、`\partialt`、`\landd`、`\capB`、`\Deltap`、`\cupB`、`\landx` **出现次数 = 0**。
- **`D-109`（`INV-002` 定界符保留）**：`mathslot-syntax` 完整建模 `\Vert`（`Token::DoublePipe` → `Delim::DoublePipe`）、`\lfloor`/`\rfloor`（`Delim::Floor`）与 `\lceil`/`\rceil`（`Delim::Ceil`）。实测报告中 `P-CMD-121:{norm,floor,ceil}:0`、`P-PALETTE:{norm,floor,ceil}` 及全部 4 条含范数预置均正确保留对应定界符，全报告中 `\left.` 仅出现在合法求值竖线 `eval_bar`（`P-CMD-121:eval_bar:0`、`P-PALETTE:eval_bar`、`P-PRESET-88:preset-fundamental-theorem-calculus`）。
- **对等测试盲区消除**：`P-PRESET-88` 已移除只比对 `app.doc().nodes` 的同义反复，对 88 条预置全部重新 `syntax_parse(&app.to_latex())` 并校验 `roundtrip_ast_equivalent`、`check_inv002_delim_preservation` 与 `find_unexpected_control_word`；同时对 84 条 v1 兼容预置执行 `preset.source` 逐字符输入检验，仅对 4 条含 G1 前旧简码或嵌套 `▸` 的预置显式标注 `DELTA-LEGACY-SHORTCODE-SOURCE`；`P-EDIT-UNDO:whitespace-coalesce` 已改为真实运行 `StreamEditor::from_source("a b")`。
- **全套门禁**：`cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace --offline`（`passed=214, failed=0, ignored=1`）、`cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline`、`scripts/agent/acceptance.sh` 全部 **exit 0**；`--ignored` 仅剩 `D-007`（预期 `exit 101`）。

---

## 2. 提交范围、ADR-0021 合规与卫生核查

### 2.1 提交与路径边界 (`git show --stat 7156ff5` / `git diff --name-only 7fc5249..7156ff5`)
- **Commit**: `7156ff53325fd9b12393da54976bce3bacf76d08`（`T2.5: fix D-108 macro spacing, D-109 delimiter preservation, and parity assertions`）
- **变更文件（9 files, 813 insertions(+), 43 deletions(-)）**：
  1. `crates/mathslot-syntax/src/token.rs`（+4）
  2. `crates/mathslot-syntax/src/lexer.rs`（+5）
  3. `crates/mathslot-syntax/src/ast.rs`（+8）
  4. `crates/mathslot-syntax/src/parser.rs`（+9）
  5. `crates/mathslot-syntax/src/printer.rs`（+31 / -12）
  6. `crates/mathslot-syntax/tests/d108_d109_regression_tests.rs`（+262，新建）
  7. `crates/mathslot-doc/src/transaction.rs`（+23 / -15）
  8. `crates/mathslot-doc/tests/parity_harness_tests.rs`（+1 / -1）
  9. `crates/mathslot-app/tests/parity_report_tests.rs`（+470 / -15）
- **禁止路径核查**：
  - `crates/mathslot-core/src/{parser,ast,latex}.rs`、`crates/mathslot-core/**`：0 改动。
  - `crates/mathslot-app/src/**`：0 改动。
  - `crates/mathslot-{command,latex,render,store,wasm}/**`：0 改动。
  - `Cargo.toml`、`Cargo.lock`、`src/**`、`scripts/**`、`docs/**`、`agent-state/**`：0 改动。
  - `git status --short` 仅显示未提交协调决策文档 `?? agent-state/decisions/ADR-0021-fix-syntax-macro-spacing-delims-and-parity-t2.5.md`。

### 2.2 代码卫生与安全属性
- **新增代码扫描**（`git diff 7fc5249..7156ff5 -- crates/mathslot-syntax/src crates/mathslot-doc/src | grep -nE "^\+.*(let _ =|#\[allow|#\[ignore|\.unwrap\(|\.expect\()"`）：`DIFF_HYGIENE_EXIT=1`（**0 处新增**）。
- **测试文件注解扫描**（`rg -n "let _ =|#\[allow|#\[ignore" crates/mathslot-syntax/tests/d108_d109_regression_tests.rs crates/mathslot-doc/tests/parity_harness_tests.rs crates/mathslot-app/tests/parity_report_tests.rs`）：`HYGIENE_TEST_EXIT=1`（**0 处**）。
- **`#![forbid(unsafe_code)]` 完整性**：
  - [`crates/mathslot-syntax/src/lib.rs:1`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/lib.rs#L1)
  - [`crates/mathslot-doc/src/lib.rs:1`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/lib.rs#L1)
  - [`crates/mathslot-app/src/lib.rs:1`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/lib.rs#L1)

---

## 3. VER-17 两项阻断缺陷与设计不变量核查

### 3.1 `D-108`：宏间距与单一事实源（`INV-001`）
- [`crates/mathslot-syntax/src/printer.rs:9-20`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs#L9-L20)：`Printer::to_canonical_latex` 改为直接基于已输出缓冲 `out` 与下一段字符串 `s` 判断 `ends_with_control_word(&out) && starts_with_ascii_letter(&s)`，覆盖 `Expr::Symbol`、`Expr::RawLatex`、`Expr::Error` 与 `Expr::Script` 嵌套基节点。
- [`crates/mathslot-syntax/src/printer.rs:73-80`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs#L73-L80)：非 `auto_scale` 定界符输出同样在 `open_str` 为控制词且 `body_str` 以 ASCII 字母开头时插入空格（防止 `\lfloor x \rfloor` 粘连成 `\lfloorx\rfloor`）。
- [`crates/mathslot-syntax/src/printer.rs:258-281`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs#L258-L281)：`ends_with_control_word` 通过判断末尾字母前的反斜杠连续长度为奇数（`backslashes % 2 == 1`）正确区分控制词与 `\\` 换行；并提供共享 `join_latex_without_macro_gluing`。
- [`crates/mathslot-doc/src/transaction.rs:219-275`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/transaction.rs#L219-L275)：`Cursor::InSlot`、`Cursor::AtStart`、`AtEnd` 全部复用 `Printer::join_latex_without_macro_gluing`，移除了原有的重复内联启发式判断（满足 `INV-001`）。
- `/tmp/parity-report-g2-ver18.json` 实测结果：
  - `preset-matrix-svd`：`app_outcome` = `A=U\Sigma V^{T}`（`ExactParity`）
  - `preset-gaussian-pdf-1d`：`app_outcome` = `f(x)=\frac{1}{\sqrt{2\pi}}\sigma e^{-}\frac{(x-\mu)^{2}}{2\sigma^{2}}`（`ExactParity`）
  - `preset-infonce-contrastive-loss`：`app_outcome` 含 `q\cdot k_{+/}`（`ExactParity`）
  - `preset-klein-gordon-equation`：`app_outcome` 含 `\frac{\partial^{2}}{\partial t^{2}}`（`ExactParity`）
  - `preset-exterior-derivative-leibniz`：`app_outcome` = `d(\omega\land\eta)=d\omega\land\eta+(-1)^{p}\omega\land d\eta`（`ExactParity`）
  - `preset-electromagnetic-field-2-form`：`app_outcome` = `F=dA=\frac{1}{2}{F}_{\mu\nu}d{x}^{\mu}\land d{x}^{\nu}`（`ExactParity`）
  - 全量 348 条场景中非法粘连宏出现次数 = **0**。

### 3.2 `D-109`：定界符保留（`INV-002`）
- [`crates/mathslot-syntax/src/token.rs:23-26`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/token.rs#L23-L26) 新增 `FloorOpen`、`FloorClose`、`CeilOpen`、`CeilClose`。
- [`crates/mathslot-syntax/src/lexer.rs:187-193`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/lexer.rs#L187-L193) 将 `\Vert`、`lfloor`、`rfloor`、`lceil`、`rceil` 映射到对应 token（不再回退为未知 `RawLatex` / `Delim::Empty`）。
- [`crates/mathslot-syntax/src/ast.rs:23-26,46-47,61-62`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/ast.rs#L23-L26) 新增 `Delim::Floor` 与 `Delim::Ceil`，并与已有的 `Delim::DoublePipe` 共同输出标准 LaTeX。
- [`crates/mathslot-syntax/src/parser.rs:353-357,532-533,588-589`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/parser.rs#L353-L357) 在裸定界符与 `\left`/`\right` 定界符路径均正确解析为 `Delim::DoublePipe` / `Delim::Floor` / `Delim::Ceil`。
- [`crates/mathslot-doc/tests/parity_harness_tests.rs:216`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/tests/parity_harness_tests.rs#L216) 同步修正 `▸afx;` 期望从旧缺陷 `Delim::Empty` 更新为 `(Delim::DoublePipe, Delim::DoublePipe)`。
- `/tmp/parity-report-g2-ver18.json` 实测结果：
  - `P-CMD-121:norm:0`：`leg = \left\Vert x\right\Vert`，`app = \left\| x \right\|`（`IntentionalDelta(DELTA-FORMAT-MATRIX)`，两侧 AST 均为 `Delim::DoublePipe`）
  - `P-CMD-121:floor:0`：`leg = \left\lfloor x\right\rfloor`，`app = \left\lfloor x \right\rfloor`（`IntentionalDelta(DELTA-FORMAT-MATRIX)`）
  - `P-CMD-121:ceil:0`：`leg = \left\lceil x\right\rceil`，`app = \left\lceil x \right\rceil`（`IntentionalDelta(DELTA-FORMAT-MATRIX)`）
  - `P-PALETTE:norm` / `floor` / `ceil`：`app_outcome` 分别为 `\left\|  \right\|` / `\left\lfloor  \right\rfloor` / `\left\lceil  \right\rceil`（`ExactParity`）
  - 4 条含范数预置（`preset-vector-dot-product`、`preset-vector-cross-product-norm`、`preset-gram-schmidt-orthogonalization`、`preset-ddpm-score-matching`）均输出 `\left\| ... \right\|`（无 `\left.`）。

### 3.3 `parity_report_tests.rs` 盲区修复核查
- [`crates/mathslot-app/tests/parity_report_tests.rs:997-1010`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/parity_report_tests.rs#L997-L1010)：`P-PRESET-88` 对每条预置的 `app_latex = app.to_latex()` 重新执行 `syntax_parse(&app_latex)`，检查 `roundtrip_ast_equivalent`、`no_new_parse_errs`、`check_inv002_delim_preservation` 与 `find_unexpected_control_word`。
- [`crates/mathslot-app/tests/parity_report_tests.rs:1022-1081`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/parity_report_tests.rs#L1022-L1081)：对 84 条非旧简码预置执行 `drive_app_chars(&mut typed_app, &preset.source)` 与重解析校验；仅精确列出 4 条含 G1 前旧简码或嵌套 `▸` 的预置（`preset-fundamental-theorem-calculus`、`preset-ddpm-score-matching`、`preset-dirac-expectation-value`、`preset-hodge-star-inner-product`，已对照 [`crates/mathslot-core/src/presets.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/presets.rs#L33) 确认）归类为 `DELTA-LEGACY-SHORTCODE-SOURCE`。
- [`crates/mathslot-app/tests/parity_report_tests.rs:799-824`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/parity_report_tests.rs#L799-L824)：`P-EDIT-UNDO:whitespace-coalesce` 实测调用 `StreamEditor::from_source("a b")`（`leg = source='a b', latex='a b'` vs `app = latex='ab', undo_steps=2`）。

---

## 4. 独立执行命令与实测输出

### 4.1 `cargo fmt --check`
- **Exit Code**: `0`
```text
FMT_EXIT=0
```

### 4.2 `cargo clippy --workspace --all-targets -- -D warnings`
- **Exit Code**: `0`
```text
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.33s
CLIPPY_EXIT=0
```

### 4.3 `MATHSLOT_PARITY_REPORT_OUT=/tmp/parity-report-g2-ver18.json cargo test -p mathslot-app --test parity_report_tests --offline`
- **Exit Code**: `0`
```text
    Finished `test` profile [optimized + debuginfo] target(s) in 0.13s
     Running tests/parity_report_tests.rs (target/debug/deps/parity_report_tests-75ea3aeda19f54b9)

running 2 tests
test test_t2_5_headless_parity_report ... ok
test test_t2_5_parity_report_deterministic_serialization_and_safe_export ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s

PARITY_EXIT=0
```
- **导出报告 `/tmp/parity-report-g2-ver18.json` 实测统计**：
  - `total_cases`: `348`
  - `exact_parity`: `301`（`P-CMD-121`: 102, `P-PALETTE`: 113, `P-EDIT-UNDO`: 2, `P-PRESET-88`: 83, `P-RENDER-STORE-G2`: 1）
  - `intentional_deltas`: `47`（`P-CMD-121`/`DELTA-FORMAT-MATRIX`: 19, `P-PALETTE`/`DELTA-FORMAT-MATRIX`: 8, `P-PALETTE`/`DELTA-D001-PALETTE-FIX`: 5, `P-EDIT-UNDO`/`DELTA-UNDO-INTENT`: 1, `P-EDIT-UNDO`/`DELTA-WHITESPACE-COALESCE`: 1, `P-NAV`/`DELTA-NAV-MODEL`: 3, `P-DIAG-EXPORT`/`DELTA-STRICT-EXPORT`: 3, `P-PRESET-88`/`DELTA-LEGACY-SHORTCODE-SOURCE`: 4, `P-PRESET-88`/`DELTA-FORMAT-MATRIX`: 1, `P-PRESET-88`/`DELTA-D007-DEFERRED-G4`: 1, `P-RENDER-STORE-G2`/`DELTA-DEGRADED-DIAGNOSTICS`: 1）
  - `unexpected_mismatches`: `0`

### 4.4 `cargo test -p mathslot-syntax --offline`
- **Exit Code**: `0`
```text
     Running tests/architecture_guard_tests.rs (...): 6 passed; 0 failed; 0 ignored
     Running tests/d108_d109_regression_tests.rs (...): 2 passed; 0 failed; 0 ignored
     Running tests/golden_tests.rs (...): 15 passed; 0 failed; 0 ignored
SYNTAX_EXIT=0
```

### 4.5 `cargo test -p mathslot-doc --offline`
- **Exit Code**: `0`
```text
     Running tests/a_edit_acceptance_tests.rs (...): 9 passed; 0 failed; 0 ignored
     Running tests/doc_tests.rs (...): 5 passed; 0 failed; 0 ignored
     Running tests/history_intent_tests.rs (...): 6 passed; 0 failed; 0 ignored
     Running tests/parity_harness_tests.rs (...): 4 passed; 0 failed; 0 ignored
DOC_EXIT=0
```

### 4.6 `cargo test -p mathslot-app --offline`
- **Exit Code**: `0`
```text
     Running tests/app_state_machine_tests.rs (...): 12 passed; 0 failed; 0 ignored
     Running tests/parity_report_tests.rs (...): 2 passed; 0 failed; 0 ignored
APP_EXIT=0
```

### 4.7 `cargo test --workspace --offline`
- **Exit Code**: `0`
- **聚合统计**：`passed=214 failed=0 ignored=1`（较 Round 17 的 212 新增 `d108_d109_regression_tests.rs` 2 个测试）
```text
WORKSPACE_TOTAL: passed=214 failed=0 ignored=1
```

### 4.8 `cargo test --workspace --offline -- --ignored`
- **Exit Code**: `101`（预期：全工作区仅剩 `D-007` 留存 G4 `T4.1`）
```text
     Running tests/p1_regression_tests.rs (target/debug/deps/p1_regression_tests-55223c65b829dedf)

running 1 test
test test_p1_d007_latex_import_reports_lossy_and_blocks_degradation ... FAILED

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
WS_IGNORED_EXIT=101
```

### 4.9 `cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline`
- **Exit Code**: `0`
```text
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.09s
WASM_EXIT=0
```

### 4.10 `scripts/agent/acceptance.sh`
- **Exit Code**: `0`
```text
结果 检查项                    说明
------ ---------------------------- ----
PASS   cargo fmt --check            exit 0
PASS   cargo clippy -D warnings     exit 0
PASS   cargo test --workspace       exit 0
PASS   调色板一致性           exit 0（gate=G2）
WARN   let _ = 计数               15 处（G4 前应清零）
WARN   unwrap() 计数              20 处（用户输入路径应为 0）
WARN   命令表常量              3 处（G1 后应只剩 catalog）
WARN   工作区未提交           1 个文件

PASS=4 FAIL=0 WARN=4
结论：PASS
ACCEPT_EXIT=0
```

---

## 5. 逐套件验收表

| 套件 | 实测情况 | 判定 |
|---|---|---|
| `P-CMD-121` | 121/121 全部无异常；`norm`/`floor`/`ceil` 定界符语义完整保留，`DELTA-FORMAT-MATRIX`（19）仅覆盖空格/别名（如 `\Vert` vs `\|`） | **PASS** |
| `P-PALETTE` | 126/126 通过（121 面板 + 5 `D-001` 专项）；`norm`/`floor`/`ceil` 为 `ExactParity` | **PASS** |
| `P-EDIT-UNDO` | `typing-backspace`、`paste-literal`、`intent-and-clear-history`、`whitespace-coalesce`（真实 `StreamEditor::from_source("a b")`）全部通过 | **PASS** |
| `P-NAV` | `frac`、`nth-root`、`matrix-2x2` 导航零文本/零历史污染、首尾回绕通过 | **PASS** |
| `P-DIAG-EXPORT` | `▸`、`▸m`、`▸zz` 显式占位符与 `StrictExportBlocked` 通过 | **PASS** |
| `P-PRESET-88` | 88 条全部重解析 `app.to_latex()` 且 0 粘连宏、0 定界符丢失；84 条 v1 兼容预置跑通 `preset.source` 逐字符输入；4 条旧简码/嵌套 `▸` 预置准确记录为 `DELTA-LEGACY-SHORTCODE-SOURCE` | **PASS** |
| `P-RENDER-STORE-G2` | `normal-render` 与 `degraded-diagnostics`（`D-011`）通过 | **PASS** |
| 导出隔离 | 确定性 JSON/MD 与拒绝写 `docs/` / `agent-state/` 通过 | **PASS** |

---

## 6. 未验证 / 风险

- 本轮仅涉及无头语法/文档/应用核心对等修复，未构建与人工目视检查 GUI 截图（属于 Gate G3/G4 范围）。
- `agent-state/state.json` 与 `agent-state/HANDOFF.md` 仍需由 coordinator 在收到本 `PASS` 报告后按工作流更新并签出 Gate G2。

---
id: VER-17
round: 17
task: T2.5
defects: [INV-002, T2.5]
verdict: FAIL
verifier: verifier
date: 2026-11-14
commit: a56468766d3754a76ca17ead38e058c9a146ce11
---

## 1. 结论

**FAIL**。

尽管 commit `a564687` 范围隔离干净、所有现有工作区门禁（`fmt`、`clippy -D warnings`、`cargo test --workspace --offline`、`wasm32` check、`acceptance.sh`）均以 exit 0 通过，但独立核查 `crates/mathslot-app/tests/parity_report_tests.rs` 及其实际产出的 `ParityReport`（348 scenarios: `exact_parity=306`, `intentional_deltas=42`, `unexpected_mismatches=0`）后，发现**两项实质性阻断问题**：

1. **`P-PRESET-88` 存在同义反复（tautological）断言，掩盖了 `App::to_latex()` 在 6 条内置预置上输出的非法粘连宏 LaTeX**：
   [`crates/mathslot-app/tests/parity_report_tests.rs:659-664`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/parity_report_tests.rs#L659-L664) 将 `legacy_latex` 传给 `AppEvent::ImportLatex(legacy_latex.clone())` 后，只比对 `syntax_parse(&legacy_latex)` 与 `app.doc().nodes`（后者本身就是由 `Document::from_latex(&legacy_latex)` 调用 `syntax_parse(&legacy_latex)` 构造的），**从未重新解析或校验 `app_latex = app.to_latex()`**。实测输出中 `app_outcome` 出现了 `\SigmaV^{T}`、`\sigmae^{-}`、`\cdotk_{+/}`、`\partialt^{2}`、`\landd\eta`、`\landd{x}^{\nu}` 等损坏宏名，却全部被判为 `ExactParity`。
2. **`P-CMD-121`、`P-PALETTE`、`P-PRESET-88` 掩盖了 `norm`/`floor`/`ceil` 定界符静默丢失（`INV-002` 违例），并错误归类为 `ExactParity` / `DELTA-FORMAT-MATRIX`**：
   `App` 在处理 `\left\Vert x\right\Vert`（`norm`）、`\left\lfloor x\right\rfloor`（`floor`）、`\left\lceil x\right\rceil`（`ceil`）时，输出全部退化为不可见空定界符 `\left. x \right.`（原因：`mathslot_syntax` 词法/语法器在 [`crates/mathslot-syntax/src/lexer.rs:170-189`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/lexer.rs#L170-L189) 与 [`crates/mathslot-syntax/src/parser.rs:517-530`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/parser.rs#L517-L530) 将 `\Vert`/`\lfloor`/`\rfloor`/`\lceil`/`\rceil` 降级为 `Delim::Empty`）。因为 `parity_report_tests.rs` 对双侧输出均调用同一个 `syntax_parse`，双侧均被解析成 `Delim::Empty`，导致：
   - `P-CMD-121:{norm,floor,ceil}:0` 将定界符语义丢失误报为 `DELTA-FORMAT-MATRIX`（"Canonical Printer spacing/delimiter/alias formatting differs..."）；
   - `P-PALETTE:{norm,floor,ceil}` 与 4 条含范数的预置（`preset-vector-dot-product`、`preset-vector-cross-product-norm`、`preset-gram-schmidt-orthogonalization`、`preset-ddpm-score-matching`）被误报为 `ExactParity`。

按 `.agents/skills/independent-verify/SKILL.md` §1 与 §4（"测试测不到缺陷，即 FAIL"）以及规范 `T2.5`（"核心路径 100% 一致或有意差异有记录"）与 `INV-002`（"任何输入节点不得在输出时静默消失"），本轮判定 **FAIL**。

---

## 2. 提交范围与卫生核查

### 2.1 提交与路径边界 (`git show --stat a564687` / `git diff efabf14..a564687`)

- Commit: `a56468766d3754a76ca17ead38e058c9a146ce11`（`T2.5: add headless parity tests and report comparing mathslot-core vs app-core`），单提交仅包含 `T2.5`。
- 变更文件（3 files, 950 insertions(+)）：
  - `Cargo.lock`（+5 行：仅给 `mathslot-app` 增加已有工作区/本地 `dev-dependencies` 连线 `mathslot-core`, `mathslot-latex`, `mathslot-render`, `mathslot-store`, `serde_json`，无新增外部网络依赖）。
  - `crates/mathslot-app/Cargo.toml`（+7 行：仅新增 `[dev-dependencies]`；`[dependencies]` 完全未动，保持 `mathslot-command`, `mathslot-doc`, `mathslot-syntax`, `serde`, `thiserror`）。
  - `crates/mathslot-app/tests/parity_report_tests.rs`（+938 行，新建）。
- 冻结文件与禁止路径核查：
  - `crates/mathslot-core/src/{parser,ast,latex}.rs` 自 `9ae9eea`（T1.6）以来无任何变更。
  - `crates/mathslot-app/src/**`、`crates/mathslot-core/**`、`crates/mathslot-{command,syntax,doc,latex,render,store,wasm}/**`、`src/**`、`scripts/**`、`docs/**` 均未触碰。

### 2.2 代码卫生与安全属性

- `#![forbid(unsafe_code)]` 完好保留：
  - [`crates/mathslot-app/src/lib.rs:1`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/lib.rs#L1)
  - [`crates/mathslot-render/src/lib.rs:1`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/lib.rs#L1)
  - [`crates/mathslot-store/src/lib.rs:1`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L1)
- `rg -n "let _ =|#\[allow|#\[ignore|\.unwrap\(|\.expect\(" crates/mathslot-app/src crates/mathslot-render/src crates/mathslot-store/src` → **0 处**（exit 1 / `NONE_FOUND_EXIT_1`）。
- `rg -n "let _ =|#\[allow|#\[ignore" crates/mathslot-app/tests/parity_report_tests.rs` → **0 处**。

---

## 3. 独立执行命令与实测输出

### 3.1 `cargo fmt --check`
- **Exit Code**: `0`
- **输出尾部**：
  ```text
  FMT_EXIT=0
  ```

### 3.2 `cargo clippy --workspace --all-targets -- -D warnings`
- **Exit Code**: `0`
- **输出尾部**：
  ```text
      Finished `dev` profile [optimized + debuginfo] target(s) in 0.26s
  CLIPPY_EXIT=0
  ```

### 3.3 `cargo test -p mathslot-app --test parity_report_tests --offline`（含 `MATHSLOT_PARITY_REPORT_OUT=/tmp/parity-report-g2.json`）
- **Exit Code**: `0`（无环境变量与带 `MATHSLOT_PARITY_REPORT_OUT=/tmp/parity-report-g2.json` 均通过）
- **输出尾部**：
  ```text
       Running tests/parity_report_tests.rs (target/debug/deps/parity_report_tests-75ea3aeda19f54b9)

  running 2 tests
  test test_t2_5_headless_parity_report ... ok
  test test_t2_5_parity_report_deterministic_serialization_and_safe_export ... ok

  test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
  PARITY_EXPORT_EXIT=0
  ```
- **实际导出报告 `/tmp/parity-report-g2.json` 汇总统计**：
  - `total_cases`: `348`
  - `exact_parity`: `306`（`P-CMD-121`: 102, `P-PALETTE`: 113, `P-EDIT-UNDO`: 2, `P-PRESET-88`: 88, `P-RENDER-STORE-G2`: 1）
  - `intentional_deltas`: `42`：
    - `P-CMD-121` / `DELTA-FORMAT-MATRIX`: `19`
    - `P-PALETTE` / `DELTA-FORMAT-MATRIX`: `8`
    - `P-PALETTE` / `DELTA-D001-PALETTE-FIX`: `5`
    - `P-EDIT-UNDO` / `DELTA-UNDO-INTENT`: `1`
    - `P-EDIT-UNDO` / `DELTA-WHITESPACE-COALESCE`: `1`
    - `P-NAV` / `DELTA-NAV-MODEL`: `3`
    - `P-DIAG-EXPORT` / `DELTA-STRICT-EXPORT`: `3`
    - `P-PRESET-88` / `DELTA-D007-DEFERRED-G4`: `1`
    - `P-RENDER-STORE-G2` / `DELTA-DEGRADED-DIAGNOSTICS`: `1`
  - `unexpected_mismatches`: `0`

### 3.4 `cargo test -p mathslot-app --offline`
- **Exit Code**: `0`
- **输出尾部**：
  ```text
       Running tests/app_state_machine_tests.rs (...): 12 passed; 0 failed; 0 ignored
       Running tests/parity_report_tests.rs (...): 2 passed; 0 failed; 0 ignored
     Doc-tests mathslot_app: 0 passed; 0 failed; 0 ignored
  APP_TEST_EXIT=0
  ```

### 3.5 `cargo test --workspace --offline`
- **Exit Code**: `0`
- **聚合统计**：`passed=212 failed=0 ignored=1`（相较基线 210 passed 新增 `parity_report_tests.rs` 2 个测试）
- **关键输出尾部**：
  ```text
       Running tests/parity_report_tests.rs (target/debug/deps/parity_report_tests-a443bebaf58554d1)
  test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
  ...
       Running tests/p1_regression_tests.rs (target/debug/deps/p1_regression_tests-55223c65b829dedf)
  test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
  ...
  TOTAL_AGGREGATED: passed=212 failed=0 ignored=1
  ```

### 3.6 `cargo test --workspace --offline -- --ignored`
- **Exit Code**: `101`（预期：全工作区仅剩 `D-007` 留存 G4 `T4.1`）
- **输出尾部**：
  ```text
       Running tests/p1_regression_tests.rs (target/debug/deps/p1_regression_tests-55223c65b829dedf)

  running 1 test
  test test_p1_d007_latex_import_reports_lossy_and_blocks_degradation ... FAILED
  ...
  test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
  IGNORED_EXIT=101
  ```

### 3.7 `cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline`
- **Exit Code**: `0`
- **输出尾部**：
  ```text
      Finished `dev` profile [optimized + debuginfo] target(s) in 0.17s
  WASM_EXIT=0
  ```

### 3.8 `scripts/agent/acceptance.sh` & `git status --short`
- **Exit Code**: `0`
- **输出尾部**：
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
  WARN   工作区未提交           2 个文件

  PASS=4 FAIL=0 WARN=4
  结论：PASS
  ACCEPTANCE_EXIT=0
  ```
- `git status --short` 仅显示未跟踪协调/审计文件 `agent-state/audits/AUD-17.md` 与 `agent-state/decisions/ADR-0020-headless-parity-app-core-and-g2-exit-t2.5.md`（测试未向 `docs/` 或 `agent-state/` 写入任何文件）。

---

## 4. 逐套件 / 逐项验收审查

| 套件 / 验收项 | 覆盖对象与方式 | 实测情况 | 判定 |
|---|---|---|---|
| `P-CMD-121` | 遍历 121 条 `GENERATED_COMMANDS` examples，驱动 `App::dispatch(KeyInput)` vs `StreamEditor::from_source` | 121/121 走通且校验了 `Idle` 与 `Effect::Render`；但 `norm` (`▸afx;`)、`floor` (`▸aox;`)、`ceil` (`▸apx;`) 的 `App` 输出全部丢成 `\left. x \right.`，被 `DELTA-FORMAT-MATRIX` 错误归类掩盖 | **FAIL** |
| `P-PALETTE` | 121 条 `AppEvent::PaletteCard(id)` vs `StreamEditor::apply_card_click(code)` + 5 条 `D-001` 专项 | `D-001` 5 条与多槽位模板（8 条）有真实对比；但 `P-PALETTE:norm` / `floor` / `ceil` 分别输出 `\left.  \right.`（vs `\left\Vert \right\Vert` / `\left\lfloor \right\rfloor` / `\left\lceil \right\rceil`），却被标记为 `ExactParity` | **FAIL** |
| `P-EDIT-UNDO` | 退格、字面量粘贴 `▸f1;2;`、卡片/打字/Clear Intent 边界 (`D-012`/`D-105`)、空白收敛 (`D-107`) | `typing-backspace` 与 `intent-and-clear-history` 真实双跑；`paste-literal` 与 `whitespace-coalesce` 中 `legacy_outcome` 为硬编码说明字符串（`StreamEditor` 无 `paste` 方法，但 `whitespace-coalesce` 未调用 `StreamEditor::from_source("a b")`） | **PASS（含轻度不对称说明）** |
| `P-NAV` | `\frac{a}{b}`、`\sqrt[3]{8}`、`2x2` 矩阵的 `EnterNavMode`/`Tab`/`PrevSlot`/`ExitNavMode` vs `StreamEditor::toggle_esc_jump` | 真实校验零文本/零撤销栈污染、全槽位遍历与首尾回绕；`DELTA-NAV-MODEL` 与规范一致 | **PASS** |
| `P-DIAG-EXPORT` | `▸`、`▸m`、`▸zz` 下 `RequestCopy`、`RequestExport { strict: true/false }` vs `StreamEditor::to_latex()` | 真实校验 `\text{▸...}` 非空占位符（`D-004`，严禁退化为 `z`）及 `AppError::StrictExportBlocked` | **PASS** |
| `P-PRESET-88` | 88 条 `Catalog::builtin().presets()` vs `PRESET_LIBRARY` + `D-007` 边界记录 | **存在同义反复断言**（`syntax_parse(&legacy_latex)` 对比 `app.doc().nodes`），未解析 `app_latex = app.to_latex()`，掩盖了 6 条预置的宏粘连错误（`\SigmaV`、`\sigmae`、`\cdotk`、`\partialt`、`\landd`×2）与 4 条预置的 `\Vert` 定界符丢失 | **FAIL** |
| `P-RENDER-STORE-G2` | `App` `Effect::Render` 接入 `RenderPipeline`（正常 + 未知宏降级）vs `visual::build_fallback_preview_latex` | 真实验证 `D-011` `degraded=true` + `diagnostics`（注意：`store` 仅在 `P-PRESET-88` 使用，未在 `P-RENDER-STORE-G2` 中单独调用） | **PASS** |
| 导出隔离 (`test_t2_5_parity_report_deterministic_serialization_and_safe_export`) | 确定性 JSON/MD 序列化 + 拒绝写 `docs/` 与 `agent-state/` | 真实双次对比、往返反序列化及路径拦截均通过 | **PASS** |

---

## 5. 阻断原因与最小复现

### 阻断 1：`P-PRESET-88` 同义反复断言掩盖 `App::to_latex()` 损坏的 LaTeX 宏输出
- **涉及位置**：
  - [`crates/mathslot-app/tests/parity_report_tests.rs:659-674`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/parity_report_tests.rs#L659-L674)
  - 根因关联：[`crates/mathslot-syntax/src/printer.rs:14-19,254-266`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs#L14-L19)（`ends_with_macro_name` 未覆盖 `Expr::RawLatex`，`starts_with_letter` 未覆盖 `Expr::Script` 等嵌套首字母，导致宏命令与后续字母粘连）。
- **最小复现**：
  1. 运行 `MATHSLOT_PARITY_REPORT_OUT=/tmp/parity-report-g2.json cargo test -p mathslot-app --test parity_report_tests --offline`
  2. 检查 `/tmp/parity-report-g2.json` 中 `P-PRESET-88`：
     - `P-PRESET-88:preset-matrix-svd`：`legacy_outcome` = `A = U \Sigma V^{T}`，而 `app_outcome` = `A=U\SigmaV^{T}`（非法宏 `\SigmaV`），状态却为 `ExactParity`。
     - `P-PRESET-88:preset-gaussian-pdf-1d`：`app_outcome` 含 `\sigmae^{-}`（非法宏 `\sigmae`），状态却为 `ExactParity`。
     - `P-PRESET-88:preset-infonce-contrastive-loss`：`app_outcome` 含 `\cdotk_{+/}`（非法宏 `\cdotk`），状态却为 `ExactParity`。
     - `P-PRESET-88:preset-klein-gordon-equation`：`app_outcome` 含 `\partialt^{2}`（非法宏 `\partialt`），状态却为 `ExactParity`。
     - `P-PRESET-88:preset-exterior-derivative-leibniz`：`app_outcome` 含 `\landd\eta`（非法宏 `\landd`），状态却为 `ExactParity`。
     - `P-PRESET-88:preset-electromagnetic-field-2-form`：`app_outcome` 含 `\landd{x}^{\nu}`（非法宏 `\landd`），状态却为 `ExactParity`。
- **期望 vs 实际**：
  - 期望：`P-PRESET-88` 应当验证 `app_latex = app.to_latex()` 重新解析后的 AST（或通过 `preset.source` 逐字符驱动 `App`）与 `legacy_latex` 等价，且不允许产生无效粘连宏名；发现差异时报告 `Mismatch` 并推动修复或按规程升级。
  - 实际：仅比对 `syntax_parse(&legacy_latex)` 与 `app.doc().nodes`（同一份 `syntax_parse(&legacy_latex)` 输出），将 6 条输出损坏 LaTeX 的预置全部标为 `ExactParity`。

### 阻断 2：`norm` / `floor` / `ceil` 定界符静默丢失（`INV-002`）被 `syntax_parse` 盲区掩盖
- **涉及位置**：
  - [`crates/mathslot-app/tests/parity_report_tests.rs:220-238,267-281`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/parity_report_tests.rs#L220-L238)
  - 根因关联：[`crates/mathslot-syntax/src/lexer.rs:170-189`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/lexer.rs#L170-L189) 与 [`crates/mathslot-syntax/src/parser.rs:517-530`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/parser.rs#L517-L530)（`\Vert`、`\lfloor`、`\rfloor`、`\lceil`、`\rceil` 均未建模，解析为 `Delim::Empty` 并打印为 `\left. ... \right.`）。
- **最小复现**：
  1. 见 `/tmp/parity-report-g2.json` 中以下场景：
     - `P-CMD-121:norm:0`：`legacy_outcome` = `\left\Vert x\right\Vert`，`app_outcome` = `\left. x \right.`，status = `IntentionalDelta(DELTA-FORMAT-MATRIX)`。
     - `P-CMD-121:floor:0`：`legacy_outcome` = `\left\lfloor x\right\rfloor`，`app_outcome` = `\left. x \right.`，status = `IntentionalDelta(DELTA-FORMAT-MATRIX)`。
     - `P-CMD-121:ceil:0`：`legacy_outcome` = `\left\lceil x\right\rceil`，`app_outcome` = `\left. x \right.`，status = `IntentionalDelta(DELTA-FORMAT-MATRIX)`。
     - `P-PALETTE:norm` / `P-PALETTE:floor` / `P-PALETTE:ceil`：`legacy_outcome` 为 `\left\Vert \right\Vert` / `\left\lfloor \right\rfloor` / `\left\lceil \right\rceil`，`app_outcome` 为 `\left.  \right.`，status = `ExactParity`。
     - `P-PRESET-88:preset-vector-dot-product`、`preset-vector-cross-product-norm`、`preset-gram-schmidt-orthogonalization`、`preset-ddpm-score-matching`：`\left\Vert ...\right\Vert` 在 `app_outcome` 中全部退化为 `\left. ... \right.`，status = `ExactParity`。
- **期望 vs 实际**：
  - 期望：定界符 `\Vert`、`⌊`/`⌋`、`⌈`/`⌉` 不得在 `app-core` 输出时静默丢失成空定界符 `.`；`DELTA-FORMAT-MATRIX` 只能覆盖格式空格/别名等语义等价差异，不能覆盖语义丢失。
  - 实际：因测试只用 `syntax_parse` 对比 AST 结构，双侧定界符一同被解析成 `Delim::Empty`，测试将语义丢失误报为 `ExactParity` 或 `DELTA-FORMAT-MATRIX`。

---

## 6. 未验证 / 风险

1. **跨 crate 修改边界风险**：上述 2 项根因均涉及 `crates/mathslot-syntax`（`lexer.rs` / `parser.rs` / `ast.rs` / `printer.rs`），该 crate 在 `ADR-0020` 中被列为禁止修改路径；是否扩展 `ADR-0020` 允许修复 `mathslot-syntax`（或先在 `parity_report_tests.rs` 中将 `\left.` 静默降级与 `app_latex` re-parse 失败暴露为真实 `Mismatch`/专项任务），需由 coordinator 决策后安排下一轮。
2. **`P-PRESET-88` 未覆盖直接简码流驱动**：当前 `P-PRESET-88` 仅通过 `AppEvent::ImportLatex` 测试导入路径，未额外比对通过 `preset.source` 逐字符 `KeyInput` 驱动 `App` 与 `StreamEditor::load_preset` 的结果。
3. **`P-EDIT-UNDO` 2 个子用例未直接调用 `StreamEditor`**：`paste-literal` 与 `whitespace-coalesce` 的 `legacy_outcome` 为描述性字符串（`StreamEditor` 无 `paste` 方法，但 `whitespace-coalesce` 可直接对比 `StreamEditor::from_source("a b")`）。
4. **`state.json` / `HANDOFF.md`**：本提交（`a564687`）未更新 `agent-state/state.json` 与 `HANDOFF.md`（按工作流应由 coordinator 在验收后更新；当前由本轮 FAIL 结论阻断 Gate G2 签署）。

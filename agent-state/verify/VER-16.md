---
id: VER-16
round: 16
gate: G2
task: T2.4
commit: 0ce4037dbc2c3efc31e07300985c0d9cafd181e3
defects: [D-003, D-008, D-010, D-011, D-019]
verdict: PASS
verifier: verifier
date: 2026-11-14
---

# 独立验收报告 (VER-16)

## 1. 结论

**PASS**。Round 16 提交 [`0ce4037dbc2c3efc31e07300985c0d9cafd181e3`](file:///home/mat/Projects/mathslot-next) 严格限定在 `ADR-0019` 允许路径内，完成 `crates/mathslot-render` 与桌面端 `src/{render,app,p1_regression_tests}.rs` 集成；`A-RENDER-001..005` 及 `D-003/D-008/D-010/D-011/D-019` 无头测试与门禁全部通过，`test_p1_d003_fitted_size_strictly_respects_max_bounds` 已接回真实生产函数并取消 `#[ignore]`，全工作区唯一剩余被忽略测试为 `D-007`（符合预期）。

---

## 2. 提交范围与代码卫生检查

### 2.1 Commit 与路径范围（`git show --stat 0ce4037` / `git diff 9ec3343..0ce4037 --name-only`）

- 提交信息：`T2.4: implement mathslot-render pipeline and fix D-003 D-008 D-010 D-011 D-019`
- 修改文件（共 14 个，全部命中 `ADR-0019` 允许路径）：
  - `Cargo.toml`、`Cargo.lock`
  - `crates/mathslot-render/Cargo.toml`
  - `crates/mathslot-render/src/{lib,types,fit,cache,cancel,error,pipeline}.rs`
  - `crates/mathslot-render/tests/render_acceptance_tests.rs`
  - `src/{render,app,p1_regression_tests}.rs`
- 冻结/禁止路径检查：未触碰 `crates/mathslot-core/src/{parser,ast,latex}.rs`、其他 workspace crates、`obsidian-mathslot/**`、`scripts/**`、`docs/**`、`agent-state/**`。

### 2.2 卫生扫描

- [`crates/mathslot-render/src/lib.rs:1`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/lib.rs#L1)：已声明 `#![forbid(unsafe_code)]`。
- `git diff 9ec3343..0ce4037` 增量扫描：零新增 `let _ =`、零 `#[allow]`、零 `#[ignore]`、零 `unsafe` 块、零产品代码 `.unwrap()`。
- [`src/render.rs:138-145`](file:///home/mat/Projects/mathslot-next/src/render.rs#L138-L145) 与 [`src/app.rs:712-730`](file:///home/mat/Projects/mathslot-next/src/app.rs#L712-L730)：原 `src/render.rs:90` 的 `let _ = self.tx_job.send(job)` 已消除，`RenderWorker::submit` 返回 `Result<Generation, RenderError>` 并在 UI 侧转为 `ErrorSummary` 展示。
- [`src/p1_regression_tests.rs:71-104`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L71-L104)：已删除本地镜像 `fitted_size` 拷贝，改为直接调用生产 [`crate::app::fitted_size_dims`](file:///home/mat/Projects/mathslot-next/src/app.rs#L2888-L2902) 与 [`mathslot_render::fit_to_box`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/fit.rs#L44-L88)，已移除 `#[ignore]` 且断言未弱化（新增与 `fit_to_box` 尺寸一致性校验）。

---

## 3. 逐项实现与验收核查

| 验收 / 缺陷 ID | 规范与 ADR 要求 | 代码证据（`file:line`） | 实测结果 | 判定 |
|---|---|---|---|---|
| **A-RENDER-001 / D-003 / INV-013** | 默认 `FitToWidth`；`ActualScale` 超宽时 `left_aligned` + 水平滚动；真实缩放百分比（非 `* 80.0`）；`test_p1_d003` 调用生产函数 | [`fit.rs:36-157`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/fit.rs#L36-L157), [`app.rs:162-163`](file:///home/mat/Projects/mathslot-next/src/app.rs#L162-L163), [`app.rs:1063`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1063), [`app.rs:1185-1207`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1185-L1207), [`p1_regression_tests.rs:71-104`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L71-L104) | `a_render_001_wide_formula_fits_width_and_actual_scale_scrolls_left_aligned` 与 `test_p1_d003_fitted_size_strictly_respects_max_bounds` 均 PASS | **PASS** |
| **A-RENDER-002 / D-008 / INV-013** | 导航图 `fit_to_box` 严格约束宽高；图像裁切子区与跳转徽章/`槽位直达`按钮物理隔离；对齐单行字体字号（`18.0`） | [`fit.rs:44-88`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/fit.rs#L44-L88), [`app.rs:31`](file:///home/mat/Projects/mathslot-next/src/app.rs#L31), [`app.rs:1236-1255`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1236-L1255), [`app.rs:1345-1375`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1345-L1375), [`app.rs:1483,2650`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1483) | `a_render_002_matrix_nav_box_strictly_bounded_and_aspect_preserved` PASS；字体均使用 `INPUT_MONO_FONT_SIZE = 18.0` | **PASS** |
| **A-RENDER-003 / D-011 / INV-012** | 主渲染失败触发降级必须设置 `degraded = true` 与非空 `diagnostics`；UI 显示`"降级预览"`徽章与原因 | [`pipeline.rs:124-136`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/pipeline.rs#L124-L136), [`render.rs:43-47`](file:///home/mat/Projects/mathslot-next/src/render.rs#L43-L47), [`render.rs:331-351`](file:///home/mat/Projects/mathslot-next/src/render.rs#L331-L351), [`app.rs:744-766,1004-1028`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1004-L1028) | `a_render_003_fallback_never_silent_and_emits_degraded_diagnostics` 与 `test_custom_formats_and_exotic_macro_fallback_in_latex_rust` PASS | **PASS** |
| **A-RENDER-004 / D-019** | 确定性 6 维 key（`(mode, latex, theme, scale_bits, backend, format)`）+ LRU 缓存；`GenerationTracker` 取消过期请求；`DebounceGate` 无墙钟 `sleep` | [`cache.rs:17-254`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/cache.rs#L17-L254), [`cancel.rs:6-110`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/cancel.rs#L6-L110), [`pipeline.rs:79-147`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/pipeline.rs#L79-L147), [`render.rs:70-153,260-356`](file:///home/mat/Projects/mathslot-next/src/render.rs#L70-L153), [`app.rs:151,704-734`](file:///home/mat/Projects/mathslot-next/src/app.rs#L704-L734) | `a_render_004_generation_cancellation_cache_key_and_debounce_gate` 与 `test_render_doc_cancellation_and_error_summary_bounds` PASS | **PASS** |
| **A-RENDER-005 / D-010** | header 单行摘要 `<= 120` 字符不挤占缩放按钮；`source_excerpt <= 200` 字符 + `"…（已截断）"`；折叠详情与复制按钮保留完整信息 | [`error.rs:60-176`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/error.rs#L60-L176), [`app.rs:989-1161`](file:///home/mat/Projects/mathslot-next/src/app.rs#L989-L1161) | `a_render_005_error_summary_bounded_header_and_source_excerpt` 与 `test_render_doc_cancellation_and_error_summary_bounds` PASS | **PASS** |

---

## 4. 独立执行命令与输出证据

### 4.1 `cargo fmt --check`
- **Exit Code**: `0`
- **输出尾部**:
  ```text
  EXIT=0
  ```

### 4.2 `cargo clippy --workspace --all-targets -- -D warnings`
- **Exit Code**: `0`
- **输出尾部**:
  ```text
      Finished `dev` profile [optimized + debuginfo] target(s) in 0.20s
  EXIT=0
  ```

### 4.3 `cargo test -p mathslot-render --offline`
- **Exit Code**: `0`
- **输出尾部**:
  ```text
       Running tests/render_acceptance_tests.rs (target/debug/deps/render_acceptance_tests-870bf31ae298144f)

  running 5 tests
  test a_render_001_wide_formula_fits_width_and_actual_scale_scrolls_left_aligned ... ok
  test a_render_002_matrix_nav_box_strictly_bounded_and_aspect_preserved ... ok
  test a_render_003_fallback_never_silent_and_emits_degraded_diagnostics ... ok
  test a_render_005_error_summary_bounded_header_and_source_excerpt ... ok
  test a_render_004_generation_cancellation_cache_key_and_debounce_gate ... ok

  test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Doc-tests mathslot_render

  running 0 tests

  test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

  EXIT=0
  ```

### 4.4 `cargo test --workspace --offline`
- **Exit Code**: `0`
- **汇总**: 全工作区合计 **210 passed; 0 failed; 1 ignored**（唯一 ignored 为 `D-007`）。
- **关键输出尾部**:
  ```text
       Running unittests src/main.rs (target/debug/deps/mathslot-8945fbe915c2acd6)

  running 7 tests
  test p1_regression_tests::test_p1_d001_palette_tiles_strictly_match_command_catalog ... ok
  test p1_regression_tests::test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file ... ok
  test p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds ... ok
  test render::tests::test_render_doc_cancellation_and_error_summary_bounds ... ok
  test render::tests::test_custom_formats_and_exotic_macro_fallback_in_latex_rust ... ok
  test render::tests::test_all_structs_and_symbols_compile_in_latex_rust ... ok
  test render::tests::test_nested_roots_limit_and_hierarchical_nav_render_cleanly ... ok

  test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.30s
  ...
  test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  EXIT=0
  ```

### 4.5 `cargo test --workspace --offline -- --ignored`
- **Exit Code**: `101`（预期：仅剩 `D-007` 失败回归测试处于 `#[ignore]`，原 `D-003` 已修复并移出 ignored 列表）
- **输出尾部**:
  ```text
       Running tests/p1_regression_tests.rs (target/debug/deps/p1_regression_tests-55223c65b829dedf)

  running 1 test
  test test_p1_d007_latex_import_reports_lossy_and_blocks_degradation ... FAILED

  failures:
      test_p1_d007_latex_import_reports_lossy_and_blocks_degradation

  test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s

  error: test failed, to rerun pass `-p mathslot-core --test p1_regression_tests`
  EXIT=101
  ```

### 4.6 `cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline`
- **Exit Code**: `0`
- **输出尾部**:
  ```text
      Finished `dev` profile [optimized + debuginfo] target(s) in 0.09s
  EXIT=0
  ```

### 4.7 `cargo check -p mathslot-render --target wasm32-unknown-unknown --offline`
- **Exit Code**: `0`
- **输出尾部**:
  ```text
      Finished `dev` profile [optimized + debuginfo] target(s) in 0.07s
  EXIT=0
  ```

### 4.8 `scripts/agent/acceptance.sh`
- **Exit Code**: `0`
- **输出尾部**:
  ```text
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
  EXIT=0
  ```
  注：`let _ =` 计数由基线 16 降至 15（已清除 `src/render.rs:90`）；未提交 2 个文件为待入库的 `AUD-16.md` 与 `ADR-0019-*.md`。

---

## 5. 未验证项与风险

1. **实时桌面 GUI 视觉截图走查未在本轮无头验收中执行**：当前 `A-RENDER-001..005`、`D-003`/`D-008`/`D-010`/`D-011` 的缩放、分区裁切、`"降级预览"` 徽章、错误摘要截断与折叠详情均已通过代码审查与无头测试验证，但尚未运行 `--release` 桌面二进制并打开真实渲染截图目视核查窗口排版（可留待 Gate G3/G4 截图回归矩阵补齐）。
2. **`agent-state/state.json` 与 `HANDOFF.md` 尚未更新**：需由 coordinator 在收到本 `VER-16.md` 后更新状态文件与工作区文档提交。

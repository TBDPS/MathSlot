# ADR-0006：为 P1 缺陷建立失败回归测试（T0.3）

- 日期：2026-11-13
- 状态：已批准
- 决策者：coordinator（依据 `AUD-3` 审计结论与规范 §14 G0 / T0.3）
- 关联任务：`T0.3`
- 关联缺陷：`D-001`, `D-002`, `D-003`, `D-004`, `D-005`, `D-006`, `D-007`, `D-101`

## 1. 背景与依据

- 规范 §14 G0 任务：
  > T0.3 | 为 P1 写失败回归测试（D-001..D-007） | T0.1 | 测试文件 | 修复前失败、修复后通过
- 规范 §14 G0 退出条件：
  > CI 绿；P1 测试存在；clippy 债务可控；基线 tag 建立。
- `AUD-3` 独立审计确认：7 项 P1 缺陷在当前代码中全部客观存在（OPEN），且历史测试套件中残留大量 D-101 假测试（以读取源码文本为断言）。
- 依据 TDD 规则与 `AGENTS.md` 硬规则 4：“任何行为变更先提交/展示一个会失败的测试，再改实现，再展示通过”。

## 2. 决策内容与架构设计

### 2.1 测试文件落位与分工

为保持职责单一并彻底防御 D-101（禁止跨 crate 静态读取源码），新测试分为两组：

1. **核心库行为回归测试**：
   - 路径：`crates/mathslot-core/tests/p1_regression_tests.rs`
   - 包含用例：
     - `test_p1_d002_documented_commands_exist_and_match_semantics`（D-002: 文档承诺的 `ch`/`cj`/`oq` 不存在及 `qm`/`op` 语义漂移）
     - `test_p1_d004_pending_and_unknown_commands_never_silently_disappear`（D-004: `▸m`、`1 + ▸m + 2`、`▸zz` 导出不为空且不丢前缀）
     - `test_p1_d006_formula_upsert_same_millisecond_no_collision`（D-006: 同毫秒连续 1000 次 upsert 无碰撞覆盖，条目数达 1000）
     - `test_p1_d007_latex_import_reports_lossy_and_blocks_degradation`（D-007: 不支持宏导入时返回诊断报告并阻断直接替换）

2. **桌面端与 UI 行为回归测试**：
   - 路径：`src/p1_regression_tests.rs`（在 `src/main.rs` 中声明 `#[cfg(test)] mod p1_regression_tests;`）
   - 包含用例：
     - `test_p1_d001_palette_tiles_strictly_match_command_catalog`（D-001: 5 张卡片 `ob`/`xa`/`oe`/`od`/`xb` 与 catalog 命令定义一致性）
     - `test_p1_d003_fitted_size_strictly_respects_max_bounds`（D-003: 有限宽高下 `fitted_size` 计算尺寸不得超过限制）
     - `test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file`（D-005: 注入损坏 JSON，配置加载必须返回 `Err` 且保留坏损文件）

### 2.2 失败执行与基线兼容策略

1. **防破坏全绿 CI 契约**：
   - G0 退出硬性要求“CI 绿”与“133 测试通过基线不破”。如果将 7 个必然失败的测试直接加入默认测试流，将导致 `cargo test --workspace` 失败（exit 101），从而导致 `acceptance.sh` 与 CI 流水线无法退出 G0。
   - 解决方案：7 个 P1 回归测试统一标注 `#[test]` 与 `#[ignore = "P1 regression: D-00x (fails until fixed in G1/G2/G4)"]`。
2. **失败有效性验证**：
   - 默认执行 `cargo test --workspace` 产生 `133 passed; 0 failed; 7 ignored`（exit 0，CI 全绿）；
   - 执行 `cargo test --workspace -- --ignored` 或指定测试文件时，7 个测试全部运行，且**必须全部真实失败（FAIL）**，逐条输出断言 Panic 证据，严密证明其能够有效拦截对应缺陷。
3. **缺陷修复生命周期**：
   - 在后续 Gate 针对各缺陷实施修复时（例如 T1.3 修复 D-001/D-002），将对应测试的 `#[ignore]` 移除，测试转绿并永久纳入默认测试套件。

### 2.3 严禁事项

- 严禁修改任何产品代码逻辑；本轮仅允许编写测试与声明测试模块。
- 严禁任何断言采用 `include_str!`、`fs::read_to_string` 检查源码字符串（D-101）。

## 3. 验收要求（VER-3）

- `cargo fmt --check`：exit 0
- `cargo clippy --workspace --all-targets -- -D warnings`：exit 0
- 默认测试：`cargo test --workspace`：exit 0（133 passed; 0 failed; 7 ignored）
- 失败测试有效性：`cargo test --workspace -- --ignored`：7 failed，逐项提供 D-001..D-007 的 Panic 证据。
- 提交信息：`T0.3: add failing regression tests for P1 defects D-001..D-007`

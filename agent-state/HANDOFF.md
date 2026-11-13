# 交接单（每轮结束必须更新）

> 上下文会被压缩。压缩后只有这份文件和 `state.json` 能告诉你进度。三行以内讲清"做了什么、证据在哪、下一步是什么"。

## 当前

- 轮次：15
- Gate：G2
- 当前任务：T2.3 已完成（新增 `crates/mathslot-store` 原子写/锁/备份轮转/损坏隔离/v1-v2->v3 迁移/`catalog/presets.json`，接管 `src/modals.rs` & `src/app.rs` 并消除 8 处 `let _ =`，修复 `D-005`, `D-006`, `D-013`, `D-014`, `D-022`, `D-102`）
- 下一步：`T2.4` 实现 `crates/mathslot-render`（`FontMetrics`、字号阶梯、光标渲染、换行与选区，`A-RENDER-001..005`，闭环 P1 `D-003` 及 `D-008`, `D-010`, `D-011`, `D-019`）

## 本轮做过什么

- 审计产出 `AUD-15.md`：复核 `D-005`/`D-006` 均失败（exit 101）、识别 `src/p1_regression_tests.rs` 测本地镜像而非真实 `modals` 路径、`src/{app,modals}.rs` 8 处持久化 `let _ =`、以及离线 Cargo 缓存（无 `directories`/`fs2`，改用 `dirs`/`fd-lock`/`tempfile`/`serde_json`/`thiserror`）。
- 决策批准 `ADR-0018`：确定 `crates/mathslot-store`（`#![forbid(unsafe_code)]`）、`catalog/presets.json` 88 条预置剥离、`library.rs` 单调 UUIDv7 与严格 JSON 解析、以及生产路径重连方案。
- 实现提交 `0497fc3`：`T2.3: implement mathslot-store atomic persistence and fix D-005 D-006 D-013 D-014 D-022 D-102`，清除 8 处 `let _ =`（全仓从 24 降至 16），解除 `test_p1_d005`/`test_p1_d006` `#[ignore]`。
- 验收产出 `VER-15.md`：独立核验 `cargo fmt --check`、`clippy -D warnings`、`cargo test --workspace --offline`（203 passed, 2 ignored）、`cargo test -p mathslot-store --offline`（7 passed）、`wasm32` check、`acceptance.sh`（PASS=4 FAIL=0）全部通过，判定 PASS。

## 证据在哪

- `agent-state/audits/AUD-15.md`
- `agent-state/decisions/ADR-0018-mathslot-store-and-data-safety-t2.3.md`
- `agent-state/verify/VER-15.md`
- Commit：`0497fc3` (`T2.3: implement mathslot-store atomic persistence and fix D-005 D-006 D-013 D-014 D-022 D-102`)
- 门禁：`cargo test -p mathslot-store --offline` (7 passed)；`cargo test --workspace --offline` (203 passed, 2 ignored)；`scripts/agent/acceptance.sh` (PASS=4 FAIL=0 WARN=4)

## 下一轮入口

- 先派 auditor 审计 `T2.4`（`crates/mathslot-render`、`D-003`/`D-008`/`D-010`/`D-011`/`D-019`、`src/` 现有渲染与字体逻辑、`A-RENDER-001..005`），产出 `agent-state/audits/AUD-16.md`。
- 不修改冻结的 `crates/mathslot-core/src/{parser,ast,latex}.rs` 或 `scripts/agent/**`、`docs/**`。

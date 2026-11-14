# 交接单（每轮结束必须更新）

> 上下文会被压缩。压缩后只有这份文件和 `state.json` 能告诉你进度。三行以内讲清"做了什么、证据在哪、下一步是什么"。

## 当前

- 轮次：17
- Gate：G2
- 当前任务：`T2.5` 第一轮验收 **FAIL**（`parity_report_tests.rs` 虽绿，但 `VER-17` 暴露 `mathslot-syntax` 两项实质缺陷 `D-108`/`D-109` 与测试同义反复/AST 盲区问题，留在 `T2.5` 闭环后方可通过 `G2`）
- 下一步：Round 18 在 `T2.5` 范围内写 `ADR-0021` 扩大白名单至 `crates/mathslot-syntax` 与 `crates/mathslot-app/tests/parity_report_tests.rs`，先红后绿修复 `D-108`（宏与字母粘连）与 `D-109`（`\Vert`/`\lfloor`/`\rfloor`/`\lceil`/`\rceil` 静默丢失为 `Delim::Empty`），并消除 `P-PRESET-88` 同义反复及完善 `P-EDIT-UNDO`/`P-PRESET-88` 对照。

## 本轮做过什么

- 审计 `AUD-17.md`：核验 G2 前置（`D-003`/`D-005`/`D-006` 已 FIXED，全仓仅余 G4 `D-007` 1 处 `#[ignore]`），梳理 `T2.5` 对 `App` vs `StreamEditor` 的缺口与 Red-first 蓝图。
- 决策 `ADR-0020` 与实现 `a564687`：在 `crates/mathslot-app/tests/parity_report_tests.rs` 建立 348 场景无头对照报告测试（`P-CMD-121`, `P-PALETTE`, `P-EDIT-UNDO`, `P-NAV`, `P-DIAG-EXPORT`, `P-PRESET-88`, `P-RENDER-STORE-G2`）。
- 验收 `VER-17.md`（**FAIL**）：独立核查实际产出的 `/tmp/parity-report-g2.json` 发现 `P-PRESET-88` 未 re-parse `app.to_latex()`，掩盖了 6 条预置的非法粘连宏（`\SigmaV`, `\sigmae`, `\cdotk`, `\partialt`, `\landd` -> 记为 `D-108`），且 `mathslot_syntax` 将 `\Vert`/`\lfloor`/`\rfloor`/`\lceil`/`\rceil` 降级成 `\left. ... \right.`（`Delim::Empty`，违反 `INV-002` -> 记为 `D-109`）。

## 证据在哪

- `agent-state/audits/AUD-17.md`
- `agent-state/decisions/ADR-0020-headless-parity-app-core-and-g2-exit-t2.5.md`
- `agent-state/verify/VER-17.md`（Verdict: FAIL）
- Commit：`a564687` (`T2.5: add headless parity tests and report comparing mathslot-core vs app-core`)

## 下一轮入口

- 编写 `ADR-0021`（`T2.5` 修复轮）：直接针对 `VER-17` 阻塞项与根因（`D-108`、`D-109`、消除 `P-PRESET-88` 同义反复断言并真实校验 `app.to_latex()` 重解析 + 禁止 `\left.` 定界符静默丢失），派 `implementer` 先红后绿修复再提交 `T2.5` 修复提交，最后派独立 `verifier` 出具 `VER-18.md`。

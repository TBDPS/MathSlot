# 交接单（每轮结束必须更新）

> 上下文会被压缩。压缩后只有这份文件和 `state.json` 能告诉你进度。三行以内讲清"做了什么、证据在哪、下一步是什么"。

## 当前

- 轮次：0（未开始）
- Gate：G0
- 当前任务：无
- 下一步：`T0.1` 建立 CI（`.github/workflows/ci.yml`：fmt / clippy / test / WASM / plugin build）

## 本轮做过什么

- 冻结完成：tag `freeze/pre-refactor-20261112`、只读副本 `/home/mat/Projects/mathslot-freeze-20261112`。
- 建立工作区脚手架：`AGENTS.md`、`.agents/skills/`（refactor-loop / independent-audit / independent-verify）、`agent-state/`、`scripts/agent/`。
- `docs/` 从 `.gitignore` 移出并纳入版本库（ADR-0002）；3 个"必须忽略 docs/"的测试已按新策略改写。
- 新登记 D-101（P1）：验收测试以源码字符串为断言，不验证行为。
- 产品代码未改；`cargo test --workspace` 仍为 133 passed。

## 证据在哪

- `scripts/agent/audit_palette.py`：可复现 5 张调色板错码（P1 证据）。
- `scripts/agent/acceptance.sh --fast`：当前 PASS=1 FAIL=1（fmt 失败），clippy 未跑；完整跑必然失败。
- `agent-state/decisions/ADR-0002-...md`：证据进版本库与测试策略变更。

## 卡在哪 / 需要人工

- 无。等待第一轮开工：先审计 D-001..D-007，再批准 T0.1。

## 下一轮入口

1. 读 `AGENTS.md` → 规范 §2/§4/§14 → `state.json`。
2. 派 `auditor` 复核 D-001..D-007 现状（只读）。
3. 派 `implementer` 做 T0.1（CI），提交后派 `verifier` 验收。

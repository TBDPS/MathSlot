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
- 未改任何产品代码。

## 证据在哪

- `scripts/agent/audit_palette.py`：可复现 5 张调色板错码（P1 证据）。
- `scripts/agent/acceptance.sh`：当前基线应显示 FAIL（clippy + 调色板）。

## 卡在哪 / 需要人工

- 无。等待第一轮开工。

## 下一轮入口

1. 读 `AGENTS.md` → 规范 §2/§4/§14 → `state.json`。
2. 派 `auditor` 复核 D-001..D-007 现状（只读）。
3. 派 `implementer` 做 T0.1（CI），提交后派 `verifier` 验收。

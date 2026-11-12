# 交接单（每轮结束必须更新）

> 上下文会被压缩。压缩后只有这份文件和 `state.json` 能告诉你进度。三行以内讲清"做了什么、证据在哪、下一步是什么"。

## 当前

- 轮次：0（未开始）
- Gate：G0
- 当前任务：无
- 下一步：`T0.1` 建立 CI（`.github/workflows/ci.yml`：fmt / clippy / test / WASM / plugin build）

## 本轮做过什么

- 冻结完成：tag `freeze/pre-refactor-20261112`、只读副本 `/home/mat/Projects/mathslot-freeze-20261112`。
- 建立工作区脚手架：`AGENTS.md`、`.agents/skills/`、`agent-state/`、`scripts/agent/`。
- `docs/` 从 `.gitignore` 移出并纳入版本库（ADR-0002）；3 个"必须忽略 docs/"的测试已按新策略改写。
- 新登记 D-101（P1）：验收测试以源码字符串为断言，不验证行为。
- 接入 OpenCode 外部监督者：`supervise.sh`（隔离 worktree）、`check_review.py`（严格匹配）、`watch.sh`、Stop hook、`REQUIRE_REVIEW` 门禁。
- `REV-2e256cd` 首轮审查为 **REJECT**；已按 ADR-0003 修正：去掉自造 `T0.0`、严格 sha 匹配、reviewer 校验、worktree 隔离、reviews 独占写域。
- 产品代码未改；`cargo test --workspace` 仍为 133 passed。

## 证据在哪

- `agent-state/reviews/REV-2e256cd.md`：外部监督者的第一份审查（REJECT + 最小复现）。
- `scripts/agent/tests/test_check_review.py`：6 个门禁安全回归测试，已通过。
- `scripts/agent/acceptance.sh --fast`：当前 PASS=1 FAIL=1（fmt 失败），clippy 未跑。
- `agent-state/decisions/ADR-0002`、`ADR-0003`、`OPEN-0001`。

## 卡在哪 / 需要人工

- `OPEN-0001`：外部监督者接线是否登记为 `T0.6`，需要你选 A/B/C（建议 A）。
- 权限收窄：`permissions.allow` 里的 `command(*)` 建议改成项目白名单。

## 下一轮入口

1. 读 `AGENTS.md` → 规范 §2/§4/§14 → `state.json`。
2. 派 `auditor` 复核 D-001..D-007 与 D-101（只读）。
3. 派 `implementer` 做 T0.1（CI），提交后派 `verifier` 验收。
4. 每轮结束跑 `scripts/agent/supervise.sh`；G0 收口用 `REQUIRE_REVIEW=1 scripts/agent/acceptance.sh`。

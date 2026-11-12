# OPEN-0001：外部监督者接线如何登记进规范

- 日期：2026-11-13
- 状态：待人工确认
- 提出者：coordinator
- 触发：`REV-2e256cd`（外部监督者）判定 REJECT，理由包含"自造任务号 T0.0"

## 问题

本轮新增了 OpenCode 外部监督者接线（`.opencode/agents/supervisor.md`、`supervise.sh`、`check_review.py`、`watch.sh`、Stop hook、`REQUIRE_REVIEW` 门禁）。它属于 G0 的护栏，但规范 §14 的 G0 只有 `T0.1..T0.5`，没有对应任务。

自造 `T0.0` 违反 `agent-state/README.md` 的 ID 规则，也违反"任务只来自 §14"。

## 选项

| 选项 | 做法 | 代价 |
|---|---|---|
| **A（建议）** | 在 §14 G0 增加 `T0.6 外部监督者接线`，退出条件：`REQUIRE_REVIEW=1` 可拦截；`check_review.py` 有回归测试；一次真实 Stop 事件验证 hook；REV 目录为 supervisor 独占 | 需要人工改规范 §14（agent 不得自行改） |
| B | 不登记任务号，作为"pre-G0 工具链"，以 ADR 记录，不进入 Gate 验收 | 没有验收项，后续容易腐烂；REV 无法绑定到任务 |
| C | 把接线并入 T0.1（CI） | 混淆范围；T0.1 的验收会被稀释 |

## 需要人工做的事

- 选 A/B/C 之一；
- 选 A 时，由你（人类）在 `docs/LLM_IMPLEMENTATION_SPEC.md` §14 的 G0 表追加 T0.6 行；
- 确认后把本文件状态改为"已决"，并在 `state.json` 的 `human_approvals` 里记录。

在确认前，本轮工具链提交不使用任何 `T-*` 编号，只引用 `OPEN-0001` 与 `D-101`。

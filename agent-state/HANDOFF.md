# 交接单（每轮结束必须更新）

> 上下文会被压缩。压缩后只有这份文件和 `state.json` 能告诉你进度。三行以内讲清"做了什么、证据在哪、下一步是什么"。

## 当前

- 轮次：4
- Gate：G0
- 当前任务：T0.4 已完成，待进入 T0.5
- 下一步：`T0.5` 建立故障注入 harness（磁盘满/只读/损坏/并发），为 G0 最终收口做准备

## 本轮做过什么

- 审计产出 `AUD-4.md`：梳理 121 项静态命令、44 项结构、77 项符号与 88 条预设，规划基线快照与 Tag 方案，定性 BLOCK。
- 决策批准 `ADR-0007`：确立重构期间命令语言冻结不变量，批准落盘命令基线 JSON 快照与打标 `baseline/g0-guardrails`。
- 实现提交 `07422c4`：`T0.4: freeze command language snapshot and establish G0 baseline tag`，并创建附注标签 `baseline/g0-guardrails` 与 `freeze/baseline-g0`。
- 验收产出 `VER-4.md`：快照 JSON 解析（121 命令、88 预设）、标签精准锚定、门禁与基线保持（133 passed; 0 failed; 7 ignored），判定 PASS。

## 证据在哪

- `agent-state/audits/AUD-4.md`
- `agent-state/decisions/ADR-0007-freeze-command-language-baseline-t0.4.md`
- `agent-state/verify/VER-4.md`
- `agent-state/baseline/commands-baseline-v0.7.0.json`
- Commit：`07422c4`
- Git Tags：`baseline/g0-guardrails`、`freeze/baseline-g0`

## 卡在哪 / 需要人工

- 无阻塞。
- 外部审查仍为 final-only。

## 下一轮入口

1. 读规范 §14 G0 任务 T0.5（建立故障注入 harness：磁盘满/只读/损坏/并发，产出测试工具，退出条件：可在 CI 本地复现）。
2. 派 `auditor` 审计现有持久化故障模式与测试 harness 契约，产出 `AUD-5`。
3. 决策批准 `ADR-0008`。
4. 派 `implementer` 编写故障注入 harness（位于 tests/ 或 crates/ 中）。
5. 派 `verifier` 独立验证 harness 功能并产出 `VER-5`。
6. 收口 Gate G0：运行 `scripts/agent/acceptance.sh`，输出至 `agent-state/verify/GATE-G0.md`。

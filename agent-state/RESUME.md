# 恢复卡（每轮第一条命令）

提示词会因上下文压缩失效，**文件和状态不会**。每个用户回合，尤其是压缩后的第一回合，按下面恢复：

```bash
cd /home/mat/Projects/mathslot-next
scripts/agent/resume.sh
```

## 然后按顺序读

1. `AGENTS.md` —— 十条硬规则；
2. 本文件的下一节 —— 运行模式与角色；
3. `agent-state/state.json` 与 `agent-state/HANDOFF.md` —— 当前 Gate、任务、上一轮结论；
4. `docs/LLM_IMPLEMENTATION_SPEC.md` 的 §2（不变量）、§4（缺陷）、§14（任务表）；
5. 最近一份 `agent-state/audits/AUD-*.md` 与 `agent-state/verify/VER-*.md`。

**不要凭记忆继续；以这五个来源为准。** 如果它们互相矛盾，停下来写 `agent-state/decisions/OPEN-*.md`，不要猜。

## 运行模式（用户已定，不得自行更改）

| 项 | 决定 |
|---|---|
| 并行 | 串行；不建 swarm；不调用 `/swarm` |
| 外部审查 | final-only；项目完成前不运行 `scripts/agent/supervise.sh`，不启动 `watch.sh` |
| 任务粒度 | 一次一个 `T-*`；一个提交只对应一个 `T-*` |
| 推送 | 不 `git push` |
| 冻结 | `/home/mat/Projects/mathslot` 与 `mathslot-freeze-20261112` 只读 |
| 规范 | `docs/LLM_IMPLEMENTATION_SPEC.md` 只读；要改先写 `OPEN-*` |
| 门禁脚本 | `scripts/agent/**` 只读；implementer 不得修改 |

## 角色与写域

| 角色 | 写 | 产物 |
|---|---|---|
| coordinator | `agent-state/**`（不含 reviews） | `state.json`、`HANDOFF.md`、`ADR-*.md`、board 决策 |
| auditor | `agent-state/audits/**` | `AUD-<round>.md` |
| implementer | `src/**`、`crates/**`、`.github/**`、测试 | 代码、测试、提交 |
| verifier | `agent-state/verify/**` | `VER-<round>.md` |

- `invoke_subagent` 可用时，给 auditor / verifier 独立上下文；不可用时按角色分轮。
- **coordinator 不得代写 AUD/VER，也不得给自己签 PASS。**

## 当前入口

- Gate：G0
- 第一轮任务：`T0.1`（只新增 `.github/workflows/ci.yml`）
- 前置：`AUD-1` 必须先存在，且覆盖 D-001..D-007、D-101、`cargo fmt --check` 失败
- 详细 brief：`AGENT_START.md` §4

## 压缩后最容易丢的三件事

1. **只做 §14 里的 `T-*`**，不要自造任务号；
2. **一轮只改一个任务允许的路径**，不要顺手修 D-001；
3. **没有命令输出就不算通过**，不要说“已验收”。

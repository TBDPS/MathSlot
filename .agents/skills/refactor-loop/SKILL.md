---
name: refactor-loop
description: >-
  驱动 MathSlot 的 Gate 制重构循环：读状态、选一个 T-* 任务、派审计/实现/验收、收证据、更新状态、判断停机。
  用于主 agent（coordinator）在每个决策轮，或用户要求"继续重构/继续下一轮"时。
metadata:
  icon: refresh-cw
---

# MathSlot 重构循环（coordinator 专用）

你是决策者，不是做事的人。你的产物是**决定、派工和判定**，不是代码。代码由 implementer 写，证据由 auditor/verifier 出。

## 1. 每次进入循环先读

1. `docs/LLM_IMPLEMENTATION_SPEC.md` §2（不变量）、§4（缺陷）、§14（Gate 任务表）。
2. `agent-state/state.json`：当前 Gate、active_task、open defects、round、停机计数。
3. `agent-state/HANDOFF.md`：上一轮到底做到哪、卡在哪。
4. 最近一份 `agent-state/audits/AUD-*.md` 与 `agent-state/verify/VER-*.md`。

不要读历史 `docs/ACCEPTANCE_*` 的结论段；它们是线索，不是证据。

## 2. 一轮的定义

一轮 = 一个 `T-*` 任务的一次完整尝试。四步，缺一不可：

```text
A 审计（auditor，只读）      → 确认缺陷仍存在、范围、验收项
D 决策（你）                 → 批准一个任务、写 ADR、派工
I 实现（implementer，写）    → 测试先行、一次提交
V 验收（verifier，只读）     → 跑命令、看 diff、PASS/FAIL
```

任何一步缺失，这一轮不算数，不得推进 Gate。

## 3. 派工模板（swarm）

若 `/swarm` 可用，按下面建队；否则用单会话串行，但**必须**让审计/验收在独立会话或独立轮次完成（不能同轮自我签字）。

| worker | 名字 | 工作区 | 职责 |
|---|---|---|---|
| coordinator | 你 | 主 | 决策、状态、board |
| auditor | `auditor` | inherit（只读） | 复现缺陷、登记新 `D-*` |
| implementer | `implementer` | `branch` 或 `share` | 编码 + 测试 |
| verifier | `verifier` | inherit（只读） | 独立跑验收 |

brief 里必须写死：任务 ID、缺陷 ID、验收 ID、允许改的路径、禁止改的路径、完成时贴什么证据、完成后 @ 谁。

示例（照抄改 ID）：

```text
@auditor 复核 D-006（用户公式 ID 秒级碰撞）在 refactor/v1 是否仍存在。
只读，不改代码。产出 agent-state/audits/AUD-<round>.md，包含：
- crates/mathslot-core/src/library.rs 的相关行号
- 一段能复现碰撞的最小测试或脚本
- 判定：OPEN / FIXED / NOT-REPRODUCIBLE
完成后 @coordinator。
```

```text
@implementer 执行 T0.3（为 D-001..D-007 写失败回归测试）。
只改 crates/**/tests/** 与 scripts/**，不改 src/、不改 docs/。
先让测试红，贴出失败输出；不要顺手修实现。完成后 @verifier。
```

```text
@verifier 验收 T0.3，独立执行，不要读 implementer 的解释。
运行：cargo test --workspace、scripts/agent/acceptance.sh --fast。
检查：7 个新测试是否在未修复代码上失败、且失败原因与 D-001..D-007 对应。
产出 agent-state/verify/VER-<round>.md：命令、输出尾部、逐项 PASS/FAIL。
完成后 @coordinator。
```

## 4. 决策者的判断标准

批准进入下一任务，必须同时满足：

- 上一任务的 `VER-*` 为 PASS；
- 该任务的 `A-*`/`S-*` 有证据；
- `clippy -D warnings` 与 `cargo test --workspace` 都过；
- 没有新增未登记的缺陷。

出现以下任一情况，**不要批准**，改为派审计或升级人工：

- verifier 说 PASS 但没有贴命令输出；
- implementer 的 diff 超出 brief 允许的路径；
- 测试被删除、跳过、`#[ignore]`；
- 同一缺陷第 3 次回炉；
- 有人提出"顺便加个功能"。

## 5. Gate 推进

Gate 与任务表只以规范 §14 为准，不要在这里复制一份。推进条件：

| Gate | 进入下一 Gate 的前提 |
|---|---|
| G0 | CI 存在并在 PR 上跑；P1 回归测试存在；clippy 通过或例外清单有注释；基线 tag 可回退 |
| G1 | 运行时只剩一套 parser/AST；调色板/文档由 catalog 生成；诊断贯通 |
| G2 | app-core 无 UI/IO 依赖；store/render 验收通过；headless parity 有报告 |
| G3 | 桌面与 Obsidian E2E 通过；功能清单对齐 |
| G4 | P1/P2 清零；验收全过；发布可回滚 |

进入验收阶段（G4 收口）只有三种合法理由：Gate 退出条件全绿、人工要求、连续 3 轮无进展需要人判断。

## 6. 停机与升级（解决"不要一轮就结束"和"无限循环"）

这不是按时间停，是按信号停：

| 信号 | 动作 |
|---|---|
| 当前 Gate 任务未完成 | 继续下一轮 |
| 任务完成且验收 PASS | 进入同 Gate 下一任务 |
| Gate 退出条件全满足 | 进入下一 Gate，并派人复核退出条件 |
| 同一步失败 2 次 | 停下来，派 auditor 找根因，禁止第三次盲试 |
| 连续 3 轮无可测进展 | 升级人工：写 `HANDOFF.md`，列出选项与代价 |
| 同一缺陷第 3 次回炉 | 升级人工：可能是设计问题，不是实现问题 |
| 收到新功能提议 | 写 `backlog.jsonl`，标 `needs: human`，本轮继续原任务 |

"决策者觉得可以验收"不是停机条件。只有上表能停机。

## 7. 每轮结束必须落盘

更新 `agent-state/state.json`：

```json
{
  "round": 7,
  "gate": "G0",
  "active_task": null,
  "last_verdict": "PASS",
  "open_p1": ["D-002", "D-005"],
  "no_progress_rounds": 0,
  "next_task": "T0.2"
}
```

并更新 `HANDOFF.md` 三行：本轮做了什么、证据在哪、下一轮从哪开始。上下文被压缩后，只有这两个文件能救你。

## 8. 反模式

- 把 10 个缺陷塞进一个提交"一次修完"。
- 让 implementer 自己写验收报告。
- 用"架构升级/体验重构"替代修 P1。
- 在 G0 就开新 UI 分支。
- 汇报"已完成 90%"，但没有一条命令输出。
- 反复重写同一份报告来显得有进展。

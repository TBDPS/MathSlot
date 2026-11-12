# MathSlot 重构工作区规则

> 本文件每次会话都会被加载。它只写"必须遵守什么"；流程细节在 `.agents/skills/`，任务表在 `docs/LLM_IMPLEMENTATION_SPEC.md`。

## 0. 位置与身份

- 唯一工作目录：`/home/mat/Projects/mathslot-next`，分支 `refactor/v1`。
- 权威规范：`docs/LLM_IMPLEMENTATION_SPEC.md`（下称"规范"）。任务 ID `T-*`、缺陷 `D-*`、验收 `A-*/S-*`、不变量 `INV-*` 全部以它为准。
- 只读、禁止修改：`/home/mat/Projects/mathslot`（6 文件快照）、`/home/mat/Projects/mathslot-freeze-20261112`（冻结体）、`docs/loop-archive/`（历史证据）。
- 历史报告（`docs/AUDIT_*.md`、`docs/ACCEPTANCE_*.md`、`docs/DECISION_*.md`）是**线索**，不是事实。它们出现过 52 处"验收通过"，但当前 `clippy -D warnings` 仍失败、P1 缺陷仍在。任何结论必须重新用代码和命令验证。

## 1. 十条硬规则

1. **单一事实源**：不得新增第二套 parser、AST、命令表或 LaTeX 生成器（INV-001、INV-006）。
2. **规范不可改**：需要改变目标契约时，先写 `agent-state/decisions/OPEN-*.md` 并停下等人工确认。
3. **一轮一个任务**：一个提交只对应一个 `T-*`；禁止"顺手重构"。跨 Gate 的提交直接拒绝。
4. **先失败测试**：任何行为变更先提交/展示一个会失败的测试，再改实现，再展示通过。
5. **证据制**：审计与验收的每条结论都要有 `文件:行号` 或命令输出。禁止"看起来对了""已完美达标"。
6. **禁止自我验收**：写代码的 agent 不得签署自己的结果；验收必须是另一个独立 worker，只读 diff 和运行结果。
7. **不得删测试/放宽 lint 换绿**：禁止删除、跳过、`#[ignore]` 或 `#[allow]` 产品代码来让检查通过。
8. **新功能冻结**：重构期间只修 `D-*` 与做 `T-*`。新功能只写进 `agent-state/backlog.jsonl`，标 `needs: human`，人工批准前不得开工。命令语言改动单独版本化。
9. **状态落盘**：每轮结束更新 `agent-state/state.json` 与 `agent-state/HANDOFF.md`；提交信息带 `T-*` 和 `D-*`。
10. **卡住即停**：同一步失败 2 次，或连续 3 轮没有可测进展，或同一缺陷第 3 次回炉 → 停止并升级人工，不要换个说法重试。

## 2. 谁写哪里（防冲突）

| 角色 | 可写 | 只读 | 产物 |
|---|---|---|---|
| coordinator（主 agent/决策） | `agent-state/**`、`scripts/agent/**` | 全部 | `state.json`、`decisions/ADR-*.md`、board 决策 |
| auditor | `agent-state/audits/**` | 代码、规范 | `AUD-*.md` + 新缺陷登记 |
| implementer | `src/**`、`crates/**`、`.github/**`、测试 | 规范、审计、`scripts/agent/**` | 代码 + 测试 + 提交 |
| verifier | `agent-state/verify/**` | 代码、diff、命令输出 | `VER-*.md` + PASS/FAIL |

> `scripts/agent/**`（`acceptance.sh`、`audit_palette.py`）是门禁工具，**implementer 不得修改**；否则等于自己改考卷。需要改门禁时由 coordinator 单独提交并说明理由。

同一文件同一时刻只能有一个写者。并行实现必须用隔离工作区（swarm 的 `workspace:"branch"` 或 `"share"`）。

## 3. 命令

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
scripts/agent/acceptance.sh          # 一键门禁，当前基线应为 FAIL
scripts/agent/acceptance.sh --fast   # 跳过 clippy
scripts/agent/audit_palette.py        # 调色板 code/glyph/LaTeX 一致性
```

基线事实：`cargo test --workspace` = 133 passed；`clippy -D warnings` = 失败。任何"全绿"说法与这两条不符即为伪造。

## 4. 每轮开始前

1. 读规范 §0.1（顺序）、§2（不变量）、§4（缺陷）。
2. 读 `agent-state/state.json` 与 `agent-state/HANDOFF.md`。
3. 读最近一份 `AUD-*` 与 `VER-*`。
4. 只打开与本任务相关的源码文件，不要全仓扫读。

## 5. 完成定义

一个任务只有在以下全部成立时才算完成：

- [ ] 失败测试先存在，并已通过。
- [ ] `cargo fmt --check`、`clippy -D warnings`、`cargo test --workspace` 全过。
- [ ] 该任务相关的 `A-*` / `S-*` 验收项有命令或截图证据。
- [ ] 没有新增 `let _ =`、用户路径 `unwrap()`、第二份命令表。
- [ ] `state.json` 已更新，commit message 含 `T-*` 与 `D-*`。
- [ ] 独立 verifier 出具 PASS，且未修改代码。

## 6. 不要做的事

- 不要相信历史报告里的"零缺陷/全部通过"。
- 不要为了展示进度而批量重写 UI。
- 不要在未跑命令的情况下写"已验证"。
- 不要把审计结论复制粘贴给实现者；引用 board 序号或文件路径。
- 不要创建第三份项目副本；冻结体已有，工作区只有一个。

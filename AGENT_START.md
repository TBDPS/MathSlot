# 从这里开始（Antigravity / Gemini 3.8 Flash）

这个仓库已经为"自动重构"做好了脚手架，你只需要把下面的提示词粘给 Antigravity 的主 agent。它不会一轮就结束，也不会无限循环——停机由 Gate 退出条件和卡住信号决定。

## 一、先确认三件事

1. **模型与权限**：`~/.gemini/antigravity-cli/settings.json` 里是 `Gemini 3.8 Flash (High)`、`agentMode: accept-edits`、`permissions.allow` 含 `command(*)`。自动跑重构时建议：
   - 保留 `accept-edits`，但把实现者放到隔离工作区（swarm 的 `workspace:"branch"`）；
   - 把 `command(*)` 收窄为项目白名单，至少禁掉 `git push`、`rm -rf`、包管理器全局安装；
   - 若模型列表里有 Pro，用它跑 coordinator/auditor/verifier，Flash 跑 implementer。
2. **多 agent 能力**：CLI 自带 `native_swarm`（`~/.gemini/antigravity-cli/builtin/skills/native_swarm`），但本机没有 `skills.json`/`plugins.json`，也从未用过 `/swarm`。先在会话里试 `/swarm` 或让主 agent 加载 `swarm` skill。
   - 可用：按下面的"四角色"建队，一个 coordinator + auditor + implementer + verifier。
   - 不可用：退回串行，但审计/验收必须在独立轮次或独立会话完成，禁止同一轮自我签字。
3. **冻结已完成**：tag `freeze/pre-refactor-20261112`，只读副本 `/home/mat/Projects/mathslot-freeze-20261112`。不要再建第三份副本。

## 二、工程里已经准备好的东西

| 路径 | 作用 |
|---|---|
| `AGENTS.md` | 每次会话加载的硬规则（十条） |
| `docs/LLM_IMPLEMENTATION_SPEC.md` | 权威规范：INV/F/D/T/A/S、Gate DAG、DoD |
| `.agents/skills/refactor-loop/` | coordinator 的循环规程（派工模板、停机规则） |
| `.agents/skills/independent-audit/` | 审计角色规程（只读、证据格式、新缺陷 ID 段） |
| `.agents/skills/independent-verify/` | 验收角色规程（PASS 条件、禁止自我验收） |
| `agent-state/state.json` | 机器可读进度（Gate、轮次、开放缺陷、停机计数） |
| `agent-state/HANDOFF.md` | 压缩上下文后唯一能救场的交接单 |
| `agent-state/backlog.jsonl` | 新功能提案（必须人工批准） |
| `scripts/agent/acceptance.sh` | 一键门禁（当前基线为 FAIL） |
| `scripts/agent/audit_palette.py` | 复现 5 张调色板错码（P1 证据） |

## 三、复制这段给 Antigravity

```text
你在 /home/mat/Projects/mathslot-next（分支 refactor/v1）负责重构 MathSlot。
你不是实现者，你是协调者（coordinator）：决定做什么、派谁做、判定证据是否成立。

开工前按顺序读，不要跳读：
1. AGENTS.md
2. docs/LLM_IMPLEMENTATION_SPEC.md 的 §0.1、§2、§4、§10–§14
3. agent-state/state.json 与 agent-state/HANDOFF.md
4. 加载 .agents/skills/refactor-loop/SKILL.md，并按它执行

项目已经冻结：tag freeze/pre-refactor-20261112，只读副本在
/home/mat/Projects/mathslot-freeze-20261112。禁止修改冻结体和 /home/mat/Projects/mathslot。

任务来源只有一个：规范 §14 的 T-* 表。缺陷来源只有 §4 的 D-* 与审计新登记的 D-101+。
禁止自行发明任务，禁止把新功能混进重构，禁止新建第三份项目副本。

第一轮这样做（不要跳过审计直接写代码）：
A. 建队：coordinator(你) + auditor + implementer + verifier。
   若 /swarm 或 swarm 工具不可用，退化为串行，但审计与验收必须独立成轮、独立会话。
B. @auditor 复核 D-001..D-007 在 refactor/v1 的现状：只读，跑
   scripts/agent/audit_palette.py 和 scripts/agent/acceptance.sh --fast，
   产出 agent-state/audits/AUD-1.md，逐条给 OPEN/FIXED/NOT-REPRODUCIBLE。
C. 你根据 AUD-1 写 agent-state/decisions/ADR-0002.md，批准 T0.1（CI）或先修 D-001，只批一个。
D. @implementer 只做你批准的那一个 T-*，测试先行，一次提交，提交信息带 T-* 与 D-*。
E. @verifier 独立验收：不看实现者解释，跑 acceptance.sh 与相关测试，产出 VER-1.md。
F. 你更新 state.json 与 HANDOFF.md，然后决定下一轮。

停机不是"你觉得可以验收了"，而是：
- 当前 Gate 退出条件全绿 → 进下一 Gate；
- 同一步失败 2 次 / 连续 3 轮无可测进展 / 同一缺陷第 3 次回炉 → 停下写 HANDOFF 升级人工；
- G4 全绿后交人工做最终验收。

绝对禁止：
- 在没跑命令的情况下写"已验证/已通过/零缺陷"；
- 让 implementer 或你自己签署验收；
- 删除、跳过、#[ignore]、放宽测试或 #[allow] 产品代码来变绿；
- 用"UI 重构/换框架/体验优化"替代修 P1；
- 一次提交修多个 T-*；
- 修改 docs/LLM_IMPLEMENTATION_SPEC.md 来迁就实现。

现在开始，先只输出：
1) 当前 Gate 与选定的 T-*；
2) 依赖是否满足；
3) 本轮派工计划（谁做什么、写哪些路径、产出哪个文件）；
4) 你打算先跑哪条命令作为基线。
等我确认后再建队开工。
```

## 四、预期节奏

- 第 1 轮：审计 + T0.1（CI）。验收通过前不要碰产品代码。
- 第 2–3 轮：T0.2（clippy）与 T0.3（P1 失败回归测试）。
- G0 全绿后才允许 G1（catalog 单一事实源）。
- 每轮结束后看 `agent-state/HANDOFF.md` 三行即可，不需要读全部聊天。

## 五、你（人类）要做的三件事

1. 第一次开工时确认它选的 `T-*` 是否在 §14 里、依赖是否真的满足。
2. 每当它说"验收通过"，先看 `agent-state/verify/` 里有没有命令输出；没有就是没通过。
3. 新功能请求一律让它写进 `agent-state/backlog.jsonl`，标 `needs: human`，不要当场批准。

# agent-state 约定

这个目录是重构循环的**唯一持久状态**。上下文被压缩、会话重启、换模型之后，只靠它恢复进度。

| 文件 | 写者 | 说明 |
|---|---|---|
| `state.json` | coordinator | 机器可读：Gate、轮次、当前任务、开放缺陷、停机计数 |
| `HANDOFF.md` | coordinator | 人类可读：本轮做了什么、证据在哪、下一步 |
| `decisions/ADR-*.md` | coordinator | 每个 Gate/重要取舍一条，含被否掉的选项 |
| `decisions/OPEN-*.md` | coordinator | 规范未覆盖的问题，等人工确认 |
| `audits/AUD-*.md` | auditor | 只读审计，判定 OPEN/FIXED/NOT-REPRODUCIBLE |
| `verify/VER-*.md` | verifier | 独立验收，判定 PASS/FAIL，必须贴命令输出 |
| `reviews/REV-*.md` | supervisor（OpenCode） | 外部审查，APPROVE/REJECT/BLOCKED；不允许其他人写 |
| `OPENCODE_LINK.md` | coordinator | 与 OpenCode 联动的用法与边界 |
| `backlog.jsonl` | coordinator | 新功能提案，`needs: human`，未批准不得开工 |

## ID 规则

| 类型 | 规则 |
|---|---|
| 已有缺陷 | `D-001..D-030`（来自规范 §4，不要改号） |
| 新发现缺陷 | `D-101` 起，递增，不复用 |
| 任务 | `T0.1..T4.6`（来自规范 §14，不要自造） |
| 外部审查 | `REV-<short-sha>.md`（只由 supervisor 写） |
| 工具链接线 | 未登记进 §14 前只引用 `OPEN-0001`，不要用 `T-*` |
| 审计 | `AUD-<round>-<slug>.md` |
| 验收 | `VER-<round>.md` |
| 决策 | `ADR-<n>.md` |
| 待确认 | `OPEN-<n>.md` |
| 功能提案 | `B-<n>`（写在 backlog.jsonl） |

## 提交规则

- commit message 必须含本轮 `T-*` 与 `D-*`，例如：
  `fix(core): stable UUIDv7 for user formulas (T1.3, D-006)`
- 一个提交只对应一个 `T-*`。
- 审计/验收报告随对应提交一起进版本库，否则视为没有证据。

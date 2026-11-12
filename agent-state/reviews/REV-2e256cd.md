---
head: 2e256cd7ee852bf4a501310263a2c7932cd9ffcc
short: 2e256cd
verdict: REJECT
task: T0.0
defects: [D-101]
reviewer: opencode-supervisor
date: 2026-11-13
---

## 1. 结论

**REJECT**：本提交自造任务号 `T0.0`（规范 §14 只有 T0.1–T0.5，`agent-state/README.md:21` 明令“不要自造”），`state.json` / `HANDOFF.md` 未更新，且新写的门禁存在可让 coordinator 自我签字的漏洞（`check_review.py:51` 前缀匹配 + `agent-state/**` 在 coordinator 写域内），不能以 APPROVE 收口。

## 2. 我实际跑的命令

| 命令 | 退出码 | 输出尾部 |
|---|---|---|
| `git diff --stat HEAD~1..HEAD` | 0 | `9 files changed, 560 insertions(+)`；`-- src crates .github tests docs` 为空 |
| `cargo test --workspace` | 0 | 25 个 `test result: ok`；聚合 `passed=133 failed=0 ignored=0` |
| `scripts/agent/acceptance.sh --fast` | 1 | `PASS=2 FAIL=1 WARN=5` / `FAIL cargo fmt --check exit 1` / `结论：FAIL` |
| `python3 scripts/agent/check_review.py --head 2e256cd` | 1 | `缺少监督者审查：2e256cd` |
| `bash scripts/agent/supervise.sh --dry-run` | 0 | 正确组装 HEAD/diff/变更文件清单（未实调模型） |
| `echo '{}' \| bash scripts/agent/hook_stop.sh` | 0 | 输出 `{}`，写入 `agent-state/reviews/.pending=2e256cd` |

`cargo test` 的 133 passed 与规范 F-003 / `state.json:12` 基线一致；`fmt` 失败是既有基线（本提交未改 `src/`、`crates/`），不是本轮引入的回归。

## 3. 逐项核验

| 验收 ID / 规则 | 期望 | 实测 | 判定 |
|---|---|---|---|
| 任务号合法（§14） | `T-*` 能在 §14 查到 | §14 G0 仅 `T0.1..T0.5`（`docs/LLM_IMPLEMENTATION_SPEC.md:965-969`）；全仓无 `T0.0` | FAIL |
| 一轮一任务（AGENTS.md 规则 3） | 提交对应一个合法 `T-*` | message 写 `T0.0`；无对应 §14 行 | FAIL |
| T-* 验收项有命令证据（supervisor 规则） | 有可执行验收与证据 | `T0.0` 无验收定义；新脚本无测试，只做了手工 smoke | FAIL |
| 状态文件已更新（supervisor 规则） | `state.json` / `HANDOFF.md` 反映本轮 | `state.json:3` 仍 `2026-11-12`，`:19-21` `active_task:null`、`last_verdict:null`；`HANDOFF.md` 不在 diff | FAIL |
| 写域（AGENTS.md:29） | coordinator 只写 `agent-state/**`、`scripts/agent/**` | 新增 `.agents/hooks.json`、`.opencode/agents/supervisor.md`（表外路径） | FAIL |
| 不改规范 / 不删测试 / 不放宽 lint | 无 | 未改 `docs/LLM_IMPLEMENTATION_SPEC.md`；diff 中无 `#[ignore]`/`#[allow]`/删测试；`acceptance.sh` 只新增 `REQUIRE_REVIEW` 检查（收紧） | PASS |
| 无假绿 | 报告与命令一致 | `cargo test` 实跑 133 passed；`acceptance.sh --fast` 实跑 FAIL(fmt) | PASS（该两条） |
| 门禁不可自我签字 | 循环内 agent 不能自签 | `check_review.py:51` 双向前缀匹配；`REV-*.md` 位于 coordinator 可写的 `agent-state/**` | FAIL |

## 4. 越界与红旗

- **自造任务号**：`T0.0` 不在 §14；`agent-state/README.md:21` 明确“任务 `T0.1..T4.6`（来自规范 §14，不要自造）”。没有 `OPEN-*` 或人工批准记录。
- **写域越界**：`AGENTS.md:29` 的 coordinator 写域不含 `.agents/**`、`.opencode/**`；本提交新增两文件，且没有对应 `OPEN-*`/ADR 说明扩展理由。
- **门禁可被 self-sign（最严重）**：
  1. `scripts/agent/acceptance.sh:91-98` 仅看 `check_review.py` 退出码；
  2. `scripts/agent/check_review.py:51` 用 `head.startswith(rev_head) or rev_head.startswith(head)`，写一份 `REV-x.md` 只要 `head: 2` 就能匹配所有以 `2` 开头的 HEAD；
  3. coordinator 写域含 `agent-state/**`，即 coordinator 可亲手写 `agent-state/reviews/REV-*.md`；`check_review.py` 不校验 `reviewer`、不校验该文件是否由监督者会话产生 → 规则“循环里的 agent 不能给自己签字”在实现上仍可绕过。
  4. 该脚本没有任何测试；`acceptance.sh` 的 `REQUIRE_REVIEW` 也未被测试覆盖。
- **独立性风险**：`scripts/agent/supervise.sh:19` 硬编码 `DEFAULT_SESSION="ses_e3003..."`，`agent-state/OPENCODE_LINK.md:25` 把该会话描述为“本会话 / 标题：Mathslot 项目审查与重写方案”——即参与设计这套循环的同一会话来做审查；`:110`/`:113` 用 `--auto`。这削弱“外部监督者”的独立性。
- **Stop hook 路径未证**：`.agents/hooks.json:6` 用相对路径 `../scripts/agent/hook_stop.sh`。手工 `bash` 调用可用，但没有证据表明 Antigravity 的 hook cwd 是 `.agents/`（若为仓库根，则解析到仓库外，hook 失效）。
- 未出现 `continue-on-error`、CI 里的 `|| true`/`set +e`；`scripts/agent/**` 的改动是 coordinator 职责（`AGENTS.md:34`），但按该条应“单独提交并说明理由”，本提交把门禁改动与工具新增混在一起。

## 5. 必须修复（REJECT 时）

1. **任务号**：`docs/LLM_IMPLEMENTATION_SPEC.md:965-969` 无 `T0.0`；`agent-state/README.md:21` 禁止自造。最小修复：写 `agent-state/decisions/OPEN-*.md` 请人工决定“是否把监督者接线登记进 §14（如 T0.6）”，获批前不要以任何 `T-*` 名义收口；不得静默改提交信息重贴到 `T0.1`（`T0.1` 是 CI）。
2. **状态文件**：`agent-state/state.json:3,19-21` 与 `agent-state/HANDOFF.md` 未更新，违反 `AGENTS.md` 规则 9 与 supervisor 的 APPROVE 条件。修复：在评审前更新 `updated`、`active_task`、`last_verdict`、`HANDOFF.md`，并在 `HANDOFF.md` 写明本轮的 “做了什么/证据在哪/下一步”。
3. **门禁自签漏洞**：`scripts/agent/check_review.py:51` 改精确匹配（full 40 位 sha 相等，或至少等长前缀且长度 ≥ 12），并校验 front matter `reviewer: opencode-supervisor` 与 `verdict` 只取 front matter；`agent-state/reviews/**` 从 coordinator 写域移除（`AGENTS.md:29` / `agent-state/README.md`）；补 3 个 fixture 测试：精确匹配、短 sha 伪造、REJECT 不通过。
4. **独立性**：删除 `scripts/agent/supervise.sh:19` 的硬编码会话，默认只走 `--archived` 新会话；审查者不用 `--auto`（或至少 `--auto` 仅限只读工具白名单）。`--continue-session` 应显式要求调用者传入会话。
5. **Hook 路径**：`.agents/hooks.json:6` 改为绝对路径或 `bash "$ROOT/scripts/agent/hook_stop.sh"` 形式，并用一次真实 Stop 事件实跑验证（贴 `agent-state/turns.jsonl` 行与 `.pending` 结果）；若 Antigravity cwd 语义不是 `.agents/`，当前配置会静默失效。

## 6. 未验证

- Antigravity 的 Stop hook 未被真实事件触发；payload 字段名（`conversationId` / `terminationReason` / `lastUserInput` / `cwd`）未验证。
- `opencode run --agent supervisor ...` 未实调（无模型调用），因此 `supervise.sh` → `REV-*.md` → `check_review.py` 的端到端闭环未验证。
- 没有 GitHub Actions 实跑（本提交未 push，也未改 `.github/**`）。
- `cargo clippy -D warnings` 未跑（`--fast` 跳过；`state.json:13` 基线为 FAIL）。

verdict: REJECT
head: 2e256cd7ee852bf4a501310263a2c7932cd9ffcc

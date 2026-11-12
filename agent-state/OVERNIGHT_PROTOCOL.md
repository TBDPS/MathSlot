# 夜间无人值守协议（睡前 10 分钟）

目标：你睡觉时，Antigravity 在**有界**的自动续跑下推进 G0–G4；你醒来先看证据，不看它的总结。

## 0. 原理

Antigravity 的 Stop hook 已改成"夜间模式"：

- `agent-state/AUTORUN` 存在时，每轮结束返回 `{"decision":"continue"}`，agent 继续下一轮；
- 最多 30 次（`AUTORUN_MAX` 可调），防止无限烧配额；
- 连续 2 次进度哈希不变 → 写 `STOPPED`，停止；
- 配额错误、用户取消、token 预算耗尽 → 写 `STOPPED`，停止；
- G4 完成 → agent 写 `DONE`，停止；
- 每次续跑会注入一句"先跑 resume.sh"，用于对抗上下文压缩。

它不是无限自动驾驶，是一个**带里程表的夜班司机**。

---

## 1. 睡前步骤

### 1.1 关掉旧会话

同一个仓库只保留一个 agent 会话，避免两个进程同时改文件。

### 1.2 确认基线

```bash
cd /home/mat/Projects/mathslot-next
git status --short          # 应为空
scripts/agent/resume.sh     # 应显示 gate=G0 next=T0.1
```

如果有未提交改动，先决定：要么提交，要么 `git stash`。不要让夜间模式从脏工作区开始。

### 1.3 清掉上次的测试/控制文件

```bash
rm -f agent-state/AUTORUN agent-state/DONE agent-state/STOPPED
rm -f agent-state/.autorun-count agent-state/.autorun-hash agent-state/.autorun-stall
```

### 1.4 开启夜间模式并自测 hook

```bash
touch agent-state/AUTORUN

printf '%s' '{"terminationReason":"NO_TOOL_CALL","continuationActive":false,"fullyIdle":true}' \
  | scripts/agent/hook_stop.sh
# 期望输出：{"decision": "continue", "reason": "AUTORUN 1/30：..."}

# 自测产生的计数清掉，避免占用夜间额度
rm -f agent-state/.autorun-count agent-state/.autorun-hash agent-state/.autorun-stall agent-state/turns.jsonl
```

如果输出是 `{}`，不要睡：检查 `agent-state/AUTORUN` 是否存在、脚本是否有执行权限。

### 1.5 新开对话

在**仓库根目录**启动：

```bash
cd /home/mat/Projects/mathslot-next
agy
```

然后粘贴第 2 节的完整提示词。

---

## 2. 夜间完整提示词（复制粘贴）

```text
你在 /home/mat/Projects/mathslot-next（分支 refactor/v1）担任 MathSlot 重构的 coordinator。
现在是夜间无人值守运行：本提示词即授权，连续执行，不要等待确认。

【0 启动/恢复】
先运行 scripts/agent/resume.sh。
确认 agent-state/AUTORUN 存在；如果不存在，写 agent-state/STOPPED（原因：AUTORUN 未开启）并停止。
如果 agent-state/DONE 或 STOPPED 已存在，先读它和 OVERNIGHT_REPORT.md，等人工处理，不要自行继续。
然后按顺序读：
1) AGENTS.md
2) agent-state/RESUME.md
3) agent-state/state.json、agent-state/HANDOFF.md
4) docs/LLM_IMPLEMENTATION_SPEC.md §2、§4、§14
5) 最近一份 agent-state/audits/AUD-*.md、agent-state/verify/VER-*.md
以文件为准，不要凭记忆。

【1 运行模式（用户已定，不得更改）】
- 串行；不建 swarm；不调用 /swarm。
- 外部审查 final-only：不运行 scripts/agent/supervise.sh，不启动 watch.sh。
- 一次只做一个 T-*；一个提交只对应一个 T-*。
- 不 push；不改 /home/mat/Projects/mathslot 与冻结副本；不改规范；不改 scripts/agent/**。
- invoke_subagent 可用时，只用于 auditor / verifier 的独立上下文，一次一个；
  不可用时分轮，但 AUD / VER 必须由对应角色写，coordinator 不得代写或自签。

【2 角色与写域】
- coordinator：agent-state/**（不含 reviews），决策与状态。
- auditor：agent-state/audits/**；只读代码；产出 AUD-<round>.md。
- implementer：src/**、crates/**、.github/**、tests/**。
- verifier：agent-state/verify/**；只读代码与 diff；产出 VER-<round>.md。
同一文件同一时刻只有一个写者。

【3 一轮流程 A→D→I→V】
A 审计：auditor 复核本轮范围，逐条给 文件:行号、命令、退出码、输出尾部、
  OPEN/FIXED/NOT-REPRODUCIBLE。产出 AUD-<round>.md。
D 决策：coordinator 只批准一个 T-*，写 ADR-<n>.md（范围、允许路径、验收项、风险）。
  新功能只进 backlog.jsonl，标 needs: human。
I 实现：implementer 先写失败测试，再一次提交；commit message 含 T-* 与 D-*；
  禁止顺手重构。
V 验收：verifier 独立跑命令，不看实现者解释；产出 VER-<round>.md，
  给 PASS/FAIL 与未验证项。
收尾：coordinator 更新 state.json（round+1、active_task、last_verdict、
  no_progress_rounds）与 HANDOFF.md 三行。

【4 授权范围：G0–G4】
本次授权规范 §14 的全部任务，按 Gate 顺序执行，不得跳 Gate，不得自造 T-*。
每个 Gate 收口必须：
- 运行 scripts/agent/acceptance.sh（完整，不加 --fast）；
- 把输出保存到 agent-state/verify/GATE-<gate>.md；
- 不通过就停在当前 Gate，写 STOPPED，不要进入下一 Gate。

【5 第一轮：T0.1】
目标：只新增 .github/workflows/ci.yml。
前置：AUD-1 必须存在，并覆盖 D-001..D-007、D-101、cargo fmt --check 失败；
每条给命令、退出码、输出尾部。AUD-1 不合格不得进入实现。
CI 约束：
- 触发 push + pull_request；ubuntu-latest 起步（三平台矩阵后置，写入 ADR-0004）
- 复用 release.yml 的 Linux 依赖（libasound2-dev、libudev-dev、libwayland-dev、
  libxkbcommon-dev、libx11-dev、libx11-xcb-dev）
- Rust stable；WASM job 加 wasm32-unknown-unknown；Node 22
- 步骤：cargo fmt --check、cargo clippy --workspace --all-targets -- -D warnings、
  cargo test --workspace、cargo build -p mathslot-wasm --target
  wasm32-unknown-unknown --release、node obsidian-mathslot/scripts/build.mjs
- 不新增 wasm-opt/binaryen；不跑 npm test/e2e（仓库没有）
- 禁止 continue-on-error、|| true、set +e、#[allow] 换绿
- G0 期间允许红；在 ci.yml 注释与 ADR-0004 写明“绿属于 G0 退出，不属于 T0.1”
- permissions: contents: read
- 本轮 diff 只允许 .github/workflows/ci.yml 与 agent-state/**；
  禁止 src/**、crates/**、scripts/agent/**、docs/**
VER-1 必须包含：YAML 可解析、本地逐步执行等价、禁止项扫描、diff 范围与 commit 信息、
“未在 GitHub 实跑”的未验证项。

【6 证据标准】
- 结论必须带 文件:行号 或 命令 + 退出码 + 输出尾部。
- 禁止“已通过/零缺陷/生产级/完美达标”。
- 禁止用历史 docs/ACCEPTANCE_* 的结论替代实测。
- 发现规范缺失/矛盾：写 agent-state/decisions/OPEN-*.md 并停下。

【7 夜间停止条件】
满足任一条件就停止，不要继续烧配额：
1) G4 完成：写 agent-state/DONE，并写 agent-state/OVERNIGHT_REPORT.md，然后停止。
2) 配额/权限/构建/网络错误无法自行解决：写 agent-state/STOPPED（含原因与最后命令），停止。
3) 同一步失败 2 次，或连续 3 轮无可测进展，或同一缺陷第 3 次回炉：写 STOPPED，停止。
4) 需要人工决策（OPEN-*）：写 STOPPED，停止。
禁止为了继续而删测试、跳过测试、放宽 lint、绕过 acceptance。

【8 夜间报告】
无论 DONE 还是 STOPPED，都写 agent-state/OVERNIGHT_REPORT.md，包含：
- 到达的 Gate、已完成/未完成的 T-*
- 每个 Gate 的 acceptance 输出路径
- 未关闭的 D-*（尤其 P1）与已知风险
- 明早第一步命令（要能直接复制执行）

【9 输出格式】
每轮只输出一行状态：`G0 T0.1 AUD-1 done` 这种。
不要长篇汇报；细节写进文件。不要等待确认，继续下一轮。
```

---

## 3. 醒来后的步骤

### 3.1 先关夜间模式

```bash
cd /home/mat/Projects/mathslot-next
rm -f agent-state/AUTORUN
```

如果看完报告后要继续跑，再删掉停止标记，否则 hook 不会续跑：

```bash
rm -f agent-state/STOPPED agent-state/DONE agent-state/.autorun-*
```

### 3.2 看它是怎么停的

```bash
cat agent-state/DONE 2>/dev/null && echo "== DONE =="
cat agent-state/STOPPED 2>/dev/null && echo "== STOPPED =="
sed -n '1,160p' agent-state/OVERNIGHT_REPORT.md
```

### 3.3 不要信摘要，跑三条命令

```bash
git log --oneline --since="10 hours ago"
scripts/agent/acceptance.sh
python3 scripts/agent/check_review.py --head "$(git rev-parse --short HEAD)"
```

### 3.4 如果它说 G4 完成

```bash
scripts/agent/supervise.sh --final   # 配额允许时，项目完成后的那一次外部审查
```

审查通过前，不要对外说"重构完成"。

---

## 4. 已知边界

- 自动续跑最多 30 次；复杂项目可能跑不完，会在 `STOPPED` 里说明停在哪。
- 配额耗尽时，Antigravity 可能直接退出，hook 来不及写 `STOPPED`；看 `turns.jsonl` 最后一行和时间。
- 上下文压缩后，agent 可能忘记规则；hook 每次续跑都会提醒 `resume.sh`，但不保证 100%。
- `AUTORUN` 是运行时文件，不进版本库；忘记删会导致你白天发消息时它继续自动续跑。

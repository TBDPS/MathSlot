# 从这里开始（Antigravity / Gemini 3.8 Flash）

> 本文件是流程的唯一入口。提示词会因上下文压缩失效，**文件和状态不会**。
> 每个用户回合，尤其是压缩后的第一回合，先运行 `scripts/agent/resume.sh`，再按它列出的顺序读文件。

---

## 0. 每轮第一条命令

```bash
cd /home/mat/Projects/mathslot-next
scripts/agent/resume.sh
```

然后按顺序读：

1. `AGENTS.md`
2. `agent-state/RESUME.md`
3. `agent-state/state.json` 与 `agent-state/HANDOFF.md`
4. `docs/LLM_IMPLEMENTATION_SPEC.md` 的 §2、§4、§14
5. 最近一份 `agent-state/audits/AUD-*.md` 与 `agent-state/verify/VER-*.md`

不要凭记忆继续。五者矛盾时，写 `agent-state/decisions/OPEN-*.md` 并停下。

---

## 1. 运行模式（用户已定，不得自行更改）

| 项 | 决定 |
|---|---|
| 并行 | **串行**；不建 swarm；不调用 `/swarm` |
| 外部审查 | **final-only**；项目完成前不运行 `scripts/agent/supervise.sh`，不启动 `watch.sh` |
| 任务粒度 | 一次一个 `T-*`；一个提交只对应一个 `T-*` |
| 推送 | 不 `git push` |
| 冻结 | `/home/mat/Projects/mathslot` 与 `/home/mat/Projects/mathslot-freeze-20261112` 只读 |
| 规范 | `docs/LLM_IMPLEMENTATION_SPEC.md` 只读；要改先写 `OPEN-*` |
| 门禁脚本 | `scripts/agent/**` 只读；implementer 不得修改 |

原因：这是用户明确要求，避免 OpenCode 配额消耗与并行写冲突。

---

## 2. 角色与写域

| 角色 | 写 | 产物 |
|---|---|---|
| coordinator | `agent-state/**`（不含 `reviews/**`） | `state.json`、`HANDOFF.md`、`ADR-*.md` |
| auditor | `agent-state/audits/**` | `AUD-<round>.md` |
| implementer | `src/**`、`crates/**`、`.github/**`、测试 | 代码、测试、提交 |
| verifier | `agent-state/verify/**` | `VER-<round>.md` |

- `invoke_subagent` 可用时，给 auditor / verifier 独立上下文；不可用时按角色分轮。
- **coordinator 不得代写 AUD/VER，也不得给自己签 PASS。**
- 审计/验收只看代码、diff、命令输出；不看实现者的解释，不引用历史 `docs/ACCEPTANCE_*` 的结论当证据。

---

## 3. 一轮标准流程（A → D → I → V）

### A. 审计（auditor，只读）

- 复核本轮范围：`D-*` 是否仍存在、复现命令、`文件:行号`。
- 逐条给 `OPEN` / `FIXED` / `NOT-REPRODUCIBLE`。
- 抽查至少两条历史“已修复/已通过”的说法。
- 新缺陷用 `D-101` 起编号。
- 产出 `agent-state/audits/AUD-<round>.md`，含命令、退出码、输出尾部。

### D. 决策（coordinator）

- 只批准一个 `T-*`，且必须能在 §14 查到。
- 写 `agent-state/decisions/ADR-<n>.md`：范围、允许路径、验收项、风险、回滚。
- 新功能只写 `agent-state/backlog.jsonl`，标 `needs: human`；不得开工。

### I. 实现（implementer）

- 先写会失败的测试，再改实现，再让测试通过。
- 一次提交，message 含 `T-*` 与 `D-*`，不要方括号。
- 不顺手重构；不跨任务；不改门禁脚本与规范。

### V. 验收（verifier，只读）

- 自己跑命令，不采信实现者自述。
- 产出 `agent-state/verify/VER-<round>.md`：PASS/FAIL、逐项 `A-*`/`S-*`、未验证项、最小复现。
- 发现测试被删除/跳过/弱化，直接 FAIL。

### 收尾（coordinator）

- 更新 `state.json`：`round + 1`、`active_task`、`last_verdict`、`no_progress_rounds`。
- 更新 `HANDOFF.md` 三行：做了什么、证据在哪、下一步。
- 只有 `VER-*` 为 PASS 才批准下一轮。

---

## 4. 第一轮：T0.1（精确 Brief）

**目标**：只新增 `.github/workflows/ci.yml`。

**前置**：`AUD-1` 必须已存在，并覆盖：

- `D-001..D-007` 的现状（OPEN / FIXED / NOT-REPRODUCIBLE）；
- `D-101`（源码字符串冒充验收）；
- `cargo fmt --check` 失败。

每条必须有：`文件:行号`、命令、退出码、输出尾部。`AUD-1` 不合格不得进入实现。

**CI 约束**：

- 触发：`push` + `pull_request`。
- `ubuntu-latest` 起步；三平台矩阵后置，记录在 `ADR-0004`，不阻塞 T0.1。
- 复用 `release.yml` 的 Linux 依赖：`libasound2-dev`、`libudev-dev`、`libwayland-dev`、`libxkbcommon-dev`、`libx11-dev`、`libx11-xcb-dev`。
- Rust stable；WASM job 加 `wasm32-unknown-unknown`；Node 22。
- 步骤：
  - `cargo fmt --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo test --workspace`
  - `cargo build -p mathslot-wasm --target wasm32-unknown-unknown --release`
  - `node obsidian-mathslot/scripts/build.mjs`
- 不新增 `wasm-opt`/binaryen；不跑 `npm test`/`npm run e2e`（仓库没有）。
- 禁止 `continue-on-error`、`|| true`、`set +e`、为过 lint 加 `#[allow]`。
- `permissions: contents: read`。
- G0 期间允许红；在 `ci.yml` 注释与 `ADR-0004` 写明“绿属于 G0 退出，不属于 T0.1”。
- 本轮 diff 只允许 `.github/workflows/ci.yml` 与 `agent-state/**`；禁止 `src/**`、`crates/**`、`scripts/agent/**`、`docs/**`。

**VER-1 必须包含**：

- YAML 可解析：`python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"`；
- 本地逐步执行等价（fmt / clippy / test / wasm / plugin）；
- 禁止项扫描结果；
- diff 范围与 commit 信息；
- “未在 GitHub 实跑”写进未验证项。

---

## 5. Gate 与停机

- Gate 表只以规范 §14 为准；**不要自造 `T-*`**。
- 同一步失败 2 次，或连续 3 轮无可测进展，或同一缺陷第 3 次回炉 → 停下，写 `HANDOFF.md`，升级人工。
- 每个 Gate 收口跑 `scripts/agent/acceptance.sh`（不调用模型）；**不要**用 `REQUIRE_REVIEW=1`。
- 除 Gate 收口与停机外，不要向用户要确认；中间轮次只报一行状态。

---

## 6. 证据标准

- 结论必须带 `文件:行号` 或命令 + 退出码 + 输出尾部。
- 禁止“已通过 / 零缺陷 / 生产级 / 完美达标”。
- 禁止用历史 `docs/ACCEPTANCE_*` 的结论替代实测。
- 发现规范缺失或矛盾：写 `OPEN-*` 并停下，不要猜。
- 新功能：只进 `backlog.jsonl`，标 `needs: human`。

---

## 7. 完整提示词（复制粘贴给 Antigravity）

```text
你在 /home/mat/Projects/mathslot-next（分支 refactor/v1）担任 MathSlot 重构的 coordinator。
本提示词即授权：不要再等确认，按流程连续执行，直到本轮 VER-1 产出或触发停机规则。

【0 每轮开始，含上下文压缩后】
先运行：scripts/agent/resume.sh
再按顺序读：
1) AGENTS.md
2) agent-state/RESUME.md
3) agent-state/state.json、agent-state/HANDOFF.md
4) docs/LLM_IMPLEMENTATION_SPEC.md §2、§4、§14
5) 最近一份 agent-state/audits/AUD-*.md、agent-state/verify/VER-*.md
以文件为准，不要凭记忆。

【1 运行模式（用户已定，不得更改）】
- 串行；不建 swarm；不调用 /swarm。
- 外部审查 final-only：项目完成前不运行 scripts/agent/supervise.sh，不启动 watch.sh。
- 一次只做一个 T-*；一个提交只对应一个 T-*。
- 不 push；不改 /home/mat/Projects/mathslot 与冻结副本；不改规范；不改 scripts/agent/**。
- invoke_subagent 可用时，用它给 auditor / verifier 独立上下文；不可用时分轮，
  但 AUD / VER 必须由对应角色写，coordinator 不得代写或自签。

【2 角色与写域】
- coordinator：agent-state/**（不含 reviews），决策与状态。
- auditor：agent-state/audits/**；只读代码；产出 AUD-<round>.md。
- implementer：src/**、crates/**、.github/**、tests/**；本轮 T0.1 只允许 .github/workflows/ci.yml。
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

【4 第一轮：T0.1】
目标：只新增 .github/workflows/ci.yml。
前置：AUD-1 必须存在，并覆盖：
- D-001..D-007 的现状（OPEN/FIXED/NOT-REPRODUCIBLE）
- D-101（源码字符串冒充验收）
- cargo fmt --check 失败
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
VER-1 必须包含：
- YAML 可解析（python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"）
- 本地逐步执行等价（fmt/clippy/test/wasm/plugin）
- 禁止项扫描结果（continue-on-error/|| true/set +e/allow）
- diff 范围与 commit 信息
- “未在 GitHub 实跑”写入未验证项

【5 Gate 与停机】
Gate 表以规范 §14 为准；不要自造 T-*。
同一步失败 2 次，或连续 3 轮无可测进展，或同一缺陷第 3 次回炉 → 停下，
写 HANDOFF.md 并升级人工。
每个 Gate 收口跑 scripts/agent/acceptance.sh（不调用模型）；不要用 REQUIRE_REVIEW=1。
除 Gate 收口与停机外，不要向用户要确认；中间轮次只报一行状态。

【6 证据标准】
- 结论必须带 文件:行号 或 命令 + 退出码 + 输出尾部。
- 禁止“已通过/零缺陷/生产级/完美达标”。
- 禁止用历史 docs/ACCEPTANCE_* 的结论替代实测。
- 发现规范缺失/矛盾：写 agent-state/decisions/OPEN-*.md 并停下。

【7 输出格式】
每轮第一条消息只输出：
1) Gate 与 T-*
2) depends_on 是否满足（引用 §14 行号与原文）
3) 本轮允许写路径与产物文件
4) 第一条命令
然后直接执行，不要等待确认。
如果 T0.1 需要改 src/crates 才能过 CI，停止并写 OPEN，不要扩范围。
```

---

## 8. 人工检查点

1. 第一份产出必须是 `AUD-1`，不是 `ci.yml`。
2. `AUD-1` 里必须能看见调色板 5 条不一致、`D-101`、`fmt` 失败，且各带命令与退出码。
3. `VER-1` 必须写明“GitHub 未实跑”，且 `state.json` 的 `round` 已从 0 变为 1。

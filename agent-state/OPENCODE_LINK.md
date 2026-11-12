# 与 OpenCode 联动：外部监督者

> **当前策略：final-only。** 按用户要求，重构期间不逐轮审查、不启动 watcher（避免配额消耗）。项目完成后再执行：
> `scripts/agent/supervise.sh --final`（diff 起点=冻结 tag，跑完整门禁，按规范 §16.2 核对）。
> 期间的本地门禁仍用 `scripts/agent/acceptance.sh`，它不调用模型。

目标：让重构循环里有一个**它自己不能签字**的审查者。Antigravity 负责决策/实现/验收，OpenCode 负责外部复核；两边通过 `agent-state/` 传递状态。

## 先说实话：我无法"自己一直盯着"

OpenCode 是回合制的：没有消息就不会运行。所谓"随时监督"必须有一个触发源。这里提供三种，按需选：

| 方式 | 触发 | 适合 |
|---|---|---|
| A 手动继续本对话 | 你执行一条命令 | 想让我看细节、参与判断 |
| B 独立归档会话 | 你或脚本执行 `supervise.sh` | 每轮结束后例行审查 |
| C 轮询 watcher | 后台进程每 N 秒检查 HEAD | 无人值守的长跑 |

Antigravity 的 `Stop` hook 已经配置好：每轮结束会写 `agent-state/turns.jsonl`，并在没有 APPROVE 审查时写 `agent-state/reviews/.pending`。它**不调用模型**，所以不会拖慢或卡住 Antigravity。

---

## A. 和本对话联动（手动）

先说清一个限制：本对话是在 `/home/mat` 启动的，session 属于 `/home/mat` 这个项目；在仓库里执行 `opencode session list` 看不到它。所以"从仓库里一条命令继续这条对话"并不可靠，也不是推荐路径。

实际可用的两种做法：

1. **想和我讨论**：直接在 OpenCode TUI 里说。我读的是同一套 `agent-state/` 与 `REV-*.md`，不需要把对话搬来搬去。
2. **想要一个固定的"监督者会话"**（可选）：
   ```bash
   cd /home/mat/Projects/mathslot-next
   opencode                     # 在仓库根启动一个新会话
   # 发一条消息，把标题设为 "MathSlot supervisor"
   opencode session list | grep -i supervisor   # 取 session id
   scripts/agent/supervise.sh --session <id>
   ```
   注意：`--session` 模式**不做 worktree 隔离**，适合你盯着看的时候用；日常自动审查请用 B。

## B. 独立归档会话（推荐）

```bash
scripts/agent/supervise.sh            # 审查 HEAD 与上次审查之间的 diff
scripts/agent/supervise.sh --force    # 同一 HEAD 重审
scripts/agent/supervise.sh --dry-run  # 只看提示词
scripts/agent/supervise.sh --since <sha>
scripts/agent/supervise.sh --clean-worktree  # 审查后删除复用的 worktree
```

默认行为（ADR-0003）：

- 复用固定 worktree `$TMPDIR/mathslot-review-wt`，每次 `checkout --detach` 到目标 HEAD；
- 即使它执行写操作，也改不到真实仓库；
- worktree 有自己的 `target/`，**不与主仓库共享**（共享会把测试二进制里的 `CARGO_MANIFEST_DIR` 指到 worktree，回到主仓库后误报文件不存在）；
- 首次审查需要全量编译（Rust workspace，可能几分钟），之后增量；
- 只把 `REV-<sha>.md` 复制回 `agent-state/reviews/`。

产物：

```
agent-state/reviews/REV-<short-sha>.md     # 进版本库；只能由 supervisor 写
agent-state/reviews/.last                  # 上次审查的 HEAD（忽略）
agent-state/reviews/index.tsv              # 审查台账（忽略）
```

退出码：`0` 完成且 APPROVE；`2` 已有审查跳过；`3` opencode 不可用；`4` 未产出 REV；`5` worktree 失败；`6` 完成但不是 APPROVE。

## C. 无人值守轮询

```bash
# 前台调试
scripts/agent/watch.sh --interval 60 --once

# 后台常驻（建议间隔 >= 300 秒）
nohup scripts/agent/watch.sh --interval 600 >/tmp/mathslot-watch.log 2>&1 &
```

逻辑：HEAD 变了且没有 APPROVE 审查 → 调 `supervise.sh`；已有就跳过。`flock` 防止重复启动。

如果更喜欢 systemd：

```ini
# ~/.config/systemd/user/mathslot-review.service
[Service]
Type=oneshot
WorkingDirectory=/home/mat/Projects/mathslot-next
ExecStart=/home/mat/Projects/mathslot-next/scripts/agent/watch.sh --once
```

```ini
# ~/.config/systemd/user/mathslot-review.timer
[Timer]
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
```

（`systemctl --user enable --now mathslot-review.timer`；我没替你安装。）

---

## 门禁联动（关键）

审查不是"仅供参考"。在 Gate 收口时强制要求 APPROVE：

```bash
REQUIRE_REVIEW=1 scripts/agent/acceptance.sh
```

`acceptance.sh` 会读取 `agent-state/reviews/REV-<HEAD>.md`，要求：

- `head:` 与当前 `git rev-parse --short HEAD` 匹配；
- `verdict: APPROVE`。

否则该项 FAIL，Gate 不得推进。这样即使 coordinator 想自我签字，也会被门禁挡住。

建议把 G0 的退出命令写成：

```bash
REQUIRE_REVIEW=1 scripts/agent/acceptance.sh
```

---

## 审查范围

`supervise.sh` 会自动组装：

- `since..HEAD` 的 diff 与文件清单；
- Gate / round / 提交信息；
- 最新 `AUD-*.md`、`VER-*.md`；
- 要求监督者自己跑 `cargo test --workspace` 与 `acceptance.sh --fast`。

监督者只允许写一个 `REV-*.md`，不改代码、不改规范、不改门禁脚本；`agent-state/reviews/**` 是它的独占写域。

---

## 成本与坑

| 坑 | 处理 |
|---|---|
| 每次审查是一次完整模型调用 | 间隔 ≥ 300s；只在 HEAD 变化时触发 |
| 实现者在隔离分支里提交，`refactor/v1` 的 HEAD 不变 | 先 merge/cherry-pick 到 `refactor/v1`，再触发审查 |
| 审查者可能"看代码就下结论" | prompt 强制它跑命令；`REV` 必须贴退出码与输出尾部 |
| 会话上下文膨胀 | 日常用方式 B（归档会话），需要深聊时用方式 A |
| 审查者也可能误判 | 你是最终裁决；REJECT 先看它给的最小复现 |
| 并发 | `watch.sh` 用 `flock`；`supervise.sh` 同一 HEAD 默认跳过 |

---

## 故障排查

```bash
opencode debug agents | grep supervisor          # 应能看到 supervisor
scripts/agent/supervise.sh --dry-run             # 检查提示词与 diff 范围
python3 scripts/agent/check_review.py --head $(git rev-parse --short HEAD)
opencode session list | head                     # 会话 ID 变了就更新 supervise.sh 里的 DEFAULT_SESSION
```

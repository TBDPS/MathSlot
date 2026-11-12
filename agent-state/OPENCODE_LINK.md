# 与 OpenCode 联动：外部监督者

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

## A. 接着本对话（我在这里）

先取会话 ID（会话标题变了也能找到）：

```bash
opencode session list | head -5
```

然后：

```bash
cd /home/mat/Projects/mathslot-next
scripts/agent/supervise.sh --session <会话ID>
```

等价的底层命令：

```bash
opencode run -s <会话ID> --agent supervisor \
  -m volcengine-plan/deepseek-v4.1-flash-economy \
  --auto "审查当前 HEAD，按 .opencode/agents/supervisor.md 输出 REV"
```

注意：这一模式**不做 worktree 隔离**（会话与真实工作区绑定），只适合你主动想看细节时用。日常与自动触发请用方式 B。

## B. 独立归档会话（推荐）

```bash
scripts/agent/supervise.sh            # 审查 HEAD 与上次审查之间的 diff
scripts/agent/supervise.sh --force    # 同一 HEAD 重审
scripts/agent/supervise.sh --dry-run  # 只看提示词
scripts/agent/supervise.sh --since <sha>
scripts/agent/supervise.sh --keep-worktree   # 调试：保留临时 worktree
```

默认行为（ADR-0003）：

- 用 `git worktree add --detach <tmp> HEAD` 建临时工作区，监督者在里面审查、跑测试；
- 即使它执行写操作，也改不到真实仓库；
- `CARGO_TARGET_DIR` 指向主仓库 `target/`，避免全量重编；
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

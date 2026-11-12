# ADR-0003：外部监督者的隔离、签名与 ID 规则

- 日期：2026-11-13
- 状态：已生效
- 决策者：coordinator（依据 `REV-2e256cd` 的 REJECT）
- 关联：`OPEN-0001`、`D-101`

## 背景

`REV-2e256cd` 对外部监督者接线本身给出 REJECT，四条有效发现：

1. 提交信息使用 `T0.0`，而 §14 只有 `T0.1..T0.5`，属于自造任务号；
2. `state.json` / `HANDOFF.md` 未更新；
3. 门禁可被自我签字：`check_review.py` 用双向前缀匹配（`head: 2` 可匹配所有 `2*`），且 REV 文件位于 coordinator 可写目录，未校验 reviewer；
4. `supervise.sh` 硬编码了参与设计的会话，且 `--auto` 在真实工作区里运行，独立性不足。

第 3、4 条是设计缺陷，不是措辞问题。以下为修正。

## 决策

### 1. ID 规则

- 工具链改动在 `OPEN-0001` 获人工批准前，**不使用任何 `T-*`**，提交只引用 `OPEN-0001` 与 `D-101`。
- 历史提交里的 `T0.0` 不重写（改写历史会破坏证据链），由本 ADR 记录为已知偏差。
- 若人工批准选项 A，则新增 `T0.6`，其验收包含本 ADR 的第 2–5 条。

### 2. 审查匹配（防伪造）

`check_review.py` 改为：

- 只读 `---` 之间的 front matter；正文里的 `verdict:` 不算；
- `head` 必须 40 位全等，或等长前缀且长度 ≥ 12；`head: 2` 一律不匹配；
- `reviewer` 必须是 `opencode-supervisor`；
- 新增 6 个回归测试（精确、短 sha 伪造、REJECT、不可信 reviewer、正文伪造、12 位前缀）。

### 3. 审查隔离

`supervise.sh` 默认：

- 固定复用 `$TMPDIR/mathslot-review-wt`（`git worktree`，detached HEAD），每次审查前 `checkout/reset` 到目标 HEAD；
- 即使它执行写操作，也改不到真实工作区；
- **worktree 使用自己的 `target/`，禁止与主仓库共享 `CARGO_TARGET_DIR`**；
- 只有 `REV-*.md` 会被复制回 `agent-state/reviews/`；
- 退出码区分"完成且 APPROVE（0）"与"完成但非 APPROVE（6）"。

### 3.1 修正记录（2026-11-13）

第一版为了省编译时间，把 `CARGO_TARGET_DIR` 指向主仓库 `target/`。结果：

- 监督者在 worktree 里编译的测试二进制，把 `CARGO_MANIFEST_DIR` 固化成了 worktree 路径；
- worktree 删除后，主仓库复用了这些二进制，测试报 `Read app.rs: NotFound`；
- 主仓库的 `cargo test --workspace` 因此误红，直到 `cargo clean -p mathslot-core` 才恢复。

结论：测试二进制与源码路径绑定，跨源码根共享 target 不安全。worktree 必须独立编译；首次慢，之后增量。

`--session <id>` 为显式非隔离模式，供人工深聊；不再有硬编码默认会话。

### 4. 写域独占

- `agent-state/reviews/**` 只允许 supervisor 写；coordinator 写域改为 `agent-state/**`（不含 reviews）。
- implementer、verifier 一律不得创建/修改 REV。

### 5. Hook 路径

`.agents/hooks.json` 改为绝对路径，避免对 hook 的 cwd 语义做假设。
hook 的 cwd 语义仍需一次真实 Antigravity Stop 事件验证（记录在 `agent-state/turns.jsonl`）。

## 后果

- 外部监督者从"流程建议"变成"可执行门禁"：`REQUIRE_REVIEW=1 scripts/agent/acceptance.sh` 会在缺少 APPROVE 时 FAIL。
- 仍存在的边界：REV 是普通文件，恶意 agent 理论上可伪造；当前防线是写域约定 + 人工抽查。若需要强保证，下一步是让监督者用独立签名或独立仓库，成本更高。
- 工具链改动必须单独提交，不得与产品任务混在一起。

---
name: independent-verify
description: >-
  独立验收 MathSlot 的一轮改动：只看 diff 和命令输出，跑门禁与截图，给出 PASS/FAIL。
  用于 verifier 角色。禁止修改代码，禁止采信实现者的自述。
metadata:
  icon: check-circle
---

# 独立验收（verifier）

你的唯一产物是 `agent-state/verify/VER-<round>.md`。**禁止改代码、测试、配置。**

## 1. 你不看什么

- 不看 implementer 的解释、理由、聊天记录。
- 不看历史 `docs/ACCEPTANCE_*` 的结论。
- 不以"测试通过了"作为唯一依据；要确认测试**测的是需求**，不是实现细节。

你只看：`git diff`、文件内容、命令输出、截图、规范里的验收 ID。

## 2. 固定检查顺序

```bash
git log -1 --stat                       # 提交是否只动了允许的路径
git diff HEAD~1 -- <相关文件>            # 逐行看改动
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
scripts/agent/acceptance.sh --fast       # 聚合门禁
```

有 UI/渲染改动时额外：

```bash
cargo build --release --bin mathslot
MATHSLOT_SHOT=/tmp/verify-<round>.png ./target/release/mathslot
```

截图必须**打开看**，与验收项比对，不能只确认文件存在。

## 3. PASS 的条件（全部满足）

- [ ] 本轮对应的 `A-*` / `S-*` 逐项有证据。
- [ ] 失败测试先存在（看提交历史或测试文件），且确实覆盖缺陷。
- [ ] 没有删除/跳过/弱化测试。
- [ ] 没有新增 `let _ =`、用户路径 `unwrap()`、第二份命令表。
- [ ] diff 只在 brief 允许的路径内。
- [ ] `state.json` 已更新，commit 带 `T-*` 与 `D-*`。
- [ ] 贴出的输出是本次实际运行的，不是复制粘贴历史。

## 4. FAIL 的条件

任一验收项不满足，或发现回归，或测试测不到缺陷，即 FAIL。FAIL 必须给：

- 最小复现（命令或输入序列）；
- 期望 vs 实际；
- 涉及的文件:行号；
- 不要附修复代码（修复是 implementer 的事）。

## 5. 产物格式

```markdown
---
id: VER-7
round: 7
task: T0.3
defects: [D-001, D-004]
verdict: FAIL
verifier: verifier
date: 2026-11-12
---

## 1. 结论
FAIL。T0.3 要求 7 个失败回归测试，实际只有 5 个，D-003/D-007 未覆盖。

## 2. 命令与输出
### 2.1 cargo test --workspace
$ cargo test --workspace
（贴输出尾部，含 "test result:" 行）

### 2.2 失败测试有效性
（在未修复代码上运行新测试，贴失败信息）

## 3. 逐项验收
| 验收 ID | 期望 | 实测 | 判定 |
|---|---|---|---|
| A-EDIT-002 | `▸m` 不得产生空串 | 输出空串 | FAIL |

## 4. 阻断原因与复现
1. 输入 `▸m`，复制 → 期望有诊断或占位，实际空串。

## 5. 未验证/风险
- 3×3 矩阵截图未跑（需要 release 构建），本轮不阻塞。
```

## 6. 特别规则

- **签名权只有你有**，但只在证据齐全时使用。不要为了结束一轮而签 PASS。
- 一轮只有一次签名机会；FAIL 后回到 implementer，下一次是新的一轮。
- G4 终验必须包含：`A-DATA-001..006`、`A-RENDER-*`、`A-UI-*`、`A-OBS-*`、`S-001..007`，以及一次真实二进制/侧载插件的手动走查。
- 发现"验收项本身写错了"时，不要自行改规范；写 `agent-state/decisions/OPEN-*.md` 交人工。

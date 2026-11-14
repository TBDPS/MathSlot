---
id: VER-20
round: 20
task: PRE-G3-NATIVE-1
defects: [D-110, D-015, D-009]
verdict: PASS
verifier: mathslot-verifier
date: 2026-11-14
---

# 独立验收报告 VER-20：Round 20（`PRE-G3-NATIVE-1`，commit `010e8d7`）

## 1. 结论

**`PASS`**。提交 [`010e8d7`](file:///home/mat/Projects/mathslot-next/src/app.rs) 严格限定在允许路径（`src/app.rs` 与 `src/p1_regression_tests.rs`），commit message 含 `PRE-G3-NATIVE-1` 与 `D-110 D-015 D-009`。新增 5 项测试（`src/p1_regression_tests.rs` 4 项、`src/app.rs` 1 项）覆盖真实需求且无删除/弱化/`#[ignore]`，无新增 `let _ =`、用户路径 `.unwrap()`、`#[allow(...)]` 或重复命令表；全部格式化、Clippy、离线测试、门禁脚本及 release 二进制编译与本地 Wayland 截图均实测通过。

---

## 2. 提交与静态核查

### 2.1 `git log -1 --stat` 与 `git show 010e8d7`
- 命令：`git log -1 --stat && git show 010e8d7`（exit `0`）
- 摘要：
  ```text
  commit 010e8d76b4f7170ca83aea1a82dc52e7ed6b3cdd (HEAD -> refactor/v1)
  Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
  Date:   Sat Nov 14 10:55:42 2026 +0800

      fix(native): PRE-G3-NATIVE-1 resolve D-110 D-015 D-009 focus IME repeat and singleline wrap

   src/app.rs                 | 489 ++++++++++++++++++++++++++++++++++++++-------
   src/p1_regression_tests.rs | 393 ++++++++++++++++++++++++++++++++++++
   2 files changed, 809 insertions(+), 73 deletions(-)
  ```
- 路径核查：仅修改 [`src/app.rs`](file:///home/mat/Projects/mathslot-next/src/app.rs) 与 [`src/p1_regression_tests.rs`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs)，未触及 `crates/**`、`src/modals.rs`、`scripts/agent/**` 或 `docs/**`。

### 2.2 禁止项扫描
- 命令：`rg -n "let _\s*=|\.unwrap\(|#\[allow\(|#\[ignore" src/app.rs src/p1_regression_tests.rs`（exit `0`）
- 输出：
  ```text
  src/p1_regression_tests.rs
  5://! 当前代码下标注 `#[ignore]`，执行 `cargo test --workspace -- --ignored` 时必须全部真实触发断言失败。
  ```
- 结论：无新增 `let _ =`、用户路径 `.unwrap()`、`#[allow(...)]`、新增 `#[ignore]` 或第二份命令表。

---

## 3. 命令与输出（本次实测）

### 3.1 `cargo fmt --check`
- 退出码：`0`（无输出，全部格式合标）。

### 3.2 `cargo clippy --workspace --all-targets -- -D warnings`
- 退出码：`0`
- 输出尾部：
  ```text
      Finished `dev` profile [optimized + debuginfo] target(s) in 0.19s
  ```

### 3.3 `cargo test --workspace --offline`
- 退出码：`0`
- 统计：全工作区共 **219 passed; 0 failed; 1 ignored**（较基线 214 passed 净增 5 项新测试，唯一 `ignored` 仍为既有的 `D-007` 回归测试 `crates/mathslot-core/tests/p1_regression_tests.rs`）。
- 关键 crate 与尾部输出：
  ```text
       Running unittests src/main.rs (target/debug/deps/mathslot-8945fbe915c2acd6)

  running 12 tests
  test app::tests::focus_transition_only_requests_when_requested_palette_unfocused_and_not_nav ... ok
  ...
  test p1_regression_tests::test_p2_d015_singleline_does_not_lock_focus ... ok
  test p1_regression_tests::test_p2_d009_singleline_layouter_does_not_wrap_long_formula ... ok
  test p1_regression_tests::test_p1_d110_no_every_frame_request_focus_or_ime_interrupt ... ok
  test p1_regression_tests::test_p1_d110_repeat_guard_blocks_orphan_and_post_ime_wayland_repeats ... ok
  ...
  test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.41s
  ...
       Running tests/golden_tests.rs (target/debug/deps/golden_tests-d953841e0a940f8f)
  ...
  test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  ```
  （尾部后续各 doc-test 均为 `0 passed; 0 failed`。）

### 3.4 `scripts/agent/acceptance.sh`
- 退出码：`0`
- 输出：
  ```text
  == MathSlot 门禁（/home/mat/Projects/mathslot-next）==
  时间：2026-11-14T10:57:36+08:00


  结果 检查项                    说明
  ------ ---------------------------- ----
  PASS   cargo fmt --check            exit 0
  PASS   cargo clippy -D warnings     exit 0
  PASS   cargo test --workspace       exit 0
  PASS   调色板一致性           exit 0（gate=G3）
  WARN   let _ = 计数               15 处（G4 前应清零）
  WARN   unwrap() 计数              20 处（用户输入路径应为 0）
  WARN   命令表常量              3 处（G1 后应只剩 catalog）
  WARN   工作区未提交           4 个文件

  PASS=4 FAIL=0 WARN=4
  结论：PASS
  ```
  （注：`工作区未提交 4 个文件` 为当前协调/审计进程遗留的 `M agent-state/state.json`、`AUD-20.md`、`ADR-0022`、`ADR-0023`，非 `010e8d7` 提交本身引起。）

### 3.5 Release 构建与 `MATHSLOT_SHOT` 截图实测
- 命令：`cargo build --release --locked --bin mathslot --offline && MATHSLOT_SHOT=/tmp/verify-20.png ./target/release/mathslot`
- 退出码：`0`
- 输出尾部：
  ```text
     Compiling mathslot v0.7.0 (/home/mat/Projects/mathslot-next)
      Finished `release` profile [optimized] target(s) in 1m 16s
  ```
- 截图文件核查：`ls -lh /tmp/verify-20.png`（exit `0`）→ `-rw-r--r--. 1 mat mat 199K 11月14日 10:58 /tmp/verify-20.png`。
- 视觉检查（已用 `read_file` 打开 `/tmp/verify-20.png`）：主窗口渲染完整清晰，`MathSlot v0.7.0` / `流式书写` 顶栏、公式预览、AST 槽位结构图、左下角单行输入栏（初始持焦光标与蓝色焦点框、单行占位文本无折行截断）、右侧 5 个工作区标签与结构面板、底栏状态与快捷键提示均显示正常。

---

## 4. 逐项验收（代码与测试对应需求核查）

| 缺陷 / 要求 | 期望行为 | 实测代码与测试证据 | 判定 |
|---|---|---|---|
| **D-110** 消除每帧 `request_focus` / IME 打断风暴 | 仅在请求归还焦点、处于 `Palette`、非导航且当前未持焦时调用一次 `request_focus`；稳态输入帧（含 `Preedit` / `Commit`）不得反复触发 `should_interrupt_composition` | [`src/app.rs:241-258, 2476-2498`](file:///home/mat/Projects/mathslot-next/src/app.rs#L241-L258) 提取纯函数 `decide_input_focus_transition` 并在帧尾按过渡动作触发一次；[`src/app.rs:3365`](file:///home/mat/Projects/mathslot-next/src/app.rs#L3365) 单测全分支；[`src/p1_regression_tests.rs:249-287`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L249-L287) 驱动真实 `egui::Context` 5 帧（含 `Preedit` 与 `Commit("你")`）断言 `should_interrupt_composition == false` | **PASS** |
| **D-110** `RepeatGuard` 与命令非重复消费 | 阻断 `Ime(_)` / `WindowFocused(false)` 后或无前置物理按下的孤立 `repeat: true` 及打印字符连击风暴（> 20），同时保留正常单次键入、`Ime::Commit` 与 `Backspace`/方向键物理长按；快捷键与导航按键忽略 `repeat: true` | [`src/app.rs:66-232, 2368-2372`](file:///home/mat/Projects/mathslot-next/src/app.rs#L66-L232) 实现 `RepeatGuard::filter_events` 并接入帧首预处理；[`src/app.rs:261-293, 627-963, 3144-3165`](file:///home/mat/Projects/mathslot-next/src/app.rs#L261-L293) 将命令/快捷键/导航改用 `consume_key_non_repeat`（`Idle` 下 `ArrowLeft`/`ArrowRight` 仍允许物理长按且受 `RepeatGuard` 保护）；[`src/p1_regression_tests.rs:289-475`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L289-L475) 覆盖正常键入 `'a'`、`x`+IME `Commit("中")` 后 8 帧孤立 repeat 阻断、`Backspace` 长按删除、30 帧 `'z'` 风暴截断（`<= 21`）及 `RepeatGuard` 失焦状态机直测 | **PASS** |
| **D-015** 移除 `lock_focus(true)` 与 Tab 焦点逃逸 | 单行输入栏不再锁死焦点，`Shift+Tab` 可移出焦点且后续帧不强行抢回；聚焦外按 `Tab` 仅导航控件，不注入 `▸` | [`src/app.rs:1756-1768`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1756-L1768) 已移除 `.lock_focus(true)`；[`src/app.rs:884-963`](file:///home/mat/Projects/mathslot-next/src/app.rs#L884-L963) 将 `Tab`/`Enter`/`Space`/`ArrowUp/Down` 拦截限定在 `input_has_focus`，且 `Tab` 使用 `exact_modifiers = true` 不吞 `Shift+Tab`；[`src/p1_regression_tests.rs:477-532`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L477-L532) 实测 `Shift+Tab` 退焦、稳态帧不回抢、失焦后按 `Tab` 不注入 `▸` | **PASS** |
| **D-009** `singleline` 不折行 + 水平滚动 | `layouter` 不再绑定 `wrap_width` 折行，长简码保持视觉单行并配合横向 `ScrollArea` | [`src/app.rs:1739-1772`](file:///home/mat/Projects/mathslot-next/src/app.rs#L1739-L1772) 设置 `job.wrap.max_width = f32::INFINITY`、`job.keep_trailing_whitespace = true`、`.clip_text(false)` 并包裹于 `egui::ScrollArea::horizontal()`；[`src/p1_regression_tests.rs:534-563`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L534-L563) 粘贴 160 字符公式断言 `galley.rows.len() == 1` | **PASS** |

---

## 5. 边界行为说明与未验证/风险

1. **`RepeatGuard` 边界观察（非阻断）**：
   - 故意长按单个可打印字符键（`a`–`z`、`Space` 等）会在单次物理按下达到 `1 + MAX_PRINTABLE_KEY_REPEATS = 21` 字符后被截断（[`src/app.rs:66, 200-205`](file:///home/mat/Projects/mathslot-next/src/app.rs#L66)），符合 `ADR-0023` 对连击风暴上限的契约；`Backspace`/`Delete`/方向键/`Home`/`End`/`PageUp`/`PageDown` 保持无上限长按。
   - `suppress_following_text_for_key`（[`src/app.rs:158, 214-221`](file:///home/mat/Projects/mathslot-next/src/app.rs#L158)）假设同一帧中 `Event::Key` 先于其派生的单字符 `Event::Text` 到达（与 `egui-winit` 实际事件顺序一致）；若同一帧出现被丢弃的 repeat `Key` 后紧跟无关联 `Event::Text`（且中间无 `Key`/`Ime`/`WindowFocused(false)`），该单字符 `Text` 会被顺带抑制一次。
2. **未自动化实操覆盖项（Unverified）**：
   - `MATHSLOT_SHOT=/tmp/verify-20.png ./target/release/mathslot` 已在本地 Wayland 环境下完成启动与首帧截图渲染，但**真实 `Wayland + fcitx5` 交互式长按快捷键、中文候选框上屏与连续按键的手工桌面走查**无法由无头单帧截图自动驱动，需后续人工在桌面窗口中点验确认。
   - 工作区当前仍存在非本轮提交的未提交协调/文档文件（`agent-state/state.json`、`AUD-20.md`、`ADR-0022`、`ADR-0023`），需由 coordinator 在更新 `state.json` 时一并归档提交。

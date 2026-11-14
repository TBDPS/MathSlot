---
id: VER-21
round: 21
task: PRE-G3-NATIVE-2
defects: [D-007, D-016, D-004]
verdict: PASS
verifier: mathslot-verifier
date: 2026-11-14
---

# 独立验收报告 VER-21：Round 21（`PRE-G3-NATIVE-2`，commit `3d694d5`）

## 1. 结论

**`PASS`**。提交 [`3d694d5`](file:///home/mat/Projects/mathslot-next/src/modals.rs) 严格限定在允许路径（`Cargo.toml`、`Cargo.lock`、`crates/mathslot-core/src/latex.rs`、`crates/mathslot-core/tests/p1_regression_tests.rs`、`src/app.rs`、`src/modals.rs`、`src/p1_regression_tests.rs`），commit message 包含 `PRE-G3-NATIVE-2` 与 `D-007 D-016 D-004`。`crates/mathslot-core/tests/p1_regression_tests.rs` 仅移除了 `#[ignore = ...]` 标注，未修改或弱化任何断言；原生端 `D-007`、`D-016`、`D-004` 修复与新增回归测试全部对应需求且实测通过。全部格式化、Clippy、离线全工作区测试（223 passed, 0 failed, 0 ignored）、门禁脚本、release 二进制构建与截图视觉核查、以及 Linux 发布包核查均通过。

---

## 2. 提交与静态核查

### 2.1 `git log -1 --stat` 与 `git status --short`
- 命令：`git log -1 --stat && git status --short`（exit `0`）
- 输出：
  ```text
  commit 3d694d5521222e4fe898648d0e34e8a21645d969 (HEAD -> refactor/v1)
  Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
  Date:   Sat Nov 14 11:16:36 2026 +0800

      PRE-G3-NATIVE-2: fix native LaTeX import report, modal delete safety, and copy_latex diagnostics (D-007 D-016 D-004)

   Cargo.lock                                        |   1 +
   Cargo.toml                                        |   1 +
   crates/mathslot-core/src/latex.rs                 |  55 +-
   crates/mathslot-core/tests/p1_regression_tests.rs |   1 -
   src/app.rs                                        | 110 +++-
   src/modals.rs                                     | 592 ++++++++++++++++++++--
   src/p1_regression_tests.rs                        | 305 +++++++++++
   7 files changed, 990 insertions(+), 75 deletions(-)
  ```
- 路径核查：仅修改上述 7 个允许文件，未触及 `scripts/**`、`agent-state/**` 或无关 crate；工作区初始状态干净（无未跟踪源码改动）。

### 2.2 `crates/mathslot-core/tests/p1_regression_tests.rs` Diff 核查
- 命令：`git show 3d694d5 -- crates/mathslot-core/tests/p1_regression_tests.rs`（exit `0`）
- 完整 diff：
  ```diff
  @@ -159,7 +159,6 @@ fn test_p1_d006_formula_upsert_same_millisecond_no_collision() {
   /// 缺少诊断报告机制；遇到不支持的复杂宏（如 `\tensor{A}{^i_j}`）时暴力剥离 `{...}` 外层括号，
   /// 导致输出破坏性退化为 `\tensorA^i_j`。
   #[test]
  -#[ignore = "P1 regression: D-007 (fails until fixed in G1/G2/G4)"]
   fn test_p1_d007_latex_import_reports_lossy_and_blocks_degradation() {
  ```
- 结论：仅移除 `#[ignore]` 启用既有 P1 失败回归测试 `test_p1_d007_latex_import_reports_lossy_and_blocks_degradation`，未修改或弱化任何测试输入或断言。

### 2.3 禁止项扫描
- 命令：`rg -n "let _ =|\.unwrap\(|#\[allow\(|#\[ignore" src/app.rs src/modals.rs src/p1_regression_tests.rs crates/mathslot-core/src/latex.rs crates/mathslot-core/tests/p1_regression_tests.rs`（exit `0`）
- 输出：
  ```text
  src/p1_regression_tests.rs
  5://! 当前代码下标注 `#[ignore]`，执行 `cargo test --workspace -- --ignored` 时必须全部真实触发断言失败。

  crates/mathslot-core/tests/p1_regression_tests.rs
  5://! 当前代码下标注 `#[ignore]`，执行 `cargo test --workspace -- --ignored` 时必须全部真实触发断言失败。
  117:/// `id = format!("user-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs())`
  ```
- 结论：上述文件内无 `let _ =`、无代码路径 `.unwrap()`（仅第 117 行文档注释）、无 `#[allow(...)]`、无 `#[ignore]`，亦未新增第二份命令表。

---

## 3. 命令与输出（本次实测）

### 3.1 `cargo fmt --check`
- 退出码：`0`（无输出，全部格式合标）。

### 3.2 `cargo clippy --workspace --all-targets -- -D warnings`
- 退出码：`0`
- 输出尾部：
  ```text
      Finished `dev` profile [optimized + debuginfo] target(s) in 0.20s
  ```

### 3.3 `cargo test --workspace --offline`
- 退出码：`0`
- 全工作区汇总统计：**223 passed; 0 failed; 0 ignored**（涵盖全部 47 个 test result 段：其中 `mathslot` bin 单元测试 `15 passed` 较上轮 12 项净增 3 项、`mathslot_core` `p1_regression_tests` `7 passed; 0 ignored` 启用原 `D-007` 忽略测试）。
- 关键输出片段与尾部：
  ```text
       Running unittests src/main.rs (target/debug/deps/mathslot-278b72bc0bcc64c1)

  running 15 tests
  ...
  test p1_regression_tests::test_p1_d007_modals_uses_import_report_and_blocks_error_imports ... ok
  test p1_regression_tests::test_p2_d016_modal_deletes_require_confirmation_and_support_undo ... ok
  test p1_regression_tests::test_p1_d004_native_copy_latex_does_not_silently_drop_pending_or_unknown ... ok
  ...
  test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.43s
  ...
       Running tests/p1_regression_tests.rs (target/debug/deps/mathslot_core-...)
  test p1_regression_tests::test_p1_d007_latex_import_reports_lossy_and_blocks_degradation ... ok
  ...
  test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
  ...
     Doc-tests mathslot_syntax
  test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  ```

### 3.4 `scripts/agent/acceptance.sh`
- 退出码：`0`
- 完整输出：
  ```text
  == MathSlot 门禁（/home/mat/Projects/mathslot-next）==
  时间：2026-11-14T11:19:47+08:00


  结果 检查项                    说明
  ------ ---------------------------- ----
  PASS   cargo fmt --check            exit 0
  PASS   cargo clippy -D warnings     exit 0
  PASS   cargo test --workspace       exit 0
  PASS   调色板一致性           exit 0（gate=G3）
  WARN   let _ = 计数               15 处（G4 前应清零）
  WARN   unwrap() 计数              20 处（用户输入路径应为 0）
  WARN   命令表常量              3 处（G1 后应只剩 catalog）
  PASS   工作区干净              0 个未提交改动

  PASS=5 FAIL=0 WARN=3
  结论：PASS
  ```

### 3.5 Release 构建、`MATHSLOT_SHOT` 截图与视觉核查
- 命令：`cargo build --release --locked --bin mathslot --offline && MATHSLOT_SHOT=/tmp/verify-21.png ./target/release/mathslot`
- 退出码：`0`
- 编译输出尾部：
  ```text
      Finished `release` profile [optimized] target(s) in 0.16s
  ```
- 截图文件核查：`ls -lh /tmp/verify-21.png`（exit `0`）→ `-rw-r--r--. 1 mat mat 199K 11月14日 11:20 /tmp/verify-21.png`。
- 视觉检查（已使用 `read_file` 打开 `/tmp/verify-21.png` 核验）：主界面布局、高对比度主题、`MathSlot v0.7.0` 标题与 `流式书写` 状态胶囊、公式预览区、AST 槽位分层结构图、左下角单行简码输入栏与 `复制 LaTeX` 按钮、右侧 5 个工作区标签（`∑ 符号结构`、`公式库`、`扩展中心`、`⇄ LaTeX 导入`、`使用指南`）与结构面板、底栏状态与快捷键提示均渲染清晰无截断或重影。

### 3.6 Linux 发布打包产物核查
- 命令：`ls -lh target/release/bundle/mathslot-linux-x86_64.tar.gz && tar -tzf target/release/bundle/mathslot-linux-x86_64.tar.gz`（exit `0`）
- 产物大小与内容：`-rw-r--r--. 1 mat mat 6.1M 11月14日 11:18 target/release/bundle/mathslot-linux-x86_64.tar.gz`，内含 `mathslot-linux-x86_64/mathslot`、`assets/icons/*`（svg 及 16..512 png）、`assets/mathslot.desktop`、`scripts/install-desktop.sh`、`README.md`、`HELP.md`。
- 二进制一致性：`sha256sum target/release/mathslot` 与 `tar -xOf target/release/bundle/mathslot-linux-x86_64.tar.gz mathslot-linux-x86_64/mathslot | sha256sum`（exit `0`）均为：
  ```text
  fba354519ec16f8a6efaa82ab491e70018e225a8ee512fc5807c8e4fbf5493e0
  ```
  打包二进制与当前提交 `3d694d5` 编译出的 release 二进制完全一致。

---

## 4. 逐项验收（代码与测试对应需求核查）

| 缺陷 / 要求 | 期望行为 | 实测代码与测试证据 | 判定 |
|---|---|---|---|
| **D-007** 原生端 LaTeX 导入诊断与错误阻断 + 未知宏不退化 | 接入 `mathslot_latex::convert_latex_with_report` 与 `ImportReport`；展示无损/有损/错误诊断与 roundtrip 对比；空结果或 `has_errors()` 阻断替换/插入；未知宏（如 `\tensor{A}{^i_j}`）保留花括号结构 | [`src/modals.rs:56-85, 301-305, 1337-1394, 2065-2144`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L56-L85) 在 `update_latex_conversion` 调用 `convert_latex_with_report`，通过 `render_import_report_panel` 展示诊断与原文/roundtrip 对比，并通过 `can_apply_latex_import` 禁用并阻断空结果、缺失报告及语法错误的应用；[`crates/mathslot-core/src/latex.rs:280-293, 576-800, 1320-1326`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/latex.rs#L280-L293) 通过 `lookup_canonical_macro` 与 `consume_verbatim_macro_args` 原样保留未知宏参数括号；[`crates/mathslot-core/tests/p1_regression_tests.rs:162-181`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/tests/p1_regression_tests.rs#L162-L181)（去 `#[ignore]` 后通过）与 [`src/p1_regression_tests.rs:565-633`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L565-L633) 实测通过 | **PASS** |
| **D-016** 公式库、自定义格式、片段三类删除二次确认与 10 秒 Undo 恢复 | 点击删除先进入待确认态不直接删库，支持取消；确认后写入 `UndoDeleteEntry`（10 秒窗口），可通过横幅撤销恢复并持久化，超时不可恢复 | [`src/modals.rs:33-60, 307-504, 1032-1108, 1606-1714, 1907-2055`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L307-L504) 对 `PendingDeleteTarget::{Formula, CustomFormat, Snippet}` 三类入口全部接入 `request_delete` -> 确认栏/取消 -> `confirm_pending_delete` -> `render_undo_delete_banner` / `undo_last_delete`（10s `UNDO_DELETE_WINDOW`）；[`src/p1_regression_tests.rs:635-788`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L635-L788) 完整覆盖三类删除的请求/取消保留/确认删除/窗口内恢复/超时拒绝及落盘 | **PASS** |
| **D-004** 原生 `copy_latex` 面对 `PendingCmd` / `UnknownCmd` 不静默丢弃 | 导出前检查 AST 中未解决命令（含嵌套槽位），发现 `PendingCmd` / `UnknownCmd` 或空导出非空 AST 时阻止剪贴板写入并向状态栏输出明确诊断而非"无内容可复制" | [`src/app.rs:64-143, 499-511`](file:///home/mat/Projects/mathslot-next/src/app.rs#L64-L143) 实现 `collect_unresolved_cmd_diagnostics` 与 `prepare_copy_latex`，并在 `MathSlotApp::copy_latex` 阻断 `ctx.copy_text` 同时更新诊断状态文本；[`src/p1_regression_tests.rs:790-867`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L790-L867) 驱动真实 `egui` 帧注入 `1 + ▸m` 触发 `Ctrl+Shift+C` 验证未写入剪贴板、未误报空内容且输出可见诊断，并验证 `▸zz` 报错与 `▸f1;2;` 正常导出 | **PASS** |

---

## 5. 未验证项与协调提示

1. **交互式模态窗口与剪贴板手工走查（Unverified in headless shot）**：
   - `MATHSLOT_SHOT=/tmp/verify-21.png ./target/release/mathslot` 仅渲染并核验了主窗口首帧；`⇄ LaTeX 导入` 模态面板、`公式库`/`扩展中心` 二次确认按钮布局与 10 秒倒计时撤销横幅的真实桌面交互，以及系统剪贴板写入在 Wayland 桌面上的实操走查尚未以交互式截屏逐帧录制（核心逻辑与 UI 事件流已由 `src/p1_regression_tests.rs` 中 `egui` 测试与单元测试覆盖）。
2. **状态文件同步提示（非本轮代码阻断）**：
   - `agent-state/state.json` 当前仍显示 `"open_p1": ["D-007"]`（遵循分工规则，verifier 未修改 `state.json`）。待 coordinator 收纳本 `VER-21.md` 后，可按流程更新 `agent-state/state.json`（闭环 `D-007`、`D-016`、更新测试基线计数 `223 passed; 0 ignored`）与 `HANDOFF.md`。

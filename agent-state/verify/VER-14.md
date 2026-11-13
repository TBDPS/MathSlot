---
id: VER-14
round: 14
task: T2.2
defects: [D-012, D-104, D-105, D-106, D-107]
verdict: PASS
verifier: verifier
date: 2026-11-14
---

# MathSlot 独立验收报告 (VER-14)

- **验收角色**：verifier（独立验收员；严格遵守 `AGENTS.md` 与 `.agents/skills/independent-verify/SKILL.md`，未修改任何产品代码、测试代码、配置或脚本，未采信实现者自述）
- **工作目录**：`/home/mat/Projects/mathslot-next`，分支 `refactor/v1`
- **提交哈希**：`c3e2de2e9fdfdd082a76efc5bbb2271d5a06a868` (`c3e2de2`)
- **提交信息**：`T2.2: implement intent-grouped History and deterministic undo/redo (D-012, D-104, D-105, D-106, D-107)`
- **验收目标**：针对 Gate G2 任务 `T2.2`（Transaction/Undo 按 Intent 分组，产出 `History`，解决新栈 `D-012` 与 `D-104..D-107`，守护 `INV-008` / `INV-014` / `INV-016`）执行独立证据核查。
- **综合裁定**：**PASS**

---

## 1. 结论

**PASS**。
经逐行核查 `git diff HEAD~1 HEAD`、相关源码/测试文件及亲自运行全量命令与门禁，Round 14 (`T2.2`) 满足 `ADR-0017` 与规范 §6.1、§7.2、§14 全部要求：

1. **提交与作用域合规**：
   - commit `c3e2de2` 信息明确包含 `T2.2` 与 `D-012, D-104, D-105, D-106, D-107`；
   - 变更严格限定在 `crates/mathslot-doc/**` 与 `crates/mathslot-app/**` 共 11 个文件，零改动 `src/**`、`crates/mathslot-core/**`、`crates/mathslot-syntax/**`、`crates/mathslot-command/**`、`scripts/agent/**`、`docs/**`。
2. **禁止项与红线全部通过**：
   - `git diff HEAD~1 HEAD` 中零新增 `let _ =` 语句（唯一匹配仅为 `history_intent_tests.rs` 中的错误提示字符串字面量）；
   - `crates/mathslot-doc/src/undo.rs` 中的 `let _ =` 由 `HEAD~1` 的 3 处（第 113、128、154 行）清零至 0 处，全仓 `acceptance.sh` 统计 `let _ =` 由 27 处净降至 24 处；
   - 产品代码零新增 `#[allow]`、零新增 `#[ignore]`、零 `SystemTime`、零 `.unwrap()`（diff 中 `.unwrap()` 仅位于测试文件 `history_intent_tests.rs`）；
   - 4 项既定 P1 `#[ignore]` 回归测试（`D-003`, `D-005`, `D-006`, `D-007`）完整保留且运行 `-- --ignored` 仍真实触发失败，未删除或弱化既有测试。
3. **`T2.2` 契约与 `D-104..D-107` 闭环**：
   - 导出 `History`（保留 `pub type UndoStack = History` 兼容冻结 `mathslot-core`）、`Selection`（`selection_before`/`selection_after` 随 Undo/Redo 精确恢复）与完整 `Intent` 枚举（`Typing`, `Command`, `PaletteCard`, `CommandExpansion`, `Paste`, `Delete`, `Import`, `Clear`, `ImeCommit`, `Nav`, `Navigation`, `Format`）；
   - 修复 `D-104`：`History::try_coalesce` 强制校验 `last.cursor_after == tx.cursor_before && last.selection_after == tx.selection_before`，`try_coalesce_typing` 校验 `InSlot` 的 `id1 == id2 && *off2 == *off1 + text1.chars().count()`，导航操作调用 `break_coalesce()`，同槽左移插入后 Undo/Redo 严格保持 `\frac{ba}{}`；
   - `Typing` 在空白字符、导航、前缀进入/取消、命令与粘贴处严格断开；`Intent::Delete` 支持同向连续退格/前删词内合并、跨空白/换行断开（`breaks_word_or_line`）、根级 `DeleteForward` 及选区删除 `Edit::DeleteSelection`；
   - 修复 `D-105`：新增 `Editor::import_latex` / `AppEvent::ImportLatex`（`Intent::Import`）与 `Editor::clear` / `AppEvent::Clear`（`Intent::Clear`），单步可撤销并完整恢复文档、光标与选区，清空不再销毁历史栈；
   - 修复 `D-106` / 守护 `INV-008`：彻底移除 `std::time::SystemTime::now()` 与 500ms 挂钟时间窗，`cargo check --locked -p mathslot-doc -p mathslot-app --target wasm32-unknown-unknown` 编译通过；
   - 修复 `D-107`：`Intent::Nav`/`Navigation` 不入栈且不破坏 `redo_list`；`Cursor::AtStart` 无槽位插入不再构造幽灵 `SlotId(1)`；`History::undo`/`redo` 出错时回滚文档节点/版本/槽位与栈帧并返回 `Result<bool, DocError>`，`AppCommand::DeleteForward` 接入 `editor.delete_forward()`。
4. **全量门禁与测试全绿**：
   - `cargo test -p mathslot-doc`：24 passed (9 + 5 + 6 + 4), 0 failed；
   - `cargo test -p mathslot-app`：12 passed, 0 failed；
   - `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace`（194 passed, 0 failed, 4 ignored）、`scripts/agent/audit_palette.py`、`scripts/agent/acceptance.sh`（PASS=4 FAIL=0 WARN=4）全部退出码 0。

---

## 2. 命令与输出实录

### 2.1 Git 提交与作用域合规核查

```bash
$ git log -n 2 --stat
commit c3e2de2e9fdfdd082a76efc5bbb2271d5a06a868 (HEAD -> refactor/v1)
Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
Date:   Sat Nov 14 02:29:09 2026 +0800

    T2.2: implement intent-grouped History and deterministic undo/redo (D-012, D-104, D-105, D-106, D-107)

 crates/mathslot-app/src/app.rs                     |  51 +-
 crates/mathslot-app/src/command.rs                 |   1 +
 crates/mathslot-app/src/event.rs                   |   1 +
 crates/mathslot-app/src/lib.rs                     |   2 +-
 .../mathslot-app/tests/app_state_machine_tests.rs  | 114 ++-
 crates/mathslot-doc/src/cursor.rs                  |  32 +
 crates/mathslot-doc/src/editor.rs                  | 250 ++++--
 crates/mathslot-doc/src/lib.rs                     |   6 +-
 crates/mathslot-doc/src/transaction.rs             | 960 ++++++++++++++++-----
 crates/mathslot-doc/src/undo.rs                    | 308 +++++--
 crates/mathslot-doc/tests/history_intent_tests.rs  | 708 +++++++++++++++
 11 files changed, 2079 insertions(+), 354 deletions(-)
```

```bash
$ git diff HEAD~1 HEAD --name-status
M	crates/mathslot-app/src/app.rs
M	crates/mathslot-app/src/command.rs
M	crates/mathslot-app/src/event.rs
M	crates/mathslot-app/src/lib.rs
M	crates/mathslot-app/tests/app_state_machine_tests.rs
M	crates/mathslot-doc/src/cursor.rs
M	crates/mathslot-doc/src/editor.rs
M	crates/mathslot-doc/src/lib.rs
M	crates/mathslot-doc/src/transaction.rs
M	crates/mathslot-doc/src/undo.rs
A	crates/mathslot-doc/tests/history_intent_tests.rs
```
- **退出码**：`0`
- **判定**：仅修改上述 11 个 `crates/mathslot-doc/**` 与 `crates/mathslot-app/**` 文件；`src/**`、`crates/mathslot-core/**`、`crates/mathslot-syntax/**`、`crates/mathslot-command/**`、`scripts/agent/**`、`docs/**` 零改动。

### 2.2 禁止项与红线扫描

```bash
$ git diff HEAD~1 HEAD | grep "^+.*let _ ="
+        .expect_err("undo with invalid slot must propagate DocError instead of let _ =");
+        .expect_err("redo with invalid slot must propagate DocError instead of let _ =");
# 退出码 0；仅 2 条测试断言提示字符串，零新增 `let _ =` 语句

$ git show HEAD~1:crates/mathslot-doc/src/undo.rs | grep -n 'let _ ='
113:            let _ = Self::apply_raw_edit(doc, edit);
128:            let _ = Self::apply_raw_edit(doc, edit);
154:                let _ = Transaction::apply_edit(doc, edit, &dummy)?;

$ rg -n "let _ =" crates/mathslot-doc crates/mathslot-app
crates/mathslot-doc/tests/history_intent_tests.rs
596:        .expect_err("undo with invalid slot must propagate DocError instead of let _ =");
649:        .expect_err("redo with invalid slot must propagate DocError instead of let _ =");
# undo.rs 内 `let _ =` 由 3 降至 0；全仓 `acceptance.sh` 统计由 27 降至 24

$ git diff HEAD~1 HEAD | grep -E "^\+.*#\[allow|^\+.*#\[ignore|^\+.*SystemTime|^\+.*\.unwrap\("
# 全部 .unwrap( 仅出现在 crates/mathslot-doc/tests/history_intent_tests.rs（共 29 处测试调用）
# 产品代码 crates/mathslot-doc/src 与 crates/mathslot-app/src 零新增 #[allow]、零 #[ignore]、零 SystemTime、零 .unwrap()

$ rg -n "SystemTime" crates/mathslot-doc crates/mathslot-app
# 退出码 1（无匹配）

$ rg -n "#\[ignore" src/ crates/
src/p1_regression_tests.rs:90:#[ignore = "P1 regression: D-003 (fails until fixed in G1/G2/G4)"]
src/p1_regression_tests.rs:170:#[ignore = "P1 regression: D-005 (fails until fixed in G1/G2/G4)"]
crates/mathslot-core/tests/p1_regression_tests.rs:121:#[ignore = "P1 regression: D-006 (fails until fixed in G1/G2/G4)"]
crates/mathslot-core/tests/p1_regression_tests.rs:163:#[ignore = "P1 regression: D-007 (fails until fixed in G1/G2/G4)"]
# 仅保留既定 4 个 P1 回归 #[ignore]
```

### 2.3 `cargo test -p mathslot-doc`

```bash
$ cargo test -p mathslot-doc
     Running tests/a_edit_acceptance_tests.rs (target/debug/deps/a_edit_acceptance_tests-e1855551e9eeab69)
running 9 tests
...
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/doc_tests.rs (target/debug/deps/doc_tests-2604335a39f09ec1)
running 5 tests
...
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/history_intent_tests.rs (target/debug/deps/history_intent_tests-122b9892e52f1c17)
running 6 tests
test test_history_deterministic_without_wall_clock_and_nav_never_recorded ... ok
test test_import_and_clear_are_single_undoable_transactions_with_selection ... ok
test test_delete_intent_coalesces_within_word_and_breaks_across_word_and_line ... ok
test test_undo_redo_error_rollback_and_root_delete_forward ... ok
test test_typing_coalesces_word_and_breaks_on_space ... ok
test test_typing_breaks_on_command_paste_and_navigation_and_preserves_redo_order ... ok
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/parity_harness_tests.rs (target/debug/deps/parity_harness_tests-817c11c946c6a9dc)
running 4 tests
...
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```
- **退出码**：`0`（共计 24 passed, 0 failed, 0 ignored）

### 2.4 `cargo test -p mathslot-app`

```bash
$ cargo test -p mathslot-app
     Running tests/app_state_machine_tests.rs (target/debug/deps/app_state_machine_tests-f0dabb506e163cb0)
running 12 tests
test test_a_edit_003_unknown_command_diagnostic ... ok
test test_a_edit_002_pending_copy_export ... ok
test test_a_edit_001_stream_frac ... ok
test test_a_edit_004_partial_card ... ok
test test_a_edit_005_undo_separate_typing_and_card ... ok
test test_a_edit_006_paste_with_prefix ... ok
test test_a_edit_008_navigation_mode_no_text_or_undo_change ... ok
test test_app_delete_forward_nav_and_d104_protection ... ok
test test_a_edit_007_ime_composition_isolation ... ok
test test_effect_ordering_deterministic ... ok
test test_keys_actions_and_redo ... ok
test test_import_and_clear_are_single_undoable_transactions_with_selection ... ok

test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```
- **退出码**：`0`

### 2.5 `cargo fmt --check`、`clippy -D warnings`、`cargo test --workspace` 与 `wasm32` 检查

```bash
$ cargo fmt --check
# 退出码 0（无输出）

$ cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.25s
# 退出码 0

$ cargo test --workspace
# 退出码 0
# 汇总：passed=194 failed=0 ignored=4（较 Round 13 的 186 passed 新增 8 个确定性测试：history_intent_tests 6 + app_state_machine_tests 2）

$ cargo check --locked -p mathslot-doc -p mathslot-app --target wasm32-unknown-unknown
    Checking mathslot-syntax v0.7.0 (/home/mat/Projects/mathslot-next/crates/mathslot-syntax)
    Checking mathslot-command v0.7.0 (/home/mat/Projects/mathslot-next/crates/mathslot-command)
    Checking mathslot-doc v0.7.0 (/home/mat/Projects/mathslot-next/crates/mathslot-doc)
    Checking mathslot-app v0.7.0 (/home/mat/Projects/mathslot-next/crates/mathslot-app)
    Finished `dev` profile [optimized + debuginfo] target(s) in 37.84s
# 退出码 0
```

既定 4 项 `#[ignore]` 负向回归验证（确认未被弱化且仍真实失败）：
```bash
$ cargo test --workspace -- --ignored
# mathslot bin 退出码 101：test_p1_d003_fitted_size_strictly_respects_max_bounds FAILED, test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file FAILED

$ cargo test -p mathslot-core -- --ignored
# 退出码 101：test_p1_d006_formula_upsert_same_millisecond_no_collision FAILED, test_p1_d007_latex_import_reports_lossy_and_blocks_degradation FAILED
```

### 2.6 `audit_palette.py` 与 `acceptance.sh`

```bash
$ scripts/agent/audit_palette.py
扫描：12 张卡片，109 条子菜单命令
...
PASS：所有可映射卡片与命令目录一致
# 退出码 0

$ scripts/agent/acceptance.sh
== MathSlot 门禁（/home/mat/Projects/mathslot-next）==
时间：2026-11-14T02:33:46+08:00


结果 检查项                    说明
------ ---------------------------- ----
PASS   cargo fmt --check            exit 0
PASS   cargo clippy -D warnings     exit 0
PASS   cargo test --workspace       exit 0
PASS   调色板一致性           exit 0（gate=G2）
WARN   let _ = 计数               24 处（G4 前应清零）
WARN   unwrap() 计数              22 处（用户输入路径应为 0）
WARN   命令表常量              3 处（G1 后应只剩 catalog）
WARN   工作区未提交           2 个文件

PASS=4 FAIL=0 WARN=4
结论：PASS
# 退出码 0
```
（注：2 个未提交文件为本轮既有文档 `agent-state/audits/AUD-14.md` 与 `agent-state/decisions/ADR-0017-history-intent-grouping-t2.2.md`，符合本轮验收前工作流阶段。）

---

## 3. 源码逐项核查与验收对照表

| 验收/核查项 | 期望契约 (`LLM_IMPLEMENTATION_SPEC.md` / `ADR-0017`) | 源码定位与测试实测证据 | 判定 |
|---|---|---|---|
| **History 与 UndoStack 兼容** | 产出 `History`，兼容 `UndoStack = History`，暴露观测接口 `undo_depth/redo_depth/intents/redo_intents/break_coalesce` | `crates/mathslot-doc/src/undo.rs:7-15,59-92`、`crates/mathslot-doc/src/lib.rs:17`、`crates/mathslot-app/src/lib.rs:17`；`mathslot-core` 零改动通过编译 | **PASS** |
| **Selection 与选区恢复** | `Selection`（anchor/focus）及 `Transaction.selection_before/after`，Undo/Redo 恢复选区 | `crates/mathslot-doc/src/cursor.rs:18-47`、`transaction.rs:108-109`、`undo.rs:283,313`、`editor.rs:52,310-330`、`app.rs:464-470`；`history_intent_tests.rs:321-345,360-400` 与 `app_state_machine_tests.rs:444-490` 验证通过 | **PASS** |
| **Intent 全集覆盖** | 覆盖 `Typing`, `Command`, `PaletteCard`, `CommandExpansion`, `Paste`, `Delete`, `Import`, `Clear`, `ImeCommit`, `Nav`, `Navigation`, `Format` | `crates/mathslot-doc/src/transaction.rs:24-52`（含 `is_command()` 与 `is_nav()`）；`history_intent_tests.rs:172-184,220-296,367-383,507-528` 覆盖验证 | **PASS** |
| **Typing 断组与 D-104 修复** | 空格/空白、导航、前缀、命令、粘贴处断开；校验 `InSlot.offset` 与 `cursor_after == cursor_before`，同槽左移插入后 Undo/Redo 严格保序 | `undo.rs:129-212`（校验 `breaks_word_or_line`、`cursor_after == cursor_before`、`selection_after == selection_before`、`*off2 == *off1 + text1.chars().count()`）；`editor.rs:105,115,147-157,355,389,414,433,448,585,611,675,680-683` 调用 `break_coalesce()`；`test_typing_coalesces_word_and_breaks_on_space`、`test_typing_breaks_on_command_paste_and_navigation_and_preserves_redo_order`、`test_app_delete_forward_nav_and_d104_protection` 验证 `\frac{ba}{}` 严格往返 | **PASS** |
| **Delete 合并与前删可用** | 退格/前删词内合并、跨空格/换行断开；根级 `backward: false` 与 `AppCommand::DeleteForward` 可用 | `editor.rs:620-648`、`transaction.rs:380-554,602-861`（`DeleteSelection`、`delete_first_root_char`、`delete_at_root_node`、`breaks_word_or_line: deleted_char.is_whitespace()`）、`undo.rs:214-257`、`app.rs:188-200`；`test_delete_intent_coalesces_within_word_and_breaks_across_word_and_line` 与 `test_undo_redo_error_rollback_and_root_delete_forward` 与 `test_app_delete_forward_nav_and_d104_protection` 全部通过 | **PASS** |
| **Import / Clear 单步可撤销 (D-105)** | `Import` 与 `Clear` 单步入栈、清空未决流式状态/诊断、不销毁历史栈、可一步撤销并还原选区 | `editor.rs:469-518`、`event.rs:31`、`command.rs:25`、`app.rs:136-137,287-310`；`test_import_and_clear_are_single_undoable_transactions_with_selection`（在 `mathslot-doc` 与 `mathslot-app` 双层验证，含空文档 `Clear` 幂等与 `PrefixPending` 状态清理）通过 | **PASS** |
| **去系统挂钟 (D-106, INV-008)** | 禁止 `SystemTime::now()` 与时间窗合并；提供确定性无挂钟测试；`wasm32` 编译通过 | `editor.rs` 移除 `std::time` 改用 `tx_seq`；`undo.rs` 完全忽略 `timestamp_ms`；`test_history_deterministic_without_wall_clock_and_nav_never_recorded`（显式验证 `timestamp_ms = 0` 与 `10_000` 仍词内合并，同毫秒 `delta = 0` 异意图/空格仍断开）+ `wasm32-unknown-unknown` check 通过 | **PASS** |
| **Nav 隔离与 D-107 修复** | `Nav` 不入栈不破 redo；无槽位 `AtStart` 无幽灵 `SlotId(1)`；`undo`/`redo` 出错回滚不吞错 | `undo.rs:101-105` 拦截 `tx.intent.is_nav()`；`transaction.rs:238-252` `AtStart` 返回合法 `Cursor::AtStart`；`undo.rs:260-317` 回滚 `doc.nodes/version/slots` 并重压栈帧返回 `Err(err)`；`editor.rs:332-352` 出错推入诊断；`history_intent_tests.rs:500-655` 实测通过 | **PASS** |
| **A-EDIT-001..008 回归** | 无头状态机与文档编辑器全部 A-EDIT 场景不退化 | `a_edit_acceptance_tests.rs` (9 passed) + `app_state_machine_tests.rs` (12 passed) 全过 | **PASS** |

---

## 4. 阻断原因

无（本轮判定 **PASS**）。

---

## 5. 未验证项与风险提示

1. **旧桌面端（`src/app.rs` 与 `crates/mathslot-core/src/session.rs`）仍处于冻结状态**：
   - `src/app.rs:67, 132, 1275-1284` 仍使用 `last_typing_undo: Instant` 450ms 时间窗且卡片点击不重置计时器，`src/app.rs:1947-1955` 的 `ModalAction::ReplaceCode` 未入撤销栈；`crates/mathslot-core/src/session.rs:36-42` 的 `Session::load_latex` 仍重建 `Editor`。
   - 依据 `ADR-0017` §2.5 与 `INV-016`，旧栈在本轮严格禁止修改，上述旧端入口将在 Gate G3 前端统一切换至 `mathslot-app` 时替换或退出；`D-012` 在新栈（`mathslot-doc` / `mathslot-app`）已完全闭环，但在全局缺陷台账上建议待 G3 切换后再彻底标为最终闭环。
2. **先红后绿提交粒度说明**：
   - Git 历史中 `c3e2de2` 为单个实现与测试合并提交，历史快照中不存在独立的预置红灯提交；但独立审阅 `crates/mathslot-doc/tests/history_intent_tests.rs` 与 `crates/mathslot-app/tests/app_state_machine_tests.rs` 确认新增 8 项测试均直接针对 `AUD-14` 暴露的缺口与缺陷编写了强断言，非弱化或凑数测试。
3. **WASM 运行期执行未测**：
   - 本轮已实测 `cargo check --locked -p mathslot-doc -p mathslot-app --target wasm32-unknown-unknown` 编译通过（证明无 `SystemTime` 等主机 API 依赖），但未在 JS/WASM 宿主机中实际运行单元测试（留待 G3 `mathslot-wasm` 集成阶段）。

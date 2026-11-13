---
id: VER-13
round: 13
task: T2.1
defects: [D-001, D-004]
verdict: PASS
verifier: verifier
date: 2026-11-13
---

# MathSlot 独立验收报告 (VER-13)

- **验收角色**：verifier（独立验收员，只读代码与命令输出，严禁修改产品代码、测试、配置或脚本，严禁采信实现者自述）
- **工作目录**：`/home/mat/Projects/mathslot-next`，分支 `refactor/v1`
- **提交哈希**：`b2382281263482b47c4b548575d635cd2a6a0b6e` (`b238228`)
- **提交信息**：`T2.1: implement mathslot-app state machine with headless A-EDIT suite (defend D-001, D-004)`
- **验收目标**：针对 Gate G2 首个核心任务 `T2.1`（实现 `mathslot-app` 纯领域状态机：Event→Command→Effect，无 UI/IO 依赖，A-EDIT 场景全过，防范并固化 D-001/D-004）执行独立证据复核验收。
- **综合裁定**：**PASS**

---

## 1. 结论

**PASS**。
本次改动围绕 Gate G2 核心任务 `T2.1` 完整实现了纯领域应用层核心 `crates/mathslot-app`。独立复核确认：

1. **架构纯净性与领域隔离（INV-016）**：
   - `crates/mathslot-app/Cargo.toml` 仅依赖内部纯领域 crates (`mathslot-doc`, `mathslot-syntax`, `mathslot-command`) 以及 `serde`, `thiserror`；
   - **绝对零 UI 库依赖**：未引入 `egui`, `eframe`, `web-sys`, `js-sys`, DOM, `tiny-skia` 等任何前端或图形库；
   - **绝对零直接网络/文件系统 IO**：未引入 `reqwest`, `hyper`, `tokio`，源码中零 `std::fs` 与零 `std::net`；
   - 根模块明确声明 `#![forbid(unsafe_code)]`，保障内存安全。
2. **纯函数式状态机驱动（Event → Command → Effect）**：
   - 实现了纯数据输入事件 `AppEvent`、纯内部命令 `AppCommand`、确定性副作用流 `Effect` 与高层状态枚举 `EditorState`；
   - `App::dispatch` / `App::handle_event` 遵循确定性流水线：事件到内部命令解析 → 领域命令执行与状态同步 → 确定性发射 `Status` → `Render` → `Focus` → `Host Effects` (Clipboard / ExportResult)。
3. **Headless A-EDIT 测试套件全面覆盖（A-EDIT-001 ~ A-EDIT-008）**：
   - 在 `crates/mathslot-app/tests/app_state_machine_tests.rs` 中实现了 10 项严密单测；
   - 覆盖规范 §7.4 定义的全部 8 大编辑用例，全部通过，零弱化、零恒真断言；
   - 牢固防范并防御 P1 缺陷 `D-001`（调色板“偏导”卡片必须插入 `\partial`，绝不插入 `\to`）与 `D-004`（未决命令复制带显式占位符，不返回空串；严格导出阻断返回诊断）。
4. **硬规则红线 100% 遵守**：
   - **零新增 `let _ =`**：`git diff HEAD~1 HEAD | grep "^+.*let _ ="` 输出为空（退出码 1）；
   - **零新增 `#[allow]`**：`git diff HEAD~1 HEAD | grep -E "^\+.*#\[allow"` 输出为空（退出码 1）；
   - **零用户路径 `unwrap()`**：状态机业务路径中零直接 `.unwrap()`（仅使用防御性 `unwrap_or('?')`）；
   - 变更范围严格限制在 `Cargo.toml`, `Cargo.lock`, `crates/mathslot-app/**`。
5. **全量门禁全绿**：
   - `cargo fmt --check`：exit 0；
   - `cargo clippy --workspace --all-targets -- -D warnings`：exit 0；
   - `cargo test --workspace`：exit 0（共 186 passed，4 ignored 为规范合规锁定的待后续 Gate/任务修复的 D-003/D-005 等，0 failed）；
   - `scripts/agent/acceptance.sh --fast`：exit 0, 结论 PASS；
   - `scripts/agent/acceptance.sh`（完整模式）：exit 0, 结论 PASS（PASS=4 FAIL=0 WARN=4）。

---

## 2. 命令与输出实录

### 2.1 Git 提交与变更范围核查

```bash
$ git log -1 --stat
commit b2382281263482b47c4b548575d635cd2a6a0b6e (HEAD -> refactor/v1)
Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
Date:   Sat Nov 14 00:10:50 2026 +0800

    T2.1: implement mathslot-app state machine with headless A-EDIT suite (defend D-001, D-004)

 Cargo.lock                                         |  11 +
 Cargo.toml                                         |   1 +
 crates/mathslot-app/Cargo.toml                     |  14 +
 crates/mathslot-app/src/app.rs                     | 440 +++++++++++++++++++++
 crates/mathslot-app/src/command.rs                 |  25 ++
 crates/mathslot-app/src/effect.rs                  |  39 ++
 crates/mathslot-app/src/event.rs                   |  62 +++
 crates/mathslot-app/src/lib.rs                     |  17 +
 crates/mathslot-app/src/state.rs                   |  23 ++
 .../mathslot-app/tests/app_state_machine_tests.rs  | 429 ++++++++++++++++++++
 10 files changed, 1061 insertions(+)
```

```bash
$ git diff HEAD~1 HEAD --name-status
M	Cargo.lock
M	Cargo.toml
A	crates/mathslot-app/Cargo.toml
A	crates/mathslot-app/src/app.rs
A	crates/mathslot-app/src/command.rs
A	crates/mathslot-app/src/effect.rs
A	crates/mathslot-app/src/event.rs
A	crates/mathslot-app/src/lib.rs
A	crates/mathslot-app/src/state.rs
A	crates/mathslot-app/tests/app_state_machine_tests.rs
```

- **退出码**：`0`
- **范围分析**：仅修改根 `Cargo.toml` / `Cargo.lock` 注册工作区成员，其余全部集中在 `crates/mathslot-app/**`，未触碰任何其他 crate 或产品旧代码。

### 2.2 禁止项扫描

```bash
$ git diff HEAD~1 HEAD | grep "^+.*let _ ="
# 退出码 1 (无匹配)

$ git diff HEAD~1 HEAD | grep -E "^\+.*#\[allow\("
# 退出码 1 (无匹配)

$ git diff HEAD~1 HEAD | grep -E "^\+.*#\[ignore"
# 退出码 1 (无匹配)

$ grep -rn "\.unwrap()" crates/mathslot-app/src/
# 退出码 1 (无匹配)
```

- **判定**：无新增 `let _ =`，无新增 `#[allow]`，无新增 `#[ignore]`，产品源码中零 `.unwrap()`。

### 2.3 架构纯净性与依赖分析

查看 `crates/mathslot-app/Cargo.toml`：
```toml
[package]
name = "mathslot-app"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true
description = "Pure headless state machine and event-command-effect core for MathSlot"

[dependencies]
mathslot-command = { path = "../mathslot-command" }
mathslot-doc = { path = "../mathslot-doc" }
mathslot-syntax = { path = "../mathslot-syntax" }
serde = { version = "1.0", features = ["derive"] }
thiserror = "2.0"
```

IO 扫描：
```bash
$ grep -rn "std::fs" crates/mathslot-app/ || true
$ grep -rn "std::net" crates/mathslot-app/ || true
# 退出码 0，两项均无输出
```

- **判定**：纯净无 GUI、无 DOM、无系统 IO，完全符合规范 §5.2、§5.3 与 INV-016。

### 2.4 mathslot-app 专项状态机测试

```bash
$ cargo test -p mathslot-app
    Finished `test` profile [optimized + debuginfo] target(s) in 0.23s
     Running unittests src/lib.rs (target/debug/deps/mathslot_app-b08903797ba11572)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/app_state_machine_tests.rs (target/debug/deps/app_state_machine_tests-f0dabb506e163cb0)

running 10 tests
test test_a_edit_001_stream_frac ... ok
test test_a_edit_002_pending_copy_export ... ok
test test_a_edit_003_unknown_command_diagnostic ... ok
test test_a_edit_004_partial_card ... ok
test test_a_edit_005_undo_separate_typing_and_card ... ok
test test_a_edit_006_paste_with_prefix ... ok
test test_a_edit_007_ime_composition_isolation ... ok
test test_effect_ordering_deterministic ... ok
test test_a_edit_008_navigation_mode_no_text_or_undo_change ... ok
test test_keys_actions_and_redo ... ok

test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests mathslot_app

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

- **退出码**：`0`
- **判定**：10 项用例全部成功通过，执行耗时 0.00s。

### 2.5 全量工作区门禁

#### 2.5.1 cargo fmt --check
```bash
$ cargo fmt --check
# 退出码 0
```

#### 2.5.2 cargo clippy --workspace --all-targets -- -D warnings
```bash
$ cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.50s
# 退出码 0
```

#### 2.5.3 cargo test --workspace
```bash
$ cargo test --workspace
    Finished `test` profile [optimized + debuginfo] target(s) in 0.30s
     Running unittests src/main.rs (target/debug/deps/mathslot-3d7e89bff4e84908)
...
test result: ok. 4 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.44s
...
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
...
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
...
test result: ok. 33 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
...
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
...
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```
- **退出码**：`0`
- **汇总**：全工作区累计 186 passed，0 failed，4 ignored（合规锁定的 D-003, D-005, D-006, D-007 回归测试）。

#### 2.5.4 scripts/agent/acceptance.sh --fast
```bash
$ scripts/agent/acceptance.sh --fast
== MathSlot 门禁（/home/mat/Projects/mathslot-next）==
时间：2026-11-14T01:31:27+08:00


结果 检查项                    说明
------ ---------------------------- ----
PASS   cargo fmt --check            exit 0
WARN   cargo clippy -D warnings     跳过（--fast）
PASS   cargo test --workspace       exit 0
PASS   调色板一致性           exit 0（gate=G2）
WARN   let _ = 计数               27 处（G4 前应清零）
WARN   unwrap() 计数              22 处（用户输入路径应为 0）
WARN   命令表常量              3 处（G1 后应只剩 catalog）
WARN   工作区未提交           2 个文件

PASS=3 FAIL=0 WARN=5
结论：PASS
```
- **退出码**：`0`

#### 2.5.5 scripts/agent/acceptance.sh（全量完整模式）
```bash
$ scripts/agent/acceptance.sh
== MathSlot 门禁（/home/mat/Projects/mathslot-next）==
时间：2026-11-14T01:32:57+08:00


结果 检查项                    说明
------ ---------------------------- ----
PASS   cargo fmt --check            exit 0
PASS   cargo clippy -D warnings     exit 0
PASS   cargo test --workspace       exit 0
PASS   调色板一致性           exit 0（gate=G2）
WARN   let _ = 计数               27 处（G4 前应清零）
WARN   unwrap() 计数              22 处（用户输入路径应为 0）
WARN   命令表常量              3 处（G1 后应只剩 catalog）
WARN   工作区未提交           2 个文件

PASS=4 FAIL=0 WARN=4
结论：PASS
```
- **退出码**：`0`

---

## 3. 逐项验收表（A-EDIT-001 ~ A-EDIT-008 & T2.1 退出条件）

| 验收 ID | 规范场景与期望 | 实测与断言证明 | 判定 |
|:---|:---|:---|:---:|
| **A-EDIT-001** | 输入 `▸f1;2;` -> 得到 `\frac{1}{2}`，无错误诊断 | `test_a_edit_001_stream_frac`：逐字符输入后 `to_latex()` 为 `\frac{1}{2}`，状态回退到 `Idle`，诊断零错误，发射包含 `\frac{1}{2}` 的 `Effect::Render` | **PASS** |
| **A-EDIT-002** | 输入 `▸m` 后复制 -> 有 Pending 诊断；导出被阻止或显式占位，不返回空串 (防范 D-004) | `test_a_edit_002_pending_copy_export`：`has_pending_command()` 为真；`RequestCopy` 发射 `Effect::Clipboard` 内容包含 `▸m` 占位符且绝非空串；严格模式导出返回 `StrictExportBlocked` 错误诊断；非严格导出返回占位符与 Pending 诊断 | **PASS** |
| **A-EDIT-003** | 输入 `▸zz` -> 不静默变成 `z`；显示 Invalid/Unknown 诊断 (防范 D-004) | `test_a_edit_003_unknown_command_diagnostic`：`to_latex()` 绝不退化为普通字母 `"z"`，包含占位符 `▸zz`；记录 `Diagnostic::UnknownCommand`；副作用包含 Warning/Error 状态及带诊断的 Render | **PASS** |
| **A-EDIT-004** | 点击“偏导”卡片 -> 插入 `\partial`，不是 `\to` (防范 D-001) | `test_a_edit_004_partial_card`：`AppEvent::PaletteCard("partial")` 执行后 `to_latex()` 包含 `\partial` 且绝无 `\to`；发射 `Effect::Render`；撤销栈记录意图为 `Intent::PaletteCard` | **PASS** |
| **A-EDIT-005** | 点击卡片后立即输入 -> Ctrl+Z 先撤销输入，再撤销卡片；不合并 | `test_a_edit_005_undo_separate_typing_and_card`：卡片点击与键入 `'x'` 分别产生独立的 Undo 事务（撤销栈长度为 2）；第 1 次 Undo 仅移除 `'x'` 保留 `\partial`；第 2 次 Undo 移除 `\partial` | **PASS** |
| **A-EDIT-006** | 粘贴含 `▸` 文本 -> 原样插入，不执行命令 | `test_a_edit_006_paste_with_prefix`：`AppEvent::Paste("▸f1;2;")` 被原样插入为纯文本字面量（包含 `▸f1;2;`），绝不展开为 `\frac{1}{2}`；状态机保持 `Idle`；事务记录为 `Intent::Paste` | **PASS** |
| **A-EDIT-007** | 中文 IME 输入 -> 组合期间不丢字、不跳光标，提交后单事务撤销 | `test_a_edit_007_ime_composition_isolation`：`ImeCompositionUpdate` 期间撤销栈不增长；`ImeCompositionCommit("中文")` 生成恰好 1 笔 `Intent::ImeCommit` 事务；单次 Undo 完整回滚中文输入 | **PASS** |
| **A-EDIT-008** | 导航模式按字母 -> 光标跳转；文本与 undo 不变 | `test_a_edit_008_navigation_mode_no_text_or_undo_change`：在 `\frac{a}{b}` 中进入导航模式；按 `'j'` / `'k'` 仅切换槽位光标并触发 `Effect::Focus`，文档文本不变，撤销栈长度不变；按非导航键静默忽略；退出后恢复打字与 Undo 记录 | **PASS** |
| **T2.1 退出** | 实现 `mathslot-app` 状态机 (Event→Command→Effect，无 UI/IO 依赖，A-EDIT 全过) | 纯无头 crate 创建完毕，`crates/mathslot-app/Cargo.toml` 零 UI/IO 依赖；8 大 A-EDIT 测试全过；命令与副作用顺序确定 | **PASS** |

---

## 4. 不变量与架构约束核查

| 不变量 ID | 规范要求 | 实测核查结果 | 判定 |
|:---|:---|:---|:---:|
| **INV-001** | 全系统唯一 Parser + AST + LaTeX 生成器 | `mathslot-app` 直接复用 `mathslot-syntax` AST 与 `mathslot-doc` Document/Editor，未重复实现解析器与生成器 | **PASS** |
| **INV-002** | 任何输入节点不得在输出时静默消失 | 未决状态 `▸m` 与未知命令 `▸zz` 通过显式占位符包装输出，严禁吞没或退化 | **PASS** |
| **INV-006** | 命令/调色板单一事实源 | 卡片应用委托给 `mathslot-command` 权威目录检索，零硬编码命令表 | **PASS** |
| **INV-008** | 撤销与编辑严格按 Intent 分离 | 卡片操作 (`Intent::PaletteCard`)、普通输入 (`Intent::Typing`)、粘贴 (`Intent::Paste`)、IME (`Intent::ImeCommit`) 独立记账，不发生意图越界合并 | **PASS** |
| **INV-016** | 状态机绝对无头纯领域设计 | 零 UI 库依赖，零网络/文件系统 IO，纯函数式单测在微秒级完成 | **PASS** |

---

## 5. 未验证/后续风险提示

1. **后续任务 T2.2 (Intent 分组深化)**：
   - 本轮已在 `mathslot-app` 中打通了 `Intent` 在状态机层面的传递与分立断言；T2.2 将针对更复杂的批处理、选区替换以及卡片/输入边界分组展开更细粒度的 History 策略优化。
2. **待修复 P1 缺陷按计划推进**：
   - `D-003`（长公式预览裁切）归属于 T2.4 (`mathslot-render`)；
   - `D-005`（配置损坏安全与原子写）归属于 T2.3 (`mathslot-store`)；
   - `D-006`（公式 ID 碰撞）归属于 T2.3 (`mathslot-store`)；
   - `D-007`（LaTeX 导入结构保持）归属于 T4.1；
   - 上述用例在当前门禁中合规使用 `#[ignore]` 锁定，未影响主干门禁。

---

## 6. 最终裁定

**PASS**。
Round 13 (任务 T2.1: `implement mathslot-app state machine with headless A-EDIT suite`) 代码改动完全符合规范要求与架构红线。全量门禁全绿，A-EDIT-001 ~ A-EDIT-008 场景全部独立验证通过。同意签署本轮验收。

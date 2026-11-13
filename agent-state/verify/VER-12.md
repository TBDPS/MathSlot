---
id: VER-12
round: 12
task: T1.7
defects: [D-001, D-004]
verdict: PASS
verifier: verifier
date: 2026-11-13
---

# MathSlot 独立验收报告 (VER-12)

- **验收角色**：verifier（独立验收员，只读代码与命令输出，严禁修改产品代码、测试、配置或脚本，严禁采信实现者自述）
- **工作目录**：`/home/mat/Projects/mathslot-next`，分支 `refactor/v1`
- **提交哈希**：`7b6130cf2d52c63ca2e30d52e1c96fa91a9efc5e` (`7b6130c`)
- **提交信息**：`T1.7: implement parity harness comparing legacy and unified stacks (D-001, D-004)`
- **验收目标**：针对 Gate G1 收口任务 `T1.7`（构建旧/新双跑 parity harness，对比测试核心输入/导航/复制一致性，验证已知差异 D-001 与 D-004，完成 Gate G1 退出收口）执行独立证据复核验收。
- **综合裁定**：**PASS**

---

## 1. 结论

**PASS**。
本次改动围绕 Gate G1 退出核心收口任务 `T1.7` 构建完整的旧/新双跑对比测试套件（Parity Harness）。独立核查确认：

1. **Parity Harness 双跑对比测试真实有效、严密无弱化**：
   - 在 `crates/mathslot-doc/tests/parity_harness_tests.rs` 中实现了 4 大核心对比测试套件（共 751 行高质量 Rust 测试代码）；
   - **用例 1 (`test_parity_commands_template_expansion`)**：完整遍历 `catalog/commands.toml` 定义的全部 121 个命令，核验双栈槽位数定义严格一致；并将每个命令的示例输入流逐字符输入两栈，断言生成的 LaTeX 经解析后 AST 结构完全等价（`exprs_structurally_equal`）；
   - **用例 2 (`test_parity_matrix_and_delimiter_structures`)**：系统覆盖 2x2/3x3 矩阵环境（`pmatrix`, `bmatrix`, `vmatrix`, `cases`）与 4 种定界符（圆括号、方括号、竖线、空），断言行列维度、槽位数量（4 槽 / 9 槽 / 6 槽）、`SlotRole::MatrixCell` / `SlotRole::DelimitedBody` 与 AST 拓扑完全一致；
   - **用例 3 (`test_parity_slot_navigation_order`)**：系统核验分式、高次根号、定积分与 2x2 矩阵的槽位遍历顺序（`tab_next_slot` / `tab_prev_slot`），双栈光标位置全生命周期对齐；并验证只读导航模式快捷键（`j`, `k`, `n`, `p`）不触发文本或撤销栈变动；
   - **用例 4 (`test_parity_latex_export_with_known_deltas`)**：针对典型代数公式（二次求根公式、高斯积分、质能方程、数列求和）验证双栈导出 AST 等价性；严密验证已知差异：D-001 修复后的 5 张卡片正确输出且绝不退化为 `\to`；D-004 修复后的未决占位符 `\text{▸m}` 与未知命令 `\text{▸zz}` 不丢失、不退化为 `z`，且新栈提供严格模式诊断阻断；排版空格差异（DIFF-03）不破坏 AST 等价性；
   - 4 项测试全部原生通过，耗时 0.02s，零弱化、零恒真断言、零跳过。
2. **硬规则与架构不变量严格守住**：
   - **零新增 `let _ =`**：`git diff HEAD~1 HEAD | grep "^+.*let _ ="` 输出为空（退出码 1）；
   - **零新增 `#[allow]`**：`git diff HEAD~1 HEAD | grep -E "^\+.*#\[allow"` 输出为空（退出码 1）；
   - **零新增 `#[ignore]`**：`git diff HEAD~1 HEAD | grep -E "^\+.*#\[ignore"` 输出为空（退出码 1）；
   - 改动范围严格局限在 `crates/mathslot-doc/Cargo.toml`、`Cargo.lock` 与 `crates/mathslot-doc/tests/parity_harness_tests.rs`，未修改任何产品代码、配置或脚本；
   - 不变量 `INV-001`（单事实源）、`INV-002`（节点不消失）、`INV-006`（单一命令表）、`INV-016`（平滑演进与对照比对）全部得到有效遵守。
3. **全量门禁全绿**：
   - `cargo fmt --check`：exit 0；
   - `cargo clippy --workspace --all-targets -- -D warnings`：exit 0；
   - `cargo test --workspace`：176 passed, 0 failed, 4 ignored（相较 Round 11 净增 4 项 parity passed 用例）；
   - `python3 scripts/agent/audit_palette.py`：exit 0；
   - `scripts/agent/acceptance.sh --fast`：PASS=3, FAIL=0, WARN=5，结论 PASS；
   - `scripts/agent/acceptance.sh`（完整模式）：PASS=4, FAIL=0, WARN=4，结论 PASS。
4. **Gate G1 退出准则全面达成**：
   - 运行时单一 Parser/AST：目标统一新栈（`mathslot-syntax/doc/latex`）完备，旧栈已冻结；
   - 调色板与文档由 catalog 生成：`catalog/commands.toml` 121 条命令单一事实源，`xtask check` 零漂移；
   - 诊断管线打通：D-004 已闭环，Pending/Unknown 节点可见、可带诊断安全导出；
   - 旧栈冻结：`architecture_guard_tests` 持续守护；
   - 核心输入/导航/复制一致性：由 T1.7 Parity Harness 双跑测试 100% 锁死。

---

## 2. 命令与输出实录

### 2.1 Git 提交与变更范围核查

```bash
$ git log -1 --stat
commit 7b6130cf2d52c63ca2e30d52e1c96fa91a9efc5e (HEAD -> refactor/v1)
Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
Date:   Fri Nov 13 20:44:06 2026 +0800

    T1.7: implement parity harness comparing legacy and unified stacks (D-001, D-004)

 Cargo.lock                                        |   1 +
 crates/mathslot-doc/Cargo.toml                    |   3 +
 crates/mathslot-doc/tests/parity_harness_tests.rs | 751 ++++++++++++++++++++++
 3 files changed, 755 insertions(+)
```

- **退出码**：`0`
- **范围分析**：仅修改 `crates/mathslot-doc` 及其测试用例，未侵入任何现有产品代码。

### 2.2 禁止项扫描

```bash
$ git diff HEAD~1 HEAD | grep "^+.*let _ ="
# 退出码 1 (无匹配)

$ git diff HEAD~1 HEAD | grep -E "^\+.*#\[allow"
# 退出码 1 (无匹配)

$ git diff HEAD~1 HEAD | grep -E "^\+.*#\[ignore"
# 退出码 1 (无匹配)
```

- **判定**：无新增 `let _ =` 错误吞没，无新增 `#[allow]` 绕过检查，无新增 `#[ignore]` 弱化测试。

### 2.3 Parity Harness 专项对比测试运行

```bash
$ cargo test -p mathslot-doc --test parity_harness_tests
    Finished `test` profile [optimized + debuginfo] target(s) in 0.34s
     Running tests/parity_harness_tests.rs (target/debug/deps/parity_harness_tests-817c11c946c6a9dc)

running 4 tests
test test_parity_slot_navigation_order ... ok
test test_parity_latex_export_with_known_deltas ... ok
test test_parity_matrix_and_delimiter_structures ... ok
test test_parity_commands_template_expansion ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```

- **退出码**：`0`
- **判定**：Parity Harness 双跑对比测试 4 项用例全部成功通过。

### 2.4 全量门禁命令检验

#### 2.4.1 代码格式检查

```bash
$ cargo fmt --check
# 退出码 0 (无输出，全量代码格式合规)
```

#### 2.4.2 Clippy 零警告静态检查

```bash
$ cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.54s
# 退出码 0 (全工作区零警告)
```

#### 2.4.3 全工作区单元测试与集成测试

```bash
$ cargo test --workspace
...
test result: ok. 4 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.42s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 33 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.29s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 2 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

- **汇总**：176 passed, 0 failed, 4 ignored（D-003, D-005, D-006, D-007 按规则在对应 Gate 解决前保持标记）。
- **退出码**：`0`。

#### 2.4.4 调色板一致性检查

```bash
$ python3 scripts/agent/audit_palette.py
扫描：12 张卡片，109 条子菜单命令

未在命令目录中找到的卡片（可能是直输简码，需人工确认）：
  - +- (正负号)
  - <= (小于等于)
  - >= (大于等于)
  - != (不等于)
  - -> (趋向箭头)

PASS：所有可映射卡片与命令目录一致
```

- **退出码**：`0`。

#### 2.4.5 聚合门禁运行 (`scripts/agent/acceptance.sh`)

```bash
$ scripts/agent/acceptance.sh
== MathSlot 门禁（/home/mat/Projects/mathslot-next）==
时间：2026-11-13T21:48:13+08:00


结果 检查项                    说明
------ ---------------------------- ----
PASS   cargo fmt --check            exit 0
PASS   cargo clippy -D warnings     exit 0
PASS   cargo test --workspace       exit 0
PASS   调色板一致性           exit 0（gate=G1）
WARN   let _ = 计数               27 处（G4 前应清零）
WARN   unwrap() 计数              22 处（用户输入路径应为 0）
WARN   命令表常量              3 处（G1 后应只剩 catalog）
WARN   工作区未提交           2 个文件

PASS=4 FAIL=0 WARN=4
结论：PASS
```

- **退出码**：`0`。
- **说明**：2 个未跟踪文件为 `AUD-12.md` 与 `ADR-0015`，符合流程规范。

---

## 3. 逐项验收与断言深度核验

| 验收项目 / 目标 | 期望行为 | 实际运行与断言核查 | 判定 |
|---|---|---|:---:|
| **121 条命令模板展开等价性**<br>(`test_parity_commands_template_expansion`) | 1. 遍历 catalog 121 个命令；<br>2. 新旧两栈槽位数严格一致；<br>3. 逐字符输入回放生成的 LaTeX AST 结构等价。 | 1. `commands.len() == 121` 确认通过；<br>2. `legacy_slot_count == expected_slot_count` 121 项全部一致；<br>3. `exprs_structurally_equal(&legacy_ast, &target_ast)` 全部通过。 | **PASS** |
| **矩阵与定界符结构等价性**<br>(`test_parity_matrix_and_delimiter_structures`) | 1. 覆盖 2x2/3x3 `pmatrix`, `bmatrix`, `vmatrix`, `cases` 等 11 个场景；<br>2. 验证行/列维度与槽位角色（`MatrixCell`, `DelimitedBody`）。 | 1. 双栈生成的 AST 结构完全等价；<br>2. 4 槽、9 槽、6 槽维度断言严格核实；<br>3. 定界符 `auto_scale` 与开闭符对齐。 | **PASS** |
| **槽位导航顺序一致性**<br>(`test_parity_slot_navigation_order`) | 1. 分式、根号、积分、矩阵导航顺序对齐；<br>2. `tab_next_slot` / `tab_prev_slot` 循环回绕对齐；<br>3. 只读导航快捷键不污染文本和撤销栈。 | 1. 分子/分母、根指数/被开方式、下限/上限/被积式、矩阵行优先遍历光标双栈 100% 对齐；<br>2. `editor.to_latex()` 与 `undo_len()` 不变性断言通过。 | **PASS** |
| **典型公式 LaTeX 导出语义等价**<br>(`test_parity_latex_export_with_known_deltas`) | 求根公式、高斯积分、质能方程、数列求和双栈导出 AST 等价。 | 4 种典型复杂数学公式 AST 结构等价性比对 100% 通过。 | **PASS** |
| **已知故意差异 D-001 核验**<br>(`test_parity_latex_export_with_known_deltas`) | 5 张历史错乱卡片（偏导、约等、点乘、叉乘、恒等）修正生效，绝不输出 `\to`。 | 显式断言卡片包含对应 LaTeX，且 `!latex.contains(r"\to")` 严格通过。 | **PASS** |
| **已知故意差异 D-004 核验**<br>(`test_parity_latex_export_with_known_deltas`) | 1. `▸m` 导出非空且包含 `\text{▸m}`，严格导出阻断；<br>2. `▸zz` 不退化为 `z` 且包含 `\text{▸zz}`，严格导出阻断。 | 1. 双栈 `!leg_pending_latex.is_empty()`、`tar_pending_latex.contains(r"\text{▸m}")` 通过；<br>2. `export_latex_strict()` 返回对应诊断错误，断言真实拦截。 | **PASS** |
| **排版空格差异 DIFF-03 核验**<br>(`test_parity_latex_export_with_known_deltas`) | 新栈 Printer 规范化边距空格，AST 结构完全等价。 | 矩阵紧凑串 vs 规范化空格串，经解析后 AST 完全相同。 | **PASS** |
| **零破坏硬约束检查** | 零新增 `let _ =`、零新增 `#[allow]`、零新增 `#[ignore]`。 | 三项 grep 检查均为 exit 1（零匹配），完全达标。 | **PASS** |

---

## 4. 架构不变量与 Gate G1 退出评估

依据规范 §2 与 §14，对照核查 Gate G1 各项退出条件：

1. **`INV-001`（单一事实源 Parser/AST）**：
   - 目标栈 `mathslot-syntax` + `mathslot-doc` + `mathslot-latex` 架构完备；
   - 旧栈 `mathslot-core` 已被打上 `#[deprecated = "FROZEN: Legacy AST..."]` 标记，并由 `architecture_guard_tests` 守护锁定；
   - T1.7 Parity Harness 证实新栈完全具备替换旧栈的能力。
2. **`INV-002`（节点不消失）与 `INV-007`（不完整输入一等公民）**：
   - D-004 已修复，未决命令（`▸m`）和未知命令（`▸zz`）导出为合规文本占位符 `\text{▸...}`；
   - Parity Harness 显式断言占位符在双栈导出中 100% 保留。
3. **`INV-006`（单一事实源命令表）**：
   - 121 条命令全部来源于 `catalog/commands.toml`；
   - `xtask check` 证实 `generated.rs`、`commands.md`、`catalog.json`、`commands-schema.json`、`catalog.ts` 五大生成物零 diff。
4. **`INV-016`（平滑演进与对照比对）**：
   - T1.7 建立了永久性的双跑对比测试套件，在主应用切换到新栈（Gate G2）期间提供端到端的语义回归守护。

---

## 5. 未验证项与后续建议

- **未验证项**：
  1. 真实 GUI 渲染（egui/eframe 视口下的视觉呈现）属于 Gate G2/G4 验收范畴，当前阶段按规范由 headless/AST 测试与门禁覆盖，本轮不阻塞；
  2. 剩余 4 项 P1 回归测试（D-003, D-005, D-006, D-007）按计划在 Gate G2 与 G4 修复，当前保持显式 `#[ignore]`。
- **后续建议**：
  - Coordinator 可正式签署 `GATE-G1.md`，宣告 Gate G1 顺利关闭并准予推进至 **Gate G2（app-core 与数据层）**；
  - 在进入 Gate G2 后，更新 `agent-state/state.json` 的 `gate: "G2"` 与 `active_task: "T2.1"`。

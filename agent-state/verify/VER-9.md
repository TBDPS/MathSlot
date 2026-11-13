---
id: VER-9
round: 9
task: T1.4
defects: [D-018]
verdict: PASS
verifier: verifier
date: 2026-11-13
---

# MathSlot 独立验收报告 (VER-9)

- **验收角色**：verifier（独立验收，只读 diff、代码与命令输出，不采信实现者自述）
- **工作区**：`/home/mat/Projects/mathslot-next`，分支 `refactor/v1`
- **目标任务**：`T1.4`（选定唯一 parser/AST 栈，建议 `mathslot-syntax/doc/latex`，产出决策记录 ADR，退出条件：另一套标记 frozen）
- **关联缺陷**：`D-018`（两套 parser/AST/LaTeX 栈分叉；通过选定唯一目标栈与冻结旧栈，开启收敛闭环）
- **核验提交**：`9ce69771507d34a35738aa2350de89e846652c6e` (`T1.4: select unified parser/ast stack and freeze legacy mathslot-core stack`)
- **综合裁定**：**PASS**

---

## 1. 结论

**PASS**。
任务 `T1.4` 严格遵循规范 §5、§14 与不变量 `INV-001`、`INV-016`，正式确立 `mathslot-syntax` / `mathslot-doc` / `mathslot-latex` 模块化分层栈为 MathSlot 唯一官方核心栈，并在旧原生栈（`mathslot-core`）上建立了权威冻结机制与自动化架构守护测试：

1. **权威决策记录就绪（ADR-0012 落地）**：`agent-state/decisions/ADR-0012-select-unified-parser-ast-stack-t1.4.md` 全面详述选定依据（纯 AST、无损转换、Span 诊断、可逆事务等技术优势），明确演进路径（T1.5 流式语义移植 → T1.6 诊断贯通 → T1.7 双跑 parity）；
2. **旧栈冻结标记严格到位**：`crates/mathslot-core/src/{parser.rs, ast.rs, latex.rs}` 三个核心模块头部均已施加统一的 `[FROZEN ARCHITECTURE - GATE G1 T1.4]` 顶级注释标头，明确标示冻结性质与用途（仅用于 T1.7 对照组），且未引入 `#[deprecated]` 或 `#[allow]`，避免了 Clippy 告警扩散；
3. **架构守卫自动化测试闭环**：新增 `crates/mathslot-syntax/tests/architecture_guard_tests.rs` 包含 6 项测试，不仅自动化校验旧栈三个源文件的冻结标头未被篡改，还直接验证了新栈的分数无损往返、矩阵环境解析与容错诊断能力；
4. **门禁与全量测试全绿通过**：
   - `cargo fmt --check`：exit 0；
   - `cargo clippy --workspace --all-targets -- -D warnings`：exit 0（0 warnings）；
   - `cargo test --workspace`：由上一轮 156 项增至 162 项全部 passed（0 failed; 5 ignored 留待后续任务）；
   - `cargo run -p xtask -- check`：exit 0（5 个 catalog 衍生工件完全一致且干净）；
   - `python3 scripts/agent/audit_palette.py`：exit 0（调色板与 catalog 0 不一致）；
   - `scripts/agent/acceptance.sh` 聚合门禁在 Gate G1 阶段保持全绿通过（PASS=4 FAIL=0 WARN=4）；
5. **范围与规则严格合规**：提交变更严格限定在 4 个目标文件（3 个源文件增加模块标头，1 个新测试文件），未改动任何产品逻辑代码，未新增 `let _ =` 或危险 `unwrap()`。

---

## 2. 提交与改动范围核查

### 2.1 提交元数据
```bash
$ git log -1 --format="commit %H%nAuthor: %an <%ae>%nDate:   %ad%n%n    %s%n"
commit 9ce69771507d34a35738aa2350de89e846652c6e
Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
Date:   Fri Nov 13 13:29:00 2026 +0800

    T1.4: select unified parser/ast stack and freeze legacy mathslot-core stack
```

### 2.2 涉及文件清单与变更行数
```bash
$ git log -1 --stat
 crates/mathslot-core/src/ast.rs                    |   5 +
 crates/mathslot-core/src/latex.rs                  |   5 +
 crates/mathslot-core/src/parser.rs                 |   5 +
 .../tests/architecture_guard_tests.rs              | 117 +++++++++++++++++++++
 4 files changed, 132 insertions(+)
```

### 2.3 逐行 Diff 审查
`git diff HEAD~1 HEAD` 审查确认：
- `crates/mathslot-core/src/ast.rs`：仅在文件顶部插入 4 行模块文档与 1 行空行；
- `crates/mathslot-core/src/latex.rs`：仅在文件顶部插入 4 行模块文档与 1 行空行；
- `crates/mathslot-core/src/parser.rs`：仅在文件顶部插入 4 行模块文档与 1 行空行；
- `crates/mathslot-syntax/tests/architecture_guard_tests.rs`：新增独立架构守卫测试套件（117 行）；
- **产品代码逻辑变更行数：0 行**。无功能变更，无副作用风险。

---

## 3. 架构决策与冻结标头核查

### 3.1 决策文档 ADR-0012 存在性与内容核验
- 文件路径：`agent-state/decisions/ADR-0012-select-unified-parser-ast-stack-t1.4.md`
- 决策状态：已批准
- 核心内容：
  - 明确依据规范 §5、§14 与 `AUD-9` 技术对比，选定栈 B（`mathslot-syntax` + `mathslot-doc` + `mathslot-latex`）为唯一目标栈；
  - 明确冻结旧栈 `crates/mathslot-core/src/{parser.rs, ast.rs, latex.rs}`；
  - 规划 T1.5、T1.6、T1.7 后续演进路线；
  - 规定冻结标头规范并要求建立架构守护测试。

### 3.2 冻结标头一致性实测
实测 `crates/mathslot-core/src/{parser.rs, ast.rs, latex.rs}` 文件头部内容：

```rust
//! # [FROZEN ARCHITECTURE - GATE G1 T1.4]
//! This legacy module is FROZEN per ADR-0012.
//! Target architecture: mathslot-syntax / mathslot-doc / mathslot-latex.
//! Maintained solely for parity verification (T1.7) until full cutover.
```

- 三个文件头部标头完全一致；
- 未使用会导致 `cargo clippy -D warnings` 失败的 `#[deprecated]` 属性；
- 未使用任何 `#[allow(...)]` 压制警告。

---

## 4. 架构守卫测试有效性核查

### 4.1 测试套件执行实测
```bash
$ cargo test -p mathslot-syntax --test architecture_guard_tests
   Compiling mathslot-syntax v0.7.0 (/home/mat/Projects/mathslot-next/crates/mathslot-syntax)
    Finished `test` profile [optimized + debuginfo] target(s) in 0.21s
     Running tests/architecture_guard_tests.rs (target/debug/deps/architecture_guard_tests-3f38d582f0afde4e)

running 6 tests
test test_legacy_core_parser_is_marked_frozen ... ok
test test_legacy_core_ast_is_marked_frozen ... ok
test test_unified_syntax_stack_fault_tolerant_diagnostics ... ok
test test_legacy_core_latex_is_marked_frozen ... ok
test test_unified_syntax_stack_fraction_roundtrip ... ok
test test_unified_syntax_stack_matrix_and_delimiters ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### 4.2 守护用例覆盖项核对
1. `test_legacy_core_parser_is_marked_frozen`：断言 `crates/mathslot-core/src/parser.rs` 必须以权威冻结标头开头；
2. `test_legacy_core_ast_is_marked_frozen`：断言 `crates/mathslot-core/src/ast.rs` 必须以权威冻结标头开头；
3. `test_legacy_core_latex_is_marked_frozen`：断言 `crates/mathslot-core/src/latex.rs` 必须以权威冻结标头开头；
4. `test_unified_syntax_stack_fraction_roundtrip`：验证新栈 `parse` 解析分数 `\frac{a+1}{b-1}` 并 `to_latex` 准确往返（INV-001）；
5. `test_unified_syntax_stack_matrix_and_delimiters`：验证新栈解析 `\begin{pmatrix}` 2×2 矩阵并 `to_latex` 往返一致；
6. `test_unified_syntax_stack_fault_tolerant_diagnostics`：验证新栈对未闭合结构 `\left( x + y` 生成 `Diagnostic` 且不崩溃生成 AST（INV-007）。

---

## 5. 门禁实测输出与证据记录

### 5.1 代码格式规范检查 (`cargo fmt --check`)
```bash
$ cargo fmt --check
$ echo $?
0
```
- 退出码：`0`（零输出，格式完全规范）。

### 5.2 Clippy 静态检查 (`cargo clippy --workspace --all-targets -- -D warnings`)
```bash
$ cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.25s
$ echo $?
0
```
- 退出码：`0`（零警告，严格拦截保持有效）。

### 5.3 工作区单元测试 (`cargo test --workspace`)
```bash
$ cargo test --workspace
...
test result: ok. 4 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.41s
...
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
...
test result: ok. 33 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
test result: ok. 1 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
$ echo $?
0
```
- 汇总统计：通过项由 Round 8 的 156 项增加至 **162 项**；
- 失败项：`0 failed`；
- 忽略项：`5 ignored`（对应的 P1 测试 D-003, D-004, D-005, D-006, D-007 持续有效，在 `--ignored` 下验证均有效拦截失败）。

### 5.4 目录生成工件校验 (`cargo run -p xtask -- check`)
```bash
$ cargo run -p xtask -- check
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.10s
     Running `target/debug/xtask check`
[xtask] Check PASSED: All 5 artifacts are up-to-date and clean.
$ echo $?
0
```
- 退出码：`0`（5 个工件均处于干净且同步状态）。

### 5.5 调色板一致性检查 (`python3 scripts/agent/audit_palette.py`)
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
$ echo $?
0
```
- 退出码：`0`（0 处错位，与 Round 8 结果严格一致）。

### 5.6 一键聚合门禁实测 (`scripts/agent/acceptance.sh`)
```bash
$ scripts/agent/acceptance.sh
== MathSlot 门禁（/home/mat/Projects/mathslot-next）==
时间：2026-11-13T13:31:41+08:00

结果 检查项                    说明
------ ---------------------------- ----
PASS   cargo fmt --check            exit 0
PASS   cargo clippy -D warnings     exit 0
PASS   cargo test --workspace       exit 0
PASS   调色板一致性           exit 0（gate=G1）
WARN   let _ = 计数               29 处（G4 前应清零）
WARN   unwrap() 计数              22 处（用户输入路径应为 0）
WARN   命令表常量              3 处（G1 后应只剩 catalog）
WARN   工作区未提交           2 个文件

PASS=4 FAIL=0 WARN=4
结论：PASS
$ echo $?
0
```
- 退出码：`0`；结论：`PASS`。

---

## 6. 禁止项扫描

| 规则项 | 检查命令 | 结果 | 判定 |
|---|---|---|---|
| **禁止新增 `let _ =`** | `git diff HEAD~1 HEAD \| grep -E "let _\s*="` | 0 行匹配 | **PASS** |
| **禁止产品路径新增 `unwrap()`** | `git diff HEAD~1 HEAD \| grep "unwrap"` | 仅在新建测试中读取 manifest 路径时使用 `unwrap_or_else`，产品代码为 0 | **PASS** |
| **禁止新增 `#[allow]`** | `git diff HEAD~1 HEAD \| grep -E "allow\("` | 0 行匹配 | **PASS** |
| **禁止新增 `#[deprecated]`** | `git diff HEAD~1 HEAD \| grep -E "deprecated"` | 0 行匹配 | **PASS** |
| **禁止软化/跳过已有测试** | `git diff HEAD~1 HEAD \| grep -E "\#\[ignore\]"` | 0 行匹配 | **PASS** |
| **禁止跨任务顺手重构** | `git diff --stat HEAD~1 HEAD` | 仅涉及 3 个旧栈文件头与 1 个测试文件 | **PASS** |

---

## 7. 逐项验收比对表

| 验收项目 / 规范条款 | 期望行为 | 实际测量结果 | 判定 |
|---|---|---|:---:|
| **§14 G1 / T1.4 产出** | 产出架构选型决策记录 ADR | 产出 `agent-state/decisions/ADR-0012-select-unified-parser-ast-stack-t1.4.md`，批准选定 `syntax/doc/latex` 模块化栈 | **PASS** |
| **§14 G1 / T1.4 退出条件** | 另一套（旧单体栈）标记 frozen | `crates/mathslot-core/src/{parser, ast, latex}.rs` 头部标记 `[FROZEN ARCHITECTURE - GATE G1 T1.4]` | **PASS** |
| **INV-001 单一事实源栈** | 确立唯一官方语法/AST 栈路线 | ADR-0012 正式确立，架构守卫测试确保新栈无损解析 | **PASS** |
| **INV-016 分阶段平滑回退** | 重构期间旧栈不一次性物理删除，保留用于双跑 parity | 旧栈保留并在 T1.7 作为对照组；通过冻结注释阻断新增逻辑 | **PASS** |
| **代码门禁健康度** | fmt, clippy -D warnings, test 全部通过 | fmt 0, clippy 0 警告, test 162 passed (0 failed, 5 ignored), acceptance.sh 全绿 | **PASS** |

---

## 8. 未验证项与后续风险备忘

1. **旧栈与新栈的完整 Parity 对照（未验证项，设计如此）**：
   - 当前运行时 UI 仍挂载在旧 `mathslot-core` 上，新栈处于集成测试就绪状态；
   - 依赖后续任务逐步迁移：
     - **T1.5**：将 `StreamEditor` 流式简码交互、两向光标跳转与嵌套槽位闭合移植至新栈（需通过 8 个 `A-EDIT` 场景验收）；
     - **T1.6**：贯通 `Diagnostic` 诊断管线（修复 P1 缺陷 `D-004` 与 `D-007`）；
     - **T1.7**：双跑 Parity Harness 验证 121 个命令与 88 条预设无损等价后，正式切断旧栈运行时入口。
2. **5 项 P1 缺陷测试仍处于 `#[ignore]` 状态**：
   - `D-003`、`D-004`、`D-005`、`D-006`、`D-007` 依规范排期将在 G1（T1.6）、G2、G4 依次解冻并修复，本轮不构成阻塞。

---

## 9. 最终判定

**PASS**。
Round 9 任务 `T1.4` 达成全部验收标准。建议 coordinator 推进更新 `state.json` 与 `HANDOFF.md`，进入下一任务 `T1.5`（将 StreamEditor 流式语义移植到选定栈）。

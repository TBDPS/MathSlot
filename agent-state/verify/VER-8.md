---
id: VER-8
round: 8
task: T1.3
defects: [D-001, D-002]
verdict: PASS
verifier: verifier
date: 2026-11-13
---

# MathSlot 独立验收报告 (VER-8)

- **验收角色**：verifier（独立验收，只读 diff、代码与命令输出，不采信实现者自述）
- **工作区**：`/home/mat/Projects/mathslot-next`，分支 `refactor/v1`
- **目标任务**：`T1.3`（用 catalog 修 D-001/D-002，产出调色板/文档，退出条件：5 张卡片正确；文档 code 全可解析）
- **关联缺陷**：`D-001`（调色板 5 张卡片简码错位）、`D-002`（README/HELP 文档手写命令漂移）
- **核验提交**：`c9c9d04c8a1a17a866a9a810f0270e9eb19f1591` (`T1.3: fix palette tiles D-001 and docs drift D-002 with catalog`)
- **综合裁定**：**PASS**

---

## 1. 结论

**PASS**。
任务 `T1.3` 依据单一事实源 `catalog/commands.toml` 与内核命令目录，成功修复调色板 5 张错位卡片（D-001）与公开文档命令漂移（D-002），同时解除两项关键回归测试的冻结状态。全量门禁在 Gate G1 阶段首次达成全绿通过：
1. **调色板 5 张卡片纠偏完全到位（D-001 关闭）**：`src/app.rs` 中偏导（`oc` / `∂`）、约等（`xb` / `≈`）、点乘（`og` / `·`）、叉乘（`of` / `×`）、恒等（`xa` / `≡`）5 张卡片与内核目录完全对称；`python3 scripts/agent/audit_palette.py` 退出码 0，报 0 处不一致；
2. **文档命令漂移彻底消除（D-002 关闭）**：`README.md` 与 `HELP.md` 中历史遗留的幻影简码（`▸ch`、`▸cj`、`▸oq`）全部清除，修正为合法标准简码（`▸ci` 全导分式、`▸ak` 下花括号、`▸op` 垂直、`▸oo` 平行、`▸qn` 复数集、`▸qm` 差集），全部在 catalog 中合法存在且均可正常解析；
3. **回归测试解冻且真实通过**：`src/p1_regression_tests.rs`（`test_p1_d001`）与 `crates/mathslot-core/tests/p1_regression_tests.rs`（`test_p1_d002`）移除 `#[ignore]` 标注，测试实测真实通过（并增加了对幻影简码未污染 catalog 的负向断言）；
4. **门禁与基线表现优秀**：`cargo fmt --check` 退出码 0；`cargo clippy -D warnings` 零警告退出码 0；全工作区测试由 154 项增加至 156 项通过（0 failed; 5 ignored）；`cargo run -p xtask -- check` 退出码 0；`scripts/agent/acceptance.sh` 聚合门禁在 G1 阶段全绿 PASS（0 FAIL）。
5. **范围严格合规**：提交改动文件严格限制在 ADR-0011 授权的 5 个文件路径内，未侵入敏感目录，无任何多余重构。

---

## 2. 提交与改动范围核查

### 2.1 提交元数据
```bash
$ git log -1 --format="commit %H%nAuthor: %an <%ae>%nDate:   %ad%n%n    %s%n"
commit c9c9d04c8a1a17a866a9a810f0270e9eb19f1591
Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
Date:   Fri Nov 13 12:58:21 2026 +0800

    T1.3: fix palette tiles D-001 and docs drift D-002 with catalog
```

### 2.2 涉及文件清单与路径合规性
实测 `git show --stat --name-only c9c9d04` 输出：
1. `HELP.md`（修正公开帮助手册中的简码漂移与说明）
2. `README.md`（修正项目说明中的简码示例）
3. `crates/mathslot-core/tests/p1_regression_tests.rs`（解冻并强化 D-002 语义与负向回归测试）
4. `src/app.rs`（提取 `common_symbol_tiles` 并纠偏 5 张卡片定义）
5. `src/p1_regression_tests.rs`（解冻 D-001 调色板一致性测试）

**合规性核验**：
- 改动文件数量：共 5 个文件；
- 所有 5 个文件与 `ADR-0011` §2.4 授权白名单完全一致；
- 未修改任何内核数据结构、Parser 核心逻辑或工具链脚本；
- 未侵入只读镜像或历史归档目录。

---

## 3. 调色板一致性核查与 D-001 验收

### 3.1 调色板审计脚本实测 (`scripts/agent/audit_palette.py`)
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
- 退出码严格为 `0`；
- 所有 7 张可映射卡片与命令目录定义 100% 对齐（其余 5 张为直输简码）；
- 历史输出中报错的 5 张卡片不一致问题已全部清零。

### 3.2 5 张错位卡片纠偏核对表
根据 `src/app.rs` 与 `catalog/commands.toml` 进行点对点核查：

| 卡片名称 | 修复前错位配置 | 修复后权威配置 (`src/app.rs`) | Catalog 定义 (`catalog/commands.toml`) | 状态 |
|---|---|---|---|---|
| **偏导** | `badge: "ob"`, `glyph: "∂"`, `code: "ob"` | `badge: "oc"`, `glyph: "∂"`, `code: "oc"`, `hover: "偏导算子 \\partial (Tab o c)"` | `id = "partial"`, `keys = ["o", "c"]`, `latex = "\\partial"` | **对齐** |
| **约等于** | `badge: "xa"`, `glyph: "≈"`, `code: "xa"` | `badge: "xb"`, `glyph: "≈"`, `code: "xb"`, `hover: "约等于 \\approx (Tab x b)"` | `id = "approx"`, `keys = ["x", "b"]`, `latex = "\\approx"` | **对齐** |
| **点乘** | `badge: "oe"`, `glyph: "·"`, `code: "oe"` | `badge: "og"`, `glyph: "·"`, `code: "og"`, `hover: "点乘 \\cdot (Tab o g)"` | `id = "cdot"`, `keys = ["o", "g"]`, `latex = "\\cdot"` | **对齐** |
| **叉乘** | `badge: "od"`, `glyph: "×"`, `code: "od"` | `badge: "of"`, `glyph: "×"`, `code: "of"`, `hover: "叉乘 \\times (Tab o f)"` | `id = "times"`, `keys = ["o", "f"]`, `latex = "\\times"` | **对齐** |
| **恒等于** | `badge: "xb"`, `glyph: "≡"`, `code: "xb"` | `badge: "xa"`, `glyph: "≡"`, `code: "xa"`, `hover: "恒等于 \\equiv (Tab x a)"` | `id = "equiv"`, `keys = ["x", "a"]`, `latex = "\\equiv"` | **对齐** |

### 3.3 D-001 专项测试解冻与运行实测
```bash
$ cargo test -p mathslot test_p1_d001
    Finished `test` profile [optimized + debuginfo] target(s) in 0.08s
     Running unittests src/main.rs (target/debug/deps/mathslot-2133d427977f3270)

running 1 test
test p1_regression_tests::test_p1_d001_palette_tiles_strictly_match_command_catalog ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.00s
$ echo $?
0
```
- `src/p1_regression_tests.rs` 中的 `#[ignore]` 已移除；
- 该测试直接验证 `crate::app::common_symbol_tiles()` 与 `mathslot_core::command::lookup_sub_command` 的双向映射，测试实测通过。

---

## 4. 文档命令一致性核查与 D-002 验收

### 4.1 幻影简码消除与合法性穿透核查
对 `README.md` 与 `HELP.md` 进行全量穿透扫描：
- 历史幻影简码 `▸ch`（全导分式错误码）、`▸cj`（下大括号错误码）、`▸oq`（垂直错误码）在文档中出现次数为 **0**；
- 修正后的合法简码 `▸ci`、`▸ak`、`▸op`、`▸oo`、`▸qn`、`▸qm` 在文档中完整且正确标注：
  - `▸ci`：全导分式 $\frac{\mathrm{d} y}{\mathrm{d} x}$
  - `▸ak`：下花括号 $\underbrace{x+y}_{\text{标记}}$（对应上花括号 `▸aj`）
  - `▸op`：垂直关系 $\perp$（亦可直输 `_|_`）
  - `▸oo`：平行关系 $\parallel$（亦可直输 `||`）
  - `▸qn`：复数集合 $\mathbb{C}$
  - `▸qm`：集合差 $\setminus$
- 经与 `catalog/catalog.json` 121 项命令比对，文档各节涉及的 2 字符命令全部属于 catalog 合法命令（其余 `▸ka..▸kz` 为片段库机制说明，`▸jcb` 为多级跳转演示，均属合规说明）。

### 4.2 D-002 专项测试解冻与运行实测
```bash
$ cargo test -p mathslot-core test_p1_d002
    Finished `test` profile [optimized + debuginfo] target(s) in 0.07s
...
     Running tests/p1_regression_tests.rs (target/debug/deps/p1_regression_tests-f002a08ef29c7803)

running 1 test
test test_p1_d002_documented_commands_exist_and_match_semantics ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
$ echo $?
0
```
- `crates/mathslot-core/tests/p1_regression_tests.rs` 中的 `#[ignore]` 已移除；
- 包含了对 6 个更正命令的真实语义断言；
- 额外包含 3 项负向断言：确认 `ch`、`cj`、`oq` 在命令目录中返回 `None`，防止幻影命令污染代码库。测试实测通过。

---

## 5. 门禁与命令实测证据

### 5.1 代码格式规范检查 (`cargo fmt --check`)
```bash
$ cargo fmt --check
$ echo $?
0
```
格式无任何 diff，规范检查通过。

### 5.2 编译器静态检查 (`cargo clippy`)
```bash
$ cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.23s
$ echo $?
0
```
全工作区全 target 零警告，完全通过。

### 5.3 自动化测试全量套件 (`cargo test --workspace`)
```bash
$ cargo test --workspace
...
test result: ok. 4 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.43s (mathslot bin)
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s (catalog_tests)
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s (codegen_tests)
test result: ok. 33 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s (mathslot_core unit)
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (round11_comp)
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (acceptance)
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (extreme)
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (facade)
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (fault_inj)
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (round10)
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (round11)
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (round12)
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (round7)
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (round9)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (preset)
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s (overhaul)
test result: ok. 1 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 0.00s (p1_regression)
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (session)
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (doc)
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (latex)
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s (syntax golden)
$ echo $?
0
```
**测试统计分析**：
- **总通过数（passed）**：`156`（较上一轮 154 项净增 2 项，来自于 `test_p1_d001` 与 `test_p1_d002` 解冻）；
- **失败数（failed）**：`0`；
- **忽略数（ignored）**：`5`（由 7 项降为 5 项，剩余 5 项为待后续任务修复的 P1 缺陷：D-003、D-004、D-005、D-006、D-007）。

### 5.4 代码生成一致性检查 (`cargo run -p xtask -- check`)
```bash
$ cargo run -p xtask -- check
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.08s
     Running `target/debug/xtask check`
[xtask] Check PASSED: All 5 artifacts are up-to-date and clean.
$ echo $?
0
```
确认 catalog 生成的 5 大产物（`generated.rs`、`catalog.json`、`docs/commands.md`、`catalog.ts`、`commands.schema.json`）均与事实源完全保持同步。

### 5.5 聚合门禁检查 (`scripts/agent/acceptance.sh`)
```bash
$ scripts/agent/acceptance.sh
== MathSlot 门禁（/home/mat/Projects/mathslot-next）==
时间：2026-11-13T13:05:00+08:00


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
在 Gate G1 阶段，调色板一致性检查正式纳入判定并成功取得 `PASS`，整个聚合门禁达到全绿 `PASS`（FAIL=0）。

---

## 6. 逐项验收与判定

| 验收项 / 规范依据 | 验收要求 | 实际测试结果 | 判定 |
|---|---|---|---|
| **§14 G1 / T1.3** | 调色板 5 张卡片正确 | 偏导(`oc`), 约等(`xb`), 点乘(`og`), 叉乘(`of`), 恒等(`xa`) 与 catalog 一致，`audit_palette.py` exit 0 | **PASS** |
| **§14 G1 / T1.3** | 文档 code 全可解析 | README 与 HELP 中 `▸ch/cj/oq` 消除，所有 `▸xx` 均在 catalog 中合法存在且可解析 | **PASS** |
| **缺陷 D-001** | 调色板 5 卡片 code 错误 | `test_p1_d001` 解冻运行通过，`audit_palette.py` 退出码 0，报 0 处不一致 | **PASS (关闭)** |
| **缺陷 D-002** | README/HELP 命令漂移 | `test_p1_d002` 解冻运行通过，涵盖 6 项正向及 3 项负向断言 | **PASS (关闭)** |
| **INV-001** | 命令目录为唯一事实源 | 调色板与文档严格对齐 catalog 定义，未造第二套命令表 | **PASS** |
| **规则 3 & 4** | 一轮一任务，测试先失败后通过 | T1.3 提交对应 D-001/D-002，历史回归测试在 T0.3 建立且原为失败，现真实通过 | **PASS** |
| **规则 7** | 不得删测试/放宽 lint 换绿 | diff 中仅移除 2 处 `#[ignore]`，未新增任何 `#[allow]`，测试通过数增加 2 项 | **PASS** |
| **规则 2 & 路径合规** | 仅修改 ADR-0011 白名单文件 | 提交仅涉及 5 个文件，与 ADR-0011 完全一致，无敏感目录侵入 | **PASS** |

---

## 7. 未验证项与已知风险

1. **GUI 调色板点击交互与真实渲染验证（不阻塞 G1）**：
   当前通过 `Tile` 元数据、`audit_palette.py` 以及核心命令目录绑定对 5 张卡片做了语义级验证；egui 真实界面卡片点击与像素级渲染截图属于 G4 阶段端到端回归项（A-UI-*）。
2. **剩余 5 项 P1 缺陷仍然保持冻结**：
   - `D-003`：长公式预览两端裁切（待 G4 / T4.*）
   - `D-004`：Pending/Unknown 节点导出为空串（待 G1 / T1.6 诊断贯通修复）
   - `D-005`：配置读取/保存的数据安全（待 G2 / T2.2）
   - `D-006`：用户公式 ID 秒级碰撞（待 G2 / T2.1）
   - `D-007`：LaTeX 导入启发式丢结构（待 G1 / T1.7 & G4）
   上述 5 项在测试套件中依然显式维持 `#[ignore]` 状态，符合当前 Gate G1 任务节奏。

---
id: AUD-8
round: 8
gate: G1
scope: [D-001, D-002]
verdict: BLOCK
auditor: auditor
date: 2026-11-13
---

# MathSlot 独立审计报告 (AUD-8)

- **审计角色**：auditor（只读独立审计，绝不修改产品代码、测试、配置或脚本）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **当前分支**：`refactor/v1` (HEAD: `a197685`)
- **审计目标**：针对 Gate G1 任务 `T1.3`（用 catalog 修 D-001/D-002，产出调色板/文档，退出条件：5 张卡片正确；文档 code 全可解析）执行前置独立只读审计。
- **综合裁定**：**BLOCK**（D-001 与 D-002 两项 P1 缺陷客观处于 `OPEN` 状态；`scripts/agent/acceptance.sh` 在 G1 门禁下实测 `FAIL`；必须由 implementer 依据 TDD 规则规范实施修复并通过独立验收后方可放行）。

---

## 1. 判定摘要

| 缺陷 ID | 严重级别 | 简述 | 当前判定 | 证据章节 |
|:---:|:---:|:---|:---:|:---:|
| **D-001** | P1 (阻塞) | 调色板 5 张卡片 code 错误（偏导、约等、点乘、叉乘、恒等错位） | **OPEN** | §2.1 |
| **D-002** | P1 (阻塞) | README/HELP 手写命令漂移（`ch`/`cj`/`oq` 等不存在，`op`/`qm` 等语义倒置） | **OPEN** | §2.2 |

- **裁定原则**：依据 `.agents/skills/independent-audit/SKILL.md` §4 与 `AGENTS.md` §1 规则 5，范围内存在处于 `OPEN` 状态的 P1 缺陷，综合裁定必须为 **BLOCK**。

---

## 2. 逐项证据

### 2.1 D-001：调色板 5 张卡片 code 错误

- **缺陷族**：族 1（正确性静默错误）
- **关联代码**：
  - `src/app.rs:1594-1704`：`render_palette_tiles` 中 `common_symbols` 静态切片。
  - `crates/mathslot-core/src/command.rs:1150-1205, 580-605`：内核符号命令映射表。
  - `catalog/commands.toml:929-1105`：唯一事实源命令目录。
  - `crates/mathslot-command/src/generated.rs:1144-1360`：T1.2 生成的静态命令定义。
  - `scripts/agent/audit_palette.py`：调色板卡片与命令目录一致性审计脚本。

- **现状事实与错位比对**：
  在 `src/app.rs:1594-1703` 中，常用符号调色板（`PaletteCategory::Common`）硬编码了 12 张卡片，其中 5 张卡片的 `code` / `badge` / `hover` 发生严重错位：

  1. **偏导** (`src/app.rs:1614-1621`)：
     - 代码硬编码：`badge: "ob"`, `glyph: "∂"`, `code: "ob"`, `hover: "偏导算子 \\partial (Tab o b)"`
     - 事实源定义：`ob` 映射为 `SymbolCmd::To`（趋向箭头 `→`，`\to`）；偏导的正确简码为 `oc`（`SymbolCmd::Partial`，`\partial`）。
     - 用户后果：点击“偏导”卡片实际插入 `\to`（`→`）。
  2. **约等于** (`src/app.rs:1659-1666`)：
     - 代码硬编码：`badge: "xa"`, `glyph: "≈"`, `code: "xa"`, `hover: "约等于 \\approx (Tab x a)"`
     - 事实源定义：`xa` 映射为 `SymbolCmd::Equiv`（恒等于 `≡`，`\equiv`）；约等于的正确简码为 `xb`（`SymbolCmd::Approx`，`\approx`）。
     - 用户后果：点击“约等于”卡片实际插入 `\equiv`（`≡`）。
  3. **点乘** (`src/app.rs:1677-1684`)：
     - 代码硬编码：`badge: "oe"`, `glyph: "·"`, `code: "oe"`, `hover: "点乘 \\cdot (Tab o e)"`
     - 事实源定义：`oe` 映射为 `SymbolCmd::Pm`（正负号 `±`，`\pm`）；点乘的正确简码为 `og`（`SymbolCmd::Cdot`，`\cdot`）。
     - 用户后果：点击“点乘”卡片实际插入 `\pm`（`±`）。
  4. **叉乘** (`src/app.rs:1685-1693`)：
     - 代码硬编码：`badge: "od"`, `glyph: "×"`, `code: "od"`, `hover: "叉乘 \\times (Tab o d)"`
     - 事实源定义：`od` 映射为 `SymbolCmd::Nabla`（梯度算子 `∇`，`\nabla`）；叉乘的正确简码为 `of`（`SymbolCmd::Times`，`\times`）。
     - 用户后果：点击“叉乘”卡片实际插入 `\nabla`（`∇`）。
  5. **恒等于** (`src/app.rs:1695-1702`)：
     - 代码硬编码：`badge: "xb"`, `glyph: "≡"`, `code: "xb"`, `hover: "恒等于 \\equiv (Tab x b)"`
     - 事实源定义：`xb` 映射为 `SymbolCmd::Approx`（约等于 `≈`，`\approx`）；恒等于的正确简码为 `xa`（`SymbolCmd::Equiv`，`\equiv`）。
     - 用户后果：点击“恒等于”卡片实际插入 `\approx`（`≈`）。

- **实测复现命令**：
  ```bash
  python3 scripts/agent/audit_palette.py
  ```
- **退出码**：`1`
- **输出尾部**：
  ```
  扫描：12 张卡片，109 条子菜单命令

  不一致的卡片：
    - ob "偏导" -> Symbol::SymbolCmd::To
        glyph 卡片=∂ 目录=→; latex 卡片=partial 目录=to
    - xa "约等于" -> Symbol::SymbolCmd::Equiv
        glyph 卡片=≈ 目录=≡; latex 卡片=equiv 目录=approx
    - oe "点乘" -> Symbol::SymbolCmd::Pm
        glyph 卡片=· 目录=±; latex 卡片=cdot 目录=pm
    - od "叉乘" -> Symbol::SymbolCmd::Nabla
        glyph 卡片=× 目录=∇; latex 卡片=times 目录=nabla
    - xb "恒等于" -> Symbol::SymbolCmd::Approx
        glyph 卡片=≡ 目录=≈; latex 卡片=equiv 目录=approx

  未在命令目录中找到的卡片（可能是直输简码，需人工确认）：
    - +- (正负号)
    - <= (小于等于)
    - >= (大于等于)
    - != (不等于)
    - -> (趋向箭头)

  FAIL：5 张卡片与命令目录不一致
  ```

- **catalog 与 generated.rs 对照验证**：
  经核对 `catalog/commands.toml` 与 `crates/mathslot-command/src/generated.rs`，SSOT 事实源定义完备且精确无误：
  - 偏导：`CMD_PARTIAL` (`id: "partial"`, `keys: &["o", "c"]`, `label: "偏导"`, `glyph: "∂"`, `latex: "\\partial"`)
  - 约等：`CMD_APPROX` (`id: "approx"`, `keys: &["x", "b"]`, `label: "近似"`, `glyph: "≈"`, `latex: "\\approx"`)
  - 点乘：`CMD_CDOT` (`id: "cdot"`, `keys: &["o", "g"]`, `label: "点乘"`, `glyph: "·"`, `latex: "\\cdot"`)
  - 叉乘：`CMD_TIMES` (`id: "times"`, `keys: &["o", "f"]`, `label: "叉乘"`, `glyph: "×"`, `latex: "\\times"`)
  - 恒等：`CMD_EQUIV` (`id: "equiv"`, `keys: &["x", "a"]`, `label: "恒等"`, `glyph: "≡"`, `latex: "\\equiv"`)

- **判定**：**OPEN**

---

### 2.2 D-002：README/HELP 命令漂移

- **缺陷族**：族 3（事实源分叉）
- **关联代码**：
  - `README.md:42-43`：手写高阶结构与符号简码清单。
  - `HELP.md:135-196, 395`：手写 7 组二级子菜单全表及导数算子说明。
  - `docs/commands.md`：T1.2 生成的 121 条权威命令全量速查文档。
  - `crates/mathslot-core/src/command.rs` / `catalog/commands.toml`：事实源定义。

- **现状事实与漂移核对**：
  全文档扫描比对显示，`README.md` 与 `HELP.md` 存在大范围脱离内核事实源的手写漂移。具体清单如下：

  | 漂移位置 | 文档声称内容 | 实际内核 / catalog 定义 | 漂移性质 |
  |---|---|---|---|
  | `README.md:42`, `HELP.md:142, 395` | `▸ch` 全导分式 $\frac{\mathrm{d} y}{\mathrm{d} x}$ | `▸ci` 全导分式 (`TotalFrac`, `\frac{\mathrm{d}$1}{\mathrm{d}$2}`)；内核中无 `ch` | 错码 / 404 |
  | `README.md:42`, `HELP.md:143` | `▸ci` 上大括号 $\overbrace{x+y}$ | `▸aj` 上花括号 (`Overbrace`)；`▸ci` 实际被全导分式占用 | 错码 / 冲突 |
  | `README.md:42`, `HELP.md:144` | `▸cj` 下大括号 $\underbrace{x+y}$ | `▸ak` 下花括号 (`Underbrace`)；内核中无 `cj` | 错码 / 404 |
  | `README.md:43`, `HELP.md:183` | `▸oq` 垂直 $\perp$ | `▸op` 垂直 (`Perp`)；内核中无 `oq` | 错码 / 404 |
  | `README.md:43`, `HELP.md:182` | `▸op` 平行 $\parallel$ | `▸oo` 平行 (`Parallel`)；`▸op` 实际为垂直 $\perp$ | 语义完全颠倒 |
  | `README.md:43`, `HELP.md:195` | `▸qm` 复数集 $\mathbb{C}$ | `▸qn` 复数集 (`ComplexSet`)；`▸qm` 实际为差集 $\setminus$ (`SetMinus`) | 语义完全颠倒 |
  | `README.md:43`, `HELP.md:183` | `▸or` 同余全等 $\cong$ | `▸xj` 同余全等 (`Cong`)，属于关系符分类 `▸x*`；内核 `o*` 中无 `or` | 分类错位 / 404 |
  | `HELP.md:184-185` | `▸os` 远小于 $\ll$、`▸ot` 远大于 $\gg$、`▸ou` 弱等价 $\simeq$、`▸ov` 集合差 $\setminus$ | `\ll` 为 `▸xk`，`\gg` 为 `▸xl`，`\simeq` 为 `▸xm`（均属 `▸x*`）；`\setminus` 为 `▸qm`（属 `▸q*`）；`o*` 中无此类代码 | 凭空虚构 4 条命令 |

- **全量 `▸` 简码扫描测试**：
  运行静态解析检查脚本比对文档中所有 `▸xx` 简码：
  - `README.md` 中发现 7 处异常简码（包含语法示例拆分及手写漂移）。
  - `HELP.md` 中发现 21 处异常简码（集中在 Section 3.2 手写清单）。

- **判定**：**OPEN**

---

### 2.3 T0.3 回归测试解冻路径核查与审计

#### 2.3.1 `src/p1_regression_tests.rs` (D-001)

- **当前状态**：标注 `#[ignore = "P1 regression: D-001 (fails until fixed in G1/G2/G4)"]`
- **执行命令**：
  ```bash
  cargo test --bin mathslot test_p1_d001 -- --ignored
  ```
- **退出码**：`101` (FAIL)
- **输出尾部**：
  ```
  running 1 test
  test p1_regression_tests::test_p1_d001_palette_tiles_strictly_match_command_catalog ... FAILED

  failures:

  ---- p1_regression_tests::test_p1_d001_palette_tiles_strictly_match_command_catalog stdout ----

  thread 'p1_regression_tests::test_p1_d001_palette_tiles_strictly_match_command_catalog' panicked at src/p1_regression_tests.rs:42:17:
  assertion `left == right` failed: Tile '偏导' (code: 'ob') display glyph mismatch: catalog has '→' but palette card expects '∂'
    left: "→"
   right: "∂"
  ```
- **解冻与转绿路径**：
  1. 当前测试用例内硬编码了待核对的旧错位列表 `[("ob", "∂", "偏导"), ...]`，用于在 T0.3 阶段证明旧实现 Panic。
  2. Implementer 修复 `src/app.rs` 中 `common_symbols` 定义，将 5 张卡片简码更正为 `("oc", "∂", "偏导")`、`("xb", "≈", "约等于")`、`("og", "·", "点乘")`、`("of", "×", "叉乘")`、`("xa", "≡", "恒等于")`。
  3. 同步将测试用例中的期望简码对齐为修正后的 5 张卡片（或直接断言 `common_symbols` 提取项与 `lookup_sub_command` 一致）。
  4. 移除 `#[ignore]` 属性，执行 `cargo test --bin mathslot test_p1_d001` 验证其在默认测试套件中以 exit 0 转绿。

#### 2.3.2 `crates/mathslot-core/tests/p1_regression_tests.rs` (D-002)

- **当前状态**：标注 `#[ignore = "P1 regression: D-002 (fails until fixed in G1/G2/G4)"]`
- **执行命令**：
  ```bash
  cargo test -p mathslot-core --test p1_regression_tests test_p1_d002 -- --ignored
  ```
- **退出码**：`101` (FAIL)
- **输出尾部**：
  ```
  running 1 test
  test test_p1_d002_documented_commands_exist_and_match_semantics ... FAILED

  failures:

  ---- test_p1_d002_documented_commands_exist_and_match_semantics stdout ----

  thread 'test_p1_d002_documented_commands_exist_and_match_semantics' panicked at crates/mathslot-core/tests/p1_regression_tests.rs:54:9:
  assertion `left == right` failed: Documented command '▸ch' (全导分式) must exist and match target semantics in catalog
    left: None
   right: Some(Struct(TotalFrac))
  ```
- **解冻与转绿路径**：
  1. 当前测试用例在 T0.3 中记录了文档的错误声称（`ch` 为全导分式、`cj` 为下大括号、`oq` 为垂直、`op` 为平行、`qm` 为复数集），并断言其在 catalog 中存在，导致断言在第一条 `ch` 处即因 `None == Some(TotalFrac)` 触发 Panic。
  2. 依据规范 INV-001/INV-006（单一事实源），`catalog/commands.toml` 为唯一权威，应当修复文档而非篡改 catalog。
  3. 文档修复后（`ch` -> `ci`, `cj` -> `ak`, `oq` -> `op`, `op` -> `oo`, `qm` -> `qn`），测试用例断言应当对齐为：文档承诺的所有公开简码在 catalog 中均 100% 存在且语义匹配；并扩展真实文档解析测试（扫描 `README.md` 与 `HELP.md` 中的全部 `▸xx` 简码，断言每一个均能被 catalog 识别并解析）。
  4. 移除 `#[ignore]` 属性，执行 `cargo test -p mathslot-core --test p1_regression_tests test_p1_d002` 验证其在默认测试套件中以 exit 0 转绿。

---

### 2.4 门禁与自动化基线核验

依据 `AGENTS.md` §3 执行 4 大标准门禁命令：

#### 2.4.1 `cargo fmt --check`
- **执行命令**：`cargo fmt --check`
- **退出码**：`0`
- **判定**：**PASS**（代码排版整洁，无格式债务）

#### 2.4.2 `cargo clippy --workspace --all-targets -- -D warnings`
- **执行命令**：`cargo clippy --workspace --all-targets -- -D warnings`
- **退出码**：`0`
- **输出尾部**：`Finished dev profile [optimized + debuginfo] target(s) in 0.57s`
- **判定**：**PASS**（全工作区零 Clippy 警告与错误）

#### 2.4.3 `cargo test --workspace`
- **执行命令**：`cargo test --workspace`
- **退出码**：`0`
- **输出统计**：**154 passed; 0 failed; 7 ignored**
  - `mathslot` (bin): 3 passed; 3 ignored (`test_p1_d001`, `test_p1_d003`, `test_p1_d005`)
  - `mathslot-command`: 16 passed; 0 ignored (`catalog_tests`: 8, `codegen_tests`: 8)
  - `mathslot-core`: 110 passed; 4 ignored (`test_p1_d002`, `test_p1_d004`, `test_p1_d006`, `test_p1_d007`)
  - `mathslot-doc`: 5 passed; 0 ignored
  - `mathslot-latex`: 5 passed; 0 ignored
  - `mathslot-syntax`: 15 passed; 0 ignored
- **判定**：**PASS**（默认回归套件保持基线全绿）

#### 2.4.4 `scripts/agent/acceptance.sh`
- **执行命令**：`scripts/agent/acceptance.sh`
- **退出码**：`1`
- **输出尾部**：
  ```
  结果 检查项                    说明
  ------ ---------------------------- ----
  PASS   cargo fmt --check            exit 0
  PASS   cargo clippy -D warnings     exit 0
  PASS   cargo test --workspace       exit 0
  FAIL   调色板一致性           exit 1（gate=G1）
  WARN   let _ = 计数               29 处（G4 前应清零）
  WARN   unwrap() 计数              22 处（用户输入路径应为 0）
  WARN   命令表常量              3 处（G1 后应只剩 catalog）
  PASS   工作区干净              0 个未提交改动

  PASS=4 FAIL=1 WARN=3
  结论：FAIL（不得推进 Gate，不得签署通过）
  ```
- **判定**：**FAIL**（Gate G1 硬门禁成功拦截调色板 5 卡片错位，符合预期基线事实）

---

## 3. 新发现缺陷登记

本轮审计主要聚焦 D-001/D-002 现状与解冻路径，未发现新增的严重系统缺陷（无须新增 D-103+）。
前期登记的 P2 缺陷 `D-101`（已在 G0 闭环）、`D-102`（`src/modals.rs:1753` 临时文件名固定且缺乏唯一性隔离）保持现状追踪。

---

## 4. 历史结论抽查

依据 `SKILL.md` §3.3 规则，从 `docs/` 历史报告中抽查两条“已通过/已修复/100%一致”的声明进行代码与运行事实反查：

| 抽查对象 / 报告位置 | 历史声称内容 | 审计复核实测命令与结果 | 真实审计结论 |
|---|---|---|:---:|
| `docs/FINAL_PRODUCT_ACCEPTANCE_REPORT.md:33` | 声称：`经逐章节命令核对与微内核行为抽样验证，全部命令真实有效，快捷键映射与核心逻辑 100% 一致 \| 🟢 PASS` | 实测核查 `README.md` 与 `HELP.md`：包含 `▸ch`、`▸cj`、`▸oq`、`▸or`、`▸os`、`▸ot`、`▸ou`、`▸ov` 等大量内核不存在或颠倒的命令。 | **虚假声称 (FABRICATED)** |
| `docs/FINAL_ACCEPTANCE_ROUND_10_AUDIT.md:8-12` | 声称：`终验结论：【PASS / 验收完美通过】（所有 4 项专项重点考核指标与 10 项 REWRITE_DESIGN 核心验收标准均 100% 达标，无任何不符合项或边缘缺陷，全工作区 99 项自动化回归测试 100% 通过）` | 实测核查源码：该提交版本下，P1 级缺陷 D-001（调色板 5 张卡片错位）、D-003（`fitted_size` 宽高死参数）、D-004（导出静默吞节点）、D-006（秒级 ID 碰撞）全部客观存在，且完全缺乏拦截测试。 | **虚假声称 (FABRICATED)** |

---

## 5. 建议的下一步与实施指引（Coordinator & Implementer）

根据 `AGENTS.md` 规则与 Gate G1 推进流程，向协调者与实现者提出以下执行指引：

1. **决策层批准架构决策 (ADR-0011)**：
   - 明确 D-001 的修复方式：修正 `src/app.rs` 中 `common_symbols` 的 5 张卡片映射，使其严格对齐 `catalog/commands.toml`；
   - 明确 D-002 的修复方式：
     - 在 `README.md` 与 `HELP.md` 中修正所有漂移命令（`ch`->`ci`, `cj`->`ak`, `oq`->`op`, `op`->`oo`, `qm`->`qn` 等）；
     - 将 `HELP.md` Section 3.2 等手写命令清单替换为由 catalog 生成的结构块或引用 `docs/commands.md`；
     - 确保文档中提及的所有 `▸xx` 均在 catalog 中存在且可解析。
   - 批准解冻 `test_p1_d001` 与 `test_p1_d002`。

2. **实现者实施 (Implementer: T1.3)**：
   - **TDD 步骤**：
     - 修改 `src/app.rs:1614-1702` 中偏导、约等、点乘、叉乘、恒等 5 张卡片的 `badge`、`hover`、`code`；
     - 运行 `python3 scripts/agent/audit_palette.py`，确认输出变为 `PASS：所有可映射卡片与命令目录一致`（exit 0）；
     - 修正 `README.md` 与 `HELP.md` 中的手写漂移简码；
     - 调整 `src/p1_regression_tests.rs` 与 `crates/mathslot-core/tests/p1_regression_tests.rs` 中的对应测试断言，移除 `#[ignore]` 标注；
     - 运行 `cargo test --workspace`，断言测试通过总数上升为 **156 passed; 0 failed; 5 ignored**；
     - 运行 `scripts/agent/acceptance.sh`，确认调色板一致性检查转绿，总门禁通过。

3. **独立验收签署 (Verifier)**：
   - 由 independent verifier 对 `git diff` 进行独立核验，产出 `VER-8.md`。

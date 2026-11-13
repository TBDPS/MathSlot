---
id: AUD-4
round: 4
gate: G0
scope: [T0.4, D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-101]
verdict: BLOCK
auditor: auditor
date: 2026-11-13
---

# MathSlot 独立审计报告 (AUD-4)

- **审计角色**：auditor（只读独立审计，绝不修改产品代码、测试、配置或脚本）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **当前分支**：`refactor/v1` (HEAD: `e74d81f010f4ed81a85f8d88e6fcfd834888e3c4`)
- **审计依据**：`AGENTS.md`、`.agents/skills/independent-audit/SKILL.md`、`docs/LLM_IMPLEMENTATION_SPEC.md`
- **审计目标**：针对任务 `T0.4`（冻结命令语言与发布基线，产出 tag/baseline，迁移期间不改命令语义）进行只读独立审计。
- **综合裁定**：**BLOCK**（虽然门禁全部通过、T0.3 建立的 7 项 P1 失败回归测试有效拦截，但根据 `SKILL.md` §4 硬规则，只要重构范围内的 P1 缺陷 `D-001..D-007` 仍处于 `OPEN` 状态，裁定必须签署为 `BLOCK`。本报告为 G0 基线 tag 打标与 G1 命令单一事实源提供完整事实清单与固化方案）。

---

## 1. 判定摘要

| 审计项 / 缺陷 ID | 严重级别 | 类别 | 当前判定 | 核心证据与结论 |
|:---:|:---:|:---:|:---:|:---|
| **T0.4** | 核心任务 | 基线与护栏 | **OPEN** | 命令语言与预设基线待快照落盘；基线 Git tag 待标记（见 §2, §3） |
| **D-001** | P1 | 调色板错误 | **OPEN** | 5 张卡片 code 与命令目录不符（见 §4.5 失败测试） |
| **D-002** | P1 | 文档命令漂移 | **OPEN** | 文档手写命令 `▸ch/ci/cj/op/oq/qm` 漂移（见 §4.5 失败测试） |
| **D-003** | P1 | 预览裁切/死参数 | **OPEN** | `fitted_size` 忽视 `max_width/max_height`（见 §4.5 失败测试） |
| **D-004** | P1 | Pending/Unknown 静默丢 | **OPEN** | `to_latex` 对未决命令返回空串（见 §4.5 失败测试） |
| **D-005** | P1 | 配置数据安全隐患 | **OPEN** | 损坏 JSON 静默回退默认库且覆写主文件（见 §4.5 失败测试） |
| **D-006** | P1 | 公式 ID 秒级碰撞 | **OPEN** | 同秒创建 1000 条公式导致覆盖只剩 1 条（见 §4.5 失败测试） |
| **D-007** | P1 | LaTeX 导入启发式丢结构 | **OPEN** | 启发式转换器静默剥除复杂结构（见 §4.5 失败测试） |
| **D-101** | P1 | 虚假测试防护 | **FIXED** (在测试设计上) | T0.3 已建立运行时真实断言，不再使用源码文本假测试 |

---

## 2. 任务 T0.4 专项审计与基线标记检查 (Git Tag & Baseline)

### 2.1 Git Tag 现状审查
- **执行命令**：`git tag -l -n9`
- **退出码**：`0`
- **输出内容**：
  ```text
  freeze/pre-refactor-20261112 Frozen baseline before G0: 133 tests green, clippy red, P1 defects open
  v0.6.1          Release v0.6.1: Full Preset Corpus, Wayland Desktop Integration, Schema-versioned Storage & Obsidian WASM Bundle
  v0.7.0          Release v0.7.0: Modern UI Overhaul, In-App Sigma Brand Mark, Zero-Tofu Font Engine, Decoupled Extensible Formula Library (88+ Corpus)
  v0.7.1          Release v0.7.1: Strict Centered Sigma Icon, Balanced Ergonomic Modals, Tailored Linear/Zinc UI Palette & Git-isolated Docs
  v0.7.2          Release v0.7.2: Modal viewport stability, semantic card form, full-width code layout
  v0.8.0          Release v0.8.0: Inline Workspace Tabs, Zero-Modal Architecture, Live Instant Preview
  v0.8.1          Release v0.8.1: Chromeless Left Wing Header, Backward Body Wrap, Responsive Formula Library, and Clustered Form Layout
  ```
- **现有冻结 Tag 详细信息**：
  - **命令**：`git show -s --format=fuller freeze/pre-refactor-20261112`
  - **退出码**：`0`
  - **指向 commit**：`5b117d92d4c2f54da03ece5cb7d7cf896ce8a2fe`
  - **说明**：该 tag 是重构初始准备阶段冻结的未整改基线（Clippy 报红、CI 缺失、P1 失败回归测试未建立）。

### 2.2 规范退出条件分析（§14 G0 exit: `baseline_tagged`）
- 规范 §14.1 明确规定 G0 的退出条件为：
  ```yaml
  gates:
    - id: G0
      name: baseline-and-guardrails
      tasks: [T0.1, T0.2, T0.3, T0.4, T0.5]
      exit: [ci_green, p1_tests_exist, clippy_controlled, baseline_tagged]
  ```
- 当前进度：
  - `ci_green`：T0.1 已完成（commit `17ffa61`，`.github/workflows/ci.yml` 建立）；
  - `clippy_controlled`：T0.2 已完成（commit `346a1f5`，`-D warnings` 零警告）；
  - `p1_tests_exist`：T0.3 已完成（commit `9dc9cae`，7 项 P1 回归用例建立并在 `-- --ignored` 中 100% 失败拦截）；
  - `baseline_tagged`：**当前尚未打标**。需要标记包含 G0 护栏与冻结命令基线的 Git Tag。

### 2.3 建议的基线 Tag 命名与时机
1. **Tag 命名**：推荐命名为 `baseline/g0-guardrails`（可同时创建别名 `freeze/baseline-g0` 保持与现有 `freeze/` 系列命名习惯兼容）。
2. **打标时机**：由 implementer / coordinator 在将命令语言基线快照落盘并完成 T0.4 提交后，执行带有带注信息的 tag：
   ```bash
   git tag -a baseline/g0-guardrails -m "G0 baseline: CI green, zero clippy debt, P1 regression harness in place, command catalog frozen"
   ```
3. **不可变保障**：该 tag 将作为后续 G1（单一事实源）、G2（微内核架构迁移）发生重构漂移时的硬回退点与基线参照点。

---

## 3. 命令语言与内置预设当前事实状态深度审计 (Command Language & Presets)

依据单一事实源准则（INV-001, INV-006），审计对 `crates/mathslot-core/src/command.rs` 与 `crates/mathslot-core/src/presets.rs` 进行全量常量、枚举与映射提取。

### 3.1 直输结构命令表 `DIRECT_ENTRIES` (12 条)
- **代码位置**：`crates/mathslot-core/src/command.rs:196-281`
- **常量定义**：`pub const DIRECT_ENTRIES: &[DirectEntry]`
- **事实统计**：共 12 条单字符直输命令，全部绑定到 `StructKind` 结构：
  | 序号 | 触发键 `key` | 标签 `label` | 符号提示 `glyph_hint` | 槽位语义 `detail` | 对应结构 `kind` |
  |:---:|:---:|:---:|:---:|:---:|:---:|
  | 1 | `'f'` | 分数 | `a/b` | 分子 ; 分母 | `StructKind::Frac` |
  | 2 | `'r'` | 根号 | `√x` | 被开方式 | `StructKind::Sqrt` |
  | 3 | `'n'` | N次根 | `n√x` | 根指数 ; 被开方式 | `StructKind::NthRoot` |
  | 4 | `'u'` | 上标 | `x^n` | 底数 ; 指数 | `StructKind::Sup` |
  | 5 | `'d'` | 下标 | `x_n` | 主体 ; 下标 | `StructKind::Sub` |
  | 6 | `'b'` | 上下标 | `x_n^m` | 主体 ; 下标 ; 上标 | `StructKind::SubSup` |
  | 7 | `'p'` | 括号 | `(x)` | 括号内表达式 | `StructKind::Paren` |
  | 8 | `'v'` | 绝对值 | `|x|` | 绝对值内表达式 | `StructKind::Abs` |
  | 9 | `'i'` | 定积分 | `∫_a^b` | 下限 ; 上限 ; 被积式 | `StructKind::Integral` |
  | 10 | `'s'` | 求和 | `∑` | 下限 ; 上限 ; 求和项 | `StructKind::Sum` |
  | 11 | `'l'` | 极限 | `x→a` | 趋近变量 ; 趋近目标 ; 主体 | `StructKind::Limit` |
  | 12 | `'e'` | 二项式 | `C(n,k)` | 上标 n ; 下标 k | `StructKind::Binom` |

### 3.2 子菜单命令表 (7 大静态子类别，109 条)
- **代码位置**：`crates/mathslot-core/src/command.rs:283-1286`
- **子菜单类别**：`SubCategory`（静态 7 类 + 动态 2 类）：
  - 静态：`CalculusMore` (`c`), `Matrix` (`m`), `Accent` (`a`), `Greek` (`g`), `Symbol` (`o`), `Relations` (`x`), `SetLogic` (`q`)
  - 动态：`Custom` (`k`, 用户自定义格式), `Template` (`t`, 用户公式模板)
- **子菜单命令全量分布**：
  | 子类别名称 | 前缀字符 | 静态常量表名称 | 条目数 | 目标类型 | 包含结构 / 符号 |
  |:---|:---:|:---|:---:|:---:|:---|
  | **CalculusMore** | `'c'` | `CALCULUS_MORE_ENTRIES` | 7 | `StructKind` | 不定积分(`ca`), 连乘(`cb`), 二重积分(`cc`), 环路积分(`cd`), 三重积分(`ce`), 偏导分式(`cg`), 全导分式(`ci`) |
  | **Matrix** | `'m'` | `MATRIX_ENTRIES` | 8 | `StructKind` | 2×2矩阵(`ma`), 3×3矩阵(`mb`), 2×2行列式(`mc`), 分段函数(`md`), 方块阵(`me`), 三分段(`mf`), 3×3方块阵(`mg`), 3×3行列式(`mh`) |
  | **Accent** | `'a'` | `ACCENT_ENTRIES` | 17 | `StructKind` | 帽子(`aa`), 上横线(`ab`), 向量(`ac`), 波浪(`ad`), 一阶导点(`ae`), 范数(`af`), 上划线(`ag`), 二阶导点(`ah`), 下划线(`ai`), 上花括号(`aj`), 下花括号(`ak`), 中括号(`al`), 大括号(`am`), 尖括号(`an`), 向下取整(`ao`), 向上取整(`ap`), 代入求值线(`aq`) |
  | **Relations** | `'x'` | `RELATION_ENTRIES` | 13 | `SymbolCmd` | 恒等(`xa`), 近似(`xb`), 相似(`xc`), 正比(`xd`), 蕴含(`xe`), 等价(`xf`), 小于等于(`xg`), 大于等于(`xh`), 不等于(`xi`), 小于(`xj`), 大于(`xk`), 左箭头(`xl`), 上下箭头(`xm`) |
  | **SetLogic** | `'q'` | `SET_LOGIC_ENTRIES` | 14 | `SymbolCmd` | 并集(`qa`), 交集(`qb`), 空集(`qc`), 存在(`qd`), 不存在(`qe`), 逻辑与(`qf`), 逻辑或(`qg`), 逻辑非(`qh`), 包含于(`qi`), 自然数集(`qj`), 整数集(`qk`), 有理数集(`ql`), 实数集(`qm`), 复数集(`qn`) |
  | **Greek** | `'g'` | `GREEK_ENTRIES` | 34 | `SymbolCmd` | 24 个希腊小写字母 (`ga`..`go`) + 10 个希腊大写字母 (`gC`, `gD`, `gT`, `gL`, `gX`, `gP`, `gS`, `gU`, `gF`, `gY`, `gO`) |
  | **Symbol** | `'o'` | `SYMBOL_ENTRIES` | 16 | `SymbolCmd` | 无穷(`oa`), 趋向(`ob`), 偏导(`oc`), 梯度(`od`), 正负(`oe`), 叉乘(`of`), 点乘(`og`), 属于(`oh`), 不属于(`oi`), 子集(`oj`), 任意(`ok`), 约化普朗克(`ol`), 花体l(`om`), 圈乘/度(`on`), 平行(`oo`), 垂直(`op`) |
  | **静态小计** | - | - | **109** | - | **32 个 StructKind + 77 个 SymbolCmd** |

### 3.3 结构与符号的映射闭包验证
- **`StructKind` 全集闭包**：
  - `StructKind::ALL` 声明大小：44（`crates/mathslot-core/src/command.rs:1391`）
  - 直输命令关联结构数：12
  - 子菜单命令关联结构数：32（`c`: 7, `m`: 8, `a`: 17）
  - $12 + 32 = 44$，**100% 覆盖**，无任何孤立未绑定结构。
- **`SymbolCmd` 全集闭包**：
  - `SymbolCmd::ALL` 声明大小：77（`crates/mathslot-core/src/command.rs:1611`）
  - 子菜单命令关联符号数：77（`x`: 13, `q`: 14, `g`: 34, `o`: 16）
  - **100% 覆盖**，无任何孤立未绑定符号。
- **总命令数量事实**：
  - 系统静态预定义的命令条目总数严格为 **12 (直输) + 109 (子菜单) = 121 条**。

### 3.4 内置经典公式库 `presets.rs` 88 条全量事实
- **代码位置**：`crates/mathslot-core/src/presets.rs:14-570`
- **常量定义**：`pub const PRESET_LIBRARY: &[PresetFormula]`
- **测试验证**：`crates/mathslot-core/tests/massive_preset_compatibility_tests.rs` 经实测 `Total presets under test: 88`，全部通过流式简码解析与渲染。
- **学科类别分布统计**（共 9 大学科分类，合计 88 条）：
  1. **微积分/高等数学**：15 条（欧拉恒等式、高斯积分、微积分基本定理、重要极限等）
  2. **线性代数**：12 条（一元二次方程求根公式、柯西-施瓦茨不等式、特征值方程、SVD分解等）
  3. **概率统计**：9 条（贝叶斯公式、一维高斯分布、多元正态分布、泊松分布等）
  4. **大学物理**：12 条（麦克斯韦方程组 4 式、薛定谔方程、爱因斯坦质能方程等）
  5. **复变函数**：8 条（柯西-黎曼方程组、柯西留数定理、傅里叶变换、拉普拉斯变换等）
  6. **离散数学**：6 条（香农信息熵、二项式定理、斯特林近似、斐波那契通项等）
  7. **现代深度学习与人工智能**：11 条（缩放点积注意力、多头注意力、Adam更新式、LayerNorm、Diffusion分数匹配等）
  8. **量子力学**：8 条（时间依赖/定态薛定谔方程、测不准原理、狄拉克内积期望值、泡利矩阵等）
  9. **微分几何与数学物理**：7 条（外微分反对称莱布尼茨法则、广义斯托克斯定理、霍奇对偶、爱因斯坦引力场方程等）

### 3.5 命令语言语义基线固化与快照导出方案评估
为确保 G1 引入单一事实源 `catalog/commands.toml`（任务 T1.1, T1.2）时不发生任何静默语义漂移，在 T0.4 阶段必须生成不可变基线快照。
- **快照目标路径**：建议保存至 `agent-state/baseline/commands-baseline-v0.7.0.json`（或 `docs/baseline/commands-v0.7.0.json`）。
- **快照 Schema 核心内容**：
  ```json
  {
    "schema_version": 1,
    "version": "v0.7.0",
    "commit": "e74d81f010f4ed81a85f8d88e6fcfd834888e3c4",
    "stats": {
      "direct_commands_count": 12,
      "sub_commands_count": 109,
      "struct_kinds_count": 44,
      "symbol_cmds_count": 77,
      "preset_formulas_count": 88
    },
    "direct_entries": [ ... ],
    "sub_categories": [ ... ],
    "sub_entries": [ ... ],
    "struct_kinds": [ ... ],
    "symbol_cmds": [ ... ],
    "presets": [ ... ]
  }
  ```
- **基线快照的校验价值**：
  在 G1 完成 catalog 代码生成后，可直接编写对齐测试（如 `tests/command_catalog_parity.rs`），加载该 JSON 基线并断言新 catalog 生成的 Rust 常量、宏名称、glyph、LaTeX 宏与插槽属性与基线 **100% 逐字段相等**。

---

## 4. 门禁检查全量证据 (Quality Gates)

### 4.1 代码格式检查 (`cargo fmt --check`)
- **执行命令**：`cargo fmt --check`
- **退出码**：`0`
- **输出**：无任何输出（完全合规）。

### 4.2 Clippy 静态检查 (`cargo clippy`)
- **执行命令**：`cargo clippy --workspace --all-targets -- -D warnings`
- **退出码**：`0`
- **输出尾部**：
  ```text
      Finished `dev` profile [optimized + debuginfo] target(s) in 0.18s
  ```

### 4.3 全工作区单元与集成测试 (`cargo test --workspace`)
- **执行命令**：`cargo test --workspace`
- **退出码**：`0`
- **输出汇总**：
  ```text
  mathslot (bin): 3 passed; 0 failed; 3 ignored
  mathslot-core: 33 passed; 0 failed; 0 ignored
  acceptance_tester_round11_comprehensive: 10 passed; 0 failed; 0 ignored
  acceptance_tests: 16 passed; 0 failed; 0 ignored
  extreme_heterogeneous_tests: 7 passed; 0 failed; 0 ignored
  facade_tests: 2 passed; 0 failed; 0 ignored
  final_acceptance_round10: 5 passed; 0 failed; 0 ignored
  final_acceptance_round11: 5 passed; 0 failed; 0 ignored
  final_acceptance_round12: 7 passed; 0 failed; 0 ignored
  final_acceptance_round7: 5 passed; 0 failed; 0 ignored
  final_acceptance_round9: 5 passed; 0 failed; 0 ignored
  massive_preset_compatibility_tests: 1 passed; 0 failed; 0 ignored (88/88 预设公式)
  overhaul_acceptance_tests: 5 passed; 0 failed; 0 ignored
  p1_regression_tests: 0 passed; 0 failed; 4 ignored
  session_tests: 4 passed; 0 failed; 0 ignored
  mathslot-doc: 5 passed; 0 failed; 0 ignored
  mathslot-latex: 5 passed; 0 failed; 0 ignored
  mathslot-syntax (golden_tests): 15 passed; 0 failed; 0 ignored
  总计：133 passed; 0 failed; 7 ignored
  ```

### 4.4 门禁脚本检查 (`scripts/agent/acceptance.sh`)
- **执行命令**：`scripts/agent/acceptance.sh`
- **退出码**：`0`
- **输出内容**：
  ```text
  == MathSlot 门禁（/home/mat/Projects/mathslot-next）==
  时间：2026-11-13T08:08:26+08:00

  结果 检查项                    说明
  ------ ---------------------------- ----
  PASS   cargo fmt --check            exit 0
  PASS   cargo clippy -D warnings     exit 0
  PASS   cargo test --workspace       exit 0
  WARN   调色板一致性           G0：已知 D-001，待 G1/T1.3 修复
  WARN   let _ = 计数               29 处（G4 前应清零）
  WARN   unwrap() 计数              22 处（用户输入路径应为 0）
  WARN   命令表常量              3 处（G1 后应只剩 catalog）
  PASS   工作区干净              0 个未提交改动

  PASS=4 FAIL=0 WARN=4
  结论：PASS
  ```

### 4.5 P1 失败回归测试有效拦截证据
- **执行命令**：`cargo test --workspace -- --ignored`
- **退出码**：`101` (按预期全部失败，无任何测试被弱化或假通过)
- **逐项失败拦截细节**：
  1. `test_p1_d001_palette_tiles_strictly_match_command_catalog` (D-001):
     `panicked at src/p1_regression_tests.rs:42:17: Tile '偏导' (code: 'ob') display glyph mismatch: catalog has '→' but palette card expects '∂'`
  2. `test_p1_d002_documented_commands_exist_and_match_semantics` (D-002):
     `panicked at crates/mathslot-core/tests/p1_regression_tests.rs:54:9: Documented command '▸ch' (全导分式) must exist and match target semantics in catalog: left: None, right: Some(Struct(TotalFrac))`
  3. `test_p1_d003_fitted_size_strictly_respects_max_bounds` (D-003):
     `panicked at src/p1_regression_tests.rs:94:5: Fitted width 600 exceeds max_width 400`
  4. `test_p1_d004_pending_and_unknown_commands_never_silently_disappear` (D-004):
     `panicked at crates/mathslot-core/tests/p1_regression_tests.rs:78:5: Exporting pending command '▸m' must not produce empty string, got: ""`
  5. `test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file` (D-005):
     `panicked at src/p1_regression_tests.rs:183:5: Corrupted configuration must not silently degrade to default_seeded library`
  6. `test_p1_d006_formula_upsert_same_millisecond_no_collision` (D-006):
     `panicked at crates/mathslot-core/tests/p1_regression_tests.rs:131:5: All 1000 generated IDs must be unique, but got only 1`
  7. `test_p1_d007_latex_import_reports_lossy_and_blocks_degradation` (D-007):
     `panicked at crates/mathslot-core/tests/p1_regression_tests.rs:159:5: Complex macro structure must not be silently stripped by heuristic converter, got: \tensorA^i_j + \unsupportedEnvironmentx`

---

## 5. 历史结论抽查 (Historical Claims Verification)

根据 `SKILL.md` §3 要求，抽查 `docs/` 中历史报告中声明的“已通过 / 已修复”事项：

| 来源报告与行号 | 历史声称内容 | 实际验证命令与结果 | 独立审计结论 |
|:---|:---|:---|:---:|
| `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:25` | “Git 隔离规约: `docs/` 严禁参与 git tracking: `.gitignore` 严格阻断，`git ls-files docs/` 输出 0 \| PASS” | 执行 `git ls-files docs/ \| wc -l`<br>实际输出：**59** (退出码 0) | **NOT-REPRODUCIBLE / FALSE**<br>（历史签署不实，59 个文档文件仍在 git 跟踪中） |
| `docs/AUDIT_ROUND_11_INLINE_WORKSPACE_AND_ZERO_MODAL.md:23` | “0 个未受保护的 `unwrap()`/`panic` 隐患” | 执行 `scripts/agent/acceptance.sh`<br>实际输出：**`WARN unwrap() 计数 22 处`** | **NOT-REPRODUCIBLE / FALSE**<br>（工程中仍存有 22 处 `unwrap()` 需在后续 Gate 消除） |

---

## 6. 新发现与代码异味 (Findings & Code Smells)

| ID | 级别 | 位置 | 现象描述 | 影响评估 |
|:---:|:---:|:---|:---|:---|
| **D-102** | P2 | `crates/mathslot-core/src/presets.rs:14` 与 `crates/mathslot-core/src/library.rs:224` | 预设公式列表虽在 `presets.rs` 中集中定义，但在 `library.rs` 的 `default_seeded()` 中被逐条硬编码转换为用户格式与片段 | 违反 INV-004（配置只存用户数据，内置内容编译期加载），需在 G2/T2.2 中重构分离 |
| **D-103** | P3 | `crates/mathslot-core/src/command.rs:196-281` | 直输命令表 `DIRECT_ENTRIES` 与调色板卡片存在冗余定义且缺失双向一致性静态校验 | 强化了建立单一事实源 `catalog/commands.toml` 的迫切性 |

---

## 7. 建议的下一步（供 Coordinator 与 Implementer 参考）

1. **编写 ADR-0007**：
   - 明确 T0.4 的命令语言冻结产物规范；
   - 规定基线 JSON 快照生成格式与落盘路径（如 `agent-state/baseline/commands-baseline-v0.7.0.json`）；
   - 确定基线 Tag 命名为 `baseline/g0-guardrails`。
2. **派发 Implementer**：
   - 编写基线导出工具/单元测试，将 12 条直输结构、109 条子菜单命令、44 项 StructKind、77 项 SymbolCmd 及 88 条经典公式全量导出并固化至 JSON 基线文件；
   - 确保零修改产品代码与现有测试逻辑，保持 133 passed / 7 ignored 全绿门禁；
   - 提交 commit：`T0.4: freeze command language snapshot and release baseline`。
3. **打标与独立验收**：
   - 在该 commit 上打上 annotated tag `baseline/g0-guardrails`；
   - 派发 Verifier 执行独立验收并产出 `VER-4`，确认 G0 退出条件全部达成。

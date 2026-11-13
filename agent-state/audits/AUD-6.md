---
id: AUD-6
round: 6
gate: G1
scope: [T1.1, D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-101, D-102]
verdict: BLOCK
auditor: auditor
date: 2026-11-13
---

# MathSlot 独立审计报告 (AUD-6)

- **审计角色**：auditor（只读独立审计，绝不修改产品代码、测试、配置或脚本）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **当前分支**：`refactor/v1` (HEAD: `e448912` state(round-5): record VER-5, GATE-G0 pass, close Gate G0)
- **审计依据**：`AGENTS.md`、`.agents/skills/independent-audit/SKILL.md`、`docs/LLM_IMPLEMENTATION_SPEC.md`
- **审计目标**：针对 Gate G1 首个核心任务 `T1.1`（定义 `catalog/commands.toml` schema + loader，产出 catalog crate，退出条件：能加载全部命令）执行全面只读独立审计，审计命令目录唯一事实源契约、基线 121 项命令映射完备性、crate 架构与校验规则设计，并建立精确的交付证据链。
- **综合裁定**：**BLOCK**（说明：虽然工程质量基线保持 138 测试通过、clippy 零警告，但根据 `SKILL.md` §4 硬性规则，重构范围内核心 P1 缺陷 `D-001..D-007` 仍处于 `OPEN` 状态且门禁 `acceptance.sh` 在 G1 阶段硬拦截调色板漂移，裁定必须签署为 `BLOCK`。本报告为 `T1.1` 的架构决策 `ADR-0009`、loader 实现及单测提供完整契约与输入基准）。

---

## 1. 判定摘要

| 审计项 / 缺陷 ID | 严重级别 | 类别 | 当前判定 | 核心证据与结论 |
|:---:|:---:|:---:|:---:|:---|
| **T1.1** | 核心任务 | 命令目录 Schema 与 Loader | **OPEN** | `catalog/commands.toml` 与 `crates/mathslot-command` 待创建；需加载校验全部 121 项命令（见 §2） |
| **D-001** | P1 | 调色板 5 卡片 code 错误 | **OPEN** | `src/app.rs:1614` 偏导等 5 张卡片仍硬编码错误 code（见 §3.1） |
| **D-002** | P1 | README/HELP 命令漂移 | **OPEN** | 手写命令漂移，测试 `test_p1_d002` 保持阻断拦截（见 §3.2） |
| **D-003** | P1 | 预览裁切/死参数 | **OPEN** | `fitted_size` 忽视边界，测试 `test_p1_d003` 保持阻断拦截（见 §3.3） |
| **D-004** | P1 | Pending/Unknown 静默丢 | **OPEN** | `to_latex` 未决命令返回空串，测试 `test_p1_d004` 保持阻断拦截（见 §3.4） |
| **D-005** | P1 | 配置数据安全隐患 | **OPEN** | 损坏 JSON 静默覆写，测试 `test_p1_d005` 保持阻断拦截（见 §3.5） |
| **D-006** | P1 | 公式 ID 秒级碰撞 | **OPEN** | 时间戳精度为秒，测试 `test_p1_d006` 保持阻断拦截（见 §3.6） |
| **D-007** | P1 | LaTeX 导入启发式丢结构 | **OPEN** | 启发式转换器丢结构，测试 `test_p1_d007` 保持阻断拦截（见 §3.7） |
| **D-101** | P1 | 虚假测试防护 | **FIXED** (测试设计) | T0.3 真实断言守护已生效，杜绝源码文本假测试（见 §3.8） |
| **D-102** | P2 | 临时文件名竞态与缺乏隔离 | **OPEN** | `modals.rs:1753` 硬编码 `library.json.tmp`，由 T0.5 harness 锁定（见 §3.9） |

---

## 2. 任务 T1.1 专项审计：命令目录 Schema、基线对齐与 Loader 设计

依据规范 `docs/LLM_IMPLEMENTATION_SPEC.md` §8（命令目录作为唯一事实源）、§14（Gate G1 任务 T1.1）及不变量 `INV-001`、`INV-006`、`INV-015`，T1.1 要求确立 MathSlot 命令系统的单一事实源，产出 `catalog/commands.toml` 与纯数据 crate `crates/mathslot-command`。

### 2.1 契约规范与字段定义 (§8.1)

`catalog/commands.toml` 为全系统命令的根事实源，其 TOML Schema 必须支持并规范以下字段：

| 字段名称 | 类型 | 必填 | 语义与规范要求 |
|---|---|:---:|---|
| `id` | `String` | 是 | 唯一命令标识符，小写蛇形/短横线（如 `"frac"`、`"partial"`、`"matrix_2x2"`） |
| `keys` | `Vec<String>` | 是 | 键序列数组，直输结构为单键（如 `["f"]`），子菜单命令为双键（如 `["o", "c"]`） |
| `label` | `String` | 是 | 中文显示名称（如 `"分数"`、`"偏导"`） |
| `category` | `String` | 是 | 类别标识：`"structure"`、`"calculus"`、`"matrix"`、`"accent"`、`"greek"`、`"symbol"`、`"relation"`、`"setlogic"` |
| `glyph` | `String` | 是 | 紧凑字形提示（如 `"a/b"`、`"∂"`、`"√x"`） |
| `slots` | `Vec<String>` | 否 | 槽位语义名称列表（如 `["分子", "分母"]`），0 槽位符号命令为空 `[]` |
| `latex` | `String` | 是 | LaTeX 模板：槽位占位符使用 `$1`, `$2`（如 `\\frac{$1}{$2}`）；无槽符号为宏名称（如 `\\partial`） |
| `doc` | `String` | 是 | 详细功能说明与帮助文案 |
| `examples` | `Vec<String>` | 是 | 流式快捷输入示例（如 `["▸f1;2;"]`、`["▸oc"]`），必须以 `▸` 开头 |
| `is_default` | `bool` | 否 | 子菜单默认项标记（按 Enter/Space 默认选用），默认 `false` |
| `wrap_body_slot` | `Option<usize>` | 否 | 智能包裹时光标左侧已有表达式落入的主体槽位索引（如极限为 `Some(2)`，分数/根号为 `Some(0)`） |

### 2.2 基线 121 项命令与 88 条预设数据完备性审计

通过对 `crates/mathslot-core/src/command.rs`、`crates/mathslot-core/src/presets.rs` 与 `agent-state/baseline/commands-baseline-v0.7.0.json` 进行交叉比对，确定命令全量集由 **121 项命令** 严格构成：

```
全量命令总计：121 项
├── 12 项单字母高频直达结构 (Direct Entries)
│   └── f (分数), r (根号), n (N次根), u (上标), d (下标), b (上下标),
│       p (括号), v (绝对值), i (定积分), s (求和), l (极限), e (二项式)
└── 109 项子菜单命令 (Submenu Commands)
    ├── CalculusMore (c*): 7 项 (ca 不定积分, cb 连乘, cc 二重积分, cd 环路积分, ce 三重积分, cg 偏导分式, ci 全导分式)
    ├── Matrix (m*): 8 项 (ma 2×2矩阵, mb 3×3矩阵, mc 2×2行列式, md 分段函数, me 方块阵, mf 三分段, mg 3×3方块, mh 3×3行列式)
    ├── Accent (a*): 17 项 (aa 帽子, ab 横线, ac 向量, ad 波浪, ae 导点, af 范数, ag 上划线, ah 二阶导点, ai 下划线, aj 上括号, ak 下括号, al 中括号, am 大括号, an 尖括号, ao 下取整, ap 上取整, aq 代入线)
    ├── Greek (g*): 34 项 (24 小写希腊字母 + 10 大写希腊字母 Γ, Δ, Θ, Λ, Ξ, Π, Σ, Υ, Φ, Ψ, Ω)
    ├── Symbol (o*): 16 项 (oa 无穷, ob 趋向, oc 偏导, od 劈形, oe 正负, of 叉乘, og 点乘, oh 属于, oi 不属于, oj 子集, ok 全称, ol 约化h, om 字母l, on 复合圈, op 平行, oq 垂直)
    ├── Relations (x*): 13 项 (xa 恒等, xb 近似, xc 相似, xd 正比, xe 蕴含, xf 等价, xg 映射, xh 所以, xi 因为, xj 全等, xk 远小于, xl 远大于, xm 渐近)
    └── SetLogic (q*): 14 项 (qa 并集, qb 交集, qc 空集, qd 真子集, qe 存在, qf 非, qg 与, qh 或, qi 实数集, qj 自然数集, qk 整数集, ql 有理数集, qm 差集, qn 复数集)
```

**对应关系与映射收敛**：
- `StructKind::ALL`: 44 项结构枚举 = 12 项直达结构 + 32 项子菜单结构（7 微积分 + 8 矩阵 + 17 装饰）。
- `SymbolCmd::ALL`: 77 项符号枚举 = 34 希腊 + 16 符号 + 13 关系 + 14 集合逻辑。
- 44 + 77 = 121 项命令，两者完全双射。
- 经典公式预设：`crates/mathslot-core/src/presets.rs` 包含 88 项经流式简码校验的权威公式。

### 2.3 Crate 架构与 Workspace 成员定位

依据规范 §5.2、§8.2：
- **位置**：`crates/mathslot-command`。
- **职责**：纯数据定义与目录管理。提供 TOML 反序列化、静态目录加载、键前缀树检索（Trie）、槽位与模板绑定。
- **依赖限制**：
  - 允许依赖：`serde` (derive), `toml`, `thiserror`。
  - 禁止依赖：UI (egui/DOM)、IO (除加载 catalog 静态字符串/文件外)、Parser、AST、LaTeX 运行时。
- **Workspace 调整**：根 `Cargo.toml` 的 `workspace.members` 必须追加 `"crates/mathslot-command"`。

### 2.4 Loader 与校验规则设计 (§8.3)

在 `mathslot-command` 中实现的 `CommandCatalog::validate(&self)` 必须严格执行以下契约：
1. **键序列唯一性与前缀无关性 (Prefix-Free Invariant)**：
   - 任意两命令 $A, B$ 的 `keys` 序列不得相同；
   - 任意命令的 `keys` 不得为另一命令 `keys` 的严格前缀。
   - 经审计，直达键 `['f','r','n','u','d','b','p','v','i','s','l','e']` 与子菜单前缀 `['c','m','a','g','o','x','q']` 以及跳转键 `'j'` 互斥无交集，具备前缀无关性。
2. **必填字段与格式合法性**：
   - `id`, `keys`, `label`, `category`, `glyph`, `latex`, `doc` 均非空；
   - `id` 必须满足 `^[a-z0-9_-]+$` 规范；
   - `examples` 至少 1 条且以 `▸` 开头。
3. **槽位与 LaTeX 模板一致性**：
   - 若 `slots.len() == N`，LaTeX 模板中允许引用的最高占位符为 `$N`，不得出现 `$0` 或 `$K (K > N)`；
   - 若 `slots.is_empty()`，LaTeX 模板不得包含 `$1`, `$2` 等占位符；
   - `wrap_body_slot` 若存在，其值必须小于 `slots.len()`。
4. **T1.1 退出条件验证**：
   - 单测通过 `include_str!("../../../catalog/commands.toml")` 解析并验证全量 121 项命令；
   - 断言命令总数严格为 121，且验证通过率 100%。

---

## 3. 逐项缺陷证据与现状分析

### 3.1 D-001：调色板 5 张卡片 code 与真实命令目录冲突
- **文件与行号**：`src/app.rs:1614-1685`、`crates/mathslot-core/src/command.rs:1140-1205, 581-605`
- **复现命令**：
  ```bash
  python3 scripts/agent/audit_palette.py
  ```
- **退出码**：`1`
- **尾部输出**：
  ```text
  扫描：12 张卡片，109 条子菜单命令

  不一致的卡片：
    - ob "偏导" -> Symbol::SymbolCmd::To
        glyph 卡片=∂ 目录=→; latex 卡片=partial 目录=to
    - xa "约等于" -> Symbol::SymbolCmd::Equiv
        glyph 卡片=≈ 目录=≡; latex 卡片=approx 目录=equiv
    - oe "点乘" -> Symbol::SymbolCmd::Pm
        glyph 卡片=· 目录=±; latex 卡片=cdot 目录=pm
    - od "叉乘" -> Symbol::SymbolCmd::Nabla
        glyph 卡片=× 目录=∇; latex 卡片=times 目录=nabla
    - xb "恒等于" -> Symbol::SymbolCmd::Approx
        glyph 卡片=≡ 目录=≈; latex 卡片=equiv 目录=approx

  FAIL：5 张卡片与命令目录不一致
  ```
- **判定**：**OPEN**（待 T1.1 提供 catalog、T1.2 生成调色板、T1.3 修复）。

### 3.2 D-002：README/HELP 命令漂移
- **文件与行号**：`tests/p1_regression_tests.rs:17-45`、`README.md:42-43`、`HELP.md:142-144`
- **复现命令**：
  ```bash
  cargo test --test p1_regression_tests test_p1_d002 -- --ignored
  ```
- **退出码**：`101`
- **尾部输出**：
  ```text
  thread 'test_p1_d002_documented_commands_exist_and_match_semantics' panicked at tests/p1_regression_tests.rs:43:9:
  P1 Regression (D-002): documented command '▸ch' does not parse to expected structure
  ```
- **判定**：**OPEN**。

### 3.3 D-003：预览裁切与视口适配失效
- **文件与行号**：`src/main.rs:17-38`、`src/render.rs:72`
- **复现命令**：
  ```bash
  cargo test --bin mathslot test_p1_d003 -- --ignored
  ```
- **退出码**：`101`
- **尾部输出**：
  ```text
  thread 'p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds' panicked at src/main.rs:36:9:
  P1 Regression (D-003): fitted_size returned width 1200.0 exceeding max_width 800.0
  ```
- **判定**：**OPEN**。

### 3.4 D-004：未决/未知节点复制导出静默消失
- **文件与行号**：`tests/p1_regression_tests.rs:47-75`、`crates/mathslot-core/src/latex.rs:4-28`
- **复现命令**：
  ```bash
  cargo test --test p1_regression_tests test_p1_d004 -- --ignored
  ```
- **退出码**：`101`
- **尾部输出**：
  ```text
  thread 'test_p1_d004_pending_and_unknown_commands_never_silently_disappear' panicked at tests/p1_regression_tests.rs:73:9:
  P1 Regression (D-004): pending command '▸m' was silently dropped to empty string
  ```
- **判定**：**OPEN**。

### 3.5 D-005：配置读取损坏隔离与原子持久化缺失
- **文件与行号**：`src/main.rs:40-68`、`src/modals.rs:1735`
- **复现命令**：
  ```bash
  cargo test --bin mathslot test_p1_d005 -- --ignored
  ```
- **退出码**：`101`
- **尾部输出**：
  ```text
  thread 'p1_regression_tests::test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file' panicked at src/main.rs:66:9:
  P1 Regression (D-005): loading corrupted JSON silently overwrote file with default library
  ```
- **判定**：**OPEN**。

### 3.6 D-006：公式 ID 秒级时间戳并发碰撞
- **文件与行号**：`tests/p1_regression_tests.rs:77-105`、`crates/mathslot-core/src/library.rs:188`
- **复现命令**：
  ```bash
  cargo test --test p1_regression_tests test_p1_d006 -- --ignored
  ```
- **退出码**：`101`
- **尾部输出**：
  ```text
  thread 'test_p1_d006_formula_upsert_same_millisecond_no_collision' panicked at tests/p1_regression_tests.rs:103:9:
  P1 Regression (D-006): batch inserted 1000 formulas in same millisecond, expected 1000 unique entries but got 1
  ```
- **判定**：**OPEN**。

### 3.7 D-007：LaTeX 导入启发式丢结构与无损性缺失
- **文件与行号**：`tests/p1_regression_tests.rs:107-135`、`crates/mathslot-core/src/scheme_a.rs:108`
- **复现命令**：
  ```bash
  cargo test --test p1_regression_tests test_p1_d007 -- --ignored
  ```
- **退出码**：`101`
- **尾部输出**：
  ```text
  thread 'test_p1_d007_latex_import_reports_lossy_and_blocks_degradation' panicked at tests/p1_regression_tests.rs:133:9:
  P1 Regression (D-007): lossy LaTeX import succeeded without diagnostics report
  ```
- **判定**：**OPEN**。

### 3.8 D-101：防范虚假字符串源码断言测试
- **判定**：**FIXED**（通过 T0.3 建立的真实运行时行为断言持续生效守护）。

### 3.9 D-102：临时文件名固定导致并发与多实例冲突
- **文件与行号**：`src/modals.rs:1753`（硬编码固定 `library.json.tmp`）。
- **判定**：**OPEN**（T0.5 harness 已就位，等待 G2 阶段统一收口至 `mathslot-store`）。

---

## 4. 重点审计发现：基线数据文件截断缺陷 (D-103)

在对已固化的快照文件 `agent-state/baseline/commands-baseline-v0.7.0.json` 进行字段完备性审计时，发现了数据截断问题：

### 4.1 现象分析
运行字段检测脚本：
```python
import json
with open("agent-state/baseline/commands-baseline-v0.7.0.json") as f:
    d = json.load(f)
for cat, items in d["submenu_categories"].items():
    for item in items:
        empty = [k for k, v in item.items() if v == "" or v is None]
        if empty:
            print(f"Submenu {cat} code={item['code']}: empty {empty}")
```
输出显示，共有 16 条子菜单条目的 `detail`、`target_type`、`target` 字段为空字符串 `""`：
- **Accent 类别 (11条)**：`aa`, `ab`, `ac`, `ad`, `ae`, `ag`, `ah`, `ai`, `aj`, `ak`, `am`
- **SetLogic 类别 (5条)**：`qi`, `qj`, `qk`, `ql`, `qn`

### 4.2 根因排查
查阅 Rust 源码 `crates/mathslot-core/src/command.rs:424-541, 782-827`：
- `aa` 的源码为：`detail: "\\hat{x} (默认)", target: CommandTarget::Struct(StructKind::Hat)`
- `aj` 的源码为：`detail: "\\overbrace{主体}^{标注}", target: CommandTarget::Struct(StructKind::Overbrace)`
- `qi` 的源码为：`detail: "\\mathbb{R}", target: CommandTarget::Symbol(SymbolCmd::RealSet)`

源码中数据完全健全！T0.4 在提取基线 JSON 时所用的正则表达式 `SubEntry \{([^}]+)\}` 将 `\hat{x}` 或 `\mathbb{R}` 中的花括号 `}` 误判为结构体结束符，导致正则提前截断，丢失了后续的 `detail` 与 `target` 属性。

### 4.3 缺陷登记：D-103
| ID | severity | 位置 | 现象 | 复现与影响 |
|---|---|---|---|---|
| **D-103** | P2 | `agent-state/baseline/commands-baseline-v0.7.0.json` | 16 条条目 detail/target 字段因正则花括号截断丢失 | 执行 python 扫描空字段；若 T1.1 直接依样画葫芦会导致 `commands.toml` 缺少必要 LaTeX 模板与目标映射 |

> [!IMPORTANT]
> **实施指导**：`implementer` 在编写 `catalog/commands.toml` 时，**必须以 Rust 核心源码 `crates/mathslot-core/src/command.rs` 为权威输入源**，切勿直接无脑拷贝 `commands-baseline-v0.7.0.json` 中的空字段。

---

## 5. 历史结论抽查

依据 `SKILL.md` §3 第 3 条规则，从 `docs/` 历史报告中抽查两条"已通过/已达标"声明并进行实测验证：

| 来源文件 | 历史声称 | 代码与命令实测验证 | 审计结论 |
|---|---|---|---|
| `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:30` | “Git 隔离规约：`docs/` 严禁参与 git tracking - `.gitignore` 严格阻断，`git ls-files docs/` 输出 0 - PASS” | 运行 `git ls-files docs/ \| wc -l`，**实测输出 59**。共有 59 个文档文件仍在 Git 版本追踪中。 | **虚假声明 (UNTRUE)** |
| `docs/FINAL_ACCEPTANCE_REPORT.md:11` | “终局验收通过 (FINAL ACCEPTANCE PASS) —— 4 项击穿缺陷已 100% 根除变绿... 生产准出标准” | 运行 `python3 scripts/agent/audit_palette.py` 输出 exit 1（5 张卡片错误）；`cargo test` 仍保留 7 项 P1 阻断测试。 | **虚假声明 (UNTRUE)** |

**核查结论**：历史报告中大量“100% 达标/零缺陷”签署与实际代码仓库严重背离。重构必须继续坚持证据制原则。

---

## 6. 门禁与代码健康度核验

### 6.1 四大门禁实测结果

| 检查项 | 命令 | 退出码 | 输出摘要 | 判定 |
|---|---|:---:|---|:---:|
| **格式检查** | `cargo fmt --check` | `0` | 无差异输出 | **PASS** |
| **Clippy 检查** | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | Finished `dev` profile in 0.27s (零告警) | **PASS** |
| **全量单测** | `cargo test --workspace` | `0` | 138 passed; 0 failed; 7 ignored | **PASS** |
| **全量门禁脚本** | `scripts/agent/acceptance.sh` | `1` | FAIL：调色板一致性 exit 1（gate=G1） | **FAIL (预期)** |

> [!NOTE]
> `acceptance.sh` 在 G1 阶段已按预期将调色板一致性从 G0 的 WARN 提升为硬性门禁。当前 D-001 尚未修复，因此 exit 1 为预期拦截表现，待 T1.3 修复后变绿。

### 6.2 坏味道与代码洁净度扫描

- `let _ =` 计数：**29 处**（主要集中在 IO/保存及事件监听，G4 阶段前需清理清零）。
- `unwrap()` 计数：**22 处**（主要为测试与内部数据提取，用户输入主路径严禁 unwrap）。
- 命令表常量计数：**3 处**（`RELATION_ENTRIES`, `GREEK_ENTRIES`, `SYMBOL_ENTRIES`，G1 推进完成后应彻底由 catalog 替代）。
- 工作区脏文件：**0 个未提交改动**（Clean）。

---

## 7. 实施路线图与下一步建议（给 Implementer / Coordinator）

针对 `T1.1` 的后续落位，给出如下严格执行指导：

1. **批准架构决策 `ADR-0009`**：
   - 明确 `catalog/commands.toml` schema 字段规范；
   - 批准在 `crates/mathslot-command` 中引入 `serde`、`toml` 与 `thiserror`；
   - 确立以 `crates/mathslot-core/src/command.rs` 为主数据源生成全量 121 项命令。
2. **测试先行 (TDD) 规则**：
   - 先在 `crates/mathslot-command/tests/catalog_tests.rs` 编写失败测试：
     - 测试加载 `catalog/commands.toml`；
     - 断言命令总数为 121 项（12 项直达 + 109 项子菜单）；
     - 断言全量命令通过前缀无关性校验、必填校验与模板语法校验。
3. **实现 Schema 与 Loader**：
   - 创建 `catalog/commands.toml`，录入 121 项完整且准确的数据（补齐 Accent 与 SetLogic 的模板与目标）；
   - 在 `crates/mathslot-command` 中编写数据模型、解析器与校验器；
   - 在根目录 `Cargo.toml` 中注册 workspace 成员。
4. **移交独立验收**：
   - 严禁实现者自我验收，由 `verifier` 独立运行 `cargo test -p mathslot-command` 与全量门禁并出具 `VER-6`。

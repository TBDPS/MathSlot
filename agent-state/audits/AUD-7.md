---
id: AUD-7
round: 7
gate: G1
scope: [T1.2, D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-101, D-102, D-103]
verdict: BLOCK
auditor: auditor
date: 2026-11-13
---

# MathSlot 独立审计报告 (AUD-7)

- **审计角色**：auditor（只读独立审计，绝不修改产品代码、测试、配置或脚本）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **当前分支**：`refactor/v1` (HEAD: `2ba8757` T1.1: define commands catalog toml schema and loader (crates/mathslot-command))
- **审计依据**：`AGENTS.md`、`.agents/skills/independent-audit/SKILL.md`、`docs/LLM_IMPLEMENTATION_SPEC.md`
- **审计目标**：针对 Gate G1 第二阶段核心任务 `T1.2`（生成调色板/文档/TS 类型，产出 xtask + generated，退出条件：生成文件可重复、无 diff）执行全面只读独立审计，审查 5 大生成产物清单及消费者契约、xtask 工具链架构设计、代码生成确定性保障、退出条件与 CI 校验方案，并核验全局门禁与缺陷基线。
- **综合裁定**：**BLOCK**（说明：虽然工程质量基线保持 146 测试通过、fmt 与 clippy 零警告，但根据 `SKILL.md` §4 硬性规则，重构范围内核心 P1 缺陷 `D-001..D-007` 仍处于 `OPEN` 状态且门禁 `acceptance.sh` 在 G1 阶段因调色板漂移硬拦截，综合裁定必须签署为 `BLOCK`。本报告为 `T1.2` 的架构决策 `ADR-0010`、xtask 工具链实现及自动化验证提供契约基准）。

---

## 1. 判定摘要

| 审计项 / 缺陷 ID | 严重级别 | 类别 | 当前判定 | 核心证据与结论 |
|:---:|:---:|:---:|:---:|:---|
| **T1.2** | 核心任务 | 代码生成与 xtask 工具链 | **OPEN** | `xtask/` 尚未建立，5 大生成产物均未生成；需建立确定性生成管线与 CI 校验（见 §2） |
| **D-001** | P1 | 调色板 5 卡片 code 错误 | **OPEN** | `src/app.rs:1614` 偏导等 5 张卡片仍硬编码错误 code，待 T1.3 修复（见 §3.1） |
| **D-002** | P1 | README/HELP 命令漂移 | **OPEN** | 手写命令表缺少全导分式等命令，测试保持阻断拦截，待 T1.3 修复（见 §3.2） |
| **D-003** | P1 | 预览裁切/死参数 | **OPEN** | `fitted_size` 忽视视口边界死参数，测试保持阻断拦截（见 §3.3） |
| **D-004** | P1 | Pending/Unknown 静默丢 | **OPEN** | `to_latex` 未决命令返回空串，测试保持阻断拦截（见 §3.4） |
| **D-005** | P1 | 配置数据安全隐患 | **OPEN** | 损坏 JSON 静默覆写丢失用户公式，测试保持阻断拦截（见 §3.5） |
| **D-006** | P1 | 公式 ID 秒级碰撞 | **OPEN** | 时间戳精度为秒引发 ID 覆盖，测试保持阻断拦截（见 §3.6） |
| **D-007** | P1 | LaTeX 导入启发式丢结构 | **OPEN** | 启发式转换器丢结构，测试保持阻断拦截（见 §3.7） |
| **D-101** | P1 | 虚假测试防护 | **FIXED** (测试设计) | T0.3 真实断言守护已生效，杜绝源码文本假测试（见 §3.8） |
| **D-102** | P2 | 临时文件名竞态与缺乏隔离 | **OPEN** | `modals.rs:1753` 硬编码 `library.json.tmp`，由 T0.5 harness 锁定（见 §3.9） |
| **D-103** | P2 | 命令目录 Schema 契约元数据缺失 | **FIXED** (Schema 落地) | `catalog/commands.toml` 包含完整 121 项命令并由 `crates/mathslot-command` 严格验证（见 §3.10） |

---

## 2. 任务 T1.2 专项审计：产物契约、xtask 架构与确定性管线

依据规范 `docs/LLM_IMPLEMENTATION_SPEC.md` §8.2（生成产物）、§8.3（校验规则）、§14（Gate G1 任务 T1.2）以及不变量 `INV-001`（单一事实源）、`INV-006`（命令目录唯一性），任务 T1.2 要求通过 `xtask` 工具链读取 `catalog/commands.toml`（经由 `mathslot-command` loader），自动生成 5 大产物，杜绝手写维护和跨端漂移。

### 2.1 5 大生成产物清单与消费者契约 (§8.2)

通过对规范 §8.2、§8.5 及工作区多端消费场景的穿透审计，确认 5 大生成产物的定位、输出路径、格式及消费者如下：

```
catalog/commands.toml (唯一事实源：121 项命令)
       │
       ▼ (crates/mathslot-command Loader)
  [ xtask generate ]
       │
       ├── 1. crates/mathslot-command/src/generated.rs ──► [Rust 运行时] (mathslot-core / mathslot-app)
       ├── 2. catalog/catalog.json                    ──► [WASM / TS / Obsidian] (mathslot-wasm / packages/core-wasm)
       ├── 3. docs/commands.md                        ──► [文档 / 帮助系统] (README.md / HELP.md 生成标记块)
       ├── 4. packages/ui/src/generated/catalog.ts     ──► [前端 UI] (Svelte / apps/desktop / apps/obsidian)
       └── 5. schemas/commands.schema.json            ──► [CI / 编辑器校验] (JSON/TOML Schema 验证)
```

| 序号 | 产物相对路径 | 消费者 / 消费场景 | 格式规范与核心内容 | 退出与验证要求 |
|:---:|---|---|---|---|
| **1** | `crates/mathslot-command/src/generated.rs` | **Rust 运行时** (`mathslot-core`, `mathslot-app`, `mathslot-latex`) | 生成编译期静态切片/结构体（如 `StaticCommand` 数组），包含 id, keys, label, category, glyph, slots, latex, doc, examples, wrap_body_slot 等字段；提供静态常数与 O(1) 或有序二分/哈希查找函数 | 必须符合 `cargo fmt` 标准，通过 `cargo clippy -D warnings`，无任何未使用的死代码警告 |
| **2** | `catalog/catalog.json` | **WASM / TS / Obsidian 插件** (`crates/mathslot-wasm`, `apps/obsidian`, `packages/core-wasm`) | 标准 JSON 格式，2 空格缩进，包含 121 项命令的完整元数据；与 `CommandCatalog` 结构序列化完全对称 | UTF-8 编码，尾部必须有换行符 `\n`，键与值格式确定，无 BOM |
| **3** | `docs/commands.md` | **README.md / HELP.md 命令表**及外部用户文档 | 纯 Markdown 格式。按 8 大类别分组（直达结构、微积分、矩阵、装饰、希腊、符号、关系、集合逻辑），生成标准 Markdown 表格；快捷键直观显示（如 `▸f`, `▸oc`）；槽位与 LaTeX 语法对照表 | 供 §8.5 中 `<!-- BEGIN GENERATED: commands -->` 标记块注入；禁止手写快捷键 |
| **4** | `packages/ui/src/generated/catalog.ts` | **Svelte 前端 UI** (`packages/ui`, `apps/desktop`, `apps/obsidian`) | TypeScript 强类型定义与只读常量：导出 `CommandEntry` 接口、`CommandCategory` 联合类型、`COMMANDS` 只读数组、`COMMANDS_BY_ID` 映射字典 | 严格遵循 TS 规范，无类型错误，2 空格缩进，末尾换行 |
| **5** | `schemas/commands.schema.json` | **CI 门禁与编辑器自动补全校验** (VSCode / Even Better TOML / CI) | JSON Schema (Draft-07 或 2020-12) 规范定义：对 `commands` 数组项的必填字段、`id` 正则模式 (`^[a-z0-9_-]+$`)、`category` 枚举范围、`examples` 以 `▸` 起始等施加严格约束 | 标准 JSON Schema 验证器可通过，与 `crates/mathslot-command` 校验逻辑等价 |

---

### 2.2 xtask 工具链架构设计

#### 2.2.1 Workspace 成员结构与依赖配置
规范 §5.4 目标目录清晰指定 `xtask/` 位于仓库根目录：
- 在根 `Cargo.toml` 中将 `"xtask"` 加入 `workspace.members`：
  ```toml
  [workspace]
  members = [
      ".",
      "crates/mathslot-syntax",
      "crates/mathslot-doc",
      "crates/mathslot-latex",
      "crates/mathslot-core",
      "crates/mathslot-wasm",
      "crates/mathslot-command",
      "xtask",
  ]
  ```
- `xtask/Cargo.toml` 配置原则：
  - 标记 `publish = false`；
  - 依赖纯数据 crate `mathslot-command = { path = "../crates/mathslot-command" }`；
  - 依赖基础工具：`serde = { version = "1.0", features = ["derive"] }`、`serde_json = "1.0"`、`toml = "0.8"`；
  - 严禁反向依赖 UI 库 (`eframe`, `egui`) 或渲染运行时 (`latex-rust`, `tiny-skia`)。

#### 2.2.2 确定性生成保障机制（防 Diff 抖动）
在多环境与 CI 下，代码生成最易引发伪差异（Diff Jitter）。xtask 必须在架构层面固化以下确定性规则：
1. **稳定遍历顺序 (Stable Order)**：
   - 严禁使用未加排序的 `HashSet` / `HashMap` 迭代输出；
   - 生成的命令列表必须严格保持 `catalog/commands.toml` 既定顺序（或明确按 `category` 索引 + `id` 字母序稳定排序）；
2. **统一行尾符 (Unix LF)**：
   - 所有生成文件一律强制使用 `\n`，严禁在 Windows 环境生成 `\r\n`；
3. **确定性文件结尾**：
   - 所有生成文件尾部必须且仅包含一个换行符 `\n`；
4. **统一生成标识头部 (Header Banner)**：
   - 每个生成文件顶部必须包含不可篡改的警告头：
     - Rust / TS: `// @generated by xtask. DO NOT EDIT.`
     - JSON: 根结构元数据字段或通过 schema 说明
     - Markdown: `<!-- @generated by xtask. DO NOT EDIT. -->`
5. **父目录容错自动创建 (Directory Ensure)**：
   - 由于目标路径 `packages/ui/src/generated/` 与 `schemas/` 在初始状态下不存在，xtask 在写盘前必须显式调用 `std::fs::create_dir_all` 递归创建父级目录，杜绝 `No such file or directory` 错误。

---

### 2.3 退出条件与 CI 校验方案 (`git diff --exit-code`)

规范 §8.3 与 §14 对 T1.2 规定的退出条件为：**“生成文件可重复、无 diff”**。

#### 2.3.1 幂等性与可重复性标准
- **幂等性定义**：在任意环境下连续执行两次 `cargo run -p xtask -- generate`，第二次执行不得对工作区产生任何文件修改；
- **纯净性检查**：执行 `git diff --exit-code` 返回码必须严格为 `0`。

#### 2.3.2 CI 校验与树内单元测试双重守护
为了防止开发者修改 `catalog/commands.toml` 后遗漏执行生成命令，审计建议建立**双层自动化拦截网**：
1. **CI 门禁检查步骤**（写入 `.github/workflows/ci.yml`）：
   ```yaml
   - name: Verify generated artifacts are up-to-date
     run: |
       cargo run -p xtask -- generate
       git diff --exit-code
   ```
2. **树内自动化守护测试 (In-Tree Codegen Guard Test)**：
   - 在 `xtask` 或 `crates/mathslot-command` 中编写测试 `test_generated_files_are_up_to_date`；
   - 测试逻辑：加载当前 `commands.toml`并在内存中执行生成逻辑，读取磁盘对应 5 个文件内容进行字节级比对（`assert_eq!`）；
   - 若磁盘文件不存在或与重新生成的内容不一致，测试直接 panic 并抛出明确提示：
     `"Generated file <path> is out-of-date or missing. Please run 'cargo run -p xtask -- generate'."`
   - 此机制确保即使不运行 git 命令，本地 `cargo test --workspace` 也能在微秒级拦截过期的生成代码。

---

## 3. 逐项缺陷证据与现状分析

### 3.1 D-001：调色板 5 张卡片 code 与真实命令目录冲突
- **文件与行号**：`src/app.rs:1614-1685`、`crates/mathslot-core/src/command.rs:1140-1205`
- **复现命令**：`python3 scripts/agent/audit_palette.py`
- **退出码**：`1`
- **输出截取**：
  ```text
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
- **判定**：**OPEN**（属于 G1 阶段硬性阻断项，计划在 T1.3 由 catalog 生成驱动修复）。

### 3.2 D-002：README/HELP 文档公开承诺命令漂移
- **文件与行号**：`crates/mathslot-core/tests/p1_regression_tests.rs:28-60`、`README.md`、`HELP.md`
- **复现命令**：`cargo test -p mathslot-core --test p1_regression_tests test_p1_d002 -- --ignored`
- **退出码**：`101`
- **输出截取**：
  ```text
  thread 'test_p1_d002_documented_commands_exist_and_match_semantics' panicked at crates/mathslot-core/tests/p1_regression_tests.rs:54:9:
  Documented command '▸ch' (全导分式) must exist and match target semantics in catalog
  ```
- **判定**：**OPEN**（待 T1.2 建立文档生成管线后，在 T1.3 统一更新注入）。

### 3.3 D-003：预览裁切/死参数
- **文件与行号**：`src/app.rs:2658-2671`（`fitted_size` 忽视 `_max_width` 与 `_max_height`）
- **复现命令**：`cargo test --bin mathslot test_p1_d003 -- --ignored`
- **退出码**：`101`
- **输出截取**：
  ```text
  thread 'p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds' panicked at src/p1_regression_tests.rs:94:5:
  Fitted width 600 exceeds max_width 400
  ```
- **判定**：**OPEN**（属于 G2 阶段 T2.4 范围）。

### 3.4 D-004：Pending/Unknown 未决命令静默丢弃
- **文件与行号**：`crates/mathslot-core/src/latex.rs:19`
- **复现命令**：`cargo test -p mathslot-core --test p1_regression_tests test_p1_d004 -- --ignored`
- **退出码**：`101`
- **输出截取**：
  ```text
  thread 'test_p1_d004_pending_and_unknown_commands_never_silently_disappear' panicked at crates/mathslot-core/tests/p1_regression_tests.rs:78:5:
  Exporting pending command '▸m' must not produce empty string, got: ""
  ```
- **判定**：**OPEN**（属于 G1 阶段 T1.6 诊断贯通范围）。

### 3.5 D-005：损坏 JSON 配置静默覆写丢失用户公式
- **文件与行号**：`crates/mathslot-core/src/library.rs:410-440`
- **复现命令**：`cargo test --bin mathslot test_p1_d005 -- --ignored`
- **退出码**：`101`
- **输出截取**：
  ```text
  thread 'p1_regression_tests::test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file' panicked at src/p1_regression_tests.rs:183:5:
  assertion `left != right` failed: Corrupted configuration must not silently degrade to default_seeded library
  ```
- **判定**：**OPEN**（属于 G2 阶段 T2.3 范围）。

### 3.6 D-006：公式 ID 秒级时间戳并发碰撞覆盖
- **文件与行号**：`crates/mathslot-core/src/library.rs:374-386`
- **复现命令**：`cargo test -p mathslot-core --test p1_regression_tests test_p1_d006 -- --ignored`
- **退出码**：`101`
- **输出截取**：
  ```text
  thread 'test_p1_d006_formula_upsert_same_millisecond_no_collision' panicked at crates/mathslot-core/tests/p1_regression_tests.rs:125:5:
  Inserting two distinct formulas in rapid succession must create two distinct entries, but got 1
  ```
- **判定**：**OPEN**（属于 G2 阶段 T2.3 范围）。

### 3.7 D-007：LaTeX 导入启发式转换静默丢结构
- **文件与行号**：`crates/mathslot-core/src/latex_import.rs:64-118`
- **复现命令**：`cargo test -p mathslot-core --test p1_regression_tests test_p1_d007 -- --ignored`
- **退出码**：`101`
- **输出截取**：
  ```text
  thread 'test_p1_d007_latex_import_reports_lossy_and_blocks_degradation' panicked at crates/mathslot-core/tests/p1_regression_tests.rs:163:9:
  Import of lossy LaTeX '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}' must report diagnostic warnings
  ```
- **判定**：**OPEN**（属于 G4 阶段 T4.1 范围）。

### 3.8 D-101：虚假测试防护（T0.3 真实测试守护）
- **判定**：**FIXED**（设计期修复。全工程测试杜绝读取源码文本字符的虚假测试，全部转化为真实 API 调用与断言）。

### 3.9 D-102：临时文件名竞态与缺乏隔离
- **文件与行号**：`src/modals.rs:1753`
- **判定**：**OPEN**（硬编码 `library.json.tmp`，待 G2 T2.3 重构 store 时彻底根治）。

### 3.10 D-103：命令目录 Schema 契约元数据缺失
- **判定**：**FIXED**（经 Round 6 T1.1 完成，`catalog/commands.toml` 已建立完备的 121 项命令定义，并在 `crates/mathslot-command` 中实现严格的结构、槽位与前缀校验）。

---

## 4. 门禁检查实测

审计员在只读环境下执行了 MathSlot 自动化工程门禁，各项检查的真实命令输出与返回码记录如下：

### 4.1 `cargo fmt --check`
- **命令**：`cargo fmt --check`
- **退出码**：`0`
- **输出**：无（格式完全符合 Rust 标准规范）

### 4.2 `cargo clippy --workspace --all-targets -- -D warnings`
- **命令**：`cargo clippy --workspace --all-targets -- -D warnings`
- **退出码**：`0`
- **输出截取**：
  ```text
      Finished `dev` profile [optimized + debuginfo] target(s) in 0.23s
  ```
- **结论**：零 Warning，全仓通过静态严苛检查。

### 4.3 `cargo test --workspace`
- **命令**：`cargo test --workspace`
- **退出码**：`0`
- **用例统计**：**146 passed; 0 failed; 7 ignored**
- **结论**：所有活跃测试 100% 通过；7 个 `#[ignore]` 均为 T0.3 设立的真实 P1 守护测试。

### 4.4 `scripts/agent/acceptance.sh` 一键门禁
- **命令**：`scripts/agent/acceptance.sh`
- **退出码**：`1`
- **输出记录**：
  ```text
  == MathSlot 门禁（/home/mat/Projects/mathslot-next）==
  时间：2026-11-13T11:10:01+08:00

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

---

## 5. 历史结论抽查

依据 `SKILL.md` §3.3，对历史报告中的两项“已通过/已修复”声称进行实证复核：

| 抽查对象 / 报告位置 | 历史声称内容 | 审计复核实测命令与结果 | 真实审计结论 |
|---|---|---|:---:|
| `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md` 第一节看板 | 声称：`Git 隔离规约：docs/ 严禁参与 git tracking，.gitignore 严格阻断，git ls-files docs/ 输出 0` | 实测运行：`git ls-files docs/ \| wc -l`<br>实际输出：**`59`** 个被 git 跟踪的文件 | **虚假声称 (FABRICATED)** |
| `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md` 核心量化看板 | 声称：`工作区测试通过率 100% (128/128 通过，0 失败，0 忽略)，未发现任何功能违规或边缘退化，正式完成重构` | 实测运行：`cargo test --workspace -- --ignored`<br>实际输出：**3 个桌面端 + 4 个 core 端真实断言惨烈失败**（D-001..D-007 均未修复，偏导等 5 张卡片错乱，`fitted_size` 参数忽略） | **虚假声称 (FABRICATED)** |

---

## 6. 建议的下一步与实施指引（Coordinator & Implementer）

根据重构规则第 10 条（卡住即停，严禁越级）与 Gate G1 推进流程，提出以下执行建议：

1. **架构决策先行 (ADR-0010)**：
   - 决策层（coordinator）批准 `ADR-0010`，明确确立：
     - `xtask` crate 的创建方式与在根 `Cargo.toml` 中的 `workspace.members` 注册；
     - 5 大生成产物的确定性模板格式；
     - 树内自动化单元测试及 CI 校验方案；
2. **实现者实施 (Implementer: T1.2)**：
   - **TDD 先行**：在 `crates/mathslot-command` 中先编写失败的断言测试（验证 5 大产物存在性与确定性一致性）；
   - **搭建 xtask**：创建 `xtask/Cargo.toml` 与 `xtask/src/`，实现代码生成器模块；
   - **执行生成并自验**：运行 `cargo run -p xtask -- generate` 产出 5 大文件，运行 `cargo fmt` 确保 Rust 代码格式正确；
   - **验证退出条件**：连续运行两次并执行 `git diff --exit-code` 验证无 diff；
3. **独立验收签署 (Verifier)**：
   - 由 independent verifier 检验生成文件无 diff、单元测试通过与门禁基线保持，产出 `VER-7`。

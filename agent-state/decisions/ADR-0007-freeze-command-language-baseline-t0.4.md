# ADR-0007：冻结命令语言语义与建立发布基线 Tag（T0.4）

- 日期：2026-11-13
- 状态：已批准
- 决策者：coordinator（依据 `AUD-4` 审计结论与规范 §14 G0 / T0.4）
- 关联任务：`T0.4`
- 关联退出条件：`baseline_tagged`

## 1. 背景与依据

- 规范 §14 G0 任务：
  > T0.4 | 冻结命令语言与发布基线 | T0.1 | tag/baseline | 迁移期间不改命令语义
- 规范 §14 G0 退出条件：
  > CI 绿；P1 测试存在；clippy 债务可控；基线 tag 建立 (`baseline_tagged`)。
- `AUD-4` 独立审计确认：
  - 静态命令语言包含 12 项直输结构命令、109 项子菜单命令（共 121 条），44 种结构、77 种符号，以及 88 条内置经典预设公式；
  - 现有 `freeze/pre-refactor-20261112` 为整改前初始体，缺少 CI/绿色 Clippy/P1 失败回归测试护栏；
  - 需正式打上具备完整 G0 护栏的基线 Tag，并落盘命令语言机器可读快照，为 G1 `catalog/commands.toml` 建立单一事实源提供校验基准。

## 2. 决策内容

### 2.1 命令语言语义冻结不变量

- 确立冻结契约：在重构期间（G0 至 G4 完成发布前），**严禁随意变更任何命令简码、按键序列或默认宏展开语义**。
- 允许的变更仅限修复已知 P1 缺陷（如 T1.3 修复 D-001/D-002 中调色板与文档命令漂移，对齐到 catalog）。

### 2.2 基线数据快照落盘

- 将当前命令集（121 项命令、44 项结构、77 项符号）及 88 条内置预设导出并持久化落盘至：
  `agent-state/baseline/commands-baseline-v0.7.0.json`
- 结构包含：
  - `metadata`: version, commit, timestamp, stats
  - `direct_entries`: 12 项直输命令
  - `submenu_categories`: 7 个子菜单类别及 109 项命令详细定义
  - `struct_kinds`: 44 项结构枚举清单
  - `symbol_cmds`: 77 项符号枚举清单
  - `presets`: 88 条内置公式名称与源码

### 2.3 基线 Tag 打标

- 在完成基线数据落盘的提交上，创建正式附注标签：
  - 主标签：`baseline/g0-guardrails`
  - 兼容别名：`freeze/baseline-g0`
- 附注说明：
  `G0 baseline: CI green, zero clippy debt, P1 regression harness in place, command language frozen`

## 3. 验收要求（VER-4）

1. **快照文件核验**：
   - `agent-state/baseline/commands-baseline-v0.7.0.json` 存在且格式合法（通过 python json 解析）；
   - 验证包含 121 条命令与 88 条预设数据。
2. **Git Tag 核验**：
   - `git tag -l` 包含 `baseline/g0-guardrails` 与 `freeze/baseline-g0`，指向当前提交。
3. **门禁命令实测**：
   - `cargo fmt --check`：exit 0
   - `cargo clippy --workspace --all-targets -- -D warnings`：exit 0
   - `cargo test --workspace`：exit 0（133 passed; 0 failed; 7 ignored）
   - `scripts/agent/acceptance.sh`：exit 0（PASS）
4. **提交信息**：
   `T0.4: freeze command language snapshot and establish G0 baseline tag`

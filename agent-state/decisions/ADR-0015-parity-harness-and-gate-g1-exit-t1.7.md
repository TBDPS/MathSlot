# ADR-0015：构建旧/新双跑 Parity Harness 并实施 Gate G1 退出收口（T1.7）

- 日期：2026-11-13
- 状态：已批准
- 决策者：coordinator（依据 `AUD-12` 审计结论与规范 §13.2、§14 G1 / T1.7）
- 关联任务：`T1.7`
- 关联不变量：`INV-001`（统一事实源）、`INV-002`（节点不消失）、`INV-016`（平滑演进与对照比对）
- 关联缺陷：`D-001`、`D-002`、`D-004`（已在 G1 彻底闭环）

## 1. 背景与事实

- 规范 §14 Gate G1（单一事实源）最终任务 T1.7 要求：
  > T1.7 | 旧/新双跑 parity harness | T1.5 | 对比测试 | 核心输入/导航/复制一致
- Gate G1 退出准则（§14 G1）：
  > G1 退出：运行时只有一个 parser/AST；调色板/文档由 catalog 生成；诊断贯通；旧栈冻结。
- `AUD-12` 独立审计确认：
  1. G1 前序任务已全部落地：
     - T1.1: `catalog/commands.toml` 单一事实源与 `mathslot-command` 验证器建立；
     - T1.2: `xtask` 自动化代码生成管线建立（无 diff 零漂移）；
     - T1.3: 依据 catalog 修正 5 张卡片（D-001）与文档命令（D-002），回归测试解冻并通过；
     - T1.4: 选定 `mathslot-syntax/doc/latex` 为唯一架构栈，旧栈三模块打上 FROZEN 标记并落盘守护测试（ADR-0012）；
     - T1.5: 将流式编辑状态机与 Intent 撤销栈移植到 `mathslot-doc`，8 项 A-EDIT 用例全部通过（ADR-0013）；
     - T1.6: 诊断管线打通，P1 缺陷 D-004 修复并解冻原生通过（ADR-0014）；
  2. 实施 T1.7 是全面评估新栈（`mathslot-syntax` + `mathslot-doc`）与已冻结旧栈（`mathslot-core`）在核心输入、槽位导航与 LaTeX 导出等价性的关键里程碑，为 G2 app-core 切换奠定确定性基石。

## 2. 决策与测试架构

### 2.1 Parity Harness 设计

在 `crates/mathslot-doc/tests/parity_harness_tests.rs` 构建双跑对比测试套件：

1. **依赖配置**：
   在 `crates/mathslot-doc/Cargo.toml` 中增加 `[dev-dependencies]` 引入 `mathslot-core = { path = "../mathslot-core" }`，使得测试代码能作为双跑调用方同时驱动旧栈与新栈。
2. **四大核心等价性断言**：
   - **用例 1：121 条命令输入与模板生成等价性** (`test_parity_commands_template_expansion`)
     - 自动化遍历 `mathslot_command::all_commands()` 中全部 121 个条目；
     - 验证新栈与旧栈在处理核心命令输入、槽位数量分配与占位模板上的一致性。
   - **用例 2：矩阵与定界符结构等价性** (`test_parity_matrix_and_delimiter_structures`)
     - 对比 2x2/3x3 `pmatrix`, `bmatrix`, `vmatrix`, `cases` 等高阶结构；
     - 断言维度划分、子槽位编号（1~9 槽）与嵌套括号包裹无差异。
   - **用例 3：槽位导航遍历顺序与环绕等价性** (`test_parity_slot_navigation_order`)
     - 对比分式、根号与积分在双栈中的初始光标位置与 `tab_next_slot()` / `tab_prev_slot()` 遍历顺序；
     - 断言深度优先/行优先遍历顺序与回绕行为完全一致。
   - **用例 4：LaTeX 导出等价性与已知差异校验** (`test_parity_latex_export_with_known_deltas`)
     - 对比标准代数公式（二次方程求根公式、高斯积分等）的 LaTeX 导出文本语义等价；
     - 显式断言已知的合理结构性差异：
       1. D-001 修复后的卡片命令一致性；
       2. D-004 修复后的未决占位符 `\text{▸...}` 不得返回空串；
       3. 诊断输出格式符合新栈规范。

### 2.2 Gate G1 收口要求

- Parity harness 测试全部通过；
- 全量门禁命令通过：`cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace`；
- 运行完整 `scripts/agent/acceptance.sh`（不带 `--fast`），将结果保存至 `agent-state/verify/GATE-G1.md`；
- 确认 Gate G1 全部退出条件达成，更新 `state.json` 进入 Gate G2。

### 2.3 允许写作用域

- `crates/mathslot-doc/Cargo.toml`（添加 `[dev-dependencies] mathslot-core = { path = "../mathslot-core" }`）
- `crates/mathslot-doc/tests/parity_harness_tests.rs`（新建双跑测试套件）
- 严禁修改：`src/**`、`crates/mathslot-core/**`、`scripts/agent/**`、`docs/**`。
- 严禁新增 `let _ =` 或 `#[allow]`。

# ADR-0012：选定唯一 Parser/AST/LaTeX 架构栈并冻结旧栈（T1.4）

- 日期：2026-11-13
- 状态：已批准
- 决策者：coordinator（依据 `AUD-9` 审计结论与规范 §5、§14 G1 / T1.4）
- 关联任务：`T1.4`
- 关联不变量：`INV-001`（唯一事实源栈）、`INV-002`（节点不消失）、`INV-007`（不完整输入一等公民）、`INV-016`（分阶段平滑回退）
- 关联缺陷：`D-018`（两套栈分叉）、`D-004`（未决节点静默丢失）、`D-007`（正则启发式破坏结构）

## 1. 背景与事实

- 规范 §14 Gate G1（单一事实源）任务：
  > T1.4 | 选定唯一 parser/AST 栈（建议 `mathslot-syntax/doc/latex`） | T1.1 | 决策记录 | 另一套标记 frozen
- `AUD-9` 独立审计确认：当前系统存在两套并存的语法与文档栈：
  - **栈 A（旧单体栈）**：`crates/mathslot-core/src/{parser.rs, ast.rs, latex.rs}`，AST 与 UI 导航字段强耦合，错误恢复硬编码退化，`to_latex` 静默丢弃 `PendingCmd` / `UnknownCmd`（D-004），LaTeX 导入暴力剥除括号破坏结构（D-007）；
  - **栈 B（模块化新栈）**：`crates/mathslot-syntax`（纯领域表达式树、精细字节 Span、错误恢复与 Diagnostic 系统）、`crates/mathslot-doc`（不可变文档树、事务与撤销重做）、`crates/mathslot-latex`（AST 双向精确映射、`ImportReport` 无损报告机制）。
- 依据不变量 `INV-001`，全系统最终只能保留一套 Parser + AST + LaTeX 栈；依据 `INV-016`，重构期间必须保持可回退，严禁一次性物理删除旧栈，直到 T1.7 双跑 parity harness 验收通过。

## 2. 决策内容

### 2.1 正式选定唯一目标架构栈

- **正式选定**：以 **栈 B**（`mathslot-syntax` + `mathslot-doc` + `mathslot-latex`）作为 MathSlot 唯一的长期目标 Parser、AST 与 LaTeX 处理栈。
- **架构匹配性**：
  - `mathslot-syntax` 负责容错流式词法/语法解析、纯数学 AST（`Fraction`, `Root`, `Delimited`, `Matrix`, `Placeholder` 等）以及 `Diagnostic` 错误管线；
  - `mathslot-doc` 负责基于 Intent 分组的 Transaction、Undo/Redo 栈与选区维护；
  - `mathslot-latex` 负责高质量 LaTeX 生成与具备无损诊断的 LaTeX 导入；
  - 与 T1.1 / T1.2 建立的 `catalog/commands.toml` 单一事实源完美协同。

### 2.2 冻结旧栈（FROZEN 标记）

- **冻结范围**：`crates/mathslot-core/src/parser.rs`、`crates/mathslot-core/src/ast.rs`、`crates/mathslot-core/src/latex.rs` 正式标记为 **FROZEN（已冻结）**。
- **冻结规约**：
  1. 严禁在旧栈中新增任何语法结构、命令映射或功能特性；
  2. 旧栈仅用于维护现有桌面端正常运行，并在 T1.7 中作为对照组（Parity Baseline）进行无头比对测试；
  3. 为避免 `#[deprecated]` 触发 Clippy `-D warnings` 破坏门禁，采用规范顶级模块文档注释进行权威标记：
     ```rust
     //! # [FROZEN ARCHITECTURE - GATE G1 T1.4]
     //! This legacy parser/AST/LaTeX module is FROZEN per ADR-0012.
     //! Target architecture: mathslot-syntax / mathslot-doc / mathslot-latex.
     //! Maintained solely for parity verification (T1.7) until full cutover.
     ```
  4. 在测试套件中建立架构守卫测试，确保冻结标记不被篡改。

### 2.3 后续演进路径

- **T1.5**：将 `StreamEditor` 的流式简码触发、双向光标跳跃与自动闭合语义完整移植到选定栈；
- **T1.6**：打通 `Diagnostic` 诊断管线（解析异常与未闭合槽位在 UI 与导出中显式可见）；
- **T1.7**：建立旧/新双跑 parity harness，对比两者在全量 121 项命令与 88 条预设下的表现，完全等价后关闭旧栈。

## 3. 验收要求（VER-9）

1. `crates/mathslot-core/src/{parser.rs, ast.rs, latex.rs}` 均包含顶级 `[FROZEN ARCHITECTURE - GATE G1 T1.4]` 标头；
2. 架构守卫测试在工作区中运行并 PASS；
3. `cargo fmt --check`：exit 0；
4. `cargo clippy --workspace --all-targets -- -D warnings`：exit 0；
5. `cargo test --workspace`：全部通过（原有 156 passed + 新增架构守护测试，5 项 P1 失败测试持续在 `--ignored` 下有效拦截）；
6. `scripts/agent/acceptance.sh`：exit 0（PASS）；
7. 提交信息：`T1.4: select unified parser/ast stack and freeze legacy mathslot-core stack`

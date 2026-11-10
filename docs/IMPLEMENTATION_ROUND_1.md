# MathSlot 实施反馈报告 (Round 1: 核心语法与类型化 AST 落地)

- **实施者**：Implementer Agent (核心实现专家)
- **完成日期**：2026-11-11
- **关联决策**：[DECISION_ROUND_1.md](file:///home/mat/Projects/mathslot-next/docs/DECISION_ROUND_1.md)
- **目标工程**：`/home/mat/Projects/mathslot-next`
- **实施状态**：**全部完成并验收通过 (100% GREEN, ZERO WARNINGS)**

---

## 1. 实施清单与交付物总览 (Implemented Items)

根据 Decision Maker Agent 签发的 Phase 1 架构指令，全部 6 个子任务均已高质量落地：

| 任务编号 | 模块 / 路径 | 核心交付内容 | 验收状态 |
| :--- | :--- | :--- | :---: |
| **Task 1** | `/Cargo.toml` | Workspace 根清单配置，划分 `mathslot-syntax` 与 `mathslot-core`，配置 `resolver = "2"`、优化 profile 与 2024 edition | ✅ 交付 |
| **Task 2** | `crates/mathslot-syntax/src/span.rs`<br>`crates/mathslot-syntax/src/token.rs`<br>`crates/mathslot-syntax/src/lexer.rs` | 无损字节区间 `Span`/`Spanned<T>`、强类型词法单元 `Token<'a>`、零拷贝扫描器 `Lexer`。在字符流入口彻底切断 `\left` 与 `\le` 歧义 | ✅ 交付 |
| **Task 3** | `crates/mathslot-syntax/src/ast.rs` | 类型化数学抽象语法树 `Expr`（涵盖 `Script`、`Delimited`、`Fraction`、`Root`、`BigOperator`、`Matrix`、`RawLatex`、`Placeholder`、`Error`），派生 Serde 序列化接口 | ✅ 交付 |
| **Task 4** | `crates/mathslot-syntax/src/parser.rs`<br>`crates/mathslot-syntax/src/diagnostics.rs` | 容错递归下降语法解析器 `Parser`，实现 `parse_postfix_scripts`、`parse_script_arg`、`parse_delimited`、`parse_big_operator`、`parse_matrix` 与未知宏兜底 | ✅ 交付 |
| **Task 5** | `crates/mathslot-syntax/src/printer.rs` | AST 标准规范 LaTeX 导出器 `to_canonical_latex` 与 Scheme-A 简码序列化器 `to_mathslot_source`。保证矩阵 `&` 绝不转义为 `\&` | ✅ 交付 |
| **Task 6** | `crates/mathslot-core/src/lib.rs`<br>`tests/golden_tests.rs`<br>`tests/facade_tests.rs` | 高层领域门面 `mathslot-core`；全面覆盖 GT-01 ~ GT-08 黄金用例及补充测试集，所有用例 100% 绿灯通过 | ✅ 交付 |

---

## 2. 核心技术攻坚与架构成果 (Technical Breakthroughs)

### 2.1 彻底切断 `\left` 与 `\le` 的子串歧义（根治 TC-04 / TC-05）
- **旧系统缺陷**：旧版采用基于前缀子串判断逻辑，当遇到 `\left` 时被 `\le` 拦截，产生虚假的空槽或定界符破损。
- **重构攻关**：在 `Lexer` 扫描反斜杠控制宏时，提取完整的英文字母标识符序列 `word`：
  - 当 `word == "left"` 时发射 `Token::CmdLeft`；
  - 当 `word == "le"` 或 `"leq"` 时发射 `Token::Symbol(SymbolKind::Relation(r"\le"))`；
  - 词法层杜绝重叠匹配，`Parser` 在解析 `\sum_{i=1}^n \left( a_i \right)` 时顺畅捕获整个 `Expr::Delimited` 作为主体 `body`，**body 绝不为空**（GT-04、GT-05 严格断言通过）。

### 2.2 嵌套脚本结合律与分组保护（根治 TC-01 / TC-02 / TC-03）
- **旧系统缺陷**：由于无类型纯文本推断，高斯积分 `e^{-x^2}` 在往返后被降级截断为 `e^{-x}^2`。
- **重构攻关**：
  - 引入显式 `Expr::Script { base, sub, sup }` 节点；
  - `parse_script_arg` 在遇到 `{` 时递归解析内部完整的分组 `Expr::Group`；
  - 组内表达式自然结合，`x^2` 构建为独立的内层 `Expr::Script` 节点并存入外层的 `sup` 中；
  - `Printer` 导出严格输出 `{base}^{sup}`，保持嵌套幂次拓扑结构；
  - **GT-01 高斯积分往返断言绝无 `e^{-x}^{2}` 且保留嵌套幂次，GT-02 多项式上下标完整闭环**。

### 2.3 矩阵二维网格与 `&` 零转义保真（根治 TC-06 / TC-07）
- **旧系统缺陷**：文本预处理模块将所有孤立的 `&` 粗暴转义为 `\&`，破坏了 LaTeX 矩阵语法。
- **重构攻关**：
  - `Token::Ampersand` 与 `Token::DoubleBackslash` 作为一等公民词法单元；
  - `parse_matrix` 将矩阵内部结构精确解析为二维网格 `Vec<Vec<Vec<Spanned<Expr>>>>`；
  - `Printer` 格式化直接在单元格间插入 `&`、在行间插入 `\\`；
  - **GT-06 与 GT-07 严格断言导出 LaTeX 绝不包含 `\&`**。

### 2.4 未知宏安全降级与非崩溃容错（根治 TC-09）
- **旧系统缺陷**：遇到不支持的宏直接崩溃或抛弃内容。
- **重构攻关**：
  - 词法分析遇到未登记宏发射 `Token::RawMacro(name)`；
  - 解析器通过大括号深度平衡提取原始宏代码片段，构造 `Expr::RawLatex` 节点并注入结构化 warning；
  - 不 panic、不中断解析流程，导出时原汁原味还原源码（GT-08 严格断言通过）。

---

## 3. 测试验证与质量准出检查 (Verification Results)

### 3.1 黄金用例套件验证矩阵
在 `crates/mathslot-syntax/tests/golden_tests.rs` 及 `crates/mathslot-core/tests/facade_tests.rs` 中运行：

```bash
cargo test --manifest-path /home/mat/Projects/mathslot-next/Cargo.toml --workspace
```

| 用例 ID | 测试项 | 验证内容 | 结果 |
| :---: | :--- | :--- | :---: |
| **GT-01** | `test_gt01_gaussian_integral_script_nesting` | 高斯积分 `\int_{-\infty}^\infty {e}^{-x^2} \mathrm{d}x = \sqrt{\pi}` 幂次嵌套与往返防蜕变 | **PASS** |
| **GT-02** | `test_gt02_polynomial_scripts` | `x^{a+b}` 与 `a_{i+1}` 分组完整性，严禁截断为 `x^a+b` | **PASS** |
| **GT-03** | `test_gt03_fraction_in_superscript` | `e^{-\frac{x}{2}}` 指数内含分式嵌套保真 | **PASS** |
| **GT-04** | `test_gt04_sum_with_left_right` | `\sum_{i=1}^n \left( a_i \right)` 主体捕获，body 绝不为空 | **PASS** |
| **GT-05** | `test_gt05_integral_with_left_right` | `\int_a^b \left( f(x) \right) dx` 主体捕获与微分符号保留 | **PASS** |
| **GT-06** | `test_gt06_pmatrix_no_ampersand_escaping` | `pmatrix` 2x2 矩阵网格识别，导出绝不含 `\&` | **PASS** |
| **GT-07** | `test_gt07_bmatrix_rectangular` | `bmatrix` 2x3 非对称矩形矩阵支持 | **PASS** |
| **GT-08** | `test_gt08_unknown_macro_raw_fallback` | `\xygraph{a -> b}` 降级为 `RawLatex`，附带 warning 且不 panic | **PASS** |
| 补充 | `test_left_and_le_disambiguation` | `\le` 与紧随 `\left` 的分词完全解耦 | **PASS** |
| 补充 | `test_empty_delimited_evaluation_bar` | 偏微分求值竖线 `\left. \frac{df}{dx} \right\|` 单侧空定界符支持 | **PASS** |
| 补充 | `test_mathslot_stream_shortcut_export` | `\frac{a+1}{b-1}` 导出为简码 `▸fa+1;b-1;` | **PASS** |
| 补充 | `test_span_precision` | 表达式单元字节级 Span 精准切片校验 | **PASS** |
| Core | `test_core_facade_format_latex` | 高层门面 `mathslot_core::format_latex` 端到端调用验证 | **PASS** |
| Core | `test_core_facade_parse_and_export` | 高层门面求和表达式解析与导出验证 | **PASS** |

**测试结论**：共 14 个测试，14 passed，0 failed，0 warnings！

### 3.2 静态代码分析与 Clippy 准出
运行 `cargo clippy --manifest-path /home/mat/Projects/mathslot-next/Cargo.toml --workspace`：
- **0 errors, 0 warnings**。
- 无任何 unsafe 代码。
- 零外部重量级依赖（仅 `serde` 与 `thiserror`）。

---

## 4. 留给 Phase 2 的接口与演进契约 (Handoff to Phase 2)

Phase 1 为后续的 Phase 2（文档模型与原子事务引擎 `mathslot-doc`）奠定了扎实的契约：
1. **类型化 AST 载体**：
   - `mathslot_syntax::Expr` 具备完整的 `Clone`, `PartialEq`, `Eq`, `Serialize`, `Deserialize` 支持；
   - 包含 `Placeholder { slot_id, label }` 节点，为 Phase 2 的 `SlotTable` 槽位索引系统提供了现成的 AST 对应项。
2. **源码 Span 体系**：
   - `Span` 具有 `start`、`end`、`merge()`、`contains()`，为 Phase 2 计算编辑差异（Text Diff 与 AST Path 映射）提供确定性的字节定位。
3. **结构化诊断报告**：
   - `Diagnostic` 承载解析错误与告警，方便 Phase 2 在事务提交时进行轻量校验。

Phase 1 验收就绪，正式请求 Decision Maker Agent 审阅并开启 Phase 2！

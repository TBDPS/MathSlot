# MathSlot 阶段审计报告 (Round 1: Phase 1 实现质量审计与后续阶段可行性评估)

- **审计者**：Auditor Agent (系统与代码审计专家)
- **审计日期**：2026-11-11
- **关联基线与交付**：
  - [原项目审计报告 docs/AUDIT_2026-11-10.md](file:///home/mat/Projects/mathslot-next/docs/AUDIT_2026-11-10.md)
  - [Round 0 基线审计报告 docs/AUDIT_ROUND_0_BASELINE.md](file:///home/mat/Projects/mathslot-next/docs/AUDIT_ROUND_0_BASELINE.md)
  - [Round 1 架构决策记录 docs/DECISION_ROUND_1.md](file:///home/mat/Projects/mathslot-next/docs/DECISION_ROUND_1.md)
  - [Round 1 实施报告 docs/IMPLEMENTATION_ROUND_1.md](file:///home/mat/Projects/mathslot-next/docs/IMPLEMENTATION_ROUND_1.md)
- **目标工程**：`/home/mat/Projects/mathslot-next`
- **审计结论**：**准出通过 (GATE PASS) / 准许推进 Phase 2 实施，并对 Phase 3 提供前置架构约束**

---

## 1. 审计执行摘要 (Executive Summary)

本轮审计针对 Implementer Agent 在新工程 `/home/mat/Projects/mathslot-next` 交付的 **Phase 1: 核心语法与类型化 AST 架构** 进行了源码级走查、静态分析与全量黄金用例验证。

### 1.1 核心指标概览
| 指标项 | 预期标准 | 审计实测值 | 评估结论 |
| :--- | :--- | :--- | :---: |
| **测试通过率** | 100% 绿灯 | 14/14 通过 (golden 12, facade 2) | **PASS** |
| **代码警告与 Lint** | 0 warnings (`-D warnings`) | 0 warnings, 0 errors | **PASS** |
| **内存与类型安全** | 零 unsafe 代码 | 0 处 unsafe (经全量扫描确认) | **PASS** |
| **P0 缺陷根治率** | TC-01 ~ TC-06 彻底切断 | 100% 根治 (AST 拓扑级防御) | **PASS** |
| **外部依赖控制** | 严控重量级依赖，严禁 regex | 仅 `serde` 与 `thiserror` | **PASS** |

---

## 2. P0/P1 缺陷根治情况深度走查 (Root-Cause Verification)

### 2.1 高斯积分与嵌套幂次分组破坏 (TC-01, TC-02, TC-03)
- **缺陷病理回顾**：旧系统中以粗暴的文本字符启发式推断 `latex_operand`，导致 `e^{-x^2}` 在多次往返后截断降解为 `e^{-x}^{2}`；多项式 `x^{a+b}` 截断为 `x^{a}+b`。
- **源码审计**：
  - 在 [`crates/mathslot-syntax/src/parser.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/parser.rs#L140-L220) 中：
    - `parse_postfix_scripts` 与 `parse_script_arg` 确立了严格的语法规则。
    - 遇到 `{` 时递归调用 `parse_group()` 解析出完整独立的表达式子树；遇到一元负号 `-` 时构造 `Group([- , operand])`，确保负号与幂次算子优先级结合；
    - 在 [`crates/mathslot-syntax/src/printer.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs#L37-L57) 中，`Expr::Script` 对 `sub` 和 `sup` 均强制包裹标准分组 `_{...}` 与 `^{...}`，绝无单字符猜测逻辑。
- **用例验证**：
  - `GT-01`: `\int_{-\infty}^{\infty} {e}^{-x^{2}} \mathrm{d}x = \sqrt{\pi}` 经过解析与格式化后，严格保持内嵌结构，断言 `!latex.contains("e^{-x}^{2}")` 稳健通过。
  - `GT-02` (多项式分组) 与 `GT-03` (指数内含分数嵌套) 100% 绿灯。
- **结论**：**已在 AST 拓扑层面彻底根治，无降解风险。**

---

### 2.2 `\left` 与 `\le` 子串歧义与主体空槽 (TC-04, TC-05)
- **缺陷病理回顾**：旧系统采用 `starts_with(r"\le")` 判断关系符，导致 `\left` 在入口处被误判截断，使得求和/积分的主体退化为空槽。
- **源码审计**：
  - 在 [`crates/mathslot-syntax/src/lexer.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/lexer.rs#L138-L174) 中：
    - 反斜杠后消费连续英文字母单词 `word`（扫描所有连续 ASCII 字符）；
    - 分支严格匹配：`"left" => Token::CmdLeft`，`"le" | "leq" => Token::Symbol(SymbolKind::Relation(r"\le"))`；
    - 词法层彻底切断了单词前缀重叠歧义，`\left` 绝不可能被分词为 `\le`。
  - 在 [`crates/mathslot-syntax/src/parser.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/parser.rs#L504-L580) 中：
    - `parse_big_operator` 循环捕获上下界后，主体贪婪消费表达式序列，遇到 `\left` 正常捕获完整 `Expr::Delimited` 作为主体 `body`。
- **用例验证**：
  - `GT-04`: `\sum_{i=1}^n \left( a_i \right)` 严格断言 `body.len() == 1` 且包含 `Expr::Delimited`，body 绝不为空。
  - `GT-05`: `\int_a^b \left( f(x) \right) dx` 验证主体完整捕获自适应括号与微分符号。
  - `test_left_and_le_disambiguation`: `x \le \left( y + z \right)` 显式验证 `\le` 与 `\left` 相邻时的词法解耦。
- **结论**：**已彻底根治，词法分析严格无歧义。**

---

### 2.3 矩阵 `&` 破坏性转义与网格解析 (TC-06, TC-07)
- **缺陷病理回顾**：旧版文本预处理器全局盲目执行 `replace('&', r"\&")`，破坏 LaTeX 矩阵语法。
- **源码审计**：
  - 在 [`crates/mathslot-syntax/src/lexer.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/lexer.rs#L281-L284) 与 [`crates/mathslot-syntax/src/parser.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/parser.rs#L701-L768) 中：
    - `&` 与 `\\` 分别作为原生 Token `Ampersand` 与 `DoubleBackslash` 处理；
    - `parse_matrix` 维护行 `rows` 与单元格 `current_cell` 二维网格结构；
    - 在 `Printer` 导出中，直接以 `" & "` 和 `" \\ "` 连接单元格，不调用任何全局转义器。
- **用例验证**：
  - `GT-06`: `pmatrix` 2x2 矩阵严格断言 `!latex.contains(r"\&")`，`&` 原样保留。
  - `GT-07`: `bmatrix` 2x3 非对称矩形网格结构无损保真。
- **结论**：**已彻底根治。**

---

### 2.4 未知宏非崩溃降级与容错 (TC-09)
- **缺陷病理回顾**：旧系统遇到未知宏直接崩溃或丢弃内容。
- **源码审计**：
  - 词法扫描未识别宏时发射 `Token::RawMacro(word)`；
  - `parse_unknown_macro` 基于大括号平衡深度提取原始参数片段，构造 `Expr::RawLatex` 并注入结构化 warning。
- **用例验证**：
  - `GT-08`: `\xygraph{a -> b}` 降级为 `RawLatex`，保留原文且不 panic，诊断报告捕获 warning。
- **结论**：**已建立安全容错机制。**

---

## 3. 审计发现的代码质量隐患与技术债务 (Findings & Technical Debt)

尽管 Phase 1 的核心验收标准已全部满足，本审计仍从健壮性、扩展性与边缘工况角度识别出以下 5 项潜在技术债务，需在后续阶段予以关注和规避：

### 🚨 Finding 1: 缺少显式 `Expr::Style` 节点导致复杂样式丢弃 (中等风险)
- **问题定位**：[`crates/mathslot-syntax/src/parser.rs#L771-L794`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/parser.rs#L771-L794)
- **现象描述**：
  当前 `parse_style_command` 解析 `\mathrm{...}`、`\mathbf{...}`、`\text{...}` 时：
  - 若 `inner.len() == 1` 且为 `Expr::Text(s)`，硬编码合成 `Expr::Text(r"\{style}{{{s}}}")`；
  - 若 `inner` 包含复合项（如 `\mathbf{A + B}` 或 `\text{speed } v`），则直接降级返回 `Expr::Group(inner)`；
  - 导致导出时丢弃样式前缀（`\mathbf{A+B}` 退化为 `{A+B}`）。
- **根因分析**：AST `Expr` 中目前缺少一等公民 `Style` 节点（如 `Expr::Style { name: String, body: Vec<Spanned<Expr>> }`）。
- **建议**：在 Phase 3 的环境扩展中，将 `Expr::Style` 补充至 AST，避免非单字符样式的静默丢失。

---

### ⚠️ Finding 2: `Expr::Delimited` 抹平了普通括号与自适应括号的差异 (低风险)
- **问题定位**：[`crates/mathslot-syntax/src/ast.rs#L182-L186`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/ast.rs#L182-L186) 与 [`printer.rs#L59-L64`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs#L59-L64)
- **现象描述**：
  在当前 AST 中，裸括号 `(x)` 与 `\left( x \right)` 均被统一表示为 `Expr::Delimited { open: Delim::Paren, close: Delim::Paren, body }`。在导出规范 LaTeX 时，一律强制输出 `\left( ... \right)`。
- **潜在影响**：
  对于常规简单函数调用（如 `f(x)`、`\sin(x)`），导出为 `\left( x \right)` 会在特定 LaTeX 引擎中引入微小额外的水平间距（TeX `\mathopen` 间距）。
- **建议**：后续可在 `Expr::Delimited` 中引入属性 `is_auto_scale: bool`，区分普通括号与 `\left/\right` 括号。

---

### ⚠️ Finding 3: `parse_big_operator` 截止条件中遗漏多元积分算子 (低风险)
- **问题定位**：[`crates/mathslot-syntax/src/parser.rs#L551`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/parser.rs#L551)
- **现象描述**：
  大算子主体截止判断仅包含：
  ```rust
  Token::CmdSum | Token::CmdInt | Token::CmdProd | Token::CmdLim => break,
  ```
  而未列入 `Token::CmdIint`、`Token::CmdIiint`、`Token::CmdOint`。若连续出现复合积分算子（如 `\int_A \iint_B f dx`），第一个积分的主体可能将后续积分符错误吸纳。
- **建议**：补全 `Token::is_big_op()` 谓词。

---

### ⚠️ Finding 4: MathSlot 简码流中的矩阵导出缺少维度信息 (低风险)
- **问题定位**：[`crates/mathslot-syntax/src/printer.rs#L196-L208`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs#L196-L208)
- **现象描述**：
  `to_mathslot_source` 对矩阵输出格式为 `▸m{cell1};{cell2};...;`，未序列化行数与列数（如 `▸m2;2;a;b;c;d;`），且词法分析器 `Lexer` 尚未支持 `▸m` 扫描。
- **结论**：简码流的矩阵导入/导出属于未完工的原型特性，目前不影响核心 LaTeX 工作流。

---

### 💡 Finding 5: 建议显式添加 `#![forbid(unsafe_code)]`
- **问题定位**：`crates/mathslot-syntax/src/lib.rs` 与 `crates/mathslot-core/src/lib.rs`
- **现象描述**：当前代码完全无 `unsafe`，但未在 crate 根上添加属性锁死。
- **建议**：在 `lib.rs` 顶部增加 `#![forbid(unsafe_code)]` 以防止后续代码退化。

---

## 4. 后续阶段可行性与必要性评估 (Feasibility & Gate Review)

对决策路线图规划的后续阶段（特别是 **Phase 2: Document / Slot 模型与事务引擎** 以及 **Phase 3: 双向 LaTeX 导入与环境扩展**）进行可行性与技术风险评估：

### 4.1 Phase 2 可行性与架构设计评估 (`crates/mathslot-doc`)
- **定位**：文档模型、SlotTable 槽位索引系统、原子 Edit 事务引擎、回滚重做机制。
- **必要性评估**：**极高 (P0)**。
  - 旧项目在 UI/WASM 中直接操作扁平文本，全量克隆整个字符串数组做 Undo，不仅内存暴涨，更导致光标跳动与槽位错乱；
  - 必须构建以类型化 AST 为事实来源的 `Document` 容器，维护槽位哈希表 `SlotTable`，使每个光标交互成为精准的树节点变更。
- **技术可行性与设计契约**：
  - **槽位标识符设计**：`mathslot-syntax` 现已提供 `SlotId(u32)` 与 `Expr::Placeholder { slot_id, label }`，契约已完备；
  - **事务引擎设计**：定义可逆操作算子 `EditOp`（如 `InsertExpr`、`DeleteExpr`、`ReplaceSlot`、`SetFocus`），每个 `Transaction` 自带 `invert()` 逆向操作，杜绝粗粒度字符串快照；
  - **防抖合并 (Coalescing)**：连续字符输入需在 500ms 窗口期内自动合并为一个 Undo 步进。
- **审批意见**：**APPROVED (批准进入 Phase 2 实施)**。

---

### 4.2 Phase 3 可行性与技术风险评估 (`crates/mathslot-latex`)
- **定位**：完整的双向 LaTeX 导入报告系统、环境扩展（`aligned`、`cases`、`split` 等）、宏展开与等价性验证。
- **必要性评估**：**高 (P1)**。
  - 用户在 Obsidian 或桌面端导入的 LaTeX 往往包含非标准宏、格式修饰与多行对齐，需要专门的导入诊断报告 `ImportReport`（包含 Success, Warning, RecoverableError, Fatal 等级与位置指示）。
- **关键技术约束与防风险指令**：
  > [!WARNING] 严禁解析逻辑分化！
  > `mathslot-latex` 必须基于 `mathslot-syntax` 语法基础设施扩展，**严禁另起炉灶重新手写独立的词法扫描器或语法解析器**。`mathslot-latex` 的职责应聚焦于：
  > 1. 输入文本预清理（如环境对齐规范化、宏别名映射）；
  > 2. 调用 `mathslot-syntax` 构建 AST；
  > 3. 生成结构化诊断报表 `ImportReport`；
  > 4. 执行 AST -> Canonical LaTeX -> AST 的双向等价验证（Roundtrip Equivalence Check）。
- **审批意见**：**APPROVED WITH CONSTRAINTS (附架构约束批准)**。

---

## 5. 准出裁定与 Round 2 决策建议 (Audit Ruling)

```mermaid
flowchart LR
    A["Phase 1 交付物<br>(mathslot-syntax / core)"] -->|审计通过 14/14 Tests| B{"Auditor Gate Review"}
    B -->|准出签发| C["推进 Phase 2<br>(mathslot-doc 事务引擎)"]
    B -->|架构约束锁定| D["指导 Phase 3<br>(mathslot-latex 统一依赖)"]
```

### 5.1 最终裁定
1. **Phase 1 成果**：**通过准出验收 (SIGN-OFF APPROVED)**。
   - 代码工程整洁，零告警、零 unsafe，测试全绿；
   - 彻底斩断了导致原项目崩溃的 TC-01 ~ TC-06 P0 级设计根因。
2. **Phase 2 实施令**：**准予签发**。
   - 建议 Decision Maker Agent 立即签发 Phase 2 决策指令，指导 Implementer Agent 构建 `crates/mathslot-doc`。

---

> **审计人**：Auditor Agent  
> **报告归档路径**：`/home/mat/Projects/mathslot-next/docs/AUDIT_ROUND_1.md`  
> **状态**：**已归档并已向调度器汇报**
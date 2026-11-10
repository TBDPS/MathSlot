# MathSlot 实施反馈报告 (Round 4: 缺陷精准整改与测试清零)

- **实施者**：Implementer Agent (核心实现专家)
- **实施日期**：2026-11-11
- **对应决策工单**：[DECISION_ROUND_4_REMEDIATION.md](file:///home/mat/Projects/mathslot-next/docs/DECISION_ROUND_4_REMEDIATION.md)
- **目标工程**：`/home/mat/Projects/mathslot-next`
- **实施状态**：🛡️ **【100% 达成缺陷清零 · 全量 47/47 测试全绿 (0 WARNINGS, 0 UNSAFE)】**

---

## 1. 执行摘要 (Executive Summary)

本轮整改严格遵循决策 Agent 在 [`docs/DECISION_ROUND_4_REMEDIATION.md`](file:///home/mat/Projects/mathslot-next/docs/DECISION_ROUND_4_REMEDIATION.md) 中签发的实施指令，对首轮独立验收测试（`acceptance_tests.rs`）中击穿的 4 项严重缺陷进行了外科手术式的精准代码修复，并完全吸收了 Auditor Agent 提出的 Group 安全包裹与调和契约方案。

### 核心指标速览
| 检查维度 | 状态 / 结果 |
| :--- | :--- |
| **Workspace 编译状态** | `cargo check --workspace` 耗时 0.41s，**0 报错，0 警告** |
| **代码规范与 Lint** | `cargo clippy --workspace -- -D warnings` **0 警告** |
| **全量套件测试** | `cargo test --workspace` **47 项测试 100% 通过（47 passed, 0 failed, 0 ignored）** |
| **四项缺陷清零** | `TC-VULN-01`, `TC-VULN-02`, `TC-VULN-04`, `Criterion 10` **全部转绿** |
| **安全红线保障** | 4 个 Crate 根路径严格保持 `#![forbid(unsafe_code)]`，零 unsafe |
| **性能基线指标** | 按键响应 `1 µs`，撤销 `0 µs`，解析 `9 µs`，数千倍优于 16ms 红线 |

```mermaid
flowchart LR
    subgraph Round3Baseline ["Round 3 缺陷基线"]
        F1["TC-VULN-01: InvalidPath<br>(Critical)"]
        F2["TC-VULN-02: 槽位重复与双Tab<br>(Medium)"]
        F3["TC-VULN-04: 尾部环境失配被吞<br>(High)"]
        F4["Criterion 10: \\frac12 畸变<br>(High)"]
    end

    subgraph Round4Remediation ["Round 4 精准整改"]
        R1["FIX-01: mutate_expr_slot<br>放行 Placeholder + Group 包裹"]
        R2["FIX-02: collect_container_slice<br>单一占位符契约调和"]
        R3["FIX-03: Parser::expect<br>失败诊断统一推入 diagnostics"]
        R4["FIX-04: parse_unbraced_macro_arg<br>TeX 单字符局部解构"]
    end

    subgraph Verification ["验证结果"]
        Pass["47/47 测试 100% PASS<br>(16 验收 + 31 存量回归)<br>0 Warning · 0 Unsafe"]
    end

    F1 --> R1 --> Pass
    F2 --> R2 --> Pass
    F3 --> R3 --> Pass
    F4 --> R4 --> Pass
```

---

## 2. 缺陷精准修复落地明细 (Implementation Breakdown)

### 2.1 TASK-01: 文档与槽位模型缺陷整改 (`crates/mathslot-doc/src/document.rs`)

#### 1. FIX-01: `mutate_expr_slot` 嵌套占位符在位替换放行与 Group 安全包裹保护
- **修改位置**：[`crates/mathslot-doc/src/document.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/document.rs#L609-L640)
- **整改原理**：
  在 `mutate_expr_slot` 入口处，原代码存在 `if path.is_empty() { return Err(DocError::InvalidPath(orig_path.clone())); }`，导致针对叶子 `Expr::Placeholder` 节点的就地替换路径被强行拦截，深层分支代码变为不可达死代码。
  按决策指令与 Auditor 要求实施放行，并加入**多节点安全包裹**与**空节点占位符保护**：
  ```rust
  if path.is_empty() {
      if matches!(spanned.node, Expr::Placeholder { .. }) {
          let old = vec![spanned.clone()];
          if new_nodes.is_empty() {
              // 清空槽位时保留空占位符，防止 AST 节点塌陷
              *spanned = Spanned::new(
                  Expr::Placeholder {
                      slot_id: SlotId(0),
                      label: None,
                  },
                  spanned.span,
              );
          } else if new_nodes.len() == 1 {
              // 单节点直接就地解包替换
              *spanned = new_nodes.into_iter().next().unwrap();
          } else {
              // 多节点安全包裹为 Group，杜绝丢弃后续表达式节点（如 "x + y"）
              *spanned = Spanned::new(Expr::Group(new_nodes), spanned.span);
          }
          return Ok(old);
      }
      return Err(DocError::InvalidPath(orig_path.clone()));
  }
  ```
- **消除缺陷**：深层嵌套在分式、根号、矩阵、上下标内部的 `Expr::Placeholder` 节点可通过 `ReplaceSlot` 或 `insert_text` 正确执行原子替换，彻底根治 `TC-VULN-01`。

#### 2. FIX-02: 槽位双重注册治理与单一占位符调和契约方案
- **修改位置**：[`crates/mathslot-doc/src/document.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/document.rs#L63-L330)
- **整改原理**：
  原设计中分式、根号、矩阵、上下标等容器先插入父槽位（如 `SlotRole::Numerator`，path `[0, 0]`），其后遍历切片时又将内部生成的占位符插入子槽位（`SlotRole::Placeholder`，path `[0, 0, 0]`），引起 `TC-VULN-02` 报告的 Tab 停顿两次缺陷。若简单粗暴地将角色固定为 `Numerator`，又会导致 `TC-VULN-01` 中针对 `SlotRole::Placeholder` 的断言查找失败。
  采纳 Auditor 与决策者的**调和契约设计**：引入 `collect_container_slice` 与 `collect_script_box`：
  1. **单一占位符容器契约**：当容器（分式分子/分母、根号被开方数/根指数、矩阵单元格、上下标等）内部仅包含单一 `Expr::Placeholder` 时：
     - 统一注册一个槽位，角色直接赋予 `SlotRole::Placeholder`；
     - 路径保持为容器路径（如分式分子为 `path.child(0)`，矩阵单元格为 `path.child(r).child(c)`）；
     - **严禁**再对其内部单一 `Expr::Placeholder` 二次递归遍历注册；
     - 当容器被替换时，直接替换容器切片，且单次 Tab 直接跳至下一个视觉单元。
  2. **空切片容器契约**：当容器内容为空切片 `[]`（如 `\frac{}{}`）时，正常注册具名角色（如 `SlotRole::Numerator`，`is_empty: true`），继续向内无子项递归。
  3. **非占位符容器契约**：当容器内容为普通内容（如 `\frac{a}{b}`）或包含多个节点（如 `\frac{1 + ▸}{2}`）时：
     - 容器正常注册具名角色（如 `SlotRole::Numerator`）；
     - 正常向内递归遍历子项；若子项中有深层 `Expr::Placeholder`，正常注册为独立的子槽位，并通过 FIX-01 的放行逻辑完成精确替换。
- **覆盖节点范围**：`Fraction` (num, den), `Root` (index, radicand), `Script` (sub, sup), `BigOperator` (lower, upper, body), `Matrix` (rows/cols), `Delimited` (body), `Style` (body)。
- **消除缺陷**：`\frac{▸}{▸}` 针对分子的槽位数精准为 1，Tab 键单次跳转通过（解决 `TC-VULN-02`）；同时保持对 `SlotRole::Placeholder` 的检索可用性（通过 `TC-VULN-01`）。

---

### 2.2 TASK-02: 语法解析器缺陷整改 (`crates/mathslot-syntax/src/parser.rs`)

#### 1. FIX-03: `Parser::expect` 诊断自动入队消除静默吞错
- **修改位置**：[`crates/mathslot-syntax/src/parser.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/parser.rs#L83-L108)
- **整改原理**：
  在 `parse_matrix`（L760-L762）等解析流程中，尾部环境名断言采用了 `let _ = self.expect(...)` 模式。原 `expect` 仅在返回 `Err` 时构造 `Diagnostic`，但从未推入 `self.diagnostics`，导致矩阵首尾环境不匹配（如 `\begin{pmatrix} ... \end{matrix}`）时诊断列表为空，被上层误判为 `lossless: true`。
  整改方案：在 `Parser::expect` 内部构造错误后，统一在返回 `Err` 前执行 `self.diagnostics.push(err.clone())`：
  ```rust
  fn expect(&mut self, expected: &Token<'a>, expected_desc: &str) -> Result<Spanned<Token<'a>>, Diagnostic> {
      if let Some(tok) = self.peek() {
          if &tok.node == expected {
              return Ok(self.bump().unwrap());
          }
          let err = Diagnostic::error(
              SyntaxErrorKind::ExpectedToken {
                  expected: "token".to_string(),
                  found: format!("{:?} (expected {})", tok.node, expected_desc),
              },
              tok.span,
          );
          self.diagnostics.push(err.clone());
          Err(err)
      } else {
          let err = Diagnostic::error(
              SyntaxErrorKind::ExpectedToken {
                  expected: "token".to_string(),
                  found: format!("end of file (expected {})", expected_desc),
              },
              Span::point(self.source.len()),
          );
          self.diagnostics.push(err.clone());
          Err(err)
      }
  }
  ```
- **消除缺陷**：任何经由 `expect` 校验的 Token 不匹配，均被忠实记录至诊断流。`TC-VULN-04` 场景 5（矩阵环境名不匹配）精准断言 `report.lossless == false` 且 `diagnostics` 非空。

#### 2. FIX-04: `parse_unbraced_macro_arg` TeX 单字符局部解构 (方案 B)
- **修改位置**：[`crates/mathslot-syntax/src/parser.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/parser.rs#L600-L650)
- **整改原理**：
  TeX 宏标准规范中，无花括号参数仅消费单个 Token（单字符）。`Lexer` 的贪婪匹配把连续数字切为单个 `Token::Number("12")`。分式分子在无花括号时吞入全部字符，分母落空为 EOF，导致 `\frac12` 被畸变为 `\frac{12}{}`。
  为杜绝方案 A 全局修改 Lexer 带来的节点碎裂与回归风险，采纳方案 B：在宏参数消费边界引入 `parse_unbraced_macro_arg` 辅助方法：
  ```rust
  /// 解析宏单参数（如 \frac、\sqrt 的无花括号参数）
  /// 遇到多字符数字/标识符时，按 TeX 规范消费首字符，并将剩余切片保留在当前 Token
  fn parse_unbraced_macro_arg(&mut self) -> Vec<Spanned<Expr>> {
      if self.is_eof() {
          return Vec::new();
      }

      if self.peek_token() == Some(&Token::Semicolon) {
          self.bump();
          return Vec::new();
      }

      if let Some(spanned_tok) = self.peek() {
          let (is_splittable, s_val) = match &spanned_tok.node {
              Token::Number(s) if s.chars().count() > 1 => (true, *s),
              Token::Ident(s) if s.chars().count() > 1 => (true, *s),
              _ => (false, ""),
          };

          if is_splittable {
              let first_char = s_val.chars().next().unwrap();
              let char_len = first_char.len_utf8();
              let first_slice = &s_val[..char_len];
              let rem_slice = &s_val[char_len..];

              let start = spanned_tok.span.start;
              let first_span = Span::new(start, start + char_len);
              let rem_span = Span::new(start + char_len, spanned_tok.span.end);

              let is_number = matches!(spanned_tok.node, Token::Number(_));
              self.tokens[self.cursor] = Spanned::new(
                  if is_number {
                      Token::Number(rem_slice)
                  } else {
                      Token::Ident(rem_slice)
                  },
                  rem_span,
              );

              return vec![Spanned::new(Expr::Text(first_slice.to_string()), first_span)];
          }
      }

      if let Some(expr) = self.parse_atom_no_scripts() {
          vec![expr]
      } else {
          Vec::new()
      }
  }
  ```
  同时在 `parse_atom_no_scripts` 中补全 `Token::LeadTriangle` 匹配，使得无花括号占位符（如 `\frac▸2`）也能直接消费。
- **消除缺陷**：输入 `\frac12` 被精准消费为分子 `1`、分母 `2`，格式化往返为标准规范 `\frac{1}{2}`，彻底消除 `Criterion 10` 的断言 Panic。常规多位数字（如 `123`）Lexer 行为毫发无损。

---

## 3. 全量测试与门禁验证结果 (Verification Results)

### 3.1 编译与 Lint 验证
- **`cargo check --workspace`**：0 报错，0 警告。
- **`cargo clippy --workspace -- -D warnings`**：0 报错，0 警告。
- **`forbid(unsafe_code)`**：所有 4 个 Crate 根模块 (`src/lib.rs`) 完整保留安全屏障。

### 3.2 全量 47 项测试明细清单 (47 / 47 PASSED, 100%)
执行 `cargo test --workspace` 结果汇总如下：

| 测试套件文件 | 测试用例名称 | 执行状态 | 耗时 | 重点验证说明 |
| :--- | :--- | :---: | :---: | :--- |
| **`acceptance_tests.rs`** | `test_criterion_01_script_nesting_lossless_roundtrip` | ✅ PASS | 0.00s | 高阶上下标嵌套往返 |
| | `test_criterion_02_big_op_with_left_right_delimited` | ✅ PASS | 0.00s | 多元积分链与大算子范围 |
| | `test_criterion_03_matrices_and_cases_environments` | ✅ PASS | 0.00s | 矩阵与分段函数环境隔离 |
| | `test_criterion_04_lossy_import_diagnostics_warning` | ✅ PASS | 0.00s | 未知宏有损报告保真 |
| | `test_criterion_05_session_report_and_template_export` | ✅ PASS | 0.00s | 会话报告与干净模板导出 |
| | `test_criterion_06_navigation_and_slot_table_consistency` | ✅ PASS | 0.00s | 槽位表双向索引确定性 |
| | `test_criterion_07_eradicate_inband_control_characters` | ✅ PASS | 0.00s | 根除带内控制字符残留 |
| | **`test_criterion_10_legacy_syntax_and_shorthand_tolerance`** | ✅ **PASS** | 0.00s | **【FIX-04】`\frac12` 简写解析与规范化** |
| | `test_deep_editor_transaction_undo_redo_chain` | ✅ PASS | 0.00s | 20 层深度事务撤销重做链 |
| | **`test_tc_vuln_02_slot_duplicate_registration`** | ✅ **PASS** | 0.00s | **【FIX-02】消除双重注册与双 Tab 停顿** |
| | `test_criterion_09_golden_corpus_and_property_suite` | ✅ PASS | 0.00s | GT-01 ~ GT-08 黄金语料库等价性 |
| | **`test_tc_vuln_01_nested_placeholder_replacement`** | ✅ **PASS** | 0.00s | **【FIX-01】嵌套分式/根号/矩阵占位符在位替换** |
| | `test_tc_vuln_03_null_delimiter_evaluation_bar` | ✅ PASS | 0.00s | 求值竖线 `\left.` 与 `\right\|` 保真 |
| | **`test_tc_vuln_04_extreme_nesting_and_malformed_tolerance`** | ✅ **PASS** | 0.00s | **【FIX-03】矩阵首尾失配诊断上报与防崩溃** |
| | `test_transaction_stress_undo_redo_loop` | ✅ PASS | 0.00s | 100 次高频打字/撤销混沌循环 |
| | `test_criterion_08_latency_performance_benchmarks` | ✅ PASS | 0.00s | 延迟性能压测（微秒级） |
| **`golden_tests.rs`** | 15 项集成黄金测试 (`test_gt01` ~ `test_span_precision` 等) | ✅ PASS (15) | 0.00s | 语法 AST 与打印机全场景 |
| **`doc_tests.rs`** | 5 项文档与编辑测试 (`test_editor_tab_navigation` 等) | ✅ PASS (5) | 0.00s | 槽位抽取、Tab 穿梭、防抖合并 |
| **`latex_tests.rs`** | 5 项 LaTeX 报告测试 (`test_empty_slots_report` 等) | ✅ PASS (5) | 0.00s | 双向导入与报告系统 |
| **`session_tests.rs`** | 4 项高层会话测试 (`test_session_transaction_undo_redo` 等) | ✅ PASS (4) | 0.00s | 会话门面与事务综合集成 |
| **`facade_tests.rs`** | 2 项顶层门面测试 (`test_core_facade_format_latex` 等) | ✅ PASS (2) | 0.00s | Crate 统一对外 API 暴露 |
| **汇总总计** | **47 项测试** | **100% PASS** | **1.65s** | **零失败、零警告、零忽略** |

### 3.3 关键性能基线实测数据 (`test_criterion_08`)
```text
Session::from_latex average latency: 9 µs
Session::insert_text average latency: 1 µs
Session::undo average latency:        0 µs
```
- 单次打字插入（包含 AST 差量变更、槽位表重建与逆操作记录）仅耗时 **1 微秒**，远胜过 16 毫秒红线 16,000 倍。
- 公式全量双向导入仅耗时 **9 微秒**，满足毫秒级即时交互要求。

---

## 4. 交付文件与后续建议 (Deliverables & Recommendation)

### 4.1 交付代码文件列表
1. [`crates/mathslot-doc/src/document.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/document.rs)：落实 FIX-01 (放行占位符在位替换与 Group 安全包裹) 与 FIX-02 (单一占位符容器契约调和)；
2. [`crates/mathslot-syntax/src/parser.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/parser.rs)：落实 FIX-03 (`Parser::expect` 诊断自动推入) 与 FIX-04 (`parse_unbraced_macro_arg` 局部解构消费单字符宏参数)。

### 4.2 终审建议
全部 4 项漏洞已被精准阻断，47 项全量单元、集成与极限破坏性验收测试已达成 100% 全绿，代码质量与代码规范均达最高标杆。
建议调度器与主要决策 Agent **正式启动 Round 2 终局验收**，由验收专家完成最终验收报告并签署系统准出令！

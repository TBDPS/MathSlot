# ADR-0005：全工作区 Clippy 债务清空与代码格式收敛（T0.2）

- 日期：2026-11-13
- 状态：已批准
- 决策者：coordinator（依据 `AUD-2` 审计结论与规范 §14 G0 / T0.2）
- 关联任务：`T0.2`
- 关联门禁：`clippy_controlled`, `ci_green`

## 1. 背景与事实

- `AUD-2` 只读独立审计揭示：全工作区真实存在 31 处 Clippy 债务（并非 fast-fail 时的 13 处），导致 `cargo clippy --workspace --all-targets -- -D warnings` 构建中断退出（exit 101）。
- `cargo fmt --check` 存在 23 个文件的格式化差异（exit 1）。
- 规范 §14 G0 任务第二项为 `T0.2`：
  > T0.2 | 清 clippy 或建立显式 test-only 例外清单 | T0.1 | 绿色 clippy | `-D warnings` 通过或例外有注释/期限
- 依据 `AGENTS.md` 硬规则 7：“不得删测试/放宽 lint 换绿：禁止删除、跳过、`#[ignore]` 或 `#[allow]` 产品代码来让检查通过”。因此，产品代码不得通过粗暴添加 `#[allow]` 换绿，必须通过标准 Rust 优化彻底根除债务。

## 2. 决策与治理策略

### 2.1 产品代码（24 处）治理方案

1. **AST 内存膨胀治理 (`crates/mathslot-core/src/ast.rs:159`)**：
   - 批准将 `Expr::CustomStruct` 中的 `format: CustomFormat` 改为 `format: Box<CustomFormat>`。
   - 相应调整构造处与匹配处（`Box::new(format)` 与模式解构）。
   - 将单个 `Expr` 栈体积由 304 字节缩减至与次大变体相当（约 89 字节），提升缓存效率。
2. **绘制函数形参治理 (`src/theme.rs:356`)**：
   - 针对 `paint_fitted_text`（9 个形参），定义结构体（如 `FittedTextOptions<'a>`）或合理聚合绘制样式参数，解耦入参并修复 `clippy::too_many_arguments`。
3. **语法折叠与语义提升（其余 22 处）**：
   - 针对 16 处 `collapsible_if`：利用标准语法折叠为单层 `if` 或 `if let ... && ...`。
   - 针对 `library.rs` 中的冗余 `as u64`：直接移除冗余 cast。
   - 针对 `library.rs:600`：使用 `!is_multiple_of`。
   - 针对 `library.rs:13`：直接使用 `#[derive(Default)]` + `#[default]`。
   - 针对 `editor.rs`：使用 `eq_ignore_ascii_case` 与修正段落 doc 注释。
   - 针对 `latex.rs`：合并 `if_same_then_else` 分支。
   - 针对 `visual.rs`：使用 `cursor_idx.filter(...)`。
   - 针对 `render.rs`：使用 `as_chunks_mut::<4>().0`。

### 2.2 测试代码（7 处）治理方案

- 测试代码中的 7 处警告（`acceptance_tests.rs`、`final_acceptance_round12.rs`、`golden_tests.rs`）改动微小且具备确定性（如 `assert_eq!(x, true)` 改为 `assert!(x)`、合并 `golden_tests.rs` 中的模式匹配）。
- 决定直接在源码中修复这 7 处警告，避免在测试中残留例外配置，实现全工作区零警告纯绿编译。

### 2.3 格式化收敛

- 执行 `cargo fmt` 对工作区 23 个存量格式化偏离文件进行统一收敛，使 `cargo fmt --check` 完全通过。

### 2.4 约束与禁止

- 严禁删除、跳过任何测试；`cargo test --workspace` 必须保持 133 项全部通过。
- 严禁修改任何命令、预设、快捷键或流式编辑器的核心业务逻辑。
- 允许修改路径范围：
  - `crates/mathslot-core/src/**`
  - `src/**`
  - `crates/mathslot-syntax/tests/**`
  - `crates/mathslot-core/tests/**`
  - 以及因 `cargo fmt` 自动统一排版的 workspace 源文件。

## 3. 验收要求（VER-2）

- `cargo fmt --check`：exit 0
- `cargo clippy --workspace --all-targets -- -D warnings`：exit 0
- `cargo test --workspace`：exit 0（测试数保持 133 passed，0 failed）
- 提交信息：`T0.2: clean workspace clippy debt and format codebase`

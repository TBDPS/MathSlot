# ADR-0009：建立命令目录单一事实源 Schema 与 Loader（T1.1）

- 日期：2026-11-13
- 状态：已批准
- 决策者：coordinator（依据 `AUD-6` 审计结论与规范 §8、§14 G1 / T1.1）
- 关联任务：`T1.1`
- 关联不变量：`INV-001`, `INV-006`, `INV-015`

## 1. 背景与依据

- 规范 §14 Gate G1（单一事实源）首个任务：
  > T1.1 | 定义 `catalog/commands.toml` schema + loader | G0 | catalog crate | 能加载全部命令
- 规范 §8：全系统命令、调色板、帮助文档与类型定义必须且只能有一个事实源（`catalog/commands.toml`），通过 `xtask` 统一代码生成，禁止手改或维护多份命令表。
- `AUD-6` 独立审计确认：当前系统存在 121 项命令（12 项单字母直达结构 + 109 项子菜单命令），需在 `catalog/commands.toml` 中完整结构化表示，并通过专门的纯数据 crate `crates/mathslot-command` 进行解析加载与校验。

## 2. 决策内容

### 2.1 事实源文件与字段规范

1. **事实源文件路径**：`catalog/commands.toml`。
2. **命令条目 Schema 规范**：
   - `id`: `String`（唯一标识，小写蛇形，如 `"frac"`, `"partial"`）
   - `keys`: `Vec<String>`（输入按键序列，如 `["f"]` 或 `["o", "c"]`）
   - `label`: `String`（中文显示标签，如 `"分数"`, `"偏导"`）
   - `category`: `String`（类别标识：`structure`, `calculus`, `matrix`, `accent`, `greek`, `symbol`, `relation`, `setlogic`）
   - `glyph`: `String`（紧凑字形展示，如 `"a/b"`, `"∂"`）
   - `slots`: `Vec<String>`（槽位语义列表，如 `["分子", "分母"]`）
   - `latex`: `String`（LaTeX 模板，槽位使用 `$1, $2` 占位，如 `\\frac{$1}{$2}`；符号为宏名称）
   - `doc`: `String`（详细说明文案）
   - `examples`: `Vec<String>`（流式简码示例，必须以 `▸` 开头）
   - `is_default`: `bool`（子菜单默认项，默认 `false`）
   - `wrap_body_slot`: `Option<usize>`（前置包裹主体槽位索引）

### 2.2 Catalog Crate 架构 (`crates/mathslot-command`)

1. **定位**：纯数据定义、反序列化与静态完整性校验 crate。
2. **依赖限制**：仅允许依赖 `serde` (derive)、`toml`、`thiserror`，严禁依赖 GUI (egui)、渲染 (tiny-skia) 或复杂运行时。
3. **加载与校验规则**：
   - 能够解析并加载 `catalog/commands.toml`；
   - 验证 ID 全局唯一；
   - 验证按键序列 `keys` 全局唯一，无前缀冲突（单键与双键互不重叠）；
   - 验证槽位数量与 `latex` 模板中 `$N` 占位符严格匹配；
   - 验证 `examples` 中每个示例均以 `▸` 开头。

### 2.3 工作区配置集成

- 在根目录 `Cargo.toml` 的 `workspace.members` 中增加 `"crates/mathslot-command"`。

### 2.4 范围与约束

- 允许写入路径：
  - `catalog/commands.toml`
  - `crates/mathslot-command/**`
  - `Cargo.toml`（仅限追加 workspace member）
- 不得修改其他 crate 的运行时代码（业务代码接入在后续 T1.2/T1.3/T1.4 进行）。
- 遵照 TDD 纪律：先编写加载失败的单元测试，再实现 TOML 数据与 Loader。

## 3. 验收要求（VER-6）

1. `cargo test -p mathslot-command`：全部测试通过，能够成功加载并校验全部 121 项命令。
2. `cargo fmt --check`：exit 0
3. `cargo clippy --workspace --all-targets -- -D warnings`：exit 0
4. `cargo test --workspace`：全部通过（原有 138 项 + 新增 catalog 校验测试）。
5. 提交信息：`T1.1: define commands catalog toml schema and loader (crates/mathslot-command)`

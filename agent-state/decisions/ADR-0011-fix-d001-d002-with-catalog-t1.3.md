# ADR-0011：依据 Catalog 单一事实源修复 D-001 调色板与 D-002 文档漂移（T1.3）

- 日期：2026-11-13
- 状态：已批准
- 决策者：coordinator（依据 `AUD-8` 审计结论与规范 §8、§14 G1 / T1.3）
- 关联任务：`T1.3`
- 关联缺陷：`D-001`（调色板 5 卡片 code 错误）、`D-002`（README/HELP 命令漂移）
- 关联不变量：`INV-001`, `INV-006`, `INV-015`

## 1. 背景与依据

- 规范 §14 Gate G1（单一事实源）任务：
  > T1.3 | 用 catalog 修 D-001/D-002 | T1.2 | 调色板/文档 | 5 张卡片正确；文档 code 全可解析
- `AUD-8` 只读独立审计确认：
  - `src/app.rs` 中常用符号调色板（`common_symbols`）5 张卡片（偏导、约等、点乘、叉乘、恒等）与内核命令目录存在严重简码倒置，导致 `scripts/agent/audit_palette.py` 退出码 1；
  - `README.md` 与 `HELP.md` 存在大量历史手写命令漂移（如 `ch` 实际为 `ci`、`cj` 实际为 `ak`、`oq` 实际为 `op` 垂直、`op` 实际为 `oo` 平行、`qm` 实际为差集而复数集应为 `qn`）；
  - T0.3 建立的回归测试 `test_p1_d001` 与 `test_p1_d002` 处于 `#[ignore]` 状态。

## 2. 决策内容

### 2.1 调色板 5 张卡片修复方案（D-001）

在 `src/app.rs` 中，将 `common_symbols` 中的 5 张错位卡片修改为 catalog 唯一事实源定义的权威映射：
1. **偏导**：`badge: "oc"`, `glyph: "∂"`, `code: "oc"`, `hover: "偏导算子 \\partial (Tab o c)"`（对齐 `SymbolCmd::Partial`）
2. **约等于**：`badge: "xb"`, `glyph: "≈"`, `code: "xb"`, `hover: "约等于 \\approx (Tab x b)"`（对齐 `SymbolCmd::Approx`）
3. **点乘**：`badge: "og"`, `glyph: "·"`, `code: "og"`, `hover: "点乘 \\cdot (Tab o g)"`（对齐 `SymbolCmd::Cdot`）
4. **叉乘**：`badge: "of"`, `glyph: "×"`, `code: "of"`, `hover: "叉乘 \\times (Tab o f)"`（对齐 `SymbolCmd::Times`）
5. **恒等于**：`badge: "xa"`, `glyph: "≡"`, `code: "xa"`, `hover: "恒等于 \\equiv (Tab x a)"`（对齐 `SymbolCmd::Equiv`）

### 2.2 README 与 HELP 文档纠偏（D-002）

在 `README.md` 与 `HELP.md` 中，根据 `catalog/commands.toml` 与 `docs/commands.md` 纠正所有手写命令漂移：
- 全导分式：`▸ch` 修正为 `▸ci`
- 下大括号：`▸cj` 修正为 `▸ak`
- 垂直关系：`▸oq` 修正为 `▸op`
- 平行关系：`▸op` 修正为 `▸oo`
- 复数集合：`▸qm` 修正为 `▸qn`（差集保留为 `▸qm`）
- 确保文档中列出的所有 `▸xx` 均在 catalog 中合法存在且可被解析器正常解析。

### 2.3 解冻回归测试

1. 在 `src/p1_regression_tests.rs` 中，移除 `test_p1_d001_palette_tiles_strictly_match_command_catalog` 上的 `#[ignore]` 标注；
2. 在 `crates/mathslot-core/tests/p1_regression_tests.rs` 中，更新 `test_p1_d002_documented_commands_exist_and_match_semantics` 的断言目标为正确命令序列（`ci`, `ak`, `op`, `oo`, `qn`），并移除 `#[ignore]` 标注；
3. 两项测试正式转为默认活跃测试，全工作区测试通过数由 154 提升至 156 项（ignored 降为 5）。

### 2.4 允许写入路径

- `src/app.rs`
- `README.md`
- `HELP.md`
- `src/p1_regression_tests.rs`
- `crates/mathslot-core/tests/p1_regression_tests.rs`

## 3. 验收要求（VER-8）

1. `python3 scripts/agent/audit_palette.py`：exit 0，报 0 处不一致；
2. `scripts/agent/acceptance.sh`（Gate G1 门禁）：exit 0（PASS，调色板一致性检查全绿通过）；
3. `cargo test --workspace`：exit 0（156 passed; 0 failed; 5 ignored），`test_p1_d001` 与 `test_p1_d002` 真实通过；
4. `cargo fmt --check`：exit 0；
5. `cargo clippy --workspace --all-targets -- -D warnings`：exit 0；
6. 提交信息：`T1.3: fix palette tiles D-001 and docs drift D-002 with catalog`

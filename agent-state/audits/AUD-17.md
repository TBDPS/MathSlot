---
id: AUD-17
round: 17
gate: G2
scope: [T2.5, G2_EXIT, D-003, D-005, D-006, D-007, INV-001, INV-002, INV-007, INV-008, INV-012, INV-013, INV-016]
verdict: BLOCK
auditor: auditor
date: 2026-11-14
---

# MathSlot 独立审计报告 (AUD-17)

- **审计角色**：auditor（独立只读审计员；严格遵守 `AGENTS.md` 与 `.agents/skills/independent-audit/SKILL.md`，未修改任何产品代码、测试、脚本或文档）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **分支与提交**：`refactor/v1` (`HEAD: efabf14`)
- **审计目标**：
  1. 审计 Gate G2 最终任务 `T2.5`（`headless parity：旧实现 vs app-core`；产出对比报告；核心路径 100% 一致或有意差异有记录）的现有覆盖度与缺口；
  2. 核验 Gate G2 退出前置条件（`D-003`/`D-005`/`D-006` 闭环验证、`D-007` 唯一留存 G4、工作区门禁、`wasm32` 检查、`mathslot-app/render/store` 卫生扫描）；
  3. 给出 `T2.5` 的 TDD Red-first 蓝图与 `ADR-0020` 读写路径边界。
- **综合裁定**：**BLOCK**（状态：**READY_FOR_DECISION**）
  - **门禁与前置 P1**：`fmt` / `clippy -D warnings` / `cargo test --workspace --offline`（210 passed; 0 failed; 1 ignored）/ `wasm32` check / `acceptance.sh`（PASS=5 FAIL=0 WARN=3）全部通过；G2 范围内 P1 缺陷 `D-003`、`D-005`、`D-006` 均为 **FIXED**（测试已取消 `#[ignore]` 并实测通过），全工作区仅余 `D-007`（归属 G4 `T4.1`）处于 `#[ignore]`。
  - **阻塞原因**：`T2.5` 为 **OPEN**。当前 `crates/mathslot-doc/tests/parity_harness_tests.rs` 仅覆盖 G1 `T1.7`（`mathslot_doc::Editor` 与 `mathslot_core::{StreamEditor, Session}`），**完全未驱动 `mathslot_app::App`（`app-core`）状态机**，也未产出或验证 `T2.5` 要求的“旧实现 vs `app-core` 对比报告”。

---

## 1. 判定摘要与 Gate G2 退出核查

| ID | 类别 / 级别 | 核查对象 | 当前判定 | 证据位置 |
|---|---|---|---|---|
| **T2.5** | Gate G2 任务 | 无头对照（旧实现 `mathslot-core` vs `mathslot-app`）+ 对比报告 | **OPEN**（尚无 `mathslot-app` 对照测试与报告） | §3, §4 |
| **D-003** | **P1**（预览裁切/缩放） | `fitted_size_dims` + `mathslot_render::fit_to_box` | **FIXED**（已取消 `#[ignore]`，PASS） | §2.1 |
| **D-005** | **P1**（配置安全） | `load_library_from_path` / `save_library_to_path` + `mathslot-store` | **FIXED**（已取消 `#[ignore]`，PASS） | §2.1 |
| **D-006** | **P1**（ID 秒级碰撞） | `FormulaLibrary::upsert` + `mathslot-store` UUIDv7 | **FIXED**（已取消 `#[ignore]`，PASS） | §2.1 |
| **D-007** | **P1**（LaTeX 导入失真） | 唯一保留 `#[ignore]`，待 G4 `T4.1` | **OPEN (Deferred to G4)** | §2.2 |
| **G2 门禁** | fmt/clippy/test/wasm/acceptance | 全工作区离线构建、测试与调色板一致性 | **PASS**（待 `T2.5` 完成后签署 `GATE-G2.md`） | §2.2, §2.3 |

### 1.1 规范契约核对（`docs/LLM_IMPLEMENTATION_SPEC.md`）

1. **`T2.5` 与 G2 退出准则**：
   - [`docs/LLM_IMPLEMENTATION_SPEC.md:995`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L995)：`T2.5 | headless parity：旧实现 vs app-core | T2.1-T2.4 | 对比报告 | 核心路径 100% 一致或有意差异有记录`。
   - [`docs/LLM_IMPLEMENTATION_SPEC.md:997`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L997)：`G2 退出：app-core 可独立测试；数据/渲染契约通过；旧实现只作为对照。`
   - [`docs/LLM_IMPLEMENTATION_SPEC.md:1039-1041`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L1039-L1041)：`G2 (app-core-and-data): tasks [T2.1..T2.5], exit [headless_tests, data_acceptance, render_acceptance]`。
   - [`docs/LLM_IMPLEMENTATION_SPEC.md:1145`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L1145)：`G2 | app-core、undo、store、render、headless parity`。
2. **模块边界与不变量（§2 / §5.2 / §5.3）**：
   - [`docs/LLM_IMPLEMENTATION_SPEC.md:347`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L347) 与 [`:358-363`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L358-L363)：`mathslot-app` 禁止引入 `egui`、DOM、Obsidian 或直接文件 IO；必须在无 UI、无文件系统、无渲染器下可独立测试。
   - **关键约束**：`crates/mathslot-app/Cargo.toml` 的 `[dependencies]` 必须保持纯无头（当前仅 `mathslot-command`、`mathslot-doc`、`mathslot-syntax`、`serde`、`thiserror`，见 [`crates/mathslot-app/Cargo.toml:9-14`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/Cargo.toml#L9-L14)）。对照测试引入 `mathslot-core` / `mathslot-store`（依赖 `dirs`/`fd-lock`/`tempfile`）/ `mathslot-render` / `mathslot-latex` 时，**只能放入 `[dev-dependencies]`**，绝不可污染 `[dependencies]` 或 `wasm32` 编译。
   - `INV-001` / `INV-002` / `INV-007` / `INV-008` / `INV-012` / `INV-013` / `INV-016`（[`docs/LLM_IMPLEMENTATION_SPEC.md:188-203`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L188-L203)）：旧栈 `crates/mathslot-core/src/{parser,ast,latex}.rs` 保持冻结只读（[`crates/mathslot-core/src/parser.rs:1-4`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/parser.rs#L1-L4)），仅作对照参考。

---

## 2. Gate G2 门禁、P1 闭环与代码卫生实测证据

### 2.1 P1 缺陷闭环复核（`D-003`、`D-005`、`D-006`）

- **`D-003`**：[`src/p1_regression_tests.rs:71-104`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L71-L104)（已移除 `#[ignore]`，直接调用生产 `crate::app::fitted_size_dims` 与 `mathslot_render::fit_to_box`）→ `cargo test --workspace --offline` 实测 `ok`（**FIXED**）。
- **`D-005`**：[`src/p1_regression_tests.rs:111-169`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L111-L169)（已移除 `#[ignore]`，调用 `crate::modals::{load_library_from_path, save_library_to_path}`）及 [`crates/mathslot-store/tests/data_safety_tests.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/tests/data_safety_tests.rs)（`t_data_001..007` 7/7 通过）→ 实测 `ok`（**FIXED**）。
- **`D-006`**：[`crates/mathslot-core/tests/p1_regression_tests.rs:120-154`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/tests/p1_regression_tests.rs#L120-L154)（已移除 `#[ignore]`）及 `crates/mathslot-store` `t_data_003_1000_burst_uuidv7_conflict_and_concurrent_saves` → 实测 `ok`（**FIXED**）。

### 2.2 独立执行命令与实测输出

1. **格式检查**：`cargo fmt --check`
   - **Exit Code**: `0`（无输出）
2. **Clippy 严格检查**：`cargo clippy --workspace --all-targets -- -D warnings`
   - **Exit Code**: `0`
   - **输出尾部**：
     ```text
     Finished `dev` profile [optimized + debuginfo] target(s) in 0.25s
     ```
3. **全工作区离线测试**：`cargo test --workspace --offline`
   - **Exit Code**: `0`
   - **汇总统计**（聚合全部 `test result:` 行）：`passed=210 failed=0 ignored=1`
   - **关键分包尾部**：
     ```text
     Running tests/app_state_machine_tests.rs (...): 12 passed; 0 failed; 0 ignored
     Running tests/render_acceptance_tests.rs (...): 5 passed; 0 failed; 0 ignored
     Running tests/data_safety_tests.rs (...): 7 passed; 0 failed; 0 ignored
     Running tests/architecture_guard_tests.rs (...): 6 passed; 0 failed; 0 ignored
     ```
4. **Ignored 测试核验**：`cargo test --workspace --offline -- --ignored`
   - **Exit Code**: `101`（预期：仅剩 `D-007`）
   - **定位确认**：`rg -n "#\[ignore" src crates` 仅命中 1 处 [`crates/mathslot-core/tests/p1_regression_tests.rs:162`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/tests/p1_regression_tests.rs#L162) (`#[ignore = "P1 regression: D-007 (fails until fixed in G1/G2/G4)"]`)。
   - **输出尾部**：
     ```text
     running 1 test
     test test_p1_d007_latex_import_reports_lossy_and_blocks_degradation ... FAILED
     ...
     test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
     ```
5. **WASM 目标离线编译检查**：`cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline`
   - **Exit Code**: `0`
   - **输出尾部**：
     ```text
     Finished `dev` profile [optimized + debuginfo] target(s) in 0.14s
     ```
6. **聚合门禁脚本**：`scripts/agent/acceptance.sh`
   - **Exit Code**: `0`
   - **输出尾部**：
     ```text
     结果 检查项                    说明
     ------ ---------------------------- ----
     PASS   cargo fmt --check            exit 0
     PASS   cargo clippy -D warnings     exit 0
     PASS   cargo test --workspace       exit 0
     PASS   调色板一致性           exit 0（gate=G2）
     WARN   let _ = 计数               15 处（G4 前应清零）
     WARN   unwrap() 计数              20 处（用户输入路径应为 0）
     WARN   命令表常量              3 处（G1 后应只剩 catalog）
     PASS   工作区干净              0 个未提交改动

     PASS=5 FAIL=0 WARN=3
     结论：PASS
     ```

### 2.3 `mathslot-app` / `mathslot-render` / `mathslot-store` 卫生扫描

- **扫描命令 1**：`rg -n "let _ =|#\[allow|#\[ignore|\.unwrap\(|\.expect\(" crates/mathslot-app crates/mathslot-render crates/mathslot-store`（Exit Code: `0`）
  - `let _ =`：**0 处**；
  - `#[allow]`：**0 处**；
  - `#[ignore]`：**0 处**；
  - `.unwrap()` / `.expect(` 在三 crate 源码中：**0 处**（通过 `rg -n "\.unwrap\(|\.expect\(" crates/mathslot-app/src crates/mathslot-render/src crates/mathslot-store/src` 返回 Exit Code `1` 验证）；仅测试代码中存在断言用 `.expect(...)` 及 [`crates/mathslot-store/tests/data_safety_tests.rs:479`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/tests/data_safety_tests.rs#L479) 的 1 处测试 `.unwrap()`。
- **安全属性**：[`crates/mathslot-app/src/lib.rs:1`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/lib.rs#L1)、[`crates/mathslot-render/src/lib.rs:1`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/lib.rs#L1)、[`crates/mathslot-store/src/lib.rs:1`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L1) 均声明 `#![forbid(unsafe_code)]`。
- **冻结守护**：`git log --oneline -n 5 -- crates/mathslot-core/src/{parser,ast,latex}.rs` 确认 G2 期间无任何提交触碰上述 3 个冻结文件，且 `architecture_guard_tests` 6/6 通过。

---

## 3. `T2.5` 覆盖现状与缺口分析

### 3.1 `crates/mathslot-app` 现有能力与测试覆盖

- **状态与事件契约**：
  - `EditorState`（[`crates/mathslot-app/src/state.rs:4-11`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/state.rs#L4-L11)）：`Idle`, `PrefixRoot`, `PrefixSub { key }`, `Jump { tail }`, `Nav { path }`, `InvalidPrefix { key }`（注：`sync_state()` [`app.rs:384-411`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L384-L411) 目前不产生 `Jump`，因为跳转以 `NavMode` + `NavAction` 表达）。
  - `AppEvent`（[`crates/mathslot-app/src/event.rs:4-32`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/event.rs#L4-L32)）与 `AppCommand`（[`command.rs:4-26`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/command.rs#L4-L26)）覆盖：字符流输入、功能键（Backspace/Delete/Tab/Escape/ArrowLeft/ArrowRight）、粘贴、调色板卡片、Undo/Redo、导出（strict/non-strict）/复制、IME 组合更新与提交、进入/退出/执行导航、Clear、ImportLatex。
  - `Effect`（[`effect.rs:7-13`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/effect.rs#L7-L13)）：按确定性顺序输出 `Status` → `Render(RenderRequest)` → `Focus` → `Clipboard` → `ExportResult`。
- **现有测试**（[`crates/mathslot-app/tests/app_state_machine_tests.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/app_state_machine_tests.rs)，12 个测试）：
  - 仅孤立验证 `App` 自身行为（`A-EDIT-001..008`、Effect 顺序、Clear/Import 单步事务、DeleteForward、D-104 护栏），**没有任何一条测试导入或对照旧编辑器 `mathslot_core::StreamEditor`**，也未对照 `mathslot_render` / `mathslot_store`。

### 3.2 `crates/mathslot-doc/tests/parity_harness_tests.rs` vs `T2.5` 缺口对照

[`crates/mathslot-doc/tests/parity_harness_tests.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/tests/parity_harness_tests.rs) 属于 Gate G1 `T1.7`（[`:1`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/tests/parity_harness_tests.rs#L1)），针对 `T2.5` 存在 **5 项关键缺口**：

1. **未驱动 `app-core` (`mathslot_app::App`)**：
   - `test_parity_commands_template_expansion`（[`:22-110`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/tests/parity_harness_tests.rs#L22-L110)）与 `test_parity_matrix_and_delimiter_structures`（[`:113-321`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/tests/parity_harness_tests.rs#L113-L321)）直接调用 `mathslot_doc::Editor::type_char`，完全绕过 `App::dispatch(AppEvent)`、`EditorState` 迁移、`Effect` 序列与 `History` 接口。
2. **部分用例实质是“新栈自己对比自己”**：
   - `test_parity_slot_navigation_order`（[`:324-593`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/tests/parity_harness_tests.rs#L324-L593)）与 `test_parity_latex_export_with_known_deltas` 公式段（[`:598-627`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/tests/parity_harness_tests.rs#L598-L627)）将 `mathslot_doc::Editor` 与 `mathslot_core::Session` 对比；但 [`crates/mathslot-core/src/session.rs:6-10`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/session.rs#L6-L10) 本质就是 `mathslot_doc::Editor` 的薄封装，而非旧运行时编辑器 `StreamEditor`（[`crates/mathslot-core/src/editor.rs:134`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/editor.rs#L134)）。
3. **缺少核心交互工作流对 `StreamEditor` vs `App` 的端到端对照**：
   - **流式逐字编辑与空格/退格**：`App::dispatch(KeyInput)` + `KeyDown(Backspace)` vs `StreamEditor::type_text` / `from_source`；
   - **调色板卡片全集对照**：`AppEvent::PaletteCard(cmd.id)` vs `StreamEditor::apply_card_click(code)`（T1.7 仅测了 5 张 D-001 卡片且未与 `StreamEditor::apply_card_click` 对比）；
   - **Undo / Redo**：`AppEvent::Undo` / `Redo` vs `StreamEditor::undo` / `redo`（基本可逆性一致 + `INV-008` / `D-012` Intent 分组有意差异记录）；
   - **Clear / Import / 88 条预置库**：`AppEvent::Clear` / `ImportLatex` vs `StreamEditor::clear` / `load_preset`，以及 `mathslot_store::Catalog::builtin().presets()`（88 条，实测 `catalog/presets.json len= 88`）vs `mathslot_core::PRESET_LIBRARY`（88 条，[`crates/mathslot-core/src/presets.rs:14`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/presets.rs#L14)）逐条对照加载；
   - **渲染降级与适配契约对照**：`App` 发出的 `Effect::Render(RenderRequest)` 喂入 `mathslot_render::RenderPipeline`（`degraded + diagnostics`、`fit_to_width`/`fit_to_box`、`ErrorSummary` 截断）vs 旧 `visual::build_fallback_preview_latex` 静默降级（`D-011`）。
4. **未覆盖 `App` 独有事件/状态边界与有意差异**：
   - 例如 `KeyDown(Key::Escape)` 在空闲态映射到 `DeleteBackward`（[`app.rs:79-85`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L79-L85)）而非 `StreamEditor::toggle_esc_jump`（[`editor.rs:587`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/editor.rs#L587)）；`KeyDown(Key::Tab)` 在 `App` 为 `NextSlot`（[`app.rs:78`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L78)）而在 `StreamEditor::handle_tab` 为插入 `▸`（[`editor.rs:424`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/editor.rs#L424)）；`EditorState::Jump` 未启用而统一由 `NavMode` + `NavAction` 承载；`type_char` 对空白字符不插入 AST 节点仅切分 Intent（[`crates/mathslot-doc/src/editor.rs:680-683`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/editor.rs#L680-L683)）。这些必须在对比报告中明确记录为 `IntentionalDelta`。
5. **未产出可机读的对比报告（`T2.5` 产出要求）**：
   - `T2.5` 明确要求 `产出: 对比报告`（核心路径 100% 一致或有意差异有记录）。当前没有任何测试构建、校验并输出结构化 `ParityReport`（统计 `total_cases`、`exact_parity`、`intentional_deltas`、`unexpected_mismatches == 0`）。

---

## 4. 历史结论抽查（按 `SKILL.md` §3.3）

| 来源 | 历史声称 | 本轮实测验证 | 结论 |
|---|---|---|---|
| [`docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:11,23,30`](file:///home/mat/Projects/mathslot-next/docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md#L11-L30) | 声称「全面通过 (PASS - 100% 达标，正式完成重构)」、「`git ls-files docs/` 输出 0」 | 实测 `git ls-files docs/ \| wc -l` = **`60`**（Exit 0）；且该报告签署时仍存在 `F-004` (`clippy -D warnings` 失败) 与 `D-001..D-007` 7 项 P1 缺陷 | **历史声称不实（待验证声明失效）** |
| [`docs/FINAL_ACCEPTANCE_REPORT.md:12,44`](file:///home/mat/Projects/mathslot-next/docs/FINAL_ACCEPTANCE_REPORT.md#L12-L44) | 声称「47/47 全部通过，正式达成生产准出标准」 | 该报告仅覆盖新栈原型 + `Session`（规范 `F-001` 确认前端实际跑的是 `StreamEditor`），未覆盖 `src/app.rs` 与 `StreamEditor` 无头对照；`T2.5` 至今尚未覆盖 `app-core` vs `StreamEditor` | **范围不足，不可作为 `T2.5` 证据** |

---

## 5. `T2.5` TDD Red-First 蓝图与 `ADR-0020` 路径边界

### 5.1 TDD Red-First 测试设计（建议落位：`crates/mathslot-app/tests/parity_report_tests.rs`）

1. **Red-First 验证机制**：
   - 先建立 `ParityReport` 结构（包含 `ScenarioResult { id, category, legacy_outcome, app_outcome, status: ParityStatus }`，其中 `ParityStatus` 为 `ExactParity` / `IntentionalDelta { delta_id, rationale }` / `Mismatch(String)`）与“未登记差异门禁”（`assert_eq!(report.unexpected_mismatches, 0)` 及 `assert!(report.all_deltas_registered())`）。
   - 第一步（**RED**）：在实现完对照场景、尚未补齐全部 `IntentionalDelta` 注册或对照断言前运行 `cargo test -p mathslot-app --test parity_report_tests --offline`，真实展示因未登记差异或对照缺口导致的失败输出（exit `101`）；若对照过程中发现 `mathslot-app` 存在非预期行为偏差（如特定输入/导航/导出/清空边界与规范或旧核心不一致），先固定失败用例再修 `crates/mathslot-app/src/**`。
   - 第二步（**GREEN**）：补齐全部对照维度并精确登记受规范依据约束的 `IntentionalDelta` 记录，确保 `unexpected_mismatches == 0` 且确定性报告可序列化输出（如测试内校验 JSON/Markdown 报告完整性并通过环境变量或 `target/parity-report-g2.{json,md}` 可选导出供 `GATE-G2.md` 引用，不写入 `docs/` 或 `agent-state/`）。

2. **对照矩阵必测场景（Old `StreamEditor` / `visual` / `PRESET_LIBRARY` vs `mathslot_app::App` + `RenderPipeline` + `Catalog`）**：
   - **P-CMD-121**：遍历 `GENERATED_COMMANDS` 全部 121 条命令的 `examples`，逐字符 `AppEvent::KeyInput` 对比 `StreamEditor::from_source`，断言 `mathslot_syntax::parse` AST 结构等价（`exprs_structurally_equal`）、`App` 回到 `EditorState::Idle` 且发出 `Effect::Render`（矩阵格式空格记为已知 `DELTA-FORMAT-MATRIX`）。
   - **P-PALETTE**：遍历目录命令卡片 `AppEvent::PaletteCard(id)` 对比 `StreamEditor::apply_card_click(code)`，验证绝大多数命令结构等价，并显式记录 `D-001` 修复与多槽位模板展开行为。
   - **P-EDIT-UNDO**：基础输入 → 退格 → Clear → 粘贴 `▸f1;2;` → Undo → Redo 序列在双侧的可逆性；显式记录 `DELTA-UNDO-INTENT`（`D-012` / `INV-008`：卡片后打字不合并、Clear/Import 单步可撤销并保留前置历史 `D-105`）与 `DELTA-WHITESPACE-COALESCE`（空白仅封口不插幽灵空格）。
   - **P-NAV**：双侧在 `\frac{a}{b}`、`\sqrt[3]{8}`、`2x2` 矩阵下的槽位推进/回绕对比，验证文本与撤销栈零污染，显式记录 `DELTA-NAV-MODEL`（`App` 使用显式 `EnterNavMode`/`KeyDown(Tab)`，而旧 `StreamEditor` 使用 `Esc` 标签树与 `Tab` 插入 `▸`）。
   - **P-DIAG-EXPORT**：`▸`、`▸m`、`▸zz` 等未决/未知输入下 `RequestCopy` / `RequestExport { strict: false | true }` 对比 `StreamEditor::to_latex()`，验证占位符 `\text{▸...}` 均非空、严禁退化为 `z`，并显式记录 `DELTA-STRICT-EXPORT`（`App` 在 `strict: true` 下返回 `AppError::StrictExportBlocked` 与 `Effect::Status`）。
   - **P-PRESET-88 & P-IMPORT**：`mathslot_store::Catalog::builtin().presets()`（88 条）与 `mathslot_core::PRESET_LIBRARY`（88 条）逐条 ID/source 对照，喂入 `App::dispatch(AppEvent::ImportLatex)` 与 `StreamEditor::load_preset`，校验解析后 AST 等价性（记录 `D-007` 仅限 G4 的简化/非支持宏边界）。
   - **P-RENDER-STORE-G2**：验证 `App` 输出的 `RenderRequest` 接入 `mathslot_render::RenderPipeline` 后在正常公式与降级宏场景下行为契约成立（显式记录 `D-011` `DELTA-DEGRADED-DIAGNOSTICS`：旧 `visual::build_fallback_preview_latex` 静默降级 vs 新管线 `degraded = true` + `diagnostics`）。

### 5.2 `ADR-0020` 建议读写边界（供 coordinator 决策）

- **允许修改（implementer 作用域内）**：
  - `crates/mathslot-app/Cargo.toml`：**仅限 `[dev-dependencies]`**（可引入 `mathslot-core`、`mathslot-latex`、`mathslot-render`、`mathslot-store`、`serde_json`）；**严禁**修改 `[dependencies]`。
  - `crates/mathslot-app/tests/parity_report_tests.rs`（新建无头对照测试与确定性 `ParityReport` 校验）。
  - `crates/mathslot-app/src/**`（**仅当**对照测试真实暴露 `App` 状态机非预期缺陷时允许按 Red→Green 修复，且不得引入第二套 parser/AST/命令表）。
- **严格禁止修改**：
  - `crates/mathslot-core/src/{parser,ast,latex}.rs`（T1.4 冻结架构，绝对只读）及 `crates/mathslot-core/**`；
  - `crates/mathslot-command/**`、`crates/mathslot-syntax/**`、`crates/mathslot-doc/**`、`crates/mathslot-latex/**`、`crates/mathslot-render/**`、`crates/mathslot-store/**`、`crates/mathslot-wasm/**`；
  - `src/**`、`obsidian-mathslot/**`、`catalog/**`、`xtask/**`、`scripts/**`、`docs/**`、`agent-state/**`。
- **质量硬约束**：0 新增 `let _ =`、0 `#[allow]`、0 `#[ignore]`、0 `src/` 内 `.unwrap()`/`.expect(`，且 `cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline` 保持退出码 `0`。

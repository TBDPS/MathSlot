---
id: AUD-23
round: 24
gate: G3
scope: [T3.3, A-RENDER-001, A-RENDER-003, A-RENDER-004, A-RENDER-005, A-UI-005, D-003, D-010, D-011, D-019]
verdict: BLOCK
auditor: mathslot-auditor
date: 2026-11-14
---

# 独立审计报告 AUD-23：Gate G3 / `T3.3`（预览 / 诊断 / 错误折叠 + `RenderAdapter`）前置只读审计

## 1. 判定摘要

- **审计裁定**：**`BLOCK`**（`T3.3` 核心交付物——`packages/ui` 异步 `RenderAdapter` 接口、MathJax 3 SVG 主渲染适配器、预览面板、可折叠诊断/错误详情面板与导出检查 UI——尚未创建；同时后端 `mathslot-render` / `mathslot-doc` / `mathslot-app` 存在制约 `T3.3` 与 `ADR-0022` §1.2 落地的契约缺口）。
- **逐项结论（仅使用 `OPEN` / `FIXED` / `NOT-REPRODUCIBLE`）**：
  1. **`T3.3`（`packages/ui` 预览 / 诊断 / 错误折叠组件 + `RenderAdapter`）**：**`OPEN`** — `packages/ui/src/` 当前仅含 `T3.1` 编辑器（`editor/*`）与 `T3.2` 调色板/导航树（`palette/*`、`nav/*`），无预览组件、无 `RenderAdapter`（MathJax 3 SVG 主渲染 / `latex-rust` `latex_to_svg` 兜底 / Obsidian `renderMath` 宿主适配接口）、无折叠错误面板或“复制诊断信息”交互（[`packages/ui/src/index.ts:1-78`](file:///home/mat/Projects/mathslot-next/packages/ui/src/index.ts#L1-L78)、[`packages/ui/package.json:18-24`](file:///home/mat/Projects/mathslot-next/packages/ui/package.json#L18-L24)）。
  2. **`D-003` / `A-RENDER-001`（预览 fit-to-width / 实际大小 / 超宽左对齐滚动）**：
     - Rust 无头契约 `crates/mathslot-render/src/fit.rs`：[`fit.rs:19-157`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/fit.rs#L19-L157) 与 [`render_acceptance_tests.rs:82-113`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/tests/render_acceptance_tests.rs#L82-L113) 已通过（**`FIXED`**）。
     - `packages/ui` 预览视口布局与缩放控件：**`OPEN`**（尚无预览组件与 fit-to-width / 实际大小切换 UI）。
  3. **`D-010` / `A-RENDER-005` / `A-UI-005`（短错误码+摘要 ≤120 字符、200 字符源码截断+“已截断”、折叠面板与可复制诊断）**：
     - Rust 无头契约 `crates/mathslot-render/src/error.rs`：[`ErrorSummary` (`error.rs:60-176`)](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/error.rs#L60-L176) 已实现 `HEADER_MAX_CHARS = 120`、`SOURCE_MAX_CHARS = 200`、`TRUNCATED_SUFFIX = "…（已截断）"` 及完整 `full_detail`（**`FIXED`**）。
     - `packages/ui` 错误折叠/复制 UI 与 `mathslot-app` 诊断契约：**`OPEN`** — [`MathSlotEditor.svelte:229-238`](file:///home/mat/Projects/mathslot-next/packages/ui/src/editor/MathSlotEditor.svelte#L229-L238) 仅为扁平 `ms-diagnostics` 列表，无折叠面板/截断/复制；且 `mathslot-app` 尚未接入 `ErrorSummary`（见 §3 **`D-115`**）。
  4. **`D-011` / `A-RENDER-003`（`degraded + diagnostics` 显式降级与 UI 降级徽章/原因）**：
     - `RenderPipeline` 契约：[`pipeline.rs:119-137`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/pipeline.rs#L119-L137) 强制回退写入 `degraded: true` 与非空 `diagnostics`（**`FIXED`**）。
     - `latex-rust` `latex_to_svg` 后端实现与 UI 降级徽章：**`OPEN`** — `crates/mathslot-render` 尚无 `latex-rust` 后端（见 §3 **`D-113`**），`packages/ui` 尚无降级预览徽章与原因展示。
  5. **`D-019` / `A-RENDER-004`（debounce + hash cache + generation cancel）**：
     - `crates/mathslot-render` 无头契约（[`cache.rs:16-254`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/cache.rs#L16-L254)、[`cancel.rs:5-110`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/cancel.rs#L5-L110)、[`pipeline.rs:78-147`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/pipeline.rs#L78-L147)）：**`FIXED`**。
     - 前端 `RenderAdapter` 异步调度（generation 取消/防丢序、防抖、缓存）与 `mathslot-app` 请求契约：**`OPEN`**。
  6. **`D-004`（导出/复制伴随诊断检查）**：
     - `mathslot-doc` / `mathslot-app` 后端严格/非严格导出与 `Effect::ExportResult`（[`editor.rs:249-267`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/editor.rs#L249-L267)、[`app.rs:409-432`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L409-L432)）：**`FIXED`**。
     - `packages/ui` 复制/导出阻断提示与 TS `Effect::ExportResult` 强类型映射：**`OPEN`**（[`packages/ui/src/client/engine.ts:80`](file:///home/mat/Projects/mathslot-next/packages/ui/src/client/engine.ts#L80) 仍为 `unknown[]` / `unknown`）。
  7. **新发现缺陷（§3）**：登记 **`D-113`**（P2，`mathslot-render` 尚无 `latex-rust` `latex_to_svg` `MathRenderer` 后端实现）、**`D-114`**（P2，新栈 `mathslot-syntax`/`mathslot-doc`/`mathslot-app` 缺少 `VisualDialect::MathJax` 预览高亮 `preview_latex`）、**`D-115`**（P2，`mathslot-app` 诊断与 `RenderRequest` 契约未接入 `ErrorSummary`/`Span`/渲染请求字段，且 `StatusMessage` 直接输出 `{first_diag:?}`）。

---

## 2. 逐项证据

### 2.1 `packages/ui/src/` 预览 / 诊断 / `RenderAdapter` 现状（`T3.3`, `A-UI-005`）

- **代码核验**：
  - [`packages/ui/package.json:18-24`](file:///home/mat/Projects/mathslot-next/packages/ui/package.json#L18-L24) 仅依赖 `@codemirror/*`、`codemirror` 与 `svelte`，尚未引入 `mathjax-full`（或 `@mathjax/src`）。
  - [`packages/ui/src/index.ts:1-78`](file:///home/mat/Projects/mathslot-next/packages/ui/src/index.ts#L1-L78) 仅导出 `MathSlotEditor`、`PalettePanel`、`NavTreePanel` 及其模型/类型，不存在任何预览组件、渲染适配器或可折叠诊断组件。
  - [`packages/ui/src/editor/MathSlotEditor.svelte:229-238`](file:///home/mat/Projects/mathslot-next/packages/ui/src/editor/MathSlotEditor.svelte#L229-L238) 仅以平铺列表渲染 `activeSnapshot.diagnostics`（`{diag.severity}` + `{diag.message}`），无错误码徽章、无源码截断、无折叠详情、无“复制诊断信息”按钮，也无预览区与降级徽章。
- **命令**：`ls -la packages/ui/src/`（exit `0`）
  ```text
  drwxr-xr-x. 1 mat mat   18 11月14日 11:37 client
  drwxr-xr-x. 1 mat mat   88 11月14日 11:37 editor
  drwxr-xr-x. 1 mat mat   40 11月14日 11:56 generated
  -rw-r--r--. 1 mat mat 1759 11月14日 14:10 index.ts
  drwxr-xr-x. 1 mat mat   58 11月14日 12:01 nav
  drwxr-xr-x. 1 mat mat   68 11月14日 12:01 palette
  drwxr-xr-x. 1 mat mat   20 11月14日 11:37 theme
  ```
- **判定**：**`OPEN`**。

### 2.2 `crates/mathslot-render/src/` 契约与 `latex-rust` SVG 后端核验（`D-003`, `D-010`, `D-011`, `D-019`, `ADR-0022` §1.2）

- **代码核验**：
  1. **已具备的无头契约**：
     - [`crates/mathslot-render/src/types.rs:30-66`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/types.rs#L30-L66)：定义 `BackendKind::{MathJaxSvg, LatexRust, Mock}`、`RenderData::{Svg(String), Png{..}}`、`RenderRequest`（含 `id`, `generation`, `mode`, `latex`, `theme`, `scale`, `format`, `backend`）与 `RenderOutput`（含 `degraded`, `diagnostics`, `cache_hit`）。
     - [`crates/mathslot-render/src/pipeline.rs:78-147`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/pipeline.rs#L78-L147)：`RenderPipeline` 在请求前/缓存命中后/主渲染后/降级提交前 6 个点调用 `GenerationTracker::check`（`D-019`），并在 fallback 成功时强制设置 `fb_out.degraded = true` 并附加 `RenderDiagnostic`（`D-011` / `INV-012`）。
     - [`crates/mathslot-render/src/error.rs:93-143`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/error.rs#L93-L143)：`ErrorSummary` 严格限制 `HEADER_MAX_CHARS = 120`、`SOURCE_MAX_CHARS = 200`、截断后缀 `"…（已截断）"`，并保留完整 `full_detail`（`D-010` / `A-RENDER-005`）。
     - [`crates/mathslot-render/src/fit.rs:44-157`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/fit.rs#L44-L157)：实现 `fit_to_width`、`fit_to_box`、`fit_with_policy` 与 `true_scale_percent`（`D-003` / `A-RENDER-001`）。
     - [`crates/mathslot-render/src/cache.rs:40-106`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/cache.rs#L40-L106) 与 [`cancel.rs:5-110`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/cancel.rs#L5-L110)：实现 6 维 FNV-1a LRU 缓存、原子 generation 追踪与确定性 `DebounceGate`（`D-019`）。
  2. **缺失的 `latex-rust` `latex_to_svg` 后端**：
     - [`crates/mathslot-render/Cargo.toml:9-12`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/Cargo.toml#L9-L12) 仅依赖 `mathslot-syntax`、`serde`、`thiserror`，未引入 `latex-rust`，[`crates/mathslot-render/src/`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/lib.rs#L1-L20) 中仅存 `MathRenderer` trait 与测试内 `MockBackend`（[`render_acceptance_tests.rs:23-76`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/tests/render_acceptance_tests.rs#L23-L76)）。
     - 实查工作区锁定的 `latex-rust = 3.0.3`（[`Cargo.lock:1254-1256`](file:///home/mat/Projects/mathslot-next/Cargo.lock#L1254-L1256)）源码已原生提供 `latex_rust::latex_to_svg(latex: &str, font: &MathFont, options: &SvgOptions) -> Result<String, Error>`，尚未接入 `mathslot-render`。
- **命令**：
  - `cargo test -p mathslot-render --offline`（exit `0`）
    ```text
    test a_render_001_wide_formula_fits_width_and_actual_scale_scrolls_left_aligned ... ok
    test a_render_002_matrix_nav_box_strictly_bounded_and_aspect_preserved ... ok
    test a_render_003_fallback_never_silent_and_emits_degraded_diagnostics ... ok
    test a_render_004_generation_cancellation_cache_key_and_debounce_gate ... ok
    test a_render_005_error_summary_bounded_header_and_source_excerpt ... ok
    test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
    ```
  - `find "${CARGO_HOME:-$HOME/.cargo}/registry/src" -maxdepth 4 -name "latex-rust*" -exec sh -c 'rg -n "pub fn latex_to_svg|pub fn latex_to_png|pub struct SvgOptions|Svg" "$1/src/"' _ {} \;`（exit `0`）
    ```text
    .../latex-rust-3.0.3/src/lib.rs
    85:pub use render::svg::{latex_to_svg, render_svg, render_svg_with_metrics, SvgImage, SvgOptions};
    ```
- **判定**：无头渲染契约 **`FIXED`**；`latex-rust` `latex_to_svg` 兜底后端 **`OPEN`**（`D-113`）。

### 2.3 `preview_latex`（`VisualDialect::MathJax`）与 `mathslot-app` 快照/效果契约核验

- **代码核验**：
  1. **旧栈与 WASM 存在 `VisualDialect::MathJax` 预览高亮**：
     - [`crates/mathslot-core/src/visual.rs:8-15, 112-147, 1360-1401`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/visual.rs#L1360-L1401) 通过 `VisualDialect::MathJax` 生成带 `\bbox[#...,border:1.25px solid #...]`、`{\color{#...}...}`、空槽占位 `\phantom{x}` 与实时光标 `\pmb{\lvert}` 的 `preview_latex`；[`crates/mathslot-wasm/src/lib.rs:759-760, 806`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs#L759-L760) 将其作为 `previewLatex` 传给 Obsidian `renderMath`。
  2. **新栈（`mathslot-syntax` / `mathslot-doc` / `mathslot-app`）缺失 `preview_latex`**：
     - [`crates/mathslot-syntax/src/printer.rs:9-256`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs#L9-L256) 只有 `to_canonical_latex` 和 `to_mathslot_source`，且第 147 行将 `Expr::Placeholder { .. }` 直接输出为 `"{}"`。输入 `▸f` 等未填槽位公式时，规范 `to_latex()` 为 `\frac{}{}`，在 MathJax SVG 中没有可见占位框，且无法高亮当前活动槽位、光标位置与待决命令。
     - [`crates/mathslot-doc/src/document.rs:46`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/document.rs#L46) 与 [`crates/mathslot-doc/src/editor.rs:185-267`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/editor.rs#L185-L267) 仅提供 `to_latex()` / `export_latex*()`。
     - [`crates/mathslot-app/src/snapshot.rs:83-95`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/snapshot.rs#L83-L95) 的 `EngineSnapshot` 只有 `latex` 与 `copy_text`，[`crates/mathslot-app/src/effect.rs:16-20`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/effect.rs#L16-L20) 的 `RenderRequest` 只有 `{ request_id, latex, has_diagnostics }`。
  3. **`mathslot-app` 诊断与 `Effect::Render` 契约脱节**：
     - [`crates/mathslot-app/Cargo.toml:9-20`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/Cargo.toml#L9-L20) 仅在 `[dev-dependencies]` 依赖 `mathslot-render`，正式 `[dependencies]` 未引入 `mathslot-render`。
     - [`crates/mathslot-app/src/app.rs:438-450`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L438-L450) 将 `format!("{first_diag:?}")` 直接暴露给 `StatusMessage.message`（未限制 ≤120 字符单行摘要，也未截断源码）。
     - [`crates/mathslot-app/src/snapshot.rs:52-80`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/snapshot.rs#L52-L80) 的 `DiagnosticSnapshot` 只有 `{ code, severity, message }`，缺少 `span`、`hint`、`source_excerpt` 截断字段。
     - [`packages/ui/src/client/engine.ts:64-81`](file:///home/mat/Projects/mathslot-next/packages/ui/src/client/engine.ts#L64-L81) 中 `ExportResult` 使用 `unknown[]` / `unknown`，未强类型映射 `DiagnosticSnapshot` / `AppError`。
- **命令**：`rg -n "VisualDialect|bbox|latex_to_svg|latex-rust|preview_latex|MathJax" crates/ src/ packages/`（exit `0`）
  ```text
  crates/mathslot-render/src/cache.rs:64:            BackendKind::MathJaxSvg => 0u8,
  crates/mathslot-render/src/types.rs:31:    MathJaxSvg,
  crates/mathslot-wasm/src/lib.rs:759:    let preview_latex =
  crates/mathslot-wasm/src/lib.rs:760:        build_preview_latex(&editor.parsed, editor.cursor_char, VisualDialect::MathJax);
  crates/mathslot-core/src/visual.rs:12:pub enum VisualDialect {
  ```
- **判定**：**`OPEN`**（见 §3 `D-114`、`D-115`）。

### 2.4 npm MathJax 包可用性、前端测试与门禁检查

1. **npm registry MathJax 可用性**：
   - 命令：`npm view mathjax-full version && npm view mathjax version && npm view @mathjax/src version`（exit `0`）
   - 输出：
     ```text
     3.2.2
     4.1.3
     4.1.3
     ```
2. **`packages/ui` Vitest 基线**：
   - 命令：`cd packages/ui && npm test`（exit `0`）
   - 尾部输出：
     ```text
      ✓ tests/navTree.test.ts (2 tests) 336ms
      ✓ tests/editor.test.ts (6 tests) 658ms
      ✓ tests/palette.test.ts (5 tests) 862ms

      Test Files  3 passed (3)
           Tests  13 passed (13)
     ```
3. **工作区快速门禁**：
   - 命令：`scripts/agent/acceptance.sh --fast`（exit `0`）
   - 尾部输出：
     ```text
     PASS   cargo fmt --check            exit 0
     WARN   cargo clippy -D warnings     跳过（--fast）
     PASS   cargo test --workspace       exit 0
     PASS   调色板一致性           exit 0（gate=G3）
     WARN   let _ = 计数               15 处（G4 前应清零）
     WARN   unwrap() 计数              20 处（用户输入路径应为 0）
     WARN   命令表常量              3 处（G1 后应只剩 catalog）
     PASS   工作区干净              0 个未提交改动

     PASS=4 FAIL=0 WARN=4
     结论：PASS
     ```
4. **静默失败与测试弱化扫描（`mathslot-render` / `mathslot-app` / `packages/ui`）**：
   - 命令：`rg -n "let _\s*=|\.unwrap\(|#\[ignore" crates/mathslot-render/src/ crates/mathslot-render/tests/ crates/mathslot-app/src/ crates/mathslot-app/tests/ packages/ui/src/ packages/ui/tests/`（exit `1`，0 匹配）
   - 命令：`rg -n "skip\(|only\(|todo\(" packages/ui/tests/`（exit `1`，0 匹配）

---

## 3. 新发现

| ID | severity | 位置 | 现象 | 复现 / 验证 |
|---|---|---|---|---|
| **D-113** | P2 | [`crates/mathslot-render/Cargo.toml:9-12`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/Cargo.toml#L9-L12), [`crates/mathslot-render/src/lib.rs:1-20`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/lib.rs#L1-L20) | `mathslot-render` 仅有 `BackendKind::LatexRust` 枚举与无头契约，未接入 `latex-rust`（`Cargo.lock` 已锁定 `3.0.3` 含 `latex_to_svg`）实现具体 `MathRenderer` SVG 兜底后端，无法履行 `ADR-0022` §1.2 桌面端离线矢量兜底接口 | 检查 `crates/mathslot-render/Cargo.toml` 与 `rg -n "latex_to_svg\|latex-rust" crates/`（`mathslot-render` 零匹配） |
| **D-114** | P2 | [`crates/mathslot-syntax/src/printer.rs:147`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs#L147), [`crates/mathslot-app/src/snapshot.rs:83-95`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/snapshot.rs#L83-L95), [`crates/mathslot-app/src/effect.rs:16-20`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/effect.rs#L16-L20) | 新栈仅输出纯规范 `to_latex()`（空占位符变成 `{}`，如 `\frac{}{}`），未像冻结栈 `mathslot-core::visual` 那样提供 `VisualDialect::MathJax` 预览高亮 `preview_latex`（活动槽位/空槽 `\bbox`+`\color`、光标与待决命令高亮）；`EngineSnapshot` 与 `RenderRequest` 均缺少 `preview_latex` | 阅读 `printer.rs:147`、`snapshot.rs:83-95` 与 `rg -n "VisualDialect\|preview_latex" crates/mathslot-app/ crates/mathslot-doc/ crates/mathslot-syntax/`（0 匹配） |
| **D-115** | P2 | [`crates/mathslot-app/src/app.rs:438-450`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L438-L450), [`crates/mathslot-app/src/snapshot.rs:52-80`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/snapshot.rs#L52-L80), [`packages/ui/src/client/engine.ts:64-81`](file:///home/mat/Projects/mathslot-next/packages/ui/src/client/engine.ts#L64-L81) | `mathslot-app` 未在正式依赖接入 `mathslot-render`：`StatusMessage.message` 直接输出 `format!("{first_diag:?}")`（无 ≤120 字符单行限制），`DiagnosticSnapshot` 缺少 `span`/`hint`/200 字符截断摘要（`ErrorSummary`），`app::RenderRequest` 缺少 `generation`/渲染参数，`ExportResult` 在 TS 端仍为 `unknown[]`/`unknown` | 阅读 `app.rs:438-450`、`snapshot.rs:52-80`、`engine.ts:64-81` |

---

## 4. 历史结论抽查（按 `independent-audit` §3.3）

| 来源（`file:line`） | 历史声称 | 本轮代码/命令实测 | 结论 |
|---|---|---|---|
| [`docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:95-96`](file:///home/mat/Projects/mathslot-next/docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md#L95-L96) | 声称“`src/main.rs`、`crates/mathslot-core`、`mathslot-syntax`、`mathslot-doc`、`mathslot-latex` 首行声明 `#![forbid(unsafe_code)]`；且 `.gitignore` 明确声明 `docs/`，`git ls-files docs/` 输出 0” | `head -n 3` 实测 5 个 crate 首行确有 `#![forbid(unsafe_code)]`；但实测 [`/.gitignore:8`](file:///home/mat/Projects/mathslot-next/.gitignore#L8) 明确写着 `# docs/ 是审计与验收证据，必须进版本库；不要忽略。`，且 `git ls-files docs/ \| wc -l` 输出 **`60`**（exit `0`） | **部分失实（Git 隔离声明与 `.gitignore` 及 `git ls-files docs/` 实测完全相反）** |
| [`docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:115`](file:///home/mat/Projects/mathslot-next/docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md#L115) | 声称“旧 `library.json` 可迁移，旧公式可打开 \| 兼容 Schema 1 / Schema 2 自动识别与反序列化 \| PASS” | 查看 [`crates/mathslot-core/src/library.rs:878-888`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L878-L888)，仅检查 `schema_version` 为 `1 \| 2`（缺省 `1`，无实际迁移逻辑），且同文件手写 `JsonParser` 与无原子锁缺陷（`D-005`/`D-013`）当时仍未解决 | **过度声称（只做了版本白名单解析，并非完整迁移与数据安全）** |

---

## 5. 建议的下一步（不写实现方案）

1. **先立 `ADR-0027` 明确 `T3.3` 双端渲染与诊断契约（覆盖 `D-113`、`D-114`、`D-115` 及 `ADR-0022` §1.2）**：
   - 明确 `packages/ui` 异步 `RenderAdapter` 接口（主引擎 MathJax 3 SVG，`mathjax-full` 3.2.2 或 `@mathjax/src` 4.1.3 可选定版；Obsidian 宿主 `renderMath` 适配器接口；桌面兜底 `RenderAdapter` 调用 Rust `mathslot-render` `latex_to_svg` 接口）。
   - 明确新栈 `preview_latex`（`VisualDialect::MathJax` 槽位/光标/待决高亮，不引入第二套 parser/AST，满足 `INV-001`）与 `DiagnosticSnapshot` / `ErrorSummary`（≤120 摘要、200 字符源码截断+“已截断”、折叠详情与“复制诊断信息”）。
2. **按 TDD 先红后绿实现 `T3.3`**：
   - 先在 `crates/mathslot-render`、`crates/mathslot-app` 与 `packages/ui/tests/` 编写覆盖 `latex_to_svg` 后端、降级徽章（`A-RENDER-003`/`D-011`）、长公式 fit/滚动（`A-RENDER-001`/`D-003`）、generation 取消防乱序（`A-RENDER-004`/`D-019`）、错误摘要截断与折叠复制（`A-RENDER-005`/`A-UI-005`/`D-010`）及导出诊断检查（`D-004`）的失败测试，再补全实现并交由独立 `verifier` 验收。

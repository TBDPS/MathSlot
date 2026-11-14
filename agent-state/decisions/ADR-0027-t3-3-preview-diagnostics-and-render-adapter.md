# ADR-0027: Gate G3 T3.3 — `packages/ui` 预览 / 诊断折叠面板与双轨 `RenderAdapter`（MathJax 3 SVG 主渲染 + `latex_to_svg` 兜底）

- **Date**: 2026-11-14
- **Round**: 24
- **Gate / Task**: `G3` / `T3.3`
- **Defects & Acceptance**: `D-113`, `D-114`, `D-115`, `D-003`, `D-010`, `D-011`, `D-019`, `A-RENDER-001`, `A-RENDER-003`, `A-RENDER-004`, `A-RENDER-005`, `A-UI-005`, `ADR-0022` §1.2
- **Audit Reference**: `agent-state/audits/AUD-23.md`

---

## 1. 范围与允许修改路径

- **允许写入**：
  - `Cargo.lock`（仅若 workspace crate 引用变更；`latex-rust` 已在 `Cargo.lock` 锁定）
  - `crates/mathslot-render/Cargo.toml`、`crates/mathslot-render/src/**`、`crates/mathslot-render/tests/**`（接入 `latex-rust` `latex_to_svg` 后端 `D-113`）
  - `crates/mathslot-syntax/src/**`、`crates/mathslot-doc/src/**`（增量增加 MathJax 视觉预览高亮生成 `to_preview_latex_mathjax`，**严禁改变现有 `to_canonical_latex` / `to_latex` / `from_latex` 语义**）
  - `crates/mathslot-app/Cargo.toml`、`crates/mathslot-app/src/{app.rs,effect.rs,snapshot.rs}`、`crates/mathslot-app/tests/**`（修复 `D-114`、`D-115`：`EngineSnapshot.preview_latex`、`RenderRequest.generation/preview_latex`、`DiagnosticSnapshot` 接入 `mathslot_render::ErrorSummary` 与 120/200 字符截断、修复 `StatusMessage` 原始 Debug 字符串）
  - `packages/ui/package.json`、`packages/ui/package-lock.json`（引入 `mathjax-full@^3.2.2`）
  - `packages/ui/src/client/engine.ts`、`packages/ui/src/index.ts`、`packages/ui/src/theme/tokens.css`
  - `packages/ui/src/preview/**`（`renderAdapter.ts`、`PreviewPanel.svelte`）
  - `packages/ui/src/diagnostics/**`（`DiagnosticsPanel.svelte`）
  - `packages/ui/tests/preview.test.ts`、`packages/ui/tests/diagnostics.test.ts`
- **禁止修改**：`packages/ui/src/generated/**`、`src/**`、`crates/mathslot-core/**`、`crates/mathslot-command/**`、`scripts/agent/**`、`docs/**`、`agent-state/**`

---

## 2. 技术契约

### 2.1 Rust 渲染与契约修复（`D-113`, `D-114`, `D-115`）
1. **`LatexRustSvgBackend`（`D-113`, `crates/mathslot-render`）**：
   - 在 `crates/mathslot-render/Cargo.toml` 添加 `latex-rust = "3.0.3"`（使用离线 `Cargo.lock` 已有版本，不新增网络 crate）。
   - 实现 `LatexRustSvgBackend`（`MathRenderer` trait），调用 `latex_rust::latex_to_svg` + `MathFont::stix_two_math()` + `SvgOptions` 输出自包含 `<svg` 矢量图（`RenderData::Svg`），根据 `RenderRequest.theme` 设定前景色；遇到不支持语法返回 `RenderError::RenderFailed`，由 `RenderPipeline` 强制产出 `degraded: true + diagnostics`。
2. **`preview_latex`（`D-114`, `mathslot-syntax` / `mathslot-doc` / `mathslot-app`）**：
   - 保持 `to_latex()` / `to_canonical_latex()` 完全不变；新增只读辅助函数（如 `to_preview_latex_mathjax(nodes, active_slot)`）：空 `Placeholder` 渲染可见占位于 `\bbox`+`\square`、活动槽位标 `\bbox` 高亮边框、待决/错误节点显式着色占位，写入 `EngineSnapshot.preview_latex` 与 `RenderRequest.preview_latex`。
3. **诊断与错误摘要对齐（`D-115`, `crates/mathslot-app`）**：
   - `crates/mathslot-app/Cargo.toml` 正式引入 `mathslot-render`。
   - `DiagnosticSnapshot` 暴露 `summary`（单行 `<= 120` 字符）、`source_excerpt`（`<= 200` 字符，超长带 `"…（已截断）"`）、`truncated: bool`、`detail: String`、`hint: Option<String>`。
   - `RenderRequest` 补充 `generation: u64` 与 `preview_latex: String`；`StatusMessage.message` 使用规范单行摘要，不再使用 `format!("{first_diag:?}")`。

### 2.2 前端 `packages/ui` 组件与 `RenderAdapter`（`T3.3` + `ADR-0022`）
1. **`RenderAdapter`（`src/preview/renderAdapter.ts`）**：
   - 定义统一异步接口 `RenderAdapter { kind: 'mathjax' | 'latex-rust' | 'host', render(req: PreviewRenderRequest): Promise<PreviewRenderResult> }`。
   - **`createMathJaxSvgAdapter()`**：真实使用 `mathjax-full`（`TeX` + `SVG` + `liteAdaptor`）渲染 TeX→SVG，检测 `<merror>` / `data-mjx-error` 并将其转为 `degraded: true + diagnostics`（禁止把错误静默当正常）。
   - **`createLatexRustBridgeAdapter(invokeFn)`** 与 **`createHostRenderMathAdapter(hostFn)`**：分别适配 Tauri `latex_to_svg` 兜底与 Obsidian 宿主 `renderMath`。
   - **`createManagedRenderer({ primary, fallback, debounceMs, cacheCapacity })`**：实现请求缓存 key、防抖、单调 `generation` 丢序保护（旧请求晚归不得覆盖新请求 `A-RENDER-004` / `D-019`），以及主引擎失败自动切 fallback 时强制置 `degraded: true` + 附带诊断（`D-011` / `A-RENDER-003`）。
2. **`PreviewPanel.svelte`（`D-003`, `D-010`, `D-011`, `A-RENDER-001/003/004/005`）**：
   - 默认 `fit-to-width` 缩放并切换 **“实际大小 (100%)”** 与缩放调节，真实展示当前百分比；超宽公式（`> 2 屏`）左对齐置于水平滚动视口，首尾均可滚动查看（`A-RENDER-001`）。
   - `degraded === true` 时在顶部工具栏展示清晰文字+图标徽章 **“降级预览”** 与原因（`D-011`）。
   - 顶栏仅保留短错误码 + 单行摘要（`<= 120` 字符），绝不挤压缩放/复制按钮（`A-RENDER-005`）。
3. **`DiagnosticsPanel.svelte`（`D-010`, `A-RENDER-005`, `A-UI-005`, `D-030`）**：
   - 折叠式错误与诊断抽屉（`aria-expanded`、`role="region"`、`aria-live="polite"`），展示完整诊断详情、200 字符截断源码（带 `已截断` 标记）及 `hint`，提供一键 **“复制诊断信息”** 按钮（带复制结果回调/状态提示）。

---

## 3. TDD 验收标准（先红后绿）

1. **Rust TDD**：先新增失败测试验证 `LatexRustSvgBackend` SVG 输出与报错降级、`to_preview_latex_mathjax` 空槽/活动槽占位高亮、`EngineSnapshot.preview_latex` 与 `DiagnosticSnapshot` 120/200 截断契约；红后再实现，保证现有 227 个 Rust 测试零回归。
2. **前端 TDD（`packages/ui/tests/preview.test.ts`, `diagnostics.test.ts`）**：先写失败测试并运行观测 FAIL，覆盖：
   - MathJax 3 SVG 真实渲染 `\frac{1}{2}` 成 `<svg` 矢量输出，非法 LaTeX 检测错误并返回 `degraded: true`；
   - `createManagedRenderer`：主引擎失败切 fallback 强制标 `degraded: true + diagnostics`（`A-RENDER-003`），以及慢请求被新 `generation` 取消/丢弃不覆盖新结果（`A-RENDER-004` / `D-019`）；
   - `PreviewPanel.svelte`：fit-to-width 与实际大小 (100%) 切换、超宽水平滚动容器（`A-RENDER-001`）、“降级预览”徽章、长错误不挤占工具栏按钮（`A-RENDER-005`）；
   - `DiagnosticsPanel.svelte`：header 摘要 `<= 120` 字符、折叠/展开、200 字符源码截断标 `"已截断"`、点击“复制诊断信息”正确输出诊断内容（`A-UI-005`）。
3. **门禁**：
   - `cargo fmt --check` PASS
   - `cargo clippy --workspace --all-targets -- -D warnings` PASS
   - `cargo test --workspace --offline` PASS（`0 failed; 0 ignored`）
   - `cd packages/ui && npm test && npm run check && npm run build` PASS
   - 单次提交，commit message 含 `T3.3` 与 `D-113 D-114 D-115 D-003 D-010 D-011 D-019`（不加方括号）。

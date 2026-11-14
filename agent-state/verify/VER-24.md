---
id: VER-24
round: 24
task: T3.3
defects: [D-113, D-114, D-115, D-003, D-010, D-011, D-019]
verdict: PASS
verifier: mathslot-verifier
date: 2026-11-14
---

## 1. 结论

**PASS**。Round 24（`G3 T3.3`，commit `0f7b3cccf0c6cd0c0f313e02f779de47e3dd36f5`）通过独立验收。

- **范围与提交规范**：`git show --stat 0f7b3cc` 仅修改 `ADR-0027` §1 白名单内的 24 个文件；禁止目录（`packages/ui/src/generated/**`、`src/**`、`crates/mathslot-core/**`、`crates/mathslot-command/**`、`scripts/**`、`docs/**`、`agent-state/**`）diff 行数为 `0`。提交信息包含 `T3.3` 与 `D-113 D-114 D-115 D-003 D-010 D-011 D-019`（无方括号），当前工作区干净（`git status --short` 为空）。
- **核心契约与架构不变量**：
  - `D-113`：`crates/mathslot-render` 接入工作区已锁定的 `latex-rust = "3.0.3"`，实现 `LatexRustSvgBackend`（`MathFont::stix_two_math()`、`SvgOptions`、主题前景色映射、`RenderError::RenderFailed` 显式报错并在 `RenderPipeline` 强制置 `degraded: true + diagnostics`）。
  - `D-114`：`mathslot-syntax` / `mathslot-doc` / `mathslot-app` 增量新增只读 `to_preview_latex_mathjax`（空槽 `\bbox`+`\square`、活动槽高亮、待决/错误显式着色），`to_canonical_latex` / `to_latex` / `from_latex` 原有行（`printer.rs:1-278`）零改动。
  - `D-115`：`crates/mathslot-app` 正式依赖 `mathslot-render`，`DiagnosticSnapshot` 对齐 `ErrorSummary`（`<= 120` 单行 `summary`、`<= 200` `source_excerpt` + `"…（已截断）"`、`truncated`、`detail`、`hint`），`RenderRequest` 新增 `generation` 与 `preview_latex`，`StatusMessage.message` 改用单行摘要，消除 `{first_diag:?}` 原始 Debug 输出。
  - `packages/ui` 新增 `RenderAdapter`（真实 `mathjax-full` SVG 主引擎 + `<merror>`/`data-mjx-error` 降级检测 + `createManagedRenderer` 缓存/防抖/单调 `generation` 丢序保护/强制降级兜底）、`PreviewPanel.svelte`（`fit-to-width` / `实际大小 (100%)` 切换、超宽左对齐水平滚动、`降级预览` 徽章、不挤占工具栏按钮）与 `DiagnosticsPanel.svelte`（折叠抽屉 ARIA、`<= 120` 摘要、200 字符 `已截断` 源码、`hint` 与可反馈“复制诊断信息”按钮）。
- **全量门禁**：`cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace --offline`（232 passed; 0 failed; 0 ignored）、`cd packages/ui && npm test && npm run check && npm run build`（18 passed; 0 errors/warnings）、`scripts/agent/audit_palette.py`、`scripts/agent/acceptance.sh` 全部现场执行且 exit `0`。

---

## 2. Diff 与禁用模式扫描

### 2.1 `git show --stat 0f7b3cc` 与提交信息

```text
commit 0f7b3cccf0c6cd0c0f313e02f779de47e3dd36f5 (HEAD -> refactor/v1)
Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
Date:   Sat Nov 14 14:34:56 2026 +0800

    feat(render,ui): T3.3 D-113 D-114 D-115 D-003 D-010 D-011 D-019 add preview/diagnostics panels and dual RenderAdapter

 Cargo.lock                                         |   1 +
 crates/mathslot-app/Cargo.toml                     |   2 +-
 crates/mathslot-app/src/app.rs                     |  17 +-
 crates/mathslot-app/src/effect.rs                  |   2 +
 crates/mathslot-app/src/snapshot.rs                |  70 ++-
 crates/mathslot-app/tests/t3_3_contract_tests.rs   | 156 ++++++
 crates/mathslot-doc/src/document.rs                |  11 +-
 crates/mathslot-doc/src/editor.rs                  |  87 ++++
 crates/mathslot-render/Cargo.toml                  |   1 +
 crates/mathslot-render/src/latex_rust_backend.rs   | 106 ++++
 crates/mathslot-render/src/lib.rs                  |   2 +
 .../tests/latex_rust_backend_tests.rs              | 119 +++++
 crates/mathslot-syntax/src/lib.rs                  |   5 +
 crates/mathslot-syntax/src/printer.rs              | 272 ++++++++++-
 packages/ui/package-lock.json                      |  73 +++
 packages/ui/package.json                           |   1 +
 packages/ui/src/client/engine.ts                   |  21 +-
 .../ui/src/diagnostics/DiagnosticsPanel.svelte     | 495 +++++++++++++++++++
 packages/ui/src/index.ts                           |  33 ++
 packages/ui/src/preview/PreviewPanel.svelte        | 462 ++++++++++++++++++
 packages/ui/src/preview/renderAdapter.ts           | 538 +++++++++++++++++++++
 packages/ui/src/theme/tokens.css                   |  27 ++
 packages/ui/tests/diagnostics.test.ts              |  96 ++++
 packages/ui/tests/preview.test.ts                  | 225 +++++++++
 24 files changed, 2797 insertions(+), 25 deletions(-)
```

- 禁止路径 diff 行数：`git diff 0f7b3cc~1 0f7b3cc -- packages/ui/src/generated/ src/ crates/mathslot-core/ crates/mathslot-command/ scripts/ docs/ agent-state/ | wc -l` → `0`（exit `0`）。
- 工作区状态：`git status --short` → 空输出（exit `0`）。
- `Cargo.lock` 仅在 `mathslot-render` 依赖列表新增 1 行 `"latex-rust"`（使用工作区已锁定的 `3.0.3`）。

### 2.2 禁用模式与架构隔离扫描

1. **新增代码禁用模式扫描**：
   `git show 0f7b3cc | rg '^\+.*(let _\s*=|\.unwrap\(|#\[ignore|#\[allow|\.skip\(|test\.skip|it\.skip|@tauri-apps/api|wasm-bindgen)' || echo "CLEAN"` → `CLEAN`（0 匹配）。
2. **Svelte 硬编码十六进制颜色扫描**：
   `rg -n '#[0-9a-fA-F]{3,8}' packages/ui/src/**/*.svelte` → 仅命中 `{#each ...}` 模板语法（无任何硬编码颜色值）。
3. **直接宿主/WASM 导入扫描**：
   `rg -n '@tauri-apps/api|wasm-bindgen' packages/ui/src/` → `NO_DIRECT_HOST_IMPORTS`（0 匹配）。
4. **`to_canonical_latex` 不变性扫描**：
   `git diff 0f7b3cc~1 0f7b3cc -- crates/mathslot-syntax/src/printer.rs | rg '^@@'` → `@@ -279,4 +279,274 @@ impl Printer {`（第 1–278 行既有 `to_canonical_latex` 与 `to_mathslot_source` 未作任何修改）。

---

## 3. 逐项契约与验收核查（含文件行号）

| 验收 / 缺陷 ID | 契约要求 | 实测代码与测试证据 | 判定 |
|---|---|---|---|
| **D-113** | `LatexRustSvgBackend` 使用 `latex-rust` `latex_to_svg` + `MathFont::stix_two_math()` + 主题着色；失败显式报错，经 `RenderPipeline` 强制置 `degraded + diagnostics` | [`crates/mathslot-render/Cargo.toml:10`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/Cargo.toml#L10)、[`latex_rust_backend.rs:9-105`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/latex_rust_backend.rs#L9-L105)（`shared_stix_font`、`theme_foreground_color`、`SvgOptions`、`RenderError::RenderFailed`）；[`latex_rust_backend_tests.rs:33-119`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/tests/latex_rust_backend_tests.rs#L33-L119) 2 个测试通过 | **PASS** |
| **D-114** | 新增 `to_preview_latex_mathjax`（空槽 `\bbox`+`\square`、活动槽/待决/错误高亮），写入 `EngineSnapshot.preview_latex` 与 `RenderRequest.preview_latex`，保持 `to_latex` / `to_canonical_latex` 不变 | [`crates/mathslot-syntax/src/printer.rs:288-551`](file:///home/mat/Projects/mathslot-next/crates/mathslot-syntax/src/printer.rs#L288-L551)、[`document.rs:50-57`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/document.rs#L50-L57)、[`editor.rs:249-334`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/editor.rs#L249-L334)、[`snapshot.rs:123`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/snapshot.rs#L123)、[`effect.rs:18-20`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/effect.rs#L18-L20)、[`t3_3_contract_tests.rs:5-114`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/t3_3_contract_tests.rs#L5-L114) | **PASS** |
| **D-115** | `DiagnosticSnapshot` 接入 `ErrorSummary`（`<= 120` 摘要、`<= 200` `source_excerpt` + `…（已截断）`、`truncated`、`detail`、`hint`）；`StatusMessage` 禁止原始 `{first_diag:?}`；TS 强类型对齐 | [`crates/mathslot-app/Cargo.toml:12`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/Cargo.toml#L12)、[`snapshot.rs:53-117`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/snapshot.rs#L53-L117)、[`app.rs:441-455`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L441-L455)、[`engine.ts:64-156`](file:///home/mat/Projects/mathslot-next/packages/ui/src/client/engine.ts#L64-L156)、[`t3_3_contract_tests.rs:117-156`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/t3_3_contract_tests.rs#L117-L156) | **PASS** |
| **A-RENDER-003 / D-011** | 主引擎 MathJax 3 SVG 真实渲染 TeX 并检测 `<merror>`/`data-mjx-error` 为降级；主引擎失败走 fallback 时强制 `degraded: true + diagnostics`；UI 显示 `降级预览` 徽章与原因 | [`renderAdapter.ts:120-225,428-463`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/renderAdapter.ts#L120-L225)（排除 `noundefined`，识别 `data-mjx-error`/`<merror`/`mjx-error`，fallback 强制 `degraded: true` 并合并 `primaryDiag`）；[`PreviewPanel.svelte:182-186`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/PreviewPanel.svelte#L182-L186)；[`preview.test.ts:22-104`](file:///home/mat/Projects/mathslot-next/packages/ui/tests/preview.test.ts#L22-L104) | **PASS** |
| **A-RENDER-004 / D-019** | `createManagedRenderer` 实现缓存 key、防抖与 `generation` 丢序取消（旧请求晚归不得覆盖新请求） | [`renderAdapter.ts:328-538`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/renderAdapter.ts#L328-L538)（`highestGeneration` 在请求前/缓存命中后/主引擎后/catch/fallback 后/flush 后 6 处校验）；[`preview.test.ts:106-158`](file:///home/mat/Projects/mathslot-next/packages/ui/tests/preview.test.ts#L106-L158) | **PASS** |
| **A-RENDER-001 / D-003** | 默认 `fit-to-width`，可切换 `实际大小 (100%)` 与缩放百分比展示，超宽公式左对齐且可水平滚动 | [`PreviewPanel.svelte:47-62,205-249,275-296,428-455`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/PreviewPanel.svelte#L47-L62)（`ms-fit-width` vs `ms-fit-actual` `justify-content: flex-start; overflow-x: auto`）；[`preview.test.ts:160-224`](file:///home/mat/Projects/mathslot-next/packages/ui/tests/preview.test.ts#L160-L224) | **PASS** |
| **A-RENDER-005 / A-UI-005 / D-010** | 顶栏摘要 `<= 120` 字符不挤占工具栏按钮；`DiagnosticsPanel` 折叠抽屉（`aria-expanded`/`role="region"`/`aria-live="polite"`）、200 字符截断标 `已截断`、`hint` 及一键 `复制诊断信息` | [`PreviewPanel.svelte:68-72,313-372`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/PreviewPanel.svelte#L68-L72)、[`DiagnosticsPanel.svelte:109-282`](file:///home/mat/Projects/mathslot-next/packages/ui/src/diagnostics/DiagnosticsPanel.svelte#L109-L282)、[`diagnostics.test.ts:16-95`](file:///home/mat/Projects/mathslot-next/packages/ui/tests/diagnostics.test.ts#L16-L95) | **PASS** |
| **明暗主题与样式令牌** | 浅色/深色主题 CSS 变量覆盖 preview 与 diagnostics，无硬编码深色块 | [`tokens.css:66-73,142-149,216-223`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L66-L73) 定义 `--ms-preview-bg/fg/border`、`--ms-badge-degraded-*`、`--ms-diag-code-*` | **PASS** |

---

## 4. 独立门禁命令实测输出

### 4.1 `cargo fmt --check`

- Exit code: `0`（无输出差异）

### 4.2 `cargo clippy --workspace --all-targets -- -D warnings`

- Exit code: `0`
```text
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.30s
```

### 4.3 `cargo test --workspace --offline`

- Exit code: `0`（共 51 个 test binary/doc-test 段合计 **`232 passed; 0 failed; 0 ignored`**；较 T3.2 基线 227 新增 `latex_rust_backend_tests` 2 个 + `t3_3_contract_tests` 3 个）
```text
     Running tests/t3_3_contract_tests.rs (target/debug/deps/t3_3_contract_tests-9e5684a564ba7a98)

running 3 tests
test d114_preview_latex_mathjax_highlights_empty_and_active_slots_without_altering_canonical_latex ... ok
test d114_d115_app_snapshot_and_render_request_expose_preview_latex_generation_and_bounded_diagnostics ... ok
test d115_diagnostic_snapshot_enforces_error_summary_120_200_limits ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
     Running tests/latex_rust_backend_tests.rs (target/debug/deps/latex_rust_backend_tests-5189bcb329527f8c)

running 2 tests
test d113_latex_rust_svg_backend_renders_frac_and_respects_theme ... ok
test d113_latex_rust_svg_backend_fails_explicitly_and_pipeline_marks_degraded ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### 4.4 `cd packages/ui && npm test && npm run check && npm run build`

- Exit code: `0`
```text
 ✓ tests/navTree.test.ts (2 tests) 275ms
 ✓ tests/editor.test.ts (6 tests) 716ms
 ✓ tests/palette.test.ts (5 tests) 1032ms
 ✓ tests/preview.test.ts (4 tests) 269ms
 ✓ tests/diagnostics.test.ts (1 test) 92ms

 Test Files  5 passed (5)
      Tests  18 passed (18)

> @mathslot/ui@0.1.0 check
> svelte-check --tsconfig ./tsconfig.json
svelte-check found 0 errors and 0 warnings

> @mathslot/ui@0.1.0 build
> vite build
✓ 318 modules transformed.
dist/index.css     24.79 kB │ gzip:   4.07 kB
dist/index.js   2,541.42 kB │ gzip: 768.48 kB
✓ built in 1.53s
```

### 4.5 `scripts/agent/audit_palette.py` 与 `scripts/agent/acceptance.sh`

- `scripts/agent/audit_palette.py` Exit code: `0`（`PASS：所有可映射卡片与命令目录一致`）
- `scripts/agent/acceptance.sh` Exit code: `0`
```text
结果 检查项                    说明
------ ---------------------------- ----
PASS   cargo fmt --check            exit 0
PASS   cargo clippy -D warnings     exit 0
PASS   cargo test --workspace       exit 0
PASS   调色板一致性           exit 0（gate=G3）
WARN   let _ = 计数               15 处（G4 前应清零）
WARN   unwrap() 计数              20 处（用户输入路径应为 0）
WARN   命令表常量              3 处（G1 后应只剩 catalog）
PASS   工作区干净              0 个未提交改动

PASS=5 FAIL=0 WARN=3
结论：PASS
```

---

## 5. 未验证项与非阻塞观察

1. **真实桌面/浏览器渲染视觉走查（按路线图延后至 G3 `T3.5`/`T3.6` 壳集成与 Playwright/WebKitGTK E2E）**：
   - 本轮 `packages/ui` 测试在 `jsdom` 中运行，已验证真实 `mathjax-full` SVG 输出、DOM 结构、ARIA 属性与类切换；但实际浏览器排版像素尺寸（如 `> 2` 屏超宽公式 `scrollWidth > clientWidth`、高放大倍率下水平滚动范围、浅/深色宿主 CSS 覆盖及视觉截图）需在 `T3.5`（Tauri）/ `T3.6`（Obsidian）接入真实渲染视口后实测。
2. **非阻塞代码细节记录（供后续轮次参考，不阻塞 `T3.3` 验收）**：
   - [`PreviewPanel.svelte:124`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/PreviewPanel.svelte#L124)：`requestGen = Math.max(explicitGen, internalGenCounter)` 若调用方传入固定大于 `internalGenCounter` 的 `generation` 并在多个并发渲染间保持不变，`requestGen` 不会继续自增；改为 `internalGenCounter = Math.max(internalGenCounter + 1, explicitGen)` 可在所有情况下严格单调递增。
   - [`tokens.css:155`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L155)：`:root:not([data-theme='light'])` 仅检查 `:root` 的 `data-theme`，当操作系统为暗色而仅在子组件 `<section data-theme="light">` 显式传 `theme="light"` 时，子组件会沿用 `:root` 的暗色变量；在 `T3.4`（设置/主题）集成时可同步补充 `[data-theme='light']` 变量块。

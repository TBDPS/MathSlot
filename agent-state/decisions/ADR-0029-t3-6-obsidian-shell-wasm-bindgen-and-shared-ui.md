# ADR-0029: Gate G3 T3.6 — `apps/obsidian` 壳 + 共享 `packages/ui` + `crates/mathslot-wasm`（`wasm-bindgen` 单文件内联与 `ImportReport` 阻断）

- **Date**: 2026-11-14
- **Round**: 26
- **Gate / Task**: `G3` / `T3.6`（`depends_on: T3.1–T3.4`，宿主机无 root 阻塞，按规范 DAG 先行交付并反推 `apps/obsidian` + WASM）
- **Defects & Acceptance**: `D-120`, `D-121`, `D-122`, `D-123`, `D-124`, `D-125`, `D-126`, `D-017`, `D-021`, `INV-001`, `INV-006`, `INV-011`, `A-OBS-001`, `A-OBS-002`, `A-OBS-003`, `A-OBS-004`, `A-OBS-005`, `OPEN-002`, `OPEN-003`
- **Audit Reference**: `agent-state/audits/AUD-25.md`

---

## 1. 范围与允许修改路径

- **允许写入**：
  - `Cargo.lock`（仅 `mathslot-wasm` 切换到 workspace 现有 `wasm-bindgen = "0.2.130"` 与 `mathslot-app`/`mathslot-command`/`serde` 依赖所需变更，不新增网络 crate）
  - `crates/mathslot-render/Cargo.toml`、`crates/mathslot-render/src/lib.rs`（`latex-rust-backend` feature 隔离，默认启用以保桌面与现有测试全绿，WASM 路径通过 `default-features = false` 剔除重型字体引擎）
  - `crates/mathslot-app/Cargo.toml`、`crates/mathslot-app/src/**`、`crates/mathslot-app/tests/**`（接入 `mathslot-latex`、`ImportLatex` 输出 `ImportReportSnapshot` 且 `Error` 阻断 `Edit::ReplaceAll`）
  - `crates/mathslot-wasm/**`（`#![forbid(unsafe_code)]`，移除 `mathslot-core`、28 个 C ABI 与重复 `tokenize_stream`，迁移到 `#[wasm_bindgen]` `Engine` + `mathslot-app`）
  - `catalog/presets.json`、`packages/ui/src/generated/presets.ts`（修复 `D-126` 3 条失败预置并通过 `cargo run -p xtask -- generate` 重新生成，确保 `xtask check` 无 diff）
  - `packages/ui/src/**`、`packages/ui/tests/**`（`ImportModal.svelte`、`ImportReportSnapshot` 类型、Obsidian 宿主 CSS 变量兼容、`<= 480px` 移动端断点与触控尺寸）
  - `apps/obsidian/**`（新建 Obsidian 插件源码、Svelte 5 宿主壳、WASM 单文件内联打包、宿主 `renderMath` 适配器、`backupJson` 隔离恢复逻辑、Vitest + JSDOM / Node E2E 测试）
  - `obsidian-mathslot/**`、`.github/workflows/ci.yml`、`.github/workflows/release.yml`（同步构建脚本使其统一从 `apps/obsidian` + `wasm-bindgen` 构建单文件 `main.js` / `styles.css`，保 `node obsidian-mathslot/scripts/build.mjs` 绿灯与 CI 兼容）
- **禁止修改**：
  - `xtask/**`、`catalog/commands.toml`、`src/**`、`crates/mathslot-core/**`、`crates/mathslot-command/**`、`crates/mathslot-syntax/**`、`crates/mathslot-doc/**`、`crates/mathslot-store/**`、`scripts/agent/**`、`docs/**`、`agent-state/**`

---

## 2. 技术契约

### 2.1 `mathslot-render` Feature 隔离与 `mathslot-app` 导入阻断（`D-120`, `D-123`）
1. **`mathslot-render` 可选后端 feature**：
   - `crates/mathslot-render/Cargo.toml` 增加：
     ```toml
     [features]
     default = ["latex-rust-backend"]
     latex-rust-backend = ["dep:latex-rust"]
     ```
     并将 `latex-rust` 标为 `optional = true`；`crates/mathslot-render/src/lib.rs` 对 `latex_rust_backend` 模块使用 `#[cfg(feature = "latex-rust-backend")]`。
   - `crates/mathslot-app/Cargo.toml` 引用 `mathslot-render = { path = "../mathslot-render", default-features = false }`（因为 `mathslot-app` 仅使用 `ErrorSummary` 类型，`D-115` 不受影响）。
2. **`AppCommand::ImportLatex` 与 `ImportReportSnapshot`（`D-123`, `A-OBS-005`）**：
   - `crates/mathslot-app/Cargo.toml` 将 `mathslot-latex` 提升为正式依赖（`wasm32-unknown-unknown` 已验证通过）。
   - `AppCommand::ImportLatex(String)` 调用 `mathslot_latex::convert_latex_with_report(&latex)`：
     - 构造 `ImportReportSnapshot`（`lossless`、`empty_slots`、`raw_nodes`、`roundtrip_latex`、`normalized_match`、`blocked`、`diagnostics: Vec<DiagnosticSnapshot>`）写入 `EngineSnapshot.last_import`（并在用户 `ImportAcknowledge` 或成功清除/重置时可清理）。
     - **当 `diagnostics` 含任意 `DiagnosticLevel::Error` 时，`blocked = true`，严格禁止调用 `Edit::ReplaceAll` 覆盖当前文档**；发送 `StatusSeverity::Error` 通知。
     - 仅当无 `Error` 诊断（`blocked = false`）时才应用新文档（如为有损但无 Error 仍通过 `last_import` 暴露警告与 `raw_nodes` 给 UI）。

### 2.2 修复 3 条预置流式源码（`D-126`, `A-OBS-004`）
- 修正 `catalog/presets.json` 中 `preset-003`（`▸kg`）、`preset-044`（`▸gg` → `▸gc` `\gamma`）、`preset-084`（`▸kd` → 规范 `catalog/commands.toml` 已有命令或标准符号组合），执行 `cargo run -p xtask -- generate` 同步 `packages/ui/src/generated/presets.ts`，通过自动化测试验证 88/88 条预置在 `mathslot-app::LoadStreamSource` 下全部无错误展开。

### 2.3 `crates/mathslot-wasm` 迁移 `#[wasm_bindgen]` 与单源 `mathslot-app`（`D-120`, `D-021`, `INV-001`, `INV-011`, `OPEN-003`）
1. 启用 `#![forbid(unsafe_code)]`，删除 `mathslot-core` 依赖、28 个手写 `extern "C"` 导出与重复 `tokenize_stream`、硬编码 5 预置。
2. 暴露 `#[wasm_bindgen(js_name = Engine)] pub struct WasmEngine`：
   - `#[wasm_bindgen(constructor)] pub fn new() -> Self`
   - `pub fn dispatch(&mut self, event_json: &str) -> Result<String, JsValue>`（反序列化 `UserEvent` 并返回 JSON 序列化的 `EngineOutcome { snapshot, effects }`）
   - `pub fn snapshot(&self) -> Result<String, JsValue>`
   - `#[wasm_bindgen(js_name = catalogJson)] pub fn catalog_json(&self) -> Result<String, JsValue>`（来自 `mathslot-command::Catalog` 单一事实源）
   - `#[wasm_bindgen(js_name = presetsJson)] pub fn presets_json(&self) -> Result<String, JsValue>`（88 条预置来自唯一 JSON）
   - `#[wasm_bindgen(js_name = wrapLatex)] pub fn wrap_latex(&self, latex: &str, style: &str) -> String`
   - `#[wasm_bindgen(js_name = engineVersion)] pub fn engine_version() -> String`（返回 `<cargo_pkg_version>+schema<schema>`，JS 侧严格校验版本握手）
3. 体积目标：`wasm32-unknown-unknown --release` + `wasm-bindgen --target web`（如安装 `wasm-opt` 可额外压缩；在无 `wasm-opt` 环境内联产物与原始 wasm 需有体积统计并控制在预算之内；若不含 `latex-rust`，`mathslot-app` 核心 wasm 远小于 400 KB 预算目标）。

### 2.4 `packages/ui` 宿主变量、移动端断点与 `ImportModal.svelte`（`D-123`, `D-124`, `D-125`, `A-OBS-001`, `A-OBS-003`, `A-OBS-005`）
1. **Obsidian 宿主主题适配（`D-124`, `A-OBS-001`）**：
   - 在 `packages/ui/src/theme/tokens.css` 为 `.mathslot-obsidian-host`（或 `[data-host='obsidian']`）映射到 Obsidian 标准变量（`--background-primary`、`--background-secondary`、`--text-normal`、`--text-muted`、`--interactive-accent`、`--text-on-accent`、`--background-modifier-border`、`--text-error`、`--text-warning`），浅色/深色模式下均零硬编码深色块。
2. **移动端响应式（`D-125`, `A-OBS-003`）**：
   - 在共享面板与模态样式加入 `@media (max-width: 480px)` 及触控目标尺寸（交互按钮 `min-height: 36px`，双栏改为单栏纵向堆叠，分段按钮换行自适应，不横向裁切溢出）。
3. **导入弹窗与诊断阻断 UI（`D-123`, `A-OBS-005`）**：
   - 新增 `packages/ui/src/import/ImportModal.svelte`（导出至 `packages/ui/src/index.ts`，同步更新 `packages/ui/src/client/engine.ts` 类型 `ImportReportSnapshot` / `last_import`），展示 LaTeX 输入框、导入报告（`lossless`、`empty_slots`、`raw_nodes`、`roundtrip_latex`）与 Error 阻断提示横幅。

### 2.5 `apps/obsidian` 宿主集成与单文件构建同步（`D-121`, `D-122`, `OPEN-002`, `OPEN-003`）
1. **`apps/obsidian`（TypeScript + Svelte 5 + Vite/esbuild 单文件打包）**：
   - 实现 `WasmEngineClient` 对接 `#[wasm_bindgen]` `Engine`，启动时校对 `engineVersion()`，不匹配直接显式报错并阻断静默运行（`INV-011`）。
   - 实现 `createObsidianHostRenderAdapter` 封装 `MarkdownRenderer.renderMath` / `finishRenderMath`（via `createHostRenderMathAdapter` + `createManagedRenderer`，`OPEN-002`）。
   - 实现 `storage.ts` 安全持久化（`D-122`, `A-OBS-002`）：`libraryJson` 解析或校验失败时**禁止删除/覆盖**，自动转存至 `data.backupJson` 隔离列表（含时间戳与错误详情），向引擎派发 `SetRecoveryState` 唤醒 `SettingsPanel` 恢复向导（“从最近备份恢复”或二次确认“重置为空配置”）。
   - `AppShell.svelte` 集成共享 `MathSlotEditor`、`PalettePanel`、`NavTreePanel`、`PreviewPanel`、`DiagnosticsPanel`、`SettingsPanel`、`ImportModal` 与“插入到笔记 / 复制 LaTeX”交互，并支持移动端（`<= 480px` / `isMobile`）布局切换。
2. **构建与 CI 同步**：
   - 更新 `obsidian-mathslot/scripts/build.mjs`、`.github/workflows/ci.yml`（安装/缓存 `wasm-bindgen-cli@0.2.130`）与 `.github/workflows/release.yml`，使 `node obsidian-mathslot/scripts/build.mjs` 执行：`cargo build -p mathslot-wasm --target wasm32-unknown-unknown --release` → `wasm-bindgen --target web` → 构建 `apps/obsidian` 单文件内联 `main.js` + `styles.css` + `manifest.json`（同步至 `apps/obsidian/dist/` 与 `obsidian-mathslot/`）→ 运行 Node/WASM 冒烟测试。

---

## 3. TDD 验收标准（先红后绿）

1. **Rust TDD**：
   - `crates/mathslot-app/tests/t3_6_import_and_presets_tests.rs`：先红后绿验证 `ImportLatex` 在存在 `Error` 时阻断 `Edit::ReplaceAll`、保留原文档并暴露 `ImportReportSnapshot`；无错或仅有 Warning 时放行并携带 `raw_nodes`/`lossless`；全部 **88/88** 条 `catalog/presets.json` 预置 `LoadStreamSource` 0 错误通过（`D-126`）。
   - `crates/mathslot-wasm/tests/t3_6_wasm_bindgen_tests.rs`（宿主机单元测试 `WasmEngine` 逻辑 + `wasm32-unknown-unknown` 编译验证）：`engineVersion()` 握手、`dispatch` / `snapshot` / `catalogJson` / `presetsJson` 单一事实源、零 `mathslot-core` 与零 `unsafe`。
2. **前端与 Obsidian 壳 TDD**：
   - `packages/ui/tests/importModal.test.ts`：`ImportModal.svelte` 展示 `ImportReport` 并在 `blocked === true` 时突出显示 Error 阻断状态。
   - `apps/obsidian/tests/obsidian.test.ts`（真实加载内联构建后的 WASM + JSDOM/Node 测试）：
     - `A-OBS-001`：浅色主题挂载 `[data-host='obsidian']` 使用宿主 CSS 变量、无硬编码深色块；
     - `A-OBS-002`：损坏 `libraryJson` 隔离写入 `backupJson`、触发 `SetRecoveryState`、保留备份可恢复；
     - `A-OBS-003`：窄视口 / `isMobile` 视图类切换下编辑器、调色板/88 预置与复制/插入控件全部挂载可点击；
     - `A-OBS-004`：88 条预置在 WASM + UI 中全部可搜索并可载入展开；
     - `A-OBS-005`：LaTeX 导入非法输入在 UI/WASM 返回 `blocked: true` 与诊断且原公式未被清空；
     - `OPEN-002`：Obsidian 宿主 `renderMath` 异常时 `PreviewPanel` 显示降级徽章；
     - `INV-011`：`engineVersion()` 版本不匹配时拒绝运行并显式提示。
3. **门禁**：
   - `cargo fmt --check` PASS
   - `cargo clippy --workspace --all-targets -- -D warnings` PASS
   - `cargo test --workspace --offline` PASS（`0 failed; 0 ignored`）
   - `cd packages/ui && npm test && npm run check && npm run build` PASS
   - `node obsidian-mathslot/scripts/build.mjs` + `apps/obsidian` 测试 PASS
   - 单次提交，commit message 含 `T3.6` 与 `D-120 D-121 D-122 D-123 D-124 D-125 D-126 D-017 D-021`（不加方括号）。

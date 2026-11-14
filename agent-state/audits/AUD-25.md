---
id: AUD-25
round: 26
gate: G3
scope: [T3.6, D-017, D-021, A-OBS-001, A-OBS-002, A-OBS-003, A-OBS-004, A-OBS-005, OPEN-002, OPEN-003]
verdict: BLOCK
auditor: mathslot-auditor
date: 2026-11-14
---

# 独立审计报告 AUD-25：Gate G3 / `T3.6`（`apps/obsidian` + `packages/ui` + `crates/mathslot-wasm`）前置只读审计

## 1. 判定摘要

- **审计裁定**：**`BLOCK`**（`apps/obsidian` 尚未创建；`crates/mathslot-wasm` 仍依赖已冻结的旧栈 `mathslot-core` 与手写 28 个 C-ABI 导出而非 `wasm-bindgen` + `mathslot-app`；`obsidian-mathslot/` 存在 75 处 CSS 硬编码色值、损坏 `libraryJson` 静默删除、缺失移动端适配、仅 5 条示例预置、无 LaTeX 导入诊断/阻断；同时在 `mathslot-app` 侧发现 `ImportLatex` 未接入 `ImportReport`/Error 阻断，且 88 条预置中有 3 条在 `LoadStreamSource` 下解析报错）。
- **逐项结论（仅使用 `OPEN` / `FIXED` / `NOT-REPRODUCIBLE`）**：
  1. **`T3.6`（`apps/obsidian` 壳 + `packages/ui` 共享集成 + `crates/mathslot-wasm` 升级）**：**`OPEN`** — `apps/` 目录不存在，且 `crates/mathslot-wasm` 仍绑定旧 `mathslot-core`（见 §2.2、§3 `D-120`、`D-121`）。
  2. **`D-021` / `INV-011` / `OPEN-003`（WASM `wasm-bindgen` 与版本握手）**：**`OPEN`** — [`crates/mathslot-wasm/Cargo.toml:1-13`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/Cargo.toml#L1-L13) 与 [`crates/mathslot-wasm/src/lib.rs:54-560`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs#L54-L560) 仍使用 `wasm_alloc`/`wasm_dealloc` + 28 个 `extern "C"` 导出，无 `#[wasm_bindgen]` `Engine` 与版本握手；同时宿主机缺少 `wasm-bindgen-cli` / `wasm-opt` 可执行文件（`Cargo.lock` 已缓存 `wasm-bindgen = "0.2.130"`，见 §2.2、`D-120`）。
  3. **`D-017` / `A-OBS-001`（浅色主题与 Obsidian CSS 变量映射）**：**`OPEN`** — [`obsidian-mathslot/styles.css:1-470`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/styles.css#L1-L470) 含 75 处硬编码 `#xxxxxx` 深色值，[`obsidian-mathslot/src/plugin.js:448-1536`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/src/plugin.js#L448-L1536) 含 39 处内联十六进制色值；[`packages/ui/src/theme/tokens.css:1-262`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L1-L262) 已支持 `[data-theme='light']` / `[data-theme='dark']` / `@media (prefers-color-scheme: dark)`，但尚未映射 Obsidian 宿主 CSS 变量（`--background-primary`、`--text-normal`、`--interactive-accent` 等，见 §2.3、`D-124`）。
  4. **`A-OBS-002`（损坏 `libraryJson` 隔离备份与恢复向导）**：**`OPEN`** — [`obsidian-mathslot/src/plugin.js:1660-1669`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/src/plugin.js#L1660-L1669) 在解析失败时直接执行 `delete this.data.libraryJson; await this.saveData(this.data);`，静默销毁用户配置且无备份隔离或恢复 UI（见 §2.3、`D-122`）。
  5. **`A-OBS-003`（移动端响应式与触控可用性）**：**`OPEN`** — `packages/ui/src/` 与 `obsidian-mathslot/styles.css` 均无窄屏断点（`<= 480px`）与移动端触控目标（`isMobile`）适配（见 §2.3、`D-125`）。
  6. **`A-OBS-004`（88 条内置预置可搜索与载入）**：**`OPEN`** — 旧插件仅循环 [`crates/mathslot-wasm/src/lib.rs:14-20`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs#L14-L20) 的 5 条硬编码示例；`packages/ui` 的 [`PalettePanel.svelte:146, 267-330`](file:///home/mat/Projects/mathslot-next/packages/ui/src/palette/PalettePanel.svelte#L146) 已可搜索/过滤 88 条预置，但 [`catalog/presets.json:33, 537, 1040`](file:///home/mat/Projects/mathslot-next/catalog/presets.json#L33) 中有 3 条预置（`▸kg`、`▸gg`、`▸kd`）在 [`crates/mathslot-app/src/app.rs:766-799`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L766-L799) `LoadStreamSource` 下无法展开并报 Error（见 §2.4、`D-126`）。
  7. **`A-OBS-005`（LaTeX 导入弹窗、`ImportReport` 诊断与 `Error` 阻断）**：**`OPEN`** — `obsidian-mathslot/` 与 `packages/ui` 均无 LaTeX 导入 UI；且 [`crates/mathslot-app/src/app.rs:386-395`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L386-L395) 调用 [`crates/mathslot-doc/src/editor.rs:584-605`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/editor.rs#L584-L605) 直接 `Edit::ReplaceAll`，未接入 `mathslot_latex::convert_latex_with_report` 的 `ImportReport` 也不在 `Error` 诊断时阻断替换（见 §2.4、`D-123`）。
  8. **`OPEN-002`（Obsidian 宿主 `renderMath` 适配器与降级回退）**：
     - `packages/ui` 契约层（`createHostRenderMathAdapter` + `createManagedRenderer`）：[`packages/ui/src/preview/renderAdapter.ts:266-302, 348-464`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/renderAdapter.ts#L266-L302) 已实现（**`FIXED`**）；
     - Obsidian 宿主接入：[`obsidian-mathslot/src/plugin.js:1248-1293`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/src/plugin.js#L1248-L1293) 直接调用原生 `renderMath`/`finishRenderMath`，未走 `RenderAdapter` 与降级摘要（**`OPEN`**，归入 `D-121`）。
  9. **新登记缺陷（§3）**：`D-120`（P1）、`D-121`（P1）、`D-122`（P1）、`D-123`（P1）、`D-124`（P2）、`D-125`（P2）、`D-126`（P2）。

---

## 2. 逐项证据与基线验证

### 2.1 当前工作区基线

- **Git HEAD 与最近提交**：
  ```bash
  git rev-parse --short HEAD; git log -n 3 --oneline
  ```
  exit `0`：
  ```text
  c86338c
  c86338c (HEAD -> refactor/v1) chore(agent-state): round 25 G3 T3.4 PASS (VER-25) and enter T3.6
  558e994 feat(store,app,ui): T3.4 D-116 D-117 D-118 D-119 D-015 D-016 settings panel, themes, shortcuts, and recovery wizard
  91c5380 chore(agent-state): round 25 AUD-24 and ADR-0028 authorize G3 T3.4
  ```
- **快速门禁**：`scripts/agent/acceptance.sh --fast` → exit `0`
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
- **前端 `packages/ui` 测试、类型检查与构建**：`cd packages/ui && npm test && npm run check && npm run build` → exit `0`
  ```text
  Test Files  6 passed (6)
       Tests  27 passed (27)
  svelte-check found 0 errors and 0 warnings
  ✓ 321 modules transformed.
  dist/index.css     35.64 kB │ gzip:   5.35 kB
  dist/index.js   2,572.20 kB │ gzip: 776.65 kB
  ✓ built in 1.27s
  ```

### 2.2 `crates/mathslot-wasm`、`wasm32` 编译兼容性与工具链实测

1. **`mathslot-wasm` 仍绑定冻结旧栈与手写 C ABI**：
   - [`crates/mathslot-wasm/Cargo.toml:description,dependencies`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/Cargo.toml#L7-L13)：唯一依赖为 `mathslot-core = { path = "../mathslot-core" }`（已在 [`ADR-0012`](file:///home/mat/Projects/mathslot-next/agent-state/decisions/ADR-0012-select-unified-parser-ast-stack-t1.4.md#L32-L43) 冻结），未引入 `mathslot-app`、`mathslot-latex`、`mathslot-command` 或 `wasm-bindgen`。
   - [`crates/mathslot-wasm/src/lib.rs:1-20`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs#L1-L20)：引入旧栈 `StreamEditor`、`to_latex`、`UserLibrary`、`build_preview_latex`、`build_nav_latex`，并硬编码 5 条 `PRESETS`。
   - [`crates/mathslot-wasm/src/lib.rs:54-560, 922-1037`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs#L54-L560)：暴露 28 个 `#[unsafe(no_mangle)] pub extern "C" fn`（含 `wasm_alloc`、`wasm_dealloc`、`out_ptr`、`out_len` 等），无 `#[wasm_bindgen]` `Engine`（`new` / `dispatch` / `snapshot` / `engine_version`），无版本握手；并在 [`lib.rs:922-1005`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs#L922-L1005) 维护第二份流式词法扫描 `tokenize_stream`。
   - 现有产物大小：`ls -lh target/wasm32-unknown-unknown/release/mathslot_wasm.wasm`（exit `0`）→ `641K`（已超出规范 §11.1 的 `400 KB` gzip 前目标，且尚未计入 `mathslot-app` / `latex-rust`）。

2. **目标新栈各 crate `wasm32-unknown-unknown` 编译兼容性实测**：
   - 命令：
     ```bash
     for pkg in mathslot-command mathslot-syntax mathslot-doc mathslot-latex mathslot-app mathslot-store mathslot-render mathslot-wasm; do
       echo "=== $pkg ===";
       cargo check -p "$pkg" --target wasm32-unknown-unknown --offline 2>&1 | tail -n 15;
     done
     ```
   - 实测结果（`task-31` + `mathslot-store` 单独复核）：
     - `mathslot-command`：exit `0`
     - `mathslot-syntax`：exit `0`
     - `mathslot-doc`：exit `0`
     - `mathslot-latex`：exit `0`
     - `mathslot-render`：exit `0`（注：仍传递检查 `latex-rust v3.0.3` / `skrifa` / `read-fonts` / `font-types`）
     - `mathslot-app`：exit `0`
     - `mathslot-wasm`：exit `0`
     - `mathslot-store`：**FAIL（exit `101`）**：
       ```text
       error[E0405]: cannot find trait `AsOpenFile` in module `sys`
         --> .../fd-lock-4.0.4/src/write_guard.rs:35:14
       error: could not compile `fd-lock` (lib) due to 22 previous errors
       EXIT=101
       ```
   - **运行时 Hazards 扫描**：
     - 命令：`rg -n "Instant::|SystemTime::|std::fs|directories|fd_lock|tempfile" crates/mathslot-app/ crates/mathslot-render/ crates/mathslot-store/ crates/mathslot-latex/ crates/mathslot-doc/ crates/mathslot-syntax/ crates/mathslot-command/`（exit `0`）
     - 结论：`mathslot-command`（仅 `lib.rs:60` 的 `from_file` 辅助，编译期/测试外不触发）、`mathslot-syntax`、`mathslot-doc`、`mathslot-latex`、`mathslot-render`、`mathslot-app` 的运行时路径**均不调用** `Instant::now()`、`SystemTime::now()`、`fd_lock` 或 `std::fs`（仅 `mathslot-store` 与测试文件使用）。
   - **体积与依赖风险**：[`crates/mathslot-app/src/snapshot.rs:2`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/snapshot.rs#L2) 仅引用 `mathslot_render::ErrorSummary`，但 [`crates/mathslot-render/Cargo.toml:10`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/Cargo.toml#L10) 无条件依赖 `latex-rust = "3.0.3"`，会在 WASM 构建时拉入字体解析栈（`skrifa` / `read-fonts` / `font-types`），需通过 Cargo feature 隔离以保障 §11.1 `<= 400 KB` 体积预算。

3. **宿主机 WASM 工具链现状实测**：
   - 命令：`which wasm-bindgen wasm-opt wasm-pack node npm cargo rustup; rustup target list --installed`（exit `2`）
     ```text
     which: no wasm-bindgen in (...)
     which: no wasm-opt in (...)
     which: no wasm-pack in (...)
     /usr/bin/node
     /usr/bin/npm
     /home/mat/.cargo/bin/cargo
     /home/mat/.cargo/bin/rustup
     wasm32-unknown-unknown
     x86_64-unknown-linux-gnu
     ```
   - 离线 crate 缓存核验：`rg -n "wasm-bindgen" Cargo.lock` 与 `ls -la ~/.cargo/registry/cache/*/*wasm-bindgen*`（exit `0`）：
     `Cargo.lock:2898` 已锁定 `wasm-bindgen = "0.2.130"`（以及 `wasm-bindgen-macro`/`shared`/`futures`），且 `.crate` 与源码已缓存在 `~/.cargo/registry/`。
   - **架构阻断事实**：使用 `#[wasm_bindgen]` 编译出的 `cdylib` `.wasm` 包含 `__wbindgen_describe_*` 自定义段与 `__wbindgen_placeholder__` 导入，必须通过同版本 `wasm-bindgen-cli`（`0.2.130`）生成 JS glue 并剥离占位导入，才能在 Obsidian / Node 中直接实例化。当前宿主机和 `.github/workflows/ci.yml` / `release.yml` 均尚未安装 `wasm-bindgen-cli`（见 §5 `ADR-0029` 建议）。

### 2.3 `apps/obsidian` vs `obsidian-mathslot/` 与 `A-OBS-001..003` / `OPEN-002`

1. **`apps/obsidian` 尚未创建，CI 与发布流水线仍绑定 `obsidian-mathslot/`**：
   - `ls -la apps/`（exit `2`）：`ls: 无法访问 'apps/': 没有那个文件或目录`。
   - [`ci.yml:54-58`](file:///home/mat/Projects/mathslot-next/.github/workflows/ci.yml#L54-L58) 与 [`release.yml:138-146`](file:///home/mat/Projects/mathslot-next/.github/workflows/release.yml#L138-L146) 当前均执行 `cargo build -p mathslot-wasm --target wasm32-unknown-unknown --release` + `node obsidian-mathslot/scripts/build.mjs`，并打包 `obsidian-mathslot/{manifest.json,main.js,styles.css}`。
   - [`obsidian-mathslot/src/plugin.js:1-1681`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/src/plugin.js#L1-L1681) 为手写原生 DOM 插件（含 `<input type="text">` 单行输入框、硬编码快捷键、`renderMath` 直接调用），完全未使用 [`packages/ui`](file:///home/mat/Projects/mathslot-next/packages/ui/src/index.ts#L1-L144) 的 Svelte 5 + CodeMirror 6 组件栈。

2. **`A-OBS-001`（浅色主题与宿主 CSS 变量）**：
   - `rg -c '#[0-9a-fA-F]{6}' obsidian-mathslot/styles.css`（exit `0`）→ **`75` 处**硬编码深色值（如 [`styles.css:7-9`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/styles.css#L7-L9) `background: #0f172a; color: #f1f5f9;`）；[`obsidian-mathslot/src/plugin.js`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/src/plugin.js#L448) 另有 **39 处**内联十六进制色值。
   - `rg -n "--background-primary|--text-normal|--interactive-accent" packages/ui/src/ obsidian-mathslot/`（exit `1`，零匹配）：[`packages/ui/src/theme/tokens.css:1-262`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L1-L262) 已支持 `[data-theme='light']`/`[data-theme='dark']` 与 `prefers-color-scheme`，但尚未在 Obsidian 宿主容器上建立 Obsidian CSS 变量（`--background-primary`、`--background-secondary`、`--text-normal`、`--text-muted`、`--interactive-accent`、`--background-modifier-border`）到 `--ms-*` 令牌的映射与 `.theme-light` / `.theme-dark` 联动。

3. **`A-OBS-002`（损坏 `libraryJson` 备份与恢复）**：
   - [`obsidian-mathslot/src/plugin.js:1660-1669`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/src/plugin.js#L1660-L1669)：
     ```js
     if (this.data.libraryJson) {
       try {
         bridge.librarySetRaw(this.data.libraryJson);
       } catch (err) {
         console.error("MathSlot: libraryJson 解析失败，回退默认库", err);
         new Notice("MathSlot 自定义库数据损坏，已回退默认格式库。");
         delete this.data.libraryJson;
         await this.saveData(this.data);
       }
     }
     ```
     不仅捕获异常后直接 `delete this.data.libraryJson` 并覆写 `saveData`，且在旧 `mathslot-wasm` 中 `library_set_json`（[`crates/mathslot-wasm/src/lib.rs:122-136`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs#L122-L136)）解析失败时自身吞错返回正常状态 JSON，无法向外传播错误或触发恢复向导（[`packages/ui/src/settings/SettingsPanel.svelte:282-363`](file:///home/mat/Projects/mathslot-next/packages/ui/src/settings/SettingsPanel.svelte#L282-L363) 已有完整的 `recovery` 恢复向导 UI，但 Obsidian 端未接入）。

4. **`A-OBS-003`（移动端可用性）**：
   - `rg -n "@media|480px" packages/ui/src/ obsidian-mathslot/`（exit `0`）：全仓前端仅有 [`packages/ui/src/theme/tokens.css:179`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L179) 一处 `@media (prefers-color-scheme: dark)`，**零处**视口宽度媒体查询（`max-width: 480px` / `640px`）或触控尺寸规则。
   - [`obsidian-mathslot/styles.css:77, 104-118, 320-326`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/styles.css#L104-L118)：按钮高度 `26px`、菜单盒写死 `height: 114px`、底部网格固定 `grid-template-columns: 1fr 1fr`。
   - [`packages/ui/src/settings/SettingsPanel.svelte:848-856`](file:///home/mat/Projects/mathslot-next/packages/ui/src/settings/SettingsPanel.svelte#L848-L856) 使用固定 3 列/2 列分段按钮（`repeat(3, minmax(0, 1fr))` / `repeat(2, minmax(0, 1fr))`），[`PreviewPanel.svelte:342-348`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/PreviewPanel.svelte#L342-L348) 与 [`DiagnosticsPanel.svelte:299-305`](file:///home/mat/Projects/mathslot-next/packages/ui/src/diagnostics/DiagnosticsPanel.svelte#L299-L305) 的工具栏缺少窄屏折行适配。

5. **`OPEN-002`（`createHostRenderMathAdapter`）**：
   - [`packages/ui/src/preview/renderAdapter.ts:266-302, 348-464`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/renderAdapter.ts#L266-L302) 已完整实现 `createHostRenderMathAdapter` 与 `createManagedRenderer({ primary, fallback })`；
   - [`obsidian-mathslot/src/plugin.js:1248-1293`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/src/plugin.js#L1248-L1293) 仍直接调用 `renderMath` / `finishRenderMath` 并吞入原始异常文本，未使用上述适配器。

### 2.4 `A-OBS-004`（88 条预置）与 `A-OBS-005`（LaTeX 导入诊断与 Error 阻断）深度核验

1. **88 条预置在 `mathslot-app` 中的实测缺陷（`A-OBS-004`）**：
   - 旧插件 [`obsidian-mathslot/src/plugin.js:399-409`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/src/plugin.js#L399-L409) 仅循环 5 条硬编码示例。
   - 在新栈中，[`packages/ui/src/palette/PalettePanel.svelte:58-62, 146, 267-330`](file:///home/mat/Projects/mathslot-next/packages/ui/src/palette/PalettePanel.svelte#L58-L62) 通过 `{ LoadStreamSource: preset.source }` 载入 [`packages/ui/src/generated/presets.ts`](file:///home/mat/Projects/mathslot-next/packages/ui/src/generated/presets.ts#L27-L60)（生成自 [`catalog/presets.json`](file:///home/mat/Projects/mathslot-next/catalog/presets.json) 的全部 88 条预置）。
   - 然而，针对 `catalog/presets.json` 全量 88 条预置的贪心词法模拟（对照 [`crates/mathslot-app/src/app.rs:766-799`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L766-L799) `expand_stream_command` 与 [`catalog/catalog.json`](file:///home/mat/Projects/mathslot-next/catalog/catalog.json)）显示 **3 条预置在 `mathslot-app` 中会触发 `StatusSeverity::Error`**：
     ```text
     total: 88 bad_count: 3
     ('preset-fundamental-theorem-calculus', '▸k', "▸ia;b;f'(x) dx = ▸kgf(x);a;b; = f(b) - f(a)")
     ('preset-damped-harmonic-oscillator', '▸gg', 'm ▸ahx; + ▸gg ▸aex; + k x = 0')
     ('preset-hodge-star-inner-product', '▸k', '▸ga ▸qg *▸gb = ▸kd▸ga;▸gb; ▸go')
     ```
     - [`catalog/presets.json:33`](file:///home/mat/Projects/mathslot-next/catalog/presets.json#L33)（`preset-003`）使用 `▸kg`、[`catalog/presets.json:1040`](file:///home/mat/Projects/mathslot-next/catalog/presets.json#L1040)（`preset-084`）使用 `▸kd`（两者为旧 [`crates/mathslot-core/src/library.rs:568-603`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L568-L603) 默认自定义格式，未进 `catalog/commands.toml`）；
     - [`catalog/presets.json:537`](file:///home/mat/Projects/mathslot-next/catalog/presets.json#L537)（`preset-044`）使用 `▸gg`，而 [`catalog/commands.toml:554-556`](file:///home/mat/Projects/mathslot-next/catalog/commands.toml#L554-L556) 中 `\gamma` 键位为 `["g", "c"]`。

2. **LaTeX 导入未接入 `ImportReport` 且未在 Error 时阻断（`A-OBS-005`）**：
   - [`crates/mathslot-app/Cargo.toml:9-20`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/Cargo.toml#L9-L20)：`mathslot-latex` 仅位于 `[dev-dependencies]`，生产代码未依赖 `mathslot-latex`。
   - [`crates/mathslot-app/src/app.rs:386-395`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L386-L395)：`AppCommand::ImportLatex(latex)` 仅调用 `self.editor.import_latex(&latex)`（[`crates/mathslot-doc/src/editor.rs:584-605`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/editor.rs#L584-L605)），该函数无条件执行 `Edit::ReplaceAll { new_nodes: parsed_doc.nodes }` 覆盖当前文档后才返回 `mapped_diags`：
     - 未调用 [`mathslot_latex::convert_latex_with_report`](file:///home/mat/Projects/mathslot-next/crates/mathslot-latex/src/import.rs#L95-L137)；
     - 未向快照/Effect 暴露 [`ImportReport`](file:///home/mat/Projects/mathslot-next/crates/mathslot-latex/src/report.rs#L6-L33)（`lossless`、`empty_slots`、`raw_nodes`、`roundtrip_latex`、`normalized_match`）；
     - 存在 `Error` 级诊断时**不会阻断**导入替换，[`packages/ui/src/client/engine.ts`](file:///home/mat/Projects/mathslot-next/packages/ui/src/client/engine.ts#L110-L230) 与 `packages/ui/src/` 亦无导入弹窗与 `ImportReport` 展示组件。

---

## 3. 新发现缺陷登记

| ID | severity | 位置 | 现象 | 复现 |
|---|---|---|---|---|
| **D-120** | **P1** | [`crates/mathslot-wasm/Cargo.toml:13`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/Cargo.toml#L13)、[`crates/mathslot-wasm/src/lib.rs:54-560, 922-1005`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs#L54-L560)、[`crates/mathslot-render/Cargo.toml:10`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/Cargo.toml#L10) | `mathslot-wasm` 仍依赖冻结旧栈 `mathslot-core`、使用 28 个手写 `extern "C"` + `wasm_alloc/dealloc`、硬编码 5 条预置并重复实现 `tokenize_stream`，无 `#[wasm_bindgen]` `Engine` 与版本握手；宿主机缺少 `wasm-bindgen-cli`（但 `Cargo.lock:2898` 已缓存 `wasm-bindgen 0.2.130`）；`mathslot-render` 无条件拉入 `latex-rust` 导致 WASM 体积超预算风险（当前 641 KB > 400 KB）；`mathslot-store` 因 `fd-lock` 在 `wasm32` 编译失败（exit 101） | `cargo check -p mathslot-store --target wasm32-unknown-unknown --offline`（exit 101）；`which wasm-bindgen wasm-opt`（exit 2）；`ls -lh target/wasm32-unknown-unknown/release/mathslot_wasm.wasm`（641K） |
| **D-121** | **P1** | `apps/obsidian`（缺失）、[`obsidian-mathslot/src/plugin.js:1248-1293`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/src/plugin.js#L1248-L1293) | 目标 `apps/obsidian` 尚未建立；Obsidian 端未挂载共享 `packages/ui`（CM6 编辑器/调色板/导航树/预览/诊断/设置），也未接入 `createHostRenderMathAdapter` + `createManagedRenderer` 回退（`OPEN-002`） | `ls -la apps/`（exit 2）；`rg -n "createHostRenderMathAdapter" obsidian-mathslot/ packages/` |
| **D-122** | **P1** | [`obsidian-mathslot/src/plugin.js:1660-1669`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/src/plugin.js#L1660-L1669)、[`crates/mathslot-wasm/src/lib.rs:122-136`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs#L122-L136) | `A-OBS-002`：当 `libraryJson` 损坏时，旧插件直接 `delete this.data.libraryJson; await this.saveData(this.data);` 静默重置并覆盖用户数据，且 WASM 层吞错，未备份至 `backupJson`/隔离队列，也未触发 `SettingsPanel` 恢复向导 | 阅读 `obsidian-mathslot/src/plugin.js:1660-1669`；`rg -n "backupJson|SetRecoveryState" obsidian-mathslot/`（无匹配） |
| **D-123** | **P1** | [`crates/mathslot-app/src/app.rs:386-395`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L386-L395)、[`crates/mathslot-app/Cargo.toml:18`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/Cargo.toml#L18)、[`crates/mathslot-doc/src/editor.rs:584-605`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/editor.rs#L584-L605)、`packages/ui/src/` | `A-OBS-005`：`mathslot-app` `ImportLatex` 未接入 `mathslot_latex::convert_latex_with_report`，不输出 `ImportReport`，且在存在 `Error` 诊断时仍无条件执行 `Edit::ReplaceAll`；`packages/ui` 与 Obsidian 端均缺少 LaTeX 导入弹窗与阻断 UI | `rg -n "ImportReport|convert_latex_with_report" crates/mathslot-app/src/ packages/ui/src/`（零匹配） |
| **D-124** | **P2** | [`obsidian-mathslot/styles.css:1-470`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/styles.css#L1-L470)、[`obsidian-mathslot/src/plugin.js:448-1536`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/src/plugin.js#L448-L1536)、[`packages/ui/src/theme/tokens.css:1-262`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L1-L262) | `A-OBS-001`：旧插件 CSS 含 75 处硬编码 `#xxxxxx` 深色值、JS 含 39 处内联十六进制色值；`packages/ui` 令牌尚未映射 Obsidian 宿主变量（`--background-primary`、`--text-normal`、`--interactive-accent` 等） | `rg -c '#[0-9a-fA-F]{6}' obsidian-mathslot/styles.css`（75）；`rg -n "--background-primary" packages/ui/src/`（exit 1） |
| **D-125** | **P2** | [`obsidian-mathslot/styles.css:77, 104-118, 322`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/styles.css#L104-L118)、[`packages/ui/src/settings/SettingsPanel.svelte:848-856`](file:///home/mat/Projects/mathslot-next/packages/ui/src/settings/SettingsPanel.svelte#L848-L856)、[`PreviewPanel.svelte:342-348`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/PreviewPanel.svelte#L342-L348)、[`DiagnosticsPanel.svelte:299-305`](file:///home/mat/Projects/mathslot-next/packages/ui/src/diagnostics/DiagnosticsPanel.svelte#L299-L305) | `A-OBS-003`：缺少 `<= 480px` 响应式断点与移动端触控尺寸（`>= 36–44px`）适配；旧 CSS 写死 `114px` 菜单高与 `26px` 按钮，共享面板在极窄视口下分段按钮与工具栏缺乏堆叠约束 | `rg -n "@media|480px" packages/ui/src/ obsidian-mathslot/`（仅 `prefers-color-scheme: dark`） |
| **D-126** | **P2** | [`catalog/presets.json:33, 537, 1040`](file:///home/mat/Projects/mathslot-next/catalog/presets.json#L33)、[`crates/mathslot-app/src/app.rs:766-799`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L766-L799) | `A-OBS-004`：88 条预置中有 3 条（`preset-fundamental-theorem-calculus` 含 `▸kg`、`preset-damped-harmonic-oscillator` 含 `▸gg`、`preset-hodge-star-inner-product` 含 `▸kd`）无法被 `mathslot-app::LoadStreamSource` 识别并产生错误状态与 `\text{▸...}` 降级 | 全量 88 条预置词法检查脚本输出 `bad_count: 3` |

---

## 4. 历史结论抽查（与静默失败 / 测试弱化扫描）

| 来源 | 声称 | 实测 | 结论 |
|---|---|---|---|
| [`docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:29`](file:///home/mat/Projects/mathslot-next/docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md#L29) | "内存安全规约：全工程 `forbid(unsafe_code)` — 所有核心 crate 均包含 `#![forbid(unsafe_code)]`" | `mathslot-core/src/lib.rs:1` 与 `mathslot-app/src/lib.rs:1` 确实包含 `#![forbid(unsafe_code)]`；但 [`crates/mathslot-wasm/src/lib.rs:54-71, 564-571`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs#L54-L71) 存在多处 `unsafe extern "C"` 裸指针解引用与 `Vec::from_raw_parts`，未开启 `forbid(unsafe_code)` | **与声称不符（OPEN，归入 D-120）** |
| [`docs/AUDIT_ROUND_8.md:178-180`](file:///home/mat/Projects/mathslot-next/docs/AUDIT_ROUND_8.md#L178-L180) | "`crates/mathslot-wasm` 是零依赖纯原生 WebAssembly 模块，无需 `wasm-bindgen`，只需 `obsidian-mathslot/scripts/build.mjs`" | 当前代码仍如此；但依据现行权威规范 `INV-011`（[`LLM_IMPLEMENTATION_SPEC.md:198`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L198)）、`§11.1`（`:781-799`）与 `ADR-0022` §1.3（`OPEN-003`），手写 `wasm_alloc/dealloc` C ABI 已被禁止作为主接口，必须迁移到 `wasm-bindgen` | **历史结论已过期（OPEN，归入 D-120）** |

- **静默失败与测试弱化扫描**：`rg -n "let _\s*=|\.unwrap\(|#\[ignore|#\[allow" crates/mathslot-wasm/ obsidian-mathslot/ packages/ui/src/ packages/ui/tests/`（exit `0`）→ 仅命中 [`crates/mathslot-wasm/src/lib.rs:69`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs#L69) 一处 `let _ = Vec::from_raw_parts(...)`（旧 C-ABI 释放辅助）；`packages/ui/src/`、`packages/ui/tests/` 与 `obsidian-mathslot/` 无 `#[ignore]` / `#[allow]` / `.unwrap()`。

---

## 5. `ADR-0029` 范围、工具链约束与允许写路径建议

1. **必须先在 `ADR-0029` 中拍板的工具链与体积约束**：
   - **`wasm-bindgen-cli` 缺失问题（`D-120` / `OPEN-003`）**：`Cargo.lock:2898` 已锁定 `wasm-bindgen = "0.2.130"` 且 `.crate` 在本地缓存，但宿主机无 `wasm-bindgen` CLI 可执行文件。`ADR-0029` 需明确：**方案 A** 在本地与 `.github/workflows/{ci,release}.yml` 安装同版本 `wasm-bindgen-cli@0.2.130`（或从 crates 源码编译）以生成单文件内联 JS+WASM；若当前离线环境无法安装 `wasm-bindgen-cli`，须立项 `OPEN-*` 或明确声明 `#[wasm_bindgen]` 产物构建与测试验证方式，**禁止**违反 `INV-011` 继续长期保留手写 `wasm_alloc/dealloc` 作为目标主接口。
   - **`mathslot-render` 隔离 `latex-rust` 依赖**：建议为 [`crates/mathslot-render/Cargo.toml`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/Cargo.toml#L10) 增加 `latex-rust` 可选 feature（`default = ["latex-rust"]`），`mathslot-app` 仅在需要 `LatexRustSvgBackend` 时启用，使 `mathslot-wasm` 只携带 `ErrorSummary` 等纯数据契约以控制 WASM 体积在 `<= 400 KB`。
   - **`mathslot-store` 不进入 WASM**：保持 Obsidian `data.json` 持久化在 TS 侧完成（`Plugin.loadData`/`saveData` + `backupJson` 隔离队列 + `SetRecoveryState` 接入 `SettingsPanel`）。
2. **对齐 `apps/obsidian` 与 CI（不可破坏 `ci.yml`）**：
   - `.github/workflows/ci.yml:57-58` 与 `.github/workflows/release.yml:138-145` 当前执行 `node obsidian-mathslot/scripts/build.mjs` 并打包 `obsidian-mathslot/{manifest.json,main.js,styles.css}`。
   - `ADR-0029` 应明确：`apps/obsidian` 作为共享 `packages/ui` + `mathslot-wasm` 的工程源码目录，构建产物（单文件内联 `main.js`、`styles.css`、`manifest.json`）同步输出至 `apps/obsidian/dist/`（或 `obsidian-mathslot/`），且 `obsidian-mathslot/scripts/build.mjs`（以及 CI）复用同一构建与冒烟流程，保证 `node obsidian-mathslot/scripts/build.mjs` 持续绿灯且不保留第二套手工解析/命令表。
3. **建议 `ADR-0029` 授权 `implementer` 的写路径**：
   - `crates/mathslot-wasm/**`
   - `crates/mathslot-app/**`、`crates/mathslot-render/Cargo.toml`（`ImportLatex` `ImportReport` + Error 阻断；`latex-rust` feature 隔离）
   - `catalog/presets.json`、`packages/ui/src/generated/presets.ts`（修复 `D-126` 3 条预置后由 `xtask` 重新生成，确保无 diff）
   - `packages/ui/src/**`、`packages/ui/tests/**`（`ImportReport` 导入弹窗、Obsidian 主题变量兼容与 `<= 480px` 响应式样式）
   - `apps/obsidian/**`
   - `obsidian-mathslot/**`、`.github/workflows/ci.yml`、`.github/workflows/release.yml`（仅限与 `apps/obsidian` 单文件构建和 `wasm-bindgen` 流水线同步，保持 CI 绿灯）

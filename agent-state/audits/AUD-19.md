---
id: AUD-19
round: 19
gate: G3
scope: [T3.1, T3.2, T3.3, T3.4, T3.5, T3.6, T3.7, D-009, D-015, D-016, D-017, D-018, D-020, D-021, D-022, D-023, D-024, D-025, D-026]
verdict: BLOCK
readiness_verdict: BLOCKED_ENV / OPEN_SPEC
auditor: auditor
date: 2026-11-14
---

# 独立审计报告 AUD-19：Gate G3（`T3.1..T3.7`）可行性与 `T3.1` 基线审计

## 1. 判定摘要

- **审计裁定（`independent-audit`）**：**`BLOCK`**
- **Gate G3 / `T3.1` 准入裁定**：**`BLOCKED_ENV` + `OPEN_SPEC`**（触发 `OVERNIGHT_PROTOCOL.md` §7.2 与 §7.4 停机升级条件，禁止绕过规范或凭猜测开工）
- **核心阻断结论**：
  1. **环境与离线依赖阻断（`BLOCKED_ENV`）**：按 `docs/LLM_IMPLEMENTATION_SPEC.md` §5.1–§5.4 与 §14，Gate G3 `T3.1..T3.6` 要求构建 `packages/ui`（Svelte 5 + CodeMirror 6 + MathJax 3 SVG）、`apps/desktop`（Tauri 2）、`packages/core-wasm`（`wasm-bindgen` + `wasm-opt`）及 `apps/obsidian`。实测本地离线缓存与系统工具链**无法离线安装/构建**：
     - `packages/ui/` 仅有 `packages/ui/src/generated/catalog.ts`，无 `package.json`、无 `node_modules/`；`apps/` 与 `packages/core-wasm/` 完全不存在；
     - npm 离线缓存（`~/.npm/_cacache`）缺少 `codemirror`、`@codemirror/*`、`@tauri-apps/*`、`mathjax`/`mathjax-full`（`npm view --offline` 返回 `ENOTCACHED`）；
     - Cargo 离线缓存（`~/.cargo/registry/cache/`）缺少 `tauri`、`wry`、`tao`、`tauri-build`、`serde-wasm-bindgen`；
     - 系统缺失 `cargo-tauri`、`pnpm`、`wasm-pack`、`wasm-opt`，且缺少 Linux Tauri 2 必需系统库（`pkg-config --modversion webkit2gtk-4.1 gtk+-3.0` 全部未找到）。
  2. **规范与交接单冲突 + 未决产品约束（`OPEN_SPEC`）**：
     - `docs/LLM_IMPLEMENTATION_SPEC.md` 附录 C `OPEN-001`（`Tauri 2（共享 UI） vs egui（原生）`）、`OPEN-002`、`OPEN-003` 在 `ADR-0001..0021` 中**从未被人工决策闭环**；
     - `agent-state/HANDOFF.md:10` 与 `agent-state/verify/GATE-G2.md:67` 将 `T3.1` 描述为“桌面端编辑器接入 `app-core`，替换 `src/app.rs` 内 `StreamEditor` 直调、`F-012/D-009` 单行输入不折行、`D-015` 字体与候选词”，直接违背规范 §14 `T3.1` 原文（`CodeMirror 6 编辑器 + 命令装饰/槽位` → `packages/ui editor`），且误标 `D-015` 语义（§4 中 `D-015` 为焦点/快捷键/键盘可达性，而非字体与候选词）。
  3. **当前运行时基线**：Rust 工作区 `cargo test --workspace --offline`（214 passed / 0 failed / 1 ignored [D-007]）、`cargo clippy`、`cargo fmt --check` 与 `scripts/agent/acceptance.sh --fast`（`PASS=4 FAIL=0 WARN=4`）全绿，但桌面端（`src/`）与 WASM/Obsidian（`crates/mathslot-wasm/`、`obsidian-mathslot/`）仍直接运行旧 `mathslot-core` 栈，G3 目标范围内的 `D-009`、`D-015..D-018`、`D-020`、`D-021`、`D-024..D-026` 均仍处于 **`OPEN`**（`D-022`/`D-023` 为部分就绪）。

---

## 2. 规范、决策与交接一致性核查（`OPEN_SPEC` 证据）

### 2.1 规范契约（`docs/LLM_IMPLEMENTATION_SPEC.md`）
- **§5.1–§5.4（`L305-392`）**：目标架构为 `apps/desktop (Tauri 2)` + `apps/obsidian (TS)` 共享 `packages/ui (Svelte 5 + CodeMirror 6 + MathJax 3 SVG)`，通过 `EngineClient` 调用 Tauri `invoke` 或 `packages/core-wasm`（`wasm-bindgen`），底层统一使用 `mathslot-app`。
- **§11.1–§11.2（`L779-821`）**：`crates/mathslot-wasm` 改为 `#[wasm_bindgen]` + `serde-wasm-bindgen`（或 JSON）+ 版本握手 + `wasm-opt -Oz`（预算 ≤ 400 KB）；Obsidian 共享 catalog、88 条预置、LaTeX 导入、CSS 变量与损坏备份。
- **§12（`L824-863`）**：布局、焦点/快捷键（禁止每帧 `request_focus`，Tab 可离开）、可访问性（WCAG AA、键盘可达、screen reader、axe/Playwright）、明/暗/跟随系统主题。
- **§14（`L1003-1011`）**：
  - `T3.1`: `CodeMirror 6 编辑器 + 命令装饰/槽位` | depends_on `G2` | 产出 `packages/ui` editor | 退出 `A-EDIT-006/007/008`
  - `T3.2`: `调色板/搜索/导航树` | depends_on `T3.1`
  - `T3.3`: `预览/诊断/错误折叠` | depends_on `T3.1`
  - `T3.4`: `设置/主题/快捷键` | depends_on `T3.1`
  - `T3.5`: `Tauri 桌面壳` | depends_on `T3.1-T3.4` | 产出 `apps/desktop`
  - `T3.6`: `Obsidian 壳 + 共享 UI` | depends_on `T3.1-T3.4` | 产出 `apps/obsidian`
  - `T3.7`: `双端功能清单对齐` | depends_on `T3.5/T3.6`
- **附录 C 未决问题（`L1217-1219`）**：
  - `OPEN-001`：桌面端是否必须零 WebView（`Tauri 2（共享 UI） vs egui（原生）`）
  - `OPEN-002`：移动端 MathJax 性能是否可接受（`MathJax SVG vs KaTeX`）
  - `OPEN-003`：Obsidian 是否必须单文件插件（`外部 .wasm vs 内联 base64`）

### 2.2 历史 ADR 与交接文档冲突
- **`ADR-0010`（`agent-state/decisions/ADR-0010-xtask-codegen-pipeline-t1.2.md:17,53`）**：按规范生成 `packages/ui/src/generated/catalog.ts` 供 Svelte / `apps/desktop` / `apps/obsidian` 消费。
- **`ADR-0016`（`agent-state/decisions/ADR-0016-mathslot-app-state-machine-t2.1.md:15,17`）**：明确将 `mathslot-app` 定义为桌面端（Tauri）与 Obsidian（WASM）共用的唯一业务逻辑核心。
- **`ADR-0001..0021` 核查**：检索 `agent-state/`（`rg -n "OPEN-001|OPEN-002|OPEN-003|Tauri|CodeMirror|Svelte|packages/ui|apps/desktop|apps/obsidian" agent-state/`）确认**没有任何 ADR 决策关闭 `OPEN-001..003`**，也未批准放弃 Tauri/CM6/Svelte 改回 egui。
- **交接单漂移冲突**：
  - `agent-state/HANDOFF.md:10`：
    > 下一步：启动 Gate G3 首轮 `T3.1`（按规范 §14：桌面端编辑器接入 `app-core`，替换 `src/app.rs` 内 `StreamEditor` 直调、`F-012/D-009` 单行输入不折行、`D-015` 字体与候选词、及端到端状态机同步）
  - `agent-state/verify/GATE-G2.md:67`：
    > 下一阶段入口：进入 Gate `G3`（`T3.1..T3.7`：桌面端切换使用 `app-core`/`mathslot-store`/`mathslot-render` 与字体/输入区单行/按钮/WASM/Obsidian 接入）。
  - **矛盾点**：
    1. 规范 §14 `T3.1` 明确是 `packages/ui` 的 **CodeMirror 6 编辑器**，而非修改 `src/app.rs`（egui）；按 `AGENTS.md` 硬规则 2，若要把 G3 桌面端从 `Tauri 2 + Svelte + CM6` 改为继续改造 `egui`，必须先写 `OPEN-*` 并获人工确认。
    2. `HANDOFF.md:10` 称“`D-015` 字体与候选词”，而规范 §4（`L279`）中 `D-015` 为**焦点/快捷键/键盘可达性**（对应 `F-031`）。

---

## 3. 仓库现状与工具链/离线缓存实测（`BLOCKED_ENV` 证据）

### 3.1 目录与现有构建产物检查
- **命令**：
  ```bash
  ls -la /home/mat/Projects/mathslot-next && ls -la /home/mat/Projects/mathslot-next/packages /home/mat/Projects/mathslot-next/apps /home/mat/Projects/mathslot-next/crates /home/mat/Projects/mathslot-next/obsidian-mathslot 2>&1
  ```
- **退出码**：`2`（`apps` 不存在）
- **输出尾部**：
  ```text
  ls: 无法访问 '/home/mat/Projects/mathslot-next/apps': 没有那个文件或目录
  /home/mat/Projects/mathslot-next/packages:
  drwxr-xr-x. 1 mat mat   4 11月13日 11:24 .
  drwxr-xr-x. 1 mat mat   6 11月13日 11:24 ui
  ```
- **命令**：
  ```bash
  find /home/mat/Projects/mathslot-next/packages /home/mat/Projects/mathslot-next/xtask /home/mat/Projects/mathslot-next/catalog /home/mat/Projects/mathslot-next/crates/mathslot-wasm -maxdepth 4 -type f
  ```
- **退出码**：`0`
- **完整输出**：
  ```text
  /home/mat/Projects/mathslot-next/packages/ui/src/generated/catalog.ts
  /home/mat/Projects/mathslot-next/xtask/Cargo.toml
  /home/mat/Projects/mathslot-next/xtask/src/codegen.rs
  /home/mat/Projects/mathslot-next/xtask/src/main.rs
  /home/mat/Projects/mathslot-next/catalog/commands.toml
  /home/mat/Projects/mathslot-next/catalog/catalog.json
  /home/mat/Projects/mathslot-next/catalog/presets.json
  /home/mat/Projects/mathslot-next/crates/mathslot-wasm/Cargo.toml
  /home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs
  ```
- **核查结论**：
  - `xtask` 与生成产物就位：`packages/ui/src/generated/catalog.ts`（1529 行，121 命令）、`catalog/catalog.json`、`catalog/presets.json`（88 预置）、`docs/commands.md`、`schemas/commands.schema.json`、`crates/mathslot-command/src/generated.rs`。
  - `packages/ui/` 仅有 `src/generated/catalog.ts`，无 `package.json`、无 `node_modules/`、无任何 Svelte/CM6 文件。
  - `packages/core-wasm/`、`apps/desktop/`、`apps/obsidian/` 均不存在。
  - `obsidian-mathslot/package.json`（`scripts.build = "node scripts/build.mjs"`，无 `dependencies`/`devDependencies`）、`obsidian-mathslot/node_modules` 不存在；`obsidian-mathslot/scripts/build.mjs:10-35` 直接执行 `cargo build -p mathslot-wasm --target wasm32-unknown-unknown --release` 并把 `mathslot_wasm.wasm`（640.5 KB）以 Base64 内联到 `obsidian-mathslot/main.js`（875,958 字节）。
  - `crates/mathslot-wasm/Cargo.toml:12-13` 仅依赖 `mathslot-core = { path = "../mathslot-core" }`，尚未接入 `mathslot-app` 或 `wasm-bindgen`。

### 3.2 已安装工具、系统库与离线缓存实测
- **命令 1（工具与离线缓存盘点）**：
  ```bash
  for cmd in node npm pnpm npx cargo rustc wasm-pack wasm-opt; do
    if command -v "$cmd" >/dev/null 2>&1; then
      echo "$cmd: $(command -v $cmd) -> $($cmd --version 2>&1 | head -n1)"
    else
      echo "$cmd: NOT FOUND"
    fi
  done
  cargo tauri --version 2>&1 || true
  rustup target list --installed 2>&1 || true
  ls -la ~/.npm ~/.pnpm-store ~/.cache/pnpm ~/.cache/npm 2>&1 || true
  ls -la /home/mat/Projects/mathslot-next/obsidian-mathslot/node_modules /home/mat/Projects/mathslot-next/packages/ui/node_modules 2>&1 || true
  ls ~/.cargo/registry/cache/*/*tauri* ~/.cargo/registry/cache/*/*wry* ~/.cargo/registry/cache/*/*tao* ~/.cargo/registry/cache/*/*wasm-bindgen* ~/.cargo/registry/cache/*/*serde-wasm-bindgen* 2>&1 || true
  ```
- **退出码**：`0`
- **关键输出**：
  ```text
  node: /usr/bin/node -> v22.23.1
  npm: /usr/bin/npm -> 10.9.8
  pnpm: NOT FOUND
  npx: /usr/bin/npx -> 10.9.8
  cargo: /home/mat/.cargo/bin/cargo -> cargo 1.99.1 (5f94df478 2026-08-27)
  rustc: /home/mat/.cargo/bin/rustc -> rustc 1.99.1 (58cf8f9c3 2026-10-13)
  wasm-pack: NOT FOUND
  wasm-opt: NOT FOUND
  === cargo tauri ===
  error: no such command: `tauri`
  === rustup targets ===
  wasm32-unknown-unknown
  x86_64-unknown-linux-gnu
  === CACHES ===
  ls: 无法访问 '/home/mat/.pnpm-store': 没有那个文件或目录
  ls: 无法访问 '/home/mat/.cache/pnpm': 没有那个文件或目录
  ls: 无法访问 '/home/mat/.cache/npm': 没有那个文件或目录
  ls: 无法访问 '/home/mat/Projects/mathslot-next/obsidian-mathslot/node_modules': 没有那个文件或目录
  ls: 无法访问 '/home/mat/Projects/mathslot-next/packages/ui/node_modules': 没有那个文件或目录
  === CARGO REGISTRY CACHE ===
  ls: 无法访问 '/home/mat/.cargo/registry/cache/*/*tauri*': 没有那个文件或目录
  ls: 无法访问 '/home/mat/.cargo/registry/cache/*/*wry*': 没有那个文件或目录
  ls: 无法访问 '/home/mat/.cargo/registry/cache/*/*tao*': 没有那个文件或目录
  ls: 无法访问 '/home/mat/.cargo/registry/cache/*/*serde-wasm-bindgen*': 没有那个文件或目录
  /home/mat/.cargo/registry/cache/index.crates.io-1949cf8c6b5b557f/wasm-bindgen-0.2.130.crate
  /home/mat/.cargo/registry/cache/index.crates.io-1949cf8c6b5b557f/wasm-bindgen-futures-0.4.80.crate
  /home/mat/.cargo/registry/cache/index.crates.io-1949cf8c6b5b557f/wasm-bindgen-macro-0.2.130.crate
  /home/mat/.cargo/registry/cache/index.crates.io-1949cf8c6b5b557f/wasm-bindgen-macro-support-0.2.130.crate
  /home/mat/.cargo/registry/cache/index.crates.io-1949cf8c6b5b557f/wasm-bindgen-shared-0.2.130.crate
  ```
- **命令 2（npm 离线包与 Linux WebKit/GTK 系统库检查）**：
  ```bash
  npm view --offline codemirror version 2>&1 || true
  npm view --offline svelte version 2>&1 || true
  npm view --offline @codemirror/view version 2>&1 || true
  npm view --offline @tauri-apps/api version 2>&1 || true
  npm view --offline mathjax version 2>&1 || true
  npm view --offline mathjax-full version 2>&1 || true
  npm view --offline vite version 2>&1 || true
  npm view --offline vitest version 2>&1 || true
  npm view --offline @sveltejs/vite-plugin-svelte version 2>&1 || true
  pkg-config --modversion webkit2gtk-4.1 gtk+-3.0 2>&1 || true
  pkg-config --modversion webkit2gtk-4.0 libsoup-3.0 javascriptcoregtk-4.1 2>&1 || true
  ```
- **退出码**：`0`
- **关键输出**：
  ```text
  npm error code ENOTCACHED (codemirror)
  5.57.3 (svelte)
  npm error code ENOTCACHED (@codemirror/view)
  npm error code ENOTCACHED (@tauri-apps/api)
  npm error code ENOTCACHED (mathjax)
  npm error code ENOTCACHED (mathjax-full)
  8.3.8 (vite)
  5.1.0 (vitest)
  7.3.1 (@sveltejs/vite-plugin-svelte)
  Package 'webkit2gtk-4.1' not found
  Package 'gtk+-3.0' not found
  Package 'webkit2gtk-4.0' not found
  Package 'libsoup-3.0' not found
  Package 'javascriptcoregtk-4.1' not found
  ```
- **判定（能否离线解析/构建）**：
  - **`packages/ui`（CodeMirror 6 / MathJax 3）**：本地 `~/.npm/_cacache` 仅缓存了 `svelte@5.57.3`、`vite@8.3.8`、`vitest@4.1.4`/`5.1.0`、`playwright@1.65.0`、`typescript@5.9.3`/`6.0.3` 等通用包，**完全缺少 `codemirror`、`@codemirror/*`、`@lezer/*`、`mathjax`/`mathjax-full`**。因此**当前无法离线安装/解析 CodeMirror 6 编辑器依赖**。
  - **`apps/desktop`（Tauri 2）**：Cargo 缓存无 `tauri`/`wry`/`tao`，npm 缓存无 `@tauri-apps/*`，无 `cargo-tauri` CLI，且系统缺少 `webkit2gtk-4.1`、`gtk+-3.0`、`libsoup-3.0`、`javascriptcoregtk-4.1` 开发头文件。即使不考虑 npm 网络，Linux Tauri 2 **也无法在当前系统环境中编译**（需系统级 `apt/dnf` 安装 WebKitGTK/GTK 开发包并引入数十个未缓存的 Rust crate）。
  - **`mathslot-wasm`（`wasm-bindgen` 迁移）**：`wasm-bindgen 0.2.130` 在 Cargo 离线缓存内且 `wasm32-unknown-unknown` target 已装，但 `serde-wasm-bindgen`、`wasm-pack`、`wasm-opt` 均缺失（`Cargo.toml` 也尚未引入 `wasm-bindgen`）。

---

## 4. 剩余 P2/P3 缺陷基线逐项核查（`D-009`、`D-015..D-026`）

### 4.1 工作区现状基线命令
- `cargo test --workspace --offline`：exit `0`，**214 passed; 0 failed; 1 ignored**（仅剩 `D-007` 测试为 `#[ignore]`）。
- `cargo clippy --workspace --all-targets --offline -- -D warnings && cargo fmt --check`：exit `0`。
- `scripts/agent/acceptance.sh --fast`：exit `0`，输出 `PASS=4 FAIL=0 WARN=4`（`let _ = 计数: 15 处`、`unwrap() 计数: 20 处`、`命令表常量: 3 处`、`工作区干净`）。
- `node obsidian-mathslot/scripts/build.mjs`：exit `0`，产物 `mathslot_wasm.wasm` 为 `640.5 KB`（已用 `git checkout -- obsidian-mathslot/main.js` 恢复工作区干净）。

### 4.2 逐项缺陷核查表

| ID | 缺陷 | 代码位置（`file:line`） | 实测/现状证据 | 判定 |
|---|---|---|---|---|
| **D-009** | `singleline` 视觉换行（`F-012`） | `src/app.rs:1475-1499` | `egui::TextEdit::singleline(&mut self.editor.source)` 绑定了 `job.wrap.max_width = wrap_width;` 的 `layouter`，长输入仍出现视觉多行、语义单行；`packages/ui` CM6 编辑器不存在 | **OPEN** |
| **D-015** | 焦点/快捷键/键盘可达性（`F-031`） | `src/app.rs:455-475,1495,2196-2206`; `obsidian-mathslot/src/plugin.js:449,656-665` | `src/app.rs:1495` `.lock_focus(true)`；`src/app.rs:2198,2204` 在 `Palette` 页非导航态**每帧**执行 `request_focus(self.input_id)`；`Ctrl/Cmd+Shift+C`/`+Shift+S` 硬编码且不可配置 | **OPEN** |
| **D-016** | 删除无确认/撤销（`F-032`） | `src/modals.rs:762-765,805,1330-1332,1364,1608-1610,1639` | 公式库、自定义格式、片段的“删除”按钮点击后直接赋值 `delete_id`/`delete_key` 并立即删除，无二次确认或 undo toast/回收站 | **OPEN** |
| **D-017** | Obsidian 功能/主题/数据缺口（`F-028/F-029`） | `crates/mathslot-wasm/src/lib.rs:14-20`; `obsidian-mathslot/src/plugin.js:399-408,1660-1667`; `obsidian-mathslot/styles.css:7-263` | 仅提供循环预设按钮、无 88 预设库浏览/LaTeX 导入；`styles.css` 存在大量硬编码深色 hex（`#0f172a` 等）；`plugin.js:1666` 解析 `libraryJson` 失败时直接 `delete this.data.libraryJson` 而无备份隔离 | **OPEN** |
| **D-018** | 两套 parser/AST/LaTeX 栈（`F-001/F-002`） | `src/app.rs:14-22,63`; `src/modals.rs:4-6,236,783,1022`; `src/render.rs:8-9`; `crates/mathslot-wasm/src/lib.rs:3-12` | 新栈 `mathslot-app` 已在 G2 建成并通过对照测试，但桌面端 `src/` 与 WASM `crates/mathslot-wasm/` 运行时入口**仍全部直连旧 `mathslot-core`**；`acceptance.sh` 报 `命令表常量 3 处` | **OPEN**（运行时未切换） |
| **D-020** | 深度/标签硬上限静默降级（`F-026`） | `crates/mathslot-core/src/parser.rs:55,190,297,632,660`; `crates/mathslot-syntax/src/parser.rs` | `mathslot-core` 仍保留 `MAX_PARSE_DEPTH = 256` 静默回退 `UnknownCmd("?")` 与有限导航标签；`mathslot-syntax` 无显式深度超限 `Diagnostic`，`packages/ui` 可滚动导航树未建 | **OPEN** |
| **D-021** | WASM 手写 ABI/体积（`F-027`） | `crates/mathslot-wasm/Cargo.toml:13`; `crates/mathslot-wasm/src/lib.rs:55-72` | 仍使用手写 `wasm_alloc`/`wasm_dealloc` 与 `extern "C"` C ABI；无 `wasm-bindgen`/版本握手；产物 `mathslot_wasm.wasm = 640.5 KB`（超 ≤ 400 KB 目标） | **OPEN** |
| **D-022** | 平台/文档声明不准确（`F-030`） | `crates/mathslot-store/src/paths.rs:9-47`; `src/modals.rs:1832-1834,1753`; `README.md:69,179-185` | `modals::library_config_path()` 已接入 `mathslot_store::default_library_path()`（`dirs::config_dir()` + 三平台单测），但 `src/modals.rs:1753` 帮助文本及 `README.md` 仍包含手写旧描述（文档生成属 `T4.5`） | **PARTIAL** |
| **D-023** | CI 门禁覆盖不全（`F-005`） | `.github/workflows/ci.yml:12-52` | 已覆盖 `ubuntu-latest` 的 `fmt/clippy/test/wasm/obsidian build.mjs`，但缺少 §13.4 要求的三平台矩阵、`wasm-opt -Oz`、`npm ci && npm run build && npm run test && npm run e2e` | **PARTIAL** |
| **D-024** | 括号自动配对不识别 `\left (` 等带空格形式 | `crates/mathslot-core/src/editor.rs:2233-2281` | `bracket_pairs` 仅扫描单字符 `(`/`[`/`{`/`|`，未使用解析上下文；新栈 `mathslot-doc`/`mathslot-app` 亦无 `\left (`/`\bigl [` 配对测试 | **OPEN** |
| **D-025** | 选区包裹后光标在右括号后 | `crates/mathslot-core/src/editor.rs:865,868`; `src/app.rs:352` | `wrap_selection_with_bracket` 固定设置 `self.cursor_char = e + 2`（右括号后），不符合默认停在括号内或可配置契约 | **OPEN** |
| **D-026** | 自绘控件无 a11y 语义 | `src/theme.rs:15-120`; `src/app.rs` | egui 自定义深色控件无聚焦可见环/可读标签/浅色主题 token/WCAG AA & axe 检查 | **OPEN** |

*(注：`D-012` 在 `mathslot-doc`/`mathslot-app` 已被 `VER-14` 验证修复，但桌面运行时 `src/app.rs:1507` 仍保留 `Duration::from_millis(450)` 挂钟合并窗口，尚未切换。)*

---

## 5. 历史结论抽查（按 `independent-audit` §3.3）

| 来源 | 历史声称 | 本轮实测验证 | 结论 |
|---|---|---|---|
| `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:11,30` | 声称“全面通过 (PASS - 100% 达标，正式完成重构)”且 `git ls-files docs/` 为 `0` | 同一代码基线上 `D-009`（`src/app.rs:1481,1477`）、`D-015`（`src/app.rs:2198`）、`D-016`（`src/modals.rs:762`）、`D-017`（`obsidian-mathslot/styles.css:7`）均真实存在；`docs/` 已在 `ADR-0002` 纳入 git 追踪 | **历史结论不可信（过早签署 PASS）** |
| `docs/ACCEPTANCE_REPORT_FINAL.md:43,45` | 声称“全 4 个 Crate 根锁定 `#![forbid(unsafe_code)]`，0 unsafe”且首轮缺陷“100% 根除变绿” | `crates/mathslot-wasm/src/lib.rs:54-72` 实际使用 `unsafe` 手写 C-ABI 内存管理（`Vec::from_raw_parts`），且 `mathslot-core` 在后续审计暴露出 `D-001..D-030` 大量 P1/P2 缺陷 | **历史结论不可信（范围遗漏）** |

---

## 6. 下一步建议（升级与停机处理）

鉴于同时存在 **`OPEN_SPEC`** 与 **`BLOCKED_ENV`**，严禁 Implementer 直接修改 `src/app.rs` 绕过规范，也不得在缺少离线依赖的环境下空转：

1. **写入 `OPEN-*` 与 `STOPPED`（按 `OVERNIGHT_PROTOCOL.md` §7.2、§7.4 与 `AGENTS.md` 硬规则 2）**：
   - 创建 `agent-state/decisions/OPEN-0002-g3-ui-target-and-env.md`，向人工请求确认两条路线之一：
     - **选项 A（严格按规范 §5/§14）**：保持 `Tauri 2 + Svelte 5 + CodeMirror 6 + MathJax 3 + wasm-bindgen`（关闭 `OPEN-001` 为 Tauri 2）。需要人工预先解决环境缺口：安装系统库 `webkit2gtk-4.1`/`gtk+-3.0`、安装 `cargo-tauri`/`wasm-pack`/`wasm-opt`（或 `wasm-bindgen-cli`），并允许联网或预置 npm/Cargo 离线镜像（`codemirror`、`@codemirror/*`、`mathjax-full`、`tauri`、`wry`、`tao`、`@tauri-apps/*`、`serde-wasm-bindgen`）。
     - **选项 B（修订规范契约，仅改规范后执行）**：人工批准将桌面端保留为原生 `egui`（关闭 `OPEN-001` 为 egui）并修订 §5/§14 将 `T3.1` 定义为 `src/app.rs` 接入 `mathslot-app` + 修复 `D-009`/`D-012`/`D-015`/`D-016`/`D-018`/`D-024`/`D-025`，同时明确 Obsidian（`T3.6`）是保留无第三方依赖原生 TS/JS 还是在线安装 Svelte/CM6。
2. **纠正 `HANDOFF.md:10` 与 `GATE-G2.md:67` 的描述偏差**：待人工决策后再同步更新 `T3.1` 定义与 `D-015` 语义，避免后续轮次误判。

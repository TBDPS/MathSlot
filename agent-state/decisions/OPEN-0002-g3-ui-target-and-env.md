# OPEN-0002: Gate G3 UI 技术路线与离线环境前置决策

- **Date**: 2026-11-14
- **Round**: 19
- **Gate / Task**: `G3` / `T3.1`
- **Status**: OPEN（需人工决策 + 环境准备；触发 `STOPPED`）
- **Audit Evidence**: `agent-state/audits/AUD-19.md`
- **Spec Reference**: `docs/LLM_IMPLEMENTATION_SPEC.md` §5.1–§5.4, §11, §12, §14 (`T3.1..T3.7`), Appendix C (`OPEN-001..003`)

---

## 1. 阻塞摘要

Gate `G0`、`G1`、`G2`（`T0.1..T2.5`，共 17 项任务）已全部完成并收口 `PASS`。进入 Gate `G3` (`T3.1`) 前，只读审计 [`AUD-19.md`](file:///home/mat/Projects/mathslot-next/agent-state/audits/AUD-19.md) 确认存在两项**不可由代理自行越权绕过**的阻断：

1. **未决契约（`OPEN_SPEC`）**：
   - `docs/LLM_IMPLEMENTATION_SPEC.md` 附录 C `OPEN-001`（桌面端 `Tauri 2（共享 UI） vs egui（原生）`）、`OPEN-002`（`MathJax SVG vs KaTeX`）、`OPEN-003`（`外部 .wasm vs 内联 base64`）尚未形成人工确认决议。
   - 规范 §14 要求 `T3.1..T3.6` 构建 `packages/ui`（Svelte 5 + CodeMirror 6 + MathJax 3 SVG）、`apps/desktop`（Tauri 2）、`packages/core-wasm`（`wasm-bindgen` + `wasm-opt`）与 `apps/obsidian`；而早期 `HANDOFF.md:10` / `GATE-G2.md:67` 曾把 G3 写成直接改造原生 `egui` (`src/app.rs`)，与规范原文不一致。
2. **离线环境与系统依赖缺失（`BLOCKED_ENV`）**：
   - `packages/ui/node_modules/`、`apps/`、`packages/core-wasm/` 尚不存在；
   - npm 离线缓存缺失 `codemirror`、`@codemirror/view`、`@tauri-apps/api`、`mathjax`、`mathjax-full`（`npm view --offline` 返回 `ENOTCACHED`）；
   - Cargo 离线缓存缺失 `tauri`、`wry`、`tao`、`tauri-build`、`serde-wasm-bindgen`；
   - 系统缺少 `pnpm`、`cargo-tauri`、`wasm-pack`、`wasm-opt`，以及 Linux Tauri 2 编译所需系统库（`pkg-config --modversion webkit2gtk-4.1 gtk+-3.0 webkit2gtk-4.0 libsoup-3.0 javascriptcoregtk-4.1` 均未找到）。

---

## 2. 需要人工二选一确认的方案

### 选项 A：严格遵循原规范 §5 / §14（`Tauri 2 + Svelte 5 + CodeMirror 6 + MathJax 3 + wasm-bindgen`）
- **决策含义**：正式关闭 `OPEN-001 = Tauri 2（共享 UI）`，明确 `OPEN-002`（MathJax SVG / KaTeX）与 `OPEN-003`（外部 `.wasm` / 内联 base64）。
- **人工前置准备**（缺一不可，完成后方可重启 `T3.1`）：
  1. 安装系统依赖：`webkit2gtk-4.1`、`gtk+-3.0`（及 `libsoup-3.0`、`javascriptcoregtk-4.1`）、`pnpm`、`cargo-tauri`、`wasm-pack`、`wasm-opt`；
  2. 为 Cargo 预取或联网放行 `tauri`、`wry`、`tao`、`serde-wasm-bindgen`；
  3. 为 `packages/ui` / `apps/*` 预置 npm 离线缓存或联网执行 `pnpm install`（`svelte`, `codemirror`, `@codemirror/*`, `mathjax-full`, `@tauri-apps/api`, `vitest`, `playwright`）。

### 选项 B：修订规范 §5 / §11 / §14（保留原生 `egui` 桌面端 + 无外部 npm 依赖 Obsidian TS）
- **决策含义**：人工批准修改 `docs/LLM_IMPLEMENTATION_SPEC.md`，关闭 `OPEN-001 = egui（原生）`、`OPEN-003 = 内联 base64`（或独立 `.wasm`）：
  1. 将 `G3` 桌面端（`T3.1..T3.5`）重新契约化为：将 `src/app.rs` / `src/modals.rs` / `src/render.rs` 运行时切换至 `mathslot-app` / `mathslot-store` / `mathslot-render`，解决 `D-009`（singleline 禁止换行）、`D-012`（消除桌面挂钟 450ms）、`D-015`（焦点/可配置快捷键/a11y）、`D-016`（删除确认与撤销）、`D-018`（清除旧 `mathslot-core` 直调）、`D-020`、`D-024`、`D-025`、`D-026`；
  2. 将 `T3.6` 明确为基于 `crates/mathslot-wasm`（可选 `wasm-bindgen 0.2.130` 或升级契约）+ `obsidian-mathslot/`（无第三方 npm 依赖或显式离线包）。

---

## 3. 停机状态

按 `AGENTS.md` 硬规则 2 与夜间停止条件 §7.2 / §7.4，已创建 `agent-state/STOPPED` 与 `agent-state/OVERNIGHT_REPORT.md` 并停止执行，等待人工批复本 `OPEN-0002`（或安装依赖 / 修订规范）。

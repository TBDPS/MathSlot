# ADR-0022: 闭合 OPEN-0002（G3 最优技术栈抉择）与转向 Tauri 前的原生热修复交付路线

- **Date**: 2026-11-14
- **Round**: 20
- **Status**: Accepted（依据用户指令："选择Tauri路线……在修复bug后打包一个原生可执行文件后，彻底转向……修复所有bug，所有选项均按照最优情况执行"）
- **Supersedes / Closes**: `agent-state/decisions/OPEN-0002-g3-ui-target-and-env.md`（闭合规范附录 C `OPEN-001`、`OPEN-002`、`OPEN-003`）
- **Audit Basis**: `agent-state/audits/AUD-19.md`、`agent-state/audits/AUD-20.md`

---

## 1. 闭合 `OPEN-001`..`OPEN-003`（最优方案决策）

### 1.1 `OPEN-001`（桌面端 UI 宿主）：**Tauri 2 + 共享 UI（`packages/ui` Svelte 5 + CodeMirror 6）**
- 理由：用户将 UI 界面呈现效果作为核心评判标准；Tauri 2 + Web CSS/Svelte 5 + CodeMirror 6 可彻底根治原生 `egui`/`winit` 在 Wayland IME、单行包裹、字体排印与组件视觉质感上的结构性短板，并与 Obsidian 端最大化共享编辑/调色板/诊断组件（符合 `docs/LLM_IMPLEMENTATION_SPEC.md` §5.1 与 `INV-009`）。

### 1.2 `OPEN-002`（渲染引擎）：**统一 `RenderAdapter` 双端最优方案**
- **Obsidian 端**：固定复用**宿主 `renderMath`**（零额外 JS 体积、原生 MathJax 3 SVG、`VisualDialect::MathJax`、完美跟随笔记主题）。
- **Tauri 2 桌面端**：前端 `packages/ui` 只依赖统一的异步渲染适配器接口：
  - **主引擎选用 MathJax 3 SVG**（与 Obsidian 100% 视觉同源、`VisualDialect::MathJax` `\bbox`+`\color` 一致、支持 `currentColor` 亮暗主题切换、可选中/高自由度 CSS 排印、极低宏降级率）；
  - **保留 Rust 侧 `latex-rust`（升级为 `latex_to_svg` 矢量输出）+ `mathslot-render` 缓存作为桌面 Tauri 极速/离线兜底后端**（避免废弃 G2 已完成的 `mathslot-render` 资产）。

### 1.3 `OPEN-003`（Obsidian WASM 打包方式）：**单文件内联 WASM（`wasm-bindgen` + 可选 `wasm-opt -Oz`）**
- 延续 `obsidian-mathslot/scripts/build.mjs` 的零配置单 `main.js` 体验，升级绑定层为规范 `INV-011` 要求的 `wasm-bindgen`（替代手写 `wasm_alloc/dealloc` C ABI）。

---

## 2. 执行顺序（先完成原生热修复与原生安装包，再转向 G3 Tauri 2）

在完全转向 `G3`（`T3.1..T3.7`）之前，先用两轮严格受控、独立审计/验收的原生热修复，清零桌面原生端 P1 与关键交互缺陷并产出正式 release 可执行包：

1. **Round 20 (`PRE-G3-NATIVE-1`)**：修复原生键盘/IME/焦点/输入缺陷 **`D-110`**（P1，Wayland + `fcitx5` 无限连击死循环）、**`D-015`**（每帧 `request_focus` + `.lock_focus(true)` 焦点陷阱）、**`D-009`**（`TextEdit::singleline` 视觉折行）。
2. **Round 21 (`PRE-G3-NATIVE-2`)**：修复原生导入与数据安全缺陷 **`D-007`**（P1，接入 `mathslot_latex::convert_latex_with_report` 与 `ImportReport`，取消 `#[ignore]` 并使全测试通过）、**`D-016`**（`src/modals.rs` 三处删除补齐二次确认/可撤销机制）、**`D-004` 原生剪贴板保护**（`src/app.rs` `copy_latex` 遇到 `PendingCmd`/`UnknownCmd` 时给出可见诊断而非静默丢弃），并构建产出 `cargo build --release --locked --bin mathslot` 原生可执行文件与 Linux 打包归档（`dist/mathslot-linux-x86_64.tar.gz`，`.gitignore` 排除或临时交付产物，不污染 git 历史）。
3. **Round 22+（Gate G3 `T3.1`–`T3.7` → Gate G4 `T4.1`–`T4.6`）**：彻底转向 Tauri 2 + Svelte 5 + CodeMirror 6 + MathJax 3 SVG + Obsidian 共享 UI，并补齐或指引安装 Fedora 系统 `-devel` 库（`webkit2gtk4.1-devel`、`gtk3-devel`、`libsoup3-devel`、`javascriptcoregtk4.1-devel`，需提权密码时向用户精确说明或执行独立前置检查）。

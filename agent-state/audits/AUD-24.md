---
id: AUD-24
round: 25
gate: G3
scope: [T3.4, D-015, D-016, D-020, A-DATA-001, A-UI-001, A-UI-004, A-UI-005, S-005, S-006, S-007]
verdict: BLOCK
auditor: mathslot-auditor
date: 2026-11-14
---

# 独立审计报告 AUD-24：Gate G3 / `T3.4`（设置页 / 明暗主题 / 快捷键可配置 / 数据恢复 UI）前置只读审计与 `T3.5` 就绪核查

## 1. 判定摘要

- **审计裁定**：**`BLOCK`**（`T3.4` 核心交付物——`mathslot-store`/`mathslot-app` 完整设置与恢复契约、`packages/ui` `SettingsPanel.svelte`、可配置快捷键与保留键冲突检测、`tokens.css` `[data-theme='light']` 作用域修复——尚未实现；当前工作区基线本身全绿，但 `T3.4` 所需契约与 UI 组件尚处于空白状态）。
- **逐项结论（仅使用 `OPEN` / `FIXED` / `NOT-REPRODUCIBLE`）**：
  1. **`T3.4`（设置页 / 主题 / 快捷键 / 定界符 / 渲染后端 / 数据恢复 UI）**：**`OPEN`** — [`packages/ui/src/index.ts:1-111`](file:///home/mat/Projects/mathslot-next/packages/ui/src/index.ts#L1-L111) 与 `packages/ui/src/` 目录下不存在 `settings/` 或 `SettingsPanel.svelte`；[`crates/mathslot-store/src/lib.rs:136-143`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L136-L143) 与 [`crates/mathslot-app/src/app.rs:412-435`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L412-L435) 缺少主题/渲染后端/快捷键/恢复状态等设置契约（详见 §3 `D-116`、`D-117`）。
  2. **`D-015`（焦点不锁死与快捷键可配置 / 冲突提示）**：
     - CM6 编辑器 `Tab` / `Shift+Tab` / `Escape` 焦点离开与不锁死：[`packages/ui/src/editor/keymap.ts:73-91`](file:///home/mat/Projects/mathslot-next/packages/ui/src/editor/keymap.ts#L73-L91) 与 [`MathSlotEditor.svelte:129-137`](file:///home/mat/Projects/mathslot-next/packages/ui/src/editor/MathSlotEditor.svelte#L129-L137) 无每帧 focus 抢占（**`FIXED`**）。
     - 快捷键可配置、冲突检测与“回到输入框”显式快捷键：[`packages/ui/src/editor/keymap.ts:19-26, 73-122`](file:///home/mat/Projects/mathslot-next/packages/ui/src/editor/keymap.ts#L19-L26) 仍使用硬编码 `NAV_KEY_MAP` 与默认快捷键，无配置注入与冲突提示（**`OPEN`**，见 §3 `D-118`）。
  3. **`D-016` / `A-DATA-001`（恢复向导 UI 与恢复默认二次确认）**：
     - Rust 数据安全存储层（`load_or_recover` 损坏隔离 `CorruptQuarantined`、3–5 代轮转备份、`save_atomic` + `fsync`）：[`crates/mathslot-store/src/lib.rs:413-428, 608-712, 746-834`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L608-L712) 已实现（**`FIXED`**）。
     - `mathslot-app` / `packages/ui` 恢复状态传递、恢复向导 UI 与“恢复默认设置/重置空配置”二次确认：目前仅存在于冻结/旧桌面端 [`src/modals.rs:185-256`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L185-L256)，新栈 `mathslot-app` 与 `packages/ui` 尚未接入（**`OPEN`**，见 §3 `D-116`、`D-117`）。
  4. **明暗主题令牌与系统跟随（`A-UI-004` / `S-006`）**：**`OPEN`** — [`packages/ui/src/theme/tokens.css:154-155`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L154-L155) 缺少显式 `[data-theme='light']` 覆盖块，且 [`PreviewPanel.svelte:58`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/PreviewPanel.svelte#L58) 在 `theme === 'auto'` 时静态回退 `'light'`（见 §3 `D-119`）。
  5. **`T3.5`（Tauri 桌面壳）环境前置实测**：**未就绪（宿主缺少 Fedora `webkit2gtk4.1-devel` / `gtk3-devel` / `tauri-cli`）**，但不阻塞纯库与 `packages/ui` 测试的 `T3.4`（详见 §2.5）。
  6. **新发现缺陷（§3）**：登记 **`D-116`**（P2）、**`D-117`**（P2）、**`D-118`**（P2）、**`D-119`**（P2）。

---

## 2. 逐项证据与基线验证

### 2.1 基线事实核验

- **Git HEAD**：`git rev-parse --short HEAD` → `842ab64`（分支 `refactor/v1`，工作区干净）。
- **最近提交**：`git log -n 3 --oneline`（exit `0`）
  ```text
  842ab64 (HEAD -> refactor/v1) chore(agent-state): round 24 G3 T3.3 PASS (VER-24) and enter T3.4
  0f7b3cc feat(render,ui): T3.3 D-113 D-114 D-115 D-003 D-010 D-011 D-019 add preview/diagnostics panels and dual RenderAdapter
  3fcf099 chore(agent-state): round 24 AUD-23 and ADR-0027 authorize G3 T3.3
  ```
- **Rust 工作区测试**：`cargo test --workspace --offline -q` → exit `0`，全部测试段 `0 failed; 0 ignored`（含 `mathslot-store`、`mathslot-app`、`mathslot-render` 等全量通过）。
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
- **前端 `packages/ui` 测试与构建**：`cd packages/ui && npm test && npm run check && npm run build` → exit `0`
  ```text
  Test Files  5 passed (5)
       Tests  18 passed (18)
  svelte-check found 0 errors and 0 warnings
  ✓ 318 modules transformed.
  dist/index.css     24.79 kB │ gzip:   4.07 kB
  dist/index.js   2,541.42 kB │ gzip: 768.48 kB
  ✓ built in 1.37s
  ```
- **静默失败与测试弱化扫描**：
  - 命令：`rg -n "let _\s*=|\.unwrap\(|#\[ignore|#\[allow" crates/mathslot-store/ crates/mathslot-app/ packages/ui/src/ packages/ui/tests/`（exit `0`）
  - 结果：仅 1 处测试内断言辅助调用（[`crates/mathslot-store/tests/data_safety_tests.rs:479`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/tests/data_safety_tests.rs#L479)），`crates/mathslot-store/src/`、`crates/mathslot-app/`、`packages/ui/` 生产代码均为 `0` 处。

### 2.2 `crates/mathslot-store` 与 `crates/mathslot-app` 设置/快捷键/恢复契约核验

- **代码核验**：
  1. **`mathslot-store::Settings` 字段不完整且存在覆盖丢失风险**：
     - [`crates/mathslot-store/src/lib.rs:136-143`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L136-L143) 当前仅定义：
       ```rust
       pub struct Settings {
           pub delimiter_style: Option<String>,
           pub preview_scale_pct: Option<u16>,
       }
       ```
       缺少 `theme`（`light` / `dark` / `system`）、`render_backend`（`mathjax` / `latex-rust`）与 `shortcuts`（可配置快捷键映射表）。
     - [`crates/mathslot-store/src/lib.rs:171-280`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L171-L280)：`LibraryFile::from_user_library` 构造结果时硬编码 `settings: Settings::default()`（第 279 行），而 [`crates/mathslot-core/src/library.rs:519-523`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L519-L523) 的 `UserLibrary` 不包含 `settings`。若直接通过 `from_user_library` 保存公式/自定义格式变更，已落盘的 `LibraryFile.settings` 会被静默清零。
     - [`crates/mathslot-store/src/paths.rs:9-11`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/paths.rs#L9-L11) 已提供跨平台 `default_library_path()`，[`crates/mathslot-store/src/lib.rs:413-428, 608-712`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L413-L428) 已提供 `LoadOutcome::CorruptQuarantined { corrupt_path, backup_candidate, error }` 与 `list_backups`。
  2. **`mathslot-app` 缺少设置、定界符格式化、快捷键与恢复契约**：
     - [`crates/mathslot-app/src/app.rs:18-23`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L18-L23) 的 `App` 仅持有 `{ editor, state, render_seq }`，未持有用户设置或定界符选项。
     - [`crates/mathslot-app/src/app.rs:412-435`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L412-L435) 的 `ExecuteExport` 直接导出原始 `latex`（无规范定界符包装：`none` / `$...$` / `$$\n...\n$$` / ```` ```latex\n...\n``` ````；对比旧桌面端 [`src/app.rs:105-115, 1900-1914`](file:///home/mat/Projects/mathslot-next/src/app.rs#L105-L115)）。
     - [`crates/mathslot-app/src/event.rs:3-34`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/event.rs#L3-L34)、[`command.rs:3-28`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/command.rs#L3-L28)、[`snapshot.rs:119-133`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/snapshot.rs#L119-L133) 与 [`packages/ui/src/client/engine.ts:36-145`](file:///home/mat/Projects/mathslot-next/packages/ui/src/client/engine.ts#L36-L145) 均无设置更新/重置事件、快照设置字段或定界符导出支持。
- **命令**：`rg -n "Settings|delimiter_style|preview_scale_pct" crates/mathslot-store/`（exit `0`）与 `rg -n "settings|delimiter|shortcut|theme|render_backend|backup|recover" crates/mathslot-store/ crates/mathslot-app/`（exit `0`，`crates/mathslot-app/src/` 零匹配）。
- **判定**：**`OPEN`**（见 §3 `D-116`）。

### 2.3 `packages/ui` 设置面板、快捷键可配置与恢复 UI 核验

- **代码核验**：
  1. **缺少 `SettingsPanel.svelte` 与设置/恢复模型**：
     - 命令：`ls -la packages/ui/src/`（exit `0`）输出子目录仅含 `client/`、`diagnostics/`、`editor/`、`generated/`、`nav/`、`palette/`、`preview/`、`theme/`，无 `settings/`。
     - [`packages/ui/src/index.ts:1-111`](file:///home/mat/Projects/mathslot-next/packages/ui/src/index.ts#L1-L111) 未导出任何设置组件、快捷键绑定/冲突校验模型或恢复向导接口。
     - 对照规范要求：
       - §12.1（[`docs/LLM_IMPLEMENTATION_SPEC.md:830`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L830)）：设置页需包含主题、快捷键、分隔符、渲染后端、配置路径、导入/导出；
       - §12.2 / `D-015`（[`docs/LLM_IMPLEMENTATION_SPEC.md:836-839`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L836-L839)）：需提供“回到输入框”的可配置快捷键；`Ctrl/Cmd+Shift+C`、`+Shift+S` 不得作为不可配置的唯一入口；所有快捷键从配置读取并在冲突时提示；
       - §10.3 / `A-DATA-001` & `D-016`（[`docs/LLM_IMPLEMENTATION_SPEC.md:748-749, 280`](file:///home/mat/Projects/mathslot-next/docs/LLM_IMPLEMENTATION_SPEC.md#L748-L749)）：损坏隔离状态展示恢复向导（从最近备份恢复 / 确认重置空配置），危险操作（恢复默认设置 / 重置配置）须二次确认。
  2. **`keymap.ts` 硬编码快捷键且无冲突防护**：
     - [`packages/ui/src/editor/keymap.ts:19-26`](file:///home/mat/Projects/mathslot-next/packages/ui/src/editor/keymap.ts#L19-L26)：`NAV_KEY_MAP` 为常量写死映射（`j/n/k/p/h/l`）；[`keymap.ts:73-122`](file:///home/mat/Projects/mathslot-next/packages/ui/src/editor/keymap.ts#L73-L122) 仅处理 `Tab`/`Shift+Tab`/`Escape`/`Enter` 及 CM6 `defaultKeymap`/`historyKeymap`，未读取用户快捷键配置，无自定义动作分发（复制 LaTeX、保存片段、切换导航、聚焦输入框、打开设置），也无与保留键（`Tab`、`Shift+Tab`、`Escape`、单字符文本键及标准系统/编辑快捷键）的冲突拦截。
- **判定**：**`OPEN`**（见 §3 `D-117`、`D-118`）。

### 2.4 `packages/ui` 明暗/跟随系统主题令牌与 `PreviewPanel` 主题解析核验

- **代码核验**：
  - [`packages/ui/src/theme/tokens.css:1-79`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L1-L79) 在 `:root` 定义浅色变量；[`tokens.css:81-152`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L81-L152) 定义 `[data-theme='dark']`；[`tokens.css:154-227`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L154-L227) 在 `@media (prefers-color-scheme: dark)` 内仅匹配 `:root:not([data-theme='light'])`。
  - **缺失 `[data-theme='light']` 显式变量块**：当 `:root` 因系统暗色命中 `:root:not([data-theme='light'])` 或宿主设置 `[data-theme='dark']` 时，子容器设置 `data-theme="light"` 无法将 CSS 自定义属性恢复为浅色值（与 [`VER-24.md:183`](file:///home/mat/Projects/mathslot-next/agent-state/verify/VER-24.md#L183) 记录的观测一致）。
  - [`packages/ui/src/preview/PreviewPanel.svelte:58`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/PreviewPanel.svelte#L58)：`const renderTheme = $derived<RenderTheme>(theme === 'dark' ? 'dark' : 'light');` 在 `theme === 'auto'` 时不监听 `window.matchMedia('(prefers-color-scheme: dark)')`，导致系统暗色下渲染请求 `req.theme` 仍为 `'light'`。
- **判定**：**`OPEN`**（见 §3 `D-119`）。

### 2.5 `T3.5`（Tauri 桌面壳）宿主机环境就绪实测

- **命令 1**：`pkg-config --modversion webkit2gtk-4.1 gtk+-3.0`（exit `1`）
  ```text
  Package webkit2gtk-4.1 was not found in the pkg-config search path.
  Perhaps you should add the directory containing `webkit2gtk-4.1.pc'
  to the PKG_CONFIG_PATH environment variable
  Package 'webkit2gtk-4.1' not found
  Package 'gtk+-3.0' not found
  ```
- **命令 2**：`rpm -q webkit2gtk4.1-devel gtk3-devel libsoup3-devel javascriptcoregtk4.1-devel librsvg2-devel`（exit `5`，对应 5 个包均未安装）
  ```text
  未安装软件包 webkit2gtk4.1-devel
  未安装软件包 gtk3-devel
  未安装软件包 libsoup3-devel
  未安装软件包 javascriptcoregtk4.1-devel
  未安装软件包 librsvg2-devel
  ```
- **命令 3**：`which tauri cargo-tauri; cargo tauri --version`（`tauri` / `cargo-tauri` 均未安装，`error: no such command: tauri`）；`node -v` → `v22.23.1`、`npm -v` → `10.9.8`。
- **结论**：`T3.4`（纯 Rust `mathslot-store`/`mathslot-app` + `packages/ui`）不受影响；但进入 **`T3.5`** 前，必须先由人工/运维完成 Fedora `-devel` 依赖包与 Tauri CLI 安装。

---

## 3. 新发现

| ID | severity | 位置 | 现象 | 复现 / 验证 |
|---|---|---|---|---|
| **D-116** | P2 | [`crates/mathslot-store/src/lib.rs:136-143, 279`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L136-L143), [`crates/mathslot-app/src/app.rs:412-435`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L412-L435), [`packages/ui/src/client/engine.ts:36-145`](file:///home/mat/Projects/mathslot-next/packages/ui/src/client/engine.ts#L36-L145) | `mathslot-store::Settings` 缺少 `theme`、`render_backend`、`shortcuts` 字段；`LibraryFile::from_user_library` 第 279 行硬编码 `settings: Settings::default()` 会抹除已保存设置；`mathslot-app` 未承载设置状态、定界符包装导出与配置恢复状态契约，TS `EngineClient` 无对应类型 | 阅读 `crates/mathslot-store/src/lib.rs:136-143, 279` 与 `rg -n "settings\|delimiter\|shortcut\|theme\|render_backend" crates/mathslot-app/`（0 匹配） |
| **D-117** | P2 | [`packages/ui/src/index.ts:1-111`](file:///home/mat/Projects/mathslot-next/packages/ui/src/index.ts#L1-L111), `packages/ui/src/` | `packages/ui` 缺少 `SettingsPanel.svelte` 及对应状态模型：无主题（明/暗/跟随系统）、默认定界符（无 / `$...$` / `$$...$$` / ```` ```latex ````）、首选渲染后端（`mathjax` vs `latex-rust`）、配置路径展示、导入/导出入口、损坏隔离恢复向导 UI（`A-DATA-001`）及恢复默认设置的二次确认（`D-016`） | `ls -la packages/ui/src/` 与阅读 `packages/ui/src/index.ts:1-111` |
| **D-118** | P2 | [`packages/ui/src/editor/keymap.ts:19-26, 73-122`](file:///home/mat/Projects/mathslot-next/packages/ui/src/editor/keymap.ts#L19-L26) | `keymap.ts` 快捷键表硬编码（`NAV_KEY_MAP` 及固定键值），未从设置读取可配置快捷键（含 `copy_latex`、`save_snippet`、`focus_editor`“回到输入框”、`toggle_nav`、`open_settings` 等），且缺少对保留键（`Tab`、`Shift+Tab`、`Escape`、未修饰单字符输入、基础编辑键）的冲突检测与错误提示（`D-015` / §12.2） | 阅读 `packages/ui/src/editor/keymap.ts:19-26, 73-122` |
| **D-119** | P2 | [`packages/ui/src/theme/tokens.css:154-155`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L154-L155), [`packages/ui/src/preview/PreviewPanel.svelte:58`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/PreviewPanel.svelte#L58) | `tokens.css` 缺少 `[data-theme='light']` 显式变量块，当 `:root` 命中系统暗色 `@media (prefers-color-scheme: dark)` 时，局部 `<section data-theme="light">` 无法回切浅色；且 `PreviewPanel.svelte:58` 在 `theme === 'auto'` 时不跟随 `prefers-color-scheme: dark`，向渲染器恒定传入 `'light'` | 阅读 `tokens.css:1-227`、`PreviewPanel.svelte:58` 与 `VER-24.md:183` |

---

## 4. 历史结论抽查（按 `independent-audit` §3.3）

| 来源（`file:line`） | 历史声称 | 本轮代码/命令实测 | 结论 |
|---|---|---|---|
| [`docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:112`](file:///home/mat/Projects/mathslot-next/docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md#L112) | 声称“无 CapsLock、无文本内嵌 `▸j`、无三套键位表 \| `StreamEditor` 与单一命令注册表彻底治理 \| 100% 达标 (PASS)” | 实测 `rg -n 'const (COMMAND\|SYMBOL\|STRUCT\|RELATION\|OPERATOR\|GREEK)_ENTRIES' src crates`（exit `0`）仍在 [`crates/mathslot-core/src/command.rs:581, 831, 1140`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/command.rs#L581) 命中 3 处旧静态命令表常量（`acceptance.sh --fast` 亦提示 `WARN 命令表常量 3 处`） | **过度声称（Round 12 时 `mathslot-core` 与旧栈多份常量表尚未收敛为 catalog 单源）** |
| [`docs/ACCEPTANCE_REPORT_ROUND_10.md:6, 67-72`](file:///home/mat/Projects/mathslot-next/docs/ACCEPTANCE_REPORT_ROUND_10.md#L67-L72) | 声称“0 缺陷，各项指标 100% 完美达标…现代化 Zinc 调色板” | 查看 [`src/theme.rs:123`](file:///home/mat/Projects/mathslot-next/src/theme.rs#L123)，桌面旧栈写死 `ctx.set_theme(egui::ThemePreference::Dark)`，完全没有浅色主题与跟随系统切换能力，属于当时已知未实现的 §12.4 主题缺口 | **过度声称（仅实现单套暗色皮肤，并非完整主题与零缺陷）** |

---

## 5. 建议 `ADR-0028` 范围与允许修改路径（不写具体实现代码）

1. **建议 `ADR-0028` 目标**：围绕 `T3.4` 补齐 `D-116`、`D-117`、`D-118`、`D-119`，满足规范 §10.3 / §12.1–12.4 / `D-015` / `D-016` / `A-DATA-001` / `A-UI-001` / `A-UI-004` / `S-006` 契约，保持 `INV-001`、`INV-003`、`INV-004`、`INV-006`、`INV-014`。
2. **建议允许写入路径**：
   - `crates/mathslot-store/src/lib.rs`、`crates/mathslot-store/src/migrate.rs`、`crates/mathslot-store/tests/**`（扩展 `Settings` 字段 + `with_settings` 保存不丢失 + 兼容旧 v3 配置缺省反序列化）
   - `crates/mathslot-app/src/{app.rs, command.rs, event.rs, snapshot.rs, effect.rs}`、`crates/mathslot-app/tests/**`（接入设置状态、定界符包装导出、设置更新/重置契约）
   - `packages/ui/src/theme/tokens.css`（补齐 `[data-theme='light']` 作用域）
   - `packages/ui/src/client/engine.ts`、`packages/ui/src/index.ts`
   - `packages/ui/src/editor/{keymap.ts, MathSlotEditor.svelte}`（支持注入可配置快捷键表，保持 `Tab`/`Shift+Tab`/`Escape` 不锁死）
   - `packages/ui/src/preview/PreviewPanel.svelte`（`auto` 主题跟随系统暗色状态）
   - `packages/ui/src/settings/**`（新增 `SettingsPanel.svelte`、纯 TS 快捷键规范化/保留键冲突检测/定界符工具/恢复向导状态逻辑）
   - `packages/ui/tests/**`（新增 `settings.test.ts` 与扩展 `editor.test.ts` / `preview.test.ts` 失败回归测试）
3. **建议禁止修改路径**：
   - `packages/ui/src/generated/**`、`xtask/**`、`catalog/**`、`src/**`、`crates/mathslot-core/**`、`crates/mathslot-command/**`、`crates/mathslot-syntax/**`、`crates/mathslot-doc/**`、`scripts/agent/**`、`docs/**`、`agent-state/**`
4. **并行与前置建议**：
   - 严格按 TDD 先写 Rust 与 Vitest 失败测试再实现，并由独立 `verifier` 验收；
   - `T3.5` 启动前单独向用户请求或执行宿主机 Fedora `-devel` 包与 `tauri-cli` 安装核验，不混入 `T3.4` 提交。

# ADR-0035: T4.4 无障碍（`A-UI-001` / §12.2–§12.4）全链路修复与离线门禁边界

- **日期**：2026-11-15
- **Gate / Task**：`G4` / `T4.4`
- **状态**：Approved（待实现与独立验收）
- **依据审计**：`agent-state/audits/AUD-31.md`（覆盖新登记缺陷 `D-156`..`D-161`）

---

## 1. 上下文与阻塞事实

[AUD-31.md](../audits/AUD-31.md) 对当前 Desktop 与 Obsidian UI 的无障碍实现做了真实 Chromium（`chromium-1254`）键盘/焦点/ARIA/对比度/减弱动态偏好实查，判定 **BLOCK**：

1. **`D-156`（P1）**：Desktop 与 Obsidian 的 `ImportModal` / `SettingsPanel` 打开后未将焦点移入弹窗、`Tab`/`Shift+Tab` 可逃逸至弹窗后方主工作区；Obsidian `SettingsPanel` 缺少 `role="dialog"` / `aria-modal="true"` 且弹窗关闭后未归还焦点至触发元素；`SettingsPanel` 快捷键录入按 `Escape` 未调用 `event.stopPropagation()` 导致直接关闭整个设置弹窗（录入已绑定快捷键同理）；Desktop/Obsidian 按 `Escape` 关闭 `ImportModal` 绕过 `ImportModal.handleCancel()` 的 `ImportAcknowledge` 状态清理；二步确认按钮卸载后需保持合理焦点落点。
2. **`D-157`（P1）**：Desktop（`App.svelte`）与 Obsidian（`AppShell.svelte`）的隐藏配置导入 `<input type="file" class="ms-sr-only">` 未设 `tabindex="-1"` 与 `aria-hidden="true"`，在真实 `Tab` 键序中成为不可见无标签停靠点。
3. **`D-158`（P1）**：WCAG AA 对比度（`>= 4.5:1`）多处失败：
   - Obsidian Light：`--ms-status-warn-fg` / `--ms-badge-degraded-fg` / `--ms-slot-empty-fg`（`#d97706`，实测 `2.68:1`–`3.19:1`）、`--ms-status-error-fg`（`#dc2626`，`3.89:1` / `4.43:1`）、`--ms-status-success-fg` fallback（`#16a34a`，`2.82:1`–`3.30:1`）、`--ms-obs-fg-faint` fallback（`#64748b` on `#f4f5f7`，`4.36:1`）。
   - Desktop Light：`--ms-fg-subtle`（`#64748b`）在 `--ms-surface-elevated`（`#f1f5f9`）上仅 `4.34:1`。
   - CodeMirror `.cm-placeholder` 未覆盖默认 `#888888`，Desktop Light (`3.54:1`) 与 Obsidian Light/Dark (`3.25:1` / `4.13:1`) 均不达标。
4. **`D-159`（P2）**：`apps/obsidian/src/styles.css` `.ms-obsidian-btn` 缺失与共享组件一致的 `:focus-visible` 焦点环；全 UI 缺失 `@media (prefers-reduced-motion: reduce)` 支持。
5. **`D-160`（P2）**：`PalettePanel` 模式 `tablist` 与 `SettingsPanel` 三组 `radiogroup` 缺失方向键与漫游 `tabindex`；Live Region（`aria-live="polite"`）条件挂载导致首次播报可能丢失、Desktop Toast 在 `340px` 截断、Obsidian 缺失 `<h1>` 且错误通知未做语义区分、`MathSlotEditor.svelte` 在无 ARIA role 的 `div` 上放置 `aria-label` 且遗漏槽位计数。
6. **`D-161`（P2）**：离线环境未安装 `@axe-core/playwright` / `axe-core`（`NO_AXE_INSTALLED`），且现有 Vitest 与 Playwright E2E 未覆盖上述无障碍断言。

> 关于 `AUD-31.md` §4 盘点的 `acceptance.sh` WARN（冻结 `crates/mathslot-core/`、遗留 `src/devshot.rs` 及 `crates/mathslot-doc/src/document.rs` 3 处守卫 `.unwrap()`）：依据 `AGENTS.md` 硬规则 3（一轮一个任务，禁止跨范围顺手重构），**不在 `T4.4` 内修改 Rust 代码**，将在后续独立工具链/收口提交中处理。

---

## 2. 决策方案

### 2.1 离线 `axe-core` 边界决策（`D-161`）

- 保持全仓纯离线构建约束（不联网安装 `axe-core` 或 `@axe-core/playwright`）。
- 以 **Playwright 1.65.1 原生 `locator.ariaSnapshot()` + Vitest 组件测试 + E2E 运行时断言（焦点入焦/陷阱/归还、键盘 Tab 键序、`tablist`/`radiogroup` 方向键、WCAG 2.1 计算对比度 `>= 4.5:1`、`prefers-reduced-motion: reduce`）** 作为 `T4.4` 与 `A-UI-001` 的确定性离线自动化验收等价方案，并写入 `packages/ui/tests/` 与双端 Playwright E2E。

### 2.2 统一模态焦点管理与快捷键隔离（`D-156`）

1. **提取共享焦点管理辅助模块**（如 `packages/ui/src/a11y/focusTrap.ts`，遵循“禁止重复实现”原则，供 Desktop 与 Obsidian 共同复用）：
   - `captureRestoreFocus()` / `focusFirstInside(container, preferredSelector?)`：打开弹窗时记录先前 `document.activeElement`，等待 DOM 渲染就绪后将焦点移入弹窗内首个合法焦点元素（或 `autofocus` / 主操作 / 关闭按钮）。
   - `trapFocusKeydown(event, container)`：拦截弹窗内 `Tab` / `Shift+Tab`，将焦点循环限定在容器内可见、未禁用的可聚焦元素之间，杜绝逃逸到主工作区、CM6 或背景控件。
   - 关闭弹窗时把焦点精准归还给触发按钮（若仍连通于 DOM），否则安全回落到应用顶栏/编辑器焦点触发源。
2. **统一 `Escape` 与快捷键捕获隔离**：
   - `ImportModal.svelte`：通过 prop 或共享取消路径暴露关闭协调逻辑，确保无论点击关闭按钮还是按 `Escape` 关闭 `ImportModal`，都一致触发 `handleCancel()`（必要时发送 `ImportAcknowledge` 清理导入预览态）后再关闭并归还焦点。
   - `apps/obsidian/src/AppShell.svelte`：将 `<SettingsPanel>` 包裹在 `role="dialog" aria-modal="true" aria-labelledby="..."` 容器中（带可见标题与关闭按钮），接入共享焦点入焦/陷阱/归还。
   - `packages/ui/src/settings/SettingsPanel.svelte`：快捷键录入（`capturingAction === id`）时，`Escape` 与成功捕获的新组合键分支均必须调用 `event.stopPropagation()`（与 `event.preventDefault()`），阻止事件冒泡至 `window` 导致弹窗关闭或触发全局快捷键；二步确认（`settings-reset` / `recovery-reset`）取消或确认造成触发按钮卸载后，把焦点迁回至稳定的相邻/主动作按钮，不落入 `document.body`。

### 2.3 隐藏文件输入移出键盘序列（`D-157`）

- `apps/desktop/src/App.svelte`（`desktop-config-file-input`）与 `apps/obsidian/src/AppShell.svelte`（`obsidian-config-file-input`）的隐藏 `<input type="file" class="ms-sr-only">` 添加 `tabindex="-1"` 与 `aria-hidden="true"`，保留 `.click()` 程序触发能力，彻底从键盘 `Tab` 键序中移除。

### 2.4 WCAG AA `>= 4.5:1` 对比度与占位符修复（`D-158`）

- `packages/ui/src/theme/tokens.css`：
  - 将 Desktop Light `--ms-fg-subtle` 调整至在 `--ms-surface` 与 `--ms-surface-elevated`（`#f1f5f9`）上均满足 `>= 4.5:1`（同时检查默认与 Light fallback 一致性）。
  - 将 Obsidian 宿主映射中的 `--ms-status-warn-fg`、`--ms-status-error-fg`、`--ms-status-success-fg`、`--ms-badge-degraded-fg`、`--ms-slot-empty-fg` 及 fallback `--ms-obs-success` / `--ms-obs-fg-faint` 参考 Desktop 方案（通过 `color-mix(in srgb, var(--ms-fg) ..., ...)` 或深色高精度语义色 fallback），确保在 Light/Dark 默认主题及 tinted 背景上常规文本对比度全部 `>= 4.5:1`（`MathSlotEditor` / `PreviewPanel` / `DiagnosticsPanel` / `ImportModal` / `SettingsPanel` 一并覆盖）。
- `packages/ui/src/editor/MathSlotEditor.svelte`：为 `.cm-placeholder` 显式设置 `color: var(--ms-fg-muted); opacity: 1;`（替代 CM6 默认 `#888888`），确保 Light 与 Dark 下对比度均 `>= 4.5:1`。

### 2.5 焦点环与 Reduced Motion（`D-159`）

- `apps/obsidian/src/styles.css`：为 `.ms-obsidian-btn`（及宿主交互按钮）补充一致的 `:focus-visible { outline: 2px solid var(--ms-focus-ring); outline-offset: 2px; }`。
- 在共享样式（`packages/ui/src/theme/tokens.css` 及必要组件/宿主样式）添加 `@media (prefers-reduced-motion: reduce)` 规则，将过渡与动画时长降为 `0.01ms` / `none`（包括 `.ms-btn`、`.ms-command-card`、`.ms-nav-row`、Toast/弹窗等所有过渡元素）。

### 2.6 ARIA 键盘契约、常驻 Live Region 与语义完整（`D-160`）

- `packages/ui/src/palette/PalettePanel.svelte`：
  - 为模式 `tablist`（`commands` / `presets` / `snippets`）补齐漫游 `tabindex`（选中项 `0`、其余 `-1`）、`ArrowLeft`/`ArrowRight`/`Home`/`End` 键盘切换与 `aria-controls` 指向对应 `tabpanel`（可提取与分类 `tablist` 共享的方向键辅助）。
  - 搜索框 `aria-label` 随当前模式动态反映语义（不再在片段模式硬编码“搜索命令或预置”）。
- `packages/ui/src/settings/SettingsPanel.svelte`：
  - 为主题、渲染后端、定界符三组 `role="radiogroup"` 统一接入共享方向键（`ArrowLeft`/`ArrowRight`/`ArrowUp`/`ArrowDown` + 漫游 `tabindex` `0`/`-1`）。
- Live Region 与语义结构：
  - `apps/desktop/src/App.svelte` 与 `apps/obsidian/src/AppShell.svelte` 将 `role="status" aria-live="polite" aria-atomic="true"` 区域设为常驻 DOM 挂载（内容为空时保持在语义区），确保首次提示不被读屏器漏报。
  - Desktop `apps/desktop/src/styles.css` 放宽 `.ms-toast` 长文展示，允许自动换行不截断完整错误信息；且错误 toast 同时配语义错误标识。
  - Obsidian `apps/obsidian/src/AppShell.svelte` 与 `styles.css`：错误类通知使用显式错误图标与高对比度 `--ms-status-error-fg`（不与普通提示共用低对比 `muted`）；面板主标题使用 `<h1>` 并保持 `h1 -> h2 -> h3` 层级顺序。
  - `packages/ui/src/editor/MathSlotEditor.svelte`：修正无 role 的 `.ms-header-meta` `aria-label`（改用可读文本/合法语义标注，并补充槽位数量读屏可读性）。

---

## 3. 允许写入范围（严格限制）

实现者（`mathslot-implementer`）仅允许修改以下路径，且**只能产出一个原子提交**（commit message 含 `T4.4` 与 `D-156`..`D-161`）：

- `packages/ui/**`（新增 `src/a11y/` 与组件/样式/测试修复）
- `apps/desktop/**`（Desktop 壳、样式、Playwright E2E 测试）
- `apps/obsidian/**`（Obsidian 壳、样式、Playwright E2E 测试）
- `obsidian-mathslot/**`（**仅**执行 `node obsidian-mathslot/scripts/build.mjs` 重新打包产生的构建同步产物）

严禁修改：`crates/**`、`src/**`、`docs/LLM_IMPLEMENTATION_SPEC.md`、`scripts/agent/**`、`agent-state/**`。

---

## 4. 验收要求（对应独立 Verifier）

1. 先行失败测试（TDD）已覆写证明缺陷复现，修复后全过。
2. 全量门禁全绿：`cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace --offline`、`npm --prefix packages/ui test`、`npm --prefix packages/ui run check`、`npm --prefix apps/desktop test && npm --prefix apps/desktop run check && npm --prefix apps/desktop run build && npm --prefix apps/desktop run test:e2e`、`npm --prefix apps/obsidian test && npm --prefix apps/obsidian run check && npm --prefix apps/obsidian run build && npm --prefix apps/obsidian run test:e2e`、`node obsidian-mathslot/scripts/build.mjs`（零未跟踪漂移）。
3. 浏览器运行时 E2E 明确实测通过：
   - 仅键盘完成打开、输入、调色板模式/分类切换、导入弹窗预览/取消/确认、设置弹窗主题/后端/定界符 `radiogroup` 切换与快捷键捕获 `Escape` 隔离、焦点陷阱与关闭焦点归还；
   - 隐藏 `<input type="file">` 未被 `Tab` 命中；
   - Light & Dark 下实测关键语义文本与 `.cm-placeholder` 对比度 `>= 4.5:1`；
   - `reducedMotion: 'reduce'` 下过渡时长为 `0s`；
   - `ariaSnapshot()` 无障碍语义树检查通过，并保存桌面/Obsidian 无障碍状态截图供人工/coordinator 审查。
4. 代码规范复核：无新增任何硬编码 hex/rgb/rgba 颜色（`.svelte`/`.ts` 内必须使用 CSS 变量 token）、无 `let _ =`、无 `.unwrap()`。

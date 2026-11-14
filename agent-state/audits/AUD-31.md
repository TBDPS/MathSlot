---
id: AUD-31
round: 35
gate: G4
scope:
  - T4.4
  - A-UI-001
  - "§12.2"
  - "§12.3"
  - "§12.4"
  - "acceptance.sh WARN"
verdict: BLOCK
auditor: auditor
date: 2026-11-15
base_commit: 6c4f5d7
---

# AUD-31：Gate G4 / T4.4（无障碍审计 `A-UI-001` 与门禁 WARN 盘点）只读审计报告

## 1. 判定摘要

- **总体结论**：**`BLOCK`**（`T4.4` / `ADR-0035` 不可直接签收 `A-UI-001` 达标；实查发现 **3 项 P1** 与 **3 项 P2** 无障碍缺陷，涵盖模态焦点管理与快捷键穿透、隐藏 `<input type="file">` 抢占 Tab 焦点、WCAG AA 对比度实测不达标、Obsidian `:focus-visible` 与 `prefers-reduced-motion` 缺失、ARIA 键盘交互契约缺口及离线自动化 a11y 门禁缺失）。
- **离线 a11y 工具链检查**：
  - `axe-core` / `@axe-core/playwright`：**未离线安装**（`NO_AXE_INSTALLED`）。
  - `playwright` `1.65.1`（`apps/desktop/node_modules/playwright`）与本地缓存 Chromium `chromium-1254`（`/home/mat/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`）：**离线可用**，且 `locator.ariaSnapshot()` 实测可用（Desktop 195 行、Obsidian 174 行）。
- **新发现缺陷汇总（`D-156`..`D-161`）**：
  1. **`D-156`（P1）**：Desktop 与 Obsidian 弹窗/设置面板缺失初始焦点移入与 `Tab`/`Shift+Tab` 焦点陷阱，Obsidian 设置无 `role="dialog"` 且关闭弹窗不归还焦点；`SettingsPanel` 快捷键录入按 `Escape` 未 `stopPropagation()`，直接穿透关闭整个设置弹窗（§2.1）。
  2. **`D-157`（P1）**：Desktop 与 Obsidian 的隐藏配置导入 `<input type="file" class="ms-sr-only">` 保留 `tabIndex=0` 且无标签，实测在键盘 Tab 序列中成为不可见停靠点（§2.2）。
  3. **`D-158`（P1）**：WCAG AA 对比度实测不达标——Obsidian 浅色主题将 `--ms-status-warn-fg` / `--ms-badge-degraded-fg` / `--ms-slot-empty-fg` / `--ms-status-error-fg` / `--ms-status-success-fg` 直接映射为中亮语义色（实测 `2.68:1`–`4.43:1 < 4.5:1`），Desktop 浅色 `--ms-fg-subtle` 在 `--ms-surface-elevated` 上为 `4.34:1`，CodeMirror `.cm-placeholder` 默认 `#888888` 在双端浅色及 Obsidian 深色下仅 `3.25:1`–`4.13:1`（§2.3）。
  4. **`D-159`（P2）**：`apps/obsidian/src/styles.css` 按钮 `.ms-obsidian-btn` 缺失 `:focus-visible` 焦点环；全 UI 零 `@media (prefers-reduced-motion: reduce)` 覆盖（§2.4）。
  5. **`D-160`（P2）**：`PalettePanel` 模式 `tablist` 与 `SettingsPanel` 三组 `radiogroup` 缺失方向键/漫游 `tabindex`；条件挂载 `aria-live="polite"`、Desktop Toast 截断、Obsidian 缺少 `h1` 与错误状态配色区分、`MathSlotEditor` 无 role 元素使用 `aria-label`（§2.5）。
  6. **`D-161`（P2）**：缺少离线可运行的自动化 a11y 回归测试（Playwright `ariaSnapshot()` + 键盘陷阱/焦点归还 + 计算对比度断言）与离线 `axe-core` 决策记录（§2.6）。
- **G4 退出前 `acceptance.sh` WARN 盘点**：`9` 处 `let _ = `、`20` 处 `.unwrap()`、`3` 处 `*_ENTRIES` 均集中在遗留 `src/` 与冻结 `crates/mathslot-core/`（其中 `20` 处 `.unwrap()` 100% 位于 `#[cfg(test)]`）；另有不在当前 glob 内的 `crates/mathslot-doc/src/document.rs:651,824,847`（3 处守卫 `.unwrap()`）（§3）。

---

## 2. 实跑命令与运行时测量证据

| # | 检查项 | 命令 | Exit Code | 实测输出摘要 |
|---|---|---|---|---|
| 1 | 状态恢复基线 | `scripts/agent/resume.sh` | `0` | `gate=G4 round=35 active=T4.4 next=T4.4 head=6c4f5d7 dirty=0` |
| 2 | 门禁全量检查 | `scripts/agent/acceptance.sh` | `0` | `PASS=6 FAIL=0 WARN=3`（`let _ = 9`、`unwrap() 20`、`命令表常量 3`） |
| 3 | 离线 a11y 依赖核查 | `ls -la node_modules packages/*/node_modules apps/*/node_modules 2>/dev/null \| grep -i axe \|\| echo "NO_AXE_INSTALLED"` | `0` | `NO_AXE_INSTALLED`；`apps/desktop/node_modules/playwright` (`1.65.1`) 与 `chromium-1254` 离线可用 |
| 4 | CSS / ARIA 静态扫描 | `rg -n "prefers-reduced-motion\|focus-visible\|aria-modal\|aria-live\|role=\"dialog\"\|role='dialog'\|radiogroup\|aria-checked" packages/ apps/ \|\| true` | `0` | `prefers-reduced-motion` **0 命中**；`apps/obsidian/src/styles.css` 无 `:focus-visible` |
| 5 | Playwright 键盘与弹窗焦点实测（Desktop 4173 + Obsidian 4174） | `node --input-type=module -`（驱动真实 Chromium `chromium-1254` 访问 Vite 产物） | `0` | 见下表 5.1 逐项实测 |
| 6 | Playwright 对比度 / Reduced Motion / Modal Trap 实测 | `node --input-type=module -`（`reducedMotion: 'reduce'` + Light/Dark/Recovery 遍历） | `0` | 见 §2.3 & §2.4 实测值 |
| 7 | Python WCAG 2.1 精确对比度复算 | `python3 -`（按 `tokens.css` 与 `color-mix` 公式复算） | `0` | 精确复现并印证 Chromium 实测全部 `< 4.5:1` 组合 |
| 8 | `acceptance.sh` WARN 精确清单 | `rg -n 'let _ = ' src crates --glob '!target'` 等 3 条 `rg` | `0` | 见 §3 逐行清单 |

### 5.1 Playwright 键盘与 ARIA 运行时探针核心输出（Desktop vs Obsidian）

```json
"desktopRes": {
  "ariaSnapshotSupported": true,
  "ariaSnapshotLines": 195,
  "domAudit": {
    "headings": ["H1 MathSlot", "H2 流式公式编辑器", "H2 命令与预设面板", "H2 实时公式预览", "H2 槽位结构树 0", "H3 结构导航树", "H2 诊断与校验 0"],
    "hiddenFileTabbable": [{ "tag": "INPUT", "type": "file", "testid": "desktop-config-file-input", "className": "ms-sr-only", "tabIndex": 0, "hasLabel": false, "visible": true }]
  },
  "firstTabFocus": { "testid": "desktop-import-btn", "outlineStyle": "solid", "outlineWidth": "2px", "outlineColor": "rgb(37, 99, 235)" },
  "hitHiddenFileInputInTab": true,
  "paletteModeAfterArrowRight": { "activeMode": "commands", "selectedCommands": "true", "selectedPresets": "false" },
  "importModalOnOpenFocus": { "insideModal": false, "activeTag": "BUTTON", "activeTestid": "desktop-import-btn" },
  "importModalEscapedFocus": true,
  "importModalClosedByEsc": true,
  "importModalFocusRestoredToTrigger": true,
  "settingsHasDialogRole": true,
  "settingsOnOpenFocus": { "insideSettings": false, "activeTestid": "desktop-settings-btn" },
  "settingsRadiogroupArrowRightMoved": { "activeTestid": "theme-option-light", "darkChecked": "false" },
  "settingsStillOpenAfterCaptureEscape": false,
  "settingsFocusRestoredToTrigger": true
}
```

```json
"obsidianRes": {
  "ariaSnapshotSupported": true,
  "ariaSnapshotLines": 174,
  "domAudit": {
    "headings": ["H2 MathSlot"],
    "hiddenFileTabbable": [{ "tag": "INPUT", "type": "file", "testid": "obsidian-config-file-input", "className": "ms-sr-only", "tabIndex": 0, "hasLabel": false, "visible": true }]
  },
  "firstTabFocus": { "testid": "obsidian-nav-btn", "outlineStyle": "auto", "outlineWidth": "1px", "outlineColor": "rgb(16, 16, 16)" },
  "hitHiddenFileInputInTab": true,
  "paletteModeAfterArrowRight": { "activeMode": "commands", "selectedCommands": "true", "selectedPresets": "false" },
  "importModalOnOpenFocus": { "insideModal": false, "activeTag": "BUTTON", "activeTestid": "obsidian-import-btn" },
  "importModalEscapedFocus": true,
  "importModalClosedByEsc": true,
  "importModalFocusRestoredToTrigger": false,
  "settingsHasDialogRole": false,
  "settingsOnOpenFocus": { "insideSettings": false, "activeTestid": "obsidian-settings-btn" },
  "settingsRadiogroupArrowRightMoved": { "activeTestid": "theme-option-light", "darkChecked": "false" },
  "settingsStillOpenAfterCaptureEscape": false,
  "settingsFocusRestoredToTrigger": false
}
```

补充实测：`desktopSettingsModalEscapedShiftTab: true`（在 Desktop 设置弹窗关闭按钮按 `Shift+Tab` 直接逃出 `[role="dialog"]`）。

---

## 3. 新发现缺陷逐项证据（`D-156`..`D-161`）

### 3.1 `D-156`（P1）：弹窗/设置焦点管理、焦点陷阱缺失与快捷键录入 `Escape` 穿透

- **规范依据**：`docs/LLM_IMPLEMENTATION_SPEC.md` §12.2–§12.5（`A-UI-001`：打开、输入、导航、复制、导入、删除确认均可仅键盘完成；所有交互控件可 Tab 聚焦、可 Enter/Space 激活）。
- **代码位置**：
  - Desktop 弹窗开关与全局快捷键：`apps/desktop/src/App.svelte:205-223`、`308-348`、`683-738`
  - Obsidian 弹窗开关与全局快捷键：`apps/obsidian/src/AppShell.svelte:436-472`、`502-531`、`564-642`
  - 导入弹窗：`packages/ui/src/import/ImportModal.svelte:113-157`
  - 设置快捷键录入：`packages/ui/src/settings/SettingsPanel.svelte:184-203`
- **现象与复现**：
  1. **打开不入焦**：无论 Desktop 还是 Obsidian，通过键盘 `Enter` 打开 `ImportModal` 或 `SettingsPanel` 后，`document.activeElement` 仍停留在弹窗背后的触发按钮（`importModalOnOpenFocus.insideModal: false`、`settingsOnOpenFocus.insideSettings: false`）。
  2. **无焦点陷阱**：在 Desktop `ImportModal` / `SettingsModal` 及 Obsidian `ImportModal` 内连续按 `Tab` 或 `Shift+Tab`，焦点直接穿透至背后主工作区与隐藏 `<input type="file">`（`importModalEscapedFocus: true`、`desktopSettingsModalEscapedShiftTab: true`）。
  3. **Obsidian 设置无 dialog 语义且关闭不归还焦点**：`apps/obsidian/src/AppShell.svelte:564-612` 直接内联渲染 `<SettingsPanel>`，无 `role="dialog"` 与 `aria-modal="true"`（`settingsHasDialogRole: false`）；且 `AppShell.svelte:438-447, 608-610, 638-640` 未保存 `lastTriggerEl`，关闭 `ImportModal` 或 `SettingsPanel` 后焦点丢失（`importModalFocusRestoredToTrigger: false`、`settingsFocusRestoredToTrigger: false`）。
  4. **快捷键录入按 `Escape` 穿透关闭整个设置弹窗**：`SettingsPanel.svelte:192-196` 在 `capturingAction === id` 时拦截 `Escape` 仅调用 `event.preventDefault()` 而未调用 `event.stopPropagation()`，事件冒泡至 `window` 后触发 `App.svelte:315-319` / `AppShell.svelte:443-447`，实测直接销毁设置面板（`settingsStillOpenAfterCaptureEscape: false`）；按录入组合键时（`L197-202`）同理可能穿透触发全局 `open_settings` / `focus_editor`（`App.svelte:328-347`、`AppShell.svelte:456-471`）。
  5. **Desktop/Obsidian `Escape` 关闭 `ImportModal` 跳过 `ImportAcknowledge`**：`App.svelte:310-313` 与 `AppShell.svelte:438-441` 按 `Escape` 直接改布尔值关闭弹窗，未走 `ImportModal.svelte:113-128` 的 `handleCancel()` 清理状态。
- **补充核对**：设置页二步确认（`SettingsPanel.svelte:379-419, 679-717`，`settings-reset-trigger` -> `settings-reset-confirm` 与 `recovery-reset-trigger` -> `recovery-reset-confirm`）在标准 `<button>` 上，实测 `Enter` 键盘可达（`settingsTwoStepConfirmVisible: true`），但取消/确认后若原按钮卸载，应确保焦点落在合理控件而非回退 `<body>`。

### 3.2 `D-157`（P1）：隐藏文件 `<input type="file" class="ms-sr-only">` 占用 Tab 键序且无标签

- **代码位置**：
  - `apps/desktop/src/App.svelte:674-681`
  - `apps/obsidian/src/AppShell.svelte:555-562`
- **现象与复现**：两处用于程序化 `.click()` 触发文件选择器的 `<input type="file" class="ms-sr-only">` 仅做了视觉裁剪，未设置 `tabindex="-1"` 与 `aria-hidden="true"`（也无 `<label>`/`aria-label`）。
- **实测证据**：Playwright `Tab` 序列走查实测双端均命中 `hitHiddenFileInputInTab: true`（`tag: "INPUT", type: "file", tabIndex: 0, hasLabel: false`），在工具栏之后、编辑器之前凭空多出一个不可见且读屏无提示的焦点停靠点。

### 3.3 `D-158`（P1）：WCAG AA 对比度实测不达标（Obsidian 浅色语义色、Desktop 浅色 `--ms-fg-subtle`、CM6 placeholder）

- **规范依据**：`docs/LLM_IMPLEMENTATION_SPEC.md` §12.3（"颜色对比满足 WCAG AA"；常规文本 `>= 4.5:1`）。
- **代码位置**：
  - `packages/ui/src/theme/tokens.css:18, 280-281, 309, 331-374`
  - `packages/ui/src/editor/MathSlotEditor.svelte:158-188`
  - `apps/desktop/src/styles.css:71-79`
  - `packages/ui/src/palette/PalettePanel.svelte:528-532`
  - `packages/ui/src/nav/NavTreePanel.svelte:257-260, 290-293, 395-399`
- **实测与计算对比度证据**：

| 宿主 / 主题 | 元素 / Token 组合 | 前景色 | 背景色 | 实测 / 复算对比度 | WCAG AA (4.5:1) |
|---|---|---|---|---|---|
| Obsidian Light | `PreviewPanel` 降级徽章（`ms-degraded-badge`） | `rgb(217,119,6)` (`#d97706`) | `rgb(255,255,255)` / `color-mix 16%` | **`3.19:1`**（降级图标/文字）；`2.68:1`（`slot-empty`） | **FAIL** |
| Obsidian Light | `DiagnosticsPanel` 警告标签（`ms-diag-severity[warning]`） | `rgb(217,119,6)` | `rgb(244,245,247)` / `warn-bg 14%` | **`2.92:1`** / **`2.75:1`** | **FAIL** |
| Obsidian Light | `SettingsPanel` `有未保存更改`（`ms-state-pill-warn`） | `rgb(217,119,6)` | `rgb(255,255,255)` | **`3.19:1`** | **FAIL** |
| Obsidian Light | `ImportModal` 阻断横幅（`import-blocked-banner`） | `rgb(220,38,38)` (`#dc2626`) | `color(srgb 0.9808 0.8809 0.8809)` | **`3.89:1`** | **FAIL** |
| Obsidian Light | `SettingsPanel` `ms-btn-danger-outline` | `rgb(220,38,38)` | `rgb(244,245,247)` | **`4.43:1`** | **FAIL** |
| Obsidian Light | `--ms-obs-success` fallback（`#16a34a`）on `--ms-status-success-bg` | `#16a34a` | `color-mix 14%` | **`2.82:1`**（白底 `3.30:1`） | **FAIL** |
| Obsidian Light | `--ms-obs-fg-faint`（`#64748b`）on `--ms-obs-surface`（`#f4f5f7`） | `#64748b` | `#f4f5f7` | **`4.36:1`** | **FAIL** |
| Desktop Light | `--ms-fg-subtle`（`#64748b`）on `--ms-surface-elevated`（`#f1f5f9`）（`.ms-desktop-version`、`.ms-featured-title`） | `rgb(100,116,139)` | `rgb(241,245,249)` | **`4.34:1`** | **FAIL** |
| Desktop Light | CM6 `.cm-placeholder`（未覆盖默认 `#888888`） | `rgb(136,136,136)` | `rgb(255,255,255)` | **`3.54:1`** | **FAIL** |
| Obsidian Light / Dark | CM6 `.cm-placeholder`（默认 `#888888`） | `rgb(136,136,136)` | `rgb(244,245,247)` / `rgb(30,41,59)` | **`3.25:1`** / **`4.13:1`** | **FAIL** |

- **根因**：`tokens.css:333,349,353,357,364,373` 在 Obsidian 宿主下直接把语义前景色 `--ms-status-*-fg` / `--ms-slot-empty-fg` 设为中亮色 `--ms-obs-warning` / `--ms-obs-error` / `--ms-obs-success`，未像 Desktop（`tokens.css:42,58,62,66` 使用 `#713f12` / `#166534` / `#92400e` / `#991b1b`）那样与 `--ms-fg` 做深色混合；`MathSlotEditor.svelte:158-188` 未给 `.cm-placeholder` 设置 `color: var(--ms-fg-muted)`。

### 3.4 `D-159`（P2）：Obsidian 按钮缺失 `:focus-visible` 焦点环，全 UI 缺失 `prefers-reduced-motion`

- **代码位置**：
  - `apps/obsidian/src/styles.css:60-90`（对比 `apps/desktop/src/styles.css:168-171`）
  - `apps/desktop/src/styles.css:160`、`packages/ui/src/palette/PalettePanel.svelte:583`、`packages/ui/src/settings/SettingsPanel.svelte:1047,1298`
- **实测证据**：
  - Obsidian `.ms-obsidian-btn` 聚焦时计算样式为 `outlineStyle: "auto", outlineWidth: "1px", outlineColor: "rgb(16, 16, 16)"`（Light）与 `rgb(238, 238, 238)`（Dark），缺少与 Desktop 及共享组件一致的 `2px solid var(--ms-focus-ring)`；`PalettePanel.svelte:709-718` 亦漏掉 `.ms-mode-tab` 以外状态或 `NavTreePanel` 以外按钮的一致性风险需统一走 `:focus-visible` token。
  - 在 Playwright `reducedMotion: 'reduce'` 上下文中，`.ms-btn` 与 `.ms-command-card` 实测 `transitionDuration` 仍为 `"0.12s, 0.12s"`；全仓 `packages/` 与 `apps/` 无任何 `@media (prefers-reduced-motion: reduce)` 规则。

### 3.5 `D-160`（P2）：ARIA 键盘交互契约与读屏语义不完整

- **代码位置与实测证据**：
  1. **模式 `tablist` 缺方向键与漫游 `tabindex`**：`packages/ui/src/palette/PalettePanel.svelte:150-181` 的 `.ms-mode-tabs`（`role="tablist"`）三个 `role="tab"` 按钮无 `onkeydown`、`tabindex` 均为 `0`，也无 `aria-controls` 对应 `role="tabpanel"`；Playwright 实测聚焦 `命令目录 (121)` 按 `ArrowRight` 后 `activeMode` 仍为 `"commands"`（对比同文件 `L216-238` 的分类 tablist 已正确实现）。此外 `L192` 搜索框在 `snippets` 模式下仍固定 `aria-label="搜索命令或预置"`。
  2. **设置 `radiogroup` 缺方向键与漫游 `tabindex`**：`packages/ui/src/settings/SettingsPanel.svelte:431-446`（主题）、`456-483`（渲染后端）、`523-538`（定界符）三组 `role="radiogroup"` + `role="radio"` 无 `ArrowLeft`/`ArrowRight`/`ArrowUp`/`ArrowDown` 键盘切换与漫游 `tabindex`；Playwright 实测聚焦 `theme-option-light` 按 `ArrowRight` 后 `activeTestid` 仍为 `"theme-option-light"`、`darkChecked` 仍为 `"false"`。
  3. **Live Region 条件挂载与视觉/结构语义缺口**：
     - `apps/desktop/src/App.svelte:407-417` 与 `apps/obsidian/src/AppShell.svelte:551-553` 使用 `{#if toastMessage}` / `{#if statusNotice}` 在文本出现时才挂载 `role="status" aria-live="polite"` 容器，部分读屏器可能错过首次插入播报；Desktop Toast `styles.css:120-123` 在 `340px` 处截断长错误；Obsidian `AppShell.svelte:552` 错误通知与普通通知共用无语义的 `var(--ms-fg-muted)`；`AppShell.svelte:488` 直接以 `<h2>` 作为面板主标题而缺 `<h1>`。
     - `packages/ui/src/editor/MathSlotEditor.svelte:320` 在无 ARIA role 的 `<div class="ms-header-meta">` 上放 `aria-label={`文档行数 ${lineCount}`}`（同时遗漏槽位计数）。

### 3.6 `D-161`（P2）：缺少离线自动化无障碍回归测试与 `axe-core` 边界处理

- **事实**：`node_modules` 未离线安装 `axe-core` / `@axe-core/playwright`（`NO_AXE_INSTALLED`）；`packages/ui/tests/`、`apps/desktop/tests/e2e/desktop.spec.ts` 与 `apps/obsidian/tests/e2e/obsidian.spec.ts` 当前均未覆盖：
  - 模态入焦、焦点陷阱（`Tab`/`Shift+Tab`）、`Escape` 不穿透快捷键录入、关闭焦点归还；
  - 隐藏 `<input type="file">` 不可被 `Tab` 聚焦；
  - `PalettePanel` 模式 `tablist` 与 `SettingsPanel` `radiogroup` 方向键操作；
  - `ariaSnapshot()` 语义树快照与 Light/Dark 计算对比度 `>= 4.5:1` 检查。
- **说明**：在无法离线拉取 `axe-core` 的环境下，Playwright 1.65.1 原生 `locator.ariaSnapshot()` + 显式 DOM/对比度/键盘 E2E 断言完全可离线跑在 CI；是否需要额外接入 `axe-core` 离线 tarball 需由 coordinator/人工确认或记录在 ADR。

---

## 4. `scripts/agent/acceptance.sh` G4 收口前 WARN 精确盘点

执行 `scripts/agent/acceptance.sh`（exit 0）输出 `WARN=3`：`let _ = 9 处`、`unwrap() 20 处`、`命令表常量 3 处`。按 `acceptance.sh:108-110` 精确 `rg` 核查每一处归属：

### 4.1 `let _ = `（共 9 处）

| # | 文件:行号 | 所属层级 | 状态说明 |
|---|---|---|---|
| 1 | `src/devshot.rs:58` | 遗留 egui 二进制（`mathslot`） | 截图保存 `let _ = pixmap.save_png(&path);`（非 Tauri/Obsidian 活动路径） |
| 2 | `crates/mathslot-core/src/editor.rs:228` | 冻结对照 crate（`mathslot-core`） | `let _ = full_path.pop();` |
| 3–4 | `crates/mathslot-core/src/lib.rs:682, 953` | 冻结 crate `#[cfg(test)]` | 单元测试内部忽略返回值 |
| 5–9 | `crates/mathslot-core/tests/acceptance_tests.rs:271, 703, 712, 722, 727` | 冻结 crate 集成测试 | 测试代码内部忽略返回值 |

### 4.2 `.unwrap()`（`acceptance.sh` 范围内共 20 处 + 范围外 3 处）

| 范围 | 文件:行号 | 所属层级 | 状态说明 |
|---|---|---|---|
| 脚本扫描内（1 处） | `crates/mathslot-core/src/library.rs:1459` | 冻结 crate `#[cfg(test)]`（始于 `L1419`） | 测试断言 |
| 脚本扫描内（19 处） | `crates/mathslot-core/src/lib.rs:161, 168, 173, 205, 208, 237, 293, 305, 555, 574, 709, 717, 722, 766, 768, 770, 823, 982, 993` | 冻结 crate `#[cfg(test)]`（始于 `L44`） | 全为单元测试内部 `.unwrap()`，**非产品用户输入路径** |
| 脚本扫描外（3 处） | `crates/mathslot-doc/src/document.rs:651, 824, 847` | **活动核心 crate `mathslot-doc` 非测试代码** | 均紧邻 `if new_nodes.len() == 1` 守卫后调用 `new_nodes.into_iter().next().unwrap()`；虽不可达 panic，建议 G4 收口改用 `[single]` 解构或 `.ok_or(...)` 消除 |
| 脚本扫描外（测试） | `crates/mathslot-doc/tests/{doc_tests,history_intent_tests}.rs`、`crates/mathslot-app/tests/t3_6_import_and_presets_tests.rs` | 活动 crate 测试文件 | 仅测试代码 |

> 核查 `apps/desktop/src-tauri/src` 及活动库 `crates/mathslot-{command,syntax,latex,app,render,store,wasm}/src`：`let _ = ` 与 `.unwrap()` **均为 0 处**。

### 4.3 `const *_ENTRIES` 命令表常量（共 3 处）

| # | 文件:行号 | 所属层级 | 状态说明 |
|---|---|---|---|
| 1–3 | `crates/mathslot-core/src/command.rs:581, 831, 1140` | 冻结对照 crate（`mathslot-core`） | `RELATION_ENTRIES` / `GREEK_ENTRIES` / `SYMBOL_ENTRIES` 遗留 1 元素兼容存根；活动路径唯一命令表已收敛至 `catalog/commands.toml` -> `mathslot-command` |

---

## 5. 历史结论抽查（`independent-audit/SKILL.md` §3.3）

| 来源 | 历史声称 | 实测复核 | 结论 |
|---|---|---|---|
| `docs/AUDIT_ROUND_11_INLINE_WORKSPACE_AND_ZERO_MODAL.md:37` & `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:11, 23` | 声称焦点管理“PASSED”、全栈重构“100% 达标” | 当时仅针对 legacy egui；当前共享 Web UI 在真实 Chromium 下仍存在弹窗无焦点陷阱、快捷键录入 `Escape` 穿透、隐藏 `<input type="file">` 抢占 Tab、Obsidian 浅色对比度 `< 4.5:1` | **待修正（不成立）** |
| `agent-state/verify/VER-28.md:75` & `VER-29.md:100` | 将 `D-015 / A-UI-001` 标为 `PASS`（仅凭 CM6 `Tab` 逃逸 + `Mod+E` 回到编辑器） | CM6 `Tab` 逃逸与 `Mod+E` 本身确已工作，但完整 `A-UI-001`（弹窗焦点圈闭/归还、`radiogroup`/`tablist` 键盘导航、WCAG AA 对比度、隐藏文件输入框、Obsidian 焦点环）尚未达标 | **部分过时 / 完整 `A-UI-001` OPEN** |

---

## 6. 建议的下一步（不写实现方案）

1. **以 `ADR-0035` 推进 `T4.4` 修复（闭环 `D-156`..`D-161`）**：
   - 优先修复 P1：`D-156`（弹窗入焦、焦点陷阱、焦点归还、Obsidian `SettingsPanel` `role="dialog"` 化、`SettingsPanel` 快捷键录入 `stopPropagation()`、`Escape` 走 `handleCancel`）、`D-157`（隐藏 `<input type="file">` 移除 Tab 序列）、`D-158`（Obsidian 浅色语义前景与 `--ms-fg-subtle`、`.cm-placeholder` 全部满足 WCAG AA `>= 4.5:1`）。
   - 同步修复 P2：`D-159`（Obsidian `:focus-visible` 焦点环与全局 `prefers-reduced-motion: reduce`）、`D-160`（模式 `tablist` 与 `radiogroup` 方向键 + 漫游 `tabindex`、常驻 `aria-live` 与错误区分、Obsidian `h1`）、`D-161`（在 Desktop/Obsidian Playwright E2E 与 Vitest 中补齐离线无障碍断言与 `ariaSnapshot()` 回归测试，并在 ADR 中明确离线 `axe-core` 替代/处理边界）。
2. **在 Gate G4 退出前单独通过工具链 ADR 处置 `acceptance.sh` WARN**：明确排除冻结 `crates/mathslot-core/` / 遗留 `src/` 或 `#[cfg(test)]` 噪音，并建议清理 `crates/mathslot-doc/src/document.rs:651,824,847` 的 3 处守卫 `.unwrap()`。

---
id: VER-35
round: 35
task: T4.4
gate: G4
defects: [D-156, D-157, D-158, D-159, D-160, D-161]
acceptance: [A-UI-001]
base_commit: 86716a9
target_commit: 1ba096c
verdict: PASS
verifier: verifier
date: 2026-11-15
---

# VER-35：Gate G4 / Task `T4.4`（`A-UI-001`、`D-156`..`D-161`）独立只读验收报告

## 1. 结论

**`PASS`**。提交 `1ba096c`（基线 `86716a9..1ba096c`）严格限定在 `ADR-0035` §3 允许路径内，无代码/规则违规，全部离线 Rust/Vitest/svelte-check/Vite/Playwright E2E/插件打包门禁全绿，且逐条闭环 `AUD-31` 所列 `D-156`..`D-161`（含 4 张运行时截图目视核验）。

---

## 2. 作用域、提交规范与代码硬规则核查

### 2.1 提交与路径作用域
- `git log -2 --stat` / `git show --stat 1ba096c`：仅 1 个原子任务提交 `1ba096c7e4047c3e79d64caa2de4e76fd3bde5e0`，commit message 为：
  `feat(a11y): implement T4.4 shared focus trap, roving nav, WCAG AA tokens, and live regions (D-156 D-157 D-158 D-159 D-160 D-161)`
- `git diff --name-only 86716a9..1ba096c` 共 20 个文件，全部落在 `ADR-0035` §3 允许路径内：
  - `packages/ui/**`（`src/a11y/{focusTrap.ts,rovingNav.ts,index.ts}`、`src/index.ts`、`src/editor/MathSlotEditor.svelte`、`src/import/ImportModal.svelte`、`src/palette/PalettePanel.svelte`、`src/settings/SettingsPanel.svelte`、`src/theme/tokens.css`、`tests/a11y.test.ts`）
  - `apps/desktop/**`（`src/App.svelte`、`src/styles.css`、`tests/desktopUi.test.ts`、`tests/e2e/desktop.spec.ts`）
  - `apps/obsidian/**`（`src/AppShell.svelte`、`src/styles.css`、`tests/obsidian.test.ts`、`tests/e2e/obsidian.spec.ts`）
  - `obsidian-mathslot/**`（`main.js`、`styles.css` 构建同步产物）
- 未触碰 `crates/**`、`src/**`、`docs/LLM_IMPLEMENTATION_SPEC.md`、`scripts/agent/**`、`agent-state/**`。

### 2.2 代码质量与硬规则核查
| 检查项 | 命令 | 结果 |
|---|---|---|
| `.svelte`/`.ts` 无硬编码 hex/rgb/rgba、无 `let _ =`、无 `.unwrap()` | `git diff 86716a9..1ba096c -- 'packages/ui/src/**' 'apps/desktop/src/**' 'apps/obsidian/src/**' \| rg -n '^\+.*(#([0-9a-fA-F]{3,8})\b\|rgb\(\|rgba\(\|let _ =\|\.unwrap\()' \|\| echo "NO_MATCH"` | exit 0；仅 `tokens.css`（L1512/1520/1528/1537/1543）定义 CSS token 变量，`.svelte` 与 `.ts` **0 命中** |
| 共享 `a11y` 模块复用 | `rg -n "trapFocusKeydown\|handleRovingKeydown\|captureRestoreFocus\|restoreFocus\|focusFirstInside" packages/ui/src apps/desktop/src apps/obsidian/src` | exit 0；`ImportModal.svelte`、`PalettePanel.svelte`、`SettingsPanel.svelte`、`apps/desktop/src/App.svelte`、`apps/obsidian/src/AppShell.svelte` 均直接导入 `packages/ui/src/a11y/`，无双端复制粘贴 |
| 无删减/弱化既有测试 | `git diff 86716a9..1ba096c -- '*.test.ts' '*.spec.ts' \| rg -n '^-\s*(it\|test\|expect\|assert\|describe)' \|\| echo "NO_REMOVED_TESTS"` | exit 0；输出 `NO_REMOVED_TESTS` |

---

## 3. 本轮实跑门禁与输出摘要

| # | 命令 | Exit Code | 实测结果摘要 |
|---|---|---|---|
| 1 | `cargo fmt --check` | `0` | 格式检查通过 |
| 2 | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | 0 warnings / 0 errors |
| 3 | `cargo test --workspace --offline` | `0` | 全工作区测试 **269 passed, 0 failed, 0 ignored** |
| 4 | `npm --prefix packages/ui test` | `0` | Vitest：**9 test files passed, 53 passed**（含 `tests/a11y.test.ts` 6/6） |
| 5 | `npm --prefix packages/ui run check` | `0` | `svelte-check found 0 errors and 0 warnings` |
| 6 | `npm --prefix apps/desktop test` | `0` | Vitest：**1 test file passed, 7 passed** |
| 7 | `npm --prefix apps/desktop run check` | `0` | `svelte-check found 0 errors and 0 warnings` |
| 8 | `npm --prefix apps/desktop run build` | `0` | Vite 生产构建通过（441 modules，wasm `338.39 kB`） |
| 9 | `npm --prefix apps/desktop run test:e2e` | `0` | Playwright E2E：**8 passed (16.8s)** |
| 10 | `npm --prefix apps/obsidian test` | `0` | Vitest：**1 test file passed, 19 passed** |
| 11 | `npm --prefix apps/obsidian run check` | `0` | `svelte-check found 0 errors and 0 warnings` |
| 12 | `npm --prefix apps/obsidian run build` | `0` | Vite 生产构建通过（440 modules） |
| 13 | `npm --prefix apps/obsidian run test:e2e` | `0` | Playwright E2E：**7 passed (18.4s)** |
| 14 | `node obsidian-mathslot/scripts/build.mjs && git status --short` | `0` | `mathslot_wasm_bg.wasm` = `338391` B (`330.5 KB` raw / `119.5 KB` gzip <= 400 KB)，`obsidian-mathslot/main.js` 冒烟通过（3 commands, 121 catalog entries, 88/88 presets）；`git status --short` 输出为空（零构建漂移/未跟踪文件） |
| 15 | `scripts/agent/acceptance.sh` | `0` | `PASS=6 FAIL=0 WARN=3`（`wasm=338391B, mem1000=4980736B, parse_p95=0.453ms, render_p95=9.666ms`；3 项 WARN 为 `AUD-31` 已登记的遗留 `src/devshot.rs` 与冻结 `crates/mathslot-core/` 历史基线，按 `ADR-0035` §1 不在 `T4.4` 范围内） |
| 16 | `scripts/agent/audit_palette.py` | `0` | `扫描：12 张卡片，109 条子菜单命令`，`PASS：所有可映射卡片与命令目录一致` |

---

## 4. 逐条对照 `AUD-31`（`D-156`..`D-161`）与 `ADR-0035` 实证

| 缺陷 | 规范 / ADR 要求 | 代码实现与测试实证 | 判定 |
|---|---|---|---|
| **`D-156` (P1)** | 弹窗打开自动入焦、`Tab`/`Shift+Tab` 焦点陷阱、Obsidian 设置 `role="dialog" aria-modal="true"`、关闭归还焦点、`SettingsPanel` 快捷键捕获 `Escape`/组合键 `stopPropagation()` 不穿透、`Escape` 关闭 `ImportModal` 触发 `handleCancel()` / `ImportAcknowledge`、二步确认失焦处理 | - `packages/ui/src/a11y/focusTrap.ts:38-118` 提供共享 `captureRestoreFocus` / `restoreFocus` / `focusFirstInside` / `trapFocusKeydown`<br>- `ImportModal.svelte:55-75, 117-134, 167-185, 225` 挂载 `data-autofocus`、陷阱及 `cancel()` 暴露，Desktop `App.svelte:338-342` 与 Obsidian `AppShell.svelte:517-521` 按 `Escape` 均调用 `importModalRef.cancel()` 发送 `ImportAcknowledge` 并归还焦点<br>- `AppShell.svelte:726-735` 将 `SettingsPanel` 包裹在 `role="dialog" aria-modal="true" aria-labelledby="ms-obsidian-settings-heading"`，Desktop `App.svelte:226-250, 745-754` 与 Obsidian `AppShell.svelte:121-148, 485-514` 共用焦点入焦/陷阱/归还<br>- `SettingsPanel.svelte:205-226` 在 `capturingAction === id` 时对 `Escape` 与成功捕获组合键均执行 `event.preventDefault(); event.stopPropagation();`<br>- `SettingsPanel.svelte:80-94, 293, 298, 433, 461, 769, 796` 处理二步确认及恢复面板卸载后的焦点落点<br>- `a11y.test.ts`、`desktopUi.test.ts`、`obsidian.test.ts`、`desktop.spec.ts`、`obsidian.spec.ts` 全项实测通过 | **PASS** |
| **`D-157` (P1)** | 双端隐藏 `<input type="file">` 均设 `tabindex="-1"` 与 `aria-hidden="true"` 且 `Tab` 不可达 | - `apps/desktop/src/App.svelte:718-719` & `apps/obsidian/src/AppShell.svelte:676-677` 均添加 `tabindex="-1"` 与 `aria-hidden="true"`<br>- `desktop.spec.ts:557-571`（20 次 `Tab` 扫描）、`obsidian.spec.ts:382-387` 及双端 Vitest 均验证通过 | **PASS** |
| **`D-158` (P1)** | Obsidian Light 语义前景色、Desktop Light `--ms-fg-subtle`、CM6 `.cm-placeholder` 在 Light/Dark 实测对比度 `>= 4.5:1` | - `tokens.css:18` 将 `--ms-fg-subtle` 调深为 `#525e70`；`L278, 283` 将 Obsidian Light fallback `--ms-obs-fallback-fg-faint` / `--ms-obs-fallback-success` 调深为 `#525e6e` / `#15803d`；`L335, 351, 355, 359, 366, 375` 使用 `color-mix(in srgb, var(--ms-obs-*) 45%/50%, var(--ms-obs-fg))` 自适应 Light/Dark；`MathSlotEditor.svelte:182-185` 覆写 `.cm-placeholder { color: var(--ms-fg-muted); opacity: 1; }`<br>- Python WCAG 2.1 精确复算：Desktop Light `--ms-fg-subtle` on `--ms-surface-elevated` = **`6.0:1`**、`.cm-placeholder` = **`7.58:1`**；Obsidian Light `--ms-status-warn-fg` on bg / 14% = **`7.82:1` / `6.73:1`**、`--ms-badge-degraded-fg` on 16% = **`6.59:1`**、`--ms-status-error-fg` on bg / 14% = **`9.69:1` / `7.79:1`**、`--ms-status-success-fg` on bg / 14% = **`9.78:1` / `8.09:1`**、`--ms-obs-fallback-fg-faint` on `--ms-obs-surface` = **`6.04:1`**、`.cm-placeholder` = **`6.11:1`**<br>- Desktop E2E（Light）与 Obsidian E2E（Light + Dark）运行时 DOM `getComputedStyle` 复算断言全部 `>= 4.5:1` 通过 | **PASS** |
| **`D-159` (P2)** | Obsidian `.ms-obsidian-btn:focus-visible` 2px 焦点环、全 UI `@media (prefers-reduced-motion: reduce)` | - `apps/obsidian/src/styles.css:80-83` 定义 `.ms-obsidian-btn:focus-visible { outline: 2px solid var(--ms-focus-ring); outline-offset: 2px; }`，`obsidian.spec.ts:395-400` 实测 `outlineStyle === 'solid'`、`outlineWidth === '2px'`<br>- `tokens.css:413-445` 覆盖 Desktop、Obsidian 与全共享 UI 组件 `@media (prefers-reduced-motion: reduce)`，Desktop E2E（L746-756）与 Obsidian E2E（L557-562）在 `reducedMotion: 'reduce'` 下实测 `.ms-btn` / `.ms-command-card` `transitionDuration === '0s'` | **PASS** |
| **`D-160` (P2)** | `PalettePanel` 模式 `tablist` 与 `SettingsPanel` 三组 `radiogroup` 方向键 + 漫游 `tabindex` + `aria-controls` + 动态搜索 label、常驻 `role="status" aria-live="polite"`、Desktop Toast 不截断、Obsidian `<h1>` 与错误区分、`MathSlotEditor` header-meta 语义与槽位计数 | - `PalettePanel.svelte:98-124, 156-214, 236-241` 实现共享 `handleRovingKeydown`、漫游 `tabindex`、`aria-controls="ms-palette-tabpanel"` 与按模式动态更新搜索 `aria-label`<br>- `SettingsPanel.svelte:228-240, 480-606` 为主题、渲染后端、定界符三组 `radiogroup` 接入漫游 `tabindex` 与 `handleRadioGroupKeydown`<br>- Desktop `App.svelte:437-456` 与 Obsidian `AppShell.svelte:651-669` 常驻挂载 `role="status" aria-live="polite" aria-atomic="true"` 并区分 Error/Warning；Desktop `styles.css:113-136` 放宽至 `480px` 自动换行不截断；Obsidian `AppShell.svelte:576` 使用 `<h1>MathSlot</h1>` 且 `styles.css:111-125` 对 `Warning`/`Error` 赋予高对比语义色与图标<br>- `MathSlotEditor.svelte:324-327` 移除无 role div 的 `aria-label`，保留 `{lineCount} 行` 与 `{activeSnapshot.slots.length} 槽位` | **PASS** |
| **`D-161` (P2)** | 离线 `ariaSnapshot()`、键盘流、焦点陷阱、对比度、`reduced-motion` 测试全量落地且符合 `ADR-0035` §2.1 边界 | - 按 `ADR-0035` §2.1 保持零联网，在 `packages/ui/tests/a11y.test.ts`（6 tests）、`apps/desktop/tests/desktopUi.test.ts`、`apps/obsidian/tests/obsidian.test.ts` 及双端 Playwright E2E（含 `toMatchAriaSnapshot()`、键盘全流程、焦点陷阱/归还、WCAG AA 对比度计算、`reducedMotion: 'reduce'`）全面覆盖并实跑通过 | **PASS** |

---

## 5. 运行时截图核验

已使用 `read_file` 逐张打开并审查 `/home/mat/.gemini/antigravity-cli/brain/fe474c7c-9101-4050-b920-b60ad941b3e9/scratch/t4-4/*.png`：

1. `desktop-a11y-dark-settings-focus.png`：Desktop Dark 设置模态框聚焦清晰，深色控件/输入框/恢复默认红色按钮对比度充足，无文字截断或溢出。
2. `desktop-a11y-light-import-modal.png`：Desktop Light `ImportModal` 展示 `\frac{1}{` 阻断横幅与 `ERROR UNCLOSED_DELIMITER` 诊断卡片，文字与边框对比度清晰，底部按钮禁用/启用状态明确。
3. `obsidian-a11y-dark-palette-focus.png`：Obsidian Dark 主工作区顶栏、常驻状态条（`设置已保存`）、编辑区 `1 行 0 槽位` 与 `.cm-placeholder` 清晰可读，`命令目录 (121)` 呈现清晰 `2px` 焦点环。
4. `obsidian-a11y-light-settings-dialog.png`：Obsidian Light 设置以居中 `role="dialog"` 遮罩模态框呈现，右上角 `有未保存更改` 琥珀深色文字对比度高、`关闭` 按钮带完整焦点环，后方错误通知栏亦带有 `!` 错误徽标与红色高对比度样式，无裁切或遮挡异常。

---

## 6. 未验证/备注

- 本轮仅执行 `T4.4` 独立验收，未修改产品代码或 `agent-state/state.json`（由 coordinator 依据本报告更新状态）。
- `scripts/agent/acceptance.sh` 尚余 3 项既有的 `WARN`（遗留 `src/devshot.rs` 与冻结 `crates/mathslot-core/` 中的 `let _ =` 9 处、`.unwrap()` 20 处、`*_ENTRIES` 3 处），已在 `AUD-31` §4 与 `ADR-0035` §1 明确归属为独立工具链/G4 收口清理项，非 `T4.4` 阻塞。

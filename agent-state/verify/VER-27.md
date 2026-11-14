---
id: VER-27
round: 27
task: T3.6
commit: 3a22824 (combined with ec9de58)
defects: [D-120, D-121, D-122, D-123, D-124, D-125, D-126, D-017, D-021]
verdict: PASS
verifier: mathslot-verifier
date: 2026-11-14
---

# 独立验收报告 VER-27：Gate G3 / `T3.6` 复验（`ec9de58` + `3a22824`）

## 1. 结论

**`PASS`**。Round 27 修复提交 `3a22824c88c64c9072ad82f07e833c36473edea9`（与 Round 26 基线提交 `ec9de588873e273eb2be2cdc081123654de3264a` 共同构成 `T3.6`）已关闭 [`agent-state/verify/VER-26.md`](file:///home/mat/Projects/mathslot-next/agent-state/verify/VER-26.md) 指出的 `D-124` / `A-OBS-001` CSS 令牌断链阻断缺陷，并同步补齐了 `registerMarkdownCodeBlockProcessor('mathslot', ...)` 宿主适配器复用与 `recovery-restore-btn` UI 端到端恢复测试；全部 9 项独立门禁命令均实测通过（exit `0`），工作区保持干净。

---

## 2. 提交范围与卫生扫描

### 2.1 提交与工作区状态
- **最新提交**：`3a22824c88c64c9072ad82f07e833c36473edea9`
- **Commit Message**：`fix(obsidian): T3.6 D-124 D-121 D-122 align --ms-* CSS tokens and codeblock host render adapter`
  - 包含任务号 `T3.6` 与缺陷号 `D-124 D-121 D-122`（无方括号）。
- **`git show --stat 3a22824`**（exit `0`）：
  - [`apps/obsidian/src/plugin.ts`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/plugin.ts) (`+69 / -13`)
  - [`apps/obsidian/src/styles.css`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/styles.css) (`+11 / -11`)
  - [`apps/obsidian/tests/obsidian.test.ts`](file:///home/mat/Projects/mathslot-next/apps/obsidian/tests/obsidian.test.ts) (`+207 / -0`)
  - [`obsidian-mathslot/main.js`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/main.js) (`+1 / -1`)
  - [`obsidian-mathslot/styles.css`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/styles.css) (`+1 / -1`)
  - 合计：5 files changed, 286 insertions(+), 29 deletions(-)，全部位于 [`ADR-0029`](file:///home/mat/Projects/mathslot-next/agent-state/decisions/ADR-0029-t3-6-obsidian-shell-wasm-bindgen-and-shared-ui.md) §1 允许路径内。
- **`git status --short`**：在执行 `node obsidian-mathslot/scripts/build.mjs` 与全部测试前后均为空（0 个未提交改动）。

### 2.2 禁用模式扫描
- `git show 3a22824 -- apps/obsidian/ | rg -n '^\+.*(#[0-9a-fA-F]{3,8}|rgba?\(|let _\s*=|\.unwrap\(|#\[ignore|#\[allow|\.skip\(|test\.skip|it\.skip|@tauri-apps/api)'`（exit `0`）：
  - 仅 1 行注释命中 `rgba?\(`（[`apps/obsidian/tests/obsidian.test.ts:377`](file:///home/mat/Projects/mathslot-next/apps/obsidian/tests/obsidian.test.ts#L377) `// Zero hardcoded hex or rgba() colors in apps/obsidian/src/styles.css`）；产品代码与测试断言中 0 处硬编码 hex/`rgba(`、`.skip`、`#[ignore]`、`let _ =`、`unwrap()` 或 `@tauri-apps/api`。
- `rg -n 'let _\s*=|\.unwrap\(|#\[ignore|#\[allow|\.skip\(|test\.skip|it\.skip|unsafe|@tauri-apps/api|mathslot-core' apps/obsidian/`（exit `0`）：输出 `NO_FORBIDDEN_IN_APPS_OBSIDIAN`（0 命中）。

---

## 3. VER-26 阻断项与观察项关闭核验

| 项 | 核验内容 | 文件与行号证据 | 判定 |
|---|---|---|---|
| **VER-26 阻断项：`D-124` / `A-OBS-001` CSS 令牌对齐** | `apps/obsidian/src/styles.css` 替换全部 5 个未定义令牌（`--ms-text` → `--ms-fg`、`--ms-text-muted` → `--ms-fg-muted`、`--ms-surface-2` → `--ms-surface-elevated`、`--ms-on-accent` → `--ms-accent-contrast`、`--ms-warn` → `--ms-badge-degraded-{border,fg,bg}`），并与 `tokens.css` 完全一致 | [`apps/obsidian/src/styles.css:11,38,48-49,69,77,83,93,133-135`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/styles.css#L11)；[`packages/ui/src/theme/tokens.css:274-285,343-345`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L274-L285)；Python 校验输出：`apps/obsidian/src/styles.css: total_refs=13, missing_all=[], missing_no_fallback=[]`；`obsidian-mathslot/styles.css: total_refs=71, missing_all=['--ms-nav-max-height', '--ms-palette-max-height', '--ms-tree-depth'], missing_no_fallback=[]`（该 3 项分别带回退值 `320px` / `360px` / `0`，由 `NavTreePanel.svelte` 与 `PalettePanel.svelte` 内联注入）；`rg -n -- "--ms-(text\|text-muted\|surface-2\|on-accent\|warn)\b" apps/obsidian/ obsidian-mathslot/styles.css` → `ZERO_UNDEFINED_VARS` | **PASS** |
| **VER-26 观察项：`D-121` / `OPEN-002` 代码块阅读视图适配器** | `registerMarkdownCodeBlockProcessor('mathslot', ...)` 动态检测 `document.body.classList.contains('theme-dark')`，设置 `[data-host="obsidian"]` 与 `[data-theme]`，复用 `createObsidianHostRenderAdapter`（带 `<mjx-merror>` 静默错误检测、降级 SVG 与 `.ms-obsidian-degraded-badge`），清理 `<script>`/`on*=` 属性，并在 `onunload()` 调用 `this.codeBlockRenderer?.dispose()` | [`apps/obsidian/src/plugin.ts:34-45,73-86,207-266`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/plugin.ts#L34-L45)；[`apps/obsidian/src/hostRenderAdapter.ts:22-61`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/hostRenderAdapter.ts#L22-L61) | **PASS** |
| **VER-26 观察项：`D-122` / `A-OBS-002` “从最近备份恢复”按钮测试** | `obsidian.test.ts` 新增 3 个测试：CSS 令牌全量对照与零硬编码色值；点击 `[data-testid="recovery-restore-btn"]`（“从最近备份恢复”）恢复 `data.libraryJson`、保留 `data.backupJson` 且清空 `snapshot.recovery`；暗色主题下代码块处理器对 `<mjx-merror>` 与抛出异常的降级渲染 | [`apps/obsidian/tests/obsidian.test.ts:355-502`](file:///home/mat/Projects/mathslot-next/apps/obsidian/tests/obsidian.test.ts#L355-L502) | **PASS** |

---

## 4. 独立门禁命令执行记录

| # | 命令 | 退出码 | 实测关键输出 |
|---|---|---|---|
| 1 | `cargo fmt --check` | `0` | 无格式差异 |
| 2 | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished dev profile [optimized + debuginfo] target(s) in 0.23s` |
| 3 | `cargo test --workspace --offline` | `0` | 56 个测试集合计 **`241 passed; 0 failed; 0 ignored`** |
| 4 | `cargo run -p xtask -- check --offline` | `0` | `[xtask] Check PASSED: All 6 artifacts are up-to-date and clean.` |
| 5 | `python3 scripts/agent/audit_palette.py` | `0` | `PASS：所有可映射卡片与命令目录一致` |
| 6 | `cd packages/ui && npm test && npm run check && npm run build` | `0` | `vitest run`: `Test Files 7 passed (7)` / `Tests 29 passed (29)`；`svelte-check`: `0 errors and 0 warnings`；`vite build`: `dist/index.css 46.85 kB │ gzip: 6.61 kB`, `dist/index.js 2,581.02 kB │ gzip: 778.48 kB` |
| 7 | `node obsidian-mathslot/scripts/build.mjs` | `0` | `cargo release wasm size: 492.7 KB (504569 bytes)`；`wasm-bindgen 0.2.130`: `452.6 KB raw / 159.8 KB gzip`；`dist/styles.css 49.32 kB │ gzip: 6.98 kB`；`dist/main.js 3,480.30 kB │ gzip: 1,214.75 kB`；Node 冒烟：`✓ Obsidian plugin built and verified successfully: obsidian-mathslot/main.js (3 commands, 121 catalog entries, 88/88 presets)` |
| 8 | `cd apps/obsidian && npm test && npm run check` | `0` | `vitest run`: `Test Files 1 passed (1)` / `Tests 10 passed (10)`；`svelte-check`: `0 errors and 0 warnings` |
| 9 | `scripts/agent/acceptance.sh` | `0` | `PASS=5 FAIL=0 WARN=3` / `结论：PASS`（WARN 均为基线既有项：`let _ =` 14、`unwrap()` 20、命令表常量 3，计划于 G4 前清零） |

---

## 5. 未验证项与非阻断风险

1. **真实 Obsidian Electron 桌面端与移动端真机（iOS / Android）**：当前宿主机无 Obsidian Electron 窗口与移动真机环境，真机剪贴板权限、移动端软键盘弹出后的视口/滚动行为及实际 Obsidian 主题插件（如 Minimal/Default）下的实时像素渲染尚未在真机侧载走查（当前基于 JSDOM + Node + 真实 `mathslot_wasm_bg.wasm` 验证）；该项需留待 `G4` 终验手动侧载走查覆盖。
2. **WASM 未经 `wasm-opt` 二次压缩（`§11.1` 400 KB raw 目标）**：宿主机未安装 `wasm-opt`，`wasm-bindgen` 输出为 `452.6 KB raw`（gzip 后 `159.8 KB`），构建脚本亦提示 `strip = true` 移除了 `target_features` custom section；当前非阻断，后续 CI / `G4` 可按需接入 `wasm-opt` 并观察体积。

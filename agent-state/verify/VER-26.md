---
id: VER-26
round: 26
task: T3.6
commit: ec9de58
defects: [D-120, D-121, D-122, D-123, D-124, D-125, D-126, D-017, D-021]
verdict: FAIL
verifier: mathslot-verifier
date: 2026-11-14
---

# 独立验收报告 VER-26：Gate G3 / `T3.6`（`apps/obsidian` 壳 + 共享 `packages/ui` + `crates/mathslot-wasm`）

## 1. 结论

**`FAIL`**。提交 `ec9de588873e273eb2be2cdc081123654de3264a` 严格限定在 `ADR-0029` §1 允许路径内，工作区干净，Rust / WASM / 前端全部测试与构建门禁均通过，但 **`D-124` / `A-OBS-001` 存在主题令牌断链缺陷且现有测试未测到**：[`apps/obsidian/src/styles.css`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/styles.css#L11)（及打包生成的 [`obsidian-mathslot/styles.css`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/styles.css)）引用了 5 个在 [`packages/ui/src/theme/tokens.css`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L265-L348) 中**从未定义**的 CSS 变量（`--ms-text`、`--ms-text-muted`、`--ms-surface-2`、`--ms-on-accent`、`--ms-warn`）且无回退值，导致主操作按钮（`.ms-obsidian-btn.is-primary`）、普通按钮（`.ms-obsidian-btn`）、宿主容器文字与降级徽章（`.ms-obsidian-degraded-badge`）无法跟随 Obsidian 主题变量（`--text-normal`、`--text-on-accent`、`--text-muted`、`--text-warning`）。

---

## 2. Diff 与规范扫描

### 2.1 提交范围与工作区状态
- 命令：`git status --short && git log -1 --format=%B ec9de58 && git show --stat ec9de58`（exit `0`）
- Commit Message：`feat(obsidian,wasm,ui): implement T3.6 shared UI Obsidian shell and wasm-bindgen Engine (D-120 D-121 D-122 D-123 D-124 D-125 D-126 D-017 D-021)`
  - 含 `T3.6` 与 `D-120 D-121 D-122 D-123 D-124 D-125 D-126 D-017 D-021`（无方括号）。
- 工作区状态：`git status --short` 输出为空（0 个未提交改动；运行 `node obsidian-mathslot/scripts/build.mjs` 与全部测试后仍保持干净）。
- 变更文件（55 files, 3561 insertions, 5060 deletions），全部在 `ADR-0029` §1 允许路径内；禁止路径扫描命令：
  ```bash
  git show --name-only --format="" ec9de58 | rg '^(xtask/|catalog/commands\.toml|src/|crates/mathslot-core/|crates/mathslot-command/|crates/mathslot-syntax/|crates/mathslot-doc/|crates/mathslot-store/src/(lib|paths|error)\.rs|scripts/agent/|docs/|agent-state/)' || echo "NO_FORBIDDEN_PATHS"
  ```
  输出：`NO_FORBIDDEN_PATHS`（0 命中）。
- [`crates/mathslot-store/tests/data_safety_tests.rs:584-585`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/tests/data_safety_tests.rs#L584-L585) 完整保留 `assert_eq!(report.stripped_builtin_count, 87)` 与 `assert_eq!(report.converted_override_count, 1)`，未弱化既有数据安全断言；仅在 [`crates/mathslot-store/tests/data_safety_tests.rs:183-197`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/tests/data_safety_tests.rs#L183-L197) 对 `D-126` 修复的 3 条预置做显式新/旧源串对照。

### 2.2 禁用模式与边界扫描
- `git diff ec9de58~1..ec9de58 -- ':(exclude)obsidian-mathslot/main.js' ':(exclude)obsidian-mathslot/src/plugin.js' | rg -n '^\+.*(let _\s*=|\.unwrap\(|#\[ignore|#\[allow|\.skip\(|test\.skip|it\.skip|unsafe|@tauri-apps/api|mathslot-core)' || true`（exit `0`）→ 仅命中 `crates/mathslot-wasm/src/lib.rs` 的 `+#![forbid(unsafe_code)]`；其余 0 命中。
- `rg -n 'let _\s*=|\.unwrap\(|#\[ignore|#\[allow|\.skip\(|test\.skip|it\.skip|unsafe|@tauri-apps/api|mathslot-core' crates/mathslot-wasm/ crates/mathslot-app/src/ crates/mathslot-app/tests/t3_6_import_and_presets_tests.rs apps/obsidian/ packages/ui/src/ packages/ui/tests/ || true`（exit `0`）→ 仅命中 `crates/mathslot-wasm/src/lib.rs:1:#![forbid(unsafe_code)]` 与 `crates/mathslot-app/src/lib.rs:1:#![forbid(unsafe_code)]`。
- `rg -n '#[0-9a-fA-F]{3,8}|rgba?\(' apps/obsidian/src/ packages/ui/src/ --glob '!**/generated/**' --glob '!**/theme/tokens.css' || true`（exit `0`）→ 仅命中 Svelte `{#each ...}` 与 HTML 实体 `&#123;`/`&#125;`（0 处硬编码色值）。
- **CSS 变量对照扫描**：
  ```python
  # 校验 packages/ui/src/**/*.svelte 与 apps/obsidian/src/**/* 中的 var(--ms-*) 是否在 tokens.css 中定义
  ```
  输出：
  ```text
  apps/obsidian/src/styles.css MISSING: ['--ms-on-accent', '--ms-surface-2', '--ms-text', '--ms-text-muted', '--ms-warn']
  packages/ui/src/nav/NavTreePanel.svelte MISSING: ['--ms-nav-max-height', '--ms-tree-depth']
  packages/ui/src/palette/PalettePanel.svelte MISSING: ['--ms-palette-max-height']
  ```
  其中 `NavTreePanel.svelte`（`:166,185,301,331`）与 `PalettePanel.svelte`（`:480`）均通过内联 `style` 注入并带有 CSS 回退值；而 [`apps/obsidian/src/styles.css`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/styles.css#L11) 中的 5 个 `--ms-*` 变量全仓库未定义（`rg -n -- "--ms-(text|text-muted|surface-2|on-accent|warn):" packages/ apps/` → `NOT_DEFINED_ANYWHERE`）且均无回退值。

---

## 3. 契约逐项核验（行级证据）

| 编号 | 契约要求 | 代码与测试证据（`file:line`） | 判定 |
|---|---|---|---|
| **D-120 / D-021 / INV-011 / OPEN-003** | `crates/mathslot-wasm` `#![forbid(unsafe_code)]`、移除 `mathslot-core` 与手写 C ABI、暴露 `#[wasm_bindgen]` `Engine` + `engineVersion()`；`mathslot-render` `latex-rust-backend` feature 隔离 | [`crates/mathslot-wasm/Cargo.toml:12-17`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/Cargo.toml#L12-L17)；[`crates/mathslot-wasm/src/lib.rs:1,34-148`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/src/lib.rs#L1)；[`crates/mathslot-render/Cargo.toml:9-15`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/Cargo.toml#L9-L15)；[`crates/mathslot-render/src/lib.rs:7-19`](file:///home/mat/Projects/mathslot-next/crates/mathslot-render/src/lib.rs#L7-L19)；[`crates/mathslot-app/Cargo.toml:13`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/Cargo.toml#L13)；[`crates/mathslot-wasm/tests/t3_6_wasm_bindgen_tests.rs:5-70`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/tests/t3_6_wasm_bindgen_tests.rs#L5-L70) | PASS（注：见 §5 体积说明） |
| **D-123 / A-OBS-005** | `ImportLatex` 调用 `convert_latex_with_report`、暴露 `ImportReportSnapshot`、`Error` 阻断 `Edit::ReplaceAll`；`ImportModal.svelte` UI 展示报告与阻断横幅 | [`crates/mathslot-app/src/app.rs:391-452`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L391-L452)；[`crates/mathslot-app/src/snapshot.rs:177-185,349-350`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/snapshot.rs#L177-L185)；[`crates/mathslot-app/tests/t3_6_import_and_presets_tests.rs:4-98`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/t3_6_import_and_presets_tests.rs#L4-L98)；[`packages/ui/src/import/ImportModal.svelte:147-208`](file:///home/mat/Projects/mathslot-next/packages/ui/src/import/ImportModal.svelte#L147-L208)；[`packages/ui/tests/importModal.test.ts:48-156`](file:///home/mat/Projects/mathslot-next/packages/ui/tests/importModal.test.ts#L48-L156)；[`apps/obsidian/tests/obsidian.test.ts:238-273`](file:///home/mat/Projects/mathslot-next/apps/obsidian/tests/obsidian.test.ts#L238-L273) | PASS |
| **D-126 / A-OBS-004** | 修复 `catalog/presets.json` 3 条失败预置并重新生成 `presets.ts`；88/88 通过 `LoadStreamSource`；`migrate.rs` 干净剥离旧损坏内置源 | [`catalog/presets.json:33,537,1040`](file:///home/mat/Projects/mathslot-next/catalog/presets.json#L33)；[`packages/ui/src/generated/presets.ts`](file:///home/mat/Projects/mathslot-next/packages/ui/src/generated/presets.ts)；[`crates/mathslot-store/src/migrate.rs:226-240,353-355`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/migrate.rs#L226-L240)；[`crates/mathslot-app/tests/t3_6_import_and_presets_tests.rs:101-167`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/t3_6_import_and_presets_tests.rs#L101-L167)；[`apps/obsidian/tests/obsidian.test.ts:199-236`](file:///home/mat/Projects/mathslot-next/apps/obsidian/tests/obsidian.test.ts#L199-L236) | PASS |
| **D-121 / OPEN-002** | `apps/obsidian` `AppShell.svelte`、`WasmEngineClient` 版本握手、`createHostRenderMathAdapter` + `createManagedRenderer` | [`apps/obsidian/src/AppShell.svelte:101-109,180-357`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/AppShell.svelte#L101-L109)；[`apps/obsidian/src/wasmClient.ts:23,40-54`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/wasmClient.ts#L23)；[`apps/obsidian/src/hostRenderAdapter.ts:22-62`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/hostRenderAdapter.ts#L22-L62)；[`apps/obsidian/tests/obsidian.test.ts:31-48,275-295`](file:///home/mat/Projects/mathslot-next/apps/obsidian/tests/obsidian.test.ts#L31-L48) | PASS（另见 §5 阅读视图代码块注记） |
| **D-122 / A-OBS-002** | `storage.ts` 损坏 `libraryJson` 隔离写入 `backupJson`（禁止删除 `data.libraryJson`），触发 `SetRecoveryState` 唤醒 `SettingsPanel` 恢复向导 | [`apps/obsidian/src/storage.ts:47-135`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/storage.ts#L47-L135)；[`apps/obsidian/src/plugin.ts:77-89,124-133`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/plugin.ts#L77-L89)；[`apps/obsidian/tests/obsidian.test.ts:91-151`](file:///home/mat/Projects/mathslot-next/apps/obsidian/tests/obsidian.test.ts#L91-L151) | PASS |
| **D-125 / A-OBS-003** | `@media (max-width: 480px)` 响应式布局与 `>= 36px` 触控按钮尺寸 | [`apps/obsidian/src/styles.css:112-114,138-158`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/styles.css#L112-L114)；[`packages/ui/src/import/ImportModal.svelte:476-498`](file:///home/mat/Projects/mathslot-next/packages/ui/src/import/ImportModal.svelte#L476-L498)；[`packages/ui/src/palette/PalettePanel.svelte:640-674`](file:///home/mat/Projects/mathslot-next/packages/ui/src/palette/PalettePanel.svelte#L640-L674)；[`packages/ui/src/settings/SettingsPanel.svelte:1194-1227`](file:///home/mat/Projects/mathslot-next/packages/ui/src/settings/SettingsPanel.svelte#L1194-L1227)；[`apps/obsidian/tests/obsidian.test.ts:153-197`](file:///home/mat/Projects/mathslot-next/apps/obsidian/tests/obsidian.test.ts#L153-L197) | PASS |
| **D-124 / A-OBS-001** | Obsidian 宿主 CSS 变量映射、明暗主题跟随、零断链令牌 | [`packages/ui/src/theme/tokens.css:265-360`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L265-L360) 已映射 `[data-host='obsidian']`；但 [`apps/obsidian/src/styles.css:11,38,48-49,69,77,83,93,133-135`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/styles.css#L11) 使用了 5 个未定义 `--ms-*` 变量 | **FAIL** |

---

## 4. 阻断原因与复现

1. **未定义 CSS 令牌破坏 Obsidian 壳层样式与主题对比度（`D-124` / `A-OBS-001`）**：
   - **最小复现**：
     ```bash
     rg -n -- "--ms-(text|text-muted|surface-2|on-accent|warn)\b" apps/obsidian/src/styles.css obsidian-mathslot/styles.css
     rg -n -- "--ms-(text|text-muted|surface-2|on-accent|warn):" packages/ui/src/theme/tokens.css || echo "NOT_DEFINED"
     ```
   - **期望 vs 实际**：
     - 期望：[`apps/obsidian/src/styles.css`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/styles.css)（及构建产物 [`obsidian-mathslot/styles.css`](file:///home/mat/Projects/mathslot-next/obsidian-mathslot/styles.css)）引用的全部 `--ms-*` 令牌均在 [`packages/ui/src/theme/tokens.css`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css) 中定义并映射到 Obsidian 宿主变量，且测试能校验无断链令牌。
     - 实际：[`apps/obsidian/src/styles.css`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/styles.css) 引用了 5 个未在 `tokens.css` 或任何样式表中定义的变量：
       - `--ms-text`（`:11, 38, 69`，而 `tokens.css:279` 定义为 `--ms-fg`）
       - `--ms-text-muted`（`:49, 93`，而 `tokens.css:280` 定义为 `--ms-fg-muted`）
       - `--ms-surface-2`（`:48, 77, 135`，而 `tokens.css:274` 定义为 `--ms-surface-elevated`）
       - `--ms-on-accent`（`:83`，`.ms-obsidian-btn.is-primary` 主按钮前景，而 `tokens.css:285` 定义为 `--ms-accent-contrast`）
       - `--ms-warn`（`:133, 134`，`.ms-obsidian-degraded-badge` 边框与前景，而 `tokens.css:324-325, 343-345` 定义为 `--ms-badge-degraded-*` / `--ms-status-warn-*`）
     - 结果：`.ms-obsidian-btn.is-primary`（“插入笔记”主按钮）在 `background: var(--ms-accent)` 上得到未解析的 `color: var(--ms-on-accent)`（回退为 UA 默认 `ButtonText` 黑色，破坏 `--text-on-accent` 对比度）；`.ms-obsidian-btn` 与 `.mathslot-obsidian-host` 文字未绑定 `--text-normal`；`.ms-obsidian-degraded-badge` 丢失告警边框、文字色与背景色；[`apps/obsidian/tests/obsidian.test.ts:50-89`](file:///home/mat/Projects/mathslot-next/apps/obsidian/tests/obsidian.test.ts#L50-L89) 仅做了子串检查，未能测出该断链缺陷。

---

## 5. 独立门禁命令执行记录

1. **`cargo fmt --check`**：exit `0`
2. **`cargo clippy --workspace --all-targets -- -D warnings`**：exit `0`（`Finished dev profile ... in 0.42s`）
3. **`cargo test --workspace --offline`**：exit `0`
   - 合计 56 个测试集：**`241 passed; 0 failed; 0 ignored`**（含 `t3_6_import_and_presets_tests` 与 `t3_6_wasm_bindgen_tests`）。
4. **`cargo run -p xtask -- check --offline`**：exit `0`
   - 输出尾部：`[xtask] Check PASSED: All 6 artifacts are up-to-date and clean.`
5. **`python3 scripts/agent/audit_palette.py`**：exit `0`
   - 输出尾部：`PASS：所有可映射卡片与命令目录一致`
6. **`cd packages/ui && npm test && npm run check && npm run build`**：exit `0`
   - `vitest run`：`Test Files 7 passed (7)` / `Tests 29 passed (29)`（含 `tests/importModal.test.ts` 2 passed）
   - `svelte-check`：`svelte-check found 0 errors and 0 warnings`
   - `vite build`：`dist/index.css 46.85 kB │ gzip: 6.61 kB`，`dist/index.js 2,581.02 kB │ gzip: 778.48 kB`
7. **`node obsidian-mathslot/scripts/build.mjs`**：exit `0`
   - `cargo release wasm size: 492.7 KB (504569 bytes)`
   - `wasm-bindgen 0.2.130` output：`452.6 KB raw (463427 bytes) / 159.8 KB gzip`
   - `dist/styles.css 49.27 kB │ gzip: 6.99 kB`，`dist/main.js 3,479.37 kB │ gzip: 1,214.38 kB`（`Synced main.js (3397.8 KB), styles.css, manifest.json`）
   - Node 冒烟输出：`✓ Obsidian plugin built and verified successfully: obsidian-mathslot/main.js (3 commands, 121 catalog entries, 88/88 presets)`
8. **`cd apps/obsidian && npm test && npm run check`**：exit `0`
   - `vitest run`：`Test Files 1 passed (1)` / `Tests 7 passed (7)`
   - `svelte-check`：`svelte-check found 0 errors and 0 warnings`
9. **`scripts/agent/acceptance.sh`**：exit `0`
   - 输出尾部：`PASS=5 FAIL=0 WARN=3` / `结论：PASS`

---

## 6. 未验证与非阻断观察项

- **真实 Obsidian Electron 桌面端与移动端真机**：当前宿主机未启动 Obsidian Electron 容器与真实移动设备（iOS/Android），真机剪贴板、虚拟键盘弹出视口与实际 Obsidian 宿主 CSS 渲染未在真机端实测（均在 JSDOM + Node + 真实 `mathslot_wasm_bg.wasm` 中测试）。
- **WASM 未经 `wasm-opt` 压缩（`§11.1` 400 KB 目标）**：宿主机未安装 `wasm-opt`（`which wasm-opt` 无输出），`wasm-bindgen` 产出未二次压缩为 `452.6 KB` raw（gzip 后 `159.8 KB`），略高于 `§11.1` gzip 前 `400 KB` 目标且 `.github/workflows/ci.yml` 尚未增加体积超限告警。
- **Obsidian 阅读视图代码块处理器**：[`apps/obsidian/src/plugin.ts:185-207`](file:///home/mat/Projects/mathslot-next/apps/obsidian/src/plugin.ts#L185-L207) 在 `registerMarkdownCodeBlockProcessor('mathslot', ...)` 中直接调用 `renderMath`/`finishRenderMath` 而未复用 `createHostRenderMathAdapter` 的 `<mjx-merror>` 静默错误检测，且降级渲染硬编码了 `theme: 'light'`（`:201`）。
- **`A-OBS-002` “从最近备份恢复”按钮交互**：[`apps/obsidian/tests/obsidian.test.ts:140-150`](file:///home/mat/Projects/mathslot-next/apps/obsidian/tests/obsidian.test.ts#L140-L150) 仅点击触发了 `recovery-reset-trigger` + `recovery-reset-confirm`，未点击 `recovery-restore-btn` 做 UI 端到端恢复验证。

---
id: VER-25
round: 25
task: T3.4
commit: 558e994
defects: [D-116, D-117, D-118, D-119, D-015, D-016]
verdict: PASS
verifier: mathslot-verifier
date: 2026-11-14
---

# 独立验收报告 VER-25：Gate G3 / `T3.4`（设置页 / 明暗与跟随系统主题 / 可配置快捷键与冲突检测 / 损坏隔离恢复向导 UI）

## 1. 结论

**`PASS`**。提交 `558e9941f792c1e756f1d4254299aed5c27f2c25` 严格限定在 `ADR-0028` §1 允许路径内，工作区干净，无新增禁止模式（`let _ =`、`.unwrap()`、`#[ignore]`、`#[allow]`、`.skip`、硬编码 `.svelte` 颜色、`@tauri-apps/api`/`wasm-bindgen` 导入均为 0）。`D-116`、`D-117`、`D-118`、`D-119`、`D-015`、`D-016` 与 `A-DATA-001` 契约逐项核验通过，全部 Rust 与前端门禁全绿。

---

## 2. Diff 与规范扫描

### 2.1 提交范围与工作区状态
- 命令：`git show --stat 558e994 && echo "---STATUS---" && git status --short && echo "---MSG---" && git log -1 --format=%B 558e994`（exit `0`）
- Commit Message：`feat(store,app,ui): T3.4 D-116 D-117 D-118 D-119 D-015 D-016 settings panel, themes, shortcuts, and recovery wizard`
  - 含 `T3.4` 与 `D-116 D-117 D-118 D-119 D-015 D-016`（无方括号）。
- 工作区状态：`git status --short` 输出为空（0 个未提交改动）。
- 变更文件（共 20 个，3268 insertions, 29 deletions），全部在 `ADR-0028` §1 允许路径内：
  - `crates/mathslot-app/src/{app.rs,command.rs,effect.rs,event.rs,snapshot.rs}`
  - `crates/mathslot-app/tests/{app_state_machine_tests.rs,t3_4_settings_contract_tests.rs}`
  - `crates/mathslot-store/src/lib.rs`
  - `crates/mathslot-store/tests/t3_4_settings_tests.rs`
  - `packages/ui/src/client/engine.ts`
  - `packages/ui/src/editor/{MathSlotEditor.svelte,keymap.ts}`
  - `packages/ui/src/index.ts`
  - `packages/ui/src/preview/PreviewPanel.svelte`
  - `packages/ui/src/settings/{SettingsPanel.svelte,shortcuts.ts}`
  - `packages/ui/src/theme/tokens.css`
  - `packages/ui/tests/{editor.test.ts,preview.test.ts,settings.test.ts}`
- 禁止修改路径（`packages/ui/src/generated/**`、`xtask/**`、`catalog/**`、`src/**`、`crates/mathslot-core/**`、`crates/mathslot-command/**`、`crates/mathslot-syntax/**`、`crates/mathslot-doc/**`、`crates/mathslot-render/**`、`scripts/agent/**`、`docs/**`、`agent-state/**`）：**0 改动**。

### 2.2 禁用模式与边界扫描
- `git show 558e994 | rg -n "^\+.*(let _\s*=|\.unwrap\(|#\[ignore|#\[allow|\.skip\(|test\.skip|it\.skip|todo!\(|unimplemented!\()"` → exit `0`，输出 `CLEAN`（0 命中）。
- `git show 558e994 -- '*.svelte' | rg -n "^\+.*(#[0-9a-fA-F]{3,8}\b|rgba\(|rgb\()"` → exit `0`，输出 `NO_SVELTE_HARDCODED_COLORS`（0 命中）。
- `git show 558e994 -- 'packages/ui/src/**' | rg -n "^\+.*(@tauri-apps/api|wasm-bindgen)"` → exit `0`，输出 `NO_FORBIDDEN_IMPORTS`（0 命中）。

---

## 3. 契约逐项核验（行级证据）

| 编号 | 契约要求 | 代码与测试证据（`file:line`） | 判定 |
|---|---|---|---|
| **D-116** | `mathslot-store` 向后兼容扩展 `Settings`（`theme`/`render_backend`/`shortcuts`），`from_user_library_with_settings` 与 `Store::save_user_library` 不丢设置 | [`crates/mathslot-store/src/lib.rs:136-240`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L136-L240)（`ThemePreference`、`RenderBackendPreference`、`ShortcutSettings`、`Settings` 带 `#[serde(default)]`）；[`crates/mathslot-store/src/lib.rs:269-277, 996-1010`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L269-L277)（`from_user_library_with_settings` 与 `Store::save_user_library` 保留 `self.settings`）；[`crates/mathslot-store/tests/t3_4_settings_tests.rs:25-149`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/tests/t3_4_settings_tests.rs#L25-L149) | PASS |
| **D-116** | `mathslot-app` 状态机持有 `settings`/`recovery` 并暴露于 `EngineSnapshot`，支持 `UpdateSettings` / `ResetSettingsConfirmed` / `SetRecoveryState` 及 4 种导出定界符（且错误诊断仍阻断严格导出） | [`crates/mathslot-app/src/snapshot.rs:119-281`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/snapshot.rs#L119-L281)（`DelimiterStyle::format_latex` 支持 `none`/`$...$`/`$$\n...\n$$`/```` ```latex\n...\n``` ````，`EngineSnapshot` 含 `settings` 与 `recovery`）；[`crates/mathslot-app/src/event.rs:36-42`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/event.rs#L36-L42)；[`crates/mathslot-app/src/app.rs:433-525`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L433-L525)（`ExecuteExport` 应用定界符包装并保持 `StrictExportBlocked`）；[`crates/mathslot-app/tests/t3_4_settings_contract_tests.rs:9-177`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/tests/t3_4_settings_contract_tests.rs#L9-L177) | PASS |
| **D-118 / D-015** | `shortcuts.ts` 规范化快捷键、拦截保留键（`Tab`/`Shift+Tab`/`Escape`/无修饰单字符/`Enter`/`Backspace`/`Delete`/`Arrow*`/`Mod+Z/Shift+Z/Y/C/X/V/A`）、检测跨动作冲突；`keymap.ts` & `MathSlotEditor.svelte` 分发自定义快捷键（含 `focus_editor`）且 `Tab`/`Shift+Tab`/`Escape` 永不锁死焦点 | [`packages/ui/src/settings/shortcuts.ts:182-405`](file:///home/mat/Projects/mathslot-next/packages/ui/src/settings/shortcuts.ts#L182-L405)；[`packages/ui/src/editor/keymap.ts:89-169`](file:///home/mat/Projects/mathslot-next/packages/ui/src/editor/keymap.ts#L89-L169)；[`packages/ui/src/editor/MathSlotEditor.svelte:76-78, 165-186, 210-231, 240-246`](file:///home/mat/Projects/mathslot-next/packages/ui/src/editor/MathSlotEditor.svelte#L76-L78)；[`packages/ui/tests/settings.test.ts:40-123`](file:///home/mat/Projects/mathslot-next/packages/ui/tests/settings.test.ts#L40-L123)；[`packages/ui/tests/editor.test.ts:380-450`](file:///home/mat/Projects/mathslot-next/packages/ui/tests/editor.test.ts#L380-L450) | PASS |
| **D-119** | `tokens.css` 显式 `[data-theme='light']` 覆盖 OS 暗色；`PreviewPanel.svelte` 在 `theme="auto"` 下订阅 `window.matchMedia('(prefers-color-scheme: dark)')` 并向 `RenderAdapter` 传递真实 `'dark'`/`'light'` | [`packages/ui/src/theme/tokens.css:1-2, 179-180`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css#L1-L2)；[`packages/ui/src/preview/PreviewPanel.svelte:47-87`](file:///home/mat/Projects/mathslot-next/packages/ui/src/preview/PreviewPanel.svelte#L47-L87)；[`packages/ui/tests/preview.test.ts:226-318`](file:///home/mat/Projects/mathslot-next/packages/ui/tests/preview.test.ts#L226-L318) | PASS |
| **D-117 / D-016 / A-DATA-001** | `SettingsPanel.svelte` 含主题切换、定界符选择+实时预览、渲染后端（`mathjax`/`latex-rust`）、快捷键列表+冲突高亮与保存阻断、配置路径与导入/导出按钮、“恢复默认设置”两步二次确认、损坏隔离恢复向导（“从最近备份恢复”+两步二次确认“确认重置为空配置”） | [`packages/ui/src/settings/SettingsPanel.svelte:282-628`](file:///home/mat/Projects/mathslot-next/packages/ui/src/settings/SettingsPanel.svelte#L282-L628)；[`packages/ui/src/index.ts:126-144`](file:///home/mat/Projects/mathslot-next/packages/ui/src/index.ts#L126-L144)；[`packages/ui/tests/settings.test.ts:125-341`](file:///home/mat/Projects/mathslot-next/packages/ui/tests/settings.test.ts#L125-L341) | PASS |

---

## 4. 独立门禁命令执行记录

### 4.1 `cargo fmt --check`
- 命令：`cargo fmt --check`
- Exit Code：`0`
- 输出：`FMT_OK`（无格式差异）

### 4.2 `cargo clippy --workspace --all-targets -- -D warnings`
- 命令：`cargo clippy --workspace --all-targets -- -D warnings`
- Exit Code：`0`
- 输出尾部：
  ```text
  Finished `dev` profile [optimized + debuginfo] target(s) in 0.24s
  CLIPPY_OK
  ```

### 4.3 `cargo test --workspace --offline`
- 命令：`cargo test --workspace --offline`
- Exit Code：`0`
- 汇总：**236 passed; 0 failed; 0 ignored**（涵盖全部 workspace crate 与集成测试，含新增 `t3_4_settings_tests` 2 passed 与 `t3_4_settings_contract_tests` 2 passed）。
- 关键输出尾部：
  ```text
  Running tests/t3_4_settings_contract_tests.rs (target/debug/deps/t3_4_settings_contract_tests-1db5fcad7d29f345)
  running 2 tests
  test d116_app_update_settings_recovery_state_and_reset_confirmed ... ok
  test d116_export_and_copy_apply_configured_delimiters_and_preserve_error_blocking ... ok
  test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

  Running tests/t3_4_settings_tests.rs (target/debug/deps/t3_4_settings_tests-6c52123d48e4fc11)
  running 2 tests
  test d116_legacy_v3_json_without_new_settings_fields_deserializes_with_defaults ... ok
  test d116_from_user_library_with_settings_and_store_save_preserve_custom_settings_roundtrip ... ok
  test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  ...
  TEST_OK
  ```

### 4.4 前端 `packages/ui` 测试、类型检查与构建
- 命令：`cd packages/ui && npm test && npm run check && npm run build`
- Exit Code：`0`
- 输出尾部：
  ```text
  Test Files  6 passed (6)
       Tests  27 passed (27)

  svelte-check found 0 errors and 0 warnings

  ✓ 321 modules transformed.
  dist/index.css     35.64 kB │ gzip:   5.35 kB
  dist/index.js   2,572.20 kB │ gzip: 776.65 kB
  ✓ built in 1.70s
  ```

### 4.5 `scripts/agent/audit_palette.py` 与 `scripts/agent/acceptance.sh`
- `scripts/agent/audit_palette.py` → Exit Code `0`：`PASS：所有可映射卡片与命令目录一致`
- `scripts/agent/acceptance.sh` → Exit Code `0`：
  ```text
  PASS   cargo fmt --check            exit 0
  PASS   cargo clippy -D warnings     exit 0
  PASS   cargo test --workspace       exit 0
  PASS   调色板一致性           exit 0（gate=G3）
  WARN   let _ = 计数               15 处（G4 前应清零）
  WARN   unwrap() 计数              20 处（用户输入路径应为 0）
  WARN   命令表常量              3 处（G1 后应只剩 catalog）
  PASS   工作区干净              0 个未提交改动

  PASS=5 FAIL=0 WARN=3
  结论：PASS
  ```
  （注：上述 3 项 WARN 均为历史旧代码存量债务，commit `558e994` 新增代码为 0。）

---

## 5. 未验证项 / 风险说明

1. **真实浏览器 / Playwright 视觉 E2E 截图（`S-006`、`A-UI-001` 真实渲染与桌面壳联调）**：本轮在 jsdom + Vitest 下验证了 `[data-theme='light']` / `[data-theme='dark']` 属性切换、`tokens.css` 作用域规则、以及 `PreviewPanel` `matchMedia` 暗色系统跟随，但未在真实 Chromium / Playwright 或 Tauri 桌面窗口中抓取像素级截图。该项随 `T3.5`（Tauri 桌面壳）/ G3 端到端 E2E 门禁统一补齐，不阻塞 `T3.4` 验收。

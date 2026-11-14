# 交接单（每轮结束必须更新）

## 当前

- 轮次：26
- Gate：G3
- 当前任务：`T3.6`（`apps/obsidian` Obsidian 壳 + 共享 `packages/ui` + `crates/mathslot-wasm` `wasm-bindgen` 接入；注：`T3.6` 依赖 `T3.1-T3.4`，宿主机缺少 `webkit2gtk4.1-devel` 等 RPM，故先完成可无 root 验证的 `T3.6`，再推进 `T3.5`/`T3.7`）
- 下一步：审计 `AUD-25.md` → `ADR-0029` → `implementer`（TDD 先红后绿）→ `verifier`（`VER-26.md`）

## 本轮（Round 25）做过什么

- `T3.4`（commit `558e994`，`VER-25.md` **PASS**）：
  - `crates/mathslot-store` 为 `Settings` 兼容扩展 `theme`（`light`/`dark`/`system`）、`render_backend`（`mathjax`/`latex-rust`）与 `shortcuts`，并修复 `LibraryFile::from_user_library_with_settings` 保存不覆盖设置（修复 `D-116`）。
  - `crates/mathslot-app` 接入 `AppSettings`、`UpdateSettings`、`ResetSettingsConfirmed`、`SetRecoveryState`、导出定界符包装（`none`/`inline_dollar`/`block_dollar`/`code_fence`）且错误诊断仍阻断导出；Rust 工作区测试 `236 passed; 0 failed; 0 ignored`。
  - `packages/ui` 完成 `[data-theme='light']` 显式令牌作用域、`PreviewPanel` `auto` 主题实时跟随 `prefers-color-scheme`（修复 `D-119`）、`settings/shortcuts.ts` 快捷键规范化与保留键/跨动作冲突拦截 + `keymap.ts` 注入（修复 `D-118`/`D-015`）及 `SettingsPanel.svelte` 设置与损坏隔离恢复向导 UI（修复 `D-117`/`D-016`/`A-DATA-001`）；Vitest `27 passed (6 files)`、`svelte-check` 0 errors 0 warnings、`vite build` 通过、`acceptance.sh` PASS。

## 证据在哪

- `agent-state/audits/AUD-24.md`
- `agent-state/decisions/ADR-0028-t3-4-settings-themes-shortcuts-and-recovery.md`
- `agent-state/verify/VER-25.md`（PASS）

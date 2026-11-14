# ADR-0033: T4.2 全量数据故障注入、端到端恢复锁写与双端配置互通契约

- 状态：Accepted（Coordinator 决策，`refactor/v1`，Gate G4 / Round 33）
- 关联任务：`T4.2`（数据故障注入全量：`A-DATA-001`..`006`、`A-OBS-002`）
- 关联审计：`agent-state/audits/AUD-29.md`
- 关联缺陷：`D-005`（重新打开为 OPEN P1）、`D-013`、`D-014`、`D-147`、`D-148`、`D-149`、`D-150`、`D-151`
- 参考规范：`docs/LLM_IMPLEMENTATION_SPEC.md` §2（`INV-003`、`INV-005`）、§4、§10、§13.4、§14（`T4.2`）

## 1. 背景

`AUD-29.md` 指出 `crates/mathslot-store` 虽已完成核心原子写/备份轮转/UUIDv7/隔离，但在端到端（`SettingsPanel` -> Desktop Tauri/Web / Obsidian `storage.ts` & `AppShell.svelte`）及故障注入矩阵仍存在 `D-147`..`D-151` 阻断缺口：

1. `D-147`（P1）：保存失败时 `SettingsPanel` 提前显示 `"设置已应用"`、Desktop `applyDispatch` 吞错、Desktop Tauri 与 Obsidian 先改内存后落盘；
2. `D-148`（P1）：损坏态未确认恢复/重置前允许写操作覆写唯一备份 `lastValidLibraryJson` 或写入新空库；Obsidian `storage.ts` 放行未知 `schema_version` / 非法字段 / `is_builtin: true`、使用 `Date.now()` ID、恢复后不刷新 `userFormulas`；
3. `D-149`（P2）：Desktop（`mathslot-store` `LibraryFile`）与 Obsidian（`storage.ts`）配置导入导出 JSON schema 不互通；
4. `D-150`（P2）：Desktop 遇未知 `schema_version` / `EISDIR` 启动直接 `exit(1)`、无路径 `RestoreBackup` 空转、`create_backup_from_bytes` `ENOSPC` 残留半截 `.bak-*`；
5. `D-151`（P2）：缺超大文件上限与测试、无备份/坏备份跳过/`EISDIR`/真实子进程 `kill -9`（`SIGKILL`）测试，以及双端 Playwright `A-DATA` 恢复/失败/互导 E2E。

## 2. 授权设计与契约

### 2.1 `D-147`：严格“持久化成功后再确认”（Save-Before-Success）

1. `packages/ui/src/settings/SettingsPanel.svelte`：
   - 点击保存后先置非成功态（如 `'saving'`），等待 `await onSaveSettings(normalizedPayload)` 解析成功且无异常后，**才** 更新 `lastSyncedPropSnapshot` 并置 `saveFeedback = 'saved'`（`"设置已应用"`）；
   - 若 `onSaveSettings` 抛出/拒绝，置 `saveFeedback = 'error'` 并显示明确错误文本，保持 `lastSyncedPropSnapshot` 与 `isDirty` 不变。
2. Desktop `apps/desktop/src/App.svelte` 与 `apps/desktop/src-tauri/src/lib.rs` & `crates/mathslot-app`：
   - `App.svelte` 的 `applyDispatch` / `handleSaveSettings` / `handleRestoreBackup` / `handleResetEmptyConfig` / `handleImportConfig` 不得吞掉持久化失败；需向调用者抛出或显式设置错误状态。
   - `lib.rs` 在执行 `PersistSettings`、`ConfirmResetEmptyConfig`、`RestoreBackup`、`ImportConfig`、`save_user_formula` 时，**先完成磁盘持久化验证与原子落盘**（基于克隆快照校验/写入，失败则回滚内存态并保持原 `app` 状态与 `recovery` 不变），绝不先改内存后失败。
3. Obsidian `apps/obsidian/src/plugin.ts` & `AppShell.svelte`：
   - `saveUserSnippet` / `saveSettings` / `restoreBackup` / `resetEmptyConfig` / `importPluginConfig` 均先构造副本并 `await saveData(...)`；若 `saveData` 拒绝，不得提交到 `this.persisted` 或本地公式列表，且 `AppShell.svelte` 捕获并在 UI 内展示错误提示（不发生未捕获 Promise rejection）。

### 2.2 `D-148`：隔离恢复写锁与 Obsidian 严格校验

1. **恢复态写锁（Desktop Tauri + Obsidian）**：
   - 当存在未解除的 `recovery` / `CorruptQuarantined` 状态时，禁止 `PersistSettings`、`save_user_formula` / `saveUserSnippet` 覆写主配置文件或 `lastValidLibraryJson`；必须返回明确的阻断错误信息，引导用户先执行「从最近有效备份恢复」或「确认为空配置重置」（遵循 §10.3 第 5 条）。
2. **Obsidian `storage.ts` 与 `plugin.ts` 严格化**：
   - 启动加载若 `raw` 不是合法字符串（如 `typeof raw !== 'string'` 且非 `undefined/null`）或 JSON/schema 失败：隔离（用单调/UUID-style 非 `Date.now()` 唯一 ID，且对已隔离相同载荷去重避免反复刷入 `backupJson`），清除触发报错的待写脏态而不破坏 `lastValidLibraryJson`；
   - `validateParsedLibrary` 仅接受合法整数版本 `1 | 2 | 3`（拒绝 `0`、`99`、负数、浮点数、缺失版本、`Array.isArray(obj)`）；
   - `importPluginConfigJson`：不接受缺失 `schema_version` 的无版本载荷（或按严格迁移白名单 `1|2|3`）；在 `validateParsedLibrary` 之前**严禁**把非数组 `customFormats` / `snippets` / `user_formulas` / `overrides` 静默替换为 `[]`；严格拒绝包含 `is_builtin: true` 的任意条目（`D-014`）；严格拒绝损坏的内嵌 `libraryJson`（禁止用 `parseLibraryRecord` 吞错变空库）；
   - 打开插件存在活跃 `recovery` 时自动打开/聚焦设置与 `RecoveryBanner`，且在恢复/重置完成后同步刷新 `AppShell` 内的 `userFormulas` 与 `settings`。

### 2.3 `D-149`：Desktop 与 Obsidian 配置导出/导入双向互通

1. **统一双向兼容规范**：
   - Desktop 导出的规范 `LibraryFile` JSON（含 `schema_version: 3`、`custom_formats`、`user_formulas`、`overrides`、`snippets`）与 Obsidian 导出的插件配置 JSON 必须能互相无损导入（保留自定义格式、用户片段/公式与相关设置）：
     - 在 `crates/mathslot-store` 中增强 `import_library_json`（及 `migrate`）：在严格校验 `schema_version`（`1..=3`）并拒绝 `is_builtin: true` / 畸形类型的同时，兼容导入 Obsidian 导出的便携字段（`customFormats`、`snippets` / `user_formulas`），自动分配合法 RFC-9562 UUIDv7 与去重唯一 `key`/名称；
     - 在 `apps/obsidian/src/storage.ts` 中让 `exportPluginConfigJson` 同步产出兼容字段（包含 `user_formulas` / `custom_formats` 或标准兼容结构），并让 `importPluginConfigJson` 严格校验后无损映射 Desktop `LibraryFile` 的 `user_formulas`、`custom_formats`、`overrides` 与 `snippets`，绝不静默丢弃；
     - 在 `apps/desktop/src/lib/desktopClient.ts` 的浏览器回退桥中同步支持 `schema_version` `1|2|3` 及跨端配置导入，恢复/重置后同步更新 `userFormulas`。

### 2.4 `D-150`：Desktop 启动容错、备份原子清理与 `RestoreBackup(None)`

1. **`crates/mathslot-store/src/lib.rs`**：
   - 定义 `MAX_LIBRARY_FILE_BYTES: u64 = 16 * 1024 * 1024`（16 MiB），在读取主文件/导入文件/备份文件前先检查长度（超过上限返回明确 `StoreError::FileTooLarge` 而非 OOM）；
   - `create_backup_from_bytes` 通过临时文件写入+`sync_all` 再原子 `persist` 或在失败时显式清理不完整 `.bak-*` 文件，绝不遗留半截备份。
2. **`apps/desktop/src-tauri/src/lib.rs`**：
   - 启动遇到 `UnsupportedSchemaVersion`、`FileTooLarge` 或 `EISDIR`（目录占用文件）时，不再直接 `exit(1)`；进入带错误/恢复信息的启动恢复态（不自动覆写原 `library.json`，允许 UI 展示明确错误提示并引导备份恢复、确认重建或导出/排查）；
   - `HostAction::RestoreBackup { backup_path }` 当 `backup_path` 为 `None` 时，自动取 `app.recovery().and_then(|r| r.backup_candidate.clone())`；若仍为 `None` 则返回明确错误。

### 2.5 `D-151`：全量故障注入与双端 E2E 闭环

1. **`crates/mathslot-store/tests/`**：
   - 补全并实现：`> MAX_LIBRARY_FILE_BYTES` 超大文件拒绝测试、无备份（`backup_candidate: None`）恢复行为、最新 `.bak` 损坏自动跳过退回次新有效 `.bak`、全部备份损坏归零、目录占 `library.json`（`EISDIR`）、字段缺失/未知类型边界、`create_backup_from_bytes` 失败清理、以及**真实子进程写入中 `kill -9`（`SIGKILL`）+ 孤儿 `.tmp*` 清理重启测试**（`A-DATA-004`）。
   - 修复 `data_safety_tests.rs:493` 中的 `.unwrap()`。
2. **双端 Playwright E2E 与截图**：
   - `apps/desktop/tests/e2e/desktop.spec.ts` 与 `apps/obsidian/tests/e2e/obsidian.spec.ts` 均须真实点击交互测试：
     - 损坏隔离态阻断存为片段（不毁坏备份）；
     - 点击 `recovery-restore-btn` 从备份真实恢复（恢复公式并关闭 `RecoveryBanner`）；
     - 两步确认 `recovery-reset-trigger` -> `recovery-reset-confirm` 重置空库；
     - 保存失败（只读/拒绝模拟）时 UI 不得显示 `"设置已应用"` 而展示明确错误；
     - 配置导出/跨端兼容导入。
   - 产出恢复/失败关键 Playwright 截图至 `.e2e-artifacts/` 供视觉查验。

## 3. 允许修改范围（Implementer 唯一写权限）

- `crates/mathslot-store/**`
- `crates/mathslot-app/**`
- `packages/ui/**`
- `apps/desktop/**`（含 `apps/desktop/src-tauri/**`、`apps/desktop/src/**`、`apps/desktop/tests/**`）
- `apps/obsidian/**`（含 `src/**`、`e2e/**`、`tests/**`）
- `obsidian-mathslot/main.js`、`obsidian-mathslot/styles.css`（经 `node obsidian-mathslot/scripts/build.mjs` 重新构建且零漂移）

禁止修改：`docs/LLM_IMPLEMENTATION_SPEC.md`、`scripts/agent/**`、`agent-state/**`、冻结参考目录。

## 4. Red -> Green 顺序与门禁

1. 先写出针对 `D-147`..`D-151` 的失败测试并记录 Red 失败输出；
2. 完成实现后运行 `node obsidian-mathslot/scripts/build.mjs` 刷新插件与 WASM 产物；
3. 全部通过 `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace --offline`、`packages/ui` / `apps/obsidian` / `apps/desktop` 单测+检查+构建+Playwright E2E，及 `scripts/agent/acceptance.sh`。

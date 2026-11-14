---
id: AUD-29
round: 33
gate: G4
scope:
  - T4.2
  - A-DATA-001
  - A-DATA-002
  - A-DATA-003
  - A-DATA-004
  - A-DATA-005
  - A-DATA-006
  - A-OBS-002
  - D-005
  - D-006
  - D-013
  - D-014
  - D-022
  - D-027
verdict: BLOCK
auditor: auditor
date: 2026-11-14
base_commit: d78692b
---

# AUD-29：Gate G4 / T4.2（数据故障注入全量、A-DATA-001..006 与双端持久化/恢复安全）只读审计报告

## 1. 判定摘要

- **总体结论**：**`BLOCK`**（`T4.2` / `ADR-0033` 不可直接签收 `A-DATA` 全过；发现 **2 项 P1** 与 **3 项 P2** 实质性数据安全与端到端闭环缺陷）。
- **核心发现**：
  1. **保存失败假装已保存（`D-147`，P1）**：`packages/ui/src/settings/SettingsPanel.svelte:208-220` 在 `await onSaveSettings` / `await client.dispatch` 返回前就乐观把 `saveFeedback` 设为 `'saved'`（界面亮绿标 `"设置已应用"`）且提前更新 `lastSyncedPropSnapshot`；同时桌面端 `apps/desktop/src/App.svelte:170-177, 219-221` 的 `applyDispatch` 吞掉拒绝异常未重新抛出，且 `apps/desktop/src-tauri/src/lib.rs:290-329` 在磁盘持久化失败前就已修改内存 `App` 状态。Obsidian 端 `apps/obsidian/src/AppShell.svelte:261-285, 526-537` 同样先改 WASM/内存对象再 `saveData`，失败时无错误 UI 处理且造成未捕获 Promise 拒绝。直接违反 `INV-003`、`A-DATA-002`、`A-DATA-003`。
  2. **Obsidian 持久化与恢复链路多处静默丢备份/放行非法数据（`D-148`，P1）**：
     - `apps/obsidian/src/storage.ts:80-108, 168-183, 202-235`：`loadAndValidateLibrary` 隔离损坏后仍把坏串留在 `data.libraryJson`；若用户在未恢复前点击"存为片段"，`saveUserSnippet` 通过 `parseLibraryRecord` 静默吞掉 JSON 解析错误变为空库，并用仅含新片段的数据覆盖 `data.libraryJson` 和 **`data.lastValidLibraryJson`**（直接销毁唯一有效备份候选）。
     - `apps/desktop/src-tauri/src/lib.rs:243-258, 305-319, 522-565` 同样未阻止在 `CorruptQuarantined` 恢复向导确认前通过 `PersistSettings` / `save_user_formula` 写入新空库，违反 §10.3 第 5 条"只有用户确认后才写新文件"。
     - `apps/obsidian/src/storage.ts:40-42, 264-279` 放行任意数字 `schema_version`（如 `0`、`99`），`importPluginConfigJson` 对缺失版本号静默回退 `3`、对损坏内嵌 `libraryJson` 静默变空库、对非数组 `customFormats`/`snippets` 静默 coerce 为 `[]` 再校验、且未拒绝 `is_builtin: true`（违反 `D-013`、`D-014`、§10.1、§10.5）。
     - `storage.ts:82, 215` 使用 `Date.now()`（同毫秒碰撞，`INV-005`），重复打开反复向 `backupJson` 写入同一坏串；`plugin.ts:112-121, 157-166` 未自动展开恢复面板且恢复/重置后不刷新 `AppShell` 中的 `userFormulas`；`storage.ts:57` 遇非字符串 `libraryJson` 会抛 `TypeError` 崩溃。
  3. **Desktop 与 Obsidian 配置 JSON 双向不互通（`D-149`，P2）**：Desktop（`mathslot-store`）导出 `snake_case` `LibraryFile`（含 `custom_formats`、`user_formulas`、`overrides`、`snippets: []`），Obsidian `importPluginConfigJson` 仅认 `customFormats` 且优先匹配非空的 `snippets` 数组从而静默丢弃 Desktop 导出的 `user_formulas` / `custom_formats` / `overrides`；反向 Obsidian 导出缺少 `SnippetRecord.key/label` 导致 Desktop `Store::import_library_json` 直接报错 `missing field 'key'`。
  4. **Desktop 启动遇未知 `schema_version` 崩溃退出 & `HostAction::RestoreBackup(None)` 静默空转（`D-150`，P2）**：`apps/desktop/src-tauri/src/lib.rs:223-225, 773` 与 `main.rs:5-8` 在 `UnsupportedSchemaVersion`（或目录占文件）时直接进程 `exit(1)` 退出，无法打开界面提示用户（违反 §10.5"未知版本拒绝并提示"）；`lib.rs:320-325` 对 `RestoreBackup { backup_path: None }` 静默忽略；`crates/mathslot-store/src/lib.rs:657-664` `create_backup_from_bytes` 写 `.bak-*` 时若磁盘满会残留截断备份文件。
  5. **§10.5 / `A-DATA` 故障注入与双端 E2E 覆盖缺口（`D-151`，P2）**：`crates/mathslot-store` 缺少超大文件大小上限保护与测试（§10.5 明确要求），缺少无备份（`backup_candidate: None`）、最新备份损坏跳过、目录占文件（`EISDIR`）、以及真实子进程 `kill -9`（`SIGKILL`）与孤儿 `.tmp*` 残留重启测试（`A-DATA-004`）；`apps/desktop/src/lib/desktopClient.ts:236-283` 浏览器桥 `importConfigJson` 拒 v1/v2 且丢 `user_formulas`；`apps/desktop/tests/e2e/desktop.spec.ts` 未点击测试恢复/重置/导入导出/保存失败，`apps/obsidian/tests/e2e/obsidian.spec.ts` 对 `A-OBS-002` / `A-DATA` 恢复与配置导入导出为零覆盖。

### 历史缺陷与 `T4.2` 范围项逐一判定

| 编号 | 状态 Verdict | 严重度 | 说明 |
|---|---|---|---|
| `D-005` | **`OPEN`**（端到端回归，见 `D-147`、`D-148`、`D-151`） | P1 | `mathslot-store` 核心原子写/隔离/权限返回已实现，但 UI 保存失败假绿、`CorruptQuarantined` 未阻断覆盖写、Obsidian 覆写备份及缺真实 `kill -9` 测试导致未端到端闭环 |
| `D-006` | **`FIXED`**（Rust 端；Obsidian 残余见 `D-148`） | P1 | `mathslot-core` 与 `mathslot-store` 均已使用单调 RFC-9562 UUIDv7，`t_data_003` 千条同毫秒并发 0 碰撞 |
| `D-013` | **`FIXED`**（`mathslot-store`）/ **`OPEN`**（Obsidian `storage.ts`，见 `D-148`） | P2 | `mathslot-store` 严格 `serde` + 版本匹配；Obsidian `storage.ts` 放行未知数字版本并静默回退缺字段 |
| `D-014` | **`FIXED`**（`mathslot-store`）/ **`OPEN`**（Obsidian `storage.ts`，见 `D-148`） | P2 | `mathslot-store` 不落盘 88 内置且拒 `is_builtin: true`；Obsidian `importPluginConfigJson` 未阻断 `is_builtin: true` |
| `D-022` | **`FIXED`** | P2 | `crates/mathslot-store/src/paths.rs:9-47` 已用 `dirs::config_dir()` 且有 Linux/macOS/Windows 路径单测 |
| `D-027` | **`FIXED`** | P3 | 3–5 代时间戳备份与 `sync_all`/`sync_dir` 已在 `crates/mathslot-store/src/lib.rs:645-702` 实现并测试 |
| `D-147` | **`OPEN`**（新增） | P1 | `SettingsPanel.svelte` 乐观置 `'saved'` + `App.svelte` 吞错 + Desktop/Obsidian 先改内存再持久化，保存失败时 UI 假装已保存 |
| `D-148` | **`OPEN`**（新增） | P1 | Obsidian `storage.ts` / `plugin.ts` 在损坏态下 `saveUserSnippet` 销毁 `lastValidLibraryJson`、放行未知版本与 `is_builtin: true`、重复隔离且未自动弹出/刷新恢复状态（含 Desktop 损坏态未锁写） |
| `D-149` | **`OPEN`**（新增） | P2 | Desktop（snake_case `LibraryFile`）与 Obsidian（camelCase `customFormats`/`snippets`）配置导入导出互相不兼容，跨端导入失败或静默丢数据 |
| `D-150` | **`OPEN`**（新增） | P2 | Desktop 启动遇未知 `schema_version` / `EISDIR` 直接 `exit(1)` 无法提示；`RestoreBackup { backup_path: None }` 静默空转；`create_backup_from_bytes` 失败遗留半截 `.bak-*` |
| `D-151` | **`OPEN`**（新增） | P2 | 缺超大文件上限与测试、无备份/坏备份跳过/EISDIR/真实 `kill -9` 测试、浏览器桥与双端 Playwright E2E `A-DATA` 恢复/失败覆盖缺口 |

---

## 2. 实跑命令与静态扫描证据

| 检查项 | 命令 | Exit Code | 实测输出摘要 |
|---|---|---|---|
| 状态恢复基线 | `scripts/agent/resume.sh` | `0` | `gate=G4 round=33 active=T4.2 next=T4.2 open_p1=- branch=refactor/v1 head=d78692b dirty=0` |
| 存储层单测 | `cargo test -p mathslot-store --offline` | `0` | 11 passed, 0 failed（`data_safety_tests`: 7 passed；`t3_4_settings_tests`: 2 passed；`t3_5_desktop_store_tests`: 2 passed） |
| Desktop 后端单测 | `cargo test -p mathslot-desktop --offline` | `0` | 2 passed, 0 failed（`desktop_backend_tests`: 2 passed） |
| 应用状态机单测 | `cargo test -p mathslot-app --offline` | `0` | 29 passed, 0 failed（8 个测试二进制全过，含 `t3_4_settings_contract_tests` 2 passed、`t3_5_sync_and_snippet_tests` 2 passed） |
| 前端单测套件 | `npm --prefix packages/ui test && npm --prefix apps/obsidian test && npm --prefix apps/desktop test` | `0` | `packages/ui`: 8 files / 45 tests passed；`apps/obsidian`: 1 file / 14 tests passed；`apps/desktop`: 1 file / 4 tests passed |
| 一键门禁 | `scripts/agent/acceptance.sh` | `0` | `PASS cargo fmt --check`、`PASS cargo clippy -D warnings`、`PASS cargo test --workspace`、`PASS 调色板一致性`、`PASS 工作区干净`；`WARN` 3 条（`let _ =` 9、`unwrap()` 20、命令表常量 3） |
| 源码禁用模式扫描 | `rg -n "\.unwrap\(|let _ =" crates/mathslot-store/src/ crates/mathslot-app/src/ apps/desktop/src-tauri/src/ \|\| echo "ZERO_MATCHES"` | `0` | `ZERO_MATCHES`（三处生产 `src/` 均为 0 命中） |
| 全仓（含测试）扫描 | `rg -n "\.unwrap\(|let _ =" crates/mathslot-store/ crates/mathslot-app/ apps/desktop/src-tauri/` | `0` | 仅 3 处测试代码命中：`crates/mathslot-app/tests/t3_6_import_and_presets_tests.rs:221, 250`、`crates/mathslot-store/tests/data_safety_tests.rs:493` |
| 浏览器本地存储扫描 | `rg -n "localStorage\|sessionStorage" apps/desktop/ packages/ui/ apps/obsidian/` | `1` | 无命中（Desktop 浏览器模式无 `localStorage` 持久化兜底，仅内存） |
| 静默回退扫描 | `rg -n "unwrap_or_default\|unwrap_or\(\|ok\(\)" crates/mathslot-store/src/ apps/desktop/src-tauri/src/ apps/obsidian/src/storage.ts` | `0` | `mathslot-store/src/lib.rs:759,762`（只读锁降级，见 §3.1）、`mathslot-store/src/migrate.rs:289-341,420`（见 §3.1）、`desktop/src-tauri/src/lib.rs:533,579,613,628,638` |
| 工作区洁净度 | `git status --short` | `0` | 无输出（干净） |

---

## 3. 分层核查证据

### 3.1 `crates/mathslot-store/**` 与 §10 / §13.4 / `A-DATA` 核查

1. **已达标能力**：
   - **原子写与备份轮转**：`crates/mathslot-store/src/lib.rs:876-964` 使用同目录 `NamedTempFile::new_in(parent)` + `write_all` + `flush` + `sync_all_file()` -> 成功后才调用 `create_backup_from_bytes`（保留 3..=5 代） -> `temp_path.persist(path)` -> `sync_dir(parent)`；文件锁使用 `fd_lock::RwLock`（`lib.rs:891-900`）+ `FileRevision` 乐观并发检测（`lib.rs:908-932`）。
   - **损坏隔离与严格 JSON**：`lib.rs:776-788, 832-841` 对无效 UTF-8、截断 JSON、尾随垃圾、`tru`/`nul`/`1e` 等调用 `quarantine_corrupt_file` 重命名为 `{stem}.corrupt-{ts_ms}-{seq}.json` 并 `sync_dir`，返回 `LoadOutcome::CorruptQuarantined` 与 `find_newest_valid_backup` 候选，不覆盖主文件。
   - **UUIDv7 与 v1/v2 迁移**：`crates/mathslot-core/src/library.rs:16-75` + `crates/mathslot-store/src/migrate.rs:182-441` 覆盖 `user-<secs>` 迁移、88 预置剥离与 `PresetOverride` 转换、`is_builtin: true` 拒绝/规范化。
2. **具体缺口与隐患**：
   - **备份写入中断残留（`D-150`）**：`crates/mathslot-store/src/lib.rs:657-664` 中 `create_backup_from_bytes` 直接 `OpenOptions::create_new(true)` 写目标 `.bak-*` 路径，若 `write_all`/`sync_all` 因 `ENOSPC` 失败不会删除半截 `.bak-*` 文件（虽然后续 `find_newest_valid_backup` 会跳过损坏备份）。
   - **`hidden: true` 覆盖项在 round-trip 中丢失（附注/P3 级细节）**：`crates/mathslot-store/src/lib.rs:467-469` 在 `to_user_library` 跳过 `ov.hidden == true` 条目，而 `from_user_library_with_settings`（`lib.rs:347-401`）仅遍历 `lib.formulas.entries`，若未来启用隐藏预置，保存时会丢失 `hidden` 覆盖。
   - **§10.5 / `A-DATA` 故障注入覆盖缺失（`D-151`）**：
     - 无配置文件大小上限（`crates/mathslot-store/src/lib.rs:766, 1089` 直接全量读入内存），且 `data_safety_tests.rs` **0 个超大文件测试**；
     - `data_safety_tests.rs` 未测 **无备份（`backup_candidate: None`）**、**最新备份损坏回退次新备份 / 全备份损坏**、**目录占文件（`EISDIR`）**、**未知字段/缺字段边界**；
     - `data_safety_tests.rs` 仅以 `QuotaSyncWriter` 模拟 `WriteZero`，**无真实子进程 `kill -9`（`SIGKILL`）写入中测试及孤儿 `.tmp*` 残留重启验证**。

### 3.2 `apps/desktop/src-tauri/**`、`desktopClient.ts`、`App.svelte` 与 `SettingsPanel.svelte`

1. **`D-147`（P1）持久化失败静默假绿**：
   - `packages/ui/src/settings/SettingsPanel.svelte:208-220`：点击保存按钮时先执行 `lastSyncedPropSnapshot = JSON.stringify(normalizedPayload); saveFeedback = 'saved';`，再 `await onSaveSettings(normalizedPayload)`；当宿主保存因只读目录/磁盘满/写冲突失败时，UI 仍展示绿色 `"设置已应用"`（`SettingsPanel.svelte:290-291`）且 `isDirty` 归 `false`。
   - `apps/desktop/src/App.svelte:170-177, 219-221`：`handleSaveSettings` 调用 `applyDispatch`，而 `applyDispatch` 捕获错误后只调 `showToast` 而不重新抛出，进一步掩盖了保存失败。
   - `apps/desktop/src-tauri/src/lib.rs:290-329`：`dispatch_event` 先调用 `app.dispatch_snapshot(event)`（修改内存 `App.settings`，且 `crates/mathslot-app/src/app.rs:802-814` 在 `ConfirmResetEmptyConfig` 先清空 `self.recovery = None` 并重置 `self.settings`）之后才执行 `store.save_user_library` / `reset_empty_internal`。磁盘写入失败时内存状态已发生变更，与磁盘不一致。
2. **`D-148`（P1，桌面损坏态锁写缺失）**：
   - `apps/desktop/src-tauri/src/lib.rs:243-258` 收到 `CorruptQuarantined` 时主文件已被重命名为 `.corrupt-*`、内存 `library` 为空、`store.last_revision` 为 `None`。但 `lib.rs:305-319`（`PersistSettings`）与 `lib.rs:522-565`（`save_user_formula`）均未拦截损坏恢复未完成前的写盘操作，导致在用户确认恢复/重置前即可把空 `UserLibrary` 写入 `library.json`（违反 §10.3 第 5 条）。
3. **`D-150`（P2）未知版本启动崩溃与无路径恢复静默**：
   - `apps/desktop/src-tauri/src/lib.rs:223-225, 773` 与 `src-tauri/src/main.rs:5-8`：当 `library.json` 含未知 `schema_version`（如 `99`）或被目录占据时，`store.load(catalog)?` 导致进程直接 `exit(1)`，不弹出任何 UI 提示。
   - `apps/desktop/src-tauri/src/lib.rs:320-325`：`HostAction::RestoreBackup { backup_path: None }` 静默忽略，未返回错误也未读取 `app.recovery().backup_candidate`。
4. **Browser/Web 模式与 Desktop E2E（`D-151`）**：
   - `apps/desktop/src/lib/desktopClient.ts:236-283`：`createBrowserHarnessBridge().importConfigJson` 硬写 `if (parsed.schema_version !== 3)`（拒绝 Rust 支持的 v1/v2），且忽略导入中的 `user_formulas`；`restoreBackup` / `resetEmptyConfig` 仅清空 `recovery` 而不还原/清空 `userFormulas`。
   - `apps/desktop/tests/e2e/desktop.spec.ts:244-325` 仅用 mock `snapshot` 检查 `recovery-wizard` 可见性，未实际点击 `recovery-restore-btn`、`recovery-reset-trigger` -> `recovery-reset-confirm`、`settings-import-btn`、`settings-export-btn` 或验证保存失败提示。

### 3.3 `apps/obsidian/src/**`（`storage.ts` / `plugin.ts` / `AppShell.svelte`）与 Obsidian E2E

1. **`D-148`（P1）Obsidian 损坏隔离与保存安全漏洞**：
   - `apps/obsidian/src/storage.ts:80-108` 隔离损坏串进 `backupJson` 后不替换 `data.libraryJson`；随后 `saveUserSnippet`（`storage.ts:212-234`）调 `parseLibraryRecord(data.libraryJson)`（`storage.ts:168-183`）静默吞掉 `JSON.parse` 异常返回空结构，再将仅含当前片段的 JSON 覆盖 `data.libraryJson` 和 **`data.lastValidLibraryJson`**，永久破坏备份。
   - `apps/obsidian/src/storage.ts:40-42` `validateParsedLibrary` 仅判断 `typeof obj.schema_version !== 'number'`，接受 `0`、`99`、`-1` 等未知版本号。
   - `apps/obsidian/src/storage.ts:254-308` (`importPluginConfigJson`)：
     - 内嵌 `libraryJson` 若损坏，`parseLibraryRecord` 静默回退空库并导入成功；
     - 缺失 `schema_version` 静默设为 `3`（L268）；
     - `customFormats` / `snippets` 非数组时在校验前先静默转为 `[]`（L269-275），导致 `validateParsedLibrary` 无法拦截畸形类型；
     - 完全未检查/阻断 `is_builtin: true`（违反 `D-014`）。
   - `apps/obsidian/src/storage.ts:82, 215` 用 `Date.now()` 生成 ID，同毫秒重复调用碰撞；`storage.ts:57` 未校验 `typeof raw === 'string'`；`plugin.ts:201` 未排除 `Array.isArray(loaded)`；`plugin.ts:112-121, 157-166` 未自动打开设置恢复向导且恢复/重置后不更新 `AppShell` 内的 `userFormulas`。
   - `apps/obsidian/src/AppShell.svelte:261-285, 526-537` 对 `onSaveSnippet` / `onRestoreBackup` / `onResetEmptyConfig` / `onPersistSettings` 失败缺少捕获与错误提示（`plugin.ts:92-95` 与 `storage.ts` 均在 `await saveData` 之前就地修改 `this.persisted`/`data`）。
2. **`D-149`（P2）跨端配置 JSON 不互通**：
   - `apps/obsidian/src/storage.ts:237-279` 使用 camelCase `customFormats` 与 `snippets: UserFormulaEntry[]`，而 Desktop `crates/mathslot-store` 使用 snake_case `custom_formats`、`user_formulas: UserFormula[]`、`snippets: SnippetRecord[]`（要求 `key: char, label: String`）。互导时 Desktop -> Obsidian 静默丢失公式与自定义格式，Obsidian -> Desktop 反序列化直接报错。
3. **Obsidian E2E 缺口（`D-151`）**：
   - `apps/obsidian/tests/e2e/obsidian.spec.ts` 5 个用例均未涉及 `A-OBS-002` / `A-DATA` 损坏恢复、备份还原、重置空配置、配置导入导出与保存失败；`apps/obsidian/e2e/harness.ts` 未接线 `onRestoreBackup` / `onResetEmptyConfig` / `onImportConfigData`。

---

## 4. 新登记缺陷明细表

| ID | 严重度 | 位置 | 现象与违反约束 | 最小复现路径 |
|---|---|---|---|---|
| `D-147` | **P1** | `packages/ui/src/settings/SettingsPanel.svelte:208-220`、`apps/desktop/src/App.svelte:170-177,219-221`、`apps/desktop/src-tauri/src/lib.rs:290-329`、`apps/obsidian/src/AppShell.svelte:261-285,526-537` | 持久化返回错误（只读目录/磁盘满/写冲突）前即乐观置 `saveFeedback = 'saved'`（展示 `"设置已应用"`）且先修改内存状态；桌面 `applyDispatch` 吞错；Obsidian 触发未捕获 rejection（违反 `INV-003`、`A-DATA-002`、`A-DATA-003`） | 传入 reject 的 `onSaveSettings` 点击 `settings-save-btn`；或桌面端目录 `chmod 0555` 后保存设置，`SettingsPanel` 仍显示 `"设置已应用"` 且内存 `App.settings` 已变 |
| `D-148` | **P1** | `apps/obsidian/src/storage.ts:40-48,56-108,168-235,254-308`、`apps/obsidian/src/plugin.ts:92-121,157-166,201`、`apps/desktop/src-tauri/src/lib.rs:243-258,305-319,522-565` | 损坏态下 Obsidian `saveUserSnippet` 静默清库并覆写 `lastValidLibraryJson` 毁掉唯一备份；Desktop 损坏态未锁写允许覆盖新空库；Obsidian 接受 `schema_version: 99`/`0`、静默替换畸形字段/坏内嵌 JSON、未拒 `is_builtin: true`、`Date.now()` 同毫秒碰撞、恢复后 `userFormulas` 不刷新 | 注入坏 `libraryJson` 与有效 `lastValidLibraryJson` 后调用 `saveUserSnippet`，`lastValidLibraryJson` 被单条片段覆盖；向 `importPluginConfigJson` 传入 `{"schema_version":99,"customFormats":"bad","user_formulas":[{"is_builtin":true}]}` 返回成功 |
| `D-149` | **P2** | `apps/obsidian/src/storage.ts:237-279`、`crates/mathslot-store/src/lib.rs:267-279`、`crates/mathslot-store/src/migrate.rs:202-220` | Desktop 与 Obsidian 导出配置字段与 `snippets` schema 分叉：Desktop 导出导入 Obsidian 静默丢 `user_formulas`/`custom_formats`；Obsidian 导出导入 Desktop 因缺 `SnippetRecord.key` 失败 | 用 `Store::export_library_json` 导出含 1 条 `user_formulas` 的 JSON 传给 `importPluginConfigJson`，结果 `userFormulas` 为空；用 `exportPluginConfigJson` 导出含 1 条片段传给 `Store::import_library_json` 报 `missing field 'key'` |
| `D-150` | **P2** | `apps/desktop/src-tauri/src/lib.rs:223-225,320-325,773`、`apps/desktop/src-tauri/src/main.rs:5-8`、`crates/mathslot-store/src/lib.rs:657-664` | 磁盘含未知 `schema_version`（如 `99`）或目录占 `library.json` 时桌面端启动直接 `exit(1)` 无 UI 提示；`HostAction::RestoreBackup { backup_path: None }` 静默忽略；`create_backup_from_bytes` 写满失败残留半截 `.bak-*` | 写入 `{"schema_version":99}` 到桌面 `library.json` 调用 `DesktopBackend::initialize_with_path` 返回 `Err`，`main.rs` 直接退出进程 |
| `D-151` | **P2** | `crates/mathslot-store/tests/data_safety_tests.rs`、`apps/desktop/src/lib/desktopClient.ts:236-283`、`apps/desktop/tests/e2e/desktop.spec.ts:244-325`、`apps/obsidian/tests/e2e/obsidian.spec.ts` | §10.5/`A-DATA` 缺超大文件上限与测试、无备份/坏备份跳过/`EISDIR`/真实子进程 `kill -9` 与孤儿 `.tmp` 重启测试；桌面浏览器桥 `importConfigJson` 拒 v1/v2 且丢 `user_formulas`；双端 Playwright E2E 缺真实恢复/重置/导入导出/失败提示用例 | 检索 `crates/mathslot-store/tests/` 无 `SIGKILL`/超大文件/无备份/坏备份跳过测试；`apps/obsidian/tests/e2e/obsidian.spec.ts` 无 `recovery-wizard` 测试 |

---

## 5. 历史结论抽查（对照 `SKILL.md` §3.3）

| 来源 | 声称 | 实测验证 | 结论 |
|---|---|---|---|
| `docs/ACCEPTANCE_REPORT_FINAL.md:41` | `"cargo clippy --workspace -- -D warnings 0 警告 PASS"` | 规范 `§1.4` / `F-004` 与 `AGENTS.md:20` 确认基线快照时 `clippy -D warnings` 实际失败；经本轮次前 G0–G3 治理后当前 `scripts/agent/acceptance.sh` 才实测 `PASS cargo clippy -D warnings (exit 0)` | **历史报告曾虚假签收**（当前分支已修复） |
| `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:115` 与 `docs/ACCEPTANCE_REPORT_FINAL.md:184-190` | `"旧 library.json 可迁移，旧公式可打开 ... 100% 达标 (PASS)"` | 历史所引 `test_criterion_10_legacy_syntax_and_shorthand_tolerance` 仅测 LaTeX 简写（`x^2`、`\frac12`）而非 `library.json` 迁移；当前在 `apps/obsidian/src/storage.ts:40-42, 237-279` 与 `crates/mathslot-store` 之间，仍存在未知版本未拒绝及双端配置 JSON 不互通（`D-148`、`D-149`） | **历史声称不实（部分 OPEN）** |

---

## 6. 下一步建议（针对 `T4.2` / `ADR-0033`）

1. **判定结论**：`T4.2` 当前为 **`BLOCK`**，请依据本报告撰写 `ADR-0033` 授权修复 `D-147`、`D-148`（P1 阻断）及 `D-149`..`D-151`（P2 补齐）后再进入实现与验收：
   - 先为 `D-147`..`D-151` 补齐 Red 失败测试（含 `SettingsPanel` 保存失败回滚、Obsidian 损坏态不覆盖 `lastValidLibraryJson` / 拒未知版本与 `is_builtin: true`、跨端配置互导、`mathslot-store` 超大文件/无备份/坏备份跳过/`EISDIR`/子进程 `SIGKILL` 测试、双端 Playwright 恢复与配置导入导出/失败提示 E2E）。
   - 修复实现后再跑全量 Rust/UI/Obsidian/Desktop 单测、E2E 与 `scripts/agent/acceptance.sh` 交独立 verifier 验收。

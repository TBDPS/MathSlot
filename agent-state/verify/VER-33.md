---
id: VER-33
round: 33
gate: G4
task: T4.2
commit: c93ac0c
base_commit: 330e817
branch: refactor/v1
defects: [D-005, D-013, D-014, D-147, D-148, D-149, D-150, D-151]
verdict: PASS
verifier: verifier
date: 2026-11-14
---

# VER-33：Gate G4 / T4.2（数据故障注入全量、恢复写锁与双端配置互通）独立验收报告

## 1. 结论

**PASS**。

提交 `c93ac0c`（相对基线 `330e817`）严格在 `ADR-0033` §3 授权路径内完成了 `D-147`、`D-148`、`D-149`、`D-150`、`D-151` 与历史回溯项 `D-005`、`D-013`、`D-014` 的测试与实现闭环：
1. 所有 Rust 门禁（`cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo clippy -p mathslot-desktop --all-targets -- -D warnings`、`cargo test --workspace --offline` 267 passed、`cargo test -p mathslot-desktop --offline` 5 passed）全部以 exit 0 通过，0 忽略测试。
2. 所有前端单测、Svelte 类型检查、构建与双端 Playwright E2E（`packages/ui` 46 passed、`apps/obsidian` 17 unit + 6 E2E passed、`apps/desktop` 5 unit + 7 E2E passed、`node obsidian-mathslot/scripts/build.mjs` 零漂移、`scripts/agent/acceptance.sh` PASS=5 FAIL=0）全部通过。
3. 静态扫描确认无任何 `#[ignore]` / `#[allow(` / `.skip(` 弱化，受触及 Rust 路径（`crates/mathslot-store/**`、`apps/desktop/src-tauri/**`）无 `.unwrap()` / `let _ =`，受触及 `.svelte` / `.ts` 文件无硬编码 hex/rgb/rgba 颜色。
4. 4 张新增 `T4.2` Playwright 截图均已逐张打开核验，恢复向导与保存失败提示均清晰可见且未伪造 `"设置已应用"`。

---

## 2. Diff 范围与静态门禁核查

### 2.1 修改路径与 Commit 元数据
- `git log -1 --oneline`: `c93ac0c4b27a045ee307affa142dc0a19cb947c5 feat(T4.2): harden data safety, fail-safe recovery, and cross-client import (D-005, D-013, D-014, D-147, D-148, D-149, D-150, D-151)`
- `git diff --name-only 330e817..c93ac0c`（共 20 文件，全部落于 `ADR-0033` §3 允许路径）：
  - `crates/mathslot-store/src/{lib.rs, migrate.rs}`, `crates/mathslot-store/tests/data_safety_tests.rs`
  - `packages/ui/src/settings/SettingsPanel.svelte`, `packages/ui/tests/settings.test.ts`
  - `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/tests/desktop_backend_tests.rs`, `apps/desktop/src/{App.svelte, lib/desktopClient.ts}`, `apps/desktop/tests/{desktopUi.test.ts, e2e/desktop.spec.ts}`
  - `apps/obsidian/src/{AppShell.svelte, MathSlotModal.ts, plugin.ts, storage.ts}`, `apps/obsidian/e2e/harness.ts`, `apps/obsidian/tests/{obsidian.test.ts, e2e/obsidian.spec.ts}`
  - `obsidian-mathslot/{main.js, styles.css}`

### 2.2 静态扫描证据
```bash
$ git diff 330e817..c93ac0c | rg -n "^\+.*(#\[ignore\]|#\[allow\(|\.skip\(|test\.skip)" || echo "ZERO_WEAKENING"
ZERO_WEAKENING

$ rg -n "\.unwrap\(|let _ =" crates/mathslot-store/ crates/mathslot-app/ apps/desktop/src-tauri/ || echo "ZERO_RUST_UNWRAP"
crates/mathslot-app/tests/t3_6_import_and_presets_tests.rs
221:    let stripped_report = stripped_preview.snapshot.last_import.as_ref().unwrap();
250:        let bad_report = bad_resp.snapshot.last_import.as_ref().unwrap();
# crates/mathslot-store/** 与 apps/desktop/src-tauri/** 均为 0 命中（含 data_safety_tests.rs:493 已改为 .expect(...)）

$ git diff 330e817..c93ac0c -- '*.svelte' '*.ts' | rg -n "^\+.*(#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\()" || echo "ZERO_HARDCODED_COLORS"
ZERO_HARDCODED_COLORS
```

---

## 3. 实跑命令与输出证据

| 检查项 | 命令 | Exit Code | 实测输出摘要 |
|---|---|---|---|
| Rust 格式 | `cargo fmt --check` | `0` | 无输出（全仓格式合规） |
| Workspace Clippy | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished dev profile [optimized + debuginfo] target(s) in 0.51s` |
| Workspace 单测 | `cargo test --workspace --offline` | `0` | 267 passed, 0 failed, 0 ignored（其中 `mathslot-store`: lib 1 + `data_safety_tests` 12 + `t3_4` 2 + `t3_5` 2 = 17 passed） |
| Desktop 后端 Clippy & 单测 | `cargo test -p mathslot-desktop --offline && cargo clippy -p mathslot-desktop --all-targets -- -D warnings` | `0` | `desktop_backend_tests`: 5 passed, 0 failed；clippy `Finished` 0 警告 |
| `@mathslot/ui` 套件 | `npm --prefix packages/ui test && npm --prefix packages/ui run check && npm --prefix packages/ui run build` | `0` | Vitest: `Test Files 8 passed (8) / Tests 46 passed (46)`；`svelte-check`: 0 errors, 0 warnings；`vite build`: `dist/index.js` built |
| `@mathslot/obsidian` 套件 | `npm --prefix apps/obsidian test && npm --prefix apps/obsidian run check && npm --prefix apps/obsidian run test:e2e` | `0` | Vitest: `1 passed (1) / 17 passed (17)`；`svelte-check`: 0 errors, 0 warnings；Playwright: `6 passed (1.0m)` |
| `@mathslot/desktop` 套件 | `npm --prefix apps/desktop test && npm --prefix apps/desktop run check && npm --prefix apps/desktop run build && npm --prefix apps/desktop run test:e2e` | `0` | Vitest: `1 passed (1) / 5 passed (5)`；`svelte-check`: 0 errors, 0 warnings；`vite build` 成功；Playwright: `7 passed (54.6s)` |
| Obsidian 构建与零漂移 | `node obsidian-mathslot/scripts/build.mjs && git status --short` | `0` | `obsidian-mathslot/main.js (3 commands, 121 catalog entries, 88/88 presets)`；`git status --short` 无输出 |
| 一键门禁 | `scripts/agent/acceptance.sh` | `0` | `PASS cargo fmt --check`, `PASS cargo clippy -D warnings`, `PASS cargo test --workspace`, `PASS 调色板一致性 (gate=G4)`, `PASS 工作区干净` (`PASS=5 FAIL=0 WARN=3`, 结论 `PASS`) |

---

## 4. 逐项验收与缺陷闭环核查

| 编号 / 验收项 | 规范 / ADR 要求 | 源码与测试核查证据 | 判定 |
|---|---|---|---|
| `D-147` / `INV-003` / `A-DATA-002..003` | 持久化成功后再置 `'saved'` 与更新内存；失败保留 `isDirty` 并显式报错 | `packages/ui/src/settings/SettingsPanel.svelte` (`saveFeedback` 先置 `'saving'`，`await` 成功后才更新 `lastSyncedPropSnapshot` 与 `'saved'`，catch 后置 `'error'` 并展示 `data-testid="settings-save-error"`)；`apps/desktop/src/App.svelte` 不再吞错；`apps/desktop/src-tauri/src/lib.rs` 克隆 `candidate_app` 并在磁盘失败时回滚 `store` 设置/公式；`apps/obsidian/src/{plugin.ts, storage.ts, AppShell.svelte}` 先 `await saveData(nextData)` 再 `Object.assign` 提交状态。测试：`packages/ui/tests/settings.test.ts`、`desktop_backend_tests::test_d147_desktop_backend_disk_before_memory_on_save_failure`、`desktopUi.test.ts`、`obsidian.test.ts`。 | **PASS** |
| `D-148` / `D-013` / `D-014` / `INV-005` | 隔离态写锁；Obsidian 拒未知版本/非数组/`is_builtin:true`/坏内嵌 JSON、非 `Date.now()` ID、去重隔离、自动开启与刷新 | `apps/desktop/src-tauri/src/lib.rs` 在 `app.recovery().is_some()` 时阻断 `UpdateSettings` / `ResetSettingsConfirmed` / `RequestSaveSnippet` / `save_user_formula`；`apps/obsidian/src/storage.ts` 实现 `isLibraryValidForWrites` 写锁、`validateParsedLibrary`（严格 `1 \| 2 \| 3` 整数版本、数组校验、`hasBuiltinTrueFlag`）、`generateUniqueId`（`crypto.randomUUID` + 单调序列回退）、去重 `backupJson`、非字符串 `raw` 容错、严格校验内嵌 `libraryJson`；`plugin.ts` & `AppShell.svelte` 自动打开 `initialSettingsOpen` 并刷新 `userFormulas`。测试：`desktop_backend_tests::test_d148_and_d150_*`、`obsidian.test.ts`。 | **PASS** |
| `D-149` | Desktop 与 Obsidian 配置 JSON 双向无损互导 | `crates/mathslot-store/src/migrate.rs` (`parse_snippets_field`, `parse_obsidian_formula_entry`, `check_not_builtin`) 兼容导入 Obsidian `customFormats` / `snippets: UserFormulaEntry[]` / camelCase 设置并分配 UUIDv7；`apps/obsidian/src/storage.ts` (`exportPluginConfigJson`, `importPluginConfigJson`) 同时输出/读取 `custom_formats` / `user_formulas` / `overrides` 与 `customFormats` / `snippets`。测试：`data_safety_tests::t_data_011_import_obsidian_exported_json_and_reject_builtin`、`obsidian.test.ts`、`desktopUi.test.ts`、`desktop.spec.ts`、`obsidian.spec.ts`。 | **PASS** |
| `D-150` | 16 MiB 上限、原子 `.bak` 无残留、非致命启动恢复、`RestoreBackup(None)` 回退 | `crates/mathslot-store/src/lib.rs` 定义 `MAX_LIBRARY_FILE_BYTES = 16 * 1024 * 1024` 并在 `load_or_recover_with_catalog` / `restore_from_backup` / `import_library_json` / `find_newest_valid_backup` 校验长度；`create_backup_from_bytes_with_hook` 先写同目录临时文件再 `persist_noclobber`（单测 `d150_failed_backup_creation_leaves_no_partial_bak_or_tmp_files` 验证 `ENOSPC` 无 `.bak`/`.tmp` 残留）；`apps/desktop/src-tauri/src/lib.rs` 对 `UnsupportedSchemaVersion`、`FileTooLarge`、`EISDIR` 非致命进入恢复态，`restore_backup(None)` 读取 `recovery.backup_candidate`。测试：`desktop_backend_tests::test_d150_nonfatal_startup_on_unsupported_schema_oversized_and_eisdir`。 | **PASS** |
| `D-151` / `D-005` / `A-DATA-001..006` | `t_data_008..011`、真实 `kill -9` + 孤儿 `.tmp*` 清理、`desktopClient.ts` v1/v2/v3、双端 E2E 恢复与失败流程 | `crates/mathslot-store/tests/data_safety_tests.rs` 新增 `t_data_008`（16 MiB 超限拒载与超大 `.bak` 跳过）、`t_data_009`（无备份、最新 `.bak` 损坏跳过、全 `.bak` 损坏、`EISDIR`、字段边界）、`t_data_010`（真实子进程 `sigkill_mid_write_child_helper` 写入 `.tmpSIGKILL_ORPHAN` 中被 `kill -9` 强杀，重启 `load_or_recover` 正常加载 `Gen 2 Safe` 并通过 `cleanup_orphan_temp_files` 清理孤儿 `.tmp*`）、`t_data_011`；`apps/desktop/src/lib/desktopClient.ts` 支持 v1/v2/v3 与恢复锁、恢复/重置更新 `userFormulas`；`desktop.spec.ts` 与 `obsidian.spec.ts` 覆盖真实点击恢复、二次确认重置、保存失败横幅、跨端文件导入。 | **PASS** |

---

## 5. 视觉截图核验（`read_file` 实查）

1. `apps/desktop/.e2e-artifacts/desktop-recovery-wizard.png`：清晰显示红色恢复向导横幅 `"数据安全保护 检测到配置文件损坏，已安全隔离（未覆盖原文件）"`、`错误原因`、`隔离路径`、`可用备份`，以及 `"从最近备份恢复"` 与 `"重置为空配置..."` 按钮，顶部状态栏同步提示 `"检测到配置损坏，已启用恢复向导"`。
2. `apps/desktop/.e2e-artifacts/desktop-settings-save-error.png`：清晰显示红色错误横幅 `保存失败（未更改磁盘或内存状态）： PermissionDenied: read-only config directory` 与顶部 toast `"操作失败: PermissionDenied: read-only config directory"`，无 `"设置已应用"` 假绿反馈。
3. `apps/obsidian/.e2e-artifacts/obsidian-recovery-wizard.png`：自动弹出设置并展示红色恢复向导，隔离路径采用 UUID (`obsidian://plugin-data/backupJson/corrupt-2a829c3c-cbca-44d6-a16e-1db8fa440f8c`)，显示可用备份 `obsidian://plugin-data/lastValidLibraryJson` 与恢复/重置按钮，顶部标示 `"有未保存更改"`。
4. `apps/obsidian/.e2e-artifacts/obsidian-settings-save-error.png`：清晰显示红色错误横幅 `保存失败（未更改磁盘或内存状态）： EACCES: simulated read-only disk failure`，布局无遮挡，无 `"设置已应用"` 提示。

---

## 6. 未验证 / 说明

- `apps/desktop` 的 Playwright E2E（与 `obsidian.spec.ts`）通过浏览器宿主桥/harness 测试 UI 交互与异常分支，真实桌面磁盘文件权限与 `EISDIR`/`UnsupportedSchemaVersion`/`SIGKILL` 故障注入由 `desktop_backend_tests.rs` 与 `mathslot-store` `data_safety_tests.rs` 覆盖。
- `scripts/agent/acceptance.sh` 中既有全仓 `WARN`（历史预存 `let _ =` 9 / `unwrap()` 20 / 命令表 3）不阻断本轮 `T4.2`（`c93ac0c` 在受触及 Rust 路径新增 0 处）。

---
id: VER-15
round: 15
task: T2.3
defects: [D-005, D-006, D-013, D-014, D-022, D-102]
verdict: PASS
verifier: verifier
date: 2026-11-14
---

# MathSlot 独立验收报告 (VER-15)

- **验收角色**：verifier（独立只读验收员；严格遵守 `AGENTS.md` 与 `.agents/skills/independent-verify/SKILL.md`，未修改任何产品代码、测试代码、配置或脚本，未采信实现者自述）
- **工作目录**：`/home/mat/Projects/mathslot-next`，分支 `refactor/v1`
- **待验提交**：`0497fc3fec7894e200c0ee741203b934f0935682` (`0497fc3`，相对基线 `ac9cae4`)
- **提交信息**：`T2.3: implement mathslot-store atomic persistence and fix D-005 D-006 D-013 D-014 D-022 D-102`
- **验收基准**：`docs/LLM_IMPLEMENTATION_SPEC.md` §10, §14 (`T2.3`, `A-DATA-001..006`)、`agent-state/decisions/ADR-0018-mathslot-store-and-data-safety-t2.3.md`、`agent-state/audits/AUD-15.md`
- **综合裁定**：**PASS**

---

## 1. 结论

**PASS**。
经逐行核查 `git show --stat 0497fc3`、`git diff ac9cae4..0497fc3`、新增/修改文件源码与测试实现，并亲自离线运行全量构建、clippy、fmt、wasm32 检查、单元测试与门禁脚本，Round 15 (`T2.3`) 满足 `ADR-0018` 与规范 §10、§14 全部要求：

1. **提交信息与变更作用域合规**：
   - 单提交 `0497fc3` 明确标注 `T2.3` 及全部目标缺陷 `D-005 D-006 D-013 D-014 D-022 D-102`；
   - 变更严格限定在 `ADR-0018` 允许的 14 个路径内（`Cargo.toml`、`Cargo.lock`、`catalog/presets.json`、`crates/mathslot-store/**`、`crates/mathslot-core/src/library.rs`、`crates/mathslot-core/tests/p1_regression_tests.rs`、`src/{app,modals,p1_regression_tests}.rs`），冻结文件 `crates/mathslot-core/src/{parser,ast,latex}.rs` 与 `crates/mathslot-{syntax,doc,latex,command,app,wasm}`、`scripts/agent/**`、`docs/**`、`agent-state/**` 零改动。
2. **代码卫生与红线检查通过**：
   - `crates/mathslot-store/src/lib.rs:1` 强制 `#![forbid(unsafe_code)]`；
   - diff 扫描零新增 `let _ =`、零新增 `#[allow]`、零新增 `#[ignore]`、零 `unsafe`、产品代码零新增 `.unwrap()`（diff 唯一 `.unwrap()` 位于测试 `crates/mathslot-store/tests/data_safety_tests.rs:479`）；
   - `src/app.rs` 与 `src/modals.rs` 中原有 8 处持久化 `let _ =`（6 处调用点 + 2 处内部 IO）全部清零，`acceptance.sh` 全仓 `let _ =` 计数由基线 24 降至 16，错误均经 `match` 进入 `self.feedback` / `self.status` / `StoreError` 显式展示。
3. **P1 回归测试解冻且命中真实生产路径**：
   - `src/p1_regression_tests.rs:122-177` 移除 `#[ignore]`，直接调用 `crate::modals::load_library_from_path` 与 `crate::modals::save_library_to_path`，验证损坏 JSON 隔离为 `library.corrupt-*.json`、阻塞静默覆盖、完整保留原始损坏字节；
   - `crates/mathslot-core/tests/p1_regression_tests.rs:121-154` 移除 `#[ignore]`，`FormulaLibrary::upsert` 同毫秒 1000 次插入实测 1000 条全部唯一、无碰撞；
   - 剩余 2 项既有 `#[ignore]`（`D-003`、`D-007`）完整保留，实测 `-- --ignored` 仍以 exit `101` 真实失败。
4. **预置目录分离与数据安全契约全部实测通过**：
   - `catalog/presets.json`（`schema_version: 1`）包含 88 条预置、88 个唯一 `preset-<slug>` ID 与 88 个唯一 `preset-001..088` `legacy_id`，与 `crates/mathslot-core/src/presets.rs` 逐条校验一致；
   - `LibraryFile` v3 仅落盘用户数据，不写入内置预置；`import_formulas_json`（strict 拒绝 / normalizing 剥离）、`dry_run_migrate`（v3 拒绝 `is_builtin: true`）与 `FormulaLibrary::import_json`（强制 `is_builtin = false`）均阻断内置条目混入用户存储；
   - `crates/mathslot-store/tests/data_safety_tests.rs` 全部 7 项测试（`T-DATA-001..007`）原生运行通过，覆盖 `A-DATA-001..006`、3 平台纯路径解析、原子写序（`NamedTempFile::new_in` → `write_all` → `flush` → `sync_all_file` → 成功后再轮转 3–5 代备份 → `persist` → Unix `sync_dir`）、`WriteZero`/`ENOSPC` 与 `PermissionDenied` 不静默回退、1000 突发 UUIDv7 + `StoreError::Conflict` 并发冲突、损坏隔离 + 候选备份预览、v1/v2→v3 无损迁移与严格 JSON 字面量/尾部垃圾校验。

---

## 2. 命令与输出实录

### 2.1 Git 提交、作用域与红线扫描

```bash
$ git show --stat 0497fc3fec7894e200c0ee741203b934f0935682
commit 0497fc3fec7894e200c0ee741203b934f0935682 (HEAD -> refactor/v1)
Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
Date:   Sat Nov 14 07:37:00 2026 +0800

    T2.3: implement mathslot-store atomic persistence and fix D-005 D-006 D-013 D-014 D-022 D-102

 Cargo.lock                                        |   81 ++
 Cargo.toml                                        |    2 +
 catalog/presets.json                              | 1097 +++++++++++++++++++++
 crates/mathslot-core/src/library.rs               |  485 +++++----
 crates/mathslot-core/tests/p1_regression_tests.rs |    1 -
 crates/mathslot-store/Cargo.toml                  |   16 +
 crates/mathslot-store/src/catalog.rs              |   63 ++
 crates/mathslot-store/src/lib.rs                  |  834 ++++++++++++++++
 crates/mathslot-store/src/migrate.rs              |  504 ++++++++++
 crates/mathslot-store/src/paths.rs                |   47 +
 crates/mathslot-store/tests/data_safety_tests.rs  |  740 ++++++++++++++
 src/app.rs                                        |   21 +-
 src/modals.rs                                     |  352 +++++--
 src/p1_regression_tests.rs                        |   81 +-
 14 files changed, 3995 insertions(+), 329 deletions(-)
```

```bash
$ git diff --name-status ac9cae4..0497fc3
M	Cargo.lock
M	Cargo.toml
A	catalog/presets.json
M	crates/mathslot-core/src/library.rs
M	crates/mathslot-core/tests/p1_regression_tests.rs
A	crates/mathslot-store/Cargo.toml
A	crates/mathslot-store/src/catalog.rs
A	crates/mathslot-store/src/lib.rs
A	crates/mathslot-store/src/migrate.rs
A	crates/mathslot-store/src/paths.rs
A	crates/mathslot-store/tests/data_safety_tests.rs
M	src/app.rs
M	src/modals.rs
M	src/p1_regression_tests.rs
```
- **退出码**：`0`

```bash
$ git diff ac9cae4..0497fc3 | grep -n -E '^\+.*(let _ =|#\[allow|#\[ignore|unsafe\b|\.unwrap\()' || true
3853:+                    .unwrap()
# 唯一匹配位于测试文件 crates/mathslot-store/tests/data_safety_tests.rs:479
# 产品代码零新增 let _ =、#[allow]、#[ignore]、unsafe、.unwrap()

$ rg -n 'let _ =' src/ crates/
src/devshot.rs:58:                    let _ = pixmap.save_png(&path);
src/render.rs:90:        let _ = self.tx_job.send(job);
crates/mathslot-wasm/src/lib.rs:69:            let _ = Vec::from_raw_parts(ptr, 0, cap);
...
# src/app.rs、src/modals.rs、crates/mathslot-store/、crates/mathslot-core/src/library.rs 均无 let _ =

$ rg -n '#\[ignore' src/ crates/
src/p1_regression_tests.rs:90:#[ignore = "P1 regression: D-003 (fails until fixed in G1/G2/G4)"]
crates/mathslot-core/tests/p1_regression_tests.rs:162:#[ignore = "P1 regression: D-007 (fails until fixed in G1/G2/G4)"]
```

```bash
$ python3 -c 'import json; d=json.load(open("catalog/presets.json")); print("schema:", d["schema_version"], "count:", len(d["presets"]), "unique_ids:", len({p["id"] for p in d["presets"]}), "unique_legacy:", len({p["legacy_id"] for p in d["presets"]}))'
schema: 1 count: 88 unique_ids: 88 unique_legacy: 88
```
- **退出码**：`0`

### 2.2 `cargo fmt --check` 与 `cargo clippy`

```bash
$ cargo fmt --check && echo "EXIT:$?"
EXIT:0
```
- **退出码**：`0`

```bash
$ cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.96s
```
- **退出码**：`0`

### 2.3 `cargo test -p mathslot-store --offline`

```bash
$ cargo test -p mathslot-store --offline
   Compiling mathslot-core v0.7.0 (/home/mat/Projects/mathslot-next/crates/mathslot-core)
   Compiling mathslot-store v0.7.0 (/home/mat/Projects/mathslot-next/crates/mathslot-store)
    Finished `test` profile [optimized + debuginfo] target(s) in 6.77s
     Running unittests src/lib.rs (target/debug/deps/mathslot_store-411fc58c0572dda5)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/data_safety_tests.rs (target/debug/deps/data_safety_tests-025bbc0318591a4b)

running 7 tests
test t_data_002_enospc_write_zero_and_permission_denied ... ok
test t_data_001_not_found_zero_writes_and_88_catalog_presets_not_persisted ... ok
test t_data_004_corrupt_quarantine_backup_candidate_and_rotation_bounds ... ok
test t_data_006_three_os_path_resolution ... ok
test t_data_007_strict_json_rejects_malformed_literals_and_trailing_garbage ... ok
test t_data_005_v1_v2_to_v3_lossless_migration_and_builtin_import_guard ... ok
test t_data_003_1000_burst_uuidv7_conflict_and_concurrent_saves ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```
- **退出码**：`0`

### 2.4 `cargo test --workspace --offline`

```bash
$ cargo test --workspace --offline
...
     Running unittests src/main.rs (target/debug/deps/mathslot-6f67df878b399159)
test p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds ... ignored, P1 regression: D-003 (fails until fixed in G1/G2/G4)
test p1_regression_tests::test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file ... ok
test result: ok. 5 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.38s
...
     Running tests/p1_regression_tests.rs (target/debug/deps/p1_regression_tests-55223c65b829dedf)
test test_p1_d007_latex_import_reports_lossy_and_blocks_degradation ... ignored, P1 regression: D-007 (fails until fixed in G1/G2/G4)
test test_p1_d006_formula_upsert_same_millisecond_no_collision ... ok
test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s
...
     Running tests/data_safety_tests.rs (target/debug/deps/data_safety_tests-1d1380c0a8fcecbb)
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
...
     Running tests/golden_tests.rs (target/debug/deps/golden_tests-d953841e0a940f8f)
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```
- **退出码**：`0`
- **汇总**：全工作区 `203 passed; 0 failed; 2 ignored`（较 Round 14 的 `194 passed; 4 ignored` 增加 2 项解冻 P1 测试 + 7 项 `mathslot-store` 测试，`D-003` 与 `D-007` 保持 `ignored`）。

既定未修复 P1 负向回归复验：
```bash
$ cargo test --workspace --offline -- --ignored
test p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds ... FAILED
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.00s
# 退出码 101

$ cargo test -p mathslot-core --offline -- --ignored
test test_p1_d007_latex_import_reports_lossy_and_blocks_degradation ... FAILED
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
# 退出码 101
```

### 2.5 `cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline`

```bash
$ cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.08s
```
- **退出码**：`0`

### 2.6 `scripts/agent/acceptance.sh`

```bash
$ scripts/agent/acceptance.sh
== MathSlot 门禁（/home/mat/Projects/mathslot-next）==
时间：2026-11-14T07:40:46+08:00


结果 检查项                    说明
------ ---------------------------- ----
PASS   cargo fmt --check            exit 0
PASS   cargo clippy -D warnings     exit 0
PASS   cargo test --workspace       exit 0
PASS   调色板一致性           exit 0（gate=G2）
WARN   let _ = 计数               16 处（G4 前应清零）
WARN   unwrap() 计数              22 处（用户输入路径应为 0）
WARN   命令表常量              3 处（G1 后应只剩 catalog）
WARN   工作区未提交           2 个文件

PASS=4 FAIL=0 WARN=4
结论：PASS
```
- **退出码**：`0`（2 个未跟踪文件为 `agent-state/audits/AUD-15.md` 与 `agent-state/decisions/ADR-0018-mathslot-store-and-data-safety-t2.3.md`）。

---

## 3. 逐项验收对照表

| 验收 / 缺陷 ID | 期望契约 (`LLM_IMPLEMENTATION_SPEC.md` §10 / `ADR-0018`) | 源码定位与实测证据 | 判定 |
|---|---|---|---|
| **A-DATA-001** | 损坏 JSON 隔离为 `library.corrupt-*.json` 并保留原件，挂载最近可用备份候选供恢复向导，主文件不被覆盖；`NotFound` 不写空文件 | [`crates/mathslot-store/src/lib.rs:574-602,612-620,646-711`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L574-L711)、[`src/modals.rs:121-192,1852-1926`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L121-L192)；`t_data_001`、`t_data_004`、`test_p1_d005_*` 全过 | **PASS** |
| **A-DATA-002** | 磁盘满 (`ENOSPC`/`WriteZero`) 写入失败可见，原文件逐字节不变，且不轮转生成无效备份、不留僵尸 `.tmp` | [`crates/mathslot-store/src/lib.rs:808-834`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L808-L834)（先写 `NamedTempFile` 并 `sync_all_file`，**成功后再** `create_backup_from_bytes` → `persist` → `sync_dir`）；`t_data_002` 通过 | **PASS** |
| **A-DATA-003** | 只读目录/无权限返回明确 `StoreError::PermissionDenied`，禁止静默回退默认库或假装已保存；消除 8 处 `let _ =` | [`crates/mathslot-store/src/lib.rs:440-451,618,643,759,775`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L440-L451)、[`src/app.rs:93-95,138-141,199-208`](file:///home/mat/Projects/mathslot-next/src/app.rs#L199-L208)、[`src/modals.rs:321-328,414-426,446-458,597-606,808-815`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L321-L328)；`t_data_002` 通过、`rg 'let _ ='` 降至 16 | **PASS** |
| **A-DATA-004** | 写入中崩溃（`kill -9` 模拟）不毁主文件，保留 3–5 代轮转备份可用于恢复 | [`crates/mathslot-store/src/lib.rs:30-32,515-541,808-831`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L515-L541)；`t_data_004` 验证 7 代写入稳定保留 5 代备份与恢复候选 | **PASS** |
| **A-DATA-005** (`D-006`, `D-102`) | 同毫秒创建 1000 条公式无碰撞（单调 UUIDv7）；`fd-lock` 文件锁 + 乐观并发 `FileRevision` 冲突检测（`StoreError::Conflict`）消除固定 `.tmp` 竞态 | [`crates/mathslot-core/src/library.rs:15-95,352-354`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L15-L95)、[`crates/mathslot-store/src/lib.rs:761-802`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/lib.rs#L761-L802)；`t_data_003` 与 `test_p1_d006_*` 通过 | **PASS** |
| **A-DATA-006** (`D-013`, `D-014`) | v1/v2→v3 先备份再 dry-run 迁移并生成 `id_migration_map`，仅用户数据落盘，88 预置由 `catalog/presets.json` 编译期加载并支持 `PresetOverride`；严格 JSON 拒绝 `tru`/`nul`/`1e`/尾部垃圾/未知 `schema_version` 及 `is_builtin: true` 导入 | [`catalog/presets.json`](file:///home/mat/Projects/mathslot-next/catalog/presets.json)、[`crates/mathslot-store/src/catalog.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/catalog.rs)、[`crates/mathslot-store/src/migrate.rs:182-504`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/migrate.rs#L182-L504)、[`crates/mathslot-core/src/library.rs:483-485,880-888,1169-1415`](file:///home/mat/Projects/mathslot-core/src/library.rs#L1169-L1415)；`t_data_001`、`t_data_005`、`t_data_007` 通过 | **PASS** |
| **D-022 / INV-010** | 三平台标准配置路径（Linux `XDG`/`~/.config`、macOS `Library/Application Support`、Windows `%APPDATA%`） | [`crates/mathslot-store/src/paths.rs:1-47`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/paths.rs#L1-L47)、[`src/modals.rs:1832-1834`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1832-L1834)；`t_data_006` 通过 | **PASS** |

---

## 4. 阻断原因

无（本轮判定 **PASS**）。

---

## 5. 未验证项与风险提示

1. **macOS 与 Windows 原生宿主执行未测**：
   - `t_data_006` 已在 Linux 上验证了 `library_path_for_linux`、`library_path_for_macos`、`library_path_for_windows` 三平台纯路径拼接逻辑及 Linux 宿主上的 `dirs::config_dir()`，但受限于当前 Linux 环境，未在 macOS 与 Windows 原生机器上实测 `dirs::config_dir()`、文件锁（`fd-lock`）与文件替换语义。
2. **恢复向导 UI 渲染未做人工截图目视核查**：
   - `src/modals.rs:121-192` 新增的 `render_recovery_banner` 在逻辑与 `test_p1_d005_*` 中已验证阻断保存与恢复会话状态，但本轮未启动桌面 GUI 对损坏弹窗横幅进行截图目视核查（留待 G3/G4 UI 阶段统一验证）。
3. **Git 提交粒度说明**：
   - 历史记录中 `0497fc3` 为单次实现与测试合并提交（未先提交独立红灯提交），但 `AUD-15.md` 已在 `ac9cae4` 记录了 `D-005`、`D-006` 的实测失败（exit 101），且本次独立逐行审查确认 `T-DATA-001..007` 与解冻后的 P1 测试均为真实有效断言。

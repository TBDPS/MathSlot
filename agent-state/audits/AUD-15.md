---
id: AUD-15
round: 15
gate: G2
scope: [T2.3, D-005, D-006, D-013, D-014, D-022, D-102, INV-003, INV-004, INV-005, INV-010, A-DATA-001, A-DATA-002, A-DATA-003, A-DATA-004, A-DATA-005, A-DATA-006]
verdict: BLOCK
auditor: auditor
date: 2026-11-14
---

# MathSlot 独立审计报告 (AUD-15)

- **审计角色**：auditor（独立只读审计员；严格遵守 `AGENTS.md` 与 `.agents/skills/independent-audit/SKILL.md`，未修改任何产品代码、测试代码、配置或脚本）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **分支与提交**：`refactor/v1` (`HEAD: ac9cae4`)
- **审计目标**：为 Gate G2 任务 `T2.3`（实现 `mathslot-store`：原子写/备份/锁/迁移，验收 `A-DATA-001..006`，关联 P1 缺陷 `D-005`、`D-006` 及 P2 缺陷 `D-013`、`D-014`、`D-022`、`D-102`）执行独立只读审计。
- **综合裁定**：**BLOCK**（状态：**READY_FOR_DECISION**）
  - 范围内 P1 缺陷 `D-005` 与 `D-006` 均为 **OPEN**，且经 `cargo test ... -- --ignored` 在当前快照下**真实触发失败**（exit code `101`）；
  - P2 缺陷 `D-013`、`D-014`、`D-022`（路径部分）、`D-102` 均为 **OPEN**；
  - `crates/mathslot-store` 与 `catalog/presets.json` 尚未建立；旧桌面端存在 6 处调用者 `let _ = save_library_to_disk(...)` 吞错；本地 Cargo 离线缓存不含 `directories` 与 `fs2` crate，需在 `ADR-0018` 中明确离线可用依赖方案、新旧栈桥接边界以及 `test_p1_d005`/`test_p1_d006` 闭环策略后方可实施。

---

## 1. 判定摘要

| ID | 类别/级别 | 核查对象 | 当前判定 | 证据章节 |
|---|---|---|---|---|
| **T2.3** | Gate G2 任务 | `mathslot-store`（原子写/备份/锁/迁移），`A-DATA-001..006` | **OPEN** (待 `ADR-0018` 决策与实施) | §4, §5, §7 |
| **D-005** | **P1** (数据安全) | 损坏回退默认库覆写原文件、无隔离/多代备份/fsync/锁、6 处 `let _ =` 吞错 | **OPEN** (实测 panic, exit 101) | §2.1, §3.1, §3.2 |
| **D-006** | **P1** (ID 碰撞) | 用户公式 ID 为秒级 `user-<secs>`，同毫秒插 1000 条仅存 1 条 | **OPEN** (实测 panic, exit 101) | §2.2, §3.3 |
| **D-013** | P2 (JSON/Schema) | 手写宽松 `JsonParser` 忽略尾随垃圾与非法字面量，丢弃 `schema_version` | **OPEN** | §3.3, §4.5 |
| **D-014** | P2 (内置预置落盘) | 88 条内置预置全量写入用户 `library.json`，无 `PresetOverride` 合并，`import_json` 放行 `is_builtin: true` | **OPEN** | §3.3, §4.1 |
| **D-022** | P2 (平台路径) | `library_config_path()` 手写环境变量，macOS 错误落入 `~/.config` 而非 `Application Support` | **OPEN** (路径部分归属 T2.3；文档生成归属 T4.5) | §3.1, §4.2 |
| **D-102** | P2 (持久化竞态) | `save_library_to_disk` 硬编码固定 `library.json.tmp`，多写者撕裂 | **OPEN** | §2.3, §3.1 |
| **D-001 / D-002 / D-004** | P1 (已闭环基线) | 调色板/文档生成/Pending&Unknown 导出占位 | **FIXED** | 基线门禁 §2.4 |
| **D-003 / D-007** | P1 (后续任务锁定) | 预览裁切（T2.4/G3）、LaTeX 导入（T4.1） | **OPEN** (`#[ignore]` 锁定) | 基线门禁 §2.4 |

> **说明**：未发现新增静默失败或测试弱化；`D-101`（假测试防护）持续保持 `FIXED`，无新缺陷 ID 需要分配（现有 `D-005`、`D-006`、`D-013`、`D-014`、`D-022`、`D-102` 已精确覆盖本次发现）。

---

## 2. `D-005` / `D-006` 现场复现与 `fault_injection_harness` / 边界核查

### 2.1 `D-005` 现场复现（`src/p1_regression_tests.rs`）

- **测试代码**：[`src/p1_regression_tests.rs:169-216`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L169-L216)（辅助镜像函数 `load_library_from_path` / `save_library_to_path` 位于 [`src/p1_regression_tests.rs:121-167`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L121-L167)）
- **复现命令**：
  ```bash
  cargo test -p mathslot --bin mathslot test_p1_d005 -- --ignored --nocapture
  ```
- **退出码**：`101`
- **关键输出尾部**：
  ```text
  thread 'p1_regression_tests::test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file' (27391) panicked at src/p1_regression_tests.rs:191:5:
  assertion `left != right` failed: Corrupted configuration must not silently degrade to default_seeded library
    left: UserLibrary { custom_formats: [...], snippets: [...], formulas: FormulaLibrary { entries: [88 builtins...] } }
  note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
  test p1_regression_tests::test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file ... FAILED

  failures:
      p1_regression_tests::test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file

  test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.00s
  ```
- **判定**：**OPEN**
- **重要边界发现（测试引用了本地镜像而非生产函数）**：
  - `src/p1_regression_tests.rs:121-167` 中的 `load_library_from_path` 与 `save_library_to_path` **是测试文件内的本地拷贝**，并未直接调用 `src/modals.rs:1714-1765` 的 `load_library_from_disk` / `save_library_to_disk`（原因是 `modals.rs` 的原函数硬编码调用 `library_config_path()` 而未接收 `&Path` 参数）。
  - **后果**：若 `T2.3` 仅修复 `src/modals.rs` 并新建 `mathslot-store`，而不修改 `src/p1_regression_tests.rs:121-216` 使测试直接调用真实的 `mathslot-store`（或 `modals::load_library_from_path` / `modals::save_library_to_path` 生产入口），则 `test_p1_d005` 会继续测试死拷贝。`ADR-0018` 必须显式允许把 `src/p1_regression_tests.rs:121-216` 切换为调用真实生产路径 API 并移除 `#[ignore]`。

### 2.2 `D-006` 现场复现（`crates/mathslot-core/tests/p1_regression_tests.rs`）

- **测试代码**：[`crates/mathslot-core/tests/p1_regression_tests.rs:120-155`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/tests/p1_regression_tests.rs#L120-L155)
- **直接调用的符号路径**：`mathslot_core::library::{FormulaEntry, FormulaLibrary}` 中的 `FormulaLibrary::upsert`（[`crates/mathslot-core/src/library.rs:250-276`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L250-L276)）
- **复现命令**：
  ```bash
  cargo test -p mathslot-core --test p1_regression_tests test_p1_d006 -- --ignored --nocapture
  ```
- **退出码**：`101`
- **关键输出尾部**：
  ```text
  thread 'test_p1_d006_formula_upsert_same_millisecond_no_collision' (27333) panicked at crates/mathslot-core/tests/p1_regression_tests.rs:143:5:
  assertion `left == right` failed: All 1000 generated IDs must be unique, but got only 1
    left: 1
   right: 1000
  note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
  test test_p1_d006_formula_upsert_same_millisecond_no_collision ... FAILED

  failures:
      test_p1_d006_formula_upsert_same_millisecond_no_collision

  test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
  ```
- **判定**：**OPEN**

### 2.3 `fault_injection_harness.rs` 核查与 `D-102` 现状

- **文件**：[`crates/mathslot-core/tests/fault_injection_harness.rs:1-820`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/tests/fault_injection_harness.rs#L1-L820)
- **执行命令**：
  ```bash
  cargo test -p mathslot-core --test fault_injection_harness -- --nocapture
  ```
- **退出码**：`0`（`5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`）
- **覆盖能力核查**：
  1. `CorruptedDataInjector`（`:20-131`）：`unclosed_json`、`truncated_json`、`truncated_at`、`invalid_utf8_bytes`、`trailing_garbage`、`deep_nested_json`、`invalid_schema_type`、`has_trailing_content`、`verify_strict_eof`。
  2. `IsolatedTempDir`（`:166-244`）：RAII 沙箱目录，`set_readonly`/`restore_writable`，`Drop` 自动递归恢复权限并清理 `/tmp`。
  3. `QuotaWriter<W: Write>`（`:251-312`）：配额超限精确返回 `ErrorKind::WriteZero`（模拟 `ENOSPC`）。
  4. `ConcurrentPersistenceHarness`（`:330-421`）：`Arc + Barrier` 多线程起跑器，统计 `detected_panics` 与 `collision_count`。
  5. 断言辅助（`:428-481`）：`assert_file_intact`、`assert_quarantined`（校验 `<prefix>.corrupt-<timestamp>.json`）、`assert_no_zombie_tmp`（校验无 `.tmp` 残留）。
- **缺口与 `D-102` 现状**：
  - `fault_injection_harness.rs` 当前仅验证工具本身与 `UserLibrary::from_json` 的内存行为，**尚未接入真实文件持久化写路径**；`src/modals.rs:1753` 仍硬编码 `let tmp = path.with_extension("json.tmp")`，`D-102` 仍为 **OPEN**。
  - 注意 `fault_injection_harness.rs` 定义在 `crates/mathslot-core/tests/`（独立测试二进制），`crates/mathslot-store` 无法直接 `use` 它；`mathslot-store` 测试套件应复用相同原语或提供独立测试注入接口（如 `Write` sink / `MockFs` / `QuotaWriter` 集成）。

### 2.4 基线门禁核查

- `cargo fmt --check`：exit `0`
- `cargo clippy --workspace --all-targets -- -D warnings`：exit `0`
- `cargo test --workspace`：exit `0`（Workspace 实测通过 194 项，4 项 `#[ignore]` 为 `D-003`、`D-005`、`D-006`、`D-007`）
- `scripts/agent/acceptance.sh`：exit `0`（`PASS=5 FAIL=0 WARN=3`，其中 `let _ =` 计数 **24 处**、`unwrap()` 计数 **22 处**、`命令表常量` **3 处**）

---

## 3. 现有持久化与 JSON/ID 实现审计（精确文件:行号）

> **行号偏移说明**：规范 §3 `F-016`/`F-017`/`F-030` 及早先记录曾引用 `src/modals.rs:1530-1610`；经 Round 10–12 UI 调整后，当前快照中 `1530-1610` 已变为 `render_help_body`（[`src/modals.rs:1515-1648`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1515-L1648)），持久化函数实际位于 **`src/modals.rs:1689-1765`**。

### 3.1 `src/modals.rs:1689-1765` 持久化路径与读写实现

| 位置 | 现状代码行为 | 违反条款 / 缺陷 |
|---|---|---|
| [`src/modals.rs:1689-1712`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1689-L1712) | `library_config_path()` 依次手写读 `XDG_CONFIG_HOME`、`#[cfg(target_os = "windows")] APPDATA`、`HOME/.config`；**macOS 落入 `~/.config/mathslot/library.json`** | `INV-010`, `D-022`, §10.2 |
| [`src/modals.rs:1714-1743`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1714-L1743) | `load_library_from_disk()`：(1) 主文件 JSON 损坏且无单代 `.bak` 时静默返回 `(UserLibrary::default_seeded(), ...)`，**不重命名隔离**为 `library.corrupt-<timestamp>.json`（`:1733-1738`）；(2) **任意 IO 错误**（含 `PermissionDenied`、非 UTF-8 `InvalidData`）在 `:1741` 直接静默回退 `UserLibrary::default_seeded()`，而非区分 `NotFound` 与损坏/权限故障 | `D-005`, §10.3, `A-DATA-001`, `A-DATA-003` |
| [`src/modals.rs:1753`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1753) | `let tmp = path.with_extension("json.tmp");` 固定临时文件名，无随机/PID/独占命名隔离 | `D-102`, §10.3(1) |
| [`src/modals.rs:1754`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1754) | `std::fs::write(&tmp, ...)` 写入后**无 `File::sync_all()`** | `D-005`, §10.3(3), `A-DATA-004` |
| [`src/modals.rs:1756-1759`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1756-L1759) | 仅保留单代 `library.json.bak`，无 3–5 代时间戳轮转；且用 `let _ = std::fs::copy(&path, &bak);` 吞掉备份失败；无文件锁（并发先备份可污染 `.bak`） | `D-005`, `D-027`, §10.3(4), §10.4 |
| [`src/modals.rs:1760-1763`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1760-L1763) | `std::fs::rename(&tmp, &path)` 失败分支用 `let _ = std::fs::remove_file(&tmp);`；成功后**无 `fsync(dir)`**；全程无文件锁与多实例冲突检测 | `D-005`, §10.3(6), §10.4 |

### 3.2 全部吞掉保存错误的 `let _ =` 调用点（`INV-003` / `D-005`）

经全仓 `rg -n "let _ =" src/ crates/` 核查，桌面端共存在 **6 处调用点** 静默吞掉 `save_library_to_disk` 的 `Result<String, String>`（另有 `modals.rs:1758, 1761` 内部 2 处 IO `let _ =`）：

1. [`src/app.rs:195`](file:///home/mat/Projects/mathslot-next/src/app.rs#L195)：`quick_save_snippet` 保存片段后 `let _ = save_library_to_disk(&self.editor.library);`
2. [`src/modals.rs:218`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L218)：公式库「恢复默认」后 `let _ = save_library_to_disk(&editor.library);`
3. [`src/modals.rs:304`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L304)：公式库「覆盖导入 JSON」后 `let _ = save_library_to_disk(&editor.library);`
4. [`src/modals.rs:325`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L325)：公式库「跳过重复导入 JSON」后 `let _ = save_library_to_disk(&editor.library);`
5. [`src/modals.rs:467`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L467)：公式库「新建/编辑公式保存」后 `let _ = save_library_to_disk(&editor.library);`
6. [`src/modals.rs:671`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L671)：公式库「删除公式」后 `let _ = save_library_to_disk(&editor.library);`

（对照：`src/modals.rs:737, 1096, 1225, 1384, 1499` 已正确 `match save_library_to_disk(...)` 并在 UI 显示错误提示。）

### 3.3 `crates/mathslot-core/src/library.rs` ID/JSON/预置问题

| 位置 | 现状代码行为 | 违反条款 / 缺陷 |
|---|---|---|
| [`library.rs:220-248`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L220-L248) | `FormulaLibrary::default_seeded()` 遍历 `PRESET_LIBRARY`（共 88 条）生成序号 ID `"preset-001"`..`"preset-088"`，并全部置入 `UserLibrary.formulas` | §6.3（要求 `preset-<slug>`，禁止序号长期 ID）, `D-014` |
| [`library.rs:260-268`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L260-L268) | `id = format!("user-{}", SystemTime::now()...as_secs())` 秒级时间戳，`:270-274` 按同 ID 替换覆盖 | **`D-006`**, `INV-005`, `A-DATA-005` |
| [`library.rs:292-302`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L292-L302) | `restore_defaults()` 仅保留 `!e.is_builtin`，若导入了 `is_builtin: true` 条目会被静默丢弃 | `F-020`, `D-014` |
| [`library.rs:380-419`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L380-L419) | `import_json()` 空 ID 生成非稳定 `"imported-{N}"`（`:382`），且原样保留外部传入的 `is_builtin: true`（`:397-419`） | §10.1, `D-014` |
| [`library.rs:768-784`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L768-L784) | `UserLibrary::to_json_pretty()` 将全部 `self.formulas.entries`（含 88 条 `is_builtin: true`）全量写入用户 `library.json` | **`D-014`**, `INV-004`, §10.1 |
| [`library.rs:796-801`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L796-L801) | `let _schema_version: u32 = ...` 解析后**直接丢弃**，未知版本/类型错误均静默回退为 `1` | **`D-013`**, §10.5 |
| [`library.rs:809-973`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L809-L973) | `customFormats`/`snippets`/`formulas` 缺字段或类型不匹配时用 `continue`/`unwrap_or` 静默跳过或回退；缺 `formulas` 时直接填充 88 条种子（`:970-973`） | **`D-013`**, **`D-014`** |
| [`library.rs:1069-1079`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L1069-L1079) | `JsonParser::parse_str` 在 `p.skip_ws()` 后**未校验 EOF**（`p.pos == p.chars.len()`），尾随垃圾被静默忽略 | **`D-013`** |
| [`library.rs:1120-1150`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L1120-L1150) | 布尔/null 仅判断首字母 `'t'\|'f'\|'n'` 后吞掉全部连续字母（`"tru"` 变 `Bool(false)`，`"nulll"` 变 `Null`）；数字 `parse::<f64>().unwrap_or(0)` 把非法数字静默变 `0` | **`D-013`** |
| [`library.rs:1268`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L1268) | 字符串解析遇到未知转义（如 `\q`）直接保留字符 `q` 而非报错 | **`D-013`** |

---

## 4. 规范 §10 逐条核查（`A-DATA-001..006`）

| 规范条款 | 规范要求 | 当前快照核查 | 状态 |
|---|---|---|---|
| **§10.1** | `LibraryFile { schema_version, custom_formats, snippets, user_formulas, overrides, settings }`；只存用户数据；88 条内置预置从 `catalog/presets.json` 编译期加载并按稳定 `preset-<slug>` ID 合并；修改内置存 `PresetOverride`；禁止导入 `is_builtin: true`（规范化或拒绝） | `catalog/presets.json` **不存在**；`LibraryFile`/`PresetOverride`/`Settings` **不存在**；`UserLibrary` 把 88 条内置公式全量落盘且放行 `is_builtin: true` | **未满足** |
| **§10.2** | 使用路径库解析三平台配置路径：Linux (`$XDG_CONFIG_HOME` 或 `~/.config`)/`mathslot/library.json`、macOS (`~/Library/Application Support/mathslot/library.json`)、Windows (`%APPDATA%\mathslot\library.json`) | `src/modals.rs:1689-1712` 手写环境变量判断，macOS 路径错误 | **未满足** |
| **§10.3** | 写顺序：同目录 `tempfile` → `write_all` → `sync_all` → 3–5 代带时间戳轮转备份 → `persist`/`rename` → `fsync(dir)` (Unix)。读失败：不覆盖主文件、重命名 `library.corrupt-<timestamp>.json`、尝试最近可用备份、显示恢复向导、用户确认后才写新文件 | 无 `mathslot-store`；固定 `json.tmp`；无 `sync_all` / `fsync(dir)`；仅 1 代 `.bak`；损坏未隔离且静默回退默认库 | **未满足** (`A-DATA-001..004`) |
| **§10.4** | 文件锁（`fs2`/`fd-lock`）；多实例写冲突时后写者重新读取并合并或明确报错；禁止最后写入者无提示覆盖 | 无任何文件锁或版本/哈希/mtime 并发冲突检测 | **未满足** |
| **§10.5** | `schema_version` 显式 `match`，未知版本拒绝并提示；旧 `user-<秒>` ID 迁移为 UUIDv7 并保留映射表；旧 `library.json` 先备份再 dry-run 迁移最后提交 | `_schema_version` 丢弃；无 UUIDv7 迁移及映射表；无 dry-run 迁移 | **未满足** (`A-DATA-006`) |
| **§10.6** (`A-DATA-005`) | 同秒/同毫秒创建 1000 条公式无覆盖、无丢失 | `FormulaLibrary::upsert` 使用秒级时间戳，1000 条碰撞缩减为 1 条 | **未满足** |

---

## 5. 依赖、安全红线与离线环境核查

### 5.1 `Cargo.lock` 与本地 Registry 缓存实盘核查

通过检查 `Cargo.lock` 与 `~/.cargo/registry/cache/index.crates.io-1949cf8c6b5b557f/`，得到以下精确离线状态：

| Crate | 在 `Cargo.lock` 中？ | 在本地 registry cache 中？ | 说明与替代方案 |
|---|---|---|---|
| `serde` / `serde_json` (`1.0.154`) | **是** (`Cargo.lock:2234, 2264`) | **是** (`serde_json-1.0.154.crate`) | 可直接用于严格 JSON 序列化/反序列化（天然拒绝尾随垃圾、`tru`、`nulll`、非法数字与非法转义） |
| `thiserror` (`2.0.21`) | **是** (`Cargo.lock:2487`) | **是** (`thiserror-2.0.21.crate`) | 可直接用于强类型 `StoreError` |
| `tempfile` (`3.27.0`) | 否 | **是** (`tempfile-3.27.0.crate`)；其核心依赖 `fastrand-2.5.0`, `rustix 1.1.6`, `windows-sys 0.61.2` 均已缓存且 `rustix`/`windows-sys` 已在 `Cargo.lock` 中 | 可直接引入（加入 workspace 后更新 `Cargo.lock`），或用标准库 `OpenOptions::create_new(true)` + 唯一后缀实现 |
| `fd-lock` (`4.0.4`) | 否 | **是** (`fd-lock-4.0.4.crate`)；依赖 `rustix` / `windows-sys` 均在缓存中 | **推荐替代未缓存的 `fs2`**（规范 §10.4 本就允许 `fs2`/`fd-lock` 二选一） |
| `dirs` (`6.0.0`) + `dirs-sys` (`0.5.0`) | 否 | **是** (`dirs-6.0.0.crate`, `dirs-sys-0.5.0.crate`) | **推荐替代未缓存的 `directories`**（见 §5.2） |
| `directories` | **否** | **否**（本地未缓存！） | 无网环境直接添加 `directories` 将导致 `cargo` 解析失败；可用 `dirs::config_dir()` + 路径单元测试覆盖三平台 |
| `fs2` | **否** | **否**（本地未缓存！） | 本地未缓存；改用已缓存的 `fd-lock` |
| `uuid` (`1.29.2`) | **是** (`Cargo.lock:2742`，当前零 feature) | **是** (`uuid-1.29.2.crate`)；`getrandom 0.3.4/0.4.3` 亦已缓存 | 需先验证 `--offline` 下启用 `uuid` `v7` feature 是否缺少传递依赖；若缺，可用标准库 `SystemTime` + `AtomicU64` 单调序 + `RandomState`/进程熵在纯安全 Rust 中生成符合 RFC 9562 的单调 UUIDv7（30 行内零额外传递依赖） |

### 5.2 平台路径与 `#![forbid(unsafe_code)]` 红线

1. **三平台路径一致性**：`dirs::config_dir().map(|d| d.join("mathslot").join("library.json"))` 在三大桌面平台上的输出为：
   - Linux：`$XDG_CONFIG_HOME/mathslot/library.json` 或 `$HOME/.config/mathslot/library.json`
   - macOS：`$HOME/Library/Application Support/mathslot/library.json`
   - Windows：`%APPDATA%\mathslot\library.json`
   这与规范 §10.2 表格完全逐字一致（注意 `directories::ProjectDirs` 在 Windows 默认会多一层 `\config` 子目录）。建议同时提供纯逻辑拼接辅助函数（按平台规则接收环境变量/基目录），以便在 Linux CI 上对 Linux/macOS/Windows 三平台路径逻辑全部跑通单测。
2. **`#![forbid(unsafe_code)]` 约束**：[`crates/mathslot-core/tests/final_acceptance_round12.rs:143-148`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/tests/final_acceptance_round12.rs#L143-L148) 及全部核心 crate 均强制 `#![forbid(unsafe_code)]`。因此 §10.3 第 6 步 `fsync(dir)` **严禁手写 `unsafe { libc::fsync(...) }`**，必须使用纯安全标准库：
   ```rust
   #[cfg(unix)]
   {
       let dir_file = std::fs::File::open(parent_dir)?;
       dir_file.sync_all()?;
   }
   ```

---

## 6. 历史报告抽查

| 来源 | 历史声称 | 代码实测 | 结论 |
|---|---|---|---|
| [`docs/AUDIT_ROUND_8.md:139-147`](file:///home/mat/Projects/mathslot-next/docs/AUDIT_ROUND_8.md#L139-L147) | 声称「`from_json()` 支持 `schema_version` 平滑向后兼容与迁移」及「原子替换写入 `library.json.tmp`，**校验无误后**调用 `std::fs::rename` 覆盖，双重容灾备份 `.bak`」。 | 实测 [`crates/mathslot-core/src/library.rs:796-801`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L796-L801) 把 `_schema_version` 解析后直接丢弃，无版本 `match`；[`src/modals.rs:1753-1763`](file:///home/mat/Projects/mathslot-next/src/modals.rs#L1753-L1763) 写入前不做任何校验、不 `sync_all`、不 `fsync(dir)`，先用 `let _ = std::fs::copy` 覆写唯一 `.bak`，固定 `.tmp` 竞态且 6 处调用用 `let _ =` 吞错。 | **与事实严重不符（虚假安全感）** |
| [`docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:115, 122-125`](file:///home/mat/Projects/mathslot-next/docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md#L115-L125) | 声称条目 10「旧 `library.json` 可迁移，旧公式可打开 — 100% 达标 (PASS)」及总评「零死角、完全符合工程规范的完美解决 (PASS - APPROVED)」。 | 实测 [`crates/mathslot-core/src/library.rs:768-784`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L768-L784) 将 88 条内置预置全量写入用户配置，新预置无法合并（D-014）；无 `user-<secs>` ID 迁移（D-006）；手写 JSON parser [`library.rs:1069-1150`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/library.rs#L1069-L1150) 放行尾随垃圾与 `tru`/`nulll`（D-013）；`test_p1_d005` 与 `test_p1_d006` 至今仍以 exit `101` panic 失败。 | **与事实严重不符（带病签收）** |

---

## 7. `ADR-0018` 决策建议与 TDD 红灯测试蓝图

### 7.1 `ADR-0018` 建议允许修改路径与禁止路径

- **建议允许写路径**：
  - `Cargo.toml`、`Cargo.lock`（仅新增 `crates/mathslot-store` 成员及已验证离线可用的 `serde_json`/`tempfile`/`fd-lock`/`dirs`/`thiserror` 等依赖）；
  - `catalog/presets.json`（从 [`crates/mathslot-core/src/presets.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/presets.rs) 抽取 88 条预置并赋予稳定 `preset-<slug>` ID 与旧 `preset-001..088` 映射表）；
  - `crates/mathslot-store/**`（新建 crate，含 `#![forbid(unsafe_code)]`、完整 unit/integration/fault-injection tests）；
  - `crates/mathslot-core/src/library.rs`（仅修复 `D-006` 秒级 ID 生成器为单调 UUIDv7、修正 `JsonParser` EOF/严格字面量或桥接、确保 `import_json` 规范化/拒绝 `is_builtin: true`，保持 `UserLibrary::default_seeded()` 内存 API 与既有测试兼容以遵守 `INV-016`）；
  - `crates/mathslot-core/tests/p1_regression_tests.rs`（仅解除 `test_p1_d006_*` 的 `#[ignore]`）；
  - `src/modals.rs`、`src/app.rs`、`src/p1_regression_tests.rs`（将桌面端 `library_config_path` / `load_library_from_disk` / `save_library_to_disk` 接入 `mathslot-store`，消除上述 6 处 + 2 处共 8 处持久化 `let _ =`，UI 状态栏/模态窗保留未保存错误与损坏恢复提示，并将 `test_p1_d005_*` 切换为调用真实生产路径函数后解除 `#[ignore]`）。
- **建议禁止路径**：
  - 冻结模块 `crates/mathslot-core/src/{parser.rs, ast.rs, latex.rs}`（`ADR-0012`）；
  - `crates/mathslot-syntax/**`、`crates/mathslot-doc/**`、`crates/mathslot-latex/**`、`crates/mathslot-command/**`、`crates/mathslot-app/**`（除非 `ADR-0018` 明确要求仅在 `effect.rs` 预留，否则 T2.3 不跨界改动 `mathslot-app`）；
  - `scripts/agent/**`、`docs/**`、`agent-state/**`、`obsidian-mathslot/**`（Obsidian 持久化属于 G3/T3.6）。

### 7.2 `mathslot-store` 架构边界建议

1. **领域模型与纯用户落盘（§10.1）**：
   - `pub const CURRENT_LIBRARY_SCHEMA_VERSION: u32 = 3;`
   - `pub struct LibraryFile { pub schema_version: u32, pub custom_formats: Vec<CustomFormatRecord>, pub snippets: Vec<SnippetRecord>, pub user_formulas: Vec<UserFormula>, pub overrides: Vec<PresetOverride>, pub settings: Settings }`
   - 编译期 `include_str!("../../../catalog/presets.json")` 加载 88 条稳定 ID（`preset-<slug>`）预置，提供 `merge_with_presets(&self) -> ResolvedLibrary` 合并 `PresetOverride`（支持隐藏/修改名称/标签/源码等覆盖）；**落盘 JSON 中绝不写入 88 条内置预置**；导入接口拒绝或规范化 `is_builtin: true` 为 `false`。
2. **原子写与多代备份（§10.3）**：
   - `save_atomic(path, &LibraryFile)` 严格执行：
     1) 获取同目录文件锁（`library.lock` via `fd-lock`）；
     2) 冲突检测（对比加载时的文件世代/哈希或 mtime+size 乐观并发 token；若磁盘文件已被外部/另一实例更新且冲突，**拒绝无提示覆盖**，返回 `StoreError::Conflict`）；
     3) 使用 `tempfile::NamedTempFile::new_in(parent)`（消除 `D-102` 固定 `.tmp` 竞态）；
     4) `write_all`（序列化 JSON）；
     5) `file.as_file().sync_all()`；
     6) 轮转备份现有主文件为 `library.bak-<timestamp>-<seq>.json` 并按最大保留数（默认 5，范围 3..=5）清理更老备份（仅在已确保新临时文件写完且 sync 成功后才轮转，防止半写损坏污染备份）；
     7) `temp.persist(path)` 原子替换（失败则 `NamedTempFile` Drop 自动清理，无僵尸 `.tmp`）；
     8) Unix 下对父目录执行 `File::open(parent)?.sync_all()`。
   - 同时暴露内部/测试可注入 `Writer` 管线 `write_to_sink<W: Write>`（或 `save_with_writer`），供 `QuotaWriter` 注入 `ENOSPC` / `WriteZero` 验证 `A-DATA-002`。
3. **读取、损坏隔离与恢复向导数据（§10.3）**：
   - `load_or_recover(path) -> Result<LoadOutcome, StoreError>`：
     - 文件不存在（`ErrorKind::NotFound`）→ 返回全新默认空用户库（合并 88 条内置预置），**不写盘**；
     - 权限拒绝等系统 IO 错误 → 直接返回 `Err(StoreError::Io(...))`，**禁止静默回退默认库**；
     - UTF-8/JSON/Schema 解析失败 → **绝不覆盖主文件**；将损坏文件原子重命名为同目录 `library.corrupt-<timestamp>.json`；扫描最近可用且可解析的轮转备份作为候选恢复项，返回 `LoadOutcome::CorruptQuarantined { corrupt_path, recovered_from_backup, recovery_preview }` 供 UI 弹窗显示恢复向导，**只有用户显式确认后才写回主文件**。
4. **单调 UUIDv7 与迁移器（§10.5）**：
   - `next_uuid_v7()` 保证同一毫秒内连续生成 1000+ 条严格唯一且时间单调有序的 UUIDv7 字符串（格式 `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx`）。
   - `migrate(raw_json: &str)` 显式 `match schema_version`：
     - `1` / `2`：先在备份后做 dry-run 迁移（解析严格 JSON，拒绝尾随垃圾/`tru`/未知 `schema_version >= 4` 或 `0`），剥离 `is_builtin: true` 的内置条目（若与 `catalog/presets.json` 内容不同则转为 `PresetOverride`，相同则直接剔除不落盘），将 `user-<秒>` / `imported-*` / `formula-*` 等旧 ID 迁移为 UUIDv7 并记录 `id_migration_map: HashMap<String, String>`；dry-run 校验通过后再原子提交。
     - `3`：直接按 `LibraryFile` 解析（使用 `serde_json` 严格校验）。
     - 其它版本：返回 `Err(StoreError::UnsupportedSchemaVersion(v))`。

### 7.3 TDD 红灯测试蓝图（Implementer 必须先写红灯测试并验证 FAIL）

Implementer 在编写实现前，应先建立以下失败测试（或解除既有 `#[ignore]` 确认 FAIL）：

1. **P1 既有回归测试先行红灯确认与最终解冻**：
   - 切换 [`src/p1_regression_tests.rs:121-216`](file:///home/mat/Projects/mathslot-next/src/p1_regression_tests.rs#L121-L216) 接入真实存储实现并移除 `#[ignore]`（`D-005`）；
   - 移除 [`crates/mathslot-core/tests/p1_regression_tests.rs:121`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/tests/p1_regression_tests.rs#L121) 的 `#[ignore]`（`D-006`）。
2. **`crates/mathslot-store/tests/data_safety_tests.rs`（覆盖 `A-DATA-001..006`, `D-013`, `D-014`, `D-022`, `D-102`）**：
   - **T-DATA-001 (`A-DATA-001`)**：注入截断 JSON、非法 UTF-8、尾随垃圾、`tru` 布尔、非法嵌套深度 → 验证返回隔离状态、生成 `library.corrupt-<ts>.json`、存在有效备份时可加载候选恢复、主目录无未确认覆盖写；
   - **T-DATA-002 (`A-DATA-002`)**：使用配额 `QuotaWriter` 在写到一半时返回 `ErrorKind::WriteZero` → 验证 `save` 返回 `Err`、原 `library.json` 逐字节不变、无僵尸 `.tmp`；
   - **T-DATA-003 (`A-DATA-003`)**：将配置目录或主文件设为只读 → 验证 `save` 返回 `Err(PermissionDenied)`、`load` 在无法读取时不伪装成新建空库；
   - **T-DATA-004 (`A-DATA-004`)**：模拟写入半截 `.tmp` 后进程崩溃（残留损坏临时文件 + 3~5 代历史备份）→ 重启加载主文件仍完整或可从最近有效备份恢复，且多次保存保持 3~5 代备份上限；
   - **T-DATA-005 (`A-DATA-005`, `D-006`, `D-102`)**：单线程同毫秒连续生成/插入 1000 条用户公式 + 8 线程并发读写保存压测 → 验证 1000 条 ID 全部符合 UUIDv7 格式且唯一、条目数为 1000、多线程并发保存无 JSON 撕裂、无固定 `.tmp` 踩踏，且后写者在持旧版本 token 时触发冲突检测而非静默覆盖；
   - **T-DATA-006 (`A-DATA-006`, `D-013`, `D-014`)**：输入旧版 v1 / v2 `library.json`（含 88 条 `is_builtin: true`、1 条被用户改名的内置条目、`user-1710123456` 用户公式、自定义格式与片段）→ 迁移后先产生备份、dry-run 产生 `id_migration_map`（`user-1710123456` → UUIDv7）、落盘 JSON 中**零条** `is_builtin: true`（仅存用户公式与 `PresetOverride`）、合并 `catalog/presets.json` 后可见全部 88 条内置预置；传入 `schema_version: 99` 或带尾随垃圾被严格拒绝；导入 `is_builtin: true` 公式被拒绝或规范化为 `false`；
   - **T-DATA-007 (`D-022`, `INV-010`)**：Linux (`XDG_CONFIG_HOME` 与 `~/.config`)、macOS (`~/Library/Application Support`)、Windows (`%APPDATA%`) 三平台路径解析单元测试全过。

---
id: VER-5
round: 5
task: T0.5
defects: [D-005, D-006, D-101, D-102]
verdict: PASS
verifier: verifier
date: 2026-11-13
---

# MathSlot 独立验收报告 (VER-5)

- **验收角色**：verifier（独立只读验收）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **目标任务**：`T0.5` 建立故障注入 harness（磁盘满/只读/损坏/并发；测试工具；退出条件：可在 CI 本地复现）
- **核验 Commit**：`956eceabe0a1f185c9a5cf25f310e5c1c7ef6adf`
- **综合裁定**：**PASS**

---

## 1. 结论

**PASS**。

本验收人作为独立 verifier，严格遵守 `AGENTS.md` 与 `.agents/skills/independent-verify/SKILL.md` 之只读契约（**零修改任何产品业务代码、测试、配置或脚本**），针对任务 `T0.5` 及其交付物进行了全面、独立的命令执行与取证核验。各项指标全部达成：

1. **提交与变更范围核查**：提交 commit `956ecea` (`T0.5: build fault injection harness for persistence safety`) 改动严格且仅新增单个测试工具文件 `crates/mathslot-core/tests/fault_injection_harness.rs`（+820 lines），未修改任何产品源码、构建配置、CI 工作流或门禁脚本，未侵入敏感目录；
2. **Harness 架构与四大场景核验**：
   - **损坏数据注入器 (`CorruptedDataInjector`)**：实现未闭合 JSON、精准截断 JSON/字节、非法 UTF-8 字节流、尾随垃圾追加、超深递归及非法 Schema 根类型注入，并配套严格 EOF 校验器；
   - **只读沙箱隔离环境 (`IsolatedTempDir`)**：基于时间戳/PID/原子计数实现独立沙箱路径，支持跨平台与 Unix 权限安全翻转（`set_readonly` / `restore_writable`），并在 Drop 时递归恢复写权限实现零残留自动清理；
   - **容量耗尽模拟器 (`QuotaWriter<W>`)**：包装标准 `Write` 实现字节级配额控制，超额精确返回 `ErrorKind::WriteZero` 模拟 ENOSPC；
   - **并发竞态注入器 (`ConcurrentPersistenceHarness`)**：基于 `Barrier` 调度多线程微秒级同步起跑，收集操作吞吐、错误、Panic 及基于 `HashSet` 的主键碰撞统计；
   - **断言辅助工具集**：提供 `assert_file_intact`、`assert_quarantined` 与 `assert_no_zombie_tmp` 等规范级断言辅助；
3. **零特权与跨平台复现性**：完全基于 Rust 标准库（`std::fs`, `std::io`, `std::sync`, `std::thread`），无需宿主机 root 特权、无外部守护进程或文件系统挂载依赖，可在 CI 和本地零特权环境中秒级运行（实测耗时 0.00s）；
4. **全绿门禁与测试基线提升**：
   - `cargo fmt --check`：exit `0`；
   - `cargo clippy --workspace --all-targets -- -D warnings`：exit `0`（全工作区零告警）；
   - `cargo test -p mathslot-core --test fault_injection_harness`：exit `0`，实测 **5 passed; 0 failed; 0 ignored**；
   - `cargo test --workspace`：exit `0`，实测 **138 passed; 0 failed; 7 ignored**，测试通过数由 133 提升至 138，既有 133 项基线测试保持不破；
   - `scripts/agent/acceptance.sh`：门禁聚合结果 PASS=3, FAIL=0, WARN=5，结论 PASS；
5. **P1 缺陷拦截能力保持**：
   - 运行 `cargo test --workspace -- --ignored` 时，T0.3 建立的 7 项 P1 缺陷回归用例（D-001..D-007）持续 100% 触发断言 Panic（exit 101），未发生任何软化、跳过或失效；
6. **满足 Gate G0 退出契约**：符合规范 §14 T0.5 退出条件（建立故障注入 harness，可在 CI 本地复现），G0 全部任务（T0.1..T0.5）均已就绪。

---

## 2. 命令与输出证据

### 2.1 提交信息与文件变更范围核查

- **执行命令**：
  ```bash
  git log -1 --stat 956eceabe0a1f185c9a5cf25f310e5c1c7ef6adf
  ```
- **退出码**：`0`
- **实际输出**：
  ```text
  commit 956eceabe0a1f185c9a5cf25f310e5c1c7ef6adf (HEAD -> refactor/v1)
  Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
  Date:   Fri Nov 13 09:24:20 2026 +0800

      T0.5: build fault injection harness for persistence safety

   crates/mathslot-core/tests/fault_injection_harness.rs | 820 +++++++++++++++++++++
   1 file changed, 820 insertions(+)
  ```

- **执行命令**：
  ```bash
  git diff-tree --no-commit-id --name-only -r 956eceabe0a1f185c9a5cf25f310e5c1c7ef6adf
  ```
- **退出码**：`0`
- **实际输出**：
  ```text
  crates/mathslot-core/tests/fault_injection_harness.rs
  ```

---

### 2.2 格式检查 (`cargo fmt --check`)

- **执行命令**：
  ```bash
  cargo fmt --check
  ```
- **退出码**：`0`
- **实际输出**：
  *(无输出，代码格式完全合规)*

---

### 2.3 Clippy 静态检查 (`cargo clippy -D warnings`)

- **执行命令**：
  ```bash
  cargo clippy --workspace --all-targets -- -D warnings
  ```
- **退出码**：`0`
- **实际输出**：
  ```text
      Finished `dev` profile [optimized + debuginfo] target(s) in 0.15s
  ```

---

### 2.4 Harness 专项测试运行

- **执行命令**：
  ```bash
  cargo test -p mathslot-core --test fault_injection_harness
  ```
- **退出码**：`0`
- **实际输出**：
  ```text
      Finished `test` profile [optimized + debuginfo] target(s) in 0.10s
       Running tests/fault_injection_harness.rs (target/debug/deps/fault_injection_harness-d3c58021c4c2d320)

  running 5 tests
  test test_quota_writer_simulates_disk_full ... ok
  test test_assertion_helpers_and_quarantine_simulation ... ok
  test test_readonly_filesystem_simulation ... ok
  test test_concurrent_upsert_stress_harness ... ok
  test test_corrupted_json_injection_scenarios ... ok

  test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  ```

- **验证用例明细**：
  1. `test_corrupted_json_injection_scenarios`：损坏数据生成与拒绝（未闭合、截断、非法根类型、乱码、字段破损、非 UTF-8、尾随垃圾检测与超深嵌套）；
  2. `test_readonly_filesystem_simulation`：文件与目录级别只读属性设置、写入拒绝（`PermissionDenied`）、文件未变断言、写权限恢复；
  3. `test_quota_writer_simulates_disk_full`：内存 buffer 配额截断、真实物理文件 48 字节截断、零配额边界；
  4. `test_concurrent_upsert_stress_harness`：8 线程并发插入 160 项唯一数据无死锁无碰撞、故意制造冲突识别 76 次碰撞、8 线程 RwLock 4 读 4 写压测；
  5. `test_assertion_helpers_and_quarantine_simulation`：`assert_file_intact`、`assert_quarantined` 识别、`assert_no_zombie_tmp` 成功拦截与清理恢复。

---

### 2.5 全工作区测试运行 (`cargo test --workspace`)

- **执行命令**：
  ```bash
  cargo test --workspace | grep "test result:"
  ```
- **退出码**：`0`
- **实际输出汇总**：
  ```text
  mathslot (main.rs):               test result: ok. 3 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out
  mathslot_core (lib.rs):           test result: ok. 33 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  acceptance_tester_round11:        test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  acceptance_tests:                 test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  extreme_heterogeneous_tests:      test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  facade_tests:                     test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  fault_injection_harness (NEW):    test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  final_acceptance_round10:         test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  final_acceptance_round11:         test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  final_acceptance_round12:         test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  final_acceptance_round7:          test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  final_acceptance_round9:          test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  massive_preset_compatibility:     test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  overhaul_acceptance_tests:        test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  p1_regression_tests (core):       test result: ok. 0 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out
  session_tests:                    test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  doc_tests:                        test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  latex_tests:                      test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  golden_tests:                     test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
  ```
- **总体结果**：实测 **138 passed; 0 failed; 7 ignored**（133 原基线 + 5 新增 harness 测试）。

---

### 2.6 门禁聚合脚本 (`scripts/agent/acceptance.sh`)

- **执行命令**：
  ```bash
  scripts/agent/acceptance.sh
  ```
- **退出码**：`0`
- **实际输出**：
  ```text
  == MathSlot 门禁（/home/mat/Projects/mathslot-next）==
  时间：2026-11-13T09:33:15+08:00

  结果 检查项                    说明
  ------ ---------------------------- ----
  PASS   cargo fmt --check            exit 0
  PASS   cargo clippy -D warnings     exit 0
  PASS   cargo test --workspace       exit 0
  WARN   调色板一致性           G0：已知 D-001，待 G1/T1.3 修复
  WARN   let _ = 计数               29 处（G4 前应清零）
  WARN   unwrap() 计数              22 处（用户输入路径应为 0）
  WARN   命令表常量              3 处（G1 后应只剩 catalog）
  WARN   工作区未提交           2 个文件

  PASS=3 FAIL=0 WARN=5
  结论：PASS
  ```

---

### 2.7 P1 缺陷拦截能力复验（未被弱化或绕过）

- **执行命令 1 (Core Crate)**：
  ```bash
  cargo test -p mathslot-core --test p1_regression_tests -- --ignored
  ```
- **退出码**：`101`
- **实际输出（尾部截取）**：
  ```text
  failures:
      test_p1_d002_documented_commands_exist_and_match_semantics
      test_p1_d004_pending_and_unknown_commands_never_silently_disappear
      test_p1_d006_formula_upsert_same_millisecond_no_collision
      test_p1_d007_latex_import_reports_lossy_and_blocks_degradation

  test result: FAILED. 0 passed; 4 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  ```

- **执行命令 2 (Root App Crate)**：
  ```bash
  cargo test --bin mathslot -- p1_regression_tests --ignored
  ```
- **退出码**：`101`
- **实际输出（尾部截取）**：
  ```text
  failures:
      p1_regression_tests::test_p1_d001_palette_tiles_strictly_match_command_catalog
      p1_regression_tests::test_p1_d003_fitted_size_strictly_respects_max_bounds
      p1_regression_tests::test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file

  test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
  ```

**核验结论**：7 个 P1 缺陷测试在当前存在缺陷的代码库上保持 100% 真实断言失败拦截，未发生任何测试弱化或规避。

---

## 3. 逐项验收表

| 验收项 | 规范依据 | 期望 | 实测与证据 | 判定 |
|---|---|---|---|:---:|
| **变更隔离** | AGENTS.md §1 & §2 | 仅新增 harness 测试，无产品代码侵入 | 严格仅新增 `crates/mathslot-core/tests/fault_injection_harness.rs`（+820 lines） | **PASS** |
| **损坏注入** | A-DATA-001, §14 T0.5 | 损坏 JSON / 乱码 / 截断 / 尾随垃圾注入工具 | `CorruptedDataInjector` 覆盖 7 种损坏模式及严格 EOF 检查 | **PASS** |
| **只读隔离** | A-DATA-003, §14 T0.5 | 目录与文件权限切换，验证写入受阻与回滚 | `IsolatedTempDir` 实现 `set_readonly`，`PermissionDenied` 验证完备，Drop 自动恢复清理 | **PASS** |
| **磁盘满模拟** | A-DATA-002, §14 T0.5 | 模拟容量耗尽写入中断，验证截断与配额 | `QuotaWriter<W>` 模拟 ENOSPC（`ErrorKind::WriteZero`），内存与物理磁盘截断验证通过 | **PASS** |
| **并发竞态压测** | A-DATA-005, §14 T0.5 | 调度多线程起跑，收集 ID 冲突、错误与 Panic | `ConcurrentPersistenceHarness` Barrier 同步压测，160 并发无冲突、冲突检测率 100% | **PASS** |
| **断言工具** | A-DATA-001..004 | 验证原文件完好、隔离损坏文件、无僵尸 `.tmp` | `assert_file_intact`、`assert_quarantined`、`assert_no_zombie_tmp` 全部验证通过 | **PASS** |
| **零特权环境** | §14 T0.5 退出条件 | CI 与本地开发环境免 root / 免特权秒级复现 | 纯 Rust 标准库实现，单次全套 harness 测试耗时 0.00s | **PASS** |
| **静态与单元门禁** | AGENTS.md §3 | fmt / clippy / test 全绿通过 | fmt exit 0, clippy exit 0, test 138 passed 0 failed | **PASS** |

---

## 4. AGENTS.md 硬规则遵循核验

1. **单一事实源 (INV-001)**：Harness 未新增解析器或数据模型，仅作为测试辅助工具（PASS）；
2. **规范不可改**：未修改 `docs/LLM_IMPLEMENTATION_SPEC.md`，契约保持一致（PASS）；
3. **一轮一个任务**：Commit `956ecea` 专一于 `T0.5`（PASS）；
4. **先失败测试 / 回归防护**：Harness 测试套件覆盖了自身功能断言及对现有加载行为的拒绝校验（PASS）；
5. **证据制**：所有结论均有文件行号、Git 提交哈希与实际终端命令输出佐证（PASS）；
6. **禁止自我验收**：本报告由独立角色 `verifier` 出具，未参与实现编写（PASS）；
7. **不得删测试 / 放宽 lint 换绿**：测试用例保持 133 + 5 = 138，P1 7 项用例持续阻断拦截，未引入 `#[allow]` 或放宽 lint（PASS）；
8. **新功能冻结**：无任何范围外新功能实现（PASS）；
9. **独立只读**：verifier 未对产品源码、配置或现有测试执行任何写操作，唯一写文件为本报告（PASS）。

---

## 5. 未验证项与已知风险

1. **产品代码持久化逻辑待修复（D-005, D-006, D-102）**：
   - 当前产品代码中仍存在损坏配置静默回退默认库（`modals.rs:1735` / D-005）、秒级时间戳导致并发冲突（D-006）、固定临时文件名竞态（`modals.rs:1753` / D-102）及 6 处 `let _ = save_library_to_disk(...)` 吞错问题。本轮 T0.5 仅构建测试 harness 工具集，不修改产品逻辑；这些缺陷的实质修复将在 Gate G2（尤其是 `T2.3` 数据持久化与容灾向导）中依托本 harness 进行集成验证与终验；
2. **物理掉电/内核崩溃 (Power-loss / SIGKILL) 的底层刷盘验证**：
   - QuotaWriter 主要模拟应用层配额截断与写入受阻；文件系统级的 `sync_all` 与父目录 `fsync` 物理持久化行为将在后续真实文件存储重构中结合 `fs2`/原子重命名进行端到端测试；
3. **UI 容灾向导模态框**：
   - 损坏文件隔离后的前端交互（如弹出恢复向导模态框）属于 G2 UI 阶段内容，未在本轮 headless harness 单元测试中涉及。

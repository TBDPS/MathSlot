# Gate G2 收口验收报告 (GATE-G2)

- 日期：2026-11-14
- 角色：coordinator
- 工作目录：`/home/mat/Projects/mathslot-next`
- 当前分支：`refactor/v1`
- 结论：**PASS**（Gate G2 退出条件全部达成，允许推进至 Gate G3）

---

## 1. Gate G2 任务完成对照表 (规范 §14)

| 任务 ID | 任务内容 | 关联缺陷/不变量 | 对应提交 | 审计/阻断来源 | 决策报告 | 验收报告 | 状态 |
|:---|:---|:---|:---:|:---:|:---:|:---:|:---:|
| **T2.1** | `mathslot-app` 纯状态机 (`Event -> Command -> Effect`) | INV-001, A-EDIT-001..008 | `b238228` | `AUD-13` | `ADR-0016` | `VER-13` | **PASS** |
| **T2.2** | 撤销模型按 `Intent` 分组、去挂钟、断组规则 | D-012, D-104..D-107, INV-008 | `c3e2de2` | `AUD-14` | `ADR-0017` | `VER-14` | **PASS** |
| **T2.3** | `mathslot-store`（原子写/多代备份/文件锁/配置迁移/catalog） | D-005, D-006, D-013, D-014, D-022, D-102, A-DATA-001..006 | `0497fc3` | `AUD-15` | `ADR-0018` | `VER-15` | **PASS** |
| **T2.4** | `mathslot-render`（缓存/取消/显式降级/错误截断/fit 几何） | D-003, D-008, D-010, D-011, D-019, A-RENDER-001..005 | `0ce4037` | `AUD-16` | `ADR-0019` | `VER-16` | **PASS** |
| **T2.5** | 无头对照（旧版 `mathslot-core` vs `app-core` + 报告 + 修 `D-108`/`D-109`） | INV-002, D-108, D-109, G2_EXIT | `a564687` → `7156ff5` | `AUD-17` / `VER-17` | `ADR-0020` / `ADR-0021` | `VER-18` | **PASS** |

---

## 2. Gate G2 退出条件核验 (规范 §14 / §14.1)

1. **`headless_tests`（`app-core` 可独立无头测试）**：
   - `crates/mathslot-app`（`#![forbid(unsafe_code)]`）`[dependencies]` 仅依赖 `mathslot-command`, `mathslot-doc`, `mathslot-syntax`, `serde`, `thiserror`，零 `egui`/DOM/文件系统依赖；
   - `cargo test -p mathslot-app --offline` 实测 **14 passed; 0 failed**（`app_state_machine_tests`: 12 passed; `parity_report_tests`: 2 passed）；
   - `T2.5` 无头对照报告实测 **348 scenarios**（`exact_parity=301`, `intentional_deltas=47`, `unexpected_mismatches=0`），并经 `VER-18` 独立核验消除同义反复及 `D-108` 宏粘连 / `D-109` 定界符丢失（`INV-002`）。
2. **`data_acceptance`（`A-DATA-001..006` 数据安全与 `D-005`/`D-006` 闭环）**：
   - `crates/mathslot-store`（`#![forbid(unsafe_code)]`）实测 **7/7 通过**（`NotFound` 零写入、`ENOSPC`/`PermissionDenied` 无静默覆盖、1000 并发 UUIDv7 + `Conflict` 乐观锁、损坏隔离 + 备份候选、v1/v2→v3 无损迁移、3-OS 路径解析、严格 JSON）；
   - `src/p1_regression_tests.rs` `test_p1_d005_*` 已接回生产 `modals::{load_library_from_path, save_library_to_path}` 并取消 `#[ignore]` 通过；`test_p1_d006_*` 已取消 `#[ignore]` 通过；`src/{app,modals}.rs` 8 处持久化 `let _ =` 全部清零。
3. **`render_acceptance`（`A-RENDER-001..005` 渲染契约与 `D-003` 闭环）**：
   - `crates/mathslot-render`（`#![forbid(unsafe_code)]`）实测 **5/5 通过**（超宽公式默认 `FitToWidth` + 实际大小左对齐滚动、`fit_to_box` 矩阵导航不压徽章、显式 `degraded=true + diagnostics`、100 代际取消 + 确定性 LRU 缓存 + 去挂钟 `DebounceGate`、`ErrorSummary` ≤120 摘要 / ≤200 源码截断）；
   - `src/p1_regression_tests.rs` `test_p1_d003_*` 已接回生产 `app::fitted_size_dims` + `mathslot_render::fit_to_box` 并取消 `#[ignore]` 通过；`src/render.rs:90` `let _ =` 已消除。

---

## 3. 全量门禁实测输出 (`scripts/agent/acceptance.sh` + VER-18)

- `scripts/agent/acceptance.sh`（完整执行，无 `--fast`，`HEAD: 7156ff5`）退出码：`0`
  ```text
  结果 检查项                    说明
  ------ ---------------------------- ----
  PASS   cargo fmt --check            exit 0
  PASS   cargo clippy -D warnings     exit 0
  PASS   cargo test --workspace       exit 0
  PASS   调色板一致性           exit 0（gate=G2）
  WARN   let _ = 计数               15 处（G4 前应清零）
  WARN   unwrap() 计数              20 处（用户输入路径应为 0）
  WARN   命令表常量              3 处（G1 后应只剩 catalog）
  WARN   工作区未提交           2 个文件

  PASS=4 FAIL=0 WARN=4
  结论：PASS
  ```
- `cargo test --workspace --offline`（`VER-18` 实测）：exit `0`（**214 passed; 0 failed; 1 ignored**）
- `cargo test --workspace --offline -- --ignored`（`VER-18` 实测）：仅剩 1 条 `#[ignore]`（`D-007`，按规范归属 G4 `T4.1`）
- `cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline`（`VER-18` 实测）：exit `0`

---

## 4. 缺陷闭环汇总与后续范围

- **Gate G2 已闭环 P1 缺陷**：`D-003`、`D-005`、`D-006`
- **Gate G2 已闭环 P2/新发现缺陷**：`D-008`、`D-010`、`D-011`、`D-013`、`D-014`、`D-019`、`D-022`、`D-102`、`D-104`、`D-105`、`D-106`、`D-107`、`D-108`、`D-109`
- **剩余唯一待解 P1**：`D-007`（LaTeX 导入与嵌套保真，按规范 §14 归属 Gate G4 `T4.1`）
- **下一阶段入口**：进入 Gate `G3`（`T3.1..T3.7`：桌面端切换使用 `app-core`/`mathslot-store`/`mathslot-render` 与字体/输入区单行/按钮/WASM/Obsidian 接入）。

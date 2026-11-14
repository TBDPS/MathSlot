# Gate G4 退出证据（GATE-G4）

- **结论**：**PASS（准予进入项目收尾与外部最终审查）**
- **验证基准 Commit**：`b50eecb`（`refactor/v1`，含阻断修复 `860db33` / 工具链 `b50eecb`）
- **验证日期**：2026-11-15
- **独立验收**：[`VER-39.md`](VER-39.md)（PASS；`VER-38` 的单一阻断已闭环）

## 1. Gate G4 任务完成矩阵（`T4.1`–`T4.6`）

| 任务 | 核心产出 | 验收报告 | 状态 |
|---|---|---|---|
| `T4.1` | LaTeX 导入诊断/diff/round-trip，`D-007` 闭环 | `VER-32.md` | PASS |
| `T4.2` | 数据故障注入全量（A-DATA-001..006） | `VER-33.md` | PASS |
| `T4.3` | 性能基准与预算（§13.5） | `VER-34.md` | PASS |
| `T4.4` | 无障碍审计与修复（A-UI-001..005） | `VER-35.md` | PASS |
| `T4.5` | 生成文档/README/HELP（SSOT 生成） | `VER-36.md` | PASS |
| `T4.6` | 发布流水线与原生打包（Tauri 2） | `VER-37.md` | PASS |

## 2. `VER-38` 阻断闭环

| 项 | 证据 |
|---|---|
| `VER-38` FAIL：`obsidian-mathslot/main.js` 未随 `mathslot-doc` 改动重建 | `VER-38.md` §4 |
| `860db33`：重编内联 WASM 产物；`xtask/src/codegen.rs` 清零 1 处 `let _ =` 与 3 处 `.unwrap()` | `git show --stat 860db33` |
| `b50eecb`：`scripts/agent/acceptance.sh` 的 `active_dirs` 纳入 `xtask/src` | `git show --stat b50eecb` |
| 复跑 `node obsidian-mathslot/scripts/build.mjs && git diff --exit-code -- obsidian-mathslot/` | 退出码 `0`，零漂移 |
| `VER-39` 独立复验 | **PASS**，HEAD `b50eecb` |

## 3. 全量门禁实跑（`HEAD b50eecb`）

| 命令 | 退出码 | 实测关键输出 | 判定 |
|---|---|---|---|
| `bash scripts/agent/acceptance.sh` | `0` | `PASS=10 FAIL=0 WARN=0`；工作区干净 `0` 个未提交改动 | PASS |
| `cargo fmt --check` | `0` | 无输出 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished`（无 warning） | PASS |
| `cargo test --workspace --offline` | `0` | **280 passed; 0 failed; 0 ignored**（66 个 test result 块） | PASS |
| `cargo run --offline -p xtask -- check` | `0` | `All 10 artifacts are up-to-date and clean.` | PASS |
| `node obsidian-mathslot/scripts/build.mjs && git diff --exit-code -- obsidian-mathslot/` | `0` | `Synced main.js (2662.6 KB)`；Node smoke `121 catalog entries, 88/88 presets`；`git diff` 零漂移 | PASS |
| `npm --prefix packages/ui test` | `0` | `54 passed (54)` | PASS |
| `npm --prefix apps/desktop test` | `0` | `7 passed (7)` | PASS |
| `npm --prefix apps/obsidian test` | `0` | `19 passed (19)` | PASS |
| `apps/desktop` Playwright E2E | `0` | `8 passed` | PASS（`VER-39`） |
| `apps/obsidian` Playwright E2E | `0` | `7 passed` | PASS（`VER-39`） |
| `node scripts/verify-release-versions.mjs --tag v0.7.0` | `0` | `Release version parity verified` | PASS（`VER-39`） |
| `desktop-file-validate assets/mathslot.desktop` | `0` | 无输出 | PASS（`VER-39`） |
| `bash scripts/package-desktop-local.sh` | `0` | `mathslot-desktop-linux-x86_64.tar.gz` `4.2M`，SHA256 校验通过 | PASS（`VER-39`） |
| `python3 scripts/agent/audit_palette.py` | `0` | `12 张卡片，109 条子菜单命令`；目录一致 | PASS |

## 4. Gate G4 退出条件核对（规范 §14 / §16.2）

| 退出条件 | 实测 | 判定 |
|---|---|---|
| **P1/P2 清零** | `state.json.open_p1 = []`；`closed_defects` 覆盖 `D-001..D-023` 与 `D-101..D-170` 已关闭项（含 `D-018` 冻结旧栈、`D-023` CI 门禁、`D-101` 假测试防护、`D-103` 目录数据修复） | PASS |
| **验收全过** | `A-EDIT-*`、`A-RENDER-*`、`A-DATA-*`、`A-OBS-*`、`A-UI-*`、`S-001..007` 均在 `VER-32..39` 有实跑证据 | PASS |
| **文档/架构一致** | `xtask check` 10 个生成物与文档零漂移；`packages/ui/feature-parity.json` 无未登记 gap | PASS |
| **发布可回滚** | `docs/RELEASE_ROLLBACK.md` + `T4.6` 三平台发布流水线；旧 `egui` 二进制停止分发 | PASS |
| **外部最终审查** | 待 `scripts/agent/supervise.sh --final` 出具 `REV-*.md` | 待办（收尾步骤） |

## 5. 已知边界

1. **云端三平台 Runner**：本地为 Linux x86_64，未在 GitHub Actions 的 macOS/Windows runner 上实跑；Linux 本地已完成等价门禁、原生打包与版本校验。
2. **`wasm-opt`**：本机未安装，`build.mjs` 跳过可选 `-Oz`；`wasm-bindgen` 产物 `338,058 B`，低于 `409,600 B` 预算。
3. **交互式 GUI**：无头终端未直接启动 Tauri/WebKitGTK 窗口；双端 UI 由 Playwright Chromium E2E（8/8 与 7/7）覆盖。

## 6. 结论

Gate G4 的六项任务、阻断修复、聚合门禁与发布检查均已闭环；`VER-38` 的唯一 FAIL 已由 `860db33` + `b50eecb` 修复并由 `VER-39` 复验 PASS。剩余动作仅为外部最终审查与 `DONE` 收尾。

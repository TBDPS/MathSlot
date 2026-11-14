# Gate G3 退出证据（GATE-G3）

- **结论**：**PASS（准予进入 Gate G4）**
- **验证基准 Commit**：`2d613f8`（`refactor/v1`，含实现提交 `7e2c9f3` / `d441512` / `7f42d74` / `3a22824` / `558e994` / `0f7b3cc`）
- **验证日期**：2026-11-14

## 1. Gate G3 任务完成矩阵（`T3.1`–`T3.7`）

| 任务 | 核心产出 | 验收报告 | 状态 |
|---|---|---|---|
| `T3.1` | `packages/ui` CodeMirror 6 编辑器、命令装饰/槽位与 `Tab`/`Shift+Tab` 逃逸 | `VER-22.md` | PASS |
| `T3.2` | 调色板/搜索/高频卡片/121 命令 + 88 预置 + 3×3 结构导航树 | `VER-23.md` | PASS |
| `T3.3` | MathJax 3 SVG 主渲染 + `latex-rust` 回退 + `PreviewPanel` & `DiagnosticsPanel` | `VER-24.md` | PASS |
| `T3.4` | 设置/Light-Dark-Auto 主题/快捷键冲突检测/损坏恢复向导 | `VER-25.md` | PASS |
| `T3.5` | `apps/desktop`（Tauri 2 + Svelte 5 + Playwright `desktop_e2e` + `D-127`..`D-130`） | `VER-29.md` | PASS |
| `T3.6` | `apps/obsidian`（`#[wasm_bindgen]` Engine + Obsidian 宿主渲染 + 单文件同步） | `VER-27.md` | PASS |
| `T3.7` | 双端功能清单对齐、`obsidian_e2e`（含 390px 移动视口）、`feature-parity.json` 与产物防漂移（`D-131`..`D-136` 关闭，`D-137` 明确登记留待 G4 硬化） | `VER-30.md` | PASS |

## 2. 完整实跑门禁输出（未加 `--fast`，工作区干净运行）

### 2.1 `scripts/agent/acceptance.sh`
```text
== MathSlot 门禁（/home/mat/Projects/mathslot-next）==
时间：2026-11-14T21:02:03+08:00

结果   检查项                       说明
------ ---------------------------- ----
PASS   cargo fmt --check            exit 0
PASS   cargo clippy -D warnings     exit 0
PASS   cargo test --workspace       exit 0
PASS   调色板一致性                 exit 0（gate=G3）
WARN   let _ = 计数                 14 处（G4 前应清零）
WARN   unwrap() 计数                20 处（用户输入路径应为 0）
WARN   命令表常量                   3 处（G1 后应只剩 catalog）
PASS   工作区干净                   0 个未提交改动

PASS=5 FAIL=0 WARN=3
结论：PASS
```

### 2.2 生成产物 / 双端单元测试 / 构建 / Playwright E2E
| 命令 | 结果 | 实测计数 / 关键输出 |
|---|---|---|
| `cargo run -p xtask -- check --offline` | PASS (exit 0) | `[xtask] Check PASSED: All 6 artifacts are up-to-date and clean.` |
| `cd packages/ui && npm test && npm run check && npm run build` | PASS (exit 0) | Vitest `Test Files 8 passed (8), Tests 42 passed (42)`（含 `tests/parity.test.ts` 4 tests）；`svelte-check found 0 errors and 0 warnings`；Vite `dist/index.js 2,588.52 kB` |
| `cd apps/obsidian && npm test && npm run check && npm run test:e2e` | PASS (exit 0) | Vitest `Test Files 1 passed (1), Tests 14 passed (14)`；`svelte-check found 0 errors and 0 warnings`；Playwright Chromium E2E `4 passed (11.9s)`（含 `1280x800` 与 `390x844` `.is-mobile`） |
| `cd apps/desktop && npm test && npm run check && npm run build && npm run test:e2e` | PASS (exit 0) | Vitest `Test Files 1 passed (1), Tests 3 passed (3)`；`svelte-check found 0 errors and 0 warnings`；Vite `dist/assets/index-CWpDzhLY.js 2,252.75 kB`；Playwright Chromium E2E `5 passed (10.8s)` |
| `node obsidian-mathslot/scripts/build.mjs && git status -s` | PASS (exit 0) | `obsidian-mathslot/main.js (3 commands, 121 catalog entries, 88/88 presets)` 构建并冒烟通过；`git status -s` 0 未提交改动 |

## 3. G3 退出条件核对（SPEC §14 / §14.1）

- `desktop_e2e`: `apps/desktop` Playwright E2E `5 passed`（PASS）
- `obsidian_e2e`: `apps/obsidian` Playwright E2E（桌面 + `390x844` 移动）`4 passed` + Node CJS WASM 冒烟通过（PASS）
- `feature_parity`: `packages/ui/feature-parity.json` 零未登记 `gap`，`tests/parity.test.ts` `4 passed`，已提交 `obsidian-mathslot` 产物零漂移，`D-137` 已按 ADR-0031 登记归口 Gate G4（PASS）
- 无 `singleline` 伪多行、`open_p1 = []`、`PASS=5 FAIL=0`（PASS）

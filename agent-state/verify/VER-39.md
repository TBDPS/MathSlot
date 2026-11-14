---
id: VER-39
round: 39
gate: G4
task: GATE-G4
head_commit: b50eecb
commits_verified: [860db33, b50eecb]
base_commit: d5cfbbc
branch: refactor/v1
verdict: PASS
verifier: verifier
date: 2026-11-15
---

# VER-39：Gate G4 最终退出复验与阻断闭环报告（`GATE-G4`）

## 1. 结论

**PASS**。

本轮在 `HEAD b50eecb` 上作为独立 Verifier 严格实跑全部命令、单测、基准、双端构建与 Playwright E2E、本地原生打包与聚合门禁。前序 `VER-38` 报告中的单一构建滞后阻断已彻底闭环，`ADR-0038` 全部要求均已核验通过：

1. **`VER-38` 阻断闭环**：
   - 提交 `860db33` 已将 `crates/mathslot-doc` 改造后的最新编译产物同步编译并写入 `obsidian-mathslot/main.js`；在 `b50eecb` 上实跑 `node obsidian-mathslot/scripts/build.mjs && git diff --exit-code -- obsidian-mathslot/` 返回 **`exit 0`**（零漂移、零未提交改动）。
   - `xtask/src/codegen.rs` 中原残留的 1 处 `let _ =` 与 3 处 `.unwrap()` 已在 `860db33` 中全部消除；`rg -n '\.unwrap\s*\(|let\s+_\s*=' xtask/src/` 实测为 **0 处**。
2. **活跃 Rust 源码全目录零债务门禁达标**：
   - 提交 `b50eecb` 仅将 `"xtask/src"` 增补至 `scripts/agent/acceptance.sh` 的 `active_dirs` 中（未动任何其他脚本逻辑或产品代码）。
   - 实测 10 个活跃 Rust 源码目录（`crates/mathslot-{syntax,doc,latex,command,app,store,render,wasm}/src`、`apps/desktop/src-tauri/src`、`xtask/src`）在剥离 `#[cfg(test)]` 后达到：
     - `let _ =`: **0 处**
     - `.unwrap()`: **0 处**
     - `const *_ENTRIES`: **0 处**（仅 `mathslot-command` 真实单一事实源 catalog）
3. **聚合门禁全绿**：
   - `bash scripts/agent/acceptance.sh` 在全套测试与构建实跑后实测输出：**`PASS=10 FAIL=0 WARN=0`**，工作区 **0 个未提交改动**。
   - Gate G4 全部规范项（`A-EDIT-001..008`、`A-RENDER-001..005`、`A-DATA-001..006`、`A-OBS-001..005`、`A-UI-001..005`、`S-001..007`）均经实测通过。

---

## 2. 提交规范与代码 Diff 独立核查

### 2.1 阻断修复提交：`git diff d5cfbbc..860db33`
- **变更统计**：2 个文件，`+20 / -14` 行，严格符合 `ADR-0038` §3 与 §2.4 授权范围：
  - `xtask/src/codegen.rs`（`+19 / -13`）：
    - 第 128–148 行：`format_rust` 重构，使用 `let Ok(mut child) = ... else { return code.to_string(); }` 替代嵌套 `if let`，并由 `is_some_and` 与 `wait_with_output` 串联状态判断，消除了 `let _ = stdin.write_all(...)`；
    - 第 264、271、277 行：3 处 `serde_json::to_string(...).unwrap()` 替换为带语义错误上下文的 `.expect("serialize command ...")`；
  - `obsidian-mathslot/main.js`（`+1 / -1`）：
    - 同步嵌入最新 `mathslot-wasm`（内联 WASM 字符串体积收敛至 516,488 字符）。
- **静态扫描**：
  - `$ rg -n '\.unwrap\s*\(|let\s+_\s*=' xtask/src/` -> **0 命中**（`exit 1`）。

### 2.2 工具链提交：`git diff 860db33..b50eecb`
- **变更统计**：1 个文件，`+1 / -0` 行，独立提交且标明 `ADR-0038`：
  - `scripts/agent/acceptance.sh`（第 121 行）：在 `active_dirs` 列表中追加 `"xtask/src"`。
- **10 目录全量静态核算验证**：
  ```bash
  Active 10 dirs: total unwraps=0, total lets=0, total *_ENTRIES=0
  ```
  冻结旧栈（`src/` 与 `crates/mathslot-core/`）保留历史基线（`let _ = 9`、`unwrap() 20`、`*_ENTRIES 3`），作为只读基线存证。

---

## 3. 全量 Gate G4 门禁严格串行实跑记录（基于 `HEAD b50eecb`）

| 序号 | 门禁命令 | 退出码 | 实测关键输出 | 判定 |
|---|---|---|---|---|
| 1 | `cargo fmt --check` | `0` | 无输出（格式完全一致） | PASS |
| 2 | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished dev profile [optimized + debuginfo] target(s) in 0.46s` | PASS |
| 3 | `cargo run --offline -p xtask -- check` | `0` | `[xtask] Check PASSED: All 10 artifacts are up-to-date and clean.` | PASS |
| 4 | `cargo test --workspace --offline` | `0` | 共 66 个测试单元/集成/文档测试块全部通过：**`blocks=66, passed=280, failed=0, ignored=0`** | PASS |
| 5 | `cargo bench --workspace --offline` | `0` | `typical_parse`: `p50=0.0232ms p95=0.0529ms max=0.0701ms`；`deep_5000_parse`: `p95=0.6767ms`；`stress_1000_edits`: `p50=0.0638ms p95=0.3325ms max=0.6967ms`；`startup_cold_ms=0.0138`；`latex_rust_render`: `cold=1.0308ms p50=0.3415ms p95=0.5648ms` | PASS |
| 6 | `npm --prefix packages/ui test && npm --prefix packages/ui run check && npm --prefix packages/ui run build` | `0` | Vitest: **`9 passed (9)` 文件 / `54 passed (54)` 测试**（9.80s）；`svelte-check`: **`0 errors and 0 warnings`**；Vite: `327 modules` (`dist/index.css 54.20 kB`, `dist/index.js 2,603.39 kB`) | PASS |
| 7 | `npm --prefix apps/desktop test && npm --prefix apps/desktop run check && npm --prefix apps/desktop run build && npm --prefix apps/desktop run test:e2e` | `0` | Vitest: **`1 passed (1)` 文件 / `7 passed (7)` 测试**（4.23s）；`svelte-check`: **`0 errors and 0 warnings`**；Vite: `441 modules` (`dist/assets/mathslot_wasm_bg-PYsJlWed.wasm 338.05 kB`)；Playwright: **`8 passed (16.0s)`** | PASS |
| 8 | `npm --prefix apps/obsidian test && npm --prefix apps/obsidian run check && npm --prefix apps/obsidian run build && npm --prefix apps/obsidian run test:e2e` | `0` | Vitest: **`1 passed (1)` 文件 / `19 passed (19)` 测试**（4.97s）；`svelte-check`: **`0 errors and 0 warnings`**；Vite: `440 modules` (`dist/styles.css 57.96 kB`, `dist/main.js 2,726.45 kB`)；Playwright: **`7 passed (17.3s)`** | PASS |
| 9 | `node obsidian-mathslot/scripts/build.mjs && git diff --exit-code -- obsidian-mathslot/` | `0` | `cargo wasm-release`: `372.2 KB (381117 bytes)`；`wasm-bindgen`: `330.1 KB (338058 bytes) raw / 119.4 KB gzip`；`Synced main.js (2662.6 KB)`；Node smoke: `3 commands, 121 catalog entries, 88/88 presets`；`git diff --exit-code`: **`exit 0`（零漂移）** | **PASS（阻断彻底闭环）** |
| 10 | `node scripts/verify-release-versions.mjs --tag v0.7.0` | `0` | `✓ Release version parity verified: v0.7.0 (engine 0.7.0+schema1, tag v0.7.0)` | PASS |
| 11 | `desktop-file-validate assets/mathslot.desktop` | `0` | 无任何输出（格式完全合规） | PASS |
| 12 | `bash scripts/package-desktop-local.sh` | `0` | `mathslot-desktop-linux-x86_64.tar.gz: 成功`（`4.2M`，SHA256: `27cedd9a657595772e0d33b5ca5ec380352d7ee6dfea8386f08ad2a711926241`）；二进制 `target/release/mathslot-desktop`（`11M`） | PASS |
| 13 | `python3 scripts/agent/audit_palette.py` | `0` | `扫描：12 张卡片，109 条子菜单命令`；`PASS：所有可映射卡片与命令目录一致` | PASS |
| 14 | `bash scripts/agent/acceptance.sh` | `0` | **`PASS=10 FAIL=0 WARN=0`**；活跃路径 `let _ = 0`, `unwrap() 0`, `*_ENTRIES 0`；`工作区干净 0 个未提交改动` | **PASS（全绿通过）** |

---

## 4. 规范验收条款（`A-*` 与 `S-001..007`）逐项核验证据

| 验收条款 | 覆盖规范要求 | 实测验证证据与命令来源 | 判定 |
|---|---|---|---|
| **A-EDIT-001..008** | 编辑器核心交互（流输入、Pending 复制导出阻断、未知命令诊断、部分卡片展开、撤销事务、前缀粘贴、IME 隔离、导航模式不改文本） | `crates/mathslot-app/tests/app_state_machine_tests.rs`（12 passed）、`crates/mathslot-doc/tests/a_edit_acceptance_tests.rs`（9 passed）、`packages/ui/tests/editor.test.ts`（11 passed）、`apps/desktop` Playwright E2E #1 / #4 | PASS |
| **A-RENDER-001..005** | 渲染器与降级（KaTeX/LaTeX-Rust 渲染、错误诊断徽章、横向滚动不截断、渲染取消与重入、视口自适应） | `crates/mathslot-render/tests/render_acceptance_tests.rs`（5 passed）、`crates/mathslot-render/tests/latex_rust_backend_tests.rs`（2 passed）、`packages/ui/tests/preview.test.ts`（7 passed）、`apps/desktop` Playwright E2E #3/#5、`apps/obsidian` Playwright E2E #3 | PASS |
| **A-DATA-001..006** | 数据安全与配置隔离（崩溃不坏库、损坏 JSON 隔离与向导恢复、写锁限制、无假保存、跨端无损导入导出） | `crates/mathslot-store/tests/data_safety_tests.rs`（12 passed）、`crates/mathslot-core/tests/fault_injection_harness.rs`（5 passed）、`apps/desktop/tests/desktopUi.test.ts`（7 passed）、`apps/obsidian/tests/obsidian.test.ts`（19 passed）、双端 Playwright E2E #6/#7 | PASS |
| **A-OBS-001..005** | Obsidian 侧载插件契约（CSS 变量映射、损坏配置恢复、移动端 390×844 窄屏可用、88/88 预置可用、LaTeX 导入错误阻断） | `apps/obsidian/tests/obsidian.test.ts`（19 passed，覆盖 `--ms-*` token 与移动端布局）、`apps/obsidian` Playwright E2E 7 passed、`build.mjs` Node smoke 测试通过 | PASS |
| **A-UI-001..005** | 无障碍与交互卫生（焦点陷阱与恢复、模态框 Tab 序隔离、WCAG AA 对比度、Reduced Motion、永久 Live Region、ariaSnapshot） | `packages/ui/tests/a11y.test.ts`（6 passed）、`apps/desktop` Playwright E2E #8、`apps/obsidian` Playwright E2E #7 | PASS |
| **S-001..007** | 视觉快照走查（浅色/深色主题、长公式滚动、3×3 矩阵 9 槽位树、诊断面板展开、桌面与移动端渲染） | 实查 Playwright 生成的 6 张真实 PNG 截图（`light-short.png`、`long-formula.png`、`matrix-nav.png`、`error-diagnostics.png`、`dark-theme.png`、`obsidian-desktop-light.png` 与 `obsidian-mobile-390.png`），无溢出截断、无重叠、无硬编码色块 | PASS |

---

## 5. 不变量（SSOT）与代码质量审查

- **INV-001 / INV-006（单一事实源与单 AST）**：全仓仅 `crates/mathslot-command/catalog.json` 作为唯一命令表；`xtask check` 确认 10 个生成物与文档 100% 干净同步；Rust 代码中无第二套 parser 或硬编码命令表。
- **活跃路径安全不变量**：10 个活跃 Rust 源码目录中无任何非受控 `let _ =`、无任何非测试 `unwrap()`、无任何裸 `*_ENTRIES` 常量。
- **测试保护**：`cargo test --workspace` 共 280 项测试（比基线 273 项多 7 项，包含 D-101..D-170 全部回归防线），0 项失败，0 项忽略，无被删除或弱化的断言。

---

## 6. 环境边界与离线说明

1. **跨平台云端 Runners 边界**：本地处于离线 Linux x86_64 环境，无 GitHub Actions 云端 macOS 与 Windows runner 权限；Linux 本地已完成等价全量门禁、打包脚本（`package-desktop-local.sh`）、版本一致性（`verify-release-versions.mjs`）与桌面验证（`desktop-file-validate`）。
2. **可选二次压缩工具 `wasm-opt`**：环境未安装 `wasm-opt`，`build.mjs` 按预期跳过可选 pass，原始 `wasm-bindgen` 产物体积为 `338,058 bytes`（严格控制在 `409,600 bytes` 预算线内）。
3. **无头运行模式**：原生 Tauri 可执行文件在无图形界面的 CI/无头终端下未直接启动 X11 交互窗口；前端及 WASM 逻辑经由 Chromium Playwright 8/8 与 7/7 双端 E2E 完整验证，底层原生 Rust 逻辑经由 280 项 Cargo 单元及集成测试验证。

---

## 7. 终审裁决

- **前序阻断状态**：`VER-38` FAIL（`obsidian-mathslot/main.js` 漂移与 `xtask` 口径）**已全部闭环**。
- **Gate G4 退出门禁**：**PASS**（`PASS=10 FAIL=0 WARN=0`）。
- **工作区状态**：干净（除了本报告 `agent-state/verify/VER-39.md` 之外，无任何代码、测试、产物漂移）。

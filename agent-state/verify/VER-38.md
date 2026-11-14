---
id: VER-38
round: 38
gate: G4
task: GATE-G4
head_commit: 47f458c
commits_verified: [8dbd8c0, 47f458c]
base_commit: bee4ca6
branch: refactor/v1
verdict: FAIL
verifier: verifier
date: 2026-11-15
---

# VER-38：Gate G4 最终全景退出验收报告（`GATE-G4`）

## 1. 结论

**FAIL**（单一可定位阻断：提交 `8dbd8c0` 修改 `crates/mathslot-doc/src/document.rs` 后，未同步重编并提交 Git 追踪的 `obsidian-mathslot/main.js` 内联 WASM 产物）。

在 `HEAD 47f458c` 上串行实跑全部门禁、单测、基准、双端构建与 E2E、本地原生打包与版本校验后确认：

1. **`ADR-0038` 代码与 `acceptance.sh` 口径本身达标**：
   - `8dbd8c0` 在 `crates/mathslot-doc/src/document.rs` 提取共享 `collapse_replacement_nodes`，消除 3 处 `.unwrap()`，并在 `crates/mathslot-doc/tests/doc_tests.rs` 新增 2 条槽位边界测试，9 个活跃产品 crate（`crates/mathslot-{syntax,doc,latex,command,app,store,render,wasm}/src` 与 `apps/desktop/src-tauri/src`）在非测试路径下达到 `let _ =`: **0**、`.unwrap()`: **0**、`const *_ENTRIES`: **0**。
   - 全部 Rust / UI / Desktop / Obsidian 单测、类型检查、构建、Playwright E2E（Desktop 8/8、Obsidian 7/7）、offline bench、`xtask check`、`audit_palette.py`、`verify-release-versions.mjs --tag v0.7.0`、`desktop-file-validate` 与 `package-desktop-local.sh` 均已实跑通过。
2. **阻断项（CI 与工作区干净门禁失败）**：
   - 执行 `node obsidian-mathslot/scripts/build.mjs` 后，因 `mathslot-wasm` 依赖已修改的 `mathslot-doc`，生成的 `obsidian-mathslot/main.js` 内联 base64 WASM 发生变更（单行缩减 `516,932 -> 516,488` chars），导致：
     - `git diff --exit-code -- obsidian-mathslot/` **失败（`exit 1`）**，直接命中 `.github/workflows/ci.yml:167-168`（`node obsidian-mathslot/scripts/build.mjs` + `git diff --exit-code -- obsidian-mathslot/`）CI 阻断；
     - `bash scripts/agent/acceptance.sh` 输出 `WARN 工作区未提交 1 个文件`（`PASS=9 FAIL=0 WARN=1`），未满足 `WARN=0` 与工作区干净退出条件。

---

## 2. `ADR-0038`（`8dbd8c0` 与 `47f458c`）独立核查

### 2.1 `git diff bee4ca6..8dbd8c0`
- 变更文件仅 2 个，全部位于 `crates/mathslot-doc/`（符合 `ADR-0038` §3 授权范围，未修改其他目录）：
  - `crates/mathslot-doc/src/document.rs`（`+12 / -16`）：新增共享函数 `collapse_replacement_nodes(new_nodes: Vec<Spanned<Expr>>, span: Span) -> Spanned<Expr>`（第 862–867 行），使用 `<[Spanned<Expr>; 1]>::try_from(new_nodes)` 统一替换第 651、820、838 行三处原 `.unwrap()` 与重复折叠分支。
  - `crates/mathslot-doc/tests/doc_tests.rs`（`+193 / -2`）：新增 `test_nested_placeholder_slot_collapse_boundaries`（第 177–254 行）与 `test_script_sub_and_sup_slot_collapse_boundaries`（第 257–367 行），覆盖空替换、单节点解包、多节点包裹 `Group` 三类边界。
- 独立 `rg -n '\.unwrap\s*\(|let\s+_\s*='` 扫描：9 个活跃产品 crate 非测试路径与测试路径均为 **0 处**；`crates/mathslot-doc/src/document.rs` 为 **0 处**。
- **未闭环衍生影响**：`mathslot-wasm` 依赖 `mathslot-doc`，`8dbd8c0` 未重编提交 `obsidian-mathslot/main.js`（见 §4 阻断）。

### 2.2 `git diff 8dbd8c0..47f458c`
- 变更文件仅 1 个：`scripts/agent/acceptance.sh`（`+84 / -7`）。
- 实查 `scripts/agent/acceptance.sh:107-192`：
  - 精准扫描 9 个活跃产品源码目录（剥离 `#[cfg(test)]` 块），对 `let _ =`、`.unwrap()`、`const *_ENTRIES` 分别严格判定 `== 0` 为 `PASS`、`> 0` 为 `FAIL`；
  - 同步扫描冻结旧栈 `src/` 与 `crates/mathslot-core/`，将其基线数量（`let _ = 9`、`unwrap() 20`、`*_ENTRIES 3`）作为说明信息附于 `PASS` 行，不再产生历史 `WARN=3`。
- 口径差异备注（非阻断，见 §5）：`ADR-0038` §2.2 文本中列出了 `xtask/src`，而 `acceptance.sh:111-121` 的 `active_dirs` 包含 9 个产品源码目录、未纳入构建脚本 `xtask/src`（`xtask/src/codegen.rs:134,258,265,271` 存在 1 处 `let _ =` 与 3 处 `.unwrap()`）。

---

## 3. 全量 Gate G4 门禁串行实跑记录（基于 `HEAD 47f458c`）

| 序号 | 命令 | 退出码 | 实测关键输出 | 判定 |
|---|---|---|---|---|
| 1 | `cargo fmt --check` | `0` | 无输出 | PASS |
| 2 | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished dev profile [optimized + debuginfo] target(s) in 0.44s` | PASS |
| 3 | `cargo run --offline -p xtask -- check` | `0` | `[xtask] Check PASSED: All 10 artifacts are up-to-date and clean.` | PASS |
| 4 | `cargo test --workspace --offline` | `0` | 共 **66** 个 `test result:` 块（56 个单元/集成测试套件 + 10 个 doc-tests）：**280 passed; 0 failed; 0 ignored** | PASS |
| 5 | `cargo bench --workspace --offline` | `0` | `typical_parse`: `p50=0.0233ms p95=0.0412ms max=0.0545ms`；`deep_5000_parse`: `p95=0.7840ms`；`stress_1000_edits`: `p50=0.0602ms p95=0.3163ms max=0.8382ms`；`startup_cold_ms=0.0133`；`latex_rust_render`: `cold=0.9148ms p50=0.3331ms p95=0.5772ms` | PASS |
| 6 | `npm --prefix packages/ui test && npm --prefix packages/ui run check && npm --prefix packages/ui run build` | `0` | Vitest `9 passed (9)` / `54 passed (54)`；`svelte-check`: `0 errors and 0 warnings`；Vite build: `327 modules` (`dist/index.js 2,603.39 kB`, `dist/index.css 54.20 kB`) | PASS |
| 7 | `npm --prefix apps/desktop test && npm --prefix apps/desktop run check && npm --prefix apps/desktop run build && npm --prefix apps/desktop run test:e2e` | `0` | Vitest `1 passed (1)` / `7 passed (7)`；`svelte-check`: `0 errors and 0 warnings`；Vite build: `441 modules` (`mathslot_wasm_bg 338.39 kB`, gzip `123.33 kB`)；Playwright E2E: **`8 passed (17.8s)`** | PASS |
| 8 | `npm --prefix apps/obsidian test && npm --prefix apps/obsidian run check && npm --prefix apps/obsidian run build && npm --prefix apps/obsidian run test:e2e` | `0` | Vitest `1 passed (1)` / `19 passed (19)`；`svelte-check`: `0 errors and 0 warnings`；Vite build: `440 modules` (`dist/main.js 2,726.89 kB`, `dist/styles.css 57.96 kB`)；Playwright E2E: **`7 passed (17.6s)`** | PASS |
| 9 | `node obsidian-mathslot/scripts/build.mjs` | `0` | `cargo wasm-release`: `372.2 KB (381117 bytes)`；`wasm-bindgen`: `330.1 KB (338058 bytes) raw / 119.4 KB gzip`；`Synced main.js (2662.6 KB)`；Node smoke: `3 commands, 121 catalog entries, 88/88 presets` (**副作用：改写了 Git 追踪的 `obsidian-mathslot/main.js`**) | PASS（触发追踪文件漂移） |
| 10 | `node scripts/verify-release-versions.mjs --tag v0.7.0` | `0` | `✓ Release version parity verified: v0.7.0 (engine 0.7.0+schema1, tag v0.7.0)` | PASS |
| 11 | `desktop-file-validate assets/mathslot.desktop` | `0` | 无报错输出 | PASS |
| 12 | `bash scripts/package-desktop-local.sh` | `0` | `target/release/mathslot-desktop` (`11M`)；`target/release-dist/mathslot-desktop-linux-x86_64.tar.gz` (`4.2M`)；`SHA256SUMS.txt` (`b2352fe3691f3eb2e008759e63455932ec22dc159d9f8a69d3afd340396bdc1d`) `成功` | PASS |
| 13 | `bash scripts/agent/acceptance.sh` | `0` | `PASS=9 FAIL=0 WARN=1`（`WARN 工作区未提交 1 个文件`：`obsidian-mathslot/main.js`）；`wasm=338058B, mem1000=4980736B, parse_p95=0.447ms, render_p95=13.651ms`；活跃路径 `let _ = 0`, `unwrap() 0`, `*_ENTRIES 0` | **未达 `WARN=0`** |
| 14 | `python3 scripts/agent/audit_palette.py` | `0` | `扫描：12 张卡片，109 条子菜单命令`；`PASS：所有可映射卡片与命令目录一致` | PASS |
| 15 | `git diff --exit-code -- obsidian-mathslot/` | **`1`** | `obsidian-mathslot/main.js \| 2 +-`（`exit=1`） | **FAIL** |

---

## 4. 阻断原因与最小复现

1. **阻断项：`obsidian-mathslot/main.js` 未随 `8dbd8c0` 同步构建提交，导致 `ci-linux-full` 新鲜度检查失败且工作区存在未提交改动**
   - **最小复现**：
     ```bash
     git checkout 47f458c
     node obsidian-mathslot/scripts/build.mjs
     git diff --exit-code -- obsidian-mathslot/
     bash scripts/agent/acceptance.sh
     ```
   - **期望 vs 实际**：
     - 期望：`node obsidian-mathslot/scripts/build.mjs` 后 `git diff --exit-code -- obsidian-mathslot/` 返回 `0`（`.github/workflows/ci.yml:167-168` 要求），且 `scripts/agent/acceptance.sh` 返回 `PASS=10 FAIL=0 WARN=0`。
     - 实际：`crates/mathslot-doc/src/document.rs` 在 `8dbd8c0` 中修改后，`mathslot-wasm` 编译体积/内容变更导致 `obsidian-mathslot/main.js` 第 35 行内联 WASM 字符串长度由 `516,932` 变为 `516,488`，`git diff --exit-code -- obsidian-mathslot/` 返回 `exit=1`，`acceptance.sh` 报 `WARN 工作区未提交 1 个文件`（`PASS=9 FAIL=0 WARN=1`）。
   - **涉及文件**：
     - `crates/mathslot-doc/src/document.rs`（`8dbd8c0` 上游改动）
     - `obsidian-mathslot/main.js`（Git 追踪的滞后构建产物）
     - `.github/workflows/ci.yml:165-168`（CI 门禁 `git diff --exit-code -- obsidian-mathslot/`）

---

## 5. 规范 §14 / §16.2 与 `A-*` / `S-001..007` 证据索引核对

### 5.1 `state.json` 与 Gate G4 任务闭环核查
- `agent-state/state.json`：`"gate": "G4"`, `"open_p1": []`（零开放 P1）。
- Gate G4 任务独立验收记录核对：`T4.1` → `VER-32` (`PASS`)、`T4.2` → `VER-33` (`PASS`)、`T4.3` → `VER-34` (`PASS`)、`T4.4` → `VER-35` (`PASS`)、`T4.5` → `VER-36` (`PASS`)、`T4.6` → `VER-37` (`PASS`)。

### 5.2 全规范 `A-*` 与 `S-001..007` 本轮实跑证据索引
- **`A-EDIT-001..008`**：`crates/mathslot-app/tests/app_state_machine_tests.rs`（12/12 passed）、`crates/mathslot-doc/tests/a_edit_acceptance_tests.rs`（9/9 passed）、`packages/ui/tests/editor.test.ts`（11/11 passed）、`apps/desktop` E2E #1（`▸f1;2;`、多行 Enter、Undo/Redo、strict 导出阻断）。
- **`A-RENDER-001..005`**：`crates/mathslot-render/tests/render_acceptance_tests.rs`（5/5 passed）、`crates/mathslot-render/tests/latex_rust_backend_tests.rs`（2/2 passed）、`packages/ui/tests/preview.test.ts`（7/7 passed）、`apps/desktop` E2E #3/#5（长公式横向滚动、降级徽章、错误详情复制）、`apps/obsidian` E2E #3。
- **`A-DATA-001..006`**：`crates/mathslot-store/tests/data_safety_tests.rs`（12/12 passed）、`crates/mathslot-core/tests/fault_injection_harness.rs`（5/5 passed）、`apps/desktop` E2E #6/#7（损坏 JSON 恢复向导、恢复写锁、保存失败提示、跨端导入）、`apps/obsidian` E2E #6（19/19 vitest 含 `D-147..D-151`）。
- **`A-OBS-001..005`**：`apps/obsidian/tests/obsidian.test.ts`（19/19 passed，含浅色主题 `--ms-*` token、损坏 `libraryJson` 隔离恢复、390x844 移动端、88 条预置、LaTeX 导入 Error 阻断）、`apps/obsidian` E2E 7/7 passed、`build.mjs` Node smoke 88/88 预置与 121 命令通过。
- **`A-UI-001..005`**：`packages/ui/tests/a11y.test.ts`（6/6 passed）、`apps/desktop` E2E #8 与 `apps/obsidian` E2E #7（全键盘操作、焦点陷阱与恢复、Tab 序卫生、WCAG AA 对比度、reduced motion、`ariaSnapshot`）。
- **`S-001..007` 视觉截图实查**：本轮重跑 Playwright E2E 后已直接打开核查生成的 PNG 截图：
  - `apps/desktop/.e2e-artifacts/light-short.png`（`S-001`/`S-007`：浅色主题、5 张高频直达卡片与 `\frac{1}{2}` 渲染清晰无遮挡）；
  - `apps/desktop/.e2e-artifacts/long-formula.png`（`S-002`：长公式完整输入与可滚动预览）；
  - `apps/desktop/.e2e-artifacts/matrix-nav.png`（`S-003`：3×3 矩阵 9 槽位导航树无溢出截断）；
  - `apps/desktop/.e2e-artifacts/error-diagnostics.png`（`S-005`：语法错误与 LaTeX-Rust 降级徽章及诊断面板清晰可复制）；
  - `apps/desktop/.e2e-artifacts/dark-theme.png`（`S-006`：深色主题无硬编码色块）；
  - `apps/obsidian/.e2e-artifacts/obsidian-desktop-light.png` 与 `obsidian-mobile-390.png`（Obsidian 桌面与 390×844 移动端布局无横向溢出）。

---

## 6. 未验证边界与说明

1. **云端跨平台 Runners 边界**：本工作区处于离线 Linux 环境，无法在 GitHub Actions 云端 `windows-latest` 与 `macos-latest` runners 上实跑 `.github/workflows/ci.yml` 与 `.github/workflows/release.yml`（Linux 本地已完成等价全套门禁、`xtask check`、`verify-release-versions.mjs --tag v0.7.0`、`desktop-file-validate` 及 `package-desktop-local.sh` 原生打包验证）。
2. **本地可选工具 `wasm-opt` 与原生桌面 GUI 窗口**：本机未安装 `wasm-opt`，`build.mjs` 跳过可选 `-Oz` 二次压缩后原始 `wasm-bindgen` 产物体积仍为 `338,058 bytes`（低于 `409,600 bytes` 预算）；`target/release/mathslot-desktop`（`11M`）已本地编译打包并通过 `SHA256SUMS.txt` 校验，但无头终端未启动交互式 Tauri WebKitGTK 桌面窗口（前端与 WASM 逻辑已由 Playwright Chromium E2E 全覆盖）。
3. **`xtask/src` 口径对齐提示**：`ADR-0038` §2.2 描述包含 `xtask/src`，而 `scripts/agent/acceptance.sh:111-121` 仅扫描 9 个活跃产品 crate（未扫描构建工具 `xtask/src`）；如要求 `xtask/src` 一并纳入，需先处理 `xtask/src/codegen.rs:134,258,265,271`。
4. **当前工作区状态**：验证前工作区干净；运行 `node obsidian-mathslot/scripts/build.mjs` 后产生了 `M obsidian-mathslot/main.js`（即 §4 阻断项），外加本报告 `agent-state/verify/VER-38.md`。Verifier 严守红线，未修改或回退任何源码/构建产物。

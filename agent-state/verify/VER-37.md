---
id: VER-37
round: 37
gate: G4
task: T4.6
commit: b8857e0
base_commit: 16923d4
defects: [D-167, D-168, D-169, D-170]
verdict: PASS
verifier: verifier
date: 2026-11-15
---

# VER-37：Gate G4 / Task `T4.6`（`D-167`..`D-170` 与本地原生安装包构建）独立验收报告

## 1. 结论

**`PASS`**。

对分支 `refactor/v1` 提交 `b8857e0`（相对基线 `16923d4`）进行独立只读代码查验与全量命令实跑后确认：`T4.6` 对应的 4 项审计阻塞缺陷 `D-167`、`D-168`、`D-169`、`D-170` 均已按 `ADR-0037` 完整闭环；提交范围严格受控；本地版本一致性检查、`.desktop` 校验、离线原生 Tauri 2 打包及 `SHA256SUMS.txt` 校验、Obsidian 单文件 WASM 打包、`cargo fmt/clippy/test/xtask`、共享 UI / 桌面 / Obsidian 前端检查与 `scripts/agent/acceptance.sh` 均已实测通过。

---

## 2. 作用域与提交规范核查

1. **原子提交与提交信息**：
   - `git log --oneline 16923d4..b8857e0` 仅包含 **1** 个提交：`b8857e0 T4.6: switch release pipeline to Tauri 2 desktop and close D-167 D-168 D-169 D-170`。
2. **变更文件清单（共 17 个文件，全部落在 `ADR-0037` §3 允许路径内）**：
   - `.github/workflows/ci.yml`
   - `.github/workflows/release.yml`
   - `README.md`
   - `docs/RELEASE_ROLLBACK.md`
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `apps/desktop/src-tauri/icons/{32x32.png,128x128.png,128x128@2x.png,icon.ico,icon.icns}`
   - `assets/mathslot.desktop`
   - `obsidian-mathslot/scripts/build.mjs`
   - `scripts/{install-desktop.sh,package-desktop-local.sh,verify-release-versions.mjs}`
   - `crates/mathslot-app/tests/{docs_ssot_tests.rs,release_pipeline_tests.rs}`
3. **禁改路径零触碰实证**：
   - `git diff --name-only 16923d4..b8857e0 -- 'crates/mathslot-*/src/**' 'crates/mathslot-core/tests/**' 'src/**' 'packages/ui/src/**' 'docs/LLM_IMPLEMENTATION_SPEC.md' 'scripts/agent/**' 'agent-state/**' 'Cargo.lock' | wc -l` → **`0`**（exit `0`）。
4. **代码质量与工作流语法检查**：
   - `git diff 16923d4..b8857e0 -- '*.rs' | grep -E '^\+.*(\.unwrap\(|let _ =|#\[ignore|#\[allow)'` → 无命中（无新增 `.unwrap()` / `let _ =` / `#[ignore]` / `#[allow]`）。
   - 无删除或跳过既有测试；未新增任何外部 Cargo 或 npm 依赖。
   - Python `yaml.safe_load` 解析 `.github/workflows/ci.yml`（jobs: `['ci-matrix', 'ci-linux-full']`）与 `.github/workflows/release.yml`（jobs: `['preflight', 'build-linux-x86_64', 'build-windows-x86_64', 'build-macos', 'build-obsidian-plugin', 'publish-release']`）均合法通过（exit `0`）。

---

## 3. 实跑命令与输出证据

| # | 检查项 | 命令 | Exit Code | 实测输出摘要 |
|---|---|---|---|---|
| 1 | 跨包版本与 Tag 校验 | `node scripts/verify-release-versions.mjs && node scripts/verify-release-versions.mjs --tag v0.7.0` | `0` | `✓ Release version parity verified: v0.7.0 (engine 0.7.0+schema1)`；`--tag v0.7.0` 通过；负向 `--tag v0.6.9` 返回 exit `1`（`AssertionError: expected "v0.7.0" ... got "v0.6.9"`） |
| 2 | 桌面入口校验 | `desktop-file-validate assets/mathslot.desktop` | `0` | 零错误、零警告/hint |
| 3 | 本地离线桌面打包 | `bash scripts/package-desktop-local.sh` | `0` | Vite `✓ 441 modules transformed`（1.86s）；`cargo build --release --offline -p mathslot-desktop`；`mathslot-desktop-linux-x86_64.tar.gz: 成功`；SHA256 `4168b198f7b61448d24b33a63879f36c2fbd8003781d8e631ca6820b3cd3027f` |
| 4 | 二进制、归档与动态链接校验 | `sha256sum -c SHA256SUMS.txt`、`tar -tzf`、`file`、`ldd` | `0` | `target/release/mathslot-desktop` (`11,307,632` B, stripped x86-64 ELF)；归档 (`4,401,621` B) 含 `mathslot-desktop`、`assets/`、`scripts/install-desktop.sh`、`README.md`、`HELP.md`、`docs/RELEASE_ROLLBACK.md`，**不含**旧 `egui` `mathslot`；`ldd` 链接 `libwebkit2gtk-4.1.so.0` / `libgtk-3.so.0` / `libsoup-3.0.so.0` / `libjavascriptcoregtk-4.1.so.0` / `libwayland-client.so.0` / `libX11.so.6` 且 `0 not found` |
| 5 | Rust 格式检查 | `cargo fmt --check` | `0` | 无格式差异 |
| 6 | Rust Clippy 门禁 | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished dev profile` 零警告 |
| 7 | SSoT 生成物防漂移 | `cargo run --offline -p xtask -- check` | `0` | `[xtask] Check PASSED: All 10 artifacts are up-to-date and clean.` |
| 8 | Rust 全工作区测试 | `cargo test --workspace --offline` | `0` | 56 个测试套件合计 **`278 passed; 0 failed; 0 ignored`**（含 `final_acceptance_round9` 5/5、`desktop_backend_tests` 5/5、`t3_5_desktop_store_tests` 2/2、`docs_ssot_tests` 4/4、`release_pipeline_tests` 4/4） |
| 9 | 共享 UI 测试与类型检查 | `npm --prefix packages/ui test && npm --prefix packages/ui run check` | `0` | Vitest: `9 test files, 54 passed`；`svelte-check found 0 errors and 0 warnings` |
| 10 | 桌面前端测试、检查与构建 | `npm --prefix apps/desktop test && npm --prefix apps/desktop run check && npm --prefix apps/desktop run build` | `0` | Vitest: `7 passed`（注：初次与 4 个重型任务并行抢占 CPU 时 `D-153` 计时断言出现 `101.3ms < 100ms` 偶发抖动，串行实跑 `7/7` 通过）；`svelte-check`: `0 errors and 0 warnings`；Vite `✓ built in 1.72s` |
| 11 | Obsidian 前端测试、检查与构建 | `npm --prefix apps/obsidian test && npm --prefix apps/obsidian run check && npm --prefix apps/obsidian run build` | `0` | Vitest: `19 passed`；`svelte-check`: `0 errors and 0 warnings`；Vite `✓ built in 1.72s` |
| 12 | Obsidian 单文件 WASM 打包 | `node obsidian-mathslot/scripts/build.mjs && git status --short` | `0` | `wasm-bindgen output size: 330.5 KB (338391 bytes) raw / 119.5 KB gzip`；`✓ Obsidian plugin built and verified successfully: obsidian-mathslot/main.js (3 commands, 121 catalog entries, 88/88 presets)`；除待产出的 `VER-37.md` 外 `git status --short` 为空 |
| 13 | 仓库门禁聚合脚本 | `bash scripts/agent/acceptance.sh` | `0` | `PASS=7 FAIL=0 WARN=3`（`wasm=338391B, mem1000=4980736B, parse_p95=0.418ms, render_p95=8.742ms`；3 项历史 WARN 均位于冻结旧栈与测试代码） |
| 14 | 调色板一致性检查 | `python3 scripts/agent/audit_palette.py` | `0` | `扫描：12 张卡片，109 条子菜单命令`，`PASS：所有可映射卡片与命令目录一致` |

---

## 4. `AUD-33`（`D-167`..`D-170`）与 `ADR-0037` 逐项核验

| 缺陷 / 规范项 | 核验内容与文件实证 | 判定 |
|---|---|---|
| **`D-167`（P1）** 三平台 CI 矩阵、Release Preflight、版本/Tag 校验与 `SHA256SUMS.txt` | `.github/workflows/ci.yml:11-71` 配置 `ci-matrix`（`ubuntu-24.04`, `windows-latest`, `macos-latest`），各平台均执行 `verify-release-versions.mjs`、共享 UI/桌面测试构建、`cargo test --workspace --locked` 与 `cargo test -p mathslot-desktop --locked`，`ci-linux-full` 覆盖 `fmt`/`clippy`/`xtask`/`desktop-file-validate`/Obsidian/E2E/offline `cargo bench` + `bench-budgets.mjs`。`.github/workflows/release.yml:24-118` 新增 `preflight` job 串联全部门禁并按 `refs/tags/` 强制 `--tag` 校验，所有打包 job 均声明 `needs: preflight`；`publish-release`（`374-385`）生成并用 `sha256sum -c SHA256SUMS.txt` 自检。 | **PASS** |
| **`D-168`（P1）** 切换至 Tauri 2 主发布架构、修复安装脚本/`.desktop` 与真实品牌图标 | `.github/workflows/release.yml` 已完全移除 `--bin mathslot` 与旧 `egui` 二进制分发，三平台分别通过 `@tauri-apps/cli@2 build` 构建 Linux `.deb`/`.AppImage`、Windows `.msi`/NSIS `.exe`、macOS `universal-apple-darwin`（`aarch64`+`x86_64`）`.app`/`.dmg` 及对应便携归档。`scripts/install-desktop.sh:21-79` 已改为查找/构建/安装 `mathslot-desktop` 至 `~/.local/bin/mathslot-desktop` 并调用 `desktop-file-validate`。`assets/mathslot.desktop:6-11` 更新为 `Exec=mathslot-desktop %U`、`Categories=Science;Math;`、`StartupWMClass=mathslot-desktop`（同时保留 `"StartupWMClass=mathslot"` 子串以兼容冻结测试 `final_acceptance_round9.rs:468`）。实检 `apps/desktop/src-tauri/icons/`：`32x32.png`（1068 B, `32x32`）、`128x128.png`（4046 B, `128x128`）、`128x128@2x.png`（8330 B, `256x256`）经 `read_file` 看图确认与 `assets/icons/mathslot-128.png` 品牌符号一致；`icon.ico`（17574 B）内嵌 `16/32/48/64/128/256` 共 6 帧；`icon.icns`（61114 B）含有效 Apple `icns` 头与 `ic11/ic12/ic07/ic13/ic08/ic14/ic09` 块，并已注册于 `tauri.conf.json:35`。 | **PASS** |
| **`D-169`（P1）** 发布回滚 SOP、Obsidian README 打包、Release Notes 与 `README.md` 锚点闭环 | 新增 `docs/RELEASE_ROLLBACK.md`（92 行，含旧版 `egui` 维护定位、Preflight/Draft 灰度、已发布 Release 降级/撤回命令、`SHA256SUMS.txt` 校验、`schema_version = 3` 隔离恢复流程）。`.github/workflows/release.yml:347` 已改打 `obsidian-mathslot/README.md`；Release body（`397-412`）准确描述 Tauri 2 + Obsidian WASM、`121` 条命令 / `88` 条预置（`9` 分类）、`schema_version = 3` / `library.corrupt-*.json`、`SHA256SUMS.txt` 及回滚文档链接（消除 `60+` / `library.json.bak` / `with_app_id`）。`README.md:311-339` 补齐 `## 跨平台发布包` 闭合 `README.md:5` `(#跨平台发布包)` 锚点，且 `docs_ssot_tests::test_active_docs_in_page_and_fragment_anchors_resolve` 全绿验证。 | **PASS** |
| **`D-170`（P2）** 跨包版本派生与统一校验、Obsidian/Desktop CI 补全 | `obsidian-mathslot/scripts/build.mjs:33-48,219-222` 改为从 `manifest.json` 与 `apps/obsidian/src/wasmClient.ts` 动态读取并互相断言版本一致性，不再硬编码 `"0.7.0"` / `"0.7.0+schema1"`。`scripts/verify-release-versions.mjs` 统一校验 `Cargo.toml`、`crates/mathslot-wasm/src/lib.rs`（`ENGINE_CONTRACT_SCHEMA`）、`tauri.conf.json`、各 `package.json` / `manifest.json`、`wasmClient.ts` 与 `build.mjs`。`.github/workflows/release.yml` 已为桌面三平台补齐 `cargo test -p mathslot-desktop --locked`，为 `build-obsidian-plugin` 补齐 `apps/obsidian` `test`/`check` 及 `git diff --exit-code -- obsidian-mathslot/`。 | **PASS** |

---

## 5. 未验证项与环境边界说明

1. **云端 GitHub Actions 与 Windows/macOS 原生打包器**：本地为离线 Linux 环境，无法实际执行 `windows-latest` / `macos-latest` runner 上的 `npx @tauri-apps/cli@2 build --bundles msi,nsis` 与 `--target universal-apple-darwin --bundles app,dmg` 以及 Linux `.deb`/`.AppImage` 打包（本机未安装 `cargo-tauri` / `tauri-cli`）；工作流 YAML 语法、job 依赖与打包命令已通过静态测试与 YAML 解析校验，Linux 原生二进制与便携包已由 `scripts/package-desktop-local.sh` 实测通过。
2. **本机 `wasm-opt` 缺省**：本地 PATH 无 `wasm-opt`，`obsidian-mathslot/scripts/build.mjs` 自动跳过 `-Oz` 后处理（仍产出 `338,391` B WASM 满足 `<= 409,600` B 预算）；CI `release.yml` 已在 `preflight` 与 `build-obsidian-plugin` 中配置安装 `binaryen`。
3. **并行测试资源争用观察**：运行全前端套件时，若将 `packages/ui`、`apps/desktop`、`apps/obsidian` 与 `obsidian-mathslot/scripts/build.mjs` 同时并发启动，`apps/desktop/tests/desktopUi.test.ts` 的 `D-153` 计时测试在 CPU 争用下曾测得 `101.318ms`（阈值 `< 100ms`）；串行重跑即稳定通过（`7/7`）。
4. **Gate G4 终验边界**：本报告仅签收 `T4.6`（`D-167`..`D-170`）；后续 Gate G4 最终退出仍需按工作区规则更新 `agent-state/state.json`、`HANDOFF.md`，并在项目终验阶段执行 `supervise.sh --final`。

---
id: AUD-33
round: 37
gate: G4
scope:
  - T4.6
  - "§13.4"
  - "§14"
  - "§16.2"
  - INV-006
  - INV-015
verdict: BLOCK
auditor: auditor
date: 2026-11-15
base_commit: 8f5409e
---

# AUD-33：Gate G4 / Task `T4.6`（发布流水线、三平台打包与原生 Tauri 桌面构建）只读审计报告

## 1. 判定摘要

- **总体结论**：**`BLOCK`**（不可直接签收 `T4.6` 或推进 Gate G4 退出；实查发现 **3 项 P1** 与 **1 项 P2** 阻塞缺陷）。
- **核心实测结果**：
  1. **原生 Tauri 2 二进制与 Obsidian 插件离线实建可通过**：在当前 Linux 离线环境下，`npm --prefix apps/desktop run build && cargo build --release --offline -p mathslot-desktop`（exit `0`）成功产出 11 MB（`11307536` B）原生可执行文件 `target/release/mathslot-desktop`（stripped x86_64 ELF，动态链接 `libwebkit2gtk-4.1.so.0` / `libgtk-3.so.0` / `libwayland-client.so.0` / `libX11.so.6`），`cargo test -p mathslot-desktop --offline` `5 passed`；`node obsidian-mathslot/scripts/build.mjs`（exit `0`）产出 `obsidian-mathslot/main.js`（`2726896` B，内联 `338391` B WASM，通过 3 条命令 + 121 目录 + 88 预置 smoke test）。
  2. **但发布流水线与桌面分发资产未切换至 Tauri 2 主架构且缺少质量/校验/回滚门禁**：
     - **`D-167`（P1 / BLOCK）**：`.github/workflows/release.yml` 脱离 CI 门禁与质量预检（未运行 `fmt`/`clippy`/`test`/`xtask`/前端 check 与 E2E/`bench-budgets`，也未依赖 `ci.yml`）；`ci.yml` 仅跑 `ubuntu-latest` 单平台而非三平台矩阵（§13.4/§16.2）；`release.yml` 无 Git tag 与多清单版本一致性校验，且未生成 `SHA256SUMS.txt` 校验和。
     - **`D-168`（P1 / BLOCK）**：`.github/workflows/release.yml` 三平台仍双编并分发已冻结的旧 `egui` 二进制 `mathslot`（且仅打包裸二进制而非 Tauri native bundle `.deb`/`.AppImage`/`.msi`/`.dmg`/macOS `.app` 或 x86_64+aarch64 包）；`scripts/install-desktop.sh` 与 `assets/mathslot.desktop` 仍硬编码指向旧 `mathslot`（完全忽略 `mathslot-desktop`）；`apps/desktop/src-tauri/icons/` 仍为极简 2 色占位图且缺失 `icon.icns`。
     - **`D-169`（P1 / BLOCK）**：仓库缺失发布回滚机制/runbook（违反 Gate G4 退出条件"发布可回滚"与 §16.2）；`release.yml` 仍将根目录 `README.md` 打入 `mathslot-obsidian-plugin.zip`（而非 `T4.5` 新建的 `obsidian-mathslot/README.md`），且 Release body 仍包含过期文案（`60+` 公式、`library.json.bak`）；`README.md:5` 徽章锚点 `(#跨平台发布包)` 悬空断链（`VER-36.md` §5 观察项 1 复核确认）。
     - **`D-170`（P2 / BLOCK）**：跨包版本绑定存在手工硬编码漂移风险（`apps/obsidian/src/wasmClient.ts:23` 与 `obsidian-mathslot/scripts/build.mjs:33,206` 硬编码 `"0.7.0+schema1"` / `"0.7.0"`，未做自动化一致性校验），且 `release.yml` 的 Obsidian job 未执行 `apps/obsidian` `test`/`check` 及 `git diff --exit-code -- obsidian-mathslot/`，桌面三平台构建 job 未运行 `cargo test -p mathslot-desktop --locked`，本地/CI 缺失 `cargo-tauri` 与 `wasm-opt`。

---

## 2. 实跑命令与只读核查证据

| # | 检查项 | 命令 | Exit Code | 实测输出尾部摘要 |
|---|---|---|---|---|
| 1 | 基线与状态恢复 | `git rev-parse --short HEAD && git status --short && bash scripts/agent/resume.sh` | `0` | `8f5409e`；`dirty=0`；`gate=G4 round=37 active=T4.6 next=T4.6` |
| 2 | 本地门禁全量检查 | `bash scripts/agent/acceptance.sh` | `0` | `PASS=7 FAIL=0 WARN=3`；`fmt`/`clippy`/`cargo test`/`xtask check`/`audit_palette`/`bench-budgets` (`wasm=338391B`, `parse_p95=0.412ms`, `render_p95=10.544ms`) 全绿；`WARN`: `let _ =` 9 处、`unwrap()` 20 处、`命令表常量` 3 处 |
| 3 | 原生 Tauri 2 离线构建 | `npm --prefix apps/desktop run build && cargo build --release --offline -p mathslot-desktop` | `0` | Vite `✓ 441 modules transformed`；Cargo `Finished 'release' profile [optimized] target(s) in 6m 10s`；产出 `target/release/mathslot-desktop`（`11307536` B，stripped ELF 64-bit x86-64） |
| 4 | 桌面后端依赖与单测 | `ldd target/release/mathslot-desktop \| grep -E "webkit\|gtk\|soup\|javascriptcore\|wayland\|X11"` & `cargo test -p mathslot-desktop --offline` | `0` | 链接 `libwebkit2gtk-4.1.so.0`、`libgtk-3.so.0`、`libsoup-3.0.so.0`、`libjavascriptcoregtk-4.1.so.0`、`libwayland-client.so.0`、`libX11.so.6`；`desktop_backend_tests`: `5 passed; 0 failed` |
| 5 | Obsidian 插件离线打包 | `node obsidian-mathslot/scripts/build.mjs` | `0` | `wasm-opt not found in PATH`；`wasm-bindgen output size: 330.5 KB (338391 bytes) raw / 119.5 KB gzip`；`✓ Obsidian plugin built and verified successfully: obsidian-mathslot/main.js (3 commands, 121 catalog entries, 88/88 presets)` |
| 6 | 本机打包 CLI 工具链盘点 | `which cargo-tauri tauri wasm-bindgen wasm-opt` | `0`/`1` | `which: no cargo-tauri`；`which: no tauri`；`/home/mat/.cargo/bin/wasm-bindgen`（0.2.130）；`which: no wasm-opt` |
| 7 | Tauri 图标与 `.desktop` 核查 | `python3 ...`（解码 `apps/desktop/src-tauri/icons/*`）& `desktop-file-validate assets/mathslot.desktop` | `0` | `apps/desktop/src-tauri/icons/32x32.png`（119 B，仅 2 色 `(248,250,252,255)` / `(37,99,235,255)`）、`128x128.png`（357 B）、`128x128@2x.png`（959 B）、`icon.ico`（141 B），无 `icon.icns`；`desktop-file-validate` 2 条 `Categories` hint |
| 8 | 跨清单版本与 `README.md` 锚点核查 | `python3 ...`（读取 Cargo/Tauri/npm/manifest 版本）& `rg -n "^#\|跨平台发布包" README.md` | `0` | `Cargo.toml`、`tauri.conf.json`、`apps/{desktop,obsidian}/package.json`、`{apps/obsidian,obsidian-mathslot}/{manifest,package}.json` 均为 `0.7.0`（`packages/ui/package.json` 为 `0.1.0`）；`README.md:5` 含 `(#跨平台发布包)` 但全文无对应标题 |

---

## 3. 新发现缺陷逐项证据（`D-167`..`D-170`）

### 3.1 `D-167`（P1 / BLOCK）：`release.yml` 脱离 CI 门禁与质量预检，缺少三平台 CI 矩阵、tag/版本一致性校验与 SHA256 校验和

- **规范依据**：`docs/LLM_IMPLEMENTATION_SPEC.md` `§13.4`（"MUST 让 release workflow 依赖 CI 通过"、三平台矩阵 `os: [ubuntu, windows, macos]`、`git diff --exit-code`）、`§14` `T4.6`（"CI 绿；三平台包可用"）、`§16.2`（"`fmt/clippy/test/WASM/plugin/E2E` 三平台 CI 绿"）。
- **文件:行号**：
  - `.github/workflows/release.yml:1-11, 13-201, 202-250`
  - `.github/workflows/ci.yml:13-15`
  - `Cargo.toml:19`、`apps/desktop/src-tauri/tauri.conf.json:4`、`apps/desktop/package.json:3`、`apps/obsidian/manifest.json:4`、`obsidian-mathslot/manifest.json:4`
- **实证事实**：
  1. `release.yml` 仅监听 `push: tags: ['v*']` 与 `workflow_dispatch`，未配置 `preflight` 校验 job，也未设置对 `ci.yml` 的 `workflow_run` / `needs` 依赖；`release.yml` 全程未跑 `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace`、`cargo run -p xtask -- check`、`cargo run -p xtask -- generate && git diff --exit-code`、`packages/ui` / `apps/desktop` / `apps/obsidian` 测试/类型检查/E2E 或 `bench-budgets.mjs`。
  2. `.github/workflows/ci.yml:15` 仅在 `runs-on: ubuntu-latest` 单一操作系统运行，未按 `§13.4` 与 `§16.2` 建立 Linux/Windows/macOS 三平台 CI 验证矩阵（`windows` / `macos` 仅在打 tag 发布时才首次编译 Rust+前端）。
  3. `release.yml:202-233` 的 `publish-release` job 未校验 `${{ github.ref_name }}`（如 `v0.7.0`）与 `Cargo.toml`、`tauri.conf.json`、`apps/desktop/package.json`、`apps/obsidian/manifest.json`、`obsidian-mathslot/manifest.json` 等版本字段的一致性，也未为所有发布压缩包/安装包生成 `SHA256SUMS.txt`（或 `.sha256`）校验文件。

### 3.2 `D-168`（P1 / BLOCK）：三平台打包、Linux 安装脚本、`.desktop` 入口与 Tauri 图标仍残留旧 `egui`（`mathslot`）主轴且未产出标准桌面安装包

- **规范依据**：`docs/LLM_IMPLEMENTATION_SPEC.md` `§14` `T4.6`（"三平台包可用"）与 Gate G4（"文档/架构一致"）、`§16.2`（"旧版进入维护模式"）、`INV-006`。
- **文件:行号**：
  - `.github/workflows/release.yml:54, 60, 63, 98, 105, 116-158`
  - `scripts/install-desktop.sh:22-34, 54-56, 69-72`
  - `assets/mathslot.desktop:6-11`（及兼容测试 `crates/mathslot-core/tests/final_acceptance_round9.rs:465-469`）
  - `apps/desktop/src-tauri/tauri.conf.json:27-36`、`apps/desktop/src-tauri/icons/{32x32.png,128x128.png,128x128@2x.png,icon.ico}`
- **实证事实**：
  1. **`release.yml` 仍构建并首推旧 `egui` 二进制，且未走 Tauri 原生打包器**：`release.yml:54,98,141` 执行 `cargo build --release --locked --bin mathslot --bin mathslot-desktop`，将已进入维护/冻结状态的旧 `egui` 程序 `mathslot` 与 `mathslot-desktop` 一并编入分发压缩包，且未使用 `tauri build`（或对应 bundle 目标）产出 Linux `.deb`/`.AppImage`、Windows `.msi`/NSIS 安装包、macOS `.app`/`.dmg`；其中 `build-macos`（`release.yml:116-158`）仅构建 `aarch64` 裸 Mach-O 二进制打入 `.tar.gz`（无 macOS `.app` bundle、无 `x86_64` / universal 支持）。
  2. **`scripts/install-desktop.sh` 完全安装错二进制**：`scripts/install-desktop.sh:22-34` 仅查找 `${PROJECT_ROOT}/target/release/mathslot` 或 `${PROJECT_ROOT}/mathslot`（未找到则跑 `cargo build --release`），并将其复制到 `~/.local/bin/mathslot`；尽管 `release.yml:60` 把 `mathslot-desktop` 放入了 `mathslot-linux-x86_64.tar.gz`，用户解压后执行 `scripts/install-desktop.sh` 实际安装的仍是旧版 `egui` `mathslot`！
  3. **`assets/mathslot.desktop` 指向旧二进制**：`assets/mathslot.desktop:6,11` 仍为 `Exec=mathslot %U` 与 `StartupWMClass=mathslot`，未指向 `mathslot-desktop`（注意修改时需兼顾 `crates/mathslot-core/tests/final_acceptance_round9.rs:468` 对 `StartupWMClass=mathslot` 的子串断言与测试契约）。
  4. **Tauri 应用图标为 2 色占位图且缺 macOS `.icns`**：实测 `apps/desktop/src-tauri/icons/32x32.png`（119 B）仅含 2 个 RGBA 像素值（`(248, 250, 252, 255)` 与 `(37, 99, 235, 255)`），`128x128.png`（357 B）、`128x128@2x.png`（959 B）与 `icon.ico`（141 B）均为简单占位资产，未与 `assets/icons/mathslot-*.png`（真实品牌图标，1068–18641 B）对齐，且缺失 `icons/icon.icns`。

### 3.3 `D-169`（P1 / BLOCK）：缺失发布回滚流程/文档，Obsidian 发布 zip 打包错误文档，`release.yml` 文案与 `README.md:5` 锚点漂移

- **规范依据**：`docs/LLM_IMPLEMENTATION_SPEC.md` `§14` Gate G4 退出条件（"文档/架构一致；发布可回滚"）、`§16.2`（"发布包可回滚；旧版进入维护模式"）、`INV-006`、`INV-015`。
- **文件:行号**：
  - `.github/workflows/release.yml:188-195, 234-250`
  - `README.md:5`（对照全篇标题行 `README.md:1,16,31,51,225,245,269,289,311`）
  - `obsidian-mathslot/README.md:1-99`
- **实证事实**：
  1. **无发布回滚机制或文档**：全仓检索 `回滚|rollback`（排除 `mathslot-doc` undo 单元测试）在发布流水线与活动文档中 **0 命中**；无任何说明如何在发布失败或线上发现阻塞回归时回滚 GitHub Release、撤回 `latest` 标签、保留旧版包回退路径或冻结旧版 `mathslot`（`egui`）进入维护模式的操作规程。
  2. **Obsidian 插件 zip 打错 README**：`.github/workflows/release.yml:192-194` 执行 `cp README.md "${PKG_NAME}/"`，将根 `README.md`（偏桌面端+总览）而非 `T4.5` 新建的 `obsidian-mathslot/README.md` 打入 `mathslot-obsidian-plugin.zip`。
  3. **`release.yml` 发布说明严重过期**：`.github/workflows/release.yml:246` 仍写 `收录 60+ ... 经典权威公式`（实际为 **88** 条 / 9 大分类），`release.yml:250` 仍写 `library.json.bak`（实际 `schema_version = 3` 为 3–5 代时间戳轮转备份与 `library.corrupt-*.json`），`release.yml:249` 仍描述旧 `egui` 壳的 Wayland `with_app_id`。
  4. **`README.md:5` 存在页内死锚点**：`[![Platform](...)]( #跨平台发布包 )` 指向的 `#跨平台发布包` 在 `README.md` 全文无对应标题（`rg -n "^#" README.md` 仅 9 个二级标题，无跨平台发布包/下载/校验/回滚说明）。

### 3.4 `D-170`（P2 / BLOCK）：跨包版本硬编码缺校验、发布流程遗漏 Obsidian 单测/desktop 测试与工具链校验

- **规范依据**：`docs/LLM_IMPLEMENTATION_SPEC.md` `§13.4`、`§14` `T4.6`、`INV-006`。
- **文件:行号**：
  - `apps/obsidian/src/wasmClient.ts:23`（`EXPECTED_ENGINE_VERSION = '0.7.0+schema1'`）
  - `obsidian-mathslot/scripts/build.mjs:33, 206`（硬编码 `'0.7.0+schema1'` 与 `version: "0.7.0"`）
  - `apps/desktop/src/App.svelte:47`（fallback `'0.7.0'`）
  - `.github/workflows/release.yml:53-54, 97-98, 140-141, 176-186`
  - `apps/desktop/src-tauri/Cargo.toml:26`、`apps/desktop/src-tauri/capabilities/default.json:8`
- **实证事实**：
  1. `apps/obsidian/src/wasmClient.ts:23` 与 `obsidian-mathslot/scripts/build.mjs:33,206` 硬编码版本字符串，未在构建/发布校验中与 `Cargo.toml` / `obsidian-mathslot/manifest.json` / `apps/obsidian/manifest.json` 联动校验；升级版本号时若漏改 `wasmClient.ts` 将在运行时直接触发版本握手报错。
  2. `release.yml:176-186` 仅执行 `npm ci --prefix packages/ui` + `node obsidian-mathslot/scripts/build.mjs`，未执行 `apps/obsidian` 的 `npm test` / `npm run check` 与 `git diff --exit-code -- obsidian-mathslot/`，也未安装 `wasm-opt` 执行 `-Oz`（本机仅靠 `wasm-release` profile + `wasm-bindgen` 产出了 `338391` B，目前低于 `409600` B 上限但接近余量边缘）。
  3. `release.yml` 三平台桌面 job 未运行 `cargo test -p mathslot-desktop --locked` 验证本平台 Tauri 后端及系统剪贴板/路径集成；同时观察到 `apps/desktop/src-tauri` 注册了 `tauri-plugin-dialog` 与 `dialog:default` 权限，而前端实际通过浏览器 `<input type="file">` 与 `<a download>` 导入导出配置。

---

## 4. 盘点：当前产物状态与 `T4.6` 后 Gate G4 终验收口前置项

### 4.1 当前本地构建产物盘点（HEAD `8f5409e`）

| 产物 | 路径 | 实测状态 / 体积 | 说明 |
|---|---|---|---|
| **Tauri 2 原生桌面可执行文件** | `target/release/mathslot-desktop` | **已实建通过**：`11,307,536` B（11 MB），stripped x86_64 ELF | 离线 `npm --prefix apps/desktop run build && cargo build --release --offline -p mathslot-desktop` 产出；内嵌 `apps/desktop/dist`；动态依赖 `webkit2gtk-4.1` / `gtk-3` |
| **旧版 egui 可执行文件（已冻结）** | `target/release/mathslot` | 遗留产物：`14,809,576` B（14.8 MB） | 仍位于根 `Cargo.toml` 与 `release.yml` 中；应在 `T4.6` 退居维护/兼容定位或明确停发 |
| **Obsidian 插件发布目录** | `obsidian-mathslot/{main.js,manifest.json,styles.css,README.md}` | **已实建通过**：`main.js` `2,726,896` B、`styles.css` `57,966` B、`manifest.json` `341` B、`README.md` `5,394` B | 内联 WASM `338,391` B（330.5 KB raw / 119.5 KB gzip，满足 `<= 400 KB` 预算）；工作区干净零 diff |

### 4.2 Gate G4 终验（`T4.6` 完成之后）仍需收口的门禁与历史 WARN

依据 `docs/LLM_IMPLEMENTATION_SPEC.md` §14 / §16.2 与 `scripts/agent/acceptance.sh` 实测输出，在 `T4.6` 闭环后进入 Gate G4 最终退出核验前，还需显式处置以下项：

1. **`acceptance.sh` 的 3 项历史 WARN 边界核对**（全部位于已冻结的旧 `src/` 与 `crates/mathslot-core/` 中，新核心 `crates/mathslot-{syntax,doc,latex,command,app,store,render,wasm}` 与 `apps/desktop/src-tauri` 内均为 **0 处**用户路径 `.unwrap()` 与 `0 处` 吞错 `let _ =`）：
   - `let _ =` 9 处：`src/devshot.rs:58`（1）、`crates/mathslot-core/src/editor.rs:228`（1）、`crates/mathslot-core/src/lib.rs:682,953`（2，均为 `#[cfg(test)]`）、`crates/mathslot-core/tests/acceptance_tests.rs`（5，均为测试）——需按 §13/附录 D 决定是在冻结代码清零/注释豁免，还是将 `acceptance.sh` 统计口径限定为活跃主路径。
   - `unwrap()` 20 处：`crates/mathslot-core/src/lib.rs`（19，全部在 `#[cfg(test)]`）与 `crates/mathslot-core/src/library.rs:1459`（1，在 `#[cfg(test)]`）。
   - `命令表常量` 3 处：`crates/mathslot-core/src/command.rs:581,831,1140`（`RELATION_ENTRIES`、`GREEK_ENTRIES`、`SYMBOL_ENTRIES`，旧冻结栈对照数据）。
2. **Gate G4 终验全景运行**：
   - `A-DATA-001..006`、`A-RENDER-001..005`、`A-UI-001..005`、`A-OBS-001..005`、`S-001..007` 视觉截图与自动化测试全量复验；
   - `REQUIRE_REVIEW=1 scripts/agent/acceptance.sh` 与 OpenCode `scripts/agent/supervise.sh --final` 外部监督审查出具 `APPROVE`。

---

## 5. 历史结论抽查（按 `independent-audit/SKILL.md` §3）

| 来源 | 历史声称 | 实测命令与代码证据 | 结论 |
|---|---|---|---|
| `docs/ACCEPTANCE_REPORT_ROUND_10.md:78-80` | "`.gitignore` 已配置 `docs/` 规则；实机执行 `git ls-files docs/` 输出为 0 行" | 实跑 `git ls-files docs/ \| wc -l` 返回 **`61`**（exit 0）；`.gitignore:8` 明确写明 `# docs/ 是审计与验收证据，必须进版本库；不要忽略。` | **不实 / 已失效**（与仓库当前事实相反） |
| `docs/FINAL_PRODUCT_ACCEPTANCE_REPORT.md:34-36` | "原生桌面端 `target/release/mathslot` 零 WebKit 依赖；Obsidian `main.js` 796KB（556.5KB WASM）；`cargo test --workspace` 84 项通过" | 实测当前主架构为 Tauri 2 `target/release/mathslot-desktop`（`11,307,536` B，动态链接 `libwebkit2gtk-4.1.so.0` + `libgtk-3.so.0`）；`obsidian-mathslot/main.js` 为 `2,726,896` B（内联 `338,391` B `wasm-bindgen` WASM）；`cargo test --workspace` 现为 273+ 项 | **已过时**（历史旧 `egui` 快照结论不可直接套用于当前双端主架构） |

---

## 6. 建议的下一步（不写实现补丁或具体代码）

1. **P1 优先闭环（`D-167`、`D-168`、`D-169`）**：
   - 改造 `.github/workflows/ci.yml` 与 `.github/workflows/release.yml`：补齐三平台 CI 矩阵（`ubuntu` / `windows` / `macos`），让 `release.yml` 先跑完整预检（`fmt`/`clippy`/`test`/`xtask check`/`generate && git diff --exit-code`/双端前端 check 与构建/`bench-budgets`）或依赖 CI；增加 Git tag 与各 manifest/Cargo/Tauri 版本一致性校验；生成并随 Release 上传 `SHA256SUMS.txt`。
   - 将桌面发布、安装脚本（`scripts/install-desktop.sh`）与桌面入口（`assets/mathslot.desktop`）全面切换至 `mathslot-desktop`（Tauri 2），替换 `apps/desktop/src-tauri/icons/` 占位图标为 `assets/icons/` 真实品牌资产（补齐 `.icns`）并产出规范的三平台桌面包（含 macOS `.app`/双架构或明确架构说明），明确旧 `egui` `mathslot` 的维护/停发策略。
   - 在 `README.md` 补齐 `## 跨平台发布包`（修复 `README.md:5` 断链）、安装校验（SHA256）及可执行的发布回滚规程（对应 Gate G4 "发布可回滚"）；修复 `release.yml` 中 Obsidian 插件打包为 `obsidian-mathslot/README.md`，并更新 Release body 消除 `60+` 与 `library.json.bak` 过期描述。
2. **P2 同步收敛（`D-170`）**：
   - 建立单一版本检查（覆盖 `wasmClient.ts` / `build.mjs` 中的 `EXPECTED_ENGINE_VERSION` 与各包 `0.7.0`），在 `release.yml` 补全 `apps/obsidian` 测试/check、`git diff --exit-code -- obsidian-mathslot/` 与 `cargo test -p mathslot-desktop --locked`（及可选 `wasm-opt` 检查）。

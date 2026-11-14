# ADR-0037: T4.6 发布流水线切换至 Tauri 2 主架构、三平台 CI/打包与回滚闭环

- **日期**：2026-11-15
- **Gate / Task**：`G4` / `T4.6`
- **状态**：Approved（待实现与独立验收）
- **依据审计**：`agent-state/audits/AUD-33.md`（覆盖 `D-167`..`D-170` 与 `VER-36` §5 `README.md:5` 锚点观测项）

---

## 1. 上下文与阻塞事实

[AUD-33.md](../audits/AUD-33.md) 证实本地已可离线编译 `target/release/mathslot-desktop`（Tauri 2，11.3 MB）及 `obsidian-mathslot` 插件，但发布与分发链路存在 4 项阻塞缺陷：

1. **`D-167`（P1）**：`.github/workflows/ci.yml:15` 仅单平台 `ubuntu-latest`，缺三平台 CI 矩阵；`.github/workflows/release.yml` 脱离 `ci.yml` 与质量预检（未运行 `fmt`/`clippy`/`test`/`xtask`/前端 check/`bench-budgets`），无 Git tag 与多包版本一致性校验，缺 `SHA256SUMS.txt` 生成。
2. **`D-168`（P1）**：`release.yml` 三平台仍双编分发冻结的旧 `egui` `mathslot` 且仅打裸二进制（未使用 Tauri bundler 产出原生安装包，macOS 仅 `aarch64` 裸文件无 `.app`/universal）；`scripts/install-desktop.sh` 与 `assets/mathslot.desktop` 仍指向旧 `mathslot`；`apps/desktop/src-tauri/icons/` 仍为 2 色占位小图并缺 `icon.icns`。
3. **`D-169`（P1）**：仓库缺失发布回滚文档/规程；`release.yml:193` 错误将根 `README.md` 打入 `mathslot-obsidian-plugin.zip`（而非 `obsidian-mathslot/README.md`）；Release notes 仍含 `60+` 公式与 `library.json.bak` 过期文案；`README.md:5` `(#跨平台发布包)` 存在悬空页内锚点。
4. **`D-170`（P2）**：`apps/obsidian/src/wasmClient.ts:23` 与 `obsidian-mathslot/scripts/build.mjs:33,206` 硬编码 `"0.7.0+schema1"` / `"0.7.0"` 无统一自动化版本校验；`release.yml` 漏跑 `cargo test -p mathslot-desktop --locked`、`apps/obsidian` `test`/`check` 与 `git diff --exit-code -- obsidian-mathslot/`。

---

## 2. 决策方案

### 2.1 三平台 CI 矩阵与 Release Preflight + SHA256（`D-167`, `D-170`）

1. **三平台 CI（`.github/workflows/ci.yml`）**：
   - 将 Rust/Tauri 桌面端构建与核心单测拆为矩阵作业 `os: [ubuntu-24.04, windows-latest, macos-latest]`（各平台安装前端依赖 + `npm run build --prefix apps/desktop` + `cargo test --workspace --locked` + `cargo test -p mathslot-desktop --locked`）。
   - 保留完整 Linux `ci-linux-full` 门禁作业运行 `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`xtask -- check`、`xtask -- generate && git diff --exit-code`、`packages/ui` + `apps/desktop`（含 Playwright E2E）+ `apps/obsidian`（含 E2E）、`node obsidian-mathslot/scripts/build.mjs && git diff --exit-code -- obsidian-mathslot/`、离线 `bench-budgets.mjs` 与版本一致性校验。
2. **统一版本一致性校验脚本（`scripts/verify-release-versions.mjs`）**：
   - 零外部依赖读取：
     - `Cargo.toml`（`workspace.package.version`）
     - `apps/desktop/src-tauri/tauri.conf.json`（`version`）
     - `apps/desktop/package.json`（`version`）
     - `apps/obsidian/package.json` & `apps/obsidian/manifest.json`
     - `obsidian-mathslot/package.json` & `obsidian-mathslot/manifest.json`
     - `apps/obsidian/src/wasmClient.ts`（`EXPECTED_ENGINE_VERSION` 主版本前缀）
     - `obsidian-mathslot/scripts/build.mjs`（同步改造为直接从 `obsidian-mathslot/manifest.json` 读取主版本并校验 `EXPECTED_ENGINE_VERSION` 一致性，消除手写 `"0.7.0"` 重复常量）
   - 支持可选参数 `--tag vX.Y.Z`（或读取 `GITHUB_REF_NAME`），在打 tag 发布时强制核验 `tag == v${version}`。
3. **Release Preflight 与 `SHA256SUMS.txt`（`.github/workflows/release.yml`）**：
   - 增加前置 `preflight` job（全部打包 job `needs: preflight`）：运行 `verify-release-versions.mjs`（tag 一致性）、`cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace --locked`、`cargo run -p xtask -- check`、`cargo run -p xtask -- generate && git diff --exit-code`、以及 `packages/ui`/`apps/desktop`/`apps/obsidian` 测试与 `svelte-check`。
   - `publish-release` job 在汇总产物后执行 `sha256sum * > SHA256SUMS.txt`（严格过滤或确保校验文件名一致），作为标准附件随 Release 一并上传；支持通过 `workflow_dispatch` + `prerelease` 控制灰度/预发布或紧急回滚重新发布。

### 2.2 全面切换至 `mathslot-desktop`（Tauri 2）桌面分发与图标/脚本对齐（`D-168`）

1. **停止分发旧 `egui` 二进制，全面转向 Tauri 2（`.github/workflows/release.yml`）**：
   - 依据 `docs/LLM_IMPLEMENTATION_SPEC.md` §16.2（“旧版进入维护模式”），三平台发布包只构建并分发 **`mathslot-desktop`（Tauri 2）**，不再把冻结的旧 `egui` `mathslot` 打入安装包。
   - 三平台均执行：`npm run build --prefix apps/desktop`、`cargo test -p mathslot-desktop --locked`、并通过官方 Tauri CLI / bundler（`npx @tauri-apps/cli@2 build --no-bundle` 或完整 bundle；CI 中通过 `tauri-apps/tauri-action` 或安装 `@tauri-apps/cli` 构建原生安装包：Linux `.deb` / `.AppImage` + 便携 `.tar.gz`；Windows `.msi` / NSIS `.exe` + 便携 `.zip`；macOS `aarch64` & `x86_64` / `universal-apple-darwin` `.app` / `.dmg` + 便携 `.tar.gz`）产出规范的三平台安装包与便携归档。
2. **修复 `scripts/install-desktop.sh` 与 `assets/mathslot.desktop`**：
   - `scripts/install-desktop.sh` 切换为查找/编译/安装 `mathslot-desktop`（检查 `target/release/mathslot-desktop` 或同目录 `./mathslot-desktop`，缺省回退执行 `cargo build --release -p mathslot-desktop`），安装至 `~/.local/bin/mathslot-desktop`、安装全套 `assets/icons/` 到 `hicolor`、安装 `assets/mathslot.desktop` 并提示校验方式。
   - `assets/mathslot.desktop` 更新为 `Exec=mathslot-desktop %U`、`Icon=mathslot`、`StartupWMClass=mathslot-desktop`（既匹配 Tauri 二进制实际 WM class，又完整保留字串 `"StartupWMClass=mathslot"` 与 `"Icon=mathslot"` 从而兼容冻结测试 `crates/mathslot-core/tests/final_acceptance_round9.rs:468-469`，零 test 删减/放宽），且同步修正 `Categories` 使 `desktop-file-validate` 洁净通过。
3. **升级 Tauri 应用真实品牌图标（`apps/desktop/src-tauri/icons/` & `tauri.conf.json`）**：
   - 使用标准无损工具从既有高分辨率品牌源图 `assets/icons/mathslot-*.png` 重建真实 `32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.ico`（包含真实多尺寸 PNG 帧）与 macOS `icon.icns`，并在 `apps/desktop/src-tauri/tauri.conf.json` `bundle.icon` 中加入 `"icons/icon.icns"`。
4. **本地离线原生桌面包构建与验证脚本（`scripts/package-desktop-local.sh`）**：
   - 提供纯离线 Linux 本地打包脚本：依次执行 `npm --prefix apps/desktop run build`、`cargo build --release --offline -p mathslot-desktop`，将 `target/release/mathslot-desktop`、`assets/`、`scripts/install-desktop.sh`、`README.md`、`HELP.md` 打包为 `target/release-dist/mathslot-desktop-linux-x86_64.tar.gz` 并生成 `target/release-dist/SHA256SUMS.txt`（位于 `/target` 忽略目录内，不污染 git 状态），执行 `sha256sum -c` 验证通过。

### 2.3 Obsidian 发布打包、回滚规程与 `README.md` 锚点闭环（`D-169`, `D-170`）

1. **`release.yml` Obsidian job 与 Release Notes 修复**：
   - `build-obsidian-plugin` job 运行 `npm test --prefix apps/obsidian`、`npm run check --prefix apps/obsidian`、`node obsidian-mathslot/scripts/build.mjs`、`git diff --exit-code -- obsidian-mathslot/`，并在打包 `mathslot-obsidian-plugin.zip` 时复制 **`obsidian-mathslot/README.md`** 为包内 `README.md`（不再复制根 `README.md`）。
   - 更新 `release.yml` `publish-release` Release Notes：精确反映 Tauri 2 三平台桌面包 + Obsidian WASM 插件（零外部依赖）、`121` 条命令 / `88` 条预置（`9` 分类）、`schema_version = 3` 轮转备份（`library.corrupt-*.json`）、`SHA256SUMS.txt` 校验方法、旧 `egui` 版本退出说明与回滚文档链接。
2. **新增 `docs/RELEASE_ROLLBACK.md`（满足 Gate G4 "发布可回滚"）**：
   - 定义清晰可执行的发布回滚 SOP：发布前 Preflight 与 Draft 拦截、已发布 GitHub Release 撤回/降级流程（`gh release edit --prerelease` / `gh release delete` / 重新打修正 tag 并保留前序稳定版包供下载）、`SHA256SUMS.txt` 验证规范、用户侧 `schema_version = 3` 配置备份回退说明，及 `cargo` 旧 `egui` crate 维护定位。
3. **补齐 `README.md` `## 跨平台发布包` 锚点并同步 `xtask` 文档检查**：
   - 在 `README.md`（若由 `xtask` 管理手写叙述保留稳定结构，同步跑 `cargo run -p xtask -- check` 与 `docs_ssot_tests`）新增 `## 跨平台发布包` 章节（覆盖 Tauri 2 三平台包 / Obsidian 插件 zip / `SHA256SUMS.txt` 验证 / `scripts/package-desktop-local.sh` 本地打包 / [docs/RELEASE_ROLLBACK.md](docs/RELEASE_ROLLBACK.md) 回滚指南），彻底消除 `README.md:5` `(#跨平台发布包)` 悬空锚点；扩展 `docs_ssot_tests`（或 `codegen_tests`）校验活动文档页内 `#anchor` 锚点同样有效，防止同类死锚点复发。

---

## 3. 允许写入范围（`T4.6` 严格限定）

实现者（`mathslot-implementer`）仅允许修改或新增以下路径，且**只能产出一个原子提交**（commit message 含 `T4.6` 与 `D-167 D-168 D-169 D-170`）：

- `.github/workflows/ci.yml`、`.github/workflows/release.yml`
- `scripts/install-desktop.sh`、`scripts/package-desktop-local.sh`、`scripts/verify-release-versions.mjs`（**禁止修改 `scripts/agent/**`**）
- `assets/mathslot.desktop`
- `apps/desktop/src-tauri/tauri.conf.json`、`apps/desktop/src-tauri/icons/**`
- `obsidian-mathslot/scripts/build.mjs`（以及若重打包产生一致校验的 `obsidian-mathslot/{main.js,styles.css}`）
- `README.md`、`docs/RELEASE_ROLLBACK.md`（及若需锚点/版本检查同步更新的 `crates/mathslot-app/tests/docs_ssot_tests.rs` 或新增 `crates/mathslot-app/tests/release_pipeline_tests.rs` / `packages/ui` 或脚本测试）

**严禁修改**：`crates/mathslot-{syntax,doc,latex,command,render,store,wasm,core}/src/**`、`src/**`、`packages/ui/src/**`、`docs/LLM_IMPLEMENTATION_SPEC.md`、`scripts/agent/**`、`agent-state/**`。

---

## 4. 验收要求

1. **Red -> Green TDD**：先通过测试断言复现 `release.yml` 缺 preflight/SHA256/仍打 `mathslot` egui/打错根 `README.md`、`install-desktop.sh` 指向旧 `mathslot`、`icons/` 为小图且缺 `.icns`、`README.md` `#跨平台发布包` 悬空锚点、`RELEASE_ROLLBACK.md` 缺失、`build.mjs` 硬编码版本；再落地修复并全绿。
2. **本地与原生包实测必绿**：
   - `node scripts/verify-release-versions.mjs`（exit 0）
   - `bash scripts/package-desktop-local.sh`（真实离线编出 `target/release/mathslot-desktop`、`target/release-dist/mathslot-desktop-linux-x86_64.tar.gz` 与 `SHA256SUMS.txt` 并校验 `sha256sum -c` 通过）
   - `desktop-file-validate assets/mathslot.desktop`
   - `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace --offline`（含 `mathslot-core final_acceptance_round9` 与 `mathslot-desktop`）
   - `cargo run --offline -p xtask -- check`
   - `npm --prefix packages/ui test && npm --prefix packages/ui run check`
   - `npm --prefix apps/desktop test && npm --prefix apps/desktop run check && npm --prefix apps/desktop run build`
   - `npm --prefix apps/obsidian test && npm --prefix apps/obsidian run check && npm --prefix apps/obsidian run build`
   - `node obsidian-mathslot/scripts/build.mjs`
   - `bash scripts/agent/acceptance.sh`（提交前 `git status --short` 为空）

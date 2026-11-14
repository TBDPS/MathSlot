# MathSlot 发布校验与回滚规程 (Release & Rollback Runbook)

本文档定义 Gate `G4`（`T4.6`）的发布门禁、制品校验与发布回滚标准操作规程（SOP）。

---

## 1. 架构定位与旧版维护说明

- **主发布架构**：桌面端仅分发基于 **Tauri 2** 的 `mathslot-desktop`（`apps/desktop/src-tauri`），Obsidian 端仅分发基于 `crates/mathslot-wasm` 的单文件插件 `mathslot-obsidian-plugin.zip`（`obsidian-mathslot/`）。
- **旧版 `egui`（`mathslot`）进入维护模式**：依据 [docs/LLM_IMPLEMENTATION_SPEC.md](LLM_IMPLEMENTATION_SPEC.md) §16.2，根目录旧版 `egui` crate（`src/`）与 `mathslot` 二进制已冻结并退出正式发布包，不再纳入 GitHub Release 分发制品；仅保留源码与基线回归测试用于兼容对照。

---

## 2. 发布前置门禁与版本一致性

在打 tag（`vX.Y.Z`）或手动触发 `.github/workflows/release.yml` 时，`preflight` job 必须全部通过才允许进入打包阶段：

1. **跨包版本与 Tag 核验**：运行 `node scripts/verify-release-versions.mjs`（打 tag 时附带 `--tag vX.Y.Z`），强制核验以下清单与 `Cargo.toml` `[workspace.package].version` 完全一致：
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `apps/desktop/package.json`
   - `apps/obsidian/package.json` & `apps/obsidian/manifest.json`
   - `obsidian-mathslot/package.json` & `obsidian-mathslot/manifest.json`
   - `apps/obsidian/src/wasmClient.ts`（`EXPECTED_ENGINE_VERSION`）与 `obsidian-mathslot/scripts/build.mjs`
2. **Rust 与生成物门禁**：`cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace --locked`、`cargo run -p xtask -- check`、`cargo run -p xtask -- generate && git diff --exit-code`。
3. **前端、Obsidian 与性能预算门禁**：`packages/ui` / `apps/desktop` / `apps/obsidian` 的 `test` 与 `svelte-check`、`node obsidian-mathslot/scripts/build.mjs && git diff --exit-code -- obsidian-mathslot/`、以及 `node packages/ui/scripts/bench-budgets.mjs`。

---

## 3. 制品校验 (`SHA256SUMS.txt`)

每次 GitHub Release 均附带全量制品的 `SHA256SUMS.txt` 校验文件。用户与运维在安装前应核对校验和：

```bash
# Linux / macOS
sha256sum -c SHA256SUMS.txt --ignore-missing

# Windows (PowerShell)
Get-FileHash .\mathslot-desktop-windows-x86_64.zip -Algorithm SHA256
```

本地离线验证 Linux 原生打包与校验和：

```bash
bash scripts/package-desktop-local.sh
# 产物位于被 .gitignore 忽略的 target/release-dist/：
#   - target/release-dist/mathslot-desktop-linux-x86_64.tar.gz
#   - target/release-dist/SHA256SUMS.txt
```

---

## 4. 发布回滚 SOP（发现阻塞回归时）

### 4.1 发布前拦截（Draft / Prerelease 灰度）

- 若需灰度验证，使用 `workflow_dispatch` 触发 `.github/workflows/release.yml` 并勾选 `prerelease = true`（或 `draft = true`），先在测试机验证安装包、Obsidian 插件与 `SHA256SUMS.txt` 后再转正。

### 4.2 已发布 GitHub Release 撤回与降级

若 `vX.Y.Z` 已发布后发现 P0/P1 阻塞缺陷：

1. **立即降级或撤回问题 Release（保留审计可追溯，不破坏用户现有前序稳定版本）**：

```bash
# 选项 A：标记问题版本为 pre-release（推荐，使 GitHub Latest 自动回退到前序稳定版）
gh release edit vX.Y.Z --prerelease --notes "⚠️ 已因回归问题回滚，请下载前序稳定版本。"

# 选项 B：若包含损坏制品或严重安全问题，彻底删除 Release 与远程 tag
gh release delete vX.Y.Z --yes
git push origin :refs/tags/vX.Y.Z
```

2. **确认前序稳定版重新成为 `latest`**：

```bash
gh release view vPREV_STABLE --json tagName,isLatest,isPrerelease
```

3. **修复并发布修订版（Patch Release）**：
   - 在 `refactor/v1` 或发布分支修复缺陷并通过完整 `ci.yml` + `scripts/agent/acceptance.sh`；
   - 同步递增版本号（`Cargo.toml`、`tauri.conf.json`、`package.json`、`manifest.json`、`apps/obsidian/src/wasmClient.ts`），运行 `node scripts/verify-release-versions.mjs` 与 `cargo run -p xtask -- generate`；
   - 打新 tag（如 `v0.7.1`）触发 `release.yml` 重新全量构建与生成新的 `SHA256SUMS.txt`（禁止覆盖篡改已发布 tag 的二进制内容）。

---

## 5. 用户端配置与数据回退 (`schema_version = 3`)

- 桌面端配置文件 `library.json` 采用 `schema_version = 3` 原子写入与 3–5 代轮转备份；升级或回滚桌面端版本前，配置文件与备份目录均保存在系统配置目录（Linux `$XDG_CONFIG_HOME/mathslot/`、macOS `~/Library/Application Support/mathslot/`、Windows `%APPDATA%\mathslot\`）。
- 若需回退至前序版本且本地配置文件异常：
  1. 损坏文件会自动隔离为 `library.corrupt-*.json`，主数据不会静默覆盖；
  2. 可在桌面端「设置 → 恢复向导」中从轮转备份一键恢复，或从最近一份备份手动还原 `library.json`。
- Obsidian 端可通过「设置 → 导出配置 JSON」在插件升级前留存快照，回退旧版插件后通过「导入配置 JSON」恢复用户片段与快捷键。

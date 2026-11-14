# MathSlot 重构交接（HANDOFF）

- 当前分支：`refactor/v1`
- 当前 Gate：`G4`（Round 38，下一阶段：`GATE-G4` 门禁收敛与最终独立退出验收）
- 当前 `last_verdict`：`PASS`（[VER-37.md](file:///home/mat/Projects/mathslot-next/agent-state/verify/VER-37.md)）

## 已完成里程碑（Round 37：`T4.6` PASS）

- 提交 `b8857e0` 通过独立验收 [VER-37.md](file:///home/mat/Projects/mathslot-next/agent-state/verify/VER-37.md)，闭环 **`D-167`..`D-170`**：
  - **三平台 CI 与发布门禁切换至 Tauri 2**：`.github/workflows/ci.yml` 拆出 Linux/Windows/macOS 三平台矩阵与完整 Linux 门禁；`.github/workflows/release.yml` 增加 `preflight` 阻断门禁、停发冻结旧 `egui` `mathslot`、切换为 `@tauri-apps/cli@2` 原生安装包与便携归档（`mathslot-desktop`），修复 Obsidian 插件 zip 打包 `obsidian-mathslot/README.md`，生成并校验 `SHA256SUMS.txt`。
  - **版本一致性、安装集成、图标与回滚闭环**：新增 `scripts/verify-release-versions.mjs`、`scripts/package-desktop-local.sh` 与 `docs/RELEASE_ROLLBACK.md`（闭合 `README.md:5` `(#跨平台发布包)` 锚点与发布可回滚要求）；升级 `apps/desktop/src-tauri/icons/` 真实品牌图标（含 macOS `icon.icns`），切换 `scripts/install-desktop.sh` 与 `assets/mathslot.desktop` 至 `mathslot-desktop`。
  - **本地离线原生包实建通过**：`target/release/mathslot-desktop`（`11,307,632` B，stripped x86-64 ELF）、`target/release-dist/mathslot-desktop-linux-x86_64.tar.gz`（`4,401,621` B）与 `target/release-dist/SHA256SUMS.txt` 均通过校验；Rust `278 passed`、UI/Desktop/Obsidian 与 `acceptance.sh` 全绿。

## 下一轮入口（Round 38 / Gate `G4` 最终退出）

1. 按 [ADR-0038](file:///home/mat/Projects/mathslot-next/agent-state/decisions/ADR-0038-gate-g4-hygiene-and-exit-verification.md) 清零活跃核心 `crates/mathslot-doc/src/document.rs` 3 处守卫 `.unwrap()`，并独立提交工具链修改以令 `scripts/agent/acceptance.sh` 精确区分活跃主路径与冻结对照旧栈。
2. 派发独立 `mathslot-verifier` 执行 Gate G4 最终全量退出验收（全 Acceptance/Screenshot 清单 + 全量门禁 + 原生二进制与插件打包），产出 `VER-38.md`，随后运行 `scripts/agent/supervise.sh --final` 完成最终外部监督审查。

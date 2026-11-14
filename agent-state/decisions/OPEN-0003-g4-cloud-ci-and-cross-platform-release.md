# OPEN-0003: Gate G4 收尾的三平台 CI 与三平台发布包证据缺口

- **Date**: 2026-11-15
- **Round**: 39
- **Gate / Task**: `G4` / `GATE-G4`（项目最终收尾）
- **Status**: OPEN（需人工决策；已触发 `STOPPED`，不得写 `DONE`）
- **Review Evidence**: [`REV-dd38ff2.md`](../reviews/REV-dd38ff2.md)（`opencode-supervisor`，verdict **REJECT**，`review_rc=6`）
- **Local Evidence**: [`VER-39.md`](../verify/VER-39.md)（PASS）、[`GATE-G4.md`](../verify/GATE-G4.md)
- **Spec Reference**: `docs/LLM_IMPLEMENTATION_SPEC.md` §14 `T4.6`（“CI 绿；三平台包可用”）、§16.2

---

## 1. 阻塞摘要

本地 Linux 门禁与双端验收均已实跑通过：

- `bash scripts/agent/acceptance.sh` → `PASS=10 FAIL=0 WARN=0`（含 `cargo fmt --check`、`clippy -D warnings`、`cargo test --workspace`、`xtask check`、调色板、WASM/性能预算、工作区干净）。
- `cargo test --workspace --offline` → **280 passed; 0 failed; 0 ignored**。
- `packages/ui` 54、`apps/desktop` 7、`apps/obsidian` 19 项 vitest；Desktop E2E 8、Obsidian E2E 7。
- `node obsidian-mathslot/scripts/build.mjs && git diff --exit-code -- obsidian-mathslot/` → 退出码 `0`。
- 本地 Linux 打包 `scripts/package-desktop-local.sh` → `mathslot-desktop-linux-x86_64.tar.gz`（约 `4.2M`），SHA256 校验通过。

但外部最终审查 [`REV-dd38ff2.md`](../reviews/REV-dd38ff2.md) §1/§5 判定 **REJECT**，两条硬门禁缺少实跑证据：

1. **§16.2「fmt/clippy/test/WASM/plugin/E2E 三平台 CI 绿」未被证明**：
   - `.github/workflows/ci.yml:11-17` 的三平台矩阵（`ubuntu-24.04` / `windows-latest` / `macos-latest`）只覆盖 `test/build`；完整门禁 `ci-linux-full` 仅 `ubuntu-24.04`（`ci.yml:73-75`）。
   - `refactor/v1` 从未推送到 `origin`：`git ls-remote --heads origin` 仅返回 `a422e412ad2ed57e6b34fc5f50285b47bc19ff74 refs/heads/main`（旧项目），无 `refactor/v1`；GitHub Actions 从未实际运行。
2. **`T4.6`「三平台包可用」未被证明**：
   - `.github/workflows/release.yml` 已配置 Windows（`release.yml:195`、`:222` `.msi`/NSIS）与 macOS（`release.yml:248-251`、`:280` universal `.app`/`.dmg`）打包，但从未实跑。
   - 本地仅实测 Linux `.tar.gz`；Windows `.msi`/NSIS 与 macOS `.app`/`.dmg` 无任何产物或运行 URL。

REV 同时明确：本地全绿与 P1/P2 修复均为真实结果，**不因本次 REJECT 修改产品代码**；缺少的是发布门禁的实跑证据或人工书面裁决。

---

## 2. 需要人工二选一确认的方案

### 选项 A：推送并跑云端三平台 CI/打包，再重审（严格按规范收口）

1. 人工执行 `git push origin refactor/v1`（代理不 push）。
2. 在 GitHub Actions 上跑绿 `.github/workflows/ci.yml`：至少确认 `ci-matrix` 的 ubuntu/windows/macos 三个 job 全绿；若要求 §16.2 的完整门禁也覆盖三平台，需先补齐 `fmt/clippy/WASM/plugin/E2E` 到三平台矩阵（该改动属于工具链提交，需单独 ADR）。
3. 触发 `.github/workflows/release.yml`（或打 tag），取得 Windows `.msi`/NSIS、macOS `.app`/`.dmg`、Linux `.deb`/`.AppImage` 的实际产物与运行 URL。
4. 把 CI/Release 运行 URL 与产物校验（SHA256）写入 `GATE-G4.md`，再运行
   `SUPERVISOR_MODEL=volcengine-plan/deepseek-v4-pro scripts/agent/supervise.sh --final`。
5. 仅在新 `REV-<head>.md` 为 **APPROVE** 后，才写 `agent-state/DONE` 与最终 `OVERNIGHT_REPORT.md`。

### 选项 B：人工书面 waiver，以离线 Linux 等价门禁作为本次重构完成线

1. 人工在本文件补充批准记录（批准人 / 日期 / 范围），明确接受：
   - 三平台 CI 与 Windows/macOS 安装包**不在本次重构交付范围**，移交人工发布流程；
   - 完成线 = 本地 Linux 全量门禁 + 双端 E2E + 本地 Linux 打包；
   - 已知边界：`wasm-opt -Oz` 未安装（WASM `338,058 B` 仍低于 `409,600 B` 预算）。
2. 将 `GATE-G4.md` 的结论改为 `PASS by waiver`，引用本文件的批准记录。
3. 重新执行最终审查（或由人工确认接受 REV 的条件性结论），随后写 `DONE` 与最终报告。

---

## 3. 当前停机状态

- `agent-state/STOPPED` 已写入：`reason=REJECT: three-platform CI/packages unverified; OPEN-0003`，`head=dd38ff2`。
- `state.json`：`last_verdict=REJECT`、`active_task=GATE-G4`、`blocked_by=OPEN-0003`、`reviews.last_head=dd38ff2`。
- 未写 `agent-state/DONE`；在人工选择 A 或 B 之前不得继续自动推进。

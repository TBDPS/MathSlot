# ADR-0004：CI 门禁流水线建立（T0.1）

- 日期：2026-11-13
- 状态：已批准
- 决策者：coordinator（依据 `AUD-1` 审计结论与规范 §14 G0 / T0.1）
- 关联任务：`T0.1`
- 关联缺陷：`D-023`

## 1. 背景与依据

- `AUD-1` 独立审计确认：当前仓库没有持续集成 CI 门禁（仅有 tag 触发的 `release.yml`，F-005 / D-023）。
- 规范 §14 G0 任务第一项为 `T0.1`：
  > T0.1 | 增加 CI：fmt/clippy/test/WASM/plugin build | — | `.github/workflows/ci.yml` | PR 上自动运行
- 当前代码基线：`cargo fmt --check` 失败，`cargo clippy` 失败，`cargo test --workspace` 为 133 通过。
- 规范明确指出：“绿属于 G0 退出，不属于 T0.1”。在 T0.1 阶段建立严格门禁流水线，允许在 G0 期间因历史存量 lint/fmt 债务为红状态，待后续 T0.2 治理后转绿。

## 2. 决策内容

### 2.1 允许写入的路径

本轮实施仅允许修改/新增以下路径：
- `.github/workflows/ci.yml`

严禁修改：
- `src/**`
- `crates/**`
- `scripts/agent/**`
- `docs/**`

### 2.2 CI 流水线技术契约

1. **触发时机**：
   - `push`（所有分支）
   - `pull_request`（针对主分支或默认分支）
2. **权限**：
   - `permissions: contents: read`
3. **运行环境**：
   - 主体采用 `ubuntu-latest`，确保轻量稳定。三平台完整矩阵（macOS, Windows）留待发布与硬化阶段（T4.6），不阻塞 T0.1。
4. **依赖项**：
   - 复用 `release.yml` 的 Linux 系统依赖：`libasound2-dev`, `libudev-dev`, `libwayland-dev`, `libxkbcommon-dev`, `libx11-dev`, `libx11-xcb-dev`。
   - Rust toolchain: `stable`，携带 `wasm32-unknown-unknown` target 与 `clippy`, `rustfmt` component。
   - Node.js: `22`。
5. **严禁逃逸规约**：
   - 严禁 `continue-on-error: true`。
   - 严禁 `|| true`、`set +e` 或任何静默吞掉返回码的 shell 技巧。
   - 严禁为了通过 CI 而在产品代码中添加 `#[allow(...)]`。
6. **执行步骤**：
   - Step 1: `cargo fmt --check`
   - Step 2: `cargo clippy --workspace --all-targets -- -D warnings`
   - Step 3: `cargo test --workspace`
   - Step 4: `cargo build -p mathslot-wasm --target wasm32-unknown-unknown --release`
   - Step 5: `node obsidian-mathslot/scripts/build.mjs`
   - 不增加 `wasm-opt`/binaryen。
   - 不运行 `npm test` 或 `npm run e2e`（仓库中不存在对应 package.json 测试脚本）。

## 3. 验收标准与验证要求（VER-1）

1. **YAML 格式正确性**：通过 `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` 解析。
2. **本地步骤等价性**：验证 5 个步骤均可在本地执行，不出现命令找不到或语法错误。
3. **禁止项扫描**：全文件扫描不得包含 `continue-on-error`、`|| true`、`set +e`。
4. **范围约束**：`git diff` 严格局限于 `.github/workflows/ci.yml`。
5. **未验证项**：在 `VER-1` 中显式注明“未在 GitHub Actions 远端实跑”。

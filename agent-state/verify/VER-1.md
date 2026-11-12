---
id: VER-1
round: 1
task: T0.1
defects: [D-023]
verdict: PASS
verifier: verifier
date: 2026-11-13
---

# MathSlot 独立验收报告 (VER-1)

- **验收角色**：verifier（独立只读验收）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **目标任务**：`T0.1` 增加 CI 流水线 (`.github/workflows/ci.yml`)
- **关联缺陷**：`D-023`
- **核验 Commit**：`17ffa616bf40d8f1e7b905fd017ff33b9ff0d709`
- **综合裁定**：**PASS**

---

## 1. 结论

**PASS**。
Implementer 针对任务 `T0.1`（修复 `D-023`）的交付物已完全独立核验通过：
1. 提交与修改范围严格隔离在 `.github/workflows/ci.yml`，未改动任何产品代码、测试、配置或脚本；
2. YAML 语法正确无误，通过 `python3 yaml.safe_load` 解析；
3. 本地 5 个对应步骤（fmt / clippy / test / WASM / Obsidian plugin build）均可真实执行，命令定义准确无误；
4. 门禁按预期如实拦截存量债务（`cargo fmt` exit 1，`clippy` exit 101），`cargo test` 133 项全部通过；
5. 流水线定义中无任何放宽/吞错指令（无 `continue-on-error`、`|| true`、`set +e`、`#[allow]`），具备只读权限与首行明确注释（“绿属于 G0 退出，不属于 T0.1”）。

---

## 2. 命令与输出证据

### 2.1 提交信息与文件变更范围核查
- **命令**：
  ```bash
  git log -1 --stat
  ```
- **退出码**：`0`
- **输出**：
  ```text
  commit 17ffa616bf40d8f1e7b905fd017ff33b9ff0d709 (HEAD -> refactor/v1)
  Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
  Date:   Fri Nov 13 03:27:55 2026 +0800

      T0.1: add CI workflow (.github/workflows/ci.yml) (D-023)

   .github/workflows/ci.yml | 58 ++++++++++++++++++++++++++++++++++++++++++++++++
   1 file changed, 58 insertions(+)
  ```
- **范围验证**：
  ```bash
  git diff HEAD~1
  ```
  - 仅包含新增文件 `.github/workflows/ci.yml`（58 行新增），无任何其他文件变动。

### 2.2 YAML 语法与解析验证
- **命令**：
  ```bash
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
  ```
- **退出码**：`0`
- **输出**：无报错，语法合法。

### 2.3 本地步骤等价性与执行验证

#### 步骤 1：代码格式检查 (`cargo fmt --check`)
- **命令**：
  ```bash
  cargo fmt --check
  ```
- **退出码**：`1`
- **输出尾部**：
  ```text
  Diff in /home/mat/Projects/mathslot-next/crates/mathslot-core/src/ast.rs:89:
  Diff in /home/mat/Projects/mathslot-next/crates/mathslot-core/src/command.rs:45:
  Diff in /home/mat/Projects/mathslot-next/src/theme.rs:240:
  ```
- **判定**：按预期拦截历史存量格式债务。

#### 步骤 2：Clippy 静态检查 (`cargo clippy --workspace --all-targets -- -D warnings`)
- **命令**：
  ```bash
  cargo clippy --workspace --all-targets -- -D warnings
  ```
- **退出码**：`101`
- **输出尾部**：
  ```text
  error: empty line after doc comment
   --> crates/mathslot-core/src/library.rs:1:1
  ...
  error: could not compile `mathslot-core` (lib) due to 13 previous errors
  error: could not compile `mathslot-core` (lib test) due to 13 previous errors
  ```
- **判定**：按预期拦截存量 clippy 违规（13 处错误），无放宽。

#### 步骤 3：全工作区单元测试 (`cargo test --workspace`)
- **命令**：
  ```bash
  cargo test --workspace
  ```
- **退出码**：`0`
- **输出统计**：
  ```text
  mathslot: 3 passed
  mathslot_core (unittests): 33 passed
  acceptance_tester_round11_comprehensive: 10 passed
  acceptance_tests: 16 passed
  final_acceptance_round11: 7 passed
  final_acceptance_round12: 2 passed
  final_acceptance_round5: 5 passed
  final_acceptance_round6: 5 passed
  final_acceptance_round7: 7 passed
  final_acceptance_round8: 5 passed
  final_acceptance_round9: 5 passed
  massive_preset_compatibility_tests: 1 passed
  overhaul_acceptance_tests: 5 passed
  session_tests: 4 passed
  doc_tests: 5 passed
  latex_tests: 5 passed
  golden_tests: 15 passed
  Total: 133 passed; 0 failed; 0 ignored; 0 measured
  ```
- **判定**：符合 AGENTS.md §3 基线事实（133 passed）。

#### 步骤 4：WASM 编译 (`cargo build -p mathslot-wasm --target wasm32-unknown-unknown --release`)
- **命令**：
  ```bash
  cargo build -p mathslot-wasm --target wasm32-unknown-unknown --release
  ```
- **退出码**：`0`
- **输出**：
  ```text
      Finished `release` profile [optimized] target(s) in 0.08s
  ```
- **判定**：顺利编译无误。

#### 步骤 5：Obsidian 插件构建与冒烟测试 (`node obsidian-mathslot/scripts/build.mjs`)
- **命令**：
  ```bash
  node obsidian-mathslot/scripts/build.mjs
  ```
- **退出码**：`0`
- **输出**：
  ```text
  [1/3] Compiling shared mathslot-wasm (wasm32-unknown-unknown --release)...
      Finished `release` profile [optimized] target(s) in 0.06s
  [2/3] Bundling obsidian-mathslot/main.js (WASM binary: 604.5 KB)...
  [3/3] Running Node.js WebAssembly end-to-end smoke test...
  ✓ Obsidian plugin built and verified successfully: obsidian-mathslot/main.js
  ```
- **判定**：WASM 打包与端到端 smoke 测试全部通过。

### 2.4 契约与禁止项扫描
- **命令**：
  ```bash
  grep -E "continue-on-error|\|\| true|set \+e|#\[allow\]" .github/workflows/ci.yml
  ```
- **退出码**：`1`（未匹配到任何禁止模式，确认全无）
- **契约核验**：
  - 触发条件：`push` 与 `pull_request` 均配置；
  - 最小权限：`permissions: contents: read`；
  - 基础镜像：`runs-on: ubuntu-latest`；
  - Linux 依赖包：包含 `libasound2-dev`, `libudev-dev`, `libwayland-dev`, `libxkbcommon-dev`, `libx11-dev`, `libx11-xcb-dev`；
  - 缓存与工具链：使用 `Swatinem/rust-cache@v2`，Node.js 指定 `22`；
  - 首行注释说明：明确写明 `# Note: Green CI belongs to G0 exit conditions, not T0.1 exit. Failure during early G0 is expected until T0.2.`。

---

## 3. 逐项验收

| 验收项 / 规则 | 期望 | 实测 | 判定 |
|---|---|---|---|
| **提交格式规范** | Commit message 带任务 ID 与缺陷 ID | `T0.1: add CI workflow (.github/workflows/ci.yml) (D-023)` | **PASS** |
| **修改范围最小化** | 仅允许变更 `.github/workflows/ci.yml` | `git diff HEAD~1` 仅 1 个文件，无侵入其他代码 | **PASS** |
| **工作流语法解析** | YAML 语法有效可解析 | `python3 -c "import yaml; ..."` exit 0 | **PASS** |
| **禁止放宽规则** | 无 `continue-on-error`, `\|\| true`, `set +e` | 正则扫描 exit 1，无任何放宽指令 | **PASS** |
| **权限最小化** | `permissions: contents: read` | 明确显式配置 `contents: read` | **PASS** |
| **触发器覆盖** | 支持 `push` 与 `pull_request` | `on:` 包含 `push` 与 `pull_request` | **PASS** |
| **依赖与构建完整性** | 覆盖 fmt/clippy/test/wasm/obsidian plugin | 5 步完整定义，本地实际运行均与预期一致 | **PASS** |
| **G0 退出条件边界** | 注释明确区分 T0.1 与 G0 退出 | 包含清晰的 Note 说明 | **PASS** |

---

## 4. 阻断原因与复现
- 本轮验收未发现阻断项。
- 存量失败（`cargo fmt` exit 1，`cargo clippy` exit 101）属于 G0 初始基线存量问题，由后续 `T0.2` 进行针对性治理，在 T0.1 阶段按规范如实拦截，符合验收契约。

---

## 5. 未验证/风险
1. **GitHub Actions 远端实跑未验证**：本验收在本地 Linux 环境完成语法解析与命令等价性执行，由于本地无法模拟 GitHub Actions 远端服务调度器与环境网络交互，工作流尚未在 GitHub Actions 远端服务真实触发运行。
2. **早期 CI 状态为红**：由于存量代码存在 `cargo fmt` 差异及 13 处 clippy 错误，当工作流在 GitHub Actions 触发时，步骤 `cargo fmt --check` 与 `cargo clippy` 将报红中断。这是预期行为，将在 `T0.2` 解决后实现 CI 绿化（G0 退出条件）。

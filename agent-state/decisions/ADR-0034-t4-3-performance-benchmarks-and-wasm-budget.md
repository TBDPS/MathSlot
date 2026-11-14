# ADR-0034: T4.3 性能基准套件、连续输入调度修复与 WASM `<= 400 KB` 预算契约

- 状态：Accepted（Coordinator 决策，`refactor/v1`，Gate G4 / Round 34）
- 关联任务：`T4.3`（性能基准与预算：`docs/LLM_IMPLEMENTATION_SPEC.md` §13.5）
- 关联审计：`agent-state/audits/AUD-30.md`
- 关联缺陷：`D-152`、`D-153`、`D-154`、`D-155`
- 参考规范：`docs/LLM_IMPLEMENTATION_SPEC.md` §13.4、§13.5、§14（`T4.3`）

## 1. 背景与实测瓶颈

`AUD-30.md` 在基线 `fa4bd5d` 实测暴露了 §13.5 的 4 项阻断缺口：
1. `D-152`（P1）：`mathslot_wasm_bg.wasm` 未压缩体积为 `494,010 bytes`（`482.43 KiB`），超出 `<= 400 KB`（`409,600 bytes`）目标 `+20.6%`；且 `obsidian-mathslot/main.js`（`3.59 MB`）因 `mathslot_wasm.js` 死代码分支被 Vite 重复内联了两次 658 KB WASM base64；
2. `D-153`（P1）：`PreviewPanel.svelte:217-218` 直接调用 `managed.render(req)` 绕过了 `managed.schedule()`；且默认/Obsidian/Desktop 的 `maxWaitMs`（`150 / 120 / 100 ms`）叠加渲染耗时超过 `< 100 ms` 连续输入预算，且 `App.svelte` `$derived` 重建 `latexRustManaged` 未释放旧实例；
3. `D-154`（P1）：工作区全仓无 `[[bench]]` 基准、无启动/内存基准 JSON、无 `<= 10%` 回归验证测试（注意：离线环境 `Cargo.lock` 不含 `criterion`，不得引入需要联网拉取的新 crate）；
4. `D-155`（P2）：CI 与门禁缺少基准与 WASM 体积红线校验；`App::dispatch_snapshot` 在 1000 次连续编辑下因重复 `to_latex()` 与全量快照构造导致单键耗时从 `1.04 ms` 升至 `3.80 ms`。

## 2. 授权设计与指标契约

### 2.1 `D-152`：WASM `<= 400 KB`（`<= 409,600 bytes`，gzip 前）与 `main.js` 去重

1. **Cargo WASM 体积配置**：
   - 在根目录 `Cargo.toml` 定义专用 WASM release profile `[profile.wasm-release]`（`inherits = "release"`, `opt-level = "z"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = "symbols"`），并在 `obsidian-mathslot/scripts/build.mjs` 中使用 `--profile wasm-release`（输出 `target/wasm32-unknown-unknown/wasm-release/mathslot_wasm.wasm`）；同时确认如系统安装 `wasm-opt` 则附加执行 `wasm-opt -Oz`，即使本机未安装 `wasm-opt` 也必须保证 `mathslot_wasm_bg.wasm <= 409,600 bytes`。
2. **消除无用代码与数据膨胀**：
   - `crates/mathslot-command/Cargo.toml` 将 `toml` 设为可选 feature（`default = ["toml"]`），`crates/mathslot-wasm` 以 `default-features = false` 依赖 `mathslot-command`，避免 `toml_edit`/`winnow` 编入 WASM；
   - `crates/mathslot-wasm` 移除 `presets_json_str()` 中通过 `serde_json::Value` 做的运行时二次解析与重序列化（在编译期 `build.rs` 将 `catalog/presets.json` 压缩为紧凑单行 JSON 或等效静态字节，去除 `serde_json::Value`/`BTreeMap`/`zmij` 冗余及空白开销），对外返回字段与内容语义保持 100% 一致。
3. **消除 `obsidian-mathslot/main.js` 双份 WASM 嵌入**：
   - 修正 `apps/obsidian/src/wasmClient.ts` / `apps/obsidian/vite.config.ts` / `build.mjs` 打包路径，确保仅保留唯一的 `__MATHSLOT_INLINE_WASM_B64__`（禁止 Vite 把 `mathslot_wasm.js` 中的死分支 `new URL('mathslot_wasm_bg.wasm', import.meta.url)` 再次内联成第二份 `data:application/wasm;base64,...`）。`main.js` 中 `AGFzbQE` base64 出现次数必须 `== 1`。
4. **同步 Desktop Vite 引用的 WASM**：
   - `obsidian-mathslot/scripts/build.mjs` 同步产物至 `apps/obsidian/src/wasm-pkg/`，使 Desktop `@mathslot/wasm` 与 Obsidian 共用同一份 `<= 400 KB` 瘦身后产物。

### 2.2 `D-153`：连续输入防抖调度生效与 `< 100 ms` 端到端预算

1. **`PreviewPanel.svelte` 真实走 `managed.schedule(...)`**：
   - `PreviewPanel.svelte` 在收到渲染请求时调用 `managed.schedule(req, callbacks)`（可结合首帧/状态切换正常调度，不再每次击键都同步硬调 `managed.render(req)`）。
2. **`maxWaitMs` 收敛至 `< 100 ms` 安全预算内**：
   - `packages/ui/src/preview/renderAdapter.ts` 默认参数收紧为 `debounceMs = 24, maxWaitMs = 56`（或同等组合使得 `maxWaitMs <= 60 ms`，留足 `40 ms` 给 MathJax p95 ~13 ms / cold ~33 ms）；
   - `apps/obsidian/src/hostRenderAdapter.ts` 与 `apps/desktop/src/App.svelte` 对齐 `debounceMs <= 25, maxWaitMs <= 60`，同步更新 `crates/mathslot-render/tests/render_acceptance_tests.rs` 的相关调度阈值。
   - 在 `apps/desktop/src/App.svelte` 修复 `$derived` 重建 `latexRustManaged` 未释放旧定时器的问题（改用 `$effect`/持久化实例复用 + `onDestroy` `dispose()`）。
   - 添加 Vitest / E2E 测试实测：连续 10 次间隔 15 ms 的快速击键，既会触发防抖合并（渲染调用次数 `< 10`），又会在 `< 100 ms` 内输出最终帧，避免陈旧帧覆盖最新请求。

### 2.3 `D-154` & `D-155`：离线基准套件、内存/缩放治理与自动化门禁

1. **零外网依赖离线基准（`--offline` 可运行）**：
   - 在 `crates/mathslot-app/Cargo.toml` 与 `crates/mathslot-render/Cargo.toml` 新增 `[[bench]]` (`harness = false`，纯 `std::time::Instant` 统计冷启动、典型/深嵌套 parse、连续 1000 键 edit dispatch、SVG 渲染 p50/p95 与当前 RSS，并输出可读摘要 + 严格断言 `parse p95 < 5 ms`、`render p95 < 100 ms`）；
   - 新增可独立运行的 Node 性能基准验证脚本 `scripts/bench-budgets.mjs`（或放在 `packages/ui/scripts/` / `apps/desktop` 测试可读的位置，遵循 ADR write scope：放在 `packages/ui/scripts/bench-budgets.mjs` 或 `apps/obsidian` 测试中；Coordinator 另外将基准基线写入 `agent-state/baseline/perf-baseline.json` 并接入 `scripts/agent/acceptance.sh`）：
     - 实测：`mathslot_wasm_bg.wasm <= 409,600 bytes` (`<= 400 KB`)；
     - 实测：`obsidian-mathslot/main.js` 仅含 1 份 base64 WASM（非 2 份）；
     - 实测：WASM 冷启动（init + catalog + presets）、WASM 典型 parse (`< 5 ms`)、MathJax 渲染 p95 (`< 100 ms`)、连续输入防抖调度 `< 100 ms`、1000 次连续输入 WASM 线性内存及 RSS 不超过基线 `+10%`。
2. **1000 编辑序列化放大优化（`D-155`）**：
   - 检查 `crates/mathslot-app/src/app.rs` 每次 `KeyInput` 重复调用 `self.editor.to_latex()` 与生成全量 `EngineSnapshot` 的热点，在不改变协议/快照语义的前提下消除冗余重复 `to_latex()`（如复用已计算的 `source_text` / 局部缓存或减少无谓二次格式化），降低连续长公式输入时的递增斜率。
3. **CI 集成（`.github/workflows/ci.yml`）**：
   - 在 `.github/workflows/ci.yml` 新增 WASM 体积检查（`<= 409600 bytes`）与离线 `cargo bench --no-run` / perf 断言步骤，并可选在检测到 `wasm-opt` 时执行优化校验。

## 3. 允许修改范围（Implementer 唯一写权限）

- `Cargo.toml`
- `crates/mathslot-command/**`
- `crates/mathslot-wasm/**`
- `crates/mathslot-app/**`
- `crates/mathslot-render/**`
- `packages/ui/**`
- `apps/desktop/**`
- `apps/obsidian/**`
- `obsidian-mathslot/scripts/build.mjs`、`obsidian-mathslot/main.js`、`obsidian-mathslot/styles.css`
- `.github/workflows/ci.yml`

禁止修改：`docs/LLM_IMPLEMENTATION_SPEC.md`、`scripts/agent/**`、`agent-state/**`（Coordinator 在 `implementer` 提交后独立落盘 `agent-state/baseline/perf-baseline.json` 与 `scripts/agent/acceptance.sh` 回归守卫）、冻结参考目录。

## 4. Red -> Green 顺序与门禁

1. 先写失败测试 / 红线断言并记录 Red 失败输出：
   - WASM `mathslot_wasm_bg.wasm <= 409600 bytes` & `main.js` 单份 base64 嵌入断言（当前 494,010 bytes 与 2 份必然失败）；
   - `PreviewPanel` 防抖合并测试 & 连续输入 `maxWaitMs + renderMs < 100 ms` 断言（当前直接调用 `render` 且 `maxWaitMs >= 100 ms` 必然失败）；
   - `crates/mathslot-app` / `crates/mathslot-render` 离线 `[[bench]]` 与 1000 编辑/启动/内存阈值验证。
2. 完成实现后：
   - 运行 `node obsidian-mathslot/scripts/build.mjs`（确认 WASM `<= 409,600 bytes` 与 `main.js` 零漂移）；
   - 运行 `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`cargo test --workspace --offline`、`cargo bench --workspace --offline`；
   - 运行 `packages/ui`、`apps/obsidian`、`apps/desktop` 单测、`svelte-check`、构建、Playwright E2E 与 Node 性能预算验证；
   - 保持 0 `.unwrap()` / 0 `let _ =` 新增、0 `#[ignore]`/`.skip(`、0 硬编码颜色。

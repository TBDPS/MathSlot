---
id: VER-34
round: 34
gate: G4
task: T4.3
defects: [D-152, D-153, D-154, D-155]
commit: b0d7db5
base_commit: a8285e4
branch: refactor/v1
verdict: PASS
verifier: verifier
date: 2026-11-15
---

# VER-34：Gate G4 / T4.3（§13.5 性能基准与预算）独立验收报告

## 1. 结论

**`PASS`**。提交 `b0d7db5`（基线 `a8285e4`，分支 `refactor/v1`）完整落实 `ADR-0034` 授权范围与 `docs/LLM_IMPLEMENTATION_SPEC.md` §13.4 / §13.5 / §14（`T4.3`）要求，关闭 `D-152`、`D-153`、`D-154`、`D-155` 的实现层阻断：

1. **`D-152`（WASM `≤ 400 KB` 与 `main.js` 去重）**：`apps/obsidian/src/wasm-pkg/mathslot_wasm_bg.wasm` 实测 **`338,391 bytes`（`330.5 KiB` raw / `119.5 KiB` gzip）**，低于 `409,600 bytes`（400 KiB）上限 `71,209 bytes`（-17.4%）；`apps/desktop` 打包产物 `dist/assets/mathslot_wasm_bg-Mt0TKuUD.wasm` 为 `338.39 kB`（gzip `123.33 kB`）；`obsidian-mathslot/main.js` 降至 **`2,720,521 bytes`（`2656.8 KiB`）**，且 `AGFzbQE` base64 嵌入次数 **`== 1`**（长度 `451,188` 字符）。
2. **`D-153`（连续输入防抖调度与 `< 100 ms` 预算）**：`PreviewPanel.svelte:217` 改用 `managed.schedule(req, ...)`（移除 `ownedManaged` 的 `debounceMs: 0` 覆盖，并增加 `destroyed` 销毁守卫）；`renderAdapter.ts:349`、`apps/obsidian/src/hostRenderAdapter.ts:47-48` 与 `apps/desktop/src/App.svelte:54-61` 统一收敛至 `debounceMs = 24, maxWaitMs = 56`（实测 `maxWait + MathJax p95 = 56 + 15.456 = 71.456 ms < 100 ms`）；`App.svelte` 取消在 `$derived` 中重建 `latexRustManaged` 并补齐 `onDestroy` `latexRustManaged.dispose()`；`PreviewPanel`、`apps/obsidian` 与 `apps/desktop` 新增 15 ms 间隔连续 10 键防抖合并实测均通过（`< 10` 次渲染、首帧 `< 100 ms`）。
3. **`D-154` & `D-155`（离线基准、序列化缓存优化与 CI 门禁）**：新增零外网依赖 `crates/mathslot-app/benches/app_bench.rs`（`typical_parse p95 = 0.0531 ms`、`deep_5000_parse p95 = 1.0151 ms`、`stress_1000_edits p95 = 0.4221 ms`）、`crates/mathslot-render/benches/render_bench.rs`（`cold = 0.7124 ms`、`p95 = 0.5922 ms`）及 `packages/ui/scripts/bench-budgets.mjs`（WASM parse `p95 = 0.424 ms`、MathJax SVG `p95 = 15.456 ms`、1000 键均值从 `AUD-30` 的 `1.256 ms` 降至 `0.888 ms`、末桶 `900-1000` 从 `3.804 ms` 降至 `1.627 ms`）；`App::dispatch_snapshot` 缓存验证与 `app.snapshot()` 逐帧一致；`.github/workflows/ci.yml` 已接入 `cargo bench --workspace --offline` 与 `node packages/ui/scripts/bench-budgets.mjs`。

---

## 2. Diff 与静态规范核查

### 2.1 提交范围与允许路径（`git diff --stat a8285e4..b0d7db5`）

共改动 26 个文件（`+962 / -109`），**全部位于 `ADR-0034` §3 授权白名单内**，未修改 `docs/LLM_IMPLEMENTATION_SPEC.md`、`scripts/agent/**`、`agent-state/**` 或冻结参考目录：

- `.github/workflows/ci.yml`
- `Cargo.toml`
- `crates/mathslot-command/Cargo.toml`、`crates/mathslot-command/src/lib.rs`
- `crates/mathslot-wasm/Cargo.toml`、`crates/mathslot-wasm/build.rs`、`crates/mathslot-wasm/src/lib.rs`、`crates/mathslot-wasm/tests/t3_6_wasm_bindgen_tests.rs`
- `crates/mathslot-app/Cargo.toml`、`crates/mathslot-app/benches/app_bench.rs`、`crates/mathslot-app/src/app.rs`、`crates/mathslot-app/tests/snapshot_tests.rs`
- `crates/mathslot-render/Cargo.toml`、`crates/mathslot-render/benches/render_bench.rs`、`crates/mathslot-render/tests/render_acceptance_tests.rs`
- `packages/ui/scripts/bench-budgets.mjs`、`packages/ui/src/preview/PreviewPanel.svelte`、`packages/ui/src/preview/renderAdapter.ts`、`packages/ui/tests/preview.test.ts`
- `apps/obsidian/src/hostRenderAdapter.ts`、`apps/obsidian/tests/obsidian.test.ts`、`apps/obsidian/vite.config.ts`
- `apps/desktop/src/App.svelte`、`apps/desktop/tests/desktopUi.test.ts`
- `obsidian-mathslot/scripts/build.mjs`、`obsidian-mathslot/main.js`

### 2.2 禁令模式扫描（新增代码）

对 `git diff a8285e4..b0d7db5`（含 401 行新增 Rust 代码、246 行新增 TS/Svelte 代码）扫描：
- 新增 Rust 代码中 `#[ignore`、`#[allow(`、`let _ =`、`.unwrap(`：**0 处**。
- 新增 `.ts` / `.svelte` 代码中 `.skip(`、硬编码 `#hex`、`rgb(` / `rgba(`：**0 处**。

### 2.3 关键实现逻辑核对

1. **`D-152` 语义与体积核对**：
   - `Cargo.toml:58-64` 定义 `[profile.wasm-release]`（`inherits = "release"`, `opt-level = "z"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = "symbols"`）。
   - `crates/mathslot-command/Cargo.toml:7-11` 与 `src/lib.rs:5,23,55,62` 将 `toml` 设为可选 feature（`default = ["toml"]`），`mathslot-wasm` 与 `mathslot-app` 均以 `default-features = false` 依赖 `mathslot-command`，避免 `toml_edit`/`winnow` 编入 WASM。
   - `crates/mathslot-wasm/build.rs` 编译期压缩 `catalog/presets.json` 为 `presets.min.json`（保留字符串内字符与转义，剔除串外 ASCII 空白），`crates/mathslot-wasm/src/lib.rs:10,91` 直接嵌入并移除 `serde_json::Value` 二次解析序列化；集成测试 `d152_presets_json_is_build_time_minified_and_lossless` 已验证 `serde_json::Value` 解析后与 `catalog/presets.json` 100% 等价（`< 32,000 bytes`、无 `\n`）。
   - `apps/obsidian/vite.config.ts:14-39` 新增 `stripDeadWasmUrlPlugin()` 仅针对 `mathslot_wasm.js` 将死分支 `new URL('mathslot_wasm_bg.wasm', import.meta.url)` 替换为 `undefined`（保留 `apps/obsidian/src/wasmClient.ts` 的唯一 `__MATHSLOT_INLINE_WASM_B64__` 加载路径）。
2. **`D-153` 调度与生命周期核对**：
   - `packages/ui/src/preview/PreviewPanel.svelte:217` 调用 `managed.schedule(req, ...)`；`renderAdapter.ts:349`、`apps/obsidian/src/hostRenderAdapter.ts:47-48`、`apps/desktop/src/App.svelte:54-61` 均设 `debounceMs = 24, maxWaitMs = 56`。
   - `apps/desktop/src/App.svelte:49-90` 将 `latexRustAdapter` / `latexRustManaged` 提升为组件级稳定实例，`$effect` 仅在 `hostBridge` 引用变化时 `clearCache()`，并在 `onDestroy` 调用 `latexRustManaged.dispose()`。
3. **`D-155` `App::dispatch_snapshot` 缓存等价性核对**：
   - `crates/mathslot-doc/src/editor.rs:352-354` 确认 `editor.copy_text()` 等价于 `self.to_latex()`。
   - `crates/mathslot-app/src/app.rs:85-134, 257-662` 仅在变更后或命令内消费处填充 `cached_latex` / `cached_preview`，`PerformUndo`/`PerformRedo` 走 `source_undo`/`source_redo` 时保持 `None` 由 `snapshot_with_cache` 重新计算；`d155_dispatch_snapshot_cache_matches_fresh_snapshot_across_1000_edits` 覆盖 1000 次编辑 + Undo/Redo/Clear 与 `app.snapshot()` 完全一致。

---

## 3. 实跑命令与测量输出

| # | 命令 | Exit Code | 关键实测结果 |
|---|---|---|---|
| 1 | `node obsidian-mathslot/scripts/build.mjs && git status --short` | `0` | `cargo wasm-release = 381,453 bytes`；`mathslot_wasm_bg.wasm = 338,391 bytes`（`330.5 KiB` raw / `119.5 KiB` gzip，≤ 409,600）；`obsidian-mathslot/main.js = 2,720,521 bytes`；`AGFzbQE` count = `1`（length `451,188`）；`git status --short` 空（0 漂移） |
| 2 | `cargo fmt --check` | `0` | 无格式差异 |
| 3 | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished dev profile [optimized + debuginfo] target(s) in 1.37s`，0 warnings |
| 4 | `cargo test --workspace --offline` | `0` | 64 个测试套件全部通过：**`269 passed; 0 failed; 0 ignored`**（含新增 `d152_presets_json_is_build_time_minified_and_lossless`、`d155_dispatch_snapshot_cache_matches_fresh_snapshot_across_1000_edits`、`a_render_004_generation_cancellation_cache_key_and_debounce_gate`） |
| 5 | `cargo bench --workspace --offline` | `0` | `app_bench`: `typical_parse` (n=200) `p50=0.0382ms p95=0.0531ms avg=0.0330ms max=0.1851ms`；`deep_5000_parse` (n=20) `p50=0.4987ms p95=1.0151ms avg=0.7692ms max=4.1323ms`；`stress_1000_edits` (n=1000) `p50=0.0700ms p95=0.4221ms avg=0.1318ms max=1.8030ms`；`startup_cold_ms=0.0144`、`rss_start_kb=2400 -> rss_end_kb=10076`。<br>`render_bench`: `latex_rust_render` `cold=0.7124ms p50=0.3460ms p95=0.5922ms avg=0.3244ms max=0.8708ms`、`rss_before_kb=2896 -> rss_after_kb=4608` |
| 6 | `node packages/ui/scripts/bench-budgets.mjs` | `0` | `wasm_bytes=338391`（上限 `409600`）、`main_js_bytes=2720521`、`main_js_wasm_embed_count=1`；`startup.total_cold_ms=102.79`（`b64=0.479, wasm_init=99.233, engine_new=0.727, catalog=2.022, presets=0.329`）；`parse.p95_ms=0.424`（`p50=0.208, avg=0.288`, < 5 ms）；`render.cold_ms=26.813`, `render.p95_ms=15.456`（`p50=5.912, avg=6.612`, < 100 ms）；`continuous_typing`: `debounce=24ms, maxWait=56ms, maxWait+p95=71.456ms`（< 100 ms）；`stress_1000_edits`: `avg=0.888ms p95=1.928ms max=3.972ms`, `bucket_100_avg_ms=[0.164, 0.346, 0.475, 0.876, 0.727, 0.913, 1.14, 1.167, 1.448, 1.627]`, `wasm_memory=1,441,792 -> 4,980,736 bytes`, `node_rss=130,523,136 -> 138,911,744 bytes` |
| 7 | `npm --prefix packages/ui test && npm --prefix packages/ui run check && npm --prefix packages/ui run build` | `0` | Vitest: `8 files, 47 passed`（含 `D-153` `PreviewPanel` 防抖合并测试）；`svelte-check`: `0 errors and 0 warnings`；`vite build`: `dist/index.js 2,597.00 kB`, `dist/index.css 53.01 kB` |
| 8 | `npm --prefix apps/obsidian test && npm --prefix apps/obsidian run check && npm --prefix apps/obsidian run test:e2e` | `0` | Vitest: `1 file, 18 passed`（含 `D-152 / D-153` WASM 体积、`main.js` 单嵌入与 `hostRenderAdapter` 测试）；`svelte-check`: `0 errors and 0 warnings`；Playwright E2E: `6 passed (28.3s)` |
| 9 | `npm --prefix apps/desktop test && npm --prefix apps/desktop run check && npm --prefix apps/desktop run build && npm --prefix apps/desktop run test:e2e` | `0` | Vitest: `1 file, 6 passed`（含 `D-153` `App.svelte` 10 键快速输入合并与 `$derived` 检查）；`svelte-check`: `0 errors and 0 warnings`；`vite build`: `dist/assets/mathslot_wasm_bg-Mt0TKuUD.wasm 338.39 kB`（gzip `123.33 kB`）；Playwright E2E: `7 passed (19.8s)` |
| 10 | `scripts/agent/acceptance.sh` | `0` | `PASS=5 FAIL=0 WARN=3`（`fmt`/`clippy`/`test`/`palette`/`clean` 全 PASS；WARN 为既有工作区基线计数，非本轮新增） |

---

## 4. §13.5 预算对照表

| §13.5 指标 | 规范预算 | 本轮实测证据 | 判定 |
|---|---|---|---|
| 典型公式 parse | `< 5 ms` | Native `p95 = 0.0531 ms`；WASM `p95 = 0.424 ms` | **PASS** |
| 预览 p95 | `< 100 ms` | `LatexRustSvgBackend` `p95 = 0.5922 ms`；MathJax SVG `p95 = 15.456 ms` | **PASS** |
| 连续输入预览延迟 | `< 100 ms` | `PreviewPanel` 走 `schedule()`，`debounce=24ms, maxWait=56ms`；`maxWait + MathJax p95 = 71.456 ms`；Vitest 15ms 连续 10 键实测 `< 10` 渲染且首帧 `< 100 ms` | **PASS** |
| 启动 | 有基准，不回归 > 10% | Native cold `0.0144 ms`；WASM cold `102.79 ms`（可重复 `app_bench` + `bench-budgets.mjs`） | **PASS**（实现侧达标，基线文件落盘见 §5） |
| 内存 | 有基准，不回归 > 10% | Native RSS `2400 -> 10076 KB` (`app_bench`) / `2896 -> 4608 KB` (`render_bench`)；WASM 1000 编辑线性内存 `1.44 MB -> 4.98 MB`、Node RSS `130.5 -> 138.9 MB` | **PASS**（实现侧达标，基线文件落盘见 §5） |
| WASM | `≤ 400 KB`（gzip 前） | `mathslot_wasm_bg.wasm = 338,391 bytes`（`330.5 KiB` ≤ `409,600 bytes`）；`main.js` 仅 1 份 base64 WASM | **PASS** |

---

## 5. 未验证项与后续衔接说明（非本提交阻断）

1. **Coordinator 后续落盘项（`ADR-0034` §3 已显式划分归属）**：`ADR-0034` §3 禁止 implementer 修改 `agent-state/**` 与 `scripts/agent/**`，因此 `agent-state/baseline/perf-baseline.json` 与 `scripts/agent/acceptance.sh` 内的 `<= 10%` 历史基线对比守卫仍待 Coordinator 在 `b0d7db5` 验收后独立落盘（当前 `agent-state/baseline/` 仅含 `commands-baseline-v0.7.0.json`）。
2. **`wasm-opt` 工具链**：本机未安装 `wasm-opt`，`obsidian-mathslot/scripts/build.mjs` 自动跳过可选 `-Oz` 二次优化；在未运行 `wasm-opt` 的情况下产物仍为 `338,391 bytes`（已满足 `≤ 400 KB`）。
3. **宿主防抖参数测试覆盖**：`packages/ui/scripts/bench-budgets.mjs` 读取默认 `renderAdapter.ts` 的 `debounceMs`/`maxWaitMs`（`24`/`56`）；`apps/obsidian/src/hostRenderAdapter.ts` 与 `apps/desktop/src/App.svelte` 的 `24`/`56` 配置分别由各自的 Vitest 集成测试直接验证。

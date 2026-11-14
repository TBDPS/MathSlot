---
id: AUD-30
round: 34
gate: G4
scope:
  - T4.3
  - "§13.5"
  - "§13.4"
  - D-141
verdict: BLOCK
auditor: auditor
date: 2026-11-14
base_commit: fa4bd5d
---

# AUD-30：Gate G4 / T4.3（性能基准与预算 §13.5）只读审计报告

## 1. 判定摘要

- **总体结论**：**`BLOCK`**（`T4.3` / `ADR-0034` 不可直接签收 `§13.5 达标`；发现 **3 项 P1** 与 **1 项 P2** 实质性预算超标、调度链路断裂与基准/门禁缺失）。
- **核心发现**：
  1. **WASM 未压缩体积超标（`D-152`，P1）**：`apps/obsidian/src/wasm-pkg/mathslot_wasm_bg.wasm` 与 `apps/desktop/dist/assets/mathslot_wasm_bg-CbU_aoeN.wasm` 实测为 **`494,010 bytes`（`482.43 KiB` / `494.01 KB`）**（gzip-9 `172,331 bytes`），超出 `§13.5` **`≤ 400 KB`（gzip 前）**目标 **`+84,410 bytes`（+20.6%）**。原因：`Cargo.toml:54-56` 仅配 `lto = "thin"`（未设 `opt-level = "z"`/`"s"`、`codegen-units = 1`、`panic = "abort"`）；`obsidian-mathslot/scripts/build.mjs` 与 `.github/workflows/ci.yml` 未执行 `§13.4` 要求的 `wasm-opt -Oz`（本机亦未安装 `wasm-opt`）；`crates/mathslot-wasm/src/lib.rs:10,91-96` 嵌入未压缩 `catalog/presets.json`（`37,636 bytes`，可缩至 `29,291 bytes`）并用 `serde_json::Value` 二次解析序列化；`crates/mathslot-command/Cargo.toml:11` 无条件拉入 `toml = "0.8"`。**连带缺陷**：`obsidian-mathslot/main.js`（`3,587,017 bytes`）将这 494 KB WASM 以 base64 **重复嵌入了两次**（`658,680` × 2 = `1,317,360` 字符，占 37%）。经评估，在不损失功能前提下把 WASM 降至 `≤ 400 KB` 完全可行。
  2. **连续输入预览延迟调度被绕过且 `maxWaitMs` 超出 `< 100 ms` 预算（`D-153`，P1）**：`packages/ui/src/preview/PreviewPanel.svelte:217-218` 在 `$effect` 中直接调用 `managed.render(req)`，完全绕过了 `managed.schedule(...)`；同时 `packages/ui/src/preview/renderAdapter.ts:349`（`maxWaitMs = 150`）、`apps/obsidian/src/hostRenderAdapter.ts:47-48`（`maxWaitMs = 120`）与 `apps/desktop/src/App.svelte:75-83`（`maxWaitMs = 100`）的 `maxWaitMs` 本身就 ≥ `100 ms`，连续快速输入时叠加渲染耗时（MathJax warm p95 = `12.728 ms`）必然使预览延迟达到 **`104–163+ ms > 100 ms`**。此外 `apps/desktop/src/App.svelte:78-85` 在 `$derived` 内重建 `latexRustManaged` 未释放旧实例。
  3. **缺少基准测试套件、启动/内存基线记录与回归守卫（`D-154`，P1）**：全仓（`Cargo.toml`、`crates/**`、`packages/**`、`apps/**`、`agent-state/baseline/`）**0 个 `criterion` / `[[bench]]` 目标**、**0 份启动/内存基线 JSON**、**0 个可验证 `≤ 10%` 回归的自动化测试**；唯一遗留性能测试是冻结 crate 里的 `crates/mathslot-core/tests/acceptance_tests.rs:265`（`16 ms` 阈值）。
  4. **CI / 门禁脚本未接入性能与体积预算检查，且 1000 次连续编辑存在序列化放大（`D-155`，P2）**：`.github/workflows/ci.yml` 与 `scripts/agent/acceptance.sh` 均无 benchmark 与 WASM/bundle 体积红线校验；`crates/mathslot-app/src/app.rs:85-138` 每次 `KeyInput` 均重算多遍 `to_latex()` 并序列化整份 `EngineSnapshot`，使 1000 次连续按键期间单键 WASM dispatch 均值从 `1.039 ms` 升至 `3.804 ms`、WASM 线性内存从 `2.50 MiB` 增至 `4.75 MiB`。

### `§13.5` 六项性能预算实测对照表

| §13.5 指标 | 规范预算 | 实测数据（Release / 产物） | 自动化基准与门禁 | 当前结论 |
|---|---|---|---|---|
| 典型公式 parse | `< 5 ms` | Native Rust: fraction p95 `0.004 ms`、integral p95 `0.006 ms`、3×3 matrix p95 `0.011 ms`、5000 层嵌套 (`D-141`) p95 `0.871 ms` (max `1.116 ms`)；WASM `Engine.dispatch`: 典型 p95 `0.148–0.433 ms`、88 预置 p95 `0.224 ms`、5000 层 p95 `1.598 ms` | **缺失**（无 `[[bench]]`/criterion） | 运行时达标，缺基准与回归门禁（`D-154`） |
| 预览 p95 | `< 100 ms` | `mathslot-render` (`LatexRustSvgBackend` release): cold `0.685 ms`、warm p50 `0.313 ms`、**p95 `0.558 ms`** (max `0.945 ms`)；`mathjax-full` SVG: cold `33.454 ms`、warm p50 `4.437 ms`、**p95 `12.728 ms`** (max `31.288 ms`) | **缺失** | 运行时达标，缺基准与回归门禁（`D-154`） |
| 连续输入预览延迟 | `< 100 ms` | `PreviewPanel.svelte:218` 绕过 `schedule()` 每次同步直调 `render()`；且 `schedule()` 配置的 `maxWaitMs` 为 `150 ms`（默认）/ `120 ms`（Obsidian）/ `100 ms`（Desktop），叠加渲染耗时后超 `100 ms` | **缺失**（`render_acceptance_tests.rs:316` 反而断言 `max_wait = 150 ms`） | **FAIL / OPEN（`D-153`，P1）** |
| 启动 | 有基准，不回归 > 10% | Native cold (`Catalog::builtin` + `Store::load`): `0.172 ms + 0.015 ms`；WASM cold init (`atob` + `initWasm` + `new Engine` + `catalogJson` + `presetsJson`): `158.881 ms`；Obsidian `main.js` require + `onload`: `277.228 ms` | **缺失**（无基线 JSON，无 >10% 门禁） | **FAIL / OPEN（`D-154`，P1）** |
| 内存 | 有基准，不回归 > 10% | Native RSS: `3,156 KB -> 6,012 KB`（载入 STIX Two Math）`-> 6,332 KB`；Node+WASM: 冷启动 `1.31 MiB` WASM / `74.08 MB` RSS；1000 次编辑压力测试 WASM 线性内存 `2.50 MiB -> 4.75 MiB`（`Undo`×200 后稳定 `4.75 MiB`），Node RSS `92.95 MB`、JS heap `9.24 MB` | **缺失**（无基线 JSON，无 >10% 门禁） | **FAIL / OPEN（`D-154`，P1）** |
| WASM | `≤ 400 KB`（gzip 前） | `mathslot_wasm_bg.wasm`: **`494,010 bytes`（`482.43 KiB` / `494.01 KB`）**（gzip-9 `172,331 bytes`）；raw `mathslot_wasm.wasm`: `536,900 bytes`；`obsidian-mathslot/main.js`: `3,587,017 bytes`（含重复 WASM base64 `1,317,360` chars） | **缺失**（无体积上限检查，无 `wasm-opt -Oz`） | **FAIL / OPEN（`D-152`，P1）** |

---

## 2. 实跑命令与测量证据

| 检查项 | 命令 | Exit Code | 实测输出摘要 |
|---|---|---|---|
| 状态恢复基线 | `scripts/agent/resume.sh` | `0` | `gate=G4 round=34 active=T4.3 next=T4.3 branch=refactor/v1 head=fa4bd5d dirty=0` |
| 门禁快检 | `scripts/agent/acceptance.sh --fast` | `0` | `PASS=4 FAIL=0 WARN=4`（`fmt`/`test`/`palette`/`clean` 过，无任何性能或体积检查） |
| 全量工作区单测 | `cargo test --workspace --offline` | `0` | 全绿通过（`mathslot-syntax`/`latex`/`render`/`store`/`app`/`wasm` 均过） |
| Release 编译与测试 | `cargo test --release -p mathslot-render -p mathslot-store -p mathslot-syntax --offline` | `0` | Release 编译 2m30s 全部通过（`render` 7 passed、`store` 17 passed、`syntax` 28 passed） |
| 工具链可用性检查 | `which wasm-opt wasm-pack twiggy cargo node npm python3 hyperfine \|\| true` | `0` | `no wasm-opt`、`no wasm-pack`、`no twiggy`、`no hyperfine`；仅 `cargo`/`node`/`npm`/`python3` 可用 |
| 基准与配置搜索 | `rg -n -i "criterion\|bench\|wasm-opt\|twiggy\|perf\|budget\|400\|profile\.release" Cargo.toml crates packages apps obsidian-mathslot scripts .github` | `0` | 仅命中 `Cargo.toml:54:[profile.release]`；无 `criterion`/`[[bench]]`/`wasm-opt`/体积守卫 |
| Cargo 清单核对 | `python3 -c 'import tomllib ...'` | `0` | `Cargo.toml benches=None profile={'dev': ..., 'release': {'lto': 'thin', 'strip': 'symbols'}}`；各 crate 无 `[[bench]]` |
| 产物精确字节数 | `python3 -c 'import gzip, os ...'` | `0` | `mathslot_wasm_bg.wasm`: `494010 bytes` (`482.43 KiB`, gzip9 `172331 bytes`)；`main.js`: `3587017 bytes` (gzip9 `1237256 bytes`)；`desktop index.js`: `2260026 bytes` |
| WASM 段分布解析 | `python3 -c 'def parse_leb128... '` | `0` | `mathslot_wasm_bg.wasm` (`494010 bytes`): `Code = 386911 bytes` (78.3%), `Data = 105132 bytes` (21.3%) |
| `main.js` 重复嵌入扫描 | `python3 -c '...re.finditer(r"AGFzbQE[A-Za-z0-9+/=]+", s)...'` | `0` | 命中 2 段各 `658680` 字符的完整 WASM base64，合计 `1317360` 字符（37.0%） |
| `presets.json` 压缩测算 | `python3 -c 'import json ...'` | `0` | `catalog/presets.json`: `raw=37636 bytes`, `minified=29291 bytes`, `saved=8345 bytes` |
| WASM 启动/解析/1000编辑/内存实测 | `node --input-type=module -e '...'`（直接驱动 `apps/obsidian/src/wasm-pkg/mathslot_wasm.js` + `mathslot_wasm_bg.wasm`） | `0` | 冷启动 `158.881 ms`（`b64Decode=27.416`, `wasmCompileInit=126.502`, `engineNew=0.809`, `catalogJson=1.533`, `presetsJson=2.621`）；典型 parse p95 `0.148–0.433 ms`；5000 层嵌套 p95 `1.598 ms`（blocked=true）；1000 次按键 avg `1.256 ms` / p95 `2.428 ms`；WASM 线性内存 `1.31 MiB` (init) / `2.50 MiB -> 4.75 MiB` (1000 edits) |
| 1000 编辑分段缩放实测 | `node --input-type=module -e '...'`（10 桶各 100 次 `KeyInput`） | `0` | 均值随文档增长从 `1.039 ms`（200-300）升至 `3.804 ms`（900-1000）；WASM 线性内存从 `1,310,720` 增至 `4,390,912 bytes` |
| MathJax SVG 与 `main.js` 加载实测 | `node --input-type=module -e '...'`（`mathjax-full` + CJS `require('./obsidian-mathslot/main.js')`） | `0` | MathJax runtime init `43.374 ms`, cold `33.454 ms`, warm300 p50 `4.437 ms` / p95 `12.728 ms` / max `31.288 ms`；`main.js` require `276.794 ms` + `onload` `0.434 ms` = `277.228 ms`（RSS `149.15 MB`, heap `60.64 MB`） |
| Native Rust Release 实测 | `rustc --edition 2024 -O - -o target/tmp/ms_perf_probe ... && ./target/tmp/ms_perf_probe; rm -f target/tmp/ms_perf_probe` | `0` | `Catalog::builtin` `0.172 ms`, `Store::load` `0.015 ms`; parse p95 `0.004–0.011 ms`, 5000 层 p95 `0.871 ms`; `LatexRustSvgBackend` cold `0.685 ms`, warm p50 `0.313 ms`, p95 `0.558 ms`; RSS `3156 KB -> 6012 KB -> 6332 KB` |

---

## 3. 分项审计与根因分析

### 3.1 WASM 体积超标（`D-152`，P1）与 `main.js` 重复打包

1. **实测大小 vs 预算**：
   - `apps/obsidian/src/wasm-pkg/mathslot_wasm_bg.wasm` = **`494,010 bytes`（`482.43 KiB` / `494.01 KB`）**，gzip-9 = `172,331 bytes`。
   - `apps/desktop/dist/assets/mathslot_wasm_bg-CbU_aoeN.wasm` = **`494,010 bytes`**（同份产物）。
   - `target/wasm32-unknown-unknown/release/mathslot_wasm.wasm` = `536,900 bytes`（gzip-9 `177,967 bytes`）。
   - 距离 `§13.5` **`≤ 400 KB`（409,600 bytes）**尚超 **`84,410 bytes`（+20.6%）**。
2. **源码与构建配置根因**：
   - `Cargo.toml:54-56`：`[profile.release]` 仅有 `lto = "thin"` 与 `strip = "symbols"`，默认采用 `opt-level = 3`（偏向速度展开/内联导致 WASM 代码膨胀至 `386,911 bytes`）、`codegen-units = 16`、`panic = "unwind"`。
   - `obsidian-mathslot/scripts/build.mjs:50-75` 与 `.github/workflows/ci.yml:94-97`：执行 `cargo build -p mathslot-wasm --target wasm32-unknown-unknown --release` + `wasm-bindgen` 后，**未执行** `§13.4`（规范 line 927）规定的 `wasm-opt -Oz`，也无体积上限断言；本机 `PATH` 无 `wasm-opt` / `twiggy` / `wasm-pack`。
   - `crates/mathslot-wasm/src/lib.rs:10, 91-96`：`include_str!("../../../catalog/presets.json")` 嵌入 `37,636 bytes` 带缩进换行的 JSON（去空白后仅 `29,291 bytes`，白占 `8,345 bytes` Data 段），且 `presets_json_str()` 在运行时用 `serde_json::from_str::<serde_json::Value>` 反序列化再 `serde_json::to_string` 序列化，引入 `serde_json::Value`（`BTreeMap` / `Number` / `zmij`）代码膨胀。
   - `crates/mathslot-command/Cargo.toml:11`：无条件依赖 `toml = "0.8"`（拉入 `toml_edit`、`winnow`、`indexmap`、`hashbrown`），而 `mathslot-wasm` 仅读取静态代码生成模块 `mathslot_command::generated::GENERATED_COMMANDS`（`crates/mathslot-wasm/src/lib.rs:5`），运行时并不解析 TOML。
   - `crates/mathslot-app/Cargo.toml:13` 已正确设置 `mathslot-render = { default-features = false }`，确认 `latex-rust` / `skrifa` / STIX 字体并未进入 WASM；`mathslot-store` 也仅在 `[dev-dependencies]` 中，未进入 WASM。
3. **`obsidian-mathslot/main.js` 重复嵌入 WASM**：
   - `obsidian-mathslot/main.js` 实测 `3,587,017 bytes`（`3.50 MiB`，gzip-9 `1,237,256 bytes`）。
   - 扫描正则 `AGFzbQE[A-Za-z0-9+/=]+` 命中 **2 处**完全相同的 `658,680` 字符 base64 WASM：
     1. `apps/obsidian/vite.config.ts:18` 定义 `__MATHSLOT_INLINE_WASM_B64__`（经 `apps/obsidian/src/wasmInline.ts:4` 使用）；
     2. `apps/obsidian/src/wasm-pkg/mathslot_wasm.js:398` 的 `new URL('mathslot_wasm_bg.wasm', import.meta.url)` 被 Vite CJS 打包再次内联为死代码分支 `data:application/wasm;base64,AGFzbQE...`（而 `apps/obsidian/src/wasmClient.ts:42` 始终传 `{ module_or_path: wasmBytes }`，该分支永不执行）。仅此一项即白白浪费 `658,680 bytes`。
4. **可达性结论**：**可在不损失任何功能的前提下稳定达标 `≤ 400 KB`**——采用大小优化 release profile（`opt-level = "z"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`）+ `wasm-opt -Oz` + 消除 `serde_json::Value`/压缩内嵌 `presets.json` + feature-gate `mathslot-command` 的 `toml` 依赖，预计可压至 ~260–340 KB（远低于 400 KB）。

### 3.2 连续输入预览延迟与渲染调度（`D-153`，P1）

1. **`PreviewPanel.svelte` 绕过防抖调度**：
   - `packages/ui/src/preview/PreviewPanel.svelte:195-248`（尤其 `L217-218`）在每次 `snapshot` 变更触发 `$effect` 时直接调用 `managed.render(req)`，**从未调用 `managed.schedule(req, ...)`**。
   - 导致 `apps/obsidian/src/hostRenderAdapter.ts:47-48` 与 `apps/desktop/src/App.svelte:75-83` 配置的防抖策略全部失效（每次按键均立即在主线程同步执行 `MathJax` `document.convert` 或向 Tauri 后端发 IPC）。
2. **`maxWaitMs` 配置本身已超出 `< 100 ms` 预算**：
   - `packages/ui/src/preview/renderAdapter.ts:349` 默认 `debounceMs = 45, maxWaitMs = 150`。
   - `apps/obsidian/src/hostRenderAdapter.ts:47-48` 设 `debounceMs = 40, maxWaitMs = 120`。
   - `apps/desktop/src/App.svelte:75-83` 设 `debounceMs = 30, maxWaitMs = 100`。
   - 一旦修复 `PreviewPanel` 改为走 `schedule()`，在连续快速输入场景下（击键间隔 `< debounceMs`），首帧到达 `maxWaitTimer` 触发即已耗时 `100–150 ms`，再加实际渲染耗时（MathJax warm p95 `12.73 ms` / cold `33.45 ms`），端到端延迟将达 `112–183 ms`，**必然违反 `§13.5` 连续输入预览延迟 `< 100 ms`**。而 `crates/mathslot-render/tests/render_acceptance_tests.rs:308,316-328` 仍写死 `150 ms` 作为示例阈值。
3. **资源生命周期泄漏风险**：
   - `apps/desktop/src/App.svelte:78-85` 在 `$derived(...)` 中创建 `latexRustManaged = createManagedRenderer(...)`，但 `L90-92` `onDestroy` 仅释放 `mathjaxManaged`，未清理前序 `latexRustManaged` 定时器与缓存。

### 3.3 基准缺失、内存与 1000 编辑缩放（`D-154`，P1 & `D-155`，P2）

1. **无基准、无基线、无 CI 守卫（`D-154`，P1；`D-155`，P2）**：
   - 工作区无任何 `[[bench]]` / `criterion` / JS `tinybench` 性能基准脚本（`packages/ui/package-lock.json` 中 `tinybench` 仅为 `vitest` 传递依赖，未被项目调用）。
   - `agent-state/baseline/` 仅存 `commands-baseline-v0.7.0.json`，无性能/启动/内存/WASM 体积基线记录。
   - `.github/workflows/ci.yml` 与 `scripts/agent/acceptance.sh` 未运行任何性能测试、未检查 `mathslot_wasm_bg.wasm <= 400 KB`、未检查启动与内存回归 `<= 10%`。
2. **1000 次连续编辑下的延迟放大与重复序列化（`D-155`，P2）**：
   - `crates/mathslot-doc/src/undo.rs:19` 已将 `History::default()` 容量上限设为 `max_capacity = 100`，`crates/mathslot-app/src/app.rs:951-954` 同步裁剪 `source_undo`，内存未无限泄漏。
   - 但 `crates/mathslot-app/src/app.rs:85-138, 276, 833, 856` 每次 `KeyInput` 均多次调用 `self.editor.to_latex()` 并生成完整 `EngineSnapshot`（含所有 `slots`、`diagnostics`、`settings`），在 1000 次连续输入中单键 WASM `dispatch` 均值从 `1.039 ms`（200-300 步）退化为 `3.804 ms`（900-1000 步），WASM 线性内存由 `1.31 MiB` 增至 `4.75 MiB`。

---

## 4. 新登记缺陷明细表

| ID | 严重度 | 位置 | 现象与违反约束 | 最小复现路径 |
|---|---|---|---|---|
| `D-152` | **P1** | `Cargo.toml:54-56`、`crates/mathslot-wasm/src/lib.rs:10,91-96`、`crates/mathslot-command/Cargo.toml:11`、`obsidian-mathslot/scripts/build.mjs:50-75`、`apps/obsidian/vite.config.ts:18`、`apps/obsidian/src/wasm-pkg/mathslot_wasm.js:398` | `mathslot_wasm_bg.wasm` 实测 `494,010 bytes`（`482.43 KiB`），超出 `§13.5` `≤ 400 KB`（gzip 前）目标 `+20.6%`；缺 `opt-level="z"`/`panic="abort"`/`codegen-units=1` 与 `§13.4` `wasm-opt -Oz`；内嵌未压缩 `presets.json` 并用 `serde_json::Value` 重序列化；`mathslot-command` 无条件拉入 `toml`；`obsidian-mathslot/main.js`（`3.59 MB`）重复嵌入两份 base64 WASM（`1.32 MB`） | `wc -c apps/obsidian/src/wasm-pkg/mathslot_wasm_bg.wasm` 输出 `494010`；正则扫 `obsidian-mathslot/main.js` 命中两段 `658680` 字符 `AGFzbQE...` |
| `D-153` | **P1** | `packages/ui/src/preview/PreviewPanel.svelte:217-218`、`packages/ui/src/preview/renderAdapter.ts:349`、`apps/obsidian/src/hostRenderAdapter.ts:47-48`、`apps/desktop/src/App.svelte:75-85` | `PreviewPanel` 直接调 `managed.render(req)` 绕过 `managed.schedule()`；且 `createManagedRenderer` 默认 `maxWaitMs = 150`、Obsidian `120`、Desktop `100`，连续输入下 `maxWaitMs + renderMs` 超出 `§13.5` `< 100 ms` 预算；`App.svelte` `$derived` `latexRustManaged` 未清理旧实例 | 检查 `PreviewPanel.svelte:218` 无 `schedule(` 调用；检查 `renderAdapter.ts:349` 与 `hostRenderAdapter.ts:48` `maxWaitMs >= 120` |
| `D-154` | **P1** | `Cargo.toml`、`crates/**`、`agent-state/baseline/`、`crates/mathslot-core/tests/acceptance_tests.rs:265-311` | 缺少 `criterion` / `[[bench]]` 性能基准、启动与内存基线 JSON 及 `<= 10%` 回归验证机制，无法证明 `§13.5` 启动/内存/p95/parse 持续达标 | `rg -n "criterion\|\[\[bench\]\]" Cargo.toml crates` 零命中；`ls agent-state/baseline/` 无性能基线文件 |
| `D-155` | **P2** | `.github/workflows/ci.yml`、`scripts/agent/acceptance.sh`、`crates/mathslot-app/src/app.rs:85-138` | CI 与 `acceptance.sh` 未接入 benchmark、WASM `≤ 400 KB` 体积门禁及启动/内存门禁；`App::dispatch_snapshot` 每键重复调用 `to_latex()` 并全量序列化，1000 次连续输入单键耗时线性放大（`1.04 ms -> 3.80 ms`） | 查看 `.github/workflows/ci.yml` 无 `wasm-opt` / 体积断言 / bench 步骤；运行 Node 1000 次 `KeyInput` 桶测 `900-1000` 均值为 `3.804 ms` |

---

## 5. 历史结论抽查（对照 `SKILL.md` §3.3）

| 来源 | 声称 | 实测验证 | 结论 |
|---|---|---|---|
| `docs/FINAL_ACCEPTANCE_REPORT.md:47,166-173`（同 `docs/ACCEPTANCE_REPORT_FINAL.md:47,166-173`） | `"响应延迟性能红线 ... 文本插入 3 µs，撤销 3 µs，公式导入 20 µs ... 全部完美达标"` | 所引 `crates/mathslot-core/tests/acceptance_tests.rs:265-311` 仅在冻结 crate `mathslot-core::Session` 上以 `16 ms` 宽松阈值跑均值循环，未测现役 `mathslot-app` / WASM `Engine`（1000 键均值 `1.256 ms`）、未测渲染/启动/内存/WASM 体积 | **历史结论仅覆盖冻结局部，不能代表当前双端性能达标** |
| `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:113` | `"按键延时 < 16ms，普通预览 < 50ms \| 单元与集成测试平均耗时 < 1ms，渲染基准 < 5ms \| 100% 达标 (PASS)"` | 全仓无任何 `< 50 ms` 预览渲染基准测试或连续输入延迟测试；现役 UI `PreviewPanel.svelte:218` 绕过 `schedule()` 且 `maxWaitMs` 设为 `100–150 ms`，与声称的“渲染基准达标”不符 | **历史声称缺少可复现基准证据（当前仍为 OPEN）** |

---

## 6. 下一步建议（针对 `T4.3` / `ADR-0034`）

1. **判定结论**：`T4.3` 当前为 **`BLOCK`**。建议撰写 `ADR-0034` 授权按以下闭环解决 `D-152`..`D-155` 后再交独立 verifier 验收：
   - **先立失败测试 / 预算门禁（Red）**：新增针对 WASM `≤ 400 KB`（`409,600 bytes`）体积断言、连续输入调度（`schedule()` 真实触发且 `maxWaitMs + renderMs < 100 ms`）、以及基准回归阈值测试。
   - **WASM 与 Bundle 瘦身（`D-152`）**：配置专门的 WASM release 优化 profile（`opt-level = "z"`、`lto = true`、`codegen-units = 1`、`panic = "abort"`）、在 `build.mjs` / CI 接入 `§13.4` 要求的 `wasm-opt -Oz`（并加体积硬门禁）、去除 `mathslot-wasm` 中 `serde_json::Value` 对 `presets.json` 的二次编解码并压缩内嵌 JSON、将 `mathslot-command` 的 `toml` 依赖设为可选 feature、消除 `obsidian-mathslot/main.js` 中 `wasm-bindgen` 死代码 URL 导致的 WASM base64 双份内联。
   - **连续输入调度与基准固化（`D-153`、`D-154`、`D-155`）**：让 `PreviewPanel.svelte` 走可配置的 `schedule()`（连续输入 `maxWaitMs` 留足渲染余量确保 `< 100 ms`）并清理 `$derived` `ManagedRenderer`；建立可重复执行的 Rust/Node 性能基准与基线 JSON（覆盖 parse `< 5 ms`、渲染 p95 `< 100 ms`、连续输入 `< 100 ms`、冷启动、1000 次编辑内存与 `≤ 10%` 回归对比）并接入 CI / `acceptance.sh`。

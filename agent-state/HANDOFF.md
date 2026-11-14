# MathSlot 重构交接（HANDOFF）

- 当前分支：`refactor/v1`
- 当前 Gate：`G4`（Round 35，下一任务：`T4.4` 无障碍审计）
- 当前 `last_verdict`：`PASS`（`agent-state/verify/VER-34.md`）

## 已完成里程碑（Round 34：`T4.3` PASS）

- 提交 `b0d7db5` 通过独立验收 [VER-34.md](file:///home/mat/Projects/mathslot-next/agent-state/verify/VER-34.md)，并已记录性能与内存/启动基线 [perf-baseline.json](file:///home/mat/Projects/mathslot-next/agent-state/baseline/perf-baseline.json)：
  - **已关闭缺陷**：`D-152`、`D-153`、`D-154`、`D-155`。
  - **WASM / Bundle 预算**：`mathslot_wasm_bg.wasm` 由 `494,010 bytes` 瘦身至 **`338,391 bytes`（`330.5 KiB` raw / `119.5 KiB` gzip，远低于 `≤ 400 KB` 目标）**；`obsidian-mathslot/main.js` 消除死分支双嵌入，由 `3,587,017 bytes` 降至 **`2,720,521 bytes`**（仅 `1` 份 WASM base64）。
  - **连续输入调度（`< 100 ms`）**：`PreviewPanel.svelte` 接入 `managed.schedule()`；默认、Obsidian 与 Desktop 防抖收敛至 `debounceMs = 24, maxWaitMs = 56`（`maxWait + MathJax p95 = 71.456 ms < 100 ms`）；`App.svelte` 修复 `$derived` `latexRustManaged` 实例泄漏。
  - **离线基准与 CI**：新增零外网 `crates/mathslot-app/benches/app_bench.rs`（`typical_parse p95 = 0.0531 ms`）、`crates/mathslot-render/benches/render_bench.rs`（`p95 = 0.5922 ms`）、`packages/ui/scripts/bench-budgets.mjs`（WASM parse `p95 = 0.431 ms`, MathJax SVG `p95 = 13.455 ms`, 1000 编辑均值 `0.95 ms`）与 `.github/workflows/ci.yml` 门禁。

## 下一轮入口（Round 35 / `T4.4`）

1. 派发 `mathslot-auditor` 对 `T4.4`（无障碍审计 `A-UI-001`：键盘可达、焦点环、ARIA/标签、对比度、减少动态偏好及 Playwright/axe-core 实查；同时核查遗留 `let _ =` / `.unwrap()` / `TABLES` 清零范围）做只读审计，产出 `agent-state/audits/AUD-31.md`。
2. 依据 `AUD-31.md` 撰写 `ADR-0035`，按 `I -> V` 完成 `T4.4` 后推进 `T4.5`（生成文档/README/HELP）与 `T4.6`（发布流水线 + Tauri 原生桌面可执行文件验证）。

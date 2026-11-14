# 交接单（每轮结束必须更新）

## 当前

- 轮次：21
- Gate：PRE-G3-NATIVE → G3（按 `ADR-0022` 完成原生收尾修复与 release 打包后，立刻转向 Tauri 2 `T3.1..T3.7`）
- 当前任务：`PRE-G3-NATIVE-2`（修复 `D-007`、`D-016`、原生 `D-004`，并打包原生可执行文件）
- 下一步：实现 `ADR-0024`（`PRE-G3-NATIVE-2`）→ 独立验收 `VER-21` PASS → 生成 `target/release/mathslot` 与打包归档 → 进入 `G3` `T3.1`

## 本轮（Round 20）做过什么

- `ADR-0022` 正式闭合 `OPEN-0002`（`OPEN-001=Tauri 2`, `OPEN-002=桌面 MathJax 3 SVG 主渲染 + latex_to_svg 兜底 & Obsidian 宿主 renderMath`, `OPEN-003=单文件内联 WASM`），并规定转向 Tauri 2 前先完成原生 bug 修复与可执行文件打包。
- `PRE-G3-NATIVE-1`（commit `010e8d7`，`VER-20.md` **PASS**）：修复 `D-110`（P1 Wayland+fcitx5 无限按键重复 / 每帧 `request_focus`→`interrupt_ime()` 死循环）、`D-015`（移除 `.lock_focus(true)` 与每帧抢焦）、`D-009`（`TextEdit::singleline` 改用横向滚动单行布局）；全测试 `219 passed; 0 failed; 1 ignored`，`clippy`、`fmt`、`acceptance.sh` 全绿，Wayland 截图验证完成。

## 证据在哪

- `agent-state/audits/AUD-20.md`
- `agent-state/decisions/ADR-0022-close-open-0002-and-pre-tauri-roadmap.md`
- `agent-state/decisions/ADR-0023-fix-native-d110-d015-d009-input-focus-repeat.md`
- `agent-state/verify/VER-20.md`（PASS）

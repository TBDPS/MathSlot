# 交接单（每轮结束必须更新）

## 当前

- 轮次：22
- Gate：G3（正式转向 Tauri 2 + Svelte 5 + CodeMirror 6）
- 当前任务：`T3.1`（CodeMirror 6 编辑器 + 命令装饰/槽位 + `packages/ui` 底座）
- 下一步：审计 `AUD-21.md`（确认 `T3.1` 契约、已有 TS generated artifacts 与离线/在线依赖状态）→ `ADR-0025` → `implementer`（TDD 先红后绿搭建 `packages/ui` + CM6 编辑器/装饰/槽位/EngineClient 契约）→ `verifier` (`VER-22.md`)

## 本轮（Round 21）做过什么

- `PRE-G3-NATIVE-2`（commit `3d694d5`，`VER-21.md` **PASS**）：
  - `D-007`（P1）：`src/modals.rs` 接入 `mathslot_latex::convert_latex_with_report` 与 `ImportReport` 展示/Error 阻断；`crates/mathslot-core/src/latex.rs` 修复未知 `\macro{...}` 大括号剥离问题；取消 `test_p1_d007_latex_import_reports_lossy_and_blocks_degradation` 的 `#[ignore]` 并在零断言弱化下通过。
  - `D-016`（P2）：`src/modals.rs` 公式库、自定义格式、片段三类删除接入二次确认与 10 秒可撤销恢复。
  - `D-004`（原生运行态）：`src/app.rs` `copy_latex` 对 `PendingCmd`/`UnknownCmd` 输出诊断阻断而非静默丢失。
  - 全工作区：`223 passed; 0 failed; 0 ignored`（`open_p1` 已清零），`fmt`/`clippy`/`acceptance.sh` 全绿。
- 已产出经 `VER-21` 校验的原生 release 可执行文件与发布包：`target/release/mathslot`（15M）与 `target/release/bundle/mathslot-linux-x86_64.tar.gz`（6.1M）。

## 证据在哪

- `agent-state/verify/VER-21.md`（PASS）
- `agent-state/decisions/ADR-0022-close-open-0002-and-pre-tauri-roadmap.md`
- `agent-state/decisions/ADR-0024-fix-native-d007-d016-d004-and-release-bundle.md`

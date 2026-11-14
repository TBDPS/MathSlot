---
id: AUD-32
round: 36
gate: G4
scope:
  - T4.5
  - INV-001
  - INV-006
  - INV-015
  - D-002
  - D-022
  - "§8.2"
  - "§8.3"
  - "§8.5"
  - "§13.4"
  - "§14"
  - "§16.2"
verdict: BLOCK
auditor: auditor
date: 2026-11-15
base_commit: 9bed978
---

# AUD-32：Gate G4 / Task `T4.5`（生成文档 / README / HELP 与唯一事实源一致性）只读审计报告

## 1. 判定摘要

- **总体结论**：**`BLOCK`**（不可直接签收 `T4.5` 或推进 Gate G4 退出；实查发现 **2 项 P1** 与 **3 项 P2** 缺陷，均属实质性事实源分叉或文档/架构/门禁缺失）。
- **核心判断**：
  1. `xtask` 当前虽已能离线确定性生成 6 份产物（含 `docs/commands.md`、`packages/ui/src/generated/{catalog.ts,presets.ts}`、`crates/mathslot-command/src/generated.rs`、`catalog/catalog.json`、`schemas/commands.schema.json`），但 **`README.md` 与 `HELP.md` 完全未接入生成块**，仍保留手写命令表与手写数据，且存在**错误希腊字母映射**与**幻影指令**（`D-162`，P1）。
  2. `README.md` 与 `HELP.md` 的架构图、UI 形态、触发键、快捷键、预置公式数/分类数、配置 `schema_version` 与跨平台路径仍停留在重写前 `eframe/egui`（v0.6.x）时代，且 `.github/workflows/release.yml` 直接将这两份过期文档打入全部 4 个发布包；同时 `README.md` 存在 `LICENSE` 断链与指向历史 Round 8 决策文档的过期外链（`D-163`，P1）。
  3. 仓库缺失独立的 `obsidian-mathslot/README.md` 与反映当前双端共享架构（`apps/desktop` Tauri 2 + `apps/obsidian` + `packages/ui` CM6 + `crates/mathslot-{app,doc,syntax,store,render,command,wasm}`）的工程架构文档，且多处版本声明未纳入统一生成校验（`D-164`，P2）。
  4. `xtask`、`codegen_tests.rs`、`.github/workflows/ci.yml` 与 `scripts/agent/acceptance.sh` 对活动文档（`README.md`/`HELP.md`）、`presets.ts` 产物及重生成 `git diff --exit-code` 与文档内 `▸xx` 语法可解析性存在校验盲区（`D-165`，P2）。
  5. 双端 UI 内没有任何帮助/命令速查入口（与 `HELP.md` 宣称的 `F1` 帮助面板矛盾），`SHORTCUT_ACTIONS` 未由唯一事实源生成，且 `PalettePanel.svelte` 标签计数为硬编码数字 `(121)` / `(88)`（`D-166`，P2）。
- **既有缺陷复核**：
  - `D-002`（`T1.3` 已登记关闭）：**`OPEN`（在 `T4.5` 范围复现为 `D-162`）**——`ADR-0011` 仅手工修改了 `README.md`/`HELP.md` 中的 5 条命令，未接入 `<!-- BEGIN GENERATED: commands -->` 生成块，未校验全量 121 条命令覆盖与可解析性，且 `HELP.md:176` 至今仍将 `▸gx` 错写为 `\Delta`、`▸gz` 错写为 `\Omega`。
  - `D-022`（`T2.3` 已登记关闭）：**`OPEN`（路径代码已修，但文档声明仍不准确，复现为 `D-163`）**——`crates/mathslot-store/src/paths.rs` 已使用 `dirs` / 三平台测试，但 `README.md` 与 `HELP.md` 仍手写命令表、错误 `schema_version: 1`、错误 `60+` 预置数及过期 `egui` 架构。

---

## 2. 实跑命令与离线核查证据

| # | 检查项 | 命令 | Exit Code | 实测输出尾部摘要 |
|---|---|---|---|---|
| 1 | 工作区与分支基线 | `git rev-parse --short HEAD && git status -s && scripts/agent/resume.sh` | `0` | `9bed978`；`gate=G4 round=36 active=T4.5 next=T4.5 head=9bed978 dirty=0` |
| 2 | `xtask` 一致性检查 | `cargo run -p xtask -- check` | `0` | `[xtask] Check PASSED: All 6 artifacts are up-to-date and clean.` |
| 3 | `mathslot-command` 单测与 codegen 测试 | `cargo test -p mathslot-command --offline` | `0` | `8 passed` (`catalog_tests.rs`) + `8 passed` (`codegen_tests.rs`) |
| 4 | 聚合门禁快速检查 | `scripts/agent/acceptance.sh --fast` | `0` | `PASS=5 FAIL=0 WARN=4`（未包含 `xtask check` 或 `README.md`/`HELP.md` 漂移检查） |
| 5 | 生成块标记检索 | `rg -n "BEGIN GENERATED\|END GENERATED\|@generated" README.md HELP.md docs/ crates/ packages/ apps/ xtask/` | `0` | `README.md` 与 `HELP.md` **0 命中**；仅 `docs/commands.md`、`generated.rs`、`catalog.ts`、`presets.ts` 与 `LLM_IMPLEMENTATION_SPEC.md:638-640` 命中 |
| 6 | 活动文档 `▸` 命令覆盖与有效性脚本核对 | `python3 - <<'PY' ...`（比对 `README.md`/`HELP.md`/`docs/commands.md` 与 `catalog/catalog.json`） | `0` | `README.md`: 29/121（缺 92）；`HELP.md`: 101/121（缺 20 希腊字母，`10` 处未知 `▸` token，`HELP.md:176` `▸gx`/`▸gz` 错配）；`docs/commands.md`: 121/121 |
| 7 | `catalog/presets.json` 真实统计 | `python3 -c 'import json; ...'` | `0` | `presets schema_version: 1 count: 88`，`9` 个分类（含人工智能/量子力学/微分几何）；`commands count: 121` |
| 8 | 断链与缺失文件核查 | `ls -la LICENSE* 2>/dev/null \|\| echo "NO_LICENSE_FILE"` & `ls -la docs/ARCHITECTURE* obsidian-mathslot/README* 2>/dev/null \|\| echo "NO_ARCH_OR_OBS_README"` | `0` | `NO_LICENSE_FILE`；`NO_ARCH_OR_OBS_README` |
| 9 | UI 帮助/快捷键入口检索 | `rg -n "HELP\|help\|F1\|帮助\|使用手册\|快捷键" packages/ui/src apps/desktop/src apps/obsidian/src` | `0` | 仅命中 `PalettePanel.svelte:399`、`SettingsPanel.svelte`（快捷键绑定区）与 `shortcuts.ts`，**0 处帮助弹窗或 `F1` 绑定** |

关键核查原始输出片段：

```text
=== README.md ===
Matched unique commands: 29 / 121
Unknown ▸ tokens: 0
Catalog commands NOT appearing in README.md (92): ['aa', 'ab', ..., 'xm']
=== HELP.md ===
Matched unique commands: 101 / 121
Unknown ▸ tokens: 10
  UNKNOWN: (51, '▸m', ...)
  UNKNOWN: (266, '▸j', ...)
  UNKNOWN: (267, '▸j', ...)
  UNKNOWN: (269, '▸jcb', ...)
  UNKNOWN: (270, '▸j', ...)
  UNKNOWN: (289, '▸ka', ...)
  UNKNOWN: (297, '▸ka', ...)
  UNKNOWN: (297, '▸kz', ...)
  UNKNOWN: (374, '▸td', ...)
Catalog commands NOT appearing in HELP.md (20): ['gC', 'gD', 'gF', 'gL', 'gO', 'gP', 'gS', 'gT', 'gU', 'gX', 'gY', 'gh', 'gi', 'gk', 'gn', 'gq', 'gr', 'gu', 'gv', 'gy']
=== docs/commands.md ===
Matched unique commands: 121 / 121
Unknown ▸ tokens: 0
```

```text
HELP.md:176 MISMATCH ▸gx: catalog latex=\xi glyph=ξ | line=- `▸gf`：$\phi$ · `▸go`：$\omega$ · `▸gx`：$\Delta$ · `▸gz`：$\Omega$
HELP.md:176 MISMATCH ▸gz: catalog latex=\zeta glyph=ζ | line=- `▸gf`：$\phi$ · `▸go`：$\omega$ · `▸gx`：$\Delta$ · `▸gz`：$\Omega$
```

---

## 3. 新发现缺陷逐项证据（`D-162`..`D-166`）

### 3.1 `D-162`（P1 / BLOCK）：`README.md` 与 `HELP.md` 未接入生成块，手写命令表含错误希腊字母映射与幻影指令

- **规范依据**：`docs/LLM_IMPLEMENTATION_SPEC.md` `INV-006`、`INV-015`、`D-002`、§8.5（`<!-- BEGIN GENERATED: commands -->` / `<!-- END GENERATED: commands -->`，禁止在标记块外手写命令清单）、§14 `T4.5`（"生成块无手写"）、§16.2。
- **文件:行号**：
  - `README.md:22-44`
  - `HELP.md:51, 96-201, 266-270, 289, 297, 374`
  - `docs/commands.md:80, 88, 99, 108`
  - `xtask/src/main.rs:21-56`
- **实证事实**：
  1. `README.md` 与 `HELP.md` 中均不存在任何 `<!-- BEGIN GENERATED: ... -->` / `<!-- END GENERATED: ... -->` 标记块；`xtask/src/main.rs:30-55` 的 6 项生成产物不含 `README.md` 或 `HELP.md`。
  2. `README.md:22-44` 仅手写列出 29/121 条命令，缺失 92 条。
  3. **`HELP.md:176` 存在实质性错误**：将 `▸gx` 手写标注为 `$\Delta$`、将 `▸gz` 手写标注为 `$\Omega$`；而在唯一事实源 `catalog/commands.toml` 及其生成物 `docs/commands.md:80,88,99,108` 中，`▸gx` 为 `xi`（`\xi`）、`▸gz` 为 `zeta`（`\zeta`），`\Delta` 为 `▸gD`、`\Omega` 为 `▸gO`。同时 `HELP.md:173-176` 漏列了 20 个希腊字母命令（`gh, gi, gk, gn, gq, gr, gu, gv, gy, gC, gD, gF, gL, gO, gP, gS, gT, gU, gX, gY`）。
  4. `HELP.md:266-270, 289, 297, 374` 仍记载 `▸j`、`▸jcb`、`▸ka..▸kz`、`▸td` 等在 `catalog/commands.toml` 及当前运行时（`crates/mathslot-doc/src/editor.rs:761, 823-866`、`crates/mathslot-app/src/app.rs:1145-1166`）中均不存在的指令。

### 3.2 `D-163`（P1 / BLOCK）：`README.md` 与 `HELP.md` 严重滞后于当前架构、版本、配置 Schema、预置规模与交互，且随 `release.yml` 打入四端发行包

- **规范依据**：`docs/LLM_IMPLEMENTATION_SPEC.md` `INV-006`、`INV-015`、`D-022`、§14 Gate G4 退出条件（"文档/架构一致"）。
- **文件:行号**：
  - `README.md:4, 8-10, 17, 20, 23, 60, 68-81, 84-124, 136-152, 181-186, 202`
  - `HELP.md:34-37, 43-51, 56-75, 85, 243-271, 287-376, 405-433, 439-457, 468, 470-498`
  - `.github/workflows/release.yml:64, 107, 150, 193`
  - 对照真实代码：`Cargo.toml:1-20`、`crates/mathslot-store/src/lib.rs:29-32`、`crates/mathslot-store/src/paths.rs:32-40`、`packages/ui/src/client/engine.ts:80-92`、`packages/ui/src/editor/keymap.ts:127-137`、`packages/ui/src/editor/MathSlotEditor.svelte:53`、`apps/desktop/src/App.svelte:425-782`、`apps/obsidian/src/AppShell.svelte:574-861`。
- **实证事实**：
  1. **架构过时**：`README.md:9, 88-124` 与 `HELP.md:37` 仍声称桌面端仅是 `src/` 下基于 `eframe (egui 0.37)` + `latex-rust 3.0.1`、"零系统 WebKit 依赖"的单体应用、Obsidian 使用手写 C ABI；完全未反映当前真实架构——`apps/desktop/`（Tauri 2 `mathslot-desktop` + WebKit + Svelte 5）、`apps/obsidian/`（`wasm-bindgen` + Svelte 5）、共享 `packages/ui/`（CodeMirror 6 + MathJax 3 SVG）、`crates/mathslot-{app,doc,syntax,latex,store,render,command,wasm}` 与 `xtask/`。
  2. **UI 与交互契约漂移**：`README.md:23, 60, 72-80` 与 `HELP.md:34-36, 43-51, 243-271, 405-433` 仍描述旧 `egui` 布局（48px 顶栏、460px 固定左栏三框、`📖 示例公式库`、`↻ 换一个`）及旧交互（`Tab` 插入 `▸`、`Tab j` / `Alt j` 进导航、`F1` 帮助面板、`[k▸]`/`[t▸]`、ASCII 简写表 `->` / `oo` / `_|_` 自动替换）；而当前 `packages/ui` 实现为 `Tab`/`Shift+Tab` 焦点逃逸（`keymap.ts:127-137`）、`▸` 触发命令（`MathSlotEditor.svelte:53`）、可配置快捷键 `Mod+J` / `Mod+E` / `Mod+,` / `Mod+Shift+C` / `Mod+Shift+S` 与导航 `j/k/h/l`（`engine.ts:80-92`），且 `crates/mathslot-syntax`/`mathslot-doc` 并无 ASCII 简写自动替换、`[k▸]`、`[t▸]` 或 `F1` 帮助面板。
  3. **预置公式数量与分类数过时**：`README.md:17, 20` 与 `HELP.md:439, 441` 仍写 `60+` 公式与 `6 大领域`；实际 `catalog/presets.json` 为 **`88` 条预置、`9` 大分类**（多出 `现代深度学习与人工智能`、`量子力学`、`微分几何与数学物理`）。
  4. **持久化 Schema 与路径说明错误**：`README.md:182` 与 `HELP.md:474, 494` 写 `schema_version: 1` 与旧单代 `.bak`；实际 `crates/mathslot-store/src/lib.rs:29-32` 为 `CURRENT_LIBRARY_SCHEMA_VERSION = 3`（含 3–5 代轮转备份、`library.corrupt-*.json` 隔离、`fd-lock` 文件锁）；`HELP.md:468` 对 macOS 仍写 `或 ~/.config/mathslot/library.json`，与 `crates/mathslot-store/src/paths.rs:32-40` 不符。
  5. **断链与发布包污染**：`README.md:4` 链接 `[License](LICENSE)` 为死链（根目录无 `LICENSE` 文件）；`README.md:202` 指向历史 `docs/DECISION_ROUND_8_FEATURE_AND_RELEASE.md`（v0.6.1）；`.github/workflows/release.yml:64, 107, 150, 193` 将上述过时 `README.md` 与 `HELP.md` 打包至 Linux/Windows/macOS/Obsidian 全平台产物。

### 3.3 `D-164`（P2 / BLOCK）：缺失 `obsidian-mathslot/README.md` 与当前版架构文档 `docs/ARCHITECTURE.md`，版本/配置元数据未统一声明或生成

- **规范依据**：`INV-006`、`INV-015`、§14 Gate G4 退出条件（"文档/架构一致"）。
- **文件:行号**：
  - `obsidian-mathslot/`（目录内仅 `main.js`、`manifest.json`、`package.json`、`styles.css`、`scripts/build.mjs`，无 `README.md`；`.github/workflows/release.yml:193` 被迫把根 `README.md` 复制进插件 zip）
  - `docs/`（有 46 份历史 Round 报告与 `REWRITE_DESIGN.md`，无当前架构文档 `docs/ARCHITECTURE.md`）
  - `scripts/install-desktop.sh:22, 55` 与 `assets/mathslot.desktop:6`（仅指向遗留 `mathslot` 二进制而非 `mathslot-desktop`）
  - 版本号分散：`Cargo.toml:14` (`0.7.0`)、`obsidian-mathslot/manifest.json:4` (`0.7.0`)、`apps/desktop/src-tauri/tauri.conf.json:4` (`0.7.0`)、`apps/desktop/package.json:3` (`0.7.0`)、`apps/obsidian/package.json:3` (`0.7.0`)、`packages/ui/package.json:3` (`0.1.0`)、`apps/desktop/src/App.svelte:47` (fallback `'0.7.0'`)、`apps/obsidian/src/wasmClient.ts:23` (`'0.7.0+schema1'`)——未通过 `xtask` 将权威版本/命令数/预置数/schema 版本注入文档。

### 3.4 `D-165`（P2 / BLOCK）：生成文档零漂移门禁与文档命令可解析性校验存在盲区

- **规范依据**：`docs/LLM_IMPLEMENTATION_SPEC.md` §8.3、§13.4（`git diff --exit-code`；文档中每个 `▸xx` 都能解析且每个命令至少出现一次）。
- **文件:行号**：
  - `xtask/src/main.rs:21-56, 73-105`：未将 `README.md`、`HELP.md`、`obsidian-mathslot/README.md`（及可选架构/元数据生成块）纳入 `generate` / `check`。
  - `crates/mathslot-command/tests/codegen_tests.rs:13-19, 95-119`：`ARTIFACT_PATHS` 仅有 5 项，遗漏 `packages/ui/src/generated/presets.ts`；`test_docs_commands_md_parity` 仅做 `id`/`label` 子串检查，未校验 `README.md`/`HELP.md` 生成块，也未对活动文档中所有 `▸xx` 调用 `mathslot_syntax::parse`（或 `CommandCatalog`）验证可解析性。
  - `.github/workflows/ci.yml:75-76`：仅运行 `cargo run -p xtask -- check`，未执行 `cargo run -p xtask -- generate && git diff --exit-code` 验证幂等重生成零漂移。
  - `scripts/agent/acceptance.sh:48-105`：本地门禁未显式执行 `cargo run -p xtask -- check` 与活动文档命令漂移校验。

### 3.5 `D-166`（P2 / BLOCK）：UI 内缺失帮助/命令速查入口（与 `HELP.md` 矛盾），且 `PalettePanel.svelte` 计数硬编码

- **规范依据**：`INV-006`、`INV-015`、本次审计核查项。
- **文件:行号**：
  - `apps/desktop/src/App.svelte:459-510`、`apps/obsidian/src/AppShell.svelte:580-648`：双端主界面均无“帮助 / 使用指南 / 命令速查”入口，也无 `F1` 快捷键处理（与 `HELP.md:414` 冲突）。
  - `packages/ui/src/settings/shortcuts.ts:17-81` 与 `packages/ui/src/settings/SettingsPanel.svelte:616-717`：设置页仅提供 9 个可配置快捷键绑定，不含基础编辑/命令行说明，且 `SHORTCUT_ACTIONS` 元数据为手写 TS 而非由唯一事实源/schema 导出。
  - `packages/ui/src/palette/PalettePanel.svelte:168, 182`：Tab 标签写死 `命令目录 (121)` 与 `预置公式 (88)`，未绑定 `{COMMANDS.length}` 与 `{PRESETS.length}`。

---

## 4. `docs/` 活动文档与历史归档只读文档界定

| 类别 | 路径 / 范围 | 数量 | 当前状态与处理边界 |
|---|---|---|---|
| **活动产品/工程文档** | `README.md`、`HELP.md`、`docs/commands.md`；待补：`obsidian-mathslot/README.md`、`docs/ARCHITECTURE.md` | 现有 3 份 + 待补 2 份 | 面向用户/开发者的实时权威文档；必须接入 `xtask` 生成块与防漂移门禁，并与当前双端架构对齐 |
| **活动实施规范（只读）** | `docs/LLM_IMPLEMENTATION_SPEC.md` | 1 份 | 权威契约；依据 `AGENTS.md` §1.2 不得擅改（若需修改需先立 `OPEN-*`） |
| **历史归档只读文件** | `docs/AUDIT_*.md` (14)、`docs/ACCEPTANCE_*.md` (5)、`docs/FINAL_*.md` (5)、`docs/DECISION_*.md` (15)、`docs/IMPLEMENTATION_*.md` (7)、`docs/REWRITE_DESIGN.md` (1)、`docs/reports/审查报告与重写方案.md` (1)、`docs/screenshots/*.png` | 48 份 md + 截图 | 仅作历史线索与证据留存，**严禁当作当前产品文档修改或作为实时用户文档引用**（如 `README.md:202` 应移出对 `DECISION_ROUND_8_FEATURE_AND_RELEASE.md` 的依赖） |

---

## 5. 历史结论抽查（按 `independent-audit/SKILL.md` §3）

| 来源 | 历史声称 | 实测命令与代码证据 | 结论 |
|---|---|---|---|
| `docs/ACCEPTANCE_REPORT_ROUND_12_FINAL.md:30, 96` | "`.gitignore` 严格阻断，`git ls-files docs/` 输出 0" | 实跑 `git ls-files docs/ \| wc -l` 返回 **`60`**（exit 0）；`.gitignore:8` 明确注释 `# docs/ 是审计与验收证据，必须进版本库；不要忽略。` | **不实 / 已失效**（原报告声称与仓库现实相反） |
| `agent-state/decisions/ADR-0011-fix-d001-d002-with-catalog-t1.3.md:38` & `docs/ACCEPTANCE_REPORT_FINAL.md:43` | 1) `ADR-0011` 声称 `T1.3` 已"确保文档中列出的所有 `▸xx` 均在 catalog 中合法存在且可被解析器正常解析"；<br>2) `ACCEPTANCE_REPORT_FINAL.md:43` 声称 4 个 crate 根均声明 `#![forbid(unsafe_code)]` | 1) 实跑 Python 核对脚本：`HELP.md:176` 仍错写 `▸gx`=`\Delta`、`▸gz`=`\Omega`，且含 `10` 处未知 `▸` token；<br>2) `head -n 5 src/main.rs crates/mathslot-{syntax,doc,latex,core}/src/lib.rs` 均含 `#![forbid(unsafe_code)]` | 1) **`T1.3` 文档声称不实（`D-002` 未彻底闭环）**；<br>2) **`forbid(unsafe_code)` 声明属实** |

---

## 6. 建议的下一步（不写实现补丁或具体代码）

1. **P1 优先闭环（`D-162`、`D-163`）**：
   - 将 `README.md`、`HELP.md` 的命令目录（及 `presets` 统计、版本、分类摘要）全部改造为 `xtask` 托管的 `<!-- BEGIN GENERATED: ... -->` / `<!-- END GENERATED: ... -->` 注入块，消除手写命令表与 `HELP.md:176` 等错误映射、幻影指令。
   - 重写 `README.md` 与 `HELP.md` 的手写叙述部分，对齐当前 **Tauri 2 (`apps/desktop`) + Obsidian (`apps/obsidian`) + 共享 UI (`packages/ui` CM6/MathJax) + `crates/mathslot-{app,doc,syntax,latex,store,render,command,wasm}`** 真实架构、`schema_version: 3`、88 条预置 / 9 大分类、真实快捷键（`Tab` 焦点逃逸、`▸` 触发、`Mod+J/E/,` 等）与三平台配置路径，同时修复 `LICENSE` 死链（补齐或移除无效链接）及替换过时的 Round 8 外链。
2. **P2 补齐（`D-164`、`D-165`、`D-166`）**：
   - 补齐 `obsidian-mathslot/README.md` 与当前版 `docs/ARCHITECTURE.md`（并同步核对 `scripts/install-desktop.sh` / `assets/mathslot.desktop` / `release.yml` 文档引用）。
   - 在 `xtask`、`codegen_tests.rs`（补齐 `presets.ts` 与文档全 `▸xx` 解析校验）、`.github/workflows/ci.yml`（增加重生成后 `git diff --exit-code` 检查）与 `scripts/agent/acceptance.sh` 中落地全链路零漂移门禁。
   - 在双端 UI 中评估并补齐由 `catalog` / `SHORTCUT_ACTIONS` 唯一事实源驱动的内置帮助/快捷键速查入口（或明确移除文档中对 `F1` 的承诺），并将 `PalettePanel.svelte` 标签计数改为动态读取 `COMMANDS.length` / `PRESETS.length`。

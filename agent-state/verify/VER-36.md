---
id: VER-36
round: 36
task: T4.5
gate: G4
defects: [D-162, D-163, D-164, D-165, D-166, D-002, D-022]
acceptance: ["§8.2", "§8.3", "§8.5", "§13.4", "§14", "§16.2"]
base_commit: 427da52
target_commit: 9fd72fd
verdict: PASS
verifier: verifier
date: 2026-11-15
---

# VER-36：Gate G4 / Task `T4.5`（`D-162`..`D-166`、`D-002`、`D-022`）独立只读验收报告

## 1. 结论

**`PASS`**。提交 `9fd72fd`（基线 `427da52..9fd72fd`）为单原子提交，变更严格限定在 `ADR-0036` §3 允许路径内；无新增 `let _ =`、产品路径 `.unwrap()`、跳过/删减测试或新增外部 Cargo 依赖；全部 `xtask` 校验、幂等重生成 `git diff --exit-code`、Rust 全工作区 fmt/clippy/test、双端及共享 UI 测试/检查/构建、Obsidian 插件内联 WASM 打包冒烟与调色板一致性均实跑通过，逐条闭环 `AUD-32` 登记的 `D-162`..`D-166`、`D-002`、`D-022`。

---

## 2. 作用域、提交规范与代码硬规则核查

### 2.1 提交与路径作用域
- `git log -n 3 --oneline` / `git show --stat 9fd72fd`：确认基线 `427da52` 至 `HEAD`（`9fd72fd5f700159fe34a337032a6323cf5309a98`）仅有 **1 个**任务提交，commit message 为：
  `T4.5: generate active docs from SSOT and fix doc/UI drift (D-162 D-163 D-164 D-165 D-166 D-002 D-022)`
- `git diff 427da52..9fd72fd --name-only` 共 12 个文件，全部位于 `ADR-0036` §3 允许路径内：
  - `.github/workflows/ci.yml`
  - `HELP.md`
  - `README.md`
  - `crates/mathslot-app/tests/docs_ssot_tests.rs`
  - `crates/mathslot-command/tests/codegen_tests.rs`
  - `docs/ARCHITECTURE.md`
  - `obsidian-mathslot/README.md`
  - `obsidian-mathslot/main.js`
  - `packages/ui/src/palette/PalettePanel.svelte`
  - `packages/ui/tests/palette.test.ts`
  - `xtask/src/codegen.rs`
  - `xtask/src/main.rs`
- 核对未触碰禁止路径：`docs/LLM_IMPLEMENTATION_SPEC.md`、48 份历史归档报告、`scripts/agent/**`、`agent-state/**`、`scripts/install-desktop.sh`、`assets/mathslot.desktop`、`.github/workflows/release.yml`、`Cargo.toml`、`Cargo.lock` 均未修改。

### 2.2 代码与测试硬规则核查
| 检查项 | 命令与核对 | 结果 |
|---|---|---|
| 产品代码无新增 `let _ =`、`.unwrap()`、`#[ignore]`、`#[allow]` | `git diff 427da52..9fd72fd -- xtask/ \| rg -n "^\+.*(unwrap\|let _\s*=\|#\[allow\|#\[ignore)"`；`git diff 427da52..9fd72fd -- xtask/ crates/ packages/ .github/ \| rg -n "^\+.*(let _\s*=\|\.unwrap\(\)\|#\[ignore\]\|#\[allow\()"` | exit 0；`xtask/` 仅出现 `unwrap_or("?")`（`xtask/src/codegen.rs:746`），0 处 `.unwrap()` / `let _ =`；仅测试文件 `crates/mathslot-command/tests/codegen_tests.rs` 有 3 处 `.unwrap()`（L268/435/446）；0 处 `#[ignore]` / `#[allow]` |
| 无删除或弱化既有测试 | 核查 `git diff 427da52..9fd72fd -- crates/mathslot-command/tests/codegen_tests.rs packages/ui/tests/palette.test.ts` | exit 0；仅有新增测试与扩充 `ARTIFACT_PATHS`，0 处删除或跳过既有测试 |
| 无新增外部 Cargo 依赖 | `git diff 427da52..9fd72fd -- Cargo.toml Cargo.lock xtask/Cargo.toml` | exit 0；输出为空，严格离线 |
| 无重复命令表/生成逻辑 | 阅读 `xtask/src/codegen.rs:155-205, 674-700` | `generate_markdown`（`docs/commands.md`）、`render_readme_commands_block`、`render_help_commands_block` 均复用同一共享函数 `render_commands_tables` |

---

## 3. 本轮实跑全量门禁与文档防漂移命令输出

| # | 命令 | Exit Code | 实测结果与输出尾部摘要 |
|---|---|---|---|
| 1 | `cargo run -p xtask -- check` | `0` | `[xtask] Check PASSED: All 10 artifacts are up-to-date and clean.`（覆盖 6 份代码/数据产物 + 4 份活动文档注入块） |
| 2 | `cargo run -p xtask -- generate && git diff --exit-code` | `0` | 生成 `generated.rs`、`catalog.json`、`commands.md`、`catalog.ts`、`presets.ts`、`commands.schema.json`、`README.md`、`HELP.md`、`obsidian-mathslot/README.md`、`docs/ARCHITECTURE.md` 共 10 项，`[xtask] All 10 artifacts generated successfully.`；随后 `git diff --exit-code` 返回 `0`（幂等零漂移） |
| 3 | `cargo fmt --check` | `0` | 无格式差异输出，退出码 `0` |
| 4 | `cargo clippy --workspace --all-targets -- -D warnings` | `0` | `Finished 'dev' profile ...`（0 warnings / 0 errors） |
| 5 | `cargo test --workspace --offline` | `0` | 汇总 65 个测试套件：**`273 passed, 0 failed, 0 ignored`** |
| 6 | `cargo test -p mathslot-command --test codegen_tests --offline` | `0` | `test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`（含 `test_active_docs_generated_blocks_and_no_stale_content`） |
| 7 | `cargo test -p mathslot-app --test docs_ssot_tests --offline` | `0` | `test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`（`test_metadata_and_shortcuts_ssot_parity_in_docs`、`test_active_docs_relative_links_exist`、`test_active_docs_all_command_tokens_parse_and_cover_121`） |
| 8 | `npm --prefix packages/ui test && npm --prefix packages/ui run check` | `0` | Vitest：`Test Files 9 passed (9), Tests 54 passed (54)`（含 `palette.test.ts` 新增 `D-166` 用例）；`svelte-check found 0 errors and 0 warnings` |
| 9 | `npm --prefix apps/desktop test && npm --prefix apps/desktop run check && npm --prefix apps/desktop run build` | `0` | 并发重负载下首轮 `D-153` 时序断言 `111.9ms < 100ms` 触发 1 次抖动；单独顺序重跑后：**Vitest `Test Files 1 passed (1), Tests 7 passed (7)`**，`svelte-check found 0 errors and 0 warnings`，Vite 构建 `✓ 441 modules transformed` / `dist/assets/mathslot_wasm_bg-*.wasm 338.39 kB` |
| 10 | `npm --prefix apps/obsidian test && npm --prefix apps/obsidian run check && npm --prefix apps/obsidian run build` | `0` | Vitest：`Test Files 1 passed (1), Tests 19 passed (19)`；`svelte-check found 0 errors and 0 warnings`；Vite 构建 `✓ 440 modules transformed` / `dist/main.js 2,726.89 kB` |
| 11 | `node obsidian-mathslot/scripts/build.mjs && git status --short` | `0` | `wasm-bindgen output size: 330.5 KB (338391 bytes) raw / 119.5 KB gzip`；`✓ Obsidian plugin built and verified successfully: obsidian-mathslot/main.js (3 commands, 121 catalog entries, 88/88 presets)`；`git status --short` 输出为空（零构建漂移/未跟踪残留） |
| 12 | `scripts/agent/audit_palette.py` | `0` | `扫描：12 张卡片，109 条子菜单命令`；`PASS：所有可映射卡片与命令目录一致` |

---

## 4. 逐条对照 `AUD-32`（`D-162`..`D-166`、`D-002`、`D-022`）与 `ADR-0036` 实证

| 缺陷 / 规范项 | 验收要求 | 代码、文档与测试实证 | 判定 |
|---|---|---|---|
| **`D-162` / `D-002`**（P1） | `README.md` 与 `HELP.md` 使用 `<!-- BEGIN GENERATED: commands -->`..`<!-- END GENERATED: commands -->`，块外零手写命令表；`▸gx`/`▸gz` 准确；121/121 全覆盖且无幻影指令 | - `README.md:53-221` 与 `HELP.md:74-237` 均由 `xtask/src/codegen.rs:674-700` 调用共享 `render_commands_tables` 生成全量 **121** 条命令（8 大分类）<br>- 核对 Python 脚本与 `HELP.md:57,150,158`、`README.md:132,140`：`▸gx` = `xi`（`\xi` / `ξ`），`▸gz` = `zeta`（`\zeta` / `ζ`），`\Delta` = `▸gD`，`\Omega` = `▸gO`<br>- 标记块外 `▸` token 经独立脚本检索仅含真实合法命令示例（`README.md:36` 4 处、`HELP.md:56-68` 23 处，`obsidian-mathslot/README.md` 与 `docs/ARCHITECTURE.md` 0 处），无 `▸j`、`▸jcb`、`▸ka`、`▸kz`、`▸td`、`▸m` 等幻影指令<br>- `codegen_tests.rs:350-384` 断言 `commands` 块外禁止存在手写命令表格行 | **PASS** |
| **`D-163` / `D-022`**（P1） | `README.md` 与 `HELP.md` 对齐当前 Tauri 2 + Obsidian + `packages/ui` + `crates/*` 架构、88 预置 / 9 分类、`schema_version = 3`、三平台路径、真实快捷键，移除 `F1` 假声明、`LICENSE` 死链与 Round 8 历史外链 | - `README.md:8-48, 227-285` 与 `HELP.md:3-48, 241-328` 准确反映 `apps/desktop`（Tauri 2）、`apps/obsidian`（`wasm-bindgen` + `renderMath`/MathJax 3 SVG）、`packages/ui`（CM6 + Svelte 5 + MathJax 3 SVG）、`crates/mathslot-*`<br>- `metadata` 与 `presets` 块由 `xtask` 注入 `121` 命令 / `8` 分类、`88` 预置 / `9` 分类、`schema_version = 3`、`MIT OR Apache-2.0`<br>- `HELP.md:317-327` 三平台路径与 `crates/mathslot-store/src/paths.rs:6-46` 完全一致（macOS `$HOME/Library/Application Support/mathslot/library.json`），记录 `fd-lock`、3–5 代备份及 `library.corrupt-*.json`<br>- `shortcuts` 块由 `xtask/src/codegen.rs:563-609, 741-798` 直接解析 `crates/mathslot-store/src/lib.rs` 默认快捷键生成；已清除 `eframe`、`egui 0.37`、`460px`、`F1`、`[k▸]`/`[t▸]`、`(LICENSE)` 与 `DECISION_ROUND_8`；`docs_ssot_tests.rs:234-268` 验证全部活动文档相对链接存在 | **PASS** |
| **`D-164`**（P2） | 补齐 `obsidian-mathslot/README.md` 与 `docs/ARCHITECTURE.md`，元数据/版本由 `xtask` 统一注入 | - 新增 `obsidian-mathslot/README.md`（99 行，含 `metadata` 与 `shortcuts` 注入块、3 条 Obsidian 命令、`renderMath` 优先 + MathJax 3 SVG 回退、构建与安装命令）<br>- 新增 `docs/ARCHITECTURE.md`（131 行，含 `metadata` 注入块——12 个 workspace 成员与 10 项 `xtask` 产物、Mermaid 分层架构图、`crates/*` / `packages/ui` / 双端边界与 SSOT 门禁说明） | **PASS** |
| **`D-165`**（P2） | `codegen_tests.rs` 覆盖 `presets.ts`、`mathslot_syntax::parse` 校验活动文档 `▸xx`、`ci.yml` 含重生成 `git diff --exit-code` | - `crates/mathslot-command/tests/codegen_tests.rs:18` 已将 `packages/ui/src/generated/presets.ts` 加入 `ARTIFACT_PATHS`（共 6 项），`presets.ts:1` 含 `// @generated by xtask. DO NOT EDIT.`<br>- `crates/mathslot-app/tests/docs_ssot_tests.rs:107-231` 扫描 5 份活动文档全部 `▸<ident>` token 验证存在于 `GENERATED_COMMANDS` 且 `README.md`/`HELP.md`/`docs/commands.md` 均 121/121 覆盖，并对全部 121 条命令裸 token 及示例调用 `mathslot_syntax::parse` 与 `App::dispatch_snapshot(LoadStreamSource)` 验证零错误<br>- `.github/workflows/ci.yml:76-79` 已包含 `cargo run -p xtask -- check`、`cargo run -p xtask -- generate` 与 `git diff --exit-code` | **PASS** |
| **`D-166`**（P2） | `PalettePanel.svelte` 消除 `(121)` / `(88)` 硬编码，改用 `{COMMANDS.length}` / `{PRESETS.length}`；消除 UI 与 `HELP.md` 对 `F1` 帮助面板的矛盾 | - `packages/ui/src/palette/PalettePanel.svelte:168, 182` 已改为 `命令目录 ({COMMANDS.length})` 与 `预置公式 ({PRESETS.length})`<br>- `packages/ui/tests/palette.test.ts:296-314` 新增单测验证动态绑定，实跑通过<br>- `HELP.md:48` 明确说明当前通过 `PalettePanel` 查阅命令目录与预置公式，无独立 `F1` 帮助弹窗，与双端 UI 行为一致 | **PASS** |

---

## 5. 未验证 / 非阻塞观察

1. **文档页内锚点小瑕疵（非相对文件死链）**：`README.md:5` 徽章链接指向 `(#跨平台发布包)`，但 `README.md` 正文当前未包含 `## 跨平台发布包` 标题（相对文件链接检查针对文件路径且已全数有效）；待 `T4.6` 发布打包文档补充或后续顺手清理即可，不阻塞 `T4.5`。
2. **本地 `scripts/agent/acceptance.sh` 接入**：按 `ADR-0036` §2.3 第 3 项与 §3 权限边界，`scripts/agent/**` 禁止实现者在 `T4.5` 修改，需由 coordinator 在独立工具链提交中补入 `cargo run -p xtask -- check`。
3. **并发测试资源竞争提示**：`apps/desktop` 的 `D-153` 合并渲染时序断言（`maxWait < 100ms`）在多套 Vitest 与 Cargo 测试并发抢占 CPU 时曾测得 `111.9ms`，单独顺序执行稳定通过（`472ms` 总耗时内满足 `<100ms`）。
4. **Gate G4 终验边界**：本报告仅针对 Task `T4.5` 做出 `PASS` 签收；依据 `independent-verify/SKILL.md` §6，整个 Gate G4 最终退出仍需在 `T4.6` 完成后执行覆盖 `A-DATA-*`、`A-RENDER-*`、`A-UI-*`、`A-OBS-*`、`S-001..007` 及真实二进制/插件走查的完整 G4 终验。

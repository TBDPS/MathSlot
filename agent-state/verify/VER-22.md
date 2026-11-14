---
id: VER-22
round: 22
task: T3.1
defects: [D-009, D-015, D-026]
verdict: PASS
verifier: mathslot-verifier
date: 2026-11-14
---

## 1. 结论
**PASS**。Round 22（`G3 T3.1`，commit `fc17d22e8aa7298d9ed74c30d3cf331b8c1c0eab`）通过独立验收。

- 提交仅改动允许路径（`.gitignore`、`crates/mathslot-app/**`、`packages/ui/**`），未改动 `packages/ui/src/generated/catalog.ts`、`src/**`、`crates/mathslot-core/**`、`crates/mathslot-doc/**`、`scripts/**`、`docs/**`。
- 提交信息包含 `T3.1` 与 `D-009 D-015 D-026`。
- `INV-001` / `INV-006` 满足：`packages/ui/src/**` 无第二套 parser/AST/LaTeX 生成器/命令表，仅依赖 `EngineClient` 抽象与 `generated/catalog.ts`，无 `@tauri-apps/api` 或 `wasm-bindgen` 导入。
- 全部 Rust 与前端门禁命令在当前工作区现场执行并通过（exit 0）。

---

## 2. 提交与代码检查证据

### 2.1 `git log -1 --stat` 与路径白名单核对
```text
commit fc17d22e8aa7298d9ed74c30d3cf331b8c1c0eab (HEAD -> refactor/v1)
Author: TBDPS <94375416+TBDPS@users.noreply.github.com>
Date:   Sat Nov 14 11:39:18 2026 +0800

    feat(ui,app): T3.1 add EngineSnapshot and CodeMirror 6 Svelte 5 editor (D-009 D-015 D-026)

 .gitignore                                   |    5 +
 crates/mathslot-app/src/app.rs               |   45 +
 crates/mathslot-app/src/lib.rs               |    4 +
 crates/mathslot-app/src/snapshot.rs          |  133 ++
 crates/mathslot-app/tests/snapshot_tests.rs  |   67 +
 packages/ui/package-lock.json                | 2010 ++++++++++++++++++++++++++
 packages/ui/package.json                     |   33 +
 packages/ui/src/client/engine.ts             |  143 ++
 packages/ui/src/editor/MathSlotEditor.svelte |  435 ++++++
 packages/ui/src/editor/decorations.ts        |  233 +++
 packages/ui/src/editor/keymap.ts             |  123 ++
 packages/ui/src/index.ts                     |   46 +
 packages/ui/src/theme/tokens.css             |  185 +++
 packages/ui/svelte.config.js                 |    5 +
 packages/ui/tests/editor.test.ts             |  379 +++++
 packages/ui/tsconfig.json                    |   18 +
 packages/ui/vite.config.ts                   |   18 +
 packages/ui/vitest.config.ts                 |   14 +
 18 files changed, 3896 insertions(+)
```
- 禁止修改路径核查：`packages/ui/src/generated/catalog.ts`、`src/**`、`crates/mathslot-core/**`、`crates/mathslot-doc/**`、`scripts/**`、`docs/**` 均未出现在 `git show --name-only fc17d22` 中。

### 2.2 架构不变量与禁用模式检索
- `rg -n "tauri-apps|wasm-bindgen|requestAnimationFrame|\.focus\(" packages/ui/src/` → `NONE_FOUND`
- `rg -n "parse_with_library|to_latex\(|CommandCatalog|commands\.toml" packages/ui/src/` → `NO_DUPLICATE_PARSER_IN_UI`
- `rg -n "let _ =|\.unwrap\(|#\[allow\(|#\[ignore" crates/mathslot-app/src/ crates/mathslot-app/tests/` → `NO_FORBIDDEN_RUST_PATTERNS`
- `packages/ui/src/editor/decorations.ts:10`、`packages/ui/src/index.ts:41-46`、`packages/ui/tests/editor.test.ts:11` 均直接导入 `../generated/catalog`（单一事实源）。
- `packages/ui/src/theme/tokens.css:1-185` 同时定义浅色默认主题（`:root`）与深色主题（`[data-theme='dark']` 及 `@media (prefers-color-scheme: dark)` `:root:not([data-theme='light'])`），无硬编码深色块。
- `packages/ui/src/editor/MathSlotEditor.svelte:144-238` 为编辑区、模式徽章、当前命令、槽位列表（`role="list"` / `role="listitem"` / `aria-current="step"`）和诊断区（`role="status"` / `aria-live="polite"`）提供可读 ARIA 语义；无 `requestAnimationFrame` 或每帧 `focus()` 循环。
- `packages/ui/tests/editor.test.ts:1-379` 使用真实 `svelte` `mount`/`tick`/`unmount` 与 CodeMirror 6 `EditorView` 运行 6 个用例，无 `.skip`/`.only`/弱化断言。

---

## 3. 命令与实际输出

### 3.1 `cargo fmt --check`
- Exit code: `0`
```text
FMT_EXIT=0
```

### 3.2 `cargo clippy --workspace --all-targets -- -D warnings`
- Exit code: `0`
```text
    Finished `dev` profile [optimized + debuginfo] target(s) in 0.19s
CLIPPY_EXIT=0
```

### 3.3 `cargo test --workspace --offline`
- Exit code: `0`（合计 `224 passed; 0 failed; 0 ignored`，其中新增 `crates/mathslot-app/tests/snapshot_tests.rs` 1 passed）
```text
     Running tests/snapshot_tests.rs (target/debug/deps/snapshot_tests-8719d91f5b5ce355)

running 1 test
test app_snapshot_serializes_slots_diagnostics_and_state ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
...
TOTAL_PASSED: 224 TOTAL_FAILED: 0 TOTAL_IGNORED: 0
TEST_EXIT=0
```

### 3.4 `scripts/agent/acceptance.sh`
- Exit code: `0`
```text
== MathSlot 门禁（/home/mat/Projects/mathslot-next）==
时间：2026-11-14T11:41:23+08:00


结果 检查项                    说明
------ ---------------------------- ----
PASS   cargo fmt --check            exit 0
PASS   cargo clippy -D warnings     exit 0
PASS   cargo test --workspace       exit 0
PASS   调色板一致性           exit 0（gate=G3）
WARN   let _ = 计数               15 处（G4 前应清零）
WARN   unwrap() 计数              20 处（用户输入路径应为 0）
WARN   命令表常量              3 处（G1 后应只剩 catalog）
PASS   工作区干净              0 个未提交改动

PASS=5 FAIL=0 WARN=3
结论：PASS
ACCEPTANCE_EXIT=0
```

### 3.5 `cd packages/ui && npm test && npm run check && npm run build`
- Exit code: `0`（`vitest run` exit 0、`svelte-check` exit 0、`vite build` exit 0）
```text
 ✓ tests/editor.test.ts (6 tests) 355ms
   ✓ MathSlotEditor (T3.1) (6)
     ✓ A-EDIT-006: pasting "x+▸f1;2;" dispatches Paste, keeps literal text in CM6, and never fires KeyInput("▸") 133ms
     ✓ A-EDIT-007: IME compositionstart/update/end is never interrupted and emits ImeCompositionCommit 36ms
     ✓ A-EDIT-008: in Nav mode, pressing j/k/h/l dispatches navigation events and leaves CM6 text & line count unchanged 39ms
     ✓ D-009: multiline document "a\nb\nc" preserves 3 true CM6 lines 22ms
     ✓ D-015: Shift+Tab allows escaping focus and subsequent snapshot updates do not steal focus back 86ms
     ✓ renders command, slot, and diagnostic metadata from generated/catalog.ts and EngineSnapshot with ARIA labels 34ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
NPM_TEST_EXIT=0

svelte-check found 0 errors and 0 warnings
NPM_CHECK_EXIT=0

dist/index.css    7.90 kB │ gzip:   1.78 kB
dist/index.js   382.89 kB │ gzip: 107.14 kB

✓ built in 406ms
NPM_BUILD_EXIT=0
```

---

## 4. 逐项验收

| 验收 ID | 期望 | 实测（文件与测试证据） | 判定 |
|---|---|---|---|
| A-EDIT-006 | 粘贴含 `▸` 文本时原样插入，不执行命令 | `packages/ui/src/editor/keymap.ts:53-66` 拦截 `paste`、插入字面文本并派发 `{ Paste: text }`；`packages/ui/tests/editor.test.ts:56-93` 在 CM6 `EditorView` 验证 `x+▸f1;2;` 原样保留且未触发 `KeyInput('▸')`（pass 133ms） | PASS |
| A-EDIT-007 | 中文 IME 组合期间不丢字、不跳光标 | `packages/ui/src/editor/keymap.ts:39-52,68-71` 跟踪 `compositionstart`/`update`/`end` 并在组合期放行 `keydown`；`packages/ui/tests/editor.test.ts:95-157` 验证 `CompositionEvent` 不被 `preventDefault`，发射 `ImeCompositionUpdate`/`ImeCompositionCommit` 且不发射 `KeyInput`（pass 36ms） | PASS |
| A-EDIT-008 | 导航模式按字母时仅跳转光标，文本与 undo 不变 | `packages/ui/src/editor/keymap.ts:85-103` 在 `navModeFacet` 下将 `j/n/k/p/h/l` 映射为 `Navigate` 并阻止其他单字符改动文本；`packages/ui/tests/editor.test.ts:159-210` 验证文档 `'x+y\nz'` 与行数 `2` 保持不变并按序派发导航事件（pass 39ms） | PASS |
| D-009 | 真多行 CodeMirror 6，不出现“视觉多行、语义单行” | `packages/ui/src/editor/MathSlotEditor.svelte:123-155` 与 `keymap.ts:105-108` 允许原生多行；`packages/ui/tests/editor.test.ts:212-240` 验证 `'a\nb\nc'` 保持 `state.doc.lines === 3` 且渲染 3 个 `.cm-line`（pass 22ms） | PASS |
| D-015 | Tab/Shift+Tab 可离开编辑器且无每帧强制 focus | `packages/ui/src/editor/keymap.ts:74-83` 在 `Tab`/`Shift+Tab` 触发 `onFocusEscape` 且不阻止焦点的默认流转；全 `packages/ui/src/**` 无 `requestAnimationFrame`/`.focus(`；`packages/ui/tests/editor.test.ts:242-306` 验证 `Shift+Tab` 焦点击穿到外部按钮且后续 `setSnapshot` 不抢回焦点（pass 86ms） | PASS |
| D-026 | 控件具备可读 ARIA 语义与明暗主题对比度变量 | `packages/ui/src/theme/tokens.css:1-185` 定义亮/暗两套语义 token；`MathSlotEditor.svelte:144-238`、`decorations.ts:77-81,113-195` 提供 `aria-label`、`aria-multiline`、`role="list"/"listitem"`、`aria-current="step"`、`role="status"`；`tests/editor.test.ts:308-378` 与 `crates/mathslot-app/tests/snapshot_tests.rs:5-67` 验证快照与 ARIA 渲染（pass） | PASS |

---

## 5. 未验证/风险

- **Playwright 真实 Chromium 浏览器渲染与真实操作系统/输入法 IME 走查未运行**：当前 `packages/ui/tests/editor.test.ts` 运行在 `vitest` + `jsdom` 环境，真实浏览器排版、CSS 主题计算样式（对比度自动化审计 `A-UI-001`）与真实 Chromium IME/剪贴板事件需在 `T3.5` / `T3.6` / `T4.4` 阶段补齐端到端验证。
- **真实 `wasm-bindgen` / Tauri 后端桥接尚未接入**：当前前端测试使用 mock `EngineClient`；真实 `App::dispatch_snapshot` 与 `EngineClient` 跨边界序列化/交互（调度在 `T3.2`–`T3.6`）尚未在集成壳中端到端联调（Rust 侧已通过 `snapshot_tests.rs` 验证 `EngineSnapshot` 往返序列化）。
- **`agent-state/state.json` 尚未进入下一任务**：当前 `state.json` 仍记录 `round: 22`, `active_task: "T3.1"`（本 verifier 严格遵循只读约束未改动该文件，留待 coordinator 收尾更新）。

---
id: AUD-22
round: 23
gate: G3
scope: [T3.2, D-008, D-015, D-017, D-020, D-026, A-EDIT-004, A-UI-001, A-UI-003]
verdict: BLOCK
auditor: mathslot-auditor
date: 2026-11-14
---

# 独立审计报告 AUD-22：Gate G3 / `T3.2`（调色板 / 命令搜索 / 导航树）前置只读审计

## 1. 判定摘要

- **审计裁定**：**`BLOCK`**（`T3.2` 交付物——`packages/ui` 调色板、命令搜索、分类筛选、预置浏览入口与可滚动 AST/槽位导航树组件——尚未创建；同时 `mathslot-app` 快照与事件契约及 `xtask` 生成产物存在制约 `T3.2` 落地的接口缺口）。
- **逐项结论（仅使用 `OPEN` / `FIXED` / `NOT-REPRODUCIBLE`）**：
  1. **`T3.2`（`packages/ui` 调色板 / 搜索 / 导航树组件）**：**`OPEN`** — `packages/ui/src/` 当前仅有 `T3.1` 的编辑器底座（`client/engine.ts`、`editor/*`、`generated/catalog.ts`、`theme/tokens.css`、`index.ts`），无任何调色板、命令搜索、分类筛选或可滚动 AST/槽位导航树组件（[`packages/ui/src/index.ts:1-46`](file:///home/mat/Projects/mathslot-next/packages/ui/src/index.ts#L1-L46)）。
  2. **`catalog.ts`（121 条命令 / 8 分类）与 `D-001` / `A-EDIT-004`**：
     - 唯一事实源目录（[`packages/ui/src/generated/catalog.ts:3-1529`](file:///home/mat/Projects/mathslot-next/packages/ui/src/generated/catalog.ts#L3-L1529)）与 Rust 后端分发（[`crates/mathslot-app/src/app.rs:150-152, 246-258`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L150-L152)、[`crates/mathslot-doc/src/editor.rs:545-574`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/editor.rs#L545-L574)）：**`FIXED`**（实测 `121` 条唯一命令、8 个分类、字段完整，`D-001` 5 张卡片含 `partial -> oc -> \partial` 全部一致）。
     - `T3.2` UI 调色板交互侧（`A-EDIT-004`）：**`OPEN`**（尚无调色板 UI 组件可点击/键盘触发“偏导”卡片）。
  3. **`catalog/presets.json`（88 条预置）与 `D-017` / `A-OBS-004`**：
     - 静态语料源（[`catalog/presets.json:1-1097`](file:///home/mat/Projects/mathslot-next/catalog/presets.json#L1-L1097)）：**`FIXED`**（实测 `88` 条预置、9 个分类、关键字段无缺失）。
     - 前端消费与加载链路：**`OPEN`** — [`xtask/src/main.rs:21-47`](file:///home/mat/Projects/mathslot-next/xtask/src/main.rs#L21-L47) 未生成 `presets` TS 产物至 `packages/ui/src/generated/`，`crates/mathslot-app` 也无基于简码 `source` 载入预置的 `AppEvent`（详见 §3 `D-112`）。
  4. **`D-008` / `A-RENDER-002` / `A-UI-003` / `S-003` / `S-004`（导航图分区 / 不溢出 / 嵌套高亮）**：
     - 原生 `egui` 端 `fitted_size`（[`src/app.rs:1709, 3274-3298`](file:///home/mat/Projects/mathslot-next/src/app.rs#L3274-L3298)）：**`FIXED`**。
     - `packages/ui` 目标端（`T3.2` 可滚动导航树与 `S-003`/`S-004` 视觉回归）：**`OPEN`**（`MathSlotEditor.svelte:207-225` 仅为扁平 `ms-slot-strip`，尚无独立可滚动层级导航树组件）。
  5. **`D-020`（深度/标签上限静默降级 → 可滚动树 + Diagnostic）**：**`OPEN`** — `crates/mathslot-doc` 已用 `AstPath` 替代 576 标签硬上限，但 `packages/ui` 可滚动树未建立；且 `crates/mathslot-syntax/src/parser.rs` 未见递归深度上限 Diagnostic，冻结区 `crates/mathslot-core` 仍保留历史实现。
  6. **`D-015` / `D-026` / `A-UI-001` / `A-EDIT-008`（键盘可达 / 焦点不死锁 / ARIA 与主题变量）**：
     - `T3.1` 编辑器底座（[`packages/ui/src/editor/keymap.ts`](file:///home/mat/Projects/mathslot-next/packages/ui/src/editor/keymap.ts)、[`tokens.css`](file:///home/mat/Projects/mathslot-next/packages/ui/src/theme/tokens.css)、[`tests/editor.test.ts`](file:///home/mat/Projects/mathslot-next/packages/ui/tests/editor.test.ts)）：**`FIXED`**（`A-EDIT-008` 与 `Shift+Tab` 脱焦已验证）。
     - `T3.2` 调色板/搜索框/导航树侧：**`OPEN`**（需实现组件级的 `Tab` 焦点接力、方向键/Enter/Space 操作、ARIA 属性与明暗 token 复用）。
  7. **新发现接口缺口（§3）**：登记 **`D-111`**（P2，`SlotSnapshot` 缺少 `AstPath`/深度、`EditorState::Nav { path }` 硬编码空向量、`AppEvent` 缺少按 `SlotId` 直跳事件）与 **`D-112`**（P2，`xtask` 未向 `packages/ui/src/generated/` 导出 88 条预置且 `AppEvent` 无简码预置载入事件）。

---

## 2. 逐项证据

### 2.1 `packages/ui/src/` 目录现状（`T3.2`）

- **代码与导出**：[`packages/ui/src/index.ts:1-46`](file:///home/mat/Projects/mathslot-next/packages/ui/src/index.ts#L1-L46) 仅导出 `MathSlotEditor`、`client/engine.ts` 类型、`editor/decorations.ts`、`editor/keymap.ts` 与 `generated/catalog.ts`。[`packages/ui/src/editor/MathSlotEditor.svelte:207-225`](file:///home/mat/Projects/mathslot-next/packages/ui/src/editor/MathSlotEditor.svelte#L207-L225) 仅展示单行扁平 `ms-slot-strip`。
- **命令**：`find packages/ui/src -maxdepth 4 -type f | sort`（exit `0`）
- **输出**：
  ```text
  packages/ui/src/client/engine.ts
  packages/ui/src/editor/decorations.ts
  packages/ui/src/editor/keymap.ts
  packages/ui/src/editor/MathSlotEditor.svelte
  packages/ui/src/generated/catalog.ts
  packages/ui/src/index.ts
  packages/ui/src/theme/tokens.css
  ```
- **判定**：**`OPEN`** — 调色板、命令搜索、分类筛选、预置浏览、可滚动 AST/槽位导航树组件均不存在。

### 2.2 `packages/ui/src/generated/catalog.ts` 与 `catalog/presets.json` 就绪度（`D-001`, `D-017`, `A-EDIT-004`, `A-OBS-004`, `S-001`）

- **代码检查**：
  - [`packages/ui/src/generated/catalog.ts:3-26`](file:///home/mat/Projects/mathslot-next/packages/ui/src/generated/catalog.ts#L3-L26) 定义 8 个分类联合类型 `CommandCategory` 与 `CommandEntry`（含 `id`, `keys`, `label`, `category`, `glyph`, `slots`, `latex`, `doc`, `examples`, 可选 `is_default`, `wrap_body_slot`）。
  - [`packages/ui/src/generated/catalog.ts:953-1128`](file:///home/mat/Projects/mathslot-next/packages/ui/src/generated/catalog.ts#L953-L1128) 验证 `D-001` 5 张卡片：`partial`（`["o","c"]` / `\partial` / `∂`）、`times`（`["o","f"]` / `\times` / `×`）、`cdot`（`["o","g"]` / `\cdot` / `·`）、`equiv`（`["x","a"]` / `\equiv` / `≡`）、`approx`（`["x","b"]` / `\approx` / `≈`）全部匹配。
  - [`catalog/presets.json:1-1097`](file:///home/mat/Projects/mathslot-next/catalog/presets.json#L1-L1097) 为 `schema_version: 1` 的 88 条预置。
  - [`xtask/src/main.rs:25-46`](file:///home/mat/Projects/mathslot-next/xtask/src/main.rs#L25-L46) 只生成 5 份命令表产物，未导出 `presets` 到 `packages/ui/src/generated/`；[`crates/mathslot-store/src/catalog.rs:5`](file:///home/mat/Projects/mathslot-next/crates/mathslot-store/src/catalog.rs#L5) 仅在 Rust `mathslot-store` 内部 `include_str!("../../../catalog/presets.json")`。
- **命令**：
  ```bash
  node -e '
  const fs = require("fs");
  const ts = fs.readFileSync("packages/ui/src/generated/catalog.ts", "utf8");
  const categories = [...ts.matchAll(/category:\s*"([^"]+)"/g)].map(m => m[1]);
  const ids = [...ts.matchAll(/id:\s*"([^"]+)"/g)].map(m => m[1]);
  const catCounts = {};
  for (const c of categories) catCounts[c] = (catCounts[c] || 0) + 1;
  console.log("COMMANDS count (ids):", ids.length, "unique:", new Set(ids).size);
  console.log("Category counts:", catCounts, "num categories:", Object.keys(catCounts).length);
  const presets = JSON.parse(fs.readFileSync("catalog/presets.json", "utf8"));
  const presetCats = {};
  let missingFields = 0;
  for (const p of presets.presets) {
    presetCats[p.category] = (presetCats[p.category] || 0) + 1;
    if (!p.id || !p.name || !p.source || !p.category) missingFields++;
  }
  console.log("Presets count:", presets.presets.length, "missingFields:", missingFields);
  console.log("Preset categories:", presetCats);
  '
  ```
- **退出码**：`0`
- **输出**：
  ```text
  COMMANDS count (ids): 121 unique: 121
  Category counts: {
    structure: 12,
    calculus: 7,
    matrix: 8,
    accent: 17,
    greek: 34,
    symbol: 16,
    relation: 13,
    setlogic: 14
  } num categories: 8
  Presets count: 88 missingFields: 0
  Preset categories: {
    '微积分/高等数学': 15,
    '线性代数': 12,
    '概率统计': 9,
    '大学物理': 12,
    '复变函数': 8,
    '离散数学': 6,
    '现代深度学习与人工智能': 11,
    '量子力学': 8,
    '微分几何与数学物理': 7
  }
  ```
- **调色板一致性脚本**：`scripts/agent/audit_palette.py`（exit `0`）
  ```text
  扫描：12 张卡片，109 条子菜单命令
  ...
  PASS：所有可映射卡片与命令目录一致
  ```
- **判定**：命令静态目录与预置数据源均已就绪（`FIXED`），但 `T3.2` 调色板/搜索 UI 及 `presets.json` 向 `packages/ui` 与 `EngineClient` 的数据通道仍为 **`OPEN`**。

### 2.3 `SlotSnapshot`、`EditorState::Nav` 与 `Slot.path` 树形导航契约（`D-008`, `D-020`, `A-RENDER-002`, `A-UI-003`, `S-003`, `S-004`, `A-EDIT-008`）

- **代码检查**：
  1. **底层 `Slot` 已携带层次路径**：[`crates/mathslot-doc/src/slot.rs:25-32`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/slot.rs#L25-L32) 定义 `Slot { id, role, path: AstPath, span, is_empty, label }`；[`crates/mathslot-doc/src/path.rs:5-43`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/path.rs#L5-L43) 定义 `AstPath(pub Vec<usize>)` 并提供 `depth()` 与 `as_slice()`；[`crates/mathslot-doc/src/document.rs:51-299`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/document.rs#L51-L299) 在 `rebuild_slots()` 中按 AST 层级（含 `Fraction`、`Root`、`Script`、`BigOperator`、`Matrix`、`Delimited`、`Style`、`Group` 及嵌套子槽位）生成递归 `path`。
  2. **`SlotSnapshot` 丢失路径与层级信息**：[`crates/mathslot-app/src/snapshot.rs:14-46`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/snapshot.rs#L14-L46) 与 [`packages/ui/src/client/engine.ts:85-92`](file:///home/mat/Projects/mathslot-next/packages/ui/src/client/engine.ts#L85-L92) 中的 `SlotSnapshot` 仅有 `{ id, role, label, is_empty, is_active, span }`，**未包含 `path: Vec<usize>`（`AstPath`）或 `depth`**，导致前端无法构建真实嵌套结构（如嵌套根号/分数 `S-004`、3×3 矩阵行列分组 `S-003`/`A-UI-003`）。
  3. **`EditorState::Nav { path }` 始终为空**：[`crates/mathslot-app/src/app.rs:429-433`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L429-L433) 的 `sync_state()` 写死 `self.state = EditorState::Nav { path: Vec::new() };`，未填充当前活动槽位/节点的面包屑路径。
  4. **缺少按 `SlotId` 直接跳转的事件**：[`crates/mathslot-doc/src/editor.rs:413-422`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/editor.rs#L413-L422) 已实现 `pub fn nav_to_slot(&mut self, slot_id: SlotId) -> bool`，但 [`crates/mathslot-app/src/event.rs:3-63`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/event.rs#L3-L63) 的 `AppEvent` / `NavAction` 未暴露 `SelectSlot(u32)` / `NavToSlot(u32)`，导致导航树点击或键盘回车选中节点时无法直接将光标跳转到指定槽位。
- **命令**（检查 `SlotSnapshot` / `nav_to_slot` / `depth` 现状）：
  - `rg -n "MAX_DEPTH|depth|limit|256" crates/mathslot-syntax/src/`（exit `0`，无解析深度限制或 `TooDeep` 诊断）；
  - `rg -n "preset|source|load" crates/mathslot-app/src/ crates/mathslot-doc/src/`（exit `1`，0 匹配）。
- **判定**：**`OPEN`**（Rust 底层 `AstPath` 与 `nav_to_slot` 已存在，但 `mathslot-app` 快照/事件桥接与 `packages/ui` 可滚动树组件均待实现）。

### 2.4 门禁、前端测试与静默失败扫描

1. **`packages/ui` Vitest 基线**：
   - 命令：`cd packages/ui && npm test`
   - 退出码：`0`
   - 尾部输出：
     ```text
      ✓ tests/editor.test.ts (6 tests) 365ms
      Test Files  1 passed (1)
           Tests  6 passed (6)
     ```
2. **工作区快速门禁**：
   - 命令：`scripts/agent/acceptance.sh --fast`
   - 退出码：`0`
   - 尾部输出：
     ```text
     PASS   cargo fmt --check            exit 0
     WARN   cargo clippy -D warnings     跳过（--fast）
     PASS   cargo test --workspace       exit 0
     PASS   调色板一致性           exit 0（gate=G3）
     WARN   let _ = 计数               15 处（G4 前应清零）
     WARN   unwrap() 计数              20 处（用户输入路径应为 0）
     WARN   命令表常量              3 处（G1 后应只剩 catalog）
     PASS   工作区干净              0 个未提交改动

     PASS=4 FAIL=0 WARN=4
     结论：PASS
     ```
3. **静默失败与测试弱化检查（`crates/mathslot-app/` 与 `packages/ui/`）**：
   - 命令：`rg -n "let _\s*=|\.unwrap\(|#\[ignore" crates/mathslot-app/src/ crates/mathslot-app/tests/ packages/ui/src/ packages/ui/tests/`（exit `1`，0 匹配）
   - 命令：`rg -n "skip|only|todo" packages/ui/tests/`（exit `1`，0 匹配）

---

## 3. 新发现

| ID | severity | 位置 | 现象 | 复现 / 验证 |
|---|---|---|---|---|
| **D-111** | P2 | [`crates/mathslot-app/src/snapshot.rs:14-46`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/snapshot.rs#L14-L46), [`app.rs:429-433`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/app.rs#L429-L433), [`event.rs:3-63`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/event.rs#L3-L63) | `SlotSnapshot` 丢失 `Slot.path`（`AstPath`）导致无层级/深度信息；`EditorState::Nav { path }` 硬编码空 `Vec::new()`；且尽管 `Editor::nav_to_slot` 已存在（[`editor.rs:413`](file:///home/mat/Projects/mathslot-next/crates/mathslot-doc/src/editor.rs#L413)），`AppEvent`/`NavAction` 缺少按 `SlotId` 直跳的事件 | 阅读 `snapshot.rs:14-46`、`app.rs:429-433`、`event.rs:3-63`；前端无法渲染嵌套树并点击直跳槽位 |
| **D-112** | P2 | [`xtask/src/main.rs:25-46`](file:///home/mat/Projects/mathslot-next/xtask/src/main.rs#L25-L46), [`crates/mathslot-app/src/event.rs:3-32`](file:///home/mat/Projects/mathslot-next/crates/mathslot-app/src/event.rs#L3-L32) | `catalog/presets.json`（88 条预置）仅由 `mathslot-store` 嵌入，`xtask` 未导出至 `packages/ui/src/generated/`，且 `AppEvent` 无简码 `source` 载入接口（`Paste` 按字面保留 `▸`、`ImportLatex` 仅解析 LaTeX） | `rg -n "preset\|source\|load" crates/mathslot-app/src/ crates/mathslot-doc/src/`（exit `1`）；`packages/ui` 无法在不违反 `INV-006` 下搜索并载入 88 条预置 |

---

## 4. 历史结论抽查（按 `independent-audit` §3.3）

| 来源（`file:line`） | 历史声称 | 本轮代码/命令实测 | 结论 |
|---|---|---|---|
| [`docs/ACCEPTANCE_REPORT_ROUND_11_FINAL.md:116`](file:///home/mat/Projects/mathslot-next/docs/ACCEPTANCE_REPORT_ROUND_11_FINAL.md#L116) | 声称“桌面端与 Obsidian 导航行为一致 \| 共享 `mathslot-doc` 槽位表与无前缀 Vimium 标签 \| PASS” | 查看 [`crates/mathslot-wasm/Cargo.toml:12-13`](file:///home/mat/Projects/mathslot-next/crates/mathslot-wasm/Cargo.toml#L12-L13) 仅依赖 `mathslot-core`；实测 `rg -n "mathslot-doc\|mathslot_doc" src/ crates/mathslot-wasm/ obsidian-mathslot/`（exit `1`，0 匹配），桌面旧 UI 与 Obsidian WASM 桥接均未使用 `mathslot-doc` | **历史声称失实（两套旧端从未接入 `mathslot-doc`）** |
| [`docs/ACCEPTANCE_REPORT_ROUND_11_FINAL.md:86`](file:///home/mat/Projects/mathslot-next/docs/ACCEPTANCE_REPORT_ROUND_11_FINAL.md#L86) | 声称“源码全面排查确认：`Grid::new` 在应用层调用归零” | 实测 `rg -n "Grid::new" src/`（exit `1`，0 匹配） | **该局部项属实（`src/` 内确无 `Grid::new` 调用，但同报告多处整体结论仍不成立）** |

---

## 5. 建议的下一步（不写实现方案）

1. **先立 `ADR-0026` 对齐 `T3.2` 数据契约（覆盖 `D-111` 与 `D-112`）**：
   - 在不复制命令表或预置表（`INV-001` / `INV-006`）的前提下，明确 `SlotSnapshot`（透传 `AstPath`/深度）、`EditorState::Nav { path }` 面包屑、`AppEvent` 直跳槽位事件、`xtask` 预置生成或 `EngineClient` 预置查询/载入契约，以及 `D-020` 深层输入诊断边界。
2. **严格按 TDD 先红后绿实现 `T3.2`**：
   - 先在 Rust（`crates/mathslot-app`）与 `packages/ui/tests/` 编写覆盖调色板点击（`A-EDIT-004` 偏导→`\partial`）、命令搜索/分类筛选、88 条预置搜索、可滚动嵌套槽位/矩阵导航树（`D-008`/`D-020`/`A-UI-003`）及 `Tab`/方向键/Enter/ARIA 可访问性（`D-015`/`D-026`/`A-UI-001`）的失败测试，再补全组件实现并提交独立 `verifier` 验收。

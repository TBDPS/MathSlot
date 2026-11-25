# MathSlot 项目审计与架构评估

> **审计对象**：当前代码（v2.3.0，main 分支）。  
> **审计日期**：2026-11-25。  
> **审计方式**：源码审读 + KaTeX/内核探针 + 自动化测试 + `svelte-check`/`tsc`。  
> **范围**：只覆盖当前实现与后续演进建议。

---

## 0. 结论摘要

### 0.1 当前质量判断

MathSlot 的核心竞争力仍然是 **槽位 AST + 键盘流 + Obsidian 原位编辑**。当前架构具备：

- 单源命令能力注册表 `commandSpecs.ts`、`visitNode/forEachSlot`；
- `InputContext` 与 `\text{... $...$ ...}` 内嵌数学；
- `normalizeSettings`、`sanitizeLatexTemplate`、`hasRawNodes` UI；
- 增广矩阵 / `array {cc|c}` / `smallmatrix` / `dcases` / `rcases`；
- 引擎订阅、连续输入合并、草稿恢复；
- `svelte-check` 0 errors / 0 warnings。

当前验证基线：

| 项目 | 结果 |
| --- | --- |
| 命令数 | **165** |
| 预置公式 | **89** |
| 核心测试 | **86 passed / 7 files** |
| `svelte-check` | **0 errors / 0 warnings** |
| Obsidian `tsc --noEmit` | 通过 |
| KaTeX 全量渲染 | 165 命令 + 89 预置零错误 |

### 0.2 仍需优先关注的问题

| 优先级 | 问题 | 影响 |
| --- | --- | --- |
| P1 | 没有 `DifferentialNode`，微分仍依赖单字母简写 | `d\theta`、`d\vec{r}`、`d^2x`、多字母变量在积分体外无法可靠表达；`dx` 与 `d x` 的语义只能靠空格约定 |
| P1 | 简写仍是两套管线 | 标点简写在输入时改 AST，单词简写在渲染时识别；`AUTO_SHORTHANDS` 的 word 规则不参与实际匹配，提示/文档/行为可能漂移 |
| P1 | 多行对齐没有一等节点 | 画布用 `gathered`、导出用 `aligned`；多列对齐、`\tag` 只能 Raw 保留，无法结构化编辑 |
| P1 | 选区仍是单槽 | 无法跨槽复制/剪切/包裹；长公式局部结构操作受限 |
| P1 | 持久化仍以 LaTeX/整包快照为主 | 草稿是 `lastDraftLatex` 字符串而非 Document JSON；Obsidian 两个模态的数组快照仍可能被整包覆盖；双轨库删除语义未定义 |
| P2 | Grid/Text/LineBreak 没有一等节点 | `array`/增广矩阵依赖 `StructNode.grid`；文本框/内嵌数学仍复用结构槽；换行仍是 RawNode |
| P2 | 桌面/Obsidian 一些体验仍未闭环 | 弹窗焦点陷阱、移动端 `isDesktopOnly:false` 的验证、屏幕阅读器仍读原始 LaTeX |
| P3 | 发布与平台工程 | macOS/Windows 签名、公证、自动更新、ARM/Intel 覆盖仍待完善 |

> 已于本轮补齐：原生 LaTeX 实时键入兼容（`\alpha` 草稿不再误输出 `\backslash`、运算符/数字/连续 `\` 自动展开、`\frac{1}{2}`/`\sqrt[3]{8}`/`\mathbb{R}`/`\mathrm{d}x`/`e^{-x^2}`/`\int_{0}^{\infty}` 原生 `{}`/`[]` 闭合推进、`\left(...\right)` 与 `\{`/`\}`/`\|`/`\%`/`\\` 转义）、`\int f(x) d x` 预览/导出一致性、空槽首空格拦截、多公式导入 warning 提示、以及 Obsidian 光标处 `\(...\)` / `\[...\]`（含多行与引用块）原位识别。

### 0.3 建议的总体方向

**不要推倒槽位模型**。下一阶段应围绕「结构节点 + 单一简写注册表 + 文档模型」演进：

1. `DifferentialNode`：任意变量、希腊、向量、阶数微分；
2. `ShorthandSpec`：把标点/单词/微分/用户简写收敛到一份规则源；
3. `AlignNode` / `GridNode` / `TextNode` / `LineBreakNode`：替代 `StructNode.grid`、Raw `align`、`text_box` 数学槽位、Raw `\\`；
4. `DocumentV1` + Repository：草稿/文档结构化保存，写队列、revision、字段合并；
5. `{anchor, focus}` 文档级选区 + 事务化撤销；
6. render projector / caret overlay：canonical、interactive、layout 分层；KaTeX 只做排版叶子。

---

## 1. 当前关键行为说明

### 1.1 普通空格是分隔符，不是排版宽度

- 数学上下文中的普通空格：零宽，仅终止单词/简写 token；画布与 TeX 数学模式一致。
- `\,`、`\:`、`\;`、`\!`、`\ `、`\quad`、`\qquad`：真实间距，仍可见。
- `\text{...}` 内空格：文本空格，保留。
- 导出 LaTeX 仍可能包含普通空格（用于宏名终止/可读性），但 TeX 数学模式忽略它们，渲染与预览一致。

### 1.2 `dx` / 微分简写

| 输入 | 当前输出/含义 |
| --- | --- |
| `dx`、`dy`、`da`、`dA`、`dZ` | `\mathrm{d}x` 等直立微分（`d` + 任意单个 ASCII 字母） |
| `dtheta`、`dphi`、`domega` | `\mathrm{d}\theta` 等（多字母表） |
| `d x` | 字面量 d 与 x / d 乘 x；空格分隔，不产生可见间距 |
| `d*x` / `d\cdot x` | 显式乘法 |
| `\int f(x) dx` | `\int f(x)\,\mathrm{d}x` |
| `\int f(x) da` | `\int f(x)\,\mathrm{d}a` |
| `y=dx` 正式导入 | 保持字面量 `dx`（导入字母带 `verbatim`） |

仍缺少：

- `d\theta`、`d\vec{r}` 在积分体外的统一表达；
- `d^2x` / `d^3x` 微分阶数；
- 多字母变量/复杂原子的显式微分；
- 字面变量 `dx` 的“无空格源码”写法（目前用 `d x` 表示，渲染相同）。

推荐新增 `DifferentialNode`：

```text
DifferentialNode {
  order?: SlotNode;     // \mathrm{d}^{n}
  variable: SlotNode;   // x, \theta, \vec{r}, ...
  style?: 'upright' | 'italic';
}
```

`dx` 保留为自然简写；`d x` 永远是字面量/乘法；命令面板或 `Tab c f` 可插入显式微分。

### 1.3 简写实现现状

| 类型 | 匹配位置 | 是否改 AST |
| --- | --- | --- |
| 标点简写 `->`/`<=`/`...`/`:::` | `matchTrailingShorthand` / `matchShorthandUpgrade` | 是（`SymbolNode`） |
| 单词简写 `pi`/`oo`/`alpha`/`in`/`dx` | `latex.ts` tokenizer + interactive hints | 否，渲染时识别 |
| 用户标点简写 | `editor.ts matchCustomShorthand` | 是 |
| 用户单词简写 | `editor.ts matchCustomShorthand` | 是 |
| 微分简写 | `DIFFERENTIAL_WORDS` + generic single-letter + 积分体 fallback | 否 |

关键问题：

- `AUTO_SHORTHANDS` 的 `kind:'word'` 规则**不是实际匹配器**；真实单词展开来自 `BARE_WORD_ATOMS/BINOPS`、`MATH_FUNCTIONS`、`DIFFERENTIAL_WORDS` 与 `isGenericDiffWord`。
- `SHORTHAND_BY_COMMAND_ID` 只用于提示；它与实际匹配规则是两套数据。
- 标点前缀升级只有硬编码 `leq:>`、`leftarrow:>`；新前缀重叠需手改。
- 自定义简写没有贡献到内置命令提示/文档，冲突检测不统一。
- 单词简写是渲染时识别，标点是输入时改 AST，撤销体验不同。
- 空格既是词边界又是 AST 字符，仍可进一步模型化。

建议统一 `ShorthandSpec`：

```ts
interface ShorthandSpec {
  id: string;
  trigger: string;
  kind: 'punct' | 'word' | 'differential' | 'unicode';
  commandId?: string;
  replacement?: string;
  leftBoundary?: 'none' | 'non-letter' | 'start';
  rightBoundary?: 'none' | 'non-letter' | 'end';
  context?: 'math' | 'integral-body' | 'text' | 'operatorname' | 'any';
  priority?: number;
  mode?: 'natural' | 'formal';
  label?: string;
  doc?: string;
}
```

由单一 registry 生成 `AUTO_SHORTHANDS`、bare-word 表、`SHORTHAND_BY_COMMAND_ID`、命令面板 badge、帮助文档与测试；长期支持 Unicode 简写、用户简写冲突检测。

### 1.4 命令面板

当前：`CommandDrawer` 的内置命令卡片（收藏、最近使用、全部、命令 Tab）显示 `SHORTHAND_BY_COMMAND_ID` 简写 badge；搜索 `pi`/`->` 等也可命中。`MathRibbon` 原本已有简写提示，现在两处数据结构一致。

### 1.5 外部 LaTeX 包装

支持自动剥离：

- `$...$`、`$$...$$`、`\(...\)`、`\[...\]`、` ```latex ``` ` 围栏；
- `$a + \$5$` 内转义 `$` 保留；
- 多个独立公式（`\(x^2\) + \(y^2\)`、`$x$ + $y$`、`$$x$$ + $$y$$`）不再被错误裁剪，而是保留原文；
- 未闭合定界符保留原文。

限制：

- 多公式不会自动拆分，也没有显式 warning；建议导入预览提示「请逐个导入」；
- Obsidian 光标处自动识别只处理 `$...$` / `$$...$$`；`\(...\)` / `\[...\]` 可通过导入/粘贴使用。

---

## 2. 仍存在的功能与设计缺陷

### P1

1. **缺少 `DifferentialNode`**：见 §1.2。当前 generic 规则只覆盖单字母；希腊/结构/阶数/多字母仍不灵活。
2. **简写缺少单一注册表**：见 §1.3。这会持续制造“提示与实际行为不一致”“新增简写改多处”的 bug。
3. **多行对齐无结构节点**：
   - 画布多行仍用 `\begin{gathered}`，导出用 `aligned`；
   - 多列 `align`、非关系 `&`、`\tag` 只能 Raw 保留；
   - 单行关系对齐仍会被规范化；
   - 建议 `AlignNode`（行/列/对齐点/tag/rowGaps）。
4. **选区仍为单槽**：`Selection={slotId,start,end}`，不能跨槽/跨单元格复制、剪切、包裹；建议 `{anchor, focus}` 文档级选择。
5. **持久化与多模态**：
   - 草稿是 `lastDraftLatex` 字符串，不是结构化 `DocumentV1`；
   - Obsidian `saveStore` 只合并 `settings`，数组字段仍整包覆盖；
   - 启动静默加载与手动「重载」对外部库删除/空库语义不一致；
   - 没有 schema 版本/迁移/备份（settings 归一化除外）。
6. **多公式导入与 Obsidian 定界符**：多公式不拆分、无 warning；Obsidian 只识别 `$`/`$$`。

### P2

1. **Grid/Text/LineBreak 无独立节点**：
   - 增广矩阵/array 依赖 `StructNode.grid + colSpec`；
   - `text_box` 仍是结构槽 + `inline_math` 子槽；
   - 换行仍是 `RawNode('\\\\')`，没有 block 上下文约束。
2. **UI 仍有 61 处手动 `sync()`**：虽然 `engine.subscribe` 已存在，`MathSlotStudio` 仍手工采样；`MathSlotStudio` 约 2053 行，`MathSlotEngine` 约 2802 行，`latex.ts` 约 1720 行，`parser.ts` 约 1759 行。建议逐步改成 store/selectors。
3. **性能结构成本**：每键仍可能触发 `getSnapshot()`（canonical + interactive）、KaTeX 全树重渲染与 overlay 测量；当前输入合并缓解撤销/内存，但纯光标移动仍可重渲染。建议 caret/selection 独立层 + layout cache。
4. **可访问性**：画布读屏仍主要读原始 LaTeX；没有语义 MathML；`Tab` 被 leader 占用，键盘离开画布路径不完整。
5. **移动端**：Obsidian `isDesktopOnly: false`，但仓库没有移动端真机验证；键盘优先交互与触屏不一致。
6. **弹窗焦点**：全局 Escape 已补，但 Export/Settings/Help 仍缺少初始焦点与焦点陷阱。
7. **外部命令库**：`commands.json` 仍不支持 `shorthand`/`immediateShorthand`；自定义模板已 sanitize，但用户简写冲突检测仍不统一。

### P3

1. macOS/Windows 未签名/未公证；无自动更新；无 Linux ARM / Windows ARM / macOS Intel 产物。
2. 本地 `tauri build` 默认只出 rpm（CI 才出 deb/AppImage）；README 已说明版本，但本地构建说明可更明确。
3. Tauri 大图/字节数组走 JSON IPC（`Array.from`），大图导出有膨胀；建议二进制 IPC/临时文件。
4. 无全局热键/托盘/「粘贴到上一个应用」；桌面端仍是独立编辑器。
5. 当前命令/键位表仍为手工维护，缺少 CI 生成校验。

---

## 3. 架构评估与目标方案

### 3.1 当前保留项与已具备能力

- 槽位 AST 与 `SlotNode`；
- 键盘流、leader/jump、矩阵网格操作；
- KaTeX 作为排版叶子；
- HostAdapter 双端抽象；
- `commandSpecs` 的 `CommandCapabilities` 与 `INLINE_STRUCT_MAP`/`ACCENT_MACRO_MAP` 等生成表；
- `visitNode` / `forEachSlot` / `slotHasRawNodes` 与测试护栏；
- `InputContextKind` 与 `\text{... $...$ ...}` 内嵌数学；
- `normalizeSettings`、`sanitizeLatexTemplate`、`hasRawNodes` 提示；
- 引擎订阅、连续输入合并、选区随历史保存、桌面草稿恢复；
- 增广矩阵 `array {cc|c}`、`smallmatrix`、`dcases`、`rcases`；
- `svelte-check` 0 errors / 0 warnings。

### 3.2 仍需收敛的结构问题

| 问题 | 现状 | 建议 |
| --- | --- | --- |
| 命令行为分散 | 仍有 41 处 `commandId === '...'`、5 个 `switch(node.type)`、11 处 `node.type === ...` | `CommandSpec` + `BehaviorRegistry`（capabilities 已先行） |
| 两套发射器 | canonical 与 interactive 各自 token/spacing | 共享 `EmitIR`/token 模型，canonical 与 interactive 从同一 IR 派生 |
| 交互标记耦合 | `\htmlData` 直接注入 LaTeX | 集中到 interactive projector；canonical 不含标记 |
| 节点表示不足 | 只有 Char/Symbol/Struct/Raw | 增加 Grid/Align/Text/LineBreak/Opaque |
| 选区单槽 | `Selection={slotId,start,end}` | `{anchor,focus}` + NodePath |
| 持久化投影 | 设置/片段/历史/草稿 LaTeX | `DocumentV1` + `StoreV3` + Repository + revision/merge |
| 渲染/光标耦合 | 光标移动改变 interactiveLatex | caret/selection overlay + layout cache |

### 3.3 建议的演进阶段

1. `DifferentialNode`；`ShorthandSpec` registry；多公式导入提示；Obsidian `\(...\)` 检测；清掉剩余小问题。
2. `AlignNode`、`GridNode`、`TextNode`、`LineBreakNode`；`anchor/focus` 选区；Document JSON + Repository；Obsidian 数组级合并。
3. render projector/caret 层、MathML 可访问性、i18n、Web/PWA、移动端/触屏、签名/更新/ARM/Intel。
4. 交换图、化学 `mhchem`、OCR/手写、语义导出（MathJSON/自定义 JSON）、协作/CRDT。

---

## 4. 功能与结构建议

| 优先级 | 建议 | 说明 |
| --- | --- | --- |
| ★★★ | `DifferentialNode` | 任意变量/希腊/向量/阶数；`dx` 简写、`d x` 字面量 |
| ★★★ | `AlignNode` | 多对齐点、`\tag`、画布/导出一致 |
| ★★★ | `GridNode` | array/列格式/增广矩阵/rowGaps/colSpec 一等化 |
| ★★★ | `TextNode` | 文本段 + 显式内联数学；彻底隔离数学触发器 |
| ★★★ | `LineBreakNode` | 只允许 block 上下文；解决嵌套换行 |
| ★★ | `{anchor,focus}` 选区 | 跨槽复制/剪切/包裹 |
| ★★ | Document JSON + Repository | 自动保存/恢复、迁移、备份、Obsidian 合并 |
| ★★ | `ShorthandSpec` registry | 统一 punct/word/differential/unicode/用户简写 |
| ★★ | 数学结构补齐 | `\not`、`\mid`、`\bmod`、大算子、字体/算子、宽装饰、`\braket`、`\substack` N 行 |
| ★ | 搜索/键位管理 | MRU/收藏已有；补别名/拼音、自定义键位冲突检测 |
| ★ | 无阅读障碍/无障碍 | 语义 MathML、焦点陷阱、Tab 离开画布 |
| ★ | 导出体验 | 实际倍率、白底默认、保存对话框、失败提示 |
| ★ | 跨平台 | 签名/公证/updater/ARM/Intel/Web |

---

## 5. 测试与文档

### 5.1 当前测试护栏

- 78 tests / 7 files；
- 165 命令 + 89 预置的 KaTeX 渲染契约；
- `import-and-space.test.ts`：外部包装、空格、微分简写；
- `architecture-v2.3.test.ts`：CommandCapabilities、增广矩阵、inline math、sanitize、settings migration；
- `svelte-check` 0/0；Obsidian tsc 通过。

### 5.2 建议补充

1. `DifferentialNode`：单字母/希腊/向量/阶数/积分体/字面量；
2. `ShorthandSpec`：冲突、最长匹配、边界、上下文、用户简写；
3. `AlignNode`/`GridNode`/`TextNode`/`LineBreakNode` 的 import→edit→export→re-import；
4. 持久化混沌：两个 Obsidian 模态、快速写入、外部空库/删除、schema 迁移；
5. UI：空格选择、模态焦点、剪贴板、导出失败、简写 badge；
6. E2E：Playwright/Web、Tauri、Obsidian 桌面/移动、Word/LibreOffice。

### 5.3 文档

- 当前 README/GUIDE/Help 已同步 165 条命令；
- 后续建议由 `COMMANDS`/`SHORTHAND_SPECS` 生成键位表、命令数与帮助内容，避免再次漂移。

---

## 6. 验证范围与限制

- 已执行：`npm test`（78 passed）、`svelte-check`（0/0）、Obsidian `tsc`、KaTeX 探针、临时输入/解析测试。
- 未执行：真实 Tauri 安装包、真实 Obsidian 桌面/移动端、Word MathML 粘贴、macOS/Windows 签名/公证、Wayland/XWayland、真实中文输入法长文本。
- 因此平台相关结论按「代码确认/需实机」处理；发布前应补真机矩阵。

---

## 7. 结论

MathSlot 已经越过“能不能用”的阶段：165 条命令、89 条预置、增广矩阵、内嵌文本数学、CommandCapabilities、InputContext、安全消毒和 0 warning，说明工程底座在变好。

当前的核心问题不再是单个 bug，而是**简写/微分/空格/多行/选区/持久化这些横切能力还没有统一模型**：

- `dx` 有单字母快捷，但没有 `DifferentialNode`；
- 空格已语义化，但简写仍是两套规则；
- 多行对齐、网格、文本、换行仍借用 `StructNode`/Raw；
- 选区仍单槽，文档仍是 LaTeX 快照。

下一阶段建议以 **DifferentialNode + ShorthandSpec + AlignNode/GridNode/TextNode/LineBreakNode + Document JSON/Repository + anchor/focus 选区** 为主线，继续保持槽位键盘流与 KaTeX 双端同源，不要重写已经验证的核心。

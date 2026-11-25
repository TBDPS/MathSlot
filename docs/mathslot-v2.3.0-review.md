# MathSlot v2.3.0 复审：空格、微分简写、命令面板与外部定界符

> **审查对象**：`mathslot-next` v2.3.0，提交 `9d1e270`。  
> **审查重点**：本轮用户提出的五组问题——`dx` 的灵活性、预览空格与导出空格不一致、简写实现的可扩展性、命令面板缺少简写标注、`\(...\)` / `$...$` 外部包装的解析。  
> **结论**：v2.3.0 的架构进展明显（CommandCapabilities、InputContext、inline math、settings 归一化、模板 sanitize、增广矩阵、0 warning）；但简写/微分/空格仍处于「两套规则、一个隐式管线」的状态，本轮已修复三个可直接落地的缺陷，并给出微分与简写注册表的后续方案。

---

## 0. 复审基线

| 项目 | 结果 |
| --- | --- |
| 提交 | `9d1e270 feat: release MathSlot v2.3.0 ...` |
| 命令数 | **165** |
| 预置公式 | **89** |
| 核心测试（本轮修复前） | **68 passed / 6 files** |
| 核心测试（本轮新增回归后） | **78 passed / 7 files** |
| `svelte-check` | **0 errors / 0 warnings** |
| Obsidian `tsc --noEmit` | 通过 |
| 版本一致性 | root / desktop / core / obsidian manifest 均为 `2.3.0` |

v2.3.0 已经落地的前一轮架构建议：

- `commandSpecs.ts` 把 `optionalSlots`、`tightSlots`、`bottomSlots`、`integralBodySlots`、`isTall`、`isSelfDelimited`、`isPrefixBigOp`、`isBinaryRelation`、`gridMeta`、`inlineMacros` 收敛为 `COMMAND_CAPABILITIES`，并由它生成多个 Set/Map；
- `visitNode` / `forEachSlot` / `slotHasRawNodes` 等访问器；
- `InputContextKind` 与 `getInputContext()`；
- `inline_math` 与 `text_box` 内嵌 `$...$`；
- `normalizeSettings()` 迁移旧 `leaderKey='\\'`；
- `sanitizeLatexTemplate()` 接入 parser/editor/latex/userLibraries；
- `hasRawNodes` 进入 `ImportResult`/`EditorSnapshot`，UI 已有提示；
- 增广矩阵 `array {cc|c}`、`smallmatrix`、`dcases`、`rcases`；
- 收藏/最近使用/草稿恢复等 UI 能力。

这些说明项目正在从「补丁式修复」转向「能力注册 + 上下文 + 结构节点」的方向；本轮发现的问题主要剩在**简写/微分/空格这一条横切管线**上。

---

## 1. 空格：预览和导出的语义不一致（已修复）

### 1.1 问题确认

v2.3.0 之前，普通数学空格在 AST 中是 `CharNode(' ')`，但两个渲染路径对它的解释不同：

| 路径 | 行为 |
| --- | --- |
| `toLatex → emitSlotCanonical` | 空格 token 在很多上下文被丢弃（操作符/括号/逗号/大算子附近），其余输出为普通空格。TeX 数学模式忽略普通空格，所以**渲染宽度为 0** |
| `toInteractiveLatex → emitSlotInteractive` | 普通空格被渲染为 `\,`（约 0.166em）或 `\kern 0.04em`；光标相邻时是 `\htmlClass{ms-space-active}{\,}`，CSS 还有 `min-width: 0.28em` + 虚线下划线 |

因此：

- `a b` 的导出是 `a b`（TeX 渲染为无间距的 `ab`），画布却显示成一格可见空隙；
- `pi x` 导出为 `\pi x`（空格只用于结束宏名），画布却把空格画成 `\,`；
- `d x`（用户用空格表示“d 乘 x / 字面 dx”）在画布上看起来像真的插入了空格，而导出渲染并没有这个空格。

用户描述的旧「简流码」语义是对的：**空格是词法分隔符，不是排版间距**。`pi` 被空格包住仍是 `π`；`dx` 被空格包住仍是微元；空格本身不应增加视觉宽度。

### 1.2 本轮修复

`packages/core/src/latex.ts`：

- 普通数学空格改为零宽命中/光标锚点：`\htmlClass{ms-atom ms-space-atom}{\kern0pt}`，保留 `data-atom-slot/offset` 以支持选择与编辑；
- 不再生成 `ms-space-active`，删除 `packages/ui/src/styles/tokens.css` 中 0.28em 虚线空格样式；
- 删除 `VisualCanvas` 对 `.ms-space-active` 的 overlay 测量；
- 清理 `analyzeInteractiveHints` 中只为空格服务的 `keywordIndices`。

保留：

- `\,`、`\:`、`\;`、`\!`、`\ `、`\quad`、`\qquad` 仍然渲染真实间距；
- `\text{...}` 中的空格仍是文本空格（`\text{a b}` 可见）；
- 导出 LaTeX 仍可能带普通空格（用于宏名终止/可读性），但 TeX 数学模式本身忽略它们，渲染与预览一致。

### 1.3 回归

新增 `packages/core/tests/import-and-space.test.ts`：

- `a b` 的 `interactiveLatex` 不含 `ms-space-active`、`\,`、`\kern 0.04em`；
- `x\,y` 的显式间距仍包含 `\,`；
- 文本框 `a b` 仍导出 `\text{a b}`。

### 1.4 仍需注意

- 普通空格的 DOM 锚点是零宽；点击空格本身可能比点击字符更难命中，但方向键/选区仍可到达。若希望有视觉反馈，建议做**不占布局宽度的 caret/overlay 小点**，而不是恢复 `\,`。
- `operatorname{...}` 内的空格目前也走数学空格零宽路径。若以后需要保留操作名内部的空格，应把 `operatorname` 归入 text-like context。

---

## 2. `dx`：从硬编码列表到可扩展微分

### 2.1 修复前的实际行为（探针）

| 输入 | 导出 | 说明 |
| --- | --- | --- |
| `dx` | `\mathrm{d}x` | 硬编码 `DIFFERENTIAL_WORDS` |
| `dy` / `dt` / `dz` / `du` / `dv` / `dr` | 直立微分 | 同上 |
| `da` / `dA` | `da` / `dA` | **不转换** |
| `d x` | `d x` | 空格分隔，字面量 |
| `d*x` | `d*x` | 显式乘号 |
| `d\theta`（导入） | `\mathrm{d}\theta` | 积分体内 generic fallback |
| `d\theta`（普通 typed） | `d\theta` | 依赖 inline macro/上下文 |
| `\int f(x) da` | `\mathrm{d}a` | 积分体内 generic fallback |
| `\int f(x) d x` | `\int f(x)d x` | 空格断开，未识别为微元 |

问题：

1. `dx`/`dy` 等硬编码列表与积分体内的 generic `d[a-zA-Z]` 是两套规则；
2. 单字母变量除了 x/y/t 等，其他在积分外不会变成微分；
3. 多字母、希腊、结构变量（`d\theta`、`d\vec{r}`、`dA`）在积分外没有统一入口；
4. 微分阶数 `d^2x` 没有表达式级别支持；
5. 用户想表达「d 乘 x」或字面 `dx` 时，只能依赖空格/关闭简写/`d*x`，而预览空格又让空格看起来像排版间距。

### 2.2 本轮修复：单字母微分统一

`packages/core/src/latex.ts` 的 canonical tokenizer 与 interactive hints 都改为：

```ts
autoShorthands && (DIFFERENTIAL_WORDS[word] || isGenericDiffWord(word))
```

其中 `isGenericDiffWord(word) = /^d[a-zA-Z]$/`。

于是：

- `dx`、`dy`、`da`、`dA`、`dZ` 等任意 **d + 单个字母** 都渲染为直立微分；
- `dtheta`、`dphi`、`domega` 等继续由 `DIFFERENTIAL_WORDS` 覆盖；
- `d x`（有空格）仍是字面量 d 与 x / d 乘 x；
- `d*x` / `d\cdot x` 仍是显式乘法；
- 正式 LaTeX 导入 `y=dx` / `y=da` 仍保持字面量（导入字母带 `verbatim`，不触发简写）。

注意：单词简写仍保留现有的**非破坏式预览**——光标还在词内时（如 `e da|`）画布显示原始字母，离开词边界后才 morph 成 `\mathrm{d}a`；导出已规范化。这样用户在输入过程中可以继续补字母（`da` → `data` 不会误触发），但需要一个边界/空格/跳槽来「提交」词元。

新增回归：

- `dx → \mathrm{d}x`、`da → \mathrm{d}a`、`dA → \mathrm{d}A`、`dtheta → \mathrm{d}\theta`；
- `d x`、`d*x`、`d\cdot x` 不变成微元；
- `importFormula('y=dx')` / `y=da` 保持字面量。

### 2.3 仍然不够灵活的地方

当前通用规则只覆盖 **单个 ASCII 字母**：

| 需求 | 当前状态 | 建议 |
| --- | --- | --- |
| `dy/dt`、`dz`、`dA` | 已支持 | — |
| `d\theta`（普通输入，非积分体） | 依赖 inline macro 或导入；否则不保证 | 新增 `DifferentialNode` / 显式命令 |
| `d\vec{r}` | 积分体内可；普通输入不保证 | 同上 |
| `d^2x` / `d^3x` | 自然 `^` 会把 2 后面的 x 也放进指数，未形成微分阶数 | `DifferentialNode { order?: SlotNode; variable: SlotNode }` |
| 多字母变量 `dAB` | 不转换（word 为 `dAB`） | 显式微分结构，而不是猜 |
| 想输入字面量 `dx` | 用 `d x`（空格分隔）；预览已不再显示可见空格 | 文档化即可；若要无空格源码可用 `d{}x` 等，不建议默认 |

### 2.4 建议：`DifferentialNode` 或「微分」命令

目标表达：

```text
d            -> differential operator
d x          -> d · x (literal / product)
d*x          -> d · x (explicit)
dx           -> \mathrm{d}x shorthand (natural only)
\int f(x) dx -> \int f(x)\,\mathrm{d}x
d^2x         -> \mathrm{d}^{2}x  (order slot)
d\theta      -> \mathrm{d}\theta
d\vec{r}     -> \mathrm{d}\vec{r}
dAB          -> 用户显式选择，不自动猜
```

建议新增结构：

- `DifferentialNode`：
  - `variable: SlotNode`（可放字母、希腊、向量、括号、分式？限制为原子/单槽更安全）；
  - `order?: SlotNode`（可选，渲染 `\mathrm{d}^{$order}`）；
  - `style?: 'upright' | 'italic'`（默认 `\mathrm{d}`，允许 ISO 风格）；
  - canonical：`\mathrm{d}` / `\mathrm{d}^{n}` + variable；
  - interactive：同构；解析 `\mathrm{d}x`/`\mathrm{d}^{2}x` 时可产出该节点（若无法安全解析，保留 Raw + warning）。
- 入口：
  - 命令面板 / `Tab c f`（当前 c 组 f 未占用）；
  - 或在 `d` 后按 `Tab` 进入微分变量槽；
  - 快捷键可自定义，避免再占用二级字母空间。
- 自然简写：
  - `d` + 单字母继续作为便捷入口；
  - 只有 `DifferentialNode` 能明确表达希腊/结构/阶数；
  - `d x` 永远保留为字面量/乘法；空格是显式分隔。

这样既保留 `dx` 的流畅性，又不再让「不是 x」或「d 乘 x」变成猜谜。

---

## 3. 简写实现方案审计：可扩展，但需要收敛为单一注册表

### 3.1 当前实现的实际分流

| 简写类型 | 匹配位置 | 是否修改 AST | 规则来源 |
| --- | --- | --- | --- |
| 标点简写 `->`、`<=`、`...`、`:::` | `matchTrailingShorthand` / `matchShorthandUpgrade`（`shorthands.ts`） | 是，立即替换为 `SymbolNode` | `AUTO_SHORTHANDS` 的 `kind:'punct'` |
| 单词简写 `pi`、`oo`、`alpha`、`in` | `latex.ts` 的 tokenizer + `analyzeInteractiveHints` | 否，渲染时识别；原始字符保留 | `MATH_FUNCTIONS`、`BARE_WORD_ATOMS/BINOPS`、`DIFFERENTIAL_WORDS` |
| 用户自定义标点简写 | `editor.ts` 的 `matchCustomShorthand(...,'punct')` | 是 | `customCommands[].shorthand` |
| 用户自定义单词简写 | `editor.ts` 的 `matchCustomShorthand(...,'word')` | 是 | 同上 + 左右边界/`immediateShorthand` |
| 微分简写 | `latex.ts` 的 `DIFFERENTIAL_WORDS` / `isGenericDiffWord` + 积分体 fallback | 否 | 两张隐式规则（硬编码 + 上下文） |

关键事实：

- `AUTO_SHORTHANDS` 里的 **word 规则并没有被匹配器使用**；`matchTrailingShorthand` 只取 `kind:'punct'`。word 规则当前主要用于 `SHORTHAND_BY_COMMAND_ID` 提示和测试。
- `BARE_WORD_ATOMS/BINOPS`、`MATH_FUNCTIONS`、`DIFFERENTIAL_WORDS` 才是单词渲染的真实来源。
- `SHORTHAND_BY_COMMAND_ID` 取每个命令最短的 trigger，因此提示和实际匹配可能来自两套表。
- 标点前缀升级只支持硬编码的 `SYMBOL_PREFIX_UPGRADES`：`leq:>`、`leftarrow:>`；新增前缀重叠序列需要再改 map。
- 单词匹配只识别连续 ASCII 字母；数字、Unicode 希腊字母、中文、`\` 宏不在 word 规则里。
- 单词简写的展开发生在 emit/预览阶段，标点简写发生在输入阶段；因此 `pi` 无法像 `->` 一样通过一次撤销回退成“符号节点”，两者语义/撤销体验不同。
- 空格同时承担「词边界」和「可见间距」两种角色（本轮已把后者的视觉宽度去掉，但 AST 里仍是 space char）。

### 3.2 建议的统一 `ShorthandSpec`

```ts
export type ShorthandKind = 'punct' | 'word' | 'differential' | 'unicode';
export type ShorthandContext =
  | 'math'
  | 'integral-body'
  | 'text'
  | 'operatorname'
  | 'any';

export interface ShorthandSpec {
  id: string;
  trigger: string;
  kind: ShorthandKind;
  commandId?: string;          // symbol/structure target
  replacement?: string;        // or direct latex for leaf
  leftBoundary?: 'none' | 'non-letter' | 'start';
  rightBoundary?: 'none' | 'non-letter' | 'end';
  context?: ShorthandContext;
  priority?: number;           // conflicts / longest-match tie-break
  mode?: 'natural' | 'formal'; // formal import never applies natural rules
  label?: string;              // command panel / help
  doc?: string;
}
```

推荐架构：

1. **单一注册表** `SHORTHAND_SPECS`，生成：
   - `AUTO_SHORTHANDS`（兼容现有 API）；
   - `BARE_WORD_*` / `DIFFERENTIAL_WORDS`（或直接由 resolver 查询）；
   - `SHORTHAND_BY_COMMAND_ID`（命令面板/帮助提示）；
   - 文档中的简写表、测试用例。
2. **单一 resolver** `resolveShorthand(tokens, position, context)`：
   - canonical / interactive / editor 共用；
   - 标点用最长匹配/trie，前缀重叠自动升级，不再手写 `SYMBOL_PREFIX_UPGRADES`；
   - word 按左右边界/上下文/优先级解析；
   - differential 根据 `integral-body`/`math` 上下文及 `DifferentialNode` 规则；
   - custom shorthand 使用同一 schema 的扩展实例。
3. **词法分隔符**：
   - `SeparatorNode`（零宽）或 `CharNode` with `role:'separator'`；
   - 普通空格只终止 word，不产生排版宽度；
   - 显式间距保持 `\,`/`\quad` 节点；
   - 文本上下文保留 literal space。
4. **上下文优先于字符猜测**：
   - `operatorname` 内部不展开 `dx`/`pi`；
   - `text_box` 内部不展开；
   - 正式导入 `verbatim` 不展开；
   - 积分体内 generic 微分；
   - 其他数学上下文按显式 `DifferentialNode`，减少 `dA`/`da` 的猜测。
5. **冲突与可扩展性**：
   - 保存用户简写时检测：同一 trigger、同一上下文、前缀重叠、与内置冲突；
   - 支持多个 trigger 指向同一命令（如 `~=` 和 `cong`），面板取最短/首选并标注；
   - 支持 Unicode（`π` → `\pi`）作为可选 `unicode` 规则；
   - 文档/帮助由 registry 生成，避免 `SHORTHAND_BY_COMMAND_ID` 与实际匹配漂移。

### 3.3 可扩展性判断

当前方案**能扩展**，但每加一种简写通常要改 2–4 处：

- 新标点：`AUTO_SHORTHANDS` + 可能需要 `SYMBOL_PREFIX_UPGRADES` + 测试；
- 新单词：`BARE_WORD_*` + `AUTO_SHORTHANDS`（提示）+ 测试；
- 新微分变量：`DIFFERENTIAL_WORDS` 或 generic 规则 + interactive hints + 文档；
- 新用户简写：只能走 `CustomCommandDef`，不能贡献到默认命令提示。

统一注册表后，新增一条简写应只需要：

1. 在 `SHORTHAND_SPECS` 增加一条记录（或从命令的 `CommandSpec` 生成）；
2. 自动生成提示、文档、测试；
3. resolver 自动处理边界/上下文/优先级。

---

## 4. 命令面板缺少简写标注（已修复）

### 4.1 问题

`MathRibbon` 的分类弹层已经显示 `SHORTHAND_BY_COMMAND_ID`，但 `CommandDrawer` 的内置命令卡片只显示 `Tab` 和弦，不显示简写；只有自定义结构行显示 `cmd.shorthand`。因此用户在命令库中看不到 `pi`、`->`、`oo` 等简写入口。

### 4.2 本轮修复

`packages/ui/src/components/CommandDrawer.svelte`：

- 引入 `SHORTHAND_BY_COMMAND_ID`；
- 新增 `{#snippet commandMeta(cmd)}`，统一渲染 `cmd-name + 简写 badge + leader keys`；
- 应用于收藏、最近使用、全部（搜索/非搜索）、命令 Tab 的内置命令卡片；
- 搜索 `filteredCommands` 加入 shorthand trigger，现在搜索 `pi`、`->` 等也能命中；
- `.cmd-short` 使用虚线 badge，tooltip 说明「词简写需空格/边界，标点简写即时生效」。

这样命令面板与 Ribbon、帮助文档使用同一 `SHORTHAND_BY_COMMAND_ID` 数据源；未来统一 registry 后，命令面板自动跟随。

---

## 5. `\(...\)` / `$...$` 等外部包装的解析

### 5.1 支持情况（本轮修复后）

`packages/core/src/parser.ts → stripOuterDelimiters()`：

| 输入 | 结果 |
| --- | --- |
| `$x^2$` | `x^2`，正常导入 |
| `$$x^2$$` | `x^2` |
| `\(x^2\)` | `x^2` |
| `\[x^2\]` | `x^2` |
| ```` ```latex\n$x^2$\n``` ```` | `x^2` |
| `$a + \$5$` | `a + \$5`（转义 `$` 保留为字面量） |
| `\(x^2\) + \(y^2\)` | **不剥离**（避免把两个公式裁成一个） |
| `$x$ + $y$` | **不剥离**（多个未转义 `$`） |
| `$$x$$ + $$y$$` | **不剥离** |
| `$x^2` / `x^2$` / `$$x^2$` | 不剥离，按原文处理 |

边界规则：

- `$...$` 要求内部没有未转义的 `$`；`\$` 不算分隔符；
- `\(...\)` / `\[...\]` 要求内部没有未转义的成对结束符，避免多公式误裁；
- 代码围栏先剥离，再处理内部定界符。

### 5.2 仍存在的限制

- 多个独立行内公式（从一段文字复制）不会被拆分；当前会按原文保留，可能产生 Raw/literal `$`。建议后续在导入预览中明确提示「检测到多个公式，请逐个导入」，而不是静默。
- Obsidian 的**光标处自动识别**仍只处理 `$...$` / `$$...$$`；`\(...\)` / `\[...\]` 可以通过导入/粘贴使用，但不会在光标处自动定位。若用户在 Obsidian 中经常粘贴 MathJax 包装，建议扩展 `obsidianMath.ts`。
- `\begin{equation}` 等环境由 parser 环境解析路径处理，不属于 `stripOuterDelimiters` 的包装剥离。

---

## 6. 本轮代码变更与验证

### 6.1 变更文件

| 文件 | 变更 |
| --- | --- |
| `packages/core/src/latex.ts` | 普通空格零宽渲染；移除 `ms-space-active`/`keywordIndices`；generic 单字母微分 |
| `packages/core/src/parser.ts` | `stripOuterDelimiters` 支持转义 `$`、多公式不误裁、`\(...\)`/`\[...\]` 内部成对检测 |
| `packages/ui/src/components/CommandDrawer.svelte` | 命令面板简写 badge + 搜索 shorthand + 统一 `commandMeta` snippet |
| `packages/ui/src/components/VisualCanvas.svelte` | 移除 `.ms-space-active` overlay 选择器 |
| `packages/ui/src/styles/tokens.css` | 移除 0.28em 可见空格样式 |
| `docs/GUIDE.md` / `docs/QUICKSTART.md` / `README.md` / `HelpModal.svelte` | 记录 `dx/da/dA`、`d x` 字面量、空格分隔符、外部包装解析 |
| `packages/core/tests/import-and-space.test.ts` | 新增 10 个回归测试 |

### 6.2 提交范围

本次提交聚焦于本轮的 v2.3.0 修复与复审记录，包含：

- `packages/core/src/latex.ts`、`packages/core/src/parser.ts`；
- `packages/core/tests/import-and-space.test.ts`；
- `packages/ui/src/components/CommandDrawer.svelte`、`HelpModal.svelte`、`VisualCanvas.svelte`、`styles/tokens.css`；
- `README.md`、`docs/GUIDE.md`、`docs/QUICKSTART.md`；
- 本审计文档 `docs/mathslot-v2.3.0-review.md`。

`.commandcode/` 为本地工具配置，不纳入版本库；`docs/mathslot-v2.2.3-audit.md`、`docs/mathslot-architecture-evolution.md` 等历史独立审计稿保持独立，不混入本次功能修复提交。

### 6.3 验证结果

- 核心测试：**78 passed / 7 files**；
- `svelte-check`：**0 errors / 0 warnings**；
- Obsidian `tsc --noEmit`：通过；
- KaTeX 全量渲染：165 条命令 + 89 条预置仍全部通过；
- 新增测试覆盖：`$...$`/`$$...$$`/`\(...\)`/`\[...\]`/fence、`\$`、多公式、未闭合、普通空格/显式空格/文本空格、`da/dA/dtheta`、`d x`、`d*x`、正式导入字面量。

---

## 7. 后续建议

### P1

1. **`DifferentialNode` / 微分命令**：支持任意变量、希腊、向量、阶数；`dx` 保留为自然简写；`d x` 永远是字面量/乘法。
2. **简写注册表**：统一 `ShorthandSpec`，生成提示/文档/测试；消除 `AUTO_SHORTHANDS` word 规则与实际 matcher 的分离。
3. **多公式导入提示**：`stripOuterDelimiters` 检测到多个未转义 `$`/`\(` 时，在导入预览中给出明确提示，而不是让用户看到 literal `$`。
4. **Obsidian `\(...\)` / `\[...\]` 检测**：如果用户群常从 MathJax/AI 复制，扩展 `obsidianMath.ts` 的光标检测。

### P2

1. **微分上下文可视化**：输入 `d` 后提示「变量槽 / 阶数槽」，或显示当前 token 是「微元 / 字面量」；避免 `dx` 与 `d x` 的语义只存在于文档。
2. **空格选择反馈**：零宽空格目前不易点击；可加不占布局的 overlay 小点/光标提示。
3. **普通空格源码压缩**：若用户希望导出更干净，可提供「紧凑源码」选项，只在宏名边界保留必要空格；默认保持可读性。
4. **Unicode 简写**：`π`、`∞` 等直接映射为对应符号/宏；需要决定导出为 Unicode 还是 `\pi`。

### P3

1. **用户简写分享/导入导出**：与 `presets.json`/`commands.json` 同一套 schema/版本。
2. **简写冲突可视化**：命令面板/设置中显示「`pi` 同时被内置与用户规则占用」。
3. **公式库的简写过滤**：命令面板已支持搜索 shorthand；后续可增加「仅看有简写的命令」筛选。

---

## 8. 结论

- 本轮三个用户可感知的问题已经修复：**普通空格不再在画布上凭空占宽**、**命令面板能看到简写**、**`\(...\)`/`$...$`/`$$...$$`/`\[...\]` 单公式可正常导入且转义 `$`/多公式不再被错误裁剪**。
- `dx` 的灵活性从「硬编码 16 个词」提升为「`d` + 任意单字母」，并用空格作为字面量/乘法的显式分隔；但希腊、结构、阶数仍需要 `DifferentialNode` 才能彻底解决。
- 简写方案**可以扩展，但当前仍是两套规则**：标点即时改 AST，单词在渲染时识别；`AUTO_SHORTHANDS` word 规则并不参与实际匹配。建议下一步把简写收敛为 `ShorthandSpec` 注册表，与 `CommandSpec` 同级，生成提示、文档和测试。
- 空格语义应固定为「分隔符」：普通空格零宽，显式 `\,`/`\quad` 才有宽度；这与 TeX 数学模式一致，也符合旧「简流码」的直觉。

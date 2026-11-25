# MathSlot 第三方审计核实与 v2.3.0 架构演进回应文档

> **回应版本**：`v2.3.0`（综合回应 `docs/mathslot-v2.2.3-audit.md` 与 `docs/mathslot-architecture-evolution.md`）  
> **维护原则**：以实证为准绳——凡经源码与 KaTeX 探针证实的数据风险、安全隐患、语义失真与输入断层，全部根治并纳入自动化契约测试；同时采用渐进演进（Strangler Pattern）完成单源命令能力注册表、统一输入上下文与高价值数学结构扩展。

---

## 一、总体评估结论

`mathslot-v2.2.3-audit.md` 与 `mathslot-architecture-evolution.md` 准确切中了两个层面的核心课题：
1. **缺陷修复层**：1 项 P0 数据覆盖风险与 15 项 P1 正确性/安全/交互缺陷全部属实。
2. **架构演进层**：命令元数据分散在 4 个文件、纯文本上下文未覆盖粘贴/命令/片段入口、换行净化缺少递归深度、自定义模板缺少 `\htmlData` 安全消毒、UI 手动 `sync()` 易漏调，以及 `array {c|c}` 增广矩阵与 `\text{... $...$ ...}` 内嵌数学缺失。

我们已将补丁修复与架构升级合并演进为 **MathSlot v2.3.0** 正式版。

---

## 二、P0 / P1 缺陷核实与 v2.2.4 修复对照表

| 报告编号 | 核实结果 | 根因确认与 v2.2.4 实际修复方案 | 涉及核心文件 |
| --- | --- | --- | --- |
| **P0-1** 外部空库覆盖 `store.json` | **属实** | Rust 初次创建空 `presets.json`/`commands.json`（或 Web 端 `localStorage` 未初始化）时返回合法空数组，前端静默覆盖了 `store` 中已有条目。**修复**：`UserLibrariesPayload` 增加 `presetsNewlyCreated` / `commandsNewlyCreated` 标记；静默加载遇到新建/空外部库而 `store` 非空时保留 `store` 并反向同步至外部文件，双侧均有条目时按 `id` 合并。 | `apps/desktop/src-tauri/src/lib.rs`<br>`apps/desktop/src/desktopHost.ts`<br>`packages/ui/src/components/MathSlotStudio.svelte` |
| **P1-1** 文本框输入 `\` 报 `\backslash` 错误 | **属实** | `escapeCharLatex` 未区分数学模式与文本模式，`\text{a\backslash b}` 在 KaTeX 文本模式下非法。**修复**：`escapeCharLatex` 增加显式 `mode: 'math' \| 'text'`；文本模式下输出 `\textbackslash{}`、`\textasciicircum{}`、`\textasciitilde{}`，并在 `parseLatexTextArg` 支持无损往返。 | `packages/core/src/latex.ts`<br>`packages/core/src/parser.ts` |
| **P1-2** 关闭自然输入后 `^` / `~` 报错 | **属实** | `\textasciicircum` 与 `\textasciitilde` 是文本模式宏，裸露在数学模式中 KaTeX 报错。**修复**：数学模式字面转义改为 `\text{\textasciicircum}` 与 `\text{\textasciitilde}`，在任意设置组合下均可正常渲染。 | `packages/core/src/latex.ts` |
| **P1-3** 正式导入 `a~b` / `\epsilon` / `\ldots` 变义 | **属实** | `parseLatex` 未保留 `~`（不换行空格），且 `SYMBOL_ALIASES` 将 `\epsilon` 映射为 `\varepsilon`、`\ldots` 映射为 `\cdots`。**修复**：正式导入中 `~` 保留为不换行空格 `RawNode('~')`；移除有损字形别名，将 `\epsilon`、`\ldots`、`\dots`、`\emptyset`、`\varpi`、`\varrho`、`\varsigma`、`\varkappa`、`\mid`、`\bmod` 等纳入 `LOSSLESS_RAW_SYMBOLS` 原样保留。 | `packages/core/src/parser.ts` |
| **P1-4** 多行内容粘贴/插入嵌套槽位产生 `\frac{a\\b}{}` | **属实** | 非根槽位未过滤行分隔符 `\\`。**修复**：新增 `sanitizeNodesForTargetSlot`，目标槽位非根槽位时自动将换行降级为空格（包括 `pasteLiteralText`、`pasteText` 与 `insertSnippetAtCursor`）。 | `packages/core/src/editor.ts` |
| **P1-5** `text_box` 内部误触发数学结构与 `;` 跳槽 | **属实** | `text_box` 共用了数学触发管线。**修复**：在 `insertText` 入口增加 `isInsideTextBox()` 纯文本上下文拦截，在 `\text{...}` 内部关闭 `/`、`^`、`_`、`()[]{}`、`;` 及简写触发，所有字符按 `verbatim` 纯文本录入（仍可通过 `Enter` / 方向键 / `Alt+↑` 跳出）。 | `packages/core/src/editor.ts` |
| **P1-6** 单行 `a & b` 被拼成 `a b`；`\tag` 丢失环境或交互报错 | **属实** | `stripTopLevelAmpersands` 未检查 `&` 是否邻接关系符；`\tag` 脱离环境且在交互 `\htmlData` 组内触发 KaTeX 报错。**修复**：非关系对齐（如 `a & b`）及含 `\tag` 的环境整体保留并给出块级导出提示；交互渲染层将 `RawNode` 中的 `\tag{n}` 安全映射为预览态 `\qquad\text{(n)}`（导出仍 100% 保留原生 `\tag{n}`）。 | `packages/core/src/parser.ts`<br>`packages/core/src/latex.ts` |
| **P1-7** 矩阵增删行列丢失 `grid.rowGaps` | **属实** | `addGridRow`/`removeGridRow`/`addGridCol`/`removeGridCol` 重建 `grid` 时丢弃了 `rowGaps`。**修复**：四处网格操作同步拷贝并按增删行索引维护 `rowGaps`。 | `packages/core/src/editor.ts` |
| **P1-8** 持久化并发竞态与 Obsidian 整包覆盖 | **属实** | 并发 `void persist()` 无序落盘，Obsidian `saveData` 未合并已有字段。**修复**：`MathSlotStudio` 增加串行 `persistChain` 写队列；Obsidian `saveStore` 增加串行队列并在写前读取最新 `data.json` 做字段合并。 | `packages/ui/src/components/MathSlotStudio.svelte`<br>`apps/obsidian/src/main.ts` |
| **P1-9 / P3-6** `ExportModal` 缺 `try/catch`；PNG 8192px 上限与倍率提示 | **属实** | `copyMathML`/`exportMathML`/`copyLatex`/`exportTex` 未捕获异常；`Math.max(0.5, ...)` 对超宽公式可突破 8192px。**修复**：全部导出/复制入口补齐 `try/catch` + `onNotify`；移除 `0.5` 下限硬保 `<= 8192px`，并在自适应降倍率时提示实际倍率。 | `packages/ui/src/exportUtils.ts`<br>`packages/ui/src/components/ExportModal.svelte` |
| **P1-10** 暗色模式下复制透明 PNG/SVG 贴到白底不可见 | **属实** | 快速复制直接取 `resolvedTheme === 'dark'` 生成浅色字形透明图。**修复**：底部栏一键复制 PNG/SVG 固定使用深色墨迹（`dark: false`），确保粘贴至 Word / PPT / 微信 / 白底文档始终清晰可读；导出弹窗在暗色主题下默认选中「纯白底」（仍可手动切换透明或深色底）。 | `packages/ui/src/components/MathSlotStudio.svelte`<br>`packages/ui/src/components/ExportModal.svelte` |
| **P1-11** Obsidian `forceDelimiter` 污染全局设置 | **属实** | `MathSlotModal.loadStore` 直接改写了 `settings.delimiter`。**修复**：改为 `HostAdapter.initialDelimiter` 会话级状态 `sessionDelimiter`，仅作用于当次弹窗，绝不污染持久化的默认输出格式。 | `packages/ui/src/host.ts`<br>`apps/obsidian/src/MathSlotModal.ts`<br>`packages/ui/src/components/MathSlotStudio.svelte` |
| **P1-12** 无选区 `Ctrl+X` 假剪切 | **属实** | 无选区时 `getSelectedLatex()` 回退整条公式且未删除却提示「已剪切」。**修复**：无选区按 `Ctrl+X` 不改剪贴板、不删内容，明确提示「请先选中要剪切的内容」。 | `packages/ui/src/components/MathSlotStudio.svelte` |
| **P1-13 & §9.6** 预览回退 HTML 注入 & 外部 `\htmlData` 伪造 | **属实** | 超深嵌套令 KaTeX 抛 `RangeError` 时，`renderLatexPreview` 返回未转义原串交给 `{@html}`；外部导入未剥离 `\htmlData`。**修复**：`renderLatexPreview` 增加长度/花括号深度预算，且异常回退严格执行 `escapeHtml`；解析器拦截并剥离外部输入中的 `\htmlData`/`\htmlClass`/`\htmlId`/`\htmlStyle`/`\href`/`\url`。 | `packages/ui/src/katexRenderer.ts`<br>`packages/core/src/parser.ts` |
| **P1-14** Obsidian 初始公式语法错误时静默空画布 | **属实** | `onMount` 未检查 `loadFormula` 错误。**修复**：新增 `loadFormulaWithRawFallback`，遇到损坏公式时保留原文载入并弹出具体错误提示，引导用户在底部源码栏修复，绝不静默丢弃原文。 | `packages/core/src/editor.ts`<br>`packages/ui/src/components/MathSlotStudio.svelte` |
| **P1-15 & P2-7** 片段插入与 `Delete` 误入折叠可选空槽 | **属实** | 插入 `\int x\,dx` 或 `\xrightarrow{f}` 时光标落入空下限/下标。**修复**：`insertSnippetAtCursor` 仅寻找第一个**必填**空槽（无必填槽则停在片段末尾）；`deleteForward` 与 `moveRight` 保持一致，跳过不可见可选空槽。 | `packages/core/src/editor.ts` |

此外，同步修复了 **P2-2**（`ImportResult` 暴露 `hasRawNodes`）、**P2-8**（设置面板移除会自毁 LaTeX 命令输入的 `\` 引导键选项，并标注 `/` 与斜杠分式的替代关系）、**P2-10**（修复 `parseStreamCode` 对 `▸r3;8;` 双参根号的解析）、**P2-19**（为导出/设置/帮助弹窗补齐全局 `Escape` 关闭），并更新了 `README.md`、`docs/GUIDE.md` 与 `HelpModal.svelte` 的版本号（`v2.2.4`）、命令总数（`150` 条）及分段函数行列说明（**P3-16 / P3-17**）。

---

## 三、事实澄清与架构取舍说明（未照搬项）

作为项目主导维护者，我们对报告中的以下条目给出明确事实澄清与工程取舍：

### 1. 误报澄清：P3-11 / §9.7「Linux 安装包安装两个 `.desktop` 文件导致双启动图标」
- **核查事实**：`apps/desktop/src-tauri/linux/io.mathslot.desktop.desktop` 与 `mathslot.desktop` 中均显式声明了 **`NoDisplay=true`**，任何遵循 Freedesktop Desktop Entry 规范的桌面启动器（GNOME、KDE Plasma、XFCE 等）均不会将它们展示为重复应用图标；用户可见的唯一启动器图标来自 `MathSlot.desktop.hbs` 模板。
- **存在原因**：在 Linux Wayland 会话下，GTK/WebKitGTK 窗口上报的 `app_id` 在不同发行版打包形态下可能为 `io.mathslot.desktop` 或二进制名 `mathslot`；这两个隐藏 `.desktop` 映射文件专门解决 Wayland 左上角标题栏与任务栏显示通用 Wayland 占位图标的宿疾，因此**必须保留**。

### 2. v2.3.0 已落地的核心架构演进与新特性
结合 `docs/mathslot-architecture-evolution.md` 的建议，我们在 **v2.3.0** 落地了以下架构升级与结构扩展：
- **单源命令能力注册表（`packages/core/src/commandSpecs.ts`）**：统一收敛 `optionalSlots`、`tightSlots`、`bottomSlots`、`integralBodySlots`、`isTall`、`isSelfDelimited`、`isDelimiter`、`isPrefixBigOp`、`isBinaryRelation`、`backwardWrap`、`gridMeta`、`inlineMacros` 与 `accentMacro`，消除 `ast.ts`、`latex.ts`、`editor.ts`、`parser.ts` 四处散落的硬编码集合，并建立自动化架构契约测试（Contract Tests）。
- **统一输入上下文路由（`getInputContext()`）与 `\text{... $...$ ...}` 行内数学槽位**：
  - 将输入上下文显式建模为 `'math-root' | 'math-slot' | 'math-grid' | 'text'`（以及 `\operatorname` 标识符直输态），同时保护 `insertText`、`pasteText`、`insertCommand` 与 `insertSnippetAtCursor` 四大入口。
  - 在 `\text{...}` 内按未转义 `$` 即可创建可交互 `inline_math` 数学子槽（再次按 `$` 跳回外层文本），并支持 `\text{当 $x_1 > 0$ 时}` 正式 LaTeX 无损双向解析。
  - `sanitizeNodesForTargetSlot` 升级为全树递归净化，彻底杜绝深层结构嵌套带入非法 `\\`。
- **模板安全消毒与持久化 Schema 自动迁移**：
  - 新增 `sanitizeLatexTemplate`，对外部 `commands.json`、`presets.json`、自定义结构 `customCommands` 及自定义模板渲染统一剥离 `\htmlData` / `\htmlClass` / `\htmlId` / `\htmlStyle` / `\href` / `\url` / `\includegraphics`。
  - 新增 `normalizeSettings`，在加载配置时自动将历史遗留的 `leaderKey: "\\"` 无缝迁移至 `'Tab'`。
- **引擎响应式订阅（`engine.subscribe`）与历史体验优化**：
  - `MathSlotEngine` 提供订阅通知机制驱动前端快照更新与桌面端草稿防抖持久化（重启自动恢复上次未提交公式）。
  - 连续字母/数字键入在 500ms 窗口内自动合并撤销步，同时完整保留选区状态（`HistoryEntry.selection`）与符号简写的单步回退能力。
- **165 条内置命令与增广矩阵 / 新环境全面支持**：
  - 新增 `array {cc|c}` 列对齐与竖线规格解析、**增广矩阵 `[A|b]`**（`Tab m k` + 画布悬浮条 `|线` / `Alt+\` 一键切换任意列分隔竖线，增删列自动维护 `colSpec`）、`smallmatrix`（`Tab m l`）、`dcases`（`Tab m m`）、`rcases`（`Tab m n`）。
  - 新增可编辑单槽/大算子结构：`\mathbf`、`\mathcal`、`\mathbb`、`\operatorname`、`\widehat`、`\widetilde`、`\overrightarrow`、`\bigcup`、`\bigcap` 与关系符 `\mid`。
  - `Ctrl+K` 抽屉支持 `★` 常用收藏、最近使用（MRU）、原地展开全部预置公式，并在 `ImportModal` 与 `LatexDock` 直观提示 `hasRawNodes` 原生保留项；`svelte-check` 达成 **0 errors / 0 warnings**。

### 3. 保持克制的工程边界（留待后续大版本按需演进）
- **为何暂不引入结构共享历史（Persistent AST / OT）**：实测 392 字符连续输入或 3000+ 字符大公式场景下，`getSnapshot()` / `toLatex()` 单次耗时仅 **0.82 ~ 1.1 ms**（远低于 16.6 ms 帧预算），`undo` 单次仅 **0.2 ms**。配合 v2.3.0 的连续输入合并（Typing Coalescing），已在零复杂度膨胀的前提下解决了撤销粒度与内存占用问题。
- **多对齐点 `AlignNode` 可视化网格**：当前版本对多列 `align`、非关系对齐 `a & b` 与 `\tag` 均保证 100% 语义保留并提供底部多行源码直编与预览渲染，未来若扩展至整篇多段推导讲义工作台再独立建模多列对齐网格。

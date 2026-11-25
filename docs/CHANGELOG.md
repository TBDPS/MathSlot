# MathSlot 版本历史与审计记录

> 本文件只维护版本历史、已解决事项与审计文档沿革；当前与未来的审计结论统一见 [`AUDIT.md`](./AUDIT.md)。  
> 当前开发版本：**2.3.0**。

---

## v2.3.0（当前）

### 主要能力

- 165 条内置命令、89 条预置公式；
- `commandSpecs.ts`：`CommandCapabilities` 单源注册表，统一 optional/tight/bottom/integral-body、tall/self-delimited/prefix-bigop/binary-relation、gridMeta、inlineMacros、accentMacro；
- `visitNode` / `forEachSlot` / `slotHasRawNodes`；
- `InputContextKind`（`math-root` / `math-slot` / `math-grid` / `text`）与 `\text{... $...$ ...}` 内嵌可交互数学；
- `normalizeSettings`（迁移旧 `leaderKey='\\'`）；
- `sanitizeLatexTemplate`（剥离 `\htmlData/\htmlClass/\htmlId/\htmlStyle/\href/\url/\includegraphics`）；
- `hasRawNodes` 在 ImportModal / LatexDock 提示；
- `MathSlotEngine.subscribe`、连续输入合并、选区随历史保存、桌面草稿恢复；
- 增广矩阵 `array {cc|c}`、`smallmatrix`、`dcases`、`rcases`；
- `Ctrl+K` 收藏、最近使用（MRU）、命令面板简写 badge；
- `svelte-check` 0 errors / 0 warnings。

### 审计后修复（2.3.0 工作树）

- 普通数学空格改为零宽词法分隔符；显式 `\,`/`\quad` 保持宽度，文本空格保留；
- `d` + 任意单个 ASCII 字母识别为直立微分；`d x` / `d*x` 表示字面量/乘法；
- 命令面板内置命令显示简写并支持简写搜索；
- `$...$` 内转义 `\$`、`\(...\)`/`\[...\]` 成对检测、多公式不再被错误裁剪；
- 新增空格/外部定界符/微分简写回归测试。

---

## v2.2.4

- 修复外部空 `presets.json/commands.json` 覆盖 `store.json` 用户库；
- `escapeCharLatex` 区分数学/文本模式，修复文本框 `\`、关闭自然输入后的 `^`/`~`；
- 正式导入保留 `a~b`、`\epsilon`、`\ldots`、`\emptyset` 等语义；
- 非根槽位递归净化 `\\`；
- `text_box` 纯文本输入上下文；
- 非关系 `&` / `\tag` 环境保留；
- 矩阵增删行列保留 `rowGaps`；
- 桌面写队列、Obsidian 串行保存；
- 导出 MathML 等错误处理、PNG 8192px 上限、暗色 PNG/SVG 可读性；
- Obsidian `forceDelimiter` 改为会话级；
- 无选区 `Ctrl+X` 不再假剪切；
- 预览回退 HTML 转义、外部 `\htmlData` 等宏过滤；
- Obsidian 初始公式错误改为原文降级载入；
- 片段插入/`Delete` 跳过折叠可选槽。

---

## v2.2.3

- 显式间距（`\,`、`\!`、`\quad`、`\qquad` 等）往返保真；
- 矩阵内部空行与 `\\[4pt]` 行距保留；
- 围栏代码块中的 `$$` 不再误识别；
- 正式 LaTeX 导入的 `oo/pi/dx` 保持字面量；
- 多列 `align` 以 Raw 形式保留语义；
- `Tab a r–y`、`Tab o u–x`、`Tab x q–u`、`Tab q o`、`Tab g w/V` 等新命令；
- 150 条命令。

---

## v2.2.2

- LaTeX 往返保真、Obsidian 代码/转义保护、UI 草稿安全；
- 新增 5 个结构。

---

## v2.2.1

- 安全与稳定性加固：CSP、KaTeX trust 白名单、剪贴板尺寸校验、原子写、解析深度上限、Obsidian 原文漂移校验；
- 新增 14 个数学结构。

---

## v2.1.0

- 二级菜单即时默认与无缝变形、矩阵删除快捷键、左侧悬浮编辑栏；
- Wayland 图标与全新图标。

---

## v2.0.1

- 桌面端完整 topbar、Obsidian 关闭按钮、引用块修复、多行 LaTeX 栏。

---

## 已撤回的误报

### Linux 双图标 / 重复 `.desktop`

`apps/desktop/src-tauri/linux/io.mathslot.desktop.desktop` 与 `mathslot.desktop` 均声明 `NoDisplay=true`；它们是 Wayland `app_id`/`StartupWMClass` 的隐藏映射，遵循 Freedesktop 规范的启动器不会显示为重复图标。用户可见启动器来自 `MathSlot.desktop.hbs`。这两个隐藏文件应保留。

---

## 审计文档沿革

- 早期审计稿：`PROJECT-EVALUATION.md`（v2.2.1）、`mathslot-project-review.md`（v2.2.2）、`mathslot-spacing-shorthand-audit.md`（v2.2.2）；
- 深度审计与回应：`mathslot-v2.2.3-audit.md`、`AUDIT-RESPONSE.md`、`mathslot-architecture-evolution.md`、`mathslot-v2.3.0-review.md`；
- 这些文档中的有效结论已合并为单一的 `docs/AUDIT.md`，历史修复/撤回记录保留在本文件中，审计文档只关注当前与未来。

# MathSlot 重构蓝图：从零开始的功能设计与技术架构

> 关联审计：[`docs/AUDIT_2026-11-10.md`](./AUDIT_2026-11-10.md)
> 基线：`5921326`（导航/括号提交 + LaTeX 导入审计）

---

## 0. 先回答：这些问题和最初设计有关吗？

**有关，而且不是“某个 bug 没修好”，是几个基础决策在持续放大维护成本。**

当前实现的核心矛盾：

1. **文本和语义是两套状态。** `source: String` 是用户看到的文本，`parsed: ParsedDoc` 是语义树；每次编辑都靠 `sync_after_edit` 重新解析，很多功能（`▸` 指令、`;` 槽位、`^/_`、括号、导航）都靠文本约定推断。
2. **控制指令写在公式文本里。** `▸f`、`▸j`、`;`、`^/_` 既是输入语法又是 UI 操作；解析器、导航、导出器、插件各自解释一遍。
3. **上下标有两套表示。** `▸u/▸d/▸b` 是结构化表示，文本 `^/_` 又被 `latex_range` 启发式解释；导入器输出后者，导出器猜前者，必然丢分组。
4. **括号不是 AST 节点。** 括号只是 Text 里的字符，自动配对、导航锚点、匹配跳转都需要额外扫描字符串，无法复用结构信息。
5. **键位语义分散在三层。** 桌面端 `app.rs`、核心 `editor.rs`、插件 `plugin.js` 各有一套键位判断，CapsLock/h/t/Tab j 的漂移就是这样产生的。
6. **导入器是字符串重写器。** `latex_to_mathslot` 用局部字符扫描处理 `\frac`、`\sqrt`、`\sum`，不适合上下标、环境、嵌套分组；`\left` 被 `starts_with("\\le")` 误判就是直接后果。
7. **UI 直接改领域状态。** `MathSlotApp`、`modals.rs` 直接改 `editor.source`、`esc_nav`、library；没有统一事务、校验和撤销边界。
8. **预览和导航图各自渲染。** 每次按键生成两份 LaTeX、两份 PNG；视觉高亮又通过 `\bbox` 注入 LaTeX，导致渲染逻辑和语义耦合。

如果继续在当前骨架上打补丁，每加一个功能都要同时改：文本约定、解析器、导航、导出器、桌面键位、插件键位、测试。**技术负担会继续上升。**

---

## 1. 重构目标与边界

### 1.1 产品目标

MathSlot 的定位保持不变：

- 面向数学公式的**流式键盘输入器**；
- 桌面端 + Obsidian 插件同源；
- 不要求用户记忆复杂 LaTeX；
- 支持公式导航、槽位跳转、模板复用、LaTeX 导入导出；
- 离线、轻量、无 WebView 依赖（桌面端）。

### 1.2 质量目标（按优先级）

1. **正确性**：支持的 LaTeX 子集往返无损；不支持的结构显式降级，不静默丢语义。
2. **输入延迟**：按键到文本更新 < 16ms；预览 < 50ms（普通公式）。
3. **可扩展性**：新增一个结构/符号只改一处注册表，不改解析器、UI、文档、WASM 桥接各一遍。
4. **可测试性**：核心解析、导入、导出、导航、事务都有确定性测试。
5. **桌面/插件一致性**：同一套 Action/状态机，插件不重新实现键位语义。
6. **可回滚**：每次编辑都是事务；导入有报告；不支持的结构可保留原始 LaTeX。

### 1.3 明确不做

- 不做完整 TeX 引擎；只支持文档化的数学子集 + 原始 LaTeX fallback。
- 不做 WYSIWYG 鼠标排版编辑器；保持键盘优先。
- 不追求一次支持所有 LaTeX 宏包；先覆盖常用 AMS 数学。
- 不把桌面端改成 WebView；保持原生轻量。

---

## 2. 功能设计

### 2.1 输入模型：原子 + 脚本 + 结构

建议把公式的语义单位统一为：

```text
Expr
├── Text          普通文本
├── Symbol        符号/常量/算子
├── Group         {...} 分组
├── Script        base + sub + sup
├── Delimited     ( ... )、[ ... ]、{ ... }、| ... |
├── Fraction      num / den
├── Root          index? / radicand
├── BigOperator   ∫/∑/∏ + lower + upper + body
├── Matrix        env + rows × cols
├── Accent        hat/bar/vec/dot/...
├── Custom        user format + slots
├── Placeholder   待填槽位
└── RawLatex      不支持结构的透明保留
```

关键点：

- `Script` 是**唯一**的上下标表示。文本 `^/_` 在解析时立即归一化为 `Script`；导出时只从 `Script` 生成 `\sup/\sub`，不再用启发式 `latex_operand`。
- `Delimited` 是**第一等节点**。`()`、`[]`、`{}` 不再是 Text；自动配对、括号导航、匹配跳转都直接操作节点。
- `Matrix` 是**环境节点**。`pmatrix/bmatrix/vmatrix/cases` 映射到 `Matrix { env, rows }`，不再输出 `\beginpmatrix` 文本。
- `RawLatex` 用于不支持的宏/环境：保留原文并标记 warning，允许“替换但提示有损”，而不是悄悄转错。

### 2.2 输入与命令

#### 命令注册表

所有结构/符号由统一注册表描述，是解析器、面板、文档、WASM catalog 的唯一事实来源：

```rust
pub struct CommandSpec {
    pub id: CommandId,
    pub trigger: Trigger,          // Tab 后的键序列
    pub slots: &'static [SlotRole],
    pub build: fn(&mut NodeBuilder) -> Expr,
    pub render: RenderRule,
    pub category: Category,
    pub doc: CommandDoc,
}
```

- `▸f`、`▸r`、`▸i` 等内置命令来自 `COMMANDS`。
- 自定义格式也变成一个 `CommandSpec`，命名空间为 `user:<id>`，不能占用保留键。
- 面板卡片、快捷键提示、HELP 文档、WASM `catalog()` 都从注册表生成，避免“文档写一套、代码做一套”。

#### 触发方式

- `Tab` 进入命令前导态；下一个键选择命令。
- `Tab j` 是 `KeySequence([Tab, J])`，进入导航，不再写入 `▸j` 文本。
- `Alt` 轻按松开是 leader；`Alt` 后按 `j` 进入导航。
- 不使用 `CapsLock`；不使用 `Ctrl/Alt + 字母` 作为应用级导航组合键。
- 所有键位在 **UI adapter** 层映射为 `Action`，核心只接收语义 Action：

```rust
pub enum Action {
    ToggleNavigation,
    Nav(NavAction),
    InsertCommand(CommandId),
    OpenBracket(Delim),
    CloseBracket(Delim),
    MoveCursor(Motion),
    ...
}
```

桌面端、WASM、Obsidian 共享一份 `Keymap` 定义；插件不再手写 `/^[a-z...]$/` 之类的正则。

### 2.3 括号

设计目标：

- 输入 `(` / `[` / `{` 自动补右半；
- 光标在空配对中按 Backspace 删除两边；
- 光标紧贴配对右括号时输入右括号直接跳过；
- 有选区时只包裹字面选区；
- `\left(`、`\{` 等上下文不自动配对；
- 括号成为 `Delimited` 节点，导航锚点直接来自 AST。

核心编辑 API：

```rust
pub enum BracketEdit {
    InsertPair { open: Delim, at: Span, selection: Option<Span> },
    SkipClose { close: Delim, at: Position },
    DeletePair { pair: NodeId },
}
```

这些编辑由 `Editor::apply()` 生成事务，不通过扫描字符串后再修改。

### 2.4 导航

导航从 AST 派生，而不是从文本位置猜：

```rust
pub enum AnchorKind {
    ScopeStart,
    ScopeEnd,
    Slot(SlotId),
    ScriptSub(NodeId),
    ScriptSup(NodeId),
    DelimitedOpen(NodeId),
    DelimitedClose(NodeId),
    MatrixCell { row: u16, col: u16, slot: SlotId },
}

pub struct Anchor {
    pub id: AnchorId,
    pub node: NodeId,
    pub kind: AnchorKind,
    pub target: Span,
    pub role: String,
    pub grid: Option<GridPos>,
}
```

- 标签在**一个文档版本内稳定**；编辑后重新分配，但点击锚点用 `AnchorId`，不依赖字母。
- 标签生成器保留 `p/n` 给历史、避免把 `h/t` 映射成行首/行尾；`a` 固定行首、`;` 固定行尾；括号用专用 `(`/`)` 键，不消耗字母。
- 导航状态独立为 `NavState`，不塞进 `StreamEditor` 的文本状态。
- 2D 网格（矩阵、上下限、分子分母）由节点上的 `GridPos` 决定，不靠视觉坐标猜。
- 导航历史保存 `AnchorId + 编辑变换`，编辑后通过事务的 offset mapping 保持位置。

### 2.5 模板与自定义格式

模板不再是“整行字符串片段”，而是：

```rust
pub struct Template {
    pub id: TemplateId,
    pub label: String,
    pub expr: Expr,          // 结构化 AST
    pub source: String,      // 可编辑的原始简码
    pub slots: Vec<SlotId>,
    pub tags: Vec<String>,
}
```

- 从 LaTeX 导入页可以直接“保存为模板”，无需先插入编辑器再存片段；
- 从选区、当前槽、整行都能保存；
- 模板调用时插入 AST（或插入等价 source），并自动定位第一个空槽；
- 模板库有 schema version，支持迁移；
- 自定义格式用 `FormatId`，不使用裸单字母作为唯一标识；单字母只作为可选 UI 触发键，且经过保留键校验。

### 2.6 LaTeX 导入

导入拆成独立 crate：`mathslot-latex-import`。

管线：

```text
LaTeX text
  -> Lexer (commands, groups, scripts, environments, text)
  -> Recursive descent parser (documented subset)
  -> Expr AST
  -> ImportReport { lossless, warnings, unsupported }
  -> UI preview / replace / insert / save template
```

关键规则：

- `^` / `_` 解析为 `Script`，参数支持 `{...}`、单字符、命令；
- `\frac`、`\sqrt`、`\sum`、`\int`、`\lim` 等命令解析为对应节点；
- `\left...\right` 解析为 `Delimited`；
- `\begin{pmatrix}` 等环境解析为 `Matrix`；
- 不认识的命令 -> `RawLatex` 节点 + warning，不报错、不丢原文；
- **不做字符串重写，不做局部 `starts_with` 关系判断**。

`ImportReport`：

```rust
pub struct ImportReport {
    pub lossless: bool,
    pub unsupported: Vec<Diagnostic>,
    pub empty_slots: usize,
    pub raw_nodes: usize,
    pub roundtrip_latex: String,
    pub normalized_match: bool,
}
```

UI 行为：

- 无损：显示绿色“可安全替换”；
- 有损：黄色警告，列出原因，默认只允许“复制/插入”，替换需要确认；
- 空槽：提示具体槽位，不直接替换；
- 支持“保存为模板”。

### 2.7 导出

导出只有一个入口：

```rust
pub fn to_latex(expr: &Expr, options: &ExportOptions) -> String;
pub fn to_scheme_a(expr: &Expr, options: &ExportOptions) -> String;
```

- 基于 AST 和优先级，不重新解析文本；
- `Script` 输出 `{base}^{sup}` / `{base}_{sub}` / `{base}_{sub}^{sup}`；
- `Delimited` 输出精确的 `\left...\right` 或裸定界符；
- `Matrix` 输出 `\begin{env} ... \end{env}`；
- 用户原始 `RawLatex` 原样输出；
- 提供 `roundtrip` 测试：`parse(export(ast))` 与 `ast` 结构等价。

### 2.8 预览与错误

- 预览输入是 AST，不是“文本 + 二次解释”。
- 渲染后端只负责排版；导航高亮、槽位框、光标由**布局覆盖层**完成，不再把颜色/bbox 拼进 LaTeX。
- 预览区显示诊断：红色错误、黄色警告、空槽提示；错误不阻塞继续输入。
- 长公式、长 LaTeX 一律放进可滚动区域，弹窗有固定 `max_width/max_height`。

### 2.9 撤销、重做、IME

所有修改走事务：

```rust
pub struct Transaction {
    pub before: DocumentSnapshot,
    pub after: DocumentSnapshot,
    pub cursor_before: Cursor,
    pub cursor_after: Cursor,
    pub intent: EditIntent,
    pub label: String,
    pub timestamp: Instant,
}
```

- 文本输入、命令插入、括号配对、模板展开、导入替换都是事务；
- 事务可按 300–500ms 合并连续输入，但语义操作不合并；
- `Ctrl+Z` 永远能回到最近一次语义操作前；
- IME composition 期间不处理 Esc/Tab/Enter 快捷键，只接收 composition 事件；
- `Esc` 只在导航/弹窗中作为取消，不全局抢 IME 的 Esc。

---

## 3. 领域模型

### 3.1 无损 CST + 类型化 AST

建议采用 **CST 优先**，而不是“纯 AST 丢源码”：

```text
Source text
  -> Lexer tokens with spans
  -> Lossless CST (保留所有空白、括号、原始宏)
  -> Typed AST projection (语义节点)
```

理由：

- 编辑器必须能保留用户输入的空格、注释、原始 LaTeX；
- 结构化操作（脚本、括号、矩阵）需要 AST；
- 导入/导出需要精确 span 和原文回退；
- 无损 CST 可以做“格式化前后不丢字符”。

技术选择：

- `rowan`（rust-analyzer 使用的 lossless CST）或自研 green tree；
- `logos` 做 lexer；
- 手写递归下降/Pratt parser 做数学语法；
- 错误恢复：每个节点允许 `Raw`/`Error` 子节点，不因一个坏命令丢整棵树。

### 3.2 文档与槽位

```rust
pub struct Document {
    pub source: Arc<str>,
    pub cst: CstNode,
    pub expr: Arc<Expr>,
    pub slots: SlotTable,
    pub anchors: AnchorTable,
    pub version: u64,
}

pub struct Slot {
    pub id: SlotId,
    pub owner: NodeId,
    pub index: u16,
    pub role: SlotRole,
    pub span: Span,
    pub empty: bool,
}
```

不变量（必须由测试保证）：

1. 每个 `Slot` 的 `span` 在 `owner` 的 `span` 内；
2. `Slot` 的 `id` 在文档版本内唯一；
3. `Anchor` 的 `target` 是合法光标位置；
4. 解析失败时 `Document` 仍有可编辑的 CST 和错误节点；
5. `export(parse(source))` 对支持子集结构等价。

### 3.3 事务与偏移映射

编辑操作不能直接改 `source`。统一：

```rust
impl Editor {
    pub fn apply(&mut self, edit: Edit) -> Result<Transaction, Diagnostic>;
    pub fn undo(&mut self) -> Option<Transaction>;
    pub fn redo(&mut self) -> Option<Transaction>;
}
```

`Edit` 类型：

```rust
pub enum Edit {
    InsertText { at: Position, text: String },
    Delete { range: Span },
    Replace { range: Span, with: Expr },
    Wrap { range: Span, open: Delim, close: Delim },
    SetSlotCursor { slot: SlotId },
    InsertTemplate { template: TemplateId, at: Position },
}
```

每个事务保存 `before/after` 的 source + AST + cursor；撤销/重做直接恢复，不重新解释字符串。所有编辑器功能（括号、导航、模板、导入）只调用 `apply`。

---

## 4. 架构

### 4.1 Crate 分层

推荐：

```text
crates/
├── mathslot-syntax/        # lexer, CST, AST, parser, diagnostics
├── mathslot-doc/           # Document, Slot, Transaction, undo, selection
├── mathslot-nav/           # Anchor, NavState, history, 2D grid
├── mathslot-latex/         # import parser + export printer
├── mathslot-render/        # RenderBackend trait, layout, raster
├── mathslot-library/       # formats, templates, schema, migration
├── mathslot-core/          # facade: re-export + high-level session
├── mathslot-wasm/          # JSON bridge, no UI
└── src/                    # desktop app (eframe)
obsidian-mathslot/
├── src/plugin.js           # DOM UI + Obsidian API
└── scripts/build.mjs       # WASM bundle + smoke tests
```

依赖方向必须单向：

```text
syntax -> doc -> nav/latex/render/library -> core -> wasm/desktop
```

禁止：

- 导航依赖 UI；
- 导入器依赖桌面渲染；
- core 返回中文字符串给 UI；
- 插件自己实现一套键位语义。

### 4.2 数据流

```text
egui / Obsidian keydown
        │
        ▼
   Keymap -> Action
        │
        ▼
   Session::dispatch(Action)
        │
        ├── Editor::apply(Edit) -> Transaction
        ├── Nav::handle(NavAction)
        └── Library::mutate
        │
        ▼
   Document + NavState + Diagnostics
        │
        ├── Preview render job (debounced)
        ├── Navigation overlay
        └── JSON snapshot (WASM)
```

UI 不直接改 `Document`，只发送 Action；核心返回新快照/效果。这样可以：

- 统一撤销；
- 统一测试；
- 桌面/插件共享行为；
- 避免 `modals.rs` 直接改 `editor.library` 这类跨层写入。

### 4.3 命令与键位单一来源

```rust
pub struct Keymap {
    pub mode: Mode,
    pub bindings: Vec<Binding>,
}

pub struct Binding {
    pub sequence: KeySequence,
    pub action: Action,
    pub when: Condition,
    pub doc: &'static str,
}
```

- `Keymap` 由 core 导出 JSON，桌面端/插件/HELP 文档都消费同一份；
- 插件不写 regex 键位表，只把 DOM 事件转换为 `Key`；
- 导航模式、命令前导态、弹窗模式由 `Condition` 表示；
- 保留键在注册表校验：`j`、`k`、`t`、`a`、`;` 等控制键不允许用户格式占用。

### 4.4 渲染架构

```rust
pub trait RenderBackend {
    fn render(&self, expr: &Expr, options: &RenderOptions) -> Result<RenderOutput, Diagnostic>;
}

pub struct RenderOutput {
    pub image: Image,
    pub layout: LayoutTree, // node -> measured box
}
```

- 桌面端：`latex-rust` 渲染 canonical LaTeX；布局树用于槽位框、光标、导航锚点。
- Obsidian：MathJax 渲染 canonical LaTeX；导航高亮通过 AST 生成的覆盖层/DOM 测量，不把颜色拼进公式字符串。
- 预览与导航共用同一份 `layout`，不再每次按键渲染两份 PNG。
- 渲染任务 debounce 50ms；相同 AST hash 缓存；长文档只渲染可见区域/变更子树。

### 4.5 导入/导出边界

- `mathslot-latex` 只依赖 `syntax`，不依赖 UI/渲染。
- `latex_to_mathslot` 不再返回字符串；返回：

```rust
pub struct ConvertedFormula {
    pub expr: Expr,
    pub source: String,
    pub report: ImportReport,
}
```

- UI 的“校验反推”直接比较 `expr` 和 `report.roundtrip_latex`，而不是重新 parse 字符串；
- 导入失败时保留 `RawLatex`，不产生空槽。

---

## 5. 关键技术选择与取舍

| 领域 | 选择 | 理由 | 备选/取舍 |
| :--- | :--- | :--- | :--- |
| 语言 | Rust | 桌面/WASM 同源、性能、类型安全 | 继续 Rust |
| 桌面 UI | `eframe/egui 0.37` | 轻量、无 WebView、易做自定义绘制 | 换 Tauri 会引入 WebView，不选 |
| 解析 | 手写 recursive descent + `rowan` CST | 容错、保留源码、span 精确 | `chumsky` 可做，但 CST/增量不如 rowan |
| 词法 | `logos` | 快、明确 token | 手写也可，但维护成本高 |
| 增量 | 先全量解析 + 缓存；后续可接 salsa | 先控制复杂度 | 一开始上 salsa 过重 |
| 桌面渲染 | `latex-rust` 后端抽象 | 保持零 WebView、轻量 | 未来可换 Typst/RaTeX，接口不变 |
| Obsidian 渲染 | MathJax | 与 Obsidian 一致、移动端可用 | 不自己写 Web 渲染器 |
| WASM 桥 | 手写 JSON + 小 API | 无 serde 膨胀、体积可控 | 可用 serde-wasm-bindgen，但增体积 |
| 持久化 | JSON schema + version + migration | 用户可读、可回滚 | SQLite 过重 |
| 测试 | `insta` golden + `proptest` + `egui_kittest` | 覆盖文本/结构/UI | 只写单元测试不够 |
| 插件 | 原生 DOM + 共享 WASM | 无框架依赖、包体小 | 不引入 React/Vue |

**不建议的选择：**

- 继续用字符串重写器做 LaTeX 导入；
- 在 core 里返回中文状态字符串；
- 在 UI 里直接改 `source`/`library`；
- 用 `\bbox`/颜色拼接做导航高亮；
- 把 `^/_` 和 `▸u/▸d` 长期并存为两套可写语法。

---

## 6. 关键算法设计

### 6.1 脚本解析（最重要的正确性点）

解析器在解析一个 atom 后循环读取 `_` / `^`：

```text
parse_atom()
  -> base
  loop:
    if next == '_': sub = parse_script_arg()
    if next == '^': sup = parse_script_arg()
  if sub or sup: Script { base, sub, sup }
```

`parse_script_arg` 支持：

- `{ ... }`：解析完整子树；
- 单个字符；
- 单个命令（`\frac`、`\alpha` 等）；
- 嵌套脚本（如 `x^{a_i}`）。

输出统一为 `Script`，因此：

- `e^{-x^{2}}` -> `Script(base=e, sup=Script(base=x, sup=2))`（带负号节点）；
- `x^{a+b}` -> 指数是完整 Group；
- `a_{i+1}` -> 下标是完整 Group；
- `e^{-\frac{x}{2}}` -> 指数包含 Fraction 节点。

不再有 `latex_operand` 的“猜一个字符”逻辑。

### 6.2 导航锚点与标签

```text
Anchor 生成顺序：
1. ScopeStart [a]
2. 每个 Slot / Script / Delimited / MatrixCell
3. ScopeEnd [;]
```

标签规则：

- `a` 固定行首，`;` 固定行尾；
- `p/n` 保留给历史；
- `h/t` 不作为别名，避免吞掉真实标签；
- 括号用 `(`/`)` 专用键；
- 标签生成器保证前缀无关；
- 锚点数量 > 24 时使用双字母，但仍保证可输入；
- 每个锚点有 `AnchorId`，点击/测试/历史用 ID，字母只是显示。

### 6.3 括号作为节点

```text
parse_delimited(open):
  children = parse_until(close)
  Delimited { open, children, close }
```

自动配对是编辑事务，不是解析器行为：

- 输入 `(`：`Edit::InsertPair` 插入 `Delimited` 节点（或插入源码后立即解析成节点）；
- 输入 `)`：若当前光标在 `Delimited` 的 close 前，`Edit::MoveOver` 跳过；
- Backspace：若空 `Delimited`，`Edit::DeletePair` 删除整个节点；
- 选区包裹：`Edit::Wrap` 生成 `Delimited`。

### 6.4 矩阵

```text
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
  -> Matrix { env: Pmatrix, rows: [[a,b],[c,d]] }
```

- 行分隔 `\\`、列分隔 `&` 只在矩阵环境里生效；
- `&` 不会被文本转义成 `\&`；
- 导航锚点按 `MatrixCell { row, col }` 生成，`↑/↓` 保持列号，`←/→` 同行移动；
- 导出统一生成 `\begin{env}...\end{env}`。

### 6.5 事务与偏移映射

- 每个 `Edit` 产生 `EditDelta { old_len, new_len, common_prefix, common_suffix }`；
- 历史跳转位置、选区、锚点通过 delta 映射；
- 撤销栈保存完整快照（或持久化 AST + 版本），不依赖重新解析；
- 连续输入合并为单个 undo 事务（可配置 300ms）。

### 6.6 渲染与增量

```text
Document.version++
  -> debounce 50ms
  -> hash(expr, options)
  -> cache hit? reuse
  -> render(expr) -> Image + LayoutTree
  -> overlay(anchors, cursor) on top
```

- 导航高亮不改变公式 LaTeX；
- 光标/槽位框由 `LayoutTree` 定位；
- 预览和导航共用一次渲染；
- 插件端用 MathJax 的布局输出做 overlay，或用公式内 `\bbox` 但由专门的 overlay 模块生成，禁止散落在 `visual.rs`。

---

## 7. UI 设计

### 7.1 工作台

保留当前三段式，但解耦：

- 顶部：品牌、模式胶囊、命令按钮
- 左栏：
  - 预览（固定高度，可滚动/缩放）
  - 导航结构（可折叠、横向滚动锚点）
  - 输入 / 输出
- 右侧：结构提示面板（从命令注册表生成）
- 底部：状态 + 键位提示

### 7.2 弹窗

- 统一 `ModalState`，UI 只发 Action；
- 所有长文本代码框有 `max_width` + 横向滚动；
- “校验反推”默认折叠，使用 `Label::wrap()`；
- 导入页按钮：
  - `复制`
  - `替换`
  - `插入`
  - `保存为模板`
  - `保存为自定义格式`（可选）
- 有损/空槽时，替换按钮变黄/禁用并显示原因。

### 7.3 无障碍与 IME

- 输入框始终可聚焦；导航模式不抢走系统焦点；
- 删除 `CapsLock` 这类会改变系统状态的键；
- 所有快捷键有可见提示；
- IME composition 时不处理 Enter/Esc/Tab；
- 键盘焦点环和屏幕阅读器标签从注册表生成。

---

## 8. 性能预算

| 操作 | 目标 |
| :--- | :--- |
| 按键到文本更新 | < 16ms |
| 普通公式预览 | < 50ms |
| 长公式预览 | < 150ms，可取消 |
| LaTeX 导入（常见公式） | < 100ms |
| 导航锚点重算 | < 5ms |
| WASM 包体 | < 300KB（当前约 556KB，需优化） |
| 空闲 CPU | 接近 0，禁止无脑重绘 |

实现手段：

- 输入 debounce 50ms；
- AST hash 缓存；
- 只重新渲染变更子树；
- 预览和导航共享布局；
- 后台线程 + 可取消任务；
- 避免每次按键 `clone()` 整棵 AST。

---

## 9. 测试策略

### 9.1 语法/解析

- golden corpus：每个命令、脚本、括号、矩阵、嵌套结构；
- `proptest`：随机生成 AST -> export -> parse -> 结构等价；
- fuzz：任意 LaTeX 字符串不 panic、不丢字符；
- 错误恢复：坏命令后仍可编辑。

### 9.2 LaTeX 导入

固定回归矩阵：

| 输入 | 断言 |
| :--- | :--- |
| `e^{-x^{2}}` | roundtrip 保持 `e^{-x^{2}}` |
| `x^{a+b}` | 指数完整 |
| `a_{i+1}` | 下标完整 |
| `e^{-\frac{x}{2}}` | 指数含 Fraction |
| `\sum_{i=1}^{n} \left( a_i \right)` | 求和 body 非空 |
| `\int_a^b \left( f(x) \right) dx` | 积分 body 非空 |
| `\begin{pmatrix}...\end{pmatrix}` | Matrix 节点，`&` 不转义 |
| 未知宏 | RawLatex + warning，不 panic |

### 9.3 UI

- `egui_kittest` 快照：导航模式、括号模式、导入弹窗长文本、错误状态；
- 键盘路径：`Tab j`、`Alt` 轻按 `j`、Esc 退出、IME 组合；
- 窗口尺寸：980×640、1240×820、长公式不撑宽。

### 9.4 插件

- Node WASM smoke test 覆盖：脚本、括号、矩阵、导入报告；
- 真实 Obsidian 手动回归：Esc、Tab j、Alt leader、IME、移动端；
- 插件包体/加载时间检查。

### 9.5 迁移期

- 新旧实现 **差分测试**：同一输入分别跑旧/新，比较 AST/LaTeX/导航锚点；
- 任何差异必须解释并加入 golden corpus；
- 在旧实现上保留 feature flag，出问题可切回。

---

## 10. 迁移路线（不要大爆炸重写）

完全从零重写风险很高；建议 **strangler + 新核心**：

### Phase 0：冻结与契约

- 冻结新功能；
- 建立 golden corpus（当前 29 个测试 + 导入案例 + UI 截图）；
- 记录现有行为作为基线。

### Phase 1：抽语法层

- 新建 `mathslot-syntax`，实现 lexer/CST/AST；
- 旧的 `parser.rs` 暂时保留；
- 用 corpus 做差分：旧 AST vs 新 AST。

### Phase 2：事务与文档

- 实现 `Document`、`Slot`、`Transaction`；
- 把括号、撤销、光标操作迁到事务；
- 旧 `StreamEditor` 作为兼容层。

### Phase 3：导航

- 新 `NavModel` 从 AST 生成；
- 新旧导航并存，差分锚点；
- 迁移 `Tab j`、`Alt j`、括号锚点。

### Phase 4：LaTeX 导入/导出

- 新导入 parser + report；
- 旧 `latex_to_mathslot` 只作为 fallback；
- 导入页改用 report/模板按钮。

### Phase 5：渲染与 UI

- 抽 `RenderBackend`；
- 预览/导航共享布局；
- 拆 `app.rs`/`modals.rs`；
- 去掉字符串状态提示。

### Phase 6：插件

- WASM 只暴露新 Session；
- 插件消费共享 Keymap；
- 真实 Obsidian 回归。

**每个阶段必须有：**

- 可独立回滚的 commit；
- 差分测试通过；
- 不改变用户可见行为的“无感迁移”优先；
- 不通过则不进入下一阶段。

---

## 11. 风险与取舍

| 风险 | 说明 | 缓解 |
| :--- | :--- | :--- |
| 重写成本 | 语法/CST/导入器工作量大 | 分阶段、旧实现兼容、差分测试 |
| CST 复杂度 | 需要处理空白/原始宏 | 只在编辑器边界使用；AST 视图简单 |
| 渲染后端限制 | latex-rust 不支持部分宏 | 抽象后端 + RawLatex fallback |
| WASM 体积 | 新解析器可能增大 | 只编译 core；不引入重依赖；目标 <300KB |
| 导航标签稳定性 | 编辑后标签会变 | 用 AnchorId 点击/测试；标签仅显示 |
| 模板/格式迁移 | 旧 library.json 兼容 | schema version + migration + 默认库 |
| 性能 | 全量解析/渲染 | debounce + hash 缓存 + 增量渲染 |
| 双端一致性 | 插件 DOM 与桌面 egui 不同 | 共享 Action/Keymap/状态 JSON |

---

## 12. 建议目录结构

```text
mathslot/
├── crates/
│   ├── mathslot-syntax/
│   │   ├── lexer.rs
│   │   ├── cst.rs
│   │   ├── ast.rs
│   │   ├── parser.rs
│   │   └── diagnostics.rs
│   ├── mathslot-doc/
│   │   ├── document.rs
│   │   ├── transaction.rs
│   │   ├── selection.rs
│   │   └── undo.rs
│   ├── mathslot-nav/
│   │   ├── anchor.rs
│   │   ├── state.rs
│   │   └── labels.rs
│   ├── mathslot-latex/
│   │   ├── import.rs
│   │   ├── export.rs
│   │   ├── report.rs
│   │   └── environments.rs
│   ├── mathslot-render/
│   │   ├── backend.rs
│   │   ├── layout.rs
│   │   └── overlay.rs
│   ├── mathslot-library/
│   │   ├── formats.rs
│   │   ├── templates.rs
│   │   └── schema.rs
│   └── mathslot-wasm/
├── src/                    # desktop
└── obsidian-mathslot/      # plugin
```

---

## 13. 验收标准

重构版本达到以下条件才算完成：

1. `e^{-x^{2}}`、`x^{a+b}`、`a_{i+1}`、`e^{-\frac{x}{2}}` 全部无损往返；
2. `\sum/\int` 后接 `\left(...\right)` 不再产生空槽；
3. `pmatrix/bmatrix/vmatrix` 正确转为矩阵节点；
4. 导入有损时 UI 明确警告，不静默替换；
5. 导入页可直接保存为模板；
6. 桌面端与 Obsidian 的导航行为完全一致；
7. 无 `CapsLock`、无文本内嵌 `▸j` 控制、无三套键位表；
8. 按键 < 16ms，普通预览 < 50ms；
9. 所有 golden corpus + property/fuzz + UI 测试通过；
10. 旧 `library.json` 可迁移，旧公式可打开。

---

## 14. 结论

当前项目不是“代码写得不够努力”，而是原型阶段的几个选择在功能增长后变成了系统性负担：

- 文本约定承担了语义；
- AST 只是文本的副产物；
- 导入器是字符串替换；
- 键位/UI/领域状态没有边界；
- 渲染和导航各自猜结构。

从零开始不一定要推翻产品方向；**需要推翻的是“文本推断语义”的实现方式**。以 lossless CST + 类型化 AST + 事务 + 单一命令/键位注册表 + 结构化 LaTeX 导入为中心，MathSlot 可以保留现在的轻量和键盘流体验，同时把后续功能成本降下来。

建议先做 Phase 0–2（语法、文档、事务），不要一开始重写渲染和 UI；等结构层稳定后，导入器、导航、渲染会自然变简单。

---
id: AUD-13
round: 13
gate: G2
scope: [T2.1, INV-001, INV-002, INV-006, INV-008, INV-016, A-EDIT-001, A-EDIT-002, A-EDIT-003, A-EDIT-004, A-EDIT-005, A-EDIT-006, A-EDIT-007, A-EDIT-008]
verdict: BLOCK
auditor: auditor
date: 2026-11-13
---

# MathSlot 独立审计报告 (AUD-13)

- **审计角色**：auditor（独立只读审计员，严守 AGENTS.md 与只读规则，绝不修改产品代码、测试、配置或脚本）
- **工作目录**：`/home/mat/Projects/mathslot-next`
- **当前分支**：`refactor/v1` (HEAD: `4b69d1b`)
- **审计目标**：针对 Gate G2 核心任务 `T2.1`（实现 `mathslot-app` 状态机：Event→Command→Effect，无 UI/IO 依赖，A-EDIT 全过）执行前置架构与实现路径独立只读审计。
- **综合裁定**：**BLOCK**（当前处于任务 T2.1 开工前的前置审计阶段；`crates/mathslot-app` 尚未创建；依循规范 §14 Gate G2 退出条件与 AGENTS.md 规则 3/4，在 ADR-0016 决策批准且完成实现与独立验收前，门禁判定维持 BLOCK。当前状态定性为 **READY_FOR_DECISION**，建议 coordinator 批准 ADR-0016 并派发 implementer 实现落地）。

---

## 1. 判定摘要

| 缺陷 / 任务 / 约束 ID | 级别 | 简述 | 当前判定 | 证据章节 |
|:---:|:---:|:---|:---:|:---:|
| **T2.1** | 任务 (G2) | 实现 `mathslot-app` 状态机 (Event→Command→Effect，无 UI/IO 依赖，A-EDIT 全过) | **待实现 (OPEN)** | §2, §3, §4, §5 |
| **D-001** | P1 (功能) | 调色板 5 张卡片简码与 catalog/command.rs 不一致 | **FIXED** (已闭环) | 门禁 `test_p1_d001` (exit 0) |
| **D-002** | P1 (文档) | 文档 HELP/README 简码与命令实现漂移 | **FIXED** (已闭环) | 门禁 `codegen_tests` (exit 0) |
| **D-004** | P1 (数据) | Pending/Unknown 命令导出复制静默丢失 | **FIXED** (已闭环) | 门禁 `test_p1_d004` (exit 0) |
| **D-003** | P1 (渲染) | 长公式预览两端裁切 (fit-to-width/超宽可滚动) | **OPEN** (按计划归属 T2.4) | `test_p1_d003` (合规 #[ignore]) |
| **D-005** | P1 (存储) | 配置读取/保存的数据安全 (原子写/损坏备份) | **OPEN** (按计划归属 T2.3) | `test_p1_d005` (合规 #[ignore]) |
| **D-006** | P1 (存储) | 用户公式 ID 秒级碰撞 (UUIDv7/ULID) | **OPEN** (按计划归属 T2.3) | `test_p1_d006` (合规 #[ignore]) |
| **D-007** | P1 (导入) | LaTeX 导入启发式丢结构 | **OPEN** (按计划归属 T4.1) | `test_p1_d007` (合规 #[ignore]) |
| **D-101** | P1 (测试) | 虚假测试防护（严禁读取源码文本作为断言） | **FIXED** (持续守护) | 真实结构体契约调用验证 |
| **D-102** | P2 (存储) | 临时文件名硬编码固定导致并发与多实例竞态 | **OPEN** (按计划归属 T2.3) | `modals.rs:1753` (harness 锁定) |
| **INV-001** | 硬不变量 | 全系统唯一 Parser + AST + LaTeX 生成器 | **保持达标** | G1 收口，单一新栈就绪 |
| **INV-002** | 硬不变量 | 任何输入节点不得在输出时静默消失 | **保持达标** | 显式占位符包装贯通 |
| **INV-006** | 硬不变量 | 命令/调色板/文档/TS 类型单一事实源 | **保持达标** | 121 条命令全部源自 catalog |
| **INV-008** | 硬不变量 | 撤销与编辑操作严格按意图 (Intent) 分离与合并 | **核心要求** | T2.1/T2.2 状态机核心断言 |
| **INV-016** | 硬不变量 | 状态机必须具备无头 (headless) 可测试性 | **核心要求** | 绝对零 UI/IO 纯领域依赖 |

---

## 2. 规范要求与架构走查（规范 §5.1, §5.2, §6.1, §7.1, §7.2, §14 G2 / T2.1）

### 2.1 模块边界与架构拓扑

根据规范 §5.1 与 §5.2，Gate G2 的核心目标是构建跨端可复用的纯领域应用内核（app-core）。`mathslot-app` 在整个分层系统中的拓扑位置如下：

```text
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ apps/desktop (Tauri 2)      │      │ apps/obsidian (TS)          │
│ Svelte 5 + CodeMirror 6     │      │ Svelte 5 + CodeMirror 6     │
└──────────────┬──────────────┘      └──────────────┬──────────────┘
               │                                    │
               └────────────────┬───────────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │ packages/ui (shared Svelte)  │
                 │ editor / palette / preview   │
                 └──────────────┬───────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │ mathslot-app (Rust)          │
                 │ Event → Command → Effect     │
                 │ 纯领域状态机 / 无 UI / 无 IO   │
                 └──────────────┬───────────────┘
        ┌───────────────┬───────┴────────┬────────────────┐
        ▼               ▼                ▼                ▼
 mathslot-doc    mathslot-syntax   mathslot-command   mathslot-latex
 transactions    lexer/parser/     catalog (121)      import/export
 undo/slots/edit AST/diagnostics   generated data     round-trip
```

### 2.2 绝对无 UI / 无 IO 纯领域约束走查

规范 §5.2、§5.3 对 `mathslot-app` 提出了强硬的架构红线：

1. **绝对无 UI 依赖**：
   - 严禁直接或间接引入 `egui`、`eframe`、`tiny-skia`、`glow` 等桌面图形渲染库；
   - 严禁直接引入 `web-sys`、`js-sys` 等浏览器 DOM 类型（浏览器/Obsidian 绑定属于 `mathslot-wasm` 的职责）；
   - 公开 API 中不得泄露任何具体前端控件或布局类型。
2. **绝对无直接 IO 依赖**：
   - 严禁在 `mathslot-app` 内直接执行 `std::fs` 文件写入、读取或配置序列化（持久化职责由 `mathslot-store` 及其 Trait 承担）；
   - 严禁调用 `std::net`、发起网络请求或创建系统级长驻线程；
   - 严禁直接读取系统剪贴板（剪贴板访问属于平台宿主壳层的 Effect 解释器职责）。
3. **100% 无头（Headless）可测试性**：
   - 状态机的所有输入均为纯数据事件 `AppEvent`；
   - 状态机的所有输出均为纯数据副作用 `Vec<Effect>`；
   - 给定相同的初始状态与事件序列，状态转移与产生的副作用序列必须绝对确定，且在无 GUI、无文件系统环境下的单测中毫秒级跑通。

### 2.3 依赖关系与依赖白名单

`crates/mathslot-app/Cargo.toml` 允许且仅允许依赖：
- `mathslot-doc`：持有 `Document`、`Cursor`、`UndoStack`、`Transaction`、`Intent`、`Edit`、`Editor`；
- `mathslot-syntax`：AST 表达式、`SlotId`、`SlotRole`、`Diagnostic`、`Severity`；
- `mathslot-command`：权威命令元数据、`GENERATED_COMMANDS`、`find_by_id`、`find_by_keys`；
- `mathslot-latex`：LaTeX 双向转换契约与辅助结构；
- `serde` (features = ["derive"])：支持状态与事件序列化；
- `thiserror`：强类型错误表达。

任何超出上述白名单的依赖引入均应被门禁直接拦截。

---

## 3. 编辑状态机与事件-命令-副作用设计

### 3.1 显式状态机枚举 `EditorState` (§7.1)

规范 §7.1 明确禁止继续采用旧栈基于“source 形状 + 光标字符偏移 + 文本 diff”猜测编辑模式的脆弱做法，状态必须显式建模：

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EditorState {
    /// 默认常规文本/公式编辑状态
    Idle,
    /// 已输入前缀引导符 ▸，等待命令首键（如 f, r, m, o 等）
    PrefixRoot,
    /// 已输入多键命令前缀（如 ▸m 矩阵族、▸o 符号算子族）
    PrefixSub { prefix: String },
    /// 槽位直接跳转输入态（如 ▸j...）
    Jump { tail: String },
    /// 槽位只读拓扑导航态（Vim 风格 j,k,h,l 移动，不产生文本与撤销）
    Nav,
    /// 输入了无效或未注册前缀（产生 UnknownCommand 诊断，不静默退化）
    InvalidPrefix { raw: String },
}
```

#### 状态转移全景矩阵

| 当前状态 | 输入事件 | 迁移目标状态 | 文本与文档变更 | Undo 意图分类 | 伴随 Effect |
|---|---|---|---|---|---|
| `Idle` | `Key('▸')` | `PrefixRoot` | 文档暂无实际节点变更 | 无 | `Render` (预览占位符 `\text{▸}`) |
| `PrefixRoot` | 字母 `f` (单键 2 槽位) | `Idle` (进入参数捕获) | 展开结构或进入槽位 | `Intent::Command` | `Render`, `Focus` |
| `PrefixRoot` | 字母 `m` (双键前缀) | `PrefixSub { "m" }` | 保持前缀捕获 | 无 | `Render` (占位符 `\text{▸m}`), `Status` |
| `PrefixSub` | 字母 `b` (完成 `mb`) | `Idle` | 插入 bmatrix 环境 | `Intent::Command` | `Render`, `Focus` |
| `PrefixSub` | `Escape` / `Backspace` | `Idle` | 清除未决前缀 | 无 | `Render` (恢复原状), `Status` |
| `Idle` | `NavToggle(true)` | `Nav` | 文本绝对不修改 | 无 (不进撤销栈) | `Focus`, `Status("进入导航模式")` |
| `Nav` | 字母 `j`/`k`/`h`/`l` | `Nav` | 光标槽位移动，文本不改 | 无 (不进撤销栈) | `Focus(SlotId)` |
| `Nav` | `NavToggle(false)` / `Esc`| `Idle` | 退出导航，恢复可写 | 无 | `Status("退出导航模式")` |
| 任意状态 | `PasteText(s)` | `Idle` | 插入纯字面量（哪怕含 `▸`） | `Intent::Paste` | `Render`, `Focus` |
| `PrefixRoot` | 字母 `z` (未知前缀) | `InvalidPrefix { "▸z" }` | 记录未知占位与诊断 | 无 | `Render`, `Status(Error)` |

### 3.2 核心输入事件 `AppEvent`

`mathslot-app` 对外部环境暴露的统一事件契约：

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppEvent {
    /// 字符按键输入（包括流式引导符 '▸'、参数分号 ';'、常规字符）
    Key(char),
    /// 编辑器动作（退格、删除、回车、Tab 跳转槽位等）
    Action(EditorAction),
    /// 剪贴板粘贴纯文本（安全纯文本字面量注入）
    PasteText(String),
    /// 调色板/卡片点击插入命令（指定 command_id，如 "partial", "frac"）
    ApplyCard(String),
    /// 输入法 (IME) 组合文本更新（未上屏缓冲，隔离撤销栈）
    ImeComposition(String),
    /// 输入法 (IME) 上屏提交（单步事务落盘）
    ImeCommit(String),
    /// 显式导航命令（进入/退出导航、指定槽位移动）
    Navigate(NavAction),
    /// 撤销
    Undo,
    /// 重做
    Redo,
    /// 请求导出/复制 LaTeX（包含安全模式与严格模式）
    ExportRequested { strict: bool, copy_to_clipboard: bool },
    /// 清空文档
    Clear,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EditorAction {
    Backspace,
    Delete,
    TabNext,
    TabPrev,
    Escape,
    Enter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NavAction {
    EnterNav,
    ExitNav,
    NextSlot,
    PrevSlot,
    StepLeft,
    StepRight,
}
```

### 3.3 领域命令 `AppCommand` 派发逻辑

事件进入状态机后，首先经过纯函数转换或内部解析，映射为高内聚的原子领域命令（Domain Command），随后在文档模型上执行：

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppCommand {
    InsertText(String),
    InsertLiteral(String),
    DeleteBackward,
    ExpandCommand { command_id: String, params: Vec<String> },
    ApplyPaletteCard { command_id: String },
    MoveCursor(NavAction),
    UpdateImeBuffer(String),
    CommitIme(String),
    PerformUndo,
    PerformRedo,
    ExecuteExport { strict: bool, copy_to_clipboard: bool },
    ResetDocument,
}
```

### 3.4 纯副作用 `Effect` 与确定性顺序保证 (§6.1, §13)

根据规范 §6.1，状态机执行完命令后，向外部宿主（Tauri 桌面外壳、Obsidian 插件外壳或测试 Harness）派发有序的纯数据副作用列表 `Vec<Effect>`：

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Effect {
    /// 请求渲染当前 LaTeX / SVG
    Render(RenderRequest),
    /// 写入系统剪贴板请求
    Clipboard(String),
    /// 状态栏通知或提示消息
    Status(StatusMessage),
    /// 光标或槽位焦点变更请求
    Focus(FocusTarget),
    /// 导出结果通知（包含 LaTeX 字符串与诊断集合）
    ExportResult(ExportOutcome),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderRequest {
    pub request_id: u64,
    pub latex: String,
    pub has_diagnostics: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StatusMessage {
    pub severity: StatusSeverity,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StatusSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FocusTarget {
    Slot(mathslot_syntax::SlotId),
    End,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportOutcome {
    pub success: bool,
    pub latex: String,
    pub diagnostics: Vec<String>,
}
```

#### 副作用发射确定性排序规则 (INV-016)
在 `app.dispatch(event)` 中，Effect 的生成必须遵守确定顺序：
1. **状态更新**：若产生错误诊断或状态提示，优先发射 `Effect::Status`；
2. **文档重绘**：任何引起文档或光标变动的操作，必须发射 `Effect::Render`；
3. **焦点跟随**：若光标跨槽位迁移或处于新建槽位，紧接着发射 `Effect::Focus`；
4. **宿主交互**：导出或复制操作，最后发射 `Effect::ExportResult` 与 `Effect::Clipboard`。

测试用例可直接对返回的 `Vec<Effect>` 进行全量模式匹配与顺序断言。

---

## 4. 8 项 A-EDIT 场景在应用层状态机验证方案

在 Gate G1 中，8 项 A-EDIT 场景已在 `crates/mathslot-doc/tests/a_edit_acceptance_tests.rs` 进行了底层 Document / Editor 契约测试。在 Gate G2 T2.1 中，状态机作为统一核心，必须在 `crates/mathslot-app/tests/app_state_machine_tests.rs` 中通过无头事件循环再次 100% 验证这 8 项场景：

### 4.1 A-EDIT-001：分式流式输入
- **场景**：连续派发 `AppEvent::Key` 序列 `▸`, `f`, `1`, `;`, `2`, `;`。
- **状态转移**：`Idle` → `PrefixRoot` → (捕获 `f` 参数) → 参数 1 闭合 → 参数 2 闭合 → `Idle`。
- **状态机断言**：
  - 最终状态：`app.state() == EditorState::Idle`；
  - 导出文本：`app.to_latex() == r"\frac{1}{2}"`；
  - 诊断集合：`app.diagnostics().is_empty() == true`；
  - 副作用序列：最终发射包含 `\frac{1}{2}` 且 `has_diagnostics == false` 的 `Effect::Render`。

### 4.2 A-EDIT-002：未决命令复制/导出阻断与占位
- **场景**：派发 `AppEvent::Key` 序列 `▸`, `m`，随后派发 `AppEvent::ExportRequested { strict: true, copy_to_clipboard: true }`。
- **状态转移**：`Idle` → `PrefixRoot` → `PrefixSub { prefix: "m" }`。
- **状态机断言**：
  - 状态判断：`app.has_pending_command() == true`；
  - 诊断拦截：包含 `PendingCommand` 诊断；
  - 安全导出与剪贴板：输出必须非空，包含显式占位符 `\text{▸m}`，绝不返回空串；
  - 严格模式导出：`ExportResult.success == false`，阻断静默导出；
  - 副作用包含：`Effect::Status` 报告待补全前缀。

### 4.3 A-EDIT-003：未知命令诊断不静默退化
- **场景**：连续派发 `AppEvent::Key` 序列 `▸`, `z`, `z`。
- **状态转移**：`Idle` → `PrefixRoot` → `InvalidPrefix { raw: "▸zz" }`。
- **状态机断言**：
  - 输出防护：`app.to_latex() != "z"`（绝不静默退化为末尾普通字符）；
  - 占位显式性：输出包含显式占位 `\text{▸zz}`；
  - 诊断报告：`app.diagnostics()` 包含 `Severity::Error` 的 `UnknownCommand`；
  - 副作用报告：发射警告/错误级别的 `Effect::Status`。

### 4.4 A-EDIT-004：偏导卡片点击插入 \partial
- **场景**：派发 `AppEvent::ApplyCard("partial".to_string())`。
- **状态转移**：`Idle` → 执行卡片插入 → `Idle`。
- **状态机断言**：
  - 输出校验：`app.to_latex().contains(r"\partial") == true`；
  - 缺陷防护：`app.to_latex().contains(r"\to") == false`（彻底防御 D-001 历史退化）；
  - 意图标记：撤销栈事务意图为 `Intent::PaletteCard`；
  - 副作用：发射 `Effect::Render`。

### 4.5 A-EDIT-005：点击卡片后紧接输入，Ctrl+Z 撤销分步不合并
- **场景**：
  1. 派发 `AppEvent::ApplyCard("partial")`；
  2. 派发 `AppEvent::Key('x')`；
  3. 派发 `AppEvent::Undo`；
  4. 派发 `AppEvent::Undo`。
- **状态转移与撤销栈断言**：
  - 步骤 1 后：撤销栈深度为 1，栈顶意图为 `Intent::PaletteCard`；
  - 步骤 2 后：撤销栈深度为 2，栈顶意图为 `Intent::Typing`；两步绝对不发生合并；
  - 步骤 3 (首次 Undo) 后：仅撤销字符 'x'，公式保留 `\partial`，撤销栈深度为 1；
  - 步骤 4 (二次 Undo) 后：撤销卡片 `\partial`，公式恢复为空，撤销栈深度为 0。

### 4.6 A-EDIT-006：粘贴含 ▸ 文本作为纯文本字面量
- **场景**：派发 `AppEvent::PasteText("▸f1;2;".to_string())`。
- **状态转移**：`Idle` → 原样插入 → `Idle`。
- **状态机断言**：
  - 语义隔离：绝不触发流式展开，`app.to_latex() != r"\frac{1}{2}"`；
  - 原样保留：输出包含字面量 `▸f1;2;`（或转义的 `\text{▸f1;2;}`）；
  - 状态保持：`app.state() == EditorState::Idle`；
  - 意图记录：撤销栈事务意图标记为 `Intent::Paste`。

### 4.7 A-EDIT-007：IME 组合状态隔离
- **场景**：
  1. 派发 `AppEvent::ImeComposition("zhong")`；
  2. 派发 `AppEvent::ImeComposition("zhongwen")`；
  3. 派发 `AppEvent::ImeCommit("中文")`；
  4. 派发 `AppEvent::Undo`。
- **状态转移与隔离断言**：
  - 步骤 1 与 2 中：`app.is_composing() == true`；撤销栈长度始终为 0（组合输入绝不污染撤销栈）；
  - 步骤 3 后：`app.is_composing() == false`；撤销栈长度精准增加 1（产生唯一的 `Intent::ImeCommit` 事务）；文档包含 "中文"；
  - 步骤 4 后：整体撤销上屏的 "中文"，文档变空。

### 4.8 A-EDIT-008：导航模式按字母光标跳转，文本与 undo 不变
- **场景**：
  1. 初始化包含 `\frac{a}{b}` 的文档；
  2. 派发 `AppEvent::Navigate(NavAction::EnterNav)`；
  3. 派发 `AppEvent::Key('j')`（跳至下一个槽位/分母）；
  4. 派发 `AppEvent::Key('k')`（跳回上一个槽位/分子）；
  5. 派发 `AppEvent::Key('z')`（非导航键）；
  6. 派发 `AppEvent::Navigate(NavAction::ExitNav)`；
  7. 派发 `AppEvent::Key('x')`。
- **状态转移与纯读断言**：
  - 步骤 2 后：`app.state() == EditorState::Nav`；
  - 步骤 3 后：光标发生槽位迁移（产生 `Effect::Focus(denominator)`）；文档文本绝对未变；撤销栈深度为 0；
  - 步骤 4 后：光标返回分子；文本与撤销栈绝对未变；
  - 步骤 5 后：非导航按键被静默吸收或无操作，不插入字符 'z'；
  - 步骤 6 后：`app.state() == EditorState::Idle`；
  - 步骤 7 后：恢复常规键入，文档变动，撤销栈深度增加 1。

---

## 5. 实现路径与目录结构建议（供 ADR-0016 决策参考）

### 5.1 `crates/mathslot-app/` 目录组织规范

建议在实施阶段建立如下目录拓扑：

```text
crates/mathslot-app/
├── Cargo.toml
├── src/
│   ├── lib.rs            # 统一对外导出 App, AppEvent, AppCommand, Effect, EditorState
│   ├── app.rs            # App 结构体与 dispatch(&mut self, event: AppEvent) -> Vec<Effect>
│   ├── state.rs          # EditorState 显式状态枚举与状态转换辅助方法
│   ├── event.rs          # AppEvent, EditorAction, NavAction 等事件类型定义
│   ├── command.rs        # AppCommand 领域命令枚举与分发
│   └── effect.rs         # Effect, RenderRequest, StatusMessage, FocusTarget, ExportOutcome
└── tests/
    └── app_state_machine_tests.rs # 覆盖全部 8 项 A-EDIT 场景与 Effect 确定性断言
```

### 5.2 根 `Cargo.toml` 工作区纳管

在根目录 `Cargo.toml` 的 `[workspace.members]` 中新增 `"crates/mathslot-app"`：

```toml
[workspace]
members = [
    ".",
    "crates/mathslot-syntax",
    "crates/mathslot-doc",
    "crates/mathslot-latex",
    "crates/mathslot-core",
    "crates/mathslot-wasm",
    "crates/mathslot-command",
    "crates/mathslot-app",      # 新增 app-core 状态机
    "xtask",
]
```

### 5.3 架构内聚度与与 `mathslot-doc` 协作模式建议

在 T1.5 中，`crates/mathslot-doc/src/editor.rs` 已经封装了高层流式处理逻辑 `Editor`。为了遵循“单一事实源”与代码最小冗余原则（INV-001）：
- `mathslot-app::App` 内部组合 `mathslot_doc::Editor`，将 `Editor` 作为文档聚合根；
- `mathslot-app` 聚焦于顶层应用状态（`EditorState` 迁移、`AppEvent` 映射为 `AppCommand`、收集并派发有序的 `Vec<Effect>`）；
- 宿主壳层（Desktop / WASM）仅与 `mathslot-app::App` 对接，彻底隔绝底层 `Document` / `Transaction` 的直接操作。

---

## 6. 历史结论抽查

依据 SKILL.md 要求，从历史验证与审计签署中随机抽取 2 项“已修复/已通过”声明，以代码与真实测试命令进行严格复核：

### 抽查项 1：T1.7 双跑对比测试套件真实性复核
- **来源声明**：`agent-state/verify/GATE-G1.md` 第 12-16 行声明：“T1.7 旧/新双跑 parity harness 4 项高阶测试全部真实通过，新旧栈核心行为 100% 对齐”。
- **实测验证**：
  - 执行命令：`cargo test -p mathslot-doc --test parity_harness_tests`
  - 退出代码：`0`
  - 尾部输出：
    ```text
    running 4 tests
    test test_parity_slot_navigation_order ... ok
    test test_parity_latex_export_with_known_deltas ... ok
    test test_parity_matrix_and_delimiter_structures ... ok
    test test_parity_commands_template_expansion ... ok

    test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
    ```
- **复核结论**：**FIXED (声明完全属实)**。测试真实调用了新旧双栈 API，结构体比对与 LaTeX 映射完全吻合。

### 抽查项 2：D-004 未决与未知命令导出占位修复复核
- **来源声明**：`agent-state/decisions/ADR-0014-diagnostic-pipeline-and-fix-d004-t1.6.md` 声明：“D-004 已闭环，`test_p1_d004` 移除 `#[ignore]` 并持续原生运行通过”。
- **实测验证**：
  - 执行命令：`cargo test -p mathslot-core --test p1_regression_tests test_p1_d004`
  - 退出代码：`0`
  - 尾部输出：
    ```text
    running 1 test
    test test_p1_d004_pending_and_unknown_commands_never_silently_disappear ... ok

    test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
    ```
- **复核结论**：**FIXED (声明完全属实)**。回归测试已常态纳入测试套件，有效防御静默丢占位缺陷。

---

## 7. 门禁检查与静默失败专项审计

### 7.1 门禁基线检查命令实测

```bash
scripts/agent/acceptance.sh --fast
```
- **退出代码**：`0`
- **输出截取**：
  ```text
  == MathSlot 门禁（/home/mat/Projects/mathslot-next）==
  结果 检查项                    说明
  ------ ---------------------------- ----
  PASS   cargo fmt --check            exit 0
  WARN   cargo clippy -D warnings     跳过（--fast）
  PASS   cargo test --workspace       exit 0
  PASS   调色板一致性           exit 0（gate=G2）
  WARN   let _ = 计数               27 处（G4 前应清零）
  WARN   unwrap() 计数              22 处（用户输入路径应为 0）
  WARN   命令表常量              3 处（G1 后应只剩 catalog）
  PASS   工作区干净              0 个未提交改动

  PASS=4 FAIL=0 WARN=4
  结论：PASS
  ```

完整 clippy 检查实测：
```bash
cargo clippy --workspace --all-targets -- -D warnings
```
- **退出代码**：`0`
- **输出截取**：
  ```text
      Finished `dev` profile [optimized + debuginfo] target(s) in 0.30s
  ```

全量测试检查实测：
```bash
cargo test --workspace
```
- **退出代码**：`0`（176 passed, 4 ignored, 0 failed）。

### 7.2 4 项未闭环 P1 回归测试防护复核

对目前处于 `#[ignore]` 状态的 4 项 P1 回归测试进行负向触发实测：
```bash
cargo test --workspace -- --ignored
```
- **退出代码**：`101`（真实 Panic 拦截现场）
- **拦截详情**：
  1. `test_p1_d003_fitted_size_strictly_respects_max_bounds`：`Fitted width 600 exceeds max_width 400`（锁定 D-003，待 T2.4 修复）；
  2. `test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file`：`assertion left != right failed: Corrupted configuration must not silently degrade to default_seeded library`（锁定 D-005，待 T2.3 修复）；
  3. `test_p1_d006_formula_id_millisecond_concurrency_no_collision`（锁定 D-006，待 T2.3 修复）；
  4. `test_p1_d007_latex_import_lossless_roundtrip_preserves_all_structural_nodes`（锁定 D-007，待 T4.1 修复）。

实测确认所有未闭环 P1 缺陷均被真实测试严密锁定，未发生测试删除或假绿现象（无 D-101 假测试）。

---

## 8. 审计结论与下一步建议

1. **审计结论**：
   - 架构契约与设计方案完全符合规范 §5.1, §5.2, §6.1, §7.1, §7.2 与 §14 G2 / T2.1 要求；
   - 纯领域状态机与无 UI/IO 约束清晰明确，具备 100% 无头可测试性；
   - 8 项 A-EDIT 场景在应用状态机层面的断言链条与 Effect 确定性顺序已经系统规划，可直接指导实施与验收；
   - 裁定状态：**BLOCK (READY_FOR_DECISION)**。

2. **下一步建议（供 Coordinator 决策）**：
   - Coordinator 签署批准 `ADR-0016-mathslot-app-state-machine-t2.1.md`；
   - Implementer 按照 §5 规划创建 `crates/mathslot-app/`，编写失败契约测试并实现 Event→Command→Effect 状态机；
   - Verifier 独立跑通门禁与无头状态机单测，确认 A-EDIT 全绿后出具 `VER-13`。

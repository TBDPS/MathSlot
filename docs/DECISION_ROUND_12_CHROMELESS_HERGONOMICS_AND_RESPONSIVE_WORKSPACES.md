# MathSlot 架构决策方案 (Round 12: 废除顶栏全局释放空间 · 上下标语法统一与后向包裹 · 响应式工作台)

- **决策版本**：DECISION-ROUND-12-CHROMELESS-HERGONOMICS-AND-RESPONSIVE-WORKSPACES
- **决策专家**：Decision Maker Agent (系统总架构师与产品决策专家)
- **依据输入**：
  1. 美术 UI 设计师《MathSlot 现代数字产品美术 UI/UX 深度重构设计蓝图与技术规约》
  2. 用户针对 Round 11 提出的 4 项核心优化诉求与人体工程学心流反馈
- **指派对象**：Implementer Agent (系统实现专家)
- **决策结论**：**【全面正式签署并批准实施 (APPROVED & SIGNED)】**
- **目标交付物**：
  1. **彻底移除全局 Top Bar**：废除 `egui::Panel::top("mathslot-top-panel")`，释放 48pt 纵向高度；品牌与核心操作收纳至左翼面板顶部（Left Wing Header，高度 36pt）；
  2. **统一上下标语法与后向智能包裹**：
     - 纠正预置库中所有错误的 `G▸d...`，规范为双槽简码 `▸d G;▸gm ▸gn;; + ▸gL ▸d g;▸gm ▸gn;; = ▸f8 ▸gp G;c^4; ▸d T;▸gm ▸gn;;`；
     - 明确后缀算子（`^`、`_`）与结构命令流（`▸u`、`▸d`、`▸b`）语法边界；
     - 在 `editor.rs` 中实施“主体后向智能包裹 (Backward Body Wrap)”：`x` + `Tab d` -> `▸d x;|`，光标直达下标槽；
  3. **修复公式库宽度缩放挤压崩溃**：重构为两行式响应式工具栏与双层流式卡片，主副操作分离，彻底消除极窄视口碰撞；
  4. **修复自定义格式与模版表单纵向截断与天涯海角**：表单全面移入一体化 `ScrollArea`，紧凑行距，保存按钮内敛聚合于右下角；
  5. 自动化测试套件（119+ 项测试）全绿，全栈零编译警告与回归保证。

---

## 一、 决策背景与四项核心诉求深度剖析 (Architectural Context)

在 Round 11 中，MathSlot 成功确立了右侧 `CentralPanel` 一等公民内联工作区体系，彻底消除了历史遗留的模态浮窗（`egui::Window`）。然而在深入日常数学排版与公式探索实践中，用户与产品专家进一步指出了 4 处阻碍生产力与破坏现代设计质感的关键痛点：

### 痛点 1：全局 Top Bar 冗余占位与视口压缩
- **现状**：全局 `Panel::top("mathslot-top-panel")` 占据了 48pt 垂直高度。其内部包含的“公式库”、“格式库”、“LaTeX 导入”、“帮助”按钮，与右侧 `CentralPanel` 顶部的五联分段导航条 `workspace_tab_bar_ui` 功能完全重叠；
- **危害**：48pt 的全局死重挤压了主公式画板和工作区的可视高度，在笔记本屏幕或分屏模式下极易触发不必要的垂直滚动条。全面向现代专业生产力软件（如 Linear, Obsidian, VS Code）看齐已势在必行——取消全宽顶栏，实现视口顶部完全直达。

### 痛点 2：上下标语法认知混淆与心流中断
- **现状**：
  在预置库（`presets.rs`）中，爱因斯坦引力场方程被写为：
  `G▸d▸gm▸gn; + ▸gL g▸d▸gm▸gn; = ▸f8 ▸gp G;c^4; T▸d▸gm▸gn;`
  这与 MathSlot 核心语法契约产生了致命背离：`▸d` 是双槽结构命令（`&["主体", "下标"]`），上述写法导致 `G` 游离在外，而槽位 1 被误当成 `▸gm▸gn`，槽位 2 遗失。
- **人体工程学断裂**：用户打字习惯通常是先输入变量 `G` 或 `x`，随后意识到需要下标，本能敲下 `Tab d`。然而此前系统直接插入 `▸d` 变成 `x▸d`，强制要求用户回退光标或重输，打断了心流。

### 痛点 3：公式库宽度缩放时的挤压崩溃
- **现状**：
  公式库顶栏采用单行不换行 `ui.horizontal`，塞入搜索框、清空、新建、恢复默认、导出 JSON、导入 JSON 六大控件。当用户拖拽左栏加宽或缩小应用窗口时，顶栏按钮发生重叠碰撞甚至被截断出视口；卡片首行将标题与 5 个按钮放在同一行，在极窄视口下直接挤压碰撞。

### 痛点 4：扩展中心表单垂直截断与横向天涯海角
- **现状**：
  自定义格式（`Tab k`）和片段模版（`Tab t`）的新建/编辑表单直接暴露在 `ScrollArea` 外侧。表单展开后占据 200pt+ 空间，在窗口高度较矮时直接被屏幕底部截断，导致用户**看不见也点不到保存按钮**；同时表单强行拉满整宽，保存按钮位于屏幕最右侧，与左侧输入项相距数百像素（“天涯海角”），视线与手势动线极度疲劳。

---

## 二、 架构决策与实施指令 (Architectural Decrees & Implementation Directives)

```
+----------------------------------------------------------------------------------------------------+
|  [CHROMELESS TOP: 窗口顶栏彻底移除，释放 48pt 纯净垂直视口]                                          |
+-----------------------------------------------------+----------------------------------------------+
|  LEFT WING: 核心公式画板与输入流 (380~560pt 常驻)     |  RIGHT WING: 一等公民内联工作区 (CentralPanel 通栏) |
|                                                     |                                              |
|  [LEFT WING HEADER (高度 36pt)]                     |  [ 5-Tab 分段导航胶囊栏 (高度 38pt) ]          |
|  - Brand Logo + "MathSlot" + 状态胶囊                |  [ ∑ 符号结构 | 📚 公式库 | ⚙ 扩展中心 | ... ]|
|  - 撤销 ↶ / 重做 ↷ / 槽位直达 [Tab j] / 范例 ↻ / 清空 |  ------------------------------------------  |
|  -------------------------------------------------  |                                              |
|  [框 1] 纯白白纸公式画布 (Paper Preview Box)        |  ACTIVE WORKSPACE CONTENT (自适应 100% 铺满): |
|  [框 2] 槽位层级导航框 (Nav Structure Box)          |  - 响应式双行工具栏 (搜索+新建 / 筛选+维护)   |
|  [框 3] 极简流输入与输出框 (Input & Output Box)      |  - 双层流式公式卡片 (信息+主动作 / 载荷+副动作)|
|                                                     |  - 一体化 ScrollArea 内嵌表单 (零截断+右下聚合)|
+-----------------------------------------------------+----------------------------------------------+
|  STATUS BAR: 状态反馈信息、语法诊断提示与快捷键信号微文案                                             |
+----------------------------------------------------------------------------------------------------+
```

---

### 指令 1：彻底移除全局 Top Bar，建立左翼 Header 控制台 (Left Wing Header)

#### 1.1 裁决规范
1. **废除 `egui::Panel::top("mathslot-top-panel")`**：
   在 [`src/app.rs`](file:///home/mat/Projects/mathslot-next/src/app.rs) 的 `eframe::App::ui` 中，完全删除 `Panel::top` 及其闭包调用。释放出的 48pt 高度自然归还给 Left Panel 与 CentralPanel，使窗口呈现现代无顶栏（Chromeless）设计。
2. **构建左翼面板顶部控制栏 (Left Wing Header)**：
   在 `left_panel_ui`（或 `Panel::left` 内部的最顶部，位于 `ScrollArea` 外侧或最上方），构建紧凑高质感的左翼控制台（固定高度 36pt）：
   - **左部**：
     - `brand_mark(ui)`（品牌微标，6 条竖线几何光泽）；
     - `ui.label(RichText::new("MathSlot").size(15.0).strong().color(TEXT))`；
     - 模式状态胶囊 `status_pill(ui, &mode_text, mode_color)`。
   - **右部 (右对齐 Layout::right_to_left)**：
     - `清空` 按钮（可撤销）；
     - `↻ 换一个` 范例轮换按钮（带悬浮提示当前范例学科与名称）；
     - `槽位直达 [Tab j]`（或在导航态时高亮为 `退出直达`）；
     - 撤销 `↶` (Ctrl+Z) 与 重做 `↷` (Ctrl+Y) 快速动作图标。
3. **消除冗余按钮**：
   原 Top Bar 中的“帮助”、“公式库”、“格式库”、“⇄ 导入 LaTeX”在右侧 CentralPanel 的 5-Tab 胶囊栏已有完全对等且更清晰的一级入口，顶栏冗余彻底清除。全局快捷键（F1~F4, Alt+1~5）继续全局响应。

---

### 指令 2：统一上下标语法标准，实施“主体后向智能包裹”

#### 2.1 上下标双轨标准规范
- **直输后缀算子 (Inline Postfix Operator)**：
  - `^` 与 `_`：例如 `x^2`, `a_k`, `x_{i+1}`，无需加前缀符 `▸`。
- **结构命令流 (Structural Command Stream)**：
  - `▸u 底数;指数;`（双槽：槽位 1 为底数，槽位 2 为指数）；
  - `▸d 主体;下标;`（双槽：槽位 1 为主体，槽位 2 为下标）；
  - `▸b 主体;下标;上标;`（三槽：槽位 1 为主体，槽位 2 为下标，槽位 3 为上标）。

#### 2.2 修复预置公式库 (`presets.rs`)
在 [`crates/mathslot-core/src/presets.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/presets.rs) 中，全面审查并替换所有旧版单槽偏置错误：
1. **爱因斯坦引力场方程**（原行 563）：
   - 原错误：`source: "G▸d▸gm▸gn; + ▸gL g▸d▸gm▸gn; = ▸f8 ▸gp G;c^4; T▸d▸gm▸gn;"`
   - **纠正为规范双槽**：
     ```rust
     source: "▸d G;▸gm ▸gn;; + ▸gL ▸d g;▸gm ▸gn;; = ▸f8 ▸gp G;c^4; ▸d T;▸gm ▸gn;;",
     ```
2. **测地线方程**（原行 569）：
   - 原错误：`▸f d^2 x▸u▸gm;;d▸gu^2;; + ▸gC▸u▸gm;▸d▸ga▸gb; ...`
   - **纠正**：`▸f d^2 ▸u x;▸gm;;;d▸gu^2;; + ▸b ▸gC;▸ga▸gb;▸gm;; ...`（确保 `x` 在 `▸u` 内部或使用 `x^▸gm`）。
3. **电磁场强张量方程**（原行 575）：
   - 原错误：`F = dA = ▸f1;2; F▸d▸gm▸gn;; dx▸u▸gm; ▸qg dx▸u▸gn;`
   - **纠正**：`F = dA = ▸f1;2; ▸d F;▸gm ▸gn;; ▸u dx;▸gm;; ▸qg ▸u dx;▸gn;;`。

#### 2.3 在 `editor.rs` 中实施“主体后向智能包裹 (Backward Body Wrap)”
在 [`crates/mathslot-core/src/editor.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/editor.rs) 的 `sync_after_edit` 或专属后向包裹管线中实施：
1. **触发时机**：
   当用户在光标处输入触发了 `▸d`（下标）或 `▸u`（上标）时（通过键入 `Tab d` / `Tab u` 或卡片点选）：
2. **前置原子检测 (Preceding Atom Inspection)**：
   检查紧邻光标左侧（`end - 2` 之前）的文本序列：
   - 若前一个字符为合法的变量或数字（如 `[a-zA-Z0-9]`，例如 `x`, `G`, `2`）；
   - 或前一个结构为希腊字母 / 常用符号（如 `▸gm`, `▸ga`, `▸gp` 等以 `▸` 开头的完整简码）；
   - 或前一个结构为闭合的括号表达式（如 `(...)`, `[...]`）；
3. **自动包裹重组与光标落位**：
   - 将该前置原子从原位置移入 `▸d`（或 `▸u`）的第 1 槽位；
   - 产生标准流式语法：`▸d <Atom>;`（或 `▸u <Atom>;`）；
   - 光标精准置于分号 `;` 之后（即槽位 2 的起始位置）；
   - 自动在 Undo 栈中记录此变换，按 `Ctrl+Z` 即可精准还原为原始分离状态；
   - 给出微文案反馈：“已后向包裹变量为下标主体，输入下标后按 Enter / ; 结束”。

---

### 指令 3：公式库响应式两行工具栏与双层流式卡片

在 [`src/modals.rs`](file:///home/mat/Projects/mathslot-next/src/modals.rs) 的 `render_corpus_workspace` 中实施全面视觉工程重构：

#### 3.1 响应式两行工具栏 (Two-row Responsive Toolbar)
废除原单行无换行的 `ui.horizontal`，重构为两层功能分离的专业工具栏：
- **Row 1（检索与新建高频流）**：
  - 左侧：搜索图标/标签 `"检索:"` + 弹性宽度单行文本框（占满左侧可用空间减去 120pt）；
  - 附带右侧紧凑的 `✕ 清空` 快捷标签；
  - 右侧聚合：`+ 新建公式`（绿色强视觉按键，点击展开内联表单）。
- **Row 2（学科分类流与库维护工具）**：
  - 左侧：学科分类胶囊（使用 `ui.horizontal_wrapped`，包含“全部”、“高等数学/微积分”、“线性代数”、“大学物理”等，多标签自动换行，绝不溢出）；
  - 右侧（或末尾）：次级维护小按钮组 `[恢复默认]`、`[导出 JSON]`、`[导入 JSON]`（低饱和度，辅助功能）。

#### 3.2 双层流式公式卡片 (Dual-layer Flow Cards)
重构卡片内部排版，彻底分离“公式信息/主动作”与“源码载荷/副动作”：
- **卡片顶层 (Top Row)**：
  - 左侧：加粗标题 `formula.name`（13.5pt，白色） + 学科徽章 `[category]`（青色） + 自建标识；
  - 右侧：高频主操作双按钮：
    - `✓ 载入`（绿色加粗，高频替换编辑器内容并实时重绘）；
    - `+ 追加`（主色 Accent，追加到光标处）。
- **卡片中层 (Middle Row)**：
  - 学术背景/数学含义说明文本 `formula.desc`（浅灰 MUTED，单行截断或柔和多行展示）。
- **卡片底层 (Bottom Row)**：
  - 左侧：`简码流:` 前缀 + 等宽代码条 `formula.source`（CYAN 色，背景微填充）+ 标签 `#tag`；
  - 右侧：低频副操作小按钮组：`[复制 LaTeX]`、`[编辑]`、`[删除]`。
- **效果**：左右空间分离，垂直两层承载，视口即使缩放到 360pt 也能完美自适应，彻底杜绝按钮与标题的撞车。

---

### 指令 4：扩展中心一体化 `ScrollArea` 表单与紧凑内敛排版

在 [`src/modals.rs`](file:///home/mat/Projects/mathslot-next/src/modals.rs) 的 `render_custom_tab`、`render_snippets_tab` 以及 `render_corpus_workspace` 中实施：

#### 4.1 废除外挂表单，全面迁入全局 `ScrollArea`
- **重构前**：`if self.show_xxx_form { ... }` 位于 `egui::ScrollArea::vertical()` 之前，一旦展开直接抢占固定高度，导致整体截断；
- **重构后**：整个工作区内容（顶栏操作之后的所有卡片与展开表单）全部收拢在同一个统领式 `egui::ScrollArea::vertical()` 中。当表单展开时，它作为滚动区域内部的“置顶卡片”自然展开，支持自由滚动，底部的保存按钮永远不会被屏幕裁切！

#### 4.2 紧凑排版与保存按钮内敛聚合
1. **紧凑化行距与字段尺寸**：
   - 字段间距从 8~10pt 收紧至 4~6pt；
   - 触发按键文本框宽度 44pt，格式/模版名称 180pt，缩略提示 80pt，槽位角色自适应；
2. **拒绝横向天涯海角**：
   - 表单卡片内部操作行：
     ```rust
     ui.horizontal(|ui| {
         ui.label(RichText::new("提示: 保存后立即生效并持久化").size(11.0).color(MUTED));
         ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
             if ui.button(RichText::new("✓ 保存格式").strong().color(GREEN)).clicked() { ... }
             if ui.button("取消").clicked() { ... }
         });
     });
     ```
   - 限制表单最大宽度（例如不超过 760pt，或居左紧凑吸附），使保存按钮紧跟在模板输入框的右下方，眼动与鼠标移动距离在舒适区（<250px），极大降低认知与操作疲劳。

---

## 三、 架构切片与实施步骤拆解 (Step-by-Step Implementation Plan)

| 阶段 | 核心任务 | 涉及核心文件 | 预期输出与验证标准 |
| :--- | :--- | :--- | :--- |
| **Slice 1** | **移除 Top Bar & 左翼 Header 重构** | `src/app.rs` | 废除 `Panel::top`，构建 36pt Left Wing Header，释放 48pt 空间，验证 5 大 Tab 联动正常 |
| **Slice 2** | **预置库双槽修正 & 上下标标准统领** | `crates/mathslot-core/src/presets.rs` | 修复爱因斯坦场方程等所有预置，`massive_preset_compatibility_tests` 88/88 绿灯 |
| **Slice 3** | **实施主体后向智能包裹 (Backward Wrap)** | `crates/mathslot-core/src/editor.rs` | 实现 `x` + `Tab d` -> `▸d x;|`，添加针对后向包裹的专属单元测试，支持 Ctrl+Z 撤销 |
| **Slice 4** | **公式库两行工具栏与双层流式卡片** | `src/modals.rs` | 两行式响应式工具栏（Row 1 搜索+新建，Row 2 流式分类+维护），双层主副操作分离卡片 |
| **Slice 5** | **扩展中心一体化 ScrollArea & 紧凑表单** | `src/modals.rs` | 表单迁入 ScrollArea 彻底根除垂直截断，保存按钮内敛右下聚合，行距紧凑优雅 |
| **Slice 6** | **全工作区回归验证与终验测试套件更新** | 全工程 & `tests/` | 执行 `cargo test --workspace` 确保 100% 测试通过（0 fail），发布生产构建验证 |

---

## 四、 质量保障、测试契约与签署 (Sign-off & Invariants)

1. **测试隔离契约**：严禁修改 `.gitignore` 规则，所有决策与设计文档必须保持在 `docs/` 下被 Git 隔离忽略；
2. **内存安全规范**：核心 crate 保持 `#![forbid(unsafe_code)]`，应用层 0 unsafe；
3. **回归测试完整性**：
   - 现有的 119 项测试必须继续 100% 通过；
   - 在 `crates/mathslot-core/tests/` 中新增针对爱因斯坦场方程双槽解析与“主体后向智能包裹”的单元测试用例。

---

### 裁决令签署 (Official Decree Sign-off)

- **总架构师裁决**：**【批准立即执行 (APPROVED TO EXECUTE)】**
- **下发指令**：请 Implementer Agent 严格遵照本裁决书定义的规范与切片规划，开始系统代码级实施！
- **归档路径**：`/home/mat/Projects/mathslot-next/docs/DECISION_ROUND_12_CHROMELESS_HERGONOMICS_AND_RESPONSIVE_WORKSPACES.md`
- **签署时间**：2026-11-12

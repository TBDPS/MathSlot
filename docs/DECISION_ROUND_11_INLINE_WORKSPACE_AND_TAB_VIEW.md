# MathSlot 架构决策方案 (Round 11: 废除模态浮窗 · 右侧一等公民内联工作区体系)

- **决策版本**：DECISION-ROUND-11-INLINE-WORKSPACE-AND-TAB-VIEW
- **决策专家**：Decision Maker Agent (系统总架构师与产品决策专家)
- **依据输入**：
  1. 用户关键交互痛点反馈：“现在的语义表单会在中间空出一大块，我的建议是整个放弃新窗口的设计，改成直接在主界面的右侧显示，如同标签页一样，这样不会遮住右侧的预览框，可以观察载入效果。”
  2. 美术 UI 设计师《MathSlot UI/UX 架构革新与视觉设计蓝图（Round 11 规范报告）》
- **指派对象**：Implementer Agent (系统实现专家)
- **决策结论**：**【全面正式签署并批准实施 (APPROVED)】**
- **目标交付物**：
  1. 彻底废除 `egui::Window` 浮窗，重构为双翼工作流一体化（左侧画板常驻，右侧 CentralPanel 通栏内联展示）；
  2. 右侧五大主工作区标签页（WorkspaceTab：`Palette`, `Corpus`, `Formats`, `LatexImport`, `Help`）；
  3. 顶栏操作按钮（“公式库”、“格式库”、“⇄ 导入 LaTeX”、“帮助”）与右侧一级分段选择器双向联动；
  4. 消除所有表单的横向空白空洞，采用 100% 通栏代码载荷与紧凑三层卡片；
  5. “即点即显”心流闭环：右侧载入公式，左侧白纸预览框同一渲染帧内实时重绘呈现；
  6. 全套编译通过与自动化 UI 截图（`devshot`）无缝适配。

---

## 一、 决策背景与核心痛点剖析 (Context & Architectural Review)

在 MathSlot 此前的版本演进中，扩展中心、公式库、LaTeX 导入器以及帮助指南均采用居中弹出式浮窗（`egui::Window`）呈现。在最新的深度交互中，用户提出了关键诉求：
> **“现在的语义表单会在中间空出一大块，我的建议是整个放弃新窗口的设计，改成直接在主界面的右侧显示，如同标签页一样，这样不会遮住右侧的预览框，可以观察载入效果。”**

针对该诉求，系统总架构师对设计师提交的 Round 11 重构蓝图进行深度审查，确认浮窗模态在当前交互场景下存在根本性的架构弊病：

1. **视口盲区与交互动线撕裂**：
   浮窗居中弹出（高度 560~640pt，宽度 780~880pt）彻底遮蔽了左侧核心公式画板与预览框。用户在公式库中浏览 88+ 公式并点击“载入”时，无法直接观测排版渲染效果，必须先关闭弹窗，破坏了“探索-预览-选择”的流畅体验。
2. **表单横向空间撕裂与死寂空白**：
   在宽屏或固定宽度的模态窗中，表单字段若按固定列宽或未充分约束的网格排布，会在字段与边界之间产生高达 200px+ 的无意义灰色空洞；而若单纯拉伸字段，又导致简短字段（如 1 字符的触发按键）过度膨胀。
3. **焦点冲突与键盘歧义 (Esc Ambiguity)**：
   模态弹窗下，`Esc` 键用于关闭浮窗；而在 MathSlot 的公式编辑流中，`Esc` / `Tab j` 是核心的“槽位导航跳出/进入”键。模态机制引入了状态机的复杂度与焦点抢夺。

**架构裁决**：
批准彻底废除 `egui::Window`，将所有扩展功能一等公民化，全面平移至右侧 `CentralPanel`，构建**双翼联动内联工作台（Unified Split Workspace）**。

---

## 二、 架构重构切片规范 (Architectural Slices)

```
+----------------------------------------------------------------------------------------------------+
|  TOP BAR:  [Σ MathSlot] [模式 Badge] [槽位直达 Tab j] ... [公式库] [格式库] [⇄ 导入 LaTeX] [帮助]      |
+-----------------------------------------------------+----------------------------------------------+
|  LEFT WING: 核心公式画板与输入流 (380~560pt 常驻)     |  RIGHT WING: 一等公民内联工作区 (CentralPanel 通栏) |
|                                                     |                                              |
|  +-----------------------------------------------+  |  [ ∑ 符号结构 ] [ 📚 公式库 ] [ ⚙ 扩展中心 ]   |
|  | [框 1] 纯白白纸公式画布 (Paper Preview Box)      |  |  [ ⇄ LaTeX 导入 ] [ 💡 使用指南 ]            |
|  |  - 实时毫秒级物理尺寸重绘 (零遮挡观测)            |  |  ------------------------------------------  |
|  +-----------------------------------------------+  |                                              |
|                                                     |  ACTIVE TAB CONTENT AREA (自适应 100% 铺满):  |
|  +-----------------------------------------------+  |  - 紧凑无空洞 3 层语义表单卡片               |
|  | [框 2] 槽位层级导航框 (Nav Structure Box)        |  |  - 通栏两段式公式列表 (左65%信息，右35%动作)  |
|  +-----------------------------------------------+  |  - 100% available_width 代码载荷             |
|                                                     |  - 0px 视口跳变，即点即显实时重绘            |
|  +-----------------------------------------------+  |                                              |
|  | [框 3] 极简流输入与输出框 (Input & Output Box)    |  |                                              |
|  +-----------------------------------------------+  |                                              |
+-----------------------------------------------------+----------------------------------------------+
|  STATUS BAR: 状态反馈信息、语法诊断提示与快捷键信号微文案                                             |
+----------------------------------------------------------------------------------------------------+
```

### 切片 1：工作区标签状态模型统一 (WorkspaceTab & State Consolidation)

在 [`src/modals.rs`](file:///home/mat/Projects/mathslot-next/src/modals.rs) 与 [`src/app.rs`](file:///home/mat/Projects/mathslot-next/src/app.rs) 中统一状态模型：

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum WorkspaceTab {
    #[default]
    Palette,     // 1: 符号与数学结构网格 (Alt+1)
    Corpus,      // 2: 权威公式库 88+ (Alt+2 / F2)
    Formats,     // 3: 扩展中心：自定义宏与复用片段 (Alt+3 / F3)
    LatexImport, // 4: LaTeX 逆向反编译工作台 (Alt+4 / F4)
    Help,        // 5: 使用指南与快捷键图谱 (Alt+5 / F1)
}
```

- 在 `MathSlotApp` 中添加 `pub active_tab: WorkspaceTab`，默认值为 `WorkspaceTab::Palette`；
- 彻底废除 `LibraryModalState` 中的 `egui::Window` 显示标志，保留其作为工作区表单状态与数据管理容器（可平滑兼容并保持别名 `pub type WorkspaceState = LibraryModalState;`）；
- 废弃 `show_library`, `show_help`, `show_presets` 浮窗，所有工作区视图由 `self.active_tab` 单一真实状态源驱动。

---

### 切片 2：右侧 CentralPanel 通栏分发渲染与导航胶囊 (CentralPanel Dispatch & Segmented Bar)

修改 [`src/app.rs`](file:///home/mat/Projects/mathslot-next/src/app.rs) 的 `CentralPanel` 渲染：

1. **顶部一级分段导航器（Segmented Navigation Bar）**：
   - 固定高度 `38.0 pt`，贴顶横跨 `CentralPanel` 通栏；
   - 排布 5 联胶囊：`[ ∑ 符号结构 ]`、`[ 📚 公式库 ]`、`[ ⚙ 扩展中心 ]`、`[ ⇄ LaTeX 导入 ]`、`[ 💡 使用指南 ]`；
   - 每个胶囊内标注暗色微快捷键徽章（如 `Alt+1` ~ `Alt+5`）；
   - **激活态**：底色高亮为 `CARD_HI`，1px 精细发丝描边，强纯白加粗文字，底部高亮强调条；
   - **点击行为**：无缝切换 `self.active_tab`；当切换到 `Palette` 时，触发 `self.request_input_focus = true` 回归主输入。
2. **工作区内容分发 (Tab Content Dispatch)**：
   ```rust
   match self.active_tab {
       WorkspaceTab::Palette => {
           self.structure_palette_ui(ui, &mut act);
       }
       WorkspaceTab::Corpus => {
           if let Some(m_act) = self.modals.render_presets_workspace(ui, &mut self.editor) {
               modal_action = Some(m_act);
           }
       }
       WorkspaceTab::Formats => {
           if let Some(m_act) = self.modals.render_formats_workspace(ui, &mut self.editor) {
               modal_action = Some(m_act);
           }
       }
       WorkspaceTab::LatexImport => {
           if let Some(m_act) = self.modals.render_latex_workspace(ui, &mut self.editor) {
               modal_action = Some(m_act);
           }
       }
       WorkspaceTab::Help => {
           self.modals.render_help_workspace(ui);
       }
   }
   ```
3. 容器使用 `egui::ScrollArea::vertical().auto_shrink([false, false])`，自适应拉伸铺满全部可用视口。

---

### 切片 3：顶栏常驻按钮与一级 Tab 双向双控联动 (Top Bar & Shortcut Wiring)

修改 [`src/app.rs`](file:///home/mat/Projects/mathslot-next/src/app.rs) 的 `top_ui` 与 `handle_keys_before_ui`：

1. **顶栏按钮高亮与切换**：
   - **“公式库”**：当 `self.active_tab == WorkspaceTab::Corpus` 时呈高亮激活态；点击时若已在当前 Tab 则切回 `Palette`，否则切至 `Corpus`；
   - **“格式库”**：当 `self.active_tab == WorkspaceTab::Formats` 时呈高亮激活态；点击时切换/切回；
   - **“⇄ 导入 LaTeX”**：当 `self.active_tab == WorkspaceTab::LatexImport` 时呈高亮激活态；点击时切换并触发转换；
   - **“帮助”**：当 `self.active_tab == WorkspaceTab::Help` 时呈高亮激活态；点击时切换/切回。
2. **全局快捷键规范**：
   - `F1` / `Alt+5`：切换 `Help`；
   - `F2` / `Alt+2`：切换 `Corpus`；
   - `F3` / `Alt+3`：切换 `Formats`；
   - `F4` / `Alt+4`：切换 `LatexImport`；
   - `Alt+1`：切回 `Palette`；
   - `Escape`：当处于非 `Palette` 标签页时，按下 `Escape` 平滑切回 `Palette` 并恢复主输入框焦点；当处于 `Palette` 时保持原有的退出导航模式逻辑。

---

### 切片 4：消除表单横向空洞与通栏卡片重塑 (Zero Blank Space & Full-Width Cards)

修改 [`src/modals.rs`](file:///home/mat/Projects/mathslot-next/src/modals.rs) 中的各个工作区渲染逻辑：

1. **Tab 2: 公式库 (Corpus Workspace)**：
   - 彻底废除 4 列固定 `Grid` 布局；
   - 新建/编辑公式抽屉采用三层紧凑卡片：
     - *第一层（语义元信息）*：公式名称（占宽 35%）、学科分类（占宽 25%）、检索标签（占宽 40%），全行紧密铺满；
     - *第二层（核心源码载荷）*：简码源码输入框独占整行，`desired_width(ui.available_width())` 100% 铺满，等宽黑曜石底色凹槽；
     - *第三层（说明与保存）*：原理说明输入框（占宽 80%）+ Emerald 保存按钮（占宽 20% 右对齐）；
   - 公式列表行采用两段式布局：左侧 65% 为名称、徽章与语法预览，右侧 35% 为右对齐的“载入到编辑器 (替换)”、“追加”、“复制”等按钮组。
2. **Tab 3: 扩展中心 (Formats Workspace)**：
   - 内置二级分段导航：`[ 自定义 LaTeX 格式 (k) ]` 与 `[ 用户复用片段 (t) ]`（LaTeX 导入已升格为一级 Tab）；
   - 表单严格执行 3 层紧凑设计：触发字母 (48pt) + 格式名称 (160pt) + 缩略符 (96pt) + 槽位角色 (弹性铺满剩余宽度)，第二层 LaTeX 模板 100% 通栏铺满；
   - 彻底消灭中间空白空洞。
3. **Tab 4: LaTeX 导入 (LatexImport Workspace)**：
   - 上半部：原生 LaTeX 源码多行编辑框（100% 通栏宽度，高度 110pt）；
   - 中间部：实时诊断与无损反编译微光状态条；
   - 下半部：转换出的 MathSlot 简码流（100% 通栏宽度，高度 70pt）；
   - 底部动作栏：全宽电光蓝实心大按钮 `[ ✓ 一键载入并替换编辑器 ]`，以及 `[ 追加到末尾 ]`、`[ 仅复制简码 ]`。
4. **Tab 5: 使用指南 (Help Workspace)**：
   - 采用 2 列模块化响应式网格速查卡片（前缀驱动心流、槽位直达导航、常用结构语法、全局功能快捷键），拒绝长篇说教。

---

### 切片 5：“即点即显”毫秒级重绘与智能焦点回归 (Instant Preview & Smart Focus)

1. **“即点即显”心流闭环 (Live Instant Feedback Flow)**：
   - 用户在右侧公式库或 LaTeX 导入台点击“载入”按钮时，发出 `ModalAction::ReplaceCode(code)` 或 `ModalAction::InsertCode(code)`；
   - `app.rs` 捕获动作后，立即更新 `self.editor.source`，重置光标，并调用 `self.mark_dirty()`；
   - **关键收益**：由于左侧白纸公式预览框（Paper Preview Box）常驻且零遮挡，用户在右侧点击“载入”的瞬间，左侧预览框在同一渲染帧内立即呈现出排版结果，眼动距离减半，无需往返关闭浮窗。
2. **智能焦点管理机制**：
   - 修复此前“每帧强制抢夺焦点到输入框”的逻辑：
     ```rust
     if self.active_tab == WorkspaceTab::Palette {
         if self.editor.esc_nav.is_none() {
             ctx.memory_mut(|m| m.request_focus(self.input_id));
         } else {
             ctx.memory_mut(|m| m.surrender_focus(self.input_id));
         }
         self.request_input_focus = false;
     } else {
         // 在 Corpus、Formats、LatexImport 中，允许用户在搜索栏和表单输入框中自由输入，不抢焦点；
         // 仅当用户点击“载入”、“插入”或显式请求时，才将焦点平滑归还左侧输入框：
         if self.request_input_focus {
             ctx.memory_mut(|m| m.request_focus(self.input_id));
             self.request_input_focus = false;
         }
     }
     ```

---

### 切片 6：DevShot 视觉回归测试适配与自动化保障

在 [`src/app.rs`](file:///home/mat/Projects/mathslot-next/src/app.rs) 初始化时映射 `MATHSLOT_SHOT_MODAL`：
```rust
if let Some(ref shot) = devshot {
    if let Some(ref m) = shot.modal {
        match m.as_str() {
            "help" => app.active_tab = WorkspaceTab::Help,
            "latex" => app.active_tab = WorkspaceTab::LatexImport,
            "custom" => {
                app.active_tab = WorkspaceTab::Formats;
                app.modals.tab = LibraryTab::CustomFormats;
            }
            "snippets" => {
                app.active_tab = WorkspaceTab::Formats;
                app.modals.tab = LibraryTab::Snippets;
            }
            "presets" | "corpus" => app.active_tab = WorkspaceTab::Corpus,
            _ => {}
        }
    }
}
```
保证 `MATHSLOT_SHOT` 自动化截屏测试能够无缝抓取五大内联工作区的高清视口渲染，完全向后兼容。

---

## 三、 实施指令指派 (Directive to Implementer Agent)

1. **执行重构**：
   - 按照切片 1~6 依次实施 [`src/modals.rs`](file:///home/mat/Projects/mathslot-next/src/modals.rs) 与 [`src/app.rs`](file:///home/mat/Projects/mathslot-next/src/app.rs) 的协同改造；
   - 彻底删除 `src/modals.rs` 中任何 `egui::Window` 的实例化代码；
   - 重塑表单与列表容器，严禁任何多余的孤立空白空洞；
   - 确保 `cargo check` 与 `cargo test` 100% 编译通过且无任何警告；
2. **验证交付**：
   - 验证五大标签页切换平滑（0px 视口跳变）；
   - 验证在公式库与 LaTeX 导入中点击“载入”，左侧预览框实时毫秒级重绘；
   - 产出 Round 11 实施报告与验收截图。

---
*签署：系统总架构师与产品决策专家 (Decision Maker Agent)*  
*日期：2026-11-12*

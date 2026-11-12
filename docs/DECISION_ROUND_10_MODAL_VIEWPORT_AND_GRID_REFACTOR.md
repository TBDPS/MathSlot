# MathSlot 架构决策方案 (Round 10: 弹窗视口防跳变、卡片表单黄金网格与双段式列表规范)

- **决策版本**：DECISION-ROUND-10-MODAL-VIEWPORT-AND-GRID-REFACTOR
- **决策专家**：Decision Maker Agent (系统总架构师与产品决策专家)
- **依据输入**：专业美术 UI 设计师关于《MathSlot 弹窗视口防跳变、卡片表单黄金网格与双段式列表规范》的审查报告
- **指派对象**：Implementer Agent (系统实现专家)
- **决策结论**：**【全面批准实施 (APPROVED)】**
- **目标交付物**：
  1. 窗口层视口横向死锁与零跳变契约 (`.resizable([false, true])`，横向锁死 780.0px)；
  2. 表单层废除 4 列 Grid，重构为两层语义流式表单（48px 单字符 Key、180/220px 语义名称、96px 缩略符、100% 通栏代码载荷、右对齐主次操作栏）；
  3. 列表层绝对两段式布局规范（左侧可用宽度 - 140px 安全截断，右侧 136px 绝对对齐动作栏）；
  4. 帮助与公式库弹窗视口同步固化；
  5. 全套自动化测试（99+ 项）与发布构建回归。

---

## 1. 决策背景与核心问题剖析 (Executive Overview & Root Causes)

在经历了 Round 10 基础视觉质感重塑后，专业美术 UI 设计师对弹窗与卡片表单进行了深度实机走查，指出当前实现虽然具备了 Zinc 色调和按需折叠，但底层布局容器在交互动力学和工程网格上存在 3 项阻断性体验缺陷：

### 核心缺陷 1：切换到“片段模板”弹窗横向撑大 88px（780px -> 868px）且不可逆
- **现象**：当在“扩展中心”三个 Tab 间切换时，点击“片段模版”会触发弹窗突然横向跳变膨胀 88px（从 780px 变成 868px），且之后即使切回 LaTeX 导入也不会自动缩回。
- **根因**：
  1. `egui::Window` 配置了 `.resizable(true)` 且 `max_size([880.0, 680.0])`；
  2. 列表项与表单内的横向子组件因未设绝对上限，向外请求了多余宽度；
  3. `egui` 会在 `Context` 内存中缓存窗口当前实际几何尺寸，一旦被子项撑开，除非代码显式收缩，否则将永久驻留为膨胀后尺寸。

### 核心缺陷 2：隐藏卡片不等于卡片布局合理，4 列 Grid 造成 240px 死寂空洞与代码载荷挤压
- **现象**：表单虽然可以折叠，但展开后使用 `egui::Grid(4 columns)` 布局极其扭曲：
  - 首行“触发字母”输入框为 40px，而第二行“简码流源码”输入框为 280px。Grid 导致第 1 列宽度被强制拉大到 280px，使首行在 40px Key 框与“模版名称”标签之间出现了整整 **240px 的死寂空白空洞**；
  - 核心 LaTeX 模板与简码流源码被硬编码压缩在 280px 的狭窄方框中，右侧留有两列空单元格，造成 400px+ 的可用宽度被完全浪费；
  - 保存与取消按钮散乱置于左侧，缺乏主次动作视觉层阶。

### 核心缺陷 3：列表项截断与右浮动按钮产生外力碰撞膨胀
- **现象**：在格式与片段列表中，使用 `ui.horizontal` 并在末尾直接套用 `with_layout(Layout::right_to_left)`。
- **根因**：`egui` 的 `Label::new(...).truncate()` 在非显式限宽的水平布局中，若右侧同时存在 `right_to_left` 容器，子布局尺寸测量会产生竞态扩张，将行宽撑破 780px，成为推动整个 Window 膨胀到 868px 的主要外力源。

经过系统架构与体验评审，**总架构师正式批准采纳设计师提出的完整优化方案**，并制定以下技术规范指派 Implementer 实施。

---

## 2. 架构重构切片规范 (Architectural Slices)

### 切片 1：窗口层视口横向防跳变契约 (SPEC-VIEWPORT-LOCK)

修改文件：[`src/modals.rs`](file:///home/mat/Projects/mathslot-next/src/modals.rs)

1. **扩展中心（Library Modal）横向死锁**：
   - 彻底废除 `.resizable(true)`，改用布尔元组 `.resizable([false, true])`（横向禁止拉伸，纵向允许自由调节）；
   - 严格约束尺寸边界：
     ```rust
     .default_size([780.0, 580.0])
     .min_size([780.0, 460.0])
     .max_size([780.0, 780.0])
     ```
   - 确保 `min_size.x == max_size.x == 780.0`，在 egui 底层窗口约束上阻断任何水平扩张的可能性，跳变差值数学严格为 0px。
2. **公式库（Presets Modal）与帮助（Help Modal）同步规范**：
   - 公式库：`.resizable([false, true])`，`default_size([880.0, 640.0])`，`min_size([880.0, 500.0])`，`max_size([880.0, 840.0])`；
   - 帮助：`.resizable([false, true])`，`default_size([740.0, 560.0])`，`min_size([740.0, 420.0])`，`max_size([740.0, 760.0])`。

---

### 切片 2：表单层废除 4 列 Grid，重构两层语义流式表单 (SPEC-CARD-FORM)

彻底废除 `mathslot-snippet-form-grid` 和 `mathslot-custom-fmt-grid`，构建统一的 **Card Form 黄金分层流式结构**：

#### 2.1 片段模版新建/编辑表单 (Snippet Form)
- **卡片基底**：`CARD` 底色，`CARD_BORDER` 发丝微边框，圆角 10px，内边距 12px。
- **顶栏标题行**：
  - 左侧：`RichText::new(if is_editing { "编辑片段模版" } else { "新建片段模版" }).size(12.5).strong().color(AMBER)`；
  - 右侧（`Layout::right_to_left`）：`ui.small_button("填入当前公式")`。
- **第一层：语义元信息字段栏 (Semantic Meta Row)**：
  - 水平流式排列（`ui.horizontal`）：
    - 标签：`ui.label(RichText::new("触发字母:").size(12.0).color(TEXT_DIM))`；
    - 单字符框：`egui::TextEdit::singleline(&mut self.snip_key).desired_width(48.0).font(FontId::monospace(13.0)).hint_text("d")`；
    - 间隔：`ui.add_space(10.0)`；
    - 标签：`ui.label(RichText::new("模版名称:").size(12.0).color(TEXT_DIM))`；
    - 名称框：`egui::TextEdit::singleline(&mut self.snip_label).desired_width(220.0).hint_text("如：高斯核 / 泰勒余项")`；
    - 辅助提示：`ui.label(RichText::new("按 Tab t + 字母内联展开").size(11.0).color(MUTED))`。
- **第二层：核心代码载荷通栏 (Core Stream Payload 100% Width)**：
  - 垂直布局，代码输入框**独占 100% 可用宽度**：
    - 标签：`ui.label(RichText::new("简码流源码:").size(12.0).color(TEXT_DIM))`；
    - 输入框：
      ```rust
      ui.add(
          egui::TextEdit::singleline(&mut self.snip_source)
              .font(FontId::monospace(12.5))
              .desired_width(ui.available_width())
              .hint_text("如 ▸rb^2 - 4ac; 或 ▸f a;b;"),
      );
      ```
- **第三层：底部右对齐操作栏 (Bottom Action Bar)**：
  - `ui.with_layout(Layout::right_to_left(Align::Center), |ui| { ... })`；
  - **主操作（保存）**：高亮强对比色 `ui.button(RichText::new("保存片段").strong().color(GREEN))`；
  - `ui.add_space(8.0)`；
  - **次操作（取消）**：中性色 `ui.button(RichText::new("取消").color(TEXT_DIM))`。

#### 2.2 自定义格式新建/编辑表单 (Custom Format Form)
- **第一层：语义元信息字段栏**：
  - 水平流式：
    - 触发字母：标签 + `TextEdit(48.0px)`，hint `"g"`；
    - 间隔 8px；
    - 格式名称：标签 + `TextEdit(180.0px)`，hint `"如：同余式 / 期望"`；
    - 间隔 8px；
    - 缩略提示：标签 + `TextEdit(96.0px)`，hint `"如 a≡b(m)"`；
    - 间隔 8px；
    - 槽位角色：标签 + `TextEdit(剩余全部可用宽度)`，hint `"左项;右项;模数 (分号分隔)"`。
- **第二层：核心代码载荷通栏**：
  - 独占 100% 通栏：
    - 标签：`ui.label(RichText::new("LaTeX 模板 ($1, $2 对应槽位):").size(12.0).color(TEXT_DIM))`；
    - 输入框：`egui::TextEdit::singleline(&mut self.custom_latex).font(FontId::monospace(13.0)).desired_width(ui.available_width()).hint_text("$1 \\equiv $2 \\pmod{$3}")`。
- **第三层：底部右对齐操作栏**：
  - 右对齐排列：`保存格式`（高亮主按钮） + `取消`（次按钮）。

---

### 切片 3：列表层绝对两段式布局规范 (SPEC-TWO-PHASE-LIST)

彻底解决列表项截断与右浮动按钮冲突导致的外力膨胀问题：

- 在每个自定义格式项和片段项的外层 Frame 内，采用**绝对两段式子空间分配**：
  ```rust
  let total_width = ui.available_width();
  const ACTIONS_WIDTH: f32 = 136.0;
  let info_width = (total_width - ACTIONS_WIDTH - 8.0).max(120.0);

  ui.horizontal(|ui| {
      // 1. 左侧信息区 (Bounded Info Zone)
      ui.allocate_ui_with_layout(
          Vec2::new(info_width, 22.0),
          Layout::left_to_right(Align::Center),
          |ui| {
              ui.set_max_width(info_width);
              // 显示 [Tab k g] 标识
              // 显示 label
              // 显示 glyph 提示
              // 显示代码文本，安全 truncate()
          },
      );

      // 2. 右侧操作区 (Fixed Actions Zone)
      ui.allocate_ui_with_layout(
          Vec2::new(ACTIONS_WIDTH, 22.0),
          Layout::right_to_left(Align::Center),
          |ui| {
              if ui.small_button("删除").clicked() { ... }
              if ui.small_button("编辑").clicked() { ... }
              if ui.small_button(RichText::new("插入").color(GREEN)).clicked() { ... }
          },
      );
  });
  ```
- **技术保证**：
  - 左侧 `info_width` 显式设限，`truncate()` 计算有了刚性边界，杜绝任何溢出 parent 的可能；
  - 右侧 `ACTIONS_WIDTH = 136.0px` 严格对齐，三颗按钮稳固居右，不再与文本互相挤压；
  - 列表行总需求宽度恒等于 `total_width`，不再对外部 `Window` 施加任何水平扩张推力。

---

## 3. 实施指导与执行优先级 (Implementation Guidelines & Priority Matrix)

| 阶段 | 任务模块 | 实施重点与技术动作 | 优先级 |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **窗口层视口横向防跳变** | 修改 `src/modals.rs`，所有弹窗采用 `.resizable([false, true])`，锁死 780px/880px/740px 宽度边界 | **P0 (阻塞级)** |
| **Phase 2** | **列表层绝对两段式布局** | 格式库与片段库列表引入 `info_width` 与固定 136px `ACTIONS_WIDTH` 独立 sub-UI 隔离分配 | **P0 (阻塞级)** |
| **Phase 3** | **表单层废除 Grid 与分层流式** | 废除 4 列 Grid，改造成两层语义表单（Key 48px，名称 180/220px，符号 96px，代码 100% 通栏，右对齐操作栏） | **P0 (阻塞级)** |
| **Phase 4** | **帮助与公式库弹窗视口同步** | 检查 Help 与 Presets 弹窗，确保全部对齐视口防膨胀标准 | **P1 (标准级)** |
| **Phase 5** | **工程与自动化测试回归** | 运行 `cargo test --workspace`，保证 99 项单元/集成测试全绿，`cargo build --release` 编译无告警 | **P0 (质量闸门)** |

---

## 4. 验收标准与质量闸门 (Acceptance Criteria & Verification Gate)

1. **视口稳定性量化指标**：
   - 在 LaTeX 逆向导入、自定义格式、片段模版三个 Tab 之间任意来回切换，实测 Window 宽度抖动为严格 **0px**；
   - 弹窗展开表单时，Window 宽度不得发生任何膨胀（维持精确 780.0px）。
2. **表单美观性与可用性指标**：
   - 彻底清除 4 列 Grid 造成的 240px 死寂空洞；
   - LaTeX 模板与简码流输入框占满通栏宽度，舒适容纳长公式；
   - Key 单字符输入框紧凑雅致（48px），名称输入框宽度适宜（180px/220px）；
   - 操作栏统一右对齐，保存为主动作高亮，取消为次动作。
3. **列表交互指标**：
   - 长名称与长简码在右侧操作按钮左侧平滑截断，鼠标悬停展示完整文本；
   - 右侧“插入”、“编辑”、“删除”按钮在 136px 空间内绝对右对齐，各行垂直对齐线完全一致。
4. **系统回归指标**：
   - `cargo test --workspace` 99 项测试 100% 通过；
   - `cargo build --release` 成功生成二进制交付物。

---

## 5. 决策签署与指派指令 (Directive to Implementer)

- **签署状态**：**正式批准实施 (FORMALLY APPROVED)**
- **执行指令**：
  请 Implementer Agent 立即检出代码，严格遵循上述 SPEC 规范，针对 `src/modals.rs` 进行原子化重构编码，完成测试验证后向架构师提交实施反馈报告。

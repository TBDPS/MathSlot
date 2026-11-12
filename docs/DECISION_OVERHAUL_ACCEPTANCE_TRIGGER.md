# MathSlot 架构与产品决策记录：客观整改终局验收授权令

- **决策编号**：DECISION-20261111-OVERHAUL-ACCEPTANCE-TRIGGER-01
- **决策专家**：Decision Maker Agent (主要架构与产品决策专家)
- **决策日期**：2026-11-11
- **目标工程**：`/home/mat/Projects/mathslot-next`
- **关联依据**：
  - [第三方独立客观核验审计报告 docs/AUDIT_OVERHAUL_VERIFICATION.md](file:///home/mat/Projects/mathslot-next/docs/AUDIT_OVERHAUL_VERIFICATION.md)
  - [整改实施总结报告 docs/IMPLEMENTATION_OBJECTIVE_OVERHAUL.md](file:///home/mat/Projects/mathslot-next/docs/IMPLEMENTATION_OBJECTIVE_OVERHAUL.md)
  - [客观整改与深度重构决策工单 docs/DECISION_OBJECTIVE_OVERHAUL.md](file:///home/mat/Projects/mathslot-next/docs/DECISION_OBJECTIVE_OVERHAUL.md)
  - [第三方客观严苛基线审计报告 docs/AUDIT_THIRD_PARTY_OBJECTIVE.md](file:///home/mat/Projects/mathslot-next/docs/AUDIT_THIRD_PARTY_OBJECTIVE.md)
  - [项目重构设计蓝图 docs/REWRITE_DESIGN.md](file:///home/mat/Projects/mathslot-next/docs/REWRITE_DESIGN.md)
- **决策结论**：🛡️ **【正式签发：客观整改终局验收授权令 (OBJECTIVE OVERHAUL FINAL ACCEPTANCE AUTHORIZATION GRANTED)】**

---

## 1. 客观整改独立核验审阅与成熟度裁定 (Maturity Evaluation & Executive Ruling)

基于 Implementer Agent 提交的整改实施总结报告 [`docs/IMPLEMENTATION_OBJECTIVE_OVERHAUL.md`](file:///home/mat/Projects/mathslot-next/docs/IMPLEMENTATION_OBJECTIVE_OVERHAUL.md) 以及 System & Code Auditor Agent 签发的第三方独立客观核验审计报告 [`docs/AUDIT_OVERHAUL_VERIFICATION.md`](file:///home/mat/Projects/mathslot-next/docs/AUDIT_OVERHAUL_VERIFICATION.md)，主要决策专家（Decision Maker Agent）对当前系统的全部整改成果与技术指标进行了全面、深入的独立复核与成熟度审定。

```mermaid
flowchart TD
    subgraph VerificationReview ["客观整改核心技术指标复审"]
        V1["高斯积分与双重上标<br>连带消费算法闭环"] -->|消除 e^{-x}^{2}<br>粘贴标准简码 100% 渲染| R1["🟢 Task 1 达标<br>规范学术命名，清理调试残留"]
        V2["预览栏 Toolbar 与视口<br>独立 Header + ScrollArea"] -->|废除 82pt 悬浮 rect<br>废除高度 clamp，双向平移| R2["🟢 Task 2 达标<br>线性几何缩放，大公式无损浏览"]
        V3["括号 Enter 智能跳出<br>定界符层级感知状态机"] -->|最内层优先跳出<br>与槽位流转完美联动| R3["🟢 Task 3 达标<br>() [] {} || 顺畅跳出"]
        V4["极端异构与高风险套件<br>7 项深度光栅化集成测试"] -->|全 Workspace 96 项测试 100% 绿灯<br>修复 src/render.rs| R4["🟢 Task 4 & 5 达标<br>tiny-skia 真实光栅化验证"]
        V5["架构与生态坚守<br>eframe/egui + WASM"] -->|守护 Linux 输入法稳定性<br>守护 Obsidian WASM (561KB)| R5["🟢 生态完好<br>Release 二进制 (~16MB) 交付"]
    end
    VerificationReview --> FinalAuth["🛡️ 正式签发终局验收授权令"]
```

### 1.1 高斯积分与双重上标（Double Superscript）彻底消除核定
1. **复合指数向前感知算法确认**：
   在 [`crates/mathslot-core/src/latex.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/latex.rs) 与 [`crates/mathslot-core/src/visual.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/visual.rs) 中，`latex_operand` 与 `preview_script_operand` 正确实现了指数操作数对后续紧邻 `^` 的递归连带消费机制。
   遇到 `e^-x^2` 时，基底提取与符号回溯紧密结合，精准产出单一内聚指数 `-x^2`，并由外层单一花括号包裹为合法的 `e^{-x^2}`。外层游标同步后移，彻底切断了外层二次拼接 `^{2}` 的病灶通路。
2. **端到端粘贴与穷举测试确认**：
   直接粘贴标准高斯积分简码：
   ```text
   ▸i-oo;oo;e^-x^2 dx;= ▸r▸gp;
   ```
   在输入态下导出 LaTeX 与实时预览 100% 成功，绝无 `e^{-x}^{2}` 出现。
   在穷举光标测试中，全部 28 个光标状态点均在真实 `latex-rust` 3.0.1 引擎中成功光栅化为非零有效位图，零报错、零崩溃。
3. **学术命名与技术坏味道清除确认**：
   示例库与测试预置中彻底删除了避坑命名“高斯正态分布积分”与旧式避坑简码 `▸u-x^2`，规范统一为学术标准名称“高斯积分”；清理了 `lib.rs` 中的调试代码与 `src/render.rs` 中的遗留编译缺陷。

### 1.2 预览栏 Toolbar 与 ScrollArea 双向滚动视口改造核定
1. **物理隔离的 Header Toolbar**：
   在 [`src/app.rs`](file:///home/mat/Projects/mathslot-next/src/app.rs) 中，原硬编码的 82pt 悬浮窄长框（`ctrl_rect`）已被物理彻底删除。取而代之的是在预览卡片顶部开辟的专属横向 Header 栏，左侧清晰展示深色标题，右侧预留 $\ge 140\text{pt}$ 宽度排布 `[ − ]`、`[ 100% ]`、`[ + ]` 按钮组，布局规整宽敞，悬停提示完备，彻底解决了误触与内容遮挡。
2. **解除 Height Clamp 死锁与真实几何缩放**：
   在 `fitted_size` 中彻底删除了 `.min(max_height / original.y)` 强制压制逻辑。公式直接按照 `display_size = original * self.preview_scale` 线性几何比例渲染，点击 `+` 即可按 15% 步进无限制放大至 2.5 倍，彻底解决大公式“假缩放”问题。
3. **2D 双向滚动视口 (`ScrollArea::both()`)**：
   视口全面换装 `egui::ScrollArea::both()`，大矩阵、展开式或高倍放大公式超出视口时，水平与垂直滚动条自适应平滑呈现，用户可自由拖拽视口全方位观察公式排版细节。

### 1.3 括号 Enter 智能跳出机制核定
1. **配对定界符状态机扫描**：
   在 [`crates/mathslot-core/src/editor.rs`](file:///home/mat/Projects/mathslot-next/crates/mathslot-core/src/editor.rs) 中，`smart_enter` 全面集成了 `()`、`[]`、`{}` 与 `||` 定界符感知，支持转义跳过与跨槽位重置，并按定界符跨度升序排序以保证最内层优先。
2. **定界符与槽位推进层级协调**：
   - 当在槽位内部书写括号（如 `▸f 1 ; (x + 1|) ;`）时，`p.open_char_idx >= span.start.char_idx`，Enter 触发括号跳出至右括号外侧；
   - 当在括号内部书写子槽位（如 `( ▸f 1| ; 2 ; )`）时，`p.open_char_idx < span.start.char_idx`，Enter 优先推进子槽位（分子 $\to$ 分母），子结构闭合后再跳出外层括号；
   - 彻底消除了用户在括号结尾频繁伸手按右方向键的交互痛点，且完全不干扰原有的槽位流转与事务撤销历史。

### 1.4 极端异构高风险测试与工程质量门禁核定
1. **全套件自动化测试**：
   执行 `cargo test --workspace`，全工程共计 **96 项测试 100% 绿灯全部通过**（0 失败，0 忽略，0 警告）。
2. **极端异构集成套件**：
   新增的 7 项极端高风险测试（`test_ext01` ~ `test_ext07`）覆盖高斯积分、马氏距离与多元高斯核、变上限微积分复合求导、空定界符高阶偏导、异构矩阵单元格、负号幂塔以及 Smart Enter 状态机，全部通过工业级 `latex-rust` + `tiny-skia` 真实光栅化像素断言。

### 1.5 架构路线选择与生态同源核定
1. **坚守 `eframe/egui` 架构路线的正确性**：
   决策专家与审计专家一致认定：整改实践充分证明，用户此前反馈的预览缩放卡死与遮挡问题仅源自数十行上层容器与布局逻辑，绝非 egui 底层能力的局限。贸然推翻并改写为 GPUI 不仅会引入高达数周的巨大工程不确定性，更会彻底丢失跨平台中文/日韩输入法支持（GPUI 在 Linux Wayland/X11 下目前严重缺乏完整 IME 抽象）以及直接阻断 WebAssembly 生态。
2. **同源复用链路健康稳固**：
   - Obsidian 插件构建脚本 `node obsidian-mathslot/scripts/build.mjs` 三阶段无损执行通过；
   - WASM 运行时（561.0 KB）内联打包正常，Node.js WebAssembly 烟测全部通过；
   - 桌面端 Release 二进制（`target/release/mathslot`，约 16MB）构建正常，根目录软链接可用。

---

## 2. 客观整改终局验收授权令 (Mandate of Final Acceptance)

鉴于：
1. 第三方独立审计专家已出具无保留完全核验通过结论（100% APPROVED & VERIFIED）；
2. 用户指出的 7 项核心痛点与缺陷已在底层机理层面被彻底根除；
3. 全 Workspace 96 项自动化测试与极端异构测试全部绿灯，构建与同源发布流程健全完好；
4. 系统已全面达到重构设计蓝图与客观整改决策的准出标准。

**主要决策专家（Decision Maker Agent）正式签发《客观整改终局验收授权令》：**

- **受令角色**：验收专家 Agent (`acceptance_tester`)
- **任务代号**：MathSlot Final Acceptance Review (Objective Overhaul)
- **阶段性质**：**终局全面系统与功能验收 (Final Formal Acceptance)**
- **授权核心内容**：
  1. 委托验收专家对本次客观整改涉及的全部 5 大任务模块开展独立、端到端、深度的终局验收；
  2. 针对高斯积分双重上标、Toolbar 独立视口与无限制缩放、括号 Smart Enter 状态机、极端异构光栅化以及双端构建产物进行逐条核验；
  3. **终局交付指示**：若本次逐项验收全部符合预期，验收专家应**正式签署并出具《MathSlot 客观整改终局验收通过报告》**，正式宣告 MathSlot 客观整改与深度重构圆满成功并达成最终交付！

---

## 3. 终局验收复核矩阵与执行指南 (Final Acceptance Verification Matrix)

验收专家（Acceptance Agent）在执行本次终局验收时，应严格对照下述 5 大模块的验证细则进行实操测试与结果记录：

| 模块编号 | 验收核心内容 | 关键验证手段与指标要求 | 验收预期结论 |
| :--- | :--- | :--- | :---: |
| **模块 1** | **高斯积分端到端与解析器** | 1. 验证直接粘贴 `▸i-oo;oo;e^-x^2 dx;= ▸r▸gp;` 导出 LaTeX 为标准 `e^{-x^2}`，绝不包含 `e^{-x}^{2}`；<br>2. 验证多层负号幂次（如 `2^-n^2`、`x^-a^b`、`e^-(x+1)^2`）解析为嵌套整体；<br>3. 验证 0..=len 全光标穷举预览下真实光栅化 100% 成功；<br>4. 确认界面示例库与预置中已无“高斯正态分布积分”或 `▸u-x^2` 残留。 | **必须 100% PASS** |
| **模块 2** | **预览栏 Toolbar 与视口容器** | 1. 确认已无悬浮 82pt 窄条 `ctrl_rect`，Header 栏独立居顶（左标题、右按键，宽度 $\ge 140\text{pt}$）；<br>2. 验证缩放按钮 `[ − ]`、`[ 100% ]`、`[ + ]` 交互灵敏，`fitted_size` 高度 clamp 已被彻底废除，大公式按 `+` 严格按几何比例等比放大；<br>3. 验证放大超出边界时，`ScrollArea::both()` 双向滚动条平滑工作，无截断、无遮挡。 | **必须 100% PASS** |
| **模块 3** | **括号 Enter 智能跳出状态机** | 1. 单层括号：输入 `(x + 1|)` 按 Enter，光标精确步进至右括号外侧；<br>2. 嵌套定界符：输入 `([x + 1|])` 连续按 Enter，逐层跳出 `]` $\to$ `)`；<br>3. 槽位协调：槽位内部书写括号先跳出括号，括号内部书写槽位先推进槽位；<br>4. 成对绝对值：输入 `|x + 1|` 按 Enter 精确跳出右侧。 | **必须 100% PASS** |
| **模块 4** | **极端异构高风险构型光栅化** | 1. 运行 `tests/extreme_heterogeneous_tests.rs` 包含的 7 大高风险测试；<br>2. 验证高斯积分、马氏距离、变上限微积分、空定界符求值线、异构矩阵单元格真实编译光栅化均输出有效非零尺寸位图；<br>3. 验证全工程 96 项测试 100% 绿灯。 | **必须 100% PASS** |
| **模块 5** | **生态同源构建与交付物检查** | 1. 运行 `node obsidian-mathslot/scripts/build.mjs`，验证 WASM 编译、内联打包与 Node 烟测通过；<br>2. 验证桌面端 `cargo build --release` 成功生成约 16MB 的可执行文件，软链接 `./mathslot` 权限正常；<br>3. 检查全局代码整洁无 warning，无未闭合调试代码。 | **必须 100% PASS** |

---

## 4. 签署与生效声明

- **签发人**：Decision Maker Agent (主要架构与产品决策专家)
- **状态**：**已正式签署并激活 (ACTIVATED)**
- **接收人**：Acceptance Tester Agent (终局验收专家) & 调度工作流

此令即刻生效，指示验收专家全权启动终局验收测试工作，并在验收完毕后签署终局交付报告！

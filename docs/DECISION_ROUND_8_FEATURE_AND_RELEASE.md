# MathSlot 架构与产品决策报告 (Round 8: 公式库海量扩充、槽位书写顺序、应用图标、存储架构与跨平台发布)

- **决策周期**：Round 8 (Feature Expansion & Cross-Platform Release)
- **决策角色**：Decision Maker Agent (系统架构师与产品专家)
- **目标版本**：MathSlot v0.6.1 (Production & Release Readiness)
- **关联文档**：
  - [REWRITE_DESIGN.md](file:///home/mat/Projects/mathslot-next/docs/REWRITE_DESIGN.md)
  - [FINAL_OVERHAUL_ACCEPTANCE_REPORT.md](file:///home/mat/Projects/mathslot-next/docs/FINAL_OVERHAUL_ACCEPTANCE_REPORT.md)
  - [README.md](file:///home/mat/Projects/mathslot-next/README.md)
  - [HELP.md](file:///home/mat/Projects/mathslot-next/HELP.md)

---

## 1. 决策背景与战略目标 (Executive Context & Objectives)

在完成 Round 7 的核心架构重构与大修验证后，MathSlot 的微内核解析器、事务编辑器与排版渲染管线已展现出极高的可靠性（单元测试与验收测试 100% 通过）。用户在此基础上提出了 5 项面向真实日常使用与跨平台分发的核心需求：
1. **示例公式纠正与槽位书写顺序严密规范**：
   - 彻底修复欧拉恒等式原代码中的基底在外、上标为空 Bug（从解析结果 $e \cdot i^\pi + 1 = 0$ 纠正为标准的 $e^{i\pi} + 1 = 0$）；
   - 全面审视并规范所有内建结构的槽位书写顺序，确保无死角契合人类自然书写与思维习惯；
2. **示例扩充为海量常用公式库 (Preset Library Modal / Panel)**：
   - 告别原先单一的“↻ 示例”低效点按轮播，升级为结构化、多学科分类的**【示例公式库模态窗口/面板 (Preset Library Modal)】**；
   - 海量扩充涵盖微积分、线性代数、概率统计、大学物理与场论、复变函数、离散数学等数十上百个经典科研与工程公式；
   - 建立自动化测试套件 `test_all_preset_corpus_compatibility`，确保海量公式 100% 具备无错解析与无损 LaTeX 导出；
3. **原生桌面与 Wayland 应用图标完美集成**：
   - 解决在 Fedora GNOME Wayland 环境下 Dock 与状态栏显示黄色默认齿轮/问号图标的系统痛点；
   - 设计 MathSlot 专属高品质图标（SVG 矢量原件 + 多分辨率 PNG 图标），并在 `main.rs` 中完整注册 `with_app_id("mathslot")` 与 `with_icon`；
   - 提供标准 `mathslot.desktop` 与自动化安装脚本 `scripts/install-desktop.sh`，实现 Linux 原生桌面的开箱即用；
4. **用户配置、片段与导入存储架构深度剖析与优化路线图**：
   - 梳理目前存储位置（遵循 XDG 规范 `~/.config/mathslot/library.json` 等）、格式规范与原子落盘机制；
   - 提出前瞻性架构优化方案（Schema 版本契约、配置/模版/历史记录分库解耦、Serde 现代化及容灾备份）；
5. **文档完善、GitHub 远程指向与跨平台 Release 流水线**：
   - 全面同步更新 `README.md` 与 `HELP.md`；
   - 配置 Git remote 指向 `git@github.com:TBDPS/MathSlot.git`；
   - 编写 GitHub Actions CI/CD 流水线（`.github/workflows/release.yml`），支持 Linux x86_64、Windows x86_64、macOS 以及 Obsidian Plugin WASM 的自动化多平台构建与发布。

---

## 2. Task 1: 示例公式纠正与槽位书写顺序规范

### 2.1 欧拉恒等式 Bug 深度归因与纠正

- **Bug 根源剖析**：
  - 核心定义：`StructKind::Sup` 在 `command.rs` 中声明的槽位角色为 `&["底数", "指数"]`，共两个槽位；在 `visual.rs` 与 `latex.rs` 中渲染为 `format!("{{{base}}}^{{{exp}}}")`。
  - 原代码错误写法：`"e▸ui▸gp;; + 1 = 0"`。
  - 解析行为：字符 `e` 被作为普通文本留在结构外侧，`▸u` 结构吞噬了第一槽位 `i`（底数）与第二槽位 `▸gp`（$\pi$，指数），生成了 LaTeX：`e {i}^{\pi} + 1 = 0`，排版显示为：
    $$e \cdot i^\pi + 1 = 0$$
    这严重偏离了数学常识！
- **纠正决策**：
  - 采用 MathSlot 结构化简码的标准写法：**`"▸ue;i▸gp;; + 1 = 0"`**。
    - 槽位 0 (底数)：`e`
    - 槽位 1 (指数)：`i▸gp`（即 $i\pi$）
    - 结构外推进闭合后追加：` + 1 = 0`
  - 规范生成的 LaTeX 为：`{e}^{i\pi} + 1 = 0`，排版显示为完美标准的：
    $$e^{i\pi} + 1 = 0$$
  - 同时在文档中阐明：MathSlot 亦支持自然幂次语法 **`e^(i▸gp) + 1 = 0`** 或 **`e^{i\pi} + 1 = 0`**，均可得到标准的欧拉恒等式。

### 2.2 全结构槽位书写顺序审计与规范表

经全面审视 `crates/mathslot-core/src/command.rs` 与人类数学手写习惯，现确立全结构槽位设计审计基准：

| 简码 | 结构名称 | 槽位定义顺序 | 人类自然书写思考流与设计依据 | 示例简码与输出 |
| :--- | :--- | :--- | :--- | :--- |
| `▸f` | 分数 (Frac) | `[分子, 分母]` | 读作“分之”，但书写与代码输入均自上而下，先分子后分母 | `▸fa;b;` $\to \frac{a}{b}$ |
| `▸r` | 根号 (Sqrt) | `[被开方式]` | 先画根号，内部填被开方式 | `▸rx;` $\to \sqrt{x}$ |
| `▸n` | N次根 (NthRoot) | `[根指数, 被开方式]` | 仿手写顺时针落笔：先写左上方根次 $n$，再写根号内表达式 | `▸n3;x;` $\to \sqrt[3]{x}$ |
| `▸u` | 上标 (Sup) | `[底数, 指数]` | 先写基底字母，再写其右上角指数 | `▸ue;x;` $\to e^x$ |
| `▸d` | 下标 (Sub) | `[主体, 下标]` | 先写主体变量，再写其右下角下标 | `▸da;k;` $\to a_k$ |
| `▸b` | 上下标 (SubSup) | `[主体, 下标, 上标]` | 先写主体，再写下标，最后写上标 | `▸bx;i;2;` $\to x_i^2$ |
| `▸i` | 定积分 (Integral) | `[下限, 上限, 被积式]` | 严格遵循积分落笔流：画完 $\int$ 后先写下限，再移至上限，最后写被积函数与微分算子 | `▸ia;b;f(x) dx;` $\to \int_a^b f(x) \,\mathrm{d}x$ |
| `▸s` | 求和 (Sum) | `[下限, 上限, 求和项]` | 标下底条件 $\to$ 标上顶终止 $\to$ 写求和通项 | `▸s1;n;a_k;` $\to \sum_{1}^n a_k$ |
| `▸ca`| 连乘 (Product) | `[下限, 上限, 连乘项]` | 逻辑与求和一致 | `▸ca1;n;x_i;` $\to \prod_{1}^n x_i$ |
| `▸l` | 极限 (Limit) | `[趋近变量, 趋近目标, 主体]` | 极限下标：从谁 ($x$) 趋近于什么 ($0$)，自动生成 $\to$，再写极限后方的主体函数 | `▸lx;0;▸fsin x;x;;` $\to \lim_{x \to 0} \frac{\sin x}{x}$ |
| `▸e` | 二项式 (Binom) | `[上标 n, 下标 k]` | 组合数括号内自上而下：上项 $n$，下项 $k$ | `▸en;k;` $\to \binom{n}{k}$ |
| `▸kg`| 代入求值杠 (EvalBar) | `[表达式, 下限, 上限]` | 先写主表达式，后写坚线右侧的下界与上界 | `▸kgF(x);a;b;` $\to \left. F(x) \right|_a^b$ |
| `▸cg`| 偏导分式 (PartialFrac)| `[分子, 分母]` | 先被导因变量，再对谁求偏导 | `▸cgy;x;` $\to \frac{\partial y}{\partial x}$ |
| `▸md`| 2分段函数 (Cases2) | `[式1, 条件1, 式2, 条件2]` | 自然阅读流：从上到下，每一行先写取值表达式，后写满足条件 | `▸mdx;x>0;-x;x<=0;` |
| `▸ma`| 2×2 矩阵 (Matrix2) | `[(1,1), (1,2), (2,1), (2,2)]` | 严格行优先 (Row-Major)，从左到右、从上到下逐元素填入 | `▸ma1;0;0;1;` |

- **结论**：MathSlot 已有的槽位定义顺序在数学语义与书写直觉上均达到最优，无需更改底层 AST 模型；重点在于彻底消除预置公式中的书写偏差，并在示例库和手册中树立权威示范。

---

## 3. Task 2: 示例扩充为海量常用公式库 (Preset Library Modal / Panel)

### 3.1 架构与数据模型升级

在 `src/app.rs` 或独立的 `src/presets.rs` 中重构预置公式数据架构，由原先简陋的静态数组切片升级为强类型、结构化的公式库：

```rust
pub struct PresetFormula {
    pub category: &'static str,  // 学科领域
    pub name: &'static str,      // 经典公式名称
    pub source: &'static str,    // MathSlot 极速流式简码
    pub desc: &'static str,      // 简要说明或学科背景
}
```

### 3.2 六大学科海量扩充清单 (40+ 经典权威公式)

1. **微积分与高等数学 (Calculus & Analysis)**：
   - 欧拉恒等式: `▸ue;i▸gp;; + 1 = 0`
   - 高斯积分: `▸i-oo;oo;e^-x^2 dx;= ▸r▸gp;;`
   - 微积分基本定理 (牛顿-莱布尼茨公式): `▸ia;b;f'(x) dx = ▸kgf(x);a;b; = f(b) - f(a)`
   - 重要极限一 (Sinc 函数): `▸lx;0;▸fsin x;x;; = 1`
   - 重要极限二 (自然常数 e): `▸lx;oo;▸p1 + ▸f1;x;;;^x = e`
   - 泰勒展开级数: `f(x) = ▸s0;n;▸ff^(k)(x_0);k!;(x - x_0)^k; + R_n(x)`
   - 多元全微分公式: `dz = ▸cgz;x; dx + ▸cgz;y; dy`
   - 格林公式 (平面闭曲线积分): `▸ccL;P dx + Q dy; = ▸cbD;▸p▸cgQ;x; - ▸cgP;y;;; dx dy;`
   - 斯托克斯旋度定理: `▸ccC;▸avF; * d▸avr; = ▸cbS;▸p▸od xx ▸avF;; * d▸avS;`
   - 高斯散度定理: `▸cbS;▸avF; * d▸avS; = ▸ce▸gW;▸p▸od * ▸avF;; dV;`
   - 伽马函数积分定义: `▸gG(z) = ▸i0;oo;t^(z-1) e^-t dt;`
   - 贝塔函数与伽马函数关系: `B(p, q) = ▸f▸gG(p) ▸gG(q);▸gG(p + q);`
   - 罗尔中值定理条件式: `f(a) = f(b) ==> ▸ex ▸gc in (a, b), f'(▸gc) = 0`
   - 柯西中值定理: `▸ff(b) - f(a);g(b) - g(a); = ▸ff'(▸gc);g'(▸gc);`

2. **线性代数与矩阵分析 (Linear Algebra & Matrix Analysis)**：
   - 一元二次方程求根公式: `x = ▸f-b +- ▸rb^2 - 4ac;;2a;`
   - 柯西-施瓦茨不等式: `▸p▸s1;n;a_k b_k;;^2 <= ▸p▸s1;n;a_k^2;; ▸p▸s1;n;b_k^2;;`
   - 二阶特征行列式: `▸mc▸gl - a;-b;-c;▸gl - d; = 0`
   - 矩阵特征值方程: `A ▸avx; = ▸gl ▸avx;`
   - 逆矩阵与伴随矩阵公式: `A^-1 = ▸f1;det(A); A^*`
   - 矩阵奇异值分解 (SVD): `A = U ▸gS V^T`
   - 3×3 单位阵: `▸mg1;0;0;0;1;0;0;0;1;`
   - 向量点积与夹角公式: `▸avu; * ▸avv; = ▸v▸avu;; ▸v▸avv;; cos ▸gt`
   - 向量叉积几何模长: `▸v▸avu; xx ▸avv;; = ▸v▸avu;; ▸v▸avv;; sin ▸gt`
   - 施密特正交化递推式: `▸avb;_k = ▸ava;_k - ▸s1;k-1;▸f▸ava;_k * ▸avb;_j;▸v▸avb;_j;^2; ▸avb;_j;`

3. **概率论与数理统计 (Probability & Statistics)**：
   - 贝叶斯全概率公式: `P(A|B) = ▸fP(B|A) P(A);P(B);`
   - 一维高斯正态分布密度函数: `f(x) = ▸f1;▸r2▸gp;; ▸gs; e^-▸f(x - ▸gm)^2;2▸gs^2;;`
   - 多维正态分布概率密度: `f(▸avx;) = ▸f1;(2▸gp)^(k/2) ▸v▸gS;^(1/2); exp▸p-▸f1;2; (▸avx; - ▸av▸gm;)^T ▸gS^-1 (▸avx; - ▸av▸gm;);`
   - 泊松分布概率分布律: `P(X = k) = ▸f▸gl^k e^-▸gl;k!;`
   - 二项分布概率质量函数: `P(X = k) = ▸en;k; p^k (1 - p)^(n - k)`
   - 切比雪夫不等式: `P(▸vX - ▸gm; >= ▸ge) <= ▸f▸gs^2;▸ge^2;`
   - 方差与协方差定义: `D(X) = E(X^2) - [E(X)]^2`
   - 连续随机变量数学期望: `E(X) = ▸i-oo;oo;x f(x) dx;`

4. **大学物理与场论 (Physics & Field Theory)**：
   - 麦克斯韦第一方程 (高斯电场定律): `▸od * E = ▸f▸gr;▸ge_0;`
   - 麦克斯韦第二方程 (高斯磁场定律): `▸od * B = 0`
   - 麦克斯韦第三方程 (法拉第电磁感应): `▸od xx E = -▸cgB;t;`
   - 麦克斯韦第四方程 (安培-麦克斯韦定律): `▸od xx B = ▸gm_0 J + ▸gm_0 ▸ge_0 ▸cgE;t;`
   - 薛定谔时间依赖波动方程: `i▸ol ▸cg▸gy;t; = ▸aaH; ▸gy`
   - 爱因斯坦质能方程: `E = m c^2`
   - 相对论能量动量四维关系: `E^2 = (p c)^2 + (m_0 c^2)^2`
   - 简谐阻尼振动微分方程: `m ▸ahx; + ▸gg ▸adx; + k x = 0`
   - 热力学第一定律微分形式: `dU = T dS - P dV`
   - 普朗克黑体辐射公式: `B(▸gn, T) = ▸f2 h ▸gn^3;c^2; ▸f1;e^(▸fh ▸gn;k_B T;) - 1;`

5. **复变函数与积分变换 (Complex Analysis & Transforms)**：
   - 柯西-黎曼微分条件: `▸cgu;x; = ▸cgv;y;, ▸cgu;y; = -▸cgv;x;`
   - 柯西复变积分公式: `f(z_0) = ▸f1;2▸gp i; ▸ccC;▸ff(z);z - z_0; dz;`
   - 留数定理: `▸ccC;f(z) dz = 2▸gp i ▸s1;n;Res(f, z_k);`
   - 傅里叶连续变换: `F(▸gw) = ▸i-oo;oo;f(t) e^(-i ▸gw t) dt;`
   - 傅里叶逆变换: `f(t) = ▸f1;2▸gp; ▸i-oo;oo;F(▸gw) e^(i ▸gw t) d▸gw;`
   - 单边拉普拉斯变换: `F(s) = ▸i0;oo;f(t) e^(-s t) dt;`
   - 复数欧拉公式极坐标展开: `e^(i ▸gt) = cos ▸gt + i sin ▸gt`

6. **离散数学、信息论与算法 (Discrete Math & CS)**：
   - 香农信息熵: `H(X) = -▸s1;n;P(x_i) log_2 P(x_i);`
   - 二项式展开定理: `(x + y)^n = ▸s0;n;▸en;k; x^(n-k) y^k;`
   - 斯特林阶乘近似公式: `n! ~= ▸r2▸gp n;; ▸p▸fn;e;;;^n`
   - 斐波那契通项 (比奈公式): `F_n = ▸f1;▸r5;;; ▸p▸p▸f1 + ▸r5;;2;;;^n - ▸p▸f1 - ▸r5;;2;;;^n;`
   - 容斥原理三集合形式: `▸vA uu B uu C; = ▸vA; + ▸vB; + ▸vC; - ▸vA nn B; - ▸vB nn C; - ▸vA nn C; + ▸vA nn B nn C;`
   - 主定理递归时间复杂度: `T(n) = a T▸p▸fn;b;;; + f(n)`

### 3.3 UI 交互体验设计

1. **顶部操作条重构**：
   - 拆解为两个功能按钮：
     - `↻ 换一个`（快速轮播按钮）：随手点击轮播切换（从全量预置库中快速循环加载）；
     - `📖 示例公式库`（大按钮）：点击唤出全新的 **Preset Library Modal**。
2. **Preset Library Modal 窗口规格**：
   - 尺寸：`860.0 x 600.0`，居中弹出，带阴影与遮罩；
   - 顶部搜索栏：实时关键词过滤（公式名称、学科或关键字）；
   - 分类筛选 Tab 条：【全部】、【微积分/高数】、【线性代数】、【概率统计】、【大学物理】、【复变变换】、【离散/算法】；
   - 列表展示卡片：每项包含公式名称、所属学科徽章、MathSlot 简码预览；
   - 卡片右侧动作区：
     - `[载入]`：清空并加载该公式到当前编辑器；
     - `[追加]`：在光标当前位置追加插入；
     - `[复制 LaTeX]`：一键将该公式编译后的标准 LaTeX 复制到剪贴板。

### 3.4 自动化测试套件构建 (`test_all_preset_corpus_compatibility`)

在 `crates/mathslot-core/src/lib.rs` 或 `tests/` 中配置自动化验证：
- 遍历预置库中所有公式：
  1. `parse_with_library(formula.source, &lib)` 必须顺利成功，禁止任何 `panic`；
  2. 生成的 LaTeX 绝不可为空，且不得包含未闭合的花括号或非法转义；
  3. 通过 `mathslot_latex` 驱动的纯 Rust 引擎执行渲染解析测试，确保排版管线全部绿灯通过。

---

## 4. Task 3: 原生桌面与 Wayland 应用图标完美集成

### 4.1 Wayland 下图标匹配机理与 Fedora 痛点剖析

- **Wayland 协议特性**：
  在传统 X11 下，应用直接将像素点位图设置给窗口属性 `_NET_WM_ICON`；但在 Wayland 下，合成器（GNOME Shell / Mutter / Sway）为了安全与规范，不从窗口客户端读取位图，而是**完全依靠窗口提交的 `app_id` 与桌面系统的 `.desktop` 文件进行关联**！
- **Fedora 出现黄色默认图标的原因**：
  1. 目前 `src/main.rs` 中的 `ViewportBuilder` 根本没有调用 `.with_app_id("mathslot")`，导致窗口在 Wayland 注册的 `app_id` 丢失或为默认空值；
  2. 没有在系统标准 XDG 目录（`~/.local/share/applications/`）中安装 `mathslot.desktop`；
  3. 图标没有安装至 `~/.local/share/icons/hicolor/...`，导致 GNOME 顶栏与 Alt-Tab 找不到资源，从而回退显示系统内置的黄色齿轮/问号图标。

### 4.2 图标设计与资源清单

- **视觉创意**：
  - 背景：深邃数学蓝底（`#1A2A44` 到 `#0F172A` 微渐变），现代圆角矩形（iOS/macOS squircle 规范）；
  - 核心图形：优雅的金色求和与积分槽位符号（黄金比例积分弧度 $\int$ 与槽位插块 $\text{\_}$），搭配明亮的青色（`#38BDF8`）数学导数点，极具辨识度与极客美感；
- **资源清单生成在 `assets/icons/`**：
  - `mathslot.svg`（高质量矢量母版）
  - `mathslot-256.png`（256×256 主图标）
  - `mathslot-128.png`（128×128）
  - `mathslot-64.png`（64×64）
  - `mathslot-48.png`（48×48）
  - `mathslot-32.png`（32×32）
  - `mathslot-16.png`（16×16）

### 4.3 二进制与桌面集成实施步骤

1. **`src/main.rs` 注入**：
   ```rust
   let icon = eframe::icon_data::from_png_bytes(
       include_bytes!("../assets/icons/mathslot-256.png")
   ).expect("Failed to load embedded icon");

   let options = eframe::NativeOptions {
       viewport: egui::ViewportBuilder::default()
           .with_app_id("mathslot") // Wayland 关联的关键键位
           .with_icon(icon)
           .with_inner_size([1240.0, 820.0])
           .with_min_inner_size([980.0, 640.0])
           .with_title("MathSlot · 超轻量流式简码公式编辑器"),
       renderer: eframe::Renderer::Glow,
       ..Default::default()
   };
   ```
2. **桌面入口文件 `assets/mathslot.desktop`**：
   ```ini
   [Desktop Entry]
   Name=MathSlot
   GenericName=Math Formula Editor
   Comment=Ultra-lightweight stream-first math formula editor
   Exec=mathslot %U
   Icon=mathslot
   Terminal=false
   Type=Application
   Categories=Education;Science;Math;Utility;
   StartupWMClass=mathslot
   Keywords=math;latex;formula;editor;
   ```
3. **自动化安装脚本 `scripts/install-desktop.sh`**：
   - 自动将 release 二进制软链或拷贝至 `~/.local/bin/mathslot`；
   - 自动将各分辨率 PNG 图标安装至 `~/.local/share/icons/hicolor/<size>/apps/mathslot.png`；
   - 自动将矢量 SVG 安装至 `~/.local/share/icons/hicolor/scalable/apps/mathslot.svg`；
   - 自动将 `mathslot.desktop` 安装至 `~/.local/share/applications/mathslot.desktop`；
   - 自动调用 `update-desktop-database` 与 `gtk-update-icon-cache` 刷新本地缓存。

---

## 5. Task 4: 用户配置、片段与导入存储架构说明与优化建议

### 5.1 当前存储机制与路径规范

- **存储目录**（严格遵循 XDG 跨平台规范）：
  - **Linux / Wayland / X11**：`$XDG_CONFIG_HOME/mathslot/`（缺省回退至 `~/.config/mathslot/`）；
  - **Windows**：`%APPDATA%\mathslot\`；
  - **macOS**：`$HOME/Library/Application Support/mathslot/` 或 `~/.config/mathslot/`。
- **存储文件**：`library.json`。
- **持久化内容**：
  1. `customFormats`：用户通过 `k▸` 扩展的自定义结构（触发键、标签、各槽位角色、LaTeX 模板 `$1..$N`、布局及自动拼接规则）；
  2. `snippets`：用户通过 `t▸` 保存的高频复用数学公式片段与填空模版。
- **当前写入安全机制**：
  - 采用临时文件写入 + 操作系统原子重命名（Atomic Rename: 写 `library.json.tmp` $\to$ `std::fs::rename` 覆盖），有效杜绝断电或崩溃导致的截断损坏。

### 5.2 潜在瓶颈与架构优化演进蓝图

为支撑 MathSlot 将来面向更大规模的用户自定义宏、团队模板共享以及历史记录管理，提出以下存储架构演进建议：

1. **Schema 契约化与自动迁移机制 (Versioned Schema Migration)**：
   - 当前 JSON 缺少顶层版本标识。建议在 JSON 根对象引入 `"schema_version": 1`；
   - 升级加载时设计版本迁移管道 `migrate_library(json_value) -> Result<UserLibrary, String>`，确保未来增减字段时旧版用户配置 100% 自动无损迁移。
2. **配置仓库解耦分离 (Decoupled Configuration Stores)**：
   - 将现有单一的 `library.json` 按变动频率与职责拆解为四大独立文件：
     - `~/.config/mathslot/`
       - `config.json`：存储通用偏好设置（主题 Dark/Light、渲染缩放比、LaTeX 定界符风格、窗口记忆尺寸）；
       - `library.json`：专注存储用户的核心资产（自定义格式与片段模版，低频修改，带自动 `.bak` 备份）；
       - `history.json`：输入历史记录（高频追加，滚动保留最近 100 条公式，不污染模版库）；
       - `keybindings.json`：用户按键映射文件（支持自定义 leader 键或快捷键）。
3. **Serde 序列化与轻量 WASM 特性隔离 (Cargo Feature Partitioning)**：
   - 目前使用手写 JSON 是为了 WASM 的极致体积（~几十KB）；
   - 建议在 `Cargo.toml` 中增加可选特性 `feature = ["serde"]`，桌面端采用标准强类型 `serde` / `serde_json`，WASM 端可按需开启或继续保留极轻 parser，实现类型安全与体积控制的最佳平衡。
4. **自动双重容灾备份 (Auto-Recovery & Backup)**：
   - 在每次保存前，将上一版有效文件复制为 `library.json.bak`；当主文件遭遇外部人为误改损坏时，可弹出提示一键恢复备份。

---

## 6. Task 5: 文档检查、上传 GitHub 与跨平台发布

### 6.1 文档同步更新

- **`README.md`**：
  - 补充【示例公式库】章节，介绍 40+ 覆盖微积分、线代、概率、物理等领域的权威公式；
  - 补充【Fedora / Wayland 原生桌面集成】说明与一键安装脚本执行命令；
  - 补充【跨平台 Releases 下载】说明（Linux, Windows, macOS, Obsidian Plugin）。
- **`HELP.md`**：
  - 更新欧拉恒等式规范书写（`▸ue;i▸gp;; + 1 = 0`）；
  - 补充各核心结构的槽位顺序与书写直觉指引表；
  - 增加【示例公式库】的使用与搜索快捷键说明。

### 6.2 Git Remote 配置

- 执行命令将远程仓库指向目标地址：
  ```bash
  git remote add origin git@github.com:TBDPS/MathSlot.git || git remote set-url origin git@github.com:TBDPS/MathSlot.git
  ```

### 6.3 GitHub Actions 跨平台 Release 构建流水线 (`.github/workflows/release.yml`)

建立专业、自动化的一站式跨平台打包流水线：
- **触发机制**：推送版本 tag（如 `v0.6.1`）或手动点击 `workflow_dispatch`；
- **矩阵任务 (Build Matrix)**：
  1. `build-linux-x86_64`：运行于 `ubuntu-24.04`，安装 X11 与 Wayland 基础库，构建 release 二进制，打包为 `mathslot-linux-x86_64.tar.gz`（含 `mathslot` 可执行文件、`mathslot.desktop`、全套图标与 `install-desktop.sh`）；
  2. `build-windows-x86_64`：运行于 `windows-latest`，构建 release 二进制，打包为 `mathslot-windows-x86_64.zip`（含 `mathslot.exe`、README、HELP）；
  3. `build-macos`：运行于 `macos-latest` (Apple Silicon M系列)，构建 release 二进制，打包为 `mathslot-macos-aarch64.tar.gz`；
  4. `build-obsidian-plugin`：运行于 `ubuntu-latest`，安装 `wasm-pack`，在 `crates/mathslot-wasm` 下编译零依赖 WASM，与 `obsidian-mathslot/` 资源集成打包为 `mathslot-obsidian-plugin.zip`（含 `manifest.json`, `main.js`, `styles.css`）；
  5. `publish-release`：汇集所有平台的归档制品，利用 `softprops/action-gh-release` 自动创建 GitHub Release 并附带格式化更新说明。

---

## 7. 实施工单拆解 (Implementation Work Breakdown)

为确保实施过程有条不紊、零返工，决策指令拆解为以下实施工单交由 Implementer Agent 执行：

- **工单 8.1（示例修正与全量测试套件）**：
  - 纠正 `crates/mathslot-core/src/lib.rs` 与 `src/app.rs` 中的欧拉恒等式为 `▸ue;i▸gp;; + 1 = 0`；
  - 建立海量预置公式库数据结构（包含 6 大学科领域 40+ 经典公式）；
  - 在 `crates/mathslot-core/src/lib.rs` 编写 `test_all_preset_corpus_compatibility` 验证所有预置公式。
- **工单 8.2（示例公式库 UI 升级）**：
  - 在 `src/modals.rs` 与 `src/app.rs` 中实现 `PresetLibraryModal`；
  - 提供学科分类筛选、关键字搜索、一键载入、追加插入与复制 LaTeX 交互；
  - 顶部操作栏提供 `📖 示例公式库` 与 `↻ 换一个` 快速轮播。
- **工单 8.3（Wayland 原生图标与桌面配置）**：
  - 编写生成图标脚本，在 `assets/icons/` 生成标准 SVG 与多尺寸 PNG 图标；
  - 在 `src/main.rs` 中注册 `.with_app_id("mathslot")` 与 `.with_icon`；
  - 编写 `assets/mathslot.desktop` 与自动化安装部署脚本 `scripts/install-desktop.sh`。
- **工单 8.4（存储架构说明与建议归档）**：
  - 将存储架构说明与演进建议正式归档至相关模块与文档。
- **工单 8.5（文档、Git Remote 与 GitHub Actions 流水线）**：
  - 更新 `README.md` 与 `HELP.md`；
  - 配置 git remote 指向 `git@github.com:TBDPS/MathSlot.git`；
  - 编写 `.github/workflows/release.yml` 跨平台发布工作流并确保本地验证通过。

---

*决策制定完成，即刻发出实施指派！*

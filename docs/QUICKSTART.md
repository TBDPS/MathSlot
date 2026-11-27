# MathSlot v2 快速开始指南

5 分钟上手 MathSlot，无需记忆复杂语法，用最自然的键盘流写出出版级 LaTeX 公式。

---

## 第一步：安装与启动

- **Fedora 桌面版**：
  ```bash
  sudo dnf install ./MathSlot-2.0.0-1.x86_64.rpm
  ```
  启动后可点击右上角 **图钉图标** 将窗口置顶，方便边写论文/笔记边录入公式。
- **Obsidian 插件**：
  将 `main.js`、`styles.css`、`manifest.json` 复制到 `<Vault>/.obsidian/plugins/mathslot/` 并在设置中启用。点击左侧边栏 `Σ` 图标或使用命令面板「打开公式编辑器」即可使用。

---

## 第二步：只需记住 4 条直觉规则

### 1. 日常符号直接打，不用切模式
- **分数**：打 `1/2` 自动变 2D 分数 `\frac{1}{2}`；打 `sin x/x` 自动变 `\frac{\sin x}{x}`。
- **上下标**：打 `x^2`、`a_n`、`x_i^2` 自动生成；`_` 和 `^` 会自动合并为上下标。
- **括号**：打 `(`、`[`、`{` 自动补全配对；内含分式/积分时自动升级为 `\left(...\right)`；在末尾再敲 `)` / `]` / `}` 自动跳出。
- **常用词与简写**：独立词自动识别，绝不破坏普通英文单词（如 `spin` 保持原样）：
  - `pi` → $\pi$，`alpha` → $\alpha$，`oo` → $\infty$，`dx` → $\,\mathrm{d}x$（直立微分符；`da`、`dA` 等同理）
  - 词内空格是分隔符，不产生可见间距：`d x` 表示字面量 d 与 x / d 乘 x，而不是微元 `dx`
  - `->` → $\to$，`<=` → $\le$，`>=` → $\ge$，`!=` → $\neq$，`+-` → $\pm$，`...` → $\cdots$，`:::` → $\vdots$，`ddots` → $\ddots$

### 2. `Enter`（或 `;`）永远是「下一步 / 跳出一层」
- 在槽位内按 **`Enter`**（或 `;`）：跳到当前结构的下一个槽位；若是最后一个槽位，则**精确跳出当前这一层**。
- 按 **`Shift + Enter`**（或 `Shift + Tab`）：退回上一槽位。
- 在最外层按 **`Enter`**：换行，并自动生成等号对齐的 `\begin{aligned}` 多行公式。

### 3. `Tab` 呼出结构，二级菜单按 1 个字母即用
- **一级高频结构（按 `Tab` + 1 个字母）**：
  - `Tab f` 分数 · `Tab r` 根号（二次/N次合一） · `Tab b` 上下标
  - `Tab i` 积分（定/不定合一） · `Tab s` 求和 · `Tab l` 极限 · `Tab e` 二项式
  - `Tab v` 绝对值（圆括号直接输入 `(` 即可）
- **二级菜单（10 大均衡分类，按 `Tab` + 1 个分类字母立即渲染默认结构，二键免 Shift 变形）**：
  - `Tab c` 微积分（默认偏导 $\frac{\partial \square}{\partial \square}$） · `Tab m` 矩阵分段（默认 `2×2 矩阵`）
  - `Tab z` 定界与狄拉克（默认 `[x]`，`k/l/i` 输入 $|\psi\rangle,\langle\phi|,\langle\phi|\psi\rangle$） · `Tab a` 顶底标饰（默认 $\hat{x}$，`c` 变 $\vec{x}$）
  - `Tab h` 字体数域排版（默认 `\text{}`，`b/c/d` 粗/花/黑板体，`w/e/p` $\mathbb{R},\mathbb{E},\mathbb{P}$） · `Tab y` 箭头映射（默认 $\to$，`j–n` 长箭头）
  - `Tab o` 运算几何（默认 $\pm$） · `Tab x` 等式不等式（默认 $\approx$） · `Tab q` 集合逻辑（默认 $\cup$） · `Tab g` 希腊字母（默认 $\alpha$）

### 4. 习惯写原生 LaTeX？照打就行！
直接输入 **`\int_`**、**`\int `**、**`\frac{`**、**`\sqrt[`**、**`\sum_`**、**`\alpha_1`**、**`\vec `**、**`\vdots `**、**`\pmatrix `**，按空格 / 回车 / `_` / `{` / `[` 后会实时转为可交互的 2D MathSlot 结构。

---

## 第三步：3 个实战演练

### 演练 1：智能缺省（二次根号、立方根、不定积分）
1. **二次根号 $\sqrt{x + 1}$**：`Tab r` → 打 `x+1` → 按 `→` 直接跳出（或按两次 `Enter` 跳过空根指数）。
2. **随时升级为立方根 $\sqrt[3]{x + 1}$**：把光标移入 $x+1$ 内，按 **`↑`** 弹出根指数槽，打 `3` 即可！
3. **不定积分 $\int f(x)\,\mathrm{d}x$**：`Tab i` → `Enter`（跳过下限）→ `Enter`（跳过上限）→ 打 `f(x) dx` → `Enter`。

### 演练 2：快速打出傅里叶级数
目标公式：
$$f(x) \sim \frac{1}{2l} \int_{-l}^{l} f(x)\,\mathrm{d}x + \sum_{n=1}^{\infty} \left[\left(\frac{1}{l} \int_{-l}^{l} f(x) \cos \frac{n \pi x}{l}\,\mathrm{d}x\right) \cos \frac{n \pi x}{l} + \left(\frac{1}{l} \int_{-l}^{l} f(x) \sin \frac{n \pi x}{l}\,\mathrm{d}x\right) \sin \frac{n \pi x}{l}\right]$$

按键流：
1. 打 `f(x) ~ 1/2l` → `Enter`
2. `Tab i` → `-l` `Enter` `l` `Enter` → `f(x) dx` `Enter`
3. 打 ` + ` → `Tab s` → `n=1` `Enter` `oo` `Enter`
4. 打 `[(` → `1/l` `Enter` → `Tab i` `-l` `Enter` `l` `Enter` `f(x) cos n pi x/l` `Enter` ` dx` `Enter`（跳出积分，仍在圆括号内！）→ `)`（跳出圆括号）→ ` cos n pi x/l` `Enter`
5. 同法补上 `+ (...) sin ...` → `]` → `Enter` 完成！

### 演练 3：n 阶范德蒙德行列式
1. 打 `V_n` `Enter` ` = `
2. 按 **`Tab m j`** 插入 4×4 省略行列式（`⋯`、`⋮`、`⋱` 已预填好！）
3. 第一行填 `1` `Enter` `1` `Enter` `Enter` `1` `Enter`
4. 第二行填 `x_1` `Enter` `Enter` `x_2` `Enter` `Enter` `Enter` `x_n` `Enter`
5. 按 **`Shift + ↓`** 在下方插入第三行，填入 `x_1^2`、`x_2^2`、`...`、`x_n^2`
6. 按 `↓` 跳到底行填入 `x_1^{n-1}`、`x_2^{n-1}`、`x_n^{n-1}` —— 完成！

---

## 第四步：一键导出

- **`Ctrl + Enter`** 或右上角 **复制**：复制格式化 LaTeX（在 Obsidian 中直接插入/替换到笔记光标处）。
- 底部源码栏右侧按钮：
  - `$…$`：切换输出包裹格式（纯 LaTeX / `$…$` / `$$…$$` / ` ```latex `）
  - **`Word`**：复制标准 MathML，直接 `Ctrl+V` 粘贴到 Word / WPS 公式区
  - **`PNG`**：复制 3 倍超清透明背景 PNG 图片，直接粘贴到微信 / PPT / 飞书

需要深入定制外部配置文件、跳转导航或完整快捷键表，请参阅 **[详细使用手册（GUIDE.md）](GUIDE.md)**。

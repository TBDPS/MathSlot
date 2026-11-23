# MathSlot v2.1

**视觉直觉优先、键盘流全控、出版级 LaTeX 排版的数学公式工作台。**  
桌面端（原生 Tauri 2，提供 Linux `.rpm`/`.deb`/`.AppImage`、Windows `.exe`/`.msi`、macOS `.dmg`）与 Obsidian 插件（零 WASM，纯 JS/CSS）双端同源。

- 🚀 **[5 分钟快速开始（QUICKSTART.md）](docs/QUICKSTART.md)** — 从安装到亲手打出傅里叶级数、范德蒙德行列式
- 📖 **[详细使用手册与键位速查（GUIDE.md）](docs/GUIDE.md)** — 完整快捷键、智能缺省、LaTeX 兼容、外部 `presets.json` / `commands.json` 配置

---

## 界面预览

### 亮色主工作台（范德蒙德行列式 + 层级虚线框 + 左侧悬浮编辑栏 + 多行 LaTeX 栏）
![MathSlot 亮色主工作台](docs/images/desktop-hero-light.png)

### 暗色模式 & 二级菜单即时默认与无缝变形（`Tab m`）
![MathSlot 暗色模式与二级菜单](docs/images/desktop-dark-popover.png)

### 命令与 89+ 预置公式库（`Ctrl+K`，支持外部 JSON 热重载）
![MathSlot 命令与预置公式库](docs/images/preset-library.png)

---

## 核心特性

- **2D 实时所见即所得 + 层级虚线框**：直接基于 KaTeX 2D 画布编辑，清晰展示嵌套结构边界，支持点击/拖拽/双击选中、画布缩放（`Ctrl+滚轮`）与长公式横向滚动。
- **左侧悬浮编辑栏 + 多行自适应 LaTeX 源码栏**：撤销/重做、分层跳转、层级框开关、清空画布纵向悬浮在画布左上角；底部 LaTeX 源码栏支持自动换行、随长公式自适应增高、展开收起与 `Shift+Enter` 换行编辑。
- **智能缺省与复用**：
  - `Tab r` 统一二次根号与 N 次根号（根指数留空自动按 `\sqrt{x}` 渲染，填写或按 `↑` 补填即成 `\sqrt[n]{x}`）。
  - `Tab i` 积分、`Tab s` 求和、`Tab b` 上下标等均支持可选槽位自动省略，跳过上下限直接得不定积分 `\int f(x)\,\mathrm{d}x`、单下限求和 `\sum_{i\in S} a_i`。
- **二级菜单单字母即时默认 + 无缝变形**：按 `Tab m` 立即在画布渲染默认 `2×2 矩阵`，直接打 `1 Enter 2…` 自动透传输入；若紧接着按第二键（如 `d` 分段函数、`j` 省略行列式），原地无缝替换。
- **LaTeX 原生命令兼容**：支持直接输入 `\int_`、`\int `、`\frac{`、`\sqrt[`、`\sum_`、`\alpha_1`、`\vdots `、`\pmatrix ` 等标准 LaTeX 命令并实时转为 2D 交互结构。
- **自然输入 & 零误伤简写**：
  - 直接键入 `/` 转分数、`^` / `_` 转上下标、`()` / `[]` / `{}` 自动补全且随高度自适应 `\left...\right`。
  - 独立词识别 `pi → π`、`oo → ∞`、`dx → \,\mathrm{d}x`、`... → ⋯`、`::: → ⋮`、`ddots → ⋱`，绝不误伤 `spin`、`spi`、`foo` 等普通单词。
- **动态矩阵 & 键盘全向增删行列**：任意 R×C 矩阵与 N 行分段函数，内部按 **`Shift + ↑ / ↓ / ← / →`** 四方向增行列，**`Ctrl + Shift + ↑ / ↓ / ← / →`**（或 `Alt+Backspace` / `Alt+Shift+Backspace`）秒删当前行/列；内置 `Tab m i` 省略矩阵与 `Tab m j` 省略行列式模板。
- **分层 `Esc` 跳转导航**：按 `Esc` 呼出当前层级的字母角标（支持复合结构逐层下钻、普通文本项直接跳转、以及 `Alt+←`/`Alt+→` 跳转历史回溯）。
- **开放外部公式库 & 命令库**：支持软件内直接增改删，也支持直接编辑配置目录中的 `presets.json` 与 `commands.json` 并一键热重载，无需改代码或重新编译。
- **Obsidian 深度集成**：光标位于行内 `$...$`、块级 `$$...$$` 乃至引用块 / Callout（`> $$`、`> > $$`、`> [!note]`）内时，自动剥离 `> ` 载入并在写回时完整保留引用前缀。
- **多格式一键导出**：纯 LaTeX / `$…$` / `$$…$$` / ` ```latex `、**Word 公式（MathML）**、**3× 高清 PNG 图片**，以及多行推导自动对齐 `\begin{aligned}`。

---

## 安装与使用

### 1. 桌面端安装包（GitHub Releases 自动构建）

前往 **[GitHub Releases](../../releases)** 下载对应平台的安装包：
- **Linux**：`.rpm`（Fedora / RHEL）、`.deb`（Ubuntu / Debian）、`.AppImage`（通用便携版）
- **Windows**：`.exe`（NSIS 安装包） / `.msi`
- **macOS (Apple Silicon)**：`.dmg`

例如 Fedora 下本地安装 RPM：
```bash
sudo dnf install ./MathSlot-2.1.0-1.x86_64.rpm
```

### 2. Obsidian 插件（零 WASM）

从 Releases 下载 `mathslot-obsidian-2.1.0.zip`（或将 `apps/obsidian/dist/` 内的 `main.js`、`styles.css`、`manifest.json` 三个文件）解压到你的仓库插件目录：

```text
<你的 Obsidian 仓库>/.obsidian/plugins/obsidian-mathslot/
```

在 Obsidian「设置 → 第三方插件」中启用 **MathSlot** 即可。

### 3. 从源码开发与构建

```bash
# 安装依赖
npm install

# 运行全部核心单测（含全量命令与预置公式 KaTeX 渲染验证）及类型检查
npm run test
npm run check --workspace=@mathslot/obsidian

# 开发模式启动桌面前端
npm run dev

# 构建桌面前端 + Obsidian 插件（产物位于 apps/obsidian/dist/）
npm run build

# 打包 Fedora RPM 安装包
npm run build:rpm
```

---

## 仓库结构

- `packages/core` — 纯 TypeScript 同步内核（树状槽位 AST、129 条命令、89 条预置公式、智能缺省、LaTeX 双向解析与出版级导出、Obsidian 引用块公式识别、外部 JSON 库合并）
- `packages/ui` — 共享 Svelte 5 + KaTeX 2D 公式工作台（画布、左侧悬浮编辑栏、层级虚线框、快捷栏、命令与公式库搜索面板、多行 LaTeX 栏、Word MathML / 高清 PNG 导出）
- `apps/desktop` — Tauri 2 桌面端外壳（Linux Wayland 图标集成、PNG 剪贴板写入、外部配置文件读写与目录打开、跨平台打包）
- `apps/obsidian` — Obsidian 纯 JS 插件（零 WASM、光标处与引用块/Callout 公式原位识别与替换）
- `docs/` — [快速开始](docs/QUICKSTART.md)、[详细帮助手册](docs/GUIDE.md) 与 [界面截图](docs/images/)

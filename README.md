# MathSlot · 超轻量流式简码公式编辑器（原生桌面端 + Obsidian 插件同源）

**MathSlot** 是一款用 Rust 编写的“书写流优先、零语法死记、免鼠标点选”数学公式编辑器，采用 **Rust 同源双端架构**：
- **超轻量原生桌面端**：基于 `eframe` + 纯 Rust 数学排版引擎 `latex-rust`（内嵌 STIX Two Math 字体，零 Typst 巨型编译器依赖、零系统 WebKit 依赖）；
- **Obsidian 插件端 (`obsidian-mathslot/`)**：将同一套 [`crates/mathslot-core`](./crates/mathslot-core/) 编译为 ~70 KB 的零依赖 WASM 内联进插件，直接复用 Obsidian 内置 MathJax 渲染并支持 `Ctrl+Enter` 一键插入笔记光标处（桌面端与移动端 Obsidian 通用）。

## 核心特性

1. **高频单字母直达 + 二级菜单默认项**：
   - **12 个高频结构单字母直达**：按 `Tab` 插入前导符 `▸` 后，仅需 **1 个字母**即可生成常用结构（`▸f` 分数、`▸r` 根号、`▸i` 定积分、`▸s` 求和、`▸l` 极限、`▸u` 上标、`▸d` 下标、`▸b` 上下标、`▸p` 括号、`▸v` 绝对值、`▸n` N次根、`▸e` 二项式系数 `\binom`）。
   - **极限趋向箭头零记忆输入**：`▸l`（极限）原生设为三槽位 **`趋近变量 ; 趋近目标 ; 主体`**，自动生成 `\to`（`→`），如 `▸lx;0;▸fsin x;x;` 直接输出 `\lim_{x \to 0} \frac{\sin x}{x}`；单独输入趋向箭头可直接敲 ASCII 简写 **`->`** 或按 `Tab o b`（`▸ob`）。
   - **7 组二级子菜单均带 ★默认项**：低频或成组条目归入 `c`（更多积分/连乘）、`m`（矩阵/分段）、`a`（标注/定界）、`g`（希腊字母）、`o`（常用符号）、`x`（关系符/箭头）、`q`（集合/逻辑），展开子菜单后按 `Enter` 或 `Space` 一键选用默认项。
2. **嵌套根号/分式精确层级框 + 实时绿色光标 `∣`**：
   - 实时预览会将光标当前所处的**最内层活跃槽位**整体包裹在柔和绿色作用域框内，并在精确字符处显示绿色光标竖线 `∣`：
     - `▸r1+▸rx`（光标在内层根号）$\to$ 仅内层 `x ∣` 绿框高亮；
     - `▸r1+▸rx;`（按一次 `Enter` 退出内层根号）$\to$ 外层根号 `1 + √x ∣` 整体绿框高亮；
     - `▸r1+▸rx;;`（再按一次 `Enter` 退出全部根号）$\to$ 绿框消失，光标 `∣` 明确落于所有根号之外。
3. **前置智能主体包裹 (Smart Prepend)**：
   - 先写好主体（如 `▸fsin x;x; = 1`），再按 `Esc a` 跳到最前面插入 `Tab l`（极限）：**自动将已有式子作为极限主体**，等号右侧保留在外，光标留在条件槽填 `x` 与 `0`；`Ctrl+Z` 可随时退回未包裹状态。积分 `Tab i`、求和 `Tab s`、分数 `Tab f` 同样适用。
4. **增强导航与 2D 直觉穿梭**：
   - **行首 `[a]` / 行尾 `[;]`**：`Esc a` 跳到行首，`Esc ;` (或 `.`) 跳到行尾；
   - **返回上一个跳转位置 `[-]`**：`Esc -`（或编辑态 `Alt+←`）在刚才位置与当前位置间乒乓对调，编辑位移自动跟踪；
   - **2D 方向键穿槽**：`↑`/`↓` 在分子↔分母、上下限、上下标、极限条件↔主体、矩阵行间穿梭；`←`/`→` 原子跳过结构指令前缀。
5. **零改源码扩展新格式 (`[k▸]`) 与公式模版复用 (`[t▸]`)**：
   - **自定义数学格式**：用 `$1`, `$2`… 模板语法定义任意 LaTeX 宏，永久保存在 `~/.config/mathslot/library.json`；
   - **一键存模版**：点击「+存片段」(`Ctrl+Shift+S`) 一键保存光标处子结构或整行公式，填空模版调用时自动落位空槽。
6. **顶部锁高防抖速查表（焦点常驻不丢失）**：顶部面板高度恒定锁死，切换子菜单或跳转态时零位移、零闪烁，全程守护输入框焦点。
7. **底部双视图实时对照**：左栏实时展示**方案 A 函数式括号展开**核对层次，右栏实时输出 **LaTeX**（裸代码 / `$…$` / `$$…$$`）。

> [!TIP]
> 完整操作教程、所有快捷键映射及配置示例请参阅 **[使用手册 HELP.md](./HELP.md)**。

## Workspace 目录结构

```text
mathslot/
├── crates/
│   ├── mathslot-core/     # 100% 纯 Rust 核心引擎（AST / 解析 / 流编辑 / LaTeX / 方案A / 双方言视觉渲染）
│   └── mathslot-wasm/     # 零依赖 WASM 桥接层（编译至 wasm32-unknown-unknown）
├── src/                   # 原生超轻量桌面端（eframe + latex-rust）
└── obsidian-mathslot/     # 开箱即用的 Obsidian 插件（manifest.json + styles.css + 自包含 main.js）
```

## 编译与使用

### 1. 原生超轻量桌面端

```bash
cargo test --workspace
cargo run --release
```

### 2. 构建与安装 Obsidian 插件

```bash
# 重新编译 WASM 并打包自包含插件（含自动化端到端验证）
node obsidian-mathslot/scripts/build.mjs

# 安装到你的 Obsidian 知识库（替换 /path/to/your/vault）
mkdir -p "/path/to/your/vault/.obsidian/plugins/mathslot"
cp obsidian-mathslot/manifest.json obsidian-mathslot/styles.css obsidian-mathslot/main.js \
   "/path/to/your/vault/.obsidian/plugins/mathslot/"
```

然后在 Obsidian **设置 → 第三方插件** 中刷新并启用 **MathSlot Formula Editor**：
- 点击左侧工具栏 **$\Sigma$ 图标**，或按 `Ctrl/Cmd+P` 搜索 **`MathSlot`** 打开流式公式编辑器（亦可为其绑定全局快捷键如 `Alt+M`）；
- 输入完成后按 **`Ctrl+Enter`（macOS `Cmd+Enter`）** 直接将公式插入当前笔记光标处（`Esc` 在弹窗内用于槽位跳转，`Shift+Esc` 关闭弹窗）。

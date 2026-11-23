# MathSlot v2

视觉直觉优先、键盘流全控的数学公式编辑器。支持 **桌面端（支持 `.rpm` 安装包）** 与 **Obsidian 零 WASM 插件** 双端同源。

## 架构概览

- `packages/core` — 纯 TypeScript 同步内核（树状槽位 AST、121 条命令、88 条预置公式、自然 `/` 分数与 `^`/`_` 上下标、可自定义槽位填空顺序（如先分母后分子）、智能包裹、Easymotion 跳转、双向 LaTeX 解析与导出）。
- `packages/ui` — 共享 Svelte 5 + KaTeX 视觉公式工作台（2D 公式内直接光标编辑与点击定位、常驻视觉符号快捷栏与分类弹层、按需 `which-key` 键盘流提示、Spotlight 搜索面板、同步 LaTeX 源码栏、浅色/深色主题）。
- `apps/desktop` — 极薄 Tauri 2 桌面外壳（仅负责原生窗口、剪贴板与本地配置存储，原生支持打包 `.rpm`）。
- `apps/obsidian` — 纯 JS Obsidian 插件（零 WASM，直接产出 `dist/main.js`、`dist/styles.css`、`dist/manifest.json`）。

## 常用命令

```bash
# 安装依赖
npm install

# 运行核心单测（含全部 121 命令与 88 预置的 KaTeX 实测渲染）与类型检查
npm run test

# 开发调试桌面前端
npm run dev

# 构建桌面前端与 Obsidian 插件（产物位于 apps/obsidian/dist/）
npm run build

# 构建 Fedora / RPM 桌面安装包
npm run build:rpm
```

## 默认快捷键

| 按键 | 动作 |
| :--- | :--- |
| `Tab` | 呼出浮动命令提示（`f` 分数、`r` 根号、`i` 积分、`l` 极限、`g` 希腊字母、`m` 矩阵…） |
| `Enter` / `;` | 推进至下一槽位 / 跳出当前结构（顶层 `Enter` 换行） |
| `Shift+Enter` / `Shift+Tab` | 返回上一槽位 |
| `Esc` | 进入/退出公式内字母跳转模式 |
| `Ctrl+K` | 打开命令、预置公式与片段搜索面板 |
| `Ctrl+Enter` | 复制格式化 LaTeX（Obsidian 内直接插入笔记光标处） |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销 / 重做 |

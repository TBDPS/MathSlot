# MathSlot Obsidian 插件（`obsidian-mathslot`）

`obsidian-mathslot` 是 MathSlot 的 Obsidian 插件发行目录，基于共享 Svelte 5 / CodeMirror 6 前端（`packages/ui`）与同源 Rust 核心编译而成的 WebAssembly（`crates/mathslot-wasm`），提供与桌面端一致的流式简码输入、结构化槽位导航、LaTeX 导入诊断与预置公式库能力。

---

## 版本与权威指标

<!-- BEGIN GENERATED: metadata -->
| 指标 | 当前权威值 | 唯一事实源 (SSOT) |
| :--- | :--- | :--- |
| **工作区 / 桌面端版本** | `0.7.0` | `Cargo.toml` (`[workspace.package].version`) |
| **Obsidian 插件版本** | `0.7.0` (Obsidian ≥ `1.4.0`) | `obsidian-mathslot/manifest.json` |
| **开源协议** | `MIT OR Apache-2.0` | `Cargo.toml` (`[workspace.package].license`) |
| **流式命令总数** | `121` 条 / `8` 大分类 | `catalog/commands.toml` |
| **内置预置公式** | `88` 条 / `9` 大分类 | `catalog/presets.json` |
| **配置库 Schema 版本** | `schema_version = 3` | `crates/mathslot-store/src/lib.rs` |
<!-- END GENERATED: metadata -->

---

## 核心功能与架构特点

1. **同源 Rust WASM 内核（零外部网络依赖）**
   - 由 `crates/mathslot-wasm` 通过 `wasm-bindgen` 编译为浏览器/Obsidian 可执行的 WASM，并以 Base64 内联进单文件 `main.js`（严格控制体积预算 ≤ 400 KB）；
   - 运行在 Obsidian 沙箱内，全量包含 121 条命令目录与 88 条预置公式。
2. **Obsidian 渲染优先 + MathJax 3 SVG 回退**
   - 渲染适配器（`apps/obsidian/src/hostRenderAdapter.ts`）优先调用 Obsidian 原生 `renderMath` / `finishRenderMath`，在不支持或独立预览上下文时自动回退至共享 `packages/ui` 的 MathJax 3 SVG 管线；
   - 支持注册 `mathslot` Markdown 代码块处理器，直接将存储的流式源码渲染为数学公式块。
3. **三条 Obsidian 命令与侧边栏入口**
   - 左侧功能区提供 `∑` 图标入口（默认以行内公式 `$...$` 模式打开弹窗）；
   - 命令面板注册三条命令：
     - `Open MathSlot (Inline)`（`open-mathslot-inline`）
     - `Open MathSlot (Display)`（`open-mathslot-display`）
     - `Open MathSlot (Import LaTeX)`（`open-mathslot-import`）
   - 打开前若编辑器已有选中文本，自动预载入供编辑或逆向导入。
4. **插件持久化与损坏保护**
   - 配置、用户片段与主题偏好持久化在 Obsidian 插件数据（`data.json`），由 `apps/obsidian/src/storage.ts` 执行导入/导出校验与损坏隔离保护。

---

## 快捷键与交互说明

<!-- BEGIN GENERATED: shortcuts -->
> 默认快捷键取自 `crates/mathslot-store/src/lib.rs`（`ShortcutSettings::default()`），可在共享「设置」面板中自定义；`Mod` 在 macOS 上对应 `Cmd`，在 Linux / Windows 上对应 `Ctrl`。

| 作用域 | 动作 ID | 默认按键 | 说明 |
| :--- | :--- | :--- | :--- |
| 全局 | `toggle_nav` | `Mod+J` | 切换流式输入模式与结构化槽位导航模式 |
| 全局 | `focus_editor` | `Mod+E` | 将键盘焦点移回公式编辑器输入框 |
| 全局 | `open_settings` | `Mod+,` | 打开或聚焦设置与偏好面板 |
| 全局 | `copy_latex` | `Mod+Shift+C` | 复制按当前定界符格式化后的 LaTeX |
| 全局 | `save_snippet` | `Mod+Shift+S` | 将当前公式保存为用户片段 |
| 导航模式 | `nav_next_slot` | `j` | 跳转到下一个槽位 |
| 导航模式 | `nav_prev_slot` | `k` | 跳转到上一个槽位 |
| 导航模式 | `nav_parent` | `h` | 向左 / 返回父层节点 |
| 导航模式 | `nav_first_child` | `l` | 向右 / 进入子层槽位 |
| 编辑器固定 | `▸` | `▸` | 触发流式结构/符号命令前缀（后接 1 键或 2 键简码） |
| 编辑器固定 | `Enter` / `;` | `Enter` / `;` | 推进至下一槽位或闭合当前结构 |
| 编辑器固定 | `Tab` / `Shift+Tab` | `Tab` / `Shift+Tab` | 无障碍焦点逃逸，向后/向前移出编辑器（不劫持 Tab 焦点） |
| 编辑器固定 | `Esc` | `Esc` | 退出导航模式或关闭当前弹窗 |
<!-- END GENERATED: shortcuts -->

> 若需查阅完整 121 条 `▸` 命令列表，请在插件弹窗的「命令目录」调色板中搜索，或参阅主仓库的 [../docs/commands.md](../docs/commands.md) 与 [../HELP.md](../HELP.md)。

---

## 构建、验证与安装到 Obsidian 知识库

在仓库根目录执行以下命令完成测试、构建与单文件打包：

```bash
# 1. 运行 apps/obsidian 单元测试、Svelte 类型检查与构建
npm --prefix apps/obsidian test
npm --prefix apps/obsidian run check
npm --prefix apps/obsidian run build

# 2. 编译 WASM、生成内联 main.js / styles.css 并运行 Node.js E2E smoke test
node obsidian-mathslot/scripts/build.mjs
```

安装到本地 Obsidian 知识库（将 `<VAULT>` 替换为你的知识库路径）：

```bash
mkdir -p "<VAULT>/.obsidian/plugins/mathslot"
cp obsidian-mathslot/manifest.json obsidian-mathslot/main.js obsidian-mathslot/styles.css \
  "<VAULT>/.obsidian/plugins/mathslot/"
```

然后在 Obsidian **设置 → 第三方插件** 中刷新并启用 **MathSlot Formula Editor**。

---

## 相关文档

- 项目主页：[../README.md](../README.md)
- 完整使用手册：[../HELP.md](../HELP.md)
- 命令目录参考：[../docs/commands.md](../docs/commands.md)
- 工程架构文档：[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)

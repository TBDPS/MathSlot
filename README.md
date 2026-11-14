# MathSlot · 流式简码数学公式编辑器（Tauri 2 桌面端 + Obsidian WASM 插件同源）

[![Rust](https://img.shields.io/badge/language-Rust_2024-orange.svg)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#版本与权威指标)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey.svg)](#跨平台发布包)
[![Obsidian](https://img.shields.io/badge/Obsidian-Plugin%20WASM-purple.svg)](obsidian-mathslot/README.md)

**MathSlot** 是一款面向学者、算法工程师与重度数学公式输入者的**书写流优先、零语法死记、键盘全控**数学公式编辑器。项目采用 **Rust 核心库 + Svelte 5 / CodeMirror 6 共享前端** 同源双端架构：

- **桌面应用（[`apps/desktop/`](apps/desktop/package.json)）**：基于 **Tauri 2**（`mathslot-desktop`）与系统 WebView，集成共享 UI（`packages/ui`）与本地文件存储（`crates/mathslot-store`），支持原生剪贴板、严格导出与本地配置文件容灾；
- **Obsidian 插件（[`obsidian-mathslot/`](obsidian-mathslot/README.md)）**：将同一套 Rust 引擎编译为 `wasm32-unknown-unknown`（`crates/mathslot-wasm` + `wasm-bindgen`），以内联 Base64 WASM 打包为单文件 `main.js`，在 Obsidian 弹窗中直接驱动编辑器并将公式插入笔记光标处；
- **统一渲染与诊断管线**：优先使用主机环境支持的渲染后端——共享 UI 默认内置 **MathJax 3 SVG** 实时渲染（桌面端还可在设置中选择纯 Rust `latex-rust` 后端；Obsidian 端在导出/代码块预览优先调用 Obsidian `renderMath` 并以 MathJax 3 SVG 回退）。

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

## 核心特性

1. **流式简码输入与可搜索调色板 (`PalettePanel`)**
   - 在编辑器中按 `▸` 触发流式命令前缀，输入单键或双键简码即可创建结构或符号，按 `Enter` 或 `;` 推进至下一槽位或闭合当前结构；
   - 共享调色板提供 **「命令目录」**、**「预置公式」**、**「片段」** 三个标签页，实时从单一事实源读取数量并支持中文标签、简码键位、ID 与 LaTeX 关键词即时搜索与键盘网格导航；
   - 典型示例：输入 `▸ue;i▸gp;; + 1 = 0` 输出 `{e}^{i\pi} + 1 = 0`；输入 `▸lx;0;▸fsin x;x;;` 输出 `\lim_{x \to 0} \frac{\sin x}{x}`。
2. **结构化槽位导航树 (`NavTreePanel`)**
   - 按 `Mod+J`（或点击界面导航切换按钮）在流式输入模式与结构化槽位导航模式间切换；
   - 导航模式下可使用 `j` / `k` / `h` / `l`（全部可在「设置」中自定义）在槽位、父层与子层之间精确跳转，预览区实时以柔和边框高亮当前活动槽位。
3. **LaTeX 逆向导入与严格导出校验**
   - 点击 **「导入 LaTeX」** 可粘贴外部 `$..$`、`$$..$$` 或纯 LaTeX 代码，由 `crates/mathslot-latex` 逆向编译为 MathSlot 表达式；
   - 若导入存在语法错误（Error 级诊断），系统会阻断替换并保留当前公式；支持查看无损/有损诊断报告及回环对比；
   - 导出支持四种定界符格式（裸代码、`$...$`、`$$...$$`、```` ```latex ```` 代码块），桌面端额外提供 **「严格导出」** 检查未闭合空槽与语法诊断。
4. **本地持久化、文件锁与 3–5 代备份容灾 (`crates/mathslot-store`)**
   - 桌面端配置文件 `library.json` 采用 `schema_version = 3`，写入前执行 `fd-lock` 排他锁与临时文件原子重命名；
   - 每次写入保留 3–5 代轮转备份；若检测到主文件损坏，自动隔离为 `library.corrupt-*.json` 并锁定写操作，由「设置 → 恢复向导」引导从备份恢复或重置为空配置；
   - Obsidian 端通过 `Plugin.loadData` / `saveData` 持久化并在 `apps/obsidian/src/storage.ts` 实现对称的导入/导出与损坏隔离逻辑。

---

## 完整命令目录（由唯一事实源自动注入）

<!-- BEGIN GENERATED: commands -->
> 以下完整 **121** 条命令目录（覆盖 **8** 大分类）由 `xtask` 从 `catalog/commands.toml` 与 [docs/commands.md](docs/commands.md) 同源自动注入，严禁手动编辑标记块内外命令清单。

<details>
<summary>展开查看完整 121 条流式命令目录（8 大分类）</summary>

### 直达结构 (structure)

| 简码 (ID) | 按键序列 | 显示标签 | 字符 | 槽位 | LaTeX 模板 | 示例 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `frac` | `▸f` | 分数 | a/b | 分子, 分母 | `\frac{$1}{$2}` | `▸f1;2;` | 分数：分子在前，分母在后 |
| `sqrt` | `▸r` | 根号 | √x | 被开方式 | `\sqrt{$1}` | `▸rx;` | 平方根号 |
| `nth_root` | `▸n` | N次根 | n√x | 根指数, 被开方式 | `\sqrt[$1]{$2}` | `▸n3;8;` | N次根号：根指数在前，被开方式在后 |
| `sup` | `▸u` | 上标 | x^n | 底数, 指数 | `{$1}^{$2}` | `▸ux;2;` | 上标指数：底数在前，指数在后 |
| `sub` | `▸d` | 下标 | x_n | 主体, 下标 | `{$1}_{$2}` | `▸dx;i;` | 下标索引：主体在前，下标在后 |
| `subsup` | `▸b` | 上下标 | x_n^m | 主体, 下标, 上标 | `{$1}_{$2}^{$3}` | `▸bx;i;2;` | 同时包含上下标：主体、下标、上标 |
| `paren` | `▸p` | 括号 | (x) | 括号内 | `\left($1\right)` | `▸px;` | 自适应圆括号 |
| `abs` | `▸v` | 绝对值 | \|x\| | 绝对值内 | `\left\|$1\right\|` | `▸vx;` | 自适应绝对值竖线 |
| `integral` | `▸i` | 定积分 | ∫_a^b | 下限, 上限, 被积式 | `\int_{$1}^{$2} $3` | `▸i0;1;x;` | 定积分：下限、上限、被积式 |
| `sum` | `▸s` | 求和 | ∑ | 下限, 上限, 求和项 | `\sum_{$1}^{$2} $3` | `▸si=1;n;i;` | 累加求和：下限、上限、求和项 |
| `limit` | `▸l` | 极限 | x→a | 趋近变量, 趋近目标, 主体 | `\lim_{$1 \to $2} $3` | `▸lx;0;f(x);` | 极限：趋近变量、趋近目标、主体 |
| `binom` | `▸e` | 二项式 | C(n,k) | 上标 n, 下标 k | `\binom{$1}{$2}` | `▸en;k;` | 二项式组合数：上标 n、下标 k |

### 微积分 (calculus)

| 简码 (ID) | 按键序列 | 显示标签 | 字符 | 槽位 | LaTeX 模板 | 示例 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `indef_integral` | `▸ca` | 不定积分 | ∫ f | 被积式 | `\int $1` | `▸cax;` | 不定积分：被积式 |
| `product` | `▸cb` | 连乘 | ∏ | 下限, 上限, 连乘项 | `\prod_{$1}^{$2} $3` | `▸cbi=1;n;i;` | 连乘积：下限、上限、连乘项 |
| `double_integral` | `▸cc` | 二重积分 | ∬ | 积分区域, 被积式 | `\iint_{$1} $2` | `▸ccD;f;` | 二重积分：积分区域、被积式 |
| `contour_integral` | `▸cd` | 环路积分 | ∮ | 积分路径, 被积式 | `\oint_{$1} $2` | `▸cdC;f;` | 闭合曲线/环路积分：积分路径、被积式 |
| `triple_integral` | `▸ce` | 三重积分 | ∭ | 积分体, 被积式 | `\iiint_{$1} $2` | `▸ceV;f;` | 三重积分：积分体、被积式 |
| `partial_frac` | `▸cg` | 偏导分式 | ∂y/∂x | 分子, 分母 | `\frac{\partial $1}{\partial $2}` | `▸cgy;x;` | 偏导数分式：分子、分母 |
| `total_frac` | `▸ci` | 全导分式 | dy/dx | 分子, 分母 | `\frac{\mathrm{d}$1}{\mathrm{d}$2}` | `▸ciy;x;` | 全导数分式：分子、分母 |

### 矩阵 (matrix)

| 简码 (ID) | 按键序列 | 显示标签 | 字符 | 槽位 | LaTeX 模板 | 示例 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `matrix_2x2` | `▸ma` | 2×2 矩阵 | (2×2) | (1,1), (1,2), (2,1), (2,2) | `\begin{pmatrix} $1 & $2 \\ $3 & $4 \end{pmatrix}` | `▸ma1;2;3;4;` | 2×2 圆括号矩阵 |
| `matrix_3x3` | `▸mb` | 3×3 矩阵 | (3×3) | (1,1), (1,2), (1,3), (2,1), (2,2), (2,3), (3,1), (3,2), (3,3) | `\begin{pmatrix} $1 & $2 & $3 \\ $4 & $5 & $6 \\ $7 & $8 & $9 \end{pmatrix}` | `▸mb1;2;3;4;5;6;7;8;9;` | 3×3 圆括号矩阵 |
| `det_2x2` | `▸mc` | 2×2 行列式 | \|2×2\| | (1,1), (1,2), (2,1), (2,2) | `\begin{vmatrix} $1 & $2 \\ $3 & $4 \end{vmatrix}` | `▸mc1;2;3;4;` | 2×2 单竖线行列式 |
| `cases_2` | `▸md` | 分段函数 | {cases | 表达式1, 条件1, 表达式2, 条件2 | `\begin{cases} $1 & $2 \\ $3 & $4 \end{cases}` | `▸mdx;x>0;-x;x\le 0;` | 二分段函数：式1、条件1、式2、条件2 |
| `bmatrix_2x2` | `▸me` | 方括号矩阵 | [2×2] | (1,1), (1,2), (2,1), (2,2) | `\begin{bmatrix} $1 & $2 \\ $3 & $4 \end{bmatrix}` | `▸me1;2;3;4;` | 2×2 方括号矩阵 |
| `cases_3` | `▸mf` | 三分段函数 | {cases×3 | 表达式1, 条件1, 表达式2, 条件2, 表达式3, 条件3 | `\begin{cases} $1 & $2 \\ $3 & $4 \\ $5 & $6 \end{cases}` | `▸mf1;x>0;0;x=0;-1;x<0;` | 三分段函数：式1、条件1、式2、条件2、式3、条件3 |
| `bmatrix_3x3` | `▸mg` | 3×3 方块阵 | [3×3] | (1,1), (1,2), (1,3), (2,1), (2,2), (2,3), (3,1), (3,2), (3,3) | `\begin{bmatrix} $1 & $2 & $3 \\ $4 & $5 & $6 \\ $7 & $8 & $9 \end{bmatrix}` | `▸mg1;2;3;4;5;6;7;8;9;` | 3×3 方括号矩阵 |
| `det_3x3` | `▸mh` | 3×3 行列式 | \|3×3\| | (1,1), (1,2), (1,3), (2,1), (2,2), (2,3), (3,1), (3,2), (3,3) | `\begin{vmatrix} $1 & $2 & $3 \\ $4 & $5 & $6 \\ $7 & $8 & $9 \end{vmatrix}` | `▸mh1;2;3;4;5;6;7;8;9;` | 3×3 单竖线行列式 |

### 装饰 (accent)

| 简码 (ID) | 按键序列 | 显示标签 | 字符 | 槽位 | LaTeX 模板 | 示例 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `hat` | `▸aa` | 帽子 | hat | 帽子内 | `\hat{$1}` | `▸aax;` | 帽子标注：\hat{x} |
| `bar` | `▸ab` | 上横线 | bar | 横线内 | `\bar{$1}` | `▸abx;` | 上横线标注：\bar{x} |
| `vec` | `▸ac` | 向量箭头 | vec | 向量内 | `\vec{$1}` | `▸acx;` | 向量箭头标注：\vec{x} |
| `tilde` | `▸ad` | 波浪号 | tilde | 波浪号内 | `\tilde{$1}` | `▸adx;` | 波浪号标注：\tilde{x} |
| `dot` | `▸ae` | 一阶导点 | dot | 导点内 | `\dot{$1}` | `▸aex;` | 一阶导点标注：\dot{x} |
| `norm` | `▸af` | 范数 | ‖x‖ | 范数内 | `\left\Vert $1\right\Vert` | `▸afx;` | 双竖线范数定界：\left\Vert x\right\Vert |
| `overline` | `▸ag` | 上划线 | overline | 上划线内 | `\overline{$1}` | `▸agx;` | 长上划线标注：\overline{x} |
| `ddot` | `▸ah` | 二阶导点 | ddot | 二阶导点内 | `\ddot{$1}` | `▸ahx;` | 二阶导点标注：\ddot{x} |
| `underline` | `▸ai` | 下划线 | underline | 下划线内 | `\underline{$1}` | `▸aix;` | 下划线标注：\underline{x} |
| `overbrace` | `▸aj` | 上花括号 | overbrace | 主体, 标注 | `\overbrace{$1}^{$2}` | `▸ajx;标注;` | 上花括号标注：\overbrace{主体}^{标注} |
| `underbrace` | `▸ak` | 下花括号 | underbrace | 主体, 标注 | `\underbrace{$1}_{$2}` | `▸akx;标注;` | 下花括号标注：\underbrace{主体}_{标注} |
| `bracket` | `▸al` | 中括号 | [x] | 中括号内 | `\left[$1\right]` | `▸alx;` | 自适应方括号定界：\left[ x\right] |
| `brace` | `▸am` | 大括号/集合 | {x} | 大括号内 | `\left\{$1\right\}` | `▸amx;` | 自适应花括号定界：\left\{ x\right\} |
| `angle` | `▸an` | 尖括号内积 | ⟨x⟩ | 尖括号内 | `\left\langle $1\right\rangle` | `▸anx;` | 尖括号内积定界：\left\langle x\right\rangle |
| `floor` | `▸ao` | 向下取整 | ⌊x⌋ | 向下取整内 | `\left\lfloor $1\right\rfloor` | `▸aox;` | 向下取整定界：\left\lfloor x\right\rfloor |
| `ceil` | `▸ap` | 向上取整 | ⌈x⌉ | 向上取整内 | `\left\lceil $1\right\rceil` | `▸apx;` | 向上取整定界：\left\lceil x\right\rceil |
| `eval_bar` | `▸aq` | 代入求值线 | F\|_a^b | 表达式, 下限, 上限 | `\left. $1\right\|_{$2}^{$3}` | `▸aqF;a;b;` | 代入求值竖线：\left. F\right\|_a^b |

### 希腊字母 (greek)

| 简码 (ID) | 按键序列 | 显示标签 | 字符 | 槽位 | LaTeX 模板 | 示例 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `alpha` | `▸ga` | alpha | α | - | `\alpha` | `▸ga` | 希腊字母：\alpha |
| `beta` | `▸gb` | beta | β | - | `\beta` | `▸gb` | 希腊字母：\beta |
| `gamma` | `▸gc` | gamma | γ | - | `\gamma` | `▸gc` | 希腊字母：\gamma |
| `delta` | `▸gd` | delta | δ | - | `\delta` | `▸gd` | 希腊字母：\delta |
| `epsilon` | `▸ge` | epsilon | ε | - | `\varepsilon` | `▸ge` | 希腊字母：\varepsilon |
| `zeta` | `▸gz` | zeta | ζ | - | `\zeta` | `▸gz` | 希腊字母：\zeta |
| `eta` | `▸gh` | eta | η | - | `\eta` | `▸gh` | 希腊字母：\eta |
| `theta` | `▸gt` | theta | θ | - | `\theta` | `▸gt` | 希腊字母：\theta |
| `iota` | `▸gi` | iota | ι | - | `\iota` | `▸gi` | 希腊字母：\iota |
| `kappa` | `▸gk` | kappa | κ | - | `\kappa` | `▸gk` | 希腊字母：\kappa |
| `lambda` | `▸gl` | lambda | λ | - | `\lambda` | `▸gl` | 希腊字母：\lambda |
| `mu` | `▸gm` | mu | μ | - | `\mu` | `▸gm` | 希腊字母：\mu |
| `nu` | `▸gn` | nu | ν | - | `\nu` | `▸gn` | 希腊字母：\nu |
| `xi` | `▸gx` | xi | ξ | - | `\xi` | `▸gx` | 希腊字母：\xi |
| `pi` | `▸gp` | pi | π | - | `\pi` | `▸gp` | 希腊字母：\pi |
| `rho` | `▸gr` | rho | ρ | - | `\rho` | `▸gr` | 希腊字母：\rho |
| `sigma` | `▸gs` | sigma | σ | - | `\sigma` | `▸gs` | 希腊字母：\sigma |
| `tau` | `▸gu` | tau | τ | - | `\tau` | `▸gu` | 希腊字母：\tau |
| `upsilon` | `▸gv` | upsilon | υ | - | `\upsilon` | `▸gv` | 希腊字母：\upsilon |
| `phi` | `▸gf` | phi | φ | - | `\phi` | `▸gf` | 希腊字母：\phi |
| `chi` | `▸gq` | chi | χ | - | `\chi` | `▸gq` | 希腊字母：\chi |
| `psi` | `▸gy` | psi | ψ | - | `\psi` | `▸gy` | 希腊字母：\psi |
| `omega` | `▸go` | omega | ω | - | `\omega` | `▸go` | 希腊字母：\omega |
| `cap_gamma` | `▸gC` | Gamma | Γ | - | `\Gamma` | `▸gC` | 希腊字母：\Gamma |
| `cap_delta` | `▸gD` | Delta | Δ | - | `\Delta` | `▸gD` | 希腊字母：\Delta |
| `cap_theta` | `▸gT` | Theta | Θ | - | `\Theta` | `▸gT` | 希腊字母：\Theta |
| `cap_lambda` | `▸gL` | Lambda | Λ | - | `\Lambda` | `▸gL` | 希腊字母：\Lambda |
| `cap_xi` | `▸gX` | Xi | Ξ | - | `\Xi` | `▸gX` | 希腊字母：\Xi |
| `cap_pi` | `▸gP` | Pi | Π | - | `\Pi` | `▸gP` | 希腊字母：\Pi |
| `cap_sigma` | `▸gS` | Sigma | Σ | - | `\Sigma` | `▸gS` | 希腊字母：\Sigma |
| `cap_upsilon` | `▸gU` | Upsilon | Υ | - | `\Upsilon` | `▸gU` | 希腊字母：\Upsilon |
| `cap_phi` | `▸gF` | Phi | Φ | - | `\Phi` | `▸gF` | 希腊字母：\Phi |
| `cap_psi` | `▸gY` | Psi | Ψ | - | `\Psi` | `▸gY` | 希腊字母：\Psi |
| `cap_omega` | `▸gO` | Omega | Ω | - | `\Omega` | `▸gO` | 希腊字母：\Omega |

### 数学符号 (symbol)

| 简码 (ID) | 按键序列 | 显示标签 | 字符 | 槽位 | LaTeX 模板 | 示例 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `infty` | `▸oa` | 无穷 | ∞ | - | `\infty` | `▸oa` | 无穷大符号：\infty (也可直输 oo) |
| `to` | `▸ob` | 趋向 | → | - | `\to` | `▸ob` | 趋向箭头：\to (也可直输 ->) |
| `partial` | `▸oc` | 偏导 | ∂ | - | `\partial` | `▸oc` | 偏导算子：\partial |
| `nabla` | `▸od` | 梯度 | ∇ | - | `\nabla` | `▸od` | 梯度算子/劈形算子：\nabla |
| `pm` | `▸oe` | 正负 | ± | - | `\pm` | `▸oe` | 正负号：\pm (也可直输 +-) |
| `times` | `▸of` | 叉乘 | × | - | `\times` | `▸of` | 乘号/叉乘：\times |
| `cdot` | `▸og` | 点乘 | · | - | `\cdot` | `▸og` | 点乘符号：\cdot |
| `in` | `▸oh` | 属于 | ∈ | - | `\in` | `▸oh` | 属于符号：\in |
| `notin` | `▸oi` | 不属于 | ∉ | - | `\notin` | `▸oi` | 不属于符号：\notin |
| `subseteq` | `▸oj` | 子集 | ⊆ | - | `\subseteq` | `▸oj` | 子集包含于符号：\subseteq |
| `forall` | `▸ok` | 任意 | ∀ | - | `\forall` | `▸ok` | 全称量词：\forall |
| `hbar` | `▸ol` | 约化普朗克 | ℏ | - | `\hbar` | `▸ol` | 约化普朗克常数：\hbar |
| `ell` | `▸om` | 花体l | ℓ | - | `\ell` | `▸om` | 花体字母 l：\ell |
| `circ` | `▸on` | 圈乘/度 | ∘ | - | `\circ` | `▸on` | 复合函数圈乘/度数：\circ |
| `parallel` | `▸oo` | 平行 | ∥ | - | `\parallel` | `▸oo` | 平行符号：\parallel (也可直输 \|\|) |
| `perp` | `▸op` | 垂直 | ⊥ | - | `\perp` | `▸op` | 垂直/正交符号：\perp (也可直输 _\|_) |

### 关系符号 (relation)

| 简码 (ID) | 按键序列 | 显示标签 | 字符 | 槽位 | LaTeX 模板 | 示例 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `equiv` | `▸xa` | 恒等 | ≡ | - | `\equiv` | `▸xa` | 恒等于/同余：\equiv |
| `approx` | `▸xb` | 近似 | ≈ | - | `\approx` | `▸xb` | 约等于：\approx |
| `sim` | `▸xc` | 相似 | ∼ | - | `\sim` | `▸xc` | 相似于：\sim |
| `propto` | `▸xd` | 正比 | ∝ | - | `\propto` | `▸xd` | 正比于：\propto |
| `implies` | `▸xe` | 蕴含 | ⇒ | - | `\Rightarrow` | `▸xe` | 蕴含箭头：\Rightarrow |
| `iff` | `▸xf` | 等价 | ⇔ | - | `\Leftrightarrow` | `▸xf` | 当且仅当/等价箭头：\Leftrightarrow |
| `mapsto` | `▸xg` | 映射 | ↦ | - | `\mapsto` | `▸xg` | 映射箭头：\mapsto |
| `therefore` | `▸xh` | 所以 | ∴ | - | `\therefore` | `▸xh` | 所以/因果推导：\therefore |
| `because` | `▸xi` | 因为 | ∵ | - | `\because` | `▸xi` | 因为/原因引导：\because |
| `cong` | `▸xj` | 全等/同余 | ≅ | - | `\cong` | `▸xj` | 全等/同余：\cong (也可直输 ~=) |
| `ll` | `▸xk` | 远小于 | ≪ | - | `\ll` | `▸xk` | 远小于：\ll (也可直输 <<) |
| `gg` | `▸xl` | 远大于 | ≫ | - | `\gg` | `▸xl` | 远大于：\gg (也可直输 >>) |
| `simeq` | `▸xm` | 渐近相等 | ≃ | - | `\simeq` | `▸xm` | 渐近相等/相似等于：\simeq |

### 集合与逻辑 (setlogic)

| 简码 (ID) | 按键序列 | 显示标签 | 字符 | 槽位 | LaTeX 模板 | 示例 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `cup` | `▸qa` | 并集 | ∪ | - | `\cup` | `▸qa` | 并集符号：\cup |
| `cap` | `▸qb` | 交集 | ∩ | - | `\cap` | `▸qb` | 交集符号：\cap |
| `emptyset` | `▸qc` | 空集 | ∅ | - | `\varnothing` | `▸qc` | 空集符号：\varnothing |
| `subset` | `▸qd` | 真子集 | ⊂ | - | `\subset` | `▸qd` | 真子集符号：\subset |
| `exists` | `▸qe` | 存在 | ∃ | - | `\exists` | `▸qe` | 存在量词：\exists |
| `neg` | `▸qf` | 非 | ¬ | - | `\neg` | `▸qf` | 逻辑非：\neg |
| `land` | `▸qg` | 且 | ∧ | - | `\land` | `▸qg` | 逻辑且/合取：\land |
| `lor` | `▸qh` | 或 | ∨ | - | `\lor` | `▸qh` | 逻辑或/析取：\lor |
| `real_set` | `▸qi` | 实数集 | ℝ | - | `\mathbb{R}` | `▸qi` | 实数集：\mathbb{R} |
| `nat_set` | `▸qj` | 自然数集 | ℕ | - | `\mathbb{N}` | `▸qj` | 自然数集：\mathbb{N} |
| `int_set` | `▸qk` | 整数集 | ℤ | - | `\mathbb{Z}` | `▸qk` | 整数集：\mathbb{Z} |
| `rat_set` | `▸ql` | 有理数集 | ℚ | - | `\mathbb{Q}` | `▸ql` | 有理数集：\mathbb{Q} |
| `setminus` | `▸qm` | 差集 | ∖ | - | `\setminus` | `▸qm` | 集合差集：\setminus |
| `complex_set` | `▸qn` | 复数集 | ℂ | - | `\mathbb{C}` | `▸qn` | 复数集：\mathbb{C} |

</details>
<!-- END GENERATED: commands -->

---

## 预置公式库（由唯一事实源自动注入）

<!-- BEGIN GENERATED: presets -->
> 由 `xtask` 根据 `catalog/presets.json` 自动生成：共 **`88`** 条权威公式，覆盖 **`9`** 大分类。

| 序号 | 分类 | 条目数 | 代表公式示例 |
| :--- | :--- | :---: | :--- |
| 1 | **微积分/高等数学** | 15 | 欧拉恒等式、高斯积分、微积分基本定理 |
| 2 | **线性代数** | 12 | 一元二次方程求根公式、柯西-施瓦茨不等式、二阶特征多项式行列式 |
| 3 | **概率统计** | 9 | 贝叶斯后验概率公式、一维高斯正态分布密度、多元正态分布概率密度 |
| 4 | **大学物理** | 12 | 麦克斯韦第一方程 (高斯电场)、麦克斯韦第二方程 (高斯磁场)、麦克斯韦第三方程 (法拉第感应) |
| 5 | **复变函数** | 8 | 柯西-黎曼微分方程组、柯西复变积分公式、柯西留数定理 |
| 6 | **离散数学** | 6 | 香农信息熵、二项式展开定理、斯特林阶乘近似公式 |
| 7 | **现代深度学习与人工智能** | 11 | 缩放点积注意力 (Scaled Dot-Product Attention)、多头自注意力机制 (Multi-Head Attention)、Adam 优化器一阶动量更新 |
| 8 | **量子力学** | 8 | 含时间薛定谔方程、定态薛定谔方程 (本征值方程)、谐振子阶梯升降算符对易子 |
| 9 | **微分几何与数学物理** | 7 | 外微分乘积反对称莱布尼茨法则、广义斯托克斯微分形式统一积分定理、霍奇星号对偶与内积映射 |
<!-- END GENERATED: presets -->

---

## 快捷键与编辑器交互（由唯一事实源自动注入）

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

---

## 工程架构概览

```text
catalog/commands.toml + catalog/presets.json + Cargo.toml + manifest.json + mathslot-store
        │
        ▼  (cargo run -p xtask -- generate / check)
crates/mathslot-command/src/generated.rs · catalog/catalog.json · docs/commands.md
packages/ui/src/generated/{catalog,presets}.ts · schemas/commands.schema.json
README.md · HELP.md · obsidian-mathslot/README.md · docs/ARCHITECTURE.md
        │
        ├──▶ crates/mathslot-{syntax,doc,latex,command,app,store,render,core}
        │         ├──▶ apps/desktop (Tauri 2 + WebKit + packages/ui)
        │         └──▶ crates/mathslot-wasm ──▶ apps/obsidian ──▶ obsidian-mathslot/main.js
        └──▶ packages/ui (Svelte 5 + CodeMirror 6 + MathJax 3 SVG)
```

详细模块职责与数据流请参阅 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 快速构建与验证

```bash
# 1. Rust 工作区格式、Lint 与全量测试
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --offline

# 2. 单一事实源生成与一致性校验
cargo run -p xtask -- check

# 3. 共享 UI 与桌面端测试、类型检查与构建
npm --prefix packages/ui test && npm --prefix packages/ui run check
npm --prefix apps/desktop test && npm --prefix apps/desktop run check && npm --prefix apps/desktop run build

# 4. Obsidian 插件测试、构建与内联 WASM 产物验证
npm --prefix apps/obsidian test && npm --prefix apps/obsidian run check && npm --prefix apps/obsidian run build
node obsidian-mathslot/scripts/build.mjs
```

---

## 更多文档

- 完整使用教程、导航、导入导出与配置存储说明：[HELP.md](HELP.md)
- 完整命令速查表（独立生成文件）：[docs/commands.md](docs/commands.md)
- 系统架构与模块边界说明：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Obsidian 插件安装、构建与使用文档：[obsidian-mathslot/README.md](obsidian-mathslot/README.md)
- 开源协议：`MIT OR Apache-2.0`（权威声明见 [Cargo.toml](Cargo.toml)）。

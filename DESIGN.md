# MathSlot 详细技术设计规范（v0.4 超轻量原生 + Obsidian WASM 同源版）

> **文档目标**：本文档是 `mathslot` 项目的唯一权威设计规范（Single Source of Truth），完整记录 Workspace 同源架构、混合简码词表、三槽位极限、嵌套结构活跃层级消歧、多级折叠 2D 结构导航树、超轻量 `latex-rust` 原生渲染器与 Obsidian 插件桥接管线。

---

## 1. 同源双端架构（Cargo Workspace）

| 模块 | 路径 | 职责与依赖边界 |
| :--- | :--- | :--- |
| **共享纯内核** | `crates/mathslot-core` | **0 外部 crate 依赖**！包含词表 `command`、语法树 `ast`、容错解析器 `parser`、流式状态机 `editor`、方案 A 序列化 `scheme_a`、标准 LaTeX 导出 `latex` 以及双方言视觉生成 `visual`（同时输出 `LatexRust` 与 `MathJax` 预览/导航公式）。 |
| **WASM 桥接层** | `crates/mathslot-wasm` | 仅依赖 `mathslot-core`（无 `serde`/`wasm-bindgen` 宏膨胀），编译为 `~70 KB` `wasm32-unknown-unknown` 模块，导出 UTF-8 JSON 状态机接口。 |
| **超轻量桌面端** | `src/{main,app,render}.rs` | 基于 `eframe 0.37` + `latex-rust 3.0.1`（内嵌 `STIX Two Math` OpenType MATH 字体 + `tiny-skia` 光栅化），彻底移除 ~250 个 `typst` 编译器依赖包，且无需系统安装 WebKitGTK。 |
| **Obsidian 插件** | `obsidian-mathslot/` | 自包含插件（`manifest.json` + `styles.css` + 内联 Base64 WASM 的 `main.js`），直接调用 Obsidian 内置 `renderMath`（MathJax v3）排版，支持桌面与移动端一键插入公式。 |

---

## 2. 混合简码词表与极限箭头设计（`crates/mathslot-core/src/command.rs`）

### 2.1 单字母高频直达（12 项，`Tab` + 1 键直达）

| 简码 | 枚举变体 | 名称 | 槽位顺序（`;` 分隔） | 方案 A 展开 | LaTeX 模板 |
| :---: | :--- | :--- | :--- | :--- | :--- |
| `▸f` | `Frac` | 分数 | `分子 ; 分母` | `frac($0, $1)` | `\frac{$0}{$1}` |
| `▸r` | `Sqrt` | 根号 | `被开方式` | `sqrt($0)` | `\sqrt{$0}` |
| `▸n` | `NthRoot` | N次根 | `根指数 ; 被开方式` | `root($0, $1)` | `\sqrt[$0]{$1}` |
| `▸u` | `Sup` | 上标 | `底数 ; 指数` | `sup($0, $1)` | `{$0}^{$1}` |
| `▸d` | `Sub` | 下标 | `主体 ; 下标` | `sub($0, $1)` | `{$0}_{$1}` |
| `▸b` | `SubSup` | 上下标 | `主体 ; 下标 ; 上标` | `subsup($0, $1, $2)` | `{$0}_{$1}^{$2}` |
| `▸p` | `Paren` | 括号 | `括号内表达式` | `paren($0)` | `\left($0\right)` |
| `▸v` | `Abs` | 绝对值 | `绝对值内表达式` | `abs($0)` | `\left|$0\right|` |
| `▸i` | `Integral` | 定积分 | `下限 ; 上限 ; 被积式` | `int($0, $1, $2)` | `\int_{$0}^{$1} $2` |
| `▸s` | `Sum` | 求和 | `下限 ; 上限 ; 求和项` | `sum($0, $1, $2)` | `\sum_{$0}^{$1} $2` |
| `▸l` | `Limit` | 极限 | `趋近变量 ; 趋近目标 ; 主体` | `lim($0 -> $1, $2)` | `\lim_{$0 \to $1} $2` |
| `▸e` | `Binom` | 二项式系数 | `上标n ; 下标k` | `binom($0, $1)` | `\binom{$0}{$1}` |

> **趋向箭头 `→` (`\to`) 的三种输入方式**：
> 1. **在极限结构内自动生成**：`Tab l` (`▸l`) 后直接依次输入 `x`、`Enter`、`0`、`Enter`、主体，系统自动拼装 `x \to 0`；
> 2. **流式 ASCII 简写直输**：任意位置直接敲击 `->` 自动转为 `\to`（同理 `oo` $\to$ `\infty`、`+-` $\to$ `\pm`、`<=` $\to$ `\le`、`>=` $\to$ `\ge`）；
> 3. **符号子菜单按键**：`Tab o b` (`▸ob`) 直接插入趋向箭头符号。

### 2.2 二级子菜单（7 组，均支持 `Enter`/`Space` 选用 `★` 默认项）

- **`c` 更多积分/连乘**：`▸ca` ★不定积分 (`\int`)、`▸cb` 连乘 (`\prod`)、`▸cc` 二重积分 (`\iint`)、`▸cd` 环路积分 (`\oint`)
- **`m` 矩阵与分段**：`▸ma` ★2×2 矩阵 (`pmatrix`)、`▸mb` 3×3 矩阵、`▸mc` 2×2 行列式 (`vmatrix`)、`▸md` 分段函数 (`cases`)、`▸me` 方括号矩阵 (`bmatrix`)、`▸mf` 三分支分段函数
- **`a` 标注与定界**：`▸aa` ★帽子 (`\hat`)、`▸ab` 上横线 (`\bar`)、`▸ac` 向量 (`\vec`)、`▸ad` 波浪号 (`\tilde`)、`▸ae` 导点 (`\dot`)、`▸af` 范数 (`\left\Vert…\right\Vert`)、`▸ag` 上划线 (`\overline`)
- **`g` 希腊字母（0 槽位）**：`▸ga` ★`\alpha`、`▸gb..▸gz`（`\beta`..`\Omega`）
- **`o` 常用符号（0 槽位）**：`▸oa` ★`\infty`、`▸ob` `\to` (`→`)、`▸oc` `\partial`、`▸od` `\nabla`、`▸oe` `\pm`、`▸of` `\times`、`▸og` `\cdot`、`▸oh` `\in`、`▸oi` `\notin`、`▸oj` `\subseteq`、`▸ok` `\forall`
- **`x` 关系符/箭头（0 槽位）**：`▸xa` ★`\equiv`、`▸xb` `\approx`、`▸xc` `\sim`、`▸xd` `\propto`、`▸xe` `\Rightarrow`、`▸xf` `\Leftrightarrow`、`▸xg` `\mapsto`、`▸xh` `\therefore`、`▸xi` `\because`
- **`q` 集合/逻辑（0 槽位）**：`▸qa` ★`\cup`、`▸qb` `\cap`、`▸qc` `\varnothing`、`▸qd` `\subset`、`▸qe` `\exists`、`▸qf` `\neg`、`▸qg` `\land`、`▸qh` `\lor`、`▸qi..▸ql` `\mathbb{R/N/Z/Q}`
- **`j` 内联跳转**：`▸j<path>`（匹配完成后自动擦除不残留）

### 2.3 自定义格式声明式扩展（层级一 schema，`library.rs`）

自定义格式 `CustomFormat`（`▸k*`）除线性槽位模板外，支持两个可选声明式字段，使矩阵式结构与条件拼接语法免改源码定义：

| 字段 | 类型 | 语义 |
| :--- | :--- | :--- |
| `layout` | `Linear`（默认）｜`Env { env, cols }` | `Env` 布局：槽位按 `cols` 列逐行排列，渲染 `\begin{env} a & b \\ c & d \end{env}`；`latex_template` 不参与渲染；校验 `roles.len() % cols == 0` |
| `auto_join` | `Option<AutoJoin { base_slot, cond_slot, macro_tex }>` | cond 槽（0-based）内容非空时把 `macro_tex` 拼接在 base 槽后，为空自动省略；渲染前在 `prepare_joined_slots` 统一应用 |

三路渲染统一入口：`latex.rs`/`visual.rs` 走 `format.render_latex`、`scheme_a.rs` 走 `format.render_scheme_a`（Env 布局的导航视图回退为徽章列表）。序列化向后兼容：`library.json` 仅在非默认值时写出 `kind/env/cols/autoJoin` 字段；`$N` 越界占位符渲染为 `□`，且 `upsert_custom` 在保存时即校验布局与下标合法性。

---

## 3. 嵌套结构实时层级消歧（`ast::innermost_active_slot_span` & `visual.rs`）

针对多层嵌套根号/分式（如 $\sqrt{1+\sqrt{x}}$）在按 `Enter` 逐层退出时光标层级归属容易混淆的问题，`visual::build_preview_latex` 采用**双重视觉锚定**：

1. **最内层活跃槽位作用域框（Soft-Emerald Scope Box）**：
   `ParsedDoc::innermost_active_slot_span(cursor)` 在 AST 上精确定位包含光标的最深 `SlotNode`（且排除 `missing_semis_at_eof > 0` 的隐式空槽；由于同级槽位以 `;` 分隔、父子槽位以 `cmd_span` 分隔，所有真实槽位的 `Span` 全局唯一）。该槽位的整个渲染子树被包裹在柔和绿色边框与浅绿底色框中（`LatexRust` 使用 `\fcolorbox{msGfg}{msGsbg}{...}`，`MathJax` 使用 `\bbox[#ecfdf5,2px,border:1.25px solid #16a34a]{...}`）。
2. **精确字符级实时光标竖线（Live Caret `\pmb{\lvert}`）**：
   无论光标位于文本中间、内联上下标 `x^(n+|1)` 内部、或是刚跨过 `;` 停在子结构紧后方（如 `▸r1+▸rx;|`），均在对应数学位置渲染高对比绿色加粗竖线 `\pmb{\lvert}`。
   - `▸r1+▸rx|`：仅内层根号内的 `x ∣` 处于绿框中；
   - `▸r1+▸rx;|`：内层根号绿框消失，外层根号下的 `1 + √x ∣` 整体处于绿框中；
   - `▸r1+▸rx;;|`：所有根号绿框消失，光标 `∣` 明确落于全部根号右侧外部。

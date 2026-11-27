import type { CommandCategory, CommandDef, SubmenuMeta } from './types';

export const SUBMENUS: readonly SubmenuMeta[] = [
  { key: 'c', category: 'calculus', label: '微积分与大算子', glyph: '∂', defaultCommandId: 'partial_frac' },
  { key: 'm', category: 'matrix', label: '矩阵与多行', glyph: '[ ]', defaultCommandId: 'matrix_2x2' },
  { key: 'z', category: 'delimiter', label: '定界与狄拉克', glyph: '⟨·⟩', defaultCommandId: 'bracket' },
  { key: 'a', category: 'accent', label: '顶底标饰', glyph: 'x̂', defaultCommandId: 'hat' },
  { key: 'h', category: 'font', label: '字体·数域·排版', glyph: 'ℝ', defaultCommandId: 'text_box' },
  { key: 'y', category: 'arrow', label: '箭头与映射', glyph: '→', defaultCommandId: 'to' },
  { key: 'o', category: 'symbol', label: '运算与几何', glyph: '±', defaultCommandId: 'pm' },
  { key: 'x', category: 'relation', label: '等式与不等式', glyph: '≈', defaultCommandId: 'approx' },
  { key: 'q', category: 'setlogic', label: '集合与逻辑', glyph: '∪', defaultCommandId: 'cup' },
  { key: 'g', category: 'greek', label: '希腊字母', glyph: 'α', defaultCommandId: 'alpha' },
];

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  structure: '结构',
  calculus: '微积分与大算子',
  matrix: '矩阵与多行',
  delimiter: '定界与狄拉克',
  accent: '顶底标饰',
  font: '字体·数域·排版',
  arrow: '箭头与映射',
  symbol: '运算与几何',
  relation: '等式与不等式',
  setlogic: '集合与逻辑',
  greek: '希腊字母',
};

export const COMMANDS: readonly CommandDef[] = [
  // === 1. 一级核心结构 (structure: 8 direct + 4 keyless = 12) ===
  {"id": "frac", "keys": ["f"], "label": "分数", "category": "structure", "glyph": "a/b", "slots": ["分子", "分母"], "latex": "\\frac{$1}{$2}", "doc": "分数：分子在前，分母在后", "examples": ["▸f1;2;"], "wrapSlot": 0},
  {"id": "sqrt", "keys": ["r"], "label": "根号", "category": "structure", "glyph": "√x", "slots": ["根指数", "被开方式"], "optionalSlots": [0], "latex": "\\sqrt[$1]{$2}", "doc": "根号：根指数留空自动按二次根号 \\sqrt{x} 渲染，填写后按 N 次根渲染", "examples": ["▸rx;", "▸r3;8;"], "wrapSlot": 1},
  {"id": "sup", "keys": [], "label": "上标", "category": "structure", "glyph": "x^n", "slots": ["底数", "指数"], "latex": "{$1}^{$2}", "doc": "上标指数：直接输入 ^ 自动创建", "examples": ["x^2"], "wrapSlot": 0},
  {"id": "sub", "keys": [], "label": "下标", "category": "structure", "glyph": "x_n", "slots": ["主体", "下标"], "latex": "{$1}_{$2}", "doc": "下标索引：直接输入 _ 自动创建", "examples": ["x_i"], "wrapSlot": 0},
  {"id": "subsup", "keys": ["b"], "label": "上下标", "category": "structure", "glyph": "x_n^m", "slots": ["主体", "下标", "上标"], "optionalSlots": [1, 2], "latex": "{$1}_{$2}^{$3}", "doc": "上下标：下标或上标留空自动省略，也可直接输入 _ 与 ^ 自动合并", "examples": ["▸bx;i;2;"], "wrapSlot": 0},
  {"id": "paren", "keys": [], "label": "括号", "category": "structure", "glyph": "(x)", "slots": ["括号内"], "latex": "\\left($1\\right)", "doc": "自适应圆括号：直接输入 ( 自动创建", "examples": ["(x)"], "wrapSlot": 0},
  {"id": "abs", "keys": ["v"], "label": "绝对值", "category": "structure", "glyph": "|x|", "slots": ["绝对值内"], "latex": "\\left|$1\\right|", "doc": "自适应绝对值竖线", "examples": ["▸vx;"], "wrapSlot": 0},
  {"id": "integral", "keys": ["i"], "label": "积分", "category": "structure", "glyph": "∫", "slots": ["下限", "上限", "被积式"], "optionalSlots": [0, 1], "latex": "\\int_{$1}^{$2} $3", "doc": "积分：上下限留空自动按不定积分 \\int 渲染", "examples": ["▸i0;1;f(x) dx;"], "wrapSlot": 2},
  {"id": "sum", "keys": ["s"], "label": "求和", "category": "structure", "glyph": "∑", "slots": ["下限", "上限", "求和主体"], "optionalSlots": [0, 1], "latex": "\\sum_{$1}^{$2} $3", "doc": "累加求和：上下限可省略", "examples": ["▸si=1;n;a_i;"], "wrapSlot": 2},
  {"id": "limit", "keys": ["l"], "label": "极限", "category": "structure", "glyph": "x→a", "slots": ["趋近变量", "趋近目标", "极限主体"], "latex": "\\lim_{$1 \\to $2} $3", "doc": "极限：趋近变量、趋近目标、极限主体", "examples": ["▸lx;0;▸fsin x;x;;"], "wrapSlot": 2},
  {"id": "binom", "keys": ["e"], "label": "二项式", "category": "structure", "glyph": "C(n,k)", "slots": ["上标 n", "下标 k"], "latex": "\\binom{$1}{$2}", "doc": "二项式组合数：上标 n、下标 k", "examples": ["▸en;k;"], "wrapSlot": 0},
  {"id": "inline_math", "keys": [], "label": "内嵌公式", "category": "structure", "glyph": "$x$", "slots": ["内嵌公式"], "latex": "$1", "doc": "文本注释 \\text{...} 内的行内数学槽位（在文本注释中按 $ 插入）", "examples": [], "wrapSlot": 0},

  // === 2. 微积分与大算子 (c: 19 items, keys a..s, reserved t..z for \oiint, \iiiint, \limsup, \liminf) ===
  {"id": "indef_integral", "keys": ["c", "a"], "label": "不定积分", "category": "calculus", "glyph": "∫", "slots": ["被积式"], "latex": "\\int $1", "doc": "不定积分：被积式", "examples": ["▸caf(x) dx;"], "wrapSlot": 0},
  {"id": "product", "keys": ["c", "b"], "label": "连乘", "category": "calculus", "glyph": "∏", "slots": ["下限", "上限", "连乘主体"], "optionalSlots": [0, 1], "latex": "\\prod_{$1}^{$2} $3", "doc": "连乘积：上下限可省略", "examples": ["▸cbi=1;n;a_i;"], "wrapSlot": 2},
  {"id": "double_integral", "keys": ["c", "c"], "label": "二重积分", "category": "calculus", "glyph": "∬", "slots": ["积分区域", "上限", "被积式"], "optionalSlots": [0, 1], "latex": "\\iint_{$1}^{$2} $3", "doc": "二重积分：积分区域与上限可省略", "examples": ["▸ccD;;f(x,y) dxdy;"], "wrapSlot": 2},
  {"id": "contour_integral", "keys": ["c", "d"], "label": "环路积分", "category": "calculus", "glyph": "∮", "slots": ["积分路径", "上限", "被积式"], "optionalSlots": [0, 1], "latex": "\\oint_{$1}^{$2} $3", "doc": "闭合曲线/环路积分：积分路径与上限可省略", "examples": ["▸cdC;;F·dr;"], "wrapSlot": 2},
  {"id": "triple_integral", "keys": ["c", "e"], "label": "三重积分", "category": "calculus", "glyph": "∭", "slots": ["积分体", "上限", "被积式"], "optionalSlots": [0, 1], "latex": "\\iiint_{$1}^{$2} $3", "doc": "三重积分：积分体与上限可省略", "examples": ["▸ceV;;f dV;"], "wrapSlot": 2},
  {"id": "diff", "keys": ["c", "f"], "label": "微分算子", "category": "calculus", "glyph": "dx", "slots": ["阶数", "变量"], "optionalSlots": [0], "latex": "\\mathrm{d}^{$1}$2", "doc": "显式直立微分：阶数留空自动按一阶 \\mathrm{d}x 渲染，支持任意变量与高阶 \\mathrm{d}^2 x", "examples": ["▸cf;x;", "▸cf2;x;"], "wrapSlot": 1},
  {"id": "partial_frac", "keys": ["c", "g"], "label": "偏导分式", "category": "calculus", "glyph": "∂y/∂x", "slots": ["分子", "分母"], "latex": "\\frac{\\partial $1}{\\partial $2}", "doc": "偏导数分式：分子、分母", "examples": ["▸cgy;x;"], "wrapSlot": 0},
  {"id": "partial", "keys": ["c", "h"], "label": "偏导符号", "category": "calculus", "glyph": "∂", "slots": [], "latex": "\\partial", "doc": "偏导算子：\\partial", "examples": ["▸ch"], "wrapSlot": null},
  {"id": "total_frac", "keys": ["c", "i"], "label": "全导分式", "category": "calculus", "glyph": "dy/dx", "slots": ["分子", "分母"], "latex": "\\frac{\\mathrm{d}$1}{\\mathrm{d}$2}", "doc": "全导数分式：分子、分母", "examples": ["▸ciy;x;"], "wrapSlot": 0},
  {"id": "nth_partial", "keys": ["c", "j"], "label": "高阶偏导", "category": "calculus", "glyph": "∂ⁿy/∂xⁿ", "slots": ["阶数", "分子", "分母变量", "分母阶数"], "optionalSlots": [0, 3], "latex": "\\frac{\\partial^{$1} $2}{\\partial $3^{$4}}", "doc": "高阶偏导数分式：支持二阶及以上偏导，阶数留空退化为一阶", "examples": ["▸cj2;u;x;2;"], "wrapSlot": 1},
  {"id": "nth_deriv", "keys": ["c", "k"], "label": "高阶全导", "category": "calculus", "glyph": "dⁿy/dxⁿ", "slots": ["阶数", "分子", "分母变量", "分母阶数"], "optionalSlots": [0, 3], "latex": "\\frac{\\mathrm{d}^{$1} $2}{\\mathrm{d} $3^{$4}}", "doc": "高阶全导数分式：支持二阶及以上常微分导数，阶数留空退化为一阶", "examples": ["▸ck2;y;x;2;"], "wrapSlot": 1},
  {"id": "coprod", "keys": ["c", "l"], "label": "余积/上积", "category": "calculus", "glyph": "∐", "slots": ["下限", "上限", "主体"], "optionalSlots": [0, 1], "latex": "\\coprod_{$1}^{$2} $3", "doc": "范畴余积/不相交并算子：上下限可省略", "examples": ["▸cli=1;n;X_i;"], "wrapSlot": 2},
  {"id": "bigoplus", "keys": ["c", "m"], "label": "大直和", "category": "calculus", "glyph": "⨁", "slots": ["下限", "上限", "主体"], "optionalSlots": [0, 1], "latex": "\\bigoplus_{$1}^{$2} $3", "doc": "向量空间/模的大直和算子：上下限可省略", "examples": ["▸cmi=1;n;V_i;"], "wrapSlot": 2},
  {"id": "bigotimes", "keys": ["c", "n"], "label": "大张量积", "category": "calculus", "glyph": "⨂", "slots": ["下限", "上限", "主体"], "optionalSlots": [0, 1], "latex": "\\bigotimes_{$1}^{$2} $3", "doc": "张量空间/希尔伯特空间大张量积算子：上下限可省略", "examples": ["▸cni=1;n;H_i;"], "wrapSlot": 2},
  {"id": "bigwedge", "keys": ["c", "o"], "label": "大外积/合取", "category": "calculus", "glyph": "⋀", "slots": ["下限", "上限", "主体"], "optionalSlots": [0, 1], "latex": "\\bigwedge_{$1}^{$2} $3", "doc": "外代数楔积/多元合取大算子：上下限可省略", "examples": ["▸coi=1;n;V_i;"], "wrapSlot": 2},
  {"id": "nabla", "keys": ["c", "p"], "label": "梯度算子", "category": "calculus", "glyph": "∇", "slots": [], "latex": "\\nabla", "doc": "梯度算子/劈形算子：\\nabla", "examples": ["▸cp"], "wrapSlot": null},
  {"id": "bigcup", "keys": ["c", "q"], "label": "大并集", "category": "calculus", "glyph": "⋃", "slots": ["下限", "上限", "并集主体"], "optionalSlots": [0, 1], "latex": "\\bigcup_{$1}^{$2} $3", "doc": "带上下限的大并集：\\bigcup_{i=1}^{n} A_i（上下限可省略）", "examples": ["▸cqi=1;n;A_i;"], "wrapSlot": 2},
  {"id": "bigcap", "keys": ["c", "r"], "label": "大交集", "category": "calculus", "glyph": "⋂", "slots": ["下限", "上限", "交集主体"], "optionalSlots": [0, 1], "latex": "\\bigcap_{$1}^{$2} $3", "doc": "带上下限的大交集：\\bigcap_{i=1}^{n} A_i（上下限可省略）", "examples": ["▸cri=1;n;A_i;"], "wrapSlot": 2},
  {"id": "substack_2", "keys": ["c", "s"], "label": "双行下标约束", "category": "calculus", "glyph": "a/b", "slots": ["第一行", "第二行"], "latex": "\\substack{$1 \\\\ $2}", "doc": "多行求和/极限下标约束：\\substack{1 \\le i \\le n \\\\ i \\neq j}", "examples": ["▸csi=1;j=1;"], "wrapSlot": 0},

  // === 3. 矩阵与多行 (m: 17 items, keys a..q, reserved r..z for block matrix, Jacobian, gathered) ===
  {"id": "matrix_2x2", "keys": ["m", "a"], "label": "2×2 矩阵", "category": "matrix", "glyph": "(2×2)", "slots": ["(1,1)", "(1,2)", "(2,1)", "(2,2)"], "latex": "\\begin{pmatrix} $1 & $2 \\\\ $3 & $4 \\end{pmatrix}", "doc": "2×2 圆括号矩阵", "examples": ["▸ma1;2;3;4;"], "wrapSlot": null},
  {"id": "matrix_3x3", "keys": ["m", "b"], "label": "3×3 矩阵", "category": "matrix", "glyph": "(3×3)", "slots": ["(1,1)", "(1,2)", "(1,3)", "(2,1)", "(2,2)", "(2,3)", "(3,1)", "(3,2)", "(3,3)"], "latex": "\\begin{pmatrix} $1 & $2 & $3 \\\\ $4 & $5 & $6 \\\\ $7 & $8 & $9 \\end{pmatrix}", "doc": "3×3 圆括号矩阵", "examples": ["▸mb1;2;3;4;5;6;7;8;9;"], "wrapSlot": null},
  {"id": "det_2x2", "keys": ["m", "c"], "label": "2×2 行列式", "category": "matrix", "glyph": "|2×2|", "slots": ["(1,1)", "(1,2)", "(2,1)", "(2,2)"], "latex": "\\begin{vmatrix} $1 & $2 \\\\ $3 & $4 \\end{vmatrix}", "doc": "2×2 单竖线行列式", "examples": ["▸mc1;2;3;4;"], "wrapSlot": null},
  {"id": "cases_2", "keys": ["m", "d"], "label": "分段函数", "category": "matrix", "glyph": "{cases", "slots": ["表达式1", "条件1", "表达式2", "条件2"], "latex": "\\begin{cases} $1 & $2 \\\\ $3 & $4 \\end{cases}", "doc": "二分段函数：式1、条件1、式2、条件2", "examples": ["▸mdx;x>0;-x;x\\le 0;"], "wrapSlot": 0},
  {"id": "bmatrix_2x2", "keys": ["m", "e"], "label": "方括号矩阵", "category": "matrix", "glyph": "[2×2]", "slots": ["(1,1)", "(1,2)", "(2,1)", "(2,2)"], "latex": "\\begin{bmatrix} $1 & $2 \\\\ $3 & $4 \\end{bmatrix}", "doc": "2×2 方括号矩阵", "examples": ["▸me1;2;3;4;"], "wrapSlot": null},
  {"id": "cases_3", "keys": ["m", "f"], "label": "三分段函数", "category": "matrix", "glyph": "{cases×3", "slots": ["表达式1", "条件1", "表达式2", "条件2", "表达式3", "条件3"], "latex": "\\begin{cases} $1 & $2 \\\\ $3 & $4 \\\\ $5 & $6 \\end{cases}", "doc": "三分段函数：式1、条件1、式2、条件2、式3、条件3", "examples": ["▸mf1;x>0;0;x=0;-1;x<0;"], "wrapSlot": 0},
  {"id": "bmatrix_3x3", "keys": ["m", "g"], "label": "3×3 方块阵", "category": "matrix", "glyph": "[3×3]", "slots": ["(1,1)", "(1,2)", "(1,3)", "(2,1)", "(2,2)", "(2,3)", "(3,1)", "(3,2)", "(3,3)"], "latex": "\\begin{bmatrix} $1 & $2 & $3 \\\\ $4 & $5 & $6 \\\\ $7 & $8 & $9 \\end{bmatrix}", "doc": "3×3 方括号矩阵", "examples": ["▸mg1;2;3;4;5;6;7;8;9;"], "wrapSlot": null},
  {"id": "det_3x3", "keys": ["m", "h"], "label": "3×3 行列式", "category": "matrix", "glyph": "|3×3|", "slots": ["(1,1)", "(1,2)", "(1,3)", "(2,1)", "(2,2)", "(2,3)", "(3,1)", "(3,2)", "(3,3)"], "latex": "\\begin{vmatrix} $1 & $2 & $3 \\\\ $4 & $5 & $6 \\\\ $7 & $8 & $9 \\end{vmatrix}", "doc": "3×3 单竖线行列式", "examples": ["▸mh1;2;3;4;5;6;7;8;9;"], "wrapSlot": null},
  {"id": "matrix_ellipsis", "keys": ["m", "i"], "label": "省略矩阵", "category": "matrix", "glyph": "(n×m)", "slots": ["(1,1)", "(1,2)", "(1,3)", "(1,4)", "(2,1)", "(2,2)", "(2,3)", "(2,4)", "(3,1)", "(3,2)", "(3,3)", "(3,4)", "(4,1)", "(4,2)", "(4,3)", "(4,4)"], "latex": "\\begin{pmatrix} $1 & $2 & \\cdots & $4 \\\\ $5 & $6 & \\cdots & $8 \\\\ \\vdots & \\vdots & \\ddots & \\vdots \\\\ $13 & $14 & \\cdots & $16 \\end{pmatrix}", "doc": "带省略号的 n×m 矩阵（已预填 ⋯ ⋮ ⋱，支持 Shift+方向键增删行列）", "examples": ["▸mi"], "wrapSlot": null},
  {"id": "det_ellipsis", "keys": ["m", "j"], "label": "省略行列式", "category": "matrix", "glyph": "|n×n|", "slots": ["(1,1)", "(1,2)", "(1,3)", "(1,4)", "(2,1)", "(2,2)", "(2,3)", "(2,4)", "(3,1)", "(3,2)", "(3,3)", "(3,4)", "(4,1)", "(4,2)", "(4,3)", "(4,4)"], "latex": "\\begin{vmatrix} $1 & $2 & \\cdots & $4 \\\\ $5 & $6 & \\cdots & $8 \\\\ \\vdots & \\vdots & \\ddots & \\vdots \\\\ $13 & $14 & \\cdots & $16 \\end{vmatrix}", "doc": "带省略号的 n 阶行列式（如范德蒙德行列式，已预填 ⋯ ⋮ ⋱，支持 Shift+方向键增删行列）", "examples": ["▸mj"], "wrapSlot": null},
  {"id": "aug_matrix", "keys": ["m", "k"], "label": "增广矩阵", "category": "matrix", "glyph": "[A|b]", "slots": ["(1,1)", "(1,2)", "(1,3)", "(2,1)", "(2,2)", "(2,3)"], "latex": "\\left[\\begin{array}{cc|c} $1 & $2 & $3 \\\\ $4 & $5 & $6 \\end{array}\\right]", "doc": "线性方程组增广矩阵 [A|b]（支持增删行列与切换 | 分隔线）", "examples": ["▸mk1;2;3;4;5;6;"], "wrapSlot": null},
  {"id": "smallmatrix", "keys": ["m", "l"], "label": "行内小矩阵", "category": "matrix", "glyph": "(a b)", "slots": ["(1,1)", "(1,2)", "(2,1)", "(2,2)"], "latex": "\\begin{smallmatrix} $1 & $2 \\\\ $3 & $4 \\end{smallmatrix}", "doc": "紧凑行内小矩阵：\\begin{smallmatrix}", "examples": ["▸ml1;2;3;4;"], "wrapSlot": null},
  {"id": "dcases_2", "keys": ["m", "m"], "label": "展示分段 dcases", "category": "matrix", "glyph": "{dcases", "slots": ["表达式1", "条件1", "表达式2", "条件2"], "latex": "\\begin{dcases} $1 & $2 \\\\ $3 & $4 \\end{dcases}", "doc": "行间展示态分段函数（分式/积分不缩字号）：\\begin{dcases}", "examples": ["▸mmx;x>0;-x;x\\le 0;"], "wrapSlot": 0},
  {"id": "rcases_2", "keys": ["m", "n"], "label": "右括号分段 rcases", "category": "matrix", "glyph": "rcases}", "slots": ["表达式1", "条件1", "表达式2", "条件2"], "latex": "\\begin{rcases} $1 & $2 \\\\ $3 & $4 \\end{rcases}", "doc": "右侧花括号分段推导：\\begin{rcases}", "examples": ["▸mna;b;c;d;"], "wrapSlot": 0},
  {"id": "aligned_2", "keys": ["m", "o"], "label": "多行对齐 aligned", "category": "matrix", "glyph": "&=对齐", "slots": ["(1,1)", "(1,2)", "(2,1)", "(2,2)"], "latex": "\\begin{aligned} $1 & $2 \\\\ $3 & $4 \\end{aligned}", "doc": "一等多列对齐推导环境：支持 Shift+方向键自由增删行与对齐列", "examples": ["▸mof(x);=a+b;;=c;"], "wrapSlot": 0},
  {"id": "Bmatrix_2x2", "keys": ["m", "p"], "label": "花括号矩阵", "category": "matrix", "glyph": "{2×2}", "slots": ["(1,1)", "(1,2)", "(2,1)", "(2,2)"], "latex": "\\begin{Bmatrix} $1 & $2 \\\\ $3 & $4 \\end{Bmatrix}", "doc": "2×2 花括号矩阵：\\begin{Bmatrix}", "examples": ["▸mp1;2;3;4;"], "wrapSlot": null},
  {"id": "Vmatrix_2x2", "keys": ["m", "q"], "label": "双竖线范数阵", "category": "matrix", "glyph": "‖2×2‖", "slots": ["(1,1)", "(1,2)", "(2,1)", "(2,2)"], "latex": "\\begin{Vmatrix} $1 & $2 \\\\ $3 & $4 \\end{Vmatrix}", "doc": "2×2 双竖线矩阵范数：\\begin{Vmatrix}", "examples": ["▸mq1;2;3;4;"], "wrapSlot": null},

  // === 4. 定界与狄拉克 (z: 13 items, lowercase mnemonic keys, reserved m,o..z for \braket3, outer product, \llbracket) ===
  {"id": "bracket", "keys": ["z", "a"], "label": "中括号", "category": "delimiter", "glyph": "[x]", "slots": ["中括号内"], "latex": "\\left[$1\\right]", "doc": "自适应方括号定界：\\left[ x\\right]", "examples": ["▸zax;"], "wrapSlot": 0},
  {"id": "brace", "keys": ["z", "b"], "label": "大括号/集合", "category": "delimiter", "glyph": "{x}", "slots": ["大括号内"], "latex": "\\left\\{$1\\right\\}", "doc": "自适应花括号定界：\\left\\{ x\\right\\}", "examples": ["▸zbx;"], "wrapSlot": 0},
  {"id": "norm", "keys": ["z", "n"], "label": "范数", "category": "delimiter", "glyph": "‖x‖", "slots": ["范数内"], "latex": "\\left\\Vert $1\\right\\Vert", "doc": "双竖线范数定界：\\left\\Vert x\\right\\Vert", "examples": ["▸znx;"], "wrapSlot": 0},
  {"id": "angle", "keys": ["z", "g"], "label": "尖括号内积", "category": "delimiter", "glyph": "⟨x⟩", "slots": ["尖括号内"], "latex": "\\left\\langle $1\\right\\rangle", "doc": "尖括号内积定界：\\left\\langle x\\right\\rangle", "examples": ["▸zgx;"], "wrapSlot": 0},
  {"id": "floor", "keys": ["z", "f"], "label": "向下取整", "category": "delimiter", "glyph": "⌊x⌋", "slots": ["向下取整内"], "latex": "\\left\\lfloor $1\\right\\rfloor", "doc": "向下取整定界：\\left\\lfloor x\\right\\rfloor", "examples": ["▸zfx;"], "wrapSlot": 0},
  {"id": "ceil", "keys": ["z", "c"], "label": "向上取整", "category": "delimiter", "glyph": "⌈x⌉", "slots": ["向上取整内"], "latex": "\\left\\lceil $1\\right\\rceil", "doc": "向上取整定界：\\left\\lceil x\\right\\rceil", "examples": ["▸zcx;"], "wrapSlot": 0},
  {"id": "interval_oc", "keys": ["z", "h"], "label": "左开右闭区间", "category": "delimiter", "glyph": "(a,b]", "slots": ["区间内容"], "latex": "\\left($1\\right]", "doc": "左开右闭混合区间：\\left(a, b\\right]", "examples": ["▸zha,b;"], "wrapSlot": 0},
  {"id": "interval_co", "keys": ["z", "j"], "label": "左闭右开区间", "category": "delimiter", "glyph": "[a,b)", "slots": ["区间内容"], "latex": "\\left[$1\\right)", "doc": "左闭右开混合区间：\\left[a, b\\right)", "examples": ["▸zja,b;"], "wrapSlot": 0},
  {"id": "eval_bar", "keys": ["z", "e"], "label": "代入求值线", "category": "delimiter", "glyph": "F|_a^b", "slots": ["表达式", "下限", "上限"], "optionalSlots": [1, 2], "latex": "\\left. $1\\right|_{$2}^{$3}", "doc": "代入求值竖线：上下限可省略", "examples": ["▸zeF;a;b;"], "wrapSlot": 0},
  {"id": "boxed", "keys": ["z", "d"], "label": "公式外框", "category": "delimiter", "glyph": "[x]", "slots": ["框内公式"], "latex": "\\boxed{$1}", "doc": "高亮结论外框：\\boxed{E = mc^2}", "examples": ["▸zdx;"], "wrapSlot": 0},
  {"id": "ket", "keys": ["z", "k"], "label": "狄拉克右矢", "category": "delimiter", "glyph": "|ψ⟩", "slots": ["态矢"], "latex": "\\left| $1 \\right\\rangle", "doc": "量子力学右矢（Ket）：\\left| \\psi \\right\\rangle（支持直输 \\ket{\\psi}）", "examples": ["▸zkpsi;"], "wrapSlot": 0},
  {"id": "bra", "keys": ["z", "l"], "label": "狄拉克左矢", "category": "delimiter", "glyph": "⟨φ|", "slots": ["左矢"], "latex": "\\left\\langle $1 \\right|", "doc": "量子力学左矢（Bra）：\\left\\langle \\phi \\right|（支持直输 \\bra{\\phi}）", "examples": ["▸zlphi;"], "wrapSlot": 0},
  {"id": "braket", "keys": ["z", "i"], "label": "狄拉克内积", "category": "delimiter", "glyph": "⟨φ|ψ⟩", "slots": ["左矢", "右矢"], "latex": "\\left\\langle $1 \\,\\middle|\\, $2 \\right\\rangle", "doc": "量子态内积（Bra-Ket）：\\left\\langle \\phi \\,\\middle|\\, \\psi \\right\\rangle（支持直输 \\braket{\\phi}{\\psi}）", "examples": ["▸ziphi;psi;"], "wrapSlot": 0},

  // === 5. 顶底标饰与消去 (a: 21 items, keys a..u, reserved v..z for \dddot, \check, \breve, \overparen) ===
  {"id": "hat", "keys": ["a", "a"], "label": "帽子", "category": "accent", "glyph": "hat", "slots": ["帽子内"], "latex": "\\hat{$1}", "doc": "帽子标注：\\hat{x}", "examples": ["▸aax;"], "wrapSlot": 0},
  {"id": "bar", "keys": ["a", "b"], "label": "上横线", "category": "accent", "glyph": "bar", "slots": ["横线内"], "latex": "\\bar{$1}", "doc": "上横线标注：\\bar{x}", "examples": ["▸abx;"], "wrapSlot": 0},
  {"id": "vec", "keys": ["a", "c"], "label": "向量箭头", "category": "accent", "glyph": "vec", "slots": ["向量内"], "latex": "\\vec{$1}", "doc": "向量箭头标注：\\vec{x}", "examples": ["▸acx;"], "wrapSlot": 0},
  {"id": "tilde", "keys": ["a", "d"], "label": "波浪号", "category": "accent", "glyph": "tilde", "slots": ["波浪号内"], "latex": "\\tilde{$1}", "doc": "波浪号标注：\\tilde{x}", "examples": ["▸adx;"], "wrapSlot": 0},
  {"id": "dot", "keys": ["a", "e"], "label": "一阶导点", "category": "accent", "glyph": "dot", "slots": ["导点内"], "latex": "\\dot{$1}", "doc": "一阶导点标注：\\dot{x}", "examples": ["▸aex;"], "wrapSlot": 0},
  {"id": "widehat", "keys": ["a", "f"], "label": "宽帽子", "category": "accent", "glyph": "AB̂", "slots": ["宽帽子内"], "latex": "\\widehat{$1}", "doc": "自适应宽帽子标注：\\widehat{AB}", "examples": ["▸afAB;"], "wrapSlot": 0},
  {"id": "overline", "keys": ["a", "g"], "label": "上划线", "category": "accent", "glyph": "overline", "slots": ["上划线内"], "latex": "\\overline{$1}", "doc": "长上划线标注：\\overline{x}", "examples": ["▸agx;"], "wrapSlot": 0},
  {"id": "ddot", "keys": ["a", "h"], "label": "二阶导点", "category": "accent", "glyph": "ddot", "slots": ["二阶导点内"], "latex": "\\ddot{$1}", "doc": "二阶导点标注：\\ddot{x}", "examples": ["▸ahx;"], "wrapSlot": 0},
  {"id": "underline", "keys": ["a", "i"], "label": "下划线", "category": "accent", "glyph": "underline", "slots": ["下划线内"], "latex": "\\underline{$1}", "doc": "下划线标注：\\underline{x}", "examples": ["▸aix;"], "wrapSlot": 0},
  {"id": "overbrace", "keys": ["a", "j"], "label": "上花括号", "category": "accent", "glyph": "overbrace", "slots": ["主体", "标注"], "optionalSlots": [1], "latex": "\\overbrace{$1}^{$2}", "doc": "上花括号标注：标注留空自动省略", "examples": ["▸ajx;标注;"], "wrapSlot": 0},
  {"id": "underbrace", "keys": ["a", "k"], "label": "下花括号", "category": "accent", "glyph": "underbrace", "slots": ["主体", "标注"], "optionalSlots": [1], "latex": "\\underbrace{$1}_{$2}", "doc": "下花括号标注：标注留空自动省略", "examples": ["▸akx;标注;"], "wrapSlot": 0},
  {"id": "widetilde", "keys": ["a", "l"], "label": "宽波浪", "category": "accent", "glyph": "AB̃", "slots": ["宽波浪内"], "latex": "\\widetilde{$1}", "doc": "自适应宽波浪标注：\\widetilde{AB}", "examples": ["▸alAB;"], "wrapSlot": 0},
  {"id": "overrightarrow", "keys": ["a", "m"], "label": "长向量箭头", "category": "accent", "glyph": "AB⃗", "slots": ["向量终点"], "latex": "\\overrightarrow{$1}", "doc": "自适应长向量箭头：\\overrightarrow{AB}", "examples": ["▸amAB;"], "wrapSlot": 0},
  {"id": "overleftarrow", "keys": ["a", "n"], "label": "左向长箭头", "category": "accent", "glyph": "←AB", "slots": ["箭头内"], "latex": "\\overleftarrow{$1}", "doc": "自适应左向长箭头标注：\\overleftarrow{AB}", "examples": ["▸anAB;"], "wrapSlot": 0},
  {"id": "overleftrightarrow", "keys": ["a", "o"], "label": "双向长箭头", "category": "accent", "glyph": "↔AB", "slots": ["箭头内"], "latex": "\\overleftrightarrow{$1}", "doc": "自适应双向长直线/箭头标注：\\overleftrightarrow{AB}", "examples": ["▸aoAB;"], "wrapSlot": 0},
  {"id": "stackrel", "keys": ["a", "p"], "label": "关系上标", "category": "accent", "glyph": "a/=", "slots": ["上方标注", "关系主体"], "latex": "\\stackrel{$1}{$2}", "doc": "关系符上方标注：\\stackrel{\\text{def}}{=}", "examples": ["▸apdef;=;"], "wrapSlot": 1},
  {"id": "bcancel", "keys": ["a", "q"], "label": "反斜线消去", "category": "accent", "glyph": "x\\", "slots": ["消去项"], "latex": "\\bcancel{$1}", "doc": "反斜线划去消去：\\bcancel{x}", "examples": ["▸aqx;"], "wrapSlot": 0},
  {"id": "xcancel", "keys": ["a", "r"], "label": "交叉消去", "category": "accent", "glyph": "x✕", "slots": ["消去项"], "latex": "\\xcancel{$1}", "doc": "交叉双斜线消去：\\xcancel{x}", "examples": ["▸arx;"], "wrapSlot": 0},
  {"id": "overset", "keys": ["a", "s"], "label": "上叠标注", "category": "accent", "glyph": "a/b", "slots": ["上标注", "主体"], "latex": "\\overset{$1}{$2}", "doc": "上方叠加标注：\\overset{上标注}{主体}", "examples": ["▸asdef;=;"], "wrapSlot": 1},
  {"id": "underset", "keys": ["a", "t"], "label": "下叠标注", "category": "accent", "glyph": "b/a", "slots": ["下标注", "主体"], "latex": "\\underset{$1}{$2}", "doc": "下方叠加标注：\\underset{下标注}{主体}", "examples": ["▸atx\\to 0;f(x);"], "wrapSlot": 1},
  {"id": "cancel", "keys": ["a", "u"], "label": "斜线消去", "category": "accent", "glyph": "x/", "slots": ["消去项"], "latex": "\\cancel{$1}", "doc": "划去/约分消去线：\\cancel{x}", "examples": ["▸aux;"], "wrapSlot": 0},

  // === 6. 字体·数域·排版 (h: 23 items, lowercase mnemonic keys, reserved h,j,x + uppercase for \qquad, \!, \phantom, units) ===
  {"id": "text_box", "keys": ["h", "a"], "label": "文本注释", "category": "font", "glyph": "txt", "slots": ["文本"], "latex": "\\text{$1}", "doc": "可编辑正体文本：适合分段条件与中文说明 \\text{...}", "examples": ["▸ha当 x>0;"], "wrapSlot": 0},
  {"id": "mathbf", "keys": ["h", "b"], "label": "粗体向量", "category": "font", "glyph": "𝐁", "slots": ["粗体内"], "latex": "\\mathbf{$1}", "doc": "数学粗体（向量/矩阵）：\\mathbf{x}", "examples": ["▸hbx;"], "wrapSlot": 0},
  {"id": "boldsymbol", "keys": ["h", "i"], "label": "粗斜体符号", "category": "font", "glyph": "𝜽", "slots": ["粗符号"], "latex": "\\boldsymbol{$1}", "doc": "粗体希腊字母与向量符号：\\boldsymbol{\\theta}", "examples": ["▸hitheta;"], "wrapSlot": 0},
  {"id": "mathcal", "keys": ["h", "c"], "label": "花体字母", "category": "font", "glyph": "ℒ", "slots": ["花体内"], "latex": "\\mathcal{$1}", "doc": "数学花体（拉氏变换/损失函数/集合族）：\\mathcal{L}", "examples": ["▸hcL;"], "wrapSlot": 0},
  {"id": "mathscr", "keys": ["h", "l"], "label": "手写花体", "category": "font", "glyph": "ℱ", "slots": ["手写体"], "latex": "\\mathscr{$1}", "doc": "手写花体（傅里叶算子/波莱尔代数）：\\mathscr{F}", "examples": ["▸hlF;"], "wrapSlot": 0},
  {"id": "mathbb", "keys": ["h", "d"], "label": "黑板粗体", "category": "font", "glyph": "𝔼", "slots": ["字母"], "latex": "\\mathbb{$1}", "doc": "黑板粗体（期望/概率/数域）：\\mathbb{E}", "examples": ["▸hdE;"], "wrapSlot": 0},
  {"id": "mathfrak", "keys": ["h", "f"], "label": "哥特花体", "category": "font", "glyph": "𝔤", "slots": ["哥特体"], "latex": "\\mathfrak{$1}", "doc": "哥特体（李代数/理想）：\\mathfrak{g}", "examples": ["▸hfg;"], "wrapSlot": 0},
  {"id": "mathrm", "keys": ["h", "r"], "label": "正体罗马", "category": "font", "glyph": "rm", "slots": ["正体内"], "latex": "\\mathrm{$1}", "doc": "数学正体罗马字体（单位/群名/下标说明）：\\mathrm{SO}(3)", "examples": ["▸hrSO;"], "wrapSlot": 0},
  {"id": "mathsf", "keys": ["h", "s"], "label": "无衬线体", "category": "font", "glyph": "𝖳", "slots": ["无衬线"], "latex": "\\mathsf{$1}", "doc": "数学无衬线体（转置/张量/范畴）：\\mathsf{T}", "examples": ["▸hsT;"], "wrapSlot": 0},
  {"id": "mathtt", "keys": ["h", "k"], "label": "等宽代码体", "category": "font", "glyph": "tt", "slots": ["等宽体"], "latex": "\\mathtt{$1}", "doc": "数学等宽体（算法/变量标识）：\\mathtt{id}", "examples": ["▸hkid;"], "wrapSlot": 0},
  {"id": "operatorname", "keys": ["h", "o"], "label": "自定义算子", "category": "font", "glyph": "op", "slots": ["算子名"], "latex": "\\operatorname{$1}", "doc": "正体数学算子：\\operatorname{softmax}", "examples": ["▸hosoftmax;"], "wrapSlot": 0},
  {"id": "tag_eq", "keys": ["h", "g"], "label": "公式编号 tag", "category": "font", "glyph": "(1)", "slots": ["编号"], "latex": "\\tag{$1}", "doc": "可编辑块级公式右对齐编号：\\tag{1}", "examples": ["▸hg1;"], "wrapSlot": 0},
  {"id": "pmod", "keys": ["h", "m"], "label": "同余模", "category": "font", "glyph": "(mod)", "slots": ["模数"], "latex": "\\pmod{$1}", "doc": "括号同余模运算：\\pmod{n}", "examples": ["▸hmn;"], "wrapSlot": 0},
  {"id": "quad_space", "keys": ["h", "q"], "label": "宽空格", "category": "font", "glyph": "␣␣", "slots": [], "latex": "\\quad", "doc": "1em 显式排版间距：\\quad (也可直输 \\quad 或 quad)", "examples": ["▸hq"], "wrapSlot": null},
  {"id": "thin_space", "keys": ["h", "t"], "label": "细空格", "category": "font", "glyph": "␣", "slots": [], "latex": "\\,", "doc": "细排版间距：\\, (也可直输 \\,)", "examples": ["▸ht"], "wrapSlot": null},
  {"id": "raw_latex", "keys": ["h", "v"], "label": "原生 LaTeX 槽", "category": "font", "glyph": "\\TeX", "slots": ["原生源码"], "latex": "$1", "doc": "原生 LaTeX 透传槽：连敲两次 \\\\（或 Tab h v）开启，内部纯字面不触发语法糖，按 Enter / Tab 跳出并渲染", "examples": ["▸hvG/H;"], "wrapSlot": 0},
  {"id": "real_set", "keys": ["h", "w"], "label": "实数集", "category": "font", "glyph": "ℝ", "slots": [], "latex": "\\mathbb{R}", "doc": "实数集：\\mathbb{R}", "examples": ["▸hw"], "wrapSlot": null},
  {"id": "nat_set", "keys": ["h", "n"], "label": "自然数集", "category": "font", "glyph": "ℕ", "slots": [], "latex": "\\mathbb{N}", "doc": "自然数集：\\mathbb{N}", "examples": ["▸hn"], "wrapSlot": null},
  {"id": "int_set", "keys": ["h", "z"], "label": "整数集", "category": "font", "glyph": "ℤ", "slots": [], "latex": "\\mathbb{Z}", "doc": "整数集：\\mathbb{Z}", "examples": ["▸hz"], "wrapSlot": null},
  {"id": "rat_set", "keys": ["h", "u"], "label": "有理数集", "category": "font", "glyph": "ℚ", "slots": [], "latex": "\\mathbb{Q}", "doc": "有理数集：\\mathbb{Q}", "examples": ["▸hu"], "wrapSlot": null},
  {"id": "complex_set", "keys": ["h", "y"], "label": "复数集", "category": "font", "glyph": "ℂ", "slots": [], "latex": "\\mathbb{C}", "doc": "复数集：\\mathbb{C}", "examples": ["▸hy"], "wrapSlot": null},
  {"id": "prob_set", "keys": ["h", "p"], "label": "概率测度", "category": "font", "glyph": "ℙ", "slots": [], "latex": "\\mathbb{P}", "doc": "概率测度符号：\\mathbb{P}", "examples": ["▸hp"], "wrapSlot": null},
  {"id": "expect_set", "keys": ["h", "e"], "label": "数学期望", "category": "font", "glyph": "𝔼", "slots": [], "latex": "\\mathbb{E}", "doc": "数学期望符号：\\mathbb{E}", "examples": ["▸he"], "wrapSlot": null},

  // === 7. 箭头与映射 (y: 17 items, keys a..q, reserved r..z for \twoheadrightarrow, \rightleftharpoons, \nearrow) ===
  {"id": "to", "keys": ["y", "a"], "label": "趋向/右箭头", "category": "arrow", "glyph": "→", "slots": [], "latex": "\\to", "doc": "趋向箭头：\\to (也可直输 ->)", "examples": ["▸ya"], "wrapSlot": null},
  {"id": "leftarrow", "keys": ["y", "b"], "label": "左箭头", "category": "arrow", "glyph": "←", "slots": [], "latex": "\\leftarrow", "doc": "左箭头：\\leftarrow", "examples": ["▸yb"], "wrapSlot": null},
  {"id": "leftrightarrow", "keys": ["y", "c"], "label": "双向箭头", "category": "arrow", "glyph": "↔", "slots": [], "latex": "\\leftrightarrow", "doc": "双向箭头：\\leftrightarrow", "examples": ["▸yc"], "wrapSlot": null},
  {"id": "uparrow", "keys": ["y", "d"], "label": "上箭头", "category": "arrow", "glyph": "↑", "slots": [], "latex": "\\uparrow", "doc": "向上箭头：\\uparrow", "examples": ["▸yd"], "wrapSlot": null},
  {"id": "downarrow", "keys": ["y", "e"], "label": "下箭头", "category": "arrow", "glyph": "↓", "slots": [], "latex": "\\downarrow", "doc": "向下箭头：\\downarrow", "examples": ["▸ye"], "wrapSlot": null},
  {"id": "implies", "keys": ["y", "f"], "label": "蕴含", "category": "arrow", "glyph": "⇒", "slots": [], "latex": "\\Rightarrow", "doc": "蕴含箭头：\\Rightarrow", "examples": ["▸yf"], "wrapSlot": null},
  {"id": "iff", "keys": ["y", "g"], "label": "等价", "category": "arrow", "glyph": "⇔", "slots": [], "latex": "\\Leftrightarrow", "doc": "当且仅当/等价箭头：\\Leftrightarrow", "examples": ["▸yg"], "wrapSlot": null},
  {"id": "mapsto", "keys": ["y", "h"], "label": "映射", "category": "arrow", "glyph": "↦", "slots": [], "latex": "\\mapsto", "doc": "映射箭头：\\mapsto", "examples": ["▸yh"], "wrapSlot": null},
  {"id": "hookrightarrow", "keys": ["y", "i"], "label": "嵌入映射", "category": "arrow", "glyph": "↪", "slots": [], "latex": "\\hookrightarrow", "doc": "单射/嵌入箭头：\\hookrightarrow", "examples": ["▸yi"], "wrapSlot": null},
  {"id": "xrightarrow", "keys": ["y", "j"], "label": "标注右箭头", "category": "arrow", "glyph": "─→", "slots": ["下标", "上标"], "optionalSlots": [0], "latex": "\\xrightarrow[$1]{$2}", "doc": "带上下标注的长右箭头（下标可省略）：\\xrightarrow[下]{上}", "examples": ["▸yjf;"], "wrapSlot": 1},
  {"id": "xleftarrow", "keys": ["y", "k"], "label": "标注左箭头", "category": "arrow", "glyph": "←─", "slots": ["下标", "上标"], "optionalSlots": [0], "latex": "\\xleftarrow[$1]{$2}", "doc": "带上下标注的长左箭头（下标可省略）：\\xleftarrow[下]{上}", "examples": ["▸ykg;"], "wrapSlot": 1},
  {"id": "xRightarrow", "keys": ["y", "l"], "label": "双线长右推", "category": "arrow", "glyph": "══⇒", "slots": ["下标", "上标"], "optionalSlots": [0], "latex": "\\xRightarrow[$1]{$2}", "doc": "带上下标注的双线推导长箭头（下标可省略）：\\xRightarrow[下]{上}", "examples": ["▸yl;L^2;"], "wrapSlot": 1},
  {"id": "xLeftrightarrow", "keys": ["y", "m"], "label": "双线长等价", "category": "arrow", "glyph": "⇐═⇒", "slots": ["下标", "上标"], "optionalSlots": [0], "latex": "\\xLeftrightarrow[$1]{$2}", "doc": "带上下标注的双线等价长箭头（下标可省略）：\\xLeftrightarrow[下]{上}", "examples": ["▸ym;def;"], "wrapSlot": 1},
  {"id": "xmapsto", "keys": ["y", "n"], "label": "标注长映射", "category": "arrow", "glyph": "├─→", "slots": ["下标", "上标"], "optionalSlots": [0], "latex": "\\xmapsto[$1]{$2}", "doc": "带上下标注的长映射箭头（下标可省略）：\\xmapsto[下]{上}", "examples": ["▸yn;f;"], "wrapSlot": 1},
  {"id": "nrightarrow", "keys": ["y", "o"], "label": "不趋向", "category": "arrow", "glyph": "↛", "slots": [], "latex": "\\nrightarrow", "doc": "不趋向/不映射箭头：\\nrightarrow (也可直输 !-> 或 nto)", "examples": ["▸yo"], "wrapSlot": null},
  {"id": "nRightarrow", "keys": ["y", "p"], "label": "不蕴含", "category": "arrow", "glyph": "⇏", "slots": [], "latex": "\\nRightarrow", "doc": "不蕴含箭头：\\nRightarrow (也可直输 !=> 或 nimplies)", "examples": ["▸yp"], "wrapSlot": null},
  {"id": "nLeftrightarrow", "keys": ["y", "q"], "label": "不等价", "category": "arrow", "glyph": "⇎", "slots": [], "latex": "\\nLeftrightarrow", "doc": "不等价双向箭头：\\nLeftrightarrow (也可直输 !<=> 或 niff)", "examples": ["▸yq"], "wrapSlot": null},

  // === 8. 运算与几何 (o: 22 items, keys a..v, reserved w..z for \ominus, \bullet, \Re, \Im) ===
  {"id": "infty", "keys": ["o", "a"], "label": "无穷", "category": "symbol", "glyph": "∞", "slots": [], "latex": "\\infty", "doc": "无穷大符号：\\infty (也可直输 oo)", "examples": ["▸oa"], "wrapSlot": null},
  {"id": "pm", "keys": ["o", "b"], "label": "正负", "category": "symbol", "glyph": "±", "slots": [], "latex": "\\pm", "doc": "正负号：\\pm (也可直输 +-)", "examples": ["▸ob"], "wrapSlot": null},
  {"id": "mp", "keys": ["o", "c"], "label": "负正", "category": "symbol", "glyph": "∓", "slots": [], "latex": "\\mp", "doc": "负正号：\\mp (也可直输 -+)", "examples": ["▸oc"], "wrapSlot": null},
  {"id": "cdot", "keys": ["o", "d"], "label": "点乘", "category": "symbol", "glyph": "·", "slots": [], "latex": "\\cdot", "doc": "点乘符号：\\cdot", "examples": ["▸od"], "wrapSlot": null},
  {"id": "times", "keys": ["o", "e"], "label": "叉乘", "category": "symbol", "glyph": "×", "slots": [], "latex": "\\times", "doc": "乘号/叉乘：\\times", "examples": ["▸oe"], "wrapSlot": null},
  {"id": "div_op", "keys": ["o", "f"], "label": "除号", "category": "symbol", "glyph": "÷", "slots": [], "latex": "\\div", "doc": "算术除号：\\div (也可直输 div)", "examples": ["▸of"], "wrapSlot": null},
  {"id": "circ", "keys": ["o", "g"], "label": "圈乘/度", "category": "symbol", "glyph": "∘", "slots": [], "latex": "\\circ", "doc": "复合函数圈乘/度数：\\circ", "examples": ["▸og"], "wrapSlot": null},
  {"id": "oplus", "keys": ["o", "h"], "label": "直和/异或", "category": "symbol", "glyph": "⊕", "slots": [], "latex": "\\oplus", "doc": "直和/按位异或算子：\\oplus (也可直输 oplus)", "examples": ["▸oh"], "wrapSlot": null},
  {"id": "otimes", "keys": ["o", "i"], "label": "张量积", "category": "symbol", "glyph": "⊗", "slots": [], "latex": "\\otimes", "doc": "张量积/克罗内克积：\\otimes (也可直输 otimes)", "examples": ["▸oi"], "wrapSlot": null},
  {"id": "wedge", "keys": ["o", "j"], "label": "楔积/外积", "category": "symbol", "glyph": "∧", "slots": [], "latex": "\\wedge", "doc": "微分形式外积/楔积：\\wedge (也可直输 wedge)", "examples": ["▸oj"], "wrapSlot": null},
  {"id": "star_op", "keys": ["o", "k"], "label": "星号算子", "category": "symbol", "glyph": "⋆", "slots": [], "latex": "\\star", "doc": "霍奇星号/卷积星算子：\\star (也可直输 star)", "examples": ["▸ok"], "wrapSlot": null},
  {"id": "dagger", "keys": ["o", "l"], "label": "共轭转置", "category": "symbol", "glyph": "†", "slots": [], "latex": "\\dagger", "doc": "埃尔米特共轭/伴随算符：\\dagger (也可直输 dagger)", "examples": ["▸ol"], "wrapSlot": null},
  {"id": "hbar", "keys": ["o", "m"], "label": "约化普朗克", "category": "symbol", "glyph": "ℏ", "slots": [], "latex": "\\hbar", "doc": "约化普朗克常数：\\hbar", "examples": ["▸om"], "wrapSlot": null},
  {"id": "ell", "keys": ["o", "n"], "label": "花体l", "category": "symbol", "glyph": "ℓ", "slots": [], "latex": "\\ell", "doc": "花体字母 l：\\ell", "examples": ["▸on"], "wrapSlot": null},
  {"id": "parallel", "keys": ["o", "o"], "label": "平行", "category": "symbol", "glyph": "∥", "slots": [], "latex": "\\parallel", "doc": "平行符号：\\parallel (也可直输 ||)", "examples": ["▸oo"], "wrapSlot": null},
  {"id": "nparallel", "keys": ["o", "p"], "label": "不平行", "category": "symbol", "glyph": "∦", "slots": [], "latex": "\\nparallel", "doc": "不平行符号：\\nparallel (也可直输 !|| 或 nparallel)", "examples": ["▸op"], "wrapSlot": null},
  {"id": "perp", "keys": ["o", "q"], "label": "垂直", "category": "symbol", "glyph": "⊥", "slots": [], "latex": "\\perp", "doc": "垂直/正交符号：\\perp (也可直输 _|_)", "examples": ["▸oq"], "wrapSlot": null},
  {"id": "cdots", "keys": ["o", "r"], "label": "横省略号", "category": "symbol", "glyph": "⋯", "slots": [], "latex": "\\cdots", "doc": "居中横省略号：\\cdots (也可直输 ... 或 cdots)", "examples": ["▸or"], "wrapSlot": null},
  {"id": "vdots", "keys": ["o", "s"], "label": "竖省略号", "category": "symbol", "glyph": "⋮", "slots": [], "latex": "\\vdots", "doc": "竖向省略号：\\vdots (也可直输 ::: 或 vdots)", "examples": ["▸os"], "wrapSlot": null},
  {"id": "ddots", "keys": ["o", "t"], "label": "斜省略号", "category": "symbol", "glyph": "⋱", "slots": [], "latex": "\\ddots", "doc": "斜向省略号：\\ddots (也可直输 ddots)", "examples": ["▸ot"], "wrapSlot": null},
  {"id": "triangle", "keys": ["o", "u"], "label": "三角形", "category": "symbol", "glyph": "△", "slots": [], "latex": "\\triangle", "doc": "几何三角形/对称差符号：\\triangle (也可直输 triangle)", "examples": ["▸ou"], "wrapSlot": null},
  {"id": "square_sym", "keys": ["o", "v"], "label": "正方形/证毕", "category": "symbol", "glyph": "□", "slots": [], "latex": "\\square", "doc": "正方形/达朗贝尔算子/证毕符号：\\square", "examples": ["▸ov"], "wrapSlot": null},

  // === 9. 等式与不等式 (x: 23 items, keys a..w, reserved x..z for \prec, \succ, \triangleq) ===
  {"id": "equiv", "keys": ["x", "a"], "label": "恒等", "category": "relation", "glyph": "≡", "slots": [], "latex": "\\equiv", "doc": "恒等于/同余：\\equiv", "examples": ["▸xa"], "wrapSlot": null},
  {"id": "approx", "keys": ["x", "b"], "label": "近似", "category": "relation", "glyph": "≈", "slots": [], "latex": "\\approx", "doc": "约等于：\\approx", "examples": ["▸xb"], "wrapSlot": null},
  {"id": "sim", "keys": ["x", "c"], "label": "相似", "category": "relation", "glyph": "∼", "slots": [], "latex": "\\sim", "doc": "相似于：\\sim", "examples": ["▸xc"], "wrapSlot": null},
  {"id": "simeq", "keys": ["x", "d"], "label": "渐近相等", "category": "relation", "glyph": "≃", "slots": [], "latex": "\\simeq", "doc": "渐近相等/相似等于：\\simeq", "examples": ["▸xd"], "wrapSlot": null},
  {"id": "cong", "keys": ["x", "e"], "label": "全等/同余", "category": "relation", "glyph": "≅", "slots": [], "latex": "\\cong", "doc": "全等/同余：\\cong (也可直输 ~=)", "examples": ["▸xe"], "wrapSlot": null},
  {"id": "propto", "keys": ["x", "f"], "label": "正比", "category": "relation", "glyph": "∝", "slots": [], "latex": "\\propto", "doc": "正比于：\\propto", "examples": ["▸xf"], "wrapSlot": null},
  {"id": "coloneqq", "keys": ["x", "g"], "label": "定义为", "category": "relation", "glyph": "≔", "slots": [], "latex": "\\coloneqq", "doc": "定义等于符号：\\coloneqq (也可直输 :=)", "examples": ["▸xg"], "wrapSlot": null},
  {"id": "leq", "keys": ["x", "h"], "label": "小于等于", "category": "relation", "glyph": "≤", "slots": [], "latex": "\\le", "doc": "小于等于：\\le (也可直输 <=)", "examples": ["▸xh"], "wrapSlot": null},
  {"id": "geq", "keys": ["x", "i"], "label": "大于等于", "category": "relation", "glyph": "≥", "slots": [], "latex": "\\ge", "doc": "大于等于：\\ge (也可直输 >=)", "examples": ["▸xi"], "wrapSlot": null},
  {"id": "neq", "keys": ["x", "j"], "label": "不等于", "category": "relation", "glyph": "≠", "slots": [], "latex": "\\neq", "doc": "不等于：\\neq (也可直输 !=)", "examples": ["▸xj"], "wrapSlot": null},
  {"id": "ll", "keys": ["x", "k"], "label": "远小于", "category": "relation", "glyph": "≪", "slots": [], "latex": "\\ll", "doc": "远小于：\\ll (也可直输 <<)", "examples": ["▸xk"], "wrapSlot": null},
  {"id": "gg", "keys": ["x", "l"], "label": "远大于", "category": "relation", "glyph": "≫", "slots": [], "latex": "\\gg", "doc": "远大于：\\gg (也可直输 >>)", "examples": ["▸xl"], "wrapSlot": null},
  {"id": "lesssim", "keys": ["x", "m"], "label": "渐近小于", "category": "relation", "glyph": "≲", "slots": [], "latex": "\\lesssim", "doc": "小于或渐近于：\\lesssim (也可直输 lesssim)", "examples": ["▸xm"], "wrapSlot": null},
  {"id": "gtrsim", "keys": ["x", "n"], "label": "渐近大于", "category": "relation", "glyph": "≳", "slots": [], "latex": "\\gtrsim", "doc": "大于或渐近于：\\gtrsim (也可直输 gtrsim)", "examples": ["▸xn"], "wrapSlot": null},
  {"id": "mid_rel", "keys": ["x", "o"], "label": "整除/条件线", "category": "relation", "glyph": "∣", "slots": [], "latex": "\\mid", "doc": "整除与条件概率关系竖线：\\mid", "examples": ["▸xo"], "wrapSlot": null},
  {"id": "nmid", "keys": ["x", "p"], "label": "不整除", "category": "relation", "glyph": "∤", "slots": [], "latex": "\\nmid", "doc": "数论不整除符号：\\nmid (也可直输 !| 或 nmid)", "examples": ["▸xp"], "wrapSlot": null},
  {"id": "nless", "keys": ["x", "q"], "label": "不小于", "category": "relation", "glyph": "≮", "slots": [], "latex": "\\nless", "doc": "不小于：\\nless (也可直输 !< 或 nless)", "examples": ["▸xq"], "wrapSlot": null},
  {"id": "ngtr", "keys": ["x", "r"], "label": "不大于", "category": "relation", "glyph": "≯", "slots": [], "latex": "\\ngtr", "doc": "不大于：\\ngtr (也可直输 !> 或 ngtr)", "examples": ["▸xr"], "wrapSlot": null},
  {"id": "nleq", "keys": ["x", "s"], "label": "不小于等于", "category": "relation", "glyph": "≰", "slots": [], "latex": "\\nleq", "doc": "不小于等于：\\nleq (也可直输 !<= 或 nleq)", "examples": ["▸xs"], "wrapSlot": null},
  {"id": "ngeq", "keys": ["x", "t"], "label": "不大于等于", "category": "relation", "glyph": "≱", "slots": [], "latex": "\\ngeq", "doc": "不大于等于：\\ngeq (也可直输 !>= 或 ngeq)", "examples": ["▸xt"], "wrapSlot": null},
  {"id": "nsim", "keys": ["x", "u"], "label": "不相似", "category": "relation", "glyph": "≁", "slots": [], "latex": "\\nsim", "doc": "不相似于：\\nsim (也可直输 !~ 或 nsim)", "examples": ["▸xu"], "wrapSlot": null},
  {"id": "ncong", "keys": ["x", "v"], "label": "不全等", "category": "relation", "glyph": "≇", "slots": [], "latex": "\\ncong", "doc": "不全等/不同构：\\ncong (也可直输 !~= 或 ncong)", "examples": ["▸xv"], "wrapSlot": null},
  {"id": "not_equiv", "keys": ["x", "w"], "label": "不恒等", "category": "relation", "glyph": "≢", "slots": [], "latex": "\\not\\equiv", "doc": "不恒等/不同余：\\not\\equiv (也可直输 !== 或 nequiv)", "examples": ["▸xw"], "wrapSlot": null},

  // === 10. 集合与逻辑 (q: 26 items, keys a..z, uppercase reserved for \top, \bot, \Vdash, modal logic) ===
  {"id": "cup", "keys": ["q", "a"], "label": "并集", "category": "setlogic", "glyph": "∪", "slots": [], "latex": "\\cup", "doc": "并集符号：\\cup", "examples": ["▸qa"], "wrapSlot": null},
  {"id": "cap", "keys": ["q", "b"], "label": "交集", "category": "setlogic", "glyph": "∩", "slots": [], "latex": "\\cap", "doc": "交集符号：\\cap", "examples": ["▸qb"], "wrapSlot": null},
  {"id": "emptyset", "keys": ["q", "c"], "label": "空集", "category": "setlogic", "glyph": "∅", "slots": [], "latex": "\\varnothing", "doc": "空集符号：\\varnothing", "examples": ["▸qc"], "wrapSlot": null},
  {"id": "in", "keys": ["q", "d"], "label": "属于", "category": "setlogic", "glyph": "∈", "slots": [], "latex": "\\in", "doc": "属于符号：\\in", "examples": ["▸qd"], "wrapSlot": null},
  {"id": "notin", "keys": ["q", "e"], "label": "不属于", "category": "setlogic", "glyph": "∉", "slots": [], "latex": "\\notin", "doc": "不属于符号：\\notin", "examples": ["▸qe"], "wrapSlot": null},
  {"id": "subset", "keys": ["q", "f"], "label": "真子集", "category": "setlogic", "glyph": "⊂", "slots": [], "latex": "\\subset", "doc": "真子集符号：\\subset", "examples": ["▸qf"], "wrapSlot": null},
  {"id": "subseteq", "keys": ["q", "g"], "label": "子集", "category": "setlogic", "glyph": "⊆", "slots": [], "latex": "\\subseteq", "doc": "子集包含于符号：\\subseteq", "examples": ["▸qg"], "wrapSlot": null},
  {"id": "supset", "keys": ["q", "h"], "label": "真超集", "category": "setlogic", "glyph": "⊃", "slots": [], "latex": "\\supset", "doc": "真超集包含符号：\\supset", "examples": ["▸qh"], "wrapSlot": null},
  {"id": "supseteq", "keys": ["q", "i"], "label": "超集", "category": "setlogic", "glyph": "⊇", "slots": [], "latex": "\\supseteq", "doc": "超集包含符号：\\supseteq", "examples": ["▸qi"], "wrapSlot": null},
  {"id": "nsubseteq", "keys": ["q", "j"], "label": "非子集", "category": "setlogic", "glyph": "⊈", "slots": [], "latex": "\\nsubseteq", "doc": "非子集符号：\\nsubseteq (也可直输 nsubseteq)", "examples": ["▸qj"], "wrapSlot": null},
  {"id": "nsupseteq", "keys": ["q", "k"], "label": "非超集", "category": "setlogic", "glyph": "⊉", "slots": [], "latex": "\\nsupseteq", "doc": "非超集符号：\\nsupseteq (也可直输 nsupseteq)", "examples": ["▸qk"], "wrapSlot": null},
  {"id": "setminus", "keys": ["q", "l"], "label": "差集", "category": "setlogic", "glyph": "∖", "slots": [], "latex": "\\setminus", "doc": "集合差集：\\setminus", "examples": ["▸ql"], "wrapSlot": null},
  {"id": "complement", "keys": ["q", "m"], "label": "补集符号", "category": "setlogic", "glyph": "∁", "slots": [], "latex": "\\complement", "doc": "集合补集符号：\\complement", "examples": ["▸qm"], "wrapSlot": null},
  {"id": "set_builder", "keys": ["q", "n"], "label": "集合构造式", "category": "setlogic", "glyph": "{x|P}", "slots": ["元素", "条件"], "latex": "\\left\\{ $1 \\,\\middle|\\, $2 \\right\\}", "doc": "带自适应竖线的集合构造式：\\left\\{ x \\,\\middle|\\, x > 0 \\right\\}", "examples": ["▸qnx;x>0;"], "wrapSlot": 0},
  {"id": "forall", "keys": ["q", "o"], "label": "任意", "category": "setlogic", "glyph": "∀", "slots": [], "latex": "\\forall", "doc": "全称量词：\\forall", "examples": ["▸qo"], "wrapSlot": null},
  {"id": "exists", "keys": ["q", "p"], "label": "存在", "category": "setlogic", "glyph": "∃", "slots": [], "latex": "\\exists", "doc": "存在量词：\\exists", "examples": ["▸qp"], "wrapSlot": null},
  {"id": "nexists", "keys": ["q", "q"], "label": "不存在", "category": "setlogic", "glyph": "∄", "slots": [], "latex": "\\nexists", "doc": "不存在量词：\\nexists (也可直输 nexists)", "examples": ["▸qq"], "wrapSlot": null},
  {"id": "neg", "keys": ["q", "r"], "label": "非", "category": "setlogic", "glyph": "¬", "slots": [], "latex": "\\neg", "doc": "逻辑非：\\neg", "examples": ["▸qr"], "wrapSlot": null},
  {"id": "land", "keys": ["q", "s"], "label": "且", "category": "setlogic", "glyph": "∧", "slots": [], "latex": "\\land", "doc": "逻辑且/合取：\\land", "examples": ["▸qs"], "wrapSlot": null},
  {"id": "lor", "keys": ["q", "t"], "label": "或", "category": "setlogic", "glyph": "∨", "slots": [], "latex": "\\lor", "doc": "逻辑或/析取：\\lor", "examples": ["▸qt"], "wrapSlot": null},
  {"id": "therefore", "keys": ["q", "u"], "label": "所以", "category": "setlogic", "glyph": "∴", "slots": [], "latex": "\\therefore", "doc": "所以/因果推导：\\therefore", "examples": ["▸qu"], "wrapSlot": null},
  {"id": "because", "keys": ["q", "v"], "label": "因为", "category": "setlogic", "glyph": "∵", "slots": [], "latex": "\\because", "doc": "因为/原因引导：\\because", "examples": ["▸qv"], "wrapSlot": null},
  {"id": "vdash", "keys": ["q", "w"], "label": "语法推出", "category": "setlogic", "glyph": "⊢", "slots": [], "latex": "\\vdash", "doc": "证明论语法可推导：\\vdash (也可直输 vdash)", "examples": ["▸qw"], "wrapSlot": null},
  {"id": "models", "keys": ["q", "x"], "label": "语义蕴含", "category": "setlogic", "glyph": "⊨", "slots": [], "latex": "\\models", "doc": "模型论满足/语义蕴含：\\models (也可直输 models)", "examples": ["▸qx"], "wrapSlot": null},
  {"id": "nvdash", "keys": ["q", "y"], "label": "不可推出", "category": "setlogic", "glyph": "⊬", "slots": [], "latex": "\\nvdash", "doc": "语法不可推导：\\nvdash (也可直输 nvdash)", "examples": ["▸qy"], "wrapSlot": null},
  {"id": "nvDash", "keys": ["q", "z"], "label": "不满足", "category": "setlogic", "glyph": "⊭", "slots": [], "latex": "\\nvDash", "doc": "语义不满足/不蕴含：\\nvDash (也可直输 nmodels)", "examples": ["▸qz"], "wrapSlot": null},

  // === 11. 希腊字母 (g: 36 items, lowercase a..y -> α..ω, uppercase -> Γ..Ω) ===
  {"id": "alpha", "keys": ["g", "a"], "label": "alpha", "category": "greek", "glyph": "α", "slots": [], "latex": "\\alpha", "doc": "希腊字母：\\alpha", "examples": ["▸ga"], "wrapSlot": null},
  {"id": "beta", "keys": ["g", "b"], "label": "beta", "category": "greek", "glyph": "β", "slots": [], "latex": "\\beta", "doc": "希腊字母：\\beta", "examples": ["▸gb"], "wrapSlot": null},
  {"id": "gamma", "keys": ["g", "c"], "label": "gamma", "category": "greek", "glyph": "γ", "slots": [], "latex": "\\gamma", "doc": "希腊字母：\\gamma", "examples": ["▸gc"], "wrapSlot": null},
  {"id": "delta", "keys": ["g", "d"], "label": "delta", "category": "greek", "glyph": "δ", "slots": [], "latex": "\\delta", "doc": "希腊字母：\\delta", "examples": ["▸gd"], "wrapSlot": null},
  {"id": "epsilon", "keys": ["g", "e"], "label": "epsilon", "category": "greek", "glyph": "ε", "slots": [], "latex": "\\varepsilon", "doc": "希腊字母：\\varepsilon", "examples": ["▸ge"], "wrapSlot": null},
  {"id": "zeta", "keys": ["g", "z"], "label": "zeta", "category": "greek", "glyph": "ζ", "slots": [], "latex": "\\zeta", "doc": "希腊字母：\\zeta", "examples": ["▸gz"], "wrapSlot": null},
  {"id": "eta", "keys": ["g", "h"], "label": "eta", "category": "greek", "glyph": "η", "slots": [], "latex": "\\eta", "doc": "希腊字母：\\eta", "examples": ["▸gh"], "wrapSlot": null},
  {"id": "theta", "keys": ["g", "t"], "label": "theta", "category": "greek", "glyph": "θ", "slots": [], "latex": "\\theta", "doc": "希腊字母：\\theta", "examples": ["▸gt"], "wrapSlot": null},
  {"id": "iota", "keys": ["g", "i"], "label": "iota", "category": "greek", "glyph": "ι", "slots": [], "latex": "\\iota", "doc": "希腊字母：\\iota", "examples": ["▸gi"], "wrapSlot": null},
  {"id": "kappa", "keys": ["g", "k"], "label": "kappa", "category": "greek", "glyph": "κ", "slots": [], "latex": "\\kappa", "doc": "希腊字母：\\kappa", "examples": ["▸gk"], "wrapSlot": null},
  {"id": "lambda", "keys": ["g", "l"], "label": "lambda", "category": "greek", "glyph": "λ", "slots": [], "latex": "\\lambda", "doc": "希腊字母：\\lambda", "examples": ["▸gl"], "wrapSlot": null},
  {"id": "mu", "keys": ["g", "m"], "label": "mu", "category": "greek", "glyph": "μ", "slots": [], "latex": "\\mu", "doc": "希腊字母：\\mu", "examples": ["▸gm"], "wrapSlot": null},
  {"id": "nu", "keys": ["g", "n"], "label": "nu", "category": "greek", "glyph": "ν", "slots": [], "latex": "\\nu", "doc": "希腊字母：\\nu", "examples": ["▸gn"], "wrapSlot": null},
  {"id": "xi", "keys": ["g", "x"], "label": "xi", "category": "greek", "glyph": "ξ", "slots": [], "latex": "\\xi", "doc": "希腊字母：\\xi", "examples": ["▸gx"], "wrapSlot": null},
  {"id": "pi", "keys": ["g", "p"], "label": "pi", "category": "greek", "glyph": "π", "slots": [], "latex": "\\pi", "doc": "希腊字母：\\pi", "examples": ["▸gp"], "wrapSlot": null},
  {"id": "rho", "keys": ["g", "r"], "label": "rho", "category": "greek", "glyph": "ρ", "slots": [], "latex": "\\rho", "doc": "希腊字母：\\rho", "examples": ["▸gr"], "wrapSlot": null},
  {"id": "sigma", "keys": ["g", "s"], "label": "sigma", "category": "greek", "glyph": "σ", "slots": [], "latex": "\\sigma", "doc": "希腊字母：\\sigma", "examples": ["▸gs"], "wrapSlot": null},
  {"id": "tau", "keys": ["g", "u"], "label": "tau", "category": "greek", "glyph": "τ", "slots": [], "latex": "\\tau", "doc": "希腊字母：\\tau", "examples": ["▸gu"], "wrapSlot": null},
  {"id": "upsilon", "keys": ["g", "v"], "label": "upsilon", "category": "greek", "glyph": "υ", "slots": [], "latex": "\\upsilon", "doc": "希腊字母：\\upsilon", "examples": ["▸gv"], "wrapSlot": null},
  {"id": "phi", "keys": ["g", "f"], "label": "phi", "category": "greek", "glyph": "φ", "slots": [], "latex": "\\phi", "doc": "希腊字母：\\phi", "examples": ["▸gf"], "wrapSlot": null},
  {"id": "chi", "keys": ["g", "q"], "label": "chi", "category": "greek", "glyph": "χ", "slots": [], "latex": "\\chi", "doc": "希腊字母：\\chi", "examples": ["▸gq"], "wrapSlot": null},
  {"id": "psi", "keys": ["g", "y"], "label": "psi", "category": "greek", "glyph": "ψ", "slots": [], "latex": "\\psi", "doc": "希腊字母：\\psi", "examples": ["▸gy"], "wrapSlot": null},
  {"id": "omega", "keys": ["g", "o"], "label": "omega", "category": "greek", "glyph": "ω", "slots": [], "latex": "\\omega", "doc": "希腊字母：\\omega", "examples": ["▸go"], "wrapSlot": null},
  {"id": "varphi", "keys": ["g", "w"], "label": "varphi", "category": "greek", "glyph": "φ", "slots": [], "latex": "\\varphi", "doc": "希腊字母变体：\\varphi (也可直输 varphi)", "examples": ["▸gw"], "wrapSlot": null},
  {"id": "vartheta", "keys": ["g", "V"], "label": "vartheta", "category": "greek", "glyph": "ϑ", "slots": [], "latex": "\\vartheta", "doc": "希腊字母变体：\\vartheta (也可直输 vartheta)", "examples": ["▸gV"], "wrapSlot": null},
  {"id": "cap_gamma", "keys": ["g", "C"], "label": "Gamma", "category": "greek", "glyph": "Γ", "slots": [], "latex": "\\Gamma", "doc": "希腊字母：\\Gamma", "examples": ["▸gC"], "wrapSlot": null},
  {"id": "cap_delta", "keys": ["g", "D"], "label": "Delta", "category": "greek", "glyph": "Δ", "slots": [], "latex": "\\Delta", "doc": "希腊字母：\\Delta", "examples": ["▸gD"], "wrapSlot": null},
  {"id": "cap_theta", "keys": ["g", "T"], "label": "Theta", "category": "greek", "glyph": "Θ", "slots": [], "latex": "\\Theta", "doc": "希腊字母：\\Theta", "examples": ["▸gT"], "wrapSlot": null},
  {"id": "cap_lambda", "keys": ["g", "L"], "label": "Lambda", "category": "greek", "glyph": "Λ", "slots": [], "latex": "\\Lambda", "doc": "希腊字母：\\Lambda", "examples": ["▸gL"], "wrapSlot": null},
  {"id": "cap_xi", "keys": ["g", "X"], "label": "Xi", "category": "greek", "glyph": "Ξ", "slots": [], "latex": "\\Xi", "doc": "希腊字母：\\Xi", "examples": ["▸gX"], "wrapSlot": null},
  {"id": "cap_pi", "keys": ["g", "P"], "label": "Pi", "category": "greek", "glyph": "Π", "slots": [], "latex": "\\Pi", "doc": "希腊字母：\\Pi", "examples": ["▸gP"], "wrapSlot": null},
  {"id": "cap_sigma", "keys": ["g", "S"], "label": "Sigma", "category": "greek", "glyph": "Σ", "slots": [], "latex": "\\Sigma", "doc": "希腊字母：\\Sigma", "examples": ["▸gS"], "wrapSlot": null},
  {"id": "cap_upsilon", "keys": ["g", "U"], "label": "Upsilon", "category": "greek", "glyph": "Υ", "slots": [], "latex": "\\Upsilon", "doc": "希腊字母：\\Upsilon", "examples": ["▸gU"], "wrapSlot": null},
  {"id": "cap_phi", "keys": ["g", "F"], "label": "Phi", "category": "greek", "glyph": "Φ", "slots": [], "latex": "\\Phi", "doc": "希腊字母：\\Phi", "examples": ["▸gF"], "wrapSlot": null},
  {"id": "cap_psi", "keys": ["g", "Y"], "label": "Psi", "category": "greek", "glyph": "Ψ", "slots": [], "latex": "\\Psi", "doc": "希腊字母：\\Psi", "examples": ["▸gY"], "wrapSlot": null},
  {"id": "cap_omega", "keys": ["g", "O"], "label": "Omega", "category": "greek", "glyph": "Ω", "slots": [], "latex": "\\Omega", "doc": "希腊字母：\\Omega", "examples": ["▸gO"], "wrapSlot": null},
];

export const COMMANDS_BY_ID: ReadonlyMap<string, CommandDef> = new Map(
  COMMANDS.map((c) => [c.id, c]),
);

export const COMMANDS_BY_KEYS: ReadonlyMap<string, CommandDef> = new Map(
  COMMANDS.filter((c) => c.keys.length > 0).map((c) => [c.keys.join(''), c]),
);

export const DIRECT_COMMANDS: readonly CommandDef[] = COMMANDS.filter(
  (c) => c.keys.length === 1,
);

export const SUBMENU_KEYS: ReadonlySet<string> = new Set(SUBMENUS.map((s) => s.key));

export const SUBMENU_BY_KEY: ReadonlyMap<string, SubmenuMeta> = new Map(
  SUBMENUS.map((s) => [s.key, s]),
);

export function getSubmenuDefaultCommandId(prefix: string): string | undefined {
  return SUBMENU_BY_KEY.get(prefix)?.defaultCommandId;
}

export function getSubmenuCommands(prefix: string): CommandDef[] {
  return COMMANDS.filter((c) => c.keys.length === 2 && c.keys[0] === prefix);
}

export function searchCommands(query: string): CommandDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...COMMANDS];
  return COMMANDS.filter((c) => {
    const keySeq = c.keys.join('').toLowerCase();
    return (
      c.id.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q) ||
      keySeq.includes(q) ||
      c.latex.toLowerCase().includes(q) ||
      c.glyph.toLowerCase().includes(q) ||
      c.doc.toLowerCase().includes(q)
    );
  });
}

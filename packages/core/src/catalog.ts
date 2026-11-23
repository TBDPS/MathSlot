import type { CommandCategory, CommandDef, SubmenuMeta } from './types';

export const SUBMENUS: readonly SubmenuMeta[] = [
  { key: 'g', category: 'greek', label: '希腊字母', glyph: 'α', defaultCommandId: 'alpha' },
  { key: 'c', category: 'calculus', label: '微积分', glyph: '∂', defaultCommandId: 'partial_frac' },
  { key: 'm', category: 'matrix', label: '矩阵', glyph: '[ ]', defaultCommandId: 'matrix_2x2' },
  { key: 'a', category: 'accent', label: '装饰定界', glyph: 'x̂', defaultCommandId: 'hat' },
  { key: 'o', category: 'symbol', label: '运算符', glyph: '±', defaultCommandId: 'pm' },
  { key: 'x', category: 'relation', label: '关系符', glyph: '≈', defaultCommandId: 'approx' },
  { key: 'q', category: 'setlogic', label: '集合逻辑', glyph: '∪', defaultCommandId: 'cup' },
];

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  structure: '结构',
  calculus: '微积分',
  matrix: '矩阵',
  accent: '装饰',
  greek: '希腊字母',
  symbol: '运算符号',
  relation: '关系符号',
  setlogic: '集合与逻辑',
};

export const COMMANDS: readonly CommandDef[] = [
  {"id": "frac", "keys": ["f"], "label": "分数", "category": "structure", "glyph": "a/b", "slots": ["分子", "分母"], "latex": "\\frac{$1}{$2}", "doc": "分数：分子在前，分母在后", "examples": ["▸f1;2;"], "wrapSlot": 0},
  {"id": "sqrt", "keys": ["r"], "label": "根号", "category": "structure", "glyph": "√x", "slots": ["根指数", "被开方式"], "optionalSlots": [0], "latex": "\\sqrt[$1]{$2}", "doc": "根号：根指数留空自动按二次根号 \\sqrt{x} 渲染，填写后按 N 次根渲染", "examples": ["▸rx;", "▸r3;8;"], "wrapSlot": 1},
  {"id": "sup", "keys": [], "label": "上标", "category": "structure", "glyph": "x^n", "slots": ["底数", "指数"], "latex": "{$1}^{$2}", "doc": "上标指数：直接输入 ^ 自动创建", "examples": ["x^2"], "wrapSlot": 0},
  {"id": "sub", "keys": [], "label": "下标", "category": "structure", "glyph": "x_n", "slots": ["主体", "下标"], "latex": "{$1}_{$2}", "doc": "下标索引：直接输入 _ 自动创建", "examples": ["x_i"], "wrapSlot": 0},
  {"id": "subsup", "keys": [], "label": "上下标", "category": "structure", "glyph": "x_n^m", "slots": ["主体", "下标", "上标"], "optionalSlots": [1, 2], "latex": "{$1}_{$2}^{$3}", "doc": "上下标：直接输入 _ 和 ^ 自动合并，留空自动省略", "examples": ["x_i^2"], "wrapSlot": 0},
  {"id": "paren", "keys": ["p"], "label": "括号", "category": "structure", "glyph": "(x)", "slots": ["括号内"], "latex": "\\left($1\\right)", "doc": "自适应圆括号", "examples": ["▸px;"], "wrapSlot": 0},
  {"id": "abs", "keys": ["v"], "label": "绝对值", "category": "structure", "glyph": "|x|", "slots": ["绝对值内"], "latex": "\\left|$1\\right|", "doc": "自适应绝对值竖线", "examples": ["▸vx;"], "wrapSlot": 0},
  {"id": "integral", "keys": ["i"], "label": "积分", "category": "structure", "glyph": "∫", "slots": ["下限", "上限", "被积式"], "optionalSlots": [0, 1], "latex": "\\int_{$1}^{$2} $3", "doc": "积分：上下限留空自动按不定积分 \\int 渲染", "examples": ["▸i0;1;f(x) dx;"], "wrapSlot": 2},
  {"id": "sum", "keys": ["s"], "label": "求和", "category": "structure", "glyph": "∑", "slots": ["下限", "上限", "求和主体"], "optionalSlots": [0, 1], "latex": "\\sum_{$1}^{$2} $3", "doc": "累加求和：上下限可省略", "examples": ["▸si=1;n;a_i;"], "wrapSlot": 2},
  {"id": "limit", "keys": ["l"], "label": "极限", "category": "structure", "glyph": "x→a", "slots": ["趋近变量", "趋近目标", "极限主体"], "latex": "\\lim_{$1 \\to $2} $3", "doc": "极限：趋近变量、趋近目标、极限主体", "examples": ["▸lx;0;▸fsin x;x;;"], "wrapSlot": 2},
  {"id": "binom", "keys": ["e"], "label": "二项式", "category": "structure", "glyph": "C(n,k)", "slots": ["上标 n", "下标 k"], "latex": "\\binom{$1}{$2}", "doc": "二项式组合数：上标 n、下标 k", "examples": ["▸en;k;"], "wrapSlot": 0},
  {"id": "indef_integral", "keys": ["c", "a"], "label": "不定积分", "category": "calculus", "glyph": "∫", "slots": ["被积式"], "latex": "\\int $1", "doc": "不定积分：被积式", "examples": ["▸caf(x) dx;"], "wrapSlot": 0},
  {"id": "product", "keys": ["c", "b"], "label": "连乘", "category": "calculus", "glyph": "∏", "slots": ["下限", "上限", "连乘主体"], "optionalSlots": [0, 1], "latex": "\\prod_{$1}^{$2} $3", "doc": "连乘积：上下限可省略", "examples": ["▸cbi=1;n;a_i;"], "wrapSlot": 2},
  {"id": "double_integral", "keys": ["c", "c"], "label": "二重积分", "category": "calculus", "glyph": "∬", "slots": ["积分区域", "被积式"], "optionalSlots": [0], "latex": "\\iint_{$1} $2", "doc": "二重积分：积分区域留空自动省略", "examples": ["▸ccD;f(x,y) dxdy;"], "wrapSlot": 1},
  {"id": "contour_integral", "keys": ["c", "d"], "label": "环路积分", "category": "calculus", "glyph": "∮", "slots": ["积分路径", "被积式"], "optionalSlots": [0], "latex": "\\oint_{$1} $2", "doc": "闭合曲线/环路积分：积分路径留空自动省略", "examples": ["▸cdC;F·dr;"], "wrapSlot": 1},
  {"id": "triple_integral", "keys": ["c", "e"], "label": "三重积分", "category": "calculus", "glyph": "∭", "slots": ["积分体", "被积式"], "optionalSlots": [0], "latex": "\\iiint_{$1} $2", "doc": "三重积分：积分体留空自动省略", "examples": ["▸ceV;f dV;"], "wrapSlot": 1},
  {"id": "partial_frac", "keys": ["c", "g"], "label": "偏导分式", "category": "calculus", "glyph": "∂y/∂x", "slots": ["分子", "分母"], "latex": "\\frac{\\partial $1}{\\partial $2}", "doc": "偏导数分式：分子、分母", "examples": ["▸cgy;x;"], "wrapSlot": 0},
  {"id": "total_frac", "keys": ["c", "i"], "label": "全导分式", "category": "calculus", "glyph": "dy/dx", "slots": ["分子", "分母"], "latex": "\\frac{\\mathrm{d}$1}{\\mathrm{d}$2}", "doc": "全导数分式：分子、分母", "examples": ["▸ciy;x;"], "wrapSlot": 0},
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
  {"id": "hat", "keys": ["a", "a"], "label": "帽子", "category": "accent", "glyph": "hat", "slots": ["帽子内"], "latex": "\\hat{$1}", "doc": "帽子标注：\\hat{x}", "examples": ["▸aax;"], "wrapSlot": 0},
  {"id": "bar", "keys": ["a", "b"], "label": "上横线", "category": "accent", "glyph": "bar", "slots": ["横线内"], "latex": "\\bar{$1}", "doc": "上横线标注：\\bar{x}", "examples": ["▸abx;"], "wrapSlot": 0},
  {"id": "vec", "keys": ["a", "c"], "label": "向量箭头", "category": "accent", "glyph": "vec", "slots": ["向量内"], "latex": "\\vec{$1}", "doc": "向量箭头标注：\\vec{x}", "examples": ["▸acx;"], "wrapSlot": 0},
  {"id": "tilde", "keys": ["a", "d"], "label": "波浪号", "category": "accent", "glyph": "tilde", "slots": ["波浪号内"], "latex": "\\tilde{$1}", "doc": "波浪号标注：\\tilde{x}", "examples": ["▸adx;"], "wrapSlot": 0},
  {"id": "dot", "keys": ["a", "e"], "label": "一阶导点", "category": "accent", "glyph": "dot", "slots": ["导点内"], "latex": "\\dot{$1}", "doc": "一阶导点标注：\\dot{x}", "examples": ["▸aex;"], "wrapSlot": 0},
  {"id": "norm", "keys": ["a", "f"], "label": "范数", "category": "accent", "glyph": "‖x‖", "slots": ["范数内"], "latex": "\\left\\Vert $1\\right\\Vert", "doc": "双竖线范数定界：\\left\\Vert x\\right\\Vert", "examples": ["▸afx;"], "wrapSlot": 0},
  {"id": "overline", "keys": ["a", "g"], "label": "上划线", "category": "accent", "glyph": "overline", "slots": ["上划线内"], "latex": "\\overline{$1}", "doc": "长上划线标注：\\overline{x}", "examples": ["▸agx;"], "wrapSlot": 0},
  {"id": "ddot", "keys": ["a", "h"], "label": "二阶导点", "category": "accent", "glyph": "ddot", "slots": ["二阶导点内"], "latex": "\\ddot{$1}", "doc": "二阶导点标注：\\ddot{x}", "examples": ["▸ahx;"], "wrapSlot": 0},
  {"id": "underline", "keys": ["a", "i"], "label": "下划线", "category": "accent", "glyph": "underline", "slots": ["下划线内"], "latex": "\\underline{$1}", "doc": "下划线标注：\\underline{x}", "examples": ["▸aix;"], "wrapSlot": 0},
  {"id": "overbrace", "keys": ["a", "j"], "label": "上花括号", "category": "accent", "glyph": "overbrace", "slots": ["主体", "标注"], "optionalSlots": [1], "latex": "\\overbrace{$1}^{$2}", "doc": "上花括号标注：标注留空自动省略", "examples": ["▸ajx;标注;"], "wrapSlot": 0},
  {"id": "underbrace", "keys": ["a", "k"], "label": "下花括号", "category": "accent", "glyph": "underbrace", "slots": ["主体", "标注"], "optionalSlots": [1], "latex": "\\underbrace{$1}_{$2}", "doc": "下花括号标注：标注留空自动省略", "examples": ["▸akx;标注;"], "wrapSlot": 0},
  {"id": "bracket", "keys": ["a", "l"], "label": "中括号", "category": "accent", "glyph": "[x]", "slots": ["中括号内"], "latex": "\\left[$1\\right]", "doc": "自适应方括号定界：\\left[ x\\right]", "examples": ["▸alx;"], "wrapSlot": 0},
  {"id": "brace", "keys": ["a", "m"], "label": "大括号/集合", "category": "accent", "glyph": "{x}", "slots": ["大括号内"], "latex": "\\left\\{$1\\right\\}", "doc": "自适应花括号定界：\\left\\{ x\\right\\}", "examples": ["▸amx;"], "wrapSlot": 0},
  {"id": "angle", "keys": ["a", "n"], "label": "尖括号内积", "category": "accent", "glyph": "⟨x⟩", "slots": ["尖括号内"], "latex": "\\left\\langle $1\\right\\rangle", "doc": "尖括号内积定界：\\left\\langle x\\right\\rangle", "examples": ["▸anx;"], "wrapSlot": 0},
  {"id": "floor", "keys": ["a", "o"], "label": "向下取整", "category": "accent", "glyph": "⌊x⌋", "slots": ["向下取整内"], "latex": "\\left\\lfloor $1\\right\\rfloor", "doc": "向下取整定界：\\left\\lfloor x\\right\\rfloor", "examples": ["▸aox;"], "wrapSlot": 0},
  {"id": "ceil", "keys": ["a", "p"], "label": "向上取整", "category": "accent", "glyph": "⌈x⌉", "slots": ["向上取整内"], "latex": "\\left\\lceil $1\\right\\rceil", "doc": "向上取整定界：\\left\\lceil x\\right\\rceil", "examples": ["▸apx;"], "wrapSlot": 0},
  {"id": "eval_bar", "keys": ["a", "q"], "label": "代入求值线", "category": "accent", "glyph": "F|_a^b", "slots": ["表达式", "下限", "上限"], "optionalSlots": [1, 2], "latex": "\\left. $1\\right|_{$2}^{$3}", "doc": "代入求值竖线：上下限可省略", "examples": ["▸aqF;a;b;"], "wrapSlot": 0},
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
  {"id": "infty", "keys": ["o", "a"], "label": "无穷", "category": "symbol", "glyph": "∞", "slots": [], "latex": "\\infty", "doc": "无穷大符号：\\infty (也可直输 oo)", "examples": ["▸oa"], "wrapSlot": null},
  {"id": "to", "keys": ["o", "b"], "label": "趋向", "category": "symbol", "glyph": "→", "slots": [], "latex": "\\to", "doc": "趋向箭头：\\to (也可直输 ->)", "examples": ["▸ob"], "wrapSlot": null},
  {"id": "partial", "keys": ["o", "c"], "label": "偏导", "category": "symbol", "glyph": "∂", "slots": [], "latex": "\\partial", "doc": "偏导算子：\\partial", "examples": ["▸oc"], "wrapSlot": null},
  {"id": "nabla", "keys": ["o", "d"], "label": "梯度", "category": "symbol", "glyph": "∇", "slots": [], "latex": "\\nabla", "doc": "梯度算子/劈形算子：\\nabla", "examples": ["▸od"], "wrapSlot": null},
  {"id": "pm", "keys": ["o", "e"], "label": "正负", "category": "symbol", "glyph": "±", "slots": [], "latex": "\\pm", "doc": "正负号：\\pm (也可直输 +-)", "examples": ["▸oe"], "wrapSlot": null},
  {"id": "times", "keys": ["o", "f"], "label": "叉乘", "category": "symbol", "glyph": "×", "slots": [], "latex": "\\times", "doc": "乘号/叉乘：\\times", "examples": ["▸of"], "wrapSlot": null},
  {"id": "cdot", "keys": ["o", "g"], "label": "点乘", "category": "symbol", "glyph": "·", "slots": [], "latex": "\\cdot", "doc": "点乘符号：\\cdot", "examples": ["▸og"], "wrapSlot": null},
  {"id": "in", "keys": ["o", "h"], "label": "属于", "category": "symbol", "glyph": "∈", "slots": [], "latex": "\\in", "doc": "属于符号：\\in", "examples": ["▸oh"], "wrapSlot": null},
  {"id": "notin", "keys": ["o", "i"], "label": "不属于", "category": "symbol", "glyph": "∉", "slots": [], "latex": "\\notin", "doc": "不属于符号：\\notin", "examples": ["▸oi"], "wrapSlot": null},
  {"id": "subseteq", "keys": ["o", "j"], "label": "子集", "category": "symbol", "glyph": "⊆", "slots": [], "latex": "\\subseteq", "doc": "子集包含于符号：\\subseteq", "examples": ["▸oj"], "wrapSlot": null},
  {"id": "forall", "keys": ["o", "k"], "label": "任意", "category": "symbol", "glyph": "∀", "slots": [], "latex": "\\forall", "doc": "全称量词：\\forall", "examples": ["▸ok"], "wrapSlot": null},
  {"id": "hbar", "keys": ["o", "l"], "label": "约化普朗克", "category": "symbol", "glyph": "ℏ", "slots": [], "latex": "\\hbar", "doc": "约化普朗克常数：\\hbar", "examples": ["▸ol"], "wrapSlot": null},
  {"id": "ell", "keys": ["o", "m"], "label": "花体l", "category": "symbol", "glyph": "ℓ", "slots": [], "latex": "\\ell", "doc": "花体字母 l：\\ell", "examples": ["▸om"], "wrapSlot": null},
  {"id": "circ", "keys": ["o", "n"], "label": "圈乘/度", "category": "symbol", "glyph": "∘", "slots": [], "latex": "\\circ", "doc": "复合函数圈乘/度数：\\circ", "examples": ["▸on"], "wrapSlot": null},
  {"id": "parallel", "keys": ["o", "o"], "label": "平行", "category": "symbol", "glyph": "∥", "slots": [], "latex": "\\parallel", "doc": "平行符号：\\parallel (也可直输 ||)", "examples": ["▸oo"], "wrapSlot": null},
  {"id": "perp", "keys": ["o", "p"], "label": "垂直", "category": "symbol", "glyph": "⊥", "slots": [], "latex": "\\perp", "doc": "垂直/正交符号：\\perp (也可直输 _|_)", "examples": ["▸op"], "wrapSlot": null},
  {"id": "mp", "keys": ["o", "q"], "label": "负正", "category": "symbol", "glyph": "∓", "slots": [], "latex": "\\mp", "doc": "负正号：\\mp (也可直输 -+)", "examples": ["▸oq"], "wrapSlot": null},
  {"id": "cdots", "keys": ["o", "r"], "label": "横省略号", "category": "symbol", "glyph": "⋯", "slots": [], "latex": "\\cdots", "doc": "居中横省略号：\\cdots (也可直输 ... 或 cdots)", "examples": ["▸or"], "wrapSlot": null},
  {"id": "vdots", "keys": ["o", "s"], "label": "竖省略号", "category": "symbol", "glyph": "⋮", "slots": [], "latex": "\\vdots", "doc": "竖向省略号：\\vdots (也可直输 ::: 或 vdots)", "examples": ["▸os"], "wrapSlot": null},
  {"id": "ddots", "keys": ["o", "t"], "label": "斜省略号", "category": "symbol", "glyph": "⋱", "slots": [], "latex": "\\ddots", "doc": "斜向省略号：\\ddots (也可直输 ddots)", "examples": ["▸ot"], "wrapSlot": null},
  {"id": "equiv", "keys": ["x", "a"], "label": "恒等", "category": "relation", "glyph": "≡", "slots": [], "latex": "\\equiv", "doc": "恒等于/同余：\\equiv", "examples": ["▸xa"], "wrapSlot": null},
  {"id": "approx", "keys": ["x", "b"], "label": "近似", "category": "relation", "glyph": "≈", "slots": [], "latex": "\\approx", "doc": "约等于：\\approx", "examples": ["▸xb"], "wrapSlot": null},
  {"id": "sim", "keys": ["x", "c"], "label": "相似", "category": "relation", "glyph": "∼", "slots": [], "latex": "\\sim", "doc": "相似于：\\sim", "examples": ["▸xc"], "wrapSlot": null},
  {"id": "propto", "keys": ["x", "d"], "label": "正比", "category": "relation", "glyph": "∝", "slots": [], "latex": "\\propto", "doc": "正比于：\\propto", "examples": ["▸xd"], "wrapSlot": null},
  {"id": "implies", "keys": ["x", "e"], "label": "蕴含", "category": "relation", "glyph": "⇒", "slots": [], "latex": "\\Rightarrow", "doc": "蕴含箭头：\\Rightarrow", "examples": ["▸xe"], "wrapSlot": null},
  {"id": "iff", "keys": ["x", "f"], "label": "等价", "category": "relation", "glyph": "⇔", "slots": [], "latex": "\\Leftrightarrow", "doc": "当且仅当/等价箭头：\\Leftrightarrow", "examples": ["▸xf"], "wrapSlot": null},
  {"id": "mapsto", "keys": ["x", "g"], "label": "映射", "category": "relation", "glyph": "↦", "slots": [], "latex": "\\mapsto", "doc": "映射箭头：\\mapsto", "examples": ["▸xg"], "wrapSlot": null},
  {"id": "therefore", "keys": ["x", "h"], "label": "所以", "category": "relation", "glyph": "∴", "slots": [], "latex": "\\therefore", "doc": "所以/因果推导：\\therefore", "examples": ["▸xh"], "wrapSlot": null},
  {"id": "because", "keys": ["x", "i"], "label": "因为", "category": "relation", "glyph": "∵", "slots": [], "latex": "\\because", "doc": "因为/原因引导：\\because", "examples": ["▸xi"], "wrapSlot": null},
  {"id": "cong", "keys": ["x", "j"], "label": "全等/同余", "category": "relation", "glyph": "≅", "slots": [], "latex": "\\cong", "doc": "全等/同余：\\cong (也可直输 ~=)", "examples": ["▸xj"], "wrapSlot": null},
  {"id": "ll", "keys": ["x", "k"], "label": "远小于", "category": "relation", "glyph": "≪", "slots": [], "latex": "\\ll", "doc": "远小于：\\ll (也可直输 <<)", "examples": ["▸xk"], "wrapSlot": null},
  {"id": "gg", "keys": ["x", "l"], "label": "远大于", "category": "relation", "glyph": "≫", "slots": [], "latex": "\\gg", "doc": "远大于：\\gg (也可直输 >>)", "examples": ["▸xl"], "wrapSlot": null},
  {"id": "simeq", "keys": ["x", "m"], "label": "渐近相等", "category": "relation", "glyph": "≃", "slots": [], "latex": "\\simeq", "doc": "渐近相等/相似等于：\\simeq", "examples": ["▸xm"], "wrapSlot": null},
  {"id": "leq", "keys": ["x", "n"], "label": "小于等于", "category": "relation", "glyph": "≤", "slots": [], "latex": "\\le", "doc": "小于等于：\\le (也可直输 <=)", "examples": ["▸xn"], "wrapSlot": null},
  {"id": "geq", "keys": ["x", "o"], "label": "大于等于", "category": "relation", "glyph": "≥", "slots": [], "latex": "\\ge", "doc": "大于等于：\\ge (也可直输 >=)", "examples": ["▸xo"], "wrapSlot": null},
  {"id": "neq", "keys": ["x", "p"], "label": "不等于", "category": "relation", "glyph": "≠", "slots": [], "latex": "\\neq", "doc": "不等于：\\neq (也可直输 !=)", "examples": ["▸xp"], "wrapSlot": null},
  {"id": "cup", "keys": ["q", "a"], "label": "并集", "category": "setlogic", "glyph": "∪", "slots": [], "latex": "\\cup", "doc": "并集符号：\\cup", "examples": ["▸qa"], "wrapSlot": null},
  {"id": "cap", "keys": ["q", "b"], "label": "交集", "category": "setlogic", "glyph": "∩", "slots": [], "latex": "\\cap", "doc": "交集符号：\\cap", "examples": ["▸qb"], "wrapSlot": null},
  {"id": "emptyset", "keys": ["q", "c"], "label": "空集", "category": "setlogic", "glyph": "∅", "slots": [], "latex": "\\varnothing", "doc": "空集符号：\\varnothing", "examples": ["▸qc"], "wrapSlot": null},
  {"id": "subset", "keys": ["q", "d"], "label": "真子集", "category": "setlogic", "glyph": "⊂", "slots": [], "latex": "\\subset", "doc": "真子集符号：\\subset", "examples": ["▸qd"], "wrapSlot": null},
  {"id": "exists", "keys": ["q", "e"], "label": "存在", "category": "setlogic", "glyph": "∃", "slots": [], "latex": "\\exists", "doc": "存在量词：\\exists", "examples": ["▸qe"], "wrapSlot": null},
  {"id": "neg", "keys": ["q", "f"], "label": "非", "category": "setlogic", "glyph": "¬", "slots": [], "latex": "\\neg", "doc": "逻辑非：\\neg", "examples": ["▸qf"], "wrapSlot": null},
  {"id": "land", "keys": ["q", "g"], "label": "且", "category": "setlogic", "glyph": "∧", "slots": [], "latex": "\\land", "doc": "逻辑且/合取：\\land", "examples": ["▸qg"], "wrapSlot": null},
  {"id": "lor", "keys": ["q", "h"], "label": "或", "category": "setlogic", "glyph": "∨", "slots": [], "latex": "\\lor", "doc": "逻辑或/析取：\\lor", "examples": ["▸qh"], "wrapSlot": null},
  {"id": "real_set", "keys": ["q", "i"], "label": "实数集", "category": "setlogic", "glyph": "ℝ", "slots": [], "latex": "\\mathbb{R}", "doc": "实数集：\\mathbb{R}", "examples": ["▸qi"], "wrapSlot": null},
  {"id": "nat_set", "keys": ["q", "j"], "label": "自然数集", "category": "setlogic", "glyph": "ℕ", "slots": [], "latex": "\\mathbb{N}", "doc": "自然数集：\\mathbb{N}", "examples": ["▸qj"], "wrapSlot": null},
  {"id": "int_set", "keys": ["q", "k"], "label": "整数集", "category": "setlogic", "glyph": "ℤ", "slots": [], "latex": "\\mathbb{Z}", "doc": "整数集：\\mathbb{Z}", "examples": ["▸qk"], "wrapSlot": null},
  {"id": "rat_set", "keys": ["q", "l"], "label": "有理数集", "category": "setlogic", "glyph": "ℚ", "slots": [], "latex": "\\mathbb{Q}", "doc": "有理数集：\\mathbb{Q}", "examples": ["▸ql"], "wrapSlot": null},
  {"id": "setminus", "keys": ["q", "m"], "label": "差集", "category": "setlogic", "glyph": "∖", "slots": [], "latex": "\\setminus", "doc": "集合差集：\\setminus", "examples": ["▸qm"], "wrapSlot": null},
  {"id": "complex_set", "keys": ["q", "n"], "label": "复数集", "category": "setlogic", "glyph": "ℂ", "slots": [], "latex": "\\mathbb{C}", "doc": "复数集：\\mathbb{C}", "examples": ["▸qn"], "wrapSlot": null},
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

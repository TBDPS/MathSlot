pub const CMD_PREFIX: char = '▸';
pub const STEP_SEP: char = ';';

/// 二级子菜单分类：
/// - 5 个静态内置分类：`c` (扩展微积分), `m` (矩阵分段), `a` (顶部标注), `g` (希腊字母), `o` (常用符号)
/// - 2 个用户动态扩展分类：`k` (自定义数学格式，无需改源码), `t` (保存的复杂公式复用模版)
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SubCategory {
    CalculusMore, // c
    Matrix,       // m
    Accent,       // a
    Greek,        // g
    Symbol,       // o
    Relations,    // x (关系符/逻辑箭头)
    SetLogic,     // q (集合/逻辑)
    Custom,       // k (用户自定义 LaTeX 结构格式)
    Template,     // t (用户保存的复杂子式/填空模版)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum StructKind {
    // 单字母高频直达 (11 项)
    Frac,     // f
    Sqrt,     // r
    NthRoot,  // n
    Sup,      // u
    Sub,      // d
    SubSup,   // b
    Paren,    // p
    Abs,      // v
    Integral, // i
    Sum,      // s
    Limit,    // l (趋近变量 ; 趋近目标 ; 主体，自动生成 →)
    // 微积分扩展子菜单 (c*)
    IndefIntegral,   // ca (默认)
    Product,         // cb
    DoubleIntegral,  // cc
    ContourIntegral, // cd
    TripleIntegral,  // ce
    PartialFrac,     // cg
    TotalFrac,       // ci
    // 矩阵与分段子菜单 (m*)
    Matrix2, // ma (默认)
    Matrix3, // mb
    Det2,    // mc
    Cases2,  // md
    // 顶部标注与定界子菜单 (a*)
    Hat,   // aa (默认)
    Bar,   // ab
    Vec,   // ac
    Tilde, // ad
    Dot,   // ae
    Norm,     // af
    Overline, // ag
    DDot,     // ah
    Underline,// ai
    Overbrace,// aj
    Underbrace,// ak
    Bracket,  // al
    Brace,    // am
    Angle,    // an
    Floor,    // ao
    Ceil,     // ap
    EvalBar,  // aq
    // 二项式系数（单字母直达 e）
    Binom, // e
    // 矩阵与分段子菜单扩展 (m*)
    BMatrix2, // me
    Cases3,   // mf
    BMatrix3, // mg
    Det3,     // mh
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SymbolCmd {
    // 希腊字母子菜单 (g*)
    Alpha,    // ga (默认)
    Beta,     // gb
    Gamma,    // gc
    Delta,    // gd
    Epsilon,  // ge
    Theta,    // gt
    Lambda,   // gl
    Mu,       // gm
    Pi,       // gp
    Sigma,    // gs
    Phi,      // gf
    Omega,    // go
    CapDelta, // gx
    CapOmega, // gz
    // 常用符号子菜单 (o*)
    Infty,    // oa (默认)
    To,       // ob (趋向箭头 →，也可直接输入 ->)
    Partial,  // oc
    Nabla,    // od
    Pm,       // oe
    Times,    // of
    Cdot,     // og
    In,       // oh
    NotIn,    // oi
    SubsetEq, // oj
    ForAll,   // ok
    Hbar,     // ol
    Ell,      // om
    Circ,     // on
    Parallel, // oo
    Perp,     // op
    // 关系符与箭头子菜单 (x*)
    Equiv,      // xa (默认)
    Approx,     // xb
    Sim,        // xc
    Propto,     // xd
    Implies,    // xe
    Iff,        // xf
    Mapsto,     // xg
    Therefore,  // xh
    Because,    // xi
    Cong,       // xj
    Ll,         // xk
    Gg,         // xl
    Simeq,      // xm
    // 集合与逻辑子菜单 (q*)
    Cup,        // qa (默认)
    Cap,        // qb
    EmptySet,   // qc
    Subset,     // qd
    Exists,     // qe
    Neg,        // qf
    Land,       // qg
    Lor,        // qh
    RealSet,    // qi
    NatSet,     // qj
    IntSet,     // qk
    RatSet,     // ql
    SetMinus,   // qm
    ComplexSet, // qn
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandTarget {
    Struct(StructKind),
    Symbol(SymbolCmd),
}

#[derive(Clone, Copy, Debug)]
pub struct DirectEntry {
    pub key: char,
    pub label: &'static str,
    pub glyph_hint: &'static str,
    pub detail: &'static str,
    pub kind: StructKind,
}

#[derive(Clone, Copy, Debug)]
pub struct SubEntry {
    pub code: &'static str,
    pub item_key: char,
    pub is_default: bool,
    pub label: &'static str,
    pub glyph_hint: &'static str,
    pub detail: &'static str,
    pub target: CommandTarget,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PrefixMenuState {
    Idle,
    Root,
    SubMenu(SubCategory),
    Jump(String),
    InvalidPrefix(char),
}

/// 11 个单字母高频直达结构（Tab + 1 个字母直接完成输入！）
pub const DIRECT_ENTRIES: &[DirectEntry] = &[
    DirectEntry {
        key: 'f',
        label: "分数",
        glyph_hint: "a/b",
        detail: "分子 ; 分母",
        kind: StructKind::Frac,
    },
    DirectEntry {
        key: 'r',
        label: "根号",
        glyph_hint: "√x",
        detail: "被开方式",
        kind: StructKind::Sqrt,
    },
    DirectEntry {
        key: 'n',
        label: "N次根",
        glyph_hint: "n√x",
        detail: "根指数 ; 被开方式",
        kind: StructKind::NthRoot,
    },
    DirectEntry {
        key: 'u',
        label: "上标",
        glyph_hint: "x^n",
        detail: "底数 ; 指数",
        kind: StructKind::Sup,
    },
    DirectEntry {
        key: 'd',
        label: "下标",
        glyph_hint: "x_n",
        detail: "主体 ; 下标",
        kind: StructKind::Sub,
    },
    DirectEntry {
        key: 'b',
        label: "上下标",
        glyph_hint: "x_n^m",
        detail: "主体 ; 下标 ; 上标",
        kind: StructKind::SubSup,
    },
    DirectEntry {
        key: 'p',
        label: "括号",
        glyph_hint: "(x)",
        detail: "括号内表达式",
        kind: StructKind::Paren,
    },
    DirectEntry {
        key: 'v',
        label: "绝对值",
        glyph_hint: "|x|",
        detail: "绝对值内表达式",
        kind: StructKind::Abs,
    },
    DirectEntry {
        key: 'i',
        label: "定积分",
        glyph_hint: "∫_a^b",
        detail: "下限 ; 上限 ; 被积式",
        kind: StructKind::Integral,
    },
    DirectEntry {
        key: 's',
        label: "求和",
        glyph_hint: "∑",
        detail: "下限 ; 上限 ; 求和项",
        kind: StructKind::Sum,
    },
    DirectEntry {
        key: 'l',
        label: "极限",
        glyph_hint: "x→a",
        detail: "趋近变量 ; 趋近目标 ; 主体 (自动带 →，前置插入自动包裹主体)",
        kind: StructKind::Limit,
    },
    DirectEntry {
        key: 'e',
        label: "二项式",
        glyph_hint: "C(n,k)",
        detail: "上标 n ; 下标 k（\\binom）",
        kind: StructKind::Binom,
    },
];

const CALCULUS_MORE_ENTRIES: &[SubEntry] = &[
    SubEntry {
        code: "ca",
        item_key: 'a',
        is_default: true,
        label: "不定积分",
        glyph_hint: "∫ f",
        detail: "被积式 (按 Enter/Space 可直接选用默认)",
        target: CommandTarget::Struct(StructKind::IndefIntegral),
    },
    SubEntry {
        code: "cb",
        item_key: 'b',
        is_default: false,
        label: "连乘",
        glyph_hint: "∏",
        detail: "下限 ; 上限 ; 连乘项",
        target: CommandTarget::Struct(StructKind::Product),
    },
    SubEntry {
        code: "cc",
        item_key: 'c',
        is_default: false,
        label: "二重积分",
        glyph_hint: "∬",
        detail: "积分区域 ; 被积式",
        target: CommandTarget::Struct(StructKind::DoubleIntegral),
    },
    SubEntry {
        code: "cd",
        item_key: 'd',
        is_default: false,
        label: "环路积分",
        glyph_hint: "∮",
        detail: "积分路径 ; 被积式",
        target: CommandTarget::Struct(StructKind::ContourIntegral),
    },
    SubEntry {
        code: "ce",
        item_key: 'e',
        is_default: false,
        label: "三重积分",
        glyph_hint: "∭",
        detail: "积分体 ; 被积式",
        target: CommandTarget::Struct(StructKind::TripleIntegral),
    },
    SubEntry {
        code: "cg",
        item_key: 'g',
        is_default: false,
        label: "偏导分式",
        glyph_hint: "∂y/∂x",
        detail: "分子 ; 分母",
        target: CommandTarget::Struct(StructKind::PartialFrac),
    },
    SubEntry {
        code: "ci",
        item_key: 'i',
        is_default: false,
        label: "全导分式",
        glyph_hint: "dy/dx",
        detail: "分子 ; 分母",
        target: CommandTarget::Struct(StructKind::TotalFrac),
    },
];

const MATRIX_ENTRIES: &[SubEntry] = &[
    SubEntry {
        code: "ma",
        item_key: 'a',
        is_default: true,
        label: "2×2 矩阵",
        glyph_hint: "(2×2)",
        detail: "按行输入 4 项 (默认)",
        target: CommandTarget::Struct(StructKind::Matrix2),
    },
    SubEntry {
        code: "mb",
        item_key: 'b',
        is_default: false,
        label: "3×3 矩阵",
        glyph_hint: "(3×3)",
        detail: "按行输入 9 项",
        target: CommandTarget::Struct(StructKind::Matrix3),
    },
    SubEntry {
        code: "mc",
        item_key: 'c',
        is_default: false,
        label: "2×2 行列式",
        glyph_hint: "|2×2|",
        detail: "按行输入 4 项",
        target: CommandTarget::Struct(StructKind::Det2),
    },
    SubEntry {
        code: "md",
        item_key: 'd',
        is_default: false,
        label: "分段函数",
        glyph_hint: "{cases",
        detail: "式1 ; 条件1 ; 式2 ; 条件2",
        target: CommandTarget::Struct(StructKind::Cases2),
    },
    SubEntry {
        code: "me",
        item_key: 'e',
        is_default: false,
        label: "方括号矩阵",
        glyph_hint: "[2×2]",
        detail: "按行输入 4 项 (bmatrix)",
        target: CommandTarget::Struct(StructKind::BMatrix2),
    },
    SubEntry {
        code: "mf",
        item_key: 'f',
        is_default: false,
        label: "三分段函数",
        glyph_hint: "{cases×3",
        detail: "式1 ; 条件1 ; 式2 ; 条件2 ; 式3 ; 条件3",
        target: CommandTarget::Struct(StructKind::Cases3),
    },
    SubEntry {
        code: "mg",
        item_key: 'g',
        is_default: false,
        label: "3×3 方块阵",
        glyph_hint: "[3×3]",
        detail: "按行输入 9 项 (bmatrix)",
        target: CommandTarget::Struct(StructKind::BMatrix3),
    },
    SubEntry {
        code: "mh",
        item_key: 'h',
        is_default: false,
        label: "3×3 行列式",
        glyph_hint: "|3×3|",
        detail: "按行输入 9 项 (vmatrix)",
        target: CommandTarget::Struct(StructKind::Det3),
    },
];

const ACCENT_ENTRIES: &[SubEntry] = &[
    SubEntry {
        code: "aa",
        item_key: 'a',
        is_default: true,
        label: "帽子",
        glyph_hint: "hat",
        detail: "\\hat{x} (默认)",
        target: CommandTarget::Struct(StructKind::Hat),
    },
    SubEntry {
        code: "ab",
        item_key: 'b',
        is_default: false,
        label: "上横线",
        glyph_hint: "bar",
        detail: "\\bar{x}",
        target: CommandTarget::Struct(StructKind::Bar),
    },
    SubEntry {
        code: "ac",
        item_key: 'c',
        is_default: false,
        label: "向量箭头",
        glyph_hint: "vec",
        detail: "\\vec{x}",
        target: CommandTarget::Struct(StructKind::Vec),
    },
    SubEntry {
        code: "ad",
        item_key: 'd',
        is_default: false,
        label: "波浪号",
        glyph_hint: "tilde",
        detail: "\\tilde{x}",
        target: CommandTarget::Struct(StructKind::Tilde),
    },
    SubEntry {
        code: "ae",
        item_key: 'e',
        is_default: false,
        label: "一阶导点",
        glyph_hint: "dot",
        detail: "\\dot{x}",
        target: CommandTarget::Struct(StructKind::Dot),
    },
    SubEntry {
        code: "af",
        item_key: 'f',
        is_default: false,
        label: "范数",
        glyph_hint: "‖x‖",
        detail: "\\left\\Vert x \\right\\Vert",
        target: CommandTarget::Struct(StructKind::Norm),
    },
    SubEntry {
        code: "ag",
        item_key: 'g',
        is_default: false,
        label: "上划线",
        glyph_hint: "overline",
        detail: "\\overline{x}",
        target: CommandTarget::Struct(StructKind::Overline),
    },
    SubEntry {
        code: "ah",
        item_key: 'h',
        is_default: false,
        label: "二阶导点",
        glyph_hint: "ddot",
        detail: "\\ddot{x}",
        target: CommandTarget::Struct(StructKind::DDot),
    },
    SubEntry {
        code: "ai",
        item_key: 'i',
        is_default: false,
        label: "下划线",
        glyph_hint: "underline",
        detail: "\\underline{x}",
        target: CommandTarget::Struct(StructKind::Underline),
    },
    SubEntry {
        code: "aj",
        item_key: 'j',
        is_default: false,
        label: "上花括号",
        glyph_hint: "overbrace",
        detail: "\\overbrace{主体}^{标注}",
        target: CommandTarget::Struct(StructKind::Overbrace),
    },
    SubEntry {
        code: "ak",
        item_key: 'k',
        is_default: false,
        label: "下花括号",
        glyph_hint: "underbrace",
        detail: "\\underbrace{主体}_{标注}",
        target: CommandTarget::Struct(StructKind::Underbrace),
    },
    SubEntry {
        code: "al",
        item_key: 'l',
        is_default: false,
        label: "中括号",
        glyph_hint: "[x]",
        detail: "\\left[ x \\right]",
        target: CommandTarget::Struct(StructKind::Bracket),
    },
    SubEntry {
        code: "am",
        item_key: 'm',
        is_default: false,
        label: "大括号/集合",
        glyph_hint: "{x}",
        detail: "\\left\\{ x \\right\\}",
        target: CommandTarget::Struct(StructKind::Brace),
    },
    SubEntry {
        code: "an",
        item_key: 'n',
        is_default: false,
        label: "尖括号内积",
        glyph_hint: "⟨x⟩",
        detail: "\\left\\langle x \\right\\rangle",
        target: CommandTarget::Struct(StructKind::Angle),
    },
    SubEntry {
        code: "ao",
        item_key: 'o',
        is_default: false,
        label: "向下取整",
        glyph_hint: "⌊x⌋",
        detail: "\\left\\lfloor x \\right\\rfloor",
        target: CommandTarget::Struct(StructKind::Floor),
    },
    SubEntry {
        code: "ap",
        item_key: 'p',
        is_default: false,
        label: "向上取整",
        glyph_hint: "⌈x⌉",
        detail: "\\left\\lceil x \\right\\rceil",
        target: CommandTarget::Struct(StructKind::Ceil),
    },
    SubEntry {
        code: "aq",
        item_key: 'q',
        is_default: false,
        label: "代入求值线",
        glyph_hint: "F|_a^b",
        detail: "\\left. F \\right|_a^b (代入线)",
        target: CommandTarget::Struct(StructKind::EvalBar),
    },
];

/// 关系符与逻辑箭头子菜单 (x*)
pub const RELATION_ENTRIES: &[SubEntry] = &[
    SubEntry {
        code: "xa",
        item_key: 'a',
        is_default: true,
        label: "恒等",
        glyph_hint: "≡",
        detail: "\\equiv (默认)",
        target: CommandTarget::Symbol(SymbolCmd::Equiv),
    },
    SubEntry {
        code: "xb",
        item_key: 'b',
        is_default: false,
        label: "近似",
        glyph_hint: "≈",
        detail: "\\approx",
        target: CommandTarget::Symbol(SymbolCmd::Approx),
    },
    SubEntry {
        code: "xc",
        item_key: 'c',
        is_default: false,
        label: "相似",
        glyph_hint: "∼",
        detail: "\\sim",
        target: CommandTarget::Symbol(SymbolCmd::Sim),
    },
    SubEntry {
        code: "xd",
        item_key: 'd',
        is_default: false,
        label: "正比",
        glyph_hint: "∝",
        detail: "\\propto",
        target: CommandTarget::Symbol(SymbolCmd::Propto),
    },
    SubEntry {
        code: "xe",
        item_key: 'e',
        is_default: false,
        label: "蕴含",
        glyph_hint: "⇒",
        detail: "\\Rightarrow",
        target: CommandTarget::Symbol(SymbolCmd::Implies),
    },
    SubEntry {
        code: "xf",
        item_key: 'f',
        is_default: false,
        label: "等价",
        glyph_hint: "⇔",
        detail: "\\Leftrightarrow",
        target: CommandTarget::Symbol(SymbolCmd::Iff),
    },
    SubEntry {
        code: "xg",
        item_key: 'g',
        is_default: false,
        label: "映射",
        glyph_hint: "↦",
        detail: "\\mapsto",
        target: CommandTarget::Symbol(SymbolCmd::Mapsto),
    },
    SubEntry {
        code: "xh",
        item_key: 'h',
        is_default: false,
        label: "所以",
        glyph_hint: "∴",
        detail: "\\therefore",
        target: CommandTarget::Symbol(SymbolCmd::Therefore),
    },
    SubEntry {
        code: "xi",
        item_key: 'i',
        is_default: false,
        label: "因为",
        glyph_hint: "∵",
        detail: "\\because",
        target: CommandTarget::Symbol(SymbolCmd::Because),
    },
    SubEntry {
        code: "xj",
        item_key: 'j',
        is_default: false,
        label: "全等/同余",
        glyph_hint: "≅",
        detail: "\\cong (也可直输 ~=)",
        target: CommandTarget::Symbol(SymbolCmd::Cong),
    },
    SubEntry {
        code: "xk",
        item_key: 'k',
        is_default: false,
        label: "远小于",
        glyph_hint: "≪",
        detail: "\\ll (也可直输 <<)",
        target: CommandTarget::Symbol(SymbolCmd::Ll),
    },
    SubEntry {
        code: "xl",
        item_key: 'l',
        is_default: false,
        label: "远大于",
        glyph_hint: "≫",
        detail: "\\gg (也可直输 >>)",
        target: CommandTarget::Symbol(SymbolCmd::Gg),
    },
    SubEntry {
        code: "xm",
        item_key: 'm',
        is_default: false,
        label: "渐近相等",
        glyph_hint: "≃",
        detail: "\\simeq",
        target: CommandTarget::Symbol(SymbolCmd::Simeq),
    },
];

/// 集合与逻辑子菜单 (q*)
pub const SET_LOGIC_ENTRIES: &[SubEntry] = &[
    SubEntry {
        code: "qa",
        item_key: 'a',
        is_default: true,
        label: "并集",
        glyph_hint: "∪",
        detail: "\\cup (默认)",
        target: CommandTarget::Symbol(SymbolCmd::Cup),
    },
    SubEntry {
        code: "qb",
        item_key: 'b',
        is_default: false,
        label: "交集",
        glyph_hint: "∩",
        detail: "\\cap",
        target: CommandTarget::Symbol(SymbolCmd::Cap),
    },
    SubEntry {
        code: "qc",
        item_key: 'c',
        is_default: false,
        label: "空集",
        glyph_hint: "∅",
        detail: "\\varnothing",
        target: CommandTarget::Symbol(SymbolCmd::EmptySet),
    },
    SubEntry {
        code: "qd",
        item_key: 'd',
        is_default: false,
        label: "真子集",
        glyph_hint: "⊂",
        detail: "\\subset",
        target: CommandTarget::Symbol(SymbolCmd::Subset),
    },
    SubEntry {
        code: "qe",
        item_key: 'e',
        is_default: false,
        label: "存在",
        glyph_hint: "∃",
        detail: "\\exists",
        target: CommandTarget::Symbol(SymbolCmd::Exists),
    },
    SubEntry {
        code: "qf",
        item_key: 'f',
        is_default: false,
        label: "非",
        glyph_hint: "¬",
        detail: "\\neg",
        target: CommandTarget::Symbol(SymbolCmd::Neg),
    },
    SubEntry {
        code: "qg",
        item_key: 'g',
        is_default: false,
        label: "且",
        glyph_hint: "∧",
        detail: "\\land",
        target: CommandTarget::Symbol(SymbolCmd::Land),
    },
    SubEntry {
        code: "qh",
        item_key: 'h',
        is_default: false,
        label: "或",
        glyph_hint: "∨",
        detail: "\\lor",
        target: CommandTarget::Symbol(SymbolCmd::Lor),
    },
    SubEntry {
        code: "qi",
        item_key: 'i',
        is_default: false,
        label: "实数集",
        glyph_hint: "ℝ",
        detail: "\\mathbb{R}",
        target: CommandTarget::Symbol(SymbolCmd::RealSet),
    },
    SubEntry {
        code: "qj",
        item_key: 'j',
        is_default: false,
        label: "自然数集",
        glyph_hint: "ℕ",
        detail: "\\mathbb{N}",
        target: CommandTarget::Symbol(SymbolCmd::NatSet),
    },
    SubEntry {
        code: "qk",
        item_key: 'k',
        is_default: false,
        label: "整数集",
        glyph_hint: "ℤ",
        detail: "\\mathbb{Z}",
        target: CommandTarget::Symbol(SymbolCmd::IntSet),
    },
    SubEntry {
        code: "ql",
        item_key: 'l',
        is_default: false,
        label: "有理数集",
        glyph_hint: "ℚ",
        detail: "\\mathbb{Q}",
        target: CommandTarget::Symbol(SymbolCmd::RatSet),
    },
    SubEntry {
        code: "qm",
        item_key: 'm',
        is_default: false,
        label: "差集",
        glyph_hint: "∖",
        detail: "\\setminus",
        target: CommandTarget::Symbol(SymbolCmd::SetMinus),
    },
    SubEntry {
        code: "qn",
        item_key: 'n',
        is_default: false,
        label: "复数集",
        glyph_hint: "ℂ",
        detail: "\\mathbb{C}",
        target: CommandTarget::Symbol(SymbolCmd::ComplexSet),
    },
];

const GREEK_ENTRIES: &[SubEntry] = &[
    SubEntry {
        code: "ga",
        item_key: 'a',
        is_default: true,
        label: "alpha",
        glyph_hint: "α",
        detail: "\\alpha (默认)",
        target: CommandTarget::Symbol(SymbolCmd::Alpha),
    },
    SubEntry {
        code: "gb",
        item_key: 'b',
        is_default: false,
        label: "beta",
        glyph_hint: "β",
        detail: "\\beta",
        target: CommandTarget::Symbol(SymbolCmd::Beta),
    },
    SubEntry {
        code: "gc",
        item_key: 'c',
        is_default: false,
        label: "gamma",
        glyph_hint: "γ",
        detail: "\\gamma",
        target: CommandTarget::Symbol(SymbolCmd::Gamma),
    },
    SubEntry {
        code: "gd",
        item_key: 'd',
        is_default: false,
        label: "delta",
        glyph_hint: "δ",
        detail: "\\delta",
        target: CommandTarget::Symbol(SymbolCmd::Delta),
    },
    SubEntry {
        code: "ge",
        item_key: 'e',
        is_default: false,
        label: "epsilon",
        glyph_hint: "ε",
        detail: "\\varepsilon",
        target: CommandTarget::Symbol(SymbolCmd::Epsilon),
    },
    SubEntry {
        code: "gt",
        item_key: 't',
        is_default: false,
        label: "theta",
        glyph_hint: "θ",
        detail: "\\theta",
        target: CommandTarget::Symbol(SymbolCmd::Theta),
    },
    SubEntry {
        code: "gl",
        item_key: 'l',
        is_default: false,
        label: "lambda",
        glyph_hint: "λ",
        detail: "\\lambda",
        target: CommandTarget::Symbol(SymbolCmd::Lambda),
    },
    SubEntry {
        code: "gm",
        item_key: 'm',
        is_default: false,
        label: "mu",
        glyph_hint: "μ",
        detail: "\\mu",
        target: CommandTarget::Symbol(SymbolCmd::Mu),
    },
    SubEntry {
        code: "gp",
        item_key: 'p',
        is_default: false,
        label: "pi",
        glyph_hint: "π",
        detail: "\\pi",
        target: CommandTarget::Symbol(SymbolCmd::Pi),
    },
    SubEntry {
        code: "gs",
        item_key: 's',
        is_default: false,
        label: "sigma",
        glyph_hint: "σ",
        detail: "\\sigma",
        target: CommandTarget::Symbol(SymbolCmd::Sigma),
    },
    SubEntry {
        code: "gf",
        item_key: 'f',
        is_default: false,
        label: "phi",
        glyph_hint: "φ",
        detail: "\\phi",
        target: CommandTarget::Symbol(SymbolCmd::Phi),
    },
    SubEntry {
        code: "go",
        item_key: 'o',
        is_default: false,
        label: "omega",
        glyph_hint: "ω",
        detail: "\\omega",
        target: CommandTarget::Symbol(SymbolCmd::Omega),
    },
    SubEntry {
        code: "gx",
        item_key: 'x',
        is_default: false,
        label: "Delta",
        glyph_hint: "Δ",
        detail: "\\Delta",
        target: CommandTarget::Symbol(SymbolCmd::CapDelta),
    },
    SubEntry {
        code: "gz",
        item_key: 'z',
        is_default: false,
        label: "Omega",
        glyph_hint: "Ω",
        detail: "\\Omega",
        target: CommandTarget::Symbol(SymbolCmd::CapOmega),
    },
];

const SYMBOL_ENTRIES: &[SubEntry] = &[
    SubEntry {
        code: "oa",
        item_key: 'a',
        is_default: true,
        label: "无穷",
        glyph_hint: "∞",
        detail: "\\infty (也可直输 oo)",
        target: CommandTarget::Symbol(SymbolCmd::Infty),
    },
    SubEntry {
        code: "ob",
        item_key: 'b',
        is_default: false,
        label: "趋向",
        glyph_hint: "→",
        detail: "\\to (也可直输 ->)",
        target: CommandTarget::Symbol(SymbolCmd::To),
    },
    SubEntry {
        code: "oc",
        item_key: 'c',
        is_default: false,
        label: "偏导",
        glyph_hint: "∂",
        detail: "\\partial",
        target: CommandTarget::Symbol(SymbolCmd::Partial),
    },
    SubEntry {
        code: "od",
        item_key: 'd',
        is_default: false,
        label: "梯度",
        glyph_hint: "∇",
        detail: "\\nabla",
        target: CommandTarget::Symbol(SymbolCmd::Nabla),
    },
    SubEntry {
        code: "oe",
        item_key: 'e',
        is_default: false,
        label: "正负",
        glyph_hint: "±",
        detail: "\\pm (也可直输 +-)",
        target: CommandTarget::Symbol(SymbolCmd::Pm),
    },
    SubEntry {
        code: "of",
        item_key: 'f',
        is_default: false,
        label: "叉乘",
        glyph_hint: "×",
        detail: "\\times",
        target: CommandTarget::Symbol(SymbolCmd::Times),
    },
    SubEntry {
        code: "og",
        item_key: 'g',
        is_default: false,
        label: "点乘",
        glyph_hint: "·",
        detail: "\\cdot",
        target: CommandTarget::Symbol(SymbolCmd::Cdot),
    },
    SubEntry {
        code: "oh",
        item_key: 'h',
        is_default: false,
        label: "属于",
        glyph_hint: "∈",
        detail: "\\in",
        target: CommandTarget::Symbol(SymbolCmd::In),
    },
    SubEntry {
        code: "oi",
        item_key: 'i',
        is_default: false,
        label: "不属于",
        glyph_hint: "∉",
        detail: "\\notin",
        target: CommandTarget::Symbol(SymbolCmd::NotIn),
    },
    SubEntry {
        code: "oj",
        item_key: 'j',
        is_default: false,
        label: "子集",
        glyph_hint: "⊆",
        detail: "\\subseteq",
        target: CommandTarget::Symbol(SymbolCmd::SubsetEq),
    },
    SubEntry {
        code: "ok",
        item_key: 'k',
        is_default: false,
        label: "任意",
        glyph_hint: "∀",
        detail: "\\forall",
        target: CommandTarget::Symbol(SymbolCmd::ForAll),
    },
    SubEntry {
        code: "ol",
        item_key: 'l',
        is_default: false,
        label: "约化普朗克",
        glyph_hint: "ℏ",
        detail: "\\hbar",
        target: CommandTarget::Symbol(SymbolCmd::Hbar),
    },
    SubEntry {
        code: "om",
        item_key: 'm',
        is_default: false,
        label: "花体l",
        glyph_hint: "ℓ",
        detail: "\\ell",
        target: CommandTarget::Symbol(SymbolCmd::Ell),
    },
    SubEntry {
        code: "on",
        item_key: 'n',
        is_default: false,
        label: "圈乘/度",
        glyph_hint: "∘",
        detail: "\\circ",
        target: CommandTarget::Symbol(SymbolCmd::Circ),
    },
    SubEntry {
        code: "oo",
        item_key: 'o',
        is_default: false,
        label: "平行",
        glyph_hint: "∥",
        detail: "\\parallel (也可直输 ||)",
        target: CommandTarget::Symbol(SymbolCmd::Parallel),
    },
    SubEntry {
        code: "op",
        item_key: 'p',
        is_default: false,
        label: "垂直",
        glyph_hint: "⊥",
        detail: "\\perp (也可直输 _|_)",
        target: CommandTarget::Symbol(SymbolCmd::Perp),
    },
];

impl SubCategory {
    pub const STATIC_ALL: [SubCategory; 7] = [
        SubCategory::CalculusMore,
        SubCategory::Matrix,
        SubCategory::Accent,
        SubCategory::Greek,
        SubCategory::Symbol,
        SubCategory::Relations,
        SubCategory::SetLogic,
    ];

    pub const ALL: [SubCategory; 9] = [
        SubCategory::CalculusMore,
        SubCategory::Matrix,
        SubCategory::Accent,
        SubCategory::Greek,
        SubCategory::Symbol,
        SubCategory::Relations,
        SubCategory::SetLogic,
        SubCategory::Custom,
        SubCategory::Template,
    ];

    pub fn from_key(ch: char) -> Option<Self> {
        match ch {
            'c' => Some(SubCategory::CalculusMore),
            'm' => Some(SubCategory::Matrix),
            'a' => Some(SubCategory::Accent),
            'g' => Some(SubCategory::Greek),
            'o' => Some(SubCategory::Symbol),
            'x' => Some(SubCategory::Relations),
            'q' => Some(SubCategory::SetLogic),
            'k' => Some(SubCategory::Custom),
            't' => Some(SubCategory::Template),
            _ => None,
        }
    }

    pub fn key(self) -> char {
        match self {
            SubCategory::CalculusMore => 'c',
            SubCategory::Matrix => 'm',
            SubCategory::Accent => 'a',
            SubCategory::Greek => 'g',
            SubCategory::Symbol => 'o',
            SubCategory::Relations => 'x',
            SubCategory::SetLogic => 'q',
            SubCategory::Custom => 'k',
            SubCategory::Template => 't',
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            SubCategory::CalculusMore => "积分/连乘",
            SubCategory::Matrix => "矩阵/分段",
            SubCategory::Accent => "标注/定界",
            SubCategory::Greek => "希腊字母",
            SubCategory::Symbol => "常用符号",
            SubCategory::Relations => "关系符/箭头",
            SubCategory::SetLogic => "集合/逻辑",
            SubCategory::Custom => "自定义格式",
            SubCategory::Template => "片段模版",
        }
    }

    pub fn glyph(self) -> &'static str {
        match self {
            SubCategory::CalculusMore => "∫…",
            SubCategory::Matrix => "[…]",
            SubCategory::Accent => "x̂",
            SubCategory::Greek => "αβ",
            SubCategory::Symbol => "∞∂",
            SubCategory::Relations => "≡≈",
            SubCategory::SetLogic => "∪ℝ",
            SubCategory::Custom => "⚡",
            SubCategory::Template => "⎘",
        }
    }

    pub fn entries(self) -> &'static [SubEntry] {
        match self {
            SubCategory::CalculusMore => CALCULUS_MORE_ENTRIES,
            SubCategory::Matrix => MATRIX_ENTRIES,
            SubCategory::Accent => ACCENT_ENTRIES,
            SubCategory::Greek => GREEK_ENTRIES,
            SubCategory::Symbol => SYMBOL_ENTRIES,
            SubCategory::Relations => RELATION_ENTRIES,
            SubCategory::SetLogic => SET_LOGIC_ENTRIES,
            SubCategory::Custom | SubCategory::Template => &[],
        }
    }

    pub fn default_entry(self) -> Option<&'static SubEntry> {
        let slice = self.entries();
        if slice.is_empty() {
            None
        } else {
            Some(slice.iter().find(|e| e.is_default).unwrap_or(&slice[0]))
        }
    }
}

impl StructKind {
    pub const ALL: [StructKind; 44] = [
        StructKind::Frac,
        StructKind::Sqrt,
        StructKind::NthRoot,
        StructKind::Sup,
        StructKind::Sub,
        StructKind::SubSup,
        StructKind::Paren,
        StructKind::Abs,
        StructKind::Integral,
        StructKind::Sum,
        StructKind::Limit,
        StructKind::IndefIntegral,
        StructKind::Product,
        StructKind::DoubleIntegral,
        StructKind::ContourIntegral,
        StructKind::TripleIntegral,
        StructKind::PartialFrac,
        StructKind::TotalFrac,
        StructKind::Matrix2,
        StructKind::Matrix3,
        StructKind::Det2,
        StructKind::Cases2,
        StructKind::Hat,
        StructKind::Bar,
        StructKind::Vec,
        StructKind::Tilde,
        StructKind::Dot,
        StructKind::Norm,
        StructKind::Overline,
        StructKind::DDot,
        StructKind::Underline,
        StructKind::Overbrace,
        StructKind::Underbrace,
        StructKind::Bracket,
        StructKind::Brace,
        StructKind::Angle,
        StructKind::Floor,
        StructKind::Ceil,
        StructKind::EvalBar,
        StructKind::Binom,
        StructKind::BMatrix2,
        StructKind::Cases3,
        StructKind::BMatrix3,
        StructKind::Det3,
    ];

    pub fn code(self) -> &'static str {
        match self {
            StructKind::Frac => "f",
            StructKind::Sqrt => "r",
            StructKind::NthRoot => "n",
            StructKind::Sup => "u",
            StructKind::Sub => "d",
            StructKind::SubSup => "b",
            StructKind::Paren => "p",
            StructKind::Abs => "v",
            StructKind::Integral => "i",
            StructKind::Sum => "s",
            StructKind::Limit => "l",
            StructKind::IndefIntegral => "ca",
            StructKind::Product => "cb",
            StructKind::DoubleIntegral => "cc",
            StructKind::ContourIntegral => "cd",
            StructKind::TripleIntegral => "ce",
            StructKind::PartialFrac => "cg",
            StructKind::TotalFrac => "ci",
            StructKind::Matrix2 => "ma",
            StructKind::Matrix3 => "mb",
            StructKind::Det2 => "mc",
            StructKind::Cases2 => "md",
            StructKind::Hat => "aa",
            StructKind::Bar => "ab",
            StructKind::Vec => "ac",
            StructKind::Tilde => "ad",
            StructKind::Dot => "ae",
            StructKind::Norm => "af",
            StructKind::Overline => "ag",
            StructKind::DDot => "ah",
            StructKind::Underline => "ai",
            StructKind::Overbrace => "aj",
            StructKind::Underbrace => "ak",
            StructKind::Bracket => "al",
            StructKind::Brace => "am",
            StructKind::Angle => "an",
            StructKind::Floor => "ao",
            StructKind::Ceil => "ap",
            StructKind::EvalBar => "aq",
            StructKind::Binom => "e",
            StructKind::BMatrix2 => "me",
            StructKind::Cases3 => "mf",
            StructKind::BMatrix3 => "mg",
            StructKind::Det3 => "mh",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            StructKind::Frac => "分数",
            StructKind::Sqrt => "根号",
            StructKind::NthRoot => "N次根号",
            StructKind::Sup => "上标",
            StructKind::Sub => "下标",
            StructKind::SubSup => "上下标",
            StructKind::Paren => "括号",
            StructKind::Abs => "绝对值",
            StructKind::Integral => "定积分",
            StructKind::Sum => "求和",
            StructKind::Limit => "极限",
            StructKind::IndefIntegral => "不定积分",
            StructKind::Product => "连乘",
            StructKind::DoubleIntegral => "二重积分",
            StructKind::ContourIntegral => "环路积分",
            StructKind::TripleIntegral => "三重积分",
            StructKind::PartialFrac => "偏导分式",
            StructKind::TotalFrac => "全导分式",
            StructKind::Matrix2 => "2×2 矩阵",
            StructKind::Matrix3 => "3×3 矩阵",
            StructKind::Det2 => "2×2 行列式",
            StructKind::Cases2 => "分段函数",
            StructKind::Hat => "帽子",
            StructKind::Bar => "上横线",
            StructKind::Vec => "向量",
            StructKind::Tilde => "波浪号",
            StructKind::Dot => "导点",
            StructKind::Norm => "范数",
            StructKind::Overline => "上划线",
            StructKind::DDot => "二阶导点",
            StructKind::Underline => "下划线",
            StructKind::Overbrace => "上花括号",
            StructKind::Underbrace => "下花括号",
            StructKind::Bracket => "中括号",
            StructKind::Brace => "大括号/集合",
            StructKind::Angle => "尖括号内积",
            StructKind::Floor => "向下取整",
            StructKind::Ceil => "向上取整",
            StructKind::EvalBar => "代入求值线",
            StructKind::Binom => "二项式系数",
            StructKind::BMatrix2 => "方括号矩阵",
            StructKind::Cases3 => "三分段函数",
            StructKind::BMatrix3 => "3×3 方块阵",
            StructKind::Det3 => "3×3 行列式",
        }
    }

    pub fn slot_roles(self) -> &'static [&'static str] {
        match self {
            StructKind::Frac => &["分子", "分母"],
            StructKind::Sqrt => &["被开方式"],
            StructKind::NthRoot => &["根指数", "被开方式"],
            StructKind::Sup => &["底数", "指数"],
            StructKind::Sub => &["主体", "下标"],
            StructKind::SubSup => &["主体", "下标", "上标"],
            StructKind::Paren => &["括号内"],
            StructKind::Abs => &["绝对值内"],
            StructKind::Integral => &["下限", "上限", "被积式"],
            StructKind::IndefIntegral => &["被积式"],
            StructKind::DoubleIntegral => &["积分区域", "被积式"],
            StructKind::ContourIntegral => &["积分路径", "被积式"],
            StructKind::TripleIntegral => &["积分体", "被积式"],
            StructKind::PartialFrac => &["分子", "分母"],
            StructKind::TotalFrac => &["分子", "分母"],
            StructKind::Sum => &["下限", "上限", "求和项"],
            StructKind::Product => &["下限", "上限", "连乘项"],
            StructKind::Limit => &["趋近变量", "趋近目标", "主体"],
            StructKind::Matrix2 | StructKind::Det2 => &["(1,1)", "(1,2)", "(2,1)", "(2,2)"],
            StructKind::Matrix3 | StructKind::BMatrix3 | StructKind::Det3 => &[
                "(1,1)", "(1,2)", "(1,3)", "(2,1)", "(2,2)", "(2,3)", "(3,1)", "(3,2)", "(3,3)",
            ],
            StructKind::Cases2 => &["表达式1", "条件1", "表达式2", "条件2"],
            StructKind::Hat => &["帽子内"],
            StructKind::Bar => &["横线内"],
            StructKind::Vec => &["向量内"],
            StructKind::Tilde => &["波浪号内"],
            StructKind::Dot => &["导点内"],
            StructKind::Norm => &["范数内"],
            StructKind::Overline => &["上划线内"],
            StructKind::DDot => &["二阶导点内"],
            StructKind::Underline => &["下划线内"],
            StructKind::Overbrace => &["主体", "标注"],
            StructKind::Underbrace => &["主体", "标注"],
            StructKind::Bracket => &["中括号内"],
            StructKind::Brace => &["大括号内"],
            StructKind::Angle => &["尖括号内"],
            StructKind::Floor => &["向下取整内"],
            StructKind::Ceil => &["向上取整内"],
            StructKind::EvalBar => &["表达式", "下限", "上限"],
            StructKind::Binom => &["上标 n", "下标 k"],
            StructKind::BMatrix2 => &["(1,1)", "(1,2)", "(2,1)", "(2,2)"],
            StructKind::Cases3 => &[
                "表达式1", "条件1", "表达式2", "条件2", "表达式3", "条件3",
            ],
        }
    }

    pub fn arity(self) -> usize {
        self.slot_roles().len()
    }

    /// 当光标位于一段已有表达式前方（如跳回行首 `[a]` 后插入极限/积分/根号/分数）时，
    /// 返回应当自动接收该已有表达式的「主体槽位下标」：
    pub fn wrap_body_slot_index(self) -> Option<usize> {
        match self {
            StructKind::Limit
            | StructKind::Integral
            | StructKind::Sum
            | StructKind::Product => Some(2),
            StructKind::NthRoot
            | StructKind::DoubleIntegral
            | StructKind::ContourIntegral
            | StructKind::TripleIntegral => Some(1),
            StructKind::Matrix2
            | StructKind::Matrix3
            | StructKind::Det2
            | StructKind::BMatrix2
            | StructKind::BMatrix3
            | StructKind::Det3 => None,
            _ => Some(0),
        }
    }
}

impl SymbolCmd {
    pub const ALL: [SymbolCmd; 57] = [
        SymbolCmd::Alpha,
        SymbolCmd::Beta,
        SymbolCmd::Gamma,
        SymbolCmd::Delta,
        SymbolCmd::Epsilon,
        SymbolCmd::Theta,
        SymbolCmd::Lambda,
        SymbolCmd::Mu,
        SymbolCmd::Pi,
        SymbolCmd::Sigma,
        SymbolCmd::Phi,
        SymbolCmd::Omega,
        SymbolCmd::CapDelta,
        SymbolCmd::CapOmega,
        SymbolCmd::Infty,
        SymbolCmd::To,
        SymbolCmd::Partial,
        SymbolCmd::Nabla,
        SymbolCmd::Pm,
        SymbolCmd::Times,
        SymbolCmd::Cdot,
        SymbolCmd::In,
        SymbolCmd::NotIn,
        SymbolCmd::SubsetEq,
        SymbolCmd::ForAll,
        SymbolCmd::Hbar,
        SymbolCmd::Ell,
        SymbolCmd::Circ,
        SymbolCmd::Parallel,
        SymbolCmd::Perp,
        SymbolCmd::Equiv,
        SymbolCmd::Approx,
        SymbolCmd::Sim,
        SymbolCmd::Propto,
        SymbolCmd::Implies,
        SymbolCmd::Iff,
        SymbolCmd::Mapsto,
        SymbolCmd::Therefore,
        SymbolCmd::Because,
        SymbolCmd::Cong,
        SymbolCmd::Ll,
        SymbolCmd::Gg,
        SymbolCmd::Simeq,
        SymbolCmd::Cup,
        SymbolCmd::Cap,
        SymbolCmd::EmptySet,
        SymbolCmd::Subset,
        SymbolCmd::Exists,
        SymbolCmd::Neg,
        SymbolCmd::Land,
        SymbolCmd::Lor,
        SymbolCmd::RealSet,
        SymbolCmd::NatSet,
        SymbolCmd::IntSet,
        SymbolCmd::RatSet,
        SymbolCmd::SetMinus,
        SymbolCmd::ComplexSet,
    ];

    pub fn code(self) -> &'static str {
        match self {
            SymbolCmd::Alpha => "ga",
            SymbolCmd::Beta => "gb",
            SymbolCmd::Gamma => "gc",
            SymbolCmd::Delta => "gd",
            SymbolCmd::Epsilon => "ge",
            SymbolCmd::Theta => "gt",
            SymbolCmd::Lambda => "gl",
            SymbolCmd::Mu => "gm",
            SymbolCmd::Pi => "gp",
            SymbolCmd::Sigma => "gs",
            SymbolCmd::Phi => "gf",
            SymbolCmd::Omega => "go",
            SymbolCmd::CapDelta => "gx",
            SymbolCmd::CapOmega => "gz",
            SymbolCmd::Infty => "oa",
            SymbolCmd::To => "ob",
            SymbolCmd::Partial => "oc",
            SymbolCmd::Nabla => "od",
            SymbolCmd::Pm => "oe",
            SymbolCmd::Times => "of",
            SymbolCmd::Cdot => "og",
            SymbolCmd::In => "oh",
            SymbolCmd::NotIn => "oi",
            SymbolCmd::SubsetEq => "oj",
            SymbolCmd::ForAll => "ok",
            SymbolCmd::Hbar => "ol",
            SymbolCmd::Ell => "om",
            SymbolCmd::Circ => "on",
            SymbolCmd::Parallel => "oo",
            SymbolCmd::Perp => "op",
            SymbolCmd::Equiv => "xa",
            SymbolCmd::Approx => "xb",
            SymbolCmd::Sim => "xc",
            SymbolCmd::Propto => "xd",
            SymbolCmd::Implies => "xe",
            SymbolCmd::Iff => "xf",
            SymbolCmd::Mapsto => "xg",
            SymbolCmd::Therefore => "xh",
            SymbolCmd::Because => "xi",
            SymbolCmd::Cong => "xj",
            SymbolCmd::Ll => "xk",
            SymbolCmd::Gg => "xl",
            SymbolCmd::Simeq => "xm",
            SymbolCmd::Cup => "qa",
            SymbolCmd::Cap => "qb",
            SymbolCmd::EmptySet => "qc",
            SymbolCmd::Subset => "qd",
            SymbolCmd::Exists => "qe",
            SymbolCmd::Neg => "qf",
            SymbolCmd::Land => "qg",
            SymbolCmd::Lor => "qh",
            SymbolCmd::RealSet => "qi",
            SymbolCmd::NatSet => "qj",
            SymbolCmd::IntSet => "qk",
            SymbolCmd::RatSet => "ql",
            SymbolCmd::SetMinus => "qm",
            SymbolCmd::ComplexSet => "qn",
        }
    }

    pub fn scheme_a_str(self) -> &'static str {
        match self {
            SymbolCmd::Alpha => "alpha",
            SymbolCmd::Beta => "beta",
            SymbolCmd::Gamma => "gamma",
            SymbolCmd::Delta => "delta",
            SymbolCmd::Epsilon => "epsilon",
            SymbolCmd::Theta => "theta",
            SymbolCmd::Lambda => "lambda",
            SymbolCmd::Mu => "mu",
            SymbolCmd::Pi => "pi",
            SymbolCmd::Sigma => "sigma",
            SymbolCmd::Phi => "phi",
            SymbolCmd::Omega => "omega",
            SymbolCmd::CapDelta => "Delta",
            SymbolCmd::CapOmega => "Omega",
            SymbolCmd::Infty => "oo",
            SymbolCmd::To => "->",
            SymbolCmd::Partial => "partial",
            SymbolCmd::Nabla => "nabla",
            SymbolCmd::Pm => "+-",
            SymbolCmd::Times => "times",
            SymbolCmd::Cdot => "cdot",
            SymbolCmd::In => "in",
            SymbolCmd::NotIn => "notin",
            SymbolCmd::SubsetEq => "subseteq",
            SymbolCmd::ForAll => "forall",
            SymbolCmd::Hbar => "hbar",
            SymbolCmd::Ell => "ell",
            SymbolCmd::Circ => "circ",
            SymbolCmd::Parallel => "parallel",
            SymbolCmd::Perp => "perp",
            SymbolCmd::Equiv => "equiv",
            SymbolCmd::Approx => "approx",
            SymbolCmd::Sim => "sim",
            SymbolCmd::Propto => "propto",
            SymbolCmd::Implies => "implies",
            SymbolCmd::Iff => "iff",
            SymbolCmd::Mapsto => "mapsto",
            SymbolCmd::Therefore => "therefore",
            SymbolCmd::Because => "because",
            SymbolCmd::Cong => "cong",
            SymbolCmd::Ll => "ll",
            SymbolCmd::Gg => "gg",
            SymbolCmd::Simeq => "simeq",
            SymbolCmd::Cup => "cup",
            SymbolCmd::Cap => "cap",
            SymbolCmd::EmptySet => "emptyset",
            SymbolCmd::Subset => "subset",
            SymbolCmd::Exists => "exists",
            SymbolCmd::Neg => "neg",
            SymbolCmd::Land => "land",
            SymbolCmd::Lor => "lor",
            SymbolCmd::RealSet => "R",
            SymbolCmd::NatSet => "N",
            SymbolCmd::IntSet => "Z",
            SymbolCmd::RatSet => "Q",
            SymbolCmd::SetMinus => "setminus",
            SymbolCmd::ComplexSet => "C",
        }
    }

    pub fn latex_macro(self) -> &'static str {
        match self {
            SymbolCmd::Alpha => "\\alpha",
            SymbolCmd::Beta => "\\beta",
            SymbolCmd::Gamma => "\\gamma",
            SymbolCmd::Delta => "\\delta",
            SymbolCmd::Epsilon => "\\varepsilon",
            SymbolCmd::Theta => "\\theta",
            SymbolCmd::Lambda => "\\lambda",
            SymbolCmd::Mu => "\\mu",
            SymbolCmd::Pi => "\\pi",
            SymbolCmd::Sigma => "\\sigma",
            SymbolCmd::Phi => "\\phi",
            SymbolCmd::Omega => "\\omega",
            SymbolCmd::CapDelta => "\\Delta",
            SymbolCmd::CapOmega => "\\Omega",
            SymbolCmd::Infty => "\\infty",
            SymbolCmd::To => "\\to",
            SymbolCmd::Partial => "\\partial",
            SymbolCmd::Nabla => "\\nabla",
            SymbolCmd::Pm => "\\pm",
            SymbolCmd::Times => "\\times",
            SymbolCmd::Cdot => "\\cdot",
            SymbolCmd::In => "\\in",
            SymbolCmd::NotIn => "\\notin",
            SymbolCmd::SubsetEq => "\\subseteq",
            SymbolCmd::ForAll => "\\forall",
            SymbolCmd::Hbar => "\\hbar",
            SymbolCmd::Ell => "\\ell",
            SymbolCmd::Circ => "\\circ",
            SymbolCmd::Parallel => "\\parallel",
            SymbolCmd::Perp => "\\perp",
            SymbolCmd::Equiv => "\\equiv",
            SymbolCmd::Approx => "\\approx",
            SymbolCmd::Sim => "\\sim",
            SymbolCmd::Propto => "\\propto",
            SymbolCmd::Implies => "\\Rightarrow",
            SymbolCmd::Iff => "\\Leftrightarrow",
            SymbolCmd::Mapsto => "\\mapsto",
            SymbolCmd::Therefore => "\\therefore",
            SymbolCmd::Because => "\\because",
            SymbolCmd::Cong => "\\cong",
            SymbolCmd::Ll => "\\ll",
            SymbolCmd::Gg => "\\gg",
            SymbolCmd::Simeq => "\\simeq",
            SymbolCmd::Cup => "\\cup",
            SymbolCmd::Cap => "\\cap",
            SymbolCmd::EmptySet => "\\varnothing",
            SymbolCmd::Subset => "\\subset",
            SymbolCmd::Exists => "\\exists",
            SymbolCmd::Neg => "\\neg",
            SymbolCmd::Land => "\\land",
            SymbolCmd::Lor => "\\lor",
            SymbolCmd::RealSet => "\\mathbb{R}",
            SymbolCmd::NatSet => "\\mathbb{N}",
            SymbolCmd::IntSet => "\\mathbb{Z}",
            SymbolCmd::RatSet => "\\mathbb{Q}",
            SymbolCmd::SetMinus => "\\setminus",
            SymbolCmd::ComplexSet => "\\mathbb{C}",
        }
    }

    pub fn display_glyph(self) -> &'static str {
        match self {
            SymbolCmd::Alpha => "α",
            SymbolCmd::Beta => "β",
            SymbolCmd::Gamma => "γ",
            SymbolCmd::Delta => "δ",
            SymbolCmd::Epsilon => "ε",
            SymbolCmd::Theta => "θ",
            SymbolCmd::Lambda => "λ",
            SymbolCmd::Mu => "μ",
            SymbolCmd::Pi => "π",
            SymbolCmd::Sigma => "σ",
            SymbolCmd::Phi => "φ",
            SymbolCmd::Omega => "ω",
            SymbolCmd::CapDelta => "Δ",
            SymbolCmd::CapOmega => "Ω",
            SymbolCmd::Infty => "∞",
            SymbolCmd::To => "→",
            SymbolCmd::Partial => "∂",
            SymbolCmd::Nabla => "∇",
            SymbolCmd::Pm => "±",
            SymbolCmd::Times => "×",
            SymbolCmd::Cdot => "⋅",
            SymbolCmd::In => "∈",
            SymbolCmd::NotIn => "∉",
            SymbolCmd::SubsetEq => "⊆",
            SymbolCmd::ForAll => "∀",
            SymbolCmd::Hbar => "ℏ",
            SymbolCmd::Ell => "ℓ",
            SymbolCmd::Circ => "∘",
            SymbolCmd::Parallel => "∥",
            SymbolCmd::Perp => "⊥",
            SymbolCmd::Equiv => "≡",
            SymbolCmd::Approx => "≈",
            SymbolCmd::Sim => "∼",
            SymbolCmd::Propto => "∝",
            SymbolCmd::Implies => "⇒",
            SymbolCmd::Iff => "⇔",
            SymbolCmd::Mapsto => "↦",
            SymbolCmd::Therefore => "∴",
            SymbolCmd::Because => "∵",
            SymbolCmd::Cong => "≅",
            SymbolCmd::Ll => "≪",
            SymbolCmd::Gg => "≫",
            SymbolCmd::Simeq => "≃",
            SymbolCmd::Cup => "∪",
            SymbolCmd::Cap => "∩",
            SymbolCmd::EmptySet => "∅",
            SymbolCmd::Subset => "⊂",
            SymbolCmd::Exists => "∃",
            SymbolCmd::Neg => "¬",
            SymbolCmd::Land => "∧",
            SymbolCmd::Lor => "∨",
            SymbolCmd::RealSet => "ℝ",
            SymbolCmd::NatSet => "ℕ",
            SymbolCmd::IntSet => "ℤ",
            SymbolCmd::RatSet => "ℚ",
            SymbolCmd::SetMinus => "∖",
            SymbolCmd::ComplexSet => "ℂ",
        }
    }
}

pub fn lookup_direct(ch: char) -> Option<StructKind> {
    DIRECT_ENTRIES
        .iter()
        .find(|e| e.key == ch)
        .map(|e| e.kind)
}

pub fn lookup_sub_command(c1: char, c2: char) -> Option<CommandTarget> {
    let sub = SubCategory::from_key(c1)?;
    sub.entries()
        .iter()
        .find(|e| e.item_key == c2)
        .map(|e| e.target)
}

/// 分析光标左侧紧邻的前导串，决定顶部固定菜单当前高亮的状态。
pub fn detect_prefix_menu_state(source: &str, cursor_char_idx: usize) -> PrefixMenuState {
    let chars: Vec<char> = source.chars().collect();
    let end = cursor_char_idx.min(chars.len());
    if end == 0 {
        return PrefixMenuState::Idle;
    }

    if chars[end - 1] == CMD_PREFIX {
        return PrefixMenuState::Root;
    }

    if end >= 2 && chars[end - 2] == CMD_PREFIX {
        let ch = chars[end - 1].to_ascii_lowercase();
        if lookup_direct(ch).is_some() {
            return PrefixMenuState::Idle;
        }
        if ch == 'j' {
            return PrefixMenuState::Jump(String::new());
        }
        if let Some(sub) = SubCategory::from_key(ch) {
            return PrefixMenuState::SubMenu(sub);
        }
        if ch.is_ascii_alphabetic() {
            return PrefixMenuState::InvalidPrefix(ch);
        }
    }

    if let Some(p_pos) = (0..end).rev().find(|&idx| chars[idx] == CMD_PREFIX)
        && p_pos + 1 < end
        && chars[p_pos + 1] == 'j'
    {
        let tail: String = chars[(p_pos + 2)..end].iter().collect();
        if tail
            .chars()
            .all(|c| c.is_ascii_lowercase() || matches!(c, '.' | '$' | '-'))
            && tail.len() <= 6
        {
            return PrefixMenuState::Jump(tail);
        }
    }

    PrefixMenuState::Idle
}

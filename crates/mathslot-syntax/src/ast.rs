use crate::span::{Span, Spanned};
use serde::{Deserialize, Serialize};

/// 唯一槽位标识符
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct SlotId(pub u32);

/// 定界符枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Delim {
    /// ( ... )
    Paren,
    /// [ ... ]
    Bracket,
    /// \{ ... \}
    Brace,
    /// | ... |
    Pipe,
    /// \| ... \|
    DoublePipe,
    /// \langle ... \rangle
    Angle,
    /// . (空定界符，用于 \left. 或 \right.)
    Empty,
}

impl Delim {
    /// 获取配对的闭合定界符
    pub fn matching_close(&self) -> Self {
        *self
    }

    /// 定界符的 LaTeX 开口表达
    pub fn open_latex(&self) -> &'static str {
        match self {
            Self::Paren => "(",
            Self::Bracket => "[",
            Self::Brace => r"\{",
            Self::Pipe => "|",
            Self::DoublePipe => r"\|",
            Self::Angle => r"\langle ",
            Self::Empty => ".",
        }
    }

    /// 定界符的 LaTeX 闭合表达
    pub fn close_latex(&self) -> &'static str {
        match self {
            Self::Paren => ")",
            Self::Bracket => "]",
            Self::Brace => r"\}",
            Self::Pipe => "|",
            Self::DoublePipe => r"\|",
            Self::Angle => r"\rangle ",
            Self::Empty => ".",
        }
    }
}

/// 大算子类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BigOpKind {
    /// \sum
    Sum,
    /// \int
    Integral,
    /// \iint
    DoubleIntegral,
    /// \iiint
    TripleIntegral,
    /// \oint
    ContourIntegral,
    /// \prod
    Product,
    /// \lim
    Limit,
}

impl BigOpKind {
    pub fn latex_cmd(&self) -> &'static str {
        match self {
            Self::Sum => r"\sum",
            Self::Integral => r"\int",
            Self::DoubleIntegral => r"\iint",
            Self::TripleIntegral => r"\iiint",
            Self::ContourIntegral => r"\oint",
            Self::Product => r"\prod",
            Self::Limit => r"\lim",
        }
    }
}

/// 泛型矩阵与多维环境枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MatrixEnv {
    /// matrix (无外框)
    Matrix,
    /// pmatrix (圆括号)
    Pmatrix,
    /// bmatrix (方括号)
    Bmatrix,
    /// vmatrix (单竖线行列式)
    Vmatrix,
    /// cases (分段函数左大括号)
    Cases,
    /// aligned (对齐环境)
    Aligned,
}

impl MatrixEnv {
    pub fn latex_name(&self) -> &'static str {
        match self {
            Self::Matrix => "matrix",
            Self::Pmatrix => "pmatrix",
            Self::Bmatrix => "bmatrix",
            Self::Vmatrix => "vmatrix",
            Self::Cases => "cases",
            Self::Aligned => "aligned",
        }
    }

    pub fn from_latex_name(name: &str) -> Option<Self> {
        match name {
            "matrix" => Some(Self::Matrix),
            "pmatrix" => Some(Self::Pmatrix),
            "bmatrix" => Some(Self::Bmatrix),
            "vmatrix" => Some(Self::Vmatrix),
            "cases" => Some(Self::Cases),
            "aligned" => Some(Self::Aligned),
            _ => None,
        }
    }
}

/// 常用数学字体与样式修饰枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MathStyle {
    Roman,       // \mathrm
    Bold,        // \mathbf
    Italic,      // \mathit
    Caligraphic, // \mathcal
    Blackboard,  // \mathbb
    Fraktur,     // \mathfrak
    Typewriter,  // \mathtt
    SansSerif,   // \mathsf
    Text,        // \text
}

impl MathStyle {
    pub fn from_cmd(cmd: &str) -> Option<Self> {
        match cmd {
            "mathrm" | "textrm" => Some(Self::Roman),
            "mathbf" | "textbf" => Some(Self::Bold),
            "mathit" => Some(Self::Italic),
            "mathcal" => Some(Self::Caligraphic),
            "mathbb" => Some(Self::Blackboard),
            "mathfrak" => Some(Self::Fraktur),
            "mathtt" => Some(Self::Typewriter),
            "mathsf" => Some(Self::SansSerif),
            "text" => Some(Self::Text),
            _ => None,
        }
    }

    pub fn latex_cmd(&self) -> &'static str {
        match self {
            Self::Roman => r"\mathrm",
            Self::Bold => r"\mathbf",
            Self::Italic => r"\mathit",
            Self::Caligraphic => r"\mathcal",
            Self::Blackboard => r"\mathbb",
            Self::Fraktur => r"\mathfrak",
            Self::Typewriter => r"\mathtt",
            Self::SansSerif => r"\mathsf",
            Self::Text => r"\text",
        }
    }
}

/// 常用数学符号或标识符分类
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SymbolKind {
    /// \alpha, \beta, \pi, \theta, \Omega 等
    Greek(String),
    /// \le, \ge, \ne, \approx, \sim, \in 等
    Relation(String),
    /// \pm, \times, \div, \cdot, \circ 等
    Operator(String),
    /// \to, \rightarrow, \implies 等
    Arrow(String),
    /// \infty, \partial, \nabla 等
    Misc(String),
}

impl SymbolKind {
    pub fn latex_str(&self) -> &str {
        match self {
            Self::Greek(s) => s.as_str(),
            Self::Relation(s) => s.as_str(),
            Self::Operator(s) => s.as_str(),
            Self::Arrow(s) => s.as_str(),
            Self::Misc(s) => s.as_str(),
        }
    }
}

/// 核心数学表达式树节点
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Expr {
    /// 纯文本字面量、常数或变量名 (如 "x", "123", "dx")
    Text(String),

    /// 类型化数学符号
    Symbol(SymbolKind),

    /// 花括号分组 { ... }，代表原子级计算整体
    Group(Vec<Spanned<Expr>>),

    /// 上下标节点 (彻底统一 ^/_ 与 ▸u/▸d/▸b)
    Script {
        base: Box<Spanned<Expr>>,
        sub: Option<Box<Spanned<Expr>>>,
        sup: Option<Box<Spanned<Expr>>>,
    },

    /// 样式修饰节点 (例如 \mathbf{A + B}, \mathrm{d}x, \mathcal{H})
    Style {
        style: MathStyle,
        body: Vec<Spanned<Expr>>,
    },

    /// 一等公民定界符节点 (auto_scale 区分裸括号 ( ... ) 与自适应 \left( ... \right))
    Delimited {
        open: Delim,
        close: Delim,
        body: Vec<Spanned<Expr>>,
        auto_scale: bool,
    },

    /// 分数节点 \frac{num}{den}
    Fraction {
        num: Vec<Spanned<Expr>>,
        den: Vec<Spanned<Expr>>,
    },

    /// 根号节点 \sqrt{radicand} 或 \sqrt[index]{radicand}
    Root {
        index: Option<Vec<Spanned<Expr>>>,
        radicand: Vec<Spanned<Expr>>,
    },

    /// 大算子节点 (求和、积分、极限等)
    BigOperator {
        kind: BigOpKind,
        lower: Option<Vec<Spanned<Expr>>>,
        upper: Option<Vec<Spanned<Expr>>>,
        body: Vec<Spanned<Expr>>,
    },

    /// 泛型矩阵节点 (支持任意 m × n 网格，行分隔 \\ 与列分隔 & 仅在此生效)
    Matrix {
        env: MatrixEnv,
        rows: Vec<Vec<Vec<Spanned<Expr>>>>,
    },

    /// 待填充槽位 (供模板展开与流式输入器使用)
    Placeholder {
        slot_id: SlotId,
        label: Option<String>,
    },

    /// 不支持结构或未知宏的安全兜底节点 (透明保留原文，附带 warning)
    RawLatex {
        latex: String,
        warning: Option<String>,
    },

    /// 语法错误恢复节点 (包含未消费的破损碎片，保证解析不中断)
    Error { message: String, raw: String },
}

impl Expr {
    #[inline]
    pub fn spanned(self, span: Span) -> Spanned<Self> {
        Spanned::new(self, span)
    }

    #[inline]
    pub fn text(s: impl Into<String>) -> Self {
        Self::Text(s.into())
    }

    #[inline]
    pub fn script(
        base: Spanned<Expr>,
        sub: Option<Spanned<Expr>>,
        sup: Option<Spanned<Expr>>,
    ) -> Self {
        Self::Script {
            base: Box::new(base),
            sub: sub.map(Box::new),
            sup: sup.map(Box::new),
        }
    }

    #[inline]
    pub fn style(style: MathStyle, body: Vec<Spanned<Expr>>) -> Self {
        Self::Style { style, body }
    }

    #[inline]
    pub fn delimited(
        open: Delim,
        close: Delim,
        body: Vec<Spanned<Expr>>,
        auto_scale: bool,
    ) -> Self {
        Self::Delimited {
            open,
            close,
            body,
            auto_scale,
        }
    }

    #[inline]
    pub fn fraction(num: Vec<Spanned<Expr>>, den: Vec<Spanned<Expr>>) -> Self {
        Self::Fraction { num, den }
    }

    #[inline]
    pub fn root(index: Option<Vec<Spanned<Expr>>>, radicand: Vec<Spanned<Expr>>) -> Self {
        Self::Root { index, radicand }
    }

    #[inline]
    pub fn big_operator(
        kind: BigOpKind,
        lower: Option<Vec<Spanned<Expr>>>,
        upper: Option<Vec<Spanned<Expr>>>,
        body: Vec<Spanned<Expr>>,
    ) -> Self {
        Self::BigOperator {
            kind,
            lower,
            upper,
            body,
        }
    }

    #[inline]
    pub fn matrix(env: MatrixEnv, rows: Vec<Vec<Vec<Spanned<Expr>>>>) -> Self {
        Self::Matrix { env, rows }
    }
}

use crate::ast::SymbolKind;

/// 词法单元标记
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token<'a> {
    // MathSlot 简码引导符与定界符
    LeadTriangle, // ▸
    Semicolon,    // ;

    // LaTeX 控制符与定界符
    LBrace,        // {
    RBrace,        // }
    LParen,        // (
    RParen,        // )
    LBracket,      // [
    RBracket,      // ]
    Pipe,          // |
    DoublePipe,    // \|
    EscapedLBrace, // \{
    EscapedRBrace, // \}
    AngleOpen,     // \langle
    AngleClose,    // \rangle

    Caret,           // ^
    Underscore,      // _
    Ampersand,       // &
    DoubleBackslash, // \\
    Backslash,       // 孤立的反斜杠 \

    // 常用标点与基础算子
    Equal,    // =
    Plus,     // +
    Minus,    // -
    Slash,    // /
    Asterisk, // *
    Comma,    // ,
    Colon,    // :
    Dot,      // .

    // 核心命令标记
    CmdFrac,           // \frac 或 ▸f
    CmdSqrt,           // \sqrt 或 ▸r
    CmdSum,            // \sum 或 ▸s
    CmdInt,            // \int 或 ▸i
    CmdIint,           // \iint
    CmdIiint,          // \iiint
    CmdOint,           // \oint
    CmdProd,           // \prod
    CmdLim,            // \lim 或 ▸l
    CmdLeft,           // \left
    CmdRight,          // \right
    CmdBegin,          // \begin
    CmdEnd,            // \end
    CmdStyle(&'a str), // \mathrm, \mathbf, \text 等

    // 符号与标识符
    Ident(&'a str),      // 变量名或多字符标识符 (如 x, dx, sin)
    Number(&'a str),     // 数字 (如 1, 23, 3.14)
    Symbol(SymbolKind),  // \alpha, \le, \infty 等明确类型化符号
    RawMacro(&'a str),   // 未识别的 LaTeX 宏命令，如 \xygraph
    Whitespace(&'a str), // 空白字符序列
    UnknownChar(char),   // 未知单字符
}

impl<'a> Token<'a> {
    #[inline]
    pub fn is_big_operator(&self) -> bool {
        matches!(
            self,
            Token::CmdSum
                | Token::CmdInt
                | Token::CmdIint
                | Token::CmdIiint
                | Token::CmdOint
                | Token::CmdProd
                | Token::CmdLim
        )
    }
}

use crate::ast::SymbolKind;
use crate::span::{Span, Spanned};
use crate::token::Token;

/// 高性能零拷贝词法扫描器
pub struct Lexer<'a> {
    source: &'a str,
    cursor: usize,
}

impl<'a> Lexer<'a> {
    pub fn new(source: &'a str) -> Self {
        Self { source, cursor: 0 }
    }

    /// 将全文词法分析为带源码 Span 的 Token 列表（保留 Whitespace）
    pub fn tokenize(source: &'a str) -> Vec<Spanned<Token<'a>>> {
        let mut lexer = Self::new(source);
        let mut tokens = Vec::new();
        while let Some(tok) = lexer.next_token() {
            tokens.push(tok);
        }
        tokens
    }

    /// 将全文词法分析为过滤掉空白的 Token 列表（专供 Parser 使用）
    pub fn tokenize_filtered(source: &'a str) -> Vec<Spanned<Token<'a>>> {
        Self::tokenize(source)
            .into_iter()
            .filter(|tok| !matches!(tok.node, Token::Whitespace(_)))
            .collect()
    }

    fn remaining(&self) -> &'a str {
        &self.source[self.cursor..]
    }

    fn peek_char(&self) -> Option<char> {
        self.remaining().chars().next()
    }

    fn peek_char_at(&self, offset: usize) -> Option<char> {
        self.source[self.cursor + offset..].chars().next()
    }

    fn advance(&mut self, bytes: usize) {
        self.cursor += bytes;
    }

    /// 消费下一个 Token
    pub fn next_token(&mut self) -> Option<Spanned<Token<'a>>> {
        if self.cursor >= self.source.len() {
            return None;
        }

        let start = self.cursor;
        let rem = self.remaining();

        // 1. MathSlot 简码引导符 `▸` (U+25B8, 3 字节 UTF-8: \xe2\x96\xb8)
        if rem.starts_with('▸') {
            self.advance('▸'.len_utf8());
            // 检查快捷单字符命令
            if let Some(next_c) = self.peek_char() {
                match next_c {
                    'f' => {
                        self.advance('f'.len_utf8());
                        return Some(Spanned::new(Token::CmdFrac, Span::new(start, self.cursor)));
                    }
                    'r' => {
                        self.advance('r'.len_utf8());
                        return Some(Spanned::new(Token::CmdSqrt, Span::new(start, self.cursor)));
                    }
                    's' => {
                        self.advance('s'.len_utf8());
                        return Some(Spanned::new(Token::CmdSum, Span::new(start, self.cursor)));
                    }
                    'i' => {
                        self.advance('i'.len_utf8());
                        return Some(Spanned::new(Token::CmdInt, Span::new(start, self.cursor)));
                    }
                    'l' => {
                        self.advance('l'.len_utf8());
                        return Some(Spanned::new(Token::CmdLim, Span::new(start, self.cursor)));
                    }
                    _ => {}
                }
            }
            return Some(Spanned::new(
                Token::LeadTriangle,
                Span::new(start, self.cursor),
            ));
        }

        // 2. 空白字符处理
        if let Some(first) = self.peek_char()
            && first.is_whitespace()
        {
            while let Some(c) = self.peek_char() {
                if c.is_whitespace() {
                    self.advance(c.len_utf8());
                } else {
                    break;
                }
            }
            let span = Span::new(start, self.cursor);
            return Some(Spanned::new(
                Token::Whitespace(&self.source[start..self.cursor]),
                span,
            ));
        }

        // 3. 反斜杠引导的 LaTeX 命令、定界符与符号识别
        if rem.starts_with('\\') {
            self.advance(1); // 消费 `\`

            // 检查随后的字符
            if let Some(next_c) = self.peek_char() {
                // 特殊定界符与换行: \\, \{, \}, \|
                match next_c {
                    '\\' => {
                        self.advance(1);
                        return Some(Spanned::new(
                            Token::DoubleBackslash,
                            Span::new(start, self.cursor),
                        ));
                    }
                    '{' => {
                        self.advance(1);
                        return Some(Spanned::new(
                            Token::EscapedLBrace,
                            Span::new(start, self.cursor),
                        ));
                    }
                    '}' => {
                        self.advance(1);
                        return Some(Spanned::new(
                            Token::EscapedRBrace,
                            Span::new(start, self.cursor),
                        ));
                    }
                    '|' => {
                        self.advance(1);
                        return Some(Spanned::new(
                            Token::DoublePipe,
                            Span::new(start, self.cursor),
                        ));
                    }
                    ',' | ';' | '!' | ' ' => {
                        // 空格与微调间距
                        self.advance(next_c.len_utf8());
                        return Some(Spanned::new(
                            Token::Whitespace(&self.source[start..self.cursor]),
                            Span::new(start, self.cursor),
                        ));
                    }
                    _ if next_c.is_ascii_alphabetic() => {
                        // 消费连续英文字母作为宏名称
                        let word_start = self.cursor;
                        while let Some(c) = self.peek_char() {
                            if c.is_ascii_alphabetic() {
                                self.advance(1);
                            } else {
                                break;
                            }
                        }
                        let word = &self.source[word_start..self.cursor];
                        let span = Span::new(start, self.cursor);

                        // 精确分流匹配，严格消除 \left 与 \le 等前缀歧义
                        let token = match word {
                            // 核心命令
                            "left" => Token::CmdLeft,
                            "right" => Token::CmdRight,
                            "begin" => Token::CmdBegin,
                            "end" => Token::CmdEnd,
                            "frac" => Token::CmdFrac,
                            "sqrt" => Token::CmdSqrt,
                            "sum" => Token::CmdSum,
                            "int" => Token::CmdInt,
                            "iint" => Token::CmdIint,
                            "iiint" => Token::CmdIiint,
                            "oint" => Token::CmdOint,
                            "prod" => Token::CmdProd,
                            "lim" => Token::CmdLim,

                            // 定界符命令
                            "langle" => Token::AngleOpen,
                            "rangle" => Token::AngleClose,

                            // 关系符 (明确区分 left 与 le/leq)
                            "le" | "leq" => Token::Symbol(SymbolKind::Relation(r"\le".into())),
                            "ge" | "geq" => Token::Symbol(SymbolKind::Relation(r"\ge".into())),
                            "ne" | "neq" => Token::Symbol(SymbolKind::Relation(r"\ne".into())),
                            "approx" => Token::Symbol(SymbolKind::Relation(r"\approx".into())),
                            "sim" => Token::Symbol(SymbolKind::Relation(r"\sim".into())),
                            "in" => Token::Symbol(SymbolKind::Relation(r"\in".into())),
                            "notin" => Token::Symbol(SymbolKind::Relation(r"\notin".into())),
                            "subset" => Token::Symbol(SymbolKind::Relation(r"\subset".into())),
                            "supset" => Token::Symbol(SymbolKind::Relation(r"\supset".into())),

                            // 算子
                            "pm" => Token::Symbol(SymbolKind::Operator(r"\pm".into())),
                            "mp" => Token::Symbol(SymbolKind::Operator(r"\mp".into())),
                            "times" => Token::Symbol(SymbolKind::Operator(r"\times".into())),
                            "div" => Token::Symbol(SymbolKind::Operator(r"\div".into())),
                            "cdot" => Token::Symbol(SymbolKind::Operator(r"\cdot".into())),
                            "circ" => Token::Symbol(SymbolKind::Operator(r"\circ".into())),
                            "ast" => Token::Symbol(SymbolKind::Operator(r"\ast".into())),
                            "star" => Token::Symbol(SymbolKind::Operator(r"\star".into())),

                            // 标准数学函数算子 (ISO / AMS 规范)
                            "sin" | "cos" | "tan" | "cot" | "sec" | "csc" | "arcsin"
                            | "arccos" | "arctan" | "sinh" | "cosh" | "tanh" | "ln"
                            | "log" | "exp" | "det" | "gcd" | "deg" | "dim" | "ker"
                            | "hom" | "arg" | "min" | "max" | "sup" | "inf" => {
                                Token::Symbol(SymbolKind::Operator(format!(r"\{word}")))
                            }

                            // 箭头
                            "to" | "rightarrow" => Token::Symbol(SymbolKind::Arrow(r"\to".into())),
                            "leftarrow" => Token::Symbol(SymbolKind::Arrow(r"\leftarrow".into())),
                            "implies" | "Rightarrow" => {
                                Token::Symbol(SymbolKind::Arrow(r"\implies".into()))
                            }
                            "iff" | "Leftrightarrow" => {
                                Token::Symbol(SymbolKind::Arrow(r"\iff".into()))
                            }
                            "mapsto" => Token::Symbol(SymbolKind::Arrow(r"\mapsto".into())),

                            // 杂项符号
                            "infty" => Token::Symbol(SymbolKind::Misc(r"\infty".into())),
                            "partial" => Token::Symbol(SymbolKind::Misc(r"\partial".into())),
                            "nabla" => Token::Symbol(SymbolKind::Misc(r"\nabla".into())),
                            "forall" => Token::Symbol(SymbolKind::Misc(r"\forall".into())),
                            "exists" => Token::Symbol(SymbolKind::Misc(r"\exists".into())),
                            "emptyset" | "empty" => {
                                Token::Symbol(SymbolKind::Misc(r"\emptyset".into()))
                            }

                            // 样式宏
                            "mathrm" | "mathbf" | "mathit" | "mathcal" | "mathbb" | "mathfrak"
                            | "mathtt" | "mathsf" | "text" | "textbf" | "textrm" => {
                                Token::CmdStyle(word)
                            }

                            // 希腊字母
                            "alpha" | "beta" | "gamma" | "delta" | "epsilon" | "varepsilon"
                            | "zeta" | "eta" | "theta" | "vartheta" | "iota" | "kappa"
                            | "lambda" | "mu" | "nu" | "xi" | "pi" | "varpi" | "rho" | "varrho"
                            | "sigma" | "varsigma" | "tau" | "upsilon" | "phi" | "varphi"
                            | "chi" | "psi" | "omega" | "Gamma" | "Delta" | "Theta" | "Lambda"
                            | "Xi" | "Pi" | "Sigma" | "Upsilon" | "Phi" | "Psi" | "Omega" => {
                                Token::Symbol(SymbolKind::Greek(format!(r"\{word}")))
                            }

                            // 未知宏
                            _ => Token::RawMacro(word),
                        };

                        return Some(Spanned::new(token, span));
                    }
                    _ => {
                        // 孤立的反斜杠或其他转义
                        return Some(Spanned::new(
                            Token::Backslash,
                            Span::new(start, self.cursor),
                        ));
                    }
                }
            } else {
                return Some(Spanned::new(
                    Token::Backslash,
                    Span::new(start, self.cursor),
                ));
            }
        }

        // 4. 单字符定界符与操作符、数字、标识符
        let c = self.peek_char().unwrap();
        let char_len = c.len_utf8();

        match c {
            '{' => {
                self.advance(char_len);
                Some(Spanned::new(Token::LBrace, Span::new(start, self.cursor)))
            }
            '}' => {
                self.advance(char_len);
                Some(Spanned::new(Token::RBrace, Span::new(start, self.cursor)))
            }
            '(' => {
                self.advance(char_len);
                Some(Spanned::new(Token::LParen, Span::new(start, self.cursor)))
            }
            ')' => {
                self.advance(char_len);
                Some(Spanned::new(Token::RParen, Span::new(start, self.cursor)))
            }
            '[' => {
                self.advance(char_len);
                Some(Spanned::new(Token::LBracket, Span::new(start, self.cursor)))
            }
            ']' => {
                self.advance(char_len);
                Some(Spanned::new(Token::RBracket, Span::new(start, self.cursor)))
            }
            '|' => {
                self.advance(char_len);
                Some(Spanned::new(Token::Pipe, Span::new(start, self.cursor)))
            }
            '^' => {
                self.advance(char_len);
                Some(Spanned::new(Token::Caret, Span::new(start, self.cursor)))
            }
            '_' => {
                self.advance(char_len);
                Some(Spanned::new(
                    Token::Underscore,
                    Span::new(start, self.cursor),
                ))
            }
            '&' => {
                self.advance(char_len);
                Some(Spanned::new(
                    Token::Ampersand,
                    Span::new(start, self.cursor),
                ))
            }
            ';' => {
                self.advance(char_len);
                Some(Spanned::new(
                    Token::Semicolon,
                    Span::new(start, self.cursor),
                ))
            }
            '=' => {
                self.advance(char_len);
                Some(Spanned::new(Token::Equal, Span::new(start, self.cursor)))
            }
            '<' => {
                self.advance(char_len);
                Some(Spanned::new(
                    Token::Symbol(SymbolKind::Relation("<".to_string())),
                    Span::new(start, self.cursor),
                ))
            }
            '>' => {
                self.advance(char_len);
                Some(Spanned::new(
                    Token::Symbol(SymbolKind::Relation(">".to_string())),
                    Span::new(start, self.cursor),
                ))
            }
            '+' => {
                self.advance(char_len);
                Some(Spanned::new(Token::Plus, Span::new(start, self.cursor)))
            }
            '-' => {
                self.advance(char_len);
                Some(Spanned::new(Token::Minus, Span::new(start, self.cursor)))
            }
            '/' => {
                self.advance(char_len);
                Some(Spanned::new(Token::Slash, Span::new(start, self.cursor)))
            }
            '*' => {
                self.advance(char_len);
                Some(Spanned::new(Token::Asterisk, Span::new(start, self.cursor)))
            }
            ',' => {
                self.advance(char_len);
                Some(Spanned::new(Token::Comma, Span::new(start, self.cursor)))
            }
            ':' => {
                self.advance(char_len);
                Some(Spanned::new(Token::Colon, Span::new(start, self.cursor)))
            }
            '.' => {
                // 如果后面跟着数字，则整体作为数字解析，否则作为单字符 Token::Dot
                if let Some(next_c) = self.peek_char_at(char_len)
                    && next_c.is_ascii_digit()
                {
                    self.advance(char_len);
                    while let Some(digit) = self.peek_char() {
                        if digit.is_ascii_digit() {
                            self.advance(1);
                        } else {
                            break;
                        }
                    }
                    let span = Span::new(start, self.cursor);
                    return Some(Spanned::new(
                        Token::Number(&self.source[start..self.cursor]),
                        span,
                    ));
                }
                self.advance(char_len);
                Some(Spanned::new(Token::Dot, Span::new(start, self.cursor)))
            }
            '0'..='9' => {
                // 整数或带小数点的浮点数
                self.advance(char_len);
                while let Some(digit) = self.peek_char() {
                    if digit.is_ascii_digit() {
                        self.advance(1);
                    } else {
                        break;
                    }
                }
                if self.peek_char() == Some('.')
                    && let Some(next_c) = self.peek_char_at(1)
                    && next_c.is_ascii_digit()
                {
                    self.advance(1); // 消费 '.'
                    while let Some(digit) = self.peek_char() {
                        if digit.is_ascii_digit() {
                            self.advance(1);
                        } else {
                            break;
                        }
                    }
                }
                let span = Span::new(start, self.cursor);
                Some(Spanned::new(
                    Token::Number(&self.source[start..self.cursor]),
                    span,
                ))
            }
            'a'..='z' | 'A'..='Z' => {
                // 普通变量名或多字符标识符
                self.advance(char_len);
                while let Some(letter) = self.peek_char() {
                    if letter.is_ascii_alphabetic() {
                        self.advance(1);
                    } else {
                        break;
                    }
                }
                let span = Span::new(start, self.cursor);
                Some(Spanned::new(
                    Token::Ident(&self.source[start..self.cursor]),
                    span,
                ))
            }
            _ => {
                self.advance(char_len);
                Some(Spanned::new(
                    Token::UnknownChar(c),
                    Span::new(start, self.cursor),
                ))
            }
        }
    }
}

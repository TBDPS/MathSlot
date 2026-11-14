use crate::ast::{BigOpKind, Delim, Expr, MathStyle, MatrixEnv, SlotId, SymbolKind};
use crate::diagnostics::{Diagnostic, SyntaxErrorKind};
use crate::lexer::Lexer;
use crate::span::{Span, Spanned};
use crate::token::Token;

/// 递归下降解析器的最大嵌套深度，防止极端恶意/畸形输入导致栈溢出 (D-141 / D-020)
pub const MAX_PARSE_DEPTH: usize = 256;

/// 容错递归下降语法解析器
pub struct Parser<'a> {
    source: &'a str,
    tokens: Vec<Spanned<Token<'a>>>,
    cursor: usize,
    diagnostics: Vec<Diagnostic>,
    depth: usize,
    depth_exceeded: bool,
}

impl<'a> Parser<'a> {
    pub fn new(source: &'a str) -> Self {
        let tokens = Lexer::tokenize_filtered(source);
        Self {
            source,
            tokens,
            cursor: 0,
            diagnostics: Vec::new(),
            depth: 0,
            depth_exceeded: false,
        }
    }

    /// 顶层解析入口：将源码完全解析为 AST 表达式列表和结构化诊断信息
    pub fn parse(source: &'a str) -> (Vec<Spanned<Expr>>, Vec<Diagnostic>) {
        let mut parser = Self::new(source);
        let exprs = parser.parse_root();
        (exprs, parser.diagnostics)
    }

    fn peek(&self) -> Option<&Spanned<Token<'a>>> {
        self.tokens.get(self.cursor)
    }

    fn peek_token(&self) -> Option<&Token<'a>> {
        self.peek().map(|t| &t.node)
    }

    #[allow(dead_code)]
    fn peek_ahead(&self, n: usize) -> Option<&Spanned<Token<'a>>> {
        self.tokens.get(self.cursor + n)
    }

    fn current_span(&self) -> Span {
        self.peek()
            .map(|t| t.span)
            .unwrap_or_else(|| Span::point(self.source.len()))
    }

    fn prev_span(&self) -> Span {
        if self.cursor > 0 && self.cursor <= self.tokens.len() {
            self.tokens[self.cursor - 1].span
        } else {
            Span::point(0)
        }
    }

    fn is_eof(&self) -> bool {
        self.cursor >= self.tokens.len()
    }

    fn bump(&mut self) -> Option<Spanned<Token<'a>>> {
        if self.is_eof() {
            None
        } else {
            let tok = self.tokens[self.cursor].clone();
            self.cursor += 1;
            Some(tok)
        }
    }

    fn eat(&mut self, expected: &Token<'a>) -> bool {
        if let Some(tok) = self.peek_token()
            && tok == expected
        {
            self.cursor += 1;
            return true;
        }
        false
    }

    fn enter_depth(&mut self, span: Span) -> bool {
        if self.depth >= MAX_PARSE_DEPTH {
            if !self.depth_exceeded {
                self.depth_exceeded = true;
                self.diagnostics.push(Diagnostic::error(
                    SyntaxErrorKind::DepthExceeded(MAX_PARSE_DEPTH),
                    span,
                ));
            }
            return false;
        }
        self.depth += 1;
        true
    }

    fn leave_depth(&mut self) {
        self.depth = self.depth.saturating_sub(1);
    }

    fn consume_depth_overflow(&mut self, start_span: Span) -> Option<Spanned<Expr>> {
        let mut braces = 0usize;
        let mut parens = 0usize;
        let mut brackets = 0usize;
        let mut envs = 0usize;
        let mut lefts = 0usize;
        let mut last_span = start_span;
        let mut consumed = false;

        while let Some(tok) = self.peek() {
            match &tok.node {
                Token::LBrace => braces += 1,
                Token::RBrace => {
                    if braces == 0 {
                        break;
                    }
                    braces -= 1;
                }
                Token::LParen => parens += 1,
                Token::RParen => {
                    if parens == 0 {
                        break;
                    }
                    parens -= 1;
                }
                Token::LBracket => brackets += 1,
                Token::RBracket => {
                    if brackets == 0 {
                        break;
                    }
                    brackets -= 1;
                }
                Token::CmdBegin => envs += 1,
                Token::CmdEnd => {
                    if envs == 0 {
                        break;
                    }
                    envs -= 1;
                }
                Token::CmdLeft => lefts += 1,
                Token::CmdRight => {
                    if lefts == 0 {
                        break;
                    }
                    lefts -= 1;
                }
                _ => {}
            }
            last_span = tok.span;
            self.cursor += 1;
            consumed = true;
        }

        if !consumed {
            return None;
        }

        let span = start_span.merge(last_span);
        Some(Spanned::new(
            Expr::Error {
                message: format!("Maximum nesting depth ({MAX_PARSE_DEPTH}) exceeded"),
                raw: self.source[span.start..span.end].to_string(),
            },
            span,
        ))
    }

    fn expect(
        &mut self,
        expected: &Token<'a>,
        expected_desc: &str,
    ) -> Result<Spanned<Token<'a>>, Diagnostic> {
        if let Some(tok) = self.peek().cloned() {
            if &tok.node == expected {
                self.cursor += 1;
                return Ok(tok);
            }
            let err = Diagnostic::error(
                SyntaxErrorKind::ExpectedToken {
                    expected: expected_desc.to_string(),
                    found: format!("{:?} (expected {})", tok.node, expected_desc),
                },
                tok.span,
            );
            self.diagnostics.push(err.clone());
            Err(err)
        } else {
            let err = Diagnostic::error(
                SyntaxErrorKind::ExpectedToken {
                    expected: expected_desc.to_string(),
                    found: format!("end of file (expected {})", expected_desc),
                },
                Span::point(self.source.len()),
            );
            self.diagnostics.push(err.clone());
            Err(err)
        }
    }

    // ------------------------------------------------------------------------
    // 解析主流程
    // ------------------------------------------------------------------------

    pub fn parse_root(&mut self) -> Vec<Spanned<Expr>> {
        let mut exprs = Vec::new();
        while !self.is_eof() {
            if let Some(expr) = self.parse_expr_unit() {
                exprs.push(expr);
            } else {
                // 若无法解析任何有效单元，消费破损 Token 并记录 Error 诊断防止死循环与静默吞错
                let Some(broken) = self.bump() else {
                    break;
                };
                let raw = self.source[broken.span.start..broken.span.end].to_string();
                let diag = match &broken.node {
                    Token::RBrace
                    | Token::RBracket
                    | Token::RParen
                    | Token::FloorClose
                    | Token::CeilClose
                    | Token::CmdRight
                    | Token::CmdEnd => Diagnostic::unmatched_delimiter(&raw, broken.span),
                    _ => Diagnostic::error(
                        SyntaxErrorKind::UnexpectedToken(raw.clone()),
                        broken.span,
                    ),
                };
                self.diagnostics.push(diag);
                let err_expr = Spanned::new(
                    Expr::Error {
                        message: format!("Unexpected token: {:?}", broken.node),
                        raw,
                    },
                    broken.span,
                );
                exprs.push(err_expr);
            }
        }
        exprs
    }

    /// 解析一个完整的表达式单元（Atom + 后置脚本 ^/_）
    pub fn parse_expr_unit(&mut self) -> Option<Spanned<Expr>> {
        let span = self.current_span();
        if !self.enter_depth(span) {
            return self.consume_depth_overflow(span);
        }
        let res = self
            .parse_atom()
            .map(|atom| self.parse_postfix_scripts(atom));
        self.leave_depth();
        res
    }

    /// 循环处理后置脚本 ^ 与 _（彻底消灭旧版的单字符推断与结合律错误）
    fn parse_postfix_scripts(&mut self, base: Spanned<Expr>) -> Spanned<Expr> {
        let mut sub: Option<Box<Spanned<Expr>>> = None;
        let mut sup: Option<Box<Spanned<Expr>>> = None;

        while let Some(tok) = self.peek_token() {
            match tok {
                Token::Caret => {
                    self.bump();
                    let arg = self.parse_script_arg();
                    sup = Some(Box::new(arg));
                }
                Token::Underscore => {
                    self.bump();
                    let arg = self.parse_script_arg();
                    sub = Some(Box::new(arg));
                }
                _ => break,
            }
        }

        if sub.is_some() || sup.is_some() {
            let start = base.span.start;
            let end = sup
                .as_ref()
                .map(|s| s.span.end)
                .or_else(|| sub.as_ref().map(|s| s.span.end))
                .unwrap_or(base.span.end);
            Spanned::new(
                Expr::Script {
                    base: Box::new(base),
                    sub,
                    sup,
                },
                Span::new(start, end),
            )
        } else {
            base
        }
    }

    /// 解析上下标参数：支持 {...} 分组、一元负号复合项、分数、单字符/符号
    fn parse_script_arg(&mut self) -> Spanned<Expr> {
        let Some(first_tok) = self.peek_token() else {
            let span = Span::point(self.source.len());
            return Spanned::new(
                Expr::Placeholder {
                    slot_id: SlotId(0),
                    label: None,
                },
                span,
            );
        };

        match first_tok {
            Token::LBrace => self.parse_group(),
            Token::Minus => {
                // 一元负号复合项，例如 e^-x^2
                let Some(minus_tok) = self.bump() else {
                    let span = self.current_span();
                    return Spanned::new(
                        Expr::Placeholder {
                            slot_id: SlotId(0),
                            label: None,
                        },
                        span,
                    );
                };
                let minus_expr = Spanned::new(
                    Expr::Symbol(SymbolKind::Operator("-".to_string())),
                    minus_tok.span,
                );
                if let Some(operand) = self.parse_expr_unit() {
                    let span = minus_tok.span.merge(operand.span);
                    Spanned::new(Expr::Group(vec![minus_expr, operand]), span)
                } else {
                    minus_expr
                }
            }
            _ => {
                // 单个原子（单字符、单数字或单个符号）
                self.parse_atom_no_scripts().unwrap_or_else(|| {
                    let span = self.current_span();
                    Spanned::new(
                        Expr::Placeholder {
                            slot_id: SlotId(0),
                            label: None,
                        },
                        span,
                    )
                })
            }
        }
    }

    /// 解析原子节点（不带后置脚本）
    fn parse_atom_no_scripts(&mut self) -> Option<Spanned<Expr>> {
        let tok_spanned = self.peek()?.clone();
        if !self.enter_depth(tok_spanned.span) {
            return self.consume_depth_overflow(tok_spanned.span);
        }
        let res = match &tok_spanned.node {
            Token::Ident(s) => {
                self.bump();
                Some(Spanned::new(Expr::Text((*s).to_string()), tok_spanned.span))
            }
            Token::Number(s) => {
                self.bump();
                Some(Spanned::new(Expr::Text((*s).to_string()), tok_spanned.span))
            }
            Token::Symbol(sym) => {
                self.bump();
                Some(Spanned::new(Expr::Symbol(sym.clone()), tok_spanned.span))
            }
            Token::LBrace => Some(self.parse_group()),
            Token::CmdFrac => Some(self.parse_fraction()),
            Token::CmdSqrt => Some(self.parse_sqrt()),
            Token::CmdLeft => Some(self.parse_delimited()),
            Token::CmdBegin => Some(self.parse_matrix()),
            Token::CmdStyle(style) => {
                let style_name = *style;
                self.bump();
                Some(self.parse_style_command(style_name, tok_spanned.span))
            }
            Token::RawMacro(name) => {
                let macro_name = *name;
                self.bump();
                Some(self.parse_unknown_macro(macro_name, tok_spanned.span))
            }
            Token::LeadTriangle => {
                self.bump();
                Some(Spanned::new(
                    Expr::Placeholder {
                        slot_id: SlotId(0),
                        label: None,
                    },
                    tok_spanned.span,
                ))
            }
            _ => None,
        };
        self.leave_depth();
        res
    }

    /// 解析普通原子节点
    fn parse_atom(&mut self) -> Option<Spanned<Expr>> {
        if self.is_eof() {
            return None;
        }

        let tok_spanned = self.peek()?.clone();
        match &tok_spanned.node {
            Token::Ident(s) => {
                self.bump();
                Some(Spanned::new(Expr::Text((*s).to_string()), tok_spanned.span))
            }
            Token::Number(s) => {
                self.bump();
                Some(Spanned::new(Expr::Text((*s).to_string()), tok_spanned.span))
            }
            Token::Symbol(sym) => {
                self.bump();
                Some(Spanned::new(Expr::Symbol(sym.clone()), tok_spanned.span))
            }
            Token::Equal => {
                self.bump();
                Some(Spanned::new(
                    Expr::Symbol(SymbolKind::Relation("=".to_string())),
                    tok_spanned.span,
                ))
            }
            Token::Plus => {
                self.bump();
                Some(Spanned::new(
                    Expr::Symbol(SymbolKind::Operator("+".to_string())),
                    tok_spanned.span,
                ))
            }
            Token::Minus => {
                self.bump();
                Some(Spanned::new(
                    Expr::Symbol(SymbolKind::Operator("-".to_string())),
                    tok_spanned.span,
                ))
            }
            Token::Slash => {
                self.bump();
                Some(Spanned::new(
                    Expr::Symbol(SymbolKind::Operator("/".to_string())),
                    tok_spanned.span,
                ))
            }
            Token::Asterisk => {
                self.bump();
                Some(Spanned::new(
                    Expr::Symbol(SymbolKind::Operator("*".to_string())),
                    tok_spanned.span,
                ))
            }
            Token::Comma => {
                self.bump();
                Some(Spanned::new(Expr::Text(",".to_string()), tok_spanned.span))
            }
            Token::Semicolon => {
                self.bump();
                Some(Spanned::new(Expr::Text(";".to_string()), tok_spanned.span))
            }
            Token::Colon => {
                self.bump();
                Some(Spanned::new(Expr::Text(":".to_string()), tok_spanned.span))
            }
            Token::Dot => {
                self.bump();
                Some(Spanned::new(Expr::Text(".".to_string()), tok_spanned.span))
            }
            Token::LBrace => Some(self.parse_group()),
            Token::LParen => Some(self.parse_bare_delimited(Delim::Paren, &Token::RParen)),
            Token::LBracket => Some(self.parse_bare_delimited(Delim::Bracket, &Token::RBracket)),
            Token::Pipe => Some(self.parse_bare_delimited(Delim::Pipe, &Token::Pipe)),
            Token::DoublePipe => {
                Some(self.parse_bare_delimited(Delim::DoublePipe, &Token::DoublePipe))
            }
            Token::FloorOpen => Some(self.parse_bare_delimited(Delim::Floor, &Token::FloorClose)),
            Token::CeilOpen => Some(self.parse_bare_delimited(Delim::Ceil, &Token::CeilClose)),
            Token::CmdFrac => Some(self.parse_fraction()),
            Token::CmdSqrt => Some(self.parse_sqrt()),
            Token::CmdSum => Some(self.parse_big_operator(BigOpKind::Sum, tok_spanned.span)),
            Token::CmdInt => Some(self.parse_big_operator(BigOpKind::Integral, tok_spanned.span)),
            Token::CmdIint => {
                Some(self.parse_big_operator(BigOpKind::DoubleIntegral, tok_spanned.span))
            }
            Token::CmdIiint => {
                Some(self.parse_big_operator(BigOpKind::TripleIntegral, tok_spanned.span))
            }
            Token::CmdOint => {
                Some(self.parse_big_operator(BigOpKind::ContourIntegral, tok_spanned.span))
            }
            Token::CmdProd => Some(self.parse_big_operator(BigOpKind::Product, tok_spanned.span)),
            Token::CmdLim => Some(self.parse_big_operator(BigOpKind::Limit, tok_spanned.span)),
            Token::CmdLeft => Some(self.parse_delimited()),
            Token::CmdBegin => Some(self.parse_matrix()),
            Token::CmdStyle(style) => {
                let style_name = *style;
                self.bump();
                Some(self.parse_style_command(style_name, tok_spanned.span))
            }
            Token::RawMacro(name) => {
                let macro_name = *name;
                self.bump();
                Some(self.parse_unknown_macro(macro_name, tok_spanned.span))
            }
            Token::LeadTriangle => {
                // 孤立的简码三角符
                self.bump();
                Some(Spanned::new(
                    Expr::Placeholder {
                        slot_id: SlotId(0),
                        label: None,
                    },
                    tok_spanned.span,
                ))
            }
            Token::UnknownChar(c) => {
                let char_str = c.to_string();
                self.bump();
                Some(Spanned::new(Expr::Text(char_str), tok_spanned.span))
            }
            _ => None,
        }
    }

    // ------------------------------------------------------------------------
    // 子结构解析：花括号分组、定界符、大算子、分式、根号、矩阵、未知宏
    // ------------------------------------------------------------------------

    /// 解析花括号分组 { ... }
    fn parse_group(&mut self) -> Spanned<Expr> {
        let Some(open_tok) = self.bump() else {
            return Spanned::new(Expr::Group(Vec::new()), self.current_span());
        };
        let mut body = Vec::new();

        while !self.is_eof() {
            if let Some(tok) = self.peek_token()
                && tok == &Token::RBrace
            {
                break;
            }
            if let Some(expr) = self.parse_expr_unit() {
                body.push(expr);
            } else {
                break;
            }
        }

        let end_span = if self.eat(&Token::RBrace) {
            self.prev_span()
        } else {
            self.diagnostics
                .push(Diagnostic::unclosed_delimiter("}", open_tok.span));
            open_tok.span
        };

        let span = open_tok.span.merge(end_span);
        Spanned::new(Expr::Group(body), span)
    }

    /// 解析裸括号 ( ... ) / [ ... ] / | ... |
    fn parse_bare_delimited(&mut self, delim: Delim, close_tok: &Token<'a>) -> Spanned<Expr> {
        let Some(open_spanned) = self.bump() else {
            return Spanned::new(Expr::Group(Vec::new()), self.current_span());
        };
        let mut body = Vec::new();

        while !self.is_eof() {
            if let Some(tok) = self.peek_token()
                && tok == close_tok
            {
                break;
            }
            if let Some(expr) = self.parse_expr_unit() {
                body.push(expr);
            } else {
                break;
            }
        }

        let end_span = if self.eat(close_tok) {
            self.prev_span()
        } else {
            self.diagnostics.push(Diagnostic::unclosed_delimiter(
                delim.close_latex(),
                open_spanned.span,
            ));
            open_spanned.span
        };

        let span = open_spanned.span.merge(end_span);
        Spanned::new(
            Expr::Delimited {
                open: delim,
                close: delim,
                body,
                auto_scale: false,
            },
            span,
        )
    }

    /// 解析 \left ... \right 定界符节点（彻底切断 \left 与 \le 混淆）
    fn parse_delimited(&mut self) -> Spanned<Expr> {
        let Some(left_tok) = self.bump() else {
            return Spanned::new(Expr::Group(Vec::new()), self.current_span());
        };

        // 读取左定界符
        let (open_delim, open_span) = self.parse_single_delim_token();
        let mut body = Vec::new();

        // 持续消费 body，直到遇到 \right 或 EOF
        while !self.is_eof() {
            if let Some(tok) = self.peek_token()
                && tok == &Token::CmdRight
            {
                break;
            }
            if let Some(expr) = self.parse_expr_unit() {
                body.push(expr);
            } else {
                break;
            }
        }

        let (close_delim, close_span) = if self.eat(&Token::CmdRight) {
            self.parse_single_delim_token()
        } else {
            self.diagnostics
                .push(Diagnostic::unclosed_delimiter(r"\right", left_tok.span));
            (open_delim, left_tok.span)
        };

        let span = left_tok.span.merge(close_span).merge(open_span);
        Spanned::new(
            Expr::Delimited {
                open: open_delim,
                close: close_delim,
                body,
                auto_scale: true,
            },
            span,
        )
    }

    /// 提取紧随 \left 或 \right 之后的单个定界符
    fn parse_single_delim_token(&mut self) -> (Delim, Span) {
        if let Some(tok) = self.peek() {
            let span = tok.span;
            let delim = match &tok.node {
                Token::LParen | Token::RParen => Delim::Paren,
                Token::LBracket | Token::RBracket => Delim::Bracket,
                Token::EscapedLBrace | Token::EscapedRBrace => Delim::Brace,
                Token::Pipe => Delim::Pipe,
                Token::DoublePipe => Delim::DoublePipe,
                Token::AngleOpen | Token::AngleClose => Delim::Angle,
                Token::FloorOpen | Token::FloorClose => Delim::Floor,
                Token::CeilOpen | Token::CeilClose => Delim::Ceil,
                Token::Dot => Delim::Empty,
                _ => Delim::Empty,
            };
            self.bump();
            (delim, span)
        } else {
            (Delim::Empty, self.current_span())
        }
    }

    /// 解析大算子节点：\sum, \int, \lim 等（GT-01, GT-04, GT-05 关键防线）
    fn parse_big_operator(&mut self, kind: BigOpKind, start_span: Span) -> Spanned<Expr> {
        self.bump(); // 消费命令标记

        let mut lower: Option<Vec<Spanned<Expr>>> = None;
        let mut upper: Option<Vec<Spanned<Expr>>> = None;

        // 循环捕获上下标（任意顺序）
        while let Some(tok) = self.peek_token() {
            match tok {
                Token::Underscore => {
                    self.bump();
                    let arg = self.parse_script_arg();
                    lower = Some(match arg.node {
                        Expr::Group(items) => items,
                        other => vec![Spanned::new(other, arg.span)],
                    });
                }
                Token::Caret => {
                    self.bump();
                    let arg = self.parse_script_arg();
                    upper = Some(match arg.node {
                        Expr::Group(items) => items,
                        other => vec![Spanned::new(other, arg.span)],
                    });
                }
                _ => break,
            }
        }

        // 贪婪捕获大算子主体 body
        // 关键防线：遇到 =、低级关系符、环境结束或外层闭合时停止；遇到 \left 完整消费
        let mut body = Vec::new();
        while !self.is_eof() {
            if let Some(tok) = self.peek_token() {
                if tok.is_big_operator() {
                    break;
                }
                match tok {
                    Token::Equal
                    | Token::CmdEnd
                    | Token::RParen
                    | Token::RBracket
                    | Token::RBrace
                    | Token::FloorClose
                    | Token::CeilClose
                    | Token::Ampersand
                    | Token::DoubleBackslash
                    | Token::CmdRight => break,
                    // 遇到关系符，大算子主体结束（如 = \sqrt{\pi}）
                    Token::Symbol(SymbolKind::Relation(_)) => break,
                    _ => {}
                }
            }

            if let Some(expr) = self.parse_expr_unit() {
                body.push(expr);
            } else {
                break;
            }
        }

        let end_span = body
            .last()
            .map(|e| e.span)
            .or_else(|| upper.as_ref().and_then(|u| u.last().map(|e| e.span)))
            .or_else(|| lower.as_ref().and_then(|l| l.last().map(|e| e.span)))
            .unwrap_or(start_span);

        let span = start_span.merge(end_span);
        Spanned::new(
            Expr::BigOperator {
                kind,
                lower,
                upper,
                body,
            },
            span,
        )
    }

    /// 解析宏单参数（如 \frac、\sqrt 的无花括号参数）
    /// 遇到多字符数字/标识符时，按 TeX 规范消费首字符，并将剩余切片保留在当前 Token
    fn parse_unbraced_macro_arg(&mut self) -> Vec<Spanned<Expr>> {
        if self.is_eof() {
            return Vec::new();
        }

        if self.peek_token() == Some(&Token::Semicolon) {
            self.bump();
            return Vec::new();
        }

        if let Some(spanned_tok) = self.peek() {
            let (is_splittable, s_val) = match &spanned_tok.node {
                Token::Number(s) if s.chars().count() > 1 => (true, *s),
                Token::Ident(s) if s.chars().count() > 1 => (true, *s),
                _ => (false, ""),
            };

            if is_splittable && let Some(first_char) = s_val.chars().next() {
                let char_len = first_char.len_utf8();
                let first_slice = &s_val[..char_len];
                let rem_slice = &s_val[char_len..];

                let start = spanned_tok.span.start;
                let first_span = Span::new(start, start + char_len);
                let rem_span = Span::new(start + char_len, spanned_tok.span.end);

                let is_number = matches!(spanned_tok.node, Token::Number(_));
                self.tokens[self.cursor] = Spanned::new(
                    if is_number {
                        Token::Number(rem_slice)
                    } else {
                        Token::Ident(rem_slice)
                    },
                    rem_span,
                );

                return vec![Spanned::new(
                    Expr::Text(first_slice.to_string()),
                    first_span,
                )];
            }
        }

        if let Some(expr) = self.parse_atom_no_scripts() {
            vec![expr]
        } else {
            Vec::new()
        }
    }

    /// 解析分数节点 \frac{num}{den} 或 ▸f
    fn parse_fraction(&mut self) -> Spanned<Expr> {
        let Some(start_spanned) = self.bump() else {
            return Spanned::new(Expr::Group(Vec::new()), self.current_span());
        };

        // 解析分子
        let num_lbrace_span = self.peek().map(|t| t.span);
        let num = if self.eat(&Token::LBrace) {
            let mut items = Vec::new();
            while !self.is_eof() && self.peek_token() != Some(&Token::RBrace) {
                if let Some(expr) = self.parse_expr_unit() {
                    items.push(expr);
                } else {
                    break;
                }
            }
            if !self.eat(&Token::RBrace) {
                self.diagnostics.push(Diagnostic::unclosed_delimiter(
                    "}",
                    num_lbrace_span.unwrap_or(start_spanned.span),
                ));
            }
            items
        } else {
            self.parse_unbraced_macro_arg()
        };

        // 解析分母
        let den_lbrace_span = self.peek().map(|t| t.span);
        let den = if self.eat(&Token::LBrace) {
            let mut items = Vec::new();
            while !self.is_eof() && self.peek_token() != Some(&Token::RBrace) {
                if let Some(expr) = self.parse_expr_unit() {
                    items.push(expr);
                } else {
                    break;
                }
            }
            if !self.eat(&Token::RBrace) {
                self.diagnostics.push(Diagnostic::unclosed_delimiter(
                    "}",
                    den_lbrace_span.unwrap_or(start_spanned.span),
                ));
            }
            items
        } else {
            self.parse_unbraced_macro_arg()
        };

        let end_span = den
            .last()
            .map(|e| e.span)
            .or_else(|| num.last().map(|e| e.span))
            .unwrap_or(start_spanned.span);

        let span = start_spanned.span.merge(end_span);
        Spanned::new(Expr::Fraction { num, den }, span)
    }

    /// 解析根号节点 \sqrt[index]{radicand} 或 \sqrt{radicand}
    fn parse_sqrt(&mut self) -> Spanned<Expr> {
        let Some(start_spanned) = self.bump() else {
            return Spanned::new(Expr::Group(Vec::new()), self.current_span());
        };

        // 探测可选方括号根指数 [index]
        let index_lbracket_span = self.peek().map(|t| t.span);
        let index = if self.eat(&Token::LBracket) {
            let mut items = Vec::new();
            while !self.is_eof() && self.peek_token() != Some(&Token::RBracket) {
                if let Some(expr) = self.parse_expr_unit() {
                    items.push(expr);
                } else {
                    break;
                }
            }
            if !self.eat(&Token::RBracket) {
                self.diagnostics.push(Diagnostic::unclosed_delimiter(
                    "]",
                    index_lbracket_span.unwrap_or(start_spanned.span),
                ));
            }
            Some(items)
        } else {
            None
        };

        // 解析被开方数
        let rad_lbrace_span = self.peek().map(|t| t.span);
        let radicand = if self.eat(&Token::LBrace) {
            let mut items = Vec::new();
            while !self.is_eof() && self.peek_token() != Some(&Token::RBrace) {
                if let Some(expr) = self.parse_expr_unit() {
                    items.push(expr);
                } else {
                    break;
                }
            }
            if !self.eat(&Token::RBrace) {
                self.diagnostics.push(Diagnostic::unclosed_delimiter(
                    "}",
                    rad_lbrace_span.unwrap_or(start_spanned.span),
                ));
            }
            items
        } else {
            self.parse_unbraced_macro_arg()
        };

        let end_span = radicand
            .last()
            .map(|e| e.span)
            .unwrap_or(start_spanned.span);

        let span = start_spanned.span.merge(end_span);
        Spanned::new(Expr::Root { index, radicand }, span)
    }

    /// 解析矩阵环境（GT-06, GT-07 关键防线：& 与 \\ 严格隔离；未知环境绝不强转为 matrix）
    fn parse_matrix(&mut self) -> Spanned<Expr> {
        let Some(start_spanned) = self.bump() else {
            return Spanned::new(Expr::Group(Vec::new()), self.current_span());
        };

        // 期望 `{`
        if self.expect(&Token::LBrace, "{").is_err() {
            let span = start_spanned.span.merge(self.prev_span());
            return Spanned::new(
                Expr::Error {
                    message: "Expected '{' after \\begin".to_string(),
                    raw: self.source[span.start..span.end].to_string(),
                },
                span,
            );
        }

        let env_name = match self.peek().cloned() {
            Some(tok) => match tok.node {
                Token::Ident(name) => {
                    self.bump();
                    Some(name)
                }
                _ => {
                    self.diagnostics.push(Diagnostic::error(
                        SyntaxErrorKind::ExpectedToken {
                            expected: "environment name".to_string(),
                            found: format!("{:?}", tok.node),
                        },
                        tok.span,
                    ));
                    None
                }
            },
            None => {
                self.diagnostics.push(Diagnostic::error(
                    SyntaxErrorKind::ExpectedToken {
                        expected: "environment name".to_string(),
                        found: "end of file".to_string(),
                    },
                    Span::point(self.source.len()),
                ));
                None
            }
        };

        if self.expect(&Token::RBrace, "}").is_err() {
            let end_span = self.prev_span();
            let span = start_spanned.span.merge(end_span);
            if let Some(name) = env_name {
                self.diagnostics
                    .push(Diagnostic::unclosed_env(name, start_spanned.span));
            }
            return Spanned::new(
                Expr::Error {
                    message: "Unclosed \\begin{...}".to_string(),
                    raw: self.source[span.start..span.end].to_string(),
                },
                span,
            );
        }

        let Some(env_name) = env_name else {
            let span = start_spanned.span.merge(self.prev_span());
            return Spanned::new(
                Expr::Error {
                    message: "Missing environment name after \\begin".to_string(),
                    raw: self.source[span.start..span.end].to_string(),
                },
                span,
            );
        };

        let Some(env) = MatrixEnv::from_latex_name(env_name) else {
            return self.parse_unsupported_environment(env_name, start_spanned.span);
        };

        let mut rows = Vec::new();
        let mut current_row: Vec<Vec<Spanned<Expr>>> = Vec::new();
        let mut current_cell: Vec<Spanned<Expr>> = Vec::new();

        while !self.is_eof() {
            if let Some(tok) = self.peek_token()
                && tok == &Token::CmdEnd
            {
                break;
            }

            if self.eat(&Token::Ampersand) {
                // 列分隔符：结束当前单元格
                current_row.push(current_cell);
                current_cell = Vec::new();
            } else if self.eat(&Token::DoubleBackslash) {
                // 行分隔符：结束当前单元格并结束当前行
                current_row.push(current_cell);
                rows.push(current_row);
                current_row = Vec::new();
                current_cell = Vec::new();
            } else if let Some(expr) = self.parse_expr_unit() {
                current_cell.push(expr);
            } else {
                break;
            }
        }

        // 收尾处理末尾非空单元格和行
        if !current_cell.is_empty() || !current_row.is_empty() {
            current_row.push(current_cell);
            rows.push(current_row);
        }

        // 消费 `\end{...}`
        let end_span = if self.eat(&Token::CmdEnd) {
            let end_cmd_span = self.prev_span();
            let has_lbrace = self.expect(&Token::LBrace, "{").is_ok();
            match self.peek().cloned() {
                Some(tok) => match tok.node {
                    Token::Ident(found_name) => {
                        self.bump();
                        if found_name != env_name {
                            self.diagnostics
                                .push(Diagnostic::mismatched_env(env_name, found_name, tok.span));
                        }
                    }
                    _ => {
                        let found = &self.source[tok.span.start..tok.span.end];
                        self.diagnostics
                            .push(Diagnostic::mismatched_env(env_name, found, tok.span));
                    }
                },
                None => {
                    self.diagnostics
                        .push(Diagnostic::unclosed_env(env_name, end_cmd_span));
                }
            }
            if has_lbrace {
                match self.expect(&Token::RBrace, "}") {
                    Ok(tok) => tok.span,
                    Err(_) => self.prev_span(),
                }
            } else {
                self.prev_span()
            }
        } else {
            self.diagnostics
                .push(Diagnostic::unclosed_env(env_name, start_spanned.span));
            start_spanned.span
        };

        let span = start_spanned.span.merge(end_span);
        Spanned::new(Expr::Matrix { env, rows }, span)
    }

    /// 处理未纳入 MatrixEnv 白名单的环境（如 align/equation/gather/array）：
    /// - 完整成对闭合 -> 保留原始 LaTeX 为 Expr::RawLatex 并注入 Warning (UnsupportedEnvironment)
    /// - 未闭合或环境名不匹配 -> 注入 Error 诊断 (UnclosedEnvironment / MismatchedEnvironment)
    fn parse_unsupported_environment(
        &mut self,
        env_name: &'a str,
        start_span: Span,
    ) -> Spanned<Expr> {
        let mut env_depth = 1usize;

        while let Some(tok) = self.peek().cloned() {
            match &tok.node {
                Token::CmdBegin => {
                    self.bump();
                    if self.eat(&Token::LBrace) {
                        if matches!(self.peek_token(), Some(Token::Ident(_))) {
                            self.bump();
                        }
                        self.eat(&Token::RBrace);
                    }
                    env_depth += 1;
                }
                Token::CmdEnd => {
                    let end_cmd_span = tok.span;
                    self.bump();
                    let has_lbrace = self.expect(&Token::LBrace, "{").is_ok();
                    let found_name = match self.peek().cloned() {
                        Some(name_tok) => match name_tok.node {
                            Token::Ident(name) => {
                                self.bump();
                                Some((name, name_tok.span))
                            }
                            _ => None,
                        },
                        None => None,
                    };
                    if has_lbrace && self.expect(&Token::RBrace, "}").is_err() {
                        self.diagnostics
                            .push(Diagnostic::unclosed_env(env_name, end_cmd_span));
                    }

                    if env_depth == 1 {
                        let span = start_span.merge(self.prev_span());
                        let raw = self.source[span.start..span.end].to_string();
                        match found_name {
                            Some((found, _)) if found == env_name => {
                                self.diagnostics
                                    .push(Diagnostic::unsupported_env(env_name, span));
                                return Spanned::new(
                                    Expr::RawLatex {
                                        latex: raw,
                                        warning: Some(format!(
                                            "Unsupported environment \\begin{{{env_name}}}"
                                        )),
                                    },
                                    span,
                                );
                            }
                            Some((found, found_span)) => {
                                self.diagnostics
                                    .push(Diagnostic::mismatched_env(env_name, found, found_span));
                                return Spanned::new(
                                    Expr::Error {
                                        message: format!(
                                            "Mismatched environment: expected \\end{{{env_name}}}, found \\end{{{found}}}"
                                        ),
                                        raw,
                                    },
                                    span,
                                );
                            }
                            None => {
                                self.diagnostics
                                    .push(Diagnostic::unclosed_env(env_name, end_cmd_span));
                                return Spanned::new(
                                    Expr::Error {
                                        message: format!("Unclosed environment: {env_name}"),
                                        raw,
                                    },
                                    span,
                                );
                            }
                        }
                    }
                    env_depth = env_depth.saturating_sub(1);
                }
                _ => {
                    self.bump();
                }
            }
        }

        let span = Span::new(start_span.start, self.source.len());
        self.diagnostics
            .push(Diagnostic::unclosed_env(env_name, start_span));
        Spanned::new(
            Expr::Error {
                message: format!("Unclosed environment: {env_name}"),
                raw: self.source[span.start..span.end].to_string(),
            },
            span,
        )
    }

    /// 解析样式命令：\mathrm{...}, \mathbf{...}, \text{...}
    fn parse_style_command(&mut self, style: &'a str, start_span: Span) -> Spanned<Expr> {
        let mut inner = Vec::new();
        let lbrace_span = self.peek().map(|t| t.span);
        if self.eat(&Token::LBrace) {
            while !self.is_eof() && self.peek_token() != Some(&Token::RBrace) {
                if let Some(expr) = self.parse_expr_unit() {
                    inner.push(expr);
                } else {
                    break;
                }
            }
            if !self.eat(&Token::RBrace) {
                self.diagnostics.push(Diagnostic::unclosed_delimiter(
                    "}",
                    lbrace_span.unwrap_or(start_span),
                ));
            }
        } else if let Some(atom) = self.parse_atom_no_scripts() {
            inner.push(atom);
        }

        let end_span = self.prev_span();
        let span = start_span.merge(end_span);

        if let Some(math_style) = MathStyle::from_cmd(style) {
            Spanned::new(
                Expr::Style {
                    style: math_style,
                    body: inner,
                },
                span,
            )
        } else {
            Spanned::new(Expr::Group(inner), span)
        }
    }

    /// 解析未知 LaTeX 宏，安全兜底为 Expr::RawLatex 并注入 warning（GT-08 关键防线）
    fn parse_unknown_macro(&mut self, name: &'a str, start_span: Span) -> Spanned<Expr> {
        let macro_start = start_span.start;
        let mut macro_end = start_span.end;

        // 若未知宏后紧跟 {...} 参数，以大括号深度平衡完整吞入；未闭合时保留文本并记录 Error
        if let Some(tok) = self.peek()
            && tok.node == Token::LBrace
        {
            let lbrace_span = tok.span;
            let mut depth = 0usize;
            while let Some(cur) = self.bump() {
                macro_end = cur.span.end;
                if cur.node == Token::LBrace {
                    depth += 1;
                } else if cur.node == Token::RBrace {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        break;
                    }
                }
            }
            if depth > 0 {
                self.diagnostics
                    .push(Diagnostic::unclosed_delimiter("}", lbrace_span));
            }
        }

        let raw_latex = self.source[macro_start..macro_end].to_string();
        let span = Span::new(macro_start, macro_end);

        self.diagnostics.push(Diagnostic::unknown_macro(name, span));

        Spanned::new(
            Expr::RawLatex {
                latex: raw_latex,
                warning: Some(format!("Unknown macro \\{name}")),
            },
            span,
        )
    }
}

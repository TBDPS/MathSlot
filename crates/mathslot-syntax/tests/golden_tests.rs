use mathslot_syntax::{BigOpKind, Delim, Expr, MathStyle, MatrixEnv, SymbolKind, parse, to_latex};

/// GT-01: 高斯积分与嵌套幂次
/// 断言：body 包含幂次正确的 Script 结构，往返绝无 e^{-x}^{2}
#[test]
fn test_gt01_gaussian_integral_script_nesting() {
    let input = r"\int_{-\infty}^{\infty} {e}^{-x^{2}} \mathrm{d}x = \sqrt{\pi}";
    let (ast, diagnostics) = parse(input);

    assert!(
        diagnostics.is_empty(),
        "Parse diagnostics should be empty: {diagnostics:?}"
    );
    assert!(!ast.is_empty(), "AST should not be empty");

    // 1. 第一个顶级节点为 BigOperator(Integral)
    let first = &ast[0].node;
    if let Expr::BigOperator {
        kind,
        lower,
        upper,
        body,
    } = first
    {
        assert_eq!(*kind, BigOpKind::Integral);
        assert!(lower.is_some(), "lower bound should be present");
        assert!(upper.is_some(), "upper bound should be present");
        assert!(!body.is_empty(), "Integral body must not be empty");

        // 验证 body 中包含 Script 且其 sup 分组包含嵌套的 x^2
        let mut found_gaussian_exp = false;
        for item in body {
            if let Expr::Script {
                base: _,
                sub: _,
                sup,
            } = &item.node
            {
                if let Some(sup_box) = sup {
                    if let Expr::Group(group_items) = &sup_box.node {
                        // 组内应包含一元负号与 x^2
                        for inner in group_items {
                            if let Expr::Script { base, sub: _, sup } = &inner.node {
                                if let Expr::Text(base_text) = &base.node {
                                    if base_text == "x" && sup.is_some() {
                                        found_gaussian_exp = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        assert!(
            found_gaussian_exp,
            "Body should contain nested Gaussian exponent e^{{-x^2}}, actual body: {body:?}"
        );
    } else {
        panic!("First node must be BigOperator(Integral), got: {first:?}");
    }

    // 2. 导出 LaTeX 验证
    let latex = to_latex(&ast);
    assert!(
        !latex.contains(r"e^{-x}^{2}"),
        "CRITICAL BUG DETECTED: LaTeX must NEVER degenerate to e^{{-x}}^{{2}}! Actual: {latex}"
    );
    assert!(
        latex.contains(r"-x^{2}") || latex.contains(r"-x^2") || latex.contains(r"{-x^{2}}"),
        "LaTeX should preserve nested -x^2 exponent. Actual: {latex}"
    );
    assert!(
        latex.contains(r"\sqrt{\pi}"),
        "LaTeX should contain sqrt(pi). Actual: {latex}"
    );
}

/// GT-02: 多项式上下标分组完整性
/// 断言：x^{a+b} 与 a_{i+1} 多项式完整保留在分组内，严禁截断为 x^{a}+b 或 a_{i}+1
#[test]
fn test_gt02_polynomial_scripts() {
    let input = r"x^{a+b} + a_{i+1}";
    let (ast, diagnostics) = parse(input);

    assert!(diagnostics.is_empty(), "Diagnostics: {diagnostics:?}");
    assert_eq!(ast.len(), 3, "Should have x^{{a+b}}, +, a_{{i+1}}");

    // 检查 x^{a+b}
    if let Expr::Script { base, sub: _, sup } = &ast[0].node {
        if let Expr::Text(b) = &base.node {
            assert_eq!(b, "x");
        }
        let sup_expr = sup.as_ref().expect("sup must exist");
        if let Expr::Group(items) = &sup_expr.node {
            assert!(
                items.len() >= 3,
                "Superscript group must contain 'a', '+', 'b', got {items:?}"
            );
        } else {
            panic!("Superscript must be a Group node, got: {sup_expr:?}");
        }
    } else {
        panic!("First node must be Script, got: {:?}", ast[0]);
    }

    // 检查 a_{i+1}
    if let Expr::Script { base, sub, sup: _ } = &ast[2].node {
        if let Expr::Text(b) = &base.node {
            assert_eq!(b, "a");
        }
        let sub_expr = sub.as_ref().expect("sub must exist");
        if let Expr::Group(items) = &sub_expr.node {
            assert!(
                items.len() >= 3,
                "Subscript group must contain 'i', '+', '1', got {items:?}"
            );
        } else {
            panic!("Subscript must be a Group node, got: {sub_expr:?}");
        }
    } else {
        panic!("Third node must be Script, got: {:?}", ast[2]);
    }

    let latex = to_latex(&ast);
    assert!(
        !latex.contains("x^{a}+b"),
        "Must NOT truncate to x^{{a}}+b! Actual: {latex}"
    );
    assert!(
        !latex.contains("a_{i}+1"),
        "Must NOT truncate to a_{{i}}+1! Actual: {latex}"
    );
}

/// GT-03: 上标中包含分式
/// 断言：e^{-\frac{x}{2}} 中的分式保持在指数分组内
#[test]
fn test_gt03_fraction_in_superscript() {
    let input = r"e^{-\frac{x}{2}}";
    let (ast, diagnostics) = parse(input);

    assert!(diagnostics.is_empty(), "Diagnostics: {diagnostics:?}");
    assert_eq!(ast.len(), 1);

    if let Expr::Script { base, sub: _, sup } = &ast[0].node {
        assert_eq!(base.node, Expr::Text("e".to_string()));
        let sup_expr = sup.as_ref().expect("sup must exist");
        if let Expr::Group(items) = &sup_expr.node {
            assert!(!items.is_empty());
            let has_fraction = items
                .iter()
                .any(|item| matches!(item.node, Expr::Fraction { .. }));
            assert!(
                has_fraction,
                "Superscript must contain Fraction, got: {items:?}"
            );
        } else {
            panic!("Superscript must be a Group, got: {sup_expr:?}");
        }
    } else {
        panic!("Root node must be Script, got: {:?}", ast[0]);
    }

    let latex = to_latex(&ast);
    assert!(
        latex.contains(r"\frac{x}{2}"),
        "LaTeX should preserve fraction in exponent: {latex}"
    );
}

/// GT-04: 求和算子与 \left( ... \right) 主体防空槽
/// 核心断言：词法精确区分 \left 与 \le，\sum 的 body 绝不为空且包含完整 Delimited 节点
#[test]
fn test_gt04_sum_with_left_right() {
    let input = r"\sum_{i=1}^{n} \left( a_i \right)";
    let (ast, diagnostics) = parse(input);

    assert!(diagnostics.is_empty(), "Diagnostics: {diagnostics:?}");
    assert_eq!(ast.len(), 1, "Should have 1 top-level BigOperator node");

    if let Expr::BigOperator { kind, body, .. } = &ast[0].node {
        assert_eq!(*kind, BigOpKind::Sum);
        assert!(
            !body.is_empty(),
            "CRITICAL: BigOperator body must NOT be empty!"
        );
        assert_eq!(body.len(), 1);

        if let Expr::Delimited {
            open,
            close,
            body: inner_body,
            auto_scale,
        } = &body[0].node
        {
            assert!(*auto_scale, "Should be auto-scaled delimited");
            assert_eq!(*open, Delim::Paren);
            assert_eq!(*close, Delim::Paren);
            assert_eq!(inner_body.len(), 1);
            if let Expr::Script { base, sub, .. } = &inner_body[0].node {
                assert_eq!(base.node, Expr::Text("a".to_string()));
                assert!(sub.is_some());
            } else {
                panic!("Inner body must be Script a_i, got: {inner_body:?}");
            }
        } else {
            panic!("Body item must be Delimited, got: {:?}", body[0]);
        }
    } else {
        panic!("Root node must be BigOperator(Sum), got: {:?}", ast[0]);
    }

    let latex = to_latex(&ast);
    assert!(
        latex.contains(r"\left(") && latex.contains(r"\right)"),
        "LaTeX must contain \\left( and \\right): {latex}"
    );
    assert!(
        latex.contains(r"\sum_{i=1}^{n}"),
        "LaTeX must contain \\sum with limits: {latex}"
    );
}

/// GT-05: 积分算子包含自适应括号主体
/// 核心断言：\int_a^b 的 body 完整捕获 \left( f(x) \right) 与 dx，body 绝不为空
#[test]
fn test_gt05_integral_with_left_right() {
    let input = r"\int_a^b \left( f(x) \right) dx";
    let (ast, diagnostics) = parse(input);

    assert!(diagnostics.is_empty(), "Diagnostics: {diagnostics:?}");
    assert_eq!(ast.len(), 1);

    if let Expr::BigOperator { kind, body, .. } = &ast[0].node {
        assert_eq!(*kind, BigOpKind::Integral);
        assert!(
            !body.is_empty(),
            "CRITICAL: Integral body must NOT be empty!"
        );
        // body 应包含 Delimited 以及 dx
        let has_delimited = body
            .iter()
            .any(|e| matches!(e.node, Expr::Delimited { .. }));
        let has_dx = body
            .iter()
            .any(|e| matches!(&e.node, Expr::Text(s) if s.contains("dx") || s == "d" || s == "x"));
        assert!(has_delimited, "Body must contain Delimited: {body:?}");
        assert!(has_dx, "Body must contain differential: {body:?}");
    } else {
        panic!("Root node must be BigOperator(Integral), got: {:?}", ast[0]);
    }

    let latex = to_latex(&ast);
    assert!(latex.contains(r"\int_{a}^{b}"), "LaTeX limits: {latex}");
    assert!(
        latex.contains(r"\left(") && latex.contains(r"\right)"),
        "LaTeX delimiters: {latex}"
    );
}

/// GT-06: 矩阵 & 分隔符零转义保真
/// 核心断言：pmatrix 内部的 & 与 \\ 完整识别为网格结构，导出 LaTeX 绝对不可出现 \&
#[test]
fn test_gt06_pmatrix_no_ampersand_escaping() {
    let input = r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}";
    let (ast, diagnostics) = parse(input);

    assert!(diagnostics.is_empty(), "Diagnostics: {diagnostics:?}");
    assert_eq!(ast.len(), 1);

    if let Expr::Matrix { env, rows } = &ast[0].node {
        assert_eq!(*env, MatrixEnv::Pmatrix);
        assert_eq!(rows.len(), 2, "Matrix must have 2 rows");
        assert_eq!(rows[0].len(), 2, "Row 0 must have 2 cells");
        assert_eq!(rows[1].len(), 2, "Row 1 must have 2 cells");
    } else {
        panic!("Root node must be Matrix(Pmatrix), got: {:?}", ast[0]);
    }

    let latex = to_latex(&ast);
    assert!(
        !latex.contains(r"\&"),
        "CRITICAL REGRESSION: LaTeX must NEVER escape & to \\& in matrices! Actual: {latex}"
    );
    assert!(
        latex.contains(r"\begin{pmatrix}"),
        "LaTeX should have \\begin{{pmatrix}}: {latex}"
    );
    assert!(
        latex.contains(r"\\"),
        "LaTeX should have row breaks \\\\: {latex}"
    );
    assert!(latex.contains('&'), "LaTeX should contain raw &: {latex}");
}

/// GT-07: 非对称矩形矩阵环境
/// 核心断言：bmatrix 正确提取 2x3 网格结构
#[test]
fn test_gt07_bmatrix_rectangular() {
    let input = r"\begin{bmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \end{bmatrix}";
    let (ast, diagnostics) = parse(input);

    assert!(diagnostics.is_empty(), "Diagnostics: {diagnostics:?}");
    assert_eq!(ast.len(), 1);

    if let Expr::Matrix { env, rows } = &ast[0].node {
        assert_eq!(*env, MatrixEnv::Bmatrix);
        assert_eq!(rows.len(), 2, "Matrix must have 2 rows");
        assert_eq!(rows[0].len(), 3, "Row 0 must have 3 cells");
        assert_eq!(rows[1].len(), 3, "Row 1 must have 3 cells");
    } else {
        panic!("Root node must be Matrix(Bmatrix), got: {:?}", ast[0]);
    }

    let latex = to_latex(&ast);
    assert!(latex.contains(r"\begin{bmatrix}"));
    assert!(latex.contains(r"\end{bmatrix}"));
    assert!(!latex.contains(r"\&"));
}

/// GT-08: 未知宏 RawLatex 安全兜底与警告
/// 核心断言：遇到未知宏 \xygraph{a -> b} 不 panic，降级为 RawLatex，保留原文并附带 warning
#[test]
fn test_gt08_unknown_macro_raw_fallback() {
    let input = r"\xygraph{a -> b}";
    let (ast, diagnostics) = parse(input);

    assert!(!ast.is_empty(), "AST should not be empty");
    assert_eq!(ast.len(), 1);

    if let Expr::RawLatex { latex, warning } = &ast[0].node {
        assert!(
            latex.contains(r"\xygraph"),
            "RawLatex should retain macro source: {latex}"
        );
        assert!(warning.is_some(), "Warning should be attached");
    } else {
        panic!("Root node must be RawLatex, got: {:?}", ast[0]);
    }

    // 检查是否有 warning
    assert!(
        !diagnostics.is_empty(),
        "Diagnostics must contain a warning for unknown macro"
    );
    assert!(
        diagnostics[0].is_warning,
        "Diagnostic must be marked as warning"
    );

    let latex = to_latex(&ast);
    assert_eq!(latex, r"\xygraph{a -> b}");
}

/// 补充测试：Span 精准度与合并
#[test]
fn test_span_precision() {
    let input = "x^2 + y^2";
    let (ast, _) = parse(input);

    assert_eq!(ast.len(), 3);
    assert_eq!(ast[0].span.start, 0);
    assert_eq!(ast[0].span.end, 3); // "x^2"
    assert_eq!(ast[1].span.start, 4);
    assert_eq!(ast[1].span.end, 5); // "+"
    assert_eq!(ast[2].span.start, 6);
    assert_eq!(ast[2].span.end, 9); // "y^2"
}

/// 补充测试：关系符 \le 与定界符 \left 紧邻混合输入
#[test]
fn test_left_and_le_disambiguation() {
    let input = r"x \le \left( y + z \right)";
    let (ast, diagnostics) = parse(input);

    assert!(diagnostics.is_empty(), "Diagnostics: {diagnostics:?}");
    assert_eq!(ast.len(), 3);

    // ast[0] is x
    assert_eq!(ast[0].node, Expr::Text("x".to_string()));
    // ast[1] is \le (Relation)
    assert_eq!(
        ast[1].node,
        Expr::Symbol(SymbolKind::Relation(r"\le".to_string()))
    );
    // ast[2] is \left( ... \right) (Delimited)
    assert!(matches!(ast[2].node, Expr::Delimited { .. }));
}

/// 补充测试：MathSlot 简码往返导出
#[test]
fn test_mathslot_stream_shortcut_export() {
    let input = r"\frac{a+1}{b-1}";
    let (ast, diagnostics) = parse(input);

    assert!(diagnostics.is_empty());
    let source = mathslot_syntax::to_source(&ast);
    assert_eq!(source, "▸fa+1;b-1;");
}

/// 补充测试：空定界符 \left. \frac{df}{dx} \right|_{x=0}
#[test]
fn test_empty_delimited_evaluation_bar() {
    let input = r"\left. \frac{df}{dx} \right|";
    let (ast, diagnostics) = parse(input);

    assert!(diagnostics.is_empty(), "Diagnostics: {diagnostics:?}");
    assert_eq!(ast.len(), 1);

    if let Expr::Delimited {
        open, close, body, ..
    } = &ast[0].node
    {
        assert_eq!(*open, Delim::Empty);
        assert_eq!(*close, Delim::Pipe);
        assert_eq!(body.len(), 1);
        assert!(matches!(body[0].node, Expr::Fraction { .. }));
    } else {
        panic!("Expected Delimited with empty open, got: {:?}", ast[0]);
    }
}

/// 补充测试：显式数学样式 Expr::Style 不降级
#[test]
fn test_math_styles_no_degradation() {
    let input = r"\mathbf{A+B} + \mathcal{H} + \mathrm{d}x";
    let (ast, diagnostics) = parse(input);

    assert!(diagnostics.is_empty(), "Diagnostics: {diagnostics:?}");
    assert_eq!(
        ast.len(),
        6,
        "Should have 6 items: mathbf, +, mathcal, +, mathrm, x"
    );

    // ast[0]: \mathbf{A+B}
    if let Expr::Style { style, body } = &ast[0].node {
        assert_eq!(*style, MathStyle::Bold);
        assert_eq!(body.len(), 3);
    } else {
        panic!(
            "Expected Expr::Style for \\mathbf{{A+B}}, got: {:?}",
            ast[0]
        );
    }

    // ast[2]: \mathcal{H}
    if let Expr::Style { style, body } = &ast[2].node {
        assert_eq!(*style, MathStyle::Caligraphic);
        assert_eq!(body.len(), 1);
    } else {
        panic!("Expected Expr::Style for \\mathcal{{H}}, got: {:?}", ast[2]);
    }

    // ast[4]: \mathrm{d}
    if let Expr::Style { style, body } = &ast[4].node {
        assert_eq!(*style, MathStyle::Roman);
        assert_eq!(body.len(), 1);
    } else {
        panic!("Expected Expr::Style for \\mathrm{{d}}, got: {:?}", ast[4]);
    }

    // ast[5]: x
    assert_eq!(ast[5].node, Expr::Text("x".to_string()));

    let latex = to_latex(&ast);
    assert!(latex.contains(r"\mathbf{A+B}"));
    assert!(latex.contains(r"\mathcal{H}"));
    assert!(latex.contains(r"\mathrm{d}"));
}

/// 补充测试：裸定界符与自适应定界符的区分
#[test]
fn test_bare_and_scaled_delimited() {
    let bare_input = r"(x+y)";
    let (bare_ast, bare_diag) = parse(bare_input);
    assert!(bare_diag.is_empty());
    assert_eq!(bare_ast.len(), 1);
    if let Expr::Delimited { auto_scale, .. } = &bare_ast[0].node {
        assert!(!*auto_scale, "Bare parens must have auto_scale = false");
    } else {
        panic!("Expected Delimited, got: {:?}", bare_ast[0]);
    }
    let bare_latex = to_latex(&bare_ast);
    assert_eq!(bare_latex, "(x+y)");

    let scaled_input = r"\left( x+y \right)";
    let (scaled_ast, scaled_diag) = parse(scaled_input);
    assert!(scaled_diag.is_empty());
    assert_eq!(scaled_ast.len(), 1);
    if let Expr::Delimited { auto_scale, .. } = &scaled_ast[0].node {
        assert!(*auto_scale, "Scaled parens must have auto_scale = true");
    } else {
        panic!("Expected Delimited, got: {:?}", scaled_ast[0]);
    }
    let scaled_latex = to_latex(&scaled_ast);
    assert_eq!(scaled_latex, r"\left( x+y \right)");
}

/// 补充测试：连续多元积分算子防贪婪吞噬
#[test]
fn test_multi_integrals_and_big_op_predicates() {
    let input = r"\int_{A} \iint_{B} f \mathrm{d}x";
    let (ast, diagnostics) = parse(input);

    assert!(diagnostics.is_empty(), "Diagnostics: {diagnostics:?}");
    // 应该被解析为两个大算子节点，而不是第一个大算子把第二个大算子当作 body 吞掉
    assert_eq!(ast.len(), 2, "Expected 2 big operator nodes, got: {ast:?}");

    if let Expr::BigOperator { kind, lower, .. } = &ast[0].node {
        assert_eq!(*kind, BigOpKind::Integral);
        assert!(lower.is_some());
    } else {
        panic!("Expected first node to be Integral, got: {:?}", ast[0]);
    }

    if let Expr::BigOperator {
        kind, lower, body, ..
    } = &ast[1].node
    {
        assert_eq!(*kind, BigOpKind::DoubleIntegral);
        assert!(lower.is_some());
        assert!(!body.is_empty());
    } else {
        panic!(
            "Expected second node to be DoubleIntegral, got: {:?}",
            ast[1]
        );
    }

    let latex = to_latex(&ast);
    assert!(latex.contains(r"\int_{A}"));
    assert!(latex.contains(r"\iint_{B}"));
}

use latex_rust::{Color, Dim, MathFont, PngBackground, PngOptions, latex_to_png};
use mathslot_core::editor::StreamEditor;
use mathslot_core::latex::{latex_to_mathslot, text_to_latex, to_latex};
use mathslot_core::parser::parse;
use mathslot_core::visual::{VisualDialect, build_preview_latex};
use tiny_skia::Pixmap;

fn render_latex_to_png_ok(latex_src: &str) {
    let font = MathFont::stix_two_math().expect("STIX Two Math must load");
    let opts = PngOptions {
        font_size_pt: Dim::from_i64(18),
        dpi: Dim::from_i64(216),
        color: Color::rgb(15, 23, 42),
        background: PngBackground::Color(Color::rgb(255, 255, 255)),
        display: true,
    };
    let mut full_src = String::with_capacity(512);
    for &(name, hex) in mathslot_core::visual::VISUAL_COLORS {
        full_src.push_str(&format!("\\definecolor{{{name}}}{{HTML}}{{{hex}}}"));
    }
    full_src.push_str(latex_src);

    let png_bytes = latex_to_png(&full_src, &font, &opts)
        .unwrap_or_else(|e| panic!("latex-rust failed to compile: '{full_src}', error: {e}"));
    let pixmap = Pixmap::decode_png(&png_bytes).expect("must decode valid PNG");
    assert!(
        pixmap.width() > 0 && pixmap.height() > 0,
        "Rendered image must have non-zero dimensions"
    );
}

#[test]
fn test_ext01_gaussian_integral_end_to_end_lossless() {
    // 1. 输入纯正标准 LaTeX
    let original_latex = r"\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}";

    // 2. 转换成 MathSlot 简码
    let stream = latex_to_mathslot(original_latex);
    assert!(
        stream.contains("e^-x^2"),
        "Stream should contain e^-x^2: {stream}"
    );

    // 3. 键入 StreamEditor 校验
    let mut editor = StreamEditor::new();
    editor.insert_str(&stream);

    // 4. 导出 LaTeX 并校验绝对不产生非法的 Double Superscript (e^{-x}^{2})
    let exported = editor.to_latex();
    assert!(
        !exported.contains(r"e^{-x}^{2}"),
        "Exported LaTeX MUST NOT contain illegal double superscript 'e^{{-x}}^{{2}}': {exported}"
    );
    assert!(
        exported.contains(r"e^{-x^2}") || exported.contains(r"e^{-x^{2}}"),
        "Exported LaTeX must contain valid single-bracket exponent: {exported}"
    );

    // 5. 校验实时预览在各个关键光标位置均生成合法无崩溃 LaTeX 并光栅化
    let doc = &editor.parsed;
    for cur in 0..=doc.char_len {
        let preview_tex = build_preview_latex(doc, cur, VisualDialect::LatexRust);
        assert!(
            !preview_tex.contains(r"e^{-x}^{2}"),
            "Preview LaTeX at cursor {cur} must not have double superscript: {preview_tex}"
        );
        render_latex_to_png_ok(&preview_tex);
    }

    // 6. 验证最终导出的公式在 latex-rust 中 100% 成功光栅化
    render_latex_to_png_ok(&exported);
}

#[test]
fn test_ext02_mahalanobis_distance_and_multivariate_gaussian() {
    // 马氏距离与多元高斯核：根号套分式套指数套逆矩阵转置
    let latex = r"\sqrt{\frac{\exp\left(-\frac{1}{2}(x-\mu)^T \Sigma^{-1} (x-\mu)\right)}{(2\pi)^n |\Sigma|}}";
    render_latex_to_png_ok(latex);

    // 通过自然流式语法构建类似的高阶嵌套
    let stream = "▸r▸fexp▸p-▸f1;2;(x - ▸gm)^T ▸gS^-1 (x - ▸gm);; ;▸p2▸gp;^n |▸gS|;;";
    let doc = parse(stream);
    let exported = to_latex(&doc);
    assert!(!exported.is_empty());
    render_latex_to_png_ok(&exported);
}

#[test]
fn test_ext03_fundamental_theorem_of_calculus_nested_variable_limit() {
    // 变上限积分嵌套复合求导与欧拉-泊松核
    let latex = r"\frac{\mathrm{d}}{\mathrm{d}x} \int_{0}^{\int_{1}^{x} \frac{\sin t}{t} \,\mathrm{d}t} e^{-u^2} \,\mathrm{d}u";
    render_latex_to_png_ok(latex);

    // 验证 MathSlot 编辑器输入自然简码
    let stream = "▸f▸dd;dx;▸i0;▸i1;x;▸fsin t;t;dt;;e^-u^2 du;";
    let doc = parse(stream);
    let exported = to_latex(&doc);
    assert!(!exported.contains(r"e^{-u}^{2}"));
    render_latex_to_png_ok(&exported);
}

#[test]
fn test_ext04_evaluation_bar_higher_order_partial_derivative() {
    // 空定界符求值竖线包裹多元高阶偏导
    let latex = r"\left. \frac{\partial^2}{\partial x \partial y} \left( \frac{x^2 - y^2}{x^2 + y^2} \right) \right|_{x=1,\, y=0}";
    render_latex_to_png_ok(latex);

    let stream = latex_to_mathslot(latex);
    let doc = parse(&stream);
    let exported = to_latex(&doc);
    assert!(!exported.is_empty());
    render_latex_to_png_ok(&exported);
}

#[test]
fn test_ext05_heterogeneous_matrix_cells() {
    // 2x2 异构矩阵：单元格分别内嵌极限、定积分、级数、根号分式
    let stream = "▸ma▸lx;0;▸fsin x;x;;;▸i0;1;x^2 dx;;▸s1;oo;▸f1;n^2;;;▸r▸f1;1 + x^2;;;";
    let doc = parse(stream);
    let exported = to_latex(&doc);
    assert!(exported.contains(r"\begin{pmatrix}"));
    assert!(exported.contains(r"\frac{\sin x}{x}"));
    assert!(exported.contains(r"\int_{0}^{1}"));
    assert!(exported.contains(r"\sum_{1}^{\infty}"));
    assert!(exported.contains(r"\sqrt{\frac{1}{1 + x^{2}}}"));
    render_latex_to_png_ok(&exported);
}

#[test]
fn test_ext06_negative_script_nesting_and_power_tower() {
    // 各种高风险上标复合表达式
    let cases = [
        ("e^-x^2", "e^{-x^2}"),
        ("e^x^2", "e^{x^2}"),
        ("2^-n^2", "2^{-n^2}"),
        ("x^-a^b", "x^{-a^b}"),
        ("e^-(x+1)^2", "e^{-(x+1)^2}"),
    ];

    for (input, expected) in cases {
        let output = text_to_latex(input);
        assert_eq!(
            output, expected,
            "text_to_latex('{input}') must match '{expected}' without double superscripts"
        );
        render_latex_to_png_ok(&output);
    }
}

#[test]
fn test_ext07_smart_enter_delimiter_state_machine() {
    // 1. 单层括号：输入完后在内部按 Enter 跳出
    let mut ed = StreamEditor::new();
    ed.insert_str("(x + 1)");
    // 光标紧跟在 1 之后（char_idx = 6, 闭合括号 ')' 在 6 处）
    ed.set_cursor(6);
    let msg = ed.smart_enter();
    assert!(msg.contains("已跳出配对括号 ()"));
    assert_eq!(ed.cursor_char, 7, "Cursor must step over ')' to index 7");

    // 2. 嵌套括号逐层跳出：([x + 1])
    let mut ed = StreamEditor::new();
    ed.insert_str("([x + 1])");
    // 光标在 1 后面（char_idx = 7，内层 ']' 在 7 处）
    ed.set_cursor(7);
    let msg1 = ed.smart_enter();
    assert!(msg1.contains("已跳出配对中括号 []"));
    assert_eq!(ed.cursor_char, 8, "Cursor stepped over ']' to index 8");

    // 第二次按 Enter，跳出外层 ')'
    let msg2 = ed.smart_enter();
    assert!(msg2.contains("已跳出配对括号 ()"));
    assert_eq!(ed.cursor_char, 9, "Cursor stepped over ')' to index 9");

    // 3. 槽位内部括号联动：▸f(x + 1);2;
    let mut ed = StreamEditor::new();
    ed.insert_str("▸f(x + 1);2;");
    // 光标在分子括号内部 '1' 后（char_idx = 8，')' 在 8）
    ed.set_cursor(8);
    let msg_slot1 = ed.smart_enter();
    assert!(
        msg_slot1.contains("已跳出配对括号 ()"),
        "First Enter must jump out of inner parentheses: {msg_slot1}"
    );
    assert_eq!(ed.cursor_char, 9, "Cursor is now at分子末尾 (9)");

    // 第二次按 Enter：推进至分母
    let msg_slot2 = ed.smart_enter();
    assert!(
        msg_slot2.contains("进入「分数」的 [分母]") || msg_slot2.contains("进入「分式」的 [分母]"),
        "Second Enter must advance to denominator: {msg_slot2}"
    );

    // 4. 绝对值定界符跳出：|x + 1|
    let mut ed = StreamEditor::new();
    ed.insert_str("|x + 1|");
    ed.set_cursor(6);
    let msg_pipe = ed.smart_enter();
    assert!(msg_pipe.contains("已跳出配对绝对值 ||"));
    assert_eq!(ed.cursor_char, 7);
}

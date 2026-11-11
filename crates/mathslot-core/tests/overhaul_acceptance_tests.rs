use latex_rust::{latex_to_png, Color, Dim, MathFont, PngBackground, PngOptions};
use mathslot_core::editor::StreamEditor;
use mathslot_core::latex::{latex_to_mathslot, text_to_latex};
use mathslot_core::visual::{build_preview_latex, VisualDialect};
use tiny_skia::Pixmap;

fn render_png_strict(latex_src: &str) -> (u32, u32) {
    let font = MathFont::stix_two_math().expect("STIX Two Math font must load");
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
        .unwrap_or_else(|e| panic!("latex-rust rasterization failed for '{full_src}': {e}"));
    let pixmap = Pixmap::decode_png(&png_bytes).expect("must decode valid PNG pixmap");
    assert!(
        pixmap.width() > 0 && pixmap.height() > 0,
        "Rendered image must have non-zero dimensions"
    );
    (pixmap.width(), pixmap.height())
}

/// 验收用例 1：高斯积分简码直接粘贴、导出与全光标点光栅化
#[test]
fn test_overhaul_m1_gaussian_integral_paste_and_rasterization() {
    // 1. 模拟用户直接粘贴标准高斯积分简码
    let pasted_stream = "▸i-oo;oo;e^-x^2 dx;= ▸r▸gp;";
    let mut editor = StreamEditor::new();
    editor.insert_str(pasted_stream);

    // 2. 验证导出的 LaTeX 绝对没有非法双重上标 e^{-x}^{2}
    let exported = editor.to_latex();
    assert!(
        !exported.contains(r"e^{-x}^{2}"),
        "Illegal double superscript detected in exported LaTeX: {exported}"
    );
    assert!(
        exported.contains(r"e^{-x^2}") || exported.contains(r"e^{-x^{2}}"),
        "Exported LaTeX must contain valid single-bracket exponent: {exported}"
    );

    // 3. 验证真实 latex-rust 3.0.1 编译与 tiny-skia 光栅化
    let (w, h) = render_png_strict(&exported);
    assert!(w > 50 && h > 20, "Rasterized Gaussian integral must be a valid formula bitmap (got {w}x{h})");

    // 4. 穷举该公式全部字符光标位置（0..=doc.char_len），验证实时预览无双重上标且 100% 可光栅化
    let doc = &editor.parsed;
    for cur in 0..=doc.char_len {
        let preview = build_preview_latex(doc, cur, VisualDialect::LatexRust);
        assert!(
            !preview.contains(r"e^{-x}^{2}"),
            "Preview at cursor {cur} has illegal double superscript: {preview}"
        );
        let (pw, ph) = render_png_strict(&preview);
        assert!(pw > 0 && ph > 0);
    }

    // 5. 反向验证：标准 LaTeX 导入生成标准简码
    let std_latex = r"\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}";
    let converted_stream = latex_to_mathslot(std_latex);
    assert!(
        converted_stream.contains("e^-x^2"),
        "LaTeX to mathslot must produce e^-x^2 without redundant markers: {converted_stream}"
    );
}

/// 验收用例 2：复合指数与多层幂塔支持验证
#[test]
fn test_overhaul_m1_compound_exponents_and_power_towers() {
    let cases = [
        ("e^-x^2", "e^{-x^2}"),
        ("e^x^2", "e^{x^2}"),
        ("2^-n^2", "2^{-n^2}"),
        ("x^-a^b", "x^{-a^b}"),
        ("e^-(x+1)^2", "e^{-(x+1)^2}"),
        ("e^-x", "e^{-x}"),
        ("a^-1", "a^{-1}"),
        ("x^a+b", "x^{a}+b"),
    ];

    for (src, expected) in cases {
        let rendered = text_to_latex(src);
        assert_eq!(
            rendered, expected,
            "text_to_latex('{src}') failed to match expected '{expected}'"
        );
        let (w, h) = render_png_strict(&rendered);
        assert!(w > 0 && h > 0);
    }
}

/// 验收用例 3：括号与定界符智能跳出状态机全矩阵测试
#[test]
fn test_overhaul_m3_delimiter_enter_smart_jump_out_matrix() {
    // 3.1 单层圆括号、中括号、大括号、绝对值
    let delims = [
        ("(x + y)", 6, 7, "已跳出配对括号 ()"),
        ("[1, 2, 3]", 8, 9, "已跳出配对中括号 []"),
        ("{a + b}", 6, 7, "已跳出配对大括号 {}"),
        ("|z - w|", 6, 7, "已跳出配对绝对值 ||"),
    ];

    for (input, cur_inside, expected_cur_after, expected_msg) in delims {
        let mut ed = StreamEditor::new();
        ed.insert_str(input);
        ed.set_cursor(cur_inside);
        let msg = ed.smart_enter();
        assert!(
            msg.contains(expected_msg),
            "Expected msg '{expected_msg}', got '{msg}' for input '{input}'"
        );
        assert_eq!(
            ed.cursor_char, expected_cur_after,
            "Cursor must step out to {expected_cur_after} for '{input}', got {}",
            ed.cursor_char
        );
    }

    // 3.2 嵌套定界符逐层跳出：({[x]})
    let mut ed = StreamEditor::new();
    ed.insert_str("({[x]})");
    ed.set_cursor(4); // just after 'x', inside ']'
    let m1 = ed.smart_enter();
    assert!(m1.contains("已跳出配对中括号 []"));
    assert_eq!(ed.cursor_char, 5); // now inside '}'

    let m2 = ed.smart_enter();
    assert!(m2.contains("已跳出配对大括号 {}"));
    assert_eq!(ed.cursor_char, 6); // now inside ')'

    let m3 = ed.smart_enter();
    assert!(m3.contains("已跳出配对括号 ()"));
    assert_eq!(ed.cursor_char, 7); // now completely outside
}

/// 验收用例 4：定界符与槽位推进层级协调测试
#[test]
fn test_overhaul_m3_delimiter_slot_hierarchy_synergy() {
    // 场景 A：槽位内部书写括号：▸f1;(x + 1);
    // 在分母槽位内输入 (x + 1|)，Enter 应该先跳出括号到分母末尾，再次 Enter 跳出分式回到根级
    let mut ed = StreamEditor::new();
    ed.insert_str("▸f1;(x + 1);");
    ed.set_cursor(10); // after '1' inside (x + 1|)
    let msg1 = ed.smart_enter();
    assert!(msg1.contains("已跳出配对括号 ()"));
    assert_eq!(ed.cursor_char, 11); // at ';'

    let msg2 = ed.smart_enter();
    assert!(msg2.contains("回到外层序列") || msg2.contains("回到最外层序列"));
    assert_eq!(ed.cursor_char, 12);

    // 场景 B：括号内部书写子槽位：(▸f1;2;)
    // 括号包含整个分式。光标在分子 1 处时，Enter 应该优先推进槽位（分子 -> 分母），而非跳出外层括号！
    let mut ed = StreamEditor::new();
    ed.insert_str("(▸f1;2;)");
    ed.set_cursor(4); // at numerator '1'
    let msg1 = ed.smart_enter();
    assert!(
        msg1.contains("进入「分数」的 [分母]") || msg1.contains("进入「分式」的 [分母]"),
        "Enter inside sub-slot must advance slot, not jump out of enclosing bracket! Got: {msg1}"
    );
    assert_eq!(ed.cursor_char, 5); // moved to denominator '2'
}

/// 验收用例 5：多绝对值同槽重置与转义字符保护
#[test]
fn test_overhaul_m3_escaped_delimiters_and_pipe_isolation() {
    // 槽位分隔符 ';' 必须重置绝对值竖线，防止跨槽误配
    let mut ed = StreamEditor::new();
    ed.insert_str("▸f|a;b|;");
    ed.set_cursor(4); // at 'a' inside numerator
    // 此时分子竖线未闭合，不应该跨到分母形成配对
    let msg = ed.smart_enter();
    assert!(
        !msg.contains("已跳出配对绝对值 ||"),
        "Unpaired pipe across slot separator must not trigger smart jump out! Got: {msg}"
    );
}

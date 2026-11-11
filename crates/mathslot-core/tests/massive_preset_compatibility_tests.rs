use latex_rust::{Color, Dim, MathFont, PngBackground, PngOptions, latex_to_png};
use mathslot_core::latex::to_latex;
use mathslot_core::library::UserLibrary;
use mathslot_core::parser::parse_with_library;
use mathslot_core::presets::PRESET_LIBRARY;
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
fn test_all_preset_corpus_compatibility() {
    let lib = UserLibrary::default_seeded();

    println!("Total presets under test: {}", PRESET_LIBRARY.len());
    assert!(
        PRESET_LIBRARY.len() >= 40,
        "Preset library must contain at least 40 authoritative formulas, found: {}",
        PRESET_LIBRARY.len()
    );

    let mut success_count = 0;
    for (i, formula) in PRESET_LIBRARY.iter().enumerate() {
        println!(
            "[{}/{}] Testing [{}]: {}",
            i + 1,
            PRESET_LIBRARY.len(),
            formula.category,
            formula.name
        );

        // 1. 解析测试：必须成功解析为 AST 文档，不得 panic 或空
        let doc = parse_with_library(formula.source, &lib);

        // 2. LaTeX 导出测试：导出的 LaTeX 不可为空
        let exported_latex = to_latex(&doc);
        assert!(
            !exported_latex.trim().is_empty(),
            "Preset '{}' produced empty LaTeX",
            formula.name
        );

        // 3. 校验括号匹配与基本格式完整性
        let open_curlies = exported_latex.chars().filter(|&c| c == '{').count();
        let close_curlies = exported_latex.chars().filter(|&c| c == '}').count();
        assert_eq!(
            open_curlies, close_curlies,
            "Preset '{}' generated unbalanced braces in LaTeX: {}",
            formula.name, exported_latex
        );

        // 4. latex-rust 纯 Rust 渲染器光栅化测试
        render_latex_to_png_ok(&exported_latex);

        success_count += 1;
    }

    assert_eq!(success_count, PRESET_LIBRARY.len());
}

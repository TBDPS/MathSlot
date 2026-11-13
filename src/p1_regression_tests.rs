//! P1 缺陷运行时行为失败回归测试集 (src/桌面端与 UI)
//!
//! 依据 `agent-state/decisions/ADR-0006-p1-regression-tests-t0.3.md` 与 `agent-state/audits/AUD-3.md`。
//! 严禁采用静态读取源码文本 (D-101)；所有测试均为真实 API 调用与运行时行为断言。
//! 当前代码下标注 `#[ignore]`，执行 `cargo test --workspace -- --ignored` 时必须全部真实触发断言失败。

use eframe::egui;
use mathslot_core::command::{CommandTarget, SymbolCmd, lookup_sub_command};
use mathslot_core::library::UserLibrary;

/// D-001 回归测试：调色板卡片声明简码与命令目录 display_glyph 一致性
///
/// 关联代码：`src/app.rs` 中的 `common_symbol_tiles` 集合。
/// 5 张卡片经 T1.3 修复已严格对齐 catalog 权威定义：
/// 1. `oc` 偏导（`∂` \partial）
/// 2. `xb` 约等于（`≈` \approx）
/// 3. `og` 点乘（`·` \cdot）
/// 4. `of` 叉乘（`×` \times）
/// 5. `xa` 恒等于（`≡` \equiv）
#[test]
fn test_p1_d001_palette_tiles_strictly_match_command_catalog() {
    let tiles = crate::app::common_symbol_tiles();

    let expected_5 = [
        ("oc", "∂", "偏导"),
        ("xb", "≈", "约等于"),
        ("og", "·", "点乘"),
        ("of", "×", "叉乘"),
        ("xa", "≡", "恒等于"),
    ];

    for (code, expected_glyph, label) in expected_5 {
        let tile = tiles.iter().find(|t| t.code == code).unwrap_or_else(|| {
            panic!("Tile '{label}' (code: '{code}') must exist in common_symbol_tiles")
        });
        assert_eq!(tile.glyph, expected_glyph, "Tile '{label}' glyph mismatch");
        assert_eq!(tile.badge, code, "Tile '{label}' badge mismatch");

        let mut chars = code.chars();
        let c1 = chars.next().expect("First char of code");
        let c2 = chars.next().expect("Second char of code");

        let target = lookup_sub_command(c1, c2).unwrap_or_else(|| {
            panic!("Tile code '{code}' ({label}) must exist in command catalog");
        });

        match target {
            CommandTarget::Symbol(sym) => {
                let glyph = sym.display_glyph();
                let matches = glyph == expected_glyph
                    || (sym == SymbolCmd::Cdot && (glyph == "⋅" || glyph == "·"));
                assert!(
                    matches,
                    "Tile '{label}' (code: '{code}') display glyph mismatch: catalog has '{}' but palette card expects '{}'",
                    glyph, expected_glyph
                );
            }
            CommandTarget::Struct(st) => {
                panic!(
                    "Tile '{label}' (code: '{code}') expected symbol command, but got struct {st:?}"
                );
            }
        }
    }
}

/// D-003 失败回归测试：长公式预览在有限视口下的几何缩放计算必须遵守 max_width / max_height 约束
///
/// 直接调用生产路径 `crate::app::fitted_size_dims` 与 `mathslot_render::fit_to_box`：
/// 宽公式（如 1200x300）按 2.0 像素密度折算为 600x150，在 400x100 视口内必须严格满足 max_width / max_height。
#[test]
fn test_p1_d003_fitted_size_strictly_respects_max_bounds() {
    let ctx = egui::Context::default();
    // 构造宽 1200、高 300 的大尺寸公式纹理
    let pixels = vec![egui::Color32::WHITE; 1200 * 300];
    let img = egui::ColorImage::new([1200, 300], pixels);
    let tex = ctx.load_texture("large_formula", img, Default::default());
    let original = tex.size_vec2() / 2.0;

    let max_w = 400.0;
    let max_h = 100.0;
    let size = crate::app::fitted_size_dims(original.x, original.y, max_w, max_h, 1.0);
    let render_fit = mathslot_render::fit_to_box(
        mathslot_render::Size2D::new(original.x, original.y),
        max_w,
        max_h,
        1.0,
    );

    assert!(
        size.x <= max_w,
        "Fitted width {} exceeds max_width {}",
        size.x,
        max_w
    );
    assert!(
        size.y <= max_h,
        "Fitted height {} exceeds max_height {}",
        size.y,
        max_h
    );
    assert!((size.x - render_fit.display_size.width).abs() < 0.01);
    assert!((size.y - render_fit.display_size.height).abs() < 0.01);
}

/// D-005 失败回归测试：读取损坏 JSON 配置严禁静默回退默认库并不保留损坏原件
///
/// 直接调用生产路径 `crate::modals::load_library_from_path` 与 `crate::modals::save_library_to_path`：
/// 1. 损坏主文件必须隔离为 `library.corrupt-*.json`（保留原件），绝不静默回退 `UserLibrary::default_seeded()`
/// 2. 未经用户确认恢复/重置前，`save_library_to_path` 必须拒绝覆盖并保留隔离原件
#[test]
fn test_p1_d005_config_load_corrupted_json_returns_error_and_preserves_file() {
    let temp_root = std::env::temp_dir().join(format!(
        "mathslot_d005_test_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("System time after epoch")
            .as_nanos()
    ));
    let mathslot_config_dir = temp_root.join("mathslot");
    std::fs::create_dir_all(&mathslot_config_dir).expect("Create isolated config directory");
    let config_path = mathslot_config_dir.join("library.json");

    let corrupted_content = r#"{ "custom_formats": [ { unterminated json syntax error"#;
    std::fs::write(&config_path, corrupted_content).expect("Write corrupted config file");

    let (loaded_lib, msg, mut session) = crate::modals::load_library_from_path(&config_path);

    // 核心断言 1: 损坏配置文件加载严禁静默回退为默认种子库
    let default_seeded = UserLibrary::default_seeded();
    assert_ne!(
        loaded_lib, default_seeded,
        "Corrupted configuration must not silently degrade to default_seeded library"
    );

    // 核心断言 2: 加载提示信息严禁指示“已回退默认库”，必须进入损坏隔离阻断状态
    assert!(
        !msg.contains("已回退默认库"),
        "Corrupted config load must fail explicitly rather than silently falling back: {msg}"
    );
    assert!(
        session.is_blocked(),
        "Corrupted config load must block silent overwrites until user confirms recovery"
    );

    // 核心断言 3: 未经确认保存时严禁覆盖，且隔离后的损坏原件必须完整保留
    let save_res = crate::modals::save_library_to_path(&loaded_lib, &config_path, &mut session);
    assert!(
        save_res.is_err(),
        "Unconfirmed save while quarantined must fail explicitly, got {save_res:?}"
    );

    let corrupt_path = session
        .quarantined_corrupt_path
        .as_ref()
        .expect("Corrupt file must be quarantined to library.corrupt-*.json");
    let preserved_content = std::fs::read_to_string(corrupt_path).unwrap_or_default();
    assert!(
        preserved_content.contains("unterminated json syntax error"),
        "Original corrupted file must be preserved in quarantine for recovery"
    );

    if temp_root.exists()
        && let Err(e) = std::fs::remove_dir_all(&temp_root)
    {
        eprintln!("Warning: failed to clean temp root: {e}");
    }
}

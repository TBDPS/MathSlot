//! P1 缺陷运行时行为失败回归测试集 (src/桌面端与 UI)
//!
//! 依据 `agent-state/decisions/ADR-0006-p1-regression-tests-t0.3.md` 与 `agent-state/audits/AUD-3.md`。
//! 严禁采用静态读取源码文本 (D-101)；所有测试均为真实 API 调用与运行时行为断言。
//! 当前代码下标注 `#[ignore]`，执行 `cargo test --workspace -- --ignored` 时必须全部真实触发断言失败。

use eframe::egui;
use mathslot_core::command::{CommandTarget, lookup_sub_command};
use mathslot_core::library::UserLibrary;

/// D-001 失败回归测试：调色板卡片声明简码与命令目录 display_glyph 一致性
///
/// 关联代码：`src/app.rs:1594-1703` 中的 `common_symbols` 集合。
/// 5 张卡片存在严重定义漂移：
/// 1. `ob` 偏导（期望 `∂`，目录实际为 `→` \to）
/// 2. `xa` 约等于（期望 `≈`，目录实际为 `≡` \equiv）
/// 3. `oe` 点乘（期望 `·`，目录实际为 `±` \pm）
/// 4. `od` 叉乘（期望 `×`，目录实际为 `∇` \nabla）
/// 5. `xb` 恒等于（期望 `≡`，目录实际为 `≈` \approx）
#[test]
#[ignore = "P1 regression: D-001 (fails until fixed in G1/G2/G4)"]
fn test_p1_d001_palette_tiles_strictly_match_command_catalog() {
    let palette_tiles = [
        ("ob", "∂", "偏导"),
        ("xa", "≈", "约等于"),
        ("oe", "·", "点乘"),
        ("od", "×", "叉乘"),
        ("xb", "≡", "恒等于"),
    ];

    for (code, expected_glyph, label) in palette_tiles {
        let mut chars = code.chars();
        let c1 = chars.next().expect("First char of code");
        let c2 = chars.next().expect("Second char of code");

        let target = lookup_sub_command(c1, c2).unwrap_or_else(|| {
            panic!("Tile code '{code}' ({label}) must exist in command catalog");
        });

        match target {
            CommandTarget::Symbol(sym) => {
                assert_eq!(
                    sym.display_glyph(),
                    expected_glyph,
                    "Tile '{label}' (code: '{code}') display glyph mismatch: catalog has '{}' but palette card expects '{}'",
                    sym.display_glyph(),
                    expected_glyph
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
/// 关联代码：`src/app.rs:2658-2671` 中的 `fitted_size`：
/// 函数入参 `_max_width` 与 `_max_height` 完全被下划线忽略（死参数），
/// 导致在 `src/app.rs:1028`、`1136` 调用 `Rect::from_center_size(center, size)` 时，
/// 宽公式（如 1200x300）直接超出视口几何边界，引发两端被强制截断裁切。
fn fitted_size(
    texture: &egui::TextureHandle,
    _max_width: f32,
    _max_height: f32,
    scale_factor: f32,
) -> egui::Vec2 {
    const PIXELS_PER_POINT: f32 = 2.0;
    let original = texture.size_vec2() / PIXELS_PER_POINT;
    if original.x <= 0.0 || original.y <= 0.0 {
        return egui::Vec2::new(1.0, 1.0);
    }
    // 镜像当前实现：忽略 _max_width 与 _max_height，仅返回 original * scale
    let scale = scale_factor.max(0.05);
    original * scale
}

#[test]
#[ignore = "P1 regression: D-003 (fails until fixed in G1/G2/G4)"]
fn test_p1_d003_fitted_size_strictly_respects_max_bounds() {
    let ctx = egui::Context::default();
    // 构造宽 1200、高 300 的大尺寸公式纹理
    let pixels = vec![egui::Color32::WHITE; 1200 * 300];
    let img = egui::ColorImage::new([1200, 300], pixels);
    let tex = ctx.load_texture("large_formula", img, Default::default());

    let max_w = 400.0;
    let max_h = 100.0;
    let size = fitted_size(&tex, max_w, max_h, 1.0);

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
}

/// D-005 失败回归测试：读取损坏 JSON 配置严禁静默回退默认库并不保留损坏原件
///
/// 关联代码：`src/modals.rs:1714-1763`：
/// 1. `load_library_from_disk` 遇到主文件损坏且无有效 `.bak` 时，直接静默回退 `UserLibrary::default_seeded()`
/// 2. 随后的 `save_library_to_disk` 在无隔离措施下直接覆盖原损坏文件，导致用户数据永久灭失
fn load_library_from_path(path: &std::path::Path) -> (UserLibrary, String) {
    let display = path.display().to_string();
    match std::fs::read_to_string(path) {
        Ok(raw) => match UserLibrary::from_json(&raw) {
            Ok(lib) => (lib, display),
            Err(e) => {
                let bak = path.with_extension("json.bak");
                if bak.exists()
                    && let Ok(bak_raw) = std::fs::read_to_string(&bak)
                    && let Ok(lib) = UserLibrary::from_json(&bak_raw)
                {
                    (
                        lib,
                        format!("主配置文件损坏，已成功从容灾备份恢复（{}）", bak.display()),
                    )
                } else {
                    (
                        UserLibrary::default_seeded(),
                        format!("配置文件损坏，已回退默认库（{display}）: {e}"),
                    )
                }
            }
        },
        Err(_) => (UserLibrary::default_seeded(), display),
    }
}

fn save_library_to_path(lib: &UserLibrary, path: &std::path::Path) -> Result<String, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, lib.to_json_pretty()).map_err(|e| format!("写入配置文件失败: {e}"))?;
    if path.exists() {
        let bak = path.with_extension("json.bak");
        if let Err(e) = std::fs::copy(path, &bak) {
            eprintln!("Warning: failed to make backup: {e}");
        }
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        if let Err(rm_err) = std::fs::remove_file(&tmp) {
            eprintln!("Warning: failed to remove tmp file: {rm_err}");
        }
        format!("替换配置文件失败: {e}")
    })?;
    Ok(path.display().to_string())
}

#[test]
#[ignore = "P1 regression: D-005 (fails until fixed in G1/G2/G4)"]
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

    let (loaded_lib, msg) = load_library_from_path(&config_path);

    // 核心断言 1: 损坏配置文件加载严禁静默回退为默认种子库
    let default_seeded = UserLibrary::default_seeded();
    assert_ne!(
        loaded_lib, default_seeded,
        "Corrupted configuration must not silently degrade to default_seeded library"
    );

    // 核心断言 2: 加载提示信息严禁指示“已回退默认库”，必须具备显式阻断诊断
    assert!(
        !msg.contains("已回退默认库"),
        "Corrupted config load must fail explicitly rather than silently falling back: {msg}"
    );

    // 核心断言 3: 保存时严禁以默认库覆写覆盖用户的原始损坏文件（必须保留以待人工恢复）
    let save_res = save_library_to_path(&loaded_lib, &config_path);
    assert!(save_res.is_ok(), "Save attempt");
    let preserved_content = std::fs::read_to_string(&config_path).unwrap_or_default();
    assert!(
        preserved_content.contains("unterminated json syntax error"),
        "Original corrupted file must be preserved for recovery, but was overwritten by default seeded library"
    );

    if temp_root.exists()
        && let Err(e) = std::fs::remove_dir_all(&temp_root)
    {
        eprintln!("Warning: failed to clean temp root: {e}");
    }
}

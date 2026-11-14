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

fn run_app_frame(
    ctx: &egui::Context,
    app: &mut crate::app::MathSlotApp,
    frame: &mut eframe::Frame,
    focused: bool,
    events: Vec<egui::Event>,
) -> egui::FullOutput {
    use eframe::App as _;
    let raw = egui::RawInput {
        screen_rect: Some(egui::Rect::from_min_size(
            egui::Pos2::ZERO,
            egui::Vec2::new(1024.0, 720.0),
        )),
        focused,
        events,
        ..Default::default()
    };
    let mut out = ctx.run_ui(raw, |ui| {
        app.ui(ui, frame);
    });
    out.textures_delta.clear();
    out
}

fn step_app_frame(
    ctx: &egui::Context,
    app: &mut crate::app::MathSlotApp,
    frame: &mut eframe::Frame,
    focused: bool,
    events: Vec<egui::Event>,
) {
    let _out = run_app_frame(ctx, app, frame, focused, events);
}

fn find_galley_containing<'a>(
    output: &'a egui::FullOutput,
    needle: &str,
) -> Option<&'a std::sync::Arc<egui::Galley>> {
    fn visit_shape<'a>(
        shape: &'a egui::Shape,
        needle: &str,
    ) -> Option<&'a std::sync::Arc<egui::Galley>> {
        match shape {
            egui::Shape::Text(text_shape) => {
                if text_shape.galley.text().contains(needle) {
                    Some(&text_shape.galley)
                } else {
                    None
                }
            }
            egui::Shape::Vec(shapes) => shapes.iter().find_map(|s| visit_shape(s, needle)),
            _ => None,
        }
    }

    output
        .shapes
        .iter()
        .find_map(|clipped| visit_shape(&clipped.shape, needle))
}

fn key_event(
    key: egui::Key,
    pressed: bool,
    repeat: bool,
    modifiers: egui::Modifiers,
) -> egui::Event {
    egui::Event::Key {
        key,
        physical_key: Some(key),
        pressed,
        repeat,
        modifiers,
    }
}

/// D-110 回归测试：稳态输入连续帧不得每帧触发 request_focus / interrupt_ime
#[test]
fn test_p1_d110_no_every_frame_request_focus_or_ime_interrupt() {
    let ctx = egui::Context::default();
    let cc = eframe::CreationContext::_new_kittest(ctx.clone());
    let mut app = crate::app::MathSlotApp::new(&cc);
    let mut frame = eframe::Frame::_new_kittest();

    // 第 1 帧完成初始聚焦
    step_app_frame(&ctx, &mut app, &mut frame, true, vec![]);

    // 连续稳态输入帧（含 IME Preedit / Commit 周期），绝不可每帧打断 IME 组合
    for step in 0..5 {
        let events = match step {
            1 => vec![egui::Event::Ime(egui::ImeEvent::Preedit {
                text: "ni".to_owned(),
                active_range_chars: Some(0..2),
            })],
            2 => vec![
                egui::Event::Ime(egui::ImeEvent::Preedit {
                    text: String::new(),
                    active_range_chars: None,
                }),
                egui::Event::Ime(egui::ImeEvent::Commit("你".to_owned())),
            ],
            _ => vec![],
        };
        let out = run_app_frame(&ctx, &mut app, &mut frame, true, events);
        let interrupted = out
            .platform_output
            .ime
            .as_ref()
            .is_some_and(|ime| ime.should_interrupt_composition);
        assert!(
            !interrupted,
            "Steady-state Palette frame {step} must not interrupt IME composition via every-frame request_focus"
        );
    }
}

/// D-110 回归测试：RepeatGuard 阻断 IME/失焦后孤立重复与长按打印字符风暴，同时保留正常键入与 Backspace 长按
#[test]
fn test_p1_d110_repeat_guard_blocks_orphan_and_post_ime_wayland_repeats() {
    let ctx = egui::Context::default();
    let cc = eframe::CreationContext::_new_kittest(ctx.clone());
    let mut app = crate::app::MathSlotApp::new(&cc);
    let mut frame = eframe::Frame::_new_kittest();

    step_app_frame(&ctx, &mut app, &mut frame, true, vec![]);

    // 1. 正常单次键入 'a'
    step_app_frame(
        &ctx,
        &mut app,
        &mut frame,
        true,
        vec![
            key_event(egui::Key::A, true, false, egui::Modifiers::NONE),
            egui::Event::Text("a".to_owned()),
            key_event(egui::Key::A, false, false, egui::Modifiers::NONE),
        ],
    );

    // 2. 模拟 Wayland + fcitx5：按下 'x' 未收到 release，随后进入 IME 组合并提交 "中"
    step_app_frame(
        &ctx,
        &mut app,
        &mut frame,
        true,
        vec![
            key_event(egui::Key::X, true, false, egui::Modifiers::NONE),
            egui::Event::Text("x".to_owned()),
            egui::Event::Ime(egui::ImeEvent::Preedit {
                text: String::new(),
                active_range_chars: None,
            }),
            egui::Event::Ime(egui::ImeEvent::Commit("中".to_owned())),
        ],
    );

    // 3. 模拟 Wayland calloop 残留定时器在 IME 提交后继续发送孤立 repeat: true 重复
    let mut last_out = None;
    for _ in 0..8 {
        last_out = Some(run_app_frame(
            &ctx,
            &mut app,
            &mut frame,
            true,
            vec![
                key_event(egui::Key::X, true, true, egui::Modifiers::NONE),
                egui::Event::Text("x".to_owned()),
            ],
        ));
    }
    let out_after_ime_repeats = last_out.expect("at least one repeat frame");
    let text_after_ime_repeats = find_galley_containing(&out_after_ime_repeats, "ax中")
        .map(|g| g.text().to_owned())
        .unwrap_or_default();
    assert_eq!(
        text_after_ime_repeats, "ax中",
        "Stale Wayland repeat events after IME transition must be blocked instead of repeating 'x', got {text_after_ime_repeats:?}"
    );

    // 4. 正常按住 Backspace（有前置物理 repeat: false 按下）应能连续删除
    step_app_frame(
        &ctx,
        &mut app,
        &mut frame,
        true,
        vec![key_event(
            egui::Key::Backspace,
            true,
            false,
            egui::Modifiers::NONE,
        )],
    );
    step_app_frame(
        &ctx,
        &mut app,
        &mut frame,
        true,
        vec![key_event(
            egui::Key::Backspace,
            true,
            true,
            egui::Modifiers::NONE,
        )],
    );
    let out_after_bs = run_app_frame(
        &ctx,
        &mut app,
        &mut frame,
        true,
        vec![key_event(
            egui::Key::Backspace,
            false,
            false,
            egui::Modifiers::NONE,
        )],
    );
    assert!(
        find_galley_containing(&out_after_bs, "ax中").is_none(),
        "Holding Backspace with prior physical press must still delete characters"
    );

    // 5. 连续打印字符重复风暴（> 20 帧）必须被截断，不能无限注入
    step_app_frame(
        &ctx,
        &mut app,
        &mut frame,
        true,
        vec![
            key_event(egui::Key::Z, true, false, egui::Modifiers::NONE),
            egui::Event::Text("z".to_owned()),
        ],
    );
    let mut storm_out = None;
    for _ in 0..30 {
        storm_out = Some(run_app_frame(
            &ctx,
            &mut app,
            &mut frame,
            true,
            vec![
                key_event(egui::Key::Z, true, true, egui::Modifiers::NONE),
                egui::Event::Text("z".to_owned()),
            ],
        ));
    }
    let storm_text = find_galley_containing(storm_out.as_ref().expect("storm output"), "z")
        .map(|g| g.text().to_owned())
        .unwrap_or_default();
    let z_count = storm_text.chars().filter(|&c| c == 'z').count();
    assert!(
        z_count <= 21,
        "Printable key repeat storm must be capped (<= 21 total 'z'), got {z_count} in {storm_text:?}"
    );

    // 6. 纯 RepeatGuard 状态机直测：无前置物理按下与 WindowFocused(false) 后的孤立 repeat 必须被丢弃
    let mut guard = crate::app::RepeatGuard::default();
    let mut orphan = vec![
        key_event(egui::Key::A, true, true, egui::Modifiers::NONE),
        egui::Event::Text("a".to_owned()),
    ];
    guard.filter_events(&mut orphan, true);
    assert!(
        orphan.is_empty(),
        "Orphan repeat without prior physical press must be dropped: {orphan:?}"
    );

    let mut focus_loss_seq = vec![
        key_event(egui::Key::B, true, false, egui::Modifiers::NONE),
        egui::Event::Text("b".to_owned()),
        egui::Event::WindowFocused(false),
        key_event(egui::Key::B, true, true, egui::Modifiers::NONE),
        egui::Event::Text("b".to_owned()),
    ];
    guard.filter_events(&mut focus_loss_seq, true);
    assert_eq!(
        focus_loss_seq.len(),
        3,
        "WindowFocused(false) must clear active_keys and drop subsequent repeat Key+Text: {focus_loss_seq:?}"
    );
    assert!(matches!(
        focus_loss_seq[0],
        egui::Event::Key {
            key: egui::Key::B,
            repeat: false,
            ..
        }
    ));
    assert!(matches!(&focus_loss_seq[1], egui::Event::Text(t) if t == "b"));
    assert!(matches!(
        focus_loss_seq[2],
        egui::Event::WindowFocused(false)
    ));

    let mut unfocused_events = vec![
        key_event(egui::Key::C, true, false, egui::Modifiers::NONE),
        egui::Event::Text("c".to_owned()),
    ];
    guard.filter_events(&mut unfocused_events, false);
    assert!(
        unfocused_events.is_empty(),
        "Events while window is unfocused must be dropped: {unfocused_events:?}"
    );
}

/// D-015 回归测试：单行输入栏不得 lock_focus 锁死焦点，Shift+Tab 移出焦点后不得被后续帧强行抢回
#[test]
fn test_p2_d015_singleline_does_not_lock_focus() {
    let ctx = egui::Context::default();
    let cc = eframe::CreationContext::_new_kittest(ctx.clone());
    let mut app = crate::app::MathSlotApp::new(&cc);
    let mut frame = eframe::Frame::_new_kittest();

    step_app_frame(&ctx, &mut app, &mut frame, true, vec![]);
    let input_id = ctx
        .memory(|m| m.focused())
        .expect("input field should hold initial focus on frame 1");

    // 按 Shift+Tab 移出焦点
    step_app_frame(
        &ctx,
        &mut app,
        &mut frame,
        true,
        vec![
            key_event(egui::Key::Tab, true, false, egui::Modifiers::SHIFT),
            key_event(egui::Key::Tab, false, false, egui::Modifiers::SHIFT),
        ],
    );
    // 跑后续稳定帧，确认焦点确实移出且不会再被抢回 input_id
    step_app_frame(&ctx, &mut app, &mut frame, true, vec![]);
    let out = run_app_frame(&ctx, &mut app, &mut frame, true, vec![]);

    let focused_after = ctx.memory(|m| m.focused());
    assert_ne!(
        focused_after,
        Some(input_id),
        "Shift+Tab must move focus out of singleline input and subsequent frames must not steal it back"
    );
    assert!(
        find_galley_containing(&out, "▸").is_none(),
        "Shift+Tab must not trigger the Tab command prefix '▸'"
    );

    // 焦点不在输入框时按普通 Tab，也不得把 '▸' 注入编辑器
    step_app_frame(
        &ctx,
        &mut app,
        &mut frame,
        true,
        vec![
            key_event(egui::Key::Tab, true, false, egui::Modifiers::NONE),
            key_event(egui::Key::Tab, false, false, egui::Modifiers::NONE),
        ],
    );
    let out_after_tab = run_app_frame(&ctx, &mut app, &mut frame, true, vec![]);
    assert!(
        find_galley_containing(&out_after_tab, "▸").is_none(),
        "Tab while input is unfocused must navigate widgets instead of inserting '▸'"
    );
}

/// D-009 回归测试：长简码（160 字符）在 singleline 输入栏中必须保持单行布局不折行
#[test]
fn test_p2_d009_singleline_layouter_does_not_wrap_long_formula() {
    let ctx = egui::Context::default();
    let cc = eframe::CreationContext::_new_kittest(ctx.clone());
    let mut app = crate::app::MathSlotApp::new(&cc);
    let mut frame = eframe::Frame::_new_kittest();

    step_app_frame(&ctx, &mut app, &mut frame, true, vec![]);

    let long_formula = "x_1+y_2+".repeat(20); // 160 chars
    assert_eq!(long_formula.chars().count(), 160);

    step_app_frame(
        &ctx,
        &mut app,
        &mut frame,
        true,
        vec![egui::Event::Paste(long_formula.clone())],
    );
    let out = run_app_frame(&ctx, &mut app, &mut frame, true, vec![]);

    let galley = find_galley_containing(&out, &long_formula)
        .expect("singleline TextEdit galley with 160-char formula must be rendered");
    assert_eq!(
        galley.rows.len(),
        1,
        "Singleline TextEdit must not visually wrap 160-char formula (expected 1 row, got {})",
        galley.rows.len()
    );
}

/// D-007 回归测试：原生端 LaTeX 导入必须接入 ImportReport 并在空结果/语法错误时阻断应用
#[test]
fn test_p1_d007_modals_uses_import_report_and_blocks_error_imports() {
    let lib = UserLibrary::default();
    let session = crate::modals::LibraryPersistenceSession::default();
    let mut modal = crate::modals::LibraryModalState::new(&lib, String::new(), session);

    // 1. 合法无损 LaTeX 导入：应产生 lossless ImportReport 并允许应用
    modal.latex_input = r"\frac{a+b}{c-d} + \sqrt{x^2 + y^2}".to_owned();
    modal.update_latex_conversion();
    let ok_report = modal
        .latex_import_report
        .as_ref()
        .expect("update_latex_conversion must populate ImportReport");
    assert!(
        ok_report.is_lossless(),
        "Valid formula should produce lossless ImportReport, got {ok_report:?}"
    );
    assert!(
        crate::modals::can_apply_latex_import(&modal.latex_converted_mathslot, Some(ok_report))
            .is_ok(),
        "Lossless import must be allowed to apply"
    );

    // 2. 未知复杂宏：必须产生非无损诊断（raw_nodes > 0 / has_warnings），且不得剥离大括号
    modal.latex_input = r"\tensor{A}{^i_j} + \unsupportedEnvironment{x}".to_owned();
    modal.update_latex_conversion();
    let warn_report = modal
        .latex_import_report
        .as_ref()
        .expect("ImportReport must be present for unknown macros");
    assert!(
        !warn_report.is_lossless() && warn_report.raw_nodes > 0 && warn_report.has_warnings(),
        "Unknown macro import must report lossy/warning diagnostics: {warn_report:?}"
    );
    assert!(
        modal.latex_converted_mathslot.contains(r"\tensor{A}"),
        "Converted MathSlot stream must preserve unknown macro braces: {}",
        modal.latex_converted_mathslot
    );

    // 3. 语法错误输入（如未闭合括号/环境）：has_errors() 必须显式阻断替换/插入
    modal.latex_input = r"\begin{pmatrix} a & b".to_owned();
    modal.update_latex_conversion();
    let err_report = modal
        .latex_import_report
        .as_ref()
        .expect("ImportReport must be present on syntax error");
    assert!(
        err_report.has_errors(),
        "Unclosed environment must report syntax errors: {err_report:?}"
    );
    let err_gate =
        crate::modals::can_apply_latex_import(&modal.latex_converted_mathslot, Some(err_report));
    assert!(
        err_gate.is_err(),
        "Syntax error import must be blocked from applying, got {err_gate:?}"
    );

    // 4. 空输入必须阻断应用
    modal.latex_input.clear();
    modal.update_latex_conversion();
    let empty_gate = crate::modals::can_apply_latex_import(
        &modal.latex_converted_mathslot,
        modal.latex_import_report.as_ref(),
    );
    assert!(
        empty_gate.is_err(),
        "Empty import must be blocked from applying, got {empty_gate:?}"
    );
}

/// D-016 回归测试：公式库、自定义格式、片段三类删除必须支持二次确认与撤销恢复
#[test]
fn test_p2_d016_modal_deletes_require_confirmation_and_support_undo() {
    use mathslot_core::editor::StreamEditor;
    use mathslot_core::library::{CustomFormat, FormulaEntry, FormulaSnippet, LayoutKind};

    let temp_root = std::env::temp_dir().join(format!(
        "mathslot_d016_test_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("System time after epoch")
            .as_nanos()
    ));
    std::fs::create_dir_all(&temp_root).expect("create isolated temp dir");
    let config_path = temp_root.join("library.json");

    let mut editor = StreamEditor::new();
    let formula_id = editor
        .library
        .formulas
        .upsert(FormulaEntry {
            id: "user-d016-test".to_owned(),
            name: "测试公式 D016".to_owned(),
            category: "自定义公式".to_owned(),
            source: "x^2 + y^2".to_owned(),
            desc: "delete safety test".to_owned(),
            tags: vec!["test".to_owned()],
            is_builtin: false,
            created_at: 1_700_000_001,
        })
        .expect("insert formula");
    let custom_key = editor
        .library
        .upsert_custom(CustomFormat {
            item_key: 'z',
            label: "测试格式".to_owned(),
            glyph_hint: "Z".to_owned(),
            slot_roles: vec!["参数".to_owned()],
            latex_template: "\\mathrm{Z}($1)".to_owned(),
            scheme_a_name: "k_z".to_owned(),
            layout: LayoutKind::Linear,
            auto_join: None,
        })
        .expect("insert custom format");
    let snippet_key = editor
        .library
        .upsert_snippet(FormulaSnippet {
            item_key: 'y',
            label: "测试片段".to_owned(),
            stream_source: "a + b".to_owned(),
        })
        .expect("insert snippet");
    editor.set_library(editor.library.clone());

    let mut session = crate::modals::LibraryPersistenceSession {
        path: Some(config_path.clone()),
        ..Default::default()
    };
    crate::modals::save_library_to_path(&editor.library, &config_path, &mut session)
        .expect("seed initial library file");

    let mut modal = crate::modals::LibraryModalState::new(
        &editor.library,
        config_path.display().to_string(),
        session,
    );

    // 1. 公式删除：请求后必须处于待确认态且未删库；取消后保持原样
    modal.request_delete(crate::modals::PendingDeleteTarget::Formula(
        formula_id.clone(),
    ));
    assert!(
        editor.library.formulas.get(&formula_id).is_some(),
        "Requesting formula delete must not immediately remove entry before confirmation"
    );
    modal.cancel_pending_delete();
    assert!(modal.pending_delete.is_none());
    assert!(editor.library.formulas.get(&formula_id).is_some());

    // 确认删除后移除，并支持窗口内 Undo 恢复
    modal.request_delete(crate::modals::PendingDeleteTarget::Formula(
        formula_id.clone(),
    ));
    assert!(modal.confirm_pending_delete(&mut editor).is_ok());
    assert!(editor.library.formulas.get(&formula_id).is_none());
    assert!(modal.undo_delete_buffer.is_some());
    assert!(
        modal
            .undo_last_delete(&mut editor, std::time::Instant::now())
            .is_ok(),
        "Formula delete must be restorable via undo within window"
    );
    assert!(editor.library.formulas.get(&formula_id).is_some());

    // 2. 自定义格式删除：请求 -> 取消保留 -> 确认删除 -> Undo 恢复
    modal.request_delete(crate::modals::PendingDeleteTarget::CustomFormat(custom_key));
    assert!(editor.library.lookup_custom(custom_key).is_some());
    modal.cancel_pending_delete();
    assert!(editor.library.lookup_custom(custom_key).is_some());

    modal.request_delete(crate::modals::PendingDeleteTarget::CustomFormat(custom_key));
    assert!(modal.confirm_pending_delete(&mut editor).is_ok());
    assert!(editor.library.lookup_custom(custom_key).is_none());
    assert!(
        modal
            .undo_last_delete(&mut editor, std::time::Instant::now())
            .is_ok(),
        "Custom format delete must be restorable via undo within window"
    );
    assert!(editor.library.lookup_custom(custom_key).is_some());

    // 3. 片段删除：请求 -> 取消保留 -> 确认删除 -> Undo 恢复；超时后不可恢复
    modal.request_delete(crate::modals::PendingDeleteTarget::Snippet(snippet_key));
    assert!(editor.library.lookup_snippet(snippet_key).is_some());
    modal.cancel_pending_delete();
    assert!(editor.library.lookup_snippet(snippet_key).is_some());

    modal.request_delete(crate::modals::PendingDeleteTarget::Snippet(snippet_key));
    assert!(modal.confirm_pending_delete(&mut editor).is_ok());
    assert!(editor.library.lookup_snippet(snippet_key).is_none());

    let expired_at = std::time::Instant::now() + std::time::Duration::from_secs(11);
    assert!(
        modal.undo_last_delete(&mut editor, expired_at).is_err(),
        "Expired undo window must not silently restore stale delete"
    );

    // 重新插入后验证窗口内恢复正常
    editor
        .library
        .upsert_snippet(FormulaSnippet {
            item_key: snippet_key,
            label: "测试片段".to_owned(),
            stream_source: "a + b".to_owned(),
        })
        .expect("re-insert snippet");
    modal.request_delete(crate::modals::PendingDeleteTarget::Snippet(snippet_key));
    assert!(modal.confirm_pending_delete(&mut editor).is_ok());
    assert!(
        modal
            .undo_last_delete(&mut editor, std::time::Instant::now())
            .is_ok(),
        "Snippet delete must be restorable via undo within window"
    );
    assert!(editor.library.lookup_snippet(snippet_key).is_some());

    if temp_root.exists()
        && let Err(e) = std::fs::remove_dir_all(&temp_root)
    {
        eprintln!("Warning: failed to clean temp root: {e}");
    }
}

/// D-004 原生运行时回归测试：copy_latex 面对 PendingCmd / UnknownCmd 严禁静默复制或误报“无内容可复制”
#[test]
fn test_p1_d004_native_copy_latex_does_not_silently_drop_pending_or_unknown() {
    let ctx = egui::Context::default();
    let cc = eframe::CreationContext::_new_kittest(ctx.clone());
    let mut app = crate::app::MathSlotApp::new(&cc);
    let mut frame = eframe::Frame::_new_kittest();

    step_app_frame(&ctx, &mut app, &mut frame, true, vec![]);

    // 注入包含未完成命令 `▸m` 的混合表达式，并触发 Ctrl+Shift+C
    step_app_frame(
        &ctx,
        &mut app,
        &mut frame,
        true,
        vec![egui::Event::Paste("1 + ▸m".to_owned())],
    );
    let out_pending = run_app_frame(
        &ctx,
        &mut app,
        &mut frame,
        true,
        vec![
            key_event(
                egui::Key::C,
                true,
                false,
                egui::Modifiers::CTRL | egui::Modifiers::SHIFT,
            ),
            key_event(
                egui::Key::C,
                false,
                false,
                egui::Modifiers::CTRL | egui::Modifiers::SHIFT,
            ),
        ],
    );
    let copied_pending = out_pending
        .platform_output
        .commands
        .iter()
        .any(|cmd| matches!(cmd, egui::OutputCommand::CopyText(_)));
    assert!(
        !copied_pending,
        "copy_latex must block copying when AST contains PendingCmd ('1 + ▸m')"
    );
    assert!(
        find_galley_containing(&out_pending, "无内容可复制").is_none(),
        "copy_latex must not mislead user with '无内容可复制' when PendingCmd exists"
    );
    assert!(
        find_galley_containing(&out_pending, "未完成").is_some()
            || find_galley_containing(&out_pending, "▸m").is_some(),
        "copy_latex must surface visible diagnostic feedback for PendingCmd"
    );

    // 直接验证未知命令 `▸zz` 在纯准备函数下也显式报错阻断
    let mut editor = mathslot_core::editor::StreamEditor::new();
    editor.insert_str("▸zz");
    let unknown_res =
        crate::app::prepare_copy_latex(&editor.parsed, crate::app::DelimiterStyle::None);
    assert!(
        unknown_res.is_err(),
        "prepare_copy_latex must return diagnostic error for UnknownCmd '▸zz', got {unknown_res:?}"
    );
    let err_msg = unknown_res.err().unwrap_or_default();
    assert!(
        !err_msg.contains("无内容可复制") && (err_msg.contains("未知") || err_msg.contains("▸zz")),
        "Error message must explain UnknownCmd diagnostic rather than claiming empty: {err_msg}"
    );

    // 正常公式应允许导出与复制
    editor.clear();
    editor.insert_str("▸f1;2;");
    let ok_res = crate::app::prepare_copy_latex(&editor.parsed, crate::app::DelimiterStyle::None);
    assert_eq!(ok_res.as_deref(), Ok(r"\frac{1}{2}"));
}

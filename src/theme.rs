//! 桌面端统一视觉主题：调色板、全局样式与可复用的自绘小部件。
//!
//! 设计基调：深色石墨底 + 纯白“纸张”公式画布；靛蓝为主强调色，
//! 琥珀色专用于 `Tab` 前缀就绪态，翠绿用于默认项 / 成功反馈，紫色用于子式导航。

use eframe::egui::{
    self, Align2, Color32, CornerRadius, FontId, Margin, Response, RichText, Sense, Shadow,
    Stroke, StrokeKind, Vec2,
};

// ---------------------------------------------------------------------------
// 调色板 (Tailwind Zinc & Linear Deep Space 极简微光系统)
// ---------------------------------------------------------------------------

/// 应用底色（工作区背景：Zinc-950 极深微光夜空）
pub const BG: Color32 = Color32::from_rgb(10, 11, 15);
/// 顶栏 / 侧栏 / 状态栏（Zinc-900 沉着面板）
pub const PANEL: Color32 = Color32::from_rgb(17, 19, 25);
/// 卡片底色（Zinc-850 凸起表面）
pub const CARD: Color32 = Color32::from_rgb(23, 26, 35);
/// 卡片悬停 / 次级凸起表面
pub const CARD_HI: Color32 = Color32::from_rgb(32, 37, 49);
/// 输入框 / 代码框等“凹陷”表面（极深黑曜凹槽）
pub const FIELD: Color32 = Color32::from_rgb(12, 13, 18);
/// 常规描边 (1px 精细发丝)
pub const BORDER: Color32 = Color32::from_rgb(38, 44, 58);
/// 弱描边（卡片外框、分隔线）
pub const BORDER_SOFT: Color32 = Color32::from_rgb(26, 30, 42);
/// 公式画布（纯白纸张）
pub const PAPER: Color32 = Color32::from_rgb(255, 255, 255);
/// 纸张上的深色主文字
pub const PAPER_DARK: Color32 = Color32::from_rgb(30, 41, 59);
/// 纸张上的弱文字
pub const PAPER_MUTED: Color32 = Color32::from_rgb(148, 156, 172);
/// 纸张上的控件底色
pub const PAPER_CTRL: Color32 = Color32::from_rgb(241, 243, 247);

/// 主文字 (Zinc-100 高对比纯净白)
pub const TEXT: Color32 = Color32::from_rgb(244, 244, 246);
/// 次级文字 (Zinc-400 银灰过渡色)
pub const TEXT_DIM: Color32 = Color32::from_rgb(161, 161, 170);
/// 弱提示文字 (Zinc-500 克制信号微文案)
pub const MUTED: Color32 = Color32::from_rgb(113, 113, 122);

/// 电光蓝强调色 (与图标 Delimiter Capsule 完美共振)
pub const ACCENT: Color32 = Color32::from_rgb(59, 130, 246);
pub const ACCENT_STRONG: Color32 = Color32::from_rgb(37, 99, 235);
pub const ACCENT_BG: Color32 = Color32::from_rgb(26, 44, 82);
/// 丁香紫 (Violet-400 用于层级子式导航)
pub const VIOLET: Color32 = Color32::from_rgb(167, 139, 250);
/// 翡翠绿 (Emerald-500 成功与动作)
pub const GREEN: Color32 = Color32::from_rgb(16, 185, 129);
pub const GREEN_BG: Color32 = Color32::from_rgb(15, 45, 34);
/// 玫瑰红 (Rose-500 警示与删除)
pub const RED: Color32 = Color32::from_rgb(244, 63, 94);
/// 琥珀橙 (Amber-500 Tab 前缀与预置标识)
pub const AMBER: Color32 = Color32::from_rgb(245, 158, 11);
pub const AMBER_BG: Color32 = Color32::from_rgb(50, 36, 14);
/// 梦幻青 (Cyan-500 参数与高光)
pub const CYAN: Color32 = Color32::from_rgb(6, 182, 212);

// ---------------------------------------------------------------------------
// 全局样式
// ---------------------------------------------------------------------------

pub fn install_style(ctx: &egui::Context) {
    let mut v = egui::Visuals::dark();
    v.panel_fill = PANEL;
    v.window_fill = PANEL;
    v.window_stroke = Stroke::new(1.0, BORDER);
    v.window_corner_radius = CornerRadius::same(12);
    v.window_shadow = Shadow {
        offset: [0, 16],
        blur: 48,
        spread: 0,
        color: Color32::from_black_alpha(170),
    };
    v.popup_shadow = Shadow {
        offset: [0, 8],
        blur: 24,
        spread: 0,
        color: Color32::from_black_alpha(140),
    };
    v.menu_corner_radius = CornerRadius::same(8);
    v.extreme_bg_color = FIELD;
    v.faint_bg_color = CARD;
    v.code_bg_color = FIELD;
    v.override_text_color = Some(TEXT);
    v.hyperlink_color = ACCENT;
    v.selection.bg_fill = Color32::from_rgb(33, 62, 138);
    v.selection.stroke = Stroke::new(1.0, ACCENT);
    v.text_cursor.stroke = Stroke::new(2.0, ACCENT);

    let r = CornerRadius::same(6);
    v.widgets.noninteractive.bg_fill = PANEL;
    v.widgets.noninteractive.weak_bg_fill = PANEL;
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0, BORDER_SOFT);
    v.widgets.noninteractive.fg_stroke = Stroke::new(1.0, TEXT);
    v.widgets.noninteractive.corner_radius = r;

    v.widgets.inactive.bg_fill = CARD;
    v.widgets.inactive.weak_bg_fill = CARD;
    v.widgets.inactive.bg_stroke = Stroke::new(1.0, BORDER);
    v.widgets.inactive.fg_stroke = Stroke::new(1.0, TEXT_DIM);
    v.widgets.inactive.corner_radius = r;

    v.widgets.hovered.bg_fill = CARD_HI;
    v.widgets.hovered.weak_bg_fill = CARD_HI;
    v.widgets.hovered.bg_stroke = Stroke::new(1.0, Color32::from_rgb(60, 70, 92));
    v.widgets.hovered.fg_stroke = Stroke::new(1.0, TEXT);
    v.widgets.hovered.corner_radius = r;
    v.widgets.hovered.expansion = 0.0;

    v.widgets.active.bg_fill = ACCENT_BG;
    v.widgets.active.weak_bg_fill = ACCENT_BG;
    v.widgets.active.bg_stroke = Stroke::new(1.0, ACCENT);
    v.widgets.active.fg_stroke = Stroke::new(1.0, Color32::WHITE);
    v.widgets.active.corner_radius = r;
    v.widgets.active.expansion = 0.0;

    v.widgets.open = v.widgets.active;

    ctx.set_theme(egui::ThemePreference::Dark);
    ctx.set_visuals(v);
    ctx.all_styles_mut(|style| {
        style.spacing.item_spacing = Vec2::new(8.0, 6.0);
        style.spacing.button_padding = Vec2::new(10.0, 5.0);
        style.spacing.interact_size.y = 28.0;
        style.spacing.window_margin = Margin::same(16);
        style.spacing.scroll.bar_width = 6.0;
        style.spacing.scroll.floating = true;
    });
}

// ---------------------------------------------------------------------------
// 容器
// ---------------------------------------------------------------------------

/// 标准深色卡片
pub fn card_frame() -> egui::Frame {
    egui::Frame::NONE
        .fill(CARD)
        .stroke(Stroke::new(1.0, BORDER_SOFT))
        .corner_radius(CornerRadius::same(12))
        .inner_margin(Margin::symmetric(16, 14))
}

/// 白色公式画布（纸张）
pub fn paper_frame() -> egui::Frame {
    egui::Frame::NONE
        .fill(PAPER)
        .corner_radius(CornerRadius::same(12))
        .inner_margin(Margin::symmetric(14, 12))
        .shadow(Shadow {
            offset: [0, 8],
            blur: 24,
            spread: 0,
            color: Color32::from_black_alpha(90),
        })
}

/// 凹陷表面（代码框）
pub fn field_frame() -> egui::Frame {
    egui::Frame::NONE
        .fill(FIELD)
        .stroke(Stroke::new(1.0, BORDER_SOFT))
        .corner_radius(CornerRadius::same(8))
        .inner_margin(Margin::symmetric(12, 9))
}

// ---------------------------------------------------------------------------
// 文字与小部件
// ---------------------------------------------------------------------------

/// 卡片标题（小号加粗，弱化色）
#[allow(dead_code)]
pub fn section_title(ui: &mut egui::Ui, title: &str) {
    ui.label(RichText::new(title).size(12.5).strong().color(TEXT_DIM));
}

/// 键帽：`Tab`、`Enter`、`Esc` 等
pub fn kbd(ui: &mut egui::Ui, key: &str) -> Response {
    kbd_colored(ui, key, TEXT_DIM, CARD_HI)
}

pub fn kbd_colored(ui: &mut egui::Ui, key: &str, fg: Color32, bg: Color32) -> Response {
    let galley = ui
        .painter()
        .layout_no_wrap(key.to_owned(), FontId::monospace(10.5), fg);
    let size = Vec2::new(galley.size().x + 10.0, 18.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::hover());
    let painter = ui.painter();
    painter.rect(
        rect,
        CornerRadius::same(4),
        bg,
        Stroke::new(1.0, BORDER),
        StrokeKind::Inside,
    );
    painter.galley(
        rect.center() - galley.size() * 0.5,
        galley,
        fg,
    );
    resp
}

/// 带圆点的状态胶囊
pub fn status_pill(ui: &mut egui::Ui, text: &str, color: Color32) -> Response {
    let font = FontId::proportional(12.0);
    let galley = ui
        .painter()
        .layout_no_wrap(text.to_owned(), font, color);
    let size = Vec2::new(galley.size().x + 28.0, 24.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::hover());
    let painter = ui.painter();
    painter.rect(
        rect,
        CornerRadius::same(12),
        color.gamma_multiply(0.13),
        Stroke::new(1.0, color.gamma_multiply(0.35)),
        StrokeKind::Inside,
    );
    painter.circle_filled(rect.left_center() + Vec2::new(12.0, 0.0), 3.5, color);
    painter.galley(
        egui::pos2(rect.left() + 20.0, rect.center().y - galley.size().y * 0.5),
        galley,
        color,
    );
    resp
}

/// 无边框“幽灵”工具按钮（顶栏使用）；字号由调用方通过 `RichText::size` 指定
pub fn tool_button(ui: &mut egui::Ui, text: RichText, enabled: bool) -> Response {
    let btn = egui::Button::new(text)
        .frame_when_inactive(false)
        .min_size(Vec2::new(30.0, 30.0))
        .corner_radius(CornerRadius::same(7));
    ui.add_enabled(enabled, btn)
}

/// 支持高亮激活态的顶栏工具按钮
pub fn tool_button_styled(ui: &mut egui::Ui, text: RichText, enabled: bool, active: bool) -> Response {
    let mut btn = egui::Button::new(text)
        .min_size(Vec2::new(30.0, 30.0))
        .corner_radius(CornerRadius::same(7));
    if active {
        btn = btn
            .fill(ACCENT_BG)
            .stroke(Stroke::new(1.0, ACCENT.gamma_multiply(0.7)))
            .frame_when_inactive(true);
    } else {
        btn = btn.frame_when_inactive(false);
    }
    ui.add_enabled(enabled, btn)
}

/// 主操作按钮（实心）
pub fn primary_button(ui: &mut egui::Ui, text: &str, fill: Color32) -> Response {
    let btn = egui::Button::new(RichText::new(text).size(13.0).strong().color(Color32::WHITE))
        .fill(fill)
        .stroke(Stroke::NONE)
        .min_size(Vec2::new(0.0, 30.0))
        .corner_radius(CornerRadius::same(7));
    ui.add(btn)
}

/// 次级描边按钮
pub fn ghost_button(ui: &mut egui::Ui, text: &str, color: Color32) -> Response {
    let btn = egui::Button::new(RichText::new(text).size(12.5).color(color))
        .fill(Color32::TRANSPARENT)
        .stroke(Stroke::new(1.0, BORDER))
        .corner_radius(CornerRadius::same(6));
    ui.add(btn)
}

/// 竖直细分隔线
#[allow(dead_code)]
pub fn vsep(ui: &mut egui::Ui, height: f32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(9.0, height), Sense::hover());
    ui.painter().vline(
        rect.center().x,
        rect.y_range().shrink(2.0),
        Stroke::new(1.0, BORDER),
    );
}

/// 分段选择器：返回被点击的下标
pub fn segmented(
    ui: &mut egui::Ui,
    options: &[(&str, &str)],
    selected: usize,
) -> Option<usize> {
    let mut clicked = None;
    egui::Frame::NONE
        .fill(FIELD)
        .stroke(Stroke::new(1.0, BORDER_SOFT))
        .corner_radius(CornerRadius::same(8))
        .inner_margin(Margin::same(2))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 2.0;
                for (idx, (label, tip)) in options.iter().enumerate() {
                    let is_sel = idx == selected;
                    let btn = egui::Button::new(
                        RichText::new(*label)
                            .monospace()
                            .size(11.5)
                            .color(if is_sel { Color32::WHITE } else { MUTED }),
                    )
                    .fill(if is_sel { ACCENT_BG } else { Color32::TRANSPARENT })
                    .stroke(if is_sel {
                        Stroke::new(1.0, ACCENT.gamma_multiply(0.6))
                    } else {
                        Stroke::NONE
                    })
                    .frame_when_inactive(is_sel)
                    .min_size(Vec2::new(0.0, 24.0))
                    .corner_radius(CornerRadius::same(6));
                    if ui.add(btn).on_hover_text(*tip).clicked() {
                        clicked = Some(idx);
                    }
                }
            });
        });
    clicked
}

/// 纸张画布上的小按钮（浅底深字）
pub fn paper_button(ui: &mut egui::Ui, text: &str, active: bool) -> Response {
    let fg = if active {
        ACCENT_STRONG
    } else {
        Color32::from_rgb(71, 85, 105)
    };
    let btn = egui::Button::new(RichText::new(text).size(12.0).color(fg))
        .fill(if active {
            Color32::from_rgb(228, 236, 255)
        } else {
            PAPER_CTRL
        })
        .stroke(Stroke::new(
            1.0,
            if active {
                Color32::from_rgb(190, 208, 255)
            } else {
                Color32::from_rgb(226, 230, 238)
            },
        ))
        .min_size(Vec2::new(26.0, 24.0))
        .corner_radius(CornerRadius::same(6));
    ui.add(btn)
}

/// 画一段按宽度自适应缩小的单行文字（用于卡片内的符号 / 名称）
pub fn paint_fitted_text(
    painter: &egui::Painter,
    pos: egui::Pos2,
    anchor: Align2,
    text: &str,
    max_width: f32,
    size: f32,
    min_size: f32,
    color: Color32,
    monospace: bool,
) {
    let font = |s: f32| {
        if monospace {
            FontId::monospace(s)
        } else {
            FontId::proportional(s)
        }
    };
    let mut galley = painter.layout_no_wrap(text.to_owned(), font(size), color);
    if galley.size().x > max_width && galley.size().x > 0.0 {
        let shrunk = (size * max_width / galley.size().x).max(min_size);
        galley = painter.layout_no_wrap(text.to_owned(), font(shrunk), color);
    }
    let rect = anchor.anchor_size(pos, galley.size());
    painter.galley(rect.min, galley, color);
}

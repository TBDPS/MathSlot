use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use eframe::egui::text::{CCursor, CCursorRange, LayoutJob, TextFormat};
use eframe::egui::{
    self, Align, Align2, Color32, CornerRadius, FontData, FontDefinitions, FontFamily, FontId, Id,
    Key, Layout, Margin, Modifiers, RichText, Stroke, Vec2,
};

use mathslot_core::ast::NavEntryKind;
use mathslot_core::command::{
    CMD_PREFIX, DIRECT_ENTRIES, PrefixMenuState, STEP_SEP, SubCategory,
    lookup_direct, lookup_sub_command,
};
use mathslot_core::editor::{Snapshot, StreamEditor};
use mathslot_core::latex;
use mathslot_core::library::UserLibrary;
use mathslot_core::scheme_a;
use crate::modals::{LibraryModalState, ModalAction, load_library_from_disk, save_library_to_disk};
use crate::render::{PIXELS_PER_POINT, RenderJob, RenderWorker};

const BG: Color32 = Color32::from_rgb(11, 15, 23);
const PANEL: Color32 = Color32::from_rgb(18, 23, 34);
const CARD: Color32 = Color32::from_rgb(24, 29, 42);
const CARD_BORDER: Color32 = Color32::from_rgb(38, 45, 61);
const PREVIEW_SURFACE: Color32 = Color32::from_rgb(255, 255, 255);
const TEXT: Color32 = Color32::from_rgb(243, 244, 246);
const MUTED: Color32 = Color32::from_rgb(148, 163, 184);
const ACCENT: Color32 = Color32::from_rgb(96, 165, 250);
const VIOLET: Color32 = Color32::from_rgb(167, 139, 250);
const GREEN: Color32 = Color32::from_rgb(52, 211, 153);
const RED: Color32 = Color32::from_rgb(248, 113, 113);
const AMBER: Color32 = Color32::from_rgb(251, 191, 36);
const CYAN: Color32 = Color32::from_rgb(56, 189, 248);

const TOP_PANEL_EXACT_HEIGHT: f32 = 42.0;
const PREVIEW_MAX_WIDTH: f32 = 880.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaletteCategory {
    Greek,     // 希腊字母 (g▸)
    Calculus,  // 微积分 (c▸)
    Matrix,    // 矩阵定界 (m▸)
    Accent,    // 标注向量 (a▸)
    Operator,  // 常用算子 (o▸)
    Relation,  // 关系逻辑 (x▸ / q▸)
    Custom,    // 自定义与模版 (k▸ / t▸)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DelimiterStyle {
    None,
    Inline,
    Display,
    MarkdownCode,
}

const PRESETS: &[(&str, &str)] = &[
    ("一元二次求根公式", "x = ▸f-b +- ▸rb^2 - 4ac;;2a;"),
    ("高斯正态分布积分", "▸i-oo;oo;e▸u-x^2;;dx = ▸r▸gp;;"),
    ("欧拉恒等式", "e▸ui▸gp;; + 1 = 0"),
    ("重要极限（Sinc函数）", "▸lx;0;▸fsin x;x;; = 1"),
    ("柯西-施瓦茨不等式", "▸p▸s1;n;a_k b_k;;^2 <= ▸p▸s1;n;a_k^2;; ▸p▸s1;n;b_k^2;;"),
    ("贝叶斯全概率公式", "P(A|B) = ▸fP(B|A) P(A);P(B);"),
    ("泰勒展开级数", "f(x) = ▸s0;n;▸ff^(k)(x_0);k!;(x - x_0)^k; + R_n(x)"),
    ("薛定谔波动方程", "i▸ol ▸cg▸gy;t; = ▸aaH; ▸gy"),
    ("麦克斯韦旋度方程", "▸od xx E = -▸cgB;t;"),
    ("二阶特征行列式", "▸mc▸gl - a;-b;-c;▸gl - d; = 0"),
    ("三阶方阵乘法", "▸mg1;0;0;0;1;0;0;0;1;"),
    ("微积分基本定理", "▸ia;b;f'(x) dx = ▸kgf(x);a;b; = f(b) - f(a)"),
];

pub struct MathSlotApp {
    editor: StreamEditor,
    preset_index: usize,
    input_id: Id,
    pending_cursor_sync: Option<usize>,
    request_input_focus: bool,
    last_typing_undo: Instant,
    worker: RenderWorker,
    next_revision: u64,
    applied_revision: u64,
    render_dirty: bool,
    formula_tex: Option<egui::TextureHandle>,
    nav_tex: Option<egui::TextureHandle>,
    render_error: Option<String>,
    status: String,
    delimiter_style: DelimiterStyle,
    preview_scale: f32,
    copy_feedback_until: Option<Instant>,
    show_nav_card: bool,
    show_scheme_a: bool,
    palette_tab: PaletteCategory,
    modals: LibraryModalState,
}

impl MathSlotApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        install_fonts(&cc.egui_ctx);
        install_style(&cc.egui_ctx);
        let (library, config_path_hint) = load_library_from_disk();
        let modals = LibraryModalState::new(&library, config_path_hint);

        Self {
            editor: StreamEditor::with_library(library),
            preset_index: 0,
            input_id: Id::unique("mathslot-stream-input"),
            pending_cursor_sync: Some(0),
            request_input_focus: true,
            last_typing_undo: Instant::now() - Duration::from_secs(5),
            worker: RenderWorker::spawn(),
            next_revision: 1,
            applied_revision: 0,
            render_dirty: true,
            formula_tex: None,
            nav_tex: None,
            render_error: None,
            status: String::new(),
            delimiter_style: DelimiterStyle::Inline,
            preview_scale: 1.25,
            copy_feedback_until: None,
            show_nav_card: false,
            show_scheme_a: false,
            palette_tab: PaletteCategory::Greek,
            modals,
        }
    }

    fn mark_dirty(&mut self) {
        self.render_dirty = true;
    }

    fn formatted_latex(&self) -> String {
        let raw = latex::to_latex(&self.editor.parsed);
        if raw.is_empty() {
            return String::new();
        }
        match self.delimiter_style {
            DelimiterStyle::None => raw,
            DelimiterStyle::Inline => format!("${raw}$"),
            DelimiterStyle::Display => format!("$$\n{raw}\n$$"),
            DelimiterStyle::MarkdownCode => format!("```latex\n{raw}\n```"),
        }
    }

    fn copy_latex(&mut self, ctx: &egui::Context) {
        let text = self.formatted_latex();
        if text.is_empty() {
            self.status = "无内容可复制。".to_owned();
            return;
        }
        ctx.copy_text(text);
        self.copy_feedback_until = Some(Instant::now() + Duration::from_millis(1600));
        self.status = "✓ 已复制 LaTeX 到系统剪贴板。".to_owned();
    }

    fn copy_scheme_a(&mut self, ctx: &egui::Context) {
        let text = scheme_a::to_scheme_a(&self.editor.parsed);
        if text.is_empty() {
            self.status = "无展开式可复制。".to_owned();
            return;
        }
        ctx.copy_text(text);
        self.status = "✓ 已复制方案 A 展开式。".to_owned();
    }

    fn quick_save_snippet(&mut self, prefer_inner: bool) {
        match self.editor.save_current_as_snippet(None, prefer_inner) {
            Ok((_key, msg)) => {
                let _ = save_library_to_disk(&self.editor.library);
                if let Some(nk) = self.editor.library.next_free_snippet_key() {
                    self.modals.snip_key = nk.to_string();
                }
                self.modals.feedback = Some((msg.clone(), false));
                self.status = msg;
                self.mark_dirty();
            }
            Err(err) => {
                self.modals.feedback = Some((err.clone(), true));
                self.status = err;
            }
        }
    }

    fn has_active_selection(&self, ctx: &egui::Context) -> bool {
        egui::TextEdit::load_state(ctx, self.input_id)
            .and_then(|s| s.cursor.char_range())
            .is_some_and(|r| r.primary.index != r.secondary.index)
    }

    fn handle_keys_before_ui(&mut self, ctx: &egui::Context) {
        if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::F1)) {
            self.modals.show_help = !self.modals.show_help;
            if !self.modals.any_open() {
                self.request_input_focus = true;
            }
            return;
        }

        if self.modals.any_open() {
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Escape)) {
                if self.modals.show_help {
                    self.modals.show_help = false;
                } else {
                    self.modals.show_library = false;
                }
                if !self.modals.any_open() {
                    self.request_input_focus = true;
                }
            }
            return;
        }

        let copy_shortcut = ctx.input_mut(|i| {
            i.consume_key(Modifiers::COMMAND | Modifiers::SHIFT, Key::C)
                || i.consume_key(Modifiers::CTRL | Modifiers::SHIFT, Key::C)
                || i.consume_key(Modifiers::COMMAND, Key::Enter)
                || i.consume_key(Modifiers::CTRL, Key::Enter)
        });
        if copy_shortcut {
            self.copy_latex(ctx);
            self.request_input_focus = true;
            return;
        }

        let save_snip_shortcut = ctx.input_mut(|i| {
            i.consume_key(Modifiers::COMMAND | Modifiers::SHIFT, Key::S)
                || i.consume_key(Modifiers::CTRL | Modifiers::SHIFT, Key::S)
        });
        if save_snip_shortcut {
            self.quick_save_snippet(true);
            self.request_input_focus = true;
            return;
        }

        if ctx.input_mut(|i| i.consume_key(Modifiers::ALT, Key::ArrowLeft)) {
            self.status = self.editor.jump_to_previous_pos();
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
            return;
        }

        let redo_shortcut = ctx.input_mut(|i| {
            i.consume_key(Modifiers::COMMAND | Modifiers::SHIFT, Key::Z)
                || i.consume_key(Modifiers::CTRL | Modifiers::SHIFT, Key::Z)
                || i.consume_key(Modifiers::COMMAND, Key::Y)
                || i.consume_key(Modifiers::CTRL, Key::Y)
        });
        if redo_shortcut {
            self.status = self.editor.redo();
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
            return;
        }

        let undo_shortcut = ctx.input_mut(|i| {
            i.consume_key(Modifiers::COMMAND, Key::Z) || i.consume_key(Modifiers::CTRL, Key::Z)
        });
        if undo_shortcut {
            self.status = self.editor.undo();
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
            return;
        }

        if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Escape)) {
            self.status = self.editor.toggle_esc_jump();
            self.request_input_focus = true;
            self.mark_dirty();
            return;
        }

        if self.editor.esc_nav.is_some() {
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Backspace)) {
                self.status = self.editor.esc_backspace();
                self.request_input_focus = true;
                self.mark_dirty();
                return;
            }
            if ctx.input_mut(|i| {
                i.consume_key(Modifiers::NONE, Key::Enter)
                    || i.consume_key(Modifiers::NONE, Key::Space)
            }) {
                self.status = self.editor.smart_enter();
                self.pending_cursor_sync = Some(self.editor.cursor_char);
                self.request_input_focus = true;
                self.mark_dirty();
                return;
            }
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Tab)) {
                self.editor.esc_nav = None;
                self.status = "已退出导航模式。".to_owned();
                self.request_input_focus = true;
                self.mark_dirty();
                return;
            }
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Home)) {
                self.status = self.editor.jump_to_start();
                self.pending_cursor_sync = Some(self.editor.cursor_char);
                self.request_input_focus = true;
                self.mark_dirty();
                return;
            }
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::End)) {
                self.status = self.editor.jump_to_end();
                self.pending_cursor_sync = Some(self.editor.cursor_char);
                self.request_input_focus = true;
                self.mark_dirty();
                return;
            }
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::ArrowUp)) {
                if let Some(msg) = self.editor.arrow_vertical(true) {
                    self.status = msg;
                    self.pending_cursor_sync = Some(self.editor.cursor_char);
                    self.mark_dirty();
                }
                self.request_input_focus = true;
                return;
            }
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::ArrowDown)) {
                if let Some(msg) = self.editor.arrow_vertical(false) {
                    self.status = msg;
                    self.pending_cursor_sync = Some(self.editor.cursor_char);
                    self.mark_dirty();
                }
                self.request_input_focus = true;
                return;
            }
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::ArrowLeft)) {
                if let Some(msg) = self.editor.arrow_horizontal(true) {
                    self.status = msg;
                    self.pending_cursor_sync = Some(self.editor.cursor_char);
                    self.mark_dirty();
                }
                self.request_input_focus = true;
                return;
            }
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::ArrowRight)) {
                if let Some(msg) = self.editor.arrow_horizontal(false) {
                    self.status = msg;
                    self.pending_cursor_sync = Some(self.editor.cursor_char);
                    self.mark_dirty();
                }
                self.request_input_focus = true;
                return;
            }
            if let Some(ch) = consume_esc_jump_key(ctx) {
                self.status = self.editor.feed_esc_jump_char(ch);
                if self.editor.esc_nav.is_none() {
                    self.pending_cursor_sync = Some(self.editor.cursor_char);
                }
                self.request_input_focus = true;
                self.mark_dirty();
            }
            return;
        }

        if matches!(self.editor.prefix_menu_state(), PrefixMenuState::SubMenu(_))
            && ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Space))
        {
            if let Some(msg) = self.editor.accept_submenu_default() {
                self.status = msg;
                self.pending_cursor_sync = Some(self.editor.cursor_char);
                self.request_input_focus = true;
                self.mark_dirty();
                return;
            }
        }

        if matches!(self.editor.prefix_menu_state(), PrefixMenuState::Idle) {
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::ArrowUp)) {
                if let Some(msg) = self.editor.arrow_vertical(true) {
                    self.status = msg;
                    self.pending_cursor_sync = Some(self.editor.cursor_char);
                    self.request_input_focus = true;
                    self.mark_dirty();
                }
                return;
            }
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::ArrowDown)) {
                if let Some(msg) = self.editor.arrow_vertical(false) {
                    self.status = msg;
                    self.pending_cursor_sync = Some(self.editor.cursor_char);
                    self.request_input_focus = true;
                    self.mark_dirty();
                }
                return;
            }
            if !self.has_active_selection(ctx) {
                let left_pressed =
                    ctx.input(|i| i.modifiers.is_none() && i.key_pressed(Key::ArrowLeft));
                if left_pressed && let Some(msg) = self.editor.arrow_horizontal(true) {
                    ctx.input_mut(|i| {
                        i.consume_key(Modifiers::NONE, Key::ArrowLeft);
                    });
                    self.status = msg;
                    self.pending_cursor_sync = Some(self.editor.cursor_char);
                    self.request_input_focus = true;
                    self.mark_dirty();
                    return;
                }
                let right_pressed =
                    ctx.input(|i| i.modifiers.is_none() && i.key_pressed(Key::ArrowRight));
                if right_pressed && let Some(msg) = self.editor.arrow_horizontal(false) {
                    ctx.input_mut(|i| {
                        i.consume_key(Modifiers::NONE, Key::ArrowRight);
                    });
                    self.status = msg;
                    self.pending_cursor_sync = Some(self.editor.cursor_char);
                    self.request_input_focus = true;
                    self.mark_dirty();
                    return;
                }
            }
        }

        if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Tab)) {
            self.status = self.editor.handle_tab();
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
            return;
        }

        if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Enter)) {
            self.status = self.editor.smart_enter();
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
        }
    }

    fn dispatch_and_poll_render(&mut self, ctx: &egui::Context) {
        if self.render_dirty {
            let revision = self.next_revision;
            self.next_revision += 1;
            let (nav_path, nav_filter) = self.editor.active_nav_view_state();
            self.worker.submit(RenderJob {
                revision,
                doc: self.editor.parsed.clone(),
                cursor_char: self.editor.cursor_char,
                nav_path,
                nav_filter,
                ctx: ctx.clone(),
            });
            self.render_dirty = false;
        }

        if let Some(out) = self.worker.poll_latest() {
            if out.revision < self.applied_revision {
                return;
            }
            self.applied_revision = out.revision;
            let mut errors = Vec::new();

            match out.preview {
                Ok(rendered) => {
                    update_texture(
                        ctx,
                        &mut self.formula_tex,
                        "mathslot-preview",
                        rendered.image,
                    );
                }
                Err(err) => {
                    errors.push(format!("预览编译提示：{err}"));
                }
            }

            match out.nav {
                Ok(rendered) => {
                    update_texture(ctx, &mut self.nav_tex, "mathslot-nav", rendered.image);
                }
                Err(err) => {
                    errors.push(format!("导航图提示：{err}"));
                }
            }

            self.render_error = if errors.is_empty() {
                None
            } else {
                Some(errors.join(" | "))
            };
        }
    }

    // -----------------------------------------------------------------------
    // 顶部纯功能菜单栏 (42px)：专注软件功能，绝不挤占公式格式
    // -----------------------------------------------------------------------

    fn top_ui(&mut self, ui: &mut egui::Ui) {
        let mut action_undo = false;
        let mut action_redo = false;
        let mut action_clear = false;
        let mut action_preset = false;
        let mut action_jump_back = false;
        let mut action_quick_save = false;
        let mut open_latex_tab = false;
        let mut open_custom_mgr = false;
        let mut open_help = false;

        let prefix_state = self.editor.prefix_menu_state();

        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 8.0;

            ui.label(
                RichText::new("∑ MathSlot")
                    .size(17.5)
                    .strong()
                    .color(ACCENT),
            );
            ui.add_space(6.0);

            // 状态徽标
            let (state_text, state_color) = if let Some(esc) = &self.editor.esc_nav {
                if esc.path.is_empty() {
                    ("● 导航直达态 (Esc)".to_owned(), ACCENT)
                } else {
                    (format!("● 子式导航 [{}]", esc.path.join(" › ")), VIOLET)
                }
            } else {
                match &prefix_state {
                    PrefixMenuState::Idle => ("● 流式书写中".to_owned(), GREEN),
                    PrefixMenuState::Root => ("● Tab 快捷就绪 (按单键即插)".to_owned(), AMBER),
                    PrefixMenuState::SubMenu(sub) => (format!("● 子菜单 ▸{} · {}", sub.key(), sub.title()), AMBER),
                    PrefixMenuState::Jump(seq) => (format!("● 内联跳转 ▸j{seq}"), CYAN),
                    PrefixMenuState::InvalidPrefix(c) => (format!("● 未知按键 ▸{c}"), RED),
                }
            };
            ui.label(RichText::new(state_text).size(11.5).strong().color(state_color));

            // 右侧纯应用级功能按键
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.spacing_mut().item_spacing.x = 6.0;

                if ui
                    .button(RichText::new("? 帮助").size(12.0).color(CYAN))
                    .on_hover_text("完整快捷键与操作指南 (F1)")
                    .clicked()
                {
                    open_help = true;
                }
                let next_preset_name = PRESETS[self.preset_index % PRESETS.len()].0;
                if ui
                    .button(RichText::new("↻ 示例").size(12.0))
                    .on_hover_text(format!("载入数学范例：{next_preset_name}"))
                    .clicked()
                {
                    action_preset = true;
                }
                if ui
                    .button(RichText::new("🗑 清空").size(12.0))
                    .on_hover_text("清空输入栏内容")
                    .clicked()
                {
                    action_clear = true;
                }
                if ui
                    .add_enabled(self.editor.can_redo(), egui::Button::new("↷ 重做"))
                    .on_hover_text("重做 (Ctrl+Y / Ctrl+Shift+Z)")
                    .clicked()
                {
                    action_redo = true;
                }
                if ui
                    .add_enabled(self.editor.can_undo(), egui::Button::new("↶ 撤销"))
                    .on_hover_text("撤销 (Ctrl+Z)")
                    .clicked()
                {
                    action_undo = true;
                }
                if ui
                    .add_enabled(
                        self.editor.can_jump_back(),
                        egui::Button::new("⇤ 回原位"),
                    )
                    .on_hover_text("返回上一个跳转位置 (Esc - 或 Alt+←)")
                    .clicked()
                {
                    action_jump_back = true;
                }
                if ui
                    .button(RichText::new("+ 存片段").size(12.0).color(GREEN))
                    .on_hover_text("将当前式子或光标处子结构存为片段模版 (Ctrl+Shift+S)")
                    .clicked()
                {
                    action_quick_save = true;
                }
                if ui
                    .button(RichText::new("⚡ 自定义/模版").size(12.0).color(AMBER))
                    .on_hover_text("无需改源码：扩展任意 LaTeX 宏与管理模版库")
                    .clicked()
                {
                    open_custom_mgr = true;
                }
                if ui
                    .button(RichText::new("⇄ LaTeX 导入").size(12.0).color(ACCENT))
                    .on_hover_text("从标准 LaTeX 语法一键反编译并导入为简码流")
                    .clicked()
                {
                    open_latex_tab = true;
                }
            });
        });

        if open_help {
            self.modals.show_help = true;
        }
        if open_latex_tab {
            self.modals.open_latex_tab();
        }
        if open_custom_mgr {
            self.modals.open_custom_tab(&self.editor.library);
        }
        if action_quick_save {
            self.quick_save_snippet(true);
            self.request_input_focus = true;
        }
        if action_jump_back {
            self.status = self.editor.jump_to_previous_pos();
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
        }
        if action_undo {
            self.status = self.editor.undo();
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
        }
        if action_redo {
            self.status = self.editor.redo();
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
        }
        if action_clear {
            self.status = self.editor.clear();
            self.pending_cursor_sync = Some(0);
            self.request_input_focus = true;
            self.mark_dirty();
        }
        if action_preset {
            let (name, src) = PRESETS[self.preset_index % PRESETS.len()];
            self.preset_index = (self.preset_index + 1) % PRESETS.len();
            self.status = self.editor.load_preset(src, name);
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
        }
    }

    // -----------------------------------------------------------------------
    // 中部核心区：1. 纯白公式主角画布  2. 极简流输入卡片  3. 大而精美的格式提示陈列面板
    // -----------------------------------------------------------------------

    fn formula_card(&mut self, ui: &mut egui::Ui) {
        let total_w = ui.available_width();
        let target_w = total_w.min(PREVIEW_MAX_WIDTH);
        let pad_x = ((total_w - target_w) * 0.5).max(0.0);

        ui.horizontal(|ui| {
            ui.add_space(pad_x);
            ui.vertical(|ui| {
                ui.set_width(target_w);

                surface_card(Stroke::new(1.0, CARD_BORDER)).show(ui, |ui| {
                    ui.set_width(ui.available_width());

                    // 右上角浮动微缩工具条
                    ui.horizontal(|ui| {
                        if let Some(err) = &self.render_error {
                            ui.label(RichText::new(err).size(11.0).color(AMBER));
                        }
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            let nav_btn_color = if self.show_nav_card { ACCENT } else { MUTED };
                            if ui
                                .small_button(RichText::new("◎ 结构图").color(nav_btn_color))
                                .on_hover_text("展开/收起 AST 槽位分层导航图")
                                .clicked()
                            {
                                self.show_nav_card = !self.show_nav_card;
                            }
                            ui.separator();
                            if ui
                                .small_button("🔍+")
                                .on_hover_text("放大预览公式")
                                .clicked()
                            {
                                self.preview_scale = (self.preview_scale + 0.15).min(2.5);
                            }
                            if ui
                                .small_button(format!("{:.0}%", self.preview_scale * 80.0))
                                .on_hover_text("恢复 100% 标准缩放")
                                .clicked()
                            {
                                self.preview_scale = 1.25;
                            }
                            if ui
                                .small_button("🔍−")
                                .on_hover_text("缩小预览公式")
                                .clicked()
                            {
                                self.preview_scale = (self.preview_scale - 0.15).max(0.7);
                            }
                        });
                    });

                    ui.add_space(6.0);

                    if let Some(texture) = &self.formula_tex {
                        let max_w = (ui.available_width() - 8.0).max(120.0);
                        let size = fitted_size(
                            texture,
                            max_w,
                            145.0 * (self.preview_scale / 1.22),
                            self.preview_scale,
                        );
                        let avail = ui.available_width();
                        ui.horizontal(|ui| {
                            ui.add_space(((avail - size.x) * 0.5).max(0.0));
                            ui.add(egui::Image::new(texture).fit_to_exact_size(size));
                        });
                    } else {
                        ui.vertical_centered(|ui| {
                            ui.add_space(20.0);
                            ui.label(
                                RichText::new("MathSlot 原生排版引擎就绪")
                                    .size(12.5)
                                    .color(Color32::from_rgb(148, 163, 184)),
                            );
                            ui.add_space(20.0);
                        });
                    }
                    ui.add_space(6.0);
                });
            });
        });
    }

    fn input_card(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let breadcrumbs = self.editor.parsed.breadcrumbs_at(self.editor.cursor_char);
        let total_w = ui.available_width();
        let target_w = total_w.min(PREVIEW_MAX_WIDTH);
        let pad_x = ((total_w - target_w) * 0.5).max(0.0);

        ui.horizontal(|ui| {
            ui.add_space(pad_x);
            ui.vertical(|ui| {
                ui.set_width(target_w);

                card_frame().show(ui, |ui| {
                    ui.set_width(ui.available_width());

                    // 仅当嵌套于子结构内时展现紧凑面包屑
                    if !breadcrumbs.is_empty() {
                        ui.horizontal(|ui| {
                            for (depth, bc) in breadcrumbs.iter().enumerate() {
                                if depth > 0 {
                                    ui.label(RichText::new("›").size(11.0).color(MUTED));
                                }
                                ui.label(
                                    RichText::new(format!("{CMD_PREFIX}{}", bc.code))
                                        .size(11.5)
                                        .strong()
                                        .color(AMBER),
                                );
                                ui.label(RichText::new("[").size(11.0).color(MUTED));
                                for (s_idx, role) in bc.slot_roles.iter().enumerate() {
                                    if s_idx > 0 {
                                        ui.label(RichText::new(";").size(10.5).color(CYAN));
                                    }
                                    let is_cur = s_idx == bc.slot_index;
                                    let color = if is_cur { GREEN } else { MUTED };
                                    let text = format!("{}.{role}", s_idx + 1);
                                    let rt = if is_cur {
                                        RichText::new(text).size(11.0).strong().color(color)
                                    } else {
                                        RichText::new(text).size(10.5).color(color)
                                    };
                                    ui.label(rt);
                                }
                                ui.label(RichText::new("]").size(11.0).color(MUTED));
                            }
                        });
                        ui.add_space(2.0);
                    }

                    let explicit_sync = self.pending_cursor_sync.take();
                    if let Some(mut state) = egui::TextEdit::load_state(&ctx, self.input_id) {
                        if let Some(target_char) = explicit_sync {
                            let c = CCursor::new(target_char.min(self.editor.source.chars().count()));
                            state.cursor.set_char_range(Some(CCursorRange::one(c)));
                            state.store(&ctx, self.input_id);
                        } else if state.cursor.char_range().is_none() {
                            let c = CCursor::new(self.editor.cursor_char.min(self.editor.source.chars().count()));
                            state.cursor.set_char_range(Some(CCursorRange::one(c)));
                            state.store(&ctx, self.input_id);
                        }
                    }

                    let prev_snap = Snapshot {
                        source: self.editor.source.clone(),
                        cursor_char: self.editor.cursor_char,
                    };

                    let lib_ref = self.editor.library.clone();
                    let mut layouter = |ui: &egui::Ui, text: &dyn egui::TextBuffer, wrap_width: f32| {
                        let mut job = highlight_stream_source(text.as_str(), &lib_ref);
                        job.wrap.max_width = wrap_width;
                        ui.fonts_mut(|f| f.layout_job(job))
                    };

                    let mut output = egui::TextEdit::singleline(&mut self.editor.source)
                        .id(self.input_id)
                        .font(FontId::monospace(18.5))
                        .text_color(TEXT)
                        .background_color(BG)
                        .margin(Margin::symmetric(10, 8))
                        .hint_text("直接键入公式；按 Tab+单字母 插入下方结构，Enter 推进下一槽…")
                        .lock_focus(true)
                        .return_key(None)
                        .desired_width(f32::INFINITY)
                        .layouter(&mut layouter)
                        .show(ui);

                    if output.response.changed() {
                        let char_delta = prev_snap
                            .source
                            .chars()
                            .count()
                            .abs_diff(self.editor.source.chars().count());
                        if self.last_typing_undo.elapsed() > Duration::from_millis(450) || char_delta > 1 {
                            self.editor.save_undo_snapshot(prev_snap);
                            self.last_typing_undo = Instant::now();
                        }

                        let raw_cursor: usize = output
                            .cursor_range
                            .map(|r| usize::from(r.primary.index))
                            .unwrap_or_else(|| self.editor.source.chars().count());
                        let before_sync = self.editor.source.clone();
                        if let Some(hint) = self.editor.sync_after_edit(raw_cursor) {
                            self.status = hint;
                        } else {
                            self.status = "流式书写中…".to_owned();
                        }

                        if self.editor.source != before_sync || self.editor.cursor_char != raw_cursor {
                            let c = CCursor::new(self.editor.cursor_char);
                            output
                                .state
                                .cursor
                                .set_char_range(Some(CCursorRange::one(c)));
                            output.state.store(&ctx, output.response.id);
                        }

                        self.mark_dirty();
                    } else if let Some(range) = output.cursor_range {
                        let cur_idx: usize = range.primary.index.into();
                        if self.editor.esc_nav.is_none() && cur_idx != self.editor.cursor_char {
                            self.editor.set_cursor(cur_idx);
                            self.mark_dirty();
                        }
                    }

                    if !self.status.is_empty() {
                        ui.add_space(2.0);
                        ui.label(RichText::new(&self.status).size(11.0).color(MUTED));
                    }
                });
            });
        });
    }

    // -----------------------------------------------------------------------
    // 大而精美的格式提示陈列面板 (The Grand Format Palette & Showcase)
    // 视觉核心：醒目、直观、精美卡片陈列，彻底免除死记语法，点击或按键均可流畅输入！
    // -----------------------------------------------------------------------

    fn palette_card(
        &mut self,
        ui: &mut egui::Ui,
        clicked_code: &mut Option<String>,
        clicked_jump: &mut Option<String>,
        open_custom_mgr: &mut bool,
        open_snip_mgr: &mut bool,
        quick_save_snip: &mut bool,
    ) {
        let prefix_state = self.editor.prefix_menu_state();
        let prefix_armed = matches!(
            prefix_state,
            PrefixMenuState::Root | PrefixMenuState::SubMenu(_) | PrefixMenuState::InvalidPrefix(_)
        );

        // 智能同步活动 Tab：当用户在流式输入中敲入 `▸c`、`▸g`、`▸m` 等子菜单时，陈列面板自动切至对应专区！
        match prefix_state {
            PrefixMenuState::SubMenu(SubCategory::CalculusMore) => {
                self.palette_tab = PaletteCategory::Calculus;
            }
            PrefixMenuState::SubMenu(SubCategory::Matrix) => {
                self.palette_tab = PaletteCategory::Matrix;
            }
            PrefixMenuState::SubMenu(SubCategory::Accent) => {
                self.palette_tab = PaletteCategory::Accent;
            }
            PrefixMenuState::SubMenu(SubCategory::Greek) => {
                self.palette_tab = PaletteCategory::Greek;
            }
            PrefixMenuState::SubMenu(SubCategory::Symbol) => {
                self.palette_tab = PaletteCategory::Operator;
            }
            PrefixMenuState::SubMenu(SubCategory::Relations)
            | PrefixMenuState::SubMenu(SubCategory::SetLogic) => {
                self.palette_tab = PaletteCategory::Relation;
            }
            PrefixMenuState::SubMenu(SubCategory::Custom)
            | PrefixMenuState::SubMenu(SubCategory::Template) => {
                self.palette_tab = PaletteCategory::Custom;
            }
            _ => {}
        }

        let total_w = ui.available_width();
        let target_w = total_w.min(PREVIEW_MAX_WIDTH);
        let pad_x = ((total_w - target_w) * 0.5).max(0.0);

        ui.horizontal(|ui| {
            ui.add_space(pad_x);
            ui.vertical(|ui| {
                ui.set_width(target_w);

                let frame_stroke = if self.editor.esc_nav.is_some() {
                    Stroke::new(1.5, ACCENT)
                } else if prefix_armed {
                    Stroke::new(1.5, AMBER)
                } else {
                    Stroke::new(1.0, CARD_BORDER)
                };

                egui::Frame::NONE
                    .fill(CARD)
                    .stroke(frame_stroke)
                    .corner_radius(CornerRadius::same(9))
                    .inner_margin(Margin::symmetric(14, 10))
                    .show(ui, |ui| {
                        ui.set_width(ui.available_width());

                        // 1. 若处于 Esc 导航态，顶部直接渲染高亮导航靶点直达条！
                        if let Some(esc) = self.editor.esc_nav.clone() {
                            ui.horizontal(|ui| {
                                section_dot(ui, ACCENT);
                                ui.label(
                                    RichText::new("槽位直达导航 · 按字母直接跳改 (Esc / Tab 退出)")
                                        .size(12.5)
                                        .strong()
                                        .color(ACCENT),
                                );
                                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                    if ui
                                        .button(RichText::new("Esc 退出").size(11.5).color(MUTED))
                                        .clicked()
                                    {
                                        *clicked_jump = Some("Esc".to_owned());
                                    }
                                });
                            });
                            ui.add_space(4.0);
                            self.render_jump_menu_content(
                                ui,
                                true,
                                &esc.path,
                                &esc.partial,
                                clicked_jump,
                            );
                            ui.add_space(8.0);
                            ui.separator();
                            ui.add_space(8.0);
                        }

                        // 2. 常驻常用结构分块 (12 项单键直达，始终常驻可见)
                        ui.horizontal(|ui| {
                            let (dot_color, title_text) = if prefix_armed {
                                (AMBER, "常用结构 · Tab 就绪")
                            } else {
                                (CYAN, "常用结构 (12)")
                            };
                            section_dot(ui, dot_color);
                            ui.label(
                                RichText::new(title_text)
                                    .size(12.5)
                                    .strong()
                                    .color(if prefix_armed { AMBER } else { TEXT }),
                            );
                        });

                        ui.add_space(6.0);
                        self.render_direct_cards(ui, prefix_armed, clicked_code);

                        ui.add_space(8.0);
                        ui.separator();
                        ui.add_space(6.0);

                        // 3. 扩展分类标签页切换区
                        self.render_palette_tabs(ui, prefix_armed);

                        ui.add_space(8.0);

                        // 4. 当前分类格式展示网格
                        self.render_palette_cards(
                            ui,
                            prefix_armed,
                            clicked_code,
                            open_custom_mgr,
                            open_snip_mgr,
                            quick_save_snip,
                        );
                    });
            });
        });
    }

    /// 常驻展示的 12 项高频单键直达基础结构
    fn render_direct_cards(
        &self,
        ui: &mut egui::Ui,
        prefix_armed: bool,
        clicked_code: &mut Option<String>,
    ) {
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = Vec2::new(7.0, 7.0);
            for entry in DIRECT_ENTRIES {
                let hover = format!(
                    "{}{} (快捷键: {}) | 槽位: {}",
                    entry.label, entry.glyph_hint, entry.key, entry.detail
                );
                if render_palette_card(
                    ui,
                    &entry.key.to_string(),
                    entry.glyph_hint,
                    entry.label,
                    false,
                    prefix_armed,
                    &hover,
                ) {
                    *clicked_code = Some(entry.key.to_string());
                }
            }
        });
    }

    /// 分类标签页选择器
    fn render_palette_tabs(&mut self, ui: &mut egui::Ui, _prefix_armed: bool) {
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = Vec2::new(6.0, 4.0);

            let tabs = [
                (
                    PaletteCategory::Greek,
                    "希腊字母 (g▸)",
                    "希腊字母全集：23个小写 + 11个大写 (Tab + g)",
                ),
                (
                    PaletteCategory::Calculus,
                    "微积分 (c▸)",
                    "导数、积分、极限、连乘、大括号 (Tab + c)",
                ),
                (
                    PaletteCategory::Matrix,
                    "矩阵定界 (m▸)",
                    "方阵、行列式、分段函数、向量 (Tab + m)",
                ),
                (
                    PaletteCategory::Accent,
                    "标注向量 (a▸)",
                    "帽子、横线、向量、一阶导、二阶导 (Tab + a)",
                ),
                (
                    PaletteCategory::Operator,
                    "常用算子 (o▸)",
                    "无穷、偏导、梯度、叉乘、点乘、属于、平行 (Tab + o)",
                ),
                (
                    PaletteCategory::Relation,
                    "关系逻辑 (x/q)",
                    "恒等、约等、充要、并集、交集、实数集 (Tab + x/q)",
                ),
                (
                    PaletteCategory::Custom,
                    "自定义/模版 (k/t)",
                    "自定义 LaTeX 格式与片段模版库 (Tab + k/t)",
                ),
            ];

            for (cat, title, tip) in tabs {
                let is_selected = self.palette_tab == cat;
                let is_active_sub = match self.editor.prefix_menu_state() {
                    PrefixMenuState::SubMenu(SubCategory::Greek) => cat == PaletteCategory::Greek,
                    PrefixMenuState::SubMenu(SubCategory::CalculusMore) => {
                        cat == PaletteCategory::Calculus
                    }
                    PrefixMenuState::SubMenu(SubCategory::Matrix) => cat == PaletteCategory::Matrix,
                    PrefixMenuState::SubMenu(SubCategory::Accent) => cat == PaletteCategory::Accent,
                    PrefixMenuState::SubMenu(SubCategory::Symbol) => {
                        cat == PaletteCategory::Operator
                    }
                    PrefixMenuState::SubMenu(SubCategory::Relations)
                    | PrefixMenuState::SubMenu(SubCategory::SetLogic) => {
                        cat == PaletteCategory::Relation
                    }
                    PrefixMenuState::SubMenu(SubCategory::Custom)
                    | PrefixMenuState::SubMenu(SubCategory::Template) => {
                        cat == PaletteCategory::Custom
                    }
                    _ => false,
                };

                let stroke = if is_active_sub {
                    Stroke::new(1.5, AMBER)
                } else if is_selected {
                    Stroke::new(1.0, ACCENT)
                } else {
                    Stroke::NONE
                };

                let bg = if is_selected {
                    Color32::from_rgb(32, 45, 75)
                } else {
                    Color32::from_rgb(18, 23, 36)
                };

                let text_color = if is_active_sub {
                    AMBER
                } else if is_selected {
                    Color32::WHITE
                } else {
                    MUTED
                };

                let btn = egui::Button::new(
                    RichText::new(title).size(12.0).strong().color(text_color),
                )
                .fill(bg)
                .stroke(stroke)
                .corner_radius(CornerRadius::same(6));

                if ui.add(btn).on_hover_text(tip).clicked() {
                    self.palette_tab = cat;
                    self.pending_cursor_sync = Some(self.editor.cursor_char);
                    self.request_input_focus = true;
                }
            }
        });
    }

    /// 各标签页的大卡片陈列网格
    fn render_palette_cards(
        &self,
        ui: &mut egui::Ui,
        prefix_armed: bool,
        clicked_code: &mut Option<String>,
        open_custom_mgr: &mut bool,
        open_snip_mgr: &mut bool,
        quick_save_snip: &mut bool,
    ) {
        match self.palette_tab {
            PaletteCategory::Greek => {
                ui.vertical(|ui| {
                    ui.label(RichText::new("小写希腊字母 (23)").size(11.0).color(MUTED));
                    ui.add_space(2.0);
                    ui.horizontal_wrapped(|ui| {
                        ui.spacing_mut().item_spacing = Vec2::new(7.0, 7.0);
                        for entry in SubCategory::Greek.entries() {
                            if !entry.item_key.is_ascii_uppercase() {
                                let hover = format!("{CMD_PREFIX}{} | {} ({})", entry.code, entry.label, entry.detail);
                                let badge = if entry.is_default {
                                    format!("★{}", entry.item_key)
                                } else {
                                    format!("g{}", entry.item_key)
                                };
                                if render_palette_card(
                                    ui,
                                    &badge,
                                    entry.glyph_hint,
                                    entry.label,
                                    entry.is_default,
                                    prefix_armed,
                                    &hover,
                                ) {
                                    *clicked_code = Some(entry.code.to_owned());
                                }
                            }
                        }
                    });

                    ui.add_space(6.0);
                    ui.label(RichText::new("大写希腊字母 (11)").size(11.0).color(MUTED));
                    ui.add_space(2.0);
                    ui.horizontal_wrapped(|ui| {
                        ui.spacing_mut().item_spacing = Vec2::new(7.0, 7.0);
                        for entry in SubCategory::Greek.entries() {
                            if entry.item_key.is_ascii_uppercase() {
                                let hover = format!("{CMD_PREFIX}{} | {} ({})", entry.code, entry.label, entry.detail);
                                let badge = format!("g{}", entry.item_key);
                                if render_palette_card(
                                    ui,
                                    &badge,
                                    entry.glyph_hint,
                                    entry.label,
                                    entry.is_default,
                                    prefix_armed,
                                    &hover,
                                ) {
                                    *clicked_code = Some(entry.code.to_owned());
                                }
                            }
                        }
                    });
                });
            }
            PaletteCategory::Calculus => {
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = Vec2::new(7.0, 7.0);
                    for entry in SubCategory::CalculusMore.entries() {
                        let hover = format!("{CMD_PREFIX}{} | {} ({})", entry.code, entry.label, entry.detail);
                        let badge = if entry.is_default {
                            format!("★{}", entry.item_key)
                        } else {
                            format!("c{}", entry.item_key)
                        };
                        if render_palette_card(
                            ui,
                            &badge,
                            entry.glyph_hint,
                            entry.label,
                            entry.is_default,
                            prefix_armed,
                            &hover,
                        ) {
                            *clicked_code = Some(entry.code.to_owned());
                        }
                    }
                });
            }
            PaletteCategory::Matrix => {
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = Vec2::new(7.0, 7.0);
                    for entry in SubCategory::Matrix.entries() {
                        let hover = format!("{CMD_PREFIX}{} | {} ({})", entry.code, entry.label, entry.detail);
                        let badge = if entry.is_default {
                            format!("★{}", entry.item_key)
                        } else {
                            format!("m{}", entry.item_key)
                        };
                        if render_palette_card(
                            ui,
                            &badge,
                            entry.glyph_hint,
                            entry.label,
                            entry.is_default,
                            prefix_armed,
                            &hover,
                        ) {
                            *clicked_code = Some(entry.code.to_owned());
                        }
                    }
                });
            }
            PaletteCategory::Accent => {
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = Vec2::new(7.0, 7.0);
                    for entry in SubCategory::Accent.entries() {
                        let hover = format!("{CMD_PREFIX}{} | {} ({})", entry.code, entry.label, entry.detail);
                        let badge = if entry.is_default {
                            format!("★{}", entry.item_key)
                        } else {
                            format!("a{}", entry.item_key)
                        };
                        if render_palette_card(
                            ui,
                            &badge,
                            entry.glyph_hint,
                            entry.label,
                            entry.is_default,
                            prefix_armed,
                            &hover,
                        ) {
                            *clicked_code = Some(entry.code.to_owned());
                        }
                    }
                });
            }
            PaletteCategory::Operator => {
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = Vec2::new(7.0, 7.0);
                    for entry in SubCategory::Symbol.entries() {
                        let hover = format!("{CMD_PREFIX}{} | {} ({})", entry.code, entry.label, entry.detail);
                        let badge = if entry.is_default {
                            format!("★{}", entry.item_key)
                        } else {
                            format!("o{}", entry.item_key)
                        };
                        if render_palette_card(
                            ui,
                            &badge,
                            entry.glyph_hint,
                            entry.label,
                            entry.is_default,
                            prefix_armed,
                            &hover,
                        ) {
                            *clicked_code = Some(entry.code.to_owned());
                        }
                    }
                });
            }
            PaletteCategory::Relation => {
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = Vec2::new(7.0, 7.0);
                    for entry in SubCategory::Relations.entries() {
                        let hover = format!("{CMD_PREFIX}{} | {} ({})", entry.code, entry.label, entry.detail);
                        let badge = format!("x{}", entry.item_key);
                        if render_palette_card(
                            ui,
                            &badge,
                            entry.glyph_hint,
                            entry.label,
                            entry.is_default,
                            prefix_armed,
                            &hover,
                        ) {
                            *clicked_code = Some(entry.code.to_owned());
                        }
                    }
                    for entry in SubCategory::SetLogic.entries() {
                        let hover = format!("{CMD_PREFIX}{} | {} ({})", entry.code, entry.label, entry.detail);
                        let badge = format!("q{}", entry.item_key);
                        if render_palette_card(
                            ui,
                            &badge,
                            entry.glyph_hint,
                            entry.label,
                            entry.is_default,
                            prefix_armed,
                            &hover,
                        ) {
                            *clicked_code = Some(entry.code.to_owned());
                        }
                    }
                });
            }
            PaletteCategory::Custom => {
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = Vec2::new(7.0, 7.0);
                    let def_custom_key = self.editor.library.default_custom().map(|d| d.item_key);
                    for fmt in &self.editor.library.custom_formats {
                        let is_def = def_custom_key == Some(fmt.item_key);
                        let badge = if is_def {
                            format!("★k{}", fmt.item_key)
                        } else {
                            format!("k{}", fmt.item_key)
                        };
                        let glyph = if fmt.glyph_hint.is_empty() {
                            &fmt.label
                        } else {
                            &fmt.glyph_hint
                        };
                        let hover = format!("{CMD_PREFIX}{} | {} | {}", fmt.code(), fmt.label, fmt.latex_template);
                        if render_palette_card(
                            ui,
                            &badge,
                            glyph,
                            &fmt.label,
                            is_def,
                            prefix_armed,
                            &hover,
                        ) {
                            *clicked_code = Some(fmt.code());
                        }
                    }
                    let def_snip_key = self.editor.library.default_snippet().map(|s| s.item_key);
                    for snip in &self.editor.library.snippets {
                        let is_def = def_snip_key == Some(snip.item_key);
                        let badge = if is_def {
                            format!("★t{}", snip.item_key)
                        } else {
                            format!("t{}", snip.item_key)
                        };
                        let hover = format!("{CMD_PREFIX}{} → `{}`", snip.code(), snip.stream_source);
                        if render_palette_card(
                            ui,
                            &badge,
                            "⎘",
                            &snip.label,
                            is_def,
                            prefix_armed,
                            &hover,
                        ) {
                            *clicked_code = Some(snip.code());
                        }
                    }
                    if ui
                        .button(RichText::new("+ 新增自定义格式").size(12.0).color(GREEN))
                        .clicked()
                    {
                        *open_custom_mgr = true;
                    }
                    if ui
                        .button(RichText::new("⚙ 管理模版库").size(12.0).color(CYAN))
                        .clicked()
                    {
                        *open_snip_mgr = true;
                    }
                    if ui
                        .button(RichText::new("+ 存当前为片段").size(12.0).color(AMBER))
                        .clicked()
                    {
                        *quick_save_snip = true;
                    }
                });
            }
        }
    }

    fn render_jump_menu_content(
        &self,
        ui: &mut egui::Ui,
        is_esc_mode: bool,
        path: &[String],
        partial: &str,
        clicked_seq: &mut Option<String>,
    ) {
        let chain = self.editor.parsed.resolve_scope_chain(path);
        let active_stage = chain.last().expect("root stage always exists");
        let path_prefix = path.join("");

        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = Vec2::new(5.0, 4.0);

            if is_esc_mode {
                if ui
                    .button(RichText::new("Esc ‹").size(11.5).strong().color(MUTED))
                    .on_hover_text("退出导航模式 (Esc / Tab)")
                    .clicked()
                {
                    *clicked_seq = Some("Esc".to_owned());
                }
            }

            if !path.is_empty() {
                ui.label(
                    RichText::new(format!("[{}]", path.join(" › ")))
                        .size(11.5)
                        .strong()
                        .color(VIOLET),
                );
                ui.separator();
            }

            if partial.is_empty() && self.editor.can_jump_back() {
                if ui
                    .button(
                        RichText::new("[-] ↶ 回原位")
                            .monospace()
                            .size(11.5)
                            .color(AMBER),
                    )
                    .on_hover_text("回上一位置 (按 `-` 或 Alt+←)")
                    .clicked()
                {
                    *clicked_seq = Some("-".to_owned());
                }
            }

            for entry in &active_stage.scope.entries {
                if !partial.is_empty() && !entry.label.starts_with(partial) {
                    continue;
                }
                let (glyph, color, hover) = match &entry.kind {
                    NavEntryKind::ScopeStart => ("⇤ 行首", CYAN, "整行或槽位首端"),
                    NavEntryKind::ScopeEnd => ("⇥ 行尾", CYAN, "整行或槽位末端"),
                    NavEntryKind::Leaf { is_empty: true, role_hint } => {
                        let r = role_hint.as_deref().unwrap_or("待填槽位");
                        ("∅ 待填", RED, r)
                    }
                    NavEntryKind::Leaf { role_hint, .. } => {
                        let r = role_hint.as_deref().unwrap_or("槽位");
                        ("• 槽位", TEXT, r)
                    }
                    NavEntryKind::Composite { role_hint, .. } => ("+ 子式", VIOLET, role_hint.as_str()),
                };

                let tag = format!("[{}] {glyph}", entry.label);
                if ui
                    .button(RichText::new(tag).monospace().size(11.5).color(color))
                    .on_hover_text(hover)
                    .clicked()
                {
                    *clicked_seq = Some(format!("{path_prefix}{}", entry.label));
                }
            }
        });
    }

    fn nav_card(&self, ui: &mut egui::Ui) {
        if !self.show_nav_card {
            return;
        }

        let total_w = ui.available_width();
        let target_w = total_w.min(PREVIEW_MAX_WIDTH);
        let pad_x = ((total_w - target_w) * 0.5).max(0.0);

        ui.horizontal(|ui| {
            ui.add_space(pad_x);
            ui.vertical(|ui| {
                ui.set_width(target_w);

                card_frame().show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.label(RichText::new("AST 结构同步导览图").size(12.0).strong().color(ACCENT));
                    ui.add_space(4.0);

                    surface_card(Stroke::new(1.0, CARD_BORDER)).show(ui, |ui| {
                        ui.set_width(ui.available_width());
                        if let Some(texture) = &self.nav_tex {
                            let max_w = (ui.available_width() - 8.0).max(120.0);
                            let size = fitted_size(texture, max_w, 100.0, 1.15);
                            let avail = ui.available_width();
                            ui.horizontal(|ui| {
                                ui.add_space(((avail - size.x) * 0.5).max(0.0));
                                ui.add(egui::Image::new(texture).fit_to_exact_size(size));
                            });
                        }
                    });
                });
            });
        });
    }

    fn center_ui(&mut self, ui: &mut egui::Ui) {
        let mut clicked_card_code: Option<String> = None;
        let mut clicked_jump_seq: Option<String> = None;
        let mut open_custom_mgr = false;
        let mut open_snip_mgr = false;
        let mut quick_save_snip = false;

        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.add_space(6.0);

                // 1. 实时公式预览卡片 (Hero)
                self.formula_card(ui);

                ui.add_space(8.0);

                // 2. 线性流输入卡片
                self.input_card(ui);

                ui.add_space(8.0);

                // 3. 醒目、大而精美的格式提示陈列大面板 (The Grand Format Palette & Showcase)
                self.palette_card(
                    ui,
                    &mut clicked_card_code,
                    &mut clicked_jump_seq,
                    &mut open_custom_mgr,
                    &mut open_snip_mgr,
                    &mut quick_save_snip,
                );

                // 4. 按需呈现的结构导览图
                if self.show_nav_card {
                    ui.add_space(8.0);
                    self.nav_card(ui);
                }

                ui.add_space(10.0);
            });

        if open_custom_mgr {
            self.modals.open_custom_tab(&self.editor.library);
        }
        if open_snip_mgr {
            self.modals.open_snippets_tab(&self.editor.library);
        }
        if quick_save_snip {
            self.quick_save_snippet(true);
            self.request_input_focus = true;
        }
        if let Some(code) = clicked_card_code {
            self.status = self.editor.apply_card_click(&code);
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
        }
        if let Some(seq_str) = clicked_jump_seq {
            if seq_str == "Esc" {
                self.editor.esc_nav = None;
                self.status = "已退出导航模式。".to_owned();
                self.pending_cursor_sync = Some(self.editor.cursor_char);
                self.request_input_focus = true;
                self.mark_dirty();
            } else if let Ok(msg) = self.editor.jump_to_sequence(&seq_str) {
                self.status = msg;
                self.pending_cursor_sync = Some(self.editor.cursor_char);
                self.request_input_focus = true;
                self.mark_dirty();
            }
        }
    }

    // -----------------------------------------------------------------------
    // 底部面板：极简生产力 Dock（48px 格式切换 + 单行滚动输出 + 大号复制按键）
    // -----------------------------------------------------------------------

    fn bottom_ui(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let expanded_a = scheme_a::to_scheme_a(&self.editor.parsed);
        let latex_str = self.formatted_latex();
        let mut click_copy_latex = false;
        let mut click_copy_a = false;

        let copied_recent = self
            .copy_feedback_until
            .is_some_and(|until| Instant::now() < until);
        if copied_recent {
            ctx.request_repaint_after(Duration::from_millis(200));
        }

        // 若打开了方案 A 结构抽屉，在上方展现折叠抽屉
        if self.show_scheme_a {
            ui.horizontal(|ui| {
                ui.label(RichText::new("方案 A 结构展开").size(11.5).strong().color(CYAN));
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui.small_button("复制").clicked() {
                        click_copy_a = true;
                    }
                });
            });
            ui.add_space(2.0);
            output_box(ui, "mathslot-scheme-a-scroll", &expanded_a);
            ui.add_space(4.0);
        }

        // 核心 Dock 底栏行
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 4.0;

            // 定界符选择胶囊
            if ui
                .selectable_label(self.delimiter_style == DelimiterStyle::None, "LaTeX")
                .on_hover_text("裸代码 (无定界符)")
                .clicked()
            {
                self.delimiter_style = DelimiterStyle::None;
                self.request_input_focus = true;
            }
            if ui
                .selectable_label(self.delimiter_style == DelimiterStyle::Inline, "$…$")
                .on_hover_text("行内公式 $...$")
                .clicked()
            {
                self.delimiter_style = DelimiterStyle::Inline;
                self.request_input_focus = true;
            }
            if ui
                .selectable_label(self.delimiter_style == DelimiterStyle::Display, "$$…$$")
                .on_hover_text("行间公式 $$...$$")
                .clicked()
            {
                self.delimiter_style = DelimiterStyle::Display;
                self.request_input_focus = true;
            }
            if ui
                .selectable_label(self.delimiter_style == DelimiterStyle::MarkdownCode, "```")
                .on_hover_text("代码块 ```latex")
                .clicked()
            {
                self.delimiter_style = DelimiterStyle::MarkdownCode;
                self.request_input_focus = true;
            }

            let a_color = if self.show_scheme_a { CYAN } else { MUTED };
            if ui
                .selectable_label(self.show_scheme_a, RichText::new("[A]").color(a_color))
                .on_hover_text("展开/收起方案 A 层次展开抽屉")
                .clicked()
            {
                self.show_scheme_a = !self.show_scheme_a;
                self.request_input_focus = true;
            }

            ui.separator();

            // LaTeX 输出滚动条
            let latex_display = if latex_str.is_empty() {
                "（空白）"
            } else {
                &latex_str
            };
            let code_color = if latex_str.is_empty() { MUTED } else { TEXT };

            egui::Frame::NONE
                .fill(BG)
                .stroke(Stroke::new(1.0, CARD_BORDER))
                .corner_radius(CornerRadius::same(5))
                .inner_margin(Margin::symmetric(8, 4))
                .show(ui, |ui| {
                    let avail = ui.available_width() - 80.0;
                    ui.set_width(avail.max(100.0));
                    egui::ScrollArea::horizontal()
                        .id_salt("mathslot-latex-dock-scroll")
                        .show(ui, |ui| {
                            ui.add(
                                egui::Label::new(
                                    RichText::new(latex_display)
                                        .monospace()
                                        .size(12.5)
                                        .color(code_color),
                                )
                                .selectable(true),
                            );
                        });
                });

            // 右侧一键复制主按键
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                let copy_label = if copied_recent {
                    RichText::new("✓ 已复制").size(12.5).strong().color(GREEN)
                } else {
                    RichText::new("📋 复制 LaTeX").size(12.5).strong().color(TEXT)
                };
                let btn = egui::Button::new(copy_label)
                    .fill(if copied_recent { Color32::from_rgb(16, 60, 40) } else { Color32::from_rgb(30, 45, 75) })
                    .stroke(Stroke::new(1.0, if copied_recent { GREEN } else { ACCENT }));
                if ui
                    .add(btn)
                    .on_hover_text("复制 LaTeX 到剪贴板 (Ctrl+Enter / Ctrl+Shift+C)")
                    .clicked()
                {
                    click_copy_latex = true;
                }
            });
        });

        if click_copy_a {
            self.copy_scheme_a(&ctx);
            self.request_input_focus = true;
        }
        if click_copy_latex {
            self.copy_latex(&ctx);
            self.request_input_focus = true;
        }
    }
}

impl eframe::App for MathSlotApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.handle_keys_before_ui(&ctx);

        egui::Panel::top("mathslot-top-panel")
            .resizable(false)
            .min_size(TOP_PANEL_EXACT_HEIGHT)
            .max_size(TOP_PANEL_EXACT_HEIGHT)
            .frame(
                egui::Frame::NONE
                    .fill(PANEL)
                    .inner_margin(Margin::symmetric(14, 6)),
            )
            .show(ui, |ui| self.top_ui(ui));

        let bottom_height = if self.show_scheme_a { 120.0 } else { 48.0 };
        egui::Panel::bottom("mathslot-bottom-panel")
            .resizable(false)
            .min_size(bottom_height)
            .max_size(bottom_height)
            .frame(
                egui::Frame::NONE
                    .fill(PANEL)
                    .inner_margin(Margin::symmetric(14, 6)),
            )
            .show(ui, |ui| self.bottom_ui(ui));

        egui::CentralPanel::default()
            .frame(
                egui::Frame::NONE
                    .fill(BG)
                    .inner_margin(Margin::symmetric(14, 8)),
            )
            .show(ui, |ui| self.center_ui(ui));

        let was_modal_open = self.modals.any_open();
        if let Some(modal_action) = self.modals.show(&ctx, &mut self.editor) {
            match modal_action {
                ModalAction::InsertCode(code) => {
                    self.status = self.editor.apply_card_click(&code);
                    self.pending_cursor_sync = Some(self.editor.cursor_char);
                    self.request_input_focus = true;
                    self.mark_dirty();
                }
                ModalAction::ReplaceCode(code) => {
                    self.editor.source = code;
                    self.editor.cursor_char = self.editor.source.chars().count();
                    self.editor.sync_after_edit(self.editor.cursor_char);
                    self.pending_cursor_sync = Some(self.editor.cursor_char);
                    self.status = "✓ 已成功导入并载入 MathSlot 简码流！".to_owned();
                    self.request_input_focus = true;
                    self.mark_dirty();
                }
                ModalAction::QuickSaveSnippet { prefer_inner } => {
                    self.quick_save_snippet(prefer_inner);
                }
                ModalAction::LibraryChanged(msg) => {
                    self.status = msg;
                    self.mark_dirty();
                }
            }
        }
        if was_modal_open && !self.modals.any_open() {
            self.request_input_focus = true;
        }

        if !self.modals.any_open() {
            // 当无模态弹出框时，输入框保持永久活跃焦点；点击标签页、卡片或任意功能按钮均不发生失焦
            ctx.memory_mut(|m| m.request_focus(self.input_id));
            self.request_input_focus = false;
        }

        self.dispatch_and_poll_render(&ctx);
    }
}

/// 醒目、大而精美的格式展示卡片 (94×58)
/// 呈现：上方快捷键徽章 `[f]`、中央大号数学符号 `a/b`、下方清晰中文名称 `分数`
fn render_palette_card(
    ui: &mut egui::Ui,
    key_badge: &str,
    glyph: &str,
    label: &str,
    is_default: bool,
    is_armed: bool,
    hover_tip: &str,
) -> bool {
    let card_w = 94.0;
    let card_h = 58.0;
    let (rect, response) = ui.allocate_exact_size(Vec2::new(card_w, card_h), egui::Sense::click());

    let hovered = response.hovered();
    let bg_color = if hovered {
        Color32::from_rgb(32, 42, 65)
    } else if is_armed {
        Color32::from_rgb(26, 34, 52)
    } else {
        Color32::from_rgb(18, 23, 36)
    };

    let stroke_color = if hovered {
        ACCENT
    } else if is_default {
        GREEN
    } else if is_armed {
        AMBER
    } else {
        CARD_BORDER
    };

    ui.painter().rect_filled(rect, CornerRadius::same(7), bg_color);
    ui.painter().rect_stroke(
        rect,
        CornerRadius::same(7),
        Stroke::new(if hovered || is_armed { 1.5 } else { 1.0 }, stroke_color),
        egui::StrokeKind::Inside,
    );

    // 上方：快捷键徽章
    let key_color = if is_default { GREEN } else if is_armed { AMBER } else { CYAN };
    let key_text = format!("[{key_badge}]");
    ui.painter().text(
        rect.min + Vec2::new(6.0, 5.0),
        Align2::LEFT_TOP,
        key_text,
        FontId::monospace(10.5),
        key_color,
    );

    if is_default {
        ui.painter().text(
            rect.right_top() + Vec2::new(-6.0, 5.0),
            Align2::RIGHT_TOP,
            "★",
            FontId::proportional(11.0),
            GREEN,
        );
    }

    // 中部：大号数学符号
    ui.painter().text(
        rect.center() + Vec2::new(0.0, -1.0),
        Align2::CENTER_CENTER,
        glyph,
        FontId::proportional(16.0),
        TEXT,
    );

    // 下方：中文结构/符号说明
    ui.painter().text(
        rect.center_bottom() + Vec2::new(0.0, -5.0),
        Align2::CENTER_BOTTOM,
        label,
        FontId::proportional(10.5),
        MUTED,
    );

    response.on_hover_text(hover_tip).clicked()
}

fn output_box(ui: &mut egui::Ui, scroll_id: &str, content: &str) {
    let is_empty = content.is_empty();
    let display = if is_empty { "（尚无内容）" } else { content };
    let color = if is_empty { MUTED } else { TEXT };

    egui::Frame::NONE
        .fill(BG)
        .stroke(Stroke::new(1.0, CARD_BORDER))
        .corner_radius(CornerRadius::same(6))
        .inner_margin(Margin::symmetric(8, 5))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            egui::ScrollArea::both()
                .id_salt(scroll_id)
                .min_scrolled_height(40.0)
                .max_height(40.0)
                .show(ui, |ui| {
                    ui.add(
                        egui::Label::new(
                            RichText::new(display).monospace().size(12.0).color(color),
                        )
                        .selectable(true),
                    );
                });
        });
}

fn section_dot(ui: &mut egui::Ui, color: Color32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(8.0, 8.0), egui::Sense::hover());
    ui.painter().circle_filled(rect.center(), 3.2, color);
}

/// 为上方输入栏源字符串生成无损语法高亮（支持单字母 `▸f`、双字母 `▸ma`/`▸ka`/`▸ta` 及内联跳转 `▸j.`/`▸j-`）
fn highlight_stream_source(source: &str, lib: &UserLibrary) -> LayoutJob {
    let mut job = LayoutJob::default();
    let font = FontId::monospace(18.5);
    let chars: Vec<(usize, char)> = source.char_indices().collect();
    let mut i = 0;

    while i < chars.len() {
        let (byte_start, ch) = chars[i];
        if ch == CMD_PREFIX {
            // 1. 内联跳转 `▸j<lowercase | . | $ | ->`
            if i + 1 < chars.len() && chars[i + 1].1 == 'j' {
                let mut end_idx = i + 2;
                while end_idx < chars.len()
                    && (chars[end_idx].1.is_ascii_lowercase()
                        || matches!(chars[end_idx].1, '.' | '$' | '-'))
                    && end_idx - i < 8
                {
                    end_idx += 1;
                }
                let byte_end = chars
                    .get(end_idx)
                    .map(|(b, _)| *b)
                    .unwrap_or(source.len());
                job.append(
                    &source[byte_start..byte_end],
                    0.0,
                    TextFormat {
                        font_id: font.clone(),
                        color: CYAN,
                        ..Default::default()
                    },
                );
                i = end_idx;
                continue;
            }

            // 2. 带首字母的指令
            if i + 1 < chars.len() && chars[i + 1].1.is_ascii_alphabetic() {
                let c1 = chars[i + 1].1.to_ascii_lowercase();
                if lookup_direct(c1).is_some() {
                    let byte_end = chars
                        .get(i + 2)
                        .map(|(b, _)| *b)
                        .unwrap_or(source.len());
                    job.append(
                        &source[byte_start..byte_end],
                        0.0,
                        TextFormat {
                            font_id: font.clone(),
                            color: AMBER,
                            ..Default::default()
                        },
                    );
                    i += 2;
                    continue;
                }

                if SubCategory::from_key(c1).is_some() {
                    if i + 2 < chars.len() && chars[i + 2].1.is_ascii_alphabetic() {
                        let orig_c2 = chars[i + 2].1;
                        let c2 = orig_c2.to_ascii_lowercase();
                        let byte_end = chars
                            .get(i + 3)
                            .map(|(b, _)| *b)
                            .unwrap_or(source.len());
                        let valid = match c1 {
                            'k' => lib.lookup_custom(c2).is_some(),
                            't' => lib.lookup_snippet(c2).is_some(),
                            _ => lookup_sub_command(c1, orig_c2)
                                .or_else(|| lookup_sub_command(c1, c2))
                                .is_some(),
                        };
                        let color = if valid { AMBER } else { RED };
                        job.append(
                            &source[byte_start..byte_end],
                            0.0,
                            TextFormat {
                                font_id: font.clone(),
                                color,
                                ..Default::default()
                            },
                        );
                        i += 3;
                        continue;
                    }

                    let byte_end = chars
                        .get(i + 2)
                        .map(|(b, _)| *b)
                        .unwrap_or(source.len());
                    let color = if i + 2 < chars.len() { AMBER } else { GREEN };
                    job.append(
                        &source[byte_start..byte_end],
                        0.0,
                        TextFormat {
                            font_id: font.clone(),
                            color,
                            ..Default::default()
                        },
                    );
                    i += 2;
                    continue;
                }

                // 无效首字母
                let byte_end = chars
                    .get(i + 2)
                    .map(|(b, _)| *b)
                    .unwrap_or(source.len());
                job.append(
                    &source[byte_start..byte_end],
                    0.0,
                    TextFormat {
                        font_id: font.clone(),
                        color: RED,
                        ..Default::default()
                    },
                );
                i += 2;
                continue;
            }

            // 孤立 `▸`
            let byte_end = chars
                .get(i + 1)
                .map(|(b, _)| *b)
                .unwrap_or(source.len());
            job.append(
                &source[byte_start..byte_end],
                0.0,
                TextFormat {
                    font_id: font.clone(),
                    color: GREEN,
                    ..Default::default()
                },
            );
            i += 1;
            continue;
        }

        if ch == STEP_SEP {
            let byte_end = chars
                .get(i + 1)
                .map(|(b, _)| *b)
                .unwrap_or(source.len());
            job.append(
                &source[byte_start..byte_end],
                0.0,
                TextFormat {
                    font_id: font.clone(),
                    color: CYAN,
                    ..Default::default()
                },
            );
            i += 1;
            continue;
        }

        let run_start = byte_start;
        i += 1;
        while i < chars.len() && chars[i].1 != CMD_PREFIX && chars[i].1 != STEP_SEP {
            i += 1;
        }
        let run_end = chars.get(i).map(|(b, _)| *b).unwrap_or(source.len());
        job.append(
            &source[run_start..run_end],
            0.0,
            TextFormat {
                font_id: font.clone(),
                color: TEXT,
                ..Default::default()
            },
        );
    }

    job
}

/// 在 Esc 导航模式下拦截所有跳转字符（`a..z`、`;`、`.`、`$`、`-`、`` ` ``、`0`），并清空当帧 `Event::Text` 防止字符漏进输入框
fn consume_esc_jump_key(ctx: &egui::Context) -> Option<char> {
    const KEYS: [(Key, char); 31] = [
        (Key::A, 'a'),
        (Key::B, 'b'),
        (Key::C, 'c'),
        (Key::D, 'd'),
        (Key::E, 'e'),
        (Key::F, 'f'),
        (Key::G, 'g'),
        (Key::H, 'h'),
        (Key::I, 'i'),
        (Key::J, 'j'),
        (Key::K, 'k'),
        (Key::L, 'l'),
        (Key::M, 'm'),
        (Key::N, 'n'),
        (Key::O, 'o'),
        (Key::P, 'p'),
        (Key::Q, 'q'),
        (Key::R, 'r'),
        (Key::S, 's'),
        (Key::T, 't'),
        (Key::U, 'u'),
        (Key::V, 'v'),
        (Key::W, 'w'),
        (Key::X, 'x'),
        (Key::Y, 'y'),
        (Key::Z, 'z'),
        (Key::Semicolon, ';'),
        (Key::Period, '.'),
        (Key::Minus, '-'),
        (Key::Backtick, '`'),
        (Key::Num0, '0'),
    ];
    ctx.input_mut(|input| {
        for (key, ch) in KEYS {
            if input.consume_key(Modifiers::NONE, key) {
                input.events.retain(|ev| match ev {
                    egui::Event::Text(txt) => {
                        !(txt.contains(ch)
                            && txt
                                .chars()
                                .all(|c| c.is_ascii_alphabetic() || matches!(c, ';' | '.' | '$' | '-' | '`' | '0')))
                    }
                    _ => true,
                });
                return Some(ch);
            }
        }
        let mut consumed: Option<(usize, char)> = None;
        for (i, ev) in input.events.iter().enumerate() {
            if let egui::Event::Text(txt) = ev {
                if let Some(c) = txt.chars().find(|&c| {
                    c.is_ascii_alphabetic() || matches!(c, ';' | '.' | '$' | '-' | '`' | '0')
                }) {
                    consumed = Some((i, c));
                    break;
                }
            }
        }
        if let Some((i, c)) = consumed {
            input.events.remove(i);
            return Some(c.to_ascii_lowercase());
        }
        None
    })
}

fn fitted_size(
    texture: &egui::TextureHandle,
    max_width: f32,
    max_height: f32,
    max_scale: f32,
) -> Vec2 {
    let original = texture.size_vec2() / PIXELS_PER_POINT;
    if original.x <= 0.0 || original.y <= 0.0 {
        return Vec2::new(1.0, 1.0);
    }
    let scale = (max_width / original.x)
        .min(max_height / original.y)
        .min(max_scale)
        .max(0.05);
    original * scale
}

fn update_texture(
    ctx: &egui::Context,
    target: &mut Option<egui::TextureHandle>,
    name: &str,
    image: egui::ColorImage,
) {
    if let Some(texture) = target {
        texture.set(image, egui::TextureOptions::LINEAR);
    } else {
        *target = Some(ctx.load_texture(name, image, egui::TextureOptions::LINEAR));
    }
}

fn card_frame() -> egui::Frame {
    egui::Frame::NONE
        .fill(CARD)
        .stroke(Stroke::new(1.0, CARD_BORDER))
        .corner_radius(CornerRadius::same(9))
        .inner_margin(Margin::symmetric(12, 10))
}

fn surface_card(stroke: Stroke) -> egui::Frame {
    egui::Frame::NONE
        .fill(PREVIEW_SURFACE)
        .stroke(stroke)
        .corner_radius(CornerRadius::same(9))
        .inner_margin(Margin::symmetric(12, 10))
}

fn install_style(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::dark();
    visuals.panel_fill = PANEL;
    visuals.window_fill = PANEL;
    visuals.extreme_bg_color = BG;
    visuals.faint_bg_color = CARD;
    visuals.override_text_color = Some(TEXT);
    visuals.selection.bg_fill = Color32::from_rgb(37, 99, 235);
    visuals.hyperlink_color = ACCENT;
    visuals.widgets.noninteractive.fg_stroke = Stroke::new(1.0, TEXT);
    visuals.widgets.noninteractive.bg_fill = PANEL;
    visuals.widgets.noninteractive.bg_stroke = Stroke::new(1.0, CARD_BORDER);
    visuals.widgets.inactive.weak_bg_fill = CARD;
    visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, CARD_BORDER);
    visuals.widgets.inactive.fg_stroke = Stroke::new(1.0, TEXT);
    visuals.widgets.inactive.corner_radius = CornerRadius::same(5);
    visuals.widgets.hovered.weak_bg_fill = Color32::from_rgb(38, 48, 68);
    visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, ACCENT);
    visuals.widgets.hovered.fg_stroke = Stroke::new(1.0, TEXT);
    visuals.widgets.hovered.corner_radius = CornerRadius::same(5);
    visuals.widgets.active.weak_bg_fill = Color32::from_rgb(37, 99, 235);
    visuals.widgets.active.bg_stroke = Stroke::new(1.0, ACCENT);
    visuals.widgets.active.fg_stroke = Stroke::new(1.0, Color32::WHITE);
    visuals.widgets.active.corner_radius = CornerRadius::same(5);
    ctx.set_theme(egui::ThemePreference::Dark);
    ctx.set_visuals(visuals);
    ctx.all_styles_mut(|style| {
        style.spacing.item_spacing = Vec2::new(6.0, 4.0);
        style.spacing.button_padding = Vec2::new(6.5, 3.5);
        style.spacing.interact_size.y = 24.0;
    });
}

fn install_fonts(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();

    if let Some(prop) = fonts.families.get_mut(&FontFamily::Proportional) {
        if !prop.iter().any(|name| name == "Hack") {
            let insert_pos = prop.len().min(1);
            prop.insert(insert_pos, "Hack".to_owned());
        }
    }

    let candidates = [
        "/usr/local/share/fonts/l/LXGWWenKai_Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/google-noto-sans-cjk-vf-fonts/NotoSansCJK-VF.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\simhei.ttf",
        "C:\\Windows\\Fonts\\simsun.ttc",
        "/usr/share/fonts/google-droid-sans-fonts/DroidSansFallbackFull.ttf",
    ];

    let mut font_bytes = None;
    for path in candidates {
        if Path::new(path).is_file() {
            if let Ok(bytes) = std::fs::read(path) {
                font_bytes = Some(bytes);
                break;
            }
        }
    }

    #[cfg(target_os = "linux")]
    if font_bytes.is_none() {
        if let Ok(output) = std::process::Command::new("fc-match")
            .args(["-f", "%{file}", "sans-serif:lang=zh-cn"])
            .output()
        {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            if !path.is_empty() {
                if let Ok(bytes) = std::fs::read(path) {
                    font_bytes = Some(bytes);
                }
            }
        }
    }

    if let Some(bytes) = font_bytes {
        fonts.font_data.insert(
            "mathslot-cjk".to_owned(),
            Arc::new(FontData::from_owned(bytes)),
        );
        fonts
            .families
            .entry(FontFamily::Proportional)
            .or_default()
            .push("mathslot-cjk".to_owned());
        fonts
            .families
            .entry(FontFamily::Monospace)
            .or_default()
            .push("mathslot-cjk".to_owned());
    }

    ctx.set_fonts(fonts);
}

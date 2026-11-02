use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use eframe::egui::text::{CCursor, CCursorRange, LayoutJob, TextFormat};
use eframe::egui::{
    self, Align, Color32, CornerRadius, FontData, FontDefinitions, FontFamily, FontId, Id, Key,
    Layout, Margin, Modifiers, RichText, Stroke, Vec2,
};

use mathslot_core::ast::NavEntryKind;
use mathslot_core::command::{
    CMD_PREFIX, DIRECT_ENTRIES, DirectEntry, PrefixMenuState, STEP_SEP, SubCategory, SubEntry,
    lookup_direct, lookup_sub_command,
};
use mathslot_core::editor::{Snapshot, StreamEditor};
use mathslot_core::latex;
use mathslot_core::library::UserLibrary;
use mathslot_core::scheme_a;
use crate::modals::{LibraryModalState, ModalAction, load_library_from_disk, save_library_to_disk};
use crate::render::{PIXELS_PER_POINT, RenderJob, RenderWorker};

const BG: Color32 = Color32::from_rgb(15, 23, 42);
const PANEL: Color32 = Color32::from_rgb(17, 24, 39);
const CARD: Color32 = Color32::from_rgb(30, 41, 59);
const CARD_BORDER: Color32 = Color32::from_rgb(51, 65, 85);
const PREVIEW_SURFACE: Color32 = Color32::from_rgb(248, 250, 252);
const TEXT: Color32 = Color32::from_rgb(241, 245, 249);
const MUTED: Color32 = Color32::from_rgb(148, 163, 184);
const ACCENT: Color32 = Color32::from_rgb(96, 165, 250);
const VIOLET: Color32 = Color32::from_rgb(167, 139, 250);
const GREEN: Color32 = Color32::from_rgb(74, 222, 128);
const RED: Color32 = Color32::from_rgb(248, 113, 113);
const AMBER: Color32 = Color32::from_rgb(251, 191, 36);
const CYAN: Color32 = Color32::from_rgb(56, 189, 248);

const TOP_PANEL_EXACT_HEIGHT: f32 = 148.0;
const MENU_CARD_INNER_HEIGHT: f32 = 82.0;
const PREVIEW_MAX_WIDTH: f32 = 760.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DelimiterStyle {
    None,
    Inline,
    Display,
}

const PRESETS: &[(&str, &str)] = &[
    ("根号与分式嵌套", "▸r1 + ▸rx + 1;; + ▸fx + 1;y;"),
    ("重要极限示例", "▸lx;0;▸fsin x;x; = 1"),
    ("积分上限嵌套积分", "▸i0;▸i1;t;g(u) du;;f(x) dx"),
    ("一元二次求根公式", "x = ▸f-b +- ▸rb^2 - 4ac;;2a;"),
    ("二阶特征行列式", "▸mc▸gl - a;-b;-c;▸gl - d; = 0"),
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
    copy_feedback_until: Option<Instant>,
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
            status: "就绪：Tab+单字母 输入结构（前置 Tab l 自动包裹极限主体！），↑↓←→ 直觉穿槽，Esc a/;/- 跳改，F1 查看帮助。"
                .to_owned(),
            delimiter_style: DelimiterStyle::Inline,
            copy_feedback_until: None,
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
        }
    }

    fn copy_latex(&mut self, ctx: &egui::Context) {
        let text = self.formatted_latex();
        if text.is_empty() {
            self.status = "当前尚无内容可复制。".to_owned();
            return;
        }
        ctx.copy_text(text);
        self.copy_feedback_until = Some(Instant::now() + Duration::from_millis(1600));
        self.status = "✓ 已将 LaTeX 复制到系统剪贴板。".to_owned();
    }

    fn copy_scheme_a(&mut self, ctx: &egui::Context) {
        let text = scheme_a::to_scheme_a(&self.editor.parsed);
        if text.is_empty() {
            self.status = "当前尚无展开表达式可复制。".to_owned();
            return;
        }
        ctx.copy_text(text);
        self.status = "✓ 已将方案 A 结构表达式复制到剪贴板。".to_owned();
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

        // 若打开了「扩展/模版」或「帮助」弹窗，仅拦截 Esc 关闭弹窗，其余按键交由弹窗表单自由输入！
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

        // Esc 导航跳转切换（绝不主动放弃输入框焦点，防止界面失焦！）
        if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Escape)) {
            self.status = self.editor.toggle_esc_jump();
            self.request_input_focus = true;
            self.mark_dirty();
            return;
        }

        // 若正处于 Esc 多级导航模式：直接在事件进 TextEdit 前拦截处理，保持焦点常驻
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
                self.status = "已退出导航模式，恢复流式输入。".to_owned();
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

        // 若当前打开了二级子菜单（如 `▸m`、`▸g`、`▸k`、`▸t`），按 Space 也可一键确认★默认条目！
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

        // 常态流式输入：2D 上下方向键直觉穿梭 + 左右方向键原子跨过 `▸<code>` 指令前缀
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

        // 常态流式输入：拦截 Tab (插入/撤回 `▸`) 与 Enter (Smart Enter 推进或选用子菜单默认项)
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
    // 顶部面板：严格锁高免抖动菜单（单字母高频直达 + 带★默认项的 5 个子菜单）
    // -----------------------------------------------------------------------

    fn top_ui(&mut self, ui: &mut egui::Ui) {
        let mut action_undo = false;
        let mut action_redo = false;
        let mut action_clear = false;
        let mut action_preset = false;
        let mut action_jump_back = false;
        let mut action_quick_save = false;
        let mut open_custom_mgr = false;
        let mut open_snip_mgr = false;
        let mut open_help = false;
        let mut clicked_card_code: Option<String> = None;
        let mut clicked_sub_key: Option<char> = None;
        let mut clicked_jump_seq: Option<String> = None;

        let prefix_state = self.editor.prefix_menu_state();

        ui.horizontal(|ui| {
            ui.label(
                RichText::new("MathSlot")
                    .size(20.0)
                    .strong()
                    .color(ACCENT),
            );
            ui.label(
                RichText::new("流式简码公式编辑器")
                    .size(11.5)
                    .color(MUTED),
            );
            ui.add_space(4.0);

            let (badge_text, badge_color) = if let Some(esc) = &self.editor.esc_nav {
                if esc.path.is_empty() {
                    ("● 导航直达态 (Esc)".to_owned(), ACCENT)
                } else {
                    (
                        format!("● 子式导航 [{}]", esc.path.join(" › ")),
                        VIOLET,
                    )
                }
            } else {
                match &prefix_state {
                    PrefixMenuState::Idle => ("● 流式输入态".to_owned(), GREEN),
                    PrefixMenuState::Root => ("● 已按 Tab(▸)：请按键".to_owned(), AMBER),
                    PrefixMenuState::SubMenu(sub) => {
                        (format!("● 子菜单 ▸{} · {}", sub.key(), sub.title()), AMBER)
                    }
                    PrefixMenuState::Jump(seq) => {
                        (format!("● 内联跳转 ▸j{seq}"), CYAN)
                    }
                    PrefixMenuState::InvalidPrefix(ch) => {
                        (format!("● 未知键 ▸{ch}"), RED)
                    }
                }
            };
            ui.label(RichText::new(badge_text).size(12.0).strong().color(badge_color));

            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.spacing_mut().item_spacing.x = 5.0;
                if ui
                    .button(RichText::new("? 帮助").color(CYAN))
                    .on_hover_text("打开完整快捷键与功能使用说明 (F1)")
                    .clicked()
                {
                    open_help = true;
                }
                if ui
                    .button(RichText::new("扩展/模版").color(AMBER))
                    .on_hover_text("无需改源码：管理自定义数学格式 [k▸] 与复用片段模版库 [t▸]")
                    .clicked()
                {
                    open_custom_mgr = true;
                }
                if ui
                    .button(RichText::new("+存片段").color(GREEN))
                    .on_hover_text("将光标所在子结构（或整行公式）保存为可复用片段 (Ctrl+Shift+S)")
                    .clicked()
                {
                    action_quick_save = true;
                }
                if ui
                    .add_enabled(
                        self.editor.can_jump_back(),
                        egui::Button::new("↶回原位"),
                    )
                    .on_hover_text("返回上一个跳转位置（快捷键：Esc - 或 Alt+←，支持来回切换）")
                    .clicked()
                {
                    action_jump_back = true;
                }
                if ui.button("清空").on_hover_text("清空当前输入栏").clicked() {
                    action_clear = true;
                }
                if ui
                    .add_enabled(self.editor.can_redo(), egui::Button::new("重做"))
                    .on_hover_text("Ctrl+Y / Ctrl+Shift+Z")
                    .clicked()
                {
                    action_redo = true;
                }
                if ui
                    .add_enabled(self.editor.can_undo(), egui::Button::new("撤销"))
                    .on_hover_text("Ctrl+Z")
                    .clicked()
                {
                    action_undo = true;
                }
                let next_preset_name = PRESETS[self.preset_index % PRESETS.len()].0;
                if ui
                    .button("示例 ↻")
                    .on_hover_text(format!("加载示例：{next_preset_name}"))
                    .clicked()
                {
                    action_preset = true;
                }
            });
        });

        ui.add_space(5.0);

        // 固定高度菜单容器：无论切换任何状态，高度恒定不抖动！
        let frame_stroke = if self.editor.esc_nav.is_some() {
            Stroke::new(1.5, ACCENT)
        } else {
            match &prefix_state {
                PrefixMenuState::Idle => Stroke::new(1.0, CARD_BORDER),
                PrefixMenuState::Root | PrefixMenuState::SubMenu(_) => Stroke::new(1.5, AMBER),
                PrefixMenuState::Jump(_) => Stroke::new(1.5, CYAN),
                PrefixMenuState::InvalidPrefix(_) => Stroke::new(1.5, RED),
            }
        };

        egui::Frame::NONE
            .fill(CARD)
            .stroke(frame_stroke)
            .corner_radius(CornerRadius::same(8))
            .inner_margin(Margin::symmetric(10, 6))
            .show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.set_min_height(MENU_CARD_INNER_HEIGHT);
                ui.set_max_height(MENU_CARD_INNER_HEIGHT);

                egui::ScrollArea::vertical()
                    .id_salt("mathslot-fixed-menu-scroll")
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        if let Some(esc) = self.editor.esc_nav.clone() {
                            self.render_jump_menu_content(
                                ui,
                                true,
                                &esc.path,
                                &esc.partial,
                                &mut clicked_jump_seq,
                            );
                        } else {
                            match prefix_state {
                                PrefixMenuState::Idle => {
                                    self.render_unified_root_grid(
                                        ui,
                                        false,
                                        None,
                                        &mut clicked_card_code,
                                        &mut clicked_sub_key,
                                    );
                                }
                                PrefixMenuState::Root => {
                                    self.render_unified_root_grid(
                                        ui,
                                        true,
                                        None,
                                        &mut clicked_card_code,
                                        &mut clicked_sub_key,
                                    );
                                }
                                PrefixMenuState::InvalidPrefix(bad) => {
                                    self.render_unified_root_grid(
                                        ui,
                                        true,
                                        Some(bad),
                                        &mut clicked_card_code,
                                        &mut clicked_sub_key,
                                    );
                                }
                                PrefixMenuState::SubMenu(sub) => {
                                    self.render_submenu_grid(
                                        ui,
                                        sub,
                                        &mut clicked_card_code,
                                        &mut open_custom_mgr,
                                        &mut open_snip_mgr,
                                        &mut action_quick_save,
                                    );
                                }
                                PrefixMenuState::Jump(_) => {
                                    let (path, filter) = self.editor.active_nav_view_state();
                                    self.render_jump_menu_content(
                                        ui,
                                        false,
                                        &path,
                                        filter.as_deref().unwrap_or(""),
                                        &mut clicked_jump_seq,
                                    );
                                }
                            }
                        }
                    });
            });

        if open_help {
            self.modals.show_help = true;
        }
        if open_custom_mgr {
            self.modals.open_custom_tab(&self.editor.library);
        }
        if open_snip_mgr {
            self.modals.open_snippets_tab(&self.editor.library);
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
        if let Some(sub_ch) = clicked_sub_key {
            self.status = self.editor.apply_sub_click(sub_ch);
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
        }
        if let Some(code) = clicked_card_code {
            self.status = self.editor.apply_card_click(&code);
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
        }
        if let Some(seq_str) = clicked_jump_seq {
            if let Ok(msg) = self.editor.jump_to_sequence(&seq_str) {
                self.status = msg;
                self.pending_cursor_sync = Some(self.editor.cursor_char);
                self.request_input_focus = true;
                self.mark_dirty();
            }
        }
    }

    /// Idle 与 Root(`▸`) 共用完全一致的双行静态坐标布局：按 Tab 时仅点亮边框与按键色，零位移！
    fn render_unified_root_grid(
        &self,
        ui: &mut egui::Ui,
        prefix_armed: bool,
        invalid_key: Option<char>,
        clicked_code: &mut Option<String>,
        clicked_sub: &mut Option<char>,
    ) {
        let key_color = if prefix_armed { AMBER } else { CYAN };

        // 第一行：11 个单字母高频直达（Tab + 1 键完成）
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = Vec2::new(5.0, 4.0);
            if let Some(bad) = invalid_key {
                ui.label(
                    RichText::new(format!("未知 `{bad}`(退格重按):"))
                        .size(11.5)
                        .strong()
                        .color(RED),
                );
            } else {
                ui.label(
                    RichText::new("单字母直达:")
                        .size(11.5)
                        .strong()
                        .color(if prefix_armed { AMBER } else { MUTED }),
                );
            }
            for entry in DIRECT_ENTRIES {
                if render_direct_pill(ui, entry, key_color, prefix_armed) {
                    *clicked_code = Some(entry.key.to_string());
                }
            }
        });

        ui.add_space(4.0);

        // 第二行：5 个内置子菜单 + [k▸] 自定义格式 + [t▸] 片段模版 + [j] 跳转说明
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = Vec2::new(5.0, 4.0);
            ui.label(
                RichText::new("子菜单:")
                    .size(11.5)
                    .strong()
                    .color(if prefix_armed { AMBER } else { MUTED }),
            );
            for sub in SubCategory::ALL {
                let (star_hint, hover_desc) = match sub {
                    SubCategory::Custom => {
                        let def_str = self
                            .editor
                            .library
                            .default_custom()
                            .map(|d| format!(" ★{}", d.glyph_hint))
                            .unwrap_or_default();
                        (
                            def_str,
                            format!(
                                "按 Tab + k 调用自定义数学格式（共 {} 项，点击右上「扩展/模版」可新增任意 LaTeX 格式）",
                                self.editor.library.custom_formats.len()
                            ),
                        )
                    }
                    SubCategory::Template => {
                        let cnt = self.editor.library.snippets.len();
                        (
                            format!(" ({cnt})"),
                            format!(
                                "按 Tab + t 调用已保存的复杂公式或填空模版（共 {cnt} 项，点「+存片段」一键收集）"
                            ),
                        )
                    }
                    _ => {
                        let def = sub.default_entry().expect("static sub has default");
                        (
                            format!(" ★{}", def.glyph_hint),
                            format!(
                                "按 Tab + {} 展开；再按 Enter/空格 直接选默认「{} ({})」",
                                sub.key(),
                                def.label,
                                def.glyph_hint
                            ),
                        )
                    }
                };

                let mut job = LayoutJob::default();
                job.append(
                    &format!("[{}{CMD_PREFIX}] ", sub.key()),
                    0.0,
                    TextFormat {
                        font_id: FontId::monospace(11.5),
                        color: key_color,
                        ..Default::default()
                    },
                );
                job.append(
                    sub.title(),
                    0.0,
                    TextFormat {
                        font_id: FontId::proportional(11.5),
                        color: TEXT,
                        ..Default::default()
                    },
                );
                if !star_hint.is_empty() {
                    job.append(
                        &star_hint,
                        0.0,
                        TextFormat {
                            font_id: FontId::monospace(11.0),
                            color: MUTED,
                            ..Default::default()
                        },
                    );
                }
                if ui
                    .add(egui::Button::new(job))
                    .on_hover_text(hover_desc)
                    .clicked()
                {
                    *clicked_sub = Some(sub.key());
                }
            }
            let jump_btn = egui::Button::new(
                RichText::new("[j] 跳转(Esc)")
                    .monospace()
                    .size(11.5)
                    .color(CYAN),
            );
            if ui
                .add(jump_btn)
                .on_hover_text(
                    "按 Esc（或 Tab+j）：a 行首 · ;/. 行尾 · - 上一位置 · 字母直达槽位 · ↑↓←→ 穿梭",
                )
                .clicked()
            {
                *clicked_sub = Some('j');
            }
        });
    }

    fn render_submenu_grid(
        &self,
        ui: &mut egui::Ui,
        sub: SubCategory,
        clicked_code: &mut Option<String>,
        open_custom_mgr: &mut bool,
        open_snip_mgr: &mut bool,
        quick_save_snip: &mut bool,
    ) {
        match sub {
            SubCategory::Custom => {
                ui.horizontal(|ui| {
                    let def_txt = self
                        .editor
                        .library
                        .default_custom()
                        .map(|d| format!("Enter/空格 选默认 [★{}: {}]", d.item_key, d.label))
                        .unwrap_or_else(|| "暂无条目".to_owned());
                    ui.label(
                        RichText::new(format!(
                            "{CMD_PREFIX}k · 自定义数学格式 — 按单字母即选；{def_txt}（Backspace 退回）"
                        ))
                        .size(11.5)
                        .strong()
                        .color(AMBER),
                    );
                    if ui
                        .small_button(RichText::new("+ 新增/管理格式").color(GREEN))
                        .clicked()
                    {
                        *open_custom_mgr = true;
                    }
                });
                ui.add_space(4.0);
                let def_key = self.editor.library.default_custom().map(|d| d.item_key);
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = Vec2::new(5.5, 4.0);
                    for fmt in &self.editor.library.custom_formats {
                        let is_def = def_key == Some(fmt.item_key);
                        let code = fmt.code();
                        let roles_desc = if fmt.slot_roles.is_empty() {
                            "0槽符号".to_owned()
                        } else {
                            fmt.slot_roles.join(" ; ")
                        };
                        if render_dynamic_pill(
                            ui,
                            fmt.item_key,
                            is_def,
                            &fmt.label,
                            &fmt.glyph_hint,
                            &format!("{CMD_PREFIX}{code} | 槽位: {roles_desc} | {}", fmt.latex_template),
                        ) {
                            *clicked_code = Some(code);
                        }
                    }
                });
            }
            SubCategory::Template => {
                ui.horizontal(|ui| {
                    let def_txt = self
                        .editor
                        .library
                        .default_snippet()
                        .map(|s| format!("Enter/空格 选默认 [★{}: {}]", s.item_key, s.label))
                        .unwrap_or_else(|| "暂无片段".to_owned());
                    ui.label(
                        RichText::new(format!(
                            "{CMD_PREFIX}t · 复用片段与填空模版 — 按单字母内联展开；{def_txt}"
                        ))
                        .size(11.5)
                        .strong()
                        .color(AMBER),
                    );
                    if ui
                        .small_button(RichText::new("+ 将当前式子存为片段").color(GREEN))
                        .clicked()
                    {
                        *quick_save_snip = true;
                    }
                    if ui.small_button("管理片段库").clicked() {
                        *open_snip_mgr = true;
                    }
                });
                ui.add_space(4.0);
                let def_key = self.editor.library.default_snippet().map(|s| s.item_key);
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = Vec2::new(5.5, 4.0);
                    for snip in &self.editor.library.snippets {
                        let is_def = def_key == Some(snip.item_key);
                        let code = snip.code();
                        if render_dynamic_pill(
                            ui,
                            snip.item_key,
                            is_def,
                            &snip.label,
                            "",
                            &format!("{CMD_PREFIX}{code} → 展开 `{}`", snip.stream_source),
                        ) {
                            *clicked_code = Some(code);
                        }
                    }
                });
            }
            _ => {
                let def = sub.default_entry().expect("static sub has default");
                ui.horizontal(|ui| {
                    ui.label(
                        RichText::new(format!(
                            "{CMD_PREFIX}{} · {} — 按单字母即选；按 Enter/空格 直接选默认 [★{}: {} {}]（Backspace 退回，Tab 取消）",
                            sub.key(),
                            sub.title(),
                            def.item_key,
                            def.label,
                            def.glyph_hint
                        ))
                        .size(11.5)
                        .strong()
                        .color(AMBER),
                    );
                });
                ui.add_space(4.0);
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = Vec2::new(5.5, 4.0);
                    for entry in sub.entries() {
                        if render_sub_pill(ui, entry) {
                            *clicked_code = Some(entry.code.to_owned());
                        }
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

        let headline = if path.is_empty() {
            if is_esc_mode {
                "Esc 导航直达 · [a] 行首 · [;/.] 行尾 · [-] 回上一位置 · 字母直达槽位 · ↑↓←→ 漫游（Esc 取消）"
                    .to_owned()
            } else {
                format!(
                    "内联跳转 {CMD_PREFIX}j{partial}：按字母直达，`.` 行尾，`-` 回上一位置（自动擦除跳转码）"
                )
            }
        } else {
            let joined = path.join(" › ");
            format!(
                "子式导航 [{joined}+]（{}）：按字母或 `;` 定位子式内部，Enter 停在该槽末尾，Backspace/↑ 返回上层",
                active_stage.scope.title
            )
        };

        ui.label(RichText::new(headline).size(11.5).strong().color(ACCENT));
        ui.add_space(4.0);

        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing = Vec2::new(5.5, 4.0);
            if partial.is_empty() && self.editor.can_jump_back() {
                if ui
                    .button(
                        RichText::new("[↶ -] 上一位置")
                            .monospace()
                            .size(11.5)
                            .color(AMBER),
                    )
                    .on_hover_text("快捷键：按 `-`（或在编辑态按 Alt+←）跳回上一个跳转位置")
                    .clicked()
                {
                    *clicked_seq = Some("-".to_owned());
                }
            }
            for entry in &active_stage.scope.entries {
                if !partial.is_empty() && !entry.label.starts_with(partial) {
                    continue;
                }
                let (tag, color) = match &entry.kind {
                    NavEntryKind::ScopeStart => {
                        let role = if path.is_empty() { "行首" } else { "槽首" };
                        (format!("[{}] {role}", entry.label), CYAN)
                    }
                    NavEntryKind::ScopeEnd => {
                        let role = if path.is_empty() { "行尾" } else { "槽尾" };
                        (format!("[{}] {role}", entry.label), CYAN)
                    }
                    NavEntryKind::Leaf {
                        is_empty: true,
                        role_hint: Some(r),
                    } => (format!("[{}] {r}", entry.label), RED),
                    NavEntryKind::Leaf {
                        role_hint: Some(r), ..
                    } => (format!("[{}] {r}", entry.label), TEXT),
                    NavEntryKind::Leaf { .. } => (format!("[{}]", entry.label), TEXT),
                    NavEntryKind::Composite { role_hint, .. } => {
                        (format!("[{}+] {role_hint}", entry.label), VIOLET)
                    }
                };
                if ui
                    .button(RichText::new(tag).monospace().size(11.5).color(color))
                    .clicked()
                {
                    *clicked_seq = Some(format!("{path_prefix}{}", entry.label));
                }
            }
        });
    }

    // -----------------------------------------------------------------------
    // 中部紧凑工作区：1. 上方持久流输入栏  2. 窄幅实时公式预览  3. 分层结构导航图
    // -----------------------------------------------------------------------

    fn input_card(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let breadcrumbs = self.editor.parsed.breadcrumbs_at(self.editor.cursor_char);

        card_frame().show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal_wrapped(|ui| {
                section_dot(ui, GREEN);
                ui.label(RichText::new("线性流输入栏").size(13.0).strong().color(TEXT));
                ui.separator();

                if breadcrumbs.is_empty() {
                    ui.label(
                        RichText::new(if self.editor.cursor_char == 0 {
                            "当前位置：行首 [a]"
                        } else {
                            "当前层级：最外层序列"
                        })
                        .size(11.5)
                        .color(MUTED),
                    );
                    ui.separator();
                    ui.label(
                        RichText::new("简写: -> 趋向  oo 无穷  +- 正负  <= >=")
                            .monospace()
                            .size(11.0)
                            .color(CYAN),
                    );
                } else {
                    for (depth, bc) in breadcrumbs.iter().enumerate() {
                        if depth > 0 {
                            ui.label(RichText::new("›").size(11.5).color(MUTED));
                        }
                        ui.label(
                            RichText::new(format!(
                                "{}({CMD_PREFIX}{})",
                                bc.label, bc.code
                            ))
                            .size(11.5)
                            .strong()
                            .color(AMBER),
                        );
                        ui.label(RichText::new("[").size(11.5).color(MUTED));
                        for (s_idx, role) in bc.slot_roles.iter().enumerate() {
                            if s_idx > 0 {
                                ui.label(RichText::new(";").size(11.0).color(CYAN));
                            }
                            let is_cur = s_idx == bc.slot_index;
                            let color = if is_cur { GREEN } else { MUTED };
                            let text = format!("{}.{role}", s_idx + 1);
                            let rt = if is_cur {
                                RichText::new(text).size(11.5).strong().color(color)
                            } else {
                                RichText::new(text).size(11.0).color(color)
                            };
                            ui.label(rt);
                        }
                        ui.label(RichText::new("]").size(11.5).color(MUTED));
                    }
                }
            });

            ui.add_space(4.0);

            if let Some(target_char) = self.pending_cursor_sync.take() {
                if let Some(mut state) = egui::TextEdit::load_state(&ctx, self.input_id) {
                    let c = CCursor::new(target_char.min(self.editor.source.chars().count()));
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
                .hint_text(
                    "直接输入公式，如 x -> 0, oo, +-；按 Tab + f(分数) / r(根号) / l(极限:自动带→)，Enter(;) 推进下一槽…",
                )
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
                    self.status =
                        "正在流式输入…（Tab+单字母 插入结构，Enter 推进下一槽，Esc+字母 跳改）"
                            .to_owned();
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

            ui.add_space(3.0);
            ui.label(RichText::new(&self.status).size(11.5).color(MUTED));
        });
    }

    fn formula_card(&self, ui: &mut egui::Ui) {
        let total_w = ui.available_width();
        let target_w = total_w.min(PREVIEW_MAX_WIDTH);
        let pad_x = ((total_w - target_w) * 0.5).max(0.0);

        ui.horizontal(|ui| {
            ui.add_space(pad_x);
            ui.vertical(|ui| {
                ui.set_width(target_w);
                ui.horizontal(|ui| {
                    section_dot(ui, GREEN);
                    ui.label(RichText::new("实时公式预览").size(13.0).strong().color(TEXT));
                    ui.add_space(4.0);
                    legend_dot(ui, GREEN, "当前活跃槽位 & 光标 ∣");
                    legend_dot(ui, RED, "待填槽位");
                    if let Some(err) = &self.render_error {
                        ui.label(RichText::new(err).size(11.0).color(AMBER));
                    }
                });

                surface_card(Stroke::new(1.0, CARD_BORDER)).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    if let Some(texture) = &self.formula_tex {
                        let max_w = (ui.available_width() - 8.0).max(120.0);
                        let size = fitted_size(texture, max_w, 126.0, 1.22);
                        let avail = ui.available_width();
                        ui.horizontal(|ui| {
                            ui.add_space(((avail - size.x) * 0.5).max(0.0));
                            ui.add(egui::Image::new(texture).fit_to_exact_size(size));
                        });
                    } else {
                        ui.label(
                            RichText::new("正在初始化超轻量 LaTeX 数学排版引擎…")
                                .size(12.0)
                                .color(Color32::from_rgb(71, 85, 105)),
                        );
                    }
                });
            });
        });
    }

    fn nav_card(&self, ui: &mut egui::Ui) {
        let esc_active = self.editor.esc_nav.is_some();
        let (nav_path, _) = self.editor.active_nav_view_state();
        let total_w = ui.available_width();
        let target_w = total_w.min(PREVIEW_MAX_WIDTH);
        let pad_x = ((total_w - target_w) * 0.5).max(0.0);

        ui.horizontal(|ui| {
            ui.add_space(pad_x);
            ui.vertical(|ui| {
                ui.set_width(target_w);
                ui.horizontal_wrapped(|ui| {
                    section_dot(ui, ACCENT);
                    ui.label(
                        RichText::new("结构同步导航栏")
                            .size(13.0)
                            .strong()
                            .color(TEXT),
                    );
                    ui.add_space(4.0);
                    legend_dot(ui, CYAN, "[a]首/[;]尾");
                    legend_dot(ui, ACCENT, "已填");
                    legend_dot(ui, RED, "待填");
                    legend_dot(ui, VIOLET, "[+] 嵌套子式");
                    legend_dot(ui, GREEN, "焦点");
                    if !nav_path.is_empty() {
                        ui.label(
                            RichText::new(format!("当前展开: [{}]", nav_path.join(" › ")))
                                .size(11.5)
                                .strong()
                                .color(VIOLET),
                        );
                    }
                });

                let border = if esc_active {
                    Stroke::new(2.0, ACCENT)
                } else if !nav_path.is_empty() {
                    Stroke::new(1.4, VIOLET)
                } else {
                    Stroke::new(1.0, CARD_BORDER)
                };

                surface_card(border).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    if let Some(texture) = &self.nav_tex {
                        let max_w = (ui.available_width() - 8.0).max(120.0);
                        let size = fitted_size(texture, max_w, 114.0, 1.20);
                        let avail = ui.available_width();
                        ui.horizontal(|ui| {
                            ui.add_space(((avail - size.x) * 0.5).max(0.0));
                            ui.add(egui::Image::new(texture).fit_to_exact_size(size));
                        });
                    } else {
                        ui.label(
                            RichText::new("正在生成结构导航图…")
                                .size(12.0)
                                .color(Color32::from_rgb(71, 85, 105)),
                        );
                    }
                });
            });
        });
    }

    fn center_ui(&mut self, ui: &mut egui::Ui) {
        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.set_width(ui.available_width());
                self.input_card(ui);
                ui.add_space(8.0);
                self.formula_card(ui);
                ui.add_space(8.0);
                self.nav_card(ui);
                ui.add_space(4.0);
            });
    }

    // -----------------------------------------------------------------------
    // 底部面板：左栏「方案 A 结构展开」 + 右栏「LaTeX 输出与一键复制」
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

        ui.columns(2, |cols| {
            cols[0].horizontal(|ui| {
                ui.label(
                    RichText::new("展开形态 (方案 A)")
                        .size(12.5)
                        .strong()
                        .color(CYAN),
                );
                ui.label(RichText::new("层次核对").size(11.0).color(MUTED));
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui.small_button("复制展开式").clicked() {
                        click_copy_a = true;
                    }
                });
            });
            cols[0].add_space(3.0);
            output_box(&mut cols[0], "mathslot-scheme-a-scroll", &expanded_a);

            cols[1].horizontal(|ui| {
                ui.label(
                    RichText::new("LaTeX 输出")
                        .size(12.5)
                        .strong()
                        .color(ACCENT),
                );
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    let copy_label = if copied_recent {
                        RichText::new("✓ 已复制").strong().color(GREEN)
                    } else {
                        RichText::new("复制 LaTeX").strong().color(TEXT)
                    };
                    if ui
                        .button(copy_label)
                        .on_hover_text("快捷键：Ctrl+Shift+C 或 Ctrl+Enter")
                        .clicked()
                    {
                        click_copy_latex = true;
                    }
                    if ui
                        .selectable_label(self.delimiter_style == DelimiterStyle::Display, "$$…$$")
                        .clicked()
                    {
                        self.delimiter_style = DelimiterStyle::Display;
                        self.request_input_focus = true;
                    }
                    if ui
                        .selectable_label(self.delimiter_style == DelimiterStyle::Inline, "$…$")
                        .clicked()
                    {
                        self.delimiter_style = DelimiterStyle::Inline;
                        self.request_input_focus = true;
                    }
                    if ui
                        .selectable_label(self.delimiter_style == DelimiterStyle::None, "裸代码")
                        .clicked()
                    {
                        self.delimiter_style = DelimiterStyle::None;
                        self.request_input_focus = true;
                    }
                });
            });
            cols[1].add_space(3.0);
            output_box(&mut cols[1], "mathslot-latex-scroll", &latex_str);
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
                    .inner_margin(Margin::symmetric(14, 8)),
            )
            .show(ui, |ui| self.top_ui(ui));

        egui::Panel::bottom("mathslot-bottom-panel")
            .resizable(false)
            .min_size(112.0)
            .max_size(112.0)
            .frame(
                egui::Frame::NONE
                    .fill(PANEL)
                    .inner_margin(Margin::symmetric(14, 8)),
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

        // 守护输入框焦点：当未打开弹窗时，任何按钮点击后或无焦点状态下自动归位，彻底杜绝失去焦点
        if self.request_input_focus
            || (!self.modals.any_open() && ctx.memory(|m| m.focused().is_none()))
        {
            ctx.memory_mut(|m| m.request_focus(self.input_id));
            self.request_input_focus = false;
        }

        self.dispatch_and_poll_render(&ctx);
    }
}

fn render_direct_pill(
    ui: &mut egui::Ui,
    entry: &DirectEntry,
    key_color: Color32,
    armed: bool,
) -> bool {
    let mut job = LayoutJob::default();
    job.append(
        &format!("[{}] ", entry.key),
        0.0,
        TextFormat {
            font_id: FontId::monospace(12.0),
            color: key_color,
            ..Default::default()
        },
    );
    job.append(
        entry.label,
        0.0,
        TextFormat {
            font_id: FontId::proportional(12.0),
            color: TEXT,
            ..Default::default()
        },
    );
    let mut btn = egui::Button::new(job);
    if armed {
        btn = btn.stroke(Stroke::new(1.0, Color32::from_rgb(180, 83, 9)));
    }
    ui.add(btn)
        .on_hover_text(format!(
            "单字母直达：Tab + {}  ({})  |  槽位：{}",
            entry.key, entry.glyph_hint, entry.detail
        ))
        .clicked()
}

fn render_sub_pill(ui: &mut egui::Ui, entry: &SubEntry) -> bool {
    let mut job = LayoutJob::default();
    let prefix_txt = if entry.is_default {
        format!("[★{}] ", entry.item_key)
    } else {
        format!("[{}] ", entry.item_key)
    };
    job.append(
        &prefix_txt,
        0.0,
        TextFormat {
            font_id: FontId::monospace(12.0),
            color: if entry.is_default { GREEN } else { AMBER },
            ..Default::default()
        },
    );
    job.append(
        entry.label,
        0.0,
        TextFormat {
            font_id: FontId::proportional(12.0),
            color: TEXT,
            ..Default::default()
        },
    );
    job.append(
        &format!(" {}", entry.glyph_hint),
        0.0,
        TextFormat {
            font_id: FontId::monospace(11.5),
            color: CYAN,
            ..Default::default()
        },
    );

    let mut btn = egui::Button::new(job);
    if entry.is_default {
        btn = btn.stroke(Stroke::new(1.0, GREEN));
    }
    ui.add(btn)
        .on_hover_text(format!(
            "简码：{CMD_PREFIX}{}  |  {}",
            entry.code, entry.detail
        ))
        .clicked()
}

fn render_dynamic_pill(
    ui: &mut egui::Ui,
    item_key: char,
    is_default: bool,
    label: &str,
    glyph_hint: &str,
    hover: &str,
) -> bool {
    let mut job = LayoutJob::default();
    let prefix_txt = if is_default {
        format!("[★{item_key}] ")
    } else {
        format!("[{item_key}] ")
    };
    job.append(
        &prefix_txt,
        0.0,
        TextFormat {
            font_id: FontId::monospace(12.0),
            color: if is_default { GREEN } else { AMBER },
            ..Default::default()
        },
    );
    job.append(
        label,
        0.0,
        TextFormat {
            font_id: FontId::proportional(12.0),
            color: TEXT,
            ..Default::default()
        },
    );
    if !glyph_hint.is_empty() {
        job.append(
            &format!(" {glyph_hint}"),
            0.0,
            TextFormat {
                font_id: FontId::monospace(11.5),
                color: CYAN,
                ..Default::default()
            },
        );
    }
    let mut btn = egui::Button::new(job);
    if is_default {
        btn = btn.stroke(Stroke::new(1.0, GREEN));
    }
    ui.add(btn).on_hover_text(hover).clicked()
}

fn output_box(ui: &mut egui::Ui, scroll_id: &str, content: &str) {
    let is_empty = content.is_empty();
    let display = if is_empty { "（尚无内容）" } else { content };
    let color = if is_empty { MUTED } else { TEXT };

    egui::Frame::NONE
        .fill(BG)
        .stroke(Stroke::new(1.0, CARD_BORDER))
        .corner_radius(CornerRadius::same(8))
        .inner_margin(Margin::symmetric(10, 7))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            egui::ScrollArea::both()
                .id_salt(scroll_id)
                .min_scrolled_height(52.0)
                .max_height(52.0)
                .show(ui, |ui| {
                    ui.add(
                        egui::Label::new(
                            RichText::new(display).monospace().size(13.0).color(color),
                        )
                        .selectable(true),
                    );
                });
        });
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
                        let c2 = chars[i + 2].1.to_ascii_lowercase();
                        let byte_end = chars
                            .get(i + 3)
                            .map(|(b, _)| *b)
                            .unwrap_or(source.len());
                        let valid = match c1 {
                            'k' => lib.lookup_custom(c2).is_some(),
                            't' => lib.lookup_snippet(c2).is_some(),
                            _ => lookup_sub_command(c1, c2).is_some(),
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
        // 物理按键优先；命中后仅移除会漏进输入框的纯跳转字符文本事件，
        // 保留 IME 上屏内容（中文等多字节文本）不被吞掉
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
        // 无物理键命中时（如 IME/虚拟键盘只产生 Text 事件），取首个含合法跳转字符的
        // Text 事件并仅移除该事件，其余 Text 事件原样保留
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

fn section_dot(ui: &mut egui::Ui, color: Color32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(9.0, 9.0), egui::Sense::hover());
    ui.painter().circle_filled(rect.center(), 3.6, color);
}

fn legend_dot(ui: &mut egui::Ui, color: Color32, label: &str) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(7.5, 7.5), egui::Sense::hover());
    ui.painter().circle_filled(rect.center(), 3.0, color);
    ui.label(RichText::new(label).size(11.0).color(MUTED));
}

fn card_frame() -> egui::Frame {
    egui::Frame::NONE
        .fill(CARD)
        .stroke(Stroke::new(1.0, CARD_BORDER))
        .corner_radius(CornerRadius::same(9))
        .inner_margin(Margin::symmetric(12, 9))
}

fn surface_card(stroke: Stroke) -> egui::Frame {
    egui::Frame::NONE
        .fill(PREVIEW_SURFACE)
        .stroke(stroke)
        .corner_radius(CornerRadius::same(9))
        .inner_margin(Margin::symmetric(10, 7))
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
    visuals.widgets.hovered.weak_bg_fill = Color32::from_rgb(51, 65, 85);
    visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, ACCENT);
    visuals.widgets.hovered.fg_stroke = Stroke::new(1.0, TEXT);
    visuals.widgets.active.weak_bg_fill = Color32::from_rgb(37, 99, 235);
    visuals.widgets.active.bg_stroke = Stroke::new(1.0, ACCENT);
    visuals.widgets.active.fg_stroke = Stroke::new(1.0, Color32::WHITE);
    ctx.set_theme(egui::ThemePreference::Dark);
    ctx.set_visuals(visuals);
    ctx.all_styles_mut(|style| {
        style.spacing.item_spacing = Vec2::new(7.0, 5.0);
        style.spacing.button_padding = Vec2::new(7.5, 3.5);
        style.spacing.interact_size.y = 24.0;
    });
}

/// 统一装配 Proportional 与 Monospace 字体回退链：
/// 1. 将内置 `Hack`（含完整数学算子、`▸`、`↻`、`●` 等）注入 `Proportional` 回退链，修复比例字体下符号缺字；
/// 2. 优先加载静态 `.ttf` 中文字体（覆盖中文与 `★`、`∮` 等符号），消除 `.ttc` 可变字体兼容性隐患。
fn install_fonts(ctx: &egui::Context) {
    let mut fonts = FontDefinitions::default();

    if let Some(prop) = fonts.families.get_mut(&FontFamily::Proportional) {
        if !prop.iter().any(|name| name == "Hack") {
            let insert_pos = prop.len().min(1);
            prop.insert(insert_pos, "Hack".to_owned());
        }
    }

    let candidates = [
        // 优先静态单文件 TTF（兼容 ab_glyph 且符号覆盖完整）
        "/usr/local/share/fonts/l/LXGWWenKai_Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/google-noto-sans-cjk-vf-fonts/NotoSansCJK-VF.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        // macOS
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        // Windows
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\simhei.ttf",
        "C:\\Windows\\Fonts\\simsun.ttc",
        // 兜底
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

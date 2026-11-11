use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use eframe::egui::text::{CCursor, CCursorRange, LayoutJob, TextFormat};
use eframe::egui::{
    self, Align, Align2, Color32, CornerRadius, FontData, FontDefinitions, FontFamily, FontId, Id,
    Key, Layout, Margin, Modifiers, Rect, RichText, Sense, Stroke, StrokeKind, Vec2,
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
use crate::theme::*;

const TOP_BAR_HEIGHT: f32 = 48.0;
const STATUS_BAR_HEIGHT: f32 = 26.0;
const LEFT_PANEL_DEFAULT_WIDTH: f32 = 460.0;
const PREVIEW_BOX_HEIGHT: f32 = 130.0;
const NAV_BOX_HEIGHT: f32 = 96.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaletteCategory {
    Direct,    // 常用结构 (12项单键直达)
    Calculus,  // 微积分 (c▸)
    Matrix,    // 矩阵定界 (m▸)
    Accent,    // 标注向量 (a▸)
    Operator,  // 常用算子 (o▸)
    Greek,     // 希腊字母 (g▸)
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
    ("高斯积分", "▸i-oo;oo;e^-x^2 dx;= ▸r▸gp;;"),
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
    palette_tab: PaletteCategory,
    modals: LibraryModalState,
    devshot: Option<crate::devshot::DevShot>,
    /// `Alt` 轻按后进入的短暂 leader 窗口；窗口内按 `j` 打开导航。
    nav_leader_until: Option<Instant>,
    alt_press_at: Option<Instant>,
    alt_combo_active: bool,
}

impl MathSlotApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        install_fonts(&cc.egui_ctx);
        install_style(&cc.egui_ctx);
        let (library, config_path_hint) = load_library_from_disk();
        let mut modals = LibraryModalState::new(&library, config_path_hint);
        let devshot = crate::devshot::DevShot::from_env();
        let mut editor = StreamEditor::with_library(library);
        if let Some(shot) = &devshot {
            if let Some(src) = &shot.source {
                editor.source = src.clone();
                editor.cursor_char = editor.source.chars().count();
                editor.sync_after_edit(editor.cursor_char);
            }
            match shot.modal.as_deref() {
                Some("help") => modals.show_help = true,
                Some("latex") => modals.open_latex_tab(),
                Some("custom") => modals.open_custom_tab(&editor.library),
                Some("snippets") => modals.open_snippets_tab(&editor.library),
                Some("esc") => {
                    editor.toggle_esc_jump();
                }
                _ => {}
            }
        }

        Self {
            pending_cursor_sync: Some(editor.cursor_char),
            editor,
            preset_index: 0,
            input_id: Id::unique("mathslot-stream-input"),
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
            palette_tab: PaletteCategory::Direct,
            modals,
            devshot,
            nav_leader_until: None,
            alt_press_at: None,
            alt_combo_active: false,
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

    fn nav_leader_active(&self) -> bool {
        self.nav_leader_until
            .is_some_and(|until| Instant::now() <= until)
    }

    /// 把 `Alt` 的“轻按松开”识别成 leader，而不是 `Alt+j` 组合键。
    /// - 按住 Alt 期间按了其他键 → 视为普通组合键，不进入 leader；
    /// - 单独轻按并松开 Alt → 打开 800ms 的 leader 窗口，窗口内按 `j` 进入/退出导航。
    fn update_nav_leader(&mut self, ctx: &egui::Context) {
        let now = Instant::now();
        let (alt_pressed, alt_released, alt_combo) = ctx.input(|input| {
            let mut pressed = false;
            let mut released = false;
            let mut combo = false;
            for event in &input.events {
                if let egui::Event::Key {
                    key,
                    pressed: is_pressed,
                    modifiers,
                    ..
                } = event
                {
                    if *key == Key::AltLeft {
                        if *is_pressed {
                            pressed = true;
                        } else {
                            released = true;
                        }
                    } else if *is_pressed && modifiers.alt {
                        combo = true;
                    }
                }
            }
            (pressed, released, combo)
        });

        if alt_pressed {
            self.alt_press_at = Some(now);
            self.alt_combo_active = false;
        }
        if alt_combo {
            self.alt_combo_active = true;
        }
        if alt_released {
            if let Some(started) = self.alt_press_at.take() {
                if !self.alt_combo_active && started.elapsed() <= Duration::from_millis(500) {
                    self.nav_leader_until = Some(now + Duration::from_millis(800));
                    self.status = "Alt 已就绪：按 j 进入导航。".to_owned();
                }
            }
            self.alt_combo_active = false;
        }

        if let Some(until) = self.nav_leader_until
            && now > until
        {
            self.nav_leader_until = None;
            if self.editor.esc_nav.is_none() {
                self.status = "Alt 导航前缀已超时。".to_owned();
            }
        }
    }

    /// 选区 + 左括号：在 TextEdit 处理前拦截，按选区字面范围包裹。
    fn try_wrap_bracket_selection(&mut self, ctx: &egui::Context) -> bool {
        if self.editor.esc_nav.is_some()
            || !ctx.memory(|m| m.has_focus(self.input_id))
        {
            return false;
        }
        let modifiers = ctx.input(|input| input.modifiers);
        if modifiers.ctrl || modifiers.command || modifiers.alt {
            return false;
        }
        let Some(range) = egui::TextEdit::load_state(ctx, self.input_id)
            .and_then(|state| state.cursor.char_range())
        else {
            return false;
        };
        let start: usize = range.primary.index.into();
        let end: usize = range.secondary.index.into();
        if start == end {
            return false;
        }
        let open = ctx.input(|input| {
            input.events.iter().find_map(|event| {
                let egui::Event::Text(text) = event else {
                    return None;
                };
                if text.chars().count() != 1 {
                    return None;
                }
                let ch = text.chars().next()?;
                matches!(ch, '(' | '[' | '{').then_some(ch)
            })
        });
        let Some(open) = open else {
            return false;
        };
        let close = match open {
            '(' => ')',
            '[' => ']',
            '{' => '}',
            _ => return false,
        };
        self.consume_text_char(ctx, open);
        self.status = self
            .editor
            .wrap_selection_with_bracket(start, end, open, close);
        self.pending_cursor_sync = Some(self.editor.cursor_char);
        self.request_input_focus = true;
        self.mark_dirty();
        true
    }

    /// 移除当帧中指定单字符的 `Event::Text`，避免 TextEdit 重复插入。
    fn consume_text_char(&self, ctx: &egui::Context, ch: char) {
        ctx.input_mut(|input| {
            input.events.retain(|event| {
                !matches!(
                    event,
                    egui::Event::Text(text)
                        if text.chars().count() == 1
                            && text
                                .chars()
                                .next()
                                .is_some_and(|c| c.eq_ignore_ascii_case(&ch))
                )
            });
        });
    }

    fn handle_keys_before_ui(&mut self, ctx: &egui::Context) {
        self.update_nav_leader(ctx);
        if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::F1)) {
            self.modals.show_help = !self.modals.show_help;
            if !self.modals.any_open() {
                self.request_input_focus = true;
            }
            return;
        }

        if self.modals.any_open() {
            self.nav_leader_until = None;
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

        if self.try_wrap_bracket_selection(ctx) {
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

        // Tab j：先按 Tab 形成 `▸` 前缀，再按 j 直接进入导航。
        // 在应用层处理，不依赖 TextEdit 焦点，也不会把 `▸j` 留在公式里。
        if matches!(self.editor.prefix_menu_state(), PrefixMenuState::Root)
            && ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::J))
        {
            self.consume_text_char(ctx, 'j');
            self.editor.handle_tab();
            self.status = self.editor.toggle_esc_jump();
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
            return;
        }

        // Alt 轻按松开后按 j：同样是两个顺序动作，不是 Alt+J 组合键。
        if self.nav_leader_active()
            && ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::J))
        {
            self.nav_leader_until = None;
            self.consume_text_char(ctx, 'j');
            self.status = self.editor.toggle_esc_jump();
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
            return;
        }

        if self.editor.esc_nav.is_some() {
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Escape)) {
                self.editor.esc_nav = None;
                self.status = "已退出导航模式。".to_owned();
                self.pending_cursor_sync = Some(self.editor.cursor_char);
                self.request_input_focus = true;
                self.mark_dirty();
                return;
            }
            if ctx.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Backspace)) {
                self.status = self.editor.esc_backspace();
                self.pending_cursor_sync = Some(self.editor.cursor_char);
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
                self.pending_cursor_sync = Some(self.editor.cursor_char);
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
                self.pending_cursor_sync = Some(self.editor.cursor_char);
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
    // 顶栏 (52px)：品牌标识 · 模式胶囊 · 分组工具按钮
    // -----------------------------------------------------------------------

    /// 当前编辑模式的文字与配色（顶栏胶囊 / 输入框描边共用）
    fn mode_badge(&self) -> (String, Color32) {
        if let Some(esc) = &self.editor.esc_nav {
            if esc.path.is_empty() {
                ("槽位导航".to_owned(), ACCENT)
            } else {
                (format!("子式导航 {}", esc.path.join(" › ")), VIOLET)
            }
        } else {
            match self.editor.prefix_menu_state() {
                PrefixMenuState::Idle => ("流式书写".to_owned(), GREEN),
                PrefixMenuState::Root => ("Tab 就绪 · 按单键插入".to_owned(), AMBER),
                PrefixMenuState::SubMenu(sub) => {
                    (format!("子菜单 {CMD_PREFIX}{} · {}", sub.key(), sub.title()), AMBER)
                }
                PrefixMenuState::Jump(seq) => (format!("内联跳转 {CMD_PREFIX}j{seq}"), CYAN),
                PrefixMenuState::InvalidPrefix(c) => (format!("未知按键 {CMD_PREFIX}{c}"), RED),
            }
        }
    }

    fn top_ui(&mut self, ui: &mut egui::Ui) {
        let mut action_undo = false;
        let mut action_redo = false;
        let mut action_clear = false;
        let mut action_preset = false;
        let mut action_jump_back = false;
        let mut action_quick_save = false;
        let mut action_toggle_nav = false;
        let mut open_latex_tab = false;
        let mut open_custom_mgr = false;
        let mut open_help = false;

        let (mode_text, mode_color) = self.mode_badge();
        let in_nav = self.editor.esc_nav.is_some();

        ui.horizontal_centered(|ui| {
            ui.spacing_mut().item_spacing.x = 8.0;

            brand_mark(ui);
            ui.label(RichText::new("MathSlot").size(16.0).strong().color(TEXT));
            ui.label(
                RichText::new(concat!("v", env!("CARGO_PKG_VERSION")))
                    .size(11.0)
                    .color(MUTED),
            );
            ui.add_space(6.0);
            status_pill(ui, &mode_text, mode_color);

            let (nav_label, nav_color) = if in_nav {
                ("⚡ 退出导航 [Tab / Esc / Alt j]", ACCENT)
            } else {
                ("⚡ 导航 [Tab j / Alt j]", TEXT_DIM)
            };
            if tool_button(ui, RichText::new(nav_label).size(12.5).color(nav_color), true)
                .on_hover_text("开启槽位导航 (Tab j / Alt j 进入；Tab / Esc / Alt j 退出)")
                .clicked()
            {
                action_toggle_nav = true;
            }

            // 右侧应用级按钮（从右往左排列）
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.spacing_mut().item_spacing.x = 2.0;

                if tool_button(ui, RichText::new("帮助").size(13.0).color(TEXT_DIM), true)
                    .on_hover_text("完整快捷键与操作指南 (F1)")
                    .clicked()
                {
                    open_help = true;
                }
                vsep(ui, 22.0);
                if tool_button(ui, RichText::new("清空").size(13.0).color(TEXT_DIM), true)
                    .on_hover_text("清空输入栏内容（可撤销）")
                    .clicked()
                {
                    action_clear = true;
                }
                let next_preset_name = PRESETS[self.preset_index % PRESETS.len()].0;
                if tool_button(ui, RichText::new("↻ 示例").size(13.0).color(TEXT_DIM), true)
                    .on_hover_text(format!("载入数学范例：{next_preset_name}"))
                    .clicked()
                {
                    action_preset = true;
                }
                vsep(ui, 22.0);
                if tool_button(ui, RichText::new("+ 存片段").size(13.0).color(GREEN), true)
                    .on_hover_text("将当前式子或光标处子结构存为片段模版 (Ctrl+Shift+S)")
                    .clicked()
                {
                    action_quick_save = true;
                }
                if tool_button(ui, RichText::new("格式库").size(13.0).color(AMBER), true)
                    .on_hover_text("无需改源码：扩展任意 LaTeX 宏与管理片段模版库")
                    .clicked()
                {
                    open_custom_mgr = true;
                }
                if tool_button(ui, RichText::new("⇄ 导入 LaTeX").size(13.0).color(ACCENT), true)
                    .on_hover_text("从标准 LaTeX 语法一键反编译并导入为简码流")
                    .clicked()
                {
                    open_latex_tab = true;
                }
                vsep(ui, 22.0);
                if tool_button(ui, RichText::new("⇤").size(18.0), self.editor.can_jump_back())
                    .on_hover_text("返回上一个跳转位置 (导航中 - 或 Alt+←)")
                    .clicked()
                {
                    action_jump_back = true;
                }
                if tool_button(ui, RichText::new("↷").size(18.0), self.editor.can_redo())
                    .on_hover_text("重做 (Ctrl+Y / Ctrl+Shift+Z)")
                    .clicked()
                {
                    action_redo = true;
                }
                if tool_button(ui, RichText::new("↶").size(18.0), self.editor.can_undo())
                    .on_hover_text("撤销 (Ctrl+Z)")
                    .clicked()
                {
                    action_undo = true;
                }
            });
        });

        if action_toggle_nav {
            self.status = self.editor.toggle_esc_jump();
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
        }
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

// 新版 UI 核心实现：
// 左栏三框常驻（预览框、导航结构框、输入输出框，无标题、零跳变、固定高度、一键无痛复制）
// 中间全宽主体为结构提示（大卡片、直观数学符号、中文名称、快捷键提示、一键点击即插）

    // -----------------------------------------------------------------------
    // 左栏：三框常驻工作台（无标题、固定高度、零跳动、不突兀多出卡片）
    // -----------------------------------------------------------------------

fn allocate_ui_at_rect<R>(ui: &mut egui::Ui, rect: Rect, add_contents: impl FnOnce(&mut egui::Ui) -> R) -> R {
    let mut child = ui.new_child(egui::UiBuilder::new().max_rect(rect));
    add_contents(&mut child)
}

    fn left_panel_ui(&mut self, ui: &mut egui::Ui, act: &mut UiActions) {
        egui::ScrollArea::vertical()
            .id_salt("mathslot-left-scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.spacing_mut().item_spacing.y = 8.0;

                // 框 1：纯白公式预览框（常驻，固定小尺寸，绝不遮挡公式内容）
                self.preview_box(ui);

                // 框 2：导航结构框（常驻预览正下方，固定高度，无跳动、不突兀多出卡片）
                self.nav_structure_box(ui, act);

                // 框 3：输入与输出框（常驻，极简流输入 + 一键无痛复制）
                self.input_output_box(ui, act);

                ui.add_space(4.0);
            });
    }

    /// 框 1：预览框（独立顶部 Header Toolbar + ScrollArea 双向平移视口 + 真实几何比例缩放）
    /// 无论是否处于导航模式，永远只渲染真实的 formula_tex，大公式放大由视口平滑承载！
    fn preview_box(&mut self, ui: &mut egui::Ui) {
        paper_frame().show(ui, |ui| {
            let avail_w = ui.available_width();
            ui.set_width(avail_w);

            // 1. 顶部独立 Header 栏（物理隔离坐标，杜绝与公式重叠，右侧预留充足宽度 Toolbar）
            ui.horizontal(|ui| {
                ui.label(RichText::new("公式预览").strong().size(12.5).color(PAPER_DARK));

                if let Some(err) = &self.render_error {
                    ui.add_space(4.0);
                    ui.label(
                        RichText::new(format!("⚠ {err}"))
                            .size(10.5)
                            .color(Color32::from_rgb(180, 83, 9)),
                    );
                }

                // 右侧独立排布预留充足宽度（>= 140pt）的缩放 Toolbar
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.spacing_mut().item_spacing.x = 4.0;
                    if paper_button(ui, "+", false).on_hover_text("放大预览").clicked() {
                        self.preview_scale = (self.preview_scale + 0.15).min(2.5);
                    }
                    if paper_button(ui, &format!("{:.0}%", self.preview_scale * 80.0), false)
                        .on_hover_text("恢复标准缩放 (100%)")
                        .clicked()
                    {
                        self.preview_scale = 1.25;
                    }
                    if paper_button(ui, "−", false).on_hover_text("缩小预览").clicked() {
                        self.preview_scale = (self.preview_scale - 0.15).max(0.4);
                    }
                });
            });

            ui.add_space(4.0);

            // 2. 引入 egui::ScrollArea::both() 平滑双向平移视口
            egui::ScrollArea::both()
                .id_salt("mathslot-preview-scroll-viewport")
                .max_height(PREVIEW_BOX_HEIGHT)
                .auto_shrink([false, false])
                .show(ui, |ui| {
                    ui.set_min_width(avail_w - 12.0);
                    ui.set_min_height(PREVIEW_BOX_HEIGHT - 8.0);

                    if self.editor.source.is_empty() {
                        ui.vertical_centered(|ui| {
                            ui.add_space((PREVIEW_BOX_HEIGHT - 32.0) * 0.4);
                            ui.label(
                                RichText::new("键入简码生成公式")
                                    .size(13.5)
                                    .color(PAPER_MUTED),
                            );
                        });
                    } else if let Some(texture) = &self.formula_tex {
                        let original = texture.size_vec2() / PIXELS_PER_POINT;
                        let display_size = original * self.preview_scale;

                        ui.vertical_centered(|ui| {
                            ui.add(egui::Image::new(texture).fit_to_exact_size(display_size));
                        });
                    } else {
                        ui.vertical_centered(|ui| {
                            ui.add_space((PREVIEW_BOX_HEIGHT - 32.0) * 0.4);
                            ui.label(
                                RichText::new("排版引擎加载中…")
                                    .size(12.5)
                                    .color(PAPER_MUTED),
                            );
                        });
                    }
                });
        });
    }

    /// 框 2：导航结构框（常驻预览框正下方，固定高度，无标题）
    /// 无论是否处于导航模式，高度恒定为 NAV_BOX_HEIGHT，绝不突兀弹出新卡片、不发生界面跳动！
    fn nav_structure_box(&self, ui: &mut egui::Ui, act: &mut UiActions) {
        paper_frame().show(ui, |ui| {
            let avail_w = ui.available_width();
            ui.set_width(avail_w);
            ui.set_height(NAV_BOX_HEIGHT);

            let (rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, NAV_BOX_HEIGHT), Sense::hover());
            let in_nav = self.editor.esc_nav.is_some();

            if in_nav {
                // 导航模式中：上方展示带锚点位置的 AST 结构图，下方展示跳转徽章
                if let Some(texture) = &self.nav_tex {
                    let img_h = 52.0;
                    let size = fitted_size(texture, (avail_w - 12.0).max(100.0), img_h, 1.15);
                    let img_center = egui::pos2(rect.center().x, rect.top() + 29.0);
                    egui::Image::new(texture).paint_at(ui, Rect::from_center_size(img_center, size));
                }

                // 下部区域：常驻槽位跳转徽章，按键或点击直接跳改
                let chip_rect = Rect::from_min_max(
                    rect.left_bottom() + Vec2::new(4.0, -34.0),
                    rect.right_bottom() + Vec2::new(-4.0, -3.0),
                );
                let bracket_pair = self.editor.enclosing_bracket_pair();
                Self::allocate_ui_at_rect(ui, chip_rect, |ui| {
                    ui.horizontal(|ui| {
                        let scroll_width = (ui.available_width() - 52.0).max(90.0);
                        egui::ScrollArea::horizontal()
                            .id_salt("mathslot-nav-chip-scroll")
                            .max_width(scroll_width)
                            .auto_shrink([false, true])
                            .show(ui, |ui| {
                                ui.horizontal(|ui| {
                                ui.spacing_mut().item_spacing = Vec2::new(4.0, 2.0);
                                if let Some(pair) = bracket_pair {
                                    for (ch, hint, close) in [
                                        ('(', "括号内", false),
                                        (')', "括号外", true),
                                    ] {
                                        let tag = format!("[{ch}] {hint}");
                                        let color = CYAN;
                                        let btn = egui::Button::new(
                                            RichText::new(tag)
                                                .size(10.5)
                                                .monospace()
                                                .color(color),
                                        )
                                        .fill(FIELD)
                                        .stroke(Stroke::new(1.0, color.gamma_multiply(0.45)))
                                        .corner_radius(CornerRadius::same(5));
                                        if ui
                                            .add(btn)
                                            .on_hover_text(format!(
                                                "跳到 {} 配对括号的{}",
                                                pair.open,
                                                if close { "外侧" } else { "内侧" }
                                            ))
                                            .clicked()
                                        {
                                            act.clicked_jump = Some(ch.to_string());
                                        }
                                    }
                                }
                                if let Some(esc) = &self.editor.esc_nav {
                                    let chain = self.editor.parsed.resolve_scope_chain(&esc.path);
                                    let active_stage = chain.last().expect("root stage exists");
                                    let path_prefix = esc.path.join("");

                                    for entry in &active_stage.scope.entries {
                                        if !esc.partial.is_empty()
                                            && !entry.label.starts_with(&esc.partial)
                                        {
                                            continue;
                                        }
                                        let (glyph, color) = match &entry.kind {
                                            NavEntryKind::ScopeStart => ("⇤首", CYAN),
                                            NavEntryKind::ScopeEnd => ("⇥尾", CYAN),
                                            NavEntryKind::Leaf { is_empty: true, .. } => {
                                                ("∅空", RED)
                                            }
                                            NavEntryKind::Leaf { .. } => ("•槽", TEXT),
                                            NavEntryKind::Composite { .. } => ("+子式", VIOLET),
                                        };
                                        let tag = format!("[{}] {}", entry.label, glyph);
                                        let btn = egui::Button::new(
                                            RichText::new(tag)
                                                .size(10.5)
                                                .monospace()
                                                .color(color),
                                        )
                                        .fill(FIELD)
                                        .stroke(Stroke::new(1.0, color.gamma_multiply(0.45)))
                                        .corner_radius(CornerRadius::same(5));
                                        if ui.add(btn).clicked() {
                                            act.clicked_jump =
                                                Some(format!("{path_prefix}{}", entry.label));
                                        }
                                    }
                                }
                            });
                        });
                        if ghost_button(ui, "退出", MUTED)
                            .on_hover_text("退出导航 (Tab / Esc / Alt j)")
                            .clicked()
                        {
                            act.clicked_jump = Some("Esc".to_owned());
                        }
                    });
                });
            } else {
                // 普通书写模式：完整呈现当前公式的 AST 槽位分层结构图
                if self.editor.source.is_empty() {
                    ui.painter().text(
                        rect.center(),
                        Align2::CENTER_CENTER,
                        "AST 槽位分层结构图",
                        FontId::proportional(13.0),
                        PAPER_MUTED,
                    );
                } else if let Some(texture) = &self.nav_tex {
                    let size = fitted_size(texture, (avail_w - 12.0).max(100.0), NAV_BOX_HEIGHT - 12.0, 1.15);
                    egui::Image::new(texture).paint_at(ui, Rect::from_center_size(rect.center(), size));
                }

                // 右上角提供快捷导航触发
                let trigger_rect = Rect::from_min_size(rect.right_top() + Vec2::new(-86.0, 5.0), Vec2::new(80.0, 22.0));
                Self::allocate_ui_at_rect(ui, trigger_rect, |ui| {
                    if paper_button(ui, "⚡ 导航", false)
                        .on_hover_text("开启槽位导航 (Tab j / Alt j 进入；Tab / Esc / Alt j 退出)")
                        .clicked()
                    {
                        act.toggle_nav = true;
                    }
                });
            }
        });
    }

    /// 框 3：输入与输出框（常驻，流式输入 + 无痛一键复制，无标题）
    fn input_output_box(&mut self, ui: &mut egui::Ui, act: &mut UiActions) {
        let ctx = ui.ctx().clone();
        let breadcrumbs = self.editor.parsed.breadcrumbs_at(self.editor.cursor_char);
        let in_nav = self.editor.esc_nav.is_some();
        let border = if in_nav {
            ACCENT
        } else if matches!(self.editor.prefix_menu_state(), PrefixMenuState::Idle) {
            BORDER
        } else {
            self.mode_badge().1
        };

        let latex_str = self.formatted_latex();
        let copied_recent = self
            .copy_feedback_until
            .is_some_and(|until| Instant::now() < until);
        if copied_recent {
            ctx.request_repaint_after(Duration::from_millis(200));
        }

        card_frame().show(ui, |ui| {
            ui.set_width(ui.available_width());

            // 1. 槽位面包屑行
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing.x = 4.0;
                if in_nav {
                    ui.label(RichText::new("⚡ 导航直达模式 · 按字母跳改（Tab / Esc / Alt j 退出）").size(11.5).strong().color(ACCENT));
                } else if breadcrumbs.is_empty() {
                    ui.label(RichText::new("键入简码，或点击右侧数学结构直接插入…").size(11.0).color(MUTED));
                } else {
                    for (depth, bc) in breadcrumbs.iter().enumerate() {
                        if depth > 0 {
                            ui.label(RichText::new("›").size(11.0).color(MUTED));
                        }
                        kbd_colored(ui, &format!("{CMD_PREFIX}{}", bc.code), AMBER, AMBER_BG);
                        for (s_idx, role) in bc.slot_roles.iter().enumerate() {
                            if s_idx > 0 {
                                ui.label(RichText::new("·").size(10.5).color(MUTED));
                            }
                            if s_idx == bc.slot_index {
                                ui.label(RichText::new(role).size(11.5).strong().color(GREEN));
                            } else {
                                ui.label(RichText::new(role).size(11.0).color(MUTED));
                            }
                        }
                    }
                }
            });

            ui.add_space(4.0);

            // 2. 简码输入框
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
                .font(FontId::monospace(18.0))
                .text_color(TEXT)
                .background_color(FIELD)
                .frame(
                    egui::Frame::NONE
                        .fill(FIELD)
                        .stroke(Stroke::new(1.5, border))
                        .corner_radius(CornerRadius::same(8))
                        .inner_margin(Margin::symmetric(12, 9)),
                )
                .hint_text("直接键入简码，或点击右侧结构插入…")
                .interactive(!in_nav)
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

            ui.add_space(6.0);

            // 3. LaTeX 输出与一键无痛复制行
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 4.0;

                const DELIMS: [(DelimiterStyle, &str, &str); 4] = [
                    (DelimiterStyle::None, "LaTeX", "裸代码（无定界符）"),
                    (DelimiterStyle::Inline, "$…$", "行内公式 $...$"),
                    (DelimiterStyle::Display, "$$…$$", "行间公式 $$...$$"),
                    (DelimiterStyle::MarkdownCode, "```", "Markdown 代码块 ```latex"),
                ];
                let options: Vec<(&str, &str)> = DELIMS.iter().map(|d| (d.1, d.2)).collect();
                let selected = DELIMS
                    .iter()
                    .position(|d| d.0 == self.delimiter_style)
                    .unwrap_or(1);
                if let Some(idx) = segmented(ui, &options, selected) {
                    self.delimiter_style = DELIMS[idx].0;
                    self.request_input_focus = true;
                }

                // 一键复制主按钮（大号醒目，点一次直接完成，绝不啰嗦）
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    let copy_btn = if copied_recent {
                        primary_button(ui, "✓ 已复制", Color32::from_rgb(22, 128, 86))
                    } else {
                        primary_button(ui, "复制 LaTeX", ACCENT_STRONG)
                    };
                    if copy_btn
                        .on_hover_text("一键复制 LaTeX 到系统剪贴板 (Ctrl+Enter / 点击框体)")
                        .clicked()
                    {
                        act.copy_latex = true;
                    }
                });
            });

            ui.add_space(4.0);

            // LaTeX 代码框：点击框体本身也能直接一键复制！
            let is_empty = latex_str.is_empty();
            let display_tex = if is_empty { "（尚无公式输出）" } else { &latex_str };
            let tex_color = if is_empty { MUTED } else { TEXT };

            field_frame().show(ui, |ui| {
                ui.set_width(ui.available_width());
                let resp = ui.add(
                    egui::Label::new(
                        RichText::new(display_tex).monospace().size(12.5).color(tex_color),
                    )
                    .selectable(true)
                    .wrap(),
                );
                if !is_empty && resp.on_hover_text("点击直接复制 LaTeX 代码").clicked() {
                    act.copy_latex = true;
                }
            });
        });
    }

    // -----------------------------------------------------------------------
    // 右侧核心主体：结构提示主面板（The Grand Structure Guidance HERO）
    // 视觉核心：大而精美、直观数学符号、中文名称、快捷键提示、一键点击即插！
    // 专为不熟悉 LaTeX 的用户设计：无需死记语法，点选或看键即用！
    // -----------------------------------------------------------------------

    fn structure_palette_ui(&mut self, ui: &mut egui::Ui, act: &mut UiActions) {
        let prefix_state = self.editor.prefix_menu_state();
        let root_armed = matches!(
            prefix_state,
            PrefixMenuState::Root | PrefixMenuState::InvalidPrefix(_)
        );
        let active_sub = match &prefix_state {
            PrefixMenuState::SubMenu(sub) => Some(*sub),
            _ => None,
        };

        // 敲入子菜单快捷键时智能切到对应分类
        if let Some(sub) = active_sub {
            self.palette_tab = category_of(sub);
        }

        ui.vertical(|ui| {
            // 分类胶囊标签切换栏（无多余标题，直接选分类）
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing = Vec2::new(5.0, 5.0);
                for (cat, keys, title, tip) in PALETTE_TABS {
                    let selected = self.palette_tab == cat;
                    let sub_active = active_sub.is_some_and(|s| category_of(s) == cat);
                    if category_chip(ui, keys, title, selected, sub_active, root_armed)
                        .on_hover_text(tip)
                        .clicked()
                    {
                        self.palette_tab = cat;
                        self.pending_cursor_sync = Some(self.editor.cursor_char);
                        self.request_input_focus = true;
                    }
                }
            });

            ui.add_space(8.0);

            // 结构与符号陈列网格（大卡片、直观数学符号、中文名称、点击直接插入）
            egui::ScrollArea::vertical()
                .id_salt("mathslot-structure-palette-scroll")
                .auto_shrink([false, false])
                .show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    self.render_palette_tiles(ui, root_armed, active_sub, act);
                    ui.add_space(8.0);
                });
        });
    }

    fn render_palette_tiles(
        &self,
        ui: &mut egui::Ui,
        root_armed: bool,
        active_sub: Option<SubCategory>,
        act: &mut UiActions,
    ) {
        let sub_tiles = |sub: SubCategory, filter: &dyn Fn(char) -> bool| -> Vec<Tile> {
            sub.entries()
                .iter()
                .filter(|e| filter(e.item_key))
                .map(|e| Tile {
                    badge: if e.is_default {
                        format!("★{}", e.item_key)
                    } else {
                        format!("{}{}", sub.key(), e.item_key)
                    },
                    glyph: e.glyph_hint.to_owned(),
                    label: e.label.to_owned(),
                    is_default: e.is_default,
                    armed: active_sub == Some(sub),
                    hover: format!("{} · Tab {} {}\n{}", e.label, sub.key(), e.item_key, e.detail),
                    code: e.code.to_owned(),
                })
                .collect()
        };
        let all = |_: char| true;

        match self.palette_tab {
            PaletteCategory::Direct => {
                let direct_tiles: Vec<Tile> = DIRECT_ENTRIES
                    .iter()
                    .map(|entry| Tile {
                        badge: entry.key.to_string(),
                        glyph: entry.glyph_hint.to_owned(),
                        label: entry.label.to_owned(),
                        is_default: false,
                        armed: root_armed,
                        hover: format!("{} · Tab {}\n槽位：{}", entry.label, entry.key, entry.detail),
                        code: entry.key.to_string(),
                    })
                    .collect();
                tile_grid(ui, direct_tiles, &mut act.clicked_code);

                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    ui.label(RichText::new("高频数学符号与关系").size(11.5).strong().color(TEXT_DIM));
                });
                ui.add_space(3.0);

                let common_symbols = [
                    Tile { badge: "gp".into(), glyph: "π".into(), label: "圆周率".into(), is_default: false, armed: false, hover: "圆周率 \\pi (Tab g p)".into(), code: "gp".into() },
                    Tile { badge: "oa".into(), glyph: "∞".into(), label: "无穷".into(), is_default: false, armed: false, hover: "无穷大 \\infty (Tab o a)".into(), code: "oa".into() },
                    Tile { badge: "ob".into(), glyph: "∂".into(), label: "偏导".into(), is_default: false, armed: false, hover: "偏导算子 \\partial (Tab o b)".into(), code: "ob".into() },
                    Tile { badge: "+-".into(), glyph: "±".into(), label: "正负号".into(), is_default: false, armed: false, hover: "正负号 \\pm (直输 +-)".into(), code: "+-".into() },
                    Tile { badge: "<=".into(), glyph: "≤".into(), label: "小于等于".into(), is_default: false, armed: false, hover: "小于等于 \\le (直输 <=)".into(), code: "<=".into() },
                    Tile { badge: ">=".into(), glyph: "≥".into(), label: "大于等于".into(), is_default: false, armed: false, hover: "大于等于 \\ge (直输 >=)".into(), code: ">=".into() },
                    Tile { badge: "!=".into(), glyph: "≠".into(), label: "不等于".into(), is_default: false, armed: false, hover: "不等于 \\neq (直输 !=)".into(), code: "!=".into() },
                    Tile { badge: "xa".into(), glyph: "≈".into(), label: "约等于".into(), is_default: false, armed: false, hover: "约等于 \\approx (Tab x a)".into(), code: "xa".into() },
                    Tile { badge: "->".into(), glyph: "→".into(), label: "趋向箭头".into(), is_default: false, armed: false, hover: "趋向箭头 \\to (直输 ->)".into(), code: "->".into() },
                    Tile { badge: "oe".into(), glyph: "·".into(), label: "点乘".into(), is_default: false, armed: false, hover: "点乘 \\cdot (Tab o e)".into(), code: "oe".into() },
                    Tile { badge: "od".into(), glyph: "×".into(), label: "叉乘".into(), is_default: false, armed: false, hover: "叉乘 \\times (Tab o d)".into(), code: "od".into() },
                    Tile { badge: "xb".into(), glyph: "≡".into(), label: "恒等于".into(), is_default: false, armed: false, hover: "恒等于 \\equiv (Tab x b)".into(), code: "xb".into() },
                ];
                tile_grid(ui, common_symbols.to_vec(), &mut act.clicked_code);
            }
            PaletteCategory::Calculus => {
                tile_grid(ui, sub_tiles(SubCategory::CalculusMore, &all), &mut act.clicked_code);
            }
            PaletteCategory::Matrix => {
                tile_grid(ui, sub_tiles(SubCategory::Matrix, &all), &mut act.clicked_code);
            }
            PaletteCategory::Accent => {
                tile_grid(ui, sub_tiles(SubCategory::Accent, &all), &mut act.clicked_code);
            }
            PaletteCategory::Operator => {
                tile_grid(ui, sub_tiles(SubCategory::Symbol, &all), &mut act.clicked_code);
            }
            PaletteCategory::Greek => {
                ui.horizontal(|ui| {
                    ui.label(RichText::new("小写希腊字母 (24)").size(11.0).color(MUTED));
                });
                ui.add_space(3.0);
                tile_grid(
                    ui,
                    sub_tiles(SubCategory::Greek, &|k| !k.is_ascii_uppercase()),
                    &mut act.clicked_code,
                );
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    ui.label(RichText::new("大写希腊字母 (11)").size(11.0).color(MUTED));
                });
                ui.add_space(3.0);
                tile_grid(
                    ui,
                    sub_tiles(SubCategory::Greek, &|k| k.is_ascii_uppercase()),
                    &mut act.clicked_code,
                );
            }
            PaletteCategory::Relation => {
                ui.horizontal(|ui| {
                    ui.label(RichText::new("关系符 / 箭头 (Tab x)").size(11.0).color(MUTED));
                });
                ui.add_space(3.0);
                tile_grid(ui, sub_tiles(SubCategory::Relations, &all), &mut act.clicked_code);
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    ui.label(RichText::new("集合 / 逻辑 / 数集 (Tab q)").size(11.0).color(MUTED));
                });
                ui.add_space(3.0);
                tile_grid(ui, sub_tiles(SubCategory::SetLogic, &all), &mut act.clicked_code);
            }
            PaletteCategory::Custom => {
                let lib = &self.editor.library;
                ui.horizontal(|ui| {
                    ui.label(RichText::new("自定义数学格式 (Tab k)").size(11.0).color(MUTED));
                });
                ui.add_space(3.0);
                let def_custom_key = lib.default_custom().map(|d| d.item_key);
                let custom_tiles: Vec<Tile> = lib
                    .custom_formats
                    .iter()
                    .map(|fmt| Tile {
                        badge: format!("k{}", fmt.item_key),
                        glyph: if fmt.glyph_hint.is_empty() {
                            fmt.label.clone()
                        } else {
                            fmt.glyph_hint.clone()
                        },
                        label: fmt.label.clone(),
                        is_default: def_custom_key == Some(fmt.item_key),
                        armed: active_sub == Some(SubCategory::Custom),
                        hover: format!(
                            "{} · Tab k {}\n{}",
                            fmt.label, fmt.item_key, fmt.latex_template
                        ),
                        code: fmt.code(),
                    })
                    .collect();
                if custom_tiles.is_empty() {
                    ui.label(RichText::new("尚无自定义格式").size(11.5).color(MUTED));
                } else {
                    tile_grid(ui, custom_tiles, &mut act.clicked_code);
                }

                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    ui.label(RichText::new("复用片段 / 填空模版 (Tab t)").size(11.0).color(MUTED));
                });
                ui.add_space(3.0);
                let def_snip_key = lib.default_snippet().map(|s| s.item_key);
                let snip_tiles: Vec<Tile> = lib
                    .snippets
                    .iter()
                    .map(|snip| Tile {
                        badge: format!("t{}", snip.item_key),
                        glyph: snip.label.clone(),
                        label: "片段".to_owned(),
                        is_default: def_snip_key == Some(snip.item_key),
                        armed: active_sub == Some(SubCategory::Template),
                        hover: format!(
                            "{} · Tab t {}\n{}",
                            snip.label, snip.item_key, snip.stream_source
                        ),
                        code: snip.code(),
                    })
                    .collect();
                if snip_tiles.is_empty() {
                    ui.label(RichText::new("尚无片段模版").size(11.5).color(MUTED));
                } else {
                    tile_grid(ui, snip_tiles, &mut act.clicked_code);
                }

                ui.add_space(10.0);
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = Vec2::new(6.0, 6.0);
                    if ghost_button(ui, "+ 新增自定义格式", GREEN).clicked() {
                        act.open_custom_mgr = true;
                    }
                    if ghost_button(ui, "⚙ 管理模版库", CYAN).clicked() {
                        act.open_snip_mgr = true;
                    }
                    if ghost_button(ui, "+ 存当前为片段", AMBER).clicked() {
                        act.quick_save_snip = true;
                    }
                });
            }
        }
    }

    // -----------------------------------------------------------------------
    // 底部状态栏 (28px)：状态消息 + 核心快捷键提示
    // -----------------------------------------------------------------------

    fn status_bar_ui(&self, ui: &mut egui::Ui) {
        ui.horizontal_centered(|ui| {
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.spacing_mut().item_spacing.x = 4.0;
                for (key, label) in [
                    ("F1", "帮助"),
                    ("Ctrl+Enter", "复制"),
                    ("Tab j / Alt j", "导航"),
                    ("Enter", "推进"),
                    ("Tab", "结构"),
                ] {
                    ui.add_space(8.0);
                    ui.label(RichText::new(label).size(11.0).color(MUTED));
                    kbd(ui, key);
                }

                ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
                    let msg = if self.status.is_empty() {
                        "就绪"
                    } else {
                        self.status.as_str()
                    };
                    let color = if msg.starts_with('✓') { GREEN } else { TEXT_DIM };
                    ui.add(
                        egui::Label::new(RichText::new(msg).size(11.5).color(color)).truncate(),
                    );
                });
            });
        });
    }

    fn apply_ui_actions(&mut self, ctx: &egui::Context, act: UiActions) {
        if act.toggle_nav {
            self.status = self.editor.toggle_esc_jump();
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
        }
        if act.open_custom_mgr {
            self.modals.open_custom_tab(&self.editor.library);
        }
        if act.open_snip_mgr {
            self.modals.open_snippets_tab(&self.editor.library);
        }
        if act.quick_save_snip {
            self.quick_save_snippet(true);
            self.request_input_focus = true;
        }
        if act.copy_latex {
            self.copy_latex(ctx);
            self.request_input_focus = true;
        }
        if act.copy_scheme_a {
            self.copy_scheme_a(ctx);
            self.request_input_focus = true;
        }
        if let Some(code) = act.clicked_code {
            self.status = self.editor.apply_card_click(&code);
            self.pending_cursor_sync = Some(self.editor.cursor_char);
            self.request_input_focus = true;
            self.mark_dirty();
        }
        if let Some(seq_str) = act.clicked_jump {
            if seq_str == "Esc" {
                self.editor.esc_nav = None;
                self.status = "已退出导航模式。".to_owned();
                self.pending_cursor_sync = Some(self.editor.cursor_char);
                self.request_input_focus = true;
                self.mark_dirty();
            } else if seq_str == "Backspace" {
                self.status = self.editor.esc_backspace();
                self.pending_cursor_sync = Some(self.editor.cursor_char);
                self.request_input_focus = true;
                self.mark_dirty();
            } else if seq_str == "(" || seq_str == ")" {
                self.status = self.editor.jump_bracket(seq_str == ")");
                self.pending_cursor_sync = Some(self.editor.cursor_char);
                self.request_input_focus = true;
                self.mark_dirty();
            } else {
                match self.editor.jump_to_sequence(&seq_str) {
                    Ok(msg) => {
                        self.status = msg;
                        self.pending_cursor_sync = Some(self.editor.cursor_char);
                        self.request_input_focus = true;
                        self.mark_dirty();
                    }
                    Err(err) => {
                        self.status = err;
                    }
                }
            }
        }
    }
}

impl eframe::App for MathSlotApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();

        self.handle_keys_before_ui(&ctx);

        egui::Panel::top("mathslot-top-panel")
            .resizable(false)
            .exact_size(TOP_BAR_HEIGHT)
            .frame(
                egui::Frame::NONE
                    .fill(PANEL)
                    .inner_margin(Margin::symmetric(16, 0)),
            )
            .show(ui, |ui| self.top_ui(ui));

        egui::Panel::bottom("mathslot-status-bar")
            .resizable(false)
            .exact_size(STATUS_BAR_HEIGHT)
            .frame(
                egui::Frame::NONE
                    .fill(PANEL)
                    .inner_margin(Margin::symmetric(16, 0)),
            )
            .show(ui, |ui| self.status_bar_ui(ui));

        let mut act = UiActions::default();

        egui::Panel::left("mathslot-left-panel")
            .resizable(true)
            .default_size(LEFT_PANEL_DEFAULT_WIDTH)
            .size_range(380.0..=560.0)
            .frame(
                egui::Frame::NONE
                    .fill(BG)
                    .inner_margin(Margin::symmetric(14, 12)),
            )
            .show(ui, |ui| self.left_panel_ui(ui, &mut act));

        egui::CentralPanel::default()
            .frame(
                egui::Frame::NONE
                    .fill(PANEL)
                    .inner_margin(Margin::symmetric(16, 12)),
            )
            .show(ui, |ui| self.structure_palette_ui(ui, &mut act));

        self.apply_ui_actions(&ctx, act);

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
            if self.editor.esc_nav.is_none() {
                // 当无模态弹出框且非导航模式时，输入框保持永久活跃焦点；点击标签页、卡片或任意功能按钮均不发生失焦
                ctx.memory_mut(|m| m.request_focus(self.input_id));
            } else {
                ctx.memory_mut(|m| m.surrender_focus(self.input_id));
            }
            self.request_input_focus = false;
        }

        self.dispatch_and_poll_render(&ctx);

        if let Some(shot) = &mut self.devshot {
            shot.tick(&ctx);
        }
    }
}

// ---------------------------------------------------------------------------
// 面板交互汇总：各面板只记录点击意图，统一在帧末应用，避免借用冲突
// ---------------------------------------------------------------------------

#[derive(Default)]
struct UiActions {
    clicked_code: Option<String>,
    clicked_jump: Option<String>,
    toggle_nav: bool,
    open_custom_mgr: bool,
    open_snip_mgr: bool,
    quick_save_snip: bool,
    copy_latex: bool,
    copy_scheme_a: bool,
}

/// 分类标签：(分类, 触发键, 标题, 悬停说明)
const PALETTE_TABS: [(PaletteCategory, &str, &str, &str); 8] = [
    (PaletteCategory::Direct, "常用", "常用结构", "12 项核心数学结构（分式、上标、下标、根号、极限、积分等，单键直达）"),
    (PaletteCategory::Greek, "g", "希腊", "希腊字母全集：小写 + 大写 (Tab g)"),
    (PaletteCategory::Calculus, "c", "微积分", "不定积分、连乘、重积分、偏导 (Tab c)"),
    (PaletteCategory::Matrix, "m", "矩阵", "方阵、行列式、分段函数 (Tab m)"),
    (PaletteCategory::Accent, "a", "标注", "帽子、横线、向量、导点、范数 (Tab a)"),
    (PaletteCategory::Operator, "o", "算子", "无穷、偏导、梯度、叉乘、属于 (Tab o)"),
    (PaletteCategory::Relation, "x·q", "关系逻辑", "关系符/箭头 (Tab x) · 集合/逻辑 (Tab q)"),
    (PaletteCategory::Custom, "k·t", "自定义", "自定义 LaTeX 格式 (Tab k) · 片段模版 (Tab t)"),
];

fn category_of(sub: SubCategory) -> PaletteCategory {
    match sub {
        SubCategory::CalculusMore => PaletteCategory::Calculus,
        SubCategory::Matrix => PaletteCategory::Matrix,
        SubCategory::Accent => PaletteCategory::Accent,
        SubCategory::Greek => PaletteCategory::Greek,
        SubCategory::Symbol => PaletteCategory::Operator,
        SubCategory::Relations | SubCategory::SetLogic => PaletteCategory::Relation,
        SubCategory::Custom | SubCategory::Template => PaletteCategory::Custom,
    }
}

/// 格式卡片描述
#[derive(Clone)]
struct Tile {
    badge: String,
    glyph: String,
    label: String,
    is_default: bool,
    /// 当前前缀状态下，再按徽章末位字母即可直接插入
    armed: bool,
    hover: String,
    code: String,
}

/// 等宽自适应网格：根据可用宽度自动计算列数，卡片填满整行
fn tile_grid(ui: &mut egui::Ui, tiles: Vec<Tile>, clicked: &mut Option<String>) {
    const GAP: f32 = 7.0;
    const MIN_W: f32 = 82.0;
    const TILE_H: f32 = 64.0;
    let avail = ui.available_width();
    let cols = ((avail + GAP) / (MIN_W + GAP)).floor().max(1.0);
    let w = ((avail - GAP * (cols - 1.0)) / cols - 0.5).floor().max(40.0);
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing = Vec2::splat(GAP);
        for tile in &tiles {
            if palette_tile(ui, Vec2::new(w, TILE_H), tile) {
                *clicked = Some(tile.code.clone());
            }
        }
    });
}

/// 单张格式卡片：左上键位徽章 · 右上默认项圆点 · 中央符号 · 底部名称
fn palette_tile(ui: &mut egui::Ui, size: Vec2, tile: &Tile) -> bool {
    let (rect, response) = ui.allocate_exact_size(size, Sense::click());
    let hovered = response.hovered();
    let painter = ui.painter();

    let (bg, stroke) = if hovered {
        (CARD_HI, Stroke::new(1.0, ACCENT.gamma_multiply(0.8)))
    } else if tile.armed {
        (Color32::from_rgb(34, 31, 25), Stroke::new(1.0, AMBER.gamma_multiply(0.3)))
    } else {
        (CARD, Stroke::new(1.0, BORDER_SOFT))
    };
    painter.rect(rect, CornerRadius::same(8), bg, stroke, StrokeKind::Inside);

    // 键位徽章
    let badge_color = if tile.armed { AMBER } else { MUTED };
    let badge_galley = painter.layout_no_wrap(tile.badge.clone(), FontId::monospace(10.0), badge_color);
    let badge_pos = rect.left_top() + Vec2::new(7.0, 6.0);
    if tile.armed {
        painter.rect_filled(
            Rect::from_min_size(badge_pos, badge_galley.size()).expand2(Vec2::new(3.0, 1.0)),
            CornerRadius::same(3),
            AMBER_BG,
        );
    }
    painter.galley(badge_pos, badge_galley, badge_color);

    if tile.is_default {
        painter.circle_filled(rect.right_top() + Vec2::new(-9.0, 10.0), 3.0, GREEN);
    }

    paint_fitted_text(
        painter,
        rect.center() + Vec2::new(0.0, -1.0),
        Align2::CENTER_CENTER,
        &tile.glyph,
        size.x - 12.0,
        18.5,
        11.0,
        if hovered { Color32::WHITE } else { TEXT },
        false,
    );
    paint_fitted_text(
        painter,
        rect.center_bottom() - Vec2::new(0.0, 5.0),
        Align2::CENTER_BOTTOM,
        &tile.label,
        size.x - 8.0,
        11.0,
        9.0,
        if hovered { Color32::WHITE } else { TEXT_DIM },
        false,
    );

    let hover = if tile.is_default {
        format!("{}\n★ 子菜单默认项（Enter / Space 直接选用）", tile.hover)
    } else {
        tile.hover.clone()
    };
    response.on_hover_text(hover).clicked()
}

/// 分类标签胶囊：触发键 + 标题
fn category_chip(
    ui: &mut egui::Ui,
    keys: &str,
    title: &str,
    selected: bool,
    sub_active: bool,
    root_armed: bool,
) -> egui::Response {
    let key_color = if sub_active || root_armed { AMBER } else { MUTED };
    let title_color = if sub_active {
        AMBER
    } else if selected {
        Color32::WHITE
    } else {
        TEXT_DIM
    };
    let mut job = LayoutJob::default();
    job.append(
        keys,
        0.0,
        TextFormat {
            font_id: FontId::monospace(11.0),
            color: key_color,
            valign: Align::Center,
            ..Default::default()
        },
    );
    job.append(
        title,
        5.0,
        TextFormat {
            font_id: FontId::proportional(12.5),
            color: title_color,
            valign: Align::Center,
            ..Default::default()
        },
    );
    let (fill, stroke) = if sub_active {
        (AMBER_BG, Stroke::new(1.0, AMBER.gamma_multiply(0.7)))
    } else if selected {
        (ACCENT_BG, Stroke::new(1.0, ACCENT.gamma_multiply(0.6)))
    } else {
        (Color32::TRANSPARENT, Stroke::new(1.0, BORDER_SOFT))
    };
    ui.add(
        egui::Button::new(job)
            .fill(fill)
            .stroke(stroke)
            .min_size(Vec2::new(0.0, 28.0))
            .corner_radius(CornerRadius::same(14)),
    )
}

/// 顶栏品牌标识：圆角方块 + ∑
fn brand_mark(ui: &mut egui::Ui) {
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(26.0), Sense::hover());
    ui.painter()
        .rect_filled(rect, CornerRadius::same(7), ACCENT_STRONG);
    ui.painter().text(
        rect.center() + Vec2::new(0.0, -0.5),
        Align2::CENTER_CENTER,
        "∑",
        FontId::proportional(16.0),
        Color32::WHITE,
    );
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
            if i + 1 < chars.len() && chars[i + 1].1.eq_ignore_ascii_case(&'j') {
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

/// 在导航模式下拦截所有跳转字符（`a..z`、`;`、`.`、`$`、`-`、`` ` ``、`0`、`(`、`)`），并清空当帧 `Event::Text` 防止字符漏进输入框
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
        // 括号专用锚点：Shift+9 / Shift+0（避免和 0 行首别名冲突）
        if input.consume_key(Modifiers::SHIFT, Key::Num9) {
            input.events.retain(|ev| !matches!(ev, egui::Event::Text(_)));
            return Some('(');
        }
        if input.consume_key(Modifiers::SHIFT, Key::Num0) {
            input.events.retain(|ev| !matches!(ev, egui::Event::Text(_)));
            return Some(')');
        }
        for (key, ch) in KEYS {
            if input.consume_key(Modifiers::NONE, key) || input.consume_key(Modifiers::SHIFT, key) {
                input.events.retain(|ev| !matches!(ev, egui::Event::Text(_)));
                return Some(ch);
            }
        }
        let mut consumed: Option<(usize, char)> = None;
        for (i, ev) in input.events.iter().enumerate() {
            if let egui::Event::Text(txt) = ev {
                if let Some(c) = txt.chars().find(|&c| {
                    c.is_ascii_alphabetic()
                        || matches!(c, ';' | '.' | '$' | '-' | '`' | '0' | '(' | ')')
                }) {
                    consumed = Some((i, c));
                    break;
                }
            }
        }
        if let Some((i, c)) = consumed {
            input.events.remove(i);
            input.events.retain(|ev| !matches!(ev, egui::Event::Text(_)));
            return Some(c.to_ascii_lowercase());
        }
        input.events.retain(|ev| !matches!(ev, egui::Event::Text(_)));
        None
    })
}

fn fitted_size(
    texture: &egui::TextureHandle,
    _max_width: f32,
    _max_height: f32,
    scale_factor: f32,
) -> Vec2 {
    let original = texture.size_vec2() / PIXELS_PER_POINT;
    if original.x <= 0.0 || original.y <= 0.0 {
        return Vec2::new(1.0, 1.0);
    }
    // 真实比例几何缩放，废除强制高度截断 clamp，公式尺寸由 ScrollArea 视口平滑承载
    let scale = scale_factor.max(0.05);
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

    let symbol_candidates = [
        "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf",
        "/usr/share/fonts/gdouros-symbola/Symbola.ttf",
        "/usr/share/fonts/google-noto/NotoSansSymbols2-Regular.ttf",
        "/System/Library/Fonts/Apple Color Emoji.ttc",
        "C:\\Windows\\Fonts\\seguisym.ttf",
    ];
    for path in symbol_candidates {
        if Path::new(path).is_file() {
            if let Ok(bytes) = std::fs::read(path) {
                fonts.font_data.insert(
                    "mathslot-symbols".to_owned(),
                    Arc::new(FontData::from_owned(bytes)),
                );
                fonts
                    .families
                    .entry(FontFamily::Proportional)
                    .or_default()
                    .push("mathslot-symbols".to_owned());
                fonts
                    .families
                    .entry(FontFamily::Monospace)
                    .or_default()
                    .push("mathslot-symbols".to_owned());
                break;
            }
        }
    }

    ctx.set_fonts(fonts);
}

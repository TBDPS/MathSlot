use std::path::PathBuf;

use eframe::egui::{self, Align, Color32, CornerRadius, FontId, Layout, Margin, RichText, Stroke};
use mathslot_core::command::CMD_PREFIX;
use mathslot_core::editor::StreamEditor;
use mathslot_core::library::{CustomFormat, FormulaSnippet, UserLibrary};

const BG: Color32 = Color32::from_rgb(11, 15, 23);
const CARD: Color32 = Color32::from_rgb(24, 29, 42);
const CARD_BORDER: Color32 = Color32::from_rgb(38, 45, 61);
const TEXT: Color32 = Color32::from_rgb(243, 244, 246);
const MUTED: Color32 = Color32::from_rgb(148, 163, 184);
const ACCENT: Color32 = Color32::from_rgb(96, 165, 250);
const GREEN: Color32 = Color32::from_rgb(52, 211, 153);
const RED: Color32 = Color32::from_rgb(248, 113, 113);
const AMBER: Color32 = Color32::from_rgb(251, 191, 36);
const CYAN: Color32 = Color32::from_rgb(56, 189, 248);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LibraryTab {
    LatexConverter,
    CustomFormats,
    Snippets,
}

pub enum ModalAction {
    InsertCode(String),
    ReplaceCode(String),
    QuickSaveSnippet { prefer_inner: bool },
    LibraryChanged(String),
}

pub struct LibraryModalState {
    pub show_library: bool,
    pub show_help: bool,
    pub tab: LibraryTab,
    pub config_path_hint: String,
    pub feedback: Option<(String, bool)>,

    // 自定义格式表单
    pub custom_key: String,
    pub custom_label: String,
    pub custom_glyph: String,
    pub custom_roles: String,
    pub custom_latex: String,
    pub custom_scheme_a: String,

    // 复用片段表单
    pub snip_key: String,
    pub snip_label: String,
    pub snip_source: String,

    // LaTeX 逆向反编译器 / 转换器
    pub latex_input: String,
    pub latex_converted_mathslot: String,
}

impl LibraryModalState {
    pub fn new(lib: &UserLibrary, config_path_hint: String) -> Self {
        let next_k = lib.next_free_custom_key().unwrap_or('g');
        let next_t = lib.next_free_snippet_key().unwrap_or('d');
        let mut s = Self {
            show_library: false,
            show_help: false,
            tab: LibraryTab::LatexConverter,
            config_path_hint,
            feedback: None,
            custom_key: next_k.to_string(),
            custom_label: String::new(),
            custom_glyph: String::new(),
            custom_roles: "槽位1;槽位2".to_owned(),
            custom_latex: String::new(),
            custom_scheme_a: String::new(),
            snip_key: next_t.to_string(),
            snip_label: String::new(),
            snip_source: String::new(),
            latex_input: r"\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}".to_owned(),
            latex_converted_mathslot: String::new(),
        };
        s.update_latex_conversion();
        s
    }

    pub fn any_open(&self) -> bool {
        self.show_library || self.show_help
    }

    pub fn open_custom_tab(&mut self, lib: &UserLibrary) {
        self.tab = LibraryTab::CustomFormats;
        if self.custom_label.is_empty()
            && let Some(k) = lib.next_free_custom_key()
        {
            self.custom_key = k.to_string();
        }
        self.show_library = true;
    }

    pub fn open_snippets_tab(&mut self, lib: &UserLibrary) {
        self.tab = LibraryTab::Snippets;
        if self.snip_label.is_empty()
            && let Some(k) = lib.next_free_snippet_key()
        {
            self.snip_key = k.to_string();
        }
        self.show_library = true;
    }

    pub fn open_latex_tab(&mut self) {
        self.tab = LibraryTab::LatexConverter;
        self.update_latex_conversion();
        self.show_library = true;
    }

    pub fn update_latex_conversion(&mut self) {
        self.latex_converted_mathslot =
            mathslot_core::latex::latex_to_mathslot(&self.latex_input);
    }

    pub fn show(&mut self, ctx: &egui::Context, editor: &mut StreamEditor) -> Option<ModalAction> {
        let mut action = None;

        if self.show_library {
            let mut open = self.show_library;
            egui::Window::new("MathSlot 扩展中心 · LaTeX 导入与公式模版库")
                .open(&mut open)
                .collapsible(false)
                .resizable(true)
                .default_width(700.0)
                .min_width(560.0)
                .show(ctx, |ui| {
                    if let Some(act) = self.render_library_body(ui, editor) {
                        action = Some(act);
                    }
                });
            self.show_library = open;
        }

        if self.show_help {
            let mut open = self.show_help;
            egui::Window::new("MathSlot 使用指南与快捷键速查 (F1)")
                .open(&mut open)
                .collapsible(false)
                .resizable(true)
                .default_width(700.0)
                .min_width(540.0)
                .show(ctx, |ui| {
                    render_help_body(ui);
                });
            self.show_help = open;
        }

        action
    }

    fn render_library_body(
        &mut self,
        ui: &mut egui::Ui,
        editor: &mut StreamEditor,
    ) -> Option<ModalAction> {
        let mut action = None;
        let mut reset_defaults = false;

        ui.horizontal(|ui| {
            if ui
                .selectable_label(
                    self.tab == LibraryTab::LatexConverter,
                    RichText::new("⇄ LaTeX 逆向导入").strong().color(ACCENT),
                )
                .clicked()
            {
                self.tab = LibraryTab::LatexConverter;
                self.update_latex_conversion();
            }
            if ui
                .selectable_label(
                    self.tab == LibraryTab::CustomFormats,
                    RichText::new(format!(
                        "[k{CMD_PREFIX}] 自定义数学格式 ({})",
                        editor.library.custom_formats.len()
                    ))
                    .strong(),
                )
                .clicked()
            {
                self.tab = LibraryTab::CustomFormats;
            }
            if ui
                .selectable_label(
                    self.tab == LibraryTab::Snippets,
                    RichText::new(format!(
                        "[t{CMD_PREFIX}] 复用片段/填空模版 ({})",
                        editor.library.snippets.len()
                    ))
                    .strong(),
                )
                .clicked()
            {
                self.tab = LibraryTab::Snippets;
            }

            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if ui
                    .small_button("恢复默认预置")
                    .on_hover_text("保留内置示例格式与模版（覆盖当前列表）")
                    .clicked()
                {
                    reset_defaults = true;
                }
                ui.label(
                    RichText::new(format!("配置文件: {}", self.config_path_hint))
                        .size(11.0)
                        .color(MUTED),
                );
            });
        });

        if reset_defaults {
            editor.set_library(UserLibrary::default_seeded());
            let (msg, is_err) = match save_library_to_disk(&editor.library) {
                Ok(_) => ("已恢复默认自定义格式与片段预置。".to_owned(), false),
                Err(e) => (format!("已恢复默认预置，但写入磁盘失败: {e}"), true),
            };
            self.feedback = Some((msg.clone(), is_err));
            return Some(ModalAction::LibraryChanged(msg));
        }

        if let Some((msg, is_err)) = &self.feedback {
            ui.add_space(3.0);
            ui.label(
                RichText::new(msg)
                    .size(11.5)
                    .color(if *is_err { RED } else { GREEN }),
            );
        }

        ui.separator();

        match self.tab {
            LibraryTab::LatexConverter => {
                if let Some(act) = self.render_latex_tab(ui, editor) {
                    action = Some(act);
                }
            }
            LibraryTab::CustomFormats => {
                if let Some(act) = self.render_custom_tab(ui, editor) {
                    action = Some(act);
                }
            }
            LibraryTab::Snippets => {
                if let Some(act) = self.render_snippets_tab(ui, editor) {
                    action = Some(act);
                }
            }
        }

        action
    }

    fn render_latex_tab(
        &mut self,
        ui: &mut egui::Ui,
        editor: &mut StreamEditor,
    ) -> Option<ModalAction> {
        let mut action = None;

        ui.label(
            RichText::new(
                "粘贴现有 LaTeX 公式（支持 $..$、$$..$$ 或裸代码），自动将其智能反编译为 MathSlot 极速简码流，即刻插入或替换编辑！",
            )
            .size(11.5)
            .color(MUTED),
        );
        ui.add_space(4.0);

        // 快捷预置示例
        ui.horizontal_wrapped(|ui| {
            ui.label(RichText::new("常用示例:").size(11.5).color(MUTED));
            const EXAMPLES: &[(&str, &str)] = &[
                ("求根公式", r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"),
                ("高斯积分", r"\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}"),
                ("重要极限", r"\lim_{x \to 0} \frac{\sin x}{x} = 1"),
                ("贝叶斯定理", r"P(A|B) = \frac{P(B|A) P(A)}{P(B)}"),
                ("薛定谔方程", r"i\hbar \frac{\partial \psi}{\partial t} = \hat{H}\psi"),
                ("二阶矩阵", r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}"),
            ];
            for (title, latex) in EXAMPLES {
                if ui.small_button(*title).clicked() {
                    self.latex_input = (*latex).to_owned();
                    self.update_latex_conversion();
                }
            }
        });

        ui.add_space(6.0);

        // 输入区域
        egui::Frame::NONE
            .fill(CARD)
            .stroke(Stroke::new(1.0, CARD_BORDER))
            .corner_radius(CornerRadius::same(7))
            .inner_margin(Margin::symmetric(10, 8))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(RichText::new("LaTeX 源代码输入:").size(12.5).strong().color(ACCENT));
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.small_button("清空").clicked() {
                            self.latex_input.clear();
                            self.update_latex_conversion();
                        }
                    });
                });
                ui.add_space(3.0);
                let edit_resp = ui.add(
                    egui::TextEdit::multiline(&mut self.latex_input)
                        .font(FontId::monospace(13.5))
                        .desired_rows(3)
                        .desired_width(f32::INFINITY)
                        .hint_text(r"粘贴 LaTeX，如 \frac{a+b}{c} 或 \sum_{k=1}^n k^2"),
                );
                if edit_resp.changed() {
                    self.update_latex_conversion();
                }
            });

        ui.add_space(6.0);

        // 转换结果展示区域
        egui::Frame::NONE
            .fill(CARD)
            .stroke(Stroke::new(1.0, CARD_BORDER))
            .corner_radius(CornerRadius::same(7))
            .inner_margin(Margin::symmetric(10, 8))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(
                        RichText::new("MathSlot 简码流生成结果:")
                            .size(12.5)
                            .strong()
                            .color(AMBER),
                    );
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.small_button("复制简码流").clicked() {
                            ui.ctx().copy_text(self.latex_converted_mathslot.clone());
                            self.feedback = Some(("✓ 简码流已复制到剪贴板！".to_owned(), false));
                        }
                    });
                });
                ui.add_space(4.0);

                // 只读显示结果
                ui.add(
                    egui::TextEdit::singleline(&mut self.latex_converted_mathslot.as_str())
                        .font(FontId::monospace(14.0))
                        .text_color(CYAN)
                        .desired_width(f32::INFINITY),
                );

                ui.add_space(6.0);

                // 反向校验 LaTeX 预览
                let verified_parsed = mathslot_core::parser::parse_with_library(
                    &self.latex_converted_mathslot,
                    &editor.library,
                );
                let verified_latex = mathslot_core::latex::to_latex(&verified_parsed);
                ui.horizontal(|ui| {
                    ui.label(RichText::new("校验反推 LaTeX:").size(11.0).color(MUTED));
                    ui.label(RichText::new(&verified_latex).monospace().size(11.0).color(TEXT));
                });

                ui.add_space(8.0);

                ui.horizontal(|ui| {
                    if ui
                        .button(RichText::new("✓ 替换当前编辑器内容").strong().color(GREEN))
                        .on_hover_text("用转换后的简码流完全覆盖当前编辑器")
                        .clicked()
                    {
                        if !self.latex_converted_mathslot.is_empty() {
                            action = Some(ModalAction::ReplaceCode(
                                self.latex_converted_mathslot.clone(),
                            ));
                            self.show_library = false;
                        }
                    }

                    if ui
                        .button(RichText::new("+ 插入到当前光标处").color(ACCENT))
                        .on_hover_text("将转换后的简码流追加到当前光标位置")
                        .clicked()
                    {
                        if !self.latex_converted_mathslot.is_empty() {
                            action = Some(ModalAction::InsertCode(
                                self.latex_converted_mathslot.clone(),
                            ));
                            self.show_library = false;
                        }
                    }
                });
            });

        action
    }

    fn render_custom_tab(
        &mut self,
        ui: &mut egui::Ui,
        editor: &mut StreamEditor,
    ) -> Option<ModalAction> {
        let mut action = None;
        let mut edit_item: Option<CustomFormat> = None;
        let mut delete_key: Option<char> = None;
        let mut insert_code: Option<String> = None;

        ui.label(
            RichText::new(
                "无需修改源码：用 $1, $2… 表示第 1、2 个槽位，保存后即可在编辑器中按 Tab + k + 字母 流式输入并自动参与 Enter 推进与 Esc 导航！",
            )
            .size(11.5)
            .color(MUTED),
        );
        ui.add_space(4.0);

        egui::Frame::NONE
            .fill(CARD)
            .stroke(Stroke::new(1.0, CARD_BORDER))
            .corner_radius(CornerRadius::same(7))
            .inner_margin(Margin::symmetric(10, 8))
            .show(ui, |ui| {
                ui.label(
                    RichText::new("新增 / 更新自定义格式")
                        .size(12.5)
                        .strong()
                        .color(AMBER),
                );
                ui.add_space(4.0);
                egui::Grid::new("mathslot-custom-fmt-grid")
                    .num_columns(4)
                    .spacing([8.0, 6.0])
                    .show(ui, |ui| {
                        ui.label("触发字母 (a-z):");
                        ui.add(
                            egui::TextEdit::singleline(&mut self.custom_key)
                                .desired_width(48.0)
                                .hint_text("g"),
                        );
                        ui.label("格式名称:");
                        ui.add(
                            egui::TextEdit::singleline(&mut self.custom_label)
                                .desired_width(180.0)
                                .hint_text("如：同余式 / 期望"),
                        );
                        ui.end_row();

                        ui.label("缩略提示:");
                        ui.add(
                            egui::TextEdit::singleline(&mut self.custom_glyph)
                                .desired_width(90.0)
                                .hint_text("如 a≡b(m)"),
                        );
                        ui.label("方案A函数名:");
                        ui.add(
                            egui::TextEdit::singleline(&mut self.custom_scheme_a)
                                .desired_width(180.0)
                                .hint_text("如 cong"),
                        );
                        ui.end_row();

                        ui.label("槽位角色 (;分隔):");
                        ui.add(
                            egui::TextEdit::singleline(&mut self.custom_roles)
                                .desired_width(220.0)
                                .hint_text("左项;右项;模数（无槽位符号请留空）"),
                        );
                        ui.label("LaTeX 模板:");
                        ui.add(
                            egui::TextEdit::singleline(&mut self.custom_latex)
                                .font(FontId::monospace(13.0))
                                .desired_width(240.0)
                                .hint_text("$1 \\equiv $2 \\pmod{$3}"),
                        );
                        ui.end_row();
                    });

                ui.add_space(5.0);
                ui.horizontal(|ui| {
                    if ui
                        .button(RichText::new("保存自定义格式").strong().color(GREEN))
                        .clicked()
                    {
                        let key_ch = self
                            .custom_key
                            .trim()
                            .chars()
                            .next()
                            .unwrap_or(' ')
                            .to_ascii_lowercase();
                        let roles: Vec<String> = self
                            .custom_roles
                            .split([';', '；', ','])
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(str::to_owned)
                            .collect();
                        let (layout, auto_join) = if let Some(old) = editor.library.lookup_custom(key_ch) {
                            (old.layout.clone(), old.auto_join.clone())
                        } else {
                            (mathslot_core::library::LayoutKind::Linear, None)
                        };
                        let fmt = CustomFormat {
                            item_key: key_ch,
                            label: self.custom_label.clone(),
                            glyph_hint: self.custom_glyph.clone(),
                            slot_roles: roles,
                            latex_template: self.custom_latex.clone(),
                            scheme_a_name: self.custom_scheme_a.clone(),
                            layout,
                            auto_join,
                        };
                        match editor.library.upsert_custom(fmt) {
                            Ok(saved_k) => {
                                editor.set_library(editor.library.clone());
                                let (msg, is_err) = match save_library_to_disk(&editor.library) {
                                    Ok(_) => (
                                        format!(
                                            "✓ 已保存自定义格式 [{CMD_PREFIX}k{saved_k}]：按 Tab k {saved_k} 即可调用！"
                                        ),
                                        false,
                                    ),
                                    Err(e) => (format!("✓ 已保存（本次会话生效），但写入磁盘失败: {e}"), true),
                                };
                                self.feedback = Some((msg.clone(), is_err));
                                if let Some(nk) = editor.library.next_free_custom_key() {
                                    self.custom_key = nk.to_string();
                                }
                                self.custom_label.clear();
                                self.custom_glyph.clear();
                                self.custom_latex.clear();
                                self.custom_scheme_a.clear();
                                action = Some(ModalAction::LibraryChanged(msg));
                            }
                            Err(err) => {
                                self.feedback = Some((err, true));
                            }
                        }
                    }
                    ui.label(
                        RichText::new("示例：组合数 `\\binom{$1}{$2}` · 期望 `\\mathbb{E}\\left[$1\\right]` · 条件概率 `P($1 \\mid $2)`")
                            .size(11.0)
                            .color(CYAN),
                    );
                });
            });

        ui.add_space(6.0);
        ui.label(
            RichText::new("已注册自定义格式列表")
                .size(12.0)
                .strong()
                .color(TEXT),
        );

        egui::ScrollArea::vertical()
            .id_salt("mathslot-custom-list-scroll")
            .max_height(210.0)
            .show(ui, |ui| {
                for fmt in &editor.library.custom_formats {
                    egui::Frame::NONE
                        .fill(BG)
                        .stroke(Stroke::new(1.0, CARD_BORDER))
                        .corner_radius(CornerRadius::same(6))
                        .inner_margin(Margin::symmetric(8, 5))
                        .show(ui, |ui| {
                            ui.horizontal(|ui| {
                                ui.label(
                                    RichText::new(format!("[{CMD_PREFIX}k{}]", fmt.item_key))
                                        .monospace()
                                        .strong()
                                        .color(AMBER),
                                );
                                ui.label(RichText::new(&fmt.label).strong().color(TEXT));
                                ui.label(
                                    RichText::new(&fmt.glyph_hint)
                                        .monospace()
                                        .size(11.5)
                                        .color(CYAN),
                                );
                                ui.label(
                                    RichText::new(format!("→ {}", fmt.latex_template))
                                        .monospace()
                                        .size(11.5)
                                        .color(MUTED),
                                );
                                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                    if ui.small_button("删除").clicked() {
                                        delete_key = Some(fmt.item_key);
                                    }
                                    if ui.small_button("编辑").clicked() {
                                        edit_item = Some(fmt.clone());
                                    }
                                    if ui
                                        .small_button(RichText::new("插入").color(GREEN))
                                        .clicked()
                                    {
                                        insert_code = Some(fmt.code());
                                    }
                                });
                            });
                        });
                    ui.add_space(3.0);
                }
            });

        if let Some(fmt) = edit_item {
            self.custom_key = fmt.item_key.to_string();
            self.custom_label = fmt.label;
            self.custom_glyph = fmt.glyph_hint;
            self.custom_roles = fmt.slot_roles.join(";");
            self.custom_latex = fmt.latex_template;
            self.custom_scheme_a = fmt.scheme_a_name;
            self.feedback = Some(("已载入表单，修改后点「保存自定义格式」即可覆盖。".to_owned(), false));
        }

        if let Some(k) = delete_key
            && editor.library.remove_custom(k)
        {
            editor.set_library(editor.library.clone());
            let (msg, is_err) = match save_library_to_disk(&editor.library) {
                Ok(_) => (format!("已删除自定义格式 `k{k}`。"), false),
                Err(e) => (format!("已删除（本次会话生效），但写入磁盘失败: {e}"), true),
            };
            self.feedback = Some((msg.clone(), is_err));
            action = Some(ModalAction::LibraryChanged(msg));
        }

        if let Some(code) = insert_code {
            self.show_library = false;
            action = Some(ModalAction::InsertCode(code));
        }

        action
    }

    fn render_snippets_tab(
        &mut self,
        ui: &mut egui::Ui,
        editor: &mut StreamEditor,
    ) -> Option<ModalAction> {
        let mut action = None;
        let mut edit_snip: Option<FormulaSnippet> = None;
        let mut delete_key: Option<char> = None;
        let mut insert_code: Option<String> = None;

        ui.horizontal_wrapped(|ui| {
            if ui
                .button(RichText::new("+ 保存光标所在子结构").strong().color(GREEN))
                .on_hover_text("若光标位于某个根式/分式/积分内，仅提取该子式保存为复用模版")
                .clicked()
            {
                action = Some(ModalAction::QuickSaveSnippet { prefer_inner: true });
            }
            if ui
                .button(RichText::new("+ 保存整行公式").color(ACCENT))
                .on_hover_text("将当前输入栏整条公式保存为复用模版")
                .clicked()
            {
                action = Some(ModalAction::QuickSaveSnippet {
                    prefer_inner: false,
                });
            }
            ui.label(
                RichText::new("提示：留空的槽位（如 `▸i-oo;oo;;dx`）在按 Tab t <键> 插入后会自动把光标停在空槽内！")
                    .size(11.0)
                    .color(CYAN),
            );
        });

        ui.add_space(5.0);

        egui::Frame::NONE
            .fill(CARD)
            .stroke(Stroke::new(1.0, CARD_BORDER))
            .corner_radius(CornerRadius::same(7))
            .inner_margin(Margin::symmetric(10, 8))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(
                        RichText::new("手动新建 / 编辑片段模版")
                            .size(12.5)
                            .strong()
                            .color(AMBER),
                    );
                    if ui.small_button("填入当前编辑器内容").clicked() {
                        self.snip_source = editor.source.clone();
                    }
                });
                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    ui.label("字母(a-z):");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.snip_key)
                            .desired_width(42.0)
                            .hint_text("d"),
                    );
                    ui.label("名称:");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.snip_label)
                            .desired_width(160.0)
                            .hint_text("如：高斯核 / 泰勒余项"),
                    );
                    ui.label("简码流:");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.snip_source)
                            .font(FontId::monospace(13.0))
                            .desired_width(230.0)
                            .hint_text("如 ▸rb^2 - 4ac;"),
                    );
                    if ui
                        .button(RichText::new("保存片段").strong().color(GREEN))
                        .clicked()
                    {
                        let key_ch = self
                            .snip_key
                            .trim()
                            .chars()
                            .next()
                            .unwrap_or(' ')
                            .to_ascii_lowercase();
                        let snip = FormulaSnippet {
                            item_key: key_ch,
                            label: self.snip_label.clone(),
                            stream_source: self.snip_source.clone(),
                        };
                        match editor.library.upsert_snippet(snip) {
                            Ok(saved_k) => {
                                let (msg, is_err) = match save_library_to_disk(&editor.library) {
                                    Ok(_) => (
                                        format!(
                                            "✓ 已保存复用片段 [{CMD_PREFIX}t{saved_k}]：按 Tab t {saved_k} 即可内联展开！"
                                        ),
                                        false,
                                    ),
                                    Err(e) => (format!("✓ 已保存（本次会话生效），但写入磁盘失败: {e}"), true),
                                };
                                self.feedback = Some((msg.clone(), is_err));
                                if let Some(nk) = editor.library.next_free_snippet_key() {
                                    self.snip_key = nk.to_string();
                                }
                                self.snip_label.clear();
                                self.snip_source.clear();
                                action = Some(ModalAction::LibraryChanged(msg));
                            }
                            Err(err) => {
                                self.feedback = Some((err, true));
                            }
                        }
                    }
                });
            });

        ui.add_space(6.0);
        ui.label(
            RichText::new("已保存片段与填空模版")
                .size(12.0)
                .strong()
                .color(TEXT),
        );

        egui::ScrollArea::vertical()
            .id_salt("mathslot-snippet-list-scroll")
            .max_height(210.0)
            .show(ui, |ui| {
                for snip in &editor.library.snippets {
                    egui::Frame::NONE
                        .fill(BG)
                        .stroke(Stroke::new(1.0, CARD_BORDER))
                        .corner_radius(CornerRadius::same(6))
                        .inner_margin(Margin::symmetric(8, 5))
                        .show(ui, |ui| {
                            ui.horizontal(|ui| {
                                ui.label(
                                    RichText::new(format!("[{CMD_PREFIX}t{}]", snip.item_key))
                                        .monospace()
                                        .strong()
                                        .color(AMBER),
                                );
                                ui.label(RichText::new(&snip.label).strong().color(TEXT));
                                ui.label(
                                    RichText::new(&snip.stream_source)
                                        .monospace()
                                        .size(11.5)
                                        .color(CYAN),
                                );
                                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                    if ui.small_button("删除").clicked() {
                                        delete_key = Some(snip.item_key);
                                    }
                                    if ui.small_button("编辑").clicked() {
                                        edit_snip = Some(snip.clone());
                                    }
                                    if ui
                                        .small_button(RichText::new("插入复用").color(GREEN))
                                        .clicked()
                                    {
                                        insert_code = Some(snip.code());
                                    }
                                });
                            });
                        });
                    ui.add_space(3.0);
                }
            });

        if let Some(snip) = edit_snip {
            self.snip_key = snip.item_key.to_string();
            self.snip_label = snip.label;
            self.snip_source = snip.stream_source;
            self.feedback = Some(("已载入片段表单，修改后点「保存片段」即可更新。".to_owned(), false));
        }

        if let Some(k) = delete_key
            && editor.library.remove_snippet(k)
        {
            let (msg, is_err) = match save_library_to_disk(&editor.library) {
                Ok(_) => (format!("已删除片段 `t{k}`。"), false),
                Err(e) => (format!("已删除（本次会话生效），但写入磁盘失败: {e}"), true),
            };
            self.feedback = Some((msg.clone(), is_err));
            action = Some(ModalAction::LibraryChanged(msg));
        }

        if let Some(code) = insert_code {
            self.show_library = false;
            action = Some(ModalAction::InsertCode(code));
        }

        action
    }
}

fn render_help_body(ui: &mut egui::Ui) {
    egui::ScrollArea::vertical()
        .id_salt("mathslot-help-scroll")
        .max_height(460.0)
        .show(ui, |ui| {
            help_section(
                ui,
                "1. 线性流核心操作（全程零鼠标、无需同时按组合键）",
                &[
                    (
                        "Tab + 单字母",
                        "高频结构一键输入：f 分数 · r 根号 · n N次根 · u 上标 · d 下标 · b 上下标 · p 括号 · v 绝对值 · i 定积分 · s 求和 · l 极限",
                    ),
                    (
                        "Tab + 分类键",
                        "c 扩展积分/连乘 · m 矩阵/分段 · a 顶部标注 · g 希腊字母 · o 常用符号 · k 自定义格式 · t 复用片段（按 Enter/空格 直接选 ★默认项）",
                    ),
                    (
                        "Enter (或 `;`)",
                        "智能推进下一槽位 / 闭合当前结构；若在已闭合槽内则自动跨过 `;` 绝不重复插入",
                    ),
                    (
                        "自然简写直输",
                        "`->` 自动转 \\to (→) · `oo` 转 \\infty (∞) · `+-` 转 \\pm (±) · `<=` `>=` `!=` 自动转关系符",
                    ),
                    ("Ctrl+Enter", "一键将最终 LaTeX 复制到剪贴板（插件内为直接插入笔记）"),
                ],
            );

            help_section(
                ui,
                "2. 跳回行首补加极限 / 积分 / 分数（智能主体包裹）",
                &[
                    (
                        "痛点场景",
                        "先写了复杂式子 `▸fsin x;x; = 1`，之后才想在最前面加上极限 `\\lim`",
                    ),
                    (
                        "自然操作",
                        "按 `Esc a` 跳到最前面 → 按 `Tab l` 插入极限：编辑器会自动把等号前的 `\\frac{\\sin x}{x}` 放进极限「主体」槽，光标留在第1槽填 `x` → Enter → `0`！",
                    ),
                    (
                        "同样适用",
                        "前置插入 `Tab i` (积分) / `Tab s` (求和) 自动包裹至第3槽主体；前置插入 `Tab f` (分数) 自动作分子并跳入分母；若不想包裹，按 `Ctrl+Z` 一步退回普通空槽！",
                    ),
                ],
            );

            help_section(
                ui,
                "3. 增强导航跳转（行首 · 行尾 · 回上一跳转位置 · 嵌套展开）",
                &[
                    ("Esc + a (或 0)", "一步跳至当前层级最前端 `[a]`（根级即整行行首）"),
                    ("Esc + ; (或 . / $)", "一步跳至当前层级最末端 `[;]`（跨出所有闭合分号直达行尾）"),
                    (
                        "Esc + - (或 Alt+←)",
                        "跳回「上一个跳转位置」，再按一次乒乓切回刚才位置（即使中间插入了字符也会自动跟踪偏移！）",
                    ),
                    (
                        "Esc + 复合槽字母",
                        "带 `[x+]` 的嵌套槽会逐级展开为独立子式（如 `Esc c b`），按 Backspace 返回上一层",
                    ),
                    (
                        "Tab + j + 字母",
                        "内联流式跳转（如输入 `▸ja`、`▸j.`、`▸j-` 立即跳转并自动擦除跳转码）",
                    ),
                ],
            );

            help_section(
                ui,
                "4. 上下左右方向键直觉穿梭",
                &[
                    (
                        "↑ / ↓ 方向键",
                        "流式输入时自动按 2D 数学结构跳转：分子 ↔ 分母、上限 ↔ 下限、上标 ↔ 下标、极限主体 ↔ 极限条件、矩阵上下行、嵌套根号向内/向外翻层！",
                    ),
                    (
                        "← / → 方向键",
                        "遇到 `▸f`、`▸ma`、`▸ka` 等结构指令时一次性原子跨过，不卡半截前缀；在 Esc 模式下则沿徽章逐个漫游",
                    ),
                ],
            );

            help_section(
                ui,
                "5. 不改源码扩展新格式 & 复杂公式复用",
                &[
                    (
                        "[k▸] 自定义格式",
                        "点击右上角「扩展/模版」，用 `$1`, `$2` 定义任意 LaTeX 宏（如 `\\binom{$1}{$2}`），自动持久化到 `~/.config/mathslot/library.json`",
                    ),
                    (
                        "+存片段 / [t▸]",
                        "点击「+存片段」(或 Ctrl+Shift+S) 一键把光标处的复杂子式存为模版；留空槽即为填空模版，按 `Tab t 字母` 随时复用！",
                    ),
                ],
            );

            help_section(
                ui,
                "6. 标准 LaTeX 语法对齐与逆向导入转换",
                &[
                    (
                        "标准大括号分组",
                        "文本中直接输入 `{...}` 作为标准 LaTeX 分组原生保留，不再强转 `\\{...\\}`；标准函数如 `\\sin`, `\\cos`, `\\mathbf` 原生支持！",
                    ),
                    (
                        "常用高阶数学结构",
                        "偏导分式 `Tab c g` (`\\frac{\\partial}{\\partial}`) · 全导分式 `Tab c h` · 三重积分 `Tab c a` · 3×3方阵 `Tab m g` · 3×3行列式 `Tab m h` · 上下大括号 `Tab c b/c`",
                    ),
                    (
                        "丰富特殊符号与简记",
                        "`\\hbar` (`▸ol`) · `\\perp` (`▸ot`) · `\\parallel` (`▸op` 或 `||`) · `\\cong` (`~=`) · `\\ll` (`<<`) · `\\gg` (`>>`) · `\\mathbb{C}` (`▸sc`)",
                    ),
                    (
                        "⇄ LaTeX 逆向导入",
                        "点击顶部「⇄ LaTeX 导入」，粘贴任意标准 LaTeX 公式，即可自动反编译为 MathSlot 极速简码流，一键替换或插入！",
                    ),
                ],
            );
            ui.add_space(4.0);
            ui.label(
                RichText::new("完整图文说明与配置格式详见项目根目录 `HELP.md`。")
                    .size(11.5)
                    .color(MUTED),
            );
        });
}

fn help_section(ui: &mut egui::Ui, title: &str, rows: &[(&str, &str)]) {
    egui::Frame::NONE
        .fill(CARD)
        .stroke(Stroke::new(1.0, CARD_BORDER))
        .corner_radius(CornerRadius::same(7))
        .inner_margin(Margin::symmetric(10, 7))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(RichText::new(title).size(12.5).strong().color(ACCENT));
            ui.add_space(3.0);
            for (k, desc) in rows {
                ui.horizontal_wrapped(|ui| {
                    ui.label(
                        RichText::new(format!("{k}:"))
                            .monospace()
                            .size(11.5)
                            .strong()
                            .color(AMBER),
                    );
                    ui.label(RichText::new(*desc).size(11.5).color(TEXT));
                });
            }
        });
    ui.add_space(6.0);
}

pub fn library_config_path() -> Option<PathBuf> {
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME")
        && !xdg.is_empty()
    {
        return Some(PathBuf::from(xdg).join("mathslot").join("library.json"));
    }
    #[cfg(target_os = "windows")]
    if let Some(appdata) = std::env::var_os("APPDATA")
        && !appdata.is_empty()
    {
        return Some(PathBuf::from(appdata).join("mathslot").join("library.json"));
    }
    if let Some(home) = std::env::var_os("HOME")
        && !home.is_empty()
    {
        return Some(
            PathBuf::from(home)
                .join(".config")
                .join("mathslot")
                .join("library.json"),
        );
    }
    None
}

pub fn load_library_from_disk() -> (UserLibrary, String) {
    let Some(path) = library_config_path() else {
        return (UserLibrary::default_seeded(), "内存模式".to_owned());
    };
    let display = path.display().to_string();
    match std::fs::read_to_string(&path) {
        Ok(raw) => match UserLibrary::from_json(&raw) {
            Ok(lib) => (lib, display),
            Err(e) => (
                UserLibrary::default_seeded(),
                format!("配置文件损坏，已回退默认库（{display}）: {e}"),
            ),
        },
        Err(_) => (UserLibrary::default_seeded(), display),
    }
}

pub fn save_library_to_disk(lib: &UserLibrary) -> Result<String, String> {
    let Some(path) = library_config_path() else {
        return Err("未找到用户配置目录。".to_owned());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    // 先写临时文件再原子替换，避免写入中途崩溃产生截断的 library.json
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, lib.to_json_pretty()).map_err(|e| format!("写入配置文件失败: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("替换配置文件失败: {e}")
    })?;
    Ok(path.display().to_string())
}

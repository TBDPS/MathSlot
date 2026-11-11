use std::path::PathBuf;

use eframe::egui::{self, Align, Align2, CornerRadius, FontId, Layout, Margin, RichText, Stroke, Vec2};
use mathslot_core::command::CMD_PREFIX;
use mathslot_core::editor::StreamEditor;
use mathslot_core::library::{CustomFormat, FormulaSnippet, UserLibrary};

use crate::theme::{
    ACCENT, AMBER, BORDER_SOFT, CARD, CYAN, FIELD, GREEN, GREEN_BG, MUTED, RED, TEXT, TEXT_DIM,
    segmented,
};

/// 列表行背景（凹陷）
const BG: egui::Color32 = FIELD;
/// 卡片描边
const CARD_BORDER: egui::Color32 = BORDER_SOFT;

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
    pub show_custom_form: bool,

    // 复用片段表单
    pub snip_key: String,
    pub snip_label: String,
    pub snip_source: String,
    pub show_snippet_form: bool,

    // LaTeX 逆向反编译器 / 转换器
    pub latex_input: String,
    pub latex_converted_mathslot: String,

    // 权威公式库 (Formula Corpus)
    pub show_presets: bool,
    pub preset_search: String,
    pub preset_category: String,
    pub formula_editing_id: Option<String>,
    pub formula_edit_name: String,
    pub formula_edit_category: String,
    pub formula_edit_source: String,
    pub formula_edit_desc: String,
    pub formula_edit_tags: String,
    pub show_formula_form: bool,
    pub show_formula_importer: bool,
    pub formula_import_text: String,
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
            show_custom_form: false,
            snip_key: next_t.to_string(),
            snip_label: String::new(),
            snip_source: String::new(),
            show_snippet_form: false,
            latex_input: r"\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}".to_owned(),
            latex_converted_mathslot: String::new(),
            show_presets: false,
            preset_search: String::new(),
            preset_category: "全部".to_owned(),
            formula_editing_id: None,
            formula_edit_name: String::new(),
            formula_edit_category: "微积分/高等数学".to_owned(),
            formula_edit_source: String::new(),
            formula_edit_desc: String::new(),
            formula_edit_tags: String::new(),
            show_formula_form: false,
            show_formula_importer: false,
            formula_import_text: String::new(),
        };
        s.update_latex_conversion();
        s
    }

    pub fn any_open(&self) -> bool {
        self.show_library || self.show_help || self.show_presets
    }

    pub fn open_presets(&mut self) {
        self.show_presets = true;
    }

    pub fn open_custom_tab(&mut self, lib: &UserLibrary) {
        self.tab = LibraryTab::CustomFormats;
        if self.custom_label.is_empty()
            && let Some(k) = lib.next_free_custom_key()
        {
            self.custom_key = k.to_string();
        }
        self.show_custom_form = false;
        self.show_library = true;
    }

    pub fn open_snippets_tab(&mut self, lib: &UserLibrary) {
        self.tab = LibraryTab::Snippets;
        if self.snip_label.is_empty()
            && let Some(k) = lib.next_free_snippet_key()
        {
            self.snip_key = k.to_string();
        }
        self.show_snippet_form = false;
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

        let screen = ctx.content_rect();
        let anchor_pos = screen.center_top() + Vec2::new(0.0, 72.0);

        if self.show_library {
            let mut open = self.show_library;
            egui::Window::new(RichText::new("扩展中心 · 格式库与模版").size(14.0).strong())
                .open(&mut open)
                .collapsible(false)
                .resizable(true)
                .pivot(Align2::CENTER_TOP)
                .default_pos(anchor_pos)
                .default_size([780.0, 580.0])
                .min_size([680.0, 460.0])
                .max_size([880.0, 680.0])
                .show(ctx, |ui| {
                    ui.set_width(ui.available_width());
                    if let Some(act) = self.render_library_body(ui, editor) {
                        action = Some(act);
                    }
                });
            self.show_library = open;
        }

        if self.show_help {
            let mut open = self.show_help;
            egui::Window::new(RichText::new("使用指南与快捷键速查 · F1").size(14.0).strong())
                .open(&mut open)
                .collapsible(false)
                .resizable(true)
                .pivot(Align2::CENTER_TOP)
                .default_pos(anchor_pos)
                .default_size([740.0, 560.0])
                .min_size([560.0, 420.0])
                .show(ctx, |ui| {
                    render_help_body(ui);
                });
            self.show_help = open;
        }

        if self.show_presets {
            let mut open = self.show_presets;
            egui::Window::new(RichText::new("公式库 · Formula Corpus").size(14.0).strong())
                .open(&mut open)
                .collapsible(false)
                .resizable(true)
                .pivot(Align2::CENTER_TOP)
                .default_pos(anchor_pos)
                .default_size([880.0, 640.0])
                .min_size([680.0, 500.0])
                .show(ctx, |ui| {
                    if let Some(act) = self.render_presets_body(ui, editor) {
                        action = Some(act);
                    }
                });
            self.show_presets = open;
        }

        action
    }

    fn render_presets_body(
        &mut self,
        ui: &mut egui::Ui,
        editor: &mut StreamEditor,
    ) -> Option<ModalAction> {
        let mut action = None;

        // 1. 顶部工具栏：检索与快捷操作
        ui.horizontal(|ui| {
            ui.label(RichText::new("检索:").size(12.5).color(TEXT_DIM));
            ui.add(
                egui::TextEdit::singleline(&mut self.preset_search)
                    .hint_text("搜索公式名称、学科分类、符号简码或说明关键词...")
                    .desired_width(260.0),
            );
            if !self.preset_search.is_empty() && ui.small_button("✕ 清空").clicked() {
                self.preset_search.clear();
            }

            ui.add_space(8.0);
            let btn_txt = if self.show_formula_form { "收起表单" } else { "+ 新建公式" };
            if ui.button(RichText::new(btn_txt).strong().color(GREEN)).clicked() {
                self.show_formula_form = !self.show_formula_form;
                if self.show_formula_form {
                    self.formula_editing_id = None;
                    self.formula_edit_name.clear();
                    self.formula_edit_category = if self.preset_category != "全部" {
                        self.preset_category.clone()
                    } else {
                        "微积分/高等数学".to_owned()
                    };
                    self.formula_edit_source.clear();
                    self.formula_edit_desc.clear();
                    self.formula_edit_tags.clear();
                }
            }

            if ui.button(RichText::new("恢复默认预置").color(TEXT_DIM))
                .on_hover_text("恢复出厂预置公式（保留用户自建公式）")
                .clicked()
            {
                editor.library.formulas.restore_defaults();
                let _ = save_library_to_disk(&editor.library);
                self.feedback = Some(("✓ 已成功恢复出厂种子公式！".to_owned(), false));
            }

            if ui.button(RichText::new("导出 JSON").color(CYAN))
                .on_hover_text("导出全部公式包为格式化 JSON 并写入剪贴板")
                .clicked()
            {
                let json = editor.library.formulas.export_json();
                ui.ctx().copy_text(json);
                self.feedback = Some(("✓ 已导出全部公式包 JSON 到系统剪贴板！".to_owned(), false));
            }

            let imp_txt = if self.show_formula_importer { "关闭导入" } else { "导入 JSON" };
            if ui.button(RichText::new(imp_txt).color(AMBER))
                .on_hover_text("从 JSON 文本导入公式")
                .clicked()
            {
                self.show_formula_importer = !self.show_formula_importer;
            }
        });

        // 2. 导入面板 (手风琴展开)
        if self.show_formula_importer {
            ui.add_space(6.0);
            egui::Frame::NONE
                .fill(CARD)
                .stroke(Stroke::new(1.0, AMBER.gamma_multiply(0.6)))
                .corner_radius(CornerRadius::same(6))
                .inner_margin(Margin::same(10))
                .show(ui, |ui| {
                    ui.label(RichText::new("导入公式包 (JSON 数组)").strong().color(AMBER));
                    ui.add_space(4.0);
                    ui.add(
                        egui::TextEdit::multiline(&mut self.formula_import_text)
                            .desired_rows(3)
                            .desired_width(ui.available_width())
                            .hint_text("在此粘贴导出的公式 JSON 数组文本..."),
                    );
                    ui.add_space(4.0);
                    ui.horizontal(|ui| {
                        if ui.button(RichText::new("覆盖导入 (同 ID 替换)").strong().color(GREEN)).clicked() {
                            match editor.library.formulas.import_json(&self.formula_import_text, true) {
                                Ok(cnt) => {
                                    let _ = save_library_to_disk(&editor.library);
                                    self.feedback = Some((format!("✓ 成功导入 {cnt} 条公式！"), false));
                                    self.show_formula_importer = false;
                                    self.formula_import_text.clear();
                                }
                                Err(e) => {
                                    self.feedback = Some((format!("导入失败: {e}"), true));
                                }
                            }
                        }
                        if ui.button(RichText::new("跳过重复导入").color(CYAN)).clicked() {
                            match editor.library.formulas.import_json(&self.formula_import_text, false) {
                                Ok(cnt) => {
                                    let _ = save_library_to_disk(&editor.library);
                                    self.feedback = Some((format!("✓ 成功新增导入 {cnt} 条公式！"), false));
                                    self.show_formula_importer = false;
                                    self.formula_import_text.clear();
                                }
                                Err(e) => {
                                    self.feedback = Some((format!("导入失败: {e}"), true));
                                }
                            }
                        }
                        if ui.button("关闭").clicked() {
                            self.show_formula_importer = false;
                        }
                    });
                });
        }

        // 3. 新建 / 编辑表单面板
        if self.show_formula_form {
            ui.add_space(6.0);
            let is_editing = self.formula_editing_id.is_some();
            let title = if is_editing { "编辑公式" } else { "新建自定义公式" };
            egui::Frame::NONE
                .fill(CARD)
                .stroke(Stroke::new(1.0, GREEN.gamma_multiply(0.6)))
                .corner_radius(CornerRadius::same(6))
                .inner_margin(Margin::same(10))
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(title).strong().color(GREEN));
                        if let Some(id) = &self.formula_editing_id {
                            ui.label(RichText::new(format!("(ID: {id})")).size(11.0).color(MUTED));
                        }
                    });
                    ui.add_space(4.0);
                    egui::Grid::new("formula-edit-grid")
                        .num_columns(4)
                        .spacing([8.0, 6.0])
                        .show(ui, |ui| {
                            ui.label("公式名称:");
                            ui.add(egui::TextEdit::singleline(&mut self.formula_edit_name).hint_text("如：高斯消元定理"));

                            ui.label("学科分类:");
                            ui.add(egui::TextEdit::singleline(&mut self.formula_edit_category).hint_text("如：线性代数"));
                            ui.end_row();

                            ui.label("简码流源码:");
                            ui.add(egui::TextEdit::singleline(&mut self.formula_edit_source).hint_text("如：▸f a;b; = c"));

                            ui.label("检索标签:");
                            ui.add(egui::TextEdit::singleline(&mut self.formula_edit_tags).hint_text("如：algebra matrix (空格分隔)"));
                            ui.end_row();
                        });

                    ui.add_space(4.0);
                    ui.horizontal(|ui| {
                        ui.label("学术原理/说明:");
                        ui.add(
                            egui::TextEdit::singleline(&mut self.formula_edit_desc)
                                .desired_width(ui.available_width() - 140.0)
                                .hint_text("公式背景、数学原理或工程用途简述"),
                        );
                        if ui.button(RichText::new("保存").strong().color(GREEN)).clicked() {
                            let tags: Vec<String> = self.formula_edit_tags
                                .split(|c: char| c == ',' || c == '，' || c.is_whitespace())
                                .map(str::trim)
                                .filter(|s| !s.is_empty())
                                .map(str::to_owned)
                                .collect();
                            let id = self.formula_editing_id.clone().unwrap_or_default();
                            let is_builtin = self.formula_editing_id
                                .as_deref()
                                .and_then(|eid| editor.library.formulas.get(eid))
                                .map(|e| e.is_builtin)
                                .unwrap_or(false);
                            let entry = mathslot_core::library::FormulaEntry {
                                id,
                                name: self.formula_edit_name.clone(),
                                category: self.formula_edit_category.clone(),
                                source: self.formula_edit_source.clone(),
                                desc: self.formula_edit_desc.clone(),
                                tags,
                                is_builtin,
                                created_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs(),
                            };
                            match editor.library.formulas.upsert(entry) {
                                Ok(_) => {
                                    let _ = save_library_to_disk(&editor.library);
                                    self.feedback = Some(("✓ 公式已成功保存！".to_owned(), false));
                                    self.show_formula_form = false;
                                }
                                Err(e) => {
                                    self.feedback = Some((e, true));
                                }
                            }
                        }
                        if ui.button("取消").clicked() {
                            self.show_formula_form = false;
                        }
                    });
                });
        }

        ui.add_space(8.0);

        // 4. 学科分类筛选 Tab 条 (动态汇聚)
        let mut categories = vec!["全部".to_owned()];
        for cat in editor.library.formulas.categories() {
            if !categories.contains(&cat) {
                categories.push(cat);
            }
        }

        ui.horizontal_wrapped(|ui| {
            for cat in &categories {
                let is_selected = self.preset_category == *cat;
                let text = if is_selected {
                    RichText::new(cat).strong().color(ACCENT)
                } else {
                    RichText::new(cat).color(TEXT_DIM)
                };
                let btn = ui.selectable_label(is_selected, text);
                if btn.clicked() {
                    self.preset_category = cat.clone();
                }
            }
        });

        ui.add_space(8.0);
        ui.separator();
        ui.add_space(6.0);

        // 5. 筛选与展示
        let filtered = editor.library.formulas.filter(Some(&self.preset_category), &self.preset_search);

        // 状态概要信息
        ui.horizontal(|ui| {
            ui.label(
                RichText::new(format!(
                    "共收录 {} 个公式 · 当前显示 {} 个",
                    editor.library.formulas.entries.len(),
                    filtered.len()
                ))
                .size(11.5)
                .color(MUTED),
            );
            if let Some((msg, is_err)) = &self.feedback {
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    let color = if *is_err { RED } else { GREEN };
                    ui.label(RichText::new(msg).size(11.5).color(color));
                });
            }
        });

        ui.add_space(6.0);

        // 待删除 ID
        let mut delete_id: Option<String> = None;

        // 6. 滚动展示公式卡片 (自适应高度)
        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .show(ui, |ui| {
                if filtered.is_empty() {
                    ui.add_space(32.0);
                    ui.vertical_centered(|ui| {
                        ui.label(
                            RichText::new("未找到匹配的公式，请尝试更换关键词或学科分类。")
                                .size(13.0)
                                .color(MUTED),
                        );
                    });
                    return;
                }

                for formula in filtered {
                    egui::Frame::NONE
                        .fill(CARD)
                        .corner_radius(CornerRadius::same(6))
                        .stroke(Stroke::new(1.0, CARD_BORDER))
                        .inner_margin(Margin::same(10))
                        .show(ui, |ui| {
                            // 第一行：标题、学科徽章与右侧动作区
                            ui.horizontal(|ui| {
                                ui.label(RichText::new(&formula.name).strong().size(13.5).color(TEXT));
                                ui.label(
                                    RichText::new(format!("[{}]", formula.category))
                                        .size(11.0)
                                        .color(CYAN),
                                );
                                if !formula.is_builtin {
                                    ui.label(RichText::new("[自建]").size(10.5).color(AMBER));
                                }

                                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                    if ui.small_button(RichText::new("✓ 载入").strong().color(GREEN)).clicked() {
                                        action = Some(ModalAction::ReplaceCode(formula.source.clone()));
                                        self.show_presets = false;
                                    }

                                    if ui.small_button(RichText::new("+ 追加").color(ACCENT)).clicked() {
                                        action = Some(ModalAction::InsertCode(formula.source.clone()));
                                        self.show_presets = false;
                                    }

                                    if ui.small_button(RichText::new("复制 LaTeX").color(TEXT_DIM)).clicked() {
                                        let parsed = mathslot_core::parser::parse_with_library(
                                            &formula.source,
                                            &editor.library,
                                        );
                                        let latex = mathslot_core::latex::to_latex(&parsed);
                                        ui.ctx().copy_text(latex);
                                        self.feedback = Some((
                                            format!("✓ 已复制 [{}] 的标准 LaTeX 至剪贴板！", formula.name),
                                            false,
                                        ));
                                    }

                                    if ui.small_button(RichText::new("编辑").color(CYAN)).clicked() {
                                        self.formula_editing_id = Some(formula.id.clone());
                                        self.formula_edit_name = formula.name.clone();
                                        self.formula_edit_category = formula.category.clone();
                                        self.formula_edit_source = formula.source.clone();
                                        self.formula_edit_desc = formula.desc.clone();
                                        self.formula_edit_tags = formula.tags.join(" ");
                                        self.show_formula_form = true;
                                    }

                                    if !formula.is_builtin {
                                        if ui.small_button(RichText::new("删除").color(RED)).clicked() {
                                            delete_id = Some(formula.id.clone());
                                        }
                                    }
                                });
                            });

                            ui.add_space(4.0);

                            // 第二行：学科背景或数学说明
                            if !formula.desc.is_empty() {
                                ui.label(RichText::new(&formula.desc).size(11.5).color(MUTED));
                                ui.add_space(4.0);
                            }

                            // 第三行：流式简码预览条
                            ui.horizontal(|ui| {
                                ui.label(RichText::new("简码流:").size(11.0).color(AMBER));
                                ui.label(
                                    RichText::new(&formula.source)
                                        .monospace()
                                        .size(11.5)
                                        .color(CYAN),
                                );
                                if !formula.tags.is_empty() {
                                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                        ui.label(
                                            RichText::new(format!("#{}", formula.tags.join(" #")))
                                                .size(10.5)
                                                .color(MUTED),
                                        );
                                    });
                                }
                            });
                        });

                    ui.add_space(4.0);
                }
            });

        if let Some(did) = delete_id {
            if editor.library.formulas.remove(&did) {
                let _ = save_library_to_disk(&editor.library);
                self.feedback = Some(("✓ 已删除公式。".to_owned(), false));
            }
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

        let tab_titles = [
            "⇄ LaTeX 逆向导入".to_owned(),
            format!("k{} 自定义格式 ({})", CMD_PREFIX, editor.library.custom_formats.len()),
            format!("t{} 片段模版 ({})", CMD_PREFIX, editor.library.snippets.len()),
        ];
        let tabs = [
            LibraryTab::LatexConverter,
            LibraryTab::CustomFormats,
            LibraryTab::Snippets,
        ];
        let options: Vec<(&str, &str)> = vec![
            (tab_titles[0].as_str(), "LaTeX 公式反编译为简码流"),
            (tab_titles[1].as_str(), "以 $1, $2 槽位定义自定义宏"),
            (tab_titles[2].as_str(), "常用公式片段与填空模版"),
        ];
        let selected = tabs.iter().position(|t| *t == self.tab).unwrap_or(0);
        if let Some(idx) = segmented(ui, &options, selected) {
            self.tab = tabs[idx];
            if self.tab == LibraryTab::LatexConverter {
                self.update_latex_conversion();
            }
        }

        ui.add_space(6.0);
        ui.horizontal(|ui| {
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if ui
                    .small_button(RichText::new("恢复默认预置").color(TEXT_DIM))
                    .on_hover_text("恢复内置示例格式与模版（覆盖当前列表）")
                    .clicked()
                {
                    reset_defaults = true;
                }
                ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
                    ui.add(
                        egui::Label::new(
                            RichText::new(format!("配置文件  {}", self.config_path_hint))
                                .size(11.0)
                                .color(MUTED),
                        )
                        .truncate(),
                    );
                });
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
            ui.add_space(6.0);
            let color = if *is_err { RED } else { GREEN };
            egui::Frame::NONE
                .fill(if *is_err { RED.gamma_multiply(0.12) } else { GREEN_BG })
                .stroke(Stroke::new(1.0, color.gamma_multiply(0.4)))
                .corner_radius(CornerRadius::same(7))
                .inner_margin(Margin::symmetric(10, 6))
                .show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.label(RichText::new(msg).size(12.0).color(color));
                });
        }

        ui.add_space(6.0);
        ui.separator();
        ui.add_space(4.0);

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

        // 常用示例快捷点选
        ui.horizontal_wrapped(|ui| {
            ui.label(RichText::new("示例:").size(11.5).color(MUTED));
            const EXAMPLES: &[(&str, &str)] = &[
                ("求根公式", r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"),
                ("高斯积分", r"\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}"),
                ("重要极限", r"\lim_{x \to 0} \frac{\sin x}{x} = 1"),
                ("贝叶斯", r"P(A|B) = \frac{P(B|A) P(A)}{P(B)}"),
                ("薛定谔", r"i\hbar \frac{\partial \psi}{\partial t} = \hat{H}\psi"),
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

        // 现代统一双层转换面板 (Linear 风格无缝分割)
        egui::Frame::NONE
            .fill(CARD)
            .stroke(Stroke::new(1.0, CARD_BORDER))
            .corner_radius(CornerRadius::same(10))
            .inner_margin(Margin::same(12))
            .show(ui, |ui| {
                // 上半部：LaTeX 输入
                ui.horizontal(|ui| {
                    ui.label(RichText::new("LaTeX 源代码").size(12.0).strong().color(ACCENT));
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
                        .font(FontId::monospace(13.0))
                        .desired_rows(3)
                        .desired_width(ui.available_width())
                        .hint_text(r"粘贴 LaTeX，如 \frac{a+b}{c} 或 \sum_{k=1}^n k^2"),
                );
                if edit_resp.changed() {
                    self.update_latex_conversion();
                }

                ui.add_space(8.0);
                ui.separator();
                ui.add_space(8.0);

                // 下半部：MathSlot 简码流生成与校验
                ui.horizontal(|ui| {
                    ui.label(RichText::new("MathSlot 简码流").size(12.0).strong().color(AMBER));
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.small_button("复制简码流").clicked() {
                            ui.ctx().copy_text(self.latex_converted_mathslot.clone());
                            self.feedback = Some(("✓ 简码流已复制到剪贴板！".to_owned(), false));
                        }
                    });
                });
                ui.add_space(3.0);
                ui.add(
                    egui::TextEdit::singleline(&mut self.latex_converted_mathslot.as_str())
                        .font(FontId::monospace(13.5))
                        .text_color(CYAN)
                        .desired_width(ui.available_width()),
                );

                let verified_parsed = mathslot_core::parser::parse_with_library(
                    &self.latex_converted_mathslot,
                    &editor.library,
                );
                let verified_latex = mathslot_core::latex::to_latex(&verified_parsed);
                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    ui.label(RichText::new("校验反推:").size(11.0).color(MUTED));
                    ui.add(
                        egui::Label::new(
                            RichText::new(&verified_latex).monospace().size(11.0).color(TEXT_DIM),
                        )
                        .truncate(),
                    )
                    .on_hover_text(&verified_latex);
                });

                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    if ui
                        .button(RichText::new("✓ 替换当前编辑器内容").strong().color(GREEN))
                        .on_hover_text("用反编译简码流覆盖当前编辑器")
                        .clicked()
                        && !self.latex_converted_mathslot.is_empty()
                    {
                        action = Some(ModalAction::ReplaceCode(
                            self.latex_converted_mathslot.clone(),
                        ));
                        self.show_library = false;
                    }

                    if ui
                        .button(RichText::new("+ 插入到当前光标处").color(ACCENT))
                        .on_hover_text("追加到当前光标位置")
                        .clicked()
                        && !self.latex_converted_mathslot.is_empty()
                    {
                        action = Some(ModalAction::InsertCode(
                            self.latex_converted_mathslot.clone(),
                        ));
                        self.show_library = false;
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

        // 顶栏操作：新建展开与快捷微文案
        ui.horizontal(|ui| {
            let btn_txt = if self.show_custom_form { "收起表单" } else { "+ 新建自定义格式" };
            if ui.button(RichText::new(btn_txt).strong().color(if self.show_custom_form { TEXT_DIM } else { GREEN })).clicked() {
                self.show_custom_form = !self.show_custom_form;
                if self.show_custom_form
                    && self.custom_label.is_empty()
                    && let Some(k) = editor.library.next_free_custom_key()
                {
                    self.custom_key = k.to_string();
                }
            }

            ui.label(
                RichText::new("按 Tab k 触发 · $1, $2 对应槽位")
                    .size(11.0)
                    .color(MUTED),
            );
        });

        if self.show_custom_form {
            ui.add_space(6.0);
            egui::Frame::NONE
                .fill(CARD)
                .stroke(Stroke::new(1.0, CARD_BORDER))
                .corner_radius(CornerRadius::same(10))
                .inner_margin(Margin::same(12))
                .show(ui, |ui| {
                    ui.label(
                        RichText::new("新建 / 编辑自定义格式")
                            .size(12.0)
                            .strong()
                            .color(AMBER),
                    );
                    ui.add_space(4.0);
                    egui::Grid::new("mathslot-custom-fmt-grid")
                        .num_columns(4)
                        .spacing([8.0, 6.0])
                        .show(ui, |ui| {
                            ui.label("触发字母:");
                            ui.add(
                                egui::TextEdit::singleline(&mut self.custom_key)
                                    .desired_width(40.0)
                                    .hint_text("g"),
                            );
                            ui.label("格式名称:");
                            ui.add(
                                egui::TextEdit::singleline(&mut self.custom_label)
                                    .desired_width(170.0)
                                    .hint_text("如：同余式 / 期望"),
                            );
                            ui.end_row();

                            ui.label("缩略提示:");
                            ui.add(
                                egui::TextEdit::singleline(&mut self.custom_glyph)
                                    .desired_width(90.0)
                                    .hint_text("如 a≡b(m)"),
                            );
                            ui.label("槽位角色:");
                            ui.add(
                                egui::TextEdit::singleline(&mut self.custom_roles)
                                    .desired_width(170.0)
                                    .hint_text("左项;右项;模数 (分号分隔)"),
                            );
                            ui.end_row();

                            ui.label("LaTeX 模板:");
                            ui.horizontal(|ui| {
                                ui.add(
                                    egui::TextEdit::singleline(&mut self.custom_latex)
                                        .font(FontId::monospace(13.0))
                                        .desired_width(280.0)
                                        .hint_text("$1 \\equiv $2 \\pmod{$3}"),
                                );
                            });
                            ui.end_row();
                        });

                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
                        if ui
                            .button(RichText::new("保存格式").strong().color(GREEN))
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
                                scheme_a_name: String::new(),
                                layout,
                                auto_join,
                            };
                            match editor.library.upsert_custom(fmt) {
                                Ok(saved_k) => {
                                    editor.set_library(editor.library.clone());
                                    let (msg, is_err) = match save_library_to_disk(&editor.library) {
                                        Ok(_) => (
                                            format!(
                                                "✓ 已保存格式 [{CMD_PREFIX}k{saved_k}]：按 Tab k {saved_k} 即可调用！"
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
                                    self.show_custom_form = false;
                                    action = Some(ModalAction::LibraryChanged(msg));
                                }
                                Err(err) => {
                                    self.feedback = Some((err, true));
                                }
                            }
                        }
                        if ui.button("取消").clicked() {
                            self.show_custom_form = false;
                        }
                    });
                });
        }

        ui.add_space(6.0);
        ui.label(
            RichText::new("已注册自定义格式列表")
                .size(12.0)
                .strong()
                .color(TEXT),
        );

        egui::ScrollArea::vertical()
            .id_salt("mathslot-custom-list-scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for fmt in &editor.library.custom_formats {
                    egui::Frame::NONE
                        .fill(BG)
                        .stroke(Stroke::new(1.0, CARD_BORDER))
                        .corner_radius(CornerRadius::same(8))
                        .inner_margin(Margin::symmetric(10, 7))
                        .show(ui, |ui| {
                            ui.horizontal(|ui| {
                                ui.label(
                                    RichText::new(format!("[{CMD_PREFIX}k{}]", fmt.item_key))
                                        .monospace()
                                        .strong()
                                        .color(AMBER),
                                );
                                ui.label(RichText::new(&fmt.label).strong().color(TEXT));
                                if !fmt.glyph_hint.is_empty() {
                                    ui.label(
                                        RichText::new(&fmt.glyph_hint)
                                            .monospace()
                                            .size(11.5)
                                            .color(CYAN),
                                    );
                                }
                                ui.add(
                                    egui::Label::new(
                                        RichText::new(format!("→ {}", fmt.latex_template))
                                            .monospace()
                                            .size(11.5)
                                            .color(MUTED),
                                    )
                                    .truncate(),
                                )
                                .on_hover_text(&fmt.latex_template);

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
            self.custom_scheme_a.clear();
            self.show_custom_form = true;
            self.feedback = Some(("已载入表单，修改后点「保存格式」即可覆盖。".to_owned(), false));
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

        // 顶部操作栏
        ui.horizontal(|ui| {
            let btn_txt = if self.show_snippet_form { "收起表单" } else { "+ 新建片段模版" };
            if ui.button(RichText::new(btn_txt).strong().color(if self.show_snippet_form { TEXT_DIM } else { GREEN })).clicked() {
                self.show_snippet_form = !self.show_snippet_form;
                if self.show_snippet_form
                    && self.snip_label.is_empty()
                    && let Some(k) = editor.library.next_free_snippet_key()
                {
                    self.snip_key = k.to_string();
                }
            }

            if ui
                .button(RichText::new("存内部子式").color(AMBER))
                .on_hover_text("若光标位于根式/分式/积分内，仅保存该子式")
                .clicked()
            {
                action = Some(ModalAction::QuickSaveSnippet { prefer_inner: true });
            }
            if ui
                .button(RichText::new("存整行公式").color(ACCENT))
                .on_hover_text("将当前输入栏整条公式保存为模版")
                .clicked()
            {
                action = Some(ModalAction::QuickSaveSnippet {
                    prefer_inner: false,
                });
            }
            ui.label(
                RichText::new("按 Tab t 快速展开")
                    .size(11.0)
                    .color(MUTED),
            );
        });

        if self.show_snippet_form {
            ui.add_space(6.0);
            egui::Frame::NONE
                .fill(CARD)
                .stroke(Stroke::new(1.0, CARD_BORDER))
                .corner_radius(CornerRadius::same(10))
                .inner_margin(Margin::same(12))
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(
                            RichText::new("新建 / 编辑片段模版")
                                .size(12.0)
                                .strong()
                                .color(AMBER),
                        );
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            if ui.small_button("填入当前公式").clicked() {
                                self.snip_source = editor.source.clone();
                            }
                        });
                    });
                    ui.add_space(4.0);
                    egui::Grid::new("mathslot-snippet-form-grid")
                        .num_columns(4)
                        .spacing([8.0, 6.0])
                        .show(ui, |ui| {
                            ui.label("触发字母:");
                            ui.add(
                                egui::TextEdit::singleline(&mut self.snip_key)
                                    .desired_width(40.0)
                                    .hint_text("d"),
                            );
                            ui.label("模版名称:");
                            ui.add(
                                egui::TextEdit::singleline(&mut self.snip_label)
                                    .desired_width(180.0)
                                    .hint_text("如：高斯核 / 泰勒余项"),
                            );
                            ui.end_row();

                            ui.label("简码流源码:");
                            ui.horizontal(|ui| {
                                ui.add(
                                    egui::TextEdit::singleline(&mut self.snip_source)
                                        .font(FontId::monospace(12.5))
                                        .desired_width(280.0)
                                        .hint_text("如 ▸rb^2 - 4ac;"),
                                );
                            });
                            ui.end_row();
                        });

                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
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
                                    self.show_snippet_form = false;
                                    action = Some(ModalAction::LibraryChanged(msg));
                                }
                                Err(err) => {
                                    self.feedback = Some((err, true));
                                }
                            }
                        }
                        if ui.button("取消").clicked() {
                            self.show_snippet_form = false;
                        }
                    });
                });
        }

        ui.add_space(6.0);
        ui.label(
            RichText::new("已保存片段与填空模版")
                .size(12.0)
                .strong()
                .color(TEXT),
        );

        egui::ScrollArea::vertical()
            .id_salt("mathslot-snippet-list-scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for snip in &editor.library.snippets {
                    egui::Frame::NONE
                        .fill(BG)
                        .stroke(Stroke::new(1.0, CARD_BORDER))
                        .corner_radius(CornerRadius::same(8))
                        .inner_margin(Margin::symmetric(10, 7))
                        .show(ui, |ui| {
                            ui.horizontal(|ui| {
                                ui.label(
                                    RichText::new(format!("[{CMD_PREFIX}t{}]", snip.item_key))
                                        .monospace()
                                        .strong()
                                        .color(AMBER),
                                );
                                ui.label(RichText::new(&snip.label).strong().color(TEXT));
                                ui.add(
                                    egui::Label::new(
                                        RichText::new(&snip.stream_source)
                                            .monospace()
                                            .size(11.5)
                                            .color(CYAN),
                                    )
                                    .truncate(),
                                )
                                .on_hover_text(&snip.stream_source);

                                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                    if ui.small_button("删除").clicked() {
                                        delete_key = Some(snip.item_key);
                                    }
                                    if ui.small_button("编辑").clicked() {
                                        edit_snip = Some(snip.clone());
                                    }
                                    if ui
                                        .small_button(RichText::new("插入").color(GREEN))
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
            self.show_snippet_form = true;
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
        .max_height(520.0)
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
                        "按 `Tab j` 进导航后按 `a` 跳到最前面 → 按 `Tab l` 插入极限：编辑器会自动把等号前的 `\\frac{\\sin x}{x}` 放进极限「主体」槽，光标留在第1槽填 `x` → Enter → `0`！",
                    ),
                    (
                        "同样适用",
                        "前置插入 `Tab i` (积分) / `Tab s` (求和) 自动包裹至第3槽主体；前置插入 `Tab f` (分数) 自动作分子并跳入分母；若不想包裹，按 `Ctrl+Z` 一步退回普通空槽！",
                    ),
                ],
            );

            help_section(
                ui,
                "3. 增强导航跳转（Tab j / Alt j 直达锚点）",
                &[
                    (
                        "Tab j / Alt j",
                        "进入/退出槽位导航模式；导航中按 Enter 确认落位，按 Tab / Esc 亦可退出",
                    ),
                    ("a (或 0 / h)", "导航态下一键跳至当前层级最前端 `[a]`（根级即整行行首）"),
                    ("; (或 . / $ / t)", "导航态下一键跳至当前层级最末端 `[;]`（跨出所有闭合分号直达行尾）"),
                    (
                        "- (或 Alt+← / p)",
                        "跳回「上一个跳转位置」，再按一次乒乓切回（跟踪插入偏移；p/n 历史前进后退）",
                    ),
                    (
                        "复合槽字母 (如 c)",
                        "带 `[x+]` 的嵌套槽会逐级展开为独立子式（如 `c` 然后 `b`），按 Backspace 返回上一层",
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
                        "遇到 `▸f`、`▸ma`、`▸ka` 等结构指令时一次性原子跨过，不卡半截前缀；在导航模式下则沿徽章逐个漫游",
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
    const KEY_COL_W: f32 = 168.0;
    egui::Frame::NONE
        .fill(CARD)
        .stroke(Stroke::new(1.0, CARD_BORDER))
        .corner_radius(CornerRadius::same(10))
        .inner_margin(Margin::symmetric(14, 12))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(RichText::new(title).size(13.0).strong().color(ACCENT));
            ui.add_space(6.0);
            for (idx, (k, desc)) in rows.iter().enumerate() {
                if idx > 0 {
                    ui.add_space(5.0);
                }
                ui.horizontal_top(|ui| {
                    ui.allocate_ui_with_layout(
                        Vec2::new(KEY_COL_W, 0.0),
                        Layout::top_down(Align::Min),
                        |ui| {
                            ui.set_width(KEY_COL_W);
                            ui.label(
                                RichText::new(*k)
                                    .monospace()
                                    .size(12.0)
                                    .strong()
                                    .color(AMBER),
                            );
                        },
                    );
                    ui.vertical(|ui| {
                        ui.label(RichText::new(*desc).size(12.0).color(TEXT));
                    });
                });
            }
        });
    ui.add_space(8.0);
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
            Err(e) => {
                // 自动尝试从 .bak 容灾备份恢复
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
    // 自动双重容灾备份：若已有原配置，先复制一份为 library.json.bak
    if path.exists() {
        let bak = path.with_extension("json.bak");
        let _ = std::fs::copy(&path, &bak);
    }
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("替换配置文件失败: {e}")
    })?;
    Ok(path.display().to_string())
}

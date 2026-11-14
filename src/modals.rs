use std::path::PathBuf;
use std::time::{Duration, Instant};

use eframe::egui::{self, Align, CornerRadius, FontId, Layout, Margin, RichText, Stroke, Vec2};
use mathslot_core::command::CMD_PREFIX;
use mathslot_core::editor::StreamEditor;
use mathslot_core::library::{CustomFormat, FormulaEntry, FormulaSnippet, UserLibrary};
use mathslot_latex::{ImportReport, convert_latex_with_report};

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

pub const UNDO_DELETE_WINDOW: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PendingDeleteTarget {
    Formula(String),
    CustomFormat(char),
    Snippet(char),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeletedItemSnapshot {
    Formula(FormulaEntry),
    CustomFormat(CustomFormat),
    Snippet(FormulaSnippet),
}

#[derive(Clone, Debug)]
pub struct UndoDeleteEntry {
    pub item: DeletedItemSnapshot,
    pub deleted_at: Instant,
}

enum DeleteRowAction {
    None,
    Request(PendingDeleteTarget),
    Confirm,
    Cancel,
}

pub fn can_apply_latex_import(
    converted: &str,
    report: Option<&ImportReport>,
) -> Result<(), String> {
    if converted.trim().is_empty() {
        return Err("导入结果为空，无法应用到编辑器。".to_owned());
    }
    let Some(report) = report else {
        return Err("缺少 LaTeX 导入诊断报告，已阻止应用。".to_owned());
    };
    if report.has_errors() {
        let first_err = report
            .diagnostics
            .iter()
            .find(|d| d.is_error())
            .map(|d| d.kind.to_string())
            .unwrap_or_else(|| "LaTeX 语法错误".to_owned());
        let err_count = report.diagnostics.iter().filter(|d| d.is_error()).count();
        return Err(format!(
            "检测到 {err_count} 处 LaTeX 语法错误（{first_err}），已阻止应用。"
        ));
    }
    Ok(())
}

pub enum ModalAction {
    InsertCode(String),
    ReplaceCode(String),
    QuickSaveSnippet { prefer_inner: bool },
    LibraryChanged(String),
}

pub struct LibraryModalState {
    pub tab: LibraryTab,
    pub config_path_hint: String,
    pub store_session: LibraryPersistenceSession,
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
    pub latex_import_report: Option<ImportReport>,

    // 删除二次确认与撤销恢复缓冲 (D-016)
    pub pending_delete: Option<PendingDeleteTarget>,
    pub undo_delete_buffer: Option<UndoDeleteEntry>,

    // 权威公式库 (Formula Corpus)
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
    pub fn new(
        lib: &UserLibrary,
        config_path_hint: String,
        store_session: LibraryPersistenceSession,
    ) -> Self {
        let next_k = lib.next_free_custom_key().unwrap_or('g');
        let next_t = lib.next_free_snippet_key().unwrap_or('d');
        let initial_feedback = store_session.load_error.clone().map(|e| (e, true));
        let mut s = Self {
            tab: LibraryTab::LatexConverter,
            config_path_hint,
            store_session,
            feedback: initial_feedback,
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
            latex_import_report: None,
            pending_delete: None,
            undo_delete_buffer: None,
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

    pub fn save_library(&mut self, lib: &UserLibrary) -> Result<String, String> {
        let Some(path) = self.store_session.path.clone().or_else(library_config_path) else {
            return Err("未找到用户配置目录。".to_owned());
        };
        save_library_to_path(lib, &path, &mut self.store_session)
    }

    fn render_recovery_banner(
        &mut self,
        ui: &mut egui::Ui,
        editor: &mut StreamEditor,
    ) -> Option<ModalAction> {
        if !self.store_session.is_blocked() {
            return None;
        }
        let mut action = None;
        let msg = self
            .store_session
            .load_error
            .clone()
            .unwrap_or_else(|| "配置文件处于损坏隔离状态，请先确认恢复或重置。".to_owned());
        egui::Frame::NONE
            .fill(RED.gamma_multiply(0.12))
            .stroke(Stroke::new(1.0, RED.gamma_multiply(0.5)))
            .corner_radius(CornerRadius::same(6))
            .inner_margin(Margin::same(8))
            .show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.label(
                    RichText::new(format!("⚠ 配置恢复向导：{msg}"))
                        .size(11.5)
                        .color(RED),
                );
                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    if let Some(backup_lib) = self.store_session.recovery_backup_library.clone()
                        && ui
                            .button(RichText::new("从最近备份恢复").strong().color(GREEN))
                            .clicked()
                    {
                        self.store_session.quarantined_corrupt_path = None;
                        self.store_session.load_error = None;
                        self.store_session.recovery_backup_path = None;
                        self.store_session.recovery_backup_library = None;
                        self.store_session.revision = None;
                        editor.set_library(backup_lib);
                        let (fb, is_err) = match self.save_library_confirmed_reset(&editor.library)
                        {
                            Ok(_) => ("✓ 已从最近备份恢复并写入配置。".to_owned(), false),
                            Err(e) => (format!("已恢复到内存，但写入磁盘失败: {e}"), true),
                        };
                        self.feedback = Some((fb.clone(), is_err));
                        action = Some(ModalAction::LibraryChanged(fb));
                    }
                    if ui
                        .button(RichText::new("确认重置为默认空配置").color(AMBER))
                        .clicked()
                    {
                        self.store_session.quarantined_corrupt_path = None;
                        self.store_session.load_error = None;
                        self.store_session.recovery_backup_path = None;
                        self.store_session.recovery_backup_library = None;
                        self.store_session.revision = None;
                        let empty = mathslot_store::LibraryFile::empty_v3()
                            .to_user_library(mathslot_store::Catalog::builtin());
                        editor.set_library(empty);
                        let (fb, is_err) = match self.save_library_confirmed_reset(&editor.library)
                        {
                            Ok(_) => ("✓ 已重置并写入全新配置。".to_owned(), false),
                            Err(e) => (format!("重置已生效，但写入磁盘失败: {e}"), true),
                        };
                        self.feedback = Some((fb.clone(), is_err));
                        action = Some(ModalAction::LibraryChanged(fb));
                    }
                });
            });
        ui.add_space(6.0);
        action
    }

    fn save_library_confirmed_reset(&mut self, lib: &UserLibrary) -> Result<String, String> {
        let Some(path) = self.store_session.path.clone().or_else(library_config_path) else {
            return Err("未找到用户配置目录。".to_owned());
        };
        let file =
            mathslot_store::LibraryFile::from_user_library(lib, mathslot_store::Catalog::builtin());
        let new_rev = mathslot_store::save_atomic(
            &path,
            &file,
            mathslot_store::WriteCondition::Unconditional,
        )
        .map_err(|e| e.to_string())?;
        self.store_session.revision = Some(new_rev);
        Ok(path.display().to_string())
    }

    pub fn open_custom_tab(&mut self, lib: &UserLibrary) {
        self.tab = LibraryTab::CustomFormats;
        self.pending_delete = None;
        if self.custom_label.is_empty()
            && let Some(k) = lib.next_free_custom_key()
        {
            self.custom_key = k.to_string();
        }
        self.show_custom_form = false;
    }

    pub fn open_snippets_tab(&mut self, lib: &UserLibrary) {
        self.tab = LibraryTab::Snippets;
        self.pending_delete = None;
        if self.snip_label.is_empty()
            && let Some(k) = lib.next_free_snippet_key()
        {
            self.snip_key = k.to_string();
        }
        self.show_snippet_form = false;
    }

    pub fn open_latex_tab(&mut self) {
        self.tab = LibraryTab::LatexConverter;
        self.update_latex_conversion();
    }

    pub fn update_latex_conversion(&mut self) {
        let (_ast, report) = convert_latex_with_report(&self.latex_input);
        self.latex_import_report = Some(report);
        self.latex_converted_mathslot = mathslot_core::latex::latex_to_mathslot(&self.latex_input);
    }

    pub fn request_delete(&mut self, target: PendingDeleteTarget) {
        self.pending_delete = Some(target);
    }

    pub fn cancel_pending_delete(&mut self) {
        self.pending_delete = None;
    }

    pub fn confirm_pending_delete(&mut self, editor: &mut StreamEditor) -> Result<String, String> {
        let Some(target) = self.pending_delete.take() else {
            return Err("没有待确认的删除项。".to_owned());
        };

        let (snapshot, label, sync_library) = match target {
            PendingDeleteTarget::Formula(id) => {
                let Some(entry) = editor.library.formulas.get(&id).cloned() else {
                    return Err("要删除的公式不存在。".to_owned());
                };
                if entry.is_builtin {
                    return Err("内置公式不允许删除。".to_owned());
                }
                if !editor.library.formulas.remove(&id) {
                    return Err("删除公式失败。".to_owned());
                }
                let name = entry.name.clone();
                (
                    DeletedItemSnapshot::Formula(entry),
                    format!("公式「{name}」"),
                    false,
                )
            }
            PendingDeleteTarget::CustomFormat(key) => {
                let Some(fmt) = editor.library.lookup_custom(key).cloned() else {
                    return Err(format!("自定义格式 `k{key}` 不存在。"));
                };
                if !editor.library.remove_custom(key) {
                    return Err(format!("删除自定义格式 `k{key}` 失败。"));
                }
                (
                    DeletedItemSnapshot::CustomFormat(fmt),
                    format!("自定义格式 `k{key}`"),
                    true,
                )
            }
            PendingDeleteTarget::Snippet(key) => {
                let Some(snip) = editor.library.lookup_snippet(key).cloned() else {
                    return Err(format!("片段 `t{key}` 不存在。"));
                };
                if !editor.library.remove_snippet(key) {
                    return Err(format!("删除片段 `t{key}` 失败。"));
                }
                (
                    DeletedItemSnapshot::Snippet(snip),
                    format!("片段 `t{key}`"),
                    false,
                )
            }
        };

        if sync_library {
            editor.set_library(editor.library.clone());
        }

        self.undo_delete_buffer = Some(UndoDeleteEntry {
            item: snapshot,
            deleted_at: Instant::now(),
        });

        let (msg, is_err) = match self.save_library(&editor.library) {
            Ok(_) => (format!("✓ 已删除{label}（10 秒内可撤销）。"), false),
            Err(e) => (
                format!("✓ 已删除{label}（本次会话生效，10 秒内可撤销），但写入磁盘失败: {e}"),
                true,
            ),
        };
        self.feedback = Some((msg.clone(), is_err));
        Ok(msg)
    }

    pub fn active_undo_entry(&self, now: Instant) -> Option<&UndoDeleteEntry> {
        self.undo_delete_buffer
            .as_ref()
            .filter(|entry| now.saturating_duration_since(entry.deleted_at) <= UNDO_DELETE_WINDOW)
    }

    pub fn undo_last_delete(
        &mut self,
        editor: &mut StreamEditor,
        now: Instant,
    ) -> Result<String, String> {
        let Some(entry) = self.undo_delete_buffer.take() else {
            return Err("当前没有可撤销的删除记录。".to_owned());
        };
        if now.saturating_duration_since(entry.deleted_at) > UNDO_DELETE_WINDOW {
            return Err("撤销时间窗口已过期，无法恢复。".to_owned());
        }

        let (label, sync_library) = match entry.item {
            DeletedItemSnapshot::Formula(formula) => {
                let name = formula.name.clone();
                editor.library.formulas.upsert(formula)?;
                (format!("公式「{name}」"), false)
            }
            DeletedItemSnapshot::CustomFormat(fmt) => {
                let key = editor.library.upsert_custom(fmt)?;
                (format!("自定义格式 `k{key}`"), true)
            }
            DeletedItemSnapshot::Snippet(snip) => {
                let key = editor.library.upsert_snippet(snip)?;
                (format!("片段 `t{key}`"), false)
            }
        };

        if sync_library {
            editor.set_library(editor.library.clone());
        }

        let (msg, is_err) = match self.save_library(&editor.library) {
            Ok(_) => (format!("↩ 已撤销删除并恢复{label}。"), false),
            Err(e) => (
                format!("↩ 已恢复{label}（本次会话生效），但写入磁盘失败: {e}"),
                true,
            ),
        };
        self.feedback = Some((msg.clone(), is_err));
        Ok(msg)
    }

    fn apply_delete_row_action(
        &mut self,
        editor: &mut StreamEditor,
        row_action: DeleteRowAction,
    ) -> Option<ModalAction> {
        match row_action {
            DeleteRowAction::None => None,
            DeleteRowAction::Request(target) => {
                self.request_delete(target);
                None
            }
            DeleteRowAction::Cancel => {
                self.cancel_pending_delete();
                None
            }
            DeleteRowAction::Confirm => match self.confirm_pending_delete(editor) {
                Ok(msg) => Some(ModalAction::LibraryChanged(msg)),
                Err(err) => {
                    self.feedback = Some((err, true));
                    None
                }
            },
        }
    }

    fn render_undo_delete_banner(
        &mut self,
        ui: &mut egui::Ui,
        editor: &mut StreamEditor,
    ) -> Option<ModalAction> {
        let now = Instant::now();
        let Some(entry) = self.active_undo_entry(now) else {
            self.undo_delete_buffer = None;
            return None;
        };
        let remaining = UNDO_DELETE_WINDOW
            .saturating_sub(now.saturating_duration_since(entry.deleted_at))
            .as_secs()
            .max(1);
        let item_desc = match &entry.item {
            DeletedItemSnapshot::Formula(f) => format!("公式「{}」", f.name),
            DeletedItemSnapshot::CustomFormat(c) => format!("自定义格式 `k{}`", c.item_key),
            DeletedItemSnapshot::Snippet(s) => format!("片段 `t{}`", s.item_key),
        };

        let mut undo_clicked = false;
        let mut dismiss_clicked = false;
        egui::Frame::NONE
            .fill(AMBER.gamma_multiply(0.12))
            .stroke(Stroke::new(1.0, AMBER.gamma_multiply(0.45)))
            .corner_radius(CornerRadius::same(7))
            .inner_margin(Margin::symmetric(10, 6))
            .show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    ui.label(
                        RichText::new(format!("已删除{item_desc}（{remaining}s 内可恢复）"))
                            .size(12.0)
                            .color(AMBER),
                    );
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ui.small_button("关闭").clicked() {
                            dismiss_clicked = true;
                        }
                        if ui
                            .small_button(RichText::new("↩ 撤销删除").strong().color(GREEN))
                            .clicked()
                        {
                            undo_clicked = true;
                        }
                    });
                });
            });
        ui.add_space(6.0);

        if dismiss_clicked {
            self.undo_delete_buffer = None;
            return None;
        }
        if undo_clicked {
            return match self.undo_last_delete(editor, Instant::now()) {
                Ok(msg) => Some(ModalAction::LibraryChanged(msg)),
                Err(err) => {
                    self.feedback = Some((err, true));
                    None
                }
            };
        }
        None
    }

    pub fn render_help_workspace(&mut self, ui: &mut egui::Ui) {
        render_help_body(ui);
    }

    pub fn render_corpus_workspace(
        &mut self,
        ui: &mut egui::Ui,
        editor: &mut StreamEditor,
    ) -> Option<ModalAction> {
        let mut action = self.render_recovery_banner(ui, editor);
        if let Some(undo_act) = self.render_undo_delete_banner(ui, editor) {
            action = Some(undo_act);
        }

        // 1. 顶部工具栏 Row 1: 弹性搜索框 + ✕ 清空 + [+ 新建公式] 主按钮
        ui.horizontal(|ui| {
            ui.label(RichText::new("检索:").size(12.5).color(TEXT_DIM));
            let btn_txt = if self.show_formula_form {
                "收起表单"
            } else {
                "+ 新建公式"
            };
            let has_clear = !self.preset_search.is_empty();
            let reserved_right = 95.0 + if has_clear { 55.0 } else { 0.0 };
            let search_w = (ui.available_width() - reserved_right).max(100.0);
            ui.add(
                egui::TextEdit::singleline(&mut self.preset_search)
                    .hint_text("搜索公式名称、学科分类、符号简码或说明关键词...")
                    .desired_width(search_w),
            );
            if has_clear && ui.small_button("✕ 清空").clicked() {
                self.preset_search.clear();
            }

            if ui
                .button(RichText::new(btn_txt).strong().color(GREEN))
                .clicked()
            {
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
        });

        ui.add_space(4.0);

        // 2. 顶部工具栏 Row 2: 学科分类流式胶囊与微型运维按钮组 (绝不溢出)
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

            ui.add_space(6.0);
            if ui
                .small_button(RichText::new("恢复默认").color(TEXT_DIM))
                .on_hover_text("恢复出厂预置公式（保留用户自建公式）")
                .clicked()
            {
                editor.library.formulas.restore_defaults();
                let (msg, is_err) = match self.save_library(&editor.library) {
                    Ok(_) => ("✓ 已成功恢复出厂种子公式！".to_owned(), false),
                    Err(e) => (
                        format!("✓ 已恢复出厂种子公式（本次会话生效），但写入磁盘失败: {e}"),
                        true,
                    ),
                };
                self.feedback = Some((msg, is_err));
            }

            if ui
                .small_button(RichText::new("导出 JSON").color(CYAN))
                .on_hover_text("导出全部公式包为格式化 JSON 并写入剪贴板")
                .clicked()
            {
                let json = editor.library.formulas.export_json();
                ui.ctx().copy_text(json);
                self.feedback = Some(("✓ 已导出全部公式包 JSON 到系统剪贴板！".to_owned(), false));
            }

            let imp_txt = if self.show_formula_importer {
                "关闭导入"
            } else {
                "导入 JSON"
            };
            if ui
                .small_button(RichText::new(imp_txt).color(AMBER))
                .on_hover_text("从 JSON 文本导入公式")
                .clicked()
            {
                self.show_formula_importer = !self.show_formula_importer;
            }
        });

        ui.add_space(4.0);
        ui.separator();
        ui.add_space(4.0);

        // 待确认删除操作
        let mut delete_row_action = DeleteRowAction::None;

        // 3. 滚动展示区域（表单与卡片随滚轮自然流动）
        let filtered: Vec<_> = editor
            .library
            .formulas
            .filter(Some(&self.preset_category), &self.preset_search)
            .into_iter()
            .cloned()
            .collect();

        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.set_width(ui.available_width());

                // 导入面板 (手风琴展开)
                if self.show_formula_importer {
                    egui::Frame::NONE
                        .fill(CARD)
                        .stroke(Stroke::new(1.0, AMBER.gamma_multiply(0.6)))
                        .corner_radius(CornerRadius::same(6))
                        .inner_margin(Margin::same(10))
                        .show(ui, |ui| {
                            ui.set_width(ui.available_width());
                            ui.label(
                                RichText::new("导入公式包 (JSON 数组)")
                                    .strong()
                                    .color(AMBER),
                            );
                            ui.add_space(4.0);
                            ui.add(
                                egui::TextEdit::multiline(&mut self.formula_import_text)
                                    .desired_rows(3)
                                    .desired_width(ui.available_width())
                                    .hint_text("在此粘贴导出的公式 JSON 数组文本..."),
                            );
                            ui.add_space(4.0);
                            ui.horizontal(|ui| {
                                if ui
                                    .button(
                                        RichText::new("覆盖导入 (同 ID 替换)")
                                            .strong()
                                            .color(GREEN),
                                    )
                                    .clicked()
                                {
                                    match editor
                                        .library
                                        .formulas
                                        .import_json(&self.formula_import_text, true)
                                    {
                                        Ok(cnt) => {
                                            let (msg, is_err) =
                                                match self.save_library(&editor.library) {
                                                    Ok(_) => (
                                                        format!("✓ 成功导入 {cnt} 条公式！"),
                                                        false,
                                                    ),
                                                    Err(e) => (
                                                        format!(
                                                            "✓ 已导入 {cnt} 条公式（本次会话生效），但写入磁盘失败: {e}"
                                                        ),
                                                        true,
                                                    ),
                                                };
                                            self.feedback = Some((msg, is_err));
                                            self.show_formula_importer = false;
                                            self.formula_import_text.clear();
                                        }
                                        Err(e) => {
                                            self.feedback = Some((format!("导入失败: {e}"), true));
                                        }
                                    }
                                }
                                if ui
                                    .button(RichText::new("跳过重复导入").color(CYAN))
                                    .clicked()
                                {
                                    match editor
                                        .library
                                        .formulas
                                        .import_json(&self.formula_import_text, false)
                                    {
                                        Ok(cnt) => {
                                            let (msg, is_err) =
                                                match self.save_library(&editor.library) {
                                                    Ok(_) => (
                                                        format!("✓ 成功新增导入 {cnt} 条公式！"),
                                                        false,
                                                    ),
                                                    Err(e) => (
                                                        format!(
                                                            "✓ 已新增导入 {cnt} 条公式（本次会话生效），但写入磁盘失败: {e}"
                                                        ),
                                                        true,
                                                    ),
                                                };
                                            self.feedback = Some((msg, is_err));
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
                    ui.add_space(8.0);
                }

                // 新建 / 编辑表单面板
                if self.show_formula_form {
                    let is_editing = self.formula_editing_id.is_some();
                    let title = if is_editing {
                        "编辑公式"
                    } else {
                        "新建自定义公式"
                    };
                    egui::Frame::NONE
                        .fill(CARD)
                        .stroke(Stroke::new(1.0, GREEN.gamma_multiply(0.6)))
                        .corner_radius(CornerRadius::same(6))
                        .inner_margin(Margin::same(10))
                        .show(ui, |ui| {
                            ui.set_width(ui.available_width());
                            ui.horizontal(|ui| {
                                ui.label(RichText::new(title).strong().color(GREEN));
                                if let Some(id) = &self.formula_editing_id {
                                    ui.label(
                                        RichText::new(format!("(ID: {id})"))
                                            .size(11.0)
                                            .color(MUTED),
                                    );
                                }
                            });
                            ui.add_space(6.0);

                            // 第一层（语义元信息紧凑行）
                            ui.horizontal(|ui| {
                                ui.label(RichText::new("公式名称:").size(11.5).color(TEXT_DIM));
                                ui.add(
                                    egui::TextEdit::singleline(&mut self.formula_edit_name)
                                        .desired_width(170.0)
                                        .hint_text("如：高斯消元定理"),
                                );
                                ui.add_space(6.0);
                                ui.label(RichText::new("学科分类:").size(11.5).color(TEXT_DIM));
                                ui.add(
                                    egui::TextEdit::singleline(&mut self.formula_edit_category)
                                        .desired_width(130.0)
                                        .hint_text("如：线性代数"),
                                );
                            });

                            ui.add_space(5.0);

                            // 第二层（检索标签行）
                            ui.horizontal(|ui| {
                                ui.label(RichText::new("检索标签:").size(11.5).color(TEXT_DIM));
                                ui.add(
                                    egui::TextEdit::singleline(&mut self.formula_edit_tags)
                                        .desired_width((ui.available_width() - 4.0).max(100.0))
                                        .hint_text("如：algebra matrix (空格分隔)"),
                                );
                            });

                            ui.add_space(5.0);

                            // 第三层（简码流源码通栏独占 100% 宽度）
                            ui.label(
                                RichText::new("简码流源码 (通栏):")
                                    .size(11.5)
                                    .color(TEXT_DIM),
                            );
                            ui.add_space(2.0);
                            ui.add(
                                egui::TextEdit::singleline(&mut self.formula_edit_source)
                                    .font(FontId::monospace(13.0))
                                    .desired_width(ui.available_width())
                                    .hint_text("如：▸f a;b; = c"),
                            );

                            ui.add_space(5.0);

                            // 第四层（学术说明）
                            ui.label(RichText::new("学术说明:").size(11.5).color(TEXT_DIM));
                            ui.add_space(2.0);
                            ui.add(
                                egui::TextEdit::singleline(&mut self.formula_edit_desc)
                                    .desired_width(ui.available_width())
                                    .hint_text("公式背景、数学原理或工程用途简述"),
                            );

                            ui.add_space(6.0);

                            // 第五层（紧凑就近操作按钮组：左侧对齐，杜绝远隔千山万水）
                            ui.horizontal(|ui| {
                                ui.spacing_mut().item_spacing.x = 8.0;
                                if ui
                                    .button(RichText::new("✓ 保存公式").strong().color(GREEN))
                                    .clicked()
                                {
                                    let tags: Vec<String> = self
                                        .formula_edit_tags
                                        .split(|c: char| c == ',' || c == '，' || c.is_whitespace())
                                        .map(str::trim)
                                        .filter(|s| !s.is_empty())
                                        .map(str::to_owned)
                                        .collect();
                                    let id = self.formula_editing_id.clone().unwrap_or_default();
                                    let is_builtin = self
                                        .formula_editing_id
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
                                        created_at: std::time::SystemTime::now()
                                            .duration_since(std::time::UNIX_EPOCH)
                                            .unwrap_or_default()
                                            .as_secs(),
                                    };
                                    match editor.library.formulas.upsert(entry) {
                                        Ok(_) => {
                                            let (msg, is_err) =
                                                match self.save_library(&editor.library) {
                                                    Ok(_) => ("✓ 公式已成功保存！".to_owned(), false),
                                                    Err(e) => (
                                                        format!(
                                                            "✓ 公式已更新（本次会话生效），但写入磁盘失败: {e}"
                                                        ),
                                                        true,
                                                    ),
                                                };
                                            self.feedback = Some((msg, is_err));
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
                    ui.add_space(8.0);
                }

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

                // 双层流式公式卡片：顶层为名称与核心高频动作；底层为简码流与次级动作
                for formula in filtered {
                    egui::Frame::NONE
                        .fill(CARD)
                        .corner_radius(CornerRadius::same(6))
                        .stroke(Stroke::new(1.0, CARD_BORDER))
                        .inner_margin(Margin::same(10))
                        .show(ui, |ui| {
                            ui.set_width(ui.available_width());
                            // 顶层：学科徽章、名称（自适应截断）与核心高频动作（✓ 载入、+ 追加）
                            ui.horizontal(|ui| {
                                ui.label(
                                    RichText::new(format!("[{}]", formula.category))
                                        .size(11.0)
                                        .color(CYAN),
                                );
                                if !formula.is_builtin {
                                    ui.label(RichText::new("[自建]").size(10.5).color(AMBER));
                                }
                                let act_w = 115.0;
                                let title_w = (ui.available_width() - act_w).max(40.0);
                                ui.add_sized(
                                    Vec2::new(title_w, 18.0),
                                    egui::Label::new(
                                        RichText::new(&formula.name)
                                            .strong()
                                            .size(13.0)
                                            .color(TEXT),
                                    )
                                    .truncate(),
                                )
                                .on_hover_text(&formula.name);

                                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                    ui.spacing_mut().item_spacing.x = 4.0;
                                    if ui
                                        .small_button(RichText::new("✓ 载入").strong().color(GREEN))
                                        .on_hover_text(
                                            "载入公式并替换当前输入栏内容（左侧实时预览）",
                                        )
                                        .clicked()
                                    {
                                        action =
                                            Some(ModalAction::ReplaceCode(formula.source.clone()));
                                        self.feedback = Some((
                                            format!("✓ 已载入 [{}] 到编辑器！", formula.name),
                                            false,
                                        ));
                                    }

                                    if ui
                                        .small_button(RichText::new("+ 追加").color(ACCENT))
                                        .on_hover_text("在当前光标处追加此公式")
                                        .clicked()
                                    {
                                        action =
                                            Some(ModalAction::InsertCode(formula.source.clone()));
                                        self.feedback = Some((
                                            format!("✓ 已追加 [{}] 到当前光标！", formula.name),
                                            false,
                                        ));
                                    }
                                });
                            });

                            // 中间层：学科背景或数学说明与标签
                            if !formula.desc.is_empty() || !formula.tags.is_empty() {
                                ui.add_space(2.0);
                                ui.horizontal_wrapped(|ui| {
                                    if !formula.desc.is_empty() {
                                        ui.label(
                                            RichText::new(&formula.desc).size(11.5).color(MUTED),
                                        );
                                    }
                                    for tag in &formula.tags {
                                        ui.label(
                                            RichText::new(format!("#{tag}"))
                                                .size(10.5)
                                                .color(TEXT_DIM),
                                        );
                                    }
                                });
                            }

                            ui.add_space(4.0);

                            // 底层：流式简码预览（自适应截断）与次级动作（复制 LaTeX、编辑、删除）
                            let is_pending_delete = self.pending_delete.as_ref()
                                == Some(&PendingDeleteTarget::Formula(formula.id.clone()));
                            ui.horizontal(|ui| {
                                ui.label(RichText::new("简码:").size(11.0).color(AMBER));
                                let btns_w = if formula.is_builtin {
                                    100.0
                                } else if is_pending_delete {
                                    200.0
                                } else {
                                    145.0
                                };
                                let code_w = (ui.available_width() - btns_w).max(40.0);
                                ui.add_sized(
                                    Vec2::new(code_w, 18.0),
                                    egui::Label::new(
                                        RichText::new(&formula.source)
                                            .monospace()
                                            .size(11.5)
                                            .color(CYAN),
                                    )
                                    .truncate(),
                                )
                                .on_hover_text(&formula.source);

                                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                                    ui.spacing_mut().item_spacing.x = 4.0;
                                    if !formula.is_builtin {
                                        let row_act = render_delete_row_buttons(
                                            ui,
                                            is_pending_delete,
                                            PendingDeleteTarget::Formula(formula.id.clone()),
                                        );
                                        if !matches!(row_act, DeleteRowAction::None) {
                                            delete_row_action = row_act;
                                        }
                                    }

                                    if ui.small_button(RichText::new("编辑").color(CYAN)).clicked()
                                    {
                                        self.formula_editing_id = Some(formula.id.clone());
                                        self.formula_edit_name = formula.name.clone();
                                        self.formula_edit_category = formula.category.clone();
                                        self.formula_edit_source = formula.source.clone();
                                        self.formula_edit_desc = formula.desc.clone();
                                        self.formula_edit_tags = formula.tags.join(" ");
                                        self.show_formula_form = true;
                                    }

                                    if ui
                                        .small_button(RichText::new("复制 LaTeX").color(TEXT_DIM))
                                        .clicked()
                                    {
                                        let parsed = mathslot_core::parser::parse_with_library(
                                            &formula.source,
                                            &editor.library,
                                        );
                                        let latex = mathslot_core::latex::to_latex(&parsed);
                                        ui.ctx().copy_text(latex);
                                        self.feedback = Some((
                                            format!(
                                                "✓ 已复制 [{}] 的标准 LaTeX 至剪贴板！",
                                                formula.name
                                            ),
                                            false,
                                        ));
                                    }
                                });
                            });
                        });

                    ui.add_space(4.0);
                }
            });

        if let Some(del_act) = self.apply_delete_row_action(editor, delete_row_action) {
            action = Some(del_act);
        }

        action
    }

    pub fn render_formats_workspace(
        &mut self,
        ui: &mut egui::Ui,
        editor: &mut StreamEditor,
    ) -> Option<ModalAction> {
        let mut action = self.render_recovery_banner(ui, editor);
        if let Some(undo_act) = self.render_undo_delete_banner(ui, editor) {
            action = Some(undo_act);
        }
        let mut reset_defaults = false;

        let tab_titles = [
            format!(
                "k{} 自定义格式 ({})",
                CMD_PREFIX,
                editor.library.custom_formats.len()
            ),
            format!(
                "t{} 片段模版 ({})",
                CMD_PREFIX,
                editor.library.snippets.len()
            ),
        ];
        let tabs = [LibraryTab::CustomFormats, LibraryTab::Snippets];
        let options: Vec<(&str, &str)> = vec![
            (tab_titles[0].as_str(), "以 $1, $2 槽位定义自定义宏 (Tab k)"),
            (tab_titles[1].as_str(), "常用公式片段与填空模版 (Tab t)"),
        ];
        let selected = if self.tab == LibraryTab::Snippets {
            1
        } else {
            0
        };
        if let Some(idx) = segmented(ui, &options, selected) {
            self.tab = tabs[idx];
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
            let (msg, is_err) = match self.save_library(&editor.library) {
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
                .fill(if *is_err {
                    RED.gamma_multiply(0.12)
                } else {
                    GREEN_BG
                })
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
            LibraryTab::Snippets => {
                if let Some(act) = self.render_snippets_tab(ui, editor) {
                    action = Some(act);
                }
            }
            _ => {
                if let Some(act) = self.render_custom_tab(ui, editor) {
                    action = Some(act);
                }
            }
        }

        action
    }

    pub fn render_latex_workspace(
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
                (
                    "高斯积分",
                    r"\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}",
                ),
                ("重要极限", r"\lim_{x \to 0} \frac{\sin x}{x} = 1"),
                ("贝叶斯", r"P(A|B) = \frac{P(B|A) P(A)}{P(B)}"),
                (
                    "薛定谔",
                    r"i\hbar \frac{\partial \psi}{\partial t} = \hat{H}\psi",
                ),
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
                ui.set_width(ui.available_width());
                // 上半部：LaTeX 输入
                ui.horizontal(|ui| {
                    ui.label(
                        RichText::new("LaTeX 源代码")
                            .size(12.0)
                            .strong()
                            .color(ACCENT),
                    );
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
                    ui.label(
                        RichText::new("MathSlot 简码流")
                            .size(12.0)
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
                            RichText::new(&verified_latex)
                                .monospace()
                                .size(11.0)
                                .color(TEXT_DIM),
                        )
                        .truncate(),
                    )
                    .on_hover_text(&verified_latex);
                });

                ui.add_space(6.0);
                if let Some(report) = &self.latex_import_report {
                    render_import_report_panel(ui, &self.latex_input, report);
                }

                let apply_gate = can_apply_latex_import(
                    &self.latex_converted_mathslot,
                    self.latex_import_report.as_ref(),
                );

                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    let replace_hover = match &apply_gate {
                        Ok(()) => "用反编译简码流覆盖当前编辑器",
                        Err(reason) => reason.as_str(),
                    };
                    if ui
                        .add_enabled(
                            apply_gate.is_ok(),
                            egui::Button::new(
                                RichText::new("✓ 替换当前编辑器内容").strong().color(GREEN),
                            ),
                        )
                        .on_hover_text(replace_hover)
                        .clicked()
                        && apply_gate.is_ok()
                    {
                        action = Some(ModalAction::ReplaceCode(
                            self.latex_converted_mathslot.clone(),
                        ));
                        self.feedback =
                            Some(("✓ 已替换当前编辑器内容为反编译简码流！".to_owned(), false));
                    }

                    let insert_hover = match &apply_gate {
                        Ok(()) => "追加到当前光标位置",
                        Err(reason) => reason.as_str(),
                    };
                    if ui
                        .add_enabled(
                            apply_gate.is_ok(),
                            egui::Button::new(RichText::new("+ 插入到当前光标处").color(ACCENT)),
                        )
                        .on_hover_text(insert_hover)
                        .clicked()
                        && apply_gate.is_ok()
                    {
                        action = Some(ModalAction::InsertCode(
                            self.latex_converted_mathslot.clone(),
                        ));
                        self.feedback =
                            Some(("✓ 已将反编译简码流插入到当前光标处！".to_owned(), false));
                    }
                });
                if let Err(reason) = &apply_gate {
                    ui.add_space(4.0);
                    ui.label(RichText::new(format!("⛔ {reason}")).size(11.5).color(RED));
                }
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
        let mut delete_row_action = DeleteRowAction::None;
        let mut insert_code: Option<String> = None;

        // 顶栏操作：新建展开与快捷微文案
        ui.horizontal(|ui| {
            let btn_txt = if self.show_custom_form {
                "收起表单"
            } else {
                "+ 新建自定义格式"
            };
            if ui
                .button(
                    RichText::new(btn_txt)
                        .strong()
                        .color(if self.show_custom_form {
                            TEXT_DIM
                        } else {
                            GREEN
                        }),
                )
                .clicked()
            {
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

        ui.add_space(6.0);

        egui::ScrollArea::vertical()
            .id_salt("mathslot-custom-list-scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.set_width(ui.available_width());

                // 置顶紧凑内敛表单（随滚轮自然流动，杜绝垂直截断）
                if self.show_custom_form {
                    egui::Frame::NONE
                        .fill(CARD)
                        .stroke(Stroke::new(1.0, CARD_BORDER))
                        .corner_radius(CornerRadius::same(8))
                        .inner_margin(Margin::same(10))
                        .show(ui, |ui| {
                            ui.set_width(ui.available_width());
                            ui.label(
                                RichText::new("新建 / 编辑自定义格式")
                                    .size(12.0)
                                    .strong()
                                    .color(AMBER),
                            );
                            ui.add_space(5.0);

                            // 第一层（语义元信息）
                            ui.horizontal(|ui| {
                                ui.label(RichText::new("按键:").size(11.5).color(TEXT_DIM));
                                ui.add(
                                    egui::TextEdit::singleline(&mut self.custom_key)
                                        .font(FontId::monospace(12.5))
                                        .desired_width(48.0)
                                        .hint_text("g"),
                                );

                                ui.add_space(6.0);
                                ui.label(RichText::new("格式名称:").size(11.5).color(TEXT_DIM));
                                ui.add(
                                    egui::TextEdit::singleline(&mut self.custom_label)
                                        .desired_width(170.0)
                                        .hint_text("如：同余式 / 期望"),
                                );

                                ui.add_space(6.0);
                                ui.label(RichText::new("缩略提示:").size(11.5).color(TEXT_DIM));
                                ui.add(
                                    egui::TextEdit::singleline(&mut self.custom_glyph)
                                        .font(FontId::monospace(12.5))
                                        .desired_width(96.0)
                                        .hint_text("如 a≡b(m)"),
                                );
                            });

                            ui.add_space(5.0);

                            // 第二层（槽位角色）
                            ui.horizontal(|ui| {
                                ui.label(RichText::new("槽位角色:").size(11.5).color(TEXT_DIM));
                                let roles_w = (ui.available_width() - 4.0).max(80.0);
                                ui.add(
                                    egui::TextEdit::singleline(&mut self.custom_roles)
                                        .desired_width(roles_w)
                                        .hint_text("左项;右项;模数 ($1, $2...)"),
                                );
                            });

                            ui.add_space(5.0);

                            // 第三层（通栏核心载荷）
                            ui.label(RichText::new("LaTeX 模板:").size(11.5).color(TEXT_DIM));
                            ui.add_space(2.0);
                            ui.add(
                                egui::TextEdit::singleline(&mut self.custom_latex)
                                    .font(FontId::monospace(13.0))
                                    .desired_width(ui.available_width())
                                    .hint_text(r"$1 \equiv $2 \pmod{$3}"),
                            );

                            ui.add_space(6.0);

                            // 第四层（紧凑内敛操作栏：左侧就近对齐，杜绝远隔千山万水）
                            ui.horizontal(|ui| {
                                ui.spacing_mut().item_spacing.x = 8.0;
                                if ui
                                    .button(RichText::new("✓ 保存格式").strong().color(GREEN))
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
                                            let (msg, is_err) = match self.save_library(&editor.library) {
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
                    ui.add_space(8.0);
                }

                ui.label(
                    RichText::new("已注册自定义格式列表")
                        .size(12.0)
                        .strong()
                        .color(TEXT),
                );
                ui.add_space(4.0);

                for fmt in &editor.library.custom_formats {
                    let is_pending_delete = self.pending_delete.as_ref()
                        == Some(&PendingDeleteTarget::CustomFormat(fmt.item_key));
                    egui::Frame::NONE
                        .fill(BG)
                        .stroke(Stroke::new(1.0, CARD_BORDER))
                        .corner_radius(CornerRadius::same(8))
                        .inner_margin(Margin::symmetric(10, 7))
                        .show(ui, |ui| {
                            ui.set_width(ui.available_width());
                            let total_w = ui.available_width();
                            let left_w = (total_w - 144.0).max(120.0);
                            ui.horizontal(|ui| {
                                ui.allocate_ui_with_layout(
                                    Vec2::new(left_w, 0.0),
                                    Layout::left_to_right(Align::Center),
                                    |ui| {
                                        ui.set_width(left_w);
                                        ui.set_max_width(left_w);
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
                                    },
                                );

                                ui.allocate_ui_with_layout(
                                    Vec2::new(136.0, 0.0),
                                    Layout::right_to_left(Align::Center),
                                    |ui| {
                                        ui.set_width(136.0);
                                        if !is_pending_delete
                                            && ui
                                                .small_button(RichText::new("删除").color(RED))
                                                .clicked()
                                        {
                                            delete_row_action = DeleteRowAction::Request(
                                                PendingDeleteTarget::CustomFormat(fmt.item_key),
                                            );
                                        } else if is_pending_delete
                                            && ui
                                                .small_button(RichText::new("取消").color(TEXT_DIM))
                                                .clicked()
                                        {
                                            delete_row_action = DeleteRowAction::Cancel;
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
                                    },
                                );
                            });
                            if is_pending_delete {
                                let confirm_act = render_pending_delete_confirm_bar(
                                    ui,
                                    &format!("自定义格式 `k{}` ({})", fmt.item_key, fmt.label),
                                );
                                if !matches!(confirm_act, DeleteRowAction::None) {
                                    delete_row_action = confirm_act;
                                }
                            }
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
            self.feedback = Some((
                "已载入表单，修改后点「保存格式」即可覆盖。".to_owned(),
                false,
            ));
        }

        if let Some(del_act) = self.apply_delete_row_action(editor, delete_row_action) {
            action = Some(del_act);
        }

        if let Some(code) = insert_code {
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
        let mut delete_row_action = DeleteRowAction::None;
        let mut insert_code: Option<String> = None;

        // 顶部操作栏
        ui.horizontal(|ui| {
            let btn_txt = if self.show_snippet_form {
                "收起表单"
            } else {
                "+ 新建片段模版"
            };
            if ui
                .button(
                    RichText::new(btn_txt)
                        .strong()
                        .color(if self.show_snippet_form {
                            TEXT_DIM
                        } else {
                            GREEN
                        }),
                )
                .clicked()
            {
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
            ui.label(RichText::new("按 Tab t 快速展开").size(11.0).color(MUTED));
        });

        ui.add_space(6.0);

        egui::ScrollArea::vertical()
            .id_salt("mathslot-snippet-list-scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.set_width(ui.available_width());

                // 置顶紧凑内敛表单（随滚轮自然流动，杜绝垂直截断）
                if self.show_snippet_form {
                    egui::Frame::NONE
                        .fill(CARD)
                        .stroke(Stroke::new(1.0, CARD_BORDER))
                        .corner_radius(CornerRadius::same(8))
                        .inner_margin(Margin::same(10))
                        .show(ui, |ui| {
                            ui.set_width(ui.available_width());
                            // 顶部：标题 + 右侧 [填入当前公式] 小按钮
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
                            ui.add_space(5.0);

                            // 第一层（元信息）
                            ui.horizontal(|ui| {
                                ui.label(RichText::new("触发字母:").size(11.5).color(TEXT_DIM));
                                ui.add(
                                    egui::TextEdit::singleline(&mut self.snip_key)
                                        .font(FontId::monospace(12.5))
                                        .desired_width(48.0)
                                        .hint_text("d"),
                                );

                                ui.add_space(8.0);
                                ui.label(RichText::new("模版名称:").size(11.5).color(TEXT_DIM));
                                ui.add(
                                    egui::TextEdit::singleline(&mut self.snip_label)
                                        .desired_width(220.0)
                                        .hint_text("如：高斯核 / 泰勒余项"),
                                );
                            });

                            ui.add_space(6.0);

                            // 第二层（通栏核心载荷）
                            ui.label(RichText::new("简码流源码:").size(11.5).color(TEXT_DIM));
                            ui.add_space(2.0);
                            ui.add(
                                egui::TextEdit::singleline(&mut self.snip_source)
                                    .font(FontId::monospace(12.5))
                                    .desired_width(ui.available_width())
                            .hint_text("如 ▸rb^2 - 4ac;"),
                            );

                            ui.add_space(6.0);

                            // 第三层（紧凑内敛操作栏：左侧就近对齐，杜绝远隔千山万水）
                            ui.horizontal(|ui| {
                                ui.spacing_mut().item_spacing.x = 8.0;
                                if ui
                                    .button(RichText::new("✓ 保存片段").strong().color(GREEN))
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
                                            let (msg, is_err) = match self.save_library(&editor.library) {
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
                    ui.add_space(8.0);
                }

                ui.label(
                    RichText::new("已保存片段与填空模版")
                        .size(12.0)
                        .strong()
                        .color(TEXT),
                );
                ui.add_space(4.0);

                for snip in &editor.library.snippets {
                    let is_pending_delete = self.pending_delete.as_ref()
                        == Some(&PendingDeleteTarget::Snippet(snip.item_key));
                    egui::Frame::NONE
                        .fill(BG)
                        .stroke(Stroke::new(1.0, CARD_BORDER))
                        .corner_radius(CornerRadius::same(8))
                        .inner_margin(Margin::symmetric(10, 7))
                        .show(ui, |ui| {
                            ui.set_width(ui.available_width());
                            let total_w = ui.available_width();
                            let left_w = (total_w - 144.0).max(120.0);
                            ui.horizontal(|ui| {
                                ui.allocate_ui_with_layout(
                                    Vec2::new(left_w, 0.0),
                                    Layout::left_to_right(Align::Center),
                                    |ui| {
                                        ui.set_width(left_w);
                                        ui.set_max_width(left_w);
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
                                    },
                                );

                                ui.allocate_ui_with_layout(
                                    Vec2::new(136.0, 0.0),
                                    Layout::right_to_left(Align::Center),
                                    |ui| {
                                        ui.set_width(136.0);
                                        if !is_pending_delete
                                            && ui
                                                .small_button(RichText::new("删除").color(RED))
                                                .clicked()
                                        {
                                            delete_row_action = DeleteRowAction::Request(
                                                PendingDeleteTarget::Snippet(snip.item_key),
                                            );
                                        } else if is_pending_delete
                                            && ui
                                                .small_button(RichText::new("取消").color(TEXT_DIM))
                                                .clicked()
                                        {
                                            delete_row_action = DeleteRowAction::Cancel;
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
                                    },
                                );
                            });
                            if is_pending_delete {
                                let confirm_act = render_pending_delete_confirm_bar(
                                    ui,
                                    &format!("片段 `t{}` ({})", snip.item_key, snip.label),
                                );
                                if !matches!(confirm_act, DeleteRowAction::None) {
                                    delete_row_action = confirm_act;
                                }
                            }
                        });
                    ui.add_space(3.0);
                }
            });

        if let Some(snip) = edit_snip {
            self.snip_key = snip.item_key.to_string();
            self.snip_label = snip.label;
            self.snip_source = snip.stream_source;
            self.show_snippet_form = true;
            self.feedback = Some((
                "已载入片段表单，修改后点「保存片段」即可更新。".to_owned(),
                false,
            ));
        }

        if let Some(del_act) = self.apply_delete_row_action(editor, delete_row_action) {
            action = Some(del_act);
        }

        if let Some(code) = insert_code {
            action = Some(ModalAction::InsertCode(code));
        }

        action
    }
}

fn render_pending_delete_confirm_bar(ui: &mut egui::Ui, label: &str) -> DeleteRowAction {
    let mut act = DeleteRowAction::None;
    ui.add_space(4.0);
    ui.horizontal(|ui| {
        ui.label(
            RichText::new(format!("⚠ 确认删除 {label}？"))
                .size(11.5)
                .color(RED),
        );
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if ui
                .small_button(RichText::new("取消").color(TEXT_DIM))
                .clicked()
            {
                act = DeleteRowAction::Cancel;
            }
            if ui
                .small_button(RichText::new("确认删除").strong().color(RED))
                .clicked()
            {
                act = DeleteRowAction::Confirm;
            }
        });
    });
    act
}

fn render_delete_row_buttons(
    ui: &mut egui::Ui,
    is_pending: bool,
    target: PendingDeleteTarget,
) -> DeleteRowAction {
    if is_pending {
        if ui
            .small_button(RichText::new("确认删除").strong().color(RED))
            .clicked()
        {
            return DeleteRowAction::Confirm;
        }
        if ui
            .small_button(RichText::new("取消").color(TEXT_DIM))
            .clicked()
        {
            return DeleteRowAction::Cancel;
        }
    } else if ui.small_button(RichText::new("删除").color(RED)).clicked() {
        return DeleteRowAction::Request(target);
    }
    DeleteRowAction::None
}

fn render_import_report_panel(ui: &mut egui::Ui, input: &str, report: &ImportReport) {
    let is_err = report.has_errors();
    let is_warn = !is_err
        && (!report.is_lossless()
            || report.raw_nodes > 0
            || !report.normalized_match
            || report.has_warnings());
    let (bg, border, title_color, title) = if is_err {
        (
            RED.gamma_multiply(0.12),
            RED.gamma_multiply(0.45),
            RED,
            "⛔ LaTeX 导入诊断：发现语法错误",
        )
    } else if is_warn {
        (
            AMBER.gamma_multiply(0.12),
            AMBER.gamma_multiply(0.45),
            AMBER,
            "⚠ LaTeX 导入诊断：存在有损降级或结构差异",
        )
    } else {
        (
            GREEN_BG,
            GREEN.gamma_multiply(0.4),
            GREEN,
            "✓ LaTeX 导入诊断：100% 无损解析",
        )
    };

    egui::Frame::NONE
        .fill(bg)
        .stroke(Stroke::new(1.0, border))
        .corner_radius(CornerRadius::same(7))
        .inner_margin(Margin::symmetric(10, 6))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.horizontal_wrapped(|ui| {
                ui.label(RichText::new(title).size(11.5).strong().color(title_color));
                ui.label(
                    RichText::new(format!(
                        "lossless={} · raw_nodes={} · empty_slots={} · normalized_match={}",
                        report.lossless,
                        report.raw_nodes,
                        report.empty_slots,
                        report.normalized_match
                    ))
                    .size(11.0)
                    .color(TEXT_DIM),
                );
            });
            for diag in report.diagnostics.iter().take(4) {
                let kind_label = if diag.is_error() { "错误" } else { "警告" };
                let color = if diag.is_error() { RED } else { AMBER };
                ui.label(
                    RichText::new(format!(
                        "• [{kind_label} {}..{}] {}",
                        diag.span.start, diag.span.end, diag.kind
                    ))
                    .size(11.0)
                    .color(color),
                );
            }
            if is_warn && (!report.normalized_match || report.raw_nodes > 0) {
                ui.add_space(2.0);
                ui.label(
                    RichText::new(format!("输入原文: {}", input.trim()))
                        .monospace()
                        .size(10.5)
                        .color(MUTED),
                );
                ui.label(
                    RichText::new(format!("规范回环 (roundtrip): {}", report.roundtrip_latex))
                        .monospace()
                        .size(10.5)
                        .color(TEXT_DIM),
                );
            }
        });
}

fn render_help_body(ui: &mut egui::Ui) {
    egui::ScrollArea::vertical()
        .id_salt("mathslot-help-scroll")
        .auto_shrink([false, false])
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
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
    mathslot_store::default_library_path()
}

#[derive(Clone, Debug, Default)]
pub struct LibraryPersistenceSession {
    pub path: Option<PathBuf>,
    pub revision: Option<mathslot_store::FileRevision>,
    pub quarantined_corrupt_path: Option<PathBuf>,
    pub recovery_backup_path: Option<PathBuf>,
    pub recovery_backup_library: Option<UserLibrary>,
    pub load_error: Option<String>,
}

impl LibraryPersistenceSession {
    pub fn is_blocked(&self) -> bool {
        self.quarantined_corrupt_path.is_some() || self.load_error.is_some()
    }
}

pub fn load_library_from_path(
    path: &std::path::Path,
) -> (UserLibrary, String, LibraryPersistenceSession) {
    let display = path.display().to_string();
    let catalog = mathslot_store::Catalog::builtin();
    let mut session = LibraryPersistenceSession {
        path: Some(path.to_path_buf()),
        ..Default::default()
    };

    match mathslot_store::load_or_recover_with_catalog(path, catalog) {
        Ok(mathslot_store::LoadOutcome::NotFound { file }) => {
            (file.to_user_library(catalog), display, session)
        }
        Ok(mathslot_store::LoadOutcome::Loaded {
            file,
            revision,
            migrated,
        }) => {
            session.revision = Some(revision);
            let hint = if let Some(rep) = migrated {
                format!(
                    "{display}（已从 v{} 无损迁移至 v{}）",
                    rep.from_version, rep.to_version
                )
            } else {
                display
            };
            (file.to_user_library(catalog), hint, session)
        }
        Ok(mathslot_store::LoadOutcome::CorruptQuarantined {
            corrupt_path,
            backup_candidate,
            error,
        }) => {
            let msg = format!("配置文件损坏并已隔离至 {}：{error}", corrupt_path.display());
            session.quarantined_corrupt_path = Some(corrupt_path);
            session.recovery_backup_path = backup_candidate.as_ref().map(|b| b.path.clone());
            session.recovery_backup_library =
                backup_candidate.map(|b| b.file.to_user_library(catalog));
            session.load_error = Some(msg.clone());
            let clean_view = mathslot_store::LibraryFile::empty_v3().to_user_library(catalog);
            (clean_view, msg, session)
        }
        Err(err) => {
            let msg = format!("读取配置文件失败（{display}）：{err}");
            session.load_error = Some(msg.clone());
            let clean_view = mathslot_store::LibraryFile::empty_v3().to_user_library(catalog);
            (clean_view, msg, session)
        }
    }
}

pub fn save_library_to_path(
    lib: &UserLibrary,
    path: &std::path::Path,
    session: &mut LibraryPersistenceSession,
) -> Result<String, String> {
    if session.is_blocked() {
        return Err(
            "配置文件处于损坏隔离或读取错误状态，已阻止覆盖保存；请先在恢复向导中确认恢复或重置。"
                .to_owned(),
        );
    }
    let catalog = mathslot_store::Catalog::builtin();
    let file = mathslot_store::LibraryFile::from_user_library(lib, catalog);
    let new_rev = mathslot_store::save_atomic(
        path,
        &file,
        mathslot_store::WriteCondition::IfUnmodified(session.revision.clone()),
    )
    .map_err(|e| e.to_string())?;
    session.revision = Some(new_rev);
    Ok(path.display().to_string())
}

pub fn load_library_from_disk() -> (UserLibrary, String, LibraryPersistenceSession) {
    let Some(path) = library_config_path() else {
        return (
            UserLibrary::default_seeded(),
            "内存模式".to_owned(),
            LibraryPersistenceSession::default(),
        );
    };
    load_library_from_path(&path)
}

#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use mathslot_app::{
    App, AppEvent, AppSettings, DelimiterStyle, DispatchResponse, Effect, EngineSnapshot,
    HostAction, RecoveryStateSnapshot, RenderBackendPreference, ShortcutSettings, ThemePreference,
};
use mathslot_core::library::FormulaEntry;
use mathslot_render::{
    BackendKind, ErrorSummary, Generation, GenerationTracker, LatexRustSvgBackend, MathRenderer,
    RenderData, RenderFormat, RenderMode, RenderPipeline, RenderRequest, Theme as RenderTheme,
};
use mathslot_store::{
    Catalog, LoadOutcome, RenderBackendPreference as StoreRenderBackend, Settings as StoreSettings,
    ShortcutSettings as StoreShortcutSettings, Store, ThemePreference as StoreThemePreference,
    UserLibrary, default_library_path, next_uuid_v7,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub trait ClipboardPort: Send + Sync {
    fn write_text(&self, text: &str) -> Result<(), String>;
}

#[derive(Debug, Default)]
pub struct SystemClipboard;

impl ClipboardPort for SystemClipboard {
    fn write_text(&self, text: &str) -> Result<(), String> {
        let mut board =
            arboard::Clipboard::new().map_err(|e| format!("无法访问系统剪贴板: {e}"))?;
        board
            .set_text(text.to_owned())
            .map_err(|e| format!("写入系统剪贴板失败: {e}"))
    }
}

#[derive(Debug, Error)]
pub enum DesktopError {
    #[error("无法解析默认配置路径: {0}")]
    ConfigPath(String),
    #[error("配置存储错误: {0}")]
    Store(String),
    #[error("状态锁异常: {0}")]
    Lock(String),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderSvgRequestDto {
    #[serde(default)]
    pub generation: u64,
    pub latex: String,
    #[serde(default)]
    pub preview_latex: Option<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub scale: Option<f32>,
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDiagnosticDto {
    pub code: String,
    pub severity: String,
    pub summary: String,
    pub message: String,
    pub source_excerpt: String,
    pub truncated: bool,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresetDto {
    pub id: String,
    pub legacy_id: String,
    pub name: String,
    pub category: String,
    pub source: String,
    pub desc: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormulaEntryDto {
    pub id: String,
    pub name: String,
    pub category: String,
    pub source: String,
    pub desc: String,
    pub tags: Vec<String>,
    pub is_builtin: bool,
    pub created_at: u64,
}

impl From<&FormulaEntry> for FormulaEntryDto {
    fn from(entry: &FormulaEntry) -> Self {
        Self {
            id: entry.id.clone(),
            name: entry.name.clone(),
            category: entry.category.clone(),
            source: entry.source.clone(),
            desc: entry.desc.clone(),
            tags: entry.tags.clone(),
            is_builtin: entry.is_builtin,
            created_at: entry.created_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexRustInvokeResultDto {
    pub svg: String,
    pub degraded: bool,
    pub diagnostics: Vec<PreviewDiagnosticDto>,
}

#[must_use]
pub fn store_settings_to_app_settings(
    settings: &StoreSettings,
    config_path: Option<String>,
) -> AppSettings {
    let theme = match settings.theme {
        StoreThemePreference::System => ThemePreference::System,
        StoreThemePreference::Light => ThemePreference::Light,
        StoreThemePreference::Dark => ThemePreference::Dark,
    };
    let delimiter_style = match settings.canonical_delimiter_style() {
        "inline_dollar" => DelimiterStyle::InlineDollar,
        "block_dollar" => DelimiterStyle::BlockDollar,
        "markdown_code" | "code_fence" => DelimiterStyle::CodeFence,
        _ => DelimiterStyle::None,
    };
    let render_backend = match settings.render_backend {
        StoreRenderBackend::MathJax => RenderBackendPreference::MathJax,
        StoreRenderBackend::LatexRust => RenderBackendPreference::LatexRust,
    };
    let shortcuts = ShortcutSettings {
        nav_next_slot: settings.shortcuts.nav_next_slot.clone(),
        nav_prev_slot: settings.shortcuts.nav_prev_slot.clone(),
        nav_parent: settings.shortcuts.nav_parent.clone(),
        nav_first_child: settings.shortcuts.nav_first_child.clone(),
        copy_latex: settings.shortcuts.copy_latex.clone(),
        save_snippet: settings.shortcuts.save_snippet.clone(),
        focus_editor: settings.shortcuts.focus_editor.clone(),
        toggle_nav: settings.shortcuts.toggle_nav.clone(),
        open_settings: settings.shortcuts.open_settings.clone(),
    };
    AppSettings {
        theme,
        delimiter_style,
        render_backend,
        shortcuts,
        config_path,
        preview_scale_pct: settings.preview_scale_pct,
    }
}

#[must_use]
pub fn app_settings_to_store_settings(settings: &AppSettings) -> StoreSettings {
    let theme = match settings.theme {
        ThemePreference::System => StoreThemePreference::System,
        ThemePreference::Light => StoreThemePreference::Light,
        ThemePreference::Dark => StoreThemePreference::Dark,
    };
    let render_backend = match settings.render_backend {
        RenderBackendPreference::MathJax => StoreRenderBackend::MathJax,
        RenderBackendPreference::LatexRust => StoreRenderBackend::LatexRust,
    };
    let mut store_settings = StoreSettings {
        delimiter_style: None,
        preview_scale_pct: settings.preview_scale_pct,
        theme,
        render_backend,
        shortcuts: StoreShortcutSettings {
            nav_next_slot: settings.shortcuts.nav_next_slot.clone(),
            nav_prev_slot: settings.shortcuts.nav_prev_slot.clone(),
            nav_parent: settings.shortcuts.nav_parent.clone(),
            nav_first_child: settings.shortcuts.nav_first_child.clone(),
            copy_latex: settings.shortcuts.copy_latex.clone(),
            save_snippet: settings.shortcuts.save_snippet.clone(),
            focus_editor: settings.shortcuts.focus_editor.clone(),
            toggle_nav: settings.shortcuts.toggle_nav.clone(),
            open_settings: settings.shortcuts.open_settings.clone(),
        },
    };
    let delimiter_key = match settings.delimiter_style {
        DelimiterStyle::None => "none",
        DelimiterStyle::InlineDollar => "inline_dollar",
        DelimiterStyle::BlockDollar => "block_dollar",
        DelimiterStyle::CodeFence => "code_fence",
    };
    store_settings.set_delimiter_style(delimiter_key);
    store_settings
}

pub struct DesktopBackend {
    app: Mutex<App>,
    store: Mutex<Store>,
    library: Mutex<UserLibrary>,
    pipeline: RenderPipeline,
    clipboard: Arc<dyn ClipboardPort>,
    render_seq: Mutex<u64>,
}

impl DesktopBackend {
    pub fn initialize_with_path(
        library_path: PathBuf,
        clipboard: Arc<dyn ClipboardPort>,
    ) -> Result<Self, DesktopError> {
        let catalog = Catalog::builtin();
        let config_path_str = library_path.display().to_string();
        let mut store = Store::new(library_path);
        let outcome = store
            .load(catalog)
            .map_err(|e| DesktopError::Store(e.to_string()))?;

        let mut app = App::new();
        let mut library = UserLibrary::default();

        match outcome {
            LoadOutcome::NotFound { file } => {
                library = file.to_user_library(catalog);
                let app_settings =
                    store_settings_to_app_settings(&file.settings, Some(config_path_str));
                app.dispatch(AppEvent::UpdateSettings(app_settings));
            }
            LoadOutcome::Loaded { file, .. } => {
                library = file.to_user_library(catalog);
                let app_settings =
                    store_settings_to_app_settings(&file.settings, Some(config_path_str));
                app.dispatch(AppEvent::UpdateSettings(app_settings));
            }
            LoadOutcome::CorruptQuarantined {
                corrupt_path,
                backup_candidate,
                error,
            } => {
                let app_settings = AppSettings {
                    config_path: Some(config_path_str),
                    ..Default::default()
                };
                app.dispatch(AppEvent::UpdateSettings(app_settings));
                app.dispatch(AppEvent::SetRecoveryState(Some(RecoveryStateSnapshot {
                    corrupt_path: corrupt_path.display().to_string(),
                    backup_candidate: backup_candidate.map(|b| b.path.display().to_string()),
                    error,
                })));
            }
        }

        let tracker = Arc::new(GenerationTracker::new());
        let pipeline = RenderPipeline::new(Arc::new(LatexRustSvgBackend::new()), tracker, 64);

        Ok(Self {
            app: Mutex::new(app),
            store: Mutex::new(store),
            library: Mutex::new(library),
            pipeline,
            clipboard,
            render_seq: Mutex::new(0),
        })
    }

    pub fn initialize_default() -> Result<Self, DesktopError> {
        let path = default_library_path()
            .ok_or_else(|| DesktopError::ConfigPath("无法解析默认用户目录".to_owned()))?;
        Self::initialize_with_path(path, Arc::new(SystemClipboard))
    }

    pub fn snapshot(&self) -> Result<EngineSnapshot, String> {
        let guard = self
            .app
            .lock()
            .map_err(|e| format!("app lock poisoned: {e}"))?;
        Ok(guard.snapshot())
    }

    pub fn dispatch_event(&self, event: AppEvent) -> Result<DispatchResponse, String> {
        let catalog = Catalog::builtin();
        let mut response = {
            let mut app = self
                .app
                .lock()
                .map_err(|e| format!("app lock poisoned: {e}"))?;
            app.dispatch_snapshot(event)
        };

        let mut needs_snapshot_refresh = false;
        for effect in &response.effects {
            match effect {
                Effect::Clipboard(text) => {
                    self.clipboard.write_text(text)?;
                }
                Effect::Host(action) => match action {
                    HostAction::PersistSettings(next_settings) => {
                        let store_settings = app_settings_to_store_settings(next_settings);
                        let mut store = self
                            .store
                            .lock()
                            .map_err(|e| format!("store lock poisoned: {e}"))?;
                        let library = self
                            .library
                            .lock()
                            .map_err(|e| format!("library lock poisoned: {e}"))?;
                        store.set_settings(store_settings);
                        store
                            .save_user_library(&library, catalog)
                            .map_err(|e| format!("保存配置失败: {e}"))?;
                    }
                    HostAction::RestoreBackup { backup_path } => {
                        if let Some(path_str) = backup_path {
                            let _snap = self.restore_backup_internal(Path::new(path_str))?;
                            needs_snapshot_refresh = true;
                        }
                    }
                    HostAction::ResetEmptyConfig => {
                        let _snap = self.reset_empty_internal()?;
                        needs_snapshot_refresh = true;
                    }
                    HostAction::SaveSnippet { source, latex } => {
                        let snippet_src = if !source.trim().is_empty() {
                            source.clone()
                        } else {
                            latex.clone()
                        };
                        if !snippet_src.trim().is_empty() {
                            let label = snippet_src.chars().take(24).collect::<String>();
                            let _entry = self.save_user_formula(
                                format!("片段 {label}"),
                                "自定义".to_owned(),
                                snippet_src,
                                "从编辑器保存的公式片段".to_owned(),
                            )?;
                        }
                    }
                    HostAction::ImportConfig | HostAction::ExportConfig => {}
                },
                Effect::Render(_)
                | Effect::Status(_)
                | Effect::Focus(_)
                | Effect::ExportResult(_) => {}
            }
        }

        if needs_snapshot_refresh {
            let app = self
                .app
                .lock()
                .map_err(|e| format!("app lock poisoned: {e}"))?;
            response.snapshot = app.snapshot();
        }

        Ok(response)
    }

    pub fn restore_backup(&self, backup_path: Option<String>) -> Result<EngineSnapshot, String> {
        let target = match backup_path {
            Some(path) => PathBuf::from(path),
            None => {
                let app = self
                    .app
                    .lock()
                    .map_err(|e| format!("app lock poisoned: {e}"))?;
                let candidate = app
                    .recovery()
                    .and_then(|r| r.backup_candidate.clone())
                    .ok_or_else(|| "当前没有可用于恢复的备份文件".to_owned())?;
                PathBuf::from(candidate)
            }
        };
        self.restore_backup_internal(&target)
    }

    fn restore_backup_internal(&self, backup_path: &Path) -> Result<EngineSnapshot, String> {
        let catalog = Catalog::builtin();
        let restored_file = {
            let mut store = self
                .store
                .lock()
                .map_err(|e| format!("store lock poisoned: {e}"))?;
            store
                .restore_from_backup(backup_path, catalog)
                .map_err(|e| format!("从备份恢复失败: {e}"))?
        };
        let config_path = {
            let store = self
                .store
                .lock()
                .map_err(|e| format!("store lock poisoned: {e}"))?;
            Some(store.path().display().to_string())
        };
        {
            let mut library = self
                .library
                .lock()
                .map_err(|e| format!("library lock poisoned: {e}"))?;
            *library = restored_file.to_user_library(catalog);
        }
        let app_settings = store_settings_to_app_settings(&restored_file.settings, config_path);
        let mut app = self
            .app
            .lock()
            .map_err(|e| format!("app lock poisoned: {e}"))?;
        app.dispatch(AppEvent::UpdateSettings(app_settings));
        app.dispatch(AppEvent::SetRecoveryState(None));
        Ok(app.snapshot())
    }

    pub fn reset_empty_config(&self) -> Result<EngineSnapshot, String> {
        self.reset_empty_internal()
    }

    fn reset_empty_internal(&self) -> Result<EngineSnapshot, String> {
        let catalog = Catalog::builtin();
        let empty_file = {
            let mut store = self
                .store
                .lock()
                .map_err(|e| format!("store lock poisoned: {e}"))?;
            store
                .reset_empty()
                .map_err(|e| format!("重置空配置失败: {e}"))?
        };
        let config_path = {
            let store = self
                .store
                .lock()
                .map_err(|e| format!("store lock poisoned: {e}"))?;
            Some(store.path().display().to_string())
        };
        {
            let mut library = self
                .library
                .lock()
                .map_err(|e| format!("library lock poisoned: {e}"))?;
            *library = empty_file.to_user_library(catalog);
        }
        let app_settings = store_settings_to_app_settings(&empty_file.settings, config_path);
        let mut app = self
            .app
            .lock()
            .map_err(|e| format!("app lock poisoned: {e}"))?;
        app.dispatch(AppEvent::UpdateSettings(app_settings));
        app.dispatch(AppEvent::SetRecoveryState(None));
        Ok(app.snapshot())
    }

    pub fn export_config_json(&self) -> Result<String, String> {
        let catalog = Catalog::builtin();
        let store = self
            .store
            .lock()
            .map_err(|e| format!("store lock poisoned: {e}"))?;
        let library = self
            .library
            .lock()
            .map_err(|e| format!("library lock poisoned: {e}"))?;
        store
            .export_library_json(&library, catalog)
            .map_err(|e| format!("导出配置失败: {e}"))
    }

    pub fn import_config_json(&self, raw_json: &str) -> Result<EngineSnapshot, String> {
        let catalog = Catalog::builtin();
        let (file, _report) = {
            let mut store = self
                .store
                .lock()
                .map_err(|e| format!("store lock poisoned: {e}"))?;
            store
                .import_library_json(raw_json, catalog)
                .map_err(|e| format!("导入配置失败: {e}"))?
        };
        let config_path = {
            let store = self
                .store
                .lock()
                .map_err(|e| format!("store lock poisoned: {e}"))?;
            Some(store.path().display().to_string())
        };
        {
            let mut library = self
                .library
                .lock()
                .map_err(|e| format!("library lock poisoned: {e}"))?;
            *library = file.to_user_library(catalog);
        }
        let app_settings = store_settings_to_app_settings(&file.settings, config_path);
        let mut app = self
            .app
            .lock()
            .map_err(|e| format!("app lock poisoned: {e}"))?;
        app.dispatch(AppEvent::UpdateSettings(app_settings));
        app.dispatch(AppEvent::SetRecoveryState(None));
        Ok(app.snapshot())
    }

    pub fn user_formulas(&self) -> Result<Vec<FormulaEntry>, String> {
        let library = self
            .library
            .lock()
            .map_err(|e| format!("library lock poisoned: {e}"))?;
        Ok(library
            .formulas
            .entries
            .iter()
            .filter(|entry| !entry.is_builtin)
            .cloned()
            .collect())
    }

    pub fn save_user_formula(
        &self,
        name: String,
        category: String,
        source: String,
        desc: String,
    ) -> Result<FormulaEntry, String> {
        let catalog = Catalog::builtin();
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let entry = FormulaEntry {
            id: next_uuid_v7(),
            name: if name.trim().is_empty() {
                "自定义公式".to_owned()
            } else {
                name
            },
            category: if category.trim().is_empty() {
                "自定义".to_owned()
            } else {
                category
            },
            source,
            desc,
            tags: vec!["snippet".to_owned()],
            is_builtin: false,
            created_at,
        };
        let mut store = self
            .store
            .lock()
            .map_err(|e| format!("store lock poisoned: {e}"))?;
        let mut library = self
            .library
            .lock()
            .map_err(|e| format!("library lock poisoned: {e}"))?;
        library.formulas.entries.push(entry.clone());
        store
            .save_user_library(&library, catalog)
            .map_err(|e| format!("保存公式库失败: {e}"))?;
        Ok(entry)
    }

    pub fn copy_to_clipboard(&self, text: &str) -> Result<(), String> {
        self.clipboard.write_text(text)
    }

    pub fn render_latex_svg(
        &self,
        req: RenderSvgRequestDto,
    ) -> Result<LatexRustInvokeResultDto, String> {
        let tex_input = req
            .preview_latex
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&req.latex)
            .to_owned();

        let render_id = {
            let mut seq = self
                .render_seq
                .lock()
                .map_err(|e| format!("render seq lock poisoned: {e}"))?;
            *seq += 1;
            *seq
        };
        let generation = if req.generation == 0 {
            render_id
        } else {
            req.generation
        };
        self.pipeline.tracker().set_current(Generation(generation));

        let theme = match req.theme.as_deref() {
            Some("dark") => RenderTheme::Dark,
            Some("high-contrast") => RenderTheme::HighContrast,
            _ => RenderTheme::Light,
        };
        let mode = match req.mode.as_deref() {
            Some("nav") => RenderMode::Nav,
            _ => RenderMode::Preview,
        };

        let render_req = RenderRequest {
            id: mathslot_render::RenderId(render_id),
            generation: Generation(generation),
            mode,
            latex: tex_input.clone(),
            theme,
            scale: req.scale.unwrap_or(1.0),
            format: RenderFormat::Svg,
            backend: BackendKind::LatexRust,
        };

        match self.pipeline.render(&render_req) {
            Ok(out) => {
                let svg = match out.output {
                    RenderData::Svg(markup) => markup,
                    RenderData::Png { .. } => String::new(),
                };
                let diagnostics = out
                    .diagnostics
                    .iter()
                    .map(|diag| {
                        let excerpt_source = diag.source_excerpt.as_deref().unwrap_or(&tex_input);
                        let err_summary =
                            ErrorSummary::from_error(&diag.code, &diag.message, excerpt_source);
                        PreviewDiagnosticDto {
                            code: diag.code.clone(),
                            severity: "Warning".to_owned(),
                            summary: err_summary.header_summary,
                            message: diag.message.clone(),
                            source_excerpt: err_summary.source_excerpt,
                            truncated: err_summary.truncated,
                            detail: diag.detail.clone().unwrap_or(err_summary.full_detail),
                            hint: None,
                        }
                    })
                    .collect::<Vec<_>>();
                let degraded = out.degraded || !diagnostics.is_empty();
                Ok(LatexRustInvokeResultDto {
                    svg,
                    degraded,
                    diagnostics,
                })
            }
            Err(err) => {
                let err_msg = err.to_string();
                let err_summary =
                    ErrorSummary::from_error("LATEX_RUST_ERROR", &err_msg, &tex_input);
                Ok(LatexRustInvokeResultDto {
                    svg: String::new(),
                    degraded: true,
                    diagnostics: vec![PreviewDiagnosticDto {
                        code: "LATEX_RUST_ERROR".to_owned(),
                        severity: "Error".to_owned(),
                        summary: err_summary.header_summary,
                        message: err_msg,
                        source_excerpt: err_summary.source_excerpt,
                        truncated: err_summary.truncated,
                        detail: err_summary.full_detail,
                        hint: Some(
                            "LaTeX-Rust 离线渲染未能解析该语法，可切换 MathJax 或修正表达式"
                                .to_owned(),
                        ),
                    }],
                })
            }
        }
    }
}

#[tauri::command]
fn get_snapshot(state: tauri::State<'_, DesktopBackend>) -> Result<EngineSnapshot, String> {
    state.snapshot()
}

#[tauri::command]
fn dispatch_event(
    event: AppEvent,
    state: tauri::State<'_, DesktopBackend>,
) -> Result<DispatchResponse, String> {
    state.dispatch_event(event)
}

#[tauri::command]
fn engine_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn get_presets() -> Vec<PresetDto> {
    Catalog::builtin()
        .presets()
        .iter()
        .map(|p| PresetDto {
            id: p.id.clone(),
            legacy_id: p.legacy_id.clone(),
            name: p.name.clone(),
            category: p.category.clone(),
            source: p.source.clone(),
            desc: p.desc.clone(),
            tags: p.tags.clone(),
        })
        .collect()
}

#[tauri::command]
fn get_user_formulas(
    state: tauri::State<'_, DesktopBackend>,
) -> Result<Vec<FormulaEntryDto>, String> {
    state
        .user_formulas()
        .map(|list| list.iter().map(FormulaEntryDto::from).collect())
}

#[tauri::command]
fn save_user_formula(
    name: String,
    category: String,
    source: String,
    desc: String,
    state: tauri::State<'_, DesktopBackend>,
) -> Result<FormulaEntryDto, String> {
    state
        .save_user_formula(name, category, source, desc)
        .map(|entry| FormulaEntryDto::from(&entry))
}

#[tauri::command]
fn render_latex_svg(
    req: RenderSvgRequestDto,
    state: tauri::State<'_, DesktopBackend>,
) -> Result<LatexRustInvokeResultDto, String> {
    state.render_latex_svg(req)
}

#[tauri::command]
fn restore_backup(
    backup_path: Option<String>,
    state: tauri::State<'_, DesktopBackend>,
) -> Result<EngineSnapshot, String> {
    state.restore_backup(backup_path)
}

#[tauri::command]
fn reset_empty_config(state: tauri::State<'_, DesktopBackend>) -> Result<EngineSnapshot, String> {
    state.reset_empty_config()
}

#[tauri::command]
fn export_config_json(state: tauri::State<'_, DesktopBackend>) -> Result<String, String> {
    state.export_config_json()
}

#[tauri::command]
fn import_config_json(
    raw_json: String,
    state: tauri::State<'_, DesktopBackend>,
) -> Result<EngineSnapshot, String> {
    state.import_config_json(&raw_json)
}

#[tauri::command]
fn copy_to_clipboard(text: String, state: tauri::State<'_, DesktopBackend>) -> Result<(), String> {
    state.copy_to_clipboard(&text)
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let backend = DesktopBackend::initialize_default()?;
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(backend)
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            dispatch_event,
            engine_version,
            get_presets,
            get_user_formulas,
            save_user_formula,
            render_latex_svg,
            restore_backup,
            reset_empty_config,
            export_config_json,
            import_config_json,
            copy_to_clipboard,
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}

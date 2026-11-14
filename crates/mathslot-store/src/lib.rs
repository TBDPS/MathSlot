#![forbid(unsafe_code)]

mod catalog;
mod migrate;
mod paths;

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use fd_lock::RwLock;
use mathslot_core::library::{
    AutoJoin, CustomFormat, FormulaEntry, FormulaLibrary, FormulaSnippet, LayoutKind, UserLibrary,
};
use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;
use thiserror::Error;

pub use catalog::{Catalog, CatalogPreset};
pub use mathslot_core::library::{is_valid_uuid_v7, next_uuid_v7};
pub use migrate::{dry_run_migrate, import_formulas_json};
pub use paths::{
    default_library_path, library_path_for_linux, library_path_for_macos, library_path_for_windows,
};

pub const CURRENT_LIBRARY_SCHEMA_VERSION: u32 = 3;
pub const DEFAULT_BACKUP_RETENTION: usize = 5;
pub const MIN_BACKUP_RETENTION: usize = 3;
pub const MAX_BACKUP_RETENTION: usize = 5;

static OP_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("配置路径不可用")]
    PathUnavailable,
    #[error("权限被拒绝 ({path}): {source}")]
    PermissionDenied {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("磁盘读写失败 ({path}): {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("写冲突：磁盘上的配置文件 ({path}) 已被其他实例修改")]
    Conflict { path: PathBuf },
    #[error("配置文件已损坏并隔离至 {corrupt_path}：{reason}")]
    CorruptQuarantined {
        corrupt_path: PathBuf,
        reason: String,
    },
    #[error("JSON 序列化/解析失败: {0}")]
    Serialize(String),
    #[error("不支持的 schema_version: {0}")]
    UnsupportedSchemaVersion(u64),
    #[error("禁止导入内置公式 (is_builtin: true): {0}")]
    BuiltinImportRejected(String),
    #[error("配置迁移失败: {0}")]
    Migration(String),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutoJoinRecord {
    pub base: usize,
    pub cond: usize,
    #[serde(rename = "macro")]
    pub macro_tex: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomFormatRecord {
    pub key: char,
    pub label: String,
    #[serde(default)]
    pub glyph: String,
    #[serde(default)]
    pub roles: Vec<String>,
    pub latex: String,
    #[serde(default, rename = "schemeA")]
    pub scheme_a: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols: Option<usize>,
    #[serde(default, rename = "autoJoin", skip_serializing_if = "Option::is_none")]
    pub auto_join: Option<AutoJoinRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnippetRecord {
    pub key: char,
    pub label: String,
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserFormula {
    pub id: String,
    pub name: String,
    pub category: String,
    pub source: String,
    #[serde(default)]
    pub desc: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresetOverride {
    pub preset_id: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    Light,
    Dark,
    #[default]
    System,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum RenderBackendPreference {
    #[default]
    #[serde(rename = "mathjax")]
    MathJax,
    #[serde(rename = "latex-rust")]
    LatexRust,
}

fn default_nav_next_slot() -> String {
    "j".to_owned()
}

fn default_nav_prev_slot() -> String {
    "k".to_owned()
}

fn default_nav_parent() -> String {
    "h".to_owned()
}

fn default_nav_first_child() -> String {
    "l".to_owned()
}

fn default_copy_latex() -> String {
    "Mod+Shift+C".to_owned()
}

fn default_save_snippet() -> String {
    "Mod+Shift+S".to_owned()
}

fn default_focus_editor() -> String {
    "Mod+E".to_owned()
}

fn default_toggle_nav() -> String {
    "Mod+J".to_owned()
}

fn default_open_settings() -> String {
    "Mod+,".to_owned()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShortcutSettings {
    #[serde(default = "default_nav_next_slot")]
    pub nav_next_slot: String,
    #[serde(default = "default_nav_prev_slot")]
    pub nav_prev_slot: String,
    #[serde(default = "default_nav_parent")]
    pub nav_parent: String,
    #[serde(default = "default_nav_first_child")]
    pub nav_first_child: String,
    #[serde(default = "default_copy_latex")]
    pub copy_latex: String,
    #[serde(default = "default_save_snippet")]
    pub save_snippet: String,
    #[serde(default = "default_focus_editor")]
    pub focus_editor: String,
    #[serde(default = "default_toggle_nav")]
    pub toggle_nav: String,
    #[serde(default = "default_open_settings")]
    pub open_settings: String,
}

impl Default for ShortcutSettings {
    fn default() -> Self {
        Self {
            nav_next_slot: default_nav_next_slot(),
            nav_prev_slot: default_nav_prev_slot(),
            nav_parent: default_nav_parent(),
            nav_first_child: default_nav_first_child(),
            copy_latex: default_copy_latex(),
            save_snippet: default_save_snippet(),
            focus_editor: default_focus_editor(),
            toggle_nav: default_toggle_nav(),
            open_settings: default_open_settings(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delimiter_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_scale_pct: Option<u16>,
    #[serde(default)]
    pub theme: ThemePreference,
    #[serde(default)]
    pub render_backend: RenderBackendPreference,
    #[serde(default)]
    pub shortcuts: ShortcutSettings,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LibraryFile {
    pub schema_version: u32,
    #[serde(default)]
    pub custom_formats: Vec<CustomFormatRecord>,
    #[serde(default)]
    pub snippets: Vec<SnippetRecord>,
    #[serde(default)]
    pub user_formulas: Vec<UserFormula>,
    #[serde(default)]
    pub overrides: Vec<PresetOverride>,
    #[serde(default)]
    pub settings: Settings,
}

impl LibraryFile {
    pub fn empty_v3() -> Self {
        Self {
            schema_version: CURRENT_LIBRARY_SCHEMA_VERSION,
            custom_formats: Vec::new(),
            snippets: Vec::new(),
            user_formulas: Vec::new(),
            overrides: Vec::new(),
            settings: Settings::default(),
        }
    }

    pub fn from_user_library(lib: &UserLibrary, catalog: &Catalog) -> Self {
        Self::from_user_library_with_settings(lib, catalog, Settings::default())
    }

    pub fn from_user_library_with_settings(
        lib: &UserLibrary,
        catalog: &Catalog,
        settings: Settings,
    ) -> Self {
        let mut custom_formats: Vec<CustomFormatRecord> = lib
            .custom_formats
            .iter()
            .map(|f| {
                let (kind, env, cols) = match &f.layout {
                    LayoutKind::Linear => (None, None, None),
                    LayoutKind::Env { env, cols } => {
                        (Some("env".to_owned()), Some(env.clone()), Some(*cols))
                    }
                };
                let auto_join = f.auto_join.as_ref().map(|j| AutoJoinRecord {
                    base: j.base_slot,
                    cond: j.cond_slot,
                    macro_tex: j.macro_tex.clone(),
                });
                CustomFormatRecord {
                    key: f.item_key,
                    label: f.label.clone(),
                    glyph: f.glyph_hint.clone(),
                    roles: f.slot_roles.clone(),
                    latex: f.latex_template.clone(),
                    scheme_a: f.scheme_a_name.clone(),
                    kind,
                    env,
                    cols,
                    auto_join,
                }
            })
            .collect();
        custom_formats.sort_by_key(|f| f.key);

        let mut snippets: Vec<SnippetRecord> = lib
            .snippets
            .iter()
            .map(|s| SnippetRecord {
                key: s.item_key,
                label: s.label.clone(),
                source: s.stream_source.clone(),
            })
            .collect();
        snippets.sort_by_key(|s| s.key);

        let mut user_formulas = Vec::new();
        let mut overrides = Vec::new();

        for entry in &lib.formulas.entries {
            if entry.is_builtin {
                if let Some(preset) = catalog
                    .find_by_id(&entry.id)
                    .or_else(|| catalog.find_by_legacy_id(&entry.id))
                {
                    let ov = PresetOverride {
                        preset_id: preset.id.clone(),
                        hidden: false,
                        name: (entry.name != preset.name).then(|| entry.name.clone()),
                        category: (entry.category != preset.category)
                            .then(|| entry.category.clone()),
                        source: (entry.source != preset.source).then(|| entry.source.clone()),
                        desc: (entry.desc != preset.desc).then(|| entry.desc.clone()),
                        tags: (entry.tags != preset.tags).then(|| entry.tags.clone()),
                    };
                    if ov.name.is_some()
                        || ov.category.is_some()
                        || ov.source.is_some()
                        || ov.desc.is_some()
                        || ov.tags.is_some()
                    {
                        overrides.push(ov);
                    }
                } else {
                    user_formulas.push(UserFormula {
                        id: if entry.id.trim().is_empty() {
                            next_uuid_v7()
                        } else {
                            entry.id.clone()
                        },
                        name: entry.name.clone(),
                        category: entry.category.clone(),
                        source: entry.source.clone(),
                        desc: entry.desc.clone(),
                        tags: entry.tags.clone(),
                        created_at: entry.created_at,
                    });
                }
            } else {
                user_formulas.push(UserFormula {
                    id: if entry.id.trim().is_empty() {
                        next_uuid_v7()
                    } else {
                        entry.id.clone()
                    },
                    name: entry.name.clone(),
                    category: entry.category.clone(),
                    source: entry.source.clone(),
                    desc: entry.desc.clone(),
                    tags: entry.tags.clone(),
                    created_at: entry.created_at,
                });
            }
        }

        Self {
            schema_version: CURRENT_LIBRARY_SCHEMA_VERSION,
            custom_formats,
            snippets,
            user_formulas,
            overrides,
            settings,
        }
    }

    pub fn to_user_library(&self, catalog: &Catalog) -> UserLibrary {
        let mut custom_formats: Vec<CustomFormat> = self
            .custom_formats
            .iter()
            .map(|f| {
                let layout = if f.kind.as_deref() == Some("env") {
                    LayoutKind::Env {
                        env: f.env.clone().unwrap_or_else(|| "pmatrix".to_owned()),
                        cols: f.cols.unwrap_or(2).max(1),
                    }
                } else {
                    LayoutKind::Linear
                };
                let auto_join = f.auto_join.as_ref().map(|j| AutoJoin {
                    base_slot: j.base,
                    cond_slot: j.cond,
                    macro_tex: j.macro_tex.clone(),
                });
                CustomFormat {
                    item_key: f.key,
                    label: f.label.clone(),
                    glyph_hint: f.glyph.clone(),
                    slot_roles: f.roles.clone(),
                    latex_template: f.latex.clone(),
                    scheme_a_name: f.scheme_a.clone(),
                    layout,
                    auto_join,
                }
            })
            .collect();
        custom_formats.sort_by_key(|f| f.item_key);

        let mut snippets: Vec<FormulaSnippet> = self
            .snippets
            .iter()
            .map(|s| FormulaSnippet {
                item_key: s.key,
                label: s.label.clone(),
                stream_source: s.source.clone(),
            })
            .collect();
        snippets.sort_by_key(|s| s.item_key);

        let mut override_map: HashMap<&str, &PresetOverride> = HashMap::new();
        for ov in &self.overrides {
            let resolved = catalog
                .resolve_preset_id(&ov.preset_id)
                .unwrap_or(ov.preset_id.as_str());
            override_map.insert(resolved, ov);
        }

        let mut entries = Vec::with_capacity(catalog.presets().len() + self.user_formulas.len());
        for (idx, preset) in catalog.presets().iter().enumerate() {
            let ov = override_map.get(preset.id.as_str()).copied();
            if ov.is_some_and(|o| o.hidden) {
                continue;
            }
            entries.push(FormulaEntry {
                id: preset.id.clone(),
                name: ov
                    .and_then(|o| o.name.clone())
                    .unwrap_or_else(|| preset.name.clone()),
                category: ov
                    .and_then(|o| o.category.clone())
                    .unwrap_or_else(|| preset.category.clone()),
                source: ov
                    .and_then(|o| o.source.clone())
                    .unwrap_or_else(|| preset.source.clone()),
                desc: ov
                    .and_then(|o| o.desc.clone())
                    .unwrap_or_else(|| preset.desc.clone()),
                tags: ov
                    .and_then(|o| o.tags.clone())
                    .unwrap_or_else(|| preset.tags.clone()),
                is_builtin: true,
                created_at: 1_700_000_000 + (idx as u64) * 60,
            });
        }

        for uf in &self.user_formulas {
            entries.push(FormulaEntry {
                id: uf.id.clone(),
                name: uf.name.clone(),
                category: uf.category.clone(),
                source: uf.source.clone(),
                desc: uf.desc.clone(),
                tags: uf.tags.clone(),
                is_builtin: false,
                created_at: uf.created_at,
            });
        }

        UserLibrary {
            custom_formats,
            snippets,
            formulas: FormulaLibrary { entries },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileRevision {
    pub len: u64,
    pub modified_nanos: Option<u128>,
    pub fnv1a_hash: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WriteCondition {
    Unconditional,
    IfUnmodified(Option<FileRevision>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackupCandidate {
    pub path: PathBuf,
    pub file: LibraryFile,
    pub revision: FileRevision,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MigrationReport {
    pub from_version: u32,
    pub to_version: u32,
    pub id_migration_map: HashMap<String, String>,
    pub stripped_builtin_count: usize,
    pub converted_override_count: usize,
    pub backup_path: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadOutcome {
    NotFound {
        file: LibraryFile,
    },
    Loaded {
        file: LibraryFile,
        revision: FileRevision,
        migrated: Option<MigrationReport>,
    },
    CorruptQuarantined {
        corrupt_path: PathBuf,
        backup_candidate: Option<BackupCandidate>,
        error: String,
    },
}

pub trait SyncableWrite: Write {
    fn sync_all_file(&self) -> std::io::Result<()>;
}

impl SyncableWrite for std::fs::File {
    fn sync_all_file(&self) -> std::io::Result<()> {
        self.sync_all()
    }
}

fn map_io_err(path: &Path, err: std::io::Error) -> StoreError {
    if err.kind() == ErrorKind::PermissionDenied {
        StoreError::PermissionDenied {
            path: path.to_path_buf(),
            source: err,
        }
    } else {
        StoreError::Io {
            path: path.to_path_buf(),
            source: err,
        }
    }
}

fn fnv1a_64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

fn compute_revision(path: &Path, bytes: &[u8]) -> FileRevision {
    let modified_nanos = std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos());
    FileRevision {
        len: bytes.len() as u64,
        modified_nanos,
        fnv1a_hash: fnv1a_64(bytes),
    }
}

fn now_ms_and_seq() -> (u128, u64) {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let seq = OP_SEQ.fetch_add(1, Ordering::Relaxed);
    (ms, seq)
}

fn stem_prefix(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("library")
        .to_owned()
}

fn parent_dir(path: &Path) -> &Path {
    path.parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

fn lock_path_for(path: &Path) -> PathBuf {
    let stem = stem_prefix(path);
    parent_dir(path).join(format!("{stem}.lock"))
}

#[cfg(unix)]
fn sync_dir(dir: &Path) -> Result<(), StoreError> {
    let dir_file = std::fs::File::open(dir).map_err(|e| map_io_err(dir, e))?;
    dir_file.sync_all().map_err(|e| map_io_err(dir, e))
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) -> Result<(), StoreError> {
    Ok(())
}

fn create_backup_from_bytes(
    target_path: &Path,
    bytes: &[u8],
    max_backups: usize,
) -> Result<PathBuf, StoreError> {
    let dir = parent_dir(target_path);
    let stem = stem_prefix(target_path);
    let retention = max_backups.clamp(MIN_BACKUP_RETENTION, MAX_BACKUP_RETENTION);
    let (ts_ms, seq) = now_ms_and_seq();
    let bak_name = format!("{stem}.bak-{ts_ms:016}-{seq:06}.json");
    let bak_path = dir.join(bak_name);

    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&bak_path)
        .map_err(|e| map_io_err(&bak_path, e))?;
    f.write_all(bytes).map_err(|e| map_io_err(&bak_path, e))?;
    f.flush().map_err(|e| map_io_err(&bak_path, e))?;
    f.sync_all().map_err(|e| map_io_err(&bak_path, e))?;

    let existing = list_backups(target_path);
    for stale in existing.into_iter().skip(retention) {
        std::fs::remove_file(&stale).map_err(|e| map_io_err(&stale, e))?;
    }
    Ok(bak_path)
}

pub fn list_backups(path: &Path) -> Vec<PathBuf> {
    let dir = parent_dir(path);
    let stem = stem_prefix(path);
    let bak_prefix = format!("{stem}.bak-");
    let legacy_bak = path.with_extension("json.bak");

    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut timestamped: Vec<(String, PathBuf)> = Vec::new();
    let mut has_legacy = false;
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&bak_prefix) && name.ends_with(".json") {
            timestamped.push((name, p));
        } else if p == legacy_bak {
            has_legacy = true;
        }
    }
    timestamped.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out: Vec<PathBuf> = timestamped.into_iter().map(|(_, p)| p).collect();
    if has_legacy {
        out.push(legacy_bak);
    }
    out
}

fn quarantine_corrupt_file(path: &Path) -> Result<PathBuf, StoreError> {
    let dir = parent_dir(path);
    let stem = stem_prefix(path);
    let (ts_ms, seq) = now_ms_and_seq();
    let corrupt_path = dir.join(format!("{stem}.corrupt-{ts_ms:016}-{seq:06}.json"));
    std::fs::rename(path, &corrupt_path).map_err(|e| map_io_err(path, e))?;
    sync_dir(dir)?;
    Ok(corrupt_path)
}

fn find_newest_valid_backup(path: &Path, catalog: &Catalog) -> Option<BackupCandidate> {
    for bak_path in list_backups(path) {
        let Ok(bytes) = std::fs::read(&bak_path) else {
            continue;
        };
        let Ok(raw) = std::str::from_utf8(&bytes) else {
            continue;
        };
        if let Ok((file, _)) = dry_run_migrate(raw, catalog) {
            let revision = compute_revision(&bak_path, &bytes);
            return Some(BackupCandidate {
                path: bak_path,
                file,
                revision,
            });
        }
    }
    None
}

pub fn load_or_recover(path: &Path) -> Result<LoadOutcome, StoreError> {
    load_or_recover_with_catalog(path, Catalog::builtin())
}

pub fn load_or_recover_with_catalog(
    path: &Path,
    catalog: &Catalog,
) -> Result<LoadOutcome, StoreError> {
    match std::fs::metadata(path) {
        Err(e) if e.kind() == ErrorKind::NotFound => {
            return Ok(LoadOutcome::NotFound {
                file: LibraryFile::empty_v3(),
            });
        }
        Err(e) => return Err(map_io_err(path, e)),
        Ok(_) => {}
    }

    let lock_path = lock_path_for(path);
    let mut lock_handle = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .ok()
        .map(RwLock::new);
    let _read_guard = match lock_handle.as_mut() {
        Some(rw) => rw.read().ok(),
        None => None,
    };

    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == ErrorKind::NotFound => {
            return Ok(LoadOutcome::NotFound {
                file: LibraryFile::empty_v3(),
            });
        }
        Err(e) => return Err(map_io_err(path, e)),
    };

    let raw_str = match std::str::from_utf8(&bytes) {
        Ok(s) => s,
        Err(e) => {
            drop(_read_guard);
            let corrupt_path = quarantine_corrupt_file(path)?;
            let backup_candidate = find_newest_valid_backup(path, catalog);
            return Ok(LoadOutcome::CorruptQuarantined {
                corrupt_path,
                backup_candidate,
                error: format!("无效 UTF-8 编码: {e}"),
            });
        }
    };

    match dry_run_migrate(raw_str, catalog) {
        Ok((file, None)) => {
            let revision = compute_revision(path, &bytes);
            Ok(LoadOutcome::Loaded {
                file,
                revision,
                migrated: None,
            })
        }
        Ok((file, Some(mut report))) => {
            drop(_read_guard);
            let rev_before = compute_revision(path, &bytes);
            let dir = parent_dir(path);
            let can_write_dir = lock_handle.is_some();
            if can_write_dir {
                let bak_path = create_backup_from_bytes(path, &bytes, DEFAULT_BACKUP_RETENTION)?;
                report.backup_path = Some(bak_path);
                let new_rev = save_atomic_inner(
                    path,
                    &file,
                    WriteCondition::IfUnmodified(Some(rev_before)),
                    DEFAULT_BACKUP_RETENTION,
                    |f| f,
                    false,
                )?;
                sync_dir(dir)?;
                Ok(LoadOutcome::Loaded {
                    file,
                    revision: new_rev,
                    migrated: Some(report),
                })
            } else {
                Ok(LoadOutcome::Loaded {
                    file,
                    revision: rev_before,
                    migrated: Some(report),
                })
            }
        }
        Err(StoreError::UnsupportedSchemaVersion(v)) => {
            Err(StoreError::UnsupportedSchemaVersion(v))
        }
        Err(e) => {
            drop(_read_guard);
            let corrupt_path = quarantine_corrupt_file(path)?;
            let backup_candidate = find_newest_valid_backup(path, catalog);
            Ok(LoadOutcome::CorruptQuarantined {
                corrupt_path,
                backup_candidate,
                error: e.to_string(),
            })
        }
    }
}

pub fn save_atomic(
    path: &Path,
    file: &LibraryFile,
    condition: WriteCondition,
) -> Result<FileRevision, StoreError> {
    save_atomic_with_retention(path, file, condition, DEFAULT_BACKUP_RETENTION)
}

pub fn save_atomic_with_retention(
    path: &Path,
    file: &LibraryFile,
    condition: WriteCondition,
    max_backups: usize,
) -> Result<FileRevision, StoreError> {
    save_with_writer_hook(path, file, condition, max_backups, |f| f)
}

pub fn save_with_writer_hook<W, F>(
    path: &Path,
    file: &LibraryFile,
    condition: WriteCondition,
    max_backups: usize,
    wrap_writer: F,
) -> Result<FileRevision, StoreError>
where
    W: SyncableWrite,
    F: FnOnce(std::fs::File) -> W,
{
    save_atomic_inner(path, file, condition, max_backups, wrap_writer, true)
}

fn save_atomic_inner<W, F>(
    path: &Path,
    file: &LibraryFile,
    condition: WriteCondition,
    max_backups: usize,
    wrap_writer: F,
    rotate_backup_before_replace: bool,
) -> Result<FileRevision, StoreError>
where
    W: SyncableWrite,
    F: FnOnce(std::fs::File) -> W,
{
    let parent = parent_dir(path);
    std::fs::create_dir_all(parent).map_err(|e| map_io_err(parent, e))?;

    let lock_path = lock_path_for(path);
    let lock_file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|e| map_io_err(&lock_path, e))?;
    let mut rw_lock = RwLock::new(lock_file);
    let _write_guard = rw_lock.write().map_err(|e| map_io_err(&lock_path, e))?;

    let existing_bytes: Option<Vec<u8>> = match std::fs::read(path) {
        Ok(b) => Some(b),
        Err(e) if e.kind() == ErrorKind::NotFound => None,
        Err(e) => return Err(map_io_err(path, e)),
    };

    match &condition {
        WriteCondition::Unconditional => {}
        WriteCondition::IfUnmodified(None) => {
            if existing_bytes.is_some() {
                return Err(StoreError::Conflict {
                    path: path.to_path_buf(),
                });
            }
        }
        WriteCondition::IfUnmodified(Some(expected)) => match existing_bytes.as_deref() {
            Some(bytes) => {
                let current = compute_revision(path, bytes);
                if &current != expected {
                    return Err(StoreError::Conflict {
                        path: path.to_path_buf(),
                    });
                }
            }
            None => {
                return Err(StoreError::Conflict {
                    path: path.to_path_buf(),
                });
            }
        },
    }

    let mut payload =
        serde_json::to_vec_pretty(file).map_err(|e| StoreError::Serialize(e.to_string()))?;
    payload.push(b'\n');

    let temp = NamedTempFile::new_in(parent).map_err(|e| map_io_err(parent, e))?;
    let (file_handle, temp_path) = temp.into_parts();
    {
        let mut writer = wrap_writer(file_handle);
        writer
            .write_all(&payload)
            .map_err(|e| map_io_err(temp_path.as_ref(), e))?;
        writer
            .flush()
            .map_err(|e| map_io_err(temp_path.as_ref(), e))?;
        writer
            .sync_all_file()
            .map_err(|e| map_io_err(temp_path.as_ref(), e))?;
    }

    // Only rotate backup AFTER temporary file write + sync_all succeeded.
    if rotate_backup_before_replace && let Some(prev_bytes) = existing_bytes.as_deref() {
        create_backup_from_bytes(path, prev_bytes, max_backups)?;
    }

    temp_path
        .persist(path)
        .map_err(|e| map_io_err(path, e.error))?;
    sync_dir(parent)?;

    Ok(compute_revision(path, &payload))
}

#[derive(Clone, Debug)]
pub struct Store {
    path: PathBuf,
    settings: Settings,
    last_revision: Option<FileRevision>,
}

impl Store {
    #[must_use]
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            settings: Settings::default(),
            last_revision: None,
        }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    #[must_use]
    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    pub fn set_settings(&mut self, settings: Settings) {
        self.settings = settings;
    }

    #[must_use]
    pub fn last_revision(&self) -> Option<&FileRevision> {
        self.last_revision.as_ref()
    }

    pub fn load(&mut self, catalog: &Catalog) -> Result<LoadOutcome, StoreError> {
        let outcome = load_or_recover_with_catalog(&self.path, catalog)?;
        match &outcome {
            LoadOutcome::NotFound { file } => {
                self.settings = file.settings.clone();
                self.last_revision = None;
            }
            LoadOutcome::Loaded { file, revision, .. } => {
                self.settings = file.settings.clone();
                self.last_revision = Some(revision.clone());
            }
            LoadOutcome::CorruptQuarantined { .. } => {
                self.last_revision = None;
            }
        }
        Ok(outcome)
    }

    pub fn save_user_library(
        &mut self,
        lib: &UserLibrary,
        catalog: &Catalog,
    ) -> Result<FileRevision, StoreError> {
        let file =
            LibraryFile::from_user_library_with_settings(lib, catalog, self.settings.clone());
        let rev = save_atomic(
            &self.path,
            &file,
            WriteCondition::IfUnmodified(self.last_revision.clone()),
        )?;
        self.last_revision = Some(rev.clone());
        Ok(rev)
    }

    pub fn save_file(&mut self, file: &LibraryFile) -> Result<FileRevision, StoreError> {
        let rev = save_atomic(
            &self.path,
            file,
            WriteCondition::IfUnmodified(self.last_revision.clone()),
        )?;
        self.settings = file.settings.clone();
        self.last_revision = Some(rev.clone());
        Ok(rev)
    }
}

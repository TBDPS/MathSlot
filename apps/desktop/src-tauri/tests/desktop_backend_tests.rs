use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use mathslot_app::{
    AppError, AppEvent, AppSettings, DelimiterStyle, Effect, RenderBackendPreference,
    ThemePreference,
};
use mathslot_desktop_lib::{
    ClipboardPort, DesktopBackend, RenderSvgRequestDto, app_settings_to_store_settings,
    store_settings_to_app_settings,
};

#[derive(Default)]
struct RecordingClipboard {
    items: Mutex<Vec<String>>,
}

impl ClipboardPort for RecordingClipboard {
    fn write_text(&self, text: &str) -> Result<(), String> {
        let mut guard = self.items.lock().map_err(|e| format!("lock: {e}"))?;
        guard.push(text.to_owned());
        Ok(())
    }
}

impl RecordingClipboard {
    fn last(&self) -> Option<String> {
        self.items
            .lock()
            .ok()
            .and_then(|guard| guard.last().cloned())
    }
}

fn temp_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!(
        "mathslot_desktop_test_{name}_{}_{}",
        std::process::id(),
        nanos
    ));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[test]
fn test_d130_render_latex_svg_camelcase_dto_and_degraded_diagnostics() {
    let dir = temp_dir("d130_render");
    let lib_path = dir.join("library.json");
    let clipboard = Arc::new(RecordingClipboard::default());
    let backend = DesktopBackend::initialize_with_path(lib_path, clipboard).expect("init backend");

    // Valid formula renders clean SVG without degradation
    let ok_res = backend
        .render_latex_svg(RenderSvgRequestDto {
            generation: 1,
            latex: r"\frac{1}{2}".to_owned(),
            preview_latex: None,
            theme: Some("light".to_owned()),
            scale: Some(1.0),
            mode: Some("preview".to_owned()),
        })
        .expect("render valid latex");
    assert!(!ok_res.degraded);
    assert!(ok_res.diagnostics.is_empty());
    assert!(ok_res.svg.contains("<svg"));

    // Serialize JSON to verify camelCase field names (D-130)
    let json_val = serde_json::to_value(&ok_res).expect("serialize result");
    assert!(json_val.get("svg").is_some());
    assert!(json_val.get("degraded").is_some());
    assert!(json_val.get("diagnostics").is_some());

    // Unsupported/invalid LaTeX degrades visibly with camelCase diagnostic fields
    let bad_res = backend
        .render_latex_svg(RenderSvgRequestDto {
            generation: 2,
            latex: r"\definitelyNotARealLatexCommand{1".to_owned(),
            preview_latex: None,
            theme: Some("dark".to_owned()),
            scale: Some(1.2),
            mode: Some("preview".to_owned()),
        })
        .expect("render fallback diagnostic");
    assert!(bad_res.degraded);
    assert!(!bad_res.diagnostics.is_empty());

    let bad_json = serde_json::to_value(&bad_res).expect("serialize degraded result");
    let first_diag = &bad_json["diagnostics"][0];
    assert!(first_diag.get("summary").is_some());
    assert!(first_diag.get("sourceExcerpt").is_some());
    assert!(first_diag.get("detail").is_some());
    assert!(first_diag.get("source_excerpt").is_none());

    fs::remove_dir_all(&dir).expect("cleanup temp dir");
}

#[test]
fn test_d129_settings_roundtrip_persistence_corrupt_recovery_and_save_snippet() {
    let dir = temp_dir("d129_persistence");
    let lib_path = dir.join("library.json");
    let clipboard = Arc::new(RecordingClipboard::default());

    {
        let backend = DesktopBackend::initialize_with_path(lib_path.clone(), clipboard.clone())
            .expect("init fresh backend");
        let custom_settings = AppSettings {
            theme: ThemePreference::Dark,
            delimiter_style: DelimiterStyle::InlineDollar,
            render_backend: RenderBackendPreference::LatexRust,
            preview_scale_pct: Some(135),
            config_path: Some(lib_path.display().to_string()),
            ..Default::default()
        };

        // Verify store<->app lossless mapping
        let as_store = app_settings_to_store_settings(&custom_settings);
        let roundtrip =
            store_settings_to_app_settings(&as_store, custom_settings.config_path.clone());
        assert_eq!(roundtrip, custom_settings);

        let resp = backend
            .dispatch_event(AppEvent::UpdateSettings(custom_settings.clone()))
            .expect("save settings");
        assert_eq!(resp.snapshot.settings.theme, ThemePreference::Dark);

        // Build formula, copy with inline delimiter, and save snippet
        backend
            .dispatch_event(AppEvent::LoadStreamSource("▸f1;2;".to_owned()))
            .expect("load stream");
        backend
            .dispatch_event(AppEvent::RequestCopy)
            .expect("request copy");
        assert_eq!(clipboard.last().as_deref(), Some(r"$\frac{1}{2}$"));

        backend
            .dispatch_event(AppEvent::RequestSaveSnippet)
            .expect("save snippet");
        let formulas = backend.user_formulas().expect("read user formulas");
        assert_eq!(formulas.len(), 1);

        // Save one more settings update so a `.bak-*` backup containing the saved snippet exists on disk
        let mut next_settings = custom_settings.clone();
        next_settings.preview_scale_pct = Some(140);
        backend
            .dispatch_event(AppEvent::UpdateSettings(next_settings))
            .expect("save updated settings");
    }

    // Restart backend: verify settings & formula survived on disk
    {
        let backend2 = DesktopBackend::initialize_with_path(lib_path.clone(), clipboard.clone())
            .expect("reopen backend");
        let snap2 = backend2.snapshot().expect("snapshot2");
        assert_eq!(snap2.settings.theme, ThemePreference::Dark);
        assert_eq!(snap2.settings.delimiter_style, DelimiterStyle::InlineDollar);
        assert_eq!(
            snap2.settings.render_backend,
            RenderBackendPreference::LatexRust
        );
        assert_eq!(snap2.settings.preview_scale_pct, Some(140));
        assert_eq!(backend2.user_formulas().expect("formulas2").len(), 1);
    }

    // Corrupt primary library file -> startup recovery wizard + restore_backup
    fs::write(&lib_path, "{broken json").expect("corrupt library file");
    let backend3 = DesktopBackend::initialize_with_path(lib_path.clone(), clipboard)
        .expect("init backend on corrupt file");
    let snap3 = backend3.snapshot().expect("snapshot3");
    let recovery = snap3.recovery.expect("recovery state must be surfaced");
    assert!(recovery.backup_candidate.is_some());

    let restored_snap = backend3
        .restore_backup(None)
        .expect("restore_backup must succeed");
    assert!(restored_snap.recovery.is_none());
    assert_eq!(restored_snap.settings.theme, ThemePreference::Dark);
    assert_eq!(backend3.user_formulas().expect("formulas3").len(), 1);

    // Export & strict import check
    let exported = backend3.export_config_json().expect("export config json");
    let bad_builtin = serde_json::json!({
        "schema_version": 3,
        "custom_formats": [],
        "snippets": [],
        "user_formulas": [{
            "id": "01933b4a-1111-7000-8000-000000000099",
            "name": "BuiltinInject",
            "category": "custom",
            "source": "▸f1;2;",
            "desc": "",
            "tags": [],
            "created_at": 1700000001,
            "is_builtin": true
        }],
        "overrides": []
    })
    .to_string();
    assert!(backend3.import_config_json(&bad_builtin).is_err());

    backend3
        .reset_empty_config()
        .expect("reset_empty_config must succeed");
    assert!(backend3.user_formulas().expect("empty formulas").is_empty());

    backend3
        .import_config_json(&exported)
        .expect("re-import exported json");
    assert_eq!(
        backend3.user_formulas().expect("reimported formulas").len(),
        1
    );

    // Strict export blocks pending command (`▸`)
    backend3
        .dispatch_event(AppEvent::KeyInput('▸'))
        .expect("type pending prefix");
    let export_resp = backend3
        .dispatch_event(AppEvent::RequestExport { strict: true })
        .expect("request strict export");
    assert!(export_resp.effects.iter().any(|eff| matches!(
        eff,
        Effect::ExportResult(Err(AppError::StrictExportBlocked(_)))
    )));

    fs::remove_dir_all(&dir).expect("cleanup temp dir");
}

#[cfg(unix)]
#[test]
fn test_d147_desktop_backend_disk_before_memory_on_save_failure() {
    use std::os::unix::fs::PermissionsExt;

    let dir = temp_dir("d147_disk_before_memory");
    let lib_path = dir.join("library.json");
    let clipboard = Arc::new(RecordingClipboard::default());

    let backend =
        DesktopBackend::initialize_with_path(lib_path.clone(), clipboard).expect("init backend");
    let initial_settings = AppSettings {
        theme: ThemePreference::Light,
        delimiter_style: DelimiterStyle::None,
        preview_scale_pct: Some(100),
        config_path: Some(lib_path.display().to_string()),
        ..Default::default()
    };
    backend
        .dispatch_event(AppEvent::UpdateSettings(initial_settings.clone()))
        .expect("initial save succeeds");
    backend
        .save_user_formula(
            "Saved Formula".to_owned(),
            "自定义".to_owned(),
            "x + 1".to_owned(),
            String::new(),
        )
        .expect("initial formula save succeeds");

    // Lock directory read-only so disk writes fail with PermissionDenied
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).expect("chmod 0555");

    let next_settings = AppSettings {
        theme: ThemePreference::Dark,
        delimiter_style: DelimiterStyle::BlockDollar,
        preview_scale_pct: Some(150),
        config_path: Some(lib_path.display().to_string()),
        ..Default::default()
    };
    let settings_err = backend.dispatch_event(AppEvent::UpdateSettings(next_settings));
    let formula_err = backend.save_user_formula(
        "Phantom Formula".to_owned(),
        "自定义".to_owned(),
        "y + 2".to_owned(),
        String::new(),
    );
    let reset_err = backend.dispatch_event(AppEvent::ResetSettingsConfirmed);

    // Restore permissions before assertions/cleanup
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).expect("chmod 0755");

    assert!(
        settings_err.is_err(),
        "UpdateSettings must fail on readonly dir"
    );
    assert!(
        formula_err.is_err(),
        "save_user_formula must fail on readonly dir"
    );
    assert!(
        reset_err.is_err(),
        "ResetSettingsConfirmed must fail on readonly dir"
    );

    // In-memory state must remain untouched on disk failure
    let snap = backend.snapshot().expect("snapshot");
    assert_eq!(
        snap.settings.theme,
        ThemePreference::Light,
        "In-memory theme must not mutate when disk write fails"
    );
    assert_eq!(
        snap.settings.preview_scale_pct,
        Some(100),
        "In-memory preview_scale_pct must not mutate when disk write fails"
    );
    let formulas = backend.user_formulas().expect("user formulas");
    assert_eq!(
        formulas.len(),
        1,
        "In-memory user_formulas must not keep phantom entry when disk write fails"
    );
    assert_eq!(formulas[0].name, "Saved Formula");

    fs::remove_dir_all(&dir).expect("cleanup temp dir");
}

#[test]
fn test_d148_and_d150_recovery_write_lock_and_request_restore_backup_none() {
    let dir = temp_dir("d148_recovery_lock");
    let lib_path = dir.join("library.json");
    let clipboard = Arc::new(RecordingClipboard::default());

    {
        let backend = DesktopBackend::initialize_with_path(lib_path.clone(), clipboard.clone())
            .expect("init");
        backend
            .save_user_formula(
                "Backed Up Formula".to_owned(),
                "自定义".to_owned(),
                "\\frac{1}{2}".to_owned(),
                String::new(),
            )
            .expect("save formula");
        let mut dark = AppSettings {
            theme: ThemePreference::Dark,
            config_path: Some(lib_path.display().to_string()),
            ..Default::default()
        };
        dark.preview_scale_pct = Some(130);
        backend
            .dispatch_event(AppEvent::UpdateSettings(dark.clone()))
            .expect("save settings creates backup");
        dark.preview_scale_pct = Some(140);
        backend
            .dispatch_event(AppEvent::UpdateSettings(dark))
            .expect("second save rotates Dark + formula into backup");
    }

    // Inject corrupt primary library.json
    fs::write(&lib_path, "{corrupt json").expect("corrupt file");
    let backend2 =
        DesktopBackend::initialize_with_path(lib_path.clone(), clipboard).expect("reopen corrupt");
    let snap2 = backend2.snapshot().expect("snap2");
    assert!(snap2.recovery.is_some(), "recovery state must be active");
    assert!(
        !lib_path.exists(),
        "quarantined primary file must not be recreated yet"
    );

    // All overwrite actions must be blocked while recovery is unresolved
    let update_err = backend2.dispatch_event(AppEvent::UpdateSettings(AppSettings::default()));
    assert!(
        update_err.is_err(),
        "UpdateSettings must be blocked during unresolved recovery"
    );
    let formula_err = backend2.save_user_formula(
        "Blocked".to_owned(),
        "自定义".to_owned(),
        "x+1".to_owned(),
        String::new(),
    );
    assert!(
        formula_err.is_err(),
        "save_user_formula must be blocked during unresolved recovery"
    );
    backend2
        .dispatch_event(AppEvent::KeyInput('x'))
        .expect("type x");
    let snippet_err = backend2.dispatch_event(AppEvent::RequestSaveSnippet);
    assert!(
        snippet_err.is_err(),
        "RequestSaveSnippet must be blocked during unresolved recovery"
    );
    assert!(
        !lib_path.exists(),
        "library.json must NOT be written while recovery is unresolved"
    );
    assert!(
        backend2
            .snapshot()
            .expect("snap still recovery")
            .recovery
            .is_some(),
        "recovery state must remain active"
    );

    // D-150: AppEvent::RequestRestoreBackup (which emits HostAction::RestoreBackup { backup_path })
    // must restore cleanly and clear recovery
    let restored_resp = backend2
        .dispatch_event(AppEvent::RequestRestoreBackup)
        .expect("RequestRestoreBackup must restore backup and clear recovery");
    assert!(restored_resp.snapshot.recovery.is_none());
    assert_eq!(restored_resp.snapshot.settings.theme, ThemePreference::Dark);
    assert_eq!(
        backend2.user_formulas().expect("restored formulas").len(),
        1
    );

    fs::remove_dir_all(&dir).expect("cleanup temp dir");
}

#[test]
fn test_d150_nonfatal_startup_on_unsupported_schema_oversized_and_eisdir() {
    let clipboard = Arc::new(RecordingClipboard::default());

    // 1. Unsupported schema_version: 99 -> non-fatal startup with recovery surfaced, file untouched
    {
        let dir = temp_dir("d150_schema99");
        let lib_path = dir.join("library.json");
        let payload = r#"{"schema_version": 99, "future": true}"#;
        fs::write(&lib_path, payload).expect("write v99");
        let backend = DesktopBackend::initialize_with_path(lib_path.clone(), clipboard.clone())
            .expect("UnsupportedSchemaVersion must not exit(1) / fail startup");
        let snap = backend.snapshot().expect("snap");
        let rec = snap.recovery.expect("recovery must be surfaced for v99");
        assert!(rec.error.contains("99"));
        assert_eq!(
            fs::read_to_string(&lib_path).expect("read untouched v99"),
            payload,
            "Unknown schema file must not be overwritten"
        );
        assert!(
            backend.restore_backup(None).is_err(),
            "restore_backup(None) without candidate must return Err"
        );
        fs::remove_dir_all(&dir).expect("cleanup");
    }

    // 2. EISDIR: directory at library.json -> non-fatal startup with recovery surfaced, writes blocked
    {
        let dir = temp_dir("d150_eisdir");
        let lib_path = dir.join("library.json");
        fs::create_dir(&lib_path).expect("create dir at library.json");
        let backend = DesktopBackend::initialize_with_path(lib_path.clone(), clipboard)
            .expect("EISDIR must not fail startup");
        let snap = backend.snapshot().expect("snap");
        assert!(
            snap.recovery.is_some(),
            "EISDIR must surface recovery error"
        );
        assert!(lib_path.is_dir());
        assert!(
            backend
                .dispatch_event(AppEvent::UpdateSettings(AppSettings::default()))
                .is_err()
        );
        fs::remove_dir_all(&dir).expect("cleanup");
    }
}

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use mathslot_store::{
    Catalog, LibraryFile, LoadOutcome, RenderBackendPreference, Settings, ShortcutSettings, Store,
    ThemePreference, dry_run_migrate, load_or_recover,
};

fn unique_temp_dir(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "mathslot_t34_store_{prefix}_{}_{}",
        std::process::id(),
        nanos
    ));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[test]
fn d116_legacy_v3_json_without_new_settings_fields_deserializes_with_defaults() {
    let dir = unique_temp_dir("legacy_v3");
    let lib_path = dir.join("library.json");

    // Legacy v3 JSON missing theme, render_backend, shortcuts
    let legacy_v3 = r#"{
  "schema_version": 3,
  "custom_formats": [],
  "snippets": [],
  "user_formulas": [
    {
      "id": "01933b4a-1111-7000-8000-000000000001",
      "name": "测试公式",
      "category": "自定义",
      "source": "▸f1;2;",
      "desc": "legacy entry",
      "tags": ["test"],
      "created_at": 1700000001
    }
  ],
  "overrides": [],
  "settings": {
    "delimiter_style": "inline_dollar",
    "preview_scale_pct": 125
  }
}"#;

    let (parsed, report) =
        dry_run_migrate(legacy_v3, Catalog::builtin()).expect("legacy v3 must parse cleanly");
    assert!(report.is_none(), "v3 must not trigger migration report");
    assert_eq!(
        parsed.settings.delimiter_style.as_deref(),
        Some("inline_dollar")
    );
    assert_eq!(parsed.settings.preview_scale_pct, Some(125));
    assert_eq!(parsed.settings.theme, ThemePreference::System);
    assert_eq!(
        parsed.settings.render_backend,
        RenderBackendPreference::MathJax
    );
    assert_eq!(parsed.settings.shortcuts, ShortcutSettings::default());
    assert_eq!(parsed.user_formulas.len(), 1);

    fs::write(&lib_path, legacy_v3).expect("write legacy v3 file");
    let outcome = load_or_recover(&lib_path).expect("load legacy v3");
    match outcome {
        LoadOutcome::Loaded { file, .. } => {
            assert_eq!(
                file.settings.delimiter_style.as_deref(),
                Some("inline_dollar")
            );
            assert_eq!(file.settings.theme, ThemePreference::System);
            assert_eq!(
                file.settings.render_backend,
                RenderBackendPreference::MathJax
            );
            assert_eq!(file.settings.shortcuts, ShortcutSettings::default());
        }
        other => panic!("Expected LoadOutcome::Loaded, got {other:?}"),
    }

    if dir.exists() {
        fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }
}

#[test]
fn d116_from_user_library_with_settings_and_store_save_preserve_custom_settings_roundtrip() {
    let dir = unique_temp_dir("roundtrip");
    let lib_path = dir.join("library.json");
    let catalog = Catalog::builtin();

    let custom_shortcuts = ShortcutSettings {
        copy_latex: "Mod+Alt+C".to_owned(),
        focus_editor: "Alt+I".to_owned(),
        open_settings: "Mod+Shift+P".to_owned(),
        ..ShortcutSettings::default()
    };
    let custom_settings = Settings {
        delimiter_style: Some("block_dollar".to_owned()),
        preview_scale_pct: Some(150),
        theme: ThemePreference::Dark,
        render_backend: RenderBackendPreference::LatexRust,
        shortcuts: custom_shortcuts.clone(),
    };

    let empty_user_lib = LibraryFile::empty_v3().to_user_library(catalog);
    let constructed = LibraryFile::from_user_library_with_settings(
        &empty_user_lib,
        catalog,
        custom_settings.clone(),
    );
    assert_eq!(constructed.settings, custom_settings);

    // Save through Store and verify subsequent user library saves preserve custom settings
    let mut store = Store::new(lib_path.clone());
    store.set_settings(custom_settings.clone());
    store
        .save_user_library(&empty_user_lib, catalog)
        .expect("initial store save must succeed");

    // Save again with same/modified user library without explicitly re-passing settings
    store
        .save_user_library(&empty_user_lib, catalog)
        .expect("subsequent store save must succeed");

    let reloaded = load_or_recover(&lib_path).expect("reload saved store file");
    match reloaded {
        LoadOutcome::Loaded { file, .. } => {
            assert_eq!(file.settings, custom_settings);
            assert_eq!(file.settings.theme, ThemePreference::Dark);
            assert_eq!(
                file.settings.render_backend,
                RenderBackendPreference::LatexRust
            );
            assert_eq!(file.settings.shortcuts.copy_latex, "Mod+Alt+C");
            assert_eq!(file.settings.shortcuts.focus_editor, "Alt+I");
        }
        other => panic!("Expected LoadOutcome::Loaded, got {other:?}"),
    }

    if dir.exists() {
        fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }
}

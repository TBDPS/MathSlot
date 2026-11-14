use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use mathslot_store::{
    CURRENT_LIBRARY_SCHEMA_VERSION, Catalog, LibraryFile, LoadOutcome, Settings, Store, StoreError,
    UserFormula, load_or_recover_with_catalog,
};

fn temp_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("mathslot_t35_store_{name}_{nanos}"));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[test]
fn test_store_restore_from_backup_and_reset_empty_and_export_import() {
    let dir = temp_dir("restore_reset_import_export");
    let lib_path = dir.join("library.json");
    let catalog = Catalog::builtin();

    let mut store = Store::new(lib_path.clone());
    let initial_file = LibraryFile {
        schema_version: CURRENT_LIBRARY_SCHEMA_VERSION,
        custom_formats: Vec::new(),
        snippets: Vec::new(),
        user_formulas: vec![UserFormula {
            id: "01933b4a-1111-7000-8000-000000000011".into(),
            name: "Quadratic".into(),
            category: "algebra".into(),
            source: "▸f-b;2a;".into(),
            desc: "Quadratic".into(),
            tags: vec!["algebra".into()],
            created_at: 1700000001,
        }],
        overrides: Vec::new(),
        settings: Settings {
            delimiter_style: Some("inline_dollar".into()),
            preview_scale_pct: Some(125),
            ..Settings::default()
        },
    };
    store
        .save_file(&initial_file)
        .expect("save initial library");

    // Save a second time so a `.bak-*` backup is rotated and exists alongside the primary file
    store
        .save_file(&initial_file)
        .expect("save second time to create backup");

    // Corrupt primary file and recover -> produces backup candidate
    fs::write(&lib_path, "{corrupt json").expect("write corrupt library");
    let outcome = load_or_recover_with_catalog(&lib_path, catalog).expect("recover");
    let backup = match outcome {
        LoadOutcome::CorruptQuarantined {
            corrupt_path,
            backup_candidate,
            ..
        } => {
            assert!(corrupt_path.exists());
            backup_candidate.expect("backup candidate expected")
        }
        other => panic!("expected CorruptQuarantined, got {other:?}"),
    };

    // Restore from backup should succeed, update settings, and load saved formula
    let restored = store
        .restore_from_backup(&backup.path, catalog)
        .expect("restore_from_backup must succeed");
    assert_eq!(restored.schema_version, CURRENT_LIBRARY_SCHEMA_VERSION);
    assert_eq!(restored.user_formulas.len(), 1);
    assert_eq!(
        restored.user_formulas[0].id,
        "01933b4a-1111-7000-8000-000000000011"
    );
    assert_eq!(store.settings().preview_scale_pct, Some(125));
    assert!(store.last_revision().is_some());

    // Export library JSON
    let restored_lib = restored.to_user_library(catalog);
    let exported = store
        .export_library_json(&restored_lib, catalog)
        .expect("export_library_json must succeed");
    assert!(exported.contains("01933b4a-1111-7000-8000-000000000011"));

    // Reset empty should clear formulas & write empty v3 file
    let empty = store.reset_empty().expect("reset_empty must succeed");
    assert!(empty.user_formulas.is_empty());
    assert_eq!(empty.schema_version, CURRENT_LIBRARY_SCHEMA_VERSION);

    // Import exported JSON back into store
    let (imported, _report) = store
        .import_library_json(&exported, catalog)
        .expect("import_library_json must succeed");
    assert_eq!(imported.user_formulas.len(), 1);
    assert_eq!(
        imported.user_formulas[0].id,
        "01933b4a-1111-7000-8000-000000000011"
    );

    // Import rejects builtin=true inside user_formulas
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
    let err = store
        .import_library_json(&bad_builtin, catalog)
        .expect_err("builtin flag must be rejected");
    assert!(matches!(err, StoreError::BuiltinImportRejected(_)));

    if dir.exists() {
        fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }
}

#[test]
fn test_settings_delimiter_style_normalization() {
    let mut settings = Settings::default();
    settings.set_delimiter_style("inline");
    assert_eq!(settings.canonical_delimiter_style(), "inline_dollar");

    settings.set_delimiter_style("block");
    assert_eq!(settings.canonical_delimiter_style(), "block_dollar");

    settings.set_delimiter_style("markdown_code");
    assert_eq!(settings.canonical_delimiter_style(), "markdown_code");

    settings.set_delimiter_style("none");
    assert_eq!(settings.canonical_delimiter_style(), "none");
}

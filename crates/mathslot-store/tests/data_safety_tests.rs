use std::collections::HashSet;
use std::ffi::OsStr;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier};

use mathslot_core::library::{
    AutoJoin, CustomFormat, FormulaEntry, FormulaLibrary, FormulaSnippet, LayoutKind, UserLibrary,
};
use mathslot_core::presets::PRESET_LIBRARY;
use mathslot_store::{
    CURRENT_LIBRARY_SCHEMA_VERSION, Catalog, LibraryFile, LoadOutcome, Store, StoreError,
    SyncableWrite, ThemePreference, UserFormula, WriteCondition, default_library_path,
    dry_run_migrate, import_formulas_json, is_valid_uuid_v7, library_path_for_linux,
    library_path_for_macos, library_path_for_windows, list_backups, load_or_recover, next_uuid_v7,
    save_atomic, save_atomic_with_retention, save_with_writer_hook,
};

struct TempSandbox {
    root: PathBuf,
}

impl TempSandbox {
    fn new(prefix: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "mathslot_store_test_{prefix}_{}_{}",
            std::process::id(),
            nanos
        ));
        std::fs::create_dir_all(&root).expect("create sandbox dir");
        Self { root }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
}

impl Drop for TempSandbox {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(e) =
                std::fs::set_permissions(&self.root, std::fs::Permissions::from_mode(0o755))
            {
                eprintln!("cleanup chmod warning: {e}");
            }
            if let Ok(entries) = std::fs::read_dir(&self.root) {
                for entry in entries.flatten() {
                    if let Err(e) = std::fs::set_permissions(
                        entry.path(),
                        std::fs::Permissions::from_mode(0o755),
                    ) {
                        eprintln!("cleanup entry chmod warning: {e}");
                    }
                }
            }
        }
        if self.root.exists()
            && let Err(e) = std::fs::remove_dir_all(&self.root)
        {
            eprintln!("cleanup remove_dir_all warning: {e}");
        }
    }
}

struct QuotaSyncWriter {
    inner: std::fs::File,
    quota: usize,
    written: usize,
}

impl QuotaSyncWriter {
    fn new(inner: std::fs::File, quota: usize) -> Self {
        Self {
            inner,
            quota,
            written: 0,
        }
    }
}

impl Write for QuotaSyncWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.written >= self.quota {
            return Err(std::io::Error::new(
                std::io::ErrorKind::WriteZero,
                "simulated ENOSPC / disk full",
            ));
        }
        let allowed = (self.quota - self.written).min(buf.len());
        let n = self.inner.write(&buf[..allowed])?;
        self.written += n;
        if n < buf.len() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::WriteZero,
                "simulated ENOSPC mid-write",
            ));
        }
        Ok(n)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

impl SyncableWrite for QuotaSyncWriter {
    fn sync_all_file(&self) -> std::io::Result<()> {
        self.inner.sync_all()
    }
}

fn count_dir_entries(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .expect("read_dir")
        .filter_map(Result::ok)
        .count()
}

fn assert_no_tmp_files(dir: &Path) {
    for entry in std::fs::read_dir(dir).expect("read_dir").flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        assert!(
            !name.contains(".tmp"),
            "No zombie temp files may remain in {}: found {name}",
            dir.display()
        );
    }
}

/// T-DATA-001 (A-DATA-001, D-014):
/// Missing config initializes clean in-memory state with 0 disk writes,
/// serves all 88 built-in presets from compile-time catalog, and never persists builtins.
#[test]
fn t_data_001_not_found_zero_writes_and_88_catalog_presets_not_persisted() {
    let sb = TempSandbox::new("t_data_001");
    let lib_path = sb.path("library.json");

    let outcome = load_or_recover(&lib_path).expect("NotFound must succeed");
    let file = match outcome {
        LoadOutcome::NotFound { file } => file,
        other => panic!("Expected LoadOutcome::NotFound, got {other:?}"),
    };

    assert_eq!(file.schema_version, CURRENT_LIBRARY_SCHEMA_VERSION);
    assert!(file.user_formulas.is_empty());
    assert_eq!(
        count_dir_entries(&sb.root),
        0,
        "NotFound must perform zero disk writes"
    );

    let catalog = Catalog::builtin();
    assert_eq!(
        catalog.presets().len(),
        PRESET_LIBRARY.len(),
        "Catalog must contain all 88 built-in presets"
    );
    assert_eq!(catalog.presets().len(), 88);

    let mut seen_ids = HashSet::new();
    for (idx, (cat_p, core_p)) in catalog
        .presets()
        .iter()
        .zip(PRESET_LIBRARY.iter())
        .enumerate()
    {
        assert!(cat_p.id.starts_with("preset-"));
        assert!(
            !cat_p.id.chars().skip(7).all(|c| c.is_ascii_digit()),
            "Canonical preset ID must be a stable slug, not sequential digits: {}",
            cat_p.id
        );
        assert_eq!(cat_p.legacy_id, format!("preset-{:03}", idx + 1));
        assert_eq!(cat_p.category, core_p.category);
        assert_eq!(cat_p.name, core_p.name);
        match cat_p.id.as_str() {
            "preset-fundamental-theorem-calculus" => {
                assert_eq!(core_p.source, "▸ia;b;f'(x) dx = ▸kgf(x);a;b; = f(b) - f(a)");
                assert_eq!(cat_p.source, "▸ia;b;f'(x) dx = ▸aqf(x);a;b; = f(b) - f(a)");
            }
            "preset-damped-harmonic-oscillator" => {
                assert_eq!(core_p.source, "m ▸ahx; + ▸gg ▸aex; + k x = 0");
                assert_eq!(cat_p.source, "m ▸ahx; + ▸gc ▸aex; + k x = 0");
            }
            "preset-hodge-star-inner-product" => {
                assert_eq!(core_p.source, "▸ga ▸qg *▸gb = ▸kd▸ga;▸gb; ▸go");
                assert_eq!(cat_p.source, "▸ga ▸qg *▸gb = ▸an▸ga, ▸gb; ▸go");
            }
            _ => assert_eq!(cat_p.source, core_p.source),
        }
        assert_eq!(cat_p.desc, core_p.desc);
        assert!(seen_ids.insert(cat_p.id.clone()), "Duplicate preset id");
    }

    let merged = file.to_user_library(catalog);
    assert_eq!(merged.formulas.entries.len(), 88);
    assert!(merged.formulas.entries.iter().all(|e| e.is_builtin));

    let roundtrip_file = LibraryFile::from_user_library(&merged, catalog);
    assert!(roundtrip_file.user_formulas.is_empty());
    assert!(roundtrip_file.overrides.is_empty());

    save_atomic(&lib_path, &roundtrip_file, WriteCondition::Unconditional)
        .expect("Save clean v3 library");
    let on_disk = std::fs::read_to_string(&lib_path).expect("Read saved library.json");
    assert!(
        !on_disk.contains("is_builtin"),
        "Persisted v3 library.json must not contain built-in formulas"
    );
    assert!(
        !on_disk.contains("欧拉恒等式"),
        "Persisted v3 library.json must not persist unmodified built-in presets"
    );
}

/// T-DATA-002 (A-DATA-002, A-DATA-003, D-005):
/// Simulated ENOSPC/WriteZero during temp write leaves original file intact and creates 0 backups;
/// PermissionDenied returns Err(PermissionDenied) on both save and load.
#[test]
fn t_data_002_enospc_write_zero_and_permission_denied() {
    let sb = TempSandbox::new("t_data_002");
    let lib_path = sb.path("library.json");

    let mut initial = LibraryFile::empty_v3();
    initial.user_formulas.push(UserFormula {
        id: next_uuid_v7(),
        name: "Protected Formula".to_owned(),
        category: "自定义".to_owned(),
        source: "a^2 + b^2 = c^2".to_owned(),
        desc: "Initial valid formula".to_owned(),
        tags: vec!["pythagoras".to_owned()],
        created_at: 1_700_000_000,
    });

    let rev = save_atomic(&lib_path, &initial, WriteCondition::Unconditional)
        .expect("Initial save succeeds");
    let original_bytes = std::fs::read(&lib_path).expect("read original bytes");
    let backups_before = list_backups(&lib_path).len();

    let mut updated = initial.clone();
    updated.user_formulas.push(UserFormula {
        id: next_uuid_v7(),
        name: "Doomed Formula".to_owned(),
        category: "自定义".to_owned(),
        source: "x + y = z".to_owned(),
        desc: "Should fail on ENOSPC".to_owned(),
        tags: Vec::new(),
        created_at: 1_700_000_001,
    });

    let err = save_with_writer_hook(
        &lib_path,
        &updated,
        WriteCondition::IfUnmodified(Some(rev)),
        5,
        |file| QuotaSyncWriter::new(file, 48),
    )
    .expect_err("Simulated disk full must return Err");
    assert!(
        matches!(err, StoreError::Io { .. }),
        "Expected StoreError::Io(WriteZero), got {err:?}"
    );

    assert_eq!(
        std::fs::read(&lib_path).expect("read after failed save"),
        original_bytes,
        "Original library.json must remain byte-for-byte intact after WriteZero"
    );
    assert_eq!(
        list_backups(&lib_path).len(),
        backups_before,
        "Failed temp write must not rotate or create backups"
    );
    assert_no_tmp_files(&sb.root);

    // PermissionDenied on read-only directory
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&sb.root, std::fs::Permissions::from_mode(0o555))
            .expect("chmod dir readonly");
        let ro_err = save_atomic(&lib_path, &updated, WriteCondition::Unconditional)
            .expect_err("Saving inside readonly dir must fail");
        assert!(
            matches!(ro_err, StoreError::PermissionDenied { .. }),
            "Expected StoreError::PermissionDenied, got {ro_err:?}"
        );
        std::fs::set_permissions(&sb.root, std::fs::Permissions::from_mode(0o755))
            .expect("restore dir writable");

        // Unreadable file must return PermissionDenied, never NotFound
        std::fs::set_permissions(&lib_path, std::fs::Permissions::from_mode(0o000))
            .expect("chmod file unreadable");
        let load_err = load_or_recover(&lib_path);
        std::fs::set_permissions(&lib_path, std::fs::Permissions::from_mode(0o644))
            .expect("restore file readable");
        assert!(
            matches!(load_err, Err(StoreError::PermissionDenied { .. })),
            "Unreadable file must return Err(PermissionDenied), got {load_err:?}"
        );
    }
}

/// T-DATA-003 (A-DATA-005, D-006, D-102):
/// 1000-burst UUIDv7 generation + FormulaLibrary upsert has 0 collisions and strictly monotonic IDs;
/// optimistic concurrency check detects stale writes with StoreError::Conflict;
/// 8-thread concurrent save stress test produces zero corruption and zero zombie .tmp files.
#[test]
fn t_data_003_1000_burst_uuidv7_conflict_and_concurrent_saves() {
    let mut ids = Vec::with_capacity(1000);
    for _ in 0..1000 {
        let id = next_uuid_v7();
        assert!(is_valid_uuid_v7(&id), "Invalid RFC-9562 UUIDv7: {id}");
        ids.push(id);
    }
    let unique: HashSet<&String> = ids.iter().collect();
    assert_eq!(unique.len(), 1000, "All 1000 UUIDv7 IDs must be unique");
    for w in ids.windows(2) {
        assert!(
            w[0] < w[1],
            "UUIDv7 IDs must be strictly monotonically increasing: {} !< {}",
            w[0],
            w[1]
        );
    }

    // Core FormulaLibrary::upsert 1000-burst + persistence roundtrip
    let mut core_lib = FormulaLibrary {
        entries: Vec::new(),
    };
    for i in 0..1000 {
        let id = core_lib
            .upsert(FormulaEntry {
                id: String::new(),
                name: format!("Formula #{i}"),
                category: "压力测试".to_owned(),
                source: format!("x_{i} + 1"),
                desc: String::new(),
                tags: Vec::new(),
                is_builtin: false,
                created_at: 1_700_000_000,
            })
            .expect("upsert succeeds");
        assert!(is_valid_uuid_v7(&id), "Core upsert must emit UUIDv7: {id}");
    }
    assert_eq!(core_lib.entries.len(), 1000);

    let sb = TempSandbox::new("t_data_003");
    let lib_path = sb.path("library.json");
    let catalog = Catalog::builtin();

    let user_lib = UserLibrary {
        custom_formats: Vec::new(),
        snippets: Vec::new(),
        formulas: core_lib,
    };
    let file = LibraryFile::from_user_library(&user_lib, catalog);
    assert_eq!(file.user_formulas.len(), 1000);

    // Instance A starts from NotFound, Instance B saves first -> Instance A IfUnmodified(None) conflicts!
    let rev_b = save_atomic(&lib_path, &file, WriteCondition::IfUnmodified(None))
        .expect("First writer succeeds");
    let conflict_from_none = save_atomic(&lib_path, &file, WriteCondition::IfUnmodified(None))
        .expect_err("Stale writer starting from NotFound must hit Conflict");
    assert!(matches!(conflict_from_none, StoreError::Conflict { .. }));

    // Instance B updates -> Instance A holding rev_b hits Conflict
    let mut file_b2 = file.clone();
    file_b2.user_formulas[0].name = "Updated by B".to_owned();
    let rev_b2 = save_atomic(
        &lib_path,
        &file_b2,
        WriteCondition::IfUnmodified(Some(rev_b.clone())),
    )
    .expect("Writer with current rev_b succeeds");
    assert_ne!(rev_b, rev_b2);

    let mut file_a2 = file.clone();
    file_a2.user_formulas[0].name = "Stale overwrite by A".to_owned();
    let conflict_stale = save_atomic(
        &lib_path,
        &file_a2,
        WriteCondition::IfUnmodified(Some(rev_b)),
    )
    .expect_err("Writer holding stale rev_b must hit Conflict");
    assert!(matches!(conflict_stale, StoreError::Conflict { .. }));

    // Verify B's update was NOT overwritten
    match load_or_recover(&lib_path).expect("reload") {
        LoadOutcome::Loaded { file: loaded, .. } => {
            assert_eq!(loaded.user_formulas[0].name, "Updated by B");
            assert_eq!(loaded.user_formulas.len(), 1000);
        }
        other => panic!("Expected Loaded, got {other:?}"),
    }

    // 8-thread concurrent save stress test (no JSON tearing, no zombie .tmp)
    let barrier = Arc::new(Barrier::new(8));
    let mut handles = Vec::new();
    for tid in 0..8 {
        let b = Arc::clone(&barrier);
        let p = lib_path.clone();
        handles.push(std::thread::spawn(move || {
            b.wait();
            for iter in 0..10 {
                let mut f = LibraryFile::empty_v3();
                f.user_formulas.push(UserFormula {
                    id: next_uuid_v7(),
                    name: format!("T{tid}-I{iter}"),
                    category: "并发".to_owned(),
                    source: "a + b".to_owned(),
                    desc: String::new(),
                    tags: Vec::new(),
                    created_at: 1_700_000_000,
                });
                save_atomic(&p, &f, WriteCondition::Unconditional)
                    .expect("concurrent unconditional save must succeed under lock");
            }
        }));
    }
    for h in handles {
        h.join().expect("worker thread must not panic");
    }
    assert_no_tmp_files(&sb.root);
    assert!(matches!(
        load_or_recover(&lib_path).expect("load after stress"),
        LoadOutcome::Loaded { .. }
    ));
}

/// T-DATA-004 (A-DATA-001, A-DATA-004, D-005):
/// Backup rotation stays bounded to 3..=5 generations;
/// corrupt JSON / invalid UTF-8 is quarantined to library.corrupt-*.json,
/// newest valid backup candidate is attached, and backups remain intact.
#[test]
fn t_data_004_corrupt_quarantine_backup_candidate_and_rotation_bounds() {
    let sb = TempSandbox::new("t_data_004");
    let lib_path = sb.path("library.json");

    // Save 7 generations -> keep at most 5 backups (>= 3)
    for gen_idx in 1..=7 {
        let mut f = LibraryFile::empty_v3();
        f.user_formulas.push(UserFormula {
            id: next_uuid_v7(),
            name: format!("Gen {gen_idx}"),
            category: "版本".to_owned(),
            source: format!("x^{gen_idx}"),
            desc: String::new(),
            tags: Vec::new(),
            created_at: 1_700_000_000 + gen_idx as u64,
        });
        save_atomic_with_retention(&lib_path, &f, WriteCondition::Unconditional, 5)
            .expect("generation save");
    }

    let backups = list_backups(&lib_path);
    assert!(
        (3..=5).contains(&backups.len()),
        "Backup count must stay within 3..=5, got {}",
        backups.len()
    );

    // Corrupt payloads: truncated JSON, invalid UTF-8, trailing garbage, `tru`
    let payloads: &[&[u8]] = &[
        b"{ \"schema_version\": 3, \"user_formulas\": [ { broken",
        &[0xff, 0xfe, 0x00, 0x80, 0xfa],
        b"{\"schema_version\": 3} TRAILING_GARBAGE",
        b"{\"schema_version\": 3, \"flag\": tru}",
    ];

    for (idx, payload) in payloads.iter().enumerate() {
        std::fs::write(&lib_path, payload).expect("inject corrupt payload");
        let outcome = load_or_recover(&lib_path).expect("corrupt load returns outcome");
        match outcome {
            LoadOutcome::CorruptQuarantined {
                corrupt_path,
                backup_candidate,
                error,
            } => {
                assert!(
                    corrupt_path.exists(),
                    "Quarantined file must exist for case {idx}"
                );
                let fname = corrupt_path
                    .file_name()
                    .expect("quarantined file name")
                    .to_string_lossy()
                    .to_string();
                assert!(
                    fname.starts_with("library.corrupt-") && fname.ends_with(".json"),
                    "Unexpected quarantine filename: {fname}"
                );
                assert_eq!(
                    std::fs::read(&corrupt_path).expect("read quarantined"),
                    *payload,
                    "Quarantined file must preserve exact original corrupt bytes"
                );
                assert!(!error.is_empty());

                let cand = backup_candidate.expect("Valid backup candidate must be surfaced");
                assert_eq!(cand.file.user_formulas.len(), 1);
                assert_eq!(cand.file.user_formulas[0].name, "Gen 6");
            }
            other => panic!("Case {idx}: expected CorruptQuarantined, got {other:?}"),
        }
    }

    // Backups remain intact after quarantine inspections
    assert!(
        (3..=5).contains(&list_backups(&lib_path).len()),
        "Backups must remain intact"
    );
}

/// T-DATA-005 (A-DATA-006, D-013, D-014):
/// Lossless v1/v2 -> v3 migration:
/// - backs up pre-migration v2 file before committing v3;
/// - migrates `user-<secs>` IDs to UUIDv7 with id_migration_map;
/// - strips unmodified 87 builtins and converts modified builtin into PresetOverride;
/// - preserves custom_formats (including Env + autoJoin) and snippets;
/// - rejects unknown schema_version (0, 99) without modifying disk;
/// - rejects/normalizes `is_builtin: true` on import.
#[test]
fn t_data_005_v1_v2_to_v3_lossless_migration_and_builtin_import_guard() {
    let sb = TempSandbox::new("t_data_005");
    let lib_path = sb.path("library.json");
    let catalog = Catalog::builtin();

    // Build a realistic v2 legacy JSON with 88 builtins (1 modified) + 1 user-<secs> formula
    let mut legacy = UserLibrary::default_seeded();
    legacy.formulas.entries[0].name = "我的欧拉恒等式".to_owned(); // modified builtin preset-001
    legacy.formulas.entries.push(FormulaEntry {
        id: "user-1710123456".to_owned(),
        name: "用户自定义公式".to_owned(),
        category: "自建".to_owned(),
        source: "a + b = c".to_owned(),
        desc: "保留说明".to_owned(),
        tags: vec!["legacy".to_owned()],
        is_builtin: false,
        created_at: 1_710_123_456,
    });
    legacy
        .upsert_custom(CustomFormat {
            item_key: 'z',
            label: "二阶矩阵".to_owned(),
            glyph_hint: "[2x2]".to_owned(),
            slot_roles: vec!["a".into(), "b".into(), "c".into(), "d".into()],
            latex_template: "$1".into(),
            scheme_a_name: "mat2".into(),
            layout: LayoutKind::Env {
                env: "bmatrix".into(),
                cols: 2,
            },
            auto_join: Some(AutoJoin {
                base_slot: 0,
                cond_slot: 1,
                macro_tex: "\\to".into(),
            }),
        })
        .expect("custom format");
    legacy
        .upsert_snippet(FormulaSnippet {
            item_key: 'm',
            label: "快捷片段M".to_owned(),
            stream_source: "▸fx;y;".to_owned(),
        })
        .expect("snippet");

    let v2_json = legacy.to_json_pretty();
    std::fs::write(&lib_path, &v2_json).expect("write legacy v2");

    // Dry-run check first
    let (dry_file, dry_report) = dry_run_migrate(&v2_json, catalog).expect("dry run succeeds");
    let report = dry_report.expect("v2 -> v3 must produce migration report");
    assert_eq!(report.from_version, 2);
    assert_eq!(report.to_version, 3);
    assert_eq!(report.stripped_builtin_count, 87);
    assert_eq!(report.converted_override_count, 1);
    let new_user_id = report
        .id_migration_map
        .get("user-1710123456")
        .expect("id_migration_map must map user-1710123456");
    assert!(is_valid_uuid_v7(new_user_id));
    assert_eq!(dry_file.user_formulas.len(), 1);
    assert_eq!(dry_file.overrides.len(), 1);
    assert_eq!(dry_file.overrides[0].preset_id, "preset-euler-identity");
    assert_eq!(
        dry_file.overrides[0].name.as_deref(),
        Some("我的欧拉恒等式")
    );

    // Real load commits v3 after backing up v2
    let outcome = load_or_recover(&lib_path).expect("load_or_recover migrates v2");
    match outcome {
        LoadOutcome::Loaded { file, migrated, .. } => {
            let mig = migrated.expect("migrated report present");
            assert!(
                mig.backup_path.as_ref().is_some_and(|p| p.exists()),
                "Pre-migration backup must exist on disk"
            );
            assert_eq!(file.schema_version, 3);
            assert_eq!(file.user_formulas.len(), 1);
            assert_eq!(file.user_formulas[0].name, "用户自定义公式");
            let merged = file.to_user_library(catalog);
            assert_eq!(merged.formulas.entries.len(), 89);
            assert_eq!(merged.formulas.entries[0].name, "我的欧拉恒等式");
            assert!(merged.lookup_custom('z').is_some());
            assert!(merged.lookup_snippet('m').is_some());
        }
        other => panic!("Expected Loaded, got {other:?}"),
    }

    let committed_disk = std::fs::read_to_string(&lib_path).expect("read committed v3");
    assert!(committed_disk.contains("\"schema_version\": 3"));
    assert!(
        !committed_disk.contains("is_builtin"),
        "Migrated v3 file must not persist is_builtin entries"
    );

    // Legacy v1 (no schema_version, no formulas) dry-run migration
    let v1_json = r#"{"customFormats":[],"snippets":[{"key":"k","label":"S","source":"x^2"}]}"#;
    let (v1_file, v1_rep) = dry_run_migrate(v1_json, catalog).expect("v1 migration");
    assert_eq!(v1_rep.expect("v1 report").from_version, 1);
    assert_eq!(v1_file.snippets.len(), 1);
    assert!(v1_file.user_formulas.is_empty());

    // Unsupported schema versions 0 and 99 must be rejected without touching disk
    for bad_ver in [0_u64, 99] {
        let bad_path = sb.path(&format!("bad_v{bad_ver}.json"));
        let bad_payload = format!("{{\"schema_version\": {bad_ver}}}");
        std::fs::write(&bad_path, &bad_payload).expect("write bad version");
        let err = load_or_recover(&bad_path).expect_err("unknown schema_version must error");
        assert!(matches!(err, StoreError::UnsupportedSchemaVersion(v) if v == bad_ver));
        assert_eq!(
            std::fs::read_to_string(&bad_path).expect("read untouched"),
            bad_payload
        );
    }

    // D-014: import_formulas_json rejects or normalizes is_builtin: true
    let malicious_import = r#"[{"id":"preset-fake","name":"Fake Builtin","category":"x","source":"x+1","is_builtin":true}]"#;
    let strict_err = import_formulas_json(malicious_import, true)
        .expect_err("strict mode rejects is_builtin: true");
    assert!(matches!(strict_err, StoreError::BuiltinImportRejected(_)));
    let normalized =
        import_formulas_json(malicious_import, false).expect("normalizing mode strips is_builtin");
    assert_eq!(normalized.len(), 1);
    assert_eq!(normalized[0].name, "Fake Builtin");
}

/// T-DATA-006 (D-022, INV-010):
/// 3-OS pure config path resolution helpers + dirs::config_dir() integration.
#[test]
fn t_data_006_three_os_path_resolution() {
    let linux_xdg = library_path_for_linux(
        Some(OsStr::new("/tmp/custom-xdg")),
        Some(OsStr::new("/home/alice")),
    )
    .expect("linux xdg");
    assert_eq!(
        linux_xdg,
        PathBuf::from("/tmp/custom-xdg")
            .join("mathslot")
            .join("library.json")
    );

    let linux_home =
        library_path_for_linux(None, Some(OsStr::new("/home/alice"))).expect("linux home");
    assert_eq!(
        linux_home,
        PathBuf::from("/home/alice")
            .join(".config")
            .join("mathslot")
            .join("library.json")
    );

    let macos = library_path_for_macos(Some(OsStr::new("/Users/alice"))).expect("macos");
    assert_eq!(
        macos,
        PathBuf::from("/Users/alice")
            .join("Library")
            .join("Application Support")
            .join("mathslot")
            .join("library.json")
    );

    let windows = library_path_for_windows(Some(OsStr::new(r"C:\Users\Alice\AppData\Roaming")))
        .expect("windows");
    assert_eq!(
        windows,
        PathBuf::from(r"C:\Users\Alice\AppData\Roaming")
            .join("mathslot")
            .join("library.json")
    );

    let active_default = default_library_path().expect("default_library_path on host");
    assert!(active_default.ends_with(Path::new("mathslot").join("library.json")));
}

/// T-DATA-007 (D-013):
/// Strict JSON checks reject `tru`, `nul`, `nulll`, `1e`, trailing garbage, invalid escapes,
/// and unknown schema_version in both mathslot-store and mathslot-core.
#[test]
fn t_data_007_strict_json_rejects_malformed_literals_and_trailing_garbage() {
    let catalog = Catalog::builtin();
    let bad_inputs = [
        r#"{"schema_version": 2, "customFormats": [], "snippets": []} garbage"#,
        r#"{"schema_version": 2, "flag": tru}"#,
        r#"{"schema_version": 2, "flag": nul}"#,
        r#"{"schema_version": 2, "flag": nulll}"#,
        r#"{"schema_version": 2, "n": 1e}"#,
        r#"{"schema_version": 2, "s": "bad\qescape"}"#,
        r#"{"schema_version": 99, "customFormats": [], "snippets": []}"#,
        r#"[1] garbage"#,
    ];

    for bad in bad_inputs {
        assert!(
            dry_run_migrate(bad, catalog).is_err(),
            "mathslot-store must reject malformed JSON: {bad}"
        );
        assert!(
            UserLibrary::from_json(bad).is_err(),
            "mathslot-core UserLibrary::from_json must reject malformed JSON: {bad}"
        );
    }

    // D-014 in mathslot-core FormulaLibrary::import_json: imported entries must never keep is_builtin=true
    let mut lib = FormulaLibrary {
        entries: Vec::new(),
    };
    let count = lib
        .import_json(
            r#"[{"id":"","name":"Imported","category":"C","source":"x+1","is_builtin":true}]"#,
            true,
        )
        .expect("import normalizes");
    assert_eq!(count, 1);
    assert!(
        !lib.entries[0].is_builtin,
        "Imported entry must normalize is_builtin=false"
    );
    assert!(
        is_valid_uuid_v7(&lib.entries[0].id),
        "Empty imported ID must use UUIDv7"
    );
}

/// T-DATA-008 (D-150 / D-151, §10.5):
/// Files exceeding MAX_LIBRARY_FILE_BYTES (16 MiB) are rejected on load/import without OOM or quarantining;
/// oversized backup files are skipped when searching for backup candidates.
#[test]
fn t_data_008_oversized_file_rejected_and_oversized_backup_skipped() {
    let sb = TempSandbox::new("t_data_008");
    let lib_path = sb.path("library.json");
    let catalog = Catalog::builtin();

    let oversized_len = 16 * 1024 * 1024 + 1024;
    let oversized_file = std::fs::File::create(&lib_path).expect("create oversized file");
    oversized_file
        .set_len(oversized_len as u64)
        .expect("set_len > 16 MiB");

    let err = load_or_recover(&lib_path).expect_err("oversized library.json must return Err");
    let msg = err.to_string();
    assert!(
        msg.contains("16") || msg.contains("上限") || msg.contains("too large"),
        "Expected size limit error, got: {msg}"
    );
    assert!(
        lib_path.exists(),
        "Oversized file must not be silently deleted or quarantined"
    );

    // Oversized import JSON rejected cleanly
    let huge_json = format!(
        "{{\"schema_version\": 3, \"padding\": \"{}\"}}",
        "a".repeat(oversized_len)
    );
    let mut store = Store::new(sb.path("store_import.json"));
    let import_err = store
        .import_library_json(&huge_json, catalog)
        .expect_err("oversized import JSON must fail");
    assert!(!import_err.to_string().is_empty());

    // Oversized newest .bak-* is skipped in favor of older valid .bak-*
    let lib2 = sb.path("library2.json");
    let mut valid_f = LibraryFile::empty_v3();
    valid_f.user_formulas.push(UserFormula {
        id: next_uuid_v7(),
        name: "Older Valid Backup".to_owned(),
        category: "测试".to_owned(),
        source: "x + 1".to_owned(),
        desc: String::new(),
        tags: Vec::new(),
        created_at: 1_700_000_000,
    });
    save_atomic(&lib2, &valid_f, WriteCondition::Unconditional).expect("save gen1");
    let mut gen2 = valid_f.clone();
    gen2.user_formulas[0].name = "Gen 2".to_owned();
    save_atomic(&lib2, &gen2, WriteCondition::Unconditional).expect("save gen2");

    // Inject an oversized newer .bak-* file
    let huge_bak = sb.path("library2.bak-9999999999999999-999999.json");
    let huge_bak_file = std::fs::File::create(&huge_bak).expect("create huge bak");
    huge_bak_file
        .set_len(oversized_len as u64)
        .expect("set_len huge bak");

    std::fs::write(&lib2, "{broken").expect("corrupt lib2");
    match load_or_recover(&lib2).expect("recover skips huge bak") {
        LoadOutcome::CorruptQuarantined {
            backup_candidate, ..
        } => {
            let cand = backup_candidate.expect("must fall back to older valid backup");
            assert_eq!(cand.file.user_formulas[0].name, "Older Valid Backup");
        }
        other => panic!("Expected CorruptQuarantined, got {other:?}"),
    }
}

/// T-DATA-009 (D-150 / D-151):
/// Covers:
/// - corrupt with no backup (`backup_candidate: None`);
/// - corrupt newest `.bak-*` skipping to older valid `.bak-*`;
/// - all `.bak-*` corrupt returning `backup_candidate: None`;
/// - directory occupying `library.json` (`EISDIR`) returning Err without destroying dir;
/// - malformed field types / missing required fields boundary in `dry_run_migrate`.
#[test]
fn t_data_009_no_backup_corrupt_backup_fallback_eisdir_and_field_boundaries() {
    let sb = TempSandbox::new("t_data_009");
    let catalog = Catalog::builtin();

    // 1. Corrupt with NO backup
    let no_bak_path = sb.path("no_bak.json");
    std::fs::write(&no_bak_path, "{invalid json").expect("write corrupt");
    match load_or_recover(&no_bak_path).expect("quarantine without backup") {
        LoadOutcome::CorruptQuarantined {
            corrupt_path,
            backup_candidate,
            ..
        } => {
            assert!(corrupt_path.exists());
            assert!(backup_candidate.is_none());
        }
        other => panic!("Expected CorruptQuarantined, got {other:?}"),
    }

    // 2. Corrupt newest .bak-* falls back to older valid .bak-*
    let lib_path = sb.path("fallback.json");
    for gen_idx in 1..=3 {
        let mut f = LibraryFile::empty_v3();
        f.user_formulas.push(UserFormula {
            id: next_uuid_v7(),
            name: format!("Backup Gen {gen_idx}"),
            category: "备份".to_owned(),
            source: format!("x^{gen_idx}"),
            desc: String::new(),
            tags: Vec::new(),
            created_at: 1_700_000_000 + gen_idx,
        });
        save_atomic(&lib_path, &f, WriteCondition::Unconditional).expect("save gen");
    }
    let backups = list_backups(&lib_path);
    assert!(backups.len() >= 2);
    // Corrupt newest backup
    std::fs::write(&backups[0], "{corrupted newest backup").expect("corrupt newest bak");
    std::fs::write(&lib_path, "{corrupted primary").expect("corrupt primary");
    match load_or_recover(&lib_path).expect("fallback to older bak") {
        LoadOutcome::CorruptQuarantined {
            backup_candidate, ..
        } => {
            let cand = backup_candidate.expect("older valid backup must be found");
            assert_eq!(cand.path, backups[1]);
            assert_eq!(cand.file.user_formulas[0].name, "Backup Gen 1");
        }
        other => panic!("Expected CorruptQuarantined, got {other:?}"),
    }

    // 3. All backups corrupt -> backup_candidate: None
    for b in &backups {
        std::fs::write(b, "{broken backup").expect("corrupt all backups");
    }
    std::fs::write(&lib_path, "{corrupted primary again").expect("corrupt primary again");
    match load_or_recover(&lib_path).expect("all backups corrupt") {
        LoadOutcome::CorruptQuarantined {
            backup_candidate, ..
        } => {
            assert!(backup_candidate.is_none());
        }
        other => panic!("Expected CorruptQuarantined, got {other:?}"),
    }

    // 4. EISDIR: directory occupying library.json
    let dir_as_file = sb.path("dir_occupied.json");
    std::fs::create_dir(&dir_as_file).expect("create dir at file path");
    let eisdir_err = load_or_recover(&dir_as_file).expect_err("EISDIR must return Err");
    assert!(matches!(eisdir_err, StoreError::Io { .. }));
    assert!(dir_as_file.is_dir(), "EISDIR directory must remain intact");

    // 5. Missing/malformed fields boundary in dry_run_migrate
    assert!(dry_run_migrate(r#"{"schema_version": 3, "custom_formats": "bad"}"#, catalog).is_err());
    assert!(
        dry_run_migrate(
            r#"{"schema_version": 3, "user_formulas": [{"id": "a", "name": 42}]}"#,
            catalog
        )
        .is_err()
    );
    assert!(dry_run_migrate(r#"{"schema_version": 3, "settings": "bad"}"#, catalog).is_err());
    let (minimal, mig) = dry_run_migrate(r#"{"schema_version": 3}"#, catalog).expect("minimal v3");
    assert!(mig.is_none());
    assert!(minimal.user_formulas.is_empty());
}

/// Helper test invoked as a child process by `t_data_010` to simulate mid-write SIGKILL (`kill -9`).
#[test]
fn sigkill_mid_write_child_helper() {
    let Ok(dir_str) = std::env::var("MATHSLOT_SIGKILL_TEST_DIR") else {
        return;
    };
    let dir = PathBuf::from(dir_str);
    let orphan_tmp = dir.join(".tmpSIGKILL_ORPHAN");
    let mut f = std::fs::File::create(&orphan_tmp).expect("create temp file");
    f.write_all(b"{\"schema_version\": 3, \"user_formulas\": [{\"incomplete")
        .expect("write partial tmp");
    f.flush().expect("flush tmp");
    println!("READY");
    std::io::stdout().flush().expect("flush child READY");
    loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
    }
}

/// T-DATA-010 (A-DATA-004, D-151):
/// Spawns a real child process writing a `.tmp*` file, sends `SIGKILL` (`kill -9`) mid-write,
/// verifies the primary `library.json` and backups remain valid, and verifies orphan `.tmp*` files
/// are cleaned up upon restart (`load_or_recover`).
#[test]
fn t_data_010_real_sigkill_mid_write_and_orphan_tmp_cleanup_on_restart() {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    let sb = TempSandbox::new("t_data_010");
    let lib_path = sb.path("library.json");

    let mut f1 = LibraryFile::empty_v3();
    f1.user_formulas.push(UserFormula {
        id: next_uuid_v7(),
        name: "Gen 1 Safe".to_owned(),
        category: "安全".to_owned(),
        source: "a + b".to_owned(),
        desc: String::new(),
        tags: Vec::new(),
        created_at: 1_700_000_000,
    });
    save_atomic(&lib_path, &f1, WriteCondition::Unconditional).expect("save gen1");

    let mut f2 = f1.clone();
    f2.user_formulas[0].name = "Gen 2 Safe".to_owned();
    save_atomic(&lib_path, &f2, WriteCondition::Unconditional).expect("save gen2");

    let exe = std::env::current_exe().expect("current test exe");
    let mut child = Command::new(exe)
        .args(["--exact", "sigkill_mid_write_child_helper", "--nocapture"])
        .env("MATHSLOT_SIGKILL_TEST_DIR", &sb.root)
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn child writer");

    let stdout = child.stdout.take().expect("child stdout");
    let mut reader = BufReader::new(stdout);
    let mut ready_line = String::new();
    loop {
        ready_line.clear();
        let n = reader
            .read_line(&mut ready_line)
            .expect("read child stdout");
        assert!(n > 0, "Child exited before signaling READY");
        if ready_line.trim() == "READY" {
            break;
        }
    }

    // Send real kill -9 (SIGKILL) on Unix or terminate on other platforms
    #[cfg(unix)]
    {
        let status = Command::new("kill")
            .args(["-9", &child.id().to_string()])
            .status()
            .expect("invoke kill -9");
        assert!(status.success(), "kill -9 must succeed");
    }
    #[cfg(not(unix))]
    {
        child.kill().expect("kill child");
    }
    let exit_status = child.wait().expect("wait killed child");
    assert!(
        !exit_status.success(),
        "SIGKILL child must not exit cleanly"
    );

    assert!(
        sb.path(".tmpSIGKILL_ORPHAN").exists(),
        "Orphan .tmp file must exist immediately after SIGKILL"
    );

    // Restart: load_or_recover must load Gen 2 cleanly and clean up orphan .tmp* files
    match load_or_recover(&lib_path).expect("restart load_or_recover") {
        LoadOutcome::Loaded { file, .. } => {
            assert_eq!(file.user_formulas.len(), 1);
            assert_eq!(file.user_formulas[0].name, "Gen 2 Safe");
        }
        other => panic!("Expected Loaded after SIGKILL restart, got {other:?}"),
    }
    assert_no_tmp_files(&sb.root);
}

/// T-DATA-011 (D-149, D-014):
/// Bidirectional compatibility: Desktop `Store::import_library_json` losslessly imports
/// Obsidian-exported camelCase JSON (`customFormats`, `snippets: UserFormulaEntry[]`, `settings`)
/// while assigning valid UUIDv7 IDs and rejecting `is_builtin: true`.
#[test]
fn t_data_011_import_obsidian_exported_json_and_reject_builtin() {
    let sb = TempSandbox::new("t_data_011");
    let lib_path = sb.path("library.json");
    let catalog = Catalog::builtin();
    let mut store = Store::new(lib_path);

    let obsidian_exported = serde_json::json!({
        "schema_version": 3,
        "settings": {
            "theme": "dark",
            "delimiter_style": "inline_dollar",
            "render_backend": "mathjax",
            "preview_scale_pct": 125
        },
        "customFormats": [
            {
                "key": "q",
                "label": "自定义向量",
                "glyph": "v",
                "roles": ["x"],
                "latex": "\\vec{$1}",
                "schemeA": "vec"
            }
        ],
        "snippets": [
            {
                "id": "snippet-obs-1",
                "name": "二次公式片段",
                "category": "自定义",
                "source": "x^2 + bx + c = 0",
                "desc": "从 Obsidian 导出",
                "tags": ["obsidian"],
                "is_builtin": false,
                "created_at": 1_700_000_100
            }
        ]
    })
    .to_string();

    let (imported, _report) = store
        .import_library_json(&obsidian_exported, catalog)
        .expect("Desktop Store must import Obsidian exported JSON losslessly");
    assert_eq!(imported.custom_formats.len(), 1);
    assert_eq!(imported.custom_formats[0].key, 'q');
    assert_eq!(imported.user_formulas.len(), 1);
    assert_eq!(imported.user_formulas[0].name, "二次公式片段");
    assert_eq!(imported.user_formulas[0].source, "x^2 + bx + c = 0");
    assert!(
        is_valid_uuid_v7(&imported.user_formulas[0].id),
        "Non-UUIDv7 Obsidian snippet id must be migrated to valid UUIDv7, got {}",
        imported.user_formulas[0].id
    );
    assert_eq!(imported.settings.theme, ThemePreference::Dark);
    assert_eq!(imported.settings.preview_scale_pct, Some(125));

    // Reject is_builtin: true inside Obsidian-style snippets
    let malicious_obs = serde_json::json!({
        "schema_version": 3,
        "customFormats": [],
        "snippets": [
            {
                "id": "preset-inject",
                "name": "Malicious Builtin",
                "category": "自定义",
                "source": "x + 1",
                "is_builtin": true
            }
        ]
    })
    .to_string();
    let err = store
        .import_library_json(&malicious_obs, catalog)
        .expect_err("Obsidian snippets with is_builtin: true must be rejected");
    assert!(matches!(err, StoreError::BuiltinImportRejected(_)));
}

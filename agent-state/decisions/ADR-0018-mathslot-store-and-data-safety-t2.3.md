# ADR-0018: T2.3 `mathslot-store` Persistence, Data Safety & Preset Separation

- **Date**: 2026-11-14
- **Round**: 15
- **Gate / Task**: `G2` / `T2.3`
- **Status**: APPROVED
- **Closes Defects**: `D-005` (P1), `D-006` (P1), `D-013`, `D-014`, `D-022`, `D-102`
- **Basis**: `docs/LLM_IMPLEMENTATION_SPEC.md` §10, §14 (`T2.3`, `A-DATA-001..006`), `INV-010`, `INV-016`, `agent-state/audits/AUD-15.md`

---

## 1. Decision

Create workspace crate `crates/mathslot-store` (`#![forbid(unsafe_code)]`) as the single persistence engine for MathSlot user data, extract the 88 built-in presets into `catalog/presets.json`, enforce atomic write + locking + backup rotation + corrupt-file quarantine + schema migration (v1/v2 → v3), fix monotonic UUIDv7 ID generation and strict JSON parsing in `crates/mathslot-core/src/library.rs`, and rewire `src/modals.rs` and `src/app.rs` to use `mathslot-store` (eliminating all 8 `let _ =` around library persistence).

## 2. Offline-Verified Dependencies (`Cargo.toml` / `crates/mathslot-store/Cargo.toml`)

Per `AUD-15.md` offline cache inventory, `directories` and `fs2` are **NOT** present in `Cargo.lock` or the local Cargo cache. Implement `crates/mathslot-store` using only cached crates + `std`:
- `dirs = "6"` (present: `dirs 6.0.0`, `dirs-sys 0.5.0`) for `INV-010` 3-OS config paths (`dirs::config_dir()`).
- `fd-lock = "4"` (present: `fd-lock 4.0.4`) for advisory cross-platform file locking.
- `tempfile = "3"` (present: `tempfile 3.27.0`) for same-directory temp file atomic write (`NamedTempFile::new_in(parent)` + `persist`).
- `serde = { version = "1", features = ["derive"] }` / `serde_json = "1"` (present: `serde_json 1.0.154`).
- `thiserror = "2"` (present: `thiserror 2.0.21`) for typed `StoreError` (`NotFound`, `PermissionDenied`, `Conflict`, `CorruptQuarantined`, `Io`, `Serialize`, `Migration`).
- Directory fsync on Unix (`#[cfg(unix)] std::fs::File::open(parent)?.sync_all()`) implemented in safe Rust (`#![forbid(unsafe_code)]`).
- Monotonic RFC-9562 UUIDv7 generator using cached `uuid` (`uuid 1.29.2`) if v7 builds `--offline`, or a zero-unsafe monotonic RFC-9562 UUIDv7 generator using `SystemTime` + `AtomicU64` + `std::collections::hash_map::RandomState`.

## 3. Architecture & Scope

1. **Built-in Catalog (`catalog/presets.json`, `D-014`)**:
   - Extract all 88 presets from `crates/mathslot-core/src/presets.rs` with stable `preset-<slug>` IDs and legacy `preset-001..088` mapping.
   - Embedded via `include_str!` in `mathslot-store` (and parity-checked against `mathslot-core::presets` catalog).
   - `LibraryFile` (`schema_version = 3`) stores **only** user data (`custom_formats`, `snippets`, `user_formulas`, `overrides: Vec<PresetOverride>`, `settings`). Never persists the 88 builtins.
   - Imports (`import_json` / `migrate`) reject or normalize `is_builtin: true` records so builtins cannot enter user storage (`D-014`).
2. **3-OS Config Path (`INV-010`, `D-022`)**:
   - Replace hand-rolled path lookup in `src/modals.rs:1689-1712` with `mathslot_store::default_library_path()` (using `dirs::config_dir()`) and pure testable helpers `library_path_for_linux(xdg, home)`, `library_path_for_macos(home)`, `library_path_for_windows(appdata)`.
3. **Atomic Save, Locking, Conflict & Backups (`D-005`, `D-102`, `A-DATA-001..004`)**:
   - Acquire `fd_lock::RwLock` on sibling lockfile (`library.lock`).
   - Check optimistic version/etag token (`StoreError::Conflict` on mismatch; never overwrite newer on-disk data).
   - Write to `tempfile::NamedTempFile::new_in(parent)` (via injectable `Write` helper for `ENOSPC`/`WriteZero` testing), `flush()`, `as_file().sync_all()`.
   - Rotate 3–5 timestamped backups (`library.bak-<ts>.json`) **only after** temp write + `sync_all()` succeeds.
   - `persist(target_path)` atomically replaces target, followed by Unix parent directory `File::open(parent)?.sync_all()`.
4. **Load, Error Propagation & Corrupt Quarantine (`D-005`, `A-DATA-002..004`)**:
   - `ErrorKind::NotFound`: return default empty `LibraryFile` + valid built-in view **without** writing a blank file (`A-DATA-001`).
   - `ErrorKind::PermissionDenied` / other IO error: return `Err(StoreError)` (`A-DATA-002`, no silent fallback to default).
   - Corrupt UTF-8 / invalid JSON / schema error: quarantine corrupt file to `library.corrupt-<timestamp>.json`, scan valid backups to attach candidate recovery preview (`LoadOutcome::CorruptQuarantined`), never overwrite user data silently (`A-DATA-004`).
5. **v1/v2 → v3 Migration (`A-DATA-005`)**:
   - Load v1/v2 `library.json` (including legacy `preset-001..088` overrides and old array fields), strip builtin duplicates, convert to v3 without losing any user formulas, custom formats, snippets, overrides, or settings.
6. **`mathslot-core/src/library.rs` & Production UI Wiring (`D-005`, `D-006`, `D-013`)**:
   - Fix `FormulaLibrary::upsert` (`crates/mathslot-core/src/library.rs:260-268`) to emit monotonic UUIDv7 (`D-006`).
   - Fix `JsonParser` EOF/strict literal checks (`crates/mathslot-core/src/library.rs:796-801, 1069-1150, 1268`, `D-013`).
   - Keep `UserLibrary::default_seeded()` memory-only seed compatibility (`INV-016`) intact while keeping persistence built-in-free.
   - Rewire `src/modals.rs` (`load_library_from_path`, `save_library_to_path`) and `src/app.rs` (`src/app.rs:195`, `src/modals.rs:218,304,325,467,671,1758,1761`) to use `mathslot-store` and handle errors/status rather than `let _ =` (eliminating all 8 persistence `let _ =`).
   - Rewire `src/p1_regression_tests.rs:121-216` (`test_p1_d005`) to test the real `modals::load_library_from_path` / `save_library_to_path` production paths instead of local mirror helpers, and un-ignore both `test_p1_d005` and `test_p1_d006`.

## 4. Allowed & Forbidden Paths

- **Allowed Paths**:
  - `Cargo.toml`, `Cargo.lock` (only if workspace registration updates it using cached crates)
  - `catalog/presets.json`
  - `crates/mathslot-store/**`
  - `crates/mathslot-core/src/library.rs` (only UUIDv7 IDs, strict JSON literals, builtin import normalization, keeping `INV-016`)
  - `crates/mathslot-core/tests/p1_regression_tests.rs` (un-ignore `test_p1_d006`)
  - `src/modals.rs`, `src/app.rs` (strictly library load/save integration & removing the 8 `let _ =`)
  - `src/p1_regression_tests.rs` (un-ignore & rewire `test_p1_d005` to production `modals` paths)
- **Forbidden Paths**:
  - `crates/mathslot-core/src/{parser,ast,latex}.rs` (frozen architecture)
  - `crates/mathslot-syntax/**`, `crates/mathslot-doc/**`, `crates/mathslot-latex/**`, `crates/mathslot-command/**`, `crates/mathslot-app/**`, `crates/mathslot-wasm/**`
  - `scripts/agent/**`, `docs/**`, `agent-state/**`

## 5. TDD & Acceptance Matrix (`A-DATA-001..006`)

Write failing tests **before** implementation:
1. `T-DATA-001` (`A-DATA-001`): `NotFound` initializes clean in-memory state; zero disk writes; 88 catalog presets available without persisting them into `library.json`.
2. `T-DATA-002` (`A-DATA-002`): Simulated `WriteZero`/`ENOSPC` during temp-file write + `PermissionDenied` return `Err`, leave original `library.json` byte-for-byte intact, and create zero `.bak` files for failed writes.
3. `T-DATA-003` (`A-DATA-003`): Same-millisecond burst of 1,000 saves/upserts yields 1,000 unique, strictly increasing UUIDv7 IDs (`D-006`) + optimistic conflict check rejects stale writes with `StoreError::Conflict` (`D-102`).
4. `T-DATA-004` (`A-DATA-004`): Corrupt `library.json` (truncated JSON / invalid UTF-8 / wrong type) is quarantined to `library.corrupt-*.json`, newest valid backup candidate is surfaced, and original backups remain intact.
5. `T-DATA-005` (`A-DATA-005`): Legacy v1/v2 `library.json` with `preset-001..088` overrides, builtin duplicates, custom formats, snippets, and user formulas migrates losslessly to v3 without persisting builtins (`D-014`).
6. `T-DATA-006` (`D-022`, `INV-010`): Pure path-resolution unit tests cover Linux (`XDG_CONFIG_HOME` + fallback `~/.config`), macOS (`~/Library/Application Support`), and Windows (`%APPDATA%`).
7. `T-DATA-007` (`D-013`): Reject truncated/trailing-garbage JSON (`tru`, `1e`, `nul`, `[1] garbage`).
8. Un-ignored P1 regressions: `test_p1_d005` (real production `modals` path) and `test_p1_d006`.

## 6. Risks & Constraints

- Offline build must succeed with `cargo test --workspace --offline` (no crates outside existing cache).
- Zero new `let _ =`, `#[allow]`, `#[ignore]`, or user-path `unwrap()`.
- `acceptance.sh` must stay green (`PASS=5 FAIL=0` or better, `WARN` `let _ =` count must drop by ≥ 8 from baseline 24).

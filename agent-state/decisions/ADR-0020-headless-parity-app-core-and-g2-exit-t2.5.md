# ADR-0020: T2.5 Headless Parity (`mathslot-core` vs `mathslot-app`) & Gate G2 Exit

- **Date**: 2026-11-14
- **Round**: 17
- **Gate / Task**: `G2` / `T2.5`
- **Status**: APPROVED
- **Audit Basis**: `agent-state/audits/AUD-17.md`
- **Spec Basis**: `docs/LLM_IMPLEMENTATION_SPEC.md` §2 (`INV-001`, `INV-002`, `INV-007`, `INV-008`, `INV-012`, `INV-013`, `INV-016`), §5.2–§5.3 (`mathslot-app` headless isolation), §14 (`T2.5`, Gate G2 exit)

---

## 1. Decision

Implement a comprehensive, deterministic headless parity harness in `crates/mathslot-app/tests/parity_report_tests.rs` comparing legacy `mathslot-core` (`StreamEditor`, `PRESET_LIBRARY`, `visual::build_fallback_preview_latex`) directly against the refactored `app-core` pipeline (`mathslot_app::App`, `mathslot_render::RenderPipeline`, `mathslot_store::Catalog`), producing and validating a machine-readable `ParityReport` with 100% core-path parity or explicitly documented `IntentionalDelta` entries (`unexpected_mismatches == 0`).

Once `T2.5` passes independent verification (`VER-17`), run full `scripts/agent/acceptance.sh` to sign `agent-state/verify/GATE-G2.md` and advance to Gate `G3`.

## 2. Scope & Isolation Rules

1. **Strict Headless Isolation (`§5.2`, `§5.3`)**:
   - `crates/mathslot-app/Cargo.toml` `[dependencies]` MUST remain unchanged (`mathslot-command`, `mathslot-doc`, `mathslot-syntax`, `serde`, `thiserror`; zero `egui`, zero `std::fs`, zero rendering crates).
   - Reference crates (`mathslot-core`, `mathslot-latex`, `mathslot-render`, `mathslot-store`, `serde_json`) are permitted **ONLY** under `[dev-dependencies]` in `crates/mathslot-app/Cargo.toml`.
   - `cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline` MUST remain exit `0`.
2. **Parity Report Model**:
   - `ParityStatus`: `ExactParity` | `IntentionalDelta { delta_id, rationale }` | `Mismatch(String)`.
   - `ScenarioResult { id, category, legacy_outcome, app_outcome, status }`.
   - `ParityReport { total_cases, exact_parity, intentional_deltas, unexpected_mismatches, scenarios }` with deterministic JSON + Markdown summary generation and strict invariant `assert_eq!(report.unexpected_mismatches, 0)`.
   - When `MATHSLOT_PARITY_REPORT_OUT` is set (or into `target/` when needed for Gate G2 evidence), output is written safely without touching `docs/` or `agent-state/` inside test runs.
3. **Required Parity Matrix (`P-*`)**:
   - `P-CMD-121`: Drive `App::dispatch(KeyInput)` character-by-character across all 121 `GENERATED_COMMANDS` examples vs `StreamEditor::from_source`, asserting `mathslot_syntax::parse` structural AST equivalence, `EditorState::Idle` return, and `Effect::Render` emission (recording `DELTA-FORMAT-MATRIX` for spacing style).
   - `P-PALETTE`: Compare catalog palette card insertion (`AppEvent::PaletteCard`) vs `StreamEditor::apply_card_click`, asserting structural equivalence and recording fixed `D-001` command mappings (`DELTA-D001-PALETTE-FIX`).
   - `P-EDIT-UNDO`: Compare typing, backspace, clear, paste `▸f1;2;`, undo/redo reversibility vs `StreamEditor`, recording `DELTA-UNDO-INTENT` (`D-012`/`INV-008`: card/clear/import single-step boundaries & preserved pre-clear history `D-105`) and `DELTA-WHITESPACE-COALESCE` (`D-107`: no ghost space slot).
   - `P-NAV`: Compare slot traversal & wrap-around on `\frac{a}{b}`, `\sqrt[3]{8}`, and 2x2 matrices with zero text/history pollution, recording `DELTA-NAV-MODEL` (`EnterNavMode`/`Tab` vs legacy `Esc` tag tree/`Tab` `▸`).
   - `P-DIAG-EXPORT`: Compare incomplete/unknown command outputs (`▸`, `▸m`, `▸zz`) in `RequestCopy`/`RequestExport { strict }` vs `StreamEditor::to_latex()`, verifying non-empty `\text{▸...}` placeholders (`D-004`) and recording `DELTA-STRICT-EXPORT` (`AppError::StrictExportBlocked` in strict mode).
   - `P-PRESET-88`: Compare all 88 `mathslot_store::Catalog::builtin().presets()` vs `mathslot_core::PRESET_LIBRARY` IDs/sources via `AppEvent::ImportLatex` and `StreamEditor::load_preset`, verifying parsed AST parity (recording `D-007` boundary deferred to G4 `T4.1`).
   - `P-RENDER-STORE-G2`: Verify `App` `Effect::Render` requests paired with `mathslot_render::RenderPipeline` (normal + unsupported macro degradation) vs silent legacy `visual::build_fallback_preview_latex`, recording `DELTA-DEGRADED-DIAGNOSTICS` (`D-011`).

## 3. Allowed & Forbidden Paths

- **Allowed Paths**:
  - `crates/mathslot-app/Cargo.toml` (**ONLY** `[dev-dependencies]` additions)
  - `crates/mathslot-app/tests/parity_report_tests.rs`
  - `crates/mathslot-app/src/**` (**ONLY** if parity testing uncovers a genuine unexpected bug in `App`, with red-first proof and zero duplication of parser/AST/command table)
  - `Cargo.lock` (only if workspace dev-dependency wiring adjusts lockfile without external network crates)
- **Forbidden Paths**:
  - `crates/mathslot-core/src/{parser,ast,latex}.rs` (frozen architecture) and `crates/mathslot-core/**`
  - `crates/mathslot-{command,syntax,doc,latex,render,store,wasm}/**`
  - `src/**`, `obsidian-mathslot/**`, `catalog/**`, `xtask/**`, `scripts/**`, `docs/**`, `agent-state/**`

## 4. TDD Red-First & Quality Gates

1. Write `parity_report_tests.rs` first and observe RED (`unexpected_mismatches > 0` / failing assertions before full delta registration & parity completion).
2. Fix any discovered `App` discrepancy cleanly and complete all 7 parity scenarios with `unexpected_mismatches == 0`.
3. Zero new `let _ =`, `#[allow]`, `#[ignore]`, or `crates/mathslot-app/src/` `.unwrap()` / `.expect(`.
4. All gates MUST pass: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --offline`, `cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline`, `scripts/agent/acceptance.sh`.

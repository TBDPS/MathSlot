# ADR-0021: T2.5 Fix Round — Fix `D-108` Macro Gluing, `D-109` Delimiter Loss & Parity Blind Spots

- **Date**: 2026-11-14
- **Round**: 18
- **Gate / Task**: `G2` / `T2.5` (amends `ADR-0020` after `VER-17` `FAIL`)
- **Status**: APPROVED
- **Closes Defects**: `D-108` (`mathslot-syntax` adjacent macro gluing), `D-109` (`INV-002` silent `\Vert`/`\lfloor`/`\rfloor`/`\lceil`/`\rceil` loss to `Delim::Empty`)
- **Evidence Basis**: `agent-state/verify/VER-17.md` (`FAIL` findings & minimal reproductions)
- **Spec Basis**: `docs/LLM_IMPLEMENTATION_SPEC.md` §2 (`INV-002`), §14 (`T2.5`, Gate G2 exit)

---

## 1. Decision

Address both blocking defects exposed by `VER-17` within `T2.5`:
1. **`D-108` (`crates/mathslot-syntax/src/printer.rs`)**: Prevent `Printer::to_canonical_latex` from gluing control-word macros (`\<letters>+`, whether emitted by `Expr::Symbol`, `Expr::RawLatex`, `Expr::Error`, or inside nested `Expr::Script` bases/children) onto a following ASCII-letter token (`\SigmaV`, `\sigmae`, `\cdotk`, `\partialt`, `\landd`).
2. **`D-109` (`crates/mathslot-syntax/src/{token,lexer,ast,parser}.rs`)**: Model `\Vert` (`Token::DoublePipe` -> `Delim::DoublePipe`), `\lfloor`/`\rfloor` (`Token::FloorOpen`/`Token::FloorClose` -> `Delim::Floor`), and `\lceil`/`\rceil` (`Token::CeilOpen`/`Token::CeilClose` -> `Delim::Ceil`) so `\left\Vert ... \right\Vert`, `\left\lfloor ... \right\rfloor`, and `\left\lceil ... \right\rceil` never degrade silently to `Delim::Empty` (`\left. ... \right.`), upholding `INV-002`.
3. **Eliminate Parity Blind Spots (`crates/mathslot-app/tests/parity_report_tests.rs`)**:
   - In `P-PRESET-88`, re-parse `app_latex = app.to_latex()` via `mathslot_syntax::parse(&app_latex)` (removing the tautology of comparing `syntax_parse(&legacy_latex)` against `app.doc().nodes`), assert round-trip AST equivalence, and reject glued invalid macros. Also verify `preset.source` character-input parity where applicable.
   - Assert strict `INV-002` delimiter preservation across `P-CMD-121`, `P-PALETTE`, and `P-PRESET-88`: `\left.`/`\right.` may NEVER match `\left\Vert`/`\left\lfloor`/`\left\lceil`; `norm`, `floor`, `ceil` MUST preserve `Delim::DoublePipe`, `Delim::Floor`, `Delim::Ceil` (`\|` vs `\Vert` may be `ExactParity` once normalized via `\left\|` / `Delim::DoublePipe`, or `DELTA-FORMAT-MATRIX` ONLY if semantic `Delim::DoublePipe` matches).
   - Update `P-EDIT-UNDO` `whitespace-coalesce` to run real `StreamEditor::from_source("a b")` vs `App` rather than a descriptive placeholder string (`VER-17` §6.3).

## 2. Allowed & Forbidden Paths

- **Allowed Paths**:
  - `crates/mathslot-syntax/src/{token.rs,lexer.rs,ast.rs,parser.rs,printer.rs}`
  - `crates/mathslot-syntax/tests/**` (red-first unit/golden tests for `D-108` & `D-109`)
  - `crates/mathslot-doc/src/transaction.rs` (**Amendment**: use shared control-word boundary helper from `mathslot-syntax` in `InsertText` `AtEnd` & `InSlot` paths so interactive typing does not glue `\Sigma`+`V` -> `\SigmaV` (`D-108`); zero logic duplication)
  - `crates/mathslot-doc/tests/parity_harness_tests.rs` (**Amendment**: update line 216 stale expectation for `▸afx;` from `Delim::Empty` to `Delim::DoublePipe` after `D-109` fix)
  - `crates/mathslot-app/tests/parity_report_tests.rs` (for 4 presets whose `preset.source` uses legacy-only pre-G1 shortcodes / nested `▸` in `ParamCapture` outside single-level `GENERATED_COMMANDS` `KeyInput`, keep `AppEvent::ImportLatex` strict AST parity + record explicit `DELTA-LEGACY-SHORTCODE-SOURCE` with exact count/IDs while running full `preset.source` parity on all other presets)
  - `crates/mathslot-app/src/**` (**ONLY** if a genuine `App` bug is uncovered, with zero second parser/AST/command table)
- **Forbidden Paths**:
  - `crates/mathslot-core/src/{parser,ast,latex}.rs` (frozen architecture) and `crates/mathslot-core/**`
  - `crates/mathslot-{command,latex,render,store,wasm}/**`
  - All `crates/mathslot-doc/src/**` other than `transaction.rs`
  - `Cargo.toml`, `Cargo.lock` (not needed; `[dev-dependencies]` already wired)
  - `src/**`, `obsidian-mathslot/**`, `catalog/**`, `xtask/**`, `scripts/**`, `docs/**`, `agent-state/**`

## 3. TDD Red-First & Acceptance Plan

1. First update `crates/mathslot-app/tests/parity_report_tests.rs` (re-parse `app_latex` in `P-PRESET-88` + forbid silent `\left.` delimiter loss on `norm`/`floor`/`ceil`) and add regression tests in `crates/mathslot-syntax/tests/` for `D-108` (`\Sigma V^{T}`, `\sigma e^{-}`, `\cdot k`, `\partial t^{2}`, `\land d\eta`) and `D-109` (`\left\Vert x\right\Vert`, `\left\lfloor x\right\rfloor`, `\left\lceil x\right\rceil`). Run tests and observe **RED** (`D-108` & `D-109` failures).
2. Fix `crates/mathslot-syntax/src/printer.rs` (`D-108`) and `token.rs`/`lexer.rs`/`ast.rs`/`parser.rs` (`D-109`), and complete `P-EDIT-UNDO` `whitespace-coalesce` real `StreamEditor::from_source("a b")` parity.
3. Verify ALL workspace gates pass (`cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test -p mathslot-syntax --offline`, `cargo test -p mathslot-app --offline`, `cargo test --workspace --offline`, `cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline`, `scripts/agent/acceptance.sh`), with zero new `let _ =`, `#[allow]`, `#[ignore]`, or `.unwrap()`/`.expect(` in `src/`.

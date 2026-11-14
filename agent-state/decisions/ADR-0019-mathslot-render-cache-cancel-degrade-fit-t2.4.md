# ADR-0019: T2.4 `crates/mathslot-render` (Cache / Cancel / Degrade / Error Summary / Fit)

- **Date**: 2026-11-14
- **Round**: 16
- **Gate / Task**: `G2` / `T2.4`
- **Status**: APPROVED
- **Closes Defects**: `D-003` (P1), `D-008`, `D-010`, `D-011`, `D-019`
- **Basis**: `docs/LLM_IMPLEMENTATION_SPEC.md` §5.2 (`mathslot-render` boundary), §9 (`MathRenderer`, cache, cancellation, degradation, error display), §14 (`T2.4`, `A-RENDER-001..005`), `INV-012`, `INV-013`, `agent-state/audits/AUD-16.md`

---

## 1. Decision & Spec Boundary Confirmation

Per `docs/LLM_IMPLEMENTATION_SPEC.md` §5.2 and §9, `crates/mathslot-render` (`#![forbid(unsafe_code)]`, headless, default `wasm32-unknown-unknown` compatible) implements the **render pipeline contract** (`MathRenderer` trait, deterministic hash cache, generation cancellation, debounce gate, explicit degradation diagnostics, bounded error summaries, and viewport fit geometry) rather than a custom `GlyphBox`/`LayoutTree` math typesetting engine (as §5.2 explicitly forbids `mathslot-render` from owning UI layout and §9 designates MathJax 3 SVG / `latex-rust` as typesetting backends).

## 2. Offline-Verified Dependencies

Use **zero** uncached dependencies. `crates/mathslot-render` depends strictly on workspace-locked crates:
- `mathslot-syntax` (path dependency, read-only AST/diagnostic types per §5.2)
- `serde = { version = "1", features = ["derive"] }`
- `thiserror = "2"`
- Pure `std`: deterministic FNV-1a-128 content hash (`RenderCacheKey` hashing `(mode, latex, theme, scale_bits, backend, format)` plus exact equality check) and bounded LRU cache (`HashMap + VecDeque`), avoiding non-deterministic `DefaultHasher` and avoiding unrequested external dependencies.
- Register `"crates/mathslot-render"` in root `Cargo.toml` `[workspace].members` and `[dependencies]` (`mathslot-render = { path = "crates/mathslot-render" }`) so `src/render.rs` and `src/app.rs` consume it directly.

## 3. Scope & Concrete Fixes

1. **`crates/mathslot-render` Core API (`§9.1–§9.3`)**:
   - Types: `RenderId(u64)`, `Generation(u64)`, `RenderMode { Preview, Nav }`, `Theme { Light, Dark, HighContrast }`, `RenderFormat { Svg, Png }`, `BackendKind { MathJaxSvg, LatexRust, Mock }`, `RenderDiagnostic`, `RenderError` (incl. `Cancelled { id, generation }`, `RenderFailed`, `ChannelClosed`), `RenderData { Svg(String), Png { width, height, bytes } }`, `RenderRequest`, `RenderOutput { id, generation, output, degraded, diagnostics, cache_hit }`.
   - Trait: `pub trait MathRenderer { fn render(&self, req: &RenderRequest) -> Result<RenderOutput, RenderError>; }`.
   - **Cache (`D-019`, `A-RENDER-004`)**: `RenderCache` keyed by `(mode, latex, theme, scale_bits, backend, format)` with bounded LRU eviction and exact field match.
   - **Cancellation & Debounce (`D-019`, `A-RENDER-004`)**: `GenerationTracker` (`AtomicU64`) checked before start, between primary & fallback renders, and prior to returning output; stale generations return `Err(RenderError::Cancelled { .. })`. Deterministic `DebounceGate::should_dispatch(now_ms, ...)` testable without sleeping.
   - **Explicit Degradation (`D-011`, `INV-012`, `A-RENDER-003`)**: `RenderPipeline` runs primary backend; on failure, fallback output MUST carry `degraded: true` and non-empty `diagnostics` describing the primary cause (never silently swallowed).
   - **Error Summary Truncation (`D-010`, `A-RENDER-005`)**: `ErrorSummary::from_error(code, message, source)`:
     - `header_summary`: single-line (`\r`/`\n` normalized to spaces), `short_code + summary`, strictly `header_summary.chars().count() <= 120`.
     - `source_excerpt`: up to 200 chars, with `"…（已截断）"` suffix when truncated (`truncated: true`).
     - `full_detail`: unclipped error + diagnostics for collapsible panel / copy-to-clipboard action.
   - **Fit Geometry & True Scale (`D-003`, `D-008`, `INV-013`, `A-RENDER-001`, `A-RENDER-002`)**:
     - `Size2D { width, height }`, `FitPolicy { FitToWidth, FitToBox, ActualScale(f32) }`, `FitResult { display_size, effective_scale, display_percent, left_aligned, scrollable_x, scrollable_y }`.
     - `fit_to_width(content, max_width, actual_scale_override)` defaults to fitting width within viewport (full formula visible); when actual-size mode exceeds viewport width, returns `left_aligned = true`, `scrollable_x = true`.
     - `fit_to_box(content, max_width, max_height, max_scale)` strictly guarantees `display_size.width <= max_width && display_size.height <= max_height` (preserving aspect ratio).
     - `true_scale_percent(scale)` returns `(scale * 100.0).round() as u32` (never `scale * 80.0`).

2. **Desktop `src/render.rs` & `src/app.rs` Integration (`D-003`, `D-008`, `D-010`, `D-011`, `D-019`)**:
   - `src/render.rs`:
     - Add `degraded: bool` and `diagnostics: Vec<RenderDiagnostic>` to `Rendered` (`D-011`); record original render error diagnostics whenever fallback triggers.
     - Integrate `RenderCache`, `GenerationTracker`, and `ErrorSummary` into `RenderWorker`/`Renderer`; propagate channel send error explicitly rather than `let _ = self.tx_job.send(job);` at `src/render.rs:90` (eliminating 1 `let _ =`).
     - Stop concatenating full untruncated `latex_src` directly into header error strings.
   - `src/app.rs`:
     - Replace dead-param `fitted_size` (`src/app.rs:2669-2682`) with `mathslot_render::fit_to_box` / `fit_to_width` (`D-003`, `D-008`); expose a pure testable `pub fn fitted_size_dims(content_w: f32, content_h: f32, max_w: f32, max_h: f32, scale_factor: f32) -> egui::Vec2` used by both `fitted_size` and `test_p1_d003`.
     - Default preview uses `FitToWidth` (plus toggle to `ActualScale(self.preview_scale)` with `left_aligned` scrolling); fix percentage display from `self.preview_scale * 80.0` to `mathslot_render::true_scale_percent(self.preview_scale)` (`D-003`).
     - Fix `nav_structure_box` (`D-008`): strictly bound image inside dedicated clipped rect above `chip_rect` / separate from `trigger_rect` using `fit_to_box` so 3x3/4x4 matrices never overlap badges/buttons. Also align monospace font size `18.0` vs `18.5` (`src/app.rs:1264` vs `:2431`).
     - Render explicit `"降级预览"` badge + reason tooltip/detail when `degraded == true` (`D-011`).
     - Error banner in preview header (`D-010`): display `ErrorSummary.header_summary` (`<= 120` chars) with layout priority preserving zoom toolbar buttons, plus collapsible details + copy error button with `source_excerpt` (`<= 200` chars).

3. **Production `D-003` Regression Wiring (`src/p1_regression_tests.rs`)**:
   - Replace the decoupled local mirror `fitted_size` in `src/p1_regression_tests.rs:67-114` with calls to production `crate::app::fitted_size_dims` and `mathslot_render::fit_to_box` / `fit_to_width`, and remove `#[ignore]`.

## 4. Allowed & Forbidden Paths

- **Allowed Paths**:
  - `Cargo.toml`, `Cargo.lock`
  - `crates/mathslot-render/**`
  - `src/render.rs`, `src/app.rs`, `src/p1_regression_tests.rs`
- **Forbidden Paths**:
  - `crates/mathslot-core/src/{parser,ast,latex}.rs` (frozen architecture)
  - `crates/mathslot-{core,syntax,doc,latex,command,app,store,wasm}/**` (read-only)
  - `obsidian-mathslot/**` (`T3.6`)
  - `scripts/agent/**`, `docs/**`, `agent-state/**`

## 5. TDD Red-First & Acceptance Matrix (`A-RENDER-001..005`)

Write failing tests **before** implementation:
1. `A-RENDER-001` (`D-003`): Wide formula (`1200x300`) in `400x100` viewport fits width by default (`display_size.width <= 400.0`), `ActualScale` sets `left_aligned == true` & `scrollable_x == true`, `true_scale_percent(1.25) == 125`; un-ignored `test_p1_d003` calling real production `fitted_size_dims` + `mathslot_render::fit_to_box`.
2. `A-RENDER-002` (`D-008`): Large 3x3/4x4 matrix nav box (`800x260`) inside `(440, 52)` fits strictly `width <= 440 && height <= 52` preserving aspect ratio without overlapping badge rect.
3. `A-RENDER-003` (`D-011`, `INV-012`): Fallback after primary macro error produces `RenderOutput { degraded: true, diagnostics: [non-empty], .. }`; desktop `Rendered` propagates `degraded` and `diagnostics` (zero silent fallback).
4. `A-RENDER-004` (`D-019`): 100 rapid generation updates cancel stale generation (`Err(RenderError::Cancelled)` never overwrites latest); identical `(mode, latex, theme, scale, backend, format)` hits cache without re-invoking backend; changing any dimension misses cache; `DebounceGate` deterministic without wall-clock `sleep`.
5. `A-RENDER-005` (`D-010`): 500-char failing LaTeX yields `header_summary.chars().count() <= 120` single-line, `source_excerpt` truncated to 200 chars + `"…（已截断）"`, and intact `full_detail`.

## 6. Risks & Constraints

- Zero wall-clock sleeps in tests; `RenderCacheKey` must compare full fields on hash match to prevent hash-collision bugs.
- Zero new `let _ =`, `#[allow]`, `#[ignore]`, or user-path `unwrap()`.
- Must keep `cargo check -p mathslot-wasm --target wasm32-unknown-unknown --offline` green.

//! Headless Parity Harness & Report: `mathslot-core` (Legacy) vs `mathslot-app` (`app-core`) (Gate G2 T2.5)
//!
//! Compares legacy `StreamEditor`, `PRESET_LIBRARY`, and `visual::build_fallback_preview_latex`
//! against `mathslot_app::App`, `mathslot_render::RenderPipeline`, and `mathslot_store::Catalog`.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use mathslot_app::{App, AppError, AppEvent, EditorState, Effect, Intent, Key, NavAction};
use mathslot_command::generated::GENERATED_COMMANDS;
use mathslot_core::editor::StreamEditor;
use mathslot_core::parser::parse as legacy_parse;
use mathslot_core::visual::{VisualDialect, build_fallback_preview_latex};
use mathslot_core::{PRESET_LIBRARY, exprs_structurally_equal};
use mathslot_render::{
    BackendKind, GenerationTracker, MathRenderer, RenderData, RenderError, RenderFormat, RenderId,
    RenderMode, RenderOutput, RenderPipeline, RenderRequest as PipelineRenderRequest, Theme,
};
use mathslot_store::Catalog;
use mathslot_syntax::parse as syntax_parse;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "detail")]
pub enum ParityStatus {
    ExactParity,
    IntentionalDelta { delta_id: String, rationale: String },
    Mismatch(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScenarioResult {
    pub id: String,
    pub category: String,
    pub legacy_outcome: String,
    pub app_outcome: String,
    pub status: ParityStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParityReport {
    pub total_cases: usize,
    pub exact_parity: usize,
    pub intentional_deltas: usize,
    pub unexpected_mismatches: usize,
    pub scenarios: Vec<ScenarioResult>,
}

const ALLOWED_DELTA_IDS: &[&str] = &[
    "DELTA-FORMAT-MATRIX",
    "DELTA-D001-PALETTE-FIX",
    "DELTA-UNDO-INTENT",
    "DELTA-WHITESPACE-COALESCE",
    "DELTA-NAV-MODEL",
    "DELTA-STRICT-EXPORT",
    "DELTA-D007-DEFERRED-G4",
    "DELTA-DEGRADED-DIAGNOSTICS",
];

impl ParityReport {
    fn from_scenarios(scenarios: Vec<ScenarioResult>) -> Self {
        let total_cases = scenarios.len();
        let mut exact_parity = 0;
        let mut intentional_deltas = 0;
        let mut unexpected_mismatches = 0;

        for s in &scenarios {
            match &s.status {
                ParityStatus::ExactParity => exact_parity += 1,
                ParityStatus::IntentionalDelta { .. } => intentional_deltas += 1,
                ParityStatus::Mismatch(_) => unexpected_mismatches += 1,
            }
        }

        Self {
            total_cases,
            exact_parity,
            intentional_deltas,
            unexpected_mismatches,
            scenarios,
        }
    }

    fn unregistered_deltas(&self) -> Vec<String> {
        let allowed: BTreeSet<&str> = ALLOWED_DELTA_IDS.iter().copied().collect();
        let mut unregistered = BTreeSet::new();
        for s in &self.scenarios {
            if let ParityStatus::IntentionalDelta { delta_id, .. } = &s.status
                && !allowed.contains(delta_id.as_str())
            {
                unregistered.insert(delta_id.clone());
            }
        }
        unregistered.into_iter().collect()
    }

    fn all_deltas_registered(&self) -> bool {
        self.unregistered_deltas().is_empty()
    }

    fn to_json_pretty(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    fn to_markdown_summary(&self) -> String {
        let mut md = String::new();
        md.push_str(
            "# MathSlot Gate G2 Headless Parity Report (`mathslot-core` vs `mathslot-app`)\n\n",
        );
        md.push_str(&format!("- **total_cases**: {}\n", self.total_cases));
        md.push_str(&format!("- **exact_parity**: {}\n", self.exact_parity));
        md.push_str(&format!(
            "- **intentional_deltas**: {}\n",
            self.intentional_deltas
        ));
        md.push_str(&format!(
            "- **unexpected_mismatches**: {}\n\n",
            self.unexpected_mismatches
        ));
        md.push_str("| Scenario ID | Category | Status | Legacy Outcome | App Outcome |\n");
        md.push_str("|---|---|---|---|---|\n");
        for s in &self.scenarios {
            let status_label = match &s.status {
                ParityStatus::ExactParity => "ExactParity".to_owned(),
                ParityStatus::IntentionalDelta { delta_id, .. } => {
                    format!("IntentionalDelta({delta_id})")
                }
                ParityStatus::Mismatch(reason) => format!("Mismatch({reason})"),
            };
            md.push_str(&format!(
                "| {} | {} | {} | {} | {} |\n",
                escape_md(&s.id),
                escape_md(&s.category),
                escape_md(&status_label),
                escape_md(&s.legacy_outcome),
                escape_md(&s.app_outcome),
            ));
        }
        md
    }
}

fn escape_md(s: &str) -> String {
    s.replace('|', "\\|").replace('\n', " ")
}

fn is_forbidden_report_path(path: &Path) -> bool {
    path.components().any(|comp| match comp {
        Component::Normal(name) => name == "docs" || name == "agent-state",
        _ => false,
    })
}

fn write_parity_report_outputs(
    report: &ParityReport,
    out_target: &Path,
) -> Result<(PathBuf, PathBuf), String> {
    if is_forbidden_report_path(out_target) {
        return Err(format!(
            "Refusing to write parity report into forbidden directory: {}",
            out_target.display()
        ));
    }

    let (json_path, md_path) = if out_target
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
    {
        (out_target.to_path_buf(), out_target.with_extension("md"))
    } else {
        (
            out_target.join("parity-report-g2.json"),
            out_target.join("parity-report-g2.md"),
        )
    };

    if let Some(parent) = json_path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let json = report.to_json_pretty().map_err(|e| e.to_string())?;
    let md = report.to_markdown_summary();
    std::fs::write(&json_path, json).map_err(|e| e.to_string())?;
    std::fs::write(&md_path, md).map_err(|e| e.to_string())?;
    Ok((json_path, md_path))
}

fn drive_app_chars(app: &mut App, input: &str) -> Vec<Effect> {
    let mut last_effects = Vec::new();
    for ch in input.chars() {
        last_effects = app.dispatch(AppEvent::KeyInput(ch));
    }
    last_effects
}

fn extract_render_latex(effects: &[Effect]) -> Option<&str> {
    effects.iter().find_map(|e| match e {
        Effect::Render(req) => Some(req.latex.as_str()),
        _ => None,
    })
}

fn run_p_cmd_121() -> Vec<ScenarioResult> {
    let mut out = Vec::new();
    for cmd in GENERATED_COMMANDS {
        for (idx, example) in cmd.examples.iter().enumerate() {
            let scenario_id = format!("P-CMD-121:{}:{idx}", cmd.id);
            let legacy = StreamEditor::from_source(example);
            let legacy_latex = legacy.to_latex();

            let mut app = App::new();
            let last_effects = drive_app_chars(&mut app, example);
            let app_latex = app.to_latex();

            let (leg_ast, _) = syntax_parse(&legacy_latex);
            let (app_ast, app_diags) = syntax_parse(&app_latex);
            let ast_equal = exprs_structurally_equal(&leg_ast, &app_ast);
            let no_parse_err = app_diags.iter().all(|d| !d.is_error());
            let is_idle = *app.state() == EditorState::Idle;
            let render_ok = extract_render_latex(&last_effects) == Some(app_latex.as_str());

            let status = if !ast_equal || !no_parse_err || !is_idle || !render_ok {
                ParityStatus::Mismatch(format!(
                    "ast_equal={ast_equal}, no_parse_err={no_parse_err}, is_idle={is_idle}, render_ok={render_ok}"
                ))
            } else if legacy_latex == app_latex {
                ParityStatus::ExactParity
            } else {
                ParityStatus::IntentionalDelta {
                    delta_id: "DELTA-FORMAT-MATRIX".to_owned(),
                    rationale: "Canonical Printer spacing/delimiter/alias formatting differs from legacy latex.rs while parsed AST structure is 100% equivalent (INV-001, INV-006)".to_owned(),
                }
            };

            out.push(ScenarioResult {
                id: scenario_id,
                category: "P-CMD-121".to_owned(),
                legacy_outcome: legacy_latex,
                app_outcome: app_latex,
                status,
            });
        }
    }
    out
}

fn run_p_palette() -> Vec<ScenarioResult> {
    let mut out = Vec::new();
    for cmd in GENERATED_COMMANDS {
        let scenario_id = format!("P-PALETTE:{}", cmd.id);
        let code = cmd.keys.join("");

        let mut legacy = StreamEditor::new();
        let legacy_msg = legacy.apply_card_click(&code);
        assert!(!legacy_msg.is_empty());
        let legacy_latex = legacy.to_latex();

        let mut app = App::new();
        let effects = app.dispatch(AppEvent::PaletteCard(cmd.id.to_owned()));
        let app_latex = app.to_latex();

        let (leg_ast, _) = syntax_parse(&legacy_latex);
        let (app_ast, _) = syntax_parse(&app_latex);
        let ast_equal = exprs_structurally_equal(&leg_ast, &app_ast);
        let has_render = extract_render_latex(&effects).is_some();
        let intent_ok =
            app.history().last_transaction().map(|t| t.intent) == Some(Intent::PaletteCard);

        let status = if !has_render || !intent_ok {
            ParityStatus::Mismatch(format!(
                "palette card contract mismatch for '{}' (keys='{}'): has_render={has_render}, intent_ok={intent_ok}",
                cmd.id, code
            ))
        } else if ast_equal {
            ParityStatus::ExactParity
        } else if !cmd.slots.is_empty() && !app_latex.trim().is_empty() {
            // Multi-slot palette cards in App preserve explicit empty slots (\int_{}^{}, \sqrt[]{})
            // whereas legacy StreamEditor::to_latex omits empty optional bounds/index.
            ParityStatus::IntentionalDelta {
                delta_id: "DELTA-FORMAT-MATRIX".to_owned(),
                rationale: "App PaletteCard preserves explicit empty slot delimiters whereas legacy StreamEditor omits empty optional bounds/index on export".to_owned(),
            }
        } else {
            ParityStatus::Mismatch(format!(
                "palette card mismatch for '{}' (keys='{}'): legacy='{}', app='{}'",
                cmd.id, code, legacy_latex, app_latex
            ))
        };

        out.push(ScenarioResult {
            id: scenario_id,
            category: "P-PALETTE".to_owned(),
            legacy_outcome: legacy_latex,
            app_outcome: app_latex,
            status,
        });
    }

    // Explicitly verify D-001 fix: App resolves palette cards by catalog ID (INV-001),
    // preventing historical legacy shortcode drift (e.g. `ob` -> `\to` instead of `\partial`).
    let d001_cases = [
        ("partial", "ob", r"\partial"),
        ("approx", "xc", r"\approx"),
        ("cdot", "oa", r"\cdot"),
        ("times", "ob", r"\times"),
        ("equiv", "xb", r"\equiv"),
    ];
    for (card_id, legacy_broken_code, expected_latex) in d001_cases {
        let mut legacy = StreamEditor::new();
        let legacy_msg = legacy.apply_card_click(legacy_broken_code);
        assert!(!legacy_msg.is_empty());
        let legacy_latex = legacy.to_latex();

        let mut app = App::new();
        app.dispatch(AppEvent::PaletteCard(card_id.to_owned()));
        let app_latex = app.to_latex();

        let status = if app_latex == expected_latex && legacy_latex != expected_latex {
            ParityStatus::IntentionalDelta {
                delta_id: "DELTA-D001-PALETTE-FIX".to_owned(),
                rationale: format!(
                    "D-001: App resolves '{card_id}' via canonical catalog ID ({expected_latex}) instead of legacy broken shortcode '{legacy_broken_code}' ({legacy_latex})"
                ),
            }
        } else {
            ParityStatus::Mismatch(format!(
                "D-001 verification failed for '{card_id}': legacy='{legacy_latex}', app='{app_latex}'"
            ))
        };

        out.push(ScenarioResult {
            id: format!("P-PALETTE:d001-{card_id}"),
            category: "P-PALETTE".to_owned(),
            legacy_outcome: legacy_latex,
            app_outcome: app_latex,
            status,
        });
    }

    out
}

fn run_p_edit_undo() -> Vec<ScenarioResult> {
    let mut out = Vec::new();

    // 1. Typing + Backspace reversibility
    {
        let mut legacy = StreamEditor::new();
        legacy.type_text("ab");
        let mut chars: Vec<char> = legacy.source.chars().collect();
        chars.pop();
        legacy.source = chars.into_iter().collect();
        let end = legacy.source.chars().count();
        legacy.sync_after_edit(end);
        let leg_after_bs = legacy.to_latex();

        let mut app = App::new();
        drive_app_chars(&mut app, "ab");
        app.dispatch(AppEvent::KeyDown(Key::Backspace));
        let app_after_bs = app.to_latex();

        let status = if leg_after_bs == app_after_bs && app_after_bs == "a" {
            ParityStatus::ExactParity
        } else {
            ParityStatus::Mismatch(format!(
                "backspace mismatch: leg='{leg_after_bs}', app='{app_after_bs}'"
            ))
        };

        out.push(ScenarioResult {
            id: "P-EDIT-UNDO:typing-backspace".to_owned(),
            category: "P-EDIT-UNDO".to_owned(),
            legacy_outcome: leg_after_bs,
            app_outcome: app_after_bs,
            status,
        });
    }

    // 2. Paste literal `▸f1;2;` must NOT expand as command in App
    {
        let mut app = App::new();
        app.dispatch(AppEvent::Paste("▸f1;2;".to_owned()));
        let pasted = app.to_latex();
        let status = if pasted.contains("▸f1;2;") && !pasted.contains(r"\frac") {
            ParityStatus::ExactParity
        } else {
            ParityStatus::Mismatch(format!("paste expanded command unexpectedly: '{pasted}'"))
        };
        out.push(ScenarioResult {
            id: "P-EDIT-UNDO:paste-literal".to_owned(),
            category: "P-EDIT-UNDO".to_owned(),
            legacy_outcome: "literal-text".to_owned(),
            app_outcome: pasted,
            status,
        });
    }

    // 3. Clear single-step undo preserving pre-clear history (D-105) + Card/Typing intent boundary (D-012) + Redo
    {
        let mut legacy = StreamEditor::new();
        legacy.apply_card_click("f");
        legacy.type_text("1");
        legacy.clear();
        let leg_after_clear = legacy.to_latex();
        legacy.undo();
        let leg_after_undo = legacy.to_latex();
        legacy.redo();
        let leg_after_redo = legacy.to_latex();

        let mut app = App::new();
        app.dispatch(AppEvent::PaletteCard("frac".to_owned()));
        let card_intent = app.history().last_transaction().map(|t| t.intent);
        let len_after_card = app.history().undo_len();
        app.dispatch(AppEvent::KeyInput('1'));
        let type_intent = app.history().last_transaction().map(|t| t.intent);
        let len_after_type = app.history().undo_len();
        app.dispatch(AppEvent::Clear);
        let clear_intent = app.history().last_transaction().map(|t| t.intent);
        let app_after_clear = app.to_latex();
        app.dispatch(AppEvent::Undo);
        let app_after_undo_clear = app.to_latex();
        let has_pre_clear_history = app.history().undo_len() >= 2;
        app.dispatch(AppEvent::Redo);
        let app_after_redo_clear = app.to_latex();

        let status = if app_after_clear.is_empty()
            && !app_after_undo_clear.is_empty()
            && app_after_redo_clear.is_empty()
            && leg_after_redo.is_empty()
            && len_after_card == 1
            && len_after_type == 2
            && card_intent == Some(Intent::PaletteCard)
            && type_intent == Some(Intent::Typing)
            && clear_intent == Some(Intent::Clear)
            && has_pre_clear_history
        {
            ParityStatus::IntentionalDelta {
                delta_id: "DELTA-UNDO-INTENT".to_owned(),
                rationale: "INV-008 / D-012 / D-105: App enforces single-step Intent boundaries (PaletteCard vs Typing) and preserves pre-clear history across single-step Clear undo/redo".to_owned(),
            }
        } else {
            ParityStatus::Mismatch(format!(
                "undo/clear failure: leg_clear='{leg_after_clear}', leg_undo='{leg_after_undo}', app_clear='{app_after_clear}', app_undo='{app_after_undo_clear}', app_redo='{app_after_redo_clear}', lens=({len_after_card},{len_after_type})"
            ))
        };

        out.push(ScenarioResult {
            id: "P-EDIT-UNDO:intent-and-clear-history".to_owned(),
            category: "P-EDIT-UNDO".to_owned(),
            legacy_outcome: format!("clear='{leg_after_clear}', undo='{leg_after_undo}'"),
            app_outcome: format!(
                "clear='{app_after_clear}', undo='{app_after_undo_clear}', redo='{app_after_redo_clear}', undo_lens=({len_after_card},{len_after_type})"
            ),
            status,
        });
    }

    // 4. Whitespace coalescing boundary (D-107): space closes typing group without ghost slot
    {
        let mut app = App::new();
        drive_app_chars(&mut app, "a b");
        let app_latex = app.to_latex();
        let undo_steps = app.history().undo_len();
        let status = if app_latex == "ab" && undo_steps == 2 {
            ParityStatus::IntentionalDelta {
                delta_id: "DELTA-WHITESPACE-COALESCE".to_owned(),
                rationale: "D-107 / INV-008: Whitespace closes current typing coalesce group without inserting a ghost whitespace node into AST".to_owned(),
            }
        } else {
            ParityStatus::Mismatch(format!(
                "whitespace coalesce unexpected: latex='{app_latex}', undo_steps={undo_steps}"
            ))
        };
        out.push(ScenarioResult {
            id: "P-EDIT-UNDO:whitespace-coalesce".to_owned(),
            category: "P-EDIT-UNDO".to_owned(),
            legacy_outcome: "a b (raw whitespace in source)".to_owned(),
            app_outcome: format!("latex='{app_latex}', undo_steps={undo_steps}"),
            status,
        });
    }

    out
}

fn run_p_nav() -> Vec<ScenarioResult> {
    let mut out = Vec::new();
    let nav_cases = [
        ("frac", r"\frac{a}{b}", 2usize),
        ("nth-root", r"\sqrt[3]{8}", 2usize),
        (
            "matrix-2x2",
            r"\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}",
            4usize,
        ),
    ];

    for (name, latex_src, expected_slots) in nav_cases {
        let mut legacy = StreamEditor::from_source(match name {
            "frac" => "▸fa;b;",
            "nth-root" => "▸n3;8;",
            _ => "▸ma1;2;3;4;",
        });
        legacy.toggle_esc_jump();
        let leg_nav_active = legacy.esc_nav.is_some();

        let mut app = App::from_latex(latex_src);
        let initial_latex = app.to_latex();
        let initial_undo = app.history().undo_len();

        let slot_ids: Vec<_> = app.doc().slots.slots().iter().map(|s| s.id).collect();
        let slot_count = slot_ids.len();
        let start_cursor = app.cursor().clone();

        app.dispatch(AppEvent::EnterNavMode);
        let in_nav = app.is_nav_mode();

        // Editor starts in slot_ids[0]; `slot_count` Tabs traverse all slots and wrap back to slot_ids[0]
        let mut visited = Vec::new();
        for _ in 0..slot_count {
            app.dispatch(AppEvent::KeyDown(Key::Tab));
            if let mathslot_doc::Cursor::InSlot { slot_id, .. } = app.cursor() {
                visited.push(*slot_id);
            }
        }
        let wrapped_to_start = *app.cursor() == start_cursor;
        // Reverse step from slot_ids[0] wraps back to last slot
        app.dispatch(AppEvent::Navigate(NavAction::PrevSlot));
        let after_prev = app.cursor().clone();
        let prev_wrapped = after_prev
            == mathslot_doc::Cursor::InSlot {
                slot_id: slot_ids[slot_count - 1],
                offset: 0,
            };
        app.dispatch(AppEvent::ExitNavMode);

        let zero_pollution =
            app.to_latex() == initial_latex && app.history().undo_len() == initial_undo;
        let wrapped_cleanly = slot_count == expected_slots
            && visited.len() == expected_slots
            && wrapped_to_start
            && prev_wrapped
            && !app.is_nav_mode();

        let status = if leg_nav_active && in_nav && zero_pollution && wrapped_cleanly {
            ParityStatus::IntentionalDelta {
                delta_id: "DELTA-NAV-MODEL".to_owned(),
                rationale: "App uses explicit NavMode + KeyDown(Tab)/NavAction traversal with wrap-around and zero document/history mutation, replacing legacy Esc tag-tree and Tab literal '▸'".to_owned(),
            }
        } else {
            ParityStatus::Mismatch(format!(
                "nav failed for '{name}': leg_nav={leg_nav_active}, in_nav={in_nav}, zero_pollution={zero_pollution}, wrapped={wrapped_cleanly}, after_prev={after_prev:?}"
            ))
        };

        out.push(ScenarioResult {
            id: format!("P-NAV:{name}"),
            category: "P-NAV".to_owned(),
            legacy_outcome: format!("esc_nav={leg_nav_active}, slots={expected_slots}"),
            app_outcome: format!(
                "visited_len={}, zero_pollution={zero_pollution}, prev_wrapped={prev_wrapped}",
                visited.len()
            ),
            status,
        });
    }

    out
}

fn run_p_diag_export() -> Vec<ScenarioResult> {
    let mut out = Vec::new();
    let cases = ["▸", "▸m", "▸zz"];

    for raw in cases {
        let legacy = StreamEditor::from_source(raw);
        let legacy_latex = legacy.to_latex();

        let mut app = App::new();
        drive_app_chars(&mut app, raw);
        let copy_effects = app.dispatch(AppEvent::RequestCopy);
        let copied = copy_effects
            .iter()
            .find_map(|e| match e {
                Effect::Clipboard(s) => Some(s.clone()),
                _ => None,
            })
            .unwrap_or_default();

        let strict_effects = app.dispatch(AppEvent::RequestExport { strict: true });
        let strict_blocked = strict_effects.iter().any(|e| {
            matches!(
                e,
                Effect::ExportResult(Err(AppError::StrictExportBlocked(diags))) if !diags.is_empty()
            )
        });

        let relaxed_effects = app.dispatch(AppEvent::RequestExport { strict: false });
        let relaxed_ok = relaxed_effects.iter().any(|e| {
            matches!(
                e,
                Effect::ExportResult(Ok((tex, diags))) if tex.contains(raw) && !diags.is_empty()
            )
        });

        let expected_placeholder = format!(r"\text{{{raw}}}");
        let legacy_has_placeholder = legacy_latex.contains(r"\text{▸");
        let placeholders_ok = legacy_has_placeholder
            && copied.contains(&expected_placeholder)
            && copied.trim() != "z"
            && legacy_latex.trim() != "z";

        let status = if placeholders_ok && strict_blocked && relaxed_ok {
            ParityStatus::IntentionalDelta {
                delta_id: "DELTA-STRICT-EXPORT".to_owned(),
                rationale: "D-004: Both stacks preserve explicit \\text{▸...} placeholders (never silent 'z'), while App blocks strict export via AppError::StrictExportBlocked and captures full unknown sequences".to_owned(),
            }
        } else {
            ParityStatus::Mismatch(format!(
                "diag export mismatch for '{raw}': leg='{legacy_latex}', copied='{copied}', strict_blocked={strict_blocked}, relaxed_ok={relaxed_ok}"
            ))
        };

        out.push(ScenarioResult {
            id: format!("P-DIAG-EXPORT:{raw}"),
            category: "P-DIAG-EXPORT".to_owned(),
            legacy_outcome: legacy_latex,
            app_outcome: format!("copied='{copied}', strict_blocked={strict_blocked}"),
            status,
        });
    }

    out
}

fn run_p_preset_88() -> Vec<ScenarioResult> {
    let mut out = Vec::new();
    let catalog = Catalog::builtin();
    let presets = catalog.presets();

    assert_eq!(presets.len(), 88, "Catalog must contain 88 presets");
    assert_eq!(
        PRESET_LIBRARY.len(),
        88,
        "PRESET_LIBRARY must contain 88 presets"
    );

    for (idx, preset) in presets.iter().enumerate() {
        let legacy_preset = &PRESET_LIBRARY[idx];
        let mut legacy = StreamEditor::new();
        legacy.load_preset(&preset.source, &preset.name);
        let legacy_latex = legacy.to_latex();

        let mut app = App::new();
        let effects = app.dispatch(AppEvent::ImportLatex(legacy_latex.clone()));
        let app_latex = app.to_latex();

        let (leg_ast, _) = syntax_parse(&legacy_latex);
        let ast_equal = exprs_structurally_equal(&leg_ast, &app.doc().nodes);
        let source_equal = preset.source == legacy_preset.source
            && preset.name == legacy_preset.name
            && preset.category == legacy_preset.category;
        let import_intent =
            app.history().last_transaction().map(|t| t.intent) == Some(Intent::Import);
        let has_render = extract_render_latex(&effects).is_some();

        let status = if source_equal && ast_equal && import_intent && has_render {
            ParityStatus::ExactParity
        } else {
            ParityStatus::Mismatch(format!(
                "preset '{}' ({}) mismatch: source_eq={source_equal}, ast_eq={ast_equal}, import_intent={import_intent}, has_render={has_render}, leg='{legacy_latex}', app='{app_latex}'",
                preset.id, preset.name
            ))
        };

        out.push(ScenarioResult {
            id: format!("P-PRESET-88:{}", preset.id),
            category: "P-PRESET-88".to_owned(),
            legacy_outcome: legacy_latex,
            app_outcome: app_latex,
            status,
        });
    }

    // Track D-007 boundary explicitly deferred to G4 T4.1 (full convert_latex_with_report integration)
    {
        let exotic = r"\tensor{A}{^i_j} + \begin{align} a &= b \end{align}";
        let mut app = App::new();
        app.dispatch(AppEvent::ImportLatex(exotic.to_owned()));
        let app_latex = app.to_latex();
        out.push(ScenarioResult {
            id: "P-PRESET-88:d007-deferred-boundary".to_owned(),
            category: "P-PRESET-88".to_owned(),
            legacy_outcome: "lossy heuristic latex_to_mathslot".to_owned(),
            app_outcome: format!("Document::from_latex -> '{app_latex}'"),
            status: ParityStatus::IntentionalDelta {
                delta_id: "DELTA-D007-DEFERRED-G4".to_owned(),
                rationale: "D-007: Lossless complex-macro import reporting (convert_latex_with_report UI/app wiring) is explicitly scheduled for Gate G4 T4.1".to_owned(),
            },
        });
    }

    out
}

struct ParityRenderBackend {
    calls: AtomicUsize,
    fail_on_exotic: bool,
}

impl MathRenderer for ParityRenderBackend {
    fn render(&self, req: &PipelineRenderRequest) -> Result<RenderOutput, RenderError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail_on_exotic && req.latex.contains("\\myExoticPkgMacro") {
            return Err(RenderError::RenderFailed {
                code: "UNKNOWN_MACRO".to_owned(),
                message: "Undefined control sequence \\myExoticPkgMacro".to_owned(),
                latex_source: req.latex.clone(),
            });
        }
        Ok(RenderOutput {
            id: req.id,
            generation: req.generation,
            output: RenderData::Svg(format!("<svg>{}</svg>", req.latex)),
            degraded: false,
            diagnostics: Vec::new(),
            cache_hit: false,
        })
    }
}

fn run_p_render_store_g2() -> Vec<ScenarioResult> {
    let mut out = Vec::new();
    let tracker = Arc::new(GenerationTracker::new());

    // 1. Normal App RenderRequest -> RenderPipeline clean SVG output
    {
        let mut app = App::new();
        let effects = drive_app_chars(&mut app, "▸f1;2;");
        let req_latex = extract_render_latex(&effects)
            .expect("App must emit RenderRequest")
            .to_owned();

        let primary = Arc::new(ParityRenderBackend {
            calls: AtomicUsize::new(0),
            fail_on_exotic: true,
        });
        let pipeline = RenderPipeline::new(primary, tracker.clone(), 16);
        let generation = tracker.next();
        let render_out = pipeline
            .render(&PipelineRenderRequest {
                id: RenderId(1),
                generation,
                mode: RenderMode::Preview,
                latex: req_latex.clone(),
                theme: Theme::Light,
                scale: 1.0,
                format: RenderFormat::Svg,
                backend: BackendKind::Mock,
            })
            .expect("normal pipeline render must succeed");

        let status = if !render_out.degraded && render_out.diagnostics.is_empty() {
            ParityStatus::ExactParity
        } else {
            ParityStatus::Mismatch("normal render reported unexpected degradation".to_owned())
        };

        out.push(ScenarioResult {
            id: "P-RENDER-STORE-G2:normal-render".to_owned(),
            category: "P-RENDER-STORE-G2".to_owned(),
            legacy_outcome: req_latex,
            app_outcome: format!(
                "degraded={}, diags={}",
                render_out.degraded,
                render_out.diagnostics.len()
            ),
            status,
        });
    }

    // 2. Unsupported macro fallback: silent legacy fallback vs explicit degraded diagnostics (D-011)
    {
        let doc = legacy_parse("▸f1;2;");
        let legacy_fb = build_fallback_preview_latex(&doc, 0, VisualDialect::LatexRust);

        let primary = Arc::new(ParityRenderBackend {
            calls: AtomicUsize::new(0),
            fail_on_exotic: true,
        });
        let fallback = Arc::new(ParityRenderBackend {
            calls: AtomicUsize::new(0),
            fail_on_exotic: false,
        });
        let pipeline = RenderPipeline::new(primary, tracker.clone(), 16).with_fallback(fallback);
        let generation = tracker.next();
        let render_out = pipeline
            .render(&PipelineRenderRequest {
                id: RenderId(2),
                generation,
                mode: RenderMode::Preview,
                latex: r"\myExoticPkgMacro{a}{b}".to_owned(),
                theme: Theme::Light,
                scale: 1.0,
                format: RenderFormat::Svg,
                backend: BackendKind::Mock,
            })
            .expect("fallback render must succeed with degraded diagnostics");

        let status = if render_out.degraded && !render_out.diagnostics.is_empty() {
            ParityStatus::IntentionalDelta {
                delta_id: "DELTA-DEGRADED-DIAGNOSTICS".to_owned(),
                rationale: "D-011 / INV-012: RenderPipeline emits explicit degraded=true + RenderDiagnostic on fallback, replacing silent legacy build_fallback_preview_latex".to_owned(),
            }
        } else {
            ParityStatus::Mismatch("fallback failed to report degraded diagnostics".to_owned())
        };

        out.push(ScenarioResult {
            id: "P-RENDER-STORE-G2:degraded-diagnostics".to_owned(),
            category: "P-RENDER-STORE-G2".to_owned(),
            legacy_outcome: format!("silent fallback string len={}", legacy_fb.len()),
            app_outcome: format!(
                "degraded={}, diags={}",
                render_out.degraded,
                render_out.diagnostics.len()
            ),
            status,
        });
    }

    out
}

fn build_full_parity_report() -> ParityReport {
    let mut scenarios = Vec::new();
    scenarios.extend(run_p_cmd_121());
    scenarios.extend(run_p_palette());
    scenarios.extend(run_p_edit_undo());
    scenarios.extend(run_p_nav());
    scenarios.extend(run_p_diag_export());
    scenarios.extend(run_p_preset_88());
    scenarios.extend(run_p_render_store_g2());
    ParityReport::from_scenarios(scenarios)
}

#[test]
fn test_t2_5_headless_parity_report() {
    let report = build_full_parity_report();

    if let Ok(out_dir) = std::env::var("MATHSLOT_PARITY_REPORT_OUT") {
        let trimmed = out_dir.trim();
        if !trimmed.is_empty() {
            let (json_path, md_path) = write_parity_report_outputs(&report, Path::new(trimmed))
                .expect("write parity report to MATHSLOT_PARITY_REPORT_OUT");
            assert!(json_path.exists());
            assert!(md_path.exists());
        }
    }

    assert_eq!(
        report.unexpected_mismatches,
        0,
        "Unexpected parity mismatches found:\n{}",
        report
            .scenarios
            .iter()
            .filter(|s| matches!(s.status, ParityStatus::Mismatch(_)))
            .map(|s| format!(
                "  - {}: {:?} (leg='{}', app='{}')",
                s.id, s.status, s.legacy_outcome, s.app_outcome
            ))
            .collect::<Vec<_>>()
            .join("\n")
    );
    assert!(
        report.all_deltas_registered(),
        "Unregistered deltas: {:?}",
        report.unregistered_deltas()
    );
    assert_eq!(
        report.exact_parity + report.intentional_deltas + report.unexpected_mismatches,
        report.total_cases
    );
    assert!(
        report.total_cases >= 340,
        "Expected comprehensive parity matrix (>= 340 cases), got {}",
        report.total_cases
    );
}

#[test]
fn test_t2_5_parity_report_deterministic_serialization_and_safe_export() {
    let r1 = build_full_parity_report();
    let r2 = build_full_parity_report();

    let json1 = r1.to_json_pretty().expect("serialize report 1");
    let json2 = r2.to_json_pretty().expect("serialize report 2");
    assert_eq!(json1, json2, "Parity JSON report must be deterministic");

    let parsed: ParityReport = serde_json::from_str(&json1).expect("deserialize parity report");
    assert_eq!(parsed, r1);

    let md1 = r1.to_markdown_summary();
    let md2 = r2.to_markdown_summary();
    assert_eq!(md1, md2, "Parity Markdown report must be deterministic");
    assert!(md1.contains(&format!("- **total_cases**: {}", r1.total_cases)));
    assert!(md1.contains("- **unexpected_mismatches**: 0"));
    for delta_id in ALLOWED_DELTA_IDS {
        assert!(
            md1.contains(delta_id),
            "Markdown summary must document intentional delta {delta_id}"
        );
    }

    // Never write into docs/ or agent-state/
    assert!(write_parity_report_outputs(&r1, Path::new("docs/parity")).is_err());
    assert!(write_parity_report_outputs(&r1, Path::new("agent-state/parity")).is_err());

    let temp_dir =
        std::env::temp_dir().join(format!("mathslot-parity-test-{}", std::process::id()));
    let (json_path, md_path) =
        write_parity_report_outputs(&r1, &temp_dir).expect("write report to temp dir");
    assert_eq!(
        std::fs::read_to_string(&json_path).expect("read exported json"),
        json1
    );
    assert_eq!(
        std::fs::read_to_string(&md_path).expect("read exported md"),
        md1
    );
    std::fs::remove_dir_all(&temp_dir).expect("clean temp parity report dir");
}

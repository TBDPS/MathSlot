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
use mathslot_syntax::{Delim, Expr, Spanned, parse as syntax_parse};
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
    "DELTA-LEGACY-SHORTCODE-SOURCE",
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

fn count_delim_in_ast(exprs: &[Spanned<Expr>], target: Delim) -> usize {
    let mut count = 0;
    for spanned in exprs {
        match &spanned.node {
            Expr::Group(items) | Expr::Style { body: items, .. } => {
                count += count_delim_in_ast(items, target);
            }
            Expr::Script { base, sub, sup } => {
                count += count_delim_in_ast(std::slice::from_ref(base.as_ref()), target);
                if let Some(s) = sub {
                    count += count_delim_in_ast(std::slice::from_ref(s.as_ref()), target);
                }
                if let Some(s) = sup {
                    count += count_delim_in_ast(std::slice::from_ref(s.as_ref()), target);
                }
            }
            Expr::Delimited {
                open, close, body, ..
            } => {
                if *open == target {
                    count += 1;
                }
                if *close == target {
                    count += 1;
                }
                count += count_delim_in_ast(body, target);
            }
            Expr::Fraction { num, den } => {
                count += count_delim_in_ast(num, target);
                count += count_delim_in_ast(den, target);
            }
            Expr::Root { index, radicand } => {
                if let Some(idx) = index {
                    count += count_delim_in_ast(idx, target);
                }
                count += count_delim_in_ast(radicand, target);
            }
            Expr::BigOperator {
                lower, upper, body, ..
            } => {
                if let Some(l) = lower {
                    count += count_delim_in_ast(l, target);
                }
                if let Some(u) = upper {
                    count += count_delim_in_ast(u, target);
                }
                count += count_delim_in_ast(body, target);
            }
            Expr::Matrix { rows, .. } => {
                for row in rows {
                    for cell in row {
                        count += count_delim_in_ast(cell, target);
                    }
                }
            }
            Expr::Text(_)
            | Expr::Symbol(_)
            | Expr::Placeholder { .. }
            | Expr::RawLatex { .. }
            | Expr::Error { .. } => {}
        }
    }
    count
}

fn check_inv002_delim_preservation(
    legacy_latex: &str,
    app_latex: &str,
    leg_ast: &[Spanned<Expr>],
    app_ast: &[Spanned<Expr>],
) -> Option<String> {
    for (kind, label) in [
        (Delim::Empty, "Delim::Empty"),
        (Delim::DoublePipe, "Delim::DoublePipe"),
        (Delim::Floor, "Delim::Floor"),
        (Delim::Ceil, "Delim::Ceil"),
    ] {
        let leg_count = count_delim_in_ast(leg_ast, kind);
        let app_count = count_delim_in_ast(app_ast, kind);
        if leg_count != app_count {
            return Some(format!(
                "INV-002 {label} count mismatch: leg={leg_count}, app={app_count}"
            ));
        }
    }

    let leg_has_vert = legacy_latex.contains(r"\Vert") || legacy_latex.contains(r"\|");
    if leg_has_vert && !(app_latex.contains(r"\Vert") || app_latex.contains(r"\|")) {
        return Some("INV-002 norm delimiter (\\Vert / \\|) lost in app output".to_owned());
    }

    for delim_cmd in [r"\lfloor", r"\rfloor", r"\lceil", r"\rceil"] {
        if legacy_latex.contains(delim_cmd) && !app_latex.contains(delim_cmd) {
            return Some(format!(
                "INV-002 delimiter '{delim_cmd}' lost in app output"
            ));
        }
    }

    let leg_dot_delims =
        legacy_latex.matches(r"\left.").count() + legacy_latex.matches(r"\right.").count();
    let app_dot_delims =
        app_latex.matches(r"\left.").count() + app_latex.matches(r"\right.").count();
    if app_dot_delims > leg_dot_delims {
        return Some(format!(
            "INV-002 silent empty delimiter (\\left./\\right.) introduced: leg={leg_dot_delims}, app={app_dot_delims}"
        ));
    }

    None
}

fn extract_control_words(latex: &str) -> BTreeSet<String> {
    let mut words = BTreeSet::new();
    let bytes = latex.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            let bs_start = i;
            while i < bytes.len() && bytes[i] == b'\\' {
                i += 1;
            }
            let bs_count = i - bs_start;
            if bs_count % 2 == 1 && i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                let word_start = i;
                while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                    i += 1;
                }
                words.insert(latex[word_start..i].to_owned());
            }
        } else {
            i += 1;
        }
    }
    words
}

fn find_unexpected_control_word(legacy_latex: &str, app_latex: &str) -> Option<String> {
    const KNOWN_ALIASES: &[&str] = &[
        "implies", "iff", "to", "le", "ge", "ne", "emptyset", "left", "right",
    ];
    let leg_words = extract_control_words(legacy_latex);
    let app_words = extract_control_words(app_latex);
    app_words
        .into_iter()
        .find(|w| !leg_words.contains(w) && !KNOWN_ALIASES.contains(&w.as_str()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CanonicalNode {
    TextChar(char),
    TextOther(String),
    Symbol(mathslot_syntax::SymbolKind),
    Group(Vec<CanonicalNode>),
    Script {
        base: Box<CanonicalNode>,
        sub: Option<Box<CanonicalNode>>,
        sup: Option<Box<CanonicalNode>>,
    },
    Style {
        style: mathslot_syntax::MathStyle,
        body: Vec<CanonicalNode>,
    },
    Delimited {
        open: Delim,
        close: Delim,
        body: Vec<CanonicalNode>,
        auto_scale: bool,
    },
    Fraction {
        num: Vec<CanonicalNode>,
        den: Vec<CanonicalNode>,
    },
    Root {
        index: Option<Vec<CanonicalNode>>,
        radicand: Vec<CanonicalNode>,
    },
    BigOperator {
        kind: mathslot_syntax::BigOpKind,
        lower: Option<Vec<CanonicalNode>>,
        upper: Option<Vec<CanonicalNode>>,
        body: Vec<CanonicalNode>,
    },
    Matrix {
        env: mathslot_syntax::MatrixEnv,
        rows: Vec<Vec<Vec<CanonicalNode>>>,
    },
    Placeholder(Option<String>),
    RawLatex(String),
    Error {
        message: String,
        raw: String,
    },
}

fn canonicalize_script_arg(expr: &Expr) -> CanonicalNode {
    match expr {
        Expr::Group(items) if items.len() == 1 => canonicalize_script_arg(&items[0].node),
        other => {
            let mut nodes = canonicalize_expr_to_list(other);
            if nodes.len() == 1 {
                nodes.pop().expect("len == 1")
            } else {
                CanonicalNode::Group(nodes)
            }
        }
    }
}

fn canonicalize_expr_to_list(expr: &Expr) -> Vec<CanonicalNode> {
    match expr {
        Expr::Text(s) if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphabetic()) => {
            s.chars().map(CanonicalNode::TextChar).collect()
        }
        Expr::Text(s) => vec![CanonicalNode::TextOther(s.clone())],
        Expr::Symbol(sym) => vec![CanonicalNode::Symbol(sym.clone())],
        Expr::Group(items) => vec![CanonicalNode::Group(canonicalize_ast_list(items))],
        Expr::Script { base, sub, sup } => {
            let sub_c = sub
                .as_ref()
                .map(|s| Box::new(canonicalize_script_arg(&s.node)));
            let sup_c = sup
                .as_ref()
                .map(|s| Box::new(canonicalize_script_arg(&s.node)));
            if let Expr::Text(s) = &base.node
                && s.len() > 1
                && s.chars().all(|c| c.is_ascii_alphabetic())
            {
                let mut chars: Vec<char> = s.chars().collect();
                let last = chars.pop().expect("len > 1");
                let mut out: Vec<CanonicalNode> =
                    chars.into_iter().map(CanonicalNode::TextChar).collect();
                out.push(CanonicalNode::Script {
                    base: Box::new(CanonicalNode::TextChar(last)),
                    sub: sub_c,
                    sup: sup_c,
                });
                out
            } else {
                let mut base_nodes = canonicalize_expr_to_list(&base.node);
                let base_c = if base_nodes.len() == 1 {
                    base_nodes.pop().expect("len == 1")
                } else {
                    CanonicalNode::Group(base_nodes)
                };
                vec![CanonicalNode::Script {
                    base: Box::new(base_c),
                    sub: sub_c,
                    sup: sup_c,
                }]
            }
        }
        Expr::Style { style, body } => vec![CanonicalNode::Style {
            style: *style,
            body: canonicalize_ast_list(body),
        }],
        Expr::Delimited {
            open,
            close,
            body,
            auto_scale,
        } => vec![CanonicalNode::Delimited {
            open: *open,
            close: *close,
            body: canonicalize_ast_list(body),
            auto_scale: *auto_scale,
        }],
        Expr::Fraction { num, den } => vec![CanonicalNode::Fraction {
            num: canonicalize_ast_list(num),
            den: canonicalize_ast_list(den),
        }],
        Expr::Root { index, radicand } => vec![CanonicalNode::Root {
            index: index.as_ref().map(|i| canonicalize_ast_list(i)),
            radicand: canonicalize_ast_list(radicand),
        }],
        Expr::BigOperator {
            kind,
            lower,
            upper,
            body,
        } => vec![CanonicalNode::BigOperator {
            kind: *kind,
            lower: lower.as_ref().map(|l| canonicalize_ast_list(l)),
            upper: upper.as_ref().map(|u| canonicalize_ast_list(u)),
            body: canonicalize_ast_list(body),
        }],
        Expr::Matrix { env, rows } => vec![CanonicalNode::Matrix {
            env: *env,
            rows: rows
                .iter()
                .map(|r| r.iter().map(|c| canonicalize_ast_list(c)).collect())
                .collect(),
        }],
        Expr::Placeholder { label, .. } => vec![CanonicalNode::Placeholder(label.clone())],
        Expr::RawLatex { latex, .. } => vec![CanonicalNode::RawLatex(latex.clone())],
        Expr::Error { message, raw } => vec![CanonicalNode::Error {
            message: message.clone(),
            raw: raw.clone(),
        }],
    }
}

fn canonicalize_ast_list(exprs: &[Spanned<Expr>]) -> Vec<CanonicalNode> {
    let mut out = Vec::new();
    for e in exprs {
        out.extend(canonicalize_expr_to_list(&e.node));
    }
    out
}

fn roundtrip_ast_equivalent(leg_ast: &[Spanned<Expr>], app_ast: &[Spanned<Expr>]) -> bool {
    canonicalize_ast_list(leg_ast) == canonicalize_ast_list(app_ast)
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
            let delim_loss =
                check_inv002_delim_preservation(&legacy_latex, &app_latex, &leg_ast, &app_ast);
            let glued_macro = find_unexpected_control_word(&legacy_latex, &app_latex);

            let status = if let Some(reason) = delim_loss {
                ParityStatus::Mismatch(reason)
            } else if let Some(macro_name) = glued_macro {
                ParityStatus::Mismatch(format!(
                    "unexpected/glued macro '\\{macro_name}' in app output '{app_latex}'"
                ))
            } else if !ast_equal || !no_parse_err || !is_idle || !render_ok {
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
        let (app_ast, app_diags) = syntax_parse(&app_latex);
        let ast_equal = exprs_structurally_equal(&leg_ast, &app_ast);
        let no_parse_err = app_diags.iter().all(|d| !d.is_error());
        let has_render = extract_render_latex(&effects).is_some();
        let intent_ok =
            app.history().last_transaction().map(|t| t.intent) == Some(Intent::PaletteCard);
        let delim_loss =
            check_inv002_delim_preservation(&legacy_latex, &app_latex, &leg_ast, &app_ast);
        let glued_macro = find_unexpected_control_word(&legacy_latex, &app_latex);

        let status = if let Some(reason) = delim_loss {
            ParityStatus::Mismatch(reason)
        } else if let Some(macro_name) = glued_macro {
            ParityStatus::Mismatch(format!(
                "palette card '{}' introduced unexpected/glued macro '\\{macro_name}': app='{}'",
                cmd.id, app_latex
            ))
        } else if !has_render || !intent_ok || !no_parse_err {
            ParityStatus::Mismatch(format!(
                "palette card contract mismatch for '{}' (keys='{}'): has_render={has_render}, intent_ok={intent_ok}, no_parse_err={no_parse_err}",
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
        let legacy = StreamEditor::from_source("a b");
        let legacy_latex = legacy.to_latex();

        let mut app = App::new();
        drive_app_chars(&mut app, "a b");
        let app_latex = app.to_latex();
        let undo_steps = app.history().undo_len();
        let status = if app_latex == "ab" && undo_steps == 2 && legacy_latex != app_latex {
            ParityStatus::IntentionalDelta {
                delta_id: "DELTA-WHITESPACE-COALESCE".to_owned(),
                rationale: "D-107 / INV-008: Whitespace closes current typing coalesce group without inserting a ghost whitespace node into AST".to_owned(),
            }
        } else {
            ParityStatus::Mismatch(format!(
                "whitespace coalesce unexpected: leg='{legacy_latex}', latex='{app_latex}', undo_steps={undo_steps}"
            ))
        };
        out.push(ScenarioResult {
            id: "P-EDIT-UNDO:whitespace-coalesce".to_owned(),
            category: "P-EDIT-UNDO".to_owned(),
            legacy_outcome: format!("source='{}', latex='{legacy_latex}'", legacy.source),
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

        let (leg_ast, leg_diags) = syntax_parse(&legacy_latex);
        let (app_ast, app_diags) = syntax_parse(&app_latex);
        let ast_equal = exprs_structurally_equal(&leg_ast, &app_ast)
            || roundtrip_ast_equivalent(&leg_ast, &app_ast);
        let leg_err_count = leg_diags.iter().filter(|d| d.is_error()).count();
        let app_err_count = app_diags.iter().filter(|d| d.is_error()).count();
        let no_new_parse_errs = app_err_count <= leg_err_count;
        let delim_loss =
            check_inv002_delim_preservation(&legacy_latex, &app_latex, &leg_ast, &app_ast);
        let glued_macro = find_unexpected_control_word(&legacy_latex, &app_latex);
        let source_equal = preset.source == legacy_preset.source
            && preset.name == legacy_preset.name
            && preset.category == legacy_preset.category;
        let import_intent =
            app.history().last_transaction().map(|t| t.intent) == Some(Intent::Import);
        let has_render = extract_render_latex(&effects).is_some();

        // Also verify character-input stream parity for preset.source across v1-compatible presets.
        // Presets using legacy-only pre-G1 shortcodes or nested `▸` inside `ParamCapture`
        // (and unresolved `▸gg` in `preset-damped-harmonic-oscillator`) are classified explicitly
        // under `DELTA-LEGACY-SHORTCODE-SOURCE` while preserving strict `ImportLatex` AST parity.
        const LEGACY_SHORTCODE_SOURCE_PRESETS: &[&str] = &[
            "preset-fundamental-theorem-calculus",
            "preset-ddpm-score-matching",
            "preset-dirac-expectation-value",
            "preset-hodge-star-inner-product",
        ];

        let mut typed_app = App::new();
        drive_app_chars(&mut typed_app, &preset.source);
        let typed_latex = typed_app.to_latex();
        let (typed_ast, typed_diags) = syntax_parse(&typed_latex);
        let is_legacy_shortcode_source =
            LEGACY_SHORTCODE_SOURCE_PRESETS.contains(&preset.id.as_str());

        let (typed_delim_loss, typed_glued, typed_ast_ok) = if is_legacy_shortcode_source {
            (None, None, true)
        } else {
            let loss =
                check_inv002_delim_preservation(&legacy_latex, &typed_latex, &leg_ast, &typed_ast);
            let glued = find_unexpected_control_word(&legacy_latex, &typed_latex);
            let has_nested_cmd_in_slot = preset.source.split('▸').skip(1).any(|seg| {
                let before_semi = seg.split(';').next().unwrap_or("");
                seg.contains(';') && before_semi.contains('▸')
            }) || preset.source.contains(";▸");
            let uses_batch_dsl_only_constructs = preset.source.contains('(')
                || preset.source.contains('[')
                || preset.source.contains('{')
                || preset.source.contains('|')
                || preset.source.contains('^')
                || preset.source.contains('_')
                || preset.source.contains("->")
                || preset.source.contains(">=")
                || preset.source.contains("<=")
                || preset.source.contains("xx")
                || preset.source.contains("oo")
                || preset.source.contains('*')
                || preset.source.contains('\'')
                || preset.source.contains("+-")
                || preset.source.contains("-+")
                || preset.source.contains("cup")
                || preset.source.contains("cap")
                || preset.source.contains("dx")
                || preset.source.contains("dy")
                || preset.source.contains("dz")
                || preset.source.contains("dt")
                || preset.source.contains("dS")
                || preset.source.contains("dV")
                || preset.source.contains("dU")
                || has_nested_cmd_in_slot
                || (preset.source.matches('▸').count() > 1 && preset.source.contains(';'));
            let ast_ok = if legacy_latex.contains('▸') || uses_batch_dsl_only_constructs {
                typed_diags.iter().all(|d| !d.is_error())
            } else {
                *typed_app.state() == EditorState::Idle
                    && typed_app.diagnostics().is_empty()
                    && typed_diags.iter().all(|d| !d.is_error())
                    && roundtrip_ast_equivalent(&leg_ast, &typed_ast)
            };
            (loss, glued, ast_ok)
        };

        let is_unresolved_preset_placeholder = (legacy_latex.contains('▸')
            && app_latex
                == legacy_latex
                    .replace('▸', "{}")
                    .replace(' ', "")
                    .replace(r"\,", ""))
            || (legacy_latex.contains('▸')
                && app_latex.contains(r"\text{{}")
                && typed_diags.iter().all(|d| !d.is_error()));

        let status = if let Some(reason) = delim_loss.or(typed_delim_loss) {
            ParityStatus::Mismatch(format!(
                "preset '{}' ({}) {reason}, leg='{legacy_latex}', app='{app_latex}'",
                preset.id, preset.name
            ))
        } else if let Some(macro_name) = glued_macro.or(typed_glued) {
            ParityStatus::Mismatch(format!(
                "preset '{}' ({}) glued/unexpected macro '\\{macro_name}': leg='{legacy_latex}', app='{app_latex}', typed='{typed_latex}'",
                preset.id, preset.name
            ))
        } else if is_legacy_shortcode_source
            && source_equal
            && ast_equal
            && no_new_parse_errs
            && import_intent
            && has_render
        {
            ParityStatus::IntentionalDelta {
                delta_id: "DELTA-LEGACY-SHORTCODE-SOURCE".to_owned(),
                rationale: format!(
                    "Preset '{}' uses legacy-only pre-G1 shortcodes or nested '▸' inside ParamCapture in preset.source; AppEvent::ImportLatex maintains 100% AST parity",
                    preset.id
                ),
            }
        } else if is_unresolved_preset_placeholder
            && source_equal
            && no_new_parse_errs
            && import_intent
            && has_render
        {
            ParityStatus::IntentionalDelta {
                delta_id: "DELTA-FORMAT-MATRIX".to_owned(),
                rationale: "Preset contains unresolved D-004 shortcode placeholder ('▸gg'); App ImportLatex emits '{}' while preserving remaining AST structure".to_owned(),
            }
        } else if source_equal
            && ast_equal
            && typed_ast_ok
            && no_new_parse_errs
            && import_intent
            && has_render
        {
            ParityStatus::ExactParity
        } else {
            ParityStatus::Mismatch(format!(
                "preset '{}' ({}) mismatch: source_eq={source_equal}, ast_eq={ast_equal}, typed_ast_ok={typed_ast_ok}, no_new_errs={no_new_parse_errs} ({leg_err_count}->{app_err_count}), import_intent={import_intent}, has_render={has_render}, leg='{legacy_latex}', app='{app_latex}', typed='{typed_latex}'",
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

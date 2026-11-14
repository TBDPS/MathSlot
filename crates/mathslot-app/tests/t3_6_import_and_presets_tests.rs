use mathslot_app::{App, AppEvent, Effect, StatusSeverity};
use mathslot_store::Catalog;

#[test]
fn d123_import_latex_error_blocks_replace_all_and_preserves_document() {
    let mut app = App::new();
    app.dispatch(AppEvent::ImportLatex(r"\frac{a}{b}".to_owned()));
    assert_eq!(app.to_latex(), r"\frac{a}{b}");

    // Unclosed brace produces a Syntax Error diagnostic -> must block ReplaceAll
    let resp = app.dispatch_snapshot(AppEvent::ImportLatex(r"{1 + 2".to_owned()));

    assert_eq!(
        app.to_latex(),
        r"\frac{a}{b}",
        "Error-level import diagnostic must block Edit::ReplaceAll and preserve prior formula"
    );
    assert!(
        resp.effects
            .iter()
            .any(|e| matches!(e, Effect::Status(msg) if msg.severity == StatusSeverity::Error)),
        "Blocked import must emit StatusSeverity::Error effect: {:?}",
        resp.effects
    );

    let report = resp
        .snapshot
        .last_import
        .as_ref()
        .expect("EngineSnapshot.last_import must be populated after ImportLatex");
    assert!(report.blocked, "ImportReportSnapshot.blocked must be true");
    assert!(
        !report.lossless,
        "Blocked import must not be marked lossless"
    );
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.severity == StatusSeverity::Error),
        "Blocked import report must carry Error-level diagnostic: {:?}",
        report.diagnostics
    );
}

#[test]
fn d123_import_latex_valid_and_lossy_without_error_succeeds_with_report() {
    let mut app = App::new();

    // 1. Lossless import
    let ok_resp = app.dispatch_snapshot(AppEvent::ImportLatex(r"\frac{1}{2}".to_owned()));
    assert_eq!(ok_resp.snapshot.latex, r"\frac{1}{2}");
    let ok_report = ok_resp
        .snapshot
        .last_import
        .as_ref()
        .expect("lossless ImportLatex must populate last_import");
    assert!(!ok_report.blocked);
    assert!(ok_report.lossless);
    assert_eq!(ok_report.raw_nodes, 0);
    assert_eq!(ok_report.empty_slots, 0);
    assert!(ok_report.normalized_match);
    assert_eq!(ok_report.roundtrip_latex, r"\frac{1}{2}");

    // 2. Lossy import with UnknownMacro warning (no Error) -> allowed with raw_nodes exposed
    let lossy_resp =
        app.dispatch_snapshot(AppEvent::ImportLatex(r"\customMacro{A} + x".to_owned()));
    let lossy_report = lossy_resp
        .snapshot
        .last_import
        .as_ref()
        .expect("lossy ImportLatex must populate last_import");
    assert!(
        !lossy_report.blocked,
        "Warning-only import must not be blocked"
    );
    assert!(!lossy_report.lossless);
    assert!(
        lossy_report.raw_nodes >= 1,
        "Expected raw_nodes >= 1 for unknown macro, got {}",
        lossy_report.raw_nodes
    );
    assert!(
        lossy_report
            .diagnostics
            .iter()
            .any(|d| d.severity == StatusSeverity::Warning),
        "Expected Warning diagnostic for unknown macro: {:?}",
        lossy_report.diagnostics
    );

    // 3. ImportAcknowledge clears last_import
    let ack_resp = app.dispatch_snapshot(AppEvent::ImportAcknowledge);
    assert!(
        ack_resp.snapshot.last_import.is_none(),
        "ImportAcknowledge must clear EngineSnapshot.last_import"
    );
}

#[test]
fn d126_all_88_presets_expand_via_load_stream_source_with_zero_errors() {
    let catalog = Catalog::builtin();
    let presets = catalog.presets();
    assert_eq!(presets.len(), 88, "Catalog must contain 88 presets");

    let mut failures = Vec::new();
    for preset in presets {
        let mut app = App::new();
        let resp = app.dispatch_snapshot(AppEvent::LoadStreamSource(preset.source.clone()));

        let stream_errors: Vec<String> = resp
            .effects
            .iter()
            .filter_map(|e| match e {
                Effect::Status(msg)
                    if msg.severity == StatusSeverity::Error
                        && msg.message.contains("Unknown or incomplete stream command") =>
                {
                    Some(msg.message.clone())
                }
                _ => None,
            })
            .collect();

        if !stream_errors.is_empty()
            || resp.snapshot.latex.contains('▸')
            || resp.snapshot.latex.contains(r"\text{▸")
        {
            failures.push(format!(
                "{} ({}): source='{}', latex='{}', stream_errors={:?}",
                preset.legacy_id, preset.id, preset.source, resp.snapshot.latex, stream_errors
            ));
        }

        match preset.legacy_id.as_str() {
            "preset-003" => {
                assert!(
                    resp.snapshot.latex.contains(r"\left."),
                    "preset-003 must expand eval_bar (▸aq): {}",
                    resp.snapshot.latex
                );
            }
            "preset-044" => {
                assert!(
                    resp.snapshot.latex.contains(r"\gamma"),
                    "preset-044 must expand gamma (▸gc): {}",
                    resp.snapshot.latex
                );
            }
            "preset-084" => {
                assert!(
                    resp.snapshot.latex.contains(r"\left\langle"),
                    "preset-084 must expand angle (▸an): {}",
                    resp.snapshot.latex
                );
            }
            _ => {}
        }
    }

    assert!(
        failures.is_empty(),
        "All 88 presets must expand cleanly with 0 stream errors, found {} failure(s):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

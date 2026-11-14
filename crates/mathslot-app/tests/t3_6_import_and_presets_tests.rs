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

#[test]
fn t4_1_preview_diff_strip_undo_and_blocking_in_mathslot_app() {
    let mut app = App::new();
    app.dispatch(AppEvent::ImportLatex(r"\frac{a}{b}".to_owned()));
    assert_eq!(app.to_latex(), r"\frac{a}{b}");

    // 1. PreviewImportLatex must not mutate document, undo stack, or emit Render/Focus
    let preview_resp = app.dispatch_snapshot(AppEvent::PreviewImportLatex(
        r"$$\begin{align} x &= 1 \end{align}$$".to_owned(),
    ));
    assert_eq!(preview_resp.snapshot.latex, r"\frac{a}{b}");
    assert!(
        !preview_resp
            .effects
            .iter()
            .any(|e| matches!(e, Effect::Render(_) | Effect::Focus(_))),
        "PreviewImportLatex must not emit Render or Focus: {:?}",
        preview_resp.effects
    );
    let preview_report = preview_resp
        .snapshot
        .last_import
        .as_ref()
        .expect("PreviewImportLatex must populate last_import");
    assert_eq!(
        preview_report.input_latex,
        r"$$\begin{align} x &= 1 \end{align}$$"
    );
    assert!(!preview_report.blocked);
    assert!(!preview_report.lossless);
    assert!(preview_report.raw_nodes >= 1);
    assert!(
        preview_report
            .diagnostics
            .iter()
            .any(|d| d.code == "OUTER_DELIMITERS_STRIPPED" && d.severity == StatusSeverity::Info)
    );
    assert!(
        preview_report
            .diagnostics
            .iter()
            .any(|d| d.code == "UNSUPPORTED_ENVIRONMENT" && d.severity == StatusSeverity::Warning)
    );

    // Cancel (ImportAcknowledge) leaves prior formula intact
    let cancel_resp = app.dispatch_snapshot(AppEvent::ImportAcknowledge);
    assert!(cancel_resp.snapshot.last_import.is_none());
    assert_eq!(cancel_resp.snapshot.latex, r"\frac{a}{b}");

    // 2. Preview + Apply outer-delimited formula -> strips $$...$$ and supports 1-step Undo (D-012)
    let stripped_preview =
        app.dispatch_snapshot(AppEvent::PreviewImportLatex(r"$$\sqrt{x+1}$$".to_owned()));
    let stripped_report = stripped_preview.snapshot.last_import.as_ref().unwrap();
    assert!(stripped_report.lossless);
    assert!(!stripped_report.blocked);
    assert_eq!(stripped_report.roundtrip_latex, r"\sqrt{x+1}");
    assert_eq!(app.to_latex(), r"\frac{a}{b}");

    let apply_resp = app.dispatch_snapshot(AppEvent::ImportLatex(r"$$\sqrt{x+1}$$".to_owned()));
    assert_eq!(apply_resp.snapshot.latex, r"\sqrt{x+1}");
    assert!(apply_resp.snapshot.can_undo);

    let undo_resp = app.dispatch_snapshot(AppEvent::Undo);
    assert_eq!(
        undo_resp.snapshot.latex, r"\frac{a}{b}",
        "D-012: single Undo after ImportLatex must restore prior formula cleanly"
    );

    let redo_resp = app.dispatch_snapshot(AppEvent::Redo);
    assert_eq!(redo_resp.snapshot.latex, r"\sqrt{x+1}");

    // 3. Error cases (D-139 / D-141 / D-142) block import and preserve prior formula
    let deep = format!("{}{}{}", "{".repeat(5000), "z", "}".repeat(5000));
    for bad in [
        r"1 + 2}",
        r"\unknownfoo{bar",
        r"$$ \frac{a}{b}",
        deep.as_str(),
    ] {
        let bad_resp = app.dispatch_snapshot(AppEvent::ImportLatex(bad.to_owned()));
        assert_eq!(bad_resp.snapshot.latex, r"\sqrt{x+1}");
        let bad_report = bad_resp.snapshot.last_import.as_ref().unwrap();
        assert!(bad_report.blocked, "Expected blocked=true for {bad}");
        assert!(
            bad_report
                .diagnostics
                .iter()
                .any(|d| d.severity == StatusSeverity::Error),
            "Expected Error diagnostic for {bad}: {:?}",
            bad_report.diagnostics
        );
    }
}

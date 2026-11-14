use mathslot_app::{App, AppEvent, DiagnosticSnapshot, Effect, NavAction};
use mathslot_doc::{Document, EditorDiagnostic};
use mathslot_syntax::{SlotId, parse, to_latex, to_preview_latex_mathjax};

#[test]
fn d114_preview_latex_mathjax_highlights_empty_and_active_slots_without_altering_canonical_latex() {
    let (nodes, diags) = parse(r"\frac{}{}");
    assert!(diags.is_empty());

    // Canonical to_latex() must remain completely unchanged
    assert_eq!(to_latex(&nodes), r"\frac{}{}");

    // Empty placeholders render visible \bbox + \square
    let preview_no_active = to_preview_latex_mathjax(&nodes, None);
    assert!(
        preview_no_active.contains(r"\bbox") && preview_no_active.contains(r"\square"),
        "Expected visible \\bbox and \\square for empty placeholders, got: {preview_no_active}"
    );

    // Active slot receives distinct highlight \bbox
    let (doc, _) = Document::from_latex(r"\frac{}{}");
    let first_slot = doc.slots.slots().first().expect("frac has slots").id;
    let preview_active = doc.to_preview_latex_mathjax(Some(first_slot));
    assert!(
        preview_active.contains(r"\bbox") && preview_active.contains(r"\square"),
        "Expected highlighted \\bbox and \\square for active slot, got: {preview_active}"
    );
    assert_ne!(
        preview_no_active, preview_active,
        "Active slot highlight must differ from inactive placeholder rendering"
    );

    // Ensure syntax-level active_slot highlights Placeholder with matching SlotId
    let syntax_nodes_with_slot = vec![mathslot_syntax::Spanned::new(
        mathslot_syntax::Expr::Placeholder {
            slot_id: SlotId(7),
            label: None,
        },
        mathslot_syntax::Span::new(0, 0),
    )];
    let active_only = to_preview_latex_mathjax(&syntax_nodes_with_slot, Some(SlotId(7)));
    let inactive_only = to_preview_latex_mathjax(&syntax_nodes_with_slot, None);
    assert_ne!(active_only, inactive_only);
    assert!(active_only.contains(r"\bbox") && active_only.contains(r"\square"));
}

#[test]
fn d114_d115_app_snapshot_and_render_request_expose_preview_latex_generation_and_bounded_diagnostics()
 {
    let mut app = App::new();

    // Typing '▸f' triggers pending command + render request + clean status message
    app.handle_event(AppEvent::KeyInput('▸'));
    let resp = app.dispatch_snapshot(AppEvent::KeyInput('f'));

    // D-114: snapshot.preview_latex and RenderRequest.preview_latex populated
    assert!(
        resp.snapshot.preview_latex.contains(r"\bbox"),
        "Expected preview_latex with \\bbox for pending/empty state, got: {}",
        resp.snapshot.preview_latex
    );

    let render_req = resp
        .effects
        .iter()
        .find_map(|e| match e {
            Effect::Render(req) => Some(req),
            _ => None,
        })
        .expect("KeyInput must emit Effect::Render");

    assert!(
        render_req.generation >= 2,
        "RenderRequest.generation must advance monotonically, got {}",
        render_req.generation
    );
    assert_eq!(render_req.preview_latex, resp.snapshot.preview_latex);

    // D-115: StatusMessage must NOT contain raw Rust Debug formatting
    let status_msgs: Vec<&str> = resp
        .effects
        .iter()
        .filter_map(|e| match e {
            Effect::Status(msg) => Some(msg.message.as_str()),
            _ => None,
        })
        .collect();
    assert!(
        !status_msgs.is_empty(),
        "Expected Status effect for pending diagnostic"
    );
    for msg in status_msgs {
        assert!(
            !msg.contains("PendingCommand {") && !msg.contains("UnknownCommand {"),
            "StatusMessage.message must use clean ErrorSummary, not raw Debug output: {msg}"
        );
        assert!(
            msg.chars().count() <= 120,
            "StatusMessage.message exceeded 120 chars: {msg}"
        );
        assert!(!msg.contains('\n') && !msg.contains('\r'));
    }

    // Complete fraction and navigate to ensure active slot changes preview_latex
    for ch in "1;;".chars() {
        app.handle_event(AppEvent::KeyInput(ch));
    }
    let after_nav = app.dispatch_snapshot(AppEvent::Navigate(NavAction::NextSlot));
    assert!(
        after_nav.snapshot.preview_latex.contains(r"\bbox"),
        "Active/empty slot in fraction must include \\bbox in preview_latex: {}",
        after_nav.snapshot.preview_latex
    );
}

#[test]
fn d115_diagnostic_snapshot_enforces_error_summary_120_200_limits() {
    let long_source: String = (0..350)
        .map(|i| char::from(b'a' + (i % 26) as u8))
        .collect();
    let long_msg = "Syntax error near \\frac\nsecond line trace\r\nextra noisy details that must be compacted cleanly into a 120 character header summary";

    let diag = EditorDiagnostic::Syntax(long_msg.to_owned());
    let snap = DiagnosticSnapshot::from_diagnostic_with_source(&diag, &long_source);

    assert!(
        snap.summary.chars().count() <= 120,
        "DiagnosticSnapshot.summary length {} > 120: {}",
        snap.summary.chars().count(),
        snap.summary
    );
    assert!(
        !snap.summary.contains('\n') && !snap.summary.contains('\r'),
        "DiagnosticSnapshot.summary must be single-line: {:?}",
        snap.summary
    );
    assert!(snap.truncated, "350-char source must set truncated = true");
    assert!(
        snap.source_excerpt.chars().count() <= 200,
        "source_excerpt length {} > 200",
        snap.source_excerpt.chars().count()
    );
    assert!(
        snap.source_excerpt.ends_with("…（已截断）"),
        "source_excerpt must end with truncation marker: {}",
        snap.source_excerpt
    );
    assert!(
        snap.detail.contains(&long_source),
        "detail must preserve complete unclipped source"
    );
    assert!(
        snap.hint.as_ref().is_some_and(|h| !h.is_empty()),
        "DiagnosticSnapshot should provide actionable hint"
    );
}

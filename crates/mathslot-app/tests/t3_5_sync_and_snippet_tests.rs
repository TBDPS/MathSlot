use mathslot_app::{App, AppEvent, Effect, HostAction, Key, RecoveryStateSnapshot};

#[test]
fn test_snapshot_source_tracks_typing_pending_commands_and_multiline() {
    let mut app = App::new();
    assert_eq!(app.snapshot().source, "");
    assert_eq!(app.snapshot().cursor_char, 0);

    // Typing pending command prefix keeps exact prefix in snapshot.source
    app.dispatch(AppEvent::KeyInput('▸'));
    assert_eq!(app.snapshot().source, "▸");
    assert_eq!(app.snapshot().cursor_char, 1);

    app.dispatch(AppEvent::KeyInput('f'));
    assert_eq!(app.snapshot().source, "▸f");
    assert_eq!(app.snapshot().cursor_char, 2);

    app.dispatch(AppEvent::KeyInput('1'));
    app.dispatch(AppEvent::KeyInput(';'));
    app.dispatch(AppEvent::KeyInput('2'));
    app.dispatch(AppEvent::KeyInput(';'));

    let resolved = app.snapshot();
    assert_eq!(resolved.latex, r"\frac{1}{2}");
    assert_eq!(resolved.source, r"\frac{1}{2}");

    // Clear and test 3-line Enter input (D-009 / S-007)
    app.dispatch(AppEvent::Clear);
    assert_eq!(app.snapshot().source, "");
    assert_eq!(app.snapshot().cursor_char, 0);

    app.dispatch(AppEvent::KeyInput('a'));
    app.dispatch(AppEvent::KeyDown(Key::Enter));
    app.dispatch(AppEvent::KeyInput('b'));
    app.dispatch(AppEvent::KeyDown(Key::Enter));
    app.dispatch(AppEvent::KeyInput('c'));

    let multi = app.snapshot();
    assert_eq!(multi.source, "a\nb\nc");
    assert_eq!(multi.source.lines().count(), 3);

    // Undo should step back cleanly
    app.dispatch(AppEvent::Undo);
    let after_undo = app.snapshot();
    assert_ne!(after_undo.source, "a\nb\nc");
    assert!(after_undo.can_redo);

    app.dispatch(AppEvent::Redo);
    assert_eq!(app.snapshot().source, "a\nb\nc");
}

#[test]
fn test_external_mutations_update_snapshot_source_and_save_snippet_action() {
    let mut app = App::new();
    app.dispatch(AppEvent::ApplyCard("frac".into()));
    let after_card = app.snapshot();
    assert_eq!(after_card.source, r"\frac{}{}");
    assert_eq!(after_card.latex, r"\frac{}{}");

    app.dispatch(AppEvent::LoadStreamSource("▸f3;4;".into()));
    let after_preset = app.snapshot();
    assert_eq!(after_preset.latex, r"\frac{3}{4}");
    assert_eq!(after_preset.source, r"\frac{3}{4}");

    let effects = app.dispatch(AppEvent::RequestSaveSnippet);
    assert!(effects.iter().any(|e| matches!(
        e,
        Effect::Host(HostAction::SaveSnippet { source, latex })
            if source == r"\frac{3}{4}" && latex == r"\frac{3}{4}"
    )));

    app.dispatch(AppEvent::SetRecoveryState(Some(RecoveryStateSnapshot {
        corrupt_path: "corrupt.json".into(),
        backup_candidate: Some("backup.json".into()),
        error: "corrupt".into(),
    })));
    assert!(app.snapshot().recovery.is_some());

    app.dispatch(AppEvent::SetRecoveryState(None));
    assert!(app.snapshot().recovery.is_none());
}

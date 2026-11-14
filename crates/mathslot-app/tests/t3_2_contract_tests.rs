use mathslot_app::{App, AppEvent, EditorState, Effect, FocusTarget, NavAction, StatusSeverity};

#[test]
fn d111_slot_snapshot_exposes_path_and_depth_and_select_slot() {
    // Nested fraction + sqrt gives depth >= 3, and 3x3 bmatrix gives 9 slots with depth == 3
    let mut app = App::from_latex(
        r"\frac{\sqrt{x}}{y} + \begin{bmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \\ 7 & 8 & 9 \end{bmatrix}",
    );

    let initial_snap = app.snapshot();
    assert!(
        initial_snap.slots.len() >= 11,
        "expected >= 11 slots (nested frac/sqrt + 3x3 matrix), got {}",
        initial_snap.slots.len()
    );

    for slot in &initial_snap.slots {
        assert_eq!(
            slot.depth,
            slot.path.len(),
            "slot #{} depth must match path.len()",
            slot.id
        );
        assert!(
            !slot.path.is_empty(),
            "slot #{} path must not be empty",
            slot.id
        );
    }

    assert!(
        initial_snap.slots.iter().any(|s| s.depth >= 3),
        "expected at least one nested/matrix slot with depth >= 3, got {:?}",
        initial_snap.slots
    );

    let target_slot = initial_snap.slots.last().expect("must have target slot").id;
    let latex_before = app.to_latex();
    let undo_len_before = app.history().undo_len();

    let resp = app.dispatch_snapshot(AppEvent::SelectSlot(target_slot));
    assert_eq!(resp.snapshot.active_slot_id, Some(target_slot));
    assert!(
        resp.snapshot
            .slots
            .iter()
            .any(|s| s.id == target_slot && s.is_active),
        "selected slot must be marked is_active=true"
    );
    assert!(
        resp.effects
            .iter()
            .any(|e| matches!(e, Effect::Focus(FocusTarget::Slot(id)) if id.0 == target_slot)),
        "SelectSlot must emit Effect::Focus(FocusTarget::Slot({target_slot})), got {:?}",
        resp.effects
    );
    assert!(
        resp.effects.iter().any(|e| matches!(e, Effect::Status(_))),
        "SelectSlot must emit Effect::Status"
    );
    assert_eq!(
        app.to_latex(),
        latex_before,
        "SelectSlot must not mutate document LaTeX (A-EDIT-008)"
    );
    assert_eq!(
        app.history().undo_len(),
        undo_len_before,
        "SelectSlot must not push onto undo stack (A-EDIT-008)"
    );

    // Selecting a missing slot emits a Status warning/error without panicking
    let missing_resp = app.dispatch_snapshot(AppEvent::SelectSlot(999_999));
    assert!(
        missing_resp.effects.iter().any(|e| matches!(
            e,
            Effect::Status(msg) if matches!(msg.severity, StatusSeverity::Warning | StatusSeverity::Error)
        )),
        "SelectSlot with invalid id must emit warning/error status, got {:?}",
        missing_resp.effects
    );
}

#[test]
fn d111_nav_mode_state_exposes_non_empty_breadcrumb_path() {
    let mut app = App::from_latex(r"\frac{a}{b}");
    let enter_resp = app.dispatch_snapshot(AppEvent::EnterNavMode);

    let first_path = match &enter_resp.snapshot.state {
        EditorState::Nav { path } => {
            assert!(
                !path.is_empty(),
                "EditorState::Nav path must not be empty when entering nav mode"
            );
            path.clone()
        }
        other => panic!("expected EditorState::Nav, got {other:?}"),
    };

    let next_resp = app.dispatch_snapshot(AppEvent::Navigate(NavAction::NextSlot));
    match &next_resp.snapshot.state {
        EditorState::Nav { path } => {
            assert!(
                !path.is_empty(),
                "EditorState::Nav path must stay non-empty"
            );
            assert_ne!(
                path, &first_path,
                "EditorState::Nav path must update when moving to next slot"
            );
        }
        other => panic!("expected EditorState::Nav, got {other:?}"),
    }
}

#[test]
fn d112_load_stream_source_parses_presets_atomically_with_undo_and_diagnostics() {
    let mut app = App::new();
    app.dispatch(AppEvent::KeyInput('a'));
    assert_eq!(app.to_latex(), "a");

    // Euler identity preset from catalog/presets.json: "▸ue;i▸gp;; + 1 = 0"
    let load_resp =
        app.dispatch_snapshot(AppEvent::LoadStreamSource("▸ue;i▸gp;; + 1 = 0".to_string()));
    assert!(
        load_resp
            .effects
            .iter()
            .any(|e| matches!(e, Effect::Render(_))),
        "LoadStreamSource must emit Effect::Render"
    );
    assert!(
        load_resp
            .effects
            .iter()
            .any(|e| matches!(e, Effect::Status(_))),
        "LoadStreamSource must emit Effect::Status"
    );
    assert!(
        load_resp.snapshot.latex.contains(r"\pi"),
        "Euler identity must expand ▸gp to \\pi, got: {}",
        load_resp.snapshot.latex
    );
    assert!(
        !load_resp.snapshot.latex.contains('▸'),
        "Expanded preset must not leave raw '▸' token, got: {}",
        load_resp.snapshot.latex
    );
    assert!(
        load_resp.snapshot.can_undo,
        "LoadStreamSource must be undoable"
    );

    // Undo restores previous document atomically
    let undo_resp = app.dispatch_snapshot(AppEvent::Undo);
    assert_eq!(undo_resp.snapshot.latex, "a");

    // 3x3 matrix preset from catalog/presets.json: "▸mg1;0;0;0;1;0;0;0;1;"
    let matrix_resp = app.dispatch_snapshot(AppEvent::LoadStreamSource(
        "▸mg1;0;0;0;1;0;0;0;1;".to_string(),
    ));
    assert_eq!(
        matrix_resp.snapshot.slots.len(),
        9,
        "3x3 matrix preset must expose 9 slots"
    );
    assert!(
        matrix_resp.snapshot.slots.iter().all(|s| s.depth == 3),
        "3x3 matrix slots must have depth 3, got {:?}",
        matrix_resp.snapshot.slots
    );

    // Unknown command must NOT be silently swallowed
    let bad_resp = app.dispatch_snapshot(AppEvent::LoadStreamSource("▸zz".to_string()));
    assert!(
        bad_resp.effects.iter().any(|e| matches!(
            e,
            Effect::Status(msg) if msg.severity == StatusSeverity::Error
        )),
        "LoadStreamSource with unknown command must emit Error status, got {:?}",
        bad_resp.effects
    );
}

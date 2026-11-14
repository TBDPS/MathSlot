use mathslot_app::{
    App, AppEvent, DispatchResponse, EditorState, EngineSnapshot, NavAction, StatusSeverity,
};

#[test]
fn app_snapshot_serializes_slots_diagnostics_and_state() {
    let mut app = App::new();

    // 1. Trigger a pending command ("▸m") and inspect snapshot
    let pending_resp: DispatchResponse = app.dispatch_snapshot(AppEvent::KeyInput('▸'));
    assert_eq!(pending_resp.snapshot.state, EditorState::PrefixRoot);
    assert!(pending_resp.snapshot.has_pending_command);

    let pending_resp = app.dispatch_snapshot(AppEvent::KeyInput('m'));
    assert_eq!(
        pending_resp.snapshot.state,
        EditorState::PrefixSub { key: 'm' }
    );
    assert!(pending_resp.snapshot.has_pending_command);
    assert!(
        pending_resp
            .snapshot
            .diagnostics
            .iter()
            .any(|d| d.severity == StatusSeverity::Info && d.code == "PENDING_COMMAND"),
        "Expected PENDING_COMMAND diagnostic in snapshot: {:?}",
        pending_resp.snapshot.diagnostics
    );

    // Clear and build a fraction via palette card
    let cleared = app.dispatch_snapshot(AppEvent::Clear);
    assert!(cleared.snapshot.slots.is_empty());

    let card_resp = app.dispatch_snapshot(AppEvent::PaletteCard("frac".to_string()));
    assert_eq!(card_resp.snapshot.slots.len(), 2);

    let nav_resp = app.dispatch_snapshot(AppEvent::Navigate(NavAction::NextSlot));
    let snap: EngineSnapshot = nav_resp.snapshot;

    assert_eq!(snap.state, EditorState::Idle);
    assert!(!snap.has_pending_command);
    assert!(!snap.is_composing);
    assert!(!snap.is_nav_mode);
    assert!(snap.can_undo);
    assert!(!snap.can_redo);
    assert_eq!(snap.slots.len(), 2, "frac must expose 2 slots in snapshot");
    assert!(snap.slots.iter().all(|s| s.is_empty));
    assert!(
        snap.active_slot_id.is_some(),
        "frac palette insertion should activate first slot"
    );
    assert!(
        snap.slots
            .iter()
            .any(|s| s.is_active && Some(s.id) == snap.active_slot_id),
        "active_slot_id must match one slot with is_active=true"
    );

    // Serialization round-trip via serde_json
    let json = serde_json::to_string(&snap).expect("EngineSnapshot must serialize to JSON");
    let roundtrip: EngineSnapshot =
        serde_json::from_str(&json).expect("EngineSnapshot must deserialize from JSON");
    assert_eq!(roundtrip, snap);

    // Direct app.snapshot() matches last dispatch_snapshot
    assert_eq!(app.snapshot(), snap);
}

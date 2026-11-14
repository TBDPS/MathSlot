use mathslot_app::effect::{Effect, HostAction};
use mathslot_app::snapshot::{
    AppSettings, DelimiterStyle, RecoveryStateSnapshot, RenderBackendPreference, ShortcutSettings,
    ThemePreference,
};
use mathslot_app::{App, AppError, AppEvent, StatusSeverity};

#[test]
fn d116_app_update_settings_recovery_state_and_reset_confirmed() {
    let mut app = App::new();
    let initial = app.snapshot();
    assert_eq!(initial.settings.theme, ThemePreference::System);
    assert_eq!(initial.settings.delimiter_style, DelimiterStyle::None);
    assert_eq!(
        initial.settings.render_backend,
        RenderBackendPreference::MathJax
    );
    assert!(initial.recovery.is_none());

    let custom = AppSettings {
        theme: ThemePreference::Dark,
        delimiter_style: DelimiterStyle::InlineDollar,
        render_backend: RenderBackendPreference::LatexRust,
        shortcuts: ShortcutSettings {
            copy_latex: "Mod+Alt+C".to_owned(),
            focus_editor: "Alt+I".to_owned(),
            ..ShortcutSettings::default()
        },
        config_path: Some("/tmp/mathslot/library.json".to_owned()),
        preview_scale_pct: Some(125),
    };

    let update_resp = app.dispatch_snapshot(AppEvent::UpdateSettings(custom.clone()));
    assert_eq!(update_resp.snapshot.settings, custom);
    assert!(
        update_resp.effects.iter().any(
            |e| matches!(e, Effect::Host(HostAction::PersistSettings(s)) if s.as_ref() == &custom)
        ),
        "UpdateSettings must emit Effect::Host(PersistSettings): {:?}",
        update_resp.effects
    );

    let rec = RecoveryStateSnapshot {
        corrupt_path: "/tmp/mathslot/library.corrupt-1.json".to_owned(),
        backup_candidate: Some("/tmp/mathslot/library.bak-1.json".to_owned()),
        error: "unexpected trailing token".to_owned(),
    };
    let rec_resp = app.dispatch_snapshot(AppEvent::SetRecoveryState(Some(rec.clone())));
    assert_eq!(rec_resp.snapshot.recovery.as_ref(), Some(&rec));
    assert!(
        rec_resp
            .effects
            .iter()
            .any(|e| matches!(e, Effect::Status(s) if s.severity == StatusSeverity::Warning)),
        "SetRecoveryState(Some) should emit warning status"
    );

    let restore_resp = app.dispatch_snapshot(AppEvent::RequestRestoreBackup);
    assert!(
        restore_resp.effects.iter().any(|e| matches!(
            e,
            Effect::Host(HostAction::RestoreBackup { backup_path: Some(p) })
            if p == "/tmp/mathslot/library.bak-1.json"
        )),
        "RequestRestoreBackup must emit HostAction::RestoreBackup with candidate path"
    );

    // ConfirmResetEmptyConfig clears recovery state and emits ResetEmptyConfig host action
    let confirm_empty_resp = app.dispatch_snapshot(AppEvent::ConfirmResetEmptyConfig);
    assert!(confirm_empty_resp.snapshot.recovery.is_none());
    assert!(
        confirm_empty_resp
            .effects
            .iter()
            .any(|e| matches!(e, Effect::Host(HostAction::ResetEmptyConfig)))
    );

    // Re-apply custom settings, then confirm ResetSettingsConfirmed
    app.dispatch(AppEvent::UpdateSettings(custom));
    let reset_resp = app.dispatch_snapshot(AppEvent::ResetSettingsConfirmed);
    assert_eq!(reset_resp.snapshot.settings.theme, ThemePreference::System);
    assert_eq!(
        reset_resp.snapshot.settings.delimiter_style,
        DelimiterStyle::None
    );
    assert_eq!(
        reset_resp.snapshot.settings.render_backend,
        RenderBackendPreference::MathJax
    );
    assert_eq!(
        reset_resp.snapshot.settings.shortcuts,
        ShortcutSettings::default()
    );
    assert_eq!(
        reset_resp.snapshot.settings.config_path.as_deref(),
        Some("/tmp/mathslot/library.json"),
        "ResetSettingsConfirmed must preserve config_path"
    );
}

#[test]
fn d116_export_and_copy_apply_configured_delimiters_and_preserve_error_blocking() {
    let mut app = App::new();

    // Empty doc with InlineDollar must still yield empty string
    app.dispatch(AppEvent::UpdateSettings(AppSettings {
        delimiter_style: DelimiterStyle::InlineDollar,
        ..AppSettings::default()
    }));
    let empty_copy = app.dispatch_snapshot(AppEvent::RequestCopy);
    let copied_empty = empty_copy
        .effects
        .iter()
        .find_map(|e| match e {
            Effect::Clipboard(s) => Some(s.as_str()),
            _ => None,
        })
        .expect("RequestCopy emits Clipboard");
    assert_eq!(copied_empty, "", "Empty formula must not wrap in $$");

    // Type \frac{1}{2}
    for ch in "▸f1;2;".chars() {
        app.dispatch(AppEvent::KeyInput(ch));
    }

    let expected_cases = [
        (DelimiterStyle::None, r"\frac{1}{2}"),
        (DelimiterStyle::InlineDollar, r"$\frac{1}{2}$"),
        (DelimiterStyle::BlockDollar, "$$\n\\frac{1}{2}\n$$"),
        (DelimiterStyle::CodeFence, "```latex\n\\frac{1}{2}\n```"),
    ];

    for (style, expected) in expected_cases {
        app.dispatch(AppEvent::UpdateSettings(AppSettings {
            delimiter_style: style,
            ..AppSettings::default()
        }));

        let copy_resp = app.dispatch_snapshot(AppEvent::RequestCopy);
        assert_eq!(copy_resp.snapshot.copy_text, expected);
        let copied = copy_resp
            .effects
            .iter()
            .find_map(|e| match e {
                Effect::Clipboard(s) => Some(s.as_str()),
                _ => None,
            })
            .expect("RequestCopy must emit Clipboard");
        assert_eq!(copied, expected);

        let strict_resp = app.dispatch_snapshot(AppEvent::RequestExport { strict: true });
        let exported = strict_resp
            .effects
            .iter()
            .find_map(|e| match e {
                Effect::ExportResult(Ok((s, _))) => Some(s.as_str()),
                _ => None,
            })
            .expect("Valid doc strict export must succeed");
        assert_eq!(exported, expected);
    }

    // Error diagnostic MUST still block strict export even with delimiter configured
    app.dispatch(AppEvent::Clear);
    for ch in "▸zz".chars() {
        app.dispatch(AppEvent::KeyInput(ch));
    }
    let blocked = app.dispatch_snapshot(AppEvent::RequestExport { strict: true });
    assert!(
        blocked.effects.iter().any(|e| matches!(
            e,
            Effect::ExportResult(Err(AppError::StrictExportBlocked(_)))
        )),
        "Strict export must still be blocked when error diagnostics exist: {:?}",
        blocked.effects
    );
}

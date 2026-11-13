use mathslot_app::{App, AppEvent, EditorAction, EditorState, Effect, Intent, Key, NavAction};

#[test]
fn test_a_edit_001_stream_frac() {
    let mut app = App::new();
    let mut last_effects = Vec::new();
    for ch in "▸f1;2;".chars() {
        last_effects = app.handle_event(AppEvent::KeyInput(ch));
    }

    // 1. 生成分式
    let latex = app.to_latex();
    assert_eq!(
        latex, r"\frac{1}{2}",
        "Streaming '▸f1;2;' must produce '\\frac{{1}}{{2}}', got: {latex}"
    );

    // 2. 状态机返回 Idle 且无错误诊断
    assert_eq!(*app.state(), EditorState::Idle);
    assert!(
        app.diagnostics().iter().all(|d| !d.is_error()),
        "Completed stream fraction must not have error diagnostics, got: {:?}",
        app.diagnostics()
    );

    // 3. 返回包含 \frac{1}{2} 的 Effect::Render
    let render_effect = last_effects
        .iter()
        .find_map(|e| match e {
            Effect::Render(req) => Some(req),
            _ => None,
        })
        .expect("Completed command must emit Effect::Render");

    assert_eq!(render_effect.latex, r"\frac{1}{2}");
    assert!(!render_effect.has_diagnostics);
}

#[test]
fn test_a_edit_002_pending_copy_export() {
    let mut app = App::new();
    for ch in "▸m".chars() {
        app.handle_event(AppEvent::KeyInput(ch));
    }

    // 1. 处于未决状态且有 Pending 诊断
    assert!(
        app.has_pending_command(),
        "App must report pending command after '▸m'"
    );
    assert!(
        app.diagnostics().iter().any(|d| d.is_pending()),
        "Expected pending diagnostic in {:?}",
        app.diagnostics()
    );

    // 2. 请求复制 -> 输出占位符，绝不返回空串
    let copy_effects = app.handle_event(AppEvent::RequestCopy);
    let copied_text = copy_effects
        .iter()
        .find_map(|e| match e {
            Effect::Clipboard(text) => Some(text),
            _ => None,
        })
        .expect("RequestCopy must emit Effect::Clipboard");

    assert!(
        !copied_text.trim().is_empty(),
        "Copying pending command must not be empty"
    );
    assert!(
        copied_text.contains("▸m") || copied_text.contains(r"\text{▸m}"),
        "Copied text must contain explicit placeholder, got: {copied_text}"
    );

    // 3. 严格模式导出 -> 必须阻断，返回错误诊断
    let strict_export_effects = app.handle_event(AppEvent::RequestExport { strict: true });
    let export_result = strict_export_effects
        .iter()
        .find_map(|e| match e {
            Effect::ExportResult(res) => Some(res),
            _ => None,
        })
        .expect("RequestExport must emit Effect::ExportResult");

    assert!(
        export_result.is_err(),
        "Strict export with pending command must fail, got: {export_result:?}"
    );

    // 4. 非严格模式导出 -> 成功导出显式占位符并带诊断
    let relaxed_export_effects = app.handle_event(AppEvent::RequestExport { strict: false });
    let (relaxed_latex, diags) = relaxed_export_effects
        .iter()
        .find_map(|e| match e {
            Effect::ExportResult(Ok((latex, diags))) => Some((latex, diags)),
            _ => None,
        })
        .expect("Relaxed export must succeed with placeholder");

    assert!(
        relaxed_latex.contains("▸m") || relaxed_latex.contains(r"\text{▸m}"),
        "Exported latex must contain explicit placeholder, got: {relaxed_latex}"
    );
    assert!(
        diags.iter().any(|d| d.is_pending()),
        "Export diagnostics must contain Pending"
    );
}

#[test]
fn test_a_edit_003_unknown_command_diagnostic() {
    let mut app = App::new();
    let mut last_effects = Vec::new();
    for ch in "▸zz".chars() {
        last_effects = app.handle_event(AppEvent::KeyInput(ch));
    }

    // 1. 不得静默退化为末尾普通字符 'z'
    let latex = app.to_latex();
    assert_ne!(
        latex.trim(),
        "z",
        "Unknown command '▸zz' must never silently degenerate to 'z'"
    );
    assert!(
        latex.contains("▸zz") || latex.contains(r"\text{▸zz}"),
        "Unknown command must preserve placeholder in latex, got: {latex}"
    );

    // 2. 记录 Unknown 诊断
    assert!(
        app.diagnostics().iter().any(|d| d.is_error()),
        "Expected error/unknown command diagnostic for '▸zz', got: {:?}",
        app.diagnostics()
    );

    // 3. 副作用中应报告状态错误或带诊断的 Render
    let has_error_status = last_effects.iter().any(|e| matches!(e, Effect::Status(msg) if matches!(msg.severity, mathslot_app::StatusSeverity::Error | mathslot_app::StatusSeverity::Warning)));
    let has_diag_render = last_effects
        .iter()
        .any(|e| matches!(e, Effect::Render(req) if req.has_diagnostics));
    assert!(
        has_error_status || has_diag_render,
        "Unknown command must emit Status warning/error or Render with diagnostics"
    );
}

#[test]
fn test_a_edit_004_partial_card() {
    let mut app = App::new();
    let effects = app.handle_event(AppEvent::PaletteCard("partial".to_string()));

    // 1. 插入 \partial，绝不插入 \to (防范 D-001)
    let latex = app.to_latex();
    assert!(
        latex.contains(r"\partial"),
        "PaletteCard('partial') must insert '\\partial', got: {latex}"
    );
    assert!(
        !latex.contains(r"\to"),
        "PaletteCard('partial') must NEVER insert '\\to'"
    );

    // 2. 发射 Effect::Render
    assert!(
        effects.iter().any(|e| matches!(e, Effect::Render(..))),
        "Palette card click must emit Effect::Render"
    );

    // 3. 意图标记为 PaletteCard
    assert_eq!(
        app.history().last_transaction().map(|t| t.intent),
        Some(Intent::PaletteCard)
    );
}

#[test]
fn test_a_edit_005_undo_separate_typing_and_card() {
    let mut app = App::new();

    // 1. 点击“偏导”卡片
    app.handle_event(AppEvent::PaletteCard("partial".to_string()));
    assert_eq!(app.history().undo_len(), 1);
    assert_eq!(
        app.history().last_transaction().map(|t| t.intent),
        Some(Intent::PaletteCard)
    );

    // 2. 紧接普通打字输入
    app.handle_event(AppEvent::KeyInput('x'));
    assert_eq!(
        app.history().undo_len(),
        2,
        "Palette card and subsequent typing must NOT coalesce"
    );
    assert_eq!(
        app.history().last_transaction().map(|t| t.intent),
        Some(Intent::Typing)
    );

    // 3. 第一次 Undo：只撤销打字 'x'，保留卡片 '\partial'
    app.handle_event(AppEvent::Undo);
    let after_first_undo = app.to_latex();
    assert!(
        after_first_undo.contains(r"\partial"),
        "First undo must keep card '\\partial', got: {after_first_undo}"
    );
    assert!(
        !after_first_undo.contains('x'),
        "First undo must remove typed 'x'"
    );

    // 4. 第二次 Undo：撤销卡片 '\partial'，两步不合并
    app.handle_event(AppEvent::Undo);
    let after_second_undo = app.to_latex();
    assert!(
        !after_second_undo.contains(r"\partial"),
        "Second undo must remove '\\partial', got: {after_second_undo}"
    );
}

#[test]
fn test_a_edit_006_paste_with_prefix() {
    let mut app = App::new();

    // 粘贴含 '▸' 的文本
    app.handle_event(AppEvent::Paste("▸f1;2;".to_string()));

    // 原样作为纯文本字面量插入，绝不作为命令触发
    let latex = app.to_latex();
    assert_ne!(
        latex, r"\frac{1}{2}",
        "Pasting '▸f1;2;' must NOT trigger command expansion"
    );
    assert!(
        latex.contains("▸f1;2;") || latex.contains(r"\text{▸f1;2;}"),
        "Pasted text must be preserved literally, got: {latex}"
    );
    assert_eq!(*app.state(), EditorState::Idle);

    // 撤销栈记录 Paste 意图
    assert_eq!(
        app.history().last_transaction().map(|t| t.intent),
        Some(Intent::Paste)
    );
}

#[test]
fn test_a_edit_007_ime_composition_isolation() {
    let mut app = App::new();
    let initial_undo_len = app.history().undo_len();

    // 1. IME 组合期间不污染撤销栈
    app.handle_event(AppEvent::ImeCompositionUpdate("zhong".to_string()));
    assert!(app.is_composing());
    assert_eq!(app.ime_composition(), Some("zhong"));
    assert_eq!(
        app.history().undo_len(),
        initial_undo_len,
        "IME composition must not push to undo stack"
    );

    app.handle_event(AppEvent::ImeCompositionUpdate("zhongwen".to_string()));
    assert_eq!(app.ime_composition(), Some("zhongwen"));
    assert_eq!(
        app.history().undo_len(),
        initial_undo_len,
        "IME composition update must not push to undo stack"
    );

    // 2. 提交后单一事务且可单次撤销
    app.handle_event(AppEvent::ImeCompositionCommit("中文".to_string()));
    assert!(!app.is_composing());
    assert_eq!(app.ime_composition(), None);
    assert_eq!(
        app.history().undo_len(),
        initial_undo_len + 1,
        "Committed IME must push exactly ONE transaction"
    );
    assert_eq!(
        app.history().last_transaction().map(|t| t.intent),
        Some(Intent::ImeCommit)
    );
    assert!(app.to_latex().contains("中文"));

    // 3. 单次 Undo 整体撤销
    app.handle_event(AppEvent::Undo);
    assert!(!app.to_latex().contains("中文"));
    assert_eq!(app.history().undo_len(), initial_undo_len);
}

#[test]
fn test_a_edit_008_navigation_mode_no_text_or_undo_change() {
    let mut app = App::from_latex(r"\frac{a}{b}");

    let initial_cursor = app.cursor().clone();
    let initial_latex = app.to_latex();
    let initial_undo_len = app.history().undo_len();

    // 1. 进入导航模式
    app.handle_event(AppEvent::EnterNavMode);
    assert!(app.is_nav_mode(), "App must be in navigation mode");

    // 2. 导航模式下按字母 'j' -> 光标跳转，文本与撤销栈完全不变
    let effects_j = app.handle_event(AppEvent::KeyInput('j'));
    assert_ne!(
        app.cursor(),
        &initial_cursor,
        "Pressing 'j' in nav mode must move cursor to another slot"
    );
    assert_eq!(
        app.to_latex(),
        initial_latex,
        "Nav mode 'j' must NOT mutate document text"
    );
    assert_eq!(
        app.history().undo_len(),
        initial_undo_len,
        "Nav mode 'j' must NOT push to undo stack"
    );
    assert!(
        effects_j.iter().any(|e| matches!(e, Effect::Focus(..))),
        "Cursor movement must emit Effect::Focus"
    );

    // 3. 按字母 'k' -> 跳回初始槽位，文本与撤销栈不变
    app.handle_event(AppEvent::KeyInput('k'));
    assert_eq!(
        app.cursor(),
        &initial_cursor,
        "Pressing 'k' in nav mode must jump back to original slot"
    );
    assert_eq!(app.to_latex(), initial_latex);
    assert_eq!(app.history().undo_len(), initial_undo_len);

    // 4. 按非导航字母 'z' -> 静默忽略，文本与撤销栈不变
    app.handle_event(AppEvent::KeyInput('z'));
    assert_eq!(app.to_latex(), initial_latex);
    assert_eq!(app.history().undo_len(), initial_undo_len);

    // 5. 退出导航模式
    app.handle_event(AppEvent::ExitNavMode);
    assert!(!app.is_nav_mode(), "App must have exited nav mode");

    // 6. 恢复正常打字 -> 产生文本变动并记录到撤销栈
    app.handle_event(AppEvent::KeyInput('x'));
    assert_ne!(app.to_latex(), initial_latex);
    assert_eq!(app.history().undo_len(), initial_undo_len + 1);
}

#[test]
fn test_effect_ordering_deterministic() {
    let mut app = App::new();

    // 输入未决前缀 '▸m' -> 应按确定顺序发射 Status, Render, Focus
    app.handle_event(AppEvent::KeyInput('▸'));
    let effects = app.handle_event(AppEvent::KeyInput('m'));

    // 检查是否有 Status, Render, Focus
    let mut kind_order = Vec::new();
    for eff in &effects {
        match eff {
            Effect::Status(_) => kind_order.push("Status"),
            Effect::Render(_) => kind_order.push("Render"),
            Effect::Focus(_) => kind_order.push("Focus"),
            Effect::Clipboard(_) => kind_order.push("Clipboard"),
            Effect::ExportResult(_) => kind_order.push("ExportResult"),
        }
    }

    assert_eq!(
        kind_order,
        vec!["Status", "Render", "Focus"],
        "Effects must follow deterministic order: Status -> Render -> Focus"
    );

    // 导出/复制事件时，Host effects 在最后
    let export_effects = app.handle_event(AppEvent::ExportRequested {
        strict: false,
        copy_to_clipboard: true,
    });
    let export_kinds: Vec<&str> = export_effects
        .iter()
        .map(|e| match e {
            Effect::Status(_) => "Status",
            Effect::Render(_) => "Render",
            Effect::Focus(_) => "Focus",
            Effect::Clipboard(_) => "Clipboard",
            Effect::ExportResult(_) => "ExportResult",
        })
        .collect();

    assert_eq!(
        export_kinds,
        vec!["Status", "Clipboard", "ExportResult"],
        "Export requested must follow deterministic order: Status -> Clipboard -> ExportResult"
    );
}

#[test]
fn test_keys_actions_and_redo() {
    let mut app = App::new();

    // 键入并退格
    app.handle_event(AppEvent::KeyInput('a'));
    assert_eq!(app.to_latex(), "a");
    app.handle_event(AppEvent::KeyDown(Key::Backspace));
    assert_eq!(app.to_latex(), "");

    // 键入后撤销再重做
    app.handle_event(AppEvent::KeyInput('b'));
    assert_eq!(app.to_latex(), "b");
    app.handle_event(AppEvent::Undo);
    assert_eq!(app.to_latex(), "");
    app.handle_event(AppEvent::Redo);
    assert_eq!(app.to_latex(), "b");

    // Action 退格与清空
    app.handle_event(AppEvent::Action(EditorAction::Backspace));
    assert_eq!(app.to_latex(), "");

    app.handle_event(AppEvent::KeyInput('c'));
    app.handle_event(AppEvent::Clear);
    assert_eq!(app.to_latex(), "");
    assert_eq!(*app.state(), EditorState::Idle);
    assert!(app.state().is_idle());
    assert!(!app.state().is_nav());
}

#[test]
fn test_import_and_clear_are_single_undoable_transactions_with_selection() {
    // 1. ImportLatex 单步可撤销，不销毁前置 Typing 历史，恢复导入前选区
    let mut app = App::new();
    app.handle_event(AppEvent::KeyInput('x'));
    app.handle_event(AppEvent::KeyInput('y'));
    assert_eq!(app.to_latex(), "xy");
    let selection_before_import = app.selection().clone();

    app.handle_event(AppEvent::ImportLatex(r"\frac{1}{2}".to_string()));
    assert_eq!(app.to_latex(), r"\frac{1}{2}");
    assert_eq!(*app.state(), EditorState::Idle);
    assert_eq!(app.history().undo_depth(), 2);
    assert_eq!(
        app.history().intents(),
        vec![Intent::Typing, Intent::Import]
    );

    // 一次 Undo 完整还原 "xy" 及导入前选区
    app.handle_event(AppEvent::Undo);
    assert_eq!(app.to_latex(), "xy");
    assert_eq!(app.selection(), &selection_before_import);

    // 一次 Redo 还原导入结果
    app.handle_event(AppEvent::Redo);
    assert_eq!(app.to_latex(), r"\frac{1}{2}");

    // 再连续 Undo 两次可回到空文档，证明前置历史未被销毁 (D-105)
    app.handle_event(AppEvent::Undo);
    assert_eq!(app.to_latex(), "xy");
    app.handle_event(AppEvent::Undo);
    assert_eq!(app.to_latex(), "");

    // 2. 在 \frac{a}{b} 特定槽位选区下执行 Clear，单步 Undo 完整恢复公式与选区
    let mut frac_app = App::from_latex(r"\frac{a}{b}");
    frac_app.handle_event(AppEvent::Navigate(NavAction::NextSlot));
    frac_app.handle_event(AppEvent::Navigate(NavAction::StepRight));
    let selection_before_clear = frac_app.selection().clone();
    let cursor_before_clear = frac_app.cursor().clone();
    let depth_before_clear = frac_app.history().undo_depth();

    frac_app.handle_event(AppEvent::Clear);
    assert_eq!(frac_app.to_latex(), "");
    assert_eq!(*frac_app.state(), EditorState::Idle);
    assert_eq!(frac_app.history().undo_depth(), depth_before_clear + 1);
    assert_eq!(
        frac_app.history().last_transaction().map(|t| t.intent),
        Some(Intent::Clear)
    );

    // 空文档再次 Clear 幂等，不增加冗余空事务
    frac_app.handle_event(AppEvent::Clear);
    assert_eq!(frac_app.history().undo_depth(), depth_before_clear + 1);

    // 单次 Undo 完整恢复 \frac{a}{b} 及原选区/光标
    frac_app.handle_event(AppEvent::Undo);
    assert_eq!(frac_app.to_latex(), r"\frac{a}{b}");
    assert_eq!(frac_app.selection(), &selection_before_clear);
    assert_eq!(frac_app.cursor(), &cursor_before_clear);

    // 未决命令状态下 ImportLatex / Clear 重置状态机与诊断
    let mut pending_app = App::new();
    pending_app.handle_event(AppEvent::KeyInput('x'));
    pending_app.handle_event(AppEvent::KeyInput('▸'));
    pending_app.handle_event(AppEvent::KeyInput('m'));
    assert!(pending_app.has_pending_command());
    pending_app.handle_event(AppEvent::ImportLatex("z".to_string()));
    assert!(!pending_app.has_pending_command());
    assert!(pending_app.diagnostics().is_empty());
    assert_eq!(*pending_app.state(), EditorState::Idle);
}

#[test]
fn test_app_delete_forward_nav_and_d104_protection() {
    // 1. KeyDown(Key::Delete) 触发 DeleteForward 并以 Intent::Delete 记账 (D-107)
    let mut app = App::from_latex(r"\frac{abc}{d}");
    app.handle_event(AppEvent::KeyDown(Key::Delete));
    app.handle_event(AppEvent::KeyDown(Key::Delete));
    assert_eq!(app.to_latex(), r"\frac{c}{d}");
    assert_eq!(app.history().intents(), vec![Intent::Delete]);
    app.handle_event(AppEvent::Undo);
    assert_eq!(app.to_latex(), r"\frac{abc}{d}");
    app.handle_event(AppEvent::Redo);
    assert_eq!(app.to_latex(), r"\frac{c}{d}");

    // 2. D-104 端到端防护：同槽输入 'a' -> ArrowLeft -> 'b' -> Undo/Redo 保持 \frac{ba}{}
    let mut d104_app = App::from_latex(r"\frac{}{}");
    d104_app.handle_event(AppEvent::KeyInput('a'));
    d104_app.handle_event(AppEvent::KeyDown(Key::ArrowLeft));
    d104_app.handle_event(AppEvent::KeyInput('b'));
    assert_eq!(d104_app.to_latex(), r"\frac{ba}{}");
    assert_eq!(d104_app.history().undo_depth(), 2);

    d104_app.handle_event(AppEvent::Undo);
    assert_eq!(d104_app.to_latex(), r"\frac{a}{}");
    d104_app.handle_event(AppEvent::Undo);
    assert_eq!(d104_app.to_latex(), r"\frac{}{}");

    // 导航事件不得入栈也不得破坏 Redo 栈
    d104_app.handle_event(AppEvent::EnterNavMode);
    d104_app.handle_event(AppEvent::KeyInput('j'));
    d104_app.handle_event(AppEvent::KeyInput('k'));
    d104_app.handle_event(AppEvent::ExitNavMode);
    assert_eq!(d104_app.history().undo_depth(), 0);
    assert_eq!(d104_app.history().redo_depth(), 2);

    d104_app.handle_event(AppEvent::Redo);
    assert_eq!(d104_app.to_latex(), r"\frac{a}{}");
    d104_app.handle_event(AppEvent::Redo);
    assert_eq!(d104_app.to_latex(), r"\frac{ba}{}");
}

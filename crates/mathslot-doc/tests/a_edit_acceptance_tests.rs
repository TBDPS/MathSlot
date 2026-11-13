use mathslot_doc::{Document, Editor, Intent, StreamState};

#[test]
fn test_a_edit_001_stream_frac() {
    let mut editor = Editor::new(Document::new());
    for ch in "▸f1;2;".chars() {
        editor.type_char(ch).expect("type_char must succeed");
    }

    let latex = editor.to_latex();
    assert_eq!(
        latex, r"\frac{1}{2}",
        "Streaming '▸f1;2;' must produce '\\frac{{1}}{{2}}', got: {latex}"
    );

    // 无错误诊断
    let diagnostics = editor.diagnostics();
    assert!(
        diagnostics.iter().all(|d| !d.is_error()),
        "Completed stream fraction must not have error diagnostics, got: {diagnostics:?}"
    );
    assert_eq!(*editor.stream_state(), StreamState::Idle);
}

#[test]
fn test_a_edit_002_pending_copy_export() {
    let mut editor = Editor::new(Document::new());
    for ch in "▸m".chars() {
        editor.type_char(ch).expect("type_char must succeed");
    }

    // 存在 Pending 诊断
    assert!(
        editor.has_pending_command(),
        "Editor must report pending command after '▸m'"
    );
    let diagnostics = editor.diagnostics();
    assert!(
        diagnostics.iter().any(|d| d.is_pending()),
        "Expected pending diagnostic in {diagnostics:?}"
    );

    // 导出/复制不得为空串，必须输出显式占位符
    let exported = editor.export_latex();
    let copied = editor.copy_text();

    assert!(
        !exported.trim().is_empty(),
        "Exporting pending command must not be empty"
    );
    assert!(
        !copied.trim().is_empty(),
        "Copying pending command must not be empty"
    );
    assert!(
        exported.contains("▸m") || exported.contains(r"\text{▸m}"),
        "Exported output must contain explicit placeholder for '▸m', got: {exported}"
    );
}

#[test]
fn test_a_edit_003_unknown_command_diagnostic() {
    let mut editor = Editor::new(Document::new());
    for ch in "▸zz".chars() {
        editor.type_char(ch).expect("type_char must succeed");
    }

    // 不得静默变成 'z'
    let latex = editor.to_latex();
    assert_ne!(
        latex.trim(),
        "z",
        "Unknown command '▸zz' must never silently degenerate to 'z'"
    );

    // 记录 UnknownCommand 诊断
    let diagnostics = editor.diagnostics();
    assert!(
        diagnostics.iter().any(|d| d.is_error()),
        "Expected error/unknown command diagnostic for '▸zz', got: {diagnostics:?}"
    );
}

#[test]
fn test_a_edit_004_partial_card() {
    let mut editor = Editor::new(Document::new());
    editor
        .apply_palette_card("partial")
        .expect("applying 'partial' card must succeed");

    let latex = editor.to_latex();
    assert!(
        latex.contains(r"\partial"),
        "Partial card must insert '\\partial', got: {latex}"
    );
    assert!(
        !latex.contains(r"\to"),
        "Partial card must NEVER insert '\\to'"
    );
}

#[test]
fn test_a_edit_005_undo_separate_typing_and_card() {
    let mut editor = Editor::new(Document::new());

    // 1. 点击“偏导”卡片
    editor
        .apply_palette_card("partial")
        .expect("insert card must succeed");
    assert_eq!(editor.history().undo_len(), 1);
    assert_eq!(
        editor.history().last_transaction().map(|t| t.intent),
        Some(Intent::PaletteCard)
    );

    // 2. 紧接着键盘输入
    editor.type_char('x').expect("typing 'x' must succeed");

    // 两步绝不合并
    assert_eq!(
        editor.history().undo_len(),
        2,
        "Card insertion and subsequent typing must NOT coalesce"
    );
    assert_eq!(
        editor.history().last_transaction().map(|t| t.intent),
        Some(Intent::Typing)
    );

    // 3. 第一次撤销：只撤销打字 'x'，保留卡片 '\partial'
    assert!(editor.undo(), "Undo typing must succeed");
    let after_first_undo = editor.to_latex();
    assert!(
        after_first_undo.contains(r"\partial"),
        "First undo must keep card '\\partial', got: {after_first_undo}"
    );
    assert!(
        !after_first_undo.contains('x'),
        "First undo must remove typed 'x'"
    );

    // 4. 第二次撤销：撤销卡片 '\partial'
    assert!(editor.undo(), "Undo card must succeed");
    let after_second_undo = editor.to_latex();
    assert!(
        !after_second_undo.contains(r"\partial"),
        "Second undo must remove '\\partial', got: {after_second_undo}"
    );
}

#[test]
fn test_a_edit_006_paste_with_prefix() {
    let mut editor = Editor::new(Document::new());

    // 粘贴含 '▸' 的文本
    editor
        .paste_text("▸f1;2;")
        .expect("paste_text must succeed");

    // 原样插入，绝不执行命令展开为分式
    let latex = editor.to_latex();
    assert_ne!(
        latex, r"\frac{1}{2}",
        "Pasting '▸f1;2;' must NOT expand to fraction"
    );
    assert!(
        latex.contains("▸f1;2;") || latex.contains(r"\text{▸f1;2;}"),
        "Pasted text must be preserved literally, got: {latex}"
    );
    assert_eq!(*editor.stream_state(), StreamState::Idle);

    // 撤销栈记录 Paste 意图
    assert_eq!(
        editor.history().last_transaction().map(|t| t.intent),
        Some(Intent::Paste)
    );
}

#[test]
fn test_a_edit_007_ime_composition_isolation() {
    let mut editor = Editor::new(Document::new());
    let initial_undo_len = editor.history().undo_len();

    // 组合状态流转
    editor.set_ime_composition("z");
    assert!(editor.is_composing());
    assert_eq!(editor.ime_composition(), Some("z"));
    assert_eq!(
        editor.history().undo_len(),
        initial_undo_len,
        "IME composition must not push to undo stack"
    );

    editor.set_ime_composition("zhong");
    assert_eq!(editor.ime_composition(), Some("zhong"));
    assert_eq!(
        editor.history().undo_len(),
        initial_undo_len,
        "IME composition update must not push to undo stack"
    );

    editor.set_ime_composition("zhongwen");
    assert_eq!(editor.ime_composition(), Some("zhongwen"));
    assert_eq!(
        editor.history().undo_len(),
        initial_undo_len,
        "IME composition must not pollute undo stack"
    );

    // 确认上屏
    editor.commit_ime("中文").expect("commit_ime must succeed");
    assert!(!editor.is_composing());
    assert_eq!(editor.ime_composition(), None);
    assert_eq!(
        editor.history().undo_len(),
        initial_undo_len + 1,
        "Committed IME must push exactly ONE transaction"
    );
    assert_eq!(
        editor.history().last_transaction().map(|t| t.intent),
        Some(Intent::ImeCommit)
    );
    assert!(editor.to_latex().contains("中文"));

    // 撤销整体回退
    assert!(editor.undo());
    assert!(!editor.to_latex().contains("中文"));
}

#[test]
fn test_a_edit_008_navigation_mode_no_text_or_undo_change() {
    let (doc, _) = Document::from_latex(r"\frac{a}{b}");
    let mut editor = Editor::new(doc);

    let initial_cursor = editor.cursor().clone();
    let initial_latex = editor.to_latex();
    let initial_undo_len = editor.history().undo_len();

    // 开启导航模式 (A-EDIT-008: 导航模式按字母：光标跳转；文本与 undo 不变)
    editor.enter_nav_mode();
    assert!(editor.is_nav_mode(), "Editor must be in navigation mode");

    // 1. 按字母 'j'：光标应跳到下一个槽位（分母）
    editor
        .type_char('j')
        .expect("type_char 'j' in nav mode must succeed");
    let cursor_after_j = editor.cursor().clone();
    assert_ne!(
        cursor_after_j, initial_cursor,
        "Pressing 'j' in nav mode must move cursor to another slot"
    );
    assert_eq!(
        editor.to_latex(),
        initial_latex,
        "Nav mode 'j' must NOT mutate document text"
    );
    assert_eq!(
        editor.history().undo_len(),
        initial_undo_len,
        "Nav mode 'j' must NOT push to undo stack"
    );

    // 2. 按字母 'k'：光标应跳回上一个槽位（分子）
    editor
        .type_char('k')
        .expect("type_char 'k' in nav mode must succeed");
    assert_eq!(
        editor.cursor(),
        &initial_cursor,
        "Pressing 'k' in nav mode must jump back to original slot"
    );
    assert_eq!(
        editor.to_latex(),
        initial_latex,
        "Nav mode 'k' must NOT mutate document text"
    );
    assert_eq!(
        editor.history().undo_len(),
        initial_undo_len,
        "Nav mode 'k' must NOT push to undo stack"
    );

    // 3. 测试其他字母导航键 ('n', 'p', 'l', 'h')
    editor
        .type_char('n')
        .expect("type_char 'n' in nav mode must succeed");
    assert_eq!(
        editor.cursor(),
        &cursor_after_j,
        "Pressing 'n' in nav mode must jump to next slot"
    );
    editor
        .type_char('p')
        .expect("type_char 'p' in nav mode must succeed");
    assert_eq!(
        editor.cursor(),
        &initial_cursor,
        "Pressing 'p' in nav mode must jump to prev slot"
    );

    // 4. 按非导航字母（如 'z'）：静默忽略，不插入字符，文本与 undo 均不变
    editor
        .type_char('z')
        .expect("type_char 'z' in nav mode must succeed without error");
    assert_eq!(
        editor.to_latex(),
        initial_latex,
        "Non-nav letter in nav mode must NOT insert character"
    );
    assert_eq!(
        editor.history().undo_len(),
        initial_undo_len,
        "Non-nav letter in nav mode must NOT mutate undo stack"
    );

    // 5. 退出导航模式
    editor.exit_nav_mode();
    assert!(!editor.is_nav_mode(), "Editor must have exited nav mode");

    // 退出后正常打字：应插入字符并进入 undo 栈
    editor
        .type_char('x')
        .expect("type_char 'x' in normal mode must succeed");
    assert_ne!(
        editor.to_latex(),
        initial_latex,
        "Normal typing must mutate document"
    );
    assert_eq!(
        editor.history().undo_len(),
        initial_undo_len + 1,
        "Normal typing must push to undo stack"
    );
}

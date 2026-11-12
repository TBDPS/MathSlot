//! MathSlot Round 11 严苛独立终验测试套件 (Final Acceptance Round 11 Suite)
//!
//! 专项考核《Round 11: 废除模态浮窗 · 右侧一等公民内联工作区体系》：
//! 1. 状态模型契约：WorkspaceTab 五态状态机（Palette, Corpus, Formats, LatexImport, Help），默认 Palette；
//! 2. 彻底废除浮窗：全局杜绝 egui::Window::new 弹出机制；
//! 3. 四大一等公民内联工作区契约：render_corpus_workspace, render_formats_workspace, render_latex_workspace, render_help_workspace；
//! 4. 五联胶囊标签栏与快捷键映射：38pt workspace_tab_bar_ui、F1/F2/F3/F4/Alt+1/Escape；
//! 5. 100% 通栏自适应与智能焦点管理：杜绝固定窄框与空洞，非 Palette 状态不夺取焦点。

use std::path::Path;

#[test]
fn test_acc_r11_workspace_tab_state_model_contract() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let app_rs_path = repo_root.join("src/app.rs");

    assert!(app_rs_path.exists(), "src/app.rs 必须存在");
    let app_src = std::fs::read_to_string(&app_rs_path).expect("Read src/app.rs");

    // 1.1 验证 WorkspaceTab 枚举定义及其 5 个变体
    assert!(
        app_src.contains("pub enum WorkspaceTab"),
        "必须定义 pub enum WorkspaceTab"
    );
    assert!(app_src.contains("Palette,"), "WorkspaceTab 必须包含 Palette 变体");
    assert!(app_src.contains("Corpus,"), "WorkspaceTab 必须包含 Corpus 变体");
    assert!(app_src.contains("Formats,"), "WorkspaceTab 必须包含 Formats 变体");
    assert!(app_src.contains("LatexImport,"), "WorkspaceTab 必须包含 LatexImport 变体");
    assert!(app_src.contains("Help,"), "WorkspaceTab 必须包含 Help 变体");

    // 1.2 验证默认态为 Palette
    assert!(
        app_src.contains("#[default]\n    Palette,") || app_src.contains("#[default]\r\n    Palette,"),
        "WorkspaceTab 默认项必须为 Palette"
    );

    // 1.3 验证 MathSlotApp 结构体包含 active_tab 字段
    assert!(
        app_src.contains("pub active_tab: WorkspaceTab,"),
        "MathSlotApp 必须包含 pub active_tab: WorkspaceTab 字段"
    );
}

#[test]
fn test_acc_r11_eradication_of_modal_windows() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let modals_rs_path = repo_root.join("src/modals.rs");
    let app_rs_path = repo_root.join("src/app.rs");

    let modals_src = std::fs::read_to_string(&modals_rs_path).expect("Read src/modals.rs");
    let app_src = std::fs::read_to_string(&app_rs_path).expect("Read src/app.rs");

    // 2.1 modals.rs 中必须 0 处 egui::Window::new
    assert!(
        !modals_src.contains("egui::Window::new"),
        "src/modals.rs 必须彻底清除 egui::Window::new 浮窗弹出机制！"
    );

    // 2.2 app.rs 中必须 0 处 egui::Window::new
    assert!(
        !app_src.contains("egui::Window::new"),
        "src/app.rs 必须彻底清除 egui::Window::new 浮窗弹出机制！"
    );

    // 2.3 旧版弹出标志彻底清除
    assert!(
        !modals_src.contains("pub show_library: bool"),
        "show_library 模态浮窗标志必须彻底删除"
    );
    assert!(
        !modals_src.contains("pub show_help: bool"),
        "show_help 模态浮窗标志必须彻底删除"
    );
    assert!(
        !modals_src.contains("pub show_presets: bool"),
        "show_presets 模态浮窗标志必须彻底删除"
    );
}

#[test]
fn test_acc_r11_four_inline_workspaces_contract() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let modals_rs_path = repo_root.join("src/modals.rs");
    let modals_src = std::fs::read_to_string(&modals_rs_path).expect("Read src/modals.rs");

    // 3.1 验证四大内联工作区方法签名与公开性
    assert!(
        modals_src.contains("pub fn render_corpus_workspace"),
        "必须提供公式库内联工作区 pub fn render_corpus_workspace"
    );
    assert!(
        modals_src.contains("pub fn render_formats_workspace"),
        "必须提供扩展中心内联工作区 pub fn render_formats_workspace"
    );
    assert!(
        modals_src.contains("pub fn render_latex_workspace"),
        "必须提供 LaTeX 逆向反编译工作台 pub fn render_latex_workspace"
    );
    assert!(
        modals_src.contains("pub fn render_help_workspace"),
        "必须提供使用指南内联工作区 pub fn render_help_workspace"
    );

    // 3.2 验证各工作区自适应通栏
    assert!(
        modals_src.contains("ui.set_width(ui.available_width());"),
        "工作区内部卡片与容器必须显式调用 ui.set_width(ui.available_width()) 杜绝大面积空洞"
    );
}

#[test]
fn test_acc_r11_tab_bar_capsule_and_hotkey_routing() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let app_rs_path = repo_root.join("src/app.rs");
    let app_src = std::fs::read_to_string(&app_rs_path).expect("Read src/app.rs");

    // 4.1 胶囊导航栏高度严格为 38pt
    assert!(
        app_src.contains("ui.set_height(38.0);"),
        "workspace_tab_bar_ui 必须设置 38pt 高度"
    );

    // 4.2 包含五联胶囊完整标题
    assert!(app_src.contains("∑ 符号结构"), "必须包含 [∑ 符号结构] 标签");
    assert!(app_src.contains("📚 公式库"), "必须包含 [📚 公式库] 标签");
    assert!(app_src.contains("⚙ 扩展中心"), "必须包含 [⚙ 扩展中心] 标签");
    assert!(app_src.contains("⇄ LaTeX 导入"), "必须包含 [⇄ LaTeX 导入] 标签");
    assert!(app_src.contains("💡 使用指南"), "必须包含 [💡 使用指南] 标签");

    // 4.3 快捷键映射核验
    assert!(app_src.contains("Key::F1"), "必须支持 F1 切换指南");
    assert!(app_src.contains("Key::F2"), "必须支持 F2 切换公式库");
    assert!(app_src.contains("Key::F3"), "必须支持 F3 切换扩展中心");
    assert!(app_src.contains("Key::F4"), "必须支持 F4 切换 LaTeX 导入");
    assert!(app_src.contains("Key::Num1") && app_src.contains("Modifiers::ALT"), "必须支持 Alt+1 切回 Palette");
    assert!(app_src.contains("Key::Escape"), "非 Palette 状态必须支持 Escape 切回 Palette");
}

#[test]
fn test_acc_r11_live_preview_and_smart_focus_contract() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let app_rs_path = repo_root.join("src/app.rs");
    let app_src = std::fs::read_to_string(&app_rs_path).expect("Read src/app.rs");

    // 5.1 验证在 CentralPanel 中当帧捕获 ModalAction 并在帧末统一刷新
    assert!(
        app_src.contains("let mut inline_modal_action: Option<ModalAction> = None;"),
        "必须在 CentralPanel 中捕获内联工作区动作"
    );
    assert!(
        app_src.contains("self.mark_dirty();"),
        "执行 ReplaceCode / InsertCode 时必须调用 mark_dirty 实时触发重绘"
    );

    // 5.2 验证智能焦点管理逻辑
    assert!(
        app_src.contains("if self.active_tab == WorkspaceTab::Palette {"),
        "必须基于 active_tab == WorkspaceTab::Palette 进行区分焦点管理"
    );
    assert!(
        app_src.contains("else if self.request_input_focus {"),
        "非 Palette 状态下必须仅在 request_input_focus 为真时平滑归还焦点"
    );
}

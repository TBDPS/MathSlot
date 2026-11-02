use std::cell::RefCell;

use mathslot_core::ast::NavEntryKind;
use mathslot_core::command::{
    CMD_PREFIX, DIRECT_ENTRIES, PrefixMenuState, STEP_SEP, SubCategory, lookup_direct,
    lookup_sub_command,
};
use mathslot_core::editor::{Snapshot, StreamEditor};
use mathslot_core::latex::to_latex;
use mathslot_core::library::{CustomFormat, FormulaSnippet, UserLibrary};
use mathslot_core::scheme_a::to_scheme_a;
use mathslot_core::visual::{VisualDialect, build_nav_latex, build_preview_latex};

const PRESETS: &[(&str, &str)] = &[
    ("根号与分式嵌套", "▸r1 + ▸rx + 1;; + ▸fx + 1;y;"),
    ("重要极限示例", "▸lx;0;▸fsin x;x; = 1"),
    ("积分上限嵌套积分", "▸i0;▸i1;t;g(u) du;;f(x) dx"),
    ("一元二次求根公式", "x = ▸f-b +- ▸rb^2 - 4ac;;2a;"),
    ("组合数与二项式和", "▸sk=0;n;▸kan;k; x^k"),
];

struct WasmSession {
    editor: StreamEditor,
    status: String,
    out_buf: Vec<u8>,
}

impl WasmSession {
    fn new() -> Self {
        Self {
            editor: StreamEditor::new(),
            status: "就绪：Tab+单字母直输结构（前置 Tab l 自动包裹极限主体），↑/↓ 上下穿槽，Esc a 行首 / Esc ; 行尾 / Esc - 回原位。"
                .to_owned(),
            out_buf: Vec::with_capacity(4096),
        }
    }

    fn write_json(&mut self, json: String) -> usize {
        self.out_buf.clear();
        self.out_buf.extend_from_slice(json.as_bytes());
        self.out_buf.len()
    }

    fn emit_state(&mut self) -> usize {
        let json = build_state_json(&self.editor, &self.status);
        self.write_json(json)
    }
}

thread_local! {
    static SESSION: RefCell<WasmSession> = RefCell::new(WasmSession::new());
}

#[unsafe(no_mangle)]
pub extern "C" fn wasm_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` 必须由 `wasm_alloc(cap)` 分配且尚未释放。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wasm_dealloc(ptr: *mut u8, cap: usize) {
    if !ptr.is_null() && cap > 0 {
        // SAFETY: 调用方保证 `ptr` 与 `cap` 来自配对的 `wasm_alloc(cap)`。
        unsafe {
            let _ = Vec::from_raw_parts(ptr, 0, cap);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> *const u8 {
    SESSION.with(|cell| cell.borrow().out_buf.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn out_len() -> usize {
    SESSION.with(|cell| cell.borrow().out_buf.len())
}

#[unsafe(no_mangle)]
pub extern "C" fn get_catalog_json() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        let json = build_catalog_json(&s.editor.library);
        s.write_json(json)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_reset() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        let saved_lib = s.editor.library.clone();
        s.editor = StreamEditor::with_library(saved_lib);
        s.status = "就绪：Tab+单字母直输结构（前置 Tab l 自动包裹极限主体），↑/↓ 上下穿槽，Esc a 行首 / Esc ; 行尾 / Esc - 回原位。"
            .to_owned();
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_snapshot_json() -> usize {
    SESSION.with(|cell| cell.borrow_mut().emit_state())
}

#[unsafe(no_mangle)]
pub extern "C" fn library_get_json() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        let json = s.editor.library.to_json_pretty();
        s.write_json(json)
    })
}

/// # Safety
/// `ptr..ptr+len` 必须是线性内存中有效的 UTF-8 字节区间。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn library_set_json(ptr: *const u8, len: usize) -> usize {
    let raw = unsafe { read_utf8(ptr, len) };
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        match UserLibrary::from_json(&raw) {
            Ok(lib) => {
                s.editor.set_library(lib);
                s.status = "已加载自定义数学格式与公式复用片段库。".to_owned();
            }
            Err(err) => {
                s.status = format!("配置解析失败（已保留默认库）：{err}");
            }
        }
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn library_reset_default() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.editor.set_library(UserLibrary::default_seeded());
        s.status = "已恢复预置自定义格式与片段模版库。".to_owned();
        s.emit_state()
    })
}

/// # Safety
/// 所有指针切片均须为有效 UTF-8。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn library_upsert_custom(
    key_cp: u32,
    label_ptr: *const u8,
    label_len: usize,
    glyph_ptr: *const u8,
    glyph_len: usize,
    roles_ptr: *const u8,
    roles_len: usize,
    latex_ptr: *const u8,
    latex_len: usize,
    scheme_ptr: *const u8,
    scheme_len: usize,
) -> usize {
    let label = unsafe { read_utf8(label_ptr, label_len) };
    let glyph = unsafe { read_utf8(glyph_ptr, glyph_len) };
    let roles_raw = unsafe { read_utf8(roles_ptr, roles_len) };
    let latex = unsafe { read_utf8(latex_ptr, latex_len) };
    let scheme = unsafe { read_utf8(scheme_ptr, scheme_len) };

    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        let Some(item_key) = char::from_u32(key_cp) else {
            s.status = "无效按键字符。".to_owned();
            return s.emit_state();
        };
        let slot_roles: Vec<String> = roles_raw
            .split([';', ',', '，', '；'])
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .map(str::to_owned)
            .collect();
        let (layout, auto_join) = if let Some(old) = s.editor.library.lookup_custom(item_key) {
            (old.layout.clone(), old.auto_join.clone())
        } else {
            (mathslot_core::library::LayoutKind::Linear, None)
        };
        let fmt = CustomFormat {
            item_key,
            label: label.clone(),
            glyph_hint: glyph,
            slot_roles,
            latex_template: latex,
            scheme_a_name: scheme,
            layout,
            auto_join,
        };
        let mut lib = s.editor.library.clone();
        match lib.upsert_custom(fmt) {
            Ok(k) => {
                s.editor.set_library(lib);
                s.status = format!("已保存自定义格式「{}」-> Tab k {k}！", label.trim());
            }
            Err(err) => {
                s.status = err;
            }
        }
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn library_remove_custom(key_cp: u32) -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        if let Some(ch) = char::from_u32(key_cp) {
            let mut lib = s.editor.library.clone();
            if lib.remove_custom(ch) {
                s.editor.set_library(lib);
                s.status = format!("已删除自定义格式 k{}。", ch.to_ascii_lowercase());
            }
        }
        s.emit_state()
    })
}

/// # Safety
/// `label_ptr..label_ptr+label_len` 须为有效 UTF-8。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn library_save_snippet(
    label_ptr: *const u8,
    label_len: usize,
    prefer_inner: u32,
) -> usize {
    let label = unsafe { read_utf8(label_ptr, label_len) };
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        let opt_label = if label.trim().is_empty() {
            None
        } else {
            Some(label.as_str())
        };
        match s.editor.save_current_as_snippet(opt_label, prefer_inner != 0) {
            Ok((_, msg)) | Err(msg) => s.status = msg,
        }
        s.emit_state()
    })
}

/// # Safety
/// 指针切片须为有效 UTF-8。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn library_upsert_snippet(
    key_cp: u32,
    label_ptr: *const u8,
    label_len: usize,
    src_ptr: *const u8,
    src_len: usize,
) -> usize {
    let label = unsafe { read_utf8(label_ptr, label_len) };
    let stream_source = unsafe { read_utf8(src_ptr, src_len) };
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        if let Some(item_key) = char::from_u32(key_cp) {
            let mut lib = s.editor.library.clone();
            match lib.upsert_snippet(FormulaSnippet {
                item_key,
                label: label.clone(),
                stream_source,
            }) {
                Ok(k) => {
                    s.editor.set_library(lib);
                    s.status = format!("已保存片段模版「{}」-> Tab t {k}！", label.trim());
                }
                Err(err) => s.status = err,
            }
        } else {
            s.status = "无效的片段按键字符。".to_owned();
        }
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn library_remove_snippet(key_cp: u32) -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        if let Some(ch) = char::from_u32(key_cp) {
            let mut lib = s.editor.library.clone();
            if lib.remove_snippet(ch) {
                s.editor.set_library(lib);
                s.status = format!("已删除片段模版 t{}。", ch.to_ascii_lowercase());
            }
        }
        s.emit_state()
    })
}

/// # Safety
/// `ptr..ptr+len` 必须是线性内存中有效的 UTF-8 字节区间。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn editor_sync_text(
    ptr: *const u8,
    len: usize,
    cursor_char: usize,
    record_undo: u32,
) -> usize {
    let text = unsafe { read_utf8(ptr, len) };
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        if record_undo != 0 && s.editor.source != text {
            let snap = Snapshot {
                source: s.editor.source.clone(),
                cursor_char: s.editor.cursor_char,
            };
            s.editor.save_undo_snapshot(snap);
        }
        s.editor.source = text;
        if let Some(hint) = s.editor.sync_after_edit(cursor_char) {
            s.status = hint;
        } else {
            s.status =
                "正在流式输入…（Tab+单字母 插入结构，↑/↓ 上下穿槽，Esc+字母/;/− 跳转，Ctrl+Enter 插入笔记）"
                    .to_owned();
        }
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_set_cursor(cursor_char: usize) -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        if s.editor.esc_nav.is_none() {
            s.editor.set_cursor(cursor_char);
        }
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_tab() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.status = s.editor.handle_tab();
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_enter() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.status = s.editor.smart_enter();
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_space_default() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        if let Some(msg) = s.editor.accept_submenu_default() {
            s.status = msg;
        }
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_arrow_up() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        if let Some(msg) = s.editor.arrow_vertical(true) {
            s.status = msg;
        }
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_arrow_down() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        if let Some(msg) = s.editor.arrow_vertical(false) {
            s.status = msg;
        }
        s.emit_state()
    })
}

/// 若成功处理（`Esc` 漫游或原子跨过 `▸<code>`）返回 JSON 字节数；否则返回 `0` 交由浏览器原生处理。
#[unsafe(no_mangle)]
pub extern "C" fn editor_arrow_left() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        let Some(msg) = s.editor.arrow_horizontal(true) else {
            return 0;
        };
        if !msg.is_empty() {
            s.status = msg;
        }
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_arrow_right() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        let Some(msg) = s.editor.arrow_horizontal(false) else {
            return 0;
        };
        if !msg.is_empty() {
            s.status = msg;
        }
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_jump_back() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.status = s.editor.jump_to_previous_pos();
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_jump_start() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.status = s.editor.jump_to_start();
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_jump_end() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.status = s.editor.jump_to_end();
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_toggle_esc() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.status = s.editor.toggle_esc_jump();
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_esc_backspace() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.status = s.editor.esc_backspace();
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_esc_char(codepoint: u32) -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        if let Some(ch) = char::from_u32(codepoint) {
            s.status = s.editor.feed_esc_jump_char(ch);
        }
        s.emit_state()
    })
}

/// # Safety
/// `ptr..ptr+len` 必须是线性内存中有效的 UTF-8 字节区间。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn editor_click_card(ptr: *const u8, len: usize) -> usize {
    let code = unsafe { read_utf8(ptr, len) };
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.status = s.editor.apply_card_click(&code);
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_click_sub(codepoint: u32) -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        if let Some(ch) = char::from_u32(codepoint) {
            s.status = s.editor.apply_sub_click(ch);
        }
        s.emit_state()
    })
}

/// # Safety
/// `ptr..ptr+len` 必须是线性内存中有效的 UTF-8 字节区间。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn editor_jump_seq(ptr: *const u8, len: usize) -> usize {
    let seq = unsafe { read_utf8(ptr, len) };
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        match s.editor.jump_to_sequence(&seq) {
            Ok(msg) | Err(msg) => s.status = msg,
        }
        s.emit_state()
    })
}

/// # Safety
/// 两段指针区间都必须是有效的 UTF-8 字节切片。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn editor_load_preset(
    src_ptr: *const u8,
    src_len: usize,
    name_ptr: *const u8,
    name_len: usize,
) -> usize {
    let src = unsafe { read_utf8(src_ptr, src_len) };
    let name = unsafe { read_utf8(name_ptr, name_len) };
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.status = s.editor.load_preset(&src, &name);
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_undo() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.status = s.editor.undo();
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_redo() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.status = s.editor.redo();
        s.emit_state()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn editor_clear() -> usize {
    SESSION.with(|cell| {
        let mut s = cell.borrow_mut();
        s.status = s.editor.clear();
        s.emit_state()
    })
}

/// # Safety
/// 调用方保证切片在线性内存内有效。
unsafe fn read_utf8(ptr: *const u8, len: usize) -> String {
    if ptr.is_null() || len == 0 {
        return String::new();
    }
    // SAFETY: 见函数契约。
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    String::from_utf8_lossy(bytes).into_owned()
}

// ===========================================================================
// 零依赖轻量 JSON 序列化（直接输出给 Obsidian 插件前端渲染）
// ===========================================================================

fn build_catalog_json(library: &UserLibrary) -> String {
    let mut out = String::from("{");

    out.push_str("\"directEntries\":[");
    for (idx, d) in DIRECT_ENTRIES.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"key\":{},\"label\":{},\"glyph\":{},\"detail\":{}}}",
            json_str(&d.key.to_string()),
            json_str(d.label),
            json_str(d.glyph_hint),
            json_str(d.detail),
        ));
    }
    out.push_str("],");

    out.push_str("\"subCategories\":[");
    for (s_idx, sub) in SubCategory::ALL.iter().enumerate() {
        if s_idx > 0 {
            out.push(',');
        }
        match sub {
            SubCategory::Custom => {
                let def = library.default_custom();
                out.push_str(&format!(
                    "{{\"key\":\"k\",\"title\":{},\"defaultLabel\":{},\"defaultGlyph\":{},\"defaultKey\":{},\"entries\":[",
                    json_str(sub.title()),
                    json_str(def.map(|f| f.label.as_str()).unwrap_or("无")),
                    json_str(def.map(|f| f.glyph_hint.as_str()).unwrap_or("")),
                    json_str(&def.map(|f| f.item_key.to_string()).unwrap_or_default()),
                ));
                for (f_idx, f) in library.custom_formats.iter().enumerate() {
                    if f_idx > 0 {
                        out.push(',');
                    }
                    let is_def = def.is_some_and(|d| d.item_key == f.item_key);
                    let detail = if f.slot_roles.is_empty() {
                        f.latex_template.clone()
                    } else {
                        format!("{} -> {}", f.slot_roles.join(" ; "), f.latex_template)
                    };
                    out.push_str(&format!(
                        "{{\"code\":{},\"itemKey\":{},\"isDefault\":{},\"label\":{},\"glyph\":{},\"detail\":{}}}",
                        json_str(&f.code()),
                        json_str(&f.item_key.to_string()),
                        if is_def { "true" } else { "false" },
                        json_str(&f.label),
                        json_str(&f.glyph_hint),
                        json_str(&detail),
                    ));
                }
                out.push_str("]}");
            }
            SubCategory::Template => {
                let def = library.default_snippet();
                out.push_str(&format!(
                    "{{\"key\":\"t\",\"title\":{},\"defaultLabel\":{},\"defaultGlyph\":{},\"defaultKey\":{},\"entries\":[",
                    json_str(sub.title()),
                    json_str(def.map(|s| s.label.as_str()).unwrap_or("无")),
                    json_str("模版"),
                    json_str(&def.map(|s| s.item_key.to_string()).unwrap_or_default()),
                ));
                for (t_idx, snip) in library.snippets.iter().enumerate() {
                    if t_idx > 0 {
                        out.push(',');
                    }
                    let is_def = def.is_some_and(|d| d.item_key == snip.item_key);
                    out.push_str(&format!(
                        "{{\"code\":{},\"itemKey\":{},\"isDefault\":{},\"label\":{},\"glyph\":{},\"detail\":{}}}",
                        json_str(&snip.code()),
                        json_str(&snip.item_key.to_string()),
                        if is_def { "true" } else { "false" },
                        json_str(&snip.label),
                        json_str("复用"),
                        json_str(&snip.stream_source),
                    ));
                }
                out.push_str("]}");
            }
            _ => {
                let def = sub.default_entry();
                out.push_str(&format!(
                    "{{\"key\":{},\"title\":{},\"defaultLabel\":{},\"defaultGlyph\":{},\"defaultKey\":{},\"entries\":[",
                    json_str(&sub.key().to_string()),
                    json_str(sub.title()),
                    json_str(def.map(|d| d.label).unwrap_or("")),
                    json_str(def.map(|d| d.glyph_hint).unwrap_or("")),
                    json_str(&def.map(|d| d.item_key.to_string()).unwrap_or_default()),
                ));
                for (e_idx, e) in sub.entries().iter().enumerate() {
                    if e_idx > 0 {
                        out.push(',');
                    }
                    out.push_str(&format!(
                        "{{\"code\":{},\"itemKey\":{},\"isDefault\":{},\"label\":{},\"glyph\":{},\"detail\":{}}}",
                        json_str(e.code),
                        json_str(&e.item_key.to_string()),
                        if e.is_default { "true" } else { "false" },
                        json_str(e.label),
                        json_str(e.glyph_hint),
                        json_str(e.detail),
                    ));
                }
                out.push_str("]}");
            }
        }
    }
    out.push_str("],");

    out.push_str("\"customFormats\":[");
    for (idx, f) in library.custom_formats.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"key\":{},\"label\":{},\"glyph\":{},\"roles\":{},\"latex\":{},\"schemeA\":{},\"nextFree\":{}}}",
            json_str(&f.item_key.to_string()),
            json_str(&f.label),
            json_str(&f.glyph_hint),
            json_str_array(&f.slot_roles),
            json_str(&f.latex_template),
            json_str(&f.scheme_a_name),
            json_str(&library.next_free_custom_key().map(|c| c.to_string()).unwrap_or_default()),
        ));
    }
    out.push_str("],");

    out.push_str("\"snippets\":[");
    for (idx, s) in library.snippets.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"key\":{},\"label\":{},\"source\":{}}}",
            json_str(&s.item_key.to_string()),
            json_str(&s.label),
            json_str(&s.stream_source),
        ));
    }
    out.push_str("],");

    out.push_str(&format!(
        "\"nextCustomKey\":{},\"nextSnippetKey\":{},",
        // 库满时返回空串，前端据此提示"已无空闲键"而非显示不存在的键
        json_str(
            &library
                .next_free_custom_key()
                .map(|c| c.to_string())
                .unwrap_or_default()
        ),
        json_str(
            &library
                .next_free_snippet_key()
                .map(|c| c.to_string())
                .unwrap_or_default()
        ),
    ));

    out.push_str("\"presets\":[");
    for (p_idx, (name, src)) in PRESETS.iter().enumerate() {
        if p_idx > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"name\":{},\"source\":{}}}",
            json_str(name),
            json_str(src)
        ));
    }
    out.push_str("]}");

    out
}

fn build_state_json(editor: &StreamEditor, status: &str) -> String {
    let prefix_state = editor.prefix_menu_state();
    let (nav_path, nav_filter) = editor.active_nav_view_state();

    let latex = to_latex(&editor.parsed);
    let scheme_a = to_scheme_a(&editor.parsed);
    let preview_latex =
        build_preview_latex(&editor.parsed, editor.cursor_char, VisualDialect::MathJax);
    let nav_latex = build_nav_latex(
        &editor.parsed,
        editor.cursor_char,
        &nav_path,
        nav_filter.as_deref(),
        VisualDialect::MathJax,
    );

    let (menu_mode, sub_key, bad_key, jump_seq) = match &prefix_state {
        PrefixMenuState::Idle => ("idle", String::new(), String::new(), String::new()),
        PrefixMenuState::Root => ("root", String::new(), String::new(), String::new()),
        PrefixMenuState::SubMenu(sub) => (
            "submenu",
            sub.key().to_string(),
            String::new(),
            String::new(),
        ),
        PrefixMenuState::Jump(seq) => ("jump", String::new(), String::new(), seq.clone()),
        PrefixMenuState::InvalidPrefix(ch) => {
            ("invalid", String::new(), ch.to_string(), String::new())
        }
    };

    let (esc_active, esc_path, esc_partial) = match &editor.esc_nav {
        Some(esc) => (true, esc.path.clone(), esc.partial.clone()),
        None => (false, Vec::new(), String::new()),
    };

    let chain = editor.parsed.resolve_scope_chain(&nav_path);
    let active_stage = chain.last().expect("root stage always exists");
    let path_prefix = nav_path.join("");
    let filter_str = nav_filter.as_deref().unwrap_or("");
    let inner_struct_label = editor
        .parsed
        .innermost_struct_substr(&editor.source, editor.cursor_char)
        .map(|(l, _)| l)
        .unwrap_or_default();

    let mut out = String::with_capacity(2048);
    out.push('{');
    out.push_str(&format!("\"source\":{},", json_str(&editor.source)));
    out.push_str(&format!("\"cursorChar\":{},", editor.cursor_char));
    out.push_str(&format!("\"status\":{},", json_str(status)));
    out.push_str(&format!("\"latex\":{},", json_str(&latex)));
    out.push_str(&format!("\"schemeA\":{},", json_str(&scheme_a)));
    out.push_str(&format!("\"previewLatex\":{},", json_str(&preview_latex)));
    out.push_str(&format!("\"navLatex\":{},", json_str(&nav_latex)));
    out.push_str(&format!("\"canUndo\":{},", editor.can_undo()));
    out.push_str(&format!("\"canRedo\":{},", editor.can_redo()));
    out.push_str(&format!("\"canJumpBack\":{},", editor.can_jump_back()));
    out.push_str(&format!(
        "\"innerStructLabel\":{},",
        json_str(&inner_struct_label)
    ));
    out.push_str(&format!("\"escActive\":{esc_active},"));
    out.push_str(&format!("\"escPath\":{},", json_str_array(&esc_path)));
    out.push_str(&format!("\"escPartial\":{},", json_str(&esc_partial)));
    out.push_str(&format!("\"menuMode\":{},", json_str(menu_mode)));
    out.push_str(&format!("\"menuSubKey\":{},", json_str(&sub_key)));
    out.push_str(&format!("\"menuInvalidKey\":{},", json_str(&bad_key)));
    out.push_str(&format!("\"menuJumpSeq\":{},", json_str(&jump_seq)));
    out.push_str(&format!("\"navViewPath\":{},", json_str_array(&nav_path)));
    out.push_str(&format!(
        "\"navStageTitle\":{},",
        json_str(&active_stage.scope.title)
    ));

    // 当前活动导航层的可点击/提示锚点列表
    out.push_str("\"navEntries\":[");
    let mut first_entry = true;
    for entry in &active_stage.scope.entries {
        if !filter_str.is_empty() && !entry.label.starts_with(filter_str) {
            continue;
        }
        if !first_entry {
            out.push(',');
        }
        first_entry = false;
        let (kind_tag, role_str) = match &entry.kind {
            NavEntryKind::ScopeStart => (
                "start",
                if nav_path.is_empty() { "行首" } else { "槽首" },
            ),
            NavEntryKind::ScopeEnd => (
                "end",
                if nav_path.is_empty() { "行尾" } else { "槽尾" },
            ),
            NavEntryKind::Leaf {
                is_empty: true,
                role_hint,
            } => ("empty", role_hint.as_deref().unwrap_or("待填")),
            NavEntryKind::Leaf { role_hint, .. } => ("filled", role_hint.as_deref().unwrap_or("")),
            NavEntryKind::Composite { role_hint, .. } => ("composite", role_hint.as_str()),
        };
        let full_seq = format!("{path_prefix}{}", entry.label);
        out.push_str(&format!(
            "{{\"label\":{},\"fullSeq\":{},\"role\":{},\"kind\":{}}}",
            json_str(&entry.label),
            json_str(&full_seq),
            json_str(role_str),
            json_str(kind_tag),
        ));
    }
    out.push_str("],");

    // 光标所在层级面包屑
    let breadcrumbs = editor.parsed.breadcrumbs_at(editor.cursor_char);
    out.push_str("\"breadcrumbs\":[");
    for (b_idx, bc) in breadcrumbs.iter().enumerate() {
        if b_idx > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"label\":{},\"code\":{},\"slotIndex\":{},\"roles\":{}}}",
            json_str(&bc.label),
            json_str(&bc.code),
            bc.slot_index,
            json_str_array(&bc.slot_roles),
        ));
    }
    out.push_str("],");

    // 源流无损语法高亮分词
    out.push_str("\"tokens\":[");
    for (t_idx, (text, kind)) in tokenize_stream(&editor.source, &editor.library)
        .into_iter()
        .enumerate()
    {
        if t_idx > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"text\":{},\"kind\":{}}}",
            json_str(text),
            json_str(kind),
        ));
    }
    out.push_str("]}");

    out
}

fn tokenize_stream<'a>(source: &'a str, lib: &UserLibrary) -> Vec<(&'a str, &'static str)> {
    let mut out = Vec::new();
    let chars: Vec<(usize, char)> = source.char_indices().collect();
    let mut i = 0;

    while i < chars.len() {
        let (byte_start, ch) = chars[i];
        if ch == CMD_PREFIX {
            if i + 1 < chars.len() && chars[i + 1].1 == 'j' {
                let mut end_idx = i + 2;
                while end_idx < chars.len()
                    && (chars[end_idx].1.is_ascii_lowercase()
                        || matches!(chars[end_idx].1, '.' | '$' | '-'))
                    && end_idx - i < 8
                {
                    end_idx += 1;
                }
                let byte_end = chars
                    .get(end_idx)
                    .map(|(b, _)| *b)
                    .unwrap_or(source.len());
                out.push((&source[byte_start..byte_end], "jump"));
                i = end_idx;
                continue;
            }
            if i + 1 < chars.len() && chars[i + 1].1.is_ascii_alphabetic() {
                let c1 = chars[i + 1].1.to_ascii_lowercase();
                if lookup_direct(c1).is_some() {
                    let byte_end = chars.get(i + 2).map(|(b, _)| *b).unwrap_or(source.len());
                    out.push((&source[byte_start..byte_end], "cmd"));
                    i += 2;
                    continue;
                }
                if SubCategory::from_key(c1).is_some() {
                    if i + 2 < chars.len() && chars[i + 2].1.is_ascii_alphabetic() {
                        let c2 = chars[i + 2].1.to_ascii_lowercase();
                        let byte_end = chars.get(i + 3).map(|(b, _)| *b).unwrap_or(source.len());
                        let valid = match c1 {
                            'k' => lib.lookup_custom(c2).is_some(),
                            't' => lib.lookup_snippet(c2).is_some(),
                            _ => lookup_sub_command(c1, c2).is_some(),
                        };
                        let tag = if valid { "cmd" } else { "invalid" };
                        out.push((&source[byte_start..byte_end], tag));
                        i += 3;
                        continue;
                    }
                    let byte_end = chars.get(i + 2).map(|(b, _)| *b).unwrap_or(source.len());
                    let tag = if i + 2 < chars.len() { "cmd" } else { "pending" };
                    out.push((&source[byte_start..byte_end], tag));
                    i += 2;
                    continue;
                }
                let byte_end = chars.get(i + 2).map(|(b, _)| *b).unwrap_or(source.len());
                out.push((&source[byte_start..byte_end], "invalid"));
                i += 2;
                continue;
            }
            let byte_end = chars.get(i + 1).map(|(b, _)| *b).unwrap_or(source.len());
            out.push((&source[byte_start..byte_end], "pending"));
            i += 1;
            continue;
        }
        if ch == STEP_SEP {
            let byte_end = chars.get(i + 1).map(|(b, _)| *b).unwrap_or(source.len());
            out.push((&source[byte_start..byte_end], "sep"));
            i += 1;
            continue;
        }
        let run_start = byte_start;
        i += 1;
        while i < chars.len() && chars[i].1 != CMD_PREFIX && chars[i].1 != STEP_SEP {
            i += 1;
        }
        let run_end = chars.get(i).map(|(b, _)| *b).unwrap_or(source.len());
        out.push((&source[run_start..run_end], "text"));
    }

    out
}

fn json_str_array(items: &[String]) -> String {
    let mut out = String::from("[");
    for (idx, s) in items.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        out.push_str(&json_str(s));
    }
    out.push(']');
    out
}

fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

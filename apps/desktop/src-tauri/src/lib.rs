use serde::Serialize;
use std::borrow::Cow;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Manager;

static TMP_SEQ: AtomicU64 = AtomicU64::new(1);
const MAX_CLIPBOARD_DIM: usize = 16384;
const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Keeps the OS clipboard handle alive for the entire app lifetime.
/// Critical on Linux (both X11 and Wayland): dropping `arboard::Clipboard` immediately
/// relinquishes selection ownership and clears copied images/text before target apps paste.
struct AppClipboard(Mutex<Option<arboard::Clipboard>>);

impl AppClipboard {
    fn new() -> Self {
        Self(Mutex::new(None))
    }

    fn with_clipboard<T, F>(&self, mut f: F) -> Result<T, String>
    where
        F: FnMut(&mut arboard::Clipboard) -> Result<T, arboard::Error>,
    {
        let mut guard = self.0.lock().map_err(|_| "clipboard mutex poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
        }
        match f(guard.as_mut().unwrap()) {
            Ok(v) => Ok(v),
            Err(_) => {
                // Re-initialize once in case display/clipboard connection reset
                let mut fresh = arboard::Clipboard::new().map_err(|e| e.to_string())?;
                let res = f(&mut fresh).map_err(|e| e.to_string())?;
                *guard = Some(fresh);
                Ok(res)
            }
        }
    }
}

const STARTER_PRESETS_JSON: &str = r#"{
  "$comment": "MathSlot 用户公式库（可直接编辑，保存后在软件内点击「重载」立即生效，无需重新编译）。支持新增公式、按 id 覆盖内置公式，或设置 \"disabled\": true 隐藏内置条目。",
  "presets": []
}
"#;

const STARTER_COMMANDS_JSON: &str = r#"{
  "$comment": "MathSlot 用户命令库（可直接编辑，保存后点击「重载」立即生效，无需重新编译）。category 可选: structure/calculus/matrix/accent/greek/symbol/relation/setlogic；latex 中用 $1/$2 标记槽位。",
  "commands": []
}
"#;

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create config dir: {e}"))?;
    Ok(dir)
}

fn write_atomic(path: &PathBuf, content: &str) -> Result<(), String> {
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("store.json");
    let tmp = path.with_file_name(format!(".{file_name}.{pid}.{seq}.tmp"));
    fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserLibrariesPayload {
    config_dir: String,
    presets_json: String,
    commands_json: String,
    presets_newly_created: bool,
    commands_newly_created: bool,
}

#[tauri::command]
fn copy_to_clipboard(state: tauri::State<'_, AppClipboard>, text: String) -> Result<(), String> {
    state.with_clipboard(|cb| cb.set_text(text.clone()))
}

fn percent_decode_utf8(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_string())
}

fn sanitize_export_filename(filename: &str) -> String {
    let mut safe_name: String = filename
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    safe_name = safe_name.trim().trim_matches('.').to_string();
    if safe_name.is_empty() {
        safe_name = "mathslot-formula.png".to_string();
    }
    let upper_stem = std::path::Path::new(&safe_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_uppercase();
    if WINDOWS_RESERVED_NAMES.contains(&upper_stem.as_str()) {
        safe_name = format!("formula-{safe_name}");
    }
    safe_name
}

#[tauri::command]
fn copy_image_to_clipboard(
    state: tauri::State<'_, AppClipboard>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let width: usize = request
        .headers()
        .get("x-width")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "missing or invalid x-width header".to_string())?;
    let height: usize = request
        .headers()
        .get("x-height")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "missing or invalid x-height header".to_string())?;
    let rgba: &[u8] = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.as_slice(),
        tauri::ipc::InvokeBody::Json(_) => return Err("expected raw binary RGBA payload".to_string()),
    };
    if width == 0 || height == 0 || width > MAX_CLIPBOARD_DIM || height > MAX_CLIPBOARD_DIM {
        return Err("invalid image dimensions".to_string());
    }
    let expected = width
        .checked_mul(height)
        .and_then(|px| px.checked_mul(4))
        .ok_or_else(|| "image dimension overflow".to_string())?;
    if rgba.len() != expected {
        return Err(format!(
            "rgba buffer size mismatch: got {}, expected {}",
            rgba.len(),
            expected
        ));
    }
    state.with_clipboard(|cb| {
        let img = arboard::ImageData {
            width,
            height,
            bytes: Cow::Borrowed(rgba),
        };
        cb.set_image(img)
    })
}

#[tauri::command]
fn read_from_clipboard(state: tauri::State<'_, AppClipboard>) -> Result<String, String> {
    state.with_clipboard(|cb| cb.get_text())
}

fn downloads_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().desktop_dir())
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| format!("failed to resolve downloads dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create downloads dir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
fn save_export_file(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let dir = downloads_dir(&app)?;
    let raw_header = request
        .headers()
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("mathslot-formula.png");
    let filename = percent_decode_utf8(raw_header);
    let bytes: &[u8] = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.as_slice(),
        tauri::ipc::InvokeBody::Json(_) => return Err("expected raw binary export payload".to_string()),
    };
    let safe_name = sanitize_export_filename(&filename);

    let mut path = dir.join(&safe_name);
    if path.exists() {
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("mathslot-formula")
            .to_string();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_default();
        let mut found = None;
        for idx in 2..=9999 {
            let candidate = dir.join(format!("{stem}-{idx}{ext}"));
            if !candidate.exists() {
                found = Some(candidate);
                break;
            }
        }
        path = found.ok_or_else(|| "export filename deduplication limit reached".to_string())?;
    }

    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_downloads_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = downloads_dir(&app)?;
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_always_on_top(window: tauri::WebviewWindow, pinned: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let on_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
            && std::env::var("GDK_BACKEND").as_deref() != Ok("x11");
        if on_wayland {
            return Err("WAYLAND_UNSUPPORTED".to_string());
        }
    }
    window.set_always_on_top(pinned).map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn load_store(app: tauri::AppHandle) -> Result<String, String> {
    let path = config_dir(&app)?.join("store.json");
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_store(app: tauri::AppHandle, payload: String) -> Result<(), String> {
    let path = config_dir(&app)?.join("store.json");
    write_atomic(&path, &payload)
}

#[tauri::command]
fn load_user_libraries(app: tauri::AppHandle) -> Result<UserLibrariesPayload, String> {
    let dir = config_dir(&app)?;
    let presets_path = dir.join("presets.json");
    let commands_path = dir.join("commands.json");

    let mut presets_newly_created = false;
    let mut commands_newly_created = false;

    if !presets_path.exists() {
        write_atomic(&presets_path, STARTER_PRESETS_JSON)?;
        presets_newly_created = true;
    }
    if !commands_path.exists() {
        write_atomic(&commands_path, STARTER_COMMANDS_JSON)?;
        commands_newly_created = true;
    }

    let presets_json = fs::read_to_string(&presets_path).map_err(|e| e.to_string())?;
    let commands_json = fs::read_to_string(&commands_path).map_err(|e| e.to_string())?;

    Ok(UserLibrariesPayload {
        config_dir: dir.to_string_lossy().into_owned(),
        presets_json,
        commands_json,
        presets_newly_created,
        commands_newly_created,
    })
}

#[tauri::command]
fn save_user_libraries(
    app: tauri::AppHandle,
    presets_json: String,
    commands_json: String,
) -> Result<(), String> {
    let dir = config_dir(&app)?;
    write_atomic(&dir.join("presets.json"), &presets_json)?;
    write_atomic(&dir.join("commands.json"), &commands_json)?;
    Ok(())
}

#[tauri::command]
fn open_config_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = config_dir(&app)?;
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppClipboard::new())
        .setup(|app| {
            if let (Some(window), Some(icon)) = (
                app.get_webview_window("main"),
                app.default_window_icon().cloned(),
            ) {
                let _ = window.set_icon(icon);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            copy_to_clipboard,
            copy_image_to_clipboard,
            read_from_clipboard,
            save_export_file,
            open_downloads_dir,
            set_always_on_top,
            hide_window,
            load_store,
            save_store,
            load_user_libraries,
            save_user_libraries,
            open_config_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running MathSlot desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_percent_encoded_filenames() {
        assert_eq!(
            percent_decode_utf8("%E5%82%85%E9%87%8C%E5%8F%B6%E7%BA%A7%E6%95%B0.png"),
            "傅里叶级数.png"
        );
        assert_eq!(percent_decode_utf8("formula%201.svg"), "formula 1.svg");
    }

    #[test]
    fn sanitizes_path_traversal_and_windows_reserved_names() {
        assert_eq!(sanitize_export_filename("../../etc/passwd"), "etcpasswd");
        assert_eq!(sanitize_export_filename("CON.png"), "formula-CON.png");
        assert_eq!(sanitize_export_filename("..."), "mathslot-formula.png");
        assert_eq!(sanitize_export_filename("傅里叶级数.svg"), "傅里叶级数.svg");
    }
}

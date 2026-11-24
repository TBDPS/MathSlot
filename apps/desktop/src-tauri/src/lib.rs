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
}

#[tauri::command]
fn copy_to_clipboard(state: tauri::State<'_, AppClipboard>, text: String) -> Result<(), String> {
    state.with_clipboard(|cb| cb.set_text(text.clone()))
}

#[tauri::command]
fn copy_image_to_clipboard(
    state: tauri::State<'_, AppClipboard>,
    rgba: Vec<u8>,
    width: usize,
    height: usize,
) -> Result<(), String> {
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
            bytes: Cow::Borrowed(&rgba),
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
fn save_export_file(app: tauri::AppHandle, filename: String, bytes: Vec<u8>) -> Result<String, String> {
    let dir = downloads_dir(&app)?;
    // Sanitize filename to prevent path traversal
    let mut safe_name: String = filename
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
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

    if !presets_path.exists() {
        write_atomic(&presets_path, STARTER_PRESETS_JSON)?;
    }
    if !commands_path.exists() {
        write_atomic(&commands_path, STARTER_COMMANDS_JSON)?;
    }

    let presets_json = fs::read_to_string(&presets_path).map_err(|e| e.to_string())?;
    let commands_json = fs::read_to_string(&commands_path).map_err(|e| e.to_string())?;

    Ok(UserLibrariesPayload {
        config_dir: dir.to_string_lossy().into_owned(),
        presets_json,
        commands_json,
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
            load_store,
            save_store,
            load_user_libraries,
            save_user_libraries,
            open_config_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running MathSlot desktop");
}

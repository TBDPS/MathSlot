use serde::Serialize;
use std::borrow::Cow;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

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
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserLibrariesPayload {
    config_dir: String,
    presets_json: String,
    commands_json: String,
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_image_to_clipboard(rgba: Vec<u8>, width: usize, height: usize) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let img = arboard::ImageData {
        width,
        height,
        bytes: Cow::Owned(rgba),
    };
    clipboard.set_image(img).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_from_clipboard() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_always_on_top(window: tauri::WebviewWindow, pinned: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let on_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
            && std::env::var("GDK_BACKEND").as_deref() != Ok("x11");
        if on_wayland {
            let _ = window.set_always_on_top(pinned);
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

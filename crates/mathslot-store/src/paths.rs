use std::ffi::OsStr;
use std::path::PathBuf;

/// Returns the platform-standard MathSlot configuration file path (`library.json`).
///
/// - Linux: `$XDG_CONFIG_HOME/mathslot/library.json` or `$HOME/.config/mathslot/library.json`
/// - macOS: `$HOME/Library/Application Support/mathslot/library.json`
/// - Windows: `%APPDATA%\mathslot\library.json`
pub fn default_library_path() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("mathslot").join("library.json"))
}

/// Pure Linux config path resolution (`INV-010`, `D-022`).
pub fn library_path_for_linux(
    xdg_config_home: Option<&OsStr>,
    home: Option<&OsStr>,
) -> Option<PathBuf> {
    if let Some(xdg) = xdg_config_home
        && !xdg.is_empty()
    {
        return Some(PathBuf::from(xdg).join("mathslot").join("library.json"));
    }
    home.filter(|h| !h.is_empty()).map(|h| {
        PathBuf::from(h)
            .join(".config")
            .join("mathslot")
            .join("library.json")
    })
}

/// Pure macOS config path resolution (`INV-010`, `D-022`).
pub fn library_path_for_macos(home: Option<&OsStr>) -> Option<PathBuf> {
    home.filter(|h| !h.is_empty()).map(|h| {
        PathBuf::from(h)
            .join("Library")
            .join("Application Support")
            .join("mathslot")
            .join("library.json")
    })
}

/// Pure Windows config path resolution (`INV-010`, `D-022`).
pub fn library_path_for_windows(appdata: Option<&OsStr>) -> Option<PathBuf> {
    appdata
        .filter(|a| !a.is_empty())
        .map(|a| PathBuf::from(a).join("mathslot").join("library.json"))
}

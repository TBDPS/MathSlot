#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

fn main() {
    if let Err(err) = mathslot_desktop_lib::run() {
        eprintln!("mathslot-desktop fatal error: {err}");
        std::process::exit(1);
    }
}

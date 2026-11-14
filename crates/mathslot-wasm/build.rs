use std::env;
use std::fs;
use std::path::PathBuf;

fn minify_json(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_string = false;
    let mut escaped = false;

    for ch in input.chars() {
        if in_string {
            out.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
        } else if ch == '"' {
            in_string = true;
            out.push(ch);
        } else if !ch.is_ascii_whitespace() {
            out.push(ch);
        }
    }
    out
}

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let presets_path = manifest_dir.join("../../catalog/presets.json");
    println!("cargo:rerun-if-changed={}", presets_path.display());

    let raw = fs::read_to_string(&presets_path).expect("read catalog/presets.json");
    let minified = minify_json(&raw);

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    fs::write(out_dir.join("presets.min.json"), minified).expect("write presets.min.json");
}

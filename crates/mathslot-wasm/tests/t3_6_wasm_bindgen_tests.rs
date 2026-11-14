use mathslot_command::generated::GENERATED_COMMANDS;
use mathslot_wasm::WasmEngine;
use serde_json::Value;

#[test]
fn d120_wasm_engine_version_handshake_and_dispatch_contract() {
    let version = WasmEngine::engine_version();
    assert_eq!(
        version,
        concat!(env!("CARGO_PKG_VERSION"), "+schema1"),
        "engine_version must match <pkg_version>+schema<schema>"
    );

    let mut engine = WasmEngine::new();
    let snap_raw = engine.snapshot_json().expect("initial snapshot_json");
    let snap: Value = serde_json::from_str(&snap_raw).expect("valid snapshot JSON");
    assert_eq!(snap["latex"], "");

    for ch in ['▸', 'f', '1', ';', '2', ';'] {
        let evt = serde_json::json!({ "KeyInput": ch }).to_string();
        engine.dispatch_json(&evt).expect("dispatch KeyInput");
    }

    let after_raw = engine.snapshot_json().expect("snapshot_json after input");
    let after: Value = serde_json::from_str(&after_raw).expect("valid snapshot JSON");
    assert_eq!(after["latex"], r"\frac{1}{2}");

    // Error-level LaTeX import must block overwrite via mathslot-app
    let bad_import = serde_json::json!({ "ImportLatex": r"{1 + 2" }).to_string();
    let import_raw = engine
        .dispatch_json(&bad_import)
        .expect("dispatch ImportLatex");
    let import_resp: Value = serde_json::from_str(&import_raw).expect("valid dispatch response");
    assert_eq!(import_resp["snapshot"]["latex"], r"\frac{1}{2}");
    assert_eq!(import_resp["snapshot"]["last_import"]["blocked"], true);

    // Delimiter formatting helper
    assert_eq!(
        engine.wrap_latex(r"\frac{1}{2}", "inline_dollar"),
        r"$\frac{1}{2}$"
    );
    assert_eq!(
        engine.wrap_latex(r"\frac{1}{2}", "block_dollar"),
        "$$\n\\frac{1}{2}\n$$"
    );
}

#[test]
fn d120_wasm_engine_catalog_and_presets_are_single_source_of_truth() {
    let engine = WasmEngine::new();

    let catalog_raw = engine.catalog_json_str().expect("catalog_json_str");
    let catalog: Value = serde_json::from_str(&catalog_raw).expect("valid catalog JSON");
    let commands = catalog["commands"]
        .as_array()
        .expect("catalog.commands must be array");
    assert_eq!(
        commands.len(),
        GENERATED_COMMANDS.len(),
        "WASM catalog must match single-source GENERATED_COMMANDS count"
    );
    assert_eq!(commands.len(), 121);

    let presets_raw = engine.presets_json_str().expect("presets_json_str");
    let presets_val: Value = serde_json::from_str(&presets_raw).expect("valid presets JSON");
    let presets = presets_val["presets"]
        .as_array()
        .expect("presets.presets must be array");
    assert_eq!(presets.len(), 88, "WASM presets must expose all 88 presets");
}

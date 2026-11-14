#![forbid(unsafe_code)]

use mathslot_app::snapshot::DelimiterStyle;
use mathslot_app::{App, AppEvent};
use mathslot_command::generated::GENERATED_COMMANDS;
use serde::Serialize;
use wasm_bindgen::prelude::*;

pub const ENGINE_CONTRACT_SCHEMA: u32 = 1;
const PRESETS_JSON: &str = include_str!("../../../catalog/presets.json");

#[derive(Serialize)]
struct CommandDto<'a> {
    id: &'a str,
    keys: &'a [&'a str],
    label: &'a str,
    category: &'a str,
    glyph: &'a str,
    slots: &'a [&'a str],
    latex: &'a str,
    doc: &'a str,
    examples: &'a [&'a str],
    is_default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    wrap_body_slot: Option<usize>,
}

#[derive(Serialize)]
struct CatalogDto<'a> {
    schema_version: u32,
    commands: Vec<CommandDto<'a>>,
}

#[wasm_bindgen]
pub struct Engine {
    app: App,
}

pub type WasmEngine = Engine;

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    /// Pure Rust dispatch helper (safe to call on host targets without JsValue).
    pub fn dispatch_json(&mut self, event_json: &str) -> Result<String, String> {
        let event: AppEvent = serde_json::from_str(event_json)
            .map_err(|err| format!("Invalid AppEvent JSON: {err}"))?;
        let response = self.app.dispatch_snapshot(event);
        serde_json::to_string(&response)
            .map_err(|err| format!("Failed to serialize DispatchResponse: {err}"))
    }

    /// Pure Rust snapshot helper (safe to call on host targets without JsValue).
    pub fn snapshot_json(&self) -> Result<String, String> {
        let snapshot = self.app.snapshot();
        serde_json::to_string(&snapshot)
            .map_err(|err| format!("Failed to serialize EngineSnapshot: {err}"))
    }

    /// Single-source command catalog JSON derived from `mathslot-command::generated`.
    pub fn catalog_json_str(&self) -> Result<String, String> {
        let commands = GENERATED_COMMANDS
            .iter()
            .map(|cmd| CommandDto {
                id: cmd.id,
                keys: cmd.keys,
                label: cmd.label,
                category: cmd.category,
                glyph: cmd.glyph,
                slots: cmd.slots,
                latex: cmd.latex,
                doc: cmd.doc,
                examples: cmd.examples,
                is_default: cmd.is_default,
                wrap_body_slot: cmd.wrap_body_slot,
            })
            .collect();
        let payload = CatalogDto {
            schema_version: ENGINE_CONTRACT_SCHEMA,
            commands,
        };
        serde_json::to_string(&payload)
            .map_err(|err| format!("Failed to serialize command catalog: {err}"))
    }

    /// Single-source presets JSON embedded from `catalog/presets.json`.
    pub fn presets_json_str(&self) -> Result<String, String> {
        let parsed: serde_json::Value = serde_json::from_str(PRESETS_JSON)
            .map_err(|err| format!("Embedded presets.json is invalid: {err}"))?;
        serde_json::to_string(&parsed)
            .map_err(|err| format!("Failed to serialize presets JSON: {err}"))
    }
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self { app: App::new() }
    }

    pub fn dispatch(&mut self, event_json: &str) -> Result<String, JsValue> {
        self.dispatch_json(event_json)
            .map_err(|msg| JsValue::from_str(&msg))
    }

    pub fn snapshot(&self) -> Result<String, JsValue> {
        self.snapshot_json().map_err(|msg| JsValue::from_str(&msg))
    }

    #[wasm_bindgen(js_name = catalogJson)]
    pub fn catalog_json(&self) -> Result<String, JsValue> {
        self.catalog_json_str()
            .map_err(|msg| JsValue::from_str(&msg))
    }

    #[wasm_bindgen(js_name = presetsJson)]
    pub fn presets_json(&self) -> Result<String, JsValue> {
        self.presets_json_str()
            .map_err(|msg| JsValue::from_str(&msg))
    }

    #[wasm_bindgen(js_name = wrapLatex)]
    #[must_use]
    pub fn wrap_latex(&self, latex: &str, style: &str) -> String {
        let delimiter = match style.trim().to_ascii_lowercase().as_str() {
            "inline" | "inline_dollar" => DelimiterStyle::InlineDollar,
            "display" | "block" | "block_dollar" => DelimiterStyle::BlockDollar,
            "markdown_code" | "code_fence" => DelimiterStyle::CodeFence,
            _ => DelimiterStyle::None,
        };
        delimiter.format_latex(latex)
    }

    #[wasm_bindgen(js_name = engineVersion)]
    #[must_use]
    pub fn engine_version() -> String {
        format!(
            "{}+schema{ENGINE_CONTRACT_SCHEMA}",
            env!("CARGO_PKG_VERSION")
        )
    }
}

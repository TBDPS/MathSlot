use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

const PRESETS_JSON: &str = include_str!("../../../catalog/presets.json");

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogPreset {
    pub id: String,
    pub legacy_id: String,
    pub category: String,
    pub name: String,
    pub source: String,
    pub desc: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Deserialize)]
struct CatalogFile {
    schema_version: u32,
    presets: Vec<CatalogPreset>,
}

#[derive(Clone, Debug)]
pub struct Catalog {
    presets: Vec<CatalogPreset>,
}

impl Catalog {
    pub fn builtin() -> &'static Catalog {
        static BUILTIN: OnceLock<Catalog> = OnceLock::new();
        BUILTIN.get_or_init(|| {
            let parsed: CatalogFile = serde_json::from_str(PRESETS_JSON)
                .unwrap_or_else(|e| panic!("embedded catalog/presets.json must be valid: {e}"));
            assert_eq!(
                parsed.schema_version, 1,
                "embedded catalog/presets.json must have schema_version 1"
            );
            Catalog {
                presets: parsed.presets,
            }
        })
    }

    pub fn presets(&self) -> &[CatalogPreset] {
        &self.presets
    }

    pub fn find_by_id(&self, id: &str) -> Option<&CatalogPreset> {
        self.presets.iter().find(|p| p.id == id)
    }

    pub fn find_by_legacy_id(&self, legacy_id: &str) -> Option<&CatalogPreset> {
        self.presets.iter().find(|p| p.legacy_id == legacy_id)
    }

    pub fn resolve_preset_id<'a>(&'a self, id: &str) -> Option<&'a str> {
        self.find_by_id(id)
            .or_else(|| self.find_by_legacy_id(id))
            .map(|p| p.id.as_str())
    }
}

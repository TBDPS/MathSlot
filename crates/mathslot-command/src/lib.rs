pub mod generated;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

pub const ALLOWED_CATEGORIES: &[&str] = &[
    "structure",
    "calculus",
    "matrix",
    "accent",
    "greek",
    "symbol",
    "relation",
    "setlogic",
];

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("TOML parse error: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("Validation error: {0}")]
    Validation(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandEntry {
    pub id: String,
    pub keys: Vec<String>,
    pub label: String,
    pub category: String,
    pub glyph: String,
    #[serde(default)]
    pub slots: Vec<String>,
    pub latex: String,
    pub doc: String,
    pub examples: Vec<String>,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub wrap_body_slot: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct CommandCatalog {
    #[serde(default)]
    pub commands: Vec<CommandEntry>,
}

impl CommandCatalog {
    pub fn from_toml(toml_str: &str) -> Result<Self, CatalogError> {
        let catalog: Self = toml::from_str(toml_str)?;
        catalog.validate()?;
        Ok(catalog)
    }

    pub fn load_file<P: AsRef<Path>>(path: P) -> Result<Self, CatalogError> {
        let content = std::fs::read_to_string(path)?;
        Self::from_toml(&content)
    }

    pub fn validate(&self) -> Result<(), CatalogError> {
        if self.commands.is_empty() {
            return Err(CatalogError::Validation("catalog is empty".into()));
        }

        let mut seen_ids = HashSet::new();
        let mut seen_keys = HashSet::new();

        for cmd in &self.commands {
            // ID validation
            if cmd.id.trim().is_empty() {
                return Err(CatalogError::Validation(
                    "command id cannot be empty".into(),
                ));
            }
            if !cmd
                .id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
            {
                return Err(CatalogError::Validation(format!(
                    "command id '{}' contains invalid characters; must match ^[a-z0-9_-]+$",
                    cmd.id
                )));
            }
            if !seen_ids.insert(&cmd.id) {
                return Err(CatalogError::Validation(format!(
                    "duplicate command id: '{}'",
                    cmd.id
                )));
            }

            // Keys validation
            if cmd.keys.is_empty() {
                return Err(CatalogError::Validation(format!(
                    "command '{}' has empty keys sequence",
                    cmd.id
                )));
            }
            for k in &cmd.keys {
                if k.is_empty() {
                    return Err(CatalogError::Validation(format!(
                        "command '{}' has empty key element",
                        cmd.id
                    )));
                }
            }
            let key_str = cmd.keys.join("\0");
            if !seen_keys.insert(key_str) {
                return Err(CatalogError::Validation(format!(
                    "duplicate keys sequence {:?} for command '{}'",
                    cmd.keys, cmd.id
                )));
            }

            // Required fields non-empty
            if cmd.label.trim().is_empty() {
                return Err(CatalogError::Validation(format!(
                    "command '{}' has empty label",
                    cmd.id
                )));
            }
            if cmd.category.trim().is_empty() {
                return Err(CatalogError::Validation(format!(
                    "command '{}' has empty category",
                    cmd.id
                )));
            }
            if !ALLOWED_CATEGORIES.contains(&cmd.category.as_str()) {
                return Err(CatalogError::Validation(format!(
                    "command '{}' has unknown category '{}'",
                    cmd.id, cmd.category
                )));
            }
            if cmd.glyph.trim().is_empty() {
                return Err(CatalogError::Validation(format!(
                    "command '{}' has empty glyph",
                    cmd.id
                )));
            }
            if cmd.latex.trim().is_empty() {
                return Err(CatalogError::Validation(format!(
                    "command '{}' has empty latex template",
                    cmd.id
                )));
            }
            if cmd.doc.trim().is_empty() {
                return Err(CatalogError::Validation(format!(
                    "command '{}' has empty doc",
                    cmd.id
                )));
            }

            // Examples validation
            if cmd.examples.is_empty() {
                return Err(CatalogError::Validation(format!(
                    "command '{}' must have at least one example",
                    cmd.id
                )));
            }
            for ex in &cmd.examples {
                if !ex.starts_with('▸') {
                    return Err(CatalogError::Validation(format!(
                        "command '{}' example '{}' must start with '▸'",
                        cmd.id, ex
                    )));
                }
                if ex.chars().count() <= 1 {
                    return Err(CatalogError::Validation(format!(
                        "command '{}' example '{}' has no content after '▸'",
                        cmd.id, ex
                    )));
                }
            }

            // Slots and LaTeX placeholder matching
            let placeholders = extract_placeholders(&cmd.latex);
            let n_slots = cmd.slots.len();

            if n_slots == 0 {
                if !placeholders.is_empty() {
                    return Err(CatalogError::Validation(format!(
                        "command '{}' has 0 slots but latex template contains placeholders: {:?}",
                        cmd.id, placeholders
                    )));
                }
            } else {
                if placeholders.contains(&0) {
                    return Err(CatalogError::Validation(format!(
                        "command '{}' latex template contains invalid placeholder $0",
                        cmd.id
                    )));
                }
                for &p in &placeholders {
                    if p > n_slots {
                        return Err(CatalogError::Validation(format!(
                            "command '{}' latex placeholder ${} exceeds slot count {}",
                            cmd.id, p, n_slots
                        )));
                    }
                }
                for slot_idx in 1..=n_slots {
                    if !placeholders.contains(&slot_idx) {
                        return Err(CatalogError::Validation(format!(
                            "command '{}' slot {} has no placeholder ${} in latex template '{}'",
                            cmd.id, slot_idx, slot_idx, cmd.latex
                        )));
                    }
                }
            }

            // wrap_body_slot validation
            if let Some(wrap_idx) = cmd.wrap_body_slot
                && wrap_idx >= n_slots
            {
                return Err(CatalogError::Validation(format!(
                    "command '{}' wrap_body_slot {} exceeds slot count {}",
                    cmd.id, wrap_idx, n_slots
                )));
            }
        }

        // Prefix-free invariant check across all pairs
        for i in 0..self.commands.len() {
            for j in 0..self.commands.len() {
                if i != j {
                    let a = &self.commands[i];
                    let b = &self.commands[j];
                    if a.keys.len() < b.keys.len() && b.keys.starts_with(&a.keys) {
                        return Err(CatalogError::Validation(format!(
                            "prefix conflict: command '{}' keys {:?} is a prefix of command '{}' keys {:?}",
                            a.id, a.keys, b.id, b.keys
                        )));
                    }
                }
            }
        }

        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Option<&CommandEntry> {
        self.commands.iter().find(|c| c.id == id)
    }

    pub fn find_by_keys<S: AsRef<str>>(&self, keys: &[S]) -> Option<&CommandEntry> {
        self.commands.iter().find(|c| {
            if c.keys.len() != keys.len() {
                return false;
            }
            c.keys.iter().zip(keys.iter()).all(|(a, b)| a == b.as_ref())
        })
    }

    pub fn by_category(&self, category: &str) -> Vec<&CommandEntry> {
        self.commands
            .iter()
            .filter(|c| c.category == category)
            .collect()
    }

    pub fn len(&self) -> usize {
        self.commands.len()
    }

    pub fn is_empty(&self) -> bool {
        self.commands.is_empty()
    }

    pub fn iter(&self) -> std::slice::Iter<'_, CommandEntry> {
        self.commands.iter()
    }
}

impl<'a> IntoIterator for &'a CommandCatalog {
    type Item = &'a CommandEntry;
    type IntoIter = std::slice::Iter<'a, CommandEntry>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

fn extract_placeholders(latex: &str) -> Vec<usize> {
    let mut placeholders = Vec::new();
    let bytes = latex.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'$' {
            let start = i + 1;
            let mut end = start;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            if end > start {
                if let Ok(num) = latex[start..end].parse::<usize>() {
                    placeholders.push(num);
                }
                i = end;
                continue;
            }
        }
        i += 1;
    }
    placeholders
}

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

use crate::{
    AutoJoinRecord, CURRENT_LIBRARY_SCHEMA_VERSION, Catalog, CustomFormatRecord, LibraryFile,
    MigrationReport, PresetOverride, Settings, SnippetRecord, StoreError, UserFormula,
    next_uuid_v7,
};

fn is_legacy_auto_id(id: &str) -> bool {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return true;
    }
    if let Some(rest) = trimmed.strip_prefix("user-") {
        return !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit());
    }
    if let Some(rest) = trimmed.strip_prefix("imported-") {
        return !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit());
    }
    if let Some(rest) = trimmed.strip_prefix("formula-") {
        return !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit());
    }
    false
}

fn parse_u64_field(val: Option<&Value>) -> Result<Option<u64>, StoreError> {
    match val {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => {
            if let Some(u) = n.as_u64() {
                Ok(Some(u))
            } else if let Some(f) = n.as_f64()
                && f.is_finite()
                && f >= 0.0
                && f.fract() == 0.0
            {
                Ok(Some(f as u64))
            } else {
                Err(StoreError::Serialize(format!(
                    "expected non-negative integer, got {n}"
                )))
            }
        }
        Some(other) => Err(StoreError::Serialize(format!(
            "expected integer, got {other}"
        ))),
    }
}

fn parse_custom_format_value(item: &Value) -> Result<CustomFormatRecord, StoreError> {
    let obj = item
        .as_object()
        .ok_or_else(|| StoreError::Serialize("custom_formats entry must be object".to_owned()))?;
    let key_str = obj
        .get("key")
        .or_else(|| obj.get("item_key"))
        .and_then(Value::as_str)
        .ok_or_else(|| StoreError::Serialize("custom format missing string key".to_owned()))?;
    let key = key_str
        .chars()
        .next()
        .filter(|c| c.is_ascii_lowercase())
        .ok_or_else(|| StoreError::Serialize(format!("invalid custom format key `{key_str}`")))?;
    let label = obj
        .get("label")
        .or_else(|| obj.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("自定义")
        .to_owned();
    let glyph = obj
        .get("glyph")
        .or_else(|| obj.get("glyph_hint"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let latex = obj
        .get("latex")
        .or_else(|| obj.get("latex_template"))
        .and_then(Value::as_str)
        .unwrap_or("$1")
        .to_owned();
    let scheme_a = obj
        .get("schemeA")
        .or_else(|| obj.get("scheme_a_name"))
        .and_then(Value::as_str)
        .unwrap_or("custom")
        .to_owned();

    let mut roles = Vec::new();
    if let Some(roles_val) = obj.get("roles").or_else(|| obj.get("slot_roles")) {
        let arr = roles_val
            .as_array()
            .ok_or_else(|| StoreError::Serialize("roles must be array".to_owned()))?;
        for r in arr {
            let s = r
                .as_str()
                .ok_or_else(|| StoreError::Serialize("role item must be string".to_owned()))?;
            roles.push(s.to_owned());
        }
    }

    let kind = obj.get("kind").and_then(Value::as_str).map(str::to_owned);
    let env = obj.get("env").and_then(Value::as_str).map(str::to_owned);
    let cols = parse_u64_field(obj.get("cols"))?.map(|v| v as usize);

    let auto_join = if let Some(aj_val) = obj.get("autoJoin").or_else(|| obj.get("auto_join")) {
        if aj_val.is_null() {
            None
        } else {
            let aj_obj = aj_val
                .as_object()
                .ok_or_else(|| StoreError::Serialize("autoJoin must be object".to_owned()))?;
            let base = parse_u64_field(aj_obj.get("base"))?
                .ok_or_else(|| StoreError::Serialize("autoJoin missing base".to_owned()))?
                as usize;
            let cond = parse_u64_field(aj_obj.get("cond"))?
                .ok_or_else(|| StoreError::Serialize("autoJoin missing cond".to_owned()))?
                as usize;
            let macro_tex = aj_obj
                .get("macro")
                .and_then(Value::as_str)
                .ok_or_else(|| StoreError::Serialize("autoJoin missing macro".to_owned()))?
                .to_owned();
            Some(AutoJoinRecord {
                base,
                cond,
                macro_tex,
            })
        }
    } else {
        None
    };

    Ok(CustomFormatRecord {
        key,
        label,
        glyph,
        roles,
        latex,
        scheme_a,
        kind,
        env,
        cols,
        auto_join,
    })
}

fn parse_snippet_value(item: &Value) -> Result<SnippetRecord, StoreError> {
    let obj = item
        .as_object()
        .ok_or_else(|| StoreError::Serialize("snippets entry must be object".to_owned()))?;
    let key_str = obj
        .get("key")
        .or_else(|| obj.get("item_key"))
        .and_then(Value::as_str)
        .ok_or_else(|| StoreError::Serialize("snippet missing string key".to_owned()))?;
    let key = key_str
        .chars()
        .next()
        .filter(|c| c.is_ascii_lowercase())
        .ok_or_else(|| StoreError::Serialize(format!("invalid snippet key `{key_str}`")))?;
    let label = obj
        .get("label")
        .or_else(|| obj.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("片段")
        .to_owned();
    let source = obj
        .get("source")
        .or_else(|| obj.get("stream_source"))
        .and_then(Value::as_str)
        .ok_or_else(|| StoreError::Serialize("snippet missing string source".to_owned()))?
        .to_owned();

    Ok(SnippetRecord { key, label, source })
}

/// Strictly parse and dry-run migrate v1/v2/v3 JSON into a `LibraryFile` (schema v3).
pub fn dry_run_migrate(
    raw_json: &str,
    catalog: &Catalog,
) -> Result<(LibraryFile, Option<MigrationReport>), StoreError> {
    let root_val: Value =
        serde_json::from_str(raw_json).map_err(|e| StoreError::Serialize(e.to_string()))?;
    let obj = root_val
        .as_object()
        .ok_or_else(|| StoreError::Serialize("top-level JSON must be an object".to_owned()))?;

    let schema_version: u64 = match obj
        .get("schema_version")
        .or_else(|| obj.get("schemaVersion"))
    {
        None => 1,
        Some(v) => parse_u64_field(Some(v))?
            .ok_or_else(|| StoreError::Serialize("schema_version cannot be null".to_owned()))?,
    };

    match schema_version {
        3 => {
            if let Some(arr) = obj.get("user_formulas").and_then(Value::as_array) {
                for item in arr {
                    if item
                        .as_object()
                        .and_then(|m| m.get("is_builtin").or_else(|| m.get("isBuiltin")))
                        .and_then(Value::as_bool)
                        == Some(true)
                    {
                        return Err(StoreError::BuiltinImportRejected(
                            "v3 user_formulas cannot contain is_builtin: true".to_owned(),
                        ));
                    }
                }
            }
            let file: LibraryFile = serde_json::from_value(root_val)
                .map_err(|e| StoreError::Serialize(e.to_string()))?;
            Ok((file, None))
        }
        1 | 2 => migrate_v1_v2(obj, schema_version as u32, catalog).map(|(f, r)| (f, Some(r))),
        other => Err(StoreError::UnsupportedSchemaVersion(other)),
    }
}

fn is_legacy_d126_builtin_source(preset_id: &str, legacy_source: &str) -> bool {
    matches!(
        (preset_id, legacy_source),
        (
            "preset-fundamental-theorem-calculus",
            "▸ia;b;f'(x) dx = ▸kgf(x);a;b; = f(b) - f(a)",
        ) | (
            "preset-damped-harmonic-oscillator",
            "m ▸ahx; + ▸gg ▸aex; + k x = 0",
        ) | (
            "preset-hodge-star-inner-product",
            "▸ga ▸qg *▸gb = ▸kd▸ga;▸gb; ▸go",
        )
    )
}

fn migrate_v1_v2(
    obj: &serde_json::Map<String, Value>,
    from_version: u32,
    catalog: &Catalog,
) -> Result<(LibraryFile, MigrationReport), StoreError> {
    let mut custom_formats = Vec::new();
    if let Some(cf_val) = obj
        .get("customFormats")
        .or_else(|| obj.get("custom_formats"))
    {
        let arr = cf_val
            .as_array()
            .ok_or_else(|| StoreError::Serialize("customFormats must be an array".to_owned()))?;
        for item in arr {
            custom_formats.push(parse_custom_format_value(item)?);
        }
    }
    custom_formats.sort_by_key(|f| f.key);

    let mut snippets = Vec::new();
    if let Some(sn_val) = obj.get("snippets") {
        let arr = sn_val
            .as_array()
            .ok_or_else(|| StoreError::Serialize("snippets must be an array".to_owned()))?;
        for item in arr {
            snippets.push(parse_snippet_value(item)?);
        }
    }
    snippets.sort_by_key(|s| s.key);

    let mut user_formulas = Vec::new();
    let mut overrides = Vec::new();
    let mut id_migration_map = HashMap::new();
    let mut stripped_builtin_count = 0usize;
    let mut converted_override_count = 0usize;

    if let Some(f_val) = obj.get("formulas") {
        let arr = f_val
            .as_array()
            .ok_or_else(|| StoreError::Serialize("formulas must be an array".to_owned()))?;
        for item in arr {
            let entry_obj = item
                .as_object()
                .ok_or_else(|| StoreError::Serialize("formula entry must be object".to_owned()))?;
            let name = entry_obj
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_owned();
            let source = entry_obj
                .get("source")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_owned();
            if name.is_empty() || source.is_empty() {
                continue;
            }
            let raw_id = entry_obj
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_owned();
            let category = entry_obj
                .get("category")
                .and_then(Value::as_str)
                .unwrap_or("自定义公式")
                .trim()
                .to_owned();
            let desc = entry_obj
                .get("desc")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_owned();
            let mut tags = Vec::new();
            if let Some(t_val) = entry_obj.get("tags") {
                let t_arr = t_val
                    .as_array()
                    .ok_or_else(|| StoreError::Serialize("tags must be array".to_owned()))?;
                for t in t_arr {
                    let s = t
                        .as_str()
                        .ok_or_else(|| StoreError::Serialize("tag must be string".to_owned()))?;
                    tags.push(s.to_owned());
                }
            }
            let is_builtin = entry_obj
                .get("is_builtin")
                .or_else(|| entry_obj.get("isBuiltin"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let created_at = parse_u64_field(
                entry_obj
                    .get("created_at")
                    .or_else(|| entry_obj.get("createdAt")),
            )?
            .unwrap_or(0);

            if is_builtin {
                if let Some(preset) = catalog
                    .find_by_id(&raw_id)
                    .or_else(|| catalog.find_by_legacy_id(&raw_id))
                {
                    let ov = PresetOverride {
                        preset_id: preset.id.clone(),
                        hidden: false,
                        name: (name != preset.name).then_some(name),
                        category: (category != preset.category).then_some(category),
                        source: (source != preset.source
                            && !is_legacy_d126_builtin_source(&preset.id, &source))
                        .then_some(source),
                        desc: (desc != preset.desc).then_some(desc),
                        tags: (tags != preset.tags).then_some(tags),
                    };
                    if ov.name.is_some()
                        || ov.category.is_some()
                        || ov.source.is_some()
                        || ov.desc.is_some()
                        || ov.tags.is_some()
                    {
                        overrides.push(ov);
                        converted_override_count += 1;
                    } else {
                        stripped_builtin_count += 1;
                    }
                } else {
                    // Builtin flag on unknown entry: strip builtin flag and keep as user formula
                    let new_id = if is_legacy_auto_id(&raw_id) {
                        let generated = next_uuid_v7();
                        if !raw_id.is_empty() {
                            id_migration_map.insert(raw_id, generated.clone());
                        }
                        generated
                    } else {
                        raw_id
                    };
                    user_formulas.push(UserFormula {
                        id: new_id,
                        name,
                        category,
                        source,
                        desc,
                        tags,
                        created_at,
                    });
                }
            } else {
                let final_id = if is_legacy_auto_id(&raw_id) {
                    let generated = next_uuid_v7();
                    if !raw_id.is_empty() {
                        id_migration_map.insert(raw_id, generated.clone());
                    }
                    generated
                } else {
                    raw_id
                };
                user_formulas.push(UserFormula {
                    id: final_id,
                    name,
                    category,
                    source,
                    desc,
                    tags,
                    created_at,
                });
            }
        }
    }

    let settings = obj
        .get("settings")
        .cloned()
        .map(serde_json::from_value::<Settings>)
        .transpose()
        .map_err(|e| StoreError::Serialize(e.to_string()))?
        .unwrap_or_default();

    let file = LibraryFile {
        schema_version: CURRENT_LIBRARY_SCHEMA_VERSION,
        custom_formats,
        snippets,
        user_formulas,
        overrides,
        settings,
    };

    let report = MigrationReport {
        from_version,
        to_version: CURRENT_LIBRARY_SCHEMA_VERSION,
        id_migration_map,
        stripped_builtin_count,
        converted_override_count,
        backup_path: None,
    };

    Ok((file, report))
}

#[derive(Deserialize)]
struct RawImportEntry {
    #[serde(default)]
    id: String,
    name: String,
    #[serde(default = "default_custom_category")]
    category: String,
    source: String,
    #[serde(default)]
    desc: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default, alias = "isBuiltin")]
    is_builtin: bool,
    #[serde(default, alias = "createdAt")]
    created_at: u64,
}

fn default_custom_category() -> String {
    "自定义公式".to_owned()
}

/// Validates and imports formula JSON while enforcing D-014 (`is_builtin: true` cannot enter user storage).
pub fn import_formulas_json(
    raw_json: &str,
    reject_builtin: bool,
) -> Result<Vec<UserFormula>, StoreError> {
    let val: Value =
        serde_json::from_str(raw_json).map_err(|e| StoreError::Serialize(e.to_string()))?;
    let arr_val = match val {
        Value::Array(arr) => Value::Array(arr),
        Value::Object(mut map) => map
            .remove("formulas")
            .or_else(|| map.remove("user_formulas"))
            .ok_or_else(|| {
                StoreError::Serialize(
                    "import JSON must be an array or an object with formulas/user_formulas"
                        .to_owned(),
                )
            })?,
        _ => {
            return Err(StoreError::Serialize(
                "import JSON must be an array or object".to_owned(),
            ));
        }
    };

    let entries: Vec<RawImportEntry> =
        serde_json::from_value(arr_val).map_err(|e| StoreError::Serialize(e.to_string()))?;
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        if entry.is_builtin && reject_builtin {
            return Err(StoreError::BuiltinImportRejected(entry.name));
        }
        let name = entry.name.trim().to_owned();
        let source = entry.source.trim().to_owned();
        if name.is_empty() || source.is_empty() {
            continue;
        }
        let id = if entry.id.trim().is_empty() {
            next_uuid_v7()
        } else {
            entry.id.trim().to_owned()
        };
        out.push(UserFormula {
            id,
            name,
            category: if entry.category.trim().is_empty() {
                default_custom_category()
            } else {
                entry.category.trim().to_owned()
            },
            source,
            desc: entry.desc.trim().to_owned(),
            tags: entry.tags,
            created_at: entry.created_at,
        });
    }
    Ok(out)
}

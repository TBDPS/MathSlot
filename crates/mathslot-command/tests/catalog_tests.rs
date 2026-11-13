use mathslot_command::CommandCatalog;
use std::path::PathBuf;

fn get_commands_toml_path() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.join("../../catalog/commands.toml")
}

#[test]
fn test_load_all_121_commands_from_file() {
    let path = get_commands_toml_path();
    let catalog = CommandCatalog::load_file(&path)
        .unwrap_or_else(|e| panic!("Failed to load catalog at {:?}: {}", path, e));

    assert_eq!(
        catalog.len(),
        121,
        "Command catalog must contain exactly 121 commands (12 direct + 109 submenu)"
    );

    // Verify category counts: 12 + 7 + 8 + 17 + 34 + 16 + 13 + 14 = 121
    assert_eq!(catalog.by_category("structure").len(), 12);
    assert_eq!(catalog.by_category("calculus").len(), 7);
    assert_eq!(catalog.by_category("matrix").len(), 8);
    assert_eq!(catalog.by_category("accent").len(), 17);
    assert_eq!(catalog.by_category("greek").len(), 34);
    assert_eq!(catalog.by_category("symbol").len(), 16);
    assert_eq!(catalog.by_category("relation").len(), 13);
    assert_eq!(catalog.by_category("setlogic").len(), 14);

    // Verify 12 direct structures
    let direct_ids = [
        "frac", "sqrt", "nth_root", "sup", "sub", "subsup", "paren", "abs", "integral", "sum",
        "limit", "binom",
    ];
    for id in direct_ids {
        assert!(
            catalog.find_by_id(id).is_some(),
            "Missing direct structure: {id}"
        );
    }

    // Verify lookup by keys
    let frac = catalog.find_by_keys(&["f"]).expect("find frac by key");
    assert_eq!(frac.id, "frac");
    assert_eq!(frac.category, "structure");
    assert_eq!(frac.slots, vec!["分子", "分母"]);
    assert_eq!(frac.latex, "\\frac{$1}{$2}");

    let partial = catalog
        .find_by_keys(&["o", "c"])
        .expect("find partial by keys");
    assert_eq!(partial.id, "partial");
    assert_eq!(partial.category, "symbol");
    assert_eq!(partial.latex, "\\partial");
    assert!(partial.slots.is_empty());

    // Verify submenu defaults
    let default_ids = [
        "indef_integral",
        "matrix_2x2",
        "hat",
        "alpha",
        "infty",
        "equiv",
        "cup",
    ];
    for id in default_ids {
        let entry = catalog
            .find_by_id(id)
            .unwrap_or_else(|| panic!("missing {id}"));
        assert!(entry.is_default, "{id} should be marked is_default");
    }
}

#[test]
fn test_validation_rejects_duplicate_id() {
    let toml = r#"
[[commands]]
id = "frac"
keys = ["f"]
label = "分数"
category = "structure"
glyph = "a/b"
slots = ["num", "den"]
latex = "\\frac{$1}{$2}"
doc = "doc"
examples = ["▸f1;2;"]

[[commands]]
id = "frac"
keys = ["f2"]
label = "分数2"
category = "structure"
glyph = "a/b"
slots = ["num", "den"]
latex = "\\frac{$1}{$2}"
doc = "doc"
examples = ["▸f2;"]
"#;
    let res = CommandCatalog::from_toml(toml);
    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(err_str.contains("duplicate command id"));
}

#[test]
fn test_validation_rejects_duplicate_keys() {
    let toml = r#"
[[commands]]
id = "frac1"
keys = ["f"]
label = "分数1"
category = "structure"
glyph = "a/b"
slots = ["num", "den"]
latex = "\\frac{$1}{$2}"
doc = "doc"
examples = ["▸f1;2;"]

[[commands]]
id = "frac2"
keys = ["f"]
label = "分数2"
category = "structure"
glyph = "a/b"
slots = ["num", "den"]
latex = "\\frac{$1}{$2}"
doc = "doc"
examples = ["▸f1;2;"]
"#;
    let res = CommandCatalog::from_toml(toml);
    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(err_str.contains("duplicate keys sequence"));
}

#[test]
fn test_validation_rejects_prefix_collision() {
    let toml = r#"
[[commands]]
id = "cmd_a"
keys = ["o"]
label = "A"
category = "symbol"
glyph = "a"
slots = []
latex = "\\alpha"
doc = "doc"
examples = ["▸o"]

[[commands]]
id = "cmd_b"
keys = ["o", "c"]
label = "B"
category = "symbol"
glyph = "b"
slots = []
latex = "\\beta"
doc = "doc"
examples = ["▸oc"]
"#;
    let res = CommandCatalog::from_toml(toml);
    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(err_str.contains("prefix conflict"));
}

#[test]
fn test_validation_rejects_missing_example_prefix() {
    let toml = r#"
[[commands]]
id = "cmd_a"
keys = ["a"]
label = "A"
category = "symbol"
glyph = "a"
slots = []
latex = "\\alpha"
doc = "doc"
examples = ["a"]
"#;
    let res = CommandCatalog::from_toml(toml);
    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(err_str.contains("must start with '▸'"));
}

#[test]
fn test_validation_rejects_slot_placeholder_mismatch() {
    // Missing placeholder $2
    let toml = r#"
[[commands]]
id = "cmd_a"
keys = ["a"]
label = "A"
category = "structure"
glyph = "a"
slots = ["first", "second"]
latex = "\\frac{$1}{foo}"
doc = "doc"
examples = ["▸a1;"]
"#;
    let res = CommandCatalog::from_toml(toml);
    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(err_str.contains("has no placeholder $2"));
}

#[test]
fn test_validation_rejects_invalid_wrap_body_slot() {
    let toml = r#"
[[commands]]
id = "cmd_a"
keys = ["a"]
label = "A"
category = "structure"
glyph = "a"
slots = ["one"]
latex = "\\sqrt{$1}"
doc = "doc"
examples = ["▸a1;"]
wrap_body_slot = 5
"#;
    let res = CommandCatalog::from_toml(toml);
    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(err_str.contains("wrap_body_slot 5 exceeds slot count 1"));
}

#[test]
fn test_validation_rejects_unknown_category() {
    let toml = r#"
[[commands]]
id = "cmd_a"
keys = ["a"]
label = "A"
category = "magic_category"
glyph = "a"
slots = []
latex = "\\alpha"
doc = "doc"
examples = ["▸a"]
"#;
    let res = CommandCatalog::from_toml(toml);
    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(err_str.contains("unknown category 'magic_category'"));
}

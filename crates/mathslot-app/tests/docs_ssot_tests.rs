use mathslot_app::{App, AppEvent, Effect, StatusSeverity};
use mathslot_command::generated::{GENERATED_COMMANDS, find_by_keys};
use mathslot_store::{CURRENT_LIBRARY_SCHEMA_VERSION, Catalog, ShortcutSettings};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/ dir")
        .parent()
        .expect("repo root dir")
        .to_path_buf()
}

const ACTIVE_DOC_PATHS: &[&str] = &[
    "docs/commands.md",
    "README.md",
    "HELP.md",
    "obsidian-mathslot/README.md",
    "docs/ARCHITECTURE.md",
];

fn extract_triangle_tokens(content: &str) -> Vec<(usize, String)> {
    let mut found = Vec::new();
    for (line_idx, line) in content.lines().enumerate() {
        let mut rest = line;
        while let Some(pos) = rest.find('▸') {
            let after = &rest[pos + '▸'.len_utf8()..];
            let ident: String = after
                .chars()
                .take_while(|c| c.is_ascii_alphabetic())
                .collect();
            if !ident.is_empty() {
                found.push((line_idx + 1, ident));
            }
            rest = after;
        }
    }
    found
}

fn resolve_triangle_command(
    ident: &str,
) -> Option<&'static mathslot_command::generated::StaticCommand> {
    let mut chars = ident.chars();
    let c1 = chars.next()?;
    let k1 = c1.to_string();
    if let Some(cmd) = find_by_keys(&[k1.as_str()]) {
        return Some(cmd);
    }

    let has_two_key_prefix = GENERATED_COMMANDS
        .iter()
        .any(|cmd| cmd.keys.len() > 1 && cmd.keys[0] == k1);
    if has_two_key_prefix && let Some(c2) = chars.next() {
        let k2 = c2.to_string();
        return find_by_keys(&[k1.as_str(), k2.as_str()]);
    }
    None
}

fn extract_markdown_relative_links(content: &str) -> Vec<(usize, String)> {
    let mut links = Vec::new();
    for (line_idx, line) in content.lines().enumerate() {
        let bytes = line.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b']' && i + 1 < bytes.len() && bytes[i + 1] == b'(' {
                // Ignore image badges/external links handled below, check matching '('..')'
                let start = i + 2;
                let mut depth = 1usize;
                let mut j = start;
                while j < bytes.len() && depth > 0 {
                    if bytes[j] == b'(' {
                        depth += 1;
                    } else if bytes[j] == b')' {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    j += 1;
                }
                if depth == 0 {
                    let target = line[start..j].trim();
                    let target_path = target.split_whitespace().next().unwrap_or("");
                    if !target_path.is_empty()
                        && !target_path.starts_with("http://")
                        && !target_path.starts_with("https://")
                        && !target_path.starts_with("mailto:")
                        && !target_path.starts_with('#')
                    {
                        links.push((line_idx + 1, target_path.to_string()));
                    }
                    i = j + 1;
                    continue;
                }
            }
            i += 1;
        }
    }
    links
}

#[test]
fn test_active_docs_all_command_tokens_parse_and_cover_121() {
    let root = workspace_root();
    assert_eq!(GENERATED_COMMANDS.len(), 121);

    let mut invalid_tokens = Vec::new();
    let mut unique_bare_tokens = BTreeSet::new();

    for rel_path in ACTIVE_DOC_PATHS {
        let full_path = root.join(rel_path);
        assert!(
            full_path.exists(),
            "Active document '{}' must exist",
            rel_path
        );
        let content = std::fs::read_to_string(&full_path)
            .unwrap_or_else(|e| panic!("Failed to read '{}': {e}", rel_path));

        let tokens = extract_triangle_tokens(&content);
        let mut covered_ids = BTreeSet::new();

        for (line_no, ident) in &tokens {
            // Allow generic placeholder syntax illustration `▸xx` only in prose if ever needed?
            // No: spec §8.3 requires EVERY `▸<ident>` in active docs to resolve to CommandCatalog!
            match resolve_triangle_command(ident) {
                Some(cmd) => {
                    covered_ids.insert(cmd.id);
                    unique_bare_tokens.insert(format!("▸{}", cmd.keys.join("")));
                }
                None => {
                    invalid_tokens.push(format!("{rel_path}:{line_no}: unknown token '▸{ident}'"));
                }
            }
        }

        // docs/commands.md, README.md, and HELP.md must cover all 121 catalog commands
        if matches!(*rel_path, "docs/commands.md" | "README.md" | "HELP.md") {
            let missing: Vec<&str> = GENERATED_COMMANDS
                .iter()
                .map(|c| c.id)
                .filter(|id| !covered_ids.contains(id))
                .collect();
            assert!(
                missing.is_empty(),
                "{} does not cover all 121 commands; missing ({}): {:?}",
                rel_path,
                missing.len(),
                missing
            );
        }
    }

    assert!(
        invalid_tokens.is_empty(),
        "Active docs contain phantom/unknown ▸ command tokens (D-162/D-165):\n{}",
        invalid_tokens.join("\n")
    );

    // Every catalog command token (`▸<keys>`) and example must parse cleanly via mathslot_syntax::parse
    // and expand without stream errors via mathslot_app::App.
    for cmd in GENERATED_COMMANDS {
        let bare_token = format!("▸{}", cmd.keys.join(""));
        let (_ast, diags) = mathslot_syntax::parse(&bare_token);
        assert!(
            diags.is_empty(),
            "mathslot_syntax::parse('{bare_token}') for '{}' produced diagnostics: {diags:?}",
            cmd.id
        );

        for example in cmd.examples {
            let (_ex_ast, ex_diags) = mathslot_syntax::parse(example);
            assert!(
                ex_diags.is_empty(),
                "mathslot_syntax::parse('{example}') for '{}' produced diagnostics: {ex_diags:?}",
                cmd.id
            );

            let mut app = App::new();
            let resp = app.dispatch_snapshot(AppEvent::LoadStreamSource((*example).to_string()));
            let stream_errs: Vec<String> = resp
                .effects
                .iter()
                .filter_map(|e| match e {
                    Effect::Status(msg)
                        if msg.severity == StatusSeverity::Error
                            && msg.message.contains("Unknown or incomplete stream command") =>
                    {
                        Some(msg.message.clone())
                    }
                    _ => None,
                })
                .collect();
            assert!(
                stream_errs.is_empty(),
                "LoadStreamSource('{example}') for '{}' failed: {:?}",
                cmd.id,
                stream_errs
            );
            let diag_stream_errs: Vec<_> = resp
                .snapshot
                .diagnostics
                .iter()
                .filter(|d| d.code == "PENDING_COMMAND" || d.code == "UNKNOWN_COMMAND")
                .collect();
            assert!(
                diag_stream_errs.is_empty(),
                "LoadStreamSource('{example}') for '{}' produced stream diagnostics: {:?}",
                cmd.id,
                diag_stream_errs
            );
            assert!(
                !resp.snapshot.latex.contains('▸') && !resp.snapshot.latex.contains(r"\text{▸"),
                "LoadStreamSource('{example}') for '{}' leaked '▸' in latex: {}",
                cmd.id,
                resp.snapshot.latex
            );
            assert!(
                !resp.snapshot.latex.trim().is_empty(),
                "LoadStreamSource('{example}') for '{}' expanded to empty latex",
                cmd.id
            );
        }
    }

    assert_eq!(unique_bare_tokens.len(), 121);
}

#[test]
fn test_active_docs_relative_links_exist() {
    let root = workspace_root();
    let mut dead_links = Vec::new();

    for rel_path in ACTIVE_DOC_PATHS {
        let full_path = root.join(rel_path);
        assert!(
            full_path.exists(),
            "Active document '{}' must exist",
            rel_path
        );
        let base_dir = full_path.parent().unwrap_or_else(|| Path::new(""));
        let content = std::fs::read_to_string(&full_path).unwrap();

        for (line_no, target) in extract_markdown_relative_links(&content) {
            let without_fragment = target.split('#').next().unwrap_or("");
            if without_fragment.is_empty() {
                continue;
            }
            let resolved = base_dir.join(without_fragment);
            if !resolved.exists() {
                dead_links.push(format!(
                    "{rel_path}:{line_no}: dead relative link '({target})' -> '{}'",
                    resolved.display()
                ));
            }
        }
    }

    assert!(
        dead_links.is_empty(),
        "Active docs contain dead relative links (D-163/D-165):\n{}",
        dead_links.join("\n")
    );
}

#[test]
fn test_metadata_and_shortcuts_ssot_parity_in_docs() {
    let root = workspace_root();
    let catalog = Catalog::builtin();
    let preset_count = catalog.presets().len();
    assert_eq!(preset_count, 88);
    assert_eq!(CURRENT_LIBRARY_SCHEMA_VERSION, 3);

    let manifest_raw = std::fs::read_to_string(root.join("obsidian-mathslot/manifest.json"))
        .expect("read obsidian-mathslot/manifest.json");
    let manifest_json: serde_json::Value =
        serde_json::from_str(&manifest_raw).expect("parse manifest.json");
    let plugin_version = manifest_json["version"]
        .as_str()
        .expect("manifest.json version");

    let shortcuts = ShortcutSettings::default();

    for rel_path in ["README.md", "HELP.md"] {
        let content = std::fs::read_to_string(root.join(rel_path))
            .unwrap_or_else(|e| panic!("Failed to read '{}': {e}", rel_path));
        assert!(
            content.contains(&format!("`{}`", GENERATED_COMMANDS.len())),
            "{} must state command count {}",
            rel_path,
            GENERATED_COMMANDS.len()
        );
        assert!(
            content.contains(&format!("`{preset_count}`")),
            "{} must state preset count {}",
            rel_path,
            preset_count
        );
        assert!(
            content.contains(&format!(
                "schema_version = {CURRENT_LIBRARY_SCHEMA_VERSION}"
            )),
            "{} must state schema_version = {}",
            rel_path,
            CURRENT_LIBRARY_SCHEMA_VERSION
        );
        for shortcut in [
            &shortcuts.toggle_nav,
            &shortcuts.focus_editor,
            &shortcuts.open_settings,
            &shortcuts.copy_latex,
            &shortcuts.save_snippet,
        ] {
            assert!(
                content.contains(shortcut),
                "{} must document default shortcut '{}'",
                rel_path,
                shortcut
            );
        }
    }

    let obs_readme = std::fs::read_to_string(root.join("obsidian-mathslot/README.md"))
        .expect("read obsidian-mathslot/README.md");
    assert!(
        obs_readme.contains(plugin_version),
        "obsidian-mathslot/README.md must contain manifest version '{}'",
        plugin_version
    );
}

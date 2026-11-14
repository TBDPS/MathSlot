mod codegen;

use mathslot_command::CommandCatalog;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

struct Artifact {
    rel_path: &'static str,
    content: String,
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("parent of xtask is workspace root")
        .to_path_buf()
}

fn generate_artifacts(root: &Path) -> Result<Vec<Artifact>, Box<dyn std::error::Error>> {
    let toml_path = root.join("catalog/commands.toml");
    let catalog = CommandCatalog::load_file(&toml_path)?;

    let presets_path = root.join("catalog/presets.json");
    let presets_raw = fs::read_to_string(&presets_path)?;
    let presets_file: codegen::PresetsFile = serde_json::from_str(&presets_raw)?;
    let presets_ts = codegen::generate_presets_typescript(&presets_file)?;

    let meta = codegen::load_workspace_metadata(root)?;
    let metadata_std = codegen::render_metadata_block(&meta, &catalog, &presets_file, false);
    let metadata_arch = codegen::render_metadata_block(&meta, &catalog, &presets_file, true);
    let readme_commands = codegen::render_readme_commands_block(&catalog);
    let help_commands = codegen::render_help_commands_block(&catalog);
    let presets_block = codegen::render_presets_block(&presets_file);
    let shortcuts_block = codegen::render_shortcuts_block(&meta);

    let mut artifacts = vec![
        Artifact {
            rel_path: "crates/mathslot-command/src/generated.rs",
            content: codegen::generate_rust(&catalog),
        },
        Artifact {
            rel_path: "catalog/catalog.json",
            content: codegen::generate_json(&catalog),
        },
        Artifact {
            rel_path: "docs/commands.md",
            content: codegen::generate_markdown(&catalog),
        },
        Artifact {
            rel_path: "packages/ui/src/generated/catalog.ts",
            content: codegen::generate_typescript(&catalog),
        },
        Artifact {
            rel_path: "packages/ui/src/generated/presets.ts",
            content: presets_ts,
        },
        Artifact {
            rel_path: "schemas/commands.schema.json",
            content: codegen::generate_schema(),
        },
    ];

    let doc_specs: [(&str, Vec<(&str, String)>); 4] = [
        (
            "README.md",
            vec![
                ("metadata", metadata_std.clone()),
                ("commands", readme_commands),
                ("presets", presets_block.clone()),
                ("shortcuts", shortcuts_block.clone()),
            ],
        ),
        (
            "HELP.md",
            vec![
                ("metadata", metadata_std.clone()),
                ("commands", help_commands),
                ("presets", presets_block),
                ("shortcuts", shortcuts_block.clone()),
            ],
        ),
        (
            "obsidian-mathslot/README.md",
            vec![("metadata", metadata_std), ("shortcuts", shortcuts_block)],
        ),
        ("docs/ARCHITECTURE.md", vec![("metadata", metadata_arch)]),
    ];

    for (rel_path, blocks) in doc_specs {
        let full_path = root.join(rel_path);
        let existing = fs::read_to_string(&full_path)
            .map_err(|e| format!("Failed to read managed document '{rel_path}': {e}"))?;
        let injected = codegen::inject_generated_blocks(rel_path, &existing, &blocks)?;
        artifacts.push(Artifact {
            rel_path,
            content: injected,
        });
    }

    Ok(artifacts)
}

fn cmd_generate(root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let artifacts = generate_artifacts(root)?;
    let count = artifacts.len();
    for art in artifacts {
        let target_path = root.join(art.rel_path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target_path, &art.content)?;
        println!("[xtask] Generated: {}", art.rel_path);
    }
    println!("[xtask] All {count} artifacts generated successfully.");
    Ok(())
}

fn cmd_check(root: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    let artifacts = generate_artifacts(root)?;
    let count = artifacts.len();
    let mut has_diff = false;

    for art in artifacts {
        let target_path = root.join(art.rel_path);
        if !target_path.exists() {
            eprintln!(
                "[xtask] Error: File '{}' is missing on disk. Run 'cargo run -p xtask -- generate'.",
                art.rel_path
            );
            has_diff = true;
            continue;
        }

        let disk_content = fs::read_to_string(&target_path)?;
        if disk_content != art.content {
            eprintln!(
                "[xtask] Error: File '{}' is out-of-date or modified. Run 'cargo run -p xtask -- generate'.",
                art.rel_path
            );
            has_diff = true;
        }
    }

    if has_diff {
        Ok(false)
    } else {
        println!("[xtask] Check PASSED: All {count} artifacts are up-to-date and clean.");
        Ok(true)
    }
}

fn main() -> ExitCode {
    let root = workspace_root();
    let args: Vec<String> = env::args().collect();
    let cmd = args.get(1).map(String::as_str).unwrap_or("help");

    match cmd {
        "generate" | "codegen" => {
            if let Err(e) = cmd_generate(&root) {
                eprintln!("[xtask] Error during generate: {}", e);
                ExitCode::FAILURE
            } else {
                ExitCode::SUCCESS
            }
        }
        "check" => match cmd_check(&root) {
            Ok(true) => ExitCode::SUCCESS,
            Ok(false) => ExitCode::FAILURE,
            Err(e) => {
                eprintln!("[xtask] Error during check: {}", e);
                ExitCode::FAILURE
            }
        },
        _ => {
            eprintln!("Usage: cargo run -p xtask -- <command>");
            eprintln!("Commands:");
            eprintln!("  generate (or codegen)  Generate all 6 artifacts and update 4 active docs");
            eprintln!(
                "  check                  Check if generated artifacts and doc blocks are up-to-date"
            );
            ExitCode::FAILURE
        }
    }
}

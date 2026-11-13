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

    Ok(vec![
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
            rel_path: "schemas/commands.schema.json",
            content: codegen::generate_schema(),
        },
    ])
}

fn cmd_generate(root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let artifacts = generate_artifacts(root)?;
    for art in artifacts {
        let target_path = root.join(art.rel_path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target_path, &art.content)?;
        println!("[xtask] Generated: {}", art.rel_path);
    }
    println!("[xtask] All 5 artifacts generated successfully.");
    Ok(())
}

fn cmd_check(root: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    let artifacts = generate_artifacts(root)?;
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
        println!("[xtask] Check PASSED: All 5 artifacts are up-to-date and clean.");
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
            eprintln!("  generate (or codegen)  Generate all 5 catalog artifacts");
            eprintln!("  check                  Check if generated artifacts are up-to-date");
            ExitCode::FAILURE
        }
    }
}

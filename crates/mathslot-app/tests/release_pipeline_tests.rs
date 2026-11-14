use std::path::PathBuf;

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/ dir")
        .parent()
        .expect("repo root dir")
        .to_path_buf()
}

fn read_repo_file(rel: &str) -> String {
    let path = workspace_root().join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "Expected '{}' to exist and be readable: {e}",
            path.display()
        )
    })
}

#[test]
fn d167_ci_three_platform_matrix_and_release_preflight_with_sha256() {
    let root = workspace_root();
    let ci_yml = read_repo_file(".github/workflows/ci.yml");

    // 3-platform CI matrix per §13.4 / §16.2
    for runner in ["ubuntu-24.04", "windows-latest", "macos-latest"] {
        assert!(
            ci_yml.contains(runner),
            "ci.yml must include matrix runner '{runner}' (D-167)"
        );
    }
    assert!(
        ci_yml.contains("cargo test -p mathslot-desktop --locked"),
        "ci.yml must run mathslot-desktop tests across matrix"
    );
    assert!(
        ci_yml.contains("scripts/verify-release-versions.mjs"),
        "ci.yml must run scripts/verify-release-versions.mjs"
    );

    let release_yml = read_repo_file(".github/workflows/release.yml");
    assert!(
        release_yml.contains("preflight:"),
        "release.yml must define a preflight gate job (D-167)"
    );
    assert!(
        release_yml.contains("needs: preflight")
            || release_yml.contains("needs:\n      - preflight"),
        "release.yml build jobs must depend on preflight (D-167)"
    );
    for required_gate in [
        "verify-release-versions.mjs",
        "cargo fmt --check",
        "cargo clippy --workspace --all-targets -- -D warnings",
        "cargo test --workspace --locked",
        "cargo run --locked -p xtask -- check",
        "cargo run --locked -p xtask -- generate",
        "git diff --exit-code",
        "bench-budgets.mjs",
        "SHA256SUMS.txt",
        "sha256sum",
    ] {
        assert!(
            release_yml.contains(required_gate),
            "release.yml must enforce '{required_gate}' (D-167)"
        );
    }

    let version_script = root.join("scripts/verify-release-versions.mjs");
    assert!(
        version_script.exists(),
        "scripts/verify-release-versions.mjs must exist (D-167/D-170)"
    );
    let version_script_src = read_repo_file("scripts/verify-release-versions.mjs");
    for checked_file in [
        "Cargo.toml",
        "apps/desktop/src-tauri/tauri.conf.json",
        "apps/desktop/package.json",
        "apps/obsidian/package.json",
        "apps/obsidian/manifest.json",
        "obsidian-mathslot/package.json",
        "obsidian-mathslot/manifest.json",
        "apps/obsidian/src/wasmClient.ts",
        "obsidian-mathslot/scripts/build.mjs",
    ] {
        assert!(
            version_script_src.contains(checked_file),
            "verify-release-versions.mjs must validate '{checked_file}'"
        );
    }
}

#[test]
fn d168_tauri2_desktop_packaging_install_script_desktop_entry_and_icons() {
    let root = workspace_root();
    let release_yml = read_repo_file(".github/workflows/release.yml");

    assert!(
        !release_yml.contains("--bin mathslot "),
        "release.yml must stop building/distributing frozen egui binary 'mathslot' (D-168)"
    );
    assert!(
        !release_yml.contains("target/release/mathslot "),
        "release.yml must not package frozen egui 'target/release/mathslot' (D-168)"
    );
    assert!(
        !release_yml.contains("target/release/mathslot.exe"),
        "release.yml must not package frozen egui 'target/release/mathslot.exe' (D-168)"
    );
    assert!(
        release_yml.contains("mathslot-desktop"),
        "release.yml must build and package mathslot-desktop (Tauri 2)"
    );
    assert!(
        release_yml.contains("cargo test -p mathslot-desktop --locked"),
        "release.yml must run cargo test -p mathslot-desktop --locked (D-170)"
    );
    for mac_target in ["aarch64-apple-darwin", "x86_64-apple-darwin"] {
        assert!(
            release_yml.contains(mac_target),
            "release.yml must support macOS target '{mac_target}' (D-168)"
        );
    }
    assert!(
        release_yml.contains("tauri") && release_yml.contains("build"),
        "release.yml must invoke Tauri CLI bundler to produce native installers (D-168)"
    );

    let install_sh = read_repo_file("scripts/install-desktop.sh");
    assert!(
        install_sh.contains("target/release/mathslot-desktop"),
        "scripts/install-desktop.sh must look up target/release/mathslot-desktop (D-168)"
    );
    assert!(
        install_sh.contains("${BIN_DIR}/mathslot-desktop"),
        "scripts/install-desktop.sh must install binary as mathslot-desktop (D-168)"
    );
    assert!(
        install_sh.contains("cargo build --release -p mathslot-desktop"),
        "scripts/install-desktop.sh fallback build must target -p mathslot-desktop (D-168)"
    );

    let local_pkg_sh = root.join("scripts/package-desktop-local.sh");
    assert!(
        local_pkg_sh.exists(),
        "scripts/package-desktop-local.sh must exist for offline native bundle verification (D-168)"
    );
    let local_pkg_src = read_repo_file("scripts/package-desktop-local.sh");
    assert!(
        local_pkg_src.contains("mathslot-desktop-linux-x86_64.tar.gz")
            && local_pkg_src.contains("SHA256SUMS.txt")
            && local_pkg_src.contains("sha256sum -c"),
        "scripts/package-desktop-local.sh must build tar.gz + SHA256SUMS.txt and verify sha256sum -c"
    );

    let desktop_entry = read_repo_file("assets/mathslot.desktop");
    assert!(
        desktop_entry.contains("Exec=mathslot-desktop %U"),
        "assets/mathslot.desktop must launch mathslot-desktop (D-168)"
    );
    assert!(
        desktop_entry.contains("StartupWMClass=mathslot-desktop"),
        "assets/mathslot.desktop must use StartupWMClass=mathslot-desktop (D-168)"
    );
    assert!(
        desktop_entry.contains("Icon=mathslot"),
        "assets/mathslot.desktop must keep Icon=mathslot"
    );

    // Tauri icons must be real multi-color assets derived from assets/icons/, plus icon.icns
    let icons_dir = root.join("apps/desktop/src-tauri/icons");
    let min_sizes = [
        ("32x32.png", 500u64),
        ("128x128.png", 2_000u64),
        ("128x128@2x.png", 4_000u64),
        ("icon.ico", 1_000u64),
        ("icon.icns", 4_000u64),
    ];
    for (file, min_bytes) in min_sizes {
        let p = icons_dir.join(file);
        assert!(
            p.exists(),
            "Tauri icon '{}' must exist (D-168)",
            p.display()
        );
        let len = std::fs::metadata(&p)
            .unwrap_or_else(|e| panic!("Failed to stat '{}': {e}", p.display()))
            .len();
        assert!(
            len >= min_bytes,
            "Tauri icon '{}' is only {} bytes (< {} bytes), looks like placeholder (D-168)",
            p.display(),
            len,
            min_bytes
        );
    }

    let icns_bytes = std::fs::read(icons_dir.join("icon.icns"))
        .expect("read apps/desktop/src-tauri/icons/icon.icns");
    assert!(
        icns_bytes.starts_with(b"icns"),
        "icon.icns must begin with Apple 'icns' magic header"
    );

    let ico_bytes = std::fs::read(icons_dir.join("icon.ico"))
        .expect("read apps/desktop/src-tauri/icons/icon.ico");
    assert!(
        ico_bytes.len() >= 22 && ico_bytes[0..4] == [0, 0, 1, 0],
        "icon.ico must have valid ICO header"
    );
    let ico_count = u16::from_le_bytes([ico_bytes[4], ico_bytes[5]]);
    assert!(
        ico_count >= 3,
        "icon.ico must embed multiple icon resolutions, found {ico_count}"
    );

    let tauri_conf_raw = read_repo_file("apps/desktop/src-tauri/tauri.conf.json");
    let tauri_conf: serde_json::Value =
        serde_json::from_str(&tauri_conf_raw).expect("parse tauri.conf.json");
    let bundle_icons = tauri_conf["bundle"]["icon"]
        .as_array()
        .expect("bundle.icon array");
    assert!(
        bundle_icons
            .iter()
            .any(|v| v.as_str() == Some("icons/icon.icns")),
        "tauri.conf.json bundle.icon must register icons/icon.icns (D-168)"
    );
}

#[test]
fn d169_rollback_runbook_obsidian_readme_packaging_and_release_notes() {
    let root = workspace_root();
    let rollback_path = root.join("docs/RELEASE_ROLLBACK.md");
    assert!(
        rollback_path.exists(),
        "docs/RELEASE_ROLLBACK.md must exist for Gate G4 rollback SOP (D-169)"
    );
    let rollback_doc = read_repo_file("docs/RELEASE_ROLLBACK.md");
    for required in [
        "SHA256SUMS.txt",
        "schema_version = 3",
        "library.corrupt-",
        "gh release",
        "mathslot-desktop",
    ] {
        assert!(
            rollback_doc.contains(required),
            "docs/RELEASE_ROLLBACK.md must document '{required}'"
        );
    }

    let release_yml = read_repo_file(".github/workflows/release.yml");
    assert!(
        release_yml.contains("obsidian-mathslot/README.md"),
        "release.yml build-obsidian-plugin must package obsidian-mathslot/README.md (D-169)"
    );
    assert!(
        !release_yml.contains("cp README.md \"${PKG_NAME}/\""),
        "release.yml build-obsidian-plugin must NOT copy root README.md into obsidian plugin zip (D-169)"
    );
    assert!(
        !release_yml.contains("60+"),
        "release.yml release body must not contain stale '60+' preset count (D-169)"
    );
    assert!(
        !release_yml.contains("library.json.bak"),
        "release.yml release body must not contain stale 'library.json.bak' (D-169)"
    );
    assert!(
        !release_yml.contains("with_app_id"),
        "release.yml release body must not reference frozen egui 'with_app_id' (D-169)"
    );
    assert!(
        release_yml.contains("docs/RELEASE_ROLLBACK.md")
            && release_yml.contains("SHA256SUMS.txt")
            && release_yml.contains("schema_version = 3"),
        "release.yml release body must reference rollback runbook, SHA256SUMS.txt, and schema_version = 3"
    );

    let readme = read_repo_file("README.md");
    assert!(
        readme.contains("## 跨平台发布包"),
        "README.md must define '## 跨平台发布包' heading matching badge anchor (D-169)"
    );
    assert!(
        readme.contains("docs/RELEASE_ROLLBACK.md"),
        "README.md must link to docs/RELEASE_ROLLBACK.md (D-169)"
    );
}

#[test]
fn d170_obsidian_build_reads_manifest_version_and_release_runs_obsidian_checks() {
    let build_mjs = read_repo_file("obsidian-mathslot/scripts/build.mjs");
    assert!(
        !build_mjs.contains("const EXPECTED_ENGINE_VERSION = \"0.7.0+schema1\""),
        "obsidian-mathslot/scripts/build.mjs must derive EXPECTED_ENGINE_VERSION from manifest.json rather than hardcoding 0.7.0 (D-170)"
    );
    assert!(
        !build_mjs.contains("version: \"0.7.0\""),
        "obsidian-mathslot/scripts/build.mjs must pass manifest.version rather than hardcoded '0.7.0' (D-170)"
    );

    let release_yml = read_repo_file(".github/workflows/release.yml");
    for required in [
        "npm test --prefix apps/obsidian",
        "npm run check --prefix apps/obsidian",
        "git diff --exit-code -- obsidian-mathslot/",
    ] {
        assert!(
            release_yml.contains(required),
            "release.yml build-obsidian-plugin must run '{required}' (D-170)"
        );
    }
}

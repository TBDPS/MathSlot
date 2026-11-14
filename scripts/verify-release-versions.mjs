import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function readText(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function parseCargoWorkspaceVersion(cargoToml) {
  const sectionMatch = cargoToml.match(/\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/);
  assert.ok(sectionMatch, "Cargo.toml must contain [workspace.package]");
  const verMatch = sectionMatch[1].match(/^\s*version\s*=\s*"([^"]+)"/m);
  assert.ok(verMatch, "Cargo.toml [workspace.package] must declare version");
  return verMatch[1];
}

function parseWasmContractSchema(wasmLibRs) {
  const match = wasmLibRs.match(/pub\s+const\s+ENGINE_CONTRACT_SCHEMA\s*:\s*u32\s*=\s*(\d+)\s*;/);
  assert.ok(match, "crates/mathslot-wasm/src/lib.rs must declare ENGINE_CONTRACT_SCHEMA");
  return match[1];
}

function parseExpectedEngineVersion(wasmClientTs) {
  const match = wasmClientTs.match(
    /export\s+const\s+EXPECTED_ENGINE_VERSION\s*=\s*['"]([^'"]+)['"]\s*;/,
  );
  assert.ok(match, "apps/obsidian/src/wasmClient.ts must declare EXPECTED_ENGINE_VERSION");
  return match[1];
}

function parseTagArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tag") {
      const value = argv[i + 1];
      assert.ok(value && !value.startsWith("--"), "--tag requires a version tag value like v0.7.0");
      return value;
    }
    if (arg.startsWith("--tag=")) {
      const value = arg.slice("--tag=".length);
      assert.ok(value.length > 0, "--tag= requires a non-empty tag value");
      return value;
    }
  }
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }
  return null;
}

const cargoToml = readText("Cargo.toml");
const workspaceVersion = parseCargoWorkspaceVersion(cargoToml);
const schemaVersion = parseWasmContractSchema(readText("crates/mathslot-wasm/src/lib.rs"));
const expectedEngineVersion = `${workspaceVersion}+schema${schemaVersion}`;

const jsonChecks = [
  ["apps/desktop/src-tauri/tauri.conf.json", readJson("apps/desktop/src-tauri/tauri.conf.json").version],
  ["apps/desktop/package.json", readJson("apps/desktop/package.json").version],
  ["apps/obsidian/package.json", readJson("apps/obsidian/package.json").version],
  ["apps/obsidian/manifest.json", readJson("apps/obsidian/manifest.json").version],
  ["obsidian-mathslot/package.json", readJson("obsidian-mathslot/package.json").version],
  ["obsidian-mathslot/manifest.json", readJson("obsidian-mathslot/manifest.json").version],
];

for (const [file, actual] of jsonChecks) {
  assert.equal(
    actual,
    workspaceVersion,
    `Version mismatch in ${file}: expected "${workspaceVersion}" (Cargo.toml), got "${actual}"`,
  );
}

const clientEngineVersion = parseExpectedEngineVersion(readText("apps/obsidian/src/wasmClient.ts"));
assert.equal(
  clientEngineVersion,
  expectedEngineVersion,
  `apps/obsidian/src/wasmClient.ts EXPECTED_ENGINE_VERSION mismatch: expected "${expectedEngineVersion}", got "${clientEngineVersion}"`,
);

const buildMjs = readText("obsidian-mathslot/scripts/build.mjs");
assert.ok(
  !buildMjs.includes(`"${expectedEngineVersion}"`) && !buildMjs.includes(`'${expectedEngineVersion}'`),
  "obsidian-mathslot/scripts/build.mjs must derive EXPECTED_ENGINE_VERSION from manifest/wasmClient instead of hardcoding it",
);
assert.ok(
  buildMjs.includes("manifest.json") && buildMjs.includes("wasmClient.ts"),
  "obsidian-mathslot/scripts/build.mjs must cross-check manifest.json and wasmClient.ts",
);

const tag = parseTagArg(process.argv.slice(2));
if (tag !== null) {
  const expectedTag = `v${workspaceVersion}`;
  assert.equal(
    tag,
    expectedTag,
    `Release tag mismatch: expected "${expectedTag}" to match Cargo.toml version "${workspaceVersion}", got "${tag}"`,
  );
}

console.log(
  `✓ Release version parity verified: v${workspaceVersion} (engine ${expectedEngineVersion}${tag ? `, tag ${tag}` : ""})`,
);

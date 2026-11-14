import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..");
const appsObsidianDir = path.join(repoRoot, "apps", "obsidian");
const packagesUiDir = path.join(repoRoot, "packages", "ui");
const wasmPkgOutDir = path.join(appsObsidianDir, "src", "wasm-pkg");
const distDir = path.join(appsObsidianDir, "dist");
const wasmTargetPath = path.join(
  repoRoot,
  "target",
  "wasm32-unknown-unknown",
  "release",
  "mathslot_wasm.wasm",
);

const EXPECTED_ENGINE_VERSION = "0.7.0+schema1";

function resolveWasmBindgenBin() {
  const candidates = ["wasm-bindgen", path.join(os.homedir(), ".cargo", "bin", "wasm-bindgen")];
  for (const bin of candidates) {
    try {
      const out = execFileSync(bin, ["--version"], { encoding: "utf8" }).trim();
      return { bin, version: out };
    } catch {
      // Try next candidate.
    }
  }
  throw new Error(
    "wasm-bindgen CLI (0.2.130) not found in PATH or ~/.cargo/bin. Install via: cargo install --locked wasm-bindgen-cli --version 0.2.130",
  );
}

console.log("[1/4] Building mathslot-wasm (wasm32-unknown-unknown --release)...");
execFileSync(
  "cargo",
  ["build", "-p", "mathslot-wasm", "--target", "wasm32-unknown-unknown", "--release"],
  { cwd: repoRoot, stdio: "inherit" },
);

const rawTargetWasm = readFileSync(wasmTargetPath);
console.log(
  `      cargo release wasm size: ${(rawTargetWasm.length / 1024).toFixed(1)} KB (${rawTargetWasm.length} bytes)`,
);

const { bin: wasmBindgenBin, version: wasmBindgenVersion } = resolveWasmBindgenBin();
console.log(`[2/4] Running ${wasmBindgenVersion} (--target web) -> apps/obsidian/src/wasm-pkg...`);
mkdirSync(wasmPkgOutDir, { recursive: true });
execFileSync(
  wasmBindgenBin,
  [wasmTargetPath, "--target", "web", "--out-dir", wasmPkgOutDir, "--out-name", "mathslot_wasm"],
  { cwd: repoRoot, stdio: "inherit" },
);

const bindgenWasmPath = path.join(wasmPkgOutDir, "mathslot_wasm_bg.wasm");
const wasmBytes = readFileSync(bindgenWasmPath);
const wasmGzipBytes = gzipSync(wasmBytes);
console.log(
  `      wasm-bindgen output size: ${(wasmBytes.length / 1024).toFixed(1)} KB raw / ${(wasmGzipBytes.length / 1024).toFixed(1)} KB gzip`,
);

console.log("[3/4] Bundling apps/obsidian single-file plugin with inline base64 WASM...");
const uiNodeModules = path.join(packagesUiDir, "node_modules");
const obsidianNodeModules = path.join(appsObsidianDir, "node_modules");
assert.ok(
  existsSync(uiNodeModules),
  `Missing ${uiNodeModules}. Run npm ci --prefix packages/ui first.`,
);
if (!existsSync(obsidianNodeModules)) {
  symlinkSync(path.relative(appsObsidianDir, uiNodeModules), obsidianNodeModules, "dir");
}

const viteBin = path.join(uiNodeModules, "vite", "bin", "vite.js");
execFileSync(process.execPath, [viteBin, "build"], {
  cwd: appsObsidianDir,
  stdio: "inherit",
});

const distMainPath = path.join(distDir, "main.js");
const distStylesPath = path.join(distDir, "styles.css");
const srcManifestPath = path.join(appsObsidianDir, "manifest.json");
const bundledMainJs = readFileSync(distMainPath, "utf8");
const wasmBase64 = wasmBytes.toString("base64");
assert.ok(
  bundledMainJs.includes(wasmBase64.slice(0, 64)),
  "Embedded WASM base64 slice missing from main.js",
);

copyFileSync(srcManifestPath, path.join(distDir, "manifest.json"));
copyFileSync(distMainPath, path.join(pluginRoot, "main.js"));
copyFileSync(distStylesPath, path.join(pluginRoot, "styles.css"));
copyFileSync(srcManifestPath, path.join(pluginRoot, "manifest.json"));
console.log(
  `      Synced main.js (${(Buffer.byteLength(bundledMainJs) / 1024).toFixed(1)} KB), styles.css, manifest.json`,
);

console.log("[4/4] Running Node.js E2E smoke test on bundled plugin + wasm-bindgen Engine...");

// 4a) Load the compiled CJS main.js with a minimal Obsidian host stub
const registeredCommands = [];
const registeredProcessors = [];
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Plugin: class {
        constructor(app, manifest) {
          this.app = app;
          this.manifest = manifest;
        }
        async loadData() {
          return {};
        }
        async saveData() {}
        addRibbonIcon() {}
        addCommand(cmd) {
          registeredCommands.push(cmd.id);
        }
        registerMarkdownCodeBlockProcessor(lang) {
          registeredProcessors.push(lang);
        }
        addSettingTab() {}
      },
      Modal: class {},
      MarkdownView: class {},
      PluginSettingTab: class {},
      Setting: class {
        setName() {
          return this;
        }
        setDesc() {
          return this;
        }
        addButton() {
          return this;
        }
      },
      Notice: class {},
      Platform: { isMobile: false, isDesktop: true },
      addIcon() {},
      renderMath() {
        throw new Error("stub");
      },
      finishRenderMath: async () => {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const requireCjs = createRequire(import.meta.url);
  const pluginPath = path.join(pluginRoot, "main.js");
  delete requireCjs.cache[pluginPath];
  const PluginClass = requireCjs(pluginPath);
  assert.equal(typeof PluginClass, "function", "Default CJS export must be MathSlotPlugin class");

  const instance = new PluginClass({ workspace: {} }, { id: "mathslot", name: "MathSlot", version: "0.7.0" });
  await instance.onload();
  assert.ok(registeredCommands.includes("open-mathslot-inline"));
  assert.ok(registeredCommands.includes("open-mathslot-display"));
  assert.ok(registeredCommands.includes("open-mathslot-import"));
  assert.ok(registeredProcessors.includes("mathslot"));
  instance.onunload();
} finally {
  Module._load = originalLoad;
}

// 4b) Instantiate real wasm-bindgen Engine and verify single-source behavior
const wasmGlue = await import(pathToFileURL(path.join(wasmPkgOutDir, "mathslot_wasm.js")).href);
await wasmGlue.default({ module_or_path: wasmBytes });
assert.equal(wasmGlue.Engine.engineVersion(), EXPECTED_ENGINE_VERSION);

const engine = new wasmGlue.Engine();
try {
  const catalog = JSON.parse(engine.catalogJson());
  assert.equal(catalog.commands.length, 121, "Catalog must expose 121 single-source commands");

  const presets = JSON.parse(engine.presetsJson());
  assert.equal(presets.presets.length, 88, "Presets must expose 88 single-source presets");

  // Type stream fraction: ▸fa;b; -> \frac{a}{b}
  for (const ch of ["\u25b8", "f", "a", ";", "b", ";"]) {
    engine.dispatch(JSON.stringify({ KeyInput: ch }));
  }
  const fracSnap = JSON.parse(engine.snapshot());
  assert.equal(fracSnap.latex, "\\frac{a}{b}");

  // Verify LaTeX error blocks overwrite (A-OBS-005 / D-123)
  const blockedRes = JSON.parse(engine.dispatch(JSON.stringify({ ImportLatex: "{1 + 2" })));
  assert.equal(blockedRes.snapshot.last_import.blocked, true);
  assert.equal(blockedRes.snapshot.latex, "\\frac{a}{b}");

  // Verify all 88 presets expand cleanly without stream errors (A-OBS-004 / D-126)
  for (const preset of presets.presets) {
    const res = JSON.parse(engine.dispatch(JSON.stringify({ LoadStreamSource: preset.source })));
    assert.equal(
      res.snapshot.has_pending_command,
      false,
      `Preset ${preset.id} left pending command`,
    );
    assert.ok(
      !res.snapshot.latex.includes("\u25b8"),
      `Preset ${preset.id} leaked raw stream marker in latex: ${res.snapshot.latex}`,
    );
    const streamErrors = res.snapshot.diagnostics.filter(
      (d) => d.code === "PENDING_COMMAND" || d.code === "UNKNOWN_COMMAND",
    );
    assert.equal(
      streamErrors.length,
      0,
      `Preset ${preset.id} produced stream errors: ${JSON.stringify(streamErrors)}`,
    );
    assert.ok(res.snapshot.latex.length > 0, `Preset ${preset.id} expanded to empty latex`);
  }

  assert.equal(engine.wrapLatex("x^2", "inline_dollar"), "$x^2$");
} finally {
  engine.free();
}

console.log(
  `✓ Obsidian plugin built and verified successfully: obsidian-mathslot/main.js (${registeredCommands.length} commands, 121 catalog entries, 88/88 presets)`,
);

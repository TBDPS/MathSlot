import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const WASM_PATH = path.join(repoRoot, "apps/obsidian/src/wasm-pkg/mathslot_wasm_bg.wasm");
const WASM_GLUE_PATH = path.join(repoRoot, "apps/obsidian/src/wasm-pkg/mathslot_wasm.js");
const MAIN_JS_PATH = path.join(repoRoot, "obsidian-mathslot/main.js");
const RENDER_ADAPTER_PATH = path.join(repoRoot, "packages/ui/src/preview/renderAdapter.ts");

const MAX_WASM_BYTES = 409_600; // 400 KB (pre-gzip) per §13.5
const MAX_PARSE_P95_MS = 5.0; // §13.5
const MAX_RENDER_P95_MS = 100.0; // §13.5
const MAX_CONTINUOUS_TYPING_MS = 100.0; // §13.5

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function summarizeMs(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    min_ms: Number(sorted[0].toFixed(3)),
    p50_ms: Number(percentile(sorted, 50).toFixed(3)),
    p95_ms: Number(percentile(sorted, 95).toFixed(3)),
    max_ms: Number(sorted[sorted.length - 1].toFixed(3)),
    avg_ms: Number((sum / sorted.length).toFixed(3)),
  };
}

async function run() {
  assert.ok(existsSync(WASM_PATH), `Missing WASM artifact: ${WASM_PATH}`);
  assert.ok(existsSync(WASM_GLUE_PATH), `Missing WASM glue: ${WASM_GLUE_PATH}`);
  assert.ok(existsSync(MAIN_JS_PATH), `Missing plugin bundle: ${MAIN_JS_PATH}`);

  // 1. WASM size & main.js single-WASM embed check (D-152)
  const wasmSizeBytes = statSync(WASM_PATH).size;
  const wasmBytes = readFileSync(WASM_PATH);
  const mainJsText = readFileSync(MAIN_JS_PATH, "utf8");
  const mainJsSizeBytes = Buffer.byteLength(mainJsText, "utf8");
  const embeddedWasmMatches = mainJsText.match(/AGFzbQE[A-Za-z0-9+/=]{100,}/g) ?? [];

  // 2. Cold WASM init + catalog + presets (D-154)
  const wasmGlue = await import(pathToFileURL(WASM_GLUE_PATH).href);
  const b64 = wasmBytes.toString("base64");

  const tInitStart = performance.now();
  const decodedBinary = Buffer.from(b64, "base64");
  const tDecodeEnd = performance.now();
  const wasmMod = await wasmGlue.default({ module_or_path: decodedBinary });
  const tCompileEnd = performance.now();
  const engine = new wasmGlue.Engine();
  const tEngineEnd = performance.now();
  const catalogRaw = engine.catalogJson();
  const tCatalogEnd = performance.now();
  const presetsRaw = engine.presetsJson();
  const tPresetsEnd = performance.now();

  const catalogObj = JSON.parse(catalogRaw);
  const presetsObj = JSON.parse(presetsRaw);
  assert.equal(catalogObj.commands.length, 121);
  assert.equal(presetsObj.presets.length, 88);

  const startup = {
    b64_decode_ms: Number((tDecodeEnd - tInitStart).toFixed(3)),
    wasm_init_ms: Number((tCompileEnd - tDecodeEnd).toFixed(3)),
    engine_new_ms: Number((tEngineEnd - tCompileEnd).toFixed(3)),
    catalog_json_ms: Number((tCatalogEnd - tEngineEnd).toFixed(3)),
    presets_json_ms: Number((tPresetsEnd - tCatalogEnd).toFixed(3)),
    total_cold_ms: Number((tPresetsEnd - tInitStart).toFixed(3)),
  };

  // 3. Typical formula parse via WASM Engine.dispatch (D-154)
  const typicalFormulas = [
    "\\frac{a}{b}",
    "\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
    "\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}",
    "\\sum_{k=1}^{n} k^2 = \\frac{n(n+1)(2n+1)}{6}",
  ];
  const parseSamples = [];
  for (let round = 0; round < 50; round += 1) {
    for (const tex of typicalFormulas) {
      const payload = JSON.stringify({ ImportLatex: tex });
      const t0 = performance.now();
      const resp = JSON.parse(engine.dispatch(payload));
      const t1 = performance.now();
      assert.equal(resp.snapshot.last_import.blocked, false);
      parseSamples.push(t1 - t0);
    }
  }
  const parseMetrics = summarizeMs(parseSamples);

  // 4. MathJax SVG render p95 (D-154)
  const require = createRequire(import.meta.url);
  const { mathjax } = require(path.join(repoRoot, "packages/ui/node_modules/mathjax-full/js/mathjax.js"));
  const { TeX } = require(path.join(repoRoot, "packages/ui/node_modules/mathjax-full/js/input/tex.js"));
  const { SVG } = require(path.join(repoRoot, "packages/ui/node_modules/mathjax-full/js/output/svg.js"));
  const { liteAdaptor } = require(path.join(repoRoot, "packages/ui/node_modules/mathjax-full/js/adaptors/liteAdaptor.js"));
  const { RegisterHTMLHandler } = require(path.join(repoRoot, "packages/ui/node_modules/mathjax-full/js/handlers/html.js"));
  const { AllPackages } = require(path.join(repoRoot, "packages/ui/node_modules/mathjax-full/js/input/tex/AllPackages.js"));

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const texInput = new TeX({ packages: AllPackages });
  const svgOutput = new SVG({ fontCache: "none" });
  const mjDoc = mathjax.document("", { InputJax: texInput, OutputJax: svgOutput });

  const tColdRender0 = performance.now();
  const coldNode = mjDoc.convert("\\frac{a}{b}", { display: true });
  const tColdRender1 = performance.now();
  assert.ok(adaptor.outerHTML(coldNode).includes("<svg"));

  const renderSamples = [];
  for (let i = 0; i < 60; i += 1) {
    const tex = typicalFormulas[i % typicalFormulas.length];
    const t0 = performance.now();
    const node = mjDoc.convert(tex, { display: true });
    const svg = adaptor.outerHTML(node);
    const t1 = performance.now();
    assert.ok(svg.includes("<svg"));
    renderSamples.push(t1 - t0);
  }
  const renderMetrics = {
    cold_ms: Number((tColdRender1 - tColdRender0).toFixed(3)),
    ...summarizeMs(renderSamples),
  };

  // 5. Continuous typing debounce budget check (D-153)
  const adapterSrc = readFileSync(RENDER_ADAPTER_PATH, "utf8");
  const defaultDebMatch = adapterSrc.match(/debounceMs\s*=\s*(\d+)/);
  const defaultMaxMatch = adapterSrc.match(/maxWaitMs\s*=\s*(\d+)/);
  const defaultDebounceMs = defaultDebMatch ? Number(defaultDebMatch[1]) : -1;
  const defaultMaxWaitMs = defaultMaxMatch ? Number(defaultMaxMatch[1]) : -1;
  const continuousBudgetMs = Number((defaultMaxWaitMs + renderMetrics.p95_ms).toFixed(3));

  // 6. 1000-edit stress test: dispatch latency scaling + WASM linear memory + Node RSS (D-154 / D-155)
  const stressEngine = new wasmGlue.Engine();
  const memInitialBytes = wasmMod.memory.buffer.byteLength;
  const rssBeforeBytes = process.memoryUsage().rss;
  const bucketAvgs = [];
  let bucketSum = 0;
  let bucketCount = 0;
  const allEditSamples = [];

  const pattern = ["\u25b8", "f", "a", ";", "b", ";", "+"];
  for (let i = 0; i < 1000; i += 1) {
    const ch = pattern[i % pattern.length];
    const evt = JSON.stringify({ KeyInput: ch });
    const t0 = performance.now();
    stressEngine.dispatch(evt);
    const dt = performance.now() - t0;
    allEditSamples.push(dt);
    bucketSum += dt;
    bucketCount += 1;
    if ((i + 1) % 100 === 0) {
      bucketAvgs.push(Number((bucketSum / bucketCount).toFixed(3)));
      bucketSum = 0;
      bucketCount = 0;
    }
  }
  const memAfter1000Bytes = wasmMod.memory.buffer.byteLength;
  const rssAfterBytes = process.memoryUsage().rss;
  stressEngine.free();
  engine.free();

  const report = {
    wasm: {
      wasm_bytes: wasmSizeBytes,
      wasm_budget_bytes: MAX_WASM_BYTES,
      main_js_bytes: mainJsSizeBytes,
      main_js_wasm_embed_count: embeddedWasmMatches.length,
    },
    startup,
    parse: parseMetrics,
    render: renderMetrics,
    continuous_typing: {
      default_debounce_ms: defaultDebounceMs,
      default_max_wait_ms: defaultMaxWaitMs,
      estimated_max_wait_plus_p95_ms: continuousBudgetMs,
      budget_ms: MAX_CONTINUOUS_TYPING_MS,
    },
    stress_1000_edits: {
      ...summarizeMs(allEditSamples),
      bucket_100_avg_ms: bucketAvgs,
      wasm_memory_initial_bytes: memInitialBytes,
      wasm_memory_after_1000_bytes: memAfter1000Bytes,
      node_rss_before_bytes: rssBeforeBytes,
      node_rss_after_bytes: rssAfterBytes,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  const failures = [];
  if (wasmSizeBytes > MAX_WASM_BYTES) {
    failures.push(`WASM size ${wasmSizeBytes} > ${MAX_WASM_BYTES} bytes`);
  }
  if (embeddedWasmMatches.length !== 1) {
    failures.push(`main.js embedded WASM count ${embeddedWasmMatches.length} !== 1`);
  }
  if (parseMetrics.p95_ms >= MAX_PARSE_P95_MS) {
    failures.push(`Parse p95 ${parseMetrics.p95_ms} ms >= ${MAX_PARSE_P95_MS} ms`);
  }
  if (renderMetrics.p95_ms >= MAX_RENDER_P95_MS) {
    failures.push(`Render p95 ${renderMetrics.p95_ms} ms >= ${MAX_RENDER_P95_MS} ms`);
  }
  if (defaultMaxWaitMs <= 0 || defaultMaxWaitMs > 60 || continuousBudgetMs >= MAX_CONTINUOUS_TYPING_MS) {
    failures.push(
      `Continuous typing budget violated: maxWaitMs=${defaultMaxWaitMs}, maxWait+p95=${continuousBudgetMs} ms (limit < ${MAX_CONTINUOUS_TYPING_MS} ms)`,
    );
  }

  if (failures.length > 0) {
    console.error("PERF BUDGET FAILURES:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "..");
const repoRoot = resolve(pluginRoot, "..");

console.log("[1/3] Compiling shared mathslot-wasm (wasm32-unknown-unknown --release)...");
execSync("cargo build -p mathslot-wasm --target wasm32-unknown-unknown --release", {
  cwd: repoRoot,
  stdio: "inherit",
});

const wasmPath = resolve(
  repoRoot,
  "target/wasm32-unknown-unknown/release/mathslot_wasm.wasm"
);
const wasmBytes = readFileSync(wasmPath);
const wasmB64 = wasmBytes.toString("base64");

console.log(
  `[2/3] Bundling obsidian-mathslot/main.js (WASM binary: ${(wasmBytes.length / 1024).toFixed(1)} KB)...`
);
const template = readFileSync(resolve(pluginRoot, "src/plugin.js"), "utf8");
const bundled = template.replace("__MATHSLOT_WASM_BASE64__", wasmB64);
if (bundled.includes("__MATHSLOT_WASM_BASE64__")) {
  throw new Error("WASM Base64 占位符替换失败：main.js 仍包含 __MATHSLOT_WASM_BASE64__");
}
if (!bundled.includes(wasmB64.slice(0, 64))) {
  throw new Error("WASM Base64 内联校验失败：main.js 未包含编译产物");
}
writeFileSync(resolve(pluginRoot, "main.js"), bundled, "utf8");

console.log("[3/3] Running Node.js WebAssembly end-to-end smoke test...");
const { instance } = await WebAssembly.instantiate(wasmBytes, {});
const ex = instance.exports;
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");

const readOut = (len) =>
  JSON.parse(dec.decode(new Uint8Array(ex.memory.buffer, ex.out_ptr(), len)));
const withStr = (s, fn) => {
  const b = enc.encode(s);
  const p = ex.wasm_alloc(b.length);
  new Uint8Array(ex.memory.buffer, p, b.length).set(b);
  try {
    return fn(p, b.length);
  } finally {
    ex.wasm_dealloc(p, b.length);
  }
};

const catalog = readOut(ex.get_catalog_json());
if (catalog.directEntries.length !== 12 || catalog.subCategories.length !== 9) {
  throw new Error(`Unexpected catalog counts: direct=${catalog.directEntries.length}, sub=${catalog.subCategories.length}`);
}

// 1) 验证嵌套根号三阶段层级高亮 + MathJax 方言输出
ex.editor_reset();
let st = withStr("▸r1+▸rx", (p, l) => readOut(ex.editor_sync_text(p, l, 7, 1)));
if (!st.previewLatex.includes("\\sqrt{1+\\sqrt{\\bbox[#ecfdf5")) {
  throw new Error(`Expected inner root green bbox, got: ${st.previewLatex}`);
}
st = readOut(ex.editor_enter()); // 闭合内层根号 -> `▸r1+▸rx;`
if (!st.previewLatex.startsWith("\\sqrt{\\bbox[#ecfdf5")) {
  throw new Error(`Expected outer root green bbox after 1st Enter, got: ${st.previewLatex}`);
}
st = readOut(ex.editor_enter()); // 闭合外层根号 -> `▸r1+▸rx;;`
if (st.previewLatex.includes("#ecfdf5")) {
  throw new Error(`Expected no active slot bbox at root after 2nd Enter, got: ${st.previewLatex}`);
}

// 2) 验证三槽位极限自动生成 `\to`
st = withStr("▸lx;0;▸fsin x;x;", (p, l) => readOut(ex.editor_sync_text(p, l, 16, 1)));
if (st.latex !== "\\lim_{x \\to 0} \\frac{\\sin x}{x}") {
  throw new Error(`Unexpected limit LaTeX: ${st.latex}`);
}

// 3) 验证多级分层导航 c b 与 a 行首
st = withStr("▸i0;▸i1;t;g(u) du;;f(x) dx", (p, l) =>
  readOut(ex.editor_sync_text(p, l, 26, 1))
);
readOut(ex.editor_toggle_esc());
st = readOut(ex.editor_esc_char("c".codePointAt(0)));
if (!st.escActive || st.escPath.join("") !== "c") {
  throw new Error("Expected composite slot [c+] drill-down");
}
st = readOut(ex.editor_esc_char("b".codePointAt(0)));
if (st.escActive || st.cursorChar !== 7) {
  throw new Error(`Expected cursorChar=7 after Esc c b, got ${st.cursorChar}`);
}
readOut(ex.editor_toggle_esc());
st = readOut(ex.editor_esc_char("a".codePointAt(0)));
if (st.cursorChar !== 0) {
  throw new Error(`Expected cursorChar=0 after nav a, got ${st.cursorChar}`);
}

// 4) 验证前置插入极限自动包裹已有式子为主体
ex.editor_reset();
st = withStr("▸fsin x;x; = 1", (p, l) => readOut(ex.editor_sync_text(p, l, 15, 1)));
readOut(ex.editor_jump_start()); // cursor -> 0
// 在行首插入 `▸l`
st = withStr("▸l▸fsin x;x; = 1", (p, l) => readOut(ex.editor_sync_text(p, l, 2, 1)));
if (st.source !== "▸l;;▸fsin x;x;; = 1" || st.cursorChar !== 2) {
  throw new Error(`Expected wrapped limit: "▸l;;▸fsin x;x;; = 1" at cursor 2, got: ${st.source} at ${st.cursorChar}`);
}

// 5) 验证 2D 上下方向键穿槽与行尾 [;]、上一位置 [-]
ex.editor_reset();
st = withStr("▸fnum;den;", (p, l) => readOut(ex.editor_sync_text(p, l, 5, 1))); // num|
st = readOut(ex.editor_arrow_down()); // den|
if (st.cursorChar !== 9) throw new Error(`Expected cursorChar=9 on ArrowDown, got ${st.cursorChar}`);
st = readOut(ex.editor_arrow_up()); // num|
if (st.cursorChar !== 5) throw new Error(`Expected cursorChar=5 on ArrowUp, got ${st.cursorChar}`);
readOut(ex.editor_toggle_esc());
st = readOut(ex.editor_esc_char(";".codePointAt(0))); // jump to line end
if (st.cursorChar !== 10) throw new Error(`Expected cursorChar=10 on nav ;, got ${st.cursorChar}`);
st = readOut(ex.editor_jump_back()); // jump back to 5
if (st.cursorChar !== 5) throw new Error(`Expected cursorChar=5 on jump_back, got ${st.cursorChar}`);

// 6) 验证自定义格式与片段保存/展开
ex.editor_reset();
const customLibJson = JSON.stringify({
  custom_formats: [
    {
      item_key: "g",
      label: "同余式",
      glyph_hint: "a≡b(m)",
      slot_roles: ["左项", "右项", "模数"],
      latex_template: "$1 \\equiv $2 \\pmod{$3}",
      scheme_a_name: "cong"
    }
  ],
  snippets: [
    {
      item_key: "d",
      label: "判别式",
      stream_source: "▸rb^2 - 4ac;"
    }
  ]
});
st = withStr(customLibJson, (p, l) => readOut(ex.library_set_json(p, l)));
st = withStr("▸kga^p;a;p;", (p, l) => readOut(ex.editor_sync_text(p, l, 10, 1)));
if (st.latex !== "a^{p} \\equiv a \\pmod{p}") {
  throw new Error(`Unexpected custom format latex: ${st.latex}`);
}
// 调用片段
st = withStr("x = ▸td", (p, l) => readOut(ex.editor_sync_text(p, l, 7, 1)));
if (st.source !== "x = ▸rb^2 - 4ac;" || st.latex !== "x = \\sqrt{b^{2} - 4ac}") {
  throw new Error(`Unexpected snippet expansion: source=${st.source}, latex=${st.latex}`);
}

// 7) 导航 h 标签可达 + 括号自动配对/跳过/导航锚点
ex.editor_reset();
st = withStr("▸f1;2;▸f3;4;▸f5;6;▸f7;8;", (p, l) =>
  readOut(ex.editor_sync_text(p, l, 25, 1))
);
readOut(ex.editor_toggle_esc());
st = readOut(ex.editor_esc_char("h".codePointAt(0)));
if (st.escActive || st.cursorChar === 0) {
  throw new Error(`h label must reach its own slot, got cursor=${st.cursorChar}`);
}

ex.editor_reset();
st = withStr("(", (p, l) => readOut(ex.editor_sync_text(p, l, 1, 1)));
if (st.source !== "()" || st.cursorChar !== 1) {
  throw new Error(`Expected auto pair "()", got ${st.source} at ${st.cursorChar}`);
}
st = withStr("())", (p, l) => readOut(ex.editor_sync_text(p, l, 2, 1)));
if (st.source !== "()" || st.cursorChar !== 2) {
  throw new Error(`Expected type-through to "()", got ${st.source} at ${st.cursorChar}`);
}

ex.editor_reset();
st = withStr("a(b+c)d", (p, l) => readOut(ex.editor_sync_text(p, l, 3, 1)));
if (!st.enclosingBracket || st.enclosingBracket.open !== 1) {
  throw new Error(`Expected enclosingBracket open=1, got ${JSON.stringify(st.enclosingBracket)}`);
}
readOut(ex.editor_toggle_esc());
st = readOut(ex.editor_esc_char("(".codePointAt(0)));
if (st.cursorChar !== 2) {
  throw new Error(`Expected bracket open anchor at 2, got ${st.cursorChar}`);
}
st = readOut(ex.editor_esc_char(")".codePointAt(0)));
if (st.cursorChar !== 6) {
  throw new Error(`Expected bracket close anchor at 6, got ${st.cursorChar}`);
}

// 8) 内联跳转补齐分号后可撤销
ex.editor_reset();
st = withStr("▸i0;▸f1", (p, l) => readOut(ex.editor_sync_text(p, l, 6, 1)));
st = withStr("▸i0;▸f1▸jd", (p, l) => readOut(ex.editor_sync_text(p, l, 10, 1)));
if (st.source !== "▸i0;▸f1;;;") {
  throw new Error(`Expected materialized semis, got ${st.source}`);
}
st = readOut(ex.editor_undo());
if (st.source !== "▸i0;▸f1") {
  throw new Error(`Expected undo to restore clean source, got ${st.source}`);
}

console.log("✓ Obsidian plugin built and verified successfully: obsidian-mathslot/main.js");

import { describe, expect, it } from 'vitest';
import {
  COMMANDS_BY_ID,
  MathSlotEngine,
  PRESETS,
  cloneNodeFresh,
  detectFormulaInLines,
  importFormula,
  listAllSlots,
  mergePresets,
  parseUserCommandsJson,
  parseUserPresetsJson,
  toLatex,
} from '../src';

describe('Audit fixes & new math structures regression suite', () => {
  it('guards against deeply nested braces without stack overflow', () => {
    const deep = '{'.repeat(2000) + 'x' + '}'.repeat(2000);
    const res = importFormula(deep);
    expect(res.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
    expect(res.doc.root.children.length).toBeGreaterThan(0);
  });

  it('parses unbraced \\lim_x subscript without swallowing the variable', () => {
    const res = importFormula('\\lim_x f(x)');
    expect(res.diagnostics.some((d) => d.severity === 'error')).toBe(false);
    expect(toLatex(res.doc)).toContain('\\lim_{x');
  });

  it('parses nested same-name matrix environments with balanced \\begin/\\end', () => {
    const src = '\\begin{pmatrix} \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix} & 0 \\\\ 0 & 1 \\end{pmatrix}';
    const res = importFormula(src);
    expect(res.diagnostics.some((d) => d.severity === 'error')).toBe(false);
    const out = toLatex(res.doc);
    expect(out).toBe('\\begin{pmatrix} \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix} & 0 \\\\ 0 & 1 \\end{pmatrix}');
  });

  it('preserves user preset order in mergePresets instead of reversing', () => {
    const merged = mergePresets(PRESETS.slice(0, 2), [
      { id: 'u-first', name: '第一条', category: '自定义', source: 'a=1' },
      { id: 'u-second', name: '第二条', category: '自定义', source: 'b=2' },
    ]);
    expect(merged[0].id).toBe('u-first');
    expect(merged[1].id).toBe('u-second');
  });

  it('ignores $$ inside Markdown fenced code blocks and rejects $$$ fences', () => {
    const doc = [
      '```bash',
      'echo $$',
      '```',
      '正文行',
      '$$$',
      'x = 1',
      '$$$',
    ];
    expect(detectFormulaInLines(doc, { line: 1, ch: 5 })).toBeNull();
    expect(detectFormulaInLines(doc, { line: 3, ch: 1 })).toBeNull();
    expect(detectFormulaInLines(doc, { line: 5, ch: 2 })).toBeNull();
  });

  it('supports editable \\text{}, \\overset, \\underset, \\cancel, \\xrightarrow, \\pmod and variants', () => {
    const engine = new MathSlotEngine();

    // Editable \text{...} with Chinese and spaces
    engine.loadFormula('\\text{当 } x > 0');
    expect(engine.getSnapshot().latex).toBe('\\text{当 }x > 0');
    const firstNode = engine.getSnapshot().doc.root.children[0];
    expect(firstNode.type).toBe('struct');
    if (firstNode.type === 'struct') {
      expect(firstNode.commandId).toBe('text_box');
    }

    // \overset & \underset
    engine.loadFormula('A \\overset{\\text{def}}{=} \\underset{n \\to \\infty}{\\lim} a_n');
    expect(engine.getSnapshot().latex).toContain('\\overset{\\text{def}}{=}');
    expect(engine.getSnapshot().latex).toContain('\\underset{n \\to \\infty}');

    // Adaptive \xrightarrow (omits optional lower slot when empty)
    engine.clear();
    engine.insertCommand('xrightarrow');
    engine.insertText('f');
    expect(engine.getSnapshot().latex).toBe('\\xrightarrow{f}');

    // \xrightarrow with both lower & upper slots
    engine.loadFormula('X \\xrightarrow[g]{f} Y');
    expect(engine.getSnapshot().latex).toBe('X \\xrightarrow[g]{f} Y');

    // \cancel and \pmod
    engine.loadFormula('\\cancel{x} \\equiv 1 \\pmod{n}');
    expect(engine.getSnapshot().latex).toBe('\\cancel{x} \\equiv 1 \\pmod{n}');

    // Greek variants & arrows
    expect(COMMANDS_BY_ID.get('varphi')?.latex).toBe('\\varphi');
    expect(COMMANDS_BY_ID.get('vartheta')?.latex).toBe('\\vartheta');
    expect(COMMANDS_BY_ID.get('leftarrow')?.latex).toBe('\\leftarrow');
    expect(COMMANDS_BY_ID.get('leftrightarrow')?.latex).toBe('\\leftrightarrow');
  });

  it('cloneNodeFresh assigns strictly unique IDs to every node and slot', () => {
    const res = importFormula('\\frac{a+b}{c}');
    const orig = res.doc.root.children[0];
    const dup = cloneNodeFresh(orig);
    expect(dup.id).not.toBe(orig.id);
    if (orig.type === 'struct' && dup.type === 'struct') {
      const origSlotIds = new Set(orig.slots.flatMap((s) => listAllSlots(s).map((x) => x.id)));
      const dupSlotIds = dup.slots.flatMap((s) => listAllSlots(s).map((x) => x.id));
      for (const id of dupSlotIds) {
        expect(origSlotIds.has(id)).toBe(false);
      }
    }
  });

  it('does not mis-parse plain snake_case text pasted into pasteText as subscripts', () => {
    const engine = new MathSlotEngine();
    engine.pasteText('my_snake_case');
    expect(engine.getSnapshot().latex).toBe('my\\_snake\\_case');
  });

  it('parses all 89 built-in presets with zero hard errors', () => {
    for (const preset of PRESETS) {
      const res = importFormula(preset.source);
      const hardErrors = res.diagnostics.filter((d) => d.severity === 'error');
      expect(hardErrors, `Preset ${preset.id} failed to parse`).toEqual([]);
    }
  });

  it('preserves nested matrix columns inside aligned environments across import -> edit -> export -> re-import', () => {
    const src = '\\begin{aligned}\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}&=M\\end{aligned}';
    const res = importFormula(src);
    expect(res.lossless).toBe(true);
    const first = res.doc.root.children[0];
    expect(first.type).toBe('struct');
    if (first.type === 'struct') {
      expect(first.commandId).toBe('matrix_2x2');
      expect(first.slots.length).toBe(4);
    }

    // Edit cell (1,2) from `2` -> `9`, export, then re-import and assert structure survived
    const engine = new MathSlotEngine();
    engine.loadFormula(src);
    const mat = engine.getSnapshot().doc.root.children[0];
    if (mat.type === 'struct') {
      const cell12 = mat.slots[1];
      engine.setCursor(cell12.id, cell12.children.length);
      engine.backspace();
      engine.insertText('9');
    }
    const exported = engine.getSnapshot().latex;
    expect(exported).toBe('\\begin{pmatrix} 1 & 9 \\\\ 3 & 4 \\end{pmatrix} = M');

    const reimported = importFormula(exported);
    expect(reimported.lossless).toBe(true);
    expect(toLatex(reimported.doc)).toBe('\\begin{pmatrix} 1 & 9 \\\\ 3 & 4 \\end{pmatrix} = M');

    // Multi-column aligned emits explicit warning (`lossless: false`) instead of silently merging
    const multiCol = importFormula('\\begin{aligned}a &= b & c &= d\\end{aligned}');
    expect(multiCol.lossless).toBe(false);
    expect(multiCol.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });

  it('preserves \\lim_{x\\to0^+}, \\iint_0^1 upper bound, and \\int\\limits_0^1 without silent meaning drift', () => {
    // 1. `\lim_{x\to0^+}` must split on LaTeX command boundary (no duplicate `\to`)
    const limRes = importFormula('\\lim_{x\\to0^+} \\frac{1}{x}');
    expect(limRes.lossless).toBe(true);
    const limOut = toLatex(limRes.doc);
    expect(limOut).toBe('\\lim_{x \\to 0^{+}} \\frac{1}{x}');
    expect(limOut.match(/\\to/g)?.length).toBe(1);

    // Unbraced `\lim_x f(x)` should not emit a dangling `\to`
    const limSimple = importFormula('\\lim_x f(x)');
    expect(toLatex(limSimple.doc)).toBe('\\lim_{x} f(x)');

    // 2. `\iint_0^1 x\,dx` preserves BOTH lower and upper bounds
    const iintRes = importFormula('\\iint_0^1 x\\,dx');
    expect(iintRes.lossless).toBe(true);
    expect(toLatex(iintRes.doc)).toBe('\\iint_{0}^{1} x\\,\\mathrm{d}x');

    // 3. `\int\limits_0^1 f(x)\,dx` preserves `\limits`, lower, upper, and body
    const limitsRes = importFormula('\\int\\limits_0^1 f(x)\\,dx');
    expect(limitsRes.lossless).toBe(true);
    expect(toLatex(limitsRes.doc)).toBe('\\int\\limits_{0}^{1} f(x)\\,\\mathrm{d}x');
  });

  it('excludes inline code, fenced code blocks, and escaped \\$ in Obsidian math detection', () => {
    const doc = [
      'Price is \\$5 and \\$10 total.',
      'Code span `$x+1$` and ``$y+2$`` then real $z+3$.',
      '```tex',
      '$a+b$',
      '```',
      '~~~',
      '$$c+d$$',
      '~~~',
    ];
    // Escaped dollar signs never match
    expect(detectFormulaInLines(doc, { line: 0, ch: 12 })).toBeNull();
    // Inline code spans never match
    expect(detectFormulaInLines(doc, { line: 1, ch: 13 })).toBeNull();
    expect(detectFormulaInLines(doc, { line: 1, ch: 26 })).toBeNull();
    // Real inline math after code spans on the SAME line DOES match!
    const realHit = detectFormulaInLines(doc, { line: 1, ch: 45 });
    expect(realHit?.raw).toBe('$z+3$');
    expect(realHit?.delimiter).toBe('inline');
    // Inline / block math inside ``` or ~~~ fenced code blocks NEVER matches
    expect(detectFormulaInLines(doc, { line: 3, ch: 2 })).toBeNull();
    expect(detectFormulaInLines(doc, { line: 6, ch: 3 })).toBeNull();
  });

  it('handles \\left\\{x\\middle|x>0\\right\\}, \\boxed{z}, \\text{a\\_b 50\\%}, mixed intervals, and unknown macros cleanly', () => {
    // 1. Set builder with `\middle|` imports into editable struct
    const setRes = importFormula('\\left\\{x\\middle|x>0\\right\\}');
    expect(setRes.lossless).toBe(true);
    expect(toLatex(setRes.doc)).toBe('\\left\\{ x \\,\\middle|\\, x > 0 \\right\\}');

    // 2. `\boxed{z}` imports into editable `boxed` struct
    const boxRes = importFormula('\\boxed{z}');
    expect(boxRes.lossless).toBe(true);
    expect(toLatex(boxRes.doc)).toBe('\\boxed{z}');
    expect(boxRes.doc.root.children[0].type).toBe('struct');

    // 3. `\text{a\_b 50\%}` does NOT double-escape backslashes on roundtrip
    const textRes = importFormula('\\text{a\\_b 50\\%}');
    expect(textRes.lossless).toBe(true);
    expect(toLatex(textRes.doc)).toBe('\\text{a\\_b 50\\%}');

    // 4. Mixed intervals `(a, b]` and `[a, b)` import into editable structs
    const ocRes = importFormula('\\left(a, b\\right]');
    expect(ocRes.lossless).toBe(true);
    expect(toLatex(ocRes.doc)).toBe('\\left(a, b\\right]');
    const coRes = importFormula('\\left[a, b\\right)');
    expect(coRes.lossless).toBe(true);
    expect(toLatex(coRes.doc)).toBe('\\left[a, b\\right)');

    // 5. Unknown macro with argument stays attached as a single raw node with warning
    const unkRes = importFormula('\\phantom{xyz} + 1');
    expect(unkRes.lossless).toBe(false);
    expect(toLatex(unkRes.doc)).toBe('\\phantom{xyz} + 1');
  });

  it('pastes compact math subscripts like x_1 as structs while supporting literal paste and marking broken JSON as failed', () => {
    const engine = new MathSlotEngine();
    engine.pasteText('x_1');
    expect(engine.getSnapshot().latex).toBe('x_1');

    engine.clear();
    engine.pasteLiteralText('x_1');
    expect(engine.getSnapshot().latex).toBe('x\\_1');

    const badP = parseUserPresetsJson('{ invalid');
    expect(badP.failed).toBe(true);
    const badC = parseUserCommandsJson('{ invalid');
    expect(badC.failed).toBe(true);
  });
});

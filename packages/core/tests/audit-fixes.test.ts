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
});

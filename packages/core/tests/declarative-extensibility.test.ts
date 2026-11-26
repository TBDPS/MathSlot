import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  COMMANDS_BY_ID,
  MathSlotEngine,
  commandPreviewLatex,
  importFormula,
  parseStreamCode,
  toLatex,
  toStreamCode,
} from '../src';

const INTERACTIVE_TRUST = (ctx: { command: string }) =>
  ctx.command === '\\htmlData' || ctx.command === '\\htmlClass' || ctx.command === '\\htmlId';

function typeChars(engine: MathSlotEngine, seq: string): void {
  for (const ch of seq) {
    engine.insertText(ch);
  }
}

describe('Zero-Code Declarative Extensibility Proof (8 new structures)', () => {
  const NEW_IDS = [
    'bigwedge',
    'ket',
    'bra',
    'braket',
    'stackrel',
    'xRightarrow',
    'xLeftrightarrow',
    'xmapsto',
  ] as const;

  it('registers all 8 structures in catalog & renders interactive, canonical, and preview KaTeX cleanly', () => {
    for (const id of NEW_IDS) {
      const cmd = COMMANDS_BY_ID.get(id);
      expect(cmd, `missing ${id}`).toBeDefined();

      const engine = new MathSlotEngine();
      expect(engine.insertCommand(id)).toBe(true);
      const snap = engine.getSnapshot();
      expect(() =>
        katex.renderToString(snap.interactiveLatex, {
          displayMode: true,
          throwOnError: true,
          strict: false,
          trust: INTERACTIVE_TRUST,
        }),
      ).not.toThrow();

      const preview = commandPreviewLatex(cmd!.latex);
      expect(() =>
        katex.renderToString(preview, {
          displayMode: false,
          throwOnError: true,
          strict: false,
          trust: false,
        }),
      ).not.toThrow();
    }
  });

  it('supports Tab leader chords, semicolon slot progression, and backward atom wrapping for Dirac ket/bra/braket', () => {
    // 1. Backward atom wrap: type `0`, then `Tab a R` (`ket`) -> `|0⟩` and cursor exits right after!
    const e1 = new MathSlotEngine();
    typeChars(e1, '0');
    e1.triggerLeader();
    e1.handleLeaderKey('a');
    e1.handleLeaderKey('R');
    typeChars(e1, '+1');
    expect(e1.getSnapshot().latex).toBe('\\left| 0 \\right\\rangle + 1');

    // 2. Bra + Ket + Braket via Tab chords and `;` progression
    const e2 = new MathSlotEngine();
    e2.triggerLeader();
    e2.handleLeaderKey('a');
    e2.handleLeaderKey('T');
    typeChars(e2, 'phi;psi;=0');
    expect(e2.getSnapshot().latex).toBe(
      '\\left\\langle \\phi \\,\\middle|\\, \\psi \\right\\rangle = 0',
    );
  });

  it('supports native inline LaTeX typing for [opt]{req}, {arg1}{arg2}, and _sub^sup bigop across all 8 structures', () => {
    // 1. `\ket{\psi}` & `\bra{\phi}` & `\braket{\phi}{\psi}`
    const eDirac = new MathSlotEngine();
    typeChars(eDirac, '\\bra{\\phi }\\ket{\\psi }=\\braket{\\phi }{\\psi }');
    expect(eDirac.getSnapshot().latex).toBe(
      '\\left\\langle \\phi \\right|\\left| \\psi \\right\\rangle = \\left\\langle \\phi \\,\\middle|\\, \\psi \\right\\rangle',
    );

    // 2. `\xRightarrow[n\to\infty]{L^2}` (both optional [sub] and {sup}) AND `\xRightarrow{P}` (optional [sub] omitted!)
    const eArrow = new MathSlotEngine();
    typeChars(eArrow, 'X_n;\\xRightarrow[n->oo]{L^2}X\\xRightarrow{P}Y');
    expect(eArrow.getSnapshot().latex).toBe(
      'X_n \\xRightarrow[n\\to\\infty]{L^2} X \\xRightarrow{P} Y',
    );

    // 3. `\xLeftrightarrow[a]{b}` & `\xmapsto[D]{T}` & `\stackrel{def}{=}`
    const eRel = new MathSlotEngine();
    typeChars(eRel, 'A\\xLeftrightarrow[1]{2}B\\xmapsto{f}C\\stackrel{!}{=}D');
    expect(eRel.getSnapshot().latex).toBe(
      'A \\xLeftrightarrow[1]{2} B \\xmapsto{f} C \\stackrel{!}{=} D',
    );

    // 4. `\bigwedge_{k=1}^{n} V_k` via native `_` and `^` inline triggers
    const eWedge = new MathSlotEngine();
    typeChars(eWedge, '\\bigwedge_{k=1}^{n}V_k;=W');
    expect(eWedge.getSnapshot().latex).toBe('\\bigwedge_{k=1}^{n} V_k = W');
  });

  it('supports declarative 2D vertical navigation (ArrowUp / ArrowDown) without engine hardcoding', () => {
    // 1. `xRightarrow`: default lands in slot 1 (top `{上标}`); ArrowDown visits optional slot 0 (`[下标]`); ArrowUp returns to slot 1
    const e1 = new MathSlotEngine();
    e1.insertCommand('xRightarrow');
    typeChars(e1, 'top');
    expect(e1.getSnapshot().latex).toBe('\\xRightarrow{\\text{top}}'.replace('\\text{top}', 'top'));
    e1.moveDown();
    typeChars(e1, 'bot');
    expect(e1.getSnapshot().latex).toBe('\\xRightarrow[bot]{top}');
    e1.moveUp();
    typeChars(e1, '!');
    expect(e1.getSnapshot().latex).toBe('\\xRightarrow[bot]{top!}');

    // 2. `stackrel`: slot 0 is top annotation, slot 1 is bottom relation
    const e2 = new MathSlotEngine();
    e2.insertCommand('stackrel');
    typeChars(e2, '?');
    e2.moveDown();
    typeChars(e2, '=');
    expect(e2.getSnapshot().latex).toBe('\\stackrel{?}{=}');
    e2.moveUp();
    typeChars(e2, '!');
    expect(e2.getSnapshot().latex).toBe('\\stackrel{?!}{=}');

    // 3. `bigwedge`: 3-way BIGOP_VERTICAL (body -> up -> sup -> down -> sub -> up -> sup)
    const e3 = new MathSlotEngine();
    e3.insertCommand('bigwedge');
    // Default bigop order starts at slot 0 (lower)
    typeChars(e3, 'i=1');
    e3.moveUp();
    typeChars(e3, 'n');
    e3.nextSlot();
    typeChars(e3, 'e_i;');
    expect(e3.getSnapshot().latex).toBe('\\bigwedge_{i=1}^{n} e_i');
    // From body (slot 2), ArrowDown jumps to lower bound (slot 0)
    e3.moveDown();
    typeChars(e3, '+0');
    expect(e3.getSnapshot().latex).toBe('\\bigwedge_{i=1+0}^{n} e_i');
  });

  it('round-trips reverse LaTeX parsing (both macro and \\left...\\right forms) and bidirectional stream codes', () => {
    const samples = [
      {
        input: '\\ket{\\psi} + \\bra{\\phi} + \\braket{u}{v}',
        expectedCmds: ['ket', 'bra', 'braket'],
      },
      {
        input: '\\left| \\psi \\right\\rangle + \\left\\langle \\phi \\right| + \\left\\langle u \\middle| v \\right\\rangle',
        expectedCmds: ['ket', 'bra', 'braket'],
      },
      {
        input: 'A \\xRightarrow{f} B \\xRightarrow[g]{h} C \\xLeftrightarrow[1]{2} D \\xmapsto[x]{T} E',
        expectedCmds: ['xRightarrow', 'xRightarrow', 'xLeftrightarrow', 'xmapsto'],
      },
      {
        input: 'y \\stackrel{\\mathrm{def}}{=} \\bigwedge\\limits_{i=1}^{n} V_i',
        expectedCmds: ['stackrel', 'bigwedge'],
      },
    ];

    for (const { input, expectedCmds } of samples) {
      const imported = importFormula(input);
      expect(imported.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const structIds = imported.doc.root.children
        .filter((n) => n.type === 'struct')
        .map((n) => (n.type === 'struct' ? n.commandId : ''));
      expect(structIds).toEqual(expectedCmds);

      const canonical = toLatex(imported.doc);
      const stream = toStreamCode(imported.doc);
      const fromStream = parseStreamCode(stream);
      expect(fromStream.diagnostics).toEqual([]);
      expect(toLatex(fromStream.doc)).toBe(canonical);

      // Render canonical output in strict KaTeX
      expect(() =>
        katex.renderToString(canonical, { displayMode: true, throwOnError: true, strict: false }),
      ).not.toThrow();
    }
  });
});

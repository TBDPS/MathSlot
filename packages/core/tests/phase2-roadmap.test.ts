import { describe, expect, it } from 'vitest';
import katex from 'katex';
import {
  COMMANDS_BY_ID,
  MathSlotEngine,
  analyzeSlotSemantics,
  detectShorthandConflicts,
  importFormula,
  toLatex,
} from '../src';

const INTERACTIVE_TRUST = (ctx: { command: string }) =>
  ctx.command === '\\htmlData' || ctx.command === '\\htmlClass' || ctx.command === '\\htmlId';

describe('Phase 2 (v2.4) Unified EmitIR, First-Class Aligned/Tag, Behavior Registry & Expansion', () => {
  it('shares a single EmitIR semantic pass between canonical export and interactive canvas (P1-2)', () => {
    const engine = new MathSlotEngine();
    engine.loadFormula('\\int_0^1 \\sin x\\,\\mathrm{d}x + \\pi');
    const snap = engine.getSnapshot();
    expect(snap.latex).toContain('\\sin x');
    expect(snap.latex).toContain('\\mathrm{d}x');
    expect(snap.interactiveLatex).toContain('\\mathrm{s}');
    expect(() =>
      katex.renderToString(snap.interactiveLatex, {
        displayMode: true,
        throwOnError: true,
        strict: false,
        trust: INTERACTIVE_TRUST,
      }),
    ).not.toThrow();

    // Direct EmitIR inspection on bare words & macro drafts
    const e2 = new MathSlotEngine();
    for (const ch of 'sin x + pi ') e2.insertText(ch);
    const ir = analyzeSlotSemantics(e2.getSnapshot().doc.root.children, true);
    expect(ir.spansByStart.get(0)?.kind).toBe('func');
    expect(ir.spansByStart.get(0)?.latex).toBe('\\sin');
    expect(Array.from(ir.spansByStart.values()).some((s) => s.kind === 'symbol_word' && s.latex === '\\pi')).toBe(
      true,
    );
  });

  it('aligns multi-line root equations inside \\begin{aligned} on BOTH canvas and export (P1-3)', () => {
    const engine = new MathSlotEngine();
    engine.loadFormula('a = b + c \\\\ = d');
    const snap = engine.getSnapshot();
    expect(snap.latex).toMatch(/^\\begin\{aligned\}/);
    expect(snap.interactiveLatex).toMatch(/^\\begin\{aligned\}/);
    expect(snap.interactiveLatex).toContain('&');
    expect(() =>
      katex.renderToString(snap.interactiveLatex, {
        displayMode: true,
        throwOnError: true,
        strict: false,
        trust: INTERACTIVE_TRUST,
      }),
    ).not.toThrow();
  });

  it('parses multi-column aligned environments and \\tag{...} into first-class editable structures (P1-3)', () => {
    const multiCol = importFormula('\\begin{aligned} x &= 1 & y &= 2 \\\\ z &= 3 & w &= 4 \\end{aligned}');
    expect(multiCol.hasRawNodes).toBe(false);
    expect(toLatex(multiCol.doc)).toContain('\\begin{aligned}');

    const tagged = importFormula('E = mc^2 \\tag{1}');
    expect(tagged.hasRawNodes).toBe(false);
    expect(toLatex(tagged.doc)).toBe('E = mc^2 \\tag{1}');

    const engine = new MathSlotEngine();
    engine.loadFormula('E = mc^2 \\tag{1}');
    const snap = engine.getSnapshot();
    expect(() =>
      katex.renderToString(snap.interactiveLatex, {
        displayMode: true,
        throwOnError: true,
        strict: false,
        trust: INTERACTIVE_TRUST,
      }),
    ).not.toThrow();
  });

  it('registers formal font commands (\\mathrm, \\mathfrak, \\mathsf, \\mathtt, \\boldsymbol, \\mathscr) with zero ad-hoc inline_* IDs (P2-2)', () => {
    const engine = new MathSlotEngine();
    for (const ch of '\\mathfrak{g}+\\boldsymbol{\\theta}+\\mathscr{F}+\\mathsf{T}') {
      engine.insertText(ch);
    }
    const snap = engine.getSnapshot();
    expect(snap.latex).toBe('\\mathfrak{g} + \\boldsymbol{\\theta} + \\mathscr{F} + \\mathsf{T}');
    for (const child of snap.doc.root.children) {
      if (child.type === 'struct') {
        expect(child.commandId.startsWith('inline_')).toBe(false);
        expect(COMMANDS_BY_ID.has(child.commandId)).toBe(true);
      }
    }
  });

  it('parses classic TeX {a \\over b}, {n \\choose k}, and \\not negations into clean AST nodes (P2-3)', () => {
    const res = importFormula('{n \\choose k} = {n! \\over k!(n-k)!},\\; a \\not= b,\\; x \\not\\in S,\\; A \\not\\subseteq B');
    expect(res.hasRawNodes).toBe(false);
    const out = toLatex(res.doc);
    expect(out).toContain('\\binom{n}{k}');
    expect(out).toContain('\\frac{n!}{k!(n - k)!}');
    expect(out).toContain('\\neq');
    expect(out).toContain('\\notin');
    expect(out).toContain('\\nsubseteq');
  });

  it('detects shorthand collisions against built-ins, math functions, and duplicate user entries (P1-5)', () => {
    const conflicts = detectShorthandConflicts(
      [
        { id: 'c1', label: '自定义派', latex: '\\varpi', slots: [], shorthand: 'pi' },
        { id: 'c2', label: '自定义正弦', latex: '\\operatorname{Sin}', slots: [], shorthand: 'sin' },
        { id: 'c3', label: '自定义算子A', latex: '\\mathcal{A}', slots: [], shorthand: 'AA' },
      ],
      [
        { id: 'u1', label: '外部算子A', category: 'symbol', latex: '\\mathbb{A}', keys: [], slots: [], shorthand: 'AA' },
      ],
    );
    expect(conflicts.some((c) => c.trigger === 'pi' && c.kind === 'builtin_shorthand')).toBe(true);
    expect(conflicts.some((c) => c.trigger === 'sin' && c.kind === 'math_function')).toBe(true);
    expect(conflicts.some((c) => c.trigger === 'AA' && c.kind === 'duplicate_user')).toBe(true);
  });

  it('supports new := -> \\coloneqq shorthand and expanded big operators & higher-order derivatives', () => {
    const engine = new MathSlotEngine();
    for (const ch of 'x := y') engine.insertText(ch);
    expect(engine.getSnapshot().latex).toBe('x \\coloneqq y');

    const e2 = new MathSlotEngine();
    e2.insertCommand('bigoplus');
    e2.insertText('i=1');
    e2.nextSlot();
    e2.insertText('n');
    e2.nextSlot();
    for (const ch of 'V_i') e2.insertText(ch);
    expect(e2.getSnapshot().latex).toBe('\\bigoplus_{i=1}^{n} V_i');

    const e3 = new MathSlotEngine();
    e3.insertCommand('nth_partial');
    e3.insertText('2');
    e3.nextSlot();
    e3.insertText('u');
    e3.nextSlot();
    e3.insertText('x');
    e3.nextSlot();
    e3.insertText('2');
    expect(e3.getSnapshot().latex).toBe('\\frac{\\partial^{2} u}{\\partial x^{2}}');
  });

  it('expands negated relation chains, turnstiles, and causality shorthands cleanly without corrupting ordinary math', () => {
    const typeAndLatex = (seq: string): string => {
      const e = new MathSlotEngine();
      for (const ch of seq) e.insertText(ch);
      return e.getSnapshot().latex;
    };

    // Multi-hop auto-derived prefix upgrade chains: 2 -> 3 -> 4 chars
    expect(typeAndLatex('a!=b')).toBe('a \\neq b');
    expect(typeAndLatex('a!==b')).toBe('a \\not\\equiv b');
    expect(typeAndLatex('P!=>Q')).toBe('P \\nRightarrow Q');
    expect(typeAndLatex('a!<b')).toBe('a \\nless b');
    expect(typeAndLatex('a!<=b')).toBe('a \\nleq b');
    expect(typeAndLatex('P!<=>Q')).toBe('P \\nLeftrightarrow Q');
    expect(typeAndLatex('a!>b')).toBe('a \\ngtr b');
    expect(typeAndLatex('a!>=b')).toBe('a \\ngeq b');
    expect(typeAndLatex('a!~b')).toBe('a \\nsim b');
    expect(typeAndLatex('a!~=b')).toBe('a \\ncong b');
    expect(typeAndLatex('p!|a')).toBe('p \\nmid a');
    expect(typeAndLatex('l!||m')).toBe('l \\nparallel m');
    expect(typeAndLatex('x!->0')).toBe('x \\nrightarrow 0');

    // Turnstile & prefix upgrade `|-` -> `|->`
    expect(typeAndLatex('A|-B')).toBe('A \\vdash B');
    expect(typeAndLatex('x|->y')).toBe('x \\mapsto y');
    expect(typeAndLatex('A|=B')).toBe('A \\models B');

    // Causality shorthands (punct & word)
    expect(typeAndLatex(':.: x=1 .:. x>0')).toBe('\\because x = 1 \\therefore x > 0');
    expect(typeAndLatex('because a notin S therefore nexists x')).toBe(
      '\\because a \\notin S \\therefore \\nexists x',
    );
    expect(typeAndLatex('A nvdash B niff C nmodels D')).toBe(
      'A \\nvdash B \\nLeftrightarrow C \\nvDash D',
    );

    // Zero false positives on ordinary math expressions
    expect(typeAndLatex('3.14 + ab + bc + ca')).toBe('3.14 + ab + bc + ca');
    expect(typeAndLatex('n! > 0')).toBe('n! > 0');
    expect(typeAndLatex('tf(x)')).toBe('tf(x)');
  });
});

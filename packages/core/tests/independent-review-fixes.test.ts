import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MathSlotEngine,
  PRESETS,
  SLOT_ORDER_GROUPS,
  formatFormulaWithWrapper,
  importFormula,
  normalizePreviewLatex,
  toLatex,
} from '../src';

function typeKeys(engine: MathSlotEngine, seq: string): void {
  for (const ch of seq) {
    engine.insertText(ch);
  }
}

function renderMathML(latex: string, displayMode = true): string {
  return katex.renderToString(latex, {
    displayMode,
    output: 'mathml',
    throwOnError: true,
    strict: false,
  });
}

describe('Independent Review P0/P1/P2 Regression & Semantic Gates', () => {
  it('P0-2.1: script-on-script nesting upgrades cleanly instead of nesting inside scripts', () => {
    // x_1^2 -> x_1^2 (NOT x_{1^2})
    const e1 = new MathSlotEngine();
    typeKeys(e1, 'x_1^2');
    expect(e1.getSnapshot().latex).toBe('x_1^2');

    // x^2_1 -> x_1^2 (NOT x^{2_1})
    const e2 = new MathSlotEngine();
    typeKeys(e2, 'x^2_1');
    expect(e2.getSnapshot().latex).toBe('x_1^2');

    // \int_0^1 -> \int_{0}^{1} (NOT \int_{0^1})
    const e3 = new MathSlotEngine();
    typeKeys(e3, '\\int_0^1');
    expect(e3.getSnapshot().latex).toBe('\\int_{0}^{1}');

    // \sum_i^n -> \sum_{i}^{n} (NOT \sum_{i^n})
    const e4 = new MathSlotEngine();
    typeKeys(e4, '\\sum_i^n');
    expect(e4.getSnapshot().latex).toBe('\\sum_{i}^{n}');

    // Preserves nested subscript inside upper limit when lower limit is already filled: \int_0^{a_1}
    const e5 = new MathSlotEngine();
    typeKeys(e5, '\\int_0^a_1');
    expect(e5.getSnapshot().latex).toBe('\\int_{0}^{a_1}');

    // Preserves nested superscript in exponent: e^{x^2}
    const e6 = new MathSlotEngine();
    typeKeys(e6, 'e^x^2');
    expect(e6.getSnapshot().latex).toBe('e^{x^2}');
  });

  it('P0-2.2: nested multi-line aligned/gathered inside boxed, parens, and sqrt never collapse', () => {
    const cases = [
      '\\boxed{\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}}',
      '\\left(\\begin{aligned} x &= 1 \\\\ y &= 2 \\end{aligned}\\right)',
      '\\sqrt{\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}}',
      '\\boxed{\\begin{gathered} a = b \\\\ c = d \\end{gathered}}',
    ];
    for (const src of cases) {
      const res = importFormula(src);
      expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const out = toLatex(res.doc);
      expect(out).toMatch(/\\begin\{(?:aligned|gathered)\}/);
      expect(() => renderMathML(out, true)).not.toThrow();
    }
  });

  it('P0-2.3: unknown multi-arg macros preserve exact arity without detaching arguments', () => {
    const samples = [
      '\\cfrac{1}{2}',
      '\\dbinom{n}{k}',
      '\\textcolor{red}{x}',
      '\\fcolorbox{red}{blue}{x}',
      '\\genfrac(){0pt}{}{a}{b}',
    ];
    for (const src of samples) {
      const res = importFormula(src);
      const out = toLatex(res.doc);
      expect(out).toBe(src);
      expect(() => renderMathML(out, true)).not.toThrow();
    }

    // \prescript keeps all 3 braced args attached and warns about KaTeX support
    const pre = importFormula('\\prescript{a}{b}{X}');
    expect(toLatex(pre.doc)).toBe('\\prescript{a}{b}{X}');
    expect(pre.diagnostics.some((d) => d.message.includes('prescript'))).toBe(true);
  });

  it('P0-2.4: cases / dcases / rcases with 3+ columns preserve every column losslessly', () => {
    const src = '\\begin{cases} a & b & c \\\\ d & e & f \\end{cases}';
    const res = importFormula(src);
    expect(res.diagnostics).toEqual([]);
    const out = toLatex(res.doc);
    expect((out.match(/&/g) ?? []).length).toBe(4);
    expect(out).toContain('c');
    expect(out).toContain('f');
    expect(() => renderMathML(out, true)).not.toThrow();
  });

  it('P0-3.2: EVERY structural keystroke and navigation method emits subscribe() notifications', () => {
    const engine = new MathSlotEngine();
    let count = 0;
    engine.subscribe(() => {
      count += 1;
    });

    const assertNotifies = (label: string, action: () => void) => {
      const before = count;
      action();
      expect(count, `${label} must call notify()`).toBeGreaterThan(before);
    };

    assertNotifies('typing x', () => engine.insertText('x'));
    assertNotifies('natural ^', () => engine.insertText('^'));
    assertNotifies('typing 2', () => engine.insertText('2'));
    assertNotifies('space exits script', () => engine.insertText(' '));
    assertNotifies('natural _', () => engine.insertText('_'));
    assertNotifies('typing i', () => engine.insertText('i'));
    assertNotifies('natural /', () => engine.insertText('/'));
    assertNotifies('typing 3', () => engine.insertText('3'));
    assertNotifies('auto (', () => engine.insertText('('));
    assertNotifies('typing a', () => engine.insertText('a'));
    assertNotifies('skip )', () => engine.insertText(')'));
    assertNotifies('auto [', () => engine.insertText('['));
    assertNotifies('typing b', () => engine.insertText('b'));
    assertNotifies('skip ]', () => engine.insertText(']'));
    assertNotifies('moveHome', () => engine.moveHome());
    assertNotifies('moveEnd', () => engine.moveEnd());
    assertNotifies('selectAll', () => engine.selectAll());

    const e2 = new MathSlotEngine();
    typeKeys(e2, '1/2');
    let c2 = 0;
    e2.subscribe(() => {
      c2 += 1;
    });
    e2.moveUp();
    expect(c2, 'moveUp must call notify()').toBeGreaterThan(0);
    const beforeDown = c2;
    e2.moveDown();
    expect(c2, 'moveDown must call notify()').toBeGreaterThan(beforeDown);
  });

  it('P1-7.1: \\text{\\htmlData{slot-id=FAKE}{x}} never leaks spoofed DOM attributes', () => {
    const engine = new MathSlotEngine();
    const res = engine.loadFormula('\\text{\\htmlData{slot-id=FAKE}{x}}');
    expect(res.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.interactiveLatex).not.toContain('slot-id=FAKE');
    expect(snap.latex).not.toContain('\\htmlData');
    expect(snap.latex).toBe('\\text{x}');
  });

  it('P1-2.5: \\tag{1} exported to inline wrappers renders cleanly in KaTeX inline mode', () => {
    const inlineDollar = formatFormulaWithWrapper('a^2 + b^2 = c^2 \\tag{1}', 'dollar_inline');
    expect(inlineDollar.startsWith('$') && inlineDollar.endsWith('$')).toBe(true);
    expect(inlineDollar).not.toContain('\\tag{');
    expect(() => renderMathML(inlineDollar.slice(1, -1), false)).not.toThrow();

    const inlineParen = formatFormulaWithWrapper('a^2 + b^2 = c^2 \\tag{1}', 'paren_inline');
    expect(inlineParen.startsWith('\\(') && inlineParen.endsWith('\\)')).toBe(true);
    expect(() => renderMathML(inlineParen.slice(2, -2), false)).not.toThrow();

    // Block mode preserves exact \tag{1}!
    const block = formatFormulaWithWrapper('a^2 + b^2 = c^2 \\tag{1}', 'dollar_block');
    expect(block).toContain('\\tag{1}');
  });

  it('P1-2.7 & Appendix B: semantic MathML round-trip across ALL 114 presets plus ODE, |Σ|^{1/2}, and \\triangle', () => {
    // 1. preset-second-order-ode preserves second-order derivative cleanly (no stray `^{2} y`)
    const ode = PRESETS.find((p) => p.id === 'preset-second-order-ode')!;
    const odeRes = importFormula(ode.source);
    expect(odeRes.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const odeOut = toLatex(odeRes.doc);
    expect(odeOut).toContain('\\frac{\\mathrm{d}^{2} y}{\\mathrm{d} x^{2}}');
    expect(() => renderMathML(odeOut, true)).not.toThrow();

    // 2. |\Sigma|^{1/2} parses with abs(\Sigma) as the superscript base (never bare `|`)
    const detRes = importFormula('|\\Sigma|^{1/2}');
    const rootChild = detRes.doc.root.children[0];
    expect(rootChild.type).toBe('struct');
    if (rootChild.type === 'struct') {
      expect(rootChild.commandId).toBe('sup');
      expect(rootChild.slots[0].children[0]?.type).toBe('struct');
      if (rootChild.slots[0].children[0]?.type === 'struct') {
        expect(rootChild.slots[0].children[0].commandId).toBe('abs');
      }
    }
    expect(toLatex(detRes.doc)).toBe('|\\Sigma|^{1/2}');
    // Conditional probability P(A|B) still keeps literal `|`
    const condRes = importFormula('P(A|B)');
    expect(toLatex(condRes.doc)).toBe('P(A|B)');

    // 3. \triangle, \square, \complement parse as first-class SymbolNodes (0 RawNodes)
    for (const macro of ['\\triangle', '\\square', '\\complement']) {
      const r = importFormula(macro);
      expect(r.hasRawNodes).toBe(false);
      expect(r.doc.root.children[0]?.type).toBe('symbol');
    }

    // 4. Every single one of all 114 presets round-trips to valid KaTeX MathML
    expect(PRESETS.length).toBe(114);
    for (const preset of PRESETS) {
      const res = importFormula(preset.source);
      const out = toLatex(res.doc);
      const isDisplayOnly = /\\tag\*?(?![a-zA-Z])|\\begin\{align\*?\}/.test(out);
      expect(
        () => renderMathML(out, true),
        `preset ${preset.id} emitted invalid KaTeX display LaTeX: ${out}`,
      ).not.toThrow();
      const inlineNorm = normalizePreviewLatex(out, false);
      expect(
        () => renderMathML(inlineNorm, false),
        `preset ${preset.id} failed inline preview normalization: ${inlineNorm}`,
      ).not.toThrow();
      if (!isDisplayOnly) {
        expect(() => renderMathML(out, false)).not.toThrow();
      }
    }
  });

  it('P1-2.8 & P1-3.1: spaceExitsScript defaults true (sin^2 x, a_i dx) and operatorExitsScript is safely opt-in', () => {
    expect(DEFAULT_SETTINGS.spaceExitsScript).toBe(true);
    expect(DEFAULT_SETTINGS.operatorExitsScript).toBe(false);

    // Default: Space exits scripts cleanly while x^{n+1} and braced e^{i pi} stay inside exponent
    const e1 = new MathSlotEngine();
    typeKeys(e1, 'sin^2 x');
    expect(e1.getSnapshot().latex).toBe('\\sin^2 x');

    const e1b = new MathSlotEngine();
    typeKeys(e1b, 'a_i dx');
    expect(e1b.getSnapshot().latex).toBe('a_i\\,\\mathrm{d}x');

    const e1c = new MathSlotEngine();
    typeKeys(e1c, 'e^{i pi}');
    expect(e1c.getSnapshot().latex).toBe('e^{i \\pi}');

    const e2 = new MathSlotEngine();
    typeKeys(e2, 'x^n+1');
    expect(e2.getSnapshot().latex).toBe('x^{n+1}');

    // Opt-in operatorExitsScript: binary `+` exits exponent, unary `-` at offset 0 stays inside!
    const e3 = new MathSlotEngine({ operatorExitsScript: true });
    typeKeys(e3, 'x^2+y^2=1');
    expect(e3.getSnapshot().latex).toBe('x^2 + y^2 = 1');

    const e4 = new MathSlotEngine({ operatorExitsScript: true });
    typeKeys(e4, 'e^-x');
    expect(e4.getSnapshot().latex).toBe('e^{-x}');
  });

  it('P1-3.3, P1-3.4, P1-3.8 & P1-4.1: jump prefix step-back, full slotOrder coverage, CJK literal paste, and draft wrapper restore', () => {
    // 1. Jump mode `-` pops typed prefix when `typed.length > 0`
    const je = new MathSlotEngine();
    // Create > 26 tokens so labels become two-char (`aa`, `ab`, ...)
    typeKeys(je, 'a+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p');
    je.enterJumpMode();
    const initialMode = je.getSnapshot().mode;
    expect(initialMode.kind).toBe('jump');
    if (initialMode.kind === 'jump' && initialMode.targets[0]?.label.length === 2) {
      const firstChar = initialMode.targets[0].label[0];
      je.handleJumpKey(firstChar);
      expect(je.getSnapshot().mode.kind).toBe('jump');
      if (je.getSnapshot().mode.kind === 'jump') {
        expect(je.getSnapshot().mode.typed).toBe(firstChar);
      }
      je.handleJumpKey('-');
      const afterBack = je.getSnapshot().mode;
      expect(afterBack.kind).toBe('jump');
      if (afterBack.kind === 'jump') {
        expect(afterBack.typed).toBe('');
      }
    }

    // 2. SLOT_ORDER_GROUPS covers all bigops + nth_partial/nth_deriv + body-first bigop option
    const bigopGroup = SLOT_ORDER_GROUPS.find((g) => g.id === 'bigop')!;
    expect(bigopGroup.commandIds).toContain('double_integral');
    expect(bigopGroup.commandIds).toContain('coprod');
    expect(bigopGroup.commandIds).toContain('bigoplus');
    expect(bigopGroup.commandIds).toContain('bigotimes');
    expect(bigopGroup.options.some((o) => o.order.join(',') === '2,0,1')).toBe(true);
    const nthGroup = SLOT_ORDER_GROUPS.find((g) => g.id === 'nth_deriv');
    expect(nthGroup?.commandIds).toEqual(['nth_partial', 'nth_deriv']);

    // 3. CJK paste heuristic keeps `详见附录_A` literal (no spurious subscript!)
    const pe = new MathSlotEngine();
    pe.pasteText('详见附录_A');
    expect(pe.getSnapshot().latex).toBe('详见附录\\_A');

    // 4. PersistedDraftV1 preserves and exposes restored wrapper dialect
    const de = new MathSlotEngine();
    typeKeys(de, 'a^2+b^2');
    const draft = de.exportDraftV1('bracket_block');
    const restored = new MathSlotEngine();
    expect(restored.restoreDraftV1(draft)).toBe(true);
    expect(restored.getRestoredDraftWrapper()).toBe('bracket_block');
  });
});

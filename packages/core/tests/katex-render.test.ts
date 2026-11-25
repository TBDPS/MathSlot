import { describe, expect, it } from 'vitest';
import katex from 'katex';
import {
  COMMANDS,
  MathSlotEngine,
  PRESETS,
  commandPreviewLatex,
  normalizePreviewLatex,
} from '../src';

const INTERACTIVE_TRUST_COMMANDS = new Set(['\\htmlData', '\\htmlClass', '\\htmlId']);
const strictInteractiveTrust = (ctx: { command: string }) =>
  INTERACTIVE_TRUST_COMMANDS.has(ctx.command);

describe(`Real KaTeX rendering verification across all ${COMMANDS.length} commands and ${PRESETS.length} presets`, () => {
  it(`renders interactive KaTeX with zero errors under strict trust predicate for every single one of the ${COMMANDS.length} commands`, () => {
    for (const cmd of COMMANDS) {
      const engine = new MathSlotEngine();
      engine.insertCommand(cmd.id);
      const snap = engine.getSnapshot();
      expect(
        () =>
          katex.renderToString(snap.interactiveLatex, {
            displayMode: true,
            throwOnError: true,
            strict: false,
            trust: strictInteractiveTrust,
          }),
        `interactive render failed for command ${cmd.id}: ${snap.interactiveLatex}`,
      ).not.toThrow();

      const preview = commandPreviewLatex(cmd.latex);
      expect(
        () =>
          katex.renderToString(preview, {
            displayMode: false,
            throwOnError: true,
            strict: false,
            trust: false,
          }),
        `preview render failed for command ${cmd.id}: ${preview}`,
      ).not.toThrow();
    }
  });

  it(`renders interactive KaTeX with zero errors under strict trust predicate for all ${PRESETS.length} presets`, () => {
    for (const preset of PRESETS) {
      const engine = new MathSlotEngine();
      engine.loadFormula(preset.source);
      const snap = engine.getSnapshot();
      expect(
        () =>
          katex.renderToString(snap.interactiveLatex, {
            displayMode: true,
            throwOnError: true,
            strict: false,
            trust: strictInteractiveTrust,
          }),
        `preset ${preset.id} failed interactive KaTeX render: ${snap.interactiveLatex}`,
      ).not.toThrow();

      // Also verify inline menu preview card rendering (displayMode: false) so `\tag{...}` / `align` presets NEVER fail in CommandDrawer!
      const inlinePreview = normalizePreviewLatex(preset.source, false);
      expect(
        () =>
          katex.renderToString(inlinePreview, {
            displayMode: false,
            throwOnError: true,
            strict: false,
            trust: false,
          }),
        `preset ${preset.id} failed inline menu preview KaTeX render: ${inlinePreview}`,
      ).not.toThrow();
    }
  });

  it('renders tricky imported formulas (\\middle|, \\boxed, \\text escapes, \\int\\limits) in interactive KaTeX without error', () => {
    const cases = [
      '\\left\\{x\\middle|x>0\\right\\}',
      '\\left(a\\middle/b\\right)',
      '\\boxed{E = mc^2}',
      '\\text{a\\_b 50\\%}',
      '\\int\\limits_0^1 f(x)\\,dx',
      '\\iint_0^1 x\\,dx',
      '\\lim_{x\\to0^+} \\frac{1}{x}',
      '\\left(a, b\\right] \\cup \\left[c, d\\right)',
      '\\sum_{\\substack{1 \\le i \\le n \\\\ i \\neq j}} a_{ij}',
      'x\\,y\\!z \\quad w \\qquad v',
      '\\begin{pmatrix} a & b \\\\[4pt] c & d \\end{pmatrix}',
      '\\begin{pmatrix} 1 & 2 \\\\ \\\\ 3 & 4 \\end{pmatrix}',
      '\\begin{align}a&=b & c&=d\\end{align}',
      '\\begin{align} a &= b \\tag{1} \\end{align}',
      '\\text{a\\textbackslash{}b \\textasciicircum{} \\textasciitilde{}}',
      'x\\text{\\textasciicircum}2 + a\\text{\\textasciitilde}b',
    ];
    for (const src of cases) {
      const engine = new MathSlotEngine();
      engine.loadFormula(src);
      const snap = engine.getSnapshot();
      expect(
        () =>
          katex.renderToString(snap.interactiveLatex, {
            displayMode: true,
            throwOnError: true,
            strict: false,
            trust: strictInteractiveTrust,
          }),
        `interactive KaTeX failed for imported "${src}" -> ${snap.interactiveLatex}`,
      ).not.toThrow();
    }
  });

  it('strictly blocks javascript: href injection under strictInteractiveTrust', () => {
    const html = katex.renderToString('\\href{javascript:alert(1)}{click}', {
      displayMode: true,
      throwOnError: false,
      strict: false,
      output: 'html',
      trust: strictInteractiveTrust,
    });
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('javascript:');
  });
});

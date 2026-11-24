import { describe, expect, it } from 'vitest';
import katex from 'katex';
import {
  COMMANDS,
  MathSlotEngine,
  PRESETS,
  commandPreviewLatex,
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

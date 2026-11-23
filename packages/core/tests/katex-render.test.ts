import { describe, expect, it } from 'vitest';
import katex from 'katex';
import {
  COMMANDS,
  MathSlotEngine,
  PRESETS,
  commandPreviewLatex,
} from '../src';

describe('Real KaTeX rendering verification across all 121 commands and 88 presets', () => {
  it('renders interactive KaTeX with zero errors for every single one of the 121 commands', () => {
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
            trust: true,
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

  it('renders interactive KaTeX with zero errors for all 88 presets', () => {
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
            trust: true,
          }),
        `preset ${preset.id} failed interactive KaTeX render: ${snap.interactiveLatex}`,
      ).not.toThrow();
    }
  });
});

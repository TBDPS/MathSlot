import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  MathSlotEngine,
  parseStreamCode,
  registerRawLatexValidator,
  toStreamCode,
} from '../src';

function strictKatexInteractiveRender(latex: string): string {
  return katex.renderToString(latex, {
    displayMode: true,
    throwOnError: true,
    strict: false,
    trust: (ctx) =>
      ctx.command === '\\htmlData' ||
      ctx.command === '\\htmlClass' ||
      ctx.command === '\\htmlId',
  });
}

describe('Universal \\\\ raw_latex passthrough slot (Desktop/Core)', () => {
  it('opens raw_latex on \\\\ and silences all MathSlot syntax sugar inside', () => {
    const engine = new MathSlotEngine();
    for (const ch of 'a+\\\\\\operatorname*{arg\\,max}_{x; \\theta} G/H -> pi dx (u+v)') {
      engine.insertText(ch);
    }
    expect(engine.getInputContext()).toBe('raw');
    expect(engine.getSnapshot().latex).toBe(
      'a + \\operatorname*{arg\\,max}_{x; \\theta} G/H -> pi dx (u+v)',
    );

    engine.nextSlot();
    expect(engine.getInputContext()).toBe('math-root');
    for (const ch of '+pi') engine.insertText(ch);
    expect(engine.getSnapshot().latex).toBe(
      'a + \\operatorname*{arg\\,max}_{x; \\theta} G/H -> pi dx (u+v) + \\pi',
    );
  });

  it('renders crash-proof code capsule while editing or invalid, and real 2D KaTeX once exited & balanced', () => {
    registerRawLatexValidator((raw) => {
      try {
        katex.renderToString(raw, { displayMode: false, throwOnError: true, strict: false, trust: false });
        return true;
      } catch {
        return false;
      }
    });

    try {
      const engine = new MathSlotEngine();
      engine.insertCommand('sqrt');
      for (const ch of '\\\\\\frac{1') {
        engine.insertText(ch);
      }
      const editingSnap = engine.getSnapshot();
      expect(editingSnap.interactiveLatex).toContain('ms-raw-slot-editing');
      expect(() => strictKatexInteractiveRender(editingSnap.interactiveLatex)).not.toThrow();

      engine.moveRight();
      expect(engine.getInputContext()).toBe('raw');

      engine.nextSlot();
      const invalidExitedSnap = engine.getSnapshot();
      expect(invalidExitedSnap.interactiveLatex).toContain('ms-raw-slot-invalid');
      expect(() => strictKatexInteractiveRender(invalidExitedSnap.interactiveLatex)).not.toThrow();

      engine.moveLeft();
      expect(engine.getInputContext()).toBe('raw');
      for (const ch of '}{2}') {
        engine.insertText(ch);
      }
      engine.moveRight();
      expect(engine.getInputContext()).not.toBe('raw');

      const validExitedSnap = engine.getSnapshot();
      expect(validExitedSnap.interactiveLatex).not.toContain('ms-raw-slot-editing');
      expect(validExitedSnap.interactiveLatex).not.toContain('ms-raw-slot-invalid');
      expect(validExitedSnap.latex).toBe('\\sqrt{\\frac{1}{2}}');
      const html = strictKatexInteractiveRender(validExitedSnap.interactiveLatex);
      expect(html).toContain('mfrac');
    } finally {
      registerRawLatexValidator(null);
    }
  });

  it('auto-cleans empty raw_latex shells on Tab / Enter / ArrowRight and round-trips streamCodec losslessly', () => {
    const engine = new MathSlotEngine();
    for (const ch of 'x+\\\\') engine.insertText(ch);
    expect(engine.getInputContext()).toBe('raw');
    engine.triggerLeader();
    expect(engine.getInputContext()).toBe('math-root');
    expect(engine.getSnapshot().latex).toBe('x +');

    for (const ch of '\\\\G/H;pi') engine.insertText(ch);
    engine.triggerLeader();
    for (const ch of '+1') engine.insertText(ch);
    expect(engine.getSnapshot().latex).toBe('x + G/H;pi + 1');

    const stream = toStreamCode(engine.getSnapshot().doc);
    expect(stream).toContain('▸hvG/H▸;pi;');
    const parsed = parseStreamCode(stream);
    const engine2 = new MathSlotEngine();
    engine2.restoreDraftV1({
      schemaVersion: 1,
      updatedAt: Date.now(),
      root: parsed.doc.root,
      cursor: { slotId: parsed.doc.root.id, offset: 0 },
    });
    expect(engine2.getSnapshot().latex).toBe('x + G/H;pi + 1');
  });
});

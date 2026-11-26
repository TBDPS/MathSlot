import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  MathSlotEngine,
  PRESETS,
  importFormula,
  parseStreamCode,
  toLatex,
  toStreamCode,
} from '../src';

function driveFlow(steps: readonly string[]): { latex: string; stream: string } {
  const engine = new MathSlotEngine();
  for (const step of steps) {
    if (step === '<Tab>') engine.triggerLeader();
    else if (step === '<Enter>') engine.nextSlot();
    else if (step === '<S-Enter>') engine.prevSlot();
    else if (step === '<BS>') engine.backspace();
    else if (step === '<Del>') engine.deleteForward();
    else if (step === '<Up>') engine.moveUp();
    else if (step === '<Down>') engine.moveDown();
    else if (step === '<Left>') engine.moveLeft();
    else if (step === '<Right>') engine.moveRight();
    else if (step === '<Esc>') engine.enterJumpMode();
    else if (step === '<AddRow>') engine.addGridRow('below');
    else if (step === '<AddCol>') engine.addGridCol('right');
    else if (step === '<Bar>') engine.toggleGridColBar();
    else {
      for (const ch of step) engine.insertText(ch);
    }
  }
  const snap = engine.getSnapshot();
  return {
    latex: snap.latex,
    stream: toStreamCode(snap.doc),
  };
}

describe('Stream Codec Isomorphism & Golden Refactor Gate', () => {
  it('emits concise human-readable stream code for classic Tab + semicolon formulas and round-trips losslessly', () => {
    // 1. Classic limit + fraction: \lim_{x \to 0} \frac{\sin x}{x} = 1
    const limFlow = driveFlow(['<Tab>', 'l', 'x', ';', '0', ';', '<Tab>', 'f', 'sin x', ';', 'x', ';', ';', '=1']);
    expect(limFlow.stream).toBe('▸lx;0;▸fsin x;x;;=1');
    expect(limFlow.latex).toBe('\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1');
    expect(toLatex(parseStreamCode(limFlow.stream).doc)).toBe(limFlow.latex);

    // 2. Classic sqrt (2-slot with empty index AND 2-slot with cube root)
    const sqrt2 = driveFlow(['<Tab>', 'r', 'x+1', '<Enter>']);
    expect(sqrt2.stream).toBe('▸r;x+1;');
    expect(sqrt2.latex).toBe('\\sqrt{x + 1}');
    expect(toLatex(parseStreamCode(sqrt2.stream).doc)).toBe('\\sqrt{x + 1}');

    const sqrtNested = driveFlow(['<Tab>', 'r', '<Tab>', 'f', '1', ';', '2', ';', '<Enter>']);
    expect(sqrtNested.stream).toBe('▸r;▸f1;2;;');
    expect(sqrtNested.latex).toBe('\\sqrt{\\frac{1}{2}}');
    expect(toLatex(parseStreamCode(sqrtNested.stream).doc)).toBe('\\sqrt{\\frac{1}{2}}');

    const cbrt = driveFlow(['<Tab>', 'r', '<Up>', '3', '<Down>', '8', '<Enter>']);
    expect(cbrt.stream).toBe('▸r3;8;');
    expect(cbrt.latex).toBe('\\sqrt[3]{8}');
    expect(toLatex(parseStreamCode(cbrt.stream).doc)).toBe('\\sqrt[3]{8}');
  });

  it('bijectively round-trips ALL 220 commands via toStreamCode -> parseStreamCode -> toLatex', () => {
    for (const cmd of COMMANDS) {
      const engine = new MathSlotEngine();
      engine.insertCommand(cmd.id);
      for (let i = 0; i < cmd.slots.length; i += 1) {
        engine.insertText(`x${i + 1}`);
        engine.nextSlot();
      }
      const snap = engine.getSnapshot();
      const stream = toStreamCode(snap.doc);
      const reparsed = parseStreamCode(stream);
      expect(reparsed.diagnostics, `cmd ${cmd.id} stream diagnostics: ${stream}`).toEqual([]);
      expect(
        toLatex(reparsed.doc),
        `cmd ${cmd.id} stream roundtrip mismatch (${stream})`,
      ).toBe(snap.latex);
    }
  });

  it('bijectively round-trips ALL 114 presets via importFormula -> toStreamCode -> parseStreamCode -> toLatex', () => {
    for (const preset of PRESETS) {
      const imported = importFormula(preset.source);
      const canonical = toLatex(imported.doc);
      const stream = toStreamCode(imported.doc);
      const reparsed = parseStreamCode(stream);
      expect(reparsed.diagnostics, `preset ${preset.id} stream diagnostics`).toEqual([]);
      expect(
        toLatex(reparsed.doc),
        `preset ${preset.id} stream roundtrip mismatch: ${stream}`,
      ).toBe(canonical);
      expect(toStreamCode(reparsed.doc)).toBe(stream);
    }
  });

  it('locks golden behavior across core keyboard, inline LaTeX, vertical nav, and grid editing flows', () => {
    // Submenu live default + 2nd key morph
    const morph = driveFlow(['<Tab>', 'm', 'd', 'x', ';', 'x>0', ';', '-x', ';', 'x<=0', ';']);
    expect(morph.latex).toBe('\\begin{cases} x & x > 0 \\\\ -x & x \\le 0 \\end{cases}');

    // Smart fallthrough on Tab m + '1'
    const fallthrough = driveFlow(['<Tab>', 'm', '1', ';', '2', ';', '3', ';', '4', ';']);
    expect(fallthrough.latex).toBe('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}');

    // Dynamic grid row/col add + augmented bar toggle + stream round-trip
    const aug = driveFlow(['<Tab>', 'm', '1', '<AddCol>', '2', '<Left>', '<Bar>']);
    expect(aug.latex).toContain('\\begin{array}{cc|c}');
    expect(toLatex(parseStreamCode(aug.stream).doc)).toBe(aug.latex);

    // Native inline LaTeX brace flow + vertical navigation across bigops & fractions
    const inlineCalc = driveFlow([
      '\\int_{0}^{\\infty}',
      '\\frac{x^2 }{e^x -1}',
      'dx',
    ]);
    expect(inlineCalc.latex).toBe('\\int_{0}^{\\infty} \\frac{x^2}{e^x - 1}\\,\\mathrm{d}x');
    expect(toLatex(parseStreamCode(inlineCalc.stream).doc)).toBe(inlineCalc.latex);

    // Vertical navigation across fraction, integral, limit, subsup, eval_bar, overbrace, underbrace
    const navFrac = driveFlow(['<Tab>', 'f', 'a', '<Down>', 'b', '<Up>', '+1']);
    expect(navFrac.latex).toBe('\\frac{a + 1}{b}');

    const navInt = driveFlow(['<Tab>', 'i', '0', '<Up>', '1', '<Down>', '+a']);
    expect(navInt.latex).toBe('\\int_{0+a}^{1}');

    const navSubsup = driveFlow(['<Tab>', 'b', 'x', ';', 'i', '<Up>', '2', '<Down>', '+1']);
    expect(navSubsup.latex).toBe('x_{i+1}^2');
  });
});

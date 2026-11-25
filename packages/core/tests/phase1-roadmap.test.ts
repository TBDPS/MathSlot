import { describe, expect, it } from 'vitest';
import {
  MathSlotEngine,
  detectFormulaInLines,
  detectFormulaInWindow,
  detectWrapperFromRaw,
  formatFormulaWithWrapper,
  importFormula,
  toLatex,
} from '../src';

describe('Phase 1 (v2.3.x) Roadmap Stabilization & Fidelity', () => {
  it('preserves \\(...\\) and \\[...\\] wrapper dialect in Obsidian detection and write-back (P1-1)', () => {
    const inlineHit = detectFormulaInLines(['Given \\(a^2 + b^2 = c^2\\) holds.'], {
      line: 0,
      ch: 12,
    });
    expect(inlineHit).not.toBeNull();
    expect(inlineHit?.delimiter).toBe('inline');
    expect(inlineHit?.wrapper).toBe('paren_inline');
    expect(formatFormulaWithWrapper('a^2 + b^2 = c^2', inlineHit!.wrapper)).toBe(
      '\\(a^2 + b^2 = c^2\\)',
    );

    const blockHit = detectFormulaInLines(['\\[', 'E = mc^2', '\\]'], { line: 1, ch: 3 });
    expect(blockHit).not.toBeNull();
    expect(blockHit?.delimiter).toBe('block');
    expect(blockHit?.wrapper).toBe('bracket_block');
    expect(formatFormulaWithWrapper('E = mc^2', blockHit!.wrapper)).toBe('\\[\nE = mc^2\n\\]');

    expect(detectWrapperFromRaw('\\(x+1\\)')).toBe('paren_inline');
    expect(detectWrapperFromRaw('\\[x+1\\]')).toBe('bracket_block');
    expect(detectWrapperFromRaw('$x+1$')).toBe('dollar_inline');
    expect(detectWrapperFromRaw('$$x+1$$')).toBe('dollar_block');
  });

  it('detects formulas accurately in a bounded window near the bottom of a 10,000-line note (P1-1)', () => {
    const windowStart = 9600;
    const windowLines = Array.from({ length: 450 }, (_, idx) => `Paragraph line ${windowStart + idx}`);
    windowLines[400] = 'Formula \\(\\int_0^1 x\\,\\mathrm{d}x\\) at line 10000.';

    const hit = detectFormulaInWindow(windowLines, windowStart, { line: 10000, ch: 16 }, false);
    expect(hit).not.toBeNull();
    expect(hit?.from.line).toBe(10000);
    expect(hit?.to.line).toBe(10000);
    expect(hit?.wrapper).toBe('paren_inline');

    const blocked = detectFormulaInWindow(windowLines, windowStart, { line: 10000, ch: 16 }, true);
    expect(blocked).toBeNull();
  });

  it('tracks native LaTeX brace state across undo/redo and prunes on manual cursor jump (P2-1)', () => {
    const engine = new MathSlotEngine();
    for (const ch of '\\frac{1') {
      engine.insertText(ch);
    }
    // Undo back inside numerator, then redo and finish `}{2}` cleanly
    expect(engine.undo()).toBe(true);
    expect(engine.redo()).toBe(true);
    for (const ch of '}{2}') {
      engine.insertText(ch);
    }
    expect(engine.getSnapshot().latex).toBe('\\frac{1}{2}');

    // Now test manual escape out of numerator: `}` should no longer trigger stale brace-close jump
    const e2 = new MathSlotEngine();
    for (const ch of '\\frac{a') {
      e2.insertText(ch);
    }
    e2.escapeLevel(); // Manually leave numerator to root
    e2.insertText('+');
    e2.insertText('}');
    expect(e2.getSnapshot().latex).toContain('\\}');
  });

  it('parses braced differentials \\mathrm{d}{x} and 3+ row \\substack into editable structures (P2-3)', () => {
    const diffRes = importFormula('\\int \\mathrm{d}{x} + \\mathrm{d}^{2}{\\theta}');
    expect(diffRes.hasRawNodes).toBe(false);
    expect(toLatex(diffRes.doc)).toBe('\\int \\mathrm{d}x + \\mathrm{d}^{2}\\theta');

    const subRes = importFormula('\\sum_{\\substack{1 \\le i \\le n \\\\ 1 \\le j \\le m \\\\ i \\ne j}} a_{i,j}');
    expect(subRes.hasRawNodes).toBe(false);
    expect(toLatex(subRes.doc)).toContain('\\substack{1\\le i\\le n \\\\ 1\\le j\\le m \\\\ i\\neq j}');

    // Verify dynamic row add works inside substack while column add is rejected
    const engine = new MathSlotEngine();
    engine.loadFormula('\\substack{a \\\\ b \\\\ c}');
    engine.moveLeft(); // Enter last row of substack
    expect(engine.addGridCol()).toBe(false);
    expect(engine.addGridRow('below')).toBe(true);
    engine.insertText('d');
    expect(engine.getSnapshot().latex).toBe('\\substack{a \\\\ b \\\\ c \\\\ d}');
  });
});

import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { MathSlotEngine, importFormula, stripOuterDelimiters, toLatex } from '../src';

const typeAll = (engine: MathSlotEngine, text: string) => {
  for (const ch of text) engine.insertText(ch);
};

describe('outer math delimiters', () => {
  it('strips single $...$, $$...$$, \\(...\\), \\[...\\] and fenced latex', () => {
    expect(stripOuterDelimiters('$x^2$')).toBe('x^2');
    expect(stripOuterDelimiters('$$x^2$$')).toBe('x^2');
    expect(stripOuterDelimiters('\\(x^2\\)')).toBe('x^2');
    expect(stripOuterDelimiters('\\[x^2\\]')).toBe('x^2');
    expect(stripOuterDelimiters('  $$x^2$$  ')).toBe('x^2');
    expect(stripOuterDelimiters('```latex\n$x^2$\n```')).toBe('x^2');
    expect(toLatex(importFormula('\\(x^2\\)').doc)).toBe('x^2');
    expect(toLatex(importFormula('$x^2$').doc)).toBe('x^2');
  });

  it('allows escaped dollars inside a single inline formula', () => {
    expect(stripOuterDelimiters('$a + \\$5$')).toBe('a + \\$5');
    expect(toLatex(importFormula('$a + \\$5$').doc)).toBe('a + \\$5');
    expect(stripOuterDelimiters('$$a + \\$5$$')).toBe('a + \\$5');
  });

  it('does not clip multiple formulas or nested delimiters into one', () => {
    expect(stripOuterDelimiters('$x$ + $y$')).toBe('$x$ + $y$');
    expect(stripOuterDelimiters('$$x$$ + $$y$$')).toBe('$$x$$ + $$y$$');
    expect(stripOuterDelimiters('\\(x^2\\) + \\(y^2\\)')).toBe('\\(x^2\\) + \\(y^2\\)');
    expect(stripOuterDelimiters('\\[x^2\\] + \\[y^2\\]')).toBe('\\[x^2\\] + \\[y^2\\]');
  });

  it('leave unclosed delimiters untouched', () => {
    expect(stripOuterDelimiters('$x^2')).toBe('$x^2');
    expect(stripOuterDelimiters('x^2$')).toBe('x^2$');
    expect(stripOuterDelimiters('$$x^2$')).toBe('$$x^2$');
  });
});

describe('plain spaces are separators, not visible layout', () => {
  it('does not emit visible glue for a typed space in math mode', () => {
    const engine = new MathSlotEngine();
    typeAll(engine, 'a b');
    const snapshot = engine.getSnapshot();
    expect(snapshot.latex).toBe('a b');
    expect(snapshot.interactiveLatex).not.toContain('ms-space-active');
    expect(snapshot.interactiveLatex).not.toContain('\\,');
    expect(snapshot.interactiveLatex).not.toContain('\\kern 0.04em');
    expect(() =>
      katex.renderToString(snapshot.interactiveLatex, {
        displayMode: true,
        throwOnError: true,
        strict: false,
        trust: true,
      }),
    ).not.toThrow();
  });

  it('keeps explicit spacing commands visible', () => {
    const engine = new MathSlotEngine();
    typeAll(engine, 'x\\,y');
    expect(engine.getSnapshot().latex).toBe('x\\,y');
    expect(engine.getSnapshot().interactiveLatex).toContain('\\,');
  });

  it('preserves spaces in text mode', () => {
    const engine = new MathSlotEngine();
    engine.insertCommand('text_box');
    typeAll(engine, 'a b');
    expect(engine.getSnapshot().latex).toBe('\\text{a b}');
  });
});

describe('differential shorthand', () => {
  const latexOf = (source: string): string => {
    const engine = new MathSlotEngine();
    typeAll(engine, source);
    return engine.getSnapshot().latex;
  };

  it('recognizes generic single-letter variables, not only x/y/t', () => {
    expect(latexOf('dx')).toBe('\\mathrm{d}x');
    expect(latexOf('da')).toBe('\\mathrm{d}a');
    expect(latexOf('dA')).toBe('\\mathrm{d}A');
    expect(latexOf('dtheta')).toBe('\\mathrm{d}\\theta');

    const engine = new MathSlotEngine();
    // Word shorthands intentionally stay literal while the caret touches the word;
    // they morph once a boundary (the trailing space) commits the token.
    typeAll(engine, 'e da ');
    expect(engine.getSnapshot().interactiveLatex).toContain('\\mathrm{d}a');
  });

  it('uses a separating space or explicit multiplication for literal d·x', () => {
    expect(latexOf('d x')).toBe('d x');
    expect(latexOf('d*x')).toBe('d*x');
    expect(latexOf('d\\cdot x')).toBe('d \\cdot x');
  });

  it('keeps formal LaTeX import verbatim', () => {
    expect(toLatex(importFormula('y=dx').doc)).toBe('y = dx');
    expect(toLatex(importFormula('y=da').doc)).toBe('y = da');
  });
});

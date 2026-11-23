import { describe, expect, it } from 'vitest';
import { MathSlotEngine, formatExport, importFormula, toLatex } from '../src';

describe('MathSlotEngine keyboard flow', () => {
  it('writes Euler identity via Tab leader chords and Enter slot stepping', () => {
    const engine = new MathSlotEngine();
    // Tab u -> sup -> e -> Enter -> i -> Tab g p -> Enter -> + 1 = 0
    engine.triggerLeader();
    engine.handleLeaderKey('u');
    engine.insertText('e');
    engine.nextSlot();
    engine.insertText('i');
    engine.triggerLeader();
    engine.handleLeaderKey('g');
    engine.handleLeaderKey('p');
    engine.nextSlot();
    engine.insertText(' + 1 = 0');

    expect(engine.getSnapshot().latex).toBe('e^{i\\pi} + 1 = 0');
  });

  it('writes sin(x)/x limit using semicolon slot progression and auto-recognizes sin', () => {
    const engine = new MathSlotEngine();
    engine.triggerLeader();
    engine.handleLeaderKey('l');
    engine.insertText('x');
    engine.insertText(';');
    engine.insertText('0');
    engine.insertText(';');
    engine.triggerLeader();
    engine.handleLeaderKey('f');
    engine.insertText('sin x');
    engine.insertText(';');
    engine.insertText('x');
    engine.insertText(';');

    expect(engine.getSnapshot().latex).toBe('\\lim_{x \\to 0} \\frac{\\sin x}{x}');
  });

  it('smart-wraps existing expression ahead when prepending limit', () => {
    const engine = new MathSlotEngine();
    engine.loadFormula('\\frac{\\sin x}{x} = 1');
    engine.moveHome();
    engine.triggerLeader();
    engine.handleLeaderKey('l');
    engine.insertText('x');
    engine.nextSlot();
    engine.insertText('0');

    expect(engine.getSnapshot().latex).toBe('\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1');
  });

  it('supports natural ^ and _ shorthands and upgrades sub+^ into subsup', () => {
    const engine = new MathSlotEngine();
    engine.insertText('x');
    engine.insertText('_');
    engine.insertText('i');
    engine.nextSlot();
    engine.insertText('^');
    engine.insertText('2');

    expect(engine.getSnapshot().latex).toBe('x_i^2');
  });

  it('wraps selected nodes when triggering a structure command', () => {
    const engine = new MathSlotEngine();
    engine.insertText('a+b');
    engine.selectAll();
    engine.triggerLeader();
    engine.handleLeaderKey('f');
    engine.insertText('2');

    expect(engine.getSnapshot().latex).toBe('\\frac{a + b}{2}');
  });

  it('unwraps structure smoothly on Backspace at slot 0 when other slots empty', () => {
    const engine = new MathSlotEngine();
    engine.triggerLeader();
    engine.handleLeaderKey('r');
    engine.insertText('x+1');
    engine.moveHome();
    engine.backspace();

    expect(engine.getSnapshot().latex).toBe('x + 1');
  });

  it('supports Easymotion jump mode to teleport directly into any slot', () => {
    const engine = new MathSlotEngine();
    engine.loadFormula('\\frac{1}{2}');
    engine.enterJumpMode();
    const snap = engine.getSnapshot();
    expect(snap.mode.kind).toBe('jump');
    if (snap.mode.kind === 'jump') {
      const denTarget = snap.mode.targets.find((t) => t.slotLabel === '分母');
      expect(denTarget).toBeDefined();
      engine.handleJumpKey(denTarget!.label);
      engine.insertText('+3');
    }
    expect(engine.getSnapshot().latex).toBe('\\frac{1}{2 + 3}');
  });

  it('expands inline \\alpha + space into SymbolNode', () => {
    const engine = new MathSlotEngine();
    engine.insertText('\\');
    engine.insertText('a');
    engine.insertText('l');
    engine.insertText('p');
    engine.insertText('h');
    engine.insertText('a');
    engine.insertText(' ');
    engine.insertText('+1');
    expect(engine.getSnapshot().latex).toBe('\\alpha + 1');
  });

  it('supports full undo and redo', () => {
    const engine = new MathSlotEngine();
    engine.triggerLeader();
    engine.handleLeaderKey('f');
    engine.insertText('1');
    engine.nextSlot();
    engine.insertText('2');
    expect(engine.getSnapshot().latex).toBe('\\frac{1}{2}');

    engine.undo();
    expect(engine.getSnapshot().latex).toBe('\\frac{1}{}');
    engine.redo();
    expect(engine.getSnapshot().latex).toBe('\\frac{1}{2}');
  });

  it('roundtrips complex LaTeX imports and formats export delimiters', () => {
    const samples = [
      '\\frac{1}{2}',
      '\\sqrt[3]{x + 1}',
      '\\int_{0}^{\\infty} {e}^{-x} dx',
      '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}',
      '\\left(a + b\\right)',
    ];
    for (const s of samples) {
      const res = importFormula(s);
      expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(toLatex(res.doc).length).toBeGreaterThan(0);
    }
    expect(formatExport('x^2', 'inline')).toBe('$x^2$');
    expect(formatExport('x^2', 'block')).toBe('$$\nx^2\n$$');
    expect(formatExport('x^2', 'codeblock')).toBe('```latex\nx^2\n```');
  });

  it('fills fraction denominator before numerator in writing_cn slot order', () => {
    const engine = new MathSlotEngine({ slotOrderPreset: 'writing_cn' });
    engine.insertCommand('frac');
    // Denominator first ("三分之二" -> type 3, Enter, type 2, Enter)
    engine.insertText('3');
    engine.nextSlot();
    engine.insertText('2');
    engine.nextSlot();
    engine.insertText('+1');

    expect(engine.getSnapshot().latex).toBe('\\frac{2}{3} + 1');
  });

  it('supports custom per-command slot order overrides and Shift+Enter reverse traversal', () => {
    const engine = new MathSlotEngine({
      slotOrderOverrides: {
        integral: [2, 0, 1], // body -> lower -> upper
      },
    });
    engine.insertCommand('integral');
    engine.insertText('f(x) dx');
    engine.nextSlot();
    engine.insertText('0');
    engine.nextSlot();
    engine.insertText('1');
    engine.prevSlot();
    engine.insertText('+a');

    expect(engine.getSnapshot().latex).toBe('\\int_{0+a}^{1} f(x)\\,dx');
  });

  it('turns natural / typing into an interactive 2D fraction even under writing_cn order', () => {
    const engine = new MathSlotEngine({ slotOrderPreset: 'writing_cn' });
    engine.insertText('sin x');
    engine.insertText('/');
    engine.insertText('x');
    engine.nextSlot();
    engine.insertText(' = 1');

    expect(engine.getSnapshot().latex).toBe('\\frac{\\sin x}{x} = 1');
  });

  it('auto-expands oo -> \\infty, pi -> \\pi, -> -> \\to, <= -> \\le and lets Ctrl+Z revert', () => {
    const engine = new MathSlotEngine();
    for (const ch of 'x->oo') engine.insertText(ch);
    expect(engine.getSnapshot().latex).toBe('x \\to \\infty');

    // Undo once reverts \infty back to literal oo!
    engine.undo();
    expect(engine.getSnapshot().latex).toBe('x \\to oo');

    engine.clear();
    for (const ch of '2pi <= alpha + beta') engine.insertText(ch);
    expect(engine.getSnapshot().latex).toBe('2\\pi \\le \\alpha + \\beta');

    // Does NOT corrupt English/math words like `sin` or `foo`
    engine.clear();
    for (const ch of 'foo') engine.insertText(ch);
    expect(engine.getSnapshot().latex).toBe('foo');
  });

  it('writes a full Fourier series with clean standard LaTeX, automatic spacing, Space script-exit, and spatial navigation', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    // f(x) = a_0 / 2 + \sum_{n=1}^{\infty} (a_n \cos \frac{n\pi x}{L} + b_n \sin \frac{n\pi x}{L})
    type('f(x)=a_0 /2');
    engine.nextSlot(); // exit frac
    type('+');
    engine.triggerLeader();
    engine.handleLeaderKey('s'); // sum
    type('n=1');
    engine.nextSlot();
    type('oo');
    engine.nextSlot();
    engine.triggerLeader();
    engine.handleLeaderKey('p'); // paren
    type('a_n cos');
    engine.triggerLeader();
    engine.handleLeaderKey('f'); // frac
    type('n pi x');
    engine.nextSlot();
    type('L');
    engine.nextSlot(); // exit frac
    type('+b_n sin');
    engine.triggerLeader();
    engine.handleLeaderKey('f'); // frac
    type('n pi x');
    engine.nextSlot();
    type('L');

    expect(engine.getSnapshot().latex).toBe(
      'f(x) = \\frac{a_0}{2} + \\sum_{n=1}^{\\infty} \\left(a_n \\cos \\frac{n \\pi x}{L} + b_n \\sin \\frac{n \\pi x}{L}\\right)',
    );

    // Spatial navigation: currently in denominator `L` -> ArrowUp goes straight to numerator `n pi x`!
    engine.moveUp();
    expect(engine.getSnapshot().breadcrumbs.at(-1)?.slotLabel).toBe('分子');
    // ArrowDown goes back straight to denominator `L`!
    engine.moveDown();
    expect(engine.getSnapshot().breadcrumbs.at(-1)?.slotLabel).toBe('分母');
    // Alt+ArrowUp (escapeLevel) jumps cleanly out of frac into paren!
    engine.escapeLevel();
    expect(engine.getSnapshot().breadcrumbs.at(-1)?.commandLabel).toBe('括号');
  });

  it('supports user-defined custom structures via Tab k chord and custom shorthand', () => {
    const engine = new MathSlotEngine();
    engine.setCustomCommands([
      {
        id: 'custom-expect',
        label: '数学期望',
        latex: '\\mathbb{E}\\left[$1\\right]',
        slots: ['表达式'],
        key: 'e',
        shorthand: 'EE',
      },
    ]);

    engine.triggerLeader();
    engine.handleLeaderKey('k');
    engine.handleLeaderKey('e');
    engine.insertText('X');
    engine.nextSlot();
    engine.insertText(' + ');
    engine.insertText('E');
    engine.insertText('E');
    engine.insertText('Y');
    expect(engine.getSnapshot().latex).toBe('\\mathbb{E}\\left[X\\right] + \\mathbb{E}\\left[Y\\right]');
  });

  it('imports unbraced \\frac12, \\displaystyle, and equation environments cleanly', () => {
    const res1 = importFormula('\\displaystyle \\frac12 + \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx');
    expect(res1.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(toLatex(res1.doc)).toContain('\\frac{1}{2}');
    expect(toLatex(res1.doc)).toContain('\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx');

    const res2 = importFormula('\\begin{equation} E = mc^2 \\end{equation}');
    expect(toLatex(res2.doc)).toBe('E = mc^2');
  });
});

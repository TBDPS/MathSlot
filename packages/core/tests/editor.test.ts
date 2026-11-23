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
        integral: [1, 0], // upper -> lower
      },
    });
    engine.insertCommand('integral');
    engine.insertText('1');
    engine.nextSlot();
    engine.insertText('0');
    engine.prevSlot();
    engine.insertText('+a');
    engine.nextSlot();
    engine.nextSlot();
    engine.insertText('f(x) dx');

    expect(engine.getSnapshot().latex).toBe('\\int_{0}^{1+a} f(x)\\,\\mathrm{d}x');
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

  it('recognizes isolated-word shorthands (n pi x, oo, alpha, in) without corrupting spin/spi/pin/foo/sin', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    type('x->oo');
    expect(engine.getSnapshot().latex).toBe('x \\to \\infty');
    // Punctuation shorthand `->` can be reverted with Ctrl+Z; `oo` is non-destructive word recognition
    engine.backspace();
    expect(engine.getSnapshot().latex).toBe('x \\to o');

    engine.clear();
    type('n pi x');
    expect(engine.getSnapshot().latex).toBe('n \\pi x');
    expect(engine.getSnapshot().interactiveLatex).toContain('\\pi');

    // Space inside exponents works cleanly (never hijacked by default!)
    engine.clear();
    type('e^i pi');
    expect(engine.getSnapshot().latex).toBe('e^{i \\pi}');

    // Typing `pin`: `p` -> `pi` (\pi) -> `pin` (reverts cleanly to literal `pin`!) -> Backspace -> `\pi`!
    engine.clear();
    type('p');
    expect(engine.getSnapshot().latex).toBe('p');
    type('i');
    expect(engine.getSnapshot().latex).toBe('\\pi');
    type('n');
    expect(engine.getSnapshot().latex).toBe('pin');
    engine.backspace();
    expect(engine.getSnapshot().latex).toBe('\\pi');

    // `spin`, `spi`, `foo`, `sin` are NEVER corrupted!
    for (const literal of ['spin', 'spi', 'foo', 'api', 'epi']) {
      engine.clear();
      type(literal);
      expect(engine.getSnapshot().latex).toBe(literal);
    }

    engine.clear();
    type('2pi <= alpha + beta');
    expect(engine.getSnapshot().latex).toBe('2\\pi \\le \\alpha + \\beta');

    engine.clear();
    type('x in A, a ~ b, c ~~ d, e ~= f');
    expect(engine.getSnapshot().latex).toBe('x \\in A, a \\sim b, c \\approx d, e \\cong f');
  });

  it('auto-closes (), [], {}, skips on closing bracket or Enter, deletes empty pairs, wraps selection, and smart-sizes', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    // Flat `f(x)` typed naturally: `(` opens pair, `x` inside, `)` skips right out -> crisp `f(x)`
    type('f(x)+1');
    expect(engine.getSnapshot().latex).toBe('f(x) + 1');

    // Empty pair Backspace removes both in one stroke
    engine.clear();
    type('(');
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['括号']);
    engine.backspace();
    expect(engine.getSnapshot().breadcrumbs).toEqual([]);
    expect(engine.getSnapshot().latex).toBe('');

    // Selection + `[` wraps selection and lands after closing `]`
    type('a+b');
    engine.selectAll();
    type('[');
    type('+c');
    expect(engine.getSnapshot().latex).toBe('[a + b] + c');

    // Tall content inside keyboard `(` / `[` auto-sizes to `\left(...\right)` / `\left[...\right]`!
    engine.clear();
    type('[(1/2)+3]');
    expect(engine.getSnapshot().latex).toBe('\\left[\\left(\\frac{1}{2}\\right) + 3\\right]');
  });

  it('supports jump history (Alt+Left/Alt+Right, Esc -, Esc .) and Tab j jump alias', () => {
    const engine = new MathSlotEngine();
    engine.loadFormula('\\frac{1}{2} + x');
    // Tab j enters jump mode (v0.7/v0.8 muscle memory)
    engine.triggerLeader();
    engine.handleLeaderKey('j');
    const snap = engine.getSnapshot();
    expect(snap.mode.kind).toBe('jump');
    if (snap.mode.kind === 'jump') {
      const numTarget = snap.mode.targets.find((t) => t.slotLabel === '分子')!;
      engine.handleJumpKey(numTarget.label);
      engine.insertText('+a');
      expect(engine.getSnapshot().latex).toBe('\\frac{1 + a}{2} + x');

      // Jump back to end of root via jumpBack (Alt+Left)
      expect(engine.jumpBack()).toBe(true);
      engine.insertText('+y');
      expect(engine.getSnapshot().latex).toBe('\\frac{1 + a}{2} + x + y');

      // Esc . jumps straight to end of formula
      engine.enterJumpMode();
      engine.handleJumpKey(numTarget.label);
      engine.enterJumpMode();
      engine.handleJumpKey('.');
      engine.insertText('+z');
      expect(engine.getSnapshot().latex).toBe('\\frac{1 + a}{2} + x + y + z');
    }
  });

  it('writes the exact user-specified Fourier series smoothly with natural spaces (n pi x), auto-brackets, upright \\mathrm{d}x, and clean hierarchy', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    // Target:
    // f(x) \sim \frac{1}{2l} \int_{-l}^{l} f(x)\,\mathrm{d}x + \sum_{n=1}^{\infty} \left[\left(\frac{1}{l} \int_{-l}^{l} f(x) \cos \frac{n \pi x}{l}\,\mathrm{d}x\right) \cos \frac{n \pi x}{l} + \left(\frac{1}{l} \int_{-l}^{l} f(x) \sin \frac{n \pi x}{l}\,\mathrm{d}x\right) \sin \frac{n \pi x}{l}\right]
    type('f(x) ~ 1/2l');
    engine.nextSlot(); // exit frac -> root
    engine.triggerLeader();
    engine.handleLeaderKey('i'); // \int_{}^{}
    type('-l');
    engine.nextSlot();
    type('l');
    engine.nextSlot(); // exit \int -> root
    type('f(x) dx + ');
    engine.triggerLeader();
    engine.handleLeaderKey('s'); // \sum_{}^{}
    type('n=1');
    engine.nextSlot();
    type('oo');
    engine.nextSlot(); // exit \sum -> root

    // Natural keyboard `[` and `(` auto-pair and auto-size!
    type('[');
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['中括号']);
    type('(');
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['中括号', '括号']);

    type('1/l');
    engine.nextSlot(); // back in paren!
    engine.triggerLeader();
    engine.handleLeaderKey('i');
    type('-l');
    engine.nextSlot();
    type('l');
    engine.nextSlot(); // exits \int -> STILL INSIDE paren!
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['中括号', '括号']);

    type('f(x) cos n pi x/l');
    engine.nextSlot(); // exit frac -> STILL inside paren!
    type(' dx');
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['中括号', '括号']);

    type(')'); // Overtype `)` (or Enter) cleanly exits paren -> back in bracket!
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['中括号']);

    type(' cos n pi x/l');
    engine.nextSlot(); // back in bracket
    type(' + (');
    type('1/l');
    engine.nextSlot();
    engine.triggerLeader();
    engine.handleLeaderKey('i');
    type('-l');
    engine.nextSlot();
    type('l');
    engine.nextSlot();
    type('f(x) sin n pi x/l');
    engine.nextSlot();
    type(' dx');
    engine.nextSlot(); // ONE clean Enter also exits paren -> back in bracket!
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['中括号']);

    type(' sin n pi x/l');
    engine.nextSlot(); // back in bracket
    type(']'); // Overtype `]` (or Enter) cleanly exits bracket -> root!
    expect(engine.getSnapshot().breadcrumbs).toEqual([]);

    expect(engine.getSnapshot().latex).toBe(
      'f(x) \\sim \\frac{1}{2l} \\int_{-l}^{l} f(x)\\,\\mathrm{d}x + \\sum_{n=1}^{\\infty} \\left[\\left(\\frac{1}{l} \\int_{-l}^{l} f(x) \\cos \\frac{n \\pi x}{l}\\,\\mathrm{d}x\\right) \\cos \\frac{n \\pi x}{l} + \\left(\\frac{1}{l} \\int_{-l}^{l} f(x) \\sin \\frac{n \\pi x}{l}\\,\\mathrm{d}x\\right) \\sin \\frac{n \\pi x}{l}\\right]',
    );
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
    expect(toLatex(res1.doc)).toContain('\\int_{-\\infty}^{\\infty} e^{-x^2}\\,\\mathrm{d}x');

    const res2 = importFormula('\\begin{equation} E = mc^2 \\end{equation}');
    expect(toLatex(res2.doc)).toBe('E = mc^2');
  });
});

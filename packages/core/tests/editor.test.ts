import { describe, expect, it } from 'vitest';
import { MathSlotEngine, formatExport, importFormula, toLatex } from '../src';

describe('MathSlotEngine keyboard flow', () => {
  it('writes Euler identity via natural ^ and Tab leader chords', () => {
    const engine = new MathSlotEngine();
    // e^i -> Tab g p -> Enter -> + 1 = 0
    engine.insertText('e');
    engine.insertText('^');
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

  it('supports hierarchical Easymotion jump mode including plain text terms between two integrals', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    // Build: \int_{0}^{1} x^2\,\mathrm{d}x + 42 + \int_{0}^{1} y^2\,\mathrm{d}y
    engine.triggerLeader();
    engine.handleLeaderKey('i');
    type('0');
    engine.nextSlot();
    type('1');
    engine.nextSlot();
    type('x^2');
    engine.nextSlot(); // exit sup -> still inside integral body!
    type(' dx');
    engine.nextSlot(); // exit integral -> root!
    expect(engine.getSnapshot().breadcrumbs).toEqual([]);

    type(' + 42 + '); // plain number in the middle sits cleanly at root level!

    engine.triggerLeader();
    engine.handleLeaderKey('i');
    type('0');
    engine.nextSlot();
    type('1');
    engine.nextSlot();
    type('y^2');
    engine.nextSlot();
    type(' dy');
    engine.nextSlot();

    expect(engine.getSnapshot().latex).toBe(
      '\\int_{0}^{1} x^2\\,\\mathrm{d}x + 42 + \\int_{0}^{1} y^2\\,\\mathrm{d}y',
    );

    // 1. Jump directly to the plain `42` term at root level and modify it to `99`!
    engine.enterJumpMode();
    const snap1 = engine.getSnapshot();
    expect(snap1.mode.kind).toBe('jump');
    if (snap1.mode.kind === 'jump') {
      const plain42 = snap1.mode.targets.find((t) => t.anchorKind === 'text-term');
      expect(plain42).toBeDefined();
      engine.handleJumpKey(plain42!.label);
      engine.backspace();
      engine.backspace();
      type('99');
    }
    expect(engine.getSnapshot().latex).toBe(
      '\\int_{0}^{1} x^2\\,\\mathrm{d}x + 99 + \\int_{0}^{1} y^2\\,\\mathrm{d}y',
    );

    // 2. Drill down into composite integral 1 body (`x^2 dx`) -> jump directly to exponent `2` -> change to `3`!
    engine.enterJumpMode();
    const snap2 = engine.getSnapshot();
    if (snap2.mode.kind === 'jump') {
      const body1 = snap2.mode.targets.find((t) => t.isComposite && t.slotLabel === '积分·被积式');
      expect(body1).toBeDefined();
      engine.handleJumpKey(body1!.label);
      const subSnap = engine.getSnapshot();
      expect(subSnap.mode.kind).toBe('jump');
      if (subSnap.mode.kind === 'jump') {
        expect(subSnap.mode.scopePath.length).toBe(1);
        const expTarget = subSnap.mode.targets.find((t) => t.slotLabel === '上标·指数');
        expect(expTarget).toBeDefined();
        engine.handleJumpKey(expTarget!.label);
        engine.backspace();
        type('3');
      }
    }
    expect(engine.getSnapshot().latex).toBe(
      '\\int_{0}^{1} x^3\\,\\mathrm{d}x + 99 + \\int_{0}^{1} y^2\\,\\mathrm{d}y',
    );
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
        integral: [1, 0, 2], // upper -> lower -> integrand
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

    // Space inside explicit braced exponents (`e^{i pi}`) stays inside until `}`;
    // and with `spaceExitsScript: false`, unbraced `e^i pi` also keeps Space inside!
    engine.clear();
    type('e^{i pi}');
    expect(engine.getSnapshot().latex).toBe('e^{i \\pi}');

    const unbracedSpaceEngine = new MathSlotEngine({ spaceExitsScript: false });
    for (const ch of 'e^i pi') unbracedSpaceEngine.insertText(ch);
    expect(unbracedSpaceEngine.getSnapshot().latex).toBe('e^{i \\pi}');

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
      const numTarget = snap.mode.targets.find((t) => t.slotLabel.endsWith('分子'))!;
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

  it('writes the exact user-specified Fourier series smoothly with 3-slot semantic integrals/sums, natural spaces (n pi x), auto-brackets, and 1-level-per-Enter hierarchy', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    // Target:
    // f(x) \sim \frac{1}{2l} \int_{-l}^{l} f(x)\,\mathrm{d}x + \sum_{n=1}^{\infty} \left[\left(\frac{1}{l} \int_{-l}^{l} f(x) \cos \frac{n \pi x}{l}\,\mathrm{d}x\right) \cos \frac{n \pi x}{l} + \left(\frac{1}{l} \int_{-l}^{l} f(x) \sin \frac{n \pi x}{l}\,\mathrm{d}x\right) \sin \frac{n \pi x}{l}\right]
    type('f(x) ~ 1/2l');
    engine.nextSlot(); // exit frac -> root
    engine.triggerLeader();
    engine.handleLeaderKey('i'); // \int_{}^{} [被积式]
    type('-l');
    engine.nextSlot();
    type('l');
    engine.nextSlot(); // enters 积分·被积式!
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.slotLabel)).toEqual(['被积式']);
    type('f(x) dx');
    engine.nextSlot(); // exits 积分 -> root!
    expect(engine.getSnapshot().breadcrumbs).toEqual([]);

    type(' + ');
    engine.triggerLeader();
    engine.handleLeaderKey('s'); // \sum_{}^{} [求和主体]
    type('n=1');
    engine.nextSlot();
    type('oo');
    engine.nextSlot(); // enters 求和·求和主体!
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.slotLabel)).toEqual(['求和主体']);

    // Natural keyboard `[` and `(` inside 求和主体
    type('[');
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['求和', '中括号']);
    type('(');
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['求和', '中括号', '括号']);

    type('1/l');
    engine.nextSlot(); // back in 括号!
    engine.triggerLeader();
    engine.handleLeaderKey('i');
    type('-l');
    engine.nextSlot();
    type('l');
    engine.nextSlot(); // enters 积分·被积式 (nested inside 括号!)
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['求和', '中括号', '括号', '积分']);

    type('f(x) cos n pi x/l');
    engine.nextSlot(); // exit frac -> still inside 积分·被积式!
    type(' dx');
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['求和', '中括号', '括号', '积分']);

    // Enter #1 exits ONLY 定积分 -> lands INSIDE 括号 (NOT outside 括号!)
    engine.nextSlot();
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['求和', '中括号', '括号']);

    // `)` (or Enter #2) exits 括号 -> lands inside 中括号!
    type(')');
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['求和', '中括号']);

    type(' cos n pi x/l');
    engine.nextSlot(); // back in 中括号
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
    // Enter #1 exits 定积分 -> still inside 括号!
    engine.nextSlot();
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['求和', '中括号', '括号']);
    // Enter #2 exits 括号 -> back in 中括号!
    engine.nextSlot();
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['求和', '中括号']);

    type(' sin n pi x/l');
    engine.nextSlot(); // back in 中括号
    type(']'); // exits 中括号 -> back in 求和主体!
    expect(engine.getSnapshot().breadcrumbs.map((b) => b.commandLabel)).toEqual(['求和']);
    engine.nextSlot(); // exits 求和 -> root!
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

    // Plain (...) roundtrip preserves bracket structure and two adjacent integrals stay separate!
    const res3 = importFormula('\\int_0^1 x\\,\\mathrm{d}x \\cdot \\int_0^1 y\\,\\mathrm{d}y + (a + b)');
    expect(res3.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const intStructs = res3.doc.root.children.filter(
      (n) => n.type === 'struct' && n.commandId === 'integral',
    );
    expect(intStructs.length).toBe(2);
    expect(res3.doc.root.children.some((n) => n.type === 'struct' && n.commandId === 'paren')).toBe(
      true,
    );
  });

  it('supports backward atom wrap (x + Tab a c -> \\vec{x}), Tab t snippet chord, custom breadcrumbs, dynamic matrix resize, and aligned multi-line equations', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    // 1. Backward atom wrap for accents without manual selection
    type('x');
    engine.triggerLeader();
    engine.handleLeaderKey('a');
    engine.handleLeaderKey('c'); // \vec{x}
    expect(engine.getSnapshot().latex).toBe('\\vec{x}');

    // 2. Tab t <key> snippet chord insertion
    engine.clear();
    engine.setSnippets([
      { id: 's1', name: '高斯核', latex: 'e^{-x^2}', key: 'g', createdAt: 1 },
    ]);
    engine.triggerLeader();
    engine.handleLeaderKey('t');
    engine.handleLeaderKey('g');
    expect(engine.getSnapshot().latex).toBe('e^{-x^2}');

    // 3. Custom structure breadcrumb displays real label
    engine.clear();
    engine.setCustomCommands([
      { id: 'c-exp', label: '数学期望', latex: '\\mathbb{E}\\left[$1\\right]', slots: ['随机变量'], key: 'e' },
    ]);
    engine.insertCommand('c-exp');
    expect(engine.getSnapshot().breadcrumbs.map((b) => `${b.commandLabel}·${b.slotLabel}`)).toEqual([
      '数学期望·随机变量',
    ]);

    // 4. Dynamic matrix row/col add & remove + 2D Up/Down navigation
    engine.clear();
    engine.insertCommand('matrix_2x2'); // 2x2
    type('1');
    engine.nextSlot();
    type('2');
    engine.addGridCol(); // -> 2x3! cursor at (1,3)
    expect(engine.getSnapshot().activeGrid?.rows).toBe(2);
    expect(engine.getSnapshot().activeGrid?.cols).toBe(3);
    type('3');
    engine.addGridRow(); // -> 3x3! cursor at (2,1)
    expect(engine.getSnapshot().activeGrid?.rows).toBe(3);
    type('4');
    engine.moveUp(); // jumps cleanly to (1,1) = `1`!
    type('0');
    expect(engine.getSnapshot().latex).toContain('\\begin{pmatrix} 10 & 2 & 3 \\\\ 4 & & \\\\ & & \\end{pmatrix}');
    engine.removeGridCol(); // removes col 1 -> 3x2
    expect(engine.getSnapshot().activeGrid?.cols).toBe(2);

    // 5. Smart aligned multi-line equations on Enter at root
    engine.clear();
    type('f(x) = x^2');
    engine.nextSlot(); // exit sup
    engine.nextSlot(); // root Enter -> line break!
    type('= (x)(x)');
    expect(engine.getSnapshot().latex).toBe('\\begin{aligned} f(x) &= x^2 \\\\ &= (x)(x) \\end{aligned}');

    // 6. Drag selection & double-click word selection
    engine.clear();
    type('alpha + beta');
    engine.selectWordOrAtomAt(engine.getSnapshot().doc.root.id, 1);
    expect(engine.getSelectedLatex()).toBe('\\alpha');
  });

  it('supports unified adaptive optional slots (sqrt -> nth_root, integral -> indef/lower-only, sum, double_integral, eval_bar, subsup)', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    // 1. Unified `Tab r` root: leave index empty -> crisp `\sqrt{x + 1}` with 0 unfilled required slots!
    engine.triggerLeader();
    engine.handleLeaderKey('r');
    type('x+1');
    engine.nextSlot(); // hops into optional index slot
    engine.nextSlot(); // leaves index empty & exits -> `\sqrt{x + 1}`!
    expect(engine.getSnapshot().latex).toBe('\\sqrt{x + 1}');
    expect(engine.getSnapshot().emptySlotCount).toBe(0);
    expect(engine.getSnapshot().interactiveLatex).not.toContain('\\sqrt[');

    // Now step back inside `\sqrt{x + 1}` and press Up to reveal optional root index -> type `3` -> `\sqrt[3]{x + 1}`!
    engine.moveLeft(); // glides directly into `被开方式` (`x + 1|`)
    engine.moveUp(); // hops up into optional `根指数`!
    type('3');
    expect(engine.getSnapshot().latex).toBe('\\sqrt[3]{x + 1}');
    expect(engine.getSnapshot().interactiveLatex).toContain('\\sqrt[');

    // 2. Unified `Tab i` integral: skip both limits -> clean indefinite `\int f(x)\,\mathrm{d}x`!
    engine.clear();
    engine.triggerLeader();
    engine.handleLeaderKey('i');
    engine.nextSlot(); // skip lower
    engine.nextSlot(); // skip upper
    type('f(x) dx');
    engine.nextSlot(); // exit integral
    expect(engine.getSnapshot().latex).toBe('\\int f(x)\\,\\mathrm{d}x');
    expect(engine.getSnapshot().emptySlotCount).toBe(0);
    expect(engine.getSnapshot().interactiveLatex).not.toContain('_{');

    // Only lower limit filled (e.g. `\int_D` or `\sum_{i \in S}`) omits empty upper `^{}`!
    engine.clear();
    engine.triggerLeader();
    engine.handleLeaderKey('s');
    type('i in S');
    engine.nextSlot(); // upper
    engine.nextSlot(); // skip upper -> body
    type('a_i');
    engine.nextSlot();
    engine.nextSlot();
    expect(engine.getSnapshot().latex).toBe('\\sum_{i\\in S} a_i');

    // Imported `\sqrt{x}` and `\int f(x) dx` upgrade seamlessly in-place!
    engine.loadFormula('\\int f(x)\\,\\mathrm{d}x');
    engine.moveLeft(); // enters body
    engine.moveDown(); // hops to lower limit
    type('0');
    engine.moveUp(); // hops to upper limit
    type('1');
    expect(engine.getSnapshot().latex).toBe('\\int_{0}^{1} f(x)\\,\\mathrm{d}x');
  });

  it('renders single-key submenu defaults live with smart fallthrough and seamless 2nd-key morph', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    // 1. Single-key `Tab m` immediately renders 2x2 matrix + smart fallthrough typing `1`!
    engine.triggerLeader();
    engine.handleLeaderKey('m');
    expect(engine.getSnapshot().latex).toContain('\\begin{pmatrix}');
    engine.handleLeaderKey('1'); // not a 2nd key of `m` -> commits matrix & types `1` into (1,1)!
    engine.nextSlot();
    type('2');
    engine.nextSlot();
    type('3');
    engine.nextSlot();
    type('4');
    expect(engine.getSnapshot().latex).toBe('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}');

    // 2. Seamless 2nd-key morph: `Tab m d` morphs 2x2 matrix -> cases_2 cleanly with single-step undo!
    engine.clear();
    engine.triggerLeader();
    engine.handleLeaderKey('m');
    expect(engine.getSnapshot().latex).toContain('\\begin{pmatrix}');
    engine.handleLeaderKey('d');
    expect(engine.getSnapshot().latex).toContain('\\begin{cases}');
    engine.undo();
    expect(engine.getSnapshot().latex).toBe('');

    // 3. Single-key `Tab c` defaults to partial_frac (`\frac{\partial}{\partial}`) + smart fallthrough!
    engine.clear();
    engine.triggerLeader();
    engine.handleLeaderKey('c');
    engine.handleLeaderKey('y'); // not a `c` subkey -> commits partial_frac & types `y`!
    engine.nextSlot();
    type('x');
    expect(engine.getSnapshot().latex).toBe('\\frac{\\partial y}{\\partial x}');

    // 4. Single-key `Tab g` defaults to `\alpha`, `Tab g +` falls through, `Tab g p` morphs to `\pi`!
    engine.clear();
    engine.triggerLeader();
    engine.handleLeaderKey('g');
    expect(engine.getSnapshot().latex).toBe('\\alpha');
    engine.handleLeaderKey('+');
    type('1');
    expect(engine.getSnapshot().latex).toBe('\\alpha + 1');

    // 5. `x` + `Tab a` wraps into `\hat{x}`, `Tab a` + `Esc` reverts cleanly, `Tab a c` morphs to `\vec{x}`!
    engine.clear();
    type('x');
    engine.triggerLeader();
    engine.handleLeaderKey('a');
    expect(engine.getSnapshot().latex).toBe('\\hat{x}');
    engine.cancelLeader();
    expect(engine.getSnapshot().latex).toBe('x');

    engine.triggerLeader();
    engine.handleLeaderKey('a');
    engine.handleLeaderKey('c');
    expect(engine.getSnapshot().latex).toBe('\\vec{x}');
  });

  it('releases u/d/b keys, supports 4-directional Shift+Arrow grid growth, ellipsis shorthands, and n-order Vandermonde determinant via Tab m j', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    // 1. u and d leader keys are released, while b is kept for adaptive subsup!
    for (const k of ['u', 'd']) {
      engine.triggerLeader();
      engine.handleLeaderKey(k);
      expect(engine.getSnapshot().latex).toBe('');
    }
    type('x');
    engine.triggerLeader();
    engine.handleLeaderKey('b'); // wraps `x` into subsup!
    engine.nextSlot(); // skip empty sub
    type('2'); // only sup filled -> `x^2`!
    engine.nextSlot();
    expect(engine.getSnapshot().latex).toBe('x^2');
    engine.clear();

    // 2. Ellipsis shorthands: `...` -> \cdots, `:::` / `vdots` -> \vdots, `ddots` -> \ddots
    type('... + ::: + ddots');
    expect(engine.getSnapshot().latex).toBe('\\cdots + \\vdots + \\ddots');

    // 3. Build Vandermonde determinant with `Tab m j` (`det_ellipsis`) + `addGridRow('below')` & `addGridRow('above')` / `addGridCol('left')`!
    engine.clear();
    engine.triggerLeader();
    engine.handleLeaderKey('m');
    engine.handleLeaderKey('j');
    expect(engine.getSnapshot().activeGrid?.rows).toBe(4);
    expect(engine.getSnapshot().activeGrid?.cols).toBe(4);
    expect(engine.getSnapshot().latex).toContain('\\begin{vmatrix}');
    expect(engine.getSnapshot().latex).toContain('\\cdots');
    expect(engine.getSnapshot().latex).toContain('\\vdots');
    expect(engine.getSnapshot().latex).toContain('\\ddots');

    // Fill row 1: 1, 1, (cdots), 1
    type('1');
    engine.nextSlot();
    type('1');
    engine.nextSlot(); // skips over prefilled \cdots
    engine.nextSlot();
    type('1');
    engine.nextSlot(); // row 2 col 1
    type('x_1');
    engine.nextSlot(); // exit sub
    engine.nextSlot(); // row 2 col 2
    type('x_2');
    engine.nextSlot();
    engine.nextSlot(); // skip \cdots
    engine.nextSlot(); // row 2 col 4
    type('x_n');
    engine.nextSlot();

    // Insert row below row 2 (`Shift+↓`) for x_1^2, x_2^2, \cdots, x_n^2 -> now 5×4!
    engine.addGridRow('below');
    expect(engine.getSnapshot().activeGrid?.rows).toBe(5);
    type('x_1');
    engine.nextSlot();
    type('^2');
    engine.nextSlot();
    engine.nextSlot();
    type('x_2');
    engine.nextSlot();
    type('^2');
    engine.nextSlot();
    engine.nextSlot();
    type('...');
    engine.nextSlot();
    type('x_n');
    engine.nextSlot();
    type('^2');
    engine.nextSlot();

    // Verify 4-directional add above / left too!
    engine.clear();
    engine.insertCommand('matrix_2x2');
    type('B');
    engine.addGridCol('left');
    type('A');
    engine.addGridRow('above');
    type('T');
    expect(engine.getSnapshot().activeGrid?.rows).toBe(3);
    expect(engine.getSnapshot().activeGrid?.cols).toBe(3);
    expect(engine.getSnapshot().latex).toBe('\\begin{pmatrix} T & & \\\\ A & B & \\\\ & & \\end{pmatrix}');
  });

  it('supports native LaTeX inline command compatibility (\\int, \\int_, \\frac{, \\sqrt[, \\sum_, \\alpha_1, \\vdots, \\pmatrix)', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    // 1. `\int_` immediately enters integral lower limit; `\int ` + Enter/Enter creates indefinite integral
    type('\\int_0');
    engine.nextSlot();
    type('1');
    engine.nextSlot();
    type('f(x) dx');
    engine.nextSlot();
    expect(engine.getSnapshot().latex).toBe('\\int_{0}^{1} f(x)\\,\\mathrm{d}x');

    // 2. `\frac{a` + Enter + `b` + Enter -> `\frac{a}{b}`
    engine.clear();
    type('\\frac{a');
    engine.nextSlot();
    type('b');
    engine.nextSlot();
    expect(engine.getSnapshot().latex).toBe('\\frac{a}{b}');

    // 3. `\sqrt[3` + Enter + `8` + Enter -> `\sqrt[3]{8}`
    engine.clear();
    type('\\sqrt[3');
    engine.nextSlot();
    type('8');
    engine.nextSlot();
    expect(engine.getSnapshot().latex).toBe('\\sqrt[3]{8}');

    // 4. `\alpha_1 + \beta^2 + \vdots ` -> `\alpha_1 + \beta^2 + \vdots`
    engine.clear();
    type('\\alpha_1');
    engine.nextSlot();
    type(' + \\beta^2');
    engine.nextSlot();
    type(' + \\vdots ');
    expect(engine.getSnapshot().latex).toBe('\\alpha_1 + \\beta^2 + \\vdots');

    // 5. `\int` + Enter expands into real interactive integral (cursor in lower limit!)
    engine.clear();
    type('\\int');
    engine.nextSlot(); // expands \int!
    engine.nextSlot(); // skip lower
    engine.nextSlot(); // skip upper
    type('x dx');
    engine.nextSlot();
    expect(engine.getSnapshot().latex).toBe('\\int x\\,\\mathrm{d}x');
  });

  it('adds and removes matrix rows and columns symmetrically (including after Tab m live default)', () => {
    const engine = new MathSlotEngine();
    // Tab m inserts default 2x2 pmatrix
    engine.triggerLeader();
    engine.handleLeaderKey('m');
    expect(engine.getSnapshot().activeGrid?.rows).toBe(2);
    expect(engine.getSnapshot().activeGrid?.cols).toBe(2);

    // Add row below (3x2) and col right (3x3)
    expect(engine.addGridRow('below')).toBe(true);
    expect(engine.addGridCol('right')).toBe(true);
    expect(engine.getSnapshot().activeGrid?.rows).toBe(3);
    expect(engine.getSnapshot().activeGrid?.cols).toBe(3);

    // Remove current row (2x3) and current col (2x2)
    expect(engine.removeGridRow()).toBe(true);
    expect(engine.getSnapshot().activeGrid?.rows).toBe(2);
    expect(engine.removeGridCol()).toBe(true);
    expect(engine.getSnapshot().activeGrid?.cols).toBe(2);

    // Remove down to 1x1 and refuse going below 1x1
    expect(engine.removeGridRow()).toBe(true);
    expect(engine.removeGridRow()).toBe(false);
    expect(engine.removeGridCol()).toBe(true);
    expect(engine.removeGridCol()).toBe(false);
    expect(engine.getSnapshot().activeGrid?.rows).toBe(1);
    expect(engine.getSnapshot().activeGrid?.cols).toBe(1);
  });
});

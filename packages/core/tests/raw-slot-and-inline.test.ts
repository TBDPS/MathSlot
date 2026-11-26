import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INLINE_SETTINGS,
  MathSlotEngine,
  createEmptyInlineSession,
  findEnclosingMathSpan,
  getLeaderCapsuleItems,
  handleInlineCharTyped,
  handleInlineLeaderKey,
  handleInlineLeaderTrigger,
  handleInlinePrevSlot,
  handleInlineSemicolon,
  handleInlineSpecialKey,
  mapInlineSessionThroughChange,
  parseStreamCode,
  registerRawLatexValidator,
  toStreamCode,
  type InlineActionResult,
  type InlineExpanderSettings,
  type InlineMathSpan,
  type InlineSessionState,
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

class InlineBufferHarness {
  public doc: string;
  public pos: number;
  public session: InlineSessionState = createEmptyInlineSession();
  public settings: InlineExpanderSettings;
  public openedWorkbenchSpan: InlineMathSpan | null = null;

  constructor(docWithPipeCursor: string, settingsPatch: Partial<InlineExpanderSettings> = {}) {
    const pipeIdx = docWithPipeCursor.indexOf('|');
    if (pipeIdx === -1) {
      throw new Error('Expected `|` cursor marker in initial document');
    }
    this.doc = docWithPipeCursor.slice(0, pipeIdx) + docWithPipeCursor.slice(pipeIdx + 1);
    this.pos = pipeIdx;
    this.settings = { ...DEFAULT_INLINE_SETTINGS, ...settingsPatch };
  }

  public snapshotWithCursor(): string {
    return `${this.doc.slice(0, this.pos)}|${this.doc.slice(this.pos)}`;
  }

  private applyRawEdit(from: number, to: number, insert: string, nextPos?: number): void {
    this.doc = this.doc.slice(0, from) + insert + this.doc.slice(to);
    this.pos = nextPos ?? from + insert.length;
  }

  private applyAction(res: InlineActionResult, mathSpan: InlineMathSpan): boolean {
    if (res.kind === 'noop') return false;
    if (res.kind === 'open_workbench') {
      this.session = res.state;
      this.openedWorkbenchSpan = mathSpan;
      return true;
    }
    if (res.kind === 'handled') {
      if (res.changes) {
        this.applyRawEdit(res.changes.from, res.changes.to, res.changes.insert, res.selection);
      } else if (res.selection !== undefined) {
        this.pos = res.selection;
      }
      this.session = res.state;
      return true;
    }
    return false;
  }

  public pressKey(key: string, opts: { shiftKey?: boolean } = {}): void {
    const mathSpan = findEnclosingMathSpan(this.doc, this.pos);
    if (!this.settings.enabled || !mathSpan) {
      if (key.length === 1) {
        this.applyRawEdit(this.pos, this.pos, key);
        this.session = createEmptyInlineSession();
      }
      return;
    }

    if (this.session.leader) {
      if (key === this.settings.leaderKey && !opts.shiftKey) {
        const res = handleInlineLeaderTrigger(this.session);
        if (this.applyAction(res, mathSpan)) return;
      }
      const res = handleInlineLeaderKey(this.doc, this.pos, key, this.session, this.settings);
      if (res.kind === 'commit_and_fallthrough') {
        this.session = res.state;
        if (key.length === 1) {
          const charRes = handleInlineCharTyped(
            this.doc,
            this.pos,
            mathSpan,
            key,
            this.session,
            this.settings,
          );
          if (this.applyAction(charRes, mathSpan)) return;
          const oldPos = this.pos;
          this.applyRawEdit(oldPos, oldPos, key);
          const updatedSpan = findEnclosingMathSpan(this.doc, this.pos);
          this.session = mapInlineSessionThroughChange(
            this.session,
            oldPos,
            oldPos,
            1,
            this.pos,
            updatedSpan,
          );
        }
        return;
      }
      if (this.applyAction(res, mathSpan)) return;
    }

    if (key === this.settings.leaderKey && !opts.shiftKey) {
      const res = handleInlineLeaderTrigger(this.session);
      if (this.applyAction(res, mathSpan)) return;
    }

    if (key === 'Tab' && opts.shiftKey) {
      const res = handleInlinePrevSlot(this.pos, this.session, mathSpan);
      if (this.applyAction(res, mathSpan)) return;
      return;
    }

    if (key === ';') {
      const semiRes = handleInlineSemicolon(this.doc, this.pos, this.session, mathSpan, this.settings);
      if (this.applyAction(semiRes, mathSpan)) return;
    }

    if (this.session.rawSpan && (key === 'Enter' || key === 'ArrowRight')) {
      const specRes = handleInlineSpecialKey(this.doc, this.pos, key, this.session);
      if (this.applyAction(specRes, mathSpan)) return;
    }

    if (key === 'ArrowRight') {
      this.pos = Math.min(this.doc.length, this.pos + 1);
      const nextSpan = findEnclosingMathSpan(this.doc, this.pos);
      if (!nextSpan) this.session = createEmptyInlineSession();
      else if (this.session.rawSpan && (this.pos < this.session.rawSpan.from || this.pos > this.session.rawSpan.to)) {
        this.session = { ...this.session, rawSpan: null };
      }
      return;
    }

    if (key === 'ArrowLeft') {
      this.pos = Math.max(0, this.pos - 1);
      return;
    }

    if (key.length === 1) {
      const charRes = handleInlineCharTyped(
        this.doc,
        this.pos,
        mathSpan,
        key,
        this.session,
        this.settings,
      );
      if (this.applyAction(charRes, mathSpan)) return;
      const oldPos = this.pos;
      this.applyRawEdit(oldPos, oldPos, key);
      const updatedSpan = findEnclosingMathSpan(this.doc, this.pos);
      this.session = mapInlineSessionThroughChange(
        this.session,
        oldPos,
        oldPos,
        1,
        this.pos,
        updatedSpan,
      );
    }
  }

  public typeSeq(text: string): void {
    for (const ch of text) {
      this.pressKey(ch);
    }
  }
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

    // Exiting via Enter (`nextSlot`) returns to root math context where sugar resumes
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
      // 1. Editing half-typed unclosed `\frac{1` inside `\sqrt{...}` must NOT crash outer KaTeX!
      const editingSnap = engine.getSnapshot();
      expect(editingSnap.interactiveLatex).toContain('ms-raw-slot-editing');
      expect(() => strictKatexInteractiveRender(editingSnap.interactiveLatex)).not.toThrow();

      // 2. Pressing ArrowRight at trailing edge while unbalanced (`\frac{1`) stays inside raw_latex!
      engine.moveRight();
      expect(engine.getInputContext()).toBe('raw');

      // 3. Exiting deliberately via Enter while invalid keeps amber warning capsule so outer KaTeX still renders!
      engine.nextSlot(); // exits raw_latex into sqrt's radicand slot right after raw_latex
      const invalidExitedSnap = engine.getSnapshot();
      expect(invalidExitedSnap.interactiveLatex).toContain('ms-raw-slot-invalid');
      expect(() => strictKatexInteractiveRender(invalidExitedSnap.interactiveLatex)).not.toThrow();

      // 4. Re-enter raw_latex via ArrowLeft, finish `}{2}`, and exit via ArrowRight at balanced trailing edge!
      engine.moveLeft(); // enters raw_latex at trailing edge!
      expect(engine.getInputContext()).toBe('raw');
      for (const ch of '}{2}') {
        engine.insertText(ch);
      }
      engine.moveRight(); // balanced -> exits raw_latex!
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
    // Tab inside empty raw_latex exits & removes empty shell
    engine.triggerLeader();
    expect(engine.getInputContext()).toBe('math-root');
    expect(engine.getSnapshot().latex).toBe('x +');

    // Non-empty raw_latex with `;` round-trips streamCodec losslessly
    for (const ch of '\\\\G/H;pi') engine.insertText(ch);
    engine.triggerLeader(); // exits non-empty raw_latex
    for (const ch of '+1') engine.insertText(ch);
    expect(engine.getSnapshot().latex).toBe('x + G/H;pi + 1');

    const stream = toStreamCode(engine.getSnapshot().doc);
    expect(stream).toContain('▸aVG/H▸;pi;');
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

describe('Headless inlineExpander engine (Obsidian low-intrusion inline mode)', () => {
  it('accurately locates $...$ and $$...$$ while ignoring escaped \\$, inline code, and code fences', () => {
    const doc = [
      'Price is \\$100 and inline `$not_math$` plus $x + y$ here.',
      '```tex',
      '$inside_fence$',
      '```',
      '> $$',
      '> \\int_0^1 x \\, dx',
      '> $$',
    ].join('\n');

    expect(findEnclosingMathSpan(doc, doc.indexOf('not_math'))).toBeNull();
    expect(findEnclosingMathSpan(doc, doc.indexOf('inside_fence'))).toBeNull();
    expect(findEnclosingMathSpan(doc, doc.indexOf('100'))).toBeNull();

    const inlineHit = findEnclosingMathSpan(doc, doc.indexOf('x + y'));
    expect(inlineHit).not.toBeNull();
    expect(inlineHit?.isBlock).toBe(false);
    expect(doc.slice(inlineHit!.contentFrom, inlineHit!.contentTo)).toBe('x + y');

    const blockHit = findEnclosingMathSpan(doc, doc.indexOf('\\int_0^1'));
    expect(blockHit).not.toBeNull();
    expect(blockHit?.isBlock).toBe(true);
  });

  it('weaves Tab chords, nested LIFO tabstops, bare-word shorthands on ;, and literal ; fallback', () => {
    const h = new InlineBufferHarness('Note: $|$ end.');
    // Tab l x ; 0 ; Tab f sin(x) ; x ; ;
    h.pressKey('Tab');
    h.pressKey('l');
    h.typeSeq('x;0;');
    h.pressKey('Tab');
    h.pressKey('f');
    h.typeSeq('sin(x);x;;');
    expect(h.snapshotWithCursor()).toBe('Note: $\\lim_{x \\to 0} \\frac{\\sin(x)}{x}|$ end.');

    // Once all tabstops are exhausted, `;` inserts a literal semicolon!
    h.pressKey(';');
    expect(h.snapshotWithCursor()).toBe('Note: $\\lim_{x \\to 0} \\frac{\\sin(x)}{x};|$ end.');

    // Sibling nesting inside outer numerator + word shorthand before `;` (`Tab f pi; 2;`)
    const h2 = new InlineBufferHarness('$|$');
    h2.pressKey('Tab');
    h2.pressKey('f');
    h2.pressKey('Tab');
    h2.pressKey('f');
    h2.typeSeq('pi;2;+1;k;');
    expect(h2.snapshotWithCursor()).toBe('$\\frac{\\frac{\\pi}{2}+1}{k}|$');
  });

  it('auto-cleans empty optional wrappers (_{}, ^{}, []) when skipped via ;', () => {
    // Indefinite integral: skip lower & upper limits -> clean `\int f(x)\,\mathrm{d}x` without `_{}^{}`!
    const hInt = new InlineBufferHarness('$$ | $$');
    hInt.pressKey('Tab');
    hInt.pressKey('i');
    hInt.typeSeq(';;f(x)dx;');
    expect(hInt.snapshotWithCursor()).toBe('$$ \\int f(x)\\,\\mathrm{d}x| $$');

    // Square root (skip degree) vs cube root (fill degree = 3)
    const hSqrt = new InlineBufferHarness('$|$');
    hSqrt.pressKey('Tab');
    hSqrt.pressKey('r');
    hSqrt.typeSeq('x+1;;');
    expect(hSqrt.snapshotWithCursor()).toBe('$\\sqrt{x+1}|$');

    const hCube = new InlineBufferHarness('$|$');
    hCube.pressKey('Tab');
    hCube.pressKey('r');
    hCube.typeSeq('8;3;');
    expect(hCube.snapshotWithCursor()).toBe('$\\sqrt[3]{8}|$');
  });

  it('supports submenu instant default, 2nd-key morphing, Shift+Tab back-jump, and Tab w workbench escalation', () => {
    // `Tab m` inserts pmatrix immediately; typing `1` commits pmatrix and inserts `1` in (1,1)
    const hMat = new InlineBufferHarness('$$|$$');
    hMat.pressKey('Tab');
    const rootItems = getLeaderCapsuleItems('', hMat.settings);
    expect(rootItems.some((i) => i.key === 'w' && i.isWorkbench)).toBe(true);
    hMat.pressKey('m');
    expect(hMat.doc).toContain('\\begin{pmatrix}');
    hMat.typeSeq('1;2;3;4;');
    expect(hMat.snapshotWithCursor()).toBe('$$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}|$$');

    // `Tab m d` morphs pmatrix in-place into cases
    const hCases = new InlineBufferHarness('$$|$$');
    hCases.pressKey('Tab');
    hCases.pressKey('m');
    hCases.pressKey('d');
    expect(hCases.doc).not.toContain('pmatrix');
    expect(hCases.doc).toContain('\\begin{cases}');

    // `Shift+Tab` jumps back to previous slot and `;` advances forward again
    const hBack = new InlineBufferHarness('$|$');
    hBack.pressKey('Tab');
    hBack.pressKey('f');
    hBack.typeSeq('1;2');
    hBack.pressKey('Tab', { shiftKey: true });
    hBack.typeSeq('0;');
    expect(hBack.snapshotWithCursor()).toBe('$\\frac{10}{2|}$');
    hBack.pressKey(';');
    expect(hBack.snapshotWithCursor()).toBe('$\\frac{10}{2}|$');

    // `Tab w` signals 2D workbench escalation for the enclosing math span
    hBack.pressKey('Tab');
    hBack.pressKey('w');
    expect(hBack.openedWorkbenchSpan).not.toBeNull();
    expect(hBack.doc.slice(hBack.openedWorkbenchSpan!.rawFrom, hBack.openedWorkbenchSpan!.rawTo)).toBe(
      '$\\frac{10}{2}$',
    );
  });

  it('supports \\\\ rawSpan passthrough, natural /, ^, _, prefix-upgraded punct, and granular setting toggles', () => {
    const hRaw = new InlineBufferHarness('$a + |$');
    hRaw.typeSeq('\\\\G/H; x -> pi');
    expect(hRaw.session.rawSpan).not.toBeNull();
    expect(hRaw.snapshotWithCursor()).toBe('$a + G/H; x -> pi|$');
    hRaw.pressKey('Enter');
    expect(hRaw.session.rawSpan).toBeNull();
    hRaw.typeSeq(' <=>');
    expect(hRaw.snapshotWithCursor()).toBe('$a + G/H; x -> pi \\Leftrightarrow|$');

    // Natural `pi/2;` and `alpha_i;` and uncorrupted `spin `
    const hSugar = new InlineBufferHarness('$|$');
    hSugar.typeSeq('pi/2; + alpha_i; + spin ');
    expect(hSugar.snapshotWithCursor()).toBe('$\\frac{\\pi}{2} + \\alpha_{i} + spin |$');

    // Granular toggles: disable naturalFraction & punctShorthands, switch leaderKey to backtick
    const hCustom = new InlineBufferHarness('$|$', {
      leaderKey: '`',
      naturalFraction: false,
      punctShorthands: false,
    });
    hCustom.typeSeq('a/b -> ');
    expect(hCustom.snapshotWithCursor()).toBe('$a/b -> |$');
    hCustom.pressKey('`');
    hCustom.pressKey('f');
    hCustom.typeSeq('1;2;');
    expect(hCustom.snapshotWithCursor()).toBe('$a/b -> \\frac{1}{2}|$');
  });
});

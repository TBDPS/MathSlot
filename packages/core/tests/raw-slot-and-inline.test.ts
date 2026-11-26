import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INLINE_SETTINGS,
  MathSlotEngine,
  buildInlinePreviewLatex,
  createActiveInlineSession,
  createEmptyInlineSession,
  findEnclosingMathSpan,
  getLeaderCapsuleItems,
  handleInlineCharTyped,
  handleInlineLeaderKey,
  handleInlineLeaderTrigger,
  handleInlinePrevSlot,
  handleInlineSemicolon,
  handleInlineSpecialKey,
  handleInlineSummonOrUpgrade,
  healIncompleteLatexForPreview,
  mapInlineSessionThroughChange,
  normalizePreviewLatex,
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

function renderHudPreviewStrictOrHealed(latex: string): string {
  const trustHud = (ctx: { command: string }): boolean => ctx.command === '\\htmlClass';
  try {
    return katex.renderToString(normalizePreviewLatex(latex, true), {
      displayMode: true,
      throwOnError: true,
      strict: false,
      trust: trustHud,
    });
  } catch {
    return katex.renderToString(
      normalizePreviewLatex(healIncompleteLatexForPreview(latex), true),
      {
        displayMode: true,
        throwOnError: true,
        strict: false,
        trust: trustHud,
      },
    );
  }
}

class InlineBufferHarness {
  public doc: string;
  public pos: number;
  public session: InlineSessionState;
  public settings: InlineExpanderSettings;
  public openedWorkbenchSpan: InlineMathSpan | null = null;

  constructor(
    docWithPipeCursor: string,
    settingsPatch: Partial<InlineExpanderSettings> = {},
    initialActive = true,
  ) {
    const pipeIdx = docWithPipeCursor.indexOf('|');
    if (pipeIdx === -1) {
      throw new Error('Expected `|` cursor marker in initial document');
    }
    this.doc = docWithPipeCursor.slice(0, pipeIdx) + docWithPipeCursor.slice(pipeIdx + 1);
    this.pos = pipeIdx;
    this.settings = { ...DEFAULT_INLINE_SETTINGS, ...settingsPatch };
    this.session = initialActive ? createActiveInlineSession() : createEmptyInlineSession();
  }

  public snapshotWithCursor(): string {
    return `${this.doc.slice(0, this.pos)}|${this.doc.slice(this.pos)}`;
  }

  private applyRawEdit(from: number, to: number, insert: string, nextPos?: number): void {
    this.doc = this.doc.slice(0, from) + insert + this.doc.slice(to);
    this.pos = nextPos ?? from + insert.length;
  }

  private applyAction(res: InlineActionResult, mathSpan: InlineMathSpan | null): boolean {
    if (res.kind === 'noop') return false;
    if (res.kind === 'open_workbench') {
      this.session = createEmptyInlineSession();
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

  public summon(selEnd?: number): void {
    const from = this.pos;
    const to = selEnd ?? this.pos;
    const mathSpan = from === to ? findEnclosingMathSpan(this.doc, from) : null;
    const res = handleInlineSummonOrUpgrade(this.doc, from, to, this.session, mathSpan);
    this.applyAction(res, mathSpan);
  }

  public pressKey(key: string, opts: { shiftKey?: boolean } = {}): void {
    const mathSpan = findEnclosingMathSpan(this.doc, this.pos);
    if (!this.settings.enabled || !this.session.active || !mathSpan) {
      if (key.length === 1) {
        this.applyRawEdit(this.pos, this.pos, key);
        if (!mathSpan) this.session = createEmptyInlineSession();
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

    if (
      (key === 'Enter' && !opts.shiftKey) ||
      key === 'Escape' ||
      (this.session.rawSpan && key === 'ArrowRight')
    ) {
      const specRes = handleInlineSpecialKey(
        this.doc,
        this.pos,
        key as 'Enter' | 'Escape' | 'ArrowRight',
        this.session,
        mathSpan,
      );
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
      if (!findEnclosingMathSpan(this.doc, this.pos)) {
        this.session = createEmptyInlineSession();
      }
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

describe('Headless inlineExpander & Dual-Panel Session Engine (Obsidian)', () => {
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

  it('summons $...$ via shortcut, upgrades to $$...$$ on 2nd press, and auto-exits past $ on Enter / Esc / top-level ;', () => {
    // 1. Inactive outside math -> summon inserts `$|$` and activates session
    const h = new InlineBufferHarness('已知 | 成立', {}, false);
    expect(h.session.active).toBe(false);
    h.summon();
    expect(h.session.active).toBe(true);
    expect(h.snapshotWithCursor()).toBe('已知 $|$ 成立');

    // Type `2pi;` -> expands `pi` -> `\pi` AND exits right past closing `$`, deactivating session!
    h.typeSeq('2pi;');
    expect(h.session.active).toBe(false);
    expect(h.snapshotWithCursor()).toBe('已知 $2\\pi$| 成立');

    // Once exited outside `$`, typing prose (`a/b`) is 100% untouched!
    h.typeSeq(' a/b');
    expect(h.snapshotWithCursor()).toBe('已知 $2\\pi$ a/b| 成立');

    // 2. Double summon inside blockquote upgrades inline `$...$` -> `> $$\n> ...\n> $$`!
    const hQuote = new InlineBufferHarness('> |', {}, false);
    hQuote.summon();
    expect(hQuote.snapshotWithCursor()).toBe('> $|$');
    hQuote.typeSeq('x^2;');
    expect(hQuote.snapshotWithCursor()).toBe('> $x^{2}|$');
    hQuote.summon(); // 2nd press upgrades to block math!
    expect(hQuote.session.active).toBe(true);
    expect(hQuote.snapshotWithCursor()).toBe('> $$\n> x^{2}|\n> $$');

    // Pressing Enter completes and moves cursor right outside closing `$$`!
    hQuote.pressKey('Enter');
    expect(hQuote.session.active).toBe(false);
    expect(hQuote.snapshotWithCursor()).toBe('> $$\n> x^{2}\n> $$|');
  });

  it('weaves Tab chords, nested LIFO tabstops, literal ; inside (...), and outermost ; exit', () => {
    const h = new InlineBufferHarness('Note: $|$ end.');
    h.pressKey('Tab');
    h.pressKey('l');
    h.typeSeq('x;0;');
    h.pressKey('Tab');
    h.pressKey('f');
    h.typeSeq('sin(x);x;;');
    // Still inside `$...$` at outermost level so user can append more terms if needed
    expect(h.session.active).toBe(true);
    expect(h.snapshotWithCursor()).toBe('Note: $\\lim_{x \\to 0} \\frac{\\sin(x)}{x}|$ end.');

    // Typing `+ f(u; v)` keeps `;` literal while inside unclosed `(`!
    h.typeSeq(' + f(u; v)');
    expect(h.session.active).toBe(true);
    expect(h.snapshotWithCursor()).toBe('Note: $\\lim_{x \\to 0} \\frac{\\sin(x)}{x} + f(u; v)|$ end.');

    // Now at balanced top level, pressing `;` completes & exits past closing `$`!
    h.pressKey(';');
    expect(h.session.active).toBe(false);
    expect(h.snapshotWithCursor()).toBe('Note: $\\lim_{x \\to 0} \\frac{\\sin(x)}{x} + f(u; v)$| end.');
  });

  it('auto-cleans empty optional wrappers (_{}, ^{}, []) when skipped via ;', () => {
    const hInt = new InlineBufferHarness('$$ | $$');
    hInt.pressKey('Tab');
    hInt.pressKey('i');
    hInt.typeSeq(';;f(x)dx;');
    expect(hInt.snapshotWithCursor()).toBe('$$ \\int f(x)\\,\\mathrm{d}x| $$');

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
    const hMat = new InlineBufferHarness('$$|$$');
    hMat.pressKey('Tab');
    const rootItems = getLeaderCapsuleItems('', hMat.settings);
    expect(rootItems.some((i) => i.key === 'w' && i.isWorkbench)).toBe(true);
    hMat.pressKey('m');
    expect(hMat.doc).toContain('\\begin{pmatrix}');
    hMat.typeSeq('1;2;3;4;');
    expect(hMat.snapshotWithCursor()).toBe('$$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}|$$');

    const hCases = new InlineBufferHarness('$$|$$');
    hCases.pressKey('Tab');
    hCases.pressKey('m');
    hCases.pressKey('d');
    expect(hCases.doc).not.toContain('pmatrix');
    expect(hCases.doc).toContain('\\begin{cases}');

    const hBack = new InlineBufferHarness('$|$');
    hBack.pressKey('Tab');
    hBack.pressKey('f');
    hBack.typeSeq('1;2');
    hBack.pressKey('Tab', { shiftKey: true });
    hBack.typeSeq('0;');
    expect(hBack.snapshotWithCursor()).toBe('$\\frac{10}{2|}$');
    hBack.pressKey(';');
    expect(hBack.snapshotWithCursor()).toBe('$\\frac{10}{2}|$');

    hBack.pressKey('Tab');
    hBack.pressKey('w');
    expect(hBack.session.active).toBe(false);
    expect(hBack.openedWorkbenchSpan).not.toBeNull();
    expect(hBack.doc.slice(hBack.openedWorkbenchSpan!.rawFrom, hBack.openedWorkbenchSpan!.rawTo)).toBe(
      '$\\frac{10}{2}$',
    );
  });

  it('synthesizes live KaTeX preview with slot highlights and heals incomplete TeX without errors', () => {
    // 1. Brand-new empty `$|$`
    const hEmpty = new InlineBufferHarness('$|$');
    const span0 = findEnclosingMathSpan(hEmpty.doc, hEmpty.pos)!;
    const prev0 = buildInlinePreviewLatex(hEmpty.doc, span0, hEmpty.session);
    expect(prev0.isEmpty).toBe(true);
    expect(() => renderHudPreviewStrictOrHealed(prev0.latex)).not.toThrow();

    // 2. Partially filled fraction `Tab f x+1`
    hEmpty.pressKey('Tab');
    hEmpty.pressKey('f');
    hEmpty.typeSeq('x+1');
    const span1 = findEnclosingMathSpan(hEmpty.doc, hEmpty.pos)!;
    const prev1 = buildInlinePreviewLatex(hEmpty.doc, span1, hEmpty.session);
    expect(prev1.latex).toContain('ms-hud-slot-filled');
    expect(prev1.latex).toContain('ms-hud-slot-pending');
    expect(() => renderHudPreviewStrictOrHealed(prev1.latex)).not.toThrow();

    // 3. Active `\\` rawSpan with unclosed `\frac{1`
    const hRaw = new InlineBufferHarness('$a + |$');
    hRaw.typeSeq('\\\\\\frac{1; x -> pi');
    expect(hRaw.session.rawSpan).not.toBeNull();
    const spanRaw = findEnclosingMathSpan(hRaw.doc, hRaw.pos)!;
    const prevRaw = buildInlinePreviewLatex(hRaw.doc, spanRaw, hRaw.session);
    expect(prevRaw.latex).toContain('ms-hud-raw-chip');
    expect(() => renderHudPreviewStrictOrHealed(prevRaw.latex)).not.toThrow();

    // 4. Hand-typed incomplete TeX fragments heal cleanly
    for (const broken of ['x^', 'a_', '\\frac{1', '\\left( x + y', 'x + \\']) {
      expect(() => renderHudPreviewStrictOrHealed(broken)).not.toThrow();
    }
  });
});

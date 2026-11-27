import { describe, expect, it } from 'vitest';
import {
  detectFormulaInLines,
  extractBlockquotePrefix,
  formatDockedFormulaText,
  formatFormulaForEditorInsertion,
  stripBlockquoteSelection,
  toggleFormulaWrapperStyle,
} from '../src/obsidianMath';
import { MathSlotEngine } from '../src/editor';

describe('Obsidian blockquote & callout math detection/replacement', () => {
  it('extracts single, nested, and indented blockquote prefixes cleanly', () => {
    expect(extractBlockquotePrefix('$$')).toEqual({ prefix: '', content: '$$' });
    expect(extractBlockquotePrefix('> $$')).toEqual({ prefix: '> ', content: '$$' });
    expect(extractBlockquotePrefix('>')).toEqual({ prefix: '>', content: '' });
    expect(extractBlockquotePrefix('> > \\frac{a}{b}')).toEqual({
      prefix: '> > ',
      content: '\\frac{a}{b}',
    });
    expect(extractBlockquotePrefix('  > a + b')).toEqual({ prefix: '  > ', content: 'a + b' });
  });

  it('detects and strips multi-line $$ inside an Obsidian callout blockquote', () => {
    const doc = [
      '> [!note] 高斯积分',
      '> 下面给出经典结果：',
      '> $$',
      '> \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}',
      '> $$',
      '> 证毕。',
    ];

    const detected = detectFormulaInLines(doc, { line: 3, ch: 10 });
    expect(detected).not.toBeNull();
    expect(detected!.delimiter).toBe('block');
    expect(detected!.linePrefix).toBe('> ');
    expect(detected!.includeFirstLinePrefix).toBe(true);
    expect(detected!.from).toEqual({ line: 2, ch: 0 });
    expect(detected!.to).toEqual({ line: 4, ch: 4 });
    expect(detected!.raw).toBe('$$\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n$$');

    // Verify MathSlotEngine parses the stripped formula with zero stray `>` characters
    const engine = new MathSlotEngine();
    engine.loadFormula(detected!.raw);
    expect(engine.getSnapshot().latex).not.toContain('>');

    // Verify writing back re-applies `> ` to every line
    const formatted = formatFormulaForEditorInsertion(
      '$$\n\\int_{0}^{\\infty} e^{-x^2}dx = \\frac{\\sqrt{\\pi}}{2}\n$$',
      detected!.linePrefix,
      detected!.includeFirstLinePrefix,
    );
    expect(formatted).toBe(
      '> $$\n> \\int_{0}^{\\infty} e^{-x^2}dx = \\frac{\\sqrt{\\pi}}{2}\n> $$',
    );
  });

  it('handles cursor on opening or closing > $$ fence and nested > > $$ blocks', () => {
    const doc = [
      '普通段落',
      '> > $$',
      '> > a^2 + b^2 = c^2',
      '> > $$',
    ];

    const onOpen = detectFormulaInLines(doc, { line: 1, ch: 5 });
    const onClose = detectFormulaInLines(doc, { line: 3, ch: 5 });
    expect(onOpen?.raw).toBe('$$\na^2 + b^2 = c^2\n$$');
    expect(onClose?.raw).toBe('$$\na^2 + b^2 = c^2\n$$');
    expect(onOpen?.linePrefix).toBe('> > ');
    expect(onClose?.linePrefix).toBe('> > ');
    expect(onClose?.from).toEqual({ line: 1, ch: 0 });
    expect(onClose?.to).toEqual({ line: 3, ch: 6 });
  });

  it('resets fence parity across blockquote boundaries and does not leak previous block', () => {
    const doc = [
      '$$',
      'x = 1',
      '$$',
      '> [!tip] 引用',
      '> $$',
      '> y = 2',
      '> $$',
      '正文 $z = 3$',
    ];

    const insideQuote = detectFormulaInLines(doc, { line: 5, ch: 4 });
    expect(insideQuote?.raw).toBe('$$\ny = 2\n$$');
    expect(insideQuote?.linePrefix).toBe('> ');

    const inlineAfter = detectFormulaInLines(doc, { line: 7, ch: 5 });
    expect(inlineAfter?.raw).toBe('$z = 3$');
    expect(inlineAfter?.delimiter).toBe('inline');
    expect(inlineAfter?.linePrefix).toBe('');
  });

  it('handles single-line $$ inside blockquote and preserves prefix on multi-line upgrade', () => {
    const doc = ['> $$a + b = c$$'];
    const detected = detectFormulaInLines(doc, { line: 0, ch: 6 });
    expect(detected).not.toBeNull();
    expect(detected!.raw).toBe('$$a + b = c$$');
    expect(detected!.from).toEqual({ line: 0, ch: 2 });
    expect(detected!.to).toEqual({ line: 0, ch: 15 });
    expect(detected!.includeFirstLinePrefix).toBe(false);
    expect(detected!.linePrefix).toBe('> ');

    const upgraded = formatFormulaForEditorInsertion(
      '$$\na + b = c\n$$',
      detected!.linePrefix,
      detected!.includeFirstLinePrefix,
    );
    // Line 0 replaces starting after `> `, lines 1..2 get `> ` prepended!
    expect(upgraded).toBe('$$\n> a + b = c\n> $$');
  });

  it('strips manual multi-line selection inside a blockquote', () => {
    const sel = '> $$\n> \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}\n> $$';
    const { clean, linePrefix } = stripBlockquoteSelection(sel);
    expect(linePrefix).toBe('> ');
    expect(clean).toBe('$$\n\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}\n$$');
  });

  it('detects inline \\(...\\), single-line \\[...\\], and multi-line \\[ ... \\] delimiters', () => {
    const lineInline = ['欧拉公式 \\(e^{i\\pi}+1=0\\) 非常优美'];
    const hitInline = detectFormulaInLines(lineInline, { line: 0, ch: 10 });
    expect(hitInline).not.toBeNull();
    expect(hitInline!.delimiter).toBe('inline');
    expect(hitInline!.raw).toBe('\\(e^{i\\pi}+1=0\\)');

    const lineBlock = ['公式 \\[x^2 + y^2 = 1\\] 结束'];
    const hitSingleBlock = detectFormulaInLines(lineBlock, { line: 0, ch: 8 });
    expect(hitSingleBlock).not.toBeNull();
    expect(hitSingleBlock!.delimiter).toBe('block');
    expect(hitSingleBlock!.raw).toBe('\\[x^2 + y^2 = 1\\]');

    const multiBlock = ['> \\[', '> \\frac{a}{b}', '> \\]'];
    const hitMultiBlock = detectFormulaInLines(multiBlock, { line: 1, ch: 4 });
    expect(hitMultiBlock).not.toBeNull();
    expect(hitMultiBlock!.delimiter).toBe('block');
    expect(hitMultiBlock!.linePrefix).toBe('> ');
    expect(hitMultiBlock!.raw).toBe('\\[\n\\frac{a}{b}\n\\]');
  });

  it('supports strictInterior boundary checks, empty $$, and docked empty-shell formatting', () => {
    const inlineLine = ['已知 $x^2$ 成立'];
    const dollarStart = inlineLine[0].indexOf('$x^2$');
    const dollarEnd = dollarStart + '$x^2$'.length;

    // Non-strict hits outside boundary (for Alt+M command), strictInterior only hits strictly inside
    expect(detectFormulaInLines(inlineLine, { line: 0, ch: dollarStart }, false)).not.toBeNull();
    expect(detectFormulaInLines(inlineLine, { line: 0, ch: dollarEnd }, false)).not.toBeNull();
    expect(detectFormulaInLines(inlineLine, { line: 0, ch: dollarStart }, true)).toBeNull();
    expect(detectFormulaInLines(inlineLine, { line: 0, ch: dollarEnd }, true)).toBeNull();
    expect(detectFormulaInLines(inlineLine, { line: 0, ch: dollarStart + 2 }, true)?.raw).toBe('$x^2$');

    // Empty `$|$` created on summon
    const emptyInline = ['正文 $$ 后面'];
    const emptyStart = emptyInline[0].indexOf('$$');
    const emptyHit = detectFormulaInLines(emptyInline, { line: 0, ch: emptyStart + 1 }, true);
    expect(emptyHit?.raw).toBe('$$');
    expect(emptyHit?.wrapper).toBe('dollar_inline');
    expect(emptyHit?.delimiter).toBe('inline');
    // Cursor outside empty `$$|` does not trigger
    expect(detectFormulaInLines(emptyInline, { line: 0, ch: emptyStart + 2 }, true)).toBeNull();

    // Multi-line block strictInterior excludes before opening `$$` and after closing `$$`
    const blockLines = ['> $$', '> x + y', '> $$'];
    expect(detectFormulaInLines(blockLines, { line: 0, ch: 1 }, true)).toBeNull();
    expect(detectFormulaInLines(blockLines, { line: 0, ch: 4 }, true)?.wrapper).toBe('dollar_block');
    expect(detectFormulaInLines(blockLines, { line: 2, ch: 4 }, true)).toBeNull();

    // Docked empty-shell preservation & cleanup + wrapper toggle
    expect(toggleFormulaWrapperStyle('dollar_inline')).toBe('dollar_block');
    expect(toggleFormulaWrapperStyle('dollar_block')).toBe('dollar_inline');
    expect(toggleFormulaWrapperStyle('paren_inline')).toBe('bracket_block');
    expect(formatDockedFormulaText('', 'dollar_inline', '', false, true)).toBe('$$');
    expect(formatDockedFormulaText('', 'dollar_inline', '', false, false)).toBe('');
    expect(formatDockedFormulaText('', 'dollar_block', '> ', true, true)).toBe('> $$\n> \n> $$');
    expect(formatDockedFormulaText('\\frac{1}{2}', 'dollar_block', '> ', false, true)).toBe(
      '$$\n> \\frac{1}{2}\n> $$',
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  COMMANDS_BY_ID,
  MathSlotEngine,
  PRESETS,
  cloneNodeFresh,
  detectFormulaInLines,
  importFormula,
  listAllSlots,
  mergePresets,
  parseUserCommandsJson,
  parseUserPresetsJson,
  toLatex,
} from '../src';

describe('Audit fixes & new math structures regression suite', () => {
  it('guards against deeply nested braces without stack overflow', () => {
    const deep = '{'.repeat(2000) + 'x' + '}'.repeat(2000);
    const res = importFormula(deep);
    expect(res.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
    expect(res.doc.root.children.length).toBeGreaterThan(0);
  });

  it('parses unbraced \\lim_x subscript without swallowing the variable', () => {
    const res = importFormula('\\lim_x f(x)');
    expect(res.diagnostics.some((d) => d.severity === 'error')).toBe(false);
    expect(toLatex(res.doc)).toContain('\\lim_{x');
  });

  it('parses nested same-name matrix environments with balanced \\begin/\\end', () => {
    const src = '\\begin{pmatrix} \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix} & 0 \\\\ 0 & 1 \\end{pmatrix}';
    const res = importFormula(src);
    expect(res.diagnostics.some((d) => d.severity === 'error')).toBe(false);
    const out = toLatex(res.doc);
    expect(out).toBe('\\begin{pmatrix} \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix} & 0 \\\\ 0 & 1 \\end{pmatrix}');
  });

  it('preserves user preset order in mergePresets instead of reversing', () => {
    const merged = mergePresets(PRESETS.slice(0, 2), [
      { id: 'u-first', name: '第一条', category: '自定义', source: 'a=1' },
      { id: 'u-second', name: '第二条', category: '自定义', source: 'b=2' },
    ]);
    expect(merged[0].id).toBe('u-first');
    expect(merged[1].id).toBe('u-second');
  });

  it('ignores $$ inside Markdown fenced code blocks and rejects $$$ fences', () => {
    const doc = [
      '```bash',
      'echo $$',
      '```',
      '正文行',
      '$$$',
      'x = 1',
      '$$$',
    ];
    expect(detectFormulaInLines(doc, { line: 1, ch: 5 })).toBeNull();
    expect(detectFormulaInLines(doc, { line: 3, ch: 1 })).toBeNull();
    expect(detectFormulaInLines(doc, { line: 5, ch: 2 })).toBeNull();
  });

  it('supports editable \\text{}, \\overset, \\underset, \\cancel, \\xrightarrow, \\pmod and variants', () => {
    const engine = new MathSlotEngine();

    // Editable \text{...} with Chinese and spaces
    engine.loadFormula('\\text{当 } x > 0');
    expect(engine.getSnapshot().latex).toBe('\\text{当 }x > 0');
    const firstNode = engine.getSnapshot().doc.root.children[0];
    expect(firstNode.type).toBe('struct');
    if (firstNode.type === 'struct') {
      expect(firstNode.commandId).toBe('text_box');
    }

    // \overset & \underset
    engine.loadFormula('A \\overset{\\text{def}}{=} \\underset{n \\to \\infty}{\\lim} a_n');
    expect(engine.getSnapshot().latex).toContain('\\overset{\\text{def}}{=}');
    expect(engine.getSnapshot().latex).toContain('\\underset{n \\to \\infty}');

    // Adaptive \xrightarrow (omits optional lower slot when empty)
    engine.clear();
    engine.insertCommand('xrightarrow');
    engine.insertText('f');
    expect(engine.getSnapshot().latex).toBe('\\xrightarrow{f}');

    // \xrightarrow with both lower & upper slots
    engine.loadFormula('X \\xrightarrow[g]{f} Y');
    expect(engine.getSnapshot().latex).toBe('X \\xrightarrow[g]{f} Y');

    // \cancel and \pmod
    engine.loadFormula('\\cancel{x} \\equiv 1 \\pmod{n}');
    expect(engine.getSnapshot().latex).toBe('\\cancel{x} \\equiv 1 \\pmod{n}');

    // Greek variants & arrows
    expect(COMMANDS_BY_ID.get('varphi')?.latex).toBe('\\varphi');
    expect(COMMANDS_BY_ID.get('vartheta')?.latex).toBe('\\vartheta');
    expect(COMMANDS_BY_ID.get('leftarrow')?.latex).toBe('\\leftarrow');
    expect(COMMANDS_BY_ID.get('leftrightarrow')?.latex).toBe('\\leftrightarrow');
  });

  it('cloneNodeFresh assigns strictly unique IDs to every node and slot', () => {
    const res = importFormula('\\frac{a+b}{c}');
    const orig = res.doc.root.children[0];
    const dup = cloneNodeFresh(orig);
    expect(dup.id).not.toBe(orig.id);
    if (orig.type === 'struct' && dup.type === 'struct') {
      const origSlotIds = new Set(orig.slots.flatMap((s) => listAllSlots(s).map((x) => x.id)));
      const dupSlotIds = dup.slots.flatMap((s) => listAllSlots(s).map((x) => x.id));
      for (const id of dupSlotIds) {
        expect(origSlotIds.has(id)).toBe(false);
      }
    }
  });

  it('does not mis-parse plain snake_case text pasted into pasteText as subscripts', () => {
    const engine = new MathSlotEngine();
    engine.pasteText('my_snake_case');
    expect(engine.getSnapshot().latex).toBe('my\\_snake\\_case');
  });

  it('parses all 89 built-in presets with zero hard errors', () => {
    for (const preset of PRESETS) {
      const res = importFormula(preset.source);
      const hardErrors = res.diagnostics.filter((d) => d.severity === 'error');
      expect(hardErrors, `Preset ${preset.id} failed to parse`).toEqual([]);
    }
  });

  it('preserves nested matrix columns inside aligned environments across import -> edit -> export -> re-import', () => {
    const src = '\\begin{aligned}\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}&=M\\end{aligned}';
    const res = importFormula(src);
    expect(res.lossless).toBe(true);
    const first = res.doc.root.children[0];
    expect(first.type).toBe('struct');
    if (first.type === 'struct') {
      expect(first.commandId).toBe('matrix_2x2');
      expect(first.slots.length).toBe(4);
    }

    // Edit cell (1,2) from `2` -> `9`, export, then re-import and assert structure survived
    const engine = new MathSlotEngine();
    engine.loadFormula(src);
    const mat = engine.getSnapshot().doc.root.children[0];
    if (mat.type === 'struct') {
      const cell12 = mat.slots[1];
      engine.setCursor(cell12.id, cell12.children.length);
      engine.backspace();
      engine.insertText('9');
    }
    const exported = engine.getSnapshot().latex;
    expect(exported).toBe('\\begin{pmatrix} 1 & 9 \\\\ 3 & 4 \\end{pmatrix} = M');

    const reimported = importFormula(exported);
    expect(reimported.lossless).toBe(true);
    expect(toLatex(reimported.doc)).toBe('\\begin{pmatrix} 1 & 9 \\\\ 3 & 4 \\end{pmatrix} = M');

    // Multi-column aligned emits explicit warning (`lossless: false`) instead of silently merging
    const multiCol = importFormula('\\begin{aligned}a &= b & c &= d\\end{aligned}');
    expect(multiCol.lossless).toBe(false);
    expect(multiCol.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });

  it('preserves \\lim_{x\\to0^+}, \\iint_0^1 upper bound, and \\int\\limits_0^1 without silent meaning drift', () => {
    // 1. `\lim_{x\to0^+}` must split on LaTeX command boundary (no duplicate `\to`)
    const limRes = importFormula('\\lim_{x\\to0^+} \\frac{1}{x}');
    expect(limRes.lossless).toBe(true);
    const limOut = toLatex(limRes.doc);
    expect(limOut).toBe('\\lim_{x \\to 0^{+}} \\frac{1}{x}');
    expect(limOut.match(/\\to/g)?.length).toBe(1);

    // Unbraced `\lim_x f(x)` should not emit a dangling `\to`
    const limSimple = importFormula('\\lim_x f(x)');
    expect(toLatex(limSimple.doc)).toBe('\\lim_{x} f(x)');

    // 2. `\iint_0^1 x\,dx` preserves BOTH lower and upper bounds
    const iintRes = importFormula('\\iint_0^1 x\\,dx');
    expect(iintRes.lossless).toBe(true);
    expect(toLatex(iintRes.doc)).toBe('\\iint_{0}^{1} x\\,\\mathrm{d}x');

    // 3. `\int\limits_0^1 f(x)\,dx` preserves `\limits`, lower, upper, and body
    const limitsRes = importFormula('\\int\\limits_0^1 f(x)\\,dx');
    expect(limitsRes.lossless).toBe(true);
    expect(toLatex(limitsRes.doc)).toBe('\\int\\limits_{0}^{1} f(x)\\,\\mathrm{d}x');
  });

  it('excludes inline code, fenced code blocks, and escaped \\$ in Obsidian math detection', () => {
    const doc = [
      'Price is \\$5 and \\$10 total.',
      'Code span `$x+1$` and ``$y+2$`` then real $z+3$.',
      '```tex',
      '$a+b$',
      '```',
      '~~~',
      '$$c+d$$',
      '~~~',
    ];
    // Escaped dollar signs never match
    expect(detectFormulaInLines(doc, { line: 0, ch: 12 })).toBeNull();
    // Inline code spans never match
    expect(detectFormulaInLines(doc, { line: 1, ch: 13 })).toBeNull();
    expect(detectFormulaInLines(doc, { line: 1, ch: 26 })).toBeNull();
    // Real inline math after code spans on the SAME line DOES match!
    const realHit = detectFormulaInLines(doc, { line: 1, ch: 45 });
    expect(realHit?.raw).toBe('$z+3$');
    expect(realHit?.delimiter).toBe('inline');
    // Inline / block math inside ``` or ~~~ fenced code blocks NEVER matches
    expect(detectFormulaInLines(doc, { line: 3, ch: 2 })).toBeNull();
    expect(detectFormulaInLines(doc, { line: 6, ch: 3 })).toBeNull();
  });

  it('handles \\left\\{x\\middle|x>0\\right\\}, \\boxed{z}, \\text{a\\_b 50\\%}, mixed intervals, and unknown macros cleanly', () => {
    // 1. Set builder with `\middle|` imports into editable struct
    const setRes = importFormula('\\left\\{x\\middle|x>0\\right\\}');
    expect(setRes.lossless).toBe(true);
    expect(toLatex(setRes.doc)).toBe('\\left\\{ x \\,\\middle|\\, x > 0 \\right\\}');

    // 2. `\boxed{z}` imports into editable `boxed` struct
    const boxRes = importFormula('\\boxed{z}');
    expect(boxRes.lossless).toBe(true);
    expect(toLatex(boxRes.doc)).toBe('\\boxed{z}');
    expect(boxRes.doc.root.children[0].type).toBe('struct');

    // 3. `\text{a\_b 50\%}` does NOT double-escape backslashes on roundtrip
    const textRes = importFormula('\\text{a\\_b 50\\%}');
    expect(textRes.lossless).toBe(true);
    expect(toLatex(textRes.doc)).toBe('\\text{a\\_b 50\\%}');

    // 4. Mixed intervals `(a, b]` and `[a, b)` import into editable structs
    const ocRes = importFormula('\\left(a, b\\right]');
    expect(ocRes.lossless).toBe(true);
    expect(toLatex(ocRes.doc)).toBe('\\left(a, b\\right]');
    const coRes = importFormula('\\left[a, b\\right)');
    expect(coRes.lossless).toBe(true);
    expect(toLatex(coRes.doc)).toBe('\\left[a, b\\right)');

    // 5. Unknown macro with argument stays attached as a single raw node with warning
    const unkRes = importFormula('\\phantom{xyz} + 1');
    expect(unkRes.lossless).toBe(false);
    expect(toLatex(unkRes.doc)).toBe('\\phantom{xyz} + 1');
  });

  it('pastes compact math subscripts like x_1 as structs while supporting literal paste and marking broken JSON as failed', () => {
    const engine = new MathSlotEngine();
    engine.pasteText('x_1');
    expect(engine.getSnapshot().latex).toBe('x_1');

    engine.clear();
    engine.pasteLiteralText('x_1');
    expect(engine.getSnapshot().latex).toBe('x\\_1');

    const badP = parseUserPresetsJson('{ invalid');
    expect(badP.failed).toBe(true);
    const badC = parseUserCommandsJson('{ invalid');
    expect(badC.failed).toBe(true);
  });

  it('roundtrips explicit TeX spacing (\\,, \\!, \\quad, \\qquad, \\;, \\:) losslessly and supports inline canvas typing', () => {
    for (const sample of ['x\\,y', 'x\\!y', 'x \\quad y', 'x \\qquad y', 'x\\;y', 'x\\:y', '\\frac{x\\!y}{a \\quad b}']) {
      const res = importFormula(sample);
      expect(res.lossless, `spacing sample ${sample} not lossless`).toBe(true);
      expect(toLatex(res.doc)).toBe(sample);
    }

    // Typing `\,`, `\!`, and `\quad ` directly on canvas
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };
    type('x\\,y\\!z\\quad w');
    expect(engine.getSnapshot().latex).toBe('x\\,y\\!z \\quad w');
  });

  it('expands \\sin + Space / ( / ^2 cleanly without merging into sinx and grabs whole function/Greek script bases', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    type('\\sin x');
    expect(engine.getSnapshot().latex).toBe('\\sin x');

    engine.clear();
    type('\\sin(x)');
    expect(engine.getSnapshot().latex).toBe('\\sin(x)');

    engine.clear();
    type('\\sin^2');
    engine.nextSlot();
    type(' x');
    expect(engine.getSnapshot().latex).toBe('\\sin^2 x');

    engine.clear();
    type('pi^2');
    engine.nextSlot();
    expect(engine.getSnapshot().latex).toBe('\\pi^2');
  });

  it('upgrades prefix-overlapping punctuation shorthands (<=>, <->, |->) and waits for word boundary on interactive preview & custom EE', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    // `<` -> `=` -> `>` upgrades `\le` into `\Leftrightarrow`
    type('A<=>B');
    expect(engine.getSnapshot().latex).toBe('A \\Leftrightarrow B');

    // Standalone `<=` still works
    engine.clear();
    type('a<=b');
    expect(engine.getSnapshot().latex).toBe('a \\le b');

    // `<-`, `<->`, `|->`
    engine.clear();
    type('x<-y<->z|->w');
    expect(engine.getSnapshot().latex).toBe('x \\leftarrow y \\leftrightarrow z \\mapsto w');

    // Calm word-boundary interactive rendering: `n pi` stays plain while caret is at `pi|`, then morphs on Space!
    engine.clear();
    type('n pi');
    expect(engine.getSnapshot().interactiveLatex).not.toContain('\\pi');
    type(' ');
    expect(engine.getSnapshot().interactiveLatex).toContain('\\pi');
    type('x');
    expect(engine.getSnapshot().latex).toBe('n \\pi x');

    // Alphabetic custom shorthand `EE` requires a right word boundary (`EEx` stays literal, `EE[X]` expands!)
    engine.setCustomCommands([
      { id: 'cust-exp', label: '期望', latex: '\\mathbb{E}', slots: [], shorthand: 'EE' },
    ]);
    engine.clear();
    type('EEx');
    expect(engine.getSnapshot().latex).toBe('EEx');

    engine.clear();
    type('EE[X]');
    expect(engine.getSnapshot().latex).toBe('\\mathbb{E}[X]');
  });

  it('maintains selection invariants on spaceExitsScript, respects autoShorthands=false on ~, and prevents literal / fraction trigger', () => {
    const engine = new MathSlotEngine({ spaceExitsScript: true });
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };
    type('x^2');
    // Select `2` inside exponent slot and press Space: must replace `2` inside exponent, NOT orphan selection!
    const expSlotId = engine.getSnapshot().cursor.slotId;
    engine.setSelection(expSlotId, 0, 1);
    type(' ');
    expect(engine.getSnapshot().selection).toBeNull();
    expect(engine.getSnapshot().cursor.slotId).toBe(expSlotId);

    // Duplicate spaces and leading empty root space
    engine.clear();
    type('   ');
    expect(engine.getSnapshot().isEmpty).toBe(true);
    expect(engine.getSnapshot().latex).toBe('');
    type('x  y');
    expect(engine.getSnapshot().latex).toBe('x y');

    // `autoShorthands: false` does not turn `~` into `\sim`
    engine.updateSettings({ autoShorthands: false });
    engine.clear();
    type('a~b');
    expect(engine.getSnapshot().latex).not.toContain('\\sim');
    engine.updateSettings({ autoShorthands: true });

    // `pasteLiteralText('/')` after `a` stays literal `a/` (never creates `\frac{a}{}`)
    engine.clear();
    type('a');
    engine.pasteLiteralText('/');
    expect(engine.getSnapshot().latex).toBe('a/');

    // `pasteText('x->y')` normalizes math arrow just like typing
    engine.clear();
    engine.pasteText('x->y');
    expect(engine.getSnapshot().latex).toBe('x \\to y');
  });

  it('preserves interior empty matrix rows, \\[4pt] row gaps, multi-column align, TeX % comments, and formal LaTeX literal oo/pi/dx', () => {
    // 1. Interior empty row in 3x2 matrix is preserved!
    const emptyRowSrc = '\\begin{pmatrix} 1 & 2 \\\\ \\\\ 3 & 4 \\end{pmatrix}';
    const emptyRowRes = importFormula(emptyRowSrc);
    expect(emptyRowRes.lossless).toBe(true);
    const matNode = emptyRowRes.doc.root.children[0];
    expect(matNode.type).toBe('struct');
    if (matNode.type === 'struct') {
      expect(matNode.grid?.rows).toBe(3);
      expect(matNode.grid?.cols).toBe(2);
    }
    expect(toLatex(emptyRowRes.doc)).toBe('\\begin{pmatrix} 1 & 2 \\\\ & \\\\ 3 & 4 \\end{pmatrix}');

    // 2. Matrix `\\[4pt]` row spacing is preserved in `grid.rowGaps`, NOT stuffed into cell (2,1)!
    const gapSrc = '\\begin{pmatrix} a & b \\\\[4pt] c & d \\end{pmatrix}';
    const gapRes = importFormula(gapSrc);
    expect(gapRes.lossless).toBe(true);
    expect(toLatex(gapRes.doc)).toBe('\\begin{pmatrix} a & b \\\\[4pt] c & d \\end{pmatrix}');

    // 3. Multi-column `align` is preserved intact as `aligned` with warning (never flattened to `a = b c = d`)
    const alignRes = importFormula('\\begin{align}a&=b & c&=d\\end{align}');
    expect(alignRes.lossless).toBe(false);
    expect(toLatex(alignRes.doc)).toContain('a&=b & c&=d');

    // 4. Unescaped TeX `%` comment stripped to end-of-line with warning, while `\%` stays literal
    const commentRes = importFormula('x %行尾注释\n+ 50\\%');
    expect(commentRes.lossless).toBe(false);
    expect(toLatex(commentRes.doc)).toBe('x + 50\\%');

    // 5. Formal LaTeX import preserves `oo`, `pi`, and standalone `dx` as literal variables!
    expect(toLatex(importFormula('x=oo+pi').doc)).toBe('x = oo + pi');
    expect(toLatex(importFormula('y=dx').doc)).toBe('y = dx');
  });

  it('handles outer fenced code blocks containing > $$ examples and blockquotes containing fenced code blocks in Obsidian', () => {
    // Outer `~~~md` containing blockquote-styled math example MUST NOT be detected as math!
    const outerCode = ['~~~md', '> $$', '> x^2', '> $$', '~~~'];
    expect(detectFormulaInLines(outerCode, { line: 2, ch: 3 })).toBeNull();

    //Blockquote containing a fenced code block skips code inside fence, then detects real math after fence!
    const quotedCode = ['> ~~~tex', '> $a+b$', '> ~~~', '> $c+d$'];
    expect(detectFormulaInLines(quotedCode, { line: 1, ch: 4 })).toBeNull();
    const realAfter = detectFormulaInLines(quotedCode, { line: 3, ch: 4 });
    expect(realAfter?.raw).toBe('$c+d$');
    expect(realAfter?.linePrefix).toBe('> ');
  });

  it('fixes v2.2.3 audit P1s: text_box pure text & backslash, disabled natural ^/~, formal a~b/epsilon/ldots, nested paste \\\\, rowGaps resize, snippet optional slots, htmlData strip, and stream ▸r3;8;', () => {
    const engine = new MathSlotEngine();
    const type = (s: string) => {
      for (const ch of s) engine.insertText(ch);
    };

    // P1-1 & P1-5: `text_box` acts as pure text mode (`/`, `;`, `(`, `->`, `\`, `^`, `~` stay literal & valid KaTeX!)
    engine.insertCommand('text_box');
    type('a/b; (c) a\\b ^ ~');
    const textLatex = engine.getSnapshot().latex;
    expect(textLatex).toBe('\\text{a/b; (c) a\\textbackslash{}b \\textasciicircum{} \\textasciitilde{}}');
    // Roundtrip `\text{...}` with `\textbackslash{}`!
    const textRound = importFormula(textLatex);
    expect(textRound.lossless).toBe(true);
    expect(toLatex(textRound.doc)).toBe(textLatex);

    // P1-2: `naturalScripts=false` and `autoShorthands=false` emit valid KaTeX math macros for `^` and `~`
    const literalEngine = new MathSlotEngine({ naturalScripts: false, autoShorthands: false });
    for (const ch of 'x^2 + a~b') literalEngine.insertText(ch);
    expect(literalEngine.getSnapshot().latex).toBe('x\\text{\\textasciicircum}2 + a\\text{\\textasciitilde}b');

    // P1-3: Formal LaTeX import preserves `a~b`, `\epsilon`, `\ldots`, `\emptyset` without lossy substitution
    expect(toLatex(importFormula('a~b').doc)).toBe('a~b');
    expect(toLatex(importFormula('\\epsilon + \\varepsilon').doc)).toBe('\\epsilon + \\varepsilon');
    expect(toLatex(importFormula('x_1, \\ldots, x_n').doc)).toBe('x_1, \\ldots, x_n');
    expect(toLatex(importFormula('A \\cap B = \\emptyset').doc)).toBe('A \\cap B = \\emptyset');

    // P1-4: Multi-line paste / snippet inside a fraction numerator sanitizes `\\` to space
    engine.clear();
    engine.insertCommand('frac');
    engine.pasteText('a \\\\ b');
    expect(engine.getSnapshot().latex).toBe('\\frac{a b}{}');
    engine.clear();
    engine.insertCommand('frac');
    engine.pasteLiteralText('c\nd');
    expect(engine.getSnapshot().latex).toBe('\\frac{c d}{}');

    // P1-6: Non-relation single-line `aligned` (`a & b`) and `\tag{1}` preserve environment with warning
    const cellAlign = importFormula('\\begin{aligned} a & b \\end{aligned}');
    expect(cellAlign.lossless).toBe(false);
    expect(toLatex(cellAlign.doc)).toContain('a & b');
    const tagAlign = importFormula('\\begin{align} a &= b \\tag{1} \\end{align}');
    expect(tagAlign.lossless).toBe(false);
    expect(toLatex(tagAlign.doc)).toContain('\\tag{1}');
    expect(toLatex(tagAlign.doc)).toContain('\\begin{align}');

    // P1-7: `addGridRow` and `addGridCol` preserve `\\[4pt]` in `grid.rowGaps`!
    engine.loadFormula('\\begin{pmatrix} a & b \\\\[4pt] c & d \\end{pmatrix}');
    const mat = engine.getSnapshot().doc.root.children[0];
    if (mat.type === 'struct') {
      engine.setCursor(mat.slots[0].id, 1);
      engine.addGridRow('below');
      expect(engine.getSnapshot().latex).toBe('\\begin{pmatrix} a & b \\\\[4pt] & \\\\ c & d \\end{pmatrix}');
      engine.addGridCol('right');
      expect(engine.getSnapshot().latex).toContain('\\\\[4pt]');
    }

    // P1-15: `insertSnippetAtCursor` skips optional empty slots (lands after `\xrightarrow{f}` and `\int x\,dx`)
    engine.clear();
    engine.insertSnippetAtCursor({ latex: '\\xrightarrow{f}' });
    expect(engine.getSnapshot().cursor.slotId).toBe(engine.getSnapshot().doc.root.id);
    engine.clear();
    engine.insertSnippetAtCursor({ latex: '\\int x\\,\\mathrm{d}x' });
    expect(engine.getSnapshot().cursor.slotId).toBe(engine.getSnapshot().doc.root.id);

    // P1-14: `loadFormulaWithRawFallback` keeps broken source instead of blank canvas
    const brokenRes = engine.loadFormulaWithRawFallback('$\\left(x + 1$');
    expect(brokenRes.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(engine.getSnapshot().isEmpty).toBe(false);
    expect(engine.getSnapshot().latex).toBe('\\left(x + 1');

    // Security (§9.6): Imported `\htmlData` is stripped and unwrapped with warning
    const forged = importFormula('\\htmlData{slot-id=fake}{x+1}');
    expect(forged.lossless).toBe(false);
    expect(toLatex(forged.doc)).toBe('x + 1');

    // P2-10: Stream code `▸r3;8;` and `▸rx;` both parse accurately
    expect(toLatex(importFormula('▸rx;').doc)).toBe('\\sqrt{x}');
    expect(toLatex(importFormula('▸r3;8;').doc)).toBe('\\sqrt[3]{8}');
  });
});

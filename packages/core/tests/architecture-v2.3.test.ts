import { describe, expect, it } from 'vitest';
import katex from 'katex';
import {
  ACCENT_MACRO_MAP,
  COMMANDS,
  COMMANDS_BY_ID,
  COMMAND_CAPABILITIES,
  INLINE_STRUCT_MAP,
  MathSlotEngine,
  SHORTHAND_BY_COMMAND_ID,
  SHORTHAND_SPECS,
  forEachSlot,
  getOptionalSlots,
  importFormula,
  mergeCommands,
  normalizeSettings,
  parseUserCommandsJson,
  parseUserPresetsJson,
  sanitizeLatexTemplate,
  toLatex,
  visitNode,
} from '../src';

describe('MathSlot v2.3 architecture contracts & new capabilities', () => {
  it('enforces single-source-of-truth CommandCapabilities & template placeholder invariants', () => {
    // 1. Every capability entry maps to a real command (or legacy alias `nth_root`)
    for (const [id, caps] of COMMAND_CAPABILITIES.entries()) {
      if (id === 'nth_root') continue;
      const cmd = COMMANDS_BY_ID.get(id);
      expect(cmd, `COMMAND_CAPABILITIES has orphan command id "${id}"`).toBeDefined();
      expect(caps.optionalSlots).toEqual(cmd!.optionalSlots ?? []);
      expect(getOptionalSlots(id)).toEqual(cmd!.optionalSlots ?? []);
    }

    // 2. Every inline macro & accent macro points to an existing command
    for (const [macro, id] of Object.entries(INLINE_STRUCT_MAP)) {
      expect(COMMANDS_BY_ID.has(id), `INLINE_STRUCT_MAP[${macro}] -> missing ${id}`).toBe(true);
    }
    for (const [macro, id] of Object.entries(ACCENT_MACRO_MAP)) {
      expect(COMMANDS_BY_ID.has(id), `ACCENT_MACRO_MAP[${macro}] -> missing ${id}`).toBe(true);
    }
    for (const id of SHORTHAND_BY_COMMAND_ID.keys()) {
      expect(COMMANDS_BY_ID.has(id), `SHORTHAND_BY_COMMAND_ID -> missing ${id}`).toBe(true);
    }

    // 3. Every built-in command template's `$k` placeholders fall strictly within `1..slots.length`
    for (const cmd of COMMANDS) {
      const indices = Array.from(cmd.latex.matchAll(/\$(\d+)/g)).map((m) => Number(m[1]));
      for (const idx of indices) {
        expect(
          idx >= 1 && idx <= cmd.slots.length,
          `command ${cmd.id} has out-of-range placeholder $${idx} for ${cmd.slots.length} slots`,
        ).toBe(true);
      }
    }
  });

  it('supports array {cc|c}, augmented matrices [A|b], column vertical bar toggling, and colSpec resize', () => {
    // 1. Bare `\begin{array}{lr|c}` roundtrips losslessly and renders interactively
    const arrSrc = '\\begin{array}{lr|c} x_1 & 2 & b_1 \\\\ x_2 & 4 & b_2 \\end{array}';
    const arrRes = importFormula(arrSrc);
    expect(arrRes.lossless).toBe(true);
    expect(toLatex(arrRes.doc)).toBe(arrSrc);

    // 2. Bracketed augmented matrix `\left[\begin{array}{cc|c}...\end{array}\right]` collapses into editable grid
    const augSrc = '\\left[\\begin{array}{cc|c} 1 & 2 & 3 \\\\ 4 & 5 & 6 \\end{array}\\right]';
    const engine = new MathSlotEngine();
    const res = engine.loadFormula(augSrc);
    expect(res.lossless).toBe(true);
    expect(engine.getSnapshot().latex).toBe(augSrc);

    const rootStruct = engine.getSnapshot().doc.root.children[0];
    expect(rootStruct.type).toBe('struct');
    if (rootStruct.type === 'struct') {
      // Focus column 2 (index 1), where `hasRightBar` is true (`cc|c`)
      engine.setCursor(rootStruct.slots[1].id, 1);
      expect(engine.getSnapshot().activeGrid?.hasRightBar).toBe(true);
      expect(engine.getSnapshot().activeGrid?.colSpec).toBe('cc|c');

      // Toggle vertical bar OFF -> emits clean `\begin{bmatrix}`!
      expect(engine.toggleGridColBar()).toBe(true);
      expect(engine.getSnapshot().latex).toBe(
        '\\begin{bmatrix} 1 & 2 & 3 \\\\ 4 & 5 & 6 \\end{bmatrix}',
      );

      // Toggle vertical bar ON again -> restores `\left[\begin{array}{cc|c}...\end{array}\right]`!
      expect(engine.toggleGridColBar()).toBe(true);
      expect(engine.getSnapshot().latex).toBe(augSrc);

      // Add a column on the left of col 1 -> `ccc|c`!
      engine.setCursor(rootStruct.slots[0].id, 0);
      engine.addGridCol('left');
      expect(engine.getSnapshot().activeGrid?.colSpec).toBe('ccc|c');
      expect(() =>
        katex.renderToString(engine.getSnapshot().interactiveLatex, {
          displayMode: true,
          throwOnError: true,
          strict: false,
          trust: true,
        }),
      ).not.toThrow();
    }

    // 3. `Tab m k` inserts 2x3 augmented matrix ready for keyboard entry
    engine.clear();
    engine.triggerLeader();
    engine.handleLeaderKey('m');
    engine.handleLeaderKey('k');
    for (const v of ['1', '0', 'b_1;', '0', '1', 'b_2;']) {
      for (const ch of v) engine.insertText(ch);
      engine.nextSlot();
    }
    expect(engine.getSnapshot().latex).toBe(
      '\\left[\\begin{array}{cc|c} 1 & 0 & b_1 \\\\ 0 & 1 & b_2 \\end{array}\\right]',
    );
  });

  it('supports smallmatrix, dcases, and rcases environments interactively and losslessly', () => {
    const engine = new MathSlotEngine();
    for (const sample of [
      '\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}',
      '\\begin{dcases} \\frac{1}{x} & x > 0 \\\\ 0 & x \\le 0 \\end{dcases}',
      '\\begin{rcases} u = x + y & \\text{和} \\\\ v = x - y & \\text{差} \\end{rcases}',
    ]) {
      const r = engine.loadFormula(sample);
      expect(r.lossless).toBe(true);
      expect(engine.getSnapshot().latex).toBe(sample);
      expect(() =>
        katex.renderToString(engine.getSnapshot().interactiveLatex, {
          displayMode: true,
          throwOnError: true,
          strict: false,
          trust: true,
        }),
      ).not.toThrow();
    }
  });

  it('supports inline $...$ math inside \\text{...} and protects text context across paste/command/snippet', () => {
    const engine = new MathSlotEngine();

    // 1. Interactive typing of `\text{当 $x_1 > 0$ 时，价格 \$5}` (including closing `$` from nested subscript!)
    engine.insertCommand('text_box');
    expect(engine.getInputContext()).toBe('text');
    for (const ch of '当 ') engine.insertText(ch);
    engine.insertText('$');
    expect(engine.getInputContext()).toBe('math-slot');
    for (const ch of 'x_1;>0') engine.insertText(ch);
    engine.insertText('$');
    expect(engine.getInputContext()).toBe('text');
    for (const ch of ' 时，价格 \\$5，且 ') engine.insertText(ch);
    // Closing `$` even while caret is still inside nested subscript `y_2` climbs cleanly back to `text_box`!
    for (const ch of '$y_2$ 成立') engine.insertText(ch);
    const emitted = engine.getSnapshot().latex;
    expect(emitted).toBe('\\text{当 $x_1 > 0$ 时，价格 \\$5，且 $y_2$ 成立}');

    // Roundtrip import of `\text{当 $x_1 > 0$ 时，价格 \$5}`
    const reimported = importFormula(emitted);
    expect(reimported.lossless).toBe(true);
    expect(toLatex(reimported.doc)).toBe(emitted);
    expect(() =>
      katex.renderToString(engine.getSnapshot().interactiveLatex, {
        displayMode: true,
        throwOnError: true,
        strict: false,
        trust: true,
      }),
    ).not.toThrow();

    // 2. Pasting `x_1 -> y` inside `text_box` stays pure literal prose instead of math structs
    engine.clear();
    engine.insertCommand('text_box');
    engine.pasteText('x_1 -> y');
    expect(engine.getSnapshot().latex).toBe('\\text{x\\_1 -> y}');

    // 3. `insertCommand('text_box')` inside `text_box` is blocked, while math commands auto-wrap in `$...$`
    expect(engine.insertCommand('text_box')).toBe(false);
    engine.insertText(' ');
    expect(engine.insertCommand('alpha')).toBe(true);
    expect(engine.getSnapshot().latex).toBe('\\text{x\\_1 -> y $\\alpha$}');

    // 4. Recursive `sanitizeNodesForTargetSlot` strips nested `\\` even inside child structs
    engine.clear();
    engine.insertCommand('frac');
    engine.pasteText('\\left(a \\\\ b\\right)');
    expect(engine.getSnapshot().latex).toBe('\\frac{\\left(a b\\right)}{}');
  });

  it('supports editable \\mathbf, \\mathcal, \\mathbb, \\operatorname, \\bigcup, \\bigcap, \\mid, and wide accents', () => {
    const engine = new MathSlotEngine();

    // `\mathbb{R}` remains atomic symbol while `\mathbb{E}` becomes editable `mathbb` struct
    const rSet = importFormula('\\mathbb{R}');
    expect(rSet.doc.root.children[0].type).toBe('symbol');
    const expSet = importFormula('\\mathbb{E}');
    expect(expSet.doc.root.children[0].type).toBe('struct');
    expect(toLatex(expSet.doc)).toBe('\\mathbb{E}');

    // `\mathbf`, `\mathcal`, `\operatorname`, `\bigcup`, `\bigcap`, `\mid`, `\widehat`, `\widetilde`, `\overrightarrow`
    const rich =
      '\\bigcup_{i=1}^{n} \\mathcal{F}_i \\cap \\bigcap_{k=1}^{\\infty} \\mathbf{A}_k = \\operatorname{softmax}(z) \\mid \\widehat{AB} + \\widetilde{CD} + \\overrightarrow{PQ}';
    const res = engine.loadFormula(rich);
    expect(res.lossless).toBe(true);
    expect(engine.getSnapshot().latex).toBe(rich);

    // Typing `dx` or `pi` inside `operatorname` stays verbatim identifier text
    engine.clear();
    engine.insertCommand('operatorname');
    for (const ch of 'dx') engine.insertText(ch);
    engine.nextSlot();
    engine.insertText('y');
    expect(engine.getSnapshot().latex).toBe('\\operatorname{dx} y');
  });

  it('sanitizes untrusted macros in custom templates & JSON libraries and migrates legacy \\ leaderKey', () => {
    expect(sanitizeLatexTemplate('\\htmlData{slot-id=evil}{\\mathcal{H}($1)}')).toBe(
      '\\mathcal{H}($1)',
    );
    expect(sanitizeLatexTemplate('\\href{javascript:alert(1)}{x} + \\includegraphics{a.png}')).toBe(
      'x + ',
    );

    const parsedCmds = parseUserCommandsJson(
      JSON.stringify({
        commands: [
          {
            id: 'evil-cmd',
            label: '注入测试',
            category: 'symbol',
            keys: ['o', 'z'],
            latex: '\\htmlData{atom-slot=fake}{\\alpha}',
          },
        ],
      }),
    );
    expect(parsedCmds.entries[0].latex).toBe('\\alpha');

    const parsedPresets = parseUserPresetsJson(
      JSON.stringify({
        presets: [
          {
            id: 'evil-preset',
            name: '预设注入',
            category: '测试',
            source: '\\htmlClass{evil}{x^2 + 1}',
          },
        ],
      }),
    );
    expect(parsedPresets.entries[0].source).toBe('x^2 + 1');

    // Legacy `\` leaderKey migrates cleanly to `Tab`
    const migrated = normalizeSettings({ leaderKey: '\\' });
    expect(migrated.leaderKey).toBe('Tab');
  });

  it('notifies subscribers, coalesces rapid alphanumeric typing undo, and restores selection on undo', () => {
    const engine = new MathSlotEngine();
    let notifications = 0;
    const unsub = engine.subscribe(() => {
      notifications += 1;
    });

    // Rapid contiguous alphanumeric typing in the same slot coalesces into 1 undo step
    for (const ch of 'softmax') engine.insertText(ch);
    expect(engine.getSnapshot().latex).toBe('softmax');
    expect(notifications).toBe(7);
    engine.undo();
    expect(engine.getSnapshot().latex).toBe('');
    engine.redo();
    expect(engine.getSnapshot().latex).toBe('softmax');

    // Punctuation shorthand (`->` -> `\to`) still reverts in 1 step back to literal `-` + `>` chars!
    engine.clear();
    engine.insertText('-');
    engine.insertText('>');
    expect(engine.getSnapshot().latex).toBe('\\to');
    engine.undo();
    expect(engine.getSnapshot().latex).toBe('- >');

    // Deleting a selection restores the selection on `undo()`
    engine.selectAll();
    expect(engine.getSnapshot().selection).not.toBeNull();
    engine.backspace();
    expect(engine.getSnapshot().latex).toBe('');
    engine.undo();
    expect(engine.getSnapshot().latex).toBe('- >');
    expect(engine.getSnapshot().selection).toEqual({
      slotId: engine.getSnapshot().doc.root.id,
      start: 0,
      end: 2,
    });

    // Exhaustive `visitNode` & `forEachSlot` visitors walk AST accurately
    engine.loadFormula('\\frac{a}{b}');
    let slotCount = 0;
    let structCount = 0;
    forEachSlot(engine.getSnapshot().doc.root, (slot) => {
      slotCount += 1;
      for (const child of slot.children) {
        visitNode(child, {
          char: () => {},
          symbol: () => {},
          raw: () => {},
          struct: () => {
            structCount += 1;
          },
        });
      }
    });
    expect(slotCount).toBe(3);
    expect(structCount).toBe(1);

    unsub();
  });

  it('supports first-class diff structure (Tab c f), arbitrary/higher-order differentials, single-source ShorthandSpecs, and commands.json shorthands', () => {
    // 1. Explicit differential structure: arbitrary variables (\theta, \vec{r}) and order (d^2 x)
    const engine = new MathSlotEngine();
    for (const ch of 'f(x)') engine.insertText(ch);
    engine.triggerLeader();
    engine.handleLeaderKey('c');
    engine.handleLeaderKey('f');
    engine.insertCommand('theta');
    expect(engine.getSnapshot().latex).toBe('f(x)\\,\\mathrm{d}\\theta');
    expect(engine.getSnapshot().interactiveLatex).toContain('\\,');

    // Fill optional order slot 0 -> d^{2}\theta
    engine.nextSlot();
    engine.insertText('2');
    expect(engine.getSnapshot().latex).toBe('f(x)\\,\\mathrm{d}^{2}\\theta');

    // Roundtrip parsing of structured differentials (\mathrm{d}\vec{r}, \mathrm{d}^{2}x)
    const vecDiff = importFormula('\\int f(\\vec{r})\\,\\mathrm{d}\\vec{r}');
    expect(vecDiff.lossless).toBe(true);
    expect(toLatex(vecDiff.doc)).toBe('\\int f(\\vec{r})\\,\\mathrm{d}\\vec{r}');

    const secondOrder = importFormula('\\mathrm{d}^{2}x');
    expect(secondOrder.lossless).toBe(true);
    expect(secondOrder.doc.root.children[0].type).toBe('struct');
    expect((secondOrder.doc.root.children[0] as { commandId?: string }).commandId).toBe('diff');
    expect(toLatex(secondOrder.doc)).toBe('\\mathrm{d}^{2}x');

    // 2. Single-source ShorthandSpec integrity & auto-derived prefix upgrades (`<=`+`>` -> `<=>`)
    expect(SHORTHAND_SPECS.length).toBeGreaterThan(100);
    engine.clear();
    for (const ch of 'a <=> b <-> c') engine.insertText(ch);
    expect(engine.getSnapshot().latex).toBe('a \\Leftrightarrow b \\leftrightarrow c');

    // 3. External commands.json shorthand support (live expansion!)
    const parsedCmds = parseUserCommandsJson(
      JSON.stringify({
        commands: [
          {
            id: 'user-laplace-sh',
            label: '拉氏变换',
            category: 'calculus',
            keys: ['c', 'z'],
            latex: '\\mathcal{L}\\{$1\\}',
            slots: ['原函数'],
            shorthand: 'LL',
          },
        ],
      }),
    );
    expect(parsedCmds.entries[0].shorthand).toBe('LL');
    const merged = mergeCommands(COMMANDS, parsedCmds.entries);
    engine.clear();
    engine.setEffectiveCommands(merged);
    for (const ch of 'LLf(t)') engine.insertText(ch);
    expect(engine.getSnapshot().latex).toBe('\\mathcal{L}\\{f(t)\\}');
  });
});

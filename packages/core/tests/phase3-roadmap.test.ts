import { describe, expect, it } from 'vitest';
import { MathSlotEngine, validatePersistedDraftV1 } from '../src';

describe('Phase 3 (v2.5) Cross-Slot Selection, Grid Block Ops, Revision Cache & DocumentV1', () => {
  it('promotes cross-slot drag across numerator & denominator to LCA struct selection and wraps cleanly (P1-4)', () => {
    const engine = new MathSlotEngine();
    engine.loadFormula('a + \\frac{x}{y} + b');
    const children = engine.getSnapshot().doc.root.children;
    const frac = children.find((n) => n.type === 'struct' && n.commandId === 'frac');
    expect(frac?.type).toBe('struct');
    if (!frac || frac.type !== 'struct') return;

    // Drag from numerator slot 0 to denominator slot 1 -> LCA promotes to selecting the entire `\frac{x}{y}`!
    engine.selectBetweenPoints(
      { slotId: frac.slots[0].id, offset: 0 },
      { slotId: frac.slots[1].id, offset: 1 },
    );
    const snap = engine.getSnapshot();
    expect(snap.selection?.slotId).toBe(snap.doc.root.id);
    expect(engine.getSelectedLatex()).toBe('\\frac{x}{y}');

    // Wrapping cross-slot selection in parentheses works in 1 action!
    engine.insertCommand('paren');
    expect(engine.getSnapshot().latex).toBe('a + \\left(\\frac{x}{y}\\right) + b');
  });

  it('promotes Shift+ArrowRight / Shift+ArrowLeft across nested slot boundary to enclosing struct (P1-4)', () => {
    const engine = new MathSlotEngine();
    engine.loadFormula('\\sqrt{x} + 1');
    const sqrtNode = engine.getSnapshot().doc.root.children[0];
    expect(sqrtNode.type).toBe('struct');
    if (sqrtNode.type !== 'struct') return;

    // Place caret at end of radicand (slot 1) and press Shift+Right -> selects whole `\sqrt{x}`
    engine.setCursor(sqrtNode.slots[1].id, sqrtNode.slots[1].children.length);
    engine.moveRight(true);
    expect(engine.getSelectedLatex()).toBe('\\sqrt{x}');
  });

  it('supports rectangular matrix sub-block selection, sub-matrix export, block clear, and TSV paste (P1-4)', () => {
    const engine = new MathSlotEngine();
    engine.loadFormula('\\begin{pmatrix} 1 & 2 & 3 \\\\ 4 & 5 & 6 \\\\ 7 & 8 & 9 \\end{pmatrix}');
    const mat = engine.getSnapshot().doc.root.children[0];
    expect(mat.type).toBe('struct');
    if (mat.type !== 'struct') return;

    // Select 2x2 sub-block (0,0) .. (1,1) -> cells 1, 2, 4, 5
    engine.selectBetweenPoints(
      { slotId: mat.slots[0].id, offset: 0 },
      { slotId: mat.slots[4].id, offset: 1 },
    );
    expect(engine.getSnapshot().gridSelection).toEqual({
      structId: mat.id,
      r1: 0,
      c1: 0,
      r2: 1,
      c2: 1,
    });
    expect(engine.getSelectedLatex()).toBe('\\begin{pmatrix} 1 & 2 \\\\ 4 & 5 \\end{pmatrix}');

    // Backspace clears all 4 selected cells in one undoable step
    engine.backspace();
    expect(engine.getSnapshot().latex).toBe(
      '\\begin{pmatrix} & & 3 \\\\ & & 6 \\\\ 7 & 8 & 9 \\end{pmatrix}',
    );
    expect(engine.undo()).toBe(true);
    expect(engine.getSnapshot().latex).toBe(
      '\\begin{pmatrix} 1 & 2 & 3 \\\\ 4 & 5 & 6 \\\\ 7 & 8 & 9 \\end{pmatrix}',
    );

    // Paste 2x3 TSV spreadsheet data at cell (1,1) -> auto-expands matrix to 3x4!
    const fresh = new MathSlotEngine();
    fresh.insertCommand('matrix_2x2');
    fresh.pasteText('10\t20\t30\n40\t50\t60');
    expect(fresh.getSnapshot().latex).toBe(
      '\\begin{pmatrix} 10 & 20 & 30 \\\\ 40 & 50 & 60 \\end{pmatrix}',
    );
  });

  it('keeps docRevision constant across pure cursor movement for O(1) canonical LaTeX caching (P2-4)', () => {
    const engine = new MathSlotEngine();
    engine.loadFormula('\\frac{a + b}{c + d}');
    const rev0 = engine.getSnapshot().docRevision;
    engine.moveLeft();
    engine.moveLeft();
    engine.moveRight();
    expect(engine.getSnapshot().docRevision).toBe(rev0);

    engine.insertText('x');
    expect(engine.getSnapshot().docRevision).toBeGreaterThan(rev0 ?? 0);
  });

  it('round-trips PersistedDraftV1 preserving exact cursor slot & empty optional slots and rejects corrupt payloads (P2-5)', () => {
    const engine = new MathSlotEngine();
    engine.insertCommand('integral');
    // Leave lower limit (slot 0) empty, move to upper limit (slot 1) and type `n`, stay in slot 1
    engine.nextSlot();
    engine.insertText('n');
    const cursorBefore = engine.getSnapshot().cursor;
    const draft = engine.exportDraftV1('bracket_block');
    expect(draft.schemaVersion).toBe(1);
    expect(draft.wrapper).toBe('bracket_block');

    const restored = new MathSlotEngine();
    expect(restored.restoreDraftV1(draft)).toBe(true);
    expect(restored.getSnapshot().cursor).toEqual(cursorBefore);
    // Typing next char goes straight into upper limit slot 1 without ID collision!
    restored.insertText('+1');
    expect(restored.getSnapshot().latex).toBe('\\int^{n+1}');

    expect(validatePersistedDraftV1({ schemaVersion: 99, root: {} })).toBeNull();
    expect(validatePersistedDraftV1(null)).toBeNull();
  });
});

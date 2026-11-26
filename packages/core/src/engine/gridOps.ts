import { createSlot, findSlot, findSlotPath, getGridMeta, textToCharNodes } from '../ast';
import {
  formatGridEnvironment,
  insertColIntoSpec,
  isCasesEnv,
  removeColFromSpec,
  toggleColRightBar,
} from '../commandSpecs';
import { emitNodesCanonical, toLatex } from '../latex';
import { importFormula } from '../parser';
import type { SlotNode, StructNode } from '../types';
import {
  type EngineState,
  findStructById,
  runTransaction,
  sanitizeNodesForTargetSlot,
} from './state';

export interface ActiveGridContext {
  struct: StructNode;
  env: string;
  rows: number;
  cols: number;
  row: number;
  col: number;
  slotIdx: number;
}

export function findActiveGridContext(state: EngineState): ActiveGridContext | null {
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return null;
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const entry = path[i];
    if (!entry.parentStruct) continue;
    const meta = getGridMeta(entry.parentStruct);
    if (meta) {
      const sIdx = entry.slotIndexInStruct;
      return {
        struct: entry.parentStruct,
        env: meta.env,
        rows: meta.rows,
        cols: meta.cols,
        row: Math.floor(sIdx / meta.cols),
        col: sIdx % meta.cols,
        slotIdx: sIdx,
      };
    }
  }
  return null;
}

export function relabelGridSlots(
  struct: StructNode,
  env: string,
  rows: number,
  cols: number,
): void {
  const casesLike = isCasesEnv(env);
  const substackLike = env === 'substack' || env === 'gathered';
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const s = struct.slots[r * cols + c];
      if (!s) continue;
      s.label = substackLike
        ? `第 ${r + 1} 行`
        : casesLike
          ? c === 0
            ? `表达式${r + 1}`
            : `条件${r + 1}`
          : `(${r + 1},${c + 1})`;
    }
  }
}

export function tryPasteTsvIntoGrid(state: EngineState, rawText: string): boolean {
  if (!rawText.includes('\t')) return false;
  const ctx = findActiveGridContext(state);
  if (!ctx || isCasesEnv(ctx.env) || ctx.env === 'substack' || ctx.env === 'gathered') return false;
  const rowsData = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t').map((cell) => cell.trim()));
  if (rowsData.length === 0) return false;
  const pasteRows = rowsData.length;
  const pasteCols = Math.max(...rowsData.map((r) => r.length));
  if (pasteCols < 2 && pasteRows < 2) return false;

  const targetRows = Math.min(12, Math.max(ctx.rows, ctx.row + pasteRows));
  const targetCols = Math.min(10, Math.max(ctx.cols, ctx.col + pasteCols));

  return runTransaction(
    state,
    (s) => {
      const { struct, env } = ctx;
      let curRows = ctx.rows;
      let curCols = ctx.cols;
      let curSpec = getGridMeta(struct)?.colSpec;

      while (curRows < targetRows) {
        for (let c = 0; c < curCols; c += 1) {
          struct.slots.push(createSlot(`(${curRows + 1},${c + 1})`));
        }
        curRows += 1;
      }
      while (curCols < targetCols) {
        for (let r = curRows - 1; r >= 0; r -= 1) {
          struct.slots.splice(r * curCols + curCols, 0, createSlot(`(${r + 1},${curCols + 1})`));
        }
        curSpec = insertColIntoSpec(curSpec, curCols, curCols, env);
        curCols += 1;
      }

      struct.grid = {
        env,
        rows: curRows,
        cols: curCols,
        ...(curSpec ? { colSpec: curSpec } : {}),
      };
      relabelGridSlots(struct, env, curRows, curCols);

      for (let dr = 0; dr < pasteRows && ctx.row + dr < curRows; dr += 1) {
        for (let dc = 0; dc < rowsData[dr].length && ctx.col + dc < curCols; dc += 1) {
          const cellText = rowsData[dr][dc];
          const slotIdx = (ctx.row + dr) * curCols + (ctx.col + dc);
          const targetSlot = struct.slots[slotIdx];
          if (!targetSlot) continue;
          if (!cellText) {
            targetSlot.children = [];
          } else {
            const parsed = importFormula(cellText);
            targetSlot.children =
              !parsed.diagnostics.some((d) => d.severity === 'error') &&
              parsed.doc.root.children.length > 0
                ? sanitizeNodesForTargetSlot(s, parsed.doc.root.children, targetSlot.id)
                : textToCharNodes(cellText, true);
          }
        }
      }

      const endRow = Math.min(curRows - 1, ctx.row + pasteRows - 1);
      const endCol = Math.min(curCols - 1, ctx.col + pasteCols - 1);
      const endSlot = struct.slots[endRow * curCols + endCol] ?? struct.slots[0];
      s.cursor = { slotId: endSlot.id, offset: endSlot.children.length };
      s.selection = null;
      s.gridSelection = null;
      s.mode = { kind: 'edit' };
      return true;
    },
    { recordHistory: true },
  );
}

export function getSelectedLatex(state: EngineState): string {
  if (state.gridSelection) {
    const { structId, r1, c1, r2, c2 } = state.gridSelection;
    const struct = findStructById(state.doc.root, structId);
    const meta = struct ? getGridMeta(struct) : null;
    if (struct && meta) {
      const rowLatex: string[] = [];
      for (let r = r1; r <= r2; r += 1) {
        const cols: string[] = [];
        for (let c = c1; c <= c2; c += 1) {
          const slot = struct.slots[r * meta.cols + c];
          cols.push(
            slot
              ? emitNodesCanonical(slot.children, { autoShorthands: state.settings.autoShorthands })
              : '',
          );
        }
        rowLatex.push(cols.join(' & '));
      }
      return formatGridEnvironment(meta.env, undefined, c2 - c1 + 1, rowLatex.join(' \\\\ '));
    }
  }
  if (!state.selection) {
    return toLatex(state.doc, { autoShorthands: state.settings.autoShorthands });
  }
  const slot = findSlot(state.doc.root, state.selection.slotId);
  if (!slot) return '';
  return emitNodesCanonical(slot.children.slice(state.selection.start, state.selection.end), {
    autoShorthands: state.settings.autoShorthands,
  });
}

export function addGridRow(state: EngineState, where: 'below' | 'above' = 'below'): boolean {
  const ctx = findActiveGridContext(state);
  if (!ctx || ctx.rows >= 12) return false;
  return runTransaction(
    state,
    (s) => {
      const { struct, env, rows, cols, row } = ctx;
      const prevSpec = getGridMeta(struct)?.colSpec;
      const casesLike = isCasesEnv(env);
      const insertRow = where === 'above' ? row : row + 1;
      const newSlots: SlotNode[] = [];
      for (let c = 0; c < cols; c += 1) {
        newSlots.push(
          createSlot(
            casesLike
              ? c === 0
                ? `表达式${insertRow + 1}`
                : `条件${insertRow + 1}`
              : `(${insertRow + 1},${c + 1})`,
          ),
        );
      }
      struct.slots.splice(insertRow * cols, 0, ...newSlots);
      let nextRowGaps: (string | undefined)[] | undefined;
      if (struct.grid?.rowGaps && struct.grid.rowGaps.some(Boolean)) {
        nextRowGaps = Array.from(
          { length: Math.max(0, rows - 1) },
          (_, i) => struct.grid!.rowGaps![i],
        );
        nextRowGaps.splice(Math.min(insertRow, nextRowGaps.length), 0, undefined);
      }
      struct.grid = {
        env,
        rows: rows + 1,
        cols,
        ...(prevSpec ? { colSpec: prevSpec } : {}),
        ...(nextRowGaps ? { rowGaps: nextRowGaps } : {}),
      };
      relabelGridSlots(struct, env, rows + 1, cols);
      s.cursor = { slotId: newSlots[0].id, offset: 0 };
      s.selection = null;
      s.leaderMorphBackup = null;
      s.mode = { kind: 'edit' };
      return true;
    },
    { recordHistory: true },
  );
}

export function removeGridRow(state: EngineState): boolean {
  const ctx = findActiveGridContext(state);
  if (!ctx || ctx.rows <= 1) return false;
  return runTransaction(
    state,
    (s) => {
      const { struct, env, rows, cols, row, col } = ctx;
      const prevSpec = getGridMeta(struct)?.colSpec;
      struct.slots.splice(row * cols, cols);
      const nextRows = rows - 1;
      let nextRowGaps: (string | undefined)[] | undefined;
      if (struct.grid?.rowGaps && nextRows > 1) {
        const copy = Array.from(
          { length: Math.max(0, rows - 1) },
          (_, i) => struct.grid!.rowGaps![i],
        );
        copy.splice(Math.min(row, copy.length - 1), 1);
        if (copy.some(Boolean)) nextRowGaps = copy;
      }
      struct.grid = {
        env,
        rows: nextRows,
        cols,
        ...(prevSpec ? { colSpec: prevSpec } : {}),
        ...(nextRowGaps ? { rowGaps: nextRowGaps } : {}),
      };
      relabelGridSlots(struct, env, nextRows, cols);
      const targetRow = Math.min(row, nextRows - 1);
      const targetSlot = struct.slots[targetRow * cols + col] ?? struct.slots[0];
      s.cursor = { slotId: targetSlot.id, offset: targetSlot.children.length };
      s.selection = null;
      s.leaderMorphBackup = null;
      s.mode = { kind: 'edit' };
      return true;
    },
    { recordHistory: true },
  );
}

export function addGridCol(state: EngineState, where: 'right' | 'left' = 'right'): boolean {
  const ctx = findActiveGridContext(state);
  if (
    !ctx ||
    isCasesEnv(ctx.env) ||
    ctx.env === 'substack' ||
    ctx.env === 'gathered' ||
    ctx.cols >= 10
  ) {
    return false;
  }
  return runTransaction(
    state,
    (s) => {
      const { struct, env, rows, cols, row, col } = ctx;
      const prevSpec = getGridMeta(struct)?.colSpec;
      const insertCol = where === 'left' ? col : col + 1;
      const nextCols = cols + 1;
      let focusSlot: SlotNode | null = null;
      for (let r = rows - 1; r >= 0; r -= 1) {
        const slot = createSlot(`(${r + 1},${insertCol + 1})`);
        struct.slots.splice(r * cols + insertCol, 0, slot);
        if (r === row) focusSlot = slot;
      }
      const prevGaps = struct.grid?.rowGaps?.some(Boolean) ? [...struct.grid.rowGaps] : undefined;
      const nextSpec = insertColIntoSpec(prevSpec, cols, insertCol, env);
      struct.grid = {
        env,
        rows,
        cols: nextCols,
        ...(nextSpec ? { colSpec: nextSpec } : {}),
        ...(prevGaps ? { rowGaps: prevGaps } : {}),
      };
      relabelGridSlots(struct, env, rows, nextCols);
      if (focusSlot) {
        s.cursor = { slotId: focusSlot.id, offset: 0 };
      }
      s.selection = null;
      s.leaderMorphBackup = null;
      s.mode = { kind: 'edit' };
      return true;
    },
    { recordHistory: true },
  );
}

export function removeGridCol(state: EngineState): boolean {
  const ctx = findActiveGridContext(state);
  if (
    !ctx ||
    isCasesEnv(ctx.env) ||
    ctx.env === 'substack' ||
    ctx.env === 'gathered' ||
    ctx.cols <= 1
  ) {
    return false;
  }
  return runTransaction(
    state,
    (s) => {
      const { struct, env, rows, cols, row, col } = ctx;
      const prevSpec = getGridMeta(struct)?.colSpec;
      for (let r = rows - 1; r >= 0; r -= 1) {
        struct.slots.splice(r * cols + col, 1);
      }
      const nextCols = cols - 1;
      const prevGaps = struct.grid?.rowGaps?.some(Boolean) ? [...struct.grid.rowGaps] : undefined;
      const nextSpec = removeColFromSpec(prevSpec, cols, col, env);
      struct.grid = {
        env,
        rows,
        cols: nextCols,
        ...(nextSpec ? { colSpec: nextSpec } : {}),
        ...(prevGaps ? { rowGaps: prevGaps } : {}),
      };
      relabelGridSlots(struct, env, rows, nextCols);
      const targetCol = Math.min(col, nextCols - 1);
      const targetSlot = struct.slots[row * nextCols + targetCol] ?? struct.slots[0];
      s.cursor = { slotId: targetSlot.id, offset: targetSlot.children.length };
      s.selection = null;
      s.leaderMorphBackup = null;
      s.mode = { kind: 'edit' };
      return true;
    },
    { recordHistory: true },
  );
}

export function toggleGridColBar(state: EngineState): boolean {
  const ctx = findActiveGridContext(state);
  if (
    !ctx ||
    isCasesEnv(ctx.env) ||
    ctx.env === 'substack' ||
    ctx.env === 'gathered' ||
    ctx.cols < 2 ||
    ctx.col >= ctx.cols - 1
  ) {
    return false;
  }
  return runTransaction(
    state,
    (s) => {
      const { struct, env, rows, cols, col } = ctx;
      const prevSpec = getGridMeta(struct)?.colSpec;
      const prevGaps = struct.grid?.rowGaps?.some(Boolean) ? [...struct.grid.rowGaps] : undefined;
      const nextSpec = toggleColRightBar(prevSpec, cols, col, env);
      struct.grid = {
        env,
        rows,
        cols,
        ...(nextSpec ? { colSpec: nextSpec } : {}),
        ...(prevGaps ? { rowGaps: prevGaps } : {}),
      };
      s.selection = null;
      s.leaderMorphBackup = null;
      s.mode = { kind: 'edit' };
      return true;
    },
    { recordHistory: true },
  );
}

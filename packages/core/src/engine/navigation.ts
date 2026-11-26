import {
  createRawNode,
  findSlot,
  findSlotPath,
  getGridMeta,
  isSlotVisibleInteractive,
} from '../ast';
import { getVerticalNavTarget, isRenderableRawLatex, sanitizeLatexTemplate } from '../commandSpecs';
import { getSlotOrder } from '../slotOrder';
import type { Cursor, TreePoint } from '../types';
import { jumpToCursor } from './jumpMode';
import { tryExpandInlineMacro } from './latexInline';
import {
  type EngineState,
  commitLeaderDefault,
  currentSlot,
  emitChange,
  pushHistory,
  setSelectionRange,
} from './state';

export function selectBetweenPoints(
  state: EngineState,
  anchor: TreePoint,
  focus: TreePoint,
): void {
  if (anchor.slotId === focus.slotId) {
    state.gridSelection = null;
    setSelectionRange(state, anchor.slotId, anchor.offset, focus.offset);
    emitChange(state);
    return;
  }

  const pathA = findSlotPath(state.doc.root, anchor.slotId);
  const pathF = findSlotPath(state.doc.root, focus.slotId);
  if (!pathA || !pathF) return;

  const gridA = pathA[pathA.length - 1];
  const gridF = pathF[pathF.length - 1];
  if (
    gridA.parentStruct &&
    gridF.parentStruct &&
    gridA.parentStruct.id === gridF.parentStruct.id
  ) {
    const meta = getGridMeta(gridA.parentStruct);
    if (meta) {
      const ar = Math.floor(gridA.slotIndexInStruct / meta.cols);
      const ac = gridA.slotIndexInStruct % meta.cols;
      const fr = Math.floor(gridF.slotIndexInStruct / meta.cols);
      const fc = gridF.slotIndexInStruct % meta.cols;
      state.selection = null;
      state.gridSelection = {
        structId: gridA.parentStruct.id,
        r1: Math.min(ar, fr),
        c1: Math.min(ac, fc),
        r2: Math.max(ar, fr),
        c2: Math.max(ac, fc),
      };
      state.cursor = {
        slotId: gridF.slot.id,
        offset: Math.max(0, Math.min(focus.offset, gridF.slot.children.length)),
      };
      emitChange(state);
      return;
    }
  }

  state.gridSelection = null;
  let lcaIdx = 0;
  const minLen = Math.min(pathA.length, pathF.length);
  while (lcaIdx + 1 < minLen && pathA[lcaIdx + 1].slot.id === pathF[lcaIdx + 1].slot.id) {
    lcaIdx += 1;
  }
  const lcaSlot = pathA[lcaIdx].slot;
  const aChild = pathA[lcaIdx + 1];
  const fChild = pathF[lcaIdx + 1];

  const aStart = aChild ? aChild.nodeIndexInParent : anchor.offset;
  const aEnd = aChild ? aChild.nodeIndexInParent + 1 : anchor.offset;
  const fStart = fChild ? fChild.nodeIndexInParent : focus.offset;
  const fEnd = fChild ? fChild.nodeIndexInParent + 1 : focus.offset;

  const start = Math.max(0, Math.min(aStart, fStart));
  const end = Math.min(lcaSlot.children.length, Math.max(aEnd, fEnd));
  if (end > start) {
    state.selection = { slotId: lcaSlot.id, start, end };
    state.cursor = { slotId: lcaSlot.id, offset: end };
    emitChange(state);
  }
}

export function setSelection(
  state: EngineState,
  slotId: string,
  anchorOffset: number,
  focusOffset: number,
): void {
  const slot = findSlot(state.doc.root, slotId);
  if (!slot) return;
  state.lastTypingMeta = null;
  const a = Math.max(0, Math.min(anchorOffset, slot.children.length));
  const b = Math.max(0, Math.min(focusOffset, slot.children.length));
  state.cursor = { slotId: slot.id, offset: b };
  setSelectionRange(state, slot.id, a, b);
  state.mode = { kind: 'edit' };
  emitChange(state);
}

export function selectWordOrAtomAt(state: EngineState, slotId: string, offset: number): void {
  const slot = findSlot(state.doc.root, slotId);
  if (!slot || slot.children.length === 0) return;
  state.lastTypingMeta = null;
  const idx = Math.max(0, Math.min(offset, slot.children.length - 1));
  const target = slot.children[idx];
  if (target.type === 'char' && /[A-Za-z0-9]/.test(target.value)) {
    let start = idx;
    let end = idx + 1;
    while (start > 0) {
      const c = slot.children[start - 1];
      if (c.type === 'char' && /[A-Za-z0-9]/.test(c.value)) start -= 1;
      else break;
    }
    while (end < slot.children.length) {
      const c = slot.children[end];
      if (c.type === 'char' && /[A-Za-z0-9]/.test(c.value)) end += 1;
      else break;
    }
    state.cursor = { slotId: slot.id, offset: end };
    state.selection = { slotId: slot.id, start, end };
    state.mode = { kind: 'edit' };
    emitChange(state);
    return;
  }
  state.cursor = { slotId: slot.id, offset: idx + 1 };
  state.selection = { slotId: slot.id, start: idx, end: idx + 1 };
  state.mode = { kind: 'edit' };
  emitChange(state);
}

export function setCursor(state: EngineState, slotId: string, offset: number): void {
  const slot = findSlot(state.doc.root, slotId);
  if (!slot) return;
  state.lastTypingMeta = null;
  state.leaderMorphBackup = null;
  const next: Cursor = {
    slotId: slot.id,
    offset: Math.max(0, Math.min(offset, slot.children.length)),
  };
  if (next.slotId !== state.cursor.slotId) {
    jumpToCursor(state, next);
    emitChange(state);
    return;
  }
  state.cursor = next;
  state.selection = null;
  state.mode = { kind: 'edit' };
  emitChange(state);
}

export function nextSlot(state: EngineState): void {
  state.lastTypingMeta = null;
  commitLeaderDefault(state);
  state.selection = null;
  if (tryExpandInlineMacro(state, 'enter')) {
    emitChange(state);
    return;
  }
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path) return;

  if (path.length === 1) {
    if (state.doc.root.children.length > 0) {
      pushHistory(state);
      state.doc.root.children.splice(state.cursor.offset, 0, createRawNode('\\\\'));
      state.cursor.offset += 1;
      emitChange(state);
    }
    return;
  }

  const cur = path[path.length - 1];
  const parentStruct = cur.parentStruct!;
  const parentSlot = cur.parentSlot!;
  if (parentStruct.commandId === 'raw_latex' && cur.slot.children.length === 0) {
    pushHistory(state);
    parentSlot.children.splice(cur.nodeIndexInParent, 1);
    state.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent };
    emitChange(state);
    return;
  }
  const order =
    parentStruct.fillOrder ??
    getSlotOrder(parentStruct.commandId, state.settings, parentStruct.slots.length);
  const posInOrder = order.indexOf(cur.slotIndexInStruct);

  if (posInOrder >= 0 && posInOrder + 1 < order.length) {
    const next = parentStruct.slots[order[posInOrder + 1]];
    state.cursor = { slotId: next.id, offset: next.children.length };
  } else {
    state.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent + 1 };
  }
  emitChange(state);
}

export function prevSlot(state: EngineState): void {
  state.lastTypingMeta = null;
  commitLeaderDefault(state);
  state.selection = null;
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length === 1) return;

  const cur = path[path.length - 1];
  const parentStruct = cur.parentStruct!;
  const parentSlot = cur.parentSlot!;
  if (parentStruct.commandId === 'raw_latex' && cur.slot.children.length === 0) {
    pushHistory(state);
    parentSlot.children.splice(cur.nodeIndexInParent, 1);
    state.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent };
    emitChange(state);
    return;
  }
  const order =
    parentStruct.fillOrder ??
    getSlotOrder(parentStruct.commandId, state.settings, parentStruct.slots.length);
  const posInOrder = order.indexOf(cur.slotIndexInStruct);

  if (posInOrder > 0) {
    const prev = parentStruct.slots[order[posInOrder - 1]];
    state.cursor = { slotId: prev.id, offset: prev.children.length };
  } else {
    state.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent };
  }
  emitChange(state);
}

export function escapeLevel(state: EngineState): boolean {
  state.lastTypingMeta = null;
  commitLeaderDefault(state);
  state.selection = null;
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return false;
  const cur = path[path.length - 1];
  if (!cur.parentSlot) return false;
  if (cur.parentStruct?.commandId === 'raw_latex' && cur.slot.children.length === 0) {
    pushHistory(state);
    cur.parentSlot.children.splice(cur.nodeIndexInParent, 1);
    state.cursor = { slotId: cur.parentSlot.id, offset: cur.nodeIndexInParent };
    emitChange(state);
    return true;
  }
  state.cursor = { slotId: cur.parentSlot.id, offset: cur.nodeIndexInParent + 1 };
  emitChange(state);
  return true;
}

export function moveLeft(state: EngineState, extendSelection = false): void {
  state.lastTypingMeta = null;
  commitLeaderDefault(state);
  const slot = currentSlot(state);

  if (extendSelection) {
    state.gridSelection = null;
    const anchor = state.selection
      ? state.cursor.offset === state.selection.start
        ? state.selection.end
        : state.selection.start
      : state.cursor.offset;
    if (state.cursor.offset > 0) {
      state.cursor.offset -= 1;
      setSelectionRange(state, slot.id, anchor, state.cursor.offset);
    } else {
      const path = findSlotPath(state.doc.root, slot.id);
      if (path && path.length > 1) {
        const cur = path[path.length - 1];
        if (cur.parentSlot) {
          state.selection = {
            slotId: cur.parentSlot.id,
            start: cur.nodeIndexInParent,
            end: cur.nodeIndexInParent + 1,
          };
          state.cursor = { slotId: cur.parentSlot.id, offset: cur.nodeIndexInParent };
        }
      }
    }
    emitChange(state);
    return;
  }

  state.gridSelection = null;

  if (state.selection) {
    state.cursor = { slotId: state.selection.slotId, offset: state.selection.start };
    state.selection = null;
    emitChange(state);
    return;
  }

  if (state.cursor.offset > 0) {
    const prev = slot.children[state.cursor.offset - 1];
    if (prev.type === 'struct') {
      let targetIdx = prev.slots.length - 1;
      while (targetIdx > 0 && !isSlotVisibleInteractive(prev, targetIdx, '')) {
        targetIdx -= 1;
      }
      const targetSlot = prev.slots[targetIdx];
      state.cursor = { slotId: targetSlot.id, offset: targetSlot.children.length };
    } else {
      state.cursor.offset -= 1;
    }
    emitChange(state);
    return;
  }

  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return;
  const cur = path[path.length - 1];
  const parentStruct = cur.parentStruct!;
  const parentSlot = cur.parentSlot!;
  for (let idx = cur.slotIndexInStruct - 1; idx >= 0; idx -= 1) {
    if (isSlotVisibleInteractive(parentStruct, idx, state.cursor.slotId)) {
      const prevSibling = parentStruct.slots[idx];
      state.cursor = { slotId: prevSibling.id, offset: prevSibling.children.length };
      emitChange(state);
      return;
    }
  }
  state.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent };
  emitChange(state);
}

export function moveRight(state: EngineState, extendSelection = false): void {
  state.lastTypingMeta = null;
  commitLeaderDefault(state);
  const slot = currentSlot(state);

  if (extendSelection) {
    state.gridSelection = null;
    const anchor = state.selection
      ? state.cursor.offset === state.selection.end
        ? state.selection.start
        : state.selection.end
      : state.cursor.offset;
    if (state.cursor.offset < slot.children.length) {
      state.cursor.offset += 1;
      setSelectionRange(state, slot.id, anchor, state.cursor.offset);
    } else {
      const path = findSlotPath(state.doc.root, slot.id);
      if (path && path.length > 1) {
        const cur = path[path.length - 1];
        if (cur.parentSlot) {
          state.selection = {
            slotId: cur.parentSlot.id,
            start: cur.nodeIndexInParent,
            end: cur.nodeIndexInParent + 1,
          };
          state.cursor = { slotId: cur.parentSlot.id, offset: cur.nodeIndexInParent + 1 };
        }
      }
    }
    emitChange(state);
    return;
  }

  state.gridSelection = null;

  if (state.selection) {
    state.cursor = { slotId: state.selection.slotId, offset: state.selection.end };
    state.selection = null;
    emitChange(state);
    return;
  }

  if (state.cursor.offset < slot.children.length) {
    const next = slot.children[state.cursor.offset];
    if (next.type === 'struct') {
      let targetIdx = 0;
      while (targetIdx + 1 < next.slots.length && !isSlotVisibleInteractive(next, targetIdx, '')) {
        targetIdx += 1;
      }
      state.cursor = { slotId: next.slots[targetIdx].id, offset: 0 };
    } else {
      state.cursor.offset += 1;
    }
    emitChange(state);
    return;
  }

  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return;
  const cur = path[path.length - 1];
  const parentStruct = cur.parentStruct!;
  const parentSlot = cur.parentSlot!;
  if (parentStruct.commandId === 'raw_latex') {
    if (cur.slot.children.length === 0) {
      pushHistory(state);
      parentSlot.children.splice(cur.nodeIndexInParent, 1);
      state.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent };
      emitChange(state);
      return;
    }
    const rawText = sanitizeLatexTemplate(
      cur.slot.children
        .map((n) => (n.type === 'char' ? n.value : n.type === 'symbol' || n.type === 'raw' ? n.latex : ''))
        .join(''),
    );
    if (!isRenderableRawLatex(rawText)) {
      return;
    }
  }
  for (let idx = cur.slotIndexInStruct + 1; idx < parentStruct.slots.length; idx += 1) {
    if (isSlotVisibleInteractive(parentStruct, idx, state.cursor.slotId)) {
      const nextSibling = parentStruct.slots[idx];
      state.cursor = { slotId: nextSibling.id, offset: 0 };
      emitChange(state);
      return;
    }
  }
  state.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent + 1 };
  emitChange(state);
}

function moveRootLineVertical(state: EngineState, delta: -1 | 1): boolean {
  const children = state.doc.root.children;
  const lineBounds: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < children.length; i += 1) {
    if (children[i].type === 'raw' && (children[i] as { latex: string }).latex.trim() === '\\\\') {
      lineBounds.push({ start, end: i });
      start = i + 1;
    }
  }
  lineBounds.push({ start, end: children.length });
  if (lineBounds.length <= 1) return false;

  const curLine = lineBounds.findIndex(
    (b) => state.cursor.offset >= b.start && state.cursor.offset <= b.end,
  );
  if (curLine < 0) return false;
  const nextLine = curLine + delta;
  if (nextLine < 0 || nextLine >= lineBounds.length) return false;
  const colOffset = state.cursor.offset - lineBounds[curLine].start;
  const target = lineBounds[nextLine];
  state.cursor = {
    slotId: state.doc.root.id,
    offset: Math.min(target.start + colOffset, target.end),
  };
  return true;
}

function moveVertical(state: EngineState, direction: 'up' | 'down'): void {
  commitLeaderDefault(state);
  state.selection = null;
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path) return;
  if (path.length <= 1) {
    if (moveRootLineVertical(state, direction === 'up' ? -1 : 1)) emitChange(state);
    return;
  }

  const cur = path[path.length - 1];
  const parentStruct = cur.parentStruct!;
  const sIdx = cur.slotIndexInStruct;

  const targetIdx = getVerticalNavTarget(
    parentStruct.commandId,
    sIdx,
    direction,
    parentStruct.slots.length,
  );
  if (targetIdx !== undefined) {
    const targetSlot = parentStruct.slots[targetIdx];
    state.cursor = { slotId: targetSlot.id, offset: targetSlot.children.length };
    emitChange(state);
    return;
  }

  const grid = getGridMeta(parentStruct);
  if (grid) {
    const neighborIdx = direction === 'up' ? sIdx - grid.cols : sIdx + grid.cols;
    if (neighborIdx >= 0 && neighborIdx < parentStruct.slots.length) {
      const neighbor = parentStruct.slots[neighborIdx];
      if (neighbor) {
        state.cursor = { slotId: neighbor.id, offset: neighbor.children.length };
        emitChange(state);
        return;
      }
    }
  }

  escapeLevel(state);
}

export function moveUp(state: EngineState): void {
  moveVertical(state, 'up');
}

export function moveDown(state: EngineState): void {
  moveVertical(state, 'down');
}

export function moveHome(state: EngineState, extendSelection = false): void {
  commitLeaderDefault(state);
  const slot = currentSlot(state);
  if (extendSelection) {
    const anchor = state.selection ? state.selection.end : state.cursor.offset;
    state.cursor.offset = 0;
    setSelectionRange(state, slot.id, 0, anchor);
  } else {
    state.cursor.offset = 0;
    state.selection = null;
  }
  emitChange(state);
}

export function moveEnd(state: EngineState, extendSelection = false): void {
  state.mode = { kind: 'edit' };
  const slot = currentSlot(state);
  if (extendSelection) {
    const anchor = state.selection ? state.selection.start : state.cursor.offset;
    state.cursor.offset = slot.children.length;
    setSelectionRange(state, slot.id, anchor, slot.children.length);
  } else {
    state.cursor.offset = slot.children.length;
    state.selection = null;
  }
  emitChange(state);
}

export function selectAll(state: EngineState): void {
  state.mode = { kind: 'edit' };
  const slot = currentSlot(state);
  if (slot.children.length === 0) {
    if (state.doc.root.children.length > 0) {
      state.cursor = { slotId: state.doc.root.id, offset: state.doc.root.children.length };
      state.selection = {
        slotId: state.doc.root.id,
        start: 0,
        end: state.doc.root.children.length,
      };
      emitChange(state);
    }
    return;
  }
  state.cursor.offset = slot.children.length;
  state.selection = { slotId: slot.id, start: 0, end: slot.children.length };
  emitChange(state);
}

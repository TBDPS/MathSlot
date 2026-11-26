import { buildJumpTargets, findSlot } from '../ast';
import type { Cursor } from '../types';
import { type EngineState, emitChange } from './state';

export function recordJumpOrigin(state: EngineState, origin: Cursor): void {
  const prev = state.jumpHistory[state.jumpHistoryIdx];
  if (prev && prev.slotId === origin.slotId && prev.offset === origin.offset) {
    return;
  }
  state.jumpHistory = state.jumpHistory.slice(0, state.jumpHistoryIdx + 1);
  state.jumpHistory.push({ ...origin });
  if (state.jumpHistory.length > 64) {
    state.jumpHistory.shift();
  }
  state.jumpHistoryIdx = state.jumpHistory.length - 1;
}

export function jumpToCursor(state: EngineState, target: Cursor): void {
  const slot = findSlot(state.doc.root, target.slotId);
  if (!slot) return;
  state.lastTypingMeta = null;
  const clamped: Cursor = {
    slotId: slot.id,
    offset: Math.max(0, Math.min(target.offset, slot.children.length)),
  };
  if (clamped.slotId !== state.cursor.slotId || clamped.offset !== state.cursor.offset) {
    recordJumpOrigin(state, state.cursor);
    state.cursor = clamped;
    state.jumpHistory = state.jumpHistory.slice(0, state.jumpHistoryIdx + 1);
    state.jumpHistory.push({ ...clamped });
    state.jumpHistoryIdx = state.jumpHistory.length - 1;
  }
  state.selection = null;
  state.mode = { kind: 'edit' };
}

export function jumpBack(state: EngineState): boolean {
  state.lastTypingMeta = null;
  state.mode = { kind: 'edit' };
  state.selection = null;
  while (state.jumpHistoryIdx > 0) {
    state.jumpHistoryIdx -= 1;
    const entry = state.jumpHistory[state.jumpHistoryIdx];
    const slot = findSlot(state.doc.root, entry.slotId);
    if (slot) {
      state.cursor = {
        slotId: slot.id,
        offset: Math.max(0, Math.min(entry.offset, slot.children.length)),
      };
      emitChange(state);
      return true;
    }
  }
  emitChange(state);
  return false;
}

export function jumpForward(state: EngineState): boolean {
  state.lastTypingMeta = null;
  state.mode = { kind: 'edit' };
  state.selection = null;
  while (state.jumpHistoryIdx + 1 < state.jumpHistory.length) {
    state.jumpHistoryIdx += 1;
    const entry = state.jumpHistory[state.jumpHistoryIdx];
    const slot = findSlot(state.doc.root, entry.slotId);
    if (slot) {
      state.cursor = {
        slotId: slot.id,
        offset: Math.max(0, Math.min(entry.offset, slot.children.length)),
      };
      emitChange(state);
      return true;
    }
  }
  emitChange(state);
  return false;
}

export function enterJumpMode(state: EngineState): void {
  state.lastTypingMeta = null;
  const targets = buildJumpTargets(state.doc.root);
  if (targets.length === 0) {
    state.mode = { kind: 'edit' };
    emitChange(state);
    return;
  }
  state.mode = {
    kind: 'jump',
    scopePath: [],
    scopeSlotId: state.doc.root.id,
    typed: '',
    targets,
    activeIdx: 0,
  };
  emitChange(state);
}

export function drillIntoJumpScope(state: EngineState, slotId: string, label: string): boolean {
  if (state.mode.kind !== 'jump') return false;
  const subSlot = findSlot(state.doc.root, slotId);
  if (!subSlot) return false;
  const subTargets = buildJumpTargets(subSlot);
  if (subTargets.length === 0) {
    jumpToCursor(state, { slotId: subSlot.id, offset: subSlot.children.length });
    return true;
  }
  state.mode = {
    kind: 'jump',
    scopePath: [...state.mode.scopePath, { slotId, label }],
    scopeSlotId: slotId,
    typed: '',
    targets: subTargets,
    activeIdx: 0,
  };
  return true;
}

export function stepJumpBack(state: EngineState): void {
  if (state.mode.kind !== 'jump') return;
  if (state.mode.typed.length > 0) {
    const scopeSlot = findSlot(state.doc.root, state.mode.scopeSlotId) ?? state.doc.root;
    state.mode = {
      ...state.mode,
      typed: '',
      targets: buildJumpTargets(scopeSlot),
      activeIdx: 0,
    };
    emitChange(state);
    return;
  }
  if (state.mode.scopePath.length === 0) {
    state.mode = { kind: 'edit' };
    emitChange(state);
    return;
  }
  const nextPath = state.mode.scopePath.slice(0, -1);
  const parentSlotId = nextPath.length > 0 ? nextPath[nextPath.length - 1].slotId : state.doc.root.id;
  const parentSlot = findSlot(state.doc.root, parentSlotId) ?? state.doc.root;
  state.mode = {
    kind: 'jump',
    scopePath: nextPath,
    scopeSlotId: parentSlot.id,
    typed: '',
    targets: buildJumpTargets(parentSlot),
    activeIdx: 0,
  };
  emitChange(state);
}

export function moveJumpSelection(state: EngineState, delta: -1 | 1): void {
  if (state.mode.kind !== 'jump' || state.mode.targets.length === 0) return;
  const len = state.mode.targets.length;
  const nextIdx = (state.mode.activeIdx + delta + len) % len;
  state.mode = { ...state.mode, activeIdx: nextIdx };
  emitChange(state);
}

export function drillJumpSelection(state: EngineState): boolean {
  if (state.mode.kind !== 'jump') return false;
  const target = state.mode.targets[state.mode.activeIdx];
  if (!target || !target.isComposite) return false;
  const ok = drillIntoJumpScope(state, target.slotId, target.slotLabel);
  if (ok) emitChange(state);
  return ok;
}

export function confirmJumpSelection(state: EngineState): boolean {
  if (state.mode.kind !== 'jump') return false;
  if (state.mode.scopePath.length > 0 && state.mode.activeIdx === 0) {
    const scopeSlot = findSlot(state.doc.root, state.mode.scopeSlotId);
    if (scopeSlot) {
      jumpToCursor(state, { slotId: scopeSlot.id, offset: scopeSlot.children.length });
      emitChange(state);
      return true;
    }
  }
  const target = state.mode.targets[state.mode.activeIdx];
  if (!target) {
    state.mode = { kind: 'edit' };
    emitChange(state);
    return false;
  }
  if (target.isComposite) {
    const ok = drillIntoJumpScope(state, target.slotId, target.slotLabel);
    if (ok) emitChange(state);
    return ok;
  }
  jumpToCursor(state, { slotId: target.slotId, offset: target.offset });
  emitChange(state);
  return true;
}

export function handleJumpKey(state: EngineState, key: string): boolean {
  if (state.mode.kind !== 'jump') return false;
  const scopeSlot = findSlot(state.doc.root, state.mode.scopeSlotId) ?? state.doc.root;

  if (state.mode.typed.length > 0 && key === '-') {
    const prevTyped = state.mode.typed.slice(0, -1);
    const allTargets = buildJumpTargets(scopeSlot);
    const remaining = prevTyped
      ? allTargets.filter((t) => t.label.startsWith(prevTyped))
      : allTargets;
    state.mode = {
      ...state.mode,
      typed: prevTyped,
      targets: remaining,
      activeIdx: 0,
    };
    emitChange(state);
    return true;
  }

  if (state.mode.typed === '') {
    if (key === '.' || key === ';' || key === '$') {
      jumpToCursor(state, { slotId: scopeSlot.id, offset: scopeSlot.children.length });
      emitChange(state);
      return true;
    }
    if (key === '0' || key === '^') {
      jumpToCursor(state, { slotId: scopeSlot.id, offset: 0 });
      emitChange(state);
      return true;
    }
    if (key === '-') {
      return jumpBack(state);
    }
    if (key === '=' || key === '+') {
      return jumpForward(state);
    }
  }

  const ch = key.toLowerCase();
  if (!/^[a-z]$/.test(ch)) {
    state.mode = { kind: 'edit' };
    emitChange(state);
    return false;
  }
  const nextTyped = state.mode.typed + ch;
  const exact = state.mode.targets.find((t) => t.label === nextTyped);
  if (exact) {
    if (exact.isComposite) {
      const ok = drillIntoJumpScope(state, exact.slotId, exact.slotLabel);
      if (ok) emitChange(state);
      return ok;
    }
    jumpToCursor(state, { slotId: exact.slotId, offset: exact.offset });
    emitChange(state);
    return true;
  }
  const remaining = state.mode.targets.filter((t) => t.label.startsWith(nextTyped));
  if (remaining.length === 0) {
    state.mode = { kind: 'edit' };
    emitChange(state);
    return false;
  }
  state.mode = {
    ...state.mode,
    typed: nextTyped,
    targets: remaining,
    activeIdx: 0,
  };
  emitChange(state);
  return true;
}

import { cloneDocument } from '../ast';
import {
  SUBMENU_KEYS,
  getSubmenuCommands,
  getSubmenuDefaultCommandId,
} from '../catalog';
import type { Snippet } from '../types';
import { enterJumpMode } from './jumpMode';
import { escapeLevel } from './navigation';
import {
  type EngineState,
  cancelLeader,
  commitLeaderDefault,
  emitChange,
  getInputContext,
  restoreLeaderMorphBackup,
} from './state';
import { insertText } from './inputFlow';
import { insertCommand, insertSnippetAtCursor } from './structuralEdit';

export function triggerLeader(state: EngineState): void {
  state.lastTypingMeta = null;
  if (getInputContext(state) === 'raw') {
    escapeLevel(state);
    return;
  }
  if (state.mode.kind === 'leader') {
    if (state.mode.prefix !== '' && state.leaderMorphBackup) {
      commitLeaderDefault(state);
    } else {
      cancelLeader(state);
    }
    return;
  }
  state.leaderMorphBackup = null;
  state.mode = { kind: 'leader', prefix: '' };
  emitChange(state);
}

export function exitMode(state: EngineState): void {
  state.lastTypingMeta = null;
  if (state.mode.kind === 'leader') {
    cancelLeader(state);
    return;
  }
  state.leaderMorphBackup = null;
  state.mode = { kind: 'edit' };
  state.selection = null;
  emitChange(state);
}

export function resolveSubmenuDefault(
  state: EngineState,
  prefix: string,
): { kind: 'command'; id: string } | { kind: 'snippet'; snippet: Snippet } | null {
  if (prefix === 'k') {
    const firstCustom = state.customCommands[0];
    return firstCustom ? { kind: 'command', id: firstCustom.id } : null;
  }
  if (prefix === 't') {
    const firstSnippet = state.snippets[0];
    return firstSnippet ? { kind: 'snippet', snippet: firstSnippet } : null;
  }
  const curatedId = getSubmenuDefaultCommandId(prefix);
  if (curatedId && state.commandsById.has(curatedId)) {
    return { kind: 'command', id: curatedId };
  }
  const list = state.effectiveCommands.filter(
    (c) => c.keys.length === 2 && c.keys[0] === prefix,
  );
  const fallbackList = list.length > 0 ? list : getSubmenuCommands(prefix);
  if (fallbackList.length > 0) {
    return { kind: 'command', id: fallbackList[0].id };
  }
  return null;
}

export function acceptSubmenuDefault(state: EngineState): boolean {
  if (state.mode.kind !== 'leader' || state.mode.prefix === '') return false;
  if (state.leaderMorphBackup) {
    commitLeaderDefault(state);
    return true;
  }
  const { prefix } = state.mode;
  state.mode = { kind: 'edit' };
  const resolved = resolveSubmenuDefault(state, prefix);
  if (!resolved) return false;
  if (resolved.kind === 'snippet') {
    return insertSnippetAtCursor(state, resolved.snippet);
  }
  return insertCommand(state, resolved.id);
}

export function handleLeaderKey(
  state: EngineState,
  key: string,
): { handled: boolean; executedCommandId?: string } {
  if (state.mode.kind !== 'leader') return { handled: false };
  if (key.length !== 1) return { handled: false };

  const { prefix } = state.mode;
  if (prefix === '') {
    if (key === 'j' || key === 'J') {
      state.leaderMorphBackup = null;
      enterJumpMode(state);
      return { handled: true };
    }
    if (SUBMENU_KEYS.has(key) || key === 'k' || key === 't') {
      const resolved = resolveSubmenuDefault(state, key);
      if (resolved) {
        const backup = {
          doc: cloneDocument(state.doc),
          cursor: { ...state.cursor },
          selection: state.selection ? { ...state.selection } : null,
          undoLen: state.undoStack.length,
        };
        const ok =
          resolved.kind === 'snippet'
            ? insertSnippetAtCursor(state, resolved.snippet)
            : insertCommand(state, resolved.id);
        if (ok) {
          state.leaderMorphBackup = backup;
          const pendingId = resolved.kind === 'snippet' ? resolved.snippet.id : resolved.id;
          state.mode = { kind: 'leader', prefix: key, pendingDefaultId: pendingId };
          emitChange(state);
          return { handled: true, executedCommandId: pendingId };
        }
      }
      state.leaderMorphBackup = null;
      state.mode = { kind: 'leader', prefix: key };
      emitChange(state);
      return { handled: true };
    }
    const direct = state.commandsByKeys.get(key);
    if (direct) {
      state.leaderMorphBackup = null;
      state.mode = { kind: 'edit' };
      insertCommand(state, direct.id);
      return { handled: true, executedCommandId: direct.id };
    }
    state.leaderMorphBackup = null;
    state.mode = { kind: 'edit' };
    emitChange(state);
    return { handled: true };
  }

  if (key === ' ') {
    acceptSubmenuDefault(state);
    return { handled: true };
  }

  if (prefix === 'k') {
    const custom = state.customCommands.find((c) => c.key === key);
    if (custom) {
      restoreLeaderMorphBackup(state);
      state.mode = { kind: 'edit' };
      insertCommand(state, custom.id);
      return { handled: true, executedCommandId: custom.id };
    }
    if (state.leaderMorphBackup) {
      commitLeaderDefault(state);
      insertText(state, key);
      return { handled: true };
    }
    state.mode = { kind: 'edit' };
    emitChange(state);
    return { handled: true };
  }

  if (prefix === 't') {
    const snip = state.snippets.find((s) => s.key === key);
    if (snip) {
      restoreLeaderMorphBackup(state);
      state.mode = { kind: 'edit' };
      insertSnippetAtCursor(state, snip);
      return { handled: true, executedCommandId: snip.id };
    }
    if (state.leaderMorphBackup) {
      commitLeaderDefault(state);
      insertText(state, key);
      return { handled: true };
    }
    state.mode = { kind: 'edit' };
    emitChange(state);
    return { handled: true };
  }

  const full = state.commandsByKeys.get(prefix + key);
  if (full) {
    restoreLeaderMorphBackup(state);
    state.mode = { kind: 'edit' };
    insertCommand(state, full.id);
    return { handled: true, executedCommandId: full.id };
  }

  if (state.leaderMorphBackup) {
    commitLeaderDefault(state);
    insertText(state, key);
    return { handled: true };
  }
  state.mode = { kind: 'edit' };
  emitChange(state);
  return { handled: true };
}

export function stepLeaderBack(state: EngineState): void {
  if (state.mode.kind !== 'leader') return;
  if (state.mode.prefix.length > 0) {
    restoreLeaderMorphBackup(state);
    state.mode = { kind: 'leader', prefix: '' };
    emitChange(state);
  } else {
    cancelLeader(state);
  }
}

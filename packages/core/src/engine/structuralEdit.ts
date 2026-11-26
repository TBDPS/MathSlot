import {
  createCharNode,
  createRawNode,
  createStructNode,
  createSymbolNode,
  findSlotPath,
  getGridMeta,
  isOptionalSlot,
  isSlotVisibleInteractive,
  isStructEmpty,
  textToCharNodes,
} from '../ast';
import { COMMANDS_BY_ID } from '../catalog';
import {
  BACKWARD_WRAP_CMDS,
  PREFIX_BIGOPS,
  getCommandCapabilities,
  sanitizeLatexTemplate,
} from '../commandSpecs';
import { importFormula } from '../parser';
import { getSlotOrder } from '../slotOrder';
import type { MathNode, SlotNode, Snippet } from '../types';
import { tryPasteTsvIntoGrid } from './gridOps';
import { insertCustomCommandInternal } from './inputFlow';
import { stepLeaderBack } from './leaderMode';
import {
  type EngineState,
  currentSlot,
  deleteSelectionInternal,
  emitChange,
  findStructById,
  getInputContext,
  isInsideOperatorName,
  pushHistory,
  restoreLeaderMorphBackup,
  sanitizeNodesForTargetSlot,
} from './state';

export function pasteLiteralText(state: EngineState, text: string): void {
  const clean = text.replace(/\r\n/g, '\n');
  if (!clean) return;
  state.mode = { kind: 'edit' };
  pushHistory(state);
  deleteSelectionInternal(state);
  const slot = currentSlot(state);
  const allowLineBreak = slot.id === state.doc.root.id;
  const nodes: MathNode[] = [];
  const lines = clean.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    nodes.push(...textToCharNodes(lines[i], true));
    if (i < lines.length - 1) {
      nodes.push(allowLineBreak ? createRawNode('\\\\') : createCharNode(' ', true));
    }
  }
  slot.children.splice(state.cursor.offset, 0, ...nodes);
  state.cursor.offset += nodes.length;
  emitChange(state);
}

export function pasteText(state: EngineState, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (tryPasteTsvIntoGrid(state, text)) return;
  const inputCtx = getInputContext(state);
  if (inputCtx === 'text' || inputCtx === 'raw' || isInsideOperatorName(state)) {
    pasteLiteralText(state, trimmed);
    return;
  }
  const isUrlLike = trimmed.includes('://');
  const isStrongLatex =
    trimmed.includes('\\') ||
    trimmed.includes('▸') ||
    (trimmed.startsWith('$') && trimmed.endsWith('$'));
  const isLikelySnakeCaseIdentifier = /^[a-zA-Z]{2,}_[a-zA-Z0-9_]+$/.test(trimmed);
  const hasCjk = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(trimmed);
  const hasPunctMathShorthand =
    !isUrlLike && /(?:<=>|<->|\|->|->|<-|=>|<=|>=|!=|~=|\+-|-\+)/.test(trimmed);
  const isCompactScript =
    !hasCjk &&
    !trimmed.includes('\n') &&
    !/\s{2,}/.test(trimmed) &&
    trimmed.split(/\s+/).length <= 4 &&
    (trimmed.includes('^') ||
      hasPunctMathShorthand ||
      (trimmed.includes('_') && !isLikelySnakeCaseIdentifier));

  if (isStrongLatex || isCompactScript) {
    const normalized =
      hasPunctMathShorthand && !isStrongLatex
        ? trimmed
            .replace(/<=>/g, ' \\Leftrightarrow ')
            .replace(/<->/g, ' \\leftrightarrow ')
            .replace(/\|->/g, ' \\mapsto ')
            .replace(/->/g, ' \\to ')
            .replace(/<-/g, ' \\leftarrow ')
            .replace(/=>/g, ' \\Rightarrow ')
            .replace(/<=/g, ' \\le ')
            .replace(/>=/g, ' \\ge ')
            .replace(/!=/g, ' \\neq ')
            .replace(/~=/g, ' \\cong ')
            .replace(/\+-/g, ' \\pm ')
            .replace(/-\+/g, ' \\mp ')
        : trimmed;
    const res = importFormula(normalized);
    const hasError = res.diagnostics.some((d) => d.severity === 'error');
    if (!hasError && res.doc.root.children.length > 0) {
      pushHistory(state);
      deleteSelectionInternal(state);
      const slot = currentSlot(state);
      const safeNodes = sanitizeNodesForTargetSlot(state, res.doc.root.children, slot.id);
      slot.children.splice(state.cursor.offset, 0, ...safeNodes);
      state.cursor.offset += safeNodes.length;
      state.mode = { kind: 'edit' };
      emitChange(state);
      return;
    }
  }
  pasteLiteralText(state, trimmed);
}

export function insertSnippetAtCursor(state: EngineState, snippet: Pick<Snippet, 'latex'>): boolean {
  if (state.mode.kind === 'leader' && state.leaderMorphBackup) {
    restoreLeaderMorphBackup(state);
  } else {
    state.leaderMorphBackup = null;
  }
  const res = importFormula(sanitizeLatexTemplate(snippet.latex));
  const hasErr = res.diagnostics.some((d) => d.severity === 'error');
  if (hasErr || res.doc.root.children.length === 0) return false;
  pushHistory(state);
  deleteSelectionInternal(state);
  const slot = currentSlot(state);
  const sanitized = sanitizeNodesForTargetSlot(state, res.doc.root.children, slot.id);
  const inText = getInputContext(state) === 'text';
  const inserted = inText
    ? [createStructNode(COMMANDS_BY_ID.get('inline_math')!, [sanitized])]
    : sanitized;
  slot.children.splice(state.cursor.offset, 0, ...inserted);
  const afterOffset = state.cursor.offset + inserted.length;
  state.mode = { kind: 'edit' };

  const findFirstRequiredEmpty = (nodes: readonly MathNode[]): SlotNode | null => {
    for (const n of nodes) {
      if (n.type === 'struct') {
        for (let sIdx = 0; sIdx < n.slots.length; sIdx += 1) {
          const sub = n.slots[sIdx];
          if (sub.children.length === 0) {
            if (!isOptionalSlot(n.commandId, sIdx)) return sub;
            continue;
          }
          const deeper = findFirstRequiredEmpty(sub.children);
          if (deeper) return deeper;
        }
      }
    }
    return null;
  };
  const firstEmpty = findFirstRequiredEmpty(inserted);
  if (firstEmpty) {
    state.cursor = { slotId: firstEmpty.id, offset: 0 };
  } else {
    state.cursor = { slotId: slot.id, offset: afterOffset };
  }
  emitChange(state);
  return true;
}

export function insertCommand(
  state: EngineState,
  commandId: string,
  options: { disableAutoWrap?: boolean } = {},
): boolean {
  if (state.mode.kind === 'leader' && state.leaderMorphBackup) {
    restoreLeaderMorphBackup(state);
  } else {
    state.leaderMorphBackup = null;
  }
  if (commandId === 'nth_root' && !state.commandsById.has('nth_root')) {
    commandId = 'sqrt';
  }

  if (getInputContext(state) === 'raw') {
    state.mode = { kind: 'edit' };
    emitChange(state);
    return false;
  }

  if (getInputContext(state) === 'text') {
    if (commandId === 'text_box') {
      state.mode = { kind: 'edit' };
      emitChange(state);
      return false;
    }
    if (commandId !== 'inline_math') {
      const inlineCmd = COMMANDS_BY_ID.get('inline_math');
      if (inlineCmd) {
        pushHistory(state);
        const undoBase = state.undoStack.length;
        const textSlot = currentSlot(state);
        const selected =
          state.selection && state.selection.slotId === textSlot.id
            ? deleteSelectionInternal(state)
            : [];
        const wrapper = createStructNode(inlineCmd, [selected]);
        textSlot.children.splice(state.cursor.offset, 0, wrapper);
        state.cursor = { slotId: wrapper.slots[0].id, offset: selected.length };
        if (selected.length > 0) {
          state.selection = { slotId: wrapper.slots[0].id, start: 0, end: selected.length };
        }
        const ok = insertCommand(state, commandId);
        if (state.undoStack.length > undoBase) {
          state.undoStack.length = undoBase;
        }
        emitChange(state);
        return ok;
      }
    }
  }

  const custom = state.customCommands.find((c) => c.id === commandId);
  if (custom) {
    pushHistory(state);
    state.mode = { kind: 'edit' };
    insertCustomCommandInternal(state, custom);
    emitChange(state);
    return true;
  }

  const cmd = state.commandsById.get(commandId) ?? COMMANDS_BY_ID.get(commandId);
  if (!cmd) return false;

  pushHistory(state);
  state.mode = { kind: 'edit' };

  const slot = currentSlot(state);
  if (cmd.slots.length === 0) {
    deleteSelectionInternal(state);
    const sym = createSymbolNode(cmd);
    slot.children.splice(state.cursor.offset, 0, sym);
    state.cursor.offset += 1;
    emitChange(state);
    return true;
  }

  const slotContents: MathNode[][] = cmd.slots.map(() => []);
  let wrappedSlotIdx: number | null = null;

  if (!options.disableAutoWrap && state.selection && state.selection.slotId === slot.id) {
    const selected = deleteSelectionInternal(state);
    const targetIdx = cmd.wrapSlot ?? 0;
    if (targetIdx >= 0 && targetIdx < slotContents.length) {
      slotContents[targetIdx] = selected;
      wrappedSlotIdx = targetIdx;
    }
  } else if (
    !options.disableAutoWrap &&
    BACKWARD_WRAP_CMDS.has(cmd.id) &&
    state.cursor.offset > 0 &&
    cmd.wrapSlot === 0
  ) {
    const prev = slot.children[state.cursor.offset - 1];
    const isWrappable =
      prev.type === 'symbol' ||
      (prev.type === 'struct' && !PREFIX_BIGOPS.has(prev.commandId)) ||
      (prev.type === 'char' && !/^[\s+=,;:\-<>()[\]~]$/.test(prev.value));

    if (isWrappable) {
      let wrapped: MathNode[];
      if (prev.type === 'char' && /[0-9]/.test(prev.value)) {
        let start = state.cursor.offset - 1;
        while (start > 0) {
          const c = slot.children[start - 1];
          if (c.type === 'char' && /[0-9]/.test(c.value)) start -= 1;
          else break;
        }
        wrapped = slot.children.splice(start, state.cursor.offset - start);
        state.cursor.offset = start;
      } else {
        wrapped = slot.children.splice(state.cursor.offset - 1, 1);
        state.cursor.offset -= 1;
      }
      slotContents[0] = wrapped;
      wrappedSlotIdx = 0;
    }
  } else if (
    !options.disableAutoWrap &&
    cmd.wrapSlot !== null &&
    cmd.wrapSlot > 0 &&
    state.cursor.offset < slot.children.length
  ) {
    let end = state.cursor.offset;
    while (end < slot.children.length) {
      const n = slot.children[end];
      if (n.type === 'char' && (n.value === '=' || n.value === ',' || n.value === ';')) break;
      if (n.type === 'raw' && n.latex.trim() === '\\\\') break;
      end += 1;
    }
    while (end > state.cursor.offset) {
      const last = slot.children[end - 1];
      if (last.type === 'char' && last.value === ' ') end -= 1;
      else break;
    }
    if (end > state.cursor.offset) {
      slotContents[cmd.wrapSlot] = slot.children.splice(
        state.cursor.offset,
        end - state.cursor.offset,
      );
      wrappedSlotIdx = cmd.wrapSlot;
    }
  }

  const builtin = COMMANDS_BY_ID.get(cmd.id);
  const customTpl =
    !builtin || builtin.latex !== cmd.latex ? sanitizeLatexTemplate(cmd.latex) : undefined;
  const caps = getCommandCapabilities(cmd.id);

  if (!customTpl && caps.initialSlotSymbols) {
    for (const [idxStr, symId] of Object.entries(caps.initialSlotSymbols)) {
      const idx = Number(idxStr);
      const symCmd = COMMANDS_BY_ID.get(symId);
      if (symCmd && idx >= 0 && idx < slotContents.length && slotContents[idx].length === 0) {
        slotContents[idx] = [createSymbolNode(symCmd)];
      }
    }
  }

  const struct = createStructNode(cmd, slotContents, customTpl);
  if (!customTpl && caps.instantiateGrid && caps.gridMeta) {
    struct.grid = {
      env: caps.gridMeta.env,
      rows: caps.gridMeta.rows,
      cols: caps.gridMeta.cols,
      ...(caps.gridMeta.colSpec ? { colSpec: caps.gridMeta.colSpec } : {}),
    };
  }
  slot.children.splice(state.cursor.offset, 0, struct);

  const order = getSlotOrder(cmd.id, state.settings, struct.slots.length);
  const orderedSlots = order.map((idx) => ({ idx, slot: struct.slots[idx] }));
  const firstEmpty = orderedSlots.find((s) => s.slot.children.length === 0);
  const allEmptyAreOptional =
    wrappedSlotIdx !== null &&
    orderedSlots.every((s) => s.slot.children.length > 0 || isOptionalSlot(cmd.id, s.idx));

  if (allEmptyAreOptional && caps.exitAfterWrapIfRestOptional) {
    state.cursor = { slotId: slot.id, offset: state.cursor.offset + 1 };
  } else if (firstEmpty) {
    state.cursor = { slotId: firstEmpty.slot.id, offset: 0 };
  } else if (wrappedSlotIdx !== null && struct.slots.length === 1) {
    state.cursor = { slotId: slot.id, offset: state.cursor.offset + 1 };
  } else {
    const first = orderedSlots[0]?.slot ?? struct.slots[0];
    state.cursor = { slotId: first.id, offset: first.children.length };
  }
  emitChange(state);
  return true;
}

export function backspace(state: EngineState): void {
  state.lastTypingMeta = null;
  if (state.mode.kind === 'leader') {
    stepLeaderBack(state);
    return;
  }
  if (state.mode.kind === 'jump') {
    state.mode = { kind: 'edit' };
    emitChange(state);
    return;
  }

  if (state.gridSelection) {
    const { structId, r1, c1, r2, c2 } = state.gridSelection;
    const struct = findStructById(state.doc.root, structId);
    const meta = struct ? getGridMeta(struct) : null;
    if (struct && meta) {
      pushHistory(state);
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) {
          const s = struct.slots[r * meta.cols + c];
          if (s) s.children = [];
        }
      }
      const first = struct.slots[r1 * meta.cols + c1];
      if (first) state.cursor = { slotId: first.id, offset: 0 };
      state.gridSelection = null;
      emitChange(state);
      return;
    }
    state.gridSelection = null;
  }

  if (state.selection) {
    pushHistory(state);
    deleteSelectionInternal(state);
    emitChange(state);
    return;
  }

  const slot = currentSlot(state);
  if (state.cursor.offset > 0) {
    const prev = slot.children[state.cursor.offset - 1];
    if (prev.type === 'struct') {
      if (isStructEmpty(prev)) {
        pushHistory(state);
        slot.children.splice(state.cursor.offset - 1, 1);
        state.cursor.offset -= 1;
      } else {
        const lastSlot = prev.slots[prev.slots.length - 1];
        state.cursor = { slotId: lastSlot.id, offset: lastSlot.children.length };
      }
      emitChange(state);
      return;
    }

    pushHistory(state);
    slot.children.splice(state.cursor.offset - 1, 1);
    state.cursor.offset -= 1;
    emitChange(state);
    return;
  }

  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return;
  const cur = path[path.length - 1];
  const parentStruct = cur.parentStruct!;
  const parentSlot = cur.parentSlot!;

  const otherSlotsEmpty = parentStruct.slots.every(
    (s, idx) => idx === cur.slotIndexInStruct || s.children.length === 0,
  );
  const allEarlierAreOptionalEmpty = parentStruct.slots
    .slice(0, cur.slotIndexInStruct)
    .every((s, idx) => isOptionalSlot(parentStruct.commandId, idx) && s.children.length === 0);

  if (cur.slotIndexInStruct === 0 || allEarlierAreOptionalEmpty) {
    if (otherSlotsEmpty) {
      pushHistory(state);
      const unwrapped = cur.slot.children;
      parentSlot.children.splice(cur.nodeIndexInParent, 1, ...unwrapped);
      state.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent };
      emitChange(state);
      return;
    }
    state.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent };
    emitChange(state);
    return;
  }

  let prevIdx = cur.slotIndexInStruct - 1;
  while (
    prevIdx > 0 &&
    parentStruct.slots[prevIdx].children.length === 0 &&
    isOptionalSlot(parentStruct.commandId, prevIdx)
  ) {
    prevIdx -= 1;
  }
  const prevSibling = parentStruct.slots[prevIdx];
  state.cursor = { slotId: prevSibling.id, offset: prevSibling.children.length };
  emitChange(state);
}

export function deleteForward(state: EngineState): void {
  state.lastTypingMeta = null;
  state.mode = { kind: 'edit' };
  if (state.gridSelection) {
    const { structId, r1, c1, r2, c2 } = state.gridSelection;
    const struct = findStructById(state.doc.root, structId);
    const meta = struct ? getGridMeta(struct) : null;
    if (struct && meta) {
      pushHistory(state);
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) {
          const s = struct.slots[r * meta.cols + c];
          if (s) s.children = [];
        }
      }
      const first = struct.slots[r1 * meta.cols + c1];
      if (first) state.cursor = { slotId: first.id, offset: 0 };
      state.gridSelection = null;
      emitChange(state);
      return;
    }
    state.gridSelection = null;
  }

  if (state.selection) {
    pushHistory(state);
    deleteSelectionInternal(state);
    emitChange(state);
    return;
  }
  const slot = currentSlot(state);
  if (state.cursor.offset >= slot.children.length) return;
  const next = slot.children[state.cursor.offset];
  if (next.type === 'struct' && !isStructEmpty(next)) {
    const firstVisibleIdx = next.slots.findIndex((_, idx) =>
      isSlotVisibleInteractive(next, idx, ''),
    );
    const targetSlot = next.slots[firstVisibleIdx >= 0 ? firstVisibleIdx : 0];
    state.cursor = { slotId: targetSlot.id, offset: 0 };
    emitChange(state);
    return;
  }
  pushHistory(state);
  slot.children.splice(state.cursor.offset, 1);
  emitChange(state);
}

import {
  createCharNode,
  createRawNode,
  createStructNode,
  findSlotPath,
  textToCharNodes,
} from '../ast';
import { COMMANDS_BY_ID } from '../catalog';
import {
  DELIMITER_STRUCT_IDS,
  INLINE_OPEN_SPEC_MAP,
  INLINE_STRUCT_MAP,
  NEXT_BRACE_SLOT_MAP,
  PREFIX_BIGOPS,
  isTightSlot,
} from '../commandSpecs';
import { MATH_FUNCTIONS, OPERATORNAME_FUNCTIONS } from '../emitIr';
import { importFormula } from '../parser';
import type { SlotNode } from '../types';
import { type EngineState, currentSlot, pushHistory } from './state';
import { insertCommand } from './structuralEdit';

export function isEscapedBeforeCursor(state: EngineState): boolean {
  const slot = currentSlot(state);
  if (state.cursor.offset <= 0) return false;
  const prev = slot.children[state.cursor.offset - 1];
  return prev.type === 'char' && prev.value === '\\';
}

export function trySkipClosingBracket(
  state: EngineState,
  commandId: 'paren' | 'bracket' | 'brace',
): boolean {
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return false;

  const atTrailingEdge = state.cursor.offset === path[path.length - 1].slot.children.length;
  if (!atTrailingEdge) return false;

  for (let i = path.length - 1; i >= 1; i -= 1) {
    const entry = path[i];
    const struct = entry.parentStruct;
    const parentSlot = entry.parentSlot;
    if (!struct || !parentSlot) break;

    if (struct.commandId === commandId) {
      state.cursor = { slotId: parentSlot.id, offset: entry.nodeIndexInParent + 1 };
      state.selection = null;
      return true;
    }

    if (DELIMITER_STRUCT_IDS.has(struct.commandId)) {
      break;
    }

    const isLastSlot = entry.slotIndexInStruct === struct.slots.length - 1;
    const isLastNodeInParent = entry.nodeIndexInParent === parentSlot.children.length - 1;
    if (!isLastSlot || !isLastNodeInParent) {
      break;
    }
  }
  return false;
}

export function matchTrailingLiteral(slot: SlotNode, endOffset: number, literal: string): boolean {
  const start = endOffset - literal.length;
  if (start < 0) return false;
  for (let i = 0; i < literal.length; i += 1) {
    const n = slot.children[start + i];
    if (n.type !== 'char' || n.value !== literal[i]) return false;
  }
  return true;
}

export function tryExpandLeftRightBrace(state: EngineState, isOpen: boolean): boolean {
  const slot = currentSlot(state);
  const prefix = isOpen ? '\\left\\' : '\\right\\';
  if (!matchTrailingLiteral(slot, state.cursor.offset, prefix)) return false;
  pushHistory(state);
  slot.children.splice(state.cursor.offset - prefix.length, prefix.length);
  state.cursor.offset -= prefix.length;
  if (isOpen) {
    const cmd = COMMANDS_BY_ID.get('brace');
    if (cmd) {
      const struct = createStructNode(cmd, [[]]);
      struct.autoSized = false;
      slot.children.splice(state.cursor.offset, 0, struct);
      state.cursor = { slotId: struct.slots[0].id, offset: 0 };
    }
    return true;
  }
  trySkipClosingBracket(state, 'brace');
  return true;
}

export function tryExitAnyDelimiter(state: EngineState, expectedCmdId?: string): boolean {
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return false;
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const entry = path[i];
    const struct = entry.parentStruct;
    const parentSlot = entry.parentSlot;
    if (!struct || !parentSlot) break;
    if (
      (expectedCmdId && struct.commandId === expectedCmdId) ||
      (!expectedCmdId && DELIMITER_STRUCT_IDS.has(struct.commandId))
    ) {
      state.cursor = { slotId: parentSlot.id, offset: entry.nodeIndexInParent + 1 };
      state.selection = null;
      return true;
    }
    if (DELIMITER_STRUCT_IDS.has(struct.commandId)) break;
  }
  return false;
}

export function tryExpandLeftRightNorm(state: EngineState): boolean {
  const slot = currentSlot(state);
  if (matchTrailingLiteral(slot, state.cursor.offset, '\\left\\')) {
    pushHistory(state);
    slot.children.splice(state.cursor.offset - 6, 6);
    state.cursor.offset -= 6;
    const cmd = COMMANDS_BY_ID.get('norm');
    if (cmd) {
      const struct = createStructNode(cmd, [[]]);
      slot.children.splice(state.cursor.offset, 0, struct);
      state.cursor = { slotId: struct.slots[0].id, offset: 0 };
    }
    return true;
  }
  if (matchTrailingLiteral(slot, state.cursor.offset, '\\right\\')) {
    pushHistory(state);
    slot.children.splice(state.cursor.offset - 7, 7);
    state.cursor.offset -= 7;
    tryExitAnyDelimiter(state, 'norm');
    return true;
  }
  return false;
}

export function tryExpandLeftRightDelimiter(
  state: EngineState,
  ch: '(' | '[' | '|' | ')' | ']' | '.',
): boolean {
  const slot = currentSlot(state);
  if (ch === '(' || ch === '[' || ch === '|') {
    if (matchTrailingLiteral(slot, state.cursor.offset, '\\left')) {
      const cmdId = ch === '(' ? 'paren' : ch === '[' ? 'bracket' : 'abs';
      const cmd = COMMANDS_BY_ID.get(cmdId);
      if (!cmd) return false;
      pushHistory(state);
      slot.children.splice(state.cursor.offset - 5, 5);
      state.cursor.offset -= 5;
      const struct = createStructNode(cmd, [[]]);
      struct.autoSized = false;
      slot.children.splice(state.cursor.offset, 0, struct);
      state.cursor = { slotId: struct.slots[0].id, offset: 0 };
      return true;
    }
  }
  if (ch === ')' || ch === ']' || ch === '|' || ch === '.') {
    if (matchTrailingLiteral(slot, state.cursor.offset, '\\right')) {
      pushHistory(state);
      slot.children.splice(state.cursor.offset - 6, 6);
      state.cursor.offset -= 6;
      const expected =
        ch === ')' ? 'paren' : ch === ']' ? 'bracket' : ch === '|' ? 'abs' : undefined;
      tryExitAnyDelimiter(state, expected);
      return true;
    }
  }
  return false;
}

export function tryEnterTightSlotLatexBrace(state: EngineState): boolean {
  if (state.selection !== null) return false;
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return false;
  const cur = path[path.length - 1];
  if (!cur.parentStruct) return false;
  if (cur.slot.children.length !== 0 || state.cursor.offset !== 0) return false;
  if (!isTightSlot(cur.parentStruct.commandId, cur.slotIndexInStruct)) return false;
  state.latexArgCloseBySlot.set(cur.slot.id, '}');
  return true;
}

export function tryConsumeBigOpUpperCaret(state: EngineState): boolean {
  if (state.selection !== null) return false;
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return false;
  const cur = path[path.length - 1];
  if (!cur.parentStruct) return false;
  return (
    PREFIX_BIGOPS.has(cur.parentStruct.commandId) &&
    cur.parentStruct.slots.length === 3 &&
    cur.slotIndexInStruct === 1 &&
    cur.slot.children.length === 0 &&
    state.cursor.offset === 0
  );
}

export function tryCloseLatexArg(state: EngineState, closeCh: '}' | ']'): boolean {
  if (state.selection !== null || state.latexArgCloseBySlot.size === 0) return false;
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return false;

  for (let i = path.length - 1; i >= 1; i -= 1) {
    const entry = path[i];
    const expected = state.latexArgCloseBySlot.get(entry.slot.id);
    if (expected !== closeCh) {
      if (
        entry.parentStruct &&
        ((closeCh === '}' && entry.parentStruct.commandId === 'brace') ||
          (closeCh === ']' && entry.parentStruct.commandId === 'bracket'))
      ) {
        return false;
      }
      continue;
    }

    const struct = entry.parentStruct;
    const parentSlot = entry.parentSlot;
    if (!struct || !parentSlot) return false;

    state.latexArgCloseBySlot.delete(entry.slot.id);
    state.selection = null;
    state.lastTypingMeta = null;

    const nextBraceIdx = NEXT_BRACE_SLOT_MAP[struct.commandId];
    if (
      entry.slotIndexInStruct === 0 &&
      nextBraceIdx !== undefined &&
      struct.slots.length > nextBraceIdx
    ) {
      const nextSlot = struct.slots[nextBraceIdx];
      state.cursor = { slotId: nextSlot.id, offset: nextSlot.children.length };
      state.expectLatexOpenBraceSlotId = nextSlot.id;
      return true;
    }

    if (PREFIX_BIGOPS.has(struct.commandId) && struct.slots.length === 3) {
      if (entry.slotIndexInStruct === 0) {
        state.cursor = { slotId: struct.slots[1].id, offset: struct.slots[1].children.length };
        return true;
      }
      if (entry.slotIndexInStruct === 1) {
        state.cursor = { slotId: struct.slots[2].id, offset: struct.slots[2].children.length };
        return true;
      }
    }

    state.cursor = { slotId: parentSlot.id, offset: entry.nodeIndexInParent + 1 };
    return true;
  }

  return false;
}

export function tryExpandInlineMacro(
  state: EngineState,
  trigger: 'space' | 'enter' | '_' | '^' | '{' | '[' | '(' | 'other' = 'space',
): boolean {
  const slot = currentSlot(state);
  let start = state.cursor.offset - 1;
  while (start >= 0) {
    const n = slot.children[start];
    if (n.type === 'char' && /[a-zA-Z]/.test(n.value)) {
      start -= 1;
    } else {
      break;
    }
  }
  if (start < 0) return false;
  const bs = slot.children[start];
  if (bs.type !== 'char' || bs.value !== '\\') return false;
  const name = slot.children
    .slice(start + 1, state.cursor.offset)
    .map((n) => (n.type === 'char' ? n.value : ''))
    .join('');
  if (!name) return false;

  // 1. Declarative LaTeX structural commands (`\int`, `\frac`, `\sqrt`, `\xrightarrow`, `\ket`, ...)
  const structCmdId = INLINE_STRUCT_MAP[name];
  if (structCmdId) {
    const isBigOp = PREFIX_BIGOPS.has(structCmdId) && structCmdId !== 'indef_integral';
    const openSpec = INLINE_OPEN_SPEC_MAP[structCmdId];
    if (trigger === 'other') return false;
    if ((trigger === '_' || trigger === '^') && !isBigOp) return false;
    if (trigger === '[' && openSpec?.bracketSlot === undefined) return false;
    if (trigger === '(' || (trigger === '{' && isBigOp)) return false;

    pushHistory(state);
    slot.children.splice(start, state.cursor.offset - start);
    state.cursor.offset = start;
    const undoBeforeInsert = state.undoStack.length;
    const ok = insertCommand(state, structCmdId);
    if (ok && state.undoStack.length > undoBeforeInsert) {
      state.undoStack.pop();
    }

    const inserted = slot.children[start];
    if (inserted && inserted.type === 'struct') {
      if (trigger === '_' && inserted.slots.length >= 1) {
        state.cursor = { slotId: inserted.slots[0].id, offset: 0 };
      } else if (trigger === '^' && inserted.slots.length >= 2) {
        if (inserted.slots.length === 3) inserted.fillOrder = [1, 0, 2];
        state.cursor = { slotId: inserted.slots[1].id, offset: 0 };
      } else if (
        trigger === '[' &&
        openSpec?.bracketSlot !== undefined &&
        inserted.slots[openSpec.bracketSlot]
      ) {
        if (openSpec.bracketFillOrder) inserted.fillOrder = [...openSpec.bracketFillOrder];
        const target = inserted.slots[openSpec.bracketSlot];
        state.cursor = { slotId: target.id, offset: 0 };
        state.latexArgCloseBySlot.set(target.id, ']');
      } else if (
        trigger === '{' &&
        openSpec?.firstBraceSlot !== undefined &&
        inserted.slots[openSpec.firstBraceSlot]
      ) {
        if (openSpec.braceFillOrder) inserted.fillOrder = [...openSpec.braceFillOrder];
        const target = inserted.slots[openSpec.firstBraceSlot];
        state.cursor = { slotId: target.id, offset: 0 };
        state.latexArgCloseBySlot.set(target.id, '}');
      } else if (trigger === '{' && inserted.slots.length >= 1) {
        if (inserted.slots.length === 2) inserted.fillOrder = [0, 1];
        state.cursor = { slotId: inserted.slots[0].id, offset: 0 };
        state.latexArgCloseBySlot.set(inserted.slots[0].id, '}');
      }
    }
    return ok;
  }

  // 2. Explicit spacing macros (`\quad`, `\qquad`)
  if (
    (name === 'quad' || name === 'qquad') &&
    (trigger === 'space' || trigger === 'enter' || trigger === 'other')
  ) {
    pushHistory(state);
    const raw = createRawNode(`\\${name}`);
    slot.children.splice(start, state.cursor.offset - start, raw);
    state.cursor.offset = start + 1;
    return trigger === 'space' || trigger === 'enter';
  }

  // 3. Standard math & operatorname functions (`\sin`, `\cos`, `\ln`, `\argmin`, `\Var`, ...)
  if (MATH_FUNCTIONS.has(name) || Boolean(OPERATORNAME_FUNCTIONS[name])) {
    if (trigger === '{' || trigger === '[') return false;
    pushHistory(state);
    const fnNodes = textToCharNodes(name, false);
    if (trigger === 'space') {
      const withSep = [...fnNodes, createCharNode(' ')];
      slot.children.splice(start, state.cursor.offset - start, ...withSep);
      state.cursor.offset = start + withSep.length;
      return true;
    }
    slot.children.splice(start, state.cursor.offset - start, ...fnNodes);
    state.cursor.offset = start + fnNodes.length;
    return trigger === 'enter';
  }

  // 4. Atomic LaTeX symbol macros (`\alpha`, `\pi`, `\vdots`, `\ddots`, `\infty`, `\le`, ...)
  if (trigger === '{' || trigger === '[') return false;
  const parsed = importFormula(`\\${name}`);
  const hasErr = parsed.diagnostics.some((d) => d.severity === 'error');
  const hasWarn = parsed.diagnostics.some((d) => d.severity === 'warning');
  if (hasErr || hasWarn || parsed.doc.root.children.length === 0) return false;

  pushHistory(state);
  slot.children.splice(start, state.cursor.offset - start, ...parsed.doc.root.children);
  state.cursor.offset = start + parsed.doc.root.children.length;
  return trigger === 'space' || trigger === 'enter';
}

import {
  createStructNode,
  findSlotPath,
} from '../ast';
import { COMMANDS_BY_ID } from '../catalog';
import {
  BINARY_RELATION_SYMBOLS,
  PREFIX_BIGOPS,
} from '../commandSpecs';
import { MATH_FUNCTIONS, OPERATORNAME_FUNCTIONS } from '../emitIr';
import { BARE_WORD_ATOMS } from '../shorthands';
import { getSlotOrder } from '../slotOrder';
import type { MathNode } from '../types';
import {
  type EngineState,
  currentSlot,
  deleteSelectionInternal,
  emitChange,
  pushHistory,
} from './state';

export function insertAutoBracket(
  state: EngineState,
  commandId: 'paren' | 'bracket' | 'brace',
): void {
  const cmd = COMMANDS_BY_ID.get(commandId);
  if (!cmd) return;
  pushHistory(state);
  const slot = currentSlot(state);
  let innerNodes: MathNode[] = [];
  const hadSelection = state.selection !== null && state.selection.slotId === slot.id;
  if (hadSelection) {
    innerNodes = deleteSelectionInternal(state);
  }
  const struct = createStructNode(cmd, [innerNodes]);
  struct.autoSized = true;
  slot.children.splice(state.cursor.offset, 0, struct);
  if (hadSelection) {
    state.cursor = { slotId: slot.id, offset: state.cursor.offset + 1 };
  } else {
    state.cursor = { slotId: struct.slots[0].id, offset: 0 };
  }
  emitChange(state);
}

export function trySpaceExitScript(state: EngineState): boolean {
  if (state.selection !== null) return false;
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return false;
  const cur = path[path.length - 1];
  const parentStruct = cur.parentStruct;
  const parentSlot = cur.parentSlot;
  if (!parentStruct || !parentSlot) return false;
  if (state.latexArgCloseBySlot.has(cur.slot.id)) return false;
  if (cur.slot.children.length === 0 || state.cursor.offset !== cur.slot.children.length) {
    return false;
  }

  const cmdId = parentStruct.commandId;
  const sIdx = cur.slotIndexInStruct;
  const isScriptEnd =
    ((cmdId === 'sup' || cmdId === 'sub') && sIdx === 1) ||
    (cmdId === 'subsup' && (sIdx === 1 || sIdx === 2));

  if (!isScriptEnd) return false;

  state.selection = null;
  if (cmdId === 'subsup' && sIdx === 1 && parentStruct.slots[2].children.length === 0) {
    state.cursor = { slotId: parentStruct.slots[2].id, offset: 0 };
    return true;
  }
  state.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent + 1 };
  return true;
}

export function insertNaturalScript(state: EngineState, kind: 'sup' | 'sub'): void {
  const cmd = COMMANDS_BY_ID.get(kind);
  if (!cmd) return;

  if (!state.selection) {
    const path = findSlotPath(state.doc.root, state.cursor.slotId);
    if (path && path.length > 1) {
      const cur = path[path.length - 1];
      const parentStruct = cur.parentStruct;
      const parentSlot = cur.parentSlot;
      if (parentStruct && parentSlot) {
        const atSlotEnd = state.cursor.offset === cur.slot.children.length;
        const hasContent = cur.slot.children.length > 0;
        if (atSlotEnd && hasContent) {
          if (PREFIX_BIGOPS.has(parentStruct.commandId) && parentStruct.slots.length === 3) {
            if (
              kind === 'sup' &&
              cur.slotIndexInStruct === 0 &&
              parentStruct.slots[1].children.length === 0
            ) {
              state.cursor = { slotId: parentStruct.slots[1].id, offset: 0 };
              emitChange(state);
              return;
            }
            if (
              kind === 'sub' &&
              cur.slotIndexInStruct === 1 &&
              parentStruct.slots[0].children.length === 0
            ) {
              state.cursor = { slotId: parentStruct.slots[0].id, offset: 0 };
              emitChange(state);
              return;
            }
          }
          if (parentStruct.commandId === 'subsup' && parentStruct.slots.length === 3) {
            if (
              kind === 'sup' &&
              cur.slotIndexInStruct === 1 &&
              parentStruct.slots[2].children.length === 0
            ) {
              state.cursor = { slotId: parentStruct.slots[2].id, offset: 0 };
              emitChange(state);
              return;
            }
            if (
              kind === 'sub' &&
              cur.slotIndexInStruct === 2 &&
              parentStruct.slots[1].children.length === 0
            ) {
              state.cursor = { slotId: parentStruct.slots[1].id, offset: 0 };
              emitChange(state);
              return;
            }
          }
          if (kind === 'sup' && parentStruct.commandId === 'sub' && cur.slotIndexInStruct === 1) {
            pushHistory(state);
            const subsup = COMMANDS_BY_ID.get('subsup')!;
            const upgraded = createStructNode(subsup, [
              parentStruct.slots[0].children,
              parentStruct.slots[1].children,
              [],
            ]);
            parentSlot.children.splice(cur.nodeIndexInParent, 1, upgraded);
            state.cursor = { slotId: upgraded.slots[2].id, offset: 0 };
            emitChange(state);
            return;
          }
          if (kind === 'sub' && parentStruct.commandId === 'sup' && cur.slotIndexInStruct === 1) {
            pushHistory(state);
            const subsup = COMMANDS_BY_ID.get('subsup')!;
            const upgraded = createStructNode(subsup, [
              parentStruct.slots[0].children,
              [],
              parentStruct.slots[1].children,
            ]);
            parentSlot.children.splice(cur.nodeIndexInParent, 1, upgraded);
            state.cursor = { slotId: upgraded.slots[1].id, offset: 0 };
            emitChange(state);
            return;
          }
        }
      }
    }
  }

  pushHistory(state);
  const slot = currentSlot(state);
  let baseNodes: MathNode[] = [];

  if (state.selection && state.selection.slotId === slot.id) {
    baseNodes = deleteSelectionInternal(state);
  } else if (state.cursor.offset > 0) {
    const prev = slot.children[state.cursor.offset - 1];
    if (kind === 'sup' && prev.type === 'struct' && prev.commandId === 'sub') {
      const subsup = COMMANDS_BY_ID.get('subsup')!;
      const upgraded = createStructNode(subsup, [
        prev.slots[0].children,
        prev.slots[1].children,
        [],
      ]);
      slot.children.splice(state.cursor.offset - 1, 1, upgraded);
      state.cursor = { slotId: upgraded.slots[2].id, offset: 0 };
      emitChange(state);
      return;
    }
    if (kind === 'sub' && prev.type === 'struct' && prev.commandId === 'sup') {
      const subsup = COMMANDS_BY_ID.get('subsup')!;
      const upgraded = createStructNode(subsup, [
        prev.slots[0].children,
        [],
        prev.slots[1].children,
      ]);
      slot.children.splice(state.cursor.offset - 1, 1, upgraded);
      state.cursor = { slotId: upgraded.slots[1].id, offset: 0 };
      emitChange(state);
      return;
    }

    if (prev.type !== 'char' || !/^[\s+=,;:\-<>()[\]]$/.test(prev.value)) {
      if (prev.type === 'char' && /[0-9]/.test(prev.value)) {
        let start = state.cursor.offset - 1;
        while (start > 0) {
          const c = slot.children[start - 1];
          if (c.type === 'char' && /[0-9]/.test(c.value)) start -= 1;
          else break;
        }
        baseNodes = slot.children.splice(start, state.cursor.offset - start);
        state.cursor.offset = start;
      } else if (prev.type === 'char' && !prev.verbatim && /[A-Za-z]/.test(prev.value)) {
        let wordStart = state.cursor.offset - 1;
        while (wordStart > 0) {
          const c = slot.children[wordStart - 1];
          if (c.type === 'char' && !c.verbatim && /[A-Za-z]/.test(c.value)) wordStart -= 1;
          else break;
        }
        const word = slot.children
          .slice(wordStart, state.cursor.offset)
          .map((n) => (n.type === 'char' ? n.value : ''))
          .join('');
        if (
          word.length > 1 &&
          (MATH_FUNCTIONS.has(word) ||
            Boolean(OPERATORNAME_FUNCTIONS[word]) ||
            (state.settings.autoShorthands && Boolean(BARE_WORD_ATOMS[word])))
        ) {
          baseNodes = slot.children.splice(wordStart, state.cursor.offset - wordStart);
          state.cursor.offset = wordStart;
        } else {
          baseNodes = slot.children.splice(state.cursor.offset - 1, 1);
          state.cursor.offset -= 1;
        }
      } else {
        baseNodes = slot.children.splice(state.cursor.offset - 1, 1);
        state.cursor.offset -= 1;
      }
    }
  }

  const struct = createStructNode(cmd, [baseNodes, []]);
  slot.children.splice(state.cursor.offset, 0, struct);
  state.cursor = {
    slotId: baseNodes.length > 0 ? struct.slots[1].id : struct.slots[0].id,
    offset: 0,
  };
  emitChange(state);
}

export function insertNaturalFraction(state: EngineState): void {
  const cmd = COMMANDS_BY_ID.get('frac');
  if (!cmd) return;
  pushHistory(state);

  const slot = currentSlot(state);
  let numNodes: MathNode[] = [];

  if (state.selection && state.selection.slotId === slot.id) {
    numNodes = deleteSelectionInternal(state);
  } else if (state.cursor.offset > 0) {
    let end = state.cursor.offset;
    while (end > 0) {
      const c = slot.children[end - 1];
      if (c.type === 'char' && c.value === ' ') end -= 1;
      else break;
    }
    let start = end;
    while (start > 0) {
      const c = slot.children[start - 1];
      if (c.type === 'char' && /^[+=,;:\-<>()[\]~]$/.test(c.value)) {
        break;
      }
      if (c.type === 'char' && c.value === ' ') {
        let wEnd = start - 1;
        while (wEnd > 0) {
          const sp = slot.children[wEnd - 1];
          if (sp.type === 'char' && sp.value === ' ') wEnd -= 1;
          else break;
        }
        let wStart = wEnd;
        while (wStart > 0) {
          const lc = slot.children[wStart - 1];
          if (lc.type === 'char' && /^[A-Za-z]$/.test(lc.value)) wStart -= 1;
          else break;
        }
        if (wStart < wEnd) {
          const word = slot.children
            .slice(wStart, wEnd)
            .map((n) => (n.type === 'char' ? n.value : ''))
            .join('');
          if (MATH_FUNCTIONS.has(word)) {
            let beforeFunc = wStart - 1;
            while (
              beforeFunc >= 0 &&
              slot.children[beforeFunc].type === 'char' &&
              (slot.children[beforeFunc] as { value: string }).value === ' '
            ) {
              beforeFunc -= 1;
            }
            if (beforeFunc >= 0) {
              const bf = slot.children[beforeFunc];
              const isFactorBeforeFunc =
                (bf.type === 'struct' && !PREFIX_BIGOPS.has(bf.commandId)) ||
                (bf.type === 'symbol' &&
                  !BINARY_RELATION_SYMBOLS.has(bf.commandId) &&
                  bf.commandId !== 'indef_integral') ||
                (bf.type === 'char' && !/^[+=,;:\-<>([\~]$/.test(bf.value));
              if (isFactorBeforeFunc) {
                break;
              }
            }
          }
        }
      }
      if (
        c.type === 'symbol' &&
        (BINARY_RELATION_SYMBOLS.has(c.commandId) || c.commandId === 'indef_integral')
      ) {
        break;
      }
      if (c.type === 'struct' && PREFIX_BIGOPS.has(c.commandId)) {
        break;
      }
      if (c.type === 'raw' && c.latex.trim() === '\\\\') {
        break;
      }
      start -= 1;
    }
    while (start < end) {
      const c = slot.children[start];
      if (c.type === 'char' && c.value === ' ') start += 1;
      else break;
    }
    if (end > start) {
      numNodes = slot.children.splice(start, state.cursor.offset - start);
      while (numNodes.length > 0) {
        const last = numNodes[numNodes.length - 1];
        if (last.type === 'char' && last.value === ' ') numNodes.pop();
        else break;
      }
      state.cursor.offset = start;
    }
  }

  const struct = createStructNode(cmd, [numNodes, []]);
  if (numNodes.length > 0) {
    struct.fillOrder = [0, 1];
  }
  slot.children.splice(state.cursor.offset, 0, struct);
  if (numNodes.length > 0) {
    state.cursor = { slotId: struct.slots[1].id, offset: 0 };
  } else {
    const order = getSlotOrder(cmd.id, state.settings, struct.slots.length);
    state.cursor = { slotId: struct.slots[order[0]].id, offset: 0 };
  }
  emitChange(state);
}

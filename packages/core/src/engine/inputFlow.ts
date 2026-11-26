import {
  createCharNode,
  createRawNode,
  createStructNode,
  createSymbolNode,
  findSlotPath,
  textToCharNodes,
} from '../ast';
import { COMMANDS_BY_ID } from '../catalog';
import { sanitizeLatexTemplate } from '../commandSpecs';
import {
  matchShorthandUpgrade,
  matchTrailingShorthand,
} from '../shorthands';
import type { CustomCommandDef, MathNode } from '../types';
import { handleJumpKey } from './jumpMode';
import {
  isEscapedBeforeCursor,
  tryCloseLatexArg,
  tryConsumeBigOpUpperCaret,
  tryEnterTightSlotLatexBrace,
  tryExpandInlineMacro,
  tryExpandLeftRightBrace,
  tryExpandLeftRightDelimiter,
  tryExpandLeftRightNorm,
  trySkipClosingBracket,
} from './latexInline';
import { handleLeaderKey } from './leaderMode';
import {
  insertAutoBracket,
  insertNaturalFraction,
  insertNaturalScript,
  trySpaceExitScript,
} from './naturalSyntax';
import { nextSlot } from './navigation';
import {
  type EngineState,
  currentSlot,
  deleteSelectionInternal,
  emitChange,
  getInputContext,
  isInsideOperatorName,
  pushHistory,
  pushTypingHistory,
} from './state';

export function matchCustomShorthand(
  state: EngineState,
  children: readonly MathNode[],
  offset: number,
  filterKind: 'word' | 'punct',
): { start: number; command: CustomCommandDef } | null {
  if (offset <= 0) return null;
  const candidates: CustomCommandDef[] = [...state.customCommands];
  for (const cmd of state.effectiveCommands) {
    if (cmd.shorthand?.trim()) {
      candidates.push({
        id: cmd.id,
        label: cmd.label,
        latex: cmd.latex,
        slots: [...cmd.slots],
        shorthand: cmd.shorthand,
        immediateShorthand: cmd.immediateShorthand,
      });
    }
  }
  if (candidates.length === 0) return null;
  for (const cmd of candidates) {
    const trigger = cmd.shorthand?.trim();
    if (!trigger || trigger.length > offset) continue;
    const isAlpha = /^[a-zA-Z]+$/.test(trigger);
    const requiresBoundary =
      cmd.immediateShorthand !== undefined
        ? !cmd.immediateShorthand
        : isAlpha && cmd.slots.length === 0;
    if (filterKind === 'word' && !requiresBoundary) continue;
    if (filterKind === 'punct' && requiresBoundary) continue;
    let ok = true;
    const start = offset - trigger.length;
    for (let i = 0; i < trigger.length; i += 1) {
      const n = children[start + i];
      if (n.type !== 'char' || n.value !== trigger[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (isAlpha && start > 0) {
      const prev = children[start - 1];
      if (prev.type === 'char' && /^[a-zA-Z]$/.test(prev.value)) continue;
    }
    return { start, command: cmd };
  }
  return null;
}

export function insertCustomCommandInternal(state: EngineState, custom: CustomCommandDef): void {
  const safeLatex = sanitizeLatexTemplate(custom.latex);
  const slot = currentSlot(state);
  if (custom.slots.length === 0) {
    deleteSelectionInternal(state);
    slot.children.splice(state.cursor.offset, 0, createRawNode(safeLatex));
    state.cursor.offset += 1;
    return;
  }
  const slotContents: MathNode[][] = custom.slots.map(() => []);
  if (state.selection && state.selection.slotId === slot.id) {
    slotContents[0] = deleteSelectionInternal(state);
  }
  const struct = createStructNode(
    { id: custom.id, slots: custom.slots, latex: safeLatex },
    slotContents,
    safeLatex,
  );
  slot.children.splice(state.cursor.offset, 0, struct);
  const firstEmpty = struct.slots.find((s) => s.children.length === 0) ?? struct.slots[0];
  state.cursor = { slotId: firstEmpty.id, offset: 0 };
}

export function insertText(state: EngineState, text: string): void {
  if (!text) return;
  if (state.mode.kind === 'jump') {
    if (text.length === 1) {
      handleJumpKey(state, text);
    } else {
      state.mode = { kind: 'edit' };
      emitChange(state);
    }
    return;
  }
  if (state.mode.kind === 'leader') {
    if (text.length === 1) {
      handleLeaderKey(state, text);
    } else {
      state.mode = { kind: 'edit' };
      emitChange(state);
    }
    return;
  }

  if (getInputContext(state) === 'raw') {
    const normalized = text.replace(/\r?\n/g, ' ');
    if (!normalized) return;
    const slot = currentSlot(state);
    if (normalized.length === 1 && !state.selection) {
      pushTypingHistory(state, slot.id, state.cursor.offset);
    } else {
      pushHistory(state);
    }
    deleteSelectionInternal(state);
    const nodes = textToCharNodes(normalized, true);
    slot.children.splice(state.cursor.offset, 0, ...nodes);
    state.cursor.offset += nodes.length;
    emitChange(state);
    return;
  }

  if (getInputContext(state) === 'text') {
    if (text === '}' && !isEscapedBeforeCursor(state) && tryCloseLatexArg(state, '}')) {
      emitChange(state);
      return;
    }
    if (text === '$') {
      if (isEscapedBeforeCursor(state)) {
        pushHistory(state);
        const slot = currentSlot(state);
        slot.children.splice(state.cursor.offset - 1, 1, createCharNode('$', true));
        emitChange(state);
        return;
      }
      const inlineCmd = COMMANDS_BY_ID.get('inline_math');
      if (inlineCmd) {
        pushHistory(state);
        const slot = currentSlot(state);
        const selected =
          state.selection && state.selection.slotId === slot.id
            ? deleteSelectionInternal(state)
            : [];
        const struct = createStructNode(inlineCmd, [selected]);
        slot.children.splice(state.cursor.offset, 0, struct);
        state.cursor = { slotId: struct.slots[0].id, offset: selected.length };
        emitChange(state);
        return;
      }
    }
    const normalized = text.replace(/\r?\n/g, ' ');
    if (!normalized) return;
    const slot = currentSlot(state);
    if (normalized.length === 1 && /^[A-Za-z0-9]$/.test(normalized)) {
      pushTypingHistory(state, slot.id, state.cursor.offset);
    } else {
      pushHistory(state);
    }
    deleteSelectionInternal(state);
    const nodes = textToCharNodes(normalized, true);
    slot.children.splice(state.cursor.offset, 0, ...nodes);
    state.cursor.offset += nodes.length;
    emitChange(state);
    return;
  }

  if (isInsideOperatorName(state)) {
    if (text === '}' && !isEscapedBeforeCursor(state) && tryCloseLatexArg(state, '}')) {
      emitChange(state);
      return;
    }
    if (text === ';' && state.settings.semicolonNextSlot && !isEscapedBeforeCursor(state)) {
      state.selection = null;
      nextSlot(state);
      return;
    }
    const normalized = text.replace(/\r?\n/g, '');
    if (!normalized) return;
    const slot = currentSlot(state);
    if (normalized.length === 1 && /^[A-Za-z0-9]$/.test(normalized)) {
      pushTypingHistory(state, slot.id, state.cursor.offset);
    } else {
      pushHistory(state);
    }
    deleteSelectionInternal(state);
    const nodes = textToCharNodes(normalized, true);
    slot.children.splice(state.cursor.offset, 0, ...nodes);
    state.cursor.offset += nodes.length;
    emitChange(state);
    return;
  }

  if (text.length === 1) {
    const ch = text;
    const awaitedOpenBrace = state.expectLatexOpenBraceSlotId;
    state.expectLatexOpenBraceSlotId = null;

    if (ch === '{' && awaitedOpenBrace === state.cursor.slotId && !isEscapedBeforeCursor(state)) {
      state.latexArgCloseBySlot.set(state.cursor.slotId, '}');
      emitChange(state);
      return;
    }

    if (ch === '$' && !isEscapedBeforeCursor(state)) {
      const path = findSlotPath(state.doc.root, state.cursor.slotId);
      if (path && path.length > 1) {
        for (let i = path.length - 1; i >= 1; i -= 1) {
          const entry = path[i];
          if (entry.parentStruct?.commandId === 'inline_math' && entry.parentSlot) {
            state.lastTypingMeta = null;
            state.selection = null;
            state.cursor = { slotId: entry.parentSlot.id, offset: entry.nodeIndexInParent + 1 };
            emitChange(state);
            return;
          }
          if (entry.parentStruct?.commandId === 'text_box') {
            break;
          }
        }
      }
    }

    if (isEscapedBeforeCursor(state)) {
      if (ch === ',' || ch === ':' || ch === ';' || ch === '!' || ch === ' ') {
        pushHistory(state);
        const slot = currentSlot(state);
        slot.children.splice(state.cursor.offset - 1, 1, createRawNode(`\\${ch}`));
        emitChange(state);
        return;
      }
      if (ch === '\\') {
        pushHistory(state);
        const slot = currentSlot(state);
        slot.children.splice(state.cursor.offset - 1, 1);
        state.cursor.offset -= 1;
        const rawCmd = COMMANDS_BY_ID.get('raw_latex');
        if (rawCmd) {
          const struct = createStructNode(rawCmd, [[]]);
          slot.children.splice(state.cursor.offset, 0, struct);
          state.cursor = { slotId: struct.slots[0].id, offset: 0 };
        }
        emitChange(state);
        return;
      }
      if (ch === '{') {
        if (tryExpandLeftRightBrace(state, true)) {
          emitChange(state);
          return;
        }
        pushHistory(state);
        const slot = currentSlot(state);
        slot.children.splice(state.cursor.offset - 1, 1);
        state.cursor.offset -= 1;
        const cmd = COMMANDS_BY_ID.get('brace');
        if (cmd) {
          const struct = createStructNode(cmd, [[]]);
          struct.autoSized = true;
          slot.children.splice(state.cursor.offset, 0, struct);
          state.cursor = { slotId: struct.slots[0].id, offset: 0 };
        }
        emitChange(state);
        return;
      }
      if (ch === '}') {
        if (tryExpandLeftRightBrace(state, false)) {
          emitChange(state);
          return;
        }
        pushHistory(state);
        const slot = currentSlot(state);
        slot.children.splice(state.cursor.offset - 1, 1);
        state.cursor.offset -= 1;
        if (!trySkipClosingBracket(state, 'brace')) {
          slot.children.splice(state.cursor.offset, 0, createCharNode('}', true));
          state.cursor.offset += 1;
        }
        emitChange(state);
        return;
      }
      if (ch === '|') {
        if (tryExpandLeftRightNorm(state)) {
          emitChange(state);
          return;
        }
        pushHistory(state);
        const slot = currentSlot(state);
        slot.children.splice(state.cursor.offset - 1, 1, createRawNode('\\|'));
        emitChange(state);
        return;
      }
      if (ch === '%' || ch === '#' || ch === '&' || ch === '$' || ch === '_') {
        pushHistory(state);
        const slot = currentSlot(state);
        slot.children.splice(state.cursor.offset - 1, 1, createCharNode(ch, true));
        emitChange(state);
        return;
      }
    }

    if (
      (ch === '(' || ch === '[' || ch === '|' || ch === ')' || ch === ']' || ch === '.') &&
      tryExpandLeftRightDelimiter(state, ch)
    ) {
      emitChange(state);
      return;
    }

    if (
      state.settings.autoShorthands &&
      !state.selection &&
      !/^[a-zA-Z]$/.test(ch) &&
      ch !== '\\'
    ) {
      const curSlot = currentSlot(state);
      const alphaCustom = matchCustomShorthand(state, curSlot.children, state.cursor.offset, 'word');
      if (alphaCustom) {
        pushHistory(state);
        curSlot.children.splice(alphaCustom.start, state.cursor.offset - alphaCustom.start);
        state.cursor.offset = alphaCustom.start;
        insertCustomCommandInternal(state, alphaCustom.command);
        if (ch === ' ') {
          emitChange(state);
          return;
        }
      }
    }

    if (ch === ';' && state.settings.semicolonNextSlot && !isEscapedBeforeCursor(state)) {
      const path = findSlotPath(state.doc.root, state.cursor.slotId);
      if (path && path.length > 1) {
        state.selection = null;
        nextSlot(state);
        return;
      }
    }

    if ((ch === '{' || ch === '[' || ch === '(') && tryExpandInlineMacro(state, ch)) {
      emitChange(state);
      return;
    }
    if (
      !/^[a-zA-Z]$/.test(ch) &&
      ch !== '{' &&
      ch !== '[' &&
      ch !== '(' &&
      ch !== '^' &&
      ch !== '_' &&
      ch !== ' '
    ) {
      if (tryExpandInlineMacro(state, 'other')) {
        emitChange(state);
        return;
      }
    }

    if ((ch === '}' || ch === ']') && !isEscapedBeforeCursor(state) && tryCloseLatexArg(state, ch)) {
      emitChange(state);
      return;
    }

    if (ch === '{' && !isEscapedBeforeCursor(state) && tryEnterTightSlotLatexBrace(state)) {
      emitChange(state);
      return;
    }

    if (state.settings.autoBrackets) {
      const openBracketCmd =
        ch === '(' ? 'paren' : ch === '[' ? 'bracket' : ch === '{' ? 'brace' : null;
      if (openBracketCmd && !isEscapedBeforeCursor(state)) {
        insertAutoBracket(state, openBracketCmd);
        return;
      }
      const closeBracketCmd =
        ch === ')' ? 'paren' : ch === ']' ? 'bracket' : ch === '}' ? 'brace' : null;
      if (closeBracketCmd && trySkipClosingBracket(state, closeBracketCmd)) {
        emitChange(state);
        return;
      }
    }
    if (state.settings.naturalScripts && (ch === '^' || ch === '_')) {
      if (tryExpandInlineMacro(state, ch)) {
        emitChange(state);
        return;
      }
      if (ch === '^' && tryConsumeBigOpUpperCaret(state)) {
        emitChange(state);
        return;
      }
      insertNaturalScript(state, ch === '^' ? 'sup' : 'sub');
      return;
    }
    if (state.settings.naturalFraction && state.settings.leaderKey !== '/' && ch === '/') {
      insertNaturalFraction(state);
      return;
    }
    if (ch === ' ') {
      if (tryExpandInlineMacro(state, 'space')) {
        emitChange(state);
        return;
      }
      if (state.settings.spaceExitsScript && trySpaceExitScript(state)) {
        emitChange(state);
        return;
      }
      if (!state.selection) {
        const path = findSlotPath(state.doc.root, state.cursor.slotId);
        const inTextBox = path?.some((e) => e.parentStruct?.commandId === 'text_box') ?? false;
        if (!inTextBox) {
          const curSlot = currentSlot(state);
          if (curSlot.children.length === 0 || state.cursor.offset === 0) {
            return;
          }
          const prevNode =
            state.cursor.offset > 0 ? curSlot.children[state.cursor.offset - 1] : undefined;
          if (prevNode && prevNode.type === 'char' && prevNode.value === ' ') {
            return;
          }
        }
      }
    }
    if (
      state.settings.operatorExitsScript &&
      !state.selection &&
      !state.latexArgCloseBySlot.has(state.cursor.slotId) &&
      (/^[+=<>,]$/.test(ch) || (ch === '-' && state.cursor.offset > 0))
    ) {
      trySpaceExitScript(state);
    }
  }

  const slot = currentSlot(state);
  if (text.length === 1 && /^[A-Za-z0-9]$/.test(text) && !state.selection) {
    pushTypingHistory(state, slot.id, state.cursor.offset);
  } else {
    pushHistory(state);
  }
  deleteSelectionInternal(state);
  const nodes = textToCharNodes(text);
  slot.children.splice(state.cursor.offset, 0, ...nodes);
  state.cursor.offset += nodes.length;

  if (state.settings.autoShorthands && text.length === 1) {
    const customMatched = matchCustomShorthand(state, slot.children, state.cursor.offset, 'punct');
    if (customMatched) {
      pushHistory(state);
      slot.children.splice(customMatched.start, state.cursor.offset - customMatched.start);
      state.cursor.offset = customMatched.start;
      insertCustomCommandInternal(state, customMatched.command);
      emitChange(state);
      return;
    }

    const upgraded = matchShorthandUpgrade(slot.children, state.cursor.offset);
    if (upgraded) {
      pushHistory(state);
      const sym = createSymbolNode(upgraded.command);
      slot.children.splice(upgraded.start, state.cursor.offset - upgraded.start, sym);
      state.cursor.offset = upgraded.start + 1;
      emitChange(state);
      return;
    }

    const matched = matchTrailingShorthand(slot.children, state.cursor.offset);
    if (matched) {
      pushHistory(state);
      const sym = createSymbolNode(matched.command);
      slot.children.splice(matched.start, state.cursor.offset - matched.start, sym);
      state.cursor.offset = matched.start + 1;
    }
  }
  emitChange(state);
}

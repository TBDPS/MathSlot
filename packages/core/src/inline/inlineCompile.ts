import { isOptionalSlot } from '../ast';
import {
  COMMANDS,
  COMMANDS_BY_ID,
  SUBMENUS,
  getSubmenuDefaultCommandId,
} from '../catalog';
import { sanitizeLatexTemplate } from '../commandSpecs';
import { getSlotOrder } from '../slotOrder';
import type {
  CommandDef,
  CustomCommandDef,
  SlotOrderOverrides,
  SlotOrderPreset,
  Snippet,
} from '../types';

export interface InlineMathSpan {
  /** Start offset in document including opening `$` or `$$` */
  rawFrom: number;
  /** End offset in document including closing `$` or `$$` */
  rawTo: number;
  /** Interior start offset right after opening `$` or `$$` */
  contentFrom: number;
  /** Interior end offset right before closing `$` or `$$` */
  contentTo: number;
  isBlock: boolean;
}

export interface InlineTabstop {
  from: number;
  to: number;
  label: string;
  isExit?: boolean;
  optionalWrapperFrom?: number;
  optionalWrapperTo?: number;
}

export interface InlineMorphBackup {
  replaceFrom: number;
  replaceTo: number;
  prevCurrentSlot: InlineTabstop | null;
  prevQueue: InlineTabstop[];
  prevVisited: InlineTabstop[];
}

export interface InlineLeaderState {
  prefix: string;
  pendingDefaultId?: string;
  morphBackup?: InlineMorphBackup;
}

export interface InlineRawSpan {
  from: number;
  to: number;
}

export interface InlineSessionState {
  /** True when the user is in an active focused inline math editing session */
  active: boolean;
  currentSlot: InlineTabstop | null;
  queue: InlineTabstop[];
  visited: InlineTabstop[];
  leader: InlineLeaderState | null;
  rawSpan: InlineRawSpan | null;
  /** End offset of the most recently exited `rawSpan` so trailing raw chars aren't retroactively rewritten */
  rawProtectedUpTo?: number;
}

export interface InlineExpanderSettings {
  enabled: boolean;
  leaderKey: 'Tab' | '`';
  naturalFraction: boolean;
  naturalScripts: boolean;
  punctShorthands: boolean;
  wordShorthands: boolean;
  slotOrderPreset: SlotOrderPreset;
  slotOrderOverrides: SlotOrderOverrides;
  effectiveCommands?: readonly CommandDef[];
  customCommands?: readonly CustomCommandDef[];
  snippets?: readonly Snippet[];
}

export const DEFAULT_INLINE_SETTINGS: InlineExpanderSettings = {
  enabled: true,
  leaderKey: 'Tab',
  naturalFraction: true,
  naturalScripts: true,
  punctShorthands: true,
  wordShorthands: true,
  slotOrderPreset: 'standard',
  slotOrderOverrides: {},
};

export interface CapsuleItem {
  key: string;
  label: string;
  glyph: string;
  isSubmenu?: boolean;
  isDefault?: boolean;
  isWorkbench?: boolean;
}

export type InlineActionResult =
  | { kind: 'noop' }
  | {
      kind: 'handled';
      state: InlineSessionState;
      changes?: { from: number; to: number; insert: string };
      selection?: number;
      exitSession?: boolean;
    }
  | {
      kind: 'commit_and_fallthrough';
      state: InlineSessionState;
    }
  | {
      kind: 'open_workbench';
      state: InlineSessionState;
    };

export function createEmptyInlineSession(): InlineSessionState {
  return {
    active: false,
    currentSlot: null,
    queue: [],
    visited: [],
    leader: null,
    rawSpan: null,
  };
}

export function createActiveInlineSession(): InlineSessionState {
  return {
    ...createEmptyInlineSession(),
    active: true,
  };
}

export function shiftTabstop(
  t: InlineTabstop,
  changeFrom: number,
  changeTo: number,
  delta: number,
): InlineTabstop {
  const mapPos = (p: number, assocRight: boolean): number => {
    if (p < changeFrom) return p;
    if (p > changeTo) return p + delta;
    return assocRight ? changeTo + delta : changeFrom;
  };
  return {
    ...t,
    from: mapPos(t.from, false),
    to: Math.max(mapPos(t.from, false), mapPos(t.to, true)),
    ...(t.optionalWrapperFrom !== undefined && t.optionalWrapperTo !== undefined
      ? {
          optionalWrapperFrom: mapPos(t.optionalWrapperFrom, false),
          optionalWrapperTo: Math.max(
            mapPos(t.optionalWrapperFrom, false),
            mapPos(t.optionalWrapperTo, true),
          ),
        }
      : {}),
  };
}

export function mapInlineSessionThroughChange(
  state: InlineSessionState,
  changeFrom: number,
  changeTo: number,
  insertedLen: number,
  newCursor: number,
  mathSpan: InlineMathSpan | null,
): InlineSessionState {
  if (!mathSpan) {
    return createEmptyInlineSession();
  }
  const delta = insertedLen - (changeTo - changeFrom);
  let rawSpan = state.rawSpan;
  if (rawSpan) {
    if (changeFrom >= rawSpan.from && changeTo <= rawSpan.to) {
      rawSpan = { from: rawSpan.from, to: Math.max(rawSpan.from, rawSpan.to + delta) };
    } else if (changeTo <= rawSpan.from) {
      rawSpan = { from: rawSpan.from + delta, to: rawSpan.to + delta };
    }
    if (newCursor < rawSpan.from || newCursor > rawSpan.to) {
      rawSpan = null;
    }
  }

  let currentSlot = state.currentSlot
    ? shiftTabstop(state.currentSlot, changeFrom, changeTo, delta)
    : null;
  if (currentSlot && (newCursor < currentSlot.from || newCursor > currentSlot.to)) {
    currentSlot = null;
  }

  const queue = state.queue
    .map((t) => shiftTabstop(t, changeFrom, changeTo, delta))
    .filter((t) => t.from >= mathSpan.contentFrom && t.to <= mathSpan.contentTo);

  const visited = state.visited
    .map((t) => shiftTabstop(t, changeFrom, changeTo, delta))
    .filter((t) => t.from >= mathSpan.contentFrom && t.to <= mathSpan.contentTo)
    .slice(-16);

  let rawProtectedUpTo = state.rawProtectedUpTo;
  if (rawProtectedUpTo !== undefined) {
    if (changeFrom >= rawProtectedUpTo) {
      // unchanged
    } else if (changeTo <= rawProtectedUpTo) {
      rawProtectedUpTo = Math.max(mathSpan.contentFrom, rawProtectedUpTo + delta);
    } else {
      rawProtectedUpTo = undefined;
    }
  }

  return {
    active: state.active,
    currentSlot,
    queue,
    visited,
    leader: null,
    rawSpan,
    ...(rawProtectedUpTo !== undefined ? { rawProtectedUpTo } : {}),
  };
}

/**
 * Finds the active `$...$` or `$$...$$` span enclosing `cursorPos` within a bounded local window.
 * Ignores escaped `\$`, inline code `` `...` ``, and fenced code blocks ```` ``` ````.
 */
export function findEnclosingMathSpan(docText: string, cursorPos: number): InlineMathSpan | null {
  const windowRadius = 16000;
  const winStart = Math.max(0, cursorPos - windowRadius);
  const winEnd = Math.min(docText.length, cursorPos + windowRadius);
  const slice = docText.slice(winStart, winEnd);
  const relPos = cursorPos - winStart;

  let i = 0;
  let inFence = false;
  while (i < slice.length) {
    if ((i === 0 || slice[i - 1] === '\n') && /^\s*(?:>\s*)*(?:```|~~~)/.test(slice.slice(i, i + 24))) {
      inFence = !inFence;
      const nl = slice.indexOf('\n', i);
      if (nl === -1) return null;
      i = nl + 1;
      continue;
    }
    if (inFence) {
      const nl = slice.indexOf('\n', i);
      if (nl === -1) return null;
      i = nl + 1;
      continue;
    }

    const ch = slice[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') {
      let ticks = 1;
      while (slice[i + ticks] === '`') ticks += 1;
      const closeTicks = slice.indexOf('`'.repeat(ticks), i + ticks);
      if (closeTicks === -1) return null;
      if (relPos > i && relPos < closeTicks + ticks) return null;
      i = closeTicks + ticks;
      continue;
    }

    if (ch === '$' && slice[i + 1] === '$') {
      if (relPos === i + 1) {
        return {
          rawFrom: winStart + i,
          rawTo: winStart + i + 2,
          contentFrom: winStart + i + 1,
          contentTo: winStart + i + 1,
          isBlock: false,
        };
      }
      const openStart = i;
      const contentStart = i + 2;
      let closeIdx = contentStart;
      let found = -1;
      while (closeIdx < slice.length - 1) {
        if (slice[closeIdx] === '\\') {
          if (
            closeIdx + 1 === relPos &&
            slice[closeIdx + 1] === '$' &&
            slice[closeIdx + 2] === '$'
          ) {
            found = closeIdx + 1;
            break;
          }
          closeIdx += 2;
          continue;
        }
        if (slice[closeIdx] === '$' && slice[closeIdx + 1] === '$') {
          found = closeIdx;
          break;
        }
        closeIdx += 1;
      }
      if (found === -1) return null;
      if (relPos >= contentStart && relPos <= found) {
        return {
          rawFrom: winStart + openStart,
          rawTo: winStart + found + 2,
          contentFrom: winStart + contentStart,
          contentTo: winStart + found,
          isBlock: true,
        };
      }
      i = found + 2;
      continue;
    }

    if (ch === '$') {
      const openStart = i;
      const contentStart = i + 1;
      let closeIdx = contentStart;
      let found = -1;
      while (closeIdx < slice.length && slice[closeIdx] !== '\n') {
        if (slice[closeIdx] === '\\') {
          if (closeIdx + 1 === relPos && slice[closeIdx + 1] === '$') {
            found = closeIdx + 1;
            break;
          }
          closeIdx += 2;
          continue;
        }
        if (slice[closeIdx] === '$') {
          if (slice[closeIdx + 1] === '$') {
            found = -1;
            break;
          }
          found = closeIdx;
          break;
        }
        closeIdx += 1;
      }
      if (found !== -1) {
        if (relPos >= contentStart && relPos <= found) {
          return {
            rawFrom: winStart + openStart,
            rawTo: winStart + found + 1,
            contentFrom: winStart + contentStart,
            contentTo: winStart + found,
            isBlock: false,
          };
        }
        i = found + 1;
        continue;
      }
    }
    i += 1;
  }
  return null;
}

export function getLeaderCapsuleItems(
  prefix: string,
  settings: InlineExpanderSettings,
): CapsuleItem[] {
  const cmds = settings.effectiveCommands ?? COMMANDS;
  if (prefix === '') {
    const directs: CapsuleItem[] = cmds
      .filter((c) => c.keys.length === 1)
      .map((c) => ({ key: c.keys[0], label: c.label, glyph: c.glyph }));
    const subs: CapsuleItem[] = SUBMENUS.map((s) => ({
      key: s.key,
      label: s.label,
      glyph: s.glyph,
      isSubmenu: true,
    }));
    if ((settings.customCommands?.length ?? 0) > 0) {
      subs.push({ key: 'k', label: '自定义', glyph: '★', isSubmenu: true });
    }
    if ((settings.snippets?.length ?? 0) > 0) {
      subs.push({ key: 't', label: '片段', glyph: '✂', isSubmenu: true });
    }
    subs.push({ key: 'w', label: '2D工作台', glyph: '⊞', isWorkbench: true });
    return [...directs, ...subs];
  }

  if (prefix === 'k') {
    return (settings.customCommands ?? []).map((c, idx) => ({
      key: c.key ?? String(idx + 1),
      label: c.label,
      glyph: c.key ?? '★',
      isDefault: idx === 0,
    }));
  }
  if (prefix === 't') {
    return (settings.snippets ?? []).map((s, idx) => ({
      key: s.key ?? String(idx + 1),
      label: s.name,
      glyph: s.key ?? '✂',
      isDefault: idx === 0,
    }));
  }

  const defId = getSubmenuDefaultCommandId(prefix);
  return cmds
    .filter((c) => c.keys.length === 2 && c.keys[0] === prefix)
    .map((c) => ({
      key: c.keys[1],
      label: c.label,
      glyph: c.glyph,
      isDefault: c.id === defId,
    }));
}

export function compileInlineExpansion(
  cmd: Pick<CommandDef, 'id' | 'latex' | 'slots'>,
  insertAt: number,
  nextCharInDoc: string,
  settings: Pick<InlineExpanderSettings, 'slotOrderPreset' | 'slotOrderOverrides'>,
): { insertText: string; currentSlot: InlineTabstop | null; queue: InlineTabstop[]; cursor: number } {
  const safeTpl = sanitizeLatexTemplate(cmd.latex);
  if (cmd.slots.length === 0) {
    const needsSpace = /\\[a-zA-Z]+$/.test(safeTpl) && /^[a-zA-Z]$/.test(nextCharInDoc);
    const out = needsSpace ? `${safeTpl} ` : safeTpl;
    return {
      insertText: out,
      currentSlot: null,
      queue: [],
      cursor: insertAt + out.length,
    };
  }

  const slotPositions = new Map<number, InlineTabstop>();
  let built = '';
  const regex = /\$(\d+)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null = regex.exec(safeTpl);

  while (match !== null) {
    const fullMatch = match[0];
    const slotNum = Number(match[1]) - 1;
    const matchStart = match.index;
    const matchEnd = matchStart + fullMatch.length;
    built += safeTpl.slice(lastIdx, matchStart);
    const slotOffset = insertAt + built.length;

    let optionalWrapperFrom: number | undefined;
    let optionalWrapperTo: number | undefined;
    if (isOptionalSlot(cmd.id, slotNum)) {
      if (matchStart >= 1 && safeTpl[matchStart - 1] === '[' && safeTpl[matchEnd] === ']') {
        optionalWrapperFrom = slotOffset - 1;
        optionalWrapperTo = slotOffset + 1;
      } else if (
        matchStart >= 2 &&
        (safeTpl.slice(matchStart - 2, matchStart) === '_{' ||
          safeTpl.slice(matchStart - 2, matchStart) === '^{') &&
        safeTpl[matchEnd] === '}'
      ) {
        optionalWrapperFrom = slotOffset - 2;
        optionalWrapperTo = slotOffset + 1;
      }
    }

    slotPositions.set(slotNum, {
      from: slotOffset,
      to: slotOffset,
      label: cmd.slots[slotNum] ?? `槽${slotNum + 1}`,
      ...(optionalWrapperFrom !== undefined && optionalWrapperTo !== undefined
        ? { optionalWrapperFrom, optionalWrapperTo }
        : {}),
    });

    lastIdx = matchEnd;
    match = regex.exec(safeTpl);
  }
  built += safeTpl.slice(lastIdx);

  const order = getSlotOrder(cmd.id, settings, cmd.slots.length);
  const orderedStops: InlineTabstop[] = [];
  for (const sIdx of order) {
    const stop = slotPositions.get(sIdx);
    if (stop) orderedStops.push(stop);
  }
  const endOffset = insertAt + built.length;
  orderedStops.push({
    from: endOffset,
    to: endOffset,
    label: '跳出',
    isExit: true,
  });

  const first = orderedStops[0] ?? null;
  const rest = orderedStops.slice(1);
  return {
    insertText: built,
    currentSlot: first,
    queue: rest,
    cursor: first ? first.from : endOffset,
  };
}

export function resolveSubmenuDefaultCmd(
  prefix: string,
  settings: InlineExpanderSettings,
): Pick<CommandDef, 'id' | 'latex' | 'slots'> | null {
  const cmds = settings.effectiveCommands ?? COMMANDS;
  if (prefix === 'k') {
    const first = settings.customCommands?.[0];
    return first ? { id: first.id, latex: first.latex, slots: first.slots } : null;
  }
  if (prefix === 't') {
    const first = settings.snippets?.[0];
    return first ? { id: first.id, latex: first.latex, slots: [] } : null;
  }
  const defId = getSubmenuDefaultCommandId(prefix);
  const byId = cmds.find((c) => c.id === defId) ?? COMMANDS_BY_ID.get(defId ?? '');
  if (byId) return byId;
  return cmds.find((c) => c.keys.length === 2 && c.keys[0] === prefix) ?? null;
}

export function applyExpandedCommand(
  replaceFrom: number,
  replaceTo: number,
  cmd: Pick<CommandDef, 'id' | 'latex' | 'slots'>,
  docText: string,
  baseCurrentSlot: InlineTabstop | null,
  baseQueue: InlineTabstop[],
  settings: InlineExpanderSettings,
): {
  changes: { from: number; to: number; insert: string };
  selection: number;
  currentSlot: InlineTabstop | null;
  queue: InlineTabstop[];
  insertedEnd: number;
} {
  const nextChar = docText[replaceTo] ?? '';
  const compiled = compileInlineExpansion(cmd, replaceFrom, nextChar, settings);
  const delta = compiled.insertText.length - (replaceTo - replaceFrom);
  const shiftedOuter = baseQueue.map((q) => shiftTabstop(q, replaceFrom, replaceTo, delta));
  const nextCurrentSlot =
    compiled.currentSlot ??
    (baseCurrentSlot ? shiftTabstop(baseCurrentSlot, replaceFrom, replaceTo, delta) : null);
  return {
    changes: { from: replaceFrom, to: replaceTo, insert: compiled.insertText },
    selection: compiled.cursor,
    currentSlot: nextCurrentSlot,
    queue: [...compiled.queue, ...shiftedOuter],
    insertedEnd: replaceFrom + compiled.insertText.length,
  };
}

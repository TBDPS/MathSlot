import { COMMANDS, COMMANDS_BY_ID, SUBMENU_KEYS } from '../catalog';
import { isRenderableRawLatex } from '../commandSpecs';
import { MATH_FUNCTIONS, OPERATORNAME_FUNCTIONS } from '../emitIr';
import {
  AUTO_SHORTHANDS,
  BARE_WORD_ATOMS,
  BARE_WORD_BINOPS,
  DIFFERENTIAL_WORDS,
} from '../shorthands';
import type { CommandDef } from '../types';
import {
  type InlineActionResult,
  type InlineExpanderSettings,
  type InlineMathSpan,
  type InlineSessionState,
  type InlineTabstop,
  applyExpandedCommand,
  DEFAULT_INLINE_SETTINGS,
  mapInlineSessionThroughChange,
  resolveSubmenuDefaultCmd,
  shiftTabstop,
} from './inlineCompile';

const SORTED_PUNCT_RULES = AUTO_SHORTHANDS.filter((r) => r.kind === 'punct').sort(
  (a, b) => b.trigger.length - a.trigger.length,
);

const PUNCT_LATEX_UPGRADES: readonly { prevLatex: string; suffix: string; upgradedLatex: string }[] = (() => {
  const out: { prevLatex: string; suffix: string; upgradedLatex: string }[] = [];
  for (const longer of SORTED_PUNCT_RULES) {
    if (longer.trigger.length < 3) continue;
    const prefix = longer.trigger.slice(0, -1);
    const suffix = longer.trigger[longer.trigger.length - 1];
    const shorter = SORTED_PUNCT_RULES.find((r) => r.trigger === prefix);
    if (!shorter || shorter.commandId === longer.commandId) continue;
    const prevCmd = COMMANDS_BY_ID.get(shorter.commandId);
    const upCmd = COMMANDS_BY_ID.get(longer.commandId);
    if (prevCmd && upCmd) {
      out.push({ prevLatex: prevCmd.latex, suffix, upgradedLatex: upCmd.latex });
    }
  }
  return out;
})();

function isInsideVerbatimTexMacro(mathSliceBeforeCursor: string): boolean {
  const macros = ['\\text{', '\\mathrm{', '\\operatorname{', '\\begin{', '\\end{'];
  for (const prefix of macros) {
    const idx = mathSliceBeforeCursor.lastIndexOf(prefix);
    if (idx !== -1) {
      let depth = 1;
      for (let i = idx + prefix.length; i < mathSliceBeforeCursor.length; i += 1) {
        if (mathSliceBeforeCursor[i] === '\\') {
          i += 1;
          continue;
        }
        if (mathSliceBeforeCursor[i] === '{') depth += 1;
        else if (mathSliceBeforeCursor[i] === '}') depth -= 1;
        if (depth === 0) break;
      }
      if (depth > 0) return true;
    }
  }
  return false;
}

function resolveBareWordReplacement(
  beforeInMath: string,
  settings: InlineExpanderSettings,
): { word: string; replacement: string } | null {
  if (!settings.wordShorthands) return null;
  const wordMatch = beforeInMath.match(/(?<![\\a-zA-Z])([a-zA-Z]{2,})$/);
  if (!wordMatch) return null;
  const word = wordMatch[1];

  // User/custom word shorthands (0-slot)
  for (const c of settings.customCommands ?? []) {
    if (c.slots.length === 0 && c.shorthand?.trim() === word) {
      return { word, replacement: c.latex };
    }
  }
  for (const c of settings.effectiveCommands ?? []) {
    if (c.slots.length === 0 && c.shorthand?.trim() === word) {
      return { word, replacement: c.latex };
    }
  }

  const replacement =
    BARE_WORD_ATOMS[word] ??
    BARE_WORD_BINOPS[word] ??
    (MATH_FUNCTIONS.has(word) ? `\\${word}` : undefined) ??
    OPERATORNAME_FUNCTIONS[word] ??
    (DIFFERENTIAL_WORDS[word]
      ? (() => {
          const pre = beforeInMath.slice(0, beforeInMath.length - word.length).trimEnd();
          const needsThin = pre.length > 0 && !/[([+\-=<>]$/.test(pre);
          return `${needsThin ? '\\,' : ''}${DIFFERENTIAL_WORDS[word]}`;
        })()
      : undefined);

  return replacement ? { word, replacement } : null;
}

function shiftSpanForPendingEdit(
  span: InlineMathSpan,
  repFrom: number,
  repTo: number,
  insertLen: number,
): InlineMathSpan {
  const delta = insertLen - (repTo - repFrom);
  return {
    ...span,
    rawTo: span.rawTo + delta,
    contentTo: span.contentTo + delta,
  };
}

export function handleInlineLeaderTrigger(state: InlineSessionState): InlineActionResult {
  if (state.rawSpan) {
    return {
      kind: 'handled',
      state: { ...state, rawSpan: null, rawProtectedUpTo: state.rawSpan.to },
      selection: state.rawSpan.to,
    };
  }
  if (state.leader) {
    if (state.leader.prefix !== '' && state.leader.morphBackup) {
      return { kind: 'handled', state: { ...state, leader: null } };
    }
    const b = state.leader.morphBackup;
    if (b) {
      return {
        kind: 'handled',
        state: {
          currentSlot: b.prevCurrentSlot,
          queue: b.prevQueue,
          visited: b.prevVisited,
          leader: null,
          rawSpan: null,
        },
        changes: { from: b.replaceFrom, to: b.replaceTo, insert: '' },
        selection: b.replaceFrom,
      };
    }
    return { kind: 'handled', state: { ...state, leader: null } };
  }
  return {
    kind: 'handled',
    state: { ...state, leader: { prefix: '' } },
  };
}

export function handleInlineLeaderKey(
  docText: string,
  cursorPos: number,
  key: string,
  state: InlineSessionState,
  settings: InlineExpanderSettings,
): InlineActionResult {
  if (!state.leader) return { kind: 'noop' };
  const cmds = settings.effectiveCommands ?? COMMANDS;
  const { prefix, morphBackup } = state.leader;

  if (key === 'Escape') {
    if (morphBackup) {
      return {
        kind: 'handled',
        state: {
          currentSlot: morphBackup.prevCurrentSlot,
          queue: morphBackup.prevQueue,
          visited: morphBackup.prevVisited,
          leader: null,
          rawSpan: null,
        },
        changes: { from: morphBackup.replaceFrom, to: morphBackup.replaceTo, insert: '' },
        selection: morphBackup.replaceFrom,
      };
    }
    return { kind: 'handled', state: { ...state, leader: null } };
  }

  if (key === 'Backspace') {
    if (prefix !== '' && morphBackup) {
      return {
        kind: 'handled',
        state: {
          currentSlot: morphBackup.prevCurrentSlot,
          queue: morphBackup.prevQueue,
          visited: morphBackup.prevVisited,
          leader: { prefix: '' },
          rawSpan: null,
        },
        changes: { from: morphBackup.replaceFrom, to: morphBackup.replaceTo, insert: '' },
        selection: morphBackup.replaceFrom,
      };
    }
    return { kind: 'handled', state: { ...state, leader: null } };
  }

  if (key.length !== 1) return { kind: 'noop' };

  if (prefix === '') {
    if (key === 'w' || key === 'W') {
      return { kind: 'open_workbench', state: { ...state, leader: null } };
    }
    if (SUBMENU_KEYS.has(key) || key === 'k' || key === 't') {
      const defCmd = resolveSubmenuDefaultCmd(key, settings);
      if (defCmd) {
        const prevCurrent = state.currentSlot;
        const prevQueue = [...state.queue];
        const prevVisited = [...state.visited];
        const applied = applyExpandedCommand(
          cursorPos,
          cursorPos,
          defCmd,
          docText,
          prevCurrent,
          prevQueue,
          settings,
        );
        return {
          kind: 'handled',
          state: {
            currentSlot: applied.currentSlot,
            queue: applied.queue,
            visited: prevVisited,
            leader: {
              prefix: key,
              pendingDefaultId: defCmd.id,
              morphBackup: {
                replaceFrom: cursorPos,
                replaceTo: applied.insertedEnd,
                prevCurrentSlot: prevCurrent,
                prevQueue,
                prevVisited,
              },
            },
            rawSpan: null,
          },
          changes: applied.changes,
          selection: applied.selection,
        };
      }
      return { kind: 'handled', state: { ...state, leader: { prefix: key } } };
    }

    const direct = cmds.find((c) => c.keys.length === 1 && c.keys[0] === key);
    if (direct) {
      const applied = applyExpandedCommand(
        cursorPos,
        cursorPos,
        direct,
        docText,
        state.currentSlot,
        state.queue,
        settings,
      );
      return {
        kind: 'handled',
        state: {
          currentSlot: applied.currentSlot,
          queue: applied.queue,
          visited: state.visited,
          leader: null,
          rawSpan: null,
        },
        changes: applied.changes,
        selection: applied.selection,
      };
    }
    return { kind: 'handled', state: { ...state, leader: null } };
  }

  if (key === ' ') {
    return { kind: 'handled', state: { ...state, leader: null } };
  }

  let matchedCmd: Pick<CommandDef, 'id' | 'latex' | 'slots'> | undefined;
  if (prefix === 'k') {
    const custom = settings.customCommands?.find((c) => c.key === key);
    if (custom) matchedCmd = { id: custom.id, latex: custom.latex, slots: custom.slots };
  } else if (prefix === 't') {
    const snip = settings.snippets?.find((s) => s.key === key);
    if (snip) matchedCmd = { id: snip.id, latex: snip.latex, slots: [] };
  } else {
    const found = cmds.find((c) => c.keys.length === 2 && c.keys[0] === prefix && c.keys[1] === key);
    if (found) {
      if (found.id === 'raw_latex') {
        const from = morphBackup ? morphBackup.replaceFrom : cursorPos;
        const to = morphBackup ? morphBackup.replaceTo : cursorPos;
        return {
          kind: 'handled',
          state: {
            currentSlot: morphBackup ? morphBackup.prevCurrentSlot : state.currentSlot,
            queue: morphBackup ? morphBackup.prevQueue : state.queue,
            visited: morphBackup ? morphBackup.prevVisited : state.visited,
            leader: null,
            rawSpan: { from, to: from },
          },
          changes: from !== to ? { from, to, insert: '' } : undefined,
          selection: from,
        };
      }
      matchedCmd = found;
    }
  }

  if (matchedCmd) {
    const repFrom = morphBackup ? morphBackup.replaceFrom : cursorPos;
    const repTo = morphBackup ? morphBackup.replaceTo : cursorPos;
    const baseCur = morphBackup ? morphBackup.prevCurrentSlot : state.currentSlot;
    const baseQ = morphBackup ? morphBackup.prevQueue : state.queue;
    const baseVisited = morphBackup ? morphBackup.prevVisited : state.visited;
    const applied = applyExpandedCommand(repFrom, repTo, matchedCmd, docText, baseCur, baseQ, settings);
    return {
      kind: 'handled',
      state: {
        currentSlot: applied.currentSlot,
        queue: applied.queue,
        visited: baseVisited,
        leader: null,
        rawSpan: null,
      },
      changes: applied.changes,
      selection: applied.selection,
    };
  }

  if (morphBackup) {
    return {
      kind: 'commit_and_fallthrough',
      state: { ...state, leader: null },
    };
  }
  return { kind: 'handled', state: { ...state, leader: null } };
}

export function handleInlineSemicolon(
  docText: string,
  cursorPos: number,
  state: InlineSessionState,
  mathSpan?: InlineMathSpan | null,
  settings: InlineExpanderSettings = DEFAULT_INLINE_SETTINGS,
): InlineActionResult {
  if (state.rawSpan) return { kind: 'noop' };
  if (cursorPos > 0 && docText[cursorPos - 1] === '\\') return { kind: 'noop' };
  if (!state.currentSlot && state.queue.length === 0) return { kind: 'noop' };

  let changes: { from: number; to: number; insert: string } | undefined;
  let queue = [...state.queue];
  let visited = [...state.visited];
  let cur = state.currentSlot;

  // 1. Auto-clean empty optional wrapper (`_{}`, `^{}`, `[]`) when skipped via `;`!
  if (
    cur &&
    cur.optionalWrapperFrom !== undefined &&
    cur.optionalWrapperTo !== undefined &&
    docText.slice(cur.from, cur.to).trim() === ''
  ) {
    const wFrom = cur.optionalWrapperFrom;
    const wTo = cur.optionalWrapperTo;
    const delta = -(wTo - wFrom);
    changes = { from: wFrom, to: wTo, insert: '' };
    queue = queue.map((t) => shiftTabstop(t, wFrom, wTo, delta));
    visited = visited.map((t) => shiftTabstop(t, wFrom, wTo, delta));
    cur = null;
  } else if (settings.wordShorthands) {
    // 2. Expand trailing bare-word shorthand (`Tab f pi; 2;` -> `\frac{\pi}{2}`) before jumping!
    const spanStart = Math.max(mathSpan ? mathSpan.contentFrom : 0, state.rawProtectedUpTo ?? 0);
    const beforeInMath = docText.slice(spanStart, cursorPos);
    if (!isInsideVerbatimTexMacro(beforeInMath)) {
      const hit = resolveBareWordReplacement(beforeInMath, settings);
      if (hit) {
        const wFrom = cursorPos - hit.word.length;
        const delta = hit.replacement.length - hit.word.length;
        changes = { from: wFrom, to: cursorPos, insert: hit.replacement };
        if (cur) cur = shiftTabstop(cur, wFrom, cursorPos, delta);
        queue = queue.map((t) => shiftTabstop(t, wFrom, cursorPos, delta));
        visited = visited.map((t) => shiftTabstop(t, wFrom, cursorPos, delta));
      }
    }
  }

  if (cur && !cur.isExit && cur.label !== '') {
    visited = [...visited, cur].slice(-16);
  }

  const next = queue.shift() ?? null;
  if (!next) {
    return {
      kind: 'handled',
      state: { currentSlot: null, queue: [], visited, leader: null, rawSpan: null },
      changes,
      selection: changes ? changes.from + changes.insert.length : cursorPos,
    };
  }

  if (next.isExit) {
    return {
      kind: 'handled',
      state: {
        currentSlot: queue.length > 0 ? { from: next.to, to: next.to, label: '' } : null,
        queue,
        visited,
        leader: null,
        rawSpan: null,
      },
      changes,
      selection: next.to,
    };
  }

  return {
    kind: 'handled',
    state: {
      currentSlot: next,
      queue,
      visited,
      leader: null,
      rawSpan: null,
    },
    changes,
    selection: next.to,
  };
}

export function handleInlinePrevSlot(
  cursorPos: number,
  state: InlineSessionState,
  mathSpan: InlineMathSpan | null,
): InlineActionResult {
  if (state.rawSpan || state.visited.length === 0 || !mathSpan) {
    return { kind: 'noop' };
  }
  const visited = [...state.visited];
  const prev = visited.pop()!;
  if (prev.from < mathSpan.contentFrom || prev.to > mathSpan.contentTo) {
    return { kind: 'noop' };
  }
  const nextQueue = [...state.queue];
  if (state.currentSlot && state.currentSlot.label !== '') {
    nextQueue.unshift(state.currentSlot);
  } else if (nextQueue.length === 0) {
    nextQueue.unshift({ from: cursorPos, to: cursorPos, label: '跳出', isExit: true });
  }
  return {
    kind: 'handled',
    state: {
      currentSlot: prev,
      queue: nextQueue,
      visited,
      leader: null,
      rawSpan: null,
    },
    selection: prev.to,
  };
}

export function handleInlineSpecialKey(
  docText: string,
  cursorPos: number,
  key: 'Enter' | 'ArrowRight',
  state: InlineSessionState,
): InlineActionResult {
  if (!state.rawSpan) return { kind: 'noop' };
  const rawContent = docText.slice(state.rawSpan.from, state.rawSpan.to);
  if (key === 'Enter') {
    return {
      kind: 'handled',
      state: { ...state, rawSpan: null, rawProtectedUpTo: state.rawSpan.to },
      selection: state.rawSpan.to,
    };
  }
  if (
    key === 'ArrowRight' &&
    cursorPos === state.rawSpan.to &&
    (rawContent === '' || isRenderableRawLatex(rawContent))
  ) {
    return {
      kind: 'handled',
      state: { ...state, rawSpan: null, rawProtectedUpTo: state.rawSpan.to },
      selection: state.rawSpan.to,
    };
  }
  return { kind: 'noop' };
}

export function handleInlineCharTyped(
  docText: string,
  cursorPos: number,
  mathSpan: InlineMathSpan,
  ch: string,
  state: InlineSessionState,
  settings: InlineExpanderSettings,
): InlineActionResult {
  if (!settings.enabled || ch.length !== 1) return { kind: 'noop' };
  if (state.rawSpan && cursorPos >= state.rawSpan.from && cursorPos <= state.rawSpan.to) {
    return { kind: 'noop' };
  }

  const fullBeforeInMath = docText.slice(mathSpan.contentFrom, cursorPos);
  if (isInsideVerbatimTexMacro(fullBeforeInMath)) {
    return { kind: 'noop' };
  }

  const protectedStart =
    state.rawProtectedUpTo !== undefined && state.rawProtectedUpTo <= cursorPos
      ? Math.max(mathSpan.contentFrom, state.rawProtectedUpTo)
      : mathSpan.contentFrom;
  const beforeInMath = docText.slice(protectedStart, cursorPos);

  // 1. Double backslash `\\` -> open Native LaTeX Passthrough Span (`rawSpan`)!
  if (ch === '\\' && beforeInMath.endsWith('\\') && !beforeInMath.endsWith('\\\\')) {
    const start = cursorPos - 1;
    return {
      kind: 'handled',
      state: {
        ...state,
        leader: null,
        rawSpan: { from: start, to: start },
      },
      changes: { from: start, to: cursorPos, insert: '' },
      selection: start,
    };
  }

  // Never trigger auto-sugar immediately after an escaping single backslash `\`
  if (beforeInMath.endsWith('\\')) {
    return { kind: 'noop' };
  }

  // 2. Natural scripts `^` and `_` -> wrap into `^{|}` / `_{|}` (expanding trailing word shorthand first if any!)
  if (settings.naturalScripts && (ch === '^' || ch === '_') && docText[cursorPos] !== '{') {
    const wordHit = resolveBareWordReplacement(beforeInMath, settings);
    const repFrom = wordHit ? cursorPos - wordHit.word.length : cursorPos;
    const prefixTex = wordHit ? wordHit.replacement : '';
    const insert = `${prefixTex}${ch}{}`;
    const slotPos = repFrom + prefixTex.length + 2;
    const afterPos = repFrom + insert.length;
    const postSpan = shiftSpanForPendingEdit(mathSpan, repFrom, cursorPos, insert.length);
    const shifted = mapInlineSessionThroughChange(state, repFrom, cursorPos, insert.length, slotPos, postSpan);
    const scriptSlot: InlineTabstop = {
      from: slotPos,
      to: slotPos,
      label: ch === '^' ? '上标' : '下标',
    };
    const exitStop: InlineTabstop = {
      from: afterPos,
      to: afterPos,
      label: '跳出',
      isExit: true,
    };
    return {
      kind: 'handled',
      state: {
        currentSlot: scriptSlot,
        queue: [exitStop, ...shifted.queue],
        visited: shifted.visited,
        leader: null,
        rawSpan: null,
        ...(shifted.rawProtectedUpTo !== undefined ? { rawProtectedUpTo: shifted.rawProtectedUpTo } : {}),
      },
      changes: { from: repFrom, to: cursorPos, insert },
      selection: slotPos,
    };
  }

  // 3. Natural fraction `/` -> grab preceding numerator term into `\frac{num}{|}`!
  if (settings.naturalFraction && ch === '/') {
    let scan = beforeInMath.length;
    while (scan > 0 && beforeInMath[scan - 1] === ' ') scan -= 1;
    const numEnd = scan;
    let braceDepth = 0;
    let parenDepth = 0;
    while (scan > 0) {
      const c = beforeInMath[scan - 1];
      if (c === '}') braceDepth += 1;
      else if (c === '{') {
        if (braceDepth === 0) break;
        braceDepth -= 1;
      } else if (c === ')' || c === ']') parenDepth += 1;
      else if (c === '(' || c === '[') {
        if (parenDepth === 0) break;
        parenDepth -= 1;
      } else if (braceDepth === 0 && parenDepth === 0 && /^[+=,;:\-<>~\n&]$/.test(c)) {
        break;
      } else if (braceDepth === 0 && parenDepth === 0 && c === ' ') {
        break;
      }
      scan -= 1;
    }
    let numRaw = beforeInMath.slice(scan, numEnd).trim();
    if (numRaw && /^[a-zA-Z]{2,}$/.test(numRaw)) {
      const wordHit = resolveBareWordReplacement(numRaw, settings);
      if (wordHit && wordHit.word === numRaw) {
        numRaw = wordHit.replacement;
      }
    }
    const repFrom = protectedStart + scan;
    const insert = `\\frac{${numRaw}}{}`;
    const denPos = repFrom + `\\frac{${numRaw}}{`.length;
    const afterFrac = repFrom + insert.length;
    const postSpan = shiftSpanForPendingEdit(mathSpan, repFrom, cursorPos, insert.length);
    const shifted = mapInlineSessionThroughChange(state, repFrom, cursorPos, insert.length, denPos, postSpan);
    return {
      kind: 'handled',
      state: {
        currentSlot: numRaw
          ? { from: denPos, to: denPos, label: '分母' }
          : { from: repFrom + 6, to: repFrom + 6, label: '分子' },
        queue: numRaw
          ? [{ from: afterFrac, to: afterFrac, label: '跳出', isExit: true }, ...shifted.queue]
          : [
              { from: denPos, to: denPos, label: '分母' },
              { from: afterFrac, to: afterFrac, label: '跳出', isExit: true },
              ...shifted.queue,
            ],
        visited: shifted.visited,
        leader: null,
        rawSpan: null,
        ...(shifted.rawProtectedUpTo !== undefined ? { rawProtectedUpTo: shifted.rawProtectedUpTo } : {}),
      },
      changes: { from: repFrom, to: cursorPos, insert },
      selection: numRaw ? denPos : repFrom + 6,
    };
  }

  // 4. Word-boundary shorthands (`pi`, `oo`, `dx`, `alpha`, `sin`, ...) when pressing Space or delimiter/operator
  if (settings.wordShorthands && !/^[a-zA-Z\\]$/.test(ch)) {
    const hit = resolveBareWordReplacement(beforeInMath, settings);
    if (hit && (ch === ' ' || /^[,;()[\]=+\-<>:*]$/.test(ch))) {
      const wFrom = cursorPos - hit.word.length;
      const insert = `${hit.replacement}${ch}`;
      const postSpan = shiftSpanForPendingEdit(mathSpan, wFrom, cursorPos, insert.length);
      const mapped = mapInlineSessionThroughChange(
        state,
        wFrom,
        cursorPos,
        insert.length,
        wFrom + insert.length,
        postSpan,
      );
      return {
        kind: 'handled',
        state: mapped,
        changes: { from: wFrom, to: cursorPos, insert },
        selection: wFrom + insert.length,
      };
    }
  }

  // 5. Punctuation shorthands (`->` -> `\to`, `!=` -> `\neq`, `<=` + `>` -> `\Leftrightarrow`, ...)
  if (settings.punctShorthands) {
    for (const up of PUNCT_LATEX_UPGRADES) {
      if (up.suffix !== ch) continue;
      const trimmedBefore = beforeInMath.endsWith(' ') ? beforeInMath.slice(0, -1) : beforeInMath;
      if (trimmedBefore.endsWith(up.prevLatex)) {
        const uFrom =
          cursorPos - (beforeInMath.endsWith(' ') ? up.prevLatex.length + 1 : up.prevLatex.length);
        const nextCh = docText[cursorPos] ?? '';
        const out =
          /\\[a-zA-Z]+$/.test(up.upgradedLatex) && /^[a-zA-Z]$/.test(nextCh)
            ? `${up.upgradedLatex} `
            : up.upgradedLatex;
        const postSpan = shiftSpanForPendingEdit(mathSpan, uFrom, cursorPos, out.length);
        const mapped = mapInlineSessionThroughChange(
          state,
          uFrom,
          cursorPos,
          out.length,
          uFrom + out.length,
          postSpan,
        );
        return {
          kind: 'handled',
          state: mapped,
          changes: { from: uFrom, to: cursorPos, insert: out },
          selection: uFrom + out.length,
        };
      }
    }

    const candidateTail = beforeInMath + ch;
    for (const rule of SORTED_PUNCT_RULES) {
      if (candidateTail.endsWith(rule.trigger)) {
        const prevIdx = candidateTail.length - rule.trigger.length - 1;
        if (prevIdx >= 0 && candidateTail[prevIdx] === '\\') continue;
        const cmd = COMMANDS_BY_ID.get(rule.commandId);
        if (!cmd) continue;
        const pFrom = cursorPos - (rule.trigger.length - 1);
        const nextCh = docText[cursorPos] ?? '';
        const out =
          /\\[a-zA-Z]+$/.test(cmd.latex) && /^[a-zA-Z]$/.test(nextCh)
            ? `${cmd.latex} `
            : cmd.latex;
        const postSpan = shiftSpanForPendingEdit(mathSpan, pFrom, cursorPos, out.length);
        const mapped = mapInlineSessionThroughChange(
          state,
          pFrom,
          cursorPos,
          out.length,
          pFrom + out.length,
          postSpan,
        );
        return {
          kind: 'handled',
          state: mapped,
          changes: { from: pFrom, to: cursorPos, insert: out },
          selection: pFrom + out.length,
        };
      }
    }
  }

  return { kind: 'noop' };
}

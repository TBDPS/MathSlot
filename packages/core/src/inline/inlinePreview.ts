import { isRenderableRawLatex, sanitizeLatexTemplate } from '../commandSpecs';
import { extractBlockquotePrefix } from '../obsidianMath';
import {
  type InlineActionResult,
  type InlineMathSpan,
  type InlineSessionState,
  createActiveInlineSession,
  createEmptyInlineSession,
  mapInlineSessionThroughChange,
} from './inlineCompile';

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
      active: state.active,
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
  key: 'Enter' | 'ArrowRight' | 'Escape',
  state: InlineSessionState,
  mathSpan?: InlineMathSpan | null,
): InlineActionResult {
  if (state.rawSpan) {
    const rawContent = docText.slice(state.rawSpan.from, state.rawSpan.to);
    if (key === 'Enter' || key === 'Escape') {
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

  if (state.active && mathSpan && (key === 'Enter' || key === 'Escape')) {
    return {
      kind: 'handled',
      state: createEmptyInlineSession(),
      selection: mathSpan.rawTo,
      exitSession: true,
    };
  }
  return { kind: 'noop' };
}

function escapeRawPreviewChar(ch: string): string {
  switch (ch) {
    case '\\':
      return '\\text{\\texttt{\\textbackslash}}';
    case '{':
      return '\\text{\\texttt{\\{}}';
    case '}':
      return '\\text{\\texttt{\\}}}';
    case '^':
      return '\\text{\\texttt{\\textasciicircum}}';
    case '~':
      return '\\text{\\texttt{\\textasciitilde}}';
    case '_':
    case '%':
    case '#':
    case '&':
    case '$':
      return `\\text{\\texttt{\\${ch}}}`;
    case ' ':
      return '\\text{\\texttt{\\ }}';
    default:
      return `\\text{\\texttt{${ch}}}`;
  }
}

/**
 * Handles the explicit summon shortcut:
 * 1. Outside math: wraps selection (or inserts `$|$`) and activates the session.
 * 2. Inside math, session inactive: activates the session on the current formula.
 * 3. Inside inline `$...$`, session already active: upgrades `$...$` in-place to block `$$\n...\n$$`!
 * 4. Inside block `$$...$$`, session already active: completes & exits past closing `$$`.
 */
export function handleInlineSummonOrUpgrade(
  docText: string,
  selFrom: number,
  selTo: number,
  state: InlineSessionState,
  mathSpan: InlineMathSpan | null,
): InlineActionResult {
  if (!mathSpan) {
    const selected = docText.slice(selFrom, selTo);
    const insert = `$${selected}$`;
    const cursor = selFrom + 1 + selected.length;
    return {
      kind: 'handled',
      state: createActiveInlineSession(),
      changes: { from: selFrom, to: selTo, insert },
      selection: cursor,
    };
  }

  if (!state.active) {
    return {
      kind: 'handled',
      state: {
        ...state,
        active: true,
        leader: null,
      },
      selection: selTo,
    };
  }

  if (!mathSpan.isBlock) {
    // Upgrade inline `$content$` -> block `$$\ncontent\n$$` (preserving blockquote prefix if on a quote line!)
    const lineStart = docText.lastIndexOf('\n', mathSpan.rawFrom - 1) + 1;
    const lineEndIdx = docText.indexOf('\n', mathSpan.rawTo);
    const lineEnd = lineEndIdx === -1 ? docText.length : lineEndIdx;
    const lineText = docText.slice(lineStart, lineEnd);
    const quoteSplit = extractBlockquotePrefix(lineText);
    const prefix = quoteSplit.prefix;
    const beforeOnLine = docText.slice(lineStart + prefix.length, mathSpan.rawFrom).trim();
    const afterOnLine = docText.slice(mathSpan.rawTo, lineEnd).trim();

    const inner = docText.slice(mathSpan.contentFrom, mathSpan.contentTo);
    const relCursor = Math.max(
      0,
      Math.min(inner.length, selTo - mathSpan.contentFrom),
    );

    const leadBreak = beforeOnLine.length > 0 ? `\n${prefix}` : '';
    const trailBreak = afterOnLine.length > 0 ? `\n${prefix}` : '';
    const openPart = `${leadBreak}$$\n${prefix}`;
    const closePart = `\n${prefix}$$${trailBreak}`;
    const insert = `${openPart}${inner}${closePart}`;

    const newContentFrom = mathSpan.rawFrom + openPart.length;
    const newCursor = newContentFrom + relCursor;
    const newSpan: InlineMathSpan = {
      rawFrom: mathSpan.rawFrom + leadBreak.length,
      rawTo: mathSpan.rawFrom + insert.length - trailBreak.length,
      contentFrom: newContentFrom,
      contentTo: newContentFrom + inner.length,
      isBlock: true,
    };

    // Shift any tracked tabstops from old `contentFrom` to `newContentFrom`
    const shiftDelta = newContentFrom - mathSpan.contentFrom;
    const mapped = mapInlineSessionThroughChange(
      state,
      mathSpan.rawFrom,
      mathSpan.rawFrom,
      shiftDelta,
      newCursor,
      newSpan,
    );
    return {
      kind: 'handled',
      state: { ...mapped, active: true },
      changes: { from: mathSpan.rawFrom, to: mathSpan.rawTo, insert },
      selection: newCursor,
    };
  }

  // Already active in block `$$...$$`: complete & exit past closing `$$`
  return {
    kind: 'handled',
    state: createEmptyInlineSession(),
    selection: mathSpan.rawTo,
    exitSession: true,
  };
}

export interface InlinePreviewPayload {
  latex: string;
  isEmpty: boolean;
}

/**
 * Synthesizes an interactive-grade KaTeX preview string from the live Markdown math span:
 * - Highlights the active slot (`ms-hud-slot-active` when empty, `ms-hud-slot-filled` when non-empty);
 * - Renders pending empty slots (`{}` / `[]`) as subtle `\square` boxes (`ms-hud-slot-pending`) so
 *   fractions, integrals, roots, and matrices look complete immediately upon `Tab` expansion;
 * - Isolates active `\\` `rawSpan` inside a crash-proof monospace capsule (`ms-hud-raw-chip`).
 */
export function buildInlinePreviewLatex(
  docText: string,
  mathSpan: InlineMathSpan,
  session: InlineSessionState,
): InlinePreviewPayload {
  const baseFrom = mathSpan.contentFrom;
  const baseTo = mathSpan.contentTo;
  const rawMath = sanitizeLatexTemplate(docText.slice(baseFrom, baseTo));

  if (rawMath.trim() === '' && !session.rawSpan) {
    return {
      latex: '\\htmlClass{ms-hud-slot-active}{\\square}',
      isEmpty: true,
    };
  }

  interface spliceOp {
    relFrom: number;
    relTo: number;
    priority: number;
    replacement: string;
  }

  const ops: spliceOp[] = [];
  const clampRel = (absPos: number): number =>
    Math.max(0, Math.min(rawMath.length, absPos - baseFrom));

  if (session.rawSpan) {
    const rf = clampRel(session.rawSpan.from);
    const rt = clampRel(session.rawSpan.to);
    const rawSlice = rawMath.slice(rf, rt);
    const escaped =
      rawSlice.length > 0
        ? Array.from(rawSlice).map(escapeRawPreviewChar).join('')
        : '\\square';
    ops.push({
      relFrom: rf,
      relTo: rt,
      priority: 1,
      replacement: `{\\htmlClass{ms-hud-raw-chip}{${escaped}}}`,
    });
  } else if (session.currentSlot && !session.currentSlot.isExit && session.currentSlot.label !== '') {
    const cf = clampRel(session.currentSlot.from);
    const ct = clampRel(session.currentSlot.to);
    const inner = rawMath.slice(cf, ct);
    if (inner.trim() === '') {
      ops.push({
        relFrom: cf,
        relTo: ct,
        priority: 2,
        replacement: '{\\htmlClass{ms-hud-slot-active}{\\square}}',
      });
    } else {
      ops.push({
        relFrom: cf,
        relTo: ct,
        priority: 2,
        replacement: `{\\htmlClass{ms-hud-slot-filled}{${inner}}}`,
      });
    }
  }

  for (const stop of session.queue) {
    if (stop.isExit) continue;
    const qf = clampRel(stop.from);
    const qt = clampRel(stop.to);
    if (qf === qt && rawMath.slice(qf, qt) === '') {
      ops.push({
        relFrom: qf,
        relTo: qt,
        priority: 3,
        replacement: '{\\htmlClass{ms-hud-slot-pending}{\\square}}',
      });
    }
  }

  // Sort non-overlapping splices from left to right
  ops.sort((a, b) => a.relFrom - b.relFrom || a.priority - b.priority);
  let out = '';
  let cursor = 0;
  for (const op of ops) {
    if (op.relFrom < cursor) continue;
    out += rawMath.slice(cursor, op.relFrom) + op.replacement;
    cursor = op.relTo;
  }
  out += rawMath.slice(cursor);

  // Also replace any remaining unescaped bare empty `{}` (e.g. hand-typed `\frac{1}{}`) with a pending square
  out = out.replace(/(?<!\\)\{\s*\}/g, '{\\htmlClass{ms-hud-slot-pending}{\\square}}');

  return {
    latex: out,
    isEmpty: false,
  };
}

/**
 * Best-effort non-destructive healer for incomplete hand-typed TeX (`x^`, `\frac{1`, unclosed `{` or `\left(`)
 * so the live preview card renders smooth 2D math instead of flashing red syntax errors mid-keystroke.
 */
export function healIncompleteLatexForPreview(tex: string): string {
  let s = tex.trimEnd();
  if (!s) return '\\htmlClass{ms-hud-slot-active}{\\square}';

  // 1. Dangling trailing backslash or incomplete unknown macro at the very end
  if (s.endsWith('\\') && !s.endsWith('\\\\')) {
    s = `${s.slice(0, -1)}{\\htmlClass{ms-hud-raw-chip}{\\text{\\texttt{\\textbackslash}}}}`;
  }

  // 2. Dangling `^` or `_` at end or right before `}`
  s = s.replace(/([\^_])\s*(?=\}|$)/g, '$1{\\htmlClass{ms-hud-slot-active}{\\square}}');

  // 3. Balance unclosed `{` braces
  let braceDepth = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\') {
      i += 1;
      continue;
    }
    if (s[i] === '{') braceDepth += 1;
    else if (s[i] === '}') braceDepth = Math.max(0, braceDepth - 1);
  }
  if (braceDepth > 0) {
    s += '}'.repeat(braceDepth);
  }

  // 4. Incomplete `\frac{a}` / `\binom{a}` missing second `{...}` argument at end
  if (/\\(?:frac|dfrac|tfrac|binom|overset|underset|stackrel)\{[^{}]*\}$/.test(s)) {
    s += '{\\htmlClass{ms-hud-slot-pending}{\\square}}';
  }

  // 5. Balance unclosed `\left` with `\right.`
  const leftCount = (s.match(/\\left(?![a-zA-Z])/g) ?? []).length;
  const rightCount = (s.match(/\\right(?![a-zA-Z])/g) ?? []).length;
  if (leftCount > rightCount) {
    s += '\\right.'.repeat(leftCount - rightCount);
  }

  return s;
}

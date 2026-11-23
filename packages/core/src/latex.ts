import { COMMANDS_BY_ID } from './catalog';
import type {
  Cursor,
  DelimiterStyle,
  Document,
  MathNode,
  Selection,
  SlotNode,
} from './types';

export const MATH_FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'coth',
  'log',
  'ln',
  'lg',
  'exp',
  'lim',
  'limsup',
  'liminf',
  'max',
  'min',
  'sup',
  'inf',
  'det',
  'gcd',
  'dim',
  'ker',
  'deg',
  'arg',
  'Pr',
  'hom',
]);

function escapeCharLatex(ch: string): string {
  switch (ch) {
    case '%':
      return '\\%';
    case '#':
      return '\\#';
    case '&':
      return '\\&';
    case '$':
      return '\\$';
    case '_':
      return '\\_';
    case '{':
      return '\\{';
    case '}':
      return '\\}';
    case '~':
      return '\\sim ';
    case '^':
      return '\\hat{}';
    case '\\':
      return '\\backslash ';
    default:
      return ch;
  }
}

function needsTrailingSpace(latex: string): boolean {
  return /\\[a-zA-Z]+$/.test(latex);
}

function startsWithAsciiLetter(s: string): boolean {
  return /^[a-zA-Z]/.test(s);
}

function joinSegments(segments: string[]): string {
  let out = '';
  for (const seg of segments) {
    if (!seg) continue;
    if (out.length > 0 && needsTrailingSpace(out) && startsWithAsciiLetter(seg)) {
      out += ' ';
    }
    out += seg;
  }
  return out;
}

function emitCharRunCanonical(chars: string): string {
  // Replace standalone known math function identifiers with \fn
  return chars.replace(/[A-Za-z]+/g, (word, offset: number, full: string) => {
    if (MATH_FUNCTIONS.has(word)) {
      const next = full[offset + word.length];
      return next && /[A-Za-z]/.test(next) ? `\\${word} ` : `\\${word}`;
    }
    return word;
  });
}

function emitSlotCanonical(slot: SlotNode): string {
  const parts: string[] = [];
  let charBuf = '';

  const flushChars = () => {
    if (charBuf.length > 0) {
      parts.push(emitCharRunCanonical(charBuf));
      charBuf = '';
    }
  };

  for (const node of slot.children) {
    if (node.type === 'char') {
      if (/^[A-Za-z0-9]$/.test(node.value)) {
        charBuf += node.value;
      } else {
        flushChars();
        parts.push(escapeCharLatex(node.value));
      }
    } else {
      flushChars();
      parts.push(emitNodeCanonical(node));
    }
  }
  flushChars();
  return joinSegments(parts).trim();
}

export function emitNodeCanonical(node: MathNode): string {
  switch (node.type) {
    case 'char':
      return escapeCharLatex(node.value);
    case 'symbol':
      return node.latex;
    case 'raw':
      return node.latex;
    case 'struct': {
      const template = node.customLatex ?? COMMANDS_BY_ID.get(node.commandId)?.latex;
      if (!template) {
        return node.slots.map(emitSlotCanonical).join(' ');
      }
      return template.replace(/\$(\d+)/g, (_, idxStr: string) => {
        const idx = Number(idxStr) - 1;
        const slot = node.slots[idx];
        return slot ? emitSlotCanonical(slot) : '';
      });
    }
  }
}

export function emitNodesCanonical(nodes: MathNode[]): string {
  return emitSlotCanonical({ id: '_tmp', label: '', children: nodes });
}

export function toLatex(doc: Document): string {
  const hasLineBreak = doc.root.children.some(
    (n) => n.type === 'raw' && n.latex.trim() === '\\\\',
  );
  const inner = emitSlotCanonical(doc.root);
  if (!hasLineBreak) return inner;
  return `\\begin{gathered} ${inner} \\end{gathered}`;
}

export function formatExport(latex: string, style: DelimiterStyle): string {
  const clean = latex.trim();
  if (!clean) return '';
  switch (style) {
    case 'none':
      return clean;
    case 'inline':
      return `$${clean}$`;
    case 'block':
      return `$$\n${clean}\n$$`;
    case 'codeblock':
      return `\`\`\`latex\n${clean}\n\`\`\``;
  }
}

export interface InteractiveRenderOptions {
  focused?: boolean;
  showJumpTargets?: boolean;
}

/**
 * Mark which character indices inside a slot belong to a recognized math function
 * (like `sin`, `cos`, `ln`) so interactive KaTeX renders them upright while keeping
 * every character individually clickable.
 */
function findFunctionCharIndices(children: MathNode[]): Set<number> {
  const upright = new Set<number>();
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (node.type === 'char' && /^[A-Za-z]$/.test(node.value)) {
      const start = i;
      let word = '';
      while (
        i < children.length &&
        children[i].type === 'char' &&
        /^[A-Za-z]$/.test((children[i] as { value: string }).value)
      ) {
        word += (children[i] as { value: string }).value;
        i += 1;
      }
      if (MATH_FUNCTIONS.has(word)) {
        for (let k = start; k < i; k += 1) upright.add(k);
      }
    } else {
      i += 1;
    }
  }
  return upright;
}

function wrapCaret(): string {
  return '\\htmlClass{ms-caret-anchor}{}';
}

function emitSlotInteractive(
  slot: SlotNode,
  cursor: Cursor,
  selection: Selection | null,
  isRoot: boolean,
  focused: boolean,
): string {
  const isActive = cursor.slotId === slot.id;
  const isEmpty = slot.children.length === 0;
  const selForSlot = selection && selection.slotId === slot.id ? selection : null;

  const slotClasses = ['ms-slot'];
  if (isRoot) slotClasses.push('ms-slot-root');
  if (isActive && focused) slotClasses.push('ms-slot-active');
  if (isEmpty && !isRoot) slotClasses.push('ms-slot-empty');

  if (isEmpty) {
    const caret = isActive && focused ? wrapCaret() : '';
    if (isRoot) {
      return `\\htmlData{slot-id=${slot.id}}{\\htmlClass{${slotClasses.join(' ')}}{${caret}\\htmlClass{ms-empty-root}{\\phantom{x}}}}`;
    }
    const emptyBox = isActive && focused
      ? `${caret}\\htmlClass{ms-empty-box ms-empty-box-active}{\\square}`
      : '\\htmlClass{ms-empty-box}{\\square}';
    return `\\htmlData{slot-id=${slot.id}}{\\htmlClass{${slotClasses.join(' ')}}{${emptyBox}}}`;
  }

  const uprightChars = findFunctionCharIndices(slot.children);
  const parts: string[] = [];

  for (let idx = 0; idx < slot.children.length; idx += 1) {
    if (isActive && focused && cursor.offset === idx && !selForSlot) {
      parts.push(wrapCaret());
    }
    const child = slot.children[idx];
    const isSelected = selForSlot !== null && idx >= selForSlot.start && idx < selForSlot.end;
    const atomLatex = emitNodeInteractive(child, cursor, selection, focused, uprightChars.has(idx));
    const atomClasses = isSelected ? 'ms-atom ms-selected' : 'ms-atom';
    parts.push(
      `\\htmlData{atom-slot=${slot.id},offset=${idx}}{\\htmlClass{${atomClasses}}{${atomLatex}}}`,
    );
  }

  if (isActive && focused && cursor.offset === slot.children.length && !selForSlot) {
    parts.push(wrapCaret());
  }

  const inner = parts.join('');
  return `\\htmlData{slot-id=${slot.id}}{\\htmlClass{${slotClasses.join(' ')}}{${inner}}}`;
}

function emitNodeInteractive(
  node: MathNode,
  cursor: Cursor,
  selection: Selection | null,
  focused: boolean,
  isUprightFuncChar: boolean,
): string {
  switch (node.type) {
    case 'char': {
      if (node.value === ' ') {
        return '\\,';
      }
      const escaped = escapeCharLatex(node.value);
      return isUprightFuncChar ? `\\mathrm{${escaped}}` : escaped;
    }
    case 'symbol':
      return node.latex;
    case 'raw':
      return node.latex;
    case 'struct': {
      const template = node.customLatex ?? COMMANDS_BY_ID.get(node.commandId)?.latex;
      if (!template) {
        return node.slots
          .map((s) => emitSlotInteractive(s, cursor, selection, false, focused))
          .join(' ');
      }
      return template.replace(/\$(\d+)/g, (_, idxStr: string) => {
        const idx = Number(idxStr) - 1;
        const slot = node.slots[idx];
        return slot ? emitSlotInteractive(slot, cursor, selection, false, focused) : '';
      });
    }
  }
}

export function toInteractiveLatex(
  doc: Document,
  cursor: Cursor,
  selection: Selection | null,
  options: InteractiveRenderOptions = {},
): string {
  const focused = options.focused ?? true;
  const hasLineBreak = doc.root.children.some(
    (n) => n.type === 'raw' && n.latex.trim() === '\\\\',
  );
  if (!hasLineBreak) {
    return emitSlotInteractive(doc.root, cursor, selection, true, focused);
  }

  // Split root children on `\\` RawNodes so each line renders cleanly inside gathered
  const lines: { children: MathNode[]; startOffset: number }[] = [];
  let current: MathNode[] = [];
  let startOffset = 0;

  for (let i = 0; i < doc.root.children.length; i += 1) {
    const child = doc.root.children[i];
    if (child.type === 'raw' && child.latex.trim() === '\\\\') {
      lines.push({ children: current, startOffset });
      current = [];
      startOffset = i + 1;
    } else {
      current.push(child);
    }
  }
  lines.push({ children: current, startOffset });

  const renderedLines = lines.map((line) => {
    const parts: string[] = [];
    const isActive = cursor.slotId === doc.root.id;
    const selForSlot = selection && selection.slotId === doc.root.id ? selection : null;
    const uprightChars = findFunctionCharIndices(line.children);

    for (let localIdx = 0; localIdx < line.children.length; localIdx += 1) {
      const globalIdx = line.startOffset + localIdx;
      if (isActive && focused && cursor.offset === globalIdx && !selForSlot) {
        parts.push(wrapCaret());
      }
      const child = line.children[localIdx];
      const isSelected =
        selForSlot !== null && globalIdx >= selForSlot.start && globalIdx < selForSlot.end;
      const atomLatex = emitNodeInteractive(
        child,
        cursor,
        selection,
        focused,
        uprightChars.has(localIdx),
      );
      const atomClasses = isSelected ? 'ms-atom ms-selected' : 'ms-atom';
      parts.push(
        `\\htmlData{atom-slot=${doc.root.id},offset=${globalIdx}}{\\htmlClass{${atomClasses}}{${atomLatex}}}`,
      );
    }
    const endGlobalIdx = line.startOffset + line.children.length;
    if (isActive && focused && cursor.offset === endGlobalIdx && !selForSlot) {
      parts.push(wrapCaret());
    }
    return parts.length > 0 ? parts.join('') : '\\phantom{x}';
  });

  return `\\begin{gathered} ${renderedLines.join(' \\\\ ')} \\end{gathered}`;
}

/**
 * Generates a clean preview LaTeX string for a CommandDef in the command palette,
 * replacing `$1`, `$2` placeholders with tasteful typographic placeholders.
 */
export function commandPreviewLatex(latexTemplate: string): string {
  const placeholders = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  return latexTemplate.replace(/\$(\d+)/g, (_, idxStr: string) => {
    const idx = Number(idxStr) - 1;
    return placeholders[idx] ?? 'x';
  });
}

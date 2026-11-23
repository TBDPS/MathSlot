import { findSlotPath } from './ast';
import { COMMANDS_BY_ID } from './catalog';
import type {
  Cursor,
  DelimiterStyle,
  Document,
  MathNode,
  Selection,
  SlotNode,
  StructNode,
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

const BINARY_RELATION_SYMBOLS = new Set([
  'to',
  'pm',
  'mp',
  'times',
  'cdot',
  'in',
  'notin',
  'subseteq',
  'subset',
  'equiv',
  'approx',
  'sim',
  'propto',
  'implies',
  'iff',
  'mapsto',
  'cong',
  'll',
  'gg',
  'simeq',
  'leq',
  'geq',
  'neq',
  'cup',
  'cap',
  'land',
  'lor',
  'setminus',
  'parallel',
  'perp',
]);

const SELF_DELIMITED_STRUCTS = new Set([
  'paren',
  'abs',
  'bracket',
  'brace',
  'norm',
  'angle',
  'floor',
  'ceil',
  'hat',
  'bar',
  'vec',
  'tilde',
  'dot',
  'ddot',
  'overline',
  'underline',
]);

const PREFIX_BIGOPS = new Set([
  'integral',
  'indef_integral',
  'sum',
  'product',
  'limit',
  'double_integral',
  'triple_integral',
  'contour_integral',
]);

const INTEGRAL_OPS = new Set([
  'integral',
  'indef_integral',
  'double_integral',
  'triple_integral',
  'contour_integral',
]);

type SpacingLevel = 'display' | 'tight';

function isTightSlot(commandId: string, slotIndex: number): boolean {
  if ((commandId === 'sup' || commandId === 'sub') && slotIndex === 1) return true;
  if (commandId === 'subsup' && (slotIndex === 1 || slotIndex === 2)) return true;
  if (
    (commandId === 'integral' || commandId === 'sum' || commandId === 'product' || commandId === 'limit') &&
    (slotIndex === 0 || slotIndex === 1)
  ) {
    return true;
  }
  if (
    (commandId === 'double_integral' || commandId === 'triple_integral' || commandId === 'contour_integral') &&
    slotIndex === 0
  ) {
    return true;
  }
  if (commandId === 'nth_root' && slotIndex === 0) return true;
  if (commandId === 'eval_bar' && (slotIndex === 1 || slotIndex === 2)) return true;
  return false;
}

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

type TokenKind =
  | 'atom'
  | 'func'
  | 'bigop'
  | 'open'
  | 'close'
  | 'binop'
  | 'comma'
  | 'struct'
  | 'raw'
  | 'space';

interface EmitToken {
  text: string;
  kind: TokenKind;
  structCmdId?: string;
  isIntegral?: boolean;
}

function isUnaryContext(prev: EmitToken | undefined): boolean {
  if (!prev) return true;
  return prev.kind === 'open' || prev.kind === 'binop' || prev.kind === 'comma' || prev.kind === 'bigop';
}

function findLastNonSpace(tokens: readonly EmitToken[]): EmitToken | undefined {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (tokens[i].kind !== 'space') return tokens[i];
  }
  return undefined;
}

function tokenizeSlotForCanonical(slot: SlotNode, level: SpacingLevel): EmitToken[] {
  const tokens: EmitToken[] = [];
  const children = slot.children;
  let i = 0;

  while (i < children.length) {
    const node = children[i];

    if (node.type === 'char') {
      if (node.value === ' ') {
        if (tokens.length > 0 && tokens[tokens.length - 1].kind !== 'space') {
          tokens.push({ text: ' ', kind: 'space' });
        }
        i += 1;
        continue;
      }

      if (/^[A-Za-z]$/.test(node.value)) {
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
          tokens.push({ text: `\\${word}`, kind: 'func' });
        } else {
          tokens.push({ text: word, kind: 'atom' });
        }
        continue;
      }

      if (node.value === '=' || node.value === '<' || node.value === '>') {
        tokens.push({ text: node.value, kind: 'binop' });
        i += 1;
        continue;
      }

      if (node.value === '+' || node.value === '-') {
        const lastNonSpace = findLastNonSpace(tokens);
        const unary = isUnaryContext(lastNonSpace);
        tokens.push({ text: node.value, kind: unary ? 'atom' : 'binop' });
        i += 1;
        continue;
      }

      if (node.value === ',') {
        tokens.push({ text: ',', kind: 'comma' });
        i += 1;
        continue;
      }

      if (node.value === '(' || node.value === '[') {
        tokens.push({ text: node.value, kind: 'open' });
        i += 1;
        continue;
      }

      if (node.value === ')' || node.value === ']') {
        tokens.push({ text: node.value, kind: 'close' });
        i += 1;
        continue;
      }

      tokens.push({ text: escapeCharLatex(node.value), kind: 'atom' });
      i += 1;
      continue;
    }

    if (node.type === 'symbol') {
      if (INTEGRAL_OPS.has(node.commandId)) {
        tokens.push({
          text: node.latex,
          kind: 'bigop',
          structCmdId: node.commandId,
          isIntegral: true,
        });
        i += 1;
        continue;
      }
      const isBin = BINARY_RELATION_SYMBOLS.has(node.commandId);
      const lastNonSpace = findLastNonSpace(tokens);
      const unary = isUnaryContext(lastNonSpace);
      tokens.push({
        text: node.latex,
        kind: isBin && !unary ? 'binop' : 'atom',
      });
      i += 1;
      continue;
    }

    if (node.type === 'raw') {
      tokens.push({ text: node.latex, kind: 'raw' });
      i += 1;
      continue;
    }

    // StructNode
    const isBigOp = PREFIX_BIGOPS.has(node.commandId);
    tokens.push({
      text: emitStructCanonical(node, level),
      kind: isBigOp ? 'bigop' : 'struct',
      structCmdId: node.commandId,
      isIntegral: INTEGRAL_OPS.has(node.commandId),
    });
    i += 1;
  }

  return tokens;
}

function endsWithMacroName(s: string): boolean {
  return /\\[a-zA-Z]+$/.test(s);
}

function startsWithAsciiLetter(s: string): boolean {
  return /^[a-zA-Z]/.test(s);
}

function isDifferentialWord(text: string): boolean {
  return /^d[a-zA-Z]$/.test(text);
}

function emitSlotCanonical(slot: SlotNode, level: SpacingLevel = 'display'): string {
  const rawTokens = tokenizeSlotForCanonical(slot, level);
  const tokens: EmitToken[] = [];

  for (let i = 0; i < rawTokens.length; i += 1) {
    const t = rawTokens[i];
    if (t.kind === 'space') {
      const prev = tokens[tokens.length - 1];
      const next = rawTokens[i + 1];
      if (!prev || !next) continue;
      if (
        prev.kind === 'binop' ||
        next.kind === 'binop' ||
        prev.kind === 'open' ||
        next.kind === 'close' ||
        prev.kind === 'comma' ||
        next.kind === 'comma' ||
        prev.kind === 'bigop' ||
        next.kind === 'bigop' ||
        prev.kind === 'space'
      ) {
        continue;
      }
      tokens.push(t);
    } else {
      tokens.push(t);
    }
  }

  let out = '';
  let inIntegralScope = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : undefined;
    const next = tokens[i + 1];

    if (t.kind === 'space') {
      // Check if space precedes an integral differential (`dx`, `dt`, `d\theta`, `\mathrm{d}x`)
      if (
        inIntegralScope &&
        level === 'display' &&
        next &&
        ((next.kind === 'atom' && isDifferentialWord(next.text)) ||
          (next.kind === 'atom' && next.text === 'd' && tokens[i + 2] && (tokens[i + 2].kind === 'atom' || tokens[i + 2].kind === 'struct')) ||
          (next.kind === 'raw' && next.text === '\\mathrm{d}'))
      ) {
        out += '\\,';
      } else if (out.length > 0 && !out.endsWith(' ')) {
        out += ' ';
      }
      continue;
    }

    if (t.kind === 'bigop') {
      if (t.isIntegral) inIntegralScope = true;
      // Clean space before bigop if preceded by factor like `\frac{1}{2l} \int_{-l}^{l}`
      if (
        out.length > 0 &&
        !out.endsWith(' ') &&
        !out.endsWith('(') &&
        !out.endsWith('[') &&
        !out.endsWith('-') &&
        !out.endsWith('+')
      ) {
        out += ' ';
      }
      out += t.text;
      // Clean space after bigop before integrand/summand
      if (next && next.kind !== 'close' && next.kind !== 'comma' && next.kind !== 'binop') {
        out += ' ';
      }
      continue;
    }

    if (t.kind === 'binop') {
      if (t.text === '=' || t.text === '+' || t.text === '-' || t.text === '\\sim' || t.text === '\\le' || t.text === '\\ge') {
        inIntegralScope = false;
      }
      if (level === 'display') {
        if (out.length > 0 && !out.endsWith(' ')) out += ' ';
        out += t.text;
        if (next && next.kind !== 'close' && next.kind !== 'comma') {
          out += ' ';
        }
      } else {
        if (out.length > 0 && endsWithMacroName(out) && startsWithAsciiLetter(t.text)) {
          out += ' ';
        }
        out += t.text;
        if (next && endsWithMacroName(t.text) && startsWithAsciiLetter(next.text)) {
          out += ' ';
        }
      }
      continue;
    }

    if (t.kind === 'comma') {
      inIntegralScope = false;
      out += ',';
      if (level === 'display' && next && next.kind !== 'close') {
        out += ' ';
      }
      continue;
    }

    if (t.kind === 'func') {
      if (
        prev &&
        prev.kind !== 'space' &&
        prev.kind !== 'binop' &&
        prev.kind !== 'open' &&
        prev.kind !== 'comma' &&
        prev.kind !== 'bigop' &&
        !out.endsWith(' ') &&
        !out.endsWith('-') &&
        !out.endsWith('+')
      ) {
        out += ' ';
      }
      out += t.text;
      if (
        next &&
        next.kind !== 'space' &&
        next.kind !== 'open' &&
        next.kind !== 'close' &&
        next.kind !== 'binop' &&
        next.kind !== 'comma' &&
        next.structCmdId !== 'paren'
      ) {
        out += ' ';
      }
      continue;
    }

    // Publication-grade upright differential `\,\mathrm{d}x` inside integrals!
    if (inIntegralScope && level === 'display') {
      if (t.kind === 'atom' && isDifferentialWord(t.text)) {
        const variable = t.text.slice(1);
        if (out.length > 0 && !out.endsWith('\\,') && !out.endsWith(' ')) {
          out += '\\,';
        } else if (out.endsWith(' ')) {
          out = out.slice(0, -1) + '\\,';
        }
        out += `\\mathrm{d}${variable}`;
        inIntegralScope = false;
        continue;
      }
      if (t.kind === 'atom' && t.text === 'd' && next && (next.kind === 'atom' || next.kind === 'struct')) {
        if (out.length > 0 && !out.endsWith('\\,') && !out.endsWith(' ')) {
          out += '\\,';
        } else if (out.endsWith(' ')) {
          out = out.slice(0, -1) + '\\,';
        }
        out += '\\mathrm{d}';
        inIntegralScope = false;
        continue;
      }
      if (t.kind === 'raw' && t.text === '\\mathrm{d}') {
        if (out.length > 0 && !out.endsWith('\\,') && !out.endsWith(' ')) {
          out += '\\,';
        } else if (out.endsWith(' ')) {
          out = out.slice(0, -1) + '\\,';
        }
        out += '\\mathrm{d}';
        inIntegralScope = false;
        continue;
      }
    }

    if (out.length > 0 && !out.endsWith(' ') && endsWithMacroName(out) && startsWithAsciiLetter(t.text)) {
      out += ' ';
    }

    out += t.text;
  }

  return out.replace(/ {2,}/g, ' ').trim();
}

function formatScriptBase(slot: SlotNode, level: SpacingLevel): string {
  const inner = emitSlotCanonical(slot, level);
  if (!inner) return '{}';
  if (slot.children.length === 1) {
    const only = slot.children[0];
    if (only.type === 'char' && /^[A-Za-z0-9]$/.test(only.value)) {
      return inner;
    }
    if (only.type === 'symbol') {
      return inner;
    }
    if (only.type === 'struct' && SELF_DELIMITED_STRUCTS.has(only.commandId)) {
      return inner;
    }
    if (only.type === 'raw' && /^\\[a-zA-Z]+\{[^}]*\}$/.test(only.latex)) {
      return inner;
    }
  }
  return `{${inner}}`;
}

function formatScriptArg(slot: SlotNode): string {
  const inner = emitSlotCanonical(slot, 'tight');
  if (!inner) return '{}';
  if (/^[A-Za-z0-9]$/.test(inner)) {
    return inner;
  }
  return `{${inner}}`;
}

function emitStructCanonical(node: StructNode, parentLevel: SpacingLevel): string {
  if (!node.customLatex) {
    if (node.commandId === 'sup' && node.slots.length === 2) {
      return `${formatScriptBase(node.slots[0], parentLevel)}^${formatScriptArg(node.slots[1])}`;
    }
    if (node.commandId === 'sub' && node.slots.length === 2) {
      return `${formatScriptBase(node.slots[0], parentLevel)}_${formatScriptArg(node.slots[1])}`;
    }
    if (node.commandId === 'subsup' && node.slots.length === 3) {
      return `${formatScriptBase(node.slots[0], parentLevel)}_${formatScriptArg(node.slots[1])}^${formatScriptArg(node.slots[2])}`;
    }
  }

  const template = node.customLatex ?? COMMANDS_BY_ID.get(node.commandId)?.latex;
  if (!template) {
    return node.slots.map((s) => emitSlotCanonical(s, parentLevel)).join(' ');
  }

  return template.replace(/\$(\d+)/g, (_, idxStr: string) => {
    const idx = Number(idxStr) - 1;
    const slot = node.slots[idx];
    if (!slot) return '';
    const slotLevel: SpacingLevel = isTightSlot(node.commandId, idx) ? 'tight' : 'display';
    return emitSlotCanonical(slot, slotLevel);
  });
}

export function emitNodeCanonical(node: MathNode): string {
  switch (node.type) {
    case 'char':
      return escapeCharLatex(node.value);
    case 'symbol':
      return node.latex;
    case 'raw':
      return node.latex;
    case 'struct':
      return emitStructCanonical(node, 'display');
  }
}

export function emitNodesCanonical(nodes: MathNode[]): string {
  return emitSlotCanonical({ id: '_tmp', label: '', children: nodes }, 'display');
}

export function toLatex(doc: Document): string {
  const hasLineBreak = doc.root.children.some(
    (n) => n.type === 'raw' && n.latex.trim() === '\\\\',
  );
  const inner = emitSlotCanonical(doc.root, 'display');
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

interface InteractiveHints {
  upright: Set<number>;
  funcStarts: Set<number>;
  funcEnds: Set<number>;
  diffStarts: Set<number>;
}

function analyzeInteractiveHints(children: MathNode[]): InteractiveHints {
  const upright = new Set<number>();
  const funcStarts = new Set<number>();
  const funcEnds = new Set<number>();
  const diffStarts = new Set<number>();

  let hasIntegral = false;
  let i = 0;

  while (i < children.length) {
    const node = children[i];
    if (
      (node.type === 'struct' && INTEGRAL_OPS.has(node.commandId)) ||
      (node.type === 'symbol' && INTEGRAL_OPS.has(node.commandId))
    ) {
      hasIntegral = true;
      i += 1;
      continue;
    }
    if (node.type === 'char' && (node.value === '=' || node.value === '+' || node.value === ',')) {
      hasIntegral = false;
      i += 1;
      continue;
    }
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
        funcStarts.add(start);
        funcEnds.add(i - 1);
        for (let k = start; k < i; k += 1) upright.add(k);
      } else if (hasIntegral && (isDifferentialWord(word) || (word === 'd' && i < children.length))) {
        // Upright roman `d` with thin space before differential!
        upright.add(start);
        diffStarts.add(start);
        hasIntegral = false;
      }
    } else {
      i += 1;
    }
  }
  return { upright, funcStarts, funcEnds, diffStarts };
}

function wrapCaret(): string {
  return '\\htmlClass{ms-caret-anchor}{}';
}

function emitSlotInteractive(
  slot: SlotNode,
  cursor: Cursor,
  selection: Selection | null,
  parentStructId: string | null,
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
    const emptyBox =
      isActive && focused
        ? `${caret}\\htmlClass{ms-empty-box ms-empty-box-active}{\\square}`
        : '\\htmlClass{ms-empty-box}{\\square}';
    return `\\htmlData{slot-id=${slot.id}}{\\htmlClass{${slotClasses.join(' ')}}{${emptyBox}}}`;
  }

  const hints = analyzeInteractiveHints(slot.children);
  const parts: string[] = [];

  for (let idx = 0; idx < slot.children.length; idx += 1) {
    if (isActive && focused && cursor.offset === idx && !selForSlot) {
      parts.push(wrapCaret());
    }
    const child = slot.children[idx];
    const prev = idx > 0 ? slot.children[idx - 1] : undefined;
    const next = idx + 1 < slot.children.length ? slot.children[idx + 1] : undefined;

    // Thin space before upright differential `\,\mathrm{d}x`
    if (hints.diffStarts.has(idx) && prev) {
      parts.push('\\,');
    }

    // Crisp visual operator gap before math function (`a_n \cos`, `) \cos`)
    if (
      hints.funcStarts.has(idx) &&
      prev &&
      (prev.type === 'struct' ||
        prev.type === 'symbol' ||
        (prev.type === 'char' && /[A-Za-z0-9)]/.test(prev.value)))
    ) {
      parts.push('\\,');
    }

    // Thin gap before prefix bigop after factor (`\frac{1}{2l} \int`)
    if (
      ((child.type === 'struct' && PREFIX_BIGOPS.has(child.commandId)) ||
        (child.type === 'symbol' && INTEGRAL_OPS.has(child.commandId))) &&
      prev &&
      (prev.type === 'struct' || (prev.type === 'char' && /[A-Za-z0-9)]/.test(prev.value)))
    ) {
      parts.push('\\,');
    }

    const isSelected = selForSlot !== null && idx >= selForSlot.start && idx < selForSlot.end;
    const atomLatex = emitNodeInteractive(
      child,
      cursor,
      selection,
      parentStructId,
      focused,
      hints.upright.has(idx),
    );
    const atomClasses = isSelected ? 'ms-atom ms-selected' : 'ms-atom';
    parts.push(
      `\\htmlData{atom-slot=${slot.id},offset=${idx}}{\\htmlClass{${atomClasses}}{${atomLatex}}}`,
    );

    // Crisp visual gap after math function (`\cos \frac{...}`, `\sin x`)
    if (
      hints.funcEnds.has(idx) &&
      next &&
      (next.type === 'struct' ||
        next.type === 'symbol' ||
        (next.type === 'char' && /[A-Za-z0-9]/.test(next.value)))
    ) {
      if (!(next.type === 'struct' && next.commandId === 'paren')) {
        parts.push('\\,');
      }
    }

    // Crisp visual gap after prefix bigop (`\int_{-l}^{l} f(x)`, `\sum_{n=1}^{\infty} [...]`)
    if (
      ((child.type === 'struct' && PREFIX_BIGOPS.has(child.commandId)) ||
        (child.type === 'symbol' && INTEGRAL_OPS.has(child.commandId))) &&
      next
    ) {
      parts.push('\\,');
    }
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
  parentStructId: string | null,
  focused: boolean,
  isUprightChar: boolean,
): string {
  switch (node.type) {
    case 'char': {
      // Ordinary space in TeX math mode is a zero-width separator (not a giant visible gap!)
      if (node.value === ' ') {
        return '';
      }
      const escaped = escapeCharLatex(node.value);
      return isUprightChar ? `\\mathrm{${escaped}}` : escaped;
    }
    case 'symbol':
      return node.latex;
    case 'raw':
      return node.latex;
    case 'struct': {
      const template = node.customLatex ?? COMMANDS_BY_ID.get(node.commandId)?.latex;
      let rendered: string;
      if (!template) {
        rendered = node.slots
          .map((s) => emitSlotInteractive(s, cursor, selection, parentStructId, false, focused))
          .join(' ');
      } else {
        rendered = template.replace(/\$(\d+)/g, (_, idxStr: string) => {
          const idx = Number(idxStr) - 1;
          const slot = node.slots[idx];
          return slot
            ? emitSlotInteractive(slot, cursor, selection, parentStructId, false, focused)
            : '';
        });
      }
      if (focused && parentStructId && node.id === parentStructId) {
        return `\\htmlClass{ms-parent-struct}{${rendered}}`;
      }
      return rendered;
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
  const path = findSlotPath(doc.root, cursor.slotId);
  const parentStructId =
    path && path.length > 1 ? (path[path.length - 1].parentStruct?.id ?? null) : null;

  const hasLineBreak = doc.root.children.some(
    (n) => n.type === 'raw' && n.latex.trim() === '\\\\',
  );
  if (!hasLineBreak) {
    return emitSlotInteractive(doc.root, cursor, selection, parentStructId, true, focused);
  }

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
    const hints = analyzeInteractiveHints(line.children);

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
        parentStructId,
        focused,
        hints.upright.has(localIdx),
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

export function commandPreviewLatex(latexTemplate: string): string {
  const placeholders = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  return latexTemplate.replace(/\$(\d+)/g, (_, idxStr: string) => {
    const idx = Number(idxStr) - 1;
    return placeholders[idx] ?? 'x';
  });
}

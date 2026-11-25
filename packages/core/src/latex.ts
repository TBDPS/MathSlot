import { findSlotPath, getGridMeta, isOptionalSlot, isSlotVisibleInteractive } from './ast';
import { COMMANDS_BY_ID } from './catalog';
import {
  BINARY_RELATION_SYMBOLS,
  DELIMITER_STRUCT_IDS,
  INTEGRAL_OPS,
  PREFIX_BIGOPS,
  SELF_DELIMITED_STRUCTS,
  TALL_STRUCT_IDS,
  formatGridEnvironment,
  hasCustomColSpec,
  isIntegralBodySlot,
  isTightSlot,
  sanitizeLatexTemplate,
} from './commandSpecs';
import {
  MATH_FUNCTIONS,
  OPERATORNAME_FUNCTIONS,
  analyzeSlotSemantics,
  isGenericDiffWord,
} from './emitIr';
import {
  BARE_WORD_ATOMS,
  BARE_WORD_BINOPS,
} from './shorthands';
import type {
  Cursor,
  DelimiterStyle,
  Document,
  MathNode,
  MathWrapperKind,
  Selection,
  SlotNode,
  StructNode,
} from './types';

export const EXPLICIT_SPACE_MACROS = new Set([
  '\\,',
  '\\:',
  '\\;',
  '\\!',
  '\\ ',
  '\\quad',
  '\\qquad',
]);

export function isLineBreakRaw(node: MathNode): boolean {
  return node.type === 'raw' && /^\\\\(?:\*?\[[^\]]*\])?$/.test(node.latex.trim());
}

type SpacingLevel = 'display' | 'tight';

export interface LatexEmitOptions {
  autoShorthands?: boolean;
}

function slotHasTallContent(slot: SlotNode): boolean {
  for (const child of slot.children) {
    if (child.type === 'symbol' && INTEGRAL_OPS.has(child.commandId)) {
      return true;
    }
    if (child.type === 'struct') {
      if (TALL_STRUCT_IDS.has(child.commandId)) return true;
      if (DELIMITER_STRUCT_IDS.has(child.commandId) && !child.autoSized) return true;
      if (child.slots.some((s) => slotHasTallContent(s))) return true;
    }
  }
  return false;
}

function escapeCharLatex(
  ch: string,
  mode: 'math' | 'text' = 'math',
  autoShorthands = true,
): string {
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
      if (mode === 'text') return '\\textasciitilde{}';
      return autoShorthands ? '\\sim' : '\\text{\\textasciitilde}';
    case '^':
      return mode === 'text' ? '\\textasciicircum{}' : '\\text{\\textasciicircum}';
    case '\\':
      return mode === 'text' ? '\\textbackslash{}' : '\\backslash ';
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
  | 'diff'
  | 'space'
  | 'explicit_space';

interface EmitToken {
  text: string;
  kind: TokenKind;
  structCmdId?: string;
  isIntegral?: boolean;
}

function isUnaryContext(prev: EmitToken | undefined): boolean {
  if (!prev) return true;
  return prev.kind === 'open' || prev.kind === 'binop' || prev.kind === 'comma';
}

function findLastNonSpace(tokens: readonly EmitToken[]): EmitToken | undefined {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (tokens[i].kind !== 'space') return tokens[i];
  }
  return undefined;
}

function needsDiffThinSpaceAfter(prev: EmitToken | undefined): boolean {
  if (!prev) return false;
  return (
    prev.kind === 'atom' ||
    prev.kind === 'close' ||
    prev.kind === 'struct' ||
    prev.kind === 'raw' ||
    prev.kind === 'diff'
  );
}

function tokenizeSlotForCanonical(
  slot: SlotNode,
  level: SpacingLevel,
  autoShorthands: boolean,
): EmitToken[] {
  const tokens: EmitToken[] = [];
  const children = slot.children;
  const ir = analyzeSlotSemantics(children, autoShorthands);
  let i = 0;

  while (i < children.length) {
    const node = children[i];
    const irSpan = ir.spansByStart.get(i);

    if (irSpan) {
      if (irSpan.kind === 'macro_draft') {
        if (irSpan.rawText.length > 0) {
          tokens.push({ text: irSpan.latex, kind: 'raw' });
          i = irSpan.end;
          continue;
        }
      } else if (irSpan.kind === 'func') {
        tokens.push({ text: irSpan.latex, kind: 'func' });
        i = irSpan.end;
        continue;
      } else if (irSpan.kind === 'diff') {
        tokens.push({ text: irSpan.latex, kind: 'diff' });
        i = irSpan.end;
        continue;
      } else if (irSpan.kind === 'binop') {
        const lastNonSpace = findLastNonSpace(tokens);
        const unary = isUnaryContext(lastNonSpace);
        tokens.push({ text: irSpan.latex, kind: unary ? 'atom' : 'binop' });
        i = irSpan.end;
        continue;
      } else if (irSpan.kind === 'symbol_word') {
        tokens.push({ text: irSpan.latex, kind: 'atom' });
        i = irSpan.end;
        continue;
      }
    }

    if (node.type === 'char') {
      if (node.value === ' ') {
        if (tokens.length > 0 && tokens[tokens.length - 1].kind !== 'space') {
          tokens.push({ text: ' ', kind: 'space' });
        }
        i += 1;
        continue;
      }

      if (/^[A-Za-z]$/.test(node.value)) {
        const isVerbatim = Boolean(node.verbatim);
        let word = '';
        while (
          i < children.length &&
          children[i].type === 'char' &&
          Boolean((children[i] as { verbatim?: boolean }).verbatim) === isVerbatim &&
          /^[A-Za-z]$/.test((children[i] as { value: string }).value)
        ) {
          word += (children[i] as { value: string }).value;
          i += 1;
        }
        tokens.push({ text: word, kind: 'atom' });
        continue;
      }

      if (node.value === '=' || node.value === '<' || node.value === '>') {
        tokens.push({ text: node.value, kind: 'binop' });
        i += 1;
        continue;
      }

      if (node.value === '~') {
        if (autoShorthands && !node.verbatim) {
          const lastNonSpace = findLastNonSpace(tokens);
          const unary = isUnaryContext(lastNonSpace);
          tokens.push({ text: '\\sim', kind: unary ? 'atom' : 'binop' });
        } else {
          tokens.push({ text: '\\text{\\textasciitilde}', kind: 'atom' });
        }
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

      tokens.push({
        text: escapeCharLatex(node.value, 'math', autoShorthands && !node.verbatim),
        kind: 'atom',
      });
      i += 1;
      continue;
    }

    if (node.type === 'symbol') {
      if (EXPLICIT_SPACE_MACROS.has(node.latex)) {
        tokens.push({ text: node.latex, kind: 'explicit_space' });
        i += 1;
        continue;
      }
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
      if (EXPLICIT_SPACE_MACROS.has(node.latex)) {
        tokens.push({ text: node.latex, kind: 'explicit_space' });
      } else {
        tokens.push({ text: node.latex, kind: 'raw' });
      }
      i += 1;
      continue;
    }

    // StructNode
    const isBigOp = PREFIX_BIGOPS.has(node.commandId);
    const isFuncStruct = node.commandId === 'operatorname';
    const isDiffStruct = node.commandId === 'diff';
    const isBinOpStruct =
      node.commandId === 'xrightarrow' ||
      node.commandId === 'xleftarrow' ||
      node.commandId === 'pmod';
    tokens.push({
      text: emitStructCanonical(node, level, autoShorthands),
      kind: isBigOp
        ? 'bigop'
        : isDiffStruct
          ? 'diff'
          : isFuncStruct
            ? 'func'
            : isBinOpStruct
              ? 'binop'
              : 'struct',
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

function isSimpleFuncArgParen(node: StructNode): boolean {
  if (!node.autoSized || node.commandId !== 'paren' || node.slots.length !== 1) return false;
  const children = node.slots[0].children;
  if (children.length === 0 || children.length > 6) return false;
  return children.every((c) => c.type === 'char' && /^[A-Za-z0-9,\s]$/.test(c.value));
}

function emitSlotCanonical(
  slot: SlotNode,
  level: SpacingLevel = 'display',
  autoShorthands = true,
  startsInIntegral = false,
): string {
  const rawTokens = tokenizeSlotForCanonical(slot, level, autoShorthands);
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
        prev.kind === 'space' ||
        prev.kind === 'explicit_space' ||
        next.kind === 'explicit_space'
      ) {
        continue;
      }
      tokens.push(t);
    } else {
      tokens.push(t);
    }
  }

  let out = '';
  let inIntegralScope = startsInIntegral;

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : undefined;
    const prevNonSpace = prev?.kind === 'space' ? (i > 1 ? tokens[i - 2] : undefined) : prev;
    const next = tokens[i + 1];

    if (t.kind === 'explicit_space') {
      if (t.text === '\\quad' || t.text === '\\qquad') {
        if (out.length > 0 && !out.endsWith(' ')) out += ' ';
        out += t.text;
        if (
          next &&
          next.kind !== 'close' &&
          next.kind !== 'comma' &&
          next.kind !== 'explicit_space'
        ) {
          out += ' ';
        }
      } else {
        out += t.text;
      }
      continue;
    }

    if (t.kind === 'space') {
      const nextIsDiff =
        next &&
        (next.kind === 'diff' ||
          (inIntegralScope &&
            level === 'display' &&
            ((next.kind === 'atom' && isGenericDiffWord(next.text)) ||
              (next.kind === 'atom' && next.text === 'd' && tokens[i + 2] && (tokens[i + 2].kind === 'atom' || tokens[i + 2].kind === 'struct')) ||
              (next.kind === 'raw' && next.text === '\\mathrm{d}'))));

      if (nextIsDiff && needsDiffThinSpaceAfter(prev)) {
        out += '\\,';
      } else if (out.length > 0 && !out.endsWith(' ')) {
        out += ' ';
      }
      continue;
    }

    if (t.kind === 'bigop') {
      if (t.isIntegral) inIntegralScope = true;
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
      if (next && next.kind !== 'close' && next.kind !== 'comma' && next.kind !== 'binop') {
        out += ' ';
      }
      continue;
    }

    if (t.kind === 'binop') {
      if (
        t.text === '=' ||
        t.text === '+' ||
        t.text === '-' ||
        t.text === '\\sim' ||
        t.text === '\\le' ||
        t.text === '\\ge'
      ) {
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
        next.kind !== 'explicit_space' &&
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

    if (t.kind === 'diff') {
      if (prev?.kind !== 'explicit_space' && needsDiffThinSpaceAfter(prevNonSpace)) {
        if (out.endsWith(' ')) {
          out = out.slice(0, -1) + '\\,';
        } else if (out.length > 0 && !out.endsWith('\\,')) {
          out += '\\,';
        }
      }
      out += t.text;
      inIntegralScope = false;
      continue;
    }

    // Fallback generic integral differential (e.g. `da` or `d\alpha` or `\mathrm{d}x` inside an integral)
    if (inIntegralScope && level === 'display') {
      if (t.kind === 'atom' && isGenericDiffWord(t.text)) {
        const variable = t.text.slice(1);
        if (prev?.kind !== 'explicit_space' && needsDiffThinSpaceAfter(prevNonSpace)) {
          if (out.endsWith(' ')) out = out.slice(0, -1) + '\\,';
          else if (out.length > 0 && !out.endsWith('\\,')) out += '\\,';
        }
        out += `\\mathrm{d}${variable}`;
        inIntegralScope = false;
        continue;
      }
      if (t.kind === 'atom' && t.text === 'd' && next && (next.kind === 'atom' || next.kind === 'struct')) {
        if (prev?.kind !== 'explicit_space' && needsDiffThinSpaceAfter(prevNonSpace)) {
          if (out.endsWith(' ')) out = out.slice(0, -1) + '\\,';
          else if (out.length > 0 && !out.endsWith('\\,')) out += '\\,';
        }
        out += '\\mathrm{d}';
        inIntegralScope = false;
        continue;
      }
      if (t.kind === 'raw' && t.text === '\\mathrm{d}') {
        if (prev?.kind !== 'explicit_space' && needsDiffThinSpaceAfter(prevNonSpace)) {
          if (out.endsWith(' ')) out = out.slice(0, -1) + '\\,';
          else if (out.length > 0 && !out.endsWith('\\,')) out += '\\,';
        }
        out += '\\mathrm{d}';
        inIntegralScope = false;
        continue;
      }
    }

    if (t.structCmdId === 'tag_eq' && out.length > 0 && !out.endsWith(' ')) {
      out += ' ';
    }

    if (out.length > 0 && !out.endsWith(' ') && endsWithMacroName(out) && startsWithAsciiLetter(t.text)) {
      out += ' ';
    }

    out += t.text;

    // Clean readability space after scripted math functions like `\sin^2 x`, `\log_2 x`
    if (
      t.kind === 'struct' &&
      (t.structCmdId === 'sup' || t.structCmdId === 'sub' || t.structCmdId === 'subsup') &&
      next &&
      (next.kind === 'atom' || (next.kind === 'struct' && next.structCmdId !== 'paren')) &&
      /^\\([a-zA-Z]+)[\^_]/.test(t.text) &&
      MATH_FUNCTIONS.has(t.text.match(/^\\([a-zA-Z]+)[\^_]/)![1])
    ) {
      out += ' ';
    }
  }

  return out.replace(/ {2,}/g, ' ').trim();
}

function formatScriptBase(slot: SlotNode, level: SpacingLevel, autoShorthands: boolean): string {
  const inner = emitSlotCanonical(slot, level, autoShorthands);
  if (!inner) return '{}';
  // Single macro token like `\sin` (`\sin^2 x`) or `\pi` (`\pi^2`) needs no outer braces!
  if (/^\\[a-zA-Z]+$/.test(inner)) {
    return inner;
  }
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

function formatScriptArg(slot: SlotNode, autoShorthands: boolean): string {
  const inner = emitSlotCanonical(slot, 'tight', autoShorthands);
  if (!inner) return '{}';
  if (/^[A-Za-z0-9]$/.test(inner)) {
    return inner;
  }
  return `{${inner}}`;
}

function resolveAdaptiveStructTemplate(
  node: StructNode,
  hasSlot: (idx: number) => boolean,
): string | null {
  if (node.customLatex) return null;
  switch (node.commandId) {
    case 'sqrt':
    case 'nth_root':
      if (node.slots.length === 2) {
        return hasSlot(0) ? '\\sqrt[$1]{$2}' : '\\sqrt{$2}';
      }
      return null;
    case 'integral':
    case 'sum':
    case 'product':
    case 'bigcup':
    case 'bigcap':
    case 'coprod':
    case 'bigoplus':
    case 'bigotimes': {
      if (node.slots.length !== 3) return null;
      const macroTable: Record<string, string> = {
        integral: '\\int',
        sum: '\\sum',
        product: '\\prod',
        bigcup: '\\bigcup',
        bigcap: '\\bigcap',
        coprod: '\\coprod',
        bigoplus: '\\bigoplus',
        bigotimes: '\\bigotimes',
      };
      const baseMacro = macroTable[node.commandId] ?? '\\sum';
      const macro = node.limitsMode ? `${baseMacro}\\${node.limitsMode}` : baseMacro;
      const hasLo = hasSlot(0);
      const hasHi = hasSlot(1);
      if (hasLo && hasHi) return `${macro}_{$1}^{$2} $3`;
      if (hasLo) return `${macro}_{$1} $3`;
      if (hasHi) return `${macro}^{$2} $3`;
      return `${macro} $3`;
    }
    case 'nth_partial':
    case 'nth_deriv': {
      if (node.slots.length !== 4) return null;
      const d = node.commandId === 'nth_partial' ? '\\partial' : '\\mathrm{d}';
      const numOrder = hasSlot(0) ? `${d}^{$1}` : d;
      const denOrder = hasSlot(3) ? '$3^{$4}' : '$3';
      return `\\frac{${numOrder} $2}{${d} ${denOrder}}`;
    }
    case 'double_integral':
    case 'contour_integral':
    case 'triple_integral': {
      const baseMacro =
        node.commandId === 'double_integral'
          ? '\\iint'
          : node.commandId === 'contour_integral'
            ? '\\oint'
            : '\\iiint';
      const macro = node.limitsMode ? `${baseMacro}\\${node.limitsMode}` : baseMacro;
      if (node.slots.length === 3) {
        const hasLo = hasSlot(0);
        const hasHi = hasSlot(1);
        if (hasLo && hasHi) return `${macro}_{$1}^{$2} $3`;
        if (hasLo) return `${macro}_{$1} $3`;
        if (hasHi) return `${macro}^{$2} $3`;
        return `${macro} $3`;
      }
      if (node.slots.length === 2) {
        return hasSlot(0) ? `${macro}_{$1} $2` : `${macro} $2`;
      }
      return null;
    }
    case 'limit': {
      if (node.slots.length !== 3) return null;
      const macro = node.limitsMode ? `\\lim\\${node.limitsMode}` : '\\lim';
      const hasVar = hasSlot(0);
      const hasTarget = hasSlot(1);
      if (hasVar && hasTarget) return `${macro}_{$1 \\to $2} $3`;
      if (hasVar) return `${macro}_{$1} $3`;
      if (hasTarget) return `${macro}_{\\to $2} $3`;
      return `${macro} $3`;
    }
    case 'eval_bar': {
      if (node.slots.length !== 3) return null;
      const hasLo = hasSlot(1);
      const hasHi = hasSlot(2);
      if (hasLo && hasHi) return '\\left. $1\\right|_{$2}^{$3}';
      if (hasLo) return '\\left. $1\\right|_{$2}';
      if (hasHi) return '\\left. $1\\right|^{$3}';
      return '\\left. $1\\right|';
    }
    case 'overbrace':
      if (node.slots.length === 2) {
        return hasSlot(1) ? '\\overbrace{$1}^{$2}' : '\\overbrace{$1}';
      }
      return null;
    case 'underbrace':
      if (node.slots.length === 2) {
        return hasSlot(1) ? '\\underbrace{$1}_{$2}' : '\\underbrace{$1}';
      }
      return null;
    case 'xrightarrow':
      if (node.slots.length === 2) {
        return hasSlot(0) ? '\\xrightarrow[$1]{$2}' : '\\xrightarrow{$2}';
      }
      return null;
    case 'xleftarrow':
      if (node.slots.length === 2) {
        return hasSlot(0) ? '\\xleftarrow[$1]{$2}' : '\\xleftarrow{$2}';
      }
      return null;
    case 'diff':
      if (node.slots.length === 2) {
        return hasSlot(0) ? '\\mathrm{d}^{$1}$2' : '\\mathrm{d}$2';
      }
      return null;
    case 'subsup': {
      if (node.slots.length !== 3) return null;
      const hasSub = hasSlot(1);
      const hasSup = hasSlot(2);
      if (hasSub && hasSup) return '{$1}_{$2}^{$3}';
      if (hasSub) return '{$1}_{$2}';
      if (hasSup) return '{$1}^{$3}';
      return '$1';
    }
    default:
      return null;
  }
}

function emitStructCanonical(
  node: StructNode,
  parentLevel: SpacingLevel,
  autoShorthands: boolean,
): string {
  const safeCustomLatex = node.customLatex ? sanitizeLatexTemplate(node.customLatex) : undefined;
  if (!safeCustomLatex) {
    if (node.commandId === 'inline_math' && node.slots.length === 1) {
      return emitSlotCanonical(node.slots[0], parentLevel, autoShorthands);
    }
    if (node.commandId === 'operatorname' && node.slots.length === 1) {
      return `\\operatorname{${emitSlotCanonical(node.slots[0], 'tight', false)}}`;
    }
    if (node.commandId === 'text_box' && node.slots.length === 1) {
      const inner = node.slots[0].children
        .map((ch) => {
          if (ch.type === 'char') {
            if (ch.value === ' ') return ' ';
            return escapeCharLatex(ch.value, 'text', false);
          }
          if (ch.type === 'symbol') return `$${ch.latex}$`;
          if (ch.type === 'raw') return ch.latex;
          if (ch.commandId === 'inline_math' && ch.slots.length === 1) {
            return `$${emitSlotCanonical(ch.slots[0], 'display', autoShorthands)}$`;
          }
          return `$${emitStructCanonical(ch, 'display', autoShorthands)}$`;
        })
        .join('');
      return `\\text{${inner}}`;
    }
    if (node.commandId === 'sup' && node.slots.length === 2) {
      return `${formatScriptBase(node.slots[0], parentLevel, autoShorthands)}^${formatScriptArg(node.slots[1], autoShorthands)}`;
    }
    if (node.commandId === 'sub' && node.slots.length === 2) {
      return `${formatScriptBase(node.slots[0], parentLevel, autoShorthands)}_${formatScriptArg(node.slots[1], autoShorthands)}`;
    }
    if (node.commandId === 'subsup' && node.slots.length === 3) {
      const hasSub = node.slots[1].children.length > 0;
      const hasSup = node.slots[2].children.length > 0;
      if (!hasSub && !hasSup) {
        return emitSlotCanonical(node.slots[0], parentLevel, autoShorthands);
      }
      const base = formatScriptBase(node.slots[0], parentLevel, autoShorthands);
      if (hasSub && hasSup) {
        return `${base}_${formatScriptArg(node.slots[1], autoShorthands)}^${formatScriptArg(node.slots[2], autoShorthands)}`;
      }
      if (hasSub) {
        return `${base}_${formatScriptArg(node.slots[1], autoShorthands)}`;
      }
      return `${base}^${formatScriptArg(node.slots[2], autoShorthands)}`;
    }

    // Dynamic R×C matrix / array / N-row cases emission (preserving colSpec & optional `\\[4pt]` row gaps!)
    if (node.grid) {
      const { env, rows, cols, colSpec, rowGaps } = node.grid;
      const rowStrings: string[] = [];
      for (let r = 0; r < rows; r += 1) {
        const colStrings: string[] = [];
        for (let c = 0; c < cols; c += 1) {
          const slot = node.slots[r * cols + c];
          colStrings.push(
            slot ? emitSlotCanonical(slot, env === 'substack' ? 'tight' : 'display', autoShorthands) : '',
          );
        }
        rowStrings.push(colStrings.join(' & '));
      }
      let joined = '';
      for (let r = 0; r < rowStrings.length; r += 1) {
        joined += rowStrings[r];
        if (r < rowStrings.length - 1) {
          const gap = rowGaps?.[r];
          joined += gap ? ` \\\\[${gap}] ` : ' \\\\ ';
        }
      }
      return formatGridEnvironment(env, colSpec, cols, joined);
    }

    // Smart auto-sizing for keyboard-typed `( )`, `[ ]`, `{ }`:
    // Flat content like `f(x)` emits crisp `(x)`, while tall content like `\frac`/`\int` emits `\left(...\right)`!
    if (node.autoSized && node.slots.length === 1) {
      const inner = emitSlotCanonical(node.slots[0], 'display', autoShorthands);
      const tall = slotHasTallContent(node.slots[0]);
      if (node.commandId === 'paren') {
        return tall ? `\\left(${inner}\\right)` : `(${inner})`;
      }
      if (node.commandId === 'bracket') {
        return tall ? `\\left[${inner}\\right]` : `[${inner}]`;
      }
      if (node.commandId === 'brace') {
        return tall ? `\\left\\{${inner}\\right\\}` : `\\{${inner}\\}`;
      }
      if (node.commandId === 'abs') {
        return tall ? `\\left|${inner}\\right|` : `|${inner}|`;
      }
    }
  }

  const adaptiveTemplate = resolveAdaptiveStructTemplate(
    node,
    (idx) => (node.slots[idx]?.children.length ?? 0) > 0,
  );
  const template =
    safeCustomLatex ?? adaptiveTemplate ?? COMMANDS_BY_ID.get(node.commandId)?.latex;
  if (!template) {
    return node.slots.map((s) => emitSlotCanonical(s, parentLevel, autoShorthands)).join(' ');
  }

  return template
    .replace(/\$(\d+)/g, (_, idxStr: string) => {
      const idx = Number(idxStr) - 1;
      const slot = node.slots[idx];
      if (!slot) return '';
      const slotLevel: SpacingLevel = isTightSlot(node.commandId, idx) ? 'tight' : 'display';
      return emitSlotCanonical(
        slot,
        slotLevel,
        autoShorthands,
        isIntegralBodySlot(node.commandId, idx),
      );
    })
    .replace(/\s+$/, '');
}

export function emitNodeCanonical(node: MathNode, options: LatexEmitOptions = {}): string {
  const autoShorthands = options.autoShorthands ?? true;
  switch (node.type) {
    case 'char':
      return escapeCharLatex(node.value, 'math', autoShorthands && !node.verbatim);
    case 'symbol':
      return node.latex;
    case 'raw':
      return node.latex;
    case 'struct':
      return emitStructCanonical(node, 'display', autoShorthands);
  }
}

export function emitNodesCanonical(nodes: MathNode[], options: LatexEmitOptions = {}): string {
  const autoShorthands = options.autoShorthands ?? true;
  return emitSlotCanonical({ id: '_tmp', label: '', children: nodes }, 'display', autoShorthands);
}

const ALIGN_RELATION_CHARS = new Set(['=', '<', '>', '~']);
const ALIGN_RELATION_SYMBOLS = new Set([
  'leq', 'geq', 'neq', 'equiv', 'approx', 'sim', 'simeq', 'cong', 'propto', 'implies', 'iff', 'to', 'mapsto',
]);

function splitSlotIntoLines(slot: SlotNode): { lines: SlotNode[]; breaks: string[] } {
  const lines: SlotNode[] = [];
  const breaks: string[] = [];
  let cur: MathNode[] = [];
  for (const child of slot.children) {
    if (isLineBreakRaw(child)) {
      lines.push({ id: `${slot.id}_L${lines.length}`, label: slot.label, children: cur });
      breaks.push(child.type === 'raw' ? child.latex.trim() : '\\\\');
      cur = [];
    } else {
      cur.push(child);
    }
  }
  lines.push({ id: `${slot.id}_L${lines.length}`, label: slot.label, children: cur });
  return { lines, breaks };
}

function findFirstRelationIndex(nodes: readonly MathNode[]): number {
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (n.type === 'char' && ALIGN_RELATION_CHARS.has(n.value)) return i;
    if (n.type === 'symbol' && ALIGN_RELATION_SYMBOLS.has(n.commandId)) return i;
  }
  return -1;
}

export function toLatex(doc: Document, options: LatexEmitOptions = {}): string {
  const autoShorthands = options.autoShorthands ?? true;
  const hasLineBreak = doc.root.children.some((n) => isLineBreakRaw(n));
  if (!hasLineBreak) {
    return emitSlotCanonical(doc.root, 'display', autoShorthands);
  }

  // Smart multi-line alignment: if lines contain top-level relations (`=`, `\sim`, `\le`, etc.),
  // emit clean publication-grade `\begin{aligned} lhs &= rhs \\ ... \end{aligned}`!
  const { lines, breaks } = splitSlotIntoLines(doc.root);
  const relIndices = lines.map((line) => findFirstRelationIndex(line.children));
  const useAligned = relIndices.some((idx) => idx >= 0);
  if (useAligned) {
    const formattedLines = lines.map((line, idx) => {
      const rIdx = relIndices[idx];
      if (rIdx < 0) {
        const full = emitSlotCanonical(line, 'display', autoShorthands);
        return full ? `& ${full}` : '';
      }
      const lhs = emitSlotCanonical(
        { id: '_lhs', label: '', children: line.children.slice(0, rIdx) },
        'display',
        autoShorthands,
      );
      const rhs = emitSlotCanonical(
        { id: '_rhs', label: '', children: line.children.slice(rIdx) },
        'display',
        autoShorthands,
      );
      return lhs ? `${lhs} &${rhs}` : `&${rhs}`;
    });
    let joined = '';
    for (let i = 0; i < formattedLines.length; i += 1) {
      joined += formattedLines[i];
      if (i < formattedLines.length - 1) {
        joined += ` ${breaks[i] ?? '\\\\'} `;
      }
    }
    return `\\begin{aligned} ${joined} \\end{aligned}`;
  }

  const inner = emitSlotCanonical(doc.root, 'display', autoShorthands);
  return `\\begin{gathered} ${inner} \\end{gathered}`;
}

export function delimiterToWrapper(style: DelimiterStyle): MathWrapperKind {
  switch (style) {
    case 'none':
      return 'none';
    case 'inline':
      return 'dollar_inline';
    case 'block':
      return 'dollar_block';
    case 'codeblock':
      return 'codeblock';
  }
}

export function formatFormulaWithWrapper(latex: string, wrapper: MathWrapperKind): string {
  const clean = latex.trim();
  if (!clean) return '';
  switch (wrapper) {
    case 'none':
      return clean;
    case 'dollar_inline': {
      const inlineSafe = /\\tag\*?(?![a-zA-Z])/.test(clean)
        ? normalizePreviewLatex(clean, false)
        : clean;
      return `$${inlineSafe}$`;
    }
    case 'paren_inline': {
      const inlineSafe = /\\tag\*?(?![a-zA-Z])/.test(clean)
        ? normalizePreviewLatex(clean, false)
        : clean;
      return `\\(${inlineSafe}\\)`;
    }
    case 'dollar_block':
      return `$$\n${clean}\n$$`;
    case 'bracket_block':
      return `\\[\n${clean}\n\\]`;
    case 'codeblock':
      return `\`\`\`latex\n${clean}\n\`\`\``;
  }
}

/**
 * Normalizes display-only TeX constructs (`\tag{...}`, `\begin{align}`) so inline KaTeX
 * preview cards (`displayMode: false`, e.g. preset library & history lists) render crisply
 * with zero KaTeX errors.
 */
export function normalizePreviewLatex(latex: string, displayMode: boolean): string {
  if (displayMode) return latex;
  return latex
    .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{gather\*?\}/g, '\\begin{gathered}')
    .replace(/\\end\{gather\*?\}/g, '\\end{gathered}')
    .replace(/\\tag\*\{([^}]*)\}/g, '\\quad\\text{$1}')
    .replace(/\\tag\{([^}]*)\}/g, '\\quad\\text{($1)}');
}

export function formatExport(latex: string, style: DelimiterStyle): string {
  return formatFormulaWithWrapper(latex, delimiterToWrapper(style));
}

export interface InteractiveRenderOptions {
  focused?: boolean;
  showJumpTargets?: boolean;
  autoShorthands?: boolean;
}

function isPrevExprForDiff(children: MathNode[], idx: number): boolean {
  let k = idx - 1;
  while (k >= 0 && children[k].type === 'char' && (children[k] as { value: string }).value === ' ') {
    k -= 1;
  }
  if (k < 0) return false;
  const prev = children[k];
  if (prev.type === 'struct') {
    return !PREFIX_BIGOPS.has(prev.commandId);
  }
  if (prev.type === 'symbol') {
    return !INTEGRAL_OPS.has(prev.commandId) && !BINARY_RELATION_SYMBOLS.has(prev.commandId);
  }
  if (prev.type === 'char') {
    return !/^[([\{+\-*/=<>,;|:~\\]$/.test(prev.value);
  }
  return true;
}

function getStructSubtreeHeight(node: StructNode): number {
  let maxChild = -1;
  for (const s of node.slots) {
    for (const c of s.children) {
      if (c.type === 'struct') {
        if (isSimpleFuncArgParen(c)) continue;
        const h = getStructSubtreeHeight(c);
        if (h > maxChild) maxChild = h;
      }
    }
  }
  return maxChild + 1;
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
  autoShorthands: boolean,
  depth: number,
  isOptional = false,
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
    const boxClasses = isActive && focused
      ? isOptional
        ? 'ms-empty-box ms-empty-box-active ms-empty-box-optional'
        : 'ms-empty-box ms-empty-box-active'
      : isOptional
        ? 'ms-empty-box ms-empty-box-optional'
        : 'ms-empty-box';
    const emptyBox =
      isActive && focused
        ? `${caret}\\htmlClass{${boxClasses}}{\\square}`
        : `\\htmlClass{${boxClasses}}{\\square}`;
    return `\\htmlData{slot-id=${slot.id}}{\\htmlClass{${slotClasses.join(' ')}}{${emptyBox}}}`;
  }

  const hints = analyzeSlotSemantics(slot.children, autoShorthands);
  const parts: string[] = [];

  for (let idx = 0; idx < slot.children.length; idx += 1) {
    if (isActive && focused && cursor.offset === idx && !selForSlot) {
      parts.push(wrapCaret());
    }

    const child = slot.children[idx];
    const prev = idx > 0 ? slot.children[idx - 1] : undefined;
    const next = idx + 1 < slot.children.length ? slot.children[idx + 1] : undefined;
    const prevNonSpace = (() => {
      for (let k = idx - 1; k >= 0; k -= 1) {
        const n = slot.children[k];
        if (!(n.type === 'char' && n.value === ' ')) return n;
      }
      return undefined;
    })();
    const nextNonSpace = (() => {
      for (let k = idx + 1; k < slot.children.length; k += 1) {
        const n = slot.children[k];
        if (!(n.type === 'char' && n.value === ' ')) return n;
      }
      return undefined;
    })();

    const irSpan = hints.spansByStart.get(idx);

    // Native LaTeX macro draft (`\`, `\al`, `\alpha`, `\frac`, ...):
    // Render as a crisp monospace inline TeX draft while typing (never `\backslash \alpha`),
    // and render known symbol/function macros cleanly once the caret leaves the span.
    if (irSpan && irSpan.kind === 'macro_draft') {
      const caretTouching =
        isActive && focused && cursor.offset > irSpan.start && cursor.offset <= irSpan.end;
      const selSlicesMacro =
        selForSlot !== null &&
        ((selForSlot.start > irSpan.start && selForSlot.start < irSpan.end) ||
          (selForSlot.end > irSpan.start && selForSlot.end < irSpan.end));
      const knownMacroLatex =
        irSpan.rawText.length > 0
          ? (BARE_WORD_ATOMS[irSpan.rawText] ??
              BARE_WORD_BINOPS[irSpan.rawText] ??
              OPERATORNAME_FUNCTIONS[irSpan.rawText] ??
              (MATH_FUNCTIONS.has(irSpan.rawText) ? `\\${irSpan.rawText}` : undefined))
          : undefined;

      if (!caretTouching && !selSlicesMacro && knownMacroLatex) {
        const isSelected =
          selForSlot !== null &&
          selForSlot.start <= irSpan.start &&
          selForSlot.end >= irSpan.end;
        const atomClasses = isSelected ? 'ms-atom ms-selected' : 'ms-atom';
        const spanLen = irSpan.end - irSpan.start;
        parts.push(
          `\\htmlData{atom-slot=${slot.id},offset=${irSpan.start},span=${spanLen}}{\\htmlClass{${atomClasses}}{${knownMacroLatex}}}`,
        );
        idx = irSpan.end - 1;
        continue;
      }

      for (let k = irSpan.start; k < irSpan.end; k += 1) {
        if (k > irSpan.start && isActive && focused && cursor.offset === k && !selForSlot) {
          parts.push(wrapCaret());
        }
        const mChar = slot.children[k] as { value: string };
        const isSel = selForSlot !== null && k >= selForSlot.start && k < selForSlot.end;
        const cls = isSel ? 'ms-atom ms-macro-draft ms-selected' : 'ms-atom ms-macro-draft';
        const glyph = mChar.value === '\\' ? '\\text{\\texttt{\\textbackslash}}' : `\\text{\\texttt{${mChar.value}}}`;
        parts.push(`\\htmlData{atom-slot=${slot.id},offset=${k}}{\\htmlClass{${cls}}{${glyph}}}`);
      }
      idx = irSpan.end - 1;
      continue;
    }

    // Collapsible bare-word symbol/differential token (e.g. `pi` -> `\pi`, `oo` -> `\infty`, `dx` -> `\mathrm{d}x`)
    // Stays as calm plain letters while the caret is inside OR at the right edge of the word (`n pi|`),
    // and morphs into the math symbol once a boundary/space/operator/slot-jump moves the caret past it!
    if (irSpan && (irSpan.kind === 'diff' || irSpan.kind === 'binop' || irSpan.kind === 'symbol_word')) {
      const caretTouching =
        isActive && focused && cursor.offset > irSpan.start && cursor.offset <= irSpan.end;
      const selSlicesWord =
        selForSlot !== null &&
        ((selForSlot.start > irSpan.start && selForSlot.start < irSpan.end) ||
          (selForSlot.end > irSpan.start && selForSlot.end < irSpan.end));

      if (!caretTouching && !selSlicesWord) {
        if (irSpan.kind === 'diff' && isPrevExprForDiff(slot.children, idx)) {
          parts.push('\\,');
        }
        const isSelected =
          selForSlot !== null && selForSlot.start <= irSpan.start && selForSlot.end >= irSpan.end;
        const atomClasses = isSelected ? 'ms-atom ms-selected' : 'ms-atom';
        const spanLen = irSpan.end - irSpan.start;
        parts.push(
          `\\htmlData{atom-slot=${slot.id},offset=${irSpan.start},span=${spanLen}}{\\htmlClass{${atomClasses}}{${irSpan.latex}}}`,
        );
        idx = irSpan.end - 1;
        continue;
      }
    }

    // A plain typed space is a TOKEN SEPARATOR, not layout. In TeX math mode an ordinary
    // space has no visual width; only `\,`, `\quad`, `\ ` etc. create real spacing.
    // Keep a zero-width hit/caret anchor so the space remains selectable and editable,
    // without making the canvas diverge from the exported LaTeX.
    if (child.type === 'char' && child.value === ' ') {
      const isSelected = selForSlot !== null && idx >= selForSlot.start && idx < selForSlot.end;
      const atomClasses = isSelected
        ? 'ms-atom ms-space-atom ms-selected'
        : 'ms-atom ms-space-atom';
      parts.push(
        `\\htmlData{atom-slot=${slot.id},offset=${idx}}{\\htmlClass{${atomClasses}}{\\kern0pt}}`,
      );
      continue;
    }

    // Thin space before explicit `diff` struct or fallback upright differential `\,\mathrm{d}x`
    if (
      (hints.diffStarts.has(idx) || (child.type === 'struct' && child.commandId === 'diff')) &&
      isPrevExprForDiff(slot.children, idx)
    ) {
      parts.push('\\,');
    }

    // Crisp visual operator gap before math function (`a_n \cos`, `f(x) \cos`, `) \cos`)
    if (
      hints.funcStarts.has(idx) &&
      prevNonSpace &&
      (prevNonSpace.type === 'struct' ||
        prevNonSpace.type === 'symbol' ||
        (prevNonSpace.type === 'char' && /[A-Za-z0-9)]/.test(prevNonSpace.value)))
    ) {
      parts.push('\\,');
    }

    // Thin gap before prefix bigop after factor (`\frac{1}{2l} \int`)
    if (
      ((child.type === 'struct' && PREFIX_BIGOPS.has(child.commandId)) ||
        (child.type === 'symbol' && INTEGRAL_OPS.has(child.commandId))) &&
      prevNonSpace &&
      (prevNonSpace.type === 'struct' ||
        (prevNonSpace.type === 'char' && /[A-Za-z0-9)]/.test(prevNonSpace.value)))
    ) {
      parts.push('\\,');
    }

    // Line breaks `\\` (including `\\[4pt]`) must sit outside `\htmlClass` wrappers so KaTeX breaks lines properly!
    if (isLineBreakRaw(child)) {
      parts.push(` ${(child as { latex: string }).latex.trim()} `);
      continue;
    }

    const isSelected = selForSlot !== null && idx >= selForSlot.start && idx < selForSlot.end;
    const atomLatex = emitNodeInteractive(
      child,
      cursor,
      selection,
      parentStructId,
      focused,
      hints.upright.has(idx),
      autoShorthands,
      depth,
    );
    const atomClasses = isSelected ? 'ms-atom ms-selected' : 'ms-atom';
    parts.push(
      `\\htmlData{atom-slot=${slot.id},offset=${idx}}{\\htmlClass{${atomClasses}}{${atomLatex}}}`,
    );

    // Crisp visual gap after math function (`\cos \frac{...}`, `\sin x`)
    if (
      hints.funcEnds.has(idx) &&
      nextNonSpace &&
      (nextNonSpace.type === 'struct' ||
        nextNonSpace.type === 'symbol' ||
        (nextNonSpace.type === 'char' && /[A-Za-z0-9]/.test(nextNonSpace.value)))
    ) {
      if (!(nextNonSpace.type === 'struct' && nextNonSpace.commandId === 'paren')) {
        parts.push('\\,');
      }
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
  autoShorthands: boolean,
  depth: number,
): string {
  switch (node.type) {
    case 'char': {
      const escaped = escapeCharLatex(node.value, 'math', autoShorthands && !node.verbatim);
      return isUprightChar ? `\\mathrm{${escaped}}` : escaped;
    }
    case 'symbol':
      return node.latex;
    case 'raw':
      return sanitizeLatexTemplate(node.latex)
        .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
        .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
        .replace(/\\tag\*\{([^}]*)\}/g, '\\qquad\\text{$1}')
        .replace(/\\tag\{([^}]*)\}/g, '\\qquad\\text{($1)}');
    case 'struct': {
      const structDepth = depth + 1;
      const structHeight = getStructSubtreeHeight(node);
      const safeCustomLatex = node.customLatex ? sanitizeLatexTemplate(node.customLatex) : undefined;
      const adaptiveTemplate = resolveAdaptiveStructTemplate(node, (idx) =>
        isSlotVisibleInteractive(node, idx, cursor.slotId),
      );
      let template =
        safeCustomLatex ?? adaptiveTemplate ?? COMMANDS_BY_ID.get(node.commandId)?.latex;
      if (!safeCustomLatex && node.commandId === 'tag_eq' && node.slots.length === 1) {
        // Render editable `\tag{...}` safely inside KaTeX interactive canvas (display & multiline safe!)
        template = '\\qquad\\text{(}$1\\text{)}';
      }
      if (!safeCustomLatex && node.autoSized && node.slots.length === 1) {
        const tall = slotHasTallContent(node.slots[0]);
        if (node.commandId === 'paren') {
          template = tall ? '\\left($1\\right)' : '($1)';
        } else if (node.commandId === 'bracket') {
          template = tall ? '\\left[$1\\right]' : '[$1]';
        } else if (node.commandId === 'brace') {
          template = tall ? '\\left\\{$1\\right\\}' : '\\{$1\\}';
        } else if (node.commandId === 'abs') {
          template = tall ? '\\left|$1\\right|' : '|$1|';
        }
      }
      let rendered: string;
      const baseMeta = getGridMeta(node);
      const dynGrid =
        node.grid ??
        (baseMeta &&
        (node.slots.length !== (COMMANDS_BY_ID.get(node.commandId)?.slots.length ?? 0) ||
          hasCustomColSpec(baseMeta.colSpec, baseMeta.cols))
          ? baseMeta
          : null);
      if (node.commandId === 'text_box' && !safeCustomLatex && node.slots.length === 1) {
        const slot = node.slots[0];
        const isActive = cursor.slotId === slot.id;
        const slotClasses = ['ms-slot'];
        if (isActive) slotClasses.push('ms-slot-active');
        if (slot.children.length === 0) slotClasses.push('ms-slot-empty');
        const selForSlot = selection && selection.slotId === slot.id ? selection : null;

        if (slot.children.length === 0) {
          const emptyBox = isActive
            ? '\\htmlClass{ms-empty-box ms-empty-box-active}{\\square}'
            : '\\htmlClass{ms-empty-box}{\\square}';
          const content = isActive && focused ? `${wrapCaret()}${emptyBox}` : emptyBox;
          rendered = `\\htmlData{slot-id=${slot.id}}{\\htmlClass{${slotClasses.join(' ')}}{${content}}}`;
        } else {
          const parts: string[] = [];
          for (let i = 0; i < slot.children.length; i += 1) {
            if (isActive && focused && cursor.offset === i && !selForSlot) {
              parts.push(wrapCaret());
            }
            const ch = slot.children[i];
            let atomLatex: string;
            if (ch.type === 'char') {
              const esc = ch.value === ' ' ? ' ' : escapeCharLatex(ch.value, 'text', false);
              atomLatex = `\\text{${esc}}`;
            } else {
              atomLatex = emitNodeInteractive(
                ch,
                cursor,
                selection,
                node.id,
                focused,
                false,
                autoShorthands,
                structDepth,
              );
            }
            const isSel = selForSlot !== null && i >= selForSlot.start && i < selForSlot.end;
            const cls = isSel ? 'ms-atom ms-selected' : 'ms-atom';
            parts.push(`\\htmlData{atom-slot=${slot.id},offset=${i}}{\\htmlClass{${cls}}{${atomLatex}}}`);
          }
          if (isActive && focused && cursor.offset === slot.children.length && !selForSlot) {
            parts.push(wrapCaret());
          }
          rendered = `\\htmlData{slot-id=${slot.id}}{\\htmlClass{${slotClasses.join(' ')}}{${parts.join('')}}}`;
        }
      } else if (dynGrid) {
        const { env, rows, cols, colSpec, rowGaps } = dynGrid;
        const rowStrings: string[] = [];
        for (let r = 0; r < rows; r += 1) {
          const colStrings: string[] = [];
          for (let c = 0; c < cols; c += 1) {
            const slot = node.slots[r * cols + c];
            colStrings.push(
              slot
                ? emitSlotInteractive(
                    slot,
                    cursor,
                    selection,
                    parentStructId,
                    false,
                    focused,
                    autoShorthands,
                    structDepth,
                  )
                : '',
            );
          }
          rowStrings.push(colStrings.join(' & '));
        }
        let joined = '';
        for (let r = 0; r < rowStrings.length; r += 1) {
          joined += rowStrings[r];
          if (r < rowStrings.length - 1) {
            const gap = rowGaps?.[r];
            joined += gap ? ` \\\\[${gap}] ` : ' \\\\ ';
          }
        }
        rendered = formatGridEnvironment(env, colSpec, cols, joined);
      } else if (!template) {
        rendered = node.slots
          .map((s) =>
            emitSlotInteractive(
              s,
              cursor,
              selection,
              parentStructId,
              false,
              focused,
              autoShorthands,
              structDepth,
            ),
          )
          .join(' ');
      } else {
        rendered = template.replace(/\$(\d+)/g, (_, idxStr: string) => {
          const idx = Number(idxStr) - 1;
          const slot = node.slots[idx];
          if (!slot) return '';
          return emitSlotInteractive(
            slot,
            cursor,
            selection,
            parentStructId,
            false,
            focused,
            autoShorthands,
            structDepth,
            isOptionalSlot(node.commandId, idx),
          );
        });
      }
      const boxFlag = isSimpleFuncArgParen(node) ? '0' : '1';
      return `\\htmlData{struct-id=${node.id},struct-depth=${structDepth},struct-height=${structHeight},struct-cmd=${node.commandId},struct-box=${boxFlag}}{\\htmlClass{ms-struct}{${rendered}}}`;
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
  const autoShorthands = options.autoShorthands ?? true;
  const path = findSlotPath(doc.root, cursor.slotId);
  const parentStructId =
    path && path.length > 1 ? (path[path.length - 1].parentStruct?.id ?? null) : null;

  const hasLineBreak = doc.root.children.some((n) => isLineBreakRaw(n));
  if (!hasLineBreak) {
    return emitSlotInteractive(
      doc.root,
      cursor,
      selection,
      parentStructId,
      true,
      focused,
      autoShorthands,
      0,
    );
  }

  // Render interactive multi-line equations with EXACT same alignment rule as `toLatex`:
  // when lines contain top-level relations (`=`, `\le`, `\sim`, ...), align them inside `\begin{aligned}`
  // so canvas layout matches exported LaTeX 1:1 while keeping every atom clickable and selectable!
  const lineRanges: { start: number; end: number; breakToken?: string }[] = [];
  let lineStart = 0;
  for (let i = 0; i < doc.root.children.length; i += 1) {
    const n = doc.root.children[i];
    if (isLineBreakRaw(n)) {
      lineRanges.push({
        start: lineStart,
        end: i,
        breakToken: n.type === 'raw' ? n.latex.trim() : '\\\\',
      });
      lineStart = i + 1;
    }
  }
  lineRanges.push({ start: lineStart, end: doc.root.children.length });

  const relIndices = lineRanges.map((range) =>
    findFirstRelationIndex(doc.root.children.slice(range.start, range.end)),
  );
  const useAligned = relIndices.some((idx) => idx >= 0);

  const emitRootSlice = (sliceStart: number, sliceEnd: number, includeEndCaret: boolean): string => {
    const subSlot: SlotNode = {
      id: doc.root.id,
      label: doc.root.label,
      children: doc.root.children.slice(sliceStart, sliceEnd),
    };
    const cursorInSlice =
      cursor.slotId === doc.root.id &&
      cursor.offset >= sliceStart &&
      (includeEndCaret ? cursor.offset <= sliceEnd : cursor.offset < sliceEnd);
    const localCursor: Cursor = cursorInSlice
      ? { slotId: doc.root.id, offset: cursor.offset - sliceStart }
      : { slotId: '__none__', offset: 0 };
    const localSel: Selection | null =
      selection && selection.slotId === doc.root.id
        ? {
            slotId: doc.root.id,
            start: Math.max(0, selection.start - sliceStart),
            end: Math.min(subSlot.children.length, selection.end - sliceStart),
          }
        : null;
    const validSel = localSel && localSel.end > localSel.start ? localSel : null;
    const rawSlice = emitSlotInteractive(
      subSlot,
      localCursor,
      validSel,
      parentStructId,
      true,
      focused,
      autoShorthands,
      0,
    );
    if (sliceStart === 0) return rawSlice;
    return rawSlice.replace(
      new RegExp(`atom-slot=${doc.root.id},offset=(\\d+)`, 'g'),
      (_, offStr: string) => `atom-slot=${doc.root.id},offset=${Number(offStr) + sliceStart}`,
    );
  };

  const lineLatexList = lineRanges.map((range, lineIdx) => {
    if (!useAligned) {
      return emitRootSlice(range.start, range.end, true);
    }
    const rIdx = relIndices[lineIdx];
    if (rIdx < 0) {
      return `& ${emitRootSlice(range.start, range.end, true)}`;
    }
    const splitAt = range.start + rIdx;
    const lhsRaw = splitAt > range.start ? emitRootSlice(range.start, splitAt, false) : '';
    const rhsRaw = emitRootSlice(splitAt, range.end, true);
    return lhsRaw ? `${lhsRaw} & ${rhsRaw}` : `& ${rhsRaw}`;
  });

  let joinedInteractive = '';
  for (let i = 0; i < lineLatexList.length; i += 1) {
    joinedInteractive += lineLatexList[i];
    if (i < lineLatexList.length - 1) {
      joinedInteractive += ` ${lineRanges[i].breakToken ?? '\\\\'} `;
    }
  }
  return useAligned
    ? `\\begin{aligned} ${joinedInteractive} \\end{aligned}`
    : `\\begin{gathered} ${joinedInteractive} \\end{gathered}`;
}

export function commandPreviewLatex(template: string): string {
  const safe = sanitizeLatexTemplate(template);
  if (safe === '\\text{$1}') {
    return '\\text{abc}';
  }
  if (safe === '\\tag{$1}') {
    return '\\text{(1)}';
  }
  if (safe === '\\mathrm{$1}') {
    return '\\mathrm{d}';
  }
  if (safe === '\\mathfrak{$1}') {
    return '\\mathfrak{g}';
  }
  if (safe === '\\mathsf{$1}') {
    return '\\mathsf{T}';
  }
  if (safe === '\\mathtt{$1}') {
    return '\\mathtt{x}';
  }
  if (safe === '\\boldsymbol{$1}') {
    return '\\boldsymbol{\\theta}';
  }
  if (safe === '\\mathscr{$1}') {
    return '\\mathscr{F}';
  }
  if (safe === '\\mathbf{$1}') {
    return '\\mathbf{x}';
  }
  if (safe === '\\mathcal{$1}') {
    return '\\mathcal{L}';
  }
  if (safe === '\\mathbb{$1}') {
    return '\\mathbb{E}';
  }
  if (safe === '\\operatorname{$1}') {
    return '\\operatorname{op}';
  }
  if (safe === '\\mathrm{d}^{$1}$2') {
    return '\\mathrm{d}\\square';
  }
  if (safe === '\\left\\{ $1 \\,\\middle|\\, $2 \\right\\}') {
    return '\\left\\{ \\square \\,\\middle|\\, \\square \\right\\}';
  }
  if (safe === '\\substack{$1 \\\\ $2}') {
    return '\\substack{\\square \\\\ \\square}';
  }
  if (safe.includes('\\ddots') && safe.includes('\\begin{pmatrix}')) {
    return '\\begin{pmatrix} \\square & \\cdots & \\square \\\\ \\vdots & \\ddots & \\vdots \\\\ \\square & \\cdots & \\square \\end{pmatrix}';
  }
  if (safe.includes('\\ddots') && safe.includes('\\begin{vmatrix}')) {
    return '\\begin{vmatrix} \\square & \\cdots & \\square \\\\ \\vdots & \\ddots & \\vdots \\\\ \\square & \\cdots & \\square \\end{vmatrix}';
  }
  return safe.replace(/\$(\d+)/g, '\\square');
}

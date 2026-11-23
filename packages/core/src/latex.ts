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
  'sech',
  'csch',
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
  'lcm',
  'dim',
  'ker',
  'deg',
  'arg',
  'Pr',
  'hom',
  'Re',
  'Im',
]);

const OPERATORNAME_FUNCTIONS: Readonly<Record<string, string>> = {
  rank: '\\operatorname{rank}',
  tr: '\\operatorname{tr}',
  span: '\\operatorname{span}',
  diag: '\\operatorname{diag}',
  proj: '\\operatorname{proj}',
  Res: '\\operatorname{Res}',
  Cov: '\\operatorname{Cov}',
};

/**
 * Isolated alphabetic bare-word -> LaTeX macro table (matching v0.8.1's proven word rules).
 * Only matches an ENTIRE contiguous ASCII letter word (bounded by spaces, digits, operators,
 * brackets, or start/end of slot), so `n pi x` -> `n \pi x`, `2pi` -> `2\pi`, `oo` -> `\infty`,
 * while `spin`, `spi`, `pin`, `foo`, `sin` are NEVER corrupted!
 */
export const BARE_WORD_ATOMS: Readonly<Record<string, string>> = {
  // Lowercase Greek (all 24 + standard TeX variants)
  alpha: '\\alpha',
  beta: '\\beta',
  gamma: '\\gamma',
  delta: '\\delta',
  epsilon: '\\varepsilon',
  varepsilon: '\\varepsilon',
  zeta: '\\zeta',
  eta: '\\eta',
  theta: '\\theta',
  vartheta: '\\vartheta',
  iota: '\\iota',
  kappa: '\\kappa',
  varkappa: '\\varkappa',
  lambda: '\\lambda',
  mu: '\\mu',
  nu: '\\nu',
  xi: '\\xi',
  pi: '\\pi',
  varpi: '\\varpi',
  rho: '\\rho',
  varrho: '\\varrho',
  sigma: '\\sigma',
  varsigma: '\\varsigma',
  tau: '\\tau',
  upsilon: '\\upsilon',
  phi: '\\phi',
  varphi: '\\varphi',
  chi: '\\chi',
  psi: '\\psi',
  omega: '\\omega',
  // Uppercase Greek (all 11)
  Gamma: '\\Gamma',
  Delta: '\\Delta',
  Theta: '\\Theta',
  Lambda: '\\Lambda',
  Xi: '\\Xi',
  Pi: '\\Pi',
  Sigma: '\\Sigma',
  Upsilon: '\\Upsilon',
  Phi: '\\Phi',
  Psi: '\\Psi',
  Omega: '\\Omega',
  // Common symbolic words & ISO constants
  oo: '\\infty',
  infty: '\\infty',
  nabla: '\\nabla',
  partial: '\\partial',
  forall: '\\forall',
  exists: '\\exists',
  emptyset: '\\varnothing',
  hbar: '\\hbar',
  ell: '\\ell',
  ldots: '\\ldots',
  cdots: '\\cdots',
  dots: '\\ldots',
  quad: '\\quad',
  qquad: '\\qquad',
  dd: '\\mathrm{d}',
  ee: '\\mathrm{e}',
  ii: '\\mathrm{i}',
};

export const BARE_WORD_BINOPS: Readonly<Record<string, string>> = {
  xx: '\\times',
  times: '\\times',
  cdot: '\\cdot',
  div: '\\div',
  pm: '\\pm',
  mp: '\\mp',
  in: '\\in',
  notin: '\\notin',
  subset: '\\subset',
  subseteq: '\\subseteq',
  supset: '\\supset',
  supseteq: '\\supseteq',
  cup: '\\cup',
  cap: '\\cap',
  to: '\\to',
  rightarrow: '\\to',
  leftarrow: '\\leftarrow',
  approx: '\\approx',
  equiv: '\\equiv',
  sim: '\\sim',
  cong: '\\cong',
  propto: '\\propto',
  leq: '\\le',
  le: '\\le',
  geq: '\\ge',
  ge: '\\ge',
  neq: '\\neq',
  ne: '\\neq',
};

export const DIFFERENTIAL_WORDS: Readonly<Record<string, string>> = {
  dx: '\\mathrm{d}x',
  dt: '\\mathrm{d}t',
  dy: '\\mathrm{d}y',
  dz: '\\mathrm{d}z',
  du: '\\mathrm{d}u',
  dv: '\\mathrm{d}v',
  dr: '\\mathrm{d}r',
  ds: '\\mathrm{d}s',
  dp: '\\mathrm{d}p',
  dq: '\\mathrm{d}q',
  dV: '\\mathrm{d}V',
  dS: '\\mathrm{d}S',
  dtheta: '\\mathrm{d}\\theta',
  dphi: '\\mathrm{d}\\phi',
  dtau: '\\mathrm{d}\\tau',
  domega: '\\mathrm{d}\\omega',
  dxi: '\\mathrm{d}\\xi',
};

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

const TALL_STRUCT_IDS = new Set([
  'frac',
  'partial_frac',
  'total_frac',
  'binom',
  'integral',
  'double_integral',
  'triple_integral',
  'contour_integral',
  'sum',
  'product',
  'limit',
  'sqrt',
  'nth_root',
  'matrix_2x2',
  'matrix_3x3',
  'bmatrix_2x2',
  'bmatrix_3x3',
  'det_2x2',
  'det_3x3',
  'cases_2',
  'cases_3',
  'eval_bar',
  'overbrace',
  'underbrace',
]);

const DELIMITER_STRUCT_IDS = new Set(['paren', 'bracket', 'brace', 'abs', 'norm']);

type SpacingLevel = 'display' | 'tight';

export interface LatexEmitOptions {
  autoShorthands?: boolean;
}

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
      return '\\sim';
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
  | 'diff'
  | 'space';

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
        } else if (OPERATORNAME_FUNCTIONS[word]) {
          tokens.push({ text: OPERATORNAME_FUNCTIONS[word], kind: 'func' });
        } else if (autoShorthands && DIFFERENTIAL_WORDS[word]) {
          tokens.push({ text: DIFFERENTIAL_WORDS[word], kind: 'diff' });
        } else if (autoShorthands && BARE_WORD_BINOPS[word]) {
          const lastNonSpace = findLastNonSpace(tokens);
          const unary = isUnaryContext(lastNonSpace);
          tokens.push({
            text: BARE_WORD_BINOPS[word],
            kind: unary ? 'atom' : 'binop',
          });
        } else if (autoShorthands && BARE_WORD_ATOMS[word]) {
          tokens.push({ text: BARE_WORD_ATOMS[word], kind: 'atom' });
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

      if (node.value === '~') {
        const lastNonSpace = findLastNonSpace(tokens);
        const unary = isUnaryContext(lastNonSpace);
        tokens.push({ text: '\\sim', kind: unary ? 'atom' : 'binop' });
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
      text: emitStructCanonical(node, level, autoShorthands),
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

function isGenericDiffWord(text: string): boolean {
  return /^d[a-zA-Z]$/.test(text);
}

function isIntegralBodySlot(commandId: string, slotIndex: number): boolean {
  if (commandId === 'integral' && slotIndex === 2) return true;
  if (commandId === 'indef_integral' && slotIndex === 0) return true;
  if (
    (commandId === 'double_integral' || commandId === 'triple_integral' || commandId === 'contour_integral') &&
    slotIndex === 1
  ) {
    return true;
  }
  return false;
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
  let inIntegralScope = startsInIntegral;

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : undefined;
    const prevNonSpace = prev?.kind === 'space' ? (i > 1 ? tokens[i - 2] : undefined) : prev;
    const next = tokens[i + 1];

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
      if (needsDiffThinSpaceAfter(prevNonSpace)) {
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
        if (needsDiffThinSpaceAfter(prevNonSpace)) {
          if (out.endsWith(' ')) out = out.slice(0, -1) + '\\,';
          else if (out.length > 0 && !out.endsWith('\\,')) out += '\\,';
        }
        out += `\\mathrm{d}${variable}`;
        inIntegralScope = false;
        continue;
      }
      if (t.kind === 'atom' && t.text === 'd' && next && (next.kind === 'atom' || next.kind === 'struct')) {
        if (needsDiffThinSpaceAfter(prevNonSpace)) {
          if (out.endsWith(' ')) out = out.slice(0, -1) + '\\,';
          else if (out.length > 0 && !out.endsWith('\\,')) out += '\\,';
        }
        out += '\\mathrm{d}';
        inIntegralScope = false;
        continue;
      }
      if (t.kind === 'raw' && t.text === '\\mathrm{d}') {
        if (needsDiffThinSpaceAfter(prevNonSpace)) {
          if (out.endsWith(' ')) out = out.slice(0, -1) + '\\,';
          else if (out.length > 0 && !out.endsWith('\\,')) out += '\\,';
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

function formatScriptBase(slot: SlotNode, level: SpacingLevel, autoShorthands: boolean): string {
  const inner = emitSlotCanonical(slot, level, autoShorthands);
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

function formatScriptArg(slot: SlotNode, autoShorthands: boolean): string {
  const inner = emitSlotCanonical(slot, 'tight', autoShorthands);
  if (!inner) return '{}';
  if (/^[A-Za-z0-9]$/.test(inner)) {
    return inner;
  }
  return `{${inner}}`;
}

function emitStructCanonical(
  node: StructNode,
  parentLevel: SpacingLevel,
  autoShorthands: boolean,
): string {
  if (!node.customLatex) {
    if (node.commandId === 'sup' && node.slots.length === 2) {
      return `${formatScriptBase(node.slots[0], parentLevel, autoShorthands)}^${formatScriptArg(node.slots[1], autoShorthands)}`;
    }
    if (node.commandId === 'sub' && node.slots.length === 2) {
      return `${formatScriptBase(node.slots[0], parentLevel, autoShorthands)}_${formatScriptArg(node.slots[1], autoShorthands)}`;
    }
    if (node.commandId === 'subsup' && node.slots.length === 3) {
      return `${formatScriptBase(node.slots[0], parentLevel, autoShorthands)}_${formatScriptArg(node.slots[1], autoShorthands)}^${formatScriptArg(node.slots[2], autoShorthands)}`;
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
    }
  }

  const template = node.customLatex ?? COMMANDS_BY_ID.get(node.commandId)?.latex;
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
      return escapeCharLatex(node.value);
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

export function toLatex(doc: Document, options: LatexEmitOptions = {}): string {
  const autoShorthands = options.autoShorthands ?? true;
  const hasLineBreak = doc.root.children.some(
    (n) => n.type === 'raw' && n.latex.trim() === '\\\\',
  );
  const inner = emitSlotCanonical(doc.root, 'display', autoShorthands);
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
  autoShorthands?: boolean;
}

interface WordTokenSpan {
  start: number;
  end: number;
  kind: 'func' | 'symbol' | 'binop' | 'diff';
  latex: string;
}

interface InteractiveHints {
  upright: Set<number>;
  funcStarts: Set<number>;
  funcEnds: Set<number>;
  diffStarts: Set<number>;
  wordSpans: Map<number, WordTokenSpan>;
  keywordIndices: Set<number>;
}

function analyzeInteractiveHints(
  children: MathNode[],
  autoShorthands: boolean,
): InteractiveHints {
  const upright = new Set<number>();
  const funcStarts = new Set<number>();
  const funcEnds = new Set<number>();
  const diffStarts = new Set<number>();
  const wordSpans = new Map<number, WordTokenSpan>();
  const keywordIndices = new Set<number>();

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
    if (node.type === 'char' && (node.value === '=' || node.value === '+' || node.value === ',' || node.value === '~')) {
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
      const end = i;

      if (MATH_FUNCTIONS.has(word) || OPERATORNAME_FUNCTIONS[word]) {
        funcStarts.add(start);
        funcEnds.add(end - 1);
        for (let k = start; k < end; k += 1) {
          upright.add(k);
          keywordIndices.add(k);
        }
      } else if (autoShorthands && DIFFERENTIAL_WORDS[word]) {
        diffStarts.add(start);
        wordSpans.set(start, {
          start,
          end,
          kind: 'diff',
          latex: DIFFERENTIAL_WORDS[word],
        });
        for (let k = start; k < end; k += 1) keywordIndices.add(k);
        hasIntegral = false;
      } else if (autoShorthands && BARE_WORD_BINOPS[word]) {
        wordSpans.set(start, {
          start,
          end,
          kind: 'binop',
          latex: BARE_WORD_BINOPS[word],
        });
        for (let k = start; k < end; k += 1) keywordIndices.add(k);
      } else if (autoShorthands && BARE_WORD_ATOMS[word]) {
        wordSpans.set(start, {
          start,
          end,
          kind: 'symbol',
          latex: BARE_WORD_ATOMS[word],
        });
        for (let k = start; k < end; k += 1) keywordIndices.add(k);
      } else if (hasIntegral && (isGenericDiffWord(word) || (word === 'd' && end < children.length))) {
        upright.add(start);
        diffStarts.add(start);
        hasIntegral = false;
      }
    } else {
      i += 1;
    }
  }
  return { upright, funcStarts, funcEnds, diffStarts, wordSpans, keywordIndices };
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

  const hints = analyzeInteractiveHints(slot.children, autoShorthands);
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

    // Collapsible bare-word symbol/differential token (e.g. `pi` -> `\pi`, `oo` -> `\infty`, `dx` -> `\mathrm{d}x`)
    // Renders as crisp math symbol unless the caret or selection is strictly inside the word!
    const wordSpan = hints.wordSpans.get(idx);
    if (wordSpan) {
      const caretInside =
        isActive && focused && cursor.offset > wordSpan.start && cursor.offset < wordSpan.end;
      const selSlicesWord =
        selForSlot !== null &&
        ((selForSlot.start > wordSpan.start && selForSlot.start < wordSpan.end) ||
          (selForSlot.end > wordSpan.start && selForSlot.end < wordSpan.end));

      if (!caretInside && !selSlicesWord) {
        if (wordSpan.kind === 'diff' && isPrevExprForDiff(slot.children, idx)) {
          parts.push('\\,');
        }
        const isSelected =
          selForSlot !== null && selForSlot.start <= wordSpan.start && selForSlot.end >= wordSpan.end;
        const atomClasses = isSelected ? 'ms-atom ms-selected' : 'ms-atom';
        const spanLen = wordSpan.end - wordSpan.start;
        parts.push(
          `\\htmlData{atom-slot=${slot.id},offset=${wordSpan.start},span=${spanLen}}{\\htmlClass{${atomClasses}}{${wordSpan.latex}}}`,
        );
        idx = wordSpan.end - 1;
        continue;
      }
    }

    // Space atom: ALWAYS gives clear visible feedback while typing adjacent to caret,
    // and tightens to natural TeX math kerning once surrounding tokens are completed!
    if (child.type === 'char' && child.value === ' ') {
      const isSelected = selForSlot !== null && idx >= selForSlot.start && idx < selForSlot.end;
      const caretAdjacent =
        isActive && focused && (cursor.offset === idx + 1 || cursor.offset === idx);
      const touchesKeywordOrOp =
        hints.keywordIndices.has(idx - 1) ||
        hints.keywordIndices.has(idx + 1) ||
        prev?.type === 'symbol' ||
        next?.type === 'symbol' ||
        prev?.type === 'struct' ||
        next?.type === 'struct' ||
        (prev?.type === 'char' && /^[+=<>,\-~()[\]]$/.test(prev.value)) ||
        (next?.type === 'char' && /^[+=<>,\-~()[\]]$/.test(next.value));

      const spaceLatex = caretAdjacent
        ? '\\htmlClass{ms-space-active}{\\,}'
        : touchesKeywordOrOp
          ? '\\kern 0.04em'
          : '\\,';
      const atomClasses = isSelected ? 'ms-atom ms-space-atom ms-selected' : 'ms-atom ms-space-atom';
      parts.push(
        `\\htmlData{atom-slot=${slot.id},offset=${idx}}{\\htmlClass{${atomClasses}}{${spaceLatex}}}`,
      );
      continue;
    }

    // Thin space before fallback upright differential `\,\mathrm{d}x`
    if (hints.diffStarts.has(idx) && isPrevExprForDiff(slot.children, idx)) {
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
      const escaped = escapeCharLatex(node.value);
      return isUprightChar ? `\\mathrm{${escaped}}` : escaped;
    }
    case 'symbol':
      return node.latex;
    case 'raw':
      return node.latex;
    case 'struct': {
      const structDepth = depth + 1;
      const structHeight = getStructSubtreeHeight(node);
      let template = node.customLatex ?? COMMANDS_BY_ID.get(node.commandId)?.latex;
      if (!node.customLatex && node.autoSized && node.slots.length === 1) {
        const tall = slotHasTallContent(node.slots[0]);
        if (node.commandId === 'paren') {
          template = tall ? '\\left($1\\right)' : '($1)';
        } else if (node.commandId === 'bracket') {
          template = tall ? '\\left[$1\\right]' : '[$1]';
        } else if (node.commandId === 'brace') {
          template = tall ? '\\left\\{$1\\right\\}' : '\\{$1\\}';
        }
      }
      let rendered: string;
      if (!template) {
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

  const hasLineBreak = doc.root.children.some(
    (n) => n.type === 'raw' && n.latex.trim() === '\\\\',
  );
  const inner = emitSlotInteractive(
    doc.root,
    cursor,
    selection,
    parentStructId,
    true,
    focused,
    autoShorthands,
    0,
  );
  if (!hasLineBreak) return inner;
  return `\\begin{gathered} ${inner} \\end{gathered}`;
}

export function commandPreviewLatex(template: string): string {
  return template.replace(/\$(\d+)/g, '\\square');
}

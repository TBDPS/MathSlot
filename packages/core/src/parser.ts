import {
  createCharNode,
  createEmptyDocument,
  createRawNode,
  createSlot,
  createStructNode,
  createSymbolNode,
  slotHasRawNodes,
  textToCharNodes,
} from './ast';
import {
  COMMANDS,
  COMMANDS_BY_ID,
} from './catalog';
import {
  ACCENT_MACRO_MAP,
  SUPPORTED_MATRIX_ENVS,
  isCasesEnv,
  isSupportedColSpec,
  sanitizeLatexTemplate,
} from './commandSpecs';
import { MATH_FUNCTIONS } from './emitIr';
import { DIFFERENTIAL_WORDS } from './shorthands';
import { parseStreamCode } from './streamCodec';
import type { CommandDef, Diagnostic, Document, ImportResult, MathNode } from './types';

export { parseStreamCode } from './streamCodec';

// Build reverse lookup from normalized LaTeX macro -> atomic Symbol CommandDef
const SYMBOL_BY_LATEX = new Map<string, CommandDef>();
for (const cmd of COMMANDS) {
  if (cmd.slots.length === 0) {
    SYMBOL_BY_LATEX.set(cmd.latex.trim(), cmd);
  }
}

const SYMBOL_ALIASES: Record<string, string> = {
  '\\le': 'leq',
  '\\ge': 'geq',
  '\\ne': 'neq',
  '\\rightarrow': 'to',
  '\\Rightarrow': 'implies',
  '\\Leftrightarrow': 'iff',
  '\\iff': 'iff',
  '\\implies': 'implies',
  '\\lor': 'lor',
  '\\vee': 'lor',
  '\\land': 'land',
  '\\lnot': 'neg',
};

/**
 * Splits a braced group `raw` on a top-level classic TeX infix macro (`\over` or `\choose`),
 * ignoring occurrences inside nested `{...}` or `\begin...\end`.
 */
function splitTopLevelInfixMacro(raw: string, macro: string): [string, string] | null {
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '\\') {
      if (depth === 0 && raw.startsWith(macro, i)) {
        const after = raw[i + macro.length];
        if (!after || !/[A-Za-z]/.test(after)) {
          return [raw.slice(0, i).trim(), raw.slice(i + macro.length).trim()];
        }
      }
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
  }
  return null;
}

const LOSSLESS_RAW_SYMBOLS = new Set([
  '\\epsilon',
  '\\ldots',
  '\\dots',
  '\\emptyset',
  '\\varpi',
  '\\varrho',
  '\\varsigma',
  '\\varkappa',
  '\\bmod',
  '\\vdash',
  '\\models',
  '\\dagger',
  '\\star',
  '\\triangle',
  '\\square',
  '\\complement',
  '\\nexists',
  '\\supset',
  '\\supseteq',
  '\\subsetneq',
  '\\preceq',
  '\\succeq',
  '\\longrightarrow',
  '\\longleftarrow',
  '\\rightleftharpoons',
  '\\backslash',
  '\\div',
  '\\ast',
  '\\otimes',
  '\\oplus',
  '\\angle',
]);

function lookupSymbol(macro: string): CommandDef | undefined {
  const direct = SYMBOL_BY_LATEX.get(macro);
  if (direct) return direct;
  const aliasId = SYMBOL_ALIASES[macro];
  return aliasId ? COMMANDS_BY_ID.get(aliasId) : undefined;
}

function isEscapedAt(text: string, idx: number): boolean {
  let backslashes = 0;
  for (let i = idx - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function hasUnescapedDollar(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '$' && !isEscapedAt(text, i)) return true;
  }
  return false;
}

function hasUnescapedDelimiter(text: string, delimiter: '\\(' | '\\)' | '\\[' | '\\]'): boolean {
  let from = 0;
  while (from <= text.length - delimiter.length) {
    const idx = text.indexOf(delimiter, from);
    if (idx === -1) return false;
    if (!isEscapedAt(text, idx)) return true;
    from = idx + 1;
  }
  return false;
}

export function stripOuterDelimiters(input: string): string {
  let s = input.trim();
  const fenceMatch = s.match(/^```(?:latex|tex|math)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenceMatch) {
    s = fenceMatch[1].trim();
  }
  if (s.startsWith('$$') && s.endsWith('$$') && s.length >= 4) {
    const inner = s.slice(2, -2);
    // Avoid treating multiple display formulas (`$$a$$ + $$b$$`) as one formula.
    if (!hasUnescapedDollar(inner)) return inner.trim();
    return s;
  }
  if (s.startsWith('\\[') && s.endsWith('\\]') && s.length >= 4) {
    const inner = s.slice(2, -2);
    if (!hasUnescapedDelimiter(inner, '\\[') && !hasUnescapedDelimiter(inner, '\\]')) {
      return inner.trim();
    }
    return s;
  }
  if (s.startsWith('\\(') && s.endsWith('\\)') && s.length >= 4) {
    const inner = s.slice(2, -2);
    if (!hasUnescapedDelimiter(inner, '\\(') && !hasUnescapedDelimiter(inner, '\\)')) {
      return inner.trim();
    }
    return s;
  }
  if (s.startsWith('$') && s.endsWith('$') && s.length >= 2) {
    const inner = s.slice(1, -1);
    // Allow escaped `\$` inside a single inline formula, but never strip when multiple
    // unescaped `$` delimiters are present (`$x$ + $y$`).
    if (!hasUnescapedDollar(inner)) return inner.trim();
  }
  return s;
}

const MATRIX_ENV_MAP: Record<string, { two: string; three?: string }> = {
  pmatrix: { two: 'matrix_2x2', three: 'matrix_3x3' },
  bmatrix: { two: 'bmatrix_2x2', three: 'bmatrix_3x3' },
  vmatrix: { two: 'det_2x2', three: 'det_3x3' },
  smallmatrix: { two: 'smallmatrix' },
};

function splitTopLevel(input: string, delimiter: '\\\\' | '&'): string[] {
  const parts: string[] = [];
  let braceDepth = 0;
  let envDepth = 0;
  let start = 0;
  let i = 0;
  while (i < input.length) {
    if (input.startsWith('\\begin{', i)) {
      envDepth += 1;
      i += 7;
      continue;
    }
    if (input.startsWith('\\end{', i)) {
      envDepth = Math.max(0, envDepth - 1);
      i += 5;
      continue;
    }
    if (input[i] === '\\' && delimiter === '&') {
      i += 2;
      continue;
    }
    if (input[i] === '{') {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (input[i] === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      i += 1;
      continue;
    }
    if (braceDepth === 0 && envDepth === 0 && input.startsWith(delimiter, i)) {
      parts.push(input.slice(start, i));
      i += delimiter.length;
      start = i;
      continue;
    }
    if (input[i] === '\\') {
      i += 2;
      continue;
    }
    i += 1;
  }
  parts.push(input.slice(start));
  return parts;
}

function splitMatrixRows(input: string): {
  rows: string[];
  rowGaps: (string | undefined)[];
  hasGaps: boolean;
} {
  const rows: string[] = [];
  const rowGaps: (string | undefined)[] = [];
  let hasGaps = false;
  let braceDepth = 0;
  let envDepth = 0;
  let start = 0;
  let i = 0;
  while (i < input.length) {
    if (input.startsWith('\\begin{', i)) {
      envDepth += 1;
      i += 7;
      continue;
    }
    if (input.startsWith('\\end{', i)) {
      envDepth = Math.max(0, envDepth - 1);
      i += 5;
      continue;
    }
    if (input[i] === '{') {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (input[i] === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      i += 1;
      continue;
    }
    if (braceDepth === 0 && envDepth === 0 && input.startsWith('\\\\', i)) {
      rows.push(input.slice(start, i).trim());
      i += 2;
      if (input[i] === '*') i += 1;
      let scan = i;
      while (scan < input.length && (input[scan] === ' ' || input[scan] === '\t')) scan += 1;
      if (input[scan] === '[') {
        const closeBracket = input.indexOf(']', scan + 1);
        if (closeBracket !== -1 && !input.slice(scan + 1, closeBracket).includes('\n')) {
          const gap = input.slice(scan + 1, closeBracket).trim();
          rowGaps.push(gap || undefined);
          if (gap) hasGaps = true;
          i = closeBracket + 1;
        } else {
          rowGaps.push(undefined);
        }
      } else {
        rowGaps.push(undefined);
      }
      start = i;
      continue;
    }
    if (input[i] === '\\') {
      i += 2;
      continue;
    }
    i += 1;
  }
  rows.push(input.slice(start).trim());
  // Only drop a single trailing empty segment after a trailing `\\` (preserving ALL interior empty rows!)
  if (rows.length > 1 && rows[rows.length - 1] === '' && !rowGaps[rows.length - 2]) {
    rows.pop();
    rowGaps.pop();
  }
  return { rows, rowGaps, hasGaps };
}

function stripTexComments(input: string): { cleaned: string; hadComments: boolean } {
  let out = '';
  let hadComments = false;
  let i = 0;
  while (i < input.length) {
    if (input[i] === '%') {
      let bs = 0;
      for (let k = i - 1; k >= 0 && input[k] === '\\'; k -= 1) bs += 1;
      if (bs % 2 === 0) {
        hadComments = true;
        while (i < input.length && input[i] !== '\n') i += 1;
        continue;
      }
    }
    out += input[i];
    i += 1;
  }
  return { cleaned: out, hadComments };
}

function hasMultipleWrappedFormulas(input: string): boolean {
  const s = input.trim();
  if (s.startsWith('$$') && s.endsWith('$$') && s.length >= 4 && hasUnescapedDollar(s.slice(2, -2))) {
    return true;
  }
  if (
    s.startsWith('\\[') &&
    s.endsWith('\\]') &&
    s.length >= 4 &&
    (hasUnescapedDelimiter(s.slice(2, -2), '\\[') || hasUnescapedDelimiter(s.slice(2, -2), '\\]'))
  ) {
    return true;
  }
  if (
    s.startsWith('\\(') &&
    s.endsWith('\\)') &&
    s.length >= 4 &&
    (hasUnescapedDelimiter(s.slice(2, -2), '\\(') || hasUnescapedDelimiter(s.slice(2, -2), '\\)'))
  ) {
    return true;
  }
  if (s.startsWith('$') && !s.startsWith('$$') && s.endsWith('$') && s.length >= 2 && hasUnescapedDollar(s.slice(1, -1))) {
    return true;
  }
  return false;
}

/**
 * Clean single-pass recursive descent parser for standard mathematical LaTeX -> MathSlot Document AST.
 */
export function parseLatex(input: string): ImportResult {
  const strippedDelim = stripOuterDelimiters(input);
  const diagnostics: Diagnostic[] = [];
  if (hasMultipleWrappedFormulas(input)) {
    diagnostics.push({
      severity: 'warning',
      message: '检测到多个独立公式，建议逐个导入以获得完整槽位编辑体验',
    });
  }
  const { cleaned: src, hadComments } = stripTexComments(strippedDelim);
  if (hadComments) {
    diagnostics.push({ severity: 'warning', message: '已忽略 LaTeX % 行尾注释' });
  }
  const nodes = parseLatexNodes(src, diagnostics);
  const doc = createEmptyDocument();
  doc.root = createSlot('公式', nodes);
  return {
    doc,
    diagnostics,
    lossless: diagnostics.length === 0,
    hasRawNodes: slotHasRawNodes(doc.root),
  };
}

function endsWithDifferential(nodes: readonly MathNode[]): boolean {
  if (nodes.length === 0) return false;
  const last = nodes[nodes.length - 1];
  if (last.type === 'struct' && last.commandId === 'diff') {
    return true;
  }
  const prev = nodes.length >= 2 ? nodes[nodes.length - 2] : undefined;

  // Case 1: `\mathrm{d}` followed by single variable char or Greek symbol (e.g. `\mathrm{d}x`, `\mathrm{d}\theta`)
  if (
    prev?.type === 'raw' &&
    prev.latex === '\\mathrm{d}' &&
    ((last.type === 'char' && /^[a-zA-Z]$/.test(last.value)) || last.type === 'symbol')
  ) {
    return true;
  }

  // Case 2: trailing alphabetic word is a differential token (`dx`, `dt`, `dy`, `dtheta`, ...)
  if (last.type === 'char' && /^[a-zA-Z]$/.test(last.value)) {
    let i = nodes.length - 1;
    let word = '';
    while (i >= 0 && nodes[i].type === 'char' && /^[a-zA-Z]$/.test((nodes[i] as { value: string }).value)) {
      word = (nodes[i] as { value: string }).value + word;
      i -= 1;
    }
    if (DIFFERENTIAL_WORDS[word]) {
      return true;
    }
  }
  return false;
}

const MAX_PARSE_DEPTH = 64;

function parseLatexNodes(src: string, diagnostics: Diagnostic[], depth = 0): MathNode[] {
  if (depth >= MAX_PARSE_DEPTH) {
    diagnostics.push({ severity: 'warning', message: '公式嵌套层级过深，已按原样保留深层内容' });
    return src.trim() ? [createRawNode(src)] : [];
  }
  let pos = 0;
  const peek = () => src[pos] ?? '';
  const eof = () => pos >= src.length;
  const skipSpaces = () => {
    while (!eof() && /\s/.test(src[pos])) pos += 1;
  };

  const readMacroName = (): string => {
    pos += 1;
    if (eof()) return '\\';
    const ch = src[pos];
    if (/[a-zA-Z]/.test(ch)) {
      const start = pos;
      while (!eof() && /[a-zA-Z]/.test(src[pos])) pos += 1;
      return '\\' + src.slice(start, pos);
    }
    pos += 1;
    return '\\' + ch;
  };

  const peekMacroName = (): string | null => {
    if (peek() !== '\\') return null;
    if (pos + 1 >= src.length) return '\\';
    const ch = src[pos + 1];
    if (/[a-zA-Z]/.test(ch)) {
      let end = pos + 1;
      while (end < src.length && /[a-zA-Z]/.test(src[end])) end += 1;
      return '\\' + src.slice(pos + 1, end);
    }
    return '\\' + ch;
  };

  const readBracedRaw = (): string => {
    skipSpaces();
    if (peek() !== '{') return '';
    pos += 1;
    const start = pos;
    let depth = 1;
    while (!eof() && depth > 0) {
      if (src[pos] === '\\') {
        pos += 2;
        continue;
      }
      if (src[pos] === '{') depth += 1;
      else if (src[pos] === '}') depth -= 1;
      if (depth > 0) pos += 1;
    }
    const content = src.slice(start, pos);
    if (peek() === '}') pos += 1;
    else diagnostics.push({ severity: 'warning', message: '检测到未闭合花括号 }，已自动补全' });
    return content;
  };

  const readBracketRaw = (): string | null => {
    skipSpaces();
    if (peek() !== '[') return null;
    pos += 1;
    const start = pos;
    let depth = 1;
    while (!eof() && depth > 0) {
      if (src[pos] === '\\') {
        pos += 2;
        continue;
      }
      if (src[pos] === '[') depth += 1;
      else if (src[pos] === ']') depth -= 1;
      if (depth > 0) pos += 1;
    }
    const content = src.slice(start, pos);
    if (peek() === ']') pos += 1;
    else diagnostics.push({ severity: 'error', message: '缺少闭合方括号 ]' });
    return content;
  };

  /**
   * Scans a matched plain `(...)` or `[...]` delimiter pair (respecting escapes, braces, and nested `\left..\right`).
   * Returns inner raw string and advances `pos` past the matching close char, or returns `null` if unmatched.
   */
  const tryReadPlainDelimRaw = (openCh: '(' | '[', closeCh: ')' | ']'): string | null => {
    if (peek() !== openCh) return null;
    let scan = pos + 1;
    let depth = 1;
    let braceDepth = 0;
    while (scan < src.length && depth > 0) {
      if (src[scan] === '\\') {
        scan += 2;
        continue;
      }
      if (src[scan] === '{') {
        braceDepth += 1;
        scan += 1;
        continue;
      }
      if (src[scan] === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        scan += 1;
        continue;
      }
      if (braceDepth === 0) {
        if (src[scan] === openCh) depth += 1;
        else if (src[scan] === closeCh) depth -= 1;
      }
      if (depth > 0) scan += 1;
    }
    if (depth !== 0) return null;
    const inner = src.slice(pos + 1, scan);
    pos = scan + 1;
    return inner;
  };

  /**
   * Scans a matched plain `|...|` pair (excluding empty `||` and relation-crossing spans like `P(A|B)` or `a|b=c|d`).
   */
  const tryReadPlainAbsRaw = (): string | null => {
    if (peek() !== '|') return null;
    let scan = pos + 1;
    let braceDepth = 0;
    let parenDepth = 0;
    let bracketDepth = 0;
    let lrDepth = 0;
    while (scan < src.length) {
      const c = src[scan];
      if (c === '\\') {
        if (src.startsWith('\\left', scan) && !/[a-zA-Z]/.test(src[scan + 5] ?? '')) {
          lrDepth += 1;
          scan += 5;
          continue;
        }
        if (src.startsWith('\\right', scan) && !/[a-zA-Z]/.test(src[scan + 6] ?? '')) {
          lrDepth = Math.max(0, lrDepth - 1);
          scan += 6;
          continue;
        }
        if (
          braceDepth === 0 &&
          parenDepth === 0 &&
          bracketDepth === 0 &&
          lrDepth === 0 &&
          src[scan + 1] === '\\'
        ) {
          return null;
        }
        scan += 2;
        continue;
      }
      if (c === '{') {
        braceDepth += 1;
        scan += 1;
        continue;
      }
      if (c === '}') {
        if (braceDepth === 0) return null;
        braceDepth -= 1;
        scan += 1;
        continue;
      }
      if (braceDepth === 0 && lrDepth === 0) {
        if (c === '(') {
          parenDepth += 1;
          scan += 1;
          continue;
        }
        if (c === ')') {
          if (parenDepth === 0) return null;
          parenDepth -= 1;
          scan += 1;
          continue;
        }
        if (c === '[') {
          bracketDepth += 1;
          scan += 1;
          continue;
        }
        if (c === ']') {
          if (bracketDepth === 0) return null;
          bracketDepth -= 1;
          scan += 1;
          continue;
        }
        if (parenDepth === 0 && bracketDepth === 0) {
          if (c === '|') {
            const inner = src.slice(pos + 1, scan);
            if (!inner.trim() || (/^\s/.test(inner) && /\s$/.test(inner))) {
              return null;
            }
            pos = scan + 1;
            return inner;
          }
          if (c === '=' || c === ',' || c === ';' || c === '&' || c === '<' || c === '>') {
            return null;
          }
        }
      }
      scan += 1;
    }
    return null;
  };

  const readGroupNodes = (): MathNode[] => {
    skipSpaces();
    if (peek() === '{') {
      return parseLatexNodes(readBracedRaw(), diagnostics, depth + 1);
    }
    return parseSingleUnit();
  };

  const readSingleTokenRaw = (): string => {
    skipSpaces();
    if (eof()) return '';
    if (peek() === '{') return readBracedRaw();
    if (peek() === '\\') return readMacroName();
    const ch = src[pos];
    pos += 1;
    return ch;
  };

  const readSubSup = (): { sub: MathNode[] | null; sup: MathNode[] | null } => {
    let sub: MathNode[] | null = null;
    let sup: MathNode[] | null = null;
    for (let k = 0; k < 2; k += 1) {
      skipSpaces();
      if (peek() === '_' && !sub) {
        pos += 1;
        sub = readGroupNodes();
      } else if (peek() === '^' && !sup) {
        pos += 1;
        sup = readGroupNodes();
      } else {
        break;
      }
    }
    return { sub, sup };
  };

  const readOptionalLimitsMode = (): 'limits' | 'nolimits' | undefined => {
    let mode: 'limits' | 'nolimits' | undefined;
    while (!eof()) {
      const save = pos;
      skipSpaces();
      if (peek() !== '\\') {
        pos = save;
        break;
      }
      const next = peekMacroName();
      if (next === '\\limits' || next === '\\nolimits') {
        pos += next.length;
        mode = next === '\\limits' ? 'limits' : 'nolimits';
        continue;
      }
      pos = save;
      break;
    }
    return mode;
  };

  /**
   * Splits `bodyRaw` at top-level `\middle<delim>` tokens (outside nested `\left..\right` and `{...}`).
   */
  const splitTopLevelMiddle = (
    bodyRaw: string,
  ): { parts: string[]; delims: string[] } => {
    const parts: string[] = [];
    const delims: string[] = [];
    let lrDepth = 0;
    let braceDepth = 0;
    let partStart = 0;
    let i = 0;
    while (i < bodyRaw.length) {
      if (bodyRaw[i] === '\\') {
        if (bodyRaw.startsWith('\\left', i) && !/[a-zA-Z]/.test(bodyRaw[i + 5] ?? '')) {
          lrDepth += 1;
          i += 5;
          continue;
        }
        if (bodyRaw.startsWith('\\right', i) && !/[a-zA-Z]/.test(bodyRaw[i + 6] ?? '')) {
          lrDepth = Math.max(0, lrDepth - 1);
          i += 6;
          continue;
        }
        if (
          lrDepth === 0 &&
          braceDepth === 0 &&
          bodyRaw.startsWith('\\middle', i) &&
          !/[a-zA-Z]/.test(bodyRaw[i + 7] ?? '')
        ) {
          parts.push(bodyRaw.slice(partStart, i));
          let dPos = i + 7;
          while (dPos < bodyRaw.length && /\s/.test(bodyRaw[dPos])) dPos += 1;
          let delim = '';
          if (bodyRaw[dPos] === '\\') {
            const dStart = dPos;
            dPos += 1;
            if (dPos < bodyRaw.length && /[a-zA-Z]/.test(bodyRaw[dPos])) {
              while (dPos < bodyRaw.length && /[a-zA-Z]/.test(bodyRaw[dPos])) dPos += 1;
            } else if (dPos < bodyRaw.length) {
              dPos += 1;
            }
            delim = bodyRaw.slice(dStart, dPos);
          } else if (dPos < bodyRaw.length) {
            delim = bodyRaw[dPos];
            dPos += 1;
          }
          delims.push(delim);
          partStart = dPos;
          i = dPos;
          continue;
        }
        i += 2;
        continue;
      }
      if (bodyRaw[i] === '{') braceDepth += 1;
      else if (bodyRaw[i] === '}') braceDepth = Math.max(0, braceDepth - 1);
      i += 1;
    }
    parts.push(bodyRaw.slice(partStart));
    return { parts, delims };
  };

  /**
   * Strips alignment `&` ONLY at the top level of an aligned/align environment, preserving
   * every `&` inside nested `\begin{pmatrix}...\end{pmatrix}` / `{...}` / `\&` escapes!
   */
  const stripTopLevelAmpersands = (
    bodyRaw: string,
  ): { cleaned: string; hasMultiColumn: boolean } => {
    let out = '';
    let envDepth = 0;
    let braceDepth = 0;
    let rowTopLevelAmps = 0;
    let hasMultiColumn = false;
    let i = 0;
    while (i < bodyRaw.length) {
      if (bodyRaw[i] === '\\') {
        if (bodyRaw.startsWith('\\begin{', i)) {
          envDepth += 1;
          out += '\\begin{';
          i += 7;
          continue;
        }
        if (bodyRaw.startsWith('\\end{', i)) {
          envDepth = Math.max(0, envDepth - 1);
          out += '\\end{';
          i += 5;
          continue;
        }
        if (bodyRaw.startsWith('\\\\', i)) {
          if (envDepth === 0 && braceDepth === 0) {
            rowTopLevelAmps = 0;
          }
          out += '\\\\';
          i += 2;
          continue;
        }
        // Preserve escaped characters including `\&`
        out += bodyRaw.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (bodyRaw[i] === '{') {
        braceDepth += 1;
        out += '{';
        i += 1;
        continue;
      }
      if (bodyRaw[i] === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        out += '}';
        i += 1;
        continue;
      }
      if (bodyRaw[i] === '&' && envDepth === 0 && braceDepth === 0) {
        rowTopLevelAmps += 1;
        // Check if `&` is adjacent to a relation operator (`&=`, `&\le`, `=&`, etc.) or start/end of row
        const afterTrim = bodyRaw.slice(i + 1).trimStart();
        const beforeTrim = out.trimEnd();
        const relAfter =
          afterTrim.length === 0 ||
          afterTrim.startsWith('\\\\') ||
          /^(?:[=<>~]|\\(?:le|leq|ge|geq|neq|ne|approx|sim|simeq|cong|equiv|propto|to|rightarrow|leftarrow|Rightarrow|Leftrightarrow|mapsto|in|subset|subseteq)(?![a-zA-Z]))/.test(
            afterTrim,
          );
        const relBefore =
          beforeTrim.length === 0 ||
          beforeTrim.endsWith('\\\\') ||
          /(?:[=<>~]|\\(?:le|leq|ge|geq|neq|ne|approx|sim|simeq|cong|equiv|propto|to|rightarrow|leftarrow|Rightarrow|Leftrightarrow|mapsto|in|subset|subseteq))$/.test(
            beforeTrim,
          );
        if (rowTopLevelAmps > 1 || (!relAfter && !relBefore)) {
          hasMultiColumn = true;
          out += ' \\quad ';
        }
        i += 1;
        continue;
      }
      out += bodyRaw[i];
      i += 1;
    }
    return { cleaned: out, hasMultiColumn };
  };

  /**
   * Unescapes standard LaTeX text escapes inside `\text{...}` (e.g. `a\_b 50\%` -> `a_b 50%`)
   * AND parses matched inline `$...$` math spans into editable `inline_math` slots!
   * Returns `null` if unmatched `$` or unknown text macros exist, preserving raw `\text{...}` losslessly.
   */
  const parseLatexTextArg = (arg: string): MathNode[] | null => {
    const out: MathNode[] = [];
    let i = 0;
    while (i < arg.length) {
      const c = arg[i];
      if (c === '$') {
        if (arg[i + 1] === '$') return null;
        let closeIdx = i + 1;
        while (closeIdx < arg.length) {
          if (arg[closeIdx] === '\\') {
            closeIdx += 2;
            continue;
          }
          if (arg[closeIdx] === '$') break;
          closeIdx += 1;
        }
        if (closeIdx >= arg.length || arg[closeIdx] !== '$') {
          return null;
        }
        const innerMath = arg.slice(i + 1, closeIdx);
        const mathNodes = parseLatexNodes(innerMath, diagnostics, depth + 1);
        out.push(createStructNode(COMMANDS_BY_ID.get('inline_math')!, [mathNodes]));
        i = closeIdx + 1;
        continue;
      }
      if (c === '\\') {
        const next = arg[i + 1];
        if (next === undefined) {
          out.push(createCharNode('\\'));
          i += 1;
          continue;
        }
        if (
          next === '_' ||
          next === '%' ||
          next === '&' ||
          next === '#' ||
          next === '$' ||
          next === '{' ||
          next === '}'
        ) {
          out.push(createCharNode(next));
          i += 2;
          continue;
        }
        if (next === ' ') {
          out.push(createCharNode(' '));
          i += 2;
          continue;
        }
        if (arg.startsWith('\\textasciicircum', i) && !/[a-zA-Z]/.test(arg[i + 16] ?? '')) {
          out.push(createCharNode('^'));
          i += 16;
          if (arg[i] === '{' && arg[i + 1] === '}') i += 2;
          else if (arg[i] === ' ') i += 1;
          continue;
        }
        if (arg.startsWith('\\textbackslash', i) && !/[a-zA-Z]/.test(arg[i + 14] ?? '')) {
          out.push(createCharNode('\\'));
          i += 14;
          if (arg[i] === '{' && arg[i + 1] === '}') i += 2;
          else if (arg[i] === ' ') i += 1;
          continue;
        }
        if (arg.startsWith('\\textasciitilde', i) && !/[a-zA-Z]/.test(arg[i + 15] ?? '')) {
          out.push(createCharNode('~'));
          i += 15;
          if (arg[i] === '{' && arg[i + 1] === '}') i += 2;
          else if (arg[i] === ' ') i += 1;
          continue;
        }
        return null;
      }
      out.push(createCharNode(c));
      i += 1;
    }
    return out;
  };

  const parseLeftRight = (): MathNode => {
    skipSpaces();
    let openDelim = '';
    if (peek() === '\\') openDelim = readMacroName();
    else if (!eof()) {
      openDelim = src[pos];
      pos += 1;
    }
    const start = pos;
    let lrDepth = 1;
    let closeDelim = '';
    while (!eof() && lrDepth > 0) {
      if (src.startsWith('\\left', pos) && !/[a-zA-Z]/.test(src[pos + 5] ?? '')) {
        lrDepth += 1;
        pos += 5;
        continue;
      }
      if (src.startsWith('\\right', pos) && !/[a-zA-Z]/.test(src[pos + 6] ?? '')) {
        lrDepth -= 1;
        if (lrDepth === 0) {
          const bodyRaw = src.slice(start, pos).trim();
          pos += 6;
          skipSpaces();
          if (peek() === '\\') closeDelim = readMacroName();
          else if (!eof()) {
            closeDelim = src[pos];
            pos += 1;
          }

          const middleSplit = splitTopLevelMiddle(bodyRaw);
          if (middleSplit.delims.length > 0) {
            if (
              openDelim === '\\{' &&
              closeDelim === '\\}' &&
              middleSplit.delims.length === 1 &&
              (middleSplit.delims[0] === '|' || middleSplit.delims[0] === '\\vert')
            ) {
              const leftPart = middleSplit.parts[0].replace(/(?:\\,|\\;|\\:|\\ )*\s*$/, '').trim();
              const rightPart = middleSplit.parts[1].replace(/^\s*(?:\\,|\\;|\\:|\\ )*/, '').trim();
              return createStructNode(COMMANDS_BY_ID.get('set_builder')!, [
                parseLatexNodes(leftPart, diagnostics, depth + 1),
                parseLatexNodes(rightPart, diagnostics, depth + 1),
              ]);
            }
            diagnostics.push({
              severity: 'warning',
              message: `以原生 LaTeX 保留带 \\middle 的定界符 \\left${openDelim}...\\right${closeDelim}`,
            });
            return createRawNode(`\\left${openDelim}${bodyRaw}\\right${closeDelim}`);
          }

          if (openDelim === '.' && (closeDelim === '|' || closeDelim === '\\|')) {
            const { sub, sup } = readSubSup();
            return createStructNode(COMMANDS_BY_ID.get('eval_bar')!, [
              parseLatexNodes(bodyRaw, diagnostics, depth + 1),
              sub ?? [],
              sup ?? [],
            ]);
          }

          let cmdId: string | null = null;
          if (openDelim === '(' && closeDelim === ')') cmdId = 'paren';
          else if (openDelim === '|' && closeDelim === '|') cmdId = 'abs';
          else if (openDelim === '[' && closeDelim === ']') cmdId = 'bracket';
          else if (openDelim === '\\{' && closeDelim === '\\}') cmdId = 'brace';
          else if (openDelim === '(' && closeDelim === ']') cmdId = 'interval_oc';
          else if (openDelim === '[' && closeDelim === ')') cmdId = 'interval_co';
          else if (
            (openDelim === '\\Vert' || openDelim === '\\|') &&
            (closeDelim === '\\Vert' || closeDelim === '\\|')
          ) {
            cmdId = 'norm';
          } else if (openDelim === '\\langle' && closeDelim === '\\rangle') cmdId = 'angle';
          else if (openDelim === '\\lfloor' && closeDelim === '\\rfloor') cmdId = 'floor';
          else if (openDelim === '\\lceil' && closeDelim === '\\rceil') cmdId = 'ceil';

          if (cmdId) {
            const innerNodes = parseLatexNodes(bodyRaw, diagnostics, depth + 1);
            // Collapse `\left[\begin{array}{cc|c}...\end{array}\right]` directly into an editable augmented matrix grid!
            if (
              innerNodes.length === 1 &&
              innerNodes[0].type === 'struct' &&
              innerNodes[0].grid?.env === 'array'
            ) {
              const envForDelim: Record<string, string> = {
                paren: 'pmatrix',
                bracket: 'bmatrix',
                brace: 'Bmatrix',
                abs: 'vmatrix',
                norm: 'Vmatrix',
              };
              const mappedEnv = envForDelim[cmdId];
              if (mappedEnv) {
                innerNodes[0].grid.env = mappedEnv;
                if (mappedEnv === 'bmatrix' && innerNodes[0].grid.colSpec?.includes('|')) {
                  innerNodes[0].commandId = 'aug_matrix';
                }
                return innerNodes[0];
              }
            }
            return createStructNode(COMMANDS_BY_ID.get(cmdId)!, [innerNodes]);
          }

          diagnostics.push({
            severity: 'warning',
            message: `保留自定义定界符 \\left${openDelim}...\\right${closeDelim}`,
          });
          return createRawNode(`\\left${openDelim}${bodyRaw}\\right${closeDelim}`);
        }
        pos += 6;
        continue;
      }
      pos += 1;
    }

    diagnostics.push({ severity: 'error', message: '缺少与 \\left 匹配的 \\right' });
    return createRawNode(`\\left${openDelim}${src.slice(start)}`);
  };

  const parseEnvironment = (): MathNode[] => {
    const envName = readBracedRaw().trim();
    const beginToken = `\\begin{${envName}}`;
    const endToken = `\\end{${envName}}`;
    // Balanced scan so nested same-name environments (e.g. block pmatrix inside pmatrix) pair accurately
    let envDepth = 1;
    let scan = pos;
    let endIdx = -1;
    while (scan < src.length && envDepth > 0) {
      if (src.startsWith(beginToken, scan)) {
        envDepth += 1;
        scan += beginToken.length;
        continue;
      }
      if (src.startsWith(endToken, scan)) {
        envDepth -= 1;
        if (envDepth === 0) {
          endIdx = scan;
          break;
        }
        scan += endToken.length;
        continue;
      }
      scan += 1;
    }
    if (endIdx === -1) {
      diagnostics.push({ severity: 'error', message: `缺少 \\end{${envName}}` });
      const rest = src.slice(pos);
      pos = src.length;
      return [createRawNode(`\\begin{${envName}}${rest}`)];
    }
    const body = src.slice(pos, endIdx).trim();
    pos = endIdx + endToken.length;

    if (
      envName === 'gathered' ||
      envName === 'aligned' ||
      envName === 'align' ||
      envName === 'align*' ||
      envName === 'equation' ||
      envName === 'equation*' ||
      envName === 'gather' ||
      envName === 'gather*'
    ) {
      if (/\\tag\*?(?![a-zA-Z])/.test(body)) {
        diagnostics.push({
          severity: 'warning',
          message: `公式包含 \\tag 编号，已保留原 ${envName} 环境（导出请使用 $$...$$ 块级模式）`,
        });
        const preservedEnv =
          envName === 'aligned' ? 'align' : envName;
        return [createRawNode(`\\begin{${preservedEnv}} ${body} \\end{${preservedEnv}}`)];
      }
      // Inside a nested slot (e.g. `\boxed{\begin{aligned}...\end{aligned}}`, `\left(\begin{gathered}...\end{gathered}\right)`),
      // NEVER flatten into raw `\\` breaks; preserve as a first-class editable `aligned` / `gathered` grid struct!
      if (depth > 0) {
        const { rows, rowGaps, hasGaps } = splitMatrixRows(body);
        const isGather =
          envName === 'gathered' || envName === 'gather' || envName === 'gather*';
        if (isGather) {
          const slotLabels = rows.map((_, r) => `第 ${r + 1} 行`);
          const slotContents = rows.map((r) => parseLatexNodes(r.trim(), diagnostics, depth + 1));
          const struct = createStructNode(
            { id: 'aligned_2', slots: slotLabels, latex: '' },
            slotContents,
          );
          struct.grid = {
            env: 'gathered',
            rows: rows.length,
            cols: 1,
            ...(hasGaps ? { rowGaps } : {}),
          };
          return [struct];
        }
        const cells = rows.map((r) => splitTopLevel(r, '&').map((c) => c.trim()));
        const colCount = Math.max(...cells.map((r) => r.length), 1);
        if (rows.length >= 1 && colCount >= 1 && colCount <= 8) {
          const slotLabels: string[] = [];
          const slotContents: MathNode[][] = [];
          for (let r = 0; r < rows.length; r += 1) {
            for (let c = 0; c < colCount; c += 1) {
              slotLabels.push(`(${r + 1},${c + 1})`);
              slotContents.push(parseLatexNodes(cells[r][c] ?? '', diagnostics, depth + 1));
            }
          }
          const struct = createStructNode(
            { id: 'aligned_2', slots: slotLabels, latex: '' },
            slotContents,
          );
          struct.grid = {
            env: 'aligned',
            rows: rows.length,
            cols: colCount,
            ...(hasGaps ? { rowGaps } : {}),
          };
          return [struct];
        }
        const katexEnv = envName === 'align' || envName === 'align*' ? 'aligned' : envName;
        return [createRawNode(`\\begin{${katexEnv}} ${body} \\end{${katexEnv}}`)];
      }
      // Strip ONLY top-level relation-alignment `&` markers so nested matrices/cases retain every column separator!
      const { cleaned, hasMultiColumn } = stripTopLevelAmpersands(body);
      if (hasMultiColumn) {
        const { rows, rowGaps, hasGaps } = splitMatrixRows(body);
        const cells = rows.map((r) => splitTopLevel(r, '&').map((c) => c.trim()));
        const colCount = Math.max(...cells.map((r) => r.length), 2);
        if (rows.length >= 1 && colCount >= 2 && colCount <= 8) {
          const slotLabels: string[] = [];
          const slotContents: MathNode[][] = [];
          for (let r = 0; r < rows.length; r += 1) {
            for (let c = 0; c < colCount; c += 1) {
              slotLabels.push(`(${r + 1},${c + 1})`);
              slotContents.push(parseLatexNodes(cells[r][c] ?? '', diagnostics, depth + 1));
            }
          }
          const struct = createStructNode(
            { id: 'aligned_2', slots: slotLabels, latex: '' },
            slotContents,
          );
          struct.grid = {
            env: 'aligned',
            rows: rows.length,
            cols: colCount,
            ...(hasGaps ? { rowGaps } : {}),
          };
          return [struct];
        }
        diagnostics.push({
          severity: 'warning',
          message: `检测到 ${envName} 多列或非关系对齐，已按原生 LaTeX 整体保留以保证对齐语义`,
        });
        const katexEnv = envName === 'align' || envName === 'align*' ? 'aligned' : envName;
        return [createRawNode(`\\begin{${katexEnv}} ${body} \\end{${katexEnv}}`)];
      }
      return parseLatexNodes(cleaned, diagnostics, depth + 1);
    }

    if (envName === 'array') {
      const trimmedBody = body.trimStart();
      if (trimmedBody.startsWith('{')) {
        let bDepth = 1;
        let bPos = 1;
        while (bPos < trimmedBody.length && bDepth > 0) {
          if (trimmedBody[bPos] === '\\') {
            bPos += 2;
            continue;
          }
          if (trimmedBody[bPos] === '{') bDepth += 1;
          else if (trimmedBody[bPos] === '}') bDepth -= 1;
          if (bDepth > 0) bPos += 1;
        }
        const rawColSpec = trimmedBody.slice(1, bPos).trim();
        const arrayContent = trimmedBody.slice(bPos + (trimmedBody[bPos] === '}' ? 1 : 0)).trim();
        if (isSupportedColSpec(rawColSpec)) {
          const { rows, rowGaps, hasGaps } = splitMatrixRows(arrayContent);
          const cells = rows.map((r) => splitTopLevel(r, '&').map((c) => c.trim()));
          if (rows.length >= 1 && (rows.length > 1 || cells[0][0] !== '')) {
            const specCols = rawColSpec.replace(/[^lcr]/g, '').length;
            const colCount = Math.max(...cells.map((r) => r.length), specCols, 1);
            const slotLabels: string[] = [];
            const slotContents: MathNode[][] = [];
            for (let r = 0; r < rows.length; r += 1) {
              for (let c = 0; c < colCount; c += 1) {
                slotLabels.push(`(${r + 1},${c + 1})`);
                slotContents.push(parseLatexNodes(cells[r][c] ?? '', diagnostics, depth + 1));
              }
            }
            const struct = createStructNode(
              { id: 'matrix_2x2', slots: slotLabels, latex: '' },
              slotContents,
            );
            struct.grid = {
              env: 'array',
              rows: rows.length,
              cols: colCount,
              colSpec: rawColSpec.replace(/\s+/g, ''),
              ...(hasGaps ? { rowGaps } : {}),
            };
            return [struct];
          }
        }
      }
      diagnostics.push({
        severity: 'warning',
        message: '复杂列格式 array 环境已按原生 LaTeX 保留',
      });
      return [createRawNode(`\\begin{array}${body}\\end{array}`)];
    }

    const { rows, rowGaps, hasGaps } = splitMatrixRows(body);
    const cells = rows.map((r) => splitTopLevel(r, '&').map((c) => c.trim()));

    if (isCasesEnv(envName) && rows.length >= 1 && (rows.length > 1 || cells[0][0] !== '')) {
      if (!hasGaps && rows.length === 2 && cells.every((r) => r.length <= 2)) {
        const twoId =
          envName === 'dcases' ? 'dcases_2' : envName === 'rcases' ? 'rcases_2' : 'cases_2';
        return [
          createStructNode(COMMANDS_BY_ID.get(twoId)!, [
            parseLatexNodes(cells[0][0] ?? '', diagnostics, depth + 1),
            parseLatexNodes(cells[0][1] ?? '', diagnostics, depth + 1),
            parseLatexNodes(cells[1][0] ?? '', diagnostics, depth + 1),
            parseLatexNodes(cells[1][1] ?? '', diagnostics, depth + 1),
          ]),
        ];
      }
      if (envName === 'cases' && !hasGaps && rows.length === 3 && cells.every((r) => r.length <= 2)) {
        return [
          createStructNode(COMMANDS_BY_ID.get('cases_3')!, [
            parseLatexNodes(cells[0][0] ?? '', diagnostics, depth + 1),
            parseLatexNodes(cells[0][1] ?? '', diagnostics, depth + 1),
            parseLatexNodes(cells[1][0] ?? '', diagnostics, depth + 1),
            parseLatexNodes(cells[1][1] ?? '', diagnostics, depth + 1),
            parseLatexNodes(cells[2][0] ?? '', diagnostics, depth + 1),
            parseLatexNodes(cells[2][1] ?? '', diagnostics, depth + 1),
          ]),
        ];
      }
      // Dynamic N-row / M-column cases / dcases / rcases!
      const colCount = Math.max(...cells.map((r) => r.length), 2);
      const slotLabels: string[] = [];
      const slotContents: MathNode[][] = [];
      for (let r = 0; r < rows.length; r += 1) {
        for (let c = 0; c < colCount; c += 1) {
          slotLabels.push(
            c === 0 ? `表达式${r + 1}` : c === 1 ? `条件${r + 1}` : `列${c + 1}(${r + 1})`,
          );
          slotContents.push(parseLatexNodes(cells[r][c] ?? '', diagnostics, depth + 1));
        }
      }
      const baseCasesId =
        envName === 'dcases' ? 'dcases_2' : envName === 'rcases' ? 'rcases_2' : 'cases_2';
      const struct = createStructNode(
        { id: baseCasesId, slots: slotLabels, latex: '' },
        slotContents,
      );
      struct.grid = {
        env: envName,
        rows: rows.length,
        cols: colCount,
        ...(hasGaps ? { rowGaps } : {}),
      };
      return [struct];
    }

    if (SUPPORTED_MATRIX_ENVS.has(envName) && rows.length >= 1 && (rows.length > 1 || cells[0][0] !== '')) {
      const colCount = Math.max(...cells.map((r) => r.length), 1);
      const matMap = MATRIX_ENV_MAP[envName];
      if (!hasGaps && matMap?.two && rows.length === 2 && colCount === 2) {
        return [
          createStructNode(
            COMMANDS_BY_ID.get(matMap.two)!,
            cells.flatMap((r) => [
              parseLatexNodes(r[0] ?? '', diagnostics, depth + 1),
              parseLatexNodes(r[1] ?? '', diagnostics, depth + 1),
            ]),
          ),
        ];
      }
      if (!hasGaps && matMap?.three && rows.length === 3 && colCount === 3) {
        return [
          createStructNode(
            COMMANDS_BY_ID.get(matMap.three)!,
            cells.flatMap((r) => [
              parseLatexNodes(r[0] ?? '', diagnostics, depth + 1),
              parseLatexNodes(r[1] ?? '', diagnostics, depth + 1),
              parseLatexNodes(r[2] ?? '', diagnostics, depth + 1),
            ]),
          ),
        ];
      }
      // Dynamic R×C matrix!
      const slotLabels: string[] = [];
      const slotContents: MathNode[][] = [];
      for (let r = 0; r < rows.length; r += 1) {
        for (let c = 0; c < colCount; c += 1) {
          slotLabels.push(`(${r + 1},${c + 1})`);
          slotContents.push(parseLatexNodes(cells[r][c] ?? '', diagnostics, depth + 1));
        }
      }
      const baseCmdId = matMap ? matMap.two : 'matrix_2x2';
      const struct = createStructNode(
        { id: baseCmdId, slots: slotLabels, latex: '' },
        slotContents,
      );
      struct.grid = {
        env: envName,
        rows: rows.length,
        cols: colCount,
        ...(hasGaps ? { rowGaps } : {}),
      };
      return [struct];
    }

    diagnostics.push({ severity: 'warning', message: `以原生 LaTeX 保留环境 ${envName}` });
    return [createRawNode(`\\begin{${envName}}${body}\\end{${envName}}`)];
  };

  const BIGOP_BOUNDARY_MACROS = new Set([
    '\\int',
    '\\iint',
    '\\iiint',
    '\\oint',
    '\\sum',
    '\\prod',
    '\\bigcup',
    '\\bigcap',
    '\\lim',
    '\\sim',
    '\\approx',
    '\\equiv',
    '\\le',
    '\\leq',
    '\\ge',
    '\\geq',
    '\\neq',
    '\\ne',
    '\\to',
    '\\Rightarrow',
    '\\Leftrightarrow',
  ]);

  const readBigOpBody = (isIntegral: boolean): MathNode[] => {
    skipSpaces();
    const out: MathNode[] = [];
    while (!eof()) {
      const ch = peek();
      if (/\s/.test(ch)) {
        skipSpaces();
        const prev = out[out.length - 1];
        if (prev && prev.type === 'char' && /[A-Za-z0-9]/.test(prev.value) && /[A-Za-z0-9]/.test(peek())) {
          out.push(createCharNode(' '));
        }
        continue;
      }
      if (ch === '=' || ch === ',' || ch === ';' || ch === ')' || ch === ']' || ch === '~') break;
      if ((ch === '+' || ch === '-') && out.length > 0) break;
      if (src.startsWith('\\\\', pos)) break;

      // Stop before a sibling relation or big operator once body has content (e.g. `\int_0^1 x dx \cdot \int_0^1 y dy`)
      if (out.length > 0 && ch === '\\') {
        const nextMacro = peekMacroName();
        if (nextMacro && BIGOP_BOUNDARY_MACROS.has(nextMacro)) {
          break;
        }
      }

      const before = pos;
      const units = parseTermUnits();
      if (units.length === 0 && pos === before) break;
      out.push(...units);

      // For integrals, cleanly close the integrand right after reading the differential (`dx`, `\mathrm{d}x`, etc.)!
      if (isIntegral && endsWithDifferential(out)) {
        break;
      }
    }
    return out;
  };

  const parseSingleUnit = (): MathNode[] => {
    if (eof()) return [];
    const ch = peek();

    if (/\s/.test(ch)) {
      skipSpaces();
      return [];
    }

    if (ch === '{') {
      const raw = readBracedRaw();
      // Support classic TeX infix primitives `{a \over b}` -> `frac` and `{n \choose k}` -> `binom`!
      const infixOver = splitTopLevelInfixMacro(raw, '\\over');
      if (infixOver) {
        return [
          createStructNode(COMMANDS_BY_ID.get('frac')!, [
            parseLatexNodes(infixOver[0], diagnostics, depth + 1),
            parseLatexNodes(infixOver[1], diagnostics, depth + 1),
          ]),
        ];
      }
      const infixChoose = splitTopLevelInfixMacro(raw, '\\choose');
      if (infixChoose) {
        return [
          createStructNode(COMMANDS_BY_ID.get('binom')!, [
            parseLatexNodes(infixChoose[0], diagnostics, depth + 1),
            parseLatexNodes(infixChoose[1], diagnostics, depth + 1),
          ]),
        ];
      }
      return parseLatexNodes(raw, diagnostics, depth + 1);
    }

    // Parse matched plain `(...)` and `[...]` into real autoSized delimiter structs so hierarchy & jump survive roundtrip!
    if (ch === '(') {
      const inner = tryReadPlainDelimRaw('(', ')');
      if (inner !== null) {
        const struct = createStructNode(COMMANDS_BY_ID.get('paren')!, [
          parseLatexNodes(inner, diagnostics, depth + 1),
        ]);
        struct.autoSized = true;
        return [struct];
      }
    }
    if (ch === '[') {
      const inner = tryReadPlainDelimRaw('[', ']');
      if (inner !== null) {
        const struct = createStructNode(COMMANDS_BY_ID.get('bracket')!, [
          parseLatexNodes(inner, diagnostics, depth + 1),
        ]);
        struct.autoSized = true;
        return [struct];
      }
    }
    if (ch === '|') {
      const inner = tryReadPlainAbsRaw();
      if (inner !== null) {
        const struct = createStructNode(COMMANDS_BY_ID.get('abs')!, [
          parseLatexNodes(inner, diagnostics, depth + 1),
        ]);
        struct.autoSized = true;
        return [struct];
      }
    }

    if (ch === '\\') {
      const macro = readMacroName();
      if (macro === '\\\\') {
        let star = '';
        if (peek() === '*') {
          star = '*';
          pos += 1;
        }
        let scan = pos;
        while (scan < src.length && (src[scan] === ' ' || src[scan] === '\t')) scan += 1;
        if (src[scan] === '[') {
          const closeIdx = src.indexOf(']', scan + 1);
          if (closeIdx !== -1 && !src.slice(scan + 1, closeIdx).includes('\n')) {
            const gap = src.slice(scan + 1, closeIdx).trim();
            pos = closeIdx + 1;
            if (gap) return [createRawNode(`\\\\${star}[${gap}]`)];
          }
        }
        return [createRawNode('\\\\')];
      }
      if (
        macro === '\\,' ||
        macro === '\\;' ||
        macro === '\\:' ||
        macro === '\\!' ||
        macro === '\\ ' ||
        macro === '\\quad' ||
        macro === '\\qquad'
      ) {
        return [createRawNode(macro)];
      }
      if (
        macro === '\\displaystyle' ||
        macro === '\\textstyle' ||
        macro === '\\scriptstyle' ||
        macro === '\\limits' ||
        macro === '\\nolimits'
      ) {
        return [];
      }
      if (macro === '\\frac' || macro === '\\dfrac' || macro === '\\tfrac') {
        skipSpaces();
        const numRaw = peek() === '{' ? readBracedRaw() : null;
        skipSpaces();
        const denRaw = peek() === '{' ? readBracedRaw() : null;
        if (numRaw !== null && denRaw !== null) {
          const stripBraces = (s: string): string => {
            const t = s.trim();
            return t.startsWith('{') && t.endsWith('}') ? t.slice(1, -1).trim() : t;
          };
          const nthPNum = numRaw.trim().match(/^\\partial\s*\^(\{[^}]+\}|[A-Za-z0-9])\s*([\s\S]+)$/);
          const nthPDen = denRaw
            .trim()
            .match(/^\\partial\s+([A-Za-z\\][A-Za-z0-9]*)\s*\^(\{[^}]+\}|[A-Za-z0-9])$/);
          if (nthPNum && nthPDen) {
            return [
              createStructNode(COMMANDS_BY_ID.get('nth_partial')!, [
                parseLatexNodes(stripBraces(nthPNum[1]), diagnostics, depth + 1),
                parseLatexNodes(nthPNum[2].trim(), diagnostics, depth + 1),
                parseLatexNodes(nthPDen[1].trim(), diagnostics, depth + 1),
                parseLatexNodes(stripBraces(nthPDen[2]), diagnostics, depth + 1),
              ]),
            ];
          }
          const nthDNum = numRaw
            .trim()
            .match(/^\\mathrm\{d\}\s*\^(\{[^}]+\}|[A-Za-z0-9])\s*([\s\S]+)$/);
          const nthDDen = denRaw
            .trim()
            .match(/^\\mathrm\{d\}\s*([A-Za-z\\][A-Za-z0-9]*)\s*\^(\{[^}]+\}|[A-Za-z0-9])$/);
          if (nthDNum && nthDDen) {
            return [
              createStructNode(COMMANDS_BY_ID.get('nth_deriv')!, [
                parseLatexNodes(stripBraces(nthDNum[1]), diagnostics, depth + 1),
                parseLatexNodes(nthDNum[2].trim(), diagnostics, depth + 1),
                parseLatexNodes(nthDDen[1].trim(), diagnostics, depth + 1),
                parseLatexNodes(stripBraces(nthDDen[2]), diagnostics, depth + 1),
              ]),
            ];
          }
          const pNum = numRaw.trim().match(/^\\partial\s+([\s\S]+)$/);
          const pDen = denRaw.trim().match(/^\\partial\s+([\s\S]+)$/);
          if (pNum && pDen && !/^\^/.test(pNum[1].trim()) && !/^\^/.test(pDen[1].trim())) {
            return [
              createStructNode(COMMANDS_BY_ID.get('partial_frac')!, [
                parseLatexNodes(pNum[1], diagnostics, depth + 1),
                parseLatexNodes(pDen[1], diagnostics, depth + 1),
              ]),
            ];
          }
          const tNum = numRaw.trim().match(/^\\mathrm\{d\}\s*([\s\S]+)$/);
          const tDen = denRaw.trim().match(/^\\mathrm\{d\}\s*([\s\S]+)$/);
          if (tNum && tDen && !/^\^/.test(tNum[1].trim()) && !/^\^/.test(tDen[1].trim())) {
            return [
              createStructNode(COMMANDS_BY_ID.get('total_frac')!, [
                parseLatexNodes(tNum[1], diagnostics, depth + 1),
                parseLatexNodes(tDen[1], diagnostics, depth + 1),
              ]),
            ];
          }
          return [
            createStructNode(COMMANDS_BY_ID.get('frac')!, [
              parseLatexNodes(numRaw, diagnostics, depth + 1),
              parseLatexNodes(denRaw, diagnostics, depth + 1),
            ]),
          ];
        }
        const numNodes = numRaw !== null ? parseLatexNodes(numRaw, diagnostics) : readGroupNodes();
        const denNodes = denRaw !== null ? parseLatexNodes(denRaw, diagnostics) : readGroupNodes();
        return [createStructNode(COMMANDS_BY_ID.get('frac')!, [numNodes, denNodes])];
      }
      if (macro === '\\sqrt') {
        const opt = readBracketRaw();
        const body = readGroupNodes();
        return [
          createStructNode(COMMANDS_BY_ID.get('sqrt')!, [
            opt !== null ? parseLatexNodes(opt, diagnostics) : [],
            body,
          ]),
        ];
      }
      if (macro === '\\binom') {
        const n = readGroupNodes();
        const k = readGroupNodes();
        return [createStructNode(COMMANDS_BY_ID.get('binom')!, [n, k])];
      }
      if (macro === '\\int') {
        const limitsMode = readOptionalLimitsMode();
        const { sub, sup } = readSubSup();
        const body = readBigOpBody(true);
        const struct = createStructNode(COMMANDS_BY_ID.get('integral')!, [
          sub ?? [],
          sup ?? [],
          body,
        ]);
        if (limitsMode) struct.limitsMode = limitsMode;
        return [struct];
      }
      if (macro === '\\sum') {
        const limitsMode = readOptionalLimitsMode();
        const { sub, sup } = readSubSup();
        const body = readBigOpBody(false);
        const struct = createStructNode(COMMANDS_BY_ID.get('sum')!, [sub ?? [], sup ?? [], body]);
        if (limitsMode) struct.limitsMode = limitsMode;
        return [struct];
      }
      if (
        macro === '\\prod' ||
        macro === '\\bigcup' ||
        macro === '\\bigcap' ||
        macro === '\\coprod' ||
        macro === '\\bigoplus' ||
        macro === '\\bigotimes'
      ) {
        const idMap: Record<string, string> = {
          '\\prod': 'product',
          '\\bigcup': 'bigcup',
          '\\bigcap': 'bigcap',
          '\\coprod': 'coprod',
          '\\bigoplus': 'bigoplus',
          '\\bigotimes': 'bigotimes',
        };
        const cmdId = idMap[macro];
        const limitsMode = readOptionalLimitsMode();
        const { sub, sup } = readSubSup();
        const body = readBigOpBody(false);
        const struct = createStructNode(COMMANDS_BY_ID.get(cmdId)!, [
          sub ?? [],
          sup ?? [],
          body,
        ]);
        if (limitsMode) struct.limitsMode = limitsMode;
        return [struct];
      }
      if (macro === '\\iint' || macro === '\\oint' || macro === '\\iiint') {
        const idMap: Record<string, string> = {
          '\\iint': 'double_integral',
          '\\oint': 'contour_integral',
          '\\iiint': 'triple_integral',
        };
        const limitsMode = readOptionalLimitsMode();
        const { sub, sup } = readSubSup();
        const body = readBigOpBody(true);
        const struct = createStructNode(COMMANDS_BY_ID.get(idMap[macro])!, [
          sub ?? [],
          sup ?? [],
          body,
        ]);
        if (limitsMode) struct.limitsMode = limitsMode;
        return [struct];
      }
      if (macro === '\\lim') {
        const limitsMode = readOptionalLimitsMode();
        skipSpaces();
        let varNodes: MathNode[] = [];
        let targetNodes: MathNode[] = [];
        if (peek() === '_') {
          pos += 1;
          const subRaw = readSingleTokenRaw();
          // Use LaTeX macro boundary `(?![a-zA-Z])` instead of `\b` so `\lim_{x\to0^+}` splits cleanly!
          const arrowSplit = subRaw.split(/\\(?:to|rightarrow)(?![a-zA-Z])/);
          if (arrowSplit.length >= 2) {
            varNodes = parseLatexNodes(arrowSplit[0].trim(), diagnostics, depth + 1);
            targetNodes = parseLatexNodes(
              arrowSplit.slice(1).join('\\to ').trim(),
              diagnostics,
              depth + 1,
            );
          } else {
            varNodes = parseLatexNodes(subRaw, diagnostics, depth + 1);
          }
        }
        const body = readBigOpBody(false);
        const struct = createStructNode(COMMANDS_BY_ID.get('limit')!, [
          varNodes,
          targetNodes,
          body,
        ]);
        if (limitsMode) struct.limitsMode = limitsMode;
        return [struct];
      }
      if (macro === '\\overbrace') {
        const body = readGroupNodes();
        const { sup } = readSubSup();
        return [createStructNode(COMMANDS_BY_ID.get('overbrace')!, [body, sup ?? []])];
      }
      if (macro === '\\underbrace') {
        const body = readGroupNodes();
        const { sub } = readSubSup();
        return [createStructNode(COMMANDS_BY_ID.get('underbrace')!, [body, sub ?? []])];
      }
      if (macro === '\\overset') {
        const top = readGroupNodes();
        const base = readGroupNodes();
        return [createStructNode(COMMANDS_BY_ID.get('overset')!, [top, base])];
      }
      if (macro === '\\underset') {
        const bot = readGroupNodes();
        const base = readGroupNodes();
        return [createStructNode(COMMANDS_BY_ID.get('underset')!, [bot, base])];
      }
      if (macro === '\\xrightarrow' || macro === '\\xleftarrow') {
        const belowRaw = readBracketRaw();
        const above = readGroupNodes();
        const below = belowRaw !== null ? parseLatexNodes(belowRaw, diagnostics, depth + 1) : [];
        return [
          createStructNode(
            COMMANDS_BY_ID.get(macro === '\\xrightarrow' ? 'xrightarrow' : 'xleftarrow')!,
            [below, above],
          ),
        ];
      }
      if (macro === '\\cancel') {
        const body = readGroupNodes();
        return [createStructNode(COMMANDS_BY_ID.get('cancel')!, [body])];
      }
      if (macro === '\\boxed') {
        const body = readGroupNodes();
        return [createStructNode(COMMANDS_BY_ID.get('boxed')!, [body])];
      }
      if (macro === '\\substack') {
        const rawArg = readBracedRaw();
        const { rows, hasGaps } = splitMatrixRows(rawArg);
        if (!hasGaps && rows.length >= 2) {
          const parsedRows = rows.map((r) => parseLatexNodes(r, diagnostics, depth + 1));
          const struct = createStructNode(
            {
              id: 'substack_2',
              latex: '\\substack{$1 \\\\ $2}',
              slots: parsedRows.map((_, i) => `第 ${i + 1} 行`),
            },
            parsedRows,
          );
          struct.grid = { env: 'substack', rows: parsedRows.length, cols: 1 };
          return [struct];
        }
        diagnostics.push({
          severity: 'warning',
          message: `以原生 LaTeX 保留多行 \\substack`,
        });
        return [createRawNode(`\\substack{${rawArg}}`)];
      }
      if (macro === '\\pmod') {
        const body = readGroupNodes();
        return [createStructNode(COMMANDS_BY_ID.get('pmod')!, [body])];
      }
      if (macro === '\\text') {
        const arg = readBracedRaw();
        const safeArg = sanitizeLatexTemplate(arg);
        const strippedUntrusted = safeArg !== arg;
        if (strippedUntrusted) {
          diagnostics.push({
            severity: 'warning',
            message: '已过滤 \\text 内不受信任的扩展宏',
          });
        }
        const unescaped = parseLatexTextArg(safeArg);
        if (unescaped !== null) {
          return [createStructNode(COMMANDS_BY_ID.get('text_box')!, [unescaped])];
        }
        diagnostics.push({
          severity: 'warning',
          message: '含内嵌公式或特殊宏的 \\text 已以原生 LaTeX 保留',
        });
        return [createRawNode(`\\text{${safeArg}}`)];
      }
      if (ACCENT_MACRO_MAP[macro]) {
        const body = readGroupNodes();
        return [createStructNode(COMMANDS_BY_ID.get(ACCENT_MACRO_MAP[macro])!, [body])];
      }
      if (macro === '\\left') return [parseLeftRight()];
      if (macro === '\\begin') return parseEnvironment();

      if (macro === '\\mathbf' || macro === '\\mathcal') {
        const body = readGroupNodes();
        const fontId = macro === '\\mathbf' ? 'mathbf' : 'mathcal';
        return [createStructNode(COMMANDS_BY_ID.get(fontId)!, [body])];
      }

      if (macro === '\\mathbb') {
        const arg = readBracedRaw();
        const setSym = lookupSymbol(`\\mathbb{${arg}}`);
        if (setSym) return [createSymbolNode(setSym)];
        return [
          createStructNode(COMMANDS_BY_ID.get('mathbb')!, [
            parseLatexNodes(arg, diagnostics, depth + 1),
          ]),
        ];
      }

      if (macro === '\\operatorname') {
        if (peek() === '*') {
          pos += 1;
          const arg = readBracedRaw();
          return [createRawNode(`\\operatorname*{${arg}}`)];
        }
        const arg = readBracedRaw();
        if (/^[A-Za-z0-9\s-]+$/.test(arg)) {
          return [
            createStructNode(COMMANDS_BY_ID.get('operatorname')!, [
              textToCharNodes(arg, true),
            ]),
          ];
        }
        return [createRawNode(`\\operatorname{${arg}}`)];
      }

      if (
        macro === '\\mathrm' ||
        macro === '\\mathfrak' ||
        macro === '\\mathsf' ||
        macro === '\\mathtt' ||
        macro === '\\boldsymbol' ||
        macro === '\\bm' ||
        macro === '\\mathscr'
      ) {
        const arg = readBracedRaw();
        // Parse structured upright differentials `\mathrm{d}x`, `\mathrm{d}\theta`, `\mathrm{d}\vec{r}`, `\mathrm{d}^{2}x`
        if (macro === '\\mathrm' && arg.trim() === 'd') {
          const saveDiffPos = pos;
          let orderNodes: MathNode[] = [];
          if (peek() === '^') {
            pos += 1;
            orderNodes = readGroupNodes();
          }
          const beforeVarPos = pos;
          if (orderNodes.length > 0) skipSpaces();
          const nextCh = peek();
          if (nextCh && (/[A-Za-z\\]/.test(nextCh) || nextCh === '{')) {
            const varUnits = nextCh === '{' ? readGroupNodes() : parseSingleUnit();
            const diffCmd = COMMANDS_BY_ID.get('diff');
            if (diffCmd && varUnits.length > 0) {
              return [createStructNode(diffCmd, [orderNodes, varUnits])];
            }
          }
          pos = beforeVarPos === pos ? saveDiffPos : saveDiffPos;
        }
        const fontId = macro === '\\bm' ? 'boldsymbol' : macro.slice(1);
        const fontCmd = COMMANDS_BY_ID.get(fontId);
        if (fontCmd) {
          const innerNodes =
            fontId === 'mathrm' && /^[A-Za-z0-9\s-]+$/.test(arg)
              ? textToCharNodes(arg, true)
              : parseLatexNodes(arg, diagnostics, depth + 1);
          return [createStructNode(fontCmd, [innerNodes])];
        }
        return [createRawNode(`${macro}{${arg}}`)];
      }

      if (macro === '\\not') {
        skipSpaces();
        if (peek() === '=') {
          pos += 1;
          return [createSymbolNode(COMMANDS_BY_ID.get('neq')!)];
        }
        if (peek() === '<') {
          pos += 1;
          return [createSymbolNode(COMMANDS_BY_ID.get('nless')!)];
        }
        if (peek() === '>') {
          pos += 1;
          return [createSymbolNode(COMMANDS_BY_ID.get('ngtr')!)];
        }
        if (peek() === '\\') {
          const saved = pos;
          const nextM = readMacroName();
          const notMap: Record<string, string> = {
            '\\in': 'notin',
            '\\subseteq': 'nsubseteq',
            '\\supseteq': 'nsupseteq',
            '\\equiv': 'not_equiv',
            '\\le': 'nleq',
            '\\leq': 'nleq',
            '\\ge': 'ngeq',
            '\\geq': 'ngeq',
            '\\sim': 'nsim',
            '\\cong': 'ncong',
            '\\mid': 'nmid',
            '\\parallel': 'nparallel',
            '\\Rightarrow': 'nRightarrow',
            '\\Leftrightarrow': 'nLeftrightarrow',
            '\\to': 'nrightarrow',
            '\\rightarrow': 'nrightarrow',
            '\\vdash': 'nvdash',
            '\\models': 'nvDash',
          };
          const mappedId = notMap[nextM];
          if (mappedId && COMMANDS_BY_ID.has(mappedId)) {
            return [createSymbolNode(COMMANDS_BY_ID.get(mappedId)!)];
          }
          if (nextM === '\\subset') return [createRawNode('\\not\\subset')];
          pos = saved;
        }
        return [createRawNode('\\not')];
      }

      const fnName = macro.slice(1);
      if (MATH_FUNCTIONS.has(fnName)) {
        return textToCharNodes(fnName, false);
      }

      // Security: never allow imported LaTeX to inject internal DOM-tagging or link macros
      if (
        macro === '\\htmlData' ||
        macro === '\\htmlClass' ||
        macro === '\\htmlId' ||
        macro === '\\htmlStyle' ||
        macro === '\\href'
      ) {
        readBracedRaw();
        const inner = readBracedRaw();
        diagnostics.push({
          severity: 'warning',
          message: `已过滤不受信任的扩展宏 ${macro}`,
        });
        return parseLatexNodes(inner, diagnostics, depth + 1);
      }
      if (macro === '\\url' || macro === '\\includegraphics') {
        readBracketRaw();
        readBracedRaw();
        diagnostics.push({
          severity: 'warning',
          message: `已过滤不受信任的外部资源宏 ${macro}`,
        });
        return [];
      }
      if (macro === '\\tag') {
        let star = '';
        if (peek() === '*') {
          star = '*';
          pos += 1;
        }
        const tagArg = readBracedRaw();
        if (!star) {
          const tagCmd = COMMANDS_BY_ID.get('tag_eq');
          if (tagCmd) {
            return [createStructNode(tagCmd, [parseLatexNodes(tagArg, diagnostics, depth + 1)])];
          }
        }
        diagnostics.push({
          severity: 'warning',
          message: '公式包含 \\tag* 编号，仅在 $$...$$ 块级模式下可渲染',
        });
        return [createRawNode(`\\tag${star}{${tagArg}}`)];
      }

      const sym = lookupSymbol(macro);
      if (sym) return [createSymbolNode(sym)];

      if (LOSSLESS_RAW_SYMBOLS.has(macro)) {
        return [createRawNode(macro)];
      }

      if (
        macro === '\\%' ||
        macro === '\\#' ||
        macro === '\\&' ||
        macro === '\\$' ||
        macro === '\\_' ||
        macro === '\\{' ||
        macro === '\\}'
      ) {
        return [createCharNode(macro[1])];
      }

      // Special multi-arg TeX primitives with non-brace delimiter args (`\genfrac(){0pt}{}{a}{b}`)
      if (macro === '\\genfrac') {
        let rawMacro = macro;
        for (let d = 0; d < 2; d += 1) {
          skipSpaces();
          if (peek() === '{') {
            rawMacro += `{${readBracedRaw()}}`;
          } else if (peek() === '\\') {
            rawMacro += readMacroName();
          } else if (!eof()) {
            rawMacro += src[pos];
            pos += 1;
          }
        }
        for (let a = 0; a < 4; a += 1) {
          const beforeArg = pos;
          skipSpaces();
          if (peek() === '{') {
            rawMacro += `{${readBracedRaw()}}`;
          } else {
            pos = beforeArg;
            break;
          }
        }
        diagnostics.push({ severity: 'warning', message: `以原生 LaTeX 保留未内置宏 ${macro}` });
        return [createRawNode(sanitizeLatexTemplate(rawMacro))];
      }

      if (macro === '\\prescript') {
        let rawMacro = macro;
        for (let a = 0; a < 3; a += 1) {
          const beforeArg = pos;
          skipSpaces();
          if (peek() === '{') {
            rawMacro += `{${readBracedRaw()}}`;
          } else {
            pos = beforeArg;
            break;
          }
        }
        diagnostics.push({
          severity: 'warning',
          message: 'KaTeX 暂不原生支持 \\prescript，已按原生 LaTeX 保留（建议改用 {}^{a}_{b}X）',
        });
        return [createRawNode(sanitizeLatexTemplate(rawMacro))];
      }

      // Preserve unknown macro together with ALL immediately attached optional `[...]` / mandatory `{...}` arguments
      // so multi-arg macros like `\cfrac{1}{2}`, `\dbinom{n}{k}`, `\textcolor{red}{x}`, `\fcolorbox{red}{blue}{x}` never detach!
      let rawMacro = macro;
      const saveArgPos = pos;
      let consumedBraceArg = false;
      let pendingOptPrefix = '';
      for (let argIdx = 0; argIdx < 6; argIdx += 1) {
        const beforeArg = pos;
        skipSpaces();
        if (peek() === '[') {
          const optArg = readBracketRaw();
          if (optArg !== null) {
            if (consumedBraceArg) {
              rawMacro += `[${optArg}]`;
            } else {
              pendingOptPrefix += `[${optArg}]`;
            }
            continue;
          }
          pos = beforeArg;
          break;
        }
        if (peek() === '{') {
          if (pendingOptPrefix) {
            rawMacro += pendingOptPrefix;
            pendingOptPrefix = '';
          }
          rawMacro += `{${readBracedRaw()}}`;
          consumedBraceArg = true;
          continue;
        }
        pos = beforeArg;
        break;
      }
      if (!consumedBraceArg) {
        pos = saveArgPos;
      }

      diagnostics.push({ severity: 'warning', message: `以原生 LaTeX 保留未内置宏 ${macro}` });
      return [createRawNode(sanitizeLatexTemplate(rawMacro))];
    }

    if (ch === '~') {
      pos += 1;
      // In formal LaTeX, `~` is a non-breaking tie space (`a~b`), NOT `\sim`!
      return [createRawNode('~')];
    }

    pos += 1;
    // Mark plain imported ASCII letters as verbatim so formal LaTeX `x=oo+pi` or `y=dx`
    // preserves literal variable names instead of triggering interactive bare-word shorthands!
    return [createCharNode(ch, /^[A-Za-z]$/.test(ch))];
  };

  const parseTermUnits = (): MathNode[] => {
    skipSpaces();
    if (eof()) return [];
    const base = parseSingleUnit();
    if (base.length === 0) return [];

    const beforeSubSup = pos;
    skipSpaces();
    if (peek() === '^' || peek() === '_') {
      const { sub, sup } = readSubSup();
      if (sub && sup) {
        return [createStructNode(COMMANDS_BY_ID.get('subsup')!, [base, sub, sup])];
      }
      if (sup) {
        return [createStructNode(COMMANDS_BY_ID.get('sup')!, [base, sup])];
      }
      if (sub) {
        return [createStructNode(COMMANDS_BY_ID.get('sub')!, [base, sub])];
      }
    } else {
      pos = beforeSubSup;
    }

    return base;
  };

  const result: MathNode[] = [];
  while (!eof()) {
    const ch = peek();
    if (/\s/.test(ch)) {
      skipSpaces();
      const prev = result[result.length - 1];
      if (prev && prev.type === 'char' && /[A-Za-z0-9]/.test(prev.value) && /[A-Za-z0-9]/.test(peek())) {
        result.push(createCharNode(' '));
      }
      continue;
    }
    const before = pos;
    const units = parseTermUnits();
    result.push(...units);
    if (pos === before) {
      pos += 1;
    }
  }
  return result;
}

/**
 * Automatically detect MathSlot stream code vs standard LaTeX and import into Document AST.
 */
export function importFormula(input: string): ImportResult {
  if (input.includes('▸')) {
    return parseStreamCode(input);
  }
  return parseLatex(input);
}

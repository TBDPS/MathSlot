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
  COMMANDS_BY_KEYS,
  SUBMENU_KEYS,
  getSubmenuDefaultCommandId,
} from './catalog';
import {
  ACCENT_MACRO_MAP,
  SUPPORTED_MATRIX_ENVS,
  isCasesEnv,
  isSupportedColSpec,
} from './commandSpecs';
import { DIFFERENTIAL_WORDS, MATH_FUNCTIONS } from './latex';
import type { CommandDef, Diagnostic, Document, ImportResult, MathNode } from './types';

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
  '\\lor': 'lor',
  '\\vee': 'lor',
  '\\land': 'land',
  '\\wedge': 'land',
  '\\lnot': 'neg',
};

const LOSSLESS_RAW_SYMBOLS = new Set([
  '\\epsilon',
  '\\ldots',
  '\\dots',
  '\\emptyset',
  '\\varpi',
  '\\varrho',
  '\\varsigma',
  '\\varkappa',
  '\\nmid',
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

/**
 * Parse MathSlot stream code (e.g. `▸lx;0;▸fsin x;x;;`, `▸ue;i▸gp;; + 1 = 0`)
 * directly into our clean Document AST.
 */
export function parseStreamCode(source: string): ImportResult {
  const chars = Array.from(source);
  let pos = 0;
  const diagnostics: Diagnostic[] = [];

  const parseNodes = (stopAtSemicolon: boolean): MathNode[] => {
    const out: MathNode[] = [];
    while (pos < chars.length) {
      const ch = chars[pos];
      if (stopAtSemicolon && ch === ';') {
        pos += 1;
        return out;
      }
      if (ch === '▸') {
        pos += 1;
        if (pos >= chars.length) break;
        const k1 = chars[pos];
        pos += 1;
        let cmd: CommandDef | undefined;
        let legacySingleSqrt = false;
        if (k1 === 'n') {
          // Legacy `▸n3;8;` maps cleanly to unified 2-slot `sqrt`
          cmd = COMMANDS_BY_ID.get('sqrt');
        } else if (SUBMENU_KEYS.has(k1)) {
          if (pos < chars.length) {
            const k2 = chars[pos];
            cmd = COMMANDS_BY_KEYS.get(k1 + k2);
            if (cmd) {
              pos += 1;
            }
          }
          if (!cmd) {
            const defId = getSubmenuDefaultCommandId(k1);
            if (defId) cmd = COMMANDS_BY_ID.get(defId);
          }
        }
        if (!cmd) {
          if (k1 === 'u') cmd = COMMANDS_BY_ID.get('sup');
          else if (k1 === 'd') cmd = COMMANDS_BY_ID.get('sub');
          else if (k1 === 'b') cmd = COMMANDS_BY_ID.get('subsup');
          else cmd = COMMANDS_BY_KEYS.get(k1);
          if (k1 === 'r' && cmd?.id === 'sqrt') {
            legacySingleSqrt = true;
          }
        }
        if (!cmd) {
          diagnostics.push({ severity: 'warning', message: `未识别简码 ▸${k1}` });
          continue;
        }
        if (cmd.slots.length === 0) {
          out.push(createSymbolNode(cmd));
        } else if (legacySingleSqrt) {
          // Support both legacy 1-slot `▸rx;` and unified 2-slot `▸r3;8;`
          const first = parseNodes(true);
          const rest = chars.slice(pos).join('');
          const semiIdx = rest.indexOf(';');
          const nextCmdIdx = rest.indexOf('▸');
          if (semiIdx !== -1 && (nextCmdIdx === -1 || semiIdx < nextCmdIdx)) {
            const second = parseNodes(true);
            out.push(createStructNode(cmd, [first, second]));
          } else {
            out.push(createStructNode(cmd, [[], first]));
          }
        } else {
          const slotContents: MathNode[][] = [];
          for (let s = 0; s < cmd.slots.length; s += 1) {
            slotContents.push(parseNodes(true));
          }
          out.push(createStructNode(cmd, slotContents));
        }
      } else if (ch === '\\') {
        const start = pos;
        pos += 1;
        let name = '';
        while (pos < chars.length && /[a-zA-Z]/.test(chars[pos])) {
          name += chars[pos];
          pos += 1;
        }
        if (name.length > 0) {
          const macro = `\\${name}`;
          const sym = lookupSymbol(macro);
          if (sym) {
            out.push(createSymbolNode(sym));
          } else if (MATH_FUNCTIONS.has(name)) {
            out.push(...textToCharNodes(name));
          } else if (name === 'mathrm' && chars[pos] === '{') {
            pos += 1;
            let inner = '';
            let depth = 1;
            while (pos < chars.length && depth > 0) {
              if (chars[pos] === '{') depth += 1;
              else if (chars[pos] === '}') depth -= 1;
              if (depth > 0) inner += chars[pos];
              pos += 1;
            }
            out.push(createRawNode(`\\mathrm{${inner}}`));
          } else {
            out.push(createRawNode(macro));
          }
        } else {
          out.push(createCharNode(chars[start]));
        }
      } else {
        out.push(createCharNode(ch));
        pos += 1;
      }
    }
    return out;
  };

  const doc = createEmptyDocument();
  doc.root.children = parseNodes(false);
  return {
    doc,
    diagnostics,
    lossless: diagnostics.length === 0,
    hasRawNodes: slotHasRawNodes(doc.root),
  };
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
      // Strip ONLY top-level relation-alignment `&` markers so nested matrices/cases retain every column separator!
      const { cleaned, hasMultiColumn } = stripTopLevelAmpersands(body);
      if (hasMultiColumn) {
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
      // Dynamic N-row cases / dcases / rcases!
      const slotLabels: string[] = [];
      const slotContents: MathNode[][] = [];
      for (let r = 0; r < rows.length; r += 1) {
        slotLabels.push(`表达式${r + 1}`, `条件${r + 1}`);
        slotContents.push(
          parseLatexNodes(cells[r][0] ?? '', diagnostics, depth + 1),
          parseLatexNodes(cells[r][1] ?? '', diagnostics, depth + 1),
        );
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
        cols: 2,
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
          const pNum = numRaw.trim().match(/^\\partial\s+([\s\S]+)$/);
          const pDen = denRaw.trim().match(/^\\partial\s+([\s\S]+)$/);
          if (pNum && pDen) {
            return [
              createStructNode(COMMANDS_BY_ID.get('partial_frac')!, [
                parseLatexNodes(pNum[1], diagnostics),
                parseLatexNodes(pDen[1], diagnostics),
              ]),
            ];
          }
          const tNum = numRaw.trim().match(/^\\mathrm\{d\}\s*([\s\S]+)$/);
          const tDen = denRaw.trim().match(/^\\mathrm\{d\}\s*([\s\S]+)$/);
          if (tNum && tDen) {
            return [
              createStructNode(COMMANDS_BY_ID.get('total_frac')!, [
                parseLatexNodes(tNum[1], diagnostics),
                parseLatexNodes(tDen[1], diagnostics),
              ]),
            ];
          }
          return [
            createStructNode(COMMANDS_BY_ID.get('frac')!, [
              parseLatexNodes(numRaw, diagnostics),
              parseLatexNodes(denRaw, diagnostics),
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
      if (macro === '\\prod' || macro === '\\bigcup' || macro === '\\bigcap') {
        const cmdId =
          macro === '\\prod' ? 'product' : macro === '\\bigcup' ? 'bigcup' : 'bigcap';
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
        if (!hasGaps && rows.length === 2) {
          return [
            createStructNode(COMMANDS_BY_ID.get('substack_2')!, [
              parseLatexNodes(rows[0], diagnostics, depth + 1),
              parseLatexNodes(rows[1], diagnostics, depth + 1),
            ]),
          ];
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
        const unescaped = parseLatexTextArg(arg);
        if (unescaped !== null) {
          return [createStructNode(COMMANDS_BY_ID.get('text_box')!, [unescaped])];
        }
        diagnostics.push({
          severity: 'warning',
          message: '含内嵌公式或特殊宏的 \\text 已以原生 LaTeX 保留',
        });
        return [createRawNode(`\\text{${arg}}`)];
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
        macro === '\\mathtt'
      ) {
        const arg = readBracedRaw();
        return [createRawNode(`${macro}{${arg}}`)];
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
        diagnostics.push({
          severity: 'warning',
          message: '公式包含 \\tag 编号，仅在 $$...$$ 块级模式下可渲染',
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

      // Preserve unknown macro together with any immediately attached optional `[...]` / `{...}` argument(s)
      // so commands like `\phantom{x}` or `\color{red}` are never detached from their arguments.
      let rawMacro = macro;
      const saveArgPos = pos;
      skipSpaces();
      if (peek() === '[') {
        const optArg = readBracketRaw();
        if (optArg !== null) {
          skipSpaces();
          if (peek() === '{') {
            rawMacro += `[${optArg}]{${readBracedRaw()}}`;
          } else {
            pos = saveArgPos;
          }
        }
      } else if (peek() === '{') {
        rawMacro += `{${readBracedRaw()}}`;
      } else {
        pos = saveArgPos;
      }

      diagnostics.push({ severity: 'warning', message: `以原生 LaTeX 保留未内置宏 ${macro}` });
      return [createRawNode(rawMacro)];
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

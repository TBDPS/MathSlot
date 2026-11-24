import {
  createCharNode,
  createEmptyDocument,
  createRawNode,
  createSlot,
  createStructNode,
  createSymbolNode,
  textToCharNodes,
} from './ast';
import {
  COMMANDS,
  COMMANDS_BY_ID,
  COMMANDS_BY_KEYS,
  SUBMENU_KEYS,
  getSubmenuDefaultCommandId,
} from './catalog';
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
  '\\epsilon': 'epsilon',
  '\\varphi': 'phi',
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
  '\\dots': 'cdots',
  '\\ldots': 'cdots',
};

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
          out.push(createStructNode(cmd, [[], first]));
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
  };
}

function stripOuterDelimiters(input: string): string {
  let s = input.trim();
  const fenceMatch = s.match(/^```(?:latex|tex|math)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenceMatch) {
    s = fenceMatch[1].trim();
  }
  if (s.startsWith('$$') && s.endsWith('$$') && s.length >= 4) {
    return s.slice(2, -2).trim();
  }
  if (s.startsWith('\\[') && s.endsWith('\\]') && s.length >= 4) {
    return s.slice(2, -2).trim();
  }
  if (s.startsWith('\\(') && s.endsWith('\\)') && s.length >= 4) {
    return s.slice(2, -2).trim();
  }
  if (s.startsWith('$') && s.endsWith('$') && s.length >= 2 && !s.slice(1, -1).includes('$')) {
    return s.slice(1, -1).trim();
  }
  return s;
}

const ACCENT_MAP: Record<string, string> = {
  '\\hat': 'hat',
  '\\bar': 'bar',
  '\\vec': 'vec',
  '\\tilde': 'tilde',
  '\\dot': 'dot',
  '\\ddot': 'ddot',
  '\\overline': 'overline',
  '\\underline': 'underline',
};

const MATRIX_ENV_MAP: Record<string, { two: string; three: string }> = {
  pmatrix: { two: 'matrix_2x2', three: 'matrix_3x3' },
  bmatrix: { two: 'bmatrix_2x2', three: 'bmatrix_3x3' },
  vmatrix: { two: 'det_2x2', three: 'det_3x3' },
};

const SUPPORTED_MATRIX_ENVS = new Set(['pmatrix', 'bmatrix', 'vmatrix', 'Bmatrix', 'Vmatrix', 'matrix']);

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

/**
 * Clean single-pass recursive descent parser for standard mathematical LaTeX -> MathSlot Document AST.
 */
export function parseLatex(input: string): ImportResult {
  const src = stripOuterDelimiters(input);
  const diagnostics: Diagnostic[] = [];
  const nodes = parseLatexNodes(src, diagnostics);
  const doc = createEmptyDocument();
  doc.root = createSlot('公式', nodes);
  return {
    doc,
    diagnostics,
    lossless: diagnostics.length === 0,
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

  const parseLeftRight = (): MathNode => {
    skipSpaces();
    let openDelim = '';
    if (peek() === '\\') openDelim = readMacroName();
    else if (!eof()) {
      openDelim = src[pos];
      pos += 1;
    }
    const start = pos;
    let depth = 1;
    let closeDelim = '';
    while (!eof() && depth > 0) {
      if (src.startsWith('\\left', pos) && !/[a-zA-Z]/.test(src[pos + 5] ?? '')) {
        depth += 1;
        pos += 5;
        continue;
      }
      if (src.startsWith('\\right', pos) && !/[a-zA-Z]/.test(src[pos + 6] ?? '')) {
        depth -= 1;
        if (depth === 0) {
          const bodyRaw = src.slice(start, pos).trim();
          pos += 6;
          skipSpaces();
          if (peek() === '\\') closeDelim = readMacroName();
          else if (!eof()) {
            closeDelim = src[pos];
            pos += 1;
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
          else if (
            (openDelim === '\\Vert' || openDelim === '\\|') &&
            (closeDelim === '\\Vert' || closeDelim === '\\|')
          ) {
            cmdId = 'norm';
          } else if (openDelim === '\\langle' && closeDelim === '\\rangle') cmdId = 'angle';
          else if (openDelim === '\\lfloor' && closeDelim === '\\rfloor') cmdId = 'floor';
          else if (openDelim === '\\lceil' && closeDelim === '\\rceil') cmdId = 'ceil';

          if (cmdId) {
            return createStructNode(COMMANDS_BY_ID.get(cmdId)!, [
              parseLatexNodes(bodyRaw, diagnostics, depth + 1),
            ]);
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
      // Strip alignment `&` markers cleanly so lines import into editable multi-line root AST
      const cleaned = body.replace(/(?<!\\)&/g, '');
      return parseLatexNodes(cleaned, diagnostics, depth + 1);
    }

    const rows = splitTopLevel(body, '\\\\')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    const cells = rows.map((r) => splitTopLevel(r, '&').map((c) => c.trim()));

    if (envName === 'cases' && rows.length >= 1) {
      if (rows.length === 2 && cells.every((r) => r.length <= 2)) {
        return [
          createStructNode(COMMANDS_BY_ID.get('cases_2')!, [
            parseLatexNodes(cells[0][0] ?? '', diagnostics, depth + 1),
            parseLatexNodes(cells[0][1] ?? '', diagnostics, depth + 1),
            parseLatexNodes(cells[1][0] ?? '', diagnostics, depth + 1),
            parseLatexNodes(cells[1][1] ?? '', diagnostics, depth + 1),
          ]),
        ];
      }
      if (rows.length === 3 && cells.every((r) => r.length <= 2)) {
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
      // Dynamic N-row cases!
      const slotLabels: string[] = [];
      const slotContents: MathNode[][] = [];
      for (let r = 0; r < rows.length; r += 1) {
        slotLabels.push(`表达式${r + 1}`, `条件${r + 1}`);
        slotContents.push(
          parseLatexNodes(cells[r][0] ?? '', diagnostics, depth + 1),
          parseLatexNodes(cells[r][1] ?? '', diagnostics, depth + 1),
        );
      }
      const struct = createStructNode(
        { id: 'cases_2', slots: slotLabels, latex: '' },
        slotContents,
      );
      struct.grid = { env: 'cases', rows: rows.length, cols: 2 };
      return [struct];
    }

    if (SUPPORTED_MATRIX_ENVS.has(envName) && rows.length >= 1) {
      const colCount = Math.max(...cells.map((r) => r.length), 1);
      const matMap = MATRIX_ENV_MAP[envName];
      if (matMap && rows.length === 2 && colCount === 2) {
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
      if (matMap && rows.length === 3 && colCount === 3) {
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
      struct.grid = { env: envName, rows: rows.length, cols: colCount };
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
      if (macro === '\\\\') return [createRawNode('\\\\')];
      if (
        macro === '\\,' ||
        macro === '\\;' ||
        macro === '\\:' ||
        macro === '\\!' ||
        macro === '\\ ' ||
        macro === '\\quad' ||
        macro === '\\qquad'
      ) {
        return [createCharNode(' ')];
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
        const { sub, sup } = readSubSup();
        const body = readBigOpBody(true);
        return [
          createStructNode(COMMANDS_BY_ID.get('integral')!, [
            sub ?? [],
            sup ?? [],
            body,
          ]),
        ];
      }
      if (macro === '\\sum') {
        const { sub, sup } = readSubSup();
        const body = readBigOpBody(false);
        return [createStructNode(COMMANDS_BY_ID.get('sum')!, [sub ?? [], sup ?? [], body])];
      }
      if (macro === '\\prod') {
        const { sub, sup } = readSubSup();
        const body = readBigOpBody(false);
        return [createStructNode(COMMANDS_BY_ID.get('product')!, [sub ?? [], sup ?? [], body])];
      }
      if (macro === '\\iint' || macro === '\\oint' || macro === '\\iiint') {
        const idMap: Record<string, string> = {
          '\\iint': 'double_integral',
          '\\oint': 'contour_integral',
          '\\iiint': 'triple_integral',
        };
        const { sub } = readSubSup();
        const body = readBigOpBody(true);
        return [createStructNode(COMMANDS_BY_ID.get(idMap[macro])!, [sub ?? [], body])];
      }
      if (macro === '\\lim') {
        skipSpaces();
        let varNodes: MathNode[] = [];
        let targetNodes: MathNode[] = [];
        if (peek() === '_') {
          pos += 1;
          const subRaw = readSingleTokenRaw();
          const arrowSplit = subRaw.split(/\\to\b|\\rightarrow\b/);
          if (arrowSplit.length >= 2) {
            varNodes = parseLatexNodes(arrowSplit[0].trim(), diagnostics, depth + 1);
            targetNodes = parseLatexNodes(arrowSplit.slice(1).join('\\to').trim(), diagnostics, depth + 1);
          } else {
            varNodes = parseLatexNodes(subRaw, diagnostics, depth + 1);
          }
        }
        const body = readBigOpBody(false);
        return [createStructNode(COMMANDS_BY_ID.get('limit')!, [varNodes, targetNodes, body])];
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
      if (macro === '\\pmod') {
        const body = readGroupNodes();
        return [createStructNode(COMMANDS_BY_ID.get('pmod')!, [body])];
      }
      if (macro === '\\text') {
        const arg = readBracedRaw();
        return [createStructNode(COMMANDS_BY_ID.get('text_box')!, [textToCharNodes(arg)])];
      }
      if (ACCENT_MAP[macro]) {
        const body = readGroupNodes();
        return [createStructNode(COMMANDS_BY_ID.get(ACCENT_MAP[macro])!, [body])];
      }
      if (macro === '\\left') return [parseLeftRight()];
      if (macro === '\\begin') return parseEnvironment();

      if (
        macro === '\\mathrm' ||
        macro === '\\mathbf' ||
        macro === '\\mathbb' ||
        macro === '\\mathcal' ||
        macro === '\\mathfrak' ||
        macro === '\\mathsf' ||
        macro === '\\mathtt' ||
        macro === '\\operatorname'
      ) {
        const arg = readBracedRaw();
        if (macro === '\\mathbb') {
          const setSym = lookupSymbol(`\\mathbb{${arg}}`);
          if (setSym) return [createSymbolNode(setSym)];
        }
        return [createRawNode(`${macro}{${arg}}`)];
      }

      const fnName = macro.slice(1);
      if (MATH_FUNCTIONS.has(fnName)) {
        return textToCharNodes(fnName);
      }

      const sym = lookupSymbol(macro);
      if (sym) return [createSymbolNode(sym)];

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

      diagnostics.push({ severity: 'warning', message: `保留未内置宏 ${macro}` });
      return [createRawNode(macro)];
    }

    pos += 1;
    return [createCharNode(ch)];
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

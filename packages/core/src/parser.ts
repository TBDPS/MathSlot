import {
  createCharNode,
  createEmptyDocument,
  createRawNode,
  createSlot,
  createStructNode,
  createSymbolNode,
  textToCharNodes,
} from './ast';
import { COMMANDS, COMMANDS_BY_ID, COMMANDS_BY_KEYS, SUBMENU_KEYS } from './catalog';
import { MATH_FUNCTIONS } from './latex';
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
  '\\lor': 'vee',
  '\\land': 'wedge',
  '\\lnot': 'neg',
  '\\|': 'norm',
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
        if (SUBMENU_KEYS.has(k1) && pos < chars.length) {
          const k2 = chars[pos];
          cmd = COMMANDS_BY_KEYS.get(k1 + k2);
          if (cmd) {
            pos += 1;
          }
        }
        if (!cmd) {
          cmd = COMMANDS_BY_KEYS.get(k1);
        }
        if (!cmd) {
          diagnostics.push({ severity: 'warning', message: `未识别简码 ▸${k1}` });
          continue;
        }
        if (cmd.slots.length === 0) {
          out.push(createSymbolNode(cmd));
        } else {
          const slotContents: MathNode[][] = [];
          for (let s = 0; s < cmd.slots.length; s += 1) {
            slotContents.push(parseNodes(true));
          }
          out.push(createStructNode(cmd, slotContents));
        }
      } else if (ch === '\\') {
        // Allow mixed LaTeX macros inside stream presets (e.g. `\le`, `\mathrm{d}`)
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

/**
 * Recursive descent parser for standard mathematical LaTeX -> MathSlot Document AST.
 */
export function parseLatex(input: string): ImportResult {
  const src = stripOuterDelimiters(input);
  const diagnostics: Diagnostic[] = [];
  let pos = 0;

  const peek = () => src[pos] ?? '';
  const eof = () => pos >= src.length;

  const skipSpaces = () => {
    while (!eof() && /\s/.test(src[pos])) pos += 1;
  };

  const readMacroName = (): string => {
    // Assumes src[pos] === '\\'
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

  const readGroupNodes = (): MathNode[] => {
    skipSpaces();
    if (peek() === '{') {
      const raw = readBracedRaw();
      return parseFragment(raw);
    }
    const single = parseAtom();
    return single ? [single] : [];
  };

  const parseFragment = (fragment: string): MathNode[] => {
    const savedPos = pos;
    const inner = parseLatexNodes(fragment, diagnostics);
    pos = savedPos;
    return inner;
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
    if (peek() === '\\') {
      openDelim = readMacroName();
    } else if (!eof()) {
      openDelim = src[pos];
      pos += 1;
    }

    // Read until matching \right
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

          // Special case: \left. F \right|_{a}^{b} or \right\|_{a}^{b}
          if (openDelim === '.' && (closeDelim === '|' || closeDelim === '\\|')) {
            const { sub, sup } = readSubSup();
            const cmd = COMMANDS_BY_ID.get('eval_bar')!;
            return createStructNode(cmd, [
              parseFragment(bodyRaw),
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
            const cmd = COMMANDS_BY_ID.get(cmdId)!;
            return createStructNode(cmd, [parseFragment(bodyRaw)]);
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

  const parseEnvironment = (): MathNode => {
    const envName = readBracedRaw().trim();
    const endToken = `\\end{${envName}}`;
    const endIdx = src.indexOf(endToken, pos);
    if (endIdx === -1) {
      diagnostics.push({ severity: 'error', message: `缺少 \\end{${envName}}` });
      const rest = src.slice(pos);
      pos = src.length;
      return createRawNode(`\\begin{${envName}}${rest}`);
    }
    const body = src.slice(pos, endIdx).trim();
    pos = endIdx + endToken.length;

    if (envName === 'gathered' || envName === 'aligned') {
      return createRawNode(`\\begin{${envName}}${body}\\end{${envName}}`);
    }

    const rows = body.split('\\\\').map((r) => r.trim()).filter((r) => r.length > 0);
    const cells = rows.map((r) => r.split('&').map((c) => c.trim()));

    if (envName === 'cases') {
      if (rows.length === 2 && cells.every((r) => r.length <= 2)) {
        const cmd = COMMANDS_BY_ID.get('cases_2')!;
        return createStructNode(cmd, [
          parseFragment(cells[0][0] ?? ''),
          parseFragment(cells[0][1] ?? ''),
          parseFragment(cells[1][0] ?? ''),
          parseFragment(cells[1][1] ?? ''),
        ]);
      }
      if (rows.length === 3 && cells.every((r) => r.length <= 2)) {
        const cmd = COMMANDS_BY_ID.get('cases_3')!;
        return createStructNode(cmd, [
          parseFragment(cells[0][0] ?? ''),
          parseFragment(cells[0][1] ?? ''),
          parseFragment(cells[1][0] ?? ''),
          parseFragment(cells[1][1] ?? ''),
          parseFragment(cells[2][0] ?? ''),
          parseFragment(cells[2][1] ?? ''),
        ]);
      }
    }

    const matMap = MATRIX_ENV_MAP[envName];
    if (matMap) {
      if (rows.length === 2 && cells.every((r) => r.length === 2)) {
        const cmd = COMMANDS_BY_ID.get(matMap.two)!;
        return createStructNode(
          cmd,
          cells.flat().map((c) => parseFragment(c)),
        );
      }
      if (rows.length === 3 && cells.every((r) => r.length === 3)) {
        const cmd = COMMANDS_BY_ID.get(matMap.three)!;
        return createStructNode(
          cmd,
          cells.flat().map((c) => parseFragment(c)),
        );
      }
    }

    diagnostics.push({ severity: 'warning', message: `以原生 LaTeX 保留环境 ${envName}` });
    return createRawNode(`\\begin{${envName}}${body}\\end{${envName}}`);
  };

  const readBigOpBody = (): MathNode[] => {
    skipSpaces();
    const out: MathNode[] = [];
    while (!eof()) {
      const ch = peek();
      if (ch === '=' || ch === ',' || ch === ';' || ch === ')' || ch === ']') break;
      if (ch === '+' || ch === '-') {
        if (out.length > 0) break;
      }
      if (src.startsWith('\\\\', pos)) break;
      const node = parseTerm();
      if (!node) break;
      out.push(node);
    }
    return out;
  };

  const parseAtom = (): MathNode | null => {
    skipSpaces();
    if (eof()) return null;
    const ch = peek();

    if (ch === '{') {
      const raw = readBracedRaw();
      const inner = parseFragment(raw);
      if (inner.length === 1) return inner[0];
      // Check if immediately followed by ^ or _ — attach to group
      return createRawNode(`{${raw}}`);
    }

    if (ch === '\\') {
      const macro = readMacroName();

      if (macro === '\\\\') {
        return createRawNode('\\\\');
      }
      if (macro === '\\,' || macro === '\\;' || macro === '\\!' || macro === '\\ ') {
        return createCharNode(' ');
      }
      if (macro === '\\frac') {
        const numRaw = readBracedRaw();
        const denRaw = readBracedRaw();
        // Recognize partial_frac and total_frac cleanly
        const pNum = numRaw.trim().match(/^\\partial\s+([\s\S]+)$/);
        const pDen = denRaw.trim().match(/^\\partial\s+([\s\S]+)$/);
        if (pNum && pDen) {
          return createStructNode(COMMANDS_BY_ID.get('partial_frac')!, [
            parseFragment(pNum[1]),
            parseFragment(pDen[1]),
          ]);
        }
        const tNum = numRaw.trim().match(/^\\mathrm\{d\}\s*([\s\S]+)$/);
        const tDen = denRaw.trim().match(/^\\mathrm\{d\}\s*([\s\S]+)$/);
        if (tNum && tDen) {
          return createStructNode(COMMANDS_BY_ID.get('total_frac')!, [
            parseFragment(tNum[1]),
            parseFragment(tDen[1]),
          ]);
        }
        return createStructNode(COMMANDS_BY_ID.get('frac')!, [
          parseFragment(numRaw),
          parseFragment(denRaw),
        ]);
      }
      if (macro === '\\sqrt') {
        const opt = readBracketRaw();
        const body = readGroupNodes();
        if (opt !== null) {
          return createStructNode(COMMANDS_BY_ID.get('nth_root')!, [
            parseFragment(opt),
            body,
          ]);
        }
        return createStructNode(COMMANDS_BY_ID.get('sqrt')!, [body]);
      }
      if (macro === '\\binom') {
        const n = readGroupNodes();
        const k = readGroupNodes();
        return createStructNode(COMMANDS_BY_ID.get('binom')!, [n, k]);
      }
      if (macro === '\\int') {
        const { sub, sup } = readSubSup();
        const body = readBigOpBody();
        if (sub || sup) {
          return createStructNode(COMMANDS_BY_ID.get('integral')!, [
            sub ?? [],
            sup ?? [],
            body,
          ]);
        }
        return createStructNode(COMMANDS_BY_ID.get('indef_integral')!, [body]);
      }
      if (macro === '\\sum') {
        const { sub, sup } = readSubSup();
        const body = readBigOpBody();
        return createStructNode(COMMANDS_BY_ID.get('sum')!, [
          sub ?? [],
          sup ?? [],
          body,
        ]);
      }
      if (macro === '\\prod') {
        const { sub, sup } = readSubSup();
        const body = readBigOpBody();
        return createStructNode(COMMANDS_BY_ID.get('product')!, [
          sub ?? [],
          sup ?? [],
          body,
        ]);
      }
      if (macro === '\\iint' || macro === '\\oint' || macro === '\\iiint') {
        const idMap: Record<string, string> = {
          '\\iint': 'double_integral',
          '\\oint': 'contour_integral',
          '\\iiint': 'triple_integral',
        };
        const { sub } = readSubSup();
        const body = readBigOpBody();
        return createStructNode(COMMANDS_BY_ID.get(idMap[macro])!, [sub ?? [], body]);
      }
      if (macro === '\\lim') {
        skipSpaces();
        let varNodes: MathNode[] = [];
        let targetNodes: MathNode[] = [];
        if (peek() === '_') {
          pos += 1;
          const subRaw = peek() === '{' ? readBracedRaw() : '';
          const arrowSplit = subRaw.split(/\\to\b|\\rightarrow\b/);
          if (arrowSplit.length >= 2) {
            varNodes = parseFragment(arrowSplit[0].trim());
            targetNodes = parseFragment(arrowSplit.slice(1).join('\\to').trim());
          } else {
            varNodes = parseFragment(subRaw);
          }
        }
        const body = readBigOpBody();
        return createStructNode(COMMANDS_BY_ID.get('limit')!, [
          varNodes,
          targetNodes,
          body,
        ]);
      }
      if (macro === '\\overbrace') {
        const body = readGroupNodes();
        const { sup } = readSubSup();
        return createStructNode(COMMANDS_BY_ID.get('overbrace')!, [body, sup ?? []]);
      }
      if (macro === '\\underbrace') {
        const body = readGroupNodes();
        const { sub } = readSubSup();
        return createStructNode(COMMANDS_BY_ID.get('underbrace')!, [body, sub ?? []]);
      }
      if (ACCENT_MAP[macro]) {
        const body = readGroupNodes();
        return createStructNode(COMMANDS_BY_ID.get(ACCENT_MAP[macro])!, [body]);
      }
      if (macro === '\\left') {
        return parseLeftRight();
      }
      if (macro === '\\begin') {
        return parseEnvironment();
      }
      if (macro === '\\mathrm' || macro === '\\mathbf' || macro === '\\mathbb' || macro === '\\mathcal' || macro === '\\text') {
        const arg = readBracedRaw();
        return createRawNode(`${macro}{${arg}}`);
      }

      const fnName = macro.slice(1);
      if (MATH_FUNCTIONS.has(fnName)) {
        // Return first char and handle via caller? Better: wrap as RawNode or char list?
        // Actually returning RawNode(macro) preserves exact TeX function cleanly!
        return createRawNode(macro);
      }

      const sym = lookupSymbol(macro);
      if (sym) {
        return createSymbolNode(sym);
      }

      // Escaped literal punctuation
      if (macro === '\\%' || macro === '\\#' || macro === '\\&' || macro === '\\$' || macro === '\\_') {
        return createCharNode(macro[1]);
      }

      diagnostics.push({ severity: 'warning', message: `保留未内置宏 ${macro}` });
      return createRawNode(macro);
    }

    pos += 1;
    return createCharNode(ch);
  };

  const parseTerm = (): MathNode | null => {
    skipSpaces();
    if (eof()) return null;

    // Special case: `{base}^{sup}` or `{base}_{sub}` -> unwrap base directly into sup/sub/subsup!
    let baseNodes: MathNode[] | null = null;
    if (peek() === '{') {
      const raw = readBracedRaw();
      baseNodes = parseFragment(raw);
    } else {
      const atom = parseAtom();
      if (!atom) return null;
      baseNodes = [atom];
    }

    skipSpaces();
    if (peek() === '^' || peek() === '_') {
      const { sub, sup } = readSubSup();
      if (sub && sup) {
        return createStructNode(COMMANDS_BY_ID.get('subsup')!, [baseNodes, sub, sup]);
      }
      if (sup) {
        return createStructNode(COMMANDS_BY_ID.get('sup')!, [baseNodes, sup]);
      }
      if (sub) {
        return createStructNode(COMMANDS_BY_ID.get('sub')!, [baseNodes, sub]);
      }
    }

    if (baseNodes.length === 1) return baseNodes[0];
    return createRawNode(`{${baseNodes.map((n) => (n.type === 'char' ? n.value : '')).join('')}}`);
  };

  // Top-level parse loop
  const nodes = parseLatexNodes(src, diagnostics);
  const doc = createEmptyDocument();
  doc.root = createSlot('公式', nodes);
  // Reference helper to keep TS happy if unused
  void parseTerm;
  return {
    doc,
    diagnostics,
    lossless: diagnostics.length === 0,
  };
}

function parseLatexNodes(src: string, diagnostics: Diagnostic[]): MathNode[] {
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

  const readGroupNodes = (): MathNode[] => {
    skipSpaces();
    if (peek() === '{') {
      return parseLatexNodes(readBracedRaw(), diagnostics);
    }
    const single = parseSingleUnit();
    return single;
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
              parseLatexNodes(bodyRaw, diagnostics),
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
              parseLatexNodes(bodyRaw, diagnostics),
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
    const endToken = `\\end{${envName}}`;
    const endIdx = src.indexOf(endToken, pos);
    if (endIdx === -1) {
      diagnostics.push({ severity: 'error', message: `缺少 \\end{${envName}}` });
      const rest = src.slice(pos);
      pos = src.length;
      return [createRawNode(`\\begin{${envName}}${rest}`)];
    }
    const body = src.slice(pos, endIdx).trim();
    pos = endIdx + endToken.length;

    if (envName === 'gathered' || envName === 'equation' || envName === 'equation*' || envName === 'gather' || envName === 'gather*') {
      return parseLatexNodes(body, diagnostics);
    }

    const rows = body.split('\\\\').map((r) => r.trim()).filter((r) => r.length > 0);
    const cells = rows.map((r) => r.split('&').map((c) => c.trim()));

    if (envName === 'cases') {
      if (rows.length === 2 && cells.every((r) => r.length <= 2)) {
        return [
          createStructNode(COMMANDS_BY_ID.get('cases_2')!, [
            parseLatexNodes(cells[0][0] ?? '', diagnostics),
            parseLatexNodes(cells[0][1] ?? '', diagnostics),
            parseLatexNodes(cells[1][0] ?? '', diagnostics),
            parseLatexNodes(cells[1][1] ?? '', diagnostics),
          ]),
        ];
      }
      if (rows.length === 3 && cells.every((r) => r.length <= 2)) {
        return [
          createStructNode(COMMANDS_BY_ID.get('cases_3')!, [
            parseLatexNodes(cells[0][0] ?? '', diagnostics),
            parseLatexNodes(cells[0][1] ?? '', diagnostics),
            parseLatexNodes(cells[1][0] ?? '', diagnostics),
            parseLatexNodes(cells[1][1] ?? '', diagnostics),
            parseLatexNodes(cells[2][0] ?? '', diagnostics),
            parseLatexNodes(cells[2][1] ?? '', diagnostics),
          ]),
        ];
      }
    }

    const matMap = MATRIX_ENV_MAP[envName];
    if (matMap) {
      if (rows.length === 2 && cells.every((r) => r.length === 2)) {
        return [
          createStructNode(
            COMMANDS_BY_ID.get(matMap.two)!,
            cells.flat().map((c) => parseLatexNodes(c, diagnostics)),
          ),
        ];
      }
      if (rows.length === 3 && cells.every((r) => r.length === 3)) {
        return [
          createStructNode(
            COMMANDS_BY_ID.get(matMap.three)!,
            cells.flat().map((c) => parseLatexNodes(c, diagnostics)),
          ),
        ];
      }
    }

    diagnostics.push({ severity: 'warning', message: `以原生 LaTeX 保留环境 ${envName}` });
    return [createRawNode(`\\begin{${envName}}${body}\\end{${envName}}`)];
  };

  const readBigOpBody = (): MathNode[] => {
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
      const before = pos;
      const units = parseTermUnits();
      if (units.length === 0 && pos === before) break;
      out.push(...units);
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
      return parseLatexNodes(raw, diagnostics);
    }

    if (ch === '\\') {
      const macro = readMacroName();
      if (macro === '\\\\') return [createRawNode('\\\\')];
      if (macro === '\\,' || macro === '\\;' || macro === '\\:' || macro === '\\!' || macro === '\\ ' || macro === '\\quad' || macro === '\\qquad') {
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
        if (opt !== null) {
          return [
            createStructNode(COMMANDS_BY_ID.get('nth_root')!, [
              parseLatexNodes(opt, diagnostics),
              body,
            ]),
          ];
        }
        return [createStructNode(COMMANDS_BY_ID.get('sqrt')!, [body])];
      }
      if (macro === '\\binom') {
        const n = readGroupNodes();
        const k = readGroupNodes();
        return [createStructNode(COMMANDS_BY_ID.get('binom')!, [n, k])];
      }
      if (macro === '\\int') {
        const { sub, sup } = readSubSup();
        const body = readBigOpBody();
        if (sub || sup) {
          return [
            createStructNode(COMMANDS_BY_ID.get('integral')!, [
              sub ?? [],
              sup ?? [],
              body,
            ]),
          ];
        }
        return [createStructNode(COMMANDS_BY_ID.get('indef_integral')!, [body])];
      }
      if (macro === '\\sum') {
        const { sub, sup } = readSubSup();
        const body = readBigOpBody();
        return [createStructNode(COMMANDS_BY_ID.get('sum')!, [sub ?? [], sup ?? [], body])];
      }
      if (macro === '\\prod') {
        const { sub, sup } = readSubSup();
        const body = readBigOpBody();
        return [createStructNode(COMMANDS_BY_ID.get('product')!, [sub ?? [], sup ?? [], body])];
      }
      if (macro === '\\iint' || macro === '\\oint' || macro === '\\iiint') {
        const idMap: Record<string, string> = {
          '\\iint': 'double_integral',
          '\\oint': 'contour_integral',
          '\\iiint': 'triple_integral',
        };
        const { sub } = readSubSup();
        const body = readBigOpBody();
        return [createStructNode(COMMANDS_BY_ID.get(idMap[macro])!, [sub ?? [], body])];
      }
      if (macro === '\\lim') {
        skipSpaces();
        let varNodes: MathNode[] = [];
        let targetNodes: MathNode[] = [];
        if (peek() === '_') {
          pos += 1;
          const subRaw = peek() === '{' ? readBracedRaw() : '';
          const arrowSplit = subRaw.split(/\\to\b|\\rightarrow\b/);
          if (arrowSplit.length >= 2) {
            varNodes = parseLatexNodes(arrowSplit[0].trim(), diagnostics);
            targetNodes = parseLatexNodes(arrowSplit.slice(1).join('\\to').trim(), diagnostics);
          } else {
            varNodes = parseLatexNodes(subRaw, diagnostics);
          }
        }
        const body = readBigOpBody();
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
      if (ACCENT_MAP[macro]) {
        const body = readGroupNodes();
        return [createStructNode(COMMANDS_BY_ID.get(ACCENT_MAP[macro])!, [body])];
      }
      if (macro === '\\left') {
        return [parseLeftRight()];
      }
      if (macro === '\\begin') {
        return parseEnvironment();
      }
      if (
        macro === '\\mathrm' ||
        macro === '\\mathbf' ||
        macro === '\\mathbb' ||
        macro === '\\mathcal' ||
        macro === '\\mathfrak' ||
        macro === '\\boldsymbol' ||
        macro === '\\text' ||
        macro === '\\textbf' ||
        macro === '\\textit' ||
        macro === '\\operatorname'
      ) {
        const arg = readBracedRaw();
        return [createRawNode(`${macro}{${arg}}`)];
      }

      const fnName = macro.slice(1);
      if (MATH_FUNCTIONS.has(fnName)) {
        return textToCharNodes(fnName);
      }

      const sym = lookupSymbol(macro);
      if (sym) {
        return [createSymbolNode(sym)];
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

    // Check immediately following ^ or _ (skipping only spaces)
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
      // Preserve a single meaningful space between adjacent alphanumeric tokens
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

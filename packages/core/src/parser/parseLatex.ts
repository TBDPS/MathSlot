import {
  createCharNode,
  createEmptyDocument,
  createRawNode,
  createSlot,
  createStructNode,
  createSymbolNode,
  slotHasRawNodes,
  textToCharNodes,
} from '../ast';
import { COMMANDS, COMMANDS_BY_ID } from '../catalog';
import { sanitizeLatexTemplate } from '../commandSpecs';
import { MATH_FUNCTIONS } from '../emitIr';
import { DIFFERENTIAL_WORDS } from '../shorthands';
import type { CommandDef, Diagnostic, ImportResult, MathNode } from '../types';
import {
  hasMultipleWrappedFormulas,
  parseEnvironmentBody,
  parseMatchedLeftRight,
  splitMatrixRows,
  splitTopLevelInfixMacro,
  stripOuterDelimiters,
  stripTexComments,
} from './delimitersAndEnvs';
import { tryParseMacroByRule } from './ruleEngine';

const SYMBOL_BY_LATEX = new Map<string, CommandDef>();
for (const cmd of COMMANDS) {
  if (cmd.slots.length === 0) {
    SYMBOL_BY_LATEX.set(cmd.latex.trim(), cmd);
  }
}

const SYMBOL_ALIASES: Readonly<Record<string, string>> = {
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
  '\\subsetneq',
  '\\preceq',
  '\\succeq',
  '\\longrightarrow',
  '\\longleftarrow',
  '\\rightleftharpoons',
  '\\backslash',
  '\\ast',
  '\\angle',
]);

const BIGOP_BOUNDARY_MACROS = new Set([
  '\\int',
  '\\iint',
  '\\iiint',
  '\\oint',
  '\\sum',
  '\\prod',
  '\\bigcup',
  '\\bigcap',
  '\\coprod',
  '\\bigoplus',
  '\\bigotimes',
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

const NOT_SYMBOL_MAP: Readonly<Record<string, string>> = {
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

function lookupSymbol(macro: string): CommandDef | undefined {
  const direct = SYMBOL_BY_LATEX.get(macro);
  if (direct) return direct;
  const aliasId = SYMBOL_ALIASES[macro];
  return aliasId ? COMMANDS_BY_ID.get(aliasId) : undefined;
}

function endsWithDifferential(nodes: readonly MathNode[]): boolean {
  if (nodes.length === 0) return false;
  const last = nodes[nodes.length - 1];
  if (last.type === 'struct' && last.commandId === 'diff') return true;
  const prev = nodes.length >= 2 ? nodes[nodes.length - 2] : undefined;
  if (
    prev?.type === 'raw' &&
    prev.latex === '\\mathrm{d}' &&
    ((last.type === 'char' && /^[a-zA-Z]$/.test(last.value)) || last.type === 'symbol')
  ) {
    return true;
  }
  if (last.type === 'char' && /^[a-zA-Z]$/.test(last.value)) {
    let i = nodes.length - 1;
    let word = '';
    while (i >= 0 && nodes[i].type === 'char' && /^[a-zA-Z]$/.test((nodes[i] as { value: string }).value)) {
      word = (nodes[i] as { value: string }).value + word;
      i -= 1;
    }
    if (DIFFERENTIAL_WORDS[word]) return true;
  }
  return false;
}

const MAX_PARSE_DEPTH = 64;

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

export function parseLatexNodes(src: string, diagnostics: Diagnostic[], depth = 0): MathNode[] {
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
  const parseNested = (raw: string) => parseLatexNodes(raw, diagnostics, depth + 1);

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
    let bDepth = 1;
    while (!eof() && bDepth > 0) {
      if (src[pos] === '\\') {
        pos += 2;
        continue;
      }
      if (src[pos] === '{') bDepth += 1;
      else if (src[pos] === '}') bDepth -= 1;
      if (bDepth > 0) pos += 1;
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
    let bDepth = 1;
    while (!eof() && bDepth > 0) {
      if (src[pos] === '\\') {
        pos += 2;
        continue;
      }
      if (src[pos] === '[') bDepth += 1;
      else if (src[pos] === ']') bDepth -= 1;
      if (bDepth > 0) pos += 1;
    }
    const content = src.slice(start, pos);
    if (peek() === ']') pos += 1;
    else diagnostics.push({ severity: 'error', message: '缺少闭合方括号 ]' });
    return content;
  };

  const tryReadPlainDelimRaw = (openCh: '(' | '[', closeCh: ')' | ']'): string | null => {
    if (peek() !== openCh) return null;
    let scan = pos + 1;
    let d = 1;
    let braceDepth = 0;
    while (scan < src.length && d > 0) {
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
        if (src[scan] === openCh) d += 1;
        else if (src[scan] === closeCh) d -= 1;
      }
      if (d > 0) scan += 1;
    }
    if (d !== 0) return null;
    const inner = src.slice(pos + 1, scan);
    pos = scan + 1;
    return inner;
  };

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
        if (braceDepth === 0 && parenDepth === 0 && bracketDepth === 0 && lrDepth === 0 && src[scan + 1] === '\\') {
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
            if (!inner.trim() || (/^\s/.test(inner) && /\s$/.test(inner))) return null;
            pos = scan + 1;
            return inner;
          }
          if (c === '=' || c === ',' || c === ';' || c === '&' || c === '<' || c === '>') return null;
        }
      }
      scan += 1;
    }
    return null;
  };

  const readGroupNodes = (): MathNode[] => {
    skipSpaces();
    if (peek() === '{') return parseNested(readBracedRaw());
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
        if (closeIdx >= arg.length || arg[closeIdx] !== '$') return null;
        out.push(createStructNode(COMMANDS_BY_ID.get('inline_math')!, [parseNested(arg.slice(i + 1, closeIdx))]));
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
        if (next === '_' || next === '%' || next === '&' || next === '#' || next === '$' || next === '{' || next === '}') {
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
          let closeDelim = '';
          if (peek() === '\\') closeDelim = readMacroName();
          else if (!eof()) {
            closeDelim = src[pos];
            pos += 1;
          }
          return parseMatchedLeftRight(openDelim, closeDelim, bodyRaw, readSubSup, diagnostics, parseNested);
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
    return parseEnvironmentBody(envName, body, depth, diagnostics, parseNested);
  };

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
      if (out.length > 0 && ch === '\\') {
        const nextMacro = peekMacroName();
        if (nextMacro && BIGOP_BOUNDARY_MACROS.has(nextMacro)) break;
      }
      const before = pos;
      const units = parseTermUnits();
      if (units.length === 0 && pos === before) break;
      out.push(...units);
      if (isIntegral && endsWithDifferential(out)) break;
    }
    return out;
  };

  const parseFractionMacro = (): MathNode[] => {
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
      const nthPDen = denRaw.trim().match(/^\\partial\s+([A-Za-z\\][A-Za-z0-9]*)\s*\^(\{[^}]+\}|[A-Za-z0-9])$/);
      if (nthPNum && nthPDen) {
        return [
          createStructNode(COMMANDS_BY_ID.get('nth_partial')!, [
            parseNested(stripBraces(nthPNum[1])),
            parseNested(nthPNum[2].trim()),
            parseNested(nthPDen[1].trim()),
            parseNested(stripBraces(nthPDen[2])),
          ]),
        ];
      }
      const nthDNum = numRaw.trim().match(/^\\mathrm\{d\}\s*\^(\{[^}]+\}|[A-Za-z0-9])\s*([\s\S]+)$/);
      const nthDDen = denRaw.trim().match(/^\\mathrm\{d\}\s*([A-Za-z\\][A-Za-z0-9]*)\s*\^(\{[^}]+\}|[A-Za-z0-9])$/);
      if (nthDNum && nthDDen) {
        return [
          createStructNode(COMMANDS_BY_ID.get('nth_deriv')!, [
            parseNested(stripBraces(nthDNum[1])),
            parseNested(nthDNum[2].trim()),
            parseNested(nthDDen[1].trim()),
            parseNested(stripBraces(nthDDen[2])),
          ]),
        ];
      }
      const pNum = numRaw.trim().match(/^\\partial\s+([\s\S]+)$/);
      const pDen = denRaw.trim().match(/^\\partial\s+([\s\S]+)$/);
      if (pNum && pDen && !/^\^/.test(pNum[1].trim()) && !/^\^/.test(pDen[1].trim())) {
        return [createStructNode(COMMANDS_BY_ID.get('partial_frac')!, [parseNested(pNum[1]), parseNested(pDen[1])])];
      }
      const tNum = numRaw.trim().match(/^\\mathrm\{d\}\s*([\s\S]+)$/);
      const tDen = denRaw.trim().match(/^\\mathrm\{d\}\s*([\s\S]+)$/);
      if (tNum && tDen && !/^\^/.test(tNum[1].trim()) && !/^\^/.test(tDen[1].trim())) {
        return [createStructNode(COMMANDS_BY_ID.get('total_frac')!, [parseNested(tNum[1]), parseNested(tDen[1])])];
      }
      return [createStructNode(COMMANDS_BY_ID.get('frac')!, [parseNested(numRaw), parseNested(denRaw)])];
    }
    const numNodes = numRaw !== null ? parseNested(numRaw) : readGroupNodes();
    const denNodes = denRaw !== null ? parseNested(denRaw) : readGroupNodes();
    return [createStructNode(COMMANDS_BY_ID.get('frac')!, [numNodes, denNodes])];
  };

  const ruleCtx = {
    readBracketRaw,
    readGroupNodes,
    readSubSup,
    readOptionalLimitsMode,
    readBigOpBody,
    parseNested,
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
      const infixOver = splitTopLevelInfixMacro(raw, '\\over');
      if (infixOver) {
        return [createStructNode(COMMANDS_BY_ID.get('frac')!, [parseNested(infixOver[0]), parseNested(infixOver[1])])];
      }
      const infixChoose = splitTopLevelInfixMacro(raw, '\\choose');
      if (infixChoose) {
        return [createStructNode(COMMANDS_BY_ID.get('binom')!, [parseNested(infixChoose[0]), parseNested(infixChoose[1])])];
      }
      return parseNested(raw);
    }

    if (ch === '(') {
      const inner = tryReadPlainDelimRaw('(', ')');
      if (inner !== null) {
        const struct = createStructNode(COMMANDS_BY_ID.get('paren')!, [parseNested(inner)]);
        struct.autoSized = true;
        return [struct];
      }
    }
    if (ch === '[') {
      const inner = tryReadPlainDelimRaw('[', ']');
      if (inner !== null) {
        const struct = createStructNode(COMMANDS_BY_ID.get('bracket')!, [parseNested(inner)]);
        struct.autoSized = true;
        return [struct];
      }
    }
    if (ch === '|') {
      const inner = tryReadPlainAbsRaw();
      if (inner !== null) {
        const struct = createStructNode(COMMANDS_BY_ID.get('abs')!, [parseNested(inner)]);
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
      if (macro === '\\,' || macro === '\\;' || macro === '\\:' || macro === '\\!' || macro === '\\ ' || macro === '\\quad' || macro === '\\qquad') {
        return [createRawNode(macro)];
      }
      if (macro === '\\displaystyle' || macro === '\\textstyle' || macro === '\\scriptstyle' || macro === '\\limits' || macro === '\\nolimits') {
        return [];
      }
      if (macro === '\\frac' || macro === '\\dfrac' || macro === '\\tfrac') {
        return parseFractionMacro();
      }

      // Declarative rule engine handles 25+ structural macros (`\sqrt`, `\binom`, all 11 bigops, accents, fonts, arrows, etc.)!
      const byRule = tryParseMacroByRule(macro, ruleCtx);
      if (byRule) return byRule;

      // Context-sensitive irregular TeX grammar hooks
      if (macro === '\\lim') {
        const limitsMode = readOptionalLimitsMode();
        skipSpaces();
        let varNodes: MathNode[] = [];
        let targetNodes: MathNode[] = [];
        if (peek() === '_') {
          pos += 1;
          const subRaw = readSingleTokenRaw();
          const arrowSplit = subRaw.split(/\\(?:to|rightarrow)(?![a-zA-Z])/);
          if (arrowSplit.length >= 2) {
            varNodes = parseNested(arrowSplit[0].trim());
            targetNodes = parseNested(arrowSplit.slice(1).join('\\to ').trim());
          } else {
            varNodes = parseNested(subRaw);
          }
        }
        const body = readBigOpBody(false);
        const struct = createStructNode(COMMANDS_BY_ID.get('limit')!, [varNodes, targetNodes, body]);
        if (limitsMode) struct.limitsMode = limitsMode;
        return [struct];
      }
      if (macro === '\\substack') {
        const rawArg = readBracedRaw();
        const { rows, hasGaps } = splitMatrixRows(rawArg);
        if (!hasGaps && rows.length >= 2) {
          const parsedRows = rows.map((r) => parseNested(r));
          const struct = createStructNode(
            { id: 'substack_2', latex: '\\substack{$1 \\\\ $2}', slots: parsedRows.map((_, i) => `第 ${i + 1} 行`) },
            parsedRows,
          );
          struct.grid = { env: 'substack', rows: parsedRows.length, cols: 1 };
          return [struct];
        }
        diagnostics.push({ severity: 'warning', message: '以原生 LaTeX 保留多行 \\substack' });
        return [createRawNode(`\\substack{${rawArg}}`)];
      }
      if (macro === '\\text') {
        const arg = readBracedRaw();
        const safeArg = sanitizeLatexTemplate(arg);
        if (safeArg !== arg) {
          diagnostics.push({ severity: 'warning', message: '已过滤 \\text 内不受信任的扩展宏' });
        }
        const unescaped = parseLatexTextArg(safeArg);
        if (unescaped !== null) return [createStructNode(COMMANDS_BY_ID.get('text_box')!, [unescaped])];
        diagnostics.push({ severity: 'warning', message: '含内嵌公式或特殊宏的 \\text 已以原生 LaTeX 保留' });
        return [createRawNode(`\\text{${safeArg}}`)];
      }
      if (macro === '\\left') return [parseLeftRight()];
      if (macro === '\\begin') return parseEnvironment();
      if (macro === '\\mathbb') {
        const arg = readBracedRaw();
        const setSym = lookupSymbol(`\\mathbb{${arg}}`);
        if (setSym) return [createSymbolNode(setSym)];
        return [createStructNode(COMMANDS_BY_ID.get('mathbb')!, [parseNested(arg)])];
      }
      if (macro === '\\operatorname') {
        if (peek() === '*') {
          pos += 1;
          return [createRawNode(`\\operatorname*{${readBracedRaw()}}`)];
        }
        const arg = readBracedRaw();
        if (/^[A-Za-z0-9\s-]+$/.test(arg)) {
          return [createStructNode(COMMANDS_BY_ID.get('operatorname')!, [textToCharNodes(arg, true)])];
        }
        return [createRawNode(`\\operatorname{${arg}}`)];
      }
      if (macro === '\\mathrm') {
        const arg = readBracedRaw();
        if (arg.trim() === 'd') {
          const saveDiffPos = pos;
          let orderNodes: MathNode[] = [];
          if (peek() === '^') {
            pos += 1;
            orderNodes = readGroupNodes();
          }
          if (orderNodes.length > 0) skipSpaces();
          const nextCh = peek();
          if (nextCh && (/[A-Za-z\\]/.test(nextCh) || nextCh === '{')) {
            const varUnits = nextCh === '{' ? readGroupNodes() : parseSingleUnit();
            const diffCmd = COMMANDS_BY_ID.get('diff');
            if (diffCmd && varUnits.length > 0) return [createStructNode(diffCmd, [orderNodes, varUnits])];
          }
          pos = saveDiffPos;
        }
        const fontCmd = COMMANDS_BY_ID.get('mathrm')!;
        const innerNodes = /^[A-Za-z0-9\s-]+$/.test(arg) ? textToCharNodes(arg, true) : parseNested(arg);
        return [createStructNode(fontCmd, [innerNodes])];
      }
      if (macro === '\\not') {
        skipSpaces();
        if (peek() === '=') { pos += 1; return [createSymbolNode(COMMANDS_BY_ID.get('neq')!)]; }
        if (peek() === '<') { pos += 1; return [createSymbolNode(COMMANDS_BY_ID.get('nless')!)]; }
        if (peek() === '>') { pos += 1; return [createSymbolNode(COMMANDS_BY_ID.get('ngtr')!)]; }
        if (peek() === '\\') {
          const saved = pos;
          const nextM = readMacroName();
          const mappedId = NOT_SYMBOL_MAP[nextM];
          if (mappedId && COMMANDS_BY_ID.has(mappedId)) return [createSymbolNode(COMMANDS_BY_ID.get(mappedId)!)];
          if (nextM === '\\subset') return [createRawNode('\\not\\subset')];
          pos = saved;
        }
        return [createRawNode('\\not')];
      }

      const fnName = macro.slice(1);
      if (MATH_FUNCTIONS.has(fnName)) return textToCharNodes(fnName, false);

      if (macro === '\\htmlData' || macro === '\\htmlClass' || macro === '\\htmlId' || macro === '\\htmlStyle' || macro === '\\href') {
        readBracedRaw();
        const inner = readBracedRaw();
        diagnostics.push({ severity: 'warning', message: `已过滤不受信任的扩展宏 ${macro}` });
        return parseNested(inner);
      }
      if (macro === '\\url' || macro === '\\includegraphics') {
        readBracketRaw();
        readBracedRaw();
        diagnostics.push({ severity: 'warning', message: `已过滤不受信任的外部资源宏 ${macro}` });
        return [];
      }
      if (macro === '\\tag') {
        let star = '';
        if (peek() === '*') { star = '*'; pos += 1; }
        const tagArg = readBracedRaw();
        if (!star && COMMANDS_BY_ID.has('tag_eq')) {
          return [createStructNode(COMMANDS_BY_ID.get('tag_eq')!, [parseNested(tagArg)])];
        }
        diagnostics.push({ severity: 'warning', message: '公式包含 \\tag* 编号，仅在 $$...$$ 块级模式下可渲染' });
        return [createRawNode(`\\tag${star}{${tagArg}}`)];
      }

      const sym = lookupSymbol(macro);
      if (sym) return [createSymbolNode(sym)];
      if (LOSSLESS_RAW_SYMBOLS.has(macro)) return [createRawNode(macro)];
      if (macro === '\\%' || macro === '\\#' || macro === '\\&' || macro === '\\$' || macro === '\\_' || macro === '\\{' || macro === '\\}') {
        return [createCharNode(macro[1])];
      }
      if (macro === '\\genfrac') {
        let rawMacro = macro;
        for (let d = 0; d < 2; d += 1) {
          skipSpaces();
          if (peek() === '{') rawMacro += `{${readBracedRaw()}}`;
          else if (peek() === '\\') rawMacro += readMacroName();
          else if (!eof()) { rawMacro += src[pos]; pos += 1; }
        }
        for (let a = 0; a < 4; a += 1) {
          const beforeArg = pos;
          skipSpaces();
          if (peek() === '{') rawMacro += `{${readBracedRaw()}}`;
          else { pos = beforeArg; break; }
        }
        diagnostics.push({ severity: 'warning', message: `以原生 LaTeX 保留未内置宏 ${macro}` });
        return [createRawNode(sanitizeLatexTemplate(rawMacro))];
      }
      if (macro === '\\prescript') {
        let rawMacro = macro;
        for (let a = 0; a < 3; a += 1) {
          const beforeArg = pos;
          skipSpaces();
          if (peek() === '{') rawMacro += `{${readBracedRaw()}}`;
          else { pos = beforeArg; break; }
        }
        diagnostics.push({ severity: 'warning', message: 'KaTeX 暂不原生支持 \\prescript，已按原生 LaTeX 保留（建议改用 {}^{a}_{b}X）' });
        return [createRawNode(sanitizeLatexTemplate(rawMacro))];
      }

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
            if (consumedBraceArg) rawMacro += `[${optArg}]`;
            else pendingOptPrefix += `[${optArg}]`;
            continue;
          }
          pos = beforeArg;
          break;
        }
        if (peek() === '{') {
          if (pendingOptPrefix) { rawMacro += pendingOptPrefix; pendingOptPrefix = ''; }
          rawMacro += `{${readBracedRaw()}}`;
          consumedBraceArg = true;
          continue;
        }
        pos = beforeArg;
        break;
      }
      if (!consumedBraceArg) pos = saveArgPos;
      diagnostics.push({ severity: 'warning', message: `以原生 LaTeX 保留未内置宏 ${macro}` });
      return [createRawNode(sanitizeLatexTemplate(rawMacro))];
    }

    if (ch === '~') {
      pos += 1;
      return [createRawNode('~')];
    }

    pos += 1;
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
      if (sub && sup) return [createStructNode(COMMANDS_BY_ID.get('subsup')!, [base, sub, sup])];
      if (sup) return [createStructNode(COMMANDS_BY_ID.get('sup')!, [base, sup])];
      if (sub) return [createStructNode(COMMANDS_BY_ID.get('sub')!, [base, sub])];
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
    if (pos === before) pos += 1;
  }
  return result;
}

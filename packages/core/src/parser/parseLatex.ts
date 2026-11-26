import {
  createCharNode,
  createEmptyDocument,
  createRawNode,
  createSlot,
  createStructNode,
  slotHasRawNodes,
} from '../ast';
import { COMMANDS_BY_ID } from '../catalog';
import type { Diagnostic, ImportResult, MathNode } from '../types';
import {
  hasMultipleWrappedFormulas,
  parseEnvironmentBody,
  parseMatchedLeftRight,
  splitTopLevelInfixMacro,
  stripOuterDelimiters,
  stripTexComments,
} from './delimitersAndEnvs';
import { tryParseMacroByRule } from './ruleEngine';
import {
  BIGOP_BOUNDARY_MACROS,
  type TexHookContext,
  endsWithDifferential,
  parseFractionMacro,
  parseIrregularTexMacro,
} from './texHooks';

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
  const consumeChar = () => {
    const ch = src[pos] ?? '';
    pos += 1;
    return ch;
  };
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
            if (!inner.trim() || (/^\s/.test(inner) && /\s$/.test(inner))) return null;
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
    if (peek() === '{') return parseNested(readBracedRaw());
    return parseSingleUnit();
  };

  const readSingleTokenRaw = (): string => {
    skipSpaces();
    if (eof()) return '';
    if (peek() === '{') return readBracedRaw();
    if (peek() === '\\') return readMacroName();
    return consumeChar();
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

  const parseLeftRight = (): MathNode => {
    skipSpaces();
    let openDelim = '';
    if (peek() === '\\') openDelim = readMacroName();
    else if (!eof()) openDelim = consumeChar();
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
          else if (!eof()) closeDelim = consumeChar();
          return parseMatchedLeftRight(
            openDelim,
            closeDelim,
            bodyRaw,
            readSubSup,
            diagnostics,
            parseNested,
          );
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
        if (
          prev &&
          prev.type === 'char' &&
          /[A-Za-z0-9]/.test(prev.value) &&
          /[A-Za-z0-9]/.test(peek())
        ) {
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

  const ruleCtx = {
    readBracketRaw,
    readGroupNodes,
    readSubSup,
    readOptionalLimitsMode,
    readBigOpBody,
    parseNested,
  };

  const hookCtx: TexHookContext = {
    getPos: () => pos,
    setPos: (p: number) => {
      pos = p;
    },
    eof,
    peek,
    consumeChar,
    skipSpaces,
    readMacroName,
    readBracedRaw,
    readBracketRaw,
    readSingleTokenRaw,
    readGroupNodes,
    readOptionalLimitsMode,
    readBigOpBody,
    parseSingleUnit: () => parseSingleUnit(),
    parseNested,
    diagnostics,
  };

  function parseSingleUnit(): MathNode[] {
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
        return [
          createStructNode(COMMANDS_BY_ID.get('frac')!, [
            parseNested(infixOver[0]),
            parseNested(infixOver[1]),
          ]),
        ];
      }
      const infixChoose = splitTopLevelInfixMacro(raw, '\\choose');
      if (infixChoose) {
        return [
          createStructNode(COMMANDS_BY_ID.get('binom')!, [
            parseNested(infixChoose[0]),
            parseNested(infixChoose[1]),
          ]),
        ];
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
        return parseFractionMacro(hookCtx);
      }
      if (macro === '\\left') return [parseLeftRight()];
      if (macro === '\\begin') return parseEnvironment();

      // 1. Declarative rule engine handles 85%+ of structural macros automatically!
      const byRule = tryParseMacroByRule(macro, ruleCtx);
      if (byRule) return byRule;

      // 2. Dedicated TeX grammar hooks for context-sensitive constructs
      return parseIrregularTexMacro(macro, hookCtx);
    }

    if (ch === '~') {
      pos += 1;
      return [createRawNode('~')];
    }

    pos += 1;
    return [createCharNode(ch, /^[A-Za-z]$/.test(ch))];
  }

  function parseTermUnits(): MathNode[] {
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
  }

  const result: MathNode[] = [];
  while (!eof()) {
    const ch = peek();
    if (/\s/.test(ch)) {
      skipSpaces();
      const prev = result[result.length - 1];
      if (
        prev &&
        prev.type === 'char' &&
        /[A-Za-z0-9]/.test(prev.value) &&
        /[A-Za-z0-9]/.test(peek())
      ) {
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

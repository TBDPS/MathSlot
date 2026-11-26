import {
  createCharNode,
  createRawNode,
  createStructNode,
  createSymbolNode,
  textToCharNodes,
} from '../ast';
import { COMMANDS, COMMANDS_BY_ID } from '../catalog';
import { COMMAND_CAPABILITIES, sanitizeLatexTemplate } from '../commandSpecs';
import { MATH_FUNCTIONS } from '../emitIr';
import { DIFFERENTIAL_WORDS } from '../shorthands';
import type { CommandDef, Diagnostic, MathNode } from '../types';
import { splitMatrixRows } from './delimitersAndEnvs';

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

export const BIGOP_BOUNDARY_MACROS: ReadonlySet<string> = (() => {
  const set = new Set<string>([
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
  for (const caps of COMMAND_CAPABILITIES.values()) {
    if (caps.bigopMacro) set.add(caps.bigopMacro);
  }
  return set;
})();

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

export function lookupSymbol(macro: string): CommandDef | undefined {
  const direct = SYMBOL_BY_LATEX.get(macro);
  if (direct) return direct;
  const aliasId = SYMBOL_ALIASES[macro];
  return aliasId ? COMMANDS_BY_ID.get(aliasId) : undefined;
}

export function endsWithDifferential(nodes: readonly MathNode[]): boolean {
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
    while (
      i >= 0 &&
      nodes[i].type === 'char' &&
      /^[a-zA-Z]$/.test((nodes[i] as { value: string }).value)
    ) {
      word = (nodes[i] as { value: string }).value + word;
      i -= 1;
    }
    if (DIFFERENTIAL_WORDS[word]) return true;
  }
  return false;
}

function parseLatexTextArg(
  arg: string,
  parseNested: (raw: string) => MathNode[],
): MathNode[] | null {
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
      out.push(
        createStructNode(COMMANDS_BY_ID.get('inline_math')!, [
          parseNested(arg.slice(i + 1, closeIdx)),
        ]),
      );
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
}

export interface TexHookContext {
  getPos: () => number;
  setPos: (p: number) => void;
  eof: () => boolean;
  peek: () => string;
  consumeChar: () => string;
  skipSpaces: () => void;
  readMacroName: () => string;
  readBracedRaw: () => string;
  readBracketRaw: () => string | null;
  readSingleTokenRaw: () => string;
  readGroupNodes: () => MathNode[];
  readOptionalLimitsMode: () => 'limits' | 'nolimits' | undefined;
  readBigOpBody: (isIntegral: boolean) => MathNode[];
  parseSingleUnit: () => MathNode[];
  parseNested: (raw: string) => MathNode[];
  diagnostics: Diagnostic[];
}

export function parseFractionMacro(ctx: TexHookContext): MathNode[] {
  ctx.skipSpaces();
  const numRaw = ctx.peek() === '{' ? ctx.readBracedRaw() : null;
  ctx.skipSpaces();
  const denRaw = ctx.peek() === '{' ? ctx.readBracedRaw() : null;
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
          ctx.parseNested(stripBraces(nthPNum[1])),
          ctx.parseNested(nthPNum[2].trim()),
          ctx.parseNested(nthPDen[1].trim()),
          ctx.parseNested(stripBraces(nthPDen[2])),
        ]),
      ];
    }
    const nthDNum = numRaw.trim().match(/^\\mathrm\{d\}\s*\^(\{[^}]+\}|[A-Za-z0-9])\s*([\s\S]+)$/);
    const nthDDen = denRaw
      .trim()
      .match(/^\\mathrm\{d\}\s*([A-Za-z\\][A-Za-z0-9]*)\s*\^(\{[^}]+\}|[A-Za-z0-9])$/);
    if (nthDNum && nthDDen) {
      return [
        createStructNode(COMMANDS_BY_ID.get('nth_deriv')!, [
          ctx.parseNested(stripBraces(nthDNum[1])),
          ctx.parseNested(nthDNum[2].trim()),
          ctx.parseNested(nthDDen[1].trim()),
          ctx.parseNested(stripBraces(nthDDen[2])),
        ]),
      ];
    }
    const pNum = numRaw.trim().match(/^\\partial\s+([\s\S]+)$/);
    const pDen = denRaw.trim().match(/^\\partial\s+([\s\S]+)$/);
    if (pNum && pDen && !/^\^/.test(pNum[1].trim()) && !/^\^/.test(pDen[1].trim())) {
      return [
        createStructNode(COMMANDS_BY_ID.get('partial_frac')!, [
          ctx.parseNested(pNum[1]),
          ctx.parseNested(pDen[1]),
        ]),
      ];
    }
    const tNum = numRaw.trim().match(/^\\mathrm\{d\}\s*([\s\S]+)$/);
    const tDen = denRaw.trim().match(/^\\mathrm\{d\}\s*([\s\S]+)$/);
    if (tNum && tDen && !/^\^/.test(tNum[1].trim()) && !/^\^/.test(tDen[1].trim())) {
      return [
        createStructNode(COMMANDS_BY_ID.get('total_frac')!, [
          ctx.parseNested(tNum[1]),
          ctx.parseNested(tDen[1]),
        ]),
      ];
    }
    return [
      createStructNode(COMMANDS_BY_ID.get('frac')!, [
        ctx.parseNested(numRaw),
        ctx.parseNested(denRaw),
      ]),
    ];
  }
  const numNodes = numRaw !== null ? ctx.parseNested(numRaw) : ctx.readGroupNodes();
  const denNodes = denRaw !== null ? ctx.parseNested(denRaw) : ctx.readGroupNodes();
  return [createStructNode(COMMANDS_BY_ID.get('frac')!, [numNodes, denNodes])];
}

export function parseIrregularTexMacro(macro: string, ctx: TexHookContext): MathNode[] {
  if (macro === '\\lim') {
    const limitsMode = ctx.readOptionalLimitsMode();
    ctx.skipSpaces();
    let varNodes: MathNode[] = [];
    let targetNodes: MathNode[] = [];
    if (ctx.peek() === '_') {
      ctx.consumeChar();
      const subRaw = ctx.readSingleTokenRaw();
      const arrowSplit = subRaw.split(/\\(?:to|rightarrow)(?![a-zA-Z])/);
      if (arrowSplit.length >= 2) {
        varNodes = ctx.parseNested(arrowSplit[0].trim());
        targetNodes = ctx.parseNested(arrowSplit.slice(1).join('\\to ').trim());
      } else {
        varNodes = ctx.parseNested(subRaw);
      }
    }
    const body = ctx.readBigOpBody(false);
    const struct = createStructNode(COMMANDS_BY_ID.get('limit')!, [varNodes, targetNodes, body]);
    if (limitsMode) struct.limitsMode = limitsMode;
    return [struct];
  }

  if (macro === '\\substack') {
    const rawArg = ctx.readBracedRaw();
    const { rows, hasGaps } = splitMatrixRows(rawArg);
    if (!hasGaps && rows.length >= 2) {
      const parsedRows = rows.map((r) => ctx.parseNested(r));
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
    ctx.diagnostics.push({ severity: 'warning', message: '以原生 LaTeX 保留多行 \\substack' });
    return [createRawNode(`\\substack{${rawArg}}`)];
  }

  if (macro === '\\text') {
    const arg = ctx.readBracedRaw();
    const safeArg = sanitizeLatexTemplate(arg);
    if (safeArg !== arg) {
      ctx.diagnostics.push({ severity: 'warning', message: '已过滤 \\text 内不受信任的扩展宏' });
    }
    const unescaped = parseLatexTextArg(safeArg, ctx.parseNested);
    if (unescaped !== null) {
      return [createStructNode(COMMANDS_BY_ID.get('text_box')!, [unescaped])];
    }
    ctx.diagnostics.push({
      severity: 'warning',
      message: '含内嵌公式或特殊宏的 \\text 已以原生 LaTeX 保留',
    });
    return [createRawNode(`\\text{${safeArg}}`)];
  }

  if (macro === '\\mathbb') {
    const arg = ctx.readBracedRaw();
    const setSym = lookupSymbol(`\\mathbb{${arg}}`);
    if (setSym) return [createSymbolNode(setSym)];
    return [createStructNode(COMMANDS_BY_ID.get('mathbb')!, [ctx.parseNested(arg)])];
  }

  if (macro === '\\operatorname') {
    if (ctx.peek() === '*') {
      ctx.consumeChar();
      return [createRawNode(`\\operatorname*{${ctx.readBracedRaw()}}`)];
    }
    const arg = ctx.readBracedRaw();
    if (/^[A-Za-z0-9\s-]+$/.test(arg)) {
      return [createStructNode(COMMANDS_BY_ID.get('operatorname')!, [textToCharNodes(arg, true)])];
    }
    return [createRawNode(`\\operatorname{${arg}}`)];
  }

  if (macro === '\\mathrm') {
    const arg = ctx.readBracedRaw();
    if (arg.trim() === 'd') {
      const saveDiffPos = ctx.getPos();
      let orderNodes: MathNode[] = [];
      if (ctx.peek() === '^') {
        ctx.consumeChar();
        orderNodes = ctx.readGroupNodes();
      }
      if (orderNodes.length > 0) ctx.skipSpaces();
      const nextCh = ctx.peek();
      if (nextCh && (/[A-Za-z\\]/.test(nextCh) || nextCh === '{')) {
        const varUnits = nextCh === '{' ? ctx.readGroupNodes() : ctx.parseSingleUnit();
        const diffCmd = COMMANDS_BY_ID.get('diff');
        if (diffCmd && varUnits.length > 0) {
          return [createStructNode(diffCmd, [orderNodes, varUnits])];
        }
      }
      ctx.setPos(saveDiffPos);
    }
    const fontCmd = COMMANDS_BY_ID.get('mathrm')!;
    const innerNodes = /^[A-Za-z0-9\s-]+$/.test(arg)
      ? textToCharNodes(arg, true)
      : ctx.parseNested(arg);
    return [createStructNode(fontCmd, [innerNodes])];
  }

  if (macro === '\\not') {
    ctx.skipSpaces();
    if (ctx.peek() === '=') {
      ctx.consumeChar();
      return [createSymbolNode(COMMANDS_BY_ID.get('neq')!)];
    }
    if (ctx.peek() === '<') {
      ctx.consumeChar();
      return [createSymbolNode(COMMANDS_BY_ID.get('nless')!)];
    }
    if (ctx.peek() === '>') {
      ctx.consumeChar();
      return [createSymbolNode(COMMANDS_BY_ID.get('ngtr')!)];
    }
    if (ctx.peek() === '\\') {
      const saved = ctx.getPos();
      const nextM = ctx.readMacroName();
      const mappedId = NOT_SYMBOL_MAP[nextM];
      if (mappedId && COMMANDS_BY_ID.has(mappedId)) {
        return [createSymbolNode(COMMANDS_BY_ID.get(mappedId)!)];
      }
      if (nextM === '\\subset') return [createRawNode('\\not\\subset')];
      ctx.setPos(saved);
    }
    return [createRawNode('\\not')];
  }

  const fnName = macro.slice(1);
  if (MATH_FUNCTIONS.has(fnName)) return textToCharNodes(fnName, false);

  if (
    macro === '\\htmlData' ||
    macro === '\\htmlClass' ||
    macro === '\\htmlId' ||
    macro === '\\htmlStyle' ||
    macro === '\\href'
  ) {
    ctx.readBracedRaw();
    const inner = ctx.readBracedRaw();
    ctx.diagnostics.push({ severity: 'warning', message: `已过滤不受信任的扩展宏 ${macro}` });
    return ctx.parseNested(inner);
  }
  if (macro === '\\url' || macro === '\\includegraphics') {
    ctx.readBracketRaw();
    ctx.readBracedRaw();
    ctx.diagnostics.push({ severity: 'warning', message: `已过滤不受信任的外部资源宏 ${macro}` });
    return [];
  }
  if (macro === '\\tag') {
    let star = '';
    if (ctx.peek() === '*') {
      star = '*';
      ctx.consumeChar();
    }
    const tagArg = ctx.readBracedRaw();
    if (!star && COMMANDS_BY_ID.has('tag_eq')) {
      return [createStructNode(COMMANDS_BY_ID.get('tag_eq')!, [ctx.parseNested(tagArg)])];
    }
    ctx.diagnostics.push({
      severity: 'warning',
      message: '公式包含 \\tag* 编号，仅在 $$...$$ 块级模式下可渲染',
    });
    return [createRawNode(`\\tag${star}{${tagArg}}`)];
  }

  const sym = lookupSymbol(macro);
  if (sym) return [createSymbolNode(sym)];
  if (LOSSLESS_RAW_SYMBOLS.has(macro)) return [createRawNode(macro)];
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

  if (macro === '\\genfrac') {
    let rawMacro = macro;
    for (let d = 0; d < 2; d += 1) {
      ctx.skipSpaces();
      if (ctx.peek() === '{') rawMacro += `{${ctx.readBracedRaw()}}`;
      else if (ctx.peek() === '\\') rawMacro += ctx.readMacroName();
      else if (!ctx.eof()) rawMacro += ctx.consumeChar();
    }
    for (let a = 0; a < 4; a += 1) {
      const beforeArg = ctx.getPos();
      ctx.skipSpaces();
      if (ctx.peek() === '{') rawMacro += `{${ctx.readBracedRaw()}}`;
      else {
        ctx.setPos(beforeArg);
        break;
      }
    }
    ctx.diagnostics.push({ severity: 'warning', message: `以原生 LaTeX 保留未内置宏 ${macro}` });
    return [createRawNode(sanitizeLatexTemplate(rawMacro))];
  }

  if (macro === '\\prescript') {
    let rawMacro = macro;
    for (let a = 0; a < 3; a += 1) {
      const beforeArg = ctx.getPos();
      ctx.skipSpaces();
      if (ctx.peek() === '{') rawMacro += `{${ctx.readBracedRaw()}}`;
      else {
        ctx.setPos(beforeArg);
        break;
      }
    }
    ctx.diagnostics.push({
      severity: 'warning',
      message: 'KaTeX 暂不原生支持 \\prescript，已按原生 LaTeX 保留（建议改用 {}^{a}_{b}X）',
    });
    return [createRawNode(sanitizeLatexTemplate(rawMacro))];
  }

  let rawMacro = macro;
  const saveArgPos = ctx.getPos();
  let consumedBraceArg = false;
  let pendingOptPrefix = '';
  for (let argIdx = 0; argIdx < 6; argIdx += 1) {
    const beforeArg = ctx.getPos();
    ctx.skipSpaces();
    if (ctx.peek() === '[') {
      const optArg = ctx.readBracketRaw();
      if (optArg !== null) {
        if (consumedBraceArg) rawMacro += `[${optArg}]`;
        else pendingOptPrefix += `[${optArg}]`;
        continue;
      }
      ctx.setPos(beforeArg);
      break;
    }
    if (ctx.peek() === '{') {
      if (pendingOptPrefix) {
        rawMacro += pendingOptPrefix;
        pendingOptPrefix = '';
      }
      rawMacro += `{${ctx.readBracedRaw()}}`;
      consumedBraceArg = true;
      continue;
    }
    ctx.setPos(beforeArg);
    break;
  }
  if (!consumedBraceArg) ctx.setPos(saveArgPos);
  ctx.diagnostics.push({ severity: 'warning', message: `以原生 LaTeX 保留未内置宏 ${macro}` });
  return [createRawNode(sanitizeLatexTemplate(rawMacro))];
}

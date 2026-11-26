import {
  BINARY_RELATION_SYMBOLS,
  INTEGRAL_OPS,
  PREFIX_BIGOPS,
  SELF_DELIMITED_STRUCTS,
  isIntegralBodySlot,
  isTightSlot,
  sanitizeLatexTemplate,
} from '../commandSpecs';
import {
  MATH_FUNCTIONS,
  OPERATORNAME_FUNCTIONS,
  analyzeSlotSemantics,
  isGenericDiffWord,
} from '../emitIr';
import type {
  DelimiterStyle,
  Document,
  MathNode,
  MathWrapperKind,
  SlotNode,
  StructNode,
} from '../types';
import {
  EXPLICIT_SPACE_MACROS,
  escapeCharLatex,
  isLineBreakRaw,
  projectGridEnvironment,
  projectMultilineRanges,
  projectStructByTemplate,
} from './structProjector';

type SpacingLevel = 'display' | 'tight';

export interface LatexEmitOptions {
  autoShorthands?: boolean;
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

function endsWithMacroName(s: string): boolean {
  return /\\[a-zA-Z]+$/.test(s);
}

function startsWithAsciiLetter(s: string): boolean {
  return /^[a-zA-Z]/.test(s);
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

export function emitSlotCanonical(
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
              (next.kind === 'atom' &&
                next.text === 'd' &&
                tokens[i + 2] &&
                (tokens[i + 2].kind === 'atom' || tokens[i + 2].kind === 'struct')) ||
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
  if (/^\\[a-zA-Z]+$/.test(inner)) {
    return inner;
  }
  if (slot.children.length === 1) {
    const only = slot.children[0];
    if (only.type === 'char' && /^[A-Za-z0-9]$/.test(only.value)) return inner;
    if (only.type === 'symbol') return inner;
    if (only.type === 'struct' && SELF_DELIMITED_STRUCTS.has(only.commandId)) return inner;
    if (only.type === 'raw' && /^\\[a-zA-Z]+\{[^}]*\}$/.test(only.latex)) return inner;
  }
  return `{${inner}}`;
}

function formatScriptArg(slot: SlotNode, autoShorthands: boolean): string {
  const inner = emitSlotCanonical(slot, 'tight', autoShorthands);
  if (!inner) return '{}';
  if (/^[A-Za-z0-9]$/.test(inner)) return inner;
  return `{${inner}}`;
}

export function emitStructCanonical(
  node: StructNode,
  parentLevel: SpacingLevel,
  autoShorthands: boolean,
): string {
  if (!node.customLatex) {
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
            return ch.value === ' ' ? ' ' : escapeCharLatex(ch.value, 'text', false);
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
    if (node.grid) {
      return projectGridEnvironment(node.grid, node.slots, (slot, env) =>
        slot ? emitSlotCanonical(slot, env === 'substack' ? 'tight' : 'display', autoShorthands) : '',
      );
    }
  }

  return projectStructByTemplate(node, {
    isSlotFilled: (idx) => (node.slots[idx]?.children.length ?? 0) > 0,
    trimTrailingSpace: true,
    renderSlot: (slot, idx) => {
      const slotLevel: SpacingLevel = isTightSlot(node.commandId, idx) ? 'tight' : 'display';
      return emitSlotCanonical(
        slot,
        slotLevel,
        autoShorthands,
        isIntegralBodySlot(node.commandId, idx),
      );
    },
  });
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

export function toLatex(doc: Document, options: LatexEmitOptions = {}): string {
  const autoShorthands = options.autoShorthands ?? true;
  const multiline = projectMultilineRanges(
    doc.root.children,
    (start, end) =>
      emitSlotCanonical(
        { id: '_slice', label: '', children: doc.root.children.slice(start, end) },
        'display',
        autoShorthands,
      ),
    '',
  );
  if (multiline) {
    if (!multiline.useAligned) {
      return `\\begin{gathered} ${emitSlotCanonical(doc.root, 'display', autoShorthands)} \\end{gathered}`;
    }
    return multiline.latex;
  }
  return emitSlotCanonical(doc.root, 'display', autoShorthands);
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

export function formatExport(latex: string, style: DelimiterStyle): string {
  return formatFormulaWithWrapper(latex, delimiterToWrapper(style));
}

const PREVIEW_OVERRIDES: Readonly<Record<string, string>> = {
  '\\text{$1}': '\\text{abc}',
  '\\tag{$1}': '\\text{(1)}',
  '\\mathrm{$1}': '\\mathrm{d}',
  '\\mathfrak{$1}': '\\mathfrak{g}',
  '\\mathsf{$1}': '\\mathsf{T}',
  '\\mathtt{$1}': '\\mathtt{x}',
  '\\boldsymbol{$1}': '\\boldsymbol{\\theta}',
  '\\mathscr{$1}': '\\mathscr{F}',
  '\\mathbf{$1}': '\\mathbf{x}',
  '\\mathcal{$1}': '\\mathcal{L}',
  '\\mathbb{$1}': '\\mathbb{E}',
  '\\operatorname{$1}': '\\operatorname{op}',
  '\\mathrm{d}^{$1}$2': '\\mathrm{d}\\square',
  '\\left\\{ $1 \\,\\middle|\\, $2 \\right\\}': '\\left\\{ \\square \\,\\middle|\\, \\square \\right\\}',
  '\\substack{$1 \\\\ $2}': '\\substack{\\square \\\\ \\square}',
};

export function commandPreviewLatex(template: string): string {
  const safe = sanitizeLatexTemplate(template);
  if (PREVIEW_OVERRIDES[safe]) return PREVIEW_OVERRIDES[safe];
  if (safe.includes('\\ddots') && safe.includes('\\begin{pmatrix}')) {
    return '\\begin{pmatrix} \\square & \\cdots & \\square \\\\ \\vdots & \\ddots & \\vdots \\\\ \\square & \\cdots & \\square \\end{pmatrix}';
  }
  if (safe.includes('\\ddots') && safe.includes('\\begin{vmatrix}')) {
    return '\\begin{vmatrix} \\square & \\cdots & \\square \\\\ \\vdots & \\ddots & \\vdots \\\\ \\square & \\cdots & \\square \\end{vmatrix}';
  }
  return safe.replace(/\$(\d+)/g, '\\square');
}

export { isLineBreakRaw };

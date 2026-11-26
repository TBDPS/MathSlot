import { COMMANDS_BY_ID } from '../catalog';
import {
  DELIMITER_STRUCT_IDS,
  INTEGRAL_OPS,
  TALL_STRUCT_IDS,
  formatGridEnvironment,
  resolveCommandTemplate,
  sanitizeLatexTemplate,
} from '../commandSpecs';
import type { GridMeta, MathNode, SlotNode, StructNode } from '../types';

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

export function slotHasTallContent(slot: SlotNode): boolean {
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

export function isSimpleFuncArgParen(node: StructNode): boolean {
  if (!node.autoSized || node.commandId !== 'paren' || node.slots.length !== 1) return false;
  const children = node.slots[0].children;
  if (children.length === 0 || children.length > 6) return false;
  return children.every((c) => c.type === 'char' && /^[A-Za-z0-9,\s]$/.test(c.value));
}

export function escapeCharLatex(
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

export function resolveAutoSizedTemplate(commandId: string, tall: boolean): string | null {
  switch (commandId) {
    case 'paren':
      return tall ? '\\left($1\\right)' : '($1)';
    case 'bracket':
      return tall ? '\\left[$1\\right]' : '[$1]';
    case 'brace':
      return tall ? '\\left\\{$1\\right\\}' : '\\{$1\\}';
    case 'abs':
      return tall ? '\\left|$1\\right|' : '|$1|';
    default:
      return null;
  }
}

export function projectGridEnvironment(
  grid: GridMeta,
  slots: readonly SlotNode[],
  renderCell: (slot: SlotNode | undefined, env: string, row: number, col: number) => string,
): string {
  const { env, rows, cols, colSpec, rowGaps } = grid;
  const rowStrings: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    const colStrings: string[] = [];
    for (let c = 0; c < cols; c += 1) {
      colStrings.push(renderCell(slots[r * cols + c], env, r, c));
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

export interface StructTemplateOptions {
  isSlotFilled: (idx: number) => boolean;
  templateOverride?: (node: StructNode, safeCustomLatex: string | undefined) => string | undefined;
  renderSlot: (slot: SlotNode, idx: number) => string;
  trimTrailingSpace?: boolean;
}

/**
 * Single shared template projector for both canonical LaTeX export and interactive canvas rendering.
 */
export function projectStructByTemplate(
  node: StructNode,
  opts: StructTemplateOptions,
): string {
  const safeCustomLatex = node.customLatex ? sanitizeLatexTemplate(node.customLatex) : undefined;
  let template: string | undefined;

  if (!safeCustomLatex && node.autoSized && node.slots.length === 1) {
    template = resolveAutoSizedTemplate(node.commandId, slotHasTallContent(node.slots[0])) ?? undefined;
  }

  if (!template) {
    template =
      opts.templateOverride?.(node, safeCustomLatex) ??
      safeCustomLatex ??
      resolveCommandTemplate(node, opts.isSlotFilled) ??
      COMMANDS_BY_ID.get(node.commandId)?.latex;
  }

  if (!template) {
    return node.slots.map((s, idx) => opts.renderSlot(s, idx)).join(' ');
  }

  const substituted = template.replace(/\$(\d+)/g, (_, idxStr: string) => {
    const idx = Number(idxStr) - 1;
    const slot = node.slots[idx];
    if (!slot) return '';
    return opts.renderSlot(slot, idx);
  });

  return opts.trimTrailingSpace ? substituted.replace(/\s+$/, '') : substituted;
}

const ALIGN_RELATION_CHARS = new Set(['=', '<', '>', '~']);
const ALIGN_RELATION_SYMBOLS = new Set([
  'leq',
  'geq',
  'neq',
  'equiv',
  'approx',
  'sim',
  'simeq',
  'cong',
  'propto',
  'implies',
  'iff',
  'to',
  'mapsto',
]);

export function findFirstRelationIndex(nodes: readonly MathNode[]): number {
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (n.type === 'char' && ALIGN_RELATION_CHARS.has(n.value)) return i;
    if (n.type === 'symbol' && ALIGN_RELATION_SYMBOLS.has(n.commandId)) return i;
  }
  return -1;
}

export interface MultilineRange {
  start: number;
  end: number;
  breakToken?: string;
}

export function splitRootLineRanges(children: readonly MathNode[]): MultilineRange[] {
  const ranges: MultilineRange[] = [];
  let lineStart = 0;
  for (let i = 0; i < children.length; i += 1) {
    const n = children[i];
    if (isLineBreakRaw(n)) {
      ranges.push({
        start: lineStart,
        end: i,
        breakToken: n.type === 'raw' ? n.latex.trim() : '\\\\',
      });
      lineStart = i + 1;
    }
  }
  ranges.push({ start: lineStart, end: children.length });
  return ranges;
}

/**
 * Shared multiline root projector ensuring 1:1 `aligned` / `gathered` parity between canvas & export.
 */
export function projectMultilineRanges(
  children: readonly MathNode[],
  renderSlice: (start: number, end: number, isEndPiece: boolean) => string,
  ampSpace: '' | ' ',
): { useAligned: boolean; latex: string } | null {
  if (!children.some((n) => isLineBreakRaw(n))) return null;
  const ranges = splitRootLineRanges(children);
  const relIndices = ranges.map((r) => findFirstRelationIndex(children.slice(r.start, r.end)));
  const useAligned = relIndices.some((idx) => idx >= 0);

  const formatted = ranges.map((range, lineIdx) => {
    if (!useAligned) {
      return renderSlice(range.start, range.end, true);
    }
    const rIdx = relIndices[lineIdx];
    if (rIdx < 0) {
      const full = renderSlice(range.start, range.end, true);
      return full ? `& ${full}` : '';
    }
    const splitAt = range.start + rIdx;
    const lhs = splitAt > range.start ? renderSlice(range.start, splitAt, false) : '';
    const rhs = renderSlice(splitAt, range.end, true);
    return lhs ? `${lhs} &${ampSpace}${rhs}` : `&${ampSpace}${rhs}`;
  });

  let joined = '';
  for (let i = 0; i < formatted.length; i += 1) {
    joined += formatted[i];
    if (i < formatted.length - 1) {
      joined += ` ${ranges[i].breakToken ?? '\\\\'} `;
    }
  }
  const env = useAligned ? 'aligned' : 'gathered';
  return {
    useAligned,
    latex: `\\begin{${env}} ${joined} \\end{${env}}`,
  };
}

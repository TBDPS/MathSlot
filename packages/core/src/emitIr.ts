import { INTEGRAL_OPS } from './commandSpecs';
import { BARE_WORD_ATOMS, BARE_WORD_BINOPS, DIFFERENTIAL_WORDS } from './shorthands';
import type { MathNode } from './types';

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

export const OPERATORNAME_FUNCTIONS: Readonly<Record<string, string>> = {
  rank: '\\operatorname{rank}',
  tr: '\\operatorname{tr}',
  span: '\\operatorname{span}',
  diag: '\\operatorname{diag}',
  proj: '\\operatorname{proj}',
  Res: '\\operatorname{Res}',
  Cov: '\\operatorname{Cov}',
  Var: '\\operatorname{Var}',
  corr: '\\operatorname{corr}',
  argmin: '\\operatorname*{arg\\,min}',
  argmax: '\\operatorname*{arg\\,max}',
};

/**
 * Recognizes generic single-variable differentials like `dx`, `da`, `dA`, `du`, `dR`
 * when typed as an isolated word (never matching ordinary words like `do` or `div`).
 */
export function isGenericDiffWord(word: string): boolean {
  if (word.length !== 2 || word[0] !== 'd') return false;
  const v = word[1];
  if (!/^[A-Za-z]$/.test(v)) return false;
  // Never steal English word `do` or standalone `dd` (handled by BARE_WORD_ATOMS)
  if (v === 'o' || v === 'd') return false;
  return true;
}

export type EmitLexSpanKind =
  | 'macro_draft'
  | 'func'
  | 'diff'
  | 'binop'
  | 'symbol_word'
  | 'verbatim_diff';

export interface EmitLexSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: EmitLexSpanKind;
  readonly rawText: string;
  readonly latex: string;
}

/**
 * Unified single-source lexical & semantic analysis for a SlotNode's children.
 * Both `toLatex` (canonical export) and `toInteractiveLatex` (live canvas) consume this IR
 * so function uprighting, integral differentials, bare-word shorthands, and native LaTeX
 * macro drafts stay 100% isomorphic with zero divergence.
 */
export interface SlotSemanticIR {
  readonly spansByStart: Map<number, EmitLexSpan>;
  readonly upright: Set<number>;
  readonly funcStarts: Set<number>;
  readonly funcEnds: Set<number>;
  readonly diffStarts: Set<number>;
}

export function analyzeSlotSemantics(
  children: readonly MathNode[],
  autoShorthands: boolean,
): SlotSemanticIR {
  const spansByStart = new Map<number, EmitLexSpan>();
  const upright = new Set<number>();
  const funcStarts = new Set<number>();
  const funcEnds = new Set<number>();
  const diffStarts = new Set<number>();

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
    if (
      node.type === 'char' &&
      (node.value === '=' || node.value === '+' || node.value === ',' || node.value === '~')
    ) {
      hasIntegral = false;
      i += 1;
      continue;
    }

    // 1. In-progress native LaTeX macro draft (`\` + contiguous non-verbatim ASCII letters)
    if (node.type === 'char' && node.value === '\\' && !node.verbatim) {
      const start = i;
      let j = i + 1;
      let name = '';
      while (
        j < children.length &&
        children[j].type === 'char' &&
        !(children[j] as { verbatim?: boolean }).verbatim &&
        /^[A-Za-z]$/.test((children[j] as { value: string }).value)
      ) {
        name += (children[j] as { value: string }).value;
        j += 1;
      }
      spansByStart.set(start, {
        start,
        end: j,
        kind: 'macro_draft',
        rawText: name,
        latex: name.length > 0 ? `\\${name}` : '\\backslash ',
      });
      i = j;
      continue;
    }

    // 2. Contiguous ASCII letter runs (grouped by verbatim flag)
    if (node.type === 'char' && /^[A-Za-z]$/.test(node.value)) {
      const isVerbatim = Boolean(node.verbatim);
      const start = i;
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
      const end = i;
      const nextAfterWord = end < children.length ? children[end] : undefined;
      const nextIsNonSpaceMath =
        nextAfterWord !== undefined &&
        !(nextAfterWord.type === 'char' && nextAfterWord.value === ' ');

      if (isVerbatim) {
        if (hasIntegral && (isGenericDiffWord(word) || (word === 'd' && nextIsNonSpaceMath))) {
          upright.add(start);
          diffStarts.add(start);
          spansByStart.set(start, {
            start,
            end,
            kind: 'verbatim_diff',
            rawText: word,
            latex: word.length > 1 ? `\\mathrm{d}${word.slice(1)}` : '\\mathrm{d}',
          });
          hasIntegral = false;
        }
      } else if (MATH_FUNCTIONS.has(word) || OPERATORNAME_FUNCTIONS[word]) {
        funcStarts.add(start);
        funcEnds.add(end - 1);
        for (let k = start; k < end; k += 1) {
          upright.add(k);
        }
        spansByStart.set(start, {
          start,
          end,
          kind: 'func',
          rawText: word,
          latex: MATH_FUNCTIONS.has(word) ? `\\${word}` : OPERATORNAME_FUNCTIONS[word],
        });
      } else if (autoShorthands && (DIFFERENTIAL_WORDS[word] || isGenericDiffWord(word))) {
        const latex = DIFFERENTIAL_WORDS[word] ?? `\\mathrm{d}${word.slice(1)}`;
        upright.add(start);
        diffStarts.add(start);
        spansByStart.set(start, {
          start,
          end,
          kind: 'diff',
          rawText: word,
          latex,
        });
        hasIntegral = false;
      } else if (autoShorthands && BARE_WORD_BINOPS[word]) {
        spansByStart.set(start, {
          start,
          end,
          kind: 'binop',
          rawText: word,
          latex: BARE_WORD_BINOPS[word],
        });
      } else if (autoShorthands && BARE_WORD_ATOMS[word]) {
        spansByStart.set(start, {
          start,
          end,
          kind: 'symbol_word',
          rawText: word,
          latex: BARE_WORD_ATOMS[word],
        });
      } else if (hasIntegral && word === 'd' && nextIsNonSpaceMath) {
        upright.add(start);
        diffStarts.add(start);
        spansByStart.set(start, {
          start,
          end,
          kind: 'verbatim_diff',
          rawText: word,
          latex: '\\mathrm{d}',
        });
        hasIntegral = false;
      }
      continue;
    }

    i += 1;
  }

  return {
    spansByStart,
    upright,
    funcStarts,
    funcEnds,
    diffStarts,
  };
}

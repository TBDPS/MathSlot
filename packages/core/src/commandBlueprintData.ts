import type { GridMeta } from './types';

export interface AdaptiveTemplateRule {
  readonly slotCount?: number;
  readonly filled: readonly number[];
  readonly latex: string;
}

export type MacroArgToken =
  | { readonly kind: 'brace'; readonly slot: number }
  | { readonly kind: 'bracket_opt'; readonly slot: number }
  | { readonly kind: 'sub'; readonly slot: number }
  | { readonly kind: 'sup'; readonly slot: number }
  | {
      readonly kind: 'bigop';
      readonly subSlot: number;
      readonly supSlot: number;
      readonly bodySlot: number;
      readonly integralStyle: boolean;
    };

export interface MacroParseRule {
  readonly macros: readonly string[];
  readonly signature: readonly MacroArgToken[];
}

export type VerticalSlotNav = Readonly<
  Record<number, { readonly up?: number; readonly down?: number }>
>;

export interface InlineArgOpenSpec {
  /** Target slot when typing `[` immediately after `\macro` (e.g. `\sqrt[3]{8}`, `\xrightarrow[下]{上}`) */
  readonly bracketSlot?: number;
  /** Target slot when typing `{` immediately after `\macro` (e.g. slot 1 for `\sqrt{x}`, slot 0 for `\frac{1}{2}`) */
  readonly firstBraceSlot?: number;
  /** Fill order override when opened via `[` vs `{` */
  readonly bracketFillOrder?: readonly number[];
  readonly braceFillOrder?: readonly number[];
}

export interface CommandCapabilities {
  /** Slot indices that collapse cleanly when empty (derived from CommandDef.optionalSlots) */
  readonly optionalSlots: readonly number[];
  /** Slot indices formatted with tight script/limit spacing */
  readonly tightSlots?: readonly number[];
  /** Slot indices whose jump badge anchors below rather than above */
  readonly bottomSlots?: readonly number[];
  /** Slot indices representing an integral integrand body (enables automatic `\,` before `dx`) */
  readonly integralBodySlots?: readonly number[];
  /** True when structure has tall vertical metrics requiring `\left...\right` on outer auto-brackets */
  readonly isTall?: boolean;
  /** True when structure is already self-delimited (`\left...\right`, `\hat{x}`, `\mathbf{x}`, etc.) */
  readonly isSelfDelimited?: boolean;
  /** True when structure acts as an enclosing delimiter barrier for closing-bracket overtype */
  readonly isDelimiter?: boolean;
  /** True when structure is a prefix big operator (`\int`, `\sum`, `\prod`, `\lim`, `\bigcup`, `\bigcap`) */
  readonly isPrefixBigOp?: boolean;
  /** True when command/symbol is an integral operator */
  readonly isIntegralOp?: boolean;
  /** True when 0-slot symbol acts as a binary relation/operator for spacing & term splitting */
  readonly isBinaryRelation?: boolean;
  /** True when `wrapSlot === 0` command wraps the preceding atom when nothing is selected */
  readonly backwardWrap?: boolean;
  /** Static grid metadata for built-in fixed-size matrix / cases commands */
  readonly gridMeta?: GridMeta;
  /** LaTeX macro names (without leading `\`) that expand inline to this structural command */
  readonly inlineMacros?: readonly string[];
  /** LaTeX accent/font 1-arg macro (with leading `\`) that parses directly into this 1-slot command */
  readonly accentMacro?: string;
  /** Declarative next slot index when closing native LaTeX `{...}` / `[...]` on an earlier slot */
  readonly nextBraceSlot?: number;
  /** Declarative optional-slot adaptive export rules (`__LIMITS__` expands `\limits`/`\nolimits` when present) */
  readonly adaptiveTemplates?: readonly AdaptiveTemplateRule[];
  /** Shorthand family macro for 3-slot big operators (`\int`, `\sum`, `\bigoplus`, ...): auto-derives adaptive template, parseRule & verticalNav */
  readonly bigopMacro?: string;
  /** Shorthand family macro for 4-slot higher-order derivatives (`\partial` | `\mathrm{d}`) */
  readonly derivMacro?: '\\partial' | '\\mathrm{d}';
  /** Declarative spatial ArrowUp / ArrowDown slot transition graph */
  readonly verticalNav?: VerticalSlotNav;
  /** Pre-populated symbol command IDs by slot index on fresh insertion (e.g. ellipsis matrices) */
  readonly initialSlotSymbols?: Readonly<Record<number, string>>;
  /** Copy static `gridMeta` onto `StructNode.grid` upon command insertion */
  readonly instantiateGrid?: boolean;
  /** Exit right after struct when wrapping a selection leaves only optional empty slots (e.g. `sqrt`) */
  readonly exitAfterWrapIfRestOptional?: boolean;
  /** Declarative reverse LaTeX macro parsing rule */
  readonly parseRule?: MacroParseRule;
}

export const TWO_SLOT_VERTICAL: VerticalSlotNav = { 0: { down: 1 }, 1: { up: 0 } };
export const REVERSE_TWO_SLOT_VERTICAL: VerticalSlotNav = { 0: { up: 1 }, 1: { down: 0 } };
export const BIGOP_VERTICAL: VerticalSlotNav = {
  0: { up: 1 },
  1: { down: 0 },
  2: { up: 1, down: 0 },
};

const ELLIPSIS_PREFILL: Readonly<Record<number, string>> = {
  2: 'cdots',
  6: 'cdots',
  8: 'vdots',
  9: 'vdots',
  10: 'ddots',
  11: 'vdots',
  14: 'cdots',
};

export const SPEC_OVERRIDES: Readonly<Record<string, Omit<CommandCapabilities, 'optionalSlots'>>> =
  {
    frac: {
      bottomSlots: [1],
      isTall: true,
      inlineMacros: ['frac', 'dfrac', 'tfrac'],
      nextBraceSlot: 1,
      verticalNav: TWO_SLOT_VERTICAL,
    },
    partial_frac: { bottomSlots: [1], isTall: true, verticalNav: TWO_SLOT_VERTICAL },
    total_frac: { bottomSlots: [1], isTall: true, verticalNav: TWO_SLOT_VERTICAL },
    nth_partial: { tightSlots: [0, 3], bottomSlots: [2, 3], isTall: true, derivMacro: '\\partial' },
    nth_deriv: {
      tightSlots: [0, 3],
      bottomSlots: [2, 3],
      isTall: true,
      derivMacro: '\\mathrm{d}',
    },
    diff: {
      tightSlots: [0],
      isSelfDelimited: true,
      inlineMacros: ['diff'],
      adaptiveTemplates: [
        { slotCount: 2, filled: [0], latex: '\\mathrm{d}^{$1}$2' },
        { slotCount: 2, filled: [], latex: '\\mathrm{d}$2' },
      ],
    },
    binom: {
      bottomSlots: [1],
      isTall: true,
      inlineMacros: ['binom'],
      nextBraceSlot: 1,
      verticalNav: TWO_SLOT_VERTICAL,
      parseRule: {
        macros: ['\\binom'],
        signature: [
          { kind: 'brace', slot: 0 },
          { kind: 'brace', slot: 1 },
        ],
      },
    },
    sqrt: {
      tightSlots: [0],
      isTall: true,
      inlineMacros: ['sqrt'],
      nextBraceSlot: 1,
      verticalNav: TWO_SLOT_VERTICAL,
      exitAfterWrapIfRestOptional: true,
      adaptiveTemplates: [
        { slotCount: 2, filled: [0], latex: '\\sqrt[$1]{$2}' },
        { slotCount: 2, filled: [], latex: '\\sqrt{$2}' },
      ],
      parseRule: {
        macros: ['\\sqrt'],
        signature: [
          { kind: 'bracket_opt', slot: 0 },
          { kind: 'brace', slot: 1 },
        ],
      },
    },
    nth_root: {
      tightSlots: [0],
      isTall: true,
      verticalNav: TWO_SLOT_VERTICAL,
      adaptiveTemplates: [
        { slotCount: 2, filled: [0], latex: '\\sqrt[$1]{$2}' },
        { slotCount: 2, filled: [], latex: '\\sqrt{$2}' },
      ],
    },
    sup: { tightSlots: [1], backwardWrap: true, verticalNav: REVERSE_TWO_SLOT_VERTICAL },
    sub: { tightSlots: [1], bottomSlots: [1], backwardWrap: true, verticalNav: TWO_SLOT_VERTICAL },
    subsup: {
      tightSlots: [1, 2],
      bottomSlots: [1],
      backwardWrap: true,
      verticalNav: { 0: { up: 2, down: 1 }, 1: { up: 2 }, 2: { down: 1 } },
      adaptiveTemplates: [
        { slotCount: 3, filled: [1, 2], latex: '{$1}_{$2}^{$3}' },
        { slotCount: 3, filled: [1], latex: '{$1}_{$2}' },
        { slotCount: 3, filled: [2], latex: '{$1}^{$3}' },
        { slotCount: 3, filled: [], latex: '$1' },
      ],
    },

    paren: { isSelfDelimited: true, isDelimiter: true },
    bracket: { isSelfDelimited: true, isDelimiter: true },
    brace: { isSelfDelimited: true, isDelimiter: true },
    abs: { isSelfDelimited: true, isDelimiter: true, inlineMacros: ['abs'] },
    norm: { isSelfDelimited: true, isDelimiter: true, inlineMacros: ['norm'] },
    angle: { isSelfDelimited: true },
    floor: { isSelfDelimited: true, inlineMacros: ['floor'] },
    ceil: { isSelfDelimited: true, inlineMacros: ['ceil'] },
    interval_oc: { isSelfDelimited: true, isDelimiter: true },
    interval_co: { isSelfDelimited: true, isDelimiter: true },
    set_builder: { isSelfDelimited: true, isDelimiter: true },
    boxed: {
      isSelfDelimited: true,
      inlineMacros: ['boxed'],
      parseRule: { macros: ['\\boxed'], signature: [{ kind: 'brace', slot: 0 }] },
    },
    cancel: { isSelfDelimited: true, inlineMacros: ['cancel'], accentMacro: '\\cancel' },
    bcancel: { isSelfDelimited: true, inlineMacros: ['bcancel'], accentMacro: '\\bcancel' },
    xcancel: { isSelfDelimited: true, inlineMacros: ['xcancel'], accentMacro: '\\xcancel' },
    tag_eq: { isSelfDelimited: true, inlineMacros: ['tag'] },
    mathrm: { isSelfDelimited: true, inlineMacros: ['mathrm'] },
    mathfrak: { isSelfDelimited: true, inlineMacros: ['mathfrak'], accentMacro: '\\mathfrak' },
    mathsf: { isSelfDelimited: true, inlineMacros: ['mathsf'], accentMacro: '\\mathsf' },
    mathtt: { isSelfDelimited: true, inlineMacros: ['mathtt'], accentMacro: '\\mathtt' },
    boldsymbol: {
      isSelfDelimited: true,
      inlineMacros: ['boldsymbol', 'bm'],
      accentMacro: '\\boldsymbol',
      parseRule: {
        macros: ['\\boldsymbol', '\\bm'],
        signature: [{ kind: 'brace', slot: 0 }],
      },
    },
    mathscr: { isSelfDelimited: true, inlineMacros: ['mathscr'], accentMacro: '\\mathscr' },
    overleftarrow: {
      isSelfDelimited: true,
      inlineMacros: ['overleftarrow'],
      accentMacro: '\\overleftarrow',
    },
    overleftrightarrow: {
      isSelfDelimited: true,
      inlineMacros: ['overleftrightarrow'],
      accentMacro: '\\overleftrightarrow',
    },
    substack_2: {
      tightSlots: [0, 1],
      isSelfDelimited: true,
      gridMeta: { env: 'substack', rows: 2, cols: 1 },
      inlineMacros: ['substack'],
    },

    integral: {
      tightSlots: [0, 1],
      bottomSlots: [0],
      integralBodySlots: [2],
      isTall: true,
      isPrefixBigOp: true,
      isIntegralOp: true,
      inlineMacros: ['int'],
      bigopMacro: '\\int',
    },
    indef_integral: {
      integralBodySlots: [0],
      isPrefixBigOp: true,
      isIntegralOp: true,
    },
    double_integral: {
      tightSlots: [0, 1],
      bottomSlots: [0],
      integralBodySlots: [2],
      isTall: true,
      isPrefixBigOp: true,
      isIntegralOp: true,
      inlineMacros: ['iint'],
      bigopMacro: '\\iint',
    },
    contour_integral: {
      tightSlots: [0, 1],
      bottomSlots: [0],
      integralBodySlots: [2],
      isTall: true,
      isPrefixBigOp: true,
      isIntegralOp: true,
      inlineMacros: ['oint'],
      bigopMacro: '\\oint',
    },
    triple_integral: {
      tightSlots: [0, 1],
      bottomSlots: [0],
      integralBodySlots: [2],
      isTall: true,
      isPrefixBigOp: true,
      isIntegralOp: true,
      inlineMacros: ['iiint'],
      bigopMacro: '\\iiint',
    },
    sum: {
      tightSlots: [0, 1],
      bottomSlots: [0],
      isTall: true,
      isPrefixBigOp: true,
      inlineMacros: ['sum'],
      bigopMacro: '\\sum',
    },
    product: {
      tightSlots: [0, 1],
      bottomSlots: [0],
      isTall: true,
      isPrefixBigOp: true,
      inlineMacros: ['prod'],
      bigopMacro: '\\prod',
    },
    bigcup: {
      tightSlots: [0, 1],
      bottomSlots: [0],
      isTall: true,
      isPrefixBigOp: true,
      inlineMacros: ['bigcup'],
      bigopMacro: '\\bigcup',
    },
    bigcap: {
      tightSlots: [0, 1],
      bottomSlots: [0],
      isTall: true,
      isPrefixBigOp: true,
      inlineMacros: ['bigcap'],
      bigopMacro: '\\bigcap',
    },
    coprod: {
      tightSlots: [0, 1],
      bottomSlots: [0],
      isTall: true,
      isPrefixBigOp: true,
      inlineMacros: ['coprod'],
      bigopMacro: '\\coprod',
    },
    bigoplus: {
      tightSlots: [0, 1],
      bottomSlots: [0],
      isTall: true,
      isPrefixBigOp: true,
      inlineMacros: ['bigoplus'],
      bigopMacro: '\\bigoplus',
    },
    bigotimes: {
      tightSlots: [0, 1],
      bottomSlots: [0],
      isTall: true,
      isPrefixBigOp: true,
      inlineMacros: ['bigotimes'],
      bigopMacro: '\\bigotimes',
    },
    bigwedge: {
      tightSlots: [0, 1],
      bottomSlots: [0],
      isTall: true,
      isPrefixBigOp: true,
      inlineMacros: ['bigwedge'],
      bigopMacro: '\\bigwedge',
    },
    limit: {
      tightSlots: [0, 1],
      bottomSlots: [0, 1],
      isTall: true,
      isPrefixBigOp: true,
      inlineMacros: ['lim'],
      verticalNav: { 0: { up: 2 }, 1: { up: 2 }, 2: { down: 0 } },
      adaptiveTemplates: [
        { slotCount: 3, filled: [0, 1], latex: '\\lim__LIMITS___{$1 \\to $2} $3' },
        { slotCount: 3, filled: [0], latex: '\\lim__LIMITS___{$1} $3' },
        { slotCount: 3, filled: [1], latex: '\\lim__LIMITS___{\\to $2} $3' },
        { slotCount: 3, filled: [], latex: '\\lim__LIMITS__ $3' },
      ],
    },

    matrix_2x2: {
      isTall: true,
      gridMeta: { env: 'pmatrix', rows: 2, cols: 2 },
      inlineMacros: ['pmatrix'],
    },
    matrix_3x3: { isTall: true, gridMeta: { env: 'pmatrix', rows: 3, cols: 3 } },
    bmatrix_2x2: {
      isTall: true,
      gridMeta: { env: 'bmatrix', rows: 2, cols: 2 },
      inlineMacros: ['bmatrix'],
    },
    bmatrix_3x3: { isTall: true, gridMeta: { env: 'bmatrix', rows: 3, cols: 3 } },
    det_2x2: {
      isTall: true,
      gridMeta: { env: 'vmatrix', rows: 2, cols: 2 },
      inlineMacros: ['vmatrix'],
    },
    det_3x3: { isTall: true, gridMeta: { env: 'vmatrix', rows: 3, cols: 3 } },
    matrix_ellipsis: {
      isTall: true,
      gridMeta: { env: 'pmatrix', rows: 4, cols: 4 },
      initialSlotSymbols: ELLIPSIS_PREFILL,
      instantiateGrid: true,
    },
    det_ellipsis: {
      isTall: true,
      gridMeta: { env: 'vmatrix', rows: 4, cols: 4 },
      initialSlotSymbols: ELLIPSIS_PREFILL,
      instantiateGrid: true,
    },
    aug_matrix: {
      isTall: true,
      gridMeta: { env: 'bmatrix', rows: 2, cols: 3, colSpec: 'cc|c' },
      instantiateGrid: true,
    },
    smallmatrix: {
      gridMeta: { env: 'smallmatrix', rows: 2, cols: 2 },
      inlineMacros: ['smallmatrix'],
    },
    cases_2: { isTall: true, gridMeta: { env: 'cases', rows: 2, cols: 2 }, inlineMacros: ['cases'] },
    cases_3: { isTall: true, gridMeta: { env: 'cases', rows: 3, cols: 2 } },
    dcases_2: {
      isTall: true,
      gridMeta: { env: 'dcases', rows: 2, cols: 2 },
      inlineMacros: ['dcases'],
    },
    rcases_2: {
      isTall: true,
      gridMeta: { env: 'rcases', rows: 2, cols: 2 },
      inlineMacros: ['rcases'],
    },
    aligned_2: {
      isTall: true,
      gridMeta: { env: 'aligned', rows: 2, cols: 2 },
      inlineMacros: ['aligned', 'align'],
    },
    Bmatrix_2x2: {
      isTall: true,
      gridMeta: { env: 'Bmatrix', rows: 2, cols: 2 },
      inlineMacros: ['Bmatrix'],
    },
    Vmatrix_2x2: {
      isTall: true,
      gridMeta: { env: 'Vmatrix', rows: 2, cols: 2 },
      inlineMacros: ['Vmatrix'],
    },

    hat: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['hat'], accentMacro: '\\hat' },
    bar: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['bar'], accentMacro: '\\bar' },
    vec: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['vec'], accentMacro: '\\vec' },
    tilde: {
      isSelfDelimited: true,
      backwardWrap: true,
      inlineMacros: ['tilde'],
      accentMacro: '\\tilde',
    },
    dot: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['dot'], accentMacro: '\\dot' },
    ddot: {
      isSelfDelimited: true,
      backwardWrap: true,
      inlineMacros: ['ddot'],
      accentMacro: '\\ddot',
    },
    overline: {
      isSelfDelimited: true,
      backwardWrap: true,
      inlineMacros: ['overline'],
      accentMacro: '\\overline',
    },
    underline: {
      isSelfDelimited: true,
      backwardWrap: true,
      inlineMacros: ['underline'],
      accentMacro: '\\underline',
    },
    widehat: {
      isSelfDelimited: true,
      backwardWrap: true,
      inlineMacros: ['widehat'],
      accentMacro: '\\widehat',
    },
    widetilde: {
      isSelfDelimited: true,
      backwardWrap: true,
      inlineMacros: ['widetilde'],
      accentMacro: '\\widetilde',
    },
    overrightarrow: {
      isSelfDelimited: true,
      backwardWrap: true,
      inlineMacros: ['overrightarrow'],
      accentMacro: '\\overrightarrow',
    },
    mathbf: {
      isSelfDelimited: true,
      backwardWrap: true,
      inlineMacros: ['mathbf'],
      parseRule: { macros: ['\\mathbf'], signature: [{ kind: 'brace', slot: 0 }] },
    },
    mathcal: {
      isSelfDelimited: true,
      backwardWrap: true,
      inlineMacros: ['mathcal'],
      parseRule: { macros: ['\\mathcal'], signature: [{ kind: 'brace', slot: 0 }] },
    },
    mathbb: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['mathbb'] },
    operatorname: { isSelfDelimited: true, inlineMacros: ['operatorname'] },
    text_box: { isSelfDelimited: true, inlineMacros: ['text'] },
    pmod: {
      isBinaryRelation: true,
      inlineMacros: ['pmod'],
      parseRule: { macros: ['\\pmod'], signature: [{ kind: 'brace', slot: 0 }] },
    },

    eval_bar: {
      tightSlots: [1, 2],
      isTall: true,
      verticalNav: { 0: { up: 2, down: 1 }, 1: { up: 2 }, 2: { down: 1 } },
      adaptiveTemplates: [
        { slotCount: 3, filled: [1, 2], latex: '\\left. $1\\right|_{$2}^{$3}' },
        { slotCount: 3, filled: [1], latex: '\\left. $1\\right|_{$2}' },
        { slotCount: 3, filled: [2], latex: '\\left. $1\\right|^{$3}' },
        { slotCount: 3, filled: [], latex: '\\left. $1\\right|' },
      ],
    },
    overbrace: {
      isTall: true,
      inlineMacros: ['overbrace'],
      verticalNav: REVERSE_TWO_SLOT_VERTICAL,
      adaptiveTemplates: [
        { slotCount: 2, filled: [1], latex: '\\overbrace{$1}^{$2}' },
        { slotCount: 2, filled: [], latex: '\\overbrace{$1}' },
      ],
      parseRule: {
        macros: ['\\overbrace'],
        signature: [
          { kind: 'brace', slot: 0 },
          { kind: 'sup', slot: 1 },
        ],
      },
    },
    underbrace: {
      isTall: true,
      inlineMacros: ['underbrace'],
      verticalNav: TWO_SLOT_VERTICAL,
      adaptiveTemplates: [
        { slotCount: 2, filled: [1], latex: '\\underbrace{$1}_{$2}' },
        { slotCount: 2, filled: [], latex: '\\underbrace{$1}' },
      ],
      parseRule: {
        macros: ['\\underbrace'],
        signature: [
          { kind: 'brace', slot: 0 },
          { kind: 'sub', slot: 1 },
        ],
      },
    },
    overset: {
      nextBraceSlot: 1,
      inlineMacros: ['overset'],
      verticalNav: TWO_SLOT_VERTICAL,
      parseRule: {
        macros: ['\\overset'],
        signature: [
          { kind: 'brace', slot: 0 },
          { kind: 'brace', slot: 1 },
        ],
      },
    },
    underset: {
      nextBraceSlot: 1,
      inlineMacros: ['underset'],
      verticalNav: REVERSE_TWO_SLOT_VERTICAL,
      parseRule: {
        macros: ['\\underset'],
        signature: [
          { kind: 'brace', slot: 0 },
          { kind: 'brace', slot: 1 },
        ],
      },
    },
    xrightarrow: {
      tightSlots: [0],
      isBinaryRelation: true,
      nextBraceSlot: 1,
      inlineMacros: ['xrightarrow'],
      verticalNav: REVERSE_TWO_SLOT_VERTICAL,
      adaptiveTemplates: [
        { slotCount: 2, filled: [0], latex: '\\xrightarrow[$1]{$2}' },
        { slotCount: 2, filled: [], latex: '\\xrightarrow{$2}' },
      ],
      parseRule: {
        macros: ['\\xrightarrow'],
        signature: [
          { kind: 'bracket_opt', slot: 0 },
          { kind: 'brace', slot: 1 },
        ],
      },
    },
    xleftarrow: {
      tightSlots: [0],
      isBinaryRelation: true,
      nextBraceSlot: 1,
      inlineMacros: ['xleftarrow'],
      verticalNav: REVERSE_TWO_SLOT_VERTICAL,
      adaptiveTemplates: [
        { slotCount: 2, filled: [0], latex: '\\xleftarrow[$1]{$2}' },
        { slotCount: 2, filled: [], latex: '\\xleftarrow{$2}' },
      ],
      parseRule: {
        macros: ['\\xleftarrow'],
        signature: [
          { kind: 'bracket_opt', slot: 0 },
          { kind: 'brace', slot: 1 },
        ],
      },
    },
    ket: {
      isSelfDelimited: true,
      isDelimiter: true,
      backwardWrap: true,
      inlineMacros: ['ket'],
      parseRule: {
        macros: ['\\ket'],
        signature: [{ kind: 'brace', slot: 0 }],
      },
    },
    bra: {
      isSelfDelimited: true,
      isDelimiter: true,
      backwardWrap: true,
      inlineMacros: ['bra'],
      parseRule: {
        macros: ['\\bra'],
        signature: [{ kind: 'brace', slot: 0 }],
      },
    },
    braket: {
      isSelfDelimited: true,
      isDelimiter: true,
      nextBraceSlot: 1,
      inlineMacros: ['braket'],
      parseRule: {
        macros: ['\\braket'],
        signature: [
          { kind: 'brace', slot: 0 },
          { kind: 'brace', slot: 1 },
        ],
      },
    },
    stackrel: {
      tightSlots: [0],
      isBinaryRelation: true,
      nextBraceSlot: 1,
      inlineMacros: ['stackrel'],
      verticalNav: TWO_SLOT_VERTICAL,
      parseRule: {
        macros: ['\\stackrel'],
        signature: [
          { kind: 'brace', slot: 0 },
          { kind: 'brace', slot: 1 },
        ],
      },
    },
    xRightarrow: {
      tightSlots: [0],
      isBinaryRelation: true,
      nextBraceSlot: 1,
      inlineMacros: ['xRightarrow'],
      verticalNav: REVERSE_TWO_SLOT_VERTICAL,
      adaptiveTemplates: [
        { slotCount: 2, filled: [0], latex: '\\xRightarrow[$1]{$2}' },
        { slotCount: 2, filled: [], latex: '\\xRightarrow{$2}' },
      ],
      parseRule: {
        macros: ['\\xRightarrow'],
        signature: [
          { kind: 'bracket_opt', slot: 0 },
          { kind: 'brace', slot: 1 },
        ],
      },
    },
    xLeftrightarrow: {
      tightSlots: [0],
      isBinaryRelation: true,
      nextBraceSlot: 1,
      inlineMacros: ['xLeftrightarrow'],
      verticalNav: REVERSE_TWO_SLOT_VERTICAL,
      adaptiveTemplates: [
        { slotCount: 2, filled: [0], latex: '\\xLeftrightarrow[$1]{$2}' },
        { slotCount: 2, filled: [], latex: '\\xLeftrightarrow{$2}' },
      ],
      parseRule: {
        macros: ['\\xLeftrightarrow'],
        signature: [
          { kind: 'bracket_opt', slot: 0 },
          { kind: 'brace', slot: 1 },
        ],
      },
    },
    xmapsto: {
      tightSlots: [0],
      isBinaryRelation: true,
      nextBraceSlot: 1,
      inlineMacros: ['xmapsto'],
      verticalNav: REVERSE_TWO_SLOT_VERTICAL,
      adaptiveTemplates: [
        { slotCount: 2, filled: [0], latex: '\\xmapsto[$1]{$2}' },
        { slotCount: 2, filled: [], latex: '\\xmapsto{$2}' },
      ],
      parseRule: {
        macros: ['\\xmapsto'],
        signature: [
          { kind: 'bracket_opt', slot: 0 },
          { kind: 'brace', slot: 1 },
        ],
      },
    },
  };

export const BINARY_RELATION_CMD_IDS = new Set([
  'to', 'pm', 'mp', 'times', 'cdot', 'in', 'notin', 'subseteq', 'subset', 'equiv', 'approx',
  'sim', 'propto', 'implies', 'iff', 'mapsto', 'cong', 'll', 'gg', 'simeq', 'leq', 'geq', 'neq',
  'cup', 'cap', 'land', 'lor', 'setminus', 'parallel', 'perp', 'leftarrow', 'leftrightarrow',
  'uparrow', 'downarrow', 'hookrightarrow', 'mid_rel', 'oplus', 'otimes', 'wedge', 'star_op',
  'div_op', 'coloneqq', 'models', 'vdash', 'lesssim', 'gtrsim', 'supset', 'supseteq',
  'nsubseteq', 'nparallel', 'nRightarrow', 'nLeftrightarrow', 'nrightarrow', 'nless', 'ngtr',
  'nleq', 'ngeq', 'nsim', 'ncong', 'not_equiv', 'nvdash', 'nvDash', 'nmid', 'nsupseteq',
]);

export const LEGACY_OPTIONAL_SLOTS: Readonly<Record<string, readonly number[]>> = {
  nth_root: [0],
};

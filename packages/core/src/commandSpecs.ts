import { COMMANDS, COMMANDS_BY_ID } from './catalog';
import { DEFAULT_SETTINGS } from './types';
import type { AppSettings, GridMeta, LeaderKey, SlotOrderPreset, ThemeMode } from './types';

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
}

const SPEC_OVERRIDES: Readonly<Record<string, Omit<CommandCapabilities, 'optionalSlots'>>> = {
  frac: { bottomSlots: [1], isTall: true, inlineMacros: ['frac', 'dfrac', 'tfrac'] },
  partial_frac: { bottomSlots: [1], isTall: true },
  total_frac: { bottomSlots: [1], isTall: true },
  diff: { tightSlots: [0], isSelfDelimited: true, inlineMacros: ['diff'] },
  binom: { bottomSlots: [1], isTall: true, inlineMacros: ['binom'] },
  sqrt: { tightSlots: [0], isTall: true, inlineMacros: ['sqrt'] },
  nth_root: { tightSlots: [0], isTall: true },
  sup: { tightSlots: [1], backwardWrap: true },
  sub: { tightSlots: [1], bottomSlots: [1], backwardWrap: true },
  subsup: { tightSlots: [1, 2], bottomSlots: [1], backwardWrap: true },

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
  boxed: { isSelfDelimited: true, inlineMacros: ['boxed'] },
  cancel: { isSelfDelimited: true, inlineMacros: ['cancel'] },
  substack_2: { tightSlots: [0, 1], isSelfDelimited: true },

  integral: {
    tightSlots: [0, 1],
    bottomSlots: [0],
    integralBodySlots: [2],
    isTall: true,
    isPrefixBigOp: true,
    isIntegralOp: true,
    inlineMacros: ['int'],
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
  },
  contour_integral: {
    tightSlots: [0, 1],
    bottomSlots: [0],
    integralBodySlots: [2],
    isTall: true,
    isPrefixBigOp: true,
    isIntegralOp: true,
    inlineMacros: ['oint'],
  },
  triple_integral: {
    tightSlots: [0, 1],
    bottomSlots: [0],
    integralBodySlots: [2],
    isTall: true,
    isPrefixBigOp: true,
    isIntegralOp: true,
    inlineMacros: ['iiint'],
  },
  sum: {
    tightSlots: [0, 1],
    bottomSlots: [0],
    isTall: true,
    isPrefixBigOp: true,
    inlineMacros: ['sum'],
  },
  product: {
    tightSlots: [0, 1],
    bottomSlots: [0],
    isTall: true,
    isPrefixBigOp: true,
    inlineMacros: ['prod'],
  },
  bigcup: {
    tightSlots: [0, 1],
    bottomSlots: [0],
    isTall: true,
    isPrefixBigOp: true,
    inlineMacros: ['bigcup'],
  },
  bigcap: {
    tightSlots: [0, 1],
    bottomSlots: [0],
    isTall: true,
    isPrefixBigOp: true,
    inlineMacros: ['bigcap'],
  },
  limit: {
    tightSlots: [0, 1],
    bottomSlots: [0, 1],
    isTall: true,
    isPrefixBigOp: true,
    inlineMacros: ['lim'],
  },

  matrix_2x2: {
    isTall: true,
    gridMeta: { env: 'pmatrix', rows: 2, cols: 2 },
    inlineMacros: ['pmatrix'],
  },
  matrix_3x3: {
    isTall: true,
    gridMeta: { env: 'pmatrix', rows: 3, cols: 3 },
  },
  bmatrix_2x2: {
    isTall: true,
    gridMeta: { env: 'bmatrix', rows: 2, cols: 2 },
    inlineMacros: ['bmatrix'],
  },
  bmatrix_3x3: {
    isTall: true,
    gridMeta: { env: 'bmatrix', rows: 3, cols: 3 },
  },
  det_2x2: {
    isTall: true,
    gridMeta: { env: 'vmatrix', rows: 2, cols: 2 },
    inlineMacros: ['vmatrix'],
  },
  det_3x3: {
    isTall: true,
    gridMeta: { env: 'vmatrix', rows: 3, cols: 3 },
  },
  matrix_ellipsis: {
    isTall: true,
    gridMeta: { env: 'pmatrix', rows: 4, cols: 4 },
  },
  det_ellipsis: {
    isTall: true,
    gridMeta: { env: 'vmatrix', rows: 4, cols: 4 },
  },
  aug_matrix: {
    isTall: true,
    gridMeta: { env: 'bmatrix', rows: 2, cols: 3, colSpec: 'cc|c' },
  },
  smallmatrix: {
    gridMeta: { env: 'smallmatrix', rows: 2, cols: 2 },
    inlineMacros: ['smallmatrix'],
  },
  cases_2: {
    isTall: true,
    gridMeta: { env: 'cases', rows: 2, cols: 2 },
    inlineMacros: ['cases'],
  },
  cases_3: {
    isTall: true,
    gridMeta: { env: 'cases', rows: 3, cols: 2 },
  },
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

  hat: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['hat'], accentMacro: '\\hat' },
  bar: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['bar'], accentMacro: '\\bar' },
  vec: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['vec'], accentMacro: '\\vec' },
  tilde: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['tilde'], accentMacro: '\\tilde' },
  dot: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['dot'], accentMacro: '\\dot' },
  ddot: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['ddot'], accentMacro: '\\ddot' },
  overline: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['overline'], accentMacro: '\\overline' },
  underline: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['underline'], accentMacro: '\\underline' },
  widehat: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['widehat'], accentMacro: '\\widehat' },
  widetilde: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['widetilde'], accentMacro: '\\widetilde' },
  overrightarrow: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['overrightarrow'], accentMacro: '\\overrightarrow' },
  mathbf: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['mathbf'] },
  mathcal: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['mathcal'] },
  mathbb: { isSelfDelimited: true, backwardWrap: true, inlineMacros: ['mathbb'] },
  operatorname: { isSelfDelimited: true, inlineMacros: ['operatorname'] },
  text_box: { isSelfDelimited: true, inlineMacros: ['text'] },

  eval_bar: { tightSlots: [1, 2], isTall: true },
  overbrace: { isTall: true, inlineMacros: ['overbrace'] },
  underbrace: { isTall: true, inlineMacros: ['underbrace'] },

  // Binary relation / operator 0-slot symbols
  to: { isBinaryRelation: true },
  pm: { isBinaryRelation: true },
  mp: { isBinaryRelation: true },
  times: { isBinaryRelation: true },
  cdot: { isBinaryRelation: true },
  in: { isBinaryRelation: true },
  notin: { isBinaryRelation: true },
  subseteq: { isBinaryRelation: true },
  subset: { isBinaryRelation: true },
  equiv: { isBinaryRelation: true },
  approx: { isBinaryRelation: true },
  sim: { isBinaryRelation: true },
  propto: { isBinaryRelation: true },
  implies: { isBinaryRelation: true },
  iff: { isBinaryRelation: true },
  mapsto: { isBinaryRelation: true },
  cong: { isBinaryRelation: true },
  ll: { isBinaryRelation: true },
  gg: { isBinaryRelation: true },
  simeq: { isBinaryRelation: true },
  leq: { isBinaryRelation: true },
  geq: { isBinaryRelation: true },
  neq: { isBinaryRelation: true },
  cup: { isBinaryRelation: true },
  cap: { isBinaryRelation: true },
  land: { isBinaryRelation: true },
  lor: { isBinaryRelation: true },
  setminus: { isBinaryRelation: true },
  parallel: { isBinaryRelation: true },
  perp: { isBinaryRelation: true },
  leftarrow: { isBinaryRelation: true },
  leftrightarrow: { isBinaryRelation: true },
  uparrow: { isBinaryRelation: true },
  downarrow: { isBinaryRelation: true },
  hookrightarrow: { isBinaryRelation: true },
  mid_rel: { isBinaryRelation: true },
};

const LEGACY_OPTIONAL_SLOTS: Readonly<Record<string, readonly number[]>> = {
  nth_root: [0],
};

export const COMMAND_CAPABILITIES: ReadonlyMap<string, CommandCapabilities> = (() => {
  const map = new Map<string, CommandCapabilities>();
  for (const cmd of COMMANDS) {
    const ov = SPEC_OVERRIDES[cmd.id];
    map.set(cmd.id, {
      optionalSlots: cmd.optionalSlots ?? [],
      ...(ov ?? {}),
    });
  }
  for (const [id, ov] of Object.entries(SPEC_OVERRIDES)) {
    if (!map.has(id)) {
      map.set(id, {
        optionalSlots: LEGACY_OPTIONAL_SLOTS[id] ?? [],
        ...ov,
      });
    }
  }
  return map;
})();

const EMPTY_CAPS: CommandCapabilities = { optionalSlots: [] };

export function getCommandCapabilities(commandId: string): CommandCapabilities {
  return COMMAND_CAPABILITIES.get(commandId) ?? EMPTY_CAPS;
}

export function getOptionalSlots(commandId: string): readonly number[] {
  return getCommandCapabilities(commandId).optionalSlots;
}

export function isTightSlot(commandId: string, slotIndex: number): boolean {
  return getCommandCapabilities(commandId).tightSlots?.includes(slotIndex) ?? false;
}

export function getSlotPlacement(commandId: string, slotIndex: number): 'top' | 'bottom' {
  return getCommandCapabilities(commandId).bottomSlots?.includes(slotIndex) ? 'bottom' : 'top';
}

export function isIntegralBodySlot(commandId: string, slotIndex: number): boolean {
  return getCommandCapabilities(commandId).integralBodySlots?.includes(slotIndex) ?? false;
}

export const BINARY_RELATION_SYMBOLS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.isBinaryRelation)
    .map(([id]) => id),
);

export const SELF_DELIMITED_STRUCTS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.isSelfDelimited)
    .map(([id]) => id),
);

export const DELIMITER_STRUCT_IDS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.isDelimiter)
    .map(([id]) => id),
);

export const PREFIX_BIGOPS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.isPrefixBigOp)
    .map(([id]) => id),
);

export const INTEGRAL_OPS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.isIntegralOp)
    .map(([id]) => id),
);

export const TALL_STRUCT_IDS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.isTall)
    .map(([id]) => id),
);

export const BACKWARD_WRAP_CMDS: ReadonlySet<string> = new Set(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => c.backwardWrap)
    .map(([id]) => id),
);

export const BUILTIN_GRID_META: Readonly<Record<string, GridMeta>> = Object.fromEntries(
  Array.from(COMMAND_CAPABILITIES.entries())
    .filter(([, c]) => Boolean(c.gridMeta))
    .map(([id, c]) => [id, c.gridMeta!]),
);

export const INLINE_STRUCT_MAP: Readonly<Record<string, string>> = (() => {
  const rec: Record<string, string> = {};
  for (const [id, caps] of COMMAND_CAPABILITIES.entries()) {
    if (!COMMANDS_BY_ID.has(id)) continue;
    for (const macro of caps.inlineMacros ?? []) {
      rec[macro] = id;
    }
  }
  return rec;
})();

export const ACCENT_MACRO_MAP: Readonly<Record<string, string>> = (() => {
  const rec: Record<string, string> = {};
  for (const [id, caps] of COMMAND_CAPABILITIES.entries()) {
    if (caps.accentMacro && COMMANDS_BY_ID.has(id)) {
      rec[caps.accentMacro] = id;
    }
  }
  return rec;
})();

export const CASES_ENVS = new Set(['cases', 'dcases', 'rcases']);
export const SUPPORTED_MATRIX_ENVS = new Set([
  'pmatrix',
  'bmatrix',
  'vmatrix',
  'Bmatrix',
  'Vmatrix',
  'matrix',
  'smallmatrix',
]);

export function isCasesEnv(env: string): boolean {
  return CASES_ENVS.has(env);
}

// ============================================================================
// Matrix / Array Column Spec (`{cc|c}`) Pure Helpers
// ============================================================================

export interface ParsedColSpec {
  leadingBar: string;
  aligns: ('l' | 'c' | 'r')[];
  rightBars: string[];
}

export function isSupportedColSpec(raw: string): boolean {
  const clean = raw.replace(/\s+/g, '');
  return clean.length > 0 && /^[lcr|]+$/.test(clean) && /[lcr]/.test(clean);
}

export function parseColSpec(spec: string | undefined, cols: number): ParsedColSpec {
  const safeCols = Math.max(1, cols);
  if (!spec || !isSupportedColSpec(spec)) {
    return {
      leadingBar: '',
      aligns: Array.from({ length: safeCols }, () => 'c'),
      rightBars: Array.from({ length: safeCols }, () => ''),
    };
  }
  const clean = spec.replace(/\s+/g, '');
  let i = 0;
  let leadingBar = '';
  while (i < clean.length && clean[i] === '|') {
    leadingBar += '|';
    i += 1;
  }
  const aligns: ('l' | 'c' | 'r')[] = [];
  const rightBars: string[] = [];
  while (i < clean.length) {
    const ch = clean[i];
    if (ch === 'l' || ch === 'c' || ch === 'r') {
      aligns.push(ch);
      i += 1;
      let bars = '';
      while (i < clean.length && clean[i] === '|') {
        bars += '|';
        i += 1;
      }
      rightBars.push(bars);
    } else {
      i += 1;
    }
  }
  while (aligns.length < safeCols) {
    aligns.push('c');
    rightBars.push('');
  }
  if (aligns.length > safeCols) {
    aligns.length = safeCols;
    rightBars.length = safeCols;
  }
  return { leadingBar, aligns, rightBars };
}

export function serializeColSpec(parsed: ParsedColSpec): string {
  let out = parsed.leadingBar;
  for (let i = 0; i < parsed.aligns.length; i += 1) {
    out += parsed.aligns[i] + (parsed.rightBars[i] ?? '');
  }
  return out;
}

export function hasCustomColSpec(colSpec: string | undefined, cols: number): boolean {
  if (!colSpec) return false;
  const parsed = parseColSpec(colSpec, cols);
  return (
    parsed.leadingBar.length > 0 ||
    parsed.aligns.some((a) => a !== 'c') ||
    parsed.rightBars.some((b) => b.length > 0)
  );
}

export function hasColRightBar(colSpec: string | undefined, cols: number, col: number): boolean {
  if (!colSpec || col < 0 || col >= cols - 1) return false;
  const parsed = parseColSpec(colSpec, cols);
  return (parsed.rightBars[col]?.length ?? 0) > 0;
}

export function insertColIntoSpec(
  colSpec: string | undefined,
  cols: number,
  insertAt: number,
  env: string,
): string | undefined {
  if (!colSpec && env !== 'array') return undefined;
  const parsed = parseColSpec(colSpec, cols);
  const idx = Math.max(0, Math.min(insertAt, parsed.aligns.length));
  parsed.aligns.splice(idx, 0, 'c');
  parsed.rightBars.splice(idx, 0, '');
  const next = serializeColSpec(parsed);
  return env === 'array' || hasCustomColSpec(next, cols + 1) ? next : undefined;
}

export function removeColFromSpec(
  colSpec: string | undefined,
  cols: number,
  removeAt: number,
  env: string,
): string | undefined {
  if (!colSpec && env !== 'array') return undefined;
  if (cols <= 1) return env === 'array' ? 'c' : undefined;
  const parsed = parseColSpec(colSpec, cols);
  const idx = Math.max(0, Math.min(removeAt, parsed.aligns.length - 1));
  const removedBar = parsed.rightBars[idx] ?? '';
  parsed.aligns.splice(idx, 1);
  parsed.rightBars.splice(idx, 1);
  // If removed column carried an interior separator bar and had a left neighbor without one, preserve separator
  if (removedBar && idx > 0 && idx <= parsed.rightBars.length && !parsed.rightBars[idx - 1]) {
    parsed.rightBars[idx - 1] = removedBar;
  }
  if (parsed.rightBars.length > 0 && env !== 'array') {
    // Strip trailing right-edge bar on plain matrix wrappers unless array
    parsed.rightBars[parsed.rightBars.length - 1] = parsed.rightBars[parsed.rightBars.length - 1] ?? '';
  }
  const next = serializeColSpec(parsed);
  return env === 'array' || hasCustomColSpec(next, cols - 1) ? next : undefined;
}

export function toggleColRightBar(
  colSpec: string | undefined,
  cols: number,
  col: number,
  env: string,
): string | undefined {
  if (col < 0 || col >= cols - 1) return colSpec;
  const parsed = parseColSpec(colSpec, cols);
  parsed.rightBars[col] = parsed.rightBars[col] ? '' : '|';
  const next = serializeColSpec(parsed);
  return env === 'array' || hasCustomColSpec(next, cols) ? next : undefined;
}

export function formatGridEnvironment(
  env: string,
  colSpec: string | undefined,
  cols: number,
  body: string,
): string {
  if (env === 'array') {
    const spec = colSpec && isSupportedColSpec(colSpec) ? colSpec.replace(/\s+/g, '') : 'c'.repeat(Math.max(1, cols));
    return `\\begin{array}{${spec}} ${body} \\end{array}`;
  }
  if (colSpec && hasCustomColSpec(colSpec, cols)) {
    const spec = serializeColSpec(parseColSpec(colSpec, cols));
    switch (env) {
      case 'pmatrix':
        return `\\left(\\begin{array}{${spec}} ${body} \\end{array}\\right)`;
      case 'bmatrix':
        return `\\left[\\begin{array}{${spec}} ${body} \\end{array}\\right]`;
      case 'Bmatrix':
        return `\\left\\{\\begin{array}{${spec}} ${body} \\end{array}\\right\\}`;
      case 'vmatrix':
        return `\\left|\\begin{array}{${spec}} ${body} \\end{array}\\right|`;
      case 'Vmatrix':
        return `\\left\\Vert\\begin{array}{${spec}} ${body} \\end{array}\\right\\Vert`;
      case 'matrix':
        return `\\begin{array}{${spec}} ${body} \\end{array}`;
    }
  }
  return `\\begin{${env}} ${body} \\end{${env}}`;
}

// ============================================================================
// Template Sanitization & Persisted Settings Schema Normalization
// ============================================================================

function readBracedAt(src: string, startBraceIdx: number): { content: string; nextPos: number } | null {
  if (src[startBraceIdx] !== '{') return null;
  let pos = startBraceIdx + 1;
  let depth = 1;
  while (pos < src.length && depth > 0) {
    if (src[pos] === '\\') {
      pos += 2;
      continue;
    }
    if (src[pos] === '{') depth += 1;
    else if (src[pos] === '}') depth -= 1;
    if (depth > 0) pos += 1;
  }
  const content = src.slice(startBraceIdx + 1, pos);
  return { content, nextPos: src[pos] === '}' ? pos + 1 : pos };
}

/**
 * Strips untrusted KaTeX HTML/link/image extension macros (`\htmlData`, `\htmlClass`,
 * `\htmlId`, `\htmlStyle`, `\href`, `\url`, `\includegraphics`) from user-defined templates
 * so custom structures or external `commands.json` can never spoof interactive DOM attributes.
 */
export function sanitizeLatexTemplate(template: string): string {
  if (!template || !template.includes('\\')) return template;
  let out = '';
  let i = 0;
  while (i < template.length) {
    if (template[i] === '\\') {
      let end = i + 1;
      while (end < template.length && /[a-zA-Z]/.test(template[end])) end += 1;
      const macro = template.slice(i, end);
      if (
        macro === '\\htmlData' ||
        macro === '\\htmlClass' ||
        macro === '\\htmlId' ||
        macro === '\\htmlStyle' ||
        macro === '\\href'
      ) {
        let scan = end;
        while (scan < template.length && /\s/.test(template[scan])) scan += 1;
        const first = readBracedAt(template, scan);
        if (first) {
          scan = first.nextPos;
          while (scan < template.length && /\s/.test(template[scan])) scan += 1;
          const second = readBracedAt(template, scan);
          if (second) {
            out += sanitizeLatexTemplate(second.content);
            i = second.nextPos;
            continue;
          }
          i = first.nextPos;
          continue;
        }
      }
      if (macro === '\\url' || macro === '\\includegraphics') {
        let scan = end;
        while (scan < template.length && /\s/.test(template[scan])) scan += 1;
        if (template[scan] === '[') {
          const closeB = template.indexOf(']', scan + 1);
          if (closeB !== -1) scan = closeB + 1;
        }
        while (scan < template.length && /\s/.test(template[scan])) scan += 1;
        const arg = readBracedAt(template, scan);
        i = arg ? arg.nextPos : end;
        continue;
      }
    }
    out += template[i];
    i += 1;
  }
  return out;
}

const VALID_THEMES = new Set<ThemeMode>(['system', 'light', 'dark']);
const VALID_LEADERS = new Set<LeaderKey>(['Tab', '/']);
const VALID_DELIMITERS = new Set(['none', 'inline', 'block', 'codeblock']);
const VALID_PRESET_ORDERS = new Set<SlotOrderPreset>(['standard', 'writing_cn']);

/**
 * Normalizes and migrates persisted `AppSettings` (e.g. automatically migrating legacy
 * `leaderKey: '\\'` to `'Tab'` so inline `\int`/`\alpha`/`\,` macros work seamlessly).
 */
export function normalizeSettings(raw?: Partial<AppSettings> | null): AppSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...raw };
  if (!VALID_THEMES.has(merged.theme)) merged.theme = DEFAULT_SETTINGS.theme;
  // Migrate legacy `\` leader key -> `'Tab'`
  if (!VALID_LEADERS.has(merged.leaderKey)) {
    merged.leaderKey = 'Tab';
  }
  if (!VALID_DELIMITERS.has(merged.delimiter)) {
    merged.delimiter = DEFAULT_SETTINGS.delimiter;
  }
  if (!VALID_PRESET_ORDERS.has(merged.slotOrderPreset)) {
    merged.slotOrderPreset = DEFAULT_SETTINGS.slotOrderPreset;
  }
  if (!merged.slotOrderOverrides || typeof merged.slotOrderOverrides !== 'object') {
    merged.slotOrderOverrides = {};
  }
  return merged;
}

export type CommandCategory =
  | 'structure'
  | 'calculus'
  | 'matrix'
  | 'accent'
  | 'greek'
  | 'symbol'
  | 'relation'
  | 'setlogic';

export interface CommandDef {
  readonly id: string;
  readonly keys: readonly string[];
  readonly label: string;
  readonly category: CommandCategory;
  readonly glyph: string;
  readonly slots: readonly string[];
  /** Slot indices that are optional and collapse cleanly when left empty */
  readonly optionalSlots?: readonly number[];
  readonly latex: string;
  readonly doc: string;
  readonly examples: readonly string[];
  readonly wrapSlot: number | null;
}

export interface SubmenuMeta {
  readonly key: string;
  readonly category: CommandCategory;
  readonly label: string;
  readonly glyph: string;
  /** Default command inserted immediately when only the single submenu letter is pressed */
  readonly defaultCommandId?: string;
}

export interface PresetFormula {
  readonly id: string;
  readonly category: string;
  readonly name: string;
  readonly source: string;
  readonly desc: string;
  readonly tags: readonly string[];
}

export interface CharNode {
  type: 'char';
  id: string;
  value: string;
  /** True when imported from formal LaTeX or literal paste — suppresses bare-word shorthand expansion */
  verbatim?: boolean;
}

export interface SymbolNode {
  type: 'symbol';
  id: string;
  commandId: string;
  latex: string;
  glyph: string;
}

export interface GridMeta {
  env: string;
  rows: number;
  cols: number;
  /** Optional explicit LaTeX row gap after row `r`, e.g. `'4pt'` from `\\[4pt]` */
  rowGaps?: (string | undefined)[];
}

export interface StructNode {
  type: 'struct';
  id: string;
  commandId: string;
  slots: SlotNode[];
  /** Optional custom LaTeX template (for user-defined custom structures) */
  customLatex?: string;
  /** Optional per-instance slot order override (e.g. natural `a/b` fraction always exits after denominator) */
  fillOrder?: number[];
  /** Auto-sized delimiter inserted from keyboard `(`, `[`, `{`: emits plain `(x)` when flat and `\left(...\right)` when tall */
  autoSized?: boolean;
  /** Optional explicit `\limits` or `\nolimits` modifier preserved for big operators (`\int`, `\sum`, `\prod`, `\lim`, etc.) */
  limitsMode?: 'limits' | 'nolimits';
  /** Optional dynamic matrix / cases grid dimensions */
  grid?: GridMeta;
}

export interface RawNode {
  type: 'raw';
  id: string;
  latex: string;
}

export type MathNode = CharNode | SymbolNode | StructNode | RawNode;

export interface SlotNode {
  id: string;
  label: string;
  children: MathNode[];
}

export interface Document {
  root: SlotNode;
}

export interface Cursor {
  slotId: string;
  offset: number;
}

export interface Selection {
  slotId: string;
  start: number;
  end: number;
}

export interface JumpTarget {
  label: string;
  slotId: string;
  offset: number;
  slotLabel: string;
  anchorKind: 'scope-start' | 'scope-end' | 'slot' | 'text-term';
  /** Inclusive-exclusive child index range inside `slotId` for plain text-term targets (e.g. `42`) */
  termStart?: number;
  termEnd?: number;
  /** True if this slot contains nested structures and opens a sub-scope on selection */
  isComposite: boolean;
  /** Visual anchor hint so numerator/upper badges go above and denominator/lower badges go below */
  placement?: 'top' | 'bottom';
}

export interface JumpScopeCrumb {
  slotId: string;
  label: string;
}

export type EditorMode =
  | { kind: 'edit' }
  | { kind: 'leader'; prefix: string; pendingDefaultId?: string }
  | {
      kind: 'jump';
      scopePath: JumpScopeCrumb[];
      scopeSlotId: string;
      typed: string;
      targets: JumpTarget[];
      activeIdx: number;
    };

export type LeaderKey = 'Tab' | '/' | '\\';
export type DelimiterStyle = 'none' | 'inline' | 'block' | 'codeblock';
export type ThemeMode = 'system' | 'light' | 'dark';
export type SlotOrderPreset = 'standard' | 'writing_cn';
export type SlotOrderOverrides = Record<string, number[]>;

export interface AppSettings {
  theme: ThemeMode;
  leaderKey: LeaderKey;
  delimiter: DelimiterStyle;
  semicolonNextSlot: boolean;
  naturalScripts: boolean;
  naturalFraction: boolean;
  autoBrackets: boolean;
  spaceExitsScript: boolean;
  autoShorthands: boolean;
  showHierarchyBoxes: boolean;
  showLatexDock: boolean;
  slotOrderPreset: SlotOrderPreset;
  slotOrderOverrides: SlotOrderOverrides;
}

export interface Snippet {
  id: string;
  name: string;
  latex: string;
  /** Optional single key under `Tab t <key>` for instant keyboard insertion */
  key?: string;
  createdAt: number;
}

export interface HistoryFormula {
  id: string;
  latex: string;
  timestamp: number;
}

export interface ActiveGridInfo {
  structId: string;
  env: string;
  rows: number;
  cols: number;
  row: number;
  col: number;
  canEditCols: boolean;
}

export interface CustomCommandDef {
  id: string;
  label: string;
  latex: string;
  slots: string[];
  /** Optional single key under `Tab k <key>` */
  key?: string;
  /** Optional instant auto-expand trigger (e.g. `EE`) */
  shorthand?: string;
  /** Optional override: true = expand immediately without waiting for right word boundary; false = require boundary */
  immediateShorthand?: boolean;
}

export interface Diagnostic {
  severity: 'warning' | 'error';
  message: string;
}

export interface ImportResult {
  doc: Document;
  diagnostics: Diagnostic[];
  lossless: boolean;
}

export interface BreadcrumbItem {
  commandLabel: string;
  slotLabel: string;
  slotId: string;
}

export interface EditorSnapshot {
  doc: Document;
  cursor: Cursor;
  selection: Selection | null;
  mode: EditorMode;
  latex: string;
  interactiveLatex: string;
  breadcrumbs: BreadcrumbItem[];
  activeGrid: ActiveGridInfo | null;
  emptySlotCount: number;
  canUndo: boolean;
  canRedo: boolean;
  isEmpty: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  leaderKey: 'Tab',
  delimiter: 'inline',
  semicolonNextSlot: true,
  naturalScripts: true,
  naturalFraction: true,
  autoBrackets: true,
  spaceExitsScript: false,
  autoShorthands: true,
  showHierarchyBoxes: true,
  showLatexDock: true,
  slotOrderPreset: 'standard',
  slotOrderOverrides: {},
};

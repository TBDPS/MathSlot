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
}

export interface SymbolNode {
  type: 'symbol';
  id: string;
  commandId: string;
  latex: string;
  glyph: string;
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
}

export type EditorMode =
  | { kind: 'edit' }
  | { kind: 'leader'; prefix: string }
  | { kind: 'jump'; typed: string; targets: JumpTarget[] };

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
  autoShorthands: boolean;
  showLatexDock: boolean;
  slotOrderPreset: SlotOrderPreset;
  slotOrderOverrides: SlotOrderOverrides;
}

export interface Snippet {
  id: string;
  name: string;
  latex: string;
  createdAt: number;
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
  autoShorthands: true,
  showLatexDock: true,
  slotOrderPreset: 'standard',
  slotOrderOverrides: {},
};

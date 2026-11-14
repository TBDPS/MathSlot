export type EditorState =
  | 'Idle'
  | 'PrefixRoot'
  | { PrefixSub: { key: string } }
  | { Jump: { tail: string } }
  | { Nav: { path: string[] } }
  | { InvalidPrefix: { key: string } };

export type StatusSeverity = 'Info' | 'Warning' | 'Error';

export type Key =
  | 'Backspace'
  | 'Delete'
  | 'Tab'
  | 'Escape'
  | 'Enter'
  | 'ArrowLeft'
  | 'ArrowRight';

export type EditorAction =
  | 'Backspace'
  | 'Delete'
  | 'TabNext'
  | 'TabPrev'
  | 'Escape'
  | 'Enter';

export type NavAction =
  | 'EnterNav'
  | 'ExitNav'
  | 'NextSlot'
  | 'PrevSlot'
  | 'StepLeft'
  | 'StepRight';

export type ThemePreference = 'light' | 'dark' | 'system';

export type DelimiterStyle = 'none' | 'inline_dollar' | 'block_dollar' | 'code_fence';

export type RenderBackendPreference = 'mathjax' | 'latex-rust';

export interface ShortcutSettings {
  nav_next_slot: string;
  nav_prev_slot: string;
  nav_parent: string;
  nav_first_child: string;
  copy_latex: string;
  save_snippet: string;
  focus_editor: string;
  toggle_nav: string;
  open_settings: string;
}

export interface RecoveryStateSnapshot {
  corrupt_path: string;
  backup_candidate?: string | null;
  error: string;
}

export interface UserFormulaEntry {
  id: string;
  name: string;
  category: string;
  source: string;
  desc: string;
  tags: string[];
  is_builtin?: boolean;
  created_at?: number;
}

export interface AppSettings {
  theme: ThemePreference;
  delimiter_style: DelimiterStyle;
  render_backend: RenderBackendPreference;
  shortcuts: ShortcutSettings;
  config_path?: string | null;
  preview_scale_pct?: number | null;
}

export function createDefaultShortcuts(): ShortcutSettings {
  return {
    nav_next_slot: 'j',
    nav_prev_slot: 'k',
    nav_parent: 'h',
    nav_first_child: 'l',
    copy_latex: 'Mod+Shift+C',
    save_snippet: 'Mod+Shift+S',
    focus_editor: 'Mod+E',
    toggle_nav: 'Mod+J',
    open_settings: 'Mod+,',
  };
}

export function createDefaultAppSettings(): AppSettings {
  return {
    theme: 'system',
    delimiter_style: 'none',
    render_backend: 'mathjax',
    shortcuts: createDefaultShortcuts(),
    config_path: null,
    preview_scale_pct: null,
  };
}

export function formatLatexWithDelimiter(latex: string, style: DelimiterStyle): string {
  if (!latex) {
    return '';
  }
  switch (style) {
    case 'none':
      return latex;
    case 'inline_dollar':
      return `$${latex}$`;
    case 'block_dollar':
      return `$$\n${latex}\n$$`;
    case 'code_fence':
      return `\`\`\`latex\n${latex}\n\`\`\``;
  }
}

export type AppEvent =
  | { KeyInput: string }
  | { KeyDown: Key }
  | { Key: string }
  | { Action: EditorAction }
  | { Paste: string }
  | { PasteText: string }
  | { PaletteCard: string }
  | { ApplyCard: string }
  | 'Undo'
  | 'Redo'
  | { RequestExport: { strict: boolean } }
  | 'RequestCopy'
  | { ExportRequested: { strict: boolean; copy_to_clipboard: boolean } }
  | { ImeCompositionUpdate: string }
  | { ImeCompositionCommit: string }
  | { ImeComposition: string }
  | { ImeCommit: string }
  | 'EnterNavMode'
  | 'ExitNavMode'
  | { Navigate: NavAction }
  | { SelectSlot: number }
  | 'Clear'
  | { ImportLatex: string }
  | 'ImportAcknowledge'
  | { LoadStreamSource: string }
  | { UpdateSettings: AppSettings }
  | 'ResetSettingsConfirmed'
  | { SetRecoveryState: RecoveryStateSnapshot | null }
  | 'RequestRestoreBackup'
  | 'ConfirmResetEmptyConfig'
  | 'RequestImportConfig'
  | 'RequestExportConfig'
  | 'RequestSaveSnippet';

export type FocusTarget = { Slot: number } | 'End';

export interface RenderRequest {
  request_id: number;
  generation?: number;
  latex: string;
  preview_latex?: string;
  has_diagnostics: boolean;
}

export interface StatusMessage {
  severity: StatusSeverity;
  message: string;
}

export type RawEditorDiagnostic =
  | { PendingCommand: { prefix: string; message: string } }
  | { UnknownCommand: { command: string; message: string } }
  | { Syntax: string };

export type AppError =
  | { Doc: string }
  | { StrictExportBlocked: RawEditorDiagnostic[] };

export type HostAction =
  | { PersistSettings: AppSettings }
  | { RestoreBackup: { backup_path: string | null } }
  | 'ResetEmptyConfig'
  | 'ImportConfig'
  | 'ExportConfig'
  | { SaveSnippet: { source: string; latex: string } };

export type Effect =
  | { Render: RenderRequest }
  | { Clipboard: string }
  | { Status: StatusMessage }
  | { Focus: FocusTarget }
  | { ExportResult: { Ok: [string, RawEditorDiagnostic[]] } | { Err: AppError } }
  | { Host: HostAction };

export interface CommandSpan {
  start: number;
  end: number;
}

export interface SlotSnapshot {
  id: number;
  role: string;
  label: string;
  is_empty: boolean;
  is_active: boolean;
  span: CommandSpan;
  path?: number[];
  depth?: number;
}

export interface DiagnosticSnapshot {
  code: string;
  severity: StatusSeverity;
  message: string;
  summary?: string;
  source_excerpt?: string;
  truncated?: boolean;
  detail?: string;
  hint?: string | null;
  span?: CommandSpan | null;
}

export interface ImportReportSnapshot {
  lossless: boolean;
  empty_slots: number;
  raw_nodes: number;
  roundtrip_latex: string;
  normalized_match: boolean;
  blocked: boolean;
  diagnostics: DiagnosticSnapshot[];
}

export interface EngineSnapshot {
  state: EditorState;
  latex: string;
  preview_latex: string;
  copy_text: string;
  source?: string;
  cursor_char?: number;
  has_pending_command: boolean;
  is_composing: boolean;
  is_nav_mode: boolean;
  can_undo: boolean;
  can_redo: boolean;
  slots: SlotSnapshot[];
  diagnostics: DiagnosticSnapshot[];
  active_slot_id: number | null;
  settings?: AppSettings;
  recovery?: RecoveryStateSnapshot | null;
  last_import?: ImportReportSnapshot | null;
}

export interface DispatchResponse {
  effects: Effect[];
  snapshot: EngineSnapshot;
}

export interface EngineClient {
  dispatch(event: AppEvent): Promise<DispatchResponse>;
  snapshot(): Promise<EngineSnapshot>;
  engineVersion(): Promise<string>;
}

export function isNavEditorState(state: EditorState): boolean {
  return typeof state === 'object' && state !== null && 'Nav' in state;
}

export function createEmptySnapshot(): EngineSnapshot {
  return {
    state: 'Idle',
    latex: '',
    preview_latex: '',
    copy_text: '',
    has_pending_command: false,
    is_composing: false,
    is_nav_mode: false,
    can_undo: false,
    can_redo: false,
    slots: [],
    diagnostics: [],
    active_slot_id: null,
    settings: createDefaultAppSettings(),
    recovery: null,
    last_import: null,
  };
}

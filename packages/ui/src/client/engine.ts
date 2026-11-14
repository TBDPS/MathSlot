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
  | 'Clear'
  | { ImportLatex: string };

export type FocusTarget = { Slot: number } | 'End';

export interface RenderRequest {
  request_id: number;
  latex: string;
  has_diagnostics: boolean;
}

export interface StatusMessage {
  severity: StatusSeverity;
  message: string;
}

export type Effect =
  | { Render: RenderRequest }
  | { Clipboard: string }
  | { Status: StatusMessage }
  | { Focus: FocusTarget }
  | { ExportResult: { Ok: [string, unknown[]] } | { Err: unknown } };

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
}

export interface DiagnosticSnapshot {
  code: string;
  severity: StatusSeverity;
  message: string;
}

export interface EngineSnapshot {
  state: EditorState;
  latex: string;
  copy_text: string;
  has_pending_command: boolean;
  is_composing: boolean;
  is_nav_mode: boolean;
  can_undo: boolean;
  can_redo: boolean;
  slots: SlotSnapshot[];
  diagnostics: DiagnosticSnapshot[];
  active_slot_id: number | null;
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
    copy_text: '',
    has_pending_command: false,
    is_composing: false,
    is_nav_mode: false,
    can_undo: false,
    can_redo: false,
    slots: [],
    diagnostics: [],
    active_slot_id: null,
  };
}

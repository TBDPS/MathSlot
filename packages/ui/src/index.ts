export { default as MathSlotEditor } from './editor/MathSlotEditor.svelte';
export type { MathSlotEditorProps } from './editor/MathSlotEditor.svelte';

export {
  createEmptySnapshot,
  isNavEditorState,
  type AppEvent,
  type CommandSpan,
  type DiagnosticSnapshot,
  type DispatchResponse,
  type EditorAction,
  type EditorState,
  type Effect,
  type EngineClient,
  type EngineSnapshot,
  type FocusTarget,
  type Key,
  type NavAction,
  type RenderRequest,
  type SlotSnapshot,
  type StatusMessage,
  type StatusSeverity,
} from './client/engine';

export {
  createCommandDecorationsExtension,
  describeEditorMode,
  engineSnapshotField,
  formatSlotAriaLabel,
  resolveActiveCommand,
  resolveCommandByKeySequence,
  setEngineSnapshotEffect,
} from './editor/decorations';

export {
  createMathSlotKeymapExtension,
  navModeFacet,
  type KeymapExtensionOptions,
} from './editor/keymap';

export {
  COMMANDS,
  COMMANDS_BY_ID,
  type CommandCategory,
  type CommandEntry,
} from './generated/catalog';

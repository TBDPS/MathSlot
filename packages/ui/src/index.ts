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

export {
  PRESETS,
  PRESET_CATEGORIES,
  type PresetCategory,
  type PresetEntry,
} from './generated/presets';

export { default as PalettePanel } from './palette/PalettePanel.svelte';
export type { PalettePanelProps } from './palette/PalettePanel.svelte';

export {
  COMMAND_CATEGORIES,
  D001_FEATURED_IDS,
  PRESET_CATEGORY_TABS,
  filterCommands,
  filterPresets,
  formatCommandShortcut,
  getFeaturedCommands,
  moveGridIndex,
  type CategoryMeta,
} from './palette/paletteModel';

export { default as NavTreePanel } from './nav/NavTreePanel.svelte';
export type { NavTreePanelProps } from './nav/NavTreePanel.svelte';

export {
  buildNavTree,
  flattenNavTree,
  type FlattenedNavItem,
  type NavTreeNode,
} from './nav/navTree';

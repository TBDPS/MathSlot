export { default as MathSlotEditor } from './editor/MathSlotEditor.svelte';
export type { MathSlotEditorProps } from './editor/MathSlotEditor.svelte';

export {
  createEmptySnapshot,
  isNavEditorState,
  type AppError,
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
  type RawEditorDiagnostic,
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

export { default as PreviewPanel } from './preview/PreviewPanel.svelte';
export type { PreviewPanelProps } from './preview/PreviewPanel.svelte';

export {
  HEADER_MAX_CHARS,
  SOURCE_MAX_CHARS,
  TRUNCATED_SUFFIX,
  createHostRenderMathAdapter,
  createLatexRustBridgeAdapter,
  createManagedRenderer,
  createMathJaxSvgAdapter,
  extractMathJaxErrors,
  summarizeRenderError,
  type LatexRustInvokeResult,
  type ManagedCacheStats,
  type ManagedRenderer,
  type ManagedRendererOptions,
  type MathJaxAdapterOptions,
  type PreviewDiagnostic,
  type PreviewRenderRequest,
  type PreviewRenderResult,
  type RenderAdapter,
  type RenderBackendKind,
  type RenderFormat,
  type RenderMode,
  type RenderTheme,
} from './preview/renderAdapter';

export { default as DiagnosticsPanel } from './diagnostics/DiagnosticsPanel.svelte';
export type { DiagnosticsPanelProps } from './diagnostics/DiagnosticsPanel.svelte';

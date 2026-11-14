export { default as MathSlotEditor } from './editor/MathSlotEditor.svelte';
export type { MathSlotEditorProps } from './editor/MathSlotEditor.svelte';

export {
  createDefaultAppSettings,
  createDefaultShortcuts,
  createEmptySnapshot,
  formatLatexWithDelimiter,
  isNavEditorState,
  type AppError,
  type AppEvent,
  type AppSettings,
  type CommandSpan,
  type DelimiterStyle,
  type DiagnosticSnapshot,
  type DispatchResponse,
  type EditorAction,
  type EditorState,
  type Effect,
  type EngineClient,
  type EngineSnapshot,
  type FocusTarget,
  type HostAction,
  type ImportReportSnapshot,
  type Key,
  type NavAction,
  type RawEditorDiagnostic,
  type RecoveryStateSnapshot,
  type RenderBackendPreference,
  type RenderRequest,
  type ShortcutSettings,
  type SlotSnapshot,
  type StatusMessage,
  type StatusSeverity,
  type ThemePreference,
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
  resolveShortcutSettings,
  shortcutsFacet,
  type KeymapExtensionOptions,
  type ShortcutCallbacks,
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

export { default as SettingsPanel } from './settings/SettingsPanel.svelte';
export type { SettingsPanelProps } from './settings/SettingsPanel.svelte';

export { default as ImportModal } from './import/ImportModal.svelte';
export type { ImportModalProps } from './import/ImportModal.svelte';

export {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  formatKeyboardEventToShortcut,
  isReservedShortcut,
  matchesShortcut,
  normalizeShortcut,
  parseShortcut,
  validateShortcuts,
  type ParsedShortcut,
  type ShortcutActionId,
  type ShortcutActionMeta,
  type ShortcutScope,
  type ShortcutValidationIssue,
  type ShortcutValidationResult,
} from './settings/shortcuts';

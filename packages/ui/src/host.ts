import type {
  AppSettings,
  CustomCommandDef,
  DelimiterStyle,
  HistoryFormula,
  MathWrapperKind,
  PersistedDraftV1,
  Snippet,
  UserCommandEntry,
  UserPresetEntry,
} from '@mathslot/core';

export interface PersistedStore {
  settings: Partial<AppSettings>;
  snippets: Snippet[];
  customCommands?: CustomCommandDef[];
  history?: HistoryFormula[];
  userPresets?: UserPresetEntry[];
  userCommands?: UserCommandEntry[];
  favoriteIds?: string[];
  recentIds?: string[];
  lastDraftLatex?: string;
  lastDraftV1?: PersistedDraftV1 | null;
}

export interface ExternalUserLibraries {
  configDir: string;
  presetsJson: string;
  commandsJson: string;
  presetsNewlyCreated?: boolean;
  commandsNewlyCreated?: boolean;
}

export interface HostAdapter {
  /** Primary submit button label: '复制' on Desktop, '插入笔记' in Obsidian */
  primaryActionLabel: string;
  /** Compact toolbar mode (Obsidian plugin modal): folds secondary actions into top-right overflow menu and reserves room for modal close button */
  compactToolbar?: boolean;
  /** Copy text to OS clipboard */
  copyText(text: string): Promise<void>;
  /** Optional clipboard read for 1-click paste in Import modal */
  readText?(): Promise<string>;
  /** Optional native PNG/RGBA image clipboard copy */
  copyImagePng?(rgba: Uint8Array, width: number, height: number, blob: Blob): Promise<void>;
  /** Optional native export file save (returns saved path) */
  saveExportFile?(filename: string, bytes: Uint8Array): Promise<string>;
  /** Optional open downloads/export folder in OS file manager */
  openDownloadsDir?(): Promise<void>;
  /** Optional desktop window always-on-top pin toggle */
  setAlwaysOnTop?(pinned: boolean): Promise<void>;
  /** Optional quick-summon workflow: hide desktop window back to background after copy */
  hideWindow?(): Promise<void>;
  /** Optional load external editable presets.json & commands.json from config folder */
  loadUserLibraries?(): Promise<ExternalUserLibraries>;
  /** Optional save external editable presets.json & commands.json to config folder */
  saveUserLibraries?(presetsJson: string, commandsJson: string): Promise<void>;
  /** Optional open external config folder in OS file manager */
  openConfigDir?(): Promise<void>;
  /** Called on primary submit (Ctrl+Enter or clicking primary CTA). Return toast label or void. */
  onPrimarySubmit?(formattedLatex: string, rawLatex: string): Promise<string | void>;
  /** Load persisted settings, snippets, custom structures & formula history */
  loadStore(): Promise<PersistedStore>;
  /** Persist settings, snippets, custom structures & formula history */
  saveStore(store: PersistedStore): Promise<void>;
  /** Optional initial formula (e.g. selected or cursor-enclosed LaTeX in Obsidian) */
  initialFormula?: string;
  /** Optional session-scoped delimiter override (does NOT overwrite persisted user settings!) */
  initialDelimiter?: DelimiterStyle;
  /** Optional exact source wrapper dialect (e.g. `paren_inline` for `\(...\)`) preserved on primary submit */
  initialWrapper?: MathWrapperKind;
  /** Optional external dark-mode override (e.g. Obsidian host theme) */
  hostDarkMode?: () => boolean;
  /** Optional reactive dark-mode subscription so open modals follow live host theme switches */
  subscribeDarkMode?: (listener: (dark: boolean) => void) => () => void;
}

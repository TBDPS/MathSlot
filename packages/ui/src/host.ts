import type { AppSettings, CustomCommandDef, HistoryFormula, Snippet } from '@mathslot/core';

export interface PersistedStore {
  settings: Partial<AppSettings>;
  snippets: Snippet[];
  customCommands?: CustomCommandDef[];
  history?: HistoryFormula[];
}

export interface HostAdapter {
  /** Primary submit button label: '复制' on Desktop, '插入笔记' in Obsidian */
  primaryActionLabel: string;
  /** Copy text to OS clipboard */
  copyText(text: string): Promise<void>;
  /** Optional clipboard read for 1-click paste in Import modal */
  readText?(): Promise<string>;
  /** Optional native PNG/RGBA image clipboard copy */
  copyImagePng?(rgba: Uint8Array, width: number, height: number, blob: Blob): Promise<void>;
  /** Optional desktop window always-on-top pin toggle */
  setAlwaysOnTop?(pinned: boolean): Promise<void>;
  /** Called on primary submit (Ctrl+Enter or clicking primary CTA). Return toast label or void. */
  onPrimarySubmit?(formattedLatex: string, rawLatex: string): Promise<string | void>;
  /** Load persisted settings, snippets, custom structures & formula history */
  loadStore(): Promise<PersistedStore>;
  /** Persist settings, snippets, custom structures & formula history */
  saveStore(store: PersistedStore): Promise<void>;
  /** Optional initial formula (e.g. selected or cursor-enclosed LaTeX in Obsidian) */
  initialFormula?: string;
  /** Optional external dark-mode override (e.g. Obsidian host theme) */
  hostDarkMode?: () => boolean;
}

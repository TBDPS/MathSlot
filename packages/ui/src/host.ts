import type { AppSettings, CustomCommandDef, Snippet } from '@mathslot/core';

export interface PersistedStore {
  settings: Partial<AppSettings>;
  snippets: Snippet[];
  customCommands?: CustomCommandDef[];
}

export interface HostAdapter {
  /** Primary submit button label: '复制' on Desktop, '插入笔记' in Obsidian */
  primaryActionLabel: string;
  /** Copy text to OS clipboard */
  copyText(text: string): Promise<void>;
  /** Optional clipboard read for 1-click paste in Import modal */
  readText?(): Promise<string>;
  /** Called on primary submit (Ctrl+Enter or clicking primary CTA). Return toast label or void. */
  onPrimarySubmit?(formattedLatex: string, rawLatex: string): Promise<string | void>;
  /** Load persisted settings, snippets & custom structures */
  loadStore(): Promise<PersistedStore>;
  /** Persist settings, snippets & custom structures */
  saveStore(store: PersistedStore): Promise<void>;
  /** Optional initial formula (e.g. selected LaTeX in Obsidian) */
  initialFormula?: string;
  /** Optional external dark-mode override (e.g. Obsidian host theme) */
  hostDarkMode?: () => boolean;
}

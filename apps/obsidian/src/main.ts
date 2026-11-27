import 'katex/dist/katex.min.css';
import '@mathslot/ui/styles.css';
import './obsidian.css';
import { Notice, Plugin, type Editor, type EditorPosition } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { PersistedStore } from '@mathslot/ui';
import {
  COMMANDS,
  DEFAULT_SETTINGS,
  canonicalBlockquotePrefix,
  detectFormulaInWindow,
  detectWrapperFromRaw,
  extractBlockquotePrefix,
  mergeCommands,
  normalizeSettings,
  stripBlockquoteSelection,
  type AppSettings,
  type CommandDef,
  type CustomCommandDef,
  type DelimiterStyle,
  type MathWrapperKind,
  type Snippet,
} from '@mathslot/core';
import { MathSlotModal } from './MathSlotModal';
import {
  DEFAULT_OBSIDIAN_DOCK_PREFS,
  MathSlotSettingTab,
  type ObsidianDockPrefs,
} from './SettingTab';
import {
  createMathSlotDockController,
  type DockSharedConfig,
  type MathSlotDockController,
} from './dockExtension';
import type { DockBinding } from './dockStore.svelte';

export interface ObsidianPluginData extends PersistedStore {
  obsidianInline?: Partial<ObsidianDockPrefs>;
}

function mergeByIdDelta<T extends { id: string }>(
  base: readonly T[],
  disk: readonly T[],
  local: readonly T[],
): T[] {
  const baseIds = new Set(base.map((x) => x.id));
  const localIds = new Set(local.map((x) => x.id));
  const deleted = new Set([...baseIds].filter((id) => !localIds.has(id)));
  const localById = new Map(local.map((x) => [x.id, x]));

  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of local) {
    out.push(item);
    seen.add(item.id);
  }
  for (const item of disk) {
    if (!seen.has(item.id) && !deleted.has(item.id)) {
      out.push(localById.get(item.id) ?? item);
      seen.add(item.id);
    }
  }
  return out;
}

function mergeStringSetDelta(
  base: readonly string[],
  disk: readonly string[],
  local: readonly string[],
  maxLen?: number,
): string[] {
  const baseSet = new Set(base);
  const localSet = new Set(local);
  const deleted = new Set([...baseSet].filter((x) => !localSet.has(x)));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of local) {
    if (!seen.has(item)) {
      out.push(item);
      seen.add(item);
    }
  }
  for (const item of disk) {
    if (!seen.has(item) && !deleted.has(item)) {
      out.push(item);
      seen.add(item);
    }
  }
  return maxLen ? out.slice(0, maxLen) : out;
}

function normalizeDockPrefs(
  raw?: Partial<ObsidianDockPrefs & { autoActivateOnClick?: boolean }> | null,
): ObsidianDockPrefs {
  const legacyAuto = raw?.autoShowOnFormulaCursor ?? raw?.autoActivateOnClick;
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULT_OBSIDIAN_DOCK_PREFS.enabled,
    autoShowOnFormulaCursor:
      typeof legacyAuto === 'boolean'
        ? legacyAuto
        : DEFAULT_OBSIDIAN_DOCK_PREFS.autoShowOnFormulaCursor,
    semicolonExitsAtRoot:
      typeof raw?.semicolonExitsAtRoot === 'boolean'
        ? raw.semicolonExitsAtRoot
        : DEFAULT_OBSIDIAN_DOCK_PREFS.semicolonExitsAtRoot,
  };
}

export default class MathSlotPlugin extends Plugin {
  private saveQueue: Promise<void> = Promise.resolve();
  private dockPrefs: ObsidianDockPrefs = { ...DEFAULT_OBSIDIAN_DOCK_PREFS };
  private workbenchSettings: AppSettings = { ...DEFAULT_SETTINGS };
  private effectiveCommands: readonly CommandDef[] = COMMANDS;
  private customCommands: CustomCommandDef[] = [];
  private snippets: Snippet[] = [];
  private dockController: MathSlotDockController | null = null;

  async onload(): Promise<void> {
    await this.reloadConfigFromDisk();

    this.dockController = createMathSlotDockController({
      getPrefs: () => this.dockPrefs,
      getSharedConfig: () => this.buildSharedConfig(),
      openModalAtSpan: (view, binding) => {
        this.openEditorFromDockSpan(view, binding);
      },
    });

    this.registerEditorExtension(this.dockController.extension);
    this.addSettingTab(new MathSlotSettingTab(this.app, this));

    this.addRibbonIcon('sigma', 'MathSlot 公式工作台', () => {
      const editor = this.app.workspace.activeEditor?.editor;
      this.openEditor(editor);
    });

    this.addCommand({
      id: 'summon-mathslot-dock',
      name: '进入底部数学工作栏（新建 $...$ 或接管当前公式）',
      hotkeys: [{ modifiers: ['Alt'], key: 'm' }],
      editorCallback: (editor: Editor) => {
        const cmView = (editor as unknown as { cm?: EditorView })?.cm ?? null;
        if (!this.dockPrefs.enabled) {
          void this.updateDockPrefs({ enabled: true }).then(() => {
            this.dockController?.summonOrToggle(cmView, false);
          });
          return;
        }
        if (!this.dockController?.summonOrToggle(cmView, false)) {
          this.openEditor(editor);
        }
      },
    });

    this.addCommand({
      id: 'summon-mathslot-dock-block',
      name: '在底部工作栏插入块级公式 ($$...$$)',
      editorCallback: (editor: Editor) => {
        const cmView = (editor as unknown as { cm?: EditorView })?.cm ?? null;
        if (!this.dockController?.summonOrToggle(cmView, true)) {
          this.openEditor(editor, 'block');
        }
      },
    });

    this.addCommand({
      id: 'open-mathslot-editor',
      name: '打开全屏公式弹窗工作台（114 公式库 / 自定义结构 / MathML 导出）',
      editorCallback: (editor: Editor) => {
        this.openEditor(editor);
      },
    });

    this.addCommand({
      id: 'toggle-mathslot-dock-mode',
      name: '切换底部数学工作栏开关',
      callback: async () => {
        const next = !this.dockPrefs.enabled;
        await this.updateDockPrefs({ enabled: next });
        new Notice(next ? 'MathSlot：已开启底部数学工作栏' : 'MathSlot：已关闭底部数学工作栏');
      },
    });
  }

  public getDockPrefs(): ObsidianDockPrefs {
    return { ...this.dockPrefs };
  }

  public getWorkbenchSettings(): AppSettings {
    return { ...this.workbenchSettings };
  }

  public async updateDockPrefs(patch: Partial<ObsidianDockPrefs>): Promise<void> {
    const run = this.saveQueue.then(async () => {
      const prev = ((await this.loadData()) as Partial<ObsidianPluginData> | null) ?? {};
      const nextPrefs = normalizeDockPrefs({
        ...(prev.obsidianInline ?? this.dockPrefs),
        ...patch,
      });
      const merged: Partial<ObsidianPluginData> = {
        ...prev,
        obsidianInline: nextPrefs,
      };
      await this.saveData(merged);
      this.syncConfigFromData(merged);
      this.app.workspace.updateOptions?.();
    });
    this.saveQueue = run.catch(() => {});
    await run;
  }

  public async updateWorkbenchSettings(patch: Partial<AppSettings>): Promise<void> {
    const run = this.saveQueue.then(async () => {
      const prev = ((await this.loadData()) as Partial<ObsidianPluginData> | null) ?? {};
      const merged: Partial<ObsidianPluginData> = {
        ...prev,
        settings: {
          ...(prev.settings ?? {}),
          ...patch,
        },
      };
      await this.saveData(merged);
      this.syncConfigFromData(merged);
      this.app.workspace.updateOptions?.();
    });
    this.saveQueue = run.catch(() => {});
    await run;
  }

  public openWorkbenchFromSettings(editor?: Editor): void {
    this.openEditor(editor);
  }

  private buildSharedConfig(): DockSharedConfig {
    return {
      settings: this.workbenchSettings,
      effectiveCommands: this.effectiveCommands,
      customCommands: this.customCommands,
      snippets: this.snippets,
      semicolonExitsAtRoot: this.dockPrefs.semicolonExitsAtRoot,
    };
  }

  private async reloadConfigFromDisk(): Promise<void> {
    const data = ((await this.loadData()) as Partial<ObsidianPluginData> | null) ?? {};
    this.syncConfigFromData(data);
  }

  private syncConfigFromData(data: Partial<ObsidianPluginData>): void {
    this.dockPrefs = normalizeDockPrefs(data.obsidianInline);
    this.workbenchSettings = normalizeSettings(data.settings);
    const userCmds = Array.isArray(data.userCommands) ? data.userCommands : [];
    this.effectiveCommands = userCmds.length > 0 ? mergeCommands(COMMANDS, userCmds) : COMMANDS;
    this.customCommands = Array.isArray(data.customCommands) ? data.customCommands : [];
    this.snippets = Array.isArray(data.snippets) ? data.snippets : [];
    this.dockController?.broadcastConfig(this.buildSharedConfig());
  }

  private openEditorFromDockSpan(view: EditorView, binding: DockBinding): void {
    const editor = this.app.workspace.activeEditor?.editor;
    const doc = view.state.doc;
    const rawSlice = doc.sliceString(binding.rawFrom, binding.rawTo);
    const stripped = stripBlockquoteSelection(rawSlice);
    const initialFormula = stripped.clean.trim() || undefined;
    const isBlock =
      binding.wrapper === 'dollar_block' || binding.wrapper === 'bracket_block';
    const delimiter: DelimiterStyle = isBlock ? 'block' : 'inline';

    const fromLine = doc.lineAt(binding.rawFrom);
    const toLine = doc.lineAt(binding.rawTo);
    const fromPos: EditorPosition = {
      line: fromLine.number - 1,
      ch: binding.rawFrom - fromLine.from,
    };
    const toPos: EditorPosition = {
      line: toLine.number - 1,
      ch: binding.rawTo - toLine.from,
    };

    this.mountModal({
      editor,
      initialFormula,
      replaceRange: editor ? { from: fromPos, to: toPos } : undefined,
      expectedRangeText: editor ? editor.getRange(fromPos, toPos) : undefined,
      linePrefix: binding.linePrefix,
      includeFirstLinePrefix: binding.includeFirstLinePrefix,
      forceDelimiter: delimiter,
      initialWrapper: binding.wrapper,
    });
  }

  private openEditor(editor?: Editor, forceDelimiter?: DelimiterStyle): void {
    const rawSelected = editor?.getSelection() ?? '';
    const trimmedSelected = rawSelected.trim();

    let initialFormula: string | undefined;
    let replaceRange: { from: EditorPosition; to: EditorPosition } | undefined;
    let expectedRangeText: string | undefined;
    let linePrefix = '';
    let includeFirstLinePrefix = false;
    let detectedDelimiter: DelimiterStyle | undefined;
    let detectedWrapper: MathWrapperKind | undefined;

    if (trimmedSelected) {
      const stripped = stripBlockquoteSelection(rawSelected);
      initialFormula = stripped.clean.trim() || undefined;
      detectedWrapper = initialFormula ? detectWrapperFromRaw(initialFormula) : undefined;
      if (detectedWrapper === 'paren_inline' || detectedWrapper === 'dollar_inline') {
        detectedDelimiter = 'inline';
      } else if (detectedWrapper === 'bracket_block' || detectedWrapper === 'dollar_block') {
        detectedDelimiter = 'block';
      }
      if (editor) {
        const from = editor.getCursor('from');
        const to = editor.getCursor('to');
        replaceRange = { from, to };
        expectedRangeText = editor.getRange(from, to);
      }
      if (stripped.linePrefix) {
        linePrefix = stripped.linePrefix;
        includeFirstLinePrefix = true;
      } else if (editor) {
        const cursor = editor.getCursor('from');
        const split = extractBlockquotePrefix(editor.getLine(cursor.line));
        if (split.prefix) {
          linePrefix = canonicalBlockquotePrefix(split.prefix);
          includeFirstLinePrefix = false;
        }
      }
    } else if (editor) {
      const cursor = editor.getCursor();
      const windowStart = Math.max(0, cursor.line - 400);
      const windowEnd = Math.min(editor.lineCount(), cursor.line + 401);
      const windowLines: string[] = [];
      for (let i = windowStart; i < windowEnd; i += 1) {
        windowLines.push(editor.getLine(i));
      }
      let cursorInsideCodeBlock = false;
      if (windowStart > 0) {
        try {
          const activeLineEl = document.querySelector('.cm-active.cm-line');
          if (activeLineEl?.classList.contains('HyperMD-codeblock')) {
            cursorInsideCodeBlock = true;
          }
        } catch {
          // Ignore outside DOM
        }
      }
      const detected = detectFormulaInWindow(windowLines, windowStart, cursor, cursorInsideCodeBlock);
      if (detected) {
        initialFormula = detected.raw;
        replaceRange = { from: detected.from, to: detected.to };
        expectedRangeText = editor.getRange(detected.from, detected.to);
        linePrefix = detected.linePrefix;
        includeFirstLinePrefix = detected.includeFirstLinePrefix;
        detectedDelimiter = detected.delimiter;
        detectedWrapper = detected.wrapper;
      } else {
        const split = extractBlockquotePrefix(editor.getLine(cursor.line));
        if (split.prefix && cursor.ch >= split.prefix.length) {
          linePrefix = canonicalBlockquotePrefix(split.prefix);
          includeFirstLinePrefix = false;
        }
      }
    }

    this.mountModal({
      editor,
      initialFormula,
      replaceRange,
      expectedRangeText,
      linePrefix,
      includeFirstLinePrefix,
      forceDelimiter: forceDelimiter ?? detectedDelimiter,
      initialWrapper: forceDelimiter ? undefined : detectedWrapper,
    });
  }

  private mountModal(params: {
    editor?: Editor;
    initialFormula?: string;
    replaceRange?: { from: EditorPosition; to: EditorPosition };
    expectedRangeText?: string;
    linePrefix?: string;
    includeFirstLinePrefix?: boolean;
    forceDelimiter?: DelimiterStyle;
    initialWrapper?: MathWrapperKind;
  }): void {
    let loadedBase: PersistedStore | null = null;
    const modal = new MathSlotModal(this.app, {
      ...params,
      loadStore: async () => {
        const data = (await this.loadData()) as Partial<ObsidianPluginData> | null;
        const normalized: PersistedStore = {
          settings: data?.settings ?? {},
          snippets: Array.isArray(data?.snippets) ? data.snippets : [],
          customCommands: Array.isArray(data?.customCommands) ? data.customCommands : [],
          history: Array.isArray(data?.history) ? data.history : [],
          userPresets: Array.isArray(data?.userPresets) ? data.userPresets : [],
          userCommands: Array.isArray(data?.userCommands) ? data.userCommands : [],
          favoriteIds: Array.isArray(data?.favoriteIds) ? data.favoriteIds : [],
          recentIds: Array.isArray(data?.recentIds) ? data.recentIds : [],
          lastDraftLatex: typeof data?.lastDraftLatex === 'string' ? data.lastDraftLatex : '',
          lastDraftV1: data?.lastDraftV1 ?? null,
        };
        loadedBase = normalized;
        return normalized;
      },
      saveStore: async (store: PersistedStore) => {
        const run = this.saveQueue.then(async () => {
          const prev = ((await this.loadData()) as Partial<ObsidianPluginData> | null) ?? {};
          const base = loadedBase;
          const merged: ObsidianPluginData = {
            ...prev,
            ...store,
            obsidianInline: prev.obsidianInline,
            settings: { ...(prev.settings ?? {}), ...(store.settings ?? {}) },
            snippets: base
              ? mergeByIdDelta(base.snippets ?? [], prev.snippets ?? [], store.snippets ?? [])
              : (store.snippets ?? []),
            customCommands: base
              ? mergeByIdDelta(
                  base.customCommands ?? [],
                  prev.customCommands ?? [],
                  store.customCommands ?? [],
                )
              : (store.customCommands ?? []),
            history: base
              ? mergeByIdDelta(base.history ?? [], prev.history ?? [], store.history ?? []).slice(0, 40)
              : (store.history ?? []),
            userPresets: base
              ? mergeByIdDelta(base.userPresets ?? [], prev.userPresets ?? [], store.userPresets ?? [])
              : (store.userPresets ?? []),
            userCommands: base
              ? mergeByIdDelta(base.userCommands ?? [], prev.userCommands ?? [], store.userCommands ?? [])
              : (store.userCommands ?? []),
            favoriteIds: base
              ? mergeStringSetDelta(base.favoriteIds ?? [], prev.favoriteIds ?? [], store.favoriteIds ?? [])
              : (store.favoriteIds ?? []),
            recentIds: base
              ? mergeStringSetDelta(base.recentIds ?? [], prev.recentIds ?? [], store.recentIds ?? [], 16)
              : (store.recentIds ?? []),
          };
          loadedBase = merged;
          await this.saveData(merged);
          this.syncConfigFromData(merged);
        });
        this.saveQueue = run.catch(() => {});
        await run;
      },
    });
    modal.open();
  }
}

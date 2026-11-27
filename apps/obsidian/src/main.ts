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
  type DelimiterStyle,
  type InlineMathSpan,
  type MathWrapperKind,
} from '@mathslot/core';
import { InlineSplitWorkbenchStore } from './InlineSplitStore.svelte';
import { MathSlotModal } from './MathSlotModal';
import {
  DEFAULT_OBSIDIAN_INLINE_PREFS,
  MathSlotSettingTab,
  type ObsidianInlinePrefs,
} from './SettingTab';
import {
  createMathSlotInlineController,
  type MathSlotInlineController,
} from './inlineExtension';

export interface ObsidianPluginData extends PersistedStore {
  obsidianInline?: Partial<ObsidianInlinePrefs>;
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

function normalizeInlinePrefs(raw?: Partial<ObsidianInlinePrefs> | null): ObsidianInlinePrefs {
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULT_OBSIDIAN_INLINE_PREFS.enabled,
    autoActivateOnClick:
      typeof raw?.autoActivateOnClick === 'boolean'
        ? raw.autoActivateOnClick
        : DEFAULT_OBSIDIAN_INLINE_PREFS.autoActivateOnClick,
    semicolonExitsAtRoot:
      typeof raw?.semicolonExitsAtRoot === 'boolean'
        ? raw.semicolonExitsAtRoot
        : DEFAULT_OBSIDIAN_INLINE_PREFS.semicolonExitsAtRoot,
  };
}

export default class MathSlotPlugin extends Plugin {
  private saveQueue: Promise<void> = Promise.resolve();
  private inlinePrefs: ObsidianInlinePrefs = { ...DEFAULT_OBSIDIAN_INLINE_PREFS };
  private workbenchSettings: AppSettings = { ...DEFAULT_SETTINGS };
  private splitStore: InlineSplitWorkbenchStore | null = null;
  private inlineController: MathSlotInlineController | null = null;

  async onload(): Promise<void> {
    this.splitStore = new InlineSplitWorkbenchStore();
    await this.reloadInlineCacheFromDisk();

    this.inlineController = createMathSlotInlineController({
      getPrefs: () => this.inlinePrefs,
      store: this.splitStore,
      openWorkbenchAtSpan: (view, span) => {
        this.openEditorFromInlineSpan(view, span);
      },
    });

    this.registerEditorExtension(this.inlineController.extension);
    this.addSettingTab(new MathSlotSettingTab(this.app, this));

    this.addRibbonIcon('sigma', 'MathSlot 公式工作台', () => {
      const editor = this.app.workspace.activeEditor?.editor;
      this.openEditor(editor);
    });

    this.addCommand({
      id: 'summon-mathslot-inline',
      name: '进入原位分体工作台（自动包裹 $...$ / 再按升级 $$...$$）',
      hotkeys: [{ modifiers: ['Alt'], key: 'm' }],
      editorCallback: (editor: Editor) => {
        const cmView = (editor as unknown as { cm?: EditorView })?.cm ?? null;
        if (!this.inlinePrefs.enabled) {
          void this.updateInlinePrefs({ enabled: true }).then(() => {
            this.inlineController?.summonOrUpgrade(cmView);
          });
          return;
        }
        this.inlineController?.summonOrUpgrade(cmView);
      },
    });

    this.addCommand({
      id: 'open-mathslot-editor',
      name: '打开独立弹窗工作台（114 条公式库 / 自定义结构 / MathML 导出）',
      editorCallback: (editor: Editor) => {
        this.openEditor(editor);
      },
    });

    this.addCommand({
      id: 'open-mathslot-block',
      name: '在独立弹窗工作台中插入块级公式 ($$...$$)',
      editorCallback: (editor: Editor) => {
        this.openEditor(editor, 'block');
      },
    });

    this.addCommand({
      id: 'toggle-mathslot-inline-mode',
      name: '切换原位分体工作台总开关',
      callback: async () => {
        const next = !this.inlinePrefs.enabled;
        await this.updateInlinePrefs({ enabled: next });
        new Notice(next ? 'MathSlot：已开启原位分体工作台' : 'MathSlot：已关闭原位分体工作台');
      },
    });
  }

  override onunload(): void {
    this.splitStore?.destroy();
    this.splitStore = null;
  }

  public getInlinePrefs(): ObsidianInlinePrefs {
    return { ...this.inlinePrefs };
  }

  public getWorkbenchSettings(): AppSettings {
    return { ...this.workbenchSettings };
  }

  public async updateInlinePrefs(patch: Partial<ObsidianInlinePrefs>): Promise<void> {
    const run = this.saveQueue.then(async () => {
      const prev = ((await this.loadData()) as Partial<ObsidianPluginData> | null) ?? {};
      const nextPrefs = normalizeInlinePrefs({
        ...(prev.obsidianInline ?? this.inlinePrefs),
        ...patch,
      });
      const merged: Partial<ObsidianPluginData> = {
        ...prev,
        obsidianInline: nextPrefs,
      };
      await this.saveData(merged);
      this.syncStoreFromData(merged);
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
      this.syncStoreFromData(merged);
      this.app.workspace.updateOptions?.();
    });
    this.saveQueue = run.catch(() => {});
    await run;
  }

  public openWorkbenchFromSettings(editor?: Editor): void {
    this.openEditor(editor);
  }

  private async reloadInlineCacheFromDisk(): Promise<void> {
    const data = ((await this.loadData()) as Partial<ObsidianPluginData> | null) ?? {};
    this.syncStoreFromData(data);
  }

  private syncStoreFromData(data: Partial<ObsidianPluginData>): void {
    this.inlinePrefs = normalizeInlinePrefs(data.obsidianInline);
    this.workbenchSettings = normalizeSettings(data.settings);
    const userCmds = Array.isArray(data.userCommands) ? data.userCommands : [];
    const effectiveCommands = userCmds.length > 0 ? mergeCommands(COMMANDS, userCmds) : COMMANDS;

    if (this.splitStore) {
      this.splitStore.semicolonExitsAtRoot = this.inlinePrefs.semicolonExitsAtRoot;
      this.splitStore.syncExternalConfig({
        settings: this.workbenchSettings,
        effectiveCommands,
        customCommands: Array.isArray(data.customCommands) ? data.customCommands : [],
        snippets: Array.isArray(data.snippets) ? data.snippets : [],
      });
    }
  }

  private openEditorFromInlineSpan(view: EditorView, span: InlineMathSpan): void {
    const editor = this.app.workspace.activeEditor?.editor;
    const doc = view.state.doc;
    const rawSlice = doc.sliceString(span.rawFrom, span.rawTo);
    const stripped = stripBlockquoteSelection(rawSlice);
    const initialFormula = stripped.clean.trim() || undefined;
    const wrapper: MathWrapperKind = span.isBlock ? 'dollar_block' : 'dollar_inline';
    const delimiter: DelimiterStyle = span.isBlock ? 'block' : 'inline';

    const fromLine = doc.lineAt(span.rawFrom);
    const toLine = doc.lineAt(span.rawTo);
    const fromPos: EditorPosition = {
      line: fromLine.number - 1,
      ch: span.rawFrom - fromLine.from,
    };
    const toPos: EditorPosition = {
      line: toLine.number - 1,
      ch: span.rawTo - toLine.from,
    };

    let linePrefix = '';
    let includeFirstLinePrefix = false;
    if (stripped.linePrefix) {
      linePrefix = stripped.linePrefix;
      includeFirstLinePrefix = true;
    } else {
      const split = extractBlockquotePrefix(fromLine.text);
      if (split.prefix) {
        linePrefix = canonicalBlockquotePrefix(split.prefix);
        includeFirstLinePrefix = false;
      }
    }

    this.mountModal({
      editor,
      initialFormula,
      replaceRange: editor ? { from: fromPos, to: toPos } : undefined,
      expectedRangeText: editor ? editor.getRange(fromPos, toPos) : undefined,
      linePrefix,
      includeFirstLinePrefix,
      forceDelimiter: delimiter,
      initialWrapper: wrapper,
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
          this.syncStoreFromData(merged);
        });
        this.saveQueue = run.catch(() => {});
        await run;
      },
    });
    modal.open();
  }
}

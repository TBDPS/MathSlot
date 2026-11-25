import 'katex/dist/katex.min.css';
import '@mathslot/ui/styles.css';
import './obsidian.css';
import { Plugin, type Editor } from 'obsidian';
import type { PersistedStore } from '@mathslot/ui';
import {
  canonicalBlockquotePrefix,
  detectFormulaInLines,
  extractBlockquotePrefix,
  stripBlockquoteSelection,
  type DelimiterStyle,
} from '@mathslot/core';
import { MathSlotModal } from './MathSlotModal';

/**
 * 3-way delta merge for ID-keyed collections so two concurrent Obsidian modals never
 * overwrite each other's newly added snippets, history entries, or custom commands.
 */
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
  // Keep local order/updates first
  for (const item of local) {
    out.push(item);
    seen.add(item.id);
  }
  // Preserve concurrent disk additions that were not deleted by this modal
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

export default class MathSlotPlugin extends Plugin {
  private saveQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    this.addRibbonIcon('sigma', 'MathSlot 公式编辑器', () => {
      const editor = this.app.workspace.activeEditor?.editor;
      this.openEditor(editor);
    });

    this.addCommand({
      id: 'open-mathslot-editor',
      name: '打开公式编辑器（自动识别光标处公式）',
      editorCallback: (editor: Editor) => {
        this.openEditor(editor);
      },
    });

    this.addCommand({
      id: 'open-mathslot-block',
      name: '插入块级公式 ($$...$$)',
      editorCallback: (editor: Editor) => {
        this.openEditor(editor, 'block');
      },
    });
  }

  private openEditor(editor?: Editor, forceDelimiter?: DelimiterStyle): void {
    const rawSelected = editor?.getSelection() ?? '';
    const trimmedSelected = rawSelected.trim();

    let initialFormula: string | undefined;
    let replaceRange: { from: { line: number; ch: number }; to: { line: number; ch: number } } | undefined;
    let expectedRangeText: string | undefined;
    let linePrefix = '';
    let includeFirstLinePrefix = false;
    let detectedDelimiter: DelimiterStyle | undefined;

    if (trimmedSelected) {
      const stripped = stripBlockquoteSelection(rawSelected);
      initialFormula = stripped.clean.trim() || undefined;
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
        // User selected text inside a blockquote line after `> `
        const cursor = editor.getCursor('from');
        const split = extractBlockquotePrefix(editor.getLine(cursor.line));
        if (split.prefix) {
          linePrefix = canonicalBlockquotePrefix(split.prefix);
          includeFirstLinePrefix = false;
        }
      }
    } else if (editor) {
      const cursor = editor.getCursor();
      // Only read up to cursor.line + 400 lines instead of scanning an entire 10,000-line note!
      const limit = Math.min(editor.lineCount(), cursor.line + 401);
      const lines: string[] = [];
      for (let i = 0; i < limit; i += 1) {
        lines.push(editor.getLine(i));
      }
      const detected = detectFormulaInLines(lines, cursor);
      if (detected) {
        initialFormula = detected.raw;
        replaceRange = { from: detected.from, to: detected.to };
        expectedRangeText = editor.getRange(detected.from, detected.to);
        linePrefix = detected.linePrefix;
        includeFirstLinePrefix = detected.includeFirstLinePrefix;
        detectedDelimiter = detected.delimiter;
      } else {
        // Inserting a brand-new formula on a blockquote / callout line
        const split = extractBlockquotePrefix(editor.getLine(cursor.line));
        if (split.prefix && cursor.ch >= split.prefix.length) {
          linePrefix = canonicalBlockquotePrefix(split.prefix);
          includeFirstLinePrefix = false;
        }
      }
    }

    let loadedBase: PersistedStore | null = null;
    const modal = new MathSlotModal(this.app, {
      editor,
      initialFormula,
      replaceRange,
      expectedRangeText,
      linePrefix,
      includeFirstLinePrefix,
      forceDelimiter: forceDelimiter ?? detectedDelimiter,
      loadStore: async () => {
        const data = (await this.loadData()) as Partial<PersistedStore> | null;
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
        };
        loadedBase = normalized;
        return normalized;
      },
      saveStore: async (store: PersistedStore) => {
        const run = this.saveQueue.then(async () => {
          const prev = ((await this.loadData()) as Partial<PersistedStore> | null) ?? {};
          const base = loadedBase;
          const merged: PersistedStore = {
            ...prev,
            ...store,
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
        });
        this.saveQueue = run.catch(() => {});
        await run;
      },
    });
    modal.open();
  }
}

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

export default class MathSlotPlugin extends Plugin {
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
    let linePrefix = '';
    let includeFirstLinePrefix = false;
    let detectedDelimiter: DelimiterStyle | undefined;

    if (trimmedSelected) {
      const stripped = stripBlockquoteSelection(rawSelected);
      initialFormula = stripped.clean.trim() || undefined;
      if (stripped.linePrefix) {
        linePrefix = stripped.linePrefix;
        includeFirstLinePrefix = true;
      } else if (editor) {
        // User selected text inside a blockquote line after `> `
        const cursor = editor.getCursor();
        const split = extractBlockquotePrefix(editor.getLine(cursor.line));
        if (split.prefix) {
          linePrefix = canonicalBlockquotePrefix(split.prefix);
          includeFirstLinePrefix = false;
        }
      }
    } else if (editor) {
      const total = editor.lineCount();
      const lines: string[] = [];
      for (let i = 0; i < total; i += 1) {
        lines.push(editor.getLine(i));
      }
      const cursor = editor.getCursor();
      const detected = detectFormulaInLines(lines, cursor);
      if (detected) {
        initialFormula = detected.raw;
        replaceRange = { from: detected.from, to: detected.to };
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

    const modal = new MathSlotModal(this.app, {
      editor,
      initialFormula,
      replaceRange,
      linePrefix,
      includeFirstLinePrefix,
      forceDelimiter: forceDelimiter ?? detectedDelimiter,
      loadStore: async () => {
        const data = (await this.loadData()) as Partial<PersistedStore> | null;
        return {
          settings: data?.settings ?? {},
          snippets: Array.isArray(data?.snippets) ? data.snippets : [],
          customCommands: Array.isArray(data?.customCommands) ? data.customCommands : [],
          history: Array.isArray(data?.history) ? data.history : [],
          userPresets: Array.isArray(data?.userPresets) ? data.userPresets : [],
          userCommands: Array.isArray(data?.userCommands) ? data.userCommands : [],
        };
      },
      saveStore: async (store: PersistedStore) => {
        await this.saveData(store);
      },
    });
    modal.open();
  }
}

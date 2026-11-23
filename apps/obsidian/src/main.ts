import 'katex/dist/katex.min.css';
import '@mathslot/ui/styles.css';
import './obsidian.css';
import { Plugin, type Editor } from 'obsidian';
import type { PersistedStore } from '@mathslot/ui';
import type { DelimiterStyle } from '@mathslot/core';
import { MathSlotModal } from './MathSlotModal';

export default class MathSlotPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addRibbonIcon('sigma', 'MathSlot 公式编辑器', () => {
      const editor = this.app.workspace.activeEditor?.editor;
      this.openEditor(editor);
    });

    this.addCommand({
      id: 'open-mathslot-editor',
      name: '打开公式编辑器',
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
    const selected = editor?.getSelection()?.trim() ?? '';
    const modal = new MathSlotModal(this.app, {
      editor,
      initialFormula: selected || undefined,
      forceDelimiter,
      loadStore: async () => {
        const data = (await this.loadData()) as Partial<PersistedStore> | null;
        return {
          settings: data?.settings ?? {},
          snippets: Array.isArray(data?.snippets) ? data.snippets : [],
          customCommands: Array.isArray(data?.customCommands) ? data.customCommands : [],
        };
      },
      saveStore: async (store: PersistedStore) => {
        await this.saveData(store);
      },
    });
    modal.open();
  }
}

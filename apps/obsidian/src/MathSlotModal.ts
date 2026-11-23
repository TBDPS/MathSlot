import { Modal, Notice, type App, type Editor } from 'obsidian';
import { mount, unmount } from 'svelte';
import { MathSlotStudio, type HostAdapter, type PersistedStore } from '@mathslot/ui';
import type { DelimiterStyle } from '@mathslot/core';

export interface MathSlotModalOptions {
  editor?: Editor;
  initialFormula?: string;
  forceDelimiter?: DelimiterStyle;
  loadStore: () => Promise<PersistedStore>;
  saveStore: (store: PersistedStore) => Promise<void>;
}

export class MathSlotModal extends Modal {
  private instance: Record<string, unknown> | null = null;
  private readonly opts: MathSlotModalOptions;

  constructor(app: App, opts: MathSlotModalOptions) {
    super(app);
    this.opts = opts;
  }

  onOpen(): void {
    this.modalEl.addClass('mathslot-obsidian-modal');
    this.contentEl.empty();
    this.contentEl.addClass('mathslot-obsidian-content');

    const host: HostAdapter = {
      primaryActionLabel: this.opts.editor ? '插入笔记' : '复制',
      initialFormula: this.opts.initialFormula,
      hostDarkMode: () => document.body.classList.contains('theme-dark'),
      copyText: async (text: string) => {
        await navigator.clipboard.writeText(text);
      },
      readText: async () => navigator.clipboard.readText(),
      onPrimarySubmit: async (formattedLatex: string) => {
        if (this.opts.editor) {
          this.opts.editor.replaceSelection(formattedLatex);
          new Notice('已插入公式');
          this.close();
          return;
        }
        await navigator.clipboard.writeText(formattedLatex);
        new Notice('已复制公式');
        this.close();
      },
      loadStore: async () => {
        const stored = await this.opts.loadStore();
        if (this.opts.forceDelimiter) {
          return {
            ...stored,
            settings: {
              ...stored.settings,
              delimiter: this.opts.forceDelimiter,
            },
          };
        }
        return stored;
      },
      saveStore: this.opts.saveStore,
    };

    this.instance = mount(MathSlotStudio, {
      target: this.contentEl,
      props: { host },
    });
  }

  onClose(): void {
    if (this.instance) {
      void unmount(this.instance);
      this.instance = null;
    }
    this.contentEl.empty();
  }
}

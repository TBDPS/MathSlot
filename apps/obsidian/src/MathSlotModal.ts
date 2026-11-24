import { Modal, Notice, type App, type Editor, type EditorPosition } from 'obsidian';
import { mount, unmount } from 'svelte';
import { MathSlotStudio, type HostAdapter, type PersistedStore } from '@mathslot/ui';
import { formatFormulaForEditorInsertion, type DelimiterStyle } from '@mathslot/core';

export interface MathSlotModalOptions {
  editor?: Editor;
  initialFormula?: string;
  replaceRange?: { from: EditorPosition; to: EditorPosition };
  /** Snapshot of the text at `replaceRange` when the modal opened; prevents overwriting drifted prose. */
  expectedRangeText?: string;
  linePrefix?: string;
  includeFirstLinePrefix?: boolean;
  forceDelimiter?: DelimiterStyle;
  loadStore: () => Promise<PersistedStore>;
  saveStore: (store: PersistedStore) => Promise<void>;
}

async function copyTextWithFallback(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fallback below when webview lacks focus or mobile restricts navigator.clipboard
    }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
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
      primaryActionLabel: this.opts.replaceRange
        ? '更新公式'
        : this.opts.editor
          ? '插入笔记'
          : '复制',
      compactToolbar: true,
      initialFormula: this.opts.initialFormula,
      hostDarkMode: () => document.body.classList.contains('theme-dark'),
      copyText: copyTextWithFallback,
      readText: async () => {
        try {
          return (await navigator.clipboard?.readText?.()) ?? '';
        } catch {
          return '';
        }
      },
      onPrimarySubmit: async (formattedLatex: string) => {
        if (this.opts.editor) {
          const output = formatFormulaForEditorInsertion(
            formattedLatex,
            this.opts.linePrefix ?? '',
            Boolean(this.opts.includeFirstLinePrefix),
          );
          if (this.opts.replaceRange) {
            const { from, to } = this.opts.replaceRange;
            if (
              this.opts.expectedRangeText !== undefined &&
              this.opts.editor.getRange(from, to) !== this.opts.expectedRangeText
            ) {
              await copyTextWithFallback(output);
              new Notice('原文在编辑期间已变更，为防止覆盖正文已将公式复制到剪贴板');
              this.close();
              return;
            }
            this.opts.editor.replaceRange(output, from, to);
            new Notice('已更新公式');
          } else {
            this.opts.editor.replaceSelection(output);
            new Notice('已插入公式');
          }
          this.close();
          return;
        }
        await copyTextWithFallback(formattedLatex);
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

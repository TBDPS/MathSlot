import { Modal, Notice, type App, type Editor, type EditorPosition } from 'obsidian';
import { mount, unmount } from 'svelte';
import { MathSlotStudio, type HostAdapter, type PersistedStore } from '@mathslot/ui';
import { formatFormulaForEditorInsertion, type DelimiterStyle, type MathWrapperKind } from '@mathslot/core';

export interface MathSlotModalOptions {
  editor?: Editor;
  initialFormula?: string;
  replaceRange?: { from: EditorPosition; to: EditorPosition };
  /** Snapshot of the text at `replaceRange` when the modal opened; prevents overwriting drifted prose. */
  expectedRangeText?: string;
  linePrefix?: string;
  includeFirstLinePrefix?: boolean;
  forceDelimiter?: DelimiterStyle;
  initialWrapper?: MathWrapperKind;
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
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) {
    throw new Error('Clipboard copy failed');
  }
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
      initialDelimiter: this.opts.forceDelimiter,
      initialWrapper: this.opts.initialWrapper,
      hostDarkMode: () => document.body.classList.contains('theme-dark'),
      subscribeDarkMode: (listener) => {
        if (typeof MutationObserver === 'undefined') return () => {};
        const obs = new MutationObserver(() => {
          listener(document.body.classList.contains('theme-dark'));
        });
        obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
      },
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
              try {
                await copyTextWithFallback(output);
                new Notice(
                  '原文在编辑期间已变更，已将公式复制到剪贴板；弹窗保持打开以防丢失编辑',
                  5000,
                );
                return '原文已变更，已复制公式到剪贴板（弹窗已保留）';
              } catch {
                new Notice(
                  '原文在编辑期间已变更且剪贴板写入失败，请从底部源码栏手动复制',
                  5000,
                );
                return '原文已变更，请从底部源码栏复制公式';
              }
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
      loadStore: () => this.opts.loadStore(),
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

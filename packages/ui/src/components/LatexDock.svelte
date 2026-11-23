<script lang="ts">
  import type { DelimiterStyle } from '@mathslot/core';

  interface Props {
    latex: string;
    delimiter: DelimiterStyle;
    onApplyRawLatex: (raw: string) => void;
    onCycleDelimiter: () => void;
    onSaveSnippet: () => void;
    onCopy: () => void;
    onCopyMathML?: () => void;
    onCopyPng?: () => void;
  }

  let {
    latex,
    delimiter,
    onApplyRawLatex,
    onCycleDelimiter,
    onSaveSnippet,
    onCopy,
    onCopyMathML,
    onCopyPng,
  }: Props = $props();

  let draft = $state('');
  let editing = $state(false);
  let expanded = $state(false);
  let canExpand = $state(false);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);

  const displayedValue = $derived(editing ? draft : latex);

  $effect(() => {
    if (!editing) {
      draft = latex;
    }
  });

  function syncHeight(): void {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    const maxHeight = expanded ? 220 : 104;
    const needed = textareaEl.scrollHeight;
    canExpand = needed > 104 || displayedValue.includes('\n');
    const clamped = Math.max(24, Math.min(needed, maxHeight));
    textareaEl.style.height = `${clamped}px`;
    textareaEl.style.overflowY = needed > maxHeight ? 'auto' : 'hidden';
  }

  $effect(() => {
    // Track dependencies: displayedValue & expanded & textareaEl
    void displayedValue;
    void expanded;
    void textareaEl;
    if (textareaEl) {
      syncHeight();
    }
  });

  const delimiterLabel = $derived.by(() => {
    switch (delimiter) {
      case 'inline':
        return '$…$';
      case 'block':
        return '$$…$$';
      case 'codeblock':
        return '```';
      case 'none':
        return 'TeX';
    }
  });

  function commit(): void {
    editing = false;
    if (draft !== latex) {
      onApplyRawLatex(draft);
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
      (e.currentTarget as HTMLTextAreaElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      draft = latex;
      editing = false;
      (e.currentTarget as HTMLTextAreaElement).blur();
    }
  }
</script>

<svelte:window onresize={syncHeight} />

<div class="latex-dock" class:expanded>
  <textarea
    bind:this={textareaEl}
    class="latex-input"
    rows="1"
    spellcheck="false"
    value={displayedValue}
    placeholder="LaTeX（Enter 应用，Shift+Enter 换行）"
    aria-label="LaTeX 源码"
    onfocus={() => {
      editing = true;
      draft = latex;
    }}
    oninput={(e) => {
      draft = (e.currentTarget as HTMLTextAreaElement).value;
      syncHeight();
    }}
    onblur={commit}
    onkeydown={handleKeyDown}
  ></textarea>

  <div class="dock-actions">
    {#if canExpand}
      <button
        type="button"
        class="dock-icon-btn"
        title={expanded ? '收起公式源码栏' : '展开公式源码栏'}
        aria-label={expanded ? '收起公式源码栏' : '展开公式源码栏'}
        onclick={() => (expanded = !expanded)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          {#if expanded}
            <path d="m6 9 6 6 6-6" />
          {:else}
            <path d="m18 15-6-6-6 6" />
          {/if}
        </svg>
      </button>
    {/if}

    <button
      type="button"
      class="dock-chip"
      title="切换输出定界符"
      onclick={onCycleDelimiter}
    >
      {delimiterLabel}
    </button>

    {#if onCopyMathML}
      <button
        type="button"
        class="dock-chip"
        title="复制 Word / LibreOffice 原生公式 (MathML)"
        onclick={onCopyMathML}
        disabled={!latex.trim()}
      >
        Word
      </button>
    {/if}

    {#if onCopyPng}
      <button
        type="button"
        class="dock-chip"
        title="复制高清透明 PNG 图片 (PPT / 微信 / 文档)"
        onclick={onCopyPng}
        disabled={!latex.trim()}
      >
        PNG
      </button>
    {/if}

    <button
      type="button"
      class="dock-icon-btn"
      title="存为片段"
      aria-label="存为片段"
      onclick={onSaveSnippet}
      disabled={!latex.trim()}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>

    <button
      type="button"
      class="dock-icon-btn"
      title="复制 LaTeX"
      aria-label="复制 LaTeX"
      onclick={onCopy}
      disabled={!latex.trim()}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    </button>
  </div>
</div>

<style>
  .latex-dock {
    min-height: 44px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 14px;
    border-top: 1px solid var(--ms-border);
    background: var(--ms-chrome);
    flex-shrink: 0;
  }

  .latex-input {
    flex: 1;
    min-width: 0;
    min-height: 24px;
    max-height: 104px;
    padding: 3px 0 2px;
    margin: 0;
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    color: var(--ms-fg-muted);
    font-family: var(--ms-font-mono);
    font-size: 12.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    box-sizing: border-box;
  }

  .latex-dock.expanded .latex-input {
    max-height: 220px;
  }

  .latex-input:focus {
    color: var(--ms-fg);
  }

  .latex-input::placeholder {
    color: var(--ms-fg-faint);
  }

  .dock-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding-top: 0;
  }

  .dock-chip {
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--ms-border);
    border-radius: 6px;
    background: var(--ms-bg);
    color: var(--ms-fg-muted);
    font-family: var(--ms-font-mono);
    font-size: 11px;
    cursor: pointer;
  }

  .dock-chip:hover:not(:disabled) {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
  }

  .dock-chip:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .dock-icon-btn {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ms-fg-muted);
    cursor: pointer;
  }

  .dock-icon-btn:hover:not(:disabled) {
    background: var(--ms-surface-muted);
    color: var(--ms-fg);
  }

  .dock-icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>

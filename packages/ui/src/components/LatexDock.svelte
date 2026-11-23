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

  $effect(() => {
    if (!editing) {
      draft = latex;
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
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      (e.currentTarget as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      draft = latex;
      editing = false;
      (e.currentTarget as HTMLInputElement).blur();
    }
  }
</script>

<div class="latex-dock">
  <input
    class="latex-input"
    type="text"
    value={editing ? draft : latex}
    placeholder="LaTeX"
    aria-label="LaTeX 源码"
    onfocus={() => {
      editing = true;
      draft = latex;
    }}
    oninput={(e) => {
      draft = (e.currentTarget as HTMLInputElement).value;
    }}
    onblur={commit}
    onkeydown={handleKeyDown}
  />

  <div class="dock-actions">
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
    height: 44px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    border-top: 1px solid var(--ms-border);
    background: var(--ms-chrome);
  }

  .latex-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--ms-fg-muted);
    font-family: var(--ms-font-mono);
    font-size: 12.5px;
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

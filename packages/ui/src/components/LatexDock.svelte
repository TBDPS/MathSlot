<script lang="ts">
  import type { DelimiterStyle } from '@mathslot/core';

  interface Props {
    latex: string;
    delimiter: DelimiterStyle;
    hasRawNodes?: boolean;
    onApplyRawLatex: (raw: string) => boolean;
    onCycleDelimiter: () => void;
    onSaveSnippet: () => void;
    onCopy: () => void;
    onCopyMathML?: () => void;
    onCopyPng?: () => void;
    onCopySvg?: () => void;
    onOpenExport?: () => void;
  }

  let {
    latex,
    delimiter,
    hasRawNodes = false,
    onApplyRawLatex,
    onCycleDelimiter,
    onSaveSnippet,
    onCopy,
    onCopyMathML,
    onCopyPng,
    onCopySvg,
    onOpenExport,
  }: Props = $props();

  let draft = $state('');
  let editing = $state(false);
  let hasError = $state(false);
  let isComposing = $state(false);
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

  function commit(): boolean {
    if (draft === latex) {
      editing = false;
      hasError = false;
      return true;
    }
    const ok = onApplyRawLatex(draft);
    if (!ok) {
      // Preserve draft & stay in editing mode so user can fix the syntax error instead of losing work!
      editing = true;
      hasError = true;
      return false;
    }
    editing = false;
    hasError = false;
    return true;
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (isComposing || e.isComposing || e.key === 'Process' || e.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (commit()) {
        (e.currentTarget as HTMLTextAreaElement).blur();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      draft = latex;
      editing = false;
      hasError = false;
      (e.currentTarget as HTMLTextAreaElement).blur();
    }
  }
</script>

<svelte:window onresize={syncHeight} />

<div class="latex-dock" class:expanded class:has-error={hasError}>
  <textarea
    bind:this={textareaEl}
    class="latex-input"
    rows="1"
    spellcheck="false"
    value={displayedValue}
    placeholder="LaTeX（Enter 应用，Shift+Enter 换行，Esc 还原）"
    aria-label="LaTeX 源码"
    onfocus={() => {
      if (!editing) {
        editing = true;
        draft = latex;
      }
    }}
    oncompositionstart={() => {
      isComposing = true;
    }}
    oncompositionend={(e) => {
      isComposing = false;
      draft = (e.currentTarget as HTMLTextAreaElement).value;
      hasError = false;
      syncHeight();
    }}
    oninput={(e) => {
      draft = (e.currentTarget as HTMLTextAreaElement).value;
      hasError = false;
      syncHeight();
    }}
    onblur={() => {
      void commit();
    }}
    onkeydown={handleKeyDown}
  ></textarea>

  <div class="dock-actions">
    {#if hasRawNodes}
      <span
        class="raw-badge"
        title="公式含以原生 LaTeX 保留的片段，点击左侧源码栏可直接编辑完整源码"
      >
        原生项
      </span>
    {/if}
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

    {#if onCopySvg}
      <button
        type="button"
        class="dock-chip"
        title="复制纯矢量 SVG 代码 (Figma / Inkscape / 网页)"
        onclick={onCopySvg}
        disabled={!latex.trim()}
      >
        SVG
      </button>
    {/if}

    {#if onOpenExport}
      <button
        type="button"
        class="dock-chip"
        title="打开导出与保存选项（PNG / SVG / TeX / MathML）"
        onclick={onOpenExport}
        disabled={!latex.trim()}
      >
        导出
      </button>
    {/if}

    <span class="dock-divider" aria-hidden="true"></span>

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
    min-height: 46px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 14px;
    border-top: 1px solid var(--ms-border-subtle);
    background: var(--ms-chrome);
    flex-shrink: 0;
  }

  .latex-input {
    flex: 1;
    min-width: 0;
    min-height: 28px;
    max-height: 104px;
    padding: 4px 10px;
    margin: 0;
    border: 1px solid var(--ms-border-subtle);
    border-radius: 8px;
    outline: none;
    resize: none;
    background: var(--ms-bg);
    color: var(--ms-fg-muted);
    font-family: var(--ms-font-mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    box-sizing: border-box;
    transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
  }

  .latex-dock.expanded .latex-input {
    max-height: 220px;
  }

  .latex-input:focus {
    color: var(--ms-fg);
    border-color: var(--ms-accent);
    background: var(--ms-surface);
  }

  .latex-input::placeholder {
    color: var(--ms-fg-faint);
  }

  .dock-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding-top: 1px;
  }

  .dock-divider {
    width: 1px;
    height: 16px;
    background: var(--ms-border);
    margin: 0 2px;
    flex-shrink: 0;
  }

  .raw-badge {
    height: 22px;
    padding: 0 7px;
    border-radius: 999px;
    border: 1px solid var(--ms-jump-border);
    background: var(--ms-jump-bg);
    color: var(--ms-jump-fg);
    font-size: 10.5px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    user-select: none;
    flex-shrink: 0;
  }

  .dock-chip {
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--ms-border);
    border-radius: 6px;
    background: var(--ms-surface);
    color: var(--ms-fg-muted);
    font-family: var(--ms-font-mono);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 1px 1px rgba(15, 23, 42, 0.03);
    transition: border-color 110ms ease, color 110ms ease, background-color 110ms ease, transform 110ms var(--ms-ease-out);
  }

  .dock-chip:hover:not(:disabled) {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
    background: var(--ms-accent-soft);
  }

  .dock-chip:active:not(:disabled) {
    transform: scale(0.96);
  }

  .dock-chip:disabled {
    opacity: 0.35;
    cursor: default;
    box-shadow: none;
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
    transition: background-color 100ms ease, color 100ms ease, transform 110ms var(--ms-ease-out);
  }

  .dock-icon-btn:hover:not(:disabled) {
    background: var(--ms-surface-muted);
    color: var(--ms-fg);
  }

  .dock-icon-btn:active:not(:disabled) {
    transform: scale(0.93);
  }

  .dock-icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .latex-dock.has-error .latex-input {
    border-color: var(--ms-danger);
    box-shadow: 0 0 0 2px var(--ms-danger-soft);
  }

  @media (max-width: 520px) {
    .latex-dock {
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 10px;
    }
    .latex-input {
      flex: 1 1 100%;
    }
    .dock-actions {
      width: 100%;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
  }
</style>

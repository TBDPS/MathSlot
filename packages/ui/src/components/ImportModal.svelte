<script lang="ts">
  import { onMount } from 'svelte';
  import { importFormula, toLatex } from '@mathslot/core';
  import { renderLatexPreview } from '../katexRenderer';

  interface Props {
    onReadClipboard?: () => Promise<string>;
    onImport: (source: string) => boolean;
    onClose: () => void;
  }

  let { onReadClipboard, onImport, onClose }: Props = $props();

  let raw = $state('');
  let submitError = $state<string | null>(null);
  let textareaEl: HTMLTextAreaElement | null = $state(null);

  const parsed = $derived.by(() => {
    if (!raw.trim()) return null;
    const res = importFormula(raw);
    return {
      res,
      latex: toLatex(res.doc),
      errors: res.diagnostics.filter((d) => d.severity === 'error'),
      warnings: res.diagnostics.filter((d) => d.severity === 'warning'),
    };
  });

  onMount(() => {
    textareaEl?.focus();
  });

  async function pasteFromClipboard(): Promise<void> {
    try {
      const text = onReadClipboard
        ? await onReadClipboard()
        : await navigator.clipboard.readText();
      if (text) {
        raw = text;
        submitError = null;
        textareaEl?.focus();
      }
    } catch {
      // Ignore clipboard permission denial
    }
  }

  function submit(): void {
    if (!raw.trim()) return;
    if (parsed && parsed.errors.length > 0) {
      submitError = parsed.errors[0].message;
      textareaEl?.focus();
      return;
    }
    const ok = onImport(raw);
    if (!ok) {
      submitError = parsed?.errors[0]?.message ?? '导入失败，请修正 LaTeX 语法后重试';
      textareaEl?.focus();
      return;
    }
    submitError = null;
    onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label="导入 LaTeX">
    <div class="modal-head">
      <span>导入 LaTeX</span>
      <div class="head-actions">
        <button type="button" class="paste-btn" onclick={() => void pasteFromClipboard()}>
          从剪贴板粘贴
        </button>
        <button type="button" class="close-btn" onclick={onClose} aria-label="关闭">✕</button>
      </div>
    </div>

    <textarea
      bind:this={textareaEl}
      bind:value={raw}
      class="source-area"
      rows="4"
      placeholder={'\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}'}
      oninput={() => {
        submitError = null;
      }}
      onkeydown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      }}
    ></textarea>

    {#if parsed}
      <div class="preview-box">
        {@html renderLatexPreview(parsed.latex, true)}
      </div>
      {#if parsed.errors.length > 0}
        <div class="diag-line is-error">语法错误：{parsed.errors[0].message}（已保留草稿，请修正后再导入）</div>
      {:else if submitError}
        <div class="diag-line is-error">{submitError}</div>
      {:else if parsed.warnings.length > 0}
        <div class="diag-line is-warn">提示：{parsed.warnings[0].message}</div>
      {:else if parsed.res.hasRawNodes}
        <div class="diag-line is-warn">提示：包含原生 LaTeX 保留片段，导入后可在底部源码栏直接编辑</div>
      {/if}
    {/if}

    <div class="modal-foot">
      <button type="button" class="btn-ghost" onclick={onClose}>取消</button>
      <button
        type="button"
        class="btn-primary"
        disabled={!raw.trim() || (parsed?.errors.length ?? 0) > 0}
        onclick={submit}
      >
        导入
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.34);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }

  .modal {
    width: min(520px, calc(100vw - 32px));
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-lg);
    box-shadow: var(--ms-shadow-lg), var(--ms-inset-specular);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 14px;
    font-weight: 600;
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .paste-btn {
    height: 26px;
    padding: 0 9px;
    border: 1px solid var(--ms-border);
    border-radius: 6px;
    background: var(--ms-tile);
    color: var(--ms-fg-muted);
    font-size: 12px;
    cursor: pointer;
  }

  .paste-btn:hover {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
  }

  .close-btn {
    border: none;
    background: transparent;
    color: var(--ms-fg-muted);
    width: 26px;
    height: 26px;
    border-radius: 6px;
    cursor: pointer;
  }

  .close-btn:hover {
    background: var(--ms-surface-muted);
  }

  .source-area {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    padding: 10px 12px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-family: var(--ms-font-mono);
    font-size: 13px;
    outline: none;
  }

  .source-area:focus {
    border-color: var(--ms-accent);
  }

  .preview-box {
    padding: 16px 12px;
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    border: 1px solid var(--ms-border-subtle);
    text-align: center;
    overflow-x: auto;
    font-size: 1.25rem;
  }

  .diag-line {
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 6px;
  }

  .diag-line.is-error {
    background: var(--ms-danger-soft);
    color: var(--ms-danger);
  }

  .diag-line.is-warn {
    background: var(--ms-jump-bg);
    color: var(--ms-jump-fg);
  }

  .modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-ghost {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: transparent;
    color: var(--ms-fg-muted);
    font-size: 13px;
    cursor: pointer;
  }

  .btn-primary {
    height: 32px;
    padding: 0 14px;
    border: none;
    border-radius: var(--ms-radius-sm);
    background: var(--ms-accent);
    color: var(--ms-accent-fg);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-primary:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>

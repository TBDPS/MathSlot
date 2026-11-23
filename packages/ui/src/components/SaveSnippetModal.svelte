<script lang="ts">
  import { onMount } from 'svelte';
  import { renderLatexPreview } from '../katexRenderer';

  import type { LeaderKey } from '@mathslot/core';

  interface Props {
    latex: string;
    defaultName: string;
    leaderKey?: LeaderKey;
    usedKeys?: string[];
    onSave: (name: string, key?: string) => void;
    onClose: () => void;
  }

  let { latex, defaultName, leaderKey = 'Tab', usedKeys = [], onSave, onClose }: Props = $props();

  let name = $state('');
  let key = $state('');
  let inputEl: HTMLInputElement | null = $state(null);

  const keyConflict = $derived(key.trim().length === 1 && usedKeys.includes(key.trim()));

  onMount(() => {
    name = defaultName;
    if (inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  });

  function submit(): void {
    const clean = name.trim();
    if (!clean || keyConflict) return;
    const cleanKey = key.trim().slice(0, 1);
    onSave(clean, cleanKey || undefined);
    onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label="保存为片段">
    <div class="modal-head">
      <span>保存为片段</span>
      <button type="button" class="close-btn" onclick={onClose} aria-label="关闭">✕</button>
    </div>

    <div class="preview-box">
      {@html renderLatexPreview(latex, true)}
    </div>

    <label class="field">
      <span>片段名称</span>
      <input
        bind:this={inputEl}
        bind:value={name}
        type="text"
        placeholder="例如：高斯核、欧拉公式…"
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
    </label>

    <label class="field">
      <span>快捷键（{leaderKey} t + 键，可选）</span>
      <input
        bind:value={key}
        type="text"
        maxlength="1"
        placeholder="例如 a，保存后可按 Tab t a 直接插入"
      />
      {#if keyConflict}
        <span class="warn-text">快捷键 {leaderKey} t {key.trim()} 已被其他片段占用</span>
      {/if}
    </label>

    <div class="modal-foot">
      <button type="button" class="btn-ghost" onclick={onClose}>取消</button>
      <button type="button" class="btn-primary" disabled={!name.trim() || keyConflict} onclick={submit}>
        保存
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.36);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }

  .modal {
    width: min(420px, calc(100vw - 32px));
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-lg);
    box-shadow: var(--ms-shadow-lg);
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

  .preview-box {
    padding: 14px 12px;
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    border: 1px solid var(--ms-border-subtle);
    text-align: center;
    overflow-x: auto;
    font-size: 1.2rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12.5px;
    color: var(--ms-fg-muted);
  }

  .field input {
    height: 36px;
    padding: 0 11px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-size: 13.5px;
    outline: none;
  }

  .field input:focus {
    border-color: var(--ms-accent);
  }

  .warn-text {
    font-size: 11.5px;
    color: var(--ms-danger);
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

<script lang="ts">
  import { onMount } from 'svelte';
  import {
    CATEGORY_LABELS,
    commandPreviewLatex,
    type CommandCategory,
    type CommandDef,
    type LeaderKey,
    type UserCommandEntry,
  } from '@mathslot/core';
  import { renderLatexPreview } from '../katexRenderer';

  interface Props {
    leaderKey: LeaderKey;
    editing?: CommandDef | null;
    onSave: (entry: UserCommandEntry) => void;
    onClose: () => void;
  }

  let { leaderKey, editing = null, onSave, onClose }: Props = $props();

  let label = $state('');
  let category = $state<CommandCategory>('symbol');
  let latex = $state('');
  let keysText = $state('');
  let slotNamesText = $state('');
  let labelInputEl: HTMLInputElement | null = $state(null);

  const detectedSlotCount = $derived.by(() => {
    let maxIdx = 0;
    for (const m of latex.matchAll(/\$(\d+)/g)) {
      const n = Number(m[1]);
      if (n > maxIdx && n <= 9) maxIdx = n;
    }
    return maxIdx;
  });

  const resolvedSlots = $derived.by(() => {
    if (detectedSlotCount === 0) return [];
    const customNames = slotNamesText
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from({ length: detectedSlotCount }, (_, i) => customNames[i] ?? `槽位 ${i + 1}`);
  });

  onMount(() => {
    if (editing) {
      label = editing.label;
      category = editing.category;
      latex = editing.latex;
      keysText = editing.keys.join('');
      slotNamesText = editing.slots.join(', ');
    }
    labelInputEl?.focus();
  });

  function submit(): void {
    const cleanLabel = label.trim();
    const cleanLatex = latex.trim();
    if (!cleanLabel || !cleanLatex) return;
    const keys = keysText
      .replace(/\s+/g, '')
      .slice(0, 2)
      .split('')
      .filter(Boolean);

    onSave({
      id: editing?.id ?? `user-cmd-${Date.now()}`,
      label: cleanLabel,
      category,
      latex: cleanLatex,
      keys,
      slots: resolvedSlots,
      glyph: editing?.glyph ?? cleanLabel.slice(0, 4),
    });
    onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={editing ? '编辑命令' : '添加命令'}>
    <div class="modal-head">
      <span>{editing ? '编辑命令库条目' : '添加到命令库'}</span>
      <button type="button" class="close-btn" onclick={onClose} aria-label="关闭">✕</button>
    </div>

    <div class="two-col">
      <label class="field">
        <span>命令名称</span>
        <input
          bind:this={labelInputEl}
          bind:value={label}
          type="text"
          placeholder="例如：变体 pi、拉普拉斯算子"
        />
      </label>

      <label class="field">
        <span>所属分类</span>
        <select bind:value={category}>
          {#each Object.entries(CATEGORY_LABELS) as [cat, catLabel] (cat)}
            <option value={cat}>{catLabel}</option>
          {/each}
        </select>
      </label>
    </div>

    <label class="field">
      <span>LaTeX 模板（含槽位时用 $1、$2 占位）</span>
      <input
        bind:value={latex}
        class="mono"
        type="text"
        placeholder={'\\varpi 或 \\mathcal{L}\\left\\{$1\\right\\}'}
      />
    </label>

    {#if latex.trim()}
      <div class="preview-box">
        {@html renderLatexPreview(commandPreviewLatex(latex), true)}
      </div>
    {/if}

    <div class="two-col">
      <label class="field">
        <span>快捷键（{leaderKey} 后接 1-2 个字母）</span>
        <input
          bind:value={keysText}
          class="mono"
          type="text"
          maxlength="3"
          placeholder="例如 gw（表示 Tab g w）"
        />
      </label>

      {#if detectedSlotCount > 0}
        <label class="field">
          <span>槽位名（逗号分隔，共 {detectedSlotCount} 槽）</span>
          <input
            bind:value={slotNamesText}
            type="text"
            placeholder={resolvedSlots.join(', ')}
          />
        </label>
      {/if}
    </div>

    <div class="modal-foot">
      <button type="button" class="btn-ghost" onclick={onClose}>取消</button>
      <button
        type="button"
        class="btn-primary"
        disabled={!label.trim() || !latex.trim()}
        onclick={submit}
      >
        保存到 commands.json
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.36);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }

  .modal {
    width: min(490px, calc(100vw - 32px));
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-lg);
    box-shadow: var(--ms-shadow-lg);
    padding: 16px 18px;
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

  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
    color: var(--ms-fg-muted);
  }

  .field input,
  .field select {
    height: 35px;
    padding: 0 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
    width: 100%;
  }

  .field .mono {
    font-family: var(--ms-font-mono);
  }

  .field input:focus,
  .field select:focus {
    border-color: var(--ms-accent);
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

<script lang="ts">
  import { onMount } from 'svelte';
  import type { PresetFormula, UserPresetEntry } from '@mathslot/core';
  import { renderLatexPreview } from '../katexRenderer';

  interface Props {
    editing?: PresetFormula | null;
    categories: string[];
    currentCanvasLatex?: string;
    onSave: (entry: UserPresetEntry) => void;
    onClose: () => void;
  }

  let {
    editing = null,
    categories,
    currentCanvasLatex = '',
    onSave,
    onClose,
  }: Props = $props();

  let name = $state('');
  let category = $state('');
  let source = $state('');
  let desc = $state('');
  let nameInputEl: HTMLInputElement | null = $state(null);

  onMount(() => {
    if (editing) {
      name = editing.name;
      category = editing.category;
      source = editing.source;
      desc = editing.desc ?? '';
    } else {
      category = categories[0] ?? '自定义公式';
      if (currentCanvasLatex.trim()) {
        source = currentCanvasLatex.trim();
      }
    }
    nameInputEl?.focus();
  });

  function submit(): void {
    const cleanName = name.trim();
    const cleanSource = source.trim();
    const cleanCat = category.trim() || '自定义公式';
    if (!cleanName || !cleanSource) return;
    onSave({
      id: editing?.id ?? `user-preset-${Date.now()}`,
      name: cleanName,
      category: cleanCat,
      source: cleanSource,
      desc: desc.trim(),
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
  <div class="modal" role="dialog" aria-modal="true" aria-label={editing ? '编辑公式' : '添加公式'}>
    <div class="modal-head">
      <span>{editing ? '编辑公式库条目' : '添加到公式库'}</span>
      <button type="button" class="close-btn" onclick={onClose} aria-label="关闭">✕</button>
    </div>

    <div class="two-col">
      <label class="field">
        <span>公式名称</span>
        <input
          bind:this={nameInputEl}
          bind:value={name}
          type="text"
          placeholder="例如：傅里叶级数"
        />
      </label>

      <label class="field">
        <span>分类（可输入新分类）</span>
        <input
          bind:value={category}
          type="text"
          list="ms-preset-cats"
          placeholder="例如：微积分、考研高数"
        />
        <datalist id="ms-preset-cats">
          {#each categories as cat (cat)}
            <option value={cat}></option>
          {/each}
        </datalist>
      </label>
    </div>

    <label class="field">
      <div class="field-head">
        <span>LaTeX 公式</span>
        {#if currentCanvasLatex.trim()}
          <button
            type="button"
            class="mini-btn"
            onclick={() => (source = currentCanvasLatex.trim())}
          >
            填入当前画布公式
          </button>
        {/if}
      </div>
      <textarea
        bind:value={source}
        class="mono"
        rows="3"
        placeholder={'\\int_{-l}^{l} f(x)\\,\\mathrm{d}x'}
      ></textarea>
    </label>

    {#if source.trim()}
      <div class="preview-box">
        {@html renderLatexPreview(source, true)}
      </div>
    {/if}

    <div class="modal-foot">
      <button type="button" class="btn-ghost" onclick={onClose}>取消</button>
      <button
        type="button"
        class="btn-primary"
        disabled={!name.trim() || !source.trim()}
        onclick={submit}
      >
        保存到 presets.json
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
    width: min(500px, calc(100vw - 32px));
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

  .field-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .mini-btn {
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--ms-border);
    border-radius: 5px;
    background: var(--ms-tile);
    color: var(--ms-fg-muted);
    font-size: 11px;
    cursor: pointer;
  }

  .mini-btn:hover {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
  }

  .field input,
  .field textarea {
    padding: 8px 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
    width: 100%;
  }

  .field textarea {
    resize: vertical;
  }

  .field .mono {
    font-family: var(--ms-font-mono);
  }

  .field input:focus,
  .field textarea:focus {
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

<script lang="ts">
  import { onMount } from 'svelte';
  import {
    commandPreviewLatex,
    detectShorthandConflicts,
    type CustomCommandDef,
    type LeaderKey,
  } from '@mathslot/core';
  import { renderLatexPreview } from '../katexRenderer';
  import { focusTrap } from '../focusTrap';

  interface Props {
    leaderKey: LeaderKey;
    editing?: CustomCommandDef | null;
    existingCommands?: CustomCommandDef[];
    onSave: (cmd: CustomCommandDef) => void;
    onClose: () => void;
  }

  let { leaderKey, editing = null, existingCommands = [], onSave, onClose }: Props = $props();

  let label = $state('');
  let latex = $state('');
  let key = $state('');
  let shorthand = $state('');
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

  const keyConflict = $derived.by(() => {
    const cleanKey = key.trim().slice(0, 1);
    if (!cleanKey) return null;
    return (
      existingCommands.find((c) => c.key === cleanKey && c.id !== editing?.id) ?? null
    );
  });

  const shorthandConflict = $derived.by(() => {
    const cleanShort = shorthand.trim();
    if (!cleanShort) return null;
    const probeId = editing?.id ?? '__draft__';
    const others = existingCommands.filter((c) => c.id !== editing?.id);
    const list = detectShorthandConflicts(
      [...others, { id: probeId, label: label.trim() || '当前结构', latex: latex.trim(), slots: [], shorthand: cleanShort }],
      [],
    );
    return list.find((c) => c.sourceId === probeId) ?? null;
  });

  onMount(() => {
    if (editing) {
      label = editing.label;
      latex = editing.latex;
      key = editing.key ?? '';
      shorthand = editing.shorthand ?? '';
      slotNamesText = editing.slots.join(', ');
    }
    labelInputEl?.focus();
  });

  function submit(): void {
    const cleanLabel = label.trim();
    const cleanLatex = latex.trim();
    if (!cleanLabel || !cleanLatex || keyConflict) return;
    const cleanKey = key.trim().slice(0, 1);
    const cleanShort = shorthand.trim();
    onSave({
      id: editing?.id ?? `custom-${Date.now()}`,
      label: cleanLabel,
      latex: cleanLatex,
      slots: resolvedSlots,
      ...(cleanKey ? { key: cleanKey } : {}),
      ...(cleanShort ? { shorthand: cleanShort } : {}),
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
  <div class="modal" role="dialog" aria-modal="true" aria-label="自定义结构" use:focusTrap>
    <div class="modal-head">
      <span>{editing ? '编辑自定义结构' : '新建自定义结构'}</span>
      <button type="button" class="close-btn" onclick={onClose} aria-label="关闭">✕</button>
    </div>

    <label class="field">
      <span>名称</span>
      <input
        bind:this={labelInputEl}
        bind:value={label}
        type="text"
        placeholder="例如：数学期望、正态分布、二阶偏导"
      />
    </label>

    <label class="field">
      <span>LaTeX 模板（用 $1、$2 标记可编辑槽位）</span>
      <input
        bind:value={latex}
        class="mono"
        type="text"
        placeholder={'\\mathbb{E}\\left[$1\\right]'}
      />
    </label>

    {#if latex.trim()}
      <div class="preview-box">
        {@html renderLatexPreview(commandPreviewLatex(latex), true)}
      </div>
    {/if}

    {#if detectedSlotCount > 0}
      <label class="field">
        <span>槽位名称（逗号分隔，已识别 {detectedSlotCount} 个槽位）</span>
        <input
          bind:value={slotNamesText}
          type="text"
          placeholder={resolvedSlots.join(', ')}
        />
      </label>
    {/if}

    <div class="two-col">
      <label class="field">
        <span>快捷键（{leaderKey} k + 键）</span>
        <input
          bind:value={key}
          class="mono"
          type="text"
          maxlength="1"
          placeholder="可选单键，如 e"
        />
        {#if keyConflict}
          <span class="warn-text">与「{keyConflict.label}」冲突</span>
        {/if}
      </label>

      <label class="field">
        <span>自动简写</span>
        <input
          bind:value={shorthand}
          class="mono"
          type="text"
          placeholder="可选，如 EE"
        />
        {#if shorthandConflict}
          <span class="warn-text">与 {shorthandConflict.conflictsWith} 冲突，可能遮蔽内置输入</span>
        {/if}
      </label>
    </div>

    <div class="modal-foot">
      <button type="button" class="btn-ghost" onclick={onClose}>取消</button>
      <button
        type="button"
        class="btn-primary"
        disabled={!label.trim() || !latex.trim() || Boolean(keyConflict)}
        onclick={submit}
      >
        保存结构
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
    width: min(460px, calc(100vw - 32px));
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-lg);
    box-shadow: var(--ms-shadow-lg), var(--ms-inset-specular);
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

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
    color: var(--ms-fg-muted);
  }

  .field input {
    height: 35px;
    padding: 0 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-size: 13px;
    outline: none;
  }

  .field input.mono {
    font-family: var(--ms-font-mono);
  }

  .field input:focus {
    border-color: var(--ms-accent);
  }

  .warn-text {
    font-size: 11px;
    color: var(--ms-danger);
  }

  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
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
    margin-top: 2px;
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

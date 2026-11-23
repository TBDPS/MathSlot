<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { EditorSnapshot, JumpTarget } from '@mathslot/core';
  import { renderLatexInteractive } from '../katexRenderer';

  interface Props {
    snapshot: EditorSnapshot;
    shiftedUp?: boolean;
    onKeyEvent: (e: KeyboardEvent) => void;
    onTextInput: (text: string) => void;
    onPaste: (text: string) => void;
    onClickSlot: (slotId: string, offset: number) => void;
    onJumpTarget: (label: string) => void;
    onFocusChange: (focused: boolean) => void;
  }

  let {
    snapshot,
    shiftedUp = false,
    onKeyEvent,
    onTextInput,
    onPaste,
    onClickSlot,
    onJumpTarget,
    onFocusChange,
  }: Props = $props();

  let stageEl: HTMLDivElement | null = $state(null);
  let formulaEl: HTMLDivElement | null = $state(null);
  let inputEl: HTMLInputElement | null = $state(null);
  let isComposing = $state(false);
  let scale = $state(1);

  interface PositionedJump extends JumpTarget {
    left: number;
    top: number;
  }
  let jumpPositions = $state<PositionedJump[]>([]);

  const rendered = $derived(renderLatexInteractive(snapshot.interactiveLatex));

  export function focus(): void {
    inputEl?.focus({ preventScroll: true });
  }

  function recomputeLayout(): void {
    if (!stageEl || !formulaEl) return;
    const stageWidth = stageEl.clientWidth - 64;
    const katexEl = formulaEl.querySelector('.katex') as HTMLElement | null;
    if (katexEl && stageWidth > 120) {
      const naturalWidth = katexEl.scrollWidth;
      if (naturalWidth > stageWidth) {
        scale = Math.max(0.48, stageWidth / naturalWidth);
      } else {
        scale = 1;
      }
    } else {
      scale = 1;
    }

    if (snapshot.mode.kind === 'jump') {
      const stageRect = stageEl.getBoundingClientRect();
      const next: PositionedJump[] = [];
      for (const target of snapshot.mode.targets) {
        const el = formulaEl.querySelector(
          `[data-slot-id="${CSS.escape(target.slotId)}"]`,
        ) as HTMLElement | null;
        if (el) {
          const r = el.getBoundingClientRect();
          let left = Math.max(8, r.left - stageRect.left - 4);
          let top = Math.max(8, r.top - stageRect.top - 16);
          // Avoid overlapping badges on nested slots
          for (const prev of next) {
            if (Math.abs(prev.left - left) < 22 && Math.abs(prev.top - top) < 20) {
              top = Math.max(6, top - 22);
            }
          }
          next.push({ ...target, left, top });
        }
      }
      jumpPositions = next;
    } else {
      jumpPositions = [];
    }
  }

  $effect(() => {
    void rendered.html;
    void snapshot.mode;
    void tick().then(() => recomputeLayout());
  });

  onMount(() => {
    focus();
    const ro = new ResizeObserver(() => recomputeLayout());
    if (stageEl) ro.observe(stageEl);
    return () => ro.disconnect();
  });

  function handleStageMouseDown(e: MouseEvent): void {
    // Allow clicking buttons inside WhichKeyHud or jump badges without stealing
    const target = e.target as HTMLElement | null;
    if (target?.closest('button')) return;

    e.preventDefault();
    focus();

    if (!target || !formulaEl) return;

    // 1. Direct click on a rendered math atom -> exact before/after offset
    const atomEl = target.closest('[data-atom-slot]') as HTMLElement | null;
    if (atomEl && formulaEl.contains(atomEl)) {
      const slotId = atomEl.getAttribute('data-atom-slot');
      const offsetStr = atomEl.getAttribute('data-offset');
      if (slotId && offsetStr !== null) {
        const offset = Number(offsetStr);
        const rect = atomEl.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        onClickSlot(slotId, e.clientX >= midX ? offset + 1 : offset);
        return;
      }
    }

    // 2. Direct click on an empty or container slot
    const slotEl = target.closest('[data-slot-id]') as HTMLElement | null;
    if (slotEl && formulaEl.contains(slotEl)) {
      const slotId = slotEl.getAttribute('data-slot-id');
      if (slotId) {
        const rect = slotEl.getBoundingClientRect();
        onClickSlot(slotId, e.clientX >= rect.left + rect.width / 2 ? 99999 : 0);
        return;
      }
    }

    // 3. Click on empty paper area -> place caret at end of root
    onClickSlot(snapshot.doc.root.id, snapshot.doc.root.children.length);
  }

  function handleInputKeyDown(e: KeyboardEvent): void {
    if (isComposing || e.isComposing || e.key === 'Process') return;
    onKeyEvent(e);
  }

  function handleNativeInput(e: Event): void {
    if (isComposing) return;
    const el = e.currentTarget as HTMLInputElement;
    const val = el.value;
    el.value = '';
    if (val) {
      onTextInput(val);
    }
  }

  function handleCompositionStart(): void {
    isComposing = true;
  }

  function handleCompositionEnd(e: CompositionEvent): void {
    isComposing = false;
    const el = e.currentTarget as HTMLInputElement;
    const text = el.value || e.data || '';
    el.value = '';
    if (text) {
      onTextInput(text);
    }
  }

  function handleNativePaste(e: ClipboardEvent): void {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text) onPaste(text);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="canvas-stage" bind:this={stageEl} onmousedown={handleStageMouseDown}>
  <input
    bind:this={inputEl}
    class="hidden-capture"
    type="text"
    autocomplete="off"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
    aria-label="数学公式输入区"
    onkeydown={handleInputKeyDown}
    oninput={handleNativeInput}
    oncompositionstart={handleCompositionStart}
    oncompositionend={handleCompositionEnd}
    onpaste={handleNativePaste}
    onfocus={() => onFocusChange(true)}
    onblur={() => onFocusChange(false)}
  />

  <div class="formula-center" class:shifted={shiftedUp}>
    <div
      class="formula-render"
      class:is-empty={snapshot.isEmpty}
      style:transform={`scale(${scale})`}
      bind:this={formulaEl}
    >
      {@html rendered.html}
    </div>
  </div>

  {#if snapshot.mode.kind === 'jump'}
    {#each jumpPositions as jp (jp.slotId)}
      <button
        type="button"
        class="jump-badge"
        style:left={`${jp.left}px`}
        style:top={`${jp.top}px`}
        onclick={() => onJumpTarget(jp.label)}
      >
        {jp.label}
      </button>
    {/each}
  {/if}
</div>

<style>
  .canvas-stage {
    position: relative;
    flex: 1 1 auto;
    min-height: 260px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    cursor: text;
    user-select: none;
    padding: 32px 24px;
  }

  .hidden-capture {
    position: fixed;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    border: 0;
    padding: 0;
    pointer-events: none;
  }

  .formula-center {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    max-width: 100%;
    min-height: 92px;
    transition: transform 140ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .formula-center.shifted {
    transform: translateY(-102px);
  }

  .formula-render {
    font-size: clamp(1.75rem, 3.2vw, 2.45rem);
    line-height: 1.5;
    transform-origin: center center;
    transition: transform 140ms ease;
    color: var(--ms-fg);
  }

  .jump-badge {
    position: absolute;
    z-index: 25;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 5px;
    border: 1.5px solid var(--ms-jump-border);
    background: var(--ms-jump-bg);
    color: var(--ms-jump-fg);
    font-family: var(--ms-font-mono);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    box-shadow: var(--ms-shadow-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .jump-badge:hover {
    transform: scale(1.08);
  }
</style>

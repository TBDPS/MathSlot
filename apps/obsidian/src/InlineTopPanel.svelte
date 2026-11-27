<script lang="ts">
  import { onMount } from 'svelte';
  import { VisualCanvas } from '@mathslot/ui';
  import type { InlineSplitWorkbenchStore } from './InlineSplitStore.svelte';

  interface Props {
    store: InlineSplitWorkbenchStore;
  }

  let { store }: Props = $props();
  let canvasRef = $state<{ focus: () => void } | null>(null);

  onMount(() => {
    store.registerCanvasFocus(() => {
      canvasRef?.focus();
    });
    return () => {
      store.registerCanvasFocus(null);
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="ms-studio mathslot-split-panel mathslot-split-top"
  data-theme={store.dark ? 'dark' : 'light'}
  onkeydown={(e) => e.stopPropagation()}
>
  <div class="split-top-head">
    <div class="split-crumbs">
      <span class="mode-pill">{store.isBlock ? '块级 $$' : '行内 $'}</span>
      {#if store.snapshot.inputContext === 'raw'}
        <span class="raw-pill">原生 TeX（Enter / Tab 跳出）</span>
      {:else if store.snapshot.breadcrumbs.length > 0}
        {#each store.snapshot.breadcrumbs as crumb, idx (crumb.slotId)}
          {#if idx > 0}<span class="crumb-sep">›</span>{/if}
          <button
            type="button"
            class="crumb-btn"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => store.handleClickSlot(crumb.slotId, 0)}
          >
            {crumb.commandLabel}·{crumb.slotLabel}
          </button>
        {/each}
      {:else}
        <span class="crumb-idle">点击上方槽位进行 2D 结构编辑，或直接在下方文档行改 LaTeX</span>
      {/if}
    </div>

    <div class="split-actions">
      <button
        type="button"
        class="split-act-btn"
        disabled={!store.snapshot.canUndo}
        title="撤销 (Ctrl+Z)"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => {
          store.engine.undo();
          store.focusCanvas();
        }}
      >
        ↶
      </button>
      <button
        type="button"
        class="split-act-btn"
        disabled={!store.snapshot.canRedo}
        title="重做 (Ctrl+Shift+Z)"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => {
          store.engine.redo();
          store.focusCanvas();
        }}
      >
        ↷
      </button>
      {#if !store.isBlock}
        <button
          type="button"
          class="split-act-btn"
          title="升级为块级公式 $$...$$ (Alt+M)"
          onmousedown={(e) => e.preventDefault()}
          onclick={() => store.upgradeToBlock()}
        >
          转 $$
        </button>
      {/if}
      <button
        type="button"
        class="split-act-btn"
        title="打开完整弹窗工作台（浏览 114 条公式库 / 导出 Word MathML / PNG）"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => store.openFullWorkbench()}
      >
        ⤢ 公式库/导出
      </button>
      <button
        type="button"
        class="split-done-btn"
        title="完成并跳出 $ 外侧 (Enter / ;)"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => store.completeAndExit()}
      >
        完成 ↵
      </button>
    </div>
  </div>

  <div class="split-canvas-body">
    <VisualCanvas
      bind:this={canvasRef}
      snapshot={store.snapshot}
      showHierarchyBoxes={store.settings.showHierarchyBoxes}
      onKeyEvent={store.handleKeyEvent}
      onTextInput={store.handleTextInput}
      onPaste={store.handlePaste}
      onClickSlot={store.handleClickSlot}
      onDragSelect={store.handleDragSelect}
      onCrossSlotDragSelect={store.handleCrossSlotDragSelect}
      onDoubleClickAtom={store.handleDoubleClickAtom}
      onJumpTarget={store.handleJumpTarget}
      onFocusChange={store.handleCanvasFocusChange}
      onAddGridRow={() => store.engine.addGridRow('below')}
      onRemoveGridRow={() => store.engine.removeGridRow()}
      onAddGridCol={() => store.engine.addGridCol('right')}
      onRemoveGridCol={() => store.engine.removeGridCol()}
      onToggleGridBar={() => store.engine.toggleGridColBar()}
    />
  </div>
</div>

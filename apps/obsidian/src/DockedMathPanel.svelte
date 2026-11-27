<script lang="ts">
  import { onMount } from 'svelte';
  import { MathRibbon, VisualCanvas } from '@mathslot/ui';
  import type { DockedMathStore } from './dockStore.svelte';

  interface Props {
    store: DockedMathStore;
  }

  let { store }: Props = $props();
  let canvasRef = $state<{ focus: () => void } | null>(null);
  let dragging = $state(false);
  let dragStartY = 0;
  let dragStartHeight = 78;

  const isBlockWrapper = $derived(
    store.wrapper === 'dollar_block' || store.wrapper === 'bracket_block',
  );

  onMount(() => {
    store.registerCanvasFocus(() => {
      canvasRef?.focus();
    });
    return () => {
      store.registerCanvasFocus(null);
    };
  });

  function startResize(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    dragStartY = e.clientY;
    dragStartHeight = store.panelHeight;
    (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  }

  function moveResize(e: PointerEvent): void {
    if (!dragging) return;
    const delta = dragStartY - e.clientY;
    store.panelHeight = Math.max(56, Math.min(260, dragStartHeight + delta));
  }

  function endResize(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="ms-studio mathslot-dock-panel"
  data-theme={store.dark ? 'dark' : 'light'}
  onkeydown={(e) => e.stopPropagation()}
>
  <div
    class="dock-resize-handle"
    class:is-dragging={dragging}
    title="上下拖拽调节 2D 画布高度"
    onpointerdown={startResize}
    onpointermove={moveResize}
    onpointerup={endResize}
    onpointercancel={endResize}
  >
    <span class="dock-resize-pill"></span>
  </div>

  <div class="dock-head">
    <div class="dock-status-group">
      <span
        class="dock-mode-dot"
        class:is-owned={store.mode === 'canvas-owned'}
        title={store.mode === 'canvas-owned'
          ? '2D 工作栏主动输入（实时写回文档）'
          : '跟随文档光标（在文档行打字同步预览，点击画布或按 Tab 接管）'}
      ></span>
      <span class="dock-brand">MathSlot</span>
      <button
        type="button"
        class="dock-wrapper-btn"
        title="切换行内 $...$ 与块级 $$...$$（保留当前编辑光标与引用前缀）"
        onmousedown={(e) => e.preventDefault()}
        onclick={store.toggleWrapper}
      >
        {isBlockWrapper ? '块级 $$' : '行内 $'}
      </button>

      {#if store.snapshot.inputContext === 'raw'}
        <span class="dock-raw-badge">原生 TeX（Enter / Tab 跳出）</span>
      {:else if store.snapshot.breadcrumbs.length > 0}
        <div class="dock-crumbs">
          {#each store.snapshot.breadcrumbs as crumb, idx (crumb.slotId)}
            {#if idx > 0}<span class="dock-crumb-sep">›</span>{/if}
            <button
              type="button"
              class="dock-crumb-btn"
              onmousedown={(e) => e.preventDefault()}
              onclick={() => store.handleClickSlot(crumb.slotId, 0)}
            >
              {crumb.commandLabel}·{crumb.slotLabel}
            </button>
          {/each}
        </div>
      {:else}
        <span class="dock-hint-text">
          {store.mode === 'canvas-owned'
            ? `2D 输入中 · ${store.settings.leaderKey} 结构 · Enter/; 完成`
            : `随文档同步预览 · 点击槽位或按 ${store.settings.leaderKey} 接管 2D 编辑`}
        </span>
      {/if}
    </div>

    <div class="dock-actions">
      <button
        type="button"
        class="dock-btn dock-icon-btn"
        disabled={!store.snapshot.canUndo}
        title="撤销 (Ctrl+Z)"
        onmousedown={(e) => e.preventDefault()}
        onclick={store.handleUndo}
      >
        ↶
      </button>
      <button
        type="button"
        class="dock-btn dock-icon-btn"
        disabled={!store.snapshot.canRedo}
        title="重做 (Ctrl+Shift+Z)"
        onmousedown={(e) => e.preventDefault()}
        onclick={store.handleRedo}
      >
        ↷
      </button>
      <button
        type="button"
        class="dock-btn"
        class:is-active={store.settings.showHierarchyBoxes}
        title="切换 2D 结构嵌套层级虚线框"
        onmousedown={(e) => e.preventDefault()}
        onclick={store.toggleHierarchyBoxes}
      >
        层级框
      </button>
      <button
        type="button"
        class="dock-btn"
        title="打开全屏弹窗工作台（114 公式库 / 自定义结构 / Word MathML / PNG 导出）"
        onmousedown={(e) => e.preventDefault()}
        onclick={store.openFullWorkbench}
      >
        ⤢ 公式库
      </button>
      <button
        type="button"
        class="dock-done-btn"
        title="完成输入并跳到公式外侧 (Enter / ; / Ctrl+Enter)"
        onmousedown={(e) => e.preventDefault()}
        onclick={store.completeAndExit}
      >
        完成 ↵
      </button>
      <button
        type="button"
        class="dock-btn dock-close-btn"
        title="收起底部工作栏"
        aria-label="收起"
        onmousedown={(e) => e.preventDefault()}
        onclick={store.completeAndExit}
      >
        ✕
      </button>
    </div>
  </div>

  <div class="dock-canvas-wrap" style:height="{store.panelHeight}px">
    <VisualCanvas
      bind:this={canvasRef}
      snapshot={store.snapshot}
      shiftedUp={false}
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
      onAddGridRow={() => {
        store.ensureCanvasOwned();
        store.engine.addGridRow('below');
        store.focusCanvas();
      }}
      onRemoveGridRow={() => {
        store.ensureCanvasOwned();
        store.engine.removeGridRow();
        store.focusCanvas();
      }}
      onAddGridCol={() => {
        store.ensureCanvasOwned();
        store.engine.addGridCol('right');
        store.focusCanvas();
      }}
      onRemoveGridCol={() => {
        store.ensureCanvasOwned();
        store.engine.removeGridCol();
        store.focusCanvas();
      }}
      onToggleGridBar={() => {
        store.ensureCanvasOwned();
        store.engine.toggleGridColBar();
        store.focusCanvas();
      }}
    />
  </div>

  <div class="dock-ribbon-wrap">
    <MathRibbon
      leaderKey={store.settings.leaderKey}
      leaderActive={store.snapshot.mode.kind === 'leader'}
      leaderPrefix={store.snapshot.mode.kind === 'leader' ? store.snapshot.mode.prefix : ''}
      pendingDefaultId={
        store.snapshot.mode.kind === 'leader' ? store.snapshot.mode.pendingDefaultId : undefined
      }
      commands={store.effectiveCommands}
      customCommands={store.customCommands}
      snippets={store.snippets}
      submenuMode="inline"
      compact={true}
      onPopoverChange={(open) => {
        store.ribbonPopoverOpen = open;
      }}
      onInsertCommand={store.handleInsertCommand}
      onInsertSnippet={store.handleInsertSnippet}
      onSelectSubmenuKey={store.handleSelectSubmenuKey}
      onLeaderBack={store.handleLeaderBack}
    />
  </div>
</div>

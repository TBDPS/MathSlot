<script lang="ts">
  import { onMount } from 'svelte';
  import { VisualCanvas } from '@mathslot/ui';
  import DockMenu from './DockMenu.svelte';
  import type { DockedMathStore } from './dockStore.svelte';

  interface Props {
    store: DockedMathStore;
  }

  let { store }: Props = $props();
  let canvasRef = $state<{ focus: () => void } | null>(null);

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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ms-studio mathslot-dock-panel" onkeydown={(e) => e.stopPropagation()}>
  <div class="mathslot-dock-preview">
    <VisualCanvas
      bind:this={canvasRef}
      snapshot={store.snapshot}
      minimal={true}
      displayMode={isBlockWrapper}
      shiftedUp={false}
      showHierarchyBoxes={false}
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

  <DockMenu
    leaderKey={store.settings.leaderKey}
    leaderActive={store.snapshot.mode.kind === 'leader'}
    leaderPrefix={store.snapshot.mode.kind === 'leader' ? store.snapshot.mode.prefix : ''}
    pendingDefaultId={
      store.snapshot.mode.kind === 'leader' ? store.snapshot.mode.pendingDefaultId : undefined
    }
    commands={store.effectiveCommands}
    customCommands={store.customCommands}
    snippets={store.snippets}
    onInsertCommand={store.handleInsertCommand}
    onInsertSnippet={store.handleInsertSnippet}
    onSelectSubmenuKey={store.handleSelectSubmenuKey}
    onLeaderBack={store.handleLeaderBack}
  />
</div>

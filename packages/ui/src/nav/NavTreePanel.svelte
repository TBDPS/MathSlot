<script lang="ts">
  import {
    createEmptySnapshot,
    isNavEditorState,
    type DispatchResponse,
    type EngineClient,
    type EngineSnapshot,
  } from '../client/engine';
  import { buildNavTree, flattenNavTree, type FlattenedNavItem } from './navTree';

  export interface NavTreePanelProps {
    client: EngineClient;
    snapshot?: EngineSnapshot;
    theme?: 'light' | 'dark' | 'auto';
    maxHeight?: string;
    onSlotSelected?: (slotId: number, response: DispatchResponse) => void;
  }

  let {
    client,
    snapshot = createEmptySnapshot(),
    theme = 'auto',
    maxHeight = '320px',
    onSlotSelected,
  }: NavTreePanelProps = $props();

  let collapsedKeys = $state<Set<string>>(new Set());
  let focusedIndex = $state(0);
  let navRoot: HTMLElement | null = null;

  const resolvedThemeAttr = $derived(theme === 'auto' ? undefined : theme);
  const inNavMode = $derived(snapshot.is_nav_mode || isNavEditorState(snapshot.state));
  const navPath = $derived(
    typeof snapshot.state === 'object' && snapshot.state !== null && 'Nav' in snapshot.state
      ? snapshot.state.Nav.path
      : [],
  );
  const treeNodes = $derived(buildNavTree(snapshot.slots));
  const flatItems = $derived(flattenNavTree(treeNodes, collapsedKeys));
  const emptySlotCount = $derived(snapshot.slots.filter((s) => s.is_empty).length);

  function toggleGroup(key: string): void {
    const next = new Set(collapsedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    collapsedKeys = next;
  }

  async function selectSlot(slotId: number): Promise<void> {
    const response = await client.dispatch({ SelectSlot: slotId });
    onSlotSelected?.(slotId, response);
  }

  async function toggleNavMode(): Promise<void> {
    await client.dispatch(inNavMode ? 'ExitNavMode' : 'EnterNavMode');
  }

  async function activateItem(item: FlattenedNavItem): Promise<void> {
    if (item.node.kind === 'slot' && item.node.slot) {
      await selectSlot(item.node.slot.id);
    } else if (item.isExpandable) {
      toggleGroup(item.key);
    }
  }

  function focusTreeItemAt(index: number): void {
    const items = navRoot?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]');
    items?.[index]?.focus();
  }

  function handleTreeItemKeydown(
    evt: KeyboardEvent,
    index: number,
    item: FlattenedNavItem,
  ): void {
    const total = flatItems.length;
    if (total === 0) return;

    let nextIndex: number | null = null;
    if (evt.key === 'ArrowDown') {
      nextIndex = Math.min(total - 1, index + 1);
    } else if (evt.key === 'ArrowUp') {
      nextIndex = Math.max(0, index - 1);
    } else if (evt.key === 'Home') {
      nextIndex = 0;
    } else if (evt.key === 'End') {
      nextIndex = total - 1;
    } else if (evt.key === 'ArrowRight') {
      evt.preventDefault();
      if (item.isExpandable && !item.isExpanded) {
        toggleGroup(item.key);
      } else if (index + 1 < total) {
        focusedIndex = index + 1;
        focusTreeItemAt(focusedIndex);
      }
      return;
    } else if (evt.key === 'ArrowLeft') {
      evt.preventDefault();
      if (item.isExpandable && item.isExpanded) {
        toggleGroup(item.key);
      } else if (item.parentKey) {
        const parentIdx = flatItems.findIndex((candidate) => candidate.key === item.parentKey);
        if (parentIdx >= 0) {
          focusedIndex = parentIdx;
          focusTreeItemAt(parentIdx);
        }
      }
      return;
    } else if (evt.key === 'Enter' || evt.key === ' ') {
      evt.preventDefault();
      void activateItem(item);
      return;
    }

    if (nextIndex !== null) {
      evt.preventDefault();
      focusedIndex = nextIndex;
      focusTreeItemAt(nextIndex);
    }
  }
</script>

<section
  bind:this={navRoot}
  class="ms-nav-shell"
  data-testid="mathslot-nav-tree"
  data-theme={resolvedThemeAttr}
  aria-label="AST 与槽位导航树"
>
  <header class="ms-nav-header">
    <div class="ms-nav-title-group">
      <h3 class="ms-nav-title">结构导航树</h3>
      <span class="ms-nav-counts">
        {snapshot.slots.length} 槽位 · {emptySlotCount} 待填
      </span>
    </div>

    <button
      type="button"
      class="ms-nav-toggle"
      data-testid="nav-mode-toggle"
      aria-pressed={inNavMode}
      onclick={() => void toggleNavMode()}
    >
      {inNavMode ? '退出导航' : '进入导航'}
    </button>
  </header>

  {#if inNavMode && navPath.length > 0}
    <nav class="ms-nav-breadcrumb" aria-label="导航路径">
      <span class="ms-crumb-prefix">路径</span>
      <span class="ms-crumb-value">{navPath.join(' › ')}</span>
    </nav>
  {/if}

  {#if flatItems.length === 0}
    <div class="ms-nav-empty" role="status">
      当前公式暂无结构槽位
    </div>
  {:else}
    <div
      class="ms-nav-scroll"
      style={`--ms-nav-max-height: ${maxHeight};`}
    >
      <ul class="ms-nav-tree" role="tree" aria-label="AST 槽位导航树">
        {#each flatItems as item, idx (item.key)}
          <li class="ms-nav-li" role="none">
            <button
              type="button"
              role="treeitem"
              class="ms-tree-item"
              class:ms-tree-group={item.node.kind === 'group'}
              class:ms-tree-active={Boolean(item.node.slot?.is_active)}
              class:ms-tree-empty={Boolean(item.node.slot?.is_empty)}
              data-slot-id={item.node.slot?.id}
              data-depth={item.depth}
              aria-level={item.level}
              aria-expanded={item.isExpandable ? item.isExpanded : undefined}
              aria-current={item.node.slot?.is_active ? 'step' : undefined}
              aria-selected={item.node.slot?.is_active ? 'true' : 'false'}
              tabindex={idx === Math.min(focusedIndex, flatItems.length - 1) ? 0 : -1}
              style={`--ms-tree-depth: ${item.depth};`}
              onclick={() => {
                focusedIndex = idx;
                void activateItem(item);
              }}
              onkeydown={(evt) => handleTreeItemKeydown(evt, idx, item)}
            >
              <span class="ms-tree-main">
                <span class="ms-tree-marker" aria-hidden="true">
                  {#if item.isExpandable}
                    {item.isExpanded ? '▾' : '▸'}
                  {:else}
                    •
                  {/if}
                </span>
                {#if item.node.slot}
                  <span class="ms-slot-num">#{item.node.slot.id}</span>
                {/if}
                <span class="ms-tree-label">{item.node.label}</span>
              </span>

              <span class="ms-tree-meta">
                <span class="ms-path-tag">[{item.node.path.join('.')}]</span>
                {#if item.node.slot}
                  <span class="ms-slot-status">
                    {item.node.slot.is_empty ? '空槽位' : '已填'}
                  </span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .ms-nav-shell {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-family: var(--ms-font-sans);
    box-shadow: var(--ms-shadow-sm);
  }

  .ms-nav-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .ms-nav-title-group {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .ms-nav-title {
    margin: 0;
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--ms-fg);
  }

  .ms-nav-counts {
    font-size: 0.74rem;
    color: var(--ms-fg-subtle);
  }

  .ms-nav-toggle {
    padding: 4px 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    color: var(--ms-fg);
    font-size: 0.76rem;
    font-weight: 600;
    cursor: pointer;
  }

  .ms-nav-toggle[aria-pressed='true'] {
    background: var(--ms-mode-nav-bg);
    color: var(--ms-mode-nav-fg);
    border-color: var(--ms-accent);
  }

  .ms-nav-breadcrumb {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface-elevated);
    border: 1px solid var(--ms-border);
    font-size: 0.75rem;
  }

  .ms-crumb-prefix {
    font-weight: 600;
    color: var(--ms-fg-subtle);
  }

  .ms-crumb-value {
    font-family: var(--ms-font-mono);
    color: var(--ms-fg);
  }

  .ms-nav-scroll {
    max-height: var(--ms-nav-max-height, 320px);
    overflow-y: auto;
    overflow-x: hidden;
    padding: 2px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
  }

  .ms-nav-tree {
    list-style: none;
    margin: 0;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .ms-nav-li {
    margin: 0;
    padding: 0;
  }

  .ms-tree-item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    padding-inline-start: calc(10px + var(--ms-tree-depth, 0) * 14px);
    border: 1px solid transparent;
    border-radius: var(--ms-radius-sm);
    background: var(--ms-slot-filled-bg);
    color: var(--ms-slot-filled-fg);
    font-size: 0.8rem;
    text-align: left;
    cursor: pointer;
  }

  .ms-tree-group {
    background: var(--ms-surface-elevated);
    color: var(--ms-fg);
    font-weight: 600;
  }

  .ms-tree-empty {
    background: var(--ms-slot-empty-bg);
    border-color: var(--ms-slot-empty-border);
    color: var(--ms-slot-empty-fg);
  }

  .ms-tree-active {
    background: var(--ms-slot-active-bg);
    border-color: var(--ms-slot-active-border);
    color: var(--ms-slot-active-fg);
    font-weight: 600;
  }

  .ms-tree-main {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }

  .ms-tree-marker {
    font-family: var(--ms-font-mono);
    width: 12px;
    text-align: center;
    flex: 0 0 auto;
  }

  .ms-slot-num {
    font-family: var(--ms-font-mono);
    font-size: 0.72rem;
    opacity: 0.85;
    flex: 0 0 auto;
  }

  .ms-tree-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ms-tree-meta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
  }

  .ms-path-tag {
    font-family: var(--ms-font-mono);
    font-size: 0.7rem;
    color: var(--ms-fg-subtle);
  }

  .ms-slot-status {
    padding: 1px 6px;
    border-radius: var(--ms-radius-pill);
    border: 1px solid currentColor;
    font-size: 0.68rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .ms-nav-empty {
    padding: 14px;
    text-align: center;
    border: 1px dashed var(--ms-border);
    border-radius: var(--ms-radius-sm);
    color: var(--ms-fg-muted);
    font-size: 0.8rem;
  }

  .ms-nav-toggle:focus-visible,
  .ms-tree-item:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: 2px;
  }

  @media (max-width: 480px) {
    .ms-nav-shell {
      padding: 8px;
    }

    .ms-nav-toggle,
    .ms-tree-item {
      min-height: 36px;
    }
  }
</style>

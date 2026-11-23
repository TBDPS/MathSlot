<script lang="ts">
  import {
    COMMANDS,
    COMMANDS_BY_ID,
    SHORTHAND_BY_COMMAND_ID,
    SUBMENU_BY_KEY,
    commandPreviewLatex,
    type CommandCategory,
    type CommandDef,
    type CustomCommandDef,
    type LeaderKey,
    type Snippet,
  } from '@mathslot/core';
  import { renderLatexPreview } from '../katexRenderer';

  type RibbonCategory = CommandCategory | 'custom' | 'snippets';

  interface Props {
    leaderKey: LeaderKey;
    leaderActive?: boolean;
    leaderPrefix?: string;
    pendingDefaultId?: string;
    commands?: readonly CommandDef[];
    customCommands?: CustomCommandDef[];
    snippets?: Snippet[];
    onInsertCommand: (commandId: string) => void;
    onInsertSnippet?: (snippet: Snippet) => void;
    onSelectSubmenuKey?: (key: string) => void;
    onLeaderBack?: () => void;
    onCreateCustom?: () => void;
    onSaveSnippet?: () => void;
    onPopoverChange?: (open: boolean) => void;
  }

  let {
    leaderKey,
    leaderActive = false,
    leaderPrefix = '',
    pendingDefaultId = undefined,
    commands = COMMANDS,
    customCommands = [],
    snippets = [],
    onInsertCommand,
    onInsertSnippet,
    onSelectSubmenuKey,
    onLeaderBack,
    onCreateCustom,
    onSaveSnippet,
    onPopoverChange,
  }: Props = $props();

  const QUICK_ITEMS: readonly { id: string; key: string; preview: string }[] = [
    { id: 'frac', key: 'f', preview: '\\frac{\\square}{\\square}' },
    { id: 'sqrt', key: 'r', preview: '\\sqrt{\\square}' },
    { id: 'sup', key: 'u', preview: 'x^{\\square}' },
    { id: 'sub', key: 'd', preview: 'x_{\\square}' },
    { id: 'subsup', key: 'b', preview: 'x_{\\square}^{\\square}' },
    { id: 'paren', key: 'p', preview: '(\\square)' },
    { id: 'abs', key: 'v', preview: '|\\square|' },
    { id: 'integral', key: 'i', preview: '\\int' },
    { id: 'sum', key: 's', preview: '\\sum' },
    { id: 'limit', key: 'l', preview: '\\lim' },
    { id: 'binom', key: 'e', preview: '\\binom{n}{k}' },
  ];

  const CATEGORY_GROUPS: readonly {
    key: string;
    category: RibbonCategory;
    label: string;
    preview: string;
  }[] = [
    { key: 'g', category: 'greek', label: '希腊字母', preview: '\\alpha' },
    { key: 'c', category: 'calculus', label: '微积分', preview: '\\partial' },
    { key: 'm', category: 'matrix', label: '矩阵与分段', preview: '[\\cdot]' },
    { key: 'a', category: 'accent', label: '装饰与定界', preview: '\\hat{x}' },
    { key: 'o', category: 'symbol', label: '运算符号', preview: '\\pm' },
    { key: 'x', category: 'relation', label: '关系符号', preview: '\\approx' },
    { key: 'q', category: 'setlogic', label: '集合与逻辑', preview: '\\cup' },
    { key: 'k', category: 'custom', label: '自定义结构', preview: '\\star' },
    { key: 't', category: 'snippets', label: '复用片段', preview: '\\sharp' },
  ];

  const KEY_TO_CATEGORY = new Map<string, RibbonCategory>(
    CATEGORY_GROUPS.map((g) => [g.key, g.category]),
  );

  let mouseCategory = $state<RibbonCategory | null>(null);
  let ribbonEl: HTMLDivElement | null = $state(null);

  const activeCategory = $derived<RibbonCategory | null>(
    leaderActive && leaderPrefix
      ? (KEY_TO_CATEGORY.get(leaderPrefix) ?? null)
      : mouseCategory,
  );

  const popoverCommands = $derived<CommandDef[]>(
    activeCategory && activeCategory !== 'custom' && activeCategory !== 'snippets'
      ? commands.filter((c) => c.category === activeCategory)
      : [],
  );

  const activeGroup = $derived(
    CATEGORY_GROUPS.find((g) => g.category === activeCategory) ?? null,
  );

  $effect(() => {
    if (leaderActive) {
      mouseCategory = null;
    }
  });

  $effect(() => {
    onPopoverChange?.(activeCategory !== null);
  });

  function handleWindowPointerDown(e: PointerEvent): void {
    if (!mouseCategory || !ribbonEl) return;
    if (!ribbonEl.contains(e.target as Node)) {
      mouseCategory = null;
    }
  }

  function handleWindowKeyDown(e: KeyboardEvent): void {
    if (mouseCategory && e.key === 'Escape') {
      mouseCategory = null;
    }
  }

  function pickCommand(id: string): void {
    mouseCategory = null;
    onInsertCommand(id);
  }

  function clickCategory(grp: (typeof CATEGORY_GROUPS)[number]): void {
    if (leaderActive && onSelectSubmenuKey) {
      if (leaderPrefix === grp.key) {
        onLeaderBack?.();
      } else {
        onSelectSubmenuKey(grp.key);
      }
      return;
    }
    mouseCategory = mouseCategory === grp.category ? null : grp.category;
  }
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeyDown} />

<div class="ribbon-wrap" bind:this={ribbonEl}>
  {#if activeCategory && activeGroup}
    <div class="cat-popover" class:leader-mode={leaderActive} role="menu" aria-label={activeGroup.label}>
      <div class="cat-head">
        {#if leaderActive}
          <button
            type="button"
            class="cat-back"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => onLeaderBack?.()}
            aria-label="返回"
          >
            ‹
          </button>
        {/if}
        <span class="cat-title">{activeGroup.label}</span>
        {#if activeCategory === 'custom' && onCreateCustom}
          <button
            type="button"
            class="new-custom-btn"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => {
              mouseCategory = null;
              onCreateCustom();
            }}
          >
            + 新建结构
          </button>
        {:else if activeCategory === 'snippets' && onSaveSnippet}
          <button
            type="button"
            class="new-custom-btn"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => {
              mouseCategory = null;
              onSaveSnippet();
            }}
          >
            + 存当前式为片段
          </button>
        {/if}
        <span class="cat-chord">
          <kbd>{leaderKey}</kbd><kbd>{activeGroup.key}</kbd>
        </span>
      </div>

      {#if activeCategory === 'snippets'}
        {#if snippets.length === 0}
          <div class="custom-empty">
            <span>暂无复用片段</span>
          </div>
        {:else}
          <div class="cat-grid">
            {#each snippets as snip (snip.id)}
              <button
                type="button"
                class="cat-cell"
                title={snip.name}
                onmousedown={(e) => e.preventDefault()}
                onclick={() => {
                  mouseCategory = null;
                  onInsertSnippet?.(snip);
                }}
              >
                <div class="cell-top">
                  {#if snip.key}
                    <kbd class="cell-key" class:hot={leaderActive}>{snip.key}</kbd>
                  {:else}
                    <span></span>
                  {/if}
                </div>
                <span class="cat-math">
                  {@html renderLatexPreview(snip.latex, false)}
                </span>
                <span class="cat-label">{snip.name}</span>
              </button>
            {/each}
          </div>
        {/if}
      {:else if activeCategory === 'custom'}
        {#if customCommands.length === 0}
          <div class="custom-empty">
            <span>暂无自定义结构</span>
          </div>
        {:else}
          <div class="cat-grid">
            {#each customCommands as cmd (cmd.id)}
              <button
                type="button"
                class="cat-cell"
                title={cmd.label}
                onmousedown={(e) => e.preventDefault()}
                onclick={() => pickCommand(cmd.id)}
              >
                <div class="cell-top">
                  {#if cmd.key}
                    <kbd class="cell-key" class:hot={leaderActive}>{cmd.key}</kbd>
                  {:else}
                    <span></span>
                  {/if}
                  {#if cmd.shorthand}
                    <span class="cell-short">{cmd.shorthand}</span>
                  {/if}
                </div>
                <span class="cat-math">
                  {@html renderLatexPreview(commandPreviewLatex(cmd.latex), false)}
                </span>
                <span class="cat-label">{cmd.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="cat-grid">
          {#each popoverCommands as cmd (cmd.id)}
            {@const shorthand = SHORTHAND_BY_COMMAND_ID.get(cmd.id)}
            {@const isDefault =
              pendingDefaultId === cmd.id ||
              (activeGroup ? SUBMENU_BY_KEY.get(activeGroup.key)?.defaultCommandId === cmd.id : false)}
            <button
              type="button"
              class="cat-cell"
              class:is-default={isDefault}
              title={`${cmd.label}（${leaderKey} ${cmd.keys.join(' ')}${isDefault ? ` · 单按 ${leaderKey} ${activeGroup?.key ?? ''} 默认插入` : ''}${shorthand ? ` · 简写 ${shorthand}` : ''}）`}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => pickCommand(cmd.id)}
            >
              <div class="cell-top">
                <kbd class="cell-key" class:hot={leaderActive}>{cmd.keys[1] ?? cmd.keys[0]}</kbd>
                {#if isDefault}
                  <span class="cell-default">默认</span>
                {:else if shorthand}
                  <span class="cell-short">{shorthand}</span>
                {/if}
              </div>
              <span class="cat-math">
                {@html renderLatexPreview(commandPreviewLatex(cmd.latex), false)}
              </span>
              <span class="cat-label">{cmd.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div
    class="ribbon-bar"
    class:leader-active={leaderActive}
    role="toolbar"
    aria-label="快捷数学符号"
  >
    <div class="ribbon-group">
      {#each QUICK_ITEMS as item (item.id)}
        {@const cmd = COMMANDS_BY_ID.get(item.id)}
        <button
          type="button"
          class="ribbon-btn"
          title={`${cmd?.label ?? item.id}（${leaderKey} ${item.key}）`}
          aria-label={cmd?.label ?? item.id}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => pickCommand(item.id)}
        >
          <span class="btn-glyph">{@html renderLatexPreview(item.preview, false)}</span>
          <kbd class="btn-key" class:hot={leaderActive && !leaderPrefix}>{item.key}</kbd>
        </button>
      {/each}
    </div>

    <span class="ribbon-sep"></span>

    <div class="ribbon-group">
      {#each CATEGORY_GROUPS as grp (grp.category)}
        <button
          type="button"
          class="ribbon-btn ribbon-cat"
          class:active={activeCategory === grp.category}
          title={`${grp.label}（${leaderKey} ${grp.key}）`}
          aria-label={grp.label}
          aria-expanded={activeCategory === grp.category}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => clickCategory(grp)}
        >
          <span class="btn-glyph">{@html renderLatexPreview(grp.preview, false)}</span>
          <kbd class="btn-key" class:hot={leaderActive && (!leaderPrefix || leaderPrefix === grp.key)}>{grp.key}</kbd>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .ribbon-wrap {
    position: relative;
    display: flex;
    justify-content: center;
    padding: 0 12px 14px;
    flex-shrink: 0;
    z-index: 20;
  }

  .ribbon-bar {
    display: flex;
    align-items: center;
    gap: 7px;
    max-width: 100%;
    overflow-x: auto;
    padding: 7px 9px;
    border-radius: 14px;
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    box-shadow: var(--ms-shadow-sm);
    scrollbar-width: none;
    transition: border-color 110ms ease, box-shadow 110ms ease;
  }

  .ribbon-bar.leader-active {
    border-color: var(--ms-accent);
    box-shadow: 0 0 0 2px var(--ms-accent-ring), var(--ms-shadow-md);
  }

  .ribbon-bar::-webkit-scrollbar {
    display: none;
  }

  .ribbon-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .ribbon-sep {
    width: 1px;
    height: 34px;
    background: var(--ms-border);
    margin: 0 3px;
    flex-shrink: 0;
  }

  .ribbon-btn {
    height: 54px;
    min-width: 42px;
    padding: 6px 6px 5px;
    border: 1px solid var(--ms-border-subtle);
    border-radius: 9px;
    background: var(--ms-tile);
    color: var(--ms-fg);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    flex-shrink: 0;
    transition: background-color 80ms ease, border-color 80ms ease, transform 80ms ease;
  }

  .ribbon-btn:hover {
    background: var(--ms-tile-hover);
    border-color: var(--ms-accent);
  }

  .ribbon-cat.active {
    background: var(--ms-accent-soft);
    border-color: var(--ms-accent);
    color: var(--ms-accent);
  }

  .btn-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 24px;
    font-size: 16px;
    line-height: 1;
  }

  .btn-glyph :global(.katex) {
    font-size: 1em;
  }

  .btn-key {
    min-width: 16px;
    height: 14px;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--ms-keycap-bg);
    border: 1px solid var(--ms-keycap-border);
    color: var(--ms-keycap-fg);
    font-family: var(--ms-font-mono);
    font-size: 10px;
    font-weight: 700;
    line-height: 12px;
    text-align: center;
    transition: background-color 90ms ease, color 90ms ease, border-color 90ms ease;
  }

  .btn-key.hot {
    background: var(--ms-accent);
    border-color: var(--ms-accent);
    color: var(--ms-accent-fg);
  }

  .cat-popover {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    width: min(700px, calc(100vw - 24px));
    max-height: 254px;
    display: flex;
    flex-direction: column;
    border-radius: var(--ms-radius-lg);
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    box-shadow: var(--ms-shadow-md);
    overflow: hidden;
    animation: pop-in 100ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .cat-popover.leader-mode {
    border-color: var(--ms-accent);
    box-shadow: 0 0 0 2px var(--ms-accent-ring), var(--ms-shadow-md);
  }

  @keyframes pop-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(5px) scale(0.99);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
  }

  .cat-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--ms-border-subtle);
    background: var(--ms-chrome);
    flex-shrink: 0;
  }

  .cat-back {
    width: 22px;
    height: 22px;
    border: 1px solid var(--ms-border);
    border-radius: 5px;
    background: var(--ms-surface);
    color: var(--ms-fg);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .cat-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ms-fg);
  }

  .new-custom-btn {
    height: 24px;
    padding: 0 9px;
    border: 1px solid var(--ms-accent);
    border-radius: 6px;
    background: var(--ms-accent-soft);
    color: var(--ms-accent);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
  }

  .new-custom-btn:hover {
    background: var(--ms-accent);
    color: var(--ms-accent-fg);
  }

  .cat-chord {
    margin-left: auto;
    display: inline-flex;
    gap: 3px;
  }

  .cat-chord kbd {
    font-family: var(--ms-font-mono);
    font-size: 10.5px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--ms-keycap-bg);
    border: 1px solid var(--ms-keycap-border);
    color: var(--ms-keycap-fg);
  }

  .custom-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 28px 16px;
    color: var(--ms-fg-muted);
    font-size: 12.5px;
  }

  .cat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: 7px;
    padding: 10px;
    overflow-y: auto;
  }

  .cat-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 7px 6px 8px;
    border: 1px solid var(--ms-border-subtle);
    border-radius: 9px;
    background: var(--ms-tile);
    color: var(--ms-fg);
    cursor: pointer;
    transition: background-color 80ms ease, border-color 80ms ease;
  }

  .cat-cell:hover {
    background: var(--ms-tile-hover);
    border-color: var(--ms-accent);
  }

  .cat-cell.is-default {
    border-color: color-mix(in srgb, var(--ms-accent) 48%, var(--ms-border));
    background: color-mix(in srgb, var(--ms-accent-soft) 55%, var(--ms-tile));
  }

  .cell-default {
    font-size: 9.5px;
    font-weight: 600;
    color: var(--ms-accent);
    background: var(--ms-accent-soft);
    border: 1px solid color-mix(in srgb, var(--ms-accent) 32%, transparent);
    border-radius: 4px;
    padding: 0 4px;
    line-height: 15px;
  }

  .cell-top {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    min-height: 17px;
  }

  .cell-key {
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--ms-keycap-bg);
    border: 1px solid var(--ms-keycap-border);
    color: var(--ms-keycap-fg);
    font-family: var(--ms-font-mono);
    font-size: 10.5px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .cell-key.hot {
    background: var(--ms-accent);
    border-color: var(--ms-accent);
    color: var(--ms-accent-fg);
  }

  .cell-short {
    font-family: var(--ms-font-mono);
    font-size: 10px;
    color: var(--ms-fg-muted);
    background: var(--ms-surface);
    border: 1px solid var(--ms-border-subtle);
    border-radius: 4px;
    padding: 0 4px;
    line-height: 15px;
  }

  .cat-math {
    font-size: 16px;
    min-height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--ms-fg);
  }

  .cat-label {
    font-size: 11px;
    color: var(--ms-fg-muted);
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>

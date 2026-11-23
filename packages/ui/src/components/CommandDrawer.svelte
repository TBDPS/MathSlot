<script lang="ts">
  import { onMount } from 'svelte';
  import {
    CATEGORY_LABELS,
    COMMANDS,
    PRESETS,
    PRESET_CATEGORIES,
    commandPreviewLatex,
    importFormula,
    searchCommands,
    searchPresets,
    toLatex,
    type CommandCategory,
    type CustomCommandDef,
    type LeaderKey,
    type Snippet,
  } from '@mathslot/core';
  import { renderLatexPreview } from '../katexRenderer';

  type DrawerTab = 'commands' | 'presets' | 'snippets' | 'custom';

  interface Props {
    leaderKey: LeaderKey;
    snippets: Snippet[];
    customCommands: CustomCommandDef[];
    initialTab?: DrawerTab;
    onInsertCommand: (commandId: string) => void;
    onLoadFormula: (source: string) => void;
    onRenameSnippet: (id: string, nextName: string) => void;
    onDeleteSnippet: (id: string) => void;
    onCreateCustom: () => void;
    onEditCustom: (cmd: CustomCommandDef) => void;
    onDeleteCustom: (id: string) => void;
    onClose: () => void;
  }

  let {
    leaderKey,
    snippets,
    customCommands,
    initialTab = 'commands',
    onInsertCommand,
    onLoadFormula,
    onRenameSnippet,
    onDeleteSnippet,
    onCreateCustom,
    onEditCustom,
    onDeleteCustom,
    onClose,
  }: Props = $props();

  let tab = $state<DrawerTab>('commands');
  $effect(() => {
    tab = initialTab;
  });
  let query = $state('');
  let selectedCategory = $state<CommandCategory | 'all'>('all');
  let selectedPresetCat = $state<string>('all');
  let activeIndex = $state(0);
  let renamingSnippetId = $state<string | null>(null);
  let renameDraft = $state('');
  let searchInputEl: HTMLInputElement | null = $state(null);

  const filteredCommands = $derived.by(() => {
    const base = query.trim() ? searchCommands(query) : [...COMMANDS];
    if (selectedCategory === 'all') return base;
    return base.filter((c) => c.category === selectedCategory);
  });

  const filteredPresets = $derived.by(() => {
    const base = query.trim() ? searchPresets(query) : [...PRESETS];
    if (selectedPresetCat === 'all') return base;
    return base.filter((p) => p.category === selectedPresetCat);
  });

  const filteredSnippets = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter(
      (s) => s.name.toLowerCase().includes(q) || s.latex.toLowerCase().includes(q),
    );
  });

  const filteredCustom = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customCommands;
    return customCommands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.latex.toLowerCase().includes(q) ||
        (c.shorthand?.toLowerCase().includes(q) ?? false),
    );
  });

  const currentCount = $derived(
    tab === 'commands'
      ? filteredCommands.length
      : tab === 'presets'
        ? filteredPresets.length
        : tab === 'snippets'
          ? filteredSnippets.length
          : filteredCustom.length,
  );

  $effect(() => {
    void tab;
    void query;
    void selectedCategory;
    void selectedPresetCat;
    activeIndex = 0;
  });

  onMount(() => {
    searchInputEl?.focus();
  });

  function presetLatex(source: string): string {
    const res = importFormula(source);
    return toLatex(res.doc);
  }

  function commitRename(id: string): void {
    const clean = renameDraft.trim();
    if (clean) onRenameSnippet(id, clean);
    renamingSnippetId = null;
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (renamingSnippetId) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentCount > 0) activeIndex = (activeIndex + 1) % currentCount;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentCount > 0) activeIndex = (activeIndex - 1 + currentCount) % currentCount;
      return;
    }
    if (e.key === 'Enter' && currentCount > 0) {
      e.preventDefault();
      if (tab === 'commands') {
        const item = filteredCommands[activeIndex];
        if (item) {
          onInsertCommand(item.id);
          onClose();
        }
      } else if (tab === 'presets') {
        const item = filteredPresets[activeIndex];
        if (item) {
          onLoadFormula(item.source);
          onClose();
        }
      } else if (tab === 'snippets') {
        const item = filteredSnippets[activeIndex];
        if (item) {
          onLoadFormula(item.latex);
          onClose();
        }
      } else {
        const item = filteredCustom[activeIndex];
        if (item) {
          onInsertCommand(item.id);
          onClose();
        }
      }
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }} onkeydown={handleKeyDown}>
  <div class="palette" role="dialog" aria-modal="true" aria-label="命令与公式库">
    <div class="palette-top">
      <div class="search-row">
        <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          bind:this={searchInputEl}
          bind:value={query}
          class="search-input"
          type="text"
          placeholder="搜索命令、符号、预置或自定义结构…"
        />
        <button type="button" class="close-btn" onclick={onClose} aria-label="关闭">✕</button>
      </div>

      <div class="tabs-row">
        <button type="button" class="tab-btn" class:active={tab === 'commands'} onclick={() => (tab = 'commands')}>
          命令 <span>{COMMANDS.length}</span>
        </button>
        <button type="button" class="tab-btn" class:active={tab === 'presets'} onclick={() => (tab = 'presets')}>
          公式库 <span>{PRESETS.length}</span>
        </button>
        <button type="button" class="tab-btn" class:active={tab === 'snippets'} onclick={() => (tab = 'snippets')}>
          片段 <span>{snippets.length}</span>
        </button>
        <button type="button" class="tab-btn" class:active={tab === 'custom'} onclick={() => (tab = 'custom')}>
          自定义结构 <span>{customCommands.length}</span>
        </button>
        {#if tab === 'custom'}
          <button
            type="button"
            class="new-btn"
            onclick={() => {
              onClose();
              onCreateCustom();
            }}
          >
            + 新建
          </button>
        {/if}
      </div>

      {#if tab === 'commands'}
        <div class="filter-pills">
          <button type="button" class="pill" class:active={selectedCategory === 'all'} onclick={() => (selectedCategory = 'all')}>
            全部
          </button>
          {#each Object.entries(CATEGORY_LABELS) as [cat, label] (cat)}
            <button
              type="button"
              class="pill"
              class:active={selectedCategory === cat}
              onclick={() => (selectedCategory = cat as CommandCategory)}
            >
              {label}
            </button>
          {/each}
        </div>
      {:else if tab === 'presets'}
        <div class="filter-pills">
          <button type="button" class="pill" class:active={selectedPresetCat === 'all'} onclick={() => (selectedPresetCat = 'all')}>
            全部
          </button>
          {#each PRESET_CATEGORIES as cat (cat)}
            <button
              type="button"
              class="pill"
              class:active={selectedPresetCat === cat}
              onclick={() => (selectedPresetCat = cat)}
            >
              {cat}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="palette-list">
      {#if tab === 'commands'}
        <div class="cmd-grid">
          {#each filteredCommands as cmd, idx (cmd.id)}
            <button
              type="button"
              class="cmd-tile"
              class:selected={idx === activeIndex}
              onmouseenter={() => (activeIndex = idx)}
              onclick={() => {
                onInsertCommand(cmd.id);
                onClose();
              }}
            >
              <div class="cmd-math">
                {@html renderLatexPreview(commandPreviewLatex(cmd.latex), false)}
              </div>
              <div class="cmd-meta">
                <span class="cmd-name">{cmd.label}</span>
                <span class="cmd-keys">
                  <kbd>{leaderKey}</kbd>
                  {#each cmd.keys as k}
                    <kbd>{k}</kbd>
                  {/each}
                </span>
              </div>
            </button>
          {/each}
        </div>
      {:else if tab === 'presets'}
        {#each filteredPresets as preset, idx (preset.id)}
          <button
            type="button"
            class="preset-row"
            class:selected={idx === activeIndex}
            onmouseenter={() => (activeIndex = idx)}
            onclick={() => {
              onLoadFormula(preset.source);
              onClose();
            }}
          >
            <div class="preset-info">
              <span class="preset-name">{preset.name}</span>
              <span class="preset-cat">{preset.category}</span>
            </div>
            <div class="preset-math">
              {@html renderLatexPreview(presetLatex(preset.source), false)}
            </div>
          </button>
        {/each}
      {:else if tab === 'snippets'}
        {#if filteredSnippets.length === 0}
          <div class="empty-state">暂无片段</div>
        {:else}
          {#each filteredSnippets as snip, idx (snip.id)}
            <div class="preset-row" class:selected={idx === activeIndex}>
              {#if renamingSnippetId === snip.id}
                <input
                  class="rename-input"
                  type="text"
                  bind:value={renameDraft}
                  onblur={() => commitRename(snip.id)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename(snip.id);
                    } else if (e.key === 'Escape') {
                      renamingSnippetId = null;
                    }
                  }}
                />
              {:else}
                <button
                  type="button"
                  class="snip-main"
                  onmouseenter={() => (activeIndex = idx)}
                  onclick={() => {
                    onLoadFormula(snip.latex);
                    onClose();
                  }}
                >
                  <span class="preset-name">{snip.name}</span>
                  <span class="preset-math">{@html renderLatexPreview(snip.latex, false)}</span>
                </button>
                <div class="row-actions">
                  <button
                    type="button"
                    class="row-btn"
                    title="重命名"
                    onclick={() => {
                      renamingSnippetId = snip.id;
                      renameDraft = snip.name;
                    }}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    class="row-btn danger"
                    onclick={() => onDeleteSnippet(snip.id)}
                    aria-label="删除片段"
                  >
                    ✕
                  </button>
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      {:else if filteredCustom.length === 0}
        <div class="empty-state">
          <p>暂无自定义结构</p>
          <button
            type="button"
            class="new-btn"
            onclick={() => {
              onClose();
              onCreateCustom();
            }}
          >
            + 新建自定义结构
          </button>
        </div>
      {:else}
        {#each filteredCustom as cmd, idx (cmd.id)}
          <div class="preset-row" class:selected={idx === activeIndex}>
            <button
              type="button"
              class="snip-main"
              onmouseenter={() => (activeIndex = idx)}
              onclick={() => {
                onInsertCommand(cmd.id);
                onClose();
              }}
            >
              <div class="preset-info">
                <span class="preset-name">{cmd.label}</span>
                <span class="cmd-keys">
                  {#if cmd.key}
                    <kbd>{leaderKey}</kbd><kbd>k</kbd><kbd>{cmd.key}</kbd>
                  {/if}
                  {#if cmd.shorthand}
                    <kbd>{cmd.shorthand}</kbd>
                  {/if}
                </span>
              </div>
              <span class="preset-math">
                {@html renderLatexPreview(commandPreviewLatex(cmd.latex), false)}
              </span>
            </button>
            <div class="row-actions">
              <button
                type="button"
                class="row-btn"
                onclick={() => {
                  onClose();
                  onEditCustom(cmd);
                }}
              >
                编辑
              </button>
              <button
                type="button"
                class="row-btn danger"
                onclick={() => onDeleteCustom(cmd.id)}
                aria-label="删除结构"
              >
                ✕
              </button>
            </div>
          </div>
        {/each}
      {/if}
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
    align-items: flex-start;
    justify-content: center;
    padding-top: min(9vh, 64px);
    z-index: 50;
  }

  .palette {
    width: min(670px, calc(100vw - 32px));
    max-height: min(78vh, 630px);
    display: flex;
    flex-direction: column;
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-lg);
    box-shadow: var(--ms-shadow-lg);
    overflow: hidden;
  }

  .palette-top {
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--ms-border-subtle);
    background: var(--ms-chrome);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .search-icon {
    color: var(--ms-fg-muted);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--ms-fg);
    font-size: 14.5px;
    font-family: var(--ms-font-sans);
  }

  .search-input::placeholder {
    color: var(--ms-fg-faint);
  }

  .close-btn {
    border: none;
    background: transparent;
    color: var(--ms-fg-muted);
    width: 26px;
    height: 26px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }

  .close-btn:hover {
    background: var(--ms-surface-muted);
    color: var(--ms-fg);
  }

  .tabs-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .tab-btn {
    border: none;
    background: transparent;
    color: var(--ms-fg-muted);
    padding: 5px 10px;
    border-radius: var(--ms-radius-sm);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .tab-btn span {
    font-size: 11px;
    color: var(--ms-fg-faint);
  }

  .tab-btn.active {
    background: var(--ms-surface);
    color: var(--ms-accent);
    box-shadow: var(--ms-shadow-sm);
  }

  .tab-btn.active span {
    color: var(--ms-accent);
  }

  .new-btn {
    margin-left: auto;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--ms-accent);
    border-radius: 6px;
    background: var(--ms-accent-soft);
    color: var(--ms-accent);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .new-btn:hover {
    background: var(--ms-accent);
    color: var(--ms-accent-fg);
  }

  .filter-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .pill {
    border: 1px solid var(--ms-border);
    background: var(--ms-surface);
    color: var(--ms-fg-muted);
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 11.5px;
    cursor: pointer;
  }

  .pill.active {
    border-color: var(--ms-accent);
    background: var(--ms-accent-soft);
    color: var(--ms-accent);
    font-weight: 500;
  }

  .palette-list {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px 14px;
  }

  .cmd-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(144px, 1fr));
    gap: 7px;
  }

  .cmd-tile {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--ms-border-subtle);
    border-radius: var(--ms-radius-md);
    background: var(--ms-tile);
    color: var(--ms-fg);
    cursor: pointer;
    text-align: left;
    transition: border-color 90ms ease, background-color 90ms ease;
  }

  .cmd-tile.selected,
  .cmd-tile:hover {
    border-color: var(--ms-accent);
    background: var(--ms-tile-hover);
  }

  .cmd-math {
    min-height: 28px;
    display: flex;
    align-items: center;
    font-size: 15px;
    overflow: hidden;
  }

  .cmd-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .cmd-name {
    font-size: 12px;
    color: var(--ms-fg-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cmd-keys {
    display: inline-flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .cmd-keys kbd {
    font-family: var(--ms-font-mono);
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 4px;
    border: 1px solid var(--ms-keycap-border);
    background: var(--ms-keycap-bg);
    color: var(--ms-keycap-fg);
  }

  .preset-row {
    width: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 11px;
    border: 1px solid transparent;
    border-radius: var(--ms-radius-md);
    background: transparent;
    color: var(--ms-fg);
    cursor: pointer;
    text-align: left;
  }

  .preset-row.selected,
  .preset-row:hover {
    background: var(--ms-tile);
    border-color: var(--ms-border-subtle);
  }

  .preset-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 140px;
  }

  .preset-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--ms-fg);
  }

  .preset-cat {
    font-size: 11px;
    color: var(--ms-fg-faint);
  }

  .preset-math {
    font-size: 13.5px;
    overflow-x: auto;
    max-width: 360px;
    white-space: nowrap;
  }

  .snip-main {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
    padding: 0;
    min-width: 0;
  }

  .row-actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .row-btn {
    border: 1px solid var(--ms-border);
    background: var(--ms-surface);
    color: var(--ms-fg-muted);
    font-size: 11px;
    padding: 3px 7px;
    border-radius: 5px;
    cursor: pointer;
  }

  .row-btn:hover {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
  }

  .row-btn.danger:hover {
    border-color: var(--ms-danger);
    background: var(--ms-danger-soft);
    color: var(--ms-danger);
  }

  .rename-input {
    flex: 1;
    height: 30px;
    padding: 0 9px;
    border: 1px solid var(--ms-accent);
    border-radius: 6px;
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-size: 13px;
    outline: none;
  }

  .empty-state {
    padding: 36px 0;
    text-align: center;
    color: var(--ms-fg-muted);
    font-size: 13px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .empty-state p {
    margin: 0;
  }
</style>

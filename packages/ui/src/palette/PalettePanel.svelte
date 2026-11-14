<script lang="ts">
  import type { DispatchResponse, EngineClient } from '../client/engine';
  import type { CommandCategory, CommandEntry } from '../generated/catalog';
  import type { PresetCategory, PresetEntry } from '../generated/presets';
  import {
    COMMAND_CATEGORIES,
    PRESET_CATEGORY_TABS,
    filterCommands,
    filterPresets,
    formatCommandShortcut,
    getFeaturedCommands,
    moveGridIndex,
  } from './paletteModel';

  export interface PalettePanelProps {
    client: EngineClient;
    theme?: 'light' | 'dark' | 'auto';
    initialMode?: 'commands' | 'presets';
    columns?: number;
    onRequestEditorFocus?: () => void;
    onCommandApplied?: (cmd: CommandEntry, response: DispatchResponse) => void;
    onPresetLoaded?: (preset: PresetEntry, response: DispatchResponse) => void;
  }

  let {
    client,
    theme = 'auto',
    initialMode = 'commands',
    columns = 3,
    onRequestEditorFocus,
    onCommandApplied,
    onPresetLoaded,
  }: PalettePanelProps = $props();

  let modeOverride = $state<'commands' | 'presets' | null>(null);
  const mode = $derived(modeOverride ?? initialMode);
  let searchQuery = $state('');
  let commandCategory = $state<'all' | CommandCategory>('all');
  let presetCategory = $state<'all' | PresetCategory>('all');
  let activeCardIndex = $state(0);

  let paletteRoot: HTMLElement | null = null;

  const resolvedThemeAttr = $derived(theme === 'auto' ? undefined : theme);
  const featuredCommands = getFeaturedCommands();
  const filteredCommands = $derived(filterCommands(searchQuery, commandCategory));
  const filteredPresets = $derived(filterPresets(searchQuery, presetCategory));
  const showFeaturedStrip = $derived(
    mode === 'commands' && commandCategory === 'all' && searchQuery.trim() === '',
  );

  async function activateCommand(cmd: CommandEntry): Promise<void> {
    const response = await client.dispatch({ ApplyCard: cmd.id });
    onCommandApplied?.(cmd, response);
    onRequestEditorFocus?.();
  }

  async function activatePreset(preset: PresetEntry): Promise<void> {
    const response = await client.dispatch({ LoadStreamSource: preset.source });
    onPresetLoaded?.(preset, response);
    onRequestEditorFocus?.();
  }

  function handleModeSwitch(nextMode: 'commands' | 'presets'): void {
    modeOverride = nextMode;
    activeCardIndex = 0;
  }

  function focusElementAt(selector: string, index: number): void {
    const items = paletteRoot?.querySelectorAll<HTMLButtonElement>(selector);
    items?.[index]?.focus();
  }

  function handleCategoryTabKeydown(
    evt: KeyboardEvent,
    index: number,
    total: number,
    selectAt: (nextIdx: number) => void,
  ): void {
    let nextIdx: number | null = null;
    if (evt.key === 'ArrowRight') {
      nextIdx = (index + 1) % total;
    } else if (evt.key === 'ArrowLeft') {
      nextIdx = (index - 1 + total) % total;
    } else if (evt.key === 'Home') {
      nextIdx = 0;
    } else if (evt.key === 'End') {
      nextIdx = total - 1;
    }

    if (nextIdx === null) return;
    evt.preventDefault();
    selectAt(nextIdx);
    activeCardIndex = 0;
    focusElementAt('.ms-category-tabs .ms-category-tab', nextIdx);
  }

  function handleGridCardKeydown(
    evt: KeyboardEvent,
    index: number,
    total: number,
    selector: string,
    onActivate: () => void,
  ): void {
    if (evt.key === 'Enter' || evt.key === ' ') {
      evt.preventDefault();
      activeCardIndex = index;
      onActivate();
      return;
    }
    const nextIdx = moveGridIndex(index, evt.key, total, columns);
    if (nextIdx === null) return;
    evt.preventDefault();
    activeCardIndex = nextIdx;
    focusElementAt(selector, nextIdx);
  }
</script>

<section
  bind:this={paletteRoot}
  class="ms-palette-shell"
  data-testid="mathslot-palette"
  data-theme={resolvedThemeAttr}
  aria-label="MathSlot 命令与预置调色板"
>
  <header class="ms-palette-header">
    <div class="ms-mode-tabs" role="tablist" aria-label="调色板模式">
      <button
        type="button"
        role="tab"
        class="ms-mode-tab"
        aria-selected={mode === 'commands'}
        data-palette-mode="commands"
        onclick={() => handleModeSwitch('commands')}
      >
        命令目录 (121)
      </button>
      <button
        type="button"
        role="tab"
        class="ms-mode-tab"
        aria-selected={mode === 'presets'}
        data-palette-mode="presets"
        onclick={() => handleModeSwitch('presets')}
      >
        预置公式 (88)
      </button>
    </div>

    <div class="ms-search-wrap">
      <input
        type="search"
        class="ms-search-input"
        placeholder={mode === 'commands'
          ? '搜索命令、简码 (如 oc / frac) 或 LaTeX…'
          : '搜索预置公式、分类或简码…'}
        aria-label="搜索命令或预置"
        value={searchQuery}
        oninput={(evt) => {
          searchQuery = (evt.currentTarget as HTMLInputElement).value;
          activeCardIndex = 0;
        }}
      />
      {#if searchQuery.length > 0}
        <button
          type="button"
          class="ms-search-clear"
          aria-label="清空搜索"
          onclick={() => {
            searchQuery = '';
            activeCardIndex = 0;
          }}
        >
          清空
        </button>
      {/if}
    </div>
  </header>

  {#if mode === 'commands'}
    <div class="ms-category-tabs" role="tablist" aria-label="命令分类">
      {#each COMMAND_CATEGORIES as cat, idx (cat.id)}
        <button
          type="button"
          role="tab"
          class="ms-category-tab"
          data-category={cat.id}
          aria-selected={commandCategory === cat.id}
          tabindex={commandCategory === cat.id ? 0 : -1}
          onclick={() => {
            commandCategory = cat.id;
            activeCardIndex = 0;
          }}
          onkeydown={(evt) =>
            handleCategoryTabKeydown(evt, idx, COMMAND_CATEGORIES.length, (nextIdx) => {
              const targetCat = COMMAND_CATEGORIES[nextIdx];
              if (targetCat) commandCategory = targetCat.id;
            })}
        >
          {cat.label}
        </button>
      {/each}
    </div>

    {#if showFeaturedStrip}
      <div class="ms-featured-strip" aria-label="核心高频卡片 (D-001)">
        <span class="ms-featured-title">高频直达</span>
        <div class="ms-featured-list">
          {#each featuredCommands as cmd (cmd.id)}
            <button
              type="button"
              class="ms-featured-chip"
              data-featured-card={cmd.id}
              aria-label={`快捷卡片 ${cmd.label} ${formatCommandShortcut(cmd)}`}
              onclick={() => activateCommand(cmd)}
            >
              <span class="ms-card-glyph" aria-hidden="true">{cmd.glyph}</span>
              <span>{cmd.label}</span>
              <kbd class="ms-kbd">{formatCommandShortcut(cmd)}</kbd>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="ms-palette-meta">
      <span>显示 {filteredCommands.length} / 121 条命令</span>
    </div>

    {#if filteredCommands.length === 0}
      <div class="ms-empty-state" role="status">
        未找到匹配「{searchQuery}」的命令
      </div>
    {:else}
      <div class="ms-palette-scroll" role="region" aria-label="命令卡片列表">
        <div class="ms-card-grid">
          {#each filteredCommands as cmd, idx (cmd.id)}
            <button
              type="button"
              class="ms-command-card"
              data-command-card={cmd.id}
              data-category={cmd.category}
              tabindex={idx === activeCardIndex ? 0 : -1}
              aria-label={`${cmd.label} ${formatCommandShortcut(cmd)} ${cmd.latex}`}
              title={`${cmd.label} (${cmd.latex}) — ${cmd.doc}`}
              onclick={() => {
                activeCardIndex = idx;
                void activateCommand(cmd);
              }}
              onkeydown={(evt) =>
                handleGridCardKeydown(evt, idx, filteredCommands.length, '.ms-command-card', () => {
                  void activateCommand(cmd);
                })}
            >
              <div class="ms-card-top">
                <span class="ms-card-glyph" aria-hidden="true">{cmd.glyph}</span>
                <kbd class="ms-kbd">{formatCommandShortcut(cmd)}</kbd>
              </div>
              <div class="ms-card-label">{cmd.label}</div>
              <div class="ms-card-latex">{cmd.latex}</div>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {:else}
    <div class="ms-category-tabs" role="tablist" aria-label="预置分类">
      {#each PRESET_CATEGORY_TABS as cat, idx (cat.id)}
        <button
          type="button"
          role="tab"
          class="ms-category-tab"
          data-category={cat.id}
          aria-selected={presetCategory === cat.id}
          tabindex={presetCategory === cat.id ? 0 : -1}
          onclick={() => {
            presetCategory = cat.id;
            activeCardIndex = 0;
          }}
          onkeydown={(evt) =>
            handleCategoryTabKeydown(evt, idx, PRESET_CATEGORY_TABS.length, (nextIdx) => {
              const targetCat = PRESET_CATEGORY_TABS[nextIdx];
              if (targetCat) presetCategory = targetCat.id;
            })}
        >
          {cat.label}
        </button>
      {/each}
    </div>

    <div class="ms-palette-meta">
      <span>显示 {filteredPresets.length} / 88 条预置</span>
    </div>

    {#if filteredPresets.length === 0}
      <div class="ms-empty-state" role="status">
        未找到匹配「{searchQuery}」的预置公式
      </div>
    {:else}
      <div class="ms-palette-scroll" role="region" aria-label="预置公式列表">
        <div class="ms-preset-grid">
          {#each filteredPresets as preset, idx (preset.id)}
            <button
              type="button"
              class="ms-preset-card"
              data-preset-card={preset.id}
              data-category={preset.category}
              tabindex={idx === activeCardIndex ? 0 : -1}
              aria-label={`载入预置 ${preset.name}（${preset.category}）`}
              onclick={() => {
                activeCardIndex = idx;
                void activatePreset(preset);
              }}
              onkeydown={(evt) =>
                handleGridCardKeydown(evt, idx, filteredPresets.length, '.ms-preset-card', () => {
                  void activatePreset(preset);
                })}
            >
              <div class="ms-preset-head">
                <span class="ms-preset-name">{preset.name}</span>
                <span class="ms-preset-cat">{preset.category}</span>
              </div>
              <div class="ms-preset-desc">{preset.desc}</div>
              <code class="ms-preset-source">{preset.source}</code>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  .ms-palette-shell {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-family: var(--ms-font-sans);
    box-shadow: var(--ms-shadow-sm);
  }

  .ms-palette-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }

  .ms-mode-tabs {
    display: inline-flex;
    gap: 4px;
    padding: 3px;
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface-elevated);
    border: 1px solid var(--ms-border);
  }

  .ms-mode-tab {
    padding: 5px 10px;
    border: 1px solid transparent;
    border-radius: var(--ms-radius-sm);
    background: transparent;
    color: var(--ms-fg-muted);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .ms-mode-tab[aria-selected='true'] {
    background: var(--ms-surface);
    color: var(--ms-accent-fg);
    border-color: var(--ms-border-strong);
    box-shadow: var(--ms-shadow-sm);
  }

  .ms-search-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 220px;
    min-width: 180px;
  }

  .ms-search-input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    color: var(--ms-fg);
    font-family: var(--ms-font-sans);
    font-size: 0.85rem;
  }

  .ms-search-clear {
    padding: 5px 8px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface-elevated);
    color: var(--ms-fg-muted);
    font-size: 0.78rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .ms-category-tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .ms-category-tab {
    padding: 4px 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-pill);
    background: var(--ms-surface);
    color: var(--ms-fg-muted);
    font-size: 0.76rem;
    font-weight: 500;
    cursor: pointer;
  }

  .ms-category-tab[aria-selected='true'] {
    background: var(--ms-accent-soft);
    border-color: var(--ms-accent);
    color: var(--ms-accent-fg);
    font-weight: 600;
  }

  .ms-featured-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 6px 8px;
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface-elevated);
    border: 1px solid var(--ms-border);
  }

  .ms-featured-title {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--ms-fg-subtle);
  }

  .ms-featured-list {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .ms-featured-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    color: var(--ms-fg);
    font-size: 0.78rem;
    cursor: pointer;
  }

  .ms-palette-meta {
    font-size: 0.74rem;
    color: var(--ms-fg-subtle);
  }

  .ms-palette-scroll {
    max-height: var(--ms-palette-max-height, 360px);
    overflow-y: auto;
    padding: 2px;
  }

  .ms-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(152px, 1fr));
    gap: 8px;
  }

  .ms-command-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 8px 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    color: var(--ms-fg);
    text-align: left;
    cursor: pointer;
    transition: border-color 120ms ease, background-color 120ms ease;
  }

  .ms-command-card:hover,
  .ms-preset-card:hover,
  .ms-featured-chip:hover {
    background: var(--ms-card-hover-bg);
    border-color: var(--ms-accent);
  }

  .ms-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .ms-card-glyph {
    font-family: var(--ms-font-mono);
    font-size: 1rem;
    font-weight: 700;
    color: var(--ms-accent-fg);
  }

  .ms-kbd {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border: 1px solid var(--ms-kbd-border);
    border-radius: 4px;
    background: var(--ms-kbd-bg);
    color: var(--ms-kbd-fg);
    font-family: var(--ms-font-mono);
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.4;
  }

  .ms-card-label {
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--ms-fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ms-card-latex {
    font-family: var(--ms-font-mono);
    font-size: 0.72rem;
    color: var(--ms-fg-subtle);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ms-preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 8px;
  }

  .ms-preset-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 5px;
    padding: 10px 12px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    color: var(--ms-fg);
    text-align: left;
    cursor: pointer;
  }

  .ms-preset-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .ms-preset-name {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--ms-fg);
  }

  .ms-preset-cat {
    padding: 1px 7px;
    border-radius: var(--ms-radius-pill);
    background: var(--ms-surface-elevated);
    border: 1px solid var(--ms-border);
    color: var(--ms-fg-muted);
    font-size: 0.7rem;
    white-space: nowrap;
  }

  .ms-preset-desc {
    font-size: 0.76rem;
    color: var(--ms-fg-muted);
    line-height: 1.35;
  }

  .ms-preset-source {
    padding: 3px 6px;
    border-radius: 4px;
    background: var(--ms-surface-elevated);
    color: var(--ms-cmd-fg);
    font-family: var(--ms-font-mono);
    font-size: 0.72rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ms-empty-state {
    padding: 18px;
    text-align: center;
    border: 1px dashed var(--ms-border);
    border-radius: var(--ms-radius-sm);
    color: var(--ms-fg-muted);
    font-size: 0.84rem;
  }

  .ms-mode-tab:focus-visible,
  .ms-search-input:focus-visible,
  .ms-search-clear:focus-visible,
  .ms-category-tab:focus-visible,
  .ms-featured-chip:focus-visible,
  .ms-command-card:focus-visible,
  .ms-preset-card:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: 2px;
  }

  @media (max-width: 480px) {
    .ms-palette-shell {
      padding: 8px;
    }

    .ms-palette-header {
      flex-direction: column;
      align-items: stretch;
    }

    .ms-mode-tabs {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .ms-search-wrap {
      min-width: 0;
      width: 100%;
    }

    .ms-mode-tab,
    .ms-search-clear,
    .ms-category-tab,
    .ms-featured-chip,
    .ms-command-card,
    .ms-preset-card {
      min-height: 36px;
    }

    .ms-card-grid,
    .ms-preset-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

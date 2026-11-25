<script lang="ts">
  import { onMount } from 'svelte';
  import {
    CATEGORY_LABELS,
    COMMANDS,
    PRESETS,
    SHORTHAND_BY_COMMAND_ID,
    commandPreviewLatex,
    importFormula,
    toLatex,
    type CommandCategory,
    type CommandDef,
    type CustomCommandDef,
    type HistoryFormula,
    type LeaderKey,
    type PresetFormula,
    type Snippet,
  } from '@mathslot/core';
  import { renderLatexPreview } from '../katexRenderer';
  import { focusTrap } from '../focusTrap';

  type DrawerTab = 'all' | 'commands' | 'presets' | 'snippets' | 'custom' | 'history';

  interface Props {
    leaderKey: LeaderKey;
    commands?: readonly CommandDef[];
    presets?: readonly PresetFormula[];
    snippets: Snippet[];
    customCommands: CustomCommandDef[];
    history?: HistoryFormula[];
    favoriteIds?: readonly string[];
    recentIds?: readonly string[];
    initialTab?: DrawerTab;
    onInsertCommand: (commandId: string) => void;
    onInsertSnippet?: (snippet: Snippet) => void;
    onLoadFormula: (source: string, presetId?: string) => void;
    onToggleFavorite?: (favKey: string) => void;
    onCreatePreset?: () => void;
    onEditPreset?: (preset: PresetFormula) => void;
    onDeletePreset?: (id: string) => void;
    onCreateCommand?: () => void;
    onEditCommand?: (cmd: CommandDef) => void;
    onOpenConfigDir?: () => void;
    onReloadLibraries?: () => void;
    onRenameSnippet: (id: string, nextName: string) => void;
    onDeleteSnippet: (id: string) => void;
    onCreateCustom: () => void;
    onEditCustom: (cmd: CustomCommandDef) => void;
    onDeleteCustom: (id: string) => void;
    onClearHistory?: () => void;
    onClose: () => void;
  }

  let {
    leaderKey,
    commands = COMMANDS,
    presets = PRESETS,
    snippets,
    customCommands,
    history = [],
    favoriteIds = [],
    recentIds = [],
    initialTab = 'all',
    onInsertCommand,
    onInsertSnippet,
    onLoadFormula,
    onToggleFavorite,
    onCreatePreset,
    onEditPreset,
    onDeletePreset,
    onCreateCommand,
    onEditCommand,
    onOpenConfigDir,
    onReloadLibraries,
    onRenameSnippet,
    onDeleteSnippet,
    onCreateCustom,
    onEditCustom,
    onDeleteCustom,
    onClearHistory,
    onClose,
  }: Props = $props();

  let tab = $state<DrawerTab>('all');
  $effect(() => {
    tab = initialTab;
  });
  let query = $state('');
  let selectedCategory = $state<CommandCategory | 'all' | 'favorites'>('all');
  let selectedPresetCat = $state<string>('all');
  let showAllPresetsInAll = $state(false);
  let activeIndex = $state(0);
  let renamingSnippetId = $state<string | null>(null);
  let renameDraft = $state('');
  let searchInputEl: HTMLInputElement | null = $state(null);

  const favSet = $derived(new Set(favoriteIds));
  const presetCategories = $derived(Array.from(new Set(presets.map((p) => p.category))));

  const filteredCommands = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? commands.filter((c) => {
          const keySeq = c.keys.join('').toLowerCase();
          const shorthand = (c.shorthand ?? SHORTHAND_BY_COMMAND_ID.get(c.id))?.toLowerCase() ?? '';
          return (
            c.id.toLowerCase().includes(q) ||
            c.label.toLowerCase().includes(q) ||
            keySeq.includes(q) ||
            c.latex.toLowerCase().includes(q) ||
            c.glyph.toLowerCase().includes(q) ||
            c.doc.toLowerCase().includes(q) ||
            shorthand.includes(q)
          );
        })
      : [...commands].filter((c) => c.id !== 'inline_math');
    if (selectedCategory === 'all') return base;
    if (selectedCategory === 'favorites') return base.filter((c) => favSet.has(`cmd:${c.id}`));
    return base.filter((c) => c.category === selectedCategory);
  });

  const filteredPresets = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? presets.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.category.toLowerCase().includes(q) ||
            p.desc.toLowerCase().includes(q) ||
            p.source.toLowerCase().includes(q) ||
            p.tags.some((t) => t.toLowerCase().includes(q)),
        )
      : [...presets];
    if (selectedPresetCat === 'all') return base;
    if (selectedPresetCat === '__favorites__') {
      return base.filter((p) => favSet.has(`preset:${p.id}`));
    }
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

  const filteredHistory = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => h.latex.toLowerCase().includes(q));
  });

  type UnifiedEntry =
    | { kind: 'preset'; item: PresetFormula }
    | { kind: 'command'; item: CommandDef }
    | { kind: 'snippet'; item: Snippet }
    | { kind: 'custom'; item: CustomCommandDef }
    | { kind: 'history'; item: HistoryFormula };

  const favoriteCommands = $derived(
    commands.filter((c) => c.id !== 'inline_math' && favSet.has(`cmd:${c.id}`)),
  );
  const favoritePresets = $derived(presets.filter((p) => favSet.has(`preset:${p.id}`)));
  const recentCommands = $derived.by(() => {
    const out: CommandDef[] = [];
    for (const r of recentIds) {
      if (!r.startsWith('cmd:') || favSet.has(r)) continue;
      const id = r.slice(4);
      const found = commands.find((c) => c.id === id && c.id !== 'inline_math');
      if (found) out.push(found);
      if (out.length >= 6) break;
    }
    return out;
  });

  const allPresetsShown = $derived(
    query.trim() || showAllPresetsInAll ? filteredPresets : filteredPresets.slice(0, 8),
  );

  const unifiedEntries = $derived.by<UnifiedEntry[]>(() => {
    const out: UnifiedEntry[] = [];
    if (!query.trim()) {
      for (const item of favoriteCommands) out.push({ kind: 'command', item });
      for (const item of favoritePresets) out.push({ kind: 'preset', item });
      for (const item of recentCommands) out.push({ kind: 'command', item });
    }
    for (const item of filteredSnippets) out.push({ kind: 'snippet', item });
    for (const item of filteredCustom) out.push({ kind: 'custom', item });
    if (query.trim()) {
      for (const item of filteredCommands) out.push({ kind: 'command', item });
      for (const item of allPresetsShown) out.push({ kind: 'preset', item });
      for (const item of filteredHistory) out.push({ kind: 'history', item });
    } else {
      for (const item of allPresetsShown) out.push({ kind: 'preset', item });
      for (const item of filteredCommands) out.push({ kind: 'command', item });
    }
    return out;
  });

  const unifiedOffsets = $derived.by(() => {
    const favCmdStart = 0;
    const favPresetStart = !query.trim() ? favoriteCommands.length : 0;
    const recentCmdStart = !query.trim() ? favPresetStart + favoritePresets.length : 0;
    const snipStart = !query.trim() ? recentCmdStart + recentCommands.length : 0;
    const customStart = snipStart + filteredSnippets.length;
    if (query.trim()) {
      const cmdStart = customStart + filteredCustom.length;
      const presetStart = cmdStart + filteredCommands.length;
      const histStart = presetStart + allPresetsShown.length;
      return {
        favCmdStart,
        favPresetStart,
        recentCmdStart,
        snipStart,
        customStart,
        presetStart,
        cmdStart,
        histStart,
      };
    }
    const presetStart = customStart + filteredCustom.length;
    const cmdStart = presetStart + allPresetsShown.length;
    const histStart = cmdStart + filteredCommands.length;
    return {
      favCmdStart,
      favPresetStart,
      recentCmdStart,
      snipStart,
      customStart,
      presetStart,
      cmdStart,
      histStart,
    };
  });

  const totalAllCount = $derived(
    filteredCommands.length +
      filteredPresets.length +
      filteredSnippets.length +
      filteredCustom.length +
      (query.trim() ? filteredHistory.length : 0),
  );

  const currentCount = $derived(
    tab === 'all'
      ? unifiedEntries.length
      : tab === 'commands'
        ? filteredCommands.length
        : tab === 'presets'
          ? filteredPresets.length
          : tab === 'snippets'
            ? filteredSnippets.length
            : tab === 'custom'
              ? filteredCustom.length
              : filteredHistory.length,
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

  const presetLatexCache = new Map<string, string>();
  function presetLatex(source: string): string {
    const cached = presetLatexCache.get(source);
    if (cached !== undefined) return cached;
    const res = importFormula(source);
    const out = toLatex(res.doc);
    presetLatexCache.set(source, out);
    return out;
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
      if (tab === 'all') {
        const entry = unifiedEntries[activeIndex];
        if (!entry) return;
        if (entry.kind === 'command') onInsertCommand(entry.item.id);
        else if (entry.kind === 'preset') onLoadFormula(entry.item.source, entry.item.id);
        else if (entry.kind === 'snippet') {
          if (onInsertSnippet) onInsertSnippet(entry.item);
          else onLoadFormula(entry.item.latex);
        } else if (entry.kind === 'custom') onInsertCommand(entry.item.id);
        else onLoadFormula(entry.item.latex);
        onClose();
      } else if (tab === 'commands') {
        const item = filteredCommands[activeIndex];
        if (item) {
          onInsertCommand(item.id);
          onClose();
        }
      } else if (tab === 'presets') {
        const item = filteredPresets[activeIndex];
        if (item) {
          onLoadFormula(item.source, item.id);
          onClose();
        }
      } else if (tab === 'snippets') {
        const item = filteredSnippets[activeIndex];
        if (item) {
          if (onInsertSnippet) onInsertSnippet(item);
          else onLoadFormula(item.latex);
          onClose();
        }
      } else if (tab === 'custom') {
        const item = filteredCustom[activeIndex];
        if (item) {
          onInsertCommand(item.id);
          onClose();
        }
      } else {
        const item = filteredHistory[activeIndex];
        if (item) {
          onLoadFormula(item.latex);
          onClose();
        }
      }
    }
  }
</script>

{#snippet commandMeta(cmd: CommandDef)}
  {@const shorthand = cmd.shorthand ?? SHORTHAND_BY_COMMAND_ID.get(cmd.id)}
  <div class="cmd-meta">
    <span class="cmd-name" title={cmd.label}>{cmd.label}</span>
    <span class="cmd-badges">
      {#if shorthand}
        <span
          class="cmd-short"
          title={`直输简写：${shorthand}（结构/标点即时生效，字母词需空格或符号边界）`}
        >
          {shorthand}
        </span>
      {/if}
      {#if cmd.keys.length > 0}
        <span class="cmd-keys">
          <kbd>{leaderKey}</kbd>
          {#each cmd.keys as k}
            <kbd>{k}</kbd>
          {/each}
        </span>
      {/if}
    </span>
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }} onkeydown={handleKeyDown}>
  <div class="palette" role="dialog" aria-modal="true" aria-label="命令与公式库" use:focusTrap>
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
        <button type="button" class="tab-btn" class:active={tab === 'all'} onclick={() => (tab = 'all')}>
          全部 <span>{totalAllCount}</span>
        </button>
        <button type="button" class="tab-btn" class:active={tab === 'commands'} onclick={() => (tab = 'commands')}>
          命令 <span>{filteredCommands.length}</span>
        </button>
        <button type="button" class="tab-btn" class:active={tab === 'presets'} onclick={() => (tab = 'presets')}>
          公式库 <span>{filteredPresets.length}</span>
        </button>
        <button type="button" class="tab-btn" class:active={tab === 'snippets'} onclick={() => (tab = 'snippets')}>
          片段 <span>{filteredSnippets.length}</span>
        </button>
        <button type="button" class="tab-btn" class:active={tab === 'custom'} onclick={() => (tab = 'custom')}>
          自定义结构 <span>{filteredCustom.length}</span>
        </button>
        <button type="button" class="tab-btn" class:active={tab === 'history'} onclick={() => (tab = 'history')}>
          历史 <span>{filteredHistory.length}</span>
        </button>
        <div class="tabs-actions">
          {#if (tab === 'commands' || tab === 'presets') && onOpenConfigDir}
            <button type="button" class="util-btn" title="打开 presets.json / commands.json 所在目录" onclick={onOpenConfigDir}>
              目录
            </button>
          {/if}
          {#if (tab === 'commands' || tab === 'presets') && onReloadLibraries}
            <button type="button" class="util-btn" title="从配置文件重新加载" onclick={onReloadLibraries}>
              重载
            </button>
          {/if}
          {#if tab === 'commands' && onCreateCommand}
            <button
              type="button"
              class="new-btn"
              onclick={() => {
                onClose();
                onCreateCommand();
              }}
            >
              + 添加
            </button>
          {:else if tab === 'presets' && onCreatePreset}
            <button
              type="button"
              class="new-btn"
              onclick={() => {
                onClose();
                onCreatePreset();
              }}
            >
              + 添加
            </button>
          {:else if tab === 'custom'}
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
          {:else if tab === 'history' && history.length > 0 && onClearHistory}
            <button type="button" class="new-btn" onclick={onClearHistory}>
              清空
            </button>
          {/if}
        </div>
      </div>

      {#if tab === 'commands'}
        <div class="filter-pills">
          <button type="button" class="pill" class:active={selectedCategory === 'all'} onclick={() => (selectedCategory = 'all')}>
            全部
          </button>
          {#if favoriteCommands.length > 0}
            <button
              type="button"
              class="pill"
              class:active={selectedCategory === 'favorites'}
              onclick={() => (selectedCategory = 'favorites')}
            >
              ★ 收藏 ({favoriteCommands.length})
            </button>
          {/if}
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
          {#if favoritePresets.length > 0}
            <button
              type="button"
              class="pill"
              class:active={selectedPresetCat === '__favorites__'}
              onclick={() => (selectedPresetCat = '__favorites__')}
            >
              ★ 收藏 ({favoritePresets.length})
            </button>
          {/if}
          {#each presetCategories as cat (cat)}
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
      {#if tab === 'all'}
        {#if unifiedEntries.length === 0}
          <div class="empty-state">未找到匹配「{query}」的命令、公式或片段</div>
        {:else}
          {#if !query.trim() && (favoriteCommands.length > 0 || favoritePresets.length > 0)}
            <div class="all-section">
              <div class="sec-head">
                <span>★ 常用收藏</span>
                <span class="sec-count">{favoriteCommands.length + favoritePresets.length}</span>
              </div>
              {#if favoriteCommands.length > 0}
                <div class="cmd-grid" style="margin-bottom: 6px;">
                  {#each favoriteCommands as cmd, idx (cmd.id)}
                    {@const uIdx = unifiedOffsets.favCmdStart + idx}
                    <div class="cmd-tile-wrap" class:selected={uIdx === activeIndex}>
                      <button
                        type="button"
                        class="cmd-tile"
                        onmouseenter={() => (activeIndex = uIdx)}
                        onclick={() => {
                          onInsertCommand(cmd.id);
                          onClose();
                        }}
                      >
                        <div class="cmd-math">
                          {@html renderLatexPreview(commandPreviewLatex(cmd.latex), false)}
                        </div>
                        {@render commandMeta(cmd)}
                      </button>
                      {#if onToggleFavorite}
                        <button
                          type="button"
                          class="cmd-fav-btn is-fav"
                          title="取消收藏"
                          aria-label="取消收藏"
                          onclick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(`cmd:${cmd.id}`);
                          }}
                        >
                          ★
                        </button>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
              {#each favoritePresets as preset, idx (preset.id)}
                {@const uIdx = unifiedOffsets.favPresetStart + idx}
                <div class="preset-row" class:selected={uIdx === activeIndex}>
                  <button
                    type="button"
                    class="snip-main"
                    onmouseenter={() => (activeIndex = uIdx)}
                    onclick={() => {
                      onLoadFormula(preset.source, preset.id);
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
                  {#if onToggleFavorite}
                    <button
                      type="button"
                      class="fav-row-btn is-fav"
                      title="取消收藏"
                      onclick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(`preset:${preset.id}`);
                      }}
                    >
                      ★
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          {#if !query.trim() && recentCommands.length > 0}
            <div class="all-section">
              <div class="sec-head">
                <span>最近使用</span>
                <span class="sec-count">{recentCommands.length}</span>
              </div>
              <div class="cmd-grid">
                {#each recentCommands as cmd, idx (cmd.id)}
                  {@const uIdx = unifiedOffsets.recentCmdStart + idx}
                  <div class="cmd-tile-wrap" class:selected={uIdx === activeIndex}>
                    <button
                      type="button"
                      class="cmd-tile"
                      onmouseenter={() => (activeIndex = uIdx)}
                      onclick={() => {
                        onInsertCommand(cmd.id);
                        onClose();
                      }}
                    >
                      <div class="cmd-math">
                        {@html renderLatexPreview(commandPreviewLatex(cmd.latex), false)}
                      </div>
                      {@render commandMeta(cmd)}
                    </button>
                    {#if onToggleFavorite}
                      <button
                        type="button"
                        class="cmd-fav-btn"
                        class:is-fav={favSet.has(`cmd:${cmd.id}`)}
                        title="收藏命令"
                        aria-label="收藏命令"
                        onclick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(`cmd:${cmd.id}`);
                        }}
                      >
                        {favSet.has(`cmd:${cmd.id}`) ? '★' : '☆'}
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#if filteredSnippets.length > 0}
            <div class="all-section">
              <div class="sec-head">
                <span>复用片段</span>
                <span class="sec-count">{filteredSnippets.length}</span>
              </div>
              {#each filteredSnippets as snip, idx (snip.id)}
                {@const uIdx = unifiedOffsets.snipStart + idx}
                <div class="preset-row" class:selected={uIdx === activeIndex}>
                  <button
                    type="button"
                    class="snip-main"
                    onmouseenter={() => (activeIndex = uIdx)}
                    onclick={() => {
                      if (onInsertSnippet) onInsertSnippet(snip);
                      else onLoadFormula(snip.latex);
                      onClose();
                    }}
                  >
                    <div class="preset-info">
                      <span class="preset-name">{snip.name}</span>
                      {#if snip.key}
                        <span class="cmd-keys">
                          <kbd>{leaderKey}</kbd><kbd>t</kbd><kbd>{snip.key}</kbd>
                        </span>
                      {/if}
                    </div>
                    <span class="preset-math">{@html renderLatexPreview(snip.latex, false)}</span>
                  </button>
                </div>
              {/each}
            </div>
          {/if}

          {#if filteredCustom.length > 0}
            <div class="all-section">
              <div class="sec-head">
                <span>自定义结构</span>
                <span class="sec-count">{filteredCustom.length}</span>
              </div>
              {#each filteredCustom as cmd, idx (cmd.id)}
                {@const uIdx = unifiedOffsets.customStart + idx}
                <div class="preset-row" class:selected={uIdx === activeIndex}>
                  <button
                    type="button"
                    class="snip-main"
                    onmouseenter={() => (activeIndex = uIdx)}
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
                    <span class="preset-math">{@html renderLatexPreview(commandPreviewLatex(cmd.latex), false)}</span>
                  </button>
                </div>
              {/each}
            </div>
          {/if}

          {#if query.trim() && filteredCommands.length > 0}
            <div class="all-section">
              <div class="sec-head">
                <span>命令与符号</span>
                <span class="sec-count">{filteredCommands.length}</span>
              </div>
              <div class="cmd-grid">
                {#each filteredCommands as cmd, idx (cmd.id)}
                  {@const uIdx = unifiedOffsets.cmdStart + idx}
                  <div class="cmd-tile-wrap" class:selected={uIdx === activeIndex}>
                    <button
                      type="button"
                      class="cmd-tile"
                      onmouseenter={() => (activeIndex = uIdx)}
                      onclick={() => {
                        onInsertCommand(cmd.id);
                        onClose();
                      }}
                    >
                      <div class="cmd-math">
                        {@html renderLatexPreview(commandPreviewLatex(cmd.latex), false)}
                      </div>
                      {@render commandMeta(cmd)}
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#if allPresetsShown.length > 0}
            <div class="all-section">
              <div class="sec-head">
                <span>预置公式库</span>
                <span class="sec-count">{allPresetsShown.length} / {filteredPresets.length}</span>
                {#if !query.trim() && filteredPresets.length > 8}
                  <button
                    type="button"
                    class="sec-more"
                    onclick={() => (showAllPresetsInAll = !showAllPresetsInAll)}
                  >
                    {showAllPresetsInAll ? '收起至前 8 条' : `展开全部 ${filteredPresets.length} 条`}
                  </button>
                {/if}
              </div>
              {#each allPresetsShown as preset, idx (preset.id)}
                {@const uIdx = unifiedOffsets.presetStart + idx}
                <div class="preset-row" class:selected={uIdx === activeIndex}>
                  <button
                    type="button"
                    class="snip-main"
                    onmouseenter={() => (activeIndex = uIdx)}
                    onclick={() => {
                      onLoadFormula(preset.source, preset.id);
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
                  {#if onToggleFavorite}
                    <button
                      type="button"
                      class="fav-row-btn"
                      class:is-fav={favSet.has(`preset:${preset.id}`)}
                      title={favSet.has(`preset:${preset.id}`) ? '取消收藏' : '收藏公式'}
                      onclick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(`preset:${preset.id}`);
                      }}
                    >
                      {favSet.has(`preset:${preset.id}`) ? '★' : '☆'}
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          {#if !query.trim() && filteredCommands.length > 0}
            <div class="all-section">
              <div class="sec-head">
                <span>命令与符号</span>
                <span class="sec-count">{filteredCommands.length}</span>
              </div>
              <div class="cmd-grid">
                {#each filteredCommands as cmd, idx (cmd.id)}
                  {@const uIdx = unifiedOffsets.cmdStart + idx}
                  <div class="cmd-tile-wrap" class:selected={uIdx === activeIndex}>
                    <button
                      type="button"
                      class="cmd-tile"
                      onmouseenter={() => (activeIndex = uIdx)}
                      onclick={() => {
                        onInsertCommand(cmd.id);
                        onClose();
                      }}
                    >
                      <div class="cmd-math">
                        {@html renderLatexPreview(commandPreviewLatex(cmd.latex), false)}
                      </div>
                      {@render commandMeta(cmd)}
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#if query.trim() && filteredHistory.length > 0}
            <div class="all-section">
              <div class="sec-head">
                <span>历史记录</span>
                <span class="sec-count">{filteredHistory.length}</span>
              </div>
              {#each filteredHistory as item, idx (item.id)}
                {@const uIdx = unifiedOffsets.histStart + idx}
                <button
                  type="button"
                  class="preset-row"
                  class:selected={uIdx === activeIndex}
                  onmouseenter={() => (activeIndex = uIdx)}
                  onclick={() => {
                    onLoadFormula(item.latex);
                    onClose();
                  }}
                >
                  <div class="preset-info">
                    <span class="preset-cat">{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div class="preset-math">
                    {@html renderLatexPreview(item.latex, false)}
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        {/if}
      {:else if tab === 'commands'}
        <div class="cmd-grid">
          {#each filteredCommands as cmd, idx (cmd.id)}
            <div class="cmd-tile-wrap" class:selected={idx === activeIndex}>
              <button
                type="button"
                class="cmd-tile"
                onmouseenter={() => (activeIndex = idx)}
                onclick={() => {
                  onInsertCommand(cmd.id);
                  onClose();
                }}
              >
                <div class="cmd-math">
                  {@html renderLatexPreview(commandPreviewLatex(cmd.latex), false)}
                </div>
                {@render commandMeta(cmd)}
              </button>
                {#if onToggleFavorite}
                  <button
                    type="button"
                    class="cmd-fav-btn"
                    class:is-fav={favSet.has(`cmd:${cmd.id}`)}
                    class:with-edit={Boolean(onEditCommand)}
                    title={favSet.has(`cmd:${cmd.id}`) ? '取消收藏' : '收藏命令'}
                    aria-label={favSet.has(`cmd:${cmd.id}`) ? '取消收藏' : '收藏命令'}
                    onclick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(`cmd:${cmd.id}`);
                    }}
                  >
                    {favSet.has(`cmd:${cmd.id}`) ? '★' : '☆'}
                  </button>
                {/if}
                {#if onEditCommand}
                  <button
                    type="button"
                    class="cmd-edit-btn"
                    title="编辑命令"
                    aria-label="编辑命令"
                    onclick={(e) => {
                      e.stopPropagation();
                      onClose();
                      onEditCommand(cmd);
                    }}
                  >
                    ✎
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {:else if tab === 'presets'}
          {#each filteredPresets as preset, idx (preset.id)}
            <div class="preset-row" class:selected={idx === activeIndex}>
              <button
                type="button"
                class="snip-main"
                onmouseenter={() => (activeIndex = idx)}
                onclick={() => {
                  onLoadFormula(preset.source, preset.id);
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
              <div class="row-actions">
                {#if onToggleFavorite}
                  <button
                    type="button"
                    class="fav-row-btn"
                    class:is-fav={favSet.has(`preset:${preset.id}`)}
                    title={favSet.has(`preset:${preset.id}`) ? '取消收藏' : '收藏公式'}
                    onclick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(`preset:${preset.id}`);
                    }}
                  >
                    {favSet.has(`preset:${preset.id}`) ? '★' : '☆'}
                  </button>
                {/if}
                {#if onEditPreset}
                  <button
                    type="button"
                    class="row-btn"
                    onclick={() => {
                      onClose();
                      onEditPreset(preset);
                    }}
                  >
                    编辑
                  </button>
                {/if}
                {#if onDeletePreset}
                  <button
                    type="button"
                    class="row-btn danger"
                    aria-label="删除或隐藏公式"
                    onclick={() => onDeletePreset(preset.id)}
                  >
                    ✕
                  </button>
                {/if}
              </div>
            </div>
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
                    if (onInsertSnippet) onInsertSnippet(snip);
                    else onLoadFormula(snip.latex);
                    onClose();
                  }}
                >
                  <div class="preset-info">
                    <span class="preset-name">{snip.name}</span>
                    {#if snip.key}
                      <span class="cmd-keys">
                        <kbd>{leaderKey}</kbd><kbd>t</kbd><kbd>{snip.key}</kbd>
                      </span>
                    {/if}
                  </div>
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
      {:else if tab === 'history'}
        {#if filteredHistory.length === 0}
          <div class="empty-state">暂无历史记录</div>
        {:else}
          {#each filteredHistory as item, idx (item.id)}
            <button
              type="button"
              class="preset-row"
              class:selected={idx === activeIndex}
              onmouseenter={() => (activeIndex = idx)}
              onclick={() => {
                onLoadFormula(item.latex);
                onClose();
              }}
            >
              <div class="preset-info">
                <span class="preset-cat">{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div class="preset-math">
                {@html renderLatexPreview(item.latex, false)}
              </div>
            </button>
          {/each}
        {/if}
      {:else if filteredCustom.length === 0}
        <div class="empty-state">
          <p>暂无自定义结构，点击右上角「+ 新建」添加</p>
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
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.34);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: min(6vh, 40px) 14px 16px;
    z-index: 50;
  }

  .palette {
    width: min(710px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-lg);
    box-shadow: var(--ms-shadow-lg), var(--ms-inset-specular);
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

  .search-input:focus-visible {
    outline: none;
  }

  .search-row:focus-within .search-icon {
    color: var(--ms-accent);
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
    border: 1px solid transparent;
    background: transparent;
    color: var(--ms-fg-muted);
    padding: 5px 10px;
    border-radius: 7px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: background-color 110ms var(--ms-ease-out), color 110ms var(--ms-ease-out);
  }

  .tab-btn:hover:not(.active) {
    color: var(--ms-fg);
    background: var(--ms-surface-muted);
  }

  .tab-btn span {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--ms-fg-faint);
  }

  .tab-btn.active {
    background: var(--ms-surface);
    border-color: var(--ms-border-subtle);
    color: var(--ms-accent);
    box-shadow: var(--ms-shadow-sm);
  }

  .tab-btn.active span {
    color: var(--ms-accent);
  }

  .tabs-actions {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .util-btn {
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--ms-border);
    border-radius: 6px;
    background: var(--ms-surface);
    color: var(--ms-fg-muted);
    font-size: 11.5px;
    cursor: pointer;
  }

  .util-btn:hover {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
  }

  .new-btn {
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

  .cmd-tile-wrap {
    position: relative;
    display: flex;
  }

  .cmd-tile-wrap .cmd-tile {
    width: 100%;
  }

  .cmd-tile-wrap.selected .cmd-tile {
    background: var(--ms-tile-hover);
    border-color: var(--ms-accent);
  }

  .cmd-edit-btn {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 20px;
    height: 20px;
    border: 1px solid var(--ms-border);
    border-radius: 5px;
    background: var(--ms-surface);
    color: var(--ms-fg-muted);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 90ms ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .cmd-tile-wrap:hover .cmd-edit-btn,
  .cmd-tile-wrap.selected .cmd-edit-btn {
    opacity: 1;
  }

  .cmd-edit-btn:hover {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
  }

  .cmd-fav-btn {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 20px;
    height: 20px;
    border: 1px solid var(--ms-border);
    border-radius: 5px;
    background: var(--ms-surface);
    color: var(--ms-fg-muted);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 90ms ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .cmd-fav-btn.with-edit {
    right: 28px;
  }

  .cmd-fav-btn.is-fav {
    opacity: 1;
    color: #d97706;
    border-color: rgba(217, 119, 6, 0.35);
  }

  .cmd-tile-wrap:hover .cmd-fav-btn,
  .cmd-tile-wrap.selected .cmd-fav-btn {
    opacity: 1;
  }

  .fav-row-btn {
    border: 1px solid transparent;
    background: transparent;
    color: var(--ms-fg-faint);
    font-size: 13px;
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 5px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .fav-row-btn:hover,
  .fav-row-btn.is-fav {
    color: #d97706;
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

  .all-section + .all-section {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--ms-border-subtle);
  }

  .sec-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px 7px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--ms-fg-muted);
  }

  .sec-count {
    font-family: var(--ms-font-mono);
    font-size: 10.5px;
    color: var(--ms-fg-faint);
  }

  .sec-more {
    margin-left: auto;
    border: none;
    background: transparent;
    color: var(--ms-accent);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    padding: 1px 4px;
    border-radius: 5px;
  }

  .sec-more:hover {
    background: var(--ms-accent-soft);
  }

  .cmd-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(154px, 1fr));
    gap: 7px;
  }

  .cmd-tile {
    height: auto;
    min-height: 76px;
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
    overflow: hidden;
    transition:
      border-color 100ms var(--ms-ease-out),
      background-color 100ms var(--ms-ease-out),
      transform 90ms var(--ms-ease-out);
  }

  .cmd-tile:hover {
    border-color: var(--ms-accent);
    background: var(--ms-tile-hover);
  }

  .cmd-tile:active {
    transform: scale(0.98);
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
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    column-gap: 6px;
    row-gap: 4px;
  }

  .cmd-badges {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    max-width: 100%;
  }

  .cmd-short {
    font-family: var(--ms-font-mono);
    font-size: 10px;
    font-weight: 600;
    line-height: 1.25;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--ms-accent-soft);
    border: 1px solid color-mix(in srgb, var(--ms-accent) 26%, transparent);
    color: var(--ms-accent);
    white-space: nowrap;
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
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 4px;
    border: 1px solid var(--ms-keycap-border);
    box-shadow: var(--ms-keycap-shadow);
    background: var(--ms-keycap-bg);
    color: var(--ms-keycap-fg);
  }

  .preset-row {
    width: 100%;
    height: auto;
    min-height: 46px;
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
    overflow: hidden;
  }

  .preset-row + .preset-row {
    margin-top: 2px;
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
    min-width: 132px;
    max-width: 210px;
    flex-shrink: 0;
  }

  .preset-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--ms-fg);
    white-space: normal;
    line-height: 1.35;
  }

  .preset-cat {
    font-size: 11px;
    color: var(--ms-fg-faint);
  }

  .preset-math {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 390px;
    font-size: 13px;
    line-height: 1.35;
    padding: 4px 2px;
    overflow-x: auto;
    overflow-y: hidden;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    white-space: nowrap;
  }

  .preset-math :global(.katex) {
    font-size: 0.94em;
    flex-shrink: 0;
  }

  .preset-math :global(.katex .mtable) {
    font-size: 0.76em;
  }

  .snip-main {
    flex: 1;
    height: auto;
    min-height: 36px;
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
    overflow: hidden;
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

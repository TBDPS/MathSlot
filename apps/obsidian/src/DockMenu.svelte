<script lang="ts">
  import { setIcon, setTooltip } from 'obsidian';
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
  import { renderLatexPreview } from '@mathslot/ui';

  type RibbonCategory = CommandCategory | 'custom' | 'snippets';

  interface MenuTile {
    id: string;
    keyLabel: string;
    previewLatex?: string;
    iconId?: string;
    tooltip: string;
    isCategory?: boolean;
    isDefault?: boolean;
    isBack?: boolean;
    isHot?: boolean;
    isMatrix?: boolean;
    onClick: () => void;
  }

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
  }: Props = $props();

  const QUICK_ITEMS: readonly { id: string; key: string; preview: string }[] = [
    { id: 'frac', key: 'f', preview: '\\frac{\\square}{\\square}' },
    { id: 'sqrt', key: 'r', preview: '\\sqrt{\\square}' },
    { id: 'subsup', key: 'b', preview: 'x_{\\square}^{\\square}' },
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
    { key: 'c', category: 'calculus', label: '微积分与大算子', preview: '\\partial' },
    { key: 'm', category: 'matrix', label: '矩阵与多行', preview: '[\\cdot]' },
    { key: 'z', category: 'delimiter', label: '定界与狄拉克', preview: '\\langle\\cdot\\rangle' },
    { key: 'a', category: 'accent', label: '顶底标饰', preview: '\\hat{x}' },
    { key: 'h', category: 'font', label: '字体·数域·排版', preview: '\\mathbb{R}' },
    { key: 'y', category: 'arrow', label: '箭头与映射', preview: '\\to' },
    { key: 'o', category: 'symbol', label: '运算与几何', preview: '\\pm' },
    { key: 'x', category: 'relation', label: '等式与不等式', preview: '\\approx' },
    { key: 'q', category: 'setlogic', label: '集合与逻辑', preview: '\\cup' },
    { key: 'g', category: 'greek', label: '希腊字母', preview: '\\alpha' },
    { key: 'k', category: 'custom', label: '自定义结构', preview: '\\star' },
    { key: 't', category: 'snippets', label: '复用片段', preview: '\\sharp' },
  ];

  const KEY_TO_CATEGORY = new Map<string, RibbonCategory>(
    CATEGORY_GROUPS.map((g) => [g.key, g.category]),
  );

  let mouseCategory = $state<RibbonCategory | null>(null);
  let menuEl: HTMLDivElement | null = $state(null);

  const activeCategory = $derived<RibbonCategory | null>(
    leaderActive && leaderPrefix
      ? (KEY_TO_CATEGORY.get(leaderPrefix) ?? null)
      : mouseCategory,
  );

  const activeGroup = $derived(
    CATEGORY_GROUPS.find((g) => g.category === activeCategory) ?? null,
  );

  $effect(() => {
    if (leaderActive) {
      mouseCategory = null;
    }
  });

  function obsidianTooltip(node: HTMLElement, text: string) {
    const apply = (val: string) => {
      node.setAttribute('aria-label', val);
      if (typeof setTooltip === 'function') {
        setTooltip(node, val, { placement: 'top' });
      } else {
        node.title = val;
      }
    };
    apply(text);
    return {
      update(nextText: string) {
        apply(nextText);
      },
    };
  }

  function obsidianIcon(node: HTMLElement, iconId: string | undefined) {
    const apply = (id: string | undefined) => {
      if (!id) return;
      node.textContent = '';
      if (typeof setIcon === 'function') {
        setIcon(node, id);
      } else {
        node.textContent = '←';
      }
    };
    apply(iconId);
    return {
      update(nextId: string | undefined) {
        apply(nextId);
      },
    };
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

  function closeSubmenu(): void {
    if (leaderActive) {
      onLeaderBack?.();
    } else {
      mouseCategory = null;
    }
  }

  function handleWindowPointerDown(e: PointerEvent): void {
    if (!mouseCategory || !menuEl) return;
    if (!menuEl.contains(e.target as Node)) {
      mouseCategory = null;
    }
  }

  function handleWindowKeyDown(e: KeyboardEvent): void {
    if (mouseCategory && e.key === 'Escape') {
      e.preventDefault();
      mouseCategory = null;
    }
  }

  const level1QuickTiles = $derived<MenuTile[]>(
    QUICK_ITEMS.map((item) => {
      const cmd = COMMANDS_BY_ID.get(item.id);
      return {
        id: `q:${item.id}`,
        keyLabel: item.key,
        previewLatex: item.preview,
        tooltip: `${cmd?.label ?? item.id}（${leaderKey} ${item.key}）`,
        isHot: leaderActive && !leaderPrefix,
        onClick: () => pickCommand(item.id),
      };
    }),
  );

  const level1CategoryTiles = $derived<MenuTile[]>(
    CATEGORY_GROUPS.map((grp) => ({
      id: `c:${grp.category}`,
      keyLabel: grp.key,
      previewLatex: grp.preview,
      tooltip: `${grp.label}（${leaderKey} ${grp.key}）`,
      isCategory: true,
      isHot: leaderActive && (!leaderPrefix || leaderPrefix === grp.key),
      onClick: () => clickCategory(grp),
    })),
  );

  const submenuTiles = $derived.by<MenuTile[]>(() => {
    if (!activeCategory || !activeGroup) return [];

    const backTile: MenuTile = {
      id: '__back__',
      keyLabel: 'Esc',
      iconId: 'corner-up-left',
      tooltip: `返回上级（${activeGroup.label} · Esc / Backspace）`,
      isBack: true,
      onClick: closeSubmenu,
    };

    if (activeCategory === 'snippets') {
      return [
        backTile,
        ...snippets.map((snip) => ({
          id: `s:${snip.id}`,
          keyLabel: snip.key || '·',
          previewLatex: snip.latex,
          tooltip: snip.key ? `${snip.name}（${leaderKey} t ${snip.key}）` : snip.name,
          isHot: Boolean(snip.key) && leaderActive,
          onClick: () => {
            mouseCategory = null;
            onInsertSnippet?.(snip);
          },
        })),
      ];
    }

    if (activeCategory === 'custom') {
      return [
        backTile,
        ...customCommands.map((cmd) => ({
          id: `k:${cmd.id}`,
          keyLabel: cmd.key || '·',
          previewLatex: commandPreviewLatex(cmd.latex),
          tooltip: cmd.shorthand ? `${cmd.label}（简写 ${cmd.shorthand}）` : cmd.label,
          isHot: Boolean(cmd.key) && leaderActive,
          onClick: () => pickCommand(cmd.id),
        })),
      ];
    }

    const subCmds = commands.filter((c) => c.category === activeCategory);
    return [
      backTile,
      ...subCmds.map((cmd) => {
        const shorthand = cmd.shorthand ?? SHORTHAND_BY_COMMAND_ID.get(cmd.id);
        const isDefault =
          pendingDefaultId === cmd.id ||
          SUBMENU_BY_KEY.get(activeGroup.key)?.defaultCommandId === cmd.id;
        return {
          id: `m:${cmd.id}`,
          keyLabel: cmd.keys[1] ?? cmd.keys[0] ?? '·',
          previewLatex: commandPreviewLatex(cmd.latex),
          tooltip: `${cmd.label}（${leaderKey} ${cmd.keys.join(' ')}${isDefault ? ` · 单按 ${leaderKey} ${activeGroup.key} 默认插入` : ''}${shorthand ? ` · 简写 ${shorthand}` : ''}）`,
          isDefault,
          isHot: leaderActive,
          isMatrix: activeCategory === 'matrix',
          onClick: () => pickCommand(cmd.id),
        };
      }),
    ];
  });
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeyDown} />

{#snippet renderTile(tile: MenuTile)}
  <button
    type="button"
    class="dock-tile"
    class:is-category={tile.isCategory}
    class:is-default={tile.isDefault}
    class:is-back={tile.isBack}
    use:obsidianTooltip={tile.tooltip}
    onmousedown={(e) => e.preventDefault()}
    onclick={tile.onClick}
  >
    {#if tile.iconId}
      <span class="dock-tile-glyph" use:obsidianIcon={tile.iconId}></span>
    {:else if tile.previewLatex}
      <span class="dock-tile-glyph" class:is-matrix={tile.isMatrix}>
        {@html renderLatexPreview(tile.previewLatex, false)}
      </span>
    {/if}
    <kbd class="dock-tile-key" class:is-hot={tile.isHot}>{tile.keyLabel}</kbd>
  </button>
{/snippet}

<div class="dock-menu-pane" bind:this={menuEl} role="toolbar" aria-label="快捷数学符号">
  {#if activeCategory && activeGroup}
    <div class="dock-menu-grid">
      {#each submenuTiles as tile (tile.id)}
        {@render renderTile(tile)}
      {/each}
    </div>
  {:else}
    <div class="dock-level-split">
      <div class="dock-menu-row" aria-label="一级直出结构">
        {#each level1QuickTiles as tile (tile.id)}
          {@render renderTile(tile)}
        {/each}
      </div>
      <div class="dock-row-sep" aria-hidden="true"></div>
      <div class="dock-menu-row" aria-label="二级分类菜单">
        {#each level1CategoryTiles as tile (tile.id)}
          {@render renderTile(tile)}
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .dock-menu-pane {
    width: 100%;
    height: 124px;
    flex: 0 0 124px;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    padding: 7px 12px;
    box-sizing: border-box;
    background: var(--background-secondary);
    border-top: 1px solid var(--background-modifier-border);
    display: flex;
    flex-direction: column;
  }

  .dock-level-split {
    margin: auto 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;
    width: 100%;
  }

  .dock-menu-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
  }

  .dock-row-sep {
    width: min(580px, 90%);
    height: 1px;
    background: var(--background-modifier-border);
    flex-shrink: 0;
  }

  .dock-menu-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 46px);
    grid-auto-rows: 34px;
    gap: 4px;
    justify-content: center;
    align-content: start;
    width: 100%;
  }

  .dock-tile {
    position: relative;
    width: 46px;
    height: 34px;
    padding: 2px;
    margin: 0;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
    background: var(--background-primary);
    color: var(--text-normal);
    box-shadow: none;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 1px;
    overflow: hidden;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .dock-tile:hover {
    background: var(--background-modifier-hover);
    border-color: var(--background-modifier-border-hover, var(--background-modifier-border));
  }

  .dock-tile.is-default {
    border-color: var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 10%, var(--background-primary));
  }

  .dock-tile.is-category {
    background: color-mix(in srgb, var(--background-primary) 78%, var(--background-secondary));
  }

  .dock-tile.is-category::after {
    content: '';
    position: absolute;
    top: 3px;
    right: 3px;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--text-faint);
    pointer-events: none;
  }

  .dock-tile-glyph {
    width: 100%;
    height: 17px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    line-height: 1;
    color: var(--text-normal);
    overflow: hidden;
    flex-shrink: 0;
  }

  .dock-tile-glyph :global(.katex) {
    font-size: 1em;
  }

  .dock-tile-glyph.is-matrix :global(.katex) {
    font-size: 9.5px;
    transform: scale(0.44);
    transform-origin: center center;
  }

  .dock-tile-glyph :global(svg) {
    width: 12px;
    height: 12px;
    stroke-width: 2;
  }

  .dock-tile-key {
    min-width: 14px;
    height: 11px;
    padding: 0 3px;
    border-radius: 3px;
    background: var(--background-secondary);
    color: var(--text-muted);
    font-family: var(--font-monospace);
    font-size: 9px;
    font-weight: 600;
    line-height: 11px;
    text-align: center;
    flex-shrink: 0;
  }

  .dock-tile-key.is-hot {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }
</style>

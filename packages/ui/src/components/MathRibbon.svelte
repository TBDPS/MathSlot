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
  let ribbonEl: HTMLDivElement | null = $state(null);

  const activeCategory = $derived<RibbonCategory | null>(
    leaderActive && leaderPrefix
      ? (KEY_TO_CATEGORY.get(leaderPrefix) ?? null)
      : mouseCategory,
  );

  const subCommands = $derived<CommandDef[]>(
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

  function closeSubmenu(): void {
    if (leaderActive) {
      onLeaderBack?.();
    } else {
      mouseCategory = null;
    }
  }
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeyDown} />

<div class="ribbon-dock" class:leader-active={leaderActive} bind:this={ribbonEl}>
  <div class="ribbon-shell">
    {#if activeCategory && activeGroup}
      <div class="sub-panel" role="menu" aria-label={activeGroup.label}>
        <div class="sub-head">
          <button
            type="button"
            class="sub-back"
            onmousedown={(e) => e.preventDefault()}
            onclick={closeSubmenu}
            aria-label="返回"
          >
            ‹ 返回
          </button>
          <span class="sub-title">{activeGroup.label}</span>

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

          <span class="sub-hint">按对应键即插 · Esc 返回</span>
          <span class="sub-chord">
            <kbd>{leaderKey}</kbd><kbd>{activeGroup.key}</kbd>
          </span>
        </div>

        {#if activeCategory === 'snippets'}
          {#if snippets.length === 0}
            <div class="sub-empty">
              <span>暂无复用片段</span>
            </div>
          {:else}
            <div class="sub-grid is-wide">
              {#each snippets as snip (snip.id)}
                <button
                  type="button"
                  class="sub-tile"
                  title={snip.key ? `${snip.name}（${leaderKey} t ${snip.key}）` : snip.name}
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => {
                    mouseCategory = null;
                    onInsertSnippet?.(snip);
                  }}
                >
                  <span class="tile-math">
                    {@html renderLatexPreview(snip.latex, false)}
                  </span>
                  <kbd class="tile-key" class:hot={Boolean(snip.key) && leaderActive}>
                    {snip.key || '·'}
                  </kbd>
                </button>
              {/each}
            </div>
          {/if}
        {:else if activeCategory === 'custom'}
          {#if customCommands.length === 0}
            <div class="sub-empty">
              <span>暂无自定义结构</span>
            </div>
          {:else}
            <div class="sub-grid is-wide">
              {#each customCommands as cmd (cmd.id)}
                <button
                  type="button"
                  class="sub-tile"
                  title={cmd.shorthand ? `${cmd.label}（简写 ${cmd.shorthand}）` : cmd.label}
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => pickCommand(cmd.id)}
                >
                  <span class="tile-math">
                    {@html renderLatexPreview(commandPreviewLatex(cmd.latex), false)}
                  </span>
                  <kbd class="tile-key" class:hot={Boolean(cmd.key) && leaderActive}>
                    {cmd.key || '·'}
                  </kbd>
                </button>
              {/each}
            </div>
          {/if}
        {:else}
          <div class="sub-grid" class:is-matrix={activeCategory === 'matrix'}>
            {#each subCommands as cmd (cmd.id)}
              {@const shorthand = cmd.shorthand ?? SHORTHAND_BY_COMMAND_ID.get(cmd.id)}
              {@const isDefault =
                pendingDefaultId === cmd.id ||
                SUBMENU_BY_KEY.get(activeGroup.key)?.defaultCommandId === cmd.id}
              <button
                type="button"
                class="sub-tile"
                class:is-default={isDefault}
                title={`${cmd.label}（${leaderKey} ${cmd.keys.join(' ')}${isDefault ? ` · 单按 ${leaderKey} ${activeGroup.key} 默认插入` : ''}${shorthand ? ` · 简写 ${shorthand}` : ''}）`}
                onmousedown={(e) => e.preventDefault()}
                onclick={() => pickCommand(cmd.id)}
              >
                <span class="tile-math" class:is-matrix={activeCategory === 'matrix'}>
                  {@html renderLatexPreview(commandPreviewLatex(cmd.latex), false)}
                </span>
                <kbd class="tile-key" class:hot={leaderActive}>{cmd.keys[1] ?? cmd.keys[0]}</kbd>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <div class="ribbon-rows" role="toolbar" aria-label="快捷数学符号">
        <div class="ribbon-row" aria-label="一级直出结构">
          {#each QUICK_ITEMS as item (item.id)}
            {@const cmd = COMMANDS_BY_ID.get(item.id)}
            <button
              type="button"
              class="ribbon-tile"
              title={`${cmd?.label ?? item.id}（${leaderKey} ${item.key}）`}
              aria-label={cmd?.label ?? item.id}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => pickCommand(item.id)}
            >
              <span class="tile-math">{@html renderLatexPreview(item.preview, false)}</span>
              <kbd class="tile-key" class:hot={leaderActive && !leaderPrefix}>{item.key}</kbd>
            </button>
          {/each}
        </div>

        <div class="ribbon-sep" aria-hidden="true"></div>

        <div class="ribbon-row" aria-label="二级分类菜单">
          {#each CATEGORY_GROUPS as grp (grp.category)}
            <button
              type="button"
              class="ribbon-tile is-category"
              title={`${grp.label}（${leaderKey} ${grp.key}）`}
              aria-label={grp.label}
              aria-expanded={false}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => clickCategory(grp)}
            >
              <span class="tile-math">{@html renderLatexPreview(grp.preview, false)}</span>
              <kbd class="tile-key" class:hot={leaderActive && (!leaderPrefix || leaderPrefix === grp.key)}>
                {grp.key}
              </kbd>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Fixed in-flow bottom dock: NEVER floats over or obstructs the 2D formula canvas above! */
  .ribbon-dock {
    width: 100%;
    height: 162px;
    flex: 0 0 162px;
    display: flex;
    justify-content: center;
    align-items: stretch;
    padding: 6px 14px 8px;
    box-sizing: border-box;
    background: var(--ms-chrome);
    border-top: 1px solid var(--ms-border-subtle);
    overflow: hidden;
    transition: border-color 120ms var(--ms-ease-out);
  }

  .ribbon-dock.leader-active {
    border-top-color: var(--ms-accent);
  }

  .ribbon-shell {
    width: min(1160px, 100%);
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 0;
  }

  /* === Top-level separated Level-1 / Level-2 rows === */
  .ribbon-rows {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: 100%;
  }

  .ribbon-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: 100%;
  }

  .ribbon-sep {
    width: min(700px, 88%);
    height: 1px;
    background: var(--ms-border-subtle);
    flex-shrink: 0;
  }

  .ribbon-tile {
    position: relative;
    width: 54px;
    height: 46px;
    padding: 3px;
    border: 1px solid var(--ms-border-subtle);
    border-radius: 8px;
    background: var(--ms-tile);
    color: var(--ms-fg);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 2px;
    flex-shrink: 0;
    box-sizing: border-box;
    transition:
      background-color 100ms var(--ms-ease-out),
      border-color 100ms var(--ms-ease-out),
      transform 80ms var(--ms-ease-out);
  }

  .ribbon-tile:hover {
    background: var(--ms-tile-hover);
    border-color: color-mix(in srgb, var(--ms-accent) 50%, var(--ms-border));
  }

  .ribbon-tile:active {
    transform: scale(0.95);
  }

  .ribbon-tile.is-category::after {
    content: '';
    position: absolute;
    top: 4px;
    right: 4px;
    width: 3.5px;
    height: 3.5px;
    border-radius: 50%;
    background: var(--ms-fg-faint);
    pointer-events: none;
  }

  /* === Zero-scroll in-place submenu cheat-sheet === */
  .sub-panel {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: 5px;
  }

  .sub-head {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 22px;
    flex-shrink: 0;
  }

  .sub-back {
    height: 20px;
    padding: 0 7px;
    border: 1px solid var(--ms-border);
    border-radius: 5px;
    background: var(--ms-surface);
    color: var(--ms-fg);
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .sub-back:hover {
    border-color: var(--ms-accent);
    color: var(--ms-accent);
  }

  .sub-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--ms-fg);
  }

  .new-custom-btn {
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--ms-accent);
    border-radius: 5px;
    background: var(--ms-accent-soft);
    color: var(--ms-accent);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
  }

  .new-custom-btn:hover {
    background: var(--ms-accent);
    color: var(--ms-accent-fg);
  }

  .sub-hint {
    margin-left: auto;
    font-size: 11px;
    color: var(--ms-fg-faint);
    white-space: nowrap;
  }

  .sub-chord {
    display: inline-flex;
    gap: 3px;
    flex-shrink: 0;
  }

  .sub-chord kbd {
    font-family: var(--ms-font-mono);
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--ms-keycap-bg);
    border: 1px solid var(--ms-keycap-border);
    box-shadow: var(--ms-keycap-shadow);
    color: var(--ms-keycap-fg);
  }

  .sub-empty {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ms-fg-muted);
    font-size: 12px;
  }

  .sub-grid {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, 54px);
    grid-auto-rows: 36px;
    gap: 4px;
    justify-content: center;
    align-content: center;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .sub-grid.is-matrix,
  .sub-grid.is-wide {
    grid-template-columns: repeat(auto-fill, 86px);
    grid-auto-rows: 52px;
    gap: 5px;
  }

  .sub-tile {
    width: 100%;
    height: 100%;
    padding: 2px 3px;
    border: 1px solid var(--ms-border-subtle);
    border-radius: 7px;
    background: var(--ms-tile);
    color: var(--ms-fg);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 1px;
    overflow: hidden;
    box-sizing: border-box;
    transition:
      background-color 90ms var(--ms-ease-out),
      border-color 90ms var(--ms-ease-out),
      transform 80ms var(--ms-ease-out);
  }

  .sub-tile:hover {
    background: var(--ms-tile-hover);
    border-color: var(--ms-accent);
  }

  .sub-tile:active {
    transform: scale(0.95);
  }

  .sub-tile.is-default {
    border-color: var(--ms-accent);
    background: color-mix(in srgb, var(--ms-accent-soft) 65%, var(--ms-tile));
  }

  .tile-math {
    width: 100%;
    flex: 1 1 auto;
    min-height: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    line-height: 1;
    color: var(--ms-fg);
    overflow: hidden;
  }

  .ribbon-tile .tile-math {
    font-size: 14.5px;
  }

  .tile-math :global(.katex) {
    font-size: 1em;
  }

  .tile-math.is-matrix :global(.katex) {
    font-size: 10px;
    transform: scale(0.62);
    transform-origin: center center;
  }

  .tile-key {
    min-width: 15px;
    height: 13px;
    padding: 0 3px;
    border-radius: 3px;
    background: var(--ms-keycap-bg);
    border: 1px solid var(--ms-keycap-border);
    box-shadow: var(--ms-keycap-shadow);
    color: var(--ms-keycap-fg);
    font-family: var(--ms-font-mono);
    font-size: 9.5px;
    font-weight: 700;
    line-height: 11px;
    text-align: center;
    flex-shrink: 0;
    transition: background-color 80ms ease, color 80ms ease, border-color 80ms ease;
  }

  .tile-key.hot {
    background: var(--ms-accent);
    border-color: var(--ms-accent);
    color: var(--ms-accent-fg);
    box-shadow: none;
  }
</style>

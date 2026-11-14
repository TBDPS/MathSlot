import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import PalettePanel from '../src/palette/PalettePanel.svelte';
import {
  COMMAND_CATEGORIES,
  D001_FEATURED_IDS,
  filterCommands,
  filterPresets,
  moveGridIndex,
} from '../src/palette/paletteModel';
import { COMMANDS, COMMANDS_BY_ID } from '../src/generated/catalog';
import { PRESETS, PRESET_CATEGORIES } from '../src/generated/presets';
import {
  createEmptySnapshot,
  type AppEvent,
  type DispatchResponse,
  type EngineClient,
} from '../src/client/engine';

function createMockClient(): {
  client: EngineClient;
  events: AppEvent[];
} {
  const events: AppEvent[] = [];
  const snapshot = createEmptySnapshot();

  const client: EngineClient = {
    dispatch: vi.fn(async (event: AppEvent): Promise<DispatchResponse> => {
      events.push(event);
      return { effects: [], snapshot };
    }),
    snapshot: vi.fn(async () => snapshot),
    engineVersion: vi.fn(async () => '0.7.0-test'),
  };

  return { client, events };
}

describe('PalettePanel & paletteModel (T3.2)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    document.body.innerHTML = '';
  });

  it('renders all 121 catalog commands and D-001 5 core cards directly from generated/catalog.ts', async () => {
    expect(COMMANDS).toHaveLength(121);
    expect(D001_FEATURED_IDS).toEqual(['partial', 'approx', 'cdot', 'times', 'equiv']);

    const { client } = createMockClient();
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(PalettePanel, {
      target,
      props: { client },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    const cards = target.querySelectorAll('[data-command-card]');
    expect(cards.length).toBe(121);

    const partialCard = target.querySelector('[data-command-card="partial"]');
    expect(partialCard).not.toBeNull();
    expect(partialCard!.textContent).toContain('偏导');
    expect(partialCard!.textContent).toContain('∂');
    expect(partialCard!.querySelector('kbd')?.textContent).toBe('▸oc');

    for (const id of D001_FEATURED_IDS) {
      const cmd = COMMANDS_BY_ID[id];
      expect(cmd).toBeDefined();
      const card = target.querySelector(`[data-command-card="${id}"]`);
      expect(card).not.toBeNull();
      expect(card!.textContent).toContain(cmd!.label);
      expect(card!.textContent).toContain(cmd!.glyph);
    }
  });

  it('A-EDIT-004: clicking or pressing Enter on "偏导" dispatches ApplyCard("partial") and calls onRequestEditorFocus once', async () => {
    const { client, events } = createMockClient();
    const onRequestEditorFocus = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(PalettePanel, {
      target,
      props: {
        client,
        onRequestEditorFocus,
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    const partialCard = target.querySelector<HTMLButtonElement>('[data-command-card="partial"]');
    expect(partialCard).not.toBeNull();

    partialCard!.click();
    await tick();

    expect(events).toEqual([{ ApplyCard: 'partial' }]);
    expect(onRequestEditorFocus).toHaveBeenCalledTimes(1);
  });

  it('filters commands by search query (label, keys, id, latex) and switches across all 8 categories', async () => {
    expect(COMMAND_CATEGORIES.filter((c) => c.id !== 'all')).toHaveLength(8);
    expect(filterCommands('偏导', 'all').map((c) => c.id)).toContain('partial');
    expect(filterCommands('oc', 'all').map((c) => c.id)).toContain('partial');
    expect(filterCommands('frac', 'all').map((c) => c.id)).toContain('frac');

    const { client } = createMockClient();
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(PalettePanel, {
      target,
      props: { client },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    const tablist = target.querySelector('[role="tablist"][aria-label="命令分类"]');
    expect(tablist).not.toBeNull();

    const greekTab = target.querySelector<HTMLButtonElement>('[role="tab"][data-category="greek"]');
    expect(greekTab).not.toBeNull();
    greekTab!.click();
    await tick();

    expect(greekTab!.getAttribute('aria-selected')).toBe('true');
    const greekCount = COMMANDS.filter((c) => c.category === 'greek').length;
    expect(target.querySelectorAll('[data-command-card]').length).toBe(greekCount);

    const allTab = target.querySelector<HTMLButtonElement>('[role="tab"][data-category="all"]');
    allTab!.click();
    await tick();
    expect(target.querySelectorAll('[data-command-card]').length).toBe(121);

    const searchInput = target.querySelector<HTMLInputElement>('input[type="search"]');
    expect(searchInput).not.toBeNull();
    searchInput!.value = 'oc';
    searchInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    const filteredCards = target.querySelectorAll('[data-command-card]');
    expect(filteredCards.length).toBeGreaterThanOrEqual(1);
    expect(target.querySelector('[data-command-card="partial"]')).not.toBeNull();
  });

  it('exposes all 88 presets across 9 categories and dispatches LoadStreamSource on activation', async () => {
    expect(PRESETS).toHaveLength(88);
    expect(PRESET_CATEGORIES).toHaveLength(9);
    expect(filterPresets('欧拉恒等式', 'all').length).toBeGreaterThanOrEqual(1);

    const { client, events } = createMockClient();
    const onRequestEditorFocus = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(PalettePanel, {
      target,
      props: {
        client,
        initialMode: 'presets',
        onRequestEditorFocus,
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    expect(target.querySelectorAll('[data-preset-card]').length).toBe(88);

    const searchInput = target.querySelector<HTMLInputElement>('input[type="search"]');
    searchInput!.value = '欧拉恒等式';
    searchInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    const eulerCard = target.querySelector<HTMLButtonElement>(
      '[data-preset-card="preset-euler-identity"]',
    );
    expect(eulerCard).not.toBeNull();
    eulerCard!.click();
    await tick();

    expect(events).toEqual([{ LoadStreamSource: '▸ue;i▸gp;; + 1 = 0' }]);
    expect(onRequestEditorFocus).toHaveBeenCalledTimes(1);
  });

  it('D-015 / A-UI-001: supports keyboard navigation across category tabs and command grid cards', async () => {
    expect(moveGridIndex(0, 'ArrowRight', 10, 3)).toBe(1);
    expect(moveGridIndex(0, 'ArrowDown', 10, 3)).toBe(3);
    expect(moveGridIndex(4, 'ArrowUp', 10, 3)).toBe(1);
    expect(moveGridIndex(2, 'End', 10, 3)).toBe(9);
    expect(moveGridIndex(5, 'Home', 10, 3)).toBe(0);

    const { client, events } = createMockClient();
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(PalettePanel, {
      target,
      props: { client, columns: 3 },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    // Tab switching with ArrowRight
    const allTab = target.querySelector<HTMLButtonElement>('[role="tab"][data-category="all"]');
    allTab!.focus();
    allTab!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await tick();

    const firstCategoryTab = target.querySelector<HTMLButtonElement>(
      '[role="tab"][data-category="structure"]',
    );
    expect(document.activeElement).toBe(firstCategoryTab);
    expect(firstCategoryTab!.getAttribute('aria-selected')).toBe('true');

    // Grid navigation with ArrowRight & Space/Enter activation
    const cards = Array.from(target.querySelectorAll<HTMLButtonElement>('[data-command-card]'));
    expect(cards.length).toBeGreaterThan(2);
    cards[0]!.focus();
    cards[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await tick();
    expect(document.activeElement).toBe(cards[1]);

    const secondId = cards[1]!.getAttribute('data-command-card');
    cards[1]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await tick();
    expect(events).toContainEqual({ ApplyCard: secondId });
  });

  it('D-135: displays saved userFormulas in snippets tab and dispatches LoadStreamSource on click', async () => {
    const { client, events } = createMockClient();
    const onUserFormulaLoaded = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(PalettePanel, {
      target,
      props: {
        client,
        userFormulas: [
          {
            id: 'u-1',
            name: '高斯积分',
            category: '自定义',
            source: '▸f1;2;',
            desc: '自定义测试片段',
            tags: ['snippet'],
          },
        ],
        onUserFormulaLoaded,
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    const snippetsTab = target.querySelector<HTMLButtonElement>('[data-palette-mode="snippets"]');
    expect(snippetsTab).not.toBeNull();
    expect(snippetsTab!.textContent).toContain('片段 (1)');
    snippetsTab!.click();
    await tick();

    const card = target.querySelector<HTMLButtonElement>('[data-snippet-card="u-1"]');
    expect(card).not.toBeNull();
    card!.click();
    await tick();

    expect(events).toContainEqual({ LoadStreamSource: '▸f1;2;' });
    expect(onUserFormulaLoaded).toHaveBeenCalledTimes(1);
  });

  it('D-166: binds command and preset tab counts dynamically from COMMANDS.length and PRESETS.length', async () => {
    const { client } = createMockClient();
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(PalettePanel, {
      target,
      props: { client },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    const commandsTab = target.querySelector<HTMLButtonElement>('[data-palette-mode="commands"]');
    const presetsTab = target.querySelector<HTMLButtonElement>('[data-palette-mode="presets"]');
    expect(commandsTab?.textContent?.trim()).toBe(`命令目录 (${COMMANDS.length})`);
    expect(presetsTab?.textContent?.trim()).toBe(`预置公式 (${PRESETS.length})`);
  });
});

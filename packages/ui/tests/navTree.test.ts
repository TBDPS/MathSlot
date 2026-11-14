import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import NavTreePanel from '../src/nav/NavTreePanel.svelte';
import { buildNavTree, flattenNavTree } from '../src/nav/navTree';
import {
  createEmptySnapshot,
  type AppEvent,
  type DispatchResponse,
  type EngineClient,
  type EngineSnapshot,
  type SlotSnapshot,
} from '../src/client/engine';

function createMockClient(snapshot: EngineSnapshot): {
  client: EngineClient;
  events: AppEvent[];
} {
  const events: AppEvent[] = [];
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

function makeMatrix3x3Slots(): SlotSnapshot[] {
  const slots: SlotSnapshot[] = [];
  let id = 1;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      slots.push({
        id,
        role: `MatrixCell(${r},${c})`,
        label: `矩阵单元格(${r + 1},${c + 1})`,
        is_empty: id === 5,
        is_active: id === 1,
        span: { start: id * 2, end: id * 2 + 1 },
        path: [0, r, c],
        depth: 3,
      });
      id++;
    }
  }
  return slots;
}

function makeDeepNestedSlots(): SlotSnapshot[] {
  return [
    {
      id: 1,
      role: 'Numerator',
      label: '分子',
      is_empty: false,
      is_active: false,
      span: { start: 6, end: 18 },
      path: [0, 0],
      depth: 2,
    },
    {
      id: 2,
      role: 'Radicand',
      label: '被开方数',
      is_empty: true,
      is_active: true,
      span: { start: 12, end: 14 },
      path: [0, 0, 0, 1],
      depth: 4,
    },
    {
      id: 3,
      role: 'Denominator',
      label: '分母',
      is_empty: false,
      is_active: false,
      span: { start: 20, end: 21 },
      path: [0, 1],
      depth: 2,
    },
  ];
}

describe('NavTreePanel & navTree helper (T3.2)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    document.body.innerHTML = '';
  });

  it('D-008 / A-UI-003 / S-003: builds hierarchical 3x3 matrix tree (9 slots grouped into 3 rows) with scrollable non-clipped list', async () => {
    const slots = makeMatrix3x3Slots();
    const tree = buildNavTree(slots);
    const flat = flattenNavTree(tree, new Set());
    const slotItems = flat.filter((item) => item.node.kind === 'slot');
    expect(slotItems).toHaveLength(9);
    expect(tree.some((n) => n.kind === 'group')).toBe(true);

    const snapshot: EngineSnapshot = {
      ...createEmptySnapshot(),
      state: { Nav: { path: ['0', '0', '0'] } },
      is_nav_mode: true,
      active_slot_id: 1,
      slots,
    };
    const { client, events } = createMockClient(snapshot);
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(NavTreePanel, {
      target,
      props: { client, snapshot },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    const treeEl = target.querySelector('[role="tree"]');
    expect(treeEl).not.toBeNull();

    const scrollContainer = target.querySelector('.ms-nav-scroll');
    expect(scrollContainer).not.toBeNull();

    const renderedSlots = target.querySelectorAll('[role="treeitem"][data-slot-id]');
    expect(renderedSlots.length).toBe(9);

    const activeItem = target.querySelector('[role="treeitem"][data-slot-id="1"]');
    expect(activeItem?.getAttribute('aria-current')).toBe('step');
    expect(activeItem?.getAttribute('aria-selected')).toBe('true');

    // Status text must be explicit (not color-only)
    const emptyCell = target.querySelector('[role="treeitem"][data-slot-id="5"]');
    expect(emptyCell?.textContent).toContain('空槽位');
    expect(activeItem?.textContent).toContain('已填');

    // Breadcrumb reflects EditorState::Nav.path
    const breadcrumb = target.querySelector('[aria-label="导航路径"]');
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb!.textContent).toContain('0');

    // Clicking slot #5 dispatches SelectSlot(5)
    (emptyCell as HTMLButtonElement).click();
    await tick();
    expect(events).toContainEqual({ SelectSlot: 5 });
  });

  it('D-020 / S-004: renders deep nested slots (depth >= 3) with indentation and ARIA tree semantics', async () => {
    const slots = makeDeepNestedSlots();
    const snapshot: EngineSnapshot = {
      ...createEmptySnapshot(),
      active_slot_id: 2,
      slots,
    };
    const { client, events } = createMockClient(snapshot);
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(NavTreePanel, {
      target,
      props: { client, snapshot },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    const deepItem = target.querySelector<HTMLButtonElement>('[role="treeitem"][data-slot-id="2"]');
    expect(deepItem).not.toBeNull();
    expect(Number(deepItem!.getAttribute('data-depth'))).toBeGreaterThanOrEqual(3);
    expect(Number(deepItem!.getAttribute('aria-level'))).toBeGreaterThanOrEqual(3);
    expect(deepItem!.getAttribute('aria-current')).toBe('step');

    // Keyboard navigation in tree: ArrowDown / ArrowUp / Enter / Space
    const treeitems = Array.from(
      target.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    );
    expect(treeitems.length).toBeGreaterThanOrEqual(3);
    treeitems[0]!.focus();
    treeitems[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    await tick();
    expect(document.activeElement).toBe(treeitems[1]);

    // Collapse/expand if treeitems[0] is a group, or select slot if slot
    deepItem!.focus();
    deepItem!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await tick();
    expect(events).toContainEqual({ SelectSlot: 2 });

    // Toggle nav mode button
    const navToggle = target.querySelector<HTMLButtonElement>('[data-testid="nav-mode-toggle"]');
    expect(navToggle).not.toBeNull();
    navToggle!.click();
    await tick();
    expect(events).toContainEqual('EnterNavMode');
  });
});

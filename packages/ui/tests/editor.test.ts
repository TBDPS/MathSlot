import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import MathSlotEditor from '../src/editor/MathSlotEditor.svelte';
import {
  createEmptySnapshot,
  type AppEvent,
  type DispatchResponse,
  type EngineClient,
  type EngineSnapshot,
} from '../src/client/engine';
import { COMMANDS_BY_ID } from '../src/generated/catalog';

function createMockClient(initial?: Partial<EngineSnapshot>): {
  client: EngineClient;
  events: AppEvent[];
  setSnapshot: (next: EngineSnapshot) => void;
} {
  let current: EngineSnapshot = {
    ...createEmptySnapshot(),
    ...initial,
  };
  const events: AppEvent[] = [];

  const client: EngineClient = {
    dispatch: vi.fn(async (event: AppEvent): Promise<DispatchResponse> => {
      events.push(event);
      return {
        effects: [],
        snapshot: current,
      };
    }),
    snapshot: vi.fn(async () => current),
    engineVersion: vi.fn(async () => '0.7.0-test'),
  };

  return {
    client,
    events,
    setSnapshot: (next: EngineSnapshot) => {
      current = next;
    },
  };
}

describe('MathSlotEditor (T3.1)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      fn?.();
    }
    document.body.innerHTML = '';
  });

  it('A-EDIT-006: pasting "x+▸f1;2;" dispatches Paste, keeps literal text in CM6, and never fires KeyInput("▸")', async () => {
    const { client, events } = createMockClient();
    const target = document.createElement('div');
    document.body.appendChild(target);

    let editorView: { state: { doc: { toString(): string } }; contentDOM: HTMLElement } | null =
      null;

    const app = mount(MathSlotEditor, {
      target,
      props: {
        client,
        onViewReady: (view) => {
          editorView = view;
        },
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    expect(editorView).not.toBeNull();
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        getData: (mime: string) => (mime === 'text/plain' ? 'x+▸f1;2;' : ''),
      },
    });

    editorView!.contentDOM.dispatchEvent(pasteEvent);
    await tick();

    expect(editorView!.state.doc.toString()).toContain('▸f1;2;');
    expect(editorView!.state.doc.toString()).toBe('x+▸f1;2;');
    expect(events).toContainEqual({ Paste: 'x+▸f1;2;' });
    expect(events).not.toContainEqual({ KeyInput: '▸' });
  });

  it('A-EDIT-007: IME compositionstart/update/end is never interrupted and emits ImeCompositionCommit', async () => {
    const { client, events } = createMockClient();
    const target = document.createElement('div');
    document.body.appendChild(target);

    let editorView: {
      state: { doc: { toString(): string }; selection: { main: { head: number } } };
      contentDOM: HTMLElement;
    } | null = null;

    const app = mount(MathSlotEditor, {
      target,
      props: {
        client,
        initialDoc: 'a+',
        onViewReady: (view) => {
          editorView = view;
        },
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    expect(editorView).not.toBeNull();
    const contentDOM = editorView!.contentDOM;

    const startEvt = new CompositionEvent('compositionstart', {
      bubbles: true,
      cancelable: true,
      data: '',
    });
    const updateEvt = new CompositionEvent('compositionupdate', {
      bubbles: true,
      cancelable: true,
      data: 'shuxue',
    });
    const keyDuringIme = new KeyboardEvent('keydown', {
      key: 's',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    const endEvt = new CompositionEvent('compositionend', {
      bubbles: true,
      cancelable: true,
      data: '数学',
    });

    contentDOM.dispatchEvent(startEvt);
    contentDOM.dispatchEvent(updateEvt);
    const keyNotCanceled = contentDOM.dispatchEvent(keyDuringIme);
    contentDOM.dispatchEvent(endEvt);
    await tick();

    expect(startEvt.defaultPrevented).toBe(false);
    expect(updateEvt.defaultPrevented).toBe(false);
    expect(keyNotCanceled).toBe(true);
    expect(events).toContainEqual({ ImeCompositionUpdate: 'shuxue' });
    expect(events).toContainEqual({ ImeCompositionCommit: '数学' });
    expect(events.some((e) => typeof e === 'object' && 'KeyInput' in e)).toBe(false);
  });

  it('A-EDIT-008: in Nav mode, pressing j/k/h/l dispatches navigation events and leaves CM6 text & line count unchanged', async () => {
    const navSnapshot: EngineSnapshot = {
      ...createEmptySnapshot(),
      state: { Nav: { path: [] } },
      is_nav_mode: true,
    };
    const { client, events } = createMockClient(navSnapshot);
    const target = document.createElement('div');
    document.body.appendChild(target);

    let editorView: {
      state: { doc: { toString(): string; lines: number } };
      contentDOM: HTMLElement;
    } | null = null;

    const app = mount(MathSlotEditor, {
      target,
      props: {
        client,
        snapshot: navSnapshot,
        initialDoc: 'x+y\nz',
        onViewReady: (view) => {
          editorView = view;
        },
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    const contentDOM = editorView!.contentDOM;
    for (const key of ['j', 'k', 'h', 'l']) {
      const evt = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      contentDOM.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(true);
    }
    await tick();

    expect(editorView!.state.doc.toString()).toBe('x+y\nz');
    expect(editorView!.state.doc.lines).toBe(2);
    expect(events).toEqual([
      { Navigate: 'NextSlot' },
      { Navigate: 'PrevSlot' },
      { Navigate: 'StepLeft' },
      { Navigate: 'StepRight' },
    ]);
  });

  it('D-009: multiline document "a\\nb\\nc" preserves 3 true CM6 lines', async () => {
    const { client } = createMockClient();
    const target = document.createElement('div');
    document.body.appendChild(target);

    let editorView: {
      state: { doc: { toString(): string; lines: number } };
      dom: HTMLElement;
    } | null = null;

    const app = mount(MathSlotEditor, {
      target,
      props: {
        client,
        initialDoc: 'a\nb\nc',
        onViewReady: (view) => {
          editorView = view;
        },
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    expect(editorView!.state.doc.lines).toBe(3);
    expect(editorView!.state.doc.toString()).toBe('a\nb\nc');
    expect(editorView!.dom.querySelectorAll('.cm-line').length).toBe(3);
  });

  it('D-015: Shift+Tab allows escaping focus and subsequent snapshot updates do not steal focus back', async () => {
    const { client } = createMockClient();
    const wrapper = document.createElement('div');
    const externalBtn = document.createElement('button');
    externalBtn.textContent = 'Palette';
    const editorHost = document.createElement('div');
    wrapper.append(externalBtn, editorHost);
    document.body.appendChild(wrapper);

    let editorView: { contentDOM: HTMLElement; focus: () => void } | null = null;
    const onFocusEscape = vi.fn((dir: 'forward' | 'backward') => {
      if (dir === 'backward') {
        externalBtn.focus();
      }
    });

    const app = mount(MathSlotEditor, {
      target: editorHost,
      props: {
        client,
        snapshot: createEmptySnapshot(),
        onFocusEscape,
        onViewReady: (view) => {
          editorView = view;
        },
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    editorView!.focus();
    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    editorView!.contentDOM.dispatchEvent(shiftTab);
    await tick();

    expect(onFocusEscape).toHaveBeenCalledWith('backward');
    expect(document.activeElement).toBe(externalBtn);

    // Subsequent snapshot updates must NEVER steal focus back to CM6
    app.setSnapshot({
      ...createEmptySnapshot(),
      latex: '\\frac{1}{2}',
      slots: [
        {
          id: 1,
          role: 'Numerator',
          label: '分子',
          is_empty: false,
          is_active: true,
          span: { start: 6, end: 7 },
        },
      ],
      active_slot_id: 1,
    });
    await tick();

    expect(document.activeElement).toBe(externalBtn);
  });

  it('renders command, slot, and diagnostic metadata from generated/catalog.ts and EngineSnapshot with ARIA labels', async () => {
    const frac = COMMANDS_BY_ID['frac'];
    expect(frac).toBeDefined();

    const snapshot: EngineSnapshot = {
      ...createEmptySnapshot(),
      state: { PrefixSub: { key: 'f' } },
      has_pending_command: true,
      active_slot_id: 2,
      slots: [
        {
          id: 1,
          role: 'Numerator',
          label: frac!.slots[0] ?? '分子',
          is_empty: false,
          is_active: false,
          span: { start: 6, end: 7 },
        },
        {
          id: 2,
          role: 'Denominator',
          label: frac!.slots[1] ?? '分母',
          is_empty: true,
          is_active: true,
          span: { start: 9, end: 9 },
        },
      ],
      diagnostics: [
        {
          code: 'PENDING_COMMAND',
          severity: 'Info',
          message: 'Pending command prefix: ▸f',
        },
      ],
    };

    const { client } = createMockClient(snapshot);
    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(MathSlotEditor, {
      target,
      props: {
        client,
        snapshot,
        initialDoc: '▸f',
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    const root = target.querySelector('[data-testid="mathslot-editor"]');
    expect(root).not.toBeNull();
    expect(root!.textContent).toContain(frac!.label);
    expect(root!.textContent).toContain(frac!.glyph);

    const activeSlotPill = target.querySelector('[data-slot-id="2"]');
    expect(activeSlotPill).not.toBeNull();
    expect(activeSlotPill!.getAttribute('aria-current')).toBe('step');
    expect(activeSlotPill!.getAttribute('aria-label')).toContain('分母');

    const diagBanner = target.querySelector('[role="status"]');
    expect(diagBanner).not.toBeNull();
    expect(diagBanner!.textContent).toContain('Pending command prefix: ▸f');

    const cmdDecor = target.querySelector('.ms-cmd-prefix');
    expect(cmdDecor).not.toBeNull();
    expect(cmdDecor!.getAttribute('aria-label')).toContain(frac!.label);
  });

  it('D-118 / D-015: invokes configured copy_latex & focus_editor shortcuts while Tab/Shift+Tab/Escape remain untrapped', async () => {
    const { client, events } = createMockClient();
    const onCopyLatex = vi.fn();
    const onFocusEditor = vi.fn();
    const onFocusEscape = vi.fn();

    const wrapper = document.createElement('div');
    const externalBtn = document.createElement('button');
    externalBtn.textContent = 'External';
    const editorHost = document.createElement('div');
    wrapper.append(externalBtn, editorHost);
    document.body.appendChild(wrapper);

    let editorView: { contentDOM: HTMLElement; focus: () => void } | null = null;
    const app = mount(MathSlotEditor, {
      target: editorHost,
      props: {
        client,
        shortcuts: {
          copy_latex: 'Mod+Alt+C',
          focus_editor: 'Alt+I',
        },
        onCopyLatex,
        onFocusEditor,
        onFocusEscape,
        onViewReady: (view) => {
          editorView = view;
        },
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    // Custom copy_latex shortcut triggers callback when editor focused
    editorView!.focus();
    const copyEvt = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    editorView!.contentDOM.dispatchEvent(copyEvt);
    expect(copyEvt.defaultPrevented).toBe(true);
    expect(onCopyLatex).toHaveBeenCalledTimes(1);

    // Tab still escapes focus forward
    const tabEvt = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    editorView!.contentDOM.dispatchEvent(tabEvt);
    expect(onFocusEscape).toHaveBeenCalledWith('forward');

    // Focus external button, then press configured focus_editor ('Alt+I') to return focus to editor
    externalBtn.focus();
    expect(document.activeElement).toBe(externalBtn);
    const focusEvt = new KeyboardEvent('keydown', {
      key: 'i',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(focusEvt);
    await tick();
    expect(onFocusEditor).toHaveBeenCalledTimes(1);
    expect(events).not.toContainEqual({ KeyInput: 'i' });
  });
});

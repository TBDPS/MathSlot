import { mount, unmount } from 'svelte';
import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from '@codemirror/state';
import { EditorView, showTooltip, type Tooltip, type TooltipView } from '@codemirror/view';
import {
  findEnclosingMathSpan,
  handleInlineSummonOrUpgrade,
  createEmptyInlineSession,
  createActiveInlineSession,
  type InlineMathSpan,
} from '@mathslot/core';
import InlineBottomPanel from './InlineBottomPanel.svelte';
import { InlineSplitWorkbenchStore } from './InlineSplitStore.svelte';
import InlineTopPanel from './InlineTopPanel.svelte';

export interface SplitExtensionRuntimePrefs {
  enabled: boolean;
  autoActivateOnClick: boolean;
}

export interface MathSlotInlineExtensionOptions {
  getPrefs: () => SplitExtensionRuntimePrefs;
  store: InlineSplitWorkbenchStore;
  openWorkbenchAtSpan: (view: EditorView, span: InlineMathSpan) => void;
}

export interface MathSlotInlineController {
  extension: Extension;
  summonOrUpgrade: (view?: EditorView | null) => boolean;
}

interface ActiveSpanState {
  active: boolean;
  span: InlineMathSpan | null;
}

const setActiveSpanEffect = StateEffect.define<ActiveSpanState>();
const fromEngineSyncEffect = StateEffect.define<InlineMathSpan>();

function getLocalMathSpan(state: EditorState, pos: number): InlineMathSpan | null {
  const radius = 16000;
  const winStart = Math.max(0, pos - radius);
  const winEnd = Math.min(state.doc.length, pos + radius);
  const slice = state.doc.sliceString(winStart, winEnd);
  const local = findEnclosingMathSpan(slice, pos - winStart);
  if (!local) return null;
  return {
    rawFrom: local.rawFrom + winStart,
    rawTo: local.rawTo + winStart,
    contentFrom: local.contentFrom + winStart,
    contentTo: local.contentTo + winStart,
    isBlock: local.isBlock,
  };
}

/**
 * Aligns the panel's left edge and width with Obsidian's actual note text column (`view.contentDOM`)
 * so both bars match the page width cleanly regardless of where `$...$` sits in the sentence.
 */
function alignToNoteColumn(view: EditorView, hostDom: HTMLElement): void {
  const panelEl = hostDom.firstElementChild as HTMLElement | null;
  const tipParent = hostDom.parentElement;
  if (!panelEl || !tipParent) return;
  const contentRect = view.contentDOM.getBoundingClientRect();
  if (contentRect.width < 120) return;

  // Measure actual inner text column width excluding horizontal padding of `.cm-content`
  const cs = window.getComputedStyle(view.contentDOM);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const targetLeft = contentRect.left + padL;
  const targetWidth = Math.max(260, contentRect.width - padL - padR);

  const tipRect = tipParent.getBoundingClientRect();
  panelEl.style.width = `${Math.round(targetWidth)}px`;
  panelEl.style.transform = `translateX(${Math.round(targetLeft - tipRect.left)}px)`;
}

export function createMathSlotInlineController(
  opts: MathSlotInlineExtensionOptions,
): MathSlotInlineController {
  let activeView: EditorView | null = null;
  let currentSpan: InlineMathSpan | null = null;

  const syncDocSpanToStore = (state: EditorState, span: InlineMathSpan): void => {
    currentSpan = span;
    const rawInner = state.doc.sliceString(span.contentFrom, span.contentTo);
    const firstLine = state.doc.lineAt(span.rawFrom).text;
    opts.store.loadFromDocumentSpan(rawInner, firstLine, span);
  };

  opts.store.bindCallbacks({
    writeLatexToDocument(formattedInner: string) {
      if (!activeView || !currentSpan) return;
      const oldSpan = currentSpan;
      const delta = formattedInner.length - (oldSpan.contentTo - oldSpan.contentFrom);
      const updatedSpan: InlineMathSpan = {
        ...oldSpan,
        contentTo: oldSpan.contentFrom + formattedInner.length,
        rawTo: oldSpan.rawTo + delta,
      };
      currentSpan = updatedSpan;
      activeView.dispatch({
        changes: {
          from: oldSpan.contentFrom,
          to: oldSpan.contentTo,
          insert: formattedInner,
        },
        selection: EditorSelection.cursor(updatedSpan.contentTo),
        effects: fromEngineSyncEffect.of(updatedSpan),
        userEvent: 'input.type',
      });
    },
    completeAndExitToOutside() {
      if (!activeView || !currentSpan) return;
      const exitPos = Math.min(activeView.state.doc.length, currentSpan.rawTo);
      currentSpan = null;
      activeView.dispatch({
        selection: EditorSelection.cursor(exitPos),
        effects: setActiveSpanEffect.of({ active: false, span: null }),
        scrollIntoView: true,
      });
      activeView.focus();
    },
    upgradeInlineToBlock() {
      if (!activeView || !currentSpan || currentSpan.isBlock) return;
      const lineEnd = activeView.state.doc.lineAt(currentSpan.rawTo).to;
      const docSlice = activeView.state.doc.sliceString(
        0,
        Math.min(activeView.state.doc.length, lineEnd + 2),
      );
      const res = handleInlineSummonOrUpgrade(
        docSlice,
        currentSpan.contentTo,
        currentSpan.contentTo,
        createActiveInlineSession(),
        currentSpan,
      );
      if (res.kind === 'handled' && res.changes && res.selection !== undefined) {
        activeView.dispatch({
          changes: res.changes,
          selection: EditorSelection.cursor(res.selection),
          userEvent: 'input.type',
          scrollIntoView: true,
        });
        const newSpan = getLocalMathSpan(activeView.state, activeView.state.selection.main.head);
        if (newSpan) {
          syncDocSpanToStore(activeView.state, newSpan);
          activeView.dispatch({
            effects: setActiveSpanEffect.of({ active: true, span: newSpan }),
          });
        }
        requestAnimationFrame(() => opts.store.focusCanvas());
      }
    },
    openFullModalWorkbench() {
      if (!activeView || !currentSpan) return;
      const spanToOpen = currentSpan;
      currentSpan = null;
      activeView.dispatch({
        effects: setActiveSpanEffect.of({ active: false, span: null }),
      });
      opts.openWorkbenchAtSpan(activeView, spanToOpen);
    },
  });

  const spanField = StateField.define<ActiveSpanState>({
    create: () => ({ active: false, span: null }),
    update(value, tr) {
      for (const eff of tr.effects) {
        if (eff.is(setActiveSpanEffect)) {
          currentSpan = eff.value.span;
          return eff.value;
        }
        if (eff.is(fromEngineSyncEffect)) {
          return { active: true, span: eff.value };
        }
      }

      if (!tr.docChanged && !tr.selection) {
        return value;
      }

      const prefs = opts.getPrefs();
      if (!prefs.enabled) {
        currentSpan = null;
        return { active: false, span: null };
      }

      const sel = tr.state.selection.main;
      const mathSpan = getLocalMathSpan(tr.state, sel.head);
      if (!mathSpan || sel.from < mathSpan.contentFrom || sel.to > mathSpan.contentTo) {
        currentSpan = null;
        return { active: false, span: null };
      }

      const nextActive = value.active || prefs.autoActivateOnClick;
      if (!nextActive) {
        return { active: false, span: null };
      }

      syncDocSpanToStore(tr.state, mathSpan);
      return { active: true, span: mathSpan };
    },
  });

  // Stable `create` functions so CodeMirror 6 keeps Svelte panels mounted across keystrokes!
  const createTopTooltipView = (view: EditorView): TooltipView => {
    activeView = view;
    const dom = document.createElement('div');
    dom.className = 'mathslot-split-host mathslot-split-host-top';
    const instance = mount(InlineTopPanel, {
      target: dom,
      props: { store: opts.store },
    });
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => alignToNoteColumn(view, dom))
        : null;
    ro?.observe(view.contentDOM);

    return {
      dom,
      mount() {
        requestAnimationFrame(() => alignToNoteColumn(view, dom));
      },
      update() {
        alignToNoteColumn(view, dom);
      },
      positioned() {
        alignToNoteColumn(view, dom);
      },
      destroy() {
        ro?.disconnect();
        void unmount(instance);
      },
    };
  };

  const createBottomTooltipView = (view: EditorView): TooltipView => {
    activeView = view;
    const dom = document.createElement('div');
    dom.className = 'mathslot-split-host mathslot-split-host-bottom';
    const instance = mount(InlineBottomPanel, {
      target: dom,
      props: { store: opts.store },
    });
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => alignToNoteColumn(view, dom))
        : null;
    ro?.observe(view.contentDOM);

    return {
      dom,
      mount() {
        requestAnimationFrame(() => alignToNoteColumn(view, dom));
      },
      update() {
        alignToNoteColumn(view, dom);
      },
      positioned() {
        alignToNoteColumn(view, dom);
      },
      destroy() {
        ro?.disconnect();
        void unmount(instance);
      },
    };
  };

  const topPanelExt = showTooltip.compute([spanField], (state): Tooltip | null => {
    const st = state.field(spanField);
    if (!st.active || !st.span) return null;
    return {
      pos: st.span.rawFrom,
      above: true,
      strictSide: true,
      arrow: false,
      create: createTopTooltipView,
    };
  });

  const bottomPanelExt = showTooltip.compute([spanField], (state): Tooltip | null => {
    const st = state.field(spanField);
    if (!st.active || !st.span) return null;
    return {
      pos: st.span.rawTo,
      above: false,
      strictSide: true,
      arrow: false,
      create: createBottomTooltipView,
    };
  });

  const editorAttrsExt = EditorView.editorAttributes.compute([spanField], (state) => {
    const st = state.field(spanField);
    if (!st.active || !st.span) return null;
    return {
      class: st.span.isBlock
        ? 'mathslot-inline-active mathslot-inline-block-active'
        : 'mathslot-inline-active',
    };
  });

  const summonOrUpgrade = (explicitView?: EditorView | null): boolean => {
    const view = explicitView ?? activeView;
    if (!view) return false;
    activeView = view;
    const sel = view.state.selection.main;
    const mathSpan = sel.empty ? getLocalMathSpan(view.state, sel.head) : null;
    const st = view.state.field(spanField);

    if (!mathSpan) {
      const selected = view.state.doc.sliceString(sel.from, sel.to);
      const insert = `$${selected}$`;
      const cursor = sel.from + 1 + selected.length;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: EditorSelection.cursor(cursor),
        userEvent: 'input.type',
        scrollIntoView: true,
      });
      const createdSpan = getLocalMathSpan(view.state, cursor);
      if (createdSpan) {
        syncDocSpanToStore(view.state, createdSpan);
        view.dispatch({
          effects: setActiveSpanEffect.of({ active: true, span: createdSpan }),
        });
        requestAnimationFrame(() => opts.store.focusCanvas());
      }
      return true;
    }

    if (!st.active) {
      syncDocSpanToStore(view.state, mathSpan);
      view.dispatch({
        effects: setActiveSpanEffect.of({ active: true, span: mathSpan }),
        scrollIntoView: true,
      });
      requestAnimationFrame(() => opts.store.focusCanvas());
      return true;
    }

    if (!mathSpan.isBlock) {
      const lineEnd = view.state.doc.lineAt(mathSpan.rawTo).to;
      const docSlice = view.state.doc.sliceString(
        0,
        Math.min(view.state.doc.length, lineEnd + 2),
      );
      const res = handleInlineSummonOrUpgrade(
        docSlice,
        sel.from,
        sel.to,
        createActiveInlineSession(),
        mathSpan,
      );
      if (res.kind === 'handled' && res.changes && res.selection !== undefined) {
        view.dispatch({
          changes: res.changes,
          selection: EditorSelection.cursor(res.selection),
          userEvent: 'input.type',
          scrollIntoView: true,
        });
        const newSpan = getLocalMathSpan(view.state, view.state.selection.main.head);
        if (newSpan) {
          syncDocSpanToStore(view.state, newSpan);
          view.dispatch({
            effects: setActiveSpanEffect.of({ active: true, span: newSpan }),
          });
        }
        requestAnimationFrame(() => opts.store.focusCanvas());
      }
      return true;
    }

    // Already active in block `$$...$$`: exit past closing `$$`
    const exitPos = Math.min(view.state.doc.length, mathSpan.rawTo);
    currentSpan = null;
    view.dispatch({
      selection: EditorSelection.cursor(exitPos),
      effects: setActiveSpanEffect.of({ active: false, span: null }),
      scrollIntoView: true,
    });
    view.focus();
    return true;
  };

  const keyHandlerExt = Prec.highest(
    EditorView.domEventHandlers({
      focus(_event: FocusEvent, view: EditorView): boolean {
        activeView = view;
        return false;
      },
      keydown(event: KeyboardEvent, view: EditorView): boolean {
        activeView = view;
        if (event.isComposing || event.keyCode === 229) return false;

        const st = view.state.field(spanField);
        if (!st.active || !st.span) return false;

        const mod = event.ctrlKey || event.metaKey;

        // Pressing LeaderKey (`Tab`) inside raw Markdown `$...$` line seamlessly hands over to 2D Canvas Leader Mode!
        if (
          !mod &&
          !event.altKey &&
          !event.shiftKey &&
          event.key === opts.store.settings.leaderKey
        ) {
          event.preventDefault();
          opts.store.focusCanvas();
          opts.store.engine.triggerLeader();
          return true;
        }

        // Pressing Ctrl+Enter, Escape, or plain Enter (on inline `$...$`) inside Markdown `$...$` completes & exits past `$`!
        if (
          (mod && event.key === 'Enter') ||
          event.key === 'Escape' ||
          (!st.span.isBlock && !mod && !event.shiftKey && event.key === 'Enter')
        ) {
          event.preventDefault();
          const exitPos = Math.min(view.state.doc.length, st.span.rawTo);
          currentSpan = null;
          view.dispatch({
            selection: EditorSelection.cursor(exitPos),
            effects: setActiveSpanEffect.of({ active: false, span: null }),
            scrollIntoView: true,
          });
          return true;
        }

        return false;
      },
    }),
  );

  return {
    extension: [spanField, topPanelExt, bottomPanelExt, editorAttrsExt, keyHandlerExt],
    summonOrUpgrade,
  };
}

import { mount, unmount } from 'svelte';
import {
  Annotation,
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  showPanel,
  type DecorationSet,
  type Panel,
  type PanelConstructor,
  type ViewUpdate,
} from '@codemirror/view';
import {
  canonicalBlockquotePrefix,
  detectFormulaInWindow,
  extractBlockquotePrefix,
  formatDockedFormulaText,
  type AppSettings,
  type CommandDef,
  type CustomCommandDef,
  type MathWrapperKind,
  type Snippet,
} from '@mathslot/core';
import DockedMathPanel from './DockedMathPanel.svelte';
import {
  DockedMathStore,
  type DockBinding,
  type DockOwnershipMode,
} from './dockStore.svelte';

export interface DockExtensionRuntimePrefs {
  enabled: boolean;
  autoShowOnFormulaCursor: boolean;
  semicolonExitsAtRoot: boolean;
}

export interface DockSharedConfig {
  settings: AppSettings;
  effectiveCommands: readonly CommandDef[];
  customCommands: CustomCommandDef[];
  snippets: Snippet[];
  semicolonExitsAtRoot: boolean;
}

export interface MathSlotDockExtensionOptions {
  getPrefs: () => DockExtensionRuntimePrefs;
  getSharedConfig: () => DockSharedConfig;
  openModalAtSpan: (view: EditorView, binding: DockBinding) => void;
}

export interface MathSlotDockController {
  extension: Extension;
  summonOrToggle: (view?: EditorView | null, forceBlock?: boolean) => boolean;
  broadcastConfig: (config: DockSharedConfig) => void;
}

const fromMathSlotEngine = Annotation.define<boolean>();
const openDockEffect = StateEffect.define<DockBinding>();
const closeDockEffect = StateEffect.define<null>();
const updateDockModeEffect = StateEffect.define<DockOwnershipMode>();
const updateDockBindingEffect = StateEffect.define<DockBinding>();

function editorPosToOffset(state: EditorState, lineZeroBased: number, ch: number): number {
  const line = state.doc.line(Math.max(1, Math.min(state.doc.lines, lineZeroBased + 1)));
  return Math.max(line.from, Math.min(line.to, line.from + ch));
}

function detectFormulaInCM6(
  state: EditorState,
  headPos: number,
  strictInterior: boolean,
): {
  raw: string;
  rawFrom: number;
  rawTo: number;
  wrapper: MathWrapperKind;
  linePrefix: string;
  includeFirstLinePrefix: boolean;
} | null {
  const cursorLineObj = state.doc.lineAt(headPos);
  const cursorLineZero = cursorLineObj.number - 1;
  const cursorCh = headPos - cursorLineObj.from;
  const startLineOne = Math.max(1, cursorLineObj.number - 200);
  const endLineOne = Math.min(state.doc.lines, cursorLineObj.number + 200);

  const windowLines: string[] = [];
  for (let l = startLineOne; l <= endLineOne; l += 1) {
    windowLines.push(state.doc.line(l).text);
  }

  const hit = detectFormulaInWindow(
    windowLines,
    startLineOne - 1,
    { line: cursorLineZero, ch: cursorCh },
    false,
    strictInterior,
  );
  if (!hit) return null;

  return {
    raw: hit.raw,
    rawFrom: editorPosToOffset(state, hit.from.line, hit.from.ch),
    rawTo: editorPosToOffset(state, hit.to.line, hit.to.ch),
    wrapper: hit.wrapper,
    linePrefix: hit.linePrefix,
    includeFirstLinePrefix: hit.includeFirstLinePrefix,
  };
}

interface DockViewContext {
  store: DockedMathStore;
  panelConstructor: PanelConstructor;
}

export function createMathSlotDockController(
  opts: MathSlotDockExtensionOptions,
): MathSlotDockController {
  let lastFocusedView: EditorView | null = null;
  const viewContexts = new WeakMap<EditorView, DockViewContext>();
  const activeContexts = new Set<DockViewContext>();

  const dockField = StateField.define<DockBinding | null>({
    create: () => null,
    update(value, tr) {
      let next = value;

      // Apply explicit effects first
      for (const eff of tr.effects) {
        if (eff.is(closeDockEffect)) {
          return null;
        }
        if (eff.is(openDockEffect)) {
          next = eff.value;
        } else if (eff.is(updateDockBindingEffect)) {
          next = eff.value;
        } else if (eff.is(updateDockModeEffect) && next) {
          next = { ...next, mode: eff.value };
        }
      }

      // CRITICAL ZERO-LOOP GUARD: Engine-initiated document sync transactions NEVER re-run
      // formula detection or flip ownership; they carry exact `updateDockBindingEffect`!
      if (tr.annotation(fromMathSlotEngine)) {
        return next;
      }

      if (!tr.docChanged && !tr.selection) {
        return next;
      }

      const prefs = opts.getPrefs();
      if (!prefs.enabled) {
        return null;
      }

      const sel = tr.state.selection.main;

      // If canvas currently owns edits, preserve ownership while CM6 selection remains inside
      // (only downgrade or close if the user actively clicked/moved CM6 cursor back into text)
      if (next && next.mode === 'canvas-owned') {
        const mappedFrom = tr.changes.mapPos(next.rawFrom, 1);
        const mappedTo = Math.max(mappedFrom, tr.changes.mapPos(next.rawTo, 1));
        if (tr.selection) {
          if (sel.from > mappedFrom && sel.to < mappedTo) {
            return {
              ...next,
              rawFrom: mappedFrom,
              rawTo: mappedTo,
              mode: 'doc-follow',
            };
          }
          return null;
        }
        return {
          ...next,
          rawFrom: mappedFrom,
          rawTo: mappedTo,
        };
      }

      // Passive / doc-follow mode
      if (!next && !prefs.autoShowOnFormulaCursor) {
        return null;
      }

      const hit = detectFormulaInCM6(tr.state, sel.head, true);
      if (!hit || sel.from < hit.rawFrom || sel.to > hit.rawTo) {
        return null;
      }

      return {
        mode: 'doc-follow',
        rawFrom: hit.rawFrom,
        rawTo: hit.rawTo,
        wrapper: hit.wrapper,
        linePrefix: hit.linePrefix,
        includeFirstLinePrefix: hit.includeFirstLinePrefix,
        createdEmpty: false,
      };
    },
  });

  const getOrCreateContext = (view: EditorView): DockViewContext => {
    const existing = viewContexts.get(view);
    if (existing) return existing;

    const store = new DockedMathStore();
    store.syncExternalConfig(opts.getSharedConfig());

    store.bindCallbacks({
      writeEngineLatex(latex: string, keepEmptyShell: boolean) {
        const cur = view.state.field(dockField);
        if (!cur || cur.mode !== 'canvas-owned') return;
        const formatted = formatDockedFormulaText(
          latex,
          cur.wrapper,
          cur.linePrefix,
          cur.includeFirstLinePrefix,
          keepEmptyShell,
        );
        const newTo = cur.rawFrom + formatted.length;
        const nextBinding: DockBinding = {
          ...cur,
          rawTo: newTo,
          createdEmpty: cur.createdEmpty && latex.trim() === '',
        };
        const safeAnchor = Math.min(newTo, cur.rawFrom + 1);
        view.dispatch({
          changes: { from: cur.rawFrom, to: cur.rawTo, insert: formatted },
          selection: EditorSelection.cursor(safeAnchor),
          effects: updateDockBindingEffect.of(nextBinding),
          annotations: [fromMathSlotEngine.of(true)],
          userEvent: 'input.type',
        });
      },
      promoteMode(mode: DockOwnershipMode) {
        const cur = view.state.field(dockField);
        if (!cur || cur.mode === mode) return;
        view.dispatch({
          effects: updateDockModeEffect.of(mode),
          annotations: [fromMathSlotEngine.of(true)],
        });
      },
      switchWrapper(nextWrapper: MathWrapperKind, currentLatex: string) {
        const cur = view.state.field(dockField);
        if (!cur) return;
        const formatted = formatDockedFormulaText(
          currentLatex,
          nextWrapper,
          cur.linePrefix,
          cur.includeFirstLinePrefix,
          true,
        );
        const newTo = cur.rawFrom + formatted.length;
        const nextBinding: DockBinding = {
          ...cur,
          mode: 'canvas-owned',
          wrapper: nextWrapper,
          rawTo: newTo,
        };
        const safeAnchor = Math.min(newTo, cur.rawFrom + (nextWrapper.endsWith('block') ? 3 : 1));
        view.dispatch({
          changes: { from: cur.rawFrom, to: cur.rawTo, insert: formatted },
          selection: EditorSelection.cursor(safeAnchor),
          effects: updateDockBindingEffect.of(nextBinding),
          annotations: [fromMathSlotEngine.of(true)],
          userEvent: 'input.type',
          scrollIntoView: true,
        });
      },
      completeAndExit(deleteIfEmptyCreated: boolean) {
        const cur = view.state.field(dockField);
        if (!cur) {
          view.focus();
          return;
        }
        if (deleteIfEmptyCreated && cur.createdEmpty) {
          view.dispatch({
            changes: { from: cur.rawFrom, to: cur.rawTo, insert: '' },
            selection: EditorSelection.cursor(cur.rawFrom),
            effects: closeDockEffect.of(null),
            annotations: [fromMathSlotEngine.of(true)],
            scrollIntoView: true,
          });
        } else {
          const exitPos = Math.min(view.state.doc.length, cur.rawTo);
          view.dispatch({
            selection: EditorSelection.cursor(exitPos),
            effects: closeDockEffect.of(null),
            annotations: [fromMathSlotEngine.of(true)],
            scrollIntoView: true,
          });
        }
        view.focus();
      },
      openFullModalWorkbench() {
        const cur = view.state.field(dockField);
        if (!cur) return;
        view.dispatch({
          effects: closeDockEffect.of(null),
          annotations: [fromMathSlotEngine.of(true)],
        });
        opts.openModalAtSpan(view, cur);
      },
    });

    const panelConstructor: PanelConstructor = (): Panel => {
      const dom = document.createElement('div');
      dom.className = 'mathslot-dock-host';
      let instance: Record<string, unknown> | null = null;

      const syncLatestDocFollow = (state: EditorState) => {
        const binding = state.field(dockField);
        if (!binding) return;
        if (binding.mode === 'doc-follow') {
          const rawSlice = state.doc.sliceString(binding.rawFrom, binding.rawTo);
          store.loadFromDocument(rawSlice, binding);
        } else {
          store.syncBindingMeta(binding);
        }
      };

      return {
        dom,
        top: false,
        mount() {
          activeContexts.add(ctx);
          store.syncExternalConfig(opts.getSharedConfig());
          syncLatestDocFollow(view.state);
          instance = mount(DockedMathPanel, {
            target: dom,
            props: { store },
          });
          if (view.state.field(dockField)?.mode === 'canvas-owned') {
            requestAnimationFrame(() => store.focusCanvas());
          }
        },
        update(update: ViewUpdate) {
          const cur = update.state.field(dockField);
          if (!cur) return;
          if (update.transactions.some((t) => Boolean(t.annotation(fromMathSlotEngine)))) {
            store.syncBindingMeta(cur);
            return;
          }
          if (cur.mode === 'doc-follow' && (update.docChanged || update.selectionSet)) {
            syncLatestDocFollow(update.state);
          } else {
            store.syncBindingMeta(cur);
          }
        },
        destroy() {
          activeContexts.delete(ctx);
          if (instance) {
            void unmount(instance);
            instance = null;
          }
          dom.empty?.();
        },
      };
    };

    const ctx: DockViewContext = { store, panelConstructor };
    viewContexts.set(view, ctx);
    return ctx;
  };

  // Register panel factory via CM6 ViewPlugin-like lookup keyed by EditorView? Wait:
  // `showPanel.compute([dockField], (state) => PanelConstructor | null)` receives `state` (no `view`),
  // while CM6 calls the returned `PanelConstructor(view)` passing the `EditorView`!
  // Returning a SINGLE stable outer `PanelConstructor` delegates directly to `getOrCreateContext(view).panelConstructor(view)`!
  const stableDockPanelConstructor: PanelConstructor = (view: EditorView): Panel => {
    lastFocusedView = view;
    return getOrCreateContext(view).panelConstructor(view);
  };

  const dockPanelExt = showPanel.compute([dockField], (state): PanelConstructor | null =>
    state.field(dockField) ? stableDockPanelConstructor : null,
  );

  const boundMarkDecoExt = EditorView.decorations.compute([dockField], (state): DecorationSet => {
    const binding = state.field(dockField);
    if (!binding || binding.rawFrom >= binding.rawTo) return Decoration.none;
    const len = state.doc.length;
    const from = Math.max(0, Math.min(len, binding.rawFrom));
    const to = Math.max(from, Math.min(len, binding.rawTo));
    if (from >= to) return Decoration.none;
    const ranges: Range<Decoration>[] = [
      Decoration.mark({
        class:
          binding.mode === 'canvas-owned'
            ? 'mathslot-bound-formula is-owned'
            : 'mathslot-bound-formula',
      }).range(from, to),
    ];
    return Decoration.set(ranges, true);
  });

  const summonOrToggle = (explicitView?: EditorView | null, forceBlock = false): boolean => {
    const view = explicitView ?? lastFocusedView;
    if (!view) return false;
    lastFocusedView = view;
    const ctx = getOrCreateContext(view);
    ctx.store.syncExternalConfig(opts.getSharedConfig());

    const sel = view.state.selection.main;
    const curBinding = view.state.field(dockField);
    const existingHit = sel.empty ? detectFormulaInCM6(view.state, sel.head, false) : null;

    if (!existingHit) {
      const selected = view.state.doc.sliceString(sel.from, sel.to);
      const lineObj = view.state.doc.lineAt(sel.from);
      const split = extractBlockquotePrefix(lineObj.text);
      const colInLine = sel.from - lineObj.from;
      const linePrefix =
        split.prefix && colInLine >= split.prefix.length ? canonicalBlockquotePrefix(split.prefix) : '';
      const includeFirstLinePrefix = false;
      const wrapper: MathWrapperKind = forceBlock ? 'dollar_block' : 'dollar_inline';
      const insert = formatDockedFormulaText(
        selected,
        wrapper,
        linePrefix,
        includeFirstLinePrefix,
        true,
      );
      const binding: DockBinding = {
        mode: 'canvas-owned',
        rawFrom: sel.from,
        rawTo: sel.from + insert.length,
        wrapper,
        linePrefix,
        includeFirstLinePrefix,
        createdEmpty: selected.trim() === '',
      };
      ctx.store.loadFromDocument(insert, binding);
      const safeAnchor = Math.min(binding.rawTo, sel.from + (forceBlock ? 3 : 1));
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: EditorSelection.cursor(safeAnchor),
        effects: openDockEffect.of(binding),
        annotations: [fromMathSlotEngine.of(true)],
        userEvent: 'input.type',
        scrollIntoView: true,
      });
      requestAnimationFrame(() => ctx.store.focusCanvas());
      return true;
    }

    if (!curBinding) {
      const binding: DockBinding = {
        mode: 'canvas-owned',
        rawFrom: existingHit.rawFrom,
        rawTo: existingHit.rawTo,
        wrapper: existingHit.wrapper,
        linePrefix: existingHit.linePrefix,
        includeFirstLinePrefix: existingHit.includeFirstLinePrefix,
        createdEmpty: false,
      };
      ctx.store.loadFromDocument(existingHit.raw, binding);
      view.dispatch({
        effects: openDockEffect.of(binding),
        annotations: [fromMathSlotEngine.of(true)],
        scrollIntoView: true,
      });
      requestAnimationFrame(() => ctx.store.focusCanvas());
      return true;
    }

    if (curBinding.mode === 'doc-follow') {
      ctx.store.loadFromDocument(existingHit.raw, { ...curBinding, mode: 'canvas-owned' });
      view.dispatch({
        effects: updateDockModeEffect.of('canvas-owned'),
        annotations: [fromMathSlotEngine.of(true)],
        scrollIntoView: true,
      });
      requestAnimationFrame(() => ctx.store.focusCanvas());
      return true;
    }

    // Already active in `canvas-owned`: Alt+M toggles inline <-> block (or stays block when forceBlock)
    if (forceBlock && (curBinding.wrapper === 'dollar_block' || curBinding.wrapper === 'bracket_block')) {
      ctx.store.focusCanvas();
      return true;
    }
    ctx.store.toggleWrapper();
    return true;
  };

  const docKeyHandlerExt = Prec.highest(
    EditorView.domEventHandlers({
      focus(_event: FocusEvent, view: EditorView): boolean {
        lastFocusedView = view;
        return false;
      },
      keydown(event: KeyboardEvent, view: EditorView): boolean {
        lastFocusedView = view;
        if (event.isComposing || event.keyCode === 229) return false;
        const binding = view.state.field(dockField);
        if (!binding || binding.mode !== 'doc-follow') return false;

        const mod = event.ctrlKey || event.metaKey;
        const shared = opts.getSharedConfig();

        // Pressing `Tab` (leaderKey) inside a docked doc-follow formula promotes into 2D canvas leader mode!
        if (
          !mod &&
          !event.altKey &&
          !event.shiftKey &&
          event.key === shared.settings.leaderKey
        ) {
          event.preventDefault();
          const ctx = getOrCreateContext(view);
          const rawSlice = view.state.doc.sliceString(binding.rawFrom, binding.rawTo);
          ctx.store.loadFromDocument(rawSlice, { ...binding, mode: 'canvas-owned' });
          view.dispatch({
            effects: updateDockModeEffect.of('canvas-owned'),
            annotations: [fromMathSlotEngine.of(true)],
          });
          ctx.store.focusCanvas();
          ctx.store.engine.triggerLeader();
          return true;
        }

        // Ctrl+Enter or Escape completes & jumps right outside `$`
        if ((mod && event.key === 'Enter') || event.key === 'Escape') {
          event.preventDefault();
          const exitPos = Math.min(view.state.doc.length, binding.rawTo);
          view.dispatch({
            selection: EditorSelection.cursor(exitPos),
            effects: closeDockEffect.of(null),
            annotations: [fromMathSlotEngine.of(true)],
            scrollIntoView: true,
          });
          return true;
        }

        return false;
      },
    }),
  );

  const broadcastConfig = (config: DockSharedConfig): void => {
    for (const ctx of activeContexts) {
      ctx.store.syncExternalConfig(config);
    }
  };

  return {
    extension: [dockField, dockPanelExt, boundMarkDecoExt, docKeyHandlerExt],
    summonOrToggle,
    broadcastConfig,
  };
}

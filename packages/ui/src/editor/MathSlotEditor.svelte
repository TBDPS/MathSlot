<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Annotation, Compartment, EditorState as CmEditorState } from '@codemirror/state';
  import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view';
  import '../theme/tokens.css';
  import {
    createEmptySnapshot,
    isNavEditorState,
    type AppEvent,
    type EngineClient,
    type EngineSnapshot,
    type ShortcutSettings,
  } from '../client/engine';
  import {
    createCommandDecorationsExtension,
    describeEditorMode,
    formatSlotAriaLabel,
    resolveActiveCommand,
    setEngineSnapshotEffect,
  } from './decorations';
  import {
    createMathSlotKeymapExtension,
    navModeFacet,
    resolveShortcutSettings,
    shortcutsFacet,
  } from './keymap';
  import { matchesShortcut } from '../settings/shortcuts';

  export interface MathSlotEditorProps {
    client: EngineClient;
    snapshot?: EngineSnapshot;
    initialDoc?: string;
    theme?: 'light' | 'dark' | 'auto';
    ariaLabel?: string;
    placeholderText?: string;
    shortcuts?: Partial<ShortcutSettings>;
    onFocusEscape?: (direction: 'forward' | 'backward') => void;
    onViewReady?: (view: EditorView) => void;
    onSnapshotChange?: (snapshot: EngineSnapshot) => void;
    onCopyLatex?: () => void;
    onSaveSnippet?: () => void;
    onFocusEditor?: () => void;
    onToggleNav?: () => void;
    onOpenSettings?: () => void;
  }

  let {
    client,
    snapshot: externalSnapshot,
    initialDoc = '',
    theme = 'auto',
    ariaLabel = 'MathSlot 公式编辑器',
    placeholderText = '输入公式，或按 ▸ 触发命令（支持多行换行）…',
    shortcuts,
    onFocusEscape,
    onViewReady,
    onSnapshotChange,
    onCopyLatex,
    onSaveSnippet,
    onFocusEditor,
    onToggleNav,
    onOpenSettings,
  }: MathSlotEditorProps = $props();

  let hostEl: HTMLDivElement | null = null;
  let view: EditorView | null = null;
  const navCompartment = new Compartment();
  const shortcutsCompartment = new Compartment();
  const externalSyncAnnotation = Annotation.define<boolean>();

  let internalSnapshot = $state<EngineSnapshot>(createEmptySnapshot());
  let docText = $state('');
  let isComposing = $state(false);
  let lineCount = $state(1);

  const activeSnapshot = $derived(externalSnapshot ?? internalSnapshot);
  const resolvedShortcuts = $derived(
    resolveShortcutSettings(shortcuts ?? activeSnapshot.settings?.shortcuts),
  );
  const modeInfo = $derived(describeEditorMode(activeSnapshot.state, isComposing));
  const activeCommand = $derived(resolveActiveCommand(activeSnapshot, docText));
  const resolvedThemeAttr = $derived(theme === 'auto' ? undefined : theme);

  export function focus(): void {
    view?.focus();
  }

  export function setSnapshot(next: EngineSnapshot): void {
    internalSnapshot = next;
    externalSnapshot = undefined;
    syncViewWithSnapshot(next);
    onSnapshotChange?.(next);
  }

  function syncViewWithSnapshot(snap: EngineSnapshot): void {
    if (!view) return;
    const isNav = snap.is_nav_mode || isNavEditorState(snap.state);
    const effects = [
      navCompartment.reconfigure(navModeFacet.of(isNav)),
      setEngineSnapshotEffect.of(snap),
    ];
    if (typeof snap.source === 'string') {
      const currentDoc = view.state.doc.toString();
      const targetLen = snap.source.length;
      const nextAnchor =
        typeof snap.cursor_char === 'number'
          ? Math.max(0, Math.min(snap.cursor_char, targetLen))
          : Math.min(view.state.selection.main.head, targetLen);
      const needsDocChange = snap.source !== currentDoc;
      const needsSelChange =
        !isComposing &&
        typeof snap.cursor_char === 'number' &&
        view.state.selection.main.head !== nextAnchor;
      if (needsDocChange || needsSelChange) {
        view.dispatch({
          ...(needsDocChange
            ? { changes: { from: 0, to: currentDoc.length, insert: snap.source } }
            : {}),
          selection: { anchor: nextAnchor },
          annotations: externalSyncAnnotation.of(true),
          effects,
        });
        return;
      }
    }
    view.dispatch({ effects });
  }

  let dispatchSeq = 0;

  function handleEngineEvent(event: AppEvent): void {
    const seq = ++dispatchSeq;
    void client.dispatch(event).then((resp) => {
      if (seq !== dispatchSeq) {
        return;
      }
      internalSnapshot = resp.snapshot;
      syncViewWithSnapshot(resp.snapshot);
      onSnapshotChange?.(resp.snapshot);
    });
  }

  onMount(() => {
    const startSnap = externalSnapshot ?? internalSnapshot;
    const startDoc =
      typeof startSnap.source === 'string' && startSnap.source.length > 0
        ? startSnap.source
        : initialDoc;
    docText = startDoc;
    if (externalSnapshot) {
      internalSnapshot = externalSnapshot;
    }

    if (!hostEl) return;

    const isInitialNav = startSnap.is_nav_mode || isNavEditorState(startSnap.state);

    const cmTheme = EditorView.theme({
      '&': {
        backgroundColor: 'var(--ms-surface)',
        color: 'var(--ms-fg)',
        fontFamily: 'var(--ms-font-mono)',
        fontSize: '0.95rem',
        lineHeight: '1.6',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'var(--ms-font-mono)',
      },
      '.cm-content': {
        padding: '10px 12px',
        minHeight: '84px',
        caretColor: 'var(--ms-accent)',
      },
      '&.cm-focused': {
        outline: '2px solid var(--ms-focus-ring)',
        outlineOffset: '-2px',
      },
      '.cm-line': {
        padding: '0 2px',
      },
    });

    const state = CmEditorState.create({
      doc: startDoc,
      extensions: [
        cmTheme,
        cmPlaceholder(placeholderText),
        createCommandDecorationsExtension(),
        createMathSlotKeymapExtension({
          dispatchEvent: handleEngineEvent,
          onFocusEscape,
          onCompositionChange: (composing) => {
            isComposing = composing;
          },
          navCompartment,
          shortcutsCompartment,
          initialNavMode: isInitialNav,
          shortcuts: resolvedShortcuts,
          shortcutCallbacks: {
            onCopyLatex: () => {
              if (onCopyLatex) {
                onCopyLatex();
              } else {
                handleEngineEvent('RequestCopy');
              }
            },
            onSaveSnippet: () => {
              if (onSaveSnippet) {
                onSaveSnippet();
              } else {
                handleEngineEvent('RequestSaveSnippet');
              }
            },
            onFocusEditor: () => {
              onFocusEditor?.();
            },
            onToggleNav: () => {
              onToggleNav?.();
            },
            onOpenSettings: () => {
              onOpenSettings?.();
            },
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            docText = update.state.doc.toString();
            lineCount = update.state.doc.lines;
          }
        }),
        EditorView.contentAttributes.of({
          'aria-label': ariaLabel,
          'aria-multiline': 'true',
        }),
      ],
    });

    lineCount = state.doc.lines;
    view = new EditorView({
      state,
      parent: hostEl,
    });

    syncViewWithSnapshot(startSnap);
    onViewReady?.(view);

    const handleWindowKeydown = (evt: KeyboardEvent) => {
      if (!view || evt.defaultPrevented || evt.isComposing || isComposing) {
        return;
      }
      if (evt.key === 'Tab' || evt.key === 'Escape') {
        return;
      }
      const activeEl = document.activeElement;
      if (activeEl && view.dom.contains(activeEl)) {
        return;
      }
      if (matchesShortcut(evt, resolvedShortcuts.focus_editor)) {
        evt.preventDefault();
        view.focus();
        onFocusEditor?.();
      }
    };

    window.addEventListener('keydown', handleWindowKeydown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeydown);
    };
  });

  $effect(() => {
    if (externalSnapshot) {
      syncViewWithSnapshot(externalSnapshot);
    }
  });

  $effect(() => {
    const nextShortcuts = resolvedShortcuts;
    if (!view) return;
    view.dispatch({
      effects: [shortcutsCompartment.reconfigure(shortcutsFacet.of(nextShortcuts))],
    });
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });
</script>

<section
  class="ms-editor-shell"
  data-testid="mathslot-editor"
  data-theme={resolvedThemeAttr}
  aria-label={ariaLabel}
>
  <header class="ms-editor-header">
    <div class="ms-header-left">
      <span
        class="ms-mode-pill"
        data-mode={modeInfo.code}
        aria-label={`编辑模式：${modeInfo.label}`}
      >
        {modeInfo.label}
      </span>

      {#if activeCommand}
        <span
          class="ms-active-command"
          data-command-id={activeCommand.id}
          aria-label={`当前命令：${activeCommand.label} (${activeCommand.glyph})`}
        >
          <span class="ms-command-glyph" aria-hidden="true">{activeCommand.glyph}</span>
          <span>{activeCommand.label}</span>
        </span>
      {/if}
    </div>

    <div class="ms-header-meta" aria-label={`文档行数 ${lineCount}`}>
      <span class="ms-meta-item">{lineCount} 行</span>
      <span class="ms-meta-item">{activeSnapshot.slots.length} 槽位</span>
    </div>
  </header>

  {#if activeSnapshot.slots.length > 0}
    <div class="ms-slot-strip" role="list" aria-label="槽位导航状态">
      {#each activeSnapshot.slots as slot (slot.id)}
        <span
          role="listitem"
          class="ms-slot-pill"
          class:ms-slot-active={slot.is_active}
          class:ms-slot-empty={slot.is_empty}
          data-slot-id={slot.id}
          aria-current={slot.is_active ? 'step' : undefined}
          aria-label={formatSlotAriaLabel(slot)}
        >
          <span class="ms-slot-index">#{slot.id}</span>
          <span>{slot.label}</span>
          <span class="ms-slot-state">{slot.is_empty ? '空' : '已填'}</span>
        </span>
      {/each}
    </div>
  {/if}

  <div class="ms-cm-host" bind:this={hostEl}></div>

  {#if activeSnapshot.diagnostics.length > 0}
    <div class="ms-diagnostics" role="status" aria-live="polite">
      {#each activeSnapshot.diagnostics as diag, idx (`${diag.code}-${idx}`)}
        <div class="ms-diag-item" data-severity={diag.severity.toLowerCase()}>
          <span class="ms-diag-badge">{diag.severity === 'Error' ? '错误' : diag.severity === 'Warning' ? '警告' : '提示'}</span>
          <span class="ms-diag-message">{diag.message}</span>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .ms-editor-shell {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-family: var(--ms-font-sans);
    box-shadow: var(--ms-shadow-sm);
  }

  .ms-editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .ms-header-left,
  .ms-header-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ms-mode-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    border-radius: var(--ms-radius-pill);
    font-size: 0.75rem;
    font-weight: 600;
    background: var(--ms-mode-idle-bg);
    color: var(--ms-mode-idle-fg);
  }

  .ms-mode-pill[data-mode='prefix'] {
    background: var(--ms-mode-prefix-bg);
    color: var(--ms-mode-prefix-fg);
  }

  .ms-mode-pill[data-mode='nav'] {
    background: var(--ms-mode-nav-bg);
    color: var(--ms-mode-nav-fg);
  }

  .ms-mode-pill[data-mode='ime'] {
    background: var(--ms-mode-ime-bg);
    color: var(--ms-mode-ime-fg);
  }

  .ms-active-command {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-cmd-border);
    background: var(--ms-cmd-bg);
    color: var(--ms-cmd-fg);
    font-size: 0.78rem;
    font-weight: 500;
  }

  .ms-command-glyph {
    font-family: var(--ms-font-mono);
    font-weight: 700;
  }

  .ms-meta-item {
    font-size: 0.75rem;
    color: var(--ms-fg-muted);
  }

  .ms-slot-strip {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .ms-slot-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: var(--ms-radius-pill);
    border: 1px solid var(--ms-slot-filled-border);
    background: var(--ms-slot-filled-bg);
    color: var(--ms-slot-filled-fg);
    font-size: 0.75rem;
  }

  .ms-slot-pill.ms-slot-empty {
    border-color: var(--ms-slot-empty-border);
    background: var(--ms-slot-empty-bg);
    color: var(--ms-slot-empty-fg);
  }

  .ms-slot-pill.ms-slot-active {
    border-color: var(--ms-slot-active-border);
    background: var(--ms-slot-active-bg);
    color: var(--ms-slot-active-fg);
    font-weight: 600;
  }

  .ms-slot-index {
    font-family: var(--ms-font-mono);
    opacity: 0.85;
  }

  .ms-slot-state {
    font-size: 0.7rem;
    opacity: 0.85;
  }

  .ms-cm-host {
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    overflow: hidden;
  }

  .ms-cm-host :global(.ms-cmd-prefix) {
    background: var(--ms-cmd-bg);
    color: var(--ms-cmd-fg);
    border-bottom: 2px solid var(--ms-cmd-border);
    border-radius: 3px;
    padding: 0 2px;
  }

  .ms-cm-host :global(.ms-cmd-badge) {
    display: inline-flex;
    align-items: center;
    margin-left: 4px;
    padding: 0 5px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-cmd-border);
    background: var(--ms-cmd-bg);
    color: var(--ms-cmd-fg);
    font-family: var(--ms-font-sans);
    font-size: 0.72rem;
    vertical-align: baseline;
  }

  .ms-cm-host :global(.ms-slot-span-empty) {
    background: var(--ms-slot-empty-bg);
    border-bottom: 1px dashed var(--ms-slot-empty-border);
  }

  .ms-cm-host :global(.ms-slot-span-active) {
    background: var(--ms-slot-active-bg);
    outline: 1px solid var(--ms-slot-active-border);
  }

  .ms-diagnostics {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ms-diag-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-status-info-border);
    background: var(--ms-status-info-bg);
    color: var(--ms-status-info-fg);
    font-size: 0.8rem;
  }

  .ms-diag-item[data-severity='warning'] {
    border-color: var(--ms-status-warn-border);
    background: var(--ms-status-warn-bg);
    color: var(--ms-status-warn-fg);
  }

  .ms-diag-item[data-severity='error'] {
    border-color: var(--ms-status-error-border);
    background: var(--ms-status-error-bg);
    color: var(--ms-status-error-fg);
  }

  .ms-diag-badge {
    font-weight: 700;
    font-size: 0.72rem;
    text-transform: uppercase;
  }

  @media (max-width: 480px) {
    .ms-editor-shell {
      padding: 8px;
    }

    .ms-editor-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }

    .ms-slot-pill {
      min-height: 36px;
      display: inline-flex;
      align-items: center;
    }
  }
</style>

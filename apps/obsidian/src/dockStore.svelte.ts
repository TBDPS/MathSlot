import {
  COMMANDS,
  DEFAULT_SETTINGS,
  MathSlotEngine,
  detectWrapperFromRaw,
  formatDockedFormulaText,
  toggleFormulaWrapperStyle,
  type AppSettings,
  type CommandDef,
  type CustomCommandDef,
  type EditorSnapshot,
  type MathWrapperKind,
  type Snippet,
  type TreePoint,
} from '@mathslot/core';

export type DockOwnershipMode = 'canvas-owned' | 'doc-follow';

export interface DockBinding {
  mode: DockOwnershipMode;
  rawFrom: number;
  rawTo: number;
  wrapper: MathWrapperKind;
  linePrefix: string;
  includeFirstLinePrefix: boolean;
  createdEmpty: boolean;
}

export interface DockStoreCallbacks {
  writeEngineLatex: (latex: string, keepEmptyShell: boolean) => void;
  promoteMode: (mode: DockOwnershipMode) => void;
  switchWrapper: (nextWrapper: MathWrapperKind, currentLatex: string) => void;
  completeAndExit: (deleteIfEmptyCreated: boolean) => void;
  openFullModalWorkbench: () => void;
}

export class DockedMathStore {
  public readonly engine = new MathSlotEngine();

  public snapshot = $state<EditorSnapshot>(this.engine.getSnapshot());
  public mode = $state<DockOwnershipMode>('doc-follow');
  public wrapper = $state<MathWrapperKind>('dollar_inline');
  public settings = $state<AppSettings>({ ...DEFAULT_SETTINGS });
  public effectiveCommands = $state<readonly CommandDef[]>(COMMANDS);
  public customCommands = $state<CustomCommandDef[]>([]);
  public snippets = $state<Snippet[]>([]);
  public dark = $state<boolean>(
    typeof document !== 'undefined' && document.body.classList.contains('theme-dark'),
  );
  public panelHeight = $state<number>(78);
  public semicolonExitsAtRoot = $state<boolean>(true);
  public ribbonPopoverOpen = $state<boolean>(false);

  private canvasFocusFn: (() => void) | null = null;
  private suppressEngineToDoc = false;
  private lastSyncedCleanLatex = '';
  private lastLoadedRaw = '';
  private callbacks: DockStoreCallbacks | null = null;
  private darkObserver: MutationObserver | null = null;

  constructor() {
    this.engine.subscribe(() => {
      const snap = this.engine.getSnapshot();
      this.snapshot = snap;
      if (this.suppressEngineToDoc || !this.callbacks) return;
      if (this.mode !== 'canvas-owned') return;
      if (snap.latex === this.lastSyncedCleanLatex) return;
      this.lastSyncedCleanLatex = snap.latex;
      this.callbacks.writeEngineLatex(snap.latex, true);
    });

    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      this.darkObserver = new MutationObserver(() => {
        this.dark = document.body.classList.contains('theme-dark');
      });
      this.darkObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  public bindCallbacks(cb: DockStoreCallbacks): void {
    this.callbacks = cb;
  }

  public registerCanvasFocus(fn: (() => void) | null): void {
    this.canvasFocusFn = fn;
  }

  public focusCanvas(): void {
    this.engine.setFocused(true);
    this.canvasFocusFn?.();
  }

  public ensureCanvasOwned(): void {
    if (this.mode !== 'canvas-owned') {
      this.mode = 'canvas-owned';
      this.callbacks?.promoteMode('canvas-owned');
    }
  }

  public syncExternalConfig(params: {
    settings: AppSettings;
    effectiveCommands: readonly CommandDef[];
    customCommands: CustomCommandDef[];
    snippets: Snippet[];
    semicolonExitsAtRoot: boolean;
  }): void {
    this.settings = params.settings;
    this.effectiveCommands = params.effectiveCommands;
    this.customCommands = params.customCommands;
    this.snippets = params.snippets;
    this.semicolonExitsAtRoot = params.semicolonExitsAtRoot;
    this.engine.updateSettings(params.settings);
    this.engine.setEffectiveCommands(params.effectiveCommands);
    this.engine.setCustomCommands(params.customCommands);
    this.engine.setSnippets(params.snippets);
  }

  public loadFromDocument(rawFormula: string, binding: DockBinding): void {
    this.mode = binding.mode;
    this.wrapper = binding.wrapper;

    const cleanRaw = rawFormula.trim();
    const detected = detectWrapperFromRaw(cleanRaw);
    const isEmptyShell =
      cleanRaw === '' ||
      cleanRaw === '$$' ||
      cleanRaw === '\\(\\)' ||
      cleanRaw === '\\[\\]' ||
      cleanRaw === '$$\n$$' ||
      cleanRaw === '\\[\n\\]';

    if (rawFormula === this.lastLoadedRaw && this.snapshot.latex === this.lastSyncedCleanLatex) {
      return;
    }

    this.lastLoadedRaw = rawFormula;
    this.suppressEngineToDoc = true;
    try {
      this.engine.setFocused(binding.mode === 'canvas-owned');
      if (isEmptyShell || (!detected && cleanRaw === '')) {
        this.engine.clear();
      } else {
        this.engine.loadFormulaWithRawFallback(rawFormula);
      }
      const nextSnap = this.engine.getSnapshot();
      this.lastSyncedCleanLatex = nextSnap.latex;
      this.snapshot = nextSnap;
    } finally {
      this.suppressEngineToDoc = false;
    }
  }

  public syncBindingMeta(binding: DockBinding): void {
    this.mode = binding.mode;
    this.wrapper = binding.wrapper;
    if (binding.mode === 'doc-follow') {
      this.engine.setFocused(false);
    }
  }

  public toggleWrapper = (): void => {
    this.ensureCanvasOwned();
    const nextWrapper = toggleFormulaWrapperStyle(this.wrapper);
    this.wrapper = nextWrapper;
    const currentLatex = this.engine.getSnapshot().latex;
    this.lastSyncedCleanLatex = currentLatex;
    this.callbacks?.switchWrapper(nextWrapper, currentLatex);
    this.focusCanvas();
  };

  public toggleHierarchyBoxes = (): void => {
    this.settings = {
      ...this.settings,
      showHierarchyBoxes: !this.settings.showHierarchyBoxes,
    };
    this.engine.updateSettings(this.settings);
    this.focusCanvas();
  };

  public completeAndExit = (): void => {
    this.engine.commitLeaderDefault();
    this.engine.setFocused(false);
    const snap = this.engine.getSnapshot();
    this.callbacks?.completeAndExit(snap.isEmpty);
  };

  public openFullWorkbench = (): void => {
    this.engine.commitLeaderDefault();
    this.engine.setFocused(false);
    this.callbacks?.openFullModalWorkbench();
  };

  public handleCanvasFocusChange = (focused: boolean): void => {
    if (focused) {
      this.ensureCanvasOwned();
    }
    this.engine.setFocused(focused);
    this.snapshot = this.engine.getSnapshot();
  };

  public handleTextInput = (text: string): void => {
    this.ensureCanvasOwned();
    const snap = this.engine.getSnapshot();
    if (
      text === ';' &&
      this.semicolonExitsAtRoot &&
      snap.mode.kind === 'edit' &&
      snap.cursor.slotId === snap.doc.root.id &&
      snap.inputContext === 'math-root'
    ) {
      const rootChildren = snap.doc.root.children;
      const prevNode = snap.cursor.offset > 0 ? rootChildren[snap.cursor.offset - 1] : null;
      const escapedBackslash = prevNode?.type === 'char' && prevNode.value === '\\';
      if (!escapedBackslash) {
        this.completeAndExit();
        return;
      }
    }
    this.engine.insertText(text);
  };

  public handlePaste = (text: string): void => {
    this.ensureCanvasOwned();
    this.engine.pasteText(text);
  };

  public handleClickSlot = (slotId: string, offset: number): void => {
    this.ensureCanvasOwned();
    this.engine.setCursor(slotId, offset);
    this.focusCanvas();
  };

  public handleDragSelect = (slotId: string, anchor: number, focus: number): void => {
    this.ensureCanvasOwned();
    this.engine.setSelection(slotId, anchor, focus);
    this.focusCanvas();
  };

  public handleCrossSlotDragSelect = (anchor: TreePoint, focus: TreePoint): void => {
    this.ensureCanvasOwned();
    this.engine.selectBetweenPoints(anchor, focus);
    this.focusCanvas();
  };

  public handleDoubleClickAtom = (slotId: string, offset: number): void => {
    this.ensureCanvasOwned();
    this.engine.selectWordOrAtomAt(slotId, offset);
    this.focusCanvas();
  };

  public handleJumpTarget = (label: string): void => {
    this.ensureCanvasOwned();
    this.engine.handleJumpKey(label);
    this.focusCanvas();
  };

  public handleInsertCommand = (cmdId: string): void => {
    this.ensureCanvasOwned();
    this.engine.insertCommand(cmdId);
    this.focusCanvas();
  };

  public handleInsertSnippet = (snip: Snippet): void => {
    this.ensureCanvasOwned();
    this.engine.insertSnippetAtCursor(snip);
    this.focusCanvas();
  };

  public handleSelectSubmenuKey = (key: string): void => {
    this.ensureCanvasOwned();
    if (this.snapshot.mode.kind !== 'leader') {
      this.engine.triggerLeader();
    }
    this.engine.handleLeaderKey(key);
    this.focusCanvas();
  };

  public handleLeaderBack = (): void => {
    this.ensureCanvasOwned();
    this.engine.stepLeaderBack();
    this.focusCanvas();
  };

  public handleUndo = (): void => {
    this.ensureCanvasOwned();
    this.engine.undo();
    this.focusCanvas();
  };

  public handleRedo = (): void => {
    this.ensureCanvasOwned();
    this.engine.redo();
    this.focusCanvas();
  };

  public handleKeyEvent = (e: KeyboardEvent): void => {
    this.ensureCanvasOwned();
    const mod = e.ctrlKey || e.metaKey;
    const snap = this.engine.getSnapshot();

    if (e.altKey && !mod && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      this.toggleWrapper();
      return;
    }

    if (mod && e.key === 'Enter') {
      e.preventDefault();
      this.completeAndExit();
      return;
    }

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.engine.redo();
      else this.engine.undo();
      return;
    }

    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.engine.redo();
      return;
    }

    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.engine.selectAll();
      return;
    }

    if (mod && e.key.toLowerCase() === 'c') {
      const selTex = this.engine.getSelectedLatex();
      if (selTex) {
        e.preventDefault();
        void navigator.clipboard?.writeText?.(selTex);
      }
      return;
    }

    if (snap.mode.kind === 'jump') {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.engine.exitMode();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.engine.stepJumpBack();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.engine.confirmJumpSelection();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.engine.moveJumpSelection(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.engine.moveJumpSelection(1);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.engine.drillJumpSelection();
        return;
      }
      if (!mod && !e.altKey && e.key.length === 1) {
        e.preventDefault();
        this.engine.handleJumpKey(e.key);
        return;
      }
    }

    if (snap.mode.kind === 'leader') {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.engine.cancelLeader();
        return;
      }
      if (e.key === 'Enter' && snap.mode.prefix !== '') {
        e.preventDefault();
        this.engine.acceptSubmenuDefault();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        this.engine.stepLeaderBack();
        return;
      }
      if (e.key === this.settings.leaderKey) {
        e.preventDefault();
        this.engine.triggerLeader();
        return;
      }
      if (!mod && !e.altKey && e.key.length === 1) {
        e.preventDefault();
        if (snap.mode.prefix === '' && (e.key === 'w' || e.key === 'W')) {
          this.engine.cancelLeader();
          this.openFullWorkbench();
          return;
        }
        this.engine.handleLeaderKey(e.key);
        return;
      }
    }

    if (!mod && !e.altKey && !e.shiftKey && e.key === this.settings.leaderKey) {
      e.preventDefault();
      this.engine.triggerLeader();
      return;
    }

    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      this.engine.prevSlot();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.altKey && snap.activeGrid) {
        if (e.shiftKey) this.engine.addGridCol();
        else this.engine.addGridRow();
      } else if (e.shiftKey) {
        if (snap.cursor.slotId === snap.doc.root.id) {
          if (this.wrapper === 'dollar_inline' || this.wrapper === 'paren_inline') {
            const nextW = toggleFormulaWrapperStyle(this.wrapper);
            this.wrapper = nextW;
            this.callbacks?.switchWrapper(nextW, snap.latex);
          }
          this.engine.nextSlot();
        } else {
          this.engine.prevSlot();
        }
      } else if (snap.cursor.slotId === snap.doc.root.id) {
        this.completeAndExit();
      } else {
        this.engine.nextSlot();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (snap.selection) {
        this.engine.exitMode();
      } else if (!snap.isEmpty) {
        this.engine.enterJumpMode();
      } else {
        this.completeAndExit();
      }
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      if (e.altKey && snap.activeGrid) {
        if (e.shiftKey && snap.activeGrid.canEditCols) this.engine.removeGridCol();
        else this.engine.removeGridRow();
      } else {
        this.engine.backspace();
      }
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      this.engine.deleteForward();
      return;
    }

    if (e.altKey && !mod && e.key === 'ArrowLeft') {
      e.preventDefault();
      this.engine.jumpBack();
      return;
    }
    if (e.altKey && !mod && e.key === 'ArrowRight') {
      e.preventDefault();
      this.engine.jumpForward();
      return;
    }

    if (e.shiftKey && !mod && !e.altKey && snap.activeGrid) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.engine.addGridRow('below');
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.engine.addGridRow('above');
        return;
      }
      if (e.key === 'ArrowRight' && snap.activeGrid.canEditCols) {
        e.preventDefault();
        this.engine.addGridCol('right');
        return;
      }
      if (e.key === 'ArrowLeft' && snap.activeGrid.canEditCols) {
        e.preventDefault();
        this.engine.addGridCol('left');
        return;
      }
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.engine.moveLeft(e.shiftKey);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.engine.moveRight(e.shiftKey);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.engine.moveUp();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.engine.moveDown();
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      this.engine.moveHome(e.shiftKey);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      this.engine.moveEnd(e.shiftKey);
      return;
    }
  };

  public destroy(): void {
    this.darkObserver?.disconnect();
    this.darkObserver = null;
    this.callbacks = null;
    this.canvasFocusFn = null;
  }
}

export { formatDockedFormulaText };

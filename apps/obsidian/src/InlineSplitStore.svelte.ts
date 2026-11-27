import {
  COMMANDS,
  DEFAULT_SETTINGS,
  MathSlotEngine,
  canonicalBlockquotePrefix,
  extractBlockquotePrefix,
  stripBlockquoteSelection,
  type AppSettings,
  type CommandDef,
  type CustomCommandDef,
  type EditorSnapshot,
  type InlineMathSpan,
  type Snippet,
  type TreePoint,
} from '@mathslot/core';

export interface SplitWorkbenchCallbacks {
  writeLatexToDocument: (formattedInner: string) => void;
  completeAndExitToOutside: () => void;
  upgradeInlineToBlock: () => void;
  openFullModalWorkbench: () => void;
}

export class InlineSplitWorkbenchStore {
  public readonly engine = new MathSlotEngine();

  public snapshot = $state<EditorSnapshot>(this.engine.getSnapshot());
  public settings = $state<AppSettings>({ ...DEFAULT_SETTINGS });
  public effectiveCommands = $state<readonly CommandDef[]>(COMMANDS);
  public customCommands = $state<CustomCommandDef[]>([]);
  public snippets = $state<Snippet[]>([]);
  public dark = $state<boolean>(
    typeof document !== 'undefined' && document.body.classList.contains('theme-dark'),
  );
  public isBlock = $state<boolean>(false);
  public semicolonExitsAtRoot = $state<boolean>(true);

  private canvasFocusFn: (() => void) | null = null;
  private suppressEngineToDoc = false;
  private lastSyncedCleanLatex = '';
  private quotePrefix = '';
  private preserveBlockNewlines = false;
  private callbacks: SplitWorkbenchCallbacks | null = null;
  private darkObserver: MutationObserver | null = null;

  constructor() {
    this.engine.subscribe(() => {
      const snap = this.engine.getSnapshot();
      this.snapshot = snap;
      if (this.suppressEngineToDoc || !this.callbacks) return;
      if (snap.latex === this.lastSyncedCleanLatex) return;
      this.lastSyncedCleanLatex = snap.latex;
      this.callbacks.writeLatexToDocument(this.formatInnerForSpan(snap.latex));
    });

    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      this.darkObserver = new MutationObserver(() => {
        this.dark = document.body.classList.contains('theme-dark');
      });
      this.darkObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  public bindCallbacks(cb: SplitWorkbenchCallbacks): void {
    this.callbacks = cb;
  }

  public registerCanvasFocus(fn: (() => void) | null): void {
    this.canvasFocusFn = fn;
  }

  public focusCanvas(): void {
    this.engine.setFocused(true);
    this.canvasFocusFn?.();
  }

  public syncExternalConfig(params: {
    settings: AppSettings;
    effectiveCommands: readonly CommandDef[];
    customCommands: CustomCommandDef[];
    snippets: Snippet[];
  }): void {
    this.settings = params.settings;
    this.effectiveCommands = params.effectiveCommands;
    this.customCommands = params.customCommands;
    this.snippets = params.snippets;
    this.engine.updateSettings(params.settings);
    this.engine.setEffectiveCommands(params.effectiveCommands);
    this.engine.setCustomCommands(params.customCommands);
    this.engine.setSnippets(params.snippets);
  }

  public loadFromDocumentSpan(
    rawInnerSlice: string,
    firstLineText: string,
    span: InlineMathSpan,
  ): void {
    this.isBlock = span.isBlock;
    this.preserveBlockNewlines = span.isBlock && rawInnerSlice.includes('\n');
    const stripped = stripBlockquoteSelection(rawInnerSlice);
    if (stripped.linePrefix) {
      this.quotePrefix = stripped.linePrefix;
    } else {
      const split = extractBlockquotePrefix(firstLineText);
      this.quotePrefix = split.prefix ? canonicalBlockquotePrefix(split.prefix) : '';
    }

    const clean = stripped.clean.trim();
    if (clean === this.lastSyncedCleanLatex && (clean !== '' || this.snapshot.isEmpty)) {
      return;
    }
    this.suppressEngineToDoc = true;
    try {
      if (clean === '') {
        this.engine.clear();
      } else {
        this.engine.loadFormulaWithRawFallback(clean);
      }
      this.lastSyncedCleanLatex = this.engine.getSnapshot().latex;
      this.snapshot = this.engine.getSnapshot();
    } finally {
      this.suppressEngineToDoc = false;
    }
  }

  private formatInnerForSpan(cleanLatex: string): string {
    if (!this.isBlock) {
      return cleanLatex;
    }
    if (this.preserveBlockNewlines || cleanLatex.includes('\n') || cleanLatex.includes('\\\\')) {
      const lines = cleanLatex.split('\n');
      const prefixed = lines
        .map((line, idx) => (idx === 0 ? `${this.quotePrefix}${line}` : `${this.quotePrefix}${line}`))
        .join('\n');
      return `\n${prefixed}\n${this.quotePrefix}`;
    }
    return cleanLatex ? ` ${cleanLatex} ` : '';
  }

  public completeAndExit = (): void => {
    this.engine.commitLeaderDefault();
    this.engine.setFocused(false);
    this.callbacks?.completeAndExitToOutside();
  };

  public openFullWorkbench = (): void => {
    this.engine.commitLeaderDefault();
    this.engine.setFocused(false);
    this.callbacks?.openFullModalWorkbench();
  };

  public upgradeToBlock = (): void => {
    this.callbacks?.upgradeInlineToBlock();
  };

  public handleCanvasFocusChange = (focused: boolean): void => {
    this.engine.setFocused(focused);
    this.snapshot = this.engine.getSnapshot();
  };

  public handleTextInput = (text: string): void => {
    const snap = this.engine.getSnapshot();
    // At outermost root slot, pressing `;` completes & exits past closing `$`!
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
    this.engine.pasteText(text);
  };

  public handleClickSlot = (slotId: string, offset: number): void => {
    this.engine.setCursor(slotId, offset);
    this.focusCanvas();
  };

  public handleDragSelect = (slotId: string, anchor: number, focus: number): void => {
    this.engine.setSelection(slotId, anchor, focus);
    this.focusCanvas();
  };

  public handleCrossSlotDragSelect = (anchor: TreePoint, focus: TreePoint): void => {
    this.engine.selectBetweenPoints(anchor, focus);
    this.focusCanvas();
  };

  public handleDoubleClickAtom = (slotId: string, offset: number): void => {
    this.engine.selectWordOrAtomAt(slotId, offset);
    this.focusCanvas();
  };

  public handleJumpTarget = (label: string): void => {
    this.engine.handleJumpKey(label);
    this.focusCanvas();
  };

  public handleInsertCommand = (cmdId: string): void => {
    this.engine.insertCommand(cmdId);
    this.focusCanvas();
  };

  public handleInsertSnippet = (snip: Snippet): void => {
    this.engine.insertSnippetAtCursor(snip);
    this.focusCanvas();
  };

  public handleSelectSubmenuKey = (key: string): void => {
    if (this.snapshot.mode.kind !== 'leader') {
      this.engine.triggerLeader();
    }
    this.engine.handleLeaderKey(key);
    this.focusCanvas();
  };

  public handleLeaderBack = (): void => {
    this.engine.stepLeaderBack();
    this.focusCanvas();
  };

  public handleKeyEvent = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey;
    const snap = this.engine.getSnapshot();

    // Alt+M upgrades inline `$...$` -> block `$$\n...\n$$` or exits block
    if (e.altKey && !mod && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      if (!this.isBlock) {
        this.upgradeToBlock();
      } else {
        this.completeAndExit();
      }
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
        // Shift+Enter at root inserts multiline break `\\`
        if (snap.cursor.slotId === snap.doc.root.id) {
          this.engine.nextSlot();
        } else {
          this.engine.prevSlot();
        }
      } else if (snap.cursor.slotId === snap.doc.root.id) {
        // At outermost root, plain Enter completes & moves cursor outside closing `$`!
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

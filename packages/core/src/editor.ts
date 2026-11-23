import {
  buildJumpTargets,
  cloneDocument,
  countEmptySlots,
  createCharNode,
  createEmptyDocument,
  createRawNode,
  createSlot,
  createStructNode,
  createSymbolNode,
  findSlot,
  findSlotPath,
  getBreadcrumbs,
  getGridMeta,
  isStructEmpty,
  textToCharNodes,
} from './ast';
import { COMMANDS_BY_ID, COMMANDS_BY_KEYS, SUBMENU_KEYS, getSubmenuCommands } from './catalog';
import { MATH_FUNCTIONS, emitNodesCanonical, toInteractiveLatex, toLatex } from './latex';
import { importFormula } from './parser';
import { matchTrailingShorthand } from './shorthands';
import { getSlotOrder } from './slotOrder';
import type {
  ActiveGridInfo,
  AppSettings,
  Cursor,
  CustomCommandDef,
  Document,
  EditorMode,
  EditorSnapshot,
  ImportResult,
  MathNode,
  Selection,
  SlotNode,
  Snippet,
  StructNode,
} from './types';
import { DEFAULT_SETTINGS } from './types';

interface HistoryEntry {
  doc: Document;
  cursor: Cursor;
}

const MAX_HISTORY = 200;

export class MathSlotEngine {
  private doc: Document;
  private cursor: Cursor;
  private selection: Selection | null = null;
  private mode: EditorMode = { kind: 'edit' };
  private settings: AppSettings;
  private customCommands: CustomCommandDef[] = [];
  private snippets: Snippet[] = [];
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private jumpHistory: Cursor[] = [];
  private jumpHistoryIdx = -1;
  private focused = true;

  constructor(initialSettings: Partial<AppSettings> = {}) {
    this.doc = createEmptyDocument();
    this.cursor = { slotId: this.doc.root.id, offset: 0 };
    this.settings = { ...DEFAULT_SETTINGS, ...initialSettings };
  }

  public setCustomCommands(commands: CustomCommandDef[]): void {
    this.customCommands = [...commands];
  }

  public getCustomCommands(): CustomCommandDef[] {
    return [...this.customCommands];
  }

  public setSnippets(snippets: Snippet[]): void {
    this.snippets = [...snippets];
  }

  public getSnippets(): Snippet[] {
    return [...this.snippets];
  }

  public getSettings(): AppSettings {
    return { ...this.settings };
  }

  public updateSettings(patch: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  public setFocused(focused: boolean): void {
    this.focused = focused;
  }

  private getActiveGridInfo(): ActiveGridInfo | null {
    const path = findSlotPath(this.doc.root, this.cursor.slotId);
    if (!path || path.length <= 1) return null;
    for (let i = path.length - 1; i >= 1; i -= 1) {
      const entry = path[i];
      if (!entry.parentStruct) continue;
      const meta = getGridMeta(entry.parentStruct);
      if (meta) {
        const sIdx = entry.slotIndexInStruct;
        return {
          structId: entry.parentStruct.id,
          env: meta.env,
          rows: meta.rows,
          cols: meta.cols,
          row: Math.floor(sIdx / meta.cols),
          col: sIdx % meta.cols,
          canEditCols: meta.env !== 'cases',
        };
      }
    }
    return null;
  }

  public getSnapshot(): EditorSnapshot {
    const latex = toLatex(this.doc, { autoShorthands: this.settings.autoShorthands });
    const interactiveLatex = toInteractiveLatex(this.doc, this.cursor, this.selection, {
      focused: this.focused,
      showJumpTargets: this.mode.kind === 'jump',
      autoShorthands: this.settings.autoShorthands,
    });
    return {
      doc: this.doc,
      cursor: { ...this.cursor },
      selection: this.selection ? { ...this.selection } : null,
      mode: this.mode,
      latex,
      interactiveLatex,
      breadcrumbs: getBreadcrumbs(this.doc.root, this.cursor.slotId, this.customCommands),
      activeGrid: this.getActiveGridInfo(),
      emptySlotCount: countEmptySlots(this.doc.root),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      isEmpty: this.doc.root.children.length === 0,
    };
  }

  private pushHistory(): void {
    this.undoStack.push({
      doc: cloneDocument(this.doc),
      cursor: { ...this.cursor },
    });
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  private currentSlot(): SlotNode {
    const slot = findSlot(this.doc.root, this.cursor.slotId);
    if (slot) return slot;
    this.cursor = { slotId: this.doc.root.id, offset: this.doc.root.children.length };
    return this.doc.root;
  }

  private deleteSelectionInternal(): MathNode[] {
    if (!this.selection) return [];
    const slot = findSlot(this.doc.root, this.selection.slotId);
    if (!slot) {
      this.selection = null;
      return [];
    }
    const { start, end } = this.selection;
    const removed = slot.children.splice(start, end - start);
    this.cursor = { slotId: slot.id, offset: start };
    this.selection = null;
    return removed;
  }

  public undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push({
      doc: cloneDocument(this.doc),
      cursor: { ...this.cursor },
    });
    this.doc = prev.doc;
    this.cursor = prev.cursor;
    this.selection = null;
    this.mode = { kind: 'edit' };
    return true;
  }

  public redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push({
      doc: cloneDocument(this.doc),
      cursor: { ...this.cursor },
    });
    this.doc = next.doc;
    this.cursor = next.cursor;
    this.selection = null;
    this.mode = { kind: 'edit' };
    return true;
  }

  public clear(): void {
    if (this.doc.root.children.length === 0) return;
    this.pushHistory();
    this.doc = createEmptyDocument();
    this.cursor = { slotId: this.doc.root.id, offset: 0 };
    this.selection = null;
    this.mode = { kind: 'edit' };
  }

  public loadFormula(input: string): ImportResult {
    const result = importFormula(input);
    const hasHardError = result.diagnostics.some((d) => d.severity === 'error');
    if (hasHardError) {
      return result;
    }
    this.pushHistory();
    this.doc = result.doc;
    this.cursor = { slotId: this.doc.root.id, offset: this.doc.root.children.length };
    this.selection = null;
    this.mode = { kind: 'edit' };
    return result;
  }

  public pasteText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    // If pasted text looks like LaTeX or MathSlot stream code, parse into interactive nodes
    if (
      trimmed.includes('\\') ||
      trimmed.includes('▸') ||
      trimmed.includes('^') ||
      trimmed.includes('_') ||
      (trimmed.startsWith('$') && trimmed.endsWith('$'))
    ) {
      const res = importFormula(trimmed);
      const hasError = res.diagnostics.some((d) => d.severity === 'error');
      if (!hasError && res.doc.root.children.length > 0) {
        this.pushHistory();
        this.deleteSelectionInternal();
        const slot = this.currentSlot();
        slot.children.splice(this.cursor.offset, 0, ...res.doc.root.children);
        this.cursor.offset += res.doc.root.children.length;
        this.mode = { kind: 'edit' };
        return;
      }
    }
    this.insertText(text);
  }

  public getSelectedLatex(): string {
    if (!this.selection) return toLatex(this.doc, { autoShorthands: this.settings.autoShorthands });
    const slot = findSlot(this.doc.root, this.selection.slotId);
    if (!slot) return '';
    return emitNodesCanonical(slot.children.slice(this.selection.start, this.selection.end), {
      autoShorthands: this.settings.autoShorthands,
    });
  }

  private recordJumpOrigin(origin: Cursor): void {
    const prev = this.jumpHistory[this.jumpHistoryIdx];
    if (prev && prev.slotId === origin.slotId && prev.offset === origin.offset) {
      return;
    }
    this.jumpHistory = this.jumpHistory.slice(0, this.jumpHistoryIdx + 1);
    this.jumpHistory.push({ ...origin });
    if (this.jumpHistory.length > 64) {
      this.jumpHistory.shift();
    }
    this.jumpHistoryIdx = this.jumpHistory.length - 1;
  }

  private jumpToCursor(target: Cursor): void {
    const slot = findSlot(this.doc.root, target.slotId);
    if (!slot) return;
    const clamped: Cursor = {
      slotId: slot.id,
      offset: Math.max(0, Math.min(target.offset, slot.children.length)),
    };
    if (clamped.slotId !== this.cursor.slotId || clamped.offset !== this.cursor.offset) {
      this.recordJumpOrigin(this.cursor);
      this.cursor = clamped;
      this.jumpHistory = this.jumpHistory.slice(0, this.jumpHistoryIdx + 1);
      this.jumpHistory.push({ ...clamped });
      this.jumpHistoryIdx = this.jumpHistory.length - 1;
    }
    this.selection = null;
    this.mode = { kind: 'edit' };
  }

  public jumpBack(): boolean {
    this.mode = { kind: 'edit' };
    this.selection = null;
    while (this.jumpHistoryIdx > 0) {
      this.jumpHistoryIdx -= 1;
      const entry = this.jumpHistory[this.jumpHistoryIdx];
      const slot = findSlot(this.doc.root, entry.slotId);
      if (slot) {
        this.cursor = {
          slotId: slot.id,
          offset: Math.max(0, Math.min(entry.offset, slot.children.length)),
        };
        return true;
      }
    }
    return false;
  }

  public jumpForward(): boolean {
    this.mode = { kind: 'edit' };
    this.selection = null;
    while (this.jumpHistoryIdx + 1 < this.jumpHistory.length) {
      this.jumpHistoryIdx += 1;
      const entry = this.jumpHistory[this.jumpHistoryIdx];
      const slot = findSlot(this.doc.root, entry.slotId);
      if (slot) {
        this.cursor = {
          slotId: slot.id,
          offset: Math.max(0, Math.min(entry.offset, slot.children.length)),
        };
        return true;
      }
    }
    return false;
  }

  public setSelection(slotId: string, anchorOffset: number, focusOffset: number): void {
    const slot = findSlot(this.doc.root, slotId);
    if (!slot) return;
    const a = Math.max(0, Math.min(anchorOffset, slot.children.length));
    const b = Math.max(0, Math.min(focusOffset, slot.children.length));
    this.cursor = { slotId: slot.id, offset: b };
    this.setSelectionRange(slot.id, a, b);
    this.mode = { kind: 'edit' };
  }

  public selectWordOrAtomAt(slotId: string, offset: number): void {
    const slot = findSlot(this.doc.root, slotId);
    if (!slot || slot.children.length === 0) return;
    const idx = Math.max(0, Math.min(offset, slot.children.length - 1));
    const target = slot.children[idx];
    if (target.type === 'char' && /[A-Za-z0-9]/.test(target.value)) {
      let start = idx;
      let end = idx + 1;
      while (start > 0) {
        const c = slot.children[start - 1];
        if (c.type === 'char' && /[A-Za-z0-9]/.test(c.value)) start -= 1;
        else break;
      }
      while (end < slot.children.length) {
        const c = slot.children[end];
        if (c.type === 'char' && /[A-Za-z0-9]/.test(c.value)) end += 1;
        else break;
      }
      this.cursor = { slotId: slot.id, offset: end };
      this.selection = { slotId: slot.id, start, end };
      this.mode = { kind: 'edit' };
      return;
    }
    this.cursor = { slotId: slot.id, offset: idx + 1 };
    this.selection = { slotId: slot.id, start: idx, end: idx + 1 };
    this.mode = { kind: 'edit' };
  }

  public setCursor(slotId: string, offset: number): void {
    const slot = findSlot(this.doc.root, slotId);
    if (!slot) return;
    const next: Cursor = {
      slotId: slot.id,
      offset: Math.max(0, Math.min(offset, slot.children.length)),
    };
    if (next.slotId !== this.cursor.slotId) {
      this.jumpToCursor(next);
      return;
    }
    this.cursor = next;
    this.selection = null;
    this.mode = { kind: 'edit' };
  }

  public triggerLeader(): void {
    if (this.mode.kind === 'leader') {
      this.mode = { kind: 'edit' };
      return;
    }
    this.mode = { kind: 'leader', prefix: '' };
  }

  public exitMode(): void {
    this.mode = { kind: 'edit' };
    this.selection = null;
  }

  public enterJumpMode(): void {
    const targets = buildJumpTargets(this.doc.root);
    if (targets.length === 0) {
      this.mode = { kind: 'edit' };
      return;
    }
    this.mode = {
      kind: 'jump',
      scopePath: [],
      scopeSlotId: this.doc.root.id,
      typed: '',
      targets,
      activeIdx: 0,
    };
  }

  private drillIntoJumpScope(slotId: string, label: string): boolean {
    if (this.mode.kind !== 'jump') return false;
    const subSlot = findSlot(this.doc.root, slotId);
    if (!subSlot) return false;
    const subTargets = buildJumpTargets(subSlot);
    if (subTargets.length === 0) {
      this.jumpToCursor({ slotId: subSlot.id, offset: subSlot.children.length });
      return true;
    }
    this.mode = {
      kind: 'jump',
      scopePath: [...this.mode.scopePath, { slotId, label }],
      scopeSlotId: slotId,
      typed: '',
      targets: subTargets,
      activeIdx: 0,
    };
    return true;
  }

  public stepJumpBack(): void {
    if (this.mode.kind !== 'jump') return;
    if (this.mode.typed.length > 0) {
      const scopeSlot = findSlot(this.doc.root, this.mode.scopeSlotId) ?? this.doc.root;
      this.mode = {
        ...this.mode,
        typed: '',
        targets: buildJumpTargets(scopeSlot),
        activeIdx: 0,
      };
      return;
    }
    if (this.mode.scopePath.length === 0) {
      this.mode = { kind: 'edit' };
      return;
    }
    const nextPath = this.mode.scopePath.slice(0, -1);
    const parentSlotId = nextPath.length > 0 ? nextPath[nextPath.length - 1].slotId : this.doc.root.id;
    const parentSlot = findSlot(this.doc.root, parentSlotId) ?? this.doc.root;
    this.mode = {
      kind: 'jump',
      scopePath: nextPath,
      scopeSlotId: parentSlot.id,
      typed: '',
      targets: buildJumpTargets(parentSlot),
      activeIdx: 0,
    };
  }

  public moveJumpSelection(delta: -1 | 1): void {
    if (this.mode.kind !== 'jump' || this.mode.targets.length === 0) return;
    const len = this.mode.targets.length;
    const nextIdx = (this.mode.activeIdx + delta + len) % len;
    this.mode = { ...this.mode, activeIdx: nextIdx };
  }

  public drillJumpSelection(): boolean {
    if (this.mode.kind !== 'jump') return false;
    const target = this.mode.targets[this.mode.activeIdx];
    if (!target || !target.isComposite) return false;
    return this.drillIntoJumpScope(target.slotId, target.slotLabel);
  }

  public confirmJumpSelection(): boolean {
    if (this.mode.kind !== 'jump') return false;
    // If user drilled into a composite scope and pressed Enter immediately, jump to end of that scope!
    if (this.mode.scopePath.length > 0 && this.mode.activeIdx === 0) {
      const scopeSlot = findSlot(this.doc.root, this.mode.scopeSlotId);
      if (scopeSlot) {
        this.jumpToCursor({ slotId: scopeSlot.id, offset: scopeSlot.children.length });
        return true;
      }
    }
    const target = this.mode.targets[this.mode.activeIdx];
    if (!target) {
      this.mode = { kind: 'edit' };
      return false;
    }
    if (target.isComposite) {
      return this.drillIntoJumpScope(target.slotId, target.slotLabel);
    }
    this.jumpToCursor({ slotId: target.slotId, offset: target.offset });
    return true;
  }

  public handleJumpKey(key: string): boolean {
    if (this.mode.kind !== 'jump') return false;
    const scopeSlot = findSlot(this.doc.root, this.mode.scopeSlotId) ?? this.doc.root;

    // Quick navigation shortcuts inside Esc jump mode (v0.8.1 ergonomics)
    if (this.mode.typed === '') {
      if (key === '.' || key === ';' || key === '$') {
        this.jumpToCursor({ slotId: scopeSlot.id, offset: scopeSlot.children.length });
        return true;
      }
      if (key === '0' || key === '^') {
        this.jumpToCursor({ slotId: scopeSlot.id, offset: 0 });
        return true;
      }
      if (key === '-') {
        return this.jumpBack();
      }
      if (key === '=' || key === '+') {
        return this.jumpForward();
      }
    }

    const ch = key.toLowerCase();
    if (!/^[a-z]$/.test(ch)) {
      this.mode = { kind: 'edit' };
      return false;
    }
    const nextTyped = this.mode.typed + ch;
    const exact = this.mode.targets.find((t) => t.label === nextTyped);
    if (exact) {
      if (exact.isComposite) {
        return this.drillIntoJumpScope(exact.slotId, exact.slotLabel);
      }
      this.jumpToCursor({ slotId: exact.slotId, offset: exact.offset });
      return true;
    }
    const remaining = this.mode.targets.filter((t) => t.label.startsWith(nextTyped));
    if (remaining.length === 0) {
      this.mode = { kind: 'edit' };
      return false;
    }
    this.mode = {
      ...this.mode,
      typed: nextTyped,
      targets: remaining,
      activeIdx: 0,
    };
    return true;
  }

  public insertSnippetAtCursor(snippet: Pick<Snippet, 'latex'>): boolean {
    const res = importFormula(snippet.latex);
    const hasErr = res.diagnostics.some((d) => d.severity === 'error');
    if (hasErr || res.doc.root.children.length === 0) return false;
    this.pushHistory();
    this.deleteSelectionInternal();
    const slot = this.currentSlot();
    const inserted = res.doc.root.children;
    slot.children.splice(this.cursor.offset, 0, ...inserted);
    const afterOffset = this.cursor.offset + inserted.length;
    this.mode = { kind: 'edit' };

    // Jump straight into the first empty slot inside the inserted snippet if one exists!
    const findFirstEmpty = (nodes: readonly MathNode[]): SlotNode | null => {
      for (const n of nodes) {
        if (n.type === 'struct') {
          for (const sub of n.slots) {
            if (sub.children.length === 0) return sub;
            const deeper = findFirstEmpty(sub.children);
            if (deeper) return deeper;
          }
        }
      }
      return null;
    };
    const firstEmpty = findFirstEmpty(inserted);
    if (firstEmpty) {
      this.cursor = { slotId: firstEmpty.id, offset: 0 };
    } else {
      this.cursor = { slotId: slot.id, offset: afterOffset };
    }
    return true;
  }

  public acceptSubmenuDefault(): boolean {
    if (this.mode.kind !== 'leader' || this.mode.prefix === '') return false;
    const { prefix } = this.mode;
    this.mode = { kind: 'edit' };
    if (prefix === 'k') {
      const firstCustom = this.customCommands[0];
      if (firstCustom) {
        this.insertCommand(firstCustom.id);
        return true;
      }
      return false;
    }
    if (prefix === 't') {
      const firstSnippet = this.snippets[0];
      if (firstSnippet) {
        return this.insertSnippetAtCursor(firstSnippet);
      }
      return false;
    }
    const list = getSubmenuCommands(prefix);
    if (list.length > 0) {
      this.insertCommand(list[0].id);
      return true;
    }
    return false;
  }

  public handleLeaderKey(key: string): { handled: boolean; executedCommandId?: string } {
    if (this.mode.kind !== 'leader') return { handled: false };
    if (key.length !== 1) return { handled: false };

    const { prefix } = this.mode;
    if (prefix === '') {
      // `Tab j` muscle-memory alias from v0.7/v0.8 -> enter Easymotion jump mode immediately!
      if (key === 'j' || key === 'J') {
        this.enterJumpMode();
        return { handled: true };
      }
      if (SUBMENU_KEYS.has(key) || key === 'k' || key === 't') {
        this.mode = { kind: 'leader', prefix: key };
        return { handled: true };
      }
      const direct = COMMANDS_BY_KEYS.get(key);
      if (direct) {
        this.mode = { kind: 'edit' };
        this.insertCommand(direct.id);
        return { handled: true, executedCommandId: direct.id };
      }
      // Unknown leader key -> gracefully dismiss leader mode
      this.mode = { kind: 'edit' };
      return { handled: true };
    }

    if (key === ' ') {
      this.acceptSubmenuDefault();
      return { handled: true };
    }

    if (prefix === 'k') {
      const custom = this.customCommands.find((c) => c.key === key);
      this.mode = { kind: 'edit' };
      if (custom) {
        this.insertCommand(custom.id);
        return { handled: true, executedCommandId: custom.id };
      }
      return { handled: true };
    }

    if (prefix === 't') {
      const snip = this.snippets.find((s) => s.key === key);
      this.mode = { kind: 'edit' };
      if (snip) {
        this.insertSnippetAtCursor(snip);
        return { handled: true, executedCommandId: snip.id };
      }
      return { handled: true };
    }

    const full = COMMANDS_BY_KEYS.get(prefix + key);
    this.mode = { kind: 'edit' };
    if (full) {
      this.insertCommand(full.id);
      return { handled: true, executedCommandId: full.id };
    }
    return { handled: true };
  }

  public stepLeaderBack(): void {
    if (this.mode.kind !== 'leader') return;
    if (this.mode.prefix.length > 0) {
      this.mode = { kind: 'leader', prefix: '' };
    } else {
      this.mode = { kind: 'edit' };
    }
  }

  public insertText(text: string): void {
    if (!text) return;
    if (this.mode.kind === 'jump') {
      if (text.length === 1) {
        this.handleJumpKey(text);
      } else {
        this.mode = { kind: 'edit' };
      }
      return;
    }
    if (this.mode.kind === 'leader') {
      if (text.length === 1) {
        this.handleLeaderKey(text);
      } else {
        this.mode = { kind: 'edit' };
      }
      return;
    }

    // Single-character smart triggers
    if (text.length === 1) {
      const ch = text;
      if (ch === ';' && this.settings.semicolonNextSlot) {
        const path = findSlotPath(this.doc.root, this.cursor.slotId);
        if (path && path.length > 1) {
          this.nextSlot();
          return;
        }
      }
      // Auto-closing brackets `( )`, `[ ]`, `{ }` + overtype skip-out on closing `)`, `]`, `}`!
      if (this.settings.autoBrackets) {
        const openBracketCmd =
          ch === '(' ? 'paren' : ch === '[' ? 'bracket' : ch === '{' ? 'brace' : null;
        if (openBracketCmd && !this.isEscapedBeforeCursor()) {
          this.insertAutoBracket(openBracketCmd);
          return;
        }
        const closeBracketCmd =
          ch === ')' ? 'paren' : ch === ']' ? 'bracket' : ch === '}' ? 'brace' : null;
        if (closeBracketCmd && this.trySkipClosingBracket(closeBracketCmd)) {
          return;
        }
      }
      if (this.settings.naturalScripts && (ch === '^' || ch === '_')) {
        this.insertNaturalScript(ch === '^' ? 'sup' : 'sub');
        return;
      }
      if (this.settings.naturalFraction && this.settings.leaderKey !== '/' && ch === '/') {
        this.insertNaturalFraction();
        return;
      }
      // Inline `\alpha ` completion or optional Space-exits-script
      if (ch === ' ') {
        if (this.tryExpandInlineMacro()) {
          return;
        }
        if (this.settings.spaceExitsScript && this.trySpaceExitScript()) {
          return;
        }
      }
    }

    this.pushHistory();
    this.deleteSelectionInternal();
    const slot = this.currentSlot();
    const nodes = textToCharNodes(text);
    slot.children.splice(this.cursor.offset, 0, ...nodes);
    this.cursor.offset += nodes.length;

    if (this.settings.autoShorthands && text.length === 1) {
      // Check user-defined custom shorthands first
      const customMatched = this.matchCustomShorthand(slot.children, this.cursor.offset);
      if (customMatched) {
        this.pushHistory();
        slot.children.splice(customMatched.start, this.cursor.offset - customMatched.start);
        this.cursor.offset = customMatched.start;
        this.insertCustomCommandInternal(customMatched.command);
        return;
      }

      const matched = matchTrailingShorthand(slot.children, this.cursor.offset);
      if (matched) {
        // Push separate history step so a single Ctrl+Z reverts `\infty` back to literal `oo`
        this.pushHistory();
        const sym = createSymbolNode(matched.command);
        slot.children.splice(matched.start, this.cursor.offset - matched.start, sym);
        this.cursor.offset = matched.start + 1;
      }
    }
  }

  private matchCustomShorthand(
    children: readonly MathNode[],
    offset: number,
  ): { start: number; command: CustomCommandDef } | null {
    if (this.customCommands.length === 0 || offset <= 0) return null;
    for (const cmd of this.customCommands) {
      const trigger = cmd.shorthand?.trim();
      if (!trigger || trigger.length > offset) continue;
      let ok = true;
      const start = offset - trigger.length;
      for (let i = 0; i < trigger.length; i += 1) {
        const n = children[start + i];
        if (n.type !== 'char' || n.value !== trigger[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (/^[a-zA-Z]+$/.test(trigger) && start > 0) {
        const prev = children[start - 1];
        if (prev.type === 'char' && /^[a-zA-Z]$/.test(prev.value)) continue;
      }
      return { start, command: cmd };
    }
    return null;
  }

  private insertCustomCommandInternal(custom: CustomCommandDef): void {
    const slot = this.currentSlot();
    if (custom.slots.length === 0) {
      this.deleteSelectionInternal();
      slot.children.splice(this.cursor.offset, 0, createRawNode(custom.latex));
      this.cursor.offset += 1;
      return;
    }
    const slotContents: MathNode[][] = custom.slots.map(() => []);
    if (this.selection && this.selection.slotId === slot.id) {
      slotContents[0] = this.deleteSelectionInternal();
    }
    const struct = createStructNode(
      { id: custom.id, slots: custom.slots, latex: custom.latex },
      slotContents,
      custom.latex,
    );
    slot.children.splice(this.cursor.offset, 0, struct);
    const firstEmpty = struct.slots.find((s) => s.children.length === 0) ?? struct.slots[0];
    this.cursor = { slotId: firstEmpty.id, offset: 0 };
  }

  private isEscapedBeforeCursor(): boolean {
    const slot = this.currentSlot();
    if (this.cursor.offset <= 0) return false;
    const prev = slot.children[this.cursor.offset - 1];
    return prev.type === 'char' && prev.value === '\\';
  }

  private insertAutoBracket(commandId: 'paren' | 'bracket' | 'brace'): void {
    const cmd = COMMANDS_BY_ID.get(commandId);
    if (!cmd) return;
    this.pushHistory();
    const slot = this.currentSlot();
    let innerNodes: MathNode[] = [];
    const hadSelection = this.selection !== null && this.selection.slotId === slot.id;
    if (hadSelection) {
      innerNodes = this.deleteSelectionInternal();
    }
    const struct = createStructNode(cmd, [innerNodes]);
    struct.autoSized = true;
    slot.children.splice(this.cursor.offset, 0, struct);
    if (hadSelection) {
      // Wrapped selection -> cursor moves right after the closing bracket (matches v0.8.1!)
      this.cursor = { slotId: slot.id, offset: this.cursor.offset + 1 };
    } else {
      this.cursor = { slotId: struct.slots[0].id, offset: 0 };
    }
  }

  private trySkipClosingBracket(commandId: 'paren' | 'bracket' | 'brace'): boolean {
    const path = findSlotPath(this.doc.root, this.cursor.slotId);
    if (!path || path.length <= 1) return false;

    const DELIMS = new Set(['paren', 'bracket', 'brace', 'abs', 'norm']);

    // Walk up from current slot: if we're at the trailing end of the current slot
    // (and any intermediate non-delimiter struct like `\frac{1}{2}` or `x^2` that sits
    // at the end of the enclosing matching bracket), typing `)` / `]` / `}` cleanly jumps out!
    let atTrailingEdge = this.cursor.offset === path[path.length - 1].slot.children.length;
    if (!atTrailingEdge) return false;

    for (let i = path.length - 1; i >= 1; i -= 1) {
      const entry = path[i];
      const struct = entry.parentStruct;
      const parentSlot = entry.parentSlot;
      if (!struct || !parentSlot) break;

      if (struct.commandId === commandId) {
        this.cursor = { slotId: parentSlot.id, offset: entry.nodeIndexInParent + 1 };
        this.selection = null;
        return true;
      }

      // Stop climbing if we hit a DIFFERENT delimiter container (e.g. `]` inside `(...)`)
      if (DELIMS.has(struct.commandId)) {
        break;
      }

      // Only climb past non-delimiter struct (e.g. `frac`, `sup`, `sub`, `sqrt`) if we are
      // in its final slot AND it is the last node in its parent slot (trailing edge)
      const isLastSlot = entry.slotIndexInStruct === struct.slots.length - 1;
      const isLastNodeInParent = entry.nodeIndexInParent === parentSlot.children.length - 1;
      if (!isLastSlot || !isLastNodeInParent) {
        break;
      }
    }
    return false;
  }

  private trySpaceExitScript(): boolean {
    const path = findSlotPath(this.doc.root, this.cursor.slotId);
    if (!path || path.length <= 1) return false;
    const cur = path[path.length - 1];
    const parentStruct = cur.parentStruct;
    const parentSlot = cur.parentSlot;
    if (!parentStruct || !parentSlot) return false;
    if (cur.slot.children.length === 0 || this.cursor.offset !== cur.slot.children.length) {
      return false;
    }

    const cmdId = parentStruct.commandId;
    const sIdx = cur.slotIndexInStruct;
    // Exit tight script slot (exponent/subscript) cleanly on Space at end!
    const isScriptEnd =
      ((cmdId === 'sup' || cmdId === 'sub') && sIdx === 1) ||
      (cmdId === 'subsup' && (sIdx === 1 || sIdx === 2));

    if (!isScriptEnd) return false;

    if (cmdId === 'subsup' && sIdx === 1 && parentStruct.slots[2].children.length === 0) {
      this.cursor = { slotId: parentStruct.slots[2].id, offset: 0 };
      return true;
    }
    this.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent + 1 };
    return true;
  }

  private tryExpandInlineMacro(): boolean {
    const slot = this.currentSlot();
    let start = this.cursor.offset - 1;
    while (start >= 0) {
      const n = slot.children[start];
      if (n.type === 'char' && /[a-zA-Z]/.test(n.value)) {
        start -= 1;
      } else {
        break;
      }
    }
    if (start < 0) return false;
    const bs = slot.children[start];
    if (bs.type !== 'char' || bs.value !== '\\') return false;
    const name = slot.children
      .slice(start + 1, this.cursor.offset)
      .map((n) => (n.type === 'char' ? n.value : ''))
      .join('');
    if (!name) return false;

    const parsed = importFormula(`\\${name}`);
    const hasErr = parsed.diagnostics.some((d) => d.severity === 'error');
    const hasWarn = parsed.diagnostics.some((d) => d.severity === 'warning');
    if (hasErr || hasWarn || parsed.doc.root.children.length === 0) return false;

    this.pushHistory();
    slot.children.splice(start, this.cursor.offset - start, ...parsed.doc.root.children);
    this.cursor.offset = start + parsed.doc.root.children.length;
    return true;
  }

  private insertNaturalScript(kind: 'sup' | 'sub'): void {
    const cmd = COMMANDS_BY_ID.get(kind);
    if (!cmd) return;
    this.pushHistory();

    const slot = this.currentSlot();
    let baseNodes: MathNode[] = [];

    if (this.selection && this.selection.slotId === slot.id) {
      baseNodes = this.deleteSelectionInternal();
    } else if (this.cursor.offset > 0) {
      const prev = slot.children[this.cursor.offset - 1];
      // If previous is already `sub` and user types `^`, upgrade cleanly to `subsup`!
      if (kind === 'sup' && prev.type === 'struct' && prev.commandId === 'sub') {
        const subsup = COMMANDS_BY_ID.get('subsup')!;
        const upgraded = createStructNode(subsup, [
          prev.slots[0].children,
          prev.slots[1].children,
          [],
        ]);
        slot.children.splice(this.cursor.offset - 1, 1, upgraded);
        this.cursor = { slotId: upgraded.slots[2].id, offset: 0 };
        return;
      }
      if (kind === 'sub' && prev.type === 'struct' && prev.commandId === 'sup') {
        const subsup = COMMANDS_BY_ID.get('subsup')!;
        const upgraded = createStructNode(subsup, [
          prev.slots[0].children,
          [],
          prev.slots[1].children,
        ]);
        slot.children.splice(this.cursor.offset - 1, 1, upgraded);
        this.cursor = { slotId: upgraded.slots[1].id, offset: 0 };
        return;
      }

      if (
        prev.type !== 'char' ||
        !/^[\s+=,;:\-<>()[\]]$/.test(prev.value)
      ) {
        // Grab contiguous digits/letters or single symbol/struct atom
        if (prev.type === 'char' && /[0-9]/.test(prev.value)) {
          let start = this.cursor.offset - 1;
          while (start > 0) {
            const c = slot.children[start - 1];
            if (c.type === 'char' && /[0-9]/.test(c.value)) start -= 1;
            else break;
          }
          baseNodes = slot.children.splice(start, this.cursor.offset - start);
          this.cursor.offset = start;
        } else {
          baseNodes = slot.children.splice(this.cursor.offset - 1, 1);
          this.cursor.offset -= 1;
        }
      }
    }

    const struct = createStructNode(cmd, [baseNodes, []]);
    slot.children.splice(this.cursor.offset, 0, struct);
    this.cursor = {
      slotId: baseNodes.length > 0 ? struct.slots[1].id : struct.slots[0].id,
      offset: 0,
    };
  }

  private insertNaturalFraction(): void {
    const cmd = COMMANDS_BY_ID.get('frac');
    if (!cmd) return;
    this.pushHistory();

    const slot = this.currentSlot();
    let numNodes: MathNode[] = [];

    if (this.selection && this.selection.slotId === slot.id) {
      numNodes = this.deleteSelectionInternal();
    } else if (this.cursor.offset > 0) {
      let start = this.cursor.offset;
      // Skip trailing spaces before `/`
      let end = this.cursor.offset;
      while (end > 0) {
        const c = slot.children[end - 1];
        if (c.type === 'char' && c.value === ' ') end -= 1;
        else break;
      }
      start = end;
      const STOP_SYMBOL_IDS = new Set([
        'to', 'pm', 'mp', 'times', 'cdot', 'in', 'notin', 'subseteq', 'subset',
        'equiv', 'approx', 'sim', 'propto', 'implies', 'iff', 'mapsto', 'cong',
        'll', 'gg', 'simeq', 'leq', 'geq', 'neq', 'cup', 'cap', 'land', 'lor',
        'setminus', 'parallel', 'perp', 'indef_integral',
      ]);
      const STOP_STRUCT_IDS = new Set([
        'integral', 'sum', 'product', 'limit', 'double_integral', 'triple_integral', 'contour_integral',
      ]);
      while (start > 0) {
        const c = slot.children[start - 1];
        if (c.type === 'char' && /^[+=,;:\-<>()[\]~]$/.test(c.value)) {
          break;
        }
        // If we encounter a space right after a math function (`cos`, `sin`, ...) that itself follows
        // another factor (e.g. `f(x) cos n pi x/l` or `(...) cos n pi x/l`), stop AFTER the function!
        // Meanwhile standalone `sin x/x` keeps `\sin x` together in the numerator `\frac{\sin x}{x}`.
        if (c.type === 'char' && c.value === ' ') {
          let wEnd = start - 1;
          while (wEnd > 0) {
            const sp = slot.children[wEnd - 1];
            if (sp.type === 'char' && sp.value === ' ') wEnd -= 1;
            else break;
          }
          let wStart = wEnd;
          while (wStart > 0) {
            const lc = slot.children[wStart - 1];
            if (lc.type === 'char' && /^[A-Za-z]$/.test(lc.value)) wStart -= 1;
            else break;
          }
          if (wStart < wEnd) {
            const word = slot.children
              .slice(wStart, wEnd)
              .map((n) => (n.type === 'char' ? n.value : ''))
              .join('');
            if (MATH_FUNCTIONS.has(word)) {
              let beforeFunc = wStart - 1;
              while (
                beforeFunc >= 0 &&
                slot.children[beforeFunc].type === 'char' &&
                (slot.children[beforeFunc] as { value: string }).value === ' '
              ) {
                beforeFunc -= 1;
              }
              if (beforeFunc >= 0) {
                const bf = slot.children[beforeFunc];
                const isFactorBeforeFunc =
                  (bf.type === 'struct' && !STOP_STRUCT_IDS.has(bf.commandId)) ||
                  (bf.type === 'symbol' && !STOP_SYMBOL_IDS.has(bf.commandId)) ||
                  (bf.type === 'char' && !/^[+=,;:\-<>([\~]$/.test(bf.value));
                if (isFactorBeforeFunc) {
                  break;
                }
              }
            }
          }
        }
        if (c.type === 'symbol' && STOP_SYMBOL_IDS.has(c.commandId)) {
          break;
        }
        if (c.type === 'struct' && STOP_STRUCT_IDS.has(c.commandId)) {
          break;
        }
        if (c.type === 'raw' && c.latex.trim() === '\\\\') {
          break;
        }
        start -= 1;
      }
      // Trim leading spaces inside grabbed numerator
      while (start < end) {
        const c = slot.children[start];
        if (c.type === 'char' && c.value === ' ') start += 1;
        else break;
      }
      if (end > start) {
        numNodes = slot.children.splice(start, this.cursor.offset - start);
        // Remove trailing spaces we skipped from grabbed numerator
        while (numNodes.length > 0) {
          const last = numNodes[numNodes.length - 1];
          if (last.type === 'char' && last.value === ' ') numNodes.pop();
          else break;
        }
        this.cursor.offset = start;
      }
    }

    const struct = createStructNode(cmd, [numNodes, []]);
    if (numNodes.length > 0) {
      // Numerator was already typed before `/`, so Enter after denominator should always exit cleanly
      struct.fillOrder = [0, 1];
    }
    slot.children.splice(this.cursor.offset, 0, struct);
    if (numNodes.length > 0) {
      this.cursor = { slotId: struct.slots[1].id, offset: 0 };
    } else {
      const order = getSlotOrder(cmd.id, this.settings, struct.slots.length);
      this.cursor = { slotId: struct.slots[order[0]].id, offset: 0 };
    }
  }

  public insertCommand(commandId: string): boolean {
    const custom = this.customCommands.find((c) => c.id === commandId);
    if (custom) {
      this.pushHistory();
      this.mode = { kind: 'edit' };
      this.insertCustomCommandInternal(custom);
      return true;
    }

    const cmd = COMMANDS_BY_ID.get(commandId);
    if (!cmd) return false;

    this.pushHistory();
    this.mode = { kind: 'edit' };

    const slot = this.currentSlot();
    if (cmd.slots.length === 0) {
      this.deleteSelectionInternal();
      const sym = createSymbolNode(cmd);
      slot.children.splice(this.cursor.offset, 0, sym);
      this.cursor.offset += 1;
      return true;
    }

    const slotContents: MathNode[][] = cmd.slots.map(() => []);
    let wrappedSlotIdx: number | null = null;

    const BACKWARD_WRAP_CMDS = new Set([
      'hat',
      'bar',
      'vec',
      'tilde',
      'dot',
      'ddot',
      'overline',
      'underline',
      'sup',
      'sub',
      'subsup',
    ]);

    if (this.selection && this.selection.slotId === slot.id) {
      const selected = this.deleteSelectionInternal();
      const targetIdx = cmd.wrapSlot ?? 0;
      if (targetIdx >= 0 && targetIdx < slotContents.length) {
        slotContents[targetIdx] = selected;
        wrappedSlotIdx = targetIdx;
      }
    } else if (
      BACKWARD_WRAP_CMDS.has(cmd.id) &&
      this.cursor.offset > 0 &&
      cmd.wrapSlot === 0
    ) {
      // Smart backward atom wrap: e.g. `x` + `Tab a c` -> `\vec{x}`, `x` + `Tab u` -> `x^{□}`!
      const prev = slot.children[this.cursor.offset - 1];
      const isWrappable =
        prev.type === 'symbol' ||
        (prev.type === 'struct' &&
          !['integral', 'sum', 'product', 'limit', 'double_integral', 'triple_integral', 'contour_integral'].includes(
            prev.commandId,
          )) ||
        (prev.type === 'char' && !/^[\s+=,;:\-<>()[\]~]$/.test(prev.value));

      if (isWrappable) {
        let wrapped: MathNode[];
        if (prev.type === 'char' && /[0-9]/.test(prev.value)) {
          let start = this.cursor.offset - 1;
          while (start > 0) {
            const c = slot.children[start - 1];
            if (c.type === 'char' && /[0-9]/.test(c.value)) start -= 1;
            else break;
          }
          wrapped = slot.children.splice(start, this.cursor.offset - start);
          this.cursor.offset = start;
        } else {
          wrapped = slot.children.splice(this.cursor.offset - 1, 1);
          this.cursor.offset -= 1;
        }
        slotContents[0] = wrapped;
        wrappedSlotIdx = 0;
      }
    } else if (
      cmd.wrapSlot !== null &&
      cmd.wrapSlot > 0 &&
      this.cursor.offset < slot.children.length
    ) {
      // Smart prepend wrapping (e.g. `lim`, `int`, `sum`, `prod` inserted before `frac(sin x, x) = 1`)
      let end = this.cursor.offset;
      while (end < slot.children.length) {
        const n = slot.children[end];
        if (n.type === 'char' && (n.value === '=' || n.value === ',' || n.value === ';')) break;
        if (n.type === 'raw' && n.latex.trim() === '\\\\') break;
        end += 1;
      }
      // Trim trailing whitespace from wrapped term
      while (end > this.cursor.offset) {
        const last = slot.children[end - 1];
        if (last.type === 'char' && last.value === ' ') end -= 1;
        else break;
      }
      if (end > this.cursor.offset) {
        slotContents[cmd.wrapSlot] = slot.children.splice(
          this.cursor.offset,
          end - this.cursor.offset,
        );
        wrappedSlotIdx = cmd.wrapSlot;
      }
    }

    const struct = createStructNode(cmd, slotContents);
    slot.children.splice(this.cursor.offset, 0, struct);

    // Place cursor in the first empty slot according to the user's configured slot filling order
    const order = getSlotOrder(cmd.id, this.settings, struct.slots.length);
    const orderedSlots = order.map((idx) => struct.slots[idx]);
    const firstEmpty = orderedSlots.find((s) => s.children.length === 0);
    if (firstEmpty) {
      this.cursor = { slotId: firstEmpty.id, offset: 0 };
    } else if (wrappedSlotIdx !== null && struct.slots.length === 1) {
      this.cursor = { slotId: slot.id, offset: this.cursor.offset + 1 };
    } else {
      const first = orderedSlots[0] ?? struct.slots[0];
      this.cursor = { slotId: first.id, offset: first.children.length };
    }
    return true;
  }

  public nextSlot(): void {
    this.mode = { kind: 'edit' };
    this.selection = null;
    const path = findSlotPath(this.doc.root, this.cursor.slotId);
    if (!path) return;

    if (path.length === 1) {
      // At root: insert clean multiline break `\\` if root is non-empty
      if (this.doc.root.children.length > 0) {
        this.pushHistory();
        this.doc.root.children.splice(this.cursor.offset, 0, createRawNode('\\\\'));
        this.cursor.offset += 1;
      }
      return;
    }

    const cur = path[path.length - 1];
    const parentStruct = cur.parentStruct!;
    const parentSlot = cur.parentSlot!;
    const order =
      parentStruct.fillOrder ??
      getSlotOrder(parentStruct.commandId, this.settings, parentStruct.slots.length);
    const posInOrder = order.indexOf(cur.slotIndexInStruct);

    if (posInOrder >= 0 && posInOrder + 1 < order.length) {
      const next = parentStruct.slots[order[posInOrder + 1]];
      this.cursor = { slotId: next.id, offset: next.children.length };
    } else {
      // Exit right after this struct in its parent slot
      this.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent + 1 };
    }
  }

  public prevSlot(): void {
    this.mode = { kind: 'edit' };
    this.selection = null;
    const path = findSlotPath(this.doc.root, this.cursor.slotId);
    if (!path || path.length === 1) return;

    const cur = path[path.length - 1];
    const parentStruct = cur.parentStruct!;
    const parentSlot = cur.parentSlot!;
    const order =
      parentStruct.fillOrder ??
      getSlotOrder(parentStruct.commandId, this.settings, parentStruct.slots.length);
    const posInOrder = order.indexOf(cur.slotIndexInStruct);

    if (posInOrder > 0) {
      const prev = parentStruct.slots[order[posInOrder - 1]];
      this.cursor = { slotId: prev.id, offset: prev.children.length };
    } else {
      this.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent };
    }
  }

  public backspace(): void {
    if (this.mode.kind === 'leader') {
      this.stepLeaderBack();
      return;
    }
    if (this.mode.kind === 'jump') {
      this.mode = { kind: 'edit' };
      return;
    }

    if (this.selection) {
      this.pushHistory();
      this.deleteSelectionInternal();
      return;
    }

    const slot = this.currentSlot();
    if (this.cursor.offset > 0) {
      const prev = slot.children[this.cursor.offset - 1];
      if (prev.type === 'struct') {
        if (isStructEmpty(prev)) {
          this.pushHistory();
          slot.children.splice(this.cursor.offset - 1, 1);
          this.cursor.offset -= 1;
        } else {
          // Safe progressive deletion: enter the struct's last slot
          const lastSlot = prev.slots[prev.slots.length - 1];
          this.cursor = { slotId: lastSlot.id, offset: lastSlot.children.length };
        }
        return;
      }

      this.pushHistory();
      slot.children.splice(this.cursor.offset - 1, 1);
      this.cursor.offset -= 1;
      return;
    }

    // At offset 0 inside a nested slot
    const path = findSlotPath(this.doc.root, this.cursor.slotId);
    if (!path || path.length <= 1) return;
    const cur = path[path.length - 1];
    const parentStruct = cur.parentStruct!;
    const parentSlot = cur.parentSlot!;

    if (cur.slotIndexInStruct === 0) {
      const otherSlotsEmpty = parentStruct.slots
        .slice(1)
        .every((s) => s.children.length === 0);
      if (otherSlotsEmpty) {
        // Smoothly unwrap slot 0 into parent slot
        this.pushHistory();
        const unwrapped = cur.slot.children;
        parentSlot.children.splice(cur.nodeIndexInParent, 1, ...unwrapped);
        this.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent };
        return;
      }
      // Otherwise step outside before the struct
      this.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent };
      return;
    }

    // Move to end of previous sibling slot
    const prevSibling = parentStruct.slots[cur.slotIndexInStruct - 1];
    this.cursor = { slotId: prevSibling.id, offset: prevSibling.children.length };
  }

  public deleteForward(): void {
    this.mode = { kind: 'edit' };
    if (this.selection) {
      this.pushHistory();
      this.deleteSelectionInternal();
      return;
    }
    const slot = this.currentSlot();
    if (this.cursor.offset >= slot.children.length) return;
    const next = slot.children[this.cursor.offset];
    if (next.type === 'struct' && !isStructEmpty(next)) {
      this.cursor = { slotId: next.slots[0].id, offset: 0 };
      return;
    }
    this.pushHistory();
    slot.children.splice(this.cursor.offset, 1);
  }

  public moveLeft(extendSelection = false): void {
    this.mode = { kind: 'edit' };
    const slot = this.currentSlot();

    if (extendSelection) {
      const anchor = this.selection
        ? this.cursor.offset === this.selection.start
          ? this.selection.end
          : this.selection.start
        : this.cursor.offset;
      if (this.cursor.offset > 0) {
        this.cursor.offset -= 1;
        this.setSelectionRange(slot.id, anchor, this.cursor.offset);
      }
      return;
    }

    if (this.selection) {
      this.cursor = { slotId: this.selection.slotId, offset: this.selection.start };
      this.selection = null;
      return;
    }

    if (this.cursor.offset > 0) {
      const prev = slot.children[this.cursor.offset - 1];
      if (prev.type === 'struct') {
        const lastSlot = prev.slots[prev.slots.length - 1];
        this.cursor = { slotId: lastSlot.id, offset: lastSlot.children.length };
      } else {
        this.cursor.offset -= 1;
      }
      return;
    }

    // At start of nested slot -> move to prev sibling slot or before struct
    const path = findSlotPath(this.doc.root, this.cursor.slotId);
    if (!path || path.length <= 1) return;
    const cur = path[path.length - 1];
    const parentStruct = cur.parentStruct!;
    const parentSlot = cur.parentSlot!;
    if (cur.slotIndexInStruct > 0) {
      const prevSlot = parentStruct.slots[cur.slotIndexInStruct - 1];
      this.cursor = { slotId: prevSlot.id, offset: prevSlot.children.length };
    } else {
      this.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent };
    }
  }

  public moveRight(extendSelection = false): void {
    this.mode = { kind: 'edit' };
    const slot = this.currentSlot();

    if (extendSelection) {
      const anchor = this.selection
        ? this.cursor.offset === this.selection.end
          ? this.selection.start
          : this.selection.end
        : this.cursor.offset;
      if (this.cursor.offset < slot.children.length) {
        this.cursor.offset += 1;
        this.setSelectionRange(slot.id, anchor, this.cursor.offset);
      }
      return;
    }

    if (this.selection) {
      this.cursor = { slotId: this.selection.slotId, offset: this.selection.end };
      this.selection = null;
      return;
    }

    if (this.cursor.offset < slot.children.length) {
      const next = slot.children[this.cursor.offset];
      if (next.type === 'struct') {
        this.cursor = { slotId: next.slots[0].id, offset: 0 };
      } else {
        this.cursor.offset += 1;
      }
      return;
    }

    // At end of nested slot -> move to next sibling slot or after struct
    const path = findSlotPath(this.doc.root, this.cursor.slotId);
    if (!path || path.length <= 1) return;
    const cur = path[path.length - 1];
    const parentStruct = cur.parentStruct!;
    const parentSlot = cur.parentSlot!;
    if (cur.slotIndexInStruct + 1 < parentStruct.slots.length) {
      const nextSlot = parentStruct.slots[cur.slotIndexInStruct + 1];
      this.cursor = { slotId: nextSlot.id, offset: 0 };
    } else {
      this.cursor = { slotId: parentSlot.id, offset: cur.nodeIndexInParent + 1 };
    }
  }

  public escapeLevel(): boolean {
    this.mode = { kind: 'edit' };
    this.selection = null;
    const path = findSlotPath(this.doc.root, this.cursor.slotId);
    if (!path || path.length <= 1) return false;
    const cur = path[path.length - 1];
    if (!cur.parentSlot) return false;
    this.cursor = { slotId: cur.parentSlot.id, offset: cur.nodeIndexInParent + 1 };
    return true;
  }

  private findActiveGridContext(): {
    struct: StructNode;
    env: string;
    rows: number;
    cols: number;
    row: number;
    col: number;
    slotIdx: number;
  } | null {
    const path = findSlotPath(this.doc.root, this.cursor.slotId);
    if (!path || path.length <= 1) return null;
    for (let i = path.length - 1; i >= 1; i -= 1) {
      const entry = path[i];
      if (!entry.parentStruct) continue;
      const meta = getGridMeta(entry.parentStruct);
      if (meta) {
        const sIdx = entry.slotIndexInStruct;
        return {
          struct: entry.parentStruct,
          env: meta.env,
          rows: meta.rows,
          cols: meta.cols,
          row: Math.floor(sIdx / meta.cols),
          col: sIdx % meta.cols,
          slotIdx: sIdx,
        };
      }
    }
    return null;
  }

  private relabelGridSlots(struct: StructNode, env: string, rows: number, cols: number): void {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const s = struct.slots[r * cols + c];
        if (!s) continue;
        s.label = env === 'cases' ? (c === 0 ? `表达式${r + 1}` : `条件${r + 1}`) : `(${r + 1},${c + 1})`;
      }
    }
  }

  public addGridRow(): boolean {
    const ctx = this.findActiveGridContext();
    if (!ctx || ctx.rows >= 12) return false;
    this.pushHistory();
    const { struct, env, rows, cols, row } = ctx;
    const insertRow = row + 1;
    const newSlots: SlotNode[] = [];
    for (let c = 0; c < cols; c += 1) {
      newSlots.push(createSlot(env === 'cases' ? (c === 0 ? `表达式${insertRow + 1}` : `条件${insertRow + 1}`) : `(${insertRow + 1},${c + 1})`));
    }
    struct.slots.splice(insertRow * cols, 0, ...newSlots);
    struct.grid = { env, rows: rows + 1, cols };
    this.relabelGridSlots(struct, env, rows + 1, cols);
    this.cursor = { slotId: newSlots[0].id, offset: 0 };
    this.selection = null;
    this.mode = { kind: 'edit' };
    return true;
  }

  public removeGridRow(): boolean {
    const ctx = this.findActiveGridContext();
    if (!ctx || ctx.rows <= 1) return false;
    this.pushHistory();
    const { struct, env, rows, cols, row, col } = ctx;
    struct.slots.splice(row * cols, cols);
    const nextRows = rows - 1;
    struct.grid = { env, rows: nextRows, cols };
    this.relabelGridSlots(struct, env, nextRows, cols);
    const targetRow = Math.min(row, nextRows - 1);
    const targetSlot = struct.slots[targetRow * cols + col] ?? struct.slots[0];
    this.cursor = { slotId: targetSlot.id, offset: targetSlot.children.length };
    this.selection = null;
    this.mode = { kind: 'edit' };
    return true;
  }

  public addGridCol(): boolean {
    const ctx = this.findActiveGridContext();
    if (!ctx || ctx.env === 'cases' || ctx.cols >= 10) return false;
    this.pushHistory();
    const { struct, env, rows, cols, row, col } = ctx;
    const insertCol = col + 1;
    const nextCols = cols + 1;
    let focusSlot: SlotNode | null = null;
    for (let r = rows - 1; r >= 0; r -= 1) {
      const slot = createSlot(`(${r + 1},${insertCol + 1})`);
      struct.slots.splice(r * cols + insertCol, 0, slot);
      if (r === row) focusSlot = slot;
    }
    struct.grid = { env, rows, cols: nextCols };
    this.relabelGridSlots(struct, env, rows, nextCols);
    if (focusSlot) {
      this.cursor = { slotId: focusSlot.id, offset: 0 };
    }
    this.selection = null;
    this.mode = { kind: 'edit' };
    return true;
  }

  public removeGridCol(): boolean {
    const ctx = this.findActiveGridContext();
    if (!ctx || ctx.env === 'cases' || ctx.cols <= 1) return false;
    this.pushHistory();
    const { struct, env, rows, cols, row, col } = ctx;
    for (let r = rows - 1; r >= 0; r -= 1) {
      struct.slots.splice(r * cols + col, 1);
    }
    const nextCols = cols - 1;
    struct.grid = { env, rows, cols: nextCols };
    this.relabelGridSlots(struct, env, rows, nextCols);
    const targetCol = Math.min(col, nextCols - 1);
    const targetSlot = struct.slots[row * nextCols + targetCol] ?? struct.slots[0];
    this.cursor = { slotId: targetSlot.id, offset: targetSlot.children.length };
    this.selection = null;
    this.mode = { kind: 'edit' };
    return true;
  }

  private moveRootLineVertical(delta: -1 | 1): boolean {
    const children = this.doc.root.children;
    const lineBounds: { start: number; end: number }[] = [];
    let start = 0;
    for (let i = 0; i < children.length; i += 1) {
      if (children[i].type === 'raw' && (children[i] as { latex: string }).latex.trim() === '\\\\') {
        lineBounds.push({ start, end: i });
        start = i + 1;
      }
    }
    lineBounds.push({ start, end: children.length });
    if (lineBounds.length <= 1) return false;

    const curLine = lineBounds.findIndex(
      (b) => this.cursor.offset >= b.start && this.cursor.offset <= b.end,
    );
    if (curLine < 0) return false;
    const nextLine = curLine + delta;
    if (nextLine < 0 || nextLine >= lineBounds.length) return false;
    const colOffset = this.cursor.offset - lineBounds[curLine].start;
    const target = lineBounds[nextLine];
    this.cursor = {
      slotId: this.doc.root.id,
      offset: Math.min(target.start + colOffset, target.end),
    };
    return true;
  }

  public moveUp(): void {
    this.mode = { kind: 'edit' };
    this.selection = null;
    const path = findSlotPath(this.doc.root, this.cursor.slotId);
    if (!path) return;
    if (path.length <= 1) {
      this.moveRootLineVertical(-1);
      return;
    }

    const cur = path[path.length - 1];
    const parentStruct = cur.parentStruct!;
    const cmdId = parentStruct.commandId;
    const sIdx = cur.slotIndexInStruct;

    // Spatial vertical navigation inside structured math nodes
    if (
      (cmdId === 'frac' || cmdId === 'partial_frac' || cmdId === 'total_frac' || cmdId === 'binom') &&
      sIdx === 1
    ) {
      const num = parentStruct.slots[0];
      this.cursor = { slotId: num.id, offset: num.children.length };
      return;
    }
    if ((cmdId === 'integral' || cmdId === 'sum' || cmdId === 'product') && (sIdx === 0 || sIdx === 2)) {
      const upper = parentStruct.slots[1];
      this.cursor = { slotId: upper.id, offset: upper.children.length };
      return;
    }
    if (cmdId === 'limit' && (sIdx === 0 || sIdx === 1)) {
      const body = parentStruct.slots[2];
      this.cursor = { slotId: body.id, offset: body.children.length };
      return;
    }
    if (cmdId === 'subsup' && (sIdx === 1 || sIdx === 0)) {
      const sup = parentStruct.slots[2];
      this.cursor = { slotId: sup.id, offset: sup.children.length };
      return;
    }
    if (cmdId === 'sup' && sIdx === 0) {
      const exp = parentStruct.slots[1];
      this.cursor = { slotId: exp.id, offset: exp.children.length };
      return;
    }
    if (cmdId === 'sub' && sIdx === 1) {
      const base = parentStruct.slots[0];
      this.cursor = { slotId: base.id, offset: base.children.length };
      return;
    }

    // Dynamic R×C grids (matrices & cases of any size!)
    const grid = getGridMeta(parentStruct);
    if (grid && sIdx >= grid.cols) {
      const above = parentStruct.slots[sIdx - grid.cols];
      if (above) {
        this.cursor = { slotId: above.id, offset: above.children.length };
        return;
      }
    }

    // Otherwise step cleanly out one level to parent slot
    this.escapeLevel();
  }

  public moveDown(): void {
    this.mode = { kind: 'edit' };
    this.selection = null;
    const path = findSlotPath(this.doc.root, this.cursor.slotId);
    if (!path) return;
    if (path.length <= 1) {
      this.moveRootLineVertical(1);
      return;
    }

    const cur = path[path.length - 1];
    const parentStruct = cur.parentStruct!;
    const cmdId = parentStruct.commandId;
    const sIdx = cur.slotIndexInStruct;

    if (
      (cmdId === 'frac' || cmdId === 'partial_frac' || cmdId === 'total_frac' || cmdId === 'binom') &&
      sIdx === 0
    ) {
      const den = parentStruct.slots[1];
      this.cursor = { slotId: den.id, offset: den.children.length };
      return;
    }
    if ((cmdId === 'integral' || cmdId === 'sum' || cmdId === 'product') && (sIdx === 1 || sIdx === 2)) {
      const lower = parentStruct.slots[0];
      this.cursor = { slotId: lower.id, offset: lower.children.length };
      return;
    }
    if (cmdId === 'limit' && sIdx === 2) {
      const varSlot = parentStruct.slots[0];
      this.cursor = { slotId: varSlot.id, offset: varSlot.children.length };
      return;
    }
    if (cmdId === 'subsup' && (sIdx === 2 || sIdx === 0)) {
      const sub = parentStruct.slots[1];
      this.cursor = { slotId: sub.id, offset: sub.children.length };
      return;
    }
    if (cmdId === 'sup' && sIdx === 1) {
      const base = parentStruct.slots[0];
      this.cursor = { slotId: base.id, offset: base.children.length };
      return;
    }
    if (cmdId === 'sub' && sIdx === 0) {
      const sub = parentStruct.slots[1];
      this.cursor = { slotId: sub.id, offset: sub.children.length };
      return;
    }

    const grid = getGridMeta(parentStruct);
    if (grid && sIdx + grid.cols < parentStruct.slots.length) {
      const below = parentStruct.slots[sIdx + grid.cols];
      if (below) {
        this.cursor = { slotId: below.id, offset: below.children.length };
        return;
      }
    }

    // Otherwise step cleanly out after current structure
    this.escapeLevel();
  }

  public moveHome(extendSelection = false): void {
    this.mode = { kind: 'edit' };
    const slot = this.currentSlot();
    if (extendSelection) {
      const anchor = this.selection ? this.selection.end : this.cursor.offset;
      this.cursor.offset = 0;
      this.setSelectionRange(slot.id, 0, anchor);
    } else {
      this.cursor.offset = 0;
      this.selection = null;
    }
  }

  public moveEnd(extendSelection = false): void {
    this.mode = { kind: 'edit' };
    const slot = this.currentSlot();
    if (extendSelection) {
      const anchor = this.selection ? this.selection.start : this.cursor.offset;
      this.cursor.offset = slot.children.length;
      this.setSelectionRange(slot.id, anchor, slot.children.length);
    } else {
      this.cursor.offset = slot.children.length;
      this.selection = null;
    }
  }

  public selectAll(): void {
    this.mode = { kind: 'edit' };
    const slot = this.currentSlot();
    if (slot.children.length === 0) {
      // If active slot is empty, select entire root formula
      if (this.doc.root.children.length > 0) {
        this.cursor = { slotId: this.doc.root.id, offset: this.doc.root.children.length };
        this.selection = {
          slotId: this.doc.root.id,
          start: 0,
          end: this.doc.root.children.length,
        };
      }
      return;
    }
    this.cursor.offset = slot.children.length;
    this.selection = { slotId: slot.id, start: 0, end: slot.children.length };
  }

  private setSelectionRange(slotId: string, a: number, b: number): void {
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    this.selection = start === end ? null : { slotId, start, end };
  }
}

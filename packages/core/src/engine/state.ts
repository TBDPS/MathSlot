import {
  cloneDocument,
  countEmptySlots,
  createCharNode,
  createEmptyDocument,
  createRawNode,
  findSlot,
  findSlotPath,
  getBreadcrumbs,
  getGridMeta,
  slotHasRawNodes,
  syncIdCounterFromTree,
  validatePersistedDraftV1,
} from '../ast';
import { COMMANDS, COMMANDS_BY_ID, COMMANDS_BY_KEYS } from '../catalog';
import {
  hasColRightBar,
  isCasesEnv,
  normalizeSettings,
  sanitizeLatexTemplate,
} from '../commandSpecs';
import { isLineBreakRaw, toInteractiveLatex, toLatex } from '../latex';
import { importFormula, stripOuterDelimiters } from '../parser';
import type {
  ActiveGridInfo,
  AppSettings,
  CommandDef,
  Cursor,
  CustomCommandDef,
  Document,
  EditorMode,
  EditorSnapshot,
  GridRectSelection,
  ImportResult,
  InputContextKind,
  MathNode,
  MathWrapperKind,
  PersistedDraftV1,
  Selection,
  SlotNode,
  Snippet,
  StructNode,
} from '../types';

export interface HistoryEntry {
  doc: Document;
  cursor: Cursor;
  selection: Selection | null;
  latexArgCloseBySlot?: [string, '}' | ']'][];
  expectLatexOpenBraceSlotId?: string | null;
}

export interface LeaderMorphBackup {
  doc: Document;
  cursor: Cursor;
  selection: Selection | null;
  undoLen: number;
}

export const MAX_HISTORY = 200;
export const TYPING_COALESCE_MS = 500;

export interface EngineState {
  doc: Document;
  cursor: Cursor;
  selection: Selection | null;
  gridSelection: GridRectSelection | null;
  docRevision: number;
  cachedLatexRev: number;
  cachedLatexAuto: boolean;
  cachedLatex: string;
  mode: EditorMode;
  settings: AppSettings;
  effectiveCommands: readonly CommandDef[];
  commandsById: Map<string, CommandDef>;
  commandsByKeys: Map<string, CommandDef>;
  customCommands: CustomCommandDef[];
  snippets: Snippet[];
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  jumpHistory: Cursor[];
  jumpHistoryIdx: number;
  focused: boolean;
  lastTypingMeta: { slotId: string; offset: number; time: number } | null;
  listeners: Set<() => void>;
  leaderMorphBackup: LeaderMorphBackup | null;
  latexArgCloseBySlot: Map<string, '}' | ']'>;
  expectLatexOpenBraceSlotId: string | null;
  lastRestoredDraftWrapper: MathWrapperKind | null;
}

export function createEngineState(initialSettings: Partial<AppSettings> = {}): EngineState {
  const doc = createEmptyDocument();
  return {
    doc,
    cursor: { slotId: doc.root.id, offset: 0 },
    selection: null,
    gridSelection: null,
    docRevision: 0,
    cachedLatexRev: -1,
    cachedLatexAuto: true,
    cachedLatex: '',
    mode: { kind: 'edit' },
    settings: normalizeSettings(initialSettings),
    effectiveCommands: COMMANDS,
    commandsById: new Map(COMMANDS_BY_ID),
    commandsByKeys: new Map(COMMANDS_BY_KEYS),
    customCommands: [],
    snippets: [],
    undoStack: [],
    redoStack: [],
    jumpHistory: [],
    jumpHistoryIdx: -1,
    focused: true,
    lastTypingMeta: null,
    listeners: new Set(),
    leaderMorphBackup: null,
    latexArgCloseBySlot: new Map(),
    expectLatexOpenBraceSlotId: null,
    lastRestoredDraftWrapper: null,
  };
}

export function pruneLatexArgStateForCursor(state: EngineState): void {
  if (state.latexArgCloseBySlot.size === 0 && state.expectLatexOpenBraceSlotId === null) return;
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  const activeSlotIds = new Set(path ? path.map((entry) => entry.slot.id) : [state.doc.root.id]);
  for (const slotId of state.latexArgCloseBySlot.keys()) {
    if (!activeSlotIds.has(slotId)) {
      state.latexArgCloseBySlot.delete(slotId);
    }
  }
  if (state.expectLatexOpenBraceSlotId && state.expectLatexOpenBraceSlotId !== state.cursor.slotId) {
    state.expectLatexOpenBraceSlotId = null;
  }
}

export function emitChange(state: EngineState): void {
  pruneLatexArgStateForCursor(state);
  for (const fn of state.listeners) {
    fn();
  }
}

export function runTransaction<T>(
  state: EngineState,
  mutator: (s: EngineState) => T,
  options: { recordHistory?: boolean; bumpRevision?: boolean } = {},
): T {
  if (options.recordHistory) {
    pushHistory(state);
  } else if (options.bumpRevision) {
    state.docRevision += 1;
  }
  const result = mutator(state);
  emitChange(state);
  return result;
}

export function pushHistory(state: EngineState): void {
  state.lastTypingMeta = null;
  state.docRevision += 1;
  state.undoStack.push({
    doc: cloneDocument(state.doc),
    cursor: { ...state.cursor },
    selection: state.selection ? { ...state.selection } : null,
    latexArgCloseBySlot: Array.from(state.latexArgCloseBySlot.entries()),
    expectLatexOpenBraceSlotId: state.expectLatexOpenBraceSlotId,
  });
  if (state.undoStack.length > MAX_HISTORY) {
    state.undoStack.shift();
  }
  state.redoStack = [];
}

export function pushTypingHistory(state: EngineState, slotId: string, startOffset: number): void {
  const now = Date.now();
  state.docRevision += 1;
  if (
    !state.selection &&
    state.lastTypingMeta &&
    state.lastTypingMeta.slotId === slotId &&
    state.lastTypingMeta.offset === startOffset &&
    now - state.lastTypingMeta.time < TYPING_COALESCE_MS &&
    state.undoStack.length > 0
  ) {
    state.lastTypingMeta = { slotId, offset: startOffset + 1, time: now };
    state.redoStack = [];
    return;
  }
  pushHistory(state);
  state.lastTypingMeta = { slotId, offset: startOffset + 1, time: now };
}

export function currentSlot(state: EngineState): SlotNode {
  const slot = findSlot(state.doc.root, state.cursor.slotId);
  if (slot) return slot;
  state.cursor = { slotId: state.doc.root.id, offset: state.doc.root.children.length };
  return state.doc.root;
}

export function deleteSelectionInternal(state: EngineState): MathNode[] {
  if (!state.selection) return [];
  const slot = findSlot(state.doc.root, state.selection.slotId);
  if (!slot) {
    state.selection = null;
    return [];
  }
  const { start, end } = state.selection;
  const removed = slot.children.splice(start, end - start);
  state.cursor = { slotId: slot.id, offset: start };
  state.selection = null;
  return removed;
}

export function setSelectionRange(state: EngineState, slotId: string, a: number, b: number): void {
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  state.selection = start === end ? null : { slotId, start, end };
}

export function getInputContext(state: EngineState): InputContextKind {
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return 'math-root';
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const parent = path[i].parentStruct;
    if (!parent) continue;
    if (parent.commandId === 'raw_latex') return 'raw';
    if (parent.commandId === 'inline_math') return 'math-slot';
    if (parent.commandId === 'text_box') return 'text';
    if (getGridMeta(parent)) return 'math-grid';
  }
  return 'math-slot';
}

export function isInsideOperatorName(state: EngineState): boolean {
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return false;
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const parent = path[i].parentStruct;
    if (!parent) continue;
    if (parent.commandId === 'inline_math') return false;
    if (parent.commandId === 'operatorname') return true;
  }
  return false;
}

export function findStructById(slot: SlotNode, structId: string): StructNode | null {
  for (const child of slot.children) {
    if (child.type === 'struct') {
      if (child.id === structId) return child;
      for (const s of child.slots) {
        const hit = findStructById(s, structId);
        if (hit) return hit;
      }
    }
  }
  return null;
}

export function sanitizeNodesForTargetSlot(
  state: EngineState,
  nodes: MathNode[],
  targetSlotId: string,
): MathNode[] {
  const isRootTarget = targetSlotId === state.doc.root.id;
  const sanitizeChildList = (list: MathNode[], allowTopLevelBreak: boolean): MathNode[] =>
    list.map((n) => {
      if (isLineBreakRaw(n)) {
        return allowTopLevelBreak ? n : createCharNode(' ', true);
      }
      if (n.type === 'struct') {
        return {
          ...n,
          slots: n.slots.map((s) => ({
            ...s,
            children: sanitizeChildList(s.children, false),
          })),
        };
      }
      return n;
    });
  return sanitizeChildList(nodes, isRootTarget);
}

export function getActiveGridInfo(state: EngineState): ActiveGridInfo | null {
  const path = findSlotPath(state.doc.root, state.cursor.slotId);
  if (!path || path.length <= 1) return null;
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const entry = path[i];
    if (!entry.parentStruct) continue;
    const meta = getGridMeta(entry.parentStruct);
    if (meta) {
      const sIdx = entry.slotIndexInStruct;
      const col = sIdx % meta.cols;
      const canEditCols =
        !isCasesEnv(meta.env) && meta.env !== 'substack' && meta.env !== 'gathered';
      return {
        structId: entry.parentStruct.id,
        env: meta.env,
        rows: meta.rows,
        cols: meta.cols,
        row: Math.floor(sIdx / meta.cols),
        col,
        canEditCols,
        hasRightBar: canEditCols ? hasColRightBar(meta.colSpec, meta.cols, col) : false,
        colSpec: meta.colSpec,
      };
    }
  }
  return null;
}

export function buildSnapshot(state: EngineState): EditorSnapshot {
  if (
    state.cachedLatexRev !== state.docRevision ||
    state.cachedLatexAuto !== state.settings.autoShorthands
  ) {
    state.cachedLatex = toLatex(state.doc, { autoShorthands: state.settings.autoShorthands });
    state.cachedLatexRev = state.docRevision;
    state.cachedLatexAuto = state.settings.autoShorthands;
  }
  const latex = state.cachedLatex;
  const interactiveLatex = toInteractiveLatex(state.doc, state.cursor, state.selection, {
    focused: state.focused,
    showJumpTargets: state.mode.kind === 'jump',
    autoShorthands: state.settings.autoShorthands,
  });
  return {
    doc: state.doc,
    cursor: { ...state.cursor },
    selection: state.selection ? { ...state.selection } : null,
    gridSelection: state.gridSelection ? { ...state.gridSelection } : null,
    docRevision: state.docRevision,
    mode: state.mode,
    latex,
    interactiveLatex,
    breadcrumbs: getBreadcrumbs(
      state.doc.root,
      state.cursor.slotId,
      state.customCommands,
      state.effectiveCommands,
    ),
    activeGrid: getActiveGridInfo(state),
    emptySlotCount: countEmptySlots(state.doc.root),
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    isEmpty:
      state.doc.root.children.length === 0 ||
      state.doc.root.children.every((n) => n.type === 'char' && n.value === ' '),
    hasRawNodes: slotHasRawNodes(state.doc.root),
    inputContext: getInputContext(state),
  };
}

export function restoreLeaderMorphBackup(state: EngineState): boolean {
  if (!state.leaderMorphBackup) return false;
  const b = state.leaderMorphBackup;
  state.doc = b.doc;
  state.docRevision += 1;
  state.cursor = b.cursor;
  state.selection = b.selection;
  state.undoStack.length = Math.min(state.undoStack.length, b.undoLen);
  state.leaderMorphBackup = null;
  return true;
}

export function commitLeaderDefault(state: EngineState): void {
  state.leaderMorphBackup = null;
  if (state.mode.kind === 'leader') {
    state.mode = { kind: 'edit' };
    emitChange(state);
  }
}

export function cancelLeader(state: EngineState): void {
  restoreLeaderMorphBackup(state);
  state.mode = { kind: 'edit' };
  emitChange(state);
}

export function undoState(state: EngineState): boolean {
  const prev = state.undoStack.pop();
  if (!prev) return false;
  state.lastTypingMeta = null;
  state.redoStack.push({
    doc: cloneDocument(state.doc),
    cursor: { ...state.cursor },
    selection: state.selection ? { ...state.selection } : null,
    latexArgCloseBySlot: Array.from(state.latexArgCloseBySlot.entries()),
    expectLatexOpenBraceSlotId: state.expectLatexOpenBraceSlotId,
  });
  if (state.redoStack.length > MAX_HISTORY) {
    state.redoStack.shift();
  }
  state.doc = prev.doc;
  state.cursor = prev.cursor;
  state.selection = prev.selection ? { ...prev.selection } : null;
  state.gridSelection = null;
  state.docRevision += 1;
  state.latexArgCloseBySlot = new Map(prev.latexArgCloseBySlot ?? []);
  state.expectLatexOpenBraceSlotId = prev.expectLatexOpenBraceSlotId ?? null;
  state.leaderMorphBackup = null;
  state.mode = { kind: 'edit' };
  emitChange(state);
  return true;
}

export function redoState(state: EngineState): boolean {
  const next = state.redoStack.pop();
  if (!next) return false;
  state.lastTypingMeta = null;
  state.undoStack.push({
    doc: cloneDocument(state.doc),
    cursor: { ...state.cursor },
    selection: state.selection ? { ...state.selection } : null,
    latexArgCloseBySlot: Array.from(state.latexArgCloseBySlot.entries()),
    expectLatexOpenBraceSlotId: state.expectLatexOpenBraceSlotId,
  });
  if (state.undoStack.length > MAX_HISTORY) {
    state.undoStack.shift();
  }
  state.doc = next.doc;
  state.cursor = next.cursor;
  state.selection = next.selection ? { ...next.selection } : null;
  state.gridSelection = null;
  state.docRevision += 1;
  state.latexArgCloseBySlot = new Map(next.latexArgCloseBySlot ?? []);
  state.expectLatexOpenBraceSlotId = next.expectLatexOpenBraceSlotId ?? null;
  state.leaderMorphBackup = null;
  state.mode = { kind: 'edit' };
  emitChange(state);
  return true;
}

export function clearState(state: EngineState): void {
  if (state.doc.root.children.length === 0) return;
  runTransaction(
    state,
    (s) => {
      s.doc = createEmptyDocument();
      s.cursor = { slotId: s.doc.root.id, offset: 0 };
      s.selection = null;
      s.gridSelection = null;
      s.jumpHistory = [];
      s.jumpHistoryIdx = -1;
      s.leaderMorphBackup = null;
      s.latexArgCloseBySlot.clear();
      s.expectLatexOpenBraceSlotId = null;
      s.lastRestoredDraftWrapper = null;
      s.mode = { kind: 'edit' };
    },
    { recordHistory: true },
  );
}

export function loadFormulaState(state: EngineState, input: string): ImportResult {
  const result = importFormula(input);
  const hasHardError = result.diagnostics.some((d) => d.severity === 'error');
  if (hasHardError) {
    return result;
  }
  runTransaction(
    state,
    (s) => {
      s.doc = result.doc;
      s.cursor = { slotId: s.doc.root.id, offset: s.doc.root.children.length };
      s.selection = null;
      s.gridSelection = null;
      s.jumpHistory = [];
      s.jumpHistoryIdx = -1;
      s.leaderMorphBackup = null;
      s.latexArgCloseBySlot.clear();
      s.expectLatexOpenBraceSlotId = null;
      s.lastRestoredDraftWrapper = null;
      s.mode = { kind: 'edit' };
    },
    { recordHistory: true },
  );
  return result;
}

export function loadFormulaWithRawFallbackState(state: EngineState, input: string): ImportResult {
  const result = loadFormulaState(state, input);
  const hasHardError = result.diagnostics.some((d) => d.severity === 'error');
  if (hasHardError) {
    const stripped = stripOuterDelimiters(input).trim();
    if (stripped) {
      runTransaction(
        state,
        (s) => {
          const fallbackDoc = createEmptyDocument();
          fallbackDoc.root.children = [createRawNode(stripped)];
          s.doc = fallbackDoc;
          s.cursor = { slotId: fallbackDoc.root.id, offset: 1 };
          s.selection = null;
          s.jumpHistory = [];
          s.jumpHistoryIdx = -1;
          s.leaderMorphBackup = null;
          s.mode = { kind: 'edit' };
        },
        { recordHistory: true },
      );
    }
  }
  return result;
}

export function exportDraftV1State(state: EngineState, wrapper?: MathWrapperKind): PersistedDraftV1 {
  return {
    schemaVersion: 1,
    updatedAt: Date.now(),
    root: cloneDocument(state.doc).root,
    cursor: { ...state.cursor },
    ...(wrapper ? { wrapper } : {}),
  };
}

export function restoreDraftV1State(state: EngineState, raw: unknown): boolean {
  const valid = validatePersistedDraftV1(raw);
  if (!valid) return false;
  syncIdCounterFromTree(valid.root);
  return runTransaction(
    state,
    (s) => {
      s.doc = { root: valid.root };
      const targetSlot = findSlot(s.doc.root, valid.cursor.slotId) ?? s.doc.root;
      s.cursor = {
        slotId: targetSlot.id,
        offset: Math.max(0, Math.min(valid.cursor.offset, targetSlot.children.length)),
      };
      s.selection = null;
      s.gridSelection = null;
      s.jumpHistory = [];
      s.jumpHistoryIdx = -1;
      s.leaderMorphBackup = null;
      s.latexArgCloseBySlot.clear();
      s.expectLatexOpenBraceSlotId = null;
      s.lastRestoredDraftWrapper = valid.wrapper ?? null;
      s.mode = { kind: 'edit' };
      s.docRevision += 1;
      return true;
    },
    { recordHistory: true },
  );
}

export function setEffectiveCommandsState(state: EngineState, commands: readonly CommandDef[]): void {
  state.effectiveCommands = commands.map((c) => ({
    ...c,
    latex: sanitizeLatexTemplate(c.latex),
  }));
  state.commandsById = new Map(state.effectiveCommands.map((c) => [c.id, c]));
  state.commandsByKeys = new Map(
    state.effectiveCommands.filter((c) => c.keys.length > 0).map((c) => [c.keys.join(''), c]),
  );
  emitChange(state);
}

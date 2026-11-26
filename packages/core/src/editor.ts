import { normalizeSettings, sanitizeLatexTemplate } from './commandSpecs';
import {
  addGridCol,
  addGridRow,
  getSelectedLatex,
  removeGridCol,
  removeGridRow,
  toggleGridColBar,
} from './engine/gridOps';
import {
  confirmJumpSelection,
  drillJumpSelection,
  enterJumpMode,
  handleJumpKey,
  jumpBack,
  jumpForward,
  moveJumpSelection,
  stepJumpBack,
} from './engine/jumpMode';
import {
  acceptSubmenuDefault,
  exitMode,
  handleLeaderKey,
  stepLeaderBack,
  triggerLeader,
} from './engine/leaderMode';
import {
  escapeLevel,
  moveDown,
  moveEnd,
  moveHome,
  moveLeft,
  moveRight,
  moveUp,
  nextSlot,
  prevSlot,
  selectAll,
  selectBetweenPoints,
  selectWordOrAtomAt,
  setCursor,
  setSelection,
} from './engine/navigation';
import {
  type EngineState,
  buildSnapshot,
  cancelLeader,
  clearState,
  commitLeaderDefault,
  createEngineState,
  emitChange,
  exportDraftV1State,
  getInputContext,
  loadFormulaState,
  loadFormulaWithRawFallbackState,
  redoState,
  restoreDraftV1State,
  setEffectiveCommandsState,
  undoState,
} from './engine/state';
import { insertText } from './engine/inputFlow';
import {
  backspace,
  deleteForward,
  insertCommand,
  insertSnippetAtCursor,
  pasteLiteralText,
  pasteText,
} from './engine/structuralEdit';
import type {
  AppSettings,
  CommandDef,
  CustomCommandDef,
  EditorSnapshot,
  ImportResult,
  InputContextKind,
  MathWrapperKind,
  PersistedDraftV1,
  Snippet,
  TreePoint,
} from './types';

export class MathSlotEngine {
  private readonly state: EngineState;

  constructor(initialSettings: Partial<AppSettings> = {}) {
    this.state = createEngineState(initialSettings);
  }

  public subscribe(listener: () => void): () => void {
    this.state.listeners.add(listener);
    return () => {
      this.state.listeners.delete(listener);
    };
  }

  public setEffectiveCommands(commands: readonly CommandDef[]): void {
    setEffectiveCommandsState(this.state, commands);
  }

  public setCustomCommands(commands: CustomCommandDef[]): void {
    this.state.customCommands = commands.map((c) => ({
      ...c,
      latex: sanitizeLatexTemplate(c.latex),
    }));
    emitChange(this.state);
  }

  public getCustomCommands(): CustomCommandDef[] {
    return [...this.state.customCommands];
  }

  public setSnippets(snippets: Snippet[]): void {
    this.state.snippets = snippets.map((s) => ({
      ...s,
      latex: sanitizeLatexTemplate(s.latex),
    }));
    emitChange(this.state);
  }

  public getSnippets(): Snippet[] {
    return [...this.state.snippets];
  }

  public getSettings(): AppSettings {
    return { ...this.state.settings };
  }

  public updateSettings(patch: Partial<AppSettings>): void {
    this.state.settings = normalizeSettings({ ...this.state.settings, ...patch });
    this.state.docRevision += 1;
    emitChange(this.state);
  }

  public setFocused(focused: boolean): void {
    this.state.focused = focused;
    emitChange(this.state);
  }

  public getInputContext(): InputContextKind {
    return getInputContext(this.state);
  }

  public getSnapshot(): EditorSnapshot {
    return buildSnapshot(this.state);
  }

  public undo(): boolean {
    return undoState(this.state);
  }

  public redo(): boolean {
    return redoState(this.state);
  }

  public clear(): void {
    clearState(this.state);
  }

  public loadFormula(input: string): ImportResult {
    return loadFormulaState(this.state, input);
  }

  public loadFormulaWithRawFallback(input: string): ImportResult {
    return loadFormulaWithRawFallbackState(this.state, input);
  }

  public pasteLiteralText(text: string): void {
    pasteLiteralText(this.state, text);
  }

  public exportDraftV1(wrapper?: MathWrapperKind): PersistedDraftV1 {
    return exportDraftV1State(this.state, wrapper);
  }

  public restoreDraftV1(raw: unknown): boolean {
    return restoreDraftV1State(this.state, raw);
  }

  public getRestoredDraftWrapper(): MathWrapperKind | null {
    return this.state.lastRestoredDraftWrapper;
  }

  public selectBetweenPoints(anchor: TreePoint, focus: TreePoint): void {
    selectBetweenPoints(this.state, anchor, focus);
  }

  public pasteText(text: string): void {
    pasteText(this.state, text);
  }

  public getSelectedLatex(): string {
    return getSelectedLatex(this.state);
  }

  public jumpBack(): boolean {
    return jumpBack(this.state);
  }

  public jumpForward(): boolean {
    return jumpForward(this.state);
  }

  public setSelection(slotId: string, anchorOffset: number, focusOffset: number): void {
    setSelection(this.state, slotId, anchorOffset, focusOffset);
  }

  public selectWordOrAtomAt(slotId: string, offset: number): void {
    selectWordOrAtomAt(this.state, slotId, offset);
  }

  public setCursor(slotId: string, offset: number): void {
    setCursor(this.state, slotId, offset);
  }

  public commitLeaderDefault(): void {
    commitLeaderDefault(this.state);
  }

  public cancelLeader(): void {
    cancelLeader(this.state);
  }

  public triggerLeader(): void {
    triggerLeader(this.state);
  }

  public exitMode(): void {
    exitMode(this.state);
  }

  public enterJumpMode(): void {
    enterJumpMode(this.state);
  }

  public stepJumpBack(): void {
    stepJumpBack(this.state);
  }

  public moveJumpSelection(delta: -1 | 1): void {
    moveJumpSelection(this.state, delta);
  }

  public drillJumpSelection(): boolean {
    return drillJumpSelection(this.state);
  }

  public confirmJumpSelection(): boolean {
    return confirmJumpSelection(this.state);
  }

  public handleJumpKey(key: string): boolean {
    return handleJumpKey(this.state, key);
  }

  public insertSnippetAtCursor(snippet: Pick<Snippet, 'latex'>): boolean {
    return insertSnippetAtCursor(this.state, snippet);
  }

  public acceptSubmenuDefault(): boolean {
    return acceptSubmenuDefault(this.state);
  }

  public handleLeaderKey(key: string): { handled: boolean; executedCommandId?: string } {
    return handleLeaderKey(this.state, key);
  }

  public stepLeaderBack(): void {
    stepLeaderBack(this.state);
  }

  public insertText(text: string): void {
    insertText(this.state, text);
  }

  public insertCommand(commandId: string): boolean {
    return insertCommand(this.state, commandId);
  }

  public nextSlot(): void {
    nextSlot(this.state);
  }

  public prevSlot(): void {
    prevSlot(this.state);
  }

  public backspace(): void {
    backspace(this.state);
  }

  public deleteForward(): void {
    deleteForward(this.state);
  }

  public moveLeft(extendSelection = false): void {
    moveLeft(this.state, extendSelection);
  }

  public moveRight(extendSelection = false): void {
    moveRight(this.state, extendSelection);
  }

  public escapeLevel(): boolean {
    return escapeLevel(this.state);
  }

  public addGridRow(where: 'below' | 'above' = 'below'): boolean {
    return addGridRow(this.state, where);
  }

  public removeGridRow(): boolean {
    return removeGridRow(this.state);
  }

  public addGridCol(where: 'right' | 'left' = 'right'): boolean {
    return addGridCol(this.state, where);
  }

  public removeGridCol(): boolean {
    return removeGridCol(this.state);
  }

  public toggleGridColBar(): boolean {
    return toggleGridColBar(this.state);
  }

  public moveUp(): void {
    moveUp(this.state);
  }

  public moveDown(): void {
    moveDown(this.state);
  }

  public moveHome(extendSelection = false): void {
    moveHome(this.state, extendSelection);
  }

  public moveEnd(extendSelection = false): void {
    moveEnd(this.state, extendSelection);
  }

  public selectAll(): void {
    selectAll(this.state);
  }
}

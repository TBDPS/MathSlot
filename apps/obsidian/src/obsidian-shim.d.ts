declare module 'obsidian' {
  export interface EditorPosition {
    line: number;
    ch: number;
  }

  export class App {
    workspace: {
      activeEditor?: {
        editor?: Editor;
      };
      updateOptions(): void;
    };
  }

  export interface Editor {
    getSelection(): string;
    replaceSelection(replacement: string): void;
    getCursor(string?: 'from' | 'to' | 'head' | 'anchor'): EditorPosition;
    getLine(line: number): string;
    getRange(from: EditorPosition, to: EditorPosition): string;
    lineCount(): number;
    replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition): void;
  }

  export class Modal {
    app: App;
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    constructor(app: App);
    open(): void;
    close(): void;
    onOpen(): void;
    onClose(): void;
  }

  export class Notice {
    constructor(message: string, timeout?: number);
  }

  export abstract class PluginSettingTab {
    app: App;
    containerEl: HTMLElement;
    constructor(app: App, plugin: Plugin);
    abstract display(): void;
    hide(): void;
  }

  export interface ToggleComponent {
    setValue(value: boolean): this;
    onChange(callback: (value: boolean) => unknown): this;
  }

  export interface DropdownComponent {
    addOption(value: string, display: string): this;
    setValue(value: string): this;
    onChange(callback: (value: string) => unknown): this;
  }

  export interface ButtonComponent {
    setButtonText(name: string): this;
    setCta(): this;
    onClick(callback: () => unknown): this;
  }

  export class Setting {
    settingEl: HTMLElement;
    constructor(containerEl: HTMLElement);
    setName(name: string): this;
    setDesc(desc: string): this;
    setHeading(): this;
    addToggle(cb: (component: ToggleComponent) => unknown): this;
    addDropdown(cb: (component: DropdownComponent) => unknown): this;
    addButton(cb: (component: ButtonComponent) => unknown): this;
  }

  export class Plugin {
    app: App;
    onload(): void | Promise<void>;
    onunload(): void;
    addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement;
    addCommand(command: {
      id: string;
      name: string;
      editorCallback?: (editor: Editor) => void;
      callback?: () => void;
    }): void;
    registerEditorExtension(extension: unknown): void;
    addSettingTab(settingTab: PluginSettingTab): void;
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
  }
}

declare module '@codemirror/state' {
  export type Extension = { readonly __cmExt?: unknown } | readonly Extension[];

  export class StateEffect<Value> {
    readonly value: Value;
    is<T>(type: StateEffectType<T>): this is StateEffect<T>;
    static define<Value = null>(): StateEffectType<Value>;
  }

  export class StateEffectType<Value> {
    of(value: Value): StateEffect<Value>;
  }

  export interface Line {
    readonly from: number;
    readonly to: number;
    readonly number: number;
    readonly text: string;
  }

  export interface Text {
    readonly length: number;
    sliceString(from: number, to?: number, lineSep?: string): string;
    lineAt(pos: number): Line;
    toString(): string;
  }

  export interface SelectionRange {
    readonly from: number;
    readonly to: number;
    readonly head: number;
    readonly anchor: number;
    readonly empty: boolean;
  }

  export class EditorSelection {
    readonly main: SelectionRange;
    static cursor(pos: number): EditorSelection;
  }

  export interface ChangeSet {
    iterChanges(
      f: (fromA: number, toA: number, fromB: number, toB: number, inserted: Text) => void,
      combine?: boolean,
    ): void;
  }

  export class EditorState {
    readonly doc: Text;
    readonly selection: EditorSelection;
    field<T>(field: StateField<T>): T;
  }

  export interface Transaction {
    readonly state: EditorState;
    readonly docChanged: boolean;
    readonly selection?: EditorSelection;
    readonly changes: ChangeSet;
    readonly effects: readonly StateEffect<unknown>[];
  }

  export interface TransactionSpec {
    changes?: { from: number; to?: number; insert?: string };
    selection?: EditorSelection | { anchor: number; head?: number };
    effects?: StateEffect<unknown> | readonly StateEffect<unknown>[];
    userEvent?: string;
    scrollIntoView?: boolean;
  }

  export class StateField<Value> {
    static define<Value>(config: {
      create: (state: EditorState) => Value;
      update: (value: Value, transaction: Transaction) => Value;
      provide?: (field: StateField<Value>) => Extension;
    }): StateField<Value>;
  }

  export const Prec: {
    highest(ext: Extension): Extension;
    high(ext: Extension): Extension;
  };

  export class Range<Value> {
    readonly from: number;
    readonly to: number;
    readonly value: Value;
  }
}

declare module '@codemirror/view' {
  import type { EditorState, Extension, Range, StateField, TransactionSpec } from '@codemirror/state';

  export abstract class WidgetType {
    abstract toDOM(view: EditorView): HTMLElement;
    eq?(other: WidgetType): boolean;
    ignoreEvent?(event: Event): boolean;
  }

  export type DecorationSet = unknown;

  export class Decoration {
    range(from: number, to?: number): Range<Decoration>;
    static mark(spec: { class?: string; attributes?: Record<string, string> }): Decoration;
    static widget(spec: { widget: WidgetType; side?: number }): Decoration;
    static set(of: Range<Decoration> | readonly Range<Decoration>[], sort?: boolean): DecorationSet;
    static readonly none: DecorationSet;
  }

  export interface TooltipView {
    dom: HTMLElement;
  }

  export interface Tooltip {
    pos: number;
    end?: number;
    above?: boolean;
    strictSide?: boolean;
    arrow?: boolean;
    create(view: EditorView): TooltipView;
  }

  export const showTooltip: {
    compute(
      deps: readonly StateField<unknown>[],
      create: (state: EditorState) => Tooltip | null,
    ): Extension;
  };

  export class EditorView {
    readonly state: EditorState;
    readonly dom: HTMLElement;
    dispatch(...specs: readonly TransactionSpec[]): void;
    focus(): void;
    static decorations: {
      compute(
        deps: readonly StateField<unknown>[],
        create: (state: EditorState) => DecorationSet,
      ): Extension;
    };
    static domEventHandlers(
      handlers: Partial<{
        keydown: (event: KeyboardEvent, view: EditorView) => boolean | void;
      }>,
    ): Extension;
  }
}

interface HTMLElement {
  addClass(cls: string): void;
  empty(): void;
}

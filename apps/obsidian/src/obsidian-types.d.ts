declare module 'obsidian' {
  export interface App {
    workspace: {
      activeEditor?: { editor?: Editor } | null;
      getActiveViewOfType<T>(type: new (...args: never[]) => T): T | null;
    };
  }

  export interface EditorPosition {
    line: number;
    ch: number;
  }

  export interface Editor {
    getSelection(): string;
    replaceSelection(replacement: string): void;
    getCursor(): EditorPosition;
  }

  export class MarkdownView {
    editor: Editor;
  }

  export interface PluginManifest {
    id: string;
    name: string;
    version: string;
  }

  export interface MarkdownPostProcessorContext {
    addChild(child: unknown): void;
  }

  export class Plugin {
    app: App;
    manifest: PluginManifest;
    constructor(app: App, manifest: PluginManifest);
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
    addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => void): HTMLElement;
    addCommand(command: {
      id: string;
      name: string;
      callback?: () => void;
      editorCallback?: (editor: Editor, view: MarkdownView) => void;
    }): void;
    registerMarkdownCodeBlockProcessor(
      language: string,
      handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void | Promise<void>,
    ): void;
    addSettingTab(settingTab: PluginSettingTab): void;
    onload(): Promise<void> | void;
    onunload(): void;
  }

  export class Modal {
    app: App;
    contentEl: HTMLElement;
    modalEl: HTMLElement;
    titleEl: HTMLElement;
    constructor(app: App);
    open(): void;
    close(): void;
    onOpen(): void | Promise<void>;
    onClose(): void;
  }

  export class PluginSettingTab {
    app: App;
    plugin: Plugin;
    containerEl: HTMLElement;
    constructor(app: App, plugin: Plugin);
    display(): void;
    hide(): void;
  }

  export class Setting {
    constructor(containerEl: HTMLElement);
    setName(name: string): this;
    setDesc(desc: string): this;
    addButton(cb: (button: { setButtonText(text: string): unknown; onClick(cb: () => void): unknown }) => void): this;
  }

  export class Notice {
    constructor(message: string, duration?: number);
  }

  export const Platform: {
    isMobile: boolean;
    isDesktop: boolean;
    isIosApp: boolean;
    isAndroidApp: boolean;
  };

  export function addIcon(iconId: string, svgContent: string): void;
  export function renderMath(source: string, display: boolean): HTMLElement;
  export function finishRenderMath(): Promise<void>;
}

declare module './wasm-pkg/mathslot_wasm.js' {
  export class Engine {
    constructor();
    static engineVersion(): string;
    dispatch(event_json: string): string;
    snapshot(): string;
    catalogJson(): string;
    presetsJson(): string;
    wrapLatex(latex: string, style: string): string;
    free(): void;
  }

  export default function initWasm(module_or_path?: { module_or_path: BufferSource }): Promise<unknown>;
}

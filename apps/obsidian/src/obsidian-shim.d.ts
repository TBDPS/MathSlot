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
    };
  }

  export interface Editor {
    getSelection(): string;
    replaceSelection(replacement: string): void;
    getCursor(): EditorPosition;
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
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
  }
}

interface HTMLElement {
  addClass(cls: string): void;
  empty(): void;
}

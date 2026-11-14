export const notices: string[] = [];

export class Notice {
  message: string;
  constructor(message: string) {
    this.message = message;
    notices.push(message);
  }
}

export const Platform = {
  isMobile: false,
  isDesktop: true,
};

export class Modal {
  app: App;
  contentEl: HTMLElement;
  modalEl: HTMLElement;

  constructor(app: App) {
    this.app = app;
    this.modalEl = document.createElement('div');
    this.contentEl = document.createElement('div');
    this.modalEl.appendChild(this.contentEl);
  }

  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class Plugin {
  app: App;
  constructor(app?: App) {
    this.app = app ?? new App();
  }
  async loadData(): Promise<unknown> {
    return {};
  }
  async saveData(_data: unknown): Promise<void> {}
  addRibbonIcon(_icon: string, _title: string, _cb: () => void): HTMLElement {
    return document.createElement('button');
  }
  addCommand(_cmd: unknown): void {}
  registerMarkdownCodeBlockProcessor(
    _lang: string,
    _handler: (source: string, el: HTMLElement, ctx: unknown) => void | Promise<void>,
  ): void {}
}

export class MarkdownView {
  editor = {
    replaceSelection: (_text: string) => {},
    getSelection: () => '',
  };
}

export class App {
  workspace = {
    getActiveViewOfType: () => null as MarkdownView | null,
  };
}

export async function renderMath(_tex: string, _display: boolean): Promise<HTMLElement> {
  const span = document.createElement('span');
  span.className = 'math mjx-container';
  span.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>';
  return span;
}

export async function finishRenderMath(): Promise<void> {}

export function setIcon(_el: HTMLElement, _icon: string): void {}

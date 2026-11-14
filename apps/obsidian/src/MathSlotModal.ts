import { Modal, Platform, finishRenderMath, renderMath, type App } from 'obsidian';
import { mount, unmount } from 'svelte';
import type { AppSettings, DelimiterStyle, ThemePreference } from '@mathslot/ui';
import AppShell from './AppShell.svelte';
import type { WasmEngineClient } from './wasmClient';

export interface MathSlotModalOptions {
  client: WasmEngineClient;
  delimiterStyle?: DelimiterStyle;
  initialLatex?: string;
  initialImportOpen?: boolean;
  onInsert: (formattedLatex: string, rawLatex: string) => void;
  onRestoreBackup?: (backupPath: string | null) => Promise<void>;
  onResetEmptyConfig?: () => Promise<void>;
  onPersistSettings?: (settings: AppSettings) => Promise<void>;
}

export class MathSlotModal extends Modal {
  private readonly options: MathSlotModalOptions;
  private mountedComponent: ReturnType<typeof mount> | null = null;

  constructor(app: App, options: MathSlotModalOptions) {
    super(app);
    this.options = options;
  }

  private detectTheme(): ThemePreference {
    if (typeof document !== 'undefined' && document.body.classList.contains('theme-dark')) {
      return 'dark';
    }
    return 'light';
  }

  override async onOpen(): Promise<void> {
    this.modalEl.classList.add('ms-obsidian-modal');
    this.contentEl.replaceChildren();

    let openImport = this.options.initialImportOpen ?? false;
    if (this.options.initialLatex && this.options.initialLatex.trim().length > 0) {
      const res = await this.options.client.dispatch({
        ImportLatex: this.options.initialLatex.trim(),
      });
      if (res.snapshot.last_import?.blocked) {
        openImport = true;
      }
    }

    this.mountedComponent = mount(AppShell, {
      target: this.contentEl,
      props: {
        client: this.options.client,
        theme: this.detectTheme(),
        isMobile: Platform.isMobile,
        delimiterStyle: this.options.delimiterStyle,
        initialImportOpen: openImport,
        onInsert: (formatted: string, raw: string) => {
          this.options.onInsert(formatted, raw);
        },
        onRestoreBackup: this.options.onRestoreBackup,
        onResetEmptyConfig: this.options.onResetEmptyConfig,
        onPersistSettings: this.options.onPersistSettings,
        onClose: () => {
          this.close();
        },
        hostRenderMath: (tex: string, display: boolean) => renderMath(tex, display),
        hostFinishRenderMath: () => finishRenderMath(),
      },
    });
  }

  override onClose(): void {
    if (this.mountedComponent) {
      unmount(this.mountedComponent);
      this.mountedComponent = null;
    }
    this.contentEl.replaceChildren();
  }
}

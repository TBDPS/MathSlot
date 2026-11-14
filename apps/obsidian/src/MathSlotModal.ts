import { Modal, Platform, finishRenderMath, renderMath, type App } from 'obsidian';
import { mount, unmount } from 'svelte';
import type { AppSettings, DelimiterStyle, ThemePreference, UserFormulaEntry } from '@mathslot/ui';
import AppShell from './AppShell.svelte';
import type { WasmEngineClient } from './wasmClient';

export interface MathSlotModalOptions {
  client: WasmEngineClient;
  delimiterStyle?: DelimiterStyle;
  initialLatex?: string;
  initialSettingsOpen?: boolean;
  initialImportOpen?: boolean;
  initialUserFormulas?: UserFormulaEntry[];
  onInsert: (formattedLatex: string, rawLatex: string) => void;
  onRestoreBackup?: (backupPath: string | null) => Promise<UserFormulaEntry[] | void>;
  onResetEmptyConfig?: () => Promise<UserFormulaEntry[] | void>;
  onPersistSettings?: (settings: AppSettings) => Promise<void>;
  onSaveSnippet?: (source: string, latex: string) => Promise<UserFormulaEntry[]>;
  onImportConfigData?: (
    rawJson: string,
  ) => Promise<{ settings?: AppSettings; userFormulas?: UserFormulaEntry[] }>;
  onExportConfigData?: (settings: AppSettings) => Promise<string>;
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
    const trimmedInitial = this.options.initialLatex?.trim() ?? '';
    if (trimmedInitial.length > 0) {
      if (openImport) {
        await this.options.client.dispatch({
          PreviewImportLatex: trimmedInitial,
        });
      } else {
        const res = await this.options.client.dispatch({
          ImportLatex: trimmedInitial,
        });
        if (res.snapshot.last_import?.blocked) {
          openImport = true;
        }
      }
    }

    this.mountedComponent = mount(AppShell, {
      target: this.contentEl,
      props: {
        client: this.options.client,
        theme: this.detectTheme(),
        isMobile: Platform.isMobile,
        delimiterStyle: this.options.delimiterStyle,
        initialSettingsOpen: this.options.initialSettingsOpen,
        initialImportOpen: openImport,
        initialImportLatex: trimmedInitial,
        initialUserFormulas: this.options.initialUserFormulas ?? [],
        onInsert: (formatted: string, raw: string) => {
          this.options.onInsert(formatted, raw);
        },
        onRestoreBackup: this.options.onRestoreBackup,
        onResetEmptyConfig: this.options.onResetEmptyConfig,
        onPersistSettings: this.options.onPersistSettings,
        onSaveSnippet: this.options.onSaveSnippet,
        onImportConfigData: this.options.onImportConfigData,
        onExportConfigData: this.options.onExportConfigData,
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

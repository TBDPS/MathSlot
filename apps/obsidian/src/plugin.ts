import '@mathslot/ui/tokens.css';
import './styles.css';
import {
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  addIcon,
  finishRenderMath,
  renderMath,
  type App,
  type Editor,
} from 'obsidian';
import {
  createMathJaxSvgAdapter,
  type AppSettings,
  type DelimiterStyle,
} from '@mathslot/ui';
import { MathSlotModal } from './MathSlotModal';
import {
  loadAndValidateLibrary,
  resetEmptyLibrary,
  restoreFromBackup,
  type PluginPersistedData,
} from './storage';
import { WasmEngineClient } from './wasmClient';

const MATHSLOT_RIBBON_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 4H6l6 8-6 8h12"/></svg>`;

class MathSlotSettingTab extends PluginSettingTab {
  private readonly pluginInstance: MathSlotPlugin;

  constructor(app: App, plugin: MathSlotPlugin) {
    super(app, plugin);
    this.pluginInstance = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.replaceChildren();

    new Setting(containerEl)
      .setName('打开 MathSlot 编辑器')
      .setDesc('可在模态框的“设置”面板中配置定界符、主题与备份恢复。')
      .addButton((button) => {
        button.setButtonText('打开编辑器');
        button.onClick(() => {
          this.pluginInstance.openEditorModal('inline_dollar');
        });
      });
  }
}

export default class MathSlotPlugin extends Plugin {
  private client: WasmEngineClient | null = null;
  private persisted: PluginPersistedData = {};
  private lastRecoveryBanner = '';

  private async savePersisted(next: PluginPersistedData): Promise<void> {
    this.persisted = next;
    await this.saveData(next);
  }

  private async ensureClient(): Promise<WasmEngineClient> {
    if (this.client) {
      return this.client;
    }

    const client = await WasmEngineClient.create();
    this.client = client;

    if (this.persisted.settings) {
      await client.dispatch({ UpdateSettings: this.persisted.settings });
    }

    const validation = await loadAndValidateLibrary(this.persisted, (next) =>
      this.savePersisted(next),
    );
    if (!validation.ok && validation.recovery) {
      await client.dispatch({ SetRecoveryState: validation.recovery });
      if (this.lastRecoveryBanner !== validation.recovery.corrupt_path) {
        this.lastRecoveryBanner = validation.recovery.corrupt_path;
        new Notice(
          `MathSlot 检测到配置损坏，已隔离备份至 ${validation.recovery.corrupt_path}。请在设置中恢复。`,
          8000,
        );
      }
    }

    return client;
  }

  private getActiveEditor(): Editor | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView?.editor) {
      return activeView.editor;
    }
    return this.app.workspace.activeEditor?.editor ?? null;
  }

  async openEditorModal(
    delimiterStyle?: DelimiterStyle,
    options: { initialImportOpen?: boolean; editor?: Editor | null } = {},
  ): Promise<void> {
    try {
      const client = await this.ensureClient();
      const targetEditor = options.editor ?? this.getActiveEditor();
      const selection = targetEditor?.getSelection()?.trim() ?? '';

      const modal = new MathSlotModal(this.app, {
        client,
        delimiterStyle,
        initialLatex: selection.length > 0 ? selection : undefined,
        initialImportOpen: options.initialImportOpen,
        onInsert: (formattedLatex) => {
          const active = targetEditor ?? this.getActiveEditor();
          if (active) {
            active.replaceSelection(formattedLatex);
          } else {
            new Notice('未找到可插入的 Markdown 编辑器。');
          }
        },
        onRestoreBackup: async () => {
          await restoreFromBackup(this.persisted, (next) => this.savePersisted(next));
          await client.dispatch({ SetRecoveryState: null });
          new Notice('MathSlot 已从备份恢复配置。');
        },
        onResetEmptyConfig: async () => {
          await resetEmptyLibrary(this.persisted, (next) => this.savePersisted(next));
          await client.dispatch({ SetRecoveryState: null });
          new Notice('MathSlot 已重置为空配置（损坏备份保留在隔离区）。');
        },
        onPersistSettings: async (settings: AppSettings) => {
          this.persisted.settings = settings;
          await this.savePersisted(this.persisted);
        },
      });
      modal.open();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`MathSlot 启动失败: ${msg}`, 8000);
    }
  }

  override async onload(): Promise<void> {
    const loaded = (await this.loadData()) as PluginPersistedData | null;
    this.persisted = loaded && typeof loaded === 'object' ? loaded : {};

    addIcon('mathslot-sigma', MATHSLOT_RIBBON_ICON);
    this.addRibbonIcon('mathslot-sigma', '打开 MathSlot 公式编辑器', () => {
      void this.openEditorModal('inline_dollar');
    });

    this.addCommand({
      id: 'open-mathslot-inline',
      name: 'Open MathSlot (Inline)',
      editorCallback: (editor) => {
        void this.openEditorModal('inline_dollar', { editor });
      },
    });

    this.addCommand({
      id: 'open-mathslot-display',
      name: 'Open MathSlot (Display)',
      editorCallback: (editor) => {
        void this.openEditorModal('block_dollar', { editor });
      },
    });

    this.addCommand({
      id: 'open-mathslot-import',
      name: 'Open MathSlot (Import LaTeX)',
      callback: () => {
        void this.openEditorModal(undefined, { initialImportOpen: true });
      },
    });

    this.registerMarkdownCodeBlockProcessor('mathslot', async (source, el) => {
      el.replaceChildren();
      const wrapper = document.createElement('div');
      wrapper.className = 'ms-obsidian-codeblock';
      el.appendChild(wrapper);
      const trimmed = source.trim();
      try {
        const rendered = renderMath(trimmed, true);
        await finishRenderMath();
        wrapper.appendChild(rendered);
      } catch (err) {
        const badge = document.createElement('div');
        badge.className = 'ms-obsidian-degraded-badge';
        badge.setAttribute('data-mathslot-degraded', 'true');
        badge.textContent = `降级预览 (${err instanceof Error ? err.message : '宿主 renderMath 不可用'})`;
        wrapper.appendChild(badge);

        const fallback = createMathJaxSvgAdapter();
        const fbOut = await fallback.render({
          generation: 1,
          latex: trimmed,
          previewLatex: trimmed,
          theme: 'light',
          display: true,
        });
        const svgHost = document.createElement('div');
        svgHost.innerHTML = fbOut.svg;
        wrapper.appendChild(svgHost);
      }
    });

    this.addSettingTab(new MathSlotSettingTab(this.app, this));
  }

  override onunload(): void {
    this.client?.dispose();
    this.client = null;
  }
}

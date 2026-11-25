import type { ExternalUserLibraries, HostAdapter, PersistedStore } from '@mathslot/ui';

const STORE_KEY = 'mathslot.web.v3.store';
const PRESETS_KEY = 'mathslot.web.v3.presets.json';
const COMMANDS_KEY = 'mathslot.web.v3.commands.json';

export function createWebHost(): HostAdapter {
  return {
    primaryActionLabel: '复制',

    async copyText(text: string): Promise<void> {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('Clipboard copy failed');
    },

    async readText(): Promise<string> {
      if (navigator.clipboard?.readText) {
        try {
          return await navigator.clipboard.readText();
        } catch {
          return '';
        }
      }
      return '';
    },

    async copyImagePng(_rgba: Uint8Array, _width: number, _height: number, blob: Blob): Promise<void> {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return;
      }
      throw new Error('Browser clipboard image write unsupported');
    },

    async saveExportFile(filename: string, bytes: Uint8Array): Promise<string> {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return filename;
    },

    async loadUserLibraries(): Promise<ExternalUserLibraries> {
      const rawPresets = localStorage.getItem(PRESETS_KEY);
      const rawCommands = localStorage.getItem(COMMANDS_KEY);
      return {
        configDir: '浏览器本地存储 (PWA)',
        presetsJson: rawPresets ?? '',
        commandsJson: rawCommands ?? '',
        presetsNewlyCreated: rawPresets === null,
        commandsNewlyCreated: rawCommands === null,
      };
    },

    async saveUserLibraries(presetsJson: string, commandsJson: string): Promise<void> {
      localStorage.setItem(PRESETS_KEY, presetsJson);
      localStorage.setItem(COMMANDS_KEY, commandsJson);
    },

    async loadStore(): Promise<PersistedStore> {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistedStore>;
          return {
            settings: parsed.settings ?? {},
            snippets: Array.isArray(parsed.snippets) ? parsed.snippets : [],
            customCommands: Array.isArray(parsed.customCommands) ? parsed.customCommands : [],
            history: Array.isArray(parsed.history) ? parsed.history : [],
            userPresets: Array.isArray(parsed.userPresets) ? parsed.userPresets : [],
            userCommands: Array.isArray(parsed.userCommands) ? parsed.userCommands : [],
            favoriteIds: Array.isArray(parsed.favoriteIds) ? parsed.favoriteIds : [],
            recentIds: Array.isArray(parsed.recentIds) ? parsed.recentIds : [],
            lastDraftLatex: typeof parsed.lastDraftLatex === 'string' ? parsed.lastDraftLatex : '',
            lastDraftV1: parsed.lastDraftV1 ?? null,
          };
        }
      } catch {
        // Ignore corrupt localStorage
      }
      return {
        settings: {},
        snippets: [],
        customCommands: [],
        history: [],
        userPresets: [],
        userCommands: [],
      };
    },

    async saveStore(store: PersistedStore): Promise<void> {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    },
  };
}

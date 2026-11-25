import type { ExternalUserLibraries, HostAdapter, PersistedStore } from '@mathslot/ui';

const LOCAL_STORAGE_KEY = 'mathslot.v2.store';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown> | Uint8Array | ArrayBuffer,
  options?: { headers?: Record<string, string> },
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args as never, options as never);
}

export function createDesktopHost(): HostAdapter {
  return {
    primaryActionLabel: '复制',
    async copyText(text: string): Promise<void> {
      if (isTauriRuntime()) {
        try {
          await tauriInvoke('copy_to_clipboard', { text });
          return;
        } catch {
          // Fallback to navigator.clipboard
        }
      }
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
      if (!ok) {
        throw new Error('Clipboard copy failed');
      }
    },

    async copyImagePng(rgba: Uint8Array, width: number, height: number, blob: Blob): Promise<void> {
      if (isTauriRuntime()) {
        try {
          await tauriInvoke('copy_image_to_clipboard', rgba, {
            headers: {
              'x-width': String(width),
              'x-height': String(height),
            },
          });
          return;
        } catch {
          // Fallback to browser clipboard
        }
      }
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return;
      }
      throw new Error('Clipboard image write unsupported');
    },

    async saveExportFile(filename: string, bytes: Uint8Array): Promise<string> {
      if (isTauriRuntime()) {
        return tauriInvoke<string>('save_export_file', bytes, {
          headers: {
            'x-filename': encodeURIComponent(filename),
          },
        });
      }
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

    async openDownloadsDir(): Promise<void> {
      if (isTauriRuntime()) {
        await tauriInvoke('open_downloads_dir');
      }
    },

    async setAlwaysOnTop(pinned: boolean): Promise<void> {
      if (isTauriRuntime()) {
        await tauriInvoke('set_always_on_top', { pinned });
      }
    },

    async hideWindow(): Promise<void> {
      if (isTauriRuntime()) {
        await tauriInvoke('hide_window');
      }
    },

    async loadUserLibraries(): Promise<ExternalUserLibraries> {
      if (isTauriRuntime()) {
        return tauriInvoke<ExternalUserLibraries>('load_user_libraries');
      }
      const rawPresets = localStorage.getItem('mathslot.v2.presets.json');
      const rawCommands = localStorage.getItem('mathslot.v2.commands.json');
      return {
        configDir: 'localStorage',
        presetsJson: rawPresets ?? '',
        commandsJson: rawCommands ?? '',
        presetsNewlyCreated: rawPresets === null,
        commandsNewlyCreated: rawCommands === null,
      };
    },

    async saveUserLibraries(presetsJson: string, commandsJson: string): Promise<void> {
      if (isTauriRuntime()) {
        await tauriInvoke('save_user_libraries', { presetsJson, commandsJson });
        return;
      }
      localStorage.setItem('mathslot.v2.presets.json', presetsJson);
      localStorage.setItem('mathslot.v2.commands.json', commandsJson);
    },

    async openConfigDir(): Promise<void> {
      if (isTauriRuntime()) {
        await tauriInvoke('open_config_dir');
      }
    },

    async readText(): Promise<string> {
      if (isTauriRuntime()) {
        try {
          return await tauriInvoke<string>('read_from_clipboard');
        } catch {
          // Fallback to navigator.clipboard
        }
      }
      if (navigator.clipboard?.readText) {
        return navigator.clipboard.readText();
      }
      return '';
    },

    async loadStore(): Promise<PersistedStore> {
      if (isTauriRuntime()) {
        try {
          const raw = await tauriInvoke<string>('load_store');
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
          // Ignore and fallback
        }
      }
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
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
      const payload = JSON.stringify(store, null, 2);
      if (isTauriRuntime()) {
        try {
          await tauriInvoke('save_store', { payload });
          return;
        } catch {
          // Fallback to localStorage below; if both fail, propagate error to UI!
        }
      }
      localStorage.setItem(LOCAL_STORAGE_KEY, payload);
    },
  };
}

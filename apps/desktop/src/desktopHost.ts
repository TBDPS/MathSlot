import type { HostAdapter, PersistedStore } from '@mathslot/ui';

const LOCAL_STORAGE_KEY = 'mathslot.v2.store';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
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
      document.execCommand('copy');
      ta.remove();
    },

    async copyImagePng(rgba: Uint8Array, width: number, height: number, blob: Blob): Promise<void> {
      if (isTauriRuntime()) {
        try {
          await tauriInvoke('copy_image_to_clipboard', {
            rgba: Array.from(rgba),
            width,
            height,
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

    async setAlwaysOnTop(pinned: boolean): Promise<void> {
      if (isTauriRuntime()) {
        await tauriInvoke('set_always_on_top', { pinned });
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
          };
        }
      } catch {
        // Ignore corrupt localStorage
      }
      return { settings: {}, snippets: [], customCommands: [], history: [] };
    },

    async saveStore(store: PersistedStore): Promise<void> {
      const payload = JSON.stringify(store, null, 2);
      if (isTauriRuntime()) {
        try {
          await tauriInvoke('save_store', { payload });
          return;
        } catch {
          // Fallback
        }
      }
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, payload);
      } catch {
        // Ignore quota errors
      }
    },
  };
}

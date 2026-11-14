import '@mathslot/ui/tokens.css';
import '../src/styles.css';
import { mount } from 'svelte';
import type { AppSettings, UserFormulaEntry } from '@mathslot/ui';
import AppShell from '../src/AppShell.svelte';
import {
  exportPluginConfigJson,
  importPluginConfigJson,
  isLibraryValidForWrites,
  loadAndValidateLibrary,
  readUserFormulas,
  resetEmptyLibrary,
  restoreFromBackup,
  saveUserSnippet,
  type PluginPersistedData,
} from '../src/storage';
import { WasmEngineClient } from '../src/wasmClient';

declare global {
  interface Window {
    __OBSIDIAN_E2E_LOG__?: Array<{ type: string; payload: unknown }>;
  }
}

async function bootstrap(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const isMobile = params.get('mobile') === '1' || window.innerWidth <= 480;
  const failRender = params.get('failRender') === '1';
  const failSave = params.get('failSave') === '1';
  const simulateRecovery = params.get('recovery') === '1';
  const darkHost = params.get('theme') === 'dark';

  if (darkHost) {
    document.body.classList.remove('theme-light');
    document.body.classList.add('theme-dark');
  } else {
    document.body.classList.remove('theme-dark');
    document.body.classList.add('theme-light');
  }

  const log: Array<{ type: string; payload: unknown }> = [];
  window.__OBSIDIAN_E2E_LOG__ = log;

  const client = await WasmEngineClient.create();

  const backupPayload = JSON.stringify({
    schema_version: 3,
    customFormats: [],
    snippets: [
      {
        id: '01933b4a-9999-7000-8000-000000000001',
        name: 'Backed Up Euler',
        category: '自定义',
        source: 'e^{i\\pi}+1=0',
        desc: 'E2E 备份恢复公式',
        tags: ['backup'],
        is_builtin: false,
        created_at: 1700000000,
      },
    ],
  });

  const persisted: PluginPersistedData = simulateRecovery
    ? {
        libraryJson: '{broken e2e json',
        lastValidLibraryJson: backupPayload,
      }
    : {
        libraryJson: JSON.stringify({ schema_version: 3, customFormats: [], snippets: [] }),
        lastValidLibraryJson: JSON.stringify({ schema_version: 3, customFormats: [], snippets: [] }),
      };

  const saveData = async (next: PluginPersistedData): Promise<void> => {
    if (failSave) {
      throw new Error('EACCES: simulated read-only disk failure');
    }
    log.push({ type: 'saveData', payload: next });
  };

  if (simulateRecovery) {
    const validation = await loadAndValidateLibrary(persisted, async (next) => {
      log.push({ type: 'quarantine', payload: next });
    });
    if (!validation.ok && validation.recovery) {
      await client.dispatch({ SetRecoveryState: validation.recovery });
    }
  }

  const initialFormulas: UserFormulaEntry[] = simulateRecovery ? [] : readUserFormulas(persisted);

  const target = document.getElementById('app');
  if (!target) {
    throw new Error('Missing #app mount container');
  }

  mount(AppShell, {
    target,
    props: {
      client,
      isMobile,
      theme: darkHost ? 'dark' : 'light',
      initialSettingsOpen: simulateRecovery,
      initialUserFormulas: initialFormulas,
      onInsert: (formattedLatex: string, rawLatex: string) => {
        log.push({ type: 'insert', payload: { formattedLatex, rawLatex } });
      },
      onCopy: (formattedLatex: string, rawLatex: string) => {
        log.push({ type: 'copy', payload: { formattedLatex, rawLatex } });
      },
      onRestoreBackup: async () => {
        await restoreFromBackup(persisted, saveData);
        await client.dispatch({ SetRecoveryState: null });
        const restored = readUserFormulas(persisted);
        log.push({ type: 'restoreBackup', payload: restored });
        return restored;
      },
      onResetEmptyConfig: async () => {
        await resetEmptyLibrary(persisted, saveData);
        await client.dispatch({ SetRecoveryState: null });
        const reset = readUserFormulas(persisted);
        log.push({ type: 'resetEmptyConfig', payload: reset });
        return reset;
      },
      onPersistSettings: async (settings: AppSettings) => {
        if (!isLibraryValidForWrites(persisted)) {
          throw new Error('存在未解决的配置损坏恢复状态（recovery lock）');
        }
        const next: PluginPersistedData = { ...persisted, settings };
        await saveData(next);
        Object.assign(persisted, next);
        log.push({ type: 'persistSettings', payload: settings });
      },
      onSaveSnippet: async (source: string, latex: string) => {
        const updated = await saveUserSnippet(persisted, saveData, source, latex);
        log.push({ type: 'saveSnippet', payload: updated[updated.length - 1] });
        return updated;
      },
      onImportConfigData: async (rawJson: string) => {
        const imported = await importPluginConfigJson(rawJson, persisted, saveData);
        log.push({ type: 'importConfig', payload: imported });
        return {
          settings: imported.settings,
          userFormulas: imported.userFormulas,
        };
      },
      onExportConfigData: async (settings: AppSettings) => exportPluginConfigJson(persisted, settings),
      onConfigExported: (rawJson: string) => {
        log.push({ type: 'exportConfig', payload: rawJson });
      },
      hostRenderMath: failRender
        ? async () => {
            throw new Error('Simulated Obsidian renderMath failure');
          }
        : undefined,
      hostFinishRenderMath: failRender ? async () => {} : undefined,
    },
  });
}

void bootstrap();

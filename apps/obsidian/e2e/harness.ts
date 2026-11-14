import '@mathslot/ui/tokens.css';
import '../src/styles.css';
import { mount } from 'svelte';
import type { AppSettings, UserFormulaEntry } from '@mathslot/ui';
import AppShell from '../src/AppShell.svelte';
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
  let savedSnippets: UserFormulaEntry[] = [];

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
      onInsert: (formattedLatex: string, rawLatex: string) => {
        log.push({ type: 'insert', payload: { formattedLatex, rawLatex } });
      },
      onCopy: (formattedLatex: string, rawLatex: string) => {
        log.push({ type: 'copy', payload: { formattedLatex, rawLatex } });
      },
      onPersistSettings: async (settings: AppSettings) => {
        log.push({ type: 'persistSettings', payload: settings });
      },
      onSaveSnippet: async (source: string, _latex: string) => {
        const entry: UserFormulaEntry = {
          id: `e2e-snippet-${savedSnippets.length + 1}`,
          name: `片段 ${source.slice(0, 18)}`,
          category: '自定义',
          source,
          desc: '从 E2E 编辑器保存',
          tags: ['snippet'],
          is_builtin: false,
          created_at: Math.floor(Date.now() / 1000),
        };
        savedSnippets = [...savedSnippets, entry];
        log.push({ type: 'saveSnippet', payload: entry });
        return savedSnippets;
      },
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

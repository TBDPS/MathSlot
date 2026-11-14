<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    DiagnosticsPanel,
    ImportModal,
    MathSlotEditor,
    NavTreePanel,
    PalettePanel,
    PreviewPanel,
    SettingsPanel,
    createEmptySnapshot,
    createMathJaxSvgAdapter,
    formatLatexWithDelimiter,
    type AppSettings,
    type DelimiterStyle,
    type EngineSnapshot,
    type ThemePreference,
  } from '@mathslot/ui';
  import { createObsidianHostRenderAdapter } from './hostRenderAdapter';
  import type { WasmEngineClient } from './wasmClient';

  export interface AppShellProps {
    client: WasmEngineClient;
    theme?: ThemePreference;
    isMobile?: boolean;
    initialSettingsOpen?: boolean;
    initialImportOpen?: boolean;
    delimiterStyle?: DelimiterStyle;
    onInsert?: (formattedLatex: string, rawLatex: string) => void;
    onCopy?: (formattedLatex: string, rawLatex: string) => void;
    onRestoreBackup?: (backupPath: string | null) => void | Promise<void>;
    onResetEmptyConfig?: () => void | Promise<void>;
    onPersistSettings?: (settings: AppSettings) => void | Promise<void>;
    onClose?: () => void;
    hostRenderMath?: (
      tex: string,
      display: boolean,
    ) => HTMLElement | string | Promise<HTMLElement | string>;
    hostFinishRenderMath?: () => Promise<void>;
  }

  let {
    client,
    theme = 'system',
    isMobile = false,
    initialSettingsOpen = false,
    initialImportOpen = false,
    delimiterStyle,
    onInsert,
    onCopy,
    onRestoreBackup,
    onResetEmptyConfig,
    onPersistSettings,
    onClose,
    hostRenderMath,
    hostFinishRenderMath,
  }: AppShellProps = $props();

  let snapshot = $state<EngineSnapshot>(createEmptySnapshot());
  let renderGen = $state(1);
  let settingsOpen = $state(false);
  let importOpen = $state(false);
  let navOpen = $state(false);
  let statusNotice = $state('');
  let editorComponent = $state<{ focus: () => void } | null>(null);
  let didApplyInitialToggles = false;

  $effect(() => {
    if (!didApplyInitialToggles) {
      settingsOpen = initialSettingsOpen;
      importOpen = initialImportOpen;
      didApplyInitialToggles = true;
    }
  });

  const resolvedTheme = $derived.by<'light' | 'dark'>(() => {
    if (theme === 'light' || theme === 'dark') {
      return theme;
    }
    const settingsTheme = snapshot.settings?.theme;
    if (settingsTheme === 'light' || settingsTheme === 'dark') {
      return settingsTheme;
    }
    if (typeof document !== 'undefined' && document.body?.classList.contains('theme-dark')) {
      return 'dark';
    }
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
    return 'light';
  });

  const effectiveDelimiter = $derived<DelimiterStyle>(
    delimiterStyle ?? snapshot.settings?.delimiter_style ?? 'none',
  );

  const renderer = $derived.by(() => {
    if (hostRenderMath && hostFinishRenderMath) {
      return createObsidianHostRenderAdapter({
        renderMath: hostRenderMath,
        finishRenderMath: hostFinishRenderMath,
      });
    }
    return createMathJaxSvgAdapter();
  });

  let unsubscribe: (() => void) | null = null;

  onMount(async () => {
    unsubscribe = client.subscribe((res) => {
      snapshot = res.snapshot;
      renderGen += 1;
    });
    try {
      snapshot = await client.snapshot();
    } catch (err) {
      statusNotice = err instanceof Error ? err.message : String(err);
    }
  });

  onDestroy(() => {
    unsubscribe?.();
    if ('dispose' in renderer && typeof renderer.dispose === 'function') {
      renderer.dispose();
    }
  });

  async function formatOutputLatex(rawLatex: string): Promise<string> {
    if (!rawLatex) return '';
    try {
      return await client.wrapLatex(rawLatex, effectiveDelimiter);
    } catch {
      return formatLatexWithDelimiter(rawLatex, effectiveDelimiter);
    }
  }

  async function handleCopy(): Promise<void> {
    const rawLatex = snapshot.copy_text || snapshot.latex;
    const formatted = await formatOutputLatex(rawLatex);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(formatted);
      } catch {
        // Clipboard API may be unavailable in headless tests; host callback still runs.
      }
    }
    await client.dispatch('RequestCopy');
    statusNotice = formatted ? '已复制 LaTeX' : '当前公式为空';
    onCopy?.(formatted, rawLatex);
  }

  async function handleInsert(): Promise<void> {
    const rawLatex = snapshot.copy_text || snapshot.latex;
    const formatted = await formatOutputLatex(rawLatex);
    onInsert?.(formatted, rawLatex);
    onClose?.();
  }

  async function handleToggleNav(): Promise<void> {
    navOpen = !navOpen;
    const res = await client.dispatch(snapshot.is_nav_mode ? 'ExitNavMode' : 'EnterNavMode');
    snapshot = res.snapshot;
  }

  async function handleSaveSettings(next: AppSettings): Promise<void> {
    await onPersistSettings?.(next);
    statusNotice = '设置已保存';
  }

  async function handleResetDefaults(defaults: AppSettings): Promise<void> {
    await onPersistSettings?.(defaults);
    statusNotice = '设置已恢复默认';
  }
</script>

<div
  class="mathslot-obsidian-host"
  class:is-mobile={isMobile}
  data-host="obsidian"
  data-theme={resolvedTheme}
>
  <header class="ms-obsidian-toolbar">
    <div class="ms-obsidian-brand">
      <h2 class="ms-obsidian-title">MathSlot</h2>
      <span class="ms-obsidian-badge">WASM</span>
    </div>

    <div class="ms-obsidian-actions">
      <button
        type="button"
        class="ms-obsidian-btn"
        class:is-active={navOpen || snapshot.is_nav_mode}
        data-testid="obsidian-nav-btn"
        onclick={handleToggleNav}
      >
        导航树
      </button>
      <button
        type="button"
        class="ms-obsidian-btn"
        class:is-active={importOpen}
        data-testid="obsidian-import-btn"
        onclick={() => {
          importOpen = !importOpen;
        }}
      >
        导入 LaTeX
      </button>
      <button
        type="button"
        class="ms-obsidian-btn"
        class:is-active={settingsOpen}
        data-testid="obsidian-settings-btn"
        onclick={() => {
          settingsOpen = !settingsOpen;
        }}
      >
        设置
      </button>
      <button
        type="button"
        class="ms-obsidian-btn"
        data-testid="obsidian-copy-btn"
        onclick={handleCopy}
      >
        复制 LaTeX
      </button>
      <button
        type="button"
        class="ms-obsidian-btn is-primary"
        data-testid="obsidian-insert-btn"
        onclick={handleInsert}
      >
        插入笔记
      </button>
    </div>
  </header>

  {#if statusNotice}
    <div class="ms-obsidian-status" role="status" aria-live="polite">{statusNotice}</div>
  {/if}

  {#if settingsOpen}
    <SettingsPanel
      settings={snapshot.settings}
      recovery={snapshot.recovery ?? null}
      {client}
      theme={resolvedTheme}
      sampleLatex={snapshot.latex || '\\frac{a + b}{c}'}
      onSaveSettings={handleSaveSettings}
      onResetDefaults={handleResetDefaults}
      onRestoreBackup={async (backupPath) => {
        await onRestoreBackup?.(backupPath);
        if (!client.isDisposed()) {
          snapshot = await client.snapshot();
        }
      }}
      onConfirmResetEmpty={async () => {
        await onResetEmptyConfig?.();
        if (!client.isDisposed()) {
          snapshot = await client.snapshot();
        }
      }}
      onClose={() => {
        settingsOpen = false;
      }}
    />
  {/if}

  {#if importOpen}
    <ImportModal
      open={importOpen}
      {client}
      lastImport={snapshot.last_import ?? null}
      theme={resolvedTheme}
      onImported={(res) => {
        snapshot = res.snapshot;
        renderGen += 1;
        if (res.snapshot.last_import && !res.snapshot.last_import.blocked) {
          importOpen = false;
          statusNotice = 'LaTeX 导入成功';
        }
      }}
      onClose={() => {
        importOpen = false;
      }}
    />
  {/if}

  <div class="ms-obsidian-workspace">
    <div class="ms-obsidian-main">
      <MathSlotEditor
        bind:this={editorComponent}
        {client}
        {snapshot}
        theme={resolvedTheme}
        onSnapshotChange={(next) => {
          snapshot = next;
          renderGen += 1;
        }}
        onCopyLatex={handleCopy}
        onToggleNav={handleToggleNav}
        onOpenSettings={() => {
          settingsOpen = !settingsOpen;
        }}
      />

      <PreviewPanel
        {snapshot}
        {renderer}
        theme={resolvedTheme}
        generation={renderGen}
        display={effectiveDelimiter !== 'inline_dollar'}
        onCopyLatex={handleCopy}
      />

      <DiagnosticsPanel
        diagnostics={snapshot.diagnostics}
        sourceLatex={snapshot.latex}
        theme={resolvedTheme}
      />
    </div>

    <div class="ms-obsidian-side">
      {#if navOpen || snapshot.is_nav_mode}
        <NavTreePanel
          {client}
          {snapshot}
          theme={resolvedTheme}
          onSlotSelected={(_slotId, res) => {
            snapshot = res.snapshot;
            editorComponent?.focus();
          }}
        />
      {/if}

      <PalettePanel
        {client}
        theme={resolvedTheme}
        columns={isMobile ? 2 : 3}
        onRequestEditorFocus={() => editorComponent?.focus()}
        onCommandApplied={(_cmd, res) => {
          snapshot = res.snapshot;
          renderGen += 1;
        }}
        onPresetLoaded={(_preset, res) => {
          snapshot = res.snapshot;
          renderGen += 1;
        }}
      />
    </div>
  </div>
</div>

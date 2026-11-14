<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import {
    DiagnosticsPanel,
    ImportModal,
    MathSlotEditor,
    NavTreePanel,
    PalettePanel,
    PreviewPanel,
    SettingsPanel,
    createDefaultAppSettings,
    createEmptySnapshot,
    createMathJaxSvgAdapter,
    formatLatexWithDelimiter,
    matchesShortcut,
    type AppSettings,
    type DelimiterStyle,
    type EngineSnapshot,
    type PreviewDiagnostic,
    type ThemePreference,
    type UserFormulaEntry,
  } from '@mathslot/ui';
  import { createObsidianHostRenderAdapter } from './hostRenderAdapter';
  import type { WasmEngineClient } from './wasmClient';

  export interface AppShellProps {
    client: WasmEngineClient;
    theme?: ThemePreference;
    isMobile?: boolean;
    initialSettingsOpen?: boolean;
    initialImportOpen?: boolean;
    initialImportLatex?: string;
    delimiterStyle?: DelimiterStyle;
    initialUserFormulas?: UserFormulaEntry[];
    onInsert?: (formattedLatex: string, rawLatex: string) => void;
    onCopy?: (formattedLatex: string, rawLatex: string) => void;
    onRestoreBackup?: (
      backupPath: string | null,
    ) => void | UserFormulaEntry[] | Promise<void | UserFormulaEntry[]>;
    onResetEmptyConfig?: () => void | UserFormulaEntry[] | Promise<void | UserFormulaEntry[]>;
    onPersistSettings?: (settings: AppSettings) => void | Promise<void>;
    onSaveSnippet?: (source: string, latex: string) => UserFormulaEntry[] | Promise<UserFormulaEntry[]>;
    onImportConfigData?: (
      rawJson: string,
    ) => Promise<{ settings?: AppSettings; userFormulas?: UserFormulaEntry[] }>;
    onExportConfigData?: (settings: AppSettings) => string | Promise<string>;
    onConfigExported?: (rawJson: string) => void;
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
    initialImportLatex = '',
    delimiterStyle,
    initialUserFormulas = [],
    onInsert,
    onCopy,
    onRestoreBackup,
    onResetEmptyConfig,
    onPersistSettings,
    onSaveSnippet,
    onImportConfigData,
    onExportConfigData,
    onConfigExported,
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
  let renderDiagnostics = $state<PreviewDiagnostic[]>([]);
  let userFormulas = $state<UserFormulaEntry[]>([]);
  let editorComponent = $state<{ focus: () => void } | null>(null);
  let diagnosticsComponent = $state<{ expand: () => void } | null>(null);
  let configFileInputEl: HTMLInputElement | null = null;
  let didApplyInitialToggles = false;

  $effect.pre(() => {
    if (!didApplyInitialToggles) {
      settingsOpen = initialSettingsOpen;
      importOpen = initialImportOpen;
      userFormulas = [...initialUserFormulas];
      didApplyInitialToggles = true;
    }
  });

  const currentSettings = $derived(snapshot.settings ?? createDefaultAppSettings());

  const resolvedTheme = $derived.by<'light' | 'dark'>(() => {
    const settingsTheme = snapshot.settings?.theme;
    if (settingsTheme === 'light' || settingsTheme === 'dark') {
      return settingsTheme;
    }
    if (theme === 'light' || theme === 'dark') {
      return theme;
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
      if (snapshot.recovery) {
        settingsOpen = true;
      }
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

  async function writeClipboard(text: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard API may be unavailable in headless tests; host callback still runs.
      }
    }
  }

  async function handleCopy(): Promise<void> {
    const rawLatex = snapshot.copy_text || snapshot.latex;
    const formatted = await formatOutputLatex(rawLatex);
    await writeClipboard(formatted);
    await client.dispatch('RequestCopy');
    statusNotice = formatted ? '已复制 LaTeX' : '当前公式为空';
    onCopy?.(formatted, rawLatex);
  }

  async function handleExportLatex(strict: boolean): Promise<void> {
    const res = await client.dispatch({ RequestExport: { strict } });
    snapshot = res.snapshot;
    const hasEmptySlots = res.snapshot.slots.some((slot) => slot.is_empty);
    const hasErrorDiagnostics = res.snapshot.diagnostics.some((d) => d.severity === 'Error');
    let exportBlocked = false;
    let exportedFormatted = '';

    for (const effect of res.effects) {
      if (typeof effect === 'object' && effect !== null && 'ExportResult' in effect) {
        if ('Err' in effect.ExportResult) {
          exportBlocked = true;
        } else if ('Ok' in effect.ExportResult) {
          exportedFormatted = effect.ExportResult.Ok[0];
        }
      }
    }

    const rawLatex = res.snapshot.copy_text || res.snapshot.latex;
    if (strict && (exportBlocked || hasEmptySlots || hasErrorDiagnostics || !rawLatex.trim())) {
      statusNotice = '存在未完成槽位或错误诊断，严格导出已阻断';
      return;
    }

    const formatted = exportedFormatted || (await formatOutputLatex(rawLatex));
    await writeClipboard(formatted);
    statusNotice = strict ? '严格导出成功并已复制' : '已导出 LaTeX';
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

  function handleFocusEditor(): void {
    importOpen = false;
    settingsOpen = false;
    void tick().then(() => {
      editorComponent?.focus();
    });
  }

  let fallbackSnippetSeq = 0;

  function nextFallbackSnippetId(): string {
    fallbackSnippetSeq += 1;
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `snippet-${Date.now().toString(16)}-${fallbackSnippetSeq.toString(16)}`;
  }

  async function handleSaveSnippet(): Promise<void> {
    if (snapshot.recovery) {
      statusNotice = '保存片段失败: 存在未解决的配置损坏恢复状态，请先从备份恢复或重置为空配置';
      return;
    }
    const snippetSource = snapshot.source?.trim() ? snapshot.source : snapshot.latex;
    if (!snippetSource.trim()) {
      statusNotice = '当前公式为空，无法保存片段';
      return;
    }
    try {
      const res = await client.dispatch('RequestSaveSnippet');
      snapshot = res.snapshot;

      let savedSource = snippetSource;
      let savedLatex = snapshot.latex;
      for (const effect of res.effects) {
        if (
          typeof effect === 'object' &&
          effect !== null &&
          'Host' in effect &&
          typeof effect.Host === 'object' &&
          effect.Host !== null &&
          'SaveSnippet' in effect.Host
        ) {
          savedSource = effect.Host.SaveSnippet.source || snippetSource;
          savedLatex = effect.Host.SaveSnippet.latex || snapshot.latex;
        }
      }

      if (onSaveSnippet) {
        userFormulas = await onSaveSnippet(savedSource, savedLatex);
      } else {
        const nextEntry: UserFormulaEntry = {
          id: nextFallbackSnippetId(),
          name: `片段 ${savedSource.slice(0, 18)}`,
          category: '自定义',
          source: savedSource,
          desc: '从编辑器保存',
          tags: ['snippet'],
          is_builtin: false,
          created_at: Math.floor(Date.now() / 1000),
        };
        userFormulas = [...userFormulas, nextEntry];
      }
      statusNotice = '已保存为自定义片段';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      statusNotice = `保存片段失败: ${msg}`;
    }
  }

  async function handleSaveSettings(next: AppSettings): Promise<void> {
    if (snapshot.recovery) {
      const msg = '存在未解决的配置损坏恢复状态，请先从备份恢复或重置为空配置';
      statusNotice = `保存设置失败: ${msg}`;
      throw new Error(msg);
    }
    try {
      await onPersistSettings?.(next);
      const res = await client.dispatch({ UpdateSettings: next });
      snapshot = res.snapshot;
      renderGen += 1;
      statusNotice = '设置已保存';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      statusNotice = `保存设置失败: ${msg}`;
      throw err;
    }
  }

  async function handleResetDefaults(defaults: AppSettings): Promise<void> {
    if (snapshot.recovery) {
      const msg = '存在未解决的配置损坏恢复状态，请先从备份恢复或重置为空配置';
      statusNotice = `恢复默认设置失败: ${msg}`;
      throw new Error(msg);
    }
    const nextDefaults: AppSettings = {
      ...createDefaultAppSettings(),
      config_path: snapshot.settings?.config_path ?? defaults.config_path ?? null,
    };
    try {
      await onPersistSettings?.(nextDefaults);
      const res = await client.dispatch('ResetSettingsConfirmed');
      snapshot = res.snapshot;
      renderGen += 1;
      statusNotice = '设置已恢复默认';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      statusNotice = `恢复默认设置失败: ${msg}`;
      throw err;
    }
  }

  async function handleExportConfig(): Promise<void> {
    try {
      const rawJson = onExportConfigData
        ? await onExportConfigData(currentSettings)
        : JSON.stringify(
            {
              schema_version: 3,
              settings: currentSettings,
              customFormats: [],
              snippets: userFormulas,
            },
            null,
            2,
          );
      onConfigExported?.(rawJson);
      if (
        typeof Blob !== 'undefined' &&
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function'
      ) {
        const blob = new Blob([rawJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        try {
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = 'mathslot-obsidian-config.json';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      statusNotice = '已导出配置文件 (JSON)';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      statusNotice = `导出配置失败: ${msg}`;
    }
  }

  function triggerImportConfig(): void {
    configFileInputEl?.click();
  }

  async function handleConfigFileSelected(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const raw = await file.text();
      if (onImportConfigData) {
        const imported = await onImportConfigData(raw);
        if (imported.settings) {
          const res = await client.dispatch({ UpdateSettings: imported.settings });
          snapshot = res.snapshot;
          renderGen += 1;
        }
        if (imported.userFormulas) {
          userFormulas = imported.userFormulas;
        }
      } else {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('Config JSON root must be an object.');
        }
        if (typeof parsed.settings === 'object' && parsed.settings !== null) {
          const mergedSettings: AppSettings = {
            ...createDefaultAppSettings(),
            ...(parsed.settings as Partial<AppSettings>),
            shortcuts: {
              ...createDefaultAppSettings().shortcuts,
              ...((parsed.settings as Partial<AppSettings>).shortcuts ?? {}),
            },
          };
          const res = await client.dispatch({ UpdateSettings: mergedSettings });
          snapshot = res.snapshot;
          renderGen += 1;
          await onPersistSettings?.(res.snapshot.settings ?? mergedSettings);
        }
        if (Array.isArray(parsed.snippets)) {
          userFormulas = parsed.snippets as UserFormulaEntry[];
        }
      }
      statusNotice = '配置文件已验证并导入';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      statusNotice = `导入配置失败: ${msg}`;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (importOpen) {
        event.preventDefault();
        importOpen = false;
        return;
      }
      if (settingsOpen) {
        event.preventDefault();
        settingsOpen = false;
        return;
      }
    }

    const active = document.activeElement;
    const inTextInput =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable);

    if (matchesShortcut(event, currentSettings.shortcuts.open_settings)) {
      event.preventDefault();
      settingsOpen = !settingsOpen;
      return;
    }

    if (matchesShortcut(event, currentSettings.shortcuts.toggle_nav) && !inTextInput) {
      event.preventDefault();
      void handleToggleNav();
      return;
    }

    if (matchesShortcut(event, currentSettings.shortcuts.focus_editor)) {
      event.preventDefault();
      handleFocusEditor();
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  class="mathslot-obsidian-host"
  class:is-mobile={isMobile}
  data-host="obsidian"
  data-theme={resolvedTheme}
  data-theme-override={snapshot.settings?.theme === 'light' || snapshot.settings?.theme === 'dark'
    ? snapshot.settings.theme
    : undefined}
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
        data-testid="obsidian-save-snippet-btn"
        onclick={() => void handleSaveSnippet()}
      >
        存为片段
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

  <input
    bind:this={configFileInputEl}
    type="file"
    accept=".json,application/json"
    class="ms-sr-only"
    data-testid="obsidian-config-file-input"
    onchange={handleConfigFileSelected}
  />

  {#if settingsOpen}
    <SettingsPanel
      settings={currentSettings}
      recovery={snapshot.recovery ?? null}
      {client}
      theme={resolvedTheme}
      sampleLatex={snapshot.latex || '\\frac{a + b}{c}'}
      supportedBackends={['mathjax']}
      onSaveSettings={handleSaveSettings}
      onResetDefaults={handleResetDefaults}
      onImportConfig={triggerImportConfig}
      onExportConfig={handleExportConfig}
      onRestoreBackup={async (backupPath) => {
        try {
          const restored = await onRestoreBackup?.(backupPath);
          if (Array.isArray(restored)) {
            userFormulas = restored;
          }
          if (!client.isDisposed()) {
            snapshot = await client.snapshot();
          }
          statusNotice = '已从备份恢复配置';
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          statusNotice = `恢复备份失败: ${msg}`;
          throw err;
        }
      }}
      onConfirmResetEmpty={async () => {
        try {
          const resetEntries = await onResetEmptyConfig?.();
          if (Array.isArray(resetEntries)) {
            userFormulas = resetEntries;
          }
          if (!client.isDisposed()) {
            snapshot = await client.snapshot();
          }
          statusNotice = '已重置为空配置';
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          statusNotice = `重置空配置失败: ${msg}`;
          throw err;
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
      initialLatex={initialImportLatex}
      lastImport={snapshot.last_import ?? null}
      theme={resolvedTheme}
      onPreviewed={(res) => {
        snapshot = res.snapshot;
        if (res.snapshot.last_import?.blocked) {
          statusNotice = 'LaTeX 预览检测到语法错误，已禁用确认导入';
        } else if (res.snapshot.last_import) {
          statusNotice = 'LaTeX 导入预览已就绪，请审阅 Diff 后确认';
        }
      }}
      onImported={(res) => {
        snapshot = res.snapshot;
        renderGen += 1;
        if (res.snapshot.last_import?.blocked) {
          statusNotice = 'LaTeX 导入已阻断，请查看诊断';
        } else if (res.snapshot.last_import) {
          statusNotice = 'LaTeX 已导入（支持 Ctrl+Z 一步撤回）';
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
        shortcuts={currentSettings.shortcuts}
        onSnapshotChange={(next) => {
          snapshot = next;
          renderGen += 1;
        }}
        onCopyLatex={handleCopy}
        onSaveSnippet={() => {
          void handleSaveSnippet();
        }}
        onFocusEditor={handleFocusEditor}
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
        previewScalePct={currentSettings.preview_scale_pct ?? null}
        onRenderResult={(res) => {
          renderDiagnostics = res.degraded ? res.diagnostics : [];
        }}
        onViewDiagnostics={() => {
          diagnosticsComponent?.expand();
        }}
        onCopyLatex={handleCopy}
        onExportLatex={(strict) => {
          void handleExportLatex(strict);
        }}
      />

      <DiagnosticsPanel
        bind:this={diagnosticsComponent}
        diagnostics={snapshot.diagnostics}
        {renderDiagnostics}
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
        {userFormulas}
        onRequestEditorFocus={() => editorComponent?.focus()}
        onCommandApplied={(_cmd, res) => {
          snapshot = res.snapshot;
          renderGen += 1;
        }}
        onPresetLoaded={(_preset, res) => {
          snapshot = res.snapshot;
          renderGen += 1;
        }}
        onUserFormulaLoaded={(_formula, res) => {
          snapshot = res.snapshot;
          renderGen += 1;
        }}
      />
    </div>
  </div>
</div>

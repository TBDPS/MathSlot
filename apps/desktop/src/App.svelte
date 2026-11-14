<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import '@mathslot/ui/tokens.css';
  import './styles.css';
  import {
    DiagnosticsPanel,
    ImportModal,
    MathSlotEditor,
    NavTreePanel,
    PalettePanel,
    PreviewPanel,
    SettingsPanel,
    captureRestoreFocus,
    createDefaultAppSettings,
    createEmptySnapshot,
    createLatexRustBridgeAdapter,
    createManagedRenderer,
    createMathJaxSvgAdapter,
    focusFirstInside,
    formatLatexWithDelimiter,
    matchesShortcut,
    restoreFocus,
    trapFocusKeydown,
    type AppEvent,
    type AppSettings,
    type DelimiterStyle,
    type DispatchResponse,
    type EngineClient,
    type EngineSnapshot,
    type ManagedRenderer,
    type PreviewDiagnostic,
    type RenderAdapter,
    type StatusSeverity,
    type UserFormulaEntry,
  } from '@mathslot/ui';
  import { createDesktopHostBridge, type DesktopHostBridge } from './lib/desktopClient';

  export interface DesktopAppProps {
    bridge?: DesktopHostBridge;
  }

  let { bridge: injectedBridge }: DesktopAppProps = $props();

  const hostBridge = $derived(injectedBridge ?? createDesktopHostBridge());

  let snapshot = $state<EngineSnapshot>(createEmptySnapshot());
  let engineVer = $state('0.7.0');
  let renderGeneration = $state(1);
  let systemDark = $state(false);
  let showImportModal = $state(false);
  let showSettingsModal = $state(false);
  let showNavPanel = $state(true);
  let showDiagnosticsPanel = $state(true);
  let toastMessage = $state<string | null>(null);
  let toastSeverity = $state<StatusSeverity>('Info');
  let editorRef = $state<{ focus: () => void } | null>(null);
  let diagnosticsRef = $state<{ expand: () => void } | null>(null);
  let renderDiagnostics = $state<PreviewDiagnostic[]>([]);
  let userFormulas = $state<UserFormulaEntry[]>([]);
  let fileInputEl: HTMLInputElement | null = null;
  let importModalRef = $state<{ cancel: () => void } | null>(null);
  let settingsModalCardEl = $state<HTMLDivElement | null>(null);
  let importReturnFocusEl: HTMLElement | null = null;
  let settingsReturnFocusEl: HTMLElement | null = null;

  const currentSettings = $derived(snapshot.settings ?? createDefaultAppSettings());

  const resolvedTheme = $derived<'light' | 'dark'>(
    currentSettings.theme === 'system'
      ? systemDark
        ? 'dark'
        : 'light'
      : currentSettings.theme,
  );

  const mathjaxAdapter = createMathJaxSvgAdapter();
  const latexRustAdapter = createLatexRustBridgeAdapter((req) => hostBridge.renderLatexSvg(req));
  const mathjaxManaged = createManagedRenderer({
    primary: mathjaxAdapter,
    debounceMs: 24,
    maxWaitMs: 56,
  });
  const latexRustManaged = createManagedRenderer({
    primary: latexRustAdapter,
    fallback: mathjaxAdapter,
    debounceMs: 24,
    maxWaitMs: 56,
  });
  const activeRenderer = $derived<ManagedRenderer>(
    currentSettings.render_backend === 'latex-rust' ? latexRustManaged : mathjaxManaged,
  );

  let lastBridgeRef: DesktopHostBridge | undefined = undefined;
  $effect(() => {
    const currentBridge = hostBridge;
    if (lastBridgeRef !== undefined && lastBridgeRef !== currentBridge) {
      latexRustManaged.clearCache();
    }
    lastBridgeRef = currentBridge;
  });

  onDestroy(() => {
    mathjaxManaged.dispose();
    latexRustManaged.dispose();
  });

  const primaryStatusInfo = $derived.by(() => {
    if (snapshot.recovery) {
      return { kind: 'recovery', label: '配置恢复向导' };
    }
    if (snapshot.is_nav_mode) {
      return { kind: 'nav', label: '导航模式' };
    }
    if (snapshot.has_pending_command) {
      return { kind: 'prefix', label: '命令前缀 ▸' };
    }
    return { kind: 'idle', label: '空闲' };
  });

  const formattedCopyText = $derived(
    snapshot.copy_text && snapshot.copy_text.length > 0
      ? snapshot.copy_text
      : formatLatexWithDelimiter(snapshot.latex, currentSettings.delimiter_style),
  );

  function formatDelimiterBadge(style: DelimiterStyle): string {
    switch (style) {
      case 'inline_dollar':
        return '$...$';
      case 'block_dollar':
        return '$$...$$';
      case 'code_fence':
        return '```latex';
      case 'none':
      default:
        return '纯 LaTeX';
    }
  }

  function showToast(message: string, severity: StatusSeverity = 'Info'): void {
    toastMessage = message;
    toastSeverity = severity;
  }

  async function dispatchThroughBridge(event: AppEvent): Promise<DispatchResponse> {
    const resp = await hostBridge.dispatch(event);
    snapshot = resp.snapshot;
    renderGeneration += 1;
    for (const effect of resp.effects) {
      if (typeof effect === 'object' && effect !== null) {
        if ('Clipboard' in effect) {
          await hostBridge.copyToClipboard(effect.Clipboard);
          showToast('已复制 LaTeX 到剪贴板', 'Info');
        } else if ('Status' in effect) {
          showToast(effect.Status.message, effect.Status.severity);
        } else if ('ExportResult' in effect) {
          if ('Ok' in effect.ExportResult) {
            const [exportedText] = effect.ExportResult.Ok;
            await hostBridge.copyToClipboard(exportedText);
            showToast('严格导出成功并已复制', 'Info');
          } else {
            showToast('存在未完成或错误诊断，严格导出已阻断', 'Error');
          }
        } else if (
          'Host' in effect &&
          typeof effect.Host === 'object' &&
          effect.Host !== null &&
          'SaveSnippet' in effect.Host
        ) {
          userFormulas = await hostBridge.getUserFormulas();
        }
      }
    }
    return resp;
  }

  const reactiveClient: EngineClient = {
    dispatch: (event: AppEvent) => dispatchThroughBridge(event),
    snapshot: () => hostBridge.snapshot(),
    engineVersion: () => hostBridge.engineVersion(),
  };

  async function applyDispatch(event: AppEvent): Promise<void> {
    try {
      await dispatchThroughBridge(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`操作失败: ${msg}`, 'Error');
    }
  }

  async function handleCopyLatex(): Promise<void> {
    if (!snapshot.latex) {
      showToast('当前公式为空', 'Warning');
      return;
    }
    await applyDispatch('RequestCopy');
  }

  async function handleStrictExport(): Promise<void> {
    await applyDispatch({ RequestExport: { strict: true } });
  }

  async function handleSaveSnippet(): Promise<void> {
    if (!snapshot.latex && !snapshot.source) {
      showToast('当前公式为空，无法保存片段', 'Warning');
      return;
    }
    await applyDispatch('RequestSaveSnippet');
  }

  function openImportModal(): void {
    if (!showImportModal) {
      importReturnFocusEl = captureRestoreFocus(document);
    }
    showImportModal = true;
  }

  function closeImportModal(): void {
    showImportModal = false;
    const target = importReturnFocusEl;
    importReturnFocusEl = null;
    restoreFocus(target);
  }

  function openSettingsModal(): void {
    if (!showSettingsModal) {
      settingsReturnFocusEl = captureRestoreFocus(document);
    }
    showSettingsModal = true;
    void tick().then(() => {
      if (showSettingsModal && settingsModalCardEl) {
        focusFirstInside(settingsModalCardEl, settingsModalCardEl);
      }
    });
  }

  function closeSettingsModal(): void {
    showSettingsModal = false;
    const target = settingsReturnFocusEl;
    settingsReturnFocusEl = null;
    restoreFocus(target);
  }

  function handleSettingsDialogKeydown(event: KeyboardEvent): void {
    trapFocusKeydown(event, settingsModalCardEl, () => {
      closeSettingsModal();
    });
  }

  async function handleSaveSettings(next: AppSettings): Promise<void> {
    try {
      await dispatchThroughBridge({ UpdateSettings: next });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`操作失败: ${msg}`, 'Error');
      throw err;
    }
  }

  async function handleResetDefaults(): Promise<void> {
    try {
      await dispatchThroughBridge('ResetSettingsConfirmed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`操作失败: ${msg}`, 'Error');
      throw err;
    }
  }

  async function handleRestoreBackup(backupPath: string | null): Promise<void> {
    try {
      snapshot = await hostBridge.restoreBackup(backupPath);
      userFormulas = await hostBridge.getUserFormulas();
      showToast('已从备份恢复配置', 'Info');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`备份恢复失败: ${msg}`, 'Error');
      throw err;
    }
  }

  async function handleConfirmResetEmpty(): Promise<void> {
    try {
      snapshot = await hostBridge.resetEmptyConfig();
      userFormulas = await hostBridge.getUserFormulas();
      showToast('已确认重置为空配置', 'Info');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`重置失败: ${msg}`, 'Error');
      throw err;
    }
  }

  async function handleExportConfig(): Promise<void> {
    try {
      const rawJson = await hostBridge.exportConfigJson();
      const blob = new Blob([rawJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'mathslot-library.json';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showToast('已导出完整配置文件 (JSON)', 'Info');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`导出配置失败: ${msg}`, 'Error');
    }
  }

  function triggerImportConfig(): void {
    fileInputEl?.click();
  }

  async function handleConfigFileSelected(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const raw = await file.text();
      snapshot = await hostBridge.importConfigJson(raw);
      userFormulas = await hostBridge.getUserFormulas();
      showToast('配置文件已验证并导入', 'Info');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`导入配置失败: ${msg}`, 'Error');
    }
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (showImportModal) {
        event.preventDefault();
        if (importModalRef) {
          importModalRef.cancel();
        } else {
          closeImportModal();
        }
        return;
      }
      if (showSettingsModal) {
        event.preventDefault();
        closeSettingsModal();
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
      openSettingsModal();
      return;
    }

    if (matchesShortcut(event, currentSettings.shortcuts.toggle_nav) && !inTextInput) {
      event.preventDefault();
      showNavPanel = !showNavPanel;
      return;
    }

    if (matchesShortcut(event, currentSettings.shortcuts.focus_editor)) {
      event.preventDefault();
      showImportModal = false;
      showSettingsModal = false;
      void tick().then(() => {
        editorRef?.focus();
      });
    }
  }

  onMount(() => {
    const mq =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    systemDark = mq?.matches ?? false;
    const onSchemeChange = (e: MediaQueryListEvent) => {
      systemDark = e.matches;
    };
    mq?.addEventListener('change', onSchemeChange);

    void (async () => {
      try {
        const [initialSnap, version, formulas] = await Promise.all([
          hostBridge.snapshot(),
          hostBridge.engineVersion(),
          hostBridge.getUserFormulas(),
        ]);
        snapshot = initialSnap;
        engineVer = version;
        userFormulas = formulas;
        if (initialSnap.recovery) {
          showSettingsModal = true;
          showToast('检测到配置损坏，已启用恢复向导', 'Warning');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`初始化引擎失败: ${msg}`, 'Error');
      }
    })();

    return () => {
      mq?.removeEventListener('change', onSchemeChange);
    };
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  class="ms-desktop-app"
  data-testid="desktop-app"
  data-host="desktop"
  data-theme={resolvedTheme}
>
  <header class="ms-desktop-topbar" aria-label="主工具栏">
    <div class="ms-desktop-brand-group">
      <span class="ms-desktop-brand-mark" aria-hidden="true">∑</span>
      <h1 class="ms-desktop-brand-title">MathSlot</h1>
      <span class="ms-desktop-version">v{engineVer}</span>
      <span
        class="ms-desktop-status-pill"
        data-testid="desktop-status-pill"
        data-kind={primaryStatusInfo.kind}
      >
        {primaryStatusInfo.label}
      </span>
      <span
        class="ms-desktop-toast"
        class:ms-desktop-toast-empty={!toastMessage}
        data-testid="desktop-toast"
        data-severity={toastSeverity}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {#if toastMessage}
          {#if toastSeverity === 'Error'}
            <span class="ms-toast-badge" aria-hidden="true">!</span>
            <span class="ms-sr-only">错误：</span>
          {:else if toastSeverity === 'Warning'}
            <span class="ms-toast-badge" aria-hidden="true">!</span>
            <span class="ms-sr-only">警告：</span>
          {/if}
          {toastMessage}
        {/if}
      </span>
    </div>

    <div class="ms-desktop-actions">
      {#if snapshot.recovery}
        <button
          type="button"
          class="ms-btn ms-btn-warn"
          data-testid="desktop-open-recovery-btn"
          onclick={openSettingsModal}
        >
          恢复向导
        </button>
      {/if}
      <button
        type="button"
        class="ms-btn"
        data-testid="desktop-import-btn"
        onclick={openImportModal}
      >
        导入 LaTeX
      </button>
      <button
        type="button"
        class="ms-btn ms-btn-primary"
        data-testid="desktop-copy-btn"
        onclick={() => void handleCopyLatex()}
      >
        复制 LaTeX
      </button>
      <button
        type="button"
        class="ms-btn"
        data-testid="desktop-export-strict-btn"
        onclick={() => void handleStrictExport()}
      >
        严格导出
      </button>
      <button
        type="button"
        class="ms-btn"
        data-testid="desktop-clear-btn"
        onclick={() => void applyDispatch('Clear')}
      >
        清空
      </button>
      <button
        type="button"
        class="ms-btn"
        data-testid="desktop-settings-btn"
        onclick={openSettingsModal}
      >
        设置
      </button>
    </div>
  </header>

  <main class="ms-desktop-workspace">
    <section class="ms-desktop-column" aria-label="编辑与命令面板">
      <div class="ms-card">
        <div class="ms-card-header">
          <h2 class="ms-card-title">流式公式编辑器</h2>
          <div class="ms-card-subactions">
            <button
              type="button"
              class="ms-btn ms-btn-compact"
              data-testid="desktop-undo-btn"
              disabled={!snapshot.can_undo}
              onclick={() => void applyDispatch('Undo')}
            >
              撤销
            </button>
            <button
              type="button"
              class="ms-btn ms-btn-compact"
              data-testid="desktop-redo-btn"
              disabled={!snapshot.can_redo}
              onclick={() => void applyDispatch('Redo')}
            >
              重做
            </button>
            <button
              type="button"
              class="ms-btn ms-btn-compact"
              data-testid="desktop-save-snippet-btn"
              onclick={() => void handleSaveSnippet()}
            >
              存为片段
            </button>
          </div>
        </div>

        <MathSlotEditor
          bind:this={editorRef}
          client={reactiveClient}
          {snapshot}
          theme={resolvedTheme}
          shortcuts={currentSettings.shortcuts}
          onSnapshotChange={(nextSnap) => {
            snapshot = nextSnap;
            renderGeneration += 1;
          }}
          onCopyLatex={() => {
            void handleCopyLatex();
          }}
          onSaveSnippet={() => {
            void handleSaveSnippet();
          }}
          onToggleNav={() => {
            showNavPanel = !showNavPanel;
          }}
          onOpenSettings={openSettingsModal}
        />
      </div>

      <div class="ms-card">
        <div class="ms-card-header">
          <h2 class="ms-card-title">命令与预设面板</h2>
        </div>
        <PalettePanel
          client={reactiveClient}
          theme={resolvedTheme}
          {userFormulas}
          onRequestEditorFocus={() => editorRef?.focus()}
          onCommandApplied={(_cmd, resp) => {
            snapshot = resp.snapshot;
            renderGeneration += 1;
          }}
          onPresetLoaded={(_preset, resp) => {
            snapshot = resp.snapshot;
            renderGeneration += 1;
          }}
          onUserFormulaLoaded={(_formula, resp) => {
            snapshot = resp.snapshot;
            renderGeneration += 1;
          }}
        />
      </div>
    </section>

    <section class="ms-desktop-column" aria-label="实时预览与结构诊断">
      <div class="ms-card">
        <div class="ms-card-header">
          <h2 class="ms-card-title">实时公式预览</h2>
        </div>
        <PreviewPanel
          latex={snapshot.latex}
          previewLatex={snapshot.preview_latex}
          {snapshot}
          renderer={activeRenderer}
          theme={resolvedTheme}
          generation={renderGeneration}
          display={true}
          previewScalePct={currentSettings.preview_scale_pct ?? null}
          onRenderResult={(res) => {
            renderDiagnostics = res.degraded ? res.diagnostics : [];
          }}
          onViewDiagnostics={() => {
            showDiagnosticsPanel = true;
            void tick().then(() => {
              diagnosticsRef?.expand();
            });
          }}
          onCopyLatex={() => {
            void handleCopyLatex();
          }}
          onExportLatex={(strict) => {
            void applyDispatch({ RequestExport: { strict } });
          }}
        />
      </div>

      <div class="ms-card">
        <div class="ms-card-header">
          <h2 class="ms-card-title">
            槽位结构树
            <span class="ms-count-badge">{snapshot.slots.length}</span>
          </h2>
          <button
            type="button"
            class="ms-btn ms-btn-compact"
            data-testid="desktop-toggle-nav-btn"
            aria-expanded={showNavPanel}
            onclick={() => {
              showNavPanel = !showNavPanel;
            }}
          >
            {showNavPanel ? '折叠' : '展开'}
          </button>
        </div>
        {#if showNavPanel}
          <NavTreePanel
            client={reactiveClient}
            {snapshot}
            theme={resolvedTheme}
            onSlotSelected={(_id, resp) => {
              snapshot = resp.snapshot;
            }}
          />
        {/if}
      </div>

      <div class="ms-card">
        <div class="ms-card-header">
          <h2 class="ms-card-title">
            诊断与校验
            <span
              class="ms-count-badge"
              data-alert={snapshot.diagnostics.length + renderDiagnostics.length > 0 ? 'true' : 'false'}
            >
              {snapshot.diagnostics.length + renderDiagnostics.length}
            </span>
          </h2>
          <button
            type="button"
            class="ms-btn ms-btn-compact"
            data-testid="desktop-toggle-diag-btn"
            aria-expanded={showDiagnosticsPanel}
            onclick={() => {
              showDiagnosticsPanel = !showDiagnosticsPanel;
            }}
          >
            {showDiagnosticsPanel ? '折叠' : '展开'}
          </button>
        </div>
        {#if showDiagnosticsPanel}
          <DiagnosticsPanel
            bind:this={diagnosticsRef}
            diagnostics={snapshot.diagnostics}
            {renderDiagnostics}
            sourceLatex={snapshot.latex}
            theme={resolvedTheme}
          />
        {/if}
      </div>
    </section>
  </main>

  <footer class="ms-desktop-footer" aria-label="输出栏">
    <div class="ms-desktop-copy-readout">
      <span class="ms-delimiter-tag" data-testid="desktop-delimiter-badge">
        {formatDelimiterBadge(currentSettings.delimiter_style)}
      </span>
      <code class="ms-desktop-copy-code" data-testid="desktop-copy-preview">
        {formattedCopyText || '（输入或点击卡片以生成 LaTeX）'}
      </code>
    </div>
    <button
      type="button"
      class="ms-btn ms-btn-compact"
      data-testid="desktop-footer-copy-btn"
      onclick={() => void handleCopyLatex()}
    >
      复制输出
    </button>
  </footer>

  <input
    bind:this={fileInputEl}
    type="file"
    accept=".json,application/json"
    class="ms-sr-only"
    tabindex="-1"
    aria-hidden="true"
    data-testid="desktop-config-file-input"
    onchange={handleConfigFileSelected}
  />

  {#if showImportModal}
    <div class="ms-modal-backdrop">
      <div class="ms-modal-shell">
        <ImportModal
          bind:this={importModalRef}
          client={reactiveClient}
          lastImport={snapshot.last_import ?? null}
          theme={resolvedTheme}
          onPreviewed={(resp) => {
            snapshot = resp.snapshot;
          }}
          onImported={(resp) => {
            snapshot = resp.snapshot;
            renderGeneration += 1;
          }}
          onClose={closeImportModal}
        />
      </div>
    </div>
  {/if}

  {#if showSettingsModal}
    <div
      class="ms-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-heading"
      tabindex="-1"
      onkeydown={handleSettingsDialogKeydown}
    >
      <div bind:this={settingsModalCardEl} class="ms-modal-card" tabindex="-1">
        <div class="ms-modal-header">
          <h2 id="settings-modal-heading" class="ms-modal-title">应用设置与数据恢复</h2>
          <button
            type="button"
            class="ms-btn ms-btn-compact"
            data-testid="desktop-close-settings-btn"
            onclick={closeSettingsModal}
          >
            关闭
          </button>
        </div>
        <SettingsPanel
          client={reactiveClient}
          settings={currentSettings}
          recovery={snapshot.recovery ?? null}
          sampleLatex={snapshot.latex || '\\frac{a}{b}'}
          supportedBackends={['mathjax', 'latex-rust']}
          theme={resolvedTheme}
          onSaveSettings={handleSaveSettings}
          onResetDefaults={handleResetDefaults}
          onRestoreBackup={handleRestoreBackup}
          onConfirmResetEmpty={handleConfirmResetEmpty}
          onImportConfig={triggerImportConfig}
          onExportConfig={handleExportConfig}
        />
      </div>
    </div>
  {/if}
</div>

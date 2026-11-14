<script lang="ts">
  import { onDestroy } from 'svelte';
  import '../theme/tokens.css';
  import type { DiagnosticSnapshot, EngineSnapshot } from '../client/engine';
  import {
    createManagedRenderer,
    createMathJaxSvgAdapter,
    summarizeRenderError,
    type ManagedRenderer,
    type PreviewDiagnostic,
    type PreviewRenderRequest,
    type PreviewRenderResult,
    type RenderAdapter,
    type RenderTheme,
  } from './renderAdapter';

  export interface PreviewPanelProps {
    latex?: string;
    previewLatex?: string;
    snapshot?: EngineSnapshot;
    renderer?: RenderAdapter | ManagedRenderer;
    theme?: 'light' | 'dark' | 'auto';
    generation?: number;
    display?: boolean;
    ariaLabel?: string;
    onRenderResult?: (result: PreviewRenderResult) => void;
    onCopyLatex?: (latex: string, diagnostics: DiagnosticSnapshot[]) => void;
    onExportLatex?: (strict: boolean) => void;
  }

  let {
    latex,
    previewLatex,
    snapshot,
    renderer,
    theme = 'auto',
    generation = 1,
    display = true,
    ariaLabel = '公式实时预览',
    onRenderResult,
    onCopyLatex,
    onExportLatex,
  }: PreviewPanelProps = $props();

  type FitMode = 'fit-to-width' | 'actual';

  function readSystemPrefersDark(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return Boolean(window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  let fitMode = $state<FitMode>('fit-to-width');
  let zoomScale = $state(1.0);
  let renderResult = $state<PreviewRenderResult | null>(null);
  let renderPending = $state(false);
  let systemPrefersDark = $state(readSystemPrefersDark());
  let internalGenCounter = 0;
  let latestAppliedGen = 0;

  let ownedManaged: ManagedRenderer | null = null;
  let lastPrimaryRef: RenderAdapter | ManagedRenderer | undefined = undefined;

  const resolvedThemeAttr = $derived(theme === 'auto' ? undefined : theme);
  const renderTheme = $derived<RenderTheme>(
    theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : systemPrefersDark ? 'dark' : 'light',
  );

  $effect(() => {
    if (theme !== 'auto' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    systemPrefersDark = Boolean(mql.matches);
    const onChange = (event: MediaQueryListEvent) => {
      systemPrefersDark = Boolean(event.matches);
    };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    if (typeof mql.addListener === 'function') {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
  });
  const effectiveLatex = $derived(latex ?? snapshot?.latex ?? '');
  const effectivePreviewLatex = $derived(previewLatex ?? snapshot?.preview_latex ?? '');
  const snapshotDiagnostics = $derived(snapshot?.diagnostics ?? []);
  const zoomPercent = $derived(Math.round(zoomScale * 100));

  const isDegraded = $derived(renderResult?.degraded ?? false);
  const headerDiagnostic = $derived<PreviewDiagnostic | null>(
    renderResult?.errorSummary ?? renderResult?.diagnostics[0] ?? null,
  );
  const headerSummaryText = $derived.by(() => {
    if (!headerDiagnostic) return '';
    const chars = Array.from(headerDiagnostic.summary.replace(/[\r\n]+/g, ' ').trim());
    return chars.length > 120 ? `${chars.slice(0, 119).join('')}…` : chars.join('');
  });

  function isManagedRenderer(candidate: RenderAdapter | ManagedRenderer): candidate is ManagedRenderer {
    return 'schedule' in candidate && typeof candidate.schedule === 'function';
  }

  function resolveManagedRenderer(): ManagedRenderer {
    if (renderer && isManagedRenderer(renderer)) {
      return renderer;
    }
    if (ownedManaged && lastPrimaryRef === renderer) {
      return ownedManaged;
    }
    ownedManaged?.dispose();
    const adapter = renderer ?? createMathJaxSvgAdapter({ display });
    lastPrimaryRef = renderer;
    ownedManaged = createManagedRenderer({
      primary: adapter,
      debounceMs: 0,
      cacheCapacity: 64,
    });
    return ownedManaged;
  }

  function sanitizeSvgMarkup(raw: string): string {
    return raw
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }

  function setFitMode(next: FitMode): void {
    fitMode = next;
    if (next === 'actual') {
      zoomScale = 1.0;
    }
  }

  function adjustZoom(delta: number): void {
    const next = Math.min(3.0, Math.max(0.5, Number((zoomScale + delta).toFixed(2))));
    zoomScale = next;
    fitMode = 'actual';
  }

  $effect(() => {
    const currentLatex = effectiveLatex;
    const currentPreview = effectivePreviewLatex;
    const currentTheme = renderTheme;
    const explicitGen = generation;
    const currentDisplay = display;
    const managed = resolveManagedRenderer();

    internalGenCounter += 1;
    const requestGen = Math.max(explicitGen, internalGenCounter);
    const req: PreviewRenderRequest = {
      generation: requestGen,
      latex: currentLatex,
      previewLatex: currentPreview,
      theme: currentTheme,
      scale: 1.0,
      mode: 'preview',
      format: 'svg',
      display: currentDisplay,
    };

    renderPending = true;
    void managed
      .render(req)
      .then((res) => {
        if (res === null || res.generation < latestAppliedGen) {
          return;
        }
        latestAppliedGen = res.generation;
        renderResult = res;
        renderPending = false;
        onRenderResult?.(res);
      })
      .catch((err: unknown) => {
        if (requestGen < latestAppliedGen) return;
        latestAppliedGen = requestGen;
        const msg = err instanceof Error ? err.message : String(err);
        const diag = summarizeRenderError('PREVIEW_RENDER_FAILED', msg, currentPreview || currentLatex);
        const errOut: PreviewRenderResult = {
          generation: requestGen,
          backend: managed.kind,
          svg: '',
          degraded: true,
          diagnostics: [diag],
          cacheHit: false,
          errorSummary: diag,
        };
        renderResult = errOut;
        renderPending = false;
        onRenderResult?.(errOut);
      });
  });

  onDestroy(() => {
    ownedManaged?.dispose();
    ownedManaged = null;
  });
</script>

<section
  class="ms-preview-shell"
  data-testid="mathslot-preview"
  data-theme={resolvedThemeAttr}
  aria-label={ariaLabel}
>
  <header class="ms-preview-toolbar" role="toolbar" aria-label="预览缩放与导出工具栏">
    <div class="ms-preview-status">
      {#if isDegraded}
        <span class="ms-degraded-badge" data-testid="degraded-badge" role="status">
          <span class="ms-degraded-icon" aria-hidden="true">⚠</span>
          <span>降级预览</span>
        </span>
      {:else if renderPending}
        <span class="ms-status-tag" data-testid="preview-rendering">渲染中…</span>
      {:else}
        <span class="ms-status-tag" data-testid="preview-ready">实时预览</span>
      {/if}

      {#if headerSummaryText}
        <span
          class="ms-error-summary"
          data-testid="preview-error-summary"
          title={headerDiagnostic?.message ?? headerSummaryText}
        >
          {headerSummaryText}
        </span>
      {/if}
    </div>

    <div class="ms-preview-actions">
      <button
        type="button"
        class="ms-toolbar-btn"
        class:ms-toolbar-btn-active={fitMode === 'fit-to-width'}
        data-testid="fit-mode-fit"
        aria-pressed={fitMode === 'fit-to-width'}
        onclick={() => setFitMode('fit-to-width')}
      >
        适应宽度
      </button>

      <button
        type="button"
        class="ms-toolbar-btn"
        class:ms-toolbar-btn-active={fitMode === 'actual'}
        data-testid="fit-mode-actual"
        aria-pressed={fitMode === 'actual'}
        onclick={() => setFitMode('actual')}
      >
        实际大小 (100%)
      </button>

      <div class="ms-zoom-group" role="group" aria-label="缩放调节">
        <button
          type="button"
          class="ms-toolbar-btn"
          data-testid="zoom-out"
          aria-label="缩小预览"
          onclick={() => adjustZoom(-0.25)}
        >
          -
        </button>
        <span class="ms-zoom-readout" data-testid="zoom-percent" aria-live="polite">
          {fitMode === 'fit-to-width' ? `适应 · ${zoomPercent}%` : `${zoomPercent}%`}
        </span>
        <button
          type="button"
          class="ms-toolbar-btn"
          data-testid="zoom-in"
          aria-label="放大预览"
          onclick={() => adjustZoom(0.25)}
        >
          +
        </button>
      </div>

      {#if onCopyLatex}
        <button
          type="button"
          class="ms-toolbar-btn"
          data-testid="preview-copy-btn"
          onclick={() => onCopyLatex?.(effectiveLatex, snapshotDiagnostics)}
        >
          复制 LaTeX
        </button>
      {/if}

      {#if onExportLatex}
        <button
          type="button"
          class="ms-toolbar-btn"
          data-testid="preview-export-btn"
          onclick={() => onExportLatex?.(true)}
        >
          严格导出
        </button>
      {/if}
    </div>
  </header>

  <div
    class="ms-preview-viewport"
    class:ms-fit-width={fitMode === 'fit-to-width'}
    class:ms-fit-actual={fitMode === 'actual'}
    data-testid="preview-viewport"
    data-fit-mode={fitMode}
    role="region"
    aria-label="数学公式 SVG 预览区域"
  >
    {#if renderResult && renderResult.svg.trim().length > 0}
      <div
        class="ms-preview-stage"
        style={fitMode === 'actual' ? `transform: scale(${zoomScale}); transform-origin: left center;` : undefined}
      >
        {@html sanitizeSvgMarkup(renderResult.svg)}
      </div>
    {:else if effectiveLatex.trim().length === 0 && effectivePreviewLatex.trim().length === 0}
      <p class="ms-preview-empty">输入数学公式或选择左侧命令卡片开始预览</p>
    {:else}
      <p class="ms-preview-empty">暂无可显示的渲染结果</p>
    {/if}
  </div>
</section>

<style>
  .ms-preview-shell {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--ms-preview-border);
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-family: var(--ms-font-sans);
    box-shadow: var(--ms-shadow-sm);
  }

  .ms-preview-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .ms-preview-status {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
  }

  .ms-degraded-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding: 2px 8px;
    border: 1px solid var(--ms-badge-degraded-border);
    border-radius: var(--ms-radius-pill);
    background: var(--ms-badge-degraded-bg);
    color: var(--ms-badge-degraded-fg);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .ms-status-tag {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: var(--ms-radius-pill);
    background: var(--ms-surface-elevated);
    color: var(--ms-fg-muted);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .ms-error-summary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.78rem;
    color: var(--ms-status-error-fg);
    font-family: var(--ms-font-mono);
  }

  .ms-preview-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .ms-zoom-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .ms-zoom-readout {
    font-size: 0.75rem;
    font-family: var(--ms-font-mono);
    color: var(--ms-fg-muted);
    padding: 0 4px;
    white-space: nowrap;
  }

  .ms-toolbar-btn {
    flex-shrink: 0;
    padding: 4px 8px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    color: var(--ms-fg);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
  }

  .ms-toolbar-btn:hover {
    background: var(--ms-surface-elevated);
  }

  .ms-toolbar-btn:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: 1px;
  }

  .ms-toolbar-btn-active {
    border-color: var(--ms-accent);
    background: var(--ms-accent-soft);
    color: var(--ms-accent-fg);
    font-weight: 600;
  }

  .ms-preview-viewport {
    min-height: 88px;
    padding: 14px 16px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-preview-bg);
    color: var(--ms-preview-fg);
    display: flex;
    align-items: center;
  }

  .ms-preview-viewport.ms-fit-width {
    justify-content: center;
    overflow-x: hidden;
  }

  .ms-preview-viewport.ms-fit-actual {
    justify-content: flex-start;
    overflow-x: auto;
  }

  .ms-preview-viewport:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: -2px;
  }

  .ms-preview-stage {
    display: inline-block;
    max-width: 100%;
  }

  .ms-fit-actual .ms-preview-stage {
    max-width: none;
  }

  .ms-fit-width .ms-preview-stage :global(svg) {
    max-width: 100%;
    height: auto;
  }

  .ms-preview-empty {
    margin: 0;
    font-size: 0.85rem;
    color: var(--ms-fg-subtle);
  }

  @media (max-width: 480px) {
    .ms-preview-shell {
      padding: 8px;
    }

    .ms-preview-toolbar {
      flex-direction: column;
      align-items: stretch;
    }

    .ms-preview-actions {
      width: 100%;
    }

    .ms-toolbar-btn {
      min-height: 36px;
    }
  }
</style>

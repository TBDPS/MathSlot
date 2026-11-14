<script lang="ts">
  import '../theme/tokens.css';
  import type { CommandSpan, DiagnosticSnapshot, StatusSeverity } from '../client/engine';
  import { summarizeRenderError, type PreviewDiagnostic } from '../preview/renderAdapter';

  export interface DiagnosticsPanelProps {
    diagnostics?: DiagnosticSnapshot[];
    renderDiagnostics?: PreviewDiagnostic[];
    sourceLatex?: string;
    theme?: 'light' | 'dark' | 'auto';
    defaultExpanded?: boolean;
    onCopy?: (text: string) => void | Promise<void>;
    onSelectSpan?: (span: CommandSpan) => void;
  }

  let {
    diagnostics = [],
    renderDiagnostics = [],
    sourceLatex = '',
    theme = 'auto',
    defaultExpanded = false,
    onCopy,
    onSelectSpan,
  }: DiagnosticsPanelProps = $props();

  interface NormalizedDiagnosticItem {
    id: string;
    code: string;
    severity: StatusSeverity;
    summary: string;
    message: string;
    sourceExcerpt: string;
    truncated: boolean;
    detail: string;
    hint?: string;
    span?: CommandSpan | null;
  }

  const drawerId = `ms-diag-drawer-${Math.random().toString(36).slice(2, 9)}`;

  let expanded = $state(false);
  let didApplyDefaultExpanded = false;
  let copyStatus = $state<'idle' | 'copied' | 'failed'>('idle');
  let shellEl: HTMLElement | null = null;

  export function expand(): void {
    expanded = true;
    shellEl?.scrollIntoView?.({ block: 'nearest' });
  }

  $effect(() => {
    if (!didApplyDefaultExpanded) {
      expanded = defaultExpanded;
      didApplyDefaultExpanded = true;
    }
  });

  const resolvedThemeAttr = $derived(theme === 'auto' ? undefined : theme);

  const normalizedItems = $derived.by<NormalizedDiagnosticItem[]>(() => {
    const items: NormalizedDiagnosticItem[] = [];

    diagnostics.forEach((d, idx) => {
      const computed = summarizeRenderError(d.code, d.message, sourceLatex, {
        severity: d.severity,
        hint: d.hint ?? undefined,
      });
      const summary = d.summary ? summarizeRenderError('', d.summary, '').summary : computed.summary;
      const rawSource = d.source_excerpt ?? sourceLatex;
      const clampedExcerpt = summarizeRenderError(d.code, d.message, rawSource).sourceExcerpt;
      const sourceExcerpt =
        d.source_excerpt && Array.from(d.source_excerpt).length <= 200
          ? d.source_excerpt
          : clampedExcerpt;
      const truncated = d.truncated ?? (computed.truncated || Array.from(rawSource).length > 200);
      const detail = d.detail ?? computed.detail;
      items.push({
        id: `app-${d.code}-${idx}`,
        code: d.code,
        severity: d.severity,
        summary,
        message: d.message,
        sourceExcerpt,
        truncated,
        detail,
        hint: d.hint ?? undefined,
        span: d.span ?? null,
      });
    });

    renderDiagnostics.forEach((d, idx) => {
      const computed = summarizeRenderError(d.code, d.message, sourceLatex, {
        severity: d.severity,
        hint: d.hint,
      });
      items.push({
        id: `render-${d.code}-${idx}`,
        code: d.code,
        severity: d.severity,
        summary: d.summary || computed.summary,
        message: d.message,
        sourceExcerpt: d.sourceExcerpt || computed.sourceExcerpt,
        truncated: d.truncated,
        detail: d.detail || computed.detail,
        hint: d.hint,
        span: null,
      });
    });

    return items;
  });

  const primaryItem = $derived(normalizedItems[0] ?? null);

  const headerSummary = $derived.by(() => {
    if (!primaryItem) return '无诊断问题';
    const raw = primaryItem.summary.replace(/[\r\n]+/g, ' ').trim();
    const chars = Array.from(raw);
    return chars.length > 120 ? `${chars.slice(0, 119).join('')}…` : raw;
  });

  function severityLabel(severity: StatusSeverity): string {
    switch (severity) {
      case 'Error':
        return '错误';
      case 'Warning':
        return '警告';
      case 'Info':
        return '提示';
    }
  }

  function buildCopyPayload(): string {
    return normalizedItems
      .map((item, index) => {
        const lines = [
          `#${index + 1} [${item.code}] (${severityLabel(item.severity)})`,
          `摘要: ${item.summary}`,
          `详情: ${item.detail}`,
        ];
        if (item.hint) {
          lines.push(`建议: ${item.hint}`);
        }
        return lines.join('\n');
      })
      .join('\n\n---\n\n');
  }

  async function handleCopy(): Promise<void> {
    if (normalizedItems.length === 0) return;
    const payload = buildCopyPayload();
    try {
      if (onCopy) {
        await onCopy(payload);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        throw new Error('Clipboard unavailable');
      }
      copyStatus = 'copied';
    } catch {
      copyStatus = 'failed';
    }
  }
</script>

<section
  bind:this={shellEl}
  class="ms-diag-shell"
  data-testid="mathslot-diagnostics"
  data-theme={resolvedThemeAttr}
  aria-label="错误与诊断面板"
>
  <header class="ms-diag-header">
    <div class="ms-diag-summary-row">
      {#if primaryItem}
        <span
          class="ms-diag-severity"
          data-severity={primaryItem.severity.toLowerCase()}
        >
          {severityLabel(primaryItem.severity)}
        </span>
        <span class="ms-diag-code" data-testid="diagnostics-header-code">
          {primaryItem.code}
        </span>
      {:else}
        <span class="ms-diag-severity" data-severity="info">正常</span>
      {/if}

      <span class="ms-diag-header-summary" data-testid="diagnostics-header-summary">
        {headerSummary}
      </span>

      {#if normalizedItems.length > 1}
        <span class="ms-diag-count" aria-label={`共 ${normalizedItems.length} 条诊断`}>
          +{normalizedItems.length - 1}
        </span>
      {/if}
    </div>

    <div class="ms-diag-actions">
      <button
        type="button"
        class="ms-diag-btn"
        data-testid="copy-diagnostics-btn"
        disabled={normalizedItems.length === 0}
        onclick={() => void handleCopy()}
      >
        复制诊断信息
      </button>

      {#if copyStatus === 'copied'}
        <span class="ms-copy-feedback" role="status" aria-live="polite">已复制诊断信息</span>
      {:else if copyStatus === 'failed'}
        <span class="ms-copy-feedback ms-copy-failed" role="status" aria-live="polite">复制失败</span>
      {/if}

      <button
        type="button"
        class="ms-diag-btn"
        data-testid="diagnostics-toggle"
        aria-expanded={expanded}
        aria-controls={drawerId}
        onclick={() => {
          expanded = !expanded;
        }}
      >
        {expanded ? '收起详情' : '展开详情'}
      </button>
    </div>
  </header>

  {#if expanded}
    <div
      id={drawerId}
      class="ms-diag-drawer"
      role="region"
      aria-live="polite"
      aria-label="诊断与错误详情"
    >
      {#if normalizedItems.length === 0}
        <p class="ms-diag-empty">当前没有待处理错误或诊断信息。</p>
      {:else}
        <ul class="ms-diag-list">
          {#each normalizedItems as item (item.id)}
            <li class="ms-diag-card" data-severity={item.severity.toLowerCase()}>
              <div class="ms-diag-card-top">
                <span class="ms-diag-severity" data-severity={item.severity.toLowerCase()}>
                  {severityLabel(item.severity)}
                </span>
                <span class="ms-diag-code">{item.code}</span>
                {#if item.span && onSelectSpan}
                  <button
                    type="button"
                    class="ms-diag-btn ms-diag-locate"
                    onclick={() => onSelectSpan?.(item.span!)}
                  >
                    定位 ({item.span.start}:{item.span.end})
                  </button>
                {/if}
              </div>

              <p class="ms-diag-detail-text">{item.detail}</p>

              {#if item.sourceExcerpt.length > 0}
                <div class="ms-diag-excerpt-box">
                  <div class="ms-diag-excerpt-label">
                    <span>源码片段</span>
                    {#if item.truncated}
                      <span class="ms-truncated-badge" data-testid="diagnostic-truncated-badge">
                        已截断
                      </span>
                    {/if}
                  </div>
                  <code class="ms-diag-excerpt-code" data-testid="diagnostic-source-excerpt">
                    {item.sourceExcerpt}
                  </code>
                </div>
              {/if}

              {#if item.hint}
                <p class="ms-diag-hint">建议：{item.hint}</p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .ms-diag-shell {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-md);
    background: var(--ms-surface);
    color: var(--ms-fg);
    font-family: var(--ms-font-sans);
    box-shadow: var(--ms-shadow-sm);
  }

  .ms-diag-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .ms-diag-summary-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
  }

  .ms-diag-header-summary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.82rem;
    color: var(--ms-fg);
  }

  .ms-diag-count {
    flex-shrink: 0;
    font-size: 0.72rem;
    font-family: var(--ms-font-mono);
    padding: 1px 6px;
    border-radius: var(--ms-radius-pill);
    background: var(--ms-surface-muted);
    color: var(--ms-fg-muted);
  }

  .ms-diag-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .ms-diag-btn {
    flex-shrink: 0;
    padding: 4px 8px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface-elevated);
    color: var(--ms-fg);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
  }

  .ms-diag-btn:hover:not(:disabled) {
    background: var(--ms-surface-muted);
  }

  .ms-diag-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .ms-diag-btn:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: 1px;
  }

  .ms-copy-feedback {
    font-size: 0.75rem;
    color: var(--ms-status-info-fg);
    white-space: nowrap;
  }

  .ms-copy-failed {
    color: var(--ms-status-error-fg);
  }

  .ms-diag-severity {
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: var(--ms-radius-sm);
    font-size: 0.72rem;
    font-weight: 600;
    background: var(--ms-status-info-bg);
    color: var(--ms-status-info-fg);
    border: 1px solid var(--ms-status-info-border);
  }

  .ms-diag-severity[data-severity='warning'] {
    background: var(--ms-status-warn-bg);
    color: var(--ms-status-warn-fg);
    border-color: var(--ms-status-warn-border);
  }

  .ms-diag-severity[data-severity='error'] {
    background: var(--ms-status-error-bg);
    color: var(--ms-status-error-fg);
    border-color: var(--ms-status-error-border);
  }

  .ms-diag-code {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: var(--ms-radius-sm);
    background: var(--ms-diag-code-bg);
    color: var(--ms-diag-code-fg);
    font-family: var(--ms-font-mono);
    font-size: 0.72rem;
  }

  .ms-diag-drawer {
    border-top: 1px solid var(--ms-border);
    padding-top: 8px;
  }

  .ms-diag-empty {
    margin: 0;
    font-size: 0.82rem;
    color: var(--ms-fg-subtle);
  }

  .ms-diag-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ms-diag-card {
    padding: 8px 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface-elevated);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ms-diag-card-top {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .ms-diag-detail-text {
    margin: 0;
    font-size: 0.8rem;
    color: var(--ms-fg);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .ms-diag-excerpt-box {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
  }

  .ms-diag-excerpt-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.72rem;
    color: var(--ms-fg-muted);
  }

  .ms-truncated-badge {
    padding: 1px 5px;
    border-radius: var(--ms-radius-sm);
    background: var(--ms-status-warn-bg);
    color: var(--ms-status-warn-fg);
    border: 1px solid var(--ms-status-warn-border);
    font-weight: 600;
  }

  .ms-diag-excerpt-code {
    font-family: var(--ms-font-mono);
    font-size: 0.75rem;
    color: var(--ms-fg);
    word-break: break-all;
  }

  .ms-diag-hint {
    margin: 0;
    font-size: 0.78rem;
    color: var(--ms-fg-muted);
  }

  @media (max-width: 480px) {
    .ms-diag-header {
      flex-direction: column;
      align-items: stretch;
    }

    .ms-diag-actions {
      flex-wrap: wrap;
    }

    .ms-diag-btn {
      min-height: 36px;
    }
  }
</style>

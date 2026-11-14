<script lang="ts">
  import type {
    DispatchResponse,
    EngineClient,
    ImportReportSnapshot,
    ThemePreference,
  } from '../client/engine';
  import { computeLatexDiff } from './diff';

  export interface ImportModalProps {
    open?: boolean;
    client: EngineClient;
    lastImport?: ImportReportSnapshot | null;
    initialLatex?: string;
    theme?: ThemePreference;
    onPreviewed?: (response: DispatchResponse) => void;
    onImported?: (response: DispatchResponse) => void;
    onClose?: () => void;
  }

  let {
    open = true,
    client,
    lastImport = null,
    initialLatex = '',
    theme = 'system',
    onPreviewed,
    onImported,
    onClose,
  }: ImportModalProps = $props();

  let inputLatex = $state('');
  let localReport = $state<ImportReportSnapshot | null>(null);
  let previewedLatex = $state<string | null>(null);
  let busy = $state(false);
  let submitError = $state<string | null>(null);

  $effect(() => {
    inputLatex = initialLatex;
    previewedLatex = null;
    localReport = null;
    submitError = null;
  });

  const activeReport = $derived(localReport ?? lastImport ?? null);
  const resolvedThemeAttr = $derived(theme === 'system' ? undefined : theme);
  const hasRawNodes = $derived(activeReport !== null && activeReport.raw_nodes > 0);
  const isDegraded = $derived(
    activeReport !== null && !activeReport.blocked && hasRawNodes,
  );
  const previewStale = $derived.by(() => {
    if (!activeReport) return false;
    const expectedInput = previewedLatex ?? activeReport.input_latex;
    if (expectedInput === undefined) return false;
    return expectedInput !== inputLatex;
  });
  const diffResult = $derived.by(() => {
    if (!activeReport) return null;
    const baselineInput = activeReport.input_latex ?? previewedLatex ?? inputLatex;
    return computeLatexDiff(baselineInput, activeReport.roundtrip_latex ?? '');
  });

  async function handlePreview() {
    if (busy) return;
    busy = true;
    submitError = null;
    try {
      const response = await client.dispatch({ PreviewImportLatex: inputLatex });
      localReport = response.snapshot.last_import ?? null;
      previewedLatex = inputLatex;
      onPreviewed?.(response);
    } catch (err) {
      submitError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function handleApply() {
    if (busy || !activeReport || activeReport.blocked || previewStale) return;
    busy = true;
    submitError = null;
    try {
      const response = await client.dispatch({ ImportLatex: inputLatex });
      localReport = response.snapshot.last_import ?? null;
      onImported?.(response);
      if (!response.snapshot.last_import?.blocked) {
        onClose?.();
      }
    } catch (err) {
      submitError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function handleAcknowledge() {
    if (busy) return;
    busy = true;
    submitError = null;
    try {
      const response = await client.dispatch('ImportAcknowledge');
      localReport = response.snapshot.last_import ?? null;
      previewedLatex = null;
      onPreviewed?.(response);
    } catch (err) {
      submitError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function handleCancel() {
    if (busy) return;
    if (activeReport) {
      localReport = null;
      previewedLatex = null;
      void client
        .dispatch('ImportAcknowledge')
        .then((response) => {
          onPreviewed?.(response);
        })
        .catch(() => {
          // Ignore acknowledge errors when dismissing the modal cleanly.
        });
    }
    onClose?.();
  }
</script>

{#if open}
  <div
    class="ms-import-modal"
    data-testid="import-modal"
    data-theme={resolvedThemeAttr}
    role="dialog"
    aria-modal="true"
    aria-label="导入 LaTeX 公式"
  >
    <header class="ms-import-header">
      <div class="ms-import-title-group">
        <h2 class="ms-import-title">导入 LaTeX 公式</h2>
        <p class="ms-import-subtitle">
          第一步先解析并审阅结构化 Diff 与诊断；确认无误后再写入编辑器（支持 Ctrl+Z 一步撤回），存在语法错误时禁用确认按钮。
        </p>
      </div>
      {#if onClose}
        <button
          type="button"
          class="ms-import-btn ms-import-btn-ghost"
          data-testid="import-close-btn"
          onclick={() => void handleCancel()}
        >
          关闭
        </button>
      {/if}
    </header>

    <div class="ms-import-input-group">
      <label class="ms-import-label" for="ms-import-latex-textarea">LaTeX 源码</label>
      <textarea
        id="ms-import-latex-textarea"
        class="ms-import-textarea"
        data-testid="import-latex-input"
        aria-label="输入或粘贴 LaTeX 公式"
        rows="3"
        bind:value={inputLatex}
        placeholder="例如：\frac&#123;\sin x&#125;&#123;x&#125; = 1"
      ></textarea>
    </div>

    <div class="ms-import-actions">
      <button
        type="button"
        class="ms-import-btn ms-import-btn-primary"
        data-testid="import-submit-btn"
        disabled={busy}
        onclick={() => void handlePreview()}
      >
        {busy ? '正在解析…' : '解析并预览'}
      </button>

      {#if activeReport}
        <button
          type="button"
          class="ms-import-btn ms-import-btn-apply"
          data-testid="import-apply-btn"
          disabled={busy || activeReport.blocked || previewStale}
          onclick={() => void handleApply()}
        >
          确认导入
        </button>
      {/if}

      <button
        type="button"
        class="ms-import-btn"
        data-testid="import-cancel-btn"
        disabled={busy}
        onclick={() => void handleCancel()}
      >
        取消
      </button>

      {#if activeReport}
        <button
          type="button"
          class="ms-import-btn ms-import-btn-ghost"
          data-testid="import-ack-btn"
          disabled={busy}
          onclick={() => void handleAcknowledge()}
        >
          清除报告
        </button>
      {/if}
    </div>

    {#if submitError}
      <div class="ms-import-banner ms-import-banner-error" role="alert" data-testid="import-submit-error">
        <strong>导入请求失败：</strong>{submitError}
      </div>
    {/if}

    {#if activeReport}
      <section class="ms-import-report" data-testid="import-report" aria-label="LaTeX 导入诊断报告">
        {#if activeReport.blocked}
          <div class="ms-import-banner ms-import-banner-error" role="alert" data-testid="import-blocked-banner">
            <strong>导入已阻断：</strong>检测到语法错误，当前编辑器文档与公式未被覆盖，请修正后重新预览。
          </div>
        {:else if previewStale}
          <div class="ms-import-banner ms-import-banner-warn" role="status" data-testid="import-stale-banner">
            <strong>输入已修改：</strong>请重新点击「解析并预览」刷新 Diff 后再确认导入。
          </div>
        {:else if isDegraded}
          <div class="ms-import-banner ms-import-banner-warn" role="status" data-testid="import-lossy-banner">
            <span class="ms-import-degraded-badge" data-testid="import-degraded-badge">降级 RawLatex</span>
            <strong>有损转换预警：</strong>包含 {activeReport.raw_nodes} 个未识别或不支持节点，将在保留原始 LaTeX 后写入。
          </div>
        {:else if !activeReport.lossless}
          <div class="ms-import-banner ms-import-banner-warn" role="status" data-testid="import-nonlossless-banner">
            <strong>结构化改写提示：</strong>输出与原始输入存在差异，请审阅下方 Diff 后再确认导入。
          </div>
        {:else}
          <div class="ms-import-banner ms-import-banner-ok" role="status" data-testid="import-lossless-banner">
            <strong>无损解析就绪：</strong>可安全确认导入为结构化 AST（支持一步撤回）。
          </div>
        {/if}

        <dl class="ms-import-metrics">
          <div class="ms-import-metric">
            <dt>无损转换 (lossless)</dt>
            <dd>{activeReport.lossless ? '是' : '否'}</dd>
          </div>
          <div class="ms-import-metric">
            <dt>空槽位 (empty_slots)</dt>
            <dd>{activeReport.empty_slots}</dd>
          </div>
          <div class="ms-import-metric">
            <dt>原始节点 (raw_nodes)</dt>
            <dd>{activeReport.raw_nodes}</dd>
          </div>
          <div class="ms-import-metric">
            <dt>归一化一致 (normalized_match)</dt>
            <dd>{activeReport.normalized_match ? '是' : '否'}</dd>
          </div>
        </dl>

        {#if diffResult}
          <div class="ms-import-diff-panel" data-testid="import-diff-view" aria-label="导入前后差异对比">
            <div class="ms-import-diff-header">
              <span class="ms-import-label">输入与规范回环差异对比 (Diff)</span>
              {#if activeReport.blocked}
                <span class="ms-import-diff-pill ms-import-diff-pill-error" data-testid="import-diff-pill">
                  {hasRawNodes ? `语法错误已阻断 · 含 ${activeReport.raw_nodes} RawLatex` : '语法错误已阻断'}
                </span>
              {:else if hasRawNodes}
                <span class="ms-import-diff-pill ms-import-diff-pill-warn" data-testid="import-diff-pill">RawLatex 降级</span>
              {:else if diffResult.changed}
                <span class="ms-import-diff-pill ms-import-diff-pill-info" data-testid="import-diff-pill">已归一化</span>
              {:else}
                <span class="ms-import-diff-pill ms-import-diff-pill-ok" data-testid="import-diff-pill">完全一致</span>
              {/if}
            </div>
            <div class="ms-import-diff-grid">
              <div class="ms-import-diff-pane">
                <span class="ms-import-diff-caption">原始粘贴输入</span>
                <pre class="ms-import-diff-pre" data-testid="import-diff-input">{#each diffResult.inputSegments as seg, i (`in-${i}`)}<span class="ms-diff-seg" data-diff={seg.kind}>{seg.text}</span>{/each}</pre>
              </div>
              <div class="ms-import-diff-pane">
                <span class="ms-import-diff-caption">解析回环输出 (roundtrip)</span>
                <pre class="ms-import-diff-pre" data-testid="import-diff-roundtrip">{#each diffResult.outputSegments as seg, i (`out-${i}`)}<span class="ms-diff-seg" data-diff={seg.kind}>{seg.text}</span>{/each}</pre>
              </div>
            </div>
          </div>
        {/if}

        {#if activeReport.roundtrip_latex}
          <div class="ms-import-roundtrip">
            <span class="ms-import-label">规范回环输出 (roundtrip_latex)</span>
            <code class="ms-import-code" data-testid="import-roundtrip-latex">
              {activeReport.roundtrip_latex}
            </code>
          </div>
        {/if}

        {#if activeReport.diagnostics.length > 0}
          <ul class="ms-import-diags" data-testid="import-diagnostics-list" aria-label="导入诊断明细">
            {#each activeReport.diagnostics as diag, idx (`${diag.code}-${idx}`)}
              <li class="ms-import-diag-item" data-severity={diag.severity.toLowerCase()}>
                <div class="ms-import-diag-head">
                  <span class="ms-import-diag-badge">{diag.severity}</span>
                  <code class="ms-import-diag-code">{diag.code}</code>
                  <span class="ms-import-diag-msg">{diag.message}</span>
                </div>
                {#if diag.source_excerpt}
                  <code class="ms-import-diag-excerpt">{diag.source_excerpt}</code>
                {/if}
                {#if diag.hint}
                  <p class="ms-import-diag-hint">建议：{diag.hint}</p>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  </div>
{/if}

<style>
  .ms-import-modal {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-family: var(--ms-font-sans);
    box-shadow: var(--ms-shadow-sm);
  }

  .ms-import-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }

  .ms-import-title-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .ms-import-title {
    margin: 0;
    font-size: 0.96rem;
    font-weight: 700;
  }

  .ms-import-subtitle {
    margin: 0;
    font-size: 0.78rem;
    color: var(--ms-fg-muted);
    line-height: 1.4;
  }

  .ms-import-input-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ms-import-label {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--ms-fg-muted);
  }

  .ms-import-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--ms-border-strong);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface-elevated);
    color: var(--ms-fg);
    font-family: var(--ms-font-mono);
    font-size: 0.84rem;
    resize: vertical;
  }

  .ms-import-textarea:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: 1px;
  }

  .ms-import-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .ms-import-btn {
    border: 1px solid var(--ms-border-strong);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    color: var(--ms-fg);
    font-size: 0.8rem;
    font-weight: 600;
    padding: 6px 12px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .ms-import-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .ms-import-btn:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: 1px;
  }

  .ms-import-btn-primary {
    border-color: var(--ms-accent);
    background: var(--ms-accent);
    color: var(--ms-accent-contrast);
  }

  .ms-import-btn-apply {
    border-color: var(--ms-status-success-border);
    background: var(--ms-status-success-bg);
    color: var(--ms-status-success-fg);
  }

  .ms-import-btn-ghost {
    background: transparent;
  }

  .ms-import-banner {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 10px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-border);
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .ms-import-banner-ok {
    border-color: var(--ms-status-success-border);
    background: var(--ms-status-success-bg);
    color: var(--ms-status-success-fg);
  }

  .ms-import-banner-warn {
    border-color: var(--ms-status-warn-border);
    background: var(--ms-status-warn-bg);
    color: var(--ms-status-warn-fg);
  }

  .ms-import-banner-error {
    border-color: var(--ms-status-error-border);
    background: var(--ms-status-error-bg);
    color: var(--ms-status-error-fg);
  }

  .ms-import-degraded-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-badge-degraded-border);
    background: var(--ms-badge-degraded-bg);
    color: var(--ms-badge-degraded-fg);
    font-size: 0.72rem;
    font-weight: 700;
  }

  .ms-import-report {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .ms-import-metrics {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .ms-import-metric {
    padding: 6px 8px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-border);
    background: var(--ms-surface);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 0.76rem;
  }

  .ms-import-metric dt {
    color: var(--ms-fg-muted);
  }

  .ms-import-metric dd {
    margin: 0;
    font-family: var(--ms-font-mono);
    font-weight: 700;
    color: var(--ms-fg);
  }

  .ms-import-diff-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
  }

  .ms-import-diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .ms-import-diff-pill {
    padding: 1px 6px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-border);
    font-size: 0.7rem;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .ms-import-diff-pill-error {
    border-color: var(--ms-status-error-border);
    background: var(--ms-status-error-bg);
    color: var(--ms-status-error-fg);
  }

  .ms-import-diff-pill-ok {
    border-color: var(--ms-status-success-border);
    background: var(--ms-status-success-bg);
    color: var(--ms-status-success-fg);
  }

  .ms-import-diff-pill-info {
    border-color: var(--ms-status-info-border);
    background: var(--ms-status-info-bg);
    color: var(--ms-status-info-fg);
  }

  .ms-import-diff-pill-warn {
    border-color: var(--ms-badge-degraded-border);
    background: var(--ms-badge-degraded-bg);
    color: var(--ms-badge-degraded-fg);
  }

  .ms-import-diff-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .ms-import-diff-pane {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .ms-import-diff-caption {
    font-size: 0.72rem;
    color: var(--ms-fg-subtle);
  }

  .ms-import-diff-pre {
    margin: 0;
    padding: 6px 8px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-border);
    background: var(--ms-surface-elevated);
    font-family: var(--ms-font-mono);
    font-size: 0.78rem;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.45;
  }

  .ms-diff-seg[data-diff='removed'] {
    background: var(--ms-status-error-bg);
    color: var(--ms-status-error-fg);
    text-decoration: line-through;
    border-radius: 2px;
    padding: 0 2px;
  }

  .ms-diff-seg[data-diff='added'] {
    background: var(--ms-status-success-bg);
    color: var(--ms-status-success-fg);
    border-radius: 2px;
    padding: 0 2px;
  }

  .ms-import-roundtrip {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ms-import-code {
    display: block;
    padding: 8px 10px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-border);
    background: var(--ms-surface-elevated);
    font-family: var(--ms-font-mono);
    font-size: 0.8rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .ms-import-diags {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ms-import-diag-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-status-warn-border);
    background: var(--ms-status-warn-bg);
    color: var(--ms-status-warn-fg);
    font-size: 0.78rem;
  }

  .ms-import-diag-item[data-severity='info'] {
    border-color: var(--ms-status-info-border);
    background: var(--ms-status-info-bg);
    color: var(--ms-status-info-fg);
  }

  .ms-import-diag-item[data-severity='error'] {
    border-color: var(--ms-status-error-border);
    background: var(--ms-status-error-bg);
    color: var(--ms-status-error-fg);
  }

  .ms-import-diag-head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .ms-import-diag-badge {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .ms-import-diag-code {
    padding: 1px 5px;
    border-radius: var(--ms-radius-sm);
    background: var(--ms-diag-code-bg);
    color: var(--ms-diag-code-fg);
    font-family: var(--ms-font-mono);
    font-size: 0.72rem;
  }

  .ms-import-diag-msg {
    font-weight: 500;
  }

  .ms-import-diag-excerpt {
    font-family: var(--ms-font-mono);
    font-size: 0.72rem;
    color: var(--ms-fg-muted);
    word-break: break-all;
  }

  .ms-import-diag-hint {
    margin: 0;
    font-size: 0.74rem;
    color: var(--ms-fg-muted);
  }

  @media (max-width: 480px) {
    .ms-import-modal {
      padding: 10px;
    }

    .ms-import-header {
      flex-direction: column;
    }

    .ms-import-actions {
      flex-direction: column;
      align-items: stretch;
    }

    .ms-import-btn {
      min-height: 36px;
      width: 100%;
    }

    .ms-import-metrics,
    .ms-import-diff-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

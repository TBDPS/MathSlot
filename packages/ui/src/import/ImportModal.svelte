<script lang="ts">
  import type {
    DispatchResponse,
    EngineClient,
    ImportReportSnapshot,
    ThemePreference,
  } from '../client/engine';

  export interface ImportModalProps {
    open?: boolean;
    client: EngineClient;
    lastImport?: ImportReportSnapshot | null;
    initialLatex?: string;
    theme?: ThemePreference;
    onImported?: (response: DispatchResponse) => void;
    onClose?: () => void;
  }

  let {
    open = true,
    client,
    lastImport = null,
    initialLatex = '',
    theme = 'system',
    onImported,
    onClose,
  }: ImportModalProps = $props();

  let inputLatex = $state('');
  let localReport = $state<ImportReportSnapshot | null>(null);
  let busy = $state(false);
  let submitError = $state<string | null>(null);

  $effect(() => {
    inputLatex = initialLatex;
  });

  const activeReport = $derived(localReport ?? lastImport ?? null);
  const resolvedThemeAttr = $derived(theme === 'system' ? undefined : theme);

  async function handleSubmit() {
    if (busy) return;
    busy = true;
    submitError = null;
    try {
      const response = await client.dispatch({ ImportLatex: inputLatex });
      localReport = response.snapshot.last_import ?? null;
      onImported?.(response);
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
      onImported?.(response);
    } catch (err) {
      submitError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function handleClose() {
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
          输入或粘贴 LaTeX 源码，经统一语法解析器校验无误后再写入编辑器；存在语法错误时自动阻断覆写。
        </p>
      </div>
      {#if onClose}
        <button
          type="button"
          class="ms-import-btn ms-import-btn-ghost"
          data-testid="import-close-btn"
          onclick={handleClose}
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
        rows="4"
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
        onclick={() => void handleSubmit()}
      >
        {busy ? '正在解析…' : '解析并导入'}
      </button>

      {#if activeReport}
        <button
          type="button"
          class="ms-import-btn"
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
            <strong>导入已阻断：</strong>检测到语法错误，当前编辑器文档与公式未被覆盖。
          </div>
        {:else if !activeReport.lossless}
          <div class="ms-import-banner ms-import-banner-warn" role="status" data-testid="import-lossy-banner">
            <strong>有损导入完成：</strong>存在 {activeReport.raw_nodes} 个未识别或原始降级节点，已安全导入并保留结构。
          </div>
        {:else}
          <div class="ms-import-banner ms-import-banner-ok" role="status" data-testid="import-lossless-banner">
            <strong>无损导入完成：</strong>已完整解析为结构化 AST。
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
    gap: 12px;
    padding: 14px;
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
    color: var(--ms-fg);
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
    background: var(--ms-surface);
    color: var(--ms-fg);
    font-family: var(--ms-font-mono);
    font-size: 0.84rem;
    line-height: 1.45;
    resize: vertical;
  }

  .ms-import-textarea:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: 1px;
  }

  .ms-import-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .ms-import-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
    border: 1px solid var(--ms-border-strong);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    color: var(--ms-fg);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .ms-import-btn:hover:not(:disabled) {
    background: var(--ms-surface-elevated);
  }

  .ms-import-btn:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: 2px;
  }

  .ms-import-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .ms-import-btn-primary {
    border-color: var(--ms-accent);
    background: var(--ms-accent);
    color: var(--ms-accent-contrast);
  }

  .ms-import-btn-primary:hover:not(:disabled) {
    background: var(--ms-accent-hover);
  }

  .ms-import-btn-ghost {
    border-color: transparent;
    background: transparent;
    color: var(--ms-fg-muted);
  }

  .ms-import-report {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--ms-border);
  }

  .ms-import-banner {
    padding: 8px 10px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-border);
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .ms-import-banner-error {
    background: var(--ms-status-error-bg);
    border-color: var(--ms-status-error-border);
    color: var(--ms-status-error-fg);
  }

  .ms-import-banner-warn {
    background: var(--ms-status-warn-bg);
    border-color: var(--ms-status-warn-border);
    color: var(--ms-status-warn-fg);
  }

  .ms-import-banner-ok {
    background: var(--ms-status-success-bg);
    border-color: var(--ms-status-success-border);
    color: var(--ms-status-success-fg);
  }

  .ms-import-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 8px;
    margin: 0;
  }

  .ms-import-metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
  }

  .ms-import-metric dt {
    font-size: 0.7rem;
    color: var(--ms-fg-muted);
  }

  .ms-import-metric dd {
    margin: 0;
    font-family: var(--ms-font-mono);
    font-size: 0.84rem;
    font-weight: 700;
    color: var(--ms-fg);
  }

  .ms-import-roundtrip {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ms-import-code {
    padding: 6px 8px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    color: var(--ms-fg);
    font-family: var(--ms-font-mono);
    font-size: 0.78rem;
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

    .ms-import-metrics {
      grid-template-columns: 1fr;
    }
  }
</style>

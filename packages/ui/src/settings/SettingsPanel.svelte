<script lang="ts">
  import { untrack } from 'svelte';
  import '../theme/tokens.css';
  import {
    createDefaultAppSettings,
    formatLatexWithDelimiter,
    type AppSettings,
    type DelimiterStyle,
    type EngineClient,
    type RecoveryStateSnapshot,
    type RenderBackendPreference,
    type ThemePreference,
  } from '../client/engine';
  import {
    SHORTCUT_ACTIONS,
    formatKeyboardEventToShortcut,
    validateShortcuts,
    type ShortcutActionId,
  } from './shortcuts';

  export interface SettingsPanelProps {
    settings?: AppSettings;
    recovery?: RecoveryStateSnapshot | null;
    client?: EngineClient;
    theme?: 'light' | 'dark' | 'auto';
    sampleLatex?: string;
    supportedBackends?: RenderBackendPreference[];
    ariaLabel?: string;
    onSaveSettings?: (next: AppSettings) => void | Promise<void>;
    onResetDefaults?: (defaults: AppSettings) => void | Promise<void>;
    onImportConfig?: () => void | Promise<void>;
    onExportConfig?: () => void | Promise<void>;
    onRestoreBackup?: (backupPath: string | null) => void | Promise<void>;
    onConfirmResetEmpty?: () => void | Promise<void>;
    onClose?: () => void;
  }

  let {
    settings = createDefaultAppSettings(),
    recovery = null,
    client,
    theme,
    sampleLatex = '\\frac{a + b}{c}',
    supportedBackends = ['mathjax', 'latex-rust'],
    ariaLabel = 'MathSlot 设置面板',
    onSaveSettings,
    onResetDefaults,
    onImportConfig,
    onExportConfig,
    onRestoreBackup,
    onConfirmResetEmpty,
    onClose,
  }: SettingsPanelProps = $props();

  function cloneSettings(src: AppSettings): AppSettings {
    return {
      theme: src.theme,
      delimiter_style: src.delimiter_style,
      render_backend: src.render_backend,
      shortcuts: { ...src.shortcuts },
      config_path: src.config_path ?? null,
      preview_scale_pct: src.preview_scale_pct ?? null,
    };
  }

  let draft = $state<AppSettings>(createDefaultAppSettings());
  let lastSyncedPropSnapshot = $state('');

  let confirmingResetDefaults = $state(false);
  let confirmingResetEmpty = $state(false);
  let capturingAction = $state<ShortcutActionId | null>(null);
  let saveFeedback = $state<'idle' | 'saving' | 'saved' | 'blocked' | 'error'>('idle');
  let saveErrorMessage = $state<string | null>(null);

  $effect.pre(() => {
    const incomingJson = JSON.stringify(settings);
    if (incomingJson !== untrack(() => lastSyncedPropSnapshot)) {
      lastSyncedPropSnapshot = incomingJson;
      draft = cloneSettings(settings);
      saveFeedback = 'idle';
      saveErrorMessage = null;
    }
  });

  const resolvedThemeAttr = $derived.by<'light' | 'dark' | undefined>(() => {
    if (theme === 'light' || theme === 'dark') {
      return theme;
    }
    if (theme === 'auto') {
      return undefined;
    }
    if (draft.theme === 'light' || draft.theme === 'dark') {
      return draft.theme;
    }
    return undefined;
  });

  const shortcutValidation = $derived(validateShortcuts(draft.shortcuts));
  const isDirty = $derived(JSON.stringify(draft) !== lastSyncedPropSnapshot);
  const delimiterPreviewText = $derived(
    formatLatexWithDelimiter(sampleLatex, draft.delimiter_style),
  );

  const THEME_OPTIONS: ReadonlyArray<{
    value: ThemePreference;
    label: string;
    hint: string;
  }> = [
    { value: 'light', label: '浅色', hint: '高对比日间纸面配色' },
    { value: 'dark', label: '深色', hint: '低眩光夜间专注配色' },
    { value: 'system', label: '跟随系统', hint: '自动响应 OS 明暗偏好' },
  ];

  const DELIMITER_OPTIONS: ReadonlyArray<{
    value: DelimiterStyle;
    label: string;
    badge: string;
  }> = [
    { value: 'none', label: '无定界符', badge: '纯 LaTeX' },
    { value: 'inline_dollar', label: '行内公式', badge: '$...$' },
    { value: 'block_dollar', label: '块级公式', badge: '$$...$$' },
    { value: 'code_fence', label: '代码块', badge: '```latex' },
  ];

  const BACKEND_OPTIONS: ReadonlyArray<{
    value: RenderBackendPreference;
    label: string;
    detail: string;
  }> = [
    {
      value: 'mathjax',
      label: 'MathJax 3 SVG',
      detail: '高精度完整 LaTeX 排版（默认）',
    },
    {
      value: 'latex-rust',
      label: 'latex-rust 离线渲染',
      detail: '零 JS 依赖的快速离线 SVG',
    },
  ];

  const visibleBackendOptions = $derived(
    BACKEND_OPTIONS.filter((opt) => supportedBackends.includes(opt.value)),
  );
  const obsidianHostBackendOnly = $derived(
    supportedBackends.length === 1 && supportedBackends[0] === 'mathjax',
  );
  const effectivePreviewScalePct = $derived(
    typeof draft.preview_scale_pct === 'number' && Number.isFinite(draft.preview_scale_pct)
      ? Math.min(200, Math.max(75, Math.round(draft.preview_scale_pct)))
      : 100,
  );

  function updateTheme(next: ThemePreference): void {
    draft.theme = next;
    saveFeedback = 'idle';
  }

  function updateDelimiter(next: DelimiterStyle): void {
    draft.delimiter_style = next;
    saveFeedback = 'idle';
  }

  function updateBackend(next: RenderBackendPreference): void {
    draft.render_backend = next;
    saveFeedback = 'idle';
  }

  function updatePreviewScalePct(rawValue: number): void {
    if (!Number.isFinite(rawValue)) return;
    const clamped = Math.min(200, Math.max(75, Math.round(rawValue)));
    draft.preview_scale_pct = clamped;
    saveFeedback = 'idle';
  }

  function updateShortcutValue(id: ShortcutActionId, value: string): void {
    draft.shortcuts = {
      ...draft.shortcuts,
      [id]: value,
    };
    saveFeedback = 'idle';
  }

  function handleShortcutKeyCapture(id: ShortcutActionId, event: KeyboardEvent): void {
    if (capturingAction !== id) {
      return;
    }
    if (event.key === 'Tab') {
      capturingAction = null;
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      capturingAction = null;
      return;
    }
    const formatted = formatKeyboardEventToShortcut(event);
    if (formatted) {
      event.preventDefault();
      updateShortcutValue(id, formatted);
      capturingAction = null;
    }
  }

  async function handleSave(): Promise<void> {
    if (!shortcutValidation.valid) {
      saveFeedback = 'blocked';
      saveErrorMessage = null;
      return;
    }
    const normalizedPayload: AppSettings = {
      ...cloneSettings(draft),
      shortcuts: { ...shortcutValidation.normalized },
    };
    saveFeedback = 'saving';
    saveErrorMessage = null;
    try {
      if (onSaveSettings) {
        await onSaveSettings(normalizedPayload);
      } else if (client) {
        await client.dispatch({ UpdateSettings: normalizedPayload });
      }
      draft = cloneSettings(normalizedPayload);
      lastSyncedPropSnapshot = JSON.stringify(normalizedPayload);
      saveFeedback = 'saved';
    } catch (err) {
      saveFeedback = 'error';
      saveErrorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleConfirmResetDefaults(): Promise<void> {
    const defaults: AppSettings = {
      ...createDefaultAppSettings(),
      config_path: draft.config_path ?? null,
    };
    saveFeedback = 'saving';
    saveErrorMessage = null;
    try {
      if (onResetDefaults) {
        await onResetDefaults(defaults);
      } else if (client) {
        await client.dispatch('ResetSettingsConfirmed');
      }
      draft = cloneSettings(defaults);
      lastSyncedPropSnapshot = JSON.stringify(defaults);
      confirmingResetDefaults = false;
      saveFeedback = 'saved';
    } catch (err) {
      confirmingResetDefaults = false;
      saveFeedback = 'error';
      saveErrorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleRestoreBackup(): Promise<void> {
    const candidate = recovery?.backup_candidate ?? null;
    saveErrorMessage = null;
    try {
      if (onRestoreBackup) {
        await onRestoreBackup(candidate);
      } else if (client) {
        await client.dispatch('RequestRestoreBackup');
      }
    } catch (err) {
      saveFeedback = 'error';
      saveErrorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleConfirmResetEmpty(): Promise<void> {
    saveErrorMessage = null;
    try {
      if (onConfirmResetEmpty) {
        await onConfirmResetEmpty();
      } else if (client) {
        await client.dispatch('ConfirmResetEmptyConfig');
      }
      confirmingResetEmpty = false;
    } catch (err) {
      confirmingResetEmpty = false;
      saveFeedback = 'error';
      saveErrorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleImport(): Promise<void> {
    if (onImportConfig) {
      await onImportConfig();
    } else if (client) {
      await client.dispatch('RequestImportConfig');
    }
  }

  async function handleExport(): Promise<void> {
    if (onExportConfig) {
      await onExportConfig();
    } else if (client) {
      await client.dispatch('RequestExportConfig');
    }
  }
</script>

<section
  class="ms-settings-shell"
  data-testid="settings-panel"
  data-theme={resolvedThemeAttr}
  aria-label={ariaLabel}
>
  <header class="ms-settings-header">
    <div class="ms-settings-title-group">
      <h2 class="ms-settings-title">设置与偏好</h2>
      <p class="ms-settings-subtitle">主题外观、导出定界符、渲染后端、全局快捷键与数据恢复</p>
    </div>

    <div class="ms-settings-header-actions">
      {#if !shortcutValidation.valid}
        <span class="ms-state-pill ms-state-pill-error" role="status">
          存在 {shortcutValidation.issues.length} 项快捷键冲突/保留键错误
        </span>
      {:else if saveFeedback === 'saved' && !isDirty}
        <span class="ms-state-pill ms-state-pill-success" role="status">设置已应用</span>
      {:else if isDirty}
        <span class="ms-state-pill ms-state-pill-warn" role="status">有未保存更改</span>
      {/if}

      {#if onClose}
        <button
          type="button"
          class="ms-btn ms-btn-ghost"
          data-testid="settings-close-btn"
          onclick={onClose}
        >
          关闭
        </button>
      {/if}
    </div>
  </header>

  {#if recovery}
    <section
      class="ms-recovery-wizard"
      data-testid="recovery-wizard"
      role="alert"
      aria-live="assertive"
      aria-label="配置文件损坏恢复向导"
    >
      <div class="ms-recovery-header">
        <span class="ms-recovery-badge">数据安全保护</span>
        <h3 class="ms-recovery-title">检测到配置文件损坏，已安全隔离（未覆盖原文件）</h3>
      </div>

      <dl class="ms-recovery-meta">
        <div class="ms-recovery-row">
          <dt>错误原因</dt>
          <dd class="ms-mono">{recovery.error}</dd>
        </div>
        <div class="ms-recovery-row">
          <dt>隔离路径</dt>
          <dd class="ms-mono">{recovery.corrupt_path}</dd>
        </div>
        <div class="ms-recovery-row">
          <dt>可用备份</dt>
          <dd class="ms-mono">{recovery.backup_candidate ?? '未检测到可用历史备份'}</dd>
        </div>
      </dl>

      <div class="ms-recovery-actions">
        <button
          type="button"
          class="ms-btn ms-btn-primary"
          data-testid="recovery-restore-btn"
          disabled={!recovery.backup_candidate}
          onclick={handleRestoreBackup}
        >
          从最近备份恢复
        </button>

        {#if !confirmingResetEmpty}
          <button
            type="button"
            class="ms-btn ms-btn-danger-outline"
            data-testid="recovery-reset-trigger"
            onclick={() => {
              confirmingResetEmpty = true;
            }}
          >
            重置为空配置…
          </button>
        {/if}
      </div>

      {#if confirmingResetEmpty}
        <div class="ms-confirm-box" data-testid="recovery-reset-confirm-box" role="group" aria-label="重置空配置二次确认">
          <p class="ms-confirm-text">
            确认要新建空配置吗？已隔离的损坏文件仍会保留在磁盘上，不会自动删除。
          </p>
          <div class="ms-confirm-actions">
            <button
              type="button"
              class="ms-btn ms-btn-danger"
              data-testid="recovery-reset-confirm"
              onclick={handleConfirmResetEmpty}
            >
              确认重置为空配置
            </button>
            <button
              type="button"
              class="ms-btn ms-btn-ghost"
              data-testid="recovery-reset-cancel"
              onclick={() => {
                confirmingResetEmpty = false;
              }}
            >
              取消
            </button>
          </div>
        </div>
      {/if}
    </section>
  {/if}

  <div class="ms-settings-grid">
    <!-- 1. 外观主题 -->
    <section class="ms-card" aria-labelledby="ms-sec-theme">
      <div class="ms-card-head">
        <h3 id="ms-sec-theme" class="ms-card-title">外观主题</h3>
        <span class="ms-card-desc">控制编辑器、调色板、导航树与公式预览的配色方案</span>
      </div>

      <div class="ms-segmented" role="radiogroup" aria-label="主题模式选择">
        {#each THEME_OPTIONS as opt (opt.value)}
          <button
            type="button"
            role="radio"
            aria-checked={draft.theme === opt.value}
            class="ms-choice-card"
            class:ms-choice-active={draft.theme === opt.value}
            data-testid={`theme-option-${opt.value}`}
            onclick={() => updateTheme(opt.value)}
          >
            <span class="ms-choice-label">{opt.label}</span>
            <span class="ms-choice-hint">{opt.hint}</span>
          </button>
        {/each}
      </div>
    </section>

    <!-- 2. 渲染引擎与默认预览缩放 -->
    <section class="ms-card" aria-labelledby="ms-sec-backend">
      <div class="ms-card-head">
        <h3 id="ms-sec-backend" class="ms-card-title">渲染后端与默认缩放</h3>
        <span class="ms-card-desc">选择公式预览渲染方式及默认预览缩放比例（75%–200%）</span>
      </div>

      <div
        class="ms-segmented"
        class:ms-segmented-2={visibleBackendOptions.length >= 2}
        class:ms-segmented-1={visibleBackendOptions.length === 1}
        role="radiogroup"
        aria-label="渲染后端选择"
      >
        {#each visibleBackendOptions as opt (opt.value)}
          <button
            type="button"
            role="radio"
            aria-checked={draft.render_backend === opt.value || (obsidianHostBackendOnly && opt.value === 'mathjax')}
            class="ms-choice-card"
            class:ms-choice-active={draft.render_backend === opt.value || (obsidianHostBackendOnly && opt.value === 'mathjax')}
            data-testid={`backend-option-${opt.value}`}
            onclick={() => updateBackend(opt.value)}
          >
            <span class="ms-choice-label">
              {obsidianHostBackendOnly ? '宿主 renderMath + MathJax 回退' : opt.label}
            </span>
            <span class="ms-choice-hint">
              {obsidianHostBackendOnly
                ? 'Obsidian 插件优先使用宿主 MarkdownRenderer.renderMath，异常时自动回退至 MathJax 3 SVG（不支持离线 latex-rust IPC）'
                : opt.detail}
            </span>
          </button>
        {/each}
      </div>

      <div class="ms-scale-row">
        <label class="ms-scale-label" for="ms-preview-scale-range">
          默认预览缩放：<strong>{effectivePreviewScalePct}%</strong>
        </label>
        <div class="ms-scale-controls">
          <input
            id="ms-preview-scale-range"
            type="range"
            min="75"
            max="200"
            step="5"
            class="ms-scale-range"
            data-testid="settings-preview-scale-range"
            value={effectivePreviewScalePct}
            oninput={(e) => updatePreviewScalePct(Number(e.currentTarget.value))}
          />
          <input
            type="number"
            min="75"
            max="200"
            step="5"
            aria-label="预览缩放百分比"
            class="ms-scale-number"
            data-testid="settings-preview-scale"
            value={effectivePreviewScalePct}
            oninput={(e) => updatePreviewScalePct(Number(e.currentTarget.value))}
          />
        </div>
      </div>
    </section>

    <!-- 3. 输出定界符 + 实时示例 -->
    <section class="ms-card ms-card-wide" aria-labelledby="ms-sec-delimiter">
      <div class="ms-card-head">
        <h3 id="ms-sec-delimiter" class="ms-card-title">默认导出与复制定界符</h3>
        <span class="ms-card-desc">复制 LaTeX 或严格导出时自动包裹的定界符格式</span>
      </div>

      <div class="ms-segmented ms-segmented-4" role="radiogroup" aria-label="输出定界符选择">
        {#each DELIMITER_OPTIONS as opt (opt.value)}
          <button
            type="button"
            role="radio"
            aria-checked={draft.delimiter_style === opt.value}
            class="ms-choice-card"
            class:ms-choice-active={draft.delimiter_style === opt.value}
            data-testid={`delimiter-option-${opt.value}`}
            onclick={() => updateDelimiter(opt.value)}
          >
            <span class="ms-choice-label">{opt.label}</span>
            <code class="ms-choice-code">{opt.badge}</code>
          </button>
        {/each}
      </div>

      <div class="ms-delimiter-preview-box">
        <span class="ms-preview-caption">输出示例预览</span>
        <pre class="ms-delimiter-preview" data-testid="delimiter-preview">{delimiterPreviewText}</pre>
      </div>
    </section>

    <!-- 4. 快捷键配置与冲突检测 -->
    <section class="ms-card ms-card-wide" aria-labelledby="ms-sec-shortcuts">
      <div class="ms-card-head">
        <h3 id="ms-sec-shortcuts" class="ms-card-title">快捷键绑定</h3>
        <span class="ms-card-desc">
          所有快捷键均支持自定义。保留键（Tab / Shift+Tab / Escape / 编辑基础键 / 未修饰单字符）不可被覆盖。
        </span>
      </div>

      {#if !shortcutValidation.valid}
        <div
          class="ms-conflict-banner"
          data-testid="shortcut-conflict-banner"
          role="alert"
        >
          <strong>无法保存设置：请先解决以下快捷键冲突或保留键限制</strong>
          <ul>
            {#each shortcutValidation.issues as issue, idx (`${issue.action}-${issue.code}-${idx}`)}
              <li>{issue.message}</li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="ms-shortcut-list" role="list" aria-label="可配置快捷键列表">
        {#each SHORTCUT_ACTIONS as action (action.id)}
          {@const actionErrors = shortcutValidation.byAction[action.id] ?? []}
          {@const hasError = actionErrors.length > 0}
          <div
            class="ms-shortcut-row"
            class:ms-shortcut-row-error={hasError}
            role="listitem"
            data-action-id={action.id}
          >
            <div class="ms-shortcut-info">
              <div class="ms-shortcut-label-line">
                <label class="ms-shortcut-label" for={`ms-sc-${action.id}`}>{action.label}</label>
                <span class="ms-scope-badge">
                  {action.scope === 'nav' ? '导航模式' : '全局'}
                </span>
              </div>
              <span class="ms-shortcut-desc">{action.description}</span>
              {#if hasError}
                <span
                  class="ms-shortcut-error-text"
                  data-testid={`shortcut-error-${action.id}`}
                  role="status"
                >
                  {actionErrors.map((e) => e.message).join('；')}
                </span>
              {/if}
            </div>

            <div class="ms-shortcut-controls">
              <input
                id={`ms-sc-${action.id}`}
                type="text"
                class="ms-shortcut-input"
                class:ms-input-invalid={hasError}
                data-testid={`shortcut-input-${action.id}`}
                aria-label={`${action.label}快捷键`}
                aria-invalid={hasError ? 'true' : 'false'}
                value={draft.shortcuts[action.id]}
                oninput={(e) => updateShortcutValue(action.id, e.currentTarget.value)}
                onkeydown={(e) => handleShortcutKeyCapture(action.id, e)}
              />
              <button
                type="button"
                class="ms-btn ms-btn-small"
                class:ms-btn-capturing={capturingAction === action.id}
                data-testid={`shortcut-capture-${action.id}`}
                aria-pressed={capturingAction === action.id}
                onclick={() => {
                  capturingAction = capturingAction === action.id ? null : action.id;
                }}
              >
                {capturingAction === action.id ? '请按下组合键…' : '录入'}
              </button>
            </div>
          </div>
        {/each}
      </div>
    </section>

    <!-- 5. 配置路径与导入导出 -->
    <section class="ms-card ms-card-wide" aria-labelledby="ms-sec-storage">
      <div class="ms-card-head">
        <h3 id="ms-sec-storage" class="ms-card-title">配置文件与备份迁移</h3>
        <span class="ms-card-desc">查看当前存储路径，或手动导入/导出 JSON 配置与用户公式库</span>
      </div>

      <div class="ms-storage-row">
        <div class="ms-path-box">
          <span class="ms-path-label">当前配置路径</span>
          <code class="ms-path-value" data-testid="settings-config-path">
            {draft.config_path && draft.config_path.trim().length > 0
              ? draft.config_path
              : '内存 / 宿主托管模式（未绑定磁盘文件路径）'}
          </code>
        </div>

        <div class="ms-storage-actions">
          <button
            type="button"
            class="ms-btn"
            data-testid="settings-import-btn"
            onclick={handleImport}
          >
            导入配置…
          </button>
          <button
            type="button"
            class="ms-btn"
            data-testid="settings-export-btn"
            onclick={handleExport}
          >
            导出配置…
          </button>
        </div>
      </div>
    </section>
  </div>

  {#if saveFeedback === 'error' && saveErrorMessage}
    <div class="ms-save-error-banner" data-testid="settings-save-error" role="alert">
      <strong>保存失败（未更改磁盘或内存状态）：</strong>
      <span>{saveErrorMessage}</span>
    </div>
  {/if}

  <!-- Footer: 恢复默认（二次确认） + 保存 -->
  <footer class="ms-settings-footer">
    <div class="ms-footer-left">
      {#if !confirmingResetDefaults}
        <button
          type="button"
          class="ms-btn ms-btn-danger-outline"
          data-testid="settings-reset-trigger"
          onclick={() => {
            confirmingResetDefaults = true;
          }}
        >
          恢复默认设置
        </button>
      {:else}
        <div
          class="ms-confirm-inline"
          data-testid="settings-reset-confirm-box"
          role="group"
          aria-label="恢复默认设置二次确认"
        >
          <span class="ms-confirm-text">确定恢复默认主题、定界符与全部快捷键？</span>
          <button
            type="button"
            class="ms-btn ms-btn-danger"
            data-testid="settings-reset-confirm"
            onclick={handleConfirmResetDefaults}
          >
            确认恢复默认
          </button>
          <button
            type="button"
            class="ms-btn ms-btn-ghost"
            data-testid="settings-reset-cancel"
            onclick={() => {
              confirmingResetDefaults = false;
            }}
          >
            取消
          </button>
        </div>
      {/if}
    </div>

    <div class="ms-footer-right">
      {#if saveFeedback === 'blocked' && !shortcutValidation.valid}
        <span class="ms-save-blocked-hint">请先修复快捷键冲突后再保存</span>
      {/if}
      <button
        type="button"
        class="ms-btn ms-btn-primary"
        data-testid="settings-save-btn"
        disabled={!shortcutValidation.valid || saveFeedback === 'saving'}
        onclick={handleSave}
      >
        {saveFeedback === 'saving' ? '正在保存…' : '保存设置'}
      </button>
    </div>
  </footer>
</section>

<style>
  .ms-settings-shell {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 18px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    color: var(--ms-fg);
    font-family: var(--ms-font-sans);
    box-shadow: var(--ms-shadow-sm);
  }

  .ms-settings-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--ms-border);
  }

  .ms-settings-title-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .ms-settings-title {
    margin: 0;
    font-size: 1.08rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--ms-fg);
  }

  .ms-settings-subtitle {
    margin: 0;
    font-size: 0.8rem;
    color: var(--ms-fg-muted);
  }

  .ms-settings-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .ms-state-pill {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: var(--ms-radius-pill);
    font-size: 0.75rem;
    font-weight: 600;
    border: 1px solid var(--ms-border);
  }

  .ms-state-pill-success {
    background: var(--ms-status-success-bg);
    border-color: var(--ms-status-success-border);
    color: var(--ms-status-success-fg);
  }

  .ms-state-pill-warn {
    background: var(--ms-status-warn-bg);
    border-color: var(--ms-status-warn-border);
    color: var(--ms-status-warn-fg);
  }

  .ms-state-pill-error {
    background: var(--ms-status-error-bg);
    border-color: var(--ms-status-error-border);
    color: var(--ms-status-error-fg);
  }

  .ms-save-error-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--ms-status-error-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-status-error-bg);
    color: var(--ms-status-error-fg);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  /* Recovery Wizard */
  .ms-recovery-wizard {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--ms-status-error-border);
    border-radius: var(--ms-radius-md);
    background: var(--ms-status-error-bg);
    color: var(--ms-status-error-fg);
  }

  .ms-recovery-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .ms-recovery-badge {
    padding: 2px 8px;
    border-radius: var(--ms-radius-pill);
    background: var(--ms-danger-bg);
    color: var(--ms-danger-fg);
    font-size: 0.72rem;
    font-weight: 700;
  }

  .ms-recovery-title {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 700;
  }

  .ms-recovery-meta {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    color: var(--ms-fg);
    border: 1px solid var(--ms-border);
  }

  .ms-recovery-row {
    display: grid;
    grid-template-columns: 76px 1fr;
    gap: 8px;
    font-size: 0.78rem;
  }

  .ms-recovery-row dt {
    font-weight: 600;
    color: var(--ms-fg-muted);
  }

  .ms-recovery-row dd {
    margin: 0;
    word-break: break-all;
  }

  .ms-mono {
    font-family: var(--ms-font-mono);
  }

  .ms-recovery-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .ms-confirm-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-status-warn-border);
    background: var(--ms-surface);
    color: var(--ms-fg);
  }

  .ms-confirm-actions,
  .ms-confirm-inline {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .ms-confirm-text {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--ms-status-warn-fg);
  }

  /* Grid & Cards */
  .ms-settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
  }

  .ms-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-md);
    background: var(--ms-surface);
  }

  .ms-card-wide {
    grid-column: 1 / -1;
  }

  .ms-card-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ms-card-title {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--ms-fg);
  }

  .ms-card-desc {
    font-size: 0.76rem;
    color: var(--ms-fg-muted);
  }

  .ms-segmented {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .ms-segmented-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ms-segmented-1 {
    grid-template-columns: 1fr;
  }

  .ms-scale-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-border);
    background: var(--ms-surface-elevated);
  }

  .ms-scale-label {
    font-size: 0.78rem;
    color: var(--ms-fg-muted);
  }

  .ms-scale-label strong {
    color: var(--ms-fg);
    font-family: var(--ms-font-mono);
  }

  .ms-scale-controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .ms-scale-range {
    flex: 1 1 auto;
    accent-color: var(--ms-accent);
  }

  .ms-scale-number {
    width: 68px;
    padding: 4px 6px;
    border: 1px solid var(--ms-border-strong);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    color: var(--ms-fg);
    font-family: var(--ms-font-mono);
    font-size: 0.8rem;
  }

  .ms-scale-number:focus-visible,
  .ms-scale-range:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: 2px;
  }

  .ms-segmented-4 {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }

  .ms-choice-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    padding: 9px 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface-elevated);
    color: var(--ms-fg);
    text-align: left;
    cursor: pointer;
    transition: border-color 120ms ease, background-color 120ms ease;
  }

  .ms-choice-card:hover {
    border-color: var(--ms-border-strong);
    background: var(--ms-card-hover-bg);
  }

  .ms-choice-card:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: 2px;
  }

  .ms-choice-active {
    border-color: var(--ms-accent);
    background: var(--ms-accent-soft);
    color: var(--ms-accent-fg);
  }

  .ms-choice-label {
    font-size: 0.82rem;
    font-weight: 600;
  }

  .ms-choice-hint {
    font-size: 0.72rem;
    color: var(--ms-fg-muted);
  }

  .ms-choice-active .ms-choice-hint {
    color: var(--ms-accent-fg);
  }

  .ms-choice-code {
    font-family: var(--ms-font-mono);
    font-size: 0.74rem;
    padding: 1px 5px;
    border-radius: var(--ms-radius-sm);
    background: var(--ms-kbd-bg);
    border: 1px solid var(--ms-kbd-border);
    color: var(--ms-kbd-fg);
  }

  .ms-delimiter-preview-box {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-radius: var(--ms-radius-sm);
    border: 1px dashed var(--ms-border-strong);
    background: var(--ms-surface-elevated);
  }

  .ms-preview-caption {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--ms-fg-muted);
  }

  .ms-delimiter-preview {
    margin: 0;
    font-family: var(--ms-font-mono);
    font-size: 0.82rem;
    color: var(--ms-fg);
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* Shortcuts */
  .ms-conflict-banner {
    padding: 10px 12px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-status-error-border);
    background: var(--ms-status-error-bg);
    color: var(--ms-status-error-fg);
    font-size: 0.8rem;
  }

  .ms-conflict-banner ul {
    margin: 6px 0 0 18px;
    padding: 0;
  }

  .ms-shortcut-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ms-shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface-elevated);
  }

  .ms-shortcut-row-error {
    border-color: var(--ms-status-error-border);
    background: var(--ms-status-error-bg);
  }

  .ms-shortcut-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 220px;
    flex: 1 1 260px;
  }

  .ms-shortcut-label-line {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ms-shortcut-label {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--ms-fg);
  }

  .ms-scope-badge {
    font-size: 0.68rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--ms-radius-pill);
    background: var(--ms-surface-muted);
    color: var(--ms-fg-muted);
  }

  .ms-shortcut-desc {
    font-size: 0.74rem;
    color: var(--ms-fg-muted);
  }

  .ms-shortcut-error-text {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--ms-status-error-fg);
  }

  .ms-shortcut-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ms-shortcut-input {
    width: 146px;
    padding: 5px 8px;
    border: 1px solid var(--ms-border-strong);
    border-radius: var(--ms-radius-sm);
    background: var(--ms-surface);
    color: var(--ms-fg);
    font-family: var(--ms-font-mono);
    font-size: 0.8rem;
  }

  .ms-shortcut-input:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: 1px;
  }

  .ms-input-invalid {
    border-color: var(--ms-status-error-border);
    color: var(--ms-status-error-fg);
  }

  /* Storage row */
  .ms-storage-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .ms-path-box {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1 1 280px;
    min-width: 0;
  }

  .ms-path-label {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--ms-fg-muted);
  }

  .ms-path-value {
    padding: 6px 8px;
    border-radius: var(--ms-radius-sm);
    border: 1px solid var(--ms-border);
    background: var(--ms-surface-elevated);
    color: var(--ms-fg);
    font-family: var(--ms-font-mono);
    font-size: 0.76rem;
    word-break: break-all;
  }

  .ms-storage-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* Footer & Buttons */
  .ms-settings-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding-top: 12px;
    border-top: 1px solid var(--ms-border);
  }

  .ms-footer-left,
  .ms-footer-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .ms-save-blocked-hint {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ms-status-error-fg);
  }

  .ms-btn {
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
    transition: background-color 120ms ease, border-color 120ms ease;
  }

  .ms-btn:hover:not(:disabled) {
    background: var(--ms-surface-elevated);
  }

  .ms-btn:focus-visible {
    outline: 2px solid var(--ms-focus-ring);
    outline-offset: 2px;
  }

  .ms-btn:disabled {
    opacity: 0.52;
    cursor: not-allowed;
  }

  .ms-btn-small {
    padding: 5px 9px;
    font-size: 0.74rem;
  }

  .ms-btn-capturing {
    border-color: var(--ms-accent);
    background: var(--ms-accent-soft);
    color: var(--ms-accent-fg);
  }

  .ms-btn-primary {
    border-color: var(--ms-accent);
    background: var(--ms-accent);
    color: var(--ms-accent-contrast);
  }

  .ms-btn-primary:hover:not(:disabled) {
    background: var(--ms-accent-hover);
  }

  .ms-btn-ghost {
    border-color: transparent;
    background: transparent;
    color: var(--ms-fg-muted);
  }

  .ms-btn-ghost:hover:not(:disabled) {
    background: var(--ms-surface-elevated);
    color: var(--ms-fg);
  }

  .ms-btn-danger {
    border-color: var(--ms-danger-bg);
    background: var(--ms-danger-bg);
    color: var(--ms-danger-fg);
  }

  .ms-btn-danger:hover:not(:disabled) {
    background: var(--ms-danger-hover-bg);
  }

  .ms-btn-danger-outline {
    border-color: var(--ms-status-error-border);
    background: var(--ms-surface);
    color: var(--ms-status-error-fg);
  }

  .ms-btn-danger-outline:hover:not(:disabled) {
    background: var(--ms-status-error-bg);
  }

  @media (max-width: 480px) {
    .ms-settings-shell {
      padding: 10px;
    }

    .ms-settings-grid {
      grid-template-columns: 1fr;
    }

    .ms-segmented,
    .ms-segmented-2,
    .ms-segmented-4 {
      grid-template-columns: 1fr;
    }

    .ms-btn,
    .ms-choice-card {
      min-height: 36px;
    }

    .ms-shortcut-info {
      min-width: 0;
    }

    .ms-shortcut-controls,
    .ms-shortcut-input {
      width: 100%;
    }

    .ms-settings-footer {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>

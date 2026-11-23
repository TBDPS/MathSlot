<script lang="ts">
  import {
    SLOT_ORDER_GROUPS,
    applyGroupSlotOrder,
    getSlotOrder,
    type AppSettings,
    type DelimiterStyle,
    type LeaderKey,
    type SlotOrderGroup,
    type SlotOrderPreset,
    type ThemeMode,
  } from '@mathslot/core';

  interface Props {
    settings: AppSettings;
    onUpdate: (patch: Partial<AppSettings>) => void;
    onClose: () => void;
  }

  let { settings, onUpdate, onClose }: Props = $props();

  const themes: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: '跟随系统' },
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
  ];

  const leaders: { value: LeaderKey; label: string }[] = [
    { value: 'Tab', label: 'Tab' },
    { value: '/', label: '/' },
    { value: '\\', label: '\\' },
  ];

  const delimiters: { value: DelimiterStyle; label: string }[] = [
    { value: 'none', label: '纯 LaTeX' },
    { value: 'inline', label: '$…$' },
    { value: 'block', label: '$$…$$' },
    { value: 'codeblock', label: '```latex' },
  ];

  const orderPresets: { value: SlotOrderPreset; label: string }[] = [
    { value: 'standard', label: '标准顺序' },
    { value: 'writing_cn', label: '中文书写习惯' },
  ];

  function orderEquals(a: readonly number[], b: readonly number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function currentGroupOrder(group: SlotOrderGroup): number[] {
    return getSlotOrder(group.commandIds[0], settings);
  }

  function selectPreset(preset: SlotOrderPreset): void {
    onUpdate({
      slotOrderPreset: preset,
      slotOrderOverrides: {},
    });
  }

  function selectGroupOrder(group: SlotOrderGroup, order: readonly number[]): void {
    onUpdate({
      slotOrderOverrides: applyGroupSlotOrder(settings.slotOrderOverrides, group, order),
    });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label="设置">
    <div class="modal-head">
      <span>设置</span>
      <button type="button" class="close-btn" onclick={onClose} aria-label="关闭">✕</button>
    </div>

    <div class="modal-body">
      <div class="setting-row">
        <span class="setting-label">外观</span>
        <div class="seg-group">
          {#each themes as opt}
            <button
              type="button"
              class="seg-btn"
              class:active={settings.theme === opt.value}
              onclick={() => onUpdate({ theme: opt.value })}
            >
              {opt.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="setting-row">
        <span class="setting-label">默认输出格式</span>
        <div class="seg-group">
          {#each delimiters as opt}
            <button
              type="button"
              class="seg-btn mono"
              class:active={settings.delimiter === opt.value}
              onclick={() => onUpdate({ delimiter: opt.value })}
            >
              {opt.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="setting-row">
        <span class="setting-label">快捷键引导键</span>
        <div class="seg-group">
          {#each leaders as opt}
            <button
              type="button"
              class="seg-btn mono"
              class:active={settings.leaderKey === opt.value}
              onclick={() => onUpdate({ leaderKey: opt.value })}
            >
              {opt.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="section-sep"></div>

      <div class="setting-row">
        <span class="setting-label strong">槽位填空顺序</span>
        <div class="seg-group">
          {#each orderPresets as opt}
            <button
              type="button"
              class="seg-btn"
              class:active={settings.slotOrderPreset === opt.value && Object.keys(settings.slotOrderOverrides).length === 0}
              onclick={() => selectPreset(opt.value)}
            >
              {opt.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="order-list">
        {#each SLOT_ORDER_GROUPS as group (group.id)}
          {@const activeOrder = currentGroupOrder(group)}
          <div class="order-row">
            <span class="order-name">{group.label}</span>
            <div class="seg-group">
              {#each group.options as opt}
                <button
                  type="button"
                  class="seg-btn compact"
                  class:active={orderEquals(activeOrder, opt.order)}
                  onclick={() => selectGroupOrder(group, opt.order)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      <div class="section-sep"></div>

      <label class="toggle-row">
        <span>快捷符号识别（独立词 oo → ∞、pi → π、-&gt; → →）</span>
        <input
          type="checkbox"
          checked={settings.autoShorthands}
          onchange={(e) => onUpdate({ autoShorthands: (e.currentTarget as HTMLInputElement).checked })}
        />
      </label>

      <label class="toggle-row">
        <span>括号自动补全与跳出 ( ) [ ] &#123; &#125;</span>
        <input
          type="checkbox"
          checked={settings.autoBrackets}
          onchange={(e) => onUpdate({ autoBrackets: (e.currentTarget as HTMLInputElement).checked })}
        />
      </label>

      <label class="toggle-row">
        <span>输入 `/` 自动转为分数</span>
        <input
          type="checkbox"
          checked={settings.naturalFraction}
          onchange={(e) => onUpdate({ naturalFraction: (e.currentTarget as HTMLInputElement).checked })}
        />
      </label>

      <label class="toggle-row">
        <span>输入 `^` / `_` 自动转上下标</span>
        <input
          type="checkbox"
          checked={settings.naturalScripts}
          onchange={(e) => onUpdate({ naturalScripts: (e.currentTarget as HTMLInputElement).checked })}
        />
      </label>

      <label class="toggle-row">
        <span>空格自动跳出上下标（如 a_n + 空格）</span>
        <input
          type="checkbox"
          checked={settings.spaceExitsScript}
          onchange={(e) => onUpdate({ spaceExitsScript: (e.currentTarget as HTMLInputElement).checked })}
        />
      </label>

      <label class="toggle-row">
        <span>分号 `;` 跳转下一槽位</span>
        <input
          type="checkbox"
          checked={settings.semicolonNextSlot}
          onchange={(e) => onUpdate({ semicolonNextSlot: (e.currentTarget as HTMLInputElement).checked })}
        />
      </label>

      <label class="toggle-row">
        <span>始终在公式上显示层级虚线框</span>
        <input
          type="checkbox"
          checked={settings.showHierarchyBoxes}
          onchange={(e) => onUpdate({ showHierarchyBoxes: (e.currentTarget as HTMLInputElement).checked })}
        />
      </label>

      <label class="toggle-row">
        <span>底部 LaTeX 源码栏</span>
        <input
          type="checkbox"
          checked={settings.showLatexDock}
          onchange={(e) => onUpdate({ showLatexDock: (e.currentTarget as HTMLInputElement).checked })}
        />
      </label>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.32);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  .modal {
    width: min(470px, calc(100vw - 32px));
    max-height: min(84vh, 640px);
    background: var(--ms-surface);
    border: 1px solid var(--ms-border);
    border-radius: var(--ms-radius-lg);
    box-shadow: var(--ms-shadow-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px 12px;
    border-bottom: 1px solid var(--ms-border-subtle);
    font-size: 14px;
    font-weight: 600;
  }

  .modal-body {
    padding: 14px 18px 18px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .close-btn {
    border: none;
    background: transparent;
    color: var(--ms-fg-muted);
    width: 26px;
    height: 26px;
    border-radius: 6px;
    cursor: pointer;
  }

  .close-btn:hover {
    background: var(--ms-surface-muted);
  }

  .section-sep {
    height: 1px;
    background: var(--ms-border-subtle);
    margin: 2px 0;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .setting-label {
    font-size: 13px;
    color: var(--ms-fg);
  }

  .setting-label.strong {
    font-weight: 600;
  }

  .order-list {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px 12px;
    border-radius: var(--ms-radius-md);
    background: var(--ms-bg);
    border: 1px solid var(--ms-border-subtle);
  }

  .order-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .order-name {
    font-size: 12.5px;
    color: var(--ms-fg-muted);
    white-space: nowrap;
  }

  .seg-group {
    display: inline-flex;
    padding: 2px;
    border-radius: 8px;
    background: var(--ms-surface-muted);
    border: 1px solid var(--ms-border-subtle);
  }

  .seg-btn {
    border: none;
    background: transparent;
    color: var(--ms-fg-muted);
    font-size: 12px;
    padding: 4px 9px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }

  .seg-btn.compact {
    font-size: 11.5px;
    padding: 3px 8px;
  }

  .seg-btn.mono {
    font-family: var(--ms-font-mono);
  }

  .seg-btn.active {
    background: var(--ms-surface);
    color: var(--ms-fg);
    box-shadow: var(--ms-shadow-sm);
    font-weight: 500;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    color: var(--ms-fg);
    cursor: pointer;
  }

  .toggle-row input {
    width: 16px;
    height: 16px;
    accent-color: var(--ms-accent);
    cursor: pointer;
  }
</style>

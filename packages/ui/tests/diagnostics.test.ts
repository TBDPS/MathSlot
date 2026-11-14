import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import DiagnosticsPanel from '../src/diagnostics/DiagnosticsPanel.svelte';
import type { DiagnosticSnapshot } from '../src/client/engine';

describe('DiagnosticsPanel (T3.3, D-010, A-RENDER-005, A-UI-005)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    document.body.innerHTML = '';
  });

  it('bounds header summary <= 120 chars, toggles collapsible drawer with ARIA, shows 200-char truncated source with "已截断", and copies full diagnostics', async () => {
    const longLatex = 'a'.repeat(500);
    const fullDetail = `[SYNTAX_ERROR] Unexpected token near brace\n源码:\n${longLatex}`;
    const truncatedExcerpt = longLatex.slice(0, 194) + '…（已截断）';

    const diagnostics: DiagnosticSnapshot[] = [
      {
        code: 'SYNTAX_ERROR',
        severity: 'Error',
        message: 'Unexpected token near brace\nmultiline detail that should stay inside drawer',
        summary: '[SYNTAX_ERROR] Unexpected token near brace',
        source_excerpt: truncatedExcerpt,
        truncated: true,
        detail: fullDetail,
        hint: '检查花括号配对',
      },
    ];

    const copiedTexts: string[] = [];
    const onCopy = vi.fn(async (text: string) => {
      copiedTexts.push(text);
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(DiagnosticsPanel, {
      target,
      props: {
        diagnostics,
        sourceLatex: longLatex,
        onCopy,
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });
    await tick();

    // 1. Header summary <= 120 chars single-line
    const headerSummary = target.querySelector('[data-testid="diagnostics-header-summary"]');
    expect(headerSummary).not.toBeNull();
    const summaryText = headerSummary!.textContent!.trim();
    expect(summaryText.length).toBeLessThanOrEqual(120);
    expect(summaryText).not.toContain('\n');

    // 2. Toggle drawer collapsed -> expanded
    const toggleBtn = target.querySelector<HTMLButtonElement>('[data-testid="diagnostics-toggle"]');
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn!.getAttribute('aria-expanded')).toBe('false');

    toggleBtn!.click();
    await tick();
    expect(toggleBtn!.getAttribute('aria-expanded')).toBe('true');

    const region = target.querySelector<HTMLElement>('[role="region"]');
    expect(region).not.toBeNull();
    expect(region!.getAttribute('aria-live')).toBe('polite');
    expect(region!.textContent).toContain('已截断');
    expect(region!.textContent).toContain('检查花括号配对');

    const excerptEl = target.querySelector('[data-testid="diagnostic-source-excerpt"]');
    expect(excerptEl).not.toBeNull();
    expect(Array.from(excerptEl!.textContent!.trim()).length).toBeLessThanOrEqual(200);

    // 3. Copy diagnostics button works and shows feedback
    const copyBtn = target.querySelector<HTMLButtonElement>('[data-testid="copy-diagnostics-btn"]');
    expect(copyBtn).not.toBeNull();
    expect(copyBtn!.textContent).toContain('复制诊断信息');

    copyBtn!.click();
    await tick();
    await Promise.resolve();
    await tick();

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(copiedTexts[0]).toContain(longLatex);
    expect(copiedTexts[0]).toContain('SYNTAX_ERROR');
    expect(target.textContent).toContain('已复制');
  });
});

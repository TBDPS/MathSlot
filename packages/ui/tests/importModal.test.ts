import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import ImportModal from '../src/import/ImportModal.svelte';
import { computeLatexDiff } from '../src/import/diff';
import {
  createEmptySnapshot,
  type AppEvent,
  type DispatchResponse,
  type EngineClient,
  type ImportReportSnapshot,
} from '../src/client/engine';

let mounted: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (mounted) {
    unmount(mounted);
    mounted = null;
  }
  document.body.innerHTML = '';
});

function createMockImportClient(
  handler: (latex: string) => { latex: string; report: ImportReportSnapshot },
): { client: EngineClient; events: AppEvent[] } {
  const events: AppEvent[] = [];
  let currentLatex = '\\frac{a}{b}';
  const client: EngineClient = {
    dispatch: vi.fn(async (event: AppEvent): Promise<DispatchResponse> => {
      events.push(event);
      const snap = createEmptySnapshot();
      snap.latex = currentLatex;
      if (typeof event === 'object' && 'PreviewImportLatex' in event) {
        const res = handler(event.PreviewImportLatex);
        snap.last_import = { input_latex: event.PreviewImportLatex, ...res.report };
      } else if (typeof event === 'object' && 'ImportLatex' in event) {
        const res = handler(event.ImportLatex);
        currentLatex = res.report.blocked ? currentLatex : res.latex;
        snap.latex = currentLatex;
        snap.last_import = { input_latex: event.ImportLatex, ...res.report };
      } else if (event === 'ImportAcknowledge') {
        snap.last_import = null;
      }
      return { effects: [], snapshot: snap };
    }),
    snapshot: vi.fn(async () => createEmptySnapshot()),
    engineVersion: vi.fn(async () => '0.7.0+schema1'),
  };
  return { client, events };
}

describe('ImportModal.svelte (D-123 / A-OBS-005)', () => {
  it('displays ImportReport metrics for lossy preview and applies on confirm', async () => {
    const onPreviewed = vi.fn();
    const onImported = vi.fn();
    const { client, events } = createMockImportClient((latex) => ({
      latex,
      report: {
        lossless: false,
        empty_slots: 1,
        raw_nodes: 2,
        roundtrip_latex: '\\tensor{A}{^i_j}',
        normalized_match: false,
        blocked: false,
        diagnostics: [
          {
            code: 'UNKNOWN_MACRO',
            severity: 'Warning',
            message: 'Unknown LaTeX macro: \\tensor',
            summary: 'UNKNOWN_MACRO: Unknown LaTeX macro: \\tensor',
            source_excerpt: latex,
            truncated: false,
            detail: 'Unknown LaTeX macro: \\tensor',
            hint: '未知宏已降级为 RawLatex 节点',
          },
        ],
      },
    }));

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(ImportModal, {
      target,
      props: {
        open: true,
        client,
        initialLatex: '\\tensor{A}{^i_j}',
        onPreviewed,
        onImported,
      },
    });
    await tick();

    const submitBtn = target.querySelector('[data-testid="import-submit-btn"]') as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    submitBtn.click();
    await tick();
    await tick();

    expect(events).toContainEqual({ PreviewImportLatex: '\\tensor{A}{^i_j}' });
    expect(events.some((e) => typeof e === 'object' && 'ImportLatex' in e)).toBe(false);
    expect(onPreviewed).toHaveBeenCalledTimes(1);
    expect(onImported).not.toHaveBeenCalled();

    const reportEl = target.querySelector('[data-testid="import-report"]');
    expect(reportEl).not.toBeNull();
    expect(target.querySelector('[data-testid="import-lossy-banner"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="import-degraded-badge"]')).not.toBeNull();
    expect(reportEl?.textContent).toContain('2');
    expect(target.querySelector('[data-testid="import-roundtrip-latex"]')?.textContent).toContain(
      '\\tensor{A}{^i_j}',
    );

    const applyBtn = target.querySelector('[data-testid="import-apply-btn"]') as HTMLButtonElement;
    expect(applyBtn).not.toBeNull();
    expect(applyBtn.disabled).toBe(false);
    applyBtn.click();
    await tick();
    await tick();

    expect(events).toContainEqual({ ImportLatex: '\\tensor{A}{^i_j}' });
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('blocks apply and renders Error alert banner when blocked === true', async () => {
    const onPreviewed = vi.fn();
    const onImported = vi.fn();
    const { client, events } = createMockImportClient((latex) => ({
      latex: '\\frac{a}{b}',
      report: {
        lossless: false,
        empty_slots: 0,
        raw_nodes: 1,
        roundtrip_latex: '',
        normalized_match: false,
        blocked: true,
        diagnostics: [
          {
            code: 'UNCLOSED_DELIMITER',
            severity: 'Error',
            message: 'Unclosed delimiter: }',
            summary: 'UNCLOSED_DELIMITER: Unclosed delimiter: }',
            source_excerpt: latex,
            truncated: false,
            detail: 'Unclosed delimiter: }',
            hint: '检查花括号配对',
          },
        ],
      },
    }));

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(ImportModal, {
      target,
      props: {
        open: true,
        client,
        initialLatex: '\\frac{1}{',
        onPreviewed,
        onImported,
      },
    });
    await tick();

    const submitBtn = target.querySelector('[data-testid="import-submit-btn"]') as HTMLButtonElement;
    submitBtn.click();
    await tick();
    await tick();

    const blockedBanner = target.querySelector('[data-testid="import-blocked-banner"]');
    expect(blockedBanner).not.toBeNull();
    expect(blockedBanner?.getAttribute('role')).toBe('alert');
    expect(blockedBanner?.textContent).toContain('阻断');
    expect(target.querySelector('[data-testid="import-diagnostics-list"]')?.textContent).toContain(
      'UNCLOSED_DELIMITER',
    );
    const applyBtn = target.querySelector('[data-testid="import-apply-btn"]') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    expect(onPreviewed).toHaveBeenCalledTimes(1);
    expect(onPreviewed.mock.calls[0]?.[0].snapshot.latex).toBe('\\frac{a}{b}');
    expect(onImported).not.toHaveBeenCalled();
    expect(events.some((e) => typeof e === 'object' && 'ImportLatex' in e)).toBe(false);
  });

  it('computes token-level LaTeX diff cleanly for stripped outer delimiters and raw nodes', () => {
    const diff = computeLatexDiff('$$\\frac{a}{b}$$', '\\frac{a}{b}');
    expect(diff.changed).toBe(true);
    expect(diff.inputSegments.some((s) => s.kind === 'removed' && s.text.includes('$'))).toBe(true);
    expect(diff.outputSegments.some((s) => s.kind === 'same' && s.text.includes('\\frac'))).toBe(true);

    const identical = computeLatexDiff('x^{2}', 'x^{2}');
    expect(identical.changed).toBe(false);
  });

  it('T4.1 / D-140: Preview dispatches PreviewImportLatex without mutating editor, renders diff & degraded badge, disables Apply on error, and Cancel does not apply', async () => {
    const events: AppEvent[] = [];
    let currentLatex = '\\frac{a}{b}';
    const client: EngineClient = {
      dispatch: vi.fn(async (event: AppEvent): Promise<DispatchResponse> => {
        events.push(event);
        const snap = createEmptySnapshot();
        snap.latex = currentLatex;
        if (typeof event === 'object' && 'ImportLatex' in event) {
          currentLatex = event.ImportLatex;
          snap.latex = currentLatex;
          snap.last_import = {
            lossless: false,
            empty_slots: 0,
            raw_nodes: 1,
            roundtrip_latex: '\\begin{align} a &= b \\end{align}',
            normalized_match: true,
            blocked: false,
            diagnostics: [],
          };
        } else if (typeof event === 'object' && 'PreviewImportLatex' in (event as Record<string, unknown>)) {
          const input = (event as unknown as { PreviewImportLatex: string }).PreviewImportLatex;
          const isError = input.trim() === '1 + 2}';
          snap.last_import = isError
            ? {
                lossless: false,
                empty_slots: 0,
                raw_nodes: 1,
                roundtrip_latex: input,
                normalized_match: false,
                blocked: true,
                diagnostics: [
                  {
                    code: 'UNMATCHED_DELIMITER',
                    severity: 'Error',
                    message: 'Unmatched delimiter: }',
                    summary: 'UNMATCHED_DELIMITER: Unmatched delimiter: }',
                    source_excerpt: input,
                    truncated: false,
                    detail: 'Unmatched delimiter: }',
                    hint: '检查多余的 }',
                  },
                ],
              }
            : {
                lossless: false,
                empty_slots: 0,
                raw_nodes: 1,
                roundtrip_latex: '\\begin{align} a &= b \\end{align}',
                normalized_match: false,
                blocked: false,
                diagnostics: [
                  {
                    code: 'UNSUPPORTED_ENVIRONMENT',
                    severity: 'Warning',
                    message: 'Unsupported environment: align',
                    summary: 'UNSUPPORTED_ENVIRONMENT: Unsupported environment: align',
                    source_excerpt: input,
                    truncated: false,
                    detail: 'Unsupported environment: align',
                    hint: '已保留为 RawLatex 节点',
                  },
                ],
              };
        } else if (event === 'ImportAcknowledge') {
          snap.last_import = null;
        }
        return { effects: [], snapshot: snap };
      }),
      snapshot: vi.fn(async () => {
        const snap = createEmptySnapshot();
        snap.latex = currentLatex;
        return snap;
      }),
      engineVersion: vi.fn(async () => '0.7.0+schema1'),
    };

    const onClose = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(ImportModal, {
      target,
      props: {
        open: true,
        client,
        initialLatex: '$$\\begin{align} a &= b \\end{align}$$',
        onClose,
      },
    });
    await tick();

    // Step 1: Click Preview button -> dispatches PreviewImportLatex, NOT ImportLatex
    const previewBtn = target.querySelector('[data-testid="import-submit-btn"]') as HTMLButtonElement;
    previewBtn.click();
    await tick();
    await tick();

    expect(events.some((e) => typeof e === 'object' && 'PreviewImportLatex' in (e as Record<string, unknown>))).toBe(true);
    expect(events.some((e) => typeof e === 'object' && 'ImportLatex' in e)).toBe(false);
    expect(currentLatex).toBe('\\frac{a}{b}');

    // Diff view and RawLatex degraded badge must be visible
    expect(target.querySelector('[data-testid="import-diff-view"]')).not.toBeNull();
    expect(target.querySelector('[data-testid="import-degraded-badge"]')).not.toBeNull();

    // Apply button must exist and be enabled for non-blocked Warning
    const applyBtn = target.querySelector('[data-testid="import-apply-btn"]') as HTMLButtonElement | null;
    expect(applyBtn).not.toBeNull();
    expect(applyBtn?.disabled).toBe(false);

    // Cancel button must close without applying
    const cancelBtn = target.querySelector('[data-testid="import-cancel-btn"]') as HTMLButtonElement | null;
    expect(cancelBtn).not.toBeNull();
    cancelBtn!.click();
    await tick();
    await tick();
    expect(events.some((e) => typeof e === 'object' && 'ImportLatex' in e)).toBe(false);
    expect(currentLatex).toBe('\\frac{a}{b}');
    expect(onClose).toHaveBeenCalledTimes(1);

    // Error input disables Apply button
    const textarea = target.querySelector('[data-testid="import-latex-input"]') as HTMLTextAreaElement;
    textarea.value = '1 + 2}';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    previewBtn.click();
    await tick();
    await tick();

    const applyAfterError = target.querySelector('[data-testid="import-apply-btn"]') as HTMLButtonElement | null;
    expect(applyAfterError).not.toBeNull();
    expect(applyAfterError?.disabled).toBe(true);
  });

  it('D-144: raw_nodes === 0 && blocked does NOT render RawLatex 降级 badge and shows blocked error badge', async () => {
    const { client } = createMockImportClient((latex) => ({
      latex,
      report: {
        lossless: false,
        empty_slots: 1,
        raw_nodes: 0,
        roundtrip_latex: '\\frac{1}{}',
        normalized_match: false,
        blocked: true,
        diagnostics: [
          {
            code: 'UNCLOSED_DELIMITER',
            severity: 'Error',
            message: 'Unclosed delimiter: }',
            summary: 'UNCLOSED_DELIMITER: Unclosed delimiter: }',
            source_excerpt: latex,
            truncated: false,
            detail: 'Unclosed delimiter: }',
            hint: '请补全未闭合的定界符 `}`',
          },
        ],
      },
    }));

    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(ImportModal, {
      target,
      props: {
        open: true,
        client,
        initialLatex: '\\frac{1}{',
        onClose: vi.fn(),
      },
    });
    await tick();

    const previewBtn = target.querySelector('[data-testid="import-submit-btn"]') as HTMLButtonElement;
    previewBtn.click();
    await tick();
    await tick();

    const diffView = target.querySelector('[data-testid="import-diff-view"]');
    expect(diffView).not.toBeNull();
    expect(diffView?.textContent ?? '').not.toContain('RawLatex 降级');
    expect(target.querySelector('[data-testid="import-degraded-badge"]')).toBeNull();

    const diffPill = target.querySelector('[data-testid="import-diff-pill"]');
    expect(diffPill?.textContent ?? '').toContain('语法错误已阻断');
  });
});

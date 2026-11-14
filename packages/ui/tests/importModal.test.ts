import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import ImportModal from '../src/import/ImportModal.svelte';
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
      if (typeof event === 'object' && 'ImportLatex' in event) {
        const res = handler(event.ImportLatex);
        currentLatex = res.report.blocked ? currentLatex : res.latex;
        snap.latex = currentLatex;
        snap.last_import = res.report;
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
  it('displays ImportReport metrics for lossless and lossy imports', async () => {
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
      },
    });
    await tick();

    const submitBtn = target.querySelector('[data-testid="import-submit-btn"]') as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    submitBtn.click();
    await tick();
    await tick();

    expect(events).toContainEqual({ ImportLatex: '\\tensor{A}{^i_j}' });
    const reportEl = target.querySelector('[data-testid="import-report"]');
    expect(reportEl).not.toBeNull();
    expect(target.querySelector('[data-testid="import-lossy-banner"]')).not.toBeNull();
    expect(reportEl?.textContent).toContain('2');
    expect(target.querySelector('[data-testid="import-roundtrip-latex"]')?.textContent).toContain(
      '\\tensor{A}{^i_j}',
    );
  });

  it('blocks apply and renders Error alert banner when blocked === true', async () => {
    const onImported = vi.fn();
    const { client } = createMockImportClient((latex) => ({
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
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onImported.mock.calls[0]?.[0].snapshot.latex).toBe('\\frac{a}{b}');
  });
});

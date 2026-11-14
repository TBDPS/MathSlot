import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import PreviewPanel from '../src/preview/PreviewPanel.svelte';
import {
  createManagedRenderer,
  createMathJaxSvgAdapter,
  type PreviewRenderRequest,
  type PreviewRenderResult,
  type RenderAdapter,
} from '../src/preview/renderAdapter';

describe('RenderAdapter & PreviewPanel (T3.3)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    document.body.innerHTML = '';
  });

  it('D-113 / T3.3: createMathJaxSvgAdapter renders \\frac{1}{2} to real <svg> and detects <merror>/data-mjx-error as degraded', async () => {
    const adapter = createMathJaxSvgAdapter();
    expect(adapter.kind).toBe('mathjax');

    const ok = await adapter.render({
      generation: 1,
      latex: '\\frac{1}{2}',
      theme: 'light',
    });
    expect(ok.svg).toContain('<svg');
    expect(ok.degraded).toBe(false);
    expect(ok.diagnostics).toHaveLength(0);

    // D-114 preview_latex with \bbox + \square + \color must also render cleanly without <merror>
    const previewHighlighted = await adapter.render({
      generation: 10,
      latex: '\\frac{}{}',
      previewLatex:
        '\\frac{\\bbox[#dbeafe,3px,border:1.5px solid #2563eb]{{\\color{#1d4ed8}\\square}}}{\\bbox[#fef2f2,3px,border:1.25px solid #ef4444]{{\\color{#dc2626}\\square}}}',
      theme: 'light',
    });
    expect(previewHighlighted.svg).toContain('<svg');
    expect(previewHighlighted.degraded).toBe(false);
    expect(previewHighlighted.diagnostics).toHaveLength(0);

    // Unknown macro must NOT be silently treated as normal — must flag degraded + diagnostics
    const unknownMacro = await adapter.render({
      generation: 2,
      latex: '\\myExoticPkgMacro{a}{b}',
      theme: 'light',
    });
    expect(unknownMacro.degraded).toBe(true);
    expect(unknownMacro.diagnostics.length).toBeGreaterThan(0);
    expect(unknownMacro.svg).toMatch(/merror|data-mjx-error/);

    // Syntax error must also produce degraded + diagnostics
    const syntaxErr = await adapter.render({
      generation: 3,
      latex: '\\frac{1}{',
      theme: 'light',
    });
    expect(syntaxErr.degraded).toBe(true);
    expect(syntaxErr.diagnostics.length).toBeGreaterThan(0);
  });

  it('A-RENDER-003 / D-011: createManagedRenderer forces degraded=true and diagnostics when falling back after primary failure', async () => {
    const failingPrimary: RenderAdapter = {
      kind: 'mathjax',
      render: vi.fn(async () => {
        throw new Error('Undefined control sequence \\myExoticPkgMacro');
      }),
    };
    const silentFallback: RenderAdapter = {
      kind: 'latex-rust',
      render: vi.fn(async (req: PreviewRenderRequest): Promise<PreviewRenderResult> => ({
        generation: req.generation,
        backend: 'latex-rust',
        svg: '<svg data-fallback="true"><path d="M0 0"/></svg>',
        // Even if fallback claims degraded: false, managed renderer MUST force degraded: true
        degraded: false,
        diagnostics: [],
        cacheHit: false,
      })),
    };

    const managed = createManagedRenderer({
      primary: failingPrimary,
      fallback: silentFallback,
      cacheCapacity: 16,
    });

    const res = await managed.render({
      generation: 1,
      latex: '\\myExoticPkgMacro{a}{b}',
      theme: 'light',
    });

    expect(res).not.toBeNull();
    expect(res!.degraded).toBe(true);
    expect(res!.diagnostics.length).toBeGreaterThan(0);
    expect(res!.diagnostics[0]!.summary).toContain('myExoticPkgMacro');
    expect(res!.svg).toContain('data-fallback="true"');
  });

  it('A-RENDER-004 / D-019: out-of-order slow request is discarded by generation and identical requests hit cache', async () => {
    let resolveSlow!: (res: PreviewRenderResult) => void;
    let callCount = 0;

    const adapter: RenderAdapter = {
      kind: 'mathjax',
      render: vi.fn((req: PreviewRenderRequest): Promise<PreviewRenderResult> => {
        callCount += 1;
        if (req.generation === 1) {
          return new Promise<PreviewRenderResult>((resolve) => {
            resolveSlow = resolve;
          });
        }
        return Promise.resolve({
          generation: req.generation,
          backend: 'mathjax',
          svg: `<svg data-gen="${req.generation}"></svg>`,
          degraded: false,
          diagnostics: [],
          cacheHit: false,
        });
      }),
    };

    const managed = createManagedRenderer({ primary: adapter, cacheCapacity: 16 });

    const pSlow = managed.render({ generation: 1, latex: 'x+1', theme: 'light' });
    const pFast = managed.render({ generation: 2, latex: 'x+2', theme: 'light' });

    const fastRes = await pFast;
    expect(fastRes).not.toBeNull();
    expect(fastRes!.generation).toBe(2);
    expect(fastRes!.svg).toContain('data-gen="2"');

    // Now resolve slow gen=1 AFTER gen=2 already completed
    resolveSlow({
      generation: 1,
      backend: 'mathjax',
      svg: '<svg data-gen="1"></svg>',
      degraded: false,
      diagnostics: [],
      cacheHit: false,
    });

    const slowRes = await pSlow;
    expect(slowRes).toBeNull();

    // Cache hit check on identical tuple
    const cached = await managed.render({ generation: 3, latex: 'x+2', theme: 'light' });
    expect(cached).not.toBeNull();
    expect(cached!.cacheHit).toBe(true);
    expect(callCount).toBe(2);
  });

  it('A-RENDER-001 / D-003 / D-011 / A-RENDER-005: PreviewPanel toggles fit-to-width vs 100%, exposes scrollable wide viewport, shows degraded badge, and protects toolbar buttons', async () => {
    const longErr = 'X'.repeat(300);
    const mockAdapter: RenderAdapter = {
      kind: 'mathjax',
      render: vi.fn(async (req: PreviewRenderRequest): Promise<PreviewRenderResult> => ({
        generation: req.generation,
        backend: 'latex-rust',
        svg: '<svg width="1800" height="120" viewBox="0 0 1800 120"><rect width="1800" height="120"/></svg>',
        degraded: true,
        diagnostics: [
          {
            code: 'FALLBACK_USED',
            severity: 'Warning',
            summary: `[FALLBACK_USED] ${longErr.slice(0, 100)}…`,
            message: longErr,
            sourceExcerpt: longErr.slice(0, 195) + '…（已截断）',
            truncated: true,
            detail: longErr,
          },
        ],
        cacheHit: false,
      })),
    };

    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(PreviewPanel, {
      target,
      props: {
        latex: '\\sum_{i=1}^{100} x_i',
        generation: 1,
        renderer: mockAdapter,
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });

    await tick();
    await new Promise((r) => setTimeout(r, 20));
    await tick();

    const viewport = target.querySelector<HTMLElement>('[data-testid="preview-viewport"]');
    expect(viewport).not.toBeNull();
    expect(viewport!.getAttribute('data-fit-mode')).toBe('fit-to-width');

    const degradedBadge = target.querySelector('[data-testid="degraded-badge"]');
    expect(degradedBadge).not.toBeNull();
    expect(degradedBadge!.textContent).toContain('降级预览');

    const headerSummary = target.querySelector('[data-testid="preview-error-summary"]');
    expect(headerSummary).not.toBeNull();
    expect(headerSummary!.textContent!.trim().length).toBeLessThanOrEqual(120);

    // Toggle to actual size (100%)
    const actualBtn = target.querySelector<HTMLButtonElement>('[data-testid="fit-mode-actual"]');
    expect(actualBtn).not.toBeNull();
    actualBtn!.click();
    await tick();

    expect(viewport!.getAttribute('data-fit-mode')).toBe('actual');
    const zoomReadout = target.querySelector('[data-testid="zoom-percent"]');
    expect(zoomReadout?.textContent).toContain('100%');
  });

  it('D-119: PreviewPanel with theme="auto" resolves system prefers-color-scheme: dark dynamically and tokens.css defines [data-theme="light"]', async () => {
    const fsMod = 'node:fs';
    const pathMod = 'node:path';
    const fs = (await import(/* @vite-ignore */ fsMod)) as {
      readFileSync: (path: string, encoding: 'utf8') => string;
    };
    const path = (await import(/* @vite-ignore */ pathMod)) as {
      resolve: (...segments: string[]) => string;
    };
    const dir = (import.meta as ImportMeta & { dirname?: string }).dirname ?? '.';
    const tokensCss = fs.readFileSync(path.resolve(dir, '../src/theme/tokens.css'), 'utf8');
    expect(tokensCss).toMatch(/\[data-theme=['"]light['"]\]/);

    let isDark = true;
    const changeListeners = new Set<(e: MediaQueryListEvent) => void>();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes('prefers-color-scheme: dark') ? isDark : false,
        media: query,
        onchange: null,
        addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
          changeListeners.add(cb);
        },
        removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
          changeListeners.delete(cb);
        },
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    try {
      const seenThemes: string[] = [];
      const mockAdapter: RenderAdapter = {
        kind: 'mathjax',
        render: vi.fn(async (req: PreviewRenderRequest): Promise<PreviewRenderResult> => {
          seenThemes.push(req.theme);
          return {
            generation: req.generation,
            backend: 'mathjax',
            svg: `<svg data-theme="${req.theme}"></svg>`,
            degraded: false,
            diagnostics: [],
            cacheHit: false,
          };
        }),
      };

      const target = document.createElement('div');
      document.body.appendChild(target);

      const app = mount(PreviewPanel, {
        target,
        props: {
          latex: 'x^2',
          theme: 'auto',
          generation: 1,
          renderer: mockAdapter,
        },
      });
      cleanups.push(() => {
        void unmount(app);
      });

      await tick();
      await new Promise((r) => setTimeout(r, 20));
      await tick();

      expect(seenThemes).toContain('dark');
      expect(seenThemes[0]).toBe('dark');

      // Dynamically flip OS preference to light
      isDark = false;
      for (const cb of changeListeners) {
        cb({ matches: false, media: '(prefers-color-scheme: dark)' } as MediaQueryListEvent);
      }
      await tick();
      await new Promise((r) => setTimeout(r, 20));
      await tick();

      expect(seenThemes[seenThemes.length - 1]).toBe('light');
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });

  it('D-134 / D-135: PreviewPanel applies previewScalePct and triggers onCopyError + onViewDiagnostics on degraded render', async () => {
    const mockAdapter: RenderAdapter = {
      kind: 'mathjax',
      render: vi.fn(async (req: PreviewRenderRequest): Promise<PreviewRenderResult> => ({
        generation: req.generation,
        backend: 'mathjax',
        svg: '<svg><text>err</text></svg>',
        degraded: true,
        diagnostics: [
          {
            code: 'PRIMARY_RENDER_FAILED',
            severity: 'Error',
            summary: '[PRIMARY_RENDER_FAILED] boom',
            message: 'boom',
            sourceExcerpt: 'x',
            truncated: false,
            detail: 'boom detail',
          },
        ],
        cacheHit: false,
      })),
    };
    const onCopyError = vi.fn();
    const onViewDiagnostics = vi.fn();

    const target = document.createElement('div');
    document.body.appendChild(target);

    const app = mount(PreviewPanel, {
      target,
      props: {
        latex: 'x',
        generation: 1,
        renderer: mockAdapter,
        previewScalePct: 125,
        onCopyError,
        onViewDiagnostics,
      },
    });
    cleanups.push(() => {
      void unmount(app);
    });

    await tick();
    await new Promise((r) => setTimeout(r, 20));
    await tick();

    expect(target.querySelector('[data-testid="zoom-percent"]')?.textContent).toContain('125%');

    const copyBtn = target.querySelector<HTMLButtonElement>('[data-testid="preview-copy-error-btn"]');
    const viewBtn = target.querySelector<HTMLButtonElement>('[data-testid="preview-view-diagnostics-btn"]');
    expect(copyBtn).not.toBeNull();
    expect(viewBtn).not.toBeNull();

    copyBtn!.click();
    viewBtn!.click();
    await tick();

    expect(onCopyError).toHaveBeenCalledTimes(1);
    expect(onViewDiagnostics).toHaveBeenCalledTimes(1);
  });
});

import {
  createHostRenderMathAdapter,
  createManagedRenderer,
  createMathJaxSvgAdapter,
  type ManagedRenderer,
  type PreviewRenderRequest,
  type PreviewRenderResult,
} from '@mathslot/ui';

export interface ObsidianHostRenderOptions {
  renderMath: (tex: string, display: boolean) => HTMLElement | string | Promise<HTMLElement | string>;
  finishRenderMath: () => Promise<void>;
  debounceMs?: number;
  maxWaitMs?: number;
  cacheCapacity?: number;
}

export interface ObsidianManagedRenderer extends ManagedRenderer {
  renderNow(req: PreviewRenderRequest): Promise<PreviewRenderResult | null>;
}

export function createObsidianHostRenderAdapter(
  options: ObsidianHostRenderOptions,
): ObsidianManagedRenderer {
  const primary = createHostRenderMathAdapter(async (tex, display) => {
    const rendered = await options.renderMath(tex, display);
    await options.finishRenderMath();

    if (typeof rendered === 'string') {
      if (rendered.trim().length === 0) {
        throw new Error('Obsidian renderMath returned empty markup');
      }
      return rendered;
    }

    if (!rendered || (rendered.innerHTML.trim().length === 0 && rendered.outerHTML.trim().length === 0)) {
      throw new Error('Obsidian renderMath returned empty element');
    }

    return rendered;
  });

  const fallback = createMathJaxSvgAdapter();
  const managed = createManagedRenderer({
    primary,
    fallback,
    debounceMs: options.debounceMs ?? 40,
    maxWaitMs: options.maxWaitMs ?? 120,
    cacheCapacity: options.cacheCapacity ?? 64,
  });

  return {
    kind: managed.kind,
    render: (req) => managed.render(req),
    renderNow: (req) => managed.render(req),
    schedule: (req, onResult) => managed.schedule(req, onResult),
    latestGeneration: () => managed.latestGeneration(),
    cacheStats: () => managed.cacheStats(),
    clearCache: () => managed.clearCache(),
    dispose: () => managed.dispose(),
  };
}

import katex from 'katex';

export interface RenderResult {
  html: string;
  error: string | null;
}

export function renderLatexInteractive(latex: string): RenderResult {
  try {
    const html = katex.renderToString(latex, {
      displayMode: true,
      throwOnError: true,
      strict: false,
      trust: true,
      output: 'html',
    });
    return { html, error: null };
  } catch (err) {
    // Fallback with throwOnError: false so user never sees a blank screen
    try {
      const fallback = katex.renderToString(latex, {
        displayMode: true,
        throwOnError: false,
        strict: false,
        trust: true,
        output: 'html',
      });
      return {
        html: fallback,
        error: err instanceof Error ? err.message : String(err),
      };
    } catch {
      return {
        html: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

const previewCache = new Map<string, string>();
const MAX_PREVIEW_CACHE = 2000;

export function renderLatexPreview(latex: string, displayMode = false): string {
  const key = `${displayMode ? 'D' : 'I'}:${latex}`;
  const cached = previewCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const html = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: 'html',
    });
    if (previewCache.size >= MAX_PREVIEW_CACHE) {
      const oldestKey = previewCache.keys().next().value;
      if (oldestKey !== undefined) previewCache.delete(oldestKey);
    }
    previewCache.set(key, html);
    return html;
  } catch {
    return latex;
  }
}

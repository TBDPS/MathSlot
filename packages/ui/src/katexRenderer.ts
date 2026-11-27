import katex from 'katex';
import { normalizePreviewLatex, registerRawLatexValidator } from '@mathslot/core';

registerRawLatexValidator((tex) => {
  try {
    const safe = normalizePreviewLatex(tex, true);
    katex.renderToString(safe, {
      displayMode: true,
      throwOnError: true,
      strict: false,
      trust: false,
      output: 'html',
    });
    return true;
  } catch {
    return false;
  }
});

export interface RenderResult {
  html: string;
  error: string | null;
}

/**
 * Only trust internal DOM-tagging macros used by MathSlot's interactive AST hit-tester.
 * Strictly blocks `\href{javascript:...}`, `\url`, `\includegraphics`, `\htmlStyle`, etc.
 */
const INTERACTIVE_TRUST_COMMANDS = new Set(['\\htmlData', '\\htmlClass', '\\htmlId']);
function trustInteractiveOnly(ctx: { command: string }): boolean {
  return INTERACTIVE_TRUST_COMMANDS.has(ctx.command);
}

export function renderLatexInteractive(latex: string, displayMode = true): RenderResult {
  try {
    const html = katex.renderToString(latex, {
      displayMode,
      throwOnError: true,
      strict: false,
      trust: trustInteractiveOnly,
      output: 'html',
    });
    return { html, error: null };
  } catch (err) {
    // Fallback with throwOnError: false so user never sees a blank screen
    try {
      const fallback = katex.renderToString(latex, {
        displayMode,
        throwOnError: false,
        strict: false,
        trust: trustInteractiveOnly,
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
const MAX_PREVIEW_LATEX_LENGTH = 24000;
const MAX_PREVIEW_BRACE_DEPTH = 128;

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function exceedsBraceDepthBudget(latex: string, maxDepth: number): boolean {
  let depth = 0;
  for (let i = 0; i < latex.length; i += 1) {
    const ch = latex[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      if (depth > maxDepth) return true;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return false;
}

export function renderLatexPreview(latex: string, displayMode = false): string {
  if (latex.length > MAX_PREVIEW_LATEX_LENGTH || exceedsBraceDepthBudget(latex, MAX_PREVIEW_BRACE_DEPTH)) {
    const snippet = latex.length > 180 ? `${latex.slice(0, 180)}…` : latex;
    return `<span class="katex-error" title="公式过长或嵌套过深">${escapeHtml(snippet)}</span>`;
  }
  const key = `${displayMode ? 'D' : 'I'}:${latex}`;
  const cached = previewCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const normalized = normalizePreviewLatex(latex, displayMode);
    const html = katex.renderToString(normalized, {
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
    // NEVER return unescaped `latex` into `{@html ...}` — escape strictly to block HTML/DOM injection!
    const snippet = latex.length > 180 ? `${latex.slice(0, 180)}…` : latex;
    return `<span class="katex-error">${escapeHtml(snippet)}</span>`;
  }
}

import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor, type LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import type { StatusSeverity } from '../client/engine';

export type RenderBackendKind = 'mathjax' | 'latex-rust' | 'host';
export type RenderTheme = 'light' | 'dark' | 'high-contrast';
export type RenderFormat = 'svg' | 'png';
export type RenderMode = 'preview' | 'nav';

export const HEADER_MAX_CHARS = 120;
export const SOURCE_MAX_CHARS = 200;
export const TRUNCATED_SUFFIX = '…（已截断）';

export interface PreviewRenderRequest {
  id?: number;
  generation: number;
  latex: string;
  previewLatex?: string;
  theme: RenderTheme;
  scale?: number;
  mode?: RenderMode;
  format?: RenderFormat;
  display?: boolean;
}

export interface PreviewDiagnostic {
  code: string;
  severity: StatusSeverity;
  summary: string;
  message: string;
  sourceExcerpt: string;
  truncated: boolean;
  detail: string;
  hint?: string;
}

export interface PreviewRenderResult {
  generation: number;
  backend: RenderBackendKind;
  svg: string;
  degraded: boolean;
  diagnostics: PreviewDiagnostic[];
  cacheHit: boolean;
  errorSummary?: PreviewDiagnostic;
}

export interface RenderAdapter {
  readonly kind: RenderBackendKind;
  render(req: PreviewRenderRequest): Promise<PreviewRenderResult>;
}

function normalizeSingleLine(input: string): string {
  return input.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sliceByCodePoints(input: string, maxChars: number): string {
  const chars = Array.from(input);
  if (chars.length <= maxChars) return input;
  return chars.slice(0, maxChars).join('');
}

export function summarizeRenderError(
  code: string,
  message: string,
  source: string,
  options?: { severity?: StatusSeverity; hint?: string },
): PreviewDiagnostic {
  const cleanCode = normalizeSingleLine(code);
  const cleanMsg = normalizeSingleLine(message);
  const rawHeader =
    cleanCode.length === 0
      ? cleanMsg
      : cleanMsg.length === 0
        ? `[${cleanCode}]`
        : `[${cleanCode}] ${cleanMsg}`;

  const headerChars = Array.from(rawHeader);
  const summary =
    headerChars.length > HEADER_MAX_CHARS
      ? `${headerChars.slice(0, HEADER_MAX_CHARS - 1).join('')}…`
      : rawHeader;

  const sourceChars = Array.from(source);
  const suffixChars = Array.from(TRUNCATED_SUFFIX);
  const truncated = sourceChars.length > SOURCE_MAX_CHARS;
  const sourceExcerpt = truncated
    ? `${sliceByCodePoints(source, Math.max(0, SOURCE_MAX_CHARS - suffixChars.length))}${TRUNCATED_SUFFIX}`
    : source;

  const detail =
    source.length === 0
      ? `[${cleanCode}] ${message}`
      : `[${cleanCode}] ${message}\n源码:\n${source}`;

  return {
    code: cleanCode,
    severity: options?.severity ?? 'Error',
    summary,
    message,
    sourceExcerpt,
    truncated,
    detail,
    hint: options?.hint,
  };
}

function decodeHtmlAttr(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function extractMathJaxErrors(markup: string): string[] {
  const errors: string[] = [];
  const attrRegex = /data-mjx-error="([^"]*)"/g;
  let match: RegExpExecArray | null = attrRegex.exec(markup);
  while (match !== null) {
    const decoded = decodeHtmlAttr(match[1] ?? '').trim();
    if (decoded.length > 0 && !errors.includes(decoded)) {
      errors.push(decoded);
    }
    match = attrRegex.exec(markup);
  }
  if (
    errors.length === 0 &&
    (/<merror\b/i.test(markup) ||
      /data-mml-node="merror"/i.test(markup) ||
      /class="[^"]*\bmjx-error\b[^"]*"/i.test(markup))
  ) {
    errors.push('MathJax rendered an error node (<merror>)');
  }
  return errors;
}

interface MathJaxRuntime {
  adaptor: LiteAdaptor;
  document: ReturnType<typeof mathjax.document>;
}

let sharedMathJaxRuntime: MathJaxRuntime | null = null;

function getMathJaxRuntime(): MathJaxRuntime {
  if (sharedMathJaxRuntime !== null) {
    return sharedMathJaxRuntime;
  }
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  // Exclude 'noundefined' so unknown macros emit <merror data-mjx-error="..."> instead of silent red text
  const packages = AllPackages.filter((pkg) => pkg !== 'noundefined');
  const tex = new TeX({ packages });
  const svg = new SVG({ fontCache: 'none' });
  const document = mathjax.document('', { InputJax: tex, OutputJax: svg });
  sharedMathJaxRuntime = { adaptor, document };
  return sharedMathJaxRuntime;
}

export interface MathJaxAdapterOptions {
  display?: boolean;
}

export function createMathJaxSvgAdapter(options?: MathJaxAdapterOptions): RenderAdapter {
  const defaultDisplay = options?.display ?? true;

  return {
    kind: 'mathjax',
    async render(req: PreviewRenderRequest): Promise<PreviewRenderResult> {
      const texInput =
        req.previewLatex && req.previewLatex.trim().length > 0 ? req.previewLatex : req.latex;

      if (texInput.trim().length === 0) {
        return {
          generation: req.generation,
          backend: 'mathjax',
          svg: '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" viewBox="0 0 0 0" aria-hidden="true"></svg>',
          degraded: false,
          diagnostics: [],
          cacheHit: false,
        };
      }

      const { adaptor, document } = getMathJaxRuntime();
      const node = document.convert(texInput, { display: req.display ?? defaultDisplay });
      const inner = adaptor.innerHTML(node);
      const svgMarkup = inner.includes('<svg') ? inner : adaptor.outerHTML(node);

      const mjxErrors = extractMathJaxErrors(svgMarkup);
      if (mjxErrors.length > 0) {
        const diag = summarizeRenderError(
          'MATHJAX_TEX_ERROR',
          mjxErrors.join('; '),
          texInput,
          {
            severity: 'Error',
            hint: '检查未定义宏、括号匹配或命令参数完整性',
          },
        );
        return {
          generation: req.generation,
          backend: 'mathjax',
          svg: svgMarkup,
          degraded: true,
          diagnostics: [diag],
          cacheHit: false,
          errorSummary: diag,
        };
      }

      return {
        generation: req.generation,
        backend: 'mathjax',
        svg: svgMarkup,
        degraded: false,
        diagnostics: [],
        cacheHit: false,
      };
    },
  };
}

export type LatexRustInvokeResult =
  | string
  | {
      svg: string;
      degraded?: boolean;
      diagnostics?: PreviewDiagnostic[];
    };

export function createLatexRustBridgeAdapter(
  invokeFn: (req: PreviewRenderRequest) => Promise<LatexRustInvokeResult>,
): RenderAdapter {
  return {
    kind: 'latex-rust',
    async render(req: PreviewRenderRequest): Promise<PreviewRenderResult> {
      const raw = await invokeFn(req);
      if (typeof raw === 'string') {
        return {
          generation: req.generation,
          backend: 'latex-rust',
          svg: raw,
          degraded: false,
          diagnostics: [],
          cacheHit: false,
        };
      }
      const diags = raw.diagnostics ?? [];
      return {
        generation: req.generation,
        backend: 'latex-rust',
        svg: raw.svg,
        degraded: raw.degraded ?? diags.length > 0,
        diagnostics: diags,
        cacheHit: false,
        errorSummary: diags[0],
      };
    },
  };
}

export function createHostRenderMathAdapter(
  hostFn: (tex: string, display: boolean) => Promise<string | HTMLElement>,
): RenderAdapter {
  return {
    kind: 'host',
    async render(req: PreviewRenderRequest): Promise<PreviewRenderResult> {
      const texInput =
        req.previewLatex && req.previewLatex.trim().length > 0 ? req.previewLatex : req.latex;
      const rendered = await hostFn(texInput, req.display ?? true);
      const markup = typeof rendered === 'string' ? rendered : rendered.outerHTML;
      const errors = extractMathJaxErrors(markup);
      if (errors.length > 0) {
        const diag = summarizeRenderError('HOST_RENDER_ERROR', errors.join('; '), texInput, {
          severity: 'Error',
          hint: '宿主渲染器返回了错误节点',
        });
        return {
          generation: req.generation,
          backend: 'host',
          svg: markup,
          degraded: true,
          diagnostics: [diag],
          cacheHit: false,
          errorSummary: diag,
        };
      }
      return {
        generation: req.generation,
        backend: 'host',
        svg: markup,
        degraded: false,
        diagnostics: [],
        cacheHit: false,
      };
    },
  };
}

export interface ManagedRendererOptions {
  primary: RenderAdapter;
  fallback?: RenderAdapter;
  debounceMs?: number;
  maxWaitMs?: number;
  cacheCapacity?: number;
}

export interface ManagedCacheStats {
  hits: number;
  misses: number;
  size: number;
}

export interface ManagedRenderer {
  readonly kind: RenderBackendKind;
  render(req: PreviewRenderRequest): Promise<PreviewRenderResult | null>;
  schedule(req: PreviewRenderRequest, onResult: (result: PreviewRenderResult) => void): void;
  latestGeneration(): number;
  cacheStats(): ManagedCacheStats;
  clearCache(): void;
  dispose(): void;
}

function buildCacheKey(req: PreviewRenderRequest, backend: RenderBackendKind): string {
  const tex =
    req.previewLatex && req.previewLatex.trim().length > 0 ? req.previewLatex : req.latex;
  const mode = req.mode ?? 'preview';
  const scale = Number.isFinite(req.scale) ? (req.scale ?? 1).toFixed(4) : '1.0000';
  const format = req.format ?? 'svg';
  const display = req.display ?? true;
  return `${mode}|${req.theme}|${scale}|${backend}|${format}|${display ? '1' : '0'}|${tex}`;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function createManagedRenderer(options: ManagedRendererOptions): ManagedRenderer {
  const { primary, fallback, debounceMs = 45, maxWaitMs = 150, cacheCapacity = 64 } = options;
  let highestGeneration = 0;
  let hits = 0;
  let misses = 0;
  const cache = new Map<string, PreviewRenderResult>();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingReq: PreviewRenderRequest | null = null;
  let pendingCallback: ((result: PreviewRenderResult) => void) | null = null;
  let disposed = false;

  function clearTimers(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer !== null) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  }

  function touchCache(key: string): PreviewRenderResult | undefined {
    const existing = cache.get(key);
    if (!existing) return undefined;
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }

  function storeCache(key: string, result: PreviewRenderResult): void {
    if (cacheCapacity <= 0) return;
    if (cache.has(key)) {
      cache.delete(key);
    } else if (cache.size >= cacheCapacity) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
    cache.set(key, result);
  }

  async function render(req: PreviewRenderRequest): Promise<PreviewRenderResult | null> {
    if (disposed) return null;
    if (req.generation < highestGeneration) {
      return null;
    }
    highestGeneration = req.generation;

    const key = buildCacheKey(req, primary.kind);
    const cached = touchCache(key);
    if (cached) {
      hits += 1;
      if (req.generation < highestGeneration) {
        return null;
      }
      return {
        ...cached,
        generation: req.generation,
        cacheHit: true,
      };
    }
    misses += 1;

    try {
      const out = await primary.render(req);
      if (disposed || req.generation < highestGeneration) {
        return null;
      }
      const normalized: PreviewRenderResult = {
        ...out,
        generation: req.generation,
        cacheHit: false,
        errorSummary: out.errorSummary ?? out.diagnostics[0],
      };
      storeCache(key, normalized);
      return normalized;
    } catch (primaryErr) {
      if (disposed || req.generation < highestGeneration) {
        return null;
      }
      const tex =
        req.previewLatex && req.previewLatex.trim().length > 0 ? req.previewLatex : req.latex;
      const primaryDiag = summarizeRenderError(
        'PRIMARY_RENDER_FAILED',
        toErrorMessage(primaryErr),
        tex,
        {
          severity: 'Warning',
          hint: fallback ? '已切换至离线兜底渲染器' : '请检查公式语法或渲染器状态',
        },
      );

      if (!fallback) {
        throw primaryErr;
      }

      const fbOut = await fallback.render(req);
      if (disposed || req.generation < highestGeneration) {
        return null;
      }
      // INV-012 / D-011 / A-RENDER-003: fallback MUST force degraded=true and non-empty diagnostics
      const combinedDiagnostics = [primaryDiag, ...fbOut.diagnostics];
      const degradedOut: PreviewRenderResult = {
        ...fbOut,
        generation: req.generation,
        degraded: true,
        diagnostics: combinedDiagnostics,
        cacheHit: false,
        errorSummary: primaryDiag,
      };
      storeCache(key, degradedOut);
      return degradedOut;
    }
  }

  function flushScheduled(): void {
    clearTimers();
    const req = pendingReq;
    const cb = pendingCallback;
    pendingReq = null;
    pendingCallback = null;
    if (!req || !cb || disposed) return;

    void render(req)
      .then((res) => {
        if (res !== null && !disposed && res.generation >= highestGeneration) {
          cb(res);
        }
      })
      .catch((err) => {
        if (disposed || req.generation < highestGeneration) return;
        const tex =
          req.previewLatex && req.previewLatex.trim().length > 0 ? req.previewLatex : req.latex;
        const diag = summarizeRenderError('RENDER_FAILED', toErrorMessage(err), tex, {
          severity: 'Error',
        });
        cb({
          generation: req.generation,
          backend: primary.kind,
          svg: '',
          degraded: true,
          diagnostics: [diag],
          cacheHit: false,
          errorSummary: diag,
        });
      });
  }

  function schedule(req: PreviewRenderRequest, onResult: (result: PreviewRenderResult) => void): void {
    if (disposed) return;
    if (req.generation < highestGeneration) return;
    highestGeneration = req.generation;

    pendingReq = req;
    pendingCallback = onResult;

    if (debounceMs <= 0) {
      flushScheduled();
      return;
    }

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(flushScheduled, debounceMs);
    if (maxWaitTimer === null) {
      maxWaitTimer = setTimeout(flushScheduled, maxWaitMs);
    }
  }

  return {
    kind: primary.kind,
    render,
    schedule,
    latestGeneration: () => highestGeneration,
    cacheStats: () => ({ hits, misses, size: cache.size }),
    clearCache: () => {
      cache.clear();
    },
    dispose: () => {
      disposed = true;
      clearTimers();
      pendingReq = null;
      pendingCallback = null;
    },
  };
}

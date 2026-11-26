import { DEFAULT_SETTINGS } from './types';
import type { AppSettings, LeaderKey, SlotOrderPreset, ThemeMode } from './types';

function readBracedAt(src: string, startBraceIdx: number): { content: string; nextPos: number } | null {
  if (src[startBraceIdx] !== '{') return null;
  let pos = startBraceIdx + 1;
  let depth = 1;
  while (pos < src.length && depth > 0) {
    if (src[pos] === '\\') {
      pos += 2;
      continue;
    }
    if (src[pos] === '{') depth += 1;
    else if (src[pos] === '}') depth -= 1;
    if (depth > 0) pos += 1;
  }
  const content = src.slice(startBraceIdx + 1, pos);
  return { content, nextPos: src[pos] === '}' ? pos + 1 : pos };
}

/**
 * Strips untrusted KaTeX HTML/link/image extension macros (`\htmlData`, `\htmlClass`,
 * `\htmlId`, `\htmlStyle`, `\href`, `\url`, `\includegraphics`) from user-defined templates
 * and raw LaTeX fragments so external inputs can never spoof interactive DOM attributes.
 */
export function sanitizeLatexTemplate(template: string): string {
  if (!template || !template.includes('\\')) return template;
  let out = '';
  let i = 0;
  while (i < template.length) {
    if (template[i] === '\\') {
      let end = i + 1;
      while (end < template.length && /[a-zA-Z]/.test(template[end])) end += 1;
      const macro = template.slice(i, end);
      if (
        macro === '\\htmlData' ||
        macro === '\\htmlClass' ||
        macro === '\\htmlId' ||
        macro === '\\htmlStyle' ||
        macro === '\\href'
      ) {
        let scan = end;
        while (scan < template.length && /\s/.test(template[scan])) scan += 1;
        const first = readBracedAt(template, scan);
        if (first) {
          scan = first.nextPos;
          while (scan < template.length && /\s/.test(template[scan])) scan += 1;
          const second = readBracedAt(template, scan);
          if (second) {
            out += sanitizeLatexTemplate(second.content);
            i = second.nextPos;
            continue;
          }
          i = first.nextPos;
          continue;
        }
        i = end;
        continue;
      }
      if (macro === '\\url' || macro === '\\includegraphics') {
        let scan = end;
        while (scan < template.length && /\s/.test(template[scan])) scan += 1;
        if (template[scan] === '[') {
          const closeB = template.indexOf(']', scan + 1);
          if (closeB !== -1) scan = closeB + 1;
        }
        while (scan < template.length && /\s/.test(template[scan])) scan += 1;
        const arg = readBracedAt(template, scan);
        i = arg ? arg.nextPos : end;
        continue;
      }
    }
    out += template[i];
    i += 1;
  }
  return out;
}

const VALID_THEMES = new Set<ThemeMode>(['system', 'light', 'dark']);
const VALID_LEADERS = new Set<LeaderKey>(['Tab', '/']);
const VALID_DELIMITERS = new Set(['none', 'inline', 'block', 'codeblock']);
const VALID_PRESET_ORDERS = new Set<SlotOrderPreset>(['standard', 'writing_cn']);

/**
 * Normalizes and migrates persisted `AppSettings` (e.g. automatically migrating legacy
 * `leaderKey: '\\'` to `'Tab'` so inline `\int`/`\alpha`/`\,` macros work seamlessly).
 */
export function normalizeSettings(raw?: Partial<AppSettings> | null): AppSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...raw };
  if (!VALID_THEMES.has(merged.theme)) merged.theme = DEFAULT_SETTINGS.theme;
  if (!VALID_LEADERS.has(merged.leaderKey)) {
    merged.leaderKey = 'Tab';
  }
  if (!VALID_DELIMITERS.has(merged.delimiter)) {
    merged.delimiter = DEFAULT_SETTINGS.delimiter;
  }
  if (!VALID_PRESET_ORDERS.has(merged.slotOrderPreset)) {
    merged.slotOrderPreset = DEFAULT_SETTINGS.slotOrderPreset;
  }
  if (!merged.slotOrderOverrides || typeof merged.slotOrderOverrides !== 'object') {
    merged.slotOrderOverrides = {};
  }
  return merged;
}

let externalRawLatexValidator: ((latex: string) => boolean) | null = null;

/**
 * Allows `@mathslot/ui` (which bundles KaTeX) to register a strict `katex.renderToString`
 * syntax check for exited `raw_latex` passthrough slots while keeping `@mathslot/core` dependency-free.
 */
export function registerRawLatexValidator(validator: ((latex: string) => boolean) | null): void {
  externalRawLatexValidator = validator;
}

const TWO_ARG_MACROS = new Set([
  '\\frac',
  '\\dfrac',
  '\\tfrac',
  '\\binom',
  '\\overset',
  '\\underset',
  '\\stackrel',
  '\\braket',
]);

const ONE_ARG_MACROS = new Set([
  '\\sqrt',
  '\\hat',
  '\\bar',
  '\\vec',
  '\\tilde',
  '\\dot',
  '\\ddot',
  '\\overline',
  '\\underline',
  '\\widehat',
  '\\widetilde',
  '\\overrightarrow',
  '\\overleftarrow',
  '\\overleftrightarrow',
  '\\mathbf',
  '\\mathcal',
  '\\mathbb',
  '\\mathrm',
  '\\mathfrak',
  '\\mathsf',
  '\\mathtt',
  '\\boldsymbol',
  '\\mathscr',
  '\\operatorname',
  '\\text',
  '\\boxed',
  '\\cancel',
  '\\bcancel',
  '\\xcancel',
  '\\ket',
  '\\bra',
]);

/**
 * Checks whether a raw TeX snippet is structurally balanced and safe to embed directly
 * inside an outer KaTeX formula without crashing the enclosing expression.
 */
export function isRenderableRawLatex(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;

  let braceDepth = 0;
  let lrDepth = 0;
  const envStack: string[] = [];
  let i = 0;

  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (ch === '\\') {
      if (i + 1 >= trimmed.length) return false;
      const next = trimmed[i + 1];
      if (!/[a-zA-Z]/.test(next)) {
        i += 2;
        continue;
      }
      let end = i + 1;
      while (end < trimmed.length && /[a-zA-Z]/.test(trimmed[end])) end += 1;
      const macro = trimmed.slice(i, end);
      i = end;
      if (trimmed[i] === '*') i += 1;

      if (macro === '\\left') {
        lrDepth += 1;
        while (i < trimmed.length && /\s/.test(trimmed[i])) i += 1;
        if (i >= trimmed.length) return false;
      } else if (macro === '\\right') {
        if (lrDepth <= 0) return false;
        lrDepth -= 1;
        while (i < trimmed.length && /\s/.test(trimmed[i])) i += 1;
        if (i >= trimmed.length) return false;
      } else if (macro === '\\begin' || macro === '\\end') {
        while (i < trimmed.length && /\s/.test(trimmed[i])) i += 1;
        if (trimmed[i] !== '{') return false;
        const closeIdx = trimmed.indexOf('}', i + 1);
        if (closeIdx === -1) return false;
        const envName = trimmed.slice(i + 1, closeIdx).trim();
        if (!envName) return false;
        if (macro === '\\begin') {
          envStack.push(envName);
        } else {
          if (envStack.length === 0 || envStack[envStack.length - 1] !== envName) return false;
          envStack.pop();
        }
        i = closeIdx + 1;
      } else if (TWO_ARG_MACROS.has(macro) || ONE_ARG_MACROS.has(macro)) {
        const needed = TWO_ARG_MACROS.has(macro) ? 2 : 1;
        let scan = i;
        while (scan < trimmed.length && /\s/.test(trimmed[scan])) scan += 1;
        if (macro === '\\sqrt' && trimmed[scan] === '[') {
          const closeB = trimmed.indexOf(']', scan + 1);
          if (closeB === -1) return false;
          scan = closeB + 1;
        }
        for (let a = 0; a < needed; a += 1) {
          while (scan < trimmed.length && /\s/.test(trimmed[scan])) scan += 1;
          if (scan >= trimmed.length || trimmed[scan] === '}') return false;
          if (trimmed[scan] === '{') {
            const grp = readBracedAt(trimmed, scan);
            if (!grp || trimmed[grp.nextPos - 1] !== '}') return false;
            scan = grp.nextPos;
          } else if (trimmed[scan] === '\\') {
            scan += 2;
            while (scan < trimmed.length && /[a-zA-Z]/.test(trimmed[scan])) scan += 1;
          } else {
            scan += 1;
          }
        }
      }
      continue;
    }

    if (ch === '{') {
      braceDepth += 1;
    } else if (ch === '}') {
      braceDepth -= 1;
      if (braceDepth < 0) return false;
    } else if (ch === '^' || ch === '_') {
      let scan = i + 1;
      while (scan < trimmed.length && /\s/.test(trimmed[scan])) scan += 1;
      if (scan >= trimmed.length || trimmed[scan] === '}' || trimmed[scan] === '^' || trimmed[scan] === '_') {
        return false;
      }
    }
    i += 1;
  }

  if (braceDepth !== 0 || lrDepth !== 0 || envStack.length !== 0) {
    return false;
  }

  if (externalRawLatexValidator) {
    return externalRawLatexValidator(trimmed);
  }
  return true;
}

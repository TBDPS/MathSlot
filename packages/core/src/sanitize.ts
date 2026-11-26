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

import { sanitizeLatexTemplate } from './commandSpecs';
import type { CommandCategory, CommandDef, PresetFormula } from './types';

export interface UserPresetEntry {
  id: string;
  category: string;
  name: string;
  source: string;
  desc?: string;
  tags?: string[];
  /** Set true to hide a built-in preset by id without editing source code */
  disabled?: boolean;
}

export interface UserCommandEntry {
  id: string;
  keys: string[];
  label: string;
  category: CommandCategory;
  glyph?: string;
  slots?: string[];
  latex: string;
  doc?: string;
  wrapSlot?: number | null;
  /** Set true to hide a built-in command by id without editing source code */
  disabled?: boolean;
}

const VALID_CATEGORIES = new Set<CommandCategory>([
  'structure',
  'calculus',
  'matrix',
  'accent',
  'greek',
  'symbol',
  'relation',
  'setlogic',
]);

export function parseUserPresetsJson(raw: string): {
  entries: UserPresetEntry[];
  warnings: string[];
  failed: boolean;
} {
  const warnings: string[] = [];
  if (!raw || !raw.trim()) return { entries: [], warnings, failed: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warnings.push(`presets.json 解析失败：${err instanceof Error ? err.message : String(err)}`);
    return { entries: [], warnings, failed: true };
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { presets?: unknown }).presets)
      ? (parsed as { presets: unknown[] }).presets
      : null;

  if (!list) {
    warnings.push('presets.json 格式应为数组或包含 "presets" 数组的对象');
    return { entries: [], warnings, failed: true };
  }

  const entries: UserPresetEntry[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    if (!id) {
      warnings.push(`presets.json 第 ${i + 1} 项缺少 id，已跳过`);
      continue;
    }
    if (obj.disabled === true) {
      entries.push({
        id,
        category: typeof obj.category === 'string' ? obj.category : '',
        name: typeof obj.name === 'string' ? obj.name : '',
        source: typeof obj.source === 'string' ? obj.source : '',
        disabled: true,
      });
      continue;
    }
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const rawSource = typeof obj.source === 'string' ? obj.source.trim() : '';
    const source = sanitizeLatexTemplate(rawSource);
    const category = typeof obj.category === 'string' && obj.category.trim() ? obj.category.trim() : '自定义公式';
    if (!name || !source) {
      warnings.push(`presets.json 条目 "${id}" 缺少 name 或 source，已跳过`);
      continue;
    }
    entries.push({
      id,
      category,
      name,
      source,
      desc: typeof obj.desc === 'string' ? obj.desc : '',
      tags: Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : [],
    });
  }
  return { entries, warnings, failed: false };
}

export function parseUserCommandsJson(raw: string): {
  entries: UserCommandEntry[];
  warnings: string[];
  failed: boolean;
} {
  const warnings: string[] = [];
  if (!raw || !raw.trim()) return { entries: [], warnings, failed: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warnings.push(`commands.json 解析失败：${err instanceof Error ? err.message : String(err)}`);
    return { entries: [], warnings, failed: true };
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { commands?: unknown }).commands)
      ? (parsed as { commands: unknown[] }).commands
      : null;

  if (!list) {
    warnings.push('commands.json 格式应为数组或包含 "commands" 数组的对象');
    return { entries: [], warnings, failed: true };
  }

  const entries: UserCommandEntry[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    if (!id) {
      warnings.push(`commands.json 第 ${i + 1} 项缺少 id，已跳过`);
      continue;
    }
    if (obj.disabled === true) {
      entries.push({
        id,
        keys: [],
        label: '',
        category: 'symbol',
        latex: '',
        disabled: true,
      });
      continue;
    }
    const label = typeof obj.label === 'string' ? obj.label.trim() : '';
    const rawLatex = typeof obj.latex === 'string' ? obj.latex.trim() : '';
    const latex = sanitizeLatexTemplate(rawLatex);
    const categoryRaw = typeof obj.category === 'string' ? (obj.category.trim() as CommandCategory) : 'symbol';
    const category: CommandCategory = VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : 'symbol';
    const keys = Array.isArray(obj.keys)
      ? obj.keys.filter((k): k is string => typeof k === 'string' && k.length === 1)
      : [];

    if (!label || !latex) {
      warnings.push(`commands.json 条目 "${id}" 缺少 label 或 latex，已跳过`);
      continue;
    }

    // Auto-detect $1/$2 slots if not explicitly provided
    let slots: string[] = [];
    if (Array.isArray(obj.slots)) {
      slots = obj.slots.filter((s): s is string => typeof s === 'string');
    } else {
      let maxIdx = 0;
      for (const m of latex.matchAll(/\$(\d+)/g)) {
        const n = Number(m[1]);
        if (n > maxIdx && n <= 9) maxIdx = n;
      }
      slots = Array.from({ length: maxIdx }, (_, idx) => `槽位 ${idx + 1}`);
    }

    entries.push({
      id,
      keys,
      label,
      category,
      glyph: typeof obj.glyph === 'string' && obj.glyph ? obj.glyph : label.slice(0, 4),
      slots,
      latex,
      doc: typeof obj.doc === 'string' ? obj.doc : `${label}：${latex}`,
      wrapSlot: typeof obj.wrapSlot === 'number' ? obj.wrapSlot : slots.length > 0 ? 0 : null,
    });
  }
  return { entries, warnings, failed: false };
}

export function mergePresets(
  base: readonly PresetFormula[],
  userEntries: readonly UserPresetEntry[],
): PresetFormula[] {
  if (userEntries.length === 0) return [...base];
  const byId = new Map<string, UserPresetEntry>();
  const extra: UserPresetEntry[] = [];
  const baseIds = new Set(base.map((p) => p.id));

  for (const entry of userEntries) {
    byId.set(entry.id, entry);
    if (!baseIds.has(entry.id) && !entry.disabled) {
      extra.push(entry);
    }
  }

  const merged: PresetFormula[] = [];
  for (const preset of base) {
    const ov = byId.get(preset.id);
    if (ov?.disabled) continue;
    if (ov) {
      merged.push({
        id: preset.id,
        category: ov.category || preset.category,
        name: ov.name || preset.name,
        source: ov.source || preset.source,
        desc: ov.desc ?? preset.desc,
        tags: ov.tags && ov.tags.length > 0 ? ov.tags : preset.tags,
      });
    } else {
      merged.push(preset);
    }
  }

  const extraMapped: PresetFormula[] = extra.map((item) => ({
    id: item.id,
    category: item.category || '自定义公式',
    name: item.name,
    source: item.source,
    desc: item.desc ?? '',
    tags: item.tags ?? [],
  }));
  return [...extraMapped, ...merged];
}

export function mergeCommands(
  base: readonly CommandDef[],
  userEntries: readonly UserCommandEntry[],
): CommandDef[] {
  if (userEntries.length === 0) return [...base];
  const byId = new Map<string, UserCommandEntry>();
  const extra: UserCommandEntry[] = [];
  const baseIds = new Set(base.map((c) => c.id));

  for (const entry of userEntries) {
    byId.set(entry.id, entry);
    if (!baseIds.has(entry.id) && !entry.disabled) {
      extra.push(entry);
    }
  }

  const merged: CommandDef[] = [];
  for (const cmd of base) {
    const ov = byId.get(cmd.id);
    if (ov?.disabled) continue;
    if (ov) {
      merged.push({
        ...cmd,
        keys: ov.keys.length > 0 ? ov.keys : cmd.keys,
        label: ov.label || cmd.label,
        category: ov.category || cmd.category,
        glyph: ov.glyph ?? cmd.glyph,
        slots: ov.slots ?? cmd.slots,
        latex: ov.latex || cmd.latex,
        doc: ov.doc ?? cmd.doc,
        wrapSlot: ov.wrapSlot !== undefined ? ov.wrapSlot : cmd.wrapSlot,
      });
    } else {
      merged.push(cmd);
    }
  }

  for (const item of extra) {
    merged.push({
      id: item.id,
      keys: item.keys,
      label: item.label,
      category: item.category,
      glyph: item.glyph ?? item.label.slice(0, 4),
      slots: item.slots ?? [],
      latex: item.latex,
      doc: item.doc ?? `${item.label}：${item.latex}`,
      examples: [],
      wrapSlot: item.wrapSlot ?? (item.slots && item.slots.length > 0 ? 0 : null),
    });
  }
  return merged;
}

export function serializeUserPresetsJson(entries: readonly UserPresetEntry[]): string {
  return JSON.stringify(
    {
      $comment:
        'MathSlot 用户公式库（可直接编辑，保存后在软件内点击「重载」立即生效，无需重新编译）。支持新增公式、按 id 覆盖内置公式，或设置 "disabled": true 隐藏内置条目。',
      presets: entries,
    },
    null,
    2,
  );
}

export function serializeUserCommandsJson(entries: readonly UserCommandEntry[]): string {
  return JSON.stringify(
    {
      $comment:
        'MathSlot 用户命令库（可直接编辑，保存后点击「重载」立即生效，无需重新编译）。category 可选: structure/calculus/matrix/accent/greek/symbol/relation/setlogic；latex 中用 $1/$2 标记槽位。',
      commands: entries,
    },
    null,
    2,
  );
}

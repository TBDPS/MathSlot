import {
  COMMANDS,
  COMMANDS_BY_ID,
  type CommandCategory,
  type CommandEntry,
} from '../generated/catalog';
import {
  PRESETS,
  PRESET_CATEGORIES,
  type PresetCategory,
  type PresetEntry,
} from '../generated/presets';

export interface CategoryMeta<T extends string> {
  id: 'all' | T;
  label: string;
}

export const COMMAND_CATEGORIES: readonly CategoryMeta<CommandCategory>[] = [
  { id: 'all', label: '全部' },
  { id: 'structure', label: '直达结构' },
  { id: 'calculus', label: '微积分' },
  { id: 'matrix', label: '矩阵' },
  { id: 'accent', label: '装饰' },
  { id: 'greek', label: '希腊字母' },
  { id: 'symbol', label: '数学符号' },
  { id: 'relation', label: '关系符号' },
  { id: 'setlogic', label: '集合与逻辑' },
];

export const PRESET_CATEGORY_TABS: readonly CategoryMeta<PresetCategory>[] = [
  { id: 'all', label: '全部预置' },
  ...PRESET_CATEGORIES.map((cat) => ({ id: cat, label: cat })),
];

export const D001_FEATURED_IDS = [
  'partial',
  'approx',
  'cdot',
  'times',
  'equiv',
] as const;

export function getFeaturedCommands(): CommandEntry[] {
  const out: CommandEntry[] = [];
  for (const id of D001_FEATURED_IDS) {
    const cmd = COMMANDS_BY_ID[id];
    if (cmd) out.push(cmd);
  }
  return out;
}

export function formatCommandShortcut(cmd: CommandEntry): string {
  return `▸${cmd.keys.join('')}`;
}

export function filterCommands(
  query: string,
  category: 'all' | CommandCategory,
): CommandEntry[] {
  const q = query.trim().toLowerCase();
  return COMMANDS.filter((cmd) => {
    if (category !== 'all' && cmd.category !== category) {
      return false;
    }
    if (!q) return true;
    const keysStr = cmd.keys.join('').toLowerCase();
    const shortcutStr = `▸${keysStr}`;
    return (
      cmd.id.toLowerCase().includes(q) ||
      cmd.label.toLowerCase().includes(q) ||
      keysStr.includes(q) ||
      shortcutStr.includes(q) ||
      cmd.latex.toLowerCase().includes(q) ||
      cmd.doc.toLowerCase().includes(q) ||
      cmd.glyph.toLowerCase().includes(q)
    );
  });
}

export function filterPresets(
  query: string,
  category: 'all' | PresetCategory,
): PresetEntry[] {
  const q = query.trim().toLowerCase();
  return PRESETS.filter((preset) => {
    if (category !== 'all' && preset.category !== category) {
      return false;
    }
    if (!q) return true;
    return (
      preset.id.toLowerCase().includes(q) ||
      preset.legacy_id.toLowerCase().includes(q) ||
      preset.name.toLowerCase().includes(q) ||
      preset.category.toLowerCase().includes(q) ||
      preset.source.toLowerCase().includes(q) ||
      preset.desc.toLowerCase().includes(q) ||
      preset.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  });
}

export function moveGridIndex(
  currentIndex: number,
  key: string,
  total: number,
  columns: number,
): number | null {
  if (total <= 0) return null;
  const cols = Math.max(1, columns);
  const clamped = Math.max(0, Math.min(currentIndex, total - 1));

  switch (key) {
    case 'ArrowRight':
      return Math.min(total - 1, clamped + 1);
    case 'ArrowLeft':
      return Math.max(0, clamped - 1);
    case 'ArrowDown':
      return Math.min(total - 1, clamped + cols);
    case 'ArrowUp':
      return Math.max(0, clamped - cols);
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    default:
      return null;
  }
}

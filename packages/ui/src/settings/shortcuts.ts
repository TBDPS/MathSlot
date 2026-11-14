import { createDefaultShortcuts, type ShortcutSettings } from '../client/engine';

export type ShortcutActionId = keyof ShortcutSettings;

export type ShortcutScope = 'global' | 'nav';

export interface ShortcutActionMeta {
  id: ShortcutActionId;
  label: string;
  description: string;
  scope: ShortcutScope;
  defaultShortcut: string;
}

export const DEFAULT_SHORTCUTS: ShortcutSettings = createDefaultShortcuts();

export const SHORTCUT_ACTIONS: readonly ShortcutActionMeta[] = [
  {
    id: 'copy_latex',
    label: '复制 LaTeX',
    description: '将当前格式化后的 LaTeX 复制到剪贴板',
    scope: 'global',
    defaultShortcut: DEFAULT_SHORTCUTS.copy_latex,
  },
  {
    id: 'save_snippet',
    label: '保存片段',
    description: '将当前公式保存为用户片段或公式库条目',
    scope: 'global',
    defaultShortcut: DEFAULT_SHORTCUTS.save_snippet,
  },
  {
    id: 'focus_editor',
    label: '回到输入框',
    description: '从调色板、预览或设置区显式将键盘焦点移回编辑器',
    scope: 'global',
    defaultShortcut: DEFAULT_SHORTCUTS.focus_editor,
  },
  {
    id: 'toggle_nav',
    label: '切换导航模式',
    description: '在流式输入模式与结构化槽位导航模式间切换',
    scope: 'global',
    defaultShortcut: DEFAULT_SHORTCUTS.toggle_nav,
  },
  {
    id: 'open_settings',
    label: '打开设置',
    description: '打开或聚焦设置与偏好面板',
    scope: 'global',
    defaultShortcut: DEFAULT_SHORTCUTS.open_settings,
  },
  {
    id: 'nav_next_slot',
    label: '下一个槽位（导航模式）',
    description: '在结构化导航模式下跳转到下一个槽位',
    scope: 'nav',
    defaultShortcut: DEFAULT_SHORTCUTS.nav_next_slot,
  },
  {
    id: 'nav_prev_slot',
    label: '上一个槽位（导航模式）',
    description: '在结构化导航模式下跳转到上一个槽位',
    scope: 'nav',
    defaultShortcut: DEFAULT_SHORTCUTS.nav_prev_slot,
  },
  {
    id: 'nav_parent',
    label: '左移 / 返回父层（导航模式）',
    description: '在结构化导航模式下向左或向父节点移动',
    scope: 'nav',
    defaultShortcut: DEFAULT_SHORTCUTS.nav_parent,
  },
  {
    id: 'nav_first_child',
    label: '右移 / 进入子层（导航模式）',
    description: '在结构化导航模式下向右或向子槽位移动',
    scope: 'nav',
    defaultShortcut: DEFAULT_SHORTCUTS.nav_first_child,
  },
] as const;

export interface ParsedShortcut {
  normalized: string;
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const MODIFIER_ALIASES = new Set([
  'mod',
  'ctrl',
  'control',
  'cmd',
  'command',
  'meta',
  'super',
  'cmdorctrl',
]);

const RESERVED_MOD_COMBOS = new Set([
  'Mod+Z',
  'Mod+Shift+Z',
  'Mod+Y',
  'Mod+C',
  'Mod+X',
  'Mod+V',
  'Mod+A',
]);

function normalizeKeyToken(token: string, hasAnyModifier: boolean): string | null {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'esc' || lower === 'escape') return 'Escape';
  if (lower === 'tab') return 'Tab';
  if (lower === 'enter' || lower === 'return') return 'Enter';
  if (lower === 'backspace') return 'Backspace';
  if (lower === 'del' || lower === 'delete') return 'Delete';
  if (lower === 'space' || lower === 'spacebar' || trimmed === ' ') return 'Space';
  if (lower === 'arrowleft' || lower === 'left') return 'ArrowLeft';
  if (lower === 'arrowright' || lower === 'right') return 'ArrowRight';
  if (lower === 'arrowup' || lower === 'up') return 'ArrowUp';
  if (lower === 'arrowdown' || lower === 'down') return 'ArrowDown';
  if (lower === 'home') return 'Home';
  if (lower === 'end') return 'End';
  if (lower === 'pageup') return 'PageUp';
  if (lower === 'pagedown') return 'PageDown';

  if (/^f([1-9]|1[0-2])$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const chars = Array.from(trimmed);
  if (chars.length === 1) {
    const ch = chars[0]!;
    if (/^[a-zA-Z]$/.test(ch)) {
      return hasAnyModifier ? ch.toUpperCase() : ch.toLowerCase();
    }
    return ch;
  }

  return null;
}

function tokenizeShortcut(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed === '+') {
    return ['+'];
  }

  const parts: string[] = [];
  let remaining = trimmed;
  let trailingPlus = false;
  if (remaining.endsWith('++')) {
    trailingPlus = true;
    remaining = remaining.slice(0, -1);
  } else if (remaining.endsWith('+')) {
    return null;
  }

  for (const segment of remaining.split('+')) {
    const clean = segment.trim();
    if (clean.length === 0) {
      return null;
    }
    parts.push(clean);
  }

  if (trailingPlus) {
    parts[parts.length - 1] = '+';
  }
  return parts;
}

export function parseShortcut(raw: string): ParsedShortcut | null {
  const tokens = tokenizeShortcut(raw);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  let mod = false;
  let alt = false;
  let shift = false;

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const lower = tokens[i]!.toLowerCase();
    if (MODIFIER_ALIASES.has(lower)) {
      mod = true;
    } else if (lower === 'alt' || lower === 'option') {
      alt = true;
    } else if (lower === 'shift') {
      shift = true;
    } else {
      return null;
    }
  }

  const hasAnyModifier = mod || alt || shift;
  const key = normalizeKeyToken(tokens[tokens.length - 1]!, hasAnyModifier);
  if (!key) {
    return null;
  }

  const mods: string[] = [];
  if (mod) mods.push('Mod');
  if (alt) mods.push('Alt');
  if (shift) mods.push('Shift');

  const normalized = [...mods, key].join('+');
  return { normalized, mod, alt, shift, key };
}

export function normalizeShortcut(raw: string): string {
  return parseShortcut(raw)?.normalized ?? '';
}

export function isReservedShortcut(raw: string, scope: ShortcutScope = 'global'): boolean {
  const parsed = parseShortcut(raw);
  if (!parsed) {
    return true;
  }

  if (parsed.key === 'Tab' || parsed.key === 'Escape') {
    return true;
  }

  if (
    !parsed.mod &&
    !parsed.alt &&
    (parsed.key === 'Enter' ||
      parsed.key === 'Backspace' ||
      parsed.key === 'Delete' ||
      parsed.key.startsWith('Arrow'))
  ) {
    return true;
  }

  if (RESERVED_MOD_COMBOS.has(parsed.normalized)) {
    return true;
  }

  if (!parsed.mod && !parsed.alt) {
    const isSingleChar = Array.from(parsed.key).length === 1;
    if (scope === 'global' && isSingleChar) {
      return true;
    }
    if (scope === 'nav') {
      const isValidNavLetter = !parsed.shift && /^[a-z]$/.test(parsed.key);
      if (!isValidNavLetter) {
        return true;
      }
    }
  }

  return false;
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return false;
  }

  const eventMod = Boolean(event.ctrlKey || event.metaKey);
  const eventAlt = Boolean(event.altKey);
  const eventShift = Boolean(event.shiftKey);
  if (eventMod !== parsed.mod || eventAlt !== parsed.alt || eventShift !== parsed.shift) {
    return false;
  }

  const eventKey = normalizeKeyToken(event.key, parsed.mod || parsed.alt || parsed.shift);
  if (!eventKey) {
    return false;
  }
  return eventKey === parsed.key;
}

export function formatKeyboardEventToShortcut(event: KeyboardEvent): string | null {
  if (
    event.key === 'Control' ||
    event.key === 'Shift' ||
    event.key === 'Alt' ||
    event.key === 'Meta'
  ) {
    return null;
  }
  if (event.key === 'Tab' || event.key === 'Escape') {
    return null;
  }

  const hasAnyModifier = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
  const key = normalizeKeyToken(event.key, hasAnyModifier);
  if (!key) {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export interface ShortcutValidationIssue {
  action: ShortcutActionId;
  code: 'EMPTY' | 'INVALID_FORMAT' | 'RESERVED_KEY' | 'CONFLICT';
  message: string;
  conflictWith?: ShortcutActionId[];
}

export interface ShortcutValidationResult {
  valid: boolean;
  issues: ShortcutValidationIssue[];
  byAction: Partial<Record<ShortcutActionId, ShortcutValidationIssue[]>>;
  normalized: ShortcutSettings;
}

export function validateShortcuts(shortcuts: Partial<ShortcutSettings>): ShortcutValidationResult {
  const merged: ShortcutSettings = {
    ...DEFAULT_SHORTCUTS,
    ...shortcuts,
  };
  const normalized: ShortcutSettings = { ...merged };
  const issues: ShortcutValidationIssue[] = [];
  const byAction: Partial<Record<ShortcutActionId, ShortcutValidationIssue[]>> = {};

  const pushIssue = (issue: ShortcutValidationIssue) => {
    issues.push(issue);
    const list = byAction[issue.action] ?? [];
    list.push(issue);
    byAction[issue.action] = list;
  };

  const normalizedBuckets = new Map<string, ShortcutActionMeta[]>();

  for (const meta of SHORTCUT_ACTIONS) {
    const raw = merged[meta.id] ?? '';
    if (raw.trim().length === 0) {
      pushIssue({
        action: meta.id,
        code: 'EMPTY',
        message: `「${meta.label}」快捷键不能为空`,
      });
      continue;
    }

    const parsed = parseShortcut(raw);
    if (!parsed) {
      pushIssue({
        action: meta.id,
        code: 'INVALID_FORMAT',
        message: `「${meta.label}」快捷键格式无效：${raw}`,
      });
      continue;
    }

    normalized[meta.id] = parsed.normalized;

    if (isReservedShortcut(parsed.normalized, meta.scope)) {
      pushIssue({
        action: meta.id,
        code: 'RESERVED_KEY',
        message:
          meta.scope === 'global'
            ? `「${meta.label}」不能绑定保留键或无修饰单字符 (${parsed.normalized})`
            : `「${meta.label}」不能绑定保留键 (${parsed.normalized})`,
      });
    }

    const bucket = normalizedBuckets.get(parsed.normalized) ?? [];
    bucket.push(meta);
    normalizedBuckets.set(parsed.normalized, bucket);
  }

  for (const [combo, entries] of normalizedBuckets.entries()) {
    if (entries.length < 2) {
      continue;
    }
    for (const entry of entries) {
      const others = entries.filter((other) => other.id !== entry.id);
      const otherLabels = others.map((o) => `「${o.label}」`).join('、');
      pushIssue({
        action: entry.id,
        code: 'CONFLICT',
        message: `快捷键 ${combo} 与 ${otherLabels} 冲突`,
        conflictWith: others.map((o) => o.id),
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    byAction,
    normalized,
  };
}

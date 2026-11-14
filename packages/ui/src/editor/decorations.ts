import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { COMMANDS, COMMANDS_BY_ID, type CommandEntry } from '../generated/catalog';
import {
  createEmptySnapshot,
  type EditorState,
  type EngineSnapshot,
  type SlotSnapshot,
} from '../client/engine';

export const setEngineSnapshotEffect = StateEffect.define<EngineSnapshot>();

export const engineSnapshotField = StateField.define<EngineSnapshot>({
  create: () => createEmptySnapshot(),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEngineSnapshotEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

const COMMAND_TRIGGER = '\u25b8'; // '▸'

/**
 * Look up command metadata strictly from the single source of truth `generated/catalog.ts`.
 */
export function resolveCommandByKeySequence(keysText: string): CommandEntry | undefined {
  if (!keysText) return undefined;
  return COMMANDS.find((cmd) => cmd.keys.join('') === keysText);
}

/**
 * Look up the active/pending command entry from EditorState + document text using `generated/catalog.ts`.
 */
export function resolveActiveCommand(
  snapshot: EngineSnapshot,
  docText = '',
): CommandEntry | undefined {
  if (typeof snapshot.state === 'object' && snapshot.state !== null && 'PrefixSub' in snapshot.state) {
    const key = snapshot.state.PrefixSub.key;
    const direct = resolveCommandByKeySequence(key);
    if (direct) return direct;
  }

  const triggerIdx = docText.lastIndexOf(COMMAND_TRIGGER);
  if (triggerIdx >= 0) {
    const tail = docText.slice(triggerIdx + 1);
    const keyMatch = /^([a-zA-Z]+)/.exec(tail);
    if (keyMatch?.[1]) {
      const exact = resolveCommandByKeySequence(keyMatch[1]);
      if (exact) return exact;
      const prefix = COMMANDS.find((cmd) => cmd.keys.join('').startsWith(keyMatch[1]!));
      if (prefix) return prefix;
    }
  }

  if (snapshot.active_slot_id !== null) {
    const activeSlot = snapshot.slots.find((s) => s.id === snapshot.active_slot_id);
    if (activeSlot?.role === 'Numerator' || activeSlot?.role === 'Denominator') {
      return COMMANDS_BY_ID['frac'];
    }
  }

  return undefined;
}

export function formatSlotAriaLabel(slot: SlotSnapshot): string {
  const status = slot.is_empty ? '空槽位' : '已填充';
  const active = slot.is_active ? '当前焦点' : '非当前';
  return `槽位 ${slot.id}：${slot.label}（${status}，${active}）`;
}

export function describeEditorMode(
  state: EditorState,
  isComposing: boolean,
): { code: 'idle' | 'prefix' | 'nav' | 'ime'; label: string } {
  if (isComposing) {
    return { code: 'ime', label: 'IME 组合' };
  }
  if (typeof state === 'object' && state !== null && 'Nav' in state) {
    return { code: 'nav', label: 'Nav 导航' };
  }
  if (
    state === 'PrefixRoot' ||
    (typeof state === 'object' &&
      state !== null &&
      ('PrefixSub' in state || 'Jump' in state || 'InvalidPrefix' in state))
  ) {
    return { code: 'prefix', label: 'Prefix 命令' };
  }
  return { code: 'idle', label: 'Idle 输入' };
}

class CommandBadgeWidget extends WidgetType {
  constructor(private readonly command: CommandEntry) {
    super();
  }

  override eq(other: CommandBadgeWidget): boolean {
    return this.command.id === other.command.id;
  }

  override toDOM(): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'ms-cmd-badge';
    badge.setAttribute('data-command-id', this.command.id);
    badge.setAttribute('aria-label', `${this.command.label} ${this.command.glyph}`);
    badge.title = `${this.command.label} (${this.command.latex})`;
    badge.textContent = `${this.command.glyph} ${this.command.label}`;
    return badge;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const docText = view.state.doc.toString();
  const snapshot = view.state.field(engineSnapshotField);
  const pendingDecorations: Array<{ from: number; to: number; deco: Decoration }> = [];

  // 1. Highlight streaming command prefixes (`▸<keys>`) backed by catalog.ts
  let searchFrom = 0;
  while (searchFrom < docText.length) {
    const idx = docText.indexOf(COMMAND_TRIGGER, searchFrom);
    if (idx < 0) break;

    const after = docText.slice(idx + 1);
    const match = /^([a-zA-Z]*)/.exec(after);
    const keySeq = match?.[1] ?? '';
    const end = idx + 1 + keySeq.length;
    const matchedCmd =
      resolveCommandByKeySequence(keySeq) ??
      (keySeq.length > 0
        ? COMMANDS.find((cmd) => cmd.keys.join('').startsWith(keySeq))
        : undefined);

    const ariaLabel = matchedCmd
      ? `命令前缀 ${matchedCmd.label} (${matchedCmd.glyph})`
      : '命令前缀待定';

    pendingDecorations.push({
      from: idx,
      to: end,
      deco: Decoration.mark({
        class: matchedCmd ? 'ms-cmd-prefix ms-cmd-matched' : 'ms-cmd-prefix',
        attributes: {
          'aria-label': ariaLabel,
          ...(matchedCmd ? { 'data-command-id': matchedCmd.id } : {}),
        },
      }),
    });

    if (matchedCmd) {
      pendingDecorations.push({
        from: end,
        to: end,
        deco: Decoration.widget({
          widget: new CommandBadgeWidget(matchedCmd),
          side: 1,
        }),
      });
    }

    searchFrom = Math.max(end, idx + 1);
  }

  // 2. Highlight active/empty slots when span fits within CM6 document bounds
  for (const slot of snapshot.slots) {
    const start = Math.max(0, Math.min(slot.span.start, docText.length));
    const end = Math.max(start, Math.min(slot.span.end, docText.length));
    if (end > start) {
      const classes = ['ms-slot-span'];
      if (slot.is_active) classes.push('ms-slot-span-active');
      if (slot.is_empty) classes.push('ms-slot-span-empty');
      pendingDecorations.push({
        from: start,
        to: end,
        deco: Decoration.mark({
          class: classes.join(' '),
          attributes: {
            'data-slot-id': String(slot.id),
            'aria-label': formatSlotAriaLabel(slot),
          },
        }),
      });
    }
  }

  // Sort strictly by `from`, then `to` as required by RangeSetBuilder
  pendingDecorations.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const item of pendingDecorations) {
    builder.add(item.from, item.to, item.deco);
  }

  return builder.finish();
}

const commandDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(setEngineSnapshotEffect)),
        )
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

export function createCommandDecorationsExtension(): Extension {
  return [engineSnapshotField, commandDecorationPlugin];
}

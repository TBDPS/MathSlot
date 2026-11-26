import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  showTooltip,
  type DecorationSet,
  type Tooltip,
} from '@codemirror/view';
import {
  createEmptyInlineSession,
  findEnclosingMathSpan,
  getLeaderCapsuleItems,
  handleInlineCharTyped,
  handleInlineLeaderKey,
  handleInlineLeaderTrigger,
  handleInlinePrevSlot,
  handleInlineSemicolon,
  handleInlineSpecialKey,
  mapInlineSessionThroughChange,
  type InlineActionResult,
  type InlineExpanderSettings,
  type InlineMathSpan,
  type InlineSessionState,
} from '@mathslot/core';

export interface MathSlotInlineExtensionOptions {
  getSettings: () => InlineExpanderSettings;
  openWorkbenchAtSpan: (view: EditorView, span: InlineMathSpan) => void;
}

const setInlineSessionEffect = StateEffect.define<InlineSessionState>();

function getLocalMathSpan(state: EditorState, pos: number): InlineMathSpan | null {
  const radius = 16000;
  const winStart = Math.max(0, pos - radius);
  const winEnd = Math.min(state.doc.length, pos + radius);
  const slice = state.doc.sliceString(winStart, winEnd);
  const local = findEnclosingMathSpan(slice, pos - winStart);
  if (!local) return null;
  return {
    rawFrom: local.rawFrom + winStart,
    rawTo: local.rawTo + winStart,
    contentFrom: local.contentFrom + winStart,
    contentTo: local.contentTo + winStart,
    isBlock: local.isBlock,
  };
}

function getDocThroughSpan(state: EditorState, span: InlineMathSpan): string {
  return state.doc.sliceString(0, Math.min(state.doc.length, span.rawTo + 4));
}

class PendingSlotPlaceholderWidget extends WidgetType {
  private readonly label: string;

  constructor(label: string) {
    super();
    this.label = label;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof PendingSlotPlaceholderWidget && other.label === this.label;
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'mathslot-slot-placeholder';
    el.textContent = '□';
    el.title = this.label ? `待填槽位：${this.label}（按 ; 跳入）` : '待填槽位（按 ; 跳入）';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

export function createMathSlotInlineExtension(opts: MathSlotInlineExtensionOptions): Extension {
  const sessionField = StateField.define<InlineSessionState>({
    create: () => createEmptyInlineSession(),
    update(value, tr) {
      for (const eff of tr.effects) {
        if (eff.is(setInlineSessionEffect)) {
          return eff.value;
        }
      }
      if (!tr.docChanged && !tr.selection) {
        return value;
      }
      if (!opts.getSettings().enabled || !tr.state.selection.main.empty) {
        return createEmptyInlineSession();
      }
      const newPos = tr.state.selection.main.head;
      const mathSpan = getLocalMathSpan(tr.state, newPos);
      if (!mathSpan) {
        return createEmptyInlineSession();
      }

      if (tr.docChanged) {
        let cur = value;
        let deltaAcc = 0;
        tr.changes.iterChanges((fromA, toA, fromB, toB) => {
          const insLen = toB - fromB;
          cur = mapInlineSessionThroughChange(
            cur,
            fromA + deltaAcc,
            toA + deltaAcc,
            insLen,
            newPos,
            mathSpan,
          );
          deltaAcc += insLen - (toA - fromA);
        });
        return cur;
      }

      // Selection-only movement (arrow keys / mouse click inside the same formula)
      let rawSpan = value.rawSpan;
      if (rawSpan && (newPos < rawSpan.from || newPos > rawSpan.to)) {
        rawSpan = null;
      }
      let currentSlot = value.currentSlot;
      const queue = value.queue.filter(
        (t) => t.from >= mathSpan.contentFrom && t.to <= mathSpan.contentTo,
      );
      const visited = value.visited.filter(
        (t) => t.from >= mathSpan.contentFrom && t.to <= mathSpan.contentTo,
      );
      if (currentSlot && (newPos < currentSlot.from || newPos > currentSlot.to)) {
        const hitIdx = queue.findIndex((t) => !t.isExit && newPos >= t.from && newPos <= t.to);
        if (hitIdx >= 0) {
          currentSlot = queue[hitIdx];
          queue.splice(hitIdx, 1);
        } else {
          currentSlot = null;
        }
      }
      return {
        currentSlot,
        queue,
        visited,
        leader: null,
        rawSpan,
      };
    },
  });

  const applyResult = (view: EditorView, res: InlineActionResult, mathSpan: InlineMathSpan): boolean => {
    if (res.kind === 'noop') return false;
    if (res.kind === 'open_workbench') {
      view.dispatch({ effects: setInlineSessionEffect.of(res.state) });
      opts.openWorkbenchAtSpan(view, mathSpan);
      return true;
    }
    if (res.kind === 'handled') {
      view.dispatch({
        ...(res.changes ? { changes: res.changes } : {}),
        ...(res.selection !== undefined
          ? { selection: EditorSelection.cursor(res.selection) }
          : {}),
        effects: setInlineSessionEffect.of(res.state),
        userEvent: res.changes ? 'input.type' : 'select',
        scrollIntoView: true,
      });
      return true;
    }
    return false;
  };

  const executeCapsuleLeaderKey = (view: EditorView, key: string): void => {
    const pos = view.state.selection.main.head;
    const mathSpan = getLocalMathSpan(view.state, pos);
    if (!mathSpan) return;
    const session = view.state.field(sessionField);
    if (!session.leader) return;
    const docSlice = getDocThroughSpan(view.state, mathSpan);
    const res = handleInlineLeaderKey(docSlice, pos, key, session, opts.getSettings());
    applyResult(view, res, mathSpan);
    view.focus();
  };

  const capsuleTooltipExt = showTooltip.compute([sessionField], (state): Tooltip | null => {
    const settings = opts.getSettings();
    if (!settings.enabled || !state.selection.main.empty) return null;
    const session = state.field(sessionField);
    const pos = state.selection.main.head;

    if (session.leader) {
      const prefix = session.leader.prefix;
      const items = getLeaderCapsuleItems(prefix, settings);
      return {
        pos,
        above: true,
        strictSide: false,
        arrow: false,
        create(view) {
          const dom = document.createElement('div');
          dom.className = 'mathslot-inline-capsule';
          dom.setAttribute('role', 'status');

          const head = document.createElement('span');
          head.className = 'ms-cap-lead';
          head.textContent = prefix === '' ? `▸${settings.leaderKey}` : `▸${prefix} · 空格确认`;
          dom.appendChild(head);

          const strip = document.createElement('div');
          strip.className = 'ms-cap-items';
          for (const item of items) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = [
              'ms-cap-pill',
              item.isDefault ? 'is-default' : '',
              item.isWorkbench ? 'is-workbench' : '',
              item.isSubmenu ? 'is-submenu' : '',
            ]
              .filter(Boolean)
              .join(' ');
            btn.addEventListener('mousedown', (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              executeCapsuleLeaderKey(view, item.key);
            });

            const kbd = document.createElement('kbd');
            kbd.className = 'ms-cap-key';
            kbd.textContent = item.key;

            const lbl = document.createElement('span');
            lbl.className = 'ms-cap-label';
            lbl.textContent = `${item.label}${item.isSubmenu ? '▸' : ''}`;

            btn.appendChild(kbd);
            btn.appendChild(lbl);
            strip.appendChild(btn);
          }
          dom.appendChild(strip);
          return { dom };
        },
      };
    }

    if (session.rawSpan) {
      return {
        pos,
        above: true,
        strictSide: false,
        arrow: false,
        create() {
          const dom = document.createElement('div');
          dom.className = 'mathslot-inline-capsule mathslot-raw-capsule';
          const dot = document.createElement('span');
          dot.className = 'ms-cap-raw-dot';
          const text = document.createElement('span');
          text.textContent = `原生 TeX 透传 · Enter / ${settings.leaderKey} 退出`;
          dom.appendChild(dot);
          dom.appendChild(text);
          return { dom };
        },
      };
    }

    return null;
  });

  const decorationsExt = EditorView.decorations.compute(
    [sessionField],
    (state): DecorationSet => {
      const settings = opts.getSettings();
      if (!settings.enabled) return Decoration.none;
      const session = state.field(sessionField);
      const docLen = state.doc.length;
      const ranges: Range<Decoration>[] = [];

      const clamp = (n: number): number => Math.max(0, Math.min(docLen, n));

      if (session.rawSpan) {
        const f = clamp(session.rawSpan.from);
        const t = clamp(session.rawSpan.to);
        if (f < t) {
          ranges.push(Decoration.mark({ class: 'mathslot-raw-span' }).range(f, t));
        }
      }

      if (session.currentSlot && !session.currentSlot.isExit) {
        const f = clamp(session.currentSlot.from);
        const t = clamp(session.currentSlot.to);
        if (f < t) {
          ranges.push(Decoration.mark({ class: 'mathslot-active-slot' }).range(f, t));
        }
      }

      for (const stop of session.queue) {
        if (stop.isExit) continue;
        const f = clamp(stop.from);
        const t = clamp(stop.to);
        if (f === t) {
          ranges.push(
            Decoration.widget({
              widget: new PendingSlotPlaceholderWidget(stop.label),
              side: 1,
            }).range(f),
          );
        } else if (f < t) {
          ranges.push(Decoration.mark({ class: 'mathslot-pending-slot' }).range(f, t));
        }
      }

      return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none;
    },
  );

  const keyHandlerExt = Prec.highest(
    EditorView.domEventHandlers({
      keydown(event: KeyboardEvent, view: EditorView): boolean {
        if (event.isComposing || event.keyCode === 229) return false;
        if (event.ctrlKey || event.metaKey || event.altKey) return false;

        const settings = opts.getSettings();
        if (!settings.enabled || !view.state.selection.main.empty) return false;

        const pos = view.state.selection.main.head;
        const mathSpan = getLocalMathSpan(view.state, pos);
        const session = view.state.field(sessionField);

        if (!mathSpan) {
          if (session.leader || session.rawSpan || session.currentSlot || session.queue.length > 0) {
            view.dispatch({ effects: setInlineSessionEffect.of(createEmptyInlineSession()) });
          }
          return false;
        }

        const docSlice = getDocThroughSpan(view.state, mathSpan);

        // 1. Active Leader capsule state
        if (session.leader) {
          if (event.key === settings.leaderKey && !event.shiftKey) {
            const res = handleInlineLeaderTrigger(session);
            if (applyResult(view, res, mathSpan)) {
              event.preventDefault();
              return true;
            }
          }
          const res = handleInlineLeaderKey(docSlice, pos, event.key, session, settings);
          if (res.kind === 'commit_and_fallthrough') {
            if (event.key.length === 1) {
              const charRes = handleInlineCharTyped(
                docSlice,
                pos,
                mathSpan,
                event.key,
                res.state,
                settings,
              );
              if (applyResult(view, charRes, mathSpan)) {
                event.preventDefault();
                return true;
              }
            }
            view.dispatch({ effects: setInlineSessionEffect.of(res.state) });
            return false;
          }
          if (applyResult(view, res, mathSpan)) {
            event.preventDefault();
            return true;
          }
          if (res.kind === 'noop') return false;
        }

        // 2. Leader trigger (`Tab` or `` ` ``)
        if (event.key === settings.leaderKey && !event.shiftKey) {
          const res = handleInlineLeaderTrigger(session);
          if (applyResult(view, res, mathSpan)) {
            event.preventDefault();
            return true;
          }
        }

        // 3. `Shift+Tab` backward slot jump
        if (event.key === 'Tab' && event.shiftKey) {
          const res = handleInlinePrevSlot(pos, session, mathSpan);
          if (applyResult(view, res, mathSpan)) {
            event.preventDefault();
            return true;
          }
          return false;
        }

        // 4. `;` forward slot jump (with empty optional wrapper cleanup + bare-word expansion)
        if (event.key === ';') {
          const semiRes = handleInlineSemicolon(docSlice, pos, session, mathSpan, settings);
          if (applyResult(view, semiRes, mathSpan)) {
            event.preventDefault();
            return true;
          }
          // Fall through to char handler so e.g. `pi;` without active tabstops still expands `pi` -> `\pi;`
        }

        // 5. `Enter` / `ArrowRight` exit from `\\` native TeX passthrough span
        if (session.rawSpan && (event.key === 'Enter' || event.key === 'ArrowRight')) {
          const specRes = handleInlineSpecialKey(docSlice, pos, event.key, session);
          if (applyResult(view, specRes, mathSpan)) {
            event.preventDefault();
            return true;
          }
        }

        // 6. Single printable character (`\\`, `/`, `^`, `_`, `->`, `pi `, ...)
        if (event.key.length === 1) {
          const charRes = handleInlineCharTyped(
            docSlice,
            pos,
            mathSpan,
            event.key,
            session,
            settings,
          );
          if (applyResult(view, charRes, mathSpan)) {
            event.preventDefault();
            return true;
          }
        }

        return false;
      },
    }),
  );

  return [sessionField, capsuleTooltipExt, decorationsExt, keyHandlerExt];
}

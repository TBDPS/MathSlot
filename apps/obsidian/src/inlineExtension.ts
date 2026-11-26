import katex from 'katex';
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
  buildInlinePreviewLatex,
  createActiveInlineSession,
  createEmptyInlineSession,
  findEnclosingMathSpan,
  getLeaderCapsuleItems,
  handleInlineCharTyped,
  handleInlineLeaderKey,
  handleInlineLeaderTrigger,
  handleInlinePrevSlot,
  handleInlineSemicolon,
  handleInlineSpecialKey,
  handleInlineSummonOrUpgrade,
  healIncompleteLatexForPreview,
  mapInlineSessionThroughChange,
  normalizePreviewLatex,
  type InlineActionResult,
  type InlineExpanderSettings,
  type InlineMathSpan,
  type InlineSessionState,
} from '@mathslot/core';

export interface MathSlotInlineRuntimeSettings extends InlineExpanderSettings {
  autoActivateOnClick?: boolean;
}

export interface MathSlotInlineExtensionOptions {
  getSettings: () => MathSlotInlineRuntimeSettings;
  openWorkbenchAtSpan: (view: EditorView, span: InlineMathSpan) => void;
}

export interface MathSlotInlineController {
  extension: Extension;
  summonOrUpgrade: (view?: EditorView | null) => boolean;
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

/**
 * Computes fixed horizontal anchor positions on the formula's top and bottom lines
 * so neither panel jitters left/right as the user types characters.
 */
function getFixedLineAnchors(
  state: EditorState,
  span: InlineMathSpan,
): { topPos: number; bottomPos: number } {
  const firstLine = state.doc.lineAt(span.rawFrom);
  const lastLine = state.doc.lineAt(span.rawTo);
  // Keep anchored at line start on normal lines; on very long soft-wrapped paragraphs, anchor at formula start
  const colFromLineStart = span.rawFrom - firstLine.from;
  const topPos = colFromLineStart <= 42 ? firstLine.from : span.rawFrom;
  const bottomPos = span.isBlock
    ? lastLine.from
    : colFromLineStart <= 42
      ? firstLine.from
      : span.rawFrom;
  return { topPos, bottomPos };
}

function renderHudKatexHtml(latex: string): string {
  const trustHudOnly = (ctx: { command: string }): boolean => ctx.command === '\\htmlClass';
  try {
    const normalized = normalizePreviewLatex(latex, true);
    return katex.renderToString(normalized, {
      displayMode: true,
      throwOnError: true,
      strict: false,
      trust: trustHudOnly,
      output: 'html',
    });
  } catch {
    const healed = normalizePreviewLatex(healIncompleteLatexForPreview(latex), true);
    try {
      return katex.renderToString(healed, {
        displayMode: true,
        throwOnError: false,
        strict: false,
        trust: trustHudOnly,
        output: 'html',
      });
    } catch {
      const safeEsc = latex
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<code class="ms-hud-fallback-code">${safeEsc}</code>`;
    }
  }
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

function appendHintChip(container: HTMLElement, keys: string[], label: string): void {
  const item = document.createElement('span');
  item.className = 'ms-bar-hint';
  for (let i = 0; i < keys.length; i += 1) {
    if (i > 0) {
      const slash = document.createElement('span');
      slash.className = 'ms-bar-sep';
      slash.textContent = '/';
      item.appendChild(slash);
    }
    const kbd = document.createElement('kbd');
    kbd.className = 'ms-cap-key';
    kbd.textContent = keys[i];
    item.appendChild(kbd);
  }
  const text = document.createElement('span');
  text.textContent = label;
  item.appendChild(text);
  container.appendChild(item);
}

export function createMathSlotInlineController(
  opts: MathSlotInlineExtensionOptions,
): MathSlotInlineController {
  let lastFocusedView: EditorView | null = null;

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
      const settings = opts.getSettings();
      if (!settings.enabled || !tr.state.selection.main.empty) {
        return createEmptyInlineSession();
      }
      const newPos = tr.state.selection.main.head;
      const mathSpan = getLocalMathSpan(tr.state, newPos);
      if (!mathSpan) {
        return createEmptyInlineSession();
      }

      if (!value.active) {
        if (settings.autoActivateOnClick) {
          return createActiveInlineSession();
        }
        return value;
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

      // Selection-only movement inside the same formula while session is active
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
        active: true,
        currentSlot,
        queue,
        visited,
        leader: null,
        rawSpan,
        ...(value.rawProtectedUpTo !== undefined
          ? { rawProtectedUpTo: value.rawProtectedUpTo }
          : {}),
      };
    },
  });

  const applyResult = (
    view: EditorView,
    res: InlineActionResult,
    mathSpan: InlineMathSpan | null,
  ): boolean => {
    if (res.kind === 'noop') return false;
    if (res.kind === 'open_workbench') {
      view.dispatch({ effects: setInlineSessionEffect.of(createEmptyInlineSession()) });
      if (mathSpan) {
        opts.openWorkbenchAtSpan(view, mathSpan);
      }
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

  const summonOrUpgrade = (explicitView?: EditorView | null): boolean => {
    const view = explicitView ?? lastFocusedView;
    if (!view) return false;
    const sel = view.state.selection.main;
    const mathSpan = sel.empty ? getLocalMathSpan(view.state, sel.head) : null;
    const session = view.state.field(sessionField);

    // Build local window or prefix string accurately
    if (!mathSpan) {
      const selected = view.state.doc.sliceString(sel.from, sel.to);
      const insert = `$${selected}$`;
      const cursor = sel.from + 1 + selected.length;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: EditorSelection.cursor(cursor),
        effects: setInlineSessionEffect.of(createActiveInlineSession()),
        userEvent: 'input.type',
        scrollIntoView: true,
      });
      view.focus();
      return true;
    }

    const lineEnd = view.state.doc.lineAt(mathSpan.rawTo).to;
    const docSlice = view.state.doc.sliceString(0, Math.min(view.state.doc.length, lineEnd + 2));
    const res = handleInlineSummonOrUpgrade(docSlice, sel.from, sel.to, session, mathSpan);
    applyResult(view, res, mathSpan);
    view.focus();
    return true;
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

  // 1. TOP PANEL: Stationary Adaptive Live KaTeX Preview Card (anchored above active line)
  const topPreviewTooltipExt = showTooltip.compute([sessionField], (state): Tooltip | null => {
    const settings = opts.getSettings();
    if (!settings.enabled || !state.selection.main.empty) return null;
    const session = state.field(sessionField);
    if (!session.active) return null;

    const pos = state.selection.main.head;
    const mathSpan = getLocalMathSpan(state, pos);
    if (!mathSpan) return null;

    const { topPos } = getFixedLineAnchors(state, mathSpan);
    const docSlice = getDocThroughSpan(state, mathSpan);
    const preview = buildInlinePreviewLatex(docSlice, mathSpan, session);
    const renderedHtml = renderHudKatexHtml(preview.latex);

    return {
      pos: topPos,
      above: true,
      strictSide: true,
      arrow: false,
      create() {
        const dom = document.createElement('div');
        dom.className = 'mathslot-hud-card mathslot-hud-preview';
        dom.setAttribute('aria-hidden', 'true');

        const mathBox = document.createElement('div');
        mathBox.className = 'ms-hud-math';
        mathBox.innerHTML = renderedHtml;
        dom.appendChild(mathBox);

        if (preview.isEmpty) {
          const emptyHint = document.createElement('span');
          emptyHint.className = 'ms-hud-empty-caption';
          emptyHint.textContent = `直接输入公式，或按 ${settings.leaderKey} 展开结构`;
          dom.appendChild(emptyHint);
        } else if (session.rawSpan) {
          const rawTag = document.createElement('span');
          rawTag.className = 'ms-hud-mode-tag is-raw';
          rawTag.textContent = '原生 TeX';
          dom.appendChild(rawTag);
        } else if (mathSpan.isBlock) {
          const blkTag = document.createElement('span');
          blkTag.className = 'ms-hud-mode-tag';
          blkTag.textContent = '块级 $$';
          dom.appendChild(blkTag);
        }

        return { dom };
      },
    };
  });

  // 2. BOTTOM PANEL: Stationary Breathing Status / Command Bar (anchored below active line)
  const bottomBarTooltipExt = showTooltip.compute([sessionField], (state): Tooltip | null => {
    const settings = opts.getSettings();
    if (!settings.enabled || !state.selection.main.empty) return null;
    const session = state.field(sessionField);
    if (!session.active) return null;

    const pos = state.selection.main.head;
    const mathSpan = getLocalMathSpan(state, pos);
    if (!mathSpan) return null;

    const { bottomPos } = getFixedLineAnchors(state, mathSpan);

    return {
      pos: bottomPos,
      above: false,
      strictSide: true,
      arrow: false,
      create(view) {
        const dom = document.createElement('div');
        dom.className = 'mathslot-hud-card mathslot-hud-bar';
        dom.setAttribute('role', 'status');

        // Mode A: Leader pressed -> Crisp Command Keycaps (NO redundant left Tab badge!)
        if (session.leader) {
          const prefix = session.leader.prefix;
          const items = getLeaderCapsuleItems(prefix, settings);
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

          if (prefix !== '') {
            appendHintChip(strip, ['Space'], '确认默认');
            appendHintChip(strip, ['⌫'], '上层');
          }
          dom.appendChild(strip);
          return { dom };
        }

        // Mode B: Raw LaTeX Passthrough Span (`\\`)
        if (session.rawSpan) {
          const status = document.createElement('div');
          status.className = 'ms-bar-status';
          const badge = document.createElement('span');
          badge.className = 'ms-bar-slot-pill is-raw';
          badge.textContent = '原生 TeX 透传';
          status.appendChild(badge);
          appendHintChip(status, ['Enter', settings.leaderKey], '退出透传区间');
          dom.appendChild(status);
          return { dom };
        }

        // Mode C: Breathing Default Status Bar (Active Slot Progress or Ready Hints)
        const status = document.createElement('div');
        status.className = 'ms-bar-status';
        const pendingSlots = session.queue.filter((q) => !q.isExit);
        const hasActiveSlot = Boolean(
          session.currentSlot && !session.currentSlot.isExit && session.currentSlot.label !== '',
        );

        if (hasActiveSlot || pendingSlots.length > 0) {
          const pill = document.createElement('span');
          pill.className = 'ms-bar-slot-pill';
          const curName = hasActiveSlot ? session.currentSlot!.label : pendingSlots[0]?.label ?? '槽位';
          pill.textContent =
            pendingSlots.length > 0 ? `${curName} · 余 ${pendingSlots.length}` : curName;
          status.appendChild(pill);

          appendHintChip(status, [';'], pendingSlots.length > 0 ? '下一槽' : '跳出结构');
          if (session.visited.length > 0) {
            appendHintChip(status, ['⇧Tab'], '上一槽');
          }
          appendHintChip(status, [settings.leaderKey], '结构');
          appendHintChip(status, ['Enter'], '完成');
        } else {
          appendHintChip(status, [settings.leaderKey], '结构菜单');
          appendHintChip(status, ['\\\\'], '原生TeX');
          if (!mathSpan.isBlock) {
            appendHintChip(status, ['Alt+M'], '转块级');
          }
          appendHintChip(status, ['Enter', ';'], '完成退出');
        }

        const wbBtn = document.createElement('button');
        wbBtn.type = 'button';
        wbBtn.className = 'ms-bar-workbench-btn';
        wbBtn.textContent = '2D工作台';
        wbBtn.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          view.dispatch({ effects: setInlineSessionEffect.of(createEmptyInlineSession()) });
          opts.openWorkbenchAtSpan(view, mathSpan);
        });
        status.appendChild(wbBtn);

        dom.appendChild(status);
        return { dom };
      },
    };
  });

  // Hide Obsidian's redundant lagging native block preview while our live HUD is active on `$$...$$`
  const editorAttrsExt = EditorView.editorAttributes.compute([sessionField], (state) => {
    const session = state.field(sessionField);
    if (!session.active || !state.selection.main.empty) return null;
    const span = getLocalMathSpan(state, state.selection.main.head);
    if (!span) return null;
    return {
      class: span.isBlock
        ? 'mathslot-inline-active mathslot-inline-block-active'
        : 'mathslot-inline-active',
    };
  });

  const decorationsExt = EditorView.decorations.compute(
    [sessionField],
    (state): DecorationSet => {
      const settings = opts.getSettings();
      if (!settings.enabled) return Decoration.none;
      const session = state.field(sessionField);
      if (!session.active) return Decoration.none;
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
      focus(_event: FocusEvent, view: EditorView): boolean {
        lastFocusedView = view;
        return false;
      },
      keydown(event: KeyboardEvent, view: EditorView): boolean {
        lastFocusedView = view;
        if (event.isComposing || event.keyCode === 229) return false;
        if (event.ctrlKey || event.metaKey || event.altKey) return false;

        const settings = opts.getSettings();
        if (!settings.enabled || !view.state.selection.main.empty) return false;

        const session = view.state.field(sessionField);
        if (!session.active) return false;

        const pos = view.state.selection.main.head;
        const mathSpan = getLocalMathSpan(view.state, pos);
        if (!mathSpan) {
          view.dispatch({ effects: setInlineSessionEffect.of(createEmptyInlineSession()) });
          return false;
        }

        const docSlice = getDocThroughSpan(view.state, mathSpan);

        // 1. Active Leader command menu state
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

        // 4. `;` forward slot jump, or complete & exit past `$` when at outermost balanced level
        if (event.key === ';') {
          const semiRes = handleInlineSemicolon(docSlice, pos, session, mathSpan, settings);
          if (applyResult(view, semiRes, mathSpan)) {
            event.preventDefault();
            return true;
          }
        }

        // 5. `Enter` (without Shift), `Escape`, or `ArrowRight` (exits rawSpan or completes & exits formula!)
        if (
          (event.key === 'Enter' && !event.shiftKey) ||
          event.key === 'Escape' ||
          (session.rawSpan && event.key === 'ArrowRight')
        ) {
          const specRes = handleInlineSpecialKey(
            docSlice,
            pos,
            event.key as 'Enter' | 'Escape' | 'ArrowRight',
            session,
            mathSpan,
          );
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

  return {
    extension: [
      sessionField,
      topPreviewTooltipExt,
      bottomBarTooltipExt,
      editorAttrsExt,
      decorationsExt,
      keyHandlerExt,
    ],
    summonOrUpgrade,
  };
}

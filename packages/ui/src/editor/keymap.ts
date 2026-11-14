import { Compartment, Facet, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import type { AppEvent, NavAction } from '../client/engine';

export const navModeFacet = Facet.define<boolean, boolean>({
  combine: (values) => values[values.length - 1] ?? false,
});

export interface KeymapExtensionOptions {
  dispatchEvent: (event: AppEvent) => void;
  onFocusEscape?: (direction: 'forward' | 'backward') => void;
  onCompositionChange?: (composing: boolean) => void;
  tabMovesFocus?: boolean;
  navCompartment?: Compartment;
  initialNavMode?: boolean;
}

const NAV_KEY_MAP: Readonly<Record<string, NavAction>> = {
  j: 'NextSlot',
  n: 'NextSlot',
  k: 'PrevSlot',
  p: 'PrevSlot',
  h: 'StepLeft',
  l: 'StepRight',
};

export function createMathSlotKeymapExtension(options: KeymapExtensionOptions): Extension {
  const navCompartment = options.navCompartment ?? new Compartment();
  const tabMovesFocus = options.tabMovesFocus ?? true;
  let composing = false;

  const setComposing = (next: boolean) => {
    composing = next;
    options.onCompositionChange?.(next);
  };

  const domHandlers = EditorView.domEventHandlers({
    compositionstart() {
      setComposing(true);
      return false;
    },
    compositionupdate(event) {
      setComposing(true);
      options.dispatchEvent({ ImeCompositionUpdate: event.data ?? '' });
      return false;
    },
    compositionend(event) {
      setComposing(false);
      options.dispatchEvent({ ImeCompositionCommit: event.data ?? '' });
      return false;
    },
    paste(event, view) {
      const text = event.clipboardData?.getData('text/plain') ?? '';
      event.preventDefault();
      if (text.length > 0) {
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          userEvent: 'input.paste',
        });
      }
      options.dispatchEvent({ Paste: text });
      return true;
    },
    keydown(event, view) {
      // A-EDIT-007: Never intercept or mutate during active IME composition
      if (composing || view.composing || event.isComposing) {
        return false;
      }

      // D-015: Never trap Tab / Shift+Tab focus inside editor
      if (event.key === 'Tab') {
        if (event.shiftKey) {
          options.onFocusEscape?.('backward');
          return false;
        }
        if (tabMovesFocus) {
          options.onFocusEscape?.('forward');
          return false;
        }
      }

      const isNavMode = view.state.facet(navModeFacet);
      if (isNavMode) {
        if (event.key === 'Escape') {
          event.preventDefault();
          options.dispatchEvent('ExitNavMode');
          return true;
        }
        const navAction = NAV_KEY_MAP[event.key];
        if (navAction && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          options.dispatchEvent({ Navigate: navAction });
          return true;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          return true;
        }
        return false;
      }

      if (event.key === 'Enter') {
        // D-009: Allow native multiline newline in CM6
        return false;
      }

      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        options.dispatchEvent({ KeyInput: event.key });
      }
      return false;
    },
  });

  return [
    navCompartment.of(navModeFacet.of(options.initialNavMode ?? false)),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    domHandlers,
  ];
}

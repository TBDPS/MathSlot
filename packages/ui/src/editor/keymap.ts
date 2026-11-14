import { Compartment, Facet, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import type { AppEvent, NavAction, ShortcutSettings } from '../client/engine';
import { DEFAULT_SHORTCUTS, matchesShortcut } from '../settings/shortcuts';

export const navModeFacet = Facet.define<boolean, boolean>({
  combine: (values) => values[values.length - 1] ?? false,
});

export const shortcutsFacet = Facet.define<ShortcutSettings, ShortcutSettings>({
  combine: (values) => values[values.length - 1] ?? DEFAULT_SHORTCUTS,
});

export interface ShortcutCallbacks {
  onCopyLatex?: () => void;
  onSaveSnippet?: () => void;
  onFocusEditor?: () => void;
  onToggleNav?: () => void;
  onOpenSettings?: () => void;
}

export interface KeymapExtensionOptions {
  dispatchEvent: (event: AppEvent) => void;
  onFocusEscape?: (direction: 'forward' | 'backward') => void;
  onCompositionChange?: (composing: boolean) => void;
  tabMovesFocus?: boolean;
  navCompartment?: Compartment;
  shortcutsCompartment?: Compartment;
  initialNavMode?: boolean;
  shortcuts?: Partial<ShortcutSettings>;
  shortcutCallbacks?: ShortcutCallbacks;
}

export function resolveShortcutSettings(partial?: Partial<ShortcutSettings>): ShortcutSettings {
  return {
    ...DEFAULT_SHORTCUTS,
    ...partial,
  };
}

export function createMathSlotKeymapExtension(options: KeymapExtensionOptions): Extension {
  const navCompartment = options.navCompartment ?? new Compartment();
  const shortcutsCompartment = options.shortcutsCompartment ?? new Compartment();
  const tabMovesFocus = options.tabMovesFocus ?? true;
  const initialShortcuts = resolveShortcutSettings(options.shortcuts);
  let composing = false;
  let lastKeydownInputChar: string | null = null;

  const setComposing = (next: boolean) => {
    composing = next;
    options.onCompositionChange?.(next);
  };

  const domHandlers = EditorView.domEventHandlers({
    compositionstart() {
      lastKeydownInputChar = null;
      setComposing(true);
      return false;
    },
    compositionupdate(event) {
      setComposing(true);
      options.dispatchEvent({ ImeCompositionUpdate: event.data ?? '' });
      return false;
    },
    compositionend(event) {
      lastKeydownInputChar = null;
      setComposing(false);
      options.dispatchEvent({ ImeCompositionCommit: event.data ?? '' });
      return false;
    },
    paste(event, view) {
      lastKeydownInputChar = null;
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
    keyup() {
      lastKeydownInputChar = null;
      return false;
    },
    blur() {
      lastKeydownInputChar = null;
      return false;
    },
    beforeinput(event, view) {
      if (composing || view.composing || event.isComposing) {
        lastKeydownInputChar = null;
        return false;
      }
      if (event.inputType === 'insertText' && typeof event.data === 'string' && event.data.length > 0) {
        event.preventDefault();
        if (lastKeydownInputChar === event.data) {
          lastKeydownInputChar = null;
          return true;
        }
        lastKeydownInputChar = null;
        for (const ch of event.data) {
          options.dispatchEvent({ KeyInput: ch });
        }
        return true;
      }
      return false;
    },
    keydown(event, view) {
      lastKeydownInputChar = null;
      // A-EDIT-007: Never intercept or mutate during active IME composition
      if (
        composing ||
        view.composing ||
        event.isComposing ||
        event.key === 'Process' ||
        event.key === 'Dead'
      ) {
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

      const activeShortcuts = view.state.facet(shortcutsFacet);
      const isNavMode = view.state.facet(navModeFacet);

      // Configurable global action shortcuts (D-118)
      if (event.key !== 'Escape') {
        if (matchesShortcut(event, activeShortcuts.toggle_nav)) {
          event.preventDefault();
          options.dispatchEvent(isNavMode ? 'ExitNavMode' : 'EnterNavMode');
          options.shortcutCallbacks?.onToggleNav?.();
          return true;
        }
        if (matchesShortcut(event, activeShortcuts.copy_latex)) {
          event.preventDefault();
          if (options.shortcutCallbacks?.onCopyLatex) {
            options.shortcutCallbacks.onCopyLatex();
          } else {
            options.dispatchEvent('RequestCopy');
          }
          return true;
        }
        if (matchesShortcut(event, activeShortcuts.save_snippet)) {
          event.preventDefault();
          if (options.shortcutCallbacks?.onSaveSnippet) {
            options.shortcutCallbacks.onSaveSnippet();
          } else {
            options.dispatchEvent('RequestSaveSnippet');
          }
          return true;
        }
        if (matchesShortcut(event, activeShortcuts.open_settings)) {
          event.preventDefault();
          options.shortcutCallbacks?.onOpenSettings?.();
          return true;
        }
        if (matchesShortcut(event, activeShortcuts.focus_editor)) {
          event.preventDefault();
          view.focus();
          options.shortcutCallbacks?.onFocusEditor?.();
          return true;
        }
      }

      if (isNavMode) {
        if (event.key === 'Escape') {
          event.preventDefault();
          options.dispatchEvent('ExitNavMode');
          return true;
        }

        let navAction: NavAction | null = null;
        if (matchesShortcut(event, activeShortcuts.nav_next_slot)) {
          navAction = 'NextSlot';
        } else if (matchesShortcut(event, activeShortcuts.nav_prev_slot)) {
          navAction = 'PrevSlot';
        } else if (matchesShortcut(event, activeShortcuts.nav_parent)) {
          navAction = 'StepLeft';
        } else if (matchesShortcut(event, activeShortcuts.nav_first_child)) {
          navAction = 'StepRight';
        } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          if (event.key === 'n') navAction = 'NextSlot';
          else if (event.key === 'p') navAction = 'PrevSlot';
        }

        if (navAction) {
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
        event.preventDefault();
        options.dispatchEvent({ KeyDown: 'Enter' });
        return true;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        options.dispatchEvent({ KeyDown: 'Backspace' });
        return true;
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        options.dispatchEvent({ KeyDown: 'Delete' });
        return true;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        options.dispatchEvent({ KeyDown: 'ArrowLeft' });
        return true;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        options.dispatchEvent({ KeyDown: 'ArrowRight' });
        return true;
      }

      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const lower = event.key.toLowerCase();
        if (lower === 'z' && !event.shiftKey) {
          event.preventDefault();
          options.dispatchEvent('Undo');
          return true;
        }
        if ((lower === 'z' && event.shiftKey) || (lower === 'y' && !event.shiftKey)) {
          event.preventDefault();
          options.dispatchEvent('Redo');
          return true;
        }
      }

      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        lastKeydownInputChar = event.key;
        options.dispatchEvent({ KeyInput: event.key });
        return true;
      }
      return false;
    },
  });

  return [
    navCompartment.of(navModeFacet.of(options.initialNavMode ?? false)),
    shortcutsCompartment.of(shortcutsFacet.of(initialShortcuts)),
    Prec.highest(domHandlers),
    keymap.of([...defaultKeymap]),
  ];
}

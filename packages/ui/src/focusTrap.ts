const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null && !el.hasAttribute('aria-hidden'),
  );
}

/**
 * Svelte action that sets initial focus inside a dialog (if nothing inside is focused yet),
 * traps Tab / Shift+Tab cycling within the dialog, and restores focus to the trigger element on close.
 */
export function focusTrap(node: HTMLElement): { destroy: () => void } {
  const prevFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  queueMicrotask(() => {
    if (!node.isConnected) return;
    if (document.activeElement && node.contains(document.activeElement)) return;
    const focusables = getFocusableElements(node);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      node.setAttribute('tabindex', '-1');
      node.focus();
    }
  });

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const focusables = getFocusableElements(node);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (e.shiftKey) {
      if (!active || active === first || !node.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (!active || active === last || !node.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  node.addEventListener('keydown', handleKeyDown);

  return {
    destroy() {
      node.removeEventListener('keydown', handleKeyDown);
      if (prevFocused && prevFocused.isConnected) {
        prevFocused.focus();
      }
    },
  };
}

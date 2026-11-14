const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isElementVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  if (el.closest('[hidden], [inert], [aria-hidden="true"]') !== null) {
    return false;
  }
  const view = el.ownerDocument?.defaultView;
  if (view) {
    const style = view.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
  }
  return true;
}

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }
  const candidates = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
  return candidates.filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && node.tabIndex >= 0 && isElementVisible(node),
  );
}

export function captureRestoreFocus(doc: Document | null = typeof document !== 'undefined' ? document : null): HTMLElement | null {
  if (!doc) {
    return null;
  }
  return doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
}

export function restoreFocus(target: HTMLElement | null): boolean {
  if (!target || !target.isConnected) {
    return false;
  }
  target.focus();
  return true;
}

export function focusFirstInside(
  container: HTMLElement | null,
  fallback: HTMLElement | null = null,
): HTMLElement | null {
  if (!container) {
    return null;
  }
  const preferred = container.querySelector('[data-autofocus]');
  if (
    preferred instanceof HTMLElement &&
    preferred.tabIndex >= 0 &&
    isElementVisible(preferred)
  ) {
    preferred.focus();
    return preferred;
  }
  const focusables = getFocusableElements(container);
  const target = focusables[0] ?? fallback;
  if (target) {
    target.focus();
    return target;
  }
  return null;
}

export function trapFocusKeydown(
  event: KeyboardEvent,
  container: HTMLElement | null,
  onEscape?: () => void,
): boolean {
  if (event.key === 'Escape' && onEscape) {
    event.preventDefault();
    event.stopPropagation();
    onEscape();
    return true;
  }
  if (event.key !== 'Tab' || !container) {
    return false;
  }
  const focusables = getFocusableElements(container);
  if (focusables.length === 0) {
    event.preventDefault();
    return true;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = container.ownerDocument?.activeElement;
  const activeIndex = active instanceof HTMLElement ? focusables.indexOf(active) : -1;

  if (event.shiftKey) {
    if (activeIndex <= 0) {
      event.preventDefault();
      last.focus();
      return true;
    }
    return false;
  }

  if (activeIndex === -1 || activeIndex >= focusables.length - 1) {
    event.preventDefault();
    first.focus();
    return true;
  }

  return false;
}

export type RovingOrientation = 'horizontal' | 'vertical' | 'both';

export interface RovingKeyOptions {
  orientation?: RovingOrientation;
  wrap?: boolean;
  focus?: boolean;
}

export function resolveRovingIndex(
  currentIndex: number,
  count: number,
  key: string,
  options: RovingKeyOptions = {},
): number | null {
  if (count <= 0) {
    return null;
  }
  const orientation = options.orientation ?? 'horizontal';
  const wrap = options.wrap ?? true;
  const allowHorizontal = orientation === 'horizontal' || orientation === 'both';
  const allowVertical = orientation === 'vertical' || orientation === 'both';

  let delta: number | null = null;
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return count - 1;
  }
  if ((allowHorizontal && key === 'ArrowRight') || (allowVertical && key === 'ArrowDown')) {
    delta = 1;
  } else if ((allowHorizontal && key === 'ArrowLeft') || (allowVertical && key === 'ArrowUp')) {
    delta = -1;
  }

  if (delta === null) {
    return null;
  }

  const safeCurrent = currentIndex >= 0 && currentIndex < count ? currentIndex : 0;
  if (wrap) {
    return (safeCurrent + delta + count) % count;
  }
  return Math.max(0, Math.min(count - 1, safeCurrent + delta));
}

export function handleRovingKeydown<T extends HTMLElement>(
  event: KeyboardEvent,
  items: readonly T[],
  currentIndex: number,
  onSelect: (nextIndex: number, item: T) => void,
  options: RovingKeyOptions = {},
): boolean {
  const nextIndex = resolveRovingIndex(currentIndex, items.length, event.key, options);
  if (nextIndex === null) {
    return false;
  }
  const nextItem = items[nextIndex];
  if (!nextItem) {
    return false;
  }
  event.preventDefault();
  onSelect(nextIndex, nextItem);
  if (options.focus !== false) {
    nextItem.focus();
  }
  return true;
}

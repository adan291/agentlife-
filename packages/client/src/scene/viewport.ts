/** Space taken from the window by docked UI: the team bar on the left, the terminal at the bottom. */
export interface Insets {
  /** Width in px from the left edge of the window to the right edge of the team bar (0 when collapsed away). */
  left: number;
  /** Height in px of the terminal (0 when hidden). */
  bottom: number;
}

export interface FreeViewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const VIEWPORT_MARGIN = 16;

/** The part of the window not covered by docked UI, shrunk by `margin` on every side. Never negative. */
export function freeViewport(winW: number, winH: number, insets: Insets, margin = VIEWPORT_MARGIN): FreeViewport {
  const left = Math.max(0, insets.left);
  const bottom = Math.max(0, insets.bottom);
  return {
    x: left + margin,
    y: margin,
    w: Math.max(0, winW - left - margin * 2),
    h: Math.max(0, winH - bottom - margin * 2),
  };
}

const current: Insets = { left: 0, bottom: 0 };
const listeners = new Set<() => void>();

export function getInsets(): Insets {
  return { ...current };
}

/** Called by the docked panels when their size changes. Notifies listeners only on a real change. */
export function setInsets(patch: Partial<Insets>): void {
  const left = patch.left ?? current.left;
  const bottom = patch.bottom ?? current.bottom;
  if (left === current.left && bottom === current.bottom) return;
  current.left = left;
  current.bottom = bottom;
  for (const cb of listeners) cb();
}

export function onInsetsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

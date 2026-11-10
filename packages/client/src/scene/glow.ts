/** Period of the pulse and of the badge bounce, in ms. */
export const PULSE_PERIOD_MS = 2000;

/** True when the user asks for less motion. Safe outside a browser (returns false). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Alpha of the outline around a usable object. Pulses softly between 0.25 and 0.5 (period 2 s),
 * is stronger when hovered, and is a constant when motion is reduced.
 */
export function glowAlpha(now: number, hovered: boolean, reduced: boolean): number {
  if (hovered) return 0.95;
  if (reduced) return 0.4;
  const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * now) / PULSE_PERIOD_MS);
  return 0.25 + 0.25 * wave;
}

/** Vertical offset in px of the mailbox badge: a gentle bounce, none when motion is reduced. */
export function bounceOffset(now: number, reduced: boolean): number {
  if (reduced) return 0;
  const phase = ((now % 1200) + 1200) % 1200 / 1200;
  return -Math.abs(Math.sin(phase * Math.PI)) * 4;
}

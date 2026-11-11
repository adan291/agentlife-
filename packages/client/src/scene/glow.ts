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

/** How long the mailbox calls for attention after a report arrives, in ms. */
export const ATTENTION_MS = 8000;
const ATTENTION_PERIOD_MS = 700;
/** Height in px of the mailbox bounce. */
const ATTENTION_LIFT_PX = 6;

/** True from `since` for `ATTENTION_MS`. `since` null: no call for attention. */
export function attentionActive(now: number, since: number | null): boolean {
  return since !== null && now >= since && now - since < ATTENTION_MS;
}

/**
 * Outline alpha while the mailbox calls for attention (a report arrived): bright and pulsing, steady when motion is
 * reduced. Undefined when there is no call, so the normal glow applies.
 */
export function attentionAlpha(now: number, since: number | null, reduced: boolean): number | undefined {
  if (!attentionActive(now, since)) return undefined;
  if (reduced) return 0.95;
  const wave = 0.5 + 0.5 * Math.sin((2 * Math.PI * now) / ATTENTION_PERIOD_MS);
  return 0.6 + 0.35 * wave;
}

/** Vertical offset in px (negative: up) of the mailbox while it calls for attention. 0 when motion is reduced or no call. */
export function attentionLift(now: number, since: number | null, reduced: boolean): number {
  if (reduced || !attentionActive(now, since)) return 0;
  const phase = ((now - (since ?? 0)) % ATTENTION_PERIOD_MS) / ATTENTION_PERIOD_MS;
  return -Math.abs(Math.sin(phase * Math.PI)) * ATTENTION_LIFT_PX;
}

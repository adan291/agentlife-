export const BUBBLE_MIN_MS = 4000;
export const BUBBLE_MAX_MS = 8000;

/** How long a speech bubble stays: 4 s for short text, growing with length up to 8 s. */
export function bubbleDurationMs(text: string): number {
  return Math.min(BUBBLE_MAX_MS, Math.max(BUBBLE_MIN_MS, 3000 + text.length * 40));
}

/** Short status text for the badge line. */
export function shortStatus(text: string, max = 28): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

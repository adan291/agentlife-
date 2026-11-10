import type { FlagStorage } from "./guide.ts";

/** UI text size in px: panels, terminal, team bar, tooltips. Canvas labels do not scale with it. */
export const FONT_DEFAULT = 14;
export const FONT_MIN = 12;
export const FONT_MAX = 18;
export const FONT_KEY = "agentlife-font";
export const FONT_VAR = "--al-font";

/** Colours of the DOM UI. Text colours must keep a contrast of at least 4.5:1 on the backgrounds (see tests). */
export const UI_COLOURS = {
  panelBg: "#14101f",
  inputBg: "#0b0a12",
  border: "#4d3b80",
  accent: "#ff8a1f",
  accentText: "#ffb347",
  text: "#e8e0ff",
  muted: "#b4abd6",
  error: "#ff8f8f",
  add: "#7be0a0",
  addBg: "#12301f",
  del: "#ff9a9a",
  delBg: "#3a1620",
  hunk: "#8fd8ff",
} as const;

/** `0x2fd4c2` -> `#2fd4c2`. */
export function cssHex(colour: number): string {
  return `#${(colour & 0xffffff).toString(16).padStart(6, "0")}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of `#rrggbb` (WCAG 2). */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

/** WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whole pixels inside the allowed range; anything that is not a number gives the default. */
export function clampFont(n: number): number {
  if (!Number.isFinite(n)) return FONT_DEFAULT;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(n)));
}

export function loadFont(storage: FlagStorage | undefined): number {
  try {
    const raw = storage?.getItem(FONT_KEY);
    return raw == null ? FONT_DEFAULT : clampFont(Number(raw));
  } catch {
    return FONT_DEFAULT;
  }
}

function saveFont(storage: FlagStorage | undefined, size: number): void {
  try {
    storage?.setItem(FONT_KEY, String(size));
  } catch {
    // Not remembered; the default applies next time.
  }
}

export interface Theme {
  readonly size: number;
  smaller(): void;
  bigger(): void;
  /** Called after the size changed. */
  onChange(listener: (size: number) => void): void;
}

/** Applies the saved font size to `--al-font` on the root element and persists changes (A−/A+). */
export function createTheme(
  storage: FlagStorage | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
  root: HTMLElement = document.documentElement,
): Theme {
  let size = loadFont(storage);
  const listeners: ((size: number) => void)[] = [];
  const apply = () => root.style.setProperty(FONT_VAR, `${size}px`);
  apply();
  const set = (next: number) => {
    const clamped = clampFont(next);
    if (clamped === size) return;
    size = clamped;
    apply();
    saveFont(storage, size);
    for (const l of listeners) l(size);
  };
  return {
    get size() {
      return size;
    },
    smaller: () => set(size - 1),
    bigger: () => set(size + 1),
    onChange: (l) => void listeners.push(l),
  };
}

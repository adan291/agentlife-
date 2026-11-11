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
  /** Dividers and card outlines. Decorative: the content does not depend on seeing them. */
  border: "#4d3b80",
  /** Outline of buttons and form controls. It marks where the control is, so it keeps 3:1 against the backgrounds. */
  controlBorder: "#7a66b8",
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

/** Minimum contrast: 4.5:1 for text (WCAG AA), 3:1 for icons and the outline of controls. */
export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_UI_CONTRAST = 3;

export interface ContrastPair {
  /** Where the pair is used. */
  name: string;
  fg: string;
  bg: string;
  min: number;
}

const C = UI_COLOURS;
/** Every foreground/background pair `themeCss()` and the DOM components put together. The unit test checks them all. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { name: "text on panels", fg: C.text, bg: C.panelBg, min: MIN_TEXT_CONTRAST },
  { name: "text on inputs and the terminal", fg: C.text, bg: C.inputBg, min: MIN_TEXT_CONTRAST },
  { name: "muted text on panels", fg: C.muted, bg: C.panelBg, min: MIN_TEXT_CONTRAST },
  { name: "muted text on inputs", fg: C.muted, bg: C.inputBg, min: MIN_TEXT_CONTRAST },
  { name: "headings on panels", fg: C.accentText, bg: C.panelBg, min: MIN_TEXT_CONTRAST },
  { name: "headings on inputs", fg: C.accentText, bg: C.inputBg, min: MIN_TEXT_CONTRAST },
  { name: "errors on panels", fg: C.error, bg: C.panelBg, min: MIN_TEXT_CONTRAST },
  { name: "errors on inputs", fg: C.error, bg: C.inputBg, min: MIN_TEXT_CONTRAST },
  { name: "diff added lines", fg: C.add, bg: C.addBg, min: MIN_TEXT_CONTRAST },
  { name: "diff deleted lines", fg: C.del, bg: C.delBg, min: MIN_TEXT_CONTRAST },
  { name: "diff hunk headers", fg: C.hunk, bg: C.inputBg, min: MIN_TEXT_CONTRAST },
  { name: "button label, hover (on inputBg)", fg: C.text, bg: C.inputBg, min: MIN_TEXT_CONTRAST },
  { name: "button label, pressed", fg: C.text, bg: C.border, min: MIN_TEXT_CONTRAST },
  { name: "button label, disabled", fg: C.muted, bg: C.inputBg, min: MIN_TEXT_CONTRAST },
  { name: "highlighted button and badges", fg: C.inputBg, bg: C.accent, min: MIN_TEXT_CONTRAST },
  { name: "highlighted button, hover", fg: C.inputBg, bg: C.accentText, min: MIN_TEXT_CONTRAST },
  { name: "control outline on panels", fg: C.controlBorder, bg: C.panelBg, min: MIN_UI_CONTRAST },
  { name: "control outline on inputs", fg: C.controlBorder, bg: C.inputBg, min: MIN_UI_CONTRAST },
  { name: "hover outline on panels", fg: C.accent, bg: C.panelBg, min: MIN_UI_CONTRAST },
];

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

/** Spacing scale in px: the only paddings, margins and gaps the components use. */
export const SPACING = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 24 } as const;
export const RADIUS_PX = 6;
/** Shadow of raised elements (panels, toasts, tooltips, the guide). */
export const SHADOW = "0 4px 16px rgba(0, 0, 0, 0.5)";
/** Focus ring colour; contrast against `panelBg` and `inputBg` is checked in the tests. */
export const FOCUS_COLOUR = "#8fd8ff";

/**
 * Design tokens as CSS custom properties, plus the base look of buttons and form controls (hover, focus-visible, pressed, disabled).
 * Components use `var(--al-s2)`, `var(--al-radius)`, `var(--al-border)` and `var(--al-shadow)` instead of literals.
 */
export function themeCss(): string {
  return `
:root { color-scheme: dark; --al-s1: ${SPACING.s1}px; --al-s2: ${SPACING.s2}px; --al-s3: ${SPACING.s3}px; --al-s4: ${SPACING.s4}px; --al-s5: ${SPACING.s5}px; --al-radius: ${RADIUS_PX}px; --al-border: ${UI_COLOURS.border}; --al-control: ${UI_COLOURS.controlBorder}; --al-shadow: ${SHADOW}; --al-focus: ${FOCUS_COLOUR}; --al-accent: ${UI_COLOURS.accent}; }
.al-shell :focus-visible { outline: 2px solid var(--al-focus); outline-offset: 2px; }
.al-btn { background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid var(--al-control); border-radius: var(--al-radius); padding: var(--al-s1) var(--al-s3); font: inherit; cursor: pointer; transition: border-color 0.1s, background 0.1s; }
.al-btn:hover:not(:disabled) { border-color: var(--al-accent); background: ${UI_COLOURS.inputBg}; color: ${UI_COLOURS.text}; }
.al-btn:active:not(:disabled) { background: ${UI_COLOURS.border}; color: ${UI_COLOURS.text}; transform: translateY(1px); }
.al-btn:disabled { background: ${UI_COLOURS.inputBg}; color: ${UI_COLOURS.muted}; border-style: dashed; cursor: default; }
.al-input, .al-shell select { background: ${UI_COLOURS.inputBg}; color: ${UI_COLOURS.text}; border: 1px solid var(--al-control); border-radius: var(--al-radius); font: inherit; }
.al-input:hover, .al-shell select:hover { border-color: var(--al-accent); }
.al-shell option { background: ${UI_COLOURS.inputBg}; color: ${UI_COLOURS.text}; }
@media (prefers-reduced-motion: reduce) { .al-btn { transition: none; } }
`;
}

export function installThemeStyles(): void {
  if (typeof document === "undefined" || document.getElementById("al-theme")) return;
  const style = document.createElement("style");
  style.id = "al-theme";
  style.textContent = themeCss();
  document.head.appendChild(style);
}

export interface Theme {
  readonly size: number;
  smaller(): void;
  bigger(): void;
  /** Called after the size changed. */
  onChange(listener: (size: number) => void): void;
}

/** Installs the design tokens, applies the saved font size to `--al-font` on the root element and persists changes (A−/A+). */
export function createTheme(
  storage: FlagStorage | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
  root: HTMLElement = document.documentElement,
): Theme {
  installThemeStyles();
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

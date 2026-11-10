import type { FlagStorage } from "./guide.ts";
import { UI_COLOURS, installThemeStyles } from "./theme.ts";

/** Fixed sizes of the shell regions (px). */
export const TOP_BAR_PX = 48;
export const SIDE_EXPANDED_PX = 240;
export const SIDE_COLLAPSED_PX = 52;
/** Height of the dock header row: all the dock shows when collapsed. */
export const DOCK_HEADER_PX = 32;
/** Padding inside the dock body, added to the lines. */
const DOCK_BODY_PAD_PX = 6;
export const DOCK_MIN_LINES = 3;
export const DOCK_DEFAULT_LINES = 6;
/** The expanded dock never takes more than this share of the window height. */
export const DOCK_MAX_SHARE = 0.5;

/** Width below which the side bar starts collapsed. */
export const BREAK_SIDE_PX = 900;
/** Width below which the stepper is compact, the dock starts collapsed and panels take the stage width. */
export const BREAK_COMPACT_PX = 640;
/** Height below which the dock starts collapsed. */
export const BREAK_SHORT_PX = 560;

export const SIDE_KEY = "agentlife-side-collapsed";
export const DOCK_KEY = "agentlife-dock-collapsed";
export const DOCK_PX_KEY = "agentlife-dock-px";

/** What the user chose. `null`: no choice yet, so the breakpoints decide. */
export interface ShellPrefs {
  sideCollapsed: boolean | null;
  dockCollapsed: boolean | null;
  /** Height in px of the dock body (the part under the header); `null`: default lines. */
  dockBodyPx: number | null;
}

export interface ShellViewport {
  width: number;
  height: number;
  /** Height in px of one terminal line at the current text size. */
  lineHeight: number;
}

export interface ShellTemplate {
  sideW: number;
  /** Total dock height including its header. */
  dockH: number;
  sideCollapsed: boolean;
  dockCollapsed: boolean;
  /** Narrow window: the stepper shows only the current step. */
  compactStepper: boolean;
}

/** Smallest and largest dock body height for a window: 3 lines up to half the window height (header included). */
export function dockBodyBounds(vp: ShellViewport): { min: number; max: number } {
  const min = Math.round(vp.lineHeight * DOCK_MIN_LINES) + DOCK_BODY_PAD_PX;
  const max = Math.max(0, Math.floor(vp.height * DOCK_MAX_SHARE) - DOCK_HEADER_PX);
  return { min: Math.min(min, max), max };
}

/** Dock body height for a request: the default when `null`, otherwise kept inside the bounds. */
export function clampDockBody(px: number | null, vp: ShellViewport): number {
  const { min, max } = dockBodyBounds(vp);
  const wanted = px !== null && Number.isFinite(px) ? px : Math.round(vp.lineHeight * DOCK_DEFAULT_LINES) + DOCK_BODY_PAD_PX;
  return Math.round(Math.min(max, Math.max(min, wanted)));
}

/** Grid tracks and region modes for the user's choices and the window size. Pure. */
export function shellTemplate(prefs: ShellPrefs, vp: ShellViewport): ShellTemplate {
  const compact = vp.width < BREAK_COMPACT_PX;
  const sideCollapsed = prefs.sideCollapsed ?? vp.width < BREAK_SIDE_PX;
  const dockCollapsed = prefs.dockCollapsed ?? (compact || vp.height < BREAK_SHORT_PX);
  return {
    sideW: sideCollapsed ? SIDE_COLLAPSED_PX : SIDE_EXPANDED_PX,
    dockH: dockCollapsed ? DOCK_HEADER_PX : DOCK_HEADER_PX + clampDockBody(prefs.dockBodyPx, vp),
    sideCollapsed,
    dockCollapsed,
    compactStepper: compact,
  };
}

export const DEFAULT_PREFS: ShellPrefs = { sideCollapsed: null, dockCollapsed: null, dockBodyPx: null };

function readFlag(storage: FlagStorage | undefined, key: string): boolean | null {
  try {
    const v = storage?.getItem(key);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

export function loadShellPrefs(storage: FlagStorage | undefined): ShellPrefs {
  let px: number | null = null;
  try {
    const raw = storage?.getItem(DOCK_PX_KEY);
    const n = raw == null ? NaN : Number(raw);
    px = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  } catch {
    px = null;
  }
  return { sideCollapsed: readFlag(storage, SIDE_KEY), dockCollapsed: readFlag(storage, DOCK_KEY), dockBodyPx: px };
}

export function saveShellPrefs(storage: FlagStorage | undefined, prefs: ShellPrefs): void {
  try {
    if (prefs.sideCollapsed !== null) storage?.setItem(SIDE_KEY, prefs.sideCollapsed ? "1" : "0");
    if (prefs.dockCollapsed !== null) storage?.setItem(DOCK_KEY, prefs.dockCollapsed ? "1" : "0");
    if (prefs.dockBodyPx !== null) storage?.setItem(DOCK_PX_KEY, String(prefs.dockBodyPx));
  } catch {
    // Not remembered; the breakpoints decide next time.
  }
}

const CSS = `
.al-shell { display: grid; position: fixed; inset: 0; width: 100vw; height: 100vh; overflow: hidden; grid-template-columns: var(--side-w, ${SIDE_EXPANDED_PX}px) minmax(0, 1fr); grid-template-rows: ${TOP_BAR_PX}px minmax(0, 1fr) var(--dock-h, ${DOCK_HEADER_PX}px); grid-template-areas: "top top" "side stage" "dock dock"; }
@supports (height: 100dvh) { .al-shell { height: 100dvh; } }
.al-top { grid-area: top; min-width: 0; min-height: 0; overflow: hidden; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--al-s3); padding: 0 var(--al-s3); box-sizing: border-box; background: ${UI_COLOURS.panelBg}; border-bottom: 1px solid var(--al-border); color: ${UI_COLOURS.text}; font: var(--al-font, 14px)/1.4 monospace; }
.al-top-left { display: flex; align-items: center; gap: var(--al-s3); min-width: 0; }
.al-top-mid { display: flex; justify-content: center; min-width: 0; overflow: hidden; }
.al-top-right { display: flex; align-items: center; gap: var(--al-s2); }
.al-title { margin: 0; font: inherit; font-weight: bold; letter-spacing: 0.08em; color: ${UI_COLOURS.accentText}; white-space: nowrap; }
.al-shell[data-compact="true"]:has(.al-status:not([hidden])) .al-title { display: none; }
.al-side { grid-area: side; min-width: 0; min-height: 0; overflow: hidden; box-sizing: border-box; background: ${UI_COLOURS.panelBg}; border-right: 1px solid var(--al-border); }
.al-stage { grid-area: stage; position: relative; min-width: 0; min-height: 0; overflow: hidden; }
.al-stage > canvas { position: absolute; top: 0; left: 0; display: block; }
.al-stage-banners { position: absolute; z-index: 12; top: var(--al-s2); left: var(--al-s2); right: var(--al-s2); display: flex; flex-direction: column; align-items: center; gap: var(--al-s2); pointer-events: none; }
.al-stage-banners > * { pointer-events: auto; max-width: min(560px, 100%); }
.al-dock { grid-area: dock; min-width: 0; min-height: 0; overflow: hidden; position: relative; box-sizing: border-box; background: ${UI_COLOURS.inputBg}; box-shadow: inset 0 1px 0 var(--al-border); }
`;

export interface Shell {
  readonly root: HTMLElement;
  readonly topBar: HTMLElement;
  /** Top bar slots, left to right: title and connection status, stepper, controls. */
  readonly topLeft: HTMLElement;
  readonly topCentre: HTMLElement;
  readonly topRight: HTMLElement;
  readonly side: HTMLElement;
  readonly stage: HTMLElement;
  /** Column at the top of the stage for the your-turn toast and notices: directly under the top bar. */
  readonly banners: HTMLElement;
  readonly dock: HTMLElement;
  readonly template: ShellTemplate;
  toggleSide(): void;
  toggleDock(): void;
  /** Dock body height chosen by dragging; kept inside the bounds and remembered. */
  setDockBody(px: number): void;
  /** Bounds of the dock body for the current window and text size (drag limits). */
  dockBounds(): { min: number; max: number };
  /** Recompute after something the template depends on changed (window, text size). */
  refresh(): void;
  /** Runs after the template changed (also when only the dock height changed). */
  onChange(listener: (t: ShellTemplate) => void): void;
}

export interface ShellOptions {
  /** Height in px of one terminal line; depends on the text size. */
  getLineHeight?: () => number;
  storage?: FlagStorage | undefined;
  parent?: HTMLElement;
}

/**
 * Builds the CSS-grid shell: top bar, side bar, stage and dock. Nothing else positions these regions.
 * `--side-w` and `--dock-h` come from `shellTemplate`; `data-*` attributes on the root tell the components which mode they are in.
 */
export function createShell(options: ShellOptions = {}): Shell {
  const storage = "storage" in options ? options.storage : typeof localStorage === "undefined" ? undefined : localStorage;
  const lineHeight = options.getLineHeight ?? (() => 21);

  installThemeStyles();
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "al-shell";
  const topBar = document.createElement("header");
  topBar.className = "al-top";
  const topLeft = document.createElement("div");
  topLeft.className = "al-top-left";
  const title = document.createElement("h1");
  title.className = "al-title";
  title.textContent = "AGENT LIFE";
  topLeft.appendChild(title);
  const topCentre = document.createElement("div");
  topCentre.className = "al-top-mid";
  const topRight = document.createElement("div");
  topRight.className = "al-top-right";
  topBar.append(topLeft, topCentre, topRight);
  const side = document.createElement("aside");
  side.className = "al-side";
  side.setAttribute("aria-label", "Team");
  const stage = document.createElement("main");
  stage.className = "al-stage";
  const banners = document.createElement("div");
  banners.className = "al-stage-banners";
  stage.appendChild(banners);
  const dock = document.createElement("section");
  dock.className = "al-dock";
  root.append(topBar, side, stage, dock);
  (options.parent ?? document.body).appendChild(root);

  let prefs = loadShellPrefs(storage);
  const listeners: ((t: ShellTemplate) => void)[] = [];
  const viewport = (): ShellViewport => ({ width: window.innerWidth, height: window.innerHeight, lineHeight: lineHeight() });
  let template = shellTemplate(prefs, viewport());

  const same = (a: ShellTemplate, b: ShellTemplate) =>
    a.sideW === b.sideW && a.dockH === b.dockH && a.sideCollapsed === b.sideCollapsed && a.dockCollapsed === b.dockCollapsed && a.compactStepper === b.compactStepper;

  const apply = () => {
    root.style.setProperty("--side-w", `${template.sideW}px`);
    root.style.setProperty("--dock-h", `${template.dockH}px`);
    root.dataset["sideCollapsed"] = String(template.sideCollapsed);
    root.dataset["dockCollapsed"] = String(template.dockCollapsed);
    root.dataset["compact"] = String(template.compactStepper);
  };
  apply();

  const recompute = () => {
    const next = shellTemplate(prefs, viewport());
    if (same(next, template)) return;
    template = next;
    apply();
    for (const l of listeners) l(template);
  };
  const choose = (patch: Partial<ShellPrefs>) => {
    prefs = { ...prefs, ...patch };
    saveShellPrefs(storage, prefs);
    recompute();
  };

  window.addEventListener("resize", recompute);

  return {
    root,
    topBar,
    topLeft,
    topCentre,
    topRight,
    side,
    stage,
    banners,
    dock,
    get template() {
      return template;
    },
    toggleSide: () => choose({ sideCollapsed: !template.sideCollapsed }),
    toggleDock: () => choose({ dockCollapsed: !template.dockCollapsed }),
    setDockBody: (px) => choose({ dockBodyPx: clampDockBody(px, viewport()), dockCollapsed: false }),
    dockBounds: () => dockBodyBounds(viewport()),
    refresh: recompute,
    onChange: (l) => void listeners.push(l),
  };
}

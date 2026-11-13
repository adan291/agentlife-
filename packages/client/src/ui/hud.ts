import type { ConnectionStatus } from "../transport.ts";
import { UI_COLOURS } from "./theme.ts";
import { inTextField, isPaletteKey, isViewKey, otherView } from "./view-mode.ts";
import { balanceText } from "./wallet.ts";
import type { ViewMode } from "./view-mode.ts";

const CSS = `
.al-hud { font: var(--al-font, 14px)/1.4 monospace; color: ${UI_COLOURS.text}; }
.al-status { display: flex; align-items: center; min-width: 0; background: ${UI_COLOURS.inputBg}; border: 1px solid var(--al-border); border-radius: var(--al-radius); padding: var(--al-s1) var(--al-s3); white-space: nowrap; }
.al-status[hidden] { display: none; }
.al-status > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.al-status[data-status="reconnecting"] { border-color: var(--al-accent); color: ${UI_COLOURS.accentText}; }
.al-notice { background: ${UI_COLOURS.panelBg}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); padding: var(--al-s1) var(--al-s3); color: ${UI_COLOURS.accentText}; box-shadow: var(--al-shadow); }
.al-notice[hidden] { display: none; }
.al-floor-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${UI_COLOURS.accentText}; font-weight: bold; }
.al-floor-label[hidden] { display: none; }
.al-shell[data-compact="true"] .al-floor-label { display: none; }
.al-corner { position: absolute; z-index: 11; top: var(--al-s2); left: var(--al-s2); display: flex; align-items: center; gap: var(--al-s2); pointer-events: none; }
.al-balance, .al-level { padding: var(--al-s1) var(--al-s3); background: ${UI_COLOURS.panelBg}; border: 1px solid var(--al-border); border-radius: var(--al-radius); font-weight: bold; white-space: nowrap; color: ${UI_COLOURS.accentText}; box-shadow: var(--al-shadow); pointer-events: none; }
.al-balance[hidden], .al-level[hidden] { display: none; }
.al-toast { position: absolute; z-index: 12; bottom: var(--al-s4); left: 50%; transform: translateX(-50%); max-width: calc(100% - var(--al-s4)); background: ${UI_COLOURS.panelBg}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); padding: var(--al-s2) var(--al-s4); box-shadow: var(--al-shadow); opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.al-toast[data-show="true"] { opacity: 1; }
.al-arrange-open { position: absolute; z-index: 11; top: var(--al-s2); right: var(--al-s2); }
.al-arrange-open[hidden] { display: none; }
`;

/** Text size controls (A− / A+). */
export interface FontControls {
  smaller(): void;
  bigger(): void;
}

/** Where the HUD parts live: the top bar slots and the stage. */
export interface HudMounts {
  /** Connection status goes here, after the title. */
  left: HTMLElement;
  /** Zoom, text size and help buttons. */
  right: HTMLElement;
  /** Persistent notice (below the top bar) and transient toast (bottom). */
  banners: HTMLElement;
  stage: HTMLElement;
}

export interface Hud {
  setStatus(status: ConnectionStatus): void;
  setZoomLabel(zoom: number): void;
  /** The Ecto balance, in the top left corner of the stage. `null` hides it (no economy: the recorded demo, the scripted engine). */
  setBalance(balance: number | null): void;
  /** The user's level, next to the balance ("Lv 3"). `null` hides it (no progress: the recorded demo, the scripted engine). */
  setLevel(text: string | null, title?: string): void;
  toast(text: string, ms?: number): void;
  /** Persistent line at the top of the stage (null hides it). */
  setNotice(text: string | null): void;
  /** Name of the floor the user is on, in the top bar. */
  setFloor(name: string): void;
  /** Text of the Elevator shortcut (it counts the floors that wait for the user). */
  setElevatorLabel(label: string, title?: string): void;
  /** The view in use; the button offers the other one. */
  setView(view: ViewMode): void;
  /** The Arrange button, in the corner of the stage: shown on project floors of the live hotel only; pressed while arranging. */
  setArrange(available: boolean, active: boolean): void;
}

/** Top bar controls and stage messages: zoom button, text size, help, connection status, notice and toast. */
export function createHud(
  mounts: HudMounts,
  onZoom: () => void,
  onHelp: () => void = () => {},
  font?: FontControls,
  onUseHere: () => void = () => {},
  onElevator: () => void = () => {},
  onView: () => void = () => {},
  onPalette: () => void = () => {},
  onArrange: () => void = () => {},
): Hud {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const button = (text: string, label?: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = "al-btn";
    b.type = "button";
    b.textContent = text;
    if (label) {
      b.title = label;
      b.setAttribute("aria-label", label);
    }
    return b;
  };

  const elevator = button("Elevator", "Take the elevator to another floor");
  elevator.addEventListener("click", onElevator);
  mounts.right.appendChild(elevator);
  const arrangeButton = button("Arrange", "Move and turn the furniture of this floor");
  arrangeButton.classList.add("al-arrange-open");
  arrangeButton.hidden = true;
  arrangeButton.setAttribute("aria-pressed", "false");
  arrangeButton.addEventListener("click", onArrange);
  // On the stage, not in the top bar: the bar has no room for one more button without taking the labels from the stepper.
  mounts.stage.appendChild(arrangeButton);
  const viewButton = button("List");
  viewButton.addEventListener("click", onView);
  mounts.right.appendChild(viewButton);
  const palette = button("Commands", "Open the command palette (Ctrl+K)");
  palette.addEventListener("click", onPalette);
  mounts.right.appendChild(palette);
  const zoom = button("");
  zoom.title = "Toggle zoom (Z)";
  zoom.addEventListener("click", onZoom);
  mounts.right.appendChild(zoom);
  if (font) {
    for (const [text, label, act] of [
      ["A−", "Smaller text", font.smaller],
      ["A+", "Larger text", font.bigger],
    ] as const) {
      const b = button(text, label);
      b.addEventListener("click", act);
      mounts.right.appendChild(b);
    }
  }
  const help = button("?", "How it works");
  help.title = "How it works";
  help.addEventListener("click", onHelp);
  mounts.right.appendChild(help);

  const status = document.createElement("div");
  status.className = "al-hud al-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const statusText = document.createElement("span");
  const useHere = button("Use here");
  useHere.hidden = true;
  useHere.style.marginLeft = "var(--al-s3)";
  useHere.addEventListener("click", onUseHere);
  status.append(statusText, useHere);
  mounts.left.appendChild(status);

  const floor = document.createElement("span");
  floor.className = "al-hud al-floor-label";
  floor.setAttribute("aria-label", "Current floor");
  floor.hidden = true;
  mounts.left.appendChild(floor);

  const balance = document.createElement("span");
  balance.className = "al-hud al-balance";
  balance.hidden = true;
  balance.setAttribute("role", "status");
  const balanceNum = document.createElement("span");
  const balanceWord = document.createElement("span");
  balanceWord.textContent = " Ecto";
  balance.append(balanceNum, balanceWord);
  // On the stage, not in the top bar: the bar has no room for one more chip without taking the labels from the stepper.
  // The balance and the level of the user share one corner container, side by side.
  const level = document.createElement("span");
  level.className = "al-hud al-level";
  level.hidden = true;
  level.setAttribute("role", "status");
  const corner = document.createElement("div");
  corner.className = "al-corner";
  corner.append(balance, level);
  mounts.stage.appendChild(corner);

  const notice = document.createElement("div");
  notice.className = "al-hud al-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  mounts.banners.appendChild(notice);

  const toast = document.createElement("div");
  toast.className = "al-hud al-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  mounts.stage.appendChild(toast);

  window.addEventListener("keydown", (e) => {
    if (isPaletteKey(e)) {
      // Browsers bind Ctrl+K to the address bar search.
      e.preventDefault();
      onPalette();
      return;
    }
    if (inTextField(e.target)) return;
    if (isViewKey(e)) onView();
    else if (e.key === "z" || e.key === "Z") onZoom();
  });

  let timer: number | undefined;
  return {
    setStatus(s) {
      status.dataset["status"] = s;
      statusText.textContent =
        s === "reconnecting" ? "Reconnecting…" : s === "connecting" ? "Connecting…" : s === "replaced" ? "AGENT LIFE is open in another tab" : "";
      status.hidden = s === "open";
      useHere.hidden = s !== "replaced";
    },
    setZoomLabel(z) {
      zoom.textContent = `${z}×`;
    },
    setNotice(text) {
      notice.hidden = text === null;
      notice.textContent = text ?? "";
    },
    setFloor(name) {
      floor.textContent = name;
      floor.title = `You are on: ${name}`;
      floor.hidden = name === "";
    },
    setElevatorLabel(label, title) {
      elevator.textContent = label;
      const t = title ?? "Take the elevator to another floor";
      elevator.title = t;
      elevator.setAttribute("aria-label", label === "Elevator" ? t : `${label}. ${t}`);
    },
    setView(view) {
      const next = otherView(view);
      viewButton.textContent = next === "list" ? "List" : "Hotel";
      const text = next === "list" ? "Show the list of projects (L)" : "Show the hotel (L)";
      viewButton.title = text;
      viewButton.setAttribute("aria-label", text);
    },
    setArrange(available, active) {
      arrangeButton.hidden = !available;
      arrangeButton.setAttribute("aria-pressed", String(active));
      arrangeButton.dataset["active"] = String(active);
    },
    setBalance(value) {
      balance.hidden = value === null;
      if (value === null) return;
      const text = balanceText(value);
      balanceNum.textContent = String(value);
      balance.title = text;
      balance.setAttribute("aria-label", text);
    },
    setLevel(text, title) {
      level.hidden = text === null;
      if (text === null) return;
      level.textContent = text;
      level.title = title ?? text;
      level.setAttribute("aria-label", title ?? text);
    },
    toast(text, ms = 2500) {
      toast.textContent = text;
      toast.dataset["show"] = "true";
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        toast.dataset["show"] = "false";
      }, ms);
    },
  };
}

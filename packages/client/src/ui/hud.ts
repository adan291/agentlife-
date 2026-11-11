import type { ConnectionStatus } from "../transport.ts";
import { UI_COLOURS } from "./theme.ts";

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
.al-toast { position: absolute; z-index: 12; bottom: var(--al-s4); left: 50%; transform: translateX(-50%); max-width: calc(100% - var(--al-s4)); background: ${UI_COLOURS.panelBg}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); padding: var(--al-s2) var(--al-s4); box-shadow: var(--al-shadow); opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.al-toast[data-show="true"] { opacity: 1; }
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
  toast(text: string, ms?: number): void;
  /** Persistent line at the top of the stage (null hides it). */
  setNotice(text: string | null): void;
  /** Name of the floor the user is on, in the top bar. */
  setFloor(name: string): void;
  /** Text of the Elevator shortcut (it counts the floors that wait for the user). */
  setElevatorLabel(label: string, title?: string): void;
}

/** Top bar controls and stage messages: zoom button, text size, help, connection status, notice and toast. */
export function createHud(
  mounts: HudMounts,
  onZoom: () => void,
  onHelp: () => void = () => {},
  font?: FontControls,
  onUseHere: () => void = () => {},
  onElevator: () => void = () => {},
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
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "z" || e.key === "Z") onZoom();
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

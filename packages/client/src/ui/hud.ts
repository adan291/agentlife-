import type { ConnectionStatus } from "../transport.ts";
import { UI_COLOURS } from "./theme.ts";

const CSS = `
.al-hud { position: fixed; z-index: 10; font: var(--al-font, 14px)/1.4 monospace; color: ${UI_COLOURS.text}; }
.al-hud-top { top: 10px; right: 10px; display: flex; gap: 8px; align-items: center; }
.al-btn { background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid ${UI_COLOURS.border}; border-radius: 4px; padding: 4px 10px; font: inherit; cursor: pointer; }
.al-btn:hover { border-color: ${UI_COLOURS.accent}; }
.al-status { top: 10px; left: 10px; background: ${UI_COLOURS.panelBg}; border: 1px solid ${UI_COLOURS.border}; border-radius: 4px; padding: 4px 10px; }
.al-status[data-status="open"] { display: none; }
.al-status[data-status="reconnecting"] { border-color: ${UI_COLOURS.accent}; color: ${UI_COLOURS.accentText}; }
.al-notice { top: 52px; left: 50%; transform: translateX(-50%); background: ${UI_COLOURS.panelBg}; border: 1px solid ${UI_COLOURS.accent}; border-radius: 4px; padding: 4px 12px; color: ${UI_COLOURS.accentText}; }
.al-notice[hidden] { display: none; }
.al-toast { bottom: calc(var(--al-terminal-h, 0px) + 16px); left: 50%; transform: translateX(-50%); background: ${UI_COLOURS.panelBg}; border: 1px solid ${UI_COLOURS.accent}; border-radius: 4px; padding: 6px 14px; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.al-toast[data-show="true"] { opacity: 1; }
`;

/** Text size controls (A− / A+). */
export interface FontControls {
  smaller(): void;
  bigger(): void;
}

export interface Hud {
  setStatus(status: ConnectionStatus): void;
  setZoomLabel(zoom: number): void;
  toast(text: string, ms?: number): void;
  /** Persistent line at the top (null hides it). */
  setNotice(text: string | null): void;
}

/** Small DOM overlay: zoom button, text size, connection banner and transient messages. */
export function createHud(onZoom: () => void, onHelp: () => void = () => {}, font?: FontControls): Hud {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const top = document.createElement("div");
  top.className = "al-hud al-hud-top";
  const zoom = document.createElement("button");
  zoom.className = "al-btn";
  zoom.type = "button";
  zoom.title = "Toggle zoom (Z)";
  zoom.addEventListener("click", onZoom);
  top.appendChild(zoom);
  const help = document.createElement("button");
  help.className = "al-btn";
  help.type = "button";
  help.textContent = "?";
  help.title = "How it works";
  help.setAttribute("aria-label", "How it works");
  help.addEventListener("click", onHelp);
  top.appendChild(help);
  if (font) {
    for (const [text, label, act] of [
      ["A−", "Smaller text", font.smaller],
      ["A+", "Larger text", font.bigger],
    ] as const) {
      const b = document.createElement("button");
      b.className = "al-btn";
      b.type = "button";
      b.textContent = text;
      b.title = label;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", act);
      top.appendChild(b);
    }
  }

  const status = document.createElement("div");
  status.className = "al-hud al-status";
  status.setAttribute("role", "status");

  const notice = document.createElement("div");
  notice.className = "al-hud al-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;

  const toast = document.createElement("div");
  toast.className = "al-hud al-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  document.body.append(top, status, notice, toast);
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "z" || e.key === "Z") onZoom();
  });

  let timer: number | undefined;
  return {
    setStatus(s) {
      status.dataset["status"] = s;
      status.textContent = s === "reconnecting" ? "Reconnecting…" : s === "connecting" ? "Connecting…" : "";
    },
    setZoomLabel(z) {
      zoom.textContent = `${z}×`;
    },
    setNotice(text) {
      notice.hidden = text === null;
      notice.textContent = text ?? "";
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

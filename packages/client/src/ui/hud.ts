import type { ConnectionStatus } from "../transport.ts";

const CSS = `
.al-hud { position: fixed; z-index: 10; font: 12px/1.3 monospace; color: #e8e0ff; }
.al-hud-top { top: 10px; right: 10px; display: flex; gap: 8px; align-items: center; }
.al-btn { background: #14101f; color: #e8e0ff; border: 1px solid #4d3b80; border-radius: 4px; padding: 4px 10px; font: inherit; cursor: pointer; }
.al-btn:hover { border-color: #ff8a1f; }
.al-status { top: 10px; left: 10px; background: #14101f; border: 1px solid #4d3b80; border-radius: 4px; padding: 4px 10px; }
.al-status[data-status="open"] { display: none; }
.al-status[data-status="reconnecting"] { border-color: #ff8a1f; color: #ffb347; }
.al-notice { top: 10px; left: 50%; transform: translateX(-50%); background: #14101f; border: 1px solid #ff8a1f; border-radius: 4px; padding: 4px 12px; color: #ffb347; }
.al-notice[hidden] { display: none; }
.al-toast { bottom: 16px; left: 50%; transform: translateX(-50%); background: #14101f; border: 1px solid #ff8a1f; border-radius: 4px; padding: 6px 14px; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.al-toast[data-show="true"] { opacity: 1; }
`;

export interface Hud {
  setStatus(status: ConnectionStatus): void;
  setZoomLabel(zoom: number): void;
  toast(text: string, ms?: number): void;
  /** Persistent line at the top (null hides it). */
  setNotice(text: string | null): void;
}

/** Small DOM overlay: zoom button, connection banner and transient messages. */
export function createHud(onZoom: () => void): Hud {
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

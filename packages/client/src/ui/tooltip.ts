import { ROLE_INFO } from "@agentlife/shared";
import type { AgentId, AgentState } from "@agentlife/shared";

export const DWELL_MS = 300;
const MARGIN = 8;
/** Offset of the tooltip from the pointer. */
const OFFSET = 14;

export interface TooltipContent {
  title: string;
  lines: string[];
}

/** What the world view needs from a tooltip; the DOM implementation is `createTooltip`. */
export interface HoverSink {
  /** Pointer rests on `key` at viewport position (x, y). The tooltip shows after the dwell time. */
  hover(key: string, x: number, y: number, content: () => TooltipContent): void;
  hide(): void;
}

/** Top-left position for a tooltip of size w×h near the pointer, kept inside the viewport. */
export function clampTooltip(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  let left = x + OFFSET;
  let top = y + OFFSET;
  if (left + w + MARGIN > vw) left = x - OFFSET - w;
  if (top + h + MARGIN > vh) top = y - OFFSET - h;
  left = Math.max(MARGIN, Math.min(left, Math.max(MARGIN, vw - w - MARGIN)));
  top = Math.max(MARGIN, Math.min(top, Math.max(MARGIN, vh - h - MARGIN)));
  return { left, top };
}

/** Lines of an agent tooltip: its part in the flow, current state and status text, and the model when known. */
export function agentTooltip(id: AgentId, state: AgentState | undefined, text: string | undefined, model: string | undefined): TooltipContent {
  const info = ROLE_INFO[id];
  const lines = [info.does];
  if (state) lines.push(`State: ${state.replace("_", " ")}${text ? ` - ${text}` : ""}`);
  if (model) lines.push(`Model: ${model}`);
  return { title: info.name, lines };
}

const CSS = `
.al-tooltip { position: fixed; z-index: 30; max-width: 260px; pointer-events: none; background: #14101f; color: #e8e0ff; border: 1px solid #ff8a1f; border-radius: 4px; padding: 6px 10px; font: 12px/1.4 monospace; box-sizing: border-box; }
.al-tooltip[hidden] { display: none; }
.al-tooltip b { display: block; color: #ffb347; margin-bottom: 2px; }
.al-tooltip span { display: block; overflow-wrap: anywhere; }
`;

/** One DOM element that follows the pointer. Text is set with textContent only. */
export function createTooltip(): HoverSink {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement("div");
  el.className = "al-tooltip";
  el.setAttribute("role", "tooltip");
  el.hidden = true;
  document.body.appendChild(el);

  let key: string | null = null;
  let shown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pos = { x: 0, y: 0 };
  let content: (() => TooltipContent) | null = null;

  const place = () => {
    const { left, top } = clampTooltip(pos.x, pos.y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };
  const render = () => {
    if (!content) return;
    const c = content();
    const title = document.createElement("b");
    title.textContent = c.title;
    const rows = c.lines.map((l) => {
      const s = document.createElement("span");
      s.textContent = l;
      return s;
    });
    el.replaceChildren(title, ...rows);
    el.hidden = false;
    shown = true;
    place();
  };

  const hide = () => {
    clearTimeout(timer);
    timer = undefined;
    key = null;
    content = null;
    shown = false;
    el.hidden = true;
  };

  return {
    hover(k, x, y, c) {
      pos = { x, y };
      content = c;
      if (k !== key) {
        // Pointer moved to another target: restart the dwell.
        clearTimeout(timer);
        key = k;
        shown = false;
        el.hidden = true;
        timer = setTimeout(render, DWELL_MS);
        return;
      }
      if (shown) {
        render(); // refresh live text (agent state) and follow the pointer
      }
    },
    hide,
  };
}

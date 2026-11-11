import { ROLE_INFO } from "@agentlife/shared";
import type { AgentId, AgentState, AgentWork } from "@agentlife/shared";
import { UI_COLOURS } from "./theme.ts";
import { workTooltipLines, workVisible } from "./work.ts";

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
  /** Pointer rests on `key` at stage position (x, y). The tooltip shows after the dwell time. */
  hover(key: string, x: number, y: number, content: () => TooltipContent): void;
  /** Shows the tooltip at once and hides it after `ms` (team bar click). Any `hide()` or `hover()` of another target cancels it. */
  pin(key: string, x: number, y: number, content: () => TooltipContent, ms: number): void;
  hide(): void;
}

/** Top-left position for a tooltip of size w×h near the pointer, kept inside the host (vw×vh). */
export function clampTooltip(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  let left = x + OFFSET;
  let top = y + OFFSET;
  if (left + w + MARGIN > vw) left = x - OFFSET - w;
  if (top + h + MARGIN > vh) top = y - OFFSET - h;
  left = Math.max(MARGIN, Math.min(left, Math.max(MARGIN, vw - w - MARGIN)));
  top = Math.max(MARGIN, Math.min(top, Math.max(MARGIN, vh - h - MARGIN)));
  return { left, top };
}

/**
 * Lines of an agent tooltip: its part in the flow, current state and status text, and the model when known.
 * While the agent works, also what it works on (task title, step, elapsed time, context use, file counts).
 */
export function agentTooltip(
  id: AgentId,
  state: AgentState | undefined,
  text: string | undefined,
  model: string | undefined,
  work?: AgentWork,
  now: number = Date.now(),
): TooltipContent {
  const info = ROLE_INFO[id];
  const lines = [info.does];
  if (state) lines.push(`State: ${state.replace("_", " ")}${text ? ` - ${text}` : ""}`);
  if (model) lines.push(`Model: ${model}`);
  if (work && workVisible(state)) lines.push(...workTooltipLines(work, now));
  return { title: info.name, lines };
}

const CSS = `
.al-tooltip { position: absolute; z-index: 30; max-width: min(340px, calc(100% - var(--al-s4))); pointer-events: none; background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); box-shadow: var(--al-shadow); padding: var(--al-s2) var(--al-s3); font: var(--al-font, 14px)/1.5 monospace; box-sizing: border-box; }
.al-tooltip[hidden] { display: none; }
.al-tooltip b { display: block; color: ${UI_COLOURS.accentText}; margin-bottom: 2px; }
.al-tooltip span { display: block; overflow-wrap: anywhere; }
`;

/** One DOM element that follows the pointer inside `host` (the stage). Positions are host-relative. Text is set with textContent only. */
export function createTooltip(host: HTMLElement = document.body): HoverSink {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement("div");
  el.className = "al-tooltip";
  el.setAttribute("role", "tooltip");
  el.hidden = true;
  host.appendChild(el);

  let key: string | null = null;
  let shown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pinTimer: ReturnType<typeof setTimeout> | undefined;
  let pos = { x: 0, y: 0 };
  let content: (() => TooltipContent) | null = null;

  const place = () => {
    const { left, top } = clampTooltip(pos.x, pos.y, el.offsetWidth, el.offsetHeight, host.clientWidth, host.clientHeight);
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
    clearTimeout(pinTimer);
    timer = undefined;
    pinTimer = undefined;
    key = null;
    content = null;
    shown = false;
    el.hidden = true;
  };

  return {
    hover(k, x, y, c) {
      // A pinned tooltip (team bar click) stays until its time is up, unless the pointer goes to another target.
      if (pinTimer !== undefined && k === key) return;
      pos = { x, y };
      content = c;
      if (k !== key) {
        // Pointer moved to another target: restart the dwell.
        clearTimeout(timer);
        clearTimeout(pinTimer);
        pinTimer = undefined;
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
    pin(k, x, y, c, ms) {
      hide();
      key = k;
      pos = { x, y };
      content = c;
      render();
      pinTimer = setTimeout(hide, ms);
    },
    hide,
  };
}

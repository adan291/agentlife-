import { ROLE_INFO } from "@agentlife/shared";
import type { ActivityLine, AgentId } from "@agentlife/shared";
import { ROLE_COLOURS } from "../palette.ts";
import { formatTime } from "./board.ts";
import { UI_COLOURS, cssHex } from "./theme.ts";
import { DOCK_HEADER_PX } from "./shell.ts";
import type { Shell } from "./shell.ts";

/** The terminal keeps this many lines; older ones are dropped. */
export const TERMINAL_MAX_LINES = 300;
export type TerminalFilter = AgentId | "all";
export const TERMINAL_AGENTS: readonly AgentId[] = ["architect", "developer", "qa", "builder"];

/** Ring buffer of activity lines plus the agent filter. Pure: the DOM layer renders `visible()`. */
export class TerminalModel {
  private all: ActivityLine[] = [];
  filter: TerminalFilter = "all";

  get size(): number {
    return this.all.length;
  }

  /** Replaces the content (welcome snapshot after a reload). */
  seed(lines: readonly ActivityLine[]): void {
    this.all = lines.slice(-TERMINAL_MAX_LINES);
  }

  push(line: ActivityLine): void {
    this.all.push(line);
    if (this.all.length > TERMINAL_MAX_LINES) this.all.splice(0, this.all.length - TERMINAL_MAX_LINES);
  }

  /** Lines that pass the filter, oldest first (newest at the bottom). */
  visible(): ActivityLine[] {
    return this.filter === "all" ? this.all.slice() : this.all.filter((l) => l.agentId === this.filter);
  }
}

/** One terminal row as plain parts: `HH:MM:SS  Role  text`. */
export function formatLine(line: ActivityLine): { time: string; role: string; text: string } {
  return { time: formatTime(line.ts), role: ROLE_INFO[line.agentId].name, text: line.text };
}

/** Pixels from the bottom within which the view still follows new lines. */
const BOTTOM_SLACK_PX = 4;

/** Follow new lines unless the user scrolled up to read older ones. */
export function shouldAutoScroll(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= BOTTOM_SLACK_PX;
}

const CSS = `
.al-term { height: 100%; color: ${UI_COLOURS.text}; font: var(--al-font, 14px)/1.5 monospace; box-sizing: border-box; display: flex; flex-direction: column; }
.al-term-grip { position: absolute; z-index: 1; top: 0; left: 0; right: 0; height: 6px; cursor: ns-resize; background: ${UI_COLOURS.border}; touch-action: none; }
.al-term[data-collapsed="true"] .al-term-grip, .al-term[data-collapsed="true"] .al-term-body { display: none; }
.al-term-head { display: flex; gap: 8px; align-items: center; height: ${DOCK_HEADER_PX}px; padding: 0 8px; box-sizing: border-box; flex: none; }
.al-term-head b { color: ${UI_COLOURS.accentText}; margin-right: auto; }
.al-term-head select { background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid ${UI_COLOURS.border}; border-radius: 4px; font: inherit; padding: 0 4px; }
.al-term-body { overflow-y: auto; overflow-x: hidden; padding: 2px 8px 4px; flex: 1; min-height: 0; }
.al-term-row { white-space: pre-wrap; overflow-wrap: anywhere; }
.al-term-time { color: ${UI_COLOURS.muted}; margin-right: 1.5ch; }
.al-term-role { font-weight: bold; margin-right: 1.5ch; }
.al-term-empty { color: ${UI_COLOURS.muted}; }
`;

export interface Terminal {
  push(line: ActivityLine): void;
  seed(lines: readonly ActivityLine[]): void;
  readonly model: TerminalModel;
}

/** Activity terminal in the dock. The shell owns its height (drag the top edge, or collapse to the header row). */
export function createTerminal(shell: Shell): Terminal {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const model = new TerminalModel();
  const root = document.createElement("div");
  root.className = "al-term";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Agent activity");

  const grip = document.createElement("div");
  grip.className = "al-term-grip";
  grip.title = "Drag to resize";
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-orientation", "horizontal");

  const head = document.createElement("div");
  head.className = "al-term-head";
  const title = document.createElement("b");
  title.textContent = "Activity";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Filter by agent");
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All agents";
  select.appendChild(all);
  for (const id of TERMINAL_AGENTS) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = ROLE_INFO[id].name;
    select.appendChild(o);
  }
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "al-btn";
  head.append(title, select, toggle);

  const body = document.createElement("div");
  body.className = "al-term-body";
  body.setAttribute("role", "log");
  body.setAttribute("aria-live", "off");
  root.append(grip, head, body);
  shell.dock.appendChild(root);

  const setCollapsed = (collapsed: boolean) => {
    root.dataset["collapsed"] = String(collapsed);
    toggle.textContent = collapsed ? "Show" : "Hide";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };
  toggle.addEventListener("click", () => shell.toggleDock());
  setCollapsed(shell.template.dockCollapsed);
  shell.onChange((t) => {
    const was = root.dataset["collapsed"] === "true";
    setCollapsed(t.dockCollapsed);
    if (was && !t.dockCollapsed) body.scrollTop = body.scrollHeight;
  });

  const render = () => {
    const stick = shouldAutoScroll(body.scrollTop, body.clientHeight, body.scrollHeight);
    const keep = body.scrollTop;
    const rows = model.visible().map((line) => {
      const f = formatLine(line);
      const row = document.createElement("div");
      row.className = "al-term-row";
      const time = document.createElement("span");
      time.className = "al-term-time";
      time.textContent = f.time;
      const role = document.createElement("span");
      role.className = "al-term-role";
      role.style.color = cssHex(ROLE_COLOURS[line.agentId]);
      role.textContent = f.role;
      row.append(time, role, document.createTextNode(f.text));
      return row;
    });
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "al-term-empty";
      empty.textContent = "Nothing yet. Agent activity shows up here.";
      body.replaceChildren(empty);
      return;
    }
    body.replaceChildren(...rows);
    body.scrollTop = stick ? body.scrollHeight : keep;
  };

  select.addEventListener("change", () => {
    model.filter = select.value as TerminalFilter;
    render();
    body.scrollTop = body.scrollHeight;
  });

  // Resize by dragging the top edge upwards; the shell keeps the height between 3 lines and half the window.
  grip.addEventListener("pointerdown", (e) => {
    const startY = e.clientY;
    const startH = body.offsetHeight;
    grip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => shell.setDockBody(startH + (startY - ev.clientY));
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  });

  render();

  return {
    model,
    push(line) {
      model.push(line);
      render();
    },
    seed(lines) {
      model.seed(lines);
      render();
      body.scrollTop = body.scrollHeight;
    },
  };
}

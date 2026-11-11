import { ROLE_INFO } from "@agentlife/shared";
import type { ActivityLine, AgentId } from "@agentlife/shared";
import { ROLE_COLOURS } from "../palette.ts";
import { formatTime } from "./board.ts";
import { lineTag } from "./work.ts";
import { UI_COLOURS, cssHex } from "./theme.ts";
import { DOCK_HEADER_PX } from "./shell.ts";
import type { Shell } from "./shell.ts";

/** The terminal keeps this many lines; older ones are dropped. */
export const TERMINAL_MAX_LINES = 300;
export type TerminalFilter = AgentId | "all";
export const TERMINAL_AGENTS: readonly AgentId[] = ["architect", "developer", "qa", "builder"];

/** Ring buffer of activity lines plus the agent filter and the unread count. Pure: the DOM layer renders `visible()`. */
export class TerminalModel {
  private all: ActivityLine[] = [];
  filter: TerminalFilter = "all";
  /** Lines that arrived while the dock was collapsed and have not been shown yet. */
  unread = 0;

  get size(): number {
    return this.all.length;
  }

  /** Replaces the content (welcome snapshot after a reload). Seeded lines count as read. */
  seed(lines: readonly ActivityLine[]): void {
    this.all = lines.slice(-TERMINAL_MAX_LINES);
    this.unread = 0;
  }

  /** `unseen`: nobody can see the line right now (dock collapsed), so it counts as unread. */
  push(line: ActivityLine, unseen = false): void {
    this.all.push(line);
    if (this.all.length > TERMINAL_MAX_LINES) this.all.splice(0, this.all.length - TERMINAL_MAX_LINES);
    if (unseen) this.unread = Math.min(this.unread + 1, TERMINAL_MAX_LINES);
  }

  markRead(): void {
    this.unread = 0;
  }

  /** Newest line of any agent (the filter does not apply); shown in the collapsed dock header. */
  latest(): ActivityLine | undefined {
    return this.all[this.all.length - 1];
  }

  /** Lines that pass the filter, oldest first (newest at the bottom). */
  visible(): ActivityLine[] {
    return this.filter === "all" ? this.all.slice() : this.all.filter((l) => l.agentId === this.filter);
  }
}

/** One terminal row as plain parts: `HH:MM:SS  Role  #d232 develop  text`. `tag` is empty for lines that belong to no job. */
export function formatLine(line: ActivityLine): { time: string; role: string; tag: string; text: string } {
  return { time: formatTime(line.ts), role: ROLE_INFO[line.agentId].name, tag: lineTag(line), text: line.text };
}

/** Text of the collapsed dock header: the newest line, or a hint while there is none. */
export function collapsedSummary(line: ActivityLine | undefined): string {
  if (!line) return "No activity yet";
  const f = formatLine(line);
  return `${f.time}  ${f.role}  ${f.tag ? `${f.tag}  ` : ""}${f.text}`;
}

/** "3 new" for the unread badge; empty for none. */
export function unreadText(n: number): string {
  return n > 0 ? `${n} new` : "";
}

/** Pixels from the bottom within which the view still follows new lines. */
const BOTTOM_SLACK_PX = 4;

/** Follow new lines unless the user scrolled up to read older ones. */
export function shouldAutoScroll(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= BOTTOM_SLACK_PX;
}

/** Pixels per arrow key press on the resize handle. */
const KEY_STEP_PX = 24;

const CSS = `
.al-term { height: 100%; color: ${UI_COLOURS.text}; font: var(--al-font, 14px)/1.5 monospace; box-sizing: border-box; display: flex; flex-direction: column; }
.al-term-grip { position: absolute; z-index: 1; top: 0; left: 0; right: 0; height: 6px; cursor: ns-resize; background: var(--al-border); touch-action: none; }
.al-term-grip:hover, .al-term-grip:focus-visible { background: var(--al-accent); }
.al-term[data-collapsed="true"] .al-term-grip, .al-term[data-collapsed="true"] .al-term-body { display: none; }
.al-term-head { display: flex; gap: var(--al-s2); align-items: center; height: ${DOCK_HEADER_PX}px; padding: 0 var(--al-s2); box-sizing: border-box; flex: none; }
.al-term-head b { color: ${UI_COLOURS.accentText}; flex: none; }
.al-term-latest { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${UI_COLOURS.muted}; }
.al-term[data-collapsed="false"] .al-term-latest { visibility: hidden; }
.al-term-unread { flex: none; padding: 0 var(--al-s2); border-radius: var(--al-s3); background: var(--al-accent); color: ${UI_COLOURS.inputBg}; font-weight: bold; white-space: nowrap; }
.al-term-unread[hidden] { display: none; }
.al-term[data-collapsed="true"] .al-term-head select { display: none; }
.al-term-head select { padding: 0 var(--al-s1); }
.al-term-body { overflow-y: auto; overflow-x: hidden; padding: var(--al-s1) var(--al-s2); flex: 1; min-height: 0; }
.al-term-row { white-space: pre-wrap; overflow-wrap: anywhere; }
.al-term-time { color: ${UI_COLOURS.muted}; margin-right: 1.5ch; }
.al-term-role { font-weight: bold; margin-right: 1.5ch; }
.al-term-tag { color: ${UI_COLOURS.accentText}; margin-right: 1.5ch; }
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
  grip.title = "Drag to resize (or use the arrow keys)";
  grip.tabIndex = 0;
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-label", "Resize activity");
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
  const latest = document.createElement("span");
  latest.className = "al-term-latest";
  const unread = document.createElement("span");
  unread.className = "al-term-unread";
  unread.hidden = true;
  unread.setAttribute("role", "status");
  head.append(title, latest, unread, select, toggle);

  const body = document.createElement("div");
  body.className = "al-term-body";
  body.setAttribute("role", "log");
  body.setAttribute("aria-live", "off");
  root.append(grip, head, body);
  shell.dock.appendChild(root);

  const collapsed = () => root.dataset["collapsed"] === "true";
  const paintSummary = () => {
    const text = collapsed() ? collapsedSummary(model.latest()) : "";
    latest.textContent = text;
    latest.title = text;
    unread.textContent = unreadText(model.unread);
    unread.hidden = model.unread === 0;
  };
  const setCollapsed = (c: boolean) => {
    root.dataset["collapsed"] = String(c);
    toggle.textContent = c ? "Show" : "Hide";
    toggle.setAttribute("aria-label", c ? "Show activity" : "Hide activity");
    toggle.setAttribute("aria-expanded", String(!c));
    if (!c) model.markRead();
    paintSummary();
  };
  toggle.addEventListener("click", () => shell.toggleDock());
  const paintHeight = (dockH: number) => grip.setAttribute("aria-valuenow", String(dockH - DOCK_HEADER_PX));
  paintHeight(shell.template.dockH);
  setCollapsed(shell.template.dockCollapsed);
  shell.onChange((t) => {
    const was = collapsed();
    setCollapsed(t.dockCollapsed);
    paintHeight(t.dockH);
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
      if (f.tag) {
        const tag = document.createElement("span");
        tag.className = "al-term-tag";
        tag.textContent = f.tag;
        tag.title = "Job and step of this line";
        row.append(time, role, tag, document.createTextNode(f.text));
      } else {
        row.append(time, role, document.createTextNode(f.text));
      }
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

  // Resize with the arrow keys on the handle ...
  grip.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    shell.setDockBody(body.offsetHeight + (e.key === "ArrowUp" ? KEY_STEP_PX : -KEY_STEP_PX));
  });
  // ... or by dragging its top edge upwards; the shell keeps the height between 3 lines and half the window.
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
      model.push(line, collapsed());
      render();
      paintSummary();
    },
    seed(lines) {
      model.seed(lines);
      render();
      body.scrollTop = body.scrollHeight;
      paintSummary();
    },
  };
}

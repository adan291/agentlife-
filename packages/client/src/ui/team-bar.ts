import { AGENT_IDS, ROLE_INFO } from "@agentlife/shared";
import type { AgentId, AgentState, ServerMsg } from "@agentlife/shared";
import { ROLE_COLOURS, STATE_COLOURS } from "../palette.ts";
import { formatDuration } from "./duration.ts";
import { UI_COLOURS, cssHex } from "./theme.ts";

/** Team bar geometry (px). */
const TEAM_WIDTH_PX = 220;
const TEAM_COLLAPSED_PX = 48;
const TEAM_LEFT_PX = 10;

export interface TeamRow {
  agentId: AgentId;
  state: AgentState;
  /** Status text of the last `agent_state`. */
  text?: string;
  model?: string;
  /** Epoch ms when the agent entered its current state (client clock). */
  since: number;
  /** Last activity line of this agent. */
  activity?: string;
}

export interface RowTone {
  /** Colour of the state label and the row accent. */
  colour: number;
  /** Row is highlighted: the agent is busy. */
  highlight: boolean;
  /** The ghost icon animates. */
  animate: boolean;
}

/** Working and thinking are highlighted and animated; waiting for approval, error and done each have their own colour. */
export function rowTone(state: AgentState): RowTone {
  const busy = state === "working" || state === "thinking";
  return { colour: STATE_COLOURS[state], highlight: busy, animate: busy };
}

/** Second line of the Builder row while no build session runs. */
export const BUILDER_IDLE_LINE = "Kiro build sessions";

/**
 * "S9 · model" from the label of a Builder `started` event ("S9 agent-pipeline (model)"), or null when
 * the text is not such a label (activity lines, "done", ...).
 */
export function parseBuilderStarted(text: string | undefined): string | null {
  if (!text) return null;
  const m = /^(S\d+[A-Za-z]?|R)\s.*\(([^()]+)\)$/.exec(text);
  return m ? `${m[1]} · ${m[2]}` : null;
}

/** Rows of the team bar and what feeds them. Pure: the DOM layer renders `rows()`. */
export class TeamModel {
  private readonly byId = new Map<AgentId, TeamRow>();

  constructor(now = Date.now()) {
    for (const id of AGENT_IDS) this.byId.set(id, { agentId: id, state: "idle", since: now });
    this.byId.get("builder")!.model = BUILDER_IDLE_LINE;
  }

  /** Agents in display order: Architect, Developer, QA, Builder. */
  rows(): TeamRow[] {
    return AGENT_IDS.map((id) => this.byId.get(id)!);
  }

  row(id: AgentId): TeamRow {
    return this.byId.get(id)!;
  }

  /** Feed every server message. Returns true when a row changed. */
  apply(msg: ServerMsg, now = Date.now()): boolean {
    switch (msg.type) {
      case "welcome": {
        for (const id of AGENT_IDS) this.byId.set(id, { agentId: id, state: "idle", since: now });
        for (const a of msg.agents) {
          this.byId.set(a.agentId, { agentId: a.agentId, state: a.state, since: now, ...(a.text === undefined ? {} : { text: a.text }) });
        }
        for (const [id, model] of Object.entries(msg.models ?? {}) as [AgentId, string][]) this.byId.get(id)!.model = model;
        this.byId.get("builder")!.model ??= parseBuilderStarted(this.byId.get("builder")!.text) ?? BUILDER_IDLE_LINE;
        for (const l of msg.activity ?? []) this.byId.get(l.agentId)!.activity = l.text;
        return true;
      }
      case "agent_state": {
        const row = this.byId.get(msg.agentId);
        if (!row) return false;
        const stateChanged = row.state !== msg.state;
        let sessionChanged = false;
        if (msg.agentId === "builder") {
          const line = msg.state === "idle" ? BUILDER_IDLE_LINE : (parseBuilderStarted(msg.text) ?? row.model ?? BUILDER_IDLE_LINE);
          sessionChanged = line !== row.model;
          row.model = line;
        }
        if (!stateChanged && row.text === msg.text && !sessionChanged) return false;
        row.state = msg.state;
        if (stateChanged) row.since = now;
        if (msg.text === undefined) delete row.text;
        else row.text = msg.text;
        return true;
      }
      case "activity": {
        const row = this.byId.get(msg.line.agentId);
        if (!row || row.activity === msg.line.text) return false;
        row.activity = msg.line.text;
        return true;
      }
      default:
        return false;
    }
  }
}

/** "12s" for a busy agent, empty for an idle one. */
export function elapsedText(row: TeamRow, now: number): string {
  return row.state === "idle" ? "" : formatDuration(now - row.since);
}

function stateLabel(state: AgentState): string {
  return state.replace("_", " ");
}

const CSS = `
.al-team { position: fixed; z-index: 10; left: ${TEAM_LEFT_PX}px; top: 52px; width: ${TEAM_WIDTH_PX}px; max-height: calc(100vh - 52px - var(--al-terminal-h, 0px) - 16px); overflow-y: auto; box-sizing: border-box; background: ${UI_COLOURS.panelBg}; border: 1px solid ${UI_COLOURS.border}; border-radius: 6px; color: ${UI_COLOURS.text}; font: var(--al-font, 14px)/1.4 monospace; }
.al-team[data-collapsed="true"] { width: ${TEAM_COLLAPSED_PX}px; }
.al-team-head { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; }
.al-team-head b { color: ${UI_COLOURS.accentText}; }
.al-team[data-collapsed="true"] .al-team-head b, .al-team[data-collapsed="true"] .al-team-text { display: none; }
.al-team-row { display: flex; gap: 8px; align-items: flex-start; width: 100%; text-align: left; padding: 6px 8px; border: 0; border-top: 1px solid ${UI_COLOURS.border}; border-left: 3px solid transparent; background: none; color: inherit; font: inherit; cursor: pointer; box-sizing: border-box; }
.al-team-row:hover, .al-team-row:focus-visible { background: ${UI_COLOURS.inputBg}; }
.al-team-row[data-highlight="true"] { background: ${UI_COLOURS.inputBg}; }
.al-team-row:not([data-state="idle"]) { border-left-color: var(--al-row-colour); }
.al-team-ghost { flex: none; position: relative; width: 18px; height: 20px; margin-top: 2px; border-radius: 9px 9px 2px 2px; background: var(--al-role-colour); }
.al-team-ghost::before, .al-team-ghost::after { content: ""; position: absolute; top: 6px; width: 3px; height: 4px; border-radius: 50%; background: ${UI_COLOURS.inputBg}; }
.al-team-ghost::before { left: 4px; }
.al-team-ghost::after { right: 4px; }
.al-team-row[data-animate="true"] .al-team-ghost { animation: al-bob 0.9s ease-in-out infinite; }
@keyframes al-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) { .al-team-row[data-animate="true"] .al-team-ghost { animation: none; } }
.al-team-text { min-width: 0; flex: 1; }
.al-team-line { display: flex; justify-content: space-between; gap: 6px; }
.al-team-name { font-weight: bold; color: var(--al-role-colour); }
.al-team-elapsed { color: ${UI_COLOURS.muted}; }
.al-team-sub { display: block; color: ${UI_COLOURS.muted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al-team-sub[hidden] { display: none; }
.al-team-state::before { content: "\\25CF"; color: var(--al-row-colour); margin-right: 0.5ch; }
`;

export interface TeamBar {
  /** Feed every server message. */
  handle(msg: ServerMsg): void;
}

interface RowEls {
  button: HTMLButtonElement;
  state: HTMLElement;
  model: HTMLElement;
  activity: HTMLElement;
  elapsed: HTMLElement;
}

/** Left-edge list of agents with state, model, last activity and time in state. Click a row to focus the agent. */
export function createTeamBar(onFocus: (id: AgentId) => void): TeamBar {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const model = new TeamModel();
  const root = document.createElement("aside");
  root.className = "al-team";
  root.setAttribute("aria-label", "Team");
  const head = document.createElement("div");
  head.className = "al-team-head";
  const title = document.createElement("b");
  title.textContent = "Team";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "al-btn";
  const setCollapsed = (c: boolean) => {
    root.dataset["collapsed"] = String(c);
    toggle.textContent = c ? "»" : "«";
    toggle.title = c ? "Show the team bar" : "Collapse the team bar";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-expanded", String(!c));
  };
  toggle.addEventListener("click", () => setCollapsed(root.dataset["collapsed"] !== "true"));
  setCollapsed(false);
  head.append(title, toggle);
  root.appendChild(head);

  const els = new Map<AgentId, RowEls>();
  for (const id of AGENT_IDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "al-team-row";
    button.style.setProperty("--al-role-colour", cssHex(ROLE_COLOURS[id]));
    const ghost = document.createElement("span");
    ghost.className = "al-team-ghost";
    ghost.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "al-team-text";
    const top = document.createElement("span");
    top.className = "al-team-line";
    const name = document.createElement("span");
    name.className = "al-team-name";
    name.textContent = ROLE_INFO[id].name;
    const elapsed = document.createElement("span");
    elapsed.className = "al-team-elapsed";
    top.append(name, elapsed);
    const state = document.createElement("span");
    state.className = "al-team-sub al-team-state";
    const modelEl = document.createElement("span");
    modelEl.className = "al-team-sub";
    const activity = document.createElement("span");
    activity.className = "al-team-sub";
    text.append(top, state, modelEl, activity);
    button.append(ghost, text);
    button.addEventListener("click", () => onFocus(id));
    root.appendChild(button);
    els.set(id, { button, state, model: modelEl, activity, elapsed });
  }
  document.body.appendChild(root);

  const paint = (row: TeamRow, now: number) => {
    const e = els.get(row.agentId)!;
    const tone = rowTone(row.state);
    e.button.dataset["highlight"] = String(tone.highlight);
    e.button.dataset["animate"] = String(tone.animate);
    e.button.dataset["state"] = row.state;
    e.button.style.setProperty("--al-row-colour", cssHex(tone.colour));
    e.state.textContent = row.text ? `${stateLabel(row.state)}: ${row.text}` : stateLabel(row.state);
    e.model.textContent = row.model ?? "";
    e.model.hidden = !row.model;
    e.activity.textContent = row.activity ?? "";
    e.activity.hidden = !row.activity;
    e.elapsed.textContent = elapsedText(row, now);
    e.button.title = `${ROLE_INFO[row.agentId].name}: ${stateLabel(row.state)}. Click to find it in the room.`;
  };
  const paintAll = () => {
    const now = Date.now();
    for (const row of model.rows()) paint(row, now);
  };
  paintAll();
  // Only the elapsed times change between events.
  setInterval(() => {
    const now = Date.now();
    for (const row of model.rows()) els.get(row.agentId)!.elapsed.textContent = elapsedText(row, now);
  }, 1000);

  return {
    handle(msg) {
      if (model.apply(msg)) paintAll();
    },
  };
}

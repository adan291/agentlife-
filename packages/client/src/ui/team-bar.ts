import { AGENT_IDS, ROLE_INFO } from "@agentlife/shared";
import type { AgentId, AgentState, AgentWork, ServerMsg } from "@agentlife/shared";
import { ROLE_COLOURS, STATE_COLOURS } from "../palette.ts";
import { formatDuration } from "./duration.ts";
import { UI_COLOURS, cssHex } from "./theme.ts";
import type { Shell } from "./shell.ts";
import { WorkModel, workView, workVisible } from "./work.ts";

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
  private readonly work = new WorkModel();
  /** Agents that live on the current floor (from the latest `welcome`); everyone until the first one. */
  private present = new Set<AgentId>(AGENT_IDS);

  constructor(now = Date.now()) {
    for (const id of AGENT_IDS) this.byId.set(id, { agentId: id, state: "idle", since: now });
    this.byId.get("builder")!.model = BUILDER_IDLE_LINE;
  }

  /** Agents of the current floor in display order: Architect, Developer, QA, Builder. */
  rows(): TeamRow[] {
    return AGENT_IDS.filter((id) => this.present.has(id)).map((id) => this.byId.get(id)!);
  }

  isPresent(id: AgentId): boolean {
    return this.present.has(id);
  }

  row(id: AgentId): TeamRow {
    return this.byId.get(id)!;
  }

  /** What the agent works on, or undefined when it is not busy (see `workVisible`). */
  workOf(id: AgentId): AgentWork | undefined {
    const row = this.byId.get(id);
    return row && workVisible(row.state) ? this.work.get(id) : undefined;
  }

  /** Feed every server message. Returns true when a row changed. */
  apply(msg: ServerMsg, now = Date.now()): boolean {
    // Both parts always run: `||` on the calls would skip the second one.
    const rowChanged = this.applyRow(msg, now);
    const workChanged = this.work.apply(msg);
    return rowChanged || workChanged;
  }

  private applyRow(msg: ServerMsg, now: number): boolean {
    switch (msg.type) {
      case "welcome": {
        this.present = new Set(msg.agents.map((a) => a.agentId));
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
.al-team { height: 100%; overflow-y: auto; overflow-x: hidden; box-sizing: border-box; color: ${UI_COLOURS.text}; font: var(--al-font, 14px)/1.4 monospace; }
.al-team-head { display: flex; justify-content: space-between; align-items: center; padding: var(--al-s1) var(--al-s2); }
.al-team-head b { color: ${UI_COLOURS.accentText}; }
.al-team-toggle { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; }
.al-chevron { width: 8px; height: 8px; border-left: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: translateX(2px) rotate(45deg); }
.al-team[data-collapsed="true"] .al-chevron { transform: translateX(-2px) rotate(-135deg); }
.al-team[data-collapsed="true"] .al-team-head { justify-content: center; }
.al-team[data-collapsed="true"] .al-team-head b, .al-team[data-collapsed="true"] .al-team-text { display: none; }
.al-team[data-collapsed="true"] .al-team-row { justify-content: center; padding: var(--al-s2) 0; border-left-width: 0; }
.al-team[data-collapsed="true"] .al-team-ghost { margin-top: 0; box-shadow: 0 0 0 2px ${UI_COLOURS.panelBg}, 0 0 0 4px var(--al-row-colour); }
.al-team-row { display: flex; gap: var(--al-s2); align-items: flex-start; width: 100%; text-align: left; padding: var(--al-s2); border: 0; border-top: 1px solid var(--al-border); border-left: 3px solid transparent; background: none; color: inherit; font: inherit; cursor: pointer; box-sizing: border-box; }
.al-team-row:hover, .al-team-row:focus-visible { background: ${UI_COLOURS.inputBg}; }
.al-team-row[hidden] { display: none; }
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
.al-team-line { display: flex; justify-content: space-between; gap: var(--al-s2); }
.al-team-name { font-weight: bold; color: var(--al-role-colour); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.al-team-elapsed { color: ${UI_COLOURS.muted}; flex: none; }
.al-team-sub { display: block; color: ${UI_COLOURS.muted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al-team-sub[hidden] { display: none; }
.al-team-state::before { content: "\\25CF"; color: var(--al-row-colour); margin-right: 0.5ch; }
.al-team-work { display: block; margin-top: var(--al-s1); padding-top: var(--al-s1); border-top: 1px dashed var(--al-border); }
.al-team-work[hidden] { display: none; }
.al-work-title { color: ${UI_COLOURS.text}; font-weight: bold; }
.al-work-line { display: block; color: ${UI_COLOURS.muted}; }
.al-work-step { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al-work-ctx { display: flex; align-items: center; gap: var(--al-s1); color: ${UI_COLOURS.muted}; }
.al-meter { display: inline-block; width: 40px; height: 6px; box-sizing: border-box; background: ${UI_COLOURS.inputBg}; border: 1px solid var(--al-border); border-radius: var(--al-s1); overflow: hidden; }
.al-meter > span { display: block; height: 100%; width: var(--al-pct, 0%); background: ${UI_COLOURS.accent}; }
.al-meter[data-high="true"] > span { background: ${UI_COLOURS.error}; }
.al-meter[hidden] { display: none; }
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
  work: HTMLElement;
  workTitle: HTMLElement;
  workStep: HTMLElement;
  workCtxText: HTMLElement;
  workMeter: HTMLElement;
  workFiles: HTMLElement;
}

/** The context meter turns red at the point where kiro-cli starts to summarise (80 %). */
export const CONTEXT_HIGH_PCT = 80;

/** Agent list in the side bar with state, model, last activity and time in state. Click a row to focus the agent. */
export function createTeamBar(onFocus: (id: AgentId) => void, shell: Shell): TeamBar {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const model = new TeamModel();
  const root = document.createElement("div");
  root.className = "al-team";
  const head = document.createElement("div");
  head.className = "al-team-head";
  const title = document.createElement("b");
  title.textContent = "Team";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "al-btn al-team-toggle";
  const chevron = document.createElement("span");
  chevron.className = "al-chevron";
  chevron.setAttribute("aria-hidden", "true");
  toggle.appendChild(chevron);
  const setCollapsed = (c: boolean) => {
    root.dataset["collapsed"] = String(c);
    toggle.title = c ? "Expand team" : "Collapse team";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-expanded", String(!c));
  };
  toggle.addEventListener("click", () => shell.toggleSide());
  setCollapsed(shell.template.sideCollapsed);
  shell.onChange((t) => setCollapsed(t.sideCollapsed));
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
    const work = document.createElement("span");
    work.className = "al-team-work";
    work.hidden = true;
    const workTitle = document.createElement("span");
    workTitle.className = "al-team-sub al-work-title";
    const workLine = document.createElement("span");
    workLine.className = "al-work-line";
    const workStep = document.createElement("span");
    workStep.className = "al-work-step";
    const workCtx = document.createElement("span");
    workCtx.className = "al-work-ctx";
    const workMeter = document.createElement("span");
    workMeter.className = "al-meter";
    workMeter.setAttribute("role", "meter");
    workMeter.setAttribute("aria-label", "Context used");
    workMeter.setAttribute("aria-valuemin", "0");
    workMeter.setAttribute("aria-valuemax", "100");
    workMeter.appendChild(document.createElement("span"));
    const workCtxText = document.createElement("span");
    workCtx.append(workMeter, workCtxText);
    workLine.append(workStep);
    const workFiles = document.createElement("span");
    workFiles.className = "al-team-sub";
    work.append(workTitle, workLine, workCtx, workFiles);
    text.append(top, state, modelEl, activity, work);
    button.append(ghost, text);
    button.addEventListener("click", () => onFocus(id));
    root.appendChild(button);
    els.set(id, { button, state, model: modelEl, activity, elapsed, work, workTitle, workStep, workCtxText, workMeter, workFiles });
  }
  shell.side.appendChild(root);

  /** Fills the work block of a busy agent, or hides it. */
  const paintWork = (id: AgentId, now: number) => {
    const e = els.get(id)!;
    const w = model.workOf(id);
    e.work.hidden = !w;
    if (!w) return;
    const v = workView(w, now);
    e.workTitle.textContent = v.title;
    e.workTitle.title = v.title;
    e.workStep.textContent = `${v.step} · ${v.elapsed}`;
    e.workCtxText.textContent = `ctx ${v.contextText}`;
    e.workMeter.hidden = v.context === undefined;
    if (v.context !== undefined) {
      e.workMeter.style.setProperty("--al-pct", `${Math.round(v.context)}%`);
      e.workMeter.dataset["high"] = String(v.context >= CONTEXT_HIGH_PCT);
      e.workMeter.setAttribute("aria-valuenow", String(Math.round(v.context)));
    }
    e.workFiles.textContent = v.files;
    e.work.title = `${v.title}\nStep: ${v.step}, ${v.elapsed}\nContext: ${v.contextText}\nFiles: ${v.files}`;
  };

  const paint = (row: TeamRow, now: number) => {
    const e = els.get(row.agentId)!;
    const tone = rowTone(row.state);
    e.button.dataset["highlight"] = String(tone.highlight);
    e.button.dataset["animate"] = String(tone.animate);
    e.button.dataset["state"] = row.state;
    e.button.style.setProperty("--al-row-colour", cssHex(tone.colour));
    const stateText = row.text ? `${stateLabel(row.state)}: ${row.text}` : stateLabel(row.state);
    e.state.textContent = stateText;
    e.state.title = stateText;
    e.model.textContent = row.model ?? "";
    e.model.title = row.model ?? "";
    e.model.hidden = !row.model;
    e.activity.textContent = row.activity ?? "";
    e.activity.title = row.activity ?? "";
    e.activity.hidden = !row.activity;
    e.elapsed.textContent = elapsedText(row, now);
    paintWork(row.agentId, now);
    const full = `${ROLE_INFO[row.agentId].name}: ${stateText}`;
    e.button.title = `${full}. Click to find it in the room.`;
    e.button.setAttribute("aria-label", full);
  };
  const paintAll = () => {
    const now = Date.now();
    // The team of the current floor only: the lobby has the Builder, a project floor the three role agents.
    for (const id of AGENT_IDS) els.get(id)!.button.hidden = !model.isPresent(id);
    for (const row of model.rows()) paint(row, now);
  };
  paintAll();
  // Only the elapsed times change between events.
  setInterval(() => {
    const now = Date.now();
    for (const row of model.rows()) {
      els.get(row.agentId)!.elapsed.textContent = elapsedText(row, now);
      if (model.workOf(row.agentId)) paintWork(row.agentId, now);
    }
  }, 1000);

  return {
    handle(msg) {
      if (model.apply(msg)) paintAll();
    },
  };
}

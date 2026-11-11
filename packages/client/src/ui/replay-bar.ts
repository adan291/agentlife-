import { AGENT_IDS } from "@agentlife/shared";
import type { AgentId, AgentState, ServerMsg } from "@agentlife/shared";
import { REPLAY_SPEEDS } from "../replay/engine.ts";
import { UI_COLOURS } from "./theme.ts";

const CSS = `
.al-replay { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--al-s2) var(--al-s3); background: ${UI_COLOURS.panelBg}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); padding: var(--al-s1) var(--al-s3); color: ${UI_COLOURS.text}; font: var(--al-font, 14px)/1.4 monospace; box-shadow: var(--al-shadow); }
.al-replay-speeds { display: flex; align-items: center; gap: var(--al-s1); }
.al-replay .al-btn[aria-pressed="true"] { border-color: var(--al-accent); color: ${UI_COLOURS.accentText}; }
.al-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
`;

/** "Replay of a real run recorded on November 11, 2026". The date is shown in UTC so it reads the same everywhere. */
export function replayBannerText(recordedAt: Date): string {
  const date = recordedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  return `Replay of a real run recorded on ${date}`;
}

/** What the bar drives; `ReplayTransport` implements it. */
export interface ReplayControls {
  readonly speed: number;
  setSpeed(speed: number): void;
  restart(): void;
}

export interface ReplayBar {
  /** Feed every server message; the hidden agent list follows `welcome` and `agent_state`. */
  handle(msg: ServerMsg): void;
}

/**
 * Banner with the recording date, speed buttons (1×, 4×, 16×) and a restart button, plus a visually hidden
 * list of agent states (`data-agent-state`) for tests and screen readers.
 */
export function createReplayBar(host: HTMLElement, controls: ReplayControls, recordedAt: Date, doc: Document = document): ReplayBar {
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);

  const bar = doc.createElement("div");
  bar.className = "al-replay";
  bar.setAttribute("role", "status");
  const text = doc.createElement("span");
  text.textContent = replayBannerText(recordedAt);

  const speeds = doc.createElement("div");
  speeds.className = "al-replay-speeds";
  speeds.setAttribute("role", "group");
  speeds.setAttribute("aria-label", "Replay speed");
  const speedButtons = REPLAY_SPEEDS.map((s) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "al-btn";
    b.textContent = `${s}×`;
    b.addEventListener("click", () => {
      controls.setSpeed(s);
      refreshSpeed();
    });
    speeds.appendChild(b);
    return { speed: s, button: b };
  });
  const refreshSpeed = () => {
    for (const { speed, button } of speedButtons) button.setAttribute("aria-pressed", String(speed === controls.speed));
  };
  refreshSpeed();

  const restart = doc.createElement("button");
  restart.type = "button";
  restart.className = "al-btn";
  restart.textContent = "Restart";
  restart.addEventListener("click", () => {
    controls.restart();
    refreshSpeed();
  });

  bar.append(text, speeds, restart);
  host.appendChild(bar);

  const list = doc.createElement("ul");
  list.className = "al-sr-only";
  list.setAttribute("aria-label", "Agent states");
  const items = new Map<AgentId, HTMLElement>();
  for (const id of AGENT_IDS) {
    const li = doc.createElement("li");
    li.dataset["agent"] = id;
    li.dataset["agentState"] = "idle";
    li.textContent = `${id}: idle`;
    list.appendChild(li);
    items.set(id, li);
  }
  host.appendChild(list);

  const setState = (id: AgentId, state: AgentState) => {
    const li = items.get(id);
    if (!li) return;
    li.dataset["agentState"] = state;
    li.textContent = `${id}: ${state}`;
  };

  return {
    handle(msg) {
      if (msg.type === "welcome") for (const a of msg.agents) setState(a.agentId, a.state);
      else if (msg.type === "agent_state") setState(msg.agentId, msg.state);
    },
  };
}

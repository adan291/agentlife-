import type { ActivityLine, AgentId, AgentState, AgentWork, ServerMsg } from "@agentlife/shared";
import { formatDuration } from "./duration.ts";

/**
 * Short tag of a job: `task-d232d369` -> `#d232`. Only ids of the engine (`task-...`) have one;
 * Builder lines (`build:S9`) and unknown ids give an empty string.
 */
export function taskTag(taskId: string | undefined): string {
  const m = taskId ? /^task-(.+)$/.exec(taskId) : null;
  return m?.[1] ? `#${m[1].slice(0, 4)}` : "";
}

/** `#d232 develop`, `#d232` when the line has no step, empty when it belongs to no job. */
export function lineTag(line: Pick<ActivityLine, "taskId" | "step">): string {
  const tag = taskTag(line.taskId);
  if (!tag) return "";
  return line.step ? `${tag} ${line.step}` : tag;
}

/** The work block is shown while the agent is busy (or stuck): not when it is idle, done or waiting for the user. */
export function workVisible(state: AgentState | undefined): boolean {
  return state === "working" || state === "thinking" || state === "walking" || state === "blocked" || state === "error";
}

/** Current work of each agent, from `welcome` and `work` messages. Pure: the DOM layers render from it. */
export class WorkModel {
  private readonly byId = new Map<AgentId, AgentWork>();

  get(id: AgentId): AgentWork | undefined {
    return this.byId.get(id);
  }

  /** Feeds every server message. Returns true when a work entry changed. */
  apply(msg: ServerMsg): boolean {
    if (msg.type === "welcome") {
      const had = this.byId.size > 0;
      this.byId.clear();
      let any = false;
      for (const a of msg.agents) {
        if (a.work) {
          this.byId.set(a.agentId, a.work);
          any = true;
        }
      }
      return had || any;
    }
    if (msg.type === "work") {
      this.byId.set(msg.agentId, msg.work);
      return true;
    }
    if (msg.type === "agent_state" && msg.state === "idle" && this.byId.has(msg.agentId)) {
      // Back at home: the step is over. Without this a finished step would reappear on the next busy state.
      this.byId.delete(msg.agentId);
      return true;
    }
    return false;
  }
}

/** Text parts of a work block, ready to put into the DOM or a tooltip. */
export interface WorkView {
  title: string;
  /** "develop" */
  step: string;
  /** "12s" since the step started. */
  elapsed: string;
  /** Context use 0 to 100, undefined when the runtime does not report it. */
  context: number | undefined;
  /** "24%" or "n/a". */
  contextText: string;
  /** "2 read · 1 edited" */
  files: string;
  model: string | undefined;
}

export function filesText(read: number, edited: number): string {
  return `${read} read · ${edited} edited`;
}

export function workView(work: AgentWork, now: number): WorkView {
  const pct = work.contextPct;
  return {
    title: work.title,
    step: work.step,
    elapsed: formatDuration(Math.max(0, now - work.startedAt)),
    context: pct,
    contextText: pct === undefined ? "n/a" : `${Math.round(pct)}%`,
    files: filesText(work.filesRead, work.filesEdited),
    model: work.model,
  };
}

/** Lines for the agent tooltip in the room: the same facts as the team bar block. */
export function workTooltipLines(work: AgentWork, now: number): string[] {
  const v = workView(work, now);
  const lines = [`Working on: ${v.title}`, `Step: ${v.step} · ${v.elapsed}${v.model ? ` · ${v.model}` : ""}`];
  lines.push(`Context: ${v.contextText}`, `Files: ${v.files}`);
  return lines;
}

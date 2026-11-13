import { splitAgentId } from "@agentlife/shared";
import type { AgentEvent } from "@agentlife/shared";

/** The Builder goes back to idle when no event of it has arrived for this long (ui-tidy, requirement 4). */
export const BUILDER_STALE_MS = 10 * 60_000;

/**
 * Keeps the Builder from staying "thinking, running pnpm" for hours after the build session that reported it stopped
 * (the conductor was killed, the machine slept). It follows the events of the Builder: their time is the engine's
 * clock, so a replay after a restart of events that are hours old is stale at once. When the Builder is busy and nothing
 * has come for `staleMs`, `expired` says so once; the gateway then sends the idle state to the room and to the sim, so
 * a reload shows it too. Nothing here reaches a job.
 */
export class BuilderWatch {
  private busy = false;
  private lastTs = 0;
  private readonly staleMs: number;

  // No parameter properties: node's type stripping does not support them.
  constructor(staleMs: number = BUILDER_STALE_MS) {
    this.staleMs = staleMs;
  }

  /** Follows one engine event; events of other agents are ignored. */
  observe(ev: AgentEvent): void {
    if (!("agentId" in ev) || ev.agentId === undefined || splitAgentId(ev.agentId).agentId !== "builder") return;
    this.lastTs = Math.max(this.lastTs, ev.ts);
    if (ev.type === "agent.state_changed") this.busy = ev.state !== "idle";
  }

  /** True once when the Builder is busy and has been silent for the stale time. After it the Builder counts as idle until its next busy state. */
  expired(now: number): boolean {
    if (!this.busy || now - this.lastTs < this.staleMs) return false;
    this.busy = false;
    return true;
  }
}

import type { AgentEvent, ApprovalDecision, RunExport } from "@agentlife/shared";
import { buildSchedule, rebase } from "./schedule.ts";
import type { Schedule } from "./schedule.ts";

export const REPLAY_SPEEDS = [1, 4, 16] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export interface ResolveResult {
  /** False when no approval is waiting or the id is not the waiting one. */
  accepted: boolean;
  /** True when the decision differs from the recorded one (a Reject: the recorded run was approved). */
  overridden: boolean;
  /** Events that become due at once (the recorded `approval.resolved`). */
  events: AgentEvent[];
}

/**
 * Plays the events of a recorded run on a virtual clock. It is driven by the host: `advance(dtMs)`
 * with real elapsed time returns the events that became due. No timers, no I/O.
 *
 * - Time between events is the recorded spacing, long gaps compressed, divided by the speed.
 * - At `approval.requested` the clock stops until `resolveApproval`; the recorded `approval.resolved`
 *   then follows at once, and the rest continues from there.
 */
export class ReplayEngine {
  private readonly schedule: Schedule;
  private baseTs: number;
  private next = 0;
  /** Playhead on the compressed timeline at 1× speed. */
  private playhead = 0;
  private speedFactor: number = 1;
  private running = false;
  private waiting: { approvalId: string } | null = null;
  readonly goal: string;
  readonly repoId: string;

  /** `baseTs`: wall-clock time that maps to the start of the run (used to rebase event timestamps). */
  constructor(exp: RunExport, baseTs: number = Date.now()) {
    this.schedule = buildSchedule(exp.events);
    this.baseTs = baseTs;
    this.goal = exp.job.goal;
    this.repoId = exp.job.repoId;
  }

  get speed(): number {
    return this.speedFactor;
  }

  setSpeed(speed: number): void {
    if (Number.isFinite(speed) && speed > 0) this.speedFactor = speed;
  }

  get started(): boolean {
    return this.running || this.next > 0;
  }

  get finished(): boolean {
    return this.next >= this.schedule.items.length;
  }

  /** Id of the approval the replay is waiting on, or null. */
  get waitingApproval(): string | null {
    return this.waiting?.approvalId ?? null;
  }

  /** Playhead position, 0..1, for progress displays. */
  get progress(): number {
    return this.schedule.total === 0 ? 1 : Math.min(1, this.playhead / this.schedule.total);
  }

  /** Begins playing from the start (or from where `restart` left it). Returns the events due at time 0. */
  start(): AgentEvent[] {
    this.running = true;
    return this.advance(0);
  }

  /** Back to the beginning, stopped, with a new time base. Speed is kept. */
  restart(baseTs: number = Date.now()): void {
    this.baseTs = baseTs;
    this.next = 0;
    this.playhead = 0;
    this.running = false;
    this.waiting = null;
  }

  /** Moves the virtual clock by `dtMs` of real time and returns the events that became due, in order. */
  advance(dtMs: number): AgentEvent[] {
    if (!this.running || this.waiting) return [];
    this.playhead += Math.max(0, dtMs) * this.speedFactor;
    return this.drain();
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision): ResolveResult {
    if (!this.waiting || this.waiting.approvalId !== approvalId) return { accepted: false, overridden: false, events: [] };
    const resolvedIdx = this.schedule.items.findIndex(
      (it, i) => i >= this.next && it.event.type === "approval.resolved" && it.event.approvalId === approvalId,
    );
    const recorded = resolvedIdx >= 0 ? this.schedule.items[resolvedIdx]!.event : undefined;
    const overridden = recorded?.type === "approval.resolved" ? recorded.decision !== decision : decision !== "approve";
    this.waiting = null;
    // The decision is made: jump to the recorded resolution and continue from there.
    const target = resolvedIdx >= 0 ? this.schedule.items[resolvedIdx]!.at : this.playhead;
    this.playhead = Math.max(this.playhead, target);
    return { accepted: true, overridden, events: this.drain() };
  }

  private drain(): AgentEvent[] {
    const out: AgentEvent[] = [];
    const items = this.schedule.items;
    while (this.next < items.length && items[this.next]!.at <= this.playhead) {
      const { event, at } = items[this.next]!;
      this.next++;
      out.push(rebase(event, this.baseTs, this.schedule));
      if (event.type === "approval.requested") {
        this.waiting = { approvalId: event.approvalId };
        this.playhead = at;
        break;
      }
    }
    return out;
  }
}

import { DEFAULT_MOOD_LIMITS, SEATED_ROLES, localDay, moodOf, splitAgentId } from "@agentlife/shared";
import type { AgentEvent, Mood, MoodLimits, SeatedRole } from "@agentlife/shared";

/** An open interval of work counts for at most this long: an engine that died with an agent "working" must not tire it forever. */
export const OPEN_INTERVAL_MAX_MS = 2 * 3_600_000;

/** Agent states that are work. Anything else ends the interval. */
const WORK_STATES: ReadonlySet<string> = new Set(["thinking", "working"]);

interface Slot {
  /** The local day the counters are for. */
  day: string;
  /** Work in intervals that ended, today. */
  closedMs: number;
  /** When the interval that is open began, or null when the agent does not work. */
  since: number | null;
  /** Time of the latest event seen, so an event that goes back in time is ignored. */
  lastTs: number;
}

export interface MoodKeeperOptions {
  limits?: MoodLimits;
  now?: () => number;
}

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * How long each desk agent of each project has worked today (waiting-fun task 2), and so its mood. It follows
 * `agent.state_changed` of the three desk roles; an interval is from `thinking` or `working` until any other state. An
 * interval counts for the local day in which it ends, from its start or from midnight. It keeps no file: the mood is for
 * show, after a restart the agents are rested and the replay of the latest jobs rebuilds what happened today. Nothing
 * here is ever read by a job, a model or a permission.
 */
export class MoodKeeper {
  private readonly slots = new Map<string, Slot>();
  private readonly limits: MoodLimits;
  private readonly now: () => number;

  constructor(options: MoodKeeperOptions = {}) {
    this.limits = options.limits ?? DEFAULT_MOOD_LIMITS;
    this.now = options.now ?? Date.now;
  }

  /** Follows one engine event. Returns the project whose agent changed state, or undefined when the event is not about a desk agent. */
  observe(ev: AgentEvent): { projectId: string; role: SeatedRole } | undefined {
    if (ev.type !== "agent.state_changed") return undefined;
    const { projectId, agentId } = splitAgentId(ev.agentId);
    if (projectId === undefined || !isSeated(agentId)) return undefined;
    const slot = this.slotOf(projectId, agentId, ev.ts);
    if (ev.ts < slot.lastTs) return undefined;
    slot.lastTs = ev.ts;
    this.roll(slot, ev.ts);
    const working = WORK_STATES.has(ev.state);
    if (working && slot.since === null) slot.since = ev.ts;
    else if (!working && slot.since !== null) {
      slot.closedMs += this.openMs(slot, ev.ts);
      slot.since = null;
    }
    return { projectId, role: agentId };
  }

  /** Work today of a desk agent, since its last coffee. */
  workedMs(projectId: string, role: SeatedRole): number {
    const slot = this.slots.get(key(projectId, role));
    return slot ? this.total(slot, this.now()) : 0;
  }

  moodOf(projectId: string, role: SeatedRole): Mood {
    return moodOf(this.workedMs(projectId, role), this.limits);
  }

  /** The mood of the three desk agents of a project. */
  moods(projectId: string): Record<SeatedRole, Mood> {
    return { architect: this.moodOf(projectId, "architect"), developer: this.moodOf(projectId, "developer"), qa: this.moodOf(projectId, "qa") };
  }

  /** The tired desk agent that has worked most today, or undefined when none is tired. Ties go to the first role in the flow. */
  mostTired(projectId: string): SeatedRole | undefined {
    let best: { role: SeatedRole; ms: number } | undefined;
    for (const role of SEATED_ROLES) {
      if (this.moodOf(projectId, role) !== "tired") continue;
      const ms = this.workedMs(projectId, role);
      if (!best || ms > best.ms) best = { role, ms };
    }
    return best?.role;
  }

  /** A cup of coffee: the work counted so far is forgotten, so the agent is rested. An interval that is open starts again now. */
  serveCoffee(projectId: string, role: SeatedRole): void {
    const now = this.now();
    const slot = this.slotOf(projectId, role, now);
    this.roll(slot, now);
    slot.closedMs = 0;
    if (slot.since !== null) slot.since = now;
  }

  private slotOf(projectId: string, role: SeatedRole, ts: number): Slot {
    const k = key(projectId, role);
    let slot = this.slots.get(k);
    if (!slot) this.slots.set(k, (slot = { day: localDay(ts), closedMs: 0, since: null, lastTs: 0 }));
    return slot;
  }

  /** A new local day starts from zero; an interval still open starts again at midnight. */
  private roll(slot: Slot, ts: number): void {
    const day = localDay(ts);
    if (slot.day === day) return;
    slot.day = day;
    slot.closedMs = 0;
    if (slot.since !== null) slot.since = Math.max(slot.since, startOfDay(ts));
  }

  /** Length of the open interval up to `ts`: from its start or midnight, never negative, never more than the cap. */
  private openMs(slot: Slot, ts: number): number {
    if (slot.since === null) return 0;
    return Math.min(OPEN_INTERVAL_MAX_MS, Math.max(0, ts - Math.max(slot.since, startOfDay(ts))));
  }

  private total(slot: Slot, now: number): number {
    this.roll(slot, now);
    return slot.closedMs + this.openMs(slot, now);
  }
}

const key = (projectId: string, role: SeatedRole): string => `${projectId}|${role}`;
const isSeated = (role: string): role is SeatedRole => (SEATED_ROLES as readonly string[]).includes(role);

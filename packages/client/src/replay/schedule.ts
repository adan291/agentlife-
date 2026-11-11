import type { AgentEvent } from "@agentlife/shared";

/** Recorded idle gaps longer than this are shortened (requirement 2.3). */
export const GAP_MAX_MS = 10_000;
/** Length a long gap is shortened to. */
export const GAP_COMPRESSED_MS = 2_000;

export interface Scheduled {
  /** Milliseconds from the start of the replay at 1× speed, after gap compression. */
  at: number;
  event: AgentEvent;
}

export interface Schedule {
  items: Scheduled[];
  /** Total length at 1× speed. */
  total: number;
  /** Maps a recorded epoch timestamp to an offset on the compressed timeline (clamped to 0..total). */
  offsetOf(ts: number): number;
}

/** A gap above `GAP_MAX_MS` becomes `GAP_COMPRESSED_MS`; shorter gaps are kept. */
export function compressGap(gapMs: number): number {
  const gap = Math.max(0, gapMs);
  return gap > GAP_MAX_MS ? GAP_COMPRESSED_MS : gap;
}

/**
 * Turns recorded events into a schedule: original order (by seq), original spacing, long gaps compressed.
 * Pure: speed is applied by the player, not here.
 */
export function buildSchedule(events: readonly AgentEvent[]): Schedule {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const items: Scheduled[] = [];
  /** Breakpoints (recorded ts, compressed offset) with non-decreasing ts, for `offsetOf`. */
  const marks: { ts: number; at: number }[] = [];
  let prevTs = sorted[0]?.ts ?? 0;
  let at = 0;
  for (const event of sorted) {
    const ts = Math.max(event.ts, prevTs);
    at += compressGap(ts - prevTs);
    prevTs = ts;
    items.push({ at, event });
    marks.push({ ts, at });
  }
  const first = marks[0];
  const offsetOf = (ts: number): number => {
    if (!first) return 0;
    if (ts <= first.ts) return 0;
    for (let i = 1; i < marks.length; i++) {
      const a = marks[i - 1]!;
      const b = marks[i]!;
      if (ts <= b.ts) {
        const span = b.ts - a.ts;
        return span === 0 ? b.at : a.at + ((ts - a.ts) / span) * (b.at - a.at);
      }
    }
    return at;
  };
  return { items, total: at, offsetOf };
}

/** Real-time gaps between consecutive items when played at `speed` (for tests and the UI). */
export function gapsAtSpeed(items: readonly Scheduled[], speed: number): number[] {
  return items.slice(1).map((it, i) => (it.at - items[i]!.at) / speed);
}

/**
 * The recorded event as it should reach the client when the replay started at wall time `base`:
 * `ts` and the `startedAt` of work events are moved onto the compressed timeline, so elapsed
 * times and the board are consistent with what is on screen.
 */
export function rebase(event: AgentEvent, base: number, schedule: Pick<Schedule, "offsetOf">): AgentEvent {
  const ts = Math.round(base + schedule.offsetOf(event.ts));
  if (event.type === "agent.work") {
    return { ...event, ts, startedAt: Math.round(base + schedule.offsetOf(event.startedAt)) };
  }
  return { ...event, ts };
}

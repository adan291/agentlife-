import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentState, ScopedAgentId } from "@agentlife/shared";
import { MoodKeeper, OPEN_INTERVAL_MAX_MS } from "../src/mood.ts";

const MIN = 60_000;
const NINE = new Date(2026, 10, 13, 9, 0, 0).getTime();
const LIMITS = { busyMs: 20 * MIN, tiredMs: 60 * MIN };

/** A keeper and a clock the test moves. */
function setup(start = NINE) {
  let t = start;
  const keeper = new MoodKeeper({ limits: LIMITS, now: () => t });
  let seq = 0;
  const state = (agentId: string, s: AgentState, ts = t): AgentEvent => ({ seq: seq++, ts, taskId: "task-1", type: "agent.state_changed", agentId: agentId as ScopedAgentId, state: s });
  return { keeper, state, set: (ts: number) => (t = ts), advance: (ms: number) => (t += ms), now: () => t };
}
const DEV = "alpha:developer";

describe("the mood of a desk agent", () => {
  it("starts rested, and an agent nobody saw work is rested", () => {
    const { keeper } = setup();
    expect(keeper.moods("alpha")).toEqual({ architect: "rested", developer: "rested", qa: "rested" });
    expect(keeper.workedMs("alpha", "developer")).toBe(0);
  });

  it("counts the time of an open interval up to now: busy after 20 minutes, tired after 60", () => {
    const { keeper, state, advance } = setup();
    keeper.observe(state(DEV, "working"));
    advance(19 * MIN);
    expect(keeper.moodOf("alpha", "developer")).toBe("rested");
    advance(1 * MIN);
    expect(keeper.moodOf("alpha", "developer")).toBe("busy");
    advance(39 * MIN);
    expect(keeper.moodOf("alpha", "developer")).toBe("busy");
    advance(1 * MIN);
    expect(keeper.moodOf("alpha", "developer")).toBe("tired");
    // The others did nothing.
    expect(keeper.moodOf("alpha", "qa")).toBe("rested");
    expect(keeper.moodOf("beta", "developer")).toBe("rested");
  });

  it("adds up the intervals of the day, and thinking is work too", () => {
    const { keeper, state, advance } = setup();
    keeper.observe(state(DEV, "thinking"));
    advance(15 * MIN);
    keeper.observe(state(DEV, "idle"));
    advance(30 * MIN); // idle time does not count
    expect(keeper.workedMs("alpha", "developer")).toBe(15 * MIN);
    keeper.observe(state(DEV, "working"));
    advance(10 * MIN);
    keeper.observe(state(DEV, "waiting_approval"));
    expect(keeper.workedMs("alpha", "developer")).toBe(25 * MIN);
    expect(keeper.moodOf("alpha", "developer")).toBe("busy");
    advance(5 * 3_600_000);
    expect(keeper.workedMs("alpha", "developer")).toBe(25 * MIN);
  });

  it("counts an interval that never ended for at most two hours", () => {
    const { keeper, state, advance } = setup();
    keeper.observe(state(DEV, "working"));
    advance(10 * 3_600_000 - 2 * 3_600_000); // still the same day (9:00 to 17:00)
    expect(keeper.workedMs("alpha", "developer")).toBe(OPEN_INTERVAL_MAX_MS);
    keeper.observe(state(DEV, "idle"));
    expect(keeper.workedMs("alpha", "developer")).toBe(OPEN_INTERVAL_MAX_MS);
  });

  it("ignores an event that goes back in time, so a replay counts once", () => {
    const { keeper, state, advance, now } = setup();
    const start = now();
    keeper.observe(state(DEV, "working", start));
    advance(30 * MIN);
    keeper.observe(state(DEV, "idle", start + 30 * MIN));
    // The whole thing again, from an engine that sent it twice.
    expect(keeper.observe(state(DEV, "working", start))).toBeUndefined();
    expect(keeper.observe(state(DEV, "idle", start + 10 * MIN))).toBeUndefined();
    expect(keeper.workedMs("alpha", "developer")).toBe(30 * MIN);
  });

  it("starts a new day from zero, and an interval that crosses midnight counts from midnight", () => {
    const { keeper, state, advance, set } = setup(new Date(2026, 10, 13, 23, 0, 0).getTime());
    keeper.observe(state(DEV, "working"));
    advance(50 * MIN); // 23:50, still the same day
    expect(keeper.workedMs("alpha", "developer")).toBe(50 * MIN);
    set(new Date(2026, 10, 14, 0, 30, 0).getTime());
    // Half an hour after midnight: only the part inside the new day counts.
    expect(keeper.workedMs("alpha", "developer")).toBe(30 * MIN);
    keeper.observe(state(DEV, "idle"));
    expect(keeper.workedMs("alpha", "developer")).toBe(30 * MIN);
    set(new Date(2026, 10, 15, 9, 0, 0).getTime());
    expect(keeper.workedMs("alpha", "developer")).toBe(0);
  });

  it("ignores the Builder, other events and ids that are not a role of a project", () => {
    const { keeper, state } = setup();
    expect(keeper.observe(state("builder", "working"))).toBeUndefined();
    expect(keeper.observe(state("alpha:researcher", "working"))).toBeUndefined();
    expect(keeper.observe({ seq: 99, ts: NINE, taskId: "task-1", type: "agent.say", agentId: DEV, text: "hello" })).toBeUndefined();
    expect(keeper.observe(state(DEV, "working"))).toEqual({ projectId: "alpha", role: "developer" });
  });
});

describe("coffee", () => {
  it("rests an agent: the work counted so far no longer counts, the work after it does", () => {
    const { keeper, state, advance } = setup();
    keeper.observe(state(DEV, "working"));
    advance(70 * MIN);
    expect(keeper.moodOf("alpha", "developer")).toBe("tired");
    keeper.serveCoffee("alpha", "developer");
    expect(keeper.moodOf("alpha", "developer")).toBe("rested");
    expect(keeper.workedMs("alpha", "developer")).toBe(0);
    // It keeps working: tired again after another hour.
    advance(59 * MIN);
    expect(keeper.moodOf("alpha", "developer")).toBe("busy");
    advance(1 * MIN);
    expect(keeper.moodOf("alpha", "developer")).toBe("tired");
  });

  it("goes to the tired agent that has worked most, and to nobody when none is tired", () => {
    const { keeper, state, advance } = setup();
    expect(keeper.mostTired("alpha")).toBeUndefined();
    keeper.observe(state("alpha:architect", "working"));
    keeper.observe(state("alpha:qa", "working"));
    advance(30 * MIN);
    expect(keeper.mostTired("alpha")).toBeUndefined(); // busy is not tired
    keeper.observe(state(DEV, "working"));
    advance(35 * MIN); // architect and qa 65 min, developer 35 min
    expect(keeper.mostTired("alpha")).toBe("architect"); // a tie goes to the first role of the flow
    keeper.serveCoffee("alpha", "architect");
    expect(keeper.mostTired("alpha")).toBe("qa");
    keeper.serveCoffee("alpha", "qa");
    expect(keeper.mostTired("alpha")).toBeUndefined();
  });

  it("can be served to an agent that never worked, and nothing goes below zero", () => {
    const { keeper } = setup();
    keeper.serveCoffee("alpha", "qa");
    expect(keeper.workedMs("alpha", "qa")).toBe(0);
  });
});

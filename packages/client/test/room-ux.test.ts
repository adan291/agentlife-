import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AGENT_IDS, JobStateSchema } from "@agentlife/shared";
import type { JobState, JobView, ServerMsg } from "@agentlife/shared";
import { FOCUS_MS, easeToward, rootPositionFor } from "../src/scene/camera.ts";
import { STATE_COLOURS } from "../src/palette.ts";
import { formatDuration } from "../src/ui/duration.ts";
import { stepLabel, stepperFor } from "../src/ui/stepper.ts";
import { TeamModel, elapsedText, rowTone } from "../src/ui/team-bar.ts";
import { TAB_TITLE, tabTitle, yourTurnVisible } from "../src/ui/toast.ts";

// ---- stepper ----

const job = (state: JobState, timeline: [JobState, number, string?][] = []): JobView => ({
  taskId: "t1",
  repoId: "r",
  goal: "g",
  state,
  timeline: timeline.map(([s, ts, text]) => ({ ts, state: s, ...(text ? { text } : {}) })),
});
const statuses = (j: JobView | null) => stepperFor(j).map((s) => s.status);

describe("stepperFor", () => {
  it("is empty without a job and has the six steps otherwise", () => {
    expect(stepperFor(null)).toEqual([]);
    expect(stepperFor(job("created")).map((s) => s.label)).toEqual(["Plan", "Approve", "Build", "Test", "Review", "Report"]);
  });

  it("maps every state of a running job to one current step", () => {
    const expected: [JobState, number][] = [
      ["created", 0],
      ["analyzing", 0],
      ["awaiting_plan_approval", 1],
      ["developing", 2],
      ["testing", 3],
      ["reviewing", 4],
      ["report_ready", 5],
    ];
    for (const [state, idx] of expected) {
      const s = stepperFor(job(state));
      expect(s.filter((x) => x.status === "current").map((x) => x.key), state).toEqual([s[idx]!.key]);
      expect(s.slice(0, idx).every((x) => x.status === "done"), state).toBe(true);
      expect(s.slice(idx + 1).every((x) => x.status === "pending"), state).toBe(true);
    }
  });

  it("marks every step done when the job is delivered", () => {
    expect(statuses(job("delivered"))).toEqual(Array(6).fill("done"));
  });

  it("handles every job state without throwing", () => {
    for (const state of JobStateSchema.options) {
      const s = stepperFor(job(state));
      expect(s).toHaveLength(6);
      expect(s.filter((x) => x.status === "current").length).toBeLessThanOrEqual(1);
    }
  });

  it("reads 'Your turn' on the Approve step and makes it clickable only while the plan waits", () => {
    const waiting = stepperFor(job("awaiting_plan_approval"));
    expect(waiting[1]).toMatchObject({ key: "approve", yourTurn: true, status: "current" });
    expect(stepLabel(waiting[1]!)).toBe("Your turn");
    expect(waiting.filter((s) => s.yourTurn)).toHaveLength(1);
    const later = stepperFor(job("developing"));
    expect(later.some((s) => s.yourTurn)).toBe(false);
    expect(stepLabel(later[1]!)).toMatch(/^✓ Approve/);
  });

  it("uses the responsible agent's colour owner for each step", () => {
    expect(stepperFor(job("created")).map((s) => s.agentId)).toEqual(["architect", "architect", "developer", "qa", "qa", "architect"]);
  });

  it("shows the duration of finished steps from the timeline", () => {
    const j = job("reviewing", [
      ["analyzing", 1_000],
      ["awaiting_plan_approval", 31_000],
      ["developing", 41_000],
      ["testing", 60_000],
      ["reviewing", 62_000],
    ]);
    const s = stepperFor(j);
    expect(s.map((x) => x.durationMs)).toEqual([30_000, 10_000, 19_000, 2_000, undefined, undefined]);
    expect(stepLabel(s[0]!)).toBe("✓ Plan 30s");
    expect(stepLabel(s[3]!)).toBe("✓ Test 2.0s");
    expect(stepLabel(s[4]!)).toBe("Review");
  });

  it("sums the build time over a retry and sends the job back to Build", () => {
    const j = job("developing", [
      ["analyzing", 0],
      ["awaiting_plan_approval", 10_000],
      ["developing", 12_000],
      ["testing", 22_000],
      ["reviewing", 24_000],
      ["developing", 30_000],
    ]);
    const s = stepperFor(j);
    expect(s[2]).toMatchObject({ status: "current" });
    expect(s[3]!.status).toBe("pending");
    expect(s[3]!.durationMs).toBeUndefined();
  });

  it("marks the failing step red and later steps pending, even when the job ends delivered with a failure report", () => {
    const failedInTest: [JobState, number][] = [
      ["analyzing", 0],
      ["awaiting_plan_approval", 10],
      ["developing", 20],
      ["testing", 30],
      ["failed", 40],
      ["report_ready", 41],
      ["delivered", 50],
    ];
    for (const state of ["failed", "report_ready", "delivered"] as const) {
      const s = stepperFor(job(state, failedInTest));
      expect(s.map((x) => x.status), state).toEqual(["done", "done", "done", "failed", "pending", "pending"]);
      expect(stepLabel(s[3]!)).toBe("✗ Test (Failed)");
    }
  });

  it("marks a rejected plan red on the Approve step", () => {
    const s = stepperFor(job("cancelled", [["analyzing", 0], ["awaiting_plan_approval", 10], ["cancelled", 20, "Plan rejected"]]));
    expect(s.map((x) => x.status)).toEqual(["done", "failed", "pending", "pending", "pending", "pending"]);
    expect(stepLabel(s[1]!)).toBe("✗ Approve (Plan rejected)");
    const c = stepperFor(job("cancelled", [["analyzing", 0], ["cancelled", 5, "Cancelled by user"]]));
    expect(c[0]).toMatchObject({ status: "failed", note: "Cancelled" });
  });

  it("never gives a step both 'current' and 'yourTurn' wrongly, for any timeline (property)", () => {
    const states = fc.constantFrom(...JobStateSchema.options);
    fc.assert(
      fc.property(states, fc.array(fc.tuple(states, fc.integer({ min: 0, max: 1_000_000 })), { maxLength: 12 }), (state, tl) => {
        const sorted = [...tl].sort((a, b) => a[1] - b[1]);
        const s = stepperFor(job(state, sorted));
        return s.length === 6 && s.every((x) => !x.yourTurn || (x.key === "approve" && x.status === "current"));
      }),
    );
  });
});

describe("formatDuration", () => {
  it("formats short, medium and long spans", () => {
    expect(formatDuration(850)).toBe("0.9s");
    expect(formatDuration(2000)).toBe("2.0s");
    expect(formatDuration(12_400)).toBe("12s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(3_723_000)).toBe("1h 02m");
    expect(formatDuration(-5)).toBe("0.0s");
  });
});

// ---- your-turn toast ----

describe("your-turn toast rules", () => {
  it("shows while an approval is pending and the mailbox is not open", () => {
    expect(yourTurnVisible(1, null)).toBe(true);
    expect(yourTurnVisible(1, "board")).toBe(true);
    expect(yourTurnVisible(1, "computer")).toBe(true);
  });

  it("hides when the mailbox is opened or the approval is resolved, and comes back when the mailbox closes while pending", () => {
    expect(yourTurnVisible(1, "mailbox")).toBe(false);
    expect(yourTurnVisible(0, null)).toBe(false);
    expect(yourTurnVisible(0, "mailbox")).toBe(false);
    // Sequence: pending -> open mailbox -> close it again -> still pending.
    const seq: [number, "mailbox" | null][] = [[1, null], [1, "mailbox"], [1, null]];
    expect(seq.map(([p, o]) => yourTurnVisible(p, o))).toEqual([true, false, true]);
  });

  it("puts the pending count in the tab title, also while the mailbox is open", () => {
    expect(tabTitle(0)).toBe(TAB_TITLE);
    expect(tabTitle(1)).toBe("(1) AGENT LIFE");
    expect(tabTitle(2)).toBe("(2) AGENT LIFE");
  });
});

// ---- team bar ----

describe("rowTone", () => {
  it("highlights and animates working and thinking only", () => {
    for (const s of ["working", "thinking"] as const) expect(rowTone(s)).toMatchObject({ highlight: true, animate: true });
    for (const s of ["idle", "walking", "waiting_approval", "blocked", "done", "error"] as const) {
      expect(rowTone(s), s).toMatchObject({ highlight: false, animate: false });
    }
  });

  it("gives waiting_approval, error and done their own distinct colours", () => {
    const colours = [rowTone("waiting_approval").colour, rowTone("error").colour, rowTone("done").colour, rowTone("working").colour, rowTone("idle").colour];
    expect(new Set(colours).size).toBe(colours.length);
    expect(rowTone("error").colour).toBe(STATE_COLOURS.error);
  });
});

const welcome = (over: Partial<Extract<ServerMsg, { type: "welcome" }>> = {}): ServerMsg => ({
  type: "welcome",
  protocol: 1,
  room: {} as never,
  you: 1,
  avatars: [],
  agents: [],
  ...over,
});

describe("TeamModel", () => {
  it("lists the four agents in order, idle at the start", () => {
    const m = new TeamModel(1000);
    expect(m.rows().map((r) => r.agentId)).toEqual([...AGENT_IDS]);
    expect(m.rows().every((r) => r.state === "idle")).toBe(true);
  });

  it("takes states, models and the last activity per agent from welcome", () => {
    const m = new TeamModel(0);
    m.apply(
      welcome({
        agents: [{ agentId: "developer", state: "working", text: "Editing files" }],
        models: { developer: "claude-x", qa: "claude-y" },
        activity: [
          { ts: 1, agentId: "qa", text: "old" },
          { ts: 2, agentId: "qa", text: "Running tests" },
        ],
      }),
      5000,
    );
    expect(m.row("developer")).toMatchObject({ state: "working", text: "Editing files", model: "claude-x", since: 5000 });
    expect(m.row("qa")).toMatchObject({ state: "idle", model: "claude-y", activity: "Running tests" });
    expect(m.row("builder").model).toBeUndefined();
  });

  it("updates on agent_state and activity messages and reports whether something changed", () => {
    const m = new TeamModel(0);
    expect(m.apply({ type: "agent_state", agentId: "qa", state: "working", text: "Running tests" }, 100)).toBe(true);
    expect(m.row("qa")).toMatchObject({ state: "working", text: "Running tests", since: 100 });
    // Same state, new text: text changes, the timer keeps running.
    expect(m.apply({ type: "agent_state", agentId: "qa", state: "working", text: "Reviewing" }, 900)).toBe(true);
    expect(m.row("qa")).toMatchObject({ text: "Reviewing", since: 100 });
    expect(m.apply({ type: "agent_state", agentId: "qa", state: "working", text: "Reviewing" }, 950)).toBe(false);
    // A new state restarts the timer and clears a missing text.
    m.apply({ type: "agent_state", agentId: "qa", state: "done" }, 2000);
    expect(m.row("qa")).toMatchObject({ state: "done", since: 2000 });
    expect(m.row("qa").text).toBeUndefined();

    expect(m.apply({ type: "activity", line: { ts: 5, agentId: "architect", text: "Plan ready: 3 tasks" } })).toBe(true);
    expect(m.row("architect").activity).toBe("Plan ready: 3 tasks");
    expect(m.apply({ type: "activity", line: { ts: 6, agentId: "architect", text: "Plan ready: 3 tasks" } })).toBe(false);
    expect(m.apply({ type: "say", id: "qa", text: "hi" })).toBe(false);
  });

  it("shows elapsed time for busy agents and nothing for idle ones", () => {
    const m = new TeamModel(0);
    m.apply({ type: "agent_state", agentId: "developer", state: "working" }, 1000);
    expect(elapsedText(m.row("developer"), 13_400)).toBe("12s");
    expect(elapsedText(m.row("architect"), 13_400)).toBe("");
  });
});

// ---- camera ----

describe("camera", () => {
  it("puts the focus point at the centre of the screen", () => {
    const p = rootPositionFor({ x: 100, y: 50 }, 2, 800, 600);
    expect(p).toEqual({ x: 200, y: 200 });
    // The point lands on the screen centre.
    expect(100 * 2 + p.x).toBe(400);
    expect(50 * 2 + p.y).toBe(300);
  });

  it("eases towards the target and lands exactly on it", () => {
    let cur = { x: 0, y: 0 };
    const target = { x: 300, y: -120 };
    let steps = 0;
    while ((cur.x !== target.x || cur.y !== target.y) && steps < 200) {
      const next = easeToward(cur, target);
      expect(Math.abs(target.x - next.x)).toBeLessThanOrEqual(Math.abs(target.x - cur.x));
      cur = next;
      steps++;
    }
    expect(cur).toEqual(target);
    expect(steps).toBeLessThan(60);
  });

  it("holds the focus for a few seconds", () => {
    expect(FOCUS_MS).toBeGreaterThanOrEqual(2000);
  });
});

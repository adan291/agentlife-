import { describe, expect, it } from "vitest";
import type { AgentEvent, JobKind, JobState } from "@agentlife/shared";
import { GrantTracker, TRACKED_TASKS_MAX } from "../src/grants.ts";

let seq = 0;
const created = (taskId: string, kind?: JobKind): AgentEvent => ({ seq: seq++, ts: 100, taskId, type: "task.created", repoId: "alpha", goal: "a goal", ...(kind ? { kind } : {}) });
const state = (taskId: string, to: JobState, reason?: string, ts = 200): AgentEvent => ({ seq: seq++, ts, taskId, type: "task.state_changed", state: to, ...(reason ? { reason } : {}) });
const failed = (taskId: string): AgentEvent => ({ seq: seq++, ts: 150, taskId, type: "task.failed", reason: "boom" });
const delivery = (taskId: string, ts = 300): AgentEvent => ({ seq: seq++, ts, taskId, type: "delivery.done", branch: "agentlife/x", commit: "abc123" });

/** The grants that the whole list of events makes, in order. */
function run(events: AgentEvent[], tracker = new GrantTracker()) {
  return events.flatMap((e) => tracker.observe(e));
}

describe("GrantTracker", () => {
  it("pays job_passed when a job is delivered with a pass verdict", () => {
    const out = run([created("t1"), state("t1", "report_ready", "verdict:pass"), state("t1", "delivered", undefined, 250)]);
    expect(out).toEqual([{ reason: "job_passed", ref: "t1", ts: 250 }]);
  });

  it("pays nothing for a fail verdict, or for a job that is not delivered yet", () => {
    expect(run([created("t1"), state("t1", "report_ready", "verdict:fail"), state("t1", "delivered")])).toEqual([]);
    expect(run([created("t2"), state("t2", "report_ready", "verdict:pass")])).toEqual([]);
  });

  it("pays nothing for a job that failed on the way, even when it ends delivered with a pass-looking report", () => {
    expect(run([created("t1"), state("t1", "failed", "tests failed"), state("t1", "report_ready", "verdict:pass"), state("t1", "delivered")])).toEqual([]);
    expect(run([created("t2"), failed("t2"), state("t2", "report_ready", "verdict:pass"), state("t2", "delivered")])).toEqual([]);
  });

  it("pays review_finished for a delivered branch review whatever it found", () => {
    const asked = run([created("r1", "review-branch"), state("r1", "report_ready", "verdict:fail"), state("r1", "delivered")]);
    expect(asked).toEqual([{ reason: "review_finished", ref: "r1", ts: 200 }]);
    const passed = run([created("r2", "review-branch"), state("r2", "report_ready", "verdict:pass"), state("r2", "delivered")]);
    expect(passed.map((g) => g.reason)).toEqual(["review_finished"]);
  });

  it("pays nothing for a branch review that failed (nothing to compare, timeout)", () => {
    expect(run([created("r1", "review-branch"), state("r1", "failed", "no other branch"), state("r1", "report_ready", "verdict:fail"), state("r1", "delivered")])).toEqual([]);
  });

  it("pays job_passed for the other kinds too", () => {
    for (const kind of ["write-tests", "document", "audit-deps"] as const) {
      const id = `k-${kind}`;
      expect(run([created(id, kind), state(id, "report_ready", "verdict:pass"), state(id, "delivered")]).map((g) => g.reason)).toEqual(["job_passed"]);
    }
  });

  it("pays branch_delivered on delivery.done, once per event", () => {
    expect(run([created("t1"), delivery("t1", 400)])).toEqual([{ reason: "branch_delivered", ref: "t1", ts: 400 }]);
    // A delivery of a job the tracker never saw still counts: the engine only records it for a real delivery.
    expect(run([delivery("unseen")]).map((g) => g.ref)).toEqual(["unseen"]);
  });

  it("never guesses: a job whose creation was not seen earns nothing when it is delivered", () => {
    expect(run([state("ghost", "report_ready", "verdict:pass"), state("ghost", "delivered")])).toEqual([]);
  });

  it("makes the same grants when the events are replayed", () => {
    const events = [created("t1"), state("t1", "report_ready", "verdict:pass"), state("t1", "delivered"), delivery("t1")];
    const first = run(events);
    const second = run(events, new GrantTracker());
    expect(second).toEqual(first);
    expect(first.map((g) => g.reason)).toEqual(["job_passed", "branch_delivered"]);
  });

  it("ignores events that are not about money", () => {
    const t = new GrantTracker();
    expect(t.observe({ seq: 1, ts: 1, taskId: "t1", type: "task.completed" })).toEqual([]);
    expect(t.observe({ seq: 2, ts: 1, taskId: "t1", type: "task.queued", position: 1 })).toEqual([]);
  });

  it("forgets the oldest tasks past the limit and keeps working", () => {
    const t = new GrantTracker();
    for (let i = 0; i < TRACKED_TASKS_MAX + 3; i++) t.observe(created(`old-${i}`));
    expect(t.observe(state("old-0", "report_ready", "verdict:pass")).length + t.observe(state("old-0", "delivered")).length).toBe(0);
    t.observe(state(`old-${TRACKED_TASKS_MAX + 2}`, "report_ready", "verdict:pass"));
    expect(t.observe(state(`old-${TRACKED_TASKS_MAX + 2}`, "delivered")).map((g) => g.reason)).toEqual(["job_passed"]);
  });
});

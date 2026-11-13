import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentState, JobKind, JobState } from "@agentlife/shared";
import { GrantTracker } from "../src/grants.ts";
import { ProgressTracker, TRACKED_TASKS_MAX } from "../src/progress-tracker.ts";

let seq = 0;
const created = (taskId: string, kind?: JobKind, repoId = "alpha"): AgentEvent => ({ seq: seq++, ts: 100, taskId, type: "task.created", repoId, goal: "a goal", ...(kind ? { kind } : {}) });
const state = (taskId: string, to: JobState, reason?: string, ts = 900): AgentEvent => ({ seq: seq++, ts, taskId, type: "task.state_changed", state: to, ...(reason ? { reason } : {}) });
const agent = (taskId: string, agentId: string, to: AgentState, ts: number): AgentEvent =>
  ({ seq: seq++, ts, taskId, type: "agent.state_changed", agentId, state: to }) as AgentEvent;
const work = (taskId: string, agentId: string, startedAt: number): AgentEvent =>
  ({ seq: seq++, ts: startedAt, taskId, type: "agent.work", agentId, step: "develop", title: "A step", filesRead: 0, filesEdited: 0, startedAt }) as AgentEvent;
const requested = (taskId: string, approvalId: string, summary = "Plan: do it"): AgentEvent =>
  ({ seq: seq++, ts: 300, taskId, type: "approval.requested", approvalId, kind: "plan", summary }) as AgentEvent;
const resolved = (taskId: string, approvalId: string, decision: "approve" | "reject"): AgentEvent =>
  ({ seq: seq++, ts: 400, taskId, type: "approval.resolved", approvalId, decision }) as AgentEvent;
const delivery = (taskId: string): AgentEvent => ({ seq: seq++, ts: 950, taskId, type: "delivery.done", branch: "agentlife/x", commit: "abc123" });

/** The facts the whole list of events makes, in order. The grant tracker sees each event first, as in the gateway. */
function run(events: AgentEvent[], grants = new GrantTracker(), tracker = new ProgressTracker()) {
  return events.flatMap((e) => {
    grants.observe(e);
    return tracker.observe(e, grants);
  });
}
const sources = (out: ReturnType<typeof run>) => out.map((t) => t.fact.source);

describe("ProgressTracker", () => {
  it("makes a step_done for the role that finished, with how long it took", () => {
    const out = run([created("t1"), work("t1", "alpha:developer", 200), agent("t1", "alpha:developer", "done", 245)]);
    expect(out).toEqual([{ fact: { source: "step_done", ref: "t1.developer", ts: 245, stepMs: 45 }, projectId: "alpha", roles: ["developer"] }]);
  });

  it("knows the project from the task when the agent id is not scoped", () => {
    const out = run([created("t1", undefined, "beta"), agent("t1", "qa", "done", 300)]);
    expect(out).toEqual([{ fact: { source: "step_done", ref: "t1.qa", ts: 300 }, projectId: "beta", roles: ["qa"] }]);
  });

  it("does not time a step whose start it did not see, or that started after it ended", () => {
    expect(run([created("t1"), agent("t1", "alpha:qa", "done", 300)])[0]?.fact.stepMs).toBeUndefined();
    expect(run([created("t2"), work("t2", "alpha:qa", 500), agent("t2", "alpha:qa", "done", 300)])[0]?.fact.stepMs).toBeUndefined();
  });

  it("makes nothing for states other than done, the Builder, or a task it never saw", () => {
    expect(run([created("t1"), agent("t1", "alpha:developer", "working", 210), agent("t1", "alpha:developer", "error", 220)])).toEqual([]);
    expect(run([created("t2"), agent("t2", "builder", "done", 300)])).toEqual([]);
    expect(run([agent("ghost", "alpha:developer", "done", 300)])).toEqual([]);
  });

  it("counts a retried step with the same ref, so the file counts it once", () => {
    const out = run([created("t1"), agent("t1", "alpha:developer", "done", 300), agent("t1", "alpha:developer", "done", 600)]);
    expect(out.map((t) => t.fact.ref)).toEqual(["t1.developer", "t1.developer"]);
  });

  it("makes job_passed for the roles that did the job when a passing job is delivered", () => {
    const out = run([
      created("t1"),
      agent("t1", "alpha:architect", "done", 300),
      agent("t1", "alpha:developer", "done", 400),
      agent("t1", "alpha:qa", "done", 500),
      state("t1", "report_ready", "verdict:pass"),
      state("t1", "delivered"),
    ]);
    expect(sources(out)).toEqual(["step_done", "step_done", "step_done", "job_passed"]);
    expect(out.at(-1)).toEqual({ fact: { source: "job_passed", ref: "t1", ts: 900 }, projectId: "alpha", roles: ["architect", "developer", "qa"] });
  });

  it("makes job_not_passed for a fail verdict, and for a job that failed on the way even with a pass-looking report", () => {
    expect(sources(run([created("t1"), state("t1", "report_ready", "verdict:fail"), state("t1", "delivered")]))).toEqual(["job_not_passed"]);
    expect(sources(run([created("t2"), state("t2", "failed", "boom"), state("t2", "report_ready", "verdict:pass"), state("t2", "delivered")]))).toEqual(["job_not_passed"]);
  });

  it("makes nothing at report_ready, or for a delivered job it never saw created", () => {
    expect(run([created("t1"), state("t1", "report_ready", "verdict:pass")])).toEqual([]);
    expect(run([state("ghost", "report_ready", "verdict:pass"), state("ghost", "delivered")])).toEqual([]);
  });

  it("makes review_finished and review_passed for a branch review that passed", () => {
    const out = run([created("r1", "review-branch"), agent("r1", "alpha:qa", "done", 300), state("r1", "report_ready", "verdict:pass"), state("r1", "delivered")]);
    expect(sources(out)).toEqual(["step_done", "review_finished", "review_passed"]);
    expect(out.at(-1)?.roles).toEqual(["qa"]);
  });

  it("makes review_finished and job_not_passed for a review that asked for changes, and neither review fact for one that failed", () => {
    expect(sources(run([created("r1", "review-branch"), state("r1", "report_ready", "verdict:fail"), state("r1", "delivered")]))).toEqual(["review_finished", "job_not_passed"]);
    expect(sources(run([created("r2", "review-branch"), state("r2", "failed", "no base"), state("r2", "report_ready", "verdict:fail"), state("r2", "delivered")]))).toEqual(["job_not_passed"]);
  });

  it("makes plan_approved when the user approves a plan, not for a reject, an unknown approval or a night plan", () => {
    expect(run([created("t1"), requested("t1", "appr-t1"), resolved("t1", "appr-t1", "approve")])).toEqual([
      { fact: { source: "plan_approved", ref: "appr-t1", ts: 400 }, roles: [] },
    ]);
    expect(run([created("t2"), requested("t2", "appr-t2"), resolved("t2", "appr-t2", "reject")])).toEqual([]);
    expect(run([resolved("t3", "appr-unknown", "approve")])).toEqual([]);
    const night = requested("t4", "appr-t4", "Plan: x\nNight shift: approved automatically, the plan stays inside the pre-approved scope.");
    expect(run([created("t4"), night, resolved("t4", "appr-t4", "approve")])).toEqual([]);
  });

  it("makes branch_delivered on delivery.done", () => {
    expect(run([delivery("t1")])).toEqual([{ fact: { source: "branch_delivered", ref: "t1", ts: 950 }, roles: [] }]);
  });

  it("makes the same facts when the events are replayed by a new tracker", () => {
    const events = [created("t1"), agent("t1", "alpha:developer", "done", 300), state("t1", "report_ready", "verdict:pass"), state("t1", "delivered"), delivery("t1")];
    expect(run(events, new GrantTracker(), new ProgressTracker())).toEqual(run(events));
  });

  it("forgets the oldest tasks beyond its limit", () => {
    const grants = new GrantTracker();
    const tracker = new ProgressTracker();
    const events = Array.from({ length: TRACKED_TASKS_MAX + 1 }, (_, i) => created(`n${i}`));
    run(events, grants, tracker);
    expect(run([agent("n0", "alpha:qa", "done", 300)], grants, tracker)).toEqual([]);
    expect(run([agent(`n${TRACKED_TASKS_MAX}`, "alpha:qa", "done", 300)], grants, tracker)).toHaveLength(1);
  });
});

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { JobStateSchema, type AgentEvent } from "@agentlife/shared";
import { foldJob } from "../src/jobs/fold.ts";
import { Store, type NewEvent } from "../src/store.ts";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "agentlife-store-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const agent = fc.constantFrom("architect" as const, "developer" as const, "qa" as const);
const states = fc.constantFrom(...JobStateSchema.options);
const small = fc.constantFrom("a1", "a2", "a3");

/** Any event except task.created, for the given task. */
function bodyEvent(taskId: string): fc.Arbitrary<NewEvent> {
  return fc.oneof(
    fc.record({
      type: fc.constant("task.state_changed" as const),
      taskId: fc.constant(taskId),
      state: states,
      reason: fc.option(fc.constantFrom("verdict:pass", "verdict:fail", "other"), { nil: undefined }),
    }),
    fc.record({ type: fc.constant("task.failed" as const), taskId: fc.constant(taskId), reason: fc.constant("boom") }),
    fc.record({ type: fc.constant("task.completed" as const), taskId: fc.constant(taskId) }),
    fc.record({
      type: fc.constant("agent.state_changed" as const),
      taskId: fc.constant(taskId),
      agentId: agent,
      state: fc.constantFrom("idle" as const, "working" as const),
    }),
    fc.record({
      type: fc.constant("artifact.created" as const),
      taskId: fc.constant(taskId),
      kind: fc.constantFrom("plan", "diff"),
      artifactId: small,
      title: fc.constant("t"),
    }),
    fc.record({
      type: fc.constant("approval.requested" as const),
      taskId: fc.constant(taskId),
      approvalId: small,
      kind: fc.constant("plan"),
      summary: fc.constant("s"),
    }),
    fc.record({
      type: fc.constant("approval.resolved" as const),
      taskId: fc.constant(taskId),
      approvalId: small,
      decision: fc.constantFrom("approve" as const, "reject" as const),
    }),
    fc.record({
      type: fc.constant("report.ready" as const),
      taskId: fc.constant(taskId),
      reportId: fc.constant("r"),
      title: fc.constant("T"),
      markdown: fc.constant("# m"),
    }),
  );
}

const created = (taskId: string): NewEvent => ({ type: "task.created", taskId, repoId: "r", goal: "g" });

describe("Store", () => {
  it("assigns strictly increasing seq and replays from a given seq", () => {
    const s = new Store({ dbPath: ":memory:", runsDir: tmp() });
    const a = s.appendEvent(created("t1"));
    const b = s.appendEvent({ type: "task.state_changed", taskId: "t1", state: "analyzing" });
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(s.eventsSince(a.seq).map((e) => e.seq)).toEqual([b.seq]);
    expect(s.lastSeq()).toBe(b.seq);
    s.close();
  });

  it("rejects invalid events and emits committed ones on the bus", () => {
    const s = new Store({ dbPath: ":memory:", runsDir: tmp() });
    const seen: AgentEvent[] = [];
    s.bus.on("event", (e: AgentEvent) => seen.push(e));
    expect(() => s.appendEvent({ type: "task.created", taskId: "t", repoId: "r", goal: "" })).toThrow();
    expect(s.lastSeq()).toBe(0);
    s.appendEvent(created("t"));
    expect(seen).toHaveLength(1);
    s.close();
  });

  it("property: the incremental cached view equals the fold of the log", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(bodyEvent("t1"), bodyEvent("t2")), { maxLength: 40 }), (body) => {
        const s = new Store({ dbPath: ":memory:", runsDir: tmp() });
        s.appendEvent(created("t1"));
        s.appendEvent(created("t2"));
        for (const e of body) s.appendEvent(e);
        for (const id of ["t1", "t2"]) {
          expect(s.getJob(id)).toEqual(foldJob(s.eventsFor(id)));
        }
        s.close();
      }),
      { numRuns: 60 },
    );
  });

  it("property: views rebuilt from disk after a restart equal the live views", () => {
    const dir = tmp();
    fc.assert(
      fc.property(fc.array(bodyEvent("t1"), { maxLength: 25 }), (body) => {
        const dbPath = path.join(dir, `e-${Math.random().toString(36).slice(2)}.db`);
        const s = new Store({ dbPath, runsDir: dir });
        s.appendEvent(created("t1"));
        for (const e of body) s.appendEvent(e);
        const live = s.getJob("t1");
        s.close();
        const again = new Store({ dbPath, runsDir: dir });
        expect(again.getJob("t1")).toEqual(live);
        again.close();
      }),
      { numRuns: 20 },
    );
  });

  it("folds a normal run into steps, approvals, artifacts and verdict", () => {
    const s = new Store({ dbPath: ":memory:", runsDir: tmp() });
    s.appendEvent({ ...created("t1"), ts: 1 });
    s.appendEvent({ type: "task.state_changed", taskId: "t1", state: "analyzing", ts: 2 });
    s.appendEvent({ type: "approval.requested", taskId: "t1", approvalId: "ap", kind: "plan", summary: "p", ts: 3 });
    s.appendEvent({ type: "task.state_changed", taskId: "t1", state: "awaiting_plan_approval", ts: 4 });
    s.appendEvent({ type: "approval.resolved", taskId: "t1", approvalId: "ap", decision: "approve", ts: 5 });
    s.appendEvent({ type: "task.state_changed", taskId: "t1", state: "report_ready", reason: "verdict:pass", ts: 6 });
    const j = s.getJob("t1")!;
    expect(j.state).toBe("report_ready");
    expect(j.verdict).toBe("pass");
    expect(j.approvals[0]?.status).toBe("approved");
    expect(j.steps).toEqual([
      { step: "analyze", startedAt: 2, endedAt: 4, durationMs: 2, status: "ok" },
      { step: "report", startedAt: 6, status: "running" },
    ]);
    s.close();
  });

  it("writes artifacts under runs/<taskId>/ and reads them back", () => {
    const runs = tmp();
    const s = new Store({ dbPath: ":memory:", runsDir: runs });
    s.appendEvent(created("t1"));
    const id = s.saveArtifact({ taskId: "t1", agentId: "architect", kind: "plan", title: "Plan", filename: "plan.json", content: "{}" });
    expect(existsSync(path.join(runs, "t1", "plan.json"))).toBe(true);
    expect(readFileSync(path.join(runs, "t1", "plan.json"), "utf8")).toBe("{}");
    expect(s.readArtifact(id)).toMatchObject({ taskId: "t1", kind: "plan", content: "{}" });
    expect(s.getJob("t1")?.artifacts).toEqual([{ artifactId: id, kind: "plan", title: "Plan" }]);
    expect(s.readArtifact("missing")).toBeUndefined();
    s.close();
  });

  it("refuses path traversal in task ids and file names", () => {
    const s = new Store({ dbPath: ":memory:", runsDir: tmp() });
    const base = { kind: "x", title: "x", content: "x" };
    expect(() => s.saveArtifact({ ...base, taskId: "..", filename: "a.txt" })).toThrow();
    expect(() => s.saveArtifact({ ...base, taskId: "t1", filename: "../a.txt" })).toThrow();
    expect(() => s.saveArtifact({ ...base, taskId: "t1", filename: "a/b.txt" })).toThrow();
    s.close();
  });
});

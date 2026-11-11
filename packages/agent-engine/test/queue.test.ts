import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentEventSchema, ScopedAgentIdSchema, splitAgentId } from "@agentlife/shared";
import type { AgentEvent, Plan, Review } from "@agentlife/shared";
import { createActivityEmitter } from "../src/activity.ts";
import type { LimitsConfig } from "../src/config.ts";
import { loadConfig } from "../src/config.ts";
import { ConflictError } from "../src/errors.ts";
import { JobRunner } from "../src/jobs/runner.ts";
import type { Steps } from "../src/jobs/steps.ts";
import { Store } from "../src/store.ts";

const tmpDirs: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const LIMITS: LimitsConfig = {
  timeoutsMs: { analyze: 5000, develop: 5000, test: 5000, review: 5000 },
  maxDiffLines: 400,
  maxFilesChanged: 10,
  maxConcurrentJobs: 2,
};
const PLAN: Plan = { tasks: [{ id: "t1", title: "Do it", why: "because", files: ["a.js"], acceptance: "ok", risk: "low" }] };
const pass: Review = { verdict: "pass", notes: [], risk: "low" };

/** Steps whose analyze step of each project waits until the test opens its gate. */
function gatedSteps() {
  const gates = new Map<string, () => void>();
  const started: string[] = [];
  const steps: Steps = {
    analyze: (ctx) =>
      new Promise((resolve) => {
        started.push(ctx.repoId);
        gates.set(ctx.repoId, () => resolve(PLAN));
      }),
    develop: async () => ({ diff: "diff" }),
    test: async () => ({ passed: true, log: "ok" }),
    review: async () => pass,
    report: async () => ({ title: "Report", markdown: "# Report" }),
  };
  return { steps, started, open: (repo: string) => gates.get(repo)?.() };
}

function setup(steps: Steps, limits: LimitsConfig = LIMITS) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentlife-queue-"));
  tmpDirs.push(dir);
  const store = new Store({ dbPath: ":memory:", runsDir: dir });
  stores.push(store);
  const runner = new JobRunner({ store, steps, limits, reportTimeoutMs: 1000, activity: createActivityEmitter({ append: (e) => store.appendEvent(e) }) });
  return { store, runner };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 15));
const queuedOf = (store: Store, id: string): number[] =>
  store.eventsFor(id).flatMap((e) => (e.type === "task.queued" ? [e.position] : []));

/** Approves the plan as soon as it is requested. */
function autoApprove(store: Store, runner: JobRunner): void {
  store.bus.on("event", (ev: AgentEvent) => {
    if (ev.type === "approval.requested") queueMicrotask(() => runner.resolveApproval(ev.approvalId, "approve"));
  });
}

describe("one job per project", () => {
  it("refuses a second job on the same project while the first is unfinished, also while it waits in the queue", async () => {
    const g = gatedSteps();
    const { runner } = setup(g.steps, { ...LIMITS, maxConcurrentJobs: 1 });
    const a = runner.start("alpha", "one");
    runner.start("beta", "queued");
    expect(() => runner.start("alpha", "two")).toThrow(ConflictError);
    expect(() => runner.start("beta", "two")).toThrow(ConflictError);
    expect(runner.activeJobOn("alpha")).toBe(a);
    expect(runner.activeJobOn("gamma")).toBeUndefined();
    await runner.cancel(a);
    expect(runner.activeJobOn("alpha")).toBeUndefined();
    expect(() => runner.start("alpha", "again")).not.toThrow();
  });

  it("runs jobs of different projects at the same time", async () => {
    const g = gatedSteps();
    const { store, runner } = setup(g.steps);
    const a = runner.start("alpha", "one");
    const b = runner.start("beta", "two");
    await tick();
    expect(g.started).toEqual(["alpha", "beta"]);
    expect(store.getJob(a)!.state).toBe("analyzing");
    expect(store.getJob(b)!.state).toBe("analyzing");
    expect(queuedOf(store, a)).toEqual([]);
    expect(queuedOf(store, b)).toEqual([]);
    await runner.cancel(a);
    await runner.cancel(b);
  });
});

describe("the hotel runs at most two jobs at once", () => {
  it("queues the third job and starts the waiting jobs in order when a slot frees up", async () => {
    const g = gatedSteps();
    const { store, runner } = setup(g.steps);
    autoApprove(store, runner);
    const a = runner.start("alpha", "1");
    const b = runner.start("beta", "2");
    const c = runner.start("gamma", "3");
    const d = runner.start("delta", "4");
    await tick();

    expect(g.started).toEqual(["alpha", "beta"]);
    expect(store.getJob(c)!.state).toBe("created");
    expect(queuedOf(store, c)).toEqual([1]);
    expect(queuedOf(store, d)).toEqual([2]);
    expect(runner.queuedJobs()).toEqual([c, d]);

    // alpha finishes: gamma takes the slot, delta moves up to place 1.
    g.open("alpha");
    await runner.done(a);
    await tick();
    expect(g.started).toEqual(["alpha", "beta", "gamma"]);
    expect(store.getJob(c)!.state).toBe("analyzing");
    expect(queuedOf(store, d)).toEqual([2, 1]);
    expect(runner.queuedJobs()).toEqual([d]);

    g.open("beta");
    await runner.done(b);
    await tick();
    expect(g.started).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(runner.queuedJobs()).toEqual([]);

    g.open("gamma");
    g.open("delta");
    await runner.done(c);
    await runner.done(d);
    for (const id of [a, b, c, d]) expect(store.getJob(id)!.state).toBe("delivered");
  });

  it("a job cancelled in the queue ends cancelled, never starts and the others move up", async () => {
    const g = gatedSteps();
    const { store, runner } = setup(g.steps, { ...LIMITS, maxConcurrentJobs: 1 });
    const a = runner.start("alpha", "1");
    const b = runner.start("beta", "2");
    const c = runner.start("gamma", "3");
    await tick();
    expect(runner.queuedJobs()).toEqual([b, c]);

    await runner.cancel(b);
    expect(store.getJob(b)!.state).toBe("cancelled");
    expect(runner.queuedJobs()).toEqual([c]);
    expect(queuedOf(store, c)).toEqual([2, 1]);
    expect(g.started).toEqual(["alpha"]);

    await runner.cancel(a);
    await tick();
    expect(g.started).toEqual(["alpha", "gamma"]);
    await runner.cancel(c);
  });

  it("gives the slot back when a job fails, so a queued job still starts", async () => {
    const g = gatedSteps();
    const steps: Steps = { ...g.steps, analyze: (ctx) => (ctx.repoId === "alpha" ? Promise.reject(new Error("boom")) : g.steps.analyze(ctx)) };
    const { store, runner } = setup(steps, { ...LIMITS, maxConcurrentJobs: 1 });
    const a = runner.start("alpha", "1");
    const b = runner.start("beta", "2");
    await runner.done(a);
    await tick();
    expect(store.getJob(a)!.state).toBe("delivered");
    expect(store.getJob(a)!.verdict).toBe("fail");
    expect(g.started).toEqual(["beta"]);
    await runner.cancel(b);
  });

  it("uses a limit of 2 when the config does not set one, and the shipped config sets 2", () => {
    const { maxConcurrentJobs: _unused, ...withoutLimit } = LIMITS;
    expect(withoutLimit.maxDiffLines).toBe(400);
    const g = gatedSteps();
    const { runner } = setup(g.steps, withoutLimit);
    runner.start("alpha", "1");
    runner.start("beta", "2");
    runner.start("gamma", "3");
    expect(runner.queuedJobs()).toHaveLength(1);
    expect(loadConfig().limits.maxConcurrentJobs).toBe(2);
  });
});

describe("agent ids are scoped per project", () => {
  it("names every agent of a job <project>:<role> and keeps them valid events", async () => {
    const g = gatedSteps();
    const { store, runner } = setup(g.steps);
    autoApprove(store, runner);
    const a = runner.start("alpha", "1");
    const b = runner.start("beta", "2");
    await tick();
    g.open("alpha");
    g.open("beta");
    await runner.done(a);
    await runner.done(b);

    for (const [id, project] of [[a, "alpha"], [b, "beta"]] as const) {
      const evs = store.eventsFor(id);
      const agents = evs.flatMap((e) => ("agentId" in e && e.agentId ? [e.agentId] : []));
      expect(agents.length).toBeGreaterThan(10);
      for (const agent of agents) {
        expect(ScopedAgentIdSchema.safeParse(agent).success).toBe(true);
        expect(splitAgentId(agent).projectId, agent).toBe(project);
      }
      for (const e of evs) AgentEventSchema.parse(JSON.parse(JSON.stringify(e)));
      // Activity lines and the agent.work of the report step carry the scope too.
      expect(evs.some((e) => e.type === "agent.activity" && e.agentId === `${project}:architect`)).toBe(true);
      expect(evs.some((e) => e.type === "agent.work" && e.agentId === `${project}:qa`)).toBe(true);
    }
  });

  it("the events of a stored job come back scoped after a reload from the log", async () => {
    const g = gatedSteps();
    const { store, runner } = setup(g.steps);
    const a = runner.start("alpha", "1");
    await tick();
    const scoped = store.eventsFor(a).find((e) => e.type === "agent.state_changed");
    expect(scoped).toMatchObject({ agentId: "alpha:architect" });
    expect(store.eventsSince(0).find((e) => e.type === "agent.state_changed")).toMatchObject({ agentId: "alpha:architect" });
    await runner.cancel(a);
  });

  it("leaves the Builder and the events of unknown jobs plain", () => {
    const { store } = setup(gatedSteps().steps);
    store.appendEvent({ type: "agent.state_changed", taskId: "build:S1", agentId: "builder", state: "working" });
    store.appendEvent({ type: "agent.state_changed", taskId: "task-unknown", agentId: "architect", state: "idle" });
    const ids = store.eventsSince(0).flatMap((e) => ("agentId" in e && e.agentId ? [e.agentId] : []));
    expect(ids).toEqual(["builder", "architect"]);
  });

  it("keeps a project id that cannot be part of a scoped id out of the scope instead of failing", () => {
    const { store } = setup(gatedSteps().steps);
    store.appendEvent({ type: "task.created", taskId: "task-odd", repoId: "Not_A_Valid-Id", goal: "g" });
    store.appendEvent({ type: "agent.state_changed", taskId: "task-odd", agentId: "qa", state: "idle" });
    expect(store.eventsFor("task-odd")[1]).toMatchObject({ agentId: "qa" });
  });
});

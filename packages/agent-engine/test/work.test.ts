import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentEventSchema, RunExportSchema, type AgentEvent } from "@agentlife/shared";
import { buildExport } from "../src/http/export.ts";
import { JobRunner } from "../src/jobs/runner.ts";
import { createRuntimeSteps } from "../src/jobs/runtime-steps.ts";
import { FAKE_WORK, FakeRuntime } from "../src/runtimes/fake.ts";
import type { AgentRuntime, RuntimeEvent } from "../src/runtimes/types.ts";
import { dataPaths } from "../src/paths.ts";
import { runRole, type PipelineDeps } from "../src/steps/deps.ts";
import { Store } from "../src/store.ts";
import { WorkTracker, type WorkFields } from "../src/work.ts";
import type { LimitsConfig } from "../src/config.ts";

const tmpDirs: string[] = [];
const stores: Store[] = [];
function newStore(): Store {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentlife-work-"));
  tmpDirs.push(dir);
  const s = new Store({ dbPath: ":memory:", runsDir: dir });
  stores.push(s);
  return s;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const workOf = (events: AgentEvent[]): Extract<AgentEvent, { type: "agent.work" }>[] =>
  events.filter((e): e is Extract<AgentEvent, { type: "agent.work" }> => e.type === "agent.work");

describe("WorkTracker", () => {
  function setup(throttleMs = 1000) {
    let t = 10_000;
    const sent: WorkFields[] = [];
    const tracker = new WorkTracker({
      step: "develop",
      title: "Fix isOverdue",
      model: "m1",
      emit: (w) => sent.push(w),
      now: () => t,
      throttleMs,
    });
    return { tracker, sent, advance: (ms: number) => void (t += ms) };
  }
  const read = (file: string): RuntimeEvent => ({ kind: "progress", text: "r", tool: { kind: "read", file } });
  const edit = (file: string): RuntimeEvent => ({ kind: "progress", text: "e", tool: { kind: "edit", file } });

  it("announces the step with zero counts", () => {
    const { tracker, sent } = setup();
    tracker.start();
    expect(sent).toEqual([{ step: "develop", title: "Fix isOverdue", model: "m1", filesRead: 0, filesEdited: 0, startedAt: 10_000 }]);
  });

  it("counts unique files read and edited, and keeps the latest context use", () => {
    const { tracker, advance } = setup(0);
    tracker.start();
    for (const ev of [read("a.ts"), read("a.ts"), read("b.ts"), edit("a.ts"), { kind: "context", pct: 4 }, { kind: "context", pct: 9.5 }] as RuntimeEvent[]) {
      advance(1);
      tracker.feed(ev);
    }
    expect(tracker.snapshot()).toMatchObject({ filesRead: 2, filesEdited: 1, contextPct: 9.5 });
  });

  it("emits at most once per throttle window and sends the last values at the end", () => {
    const { tracker, sent, advance } = setup(1000);
    tracker.start();
    advance(100);
    tracker.feed(read("a.ts")); // inside the window: held back
    advance(100);
    tracker.feed(read("b.ts")); // still inside
    expect(sent).toHaveLength(1);
    advance(900);
    tracker.feed(read("c.ts")); // window over: one event with all three
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ filesRead: 3 });
    advance(10);
    tracker.feed(edit("c.ts"));
    expect(sent).toHaveLength(2);
    tracker.finish();
    expect(sent).toHaveLength(3);
    expect(sent[2]).toMatchObject({ filesRead: 3, filesEdited: 1 });
    tracker.finish(); // nothing changed since
    expect(sent).toHaveLength(3);
  });

  it("does not emit for events that change nothing", () => {
    const { tracker, sent, advance } = setup(0);
    tracker.start();
    advance(5);
    tracker.feed({ kind: "output", text: "x" });
    tracker.feed({ kind: "progress", text: "no tool" });
    tracker.feed({ kind: "usage", tokens: 3 });
    expect(sent).toHaveLength(1);
  });

  it("cleans the title like activity lines and falls back to the step name", () => {
    const sent: WorkFields[] = [];
    const t = new WorkTracker({ step: "review", title: "Check C:\\Users\\me\\secret.txt now", emit: (w) => sent.push(w) });
    t.start();
    expect(sent[0]?.title).toBe("Check now");
    const u = new WorkTracker({ step: "review", title: "C:\\Users\\me", emit: (w) => sent.push(w) });
    u.start();
    expect(sent[1]?.title).toBe("review");
  });

  it("survives an emit that throws", () => {
    const t = new WorkTracker({
      step: "test",
      title: "x",
      emit: () => {
        throw new Error("disk full");
      },
    });
    expect(() => t.start()).not.toThrow();
  });
});

describe("runRole and agent.work", () => {
  const LIMITS: LimitsConfig = { timeoutsMs: { analyze: 1, develop: 1, test: 1, review: 1 }, maxDiffLines: 1, maxFilesChanged: 1 };
  const scripted = (events: RuntimeEvent[]): AgentRuntime => ({
    id: "scripted",
    async *run() {
      for (const e of events) yield e;
    },
  });
  const ctx = { taskId: "task-1", repoId: "haunted-todo", goal: "g", signal: new AbortController().signal, timeoutMs: 1000, stepIndex: 1 };

  it("emits the start, the changes and the final counts, from tool events and context events", async () => {
    const store = newStore();
    const rt = scripted([
      { kind: "context", pct: 3 },
      { kind: "progress", text: "Read File: src/a.ts", tool: { kind: "read", file: "src/a.ts" } },
      { kind: "progress", text: "Read File: src/b.ts", tool: { kind: "read", file: "src/b.ts" } },
      { kind: "progress", text: "Replace in File: src/a.ts", tool: { kind: "edit", file: "src/a.ts" } },
      { kind: "context", pct: 7.5 },
      { kind: "output", text: "done" },
    ]);
    const deps: PipelineDeps = {
      runtimes: { architect: rt, developer: rt, qa: rt },
      store,
      paths: dataPaths(path.join(os.tmpdir(), "agentlife-work-data")),
      repos: [],
      limits: LIMITS,
      models: { developer: "claude-test" },
    };
    await runRole(deps, "developer", "develop", { ...ctx, title: "Fix isOverdue" }, "prompt", os.tmpdir());
    const work = workOf(store.eventsFor("task-1"));
    expect(work.length).toBeGreaterThanOrEqual(2); // start + final (the middle ones are throttled)
    expect(work[0]).toMatchObject({ agentId: "developer", step: "develop", title: "Fix isOverdue", model: "claude-test", filesRead: 0, filesEdited: 0 });
    expect(work.at(-1)).toMatchObject({ filesRead: 2, filesEdited: 1, contextPct: 7.5 });
    // The step record in the job view is not there (no job events), but every event parses.
    for (const w of work) expect(() => AgentEventSchema.parse(w)).not.toThrow();
  });

  it("uses 'Analysing <repo>' for the analyse step when no title is given and sends final values on error", async () => {
    const store = newStore();
    const rt: AgentRuntime = {
      id: "boom",
      async *run() {
        yield { kind: "progress", text: "Read File: a", tool: { kind: "read", file: "a" } } satisfies RuntimeEvent;
        throw new Error("crashed");
      },
    };
    const deps: PipelineDeps = {
      runtimes: { architect: rt, developer: rt, qa: rt },
      store,
      paths: dataPaths(path.join(os.tmpdir(), "agentlife-work-data")),
      repos: [],
      limits: LIMITS,
    };
    await expect(runRole(deps, "architect", "analyze", ctx, "p", os.tmpdir())).rejects.toThrow("crashed");
    const work = workOf(store.eventsFor("task-1"));
    expect(work[0]).toMatchObject({ title: "Analysing haunted-todo" });
    expect(work[0]?.model).toBeUndefined();
    expect(work.at(-1)).toMatchObject({ filesRead: 1 });
  });

  it("ignores a step name that is not a job step", async () => {
    const store = newStore();
    const rt = scripted([{ kind: "output", text: "x" }]);
    const deps: PipelineDeps = {
      runtimes: { architect: rt, developer: rt, qa: rt },
      store,
      paths: dataPaths(path.join(os.tmpdir(), "agentlife-work-data")),
      repos: [],
      limits: LIMITS,
    };
    await runRole(deps, "qa", "other", ctx, "p", os.tmpdir());
    expect(workOf(store.eventsFor("task-1"))).toEqual([]);
  });
});

describe("FakeRuntime", () => {
  it("reports deterministic tool use and context per role", async () => {
    for (const role of ["architect", "developer", "qa"] as const) {
      const evs: RuntimeEvent[] = [];
      for await (const ev of new FakeRuntime().run({ role, prompt: "", cwd: ".", timeoutMs: 1000, signal: new AbortController().signal })) evs.push(ev);
      const tools = evs.flatMap((e) => (e.kind === "progress" && e.tool ? [e.tool] : []));
      const w = FAKE_WORK[role];
      expect(tools.filter((t) => t.kind === "read").map((t) => t.file)).toEqual([...w.reads]);
      expect(tools.filter((t) => t.kind === "edit").map((t) => t.file)).toEqual([...w.edits]);
      expect(evs.flatMap((e) => (e.kind === "context" ? [e.pct] : [])).at(-1)).toBe(w.contextPct);
    }
  });
});

describe("a whole job with the fake runtime", () => {
  const LIMITS: LimitsConfig = { timeoutsMs: { analyze: 5000, develop: 5000, test: 5000, review: 5000 }, maxDiffLines: 400, maxFilesChanged: 10 };

  it("records model, context peak and file counts on the step records", async () => {
    const store = newStore();
    const fake = new FakeRuntime();
    const steps = createRuntimeSteps({
      runtimes: { architect: fake, developer: fake, qa: fake },
      store,
      models: { architect: "fake", developer: "fake", qa: "fake" },
    });
    const runner = new JobRunner({ store, steps, limits: LIMITS });
    store.bus.on("event", (ev: AgentEvent) => {
      if (ev.type === "approval.requested") queueMicrotask(() => runner.resolveApproval(ev.approvalId, "approve"));
    });
    const id = runner.start("haunted-todo", "g");
    await runner.done(id);
    const job = store.getJob(id)!;
    const byStep = Object.fromEntries(job.steps.map((s) => [s.step, s]));
    expect(byStep["analyze"]).toMatchObject({ model: "fake", contextPeak: FAKE_WORK.architect.contextPct, filesRead: 2, filesEdited: 0 });
    expect(byStep["develop"]).toMatchObject({ model: "fake", contextPeak: FAKE_WORK.developer.contextPct, filesRead: 1, filesEdited: 1 });
    expect(byStep["review"]).toMatchObject({ model: "fake", contextPeak: FAKE_WORK.qa.contextPct, filesRead: 1, filesEdited: 0 });
    // test and report have no model call: announced by the runner, no model, zero counts.
    expect(byStep["test"]).toMatchObject({ filesRead: 0, filesEdited: 0 });
    expect(byStep["test"]?.model).toBeUndefined();
    expect(byStep["report"]).toMatchObject({ filesRead: 0, filesEdited: 0 });
    // The plan task title is the work title from develop on.
    const titles = workOf(store.eventsFor(id)).map((w) => `${w.step}:${w.title}`);
    expect(titles).toContain("analyze:Analysing haunted-todo");
    expect(titles).toContain("develop:Add the requested change");
    // The export names the Developer's branch once a develop step ran, and carries the new numbers.
    const exported = buildExport(store, id);
    expect(exported.job.branch).toBe(`agentlife/${id}`);
    expect(exported.job.steps.find((s) => s.step === "develop")).toMatchObject({ filesEdited: 1 });
    expect(RunExportSchema.safeParse(JSON.parse(JSON.stringify(exported))).success).toBe(true);
  });

  it("names no branch for a job that never reached develop", async () => {
    const store = newStore();
    const fake = new FakeRuntime();
    const steps = createRuntimeSteps({ runtimes: { architect: fake, developer: fake, qa: fake }, store });
    const runner = new JobRunner({ store, steps, limits: LIMITS });
    store.bus.on("event", (ev: AgentEvent) => {
      if (ev.type === "approval.requested") queueMicrotask(() => runner.resolveApproval(ev.approvalId, "reject"));
    });
    const id = runner.start("haunted-todo", "g");
    await runner.done(id);
    expect(buildExport(store, id).job.branch).toBeUndefined();
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PIPELINE,
  PipelineResponseSchema,
  TeamMemberSchema,
  validatePipeline,
  type AgentEvent,
  type JobState,
  type Pipeline,
  type PipelineStep,
  type PipelineStepKind,
  type Plan,
  type Review,
} from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";
import type { LimitsConfig } from "../src/config.ts";
import { JobRunner } from "../src/jobs/runner.ts";
import { PIPELINES } from "../src/jobs/kinds.ts";
import { memberOfStep, stateFlowOf, transitionsOfPipeline } from "../src/jobs/pipeline.ts";
import type { Steps, StepContext } from "../src/jobs/steps.ts";
import { TRANSITIONS } from "../src/jobs/transitions.ts";
import { PipelineStore } from "../src/pipeline/store.ts";
import { ModelDirectory, loadTeamRules } from "../src/team/models.ts";
import { Store } from "../src/store.ts";

// ---- the generated state machine ----

const TEAM = [
  { id: "architect", role: "architect" as const, model: "m-a" },
  { id: "developer", role: "developer" as const, model: "m-d" },
  { id: "qa", role: "qa" as const, model: "m-q" },
  { id: "reviewer-1", role: "reviewer" as const, model: "m-r" },
  { id: "researcher-1", role: "researcher" as const, model: "m-s" },
];

/** A valid pipeline with random optional steps and the two reviews in either order. */
const validPipelineArb = fc
  .record({ research: fc.boolean(), second: fc.constantFrom("none", "after", "before"), named: fc.boolean() })
  .map(({ research, second, named }): Pipeline => {
    const kinds: PipelineStepKind[] = ["plan", "approve", "develop", "test"];
    if (research) kinds.unshift("research");
    if (second === "before") kinds.push("second-review", "review");
    else if (second === "after") kinds.push("review", "second-review");
    else kinds.push("review");
    kinds.push("report");
    return kinds.map((kind) => {
      if (!named) return { kind };
      if (kind === "review") return { kind, memberId: "qa" };
      if (kind === "second-review") return { kind, memberId: "reviewer-1" };
      if (kind === "research") return { kind, memberId: "researcher-1" };
      return { kind };
    });
  });

/** States reachable from `created` without ever entering `blocked`. */
function reachableWithout(table: Readonly<Record<JobState, readonly JobState[]>>, blocked: JobState): Set<JobState> {
  const seen = new Set<JobState>(["created"]);
  const queue: JobState[] = ["created"];
  while (queue.length) {
    const s = queue.shift()!;
    for (const n of table[s]) {
      if (n === blocked || seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

describe("the state machine generated from a pipeline", () => {
  it("is exactly today's table for the default pipeline", () => {
    expect(stateFlowOf(DEFAULT_PIPELINE)).toEqual(PIPELINES.change);
    const table = transitionsOfPipeline(DEFAULT_PIPELINE);
    for (const s of Object.keys(TRANSITIONS) as JobState[]) expect([...table[s]].sort()).toEqual([...TRANSITIONS[s]].sort());
  });

  it("runs research and the second review inside the states they belong to", () => {
    const steps: PipelineStep[] = [{ kind: "research" }, { kind: "plan" }, { kind: "approve" }, { kind: "develop" }, { kind: "test" }, { kind: "second-review" }, { kind: "review" }, { kind: "report" }];
    expect(stateFlowOf(steps)).toEqual(PIPELINES.change);
  });

  it("never reaches develop without the approval, nor a review without the tests (property)", () => {
    fc.assert(
      fc.property(validPipelineArb, (steps) => {
        expect(validatePipeline(steps, TEAM).ok).toBe(true);
        const table = transitionsOfPipeline(steps);
        expect(reachableWithout(table, "awaiting_plan_approval").has("developing")).toBe(false);
        expect(reachableWithout(table, "testing").has("reviewing")).toBe(false);
        expect(reachableWithout(table, "analyzing").has("awaiting_plan_approval")).toBe(false);
        // The only way to a report is through the review.
        expect(reachableWithout(table, "reviewing").has("report_ready")).toBe(true); // via failed: a failure still gets a report
        expect(table["delivered"]).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});

// ---- a JobRunner that follows the pipeline ----

const LIMITS: LimitsConfig = { timeoutsMs: { analyze: 500, develop: 500, test: 500, review: 500 }, maxDiffLines: 400, maxFilesChanged: 10 };
const PLAN: Plan = { tasks: [{ id: "t1", title: "Do it", why: "because", files: ["a.js"], acceptance: "ok", risk: "low" }] };
const PASS: Review = { verdict: "pass", notes: [], risk: "low" };
const FAIL: Review = { verdict: "fail", notes: ["second reviewer disagrees"], risk: "medium" };

interface Call {
  step: string;
  memberId?: string | undefined;
  research?: string | undefined;
}

function scripted(calls: Call[], over: Partial<Steps> = {}): Steps {
  const log = (step: string, ctx: StepContext): void => void calls.push({ step, memberId: ctx.memberId, research: ctx.research });
  return {
    research: async (ctx) => (log("research", ctx), "the code lives in a.js"),
    analyze: async (ctx) => (log("analyze", ctx), PLAN),
    develop: async (ctx) => (log("develop", ctx), { diff: "diff" }),
    test: async (ctx) => (log("test", ctx), { passed: true, log: "ok" }),
    review: async (ctx) => (log("review", ctx), PASS),
    secondReview: async (ctx) => (log("second-review", ctx), PASS),
    report: async (ctx) => (log("report", ctx), { title: "Report", markdown: "# Report" }),
    ...over,
  };
}

const STEP_CALL: Record<PipelineStepKind, string> = {
  research: "research",
  plan: "analyze",
  approve: "",
  develop: "develop",
  test: "test",
  review: "review",
  "second-review": "second-review",
  report: "report",
};

function runnerFor(steps: Steps, pipeline: readonly PipelineStep[] | (() => readonly PipelineStep[])) {
  const store = new Store({ dbPath: ":memory:", runsDir: mkdtempSync(path.join(os.tmpdir(), "agentlife-pipeline-")) });
  const runner = new JobRunner({
    store,
    steps,
    limits: LIMITS,
    reportTimeoutMs: 500,
    pipelines: { forJob: () => (typeof pipeline === "function" ? pipeline() : pipeline) },
  });
  store.bus.on("event", (ev: AgentEvent) => {
    if (ev.type === "approval.requested") queueMicrotask(() => runner.resolveApproval(ev.approvalId, "approve"));
  });
  return { store, runner };
}

const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

function eventNames(store: Store, id: string): string[] {
  return store.eventsFor(id).flatMap((e) => (e.type === "task.state_changed" ? [e.state] : e.type === "approval.resolved" ? ["approval.resolved"] : []));
}

describe("JobRunner follows the pipeline", () => {
  it("runs the steps of any valid pipeline in its order, and never develops before the approval (property)", async () => {
    await fc.assert(
      fc.asyncProperty(validPipelineArb, async (pipeline) => {
        const calls: Call[] = [];
        const { store, runner } = runnerFor(scripted(calls), pipeline);
        stores.push(store);
        const id = runner.start("haunted-todo", "goal");
        await runner.done(id);
        expect(store.getJob(id)!.state).toBe("delivered");
        expect(calls.map((c) => c.step)).toEqual(pipeline.map((s) => STEP_CALL[s.kind]).filter(Boolean));
        const names = eventNames(store, id);
        expect(names.indexOf("approval.resolved")).toBeLessThan(names.indexOf("developing"));
        expect(names.indexOf("testing")).toBeLessThan(names.indexOf("reviewing"));
        // Whatever the pipeline, the states are the same, so every client keeps working.
        expect(names.filter((n) => n !== "approval.resolved")).toEqual(["analyzing", "awaiting_plan_approval", "developing", "testing", "reviewing", "report_ready", "delivered"]);
      }),
      { numRuns: 40 },
    );
  });

  it("gives each step the member the pipeline names", async () => {
    const calls: Call[] = [];
    const pipeline: PipelineStep[] = [
      { kind: "research", memberId: "researcher-1" },
      { kind: "plan", memberId: "architect" },
      { kind: "approve" },
      { kind: "develop", memberId: "developer" },
      { kind: "test" },
      { kind: "review", memberId: "qa" },
      { kind: "second-review", memberId: "reviewer-1" },
      { kind: "report" },
    ];
    const { store, runner } = runnerFor(scripted(calls), pipeline);
    stores.push(store);
    const id = runner.start("haunted-todo", "goal");
    await runner.done(id);
    expect(calls.map((c) => [c.step, c.memberId])).toEqual([
      ["research", "researcher-1"],
      ["analyze", "architect"],
      ["develop", "developer"],
      ["test", undefined],
      ["review", "qa"],
      ["second-review", "reviewer-1"],
      ["report", undefined],
    ]);
    expect(memberOfStep(pipeline, "second-review")).toBe("reviewer-1");
  });

  it("keeps the pipeline it started with when the project's pipeline changes", async () => {
    const calls: Call[] = [];
    let current: readonly PipelineStep[] = DEFAULT_PIPELINE;
    const { store, runner } = runnerFor(
      scripted(calls, {
        develop: async () => {
          current = [{ kind: "research" }, ...DEFAULT_PIPELINE]; // saved while the job runs
          return { diff: "d" };
        },
      }),
      () => current,
    );
    stores.push(store);
    const first = runner.start("haunted-todo", "goal");
    await runner.done(first);
    expect(calls.map((c) => c.step)).not.toContain("research");
    calls.length = 0;
    const second = runner.start("haunted-todo", "goal");
    await runner.done(second);
    expect(calls.map((c) => c.step)).toContain("research");
  });

  it("refuses a job when the pipeline cannot be taken, before anything is recorded", () => {
    const { store, runner } = runnerFor(scripted([]), () => {
      throw new Error("no pipeline");
    });
    stores.push(store);
    expect(() => runner.start("haunted-todo", "goal")).toThrow("no pipeline");
    expect(store.listJobs()).toEqual([]);
  });

  it("refuses a pipeline whose optional step the engine cannot run", () => {
    const steps = scripted([]);
    delete steps.secondReview;
    const { store, runner } = runnerFor(steps, [...DEFAULT_PIPELINE.slice(0, 5), { kind: "second-review" }, { kind: "report" }]);
    stores.push(store);
    expect(() => runner.start("haunted-todo", "goal")).toThrow(/second-review step/);
  });

  it("runs the research before the plan and hands the notes to it", async () => {
    const calls: Call[] = [];
    const { store, runner } = runnerFor(scripted(calls), [{ kind: "research" }, ...DEFAULT_PIPELINE]);
    stores.push(store);
    const id = runner.start("haunted-todo", "goal");
    await runner.done(id);
    expect(calls.find((c) => c.step === "analyze")?.research).toBe("the code lives in a.js");
    expect(calls.find((c) => c.step === "research")?.research).toBeUndefined();
    const job = store.getJob(id)!;
    expect(job.artifacts.map((a) => a.kind)).toEqual(["research", "plan", "diff", "test_log", "review", "report"]);
  });

  it("fails the job when either review fails, and gives the developer both sets of notes", async () => {
    const calls: Call[] = [];
    const feedback: string[][] = [];
    const { store, runner } = runnerFor(
      scripted(calls, {
        secondReview: async (ctx) => (calls.push({ step: "second-review", memberId: ctx.memberId }), FAIL),
        develop: async (ctx, input) => (calls.push({ step: "develop", memberId: ctx.memberId }), feedback.push(input.feedback), { diff: "d" }),
      }),
      [...DEFAULT_PIPELINE.slice(0, 5), { kind: "second-review" }, { kind: "report" }],
    );
    stores.push(store);
    const id = runner.start("haunted-todo", "goal");
    await runner.done(id);
    const job = store.getJob(id)!;
    expect(job.verdict).toBe("fail");
    // One retry after a fail, then the report.
    expect(calls.filter((c) => c.step === "develop")).toHaveLength(2);
    expect(feedback[1]).toEqual(["second reviewer disagrees"]);
    expect(calls.filter((c) => c.step === "second-review")).toHaveLength(2);
  });

  it("passes only when both reviews pass", async () => {
    const calls: Call[] = [];
    const { store, runner } = runnerFor(scripted(calls), [...DEFAULT_PIPELINE.slice(0, 5), { kind: "second-review" }, { kind: "report" }]);
    stores.push(store);
    const id = runner.start("haunted-todo", "goal");
    await runner.done(id);
    expect(store.getJob(id)!.verdict).toBe("pass");
  });
});

// ---- the project's pipeline over HTTP ----

let tmp: string;
let engine: Engine | undefined;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "al-pipeline-http-"));
});
afterEach(async () => {
  await engine?.close();
  engine = undefined;
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function boot(): Promise<string> {
  engine = await startEngine({
    storeOptions: { dbPath: ":memory:", runsDir: path.join(tmp, "runs") },
    dataDir: tmp,
    port: 0,
    team: {
      file: path.join(tmp, "teams.json"),
      models: new ModelDirectory({ rules: loadTeamRules(), list: async () => ["auto", "claude-haiku-5.5", "claude-sonnet-5.5"] }),
    },
    pipelines: { file: path.join(tmp, "pipelines.json") },
  });
  return `http://127.0.0.1:${engine.port}`;
}

const send = (url: string, method: string, body?: unknown) =>
  fetch(url, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const FULL: PipelineStep[] = [
  { kind: "research" },
  { kind: "plan" },
  { kind: "approve" },
  { kind: "develop" },
  { kind: "test" },
  { kind: "review" },
  { kind: "second-review" },
  { kind: "report" },
];

describe("pipeline routes", () => {
  it("shows the default pipeline with the team the rules check it against", async () => {
    const url = await boot();
    const view = PipelineResponseSchema.parse(await (await fetch(`${url}/projects/haunted-todo/pipeline`)).json());
    expect(view).toMatchObject({ projectId: "haunted-todo", customised: false, steps: DEFAULT_PIPELINE });
    expect(view.members.map((m) => m.role)).toEqual(["architect", "developer", "qa"]);
    expect((await fetch(`${url}/projects/nope/pipeline`)).status).toBe(404);
  });

  it("saves a valid pipeline, writes it to the file, and goes back to the default", async () => {
    const url = await boot();
    const team = `${url}/projects/haunted-todo/team`;
    const rex = TeamMemberSchema.parse(await (await send(team, "POST", { templateId: "reviewer", displayName: "Rex", model: "claude-sonnet-5.5" })).json());
    const rae = TeamMemberSchema.parse(await (await send(team, "POST", { templateId: "researcher", displayName: "Rae" })).json());
    const steps = FULL.map((s) => (s.kind === "second-review" ? { ...s, memberId: rex.id } : s.kind === "research" ? { ...s, memberId: rae.id } : s));
    const saved = await send(`${url}/projects/haunted-todo/pipeline`, "PUT", { steps });
    expect(saved.status).toBe(200);
    expect(PipelineResponseSchema.parse(await saved.json())).toMatchObject({ customised: true, steps });
    expect(JSON.parse(readFileSync(path.join(tmp, "pipelines.json"), "utf8"))).toEqual({ "haunted-todo": steps });
    expect(engine!.pipelines.forJob("haunted-todo")).toEqual(steps);

    const reset = await send(`${url}/projects/haunted-todo/pipeline`, "DELETE");
    expect(PipelineResponseSchema.parse(await reset.json())).toMatchObject({ customised: false, steps: DEFAULT_PIPELINE });
    expect(JSON.parse(readFileSync(path.join(tmp, "pipelines.json"), "utf8"))).toEqual({});
  });

  it("refuses a pipeline that breaks a rule and says which step and which rule", async () => {
    const url = await boot();
    const bad = await send(`${url}/projects/haunted-todo/pipeline`, "PUT", {
      steps: [{ kind: "plan" }, { kind: "develop" }, { kind: "approve" }, { kind: "test" }, { kind: "review" }, { kind: "report" }],
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: "invalid_pipeline",
      message: "Approval must come before Develop: nothing is built without your approval.",
      issues: [{ path: "steps.2", message: "Approval must come before Develop: nothing is built without your approval." }],
    });
    expect(PipelineResponseSchema.parse(await (await fetch(`${url}/projects/haunted-todo/pipeline`)).json()).customised).toBe(false);
    // A research step needs a researcher on the team.
    const noResearcher = await send(`${url}/projects/haunted-todo/pipeline`, "PUT", { steps: FULL.filter((s) => s.kind !== "second-review") });
    expect(noResearcher.status).toBe(400);
    expect((await noResearcher.json()).message).toMatch(/Research needs a researcher/);
    // The shape is checked too: unknown kinds and extra fields.
    expect((await send(`${url}/projects/haunted-todo/pipeline`, "PUT", { steps: [{ kind: "deploy" }] })).status).toBe(400);
    expect((await send(`${url}/projects/haunted-todo/pipeline`, "PUT", { steps: DEFAULT_PIPELINE, tools: ["shell"] })).status).toBe(400);
  });

  it("refuses to start a job whose saved pipeline no longer fits the team, and starts it again once fixed", async () => {
    const url = await boot();
    const team = `${url}/projects/haunted-todo/team`;
    const rex = TeamMemberSchema.parse(await (await send(team, "POST", { templateId: "reviewer", displayName: "Rex", model: "claude-sonnet-5.5" })).json());
    const steps: PipelineStep[] = [...DEFAULT_PIPELINE.slice(0, 5), { kind: "second-review" }, { kind: "report" }];
    expect((await send(`${url}/projects/haunted-todo/pipeline`, "PUT", { steps })).status).toBe(200);
    // Rex leaves: the saved pipeline needs a reviewer.
    expect((await send(`${team}/${rex.id}`, "DELETE")).status).toBe(200);
    const refused = await send(`${url}/tasks`, "POST", { repoId: "haunted-todo", goal: "do it" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "pipeline_invalid" });
    expect(engine!.store.listJobs()).toEqual([]);
    // Back to the default pipeline: the job starts.
    await send(`${url}/projects/haunted-todo/pipeline`, "DELETE");
    const ok = await send(`${url}/tasks`, "POST", { repoId: "haunted-todo", goal: "do it" });
    expect(ok.status).toBe(201);
  });

  it("runs a job through research and a second review with the fake runtime", async () => {
    const url = await boot();
    const team = `${url}/projects/haunted-todo/team`;
    const rex = TeamMemberSchema.parse(await (await send(team, "POST", { templateId: "reviewer", displayName: "Rex", model: "claude-sonnet-5.5" })).json());
    const rae = TeamMemberSchema.parse(await (await send(team, "POST", { templateId: "researcher", displayName: "Rae" })).json());
    const steps = FULL.map((s) => (s.kind === "second-review" ? { ...s, memberId: rex.id } : s.kind === "research" ? { ...s, memberId: rae.id } : s));
    await send(`${url}/projects/haunted-todo/pipeline`, "PUT", { steps });
    engine!.store.bus.on("event", (ev: AgentEvent) => {
      if (ev.type === "approval.requested") queueMicrotask(() => engine!.runner.resolveApproval(ev.approvalId, "approve"));
    });
    const started = (await (await send(`${url}/tasks`, "POST", { repoId: "haunted-todo", goal: "do it" })).json()) as { taskId: string };
    const id = started.taskId;
    await engine!.runner.done(id);
    const job = engine!.store.getJob(id)!;
    expect(job.state).toBe("delivered");
    expect(job.verdict).toBe("pass");
    expect(job.artifacts.map((a) => a.kind)).toEqual(["research", "plan", "diff", "test_log", "review", "review", "report"]);
    const report = engine!.store.eventsFor(id).find((e) => e.type === "report.ready");
    expect(report && "markdown" in report ? report.markdown : "").toContain("## Second review");
    expect(report && "markdown" in report ? report.markdown : "").toContain("## Research");
  });
});

describe("PipelineStore", () => {
  it("moves an unreadable file aside and starts empty", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "al-pipeline-store-"));
    try {
      const file = path.join(dir, "pipelines.json");
      writeFileSync(file, "{ not json");
      const store = new PipelineStore({ file, now: () => 7 });
      expect(store.get("p")).toBeUndefined();
      store.set("p", DEFAULT_PIPELINE);
      expect(new PipelineStore({ file }).get("p")).toEqual(DEFAULT_PIPELINE);
      expect(readFileSync(`${file}.bad-7`, "utf8")).toBe("{ not json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

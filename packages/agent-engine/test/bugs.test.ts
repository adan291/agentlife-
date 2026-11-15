import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent, Plan, Review } from "@agentlife/shared";
import { classifyStepError, describeError } from "../src/bugs.ts";
import type { BugSink } from "../src/bugs.ts";
import type { LimitsConfig } from "../src/config.ts";
import { startEngine } from "../src/engine.ts";
import type { Engine } from "../src/engine.ts";
import { DiffRejectedError, JobCancelledError, StepTimeoutError } from "../src/errors.ts";
import { JobRunner } from "../src/jobs/runner.ts";
import type { Steps } from "../src/jobs/steps.ts";
import { KiroCliError } from "../src/runtimes/kiro-cli.ts";
import { RunnerImageBuildError } from "../src/steps/runner-image.ts";
import { DockerUnavailableError } from "../src/steps/test.ts";
import { Store } from "../src/store.ts";

const tmpDirs: string[] = [];
const stores: Store[] = [];
const engines: Engine[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentlife-bugs-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const e of engines.splice(0)) await e.close();
  for (const s of stores.splice(0)) s.close();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const LIMITS: LimitsConfig = {
  timeoutsMs: { analyze: 40, develop: 40, test: 40, review: 40 },
  maxDiffLines: 400,
  maxFilesChanged: 10,
};
const PLAN: Plan = { tasks: [{ id: "t1", title: "Do it", why: "because", files: ["a.js"], acceptance: "ok", risk: "low" }] };
const pass: Review = { verdict: "pass", notes: [], risk: "low" };
const fail: Review = { verdict: "fail", notes: ["needs work"], risk: "medium" };

function okSteps(over: Partial<Steps> = {}): Steps {
  return {
    analyze: async () => PLAN,
    develop: async () => ({ diff: "diff" }),
    test: async () => ({ passed: true, log: "ok" }),
    review: async () => pass,
    report: async () => ({ title: "Report", markdown: "# Report" }),
    ...over,
  };
}

type Reported = Parameters<BugSink>[0];

function setup(steps: Steps, onBug: BugSink | undefined) {
  const store = new Store({ dbPath: ":memory:", runsDir: tmp() });
  stores.push(store);
  const runner = new JobRunner({ store, steps, limits: LIMITS, reportTimeoutMs: 40, ...(onBug ? { onBug } : {}) });
  store.bus.on("event", (ev: AgentEvent) => {
    if (ev.type === "approval.requested") queueMicrotask(() => runner.resolveApproval(ev.approvalId, "approve"));
  });
  return { store, runner };
}

async function run(steps: Steps, onBug?: BugSink) {
  const { store, runner } = setup(steps, onBug);
  const id = runner.start("haunted-todo", "fix it");
  await runner.done(id);
  return { store, id, state: store.getJob(id)!.state, failed: store.eventsFor(id).some((e) => e.type === "task.failed") };
}

describe("classifyStepError", () => {
  it("names the kind of every error class the pipeline throws", () => {
    expect(classifyStepError(new KiroCliError("kiro-cli failed (1)", { exitCode: 1 }))).toBe("kiro-cli");
    expect(classifyStepError(new DockerUnavailableError("daemon is off"))).toBe("docker");
    expect(classifyStepError(new RunnerImageBuildError("npm ci failed"))).toBe("docker");
    expect(classifyStepError(new StepTimeoutError("develop"))).toBe("step-timeout");
    expect(classifyStepError(new Error("anything else"))).toBe("step-error");
    expect(classifyStepError(new TypeError("x is undefined"))).toBe("step-error");
    expect(classifyStepError("a string was thrown")).toBe("step-error");
  });

  it("is not a bug when the user cancelled or the Developer's change was refused", () => {
    expect(classifyStepError(new JobCancelledError())).toBeUndefined();
    expect(classifyStepError(new DiffRejectedError("too big", "diff"))).toBeUndefined();
  });
});

describe("describeError", () => {
  it("gives the name, the message and the stack of an Error, and a text for anything else", () => {
    const e = new RangeError("out of range");
    expect(describeError(e)).toMatchObject({ message: "RangeError: out of range", stack: expect.stringContaining("out of range") });
    expect(describeError("plain")).toEqual({ message: "plain" });
    expect(describeError(undefined)).toEqual({ message: "Non-error thrown" });
  });
});

describe("JobRunner and the Bug sack", () => {
  it("records an internal step error with the task and the step, and the job still fails as before", async () => {
    const seen: Reported[] = [];
    const { id, failed, store } = await run(okSteps({ develop: async () => { throw new TypeError("cannot read x"); } }), (b) => seen.push(b));
    expect(failed).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "step-error", message: "TypeError: cannot read x", context: { task: id, step: "develop" } });
    expect(seen[0]?.stack).toContain("cannot read x");
    expect(store.eventsFor(id).some((e) => e.type === "task.failed")).toBe(true);
  });

  it("names a kiro-cli failure, a Docker failure and a timeout", async () => {
    const seen: Reported[] = [];
    const sink: BugSink = (b) => seen.push(b);
    await run(okSteps({ analyze: async () => { throw new KiroCliError("kiro-cli failed (2)", { exitCode: 2 }); } }), sink);
    await run(okSteps({ test: async () => { throw new DockerUnavailableError("daemon is off"); } }), sink);
    await run(okSteps({ develop: () => new Promise(() => undefined) }), sink);
    expect(seen.map((b) => [b.kind, b.context?.step])).toEqual([["kiro-cli", "analyze"], ["docker", "test"], ["step-timeout", "develop"]]);
  });

  it("does not record a QA FAIL verdict, failing tests, a cancel or a refused diff", async () => {
    const seen: Reported[] = [];
    const sink: BugSink = (b) => seen.push(b);
    const qaFail = await run(okSteps({ review: async () => fail }), sink);
    expect([qaFail.failed, qaFail.store.getJob(qaFail.id)!.verdict]).toEqual([false, "fail"]);
    expect((await run(okSteps({ test: async () => ({ passed: false, log: "1 failed", exitCode: 1 }) }), sink)).failed).toBe(false);
    expect((await run(okSteps({ develop: async () => { throw new DiffRejectedError("touches .git", "diff"); } }), sink)).failed).toBe(true);
    const { store, runner } = setup(okSteps(), sink);
    store.bus.removeAllListeners("event");
    const id = runner.start("haunted-todo", "cancel me");
    await runner.cancel(id);
    expect(store.getJob(id)!.state).toBe("cancelled");
    expect(seen).toEqual([]);
  });

  it("is not changed by a sink that throws", async () => {
    const { failed } = await run(okSteps({ develop: async () => { throw new Error("boom"); } }), () => {
      throw new Error("the Bug sack is broken");
    });
    expect(failed).toBe(true);
  });

  it("works without a sink", async () => {
    expect((await run(okSteps({ develop: async () => { throw new Error("boom"); } }))).failed).toBe(true);
  });
});

describe("the engine's HTTP server and the Bug sack", () => {
  it("records a request that ends in a 500 and still answers it", async () => {
    const seen: Reported[] = [];
    const dir = tmp();
    const engine = await startEngine({
      storeOptions: { dbPath: ":memory:", runsDir: dir },
      port: 0,
      onBug: (b) => seen.push(b),
      extraRoutes: [
        {
          method: "GET",
          pattern: /^\/boom$/,
          handle: () => {
            throw new Error("handler broke");
          },
        },
      ],
    });
    engines.push(engine);
    const res = await fetch(`http://127.0.0.1:${engine.port}/boom`);
    expect(res.status).toBe(500);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "http-500", message: "Error: handler broke" });
    // Requests that are the caller's fault are not bugs.
    expect((await fetch(`http://127.0.0.1:${engine.port}/nothing-here`)).status).toBe(404);
    expect(seen).toHaveLength(1);
  });

  it("passes the sink to the job runner", async () => {
    const seen: Reported[] = [];
    const dir = tmp();
    const engine = await startEngine({
      storeOptions: { dbPath: ":memory:", runsDir: dir },
      port: 0,
      steps: okSteps({ analyze: async () => { throw new Error("analysis broke"); } }),
      onBug: (b) => seen.push(b),
    });
    engines.push(engine);
    const id = engine.runner.start("haunted-todo", "g");
    await engine.runner.done(id);
    expect(seen.map((b) => b.kind)).toEqual(["step-error"]);
  });
});

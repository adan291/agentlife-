import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { AgentEventSchema, type AgentEvent, type Plan, type Review } from "@agentlife/shared";
import { ACTIVITY_THROTTLE_MS, createActivityEmitter, testResultLine } from "../src/activity.ts";
import type { LimitsConfig } from "../src/config.ts";
import { JobRunner } from "../src/jobs/runner.ts";
import type { Steps } from "../src/jobs/steps.ts";
import { dataPaths } from "../src/paths.ts";
import type { AgentRuntime, RuntimeEvent } from "../src/runtimes/types.ts";
import { runRole, type PipelineDeps } from "../src/steps/deps.ts";
import { Store, type NewEvent } from "../src/store.ts";

const FORBIDDEN = /[A-Za-z]:[\\/]|ksk_/;

function harness(throttleMs?: number) {
  let t = 1000;
  const out: NewEvent[] = [];
  const emitter = createActivityEmitter({ append: (e) => out.push(e), now: () => t, ...(throttleMs === undefined ? {} : { throttleMs }) });
  const texts = () => out.flatMap((e) => (e.type === "agent.activity" ? [`${e.agentId}:${e.text}`] : []));
  return { emitter, out, texts, advance: (ms: number) => (t += ms) };
}

describe("createActivityEmitter", () => {
  it("maps progress to agent.activity events for the agent", () => {
    const { emitter, out } = harness();
    emitter.progress("task-1", "developer", "Reading: src/todo.ts");
    expect(out).toEqual([{ type: "agent.activity", taskId: "task-1", agentId: "developer", text: "Reading: src/todo.ts" }]);
    expect(AgentEventSchema.safeParse({ ...out[0], seq: 1, ts: 1 }).success).toBe(true);
  });

  it("lets at most one progress event per agent through per second", () => {
    const { emitter, texts, advance } = harness();
    emitter.progress("t", "qa", "one");
    advance(300);
    emitter.progress("t", "qa", "two");
    emitter.progress("t", "architect", "other agent is independent");
    advance(300);
    emitter.progress("t", "qa", "three");
    advance(ACTIVITY_THROTTLE_MS);
    emitter.progress("t", "qa", "four");
    expect(texts()).toEqual(["qa:one", "architect:other agent is independent", "qa:four"]);
  });

  it("does not throttle milestone lines and does not let them reset the progress window", () => {
    const { emitter, texts } = harness();
    emitter.line("t", "architect", "Plan ready: 3 tasks");
    emitter.line("t", "architect", "Approved task 1");
    emitter.progress("t", "architect", "reading");
    expect(texts()).toEqual(["architect:Plan ready: 3 tasks", "architect:Approved task 1", "architect:reading"]);
  });

  it("emits nothing when the sanitised text is empty", () => {
    const { emitter, out } = harness();
    emitter.progress("t", "qa", "C:\\Users\\me\\x.txt");
    emitter.line("t", "qa", "   ");
    expect(out).toEqual([]);
  });

  it("removes paths, ksk_ keys and NAME=value, and caps at 80 chars (property)", () => {
    const alphabet = fc.constantFrom("a", "k", "s", "_", "C", ":", "\\", "/", " ", "x", "1", ".", "=", "$", "e", "n", "v");
    fc.assert(
      fc.property(fc.array(alphabet, { maxLength: 200 }).map((a) => a.join("")), fc.string({ maxLength: 200 }), (s, free) => {
        const { emitter, out } = harness();
        emitter.line("t", "qa", s);
        emitter.line("t", "qa", free);
        return out.every((e) => {
          if (e.type !== "agent.activity") return false;
          return (
            e.text.length <= 80 &&
            !FORBIDDEN.test(e.text) &&
            !/\b[A-Za-z_]\w*=/.test(e.text) &&
            !/\$env:/i.test(e.text) &&
            AgentEventSchema.safeParse({ ...e, seq: 1, ts: 1 }).success
          );
        });
      }),
      { numRuns: 300 },
    );
  });
});

describe("testResultLine", () => {
  it("reads counts from a Vitest summary", () => {
    expect(testResultLine({ passed: true, log: " Test Files  2 passed (2)\n      Tests  11 passed | 1 skipped (12)\n" })).toBe("Tests passed 11/11");
    expect(testResultLine({ passed: false, log: "      Tests  2 failed | 9 passed (11)\n", exitCode: 1 })).toBe("Tests failed 2/11");
  });

  it("ignores colour codes", () => {
    const log = "\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m8 passed\u001b[39m\u001b[22m\u001b[90m (8)\u001b[39m\n";
    expect(testResultLine({ passed: true, log })).toBe("Tests passed 8/8");
  });

  it("falls back to the exit code when there is no summary", () => {
    expect(testResultLine({ passed: true, log: "all tests passed (simulated)" })).toBe("Tests passed");
    expect(testResultLine({ passed: false, log: "boom", exitCode: 2 })).toBe("Tests failed (exit 2)");
    expect(testResultLine({ passed: false, log: "" })).toBe("Tests failed");
  });
});

// ---- wiring: runRole and JobRunner ----

const tmpDirs: string[] = [];
const stores: Store[] = [];
function newStore(): Store {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentlife-activity-"));
  tmpDirs.push(dir);
  const s = new Store({ dbPath: ":memory:", runsDir: dir });
  stores.push(s);
  return s;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const activityOf = (events: AgentEvent[]): string[] =>
  events.flatMap((e) => (e.type === "agent.activity" ? [`${e.agentId}:${e.text}`] : []));

describe("runRole", () => {
  it("turns runtime progress into throttled agent.activity events and ignores output and usage", async () => {
    const store = newStore();
    const events: RuntimeEvent[] = [
      { kind: "progress", text: "Reading: src/a.ts" },
      { kind: "progress", text: "Reading: src/b.ts" },
      { kind: "output", text: "secret ksk_abc output" },
      { kind: "usage", credits: 1 },
    ];
    const rt: AgentRuntime = {
      id: "scripted",
      async *run() {
        for (const e of events) yield e;
      },
    };
    const deps: PipelineDeps = {
      runtimes: { architect: rt, developer: rt, qa: rt },
      store,
      paths: dataPaths(path.join(os.tmpdir(), "agentlife-activity-data")),
      repos: [],
      limits: { timeoutsMs: { analyze: 1, develop: 1, test: 1, review: 1 }, maxDiffLines: 1, maxFilesChanged: 1 },
      activity: createActivityEmitter({ append: (e) => store.appendEvent(e) }),
    };
    const ctx = { taskId: "task-1", repoId: "r", goal: "g", signal: new AbortController().signal, timeoutMs: 1000, stepIndex: 1 };
    await runRole(deps, "developer", "develop", ctx, "prompt", os.tmpdir());
    expect(activityOf(store.eventsFor("task-1"))).toEqual(["developer:Reading: src/a.ts"]);
  });
});

const LIMITS: LimitsConfig = { timeoutsMs: { analyze: 100, develop: 100, test: 100, review: 100 }, maxDiffLines: 400, maxFilesChanged: 10 };
const PLAN: Plan = {
  tasks: [
    { id: "t1", title: "One", why: "w", files: ["a.js"], acceptance: "ok", risk: "low" },
    { id: "t2", title: "Two", why: "w", files: ["b.js"], acceptance: "ok", risk: "low" },
  ],
};
const PASS: Review = { verdict: "pass", notes: [], risk: "low" };

describe("JobRunner milestones", () => {
  it("writes milestone lines when an emitter is given, and none without one", async () => {
    const steps: Steps = {
      analyze: async () => PLAN,
      develop: async () => ({ diff: "diff" }),
      test: async () => ({ passed: true, log: "      Tests  11 passed | 1 skipped (12)\n" }),
      review: async () => PASS,
      report: async () => ({ title: "Report", markdown: "# Report" }),
    };
    const run = async (withActivity: boolean): Promise<string[]> => {
      const store = newStore();
      const runner = new JobRunner({
        store,
        steps,
        limits: LIMITS,
        ...(withActivity ? { activity: createActivityEmitter({ append: (e) => store.appendEvent(e) }) } : {}),
      });
      store.bus.on("event", (ev: AgentEvent) => {
        if (ev.type === "approval.requested") queueMicrotask(() => runner.resolveApproval(ev.approvalId, "approve"));
      });
      const id = runner.start("haunted-todo", "g");
      await runner.done(id);
      return activityOf(store.eventsFor(id));
    };
    expect(await run(true)).toEqual([
      "architect:Analysing the repo",
      "architect:Plan ready: 2 tasks",
      "architect:Approved task 1",
      "developer:Editing files",
      "developer:Patch ready",
      "qa:Running tests",
      "qa:Tests passed 11/11",
      "qa:Reviewing the patch",
      "qa:Review: pass (risk low)",
      "architect:Report ready",
    ]);
    expect(await run(false)).toEqual([]);
  });

  it("writes a failure line that does not leak paths", async () => {
    const store = newStore();
    const steps: Steps = {
      analyze: async () => {
        throw new Error("cannot read C:\\Users\\me\\repo\\secret.txt");
      },
      develop: async () => ({ diff: "" }),
      test: async () => ({ passed: true, log: "" }),
      review: async () => PASS,
      report: async () => ({ title: "R", markdown: "# R" }),
    };
    const runner = new JobRunner({ store, steps, limits: LIMITS, activity: createActivityEmitter({ append: (e) => store.appendEvent(e) }) });
    const id = runner.start("haunted-todo", "g");
    await runner.done(id);
    const lines = activityOf(store.eventsFor(id));
    expect(lines).toContain("architect:Job failed: cannot read");
    expect(lines.join("\n")).not.toMatch(/C:\\/);
  });
});

describe("activity never carries secrets (review blocker)", () => {
  it("a configured secret in progress text is redacted before the event is stored", async () => {
    const { createRedactor } = await import("../src/log.ts");
    const secret = "s3cr3t-value-that-is-long";
    const store = new Store({ dbPath: ":memory:", redact: createRedactor([secret]) });
    const emitter = createActivityEmitter({ append: (ev) => store.appendEvent(ev) });
    emitter.line("task-1", "developer", `Reading config: token ${secret} found`);
    const stored = JSON.stringify(store.eventsSince(0));
    expect(stored).not.toContain(secret);
  });

  it.each(["sk-abcdefghijklmnop", "ghp_abcdefghijklmnopqrstuvwxyz", "github_pat_11ABCDEF_xyz", "FAKE-AWS-KEY-FOR-TESTS", "Bearer abc.def.ghi"])(
    "drops token-like text %s",
    (token) => {
      const { emitter, texts } = harness();
      emitter.line("task-1", "qa", `saw ${token} in a file`);
      expect(texts().join(" ")).not.toContain(token.replace(/^Bearer /, ""));
    },
  );
});

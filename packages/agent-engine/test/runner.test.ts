import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent, JobState, Plan, Review } from "@agentlife/shared";
import type { LimitsConfig } from "../src/config.ts";
import { ConflictError, DiffRejectedError, NotFoundError } from "../src/errors.ts";
import { JobRunner } from "../src/jobs/runner.ts";
import type { StepContext, Steps, TestResult } from "../src/jobs/steps.ts";
import { canTransition, isTerminal } from "../src/jobs/transitions.ts";
import { Store } from "../src/store.ts";

const tmpDirs: string[] = [];
const stores: Store[] = [];
function newStore(): Store {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentlife-runner-"));
  tmpDirs.push(dir);
  const s = new Store({ dbPath: ":memory:", runsDir: dir });
  stores.push(s);
  return s;
}
afterEach(() => {
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

function setup(steps: Steps, limits: LimitsConfig = LIMITS) {
  const store = newStore();
  const runner = new JobRunner({ store, steps, limits, reportTimeoutMs: 40 });
  return { store, runner };
}

/** Approves (or rejects) the plan as soon as it is requested. */
function autoApprove(store: Store, runner: JobRunner, decision: "approve" | "reject" = "approve"): void {
  store.bus.on("event", (ev: AgentEvent) => {
    if (ev.type === "approval.requested") queueMicrotask(() => runner.resolveApproval(ev.approvalId, decision));
  });
}

function states(store: Store, id: string): string[] {
  return store
    .eventsFor(id)
    .flatMap((e) => (e.type === "task.state_changed" ? [e.state] : []));
}

describe("JobRunner happy path", () => {
  it("runs the whole pipeline in order and delivers a report", async () => {
    const { store, runner } = setup(okSteps());
    autoApprove(store, runner);
    const id = runner.start("haunted-todo", "fix it");
    await runner.done(id);
    expect(states(store, id)).toEqual(["analyzing", "awaiting_plan_approval", "developing", "testing", "reviewing", "report_ready", "delivered"]);
    const view = store.getJob(id)!;
    expect(view.state).toBe("delivered");
    expect(view.verdict).toBe("pass");
    expect(view.artifacts.map((a) => a.kind)).toEqual(["plan", "diff", "test_log", "review", "report"]);
    expect(store.eventsFor(id).filter((e) => e.type === "report.ready")).toHaveLength(1);
    expect(view.approvals.map((x) => x.status)).toEqual(["approved"]);
  });

  it("emits the visual script (anchors and agent states)", async () => {
    const { store, runner } = setup(okSteps());
    autoApprove(store, runner);
    const id = runner.start("haunted-todo", "fix it");
    await runner.done(id);
    const evs = store.eventsFor(id);
    const gotos = evs.flatMap((e) => (e.type === "agent.goto" ? [`${e.agentId}:${e.anchor}`] : []));
    expect(gotos).toContain("architect:board");
    expect(gotos).toContain("architect:mailbox");
    expect(gotos).toContain("developer:desk");
    expect(gotos).toContain("qa:computer");
    expect(gotos).toContain("qa:desk");
    const waiting = evs.find((e) => e.type === "agent.state_changed" && e.agentId === "architect" && e.state === "waiting_approval");
    expect(waiting).toBeDefined();
  });

  it("does not run develop before the approval is resolved", async () => {
    let developed = false;
    const { store, runner } = setup(okSteps({ develop: async () => ((developed = true), { diff: "d" }) }));
    const id = runner.start("haunted-todo", "g");
    await new Promise((r) => setTimeout(r, 30));
    expect(store.getJob(id)!.state).toBe("awaiting_plan_approval");
    expect(developed).toBe(false);
    runner.resolveApproval(`appr-${id}`, "approve");
    await runner.done(id);
    expect(developed).toBe(true);
  });
});

describe("JobRunner rules", () => {
  it("rejects a second job while one is running (busy)", async () => {
    const { store, runner } = setup(okSteps());
    const id = runner.start("haunted-todo", "g");
    expect(() => runner.start("haunted-todo", "h")).toThrow(ConflictError);
    await runner.cancel(id);
    // terminal now: a new job is accepted
    expect(store.getJob(id)!.state).toBe("cancelled");
    expect(() => runner.start("haunted-todo", "h")).not.toThrow();
  });

  it("reject goes to cancelled with no report", async () => {
    const { store, runner } = setup(okSteps());
    autoApprove(store, runner, "reject");
    const id = runner.start("haunted-todo", "g");
    await runner.done(id);
    expect(store.getJob(id)!.state).toBe("cancelled");
    expect(store.eventsFor(id).some((e) => e.type === "report.ready")).toBe(false);
  });

  it("retries develop once after a QA fail, then passes", async () => {
    let reviews = 0;
    const feedbacks: string[][] = [];
    const { store, runner } = setup(
      okSteps({
        develop: async (_c, i) => (feedbacks.push(i.feedback), { diff: `d${i.attempt}` }),
        review: async () => (++reviews === 1 ? fail : pass),
      }),
    );
    autoApprove(store, runner);
    const id = runner.start("haunted-todo", "g");
    await runner.done(id);
    expect(states(store, id).filter((s) => s === "developing")).toHaveLength(2);
    expect(feedbacks).toEqual([[], ["needs work"]]);
    expect(store.getJob(id)!.verdict).toBe("pass");
  });

  it("a second QA fail ends in report_ready with verdict fail", async () => {
    const { store, runner } = setup(okSteps({ review: async () => fail }));
    autoApprove(store, runner);
    const id = runner.start("haunted-todo", "g");
    await runner.done(id);
    expect(states(store, id).filter((s) => s === "developing")).toHaveLength(2);
    const view = store.getJob(id)!;
    expect(view.state).toBe("delivered");
    expect(view.verdict).toBe("fail");
  });

  it("failing tests force a fail verdict even if QA says pass", async () => {
    const test: TestResult = { passed: false, log: "1 failed" };
    const { store, runner } = setup(okSteps({ test: async () => test }));
    autoApprove(store, runner);
    const id = runner.start("haunted-todo", "g");
    await runner.done(id);
    expect(store.getJob(id)!.verdict).toBe("fail");
  });

  it("a step timeout records failed, a failure report and delivered", async () => {
    for (const hang of ["analyze", "develop", "test", "review"] as const) {
      const never = () => new Promise<never>(() => {});
      const { store, runner } = setup(okSteps({ [hang]: never } as Partial<Steps>));
      autoApprove(store, runner);
      const id = runner.start("haunted-todo", "g");
      await runner.done(id);
      const evs = store.eventsFor(id);
      const failed = evs.find((e) => e.type === "task.failed");
      expect(failed, hang).toMatchObject({ reason: `timeout:${hang}` });
      expect(states(store, id).slice(-3), hang).toEqual(["failed", "report_ready", "delivered"]);
      expect(store.getJob(id)!.verdict).toBe("fail");
      expect(evs.filter((e) => e.type === "report.ready")).toHaveLength(1);
    }
  });

  it("aborts the step signal on timeout", async () => {
    let sawAbort = false;
    const { store, runner } = setup(
      okSteps({
        analyze: (c: StepContext) =>
          new Promise<Plan>((_, reject) => c.signal.addEventListener("abort", () => ((sawAbort = true), reject(c.signal.reason)))),
      }),
    );
    const id = runner.start("haunted-todo", "g");
    await runner.done(id);
    expect(sawAbort).toBe(true);
    expect(store.getJob(id)!.state).toBe("delivered");
  });

  it("a step error fails the job and the report step error falls back", async () => {
    const { store, runner } = setup(
      okSteps({
        develop: async () => {
          throw new Error("boom");
        },
        report: async () => {
          throw new Error("report broke");
        },
      }),
    );
    autoApprove(store, runner);
    const id = runner.start("haunted-todo", "g");
    await runner.done(id);
    const view = store.getJob(id)!;
    expect(view.state).toBe("delivered");
    expect(view.verdict).toBe("fail");
    const rep = store.eventsFor(id).find((e) => e.type === "report.ready");
    expect(rep && rep.type === "report.ready" && rep.markdown).toContain("boom");
  });

  it("cancels a running step and ends cancelled", async () => {
    const { store, runner } = setup(okSteps({ develop: () => new Promise(() => {}) }), {
      ...LIMITS,
      timeoutsMs: { ...LIMITS.timeoutsMs, develop: 5000 },
    });
    autoApprove(store, runner);
    const id = runner.start("haunted-todo", "g");
    await new Promise((r) => setTimeout(r, 30));
    expect(store.getJob(id)!.state).toBe("developing");
    await runner.cancel(id);
    expect(store.getJob(id)!.state).toBe("cancelled");
    expect(store.eventsFor(id).some((e) => e.type === "report.ready")).toBe(false);
  });

  it("cancels while the approval is pending and resolves it as rejected", async () => {
    const { store, runner } = setup(okSteps());
    const id = runner.start("haunted-todo", "g");
    await new Promise((r) => setTimeout(r, 20));
    await runner.cancel(id);
    const view = store.getJob(id)!;
    expect(view.state).toBe("cancelled");
    expect(view.approvals.map((a) => a.status)).toEqual(["rejected"]);
  });

  it("approval and cancel errors: unknown 404, repeated 409", async () => {
    const { store, runner } = setup(okSteps());
    autoApprove(store, runner);
    expect(() => runner.resolveApproval("nope", "approve")).toThrow(NotFoundError);
    await expect(runner.cancel("nope")).rejects.toBeInstanceOf(NotFoundError);
    const id = runner.start("haunted-todo", "g");
    await runner.done(id);
    expect(() => runner.resolveApproval(`appr-${id}`, "approve")).toThrow(ConflictError);
    await expect(runner.cancel(id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("restart recovery fails non-terminal jobs with engine_restarted and delivers a report", async () => {
    const { store, runner } = setup(okSteps());
    store.appendEvent({ type: "task.created", taskId: "old1", repoId: "haunted-todo", goal: "g" });
    store.appendEvent({ type: "task.state_changed", taskId: "old1", state: "analyzing" });
    store.appendEvent({ type: "task.created", taskId: "old2", repoId: "haunted-todo", goal: "g" });
    store.appendEvent({ type: "task.state_changed", taskId: "old2", state: "analyzing" });
    store.appendEvent({ type: "task.state_changed", taskId: "old2", state: "awaiting_plan_approval" });
    // Make old1 terminal already: it must be left alone.
    store.appendEvent({ type: "task.state_changed", taskId: "old1", state: "cancelled" });
    runner.recover();
    expect(store.getJob("old1")!.state).toBe("cancelled");
    const v = store.getJob("old2")!;
    expect(v.state).toBe("delivered");
    expect(v.verdict).toBe("fail");
    const evs = store.eventsFor("old2");
    expect(evs.find((e) => e.type === "task.failed")).toMatchObject({ reason: "engine_restarted" });
    expect(evs.filter((e) => e.type === "report.ready")).toHaveLength(1);
    expect(runner.activeJobId()).toBeUndefined();
  });
});

// ---- Requirement 3.6 ----

type Outcome = "ok" | "throw" | "hang";
const outcome = fc.constantFrom<Outcome>("ok", "ok", "ok", "throw", "hang");
const scenario = fc.record({
  analyze: outcome,
  develop: fc.array(outcome, { minLength: 2, maxLength: 2 }),
  test: fc.array(fc.constantFrom<"pass" | "fail" | Outcome>("pass", "pass", "fail", "throw", "hang"), { minLength: 2, maxLength: 2 }),
  review: fc.array(fc.constantFrom<"pass" | "fail" | Outcome>("pass", "fail", "fail", "throw", "hang"), { minLength: 2, maxLength: 2 }),
  report: fc.constantFrom<Outcome>("ok", "throw"),
  approval: fc.constantFrom("approve", "approve", "approve", "reject", "cancel"),
  cancelAtCall: fc.option(fc.integer({ min: 1, max: 8 }), { nil: undefined }),
});

describe("JobRunner properties (requirement 3.6)", () => {
  it("never leaves the transition table, never revisits developing more than twice, always ends terminal", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (sc) => {
        const store = newStore();
        const tiny: LimitsConfig = { ...LIMITS, timeoutsMs: { analyze: 8, develop: 8, test: 8, review: 8 } };
        let runner!: JobRunner;
        let taskId = "";
        let calls = 0;
        let developCalls = 0;
        let testCalls = 0;
        let reviewCalls = 0;
        const hang = (): Promise<never> => new Promise(() => {});
        const tick = (): void => {
          calls++;
          if (sc.cancelAtCall === calls) void runner.cancel(taskId).catch(() => {});
        };
        const steps: Steps = {
          analyze: async () => {
            tick();
            if (sc.analyze === "throw") throw new Error("x");
            if (sc.analyze === "hang") return hang();
            return PLAN;
          },
          develop: async () => {
            tick();
            const o = sc.develop[Math.min(developCalls++, 1)]!;
            if (o === "throw") throw new Error("x");
            if (o === "hang") return hang();
            return { diff: "d" };
          },
          test: async () => {
            tick();
            const o = sc.test[Math.min(testCalls++, 1)]!;
            if (o === "throw") throw new Error("x");
            if (o === "hang") return hang();
            return { passed: o !== "fail", log: "l" };
          },
          review: async () => {
            tick();
            const o = sc.review[Math.min(reviewCalls++, 1)]!;
            if (o === "throw") throw new Error("x");
            if (o === "hang") return hang();
            return o === "fail" ? fail : pass;
          },
          report: async () => {
            tick();
            if (sc.report === "throw") throw new Error("x");
            return { title: "r", markdown: "m" };
          },
        };
        runner = new JobRunner({ store, steps, limits: tiny, reportTimeoutMs: 8 });
        store.bus.on("event", (ev: AgentEvent) => {
          if (ev.type !== "approval.requested") return;
          queueMicrotask(() => {
            try {
              if (sc.approval === "cancel") void runner.cancel(ev.taskId).catch(() => {});
              else runner.resolveApproval(ev.approvalId, sc.approval);
            } catch {
              // already cancelled
            }
          });
        });
        taskId = runner.start("haunted-todo", "goal");
        await runner.done(taskId);

        const seq: JobState[] = ["created", ...(states(store, taskId) as JobState[])];
        for (let i = 1; i < seq.length; i++) {
          expect(canTransition(seq[i - 1]!, seq[i]!), `${seq[i - 1]} -> ${seq[i]}`).toBe(true);
        }
        expect(seq.filter((s) => s === "developing").length).toBeLessThanOrEqual(2);
        const view = store.getJob(taskId)!;
        expect(isTerminal(view.state)).toBe(true);
        const reports = store.eventsFor(taskId).filter((e) => e.type === "report.ready").length;
        expect(reports).toBe(view.state === "delivered" ? 1 : 0);
        expect(runner.activeJobId()).toBeUndefined();
      }),
      { numRuns: 150 },
    );
  });
});

describe("JobRunner plan approval and task choice", () => {
  const TWO: Plan = {
    tasks: [
      { id: "t1", title: "First", why: "w", files: ["a.ts"], acceptance: "ok", risk: "low" },
      { id: "t2", title: "Second", why: "w", files: ["b.ts"], acceptance: "ok", risk: "high" },
    ],
  };

  it("offers one option per plan task and builds the first task", async () => {
    const seen: string[] = [];
    const { store, runner } = setup(
      okSteps({
        analyze: async () => TWO,
        develop: async (_c, input) => (seen.push(`develop:${input.task.id}`), { diff: "diff" }),
        review: async (_c, input) => (seen.push(`review:${input.task.id}`), pass),
        report: async (_c, input) => (seen.push(`report:${input.task?.id}`), { title: "R", markdown: "# R" }),
      }),
    );
    autoApprove(store, runner);
    const id = runner.start("haunted-todo", "goal");
    await runner.done(id);
    const request = store.eventsFor(id).find((e) => e.type === "approval.requested");
    if (request?.type !== "approval.requested") throw new Error("no approval");
    expect(request.options).toEqual(["t1: First", "t2: Second"]);
    expect(request.summary).toContain("Approving builds task 1: First");
    expect(seen).toEqual(["develop:t1", "review:t1", "report:t1"]);
  });
});

describe("JobRunner with a rejected diff", () => {
  it("fails the job, stores the rejected patch and hands it to the report", async () => {
    let reported: string | undefined;
    const { store, runner } = setup(
      okSteps({
        develop: async () => {
          throw new DiffRejectedError("protected file: package.json", "--- a/package.json\n+++ b/package.json\n");
        },
        report: async (_c, input) => ((reported = input.diff), { title: "R", markdown: "# R" }),
      }),
    );
    autoApprove(store, runner);
    const id = runner.start("haunted-todo", "goal");
    await runner.done(id);
    const view = store.getJob(id)!;
    expect(view.state).toBe("delivered");
    expect(view.verdict).toBe("fail");
    expect(view.artifacts.map((a) => a.kind)).toEqual(["plan", "diff", "report"]);
    expect(store.artifactsFor(id).find((a) => a.kind === "diff")?.content).toContain("+++ b/package.json");
    expect(reported).toContain("+++ b/package.json");
    const failed = store.eventsFor(id).find((e) => e.type === "task.failed");
    expect(failed && failed.type === "task.failed" ? failed.reason : "").toContain("protected file: package.json");
  });
});

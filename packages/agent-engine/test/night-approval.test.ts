import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent, Plan } from "@agentlife/shared";
import { ConflictError } from "../src/errors.ts";
import { JobRunner, type PreApproval } from "../src/jobs/runner.ts";
import { waitingReason } from "../src/night/scheduler.ts";
import { normalizePlanPath, preApprovalFor, scopeRule } from "../src/night/scope.ts";
import { validateDiff, type DiffEntry } from "../src/steps/validate-diff.ts";
import { CONFIG, at, rig, schedule } from "./night-helpers.ts";
import { LIMITS, PLAN, scripted, states, useSandbox } from "./job-types-helpers.ts";

const planOf = (...files: string[]): Plan => ({ tasks: [{ id: "t1", title: "Do it", why: "because", files, acceptance: "ok", risk: "low" }] });
const changeJob = { kind: "change", preApprove: true } as const;

// ---------------------------------------------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------------------------------------------

describe("plan paths", () => {
  it("accepts plain relative paths and tidies slashes", () => {
    expect(normalizePlanPath("src/a.ts")).toBe("src/a.ts");
    expect(normalizePlanPath("./src/a.ts")).toBe("src/a.ts");
    expect(normalizePlanPath("src\\a.ts")).toBe("src/a.ts");
    expect(normalizePlanPath("  README.md ")).toBe("README.md");
  });

  it("rejects anything that is not a path inside the project", () => {
    for (const bad of ["", "/etc/passwd", "C:\\Windows\\a.txt", "c:/a", "../a", "src/../../a", "src//a", "src/./a", "a\0b"]) {
      expect(normalizePlanPath(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });
});

describe("pre-approval scope", () => {
  const check = (job: Parameters<typeof preApprovalFor>[0], ...files: string[]) => preApprovalFor(job)!.check(planOf(...files));

  it("exists only when the user gave one and the kind has an approval step", () => {
    expect(preApprovalFor({ kind: "change", preApprove: false, scopePaths: ["src/"] })).toBeUndefined();
    expect(preApprovalFor({ ...changeJob })).toBeUndefined();
    expect(preApprovalFor({ ...changeJob, scopePaths: [] })).toBeUndefined();
    expect(preApprovalFor({ kind: "audit-deps", preApprove: true })).toBeUndefined();
    expect(preApprovalFor({ kind: "review-branch", preApprove: true })).toBeUndefined();
    expect(preApprovalFor({ ...changeJob, scopePaths: ["src/"] })).toBeDefined();
    expect(preApprovalFor({ kind: "write-tests", preApprove: true })).toBeDefined();
    expect(preApprovalFor({ kind: "document", preApprove: true })).toBeDefined();
  });

  it("approves a plan whose files are all inside the scope: a folder or one exact file", () => {
    const job = { ...changeJob, scopePaths: ["src/", "README.md"] };
    expect(check(job, "src/a.ts", "./src/deep/b.ts", "README.md")).toEqual({ ok: true });
  });

  it("refuses a plan with one file outside the scope and names it", () => {
    const job = { ...changeJob, scopePaths: ["src/"] };
    const verdict = check(job, "src/a.ts", "package.json");
    expect(verdict).toMatchObject({ ok: false });
    expect(verdict.ok ? "" : verdict.reason).toContain("package.json is outside the pre-approved scope (src/)");
  });

  it("does not mistake a folder with the same prefix, a file for a folder, or another case", () => {
    const job = { ...changeJob, scopePaths: ["src/", "README.md"] };
    expect(check(job, "src2/a.ts").ok).toBe(false);
    expect(check(job, "src").ok).toBe(false);
    expect(check(job, "README.md/x").ok).toBe(false);
    expect(check(job, "SRC/a.ts").ok).toBe(false);
    expect(check(job, "readme.md").ok).toBe(false);
  });

  it("refuses paths that leave the project, even when they start with the scope", () => {
    const job = { ...changeJob, scopePaths: ["src/"] };
    for (const bad of ["src/../package.json", "/src/a.ts", "C:/src/a.ts", "../src/a.ts"]) {
      const verdict = check(job, bad);
      expect(verdict.ok, bad).toBe(false);
      expect(verdict.ok ? "" : verdict.reason).toContain("is not a path inside the project");
    }
  });

  it("refuses a plan that does not say which files it touches", () => {
    const job = { ...changeJob, scopePaths: ["src/"] };
    expect(check(job)).toEqual({ ok: false, reason: "the plan does not say which files it touches" });
    expect(preApprovalFor(job)!.check({ tasks: [{ ...PLAN.tasks[0]!, files: [] }] }).ok).toBe(false);
  });

  it("checks every task of the plan, not only the first", () => {
    const job = { ...changeJob, scopePaths: ["src/"] };
    const plan: Plan = { tasks: [...planOf("src/a.ts").tasks, { ...PLAN.tasks[0]!, id: "t2", files: ["ci/deploy.yml"] }] };
    expect(preApprovalFor(job)!.check(plan).ok).toBe(false);
  });

  it("uses the fixed rule of write-tests and document, not a scope typed by the user", () => {
    expect(check({ kind: "write-tests", preApprove: true }, "src/a.test.ts", "test/helpers.js").ok).toBe(true);
    expect(check({ kind: "write-tests", preApprove: true }, "src/a.ts").ok).toBe(false);
    expect(check({ kind: "document", preApprove: true }, "README.md", "docs/guide.txt").ok).toBe(true);
    expect(check({ kind: "document", preApprove: true }, "src/index.ts").ok).toBe(false);
  });

  it("shortens and cleans a long or odd file name in the reason", () => {
    const verdict = check({ ...changeJob, scopePaths: ["src/"] }, `x${"y".repeat(500)}\nmore`);
    expect(verdict.ok ? "" : verdict.reason.length).toBeLessThan(250);
    expect(verdict.ok ? "" : verdict.reason).not.toContain("\n");
  });

  it("scopeRule describes itself with its entries", () => {
    expect(scopeRule(["src/", "a.md"]).description).toBe("src/, a.md");
  });
});

describe("diff held to the pre-approved scope", () => {
  const entry = (p: string): DiffEntry => ({ path: p, status: "M", oldMode: "100644", newMode: "100644", added: 2, deleted: 1 });
  const root = path.join(os.tmpdir(), "al-night-scope-root");
  const limits = { maxDiffLines: 400, maxFilesChanged: 10 };

  it("lets a diff inside the scope through and stops one that grew outside it", () => {
    const scope = scopeRule(["src/"]);
    expect(validateDiff(root, [entry("src/a.ts")], limits, 0, "change", scope)).toMatchObject({ ok: true });
    const bad = validateDiff(root, [entry("src/a.ts"), entry("lib/b.ts")], limits, 0, "change", scope);
    expect(bad).toMatchObject({ ok: false });
    expect(bad.ok ? "" : bad.reason).toContain("lib/b.ts is outside the pre-approved scope");
  });

  it("changes nothing when there is no scope", () => {
    expect(validateDiff(root, [entry("lib/b.ts")], limits, 0, "change")).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------------------------

describe("JobRunner with a night pre-approval", () => {
  const box = useSandbox();
  const policy = (...entries: string[]): PreApproval => preApprovalFor({ ...changeJob, scopePaths: entries })!;

  /** A runner that does NOT approve by itself: the tests decide. Resolves `approvalId` of the first request. */
  function manualRunner(steps: ReturnType<typeof scripted>["steps"]) {
    const store = box.newStore();
    const runner = new JobRunner({ store, steps, limits: LIMITS, reportTimeoutMs: 2000 });
    const requested = new Promise<string>((resolve) => {
      store.bus.on("event", (ev: AgentEvent) => {
        if (ev.type === "approval.requested") resolve(ev.approvalId);
      });
    });
    return { store, runner, requested };
  }

  it("approves a plan inside the scope without the user and builds it", async () => {
    const { steps, seen } = scripted({ analyze: async () => planOf("docs/a.md") });
    const { store, runner } = manualRunner(steps);
    const id = runner.start("haunted-todo", "Doc it", { preApproval: policy("docs/") });
    await runner.done(id);

    const events = store.eventsFor(id);
    expect(events.filter((e) => e.type === "approval.resolved")).toMatchObject([{ decision: "approve" }]);
    const asked = events.find((e) => e.type === "approval.requested");
    expect(asked?.type === "approval.requested" ? asked.summary : "").toContain("Night shift: approved automatically");
    expect(states(store, id)).toEqual(["analyzing", "awaiting_plan_approval", "developing", "testing", "reviewing", "report_ready", "delivered"]);
    expect(store.getJob(id)).toMatchObject({ state: "delivered", verdict: "pass" });
    expect(seen.calls).toContain("develop");
    // The Developer is held to the same scope.
    expect(seen.ctxs["develop"]![0]!.pathRule?.description).toBe("docs/");
  });

  it("stops a plan outside the scope at the approval: nothing is developed", async () => {
    const { steps, seen } = scripted({ analyze: async () => planOf("src/index.js") });
    const { store, runner, requested } = manualRunner(steps);
    const id = runner.start("haunted-todo", "Doc it", { preApproval: policy("docs/") });
    const approvalId = await requested;
    await new Promise((r) => setTimeout(r, 30));

    expect(store.getJob(id)).toMatchObject({ state: "awaiting_plan_approval" });
    expect(store.getJob(id)!.approvals).toMatchObject([{ approvalId, status: "pending" }]);
    expect(store.getJob(id)!.approvals[0]!.summary).toContain("Night shift: not approved automatically (src/index.js is outside the pre-approved scope (docs/))");
    expect(seen.calls).toEqual([]);

    runner.resolveApproval(approvalId, "reject");
    await runner.done(id);
    expect(store.getJob(id)!.state).toBe("cancelled");
    expect(seen.calls).toEqual([]);
  });

  it("builds a plan that the user approves later, with no scope on the Developer", async () => {
    const { steps, seen } = scripted({ analyze: async () => planOf("src/index.js") });
    const { runner, requested } = manualRunner(steps);
    const id = runner.start("haunted-todo", "Doc it", { preApproval: policy("docs/") });
    runner.resolveApproval(await requested, "approve");
    await runner.done(id);
    expect(seen.calls).toContain("develop");
    expect(seen.ctxs["develop"]![0]!.pathRule).toBeUndefined();
  });

  /** Starts a job whose plan the policy cannot approve and checks that it waits and builds nothing. */
  async function expectWaits(plan: Plan, preApproval: PreApproval): Promise<void> {
    const { steps, seen } = scripted({ analyze: async () => plan });
    const { store, runner, requested } = manualRunner(steps);
    const id = runner.start("haunted-todo", "g", { preApproval });
    const approvalId = await requested;
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getJob(id)!.state).toBe("awaiting_plan_approval");
    expect(seen.calls).toEqual([]);
    runner.resolveApproval(approvalId, "reject");
    await runner.done(id);
  }

  it("waits for the user when the plan names no files", async () => {
    await expectWaits({ tasks: [{ ...PLAN.tasks[0]!, files: [] }] }, policy("docs/"));
  });

  it("waits for the user when the policy throws", async () => {
    await expectWaits(planOf("docs/a.md"), {
      paths: scopeRule(["docs/"]),
      check: () => {
        throw new Error("boom");
      },
    });
  });

  it("works for document with its fixed rule", async () => {
    const { steps, seen } = scripted({ analyze: async () => planOf("README.md") });
    const { store, runner } = manualRunner(steps);
    const id = runner.start("haunted-todo", "Document x", { kind: "document", target: "docs", preApproval: preApprovalFor({ kind: "document", preApprove: true })! });
    await runner.done(id);
    expect(store.getJob(id)!.state).toBe("delivered");
    expect(seen.calls).toContain("develop");
  });

  it("refuses a pre-approval for kinds that have no approval step", async () => {
    const { steps } = scripted({ auditDeps: async () => ({ outdated: [], vulnerabilities: [], outdatedOk: true, auditOk: true, notes: [] }) });
    const { runner } = manualRunner(steps);
    for (const kind of ["audit-deps", "review-branch"] as const) {
      expect(() => runner.start("haunted-todo", "g", { kind, ...(kind === "review-branch" ? { target: "x" } : {}), preApproval: policy("docs/") })).toThrow(ConflictError);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Scheduler: what it hands to the engine and what it records
// ---------------------------------------------------------------------------------------------------------------

describe("night scheduler and the approval policy", () => {
  it("hands the engine a pre-approval only for jobs that have one", async () => {
    const r = rig(CONFIG, at(1, 0));
    schedule(r.store, { kind: "change", goal: "Tidy", preApprove: true, scopePaths: ["src/"] });
    await r.scheduler.tick();
    r.port.set("task-1", "delivered", { verdict: "pass" });
    schedule(r.store, { kind: "change", goal: "Tidy more" });
    schedule(r.store, { kind: "audit-deps" });
    await r.scheduler.tick();
    r.port.set("task-2", "delivered", { verdict: "pass" });
    await r.scheduler.tick();

    const [a, b, c] = r.port.started;
    expect(a!.opts.preApproval?.paths.description).toBe("src/");
    expect(b!.opts.preApproval).toBeUndefined();
    expect(c!.opts).toMatchObject({ kind: "audit-deps" });
    expect(c!.opts.preApproval).toBeUndefined();
  });

  it("marks a job stopped at the approval as waiting for the user and goes on with the next one", async () => {
    const r = rig(CONFIG, at(1, 0));
    const a = schedule(r.store, { kind: "change", goal: "Tidy", preApprove: true, scopePaths: ["docs/"] });
    const b = schedule(r.store);
    await r.scheduler.tick();
    r.port.set("task-1", "awaiting_plan_approval", {
      approvals: [
        {
          approvalId: "appr-task-1",
          kind: "plan",
          status: "pending",
          summary: "Plan\nNight shift: not approved automatically (src/index.js is outside the pre-approved scope (docs/)). Nothing is built until you decide.",
        },
      ],
    });
    await r.scheduler.tick();

    expect(r.store.get(a.id)).toMatchObject({ status: "waiting", reason: "The plan is outside the pre-approved scope: src/index.js is outside the pre-approved scope (docs/)" });
    expect(r.store.get(b.id)?.status).toBe("running");
    expect(r.port.cancelled).toEqual([]);
  });

  it("does not treat a plan that waits without a pending approval as stopped yet", async () => {
    const r = rig(CONFIG, at(1, 0));
    const a = schedule(r.store, { kind: "change", goal: "Tidy", preApprove: true, scopePaths: ["docs/"] });
    await r.scheduler.tick();
    r.port.set("task-1", "awaiting_plan_approval", { approvals: [{ approvalId: "x", kind: "plan", status: "approved", summary: "s" }] });
    await r.scheduler.tick();
    expect(r.store.get(a.id)?.status).toBe("running");
  });

  it("explains why a job waits, with or without a pre-approval", () => {
    expect(waitingReason({ preApprove: false }, "Plan")).toMatch(/No pre-approval was given/);
    expect(waitingReason({ preApprove: true }, "Plan")).toBe("The plan needs your approval.");
    expect(waitingReason({ preApprove: true }, "x\nNight shift: not approved automatically (it is odd). y")).toBe("The plan is outside the pre-approved scope: it is odd");
  });

  describe("delivery", () => {
    const withDelivery = async (input: Parameters<typeof schedule>[1], verdict: "pass" | "fail" = "pass") => {
      const r = rig(CONFIG, at(1, 0));
      const job = schedule(r.store, input);
      await r.scheduler.tick();
      r.port.set("task-1", "delivered", { verdict });
      await r.scheduler.tick();
      return { r, job };
    };

    it("never delivers unless the user asked for it when scheduling", async () => {
      const { r, job } = await withDelivery({ kind: "change", goal: "Tidy" });
      expect(r.port.delivered).toEqual([]);
      expect(r.store.get(job.id)).toMatchObject({ status: "done" });
      expect(r.store.get(job.id)?.branch).toBeUndefined();
    });

    it("delivers a branch for a passing job when the user asked, and records it", async () => {
      const { r, job } = await withDelivery({ kind: "change", goal: "Tidy", deliver: true });
      expect(r.port.delivered).toEqual(["task-1"]);
      expect(r.store.get(job.id)).toMatchObject({ status: "done", branch: "agentlife/task-1", commit: "abc1234" });
    });

    it("does not deliver a failing job", async () => {
      const { r, job } = await withDelivery({ kind: "change", goal: "Tidy", deliver: true }, "fail");
      expect(r.port.delivered).toEqual([]);
      expect(r.store.get(job.id)).toMatchObject({ status: "failed" });
    });

    it("keeps the job done and says so when the branch could not be made", async () => {
      const r = rig(CONFIG, at(1, 0));
      r.port.deliverError = new Error("branch_exists");
      const job = schedule(r.store, { kind: "change", goal: "Tidy", deliver: true });
      await r.scheduler.tick();
      r.port.set("task-1", "delivered", { verdict: "pass" });
      await r.scheduler.tick();
      expect(r.store.get(job.id)).toMatchObject({ status: "done", reason: "Not delivered: branch_exists" });
      expect(r.store.get(job.id)?.branch).toBeUndefined();
    });
  });
});

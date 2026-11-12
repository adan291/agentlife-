import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { JOB_KINDS, type JobKind, type JobState } from "@agentlife/shared";
import { ConflictError } from "../src/errors.ts";
import { buildExport } from "../src/http/export.ts";
import { PIPELINES, buildTransitions, canTransitionFor, hasTestStep, kindPathProblem, pathRuleFor, transitionsFor, writesFiles } from "../src/jobs/kinds.ts";
import type { StepContext, Steps } from "../src/jobs/steps.ts";
import { TRANSITIONS } from "../src/jobs/transitions.ts";
import { dataPaths } from "../src/paths.ts";
import { finalizeBranchReview, pickBase, reviewBranchStep } from "../src/steps/review-branch.ts";
import { validateDiff, type DiffEntry } from "../src/steps/validate-diff.ts";
import {
  BRANCH_DIFF,
  KindRuntime,
  PASS,
  addBranch,
  demoRepo,
  jobOn,
  pipelineDeps,
  registryFor,
  runnerFor,
  scripted,
  states,
  useSandbox,
  userRepoState,
} from "./job-types-helpers.ts";
import { ENGINE_IDENTITY, git } from "../src/git.ts";

// ---------------------------------------------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------------------------------------------

const ALL_STATES = Object.keys(TRANSITIONS) as JobState[];
const ALWAYS_OK: readonly JobState[] = ["failed", "cancelled", "delivered"];

describe("fixed pipeline per kind", () => {
  it("keeps the table of a change exactly as the state machine has it", () => {
    expect(transitionsFor("change")).toBe(TRANSITIONS);
    const built = buildTransitions(PIPELINES.change);
    for (const s of ALL_STATES) expect([...built[s]].sort(), s).toEqual([...TRANSITIONS[s]].sort());
  });

  it("review-branch reviews, then tests, then reports: no plan, no approval, no develop", () => {
    const ok = (a: JobState, b: JobState): boolean => canTransitionFor("review-branch", a, b);
    expect(ok("created", "reviewing")).toBe(true);
    expect(ok("reviewing", "testing")).toBe(true);
    expect(ok("testing", "report_ready")).toBe(true);
    expect(ok("created", "analyzing")).toBe(false);
    expect(ok("reviewing", "report_ready")).toBe(false);
    expect(ok("reviewing", "developing")).toBe(false);
    expect(ok("testing", "reviewing")).toBe(false);
    expect(ok("awaiting_plan_approval", "developing")).toBe(false);
    expect(writesFiles("review-branch")).toBe(false);
  });

  it("document has no test step: develop goes straight to review", () => {
    const ok = (a: JobState, b: JobState): boolean => canTransitionFor("document", a, b);
    expect(ok("developing", "reviewing")).toBe(true);
    expect(ok("reviewing", "developing")).toBe(true); // the one retry
    expect(ok("developing", "testing")).toBe(false);
    expect(ok("testing", "reviewing")).toBe(false);
    expect(hasTestStep("document")).toBe(false);
  });

  it("write-tests follows the same steps as a change", () => {
    expect(PIPELINES["write-tests"]).toEqual(PIPELINES.change);
    expect(hasTestStep("write-tests")).toBe(true);
  });

  it("plan, then approval, then develop, for every kind that writes files", () => {
    for (const kind of JOB_KINDS) {
      if (!writesFiles(kind)) continue;
      const flow = PIPELINES[kind];
      expect(flow.indexOf("analyzing"), kind).toBeLessThan(flow.indexOf("awaiting_plan_approval"));
      expect(flow.indexOf("awaiting_plan_approval"), kind).toBeLessThan(flow.indexOf("developing"));
      if (flow.includes("testing")) expect(flow.indexOf("testing"), kind).toBeLessThan(flow.indexOf("reviewing"));
    }
  });

  it("any walk through a kind's table only visits the states of its pipeline (property test)", () => {
    const kinds = fc.constantFrom<JobKind>(...JOB_KINDS);
    fc.assert(
      fc.property(kinds, fc.array(fc.nat(), { maxLength: 30 }), (kind, picks) => {
        const table = transitionsFor(kind);
        const allowed = new Set<JobState>([...PIPELINES[kind], ...ALWAYS_OK]);
        let state: JobState = "created";
        for (const pick of picks) {
          const options: readonly JobState[] = table[state];
          if (options.length === 0) break;
          state = options[pick % options.length]!;
          expect(allowed.has(state), `${kind}: ${state}`).toBe(true);
        }
      }),
    );
  });

  it("a delivered or cancelled job never moves again, in any kind", () => {
    for (const kind of JOB_KINDS) {
      expect(transitionsFor(kind).delivered).toEqual([]);
      expect(transitionsFor(kind).cancelled).toEqual([]);
      expect(transitionsFor(kind).failed).toEqual(["report_ready"]);
      expect(transitionsFor(kind).report_ready).toEqual(["delivered"]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Path rules
// ---------------------------------------------------------------------------------------------------------------

const ROOT = path.join(os.tmpdir(), "al-kinds-root");
const LIMITS_CFG = { maxDiffLines: 400, maxFilesChanged: 10 };
const entry = (p: string, over: Partial<DiffEntry> = {}): DiffEntry => ({ path: p, status: "M", oldMode: "100644", newMode: "100644", added: 2, deleted: 1, ...over });

const plainSegment = fc
  .stringMatching(/^[a-z][a-z0-9]{0,7}$/)
  .filter((s) => !["test", "tests", "spec", "docs", "md", "jenkinsfile"].includes(s) && !s.startsWith("__"));
const ext = fc.constantFrom("ts", "js", "py", "json", "txt");

describe("path rules per kind", () => {
  it("write-tests accepts test files and test folders only", () => {
    for (const ok of ["src/a.test.ts", "a.spec.js", "packages/x/src/deep/a.test.tsx", "test/helpers.js", "tests/unit/a.js", "__tests__/a.js", "src/b.spec.d.ts", "test/data/sample.json"]) {
      expect(kindPathProblem("write-tests", ok), ok).toBeUndefined();
    }
    for (const bad of ["src/a.ts", "a.js", "lib/test.js", "src/test/a.js", "src/testing.ts", "contest.ts", "docs/a.md", "src/__tests__/a.js", "test", "tests"]) {
      expect(kindPathProblem("write-tests", bad), bad).toMatch(/write-tests/);
    }
  });

  it("document accepts docs/ and Markdown only", () => {
    for (const ok of ["README.md", "docs/guide.txt", "docs/a/b/c.png", "packages/x/NOTES.md", "CHANGELOG.MD", "docs/index.html"]) {
      expect(kindPathProblem("document", ok), ok).toBeUndefined();
    }
    for (const bad of ["src/index.ts", "a.js", ".md", "docs", "docsx/a.txt", "src/docs/a.txt", "readme.txt", "test/a.test.js"]) {
      expect(kindPathProblem("document", bad), bad).toMatch(/document/);
    }
  });

  it("a change and a branch review have no path rule of their own", () => {
    expect(pathRuleFor("change")).toBeUndefined();
    expect(pathRuleFor("review-branch")).toBeUndefined();
    expect(kindPathProblem("change", "src/anything.ts")).toBeUndefined();
  });

  it("random paths: only test-shaped paths pass for write-tests (property test)", () => {
    const dirs = fc.array(plainSegment, { maxLength: 3 });
    const testShaped = fc.oneof(
      fc.tuple(dirs, plainSegment, ext).map(([d, s, e]) => [...d, `${s}.test.${e}`].join("/")),
      fc.tuple(dirs, plainSegment, ext).map(([d, s, e]) => [...d, `${s}.spec.${e}`].join("/")),
      fc.tuple(fc.constantFrom("test", "tests", "__tests__"), dirs, plainSegment, ext).map(([t, d, s, e]) => [t, ...d, `${s}.${e}`].join("/")),
    );
    const other = fc.tuple(plainSegment, dirs, plainSegment, ext).map(([top, d, s, e]) => [top, ...d, `${s}.${e}`].join("/"));
    fc.assert(fc.property(testShaped, (p) => kindPathProblem("write-tests", p) === undefined));
    fc.assert(fc.property(other, (p) => kindPathProblem("write-tests", p) !== undefined));
  });

  it("random paths: only docs/ and Markdown pass for document (property test)", () => {
    const dirs = fc.array(plainSegment, { maxLength: 3 });
    const docShaped = fc.oneof(
      fc.tuple(dirs, plainSegment).map(([d, s]) => [...d, `${s}.md`].join("/")),
      fc.tuple(dirs, plainSegment, ext).map(([d, s, e]) => ["docs", ...d, `${s}.${e}`].join("/")),
    );
    const other = fc.tuple(plainSegment, dirs, plainSegment, ext).map(([top, d, s, e]) => [top, ...d, `${s}.${e}`].join("/"));
    fc.assert(fc.property(docShaped, (p) => kindPathProblem("document", p) === undefined));
    fc.assert(fc.property(other, (p) => kindPathProblem("document", p) !== undefined));
  });

  it("validateDiff rejects a file outside the kind's paths and names the rule", () => {
    const testsOnly = validateDiff(ROOT, [entry("test/a.test.ts"), entry("src/a.ts")], LIMITS_CFG, 0, "write-tests");
    expect(testsOnly).toMatchObject({ ok: false });
    if (!testsOnly.ok) {
      expect(testsOnly.reason).toContain("src/a.ts");
      expect(testsOnly.reason).toContain("write-tests");
      expect(testsOnly.reason).toContain("test files only");
    }
    expect(validateDiff(ROOT, [entry("test/a.test.ts"), entry("test/b.js", { status: "A" })], LIMITS_CFG, 0, "write-tests")).toMatchObject({ ok: true });

    const docs = validateDiff(ROOT, [entry("docs/a.md", { status: "A" }), entry("lib/a.js")], LIMITS_CFG, 0, "document");
    expect(docs).toMatchObject({ ok: false });
    if (!docs.ok) expect(docs.reason).toContain("documentation only");
    expect(validateDiff(ROOT, [entry("README.md"), entry("docs/x/y.md", { status: "A" })], LIMITS_CFG, 0, "document")).toMatchObject({ ok: true });
  });

  it("a deleted file counts too, and the protected paths still win", () => {
    expect(validateDiff(ROOT, [entry("src/a.ts", { status: "D" })], LIMITS_CFG, 0, "write-tests")).toMatchObject({ ok: false });
    const pkg = validateDiff(ROOT, [entry("package.json")], LIMITS_CFG, 0, "write-tests");
    expect(pkg).toMatchObject({ ok: false });
    if (!pkg.ok) expect(pkg.reason).toMatch(/protected file/);
    const gh = validateDiff(ROOT, [entry(".github/notes.md")], LIMITS_CFG, 0, "document");
    expect(gh).toMatchObject({ ok: false });
    if (!gh.ok) expect(gh.reason).toMatch(/protected path/);
  });

  it("a change is not restricted: the default kind keeps the old behaviour", () => {
    expect(validateDiff(ROOT, [entry("src/a.ts")], LIMITS_CFG)).toMatchObject({ ok: true });
    expect(validateDiff(ROOT, [entry("src/a.ts")], LIMITS_CFG, 0, "change")).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The runner follows the pipeline of each kind (scripted steps)
// ---------------------------------------------------------------------------------------------------------------

const box = useSandbox();

describe("JobRunner per kind", () => {
  it("review-branch: review, then test, then report, with no approval and no develop", async () => {
    const { steps, seen } = scripted();
    const { store, runner } = runnerFor(box, steps);
    const id = runner.start("haunted-todo", "Review feature/x", { kind: "review-branch", target: "feature/x" });
    await runner.done(id);
    expect(states(store, id)).toEqual(["reviewing", "testing", "report_ready", "delivered"]);
    expect(seen.calls).toEqual(["reviewBranch", "test", "report"]);
    const view = store.getJob(id)!;
    expect(view.kind).toBe("review-branch");
    expect(view.target).toBe("feature/x");
    expect(view.approvals).toEqual([]);
    expect(view.verdict).toBe("pass");
    expect(view.artifacts.map((a) => a.kind)).toEqual(["diff", "review", "test_log", "report"]);
    expect(view.steps.map((s) => s.step)).toEqual(["review", "test", "report"]);
    // The steps are told what the job is.
    expect(seen.ctxs["reviewBranch"]![0]).toMatchObject({ kind: "review-branch", target: "feature/x" });
    expect(seen.ctxs["test"]![0]).toMatchObject({ kind: "review-branch" });
    // Nothing was written, so nothing can be delivered.
    expect(buildExport(store, id, Date.now, { isRegisteredProject: () => true }).job.deliverable).toBeUndefined();
  });

  it("review-branch: failing tests or a failing review mean a failing verdict", async () => {
    const a = runnerFor(box, scripted({ test: async () => ({ passed: false, log: "1 failed", exitCode: 1 }) }).steps);
    const idA = a.runner.start("haunted-todo", "g", { kind: "review-branch", target: "feature/x" });
    await a.runner.done(idA);
    expect(a.store.getJob(idA)!.verdict).toBe("fail");

    const failingReview = scripted({
      reviewBranch: async () => ({ review: { verdict: "fail", risk: "high", findings: [{ severity: "high", text: "SQL built from input", file: "src/db.js" }] }, diff: BRANCH_DIFF, base: "main" }),
    });
    const b = runnerFor(box, failingReview.steps);
    const idB = b.runner.start("haunted-todo", "g", { kind: "review-branch", target: "feature/x" });
    await b.runner.done(idB);
    expect(b.store.getJob(idB)!.verdict).toBe("fail");
  });

  it("write-tests: plan, approval, develop, test, review, report, and the steps know the kind", async () => {
    const { steps, seen } = scripted();
    const { store, runner } = runnerFor(box, steps);
    const id = runner.start("haunted-todo", "Cover format", { kind: "write-tests", target: "src/format.js" });
    await runner.done(id);
    expect(states(store, id)).toEqual(["analyzing", "awaiting_plan_approval", "developing", "testing", "reviewing", "report_ready", "delivered"]);
    for (const name of ["analyze", "develop", "test", "review"]) {
      expect(seen.ctxs[name]![0], name).toMatchObject({ kind: "write-tests", target: "src/format.js" });
    }
    expect(store.eventsFor(id).find((e) => e.type === "approval.requested")).toMatchObject({ summary: expect.stringContaining("Test plan for: Cover format") });
  });

  it("document: research, approval, develop, review, report, with no test step", async () => {
    const { steps, seen } = scripted();
    const { store, runner } = runnerFor(box, steps);
    const id = runner.start("haunted-todo", "Explain login", { kind: "document", target: "How login works" });
    await runner.done(id);
    expect(states(store, id)).toEqual(["analyzing", "awaiting_plan_approval", "developing", "reviewing", "report_ready", "delivered"]);
    expect(seen.calls).not.toContain("test");
    expect(seen.reviewTests).toEqual([true]); // QA is told the tests are not part of this job
    const view = store.getJob(id)!;
    expect(view.steps.map((s) => s.step)).toEqual(["analyze", "develop", "review", "report"]);
    expect(view.artifacts.map((a) => a.kind)).toEqual(["plan", "diff", "review", "report"]);
  });

  it("document: one retry after a failing review goes back to develop and never to test", async () => {
    let n = 0;
    const { steps } = scripted({ review: async () => (++n === 1 ? { verdict: "fail", notes: ["unclear"], risk: "low" } : PASS) });
    const { store, runner } = runnerFor(box, steps);
    const id = runner.start("haunted-todo", "g", { kind: "document", target: "topic" });
    await runner.done(id);
    expect(states(store, id)).toEqual(["analyzing", "awaiting_plan_approval", "developing", "reviewing", "developing", "reviewing", "report_ready", "delivered"]);
    expect(store.getJob(id)!.verdict).toBe("pass");
  });

  it("a plain change carries no kind in its events, so recorded runs stay valid", async () => {
    const { steps } = scripted();
    const { store, runner } = runnerFor(box, steps);
    const id = runner.start("haunted-todo", "g");
    await runner.done(id);
    const created = store.eventsFor(id).find((e) => e.type === "task.created")!;
    expect(created).not.toHaveProperty("kind");
    expect(store.getJob(id)!.kind).toBeUndefined();
  });

  it("refuses a target that does not fit the kind, and a kind the steps cannot run", () => {
    const { steps } = scripted();
    const { runner } = runnerFor(box, steps);
    expect(() => runner.start("r", "g", { kind: "review-branch" })).toThrow(ConflictError);
    expect(() => runner.start("r", "g", { kind: "review-branch", target: "--bad" })).toThrow(ConflictError);
    expect(() => runner.start("r", "g", { kind: "write-tests", target: "../etc" })).toThrow(ConflictError);
    expect(() => runner.start("r", "g", { kind: "change", target: "x" })).toThrow(ConflictError);
    const { reviewBranch: _drop, ...without } = steps;
    const other = runnerFor(box, without as Steps);
    expect(() => other.runner.start("r", "g", { kind: "review-branch", target: "feature/x" })).toThrow(/cannot review branches/);
  });

  it("a branch review can be cancelled while it runs", async () => {
    const { steps } = scripted({ reviewBranch: (c) => new Promise((_r, reject) => c.signal.addEventListener("abort", () => reject(c.signal.reason))) });
    const { store, runner } = runnerFor(box, steps);
    const id = runner.start("haunted-todo", "g", { kind: "review-branch", target: "feature/x" });
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getJob(id)!.state).toBe("reviewing");
    await runner.cancel(id);
    expect(store.getJob(id)!.state).toBe("cancelled");
  });

  it("a failing step still ends in a report", async () => {
    const { steps } = scripted({
      reviewBranch: async () => {
        throw new Error("'nope' is not a branch of this project");
      },
    });
    const { store, runner } = runnerFor(box, steps);
    const id = runner.start("haunted-todo", "g", { kind: "review-branch", target: "nope" });
    await runner.done(id);
    expect(states(store, id)).toEqual(["reviewing", "failed", "report_ready", "delivered"]);
    expect(store.getJob(id)!.verdict).toBe("fail");
  });
});

describe("finalizeBranchReview and pickBase", () => {
  it("sorts by severity, cuts long text and long lists, and never passes a branch with a high finding", () => {
    const findings = [
      { severity: "low" as const, text: "a" },
      { severity: "high" as const, text: "b".repeat(900), file: "f".repeat(300) },
      ...Array.from({ length: 60 }, (_, i) => ({ severity: "medium" as const, text: `m${i}` })),
    ];
    const out = finalizeBranchReview({ verdict: "pass", risk: "low", findings });
    expect(out.verdict).toBe("fail");
    expect(out.findings).toHaveLength(30);
    expect(out.findings[0]!.severity).toBe("high");
    expect(out.findings[0]!.text.length).toBeLessThanOrEqual(500);
    expect(out.findings[0]!.file!.length).toBeLessThanOrEqual(200);
    expect(finalizeBranchReview({ verdict: "pass", risk: "low", findings: [{ severity: "low", text: "x" }] }).verdict).toBe("pass");
  });

  it("compares with the checked-out branch, else main, else master, never with itself", () => {
    expect(pickBase("feature/x", "main", ["main", "feature/x"])).toBe("main");
    expect(pickBase("feature/x", "develop", ["develop", "main", "feature/x"])).toBe("develop");
    expect(pickBase("feature/x", "feature/x", ["feature/x", "master"])).toBe("master");
    expect(pickBase("feature/x", null, ["main", "feature/x"])).toBe("main");
    expect(pickBase("main", "main", ["main"])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Real git, real steps, scripted agents
// ---------------------------------------------------------------------------------------------------------------

describe("write-tests and document jobs with the real steps", () => {
  it("write-tests: accepts a patch that only adds test files", async () => {
    const dir = await demoRepo(box);
    const rt = new KindRuntime({ writes: { "test/util.test.js": "it('adds', () => {});\n" } });
    const { view, store, id, reg } = await jobOn(box, "write-tests", rt, dir, "src/util.js", "Cover util");
    expect(view.state).toBe("delivered");
    expect(view.verdict).toBe("pass");
    expect(view.kind).toBe("write-tests");
    expect(view.steps.map((s) => s.step)).toEqual(["analyze", "develop", "test", "review", "report"]);
    // The change is on a branch that can be delivered.
    expect(buildExport(store, id, Date.now, { isRegisteredProject: (r) => reg.get(r)?.builtin === false }).job.deliverable).toBe(true);
  });

  it("write-tests: rejects a patch that touches the code under test and puts the rule in the failure", async () => {
    const dir = await demoRepo(box);
    const rt = new KindRuntime({ writes: { "test/util.test.js": "it('adds', () => {});\n", "src/util.js": "export const add = () => 0;\n" } });
    const { view, report, store, id } = await jobOn(box, "write-tests", rt, dir, "src/util.js");
    expect(view.verdict).toBe("fail");
    expect(report).toContain("src/util.js is outside the paths a write-tests job may change");
    expect(report).toContain("test files only");
    expect(store.eventsFor(id).find((e) => e.type === "task.failed")).toMatchObject({ reason: expect.stringContaining("write-tests") });
    expect(view.steps.map((s) => s.step)).not.toContain("test");
    expect(view.artifacts.map((a) => a.kind)).toContain("diff"); // the rejected patch is kept
  });

  it("document: accepts docs and Markdown, runs no tests", async () => {
    const dir = await demoRepo(box);
    const rt = new KindRuntime({ writes: { "docs/guide.md": "# Guide\n", "README.md": "# Demo\n\nMore.\n" } });
    const { view } = await jobOn(box, "document", rt, dir, "How util works", "Document util");
    expect(view.state).toBe("delivered");
    expect(view.verdict).toBe("pass");
    expect(view.steps.map((s) => s.step)).toEqual(["analyze", "develop", "review", "report"]);
    expect(view.artifacts.map((a) => a.kind)).not.toContain("test_log");
  });

  it("document: rejects a patch that edits source code", async () => {
    const dir = await demoRepo(box);
    const rt = new KindRuntime({ writes: { "docs/guide.md": "# Guide\n", "src/util.js": "// comment\n" } });
    const { view, report } = await jobOn(box, "document", rt, dir, "How util works");
    expect(view.verdict).toBe("fail");
    expect(report).toContain("src/util.js is outside the paths a document job may change");
    expect(report).toContain("documentation only");
  });
});

describe("branch review with the real steps", () => {
  it("reads the branch diff in the job clone, checks the branch out for QA and leaves the user's repository alone", async () => {
    const dir = await demoRepo(box);
    await addBranch(dir, "feature/x", { "src/new.js": "export const n = 1;\n" });
    const before = await userRepoState(dir);
    const rt = new KindRuntime({
      branchReview: { verdict: "pass", risk: "low", findings: [{ severity: "low", text: "Name the constant" }, { severity: "medium", text: "No test", file: "src/new.js" }] },
    });
    const { view, reg, store, id } = await jobOn(box, "review-branch", rt, dir, "feature/x", "Review it");

    expect(view.state).toBe("delivered");
    expect(view.verdict).toBe("pass");
    expect(view.steps.map((s) => s.step)).toEqual(["review", "test", "report"]);
    expect(view.approvals).toEqual([]);

    const qa = rt.inputs.find((i) => i.role === "qa")!;
    expect(qa.prompt).toContain("+export const n = 1;");
    expect(qa.prompt).toMatch(/Branch under review \(data\):\n`{3,}text\nfeature\/x\n`{3,}/);
    // QA works in a checkout of the branch, not in the user's folder.
    const wt = path.join(dataPaths(path.join(box.tmp, "data")).worktrees, id);
    expect(qa.cwd).toBe(wt);
    expect(readFileSync(path.join(wt, "src", "new.js"), "utf8")).toBe("export const n = 1;\n");

    expect(await userRepoState(dir)).toEqual(before);
    expect(existsSync(path.join(dir, "src", "new.js"))).toBe(false);
    expect(buildExport(store, id, Date.now, { isRegisteredProject: (r) => reg.get(r)?.builtin === false }).job.deliverable).toBeUndefined();
  });

  it("a high finding fails the branch even when QA said pass", async () => {
    const dir = await demoRepo(box);
    await addBranch(dir, "feature/x", { "src/new.js": "export const n = 1;\n" });
    const rt = new KindRuntime({ branchReview: { verdict: "pass", risk: "low", findings: [{ severity: "high", text: "Leaks a token" }] } });
    const { view } = await jobOn(box, "review-branch", rt, dir, "feature/x");
    expect(view.verdict).toBe("fail");
  });

  it("fails with a clear reason for a name that is not a branch of the project", async () => {
    const dir = await demoRepo(box);
    await addBranch(dir, "feature/x", { "src/new.js": "x\n" });
    const rt = new KindRuntime();
    const { view, report } = await jobOn(box, "review-branch", rt, dir, "feature/missing");
    expect(view.verdict).toBe("fail");
    expect(report).toContain("'feature/missing' is not a branch of this project");
    expect(rt.inputs.filter((i) => i.role === "qa")).toHaveLength(0);
  });

  it("refuses a branch with a symbolic link before any agent reads it", async () => {
    const dir = await demoRepo(box);
    await git(dir, ["checkout", "--quiet", "-b", "feature/link"]);
    const blob = (await git(dir, ["hash-object", "-w", "--stdin"], { input: "../outside" })).trim();
    await git(dir, ["update-index", "--add", "--cacheinfo", `120000,${blob},shortcut`]);
    await git(dir, ["commit", "--quiet", "-m", "link"], { identity: ENGINE_IDENTITY });
    await git(dir, ["checkout", "--quiet", "main"]);
    const rt = new KindRuntime();
    const { view, report } = await jobOn(box, "review-branch", rt, dir, "feature/link");
    expect(view.verdict).toBe("fail");
    expect(report).toContain("symbolic link: shortcut");
    expect(rt.inputs.filter((i) => i.role === "qa")).toHaveLength(0);
  });

  it("compares with main when the branch under review is the checked-out one", async () => {
    const dir = await demoRepo(box);
    await addBranch(dir, "feature/x", { "src/new.js": "x\n" });
    await git(dir, ["checkout", "--quiet", "feature/x"]);
    const rt = new KindRuntime();
    const { view } = await jobOn(box, "review-branch", rt, dir, "feature/x");
    expect(view.state).toBe("delivered");
    expect(view.verdict).toBe("pass");
    expect(rt.inputs.find((i) => i.role === "qa")!.prompt).toContain("+x");
  });

  it("reviewBranchStep rejects invalid names and a branch without changes", async () => {
    const dir = await demoRepo(box);
    await git(dir, ["branch", "same"]);
    const reg = registryFor(box);
    await reg.register({ path: dir, name: "demo" });
    const rt = new KindRuntime();
    const deps = pipelineDeps(box, box.newStore(), reg, rt);
    const ctx = (taskId: string): StepContext => ({ taskId, repoId: "demo", goal: "g", signal: new AbortController().signal, timeoutMs: 60_000, stepIndex: 0 });
    await expect(reviewBranchStep(deps, ctx("task-1"), { branch: "--output=x" })).rejects.toThrow(/invalid branch name/);
    await expect(reviewBranchStep(deps, ctx("task-2"), { branch: "same" })).rejects.toThrow(/no changes compared with 'main'/);
    expect(rt.inputs).toHaveLength(0);
  });
});

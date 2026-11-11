import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Plan } from "@agentlife/shared";
import type { LimitsConfig } from "../src/config.ts";
import type { ReportInput, StepContext } from "../src/jobs/steps.ts";
import { dataPaths } from "../src/paths.ts";
import type { PipelineDeps } from "../src/steps/deps.ts";
import {
  buildReport,
  codeBlock,
  collectFacts,
  diffStats,
  formatDuration,
  inlineCode,
  oneLine,
  REPORT_DIFF_MAX_LINES,
  reportStep,
  type StepFact,
} from "../src/steps/report.ts";
import { Store } from "../src/store.ts";

const PLAN: Plan = {
  tasks: [
    { id: "t1", title: "Reject empty titles", why: "w", files: ["src/todo.ts", "test/todo.test.ts"], acceptance: "addTodo throws on an empty title", risk: "low" },
    { id: "t2", title: "Test isOverdue", why: "w", files: ["test/todo.test.ts"], acceptance: "covered", risk: "medium" },
  ],
};
const DIFF = [
  "diff --git a/src/todo.ts b/src/todo.ts",
  "--- a/src/todo.ts",
  "+++ b/src/todo.ts",
  "@@ -1,3 +1,6 @@",
  " export function addTodo() {",
  "-  return 1;",
  "+  if (!title.trim()) throw new Error('empty');",
  "+  return 2;",
  " }",
  "",
].join("\n");
const PASSING: ReportInput = {
  goal: "Make the todo helpers safer",
  verdict: "pass",
  plan: PLAN,
  task: PLAN.tasks[0]!,
  diff: DIFF,
  test: { passed: true, exitCode: 0, log: "RUN v5.1.0\n Tests  8 passed | 1 skipped (9)\n" },
  review: { verdict: "pass", notes: ["Covers the empty and whitespace-only cases.", "No unrelated changes."], risk: "low" },
};
const FACTS: StepFact[] = [
  { step: "analyze", status: "ok", durationMs: 21_400, credits: 0.42 },
  { step: "develop", status: "ok", durationMs: 95_000, credits: 1.25 },
  { step: "test", status: "ok", durationMs: 8_200 },
  { step: "review", status: "ok", durationMs: 12_000, credits: 0.3 },
  { step: "report", status: "running" },
];

describe("buildReport", () => {
  it("matches the snapshot for a passing job", () => {
    const r = buildReport(PASSING, FACTS);
    expect(r.title).toBe("Report: Make the todo helpers safer");
    expect(r.markdown).toMatchSnapshot();
  });

  it("matches the snapshot for a failed job with the failure reason and no later steps", () => {
    const r = buildReport(
      { goal: "Add a feature", verdict: "fail", plan: PLAN, task: PLAN.tasks[0]!, failureReason: "diff rejected: protected file: package.json", diff: DIFF },
      [
        { step: "analyze", status: "ok", durationMs: 5000 },
        { step: "develop", status: "failed", durationMs: 40_000 },
        { step: "report", status: "running" },
      ],
    );
    expect(r.markdown).toMatchSnapshot();
    expect(r.markdown).toContain("## Failure");
    expect(r.markdown).toContain("- **Verdict:** FAIL");
    expect(r.markdown).toContain("The tests did not run.");
    expect(r.markdown).toContain("No review was done.");
  });

  it("builds a report from nothing but the goal (job failed in the first step)", () => {
    const r = buildReport({ goal: "g", verdict: "fail", failureReason: "timeout:analyze" });
    expect(r.markdown).toContain("No plan was produced.");
    expect(r.markdown).toContain("No change was produced.");
    expect(r.markdown).toContain("No step data.");
  });

  it("shows the last 60 lines of the test log", () => {
    const log = Array.from({ length: 200 }, (_, i) => `log line ${i}`).join("\n");
    const md = buildReport({ ...PASSING, test: { passed: false, exitCode: 1, log } }).markdown;
    expect(md).toContain("Failed (exit code 1)");
    expect(md).toContain("log line 199");
    expect(md).toContain("log line 140");
    expect(md).not.toContain("log line 139\n");
  });

  it("cuts a long diff at 300 lines with a note", () => {
    const big = ["diff --git a/f b/f", ...Array.from({ length: 1000 }, (_, i) => `+line ${i}`)].join("\n");
    const md = buildReport({ ...PASSING, diff: big }).markdown;
    expect(md).toContain(`+line ${REPORT_DIFF_MAX_LINES - 2}`);
    expect(md).not.toContain(`+line ${REPORT_DIFF_MAX_LINES + 5}\n`);
    expect(md).toContain(`[diff truncated: showing ${REPORT_DIFF_MAX_LINES} of 1001 lines`);
  });

  it("keeps hostile text inert: only code spans and fenced blocks carry it", () => {
    const evil = "<script>alert(1)</script> **bold** [x](http://evil) # heading\n- item\n```\nescaped";
    const md = buildReport(
      {
        goal: evil,
        verdict: "pass",
        plan: { tasks: [{ ...PLAN.tasks[0]!, title: evil, files: [evil], acceptance: evil }] },
        task: { ...PLAN.tasks[0]!, title: evil, acceptance: evil },
        diff: `diff --git a/x b/x\n+${evil}\n ${"```"}\n`,
        test: { passed: true, log: evil },
        review: { verdict: "pass", notes: [evil], risk: "low" },
        failureReason: evil,
      },
      [],
    );
    const outsideFences = stripFences(md.markdown).replace(/`[^`\n]*`/g, "``");
    expect(outsideFences).not.toMatch(/[<>&]|\[x\]|evil/);
    expect(fenceLines(md.markdown) % 2).toBe(0);
    expect(md.title).not.toMatch(/[\r\n]/);
  });

  it("property: any goal, note and log keeps fences balanced and the structure intact", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), fc.string({ maxLength: 300 }), fc.string({ maxLength: 600 }), (goal, note, log) => {
        const r = buildReport({ ...PASSING, goal, review: { verdict: "pass", notes: [note], risk: "low" }, test: { passed: true, log }, diff: `diff --git a/f b/f\n+${note}\n ${log}\n` });
        expect(fenceLines(r.markdown) % 2).toBe(0);
        expect(r.markdown.match(/^## /gm)?.length).toBe(6);
        expect(r.title.length).toBeLessThanOrEqual(200);
        expect(r.title).not.toMatch(/[\r\n]/);
        // The summary stays three or four list lines whatever the goal contains.
        const summary = r.markdown.split("## Summary")[1]!.split("## ")[0]!;
        expect(summary.split("\n").filter((l) => l.startsWith("- ")).length).toBe(4);
      }),
    );
  }, 30_000); // 100 random reports with long strings: the default 5 s ran out on a busy machine
});

/** Lines the mailbox renderer treats as a fence: trimmed start begins with three backticks. */
function fenceLines(md: string): number {
  return md.split("\n").filter((l) => l.trimStart().startsWith("```")).length;
}
function stripFences(md: string): string {
  const out: string[] = [];
  let inside = false;
  for (const l of md.split("\n")) {
    if (l.trimStart().startsWith("```")) inside = !inside;
    else if (!inside) out.push(l);
  }
  return out.join("\n");
}

describe("report helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(250)).toBe("250 ms");
    expect(formatDuration(21_400)).toBe("21.4 s");
    expect(formatDuration(95_000)).toBe("1 min 35 s");
    expect(formatDuration(125_000)).toBe("2 min 05 s");
  });

  it("counts files and changed lines of a patch", () => {
    expect(diffStats(DIFF)).toEqual({ files: 1, added: 2, deleted: 1 });
    expect(diffStats("")).toEqual({ files: 0, added: 0, deleted: 0 });
  });

  it("makes inline text a single code span and fenced text safe", () => {
    expect(inlineCode("a `b`\nc")).toBe("`a 'b' c`");
    expect(inlineCode("  ")).toBe("`(empty)`");
    expect(oneLine("a\r\n\tb")).toBe("a b");
    expect(codeBlock("x\n  ```\ny", "diff")).toBe("```diff\nx\n  \u200b```\ny\n```");
  });
});

// ---- facts from the store ----

const LIMITS: LimitsConfig = { timeoutsMs: { analyze: 1, develop: 1, test: 1, review: 1 }, maxDiffLines: 400, maxFilesChanged: 10 };
let root: string;
let store: Store;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "al-report-"));
  store = new Store({ dbPath: ":memory:", runsDir: path.join(root, "data", "runs") });
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("reportStep", () => {
  it("takes durations from the job's steps and credits from the run logs", async () => {
    const rt = { id: "none", run: (): never => { throw new Error("unused"); } };
    const deps: PipelineDeps = { runtimes: { architect: rt, developer: rt, qa: rt }, store, paths: dataPaths(path.join(root, "data")), repos: [], limits: LIMITS };
    store.appendEvent({ type: "task.created", taskId: "task-1", repoId: "demo", goal: "g", ts: 1000 });
    store.appendEvent({ type: "task.state_changed", taskId: "task-1", state: "analyzing", ts: 2000 });
    store.appendRunLog("task-1", "analyze", { n: 0, kind: "usage", credits: 0.25, tokens: 100 });
    store.appendRunLog("task-1", "analyze", { n: 0, kind: "usage", credits: 0.5 });
    store.appendRunLog("task-1", "analyze", { n: 7, kind: "usage", credits: 99 });
    store.appendEvent({ type: "task.state_changed", taskId: "task-1", state: "awaiting_plan_approval", ts: 5000 });
    store.appendEvent({ type: "task.state_changed", taskId: "task-1", state: "developing", ts: 6000 });
    store.appendEvent({ type: "task.state_changed", taskId: "task-1", state: "testing", ts: 9000 });

    expect(collectFacts(deps, "task-1")).toEqual([
      { step: "analyze", status: "ok", durationMs: 3000, credits: 0.75, tokens: 100 },
      { step: "develop", status: "ok", durationMs: 3000 },
      { step: "test", status: "running" },
    ]);
    const ctx: StepContext = { taskId: "task-1", repoId: "demo", goal: "g", signal: new AbortController().signal, timeoutMs: 1000, stepIndex: 3 };
    const r = await reportStep(deps, ctx, PASSING);
    expect(r.markdown).toContain("- **analyze:** ok, 3.0 s, 0.75 credits");
    expect(r.markdown).toContain("- **test:** running");
    expect(r.markdown).toContain("Total credits: 0.75.");
  });

  it("returns facts for an unknown task as an empty list", () => {
    const rt = { id: "none", run: (): never => { throw new Error("unused"); } };
    const deps: PipelineDeps = { runtimes: { architect: rt, developer: rt, qa: rt }, store, paths: dataPaths(path.join(root, "data")), repos: [], limits: LIMITS };
    expect(collectFacts(deps, "nope")).toEqual([]);
  });
});

describe("Run facts with work numbers", () => {
  it("shows the model, the context peak and the file counts of a step, and leaves out what is unknown", () => {
    const facts: StepFact[] = [
      { step: "develop", status: "ok", durationMs: 22_000, model: "claude-test", contextPeak: 24.4, filesRead: 2, filesEdited: 1 },
      { step: "test", status: "ok", durationMs: 6_000 },
      { step: "review", status: "ok", model: "bad`model", filesRead: 3 },
    ];
    const md = buildReport(PASSING, facts).markdown;
    expect(md).toContain("- **develop:** ok, 22.0 s, `claude-test`, context 24%, 2 read, 1 edited");
    expect(md).toContain("- **test:** ok, 6.0 s\n");
    // A model name is untrusted text: it goes into a code span and cannot close it.
    expect(md).toContain("- **review:** ok, `bad'model`, 3 read, 0 edited");
  });
});

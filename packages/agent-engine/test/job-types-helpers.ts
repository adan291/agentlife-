import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import type { AgentEvent, JobKind, Plan, Review } from "@agentlife/shared";
import { loadConfig } from "../src/config.ts";
import type { Engine } from "../src/engine.ts";
import { git } from "../src/git.ts";
import { JobRunner } from "../src/jobs/runner.ts";
import type { ReportInput, StepContext, Steps } from "../src/jobs/steps.ts";
import { PROJECT_ROOT, dataPaths } from "../src/paths.ts";
import { ProjectRegistry } from "../src/projects/registry.ts";
import type { AgentRuntime, RuntimeEvent, RuntimeInput } from "../src/runtimes/types.ts";
import type { PipelineDeps } from "../src/steps/deps.ts";
import { createPipelineSteps } from "../src/steps/index.ts";
import { Store } from "../src/store.ts";
import { commitAll, makeRepo } from "./helpers.ts";

const FENCE = "```";
export const json = (value: unknown): string => `${FENCE}json\n${JSON.stringify(value)}\n${FENCE}`;

export const PLAN: Plan = { tasks: [{ id: "t1", title: "Do it", why: "because", files: ["docs/a.md"], acceptance: "ok", risk: "low" }] };
export const PASS: Review = { verdict: "pass", notes: ["fine"], risk: "low" };
export const DOC_DIFF = "diff --git a/docs/a.md b/docs/a.md\nnew file mode 100644\n--- /dev/null\n+++ b/docs/a.md\n@@ -0,0 +1 @@\n+hello\n";
export const BRANCH_DIFF = "diff --git a/src/x.js b/src/x.js\n--- a/src/x.js\n+++ b/src/x.js\n@@ -1 +1,2 @@\n+// new\n old\n";
/** A project without a package.json: the test step is skipped, so no Docker is needed. */
export const PROJECT_FILES = { "README.md": "# Demo\n", "src/util.js": "export const add = (a, b) => a + b;\n" };

// ---- a sandbox per test: temp folder, hotel folder, stores and engine that are cleaned up afterwards ----

export interface Sandbox {
  tmp: string;
  hotel: string;
  engine: Engine | undefined;
  stores: Store[];
  /** A memory store whose run logs go to `tmp/data/runs`, closed after the test. */
  newStore(): Store;
}

export function useSandbox(): Sandbox {
  const box: Sandbox = {
    tmp: "",
    hotel: "",
    engine: undefined,
    stores: [],
    newStore() {
      const s = new Store({ dbPath: ":memory:", runsDir: dataPaths(path.join(box.tmp, "data")).runs });
      box.stores.push(s);
      return s;
    },
  };
  beforeEach(() => {
    box.tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "al-jtypes-")));
    box.hotel = path.join(box.tmp, "hotel");
    mkdirSync(box.hotel, { recursive: true });
  });
  afterEach(async () => {
    await box.engine?.close();
    box.engine = undefined;
    for (const s of box.stores.splice(0)) {
      try {
        s.close();
      } catch {
        // already closed by the engine
      }
    }
    rmSync(box.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return box;
}

export function registryFor(box: Sandbox): ProjectRegistry {
  return new ProjectRegistry({
    file: path.join(box.tmp, "data", "projects.json"),
    roots: [box.hotel],
    builtin: [{ id: "haunted-todo", name: "haunted-todo", source: "fixtures/repos/haunted-todo", testCommand: "npm test" }],
    reposDir: path.join(box.tmp, "data", "repos"),
    agentlifeRoot: PROJECT_ROOT,
    secrets: [],
  });
}

// ---- scripted steps (no git, no agents) ----

export interface Seen {
  calls: string[];
  ctxs: Record<string, StepContext[]>;
  /** For each review call: whether the test result it was given was the "not part of this job" placeholder. */
  reviewTests: boolean[];
}

/** Steps that record their calls. `report` decides what the report looks like. */
export function scripted(
  over: Partial<Steps> = {},
  report: (input: ReportInput) => { title: string; markdown: string } = () => ({ title: "Report", markdown: "# Report" }),
): { steps: Steps; seen: Seen } {
  const seen: Seen = { calls: [], ctxs: {}, reviewTests: [] };
  const see = (name: string, ctx: StepContext): void => {
    seen.calls.push(name);
    (seen.ctxs[name] ??= []).push(ctx);
  };
  const steps: Steps = {
    analyze: async (c) => (see("analyze", c), PLAN),
    develop: async (c) => (see("develop", c), { diff: DOC_DIFF }),
    test: async (c) => (see("test", c), { passed: true, log: "ok" }),
    review: async (c, input) => (see("review", c), seen.reviewTests.push(input.test.skipped === true), PASS),
    reviewBranch: async (c) => (
      see("reviewBranch", c),
      { review: { verdict: "pass", risk: "low", findings: [{ severity: "low", text: "nit" }] }, diff: BRANCH_DIFF, base: "main" }
    ),
    report: async (c, input) => (see("report", c), report(input)),
    ...over,
  };
  return { steps, seen };
}

export const LIMITS = { timeoutsMs: { analyze: 2000, develop: 2000, test: 2000, review: 2000 }, maxDiffLines: 400, maxFilesChanged: 10 };

/** A runner over `steps` that approves every plan at once. */
export function runnerFor(box: Sandbox, steps: Steps): { store: Store; runner: JobRunner } {
  const store = box.newStore();
  const runner = new JobRunner({ store, steps, limits: LIMITS, reportTimeoutMs: 2000 });
  store.bus.on("event", (ev: AgentEvent) => {
    if (ev.type === "approval.requested") queueMicrotask(() => runner.resolveApproval(ev.approvalId, "approve"));
  });
  return { store, runner };
}

export const states = (store: Store, id: string): string[] => store.eventsFor(id).flatMap((e) => (e.type === "task.state_changed" ? [e.state] : []));

export function reportOf(store: Store, id: string): string {
  const ev = store.eventsFor(id).find((e) => e.type === "report.ready");
  if (ev?.type !== "report.ready") throw new Error("no report");
  return ev.markdown;
}

// ---- real steps over a scripted agent, on real git repositories ----

export interface KindRuntimeOptions {
  /** Files the Developer writes (relative path to content). */
  writes?: Record<string, string>;
  /** What QA answers for a branch review. */
  branchReview?: unknown;
}

/** One scripted runtime for all roles. It records every input, so tests can read the prompts and the working directories. */
export class KindRuntime implements AgentRuntime {
  readonly id = "kind";
  readonly inputs: RuntimeInput[] = [];
  private readonly opts: KindRuntimeOptions;
  constructor(opts: KindRuntimeOptions = {}) {
    this.opts = opts;
  }
  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    this.inputs.push(input);
    if (input.role === "architect") {
      yield { kind: "output", text: json(PLAN) };
    } else if (input.role === "developer") {
      for (const [rel, content] of Object.entries(this.opts.writes ?? {})) {
        const full = path.join(input.cwd, ...rel.split("/"));
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
      yield { kind: "output", text: "Done." };
    } else if (input.prompt.includes("Review a branch")) {
      yield { kind: "output", text: json(this.opts.branchReview ?? { verdict: "pass", risk: "low", findings: [] }) };
    } else {
      yield { kind: "output", text: json({ verdict: "pass", notes: ["Looks fine."], risk: "low" }) };
    }
  }
}

export function pipelineDeps(box: Sandbox, store: Store, reg: ProjectRegistry, runtime: AgentRuntime): PipelineDeps {
  const config = loadConfig();
  return {
    runtimes: { architect: runtime, developer: runtime, qa: runtime },
    store,
    paths: dataPaths(path.join(box.tmp, "data")),
    repos: config.repos,
    projects: reg,
    limits: config.limits,
  };
}

export function realSteps(box: Sandbox, store: Store, reg: ProjectRegistry, runtime: AgentRuntime): Steps {
  return createPipelineSteps(pipelineDeps(box, store, reg, runtime));
}

/** A user repository `hotel/demo` with the project files. */
export function demoRepo(box: Sandbox): Promise<string> {
  return makeRepo(path.join(box.hotel, "demo"), PROJECT_FILES);
}

/** A new branch with the given files, committed; the repository is left on `main` again. */
export async function addBranch(dir: string, name: string, files: Record<string, string>, from = "main"): Promise<void> {
  await git(dir, ["checkout", "--quiet", from]);
  await git(dir, ["checkout", "--quiet", "-b", name]);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split("/"));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  await commitAll(dir, `work on ${name}`);
  await git(dir, ["checkout", "--quiet", "main"]);
}

/** What a job must leave alone in the user's repository. */
export async function userRepoState(dir: string) {
  return {
    head: (await git(dir, ["rev-parse", "HEAD"])).trim(),
    branch: (await git(dir, ["symbolic-ref", "--short", "HEAD"])).trim(),
    status: await git(dir, ["status", "--porcelain", "--untracked-files=all"]),
    refs: (await git(dir, ["for-each-ref", "--format=%(refname) %(objectname)"])).trim().split("\n").filter(Boolean),
    worktrees: await git(dir, ["worktree", "list", "--porcelain"]),
  };
}

/** Registers `dir` as project `demo`, runs one job of `kind` through the real steps (plans are approved at once) and waits. */
export async function jobOn(box: Sandbox, kind: JobKind, runtime: KindRuntime, dir: string, target: string, goal = "Do the thing") {
  const reg = registryFor(box);
  await reg.register({ path: dir, name: "demo" });
  const store = box.newStore();
  const runner = new JobRunner({ store, steps: realSteps(box, store, reg, runtime), limits: loadConfig().limits });
  store.bus.on("event", (ev: AgentEvent) => {
    if (ev.type === "approval.requested") setTimeout(() => runner.resolveApproval(ev.approvalId, "approve"), 0);
  });
  const id = runner.start("demo", goal, { kind, target });
  await runner.done(id);
  return { reg, store, id, view: store.getJob(id)!, report: reportOf(store, id) };
}

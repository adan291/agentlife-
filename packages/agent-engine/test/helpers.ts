import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { ENGINE_IDENTITY, git } from "../src/git.ts";
import { JobRunner } from "../src/jobs/runner.ts";
import { dataPaths } from "../src/paths.ts";
import type { ProjectRegistry } from "../src/projects/registry.ts";
import type { AgentRuntime, RuntimeEvent, RuntimeInput } from "../src/runtimes/types.ts";
import type { PipelineDeps } from "../src/steps/deps.ts";
import { createPipelineSteps } from "../src/steps/index.ts";
import { Store } from "../src/store.ts";

/** Fake secrets are built at runtime so that no key-shaped literal sits in the repository. */
export const fakeKiroKey = (): string => ["ksk", "_", "q1W2e3R4t5Y6u7I8o9P0"].join("");

export interface MakeRepoOptions {
  /** Default true. `false` leaves an empty repository. */
  commit?: boolean;
  branch?: string;
}

/** A real git repository with the given files, committed by a fixed identity. Returns its directory. */
export async function makeRepo(dir: string, files: Record<string, string>, opts: MakeRepoOptions = {}): Promise<string> {
  mkdirSync(dir, { recursive: true });
  await git(dir, ["init", "--quiet", `--initial-branch=${opts.branch ?? "main"}`, "--template="], { identity: ENGINE_IDENTITY });
  await git(dir, ["config", "core.autocrlf", "false"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  if (opts.commit !== false) await commitAll(dir, "first commit");
  return dir;
}

export async function commitAll(dir: string, message: string): Promise<string> {
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "--quiet", "--allow-empty", "-m", message], { identity: ENGINE_IDENTITY, date: "2026-02-02T00:00:00Z" });
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}

/** A small Node project with a lockfile, so it is detected as `node-npm`. */
export const NODE_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "demo", version: "1.0.0", scripts: { test: "node test.js" } }, null, 2),
  "package-lock.json": JSON.stringify({ name: "demo", lockfileVersion: 3, packages: {} }, null, 2),
  "index.js": "module.exports = 1;\n",
  "test.js": "process.exit(0);\n",
};

const FENCE = "```";
const json = (value: unknown): string => `${FENCE}json\n${JSON.stringify(value)}\n${FENCE}`;

export const SCRIPTED_PLAN = {
  tasks: [{ id: "t1", title: "Improve the readme", why: "It is short.", files: ["README.md"], acceptance: "README.md says more", risk: "low" }],
};

/** Architect, Developer and QA in one scripted runtime: a plan, an edit of README.md, a passing review. */
export class ScriptedRuntime implements AgentRuntime {
  readonly id = "scripted";
  readonly inputs: RuntimeInput[] = [];
  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    this.inputs.push(input);
    if (input.role === "architect") {
      yield { kind: "output", text: json(SCRIPTED_PLAN) };
    } else if (input.role === "developer") {
      writeFileSync(path.join(input.cwd, "README.md"), "# Demo\n\nA longer readme.\n");
      yield { kind: "output", text: "Done." };
    } else {
      yield { kind: "output", text: json({ verdict: "pass", notes: ["Looks fine."], risk: "low" }) };
    }
  }
}

export interface JobHarness {
  store: Store;
  runner: JobRunner;
  deps: PipelineDeps;
  runtime: ScriptedRuntime;
  dataDir: string;
  close(): void;
}

/** The real pipeline steps over scripted agents, a memory store and a runner, rooted in `tmp/data`. */
export function jobHarness(tmp: string, projects: ProjectRegistry): JobHarness {
  const config = loadConfig();
  const dataDir = path.join(tmp, "data");
  const paths = dataPaths(dataDir);
  const store = new Store({ dbPath: ":memory:", runsDir: paths.runs });
  const runtime = new ScriptedRuntime();
  const deps: PipelineDeps = {
    runtimes: { architect: runtime, developer: runtime, qa: runtime },
    store,
    paths,
    repos: config.repos,
    projects,
    limits: config.limits,
  };
  const runner = new JobRunner({ store, steps: createPipelineSteps(deps), limits: config.limits });
  return { store, runner, deps, runtime, dataDir, close: () => store.close() };
}

/** Starts a job, approves its plan as soon as it asks, and resolves with the task id once the job has settled. */
export async function runJob(h: JobHarness, repoId: string, goal = "Make the readme longer"): Promise<string> {
  const onEvent = (ev: { type: string; approvalId?: string }): void => {
    if (ev.type === "approval.requested" && ev.approvalId) {
      const id = ev.approvalId;
      setTimeout(() => h.runner.resolveApproval(id, "approve"), 0);
    }
  };
  h.store.bus.on("event", onEvent);
  try {
    const taskId = h.runner.start(repoId, goal);
    await h.runner.done(taskId);
    return taskId;
  } finally {
    h.store.bus.off("event", onEvent);
  }
}

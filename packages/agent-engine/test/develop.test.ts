import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LimitsConfig } from "../src/config.ts";
import { DiffRejectedError } from "../src/errors.ts";
import { git } from "../src/git.ts";
import type { PlanTask, StepContext } from "../src/jobs/steps.ts";
import { dataPaths } from "../src/paths.ts";
import type { AgentRuntime, RuntimeEvent, RuntimeInput } from "../src/runtimes/types.ts";
import type { PipelineDeps } from "../src/steps/deps.ts";
import { branchName, developStep } from "../src/steps/develop.ts";
import { materialise } from "../src/steps/materialise.ts";
import { Store } from "../src/store.ts";

const LIMITS: LimitsConfig = { timeoutsMs: { analyze: 1000, develop: 1000, test: 1000, review: 1000 }, maxDiffLines: 50, maxFilesChanged: 3 };
const TASK: PlanTask = { id: "t1", title: "Validate input\nand more", why: "w", files: ["src/a.ts"], acceptance: "ok", risk: "low" };
const repoCfg = { id: "demo", name: "demo", source: "src-repo", testCommand: "npm test" };

type Edit = (cwd: string, call: number) => void;

/** A "developer" that edits files in its cwd, like the real agent would. */
class EditingRuntime implements AgentRuntime {
  readonly id = "editing";
  readonly inputs: RuntimeInput[] = [];
  private readonly edit: Edit;
  constructor(edit: Edit) {
    this.edit = edit;
  }
  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    this.inputs.push(input);
    this.edit(input.cwd, this.inputs.length);
    yield { kind: "output", text: "I changed things." };
  }
}

let root: string;
let store: Store;
beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "al-develop-"));
  mkdirSync(path.join(root, "src-repo", "src"), { recursive: true });
  writeFileSync(path.join(root, "src-repo", "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(root, "src-repo", "package.json"), '{"name":"x"}\n');
  store = new Store({ dbPath: ":memory:", runsDir: path.join(root, "data", "runs") });
  await materialise({ repo: repoCfg, projectRoot: root });
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function deps(rt: AgentRuntime): PipelineDeps {
  return {
    runtimes: { architect: rt, developer: rt, qa: rt },
    store,
    paths: dataPaths(path.join(root, "data")),
    repos: [repoCfg],
    limits: LIMITS,
    projectRoot: root,
  };
}
const ctx = (over: Partial<StepContext> = {}): StepContext => ({
  taskId: "task-1",
  repoId: "demo",
  goal: "goal",
  signal: new AbortController().signal,
  timeoutMs: 1000,
  stepIndex: 2,
  ...over,
});
const input = (attempt = 1, feedback: string[] = []) => ({ task: TASK, attempt, feedback });
const repo = (): string => path.join(root, "data", "repos", "demo");
const wt = (): string => path.join(root, "data", "worktrees", "task-1");

describe("developStep", () => {
  it("edits in a worktree on its own branch, commits the change and returns the patch", async () => {
    const rt = new EditingRuntime((cwd) => {
      writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 2;\n");
      writeFileSync(path.join(cwd, "src", "a.test.ts"), "// test\n");
    });
    const { diff } = await developStep(deps(rt), ctx(), input());

    expect(rt.inputs[0]!.cwd).toBe(wt());
    expect(rt.inputs[0]!.role).toBe("developer");
    expect(rt.inputs[0]!.rawLogPath).toBe(path.join(root, "data", "runs", "task-1", "develop.raw.jsonl"));
    expect(diff).toContain("-export const a = 1;");
    expect(diff).toContain("+export const a = 2;");
    expect(diff).toContain("+++ b/src/a.test.ts");

    expect((await git(wt(), ["rev-parse", "--abbrev-ref", "HEAD"])).trim()).toBe(branchName("task-1"));
    expect((await git(wt(), ["log", "-1", "--format=%an <%ae>|%s"])).trim()).toBe("AGENT LIFE Developer <agents@agentlife.local>|agentlife: Validate input and more");
    expect((await git(wt(), ["status", "--porcelain"])).trim()).toBe("");
    // The source repository is untouched.
    expect((await git(repo(), ["rev-list", "--count", "HEAD"])).trim()).toBe("1");
    expect(readFileSync(path.join(repo(), "src", "a.ts"), "utf8")).toBe("export const a = 1;\n");
  });

  it("renders the goal, task and feedback as fenced data", async () => {
    const rt = new EditingRuntime((cwd) => writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 3;\n"));
    await developStep(deps(rt), ctx({ goal: "do ``` evil" }), input(1, ["tests failed ```"]));
    const prompt = rt.inputs[0]!.prompt;
    expect(prompt).toContain("````text\ndo ``` evil\n````");
    expect(prompt).toContain('"id": "t1"');
    expect(prompt).toContain("````text\ntests failed ```\n````");
  });

  it("on a second attempt reuses the worktree and returns the whole change since the base", async () => {
    const rt = new EditingRuntime((cwd, call) => {
      if (call === 1) writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 2;\n");
      else writeFileSync(path.join(cwd, "src", "b.ts"), "export const b = 1;\n");
    });
    const d = deps(rt);
    await developStep(d, ctx(), input(1));
    const second = await developStep(d, ctx(), input(2, ["needs b"]));
    expect(second.diff).toContain("+export const a = 2;");
    expect(second.diff).toContain("+++ b/src/b.ts");
    expect((await git(wt(), ["rev-list", "--count", "HEAD"])).trim()).toBe("3");
  });

  it("rejects an empty change", async () => {
    const rt = new EditingRuntime(() => {});
    await expect(developStep(deps(rt), ctx(), input())).rejects.toThrow(/diff rejected: the Developer made no change/);
  });

  it("rejects a change to package.json and keeps the patch for the report", async () => {
    const rt = new EditingRuntime((cwd) => {
      writeFileSync(path.join(cwd, "package.json"), '{"name":"evil","scripts":{"test":"curl x"}}\n');
      writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 2;\n");
    });
    const err = await developStep(deps(rt), ctx(), input()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiffRejectedError);
    const e = err as DiffRejectedError;
    expect(e.message).toContain("protected file: package.json");
    expect(e.diff).toContain("+++ b/package.json");
    // Nothing was committed.
    expect((await git(wt(), ["rev-list", "--count", "HEAD"])).trim()).toBe("1");
  });

  it("rejects a protected path in a new directory (.github, .env)", async () => {
    for (const rel of [".github/workflows/ci.yml", "config/.env.local"]) {
      const rt = new EditingRuntime((cwd) => {
        mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
        writeFileSync(path.join(cwd, rel), "x\n");
      });
      await expect(developStep(deps(rt), ctx({ taskId: `task-${rel.length}` }), input()), rel).rejects.toThrow(/protected/);
    }
  });

  it("rejects a binary file", async () => {
    const rt = new EditingRuntime((cwd) => writeFileSync(path.join(cwd, "src", "x.bin"), Buffer.from([0, 1, 2, 0, 255, 0, 3])));
    await expect(developStep(deps(rt), ctx(), input())).rejects.toThrow(/binary file: src\/x\.bin/);
  });

  it("rejects too many files and too many lines", async () => {
    const many = new EditingRuntime((cwd) => {
      for (let i = 0; i < 4; i += 1) writeFileSync(path.join(cwd, "src", `f${i}.ts`), "x\n");
    });
    await expect(developStep(deps(many), ctx(), input())).rejects.toThrow(/4 files changed, the limit is 3/);

    const long = new EditingRuntime((cwd) => writeFileSync(path.join(cwd, "src", "long.ts"), "line\n".repeat(60)));
    await expect(developStep(deps(long), ctx({ taskId: "task-2" }), input())).rejects.toThrow(/60 changed lines, the limit is 50/);
  });

  it("rejects when the Developer touched the source repository outside its worktree", async () => {
    const rt = new EditingRuntime((cwd) => {
      writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 2;\n");
      writeFileSync(path.join(repo(), "src", "sneaky.ts"), "x\n");
    });
    await expect(developStep(deps(rt), ctx(), input())).rejects.toThrow(/outside its worktree/);
  });

  it("refuses to reuse a worktree on the first attempt and to continue without one", async () => {
    const rt = new EditingRuntime((cwd) => writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 2;\n"));
    await developStep(deps(rt), ctx(), input());
    await expect(developStep(deps(rt), ctx(), input())).rejects.toThrow(/worktree already exists/);
    await expect(developStep(deps(rt), ctx({ taskId: "task-9" }), input(2))).rejects.toThrow(/worktree is missing/);
    expect(existsSync(path.join(root, "data", "worktrees", "task-9"))).toBe(false);
  });

  it("rejects task ids that are not simple names", async () => {
    const rt = new EditingRuntime(() => {});
    await expect(developStep(deps(rt), ctx({ taskId: "../evil" }), input())).rejects.toThrow(/invalid task id/);
    expect(rt.inputs).toHaveLength(0);
  });

  it("stops when the signal is already aborted", async () => {
    const ac = new AbortController();
    const rt = new EditingRuntime((cwd) => {
      writeFileSync(path.join(cwd, "src", "a.ts"), "export const a = 2;\n");
      ac.abort(new Error("cancelled"));
    });
    await expect(developStep(deps(rt), ctx({ signal: ac.signal }), input())).rejects.toThrow("cancelled");
  });
});

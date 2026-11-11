import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildExport } from "../src/http/export.ts";
import { ENGINE_IDENTITY, git } from "../src/git.ts";
import type { StepContext } from "../src/jobs/steps.ts";
import { PROJECT_ROOT } from "../src/paths.ts";
import { ProjectRegistry, ProjectUnavailableError } from "../src/projects/registry.ts";
import { analyzeStep } from "../src/steps/analyze.ts";
import { MaterialiseError, cloneProject } from "../src/steps/materialise.ts";
import { buildReport, reportStep } from "../src/steps/report.ts";
import { testStatusText } from "../src/steps/review.ts";
import { NO_TESTS_LOG, testStep, type DockerExec, type DockerRunResult } from "../src/steps/test.ts";
import { runnerImageTag } from "../src/steps/runner-image.ts";
import { NODE_FILES, commitAll, jobHarness, makeRepo, runJob, type JobHarness } from "./helpers.ts";

let tmp: string;
let hotel: string;
let harness: JobHarness | undefined;

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "al-pjobs-")));
  hotel = path.join(tmp, "hotel");
  mkdirSync(hotel, { recursive: true });
});
afterEach(() => {
  harness?.close();
  harness = undefined;
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function registry(): ProjectRegistry {
  return new ProjectRegistry({
    file: path.join(tmp, "data", "projects.json"),
    roots: [hotel],
    builtin: [{ id: "haunted-todo", name: "haunted-todo", source: "fixtures/repos/haunted-todo", testCommand: "npm test" }],
    reposDir: path.join(tmp, "data", "repos"),
    agentlifeRoot: PROJECT_ROOT,
    secrets: [],
  });
}

const ctx = (over: Partial<StepContext> = {}): StepContext => ({
  taskId: "task-1",
  repoId: "demo",
  goal: "g",
  signal: new AbortController().signal,
  timeoutMs: 60_000,
  stepIndex: 0,
  ...over,
});
const clone = (id = "demo"): string => path.join(tmp, "data", "repos", id);

describe("cloneProject", () => {
  it("clones the committed HEAD of the current branch and leaves the user's repository as it was", async () => {
    const dir = await makeRepo(path.join(hotel, "demo"), { "a.txt": "one\n", "README.md": "readme\n" }, { branch: "trunk" });
    const head = (await git(dir, ["rev-parse", "HEAD"])).trim();
    writeFileSync(path.join(dir, "a.txt"), "uncommitted edit\n");
    writeFileSync(path.join(dir, "untracked.txt"), "x");
    const before = await git(dir, ["status", "--porcelain"]);

    const out = await cloneProject({ id: "demo", sourcePath: dir, dataDir: path.join(tmp, "data") });
    expect(out).toMatchObject({ repoId: "demo", dir: clone(), commit: head, branch: "trunk" });
    expect(readFileSync(path.join(clone(), "a.txt"), "utf8")).toBe("one\n");
    expect(existsSync(path.join(clone(), "untracked.txt"))).toBe(false);
    expect((await git(clone(), ["rev-parse", "--abbrev-ref", "HEAD"])).trim()).toBe("trunk");
    expect((await git(clone(), ["remote"])).trim()).toBe("");
    expect(existsSync(path.join(clone(), ".git", "hooks", "pre-commit"))).toBe(false);

    expect((await git(dir, ["rev-parse", "HEAD"])).trim()).toBe(head);
    expect(await git(dir, ["status", "--porcelain"])).toBe(before);
    expect(readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("uncommitted edit\n");
  });

  it("replaces a previous clone, so the next job starts from the user's newest commit", async () => {
    const dir = await makeRepo(path.join(hotel, "demo"), { "a.txt": "one\n" });
    await cloneProject({ id: "demo", sourcePath: dir, dataDir: path.join(tmp, "data") });
    writeFileSync(path.join(clone(), "junk.txt"), "junk");
    writeFileSync(path.join(dir, "a.txt"), "two\n");
    const second = await commitAll(dir, "second");
    const out = await cloneProject({ id: "demo", sourcePath: dir, dataDir: path.join(tmp, "data") });
    expect(out.commit).toBe(second);
    expect(existsSync(path.join(clone(), "junk.txt"))).toBe(false);
    expect(readFileSync(path.join(clone(), "a.txt"), "utf8")).toBe("two\n");
  });

  it("refuses a symbolic link or a reserved agent file and removes the clone it made", async () => {
    const link = await makeRepo(path.join(hotel, "link"), { "a.txt": "a\n" });
    const blob = (await git(link, ["hash-object", "-w", "--stdin"], { input: "a.txt" })).trim();
    await git(link, ["update-index", "--add", "--cacheinfo", `120000,${blob},shortcut`]);
    await git(link, ["commit", "--quiet", "-m", "add link"], { identity: ENGINE_IDENTITY }); // not `add -A`: the link is only in the index
    await expect(cloneProject({ id: "link", sourcePath: link, dataDir: path.join(tmp, "data") })).rejects.toThrow(/symbolic link: shortcut/);
    expect(existsSync(clone("link"))).toBe(false);

    const agents = await makeRepo(path.join(hotel, "agents"), { ".kiro/agents/agentlife-qa.json": "{}" });
    await expect(cloneProject({ id: "agents", sourcePath: agents, dataDir: path.join(tmp, "data") })).rejects.toThrow(/reserved agent file/);
    expect(existsSync(clone("agents"))).toBe(false);
  });

  it("refuses a repository without a branch or an unsafe id", async () => {
    const dir = await makeRepo(path.join(hotel, "detached"), { "a.txt": "a\n" });
    await git(dir, ["checkout", "--quiet", "--detach"]);
    await expect(cloneProject({ id: "detached", sourcePath: dir, dataDir: path.join(tmp, "data") })).rejects.toBeInstanceOf(MaterialiseError);
    await expect(cloneProject({ id: "../x", sourcePath: dir, dataDir: path.join(tmp, "data") })).rejects.toThrow(/invalid repo id/);
  });
});

describe("analyzeStep on a registered project", () => {
  it("runs the Architect in the job clone and checks the folder again first", async () => {
    const dir = await makeRepo(path.join(hotel, "demo"), { "README.md": "# Demo\n" });
    const reg = registry();
    await reg.register({ path: dir, name: "demo" });
    harness = jobHarness(tmp, reg);

    const plan = await analyzeStep(harness.deps, ctx());
    expect(plan.tasks).toHaveLength(1);
    expect(harness.runtime.inputs[0]!.cwd).toBe(clone());
    expect((await git(clone(), ["rev-parse", "HEAD"])).trim()).toBe((await git(dir, ["rev-parse", "HEAD"])).trim());

    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await expect(analyzeStep(harness.deps, ctx({ taskId: "task-2" }))).rejects.toBeInstanceOf(ProjectUnavailableError);
  });

  it("fails for a project that is neither registered nor built in", async () => {
    harness = jobHarness(tmp, registry());
    await expect(analyzeStep(harness.deps, ctx({ repoId: "nope" }))).rejects.toThrow(/unknown repo/);
  });
});

describe("a whole job on a project without tests", () => {
  it("skips the test step, says so in the report and never shows the project's path", async () => {
    const dir = await makeRepo(path.join(hotel, "demo"), { "README.md": "# Demo\n" });
    const reg = registry();
    await reg.register({ path: dir, name: "demo" });
    harness = jobHarness(tmp, reg);

    const taskId = await runJob(harness, "demo");
    const exp = buildExport(harness.store, taskId);
    expect(exp.job.state).toBe("delivered");
    expect(exp.job.verdict).toBe("pass");

    const report = exp.events.find((e) => e.type === "report.ready");
    if (report?.type !== "report.ready") throw new Error("no report");
    const short = (await git(dir, ["rev-parse", "--short=7", "HEAD"])).trim();
    expect(report.markdown).toContain(`Based on commit \`${short}\` of \`main\``);
    expect(report.markdown).toContain("**Verdict:** PASS (without tests)");
    expect(report.markdown).toContain("Not run (no supported test setup)");
    const testLog = exp.artifacts.find((a) => a.kind === "test_log");
    expect(testLog?.content).toBe(NO_TESTS_LOG);

    // Requirement 2.2: the path of the project is in none of the things a client or an export can see.
    const everything = JSON.stringify(exp);
    expect(everything).not.toContain(dir);
    expect(everything).not.toContain(dir.replaceAll("\\", "/"));
    expect(everything).not.toContain(path.basename(hotel) + path.sep + "demo");
    expect(JSON.stringify(reg.list())).not.toContain(dir);

    // The user's repository is as the user left it.
    expect((await git(dir, ["status", "--porcelain"])).trim()).toBe("");
    expect(readFileSync(path.join(dir, "README.md"), "utf8")).toBe("# Demo\n");
    expect((await git(dir, ["rev-list", "--count", "HEAD"])).trim()).toBe("1");
  });
});

describe("report and QA text for a project without tests", () => {
  it("reports PASS (without tests) and 'Not run'", () => {
    const md = buildReport({
      goal: "g",
      verdict: "pass",
      test: { passed: true, skipped: true, log: NO_TESTS_LOG },
      basedOn: { commit: "abc1234", branch: "feature/x" },
    }).markdown;
    expect(md).toContain("**Verdict:** PASS (without tests)");
    expect(md).toContain("Not run (no supported test setup)");
    expect(md).toContain("Based on commit `abc1234` of `feature/x`");
    expect(md).not.toContain("Last lines of the log");
  });

  it("tells QA that nothing ran", () => {
    expect(testStatusText({ passed: true, skipped: true, log: NO_TESTS_LOG })).toMatch(/^NOT RUN/);
    expect(readFileSync(path.join(PROJECT_ROOT, "packages", "agent-engine", "prompts", "qa.md"), "utf8")).toContain("NOT RUN");
  });

  it("does not add a 'Based on' line for the built-in fixture", async () => {
    harness = jobHarness(tmp, registry());
    const out = await reportStep(harness.deps, ctx({ repoId: "haunted-todo" }), { goal: "g", verdict: "fail" });
    expect(out.markdown).not.toContain("Based on commit");
  });
});

describe("testStep on a registered project", () => {
  type Call = readonly string[];
  function scripted(opts: { imagePresent: boolean; runCode?: number }) {
    const calls: Call[] = [];
    const exec: DockerExec = async (args): Promise<DockerRunResult> => {
      calls.push(args);
      switch (args[0]) {
        case "version":
          return { code: 0, output: "29.4.0" };
        case "image":
          return { code: opts.imagePresent ? 0 : 1, output: "" };
        case "build":
          return { code: 0, output: "built" };
        case "run":
          return { code: opts.runCode ?? 0, output: "Tests  3 passed" };
        default:
          return { code: 0, output: "" };
      }
    };
    return { exec, calls };
  }

  async function setup(files: Record<string, string>): Promise<{ lock: string }> {
    const dir = await makeRepo(path.join(hotel, "demo"), files);
    const reg = registry();
    await reg.register({ path: dir, name: "demo", testCommand: "npm run check" });
    harness = jobHarness(tmp, reg);
    await cloneProject({ id: "demo", sourcePath: dir, dataDir: path.join(tmp, "data") });
    mkdirSync(path.join(tmp, "data", "worktrees", "task-1"), { recursive: true });
    return { lock: files["package-lock.json"] ?? "" };
  }

  it("does nothing, and does not need Docker, when the project has no supported test setup", async () => {
    await setup({ "README.md": "hi\n" });
    const { exec, calls } = scripted({ imagePresent: true });
    expect(await testStep(harness!.deps, ctx(), exec)).toEqual({ passed: true, skipped: true, log: NO_TESTS_LOG });
    expect(calls).toHaveLength(0);
  });

  it("builds the project's image from its lockfile when it is missing, then runs the tests in it", async () => {
    const { lock } = await setup(NODE_FILES);
    const { exec, calls } = scripted({ imagePresent: false });
    const result = await testStep(harness!.deps, ctx(), exec);
    expect(result).toMatchObject({ passed: true, exitCode: 0 });

    const tag = runnerImageTag("demo", lock);
    expect(tag).toMatch(/^agentlife-runner-demo:[0-9a-f]{12}$/);
    expect(calls.map((c) => c[0])).toEqual(["version", "image", "build", "run"]);
    expect(calls[1]).toContain(tag);
    expect(calls[2]).toEqual(["build", "--tag", tag, expect.any(String)]);
    const run = calls[3]!;
    expect(run).toContain(tag);
    // The sandbox flags are the same as for the fixture, and the command is the one registered with the project.
    for (const flag of ["--read-only", "--cap-drop"]) expect(run).toContain(flag);
    expect(run[run.indexOf("--network") + 1]).toBe("none");
    expect(run[run.length - 1]).toMatch(/&& npm run check$/);
  });

  it("reuses the image while the lockfile is unchanged and uses a new tag when it changes", async () => {
    const { lock } = await setup(NODE_FILES);
    const { exec, calls } = scripted({ imagePresent: true });
    await testStep(harness!.deps, ctx(), exec);
    expect(calls.map((c) => c[0])).toEqual(["version", "image", "run"]);
    expect(runnerImageTag("demo", lock)).toBe(runnerImageTag("demo", lock));
    expect(runnerImageTag("demo", lock + " ")).not.toBe(runnerImageTag("demo", lock));
  });

  it("reports failing tests as a result and a failed build as an error", async () => {
    await setup(NODE_FILES);
    expect(await testStep(harness!.deps, ctx(), scripted({ imagePresent: true, runCode: 1 }).exec)).toMatchObject({ passed: false, exitCode: 1 });
    const failing: DockerExec = async (args) => {
      if (args[0] === "build") return { code: 1, output: "npm ERR! network\nfailed" };
      return { code: args[0] === "image" ? 1 : 0, output: "" };
    };
    await expect(testStep(harness!.deps, ctx(), failing)).rejects.toThrow(/runner_image_build_failed/);
  });
});

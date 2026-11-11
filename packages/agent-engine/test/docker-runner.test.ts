import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LimitsConfig } from "../src/config.ts";
import { StepTimeoutError } from "../src/errors.ts";
import type { StepContext } from "../src/jobs/steps.ts";
import { dataPaths, PROJECT_ROOT } from "../src/paths.ts";
import type { PipelineDeps } from "../src/steps/deps.ts";
import { materialise } from "../src/steps/materialise.ts";
import {
  buildRunArgs,
  containerName,
  defaultDockerExec,
  DockerUnavailableError,
  MAX_TEST_LOG_BYTES,
  RUNNER_IMAGE,
  testStep,
  truncateLog,
  type DockerExec,
  type DockerRunResult,
} from "../src/steps/test.ts";
import { Store } from "../src/store.ts";

const LIMITS: LimitsConfig = { timeoutsMs: { analyze: 1000, develop: 1000, test: 1000, review: 1000 }, maxDiffLines: 400, maxFilesChanged: 10 };
const repoCfg = { id: "demo", name: "demo", source: "src-repo", testCommand: "npm test" };

let root: string;
let store: Store;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "al-docker-"));
  store = new Store({ dbPath: ":memory:", runsDir: path.join(root, "data", "runs") });
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function deps(testCommand = "npm test"): PipelineDeps {
  const rt = { id: "none", run: (): never => { throw new Error("not used"); } };
  return {
    runtimes: { architect: rt, developer: rt, qa: rt },
    store,
    paths: dataPaths(path.join(root, "data")),
    repos: [{ ...repoCfg, testCommand }],
    limits: LIMITS,
    projectRoot: root,
  };
}
const ctx = (over: Partial<StepContext> = {}): StepContext => ({
  taskId: "task-1",
  repoId: "demo",
  goal: "g",
  signal: new AbortController().signal,
  timeoutMs: 5000,
  stepIndex: 3,
  ...over,
});
const wt = (): string => path.join(root, "data", "worktrees", "task-1");
function makeWorktree(): void {
  mkdirSync(wt(), { recursive: true });
}

type Call = readonly string[];
/** A scripted docker: answers `version`, `image inspect`, `run` and `kill` from the given results. */
function scripted(results: { version?: DockerRunResult; image?: DockerRunResult; run?: DockerRunResult | "hang" } = {}) {
  const calls: Call[] = [];
  const exec: DockerExec = async (args, opts) => {
    calls.push(args);
    const cmd = args[0];
    if (cmd === "version") return results.version ?? { code: 0, output: "29.4.0\n" };
    if (cmd === "image") return results.image ?? { code: 0, output: "sha256:abc\n" };
    if (cmd === "kill") return { code: 0, output: "" };
    if (cmd === "run") {
      const r = results.run ?? { code: 0, output: "ok" };
      if (r === "hang") {
        return new Promise<DockerRunResult>((resolve) => {
          opts?.signal?.addEventListener("abort", () => resolve({ code: null, output: "partial" }), { once: true });
        });
      }
      return r;
    }
    throw new Error(`unexpected docker ${String(cmd)}`);
  };
  return { exec, calls };
}

describe("buildRunArgs", () => {
  const args = buildRunArgs({ taskId: "task-1", worktree: "D:\\data\\worktrees\\task-1", testCommand: "npm test" });
  const has = (...seq: string[]): boolean => args.some((_, i) => seq.every((s, j) => args[i + j] === s));

  it("applies the sandbox limits of requirement 6.1", () => {
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(has("--network", "none")).toBe(true);
    expect(has("--cpus", "1")).toBe(true);
    expect(has("--memory", "512m")).toBe(true);
    expect(has("--pids-limit", "256")).toBe(true);
    expect(has("--cap-drop", "ALL")).toBe(true);
    expect(has("--security-opt", "no-new-privileges")).toBe(true);
    expect(args).toContain("--read-only");
    expect(has("--name", containerName("task-1"))).toBe(true);
  });

  it("mounts the worktree read-only, as given, and copies it before running the command from config", () => {
    expect(has("-v", "D:\\data\\worktrees\\task-1:/src:ro")).toBe(true);
    expect(args).toContain(RUNNER_IMAGE);
    const script = args[args.length - 1]!;
    expect(args[args.length - 3]).toBe("sh");
    expect(script.startsWith("cp -r /src/. /work/ && find /work ")).toBe(true);
    // Accepted secret files are deleted from the copy before the tests run (review of project-registry).
    expect(script).toMatch(/-name '\.env' .*-delete && cd \/work && /);
    expect(script).toContain("! -name '.env.example'");
    expect(script.endsWith("&& npm test")).toBe(true);
  });

  it("does not pass host environment variables into the container", () => {
    const envs = args.filter((_, i) => args[i - 1] === "-e");
    expect(envs.sort()).toEqual(["CI=1", "FORCE_COLOR=0", "HOME=/tmp", "NO_COLOR=1"]);
  });
});

describe("truncateLog", () => {
  it("keeps short logs and cuts long ones from the front", () => {
    expect(truncateLog("short")).toBe("short");
    const long = "a".repeat(MAX_TEST_LOG_BYTES) + "THE END";
    const cut = truncateLog(long);
    expect(cut.startsWith("[log truncated")).toBe(true);
    expect(cut.endsWith("THE END")).toBe(true);
    expect(Buffer.byteLength(cut)).toBeLessThan(MAX_TEST_LOG_BYTES + 100);
  });
});

describe("testStep (scripted docker)", () => {
  it("returns passed with the exit code and log when the tests pass", async () => {
    makeWorktree();
    const { exec, calls } = scripted({ run: { code: 0, output: "Tests  7 passed\n" } });
    const r = await testStep(deps(), ctx(), exec);
    expect(r).toEqual({ passed: true, log: "Tests  7 passed\n", exitCode: 0 });
    expect(calls.map((c) => c[0])).toEqual(["version", "image", "run"]);
    expect(calls[2]).toContain(`${wt()}:/src:ro`);
  });

  it("returns passed false when the tests fail; this is a result, not an error", async () => {
    makeWorktree();
    const { exec } = scripted({ run: { code: 1, output: "1 failed\n" } });
    expect(await testStep(deps(), ctx(), exec)).toEqual({ passed: false, log: "1 failed\n", exitCode: 1 });
  });

  it("truncates the log to 200 KB", async () => {
    makeWorktree();
    const { exec } = scripted({ run: { code: 1, output: "x".repeat(MAX_TEST_LOG_BYTES * 2) } });
    const r = await testStep(deps(), ctx(), exec);
    expect(Buffer.byteLength(r.log)).toBeLessThan(MAX_TEST_LOG_BYTES + 100);
  });

  it("fails with docker_unavailable when the client cannot start or the daemon does not answer", async () => {
    makeWorktree();
    const noBinary = scripted({ version: { code: null, output: "", spawnError: new Error("spawn docker ENOENT") } });
    await expect(testStep(deps(), ctx(), noBinary.exec)).rejects.toThrow(/^docker_unavailable: cannot start docker/);
    await expect(testStep(deps(), ctx(), noBinary.exec)).rejects.toBeInstanceOf(DockerUnavailableError);
    const noDaemon = scripted({ version: { code: 1, output: "failed to connect to the docker API\nsecond line" } });
    await expect(testStep(deps(), ctx(), noDaemon.exec)).rejects.toThrow("docker_unavailable: failed to connect to the docker API");
    expect(noDaemon.calls).toHaveLength(1);
  });

  it("explains how to build a missing image", async () => {
    makeWorktree();
    const { exec } = scripted({ image: { code: 1, output: "no such image" } });
    await expect(testStep(deps(), ctx(), exec)).rejects.toThrow(/runner_image_missing.*runner:build/);
  });

  it("fails when the worktree is missing or the repo is unknown", async () => {
    const { exec, calls } = scripted();
    await expect(testStep(deps(), ctx(), exec)).rejects.toThrow(/worktree is missing/);
    makeWorktree();
    await expect(testStep(deps(), ctx({ repoId: "other" }), exec)).rejects.toThrow(/unknown repo/);
    expect(calls).toHaveLength(0);
  });

  it("kills the container and throws a timeout when the run exceeds the step limit", async () => {
    makeWorktree();
    const { exec, calls } = scripted({ run: "hang" });
    await expect(testStep(deps(), ctx({ timeoutMs: 30 }), exec)).rejects.toBeInstanceOf(StepTimeoutError);
    expect(calls.some((c) => c[0] === "kill" && c[1] === containerName("task-1"))).toBe(true);
  });

  it("kills the container when the job is cancelled", async () => {
    makeWorktree();
    const ac = new AbortController();
    const { exec, calls } = scripted({ run: "hang" });
    const p = testStep(deps(), ctx({ signal: ac.signal }), exec);
    setTimeout(() => ac.abort(new Error("cancelled")), 20);
    await expect(p).rejects.toThrow("cancelled");
    expect(calls.some((c) => c[0] === "kill")).toBe(true);
  });
});

// ---- live: needs Docker and the image (pnpm --filter @agentlife/agent-engine runner:build) ----

const live = process.env["AGENTLIFE_LIVE"] === "1" ? describe : describe.skip;

live("testStep with real Docker (AGENTLIFE_LIVE=1)", () => {
  async function liveWorktree(extra: Record<string, string> = {}): Promise<PipelineDeps> {
    // Real fixture, materialised, then used directly as the worktree of task-1.
    const d = deps();
    const mat = await materialise({
      repo: { id: "haunted-todo", source: "fixtures/repos/haunted-todo" },
      projectRoot: PROJECT_ROOT,
      dataDir: path.join(root, "data"),
    });
    cpSync(mat.dir, wt(), { recursive: true });
    for (const [rel, content] of Object.entries(extra)) {
      mkdirSync(path.dirname(path.join(wt(), rel)), { recursive: true });
      writeFileSync(path.join(wt(), rel), content);
    }
    return { ...d, repos: [{ id: "demo", name: "demo", source: "fixtures/repos/haunted-todo", testCommand: "npm test" }] };
  }
  const t = 120_000;

  it("runs the fixture tests: 7 pass, 1 skipped, exit code 0", async () => {
    const r = await testStep(await liveWorktree(), ctx({ timeoutMs: t }));
    expect(r.log).toMatch(/7 passed \| 1 skipped/);
    expect(r.log).not.toContain("\u001b[");
    expect(r.passed).toBe(true);
  }, t);

  it("reports failing tests with exit code 1", async () => {
    const r = await testStep(
      await liveWorktree({ "test/fail.test.ts": 'import { it, expect } from "vitest";\nit("fails", () => expect(1).toBe(2));\n' }),
      ctx({ timeoutMs: t }),
    );
    expect(r.passed).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.log).toMatch(/fails/);
  }, t);

  it("has no network and cannot write to the mounted worktree", async () => {
    const probe = [
      'import { it, expect } from "vitest";',
      'import { writeFileSync } from "node:fs";',
      'it("has no network", async () => { await expect(fetch("http://example.com", { signal: AbortSignal.timeout(5000) })).rejects.toThrow(); });',
      'it("cannot write to /src", () => { expect(() => writeFileSync("/src/evil.txt", "x")).toThrow(); });',
      'it("is not root", () => { expect(process.getuid?.()).not.toBe(0); });',
    ].join("\n");
    const r = await testStep(await liveWorktree({ "test/sandbox.test.ts": probe }), ctx({ timeoutMs: t }));
    expect(r.log).toMatch(/3 passed|passed/);
    expect(r.passed, r.log).toBe(true);
  }, t);

  it("kills the container on timeout", async () => {
    const hang = 'import { it } from "vitest";\nit("hangs", () => new Promise(() => {}), 600000);\n';
    const started = Date.now();
    await expect(testStep(await liveWorktree({ "test/hang.test.ts": hang }), ctx({ timeoutMs: 6000 }))).rejects.toBeInstanceOf(StepTimeoutError);
    expect(Date.now() - started).toBeLessThan(60_000);
    const ps = await defaultDockerExec(["ps", "-a", "--filter", `name=${containerName("task-1")}`, "--format", "{{.Names}}"]);
    expect(ps.output.trim()).toBe("");
  }, t);
});

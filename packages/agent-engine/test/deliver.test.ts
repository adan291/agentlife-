import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeliveryInfoSchema, RunExportSchema } from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";
import { ConflictError } from "../src/errors.ts";
import { git } from "../src/git.ts";
import { PROJECT_ROOT, dataPaths } from "../src/paths.ts";
import { deliverBranch } from "../src/projects/deliver.ts";
import { ProjectRegistry } from "../src/projects/registry.ts";
import { Store } from "../src/store.ts";
import { commitAll, jobHarness, makeRepo, runJob, type JobHarness } from "./helpers.ts";

let tmp: string;
let hotel: string;
let harness: JobHarness | undefined;
let engine: Engine | undefined;

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "al-deliver-")));
  hotel = path.join(tmp, "hotel");
  mkdirSync(hotel, { recursive: true });
});
afterEach(async () => {
  await engine?.close();
  engine = undefined;
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

/** What a delivery must leave alone: HEAD, the current branch, the index, the working files, the config and every other ref. */
async function snapshot(dir: string) {
  return {
    head: (await git(dir, ["rev-parse", "HEAD"])).trim(),
    branch: (await git(dir, ["symbolic-ref", "--short", "HEAD"])).trim(),
    index: await git(dir, ["ls-files", "-s"]),
    status: await git(dir, ["status", "--porcelain", "--untracked-files=all"]),
    config: readFileSync(path.join(dir, ".git", "config"), "utf8"),
    refs: (await git(dir, ["for-each-ref", "--format=%(refname) %(objectname)"])).trim().split("\n").filter(Boolean),
    files: Object.fromEntries(readdirSync(dir).filter((f) => f !== ".git").map((f) => [f, readFileSync(path.join(dir, f), "utf8")])),
  };
}

async function finishedJob(): Promise<{ dir: string; reg: ProjectRegistry; taskId: string }> {
  const dir = await makeRepo(path.join(hotel, "demo"), { "README.md": "# Demo\n", "notes.txt": "notes\n" });
  const reg = registry();
  await reg.register({ path: dir, name: "demo" });
  harness = jobHarness(tmp, reg);
  const taskId = await runJob(harness, "demo");
  return { dir, reg, taskId };
}

describe("deliverBranch", () => {
  it("creates the branch in the user's repository and leaves HEAD, index, working copy, config and other refs alone", async () => {
    const { dir, reg, taskId } = await finishedJob();
    // The user keeps working: an edit that is not committed must survive the delivery.
    writeFileSync(path.join(dir, "notes.txt"), "my unsaved thoughts\n");
    writeFileSync(path.join(dir, "scratch.txt"), "scratch\n");
    const before = await snapshot(dir);

    const info = await deliverBranch({ registry: reg, paths: harness!.deps.paths, taskId, repoId: "demo" });
    expect(DeliveryInfoSchema.safeParse(info).success).toBe(true);
    expect(info.branch).toBe(`agentlife/${taskId}`);

    const after = await snapshot(dir);
    const { refs: refsBefore, ...restBefore } = before;
    const { refs: refsAfter, ...restAfter } = after;
    expect(restAfter).toEqual(restBefore);
    expect(refsAfter.filter((r) => !refsBefore.includes(r))).toEqual([`refs/heads/agentlife/${taskId} ${info.commit}`]);
    expect(refsBefore.every((r) => refsAfter.includes(r))).toBe(true);
    expect(readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe("my unsaved thoughts\n");

    // The branch holds the Developer's commit, one step after the user's commit.
    expect((await git(dir, ["rev-parse", `${info.branch}^`])).trim()).toBe(before.head);
    expect((await git(dir, ["log", "-1", "--format=%s", info.branch])).trim()).toBe("agentlife: Improve the readme");
    expect((await git(dir, ["show", `${info.branch}:README.md`])).replace(/\r\n/g, "\n")).toBe("# Demo\n\nA longer readme.\n");
    // The user's branch is exactly where it was.
    expect((await git(dir, ["show", "HEAD:README.md"])).replace(/\r\n/g, "\n")).toBe("# Demo\n");
  });

  it("refuses an existing branch of that name and does not move it", async () => {
    const { dir, reg, taskId } = await finishedJob();
    await git(dir, ["branch", `agentlife/${taskId}`]);
    const before = await snapshot(dir);
    await expect(deliverBranch({ registry: reg, paths: harness!.deps.paths, taskId, repoId: "demo" })).rejects.toMatchObject({
      name: "ConflictError",
      code: "branch_exists",
    });
    expect(await snapshot(dir)).toEqual(before);
  });

  it("delivers once: the second call finds the branch", async () => {
    const { dir, reg, taskId } = await finishedJob();
    const first = await deliverBranch({ registry: reg, paths: harness!.deps.paths, taskId, repoId: "demo" });
    await expect(deliverBranch({ registry: reg, paths: harness!.deps.paths, taskId, repoId: "demo" })).rejects.toMatchObject({ code: "branch_exists" });
    await expect(
      deliverBranch({ registry: reg, paths: harness!.deps.paths, taskId, repoId: "demo", alreadyDelivered: first }),
    ).rejects.toMatchObject({ code: "already_delivered" });
    expect((await git(dir, ["rev-parse", first.branch])).trim()).toBe(first.commit);
  });

  it("refuses the built-in project, an unknown id, a missing branch and a project that moved away", async () => {
    const { dir, reg, taskId } = await finishedJob();
    const paths = harness!.deps.paths;
    await expect(deliverBranch({ registry: reg, paths, taskId, repoId: "haunted-todo" })).rejects.toMatchObject({ code: "not_deliverable" });
    await expect(deliverBranch({ registry: reg, paths, taskId, repoId: "nope" })).rejects.toBeInstanceOf(ConflictError);
    await expect(deliverBranch({ registry: reg, paths, taskId: "task-other", repoId: "demo" })).rejects.toMatchObject({ code: "branch_missing" });
    await expect(deliverBranch({ registry: reg, paths, taskId: "../x", repoId: "demo" })).rejects.toMatchObject({ code: "invalid_task" });

    // A newer job replaces the clone: the older job's branch is gone and delivery says so.
    writeFileSync(path.join(dir, "notes.txt"), "committed later\n");
    await commitAll(dir, "later");
    const second = await runJob(harness!, "demo");
    await expect(deliverBranch({ registry: reg, paths, taskId, repoId: "demo" })).rejects.toMatchObject({ code: "branch_missing" });
    expect((await deliverBranch({ registry: reg, paths, taskId: second, repoId: "demo" })).branch).toBe(`agentlife/${second}`);

    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await expect(deliverBranch({ registry: reg, paths, taskId: second, repoId: "demo" })).rejects.toMatchObject({ code: "project_unavailable" });
  });
});

describe("delivery over HTTP", () => {
  it("offers delivery in the export, delivers on request, records delivery.done and refuses a second time", async () => {
    const dir = await makeRepo(path.join(hotel, "web"), { "README.md": "# Web\n" });
    const reg = registry();
    const store = new Store({ dbPath: ":memory:", runsDir: dataPaths(path.join(tmp, "data")).runs });
    harness = jobHarness(tmp, reg, store);
    engine = await startEngine({
      store,
      steps: harness.steps,
      dataDir: path.join(tmp, "data"),
      projects: reg,
      port: 0,
    });
    const url = `http://127.0.0.1:${engine.port}`;
    const post = (p: string, body?: unknown) =>
      fetch(`${url}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

    expect((await post("/projects", { path: dir, name: "Web" })).status).toBe(201);
    const started = (await (await post("/tasks", { repoId: "web", goal: "Make the readme longer" })).json()) as { taskId: string };
    const taskId = started.taskId;

    // Approve the plan as soon as it is asked for.
    const deadline = Date.now() + 60_000;
    let approvalId: string | undefined;
    while (!approvalId && Date.now() < deadline) {
      approvalId = engine.store.getJob(taskId)?.approvals.find((a) => a.status === "pending")?.approvalId;
      if (!approvalId) await new Promise((r) => setTimeout(r, 20));
    }
    expect((await post(`/approvals/${approvalId}`, { decision: "approve" })).status).toBe(200);
    await engine.runner.done(taskId);

    const exp = RunExportSchema.parse(await (await fetch(`${url}/tasks/${taskId}/export`)).json());
    expect(exp.job.deliverable).toBe(true);
    expect(exp.job.delivery).toBeUndefined();

    const head = (await git(dir, ["rev-parse", "HEAD"])).trim();
    const res = await post(`/tasks/${taskId}/deliver`);
    expect(res.status).toBe(200);
    const info = DeliveryInfoSchema.parse(await res.json());
    expect(info.branch).toBe(`agentlife/${taskId}`);
    expect((await git(dir, ["rev-parse", "HEAD"])).trim()).toBe(head);

    const after = RunExportSchema.parse(await (await fetch(`${url}/tasks/${taskId}/export`)).json());
    expect(after.job.delivery).toEqual(info);
    expect(after.job.deliverable).toBeUndefined();
    const event = after.events.find((e) => e.type === "delivery.done");
    expect(event).toMatchObject({ type: "delivery.done", taskId, branch: info.branch, commit: info.commit });
    expect(JSON.stringify(after)).not.toContain(dir);

    const again = await post(`/tasks/${taskId}/deliver`);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("already_delivered");
    expect((await post("/tasks/task-unknown/deliver")).status).toBe(404);
    expect(existsSync(path.join(dir, ".git"))).toBe(true);
  });

  it("answers 409 for a job on the built-in project", async () => {
    const reg = registry();
    const store = new Store({ dbPath: ":memory:", runsDir: dataPaths(path.join(tmp, "data")).runs });
    engine = await startEngine({ store, dataDir: path.join(tmp, "data"), projects: reg, port: 0 });
    const url = `http://127.0.0.1:${engine.port}`;
    const started = (await (
      await fetch(`${url}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repoId: "haunted-todo", goal: "x" }) })
    ).json()) as { taskId: string };
    // A job that is still running cannot be delivered either.
    const early = await fetch(`${url}/tasks/${started.taskId}/deliver`, { method: "POST" });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: string }).error).toBe("job_not_finished");
  });
});

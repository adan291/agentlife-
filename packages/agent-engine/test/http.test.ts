import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EngineJobViewSchema, ErrorResponseSchema, HealthResponseSchema } from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";

const engines: Engine[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) await e.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function boot(opts: { token?: string } = {}): Promise<{ engine: Engine; url: string }> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentlife-http-"));
  dirs.push(dir);
  const engine = await startEngine({
    storeOptions: { dbPath: ":memory:", runsDir: dir },
    port: 0,
    token: opts.token,
  });
  engines.push(engine);
  return { engine, url: `http://127.0.0.1:${engine.port}` };
}

async function json(res: Response): Promise<unknown> {
  return res.json();
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("engine HTTP routes", () => {
  it("serves health and the repo list without exposing sources", async () => {
    const { url } = await boot();
    const health = HealthResponseSchema.parse(await json(await fetch(`${url}/health`)));
    expect(health.lastSeq).toBe(0);
    const repos = (await json(await fetch(`${url}/repos`))) as Record<string, unknown>[];
    expect(repos).toEqual([{ id: "haunted-todo", name: "haunted-todo" }]);
  });

  it("runs a job: start, approve, delivered; GET /tasks/:id matches the stored view", async () => {
    const { engine, url } = await boot();
    const start = await post(`${url}/tasks`, { repoId: "haunted-todo", goal: "fix the bug" });
    expect(start.status).toBe(201);
    const { taskId } = (await json(start)) as { taskId: string };
    await waitFor(() => engine.store.getJob(taskId)?.state === "awaiting_plan_approval");
    const job = EngineJobViewSchema.parse(await json(await fetch(`${url}/tasks/${taskId}`)));
    expect(job.approvals).toHaveLength(1);
    const ok = await post(`${url}/approvals/${job.approvals[0]!.approvalId}`, { decision: "approve" });
    expect(ok.status).toBe(200);
    await engine.runner.done(taskId);
    const after = EngineJobViewSchema.parse(await json(await fetch(`${url}/tasks/${taskId}`)));
    expect(after.state).toBe("delivered");
    expect(after.verdict).toBe("pass");
    expect(after).toEqual(engine.store.getJob(taskId));
  });

  it("answers 400 with issue paths for invalid bodies and unknown repos", async () => {
    const { url } = await boot();
    const bad = await post(`${url}/tasks`, { repoId: "haunted-todo", goal: "x".repeat(301) });
    expect(bad.status).toBe(400);
    const body = ErrorResponseSchema.parse(await json(bad));
    expect(body.issues?.map((i) => i.path)).toContain("goal");

    const empty = await post(`${url}/tasks`, { repoId: "haunted-todo", goal: "   " });
    expect(empty.status).toBe(400);

    const repo = await post(`${url}/tasks`, { repoId: "evil", goal: "hi" });
    expect(repo.status).toBe(400);
    expect(ErrorResponseSchema.parse(await json(repo)).issues?.[0]?.path).toBe("repoId");

    const notJson = await fetch(`${url}/tasks`, { method: "POST", body: "{nope" });
    expect(notJson.status).toBe(400);

    const decision = await post(`${url}/approvals/x`, { decision: "maybe" });
    expect(decision.status).toBe(400);
  });

  it("does not create a job for an unknown repo", async () => {
    const { engine, url } = await boot();
    await post(`${url}/tasks`, { repoId: "evil", goal: "hi" });
    expect(engine.store.listJobs()).toHaveLength(0);
  });

  it("answers 404 for unknown ids and routes, 405 for wrong methods", async () => {
    const { url } = await boot();
    expect((await fetch(`${url}/tasks/nope`)).status).toBe(404);
    expect((await post(`${url}/approvals/nope`, { decision: "approve" })).status).toBe(404);
    expect((await post(`${url}/tasks/nope/cancel`, {})).status).toBe(404);
    expect((await fetch(`${url}/nothing`)).status).toBe(404);
    expect((await fetch(`${url}/repos`, { method: "DELETE" })).status).toBe(405);
  });

  it("answers 409 busy for a second job, and 409 for a repeated approval", async () => {
    const { engine, url } = await boot();
    const first = (await json(await post(`${url}/tasks`, { repoId: "haunted-todo", goal: "one" }))) as { taskId: string };
    const second = await post(`${url}/tasks`, { repoId: "haunted-todo", goal: "two" });
    expect(second.status).toBe(409);
    expect(ErrorResponseSchema.parse(await json(second)).error).toBe("busy");

    await waitFor(() => engine.store.getJob(first.taskId)?.state === "awaiting_plan_approval");
    const approvalId = engine.store.getJob(first.taskId)!.approvals[0]!.approvalId;
    expect((await post(`${url}/approvals/${approvalId}`, { decision: "approve" })).status).toBe(200);
    expect((await post(`${url}/approvals/${approvalId}`, { decision: "approve" })).status).toBe(409);
    await engine.runner.done(first.taskId);
    expect((await post(`${url}/tasks/${first.taskId}/cancel`, {})).status).toBe(409);
  });

  it("cancels a job waiting for approval", async () => {
    const { engine, url } = await boot();
    const { taskId } = (await json(await post(`${url}/tasks`, { repoId: "haunted-todo", goal: "one" }))) as { taskId: string };
    await waitFor(() => engine.store.getJob(taskId)?.state === "awaiting_plan_approval");
    expect((await post(`${url}/tasks/${taskId}/cancel`, {})).status).toBe(200);
    expect(engine.store.getJob(taskId)!.state).toBe("cancelled");
  });

  it("requires the token header when ENGINE_TOKEN is set", async () => {
    const { url } = await boot({ token: "s3cret" });
    expect((await fetch(`${url}/health`)).status).toBe(401);
    expect((await fetch(`${url}/health`, { headers: { "x-agentlife-token": "wrong" } })).status).toBe(401);
    expect((await fetch(`${url}/health`, { headers: { "x-agentlife-token": "s3cret" } })).status).toBe(200);
    expect((await post(`${url}/tasks`, { repoId: "haunted-todo", goal: "x" })).status).toBe(401);
  });

  it("binds to 127.0.0.1 by default", async () => {
    const { engine } = await boot();
    expect(engine.host).toBe("127.0.0.1");
    const addr = engine.server.address();
    expect(typeof addr === "object" && addr?.address).toBe("127.0.0.1");
  });
});

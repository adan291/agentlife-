import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_NIGHT_CONFIG, NightJobSchema, NightStateSchema } from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";
import { loadNightConfig } from "../src/night/config.ts";
import { CONFIG, at } from "./night-helpers.ts";

const engines: Engine[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) await e.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "al-night-http-"));
  dirs.push(d);
  return d;
}

async function boot(now = at(12, 0)): Promise<{ engine: Engine; url: string; file: string }> {
  const dir = tmp();
  const file = path.join(dir, "night.json");
  const engine = await startEngine({
    storeOptions: { dbPath: ":memory:", runsDir: path.join(dir, "runs") },
    port: 0,
    night: { file, config: CONFIG, now: () => now },
  });
  engines.push(engine);
  return { engine, url: `http://127.0.0.1:${engine.port}`, file };
}

const send = (url: string, method: string, body?: unknown) =>
  fetch(url, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("night routes", () => {
  it("lists the schedule with the window and limits, and says whether the window is open", async () => {
    const { url } = await boot(at(2, 0));
    const state = NightStateSchema.parse(await (await fetch(`${url}/night`)).json());
    expect(state).toMatchObject({ open: true, config: CONFIG, jobs: [] });
    const closed = await boot(at(12, 0));
    expect(NightStateSchema.parse(await (await fetch(`${closed.url}/night`)).json()).open).toBe(false);
  });

  it("adds, reorders and removes night jobs, and keeps them in the file", async () => {
    const { url, engine } = await boot();
    const add = async (body: unknown) => send(`${url}/night/jobs`, "POST", body);
    const a = NightJobSchema.parse(await (await add({ repoId: "haunted-todo", kind: "audit-deps" })).json());
    expect(a).toMatchObject({ status: "scheduled", goal: "Audit dependencies", tier: "normal", preApprove: false, deliver: false });
    const b = NightJobSchema.parse(await (await add({ repoId: "haunted-todo", kind: "review-branch", target: "feature/x", tier: "cheap" })).json());
    expect(engine.night.store.jobs().map((j) => j.id)).toEqual([a.id, b.id]);

    expect((await send(`${url}/night/jobs/${b.id}/move`, "POST", { direction: "up" })).status).toBe(200);
    expect(engine.night.store.jobs().map((j) => j.id)).toEqual([b.id, a.id]);
    expect((await send(`${url}/night/jobs/${b.id}/move`, "POST", { direction: "sideways" })).status).toBe(400);

    expect((await send(`${url}/night/jobs/${a.id}`, "DELETE")).status).toBe(200);
    expect((await send(`${url}/night/jobs/${a.id}`, "DELETE")).status).toBe(404);
    const state = NightStateSchema.parse(await (await fetch(`${url}/night`)).json());
    expect(state.jobs.map((j) => j.id)).toEqual([b.id]);
  });

  it("refuses bad input with a 400 that names the field", async () => {
    const { url } = await boot();
    const bad = async (body: unknown) => {
      const res = await send(`${url}/night/jobs`, "POST", body);
      expect(res.status).toBe(400);
      return (await res.json()) as { error: string; issues?: { path: string }[] };
    };
    expect((await bad({ repoId: "nope", kind: "audit-deps" })).error).toBe("unknown_repo");
    expect((await bad({ repoId: "haunted-todo", kind: "change" })).issues?.[0]?.path).toBe("goal");
    expect((await bad({ repoId: "haunted-todo", kind: "review-branch" })).issues?.[0]?.path).toBe("target");
    expect((await bad({ repoId: "haunted-todo", kind: "audit-deps", preApprove: true })).issues?.[0]?.path).toBe("preApprove");
    expect((await bad({ repoId: "haunted-todo", kind: "review-branch", target: "main", deliver: true })).issues?.[0]?.path).toBe("deliver");
    expect((await bad({ repoId: "haunted-todo", kind: "change", goal: "g", preApprove: true })).issues?.[0]?.path).toBe("scopePaths");
    expect((await bad({ repoId: "haunted-todo", kind: "change", goal: "g", preApprove: true, scopePaths: ["../etc"] })).issues?.[0]?.path).toBe("scopePaths");
    expect((await bad({ repoId: "haunted-todo", kind: "write-tests", target: "src", preApprove: true, scopePaths: ["src/"] })).issues?.[0]?.path).toBe("scopePaths");
    expect((await bad({ repoId: "haunted-todo", kind: "audit-deps", tier: "free" })).issues?.[0]?.path).toBe("tier");
  });

  it("does not run the scheduler unless it is asked to", async () => {
    const { engine } = await boot(at(2, 0));
    engine.night.store.add({ repoId: "haunted-todo", kind: "audit-deps", tier: "normal", preApprove: false, deliver: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.night.store.jobs()[0]?.status).toBe("scheduled");
    expect(engine.runner.activeJobId()).toBeUndefined();
  });
});

describe("night config", () => {
  it("has the defaults of the spec in the shipped file", () => {
    expect(loadNightConfig()).toEqual(DEFAULT_NIGHT_CONFIG);
    expect(DEFAULT_NIGHT_CONFIG).toEqual({ start: "01:00", end: "07:00", maxJobsPerNight: 4, maxJobMinutes: 20 });
  });

  it("uses the defaults when the file is missing and fills in what it leaves out", () => {
    const dir = tmp();
    expect(loadNightConfig(dir)).toEqual(DEFAULT_NIGHT_CONFIG);
    writeFileSync(path.join(dir, "night.json"), JSON.stringify({ start: "23:30", maxJobsPerNight: 2 }));
    expect(loadNightConfig(dir)).toEqual({ ...DEFAULT_NIGHT_CONFIG, start: "23:30", maxJobsPerNight: 2 });
  });

  it("refuses a file that is wrong instead of moving the window", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "night.json"), JSON.stringify({ start: "1am" }));
    expect(() => loadNightConfig(dir)).toThrow(/night\.json is invalid.*start/);
    writeFileSync(path.join(dir, "night.json"), JSON.stringify({ start: "03:00", end: "03:00" }));
    expect(() => loadNightConfig(dir)).toThrow(/must differ/);
    writeFileSync(path.join(dir, "night.json"), "{");
    expect(() => loadNightConfig(dir)).toThrow(/not valid JSON/);
  });
});

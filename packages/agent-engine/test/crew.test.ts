import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent, CrewEvent } from "@agentlife/shared";
import { createCrewRelay } from "../src/crew.ts";
import { startEngine, type Engine } from "../src/engine.ts";
import type { NewEvent } from "../src/store.ts";

const engines: Engine[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) await e.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function boot(): Promise<{ engine: Engine; url: string }> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentlife-crew-"));
  dirs.push(dir);
  const engine = await startEngine({ storeOptions: { dbPath: ":memory:", runsDir: dir }, port: 0 });
  engines.push(engine);
  return { engine, url: `http://127.0.0.1:${engine.port}` };
}

const post = (url: string, body: unknown) =>
  fetch(`${url}/crew/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function relayHarness() {
  let t = 10_000;
  const out: NewEvent[] = [];
  const relay = createCrewRelay({ append: (e) => out.push(e), now: () => t });
  return { relay, out, advance: (ms: number) => (t += ms) };
}

const summary = (e: NewEvent) =>
  e.type === "agent.goto" ? `goto:${e.anchor}` : e.type === "agent.state_changed" ? `state:${e.state}` : e.type === "agent.say" ? `say:${e.text}` : e.type;

describe("crew relay", () => {
  it("maps started, activity and finished to builder agent events", () => {
    const { relay, out, advance } = relayHarness();
    relay.handle({ kind: "started", session: "S9", spec: "agent-pipeline", model: "auto" });
    expect(out.map(summary)).toEqual(["goto:desk", "state:working", "say:S9 agent-pipeline (auto)"]);
    expect(out.every((e) => e.taskId === "build:S9" && "agentId" in e && e.agentId === "builder")).toBe(true);

    out.length = 0;
    advance(5000);
    relay.handle({ kind: "activity", session: "S9", activity: "think" });
    relay.handle({ kind: "activity", session: "S9", activity: "edit", text: "editing a.ts" });
    expect(out.map(summary)).toEqual(["state:thinking", "state:working", "say:editing a.ts"]);

    out.length = 0;
    relay.handle({ kind: "finished", session: "S9", ok: true });
    expect(out.map(summary)).toEqual(["say:done", "state:done", "goto:home", "state:idle"]);

    out.length = 0;
    relay.handle({ kind: "finished", session: "S9", ok: false });
    expect(out.map(summary)).toEqual(["say:failed", "state:error", "goto:home", "state:idle"]);
  });

  it("emits at most one say per 3 s for activity updates but still updates the state", () => {
    const { relay, out, advance } = relayHarness();
    const act = (text: string): CrewEvent => ({ kind: "activity", session: "S1", activity: "run", text });
    relay.handle(act("running pnpm check"));
    advance(1000);
    relay.handle(act("reading a.ts"));
    advance(1000);
    relay.handle(act("reading b.ts"));
    expect(out.filter((e) => e.type === "agent.say").map(summary)).toEqual(["say:running pnpm check"]);
    expect(out.filter((e) => e.type === "agent.state_changed")).toHaveLength(3);
    advance(1000);
    relay.handle(act("editing c.ts"));
    expect(out.filter((e) => e.type === "agent.say")).toHaveLength(2);
  });
});

describe("POST /crew/events", () => {
  it("answers 400 for invalid bodies and emits nothing", async () => {
    const { engine, url } = await boot();
    for (const body of [{}, { kind: "bogus", session: "S1" }, { kind: "started", session: "TOO-LONG-LABEL" }, { kind: "activity", session: "S1", text: "x".repeat(81) }]) {
      const res = await post(url, body);
      expect(res.status).toBe(400);
    }
    expect(engine.store.lastSeq()).toBe(0);
  });

  it("appends only agent events for builder and creates no job view", async () => {
    const { engine, url } = await boot();
    expect((await post(url, { kind: "started", session: "S9", spec: "x" })).status).toBe(202);
    expect((await post(url, { kind: "activity", session: "S9", activity: "read", text: "reading a.ts" })).status).toBe(202);
    expect((await post(url, { kind: "finished", session: "S9", ok: true })).status).toBe(202);
    const evs: AgentEvent[] = engine.store.eventsSince(0);
    expect(evs.length).toBeGreaterThan(0);
    expect(evs.every((e) => e.type.startsWith("agent.") && e.taskId === "build:S9")).toBe(true);
    expect(engine.store.getJob("build:S9")).toBeUndefined();
    expect(engine.store.listJobs()).toEqual([]);
    expect((await fetch(`${url}/tasks/${encodeURIComponent("build:S9")}`)).status).toBe(404);
  });

  it("runs a job while a build session is shown", async () => {
    const { engine, url } = await boot();
    await post(url, { kind: "started", session: "S9" });
    const start = await fetch(`${url}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoId: "haunted-todo", goal: "fix the bug" }),
    });
    expect(start.status).toBe(201);
    const { taskId } = (await start.json()) as { taskId: string };
    expect((await post(url, { kind: "activity", session: "S9", activity: "edit", text: "editing a.ts" })).status).toBe(202);
    await engine.runner.cancel(taskId);
    expect(engine.store.getJob(taskId)?.state).toBe("cancelled");
    expect(engine.store.listJobs().map((j) => j.taskId)).toEqual([taskId]);
  });
});

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunExportSchema } from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";
import { createRuntimeSteps } from "../src/jobs/runtime-steps.ts";
import { collectSecrets, createJsonLogger, createRedactor } from "../src/log.ts";
import { FAKE_OUTPUTS, FakeRuntime } from "../src/runtimes/fake.ts";
import type { AgentRuntime, RuntimeEvent } from "../src/runtimes/types.ts";
import { Store } from "../src/store.ts";
import { buildReport, collectFacts } from "../src/steps/report.ts";
import type { PipelineDeps } from "../src/steps/deps.ts";

const engines: Engine[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) await e.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "agentlife-obs-"));
  dirs.push(d);
  return d;
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function usageRuntime(base: AgentRuntime): AgentRuntime {
  return {
    id: "usage",
    async *run(i): AsyncIterable<RuntimeEvent> {
      for await (const ev of base.run(i)) {
        if (ev.kind === "usage") yield { kind: "usage", credits: 1.5, tokens: 100 };
        else yield ev;
      }
    },
  };
}

async function runJob(engine: Engine, url: string, goal: string): Promise<string> {
  const start = await post(`${url}/tasks`, { repoId: "haunted-todo", goal });
  const { taskId } = (await start.json()) as { taskId: string };
  await waitFor(() => engine.store.getJob(taskId)?.state === "awaiting_plan_approval");
  const approvalId = engine.store.getJob(taskId)!.approvals[0]!.approvalId;
  await post(`${url}/approvals/${approvalId}`, { decision: "approve" });
  await engine.runner.done(taskId);
  return taskId;
}

describe("GET /tasks/:id/export", () => {
  it("returns a valid RunExport with events, artifact contents and per-step metrics", async () => {
    const runsDir = tmp();
    const store = new Store({ dbPath: ":memory:", runsDir });
    const runtimes = {
      architect: usageRuntime(new FakeRuntime()),
      developer: new FakeRuntime(),
      qa: new FakeRuntime(),
    };
    const lines: string[] = [];
    const logger = createJsonLogger({ write: (l) => lines.push(l) });
    const engine = await startEngine({ store, port: 0, logger, steps: createRuntimeSteps({ runtimes, store, logger }) });
    engines.push(engine);
    const url = `http://127.0.0.1:${engine.port}`;
    const taskId = await runJob(engine, url, "fix it");

    const res = await fetch(`${url}/tasks/${taskId}/export`);
    expect(res.status).toBe(200);
    const exp = RunExportSchema.parse(await res.json());
    expect(exp.job.state).toBe("delivered");
    expect(exp.events.length).toBe(store.eventsFor(taskId).length);
    expect(exp.events.map((e) => e.seq)).toEqual([...exp.events.map((e) => e.seq)].sort((a, b) => a - b));
    expect(exp.artifacts.map((a) => a.kind)).toEqual(["plan", "diff", "test_log", "review", "report"]);
    expect(exp.artifacts.find((a) => a.kind === "diff")!.content).toBe(FAKE_OUTPUTS.developer);

    const analyze = exp.job.steps.find((s) => s.step === "analyze")!;
    expect(analyze.status).toBe("ok");
    expect(analyze.endedAt).toBeGreaterThanOrEqual(analyze.startedAt);
    expect(analyze.credits).toBe(1.5);
    expect(analyze.tokens).toBe(100);
    const develop = exp.job.steps.find((s) => s.step === "develop")!;
    expect(develop.credits).toBeUndefined();

    expect((await fetch(`${url}/tasks/nope/export`)).status).toBe(404);

    // JSON-lines logs: ts, level, msg, and taskId/step on step records.
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed.length).toBeGreaterThan(0);
    for (const p of parsed) {
      expect(typeof p["ts"]).toBe("number");
      expect(["debug", "info", "warn", "error"]).toContain(p["level"]);
      expect(typeof p["msg"]).toBe("string");
    }
    const done = parsed.filter((p) => p["msg"] === "step finished");
    expect(done.map((p) => p["step"])).toEqual(["analyze", "develop", "test", "review", "report"]);
    expect(done.every((p) => p["taskId"] === taskId && typeof p["durationMs"] === "number" && p["status"] === "ok")).toBe(true);
    expect(parsed.some((p) => p["msg"] === "step usage" && p["credits"] === 1.5)).toBe(true);
  });

  it("records durationMs for every finished step in the job view, the export and report.md", async () => {
    const runsDir = tmp();
    const store = new Store({ dbPath: ":memory:", runsDir });
    const runtimes = {
      architect: new FakeRuntime({ delayMs: 15 }),
      developer: new FakeRuntime({ delayMs: 15 }),
      qa: new FakeRuntime({ delayMs: 15 }),
    };
    const engine = await startEngine({ store, port: 0, steps: createRuntimeSteps({ runtimes, store }) });
    engines.push(engine);
    const url = `http://127.0.0.1:${engine.port}`;
    const taskId = await runJob(engine, url, "g");

    const view = (await (await fetch(`${url}/tasks/${taskId}`)).json()) as { steps: { step: string; status: string; durationMs?: number }[] };
    const exp = RunExportSchema.parse(await (await fetch(`${url}/tasks/${taskId}/export`)).json());
    for (const steps of [view.steps, exp.job.steps]) {
      expect(steps.map((s) => s.step)).toEqual(["analyze", "develop", "test", "review", "report"]);
      for (const s of steps) {
        expect(s.status).toBe("ok");
        expect(s.durationMs, s.step).toBeGreaterThan(0);
      }
    }
    // The real report step reads these facts (the fake steps use the fallback report, which has no step list).
    const facts = collectFacts({ store } as unknown as PipelineDeps, taskId);
    expect(facts.map((f) => f.step)).toEqual(["analyze", "develop", "test", "review", "report"]);
    expect(facts.every((f) => f.durationMs !== undefined && f.durationMs > 0)).toBe(true);
    const md = buildReport({ goal: "g", verdict: "pass" }, facts).markdown;
    expect(md).toMatch(/\*\*analyze:\*\* ok, [\d.]+ (ms|s)/);
  });

  it("stores raw runtime output per step in data/runs/<taskId>/<step>.jsonl", async () => {
    const runsDir = tmp();
    const store = new Store({ dbPath: ":memory:", runsDir });
    const runtimes = { architect: new FakeRuntime(), developer: new FakeRuntime(), qa: new FakeRuntime() };
    const engine = await startEngine({ store, port: 0, steps: createRuntimeSteps({ runtimes, store }) });
    engines.push(engine);
    const taskId = await runJob(engine, `http://127.0.0.1:${engine.port}`, "g");
    const files = readdirSync(path.join(runsDir, taskId));
    for (const f of ["analyze.jsonl", "develop.jsonl", "review.jsonl", "test.jsonl", "plan.json", "report.md"]) {
      expect(files).toContain(f);
    }
    const out = store.readRunLog(taskId, "analyze").find((l) => l["kind"] === "output");
    expect(out?.["text"]).toBe(FAKE_OUTPUTS.architect);
  });
});

describe("secret redaction (requirement 7.4)", () => {
  // Fake value assembled at runtime so the source never contains a key-shaped literal.
  const SECRET = ["sk", "live", "ABCDEF1234567890"].join("-");

  it("never lets a configured secret reach logs, events, artifacts, run logs or exports", async () => {
    const runsDir = tmp();
    const redact = createRedactor(collectSecrets({ MY_API_KEY: SECRET }));
    const store = new Store({ dbPath: ":memory:", runsDir, redact });
    const lines: string[] = [];
    const logger = createJsonLogger({ write: (l) => lines.push(l), redact });

    const plan = JSON.stringify({
      tasks: [{ id: "t1", title: `Use ${SECRET}`, why: `key ${SECRET}`, files: ["a.js"], acceptance: "ok", risk: "low" }],
    });
    const failing: AgentRuntime = {
      id: "failing",
      // eslint-disable-next-line require-yield
      async *run(): AsyncIterable<RuntimeEvent> {
        throw new Error(`auth failed with ${SECRET}`);
      },
    };
    let devCall = 0;
    const developer: AgentRuntime = {
      id: "dev",
      run: (i) => (++devCall === 1 ? new FakeRuntime({ outputs: { developer: `+ const k = "${SECRET}"\n` } }).run(i) : failing.run(i)),
    };
    const runtimes = {
      architect: new FakeRuntime({ outputs: { architect: plan } }),
      developer,
      qa: new FakeRuntime({
        outputs: { qa: JSON.stringify({ verdict: "fail", notes: [`leaked ${SECRET}`], risk: "high" }) },
      }),
    };
    const engine = await startEngine({ store, port: 0, logger, steps: createRuntimeSteps({ runtimes, store, logger }) });
    engines.push(engine);
    const url = `http://127.0.0.1:${engine.port}`;

    // Job 1: QA fails, the developer retry throws an error that contains the secret.
    const taskId = await runJob(engine, url, `deploy with ${SECRET}`);
    logger.error("direct", { error: `oops ${SECRET}` });

    const exportText = await (await fetch(`${url}/tasks/${taskId}/export`)).text();
    const eventsText = JSON.stringify(store.eventsSince(0));
    const logText = lines.join("\n");
    let filesText = "";
    for (const f of readdirSync(path.join(runsDir, taskId))) filesText += readFileSync(path.join(runsDir, taskId, f), "utf8");

    expect(exportText).not.toContain(SECRET);
    expect(eventsText).not.toContain(SECRET);
    expect(logText).not.toContain(SECRET);
    expect(filesText).not.toContain(SECRET);
    // The job did run through the leaking paths.
    expect(exportText).toContain("[redacted]");
    expect(logText).toContain("[redacted]");
    expect(filesText).toContain("[redacted]");
    expect(store.getJob(taskId)!.verdict).toBe("fail");
  });

  it("collectSecrets picks secret-looking env vars only, and short values are ignored", () => {
    const found = collectSecrets({ KIRO_API_KEY: "abcdefghij", PATH: "/usr/bin", ENGINE_TOKEN: "abc", LLM_API_KEY: "" }, ["extra-secret"]);
    expect(found.sort()).toEqual(["abcdefghij", "extra-secret"]);
    expect(createRedactor(["abcdefghij"])("x abcdefghij y")).toBe("x [redacted] y");
  });
});

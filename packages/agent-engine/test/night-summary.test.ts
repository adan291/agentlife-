import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MorningSummariesSchema, MorningSummarySchema, type MorningSummary, type NightJob } from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";
import { createDiscordNotifier, createMorningReporter, notifyEnv } from "../src/night/morning.ts";
import { NightScheduler } from "../src/night/scheduler.ts";
import { MAX_SUMMARIES, SummaryStore } from "../src/night/summary-store.ts";
import { buildSummary, countsLine, discordFacts } from "../src/night/summary.ts";
import { CONFIG, at, rig, schedule, tmpDir } from "./night-helpers.ts";

const KEY = "2026-11-12";

function job(extra: Partial<NightJob>): NightJob {
  return {
    id: "night-1",
    repoId: "demo",
    kind: "audit-deps",
    goal: "Audit dependencies",
    tier: "normal",
    preApprove: false,
    deliver: false,
    status: "done",
    addedAt: at(0, 10),
    nightKey: KEY,
    startedAt: at(1, 0),
    endedAt: at(1, 4),
    ...extra,
  };
}

const MIXED: NightJob[] = [
  job({ id: "a", verdict: "pass" }),
  job({ id: "b", kind: "change", goal: "Validate\ntitles   in addTodo", status: "done", verdict: "pass", branch: "agentlife/task-b", startedAt: at(1, 5), endedAt: at(1, 5) }),
  job({ id: "c", kind: "change", goal: "Rename the helpers", status: "waiting", reason: "The plan is outside the pre-approved scope: touches package.json.", endedAt: at(1, 31) }),
  job({ id: "d", kind: "review-branch", goal: "Review branch feature/x", status: "failed", verdict: "fail", reason: "The job ended with a failing verdict. Its report says why." }),
  job({ id: "e", goal: "Audit dependencies", status: "skipped", reason: "The night limit of 4 jobs was reached.", startedAt: undefined, endedAt: at(7, 0) }),
  job({ id: "other", nightKey: "2026-11-11" }),
];

describe("morning summary", () => {
  it("counts the jobs of the night by code and leaves out the jobs of other nights", () => {
    const s = buildSummary({ key: KEY }, MIXED, at(7, 0));
    expect(MorningSummarySchema.parse(s)).toEqual(s);
    expect(s.counts).toEqual({ total: 5, done: 2, failed: 1, waiting: 1, timedOut: 0, cancelled: 0, skipped: 1, delivered: 1 });
    expect(s.jobs.map((j) => j.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(s.writtenAt).toBe(at(7, 0));
    expect(countsLine(s.counts)).toBe("5 jobs: 2 done, 1 failed, 1 waiting for you, 1 skipped.");
  });

  it("tells the result, time, branch and what waits for the user", () => {
    const md = buildSummary({ key: KEY }, MIXED, at(7, 0)).markdown;
    expect(md).toContain("# Morning summary 2026-11-12");
    expect(md).toContain("## Waiting for you");
    expect(md).toContain("- demo: Rename the helpers. The plan is outside the pre-approved scope: touches package.json.");
    expect(md).toContain("demo, Dependency audit: Audit dependencies. done (pass), 4 min.");
    expect(md).toContain("Validate titles in addTodo. done (pass), under a minute. Branch: agentlife/task-b.");
    expect(md).toContain("failed");
    expect(md).toContain("## To do");
    expect(md).toContain("demo: review the branch agentlife/task-b.");
  });

  it("is the same for the same night", () => {
    expect(buildSummary({ key: KEY }, MIXED, 5)).toEqual(buildSummary({ key: KEY }, MIXED, 5));
  });

  it("says so when nothing ran", () => {
    const s = buildSummary({ key: KEY }, [], 1);
    expect(s.counts.total).toBe(0);
    expect(s.markdown).toContain("No jobs.");
    expect(s.markdown).toContain("Nothing was scheduled.");
    expect(s.markdown).not.toContain("## Waiting for you");
  });

  it("writes the Discord facts with the same numbers and no model", () => {
    const facts = discordFacts(buildSummary({ key: KEY }, MIXED, 1));
    const lines = facts.split("\n");
    expect(lines[0]).toBe("AGENT LIFE night shift 2026-11-12");
    expect(lines[1]).toBe("5 jobs: 2 done, 1 failed, 1 waiting for you, 1 skipped.");
    expect(facts).toContain("- demo, Branch review: Review branch feature/x: failed");
    expect(facts).toContain("Branches to review: agentlife/task-b");
    expect(facts).toContain("1 plan waits for your approval");
  });
});

describe("summary file", () => {
  it("keeps the summaries across a restart, newest first, one per night", () => {
    const dir = tmpDir();
    const file = path.join(dir, "night-summaries.json");
    const store = new SummaryStore({ file });
    store.put(buildSummary({ key: "2026-11-10" }, [], at(7, 0, -2)));
    store.put(buildSummary({ key: KEY }, [], at(7, 0)));
    store.put({ ...buildSummary({ key: KEY }, [], at(7, 30)), writtenAt: at(7, 30) });
    const again = new SummaryStore({ file });
    expect(again.all().map((s) => s.nightKey)).toEqual([KEY, "2026-11-10"]);
    expect(again.get(KEY)?.writtenAt).toBe(at(7, 30));
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
  });

  it("keeps only the newest nights", () => {
    const store = new SummaryStore({ file: path.join(tmpDir(), "s.json") });
    for (let i = 0; i < MAX_SUMMARIES + 3; i++) store.put({ ...buildSummary({ key: `k${i}` }, [], i), writtenAt: i });
    expect(store.all()).toHaveLength(MAX_SUMMARIES);
    expect(store.all()[0]?.nightKey).toBe(`k${MAX_SUMMARIES + 2}`);
    expect(store.get("k0")).toBeUndefined();
  });

  it("moves an unreadable file aside instead of overwriting it", () => {
    const file = path.join(tmpDir(), "s.json");
    writeFileSync(file, "nope");
    const store = new SummaryStore({ file, now: () => 7 });
    expect(store.all()).toEqual([]);
    expect(readFileSync(`${file}.bad-7`, "utf8")).toBe("nope");
  });
});

describe("morning reporter", () => {
  function setup(discord: boolean, notify?: (facts: string) => Promise<void>) {
    const summaries = new SummaryStore({ file: path.join(tmpDir(), "s.json") });
    const sent: string[] = [];
    const reporter = createMorningReporter({
      summaries,
      discord,
      notify:
        notify ??
        (async (facts) => {
          sent.push(facts);
        }),
      now: () => at(7, 0),
    });
    return { summaries, sent, reporter };
  }

  it("stores the summary and sends the facts to Discord when the user enabled it", async () => {
    const { summaries, sent, reporter } = setup(true);
    const summary = await reporter({ key: KEY, openedAt: at(1, 0), windowEnd: at(7, 0), closedAt: at(7, 0) }, MIXED);
    expect(summaries.get(KEY)).toEqual(summary);
    expect(sent).toEqual([discordFacts(summary)]);
  });

  it("does not call Discord when it is not enabled, and still stores the summary", async () => {
    const { summaries, sent, reporter } = setup(false);
    await reporter({ key: KEY, openedAt: at(1, 0), windowEnd: at(7, 0) }, MIXED);
    expect(sent).toEqual([]);
    expect(summaries.get(KEY)?.counts.total).toBe(5);
  });

  it("keeps the summary when the Discord call fails", async () => {
    const { summaries, reporter } = setup(true, async () => {
      throw new Error("Discord answered 500");
    });
    await expect(reporter({ key: KEY, openedAt: at(1, 0), windowEnd: at(7, 0) }, MIXED)).resolves.toMatchObject({ nightKey: KEY });
    expect(summaries.get(KEY)).toBeDefined();
  });
});

describe("scheduler and the morning summary", () => {
  it("writes the summary once, when the night closes, with skipped and finished jobs", async () => {
    const r = rig(CONFIG, at(1, 0));
    const calls: { key: string; jobs: number }[] = [];
    const scheduler = new NightScheduler({
      store: r.store,
      port: r.port,
      config: CONFIG,
      now: r.clock,
      onClose: (night, jobs) => {
        calls.push({ key: night.key, jobs: jobs.filter((j) => j.nightKey === night.key).length });
        return buildSummary(night, jobs, r.now);
      },
    });
    const a = schedule(r.store);
    schedule(r.store, { kind: "review-branch", target: "feature/x" });
    await scheduler.tick();
    r.port.set("task-1", "delivered", { verdict: "pass" });
    r.now = at(3, 0);
    await scheduler.tick();
    expect(calls).toEqual([]);
    r.port.set("task-2", "delivered", { verdict: "pass" });
    r.now = at(7, 0);
    await scheduler.tick();
    await scheduler.tick();
    expect(calls).toEqual([{ key: KEY, jobs: 2 }]);
    expect(r.store.get(a.id)?.status).toBe("done");
  });

  it("closes the night even when the summary fails", async () => {
    const r = rig(CONFIG, at(1, 0));
    const scheduler = new NightScheduler({
      store: r.store,
      port: r.port,
      config: CONFIG,
      now: r.clock,
      onClose: () => Promise.reject(new Error("disk full")),
    });
    schedule(r.store);
    await scheduler.tick();
    r.port.set("task-1", "delivered", { verdict: "pass" });
    r.now = at(7, 0);
    await scheduler.tick();
    expect(r.store.night()?.closedAt).toBe(at(7, 0));
  });
});

describe("Discord notifier process", () => {
  it("passes the facts on standard input and reports a failing script", async () => {
    const dir = tmpDir();
    const out = path.join(dir, "out.txt");
    const ok = path.join(dir, "ok.mjs");
    writeFileSync(ok, `import { readFileSync, writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(out)}, process.argv.slice(2).join(" ") + "|" + readFileSync(0, "utf8"));\n`);
    const bad = path.join(dir, "bad.mjs");
    writeFileSync(bad, `console.error("no token"); process.exit(3);\n`);
    await createDiscordNotifier({ root: dir, scriptPath: ok })("night: 3 jobs; $(rm -rf) & \"quotes\"");
    expect(readFileSync(out, "utf8")).toBe('--overview|night: 3 jobs; $(rm -rf) & "quotes"');
    await expect(createDiscordNotifier({ root: dir, scriptPath: bad })("x")).rejects.toThrow(/exited with 3: no token/);
  });

  it("gives the script only what it needs, never a model key or the engine token", () => {
    const env = notifyEnv({ PATH: "p", DISCORD_BOT_TOKEN: "t", OLLAMA_MODEL: "m", KIRO_API_KEY: "secret", ENGINE_TOKEN: "secret2", LLM_API_KEY: "secret3" }, "/root");
    expect(env).toEqual({ PATH: "p", DISCORD_BOT_TOKEN: "t", OLLAMA_MODEL: "m", AGENTLIFE_ROOT: "/root" });
  });
});

describe("engine: morning summaries", () => {
  const engines: Engine[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    for (const e of engines.splice(0)) await e.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function boot(): Promise<{ engine: Engine; url: string }> {
    const dir = mkdtempSync(path.join(os.tmpdir(), "al-night-sum-"));
    dirs.push(dir);
    const engine = await startEngine({
      storeOptions: { dbPath: ":memory:", runsDir: path.join(dir, "runs") },
      port: 0,
      night: { file: path.join(dir, "night.json"), summariesFile: path.join(dir, "night-summaries.json"), config: CONFIG, now: () => at(12, 0) },
    });
    engines.push(engine);
    return { engine, url: `http://127.0.0.1:${engine.port}` };
  }

  it("lists the summaries, newest first", async () => {
    const { engine, url } = await boot();
    expect(MorningSummariesSchema.parse(await (await fetch(`${url}/night/summaries`)).json()).summaries).toEqual([]);
    const old: MorningSummary = { ...buildSummary({ key: "2026-11-10" }, [], 1), writtenAt: 1 };
    engine.night.summaries.put(old);
    engine.night.summaries.put(buildSummary({ key: KEY }, MIXED, at(7, 0)));
    const list = MorningSummariesSchema.parse(await (await fetch(`${url}/night/summaries`)).json()).summaries;
    expect(list.map((s) => s.nightKey)).toEqual([KEY, "2026-11-10"]);
    expect(list[0]?.counts.total).toBe(5);
  });
});

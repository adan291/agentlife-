import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MEMORY_PROMPT_MAX_CHARS, MEMORY_PROPOSALS_MAX, MemoryStateSchema, type MemoryEntry } from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";
import type { FinishedJob } from "../src/jobs/steps.ts";
import { MemoryLearner, reportDigest, worthLearning } from "../src/memory/learn.ts";
import { diffFiles, keywords, memoryBlock, memoryLines, rankMemories } from "../src/memory/retrieve.ts";
import { MemoryStore } from "../src/memory/store.ts";
import { fence } from "../src/prompts.ts";
import { OllamaUnavailableError } from "../src/runtimes/ollama.ts";
import type { AgentRuntime, RuntimeEvent, RuntimeInput } from "../src/runtimes/types.ts";
import { noopLogger } from "../src/log.ts";
import { InternRuntime } from "../src/team/intern.ts";

let tmp: string;
let clock: number;
let n: number;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "al-memlearn-"));
  clock = 1_000;
  n = 0;
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function newStore(): MemoryStore {
  return new MemoryStore({ dir: path.join(tmp, "memory"), now: () => clock++, newSuffix: () => String(++n).padStart(6, "0"), secrets: [] });
}

const add = (s: MemoryStore, text: string, kind: MemoryEntry["kind"] = "convention", project = "web") =>
  s.add(project, { kind, text, sourceTaskId: "task-0001" });

/** A runtime that answers with the given replies, in order, and records the prompts. */
function scripted(replies: string[]): AgentRuntime & { inputs: RuntimeInput[] } {
  const inputs: RuntimeInput[] = [];
  return {
    id: "scripted",
    inputs,
    async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
      inputs.push(input);
      yield { kind: "output", text: replies[Math.min(inputs.length - 1, replies.length - 1)] ?? "" };
    },
  };
}

const json = (value: unknown): string => ["Here are the notes.", "```json", JSON.stringify(value), "```"].join("\n");

function finished(over: Partial<FinishedJob> = {}, input: Partial<FinishedJob["input"]> = {}): FinishedJob {
  return {
    taskId: "task-aaaa1111",
    repoId: "web",
    goal: "Validate todo titles in addTodo",
    input: {
      goal: "Validate todo titles in addTodo",
      verdict: "pass",
      plan: { tasks: [{ id: "t1", title: "Reject empty titles", why: "Empty titles break the list", files: ["src/todo.ts"], acceptance: "addTodo throws", risk: "low" }] },
      task: { id: "t1", title: "Reject empty titles", why: "Empty titles break the list", files: ["src/todo.ts"], acceptance: "addTodo throws", risk: "low" },
      review: { verdict: "pass", notes: ["Tests sit next to the module"], risk: "low" },
      ...input,
    },
    report: { title: "Report", markdown: "# Report\n\n## Summary\nAll good.\n\n## Diff\n```diff\n+secret diff line\n```\n\n## Review\nPass.\n" },
    ...over,
  };
}

function learner(s: MemoryStore, runtime: AgentRuntime, extra: { model?: string } = {}): MemoryLearner {
  return new MemoryLearner({ store: s, runtime, agent: "agentlife-memory", cwd: path.join(tmp, "keeper"), ...extra });
}

describe("retrieval (requirement 3.2)", () => {
  it("keywords drop stop words, split camelCase and paths, and fold a plural", () => {
    expect([...keywords("Validate addTodo titles in src/todo-list.ts")].sort()).toEqual(["list", "title", "todo", "validate"]);
    expect(keywords("the and for")).toEqual(new Set());
  });

  it("ranks by shared keywords and keeps newest first among equals", () => {
    const s = newStore();
    add(s, "Dates are stored as UTC milliseconds.");
    add(s, "Titles must be trimmed before they are saved.");
    add(s, "The build uses pnpm workspaces.");
    add(s, "Overdue todos compare dates with a strict less-than.");
    const ranked = rankMemories(s.list("web"), { goal: "Fix the overdue check for todo dates", files: ["src/dates.ts"] }).map((e) => e.text);
    // Two share "date(s)", one of them also "overdue" and "todo"; the others share nothing and stay newest first.
    expect(ranked[0]).toBe("Overdue todos compare dates with a strict less-than.");
    expect(ranked[1]).toBe("Dates are stored as UTC milliseconds.");
    expect(ranked.slice(2)).toEqual(["The build uses pnpm workspaces.", "Titles must be trimmed before they are saved."]);
  });

  it("ranking never loses or invents an entry", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 40 }), { maxLength: 12 }), fc.string({ maxLength: 60 }), (texts, goal) => {
        const entries: MemoryEntry[] = texts.map((text, i) => ({ id: `mem-${String(i).padStart(6, "0")}`, kind: "finding", text: text || "x", sourceTaskId: "t", createdAt: i }));
        const out = rankMemories(entries, { goal });
        expect(out.map((e) => e.id).sort()).toEqual(entries.map((e) => e.id).sort());
      }),
    );
  });

  it("memoryLines cuts between entries, never inside one", () => {
    const s = newStore();
    for (let i = 0; i < 30; i += 1) add(s, `Note number ${i} ${"word ".repeat(20)}`.trim());
    const text = memoryLines(s.list("web"), 500);
    expect(text.length).toBeLessThanOrEqual(500);
    for (const line of text.split("\n")) expect(line).toMatch(/^- \[convention\] Note number \d+ (word ){19}word$/);
    expect(memoryLines([])).toBe("(none)");
  });

  it("memoryBlock is capped at 4 000 characters of notes, newest first, inside a fence", () => {
    const s = newStore();
    for (let i = 0; i < 60; i += 1) add(s, `Entry ${String(i).padStart(2, "0")} ${"x".repeat(150)}`);
    const block = memoryBlock(s, "web", { goal: "nothing in common" });
    const body = block.split("\n").slice(1, -1).join("\n");
    expect(body.length).toBeLessThanOrEqual(MEMORY_PROMPT_MAX_CHARS);
    expect(body.split("\n")[0]).toContain("Entry 59");
    expect(block.startsWith("```text\n")).toBe(true);
  });

  it("memoryBlock cannot be closed by a note, and an empty or unreadable Library says (none)", () => {
    const s = newStore();
    const note = "Use a fence ```` like this and ``` also";
    s.add("web", { kind: "pitfall", text: note, sourceTaskId: "task-0001" });
    const block = memoryBlock(s, "web", { goal: "fence" });
    const ticks = /^(`+)/.exec(block)![1]!;
    expect(ticks.length).toBeGreaterThan(4);
    expect(block.endsWith(ticks)).toBe(true);
    expect(memoryBlock(undefined, "web", { goal: "x" })).toBe(fence("(none)"));
    expect(memoryBlock(s, "other", { goal: "x" })).toBe(fence("(none)"));
    const broken = { list: () => { throw new Error("disk"); } } as unknown as MemoryStore;
    expect(memoryBlock(broken, "web", { goal: "x" })).toBe(fence("(none)"));
  });

  it("diffFiles lists the files a patch touches", () => {
    expect(diffFiles("diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\ndiff --git a/test/a.test.ts b/test/a.test.ts\n")).toEqual(["src/a.ts", "test/a.test.ts"]);
  });
});

describe("learning after a job (requirement 2)", () => {
  it("proposes at most five entries, checked and not stored", async () => {
    const s = newStore();
    const many = Array.from({ length: 8 }, (_, i) => ({ kind: "convention", text: `Convention number ${i} for the project` }));
    const rt = scripted([json({ entries: many })]);
    const result = await learner(s, rt).learn(finished());
    expect(result.proposed).toHaveLength(MEMORY_PROPOSALS_MAX);
    expect(result.stored).toEqual([]);
    expect(s.list("web")).toEqual([]);
    expect(s.proposals("web", "task-aaaa1111")).toHaveLength(MEMORY_PROPOSALS_MAX);
  });

  it("drops a note with a path, a secret or a repeat, and keeps the rest", async () => {
    const s = newStore();
    add(s, "Tests live next to the module.");
    const token = ["sk", "y".repeat(24)].join("-");
    const rt = scripted([
      json({
        entries: [
          { kind: "pitfall", text: "Edit D:\\work\\app\\src\\todo.ts by hand" },
          { kind: "pitfall", text: `The key is ${token}` },
          { kind: "convention", text: "tests live next to the module." },
          { kind: "decision", text: "Titles are trimmed before they are checked." },
        ],
      }),
    ]);
    const result = await learner(s, rt).learn(finished());
    expect(result.proposed.map((p) => p.text)).toEqual(["Titles are trimmed before they are checked."]);
    expect(JSON.stringify(readFileSync(path.join(tmp, "memory", "web.proposals.json"), "utf8"))).not.toContain(token);
  });

  it("an answer with no entries is a good answer", async () => {
    const result = await learner(newStore(), scripted([json({ entries: [] })])).learn(finished());
    expect(result).toEqual({ proposed: [], stored: [] });
  });

  it("asks once more when the reply is not valid, then gives up with an error", async () => {
    const s = newStore();
    const rt = scripted(["no block here", json({ entries: [{ kind: "nonsense", text: "x" }] })]);
    await expect(learner(s, rt).learn(finished())).rejects.toThrow(/invalid output after one retry/);
    expect(rt.inputs).toHaveLength(2);
    expect(rt.inputs[1]!.prompt).toContain("rejected by the engine's validator");
    expect(s.proposals("web")).toEqual([]);
  });

  it("start never throws and a failed model costs nothing", async () => {
    const s = newStore();
    const warnings: string[] = [];
    const k = new MemoryLearner({
      store: s,
      runtime: scripted(["garbage", "garbage"]),
      agent: "agentlife-memory",
      cwd: path.join(tmp, "keeper"),
      logger: { ...noopLogger, warn: (m: string) => void warnings.push(m) },
    });
    k.start(finished());
    expect(k.learningOf("web")).toEqual(["task-aaaa1111"]);
    await k.idle();
    expect(k.learningOf("web")).toEqual([]);
    expect(warnings).toEqual(["learning from the job failed"]);
  });

  it("stores the proposals at once when the project auto-remembers, and leaves out what does not fit", async () => {
    const s = newStore();
    s.setAutoRemember("web", true);
    const rt = scripted([json({ entries: [{ kind: "decision", text: "Prices are integers in cents." }, { kind: "finding", text: "The cache is cleared on every start." }] })]);
    const result = await learner(s, rt).learn(finished());
    expect(result.stored.map((e) => e.text)).toEqual(["Prices are integers in cents.", "The cache is cleared on every start."]);
    expect(result.proposed).toEqual([]);
    expect(s.proposals("web")).toEqual([]);
    expect(s.list("web").map((e) => e.sourceTaskId)).toEqual(["task-aaaa1111", "task-aaaa1111"]);
    // Another project is not affected.
    expect(s.autoRemember("blog")).toBe(false);
  });

  it("the prompt holds the plan, the review and the sections of the report, as data, and not the diff", async () => {
    const s = newStore();
    add(s, "Already known note.");
    const rt = scripted([json({ entries: [] })]);
    await learner(s, rt, { model: "qwen3.5:4b" }).learn(finished());
    const input = rt.inputs[0]!;
    expect(input.step).toBe("memory");
    expect(input.model).toBe("qwen3.5:4b");
    expect(input.agent).toBe("agentlife-memory");
    expect(input.prompt).toContain("Reject empty titles");
    expect(input.prompt).toContain("Tests sit next to the module");
    expect(input.prompt).toContain("Already known note.");
    expect(input.prompt).toContain("All good.");
    expect(input.prompt).not.toContain("secret diff line");
    expect(input.prompt).toMatch(/Untrusted-content rule/);
  });

  it("does not learn from a dependency audit or from a job with nothing to read", async () => {
    const rt = scripted([json({ entries: [{ kind: "finding", text: "Never reached." }] })]);
    const k = learner(newStore(), rt);
    expect(worthLearning(finished({}, { kind: "audit-deps" }))).toBe(false);
    const bare = finished();
    delete bare.input.plan;
    delete bare.input.review;
    expect(worthLearning(bare)).toBe(false);
    k.start(finished({}, { kind: "audit-deps" }));
    await k.idle();
    expect(rt.inputs).toHaveLength(0);
  });

  it("reportDigest keeps summary, review and notes and drops the diff and the test log", () => {
    const md = "# T\n\n## Summary\nS\n\n## Diff\nD\n\n## Test log\nL\n\n## Notes\nN\n";
    expect(reportDigest(md)).toBe("## Summary\nS\n\n## Notes\nN");
  });

  it("works through the intern: the local model first, the cheap model when Ollama is down", async () => {
    const s = newStore();
    const local: AgentRuntime = { id: "ollama", async *run() { throw new OllamaUnavailableError("The local model is not running."); } };
    const fallback = scripted([json({ entries: [{ kind: "pitfall", text: "Do not skip the empty title check." }] })]);
    const intern = new InternRuntime({ local, fallback });
    const result = await learner(s, intern, { model: "qwen3.5:4b" }).learn(finished());
    expect(result.proposed.map((p) => p.text)).toEqual(["Do not skip the empty title check."]);
    expect(fallback.inputs[0]!.model).toBe("claude-haiku-5.5");
  });
});

describe("the Library over HTTP (requirement 2.2)", () => {
  let engine: Engine | undefined;
  afterEach(async () => {
    await engine?.close();
    engine = undefined;
  });

  const call = (url: string, method: string, body?: unknown) =>
    fetch(url, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  async function runJob(e: Engine): Promise<string> {
    const url = `http://127.0.0.1:${e.port}`;
    const { taskId } = (await (await call(`${url}/tasks`, "POST", { repoId: "haunted-todo", goal: "Fix the overdue check" })).json()) as { taskId: string };
    const end = Date.now() + 3000;
    while (e.store.getJob(taskId)?.state !== "awaiting_plan_approval") {
      if (Date.now() > end) throw new Error("no approval");
      await new Promise((r) => setTimeout(r, 5));
    }
    e.runner.resolveApproval(e.store.getJob(taskId)!.approvals[0]!.approvalId, "approve");
    await e.runner.done(taskId);
    return taskId;
  }

  async function boot(replies: string[]): Promise<{ url: string; engine: Engine; runtime: ReturnType<typeof scripted> }> {
    const runtime = scripted(replies);
    engine = await startEngine({
      storeOptions: { dbPath: ":memory:", runsDir: path.join(tmp, "runs") },
      dataDir: tmp,
      port: 0,
      memory: { runtime, secrets: [] },
    });
    return { url: `http://127.0.0.1:${engine.port}`, engine, runtime };
  }

  it("a delivered job leads to proposals; the user accepts one, edits one and dismisses one", async () => {
    const { url, engine: e } = await boot([
      json({
        entries: [
          { kind: "convention", text: "Overdue is a strict less-than on the due date." },
          { kind: "pitfall", text: "The due date has no time zone." },
          { kind: "finding", text: "The seeded bug lives in the date helpers." },
        ],
      }),
    ]);
    const taskId = await runJob(e);
    await e.memory.learner!.idle();

    let state = MemoryStateSchema.parse(await (await call(`${url}/projects/haunted-todo/memory`, "GET")).json());
    expect(state.entries).toEqual([]);
    expect(state.proposals.map((p) => p.sourceTaskId)).toEqual([taskId, taskId, taskId]);
    expect(state.learning).toEqual([]);

    const [first, second, third] = state.proposals;
    const accepted = await call(`${url}/projects/haunted-todo/memory/proposals/${first!.id}/accept`, "POST", {});
    expect(accepted.status).toBe(201);
    const edited = await call(`${url}/projects/haunted-todo/memory/proposals/${second!.id}/accept`, "POST", { text: "Due dates are UTC.", kind: "decision" });
    expect(edited.status).toBe(201);
    expect((await call(`${url}/projects/haunted-todo/memory/proposals/${third!.id}`, "DELETE")).status).toBe(200);

    state = MemoryStateSchema.parse(await (await call(`${url}/projects/haunted-todo/memory`, "GET")).json());
    expect(state.proposals).toEqual([]);
    expect(state.entries.map((x) => [x.kind, x.text])).toEqual([
      ["decision", "Due dates are UTC."],
      [first!.kind, first!.text],
    ]);
  });

  it("refuses an edit with a path or a token (400, without repeating the text), and edits and deletes entries", async () => {
    const { url, engine: e } = await boot(["unused"]);
    const entry = e.memory.store.add("haunted-todo", { kind: "finding", text: "Seeded bug in isOverdue.", sourceTaskId: "task-0001" });
    const base = `${url}/projects/haunted-todo/memory/${entry.id}`;

    const bad = await call(base, "PATCH", { text: `See ${["C:", "Users", "jdoe", "app", "x.ts"].join("\\")}` });
    expect(bad.status).toBe(400);
    const body = JSON.stringify(await bad.json());
    expect(body).toContain("memory_path_or_secret");
    expect(body).not.toContain("jdoe");

    expect((await call(base, "PATCH", {})).status).toBe(400);
    const ok = await call(base, "PATCH", { text: "Seeded bug in isOverdue (<= instead of <).", kind: "pitfall" });
    expect(ok.status).toBe(200);
    expect(e.memory.store.get("haunted-todo", entry.id)).toMatchObject({ kind: "pitfall", text: "Seeded bug in isOverdue (<= instead of <)." });

    expect((await call(base, "DELETE")).status).toBe(200);
    expect((await call(base, "DELETE")).status).toBe(404);
  });

  it("auto-remember is a per-project switch, and an unknown project is a 404", async () => {
    const { url } = await boot(["unused"]);
    const res = await call(`${url}/projects/haunted-todo/memory/settings`, "PUT", { autoRemember: true });
    expect(MemoryStateSchema.parse(await res.json()).autoRemember).toBe(true);
    expect((await call(`${url}/projects/nope/memory`, "GET")).status).toBe(404);
    expect((await call(`${url}/projects/haunted-todo/memory/settings`, "PUT", { autoRemember: "yes" })).status).toBe(400);
  });

  it("with auto-remember the notes are stored without asking", async () => {
    const { url, engine: e } = await boot([json({ entries: [{ kind: "convention", text: "Run the tests with npm test." }] })]);
    await call(`${url}/projects/haunted-todo/memory/settings`, "PUT", { autoRemember: true });
    await runJob(e);
    await e.memory.learner!.idle();
    const state = MemoryStateSchema.parse(await (await call(`${url}/projects/haunted-todo/memory`, "GET")).json());
    expect(state.proposals).toEqual([]);
    expect(state.entries.map((x) => x.text)).toEqual(["Run the tests with npm test."]);
    expect(existsSync(path.join(tmp, "memory", "haunted-todo.jsonl"))).toBe(true);
  });

  it("without a librarian runtime nothing is learned and the Library still answers", async () => {
    engine = await startEngine({ storeOptions: { dbPath: ":memory:", runsDir: path.join(tmp, "runs") }, dataDir: tmp, port: 0 });
    expect(engine.memory.learner).toBeUndefined();
    const res = await call(`http://127.0.0.1:${engine.port}/projects/haunted-todo/memory`, "GET");
    expect(MemoryStateSchema.parse(await res.json())).toEqual({ entries: [], proposals: [], autoRemember: false, learning: [] });
  });
});

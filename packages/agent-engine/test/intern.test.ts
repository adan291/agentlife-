import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TemplateSchema, tierForRole } from "@agentlife/shared";
import { createActivityEmitter } from "../src/activity.ts";
import { dataPaths } from "../src/paths.ts";
import { DEFAULT_OLLAMA_URL, isLoopbackUrl, OllamaRuntime, OllamaUnavailableError, stripThinking } from "../src/runtimes/ollama.ts";
import type { AgentRuntime, RuntimeEvent, RuntimeInput } from "../src/runtimes/types.ts";
import { runRole, type PipelineDeps } from "../src/steps/deps.ts";
import { JobNotes } from "../src/steps/notes.ts";
import { buildReport } from "../src/steps/report.ts";
import { Store } from "../src/store.ts";
import { Catalogue } from "../src/team/catalogue.ts";
import { parseImport } from "../src/team/import.ts";
import { INTERN_FALLBACK_MODEL, INTERN_STEPS, InternNotAllowedError, InternRuntime, isInternStep } from "../src/team/intern.ts";
import { ModelDirectory, loadTeamRules } from "../src/team/models.ts";
import { TeamService, type ResolvedMember } from "../src/team/service.ts";
import { TeamStore } from "../src/team/store.ts";
import { loadTiers } from "../src/team/tiers.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "al-intern-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const catalogue = new Catalogue();
const tiers = loadTiers();
const signal = new AbortController().signal;

function input(over: Partial<RuntimeInput> = {}): RuntimeInput {
  return { role: "architect", step: "summary", prompt: "Summarise this.", cwd: tmp, timeoutMs: 5000, signal, model: "qwen3.5:4b", system: "You are the intern.", ...over };
}

async function collect(rt: AgentRuntime, i: RuntimeInput): Promise<RuntimeEvent[]> {
  const out: RuntimeEvent[] = [];
  for await (const ev of rt.run(i)) out.push(ev);
  return out;
}

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the Night intern template", () => {
  it("is a built-in researcher in the read-only tier that runs on Ollama with qwen3.5:4b", () => {
    const t = catalogue.get("night-intern");
    expect(t).toMatchObject({ role: "researcher", tier: "read-only", runtime: "ollama", defaultModel: "qwen3.5:4b", source: "built-in" });
    expect(tierForRole("researcher")).toBe("read-only");
    expect(catalogue.entries().find((e) => e.id === "night-intern")).toMatchObject({ runtime: "ollama", origin: "built-in" });
    // Templates that run on kiro-cli say nothing about the runtime.
    expect(catalogue.entries().find((e) => e.id === "qa")).not.toHaveProperty("runtime");
  });

  it("cannot be declared for any other role or for an imported source", () => {
    const base = { id: "x-intern", name: "X", persona: "p", description: "d", defaultModel: "qwen3.5:4b", runtime: "ollama" };
    expect(TemplateSchema.safeParse({ ...base, role: "researcher", tier: "read-only", source: "built-in" }).success).toBe(true);
    expect(TemplateSchema.safeParse({ ...base, role: "qa", tier: "read-only", source: "built-in" }).success).toBe(false);
    expect(TemplateSchema.safeParse({ ...base, role: "developer", tier: "write-in-worktree", source: "built-in" }).success).toBe(false);
    expect(TemplateSchema.safeParse({ ...base, role: "researcher", tier: "read-only", source: "https://example.test/x.json" }).success).toBe(false);
  });

  it("is not something an import can ask for: the runtime field is dropped and listed", () => {
    const r = parseImport(
      { id: "sneaky", name: "Sneaky", role: "researcher", persona: "Reads things.", description: "Reads.", defaultModel: "claude-haiku-5.5", runtime: "ollama" },
      "https://example.test/sneaky.json",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.template.runtime).toBeUndefined();
    expect(r.ignored).toContain("runtime");
  });
});

describe("isInternStep", () => {
  it("accepts the small read-only steps and nothing a pipeline needs tools for", () => {
    for (const s of INTERN_STEPS) expect(isInternStep(s)).toBe(true);
    for (const s of ["analyze", "develop", "review", "test", "report", "plan", "", undefined]) expect(isInternStep(s)).toBe(false);
  });
});

describe("OllamaRuntime", () => {
  it("posts the persona and the prompt to the local chat endpoint and returns the answer and the tokens", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const rt = new OllamaRuntime({
      baseUrl: "http://127.0.0.1:11434/",
      fetch: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return jsonResponse({ message: { content: "<think>hmm</think>\nThree plain sentences." }, prompt_eval_count: 30, eval_count: 12 });
      },
    });
    const events = await collect(rt, input());
    expect(events).toEqual([
      { kind: "output", text: "Three plain sentences." },
      { kind: "usage", tokens: 42 },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(calls[0]!.body).toMatchObject({
      model: "qwen3.5:4b",
      stream: false,
      think: false,
      messages: [
        { role: "system", content: "You are the intern." },
        { role: "user", content: "Summarise this." },
      ],
    });
  });

  it("says the model is unavailable when it is not running, not installed, empty or too slow", async () => {
    const make = (fetch: typeof globalThis.fetch): OllamaRuntime => new OllamaRuntime({ baseUrl: DEFAULT_OLLAMA_URL, fetch });
    await expect(collect(make(async () => Promise.reject(new TypeError("fetch failed"))), input())).rejects.toThrow(/not running/);
    await expect(collect(make(async () => jsonResponse({ error: "model not found" }, 404)), input())).rejects.toThrow(/not installed/);
    await expect(collect(make(async () => jsonResponse({}, 500)), input())).rejects.toThrow(/answered 500/);
    await expect(collect(make(async () => jsonResponse({ message: { content: "<think>only thoughts</think>" } })), input())).rejects.toBeInstanceOf(OllamaUnavailableError);
    await expect(collect(make(async () => new Response("not json")), input())).rejects.toBeInstanceOf(OllamaUnavailableError);
    const slow = make((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    await expect(collect(slow, input({ timeoutMs: 20 }))).rejects.toThrow(/did not answer in time/);
  });

  it("never sends a prompt to an address that is not on this computer", async () => {
    let called = false;
    const rt = new OllamaRuntime({ baseUrl: "http://ollama.example.test:11434", fetch: async () => ((called = true), jsonResponse({})) });
    await expect(collect(rt, input())).rejects.toThrow(/not on this computer/);
    expect(called).toBe(false);
    expect(isLoopbackUrl("http://localhost:11434")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:11434")).toBe(true);
    expect(isLoopbackUrl("http://127.0.0.1.example.test")).toBe(false);
    expect(isLoopbackUrl("http://user:pw@127.0.0.1")).toBe(false);
    expect(isLoopbackUrl("ftp://127.0.0.1")).toBe(false);
  });

  it("passes a cancellation on as it is", async () => {
    const ac = new AbortController();
    const rt = new OllamaRuntime({ baseUrl: DEFAULT_OLLAMA_URL, fetch: (_url, init) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("cancelled by user")))) });
    const p = collect(rt, input({ signal: ac.signal }));
    ac.abort(new Error("cancelled by user"));
    await expect(p).rejects.not.toBeInstanceOf(OllamaUnavailableError);
  });

  it("strips reasoning blocks", () => {
    expect(stripThinking("<think>a\nb</think>\n\nAnswer")).toBe("Answer");
    expect(stripThinking("a long reasoning that lost its opening</think>Answer")).toBe("Answer");
    expect(stripThinking("Plain")).toBe("Plain");
  });
});

describe("InternRuntime", () => {
  const scripted = (events: RuntimeEvent[], seen: RuntimeInput[] = []): AgentRuntime => ({
    id: "scripted",
    async *run(i) {
      seen.push(i);
      for (const e of events) yield e;
    },
  });
  const unavailable: AgentRuntime = {
    id: "down",
    // eslint-disable-next-line require-yield
    async *run() {
      throw new OllamaUnavailableError("The local model is not running.");
    },
  };

  it("refuses plan, develop and review steps before anything runs", async () => {
    const seenLocal: RuntimeInput[] = [];
    const seenFallback: RuntimeInput[] = [];
    const rt = new InternRuntime({ local: scripted([{ kind: "output", text: "x" }], seenLocal), fallback: scripted([{ kind: "output", text: "y" }], seenFallback) });
    for (const step of ["analyze", "develop", "review"]) {
      await expect(collect(rt, input({ step }))).rejects.toBeInstanceOf(InternNotAllowedError);
    }
    // A call with no step name at all is refused too.
    const { step: _unused, ...noStep } = input();
    await expect(collect(rt, noStep)).rejects.toBeInstanceOf(InternNotAllowedError);
    expect(seenLocal).toEqual([]);
    expect(seenFallback).toEqual([]);
  });

  it("uses the local model when it answers and says nothing about a fallback", async () => {
    const fallbackSeen: RuntimeInput[] = [];
    const rt = new InternRuntime({ local: scripted([{ kind: "output", text: "local" }]), fallback: scripted([{ kind: "output", text: "cloud" }], fallbackSeen) });
    expect(await collect(rt, input())).toEqual([{ kind: "output", text: "local" }]);
    expect(fallbackSeen).toEqual([]);
  });

  it("falls back to claude-haiku-5.5 with the same read-only agent, and reports it first", async () => {
    const fallbackSeen: RuntimeInput[] = [];
    const lines: string[] = [];
    const rt = new InternRuntime({ local: unavailable, fallback: scripted([{ kind: "output", text: "cloud" }], fallbackSeen), onFallback: (m) => lines.push(m) });
    const events = await collect(rt, input({ agent: "alpha-researcher-1", step: "overview" }));
    expect(events[0]).toEqual({ kind: "fallback", from: "qwen3.5:4b", to: INTERN_FALLBACK_MODEL, reason: "The local model is not running." });
    expect(events[1]).toEqual({ kind: "output", text: "cloud" });
    expect(fallbackSeen[0]).toMatchObject({ agent: "alpha-researcher-1", model: INTERN_FALLBACK_MODEL, step: "overview" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("overview");
  });

  it("does not fall back on a cancellation or on an error that is not about the local model", async () => {
    const fallbackSeen: RuntimeInput[] = [];
    const broken: AgentRuntime = {
      id: "broken",
      // eslint-disable-next-line require-yield
      async *run() {
        throw new Error("something else");
      },
    };
    const rt = new InternRuntime({ local: broken, fallback: scripted([{ kind: "output", text: "cloud" }], fallbackSeen) });
    await expect(collect(rt, input())).rejects.toThrow("something else");
    const ac = new AbortController();
    ac.abort(new Error("cancelled"));
    const rt2 = new InternRuntime({ local: unavailable, fallback: scripted([{ kind: "output", text: "cloud" }], fallbackSeen) });
    await expect(collect(rt2, input({ signal: ac.signal }))).rejects.toThrow();
    expect(fallbackSeen).toEqual([]);
  });
});

describe("hiring the intern", () => {
  const rules = loadTeamRules();
  function service(kiroHome: string): TeamService {
    return new TeamService({
      store: new TeamStore({ file: path.join(tmp, "teams.json") }),
      catalogue,
      models: new ModelDirectory({ rules }),
      tiers,
      hasProject: (id) => id === "alpha",
      agents: { kiroHome },
      newId: () => "000001",
    });
  }

  it("takes its own model without the account's list, and writes a read-only agent file for the fallback", async () => {
    const kiroHome = path.join(tmp, "kiro-home");
    const s = service(kiroHome);
    const member = await s.hire("alpha", { templateId: "night-intern", displayName: "Ines" });
    expect(member).toMatchObject({ role: "researcher", model: "qwen3.5:4b", templateId: "night-intern" });
    const file = JSON.parse(readFileSync(path.join(kiroHome, "agents", `alpha-${member.id}.json`), "utf8")) as { model: string; tools: unknown; permissions: unknown };
    expect(file.model).toBe(INTERN_FALLBACK_MODEL);
    expect(file.tools).toEqual(tiers["read-only"].tools);
    expect(file.permissions).toEqual(tiers["read-only"].permissions);
    // The model of a kiro-cli template is still checked against the account's list.
    await expect(s.hire("alpha", { templateId: "qa", displayName: "Quin", model: "qwen3.5:4b" })).rejects.toMatchObject({ code: "model_not_allowed" });
    // The intern can change to another local model.
    await expect(s.update("alpha", member.id, { model: "llama3.2:3b" })).resolves.toMatchObject({ model: "llama3.2:3b" });
  });

  it("is resolved as a local member with the persona as its system prompt", async () => {
    const s = service(path.join(tmp, "kiro-home"));
    const member = await s.hire("alpha", { templateId: "night-intern", displayName: "Ines" });
    const resolved = s.resolve("alpha", "job-1", "researcher");
    expect(resolved).toMatchObject({ memberId: member.id, agent: `alpha-${member.id}`, model: "qwen3.5:4b", runtime: "ollama" });
    expect(resolved?.system).toContain("Night intern");
    expect(resolved?.system).toContain("You are read-only");
    // A kiro-cli member carries neither.
    expect(s.resolve("alpha", "job-1", "qa")).not.toHaveProperty("runtime");
  });
});

describe("runRole with the intern", () => {
  const ctx = { taskId: "task-1", repoId: "alpha", goal: "g", signal, timeoutMs: 1000, stepIndex: 1 };
  const intern: ResolvedMember = { memberId: "researcher-1", agent: "alpha-researcher-1", model: "qwen3.5:4b", displayName: "Ines", runtime: "ollama", system: "You are the intern." };

  function setup(over: { intern?: AgentRuntime | undefined; notes?: JobNotes } = {}): { deps: PipelineDeps; store: Store; kiro: RuntimeInput[]; close: () => void } {
    const store = new Store({ dbPath: ":memory:", runsDir: path.join(tmp, "runs") });
    const kiro: RuntimeInput[] = [];
    const rt: AgentRuntime = {
      id: "kiro",
      async *run(i) {
        kiro.push(i);
        yield { kind: "output", text: "kiro" };
      },
    };
    store.appendEvent({ type: "task.created", taskId: "task-1", repoId: "alpha", goal: "g" });
    const deps: PipelineDeps = {
      runtimes: { architect: rt, developer: rt, qa: rt },
      store,
      paths: dataPaths(path.join(tmp, "data")),
      repos: [],
      limits: { timeoutsMs: { analyze: 1, develop: 1, test: 1, review: 1 }, maxDiffLines: 1, maxFilesChanged: 1 },
      team: { resolve: () => intern },
      activity: createActivityEmitter({ append: (ev) => store.appendEvent(ev) }),
      ...("intern" in over ? (over.intern ? { intern: over.intern } : {}) : {}),
      ...(over.notes ? { notes: over.notes } : {}),
    };
    return { deps, store, kiro, close: () => store.close() };
  }

  it("refuses to give the intern the plan, develop or review steps, and never starts a runtime", async () => {
    const calls: string[] = [];
    const spy: AgentRuntime = {
      id: "spy",
      async *run() {
        calls.push("intern");
        yield { kind: "output", text: "x" };
      },
    };
    const h = setup({ intern: spy });
    try {
      for (const [role, step] of [["architect", "analyze"], ["developer", "develop"], ["qa", "review"]] as const) {
        await expect(runRole(h.deps, role, step, ctx, "p", tmp)).rejects.toBeInstanceOf(InternNotAllowedError);
      }
      expect(calls).toEqual([]);
      expect(h.kiro).toEqual([]);
    } finally {
      h.close();
    }
  });

  it("sends an allowed step to the intern runtime with the model and the persona", async () => {
    const seen: RuntimeInput[] = [];
    const spy: AgentRuntime = {
      id: "spy",
      async *run(i) {
        seen.push(i);
        yield { kind: "output", text: "A short summary." };
      },
    };
    const h = setup({ intern: spy });
    try {
      const out = await runRole(h.deps, "architect", "summary", ctx, "p", tmp);
      expect(out).toBe("A short summary.");
      expect(seen[0]).toMatchObject({ step: "summary", model: "qwen3.5:4b", agent: "alpha-researcher-1", system: "You are the intern." });
      expect(h.kiro).toEqual([]);
    } finally {
      h.close();
    }
  });

  it("says so when the engine has no intern runtime", async () => {
    const h = setup({ intern: undefined });
    try {
      await expect(runRole(h.deps, "architect", "summary", ctx, "p", tmp)).rejects.toThrow(/not available/);
    } finally {
      h.close();
    }
  });

  it("records the fallback for the report and the log, and the report mentions it", async () => {
    const notes = new JobNotes();
    const local: AgentRuntime = {
      id: "down",
      // eslint-disable-next-line require-yield
      async *run() {
        throw new OllamaUnavailableError("The local model is not running.");
      },
    };
    const cloud: AgentRuntime = {
      id: "cloud",
      async *run() {
        yield { kind: "output", text: "Done by the cloud model." };
      },
    };
    const h = setup({ intern: new InternRuntime({ local, fallback: cloud }), notes });
    try {
      const out = await runRole(h.deps, "architect", "overview", ctx, "p", tmp);
      expect(out).toBe("Done by the cloud model.");
      const log = h.store.readRunLog("task-1", "overview");
      expect(log.find((l) => l["kind"] === "fallback")).toMatchObject({ from: "qwen3.5:4b", to: INTERN_FALLBACK_MODEL, reason: "The local model is not running." });
      const lines = h.store.eventsFor("task-1").flatMap((e) => (e.type === "agent.activity" ? [e.text] : []));
      expect(lines.some((t) => t.includes(INTERN_FALLBACK_MODEL))).toBe(true);

      expect(notes.get("task-1")).toHaveLength(1);
      const report = buildReport({ goal: "g", verdict: "pass" }, [], notes.get("task-1"));
      expect(report.markdown).toContain("## Notes");
      expect(report.markdown).toContain(INTERN_FALLBACK_MODEL);
      expect(report.markdown).toContain("spends credits");
      // No note, no section.
      expect(buildReport({ goal: "g", verdict: "pass" }).markdown).not.toContain("## Notes");
    } finally {
      h.close();
    }
  });
});

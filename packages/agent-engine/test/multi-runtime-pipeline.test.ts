import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentsConfigSchema, loadConfig } from "../src/config.ts";
import { buildRuntimes, roleProviders } from "../src/engine.ts";
import { PROJECT_ROOT } from "../src/paths.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { ProjectRegistry } from "../src/projects/registry.ts";
import { OpenAICompatRuntime } from "../src/runtimes/openai-compat.ts";
import { runtimeForStep } from "../src/steps/deps.ts";
import { jobHarness, makeRepo, runJob, type JobHarness } from "./helpers.ts";

let tmp: string;
let hotel: string;
let harness: JobHarness | undefined;
let server: http.Server | undefined;
beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "al-multi-")));
  hotel = path.join(tmp, "hotel");
  mkdirSync(hotel, { recursive: true });
});
afterEach(async () => {
  harness?.close();
  harness = undefined;
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const FENCE = "```";
const json = (v: unknown) => `${FENCE}json\n${JSON.stringify(v)}\n${FENCE}`;
const PLAN = { tasks: [{ id: "t1", title: "Improve the readme", why: "It is short.", files: ["README.md"], acceptance: "README.md says more", risk: "low" }] };

/**
 * A chat-completions server that plays the three roles. Each role reads a file first (a tool call), then answers: the
 * Architect a plan, the Developer writes README.md, QA a passing review.
 */
async function scriptedAI(): Promise<{ url: string; roles: string[] }> {
  const roles: string[] = [];
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw) as { messages: { role: string; content: string | null }[] };
      const prompt = body.messages.find((m) => m.role === "user")?.content ?? "";
      const role = prompt.startsWith("You are the Architect") ? "architect" : prompt.startsWith("You are the Developer") ? "developer" : "qa";
      const afterTool = body.messages.at(-1)?.role === "tool";
      const reply = (message: object) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message }], usage: { total_tokens: 42 } }));
      };
      const call = (name: string, args: object) => ({ content: "", tool_calls: [{ id: `c-${role}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
      if (!afterTool) {
        roles.push(role);
        if (role === "developer") return reply(call("write_file", { path: "README.md", content: "# Demo\n\nA longer readme, written by another AI.\n" }));
        return reply(call("read_file", { path: "README.md" }));
      }
      if (role === "architect") return reply({ content: json(PLAN) });
      if (role === "developer") return reply({ content: "Made the readme longer." });
      return reply({ content: json({ verdict: "pass", notes: ["Looks fine."], risk: "low" }) });
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1`, roles };
}

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

/** A project without package.json: the test step is skipped, so no Docker is needed. */
async function project(): Promise<ProjectRegistry> {
  const dir = await makeRepo(path.join(hotel, "demo"), { "README.md": "# Demo\n" });
  const reg = registry();
  await reg.register({ path: dir, name: "demo" });
  return reg;
}

describe("a job with several AI providers at once", () => {
  it("runs the Architect and QA on another AI and the Developer on the scripted runtime, and names each provider", async () => {
    const ai = await scriptedAI();
    harness = jobHarness(tmp, await project());
    const other = new OpenAICompatRuntime({ providerId: "scripted-ai", label: "Scripted AI", baseUrl: ai.url, defaultModel: "m-test" });
    harness.deps.runtimes.architect = other;
    harness.deps.runtimes.qa = other;
    harness.deps.providers = { runtime: (id) => (id === "scripted-ai" ? other : undefined), label: (id) => (id === "scripted-ai" ? "Scripted AI" : undefined) };
    harness.deps.roleProviders = { architect: "scripted-ai", qa: "scripted-ai" };
    harness.deps.models = { architect: "m-arch", qa: "m-qa" };
    const taskId = await runJob(harness, "demo");
    const job = harness.store.getJob(taskId)!;
    expect(job.state).toBe("delivered");
    expect(ai.roles).toEqual(["architect", "qa"]);
    // The Developer (scripted runtime) changed the readme in the job's clone.
    expect(harness.runtime.inputs.map((i) => i.role)).toEqual(["developer"]);
    const byStep = Object.fromEntries(job.steps.map((s) => [s.step, s]));
    expect(byStep["analyze"]).toMatchObject({ status: "ok", model: "m-arch (Scripted AI)", filesRead: 1 });
    expect(byStep["review"]).toMatchObject({ status: "ok", model: "m-qa (Scripted AI)" });
    const report = harness.store.artifactsFor(taskId).find((a) => a.kind === "report")!;
    expect(report.content).toContain("m-arch (Scripted AI)");
  });

  it("runs all three roles on another AI: the Developer's write lands in the clone and passes the diff check", async () => {
    const ai = await scriptedAI();
    harness = jobHarness(tmp, await project());
    const other = new OpenAICompatRuntime({ providerId: "scripted-ai", label: "Scripted AI", baseUrl: ai.url, defaultModel: "m-test" });
    harness.deps.runtimes = { architect: other, developer: other, qa: other };
    harness.deps.providers = { runtime: () => other, label: () => "Scripted AI" };
    harness.deps.roleProviders = { architect: "scripted-ai", developer: "scripted-ai", qa: "scripted-ai" };
    harness.deps.models = { architect: "m-arch", developer: "m-dev", qa: "m-qa" };
    const taskId = await runJob(harness, "demo");
    const job = harness.store.getJob(taskId)!;
    expect(job.state).toBe("delivered");
    expect(ai.roles).toEqual(["architect", "developer", "qa"]);
    const dev = job.steps.find((s) => s.step === "develop")!;
    expect(dev).toMatchObject({ status: "ok", model: "m-dev (Scripted AI)", filesEdited: 1 });
    const patch = harness.store.artifactsFor(taskId).find((a) => a.kind === "diff")!;
    expect(patch.content).toContain("written by another AI");
    expect(readFileSync(path.join(hotel, "demo", "README.md"), "utf8")).toBe("# Demo\n");
  });
});

describe("config/agents.json with providers", () => {
  it("gives each role its provider's runtime, and a clear failure for one that cannot work", async () => {
    const saved = process.env["RUNTIME"];
    delete process.env["RUNTIME"];
    try {
      const base = loadConfig();
      const config = {
        ...base,
        agents: { ...base.agents, architect: { provider: "ollama", model: "qwen3.5:4b" }, qa: { provider: "xai", model: "grok-4" } },
      };
      expect(AgentsConfigSchema.safeParse(config.agents).success).toBe(true);
      const reg = new ProviderRegistry({ env: {}, kiroAvailable: () => false });
      const rt = buildRuntimes(config, 0, path.join(tmp, "kh"), reg);
      expect(rt.architect.id).toBe("ollama");
      expect(rt.developer.id).toBe("kiro-cli");
      expect(roleProviders(config)).toEqual({ architect: "ollama", qa: "xai" });
      // Grok without XAI_API_KEY: every step says so instead of the engine failing to start.
      const it = rt.qa.run({ role: "qa", prompt: "p", cwd: tmp, timeoutMs: 1000, signal: new AbortController().signal })[Symbol.asyncIterator]();
      await expect(it.next()).rejects.toThrow(/xAI Grok is not available: set its key/);
    } finally {
      if (saved === undefined) delete process.env["RUNTIME"];
      else process.env["RUNTIME"] = saved;
    }
  });
});

describe("runtimeForStep", () => {
  const role = { id: "role" } as never;
  const kiro = { id: "kiro" } as never;
  const groq = { id: "groq" } as never;
  const deps = (over: object = {}) =>
    ({ runtimes: { architect: role, developer: role, qa: role }, kiro, providers: { runtime: (id: string) => (id === "groq" ? groq : undefined), label: (id: string) => (id === "groq" ? "Groq" : id) }, ...over }) as never;

  it("uses the member's provider, Kiro for a member on Kiro, and the role's runtime otherwise", () => {
    expect(runtimeForStep(deps(), "architect", { provider: "groq" })).toEqual({ runtime: groq, provider: "groq" });
    expect(runtimeForStep(deps(), "architect", { provider: "kiro" })).toEqual({ runtime: kiro, provider: undefined });
    expect(runtimeForStep(deps({ roleProviders: { qa: "groq" } }), "qa", undefined)).toEqual({ runtime: role, provider: "groq" });
  });

  it("stops a member on a provider that cannot work, and ignores providers when the engine has none (RUNTIME=fake)", () => {
    expect(() => runtimeForStep(deps(), "qa", { provider: "xai", displayName: "Vera" })).toThrow(/Vera runs on xai, which is not available/);
    expect(runtimeForStep(deps({ providers: undefined }), "qa", { provider: "groq" })).toEqual({ runtime: role, provider: undefined });
  });
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProvidersResponseSchema, type ProviderConfig } from "@agentlife/shared";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { defaultSecretMatcher, resolveInside, runFileTool, ToolRefusedError } from "../src/runtimes/file-tools.ts";
import { OpenAICompatRuntime, ProviderError } from "../src/runtimes/openai-compat.ts";
import type { RuntimeEvent, RuntimeInput } from "../src/runtimes/types.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "al-oac-"));
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "README.md"), "# Demo\nhello world\n");
  writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\nexport function hello() { return 'world'; }\n");
  writeFileSync(path.join(dir, ".env"), "KIRO_API_KEY=nope\n");
  mkdirSync(path.join(dir, ".git"));
  writeFileSync(path.join(dir, ".git", "config"), "[core]\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const call = (name: string, a: object, write = false) => runFileTool(name, JSON.stringify(a), { cwd: dir, write });

describe("file tools", () => {
  it("list, read a slice, and search inside the project", () => {
    expect(call("list_files", {}).text.split("\n")).toEqual(["README.md", "src/"]);
    expect(call("list_files", { recursive: true }).text).toContain("src/a.ts");
    const r = call("read_file", { path: "src/a.ts", start_line: 2, end_line: 2 });
    expect(r.text).toContain("lines 2-2 of 3");
    expect(r.text).toContain("hello");
    expect(r.progress.tool).toEqual({ kind: "read", file: "src/a.ts" });
    expect(call("search", { text: "WORLD" }).text).toContain("README.md:2:");
  });

  it("never lists or reads secret files or .git", () => {
    expect(call("list_files", { recursive: true }).text).not.toMatch(/\.env|\.git/);
    expect(call("read_file", { path: ".env" }).text).toMatch(/^Refused: That file is not available/);
    expect(call("read_file", { path: ".git/config" }).text).toMatch(/^Refused/);
    expect(call("search", { text: "KIRO_API_KEY" }).text).toBe("No match.");
  });

  it("only the Developer writes, and only inside the project", () => {
    expect(call("write_file", { path: "src/b.ts", content: "x" }).text).toMatch(/read-only/);
    const w = call("write_file", { path: "src/new/b.ts", content: "export const b = 2;\n" }, true);
    expect(w.progress.tool).toEqual({ kind: "edit", file: "src/new/b.ts" });
    expect(readFileSync(path.join(dir, "src", "new", "b.ts"), "utf8")).toContain("b = 2");
    expect(call("write_file", { path: "../escape.ts", content: "x" }, true).text).toMatch(/^Refused/);
    expect(call("write_file", { path: ".env", content: "x" }, true).text).toMatch(/^Refused/);
    expect(call("nope", {}).text).toMatch(/no tool named/);
  });

  it("refuses a link that leads out of the project", () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "al-out-"));
    writeFileSync(path.join(outside, "secret.txt"), "outside");
    try {
      symlinkSync(outside, path.join(dir, "link"), "junction");
    } catch {
      return; // no permission to make links on this machine
    }
    expect(call("read_file", { path: "link/secret.txt" }).text).toMatch(/^Refused/);
    rmSync(outside, { recursive: true, force: true });
  });

  it("property: no path from the model resolves outside the project or to a secret", () => {
    const seg = fc.constantFrom("..", ".", "src", "a.ts", ".env", ".git", "C:", "", "x", "..\\..", "/etc", "id_rsa", "~");
    fc.assert(
      fc.property(fc.array(seg, { maxLength: 6 }), fc.constantFrom("/", "\\"), (parts, sep) => {
        const raw = parts.join(sep);
        try {
          const { abs, rel } = resolveInside(dir, raw, defaultSecretMatcher());
          const root = path.resolve(dir);
          expect(abs === root || abs.startsWith(root + path.sep)).toBe(true);
          expect(rel.split("/")).not.toContain("..");
          expect(defaultSecretMatcher()(rel)).toBe(false);
        } catch (e) {
          expect(e).toBeInstanceOf(ToolRefusedError);
        }
      }),
      { numRuns: 400 },
    );
  });
});

// ---- the tool loop against a scripted chat-completions server ----

type Reply = { status?: number; body: unknown } | ((req: { messages: { role: string; content: string | null }[] }) => { status?: number; body: unknown });
async function chatServer(replies: Reply[]) {
  const seen: { auth: string | undefined; body: { model: string; messages: { role: string; content: string | null }[]; tools: unknown[] } }[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ auth: req.headers.authorization, body });
      const next = replies.shift() ?? { status: 500, body: { error: { message: "no more replies" } } };
      const r = typeof next === "function" ? next(body) : next;
      res.writeHead(r.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return { url, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const toolCall = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const answer = (content: string, toolCalls?: object[], tokens = 10) => ({ body: { choices: [{ message: { content, ...(toolCalls ? { tool_calls: toolCalls } : {}) } }], usage: { total_tokens: tokens } } });

function input(over: Partial<RuntimeInput> = {}): RuntimeInput {
  return { role: "architect", prompt: "Plan it.", cwd: dir, timeoutMs: 10_000, signal: new AbortController().signal, model: "m1", ...over };
}
async function collect(rt: OpenAICompatRuntime, inp: RuntimeInput): Promise<RuntimeEvent[]> {
  const out: RuntimeEvent[] = [];
  for await (const ev of rt.run(inp)) out.push(ev);
  return out;
}

describe("OpenAICompatRuntime", () => {
  it("runs the tools the model asks for and returns its final answer", async () => {
    const s = await chatServer([answer("", [toolCall("c1", "read_file", { path: "README.md" })]), answer("```json\n{\"tasks\":[]}\n```")]);
    try {
      const rt = new OpenAICompatRuntime({ providerId: "x", label: "X", baseUrl: s.url, apiKey: "k-test" });
      const evs = await collect(rt, input());
      expect(evs.filter((e) => e.kind === "output").map((e) => (e as { text: string }).text)).toEqual(['```json\n{"tasks":[]}\n```']);
      expect(evs).toContainEqual({ kind: "progress", text: "Reading: README.md", tool: { kind: "read", file: "README.md" } });
      expect(evs.filter((e) => e.kind === "usage")).toHaveLength(2);
      expect(s.seen[0]!.auth).toBe("Bearer k-test");
      expect(s.seen[0]!.body.model).toBe("m1");
      // The tool result went back to the model, and the Architect got no write tool.
      expect(s.seen[1]!.body.messages.at(-1)).toMatchObject({ role: "tool" });
      expect(JSON.stringify(s.seen[0]!.body.tools)).not.toContain("write_file");
      expect(s.seen[0]!.body.messages[0]!.content).toContain("read-only");
    } finally {
      await s.close();
    }
  });

  it("gives the Developer write_file, and its edits land in the folder", async () => {
    const s = await chatServer([answer("", [toolCall("c1", "write_file", { path: "src/a.ts", content: "export const a = 2;\n" })]), answer("Changed a to 2.")]);
    try {
      const rt = new OpenAICompatRuntime({ providerId: "x", label: "X", baseUrl: s.url });
      await collect(rt, input({ role: "developer" }));
      expect(readFileSync(path.join(dir, "src", "a.ts"), "utf8")).toBe("export const a = 2;\n");
      expect(JSON.stringify(s.seen[0]!.body.tools)).toContain("write_file");
    } finally {
      await s.close();
    }
  });

  it("asks a model that never stops calling tools for its answer, without tools, before the limit", async () => {
    const replies: Reply[] = Array.from({ length: 5 }, (_, i) => answer("", [toolCall(`c${i}`, "list_files", { dir: `d${i}` })]));
    const s = await chatServer(replies);
    try {
      const rt = new OpenAICompatRuntime({ providerId: "x", label: "X", baseUrl: s.url, maxRounds: 3 });
      await expect(collect(rt, input())).rejects.toThrow(/no text/);
      expect(s.seen[0]!.body.tools).toBeDefined();
      expect(s.seen[1]!.body.tools).toBeUndefined();
      expect(JSON.stringify(s.seen[1]!.body.messages)).toContain("Stop using tools now");
    } finally {
      await s.close();
    }
  });

  it("wraps up with the model's answer when it gives one after being asked", async () => {
    const replies: Reply[] = [...Array.from({ length: 4 }, (_, i) => answer("", [toolCall(`c${i}`, "list_files", { dir: `d${i}` })])), answer("The plan.")];
    const s = await chatServer(replies);
    try {
      const rt = new OpenAICompatRuntime({ providerId: "x", label: "X", baseUrl: s.url, maxRounds: 6 });
      const events = await collect(rt, input());
      expect(events.find((e) => e.kind === "output")).toMatchObject({ text: "The plan." });
      expect(s.seen).toHaveLength(5);
      expect(s.seen[3]!.body.tools).toBeUndefined();
    } finally {
      await s.close();
    }
  });

  it("reminds once, without tools, when the task asks for a json block and the answer has none", async () => {
    const block = "```json\n{\"ok\":true}\n```";
    const s = await chatServer([answer("Plain prose."), answer(`Plan.\n${block}`)]);
    try {
      const rt = new OpenAICompatRuntime({ providerId: "x", label: "X", baseUrl: s.url });
      const events = await collect(rt, input({ prompt: "Finish your reply with exactly one fenced block tagged json." }));
      expect(events.find((e) => e.kind === "output")).toMatchObject({ text: `Plan.\n${block}` });
      expect(s.seen[1]!.body.tools).toBeUndefined();
      expect(JSON.stringify(s.seen[1]!.body.messages)).toContain("missing the required fenced block");
    } finally {
      await s.close();
    }
  });

  it("does not run the same call twice, and gives an empty answer one more chance", async () => {
    const same = { path: "src/a.ts" };
    const s = await chatServer([answer("", [toolCall("c1", "read_file", same)]), answer("", [toolCall("c2", "read_file", same)]), answer(""), answer("Done.")]);
    try {
      const rt = new OpenAICompatRuntime({ providerId: "x", label: "X", baseUrl: s.url });
      const events = await collect(rt, input());
      expect(events.find((e) => e.kind === "output")).toMatchObject({ text: "Done." });
      const toolMsgs = (s.seen[2]!.body.messages as { role: string; content: string }[]).filter((m) => m.role === "tool");
      expect(toolMsgs[1]!.content).toContain("already made this exact call");
      expect(s.seen[3]!.body.tools).toBeUndefined();
    } finally {
      await s.close();
    }
  });

  it("explains a refused key, a missing model and a quota, and retries a rate limit", async () => {
    const leaked = ["sk", "abcdefghijklmnopqrstuvwxyz0123"].join("-");
    const s = await chatServer([
      { status: 401, body: { error: { message: `Incorrect API key provided: ${leaked}` } } },
      { status: 404, body: { error: { message: "model nope not found" } } },
      { status: 429, body: {} },
      answer("ok after retry"),
      { status: 429, body: {} },
      { status: 429, body: {} },
      { status: 429, body: { error: { message: "quota" } } },
    ]);
    try {
      const rt = new OpenAICompatRuntime({ providerId: "x", label: "X", baseUrl: s.url, apiKey: "secret-key-value", retryDelaysMs: [1, 1] });
      const e401 = (await collect(rt, input()).catch((e: unknown) => e)) as Error;
      expect(e401).toBeInstanceOf(ProviderError);
      expect(e401.message).toMatch(/refused the key \(401\)/);
      expect(e401.message).not.toContain(leaked);
      await expect(collect(rt, input())).rejects.toThrow(/does not know the model 'm1' \(404\)/);
      const ok = await collect(rt, input());
      expect(ok.at(-1)).toEqual({ kind: "output", text: "ok after retry" });
      await expect(collect(rt, input())).rejects.toThrow(/rate limit or quota reached \(429\)/);
    } finally {
      await s.close();
    }
  });

  it("says the provider is not answering, needs a model, and stops on cancel", async () => {
    const rt = new OpenAICompatRuntime({ providerId: "x", label: "Local", baseUrl: "http://127.0.0.1:9/v1" });
    await expect(collect(rt, input())).rejects.toThrow(/Local is not answering/);
    const { model: _m, ...noModel } = input();
    await expect(collect(rt, noModel)).rejects.toThrow(/No model is set/);
    const s = await chatServer([(_req) => ({ body: answer("late").body })]);
    try {
      const ac = new AbortController();
      ac.abort(new Error("cancelled by the user"));
      const rt2 = new OpenAICompatRuntime({ providerId: "x", label: "X", baseUrl: s.url });
      await expect(collect(rt2, input({ signal: ac.signal }))).rejects.toThrow(/cancelled by the user/);
    } finally {
      await s.close();
    }
  });
});

describe("ProviderRegistry", () => {
  const P = (p: Partial<ProviderConfig> & Pick<ProviderConfig, "id" | "kind">): ProviderConfig => ({ label: p.id, local: false, models: [], ...p });

  it("says which providers can work, with a reason, and sends no address or key", async () => {
    const s = await chatServer([]);
    const fakeFetch: typeof fetch = async (url) => {
      if (String(url).startsWith(s.url)) return new Response(JSON.stringify({ data: [{ id: "qwen3.5:4b" }, { id: "bad name!" }] }), { status: 200 });
      throw new Error("down");
    };
    try {
      const keyName = "GROQ_API_KEY";
      const reg = new ProviderRegistry({
        providers: [
          P({ id: "kiro", kind: "kiro-cli" }),
          P({ id: "ollama", kind: "openai-compat", baseUrl: s.url, local: true }),
          P({ id: "lmstudio", kind: "openai-compat", baseUrl: "http://127.0.0.1:9/v1", local: true }),
          P({ id: "remote", kind: "openai-compat", baseUrl: "http://10.0.0.5:11434/v1", local: true }),
          P({ id: "groq", kind: "openai-compat", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: keyName, models: ["llama"] }),
          P({ id: "xai", kind: "openai-compat", baseUrl: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY" }),
        ],
        env: { [keyName]: "gsk-test-value" },
        fetch: fakeFetch,
        kiroAvailable: () => false,
      });
      const views = ProvidersResponseSchema.parse({ providers: await reg.views() }).providers;
      const by = Object.fromEntries(views.map((v) => [v.id, v]));
      expect(by["kiro"]).toMatchObject({ available: false });
      expect(by["ollama"]).toMatchObject({ available: true, local: true, cloud: false, models: ["qwen3.5:4b"] });
      expect(by["lmstudio"]).toMatchObject({ available: false, reason: "lmstudio is not running on this computer." });
      expect(by["remote"]).toMatchObject({ available: false });
      expect(by["groq"]).toMatchObject({ available: true, cloud: true, models: ["llama"] });
      expect(by["xai"]).toMatchObject({ available: false, reason: "Set XAI_API_KEY in .env to use xai." });
      const text = JSON.stringify(views);
      expect(text).not.toContain("gsk-test-value");
      expect(text).not.toContain("127.0.0.1");
      // Runtimes: none for kiro, a remote "local" address, or a cloud provider without its key.
      expect(reg.runtime("kiro")).toBeUndefined();
      expect(reg.runtime("remote")).toBeUndefined();
      expect(reg.runtime("xai")).toBeUndefined();
      expect(reg.runtime("groq")?.id).toBe("groq");
      expect(reg.runtime("groq")).toBe(reg.runtime("groq"));
    } finally {
      await s.close();
    }
  });

  it("the shipped providers.json is valid and has Kiro, Ollama and Grok", () => {
    const ids = new ProviderRegistry({ env: {}, kiroAvailable: () => false }).all().map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["kiro", "ollama", "xai", "groq", "openai", "openrouter", "lmstudio"]));
  });
});

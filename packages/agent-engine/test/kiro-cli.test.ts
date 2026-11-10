import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlanSchema } from "@agentlife/shared";
import { installAgents } from "../src/agents.ts";
import { PROJECT_ROOT } from "../src/paths.ts";
import { buildMinimalEnv, KiroCliError, KiroCliRuntime, type KiroChild, type SpawnFn, type SpawnSpec } from "../src/runtimes/kiro-cli.ts";
import { parseKiroLine } from "../src/runtimes/kiro-cli.schema.ts";
import type { Role, RuntimeEvent, RuntimeInput } from "../src/runtimes/types.ts";
import { loadPromptTemplate, renderPrompt, fence } from "../src/prompts.ts";
import { materialise } from "../src/steps/materialise.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "al-kiro-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const SECRET = "ak-super-secret-123456";

// Record shapes copied from real kiro-cli 3.1.0 output (docs/spikes/kiro-cli.md).
const rec = {
  started: { type: "runStarted", data: { payloadSchema: "acp", acpProtocolVersion: 1, engine: "v3" } },
  thought: (text: string) => ({ type: "sessionUpdate", data: { sessionId: "s", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text } } } }),
  message: (text: string) => ({ type: "sessionUpdate", data: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } }),
  toolCall: (title: string, p?: string) => ({
    type: "sessionUpdate",
    data: { sessionId: "s", update: { sessionUpdate: "tool_call", toolCallId: "t1", title, kind: "edit", status: "in_progress", ...(p ? { locations: [{ path: p }] } : {}) } },
  }),
  toolUpdate: { type: "sessionUpdate", data: { sessionId: "s", update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" } } },
  finished: (finalText: string, extra: Record<string, unknown> = {}) => ({
    type: "runFinished",
    data: { sessionId: "s", status: "success", stopReason: "end_turn", finalText, finalTextTruncated: false, ...extra },
  }),
  error: (message: string) => ({ type: "runError", data: { sessionId: "s", stage: "init", message } }),
};
const line = (o: unknown): string => JSON.stringify(o) + "\n";

interface Ctl {
  prompt: string;
  spec: SpawnSpec;
  out(text: string): void;
  err(text: string): void;
  exit(code: number | null): void;
}

/** A scripted child process. `script` runs once the prompt has been written to stdin. */
function fakeSpawn(script: (c: Ctl) => void, seen: { spec?: SpawnSpec } = {}): SpawnFn {
  return (spec) => {
    seen.spec = spec;
    const child = new EventEmitter() as KiroChild;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let prompt = "";
    const stdin = new Writable({
      write(chunk, _enc, cb) {
        prompt += String(chunk);
        cb();
      },
    });
    child.pid = 4242;
    child.stdin = stdin;
    child.stdout = stdout;
    child.stderr = stderr;
    stdin.on("finish", () => {
      setImmediate(() =>
        script({
          prompt,
          spec,
          out: (t) => stdout.write(t),
          err: (t) => stderr.write(t),
          exit: (code) => {
            stdout.end();
            stderr.end();
            setImmediate(() => child.emit("close", code));
          },
        }),
      );
    });
    return child;
  };
}

function makeInput(over: Partial<RuntimeInput> = {}): RuntimeInput {
  return { role: "architect", prompt: "do the thing", cwd: tmp, timeoutMs: 10_000, signal: new AbortController().signal, ...over };
}

async function collect(rt: KiroCliRuntime, input: RuntimeInput): Promise<RuntimeEvent[]> {
  const out: RuntimeEvent[] = [];
  for await (const ev of rt.run(input)) out.push(ev);
  return out;
}
const outputOf = (evs: RuntimeEvent[]): string => {
  const o = evs.find((e) => e.kind === "output");
  return o && o.kind === "output" ? o.text : "";
};
const progressOf = (evs: RuntimeEvent[]): string[] => evs.flatMap((e) => (e.kind === "progress" ? [e.text] : []));

const runtime = (spawn: SpawnFn, extra: Partial<ConstructorParameters<typeof KiroCliRuntime>[0]> = {}): KiroCliRuntime =>
  new KiroCliRuntime({ kiroHome: path.join(tmp, "kiro-home"), spawn, sourceEnv: { PATH: "/bin", KIRO_API_KEY: SECRET, OTHER_VAR: "x" }, ...extra });

describe("parseKiroLine", () => {
  it("recognises the four record types and tolerates unknown or invalid lines", () => {
    for (const r of [rec.started, rec.thought("a"), rec.toolCall("Write File", "a.txt"), rec.finished("x"), rec.error("boom")]) {
      expect(parseKiroLine(JSON.stringify(r)).kind).toBe("record");
    }
    expect(parseKiroLine('{"type":"somethingNew","data":{}}').kind).toBe("unknown");
    expect(parseKiroLine('{"type":"runFinished","data":{}}').kind).toBe("unknown");
    expect(parseKiroLine("not json").kind).toBe("invalid");
    expect(parseKiroLine("").kind).toBe("invalid");
  });
});

describe("buildMinimalEnv", () => {
  it("keeps only PATH, SystemRoot, TEMP, TMP, KIRO_API_KEY and sets KIRO_HOME", () => {
    const env = buildMinimalEnv("/kh", {
      PATH: "p", SystemRoot: "C:\\Windows", TEMP: "t", TMP: "t2", KIRO_API_KEY: "k", KIRO_HOME: "/other",
      HOME: "/home/x", USERPROFILE: "u", GITHUB_TOKEN: "g", ENGINE_TOKEN: "e", LLM_API_KEY: "l",
    });
    expect(env).toEqual({ KIRO_HOME: "/kh", PATH: "p", SystemRoot: "C:\\Windows", TEMP: "t", TMP: "t2", KIRO_API_KEY: "k" });
  });

  it("omits variables that are not set", () => {
    expect(buildMinimalEnv("/kh", {})).toEqual({ KIRO_HOME: "/kh" });
  });
});

describe("KiroCliRuntime", () => {
  it("runs the role agent headless with the prompt on stdin, no trust flags and a minimal env", async () => {
    const seen: { spec?: SpawnSpec } = {};
    let prompt = "";
    const rt = runtime(
      fakeSpawn((c) => {
        prompt = c.prompt;
        c.out(line(rec.started) + line(rec.finished("done")));
        c.exit(0);
      }, seen),
      { models: { qa: "claude-haiku-5.5" } },
    );
    await collect(rt, makeInput({ role: "qa", prompt: "review this" }));
    const spec = seen.spec!;
    expect(spec.command).toBe("kiro-cli");
    expect(spec.args).toEqual(["chat", "--v3", "--no-interactive", "--output-format", "stream-json", "--agent", "agentlife-qa", "--model", "claude-haiku-5.5"]);
    expect(spec.args.some((a) => /trust/.test(a) || a === "-a")).toBe(false);
    expect(prompt).toBe("review this");
    expect(spec.cwd).toBe(tmp);
    expect(spec.env).toEqual({ KIRO_HOME: path.join(tmp, "kiro-home"), PATH: "/bin", KIRO_API_KEY: SECRET });
  });

  it("omits --model when none is configured for the role", async () => {
    const seen: { spec?: SpawnSpec } = {};
    const rt = runtime(fakeSpawn((c) => (c.out(line(rec.finished("x"))), c.exit(0)), seen), { models: { qa: "m" } });
    await collect(rt, makeInput({ role: "developer" }));
    expect(seen.spec!.args).not.toContain("--model");
    expect(seen.spec!.args).toContain("agentlife-developer");
  });

  it("maps records to progress and output events", async () => {
    const rt = runtime(
      fakeSpawn((c) => {
        c.out(
          line(rec.started) +
            line(rec.thought("hmm")) +
            line(rec.toolCall("Read File", path.join(tmp, "src", "todo.ts"))) +
            line(rec.toolUpdate) +
            line(rec.toolCall("Write File", path.join(os.tmpdir(), "elsewhere", "x.txt"))) +
            line(rec.message("The plan ")) +
            line(rec.message("is ready.")) +
            line(rec.finished("The plan is ready.\n```json\n{}\n```")),
        );
        c.exit(0);
      }),
    );
    const evs = await collect(rt, makeInput());
    expect(progressOf(evs)).toEqual(["started", `Read File: ${path.join("src", "todo.ts")}`, "Write File: (outside)"]);
    expect(outputOf(evs)).toBe("The plan is ready.\n```json\n{}\n```");
    expect(evs.at(-1)).toEqual({ kind: "output", text: "The plan is ready.\n```json\n{}\n```" });
  });

  it("handles lines split across chunks, CRLF, a last line without newline, and ignores unknown or invalid lines", async () => {
    const full = line(rec.started) + "garbage line\n" + line({ type: "future", data: 1 }) + JSON.stringify(rec.finished("final"));
    const rt = runtime(
      fakeSpawn((c) => {
        const crlf = full.replace(/\n/g, "\r\n");
        for (let i = 0; i < crlf.length; i += 7) c.out(crlf.slice(i, i + 7));
        c.exit(0);
      }),
    );
    const evs = await collect(rt, makeInput());
    expect(progressOf(evs)).toEqual(["started"]);
    expect(outputOf(evs)).toBe("final");
  });

  it("keeps every raw line in the raw log, with secrets redacted", async () => {
    const rawLogPath = path.join(tmp, "runs", "t1", "analyze.raw.jsonl");
    const rt = runtime(
      fakeSpawn((c) => {
        c.out(line(rec.started) + `not json but has ${SECRET}\n` + line(rec.finished(`key ${SECRET}`)));
        c.exit(0);
      }),
    );
    await collect(rt, makeInput({ rawLogPath }));
    const text = readFileSync(rawLogPath, "utf8");
    expect(text.trim().split("\n")).toHaveLength(3);
    expect(text).toContain('"runStarted"');
    expect(text).toContain("not json but has [redacted]");
    expect(text).not.toContain(SECRET);
  });

  it("uses the streamed text when finalText is truncated", async () => {
    const rt = runtime(
      fakeSpawn((c) => {
        c.out(line(rec.message("the full ")) + line(rec.message("answer")) + line(rec.finished("the f", { finalTextTruncated: true })));
        c.exit(0);
      }),
    );
    expect(outputOf(await collect(rt, makeInput()))).toBe("the full answer");
  });

  it("emits usage when the run reports it", async () => {
    const rt = runtime(fakeSpawn((c) => (c.out(line(rec.finished("x", { usage: { credits: 0.25, totalTokens: 900 } }))), c.exit(0))));
    expect(await collect(rt, makeInput())).toContainEqual({ kind: "usage", credits: 0.25, tokens: 900 });
  });

  it("fails on a non-zero exit with the code and the last 20 stderr lines, secrets redacted", async () => {
    const stderr = Array.from({ length: 30 }, (_, i) => `err line ${i + 1}`).join("\n") + `\ntoken ${SECRET}\n`;
    const rt = runtime(fakeSpawn((c) => (c.err(stderr), c.exit(7))));
    const e = await collect(rt, makeInput()).then(() => undefined, (x: unknown) => x);
    expect(e).toBeInstanceOf(KiroCliError);
    const err = e as KiroCliError;
    expect(err.exitCode).toBe(7);
    expect(err.message).toContain("exit code 7");
    expect(err.message).not.toContain(SECRET);
    expect(err.message).toContain("token [redacted]");
    expect(err.message).toContain("err line 30");
    expect(err.message).toContain("err line 12");
    expect(err.message).not.toMatch(/err line 11(?!\d)/);
    expect(err.message.match(/err line/g)).toHaveLength(19);
  });

  it("reports a missing agent (runError, exit 4)", async () => {
    const rt = runtime(fakeSpawn((c) => (c.out(line(rec.started) + line(rec.error(`agent "agentlife-qa" not found, stopping (exit 4)`))), c.exit(4))));
    const err = (await collect(rt, makeInput()).then(() => undefined, (x: unknown) => x)) as KiroCliError;
    expect(err.exitCode).toBe(4);
    expect(err.stage).toBe("init");
    expect(err.message).toContain("not found");
  });

  it("fails when the process ends without runFinished", async () => {
    const rt = runtime(fakeSpawn((c) => (c.out(line(rec.started)), c.exit(0))));
    await expect(collect(rt, makeInput())).rejects.toThrow(/without a result/);
  });

  it("fails clearly when the executable cannot start", async () => {
    const spawn: SpawnFn = () => {
      const child = new EventEmitter() as KiroChild;
      child.stdin = new Writable({ write: (_c, _e, cb) => cb() });
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      setImmediate(() => child.emit("error", new Error(`spawn kiro-cli ENOENT ${SECRET}`)));
      return child;
    };
    const err = (await collect(runtime(spawn), makeInput()).then(() => undefined, (x: unknown) => x)) as KiroCliError;
    expect(err.message).toMatch(/cannot start kiro-cli.*ENOENT/);
    expect(err.message).not.toContain(SECRET);
  });

  it("kills the process tree and rejects with the reason when the signal aborts", async () => {
    const killed: number[] = [];
    let ctl: Ctl | undefined;
    const rt = runtime(fakeSpawn((c) => void (ctl = c)), {
      kill: async (pid) => {
        killed.push(pid);
        ctl!.exit(1);
      },
    });
    const ac = new AbortController();
    const p = collect(rt, makeInput({ signal: ac.signal }));
    setTimeout(() => ac.abort(new Error("cancelled")), 30);
    await expect(p).rejects.toThrow("cancelled");
    expect(killed).toEqual([4242]);
  });

  it("rejects without spawning when the signal is already aborted", async () => {
    let spawned = false;
    const ac = new AbortController();
    ac.abort(new Error("early"));
    const rt = new KiroCliRuntime({ kiroHome: tmp, spawn: () => ((spawned = true), undefined as never) });
    await expect(collect(rt, makeInput({ signal: ac.signal }))).rejects.toThrow("early");
    expect(spawned).toBe(false);
  });

  it("kills the process tree on timeout", async () => {
    const killed: number[] = [];
    let ctl: Ctl | undefined;
    const rt = runtime(fakeSpawn((c) => void (ctl = c)), {
      kill: async (pid) => {
        killed.push(pid);
        ctl!.exit(1);
      },
    });
    await expect(collect(rt, makeInput({ timeoutMs: 40 }))).rejects.toThrow(/timed out/);
    expect(killed).toEqual([4242]);
  });

  it("kills the process when the consumer stops early", async () => {
    const killed: number[] = [];
    let ctl: Ctl | undefined;
    const rt = runtime(fakeSpawn((c) => ((ctl = c), c.out(line(rec.started)))), {
      kill: async (pid) => {
        killed.push(pid);
        ctl!.exit(1);
      },
    });
    for await (const _ev of rt.run(makeInput())) break;
    expect(killed).toEqual([4242]);
  });
});

// A real child process standing in for kiro-cli: reads the prompt from stdin and answers with records.
const FAKE_CLI = `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  out({ type: "runStarted", data: { engine: "v3" } });
  if (input.includes("HANG")) {
    setInterval(() => {}, 1000);
    return;
  }
  out({ type: "runFinished", data: { status: "success", finalText: "got " + input.length + " chars; args: " + process.argv.slice(1).join(" ") } });
});
`;

describe("KiroCliRuntime with a real child process", () => {
  const realRuntime = (spawn?: SpawnFn): KiroCliRuntime =>
    new KiroCliRuntime({ kiroHome: tmp, bin: process.execPath, binArgs: ["-e", FAKE_CLI, "--"], ...(spawn ? { spawn } : {}), sourceEnv: process.env });

  it("passes a large prompt through stdin and reads the answer", async () => {
    const big = "x".repeat(300_000);
    const evs = await collect(realRuntime(), makeInput({ role: "developer", prompt: big }));
    expect(outputOf(evs)).toContain("got 300000 chars");
    expect(outputOf(evs)).toContain("--agent agentlife-developer");
  });

  it("kills a hung process on timeout", async () => {
    let child: ChildProcess | undefined;
    const spawn: SpawnFn = (spec) => {
      child = nodeSpawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
      return child as KiroChild;
    };
    const started = Date.now();
    await expect(collect(realRuntime(spawn), makeInput({ prompt: "HANG", timeoutMs: 600 }))).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(8000);
    expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true);
  });
});

// Real kiro-cli. Needs KIRO_API_KEY and costs a few credits: AGENTLIFE_LIVE=1 with the key in the environment.
describe.skipIf(process.env["AGENTLIFE_LIVE"] !== "1")("KiroCliRuntime live", () => {
  it("architect plans the haunted-todo fixture", { timeout: 240_000 }, async () => {
    const kiroHome = path.join(tmp, "kiro-home");
    installAgents({ kiroHome });
    const repo = await materialise({ repo: { id: "haunted-todo", source: "fixtures/repos/haunted-todo" }, projectRoot: PROJECT_ROOT, dataDir: path.join(tmp, "data") });
    const prompt = renderPrompt(loadPromptTemplate("architect" satisfies Role), { goal: fence("Fix the known bug and add validation.") });
    const rawLogPath = path.join(tmp, "analyze.raw.jsonl");
    const rt = new KiroCliRuntime({ kiroHome, models: { architect: "claude-haiku-5.5" } });
    const evs = await collect(rt, makeInput({ cwd: repo.dir, prompt, rawLogPath, timeoutMs: 200_000 }));
    expect(progressOf(evs).length).toBeGreaterThan(0);
    const blocks = [...outputOf(evs).matchAll(/```json\s*([\s\S]*?)```/g)];
    expect(blocks.length).toBeGreaterThan(0);
    expect(PlanSchema.safeParse(JSON.parse(blocks.at(-1)![1]!)).success).toBe(true);
    expect(existsSync(rawLogPath)).toBe(true);
    expect(readFileSync(rawLogPath, "utf8")).not.toContain(process.env["KIRO_API_KEY"] ?? "\u0000");
  });
});

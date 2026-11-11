import { spawn as nodeSpawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import type { EventEmitter } from "node:events";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { agentName } from "../agents.ts";
import { collectSecrets, createRedactor } from "../log.ts";
import { isInside } from "../paths.ts";
import { killTree } from "./kill-tree.ts";
import { parseKiroLine, type KiroRecord } from "./kiro-cli.schema.ts";
import type { AgentRuntime, Role, RuntimeEvent, RuntimeInput } from "./types.ts";

export const STDERR_TAIL_LINES = 20;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 2 * 1024 * 1024;
const MAX_PROGRESS_CHARS = 120;

/** Failure of a kiro-cli run. The message never contains secrets. */
export class KiroCliError extends Error {
  readonly exitCode: number | undefined;
  readonly stage: string | undefined;
  constructor(message: string, details: { exitCode?: number | undefined; stage?: string | undefined } = {}) {
    super(message);
    this.name = "KiroCliError";
    this.exitCode = details.exitCode;
    this.stage = details.stage;
  }
}

/** What the runtime needs from a child process; `ChildProcessWithoutNullStreams` satisfies it. */
export interface KiroChild extends EventEmitter {
  pid?: number | undefined;
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}
export type SpawnFn = (spec: SpawnSpec) => KiroChild;

const defaultSpawn: SpawnFn = (spec) =>
  nodeSpawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // Own process group on POSIX, so killTree can signal the whole group.
    detached: process.platform !== "win32",
  });

/** Only what kiro-cli needs: PATH, SystemRoot (Windows), TEMP/TMP, KIRO_HOME and KIRO_API_KEY. */
export function buildMinimalEnv(kiroHome: string, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { KIRO_HOME: kiroHome };
  for (const name of ["PATH", "SystemRoot", "TEMP", "TMP", "KIRO_API_KEY"]) {
    const v = source[name];
    if (v !== undefined && v !== "") env[name] = v;
  }
  return env;
}

export interface KiroCliRuntimeOptions {
  /** KIRO_HOME for product agents (see installAgents). */
  kiroHome: string;
  /** Executable. Default `kiro-cli`. */
  bin?: string;
  /** Arguments placed before `chat` (tests use this to run a node script instead of kiro-cli). */
  binArgs?: string[];
  /** Optional `--model` per role, from config/agents.json. Default: the model set in the agent file. */
  models?: Partial<Record<Role, string>>;
  /** Environment to take values from. Default `process.env`. */
  sourceEnv?: NodeJS.ProcessEnv;
  /** Applied to stderr, error messages and raw log lines. Default: redacts secrets found in `sourceEnv`. */
  redact?: (text: string) => string;
  spawn?: SpawnFn;
  kill?: (pid: number) => Promise<void>;
}

/** Small async queue so child-process callbacks can feed an async generator. */
class Channel<T> {
  private items: T[] = [];
  private waiter: (() => void) | undefined;
  push(item: T): void {
    this.items.push(item);
    this.wake();
  }
  wake(): void {
    const w = this.waiter;
    this.waiter = undefined;
    w?.();
  }
  take(): T | undefined {
    return this.items.shift();
  }
  async wait(): Promise<void> {
    if (this.items.length > 0) return;
    await new Promise<void>((resolve) => {
      this.waiter = resolve;
    });
  }
}

type Outcome = { kind: "exit"; code: number | null } | { kind: "spawn-error"; error: Error };

function oneLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  const t = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > MAX_PROGRESS_CHARS ? `${t.slice(0, MAX_PROGRESS_CHARS - 1)}…` : t;
}

/**
 * Context use of the session, from a `session_info_update` record. kiro-cli 3.1 puts it in
 * `_meta.kiro.contextUsage.usagePercentage` (seen in real runs); `contextUsagePercentage` is the shape
 * of the older test fixtures. Anything that is not a finite number gives undefined.
 */
export function contextPctOf(record: KiroRecord): number | undefined {
  if (record.type !== "sessionUpdate") return undefined;
  const u = record.data.update;
  if (u.sessionUpdate !== "session_info_update") return undefined;
  const meta = u["_meta"] as { kiro?: { contextUsage?: { usagePercentage?: unknown } } } | undefined;
  const raw = meta?.kiro?.contextUsage?.usagePercentage ?? u["contextUsagePercentage"];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("aborted");
}

/**
 * Runs `kiro-cli chat --v3 --no-interactive --agent agentlife-<role> --output-format stream-json`.
 * The prompt goes to stdin. No `--trust-*` flag is ever passed: the agent file is the only grant surface.
 */
export class KiroCliRuntime implements AgentRuntime {
  readonly id = "kiro-cli";
  private readonly opts: KiroCliRuntimeOptions;
  private readonly redact: (text: string) => string;
  private readonly spawnFn: SpawnFn;
  private readonly kill: (pid: number) => Promise<void>;

  constructor(opts: KiroCliRuntimeOptions) {
    this.opts = opts;
    const source = opts.sourceEnv ?? process.env;
    this.redact = opts.redact ?? createRedactor(collectSecrets(source));
    this.spawnFn = opts.spawn ?? defaultSpawn;
    this.kill = opts.kill ?? killTree;
  }

  buildArgs(role: Role): string[] {
    const model = this.opts.models?.[role];
    return [
      ...(this.opts.binArgs ?? []),
      "chat",
      "--v3",
      "--no-interactive",
      "--output-format",
      "stream-json",
      "--agent",
      agentName(role),
      ...(model ? ["--model", model] : []),
    ];
  }

  private progressFor(record: KiroRecord, cwd: string): { text: string; tool?: { kind: "read" | "edit"; file: string } } | undefined {
    if (record.type === "runStarted") return { text: "started" };
    if (record.type !== "sessionUpdate") return undefined;
    const u = record.data.update;
    if (u.sessionUpdate !== "tool_call") return undefined;
    const title = typeof u["title"] === "string" ? u["title"] : "tool";
    const locations = Array.isArray(u["locations"]) ? (u["locations"] as { path?: unknown }[]) : [];
    const p = locations[0]?.path;
    let where = "";
    if (typeof p === "string" && p !== "") {
      // Relative to the working directory when inside it; never print an absolute path outside it.
      where = isInside(cwd, p) ? path.relative(cwd, p) || "." : "(outside)";
    }
    const kind = u["kind"];
    const tool: { kind: "read" | "edit"; file: string } | undefined =
      where && (kind === "read" || kind === "edit") ? { kind: kind === "read" ? "read" : "edit", file: where } : undefined;
    return { text: oneLine(where ? `${title}: ${where}` : title), ...(tool ? { tool } : {}) };
  }

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    if (input.signal.aborted) throw abortReason(input.signal);

    const child = this.spawnFn({
      command: this.opts.bin ?? "kiro-cli",
      args: this.buildArgs(input.role),
      cwd: input.cwd,
      env: buildMinimalEnv(this.opts.kiroHome, this.opts.sourceEnv),
    });

    const channel = new Channel<RuntimeEvent>();
    // Mutated from stream callbacks; kept in one object so TypeScript does not narrow the fields.
    const st: {
      outcome: Outcome | undefined;
      stderr: string;
      stdoutRest: string;
      message: string;
      finished: Extract<KiroRecord, { type: "runFinished" }> | undefined;
      runError: { message: string; stage: string | undefined } | undefined;
      timedOut: boolean;
      killed: boolean;
    } = { outcome: undefined, stderr: "", stdoutRest: "", message: "", finished: undefined, runError: undefined, timedOut: false, killed: false };

    if (input.rawLogPath) mkdirSync(path.dirname(input.rawLogPath), { recursive: true });
    const rawLog = (lines: string[]): void => {
      if (!input.rawLogPath || lines.length === 0) return;
      try {
        appendFileSync(input.rawLogPath, lines.map((l) => this.redact(l) + "\n").join(""));
      } catch {
        // A full disk must not turn a good run into a failure.
      }
    };

    const handleLine = (line: string): void => {
      const parsed = parseKiroLine(line);
      if (parsed.kind !== "record") return;
      const rec = parsed.record;
      const progress = this.progressFor(rec, input.cwd);
      if (progress) channel.push({ kind: "progress", ...progress });
      const pct = contextPctOf(rec);
      if (pct !== undefined) channel.push({ kind: "context", pct });
      if (rec.type === "sessionUpdate") {
        const u = rec.data.update;
        if (u.sessionUpdate === "agent_message_chunk") {
          const content = u["content"] as { text?: unknown } | undefined;
          if (typeof content?.text === "string" && st.message.length < MAX_MESSAGE_CHARS) st.message += content.text;
        }
      } else if (rec.type === "runFinished") {
        st.finished = rec;
      } else if (rec.type === "runError") {
        st.runError = { message: rec.data.message, stage: rec.data.stage };
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const parts = (st.stdoutRest + chunk).split("\n");
      st.stdoutRest = parts.pop() ?? "";
      const lines = parts.map((l) => l.replace(/\r$/, "")).filter((l) => l !== "");
      rawLog(lines);
      for (const l of lines) handleLine(l);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      st.stderr += chunk;
      if (st.stderr.length > MAX_STDERR_BYTES) st.stderr = st.stderr.slice(-MAX_STDERR_BYTES);
    });
    child.stdin.on("error", () => {
      // EPIPE when the process exits before reading the prompt; the exit code explains it.
    });
    child.once("error", (error: Error) => {
      st.outcome ??= { kind: "spawn-error", error };
      channel.wake();
    });
    child.once("close", (code: number | null) => {
      st.outcome ??= { kind: "exit", code };
      channel.wake();
    });

    const stop = async (): Promise<void> => {
      // After the process has closed its pid may belong to someone else.
      if (st.killed || st.outcome) return;
      st.killed = true;
      if (child.pid !== undefined) await this.kill(child.pid);
    };
    const onAbort = (): void => void stop();
    input.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      st.timedOut = true;
      void stop();
    }, input.timeoutMs);

    try {
      child.stdin.end(input.prompt);
      for (;;) {
        for (let ev = channel.take(); ev !== undefined; ev = channel.take()) yield ev;
        if (st.outcome) break;
        await channel.wait();
      }
      // The process has closed; flush a last line that had no trailing newline.
      if (st.stdoutRest.trim() !== "") {
        rawLog([st.stdoutRest]);
        handleLine(st.stdoutRest);
      }
      for (let ev = channel.take(); ev !== undefined; ev = channel.take()) yield ev;

      if (input.signal.aborted) throw abortReason(input.signal);
      if (st.timedOut) throw new KiroCliError(`kiro-cli timed out after ${Math.round(input.timeoutMs / 1000)} s`);
      const out = st.outcome;
      if (!out) throw new Error("unreachable: loop ended without an outcome");
      if (out.kind === "spawn-error") {
        throw new KiroCliError(this.redact(`cannot start ${this.opts.bin ?? "kiro-cli"}: ${out.error.message}`));
      }
      const re = st.runError;
      if (out.code !== 0 || re) {
        const tail = this.redact(st.stderr)
          .split(/\r?\n/)
          .filter((l) => l.trim() !== "")
          .slice(-STDERR_TAIL_LINES)
          .join("\n");
        const reason = re ? this.redact(re.message) : "";
        const code = out.code === null ? "no exit code" : `exit code ${out.code}`;
        throw new KiroCliError(
          `kiro-cli failed (${code})${reason ? `: ${reason}` : ""}${tail ? `\nstderr (last lines):\n${tail}` : ""}`,
          { exitCode: out.code ?? undefined, stage: re?.stage },
        );
      }
      const fin = st.finished;
      if (!fin) throw new KiroCliError("kiro-cli ended without a result (no runFinished record)", { exitCode: 0 });

      // finalText can be cut for very long answers; the streamed chunks then hold the full text.
      const finalText = fin.data.finalTextTruncated && st.message.length > fin.data.finalText.length ? st.message : fin.data.finalText;
      yield { kind: "output", text: finalText };
      const usage = fin.data.usage;
      if (usage && (usage.credits !== undefined || usage.totalTokens !== undefined)) {
        yield {
          kind: "usage",
          ...(usage.credits === undefined ? {} : { credits: usage.credits }),
          ...(usage.totalTokens === undefined ? {} : { tokens: usage.totalTokens }),
        };
      }
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", onAbort);
      // Consumer stopped early, or an error was thrown while the process still runs.
      await stop();
    }
  }
}

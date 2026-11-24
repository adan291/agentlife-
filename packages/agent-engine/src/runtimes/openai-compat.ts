// Runs a role agent on any API that speaks the OpenAI chat-completions format with tool calling (Ollama, LM Studio, Groq,
// xAI Grok, OpenAI, OpenRouter...). The model gets the file tools of `file-tools.ts`, which the engine runs inside the job's
// folder; the loop ends when the model answers without a tool call, and that answer is the step's output, as with kiro-cli.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROLE_INSTRUCTIONS } from "../team/generate.ts";
import { runFileTool, toolDefinitions } from "./file-tools.ts";
import { stripThinking } from "./ollama.ts";
import type { AgentRuntime, RuntimeEvent, RuntimeInput } from "./types.ts";

export const MAX_TOOL_ROUNDS = 40;
/** The whole conversation of one step; a model that reads far more than that is stopped. */
const MAX_CONVERSATION_CHARS = 1_500_000;
const MAX_ANSWER_CHARS = 100_000;
const RETRY_DELAYS_MS = [2_000, 6_000];

/** A provider error whose text is safe to show the user (no key, no address). */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

/** The runtime of a provider that cannot work here: every step fails with the reason (the engine still starts). */
export class UnavailableRuntime implements AgentRuntime {
  readonly id: string;
  private readonly reason: string;
  constructor(id: string, reason: string) {
    this.id = id;
    this.reason = reason;
  }
  // eslint-disable-next-line require-yield
  async *run(): AsyncIterable<RuntimeEvent> {
    throw new ProviderError(this.reason);
  }
}

export interface OpenAICompatOptions {
  providerId: string;
  /** "Ollama", "xAI Grok"... used in messages. */
  label: string;
  /** Ends before `/chat/completions`. */
  baseUrl: string;
  apiKey?: string;
  /** Used when neither the member nor the role names a model. */
  defaultModel?: string;
  fetch?: typeof fetch;
  maxRounds?: number;
  retryDelaysMs?: readonly number[];
}

interface ToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments?: string };
}
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
interface ChatResponse {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
  usage?: { total_tokens?: number };
}

/** The role's limits and the untrusted-data rule, then the member's persona, then how the tools work. */
export function systemText(input: Pick<RuntimeInput, "role" | "system">, write: boolean): string {
  const role = ROLE_INSTRUCTIONS[input.role as keyof typeof ROLE_INSTRUCTIONS] ?? ROLE_INSTRUCTIONS.qa;
  const tools = write
    ? "Use the tools to look at the project and write_file to change it; there is no other way to change a file. When you are done, answer with a short summary of what you changed."
    : "Use the tools to look at the project: read the files you need instead of guessing. When you are done, answer in the format the task asks for.";
  return [input.system, role, tools].filter(Boolean).join("\n\n");
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

export class OpenAICompatRuntime implements AgentRuntime {
  readonly id: string;
  private readonly opts: OpenAICompatOptions;
  private readonly fetchFn: typeof fetch;
  private readonly maxRounds: number;
  private readonly retryDelays: readonly number[];

  // No parameter properties: the engine runs with --experimental-strip-types, which refuses them.
  constructor(opts: OpenAICompatOptions) {
    this.opts = opts;
    this.id = opts.providerId;
    this.fetchFn = opts.fetch ?? fetch;
    this.maxRounds = opts.maxRounds ?? MAX_TOOL_ROUNDS;
    this.retryDelays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  }

  get label(): string {
    return this.opts.label;
  }

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    const model = input.model && input.model !== "auto" ? input.model : this.opts.defaultModel;
    if (!model) throw new ProviderError(`No model is set for ${this.opts.label}: choose one at the HR desk or in config/agents.json.`);
    const write = input.role === "developer";
    const timeout = AbortSignal.timeout(input.timeoutMs);
    const signal = AbortSignal.any([input.signal, timeout]);
    const messages: ChatMessage[] = [
      { role: "system", content: systemText(input, write) },
      { role: "user", content: input.prompt },
    ];
    const tools = toolDefinitions(write);
    const log = (entry: object) => {
      if (!input.rawLogPath) return;
      try {
        mkdirSync(path.dirname(input.rawLogPath), { recursive: true });
        appendFileSync(input.rawLogPath, `${JSON.stringify({ ts: Date.now(), provider: this.id, ...entry })}\n`);
      } catch {
        // The raw log is a help for debugging; a failed write never stops the step.
      }
    };
    yield { kind: "progress", text: `Thinking on ${this.opts.label} (${model})` };
    try {
      for (let round = 0; round < this.maxRounds; round++) {
        if (messages.reduce((n, m) => n + (m.content?.length ?? 0), 0) > MAX_CONVERSATION_CHARS) {
          throw new ProviderError(`The step read too much on ${this.opts.label}; it was stopped. Try a smaller goal.`);
        }
        const res = await this.chat(model, messages, tools, signal);
        log({ round, message: res.choices?.[0]?.message ?? null });
        if (res.usage?.total_tokens !== undefined) yield { kind: "usage", tokens: res.usage.total_tokens };
        const msg = res.choices?.[0]?.message;
        if (!msg) throw new ProviderError(`${this.opts.label} sent an answer with no message.`);
        const calls = (msg.tool_calls ?? []).filter((c) => c && c.function && typeof c.function.name === "string");
        if (calls.length === 0) {
          const text = stripThinking(msg.content ?? "").slice(0, MAX_ANSWER_CHARS);
          if (text === "") throw new ProviderError(`${this.opts.label} answered with no text.`);
          yield { kind: "output", text };
          return;
        }
        messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
        for (const call of calls) {
          const result = runFileTool(call.function.name, call.function.arguments ?? "", { cwd: input.cwd, write });
          yield { kind: "progress", text: result.progress.text, ...(result.progress.tool ? { tool: result.progress.tool } : {}) };
          messages.push({ role: "tool", tool_call_id: call.id, content: result.text });
        }
      }
      throw new ProviderError(`${this.opts.label} kept calling tools for ${this.maxRounds} rounds without an answer; the step was stopped.`);
    } catch (e) {
      if (input.signal.aborted) throw input.signal.reason ?? e;
      if (timeout.aborted) throw new ProviderError(`${this.opts.label} did not finish in ${Math.round(input.timeoutMs / 1000)} s.`);
      throw e;
    }
  }

  /** One chat-completions request, with two retries on a rate limit or a server error. */
  private async chat(model: string, messages: ChatMessage[], tools: object[], signal: AbortSignal): Promise<ChatResponse> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.apiKey) headers["authorization"] = `Bearer ${this.opts.apiKey}`;
    const body = JSON.stringify({ model, messages, tools, tool_choice: "auto", stream: false, temperature: 0.2 });
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(url, { method: "POST", headers, body, signal });
      } catch (e) {
        if (signal.aborted) throw e;
        throw new ProviderError(`${this.opts.label} is not answering. Is it running, and is the address right?`);
      }
      if (res.ok) {
        try {
          return (await res.json()) as ChatResponse;
        } catch {
          throw new ProviderError(`${this.opts.label} sent an answer that is not JSON.`);
        }
      }
      const detail = await this.errorDetail(res);
      if ((res.status === 429 || res.status >= 500) && attempt < this.retryDelays.length) {
        await sleep(this.retryDelays[attempt]!, signal);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new ProviderError(`${this.opts.label} refused the key (${res.status}). Check its key in .env.`);
      if (res.status === 404) throw new ProviderError(`${this.opts.label} does not know the model '${model}' (404).${detail}`);
      if (res.status === 429) throw new ProviderError(`${this.opts.label} rate limit or quota reached (429).${detail}`);
      throw new ProviderError(`${this.opts.label} answered ${res.status}.${detail}`);
    }
  }

  /** The provider's own error message, cut short. It never holds the key (the key is only in a header). */
  private async errorDetail(res: Response): Promise<string> {
    try {
      const text = await res.text();
      let msg = text;
      try {
        const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
        msg = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message ?? text);
      } catch {
        // not JSON
      }
      // Some providers quote part of a wrong key in the message: the key and any long token-like text are masked.
      let masked = this.opts.apiKey ? msg.split(this.opts.apiKey).join("***") : msg;
      masked = masked.replace(/[A-Za-z0-9_-]{24,}/g, "***");
      const clean = masked.replace(/\s+/g, " ").trim().slice(0, 200);
      return clean ? ` ${clean}` : "";
    } catch {
      return "";
    }
  }
}

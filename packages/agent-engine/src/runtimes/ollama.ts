import type { AgentRuntime, RuntimeEvent, RuntimeInput } from "./types.ts";

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
/** How long one local answer may take before the work goes to the fallback model. */
export const OLLAMA_TIMEOUT_MS = 120_000;
const MAX_ANSWER_CHARS = 20_000;
const MAX_PROMPT_CHARS = 60_000;
const NUM_PREDICT = 700;
const NUM_CTX = 8192;

/** The local model cannot answer: not running, model missing, too slow, or an answer that cannot be used. The text is safe to show. */
export class OllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaUnavailableError";
  }
}

/** True for an `http(s)` address on this computer. Prompts built from project files never leave the machine. */
export function isLoopbackUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username !== "" || u.password !== "") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

export interface OllamaRuntimeOptions {
  /** Default: `OLLAMA_URL` or http://127.0.0.1:11434. An address that is not on this computer is never used. */
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Text of the answer without the reasoning block some local models print before it. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "").trim();
}

/**
 * Runs a prompt on the local Ollama model (`POST /api/chat`, no streaming). The model has no tools: it only turns the
 * text of the task message into text. `input.model` is the Ollama tag (`qwen3.5:4b`), `input.system` the persona. Any
 * failure to get a usable answer throws `OllamaUnavailableError`, which the intern runtime answers with its fallback;
 * a cancelled run throws the abort reason as usual.
 */
export class OllamaRuntime implements AgentRuntime {
  readonly id = "ollama";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(opts: OllamaRuntimeOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env["OLLAMA_URL"] ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? OLLAMA_TIMEOUT_MS;
    this.fetchFn = opts.fetch ?? fetch;
  }

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : new Error("aborted");
    if (!isLoopbackUrl(this.baseUrl)) throw new OllamaUnavailableError("The local model address is not on this computer, so it is not used.");
    if (!input.model) throw new OllamaUnavailableError("No local model is set.");
    const timeout = AbortSignal.timeout(Math.min(this.timeoutMs, input.timeoutMs));
    const signal = AbortSignal.any([input.signal, timeout]);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        redirect: "error",
        signal,
        body: JSON.stringify({
          model: input.model,
          stream: false,
          think: false,
          options: { temperature: 0.2, num_predict: NUM_PREDICT, num_ctx: NUM_CTX },
          messages: [
            ...(input.system ? [{ role: "system", content: input.system }] : []),
            { role: "user", content: input.prompt.slice(0, MAX_PROMPT_CHARS) },
          ],
        }),
      });
    } catch (e) {
      if (input.signal.aborted) throw e;
      throw new OllamaUnavailableError(timeout.aborted ? "The local model did not answer in time." : "The local model is not running.");
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new OllamaUnavailableError(res.status === 404 ? `The local model ${input.model} is not installed.` : `The local model answered ${res.status}.`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      if (input.signal.aborted) throw e;
      throw new OllamaUnavailableError(timeout.aborted ? "The local model did not answer in time." : "The local model sent an answer that could not be read.");
    }
    const body = json as { message?: { content?: unknown }; prompt_eval_count?: unknown; eval_count?: unknown } | null;
    const content = body?.message?.content;
    const text = typeof content === "string" ? stripThinking(content).slice(0, MAX_ANSWER_CHARS) : "";
    if (text === "") throw new OllamaUnavailableError("The local model gave an empty answer.");
    yield { kind: "output", text };
    const used = (typeof body?.prompt_eval_count === "number" ? body.prompt_eval_count : 0) + (typeof body?.eval_count === "number" ? body.eval_count : 0);
    // Tokens are reported; credits are not: a local model costs none.
    if (Number.isFinite(used) && used > 0) yield { kind: "usage", tokens: used };
  }
}

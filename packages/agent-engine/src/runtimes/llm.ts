import type { AgentRuntime, Role, RuntimeEvent, RuntimeInput } from "./types.ts";

export const MAX_LINE_CHARS = 120;
export const LLM_TIMEOUT_MS = 5000;
const MAX_TOKENS = 60;

export const CANNED_LINES: Readonly<Record<Role, readonly string[]>> = {
  architect: ["Let me sketch this out.", "Reading the repo layout...", "A small plan beats a big one."],
  developer: ["Typing away.", "One small change at a time.", "Compiling thoughts..."],
  qa: ["Checking the edges.", "Looking for trouble.", "Tests first, opinions later."],
};

const URL_LIKE = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|\b[\w-]+\.(?:com|org|net|io|dev|app|ai|co|xyz|ru|cn)\b)/i;

/** Returns a clean one-line version of `raw`, or undefined if it must not be shown. */
export function screenLine(raw: string): string | undefined {
  const line = raw.replace(/\s+/g, " ").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  if (line.length === 0 || line.length > MAX_LINE_CHARS) return undefined;
  if (URL_LIKE.test(line)) return undefined;
  return line;
}

export interface LlmRuntimeOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Called with a short message when the endpoint fails and a canned line is used. Never receives secrets. */
  onError?: (message: string) => void;
  random?: () => number;
}

/** OpenAI-compatible ambient chatter. Always yields exactly one output line, never throws on endpoint failure. */
export class LlmRuntime implements AgentRuntime {
  readonly id = "llm";
  private readonly baseUrl: string | undefined;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly onError: (message: string) => void;
  private readonly random: () => number;

  constructor(opts: LlmRuntimeOptions = {}) {
    const env = process.env;
    this.baseUrl = (opts.baseUrl ?? env["LLM_BASE_URL"])?.replace(/\/+$/, "") || undefined;
    this.model = opts.model ?? env["LLM_MODEL"] ?? "default";
    this.apiKey = opts.apiKey ?? env["LLM_API_KEY"];
    this.timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
    this.fetchFn = opts.fetch ?? fetch;
    this.onError = opts.onError ?? (() => {});
    this.random = opts.random ?? Math.random;
  }

  canned(role: Role): string {
    const lines = CANNED_LINES[role];
    return lines[Math.floor(this.random() * lines.length) % lines.length]!;
  }

  private async ask(input: RuntimeInput): Promise<string> {
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(this.timeoutMs)]);
    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: `You are the ${input.role} agent in a small office. Reply with one short in-character remark, under 100 characters, no links.`,
          },
          { role: "user", content: input.prompt },
        ],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`llm endpoint responded ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("llm response has no content");
    const line = screenLine(content);
    if (line === undefined) throw new Error("llm line rejected by screening");
    return line;
  }

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    let text: string;
    if (!this.baseUrl) {
      text = this.canned(input.role);
    } else {
      try {
        text = await this.ask(input);
      } catch (e) {
        if (input.signal.aborted) throw e;
        const name = e instanceof Error ? e.name : "Error";
        const msg0 = e instanceof Error ? e.message : String(e);
        const msg = this.apiKey ? msg0.split(this.apiKey).join("[redacted]") : msg0;
        this.onError(`llm fallback (${name}): ${msg}`.slice(0, 200));
        text = this.canned(input.role);
      }
    }
    yield { kind: "output", text };
  }
}

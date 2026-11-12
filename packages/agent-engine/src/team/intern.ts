import { OllamaUnavailableError } from "../runtimes/ollama.ts";
import type { AgentRuntime, RuntimeEvent, RuntimeInput } from "../runtimes/types.ts";

/**
 * The local intern (hr-desk requirement 6). It runs on the model on this computer, which has no tools and costs no
 * credits, so it may only be given read-only steps that need no tools. The list below is the only place that says which.
 * `analyze` (plan), `develop` and `review` are not on it and never will be: a plan, a change or a verdict needs the
 * tools and the quality of the real agents.
 */
export const INTERN_STEPS = ["summary", "overview", "memory", "classify"] as const;
export type InternStep = (typeof INTERN_STEPS)[number];

/** The model that does the work when the local one cannot, through the same read-only agent file. */
export const INTERN_FALLBACK_MODEL = "claude-haiku-5.5";

export function isInternStep(step: string | undefined): step is InternStep {
  return step !== undefined && (INTERN_STEPS as readonly string[]).includes(step);
}

/** An attempt to give the intern a step it may not do. */
export class InternNotAllowedError extends Error {
  readonly code = "intern_not_allowed";
  constructor(step: string | undefined) {
    super(
      `The Night intern cannot do ${step ? `the "${step}" step` : "a step with no name"}. It only does ${INTERN_STEPS.join(", ")}.`,
    );
    this.name = "InternNotAllowedError";
  }
}

export function assertInternStep(step: string | undefined): asserts step is InternStep {
  if (!isInternStep(step)) throw new InternNotAllowedError(step);
}

export interface InternRuntimeOptions {
  /** The local model (`OllamaRuntime`). */
  local: AgentRuntime;
  /** Does the work when the local model cannot: kiro-cli with the member's read-only agent. */
  fallback: AgentRuntime;
  fallbackModel?: string;
  /** Called once per fallback with a line that is safe to show. */
  onFallback?: (message: string) => void;
}

/**
 * Runs an intern step on the local model; when Ollama cannot answer (not running, model missing, too slow) the same
 * prompt goes to the fallback model and a `fallback` event says so first, so the run log, the terminal and the report
 * can tell the user the work did not stay free. Refuses any step that is not on `INTERN_STEPS`, before anything runs.
 */
export class InternRuntime implements AgentRuntime {
  readonly id = "intern";
  private readonly o: InternRuntimeOptions;

  constructor(opts: InternRuntimeOptions) {
    this.o = opts;
  }

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    assertInternStep(input.step);
    let started = false;
    try {
      for await (const ev of this.o.local.run(input)) {
        started = true;
        yield ev;
      }
      return;
    } catch (e) {
      if (input.signal.aborted || started || !(e instanceof OllamaUnavailableError)) throw e;
      const to = this.o.fallbackModel ?? INTERN_FALLBACK_MODEL;
      const from = input.model ?? "the local model";
      this.o.onFallback?.(`${e.message} ${to} did the ${input.step} step instead.`);
      yield { kind: "fallback", from, to, reason: e.message };
      yield* this.o.fallback.run({ ...input, model: to });
    }
  }
}

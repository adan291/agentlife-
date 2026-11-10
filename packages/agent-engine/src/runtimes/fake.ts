import type { Plan, Review } from "@agentlife/shared";
import type { AgentRuntime, Role, RuntimeEvent, RuntimeInput } from "./types.ts";

const PLAN: Plan = {
  tasks: [
    {
      id: "t1",
      title: "Add the requested change",
      why: "Smallest change that satisfies the goal.",
      files: ["src/todo.js"],
      acceptance: "Existing tests still pass and the new behaviour is covered.",
      risk: "low",
    },
  ],
};

const DIFF = `--- a/src/todo.js
+++ b/src/todo.js
@@ -1,3 +1,4 @@
 export function list(items) {
+  // fake change
   return items;
 }
`;

const REVIEW: Review = { verdict: "pass", notes: ["Change is small and covered by tests."], risk: "low" };

/** Canned output per role (architect: plan JSON, developer: diff, qa: review JSON). */
export const FAKE_OUTPUTS: Readonly<Record<Role, string>> = {
  architect: JSON.stringify(PLAN),
  developer: DIFF,
  qa: JSON.stringify(REVIEW),
};

export interface FakeRuntimeOptions {
  /** Delay before each emitted event. Default 0. */
  delayMs?: number;
  /** Override the output of a role, optionally depending on the call number (1-based) for that role. */
  outputs?: Partial<Record<Role, string | ((call: number) => string)>>;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("aborted");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Deterministic runtime for tests and `RUNTIME=fake`. Rejects (throws) when the signal aborts. */
export class FakeRuntime implements AgentRuntime {
  readonly id = "fake";
  private readonly delayMs: number;
  private readonly outputs: NonNullable<FakeRuntimeOptions["outputs"]>;
  private readonly calls: Record<Role, number> = { architect: 0, developer: 0, qa: 0 };

  constructor(opts: FakeRuntimeOptions = {}) {
    this.delayMs = opts.delayMs ?? 0;
    this.outputs = opts.outputs ?? {};
  }

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    const call = ++this.calls[input.role];
    const override = this.outputs[input.role];
    const text = override === undefined ? FAKE_OUTPUTS[input.role] : typeof override === "function" ? override(call) : override;

    await sleep(this.delayMs, input.signal);
    yield { kind: "progress", text: `${input.role} started` };
    await sleep(this.delayMs, input.signal);
    yield { kind: "output", text };
    yield { kind: "usage", tokens: 0 };
  }
}

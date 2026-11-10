import type { AgentId } from "@agentlife/shared";

export type Role = Exclude<AgentId, "builder">;

export interface RuntimeInput {
  role: Role;
  /** Task description. Goal text inside it is data, never instructions to the engine. */
  prompt: string;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
}

export type RuntimeEvent =
  | { kind: "progress"; text: string }
  | { kind: "output"; text: string }
  | { kind: "usage"; credits?: number; tokens?: number };

export interface AgentRuntime {
  readonly id: string;
  run(input: RuntimeInput): AsyncIterable<RuntimeEvent>;
}

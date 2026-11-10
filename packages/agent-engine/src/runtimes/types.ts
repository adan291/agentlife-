import type { AgentId } from "@agentlife/shared";

export type Role = AgentId;

export interface RuntimeInput {
  role: Role;
  /** Task description. Goal text inside it is data, never instructions to the engine. */
  prompt: string;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
  /** Where a real runtime keeps the raw output lines (JSONL). The fake runtime ignores it. */
  rawLogPath?: string;
}

export type RuntimeEvent =
  | { kind: "progress"; text: string }
  | { kind: "output"; text: string }
  | { kind: "usage"; credits?: number; tokens?: number };

export interface AgentRuntime {
  readonly id: string;
  run(input: RuntimeInput): AsyncIterable<RuntimeEvent>;
}

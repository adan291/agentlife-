import type { AgentId } from "@agentlife/shared";

export type Role = Exclude<AgentId, "builder">;

export interface RuntimeInput {
  role: Role;
  /** Task description. Goal text inside it is data, never instructions to the engine. */
  prompt: string;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
  /** Where a real runtime keeps the raw output lines (JSONL). The fake runtime ignores it. */
  rawLogPath?: string;
  /** The team member's kiro-cli agent. Default: the built-in agent of the role. */
  agent?: string;
  /** The team member's model. Default: the model configured for the role. */
  model?: string;
}

export type RuntimeEvent =
  /** `tool` is set for file reads and edits, so counting does not parse the text. `file` is relative to the cwd. */
  | { kind: "progress"; text: string; tool?: { kind: "read" | "edit"; file: string } }
  | { kind: "output"; text: string }
  | { kind: "usage"; credits?: number; tokens?: number }
  /** Context window use of the agent session, 0 to 100. */
  | { kind: "context"; pct: number };

export interface AgentRuntime {
  readonly id: string;
  run(input: RuntimeInput): AsyncIterable<RuntimeEvent>;
}

import type { AgentId } from "@agentlife/shared";

export type Role = Exclude<AgentId, "builder">;

export interface RuntimeInput {
  role: Role;
  /** Name of the pipeline step that asks for the work (`analyze`, `summary`, ...). The local intern refuses most of them. */
  step?: string;
  /** Task description. Goal text inside it is data, never instructions to the engine. */
  prompt: string;
  /** The persona of the team member, for runtimes that have no agent file (the local model). kiro-cli ignores it. */
  system?: string;
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
  | { kind: "context"; pct: number }
  /** The runtime of the member could not do the work and another model did it instead (the report says so). */
  | { kind: "fallback"; from: string; to: string; reason: string };

export interface AgentRuntime {
  readonly id: string;
  run(input: RuntimeInput): AsyncIterable<RuntimeEvent>;
}

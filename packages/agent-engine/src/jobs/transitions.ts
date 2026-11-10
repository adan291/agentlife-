import type { JobState } from "@agentlife/shared";

/** The single transition table (design.md). Anything not listed here is forbidden. */
export const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  created: ["analyzing", "cancelled"],
  analyzing: ["awaiting_plan_approval", "failed", "cancelled"],
  awaiting_plan_approval: ["developing", "cancelled"], // reject => cancelled
  developing: ["testing", "failed", "cancelled"],
  testing: ["reviewing", "failed", "cancelled"],
  reviewing: ["report_ready", "developing", "cancelled"],
  report_ready: ["delivered"],
  failed: ["report_ready"], // a failure still produces a report
  delivered: [],
  cancelled: [],
};

export const TERMINAL_STATES: readonly JobState[] = ["delivered", "cancelled"];

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  readonly from: JobState;
  readonly to: JobState;
  constructor(from: JobState, to: JobState) {
    super(`invalid job transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Throws InvalidTransitionError unless `from -> to` is in the table. */
export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

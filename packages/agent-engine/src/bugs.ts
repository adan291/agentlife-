// What the engine hands to the Bug sack (spec bug-sack). No node imports here: `main.ts` builds the sink with
// `createBugReporter` from `@agentlife/shared/bugs-node`, which masks the text and appends it to the inbox.

import type { BugContext } from "@agentlife/shared";

/** Receives one code report. Never throws and never blocks (a failing sink is the sink's problem). */
export type BugSink = (input: { kind: string; message: string; stack?: string | undefined; context?: BugContext | undefined }) => void;

/** Errors that end a job in a legitimate way: the user cancelled it, or the Developer's change failed the engine's checks. */
const NOT_BUGS = new Set(["JobCancelledError", "DiffRejectedError"]);

/**
 * The kind of bug a thrown step error is, or undefined when it is not one. Matches on `error.name` (every engine error
 * class sets it) so this file needs none of the classes, which would make the runner import the whole pipeline.
 * A QA FAIL verdict and failing tests never throw, so they never get here.
 */
export function classifyStepError(error: unknown): string | undefined {
  const name = error instanceof Error ? error.name : "";
  if (NOT_BUGS.has(name)) return undefined;
  switch (name) {
    case "KiroCliError":
      return "kiro-cli";
    case "DockerUnavailableError":
    case "RunnerImageBuildError":
      return "docker";
    case "StepTimeoutError":
      return "step-timeout";
    default:
      return "step-error";
  }
}

/** Message and stack of anything thrown, as text. */
export function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message ? `${error.name}: ${error.message}` : error.name, ...(error.stack ? { stack: error.stack } : {}) };
  }
  return { message: typeof error === "string" && error ? error : "Non-error thrown" };
}

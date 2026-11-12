import type { JobKind, JobState } from "@agentlife/shared";
import { InvalidTransitionError, TRANSITIONS } from "./transitions.ts";

/**
 * The fixed pipeline of each job kind, as the states a job passes through, in order (job-types, requirement 1.2).
 * The runner follows these; `transitionsFor` turns them into the table the engine enforces.
 */
export const PIPELINES: Readonly<Record<JobKind, readonly JobState[]>> = {
  change: ["created", "analyzing", "awaiting_plan_approval", "developing", "testing", "reviewing", "report_ready"],
  // Nothing is written, so there is no approval and no develop step.
  "review-branch": ["created", "reviewing", "testing", "report_ready"],
  "write-tests": ["created", "analyzing", "awaiting_plan_approval", "developing", "testing", "reviewing", "report_ready"],
  // Documentation has no test step: the review is the check.
  document: ["created", "analyzing", "awaiting_plan_approval", "developing", "reviewing", "report_ready"],
};

/** A job is read-only when no step of its pipeline writes files. */
export function writesFiles(kind: JobKind): boolean {
  return PIPELINES[kind].includes("developing");
}

export function hasApproval(kind: JobKind): boolean {
  return PIPELINES[kind].includes("awaiting_plan_approval");
}

export function hasTestStep(kind: JobKind): boolean {
  return PIPELINES[kind].includes("testing");
}

/**
 * Builds the transition table of a pipeline: each state moves on to the next one of the list; every state before the
 * report can fail or be cancelled; a review can send the job back to develop (one retry, see JobRunner); a report is
 * delivered; a failure still produces a report. For `change` this is exactly `TRANSITIONS`.
 */
export function buildTransitions(flow: readonly JobState[]): Readonly<Record<JobState, readonly JobState[]>> {
  const table = {} as Record<JobState, JobState[]>;
  for (const s of Object.keys(TRANSITIONS) as JobState[]) table[s] = [];
  flow.forEach((state, i) => {
    const next = flow[i + 1];
    if (next) table[state].push(next);
    if (state !== "report_ready") table[state].push("failed", "cancelled");
    if (state === "reviewing" && flow.includes("developing")) table[state].push("developing");
  });
  table["report_ready"] = ["delivered"];
  table["failed"] = ["report_ready"];
  return table;
}

const TABLES: Readonly<Record<JobKind, Readonly<Record<JobState, readonly JobState[]>>>> = {
  change: TRANSITIONS,
  "review-branch": buildTransitions(PIPELINES["review-branch"]),
  "write-tests": buildTransitions(PIPELINES["write-tests"]),
  document: buildTransitions(PIPELINES["document"]),
};

/** The transition table of a kind. `change` uses the single table of the state machine unchanged. */
export function transitionsFor(kind: JobKind): Readonly<Record<JobState, readonly JobState[]>> {
  return TABLES[kind];
}

export function canTransitionFor(kind: JobKind, from: JobState, to: JobState): boolean {
  return TABLES[kind][from].includes(to);
}

/** Throws InvalidTransitionError unless `from -> to` is in the kind's table. */
export function assertTransitionFor(kind: JobKind, from: JobState, to: JobState): void {
  if (!canTransitionFor(kind, from, to)) throw new InvalidTransitionError(from, to);
}

// ---- path rules ----

/** Where the Developer of a kind may write. `change` has no such limit (the protected paths apply to every kind). */
export interface PathRule {
  /** Shown in the failure of the report when the diff leaves the rule. */
  description: string;
  allows(rel: string): boolean;
}

const TEST_DIRS = new Set(["test", "tests", "__tests__"]);

/** `**\/*.test.*` and `**\/*.spec.*`: a stem, `.test` or `.spec`, then an extension. */
function isTestFileName(base: string): boolean {
  return /^.+\.(test|spec)\..+$/i.test(base);
}

const TESTS_ONLY: PathRule = {
  description: "test files only (**/*.test.*, **/*.spec.*, test/**, tests/**, __tests__/**)",
  allows(rel) {
    const parts = rel.split("/");
    const base = parts[parts.length - 1] ?? "";
    if (isTestFileName(base)) return true;
    // The folders count from the root of the project, as in the glob.
    return parts.length > 1 && TEST_DIRS.has((parts[0] ?? "").toLowerCase());
  },
};

const DOCS_ONLY: PathRule = {
  description: "documentation only (docs/** and *.md)",
  allows(rel) {
    const parts = rel.split("/");
    const base = (parts[parts.length - 1] ?? "").toLowerCase();
    if (parts.length > 1 && (parts[0] ?? "").toLowerCase() === "docs") return true;
    return base.length > 3 && base.endsWith(".md");
  },
};

/** The path rule of a kind, or undefined when the kind has none (`change`) or never writes (`review-branch`). */
export function pathRuleFor(kind: JobKind): PathRule | undefined {
  if (kind === "write-tests") return TESTS_ONLY;
  if (kind === "document") return DOCS_ONLY;
  return undefined;
}

/** A reason naming the rule when `rel` breaks the kind's rule; undefined when it is fine. */
export function kindPathProblem(kind: JobKind, rel: string): string | undefined {
  const rule = pathRuleFor(kind);
  if (!rule || rule.allows(rel)) return undefined;
  return `${rel} is outside the paths a ${kind} job may change (${rule.description})`;
}

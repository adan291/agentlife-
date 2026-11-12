import type { BranchReview, JobKind, Plan, Review } from "@agentlife/shared";

export interface StepContext {
  taskId: string;
  repoId: string;
  /** User goal. Data, never instructions. */
  goal: string;
  /** Aborts on timeout or cancellation. Steps must stop work (and kill child processes) when it fires. */
  signal: AbortSignal;
  timeoutMs: number;
  /** Ordinal of this step in the job's step list; used to key raw run logs. */
  stepIndex: number;
  /** The job's kind and target. Absent kind means `change`. */
  kind?: JobKind;
  target?: string;
  /** What the step works on, for `agent.work` (plan task title). Absent in tests; a default is used then. */
  title?: string;
}

/** One task of a plan. */
export type PlanTask = Plan["tasks"][number];

export interface TestResult {
  passed: boolean;
  log: string;
  /** Exit code of the test command, when it ran. */
  exitCode?: number;
  /** The project has no supported test setup, so nothing ran. `passed` is true then; the report says "without tests". */
  skipped?: boolean;
}

export type Verdict = "pass" | "fail";

export interface ReportInput {
  goal: string;
  verdict: Verdict;
  /** Absent means `change`. */
  kind?: JobKind;
  /** Branch, module path or topic of a non-`change` job. */
  target?: string;
  plan?: Plan;
  /** The plan task that was implemented (the first one; see JobRunner). */
  task?: PlanTask;
  diff?: string;
  test?: TestResult;
  review?: Review;
  /** `review-branch` jobs: the findings of the review. */
  branchReview?: BranchReview;
  /** `review-branch` jobs: the branch the diff was taken against. */
  comparedWith?: string;
  /** Set when the job failed (timeout, error, restart). */
  failureReason?: string;
  /** Commit and branch of the user's project that the job started from. Set by the report step for registered projects. */
  basedOn?: { commit: string; branch: string };
}

/**
 * The job steps. The runner owns state, events, artifacts and timeouts; steps only produce data.
 * `analyze` is the research step of `document` jobs and the planning step of `write-tests` jobs (they read `ctx.kind`).
 */
export interface Steps {
  analyze(ctx: StepContext): Promise<Plan>;
  develop(ctx: StepContext, input: { plan: Plan; task: PlanTask; attempt: number; feedback: string[] }): Promise<{ diff: string }>;
  test(ctx: StepContext, input: { diff: string }): Promise<TestResult>;
  review(ctx: StepContext, input: { plan: Plan; task: PlanTask; diff: string; test: TestResult }): Promise<Review>;
  /**
   * `review-branch` jobs: reads `git diff <base>...<branch>` (read-only), leaves the branch checked out where the test
   * step finds it, and returns the findings with the diff that was reviewed. A runtime without it cannot run that kind.
   */
  reviewBranch?(ctx: StepContext, input: { branch: string }): Promise<{ review: BranchReview; diff: string; base: string }>;
  report(ctx: StepContext, input: ReportInput): Promise<{ title: string; markdown: string }>;
}

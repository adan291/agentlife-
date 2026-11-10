import type { Plan, Review } from "@agentlife/shared";

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
}

/** One task of a plan. */
export type PlanTask = Plan["tasks"][number];

export interface TestResult {
  passed: boolean;
  log: string;
  /** Exit code of the test command, when it ran. */
  exitCode?: number;
}

export type Verdict = "pass" | "fail";

export interface ReportInput {
  goal: string;
  verdict: Verdict;
  plan?: Plan;
  /** The plan task that was implemented (the first one; see JobRunner). */
  task?: PlanTask;
  diff?: string;
  test?: TestResult;
  review?: Review;
  /** Set when the job failed (timeout, error, restart). */
  failureReason?: string;
}

/** The five job steps. The runner owns state, events, artifacts and timeouts; steps only produce data. */
export interface Steps {
  analyze(ctx: StepContext): Promise<Plan>;
  develop(ctx: StepContext, input: { plan: Plan; task: PlanTask; attempt: number; feedback: string[] }): Promise<{ diff: string }>;
  test(ctx: StepContext, input: { diff: string }): Promise<TestResult>;
  review(ctx: StepContext, input: { plan: Plan; task: PlanTask; diff: string; test: TestResult }): Promise<Review>;
  report(ctx: StepContext, input: ReportInput): Promise<{ title: string; markdown: string }>;
}

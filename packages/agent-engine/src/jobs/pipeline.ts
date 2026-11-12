import type { JobState, PipelineStep, PipelineStepKind } from "@agentlife/shared";
import { buildTransitions } from "./kinds.ts";

/**
 * The state a job is in while a pipeline step runs. Research happens inside `analyzing` (before the plan) and the second
 * review inside `reviewing`, so no step adds a state: the clients, the stepper and the board keep working on the same
 * states whatever the pipeline is.
 */
export const STATE_OF_STEP: Readonly<Record<PipelineStepKind, JobState>> = {
  research: "analyzing",
  plan: "analyzing",
  approve: "awaiting_plan_approval",
  develop: "developing",
  test: "testing",
  review: "reviewing",
  "second-review": "reviewing",
  report: "report_ready",
};

/** The states a job passes through for a pipeline, in order: `created`, then one per step, steps that share a state merged. */
export function stateFlowOf(steps: readonly PipelineStep[]): JobState[] {
  const flow: JobState[] = ["created"];
  for (const s of steps) {
    const state = STATE_OF_STEP[s.kind];
    if (flow[flow.length - 1] !== state) flow.push(state);
  }
  return flow;
}

/**
 * The transition table of a validated pipeline (requirement 1.3). A state can only be entered from the one before it in
 * the flow, so a job never reaches `developing` except through `awaiting_plan_approval`, and never `reviewing` except
 * through `testing`. For the default pipeline this is exactly `TRANSITIONS`.
 */
export function transitionsOfPipeline(steps: readonly PipelineStep[]): Readonly<Record<JobState, readonly JobState[]>> {
  return buildTransitions(stateFlowOf(steps));
}

/** The member a step names, if any. */
export function memberOfStep(steps: readonly PipelineStep[] | undefined, kind: PipelineStepKind): string | undefined {
  return steps?.find((s) => s.kind === kind)?.memberId;
}

export function hasStep(steps: readonly PipelineStep[] | undefined, kind: PipelineStepKind): boolean {
  return steps?.some((s) => s.kind === kind) ?? false;
}

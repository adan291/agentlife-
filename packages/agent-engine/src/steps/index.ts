import type { Steps } from "../jobs/steps.ts";
import { analyzeStep } from "./analyze.ts";
import type { PipelineDeps } from "./deps.ts";
import { developStep } from "./develop.ts";
import { reportStep } from "./report.ts";
import { reviewStep } from "./review.ts";
import { testStep } from "./test.ts";

/** The real pipeline: the five step functions bound to their shared dependencies. */
export function createPipelineSteps(deps: PipelineDeps): Steps {
  return {
    analyze: (ctx) => analyzeStep(deps, ctx),
    develop: (ctx, input) => developStep(deps, ctx, { task: input.task, attempt: input.attempt, feedback: input.feedback }),
    test: (ctx) => testStep(deps, ctx),
    review: (ctx, input) => reviewStep(deps, ctx, input),
    report: (ctx, input) => reportStep(deps, ctx, input),
  };
}

import type { Steps } from "../jobs/steps.ts";
import { analyzeStep } from "./analyze.ts";
import { auditDepsStep } from "./audit-deps.ts";
import type { PipelineDeps } from "./deps.ts";
import { developStep } from "./develop.ts";
import { reportStep } from "./report.ts";
import { researchStep } from "./research.ts";
import { reviewBranchStep } from "./review-branch.ts";
import { reviewStep } from "./review.ts";
import { testStep } from "./test.ts";

/** The real pipeline: the step functions bound to their shared dependencies. */
export function createPipelineSteps(deps: PipelineDeps): Steps {
  return {
    analyze: (ctx) => analyzeStep(deps, ctx),
    develop: (ctx, input) => developStep(deps, ctx, { task: input.task, attempt: input.attempt, feedback: input.feedback }),
    test: (ctx) => testStep(deps, ctx),
    review: (ctx, input) => reviewStep(deps, ctx, input),
    // The same step as the review: the member and the model come from the pipeline (`ctx.memberId`), and the prompt does
    // not carry the first review, so the answer is independent.
    secondReview: (ctx, input) => reviewStep(deps, ctx, input),
    research: (ctx) => researchStep(deps, ctx),
    reviewBranch: (ctx, input) => reviewBranchStep(deps, ctx, input),
    auditDeps: (ctx) => auditDepsStep(deps, ctx),
    report: (ctx, input) => reportStep(deps, ctx, input),
  };
}

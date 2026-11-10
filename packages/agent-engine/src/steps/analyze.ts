import { PlanSchema, type Plan } from "@agentlife/shared";
import type { StepContext } from "../jobs/steps.ts";
import { fence, loadPromptTemplate, renderPrompt } from "../prompts.ts";
import { findRepo, runRole, type PipelineDeps } from "./deps.ts";
import { runStructured } from "./extract-json.ts";
import { materialise } from "./materialise.ts";

/** Task ids must be unique, or an approval could not name a task. */
export function checkPlan(plan: Plan): string | undefined {
  const seen = new Set<string>();
  for (const t of plan.tasks) {
    if (seen.has(t.id)) return `tasks.id: duplicate id '${t.id}'`;
    seen.add(t.id);
  }
  return undefined;
}

/**
 * Architect step: materialise the repo, run the read-only Architect on it and return the validated plan.
 * An invalid reply gets one retry with the validation error appended (requirement 4.3).
 * The runner stores plan.json and asks for approval, one option per task.
 */
export async function analyzeStep(deps: PipelineDeps, ctx: StepContext): Promise<Plan> {
  const repo = findRepo(deps, ctx.repoId);
  const mat = await materialise({
    repo,
    ...(deps.projectRoot ? { projectRoot: deps.projectRoot } : {}),
    dataDir: deps.paths.root,
    signal: ctx.signal,
  });
  const prompt = renderPrompt(loadPromptTemplate("architect"), { goal: fence(ctx.goal) });
  return runStructured({
    what: "plan",
    schema: PlanSchema,
    check: checkPlan,
    ask: (note) => runRole(deps, "architect", "analyze", ctx, note ? `${prompt}\n\n${note}` : prompt, mat.dir),
  });
}

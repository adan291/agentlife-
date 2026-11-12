import { PlanSchema, type Plan } from "@agentlife/shared";
import type { StepContext } from "../jobs/steps.ts";
import { memoryBlock } from "../memory/retrieve.ts";
import { fence, loadPromptTemplate, renderPrompt, templateFor } from "../prompts.ts";
import { resolveProject, runRole, type PipelineDeps } from "./deps.ts";
import { runStructured } from "./extract-json.ts";
import { cloneProject, materialise } from "./materialise.ts";

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
 * Prepares the repo a read-only agent works in: the built-in fixture is copied into a one-commit repository; a registered
 * project is cloned at its current branch and `HEAD` after the registry has checked the folder is still inside an allowed
 * root. Returns the directory.
 */
export async function prepareProjectDir(deps: PipelineDeps, ctx: StepContext): Promise<string> {
  const project = resolveProject(deps, ctx.repoId);
  if (project.builtin) {
    const mat = await materialise({
      repo: { id: project.id, source: project.source ?? "" },
      ...(deps.projectRoot ? { projectRoot: deps.projectRoot } : {}),
      dataDir: deps.paths.root,
      signal: ctx.signal,
    });
    return mat.dir;
  }
  if (!deps.projects) throw new Error(`unknown repo '${ctx.repoId}'`);
  const sourcePath = deps.projects.revalidate(project);
  const cloned = await cloneProject({ id: project.id, sourcePath, dataDir: deps.paths.root, signal: ctx.signal });
  return cloned.dir;
}

/**
 * Architect step: prepare the repo, run the read-only Architect on it and return the validated plan.
 * An invalid reply gets one retry with the validation error appended (requirement 4.3).
 * The notes of a research step, when the pipeline has one, go into the prompt as fenced data.
 * The runner stores plan.json and asks for approval, one option per task.
 */
export async function analyzeStep(deps: PipelineDeps, ctx: StepContext): Promise<Plan> {
  const dir = await prepareProjectDir(deps, ctx);
  const kind = ctx.kind ?? "change";
  const prompt = renderPrompt(loadPromptTemplate(templateFor("architect", kind)), {
    goal: fence(ctx.goal),
    memory: memoryBlock(deps.memory, ctx.repoId, { goal: ctx.goal, files: ctx.target ? [ctx.target] : [] }, deps.logger),
    research: ctx.research ? fence(ctx.research, "markdown") : "(none)",
    ...(kind === "change" ? {} : { target: fence(ctx.target ?? "") }),
  });
  return runStructured({
    what: "plan",
    schema: PlanSchema,
    check: checkPlan,
    ask: (note) => runRole(deps, "architect", "analyze", ctx, note ? `${prompt}\n\n${note}` : prompt, dir),
  });
}

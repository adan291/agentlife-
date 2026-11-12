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
 * Architect step: prepare the repo, run the read-only Architect on it and return the validated plan.
 * The built-in fixture is copied into a one-commit repository; a registered project is cloned at its current
 * branch and `HEAD` after the registry has checked the folder is still inside an allowed root.
 * An invalid reply gets one retry with the validation error appended (requirement 4.3).
 * The runner stores plan.json and asks for approval, one option per task.
 */
export async function analyzeStep(deps: PipelineDeps, ctx: StepContext): Promise<Plan> {
  const project = resolveProject(deps, ctx.repoId);
  let dir: string;
  if (project.builtin) {
    const mat = await materialise({
      repo: { id: project.id, source: project.source ?? "" },
      ...(deps.projectRoot ? { projectRoot: deps.projectRoot } : {}),
      dataDir: deps.paths.root,
      signal: ctx.signal,
    });
    dir = mat.dir;
  } else {
    if (!deps.projects) throw new Error(`unknown repo '${ctx.repoId}'`);
    const sourcePath = deps.projects.revalidate(project);
    const cloned = await cloneProject({ id: project.id, sourcePath, dataDir: deps.paths.root, signal: ctx.signal });
    dir = cloned.dir;
  }
  const kind = ctx.kind ?? "change";
  const prompt = renderPrompt(loadPromptTemplate(templateFor("architect", kind)), {
    goal: fence(ctx.goal),
    memory: memoryBlock(deps.memory, ctx.repoId, { goal: ctx.goal, files: ctx.target ? [ctx.target] : [] }, deps.logger),
    ...(kind === "change" ? {} : { target: fence(ctx.target ?? "") }),
  });
  return runStructured({
    what: "plan",
    schema: PlanSchema,
    check: checkPlan,
    ask: (note) => runRole(deps, "architect", "analyze", ctx, note ? `${prompt}\n\n${note}` : prompt, dir),
  });
}

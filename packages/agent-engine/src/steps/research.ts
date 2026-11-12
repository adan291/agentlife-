import type { StepContext } from "../jobs/steps.ts";
import { memoryBlock } from "../memory/retrieve.ts";
import { fence, loadPromptTemplate, renderPrompt } from "../prompts.ts";
import { runRole, type PipelineDeps } from "./deps.ts";
import { prepareProjectDir } from "./analyze.ts";

/** The notes are cut here, so one long answer cannot crowd out the Architect's own instructions. */
export const RESEARCH_MAX_CHARS = 8_000;

/** The notes as the Architect receives them: no code fences of its own, bounded. */
export function cleanResearch(text: string): string {
  const flat = text.replace(/\r\n/g, "\n").trim();
  return flat.length <= RESEARCH_MAX_CHARS ? flat : `${flat.slice(0, RESEARCH_MAX_CHARS)}\n[notes truncated]`;
}

/**
 * Research step (pipeline-editor, requirement 3.1): a read-only researcher reads the project and returns Markdown notes.
 * The notes are data; the Architect gets them fenced in its prompt and the runner keeps them as the artifact `research.md`.
 * The researcher runs on the Architect's runtime with its own agent file, so it has the read-only tier and nothing else.
 */
export async function researchStep(deps: PipelineDeps, ctx: StepContext): Promise<string> {
  const dir = await prepareProjectDir(deps, ctx);
  const prompt = renderPrompt(loadPromptTemplate("researcher"), {
    goal: fence(ctx.goal),
    memory: memoryBlock(deps.memory, ctx.repoId, { goal: ctx.goal, files: [] }, deps.logger),
  });
  const out = await runRole(deps, "architect", "research", ctx, prompt, dir);
  const notes = cleanResearch(out);
  if (!notes) throw new Error("the researcher returned no notes");
  return notes;
}

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DiffRejectedError } from "../errors.ts";
import type { PlanTask, StepContext } from "../jobs/steps.ts";
import { DEVELOPER_IDENTITY, git } from "../git.ts";
import { memoryBlock } from "../memory/retrieve.ts";
import { fence, loadPromptTemplate, renderPrompt, templateFor } from "../prompts.ts";
import { repoDir, runRole, worktreeDir, type PipelineDeps } from "./deps.ts";
import { parseGitDiff, validateDiff, type DiffCheck } from "./validate-diff.ts";

/** A rejected patch is stored for the report, cut at this size. */
export const MAX_STORED_REJECTED_DIFF = 200 * 1024;

export function branchName(taskId: string): string {
  return `agentlife/${taskId}`;
}

function commitTitle(task: PlanTask): string {
  const t = task.title.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim().slice(0, 100);
  return `agentlife: ${t || task.id}`;
}

const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-renames"] as const;

export interface DevelopInput {
  task: PlanTask;
  attempt: number;
  feedback: readonly string[];
}

/**
 * Developer step: worktree `data/worktrees/<taskId>` on branch `agentlife/<taskId>`, the Developer agent
 * with that directory as cwd, then the engine validates the diff (requirement 5.3) before committing it.
 * The second attempt reuses the worktree, so the diff is always relative to the materialised commit.
 */
export async function developStep(deps: PipelineDeps, ctx: StepContext, input: DevelopInput): Promise<{ diff: string }> {
  const repo = repoDir(deps, ctx.repoId);
  const wt = worktreeDir(deps, ctx.taskId);
  const gitOpts = { signal: ctx.signal };
  const base = (await git(repo, ["rev-parse", "HEAD"], gitOpts)).trim();

  if (input.attempt === 1) {
    if (existsSync(wt)) throw new Error(`worktree already exists: ${wt}`);
    mkdirSync(path.dirname(wt), { recursive: true });
    await git(repo, ["worktree", "add", "--quiet", "-b", branchName(ctx.taskId), wt, base], gitOpts);
  } else if (!existsSync(wt)) {
    throw new Error(`worktree is missing for attempt ${input.attempt}: ${wt}`);
  }

  const kind = ctx.kind ?? "change";
  const prompt = renderPrompt(loadPromptTemplate(templateFor("developer", kind)), {
    goal: fence(ctx.goal),
    memory: memoryBlock(deps.memory, ctx.repoId, { goal: `${ctx.goal} ${input.task.title}`, files: [...input.task.files, ...(ctx.target ? [ctx.target] : [])] }, deps.logger),
    task: fence(JSON.stringify(input.task, null, 2), "json"),
    feedback: fence(input.feedback.length ? input.feedback.join("\n") : "(none)"),
  });
  await runRole(deps, "developer", "develop", ctx, prompt, wt);
  ctx.signal.throwIfAborted();

  // Engine-side containment: the source repository must not have changed.
  const head = (await git(repo, ["rev-parse", "HEAD"], gitOpts)).trim();
  const dirty = (await git(repo, ["status", "--porcelain", "--untracked-files=all"], gitOpts)).trim();
  if (head !== base || dirty !== "") {
    throw new DiffRejectedError("the Developer changed files outside its worktree", "");
  }

  await git(wt, ["add", "-A"], gitOpts);
  const patchFull = await git(wt, ["diff", "--cached", ...DIFF_FLAGS, base], gitOpts);
  const patchBytes = Buffer.byteLength(patchFull);
  const stored =
    patchBytes > MAX_STORED_REJECTED_DIFF
      ? `${patchFull.slice(0, MAX_STORED_REJECTED_DIFF)}\n[patch truncated: ${patchBytes} bytes]\n`
      : patchFull;

  let verdict: DiffCheck;
  try {
    const raw = await git(wt, ["diff", "--cached", "--raw", "-z", "--no-abbrev", ...DIFF_FLAGS, base], gitOpts);
    const numstat = await git(wt, ["diff", "--cached", "--numstat", "-z", ...DIFF_FLAGS, base], gitOpts);
    verdict = validateDiff(wt, parseGitDiff(raw, numstat), deps.limits, patchBytes, kind, ctx.pathRule);
  } catch (e) {
    if (e instanceof DiffRejectedError) throw e;
    verdict = { ok: false as const, reason: `cannot read the diff: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!verdict.ok) throw new DiffRejectedError(verdict.reason, stored);

  await git(wt, ["commit", "--quiet", "--allow-empty", "-m", commitTitle(input.task)], { ...gitOpts, identity: DEVELOPER_IDENTITY });
  return { diff: patchFull };
}

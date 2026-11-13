import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  FINDING_TEXT_MAX,
  FindingSeveritySchema,
  BRANCH_FINDINGS_MAX,
  RiskSchema,
  VerdictSchema,
  isSafeBranchName,
  reviewBaseOf,
  type BranchReview,
  type FindingSeverity,
} from "@agentlife/shared";
import { git } from "../git.ts";
import type { StepContext } from "../jobs/steps.ts";
import { diffFiles, memoryBlock } from "../memory/retrieve.ts";
import { readBranches } from "../projects/branches.ts";
import { fence, loadPromptTemplate, renderPrompt } from "../prompts.ts";
import { MAX_STORED_REJECTED_DIFF } from "./develop.ts";
import { repoDir, resolveProject, runRole, worktreeDir, type PipelineDeps } from "./deps.ts";
import { runStructured } from "./extract-json.ts";
import { cloneProject, isReservedAgentPath } from "./materialise.ts";
import { diffForPrompt } from "./review.ts";

const HEAD_REF = "refs/al-review/head";
const BASE_REF = "refs/al-review/base";
const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-renames"] as const;
const SEVERITY_ORDER: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2 };

/** What the model may send. Long texts and long lists are cut by the engine instead of failing the review. */
const RawBranchReviewSchema = z.object({
  verdict: VerdictSchema,
  risk: RiskSchema,
  findings: z
    .array(z.object({ severity: FindingSeveritySchema, text: z.string().min(1), file: z.string().min(1).optional() }))
    .max(100),
});

/**
 * The engine's last word on a branch review (like `finalizeReview` for a change): findings are bounded and sorted by
 * severity, and a branch with a high finding is never "ready to merge", whatever the model said.
 */
export function finalizeBranchReview(raw: z.infer<typeof RawBranchReviewSchema>): BranchReview {
  const findings = raw.findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || a.i - b.i)
    .slice(0, BRANCH_FINDINGS_MAX)
    .map(({ f }) => ({
      severity: f.severity,
      text: f.text.length > FINDING_TEXT_MAX ? `${f.text.slice(0, FINDING_TEXT_MAX - 1)}…` : f.text,
      ...(f.file ? { file: f.file.slice(0, 200) } : {}),
    }));
  const high = findings.some((f) => f.severity === "high");
  return { verdict: high ? "fail" : raw.verdict, risk: raw.risk, findings };
}

/** Picks the branch the review compares with: the checked-out one, else `main`, else `master` (rule in shared). */
export const pickBase = reviewBaseOf;

/** Refuses a branch whose files could reach outside the checkout (links) or shadow the product's agents. */
export async function checkBranchTree(dir: string, ref: string, signal?: AbortSignal): Promise<void> {
  const listing = await git(dir, ["ls-tree", "-r", "-z", ref], signal ? { signal } : {});
  for (const rec of listing.split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    const mode = rec.slice(0, 6);
    const rel = rec.slice(tab + 1);
    if (mode === "120000") throw new Error(`the branch contains a symbolic link: ${rel}`);
    if (isReservedAgentPath(rel)) throw new Error(`the branch contains a reserved agent file: ${rel}`);
  }
}

/**
 * Review step of a `review-branch` job (job-types, requirement 1.2). Read-only for the user's repository:
 * 1. the job clone is made as for any job; the branch and its base are fetched INTO THE CLONE (a registered project) or
 *    taken from the engine's own repository (the built-in one),
 * 2. the engine checks the branch's files, then checks them out detached in `data/worktrees/<taskId>`, where QA reads
 *    them and where the test step finds them afterwards,
 * 3. QA gets `git diff <base>...<branch>` as fenced data and answers with findings by severity.
 */
export async function reviewBranchStep(
  deps: PipelineDeps,
  ctx: StepContext,
  input: { branch: string },
): Promise<{ review: BranchReview; diff: string; base: string }> {
  const { branch } = input;
  if (!isSafeBranchName(branch)) throw new Error("invalid branch name");
  const project = resolveProject(deps, ctx.repoId);
  const gitOpts = { signal: ctx.signal };
  let dir: string;
  let headRef: string;
  let baseRef: string;
  let baseName: string;

  if (project.builtin) {
    dir = repoDir(deps, project.id);
    if (!existsSync(path.join(dir, ".git"))) throw new Error(`'${branch}' is not a branch of this project`);
    const { current, branches } = await readBranches(dir, ctx.signal);
    if (!branches.includes(branch)) throw new Error(`'${branch}' is not a branch of this project`);
    const base = pickBase(branch, current, branches);
    if (!base) throw new Error("there is no other branch to compare it with");
    baseName = base;
    headRef = `refs/heads/${branch}`;
    baseRef = `refs/heads/${base}`;
  } else {
    if (!deps.projects) throw new Error(`unknown repo '${ctx.repoId}'`);
    const sourcePath = deps.projects.revalidate(project);
    const source = await readBranches(sourcePath, ctx.signal);
    if (!source.branches.includes(branch)) throw new Error(`'${branch}' is not a branch of this project`);
    const base = pickBase(branch, source.current, source.branches);
    if (!base) throw new Error("there is no other branch to compare it with");
    baseName = base;
    const cloned = await cloneProject({ id: project.id, sourcePath, dataDir: deps.paths.root, signal: ctx.signal });
    dir = cloned.dir;
    // The only command that reads the user's repository besides the clone; both refs land in the clone.
    await git(
      dir,
      ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--no-recurse-submodules", sourcePath, `+refs/heads/${branch}:${HEAD_REF}`, `+refs/heads/${base}:${BASE_REF}`],
      gitOpts,
    );
    headRef = HEAD_REF;
    baseRef = BASE_REF;
  }

  await checkBranchTree(dir, headRef, ctx.signal);
  const patch = await git(dir, ["diff", ...DIFF_FLAGS, `${baseRef}...${headRef}`], gitOpts);
  if (patch.trim() === "") throw new Error(`'${branch}' has no changes compared with '${baseName}'`);
  const bytes = Buffer.byteLength(patch);
  const diff = bytes > MAX_STORED_REJECTED_DIFF ? `${patch.slice(0, MAX_STORED_REJECTED_DIFF)}\n[patch truncated: ${bytes} bytes]\n` : patch;

  const wt = worktreeDir(deps, ctx.taskId);
  if (existsSync(wt)) throw new Error(`worktree already exists: ${wt}`);
  mkdirSync(path.dirname(wt), { recursive: true });
  await git(dir, ["worktree", "add", "--quiet", "--detach", wt, headRef], gitOpts);
  ctx.signal.throwIfAborted();

  const prompt = renderPrompt(loadPromptTemplate("qa-branch"), {
    goal: fence(ctx.goal),
    memory: memoryBlock(deps.memory, ctx.repoId, { goal: `${ctx.goal} ${branch}`, files: diffFiles(diff) }, deps.logger),
    branch: fence(branch),
    base: fence(baseName),
    diff: fence(diffForPrompt(diff), "diff"),
  });
  const raw = await runStructured({
    what: "branch review",
    schema: RawBranchReviewSchema,
    ask: (note) => runRole(deps, "qa", "review", ctx, note ? `${prompt}\n\n${note}` : prompt, wt),
  });
  // QA is read-only; the engine checks that it did not change the checkout, as it does for the Developer.
  const dirty = (await git(wt, ["status", "--porcelain", "--untracked-files=all"], gitOpts)).trim();
  if (dirty !== "") throw new Error("the reviewer changed files in the checkout");
  return { review: finalizeBranchReview(raw), diff, base: baseName };
}

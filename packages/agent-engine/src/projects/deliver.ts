import path from "node:path";
import type { DeliveryInfo } from "@agentlife/shared";
import { ConflictError } from "../errors.ts";
import { GitError, git } from "../git.ts";
import type { DataPaths } from "../paths.ts";
import { isInside } from "../paths.ts";
import type { Logger } from "../log.ts";
import { branchName } from "../steps/develop.ts";
import { ProjectUnavailableError, type ProjectRegistry } from "./registry.ts";

const SAFE_TASK_ID = /^[A-Za-z0-9_-]+$/;

export interface DeliverOptions {
  registry: ProjectRegistry;
  paths: DataPaths;
  taskId: string;
  /** The project the job ran on. */
  repoId: string;
  /** Branch already delivered for this job, if any (from the job's events). */
  alreadyDelivered?: DeliveryInfo | undefined;
  logger?: Logger | undefined;
  signal?: AbortSignal | undefined;
}

/** Git settings for the one command that runs in the user's repository: nothing runs in the background there. */
const QUIET = ["-c", "gc.auto=0", "-c", "maintenance.auto=false"] as const;

async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await git(cwd, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch (e) {
    if (e instanceof GitError && e.exitCode === 1) return false;
    throw e;
  }
}

/**
 * Delivers a finished job to the user's repository as a new branch `agentlife/<taskId>`, with
 * `git -C <project> fetch <job clone> refs/heads/agentlife/<taskId>:refs/heads/agentlife/<taskId>`.
 *
 * That command writes objects and one new branch ref, and nothing else: no checkout, so the working copy, the index
 * and the current branch stay as they are. It is never forced, so an existing branch of that name is refused (checked
 * first, and git itself would refuse a non-fast-forward). The engine never pushes, merges, rebases or edits the git
 * config of the user's repository.
 */
export async function deliverBranch(opts: DeliverOptions): Promise<DeliveryInfo> {
  const { registry, taskId } = opts;
  if (!SAFE_TASK_ID.test(taskId)) throw new ConflictError("invalid_task", "Invalid task id.");
  const project = registry.get(opts.repoId);
  if (!project || project.builtin) {
    throw new ConflictError("not_deliverable", "Only jobs on a registered project can be delivered; the built-in project has no repository of yours.");
  }
  if (opts.alreadyDelivered) {
    throw new ConflictError("already_delivered", `This job was already delivered as branch ${opts.alreadyDelivered.branch}.`);
  }

  const branch = branchName(taskId);
  const ref = `refs/heads/${branch}`;
  const clone = path.join(opts.paths.repos, project.id);
  if (!isInside(opts.paths.repos, clone)) throw new ConflictError("not_deliverable", "Invalid project.");

  // The job's commit lives in the engine's clone; a newer job on the same project replaces that clone.
  let tip: string;
  try {
    tip = (await git(clone, ["rev-parse", "--verify", "--quiet", ref], opts.signal ? { signal: opts.signal } : {})).trim();
  } catch {
    throw new ConflictError("branch_missing", "The job's branch is no longer available. A newer job on this project replaced it.");
  }
  const base = (await git(clone, ["rev-parse", "--verify", "HEAD"])).trim();
  if (tip === base) throw new ConflictError("nothing_to_deliver", "The job made no change, so there is nothing to deliver.");

  let real: string;
  try {
    real = registry.revalidate(project);
  } catch (e) {
    if (e instanceof ProjectUnavailableError) throw new ConflictError("project_unavailable", e.message);
    throw e;
  }

  if (await refExists(real, ref)) {
    throw new ConflictError("branch_exists", `The branch ${branch} already exists in your repository. Nothing was changed.`);
  }
  try {
    await git(real, [...QUIET, "fetch", "--quiet", "--no-write-fetch-head", "--no-tags", "--no-recurse-submodules", clone, `${ref}:${ref}`], opts.signal ? { signal: opts.signal } : {});
  } catch (e) {
    opts.logger?.error("delivery failed", { taskId, error: e instanceof Error ? e.message : String(e) });
    throw new ConflictError("delivery_failed", "Git could not create the branch in your repository. Nothing was changed.");
  }
  const commit = (await git(real, ["rev-parse", "--verify", ref])).trim();
  if (commit !== tip) throw new ConflictError("delivery_failed", "The delivered branch does not match the job's commit.");
  return { branch, commit };
}

import { existsSync } from "node:fs";
import path from "node:path";
import { isSafeBranchName, type BranchesResponse } from "@agentlife/shared";
import { NotFoundError } from "../errors.ts";
import { git } from "../git.ts";
import type { DataPaths } from "../paths.ts";
import type { ProjectRegistry, ResolvedProject } from "./registry.ts";

/** The branch picker never shows more than this many branches (the newest first). */
export const MAX_BRANCHES = 200;

export interface BranchList {
  /** The branch that is checked out, if it has a usable name. */
  current: string | null;
  /** Local branches, most recently committed first. Names the hotel cannot handle are left out. */
  branches: string[];
}

/**
 * Reads the local branches of a git repository with `git for-each-ref refs/heads` and the checked-out branch with
 * `git symbolic-ref`. Both only read.
 */
export async function readBranches(dir: string, signal?: AbortSignal): Promise<BranchList> {
  const opts = signal ? { signal } : {};
  const out = await git(dir, ["for-each-ref", "--sort=-committerdate", "--format=%(refname)", "refs/heads"], opts);
  const prefix = "refs/heads/";
  const branches = out
    .split(/\r?\n/)
    .filter((l) => l.startsWith(prefix))
    .map((l) => l.slice(prefix.length))
    .filter(isSafeBranchName)
    .slice(0, MAX_BRANCHES);
  let current: string | null = null;
  try {
    const name = (await git(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"], opts)).trim();
    if (isSafeBranchName(name)) current = name;
  } catch {
    // detached HEAD or an empty repository
  }
  return { current, branches };
}

/**
 * The folder whose branches the picker lists: the user's repository for a registered project (checked against the
 * allowed roots again), the engine's materialised repository for the built-in one, which only exists after a job.
 */
export function branchSource(registry: ProjectRegistry, paths: DataPaths, project: ResolvedProject): string | undefined {
  if (!project.builtin) return registry.revalidate(project);
  const dir = path.join(paths.repos, project.id);
  return existsSync(path.join(dir, ".git")) ? dir : undefined;
}

export interface ListBranchesOptions {
  registry: ProjectRegistry;
  paths: DataPaths;
  repoId: string;
  signal?: AbortSignal;
}

/** Requirement 2.2: the local branches of a project, read by the engine. Never free text. */
export async function listBranches(opts: ListBranchesOptions): Promise<BranchesResponse> {
  const project = opts.registry.get(opts.repoId);
  if (!project) throw new NotFoundError("unknown project");
  const dir = branchSource(opts.registry, opts.paths, project);
  if (!dir) return { current: null, branches: [] };
  return readBranches(dir, opts.signal);
}

import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { RepoConfig } from "../config.ts";
import { ENGINE_IDENTITY, git } from "../git.ts";
import { dataPaths, isInside, PROJECT_ROOT } from "../paths.ts";

/** Fixed date so that materialising the same source always yields the same commit id. */
export const MATERIALISE_DATE = "2026-01-01T00:00:00Z";
export const MATERIALISE_MESSAGE = "Initial commit";

const SAFE_REPO_ID = /^[a-z0-9][a-z0-9-]*$/;
/** Directories that are never copied. */
const SKIP_DIRS = new Set(["node_modules", ".git"]);

export class MaterialiseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterialiseError";
  }
}

export interface MaterialiseOptions {
  repo: Pick<RepoConfig, "id" | "source">;
  /** Source paths are resolved against this directory and must stay inside it. Default: the project root. */
  projectRoot?: string;
  /** Default: `<projectRoot>/data`. The repository is created in `<dataDir>/repos/<id>`. */
  dataDir?: string;
  signal?: AbortSignal;
}

export interface MaterialisedRepo {
  repoId: string;
  /** Absolute path of the new git repository. */
  dir: string;
  /** Id of its single commit. */
  commit: string;
}

export interface CloneProjectOptions {
  /** Project id (the clone goes to `<dataDir>/repos/<id>`). */
  id: string;
  /** Real path of the user's repository. */
  sourcePath: string;
  dataDir?: string;
  signal?: AbortSignal;
}

export interface ClonedProject extends MaterialisedRepo {
  /** Branch of the user's repository that was cloned (the clone is checked out on it). */
  branch: string;
}

/** True for anything named `agentlife-*` under `.kiro/agents/`, which would shadow the product's role agents. */
export function isReservedAgentPath(relPosix: string): boolean {
  const parts = relPosix.toLowerCase().split("/");
  for (let i = 0; i + 2 < parts.length; i += 1) {
    if (parts[i] === ".kiro" && parts[i + 1] === "agents") {
      return parts.slice(i + 2).some((p) => p.startsWith("agentlife-"));
    }
  }
  return false;
}

interface SourceFile {
  rel: string;
  abs: string;
}

/** Lists the files to copy. Rejects symlinks and reserved agent files; skips node_modules and .git. */
function scanSource(root: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (relDir: string): void => {
    const absDir = path.join(root, relDir);
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = relDir === "" ? entry.name : `${relDir.split(path.sep).join("/")}/${entry.name}`;
      const abs = path.join(absDir, entry.name);
      if (entry.isSymbolicLink()) throw new MaterialiseError(`source contains a symbolic link: ${rel}`);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(relDir, entry.name));
      } else if (entry.isFile()) {
        if (isReservedAgentPath(rel)) {
          throw new MaterialiseError(`source contains a reserved agent file: ${rel}`);
        }
        out.push({ rel, abs });
      } else {
        throw new MaterialiseError(`source contains an unsupported entry: ${rel}`);
      }
    }
  };
  walk("");
  return out;
}

/**
 * Clones a registered project into `data/repos/<id>` at its current branch and `HEAD` (committed content only; the
 * user's working copy is ignored). `sourcePath` is a real path that the registry has just checked against the allowed
 * roots. The clone has no remote, no hooks and a private object store (`--no-hardlinks`), so nothing in it can
 * reach back into the user's repository. A previous clone is replaced.
 */
export async function cloneProject(opts: CloneProjectOptions): Promise<ClonedProject> {
  const { id } = opts;
  if (!SAFE_REPO_ID.test(id)) throw new MaterialiseError(`invalid repo id: ${JSON.stringify(id)}`);
  const paths = dataPaths(opts.dataDir ?? path.join(PROJECT_ROOT, "data"));
  const target = path.join(paths.repos, id);
  if (!isInside(paths.repos, target) || target === path.resolve(paths.repos)) {
    throw new MaterialiseError(`invalid target for "${id}"`);
  }
  const gitOpts = { ...(opts.signal ? { signal: opts.signal } : {}) };

  let branch: string;
  try {
    await git(opts.sourcePath, ["rev-parse", "--verify", "HEAD"], gitOpts);
    branch = (await git(opts.sourcePath, ["symbolic-ref", "--quiet", "--short", "HEAD"], gitOpts)).trim();
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new MaterialiseError(`project '${id}' has no commit on a branch (detached HEAD or empty repository)`);
  }
  if (!branch) throw new MaterialiseError(`project '${id}' is not on a branch`);

  mkdirSync(paths.repos, { recursive: true });
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  try {
    await git(
      paths.repos,
      ["clone", "--quiet", "--no-hardlinks", "--single-branch", "--template=", `--branch=${branch}`, "--", opts.sourcePath, target],
      gitOpts,
    );
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    // git's stderr names the user's absolute path; it must not leave the engine (security.md).
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw new MaterialiseError(`could not clone project '${id}' (is the folder still there and readable?)`);
  }
  try {
    await git(target, ["config", "core.autocrlf", "false"], gitOpts);
    await git(target, ["config", "commit.gpgsign", "false"], gitOpts);
    await git(target, ["remote", "remove", "origin"], gitOpts);
    // Same refusals as for the fixture: no symbolic links, no files that would shadow the product's role agents.
    const listing = await git(target, ["ls-files", "-s", "-z"], gitOpts);
    for (const rec of listing.split("\0")) {
      if (!rec) continue;
      const tab = rec.indexOf("\t");
      const mode = rec.slice(0, 6);
      const rel = rec.slice(tab + 1);
      if (mode === "120000") throw new MaterialiseError(`source contains a symbolic link: ${rel}`);
      if (isReservedAgentPath(rel)) throw new MaterialiseError(`source contains a reserved agent file: ${rel}`);
    }
  } catch (e) {
    // Agents must never see a clone that failed the checks.
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw e;
  }
  const commit = (await git(target, ["rev-parse", "HEAD"], gitOpts)).trim();
  return { repoId: id, dir: target, commit, branch };
}

/**
 * Copies an allowlisted source directory into `data/repos/<id>` as a fresh git repository with one commit,
 * so every job starts from the same state. An existing `data/repos/<id>` is replaced.
 */
export async function materialise(opts: MaterialiseOptions): Promise<MaterialisedRepo> {
  const { repo } = opts;
  if (!SAFE_REPO_ID.test(repo.id)) throw new MaterialiseError(`invalid repo id: ${JSON.stringify(repo.id)}`);
  const projectRoot = path.resolve(opts.projectRoot ?? PROJECT_ROOT);
  const paths = dataPaths(opts.dataDir ?? path.join(projectRoot, "data"));

  if (path.isAbsolute(repo.source)) throw new MaterialiseError(`source of "${repo.id}" must be relative to the project`);
  const source = path.resolve(projectRoot, repo.source);
  if (source === projectRoot || !isInside(projectRoot, source)) {
    throw new MaterialiseError(`source of "${repo.id}" escapes the project`);
  }
  let st;
  try {
    st = lstatSync(source);
  } catch {
    throw new MaterialiseError(`source of "${repo.id}" does not exist: ${repo.source}`);
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new MaterialiseError(`source of "${repo.id}" is not a directory`);

  // Scan before touching the target: a refused source leaves the previous state alone.
  const files = scanSource(source);

  const target = path.join(paths.repos, repo.id);
  if (!isInside(paths.repos, target) || target === path.resolve(paths.repos)) {
    throw new MaterialiseError(`invalid target for "${repo.id}"`);
  }
  mkdirSync(paths.repos, { recursive: true });
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(target, { recursive: true });

  for (const f of files) {
    const dest = path.join(target, f.rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(f.abs, dest);
  }

  const gitOpts = { identity: ENGINE_IDENTITY, date: MATERIALISE_DATE, ...(opts.signal ? { signal: opts.signal } : {}) };
  await git(target, ["init", "--quiet", "--initial-branch=main", "--template="], gitOpts);
  // Keep file contents byte-for-byte and keep commits free of signing, hooks and user config.
  await git(target, ["config", "core.autocrlf", "false"], gitOpts);
  await git(target, ["config", "commit.gpgsign", "false"], gitOpts);
  await git(target, ["add", "-A"], gitOpts);
  await git(target, ["commit", "--quiet", "--allow-empty", "-m", MATERIALISE_MESSAGE], gitOpts);
  const commit = (await git(target, ["rev-parse", "HEAD"], gitOpts)).trim();
  return { repoId: repo.id, dir: target, commit };
}

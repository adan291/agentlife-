import path from "node:path";
import { isInside } from "../paths.ts";

/** One changed file, from `git diff --raw -z` joined with `git diff --numstat -z`. */
export interface DiffEntry {
  path: string;
  /** A (added), M (modified), D (deleted) or anything else git reports. */
  status: string;
  oldMode: string;
  newMode: string;
  /** null for a binary file. */
  added: number | null;
  deleted: number | null;
}

export interface DiffLimits {
  maxDiffLines: number;
  maxFilesChanged: number;
  /** Cap on the patch text. Default 512 KB. */
  maxBytes?: number;
}

export type DiffCheck = { ok: true; files: number; lines: number } | { ok: false; reason: string };

export const DEFAULT_MAX_DIFF_BYTES = 512 * 1024;

/** Names the Developer may never change, wherever they are in the tree (compared in lower case). */
const DENIED_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  ".gitattributes",
  ".gitmodules",
  ".gitlab-ci.yml",
  ".travis.yml",
  "azure-pipelines.yml",
  "jenkinsfile",
]);
/** Directories (as a path segment at any depth) the Developer may never change. */
const DENIED_SEGMENTS = new Set([".git", ".github", ".kiro", ".circleci", ".gitlab"]);

/** A reason when the repository-relative, slash-separated path is not allowed; undefined when it is. */
export function pathProblem(root: string, rel: string): string | undefined {
  if (rel === "") return "empty path";
  if (rel.includes("\0")) return `invalid path ${JSON.stringify(rel)}`;
  if (rel.includes("\\") || rel.includes(":")) return `invalid path ${JSON.stringify(rel)}`;
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return `absolute path ${rel}`;
  const segments = rel.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return `path leaves the worktree: ${rel}`;
  // Windows ignores trailing dots and spaces, so "package.json." is package.json there.
  if (segments.some((s) => /[. ]$/.test(s))) return `invalid path ${JSON.stringify(rel)}`;
  if (!isInside(root, path.resolve(root, ...segments)) || path.resolve(root, ...segments) === path.resolve(root)) {
    return `path is outside the worktree: ${rel}`;
  }
  const lower = segments.map((s) => s.toLowerCase());
  if (lower.some((s) => DENIED_SEGMENTS.has(s))) return `protected path: ${rel}`;
  const base = lower[lower.length - 1] ?? "";
  if (DENIED_BASENAMES.has(base) || base.startsWith(".env")) return `protected file: ${rel}`;
  return undefined;
}

const SYMLINK_MODE = "120000";
const GITLINK_MODE = "160000";

/** Requirement 5.3: inside the worktree, nothing protected, no binary, no symlink, within the size limits. */
export function validateDiff(root: string, entries: readonly DiffEntry[], limits: DiffLimits, patchBytes = 0): DiffCheck {
  if (entries.length === 0) return { ok: false, reason: "the Developer made no change" };
  if (entries.length > limits.maxFilesChanged) {
    return { ok: false, reason: `${entries.length} files changed, the limit is ${limits.maxFilesChanged}` };
  }
  let lines = 0;
  for (const e of entries) {
    const problem = pathProblem(root, e.path);
    if (problem) return { ok: false, reason: problem };
    if (e.status !== "A" && e.status !== "M" && e.status !== "D") {
      return { ok: false, reason: `unsupported change (${e.status}) in ${e.path}` };
    }
    if (e.oldMode === SYMLINK_MODE || e.newMode === SYMLINK_MODE) return { ok: false, reason: `symbolic link: ${e.path}` };
    if (e.oldMode === GITLINK_MODE || e.newMode === GITLINK_MODE) return { ok: false, reason: `submodule or nested repository: ${e.path}` };
    if (e.added === null || e.deleted === null) return { ok: false, reason: `binary file: ${e.path}` };
    lines += e.added + e.deleted;
  }
  if (lines > limits.maxDiffLines) return { ok: false, reason: `${lines} changed lines, the limit is ${limits.maxDiffLines}` };
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_DIFF_BYTES;
  if (patchBytes > maxBytes) return { ok: false, reason: `patch is ${patchBytes} bytes, the limit is ${maxBytes}` };
  return { ok: true, files: entries.length, lines };
}

/**
 * Joins the output of `git diff --raw -z --no-abbrev --no-renames` and `git diff --numstat -z --no-renames`.
 * Throws on output it does not understand, which the caller treats as a rejected diff.
 */
export function parseGitDiff(raw: string, numstat: string): DiffEntry[] {
  const counts = new Map<string, { added: number | null; deleted: number | null }>();
  for (const rec of numstat.split("\0")) {
    if (rec === "") continue;
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(rec);
    if (!m) throw new Error(`unexpected numstat record: ${JSON.stringify(rec.slice(0, 80))}`);
    counts.set(m[3]!, { added: m[1] === "-" ? null : Number(m[1]), deleted: m[2] === "-" ? null : Number(m[2]) });
  }
  const parts = raw.split("\0");
  const entries: DiffEntry[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const head = parts[i]!;
    const file = parts[i + 1]!;
    const m = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/.exec(head);
    if (!m) throw new Error(`unexpected raw record: ${JSON.stringify(head.slice(0, 80))}`);
    const c = counts.get(file);
    if (!c) throw new Error(`no line count for ${JSON.stringify(file)}`);
    entries.push({ path: file, status: m[3]!, oldMode: m[1]!, newMode: m[2]!, added: c.added, deleted: c.deleted });
  }
  if (entries.length !== counts.size) throw new Error("raw and numstat output disagree");
  return entries;
}

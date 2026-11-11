import { realpathSync } from "node:fs";
import {
  MAX_PROJECT_BYTES,
  MAX_PROJECT_FILES,
  type ProjectStack,
  type RegisterErrorCode,
} from "@agentlife/shared";
import { SKIP_SCAN_FILE, type LeakScanner } from "@agentlife/shared/leaks";
import { git, gitRaw } from "../git.ts";
import { isInside } from "../paths.ts";
import { samePath } from "./roots.ts";

/** A registration is refused. `message` names the rule and never the project's path. */
export class ProjectCheckError extends Error {
  readonly code: RegisterErrorCode;
  constructor(code: RegisterErrorCode, message: string) {
    super(message);
    this.name = "ProjectCheckError";
    this.code = code;
  }
}

/** One tracked entry of `HEAD`. */
export interface TreeEntry {
  mode: string;
  type: string;
  sha: string;
  /** Bytes; absent for submodules. */
  size: number | undefined;
  path: string;
}

export interface Inspection {
  /** Current branch. */
  branch: string;
  head: string;
  entries: TreeEntry[];
  stack: ProjectStack;
}

/** Files above this size are not read by the leak scanner (they are not source text). */
export const SCAN_MAX_FILE_BYTES = 1024 * 1024;
/** The scanner stops reading content after this many bytes in total. */
export const SCAN_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const TREE_LINE = /^(\d{6}) (\w+) ([0-9a-f]{40,64}) +(\d+|-)\t([\s\S]*)$/;

export function parseTree(output: string): TreeEntry[] {
  const out: TreeEntry[] = [];
  for (const rec of output.split("\0")) {
    if (!rec) continue;
    const m = TREE_LINE.exec(rec);
    if (!m) continue;
    out.push({ mode: m[1]!, type: m[2]!, sha: m[3]!, size: m[4] === "-" ? undefined : Number(m[4]), path: m[5]! });
  }
  return out;
}

export function detectStack(entries: readonly TreeEntry[]): ProjectStack {
  const root = new Set(entries.filter((e) => e.type === "blob").map((e) => e.path));
  return root.has("package.json") && root.has("package-lock.json") ? "node-npm" : "unsupported-tests";
}

function mb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${bytes} bytes` : `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Checks a project folder (a real path that is already known to lie inside an allowed root): it must be the root of
 * a git repository with a commit on a branch, must not be AGENT LIFE itself and must stay within the size limits.
 */
export async function inspectProject(
  realPath: string,
  opts: { agentlifeRoot: string; limits?: { files: number; bytes: number } },
): Promise<Inspection> {
  const maxFiles = opts.limits?.files ?? MAX_PROJECT_FILES;
  const maxBytes = opts.limits?.bytes ?? MAX_PROJECT_BYTES;
  let agentlife = opts.agentlifeRoot;
  try {
    agentlife = realpathSync.native(opts.agentlifeRoot);
  } catch {
    // keep the given path
  }
  if (samePath(agentlife, realPath) || isInside(agentlife, realPath) || isInside(realPath, agentlife)) {
    throw new ProjectCheckError("is_agentlife", "AGENT LIFE cannot work on its own repository.");
  }

  let top: string;
  try {
    top = (await git(realPath, ["rev-parse", "--show-toplevel"])).trim();
    top = realpathSync.native(top);
  } catch {
    throw new ProjectCheckError("not_a_git_repo", "The folder must be the root of a git repository.");
  }
  if (!samePath(top, realPath)) {
    throw new ProjectCheckError("not_a_git_repo", "The folder must be the root of a git repository, not a subfolder of one.");
  }

  let head: string;
  try {
    head = (await git(realPath, ["rev-parse", "--verify", "HEAD"])).trim();
  } catch {
    throw new ProjectCheckError("no_commits", "The repository has no commits yet. Make a first commit.");
  }
  let branch: string;
  try {
    branch = (await git(realPath, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
  } catch {
    throw new ProjectCheckError("detached_head", "The repository is not on a branch (detached HEAD). Check out a branch.");
  }
  if (!branch) throw new ProjectCheckError("detached_head", "The repository is not on a branch (detached HEAD). Check out a branch.");

  const entries = parseTree(await git(realPath, ["ls-tree", "-r", "-l", "-z", "--full-tree", "HEAD"]));
  const files = entries.filter((e) => e.type === "blob");
  if (files.length > maxFiles) {
    throw new ProjectCheckError("too_many_files", `The repository tracks ${files.length} files; the limit is ${maxFiles}.`);
  }
  const bytes = files.reduce((sum, e) => sum + (e.size ?? 0), 0);
  if (bytes > maxBytes) {
    throw new ProjectCheckError("too_large", `The tracked files hold ${mb(bytes)}; the limit is ${mb(maxBytes)}.`);
  }
  return { branch, head, entries, stack: detectStack(entries) };
}

/** Splits the output of `git cat-file --batch`: `<sha> blob <size>\n<content>\n` per object, in request order. */
export function parseBatch(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let pos = 0;
  while (pos < buf.length) {
    const eol = buf.indexOf(0x0a, pos);
    if (eol < 0) break;
    const header = buf.toString("utf8", pos, eol).split(" ");
    const sha = header[0] ?? "";
    const size = Number(header[2]);
    if (header[1] !== "blob" || !Number.isFinite(size)) {
      pos = eol + 1; // "<sha> missing" or a non-blob: no content follows
      continue;
    }
    out.set(sha, buf.subarray(eol + 1, eol + 1 + size));
    pos = eol + 1 + size + 1;
  }
  return out;
}

/**
 * Runs the leak scanner over the tracked files of `HEAD` (the content the agents will see in the job clone), never over
 * history. Large files and anything past the total budget are checked by name only.
 */
export async function scanProject(realPath: string, entries: readonly TreeEntry[], scanner: LeakScanner): Promise<void> {
  const wanted: TreeEntry[] = [];
  let total = 0;
  for (const e of entries) {
    if (e.type !== "blob") continue;
    const size = e.size ?? 0;
    const readable = e.mode !== "120000" && !SKIP_SCAN_FILE.test(e.path) && size <= SCAN_MAX_FILE_BYTES && total + size <= SCAN_MAX_TOTAL_BYTES;
    if (readable) {
      wanted.push(e);
      total += size;
    } else {
      scanner.scanFile(e.path, new Uint8Array());
    }
  }
  if (wanted.length === 0) return;
  const contents = parseBatch(await gitRaw(realPath, ["cat-file", "--batch"], `${wanted.map((e) => e.sha).join("\n")}\n`));
  for (const e of wanted) scanner.scanFile(e.path, contents.get(e.sha) ?? new Uint8Array());
}

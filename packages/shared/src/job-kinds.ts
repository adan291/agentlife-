import { z } from "zod";

/**
 * What a job does (job-types spec). `change` is the original flow; an absent kind always means `change`.
 * The engine owns the pipeline of each kind; clients only choose the kind.
 */
export const JobKindSchema = z.enum(["change", "review-branch", "write-tests", "document", "audit-deps"]);
export type JobKind = z.infer<typeof JobKindSchema>;
export const JOB_KINDS = JobKindSchema.options;

/** Longest `target` (branch name, module path or topic). */
export const JOB_TARGET_MAX_CHARS = 200;

const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A branch name the hotel will handle: a conservative subset of what git allows. Anything else is not offered by the
 * branch picker and not accepted when a job starts. No leading `-`, no `..`, no `@{`, no trailing `.lock`.
 */
export function isSafeBranchName(name: string): boolean {
  if (name.length === 0 || name.length > JOB_TARGET_MAX_CHARS) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) return false;
  if (name.includes("..") || name.includes("//") || name.endsWith("/") || name.endsWith(".") || name.endsWith(".lock")) return false;
  return !name.split("/").some((s) => s === "" || s.startsWith(".") || s.endsWith(".lock"));
}

/** A path or module name inside the project: relative, forward slashes, no `..`, a small character set. */
export function isSafeModulePath(target: string): boolean {
  if (target.length === 0 || target.length > JOB_TARGET_MAX_CHARS) return false;
  if (!/^[A-Za-z0-9_@.][A-Za-z0-9_@. /+-]*$/.test(target)) return false;
  return !target.split("/").some((s) => s === "" || s === "." || s === ".." || /[. ]$/.test(s));
}

/** A topic is free text, one line. It is data for the agents, never an instruction. */
export function isSafeTopic(target: string): boolean {
  return target.trim().length > 0 && target.length <= JOB_TARGET_MAX_CHARS && !CONTROL.test(target);
}

/** Why `target` does not fit `kind`, or undefined when it does. */
export function targetProblem(kind: JobKind, target: string | undefined): string | undefined {
  if (kind === "change" || kind === "audit-deps") return target === undefined ? undefined : `a ${kind} job takes no target`;
  if (target === undefined || target === "") {
    return kind === "review-branch" ? "choose a branch" : kind === "write-tests" ? "name a path or module" : "name a topic or path";
  }
  if (kind === "review-branch") return isSafeBranchName(target) ? undefined : "not a valid branch name";
  if (kind === "write-tests") return isSafeModulePath(target) ? undefined : "not a valid path or module";
  return isSafeTopic(target) ? undefined : "not a valid topic";
}

export function jobKindLabel(kind: JobKind): string {
  switch (kind) {
    case "change":
      return "Change";
    case "review-branch":
      return "Branch review";
    case "write-tests":
      return "Test writing";
    case "document":
      return "Documentation";
    case "audit-deps":
      return "Dependency audit";
  }
}

/**
 * True when the job can change files of the project: it plans, waits for approval and has a Developer step.
 * The engine derives the same from its pipelines; a test keeps the two in step.
 */
export function kindWritesFiles(kind: JobKind): boolean {
  return kind === "change" || kind === "write-tests" || kind === "document";
}

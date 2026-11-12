import { kindWritesFiles, sanitize, type NightJob } from "@agentlife/shared";
import { pathRuleFor, type PathRule } from "../jobs/kinds.ts";
import type { PreApproval } from "../jobs/runner.ts";

/**
 * A plan path as the engine compares it: forward slashes, no leading `./`. Undefined for anything that is not a plain
 * path inside the project (absolute, drive letters, `..`), which is never inside a scope.
 */
export function normalizePlanPath(raw: string): string | undefined {
  const p = raw.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  if (p === "" || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.includes("\0")) return undefined;
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === "..")) return undefined;
  return p;
}

/** The scope of a `change` job: each entry is one file, or a folder when it ends with `/`. Matching is case-sensitive. */
export function scopeRule(entries: readonly string[]): PathRule {
  return {
    description: entries.join(", "),
    allows: (rel) => entries.some((e) => (e.endsWith("/") ? rel.startsWith(e) : rel === e)),
  };
}

/** What the plan is checked against: the kind's own rule (`write-tests`, `document`) or the user's scope (`change`). */
export function scopeOf(job: Pick<NightJob, "kind" | "scopePaths">): PathRule | undefined {
  if (job.kind === "change") return job.scopePaths && job.scopePaths.length > 0 ? scopeRule(job.scopePaths) : undefined;
  return pathRuleFor(job.kind);
}

/**
 * The pre-approval of a night job (requirement 2.1), or undefined when the user did not give one or the kind has no
 * approval step. A plan is approved only when it names at least one file and every file it names is inside the scope;
 * a plan that names none says nothing about what it touches, so it waits for the user (requirement 2.2). The same scope
 * then holds for the Developer's diff, so a plan inside the scope cannot grow outside it.
 */
export function preApprovalFor(job: Pick<NightJob, "kind" | "preApprove" | "scopePaths">): PreApproval | undefined {
  if (!job.preApprove || !kindWritesFiles(job.kind)) return undefined;
  const paths = scopeOf(job);
  if (!paths) return undefined;
  return {
    paths,
    check(plan) {
      const files = plan.tasks.flatMap((t) => t.files);
      if (files.length === 0) return { ok: false, reason: "the plan does not say which files it touches" };
      for (const raw of files) {
        const rel = normalizePlanPath(raw);
        const shown = sanitize(raw, 80) || "(empty)";
        if (rel === undefined) return { ok: false, reason: `${shown} is not a path inside the project` };
        if (!paths.allows(rel)) return { ok: false, reason: `${shown} is outside the pre-approved scope (${paths.description})` };
      }
      return { ok: true };
    },
  };
}

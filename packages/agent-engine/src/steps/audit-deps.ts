import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { git } from "../git.ts";
import { MARK_AUDIT, MARK_END, MARK_OUTDATED, parseAuditOutput, type AuditResult } from "../jobs/audit.ts";
import type { StepContext } from "../jobs/steps.ts";
import { resolveProject, worktreeDir, type PipelineDeps } from "./deps.ts";
import { cloneProject, materialise } from "./materialise.ts";
import { defaultDockerExec, runInSandbox, type DockerExec } from "./test.ts";

/**
 * The command the sandbox runs for an `audit-deps` job: both npm listings, then their outputs between markers, so one
 * container gives both. npm may exit with a failure (it does when packages are outdated or vulnerable, and when it
 * cannot reach the registry), so its exit codes are ignored and the JSON is read instead.
 *
 * The sandbox keeps `--network none`: Docker cannot limit a container to one host name, and an open network would let
 * a dependency's scripts talk to anyone. So npm runs with `--offline` and answers from its cache, and the report says
 * that the lists may be stale (night-shift, requirement 3.3, the offline option).
 */
export const AUDIT_COMMAND = [
  "npm outdated --json --offline >/tmp/outdated.json 2>/dev/null",
  "npm audit --json --offline >/tmp/audit.json 2>/dev/null",
  `echo '${MARK_OUTDATED}'`,
  "cat /tmp/outdated.json",
  `echo '${MARK_AUDIT}'`,
  "cat /tmp/audit.json",
  `echo '${MARK_END}'`,
].join("; ");

const NO_NPM_SETUP =
  "The project has no package.json with a package-lock.json, so there is nothing to audit with npm.";

/**
 * `audit-deps` step: a read-only checkout of the project at its current commit, then `AUDIT_COMMAND` in the project's
 * sandbox image. No model is involved. Docker problems, timeouts and cancellation are errors, as for the test step.
 */
export async function auditDepsStep(deps: PipelineDeps, ctx: StepContext, exec: DockerExec = defaultDockerExec): Promise<AuditResult> {
  const project = resolveProject(deps, ctx.repoId);
  if (project.stack === "unsupported-tests") {
    return { outdated: [], vulnerabilities: [], outdatedOk: false, auditOk: false, notes: [NO_NPM_SETUP] };
  }
  const gitOpts = { signal: ctx.signal };
  let dir: string;
  if (project.builtin) {
    const mat = await materialise({
      repo: { id: project.id, source: project.source ?? "" },
      ...(deps.projectRoot ? { projectRoot: deps.projectRoot } : {}),
      dataDir: deps.paths.root,
      signal: ctx.signal,
    });
    dir = mat.dir;
  } else {
    if (!deps.projects) throw new Error(`unknown repo '${ctx.repoId}'`);
    const sourcePath = deps.projects.revalidate(project);
    dir = (await cloneProject({ id: project.id, sourcePath, dataDir: deps.paths.root, signal: ctx.signal })).dir;
  }
  const wt = worktreeDir(deps, ctx.taskId);
  if (existsSync(wt)) throw new Error(`worktree already exists: ${wt}`);
  mkdirSync(path.dirname(wt), { recursive: true });
  await git(dir, ["worktree", "add", "--quiet", "--detach", wt, "HEAD"], gitOpts);
  ctx.signal.throwIfAborted();

  const res = await runInSandbox(deps, ctx, { project, worktree: wt, command: AUDIT_COMMAND, exec });
  return parseAuditOutput(res.output);
}

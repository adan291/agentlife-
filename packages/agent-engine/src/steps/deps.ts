import path from "node:path";
import type { ActivityEmitter } from "../activity.ts";
import type { LimitsConfig, RepoConfig } from "../config.ts";
import type { StepContext } from "../jobs/steps.ts";
import type { Logger } from "../log.ts";
import type { DataPaths } from "../paths.ts";
import type { ProjectRegistry, ResolvedProject } from "../projects/registry.ts";
import type { AgentRuntime, Role } from "../runtimes/types.ts";
import type { Store } from "../store.ts";
import type { TeamResolver } from "../team/service.ts";
import { createStepTracker } from "../work.ts";

/** What the real steps need. Built once by the engine (task 11) and shared by all steps. */
export interface PipelineDeps {
  runtimes: Record<Role, AgentRuntime>;
  store: Store;
  paths: DataPaths;
  repos: readonly RepoConfig[];
  /** Registered projects. Without it only `repos` exist (the built-in fixture). */
  projects?: ProjectRegistry;
  limits: LimitsConfig;
  /** Source paths of repos are resolved against this directory. Default: the project root. */
  projectRoot?: string;
  logger?: Logger;
  /** Carries runtime progress to the activity terminal. Optional: tests run without it. */
  activity?: ActivityEmitter;
  /** Model label per role, shown with the work of the agent (`agent.work`). */
  models?: Partial<Record<Role, string>>;
  /** The agents of each project's team. Without it every role runs the built-in agent with the configured model. */
  team?: TeamResolver;
}

const SAFE_TASK_ID = /^[A-Za-z0-9_-]+$/;

export function assertSafeTaskId(taskId: string): void {
  if (!SAFE_TASK_ID.test(taskId)) throw new Error(`invalid task id: ${JSON.stringify(taskId)}`);
}

export function findRepo(deps: PipelineDeps, repoId: string): RepoConfig {
  const repo = deps.repos.find((r) => r.id === repoId);
  if (!repo) throw new Error(`unknown repo '${repoId}'`);
  return repo;
}

/** A registered project, or the built-in fixture from config/repos.json. */
export function resolveProject(deps: PipelineDeps, repoId: string): ResolvedProject {
  const registered = deps.projects?.get(repoId);
  if (registered) return registered;
  const repo = findRepo(deps, repoId);
  return { id: repo.id, name: repo.name, stack: "node-npm", testCommand: repo.testCommand, builtin: true, registeredAt: 0, source: repo.source };
}

/** `data/repos/<repoId>`, the materialised repository (the job clone for a registered project). */
export function repoDir(deps: PipelineDeps, repoId: string): string {
  return path.join(deps.paths.repos, resolveProject(deps, repoId).id);
}

/** `data/worktrees/<taskId>`. */
export function worktreeDir(deps: PipelineDeps, taskId: string): string {
  assertSafeTaskId(taskId);
  return path.join(deps.paths.worktrees, taskId);
}

/**
 * Runs one role agent and returns its final text. Progress and usage go to `data/runs/<taskId>/<step>.jsonl`
 * (the run log the export reads); the raw runtime lines go to `<step>.raw.jsonl`.
 */
export async function runRole(
  deps: PipelineDeps,
  role: Role,
  step: string,
  ctx: StepContext,
  prompt: string,
  cwd: string,
): Promise<string> {
  assertSafeTaskId(ctx.taskId);
  const outputs: string[] = [];
  const member = deps.team?.resolve(ctx.repoId, ctx.taskId, role);
  const input = {
    role,
    prompt,
    cwd,
    timeoutMs: ctx.timeoutMs,
    signal: ctx.signal,
    rawLogPath: path.join(deps.paths.runs, ctx.taskId, `${step}.raw.jsonl`),
    ...(member ? { agent: member.agent, ...(member.model ? { model: member.model } : {}) } : {}),
  };
  const tracker = createStepTracker({
    store: deps.store,
    taskId: ctx.taskId,
    repoId: ctx.repoId,
    agentId: role,
    step,
    title: ctx.title,
    model: member?.model ?? deps.models?.[role],
  });
  tracker?.start();
  try {
    for await (const ev of deps.runtimes[role].run(input)) {
      deps.store.appendRunLog(ctx.taskId, step, { n: ctx.stepIndex, ts: Date.now(), ...ev });
      tracker?.feed(ev);
      if (ev.kind === "output") outputs.push(ev.text);
      if (ev.kind === "progress") deps.activity?.progress(ctx.taskId, role, ev.text);
      if (ev.kind === "usage") {
        deps.logger?.info("step usage", {
          taskId: ctx.taskId,
          step,
          ...(ev.credits === undefined ? {} : { credits: ev.credits }),
          ...(ev.tokens === undefined ? {} : { tokens: ev.tokens }),
        });
      }
    }
  } finally {
    tracker?.finish();
  }
  return outputs.join("\n");
}

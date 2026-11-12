import path from "node:path";
import type { ActivityEmitter } from "../activity.ts";
import type { LimitsConfig, RepoConfig } from "../config.ts";
import type { StepContext } from "../jobs/steps.ts";
import type { Logger } from "../log.ts";
import type { MemoryStore } from "../memory/store.ts";
import type { DataPaths } from "../paths.ts";
import type { ProjectRegistry, ResolvedProject } from "../projects/registry.ts";
import type { AgentRuntime, Role } from "../runtimes/types.ts";
import type { Store } from "../store.ts";
import type { TeamResolver } from "../team/service.ts";
import { assertInternStep } from "../team/intern.ts";
import { createStepTracker } from "../work.ts";
import type { JobNotes } from "./notes.ts";

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
  /** Runs the steps of the local intern (Ollama, with the fallback model). Without it a team member that is the intern cannot work. */
  intern?: AgentRuntime;
  /** What the report must mention about the job, e.g. that the intern fell back to another model. */
  notes?: JobNotes;
  /** The Library of each project. Its notes go into the prompts of the three roles. Without it every prompt says "(none)". */
  memory?: MemoryStore;
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
  // The local intern has no tools: it may only do the small read-only steps. Refused before anything runs.
  let runtime = deps.runtimes[role];
  if (member?.runtime === "ollama") {
    assertInternStep(step);
    if (!deps.intern) throw new Error("The Night intern is not available in this engine.");
    runtime = deps.intern;
  }
  const input = {
    role,
    step,
    prompt,
    cwd,
    timeoutMs: ctx.timeoutMs,
    signal: ctx.signal,
    rawLogPath: path.join(deps.paths.runs, ctx.taskId, `${step}.raw.jsonl`),
    ...(member ? { agent: member.agent, ...(member.model ? { model: member.model } : {}), ...(member.system ? { system: member.system } : {}) } : {}),
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
    for await (const ev of runtime.run(input)) {
      deps.store.appendRunLog(ctx.taskId, step, { n: ctx.stepIndex, ts: Date.now(), ...ev });
      tracker?.feed(ev);
      if (ev.kind === "output") outputs.push(ev.text);
      if (ev.kind === "progress") deps.activity?.progress(ctx.taskId, role, ev.text);
      if (ev.kind === "fallback") {
        const who = member?.displayName ?? "The intern";
        deps.activity?.progress(ctx.taskId, role, `${ev.to} does the ${step} step: ${ev.reason}`);
        deps.notes?.add(ctx.taskId, `${who} runs on ${ev.from}. ${ev.reason} The ${step} step ran on ${ev.to} instead, which spends credits.`);
      }
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

import { RunExportSchema, projectRoomId, type EngineJobView, type RunExport } from "@agentlife/shared";
import { NotFoundError } from "../errors.ts";
import { branchName } from "../steps/develop.ts";
import type { Store } from "../store.ts";
import { sendJson, type Route } from "./server.ts";

/** Sums the `usage` lines the runtime steps logged for each step record (keyed by step name and ordinal `n`). */
function withUsage(store: Store, job: EngineJobView): EngineJobView {
  const logs = new Map<string, Record<string, unknown>[]>();
  const steps = job.steps.map((rec, i) => {
    let lines = logs.get(rec.step);
    if (!lines) {
      lines = store.readRunLog(job.taskId, rec.step);
      logs.set(rec.step, lines);
    }
    let credits: number | undefined;
    let tokens: number | undefined;
    for (const l of lines) {
      if (l["kind"] !== "usage" || l["n"] !== i) continue;
      if (typeof l["credits"] === "number") credits = (credits ?? 0) + l["credits"];
      if (typeof l["tokens"] === "number") tokens = (tokens ?? 0) + l["tokens"];
    }
    return { ...rec, ...(credits === undefined ? {} : { credits }), ...(tokens === undefined ? {} : { tokens: Math.round(tokens) }) };
  });
  return { ...job, steps };
}

/** The branch exists once the Developer step has started (the worktree is created at its start). */
function withBranch(job: EngineJobView): EngineJobView {
  return job.steps.some((s) => s.step === "develop") ? { ...job, branch: branchName(job.taskId) } : job;
}

export interface ExportOptions {
  /** True for ids of projects the user registered (the ones whose jobs can be delivered as a branch). */
  isRegisteredProject?: (repoId: string) => boolean;
}

/** `deliverable`: a registered project, a finished job whose Developer step completed, not delivered yet. */
function withDeliverable(job: EngineJobView, opts: ExportOptions): EngineJobView {
  const finished = job.state === "report_ready" || job.state === "delivered";
  const developed = job.steps.some((s) => s.step === "develop" && s.status === "ok");
  const registered = opts.isRegisteredProject?.(job.repoId) ?? false;
  return registered && finished && developed && !job.delivery ? { ...job, deliverable: true } : job;
}

/** One JSON document with the job (steps include duration, status and usage), its events and artifact contents. */
export function buildExport(store: Store, taskId: string, now: () => number = Date.now, opts: ExportOptions = {}): RunExport {
  const job = store.getJob(taskId);
  if (!job) throw new NotFoundError("unknown task");
  return {
    version: 1,
    recordedAt: now(),
    roomId: projectRoomId(job.repoId),
    job: withDeliverable(withBranch(withUsage(store, job)), opts),
    events: store.eventsFor(taskId),
    artifacts: store.artifactsFor(taskId).map((a) => ({ id: a.id, kind: a.kind, content: a.content })),
  };
}

export function createExportRoute(store: Store, opts: ExportOptions = {}): Route {
  return {
    method: "GET",
    pattern: /^\/tasks\/([^/]+)\/export$/,
    handle: ({ res, params }) => {
      let id: string;
      try {
        id = decodeURIComponent(params[0] ?? "");
      } catch {
        throw new NotFoundError("bad id");
      }
      sendJson(res, 200, RunExportSchema, buildExport(store, id, Date.now, opts));
    },
  };
}

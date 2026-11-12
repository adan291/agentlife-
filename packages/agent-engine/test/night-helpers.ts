import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { NightJobInputSchema, type DeliveryInfo, type EngineJobView, type JobState, type NightConfig, type NightJob, type NightJobInput } from "@agentlife/shared";
import { ConflictError } from "../src/errors.ts";
import type { StartOptions } from "../src/jobs/runner.ts";
import { NightScheduler, type NightPort } from "../src/night/scheduler.ts";
import { NightStore } from "../src/night/store.ts";

export const CONFIG: NightConfig = { start: "01:00", end: "07:00", maxJobsPerNight: 4, maxJobMinutes: 20 };

/** A local time of the test day (2026-11-12) plus `day` days. The window code uses local time, so the tests do too. */
export function at(h: number, m = 0, day = 0): number {
  return new Date(2026, 10, 12 + day, h, m).getTime();
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

export function tmpDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "al-night-"));
  dirs.push(d);
  return d;
}

export function view(taskId: string, repoId: string, state: JobState, extra: Partial<EngineJobView> = {}): EngineJobView {
  return { taskId, repoId, goal: "g", state, steps: [], approvals: [], artifacts: [], ...extra };
}

/** An engine that only remembers what the scheduler asked of it; tests move its jobs from state to state by hand. */
export class FakePort implements NightPort {
  projects = new Set(["demo", "other"]);
  views = new Map<string, EngineJobView>();
  started: { taskId: string; repoId: string; goal: string; opts: StartOptions }[] = [];
  cancelled: string[] = [];
  delivered: string[] = [];
  /** Projects that already have a job (a daytime job or another night job). */
  busyProjects = new Set<string>();
  deliverError: Error | undefined;
  cancelError: Error | undefined;
  private n = 0;

  hasProject(id: string): boolean {
    return this.projects.has(id);
  }
  start(repoId: string, goal: string, opts: StartOptions): string {
    if (this.busyProjects.has(repoId)) throw new ConflictError("busy", "this project already has a job");
    const taskId = `task-${++this.n}`;
    this.started.push({ taskId, repoId, goal, opts });
    this.views.set(taskId, view(taskId, repoId, "analyzing"));
    return taskId;
  }
  async cancel(taskId: string): Promise<void> {
    if (this.cancelError) throw this.cancelError;
    this.cancelled.push(taskId);
  }
  job(taskId: string): EngineJobView | undefined {
    return this.views.get(taskId);
  }
  openJobs(): EngineJobView[] {
    return [...this.views.values()].filter((v) => v.state !== "delivered" && v.state !== "cancelled");
  }
  async deliver(taskId: string): Promise<DeliveryInfo> {
    if (this.deliverError) throw this.deliverError;
    this.delivered.push(taskId);
    return { branch: `agentlife/${taskId}`, commit: "abc1234" };
  }

  set(taskId: string, state: JobState, extra: Partial<EngineJobView> = {}): void {
    const v = this.views.get(taskId);
    if (!v) throw new Error(`no job ${taskId}`);
    this.views.set(taskId, { ...v, state, ...extra });
  }
  /** A job nobody scheduled for the night: the user's own. */
  daytime(taskId: string, repoId: string, state: JobState = "developing"): void {
    this.views.set(taskId, view(taskId, repoId, state));
  }
}

export interface NightRig {
  dir: string;
  file: string;
  now: number;
  clock: () => number;
  store: NightStore;
  port: FakePort;
  scheduler: NightScheduler;
}

export function rig(config: NightConfig = CONFIG, start = at(0, 30)): NightRig {
  const dir = tmpDir();
  const file = path.join(dir, "night.json");
  const r: NightRig = {
    dir,
    file,
    now: start,
    clock: () => r.now,
    store: undefined as unknown as NightStore,
    port: new FakePort(),
    scheduler: undefined as unknown as NightScheduler,
  };
  r.store = new NightStore({ file, now: r.clock });
  r.scheduler = new NightScheduler({ store: r.store, port: r.port, config, now: r.clock });
  return r;
}

/** Adds a job through the same schema the route uses. */
export function schedule(store: NightStore, input: Partial<NightJobInput> & { repoId?: string } = {}): NightJob {
  return store.add(NightJobInputSchema.parse({ repoId: "demo", kind: "audit-deps", ...input }));
}

export function byStatus(store: NightStore, status: NightJob["status"]): NightJob[] {
  return store.jobs().filter((j) => j.status === status);
}

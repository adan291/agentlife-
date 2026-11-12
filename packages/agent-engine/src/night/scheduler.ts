import { kindWritesFiles, type DeliveryInfo, type EngineJobView, type NightConfig, type NightJob, type NightRecord } from "@agentlife/shared";
import { ConflictError } from "../errors.ts";
import type { StartOptions } from "../jobs/runner.ts";
import { noopLogger, type Logger } from "../log.ts";
import { preApprovalFor } from "./scope.ts";
import type { NightStore } from "./store.ts";
import { windowAt } from "./window.ts";

/** What the scheduler needs from the engine. The engine wires the runner, the store and the registry into it. */
export interface NightPort {
  hasProject(repoId: string): boolean;
  /** Starts a job; throws `ConflictError` (`busy`, `invalid_target`, `unsupported_kind`, ...) when it cannot. */
  start(repoId: string, goal: string, opts: StartOptions): string;
  cancel(taskId: string): Promise<void>;
  job(taskId: string): EngineJobView | undefined;
  /** Jobs that are not finished. */
  openJobs(): EngineJobView[];
  deliver(taskId: string): Promise<DeliveryInfo>;
}

export interface NightSchedulerOptions {
  store: NightStore;
  port: NightPort;
  config: NightConfig;
  /** Epoch ms. Tests pass a fake clock. */
  now?: () => number;
  logger?: Logger;
  /**
   * Called once when a night closes, with the night and every job in the schedule (the morning summary, requirement 4.1).
   * A failure is logged; it never keeps the night open.
   */
  onClose?: (night: NightRecord, jobs: readonly NightJob[]) => unknown;
}

/** The reason of a job stopped by the time limit starts with this text; `settle` reads it back. */
const TIMEOUT_PREFIX = "Stopped after ";

/** The line the runner adds to the approval summary when a pre-approval did not cover the plan. */
const NOT_APPROVED = /Night shift: not approved automatically \((.+)\)\./;

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Starts the night jobs (requirement 3.1). Call `tick()` now and then; it decides from the clock and the schedule what to
 * do and never blocks on a job:
 * - inside the window, with no other job running, it starts the next scheduled job, up to `maxJobsPerNight`;
 * - a daytime job that is running keeps it from starting anything (requirement 3.2);
 * - a running job is watched: it ends as done or failed, stops as `waiting` at a plan approval it may not give itself,
 *   or is cancelled after `maxJobMinutes`;
 * - when the window ends nothing new starts, the jobs left are skipped with a reason, and the night closes once the job
 *   that was running has ended.
 */
export class NightScheduler {
  private readonly store: NightStore;
  private readonly port: NightPort;
  private readonly config: NightConfig;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly onClose: NonNullable<NightSchedulerOptions["onClose"]> | undefined;
  private ticking = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(opts: NightSchedulerOptions) {
    this.store = opts.store;
    this.port = opts.port;
    this.config = opts.config;
    this.now = opts.now ?? Date.now;
    this.log = opts.logger ?? noopLogger;
    this.onClose = opts.onClose;
  }

  /** Ticks now and then until `stop()`. The timer does not keep the process alive. */
  start(intervalMs = 10_000): void {
    if (this.timer) return;
    const run = (): void => void this.tick().catch((e: unknown) => this.log.error("night tick failed", { error: messageOf(e) }));
    this.timer = setInterval(run, intervalMs);
    this.timer.unref();
    run();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass. Passes never overlap: a call made during a pass returns at once. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.pass();
    } finally {
      this.ticking = false;
    }
  }

  private runningJob(): NightJob | undefined {
    return this.store.jobs().find((j) => j.status === "running");
  }

  private async pass(): Promise<void> {
    const now = this.now();
    const win = windowAt(now, this.config);

    const running = this.runningJob();
    if (running) await this.settle(running, now);
    const busy = this.runningJob() !== undefined;

    const recorded = this.store.night();
    const open = recorded && recorded.closedAt === undefined ? recorded : undefined;

    if (!win) {
      // The window is over: nothing new starts, and the night closes when its last job has ended.
      if (open) {
        this.skipScheduled(open, now);
        if (!busy) this.close(open, now);
      }
      return;
    }

    if (open && open.key !== win.key) {
      // The engine was off when that window ended, so it never closed. Its jobs keep their results.
      if (busy) return;
      this.close(open, now);
    }
    let night = open && open.key === win.key ? open : undefined;
    if (!night) {
      if (this.store.scheduled().length === 0) return;
      night = { key: win.key, openedAt: now, windowEnd: win.end };
      this.store.setNight(night);
    }
    if (busy) return;

    if (this.startedIn(night) >= this.config.maxJobsPerNight) return;
    if (this.daytimeJobRunning()) {
      if (!night.daytimeBlocked) this.store.setNight({ ...night, daytimeBlocked: true });
      return;
    }
    this.startNext(night, now);
  }

  private startedIn(night: NightRecord): number {
    return this.store.jobs().filter((j) => j.nightKey === night.key && j.startedAt !== undefined).length;
  }

  /** A job that is not one of ours and is working (a plan waiting for its approval does not use the hotel). */
  private daytimeJobRunning(): boolean {
    const ours = new Set(this.store.jobs().flatMap((j) => (j.taskId ? [j.taskId] : [])));
    return this.port.openJobs().some((j) => !ours.has(j.taskId) && j.state !== "awaiting_plan_approval");
  }

  private startNext(night: NightRecord, now: number): void {
    for (const job of this.store.scheduled()) {
      if (!this.port.hasProject(job.repoId)) {
        this.skip(job, night.key, now, "The project is no longer registered.");
        continue;
      }
      const preApproval = preApprovalFor(job);
      try {
        const taskId = this.port.start(job.repoId, job.goal, {
          kind: job.kind,
          ...(job.target ? { target: job.target } : {}),
          ...(preApproval ? { preApproval } : {}),
        });
        this.store.update(job.id, { status: "running", taskId, startedAt: now, nightKey: night.key });
        this.log.info("night job started", { id: job.id, taskId, kind: job.kind });
        return;
      } catch (e) {
        const reason = e instanceof ConflictError && e.code === "busy" ? "The project already had a job running." : `It could not start: ${messageOf(e)}`;
        this.skip(job, night.key, now, reason.slice(0, 500));
      }
    }
  }

  private skip(job: NightJob, nightKey: string, now: number, reason: string): void {
    this.store.update(job.id, { status: "skipped", nightKey, endedAt: now, reason });
  }

  /** Window over: the jobs that never started are skipped, each with the reason it did not run. */
  private skipScheduled(night: NightRecord, now: number): void {
    const limit = this.startedIn(night) >= this.config.maxJobsPerNight;
    const reason = limit
      ? `The night limit of ${this.config.maxJobsPerNight} jobs was reached.`
      : night.daytimeBlocked
        ? "A daytime job kept the hotel busy."
        : "The night window ended before it could start.";
    // Jobs added after the window ended are for the next night.
    for (const job of this.store.scheduled()) {
      if (job.addedAt <= night.windowEnd) this.skip(job, night.key, now, reason);
    }
  }

  private close(night: NightRecord, now: number): void {
    const closed = { ...night, closedAt: now };
    this.store.setNight(closed);
    this.log.info("night closed", { key: night.key });
    if (!this.onClose) return;
    // The summary is written outside the pass: a slow Discord call must not delay the next tick.
    try {
      const result = this.onClose(closed, [...this.store.jobs()]);
      if (result instanceof Promise) result.catch((e: unknown) => this.log.error("morning summary failed", { error: messageOf(e) }));
    } catch (e) {
      this.log.error("morning summary failed", { error: messageOf(e) });
    }
  }

  private finish(job: NightJob, now: number, patch: Partial<NightJob>): void {
    this.store.update(job.id, { endedAt: now, ...patch });
  }

  /** Looks at the running job: records how it ended, stops at an approval, or enforces the time limit. */
  private async settle(job: NightJob, now: number): Promise<void> {
    const view = job.taskId ? this.port.job(job.taskId) : undefined;
    if (!view) {
      this.finish(job, now, { status: "failed", reason: "The job is not in the engine's log any more." });
      return;
    }

    if (view.state === "awaiting_plan_approval") {
      const pending = view.approvals.findLast((a) => a.status === "pending");
      if (pending) {
        // The job stays in the mailbox for the user; the night moves on.
        this.finish(job, now, { status: "waiting", reason: waitingReason(job, pending.summary) });
      }
      return;
    }

    if (view.state === "cancelled") {
      const timedOut = job.reason?.startsWith(TIMEOUT_PREFIX) === true;
      this.finish(job, now, timedOut ? { status: "timed_out" } : { status: "cancelled", reason: "The job was cancelled before it finished." });
      return;
    }

    if (view.state === "delivered") {
      await this.complete(job, view, now);
      return;
    }

    const limitMs = this.config.maxJobMinutes * 60_000;
    if (job.startedAt !== undefined && now - job.startedAt > limitMs) {
      if (!job.reason) this.store.update(job.id, { reason: `${TIMEOUT_PREFIX}${this.config.maxJobMinutes} minutes.` });
      try {
        await this.port.cancel(view.taskId);
      } catch (e) {
        // Not cancellable right now (it is writing its report); the next pass looks again.
        this.log.debug("night job could not be cancelled", { id: job.id, error: messageOf(e) });
      }
    }
  }

  private async complete(job: NightJob, view: EngineJobView, now: number): Promise<void> {
    const verdict = view.verdict;
    if (verdict !== "pass") {
      this.finish(job, now, { status: "failed", ...(verdict ? { verdict } : {}), reason: job.reason ?? "The job ended with a failing verdict. Its report says why." });
      return;
    }
    const patch: Partial<NightJob> = { status: "done", verdict: "pass" };
    // Requirement 2.3: a branch only when the user asked for it when scheduling. Never a push or a merge.
    if (job.deliver && kindWritesFiles(job.kind) && job.taskId) {
      try {
        const info = await this.port.deliver(job.taskId);
        patch.branch = info.branch;
        patch.commit = info.commit;
      } catch (e) {
        patch.reason = `Not delivered: ${messageOf(e)}`.slice(0, 500);
      }
    }
    this.finish(job, now, patch);
  }
}

/** Why a night job stopped at the approval: the line the runner wrote, else what the schedule says. */
export function waitingReason(job: Pick<NightJob, "preApprove">, summary: string): string {
  if (!job.preApprove) return "No pre-approval was given, so the plan waits for you.";
  const m = NOT_APPROVED.exec(summary);
  return m?.[1] ? `The plan is outside the pre-approved scope: ${m[1]}`.slice(0, 500) : "The plan needs your approval.";
}

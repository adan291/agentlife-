import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NIGHT_MAX_JOBS, NightFileSchema, nightGoal, type NightFile, type NightJob, type NightJobInputSchema, type NightRecord } from "@agentlife/shared";
import type { z } from "zod";
import { ConflictError, NotFoundError } from "../errors.ts";
import { noopLogger, type Logger } from "../log.ts";

/** A job that is over: it no longer needs the engine and can make room for a new one. */
const FINISHED = new Set<NightJob["status"]>(["done", "failed", "timed_out", "cancelled", "skipped"]);

export interface NightStoreOptions {
  /** `data/night.json`. */
  file: string;
  now?: () => number;
  newId?: () => string;
  logger?: Logger;
}

/**
 * The night schedule in `data/night.json` (requirement 1.2). The file is read once and rewritten after every change
 * (a temporary file, then a rename), so a restart finds the same schedule. A file that cannot be read is moved aside
 * as `night.json.bad-<time>` and the schedule starts empty: the user's data is never overwritten silently.
 */
export class NightStore {
  private readonly file: string;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly log: Logger;
  private jobList: NightJob[] = [];
  private record: NightRecord | undefined;

  constructor(opts: NightStoreOptions) {
    this.file = opts.file;
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? (() => `night-${randomUUID().slice(0, 8)}`);
    this.log = opts.logger ?? noopLogger;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = NightFileSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
      this.jobList = parsed.jobs;
      this.record = parsed.night;
    } catch (e) {
      const aside = `${this.file}.bad-${this.now()}`;
      this.log.error("night schedule unreadable, moved aside", { file: aside, error: e instanceof Error ? e.message : String(e) });
      try {
        renameSync(this.file, aside);
      } catch {
        // If even that fails the next save overwrites it; nothing better can be done here.
      }
    }
  }

  private save(): void {
    const file: NightFile = { version: 1, jobs: this.jobList, ...(this.record ? { night: this.record } : {}) };
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    renameSync(tmp, this.file);
  }

  jobs(): readonly NightJob[] {
    return this.jobList;
  }

  get(id: string): NightJob | undefined {
    return this.jobList.find((j) => j.id === id);
  }

  night(): NightRecord | undefined {
    return this.record;
  }

  /** The jobs that wait for a night, in the order they will run. */
  scheduled(): NightJob[] {
    return this.jobList.filter((j) => j.status === "scheduled");
  }

  /** Adds a job at the end of the schedule. Finished jobs make room when the schedule is full. */
  add(input: z.output<typeof NightJobInputSchema>): NightJob {
    if (this.jobList.length >= NIGHT_MAX_JOBS) {
      const oldest = this.jobList.findIndex((j) => FINISHED.has(j.status));
      if (oldest < 0) throw new ConflictError("night_full", `The night schedule holds ${NIGHT_MAX_JOBS} jobs. Remove one first.`);
      this.jobList.splice(oldest, 1);
    }
    const job: NightJob = {
      id: this.newId(),
      repoId: input.repoId,
      kind: input.kind,
      ...(input.target ? { target: input.target } : {}),
      goal: nightGoal(input.kind, input.target, input.goal),
      tier: input.tier,
      preApprove: input.preApprove,
      ...(input.scopePaths && input.scopePaths.length > 0 ? { scopePaths: input.scopePaths } : {}),
      deliver: input.deliver,
      status: "scheduled",
      addedAt: this.now(),
    };
    this.jobList.push(job);
    this.save();
    return job;
  }

  /** Removes a job. A running job cannot be removed: cancel its job first. */
  remove(id: string): void {
    const i = this.jobList.findIndex((j) => j.id === id);
    if (i < 0) throw new NotFoundError("unknown night job");
    if (this.jobList[i]!.status === "running") {
      throw new ConflictError("night_job_running", "This job is running. Cancel it from its floor first.");
    }
    this.jobList.splice(i, 1);
    this.save();
  }

  /** Swaps a scheduled job with the scheduled job before or after it. At the end of the line nothing changes. */
  move(id: string, direction: "up" | "down"): void {
    const job = this.get(id);
    if (!job) throw new NotFoundError("unknown night job");
    if (job.status !== "scheduled") throw new ConflictError("night_job_not_scheduled", "Only jobs that are waiting for a night can be moved.");
    const from = this.jobList.indexOf(job);
    let to = from + (direction === "up" ? -1 : 1);
    while (to >= 0 && to < this.jobList.length && this.jobList[to]!.status !== "scheduled") to += direction === "up" ? -1 : 1;
    if (to < 0 || to >= this.jobList.length) return;
    [this.jobList[from], this.jobList[to]] = [this.jobList[to]!, this.jobList[from]!];
    this.save();
  }

  /** Changes fields of a job (the scheduler records what happened). */
  update(id: string, patch: Partial<NightJob>): NightJob {
    const i = this.jobList.findIndex((j) => j.id === id);
    if (i < 0) throw new NotFoundError("unknown night job");
    const next = { ...this.jobList[i]!, ...patch, id };
    this.jobList[i] = next;
    this.save();
    return next;
  }

  setNight(record: NightRecord | undefined): void {
    this.record = record;
    this.save();
  }
}

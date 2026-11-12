import { z } from "zod";
import { JOB_TARGET_MAX_CHARS, JobKindSchema, isSafeModulePath, kindWritesFiles, targetProblem, type JobKind } from "./job-kinds.ts";
import { GOAL_MAX_CHARS } from "./limits.ts";

/**
 * Night shift (night-shift spec): jobs the user schedules for the night. The engine runs them inside a time window,
 * one at a time, and keeps this schedule in `data/night.json`.
 */

/** Cheaper or normal model for the job. */
export const NightTierSchema = z.enum(["cheap", "normal"]);
export type NightTier = z.infer<typeof NightTierSchema>;

/** Most jobs the schedule holds (waiting and finished together). */
export const NIGHT_MAX_JOBS = 50;
/** Most path entries of a pre-approval scope. */
export const NIGHT_SCOPE_MAX_PATHS = 10;

/** `scheduled` waits for a night. `waiting` stopped at the plan approval and needs the user. */
export const NightStatusSchema = z.enum(["scheduled", "running", "done", "failed", "waiting", "timed_out", "cancelled", "skipped"]);
export type NightStatus = z.infer<typeof NightStatusSchema>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HhmmSchema = z.string().regex(HHMM, "use HH:MM, 24 hours");

/** The night window, in the local time of the machine that runs the engine. It may cross midnight (`22:00` to `06:00`). */
export const NightConfigSchema = z
  .object({
    start: HhmmSchema,
    end: HhmmSchema,
    maxJobsPerNight: z.number().int().min(1).max(20),
    maxJobMinutes: z.number().int().min(1).max(240),
  })
  .refine((c) => c.start !== c.end, { message: "start and end must differ", path: ["end"] });
export type NightConfig = z.infer<typeof NightConfigSchema>;

export const DEFAULT_NIGHT_CONFIG: NightConfig = { start: "01:00", end: "07:00", maxJobsPerNight: 4, maxJobMinutes: 20 };

/**
 * A path or folder the user pre-approves for a `change` job: relative, forward slashes, no `..`.
 * A trailing `/` means the whole folder (`src/`); without it the entry is one file (`README.md`).
 */
export function isSafeScopePath(entry: string): boolean {
  if (entry.length === 0 || entry.length > JOB_TARGET_MAX_CHARS) return false;
  return isSafeModulePath(entry.endsWith("/") ? entry.slice(0, -1) : entry);
}

/** What the user chooses when scheduling a night job. */
export const NightJobInputSchema = z
  .object({
    repoId: z.string().min(1).max(100),
    kind: JobKindSchema,
    /** Same meaning as in a daytime job. */
    target: z.string().max(JOB_TARGET_MAX_CHARS).optional(),
    /** The goal text. Required for a `change`; the other kinds get one from the kind and target when it is left out. */
    goal: z.string().trim().min(1).max(GOAL_MAX_CHARS).optional(),
    tier: NightTierSchema.default("normal"),
    /**
     * Approve the plan automatically when it only touches the kind's allowed paths (`write-tests`, `document`) or the
     * paths of `scopePaths` (`change`). Without it the job stops at the approval and waits for the user.
     */
    preApprove: z.boolean().default(false),
    /** `change` only: the files and folders the plan may touch to be approved automatically. */
    scopePaths: z.array(z.string()).max(NIGHT_SCOPE_MAX_PATHS).optional(),
    /** Deliver the result as a branch when the job passes. Never pushes or merges. */
    deliver: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    const issue = (path: string, message: string): void => void ctx.addIssue({ code: "custom", path: [path], message });
    const problem = targetProblem(input.kind, input.target);
    if (problem) issue("target", problem);
    if (input.kind === "change" && !input.goal) issue("goal", "describe the change");
    const writes = kindWritesFiles(input.kind);
    if (input.preApprove && !writes) issue("preApprove", "this kind has no approval step");
    if (input.deliver && !writes) issue("deliver", "this kind changes nothing, so there is nothing to deliver");
    const scope = input.scopePaths;
    if (input.kind === "change" && input.preApprove) {
      if (!scope || scope.length === 0) issue("scopePaths", "name the files or folders the plan may touch");
    } else if (scope && scope.length > 0) {
      issue("scopePaths", input.kind === "change" ? "turn on the pre-approval to use a scope" : "the scope of this kind is fixed");
    }
    if (scope && scope.some((p) => !isSafeScopePath(p))) issue("scopePaths", "use relative paths like src/ or README.md");
  });
export type NightJobInput = z.input<typeof NightJobInputSchema>;

/** The goal of a night job: the one the user wrote, else a sentence built from the kind and target. */
export function nightGoal(kind: JobKind, target: string | undefined, goal: string | undefined): string {
  if (goal) return goal;
  switch (kind) {
    case "review-branch":
      return `Review branch ${target ?? ""}`.trim();
    case "write-tests":
      return `Write tests for ${target ?? ""}`.trim();
    case "document":
      return `Document ${target ?? ""}`.trim();
    case "audit-deps":
      return "Audit dependencies";
    case "change":
      return "Change";
  }
}

export const NightJobSchema = z.object({
  id: z.string().min(1).max(40),
  repoId: z.string().min(1).max(100),
  kind: JobKindSchema,
  target: z.string().max(JOB_TARGET_MAX_CHARS).optional(),
  goal: z.string().min(1).max(GOAL_MAX_CHARS),
  tier: NightTierSchema,
  preApprove: z.boolean(),
  scopePaths: z.array(z.string()).max(NIGHT_SCOPE_MAX_PATHS).optional(),
  deliver: z.boolean(),
  status: NightStatusSchema,
  addedAt: z.number().int().nonnegative(),
  /** The night (`YYYY-MM-DD` of the window start) in which it ran or was skipped. */
  nightKey: z.string().min(1).max(20).optional(),
  taskId: z.string().min(1).max(100).optional(),
  startedAt: z.number().int().nonnegative().optional(),
  endedAt: z.number().int().nonnegative().optional(),
  /** Why the job is waiting, failed or was skipped. */
  reason: z.string().max(500).optional(),
  verdict: z.enum(["pass", "fail"]).optional(),
  /** Set when the job was delivered as a branch. */
  branch: z.string().min(1).max(200).optional(),
  commit: z.string().min(1).max(100).optional(),
});
export type NightJob = z.infer<typeof NightJobSchema>;

/** The night that is open or the last one that closed. */
export const NightRecordSchema = z.object({
  key: z.string().min(1).max(20),
  openedAt: z.number().int().nonnegative(),
  windowEnd: z.number().int().nonnegative(),
  closedAt: z.number().int().nonnegative().optional(),
  /** A daytime job kept the hotel busy at some point of the window. */
  daytimeBlocked: z.boolean().optional(),
});
export type NightRecord = z.infer<typeof NightRecordSchema>;

/** The content of `data/night.json`. */
export const NightFileSchema = z.object({
  version: z.literal(1),
  jobs: z.array(NightJobSchema).max(NIGHT_MAX_JOBS),
  night: NightRecordSchema.optional(),
});
export type NightFile = z.infer<typeof NightFileSchema>;

/** `GET /night`. */
export const NightStateSchema = z.object({
  config: NightConfigSchema,
  /** The window is open right now. */
  open: z.boolean(),
  night: NightRecordSchema.optional(),
  jobs: z.array(NightJobSchema),
});
export type NightState = z.infer<typeof NightStateSchema>;

export const NightMoveBodySchema = z.object({ direction: z.enum(["up", "down"]) });
export type NightMoveBody = z.infer<typeof NightMoveBodySchema>;

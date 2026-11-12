import { z } from "zod";
import { VerdictSchema } from "./engine-api.ts";
import { JobStateSchema } from "./events.ts";
import { FloorStatusKindSchema } from "./floors.ts";
import { JOB_TARGET_MAX_CHARS, JobKindSchema } from "./job-kinds.ts";
import { PROJECT_ROLES } from "./room.ts";

/** Longest timeline an overview carries per job (a job has about ten entries; retries add a few). */
export const OVERVIEW_TIMELINE_MAX = 100;

/** One state entry of a job: when it was entered. The text of a timeline entry stays on its floor. */
export const OverviewTimelineEntrySchema = z.object({ ts: z.number().int().nonnegative(), state: JobStateSchema });
export type OverviewTimelineEntry = z.infer<typeof OverviewTimelineEntrySchema>;

/**
 * What the list view and the command palette know about one project floor without standing on it (list-mode, D13).
 * Only ids, names, states, counts, verdicts and times: no paths, no plan or report text, no diffs, no activity lines.
 * The client derives the steps of a job from `timeline` with the same function the stepper uses.
 */
export const OverviewFloorSchema = z.object({
  roomId: z.string().min(1).max(100),
  projectId: z.string().min(1).max(100),
  name: z.string().min(1).max(60),
  /** The floor status of the elevator panel (a finished job with an unread report shows `report_ready` or `failed`). */
  status: FloorStatusKindSchema,
  /** Who is working, for `working`. */
  who: z.enum(PROJECT_ROLES).optional(),
  queuePosition: z.number().int().positive().optional(),
  /** The current or last job of the floor. Absent: nothing has run since the world-server started. */
  job: z
    .object({
      taskId: z.string().min(1).max(100),
      /** Absent means `change`. */
      kind: JobKindSchema.optional(),
      target: z.string().max(JOB_TARGET_MAX_CHARS).optional(),
      state: JobStateSchema,
      /** Epoch ms of the first state entry. */
      startedAt: z.number().int().nonnegative(),
      timeline: z.array(OverviewTimelineEntrySchema).max(OVERVIEW_TIMELINE_MAX),
    })
    .optional(),
  /** Approvals of this floor that wait for the user. */
  waiting: z.number().int().nonnegative().max(1000),
  /** The newest report in the floor's mailbox. */
  lastReport: z
    .object({
      reportId: z.string().min(1).max(100),
      taskId: z.string().min(1).max(100),
      verdict: VerdictSchema.optional(),
      /** Epoch ms the report was delivered. */
      at: z.number().int().nonnegative().optional(),
      /** `available`: the job's branch can be delivered; `done`: it was. Absent: not a job on a registered project. */
      delivery: z.enum(["available", "done"]).optional(),
    })
    .optional(),
});
export type OverviewFloor = z.infer<typeof OverviewFloorSchema>;

/** Panels a client may ask to see without walking to their furniture (list view and command palette). */
export const ShowablePanelSchema = z.enum(["computer", "mailbox", "board", "review", "tests", "library", "night"]);
export type ShowablePanel = z.infer<typeof ShowablePanelSchema>;

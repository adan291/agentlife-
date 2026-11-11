import { z } from "zod";
import type { JobState } from "./events.ts";
import { PROJECT_ROLES } from "./room.ts";
import type { ProjectRole } from "./room.ts";

/** What a floor shows in the elevator panel and on the lobby directory (hotel-floors, requirement 2). */
export const FloorStatusKindSchema = z.enum(["idle", "working", "waiting_approval", "report_ready", "failed", "queued"]);
export type FloorStatusKind = z.infer<typeof FloorStatusKindSchema>;

export const FloorKindSchema = z.enum(["lobby", "hr", "project"]);
export type FloorKind = z.infer<typeof FloorKindSchema>;

export const FloorStatusSchema = z.object({
  roomId: z.string().min(1).max(100),
  name: z.string().min(1).max(60),
  kind: FloorKindSchema,
  status: FloorStatusKindSchema,
  /** Who is working, for `working`. */
  who: z.enum(PROJECT_ROLES).optional(),
  /** Place in the queue (1 is next), for `queued`. */
  queuePosition: z.number().int().positive().optional(),
});
export type FloorStatus = z.infer<typeof FloorStatusSchema>;

/** A floor that needs the user: it waits for an approval or has a report that was not opened yet. */
export function needsAttention(status: FloorStatusKind): boolean {
  return status === "waiting_approval" || status === "report_ready" || status === "failed";
}

/**
 * Status of a floor from the state of its latest job. A finished job shows `idle`: whether its report was read is
 * known only to the world-server, which overlays `report_ready` and `failed` until the mailbox is opened.
 */
export function statusOfJobState(
  state: JobState,
  queuePosition?: number,
): { status: FloorStatusKind; who?: ProjectRole; queuePosition?: number } {
  switch (state) {
    case "created":
      return queuePosition === undefined ? { status: "working", who: "architect" } : { status: "queued", queuePosition };
    case "analyzing":
      return { status: "working", who: "architect" };
    case "awaiting_plan_approval":
      return { status: "waiting_approval" };
    case "developing":
      return { status: "working", who: "developer" };
    case "testing":
    case "reviewing":
      return { status: "working", who: "qa" };
    case "report_ready":
      return { status: "working", who: "architect" };
    case "failed":
    case "delivered":
    case "cancelled":
      return { status: "idle" };
  }
}

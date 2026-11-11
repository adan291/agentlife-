import { z } from "zod";

/** What a build session is doing right now (derived from stream-json tool calls). */
export const ActivitySchema = z.enum(["think", "read", "edit", "run", "commit"]);
export type Activity = z.infer<typeof ActivitySchema>;

/** Progress report sent by scripts/run-session.ts to the engine (`POST /crew/events`). */
export const CrewEventSchema = z.object({
  kind: z.enum(["started", "activity", "finished", "phase"]),
  /** Session label such as "S9". */
  session: z.string().min(1).max(8),
  spec: z.string().max(40).optional(),
  model: z.string().max(40).optional(),
  activity: ActivitySchema.optional(),
  text: z.string().max(80).optional(),
  ok: z.boolean().optional(),
  /** For kind `phase`, sent by the conductor: `session S9`, `review`, `verify`, `fix 1`, `merge`, `stopped: ...`, `done`. */
  phase: z.string().max(80).optional(),
});
export type CrewEvent = z.infer<typeof CrewEventSchema>;

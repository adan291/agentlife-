import { z } from "zod";

/** Spec names are file-name parts; this is the only shape the engine accepts before building a path. */
export const SPEC_NAME_RE = /^[a-z0-9-]+$/;
export const SpecNameSchema = z.string().min(1).max(40).regex(SPEC_NAME_RE);

export const BuildRowStatusSchema = z.enum(["todo", "running", "verifying", "merged", "waits_for_you", "skipped"]);
export type BuildRowStatus = z.infer<typeof BuildRowStatusSchema>;

export const BuildRowSchema = z.object({
  number: z.number().int().nonnegative(),
  spec: SpecNameSchema,
  sessions: z.array(z.string().max(8)).max(10),
  live: z.boolean(),
  status: BuildRowStatusSchema,
  /** Why the row waits for the user. */
  reason: z.string().max(200).optional(),
  purpose: z.string().max(300),
});
export type BuildRow = z.infer<typeof BuildRowSchema>;

export const BuildTaskSchema = z.object({
  number: z.string().min(1).max(10),
  title: z.string().max(200),
  done: z.boolean(),
});

export const BuildVerdictSchema = z.enum(["PASS", "FAIL", "none"]);
export type BuildVerdict = z.infer<typeof BuildVerdictSchema>;

export const BuildSpecSchema = z.object({
  spec: SpecNameSchema,
  tasks: z.array(BuildTaskSchema).max(60),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  verdict: BuildVerdictSchema,
});
export type BuildSpec = z.infer<typeof BuildSpecSchema>;

export const BuildSessionSchema = z.object({
  session: z.string().max(8),
  date: z.string().max(20),
  model: z.string().max(40),
  minutes: z.number().nonnegative(),
  status: z.string().max(20),
});
export type BuildSession = z.infer<typeof BuildSessionSchema>;

/** What the conductor is doing now, as reported by `POST /crew/events` with kind `phase`. */
export const BuildPhaseSchema = z.object({
  text: z.string().max(80),
  spec: SpecNameSchema.optional(),
  at: z.number().int().nonnegative(),
});
export type BuildPhase = z.infer<typeof BuildPhaseSchema>;

/** `GET /build/board`: the construction board of the lobby (build-board, requirement 1). */
export const BuildBoardSchema = z.object({
  phase: BuildPhaseSchema.optional(),
  rows: z.array(BuildRowSchema).max(40),
  specs: z.array(BuildSpecSchema).max(40),
  sessions: z.array(BuildSessionSchema).max(10),
});
export type BuildBoard = z.infer<typeof BuildBoardSchema>;

/** `GET /build/verify/:spec`: the verifier's report, shown as Markdown in the board panel. */
export const BuildReportSchema = z.object({ spec: SpecNameSchema, content: z.string().max(100_000) });
export type BuildReport = z.infer<typeof BuildReportSchema>;

/** Conductor phase text: `session S9`, `review`, `verify`, `fix 1`, `merge`, `stopped: reason`, `done`. */
export function phaseGroup(text: string): "running" | "verifying" | "stopped" | "done" {
  const t = text.trim().toLowerCase();
  if (t.startsWith("stopped")) return "stopped";
  if (t === "done") return "done";
  if (t === "review" || t === "verify") return "verifying";
  return "running";
}

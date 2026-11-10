import { z } from "zod";
import { AgentEventSchema, ApprovalDecisionSchema, JobStateSchema } from "./events.ts";
import { GOAL_MAX_CHARS } from "./protocol.ts";

// The public repo view is `RepoSchema` in protocol.ts; `source` paths are never exposed.

export const StartJobBodySchema = z.object({
  repoId: z.string().min(1).max(100),
  goal: z.string().trim().min(1).max(GOAL_MAX_CHARS),
});
export type StartJobBody = z.infer<typeof StartJobBodySchema>;

export const ApprovalBodySchema = z.object({
  decision: ApprovalDecisionSchema,
  note: z.string().max(500).optional(),
});
export type ApprovalBody = z.infer<typeof ApprovalBodySchema>;

export const RiskSchema = z.enum(["low", "medium", "high"]);
export type Risk = z.infer<typeof RiskSchema>;

export const PlanTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  why: z.string(),
  files: z.array(z.string()),
  acceptance: z.string(),
  risk: RiskSchema,
});

export const PlanSchema = z.object({
  tasks: z.array(PlanTaskSchema).min(1).max(5),
});
export type Plan = z.infer<typeof PlanSchema>;

export const VerdictSchema = z.enum(["pass", "fail"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const ReviewSchema = z.object({
  verdict: VerdictSchema,
  notes: z.array(z.string()),
  risk: RiskSchema,
});
export type Review = z.infer<typeof ReviewSchema>;

export const StepNameSchema = z.enum(["analyze", "develop", "test", "review", "report"]);
export type StepName = z.infer<typeof StepNameSchema>;

export const StepRecordSchema = z.object({
  step: StepNameSchema,
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  status: z.enum(["running", "ok", "failed", "cancelled"]),
  credits: z.number().nonnegative().optional(),
  tokens: z.number().int().nonnegative().optional(),
});
export type StepRecord = z.infer<typeof StepRecordSchema>;

export const ApprovalRecordSchema = z.object({
  approvalId: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string().max(4000),
  status: z.enum(["pending", "approved", "rejected"]),
  note: z.string().max(500).optional(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const ArtifactRefSchema = z.object({
  artifactId: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1).max(200),
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

/** Engine-side job view (a fold over the job's events). Distinct from the client-facing `JobView`. */
export const EngineJobViewSchema = z.object({
  taskId: z.string().min(1),
  repoId: z.string().min(1),
  goal: z.string().max(GOAL_MAX_CHARS),
  state: JobStateSchema,
  steps: z.array(StepRecordSchema),
  approvals: z.array(ApprovalRecordSchema),
  artifacts: z.array(ArtifactRefSchema),
  verdict: VerdictSchema.optional(),
});
export type EngineJobView = z.infer<typeof EngineJobViewSchema>;

export const RunExportSchema = z.object({
  version: z.literal(1),
  recordedAt: z.number().int().nonnegative(),
  job: EngineJobViewSchema,
  events: z.array(AgentEventSchema),
  artifacts: z.array(z.object({ id: z.string().min(1), kind: z.string().min(1), content: z.string() })),
});
export type RunExport = z.infer<typeof RunExportSchema>;

// ---- HTTP responses of the engine ----

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  protocol: z.number().int().positive(),
  /** Highest event seq stored; clients that only want new events start `GET /events?since=` here. */
  lastSeq: z.number().int().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const StartJobResponseSchema = z.object({ taskId: z.string().min(1) });
export type StartJobResponse = z.infer<typeof StartJobResponseSchema>;

export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;

/** Error body for 400/401/404/409/500. `issues` lists zod issue paths for 400. */
export const ErrorResponseSchema = z.object({
  error: z.string().min(1),
  message: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

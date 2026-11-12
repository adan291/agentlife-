import { z } from "zod";
import { AgentEventSchema, ApprovalDecisionSchema, JobStateSchema, StepNameSchema } from "./events.ts";
import { JOB_TARGET_MAX_CHARS, JobKindSchema, targetProblem } from "./job-kinds.ts";
import { GOAL_MAX_CHARS } from "./limits.ts";
import { DeliveryInfoSchema } from "./projects.ts";

// The public repo view is `RepoSchema` in protocol.ts; `source` paths are never exposed.

export const StartJobBodySchema = z
  .object({
    repoId: z.string().min(1).max(100),
    goal: z.string().trim().min(1).max(GOAL_MAX_CHARS),
    /** What the job does. Default `change`. */
    kind: JobKindSchema.default("change"),
    /** `review-branch`: a local branch of the project. `write-tests`: a path or module. `document`: a topic or path. */
    target: z.string().max(JOB_TARGET_MAX_CHARS).optional(),
  })
  .superRefine((body, ctx) => {
    const problem = targetProblem(body.kind, body.target);
    if (problem) ctx.addIssue({ code: "custom", path: ["target"], message: problem });
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

export const FindingSeveritySchema = z.enum(["high", "medium", "low"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const BRANCH_FINDINGS_MAX = 30;
export const FINDING_TEXT_MAX = 500;

/** Result of reviewing a branch (`review-branch` jobs): findings by severity and a verdict on merging it. */
export const BranchReviewSchema = z.object({
  verdict: VerdictSchema,
  risk: RiskSchema,
  findings: z
    .array(
      z.object({
        severity: FindingSeveritySchema,
        text: z.string().min(1).max(FINDING_TEXT_MAX),
        file: z.string().min(1).max(200).optional(),
      }),
    )
    .max(BRANCH_FINDINGS_MAX),
});
export type BranchReview = z.infer<typeof BranchReviewSchema>;

/** `GET /projects/:id/branches`: the local branches of the project (never free text) and the one checked out. */
export const BranchesResponseSchema = z.object({
  current: z.string().min(1).max(JOB_TARGET_MAX_CHARS).nullable(),
  branches: z.array(z.string().min(1).max(JOB_TARGET_MAX_CHARS)).max(200),
});
export type BranchesResponse = z.infer<typeof BranchesResponseSchema>;

/** `GET /config/roles`: only the runtime and model of each role, nothing else from the config. */
export const RolesConfigResponseSchema = z.object({
  architect: z.object({ runtime: z.string().min(1), model: z.string().min(1).optional() }),
  developer: z.object({ runtime: z.string().min(1), model: z.string().min(1).optional() }),
  qa: z.object({ runtime: z.string().min(1), model: z.string().min(1).optional() }),
});
export type RolesConfigResponse = z.infer<typeof RolesConfigResponseSchema>;

export const StepRecordSchema = z.object({
  step: StepNameSchema,
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  /** `endedAt - startedAt`, present once the step has ended. */
  durationMs: z.number().int().nonnegative().optional(),
  status: z.enum(["running", "ok", "failed", "cancelled"]),
  credits: z.number().nonnegative().optional(),
  tokens: z.number().int().nonnegative().optional(),
  /** From `agent.work`: the model that ran the step, the highest context use seen and the file counts. */
  model: z.string().min(1).max(100).optional(),
  contextPeak: z.number().min(0).max(100).optional(),
  filesRead: z.number().int().nonnegative().optional(),
  filesEdited: z.number().int().nonnegative().optional(),
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
  /** Absent means `change`. */
  kind: JobKindSchema.optional(),
  /** Branch, module path or topic of a non-`change` job. */
  target: z.string().max(JOB_TARGET_MAX_CHARS).optional(),
  state: JobStateSchema,
  steps: z.array(StepRecordSchema),
  approvals: z.array(ApprovalRecordSchema),
  artifacts: z.array(ArtifactRefSchema),
  verdict: VerdictSchema.optional(),
  /** Git branch of the Developer's worktree. Set by the export once a develop step ran. */
  branch: z.string().min(1).max(200).optional(),
  /** Set once the branch was delivered to the user's repository (`delivery.done`). */
  delivery: DeliveryInfoSchema.optional(),
  /** Set by the export: the job ran on a registered project, finished with a change and was not delivered yet. */
  deliverable: z.boolean().optional(),
});
export type EngineJobView = z.infer<typeof EngineJobViewSchema>;

/** The viewer shows at most this many characters of an artifact; the rest is cut and flagged. */
export const ARTIFACT_VIEW_MAX_CHARS = 200_000;

export const ArtifactViewSchema = z.object({
  artifactId: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1).max(200),
  content: z.string().max(ARTIFACT_VIEW_MAX_CHARS + 200),
  truncated: z.boolean(),
});
export type ArtifactView = z.infer<typeof ArtifactViewSchema>;

/** Cap on the sum of artifact characters in one `job_details` answer. */
export const JOB_DETAILS_MAX_TOTAL_CHARS = 1_000_000;

/** `job_details` answer: the job and the (size-capped) contents of its artifacts, in creation order. */
export const JobDetailsSchema = z.object({
  job: EngineJobViewSchema,
  artifacts: z.array(ArtifactViewSchema).max(40),
});
export type JobDetails = z.infer<typeof JobDetailsSchema>;

/** Builds the `job_details` answer from a run export (live engine or recorded demo). Pure. */
export function jobDetailsFromExport(exp: RunExport): JobDetails {
  const titles = new Map(exp.job.artifacts.map((a) => [a.artifactId, a.title] as const));
  // Total budget across artifacts so one `job_details` message stays small (review: up to 8 MB before).
  let budget = JOB_DETAILS_MAX_TOTAL_CHARS;
  const artifacts = exp.artifacts.slice(0, 40).map((a): ArtifactView => {
    const limit = Math.max(0, Math.min(ARTIFACT_VIEW_MAX_CHARS, budget));
    const truncated = a.content.length > limit;
    const content = truncated ? `${a.content.slice(0, limit)}\n[cut: ${a.content.length} characters in total]` : a.content;
    budget -= Math.min(a.content.length, limit);
    return { artifactId: a.id, kind: a.kind, title: titles.get(a.id) ?? a.kind, content, truncated };
  });
  return { job: exp.job, artifacts };
}

export const RunExportSchema = z.object({
  version: z.literal(1),
  recordedAt: z.number().int().nonnegative(),
  /** Floor the job ran on (`project:<id>`). Exports made before the hotel have none; the replay derives it from the repo id. */
  roomId: z.string().min(1).max(100).optional(),
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

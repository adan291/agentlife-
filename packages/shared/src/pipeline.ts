import { z } from "zod";
import { MEMBER_ID_RE, TeamRoleSchema, type TeamRole } from "./team.ts";

/**
 * The pipeline of a project (pipeline-editor): which steps a `change` job runs and who does them. The engine validates
 * every pipeline against fixed safety rules; the board editor uses the same function to show the reason live.
 */

export const PIPELINE_STEP_KINDS = ["research", "plan", "approve", "develop", "test", "review", "second-review", "report"] as const;
export const PipelineStepKindSchema = z.enum(PIPELINE_STEP_KINDS);
export type PipelineStepKind = z.infer<typeof PipelineStepKindSchema>;

export const PipelineStepSchema = z
  .object({
    kind: PipelineStepKindSchema,
    /** The team member who does the step. Absent: the default member of the step's role. */
    memberId: z.string().regex(MEMBER_ID_RE).optional(),
  })
  .strict();
export type PipelineStep = z.infer<typeof PipelineStepSchema>;

/** Every kind may appear once, so a pipeline never has more steps than there are kinds. */
export const PIPELINE_MAX_STEPS = PIPELINE_STEP_KINDS.length;
export const PipelineSchema = z.array(PipelineStepSchema).min(1).max(PIPELINE_MAX_STEPS);
export type Pipeline = z.infer<typeof PipelineSchema>;

/** Today's flow. A project without a saved pipeline runs this one. */
export const DEFAULT_PIPELINE: readonly PipelineStep[] = [
  { kind: "plan" },
  { kind: "approve" },
  { kind: "develop" },
  { kind: "test" },
  { kind: "review" },
  { kind: "report" },
];

export const PIPELINE_STEP_LABELS: Readonly<Record<PipelineStepKind, string>> = {
  research: "Research",
  plan: "Plan",
  approve: "Approval",
  develop: "Develop",
  test: "Tests",
  review: "Review",
  "second-review": "Second review",
  report: "Report",
};

/**
 * The roles a member of each step may have, the most usual first. A step with none is done by the engine or by the
 * user (approval, tests, report) and takes no member.
 */
export const PIPELINE_STEP_ROLES: Readonly<Record<PipelineStepKind, readonly TeamRole[]>> = {
  research: ["researcher"],
  plan: ["architect"],
  approve: [],
  develop: ["developer"],
  test: [],
  review: ["qa", "reviewer"],
  "second-review": ["reviewer", "qa"],
  report: [],
};

/** Kinds every pipeline must have. `research` and `second-review` are optional. */
export const PIPELINE_REQUIRED_KINDS: readonly PipelineStepKind[] = ["plan", "approve", "develop", "test", "review", "report"];

/** What the rules need to know about a team member. */
export interface PipelineMember {
  id: string;
  role: TeamRole;
  displayName?: string;
  model?: string;
}

/** One broken rule. `index` is the step it belongs to, or null when it concerns the pipeline as a whole. */
export interface PipelineError {
  index: number | null;
  rule: string;
}

export type PipelineCheck = { ok: true } | { ok: false; errors: PipelineError[] };

function rolesText(roles: readonly TeamRole[]): string {
  return roles.length <= 1 ? (roles[0] ?? "") : `${roles.slice(0, -1).join(", ")} or ${roles[roles.length - 1]}`;
}

/**
 * The member who does the second review or the research when the step names none: the first member with the usual role.
 * Other steps keep the role-based choice of the team, so they return undefined here.
 */
export function defaultMemberFor(kind: PipelineStepKind, team: readonly PipelineMember[]): PipelineMember | undefined {
  if (kind !== "research" && kind !== "second-review") return undefined;
  const role = PIPELINE_STEP_ROLES[kind][0];
  return team.find((m) => m.role === role);
}

/**
 * The fixed safety rules (requirement 1.2). Pure: the engine uses it to accept a pipeline and to start a job, the client
 * to show the reason next to the step that breaks a rule.
 *
 * - it starts with Plan, which only Research may precede; Approval comes after Plan and before Develop; Tests come after
 *   Develop; every review comes after Tests; Report is last;
 * - Plan, Approval, Develop, Tests, Review and Report are all there, each kind at most once;
 * - a step's member is on the team and has a role the step needs; approval, tests and report take no member;
 * - the second review is done by someone else than the review, on a different model.
 */
export function validatePipeline(steps: readonly PipelineStep[], team: readonly PipelineMember[]): PipelineCheck {
  const errors: PipelineError[] = [];
  const add = (index: number | null, rule: string): void => void errors.push({ index, rule });
  const label = PIPELINE_STEP_LABELS;
  const indexOf = (kind: PipelineStepKind): number | undefined => {
    const i = steps.findIndex((s) => s.kind === kind);
    return i < 0 ? undefined : i;
  };

  // Each kind once.
  const seen = new Set<PipelineStepKind>();
  steps.forEach((s, i) => {
    if (seen.has(s.kind)) add(i, `${label[s.kind]} can only appear once.`);
    seen.add(s.kind);
  });
  for (const kind of PIPELINE_REQUIRED_KINDS) {
    if (!seen.has(kind)) add(null, `A pipeline needs a ${label[kind]} step.`);
  }

  // The start.
  const lead = steps[0]?.kind === "research" ? 1 : 0;
  if (steps.length > lead && steps[lead]?.kind !== "plan") add(lead, "A pipeline starts with Plan. Only Research may come before it.");
  steps.forEach((s, i) => {
    if (s.kind === "research" && i !== 0) add(i, "Research can only come first, before Plan.");
  });

  const plan = indexOf("plan");
  const approve = indexOf("approve");
  const develop = indexOf("develop");
  const test = indexOf("test");
  if (approve !== undefined) {
    if (plan !== undefined && approve < plan) add(approve, "Approval must come after Plan: you approve the plan.");
    else if (develop !== undefined && approve > develop) add(approve, "Approval must come before Develop: nothing is built without your approval.");
  }
  if (test !== undefined && develop !== undefined && test < develop) add(test, "Tests must run after Develop.");
  for (const kind of ["review", "second-review"] as const) {
    const i = indexOf(kind);
    if (i !== undefined && test !== undefined && i < test) add(i, `${label[kind]} must come after Tests.`);
  }
  if (seen.has("second-review") && !seen.has("review")) add(indexOf("second-review") ?? null, "A second review needs a Review step too.");
  const report = indexOf("report");
  if (report !== undefined && report !== steps.length - 1) add(report, "Report must be the last step.");

  // Members.
  const byId = new Map(team.map((m) => [m.id, m]));
  const memberOf = (step: PipelineStep): PipelineMember | undefined => (step.memberId ? byId.get(step.memberId) : defaultMemberFor(step.kind, team));
  steps.forEach((s, i) => {
    const roles = PIPELINE_STEP_ROLES[s.kind];
    if (s.memberId !== undefined) {
      if (roles.length === 0) return add(i, `${label[s.kind]} is not done by a team member.`);
      const m = byId.get(s.memberId);
      if (!m) return add(i, `${s.memberId} is not on this team.`);
      if (!roles.includes(m.role)) add(i, `${m.displayName ?? m.id} is a ${m.role}; ${label[s.kind]} needs a ${rolesText(roles)}.`);
    } else if ((s.kind === "research" || s.kind === "second-review") && !defaultMemberFor(s.kind, team)) {
      add(i, `${label[s.kind]} needs a ${PIPELINE_STEP_ROLES[s.kind][0]} on the team. Hire one at the HR desk.`);
    }
  });

  // Independence of the second review.
  const first = steps.find((s) => s.kind === "review");
  const second = steps.find((s) => s.kind === "second-review");
  if (first && second) {
    const a = first.memberId ? byId.get(first.memberId) : team.find((m) => m.role === "qa");
    const b = memberOf(second);
    const at = steps.indexOf(second);
    if (a && b) {
      if (a.id === b.id) add(at, "The second review needs someone other than the Review. Choose another team member.");
      else if (a.model !== undefined && b.model !== undefined && a.model === b.model) {
        add(at, `The second review needs a different model than the Review (both use ${a.model}). Change the model of one of them.`);
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** The first reason, for a message that has room for one. */
export function pipelineProblem(check: PipelineCheck): string | undefined {
  return check.ok ? undefined : check.errors[0]?.rule;
}

// ---- Engine API ----

export const PipelineMemberViewSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  role: TeamRoleSchema,
  model: z.string(),
});
export type PipelineMemberView = z.infer<typeof PipelineMemberViewSchema>;

/** `GET /projects/:id/pipeline`: the steps, whether they were changed, and the team the rules check them against. */
export const PipelineResponseSchema = z.object({
  projectId: z.string(),
  /** False while the project runs the default pipeline. */
  customised: z.boolean(),
  steps: PipelineSchema,
  members: z.array(PipelineMemberViewSchema).max(16),
});
export type PipelineResponse = z.infer<typeof PipelineResponseSchema>;

export const SavePipelineBodySchema = z.object({ steps: PipelineSchema }).strict();
export type SavePipelineBody = z.infer<typeof SavePipelineBodySchema>;

/** `data/pipelines.json`: the pipeline of each project that changed it. */
export const PipelinesFileSchema = z.record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(60), PipelineSchema);
export type PipelinesFile = z.infer<typeof PipelinesFileSchema>;

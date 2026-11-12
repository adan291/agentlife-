import { z } from "zod";
import { PROJECT_ROLES, type ProjectRole } from "./room.ts";

/**
 * Agent teams (hr-desk). A template says who an agent is; the tier says what it may do. Tiers are fixed files in the
 * agent-engine package, so nothing a template or an import contains can widen a permission.
 */

/** What an agent does in the pipeline. The first three run today; the others are used by pipeline-editor. */
export const TEAM_ROLES = ["architect", "developer", "qa", "reviewer", "researcher"] as const;
export const TeamRoleSchema = z.enum(TEAM_ROLES);
export type TeamRole = z.infer<typeof TeamRoleSchema>;

export const TIER_IDS = ["read-only", "write-in-worktree"] as const;
export const TierIdSchema = z.enum(TIER_IDS);
export type TierId = z.infer<typeof TierIdSchema>;

/** The only tier a role may have: the Developer writes inside its worktree, every other role is read-only. */
export function tierForRole(role: TeamRole): TierId {
  return role === "developer" ? "write-in-worktree" : "read-only";
}

/** Roles the pipeline runs today, which are also the agents of a project room. */
export function isPipelineRole(role: TeamRole): role is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(role);
}

export const TEMPLATE_PERSONA_MAX = 2000;
export const TEMPLATE_DESCRIPTION_MAX = 300;
export const TEMPLATE_NAME_MAX = 40;
export const TEMPLATE_MODEL_MAX = 60;
/** A model id is passed to `kiro-cli --model`, so it must look like one and can never start with a dash. */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const ModelIdSchema = z.string().trim().min(1).max(TEMPLATE_MODEL_MAX).regex(MODEL_ID_RE, "not a model id");
export const BUILT_IN_SOURCE = "built-in";

export const TemplateIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "use lowercase letters, digits and dashes");

const sourceOk = (s: string): boolean => s === BUILT_IN_SOURCE || (/^https:\/\/\S+$/.test(s) && s.length <= 300);

/** The fields every template has. Unknown fields are dropped when this is used to parse (never copied anywhere). */
export const TemplateBaseSchema = z.object({
  id: TemplateIdSchema,
  name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX),
  role: TeamRoleSchema,
  /** Who the agent is: voice and approach. Never a permission. */
  persona: z.string().trim().min(1).max(TEMPLATE_PERSONA_MAX),
  description: z.string().trim().min(1).max(TEMPLATE_DESCRIPTION_MAX),
  defaultModel: ModelIdSchema,
  tier: TierIdSchema,
  /** `built-in`, or the HTTPS address an imported template came from. */
  source: z.string().refine(sourceOk, "source must be built-in or an https address"),
});

/** A template file of the catalogue: strict, and the tier must be the one its role is allowed. */
export const TemplateSchema = TemplateBaseSchema.strict().refine((t) => t.tier === tierForRole(t.role), {
  message: "the tier does not match the role",
  path: ["tier"],
});
export type Template = z.infer<typeof TemplateSchema>;

export const CatalogueEntrySchema = z.object({
  id: TemplateIdSchema,
  name: z.string(),
  role: TeamRoleSchema,
  tier: TierIdSchema,
  defaultModel: z.string(),
  description: z.string(),
  source: z.string(),
  origin: z.enum(["built-in", "imported"]),
});
export type CatalogueEntry = z.infer<typeof CatalogueEntrySchema>;
export const CatalogueResponseSchema = z.array(CatalogueEntrySchema);

export const MEMBER_NAME_MAX = 30;
export const MEMBER_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]*$/u;
export const MEMBER_ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
export const TEAM_MAX_MEMBERS = 8;

export const MemberNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MEMBER_NAME_MAX)
  .regex(MEMBER_NAME_RE, "use letters, digits, spaces and . _ ' -");

export const TeamMemberSchema = z.object({
  id: z.string().regex(MEMBER_ID_RE),
  displayName: MemberNameSchema,
  templateId: TemplateIdSchema,
  role: TeamRoleSchema,
  model: ModelIdSchema,
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

/** `data/teams.json`: the members of each project's team. */
export const TeamsFileSchema = z.record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(60), z.array(TeamMemberSchema).max(TEAM_MAX_MEMBERS));
export type TeamsFile = z.infer<typeof TeamsFileSchema>;

export const TeamResponseSchema = z.object({
  projectId: z.string(),
  /** False while the project still has the default team and nothing was changed. */
  customised: z.boolean(),
  members: z.array(TeamMemberSchema),
});
export type TeamResponse = z.infer<typeof TeamResponseSchema>;

export const HireBodySchema = z
  .object({
    templateId: TemplateIdSchema,
    displayName: MemberNameSchema,
    /** Default: the template's own model. */
    model: ModelIdSchema.optional(),
  })
  .strict();
export type HireBody = z.infer<typeof HireBodySchema>;

export const UpdateMemberBodySchema = z
  .object({
    displayName: MemberNameSchema.optional(),
    model: ModelIdSchema.optional(),
  })
  .strict()
  .refine((b) => b.displayName !== undefined || b.model !== undefined, "nothing to change");
export type UpdateMemberBody = z.infer<typeof UpdateMemberBodySchema>;

/** Models a member of each role may use (the account's models limited by the role's allowed list). */
export const TeamModelsResponseSchema = z.object({ models: z.partialRecord(TeamRoleSchema, z.array(z.string())) });
export type TeamModelsResponse = z.infer<typeof TeamModelsResponseSchema>;

import { z } from "zod";
import { ProjectSchema } from "./projects.ts";
import { GuestIdSchema } from "./room.ts";
import {
  CatalogueEntrySchema,
  ImportApproveBodySchema,
  ImportUrlSchema,
  ImportViewSchema,
  MemberNameSchema,
  MEMBER_ID_RE,
  ModelIdSchema,
  TeamMemberSchema,
  TeamRoleSchema,
  TemplateIdSchema,
} from "./team.ts";

/**
 * The HR office (hr-desk task 4): what the HR desk panel shows, what the user can do there, and the HR agent's proposal.
 * The engine owns the rules; these are the shapes that cross the engine, the world-server and the client.
 */

/** Roles that sit at a desk on a project's floor today. */
export const SEATED_ROLES = ["architect", "developer", "qa"] as const;
export const SeatedRoleSchema = z.enum(SEATED_ROLES);

export type SeatedRole = z.infer<typeof SeatedRoleSchema>;

export const SUGGESTION_PICKS_MAX = 3;

/** One change the HR agent proposes: bring in `templateId` and, when someone holds that desk now, let them go. */
export const TeamPickSchema = z.object({
  templateId: TemplateIdSchema,
  displayName: MemberNameSchema,
  model: ModelIdSchema,
  /** The member this one would replace at the desk (fired after the hire, so the team never lacks the role). */
  replacesId: z.string().regex(MEMBER_ID_RE).optional(),
});
export type TeamPick = z.infer<typeof TeamPickSchema>;

export const TeamSuggestionPickSchema = TeamPickSchema.extend({
  templateName: z.string().max(60),
  role: SeatedRoleSchema,
  why: z.string().max(200),
  replacesName: z.string().max(60).optional(),
});
export type TeamSuggestionPick = z.infer<typeof TeamSuggestionPickSchema>;

/** The HR agent's answer to "suggest a team for this project". Nothing is hired until the user applies it. */
export const TeamSuggestionSchema = z.object({
  projectId: z.string().min(1).max(100),
  summary: z.string().max(600),
  /** `agent`: the HR agent chose; `rules`: the engine's fixed rules did, because the agent was not available. */
  by: z.enum(["agent", "rules"]),
  picks: z.array(TeamSuggestionPickSchema).max(SUGGESTION_PICKS_MAX),
});
export type TeamSuggestion = z.infer<typeof TeamSuggestionSchema>;

export const HrTeamSchema = z.object({
  projectId: ProjectSchema.shape.id,
  name: z.string(),
  customised: z.boolean(),
  members: z.array(TeamMemberSchema),
});
export type HrTeam = z.infer<typeof HrTeamSchema>;

/** Everything the HR desk panel needs, in one message. */
export const HrStateSchema = z.object({
  catalogue: z.array(CatalogueEntrySchema),
  teams: z.array(HrTeamSchema),
  imports: z.array(ImportViewSchema),
  /** Addresses imports may come from (empty: imports are off). */
  sources: z.array(ImportUrlSchema),
  /** Models each role may use. */
  models: z.partialRecord(TeamRoleSchema, z.array(z.string())),
});
export type HrState = z.infer<typeof HrStateSchema>;

const ProjectIdSchema = z.string().min(1).max(100);

/** What the user can do at the HR desk. */
export const HrActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("hire"), projectId: ProjectIdSchema, templateId: TemplateIdSchema, displayName: MemberNameSchema, model: ModelIdSchema.optional() }),
  z.object({
    action: z.literal("update"),
    projectId: ProjectIdSchema,
    memberId: z.string().regex(MEMBER_ID_RE),
    displayName: MemberNameSchema.optional(),
    model: ModelIdSchema.optional(),
  }),
  z.object({ action: z.literal("fire"), projectId: ProjectIdSchema, memberId: z.string().regex(MEMBER_ID_RE) }),
  z.object({ action: z.literal("import"), url: ImportUrlSchema }),
  z.object({ action: z.literal("approve_import"), id: TemplateIdSchema, hash: ImportApproveBodySchema.shape.hash }),
  z.object({ action: z.literal("reject_import"), id: TemplateIdSchema }),
  /** Ask the HR agent for a proposal. Answered with `hr_suggestion`; nothing changes. */
  z.object({ action: z.literal("suggest"), projectId: ProjectIdSchema }),
  /** The user applies a proposal they saw: each pick is a hire, then the replaced member leaves. */
  z.object({ action: z.literal("apply"), projectId: ProjectIdSchema, picks: z.array(TeamPickSchema).min(1).max(SUGGESTION_PICKS_MAX) }),
]);
export type HrAction = z.infer<typeof HrActionSchema>;

/** The member that works the desk of each seated role on a floor, as the room shows it. */
export const TeamViewMemberSchema = z.object({
  agentId: SeatedRoleSchema,
  name: z.string().min(1).max(60),
  model: z.string().max(100).optional(),
  /** The member's id (the role name for a desk nobody was hired for), so the client can look up its level. */
  memberId: z.string().regex(MEMBER_ID_RE).optional(),
});
export type TeamViewMember = z.infer<typeof TeamViewMemberSchema>;

/** A member who does not hold a role's desk and stands at one of the floor's spots (`guest1`..`guest6`). */
export const TeamViewGuestSchema = z.object({
  guestId: GuestIdSchema,
  name: z.string().min(1).max(60),
  role: TeamRoleSchema,
  model: z.string().max(100).optional(),
  memberId: z.string().regex(MEMBER_ID_RE).optional(),
});
export type TeamViewGuest = z.infer<typeof TeamViewGuestSchema>;

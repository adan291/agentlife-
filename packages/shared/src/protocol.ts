import { z } from "zod";
import { AgentStateSchema, ApprovalDecisionSchema, JobStateSchema } from "./events.ts";
import { AgentIdSchema, RoomDefSchema } from "./room.ts";

export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_MESSAGES_PER_SECOND = 20;
export const GOAL_MAX_CHARS = 300;

const TileSchema = z.object({ x: z.number().int(), y: z.number().int() });
const DirSchema = z.number().int().min(0).max(7);

export const PanelNameSchema = z.enum(["computer", "mailbox", "board"]);
export type PanelName = z.infer<typeof PanelNameSchema>;

/** User avatar id is a positive integer; agent ids are strings, so they never collide. */
export const AvatarIdSchema = z.union([z.number().int().positive(), AgentIdSchema]);
export type AvatarId = z.infer<typeof AvatarIdSchema>;

export const AvatarSchema = z.object({
  id: AvatarIdSchema,
  name: z.string().min(1).max(40),
  x: z.number().int(),
  y: z.number().int(),
  dir: DirSchema,
});
export type Avatar = z.infer<typeof AvatarSchema>;

export const AgentStatusSchema = z.object({
  agentId: AgentIdSchema,
  state: AgentStateSchema,
  text: z.string().max(200).optional(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const RepoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().max(300).optional(),
});
export type Repo = z.infer<typeof RepoSchema>;

export const TimelineEntrySchema = z.object({
  ts: z.number().int().nonnegative(),
  state: JobStateSchema,
  text: z.string().max(500).optional(),
});

export const JobViewSchema = z.object({
  taskId: z.string().min(1),
  repoId: z.string().min(1),
  goal: z.string().max(GOAL_MAX_CHARS),
  state: JobStateSchema,
  timeline: z.array(TimelineEntrySchema),
});
export type JobView = z.infer<typeof JobViewSchema>;

export const ApprovalSchema = z.object({
  approvalId: z.string().min(1),
  taskId: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string().max(4000),
  options: z.array(z.string().max(200)).max(10).optional(),
  status: z.enum(["pending", "approved", "rejected"]),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ReportSchema = z.object({
  reportId: z.string().min(1),
  taskId: z.string().min(1),
  title: z.string().min(1).max(200),
  markdown: z.string().max(100_000),
});
export type Report = z.infer<typeof ReportSchema>;

export const ErrorCodeSchema = z.enum([
  "bad_message",
  "no_path",
  "rate_limited",
  "busy",
  "engine_unavailable",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Client -> world-server. */
export const ClientMsgSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), protocol: z.number().int() }),
  z.object({ type: z.literal("move"), x: z.number().int(), y: z.number().int() }),
  z.object({ type: z.literal("use"), itemId: z.string().min(1).max(100) }),
  z.object({
    type: z.literal("start_job"),
    repoId: z.string().min(1).max(100),
    goal: z.string().trim().min(1).max(GOAL_MAX_CHARS),
  }),
  z.object({
    type: z.literal("approve"),
    approvalId: z.string().min(1).max(100),
    decision: ApprovalDecisionSchema,
    note: z.string().max(500).optional(),
  }),
]);
export type ClientMsg = z.infer<typeof ClientMsgSchema>;

export const WelcomeMsgSchema = z.object({
  type: z.literal("welcome"),
  protocol: z.number().int(),
  room: RoomDefSchema,
  you: z.number().int().positive(),
  avatars: z.array(AvatarSchema),
  agents: z.array(AgentStatusSchema),
});
export type WelcomeMsg = z.infer<typeof WelcomeMsgSchema>;

/** World-server -> client. */
export const ServerMsgSchema = z.discriminatedUnion("type", [
  WelcomeMsgSchema,
  z.object({
    type: z.literal("walk"),
    id: AvatarIdSchema,
    path: z.array(TileSchema).max(500),
    msPerTile: z.number().positive(),
    /** Epoch ms when the first step begins. */
    startedAt: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("face"), id: AvatarIdSchema, dir: DirSchema }),
  z.object({
    type: z.literal("agent_state"),
    agentId: AgentIdSchema,
    state: AgentStateSchema,
    text: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal("say"), id: AvatarIdSchema, text: z.string().min(1).max(300) }),
  z.object({ type: z.literal("open_panel"), panel: PanelNameSchema, data: z.unknown().optional() }),
  z.object({ type: z.literal("repos"), repos: z.array(RepoSchema) }),
  z.object({ type: z.literal("job_update"), job: JobViewSchema }),
  z.object({ type: z.literal("approval"), approval: ApprovalSchema }),
  z.object({ type: z.literal("report"), report: ReportSchema }),
  z.object({ type: z.literal("error"), code: ErrorCodeSchema, message: z.string().max(500) }),
]);
export type ServerMsg = z.infer<typeof ServerMsgSchema>;

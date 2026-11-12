import { z } from "zod";
import { ACTIVITY_TEXT_MAX, AgentStateSchema, AgentWorkSchema, ApprovalDecisionSchema, JobStateSchema, StepNameSchema } from "./events.ts";
import { BranchesResponseSchema, JobDetailsSchema, VerdictSchema } from "./engine-api.ts";
import { BuildBoardSchema, BuildReportSchema, SpecNameSchema } from "./build.ts";
import { FloorStatusSchema } from "./floors.ts";
import { JOB_TARGET_MAX_CHARS, JobKindSchema, targetProblem } from "./job-kinds.ts";
import { GOAL_MAX_CHARS } from "./limits.ts";
import { DeliveryInfoSchema, ProjectSchema, RegisterProjectBodySchema, RegisterProjectResultSchema } from "./projects.ts";
import { AgentIdSchema, RoomDefSchema } from "./room.ts";

export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_MESSAGES_PER_SECOND = 20;
export { GOAL_MAX_CHARS };

const TileSchema = z.object({ x: z.number().int(), y: z.number().int() });
const DirSchema = z.number().int().min(0).max(7);

/** `lobby`, `hr` or `project:<id>`. */
export const RoomIdSchema = z.string().regex(/^(lobby|hr|project:[a-z0-9][a-z0-9-]{0,59})$/);

/** Task ids are `task-` plus hex; any safe identifier is accepted so the engine decides what exists. */
export const TaskIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

export const PanelNameSchema = z.enum(["computer", "mailbox", "board", "reception", "elevator", "directory", "door", "build", "review", "tests", "library"]);
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
  /** What the agent is working on, so a reload keeps the team bar block. Absent when it is not working. */
  work: AgentWorkSchema.optional(),
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
  /** Absent means `change`. */
  kind: JobKindSchema.optional(),
  /** Branch, module path or topic of a job that is not a `change`. */
  target: z.string().max(JOB_TARGET_MAX_CHARS).optional(),
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

export const ACTIVITY_BUFFER_SIZE = 50;

/** One line of the activity terminal. */
export const ActivityLineSchema = z.object({
  ts: z.number().int().nonnegative(),
  agentId: AgentIdSchema,
  text: z.string().min(1).max(ACTIVITY_TEXT_MAX),
  /** Job the line belongs to, so lines of different jobs can be told apart. Absent for Builder lines. */
  taskId: z.string().min(1).optional(),
  /** Step the job was in when the line was written. */
  step: StepNameSchema.optional(),
  /** Room (floor) the line belongs to, so the terminal can show "This floor" or "All floors". */
  roomId: z.string().min(1).max(100).optional(),
});
export type ActivityLine = z.infer<typeof ActivityLineSchema>;

export const ReportDeliverySchema = z.discriminatedUnion("state", [
  /** The job's branch can be fetched into the user's repository (the "Deliver as branch" button). */
  z.object({ state: z.literal("available") }),
  z.object({ state: z.literal("done"), branch: DeliveryInfoSchema.shape.branch, commit: DeliveryInfoSchema.shape.commit }),
]);
export type ReportDelivery = z.infer<typeof ReportDeliverySchema>;

export const ReportSchema = z.object({
  reportId: z.string().min(1),
  taskId: z.string().min(1),
  title: z.string().min(1).max(200),
  markdown: z.string().max(100_000),
  /** QA verdict of the job, from the engine's `verdict:pass|fail` transition reason. Absent when unknown. */
  verdict: VerdictSchema.optional(),
  /** Epoch ms when the report was delivered. */
  ts: z.number().int().nonnegative().optional(),
  /** Absent: not a job on a registered project, or the engine does not know. */
  delivery: ReportDeliverySchema.optional(),
});
export type Report = z.infer<typeof ReportSchema>;

export const ErrorCodeSchema = z.enum([
  "bad_message",
  "no_path",
  "rate_limited",
  "busy",
  "engine_unavailable",
  "project_error",
  "delivery_failed",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Client -> world-server. */
export const ClientMsgSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), protocol: z.number().int() }),
  z.object({ type: z.literal("move"), x: z.number().int(), y: z.number().int() }),
  z.object({ type: z.literal("use"), itemId: z.string().min(1).max(100) }),
  z
    .object({
      type: z.literal("start_job"),
      repoId: z.string().min(1).max(100),
      goal: z.string().trim().min(1).max(GOAL_MAX_CHARS),
      /** What the job does; absent means `change`. The furniture the user used decides it (job-types spec). */
      kind: JobKindSchema.optional(),
      /** Branch (`review-branch`), path or module (`write-tests`), topic or path (`document`). */
      target: z.string().max(JOB_TARGET_MAX_CHARS).optional(),
    })
    .superRefine((msg, ctx) => {
      const problem = targetProblem(msg.kind ?? "change", msg.target);
      if (problem) ctx.addIssue({ code: "custom", path: ["target"], message: problem });
    }),
  /** Review desk: ask for the local branches of the project on the user's floor. Answered with `branches`. */
  z.object({ type: z.literal("list_branches") }),
  z.object({
    type: z.literal("approve"),
    approvalId: z.string().min(1).max(100),
    decision: ApprovalDecisionSchema,
    note: z.string().max(500).optional(),
  }),
  /** Asks for the job card: the job view and the contents of its artifacts. Answered with `job_details`. */
  z.object({ type: z.literal("job_details"), taskId: TaskIdSchema }),
  /** Reception: register a project. Answered with `register_result` (and `projects` when it worked). */
  z.object({ type: z.literal("register_project"), ...RegisterProjectBodySchema.shape }),
  /** Reception: unregister a project (the user's files are not touched). Answered with `projects`. */
  z.object({ type: z.literal("remove_project"), projectId: z.string().min(1).max(100) }),
  /** Report viewer: fetch the job's branch into the user's repository. Answered with `report` (resend) or an error. */
  z.object({ type: z.literal("deliver"), taskId: TaskIdSchema }),
  /** Elevator: go to another floor. Only accepted while the avatar stands at the elevator. Answered with a new `welcome`. */
  z.object({ type: z.literal("go_to"), roomId: RoomIdSchema }),
  /**
   * Activity terminal: `floor` (default on every connection) sends only the activity of the user's floor; `all` also sends
   * the other floors' lines as they happen, plus their buffered lines right away.
   */
  z.object({ type: z.literal("activity_scope"), scope: z.enum(["floor", "all"]) }),
  /** Construction board: ask for fresh data. Answered with `build_board`. */
  z.object({ type: z.literal("build_board") }),
  /** Construction board: the verifier report of a spec. Answered with `build_report`. */
  z.object({ type: z.literal("build_report"), spec: SpecNameSchema }),
]);
export type ClientMsg = z.infer<typeof ClientMsgSchema>;

export const WelcomeMsgSchema = z.object({
  type: z.literal("welcome"),
  protocol: z.number().int(),
  room: RoomDefSchema,
  /** Id of the room the user is in (the same as `room.id`). */
  roomId: z.string().min(1).max(100).optional(),
  you: z.number().int().positive(),
  avatars: z.array(AvatarSchema),
  agents: z.array(AgentStatusSchema),
  /** Model label per role, filled by the world-server from the engine. Absent when unknown. */
  models: z.partialRecord(AgentIdSchema, z.string().min(1).max(100)).optional(),
  /** Last activity lines (max 50, newest last) so a reload does not start with an empty terminal. */
  activity: z.array(ActivityLineSchema).max(ACTIVITY_BUFFER_SIZE).optional(),
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
  /** Local branches of a project (never free text), for the branch picker of the review desk. */
  z.object({ type: z.literal("branches"), projectId: z.string().min(1).max(100), ...BranchesResponseSchema.shape }),
  /** Reception panel data: every project (the built-in one first). Sent when the panel opens and after a change. */
  z.object({ type: z.literal("projects"), projects: z.array(ProjectSchema) }),
  /** Outcome of `register_project`: registered, findings to accept, or the rule that refused it. */
  z.object({ type: z.literal("register_result"), result: RegisterProjectResultSchema }),
  z.object({ type: z.literal("job_update"), job: JobViewSchema }),
  z.object({ type: z.literal("approval"), approval: ApprovalSchema }),
  z.object({ type: z.literal("report"), report: ReportSchema, resend: z.literal(true).optional() }),
  z.object({ type: z.literal("activity"), line: ActivityLineSchema }),
  z.object({ type: z.literal("work"), agentId: AgentIdSchema, work: AgentWorkSchema }),
  z.object({ type: z.literal("job_details"), details: JobDetailsSchema }),
  /** Every floor with its live status. Sent after `welcome` and whenever a status changes. */
  z.object({ type: z.literal("floors"), floors: z.array(FloorStatusSchema).max(100) }),
  /** Construction board data (the engine's `GET /build/board`) and a verifier report. */
  z.object({ type: z.literal("build_board"), board: BuildBoardSchema }),
  z.object({ type: z.literal("build_report"), report: BuildReportSchema }),
  z.object({ type: z.literal("error"), code: ErrorCodeSchema, message: z.string().max(500) }),
]);
export type ServerMsg = z.infer<typeof ServerMsgSchema>;

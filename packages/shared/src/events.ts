import { z } from "zod";
import { AgentIdSchema, SemanticAnchorSchema } from "./room.ts";

export const AgentStateSchema = z.enum([
  "idle",
  "walking",
  "thinking",
  "working",
  "waiting_approval",
  "blocked",
  "done",
  "error",
]);
export type AgentState = z.infer<typeof AgentStateSchema>;

/** Job states (see agent-engine design: transition table). */
export const JobStateSchema = z.enum([
  "created",
  "analyzing",
  "awaiting_plan_approval",
  "developing",
  "testing",
  "reviewing",
  "report_ready",
  "delivered",
  "failed",
  "cancelled",
]);
export type JobState = z.infer<typeof JobStateSchema>;

export const ApprovalDecisionSchema = z.enum(["approve", "reject"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const StepNameSchema = z.enum(["analyze", "develop", "test", "review", "report"]);
export type StepName = z.infer<typeof StepNameSchema>;

export const ACTIVITY_TEXT_MAX = 80;
export const WORK_TITLE_MAX = 120;

/** What an agent is working on right now (requirement 1 of job-insight). Counts come from tool calls. */
const workFields = {
  step: StepNameSchema,
  /** Plan task title, or "Analysing <repo>" for the analyse step. Sanitised by the engine. */
  title: z.string().min(1).max(WORK_TITLE_MAX),
  model: z.string().min(1).max(100).optional(),
  /** Context window use of the agent session, 0 to 100. Absent when the runtime does not report it. */
  contextPct: z.number().min(0).max(100).optional(),
  filesRead: z.number().int().nonnegative(),
  filesEdited: z.number().int().nonnegative(),
  /** Epoch ms when the step started (the client shows the elapsed time from it). */
  startedAt: z.number().int().nonnegative(),
};

export const AgentWorkSchema = z.object({ taskId: z.string().min(1), ...workFields });
export type AgentWork = z.infer<typeof AgentWorkSchema>;

const base = {
  seq: z.number().int().nonnegative(),
  /** Epoch milliseconds. */
  ts: z.number().int().nonnegative(),
  taskId: z.string().min(1),
};

const agentBase = { ...base, agentId: AgentIdSchema };
const optAgentBase = { ...base, agentId: AgentIdSchema.optional() };

export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("task.created"), repoId: z.string().min(1), goal: z.string().min(1).max(300) }),
  z.object({
    ...base,
    type: z.literal("task.state_changed"),
    state: JobStateSchema,
    reason: z.string().max(500).optional(),
  }),
  z.object({ ...base, type: z.literal("task.failed"), reason: z.string().max(500) }),
  z.object({ ...base, type: z.literal("task.completed") }),
  z.object({
    ...agentBase,
    type: z.literal("agent.state_changed"),
    state: AgentStateSchema,
    text: z.string().max(200).optional(),
  }),
  z.object({ ...agentBase, type: z.literal("agent.goto"), anchor: SemanticAnchorSchema }),
  z.object({ ...agentBase, type: z.literal("agent.say"), text: z.string().min(1).max(300) }),
  /** One line of the activity terminal. Text is sanitised (no paths, no secrets) and at most 80 chars. */
  z.object({ ...agentBase, type: z.literal("agent.activity"), text: z.string().min(1).max(ACTIVITY_TEXT_MAX) }),
  /** Work attribution: emitted when a step starts, when its numbers change (max 1/s per agent) and when it ends. */
  z.object({ ...agentBase, type: z.literal("agent.work"), ...workFields }),
  z.object({
    ...optAgentBase,
    type: z.literal("artifact.created"),
    kind: z.string().min(1),
    artifactId: z.string().min(1),
    title: z.string().min(1).max(200),
  }),
  z.object({
    ...optAgentBase,
    type: z.literal("approval.requested"),
    approvalId: z.string().min(1),
    kind: z.string().min(1),
    summary: z.string().max(4000),
    options: z.array(z.string().max(200)).max(10).optional(),
  }),
  z.object({
    ...optAgentBase,
    type: z.literal("approval.resolved"),
    approvalId: z.string().min(1),
    decision: ApprovalDecisionSchema,
  }),
  z.object({
    ...optAgentBase,
    type: z.literal("report.ready"),
    reportId: z.string().min(1),
    title: z.string().min(1).max(200),
    markdown: z.string().max(100_000),
  }),
  /** The job's branch was fetched into the user's repository (project-registry, requirement 5.4). */
  z.object({
    ...base,
    type: z.literal("delivery.done"),
    branch: z.string().min(1).max(200),
    commit: z.string().min(1).max(64),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentEventType = AgentEvent["type"];

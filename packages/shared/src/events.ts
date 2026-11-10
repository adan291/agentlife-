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
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentEventType = AgentEvent["type"];

import { describe, expect, it } from "vitest";
import {
  ApprovalBodySchema,
  EngineJobViewSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  OkResponseSchema,
  PlanSchema,
  ReviewSchema,
  RunExportSchema,
  StartJobBodySchema,
  StartJobResponseSchema,
} from "../src/index.ts";

const task = { id: "t1", title: "T", why: "w", files: ["a.ts"], acceptance: "ok", risk: "low" };
const job = {
  taskId: "j1",
  repoId: "haunted-todo",
  goal: "g",
  state: "created",
  steps: [{ step: "analyze", startedAt: 1, status: "running" }],
  approvals: [],
  artifacts: [],
};

describe("engine-api schemas", () => {
  it("accepts valid samples", () => {
    expect(StartJobBodySchema.safeParse({ repoId: "r", goal: "do it" }).success).toBe(true);
    expect(ApprovalBodySchema.safeParse({ decision: "approve" }).success).toBe(true);
    expect(PlanSchema.safeParse({ tasks: [task] }).success).toBe(true);
    expect(ReviewSchema.safeParse({ verdict: "pass", notes: [], risk: "low" }).success).toBe(true);
    expect(EngineJobViewSchema.safeParse(job).success).toBe(true);
    expect(
      RunExportSchema.safeParse({ version: 1, recordedAt: 5, job, events: [], artifacts: [{ id: "a", kind: "plan", content: "{}" }] })
        .success,
    ).toBe(true);
  });

  it("rejects invalid samples", () => {
    expect(StartJobBodySchema.safeParse({ repoId: "r", goal: "" }).success).toBe(false);
    expect(StartJobBodySchema.safeParse({ repoId: "r", goal: "x".repeat(301) }).success).toBe(false);
    expect(ApprovalBodySchema.safeParse({ decision: "maybe" }).success).toBe(false);
    expect(ApprovalBodySchema.safeParse({ decision: "reject", note: "x".repeat(501) }).success).toBe(false);
    expect(PlanSchema.safeParse({ tasks: [] }).success).toBe(false);
    expect(PlanSchema.safeParse({ tasks: Array(6).fill(task) }).success).toBe(false);
    expect(PlanSchema.safeParse({ tasks: [{ ...task, risk: "huge" }] }).success).toBe(false);
    expect(ReviewSchema.safeParse({ verdict: "meh", notes: [], risk: "low" }).success).toBe(false);
    expect(EngineJobViewSchema.safeParse({ ...job, state: "nope" }).success).toBe(false);
    expect(RunExportSchema.safeParse({ version: 2, recordedAt: 5, job, events: [], artifacts: [] }).success).toBe(false);
  });
});

describe("engine HTTP response schemas", () => {
  it("validates health, start, ok and error bodies", () => {
    expect(HealthResponseSchema.safeParse({ ok: true, protocol: 1, lastSeq: 0 }).success).toBe(true);
    expect(HealthResponseSchema.safeParse({ ok: false, protocol: 1, lastSeq: 0 }).success).toBe(false);
    expect(StartJobResponseSchema.safeParse({ taskId: "t" }).success).toBe(true);
    expect(StartJobResponseSchema.safeParse({ taskId: "" }).success).toBe(false);
    expect(OkResponseSchema.safeParse({ ok: true }).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ error: "bad", issues: [{ path: "goal", message: "x" }] }).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ message: "no error code" }).success).toBe(false);
  });
});

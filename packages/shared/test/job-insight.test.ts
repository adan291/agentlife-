import { describe, expect, it } from "vitest";
import {
  AgentEventSchema,
  ARTIFACT_VIEW_MAX_CHARS,
  ClientMsgSchema,
  JobDetailsSchema,
  jobDetailsFromExport,
  RunExportSchema,
  ServerMsgSchema,
  StepRecordSchema,
  type RunExport,
} from "../src/index.ts";

const work = { step: "develop", title: "Fix isOverdue", model: "m", contextPct: 12.5, filesRead: 2, filesEdited: 1, startedAt: 1000 };

describe("agent.work", () => {
  const ev = { seq: 1, ts: 2, taskId: "task-1", agentId: "developer", type: "agent.work", ...work };

  it("accepts a full event and one without model and context", () => {
    expect(AgentEventSchema.safeParse(ev).success).toBe(true);
    const { model: _m, contextPct: _c, ...bare } = ev;
    expect(AgentEventSchema.safeParse(bare).success).toBe(true);
  });

  it.each([
    ["context above 100", { contextPct: 100.5 }],
    ["negative context", { contextPct: -1 }],
    ["fractional file count", { filesRead: 1.5 }],
    ["negative file count", { filesEdited: -1 }],
    ["unknown step", { step: "deploy" }],
    ["empty title", { title: "" }],
    ["missing start", { startedAt: undefined }],
  ])("rejects %s", (_name, patch) => {
    expect(AgentEventSchema.safeParse({ ...ev, ...patch }).success).toBe(false);
  });
});

describe("work and job_details messages", () => {
  it("parses the work message and the work field of a welcome agent", () => {
    const w = { taskId: "task-1", ...work };
    expect(ServerMsgSchema.safeParse({ type: "work", agentId: "developer", work: w }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "work", agentId: "nobody", work: w }).success).toBe(false);
  });

  it("accepts job_details with a safe task id only", () => {
    expect(ClientMsgSchema.safeParse({ type: "job_details", taskId: "task-d232d369" }).success).toBe(true);
    for (const bad of ["", "../x", "a b", "x".repeat(101), 5]) {
      expect(ClientMsgSchema.safeParse({ type: "job_details", taskId: bad }).success).toBe(false);
    }
  });

  it("step records take the new optional numbers and bound them", () => {
    const base = { step: "develop", startedAt: 1, status: "ok" };
    expect(StepRecordSchema.safeParse({ ...base, model: "m", contextPeak: 40, filesRead: 3, filesEdited: 1 }).success).toBe(true);
    expect(StepRecordSchema.safeParse({ ...base, contextPeak: 101 }).success).toBe(false);
  });
});

function exportOf(content: string): RunExport {
  return RunExportSchema.parse({
    version: 1,
    recordedAt: 5,
    job: {
      taskId: "task-1",
      repoId: "r",
      goal: "g",
      state: "delivered",
      steps: [],
      approvals: [],
      artifacts: [{ artifactId: "a1", kind: "diff", title: "Patch (attempt 1)" }],
      branch: "agentlife/task-1",
    },
    events: [],
    artifacts: [
      { id: "a1", kind: "diff", content },
      { id: "a2", kind: "report", content: "# R" },
    ],
  });
}

describe("jobDetailsFromExport", () => {
  it("joins artifact titles from the job and falls back to the kind", () => {
    const d = jobDetailsFromExport(exportOf("+x"));
    expect(d.artifacts.map((a) => [a.artifactId, a.title, a.truncated])).toEqual([
      ["a1", "Patch (attempt 1)", false],
      ["a2", "report", false],
    ]);
    expect(d.job.branch).toBe("agentlife/task-1");
    expect(JobDetailsSchema.safeParse(d).success).toBe(true);
  });

  it("cuts a large artifact at the limit and flags it, and the result still validates", () => {
    const d = jobDetailsFromExport(exportOf("x".repeat(ARTIFACT_VIEW_MAX_CHARS + 5000)));
    const a = d.artifacts[0]!;
    expect(a.truncated).toBe(true);
    expect(a.content.startsWith("x".repeat(100))).toBe(true);
    expect(a.content.length).toBeLessThan(ARTIFACT_VIEW_MAX_CHARS + 100);
    expect(a.content).toContain(`${ARTIFACT_VIEW_MAX_CHARS + 5000} characters in total`);
    expect(JobDetailsSchema.safeParse(d).success).toBe(true);
  });

  it("keeps an artifact of exactly the limit whole", () => {
    const d = jobDetailsFromExport(exportOf("y".repeat(ARTIFACT_VIEW_MAX_CHARS)));
    expect(d.artifacts[0]?.truncated).toBe(false);
    expect(d.artifacts[0]?.content.length).toBe(ARTIFACT_VIEW_MAX_CHARS);
  });
});

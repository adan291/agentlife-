import { describe, expect, it } from "vitest";
import { AgentEventSchema, ProjectSchema, RegisterProjectBodySchema, RegisterProjectResultSchema } from "../src/index.ts";

describe("project schemas", () => {
  it("accept a register request and trim its text", () => {
    const body = RegisterProjectBodySchema.parse({ path: "  D:\\AgentHotel\\todo  ", name: " Todo ", testCommand: " npm test " });
    expect(body).toEqual({ path: "D:\\AgentHotel\\todo", name: "Todo", testCommand: "npm test" });
  });

  it("refuse an empty name, a multi-line test command and an over-long path", () => {
    expect(RegisterProjectBodySchema.safeParse({ path: "x", name: " " }).success).toBe(false);
    expect(RegisterProjectBodySchema.safeParse({ path: "x", name: "a", testCommand: "npm test\nrm -rf /" }).success).toBe(false);
    expect(RegisterProjectBodySchema.safeParse({ path: "x".repeat(501), name: "a" }).success).toBe(false);
  });

  it("describe the three outcomes of a registration", () => {
    const project = { id: "todo", name: "Todo", stack: "node-npm", testCommand: "npm test", builtin: false, registeredAt: 5 };
    expect(RegisterProjectResultSchema.safeParse({ status: "ok", project }).success).toBe(true);
    expect(
      RegisterProjectResultSchema.safeParse({
        status: "needs_acceptance",
        findings: [{ severity: "medium", kind: "email", masked: "a***@b.io", where: "package.json", count: 1 }],
        total: 1,
      }).success,
    ).toBe(true);
    expect(RegisterProjectResultSchema.safeParse({ status: "error", code: "no_commits", message: "The repository has no commits." }).success).toBe(true);
    expect(RegisterProjectResultSchema.safeParse({ status: "error", code: "made_up", message: "x" }).success).toBe(false);
  });

  it("have no field for an absolute path in the public project view", () => {
    expect(Object.keys(ProjectSchema.shape).sort()).toEqual(["builtin", "id", "name", "registeredAt", "stack", "testCommand"]);
  });

  it("know the delivery.done event", () => {
    const ev = { seq: 1, ts: 2, taskId: "task-1", type: "delivery.done", branch: "agentlife/task-1", commit: "abc1234" };
    expect(AgentEventSchema.parse(ev)).toEqual(ev);
    expect(AgentEventSchema.safeParse({ ...ev, branch: "" }).success).toBe(false);
  });
});

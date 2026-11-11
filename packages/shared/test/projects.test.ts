import { describe, expect, it } from "vitest";
import {
  AgentEventSchema,
  ClientMsgSchema,
  FURNI_CATALOG,
  ProjectSchema,
  RegisterProjectBodySchema,
  RegisterProjectResultSchema,
  ServerMsgSchema,
} from "../src/index.ts";

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

describe("protocol messages of the Reception and delivery", () => {
  it("accept the three client messages and refuse bad ones", () => {
    expect(ClientMsgSchema.parse({ type: "register_project", path: " D:\\AgentHotel\\a ", name: "A" })).toEqual({
      type: "register_project",
      path: "D:\\AgentHotel\\a",
      name: "A",
    });
    expect(ClientMsgSchema.safeParse({ type: "register_project", path: "x" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "register_project", path: "x", name: "n", acceptFindings: "yes" }).success).toBe(false);
    expect(ClientMsgSchema.parse({ type: "remove_project", projectId: "a" })).toEqual({ type: "remove_project", projectId: "a" });
    expect(ClientMsgSchema.safeParse({ type: "remove_project", projectId: "" }).success).toBe(false);
    expect(ClientMsgSchema.parse({ type: "deliver", taskId: "task-1" })).toEqual({ type: "deliver", taskId: "task-1" });
    expect(ClientMsgSchema.safeParse({ type: "deliver", taskId: "../x" }).success).toBe(false);
  });

  it("accept the server messages, the reception panel and the delivery state of a report", () => {
    const project = { id: "a", name: "A", stack: "node-npm", testCommand: "npm test", builtin: false, registeredAt: 1 };
    expect(ServerMsgSchema.safeParse({ type: "projects", projects: [project] }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "register_result", result: { status: "ok", project } }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "open_panel", panel: "reception" }).success).toBe(true);
    const report = { reportId: "r", taskId: "t", title: "T", markdown: "m" };
    expect(ServerMsgSchema.safeParse({ type: "report", report: { ...report, delivery: { state: "available" } } }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "report", report: { ...report, delivery: { state: "done", branch: "agentlife/t", commit: "abc" } } }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "report", report: { ...report, delivery: { state: "done" } } }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "error", code: "delivery_failed", message: "x" }).success).toBe(true);
  });

  it("have a reception desk in the furniture catalogue with a hint", () => {
    expect(FURNI_CATALOG["reception_desk"]).toMatchObject({ interaction: "reception", walkable: false });
    expect(FURNI_CATALOG["reception_desk"]?.hint).toBeTruthy();
  });
});

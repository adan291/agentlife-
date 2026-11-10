import { describe, expect, it } from "vitest";
import {
  AgentEventSchema,
  ClientMsgSchema,
  PROTOCOL_VERSION,
  ServerMsgSchema,
} from "../src/index.ts";

const room = {
  id: "r",
  name: "R",
  heightmap: ["00", "00"],
  door: { name: "door", x: 0, y: 1, dir: 2 },
  anchors: [{ name: "desk", x: 1, y: 1, dir: 6, agent: "qa" }],
  furni: [{ itemId: "p", defId: "plant", x: 1, y: 0, dir: 4 }],
};

const validClient: unknown[] = [
  { type: "hello", protocol: PROTOCOL_VERSION },
  { type: "move", x: 3, y: 4 },
  { type: "use", itemId: "computer_desk_1" },
  { type: "start_job", repoId: "haunted-todo", goal: "Add a due date field" },
  { type: "approve", approvalId: "a1", decision: "approve" },
  { type: "approve", approvalId: "a1", decision: "reject", note: "too risky" },
];

const invalidClient: unknown[] = [
  null,
  "move",
  {},
  { type: "unknown" },
  { type: "move", x: 1 },
  { type: "move", x: 1.5, y: 2 },
  { type: "move", x: "1", y: 2 },
  { type: "use", itemId: "" },
  { type: "start_job", repoId: "r", goal: "" },
  { type: "start_job", repoId: "r", goal: "   " },
  { type: "start_job", repoId: "r", goal: "x".repeat(301) },
  { type: "approve", approvalId: "a", decision: "maybe" },
  { type: "approve", approvalId: "a", decision: "approve", note: "n".repeat(501) },
];

const validServer: unknown[] = [
  {
    type: "welcome",
    protocol: PROTOCOL_VERSION,
    room,
    you: 1,
    avatars: [
      { id: 1, name: "You", x: 0, y: 1, dir: 2 },
      { id: "architect", name: "Architect", x: 1, y: 1, dir: 4 },
    ],
    agents: [{ agentId: "architect", state: "idle" }],
  },
  { type: "walk", id: 1, path: [{ x: 1, y: 1 }], msPerTile: 300, startedAt: 1000 },
  { type: "face", id: "qa", dir: 3 },
  { type: "agent_state", agentId: "developer", state: "working", text: "Editing files" },
  { type: "say", id: "qa", text: "Looks fine" },
  { type: "open_panel", panel: "mailbox" },
  { type: "open_panel", panel: "computer", data: { anything: 1 } },
  { type: "repos", repos: [{ id: "haunted-todo", name: "Haunted Todo" }] },
  {
    type: "job_update",
    job: {
      taskId: "t1",
      repoId: "haunted-todo",
      goal: "g",
      state: "analyzing",
      timeline: [{ ts: 1, state: "created" }],
    },
  },
  {
    type: "approval",
    approval: { approvalId: "a", taskId: "t", kind: "plan", summary: "s", status: "pending" },
  },
  { type: "report", report: { reportId: "r", taskId: "t", title: "Done", markdown: "# ok" } },
  { type: "error", code: "no_path", message: "No path" },
  { type: "activity", line: { ts: 5, agentId: "builder", text: "editing crew.ts" } },
  {
    type: "welcome",
    protocol: PROTOCOL_VERSION,
    room,
    you: 1,
    avatars: [],
    agents: [],
    activity: [{ ts: 1, agentId: "qa", text: "reading a.ts" }],
  },
];

const invalidServer: unknown[] = [
  { type: "activity", line: { ts: 5, agentId: "boss", text: "x" } },
  { type: "activity", line: { ts: 5, agentId: "qa", text: "" } },
  { type: "activity", line: { ts: 5, agentId: "qa", text: "x".repeat(81) } },
  {
    type: "welcome",
    protocol: PROTOCOL_VERSION,
    room,
    you: 1,
    avatars: [],
    agents: [],
    activity: Array.from({ length: 51 }, (_, i) => ({ ts: i, agentId: "qa", text: "x" })),
  },
  { type: "walk", id: 1, path: [{ x: 1 }], msPerTile: 300, startedAt: 0 },
  { type: "walk", id: 1, path: [], msPerTile: 0, startedAt: 0 },
  { type: "walk", id: 0, path: [], msPerTile: 100, startedAt: 0 },
  { type: "walk", id: "intruder", path: [], msPerTile: 100, startedAt: 0 },
  { type: "face", id: 1, dir: 8 },
  { type: "agent_state", agentId: "architect", state: "sleeping" },
  { type: "say", id: 1, text: "" },
  { type: "open_panel", panel: "fridge" },
  { type: "error", code: "oops", message: "x" },
  { type: "welcome", protocol: 1, room: {}, you: 1, avatars: [], agents: [] },
  { type: "job_update", job: { taskId: "t" } },
  { type: "nope" },
];

const ev = { seq: 1, ts: 1000, taskId: "t1" };

const validEvents: unknown[] = [
  { ...ev, type: "task.created", repoId: "r", goal: "g" },
  { ...ev, type: "task.state_changed", state: "developing" },
  { ...ev, type: "task.failed", reason: "engine_restarted" },
  { ...ev, type: "task.completed" },
  { ...ev, type: "agent.state_changed", agentId: "qa", state: "thinking", text: "Reviewing" },
  { ...ev, type: "agent.goto", agentId: "architect", anchor: "board" },
  { ...ev, type: "agent.goto", agentId: "architect", anchor: "home" },
  { ...ev, type: "agent.say", agentId: "developer", text: "On it" },
  { ...ev, type: "agent.activity", agentId: "developer", text: "editing util.ts" },
  { ...ev, type: "artifact.created", agentId: "architect", kind: "plan", artifactId: "a", title: "Plan" },
  { ...ev, type: "approval.requested", approvalId: "ap", kind: "plan", summary: "s", options: ["ok"] },
  { ...ev, type: "approval.resolved", approvalId: "ap", decision: "approve" },
  { ...ev, type: "report.ready", reportId: "r", title: "Report", markdown: "# Done" },
];

const invalidEvents: unknown[] = [
  { ...ev, type: "task.created", repoId: "r" },
  { ...ev, type: "task.state_changed", state: "flying" },
  { ...ev, type: "agent.state_changed", state: "idle" }, // missing agentId
  { ...ev, type: "agent.state_changed", agentId: "boss", state: "idle" },
  { ...ev, type: "agent.goto", agentId: "qa", anchor: "kitchen" },
  { ...ev, type: "agent.say", agentId: "qa", text: "" },
  { ...ev, type: "agent.activity", agentId: "qa", text: "" },
  { ...ev, type: "agent.activity", agentId: "qa", text: "x".repeat(81) },
  { ...ev, type: "agent.activity", text: "no agent" },
  { ...ev, type: "approval.resolved", approvalId: "a", decision: "later" },
  { ...ev, type: "report.ready", reportId: "r", title: "t" }, // no markdown
  { seq: -1, ts: 1, taskId: "t", type: "task.completed" },
  { seq: 1, ts: 1, type: "task.completed" }, // no taskId
  { ...ev, type: "unknown.type" },
];

describe("ClientMsg", () => {
  it.each(validClient.map((m, i) => [i, m] as const))("accepts valid sample %i", (_i, m) => {
    expect(ClientMsgSchema.safeParse(m).success).toBe(true);
  });
  it.each(invalidClient.map((m, i) => [i, m] as const))("rejects malformed sample %i", (_i, m) => {
    expect(ClientMsgSchema.safeParse(m).success).toBe(false);
  });
  it("trims the goal", () => {
    const r = ClientMsgSchema.parse({ type: "start_job", repoId: "r", goal: "  hi  " });
    expect(r).toMatchObject({ goal: "hi" });
  });
});

describe("ServerMsg", () => {
  it.each(validServer.map((m, i) => [i, m] as const))("accepts valid sample %i", (_i, m) => {
    expect(ServerMsgSchema.safeParse(m).success).toBe(true);
  });
  it.each(invalidServer.map((m, i) => [i, m] as const))("rejects malformed sample %i", (_i, m) => {
    expect(ServerMsgSchema.safeParse(m).success).toBe(false);
  });
});

describe("AgentEvent", () => {
  it.each(validEvents.map((m, i) => [i, m] as const))("accepts valid sample %i", (_i, m) => {
    expect(AgentEventSchema.safeParse(m).success).toBe(true);
  });
  it.each(invalidEvents.map((m, i) => [i, m] as const))("rejects malformed sample %i", (_i, m) => {
    expect(AgentEventSchema.safeParse(m).success).toBe(false);
  });
});

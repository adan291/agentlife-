import { describe, expect, it } from "vitest";
import { ClientMsgSchema, OVERVIEW_TIMELINE_MAX, OverviewFloorSchema, ServerMsgSchema, ShowablePanelSchema } from "../src/index.ts";

const floor = {
  roomId: "project:alpha",
  projectId: "alpha",
  name: "ALPHA",
  status: "waiting_approval",
  waiting: 1,
  job: {
    taskId: "task-1",
    kind: "review-branch",
    target: "feature/x",
    state: "awaiting_plan_approval",
    startedAt: 1000,
    timeline: [
      { ts: 1000, state: "created" },
      { ts: 2000, state: "awaiting_plan_approval" },
    ],
  },
  lastReport: { reportId: "r1", taskId: "task-0", verdict: "pass", at: 900, delivery: "available" },
};

describe("overview protocol", () => {
  it("accepts an overview with a job, a waiting count and a last report", () => {
    expect(ServerMsgSchema.safeParse({ type: "overview", floors: [floor] }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "overview", floors: [] }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "overview", floors: [{ roomId: "project:b", projectId: "b", name: "B", status: "idle", waiting: 0 }] }).success).toBe(true);
  });

  it("rejects values outside the schema", () => {
    const bad = (patch: object) => OverviewFloorSchema.safeParse({ ...floor, ...patch }).success;
    expect(bad({ status: "sleeping" })).toBe(false);
    expect(bad({ waiting: -1 })).toBe(false);
    expect(bad({ job: { ...floor.job, state: "flying" } })).toBe(false);
    expect(bad({ job: { ...floor.job, timeline: Array.from({ length: OVERVIEW_TIMELINE_MAX + 1 }, () => ({ ts: 1, state: "created" })) } })).toBe(false);
    expect(bad({ lastReport: { ...floor.lastReport, verdict: "maybe" } })).toBe(false);
    expect(bad({ lastReport: { ...floor.lastReport, delivery: "sent" } })).toBe(false);
  });

  it("drops fields it does not know, so text of a job cannot ride along", () => {
    const parsed = OverviewFloorSchema.parse({
      ...floor,
      path: "D:\\AgentHotel\\alpha",
      lastReport: { ...floor.lastReport, markdown: "# body" },
      job: { ...floor.job, goal: "secret goal", timeline: [{ ts: 1, state: "created", text: "note" }] },
    });
    const json = JSON.stringify(parsed);
    for (const leak of ["AgentHotel", "# body", "secret goal", "note"]) expect(json).not.toContain(leak);
  });

  it("overview_watch needs a boolean", () => {
    expect(ClientMsgSchema.safeParse({ type: "overview_watch", on: true }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "overview_watch", on: false }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "overview_watch" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "overview_watch", on: "yes" }).success).toBe(false);
  });

  it("go_to takes an optional via of elevator or list", () => {
    expect(ClientMsgSchema.safeParse({ type: "go_to", roomId: "lobby" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "go_to", roomId: "lobby", via: "elevator" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "go_to", roomId: "project:alpha", via: "list" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "go_to", roomId: "lobby", via: "door" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "go_to", roomId: "../etc", via: "list" }).success).toBe(false);
  });

  it("show_panel takes only the panels that have a form or data of their own", () => {
    expect(ShowablePanelSchema.options).toEqual(["computer", "mailbox", "board", "review", "tests", "library", "night"]);
    for (const panel of ShowablePanelSchema.options) expect(ClientMsgSchema.safeParse({ type: "show_panel", panel }).success, panel).toBe(true);
    for (const panel of ["hr", "door", "elevator", "reception", "build", "directory", "x"]) expect(ClientMsgSchema.safeParse({ type: "show_panel", panel }).success, panel).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { ClientMsgSchema, FloorStatusSchema, JobStateSchema, ServerMsgSchema, needsAttention, statusOfJobState } from "../src/index.ts";

describe("statusOfJobState", () => {
  it("names who works in each step", () => {
    expect(statusOfJobState("analyzing")).toEqual({ status: "working", who: "architect" });
    expect(statusOfJobState("developing")).toEqual({ status: "working", who: "developer" });
    expect(statusOfJobState("testing")).toEqual({ status: "working", who: "qa" });
    expect(statusOfJobState("reviewing")).toEqual({ status: "working", who: "qa" });
    expect(statusOfJobState("awaiting_plan_approval")).toEqual({ status: "waiting_approval" });
  });

  it("a new job is queued only when it has a place in the queue", () => {
    expect(statusOfJobState("created", 2)).toEqual({ status: "queued", queuePosition: 2 });
    expect(statusOfJobState("created")).toEqual({ status: "working", who: "architect" });
  });

  it("a finished job leaves the floor idle", () => {
    for (const s of ["delivered", "cancelled", "failed"] as const) expect(statusOfJobState(s)).toEqual({ status: "idle" });
  });

  it("covers every job state", () => {
    for (const s of JobStateSchema.options) expect(statusOfJobState(s).status).toBeDefined();
  });

  it("flags the floors that need the user", () => {
    expect(needsAttention("waiting_approval")).toBe(true);
    expect(needsAttention("report_ready")).toBe(true);
    expect(needsAttention("working")).toBe(false);
  });
});

describe("protocol for floors", () => {
  it("accepts go_to for a known kind of room id only", () => {
    expect(ClientMsgSchema.safeParse({ type: "go_to", roomId: "lobby" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "go_to", roomId: "project:todo-app" }).success).toBe(true);
    for (const roomId of ["", "office", "project:", "project:../x", "project:A b"]) {
      expect(ClientMsgSchema.safeParse({ type: "go_to", roomId }).success, roomId).toBe(false);
    }
  });

  it("floors messages validate", () => {
    const floor = { roomId: "project:todo", name: "Todo", kind: "project", status: "working", who: "qa" };
    expect(FloorStatusSchema.safeParse(floor).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "floors", floors: [floor] }).success).toBe(true);
    expect(FloorStatusSchema.safeParse({ ...floor, who: "builder" }).success).toBe(false);
  });
});
